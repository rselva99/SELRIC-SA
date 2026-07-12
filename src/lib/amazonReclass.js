// Pure-logic helpers for the Amazon Reclass tool. All Supabase reads live
// here; the component is presentational. Posting happens in the component
// because it has to compose with insertJournalEntryWithRetry and the
// existing period-lock reopen flow.
//
// Convention reminders:
//   • The active chart of accounts is the `categories` table — `accounts`
//     is the legacy empty table. JE lines store `account_id: null` and
//     carry the category name in the text `category` column.
//   • Balance math matches the P&L exactly: filter `voided=false`, no
//     `posted` filter, and use `debitMinusCredit` from finance.js so the
//     same per-row sign rule applies (debits add, credits net down on
//     expense-type categories).

import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { debitMinusCredit } from './finance';

// Fixed split. RESIDUAL_LEG_KEY is the leg that absorbs the penny diff
// produced by rounding each leg to cents — Supplies (40%) is the largest,
// so a one-cent residual on it is the smallest relative distortion.
export const RECLASS_SPLIT = [
  { key: 'additions', label: 'Additions',             pct: 0.25 },
  { key: 'repairs',   label: 'Repairs & Maintenance', pct: 0.33 },
  { key: 'supplies',  label: 'Supplies',              pct: 0.40 },
  { key: 'misc',      label: 'Miscellaneous',         pct: 0.02 },
];

export const RESIDUAL_LEG_KEY = 'supplies';

// Hints used to auto-resolve the five category names from the live
// categories table. Each hint is an array of lowercase tokens that ALL
// have to appear in `categories.name` (case-insensitive). The outer
// array is preference order — the first hint that matches wins.
export const RECLASS_HINTS = {
  amazon:    [['amazon']],
  additions: [['additions'], ['addition']],
  repairs:   [['repairs & maintenance'], ['repairs and maintenance'], ['repairs', 'maintenance'], ['repair']],
  supplies:  [['supplies']],
  misc:      [['miscellaneous'], ['misc']],
};

function nameMatchesHint(name, hint) {
  const lower = (name || '').toLowerCase();
  return hint.every(token => lower.includes(token));
}

// Returns { amazon, additions, repairs, supplies, misc } where each value
// is either the matched `categories.name` string or null. Only considers
// expense-type, non-archived categories.
export function resolveReclassCategoryNames(categories) {
  const expenseCats = (categories || [])
    .filter(c => (c.type || '').toLowerCase() === 'expense' && !c.archived);
  const pick = (hintList) => {
    for (const hint of hintList) {
      const hit = expenseCats.find(c => nameMatchesHint(c.name, hint));
      if (hit) return hit.name;
    }
    return null;
  };
  return {
    amazon:    pick(RECLASS_HINTS.amazon),
    additions: pick(RECLASS_HINTS.additions),
    repairs:   pick(RECLASS_HINTS.repairs),
    supplies:  pick(RECLASS_HINTS.supplies),
    misc:      pick(RECLASS_HINTS.misc),
  };
}

// ── Period helpers ──────────────────────────────────────────────────────────

const PAD2 = (n) => String(n).padStart(2, '0');

export function monthBounds(yearMonth) {
  const [y, m] = (yearMonth || '').split('-').map(Number);
  if (!y || !m) return { start: '', end: '' };
  const start = `${y}-${PAD2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${PAD2(m)}-${PAD2(lastDay)}`;
  return { start, end };
}

export function yearBounds(year) {
  const y = Number(year);
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export function monthsInYear(year) {
  const y = Number(year);
  return Array.from({ length: 12 }, (_, i) => `${y}-${PAD2(i + 1)}`);
}

// ── Balance fetchers ────────────────────────────────────────────────────────

// Single-period Amazon balance. Returns { balance, txnCount, unpostedCount }.
// balance is Math.round((Σ debit − Σ credit) * 100) / 100, matching how the
// P&L aggregates an expense category for the same window.
export async function fetchAmazonBalance({ amazonName, start, end }) {
  if (!amazonName || !start || !end) {
    return { balance: 0, txnCount: 0, unpostedCount: 0 };
  }
  // Paginated: Amazon activity in a year approaches the 1,000-row cap; a
  // truncated fetch would under-report the balance the reclass JE targets.
  const rows = await fetchAll(
    supabase
      .from('transactions')
      .select('amount, type, posted')
      .eq('category', amazonName)
      .eq('voided', false)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })
  );
  let balance = 0;
  let unposted = 0;
  for (const t of rows) {
    balance += debitMinusCredit(t);
    if (!t.posted) unposted += 1;
  }
  return {
    balance: Math.round(balance * 100) / 100,
    txnCount: rows.length,
    unpostedCount: unposted,
  };
}

// Full-year breakdown. Returns one entry per month (12 rows), each
// { period: 'YYYY-MM', start, end, balance, txnCount, unpostedCount }.
// Single query, in-memory group by month — cheaper than 12 round trips.
export async function fetchAmazonBalanceByMonth({ amazonName, year }) {
  if (!amazonName || !year) return [];
  const { start, end } = yearBounds(year);
  // Paginated: full-year Amazon fetch can exceed the 1,000-row cap.
  const rows = await fetchAll(
    supabase
      .from('transactions')
      .select('amount, type, date, posted')
      .eq('category', amazonName)
      .eq('voided', false)
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: true })
  );

  const buckets = {};
  for (const period of monthsInYear(year)) {
    const { start: s, end: e } = monthBounds(period);
    buckets[period] = { period, start: s, end: e, balance: 0, txnCount: 0, unpostedCount: 0 };
  }
  for (const t of rows) {
    const period = (t.date || '').slice(0, 7);
    const b = buckets[period];
    if (!b) continue;
    b.balance += debitMinusCredit(t);
    b.txnCount += 1;
    if (!t.posted) b.unpostedCount += 1;
  }
  return Object.values(buckets).map(b => ({
    ...b,
    balance: Math.round(b.balance * 100) / 100,
  }));
}

// ── Leg builder ─────────────────────────────────────────────────────────────

// Builds the structured leg list for one JE. Returns
//   { legs, totalDebits, totalCredits, balanced, reason }
// reason is:
//   'zero'      — balance is exactly 0 → nothing to reclass
//   'negative'  — balance < 0 → we never auto-flip; caller must block
//   null        — normal positive-balance case
//
// On the normal path the four target legs are rounded to cents, then the
// residual (credit minus sum-of-debits) is added to the Supplies leg so
// total debits exactly equal the credit.
export function buildReclassLegs({ balance, names }) {
  const safeBal = Number(balance) || 0;
  if (safeBal === 0) {
    return { legs: [], totalDebits: 0, totalCredits: 0, balanced: false, reason: 'zero' };
  }
  if (safeBal < 0) {
    return { legs: [], totalDebits: 0, totalCredits: 0, balanced: false, reason: 'negative' };
  }

  const credit = Math.round(safeBal * 100) / 100;
  let debits = RECLASS_SPLIT.map(s => ({
    key: s.key,
    label: s.label,
    side: 'debit',
    categoryName: names?.[s.key] || null,
    amount: Math.round(safeBal * s.pct * 100) / 100,
  }));
  const sumDebits = debits.reduce((s, l) => s + l.amount, 0);
  const residual = Math.round((credit - sumDebits) * 100) / 100;
  if (residual !== 0) {
    debits = debits.map(l =>
      l.key === RESIDUAL_LEG_KEY
        ? { ...l, amount: Math.round((l.amount + residual) * 100) / 100 }
        : l
    );
  }
  const finalDebits = Math.round(debits.reduce((s, l) => s + l.amount, 0) * 100) / 100;
  const legs = [
    ...debits,
    { key: 'amazon', label: 'Amazon', side: 'credit', categoryName: names?.amazon || null, amount: credit },
  ];
  return {
    legs,
    totalDebits: finalDebits,
    totalCredits: credit,
    balanced: Math.abs(finalDebits - credit) < 0.005,
    reason: null,
  };
}

// One full previewable JE for a period. The component just feeds this into
// its preview table; the same shape is used when posting.
export function buildReclassPreviewForPeriod({ period, balance, names, txnCount = 0, unpostedCount = 0 }) {
  const { start, end } = monthBounds(period);
  const { legs, totalDebits, totalCredits, balanced, reason } = buildReclassLegs({ balance, names });
  return {
    period,
    start,
    end,
    date: end,                  // JE dated to month-end, posted INTO that month
    balance,
    txnCount,
    unpostedCount,
    legs,
    totalDebits,
    totalCredits,
    balanced,
    reason,                     // 'zero' | 'negative' | null
    postable: balanced && !reason,
  };
}
