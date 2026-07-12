// Opening balances per the CPA's 12/31/2023 balance sheet. Posting is
// idempotent: if JE-OPENING already exists, the caller can opt to replace
// (delete old, post fresh). Debits and credits are asserted equal before any
// INSERT so a typo can never desync the books.

import { supabase } from './supabase';
import { postJournalEntry } from './postJournalEntry';

export const OPENING_REFERENCE   = 'JE-OPENING';
export const OPENING_DATE        = '2024-01-01';
export const OPENING_DESCRIPTION = 'Opening balances per 12/31/2023 CPA balance sheet';

// Categories required for the opening JE. `create:true` means create with the
// given type if missing; `reuse:true` means a category by that name MUST
// already exist (e.g. the pre-existing `Loans` liability category).
export const REQUIRED_OPENING_CATEGORIES = [
  { name: 'Cash & Bank',                              type: 'asset',     create: true },
  { name: 'Inventory & Deposits',                     type: 'asset',     create: true },
  { name: 'Property & Equipment',                     type: 'asset',     create: true },
  { name: 'Intangibles - Start-up Costs',             type: 'asset',     create: true },
  { name: 'Accumulated Depreciation & Amortization',  type: 'asset',     create: true, contra: true },
  { name: 'Credit Cards Payable',                     type: 'liability', create: true },
  { name: 'Other Liabilities',                        type: 'liability', create: true },
  { name: "Members' Equity - Opening",                type: 'equity',    create: true },
  { name: 'Loans',                                    type: 'liability', reuse: true },
];

// Two more categories the rest of this build depends on. Same upsert flow.
export const REQUIRED_OPERATIONAL_CATEGORIES = [
  { name: 'Depreciation & Amortization', type: 'expense', create: true },
];

export const OPENING_LINES = [
  { category: 'Cash & Bank',                              debit: 22412.41, credit: 0       },
  { category: 'Inventory & Deposits',                     debit: 18047.02, credit: 0       },
  { category: 'Property & Equipment',                     debit: 823420.89, credit: 0      },
  { category: 'Intangibles - Start-up Costs',             debit: 175564.72, credit: 0      },
  { category: "Members' Equity - Opening",                debit: 189758.60, credit: 0      },
  { category: 'Accumulated Depreciation & Amortization',  debit: 0,        credit: 621117.73 },
  { category: 'Credit Cards Payable',                     debit: 0,        credit: 568.45 },
  { category: 'Other Liabilities',                        debit: 0,        credit: 164030.89 },
  { category: 'Loans',                                    debit: 0,        credit: 443486.57 },
];

export const OPENING_EXPECTED_TOTAL = 1229203.64;

export function sumDebits(lines)  { return lines.reduce((s, l) => s + (l.debit  || 0), 0); }
export function sumCredits(lines) { return lines.reduce((s, l) => s + (l.credit || 0), 0); }

// Ensure each required category exists with the right type. Returns
// { created: [...], reused: [...] }. Never modifies an existing category's
// type — if a name collides with a different type, throws so the user knows.
export async function ensureOpeningCategories(existingCategories, addCategory) {
  const byName  = new Map((existingCategories || []).map(c => [c.name, c]));
  const created = [];
  const reused  = [];

  for (const spec of [...REQUIRED_OPENING_CATEGORIES, ...REQUIRED_OPERATIONAL_CATEGORIES]) {
    const have = byName.get(spec.name);
    if (have) {
      if ((have.type || '').toLowerCase() !== spec.type) {
        throw new Error(
          `Category "${spec.name}" exists with type "${have.type}" but the opening balance flow expects type "${spec.type}". Resolve manually before posting.`
        );
      }
      reused.push(spec.name);
      continue;
    }
    if (spec.reuse) {
      throw new Error(`Required category "${spec.name}" (type ${spec.type}) is missing. The opening balance flow refuses to create it because it should already exist.`);
    }
    await addCategory(spec.name, spec.type);
    created.push(spec.name);
  }
  return { created, reused };
}

export async function findExistingOpeningJE() {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('id, reference, date, status, total_amount')
    .eq('reference', OPENING_REFERENCE)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// Delete txns first (FK is SET NULL, so they'd outlive the JE otherwise);
// journal_entry_lines cascade off journal_entries.
async function deleteOpeningJE(je) {
  const { error: txnErr } = await supabase.from('transactions').delete().eq('journal_entry_id', je.id);
  if (txnErr) throw txnErr;
  const { error: jeErr } = await supabase.from('journal_entries').delete().eq('id', je.id);
  if (jeErr) throw jeErr;
}

// Post (or replace) the JE-OPENING journal entry plus the matching posted
// transaction rows. The transactions table is the source of truth for both
// P&L (revenue/expense categories only) and Balance Sheet (asset/liability/
// equity categories only), so we mirror the JE there.
//
//   userId          — current user's id, for created_by / posted_at
//   existingCategories — DataContext.categories
//   addCategory     — DataContext.addCategory (used to mint any missing categories)
//   replace         — if true, delete a prior JE-OPENING before posting
export async function postOpeningJE({ userId, existingCategories, addCategory, replace = false }) {
  // 1. Categories.
  const { created, reused } = await ensureOpeningCategories(existingCategories, addCategory);

  // 2. Balance assertion — typo guard, runs every time before any INSERT.
  const dr = sumDebits(OPENING_LINES);
  const cr = sumCredits(OPENING_LINES);
  if (Math.abs(dr - cr) > 0.005 || Math.abs(dr - OPENING_EXPECTED_TOTAL) > 0.005) {
    throw new Error(`Opening JE refused to post: debits ${dr.toFixed(2)} / credits ${cr.toFixed(2)} / expected ${OPENING_EXPECTED_TOTAL.toFixed(2)}.`);
  }

  // 3. Replace or refuse if one already exists.
  const existing = await findExistingOpeningJE();
  if (existing) {
    if (!replace) {
      return { posted: false, existing, created, reused };
    }
    await deleteOpeningJE(existing);
  }

  // 4. Insert JE + lines + txns — atomically through the RPC. If any part
  //    fails (or the DB re-check finds the lines unbalanced), nothing lands.
  const lineRows = OPENING_LINES.map(l => ({
    account_id:    null,
    description:   l.category,
    debit_amount:  l.debit,
    credit_amount: l.credit,
    category:      l.category,
  }));
  const txnRows = OPENING_LINES.map(l => ({
    date:              OPENING_DATE,
    description:       `Opening balance — ${l.category}`,
    supplier:          'Opening Balance',
    amount:            l.debit > 0 ? l.debit : l.credit,
    type:              l.debit > 0 ? 'debit' : 'credit',
    category:          l.category,
    account_id:        null,
    reference:         OPENING_REFERENCE,
    bank_statement_id: null,
    posted:            true,
  }));
  const { entry_id } = await postJournalEntry({
    entry: {
      reference:    OPENING_REFERENCE,
      date:         OPENING_DATE,
      description:  OPENING_DESCRIPTION,
      memo:         `Debits ${dr.toFixed(2)} = Credits ${cr.toFixed(2)} (asserted)`,
      total_amount: dr,
      status:       'posted',
      entry_type:   'simple',
      created_by:   userId || null,
      posted_at:    new Date().toISOString(),
    },
    lines: lineRows,
    txns:  txnRows,
  });

  return { posted: true, replaced: !!existing, je: { id: entry_id, reference: OPENING_REFERENCE }, created, reused, total: dr };
}
