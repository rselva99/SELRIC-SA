// Single source of truth for allocating JE references on the plain JE-NNN
// sequence (Payroll, Simple, Double-Entry, Auto-reversals, Revenue Breakdown,
// Recurring Rules). The JE-CAP-NNN (capitalize) and JE-DA-YYYY-MM
// (depreciation) sequences are intentionally separate and live in their own
// modules — they have their own collision domains.
//
// Bug guarded against: scanning the most-recently-created JE with an
// unanchored /JE-(\d+)/ regex used to grab the trailing digits of
// JE-DA-2024-05 or fail outright on JE-OPENING, producing a duplicate or
// invalid reference. We now scan ALL JE-prefixed references and keep only
// those that match /^JE-\d+$/. Max + 1, zero-padded to three digits.
//
// Even with that fix, a race between two clients (or two tabs) can still
// land on the same number between query and insert. insertJournalEntryWithRetry
// catches the Postgres unique_violation (23505) and re-allocates, up to
// five attempts. Callers don't need their own counters or local state.

import { supabase } from './supabase';
import { wrapIfPeriodLocked, isPeriodLockedError } from './periodLock';

const MAX_REFERENCE_SCAN = 500;
const MAX_RETRIES        = 5;
const UNIQUE_VIOLATION   = '23505';

export async function nextJournalReference() {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('reference')
    .ilike('reference', 'JE-%')
    .order('reference', { ascending: false })
    .limit(MAX_REFERENCE_SCAN);
  if (error) {
    console.error('nextJournalReference: failed to load references', error);
    throw error;
  }
  let maxN = 0;
  for (const r of data || []) {
    const m = (r.reference || '').match(/^JE-(\d+)$/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (n > maxN) maxN = n;
  }
  return `JE-${String(maxN + 1).padStart(3, '0')}`;
}

// Inserts a journal_entries row whose reference is allocated fresh each
// attempt. On 23505 (unique_violation) — typically another tab landing on
// the same number first — re-query and retry. Returns the inserted row.
//
//   row    — every column for journal_entries EXCEPT reference
//   onRef  — optional callback({ reference, attempt }) for callers that need
//            to mirror the reference into related rows (txns, JE lines).
//
// Throws the underlying Supabase error on any non-23505 failure, or a
// terminal "Could not allocate" error after MAX_RETRIES exhausted.
export async function insertJournalEntryWithRetry(row, { onRef } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const reference = await nextJournalReference();
    if (onRef) onRef({ reference, attempt });
    const { data, error } = await supabase
      .from('journal_entries')
      .insert({ ...row, reference })
      .select()
      .single();
    if (!error) return { data, reference };
    // Period-lock trigger error gets bubbled up as a typed PeriodClosedError
    // so callers can show the reopen dialog without inspecting raw codes.
    if (isPeriodLockedError(error)) throw wrapIfPeriodLocked(error);
    if (error.code !== UNIQUE_VIOLATION) {
      console.error('insertJournalEntryWithRetry: insert failed', { attempt, error });
      throw error;
    }
    lastErr = error;
    console.warn(`insertJournalEntryWithRetry: reference ${reference} collided (attempt ${attempt}/${MAX_RETRIES}); retrying`);
  }
  const err = new Error(`Could not allocate a unique JE reference after ${MAX_RETRIES} attempts`);
  err.cause = lastErr;
  throw err;
}
