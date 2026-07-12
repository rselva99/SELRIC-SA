// Single entry point for posting a journal entry. Routes to the DB-side
// `post_journal_entry` RPC so the (header, lines, mirrored txns) triple lands
// in ONE Postgres transaction and is rejected if the lines don't balance.
//
// Why this exists: every JE-posting path used to do three separate INSERTs
// (journal_entries → journal_entry_lines → transactions) with no atomic
// wrapper. When the second or third INSERT failed, the first stayed
// committed, leaving a half-entry that no client-side balance check could
// catch. That's Phase A's "half-entry hole" — this closes it.
//
// Reference collisions (Postgres 23505) still bubble up here; the caller
// (typically `insertJournalEntryWithRetry`) re-allocates and retries.

import { supabase } from './supabase';
import { nextJournalReference } from './journalReference';
import { wrapIfPeriodLocked, isPeriodLockedError } from './periodLock';

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION  = '23514';
const MAX_RETRIES      = 5;

// Every JE-line field the RPC understands. Extra fields on the caller's
// objects are ignored by the RPC's json-key lookup, so this is a documentation
// list only — no runtime filtering.
//   { account_id, description, debit_amount, credit_amount, category }

// Every JE-txn field. account_id / reference / journal_entry_id are wired in
// by the RPC and any caller-supplied values for those are ignored / overridden.
//   { date, description, supplier, amount, type, category, account_id?,
//     reference?, bank_statement_id?, posted?, voided? }

// entry: {
//   date, description, memo?, total_amount?, status?, entry_type?,
//   rule_id?, created_by?, posted_at?
// }
// The caller does NOT allocate `reference` — this helper does, and retries on
// unique_violation.

export class UnbalancedJournalEntryError extends Error {
  constructor(message) { super(message); this.name = 'UnbalancedJournalEntryError'; }
}

export async function postJournalEntry({ entry, lines, txns = [], onRef } = {}) {
  if (!entry) throw new Error('postJournalEntry: entry required');
  if (!Array.isArray(lines) || lines.length < 2) {
    throw new UnbalancedJournalEntryError('postJournalEntry: at least 2 lines required');
  }
  // Local pre-check so we don't burn a reference number on an obviously
  // unbalanced payload. The DB re-checks with tolerance.
  const dr = lines.reduce((s, l) => s + (Number(l?.debit_amount)  || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l?.credit_amount) || 0), 0);
  if (Math.abs(dr - cr) > 0.005) {
    throw new UnbalancedJournalEntryError(
      `postJournalEntry: unbalanced (debits ${dr.toFixed(2)} != credits ${cr.toFixed(2)})`
    );
  }
  if (dr <= 0) {
    throw new UnbalancedJournalEntryError('postJournalEntry: entry total must be positive');
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const reference = entry.reference || (await nextJournalReference());
    if (onRef) onRef({ reference, attempt });

    const entryPayload = { ...entry, reference };

    const { data, error } = await supabase.rpc('post_journal_entry', {
      p_entry: entryPayload,
      p_lines: lines,
      p_txns:  txns,
    });

    if (!error) {
      return {
        entry_id:  data?.entry_id,
        reference: data?.reference || reference,
        line_count: data?.line_count ?? lines.length,
        debits:    data?.debits ?? dr,
        credits:   data?.credits ?? cr,
      };
    }
    if (isPeriodLockedError(error)) throw wrapIfPeriodLocked(error);
    if (error.code === CHECK_VIOLATION) {
      throw new UnbalancedJournalEntryError(error.message || 'unbalanced entry rejected by DB');
    }
    if (error.code !== UNIQUE_VIOLATION) {
      throw error;
    }
    lastErr = error;
    // Reference the caller supplied is the one that collided; drop it so
    // the next attempt allocates fresh.
    if (entry.reference) delete entry.reference;
  }
  const err = new Error(`Could not allocate a unique JE reference after ${MAX_RETRIES} attempts`);
  err.cause = lastErr;
  throw err;
}
