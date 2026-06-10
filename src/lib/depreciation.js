// Monthly depreciation / amortization aggregator + idempotent poster.
//
// One JE per month: DR "Depreciation & Amortization" (expense),
//                   CR "Accumulated Depreciation & Amortization" (contra-asset).
// The amount is the sum of every active asset's straight-line monthly charge.
//
// "Generate through [month]" catches every missing month from Jan 2024 to the
// selected month in one click. A pre-existing JE for a given month is skipped
// unless the user explicitly chose Replace.

import { supabase } from './supabase';

export const DEP_EXPENSE_CATEGORY  = 'Depreciation & Amortization';
export const DEP_ACCUM_CATEGORY    = 'Accumulated Depreciation & Amortization';
export const DEP_REFERENCE_PREFIX  = 'JE-DA-';                 // e.g. JE-DA-2024-01
export const DEP_DESCRIPTION_PREFIX = 'Depreciation & Amortization — ';
export const DEPRECIATION_START_PERIOD = '2024-01';

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function periodLabel(period) {
  const [y, m] = period.split('-');
  return `${MONTHS_FULL[+m - 1]} ${y}`;
}

function lastDayOfPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  const day = new Date(y, m, 0).getDate();
  return `${period}-${String(day).padStart(2, '0')}`;
}

function depReference(period) {
  return `${DEP_REFERENCE_PREFIX}${period}`;
}

// Monthly straight-line amount for one asset.
export function monthlyForAsset(asset) {
  const life = Number(asset.life_years) || 0;
  const cost = Number(asset.cost) || 0;
  if (life <= 0 || cost <= 0) return 0;
  return cost / (life * 12);
}

// Sum of monthly charges across every active asset that is in service by the
// last day of the period. Assets retired before the period are excluded.
export function combinedMonthly(assets, period) {
  const end = lastDayOfPeriod(period);
  return (assets || []).reduce((s, a) => {
    if (a.status !== 'active') return s;
    if (a.in_service_date > end) return s;
    if (a.retired_date && a.retired_date < end) return s;
    return s + monthlyForAsset(a);
  }, 0);
}

// All months from Jan 2024 (DEPRECIATION_START_PERIOD) through `endPeriod`,
// inclusive. Returns ['2024-01', '2024-02', ...].
export function monthsThrough(endPeriod) {
  const [sy, sm] = DEPRECIATION_START_PERIOD.split('-').map(Number);
  const [ey, em] = endPeriod.split('-').map(Number);
  const out = [];
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Look up which months already have a JE-DA posted (so we can skip them
// unless the user chose Replace).
export async function existingDepreciationPeriods(periods) {
  if (!periods.length) return new Set();
  const refs = periods.map(depReference);
  const { data, error } = await supabase
    .from('journal_entries')
    .select('reference')
    .in('reference', refs)
    .neq('status', 'void');
  if (error) throw error;
  return new Set((data || []).map(r => r.reference.slice(DEP_REFERENCE_PREFIX.length)));
}

async function deleteDepreciationJE(reference) {
  const { data: je } = await supabase.from('journal_entries').select('id').eq('reference', reference).limit(1);
  const row = je?.[0];
  if (!row) return;
  await supabase.from('transactions').delete().eq('journal_entry_id', row.id);
  await supabase.from('journal_entries').delete().eq('id', row.id);
}

// Post a single month's JE (and the matching txns). Returns the posted JE row.
async function postOneMonth({ period, amount, userId }) {
  if (amount <= 0.005) return null;
  const reference = depReference(period);
  const date      = lastDayOfPeriod(period);
  const monthName = periodLabel(period);

  const { data: entry, error: e1 } = await supabase.from('journal_entries').insert({
    reference,
    date,
    description:  `${DEP_DESCRIPTION_PREFIX}${monthName}`,
    memo:         `Straight-line D&A for ${monthName}`,
    total_amount: amount,
    status:       'posted',
    entry_type:   'simple',
    created_by:   userId || null,
    posted_at:    new Date().toISOString(),
  }).select().single();
  if (e1) throw e1;

  const lines = [
    { journal_entry_id: entry.id, account_id: null, description: DEP_EXPENSE_CATEGORY, debit_amount: amount, credit_amount: 0, category: DEP_EXPENSE_CATEGORY },
    { journal_entry_id: entry.id, account_id: null, description: DEP_ACCUM_CATEGORY,   debit_amount: 0, credit_amount: amount, category: DEP_ACCUM_CATEGORY   },
  ];
  const { error: e2 } = await supabase.from('journal_entry_lines').insert(lines);
  if (e2) throw e2;

  const txns = [
    { date, description: `D&A — ${monthName}`, supplier: 'Depreciation JE', amount, type: 'debit',  category: DEP_EXPENSE_CATEGORY, account_id: null, reference, bank_statement_id: null, journal_entry_id: entry.id, posted: true },
    { date, description: `D&A — ${monthName}`, supplier: 'Depreciation JE', amount, type: 'credit', category: DEP_ACCUM_CATEGORY,   account_id: null, reference, bank_statement_id: null, journal_entry_id: entry.id, posted: true },
  ];
  const { error: e3 } = await supabase.from('transactions').insert(txns);
  if (e3) throw e3;

  return entry;
}

// Post every month from Jan 2024 through `endPeriod` that doesn't already have
// a JE-DA. Returns a summary: { posted, skipped, replaced, total }.
// When `replace=true`, existing months are wiped and re-posted at the current
// combined monthly amount (lets users correct after retiring/adding assets).
export async function generateDepreciationThrough({ endPeriod, assets, userId, replace = false }) {
  const periods  = monthsThrough(endPeriod);
  const existing = await existingDepreciationPeriods(periods);

  const posted   = [];
  const skipped  = [];
  const replaced = [];
  let total      = 0;

  for (const period of periods) {
    const amount = combinedMonthly(assets, period);
    if (amount <= 0.005) { skipped.push({ period, reason: 'zero amount' }); continue; }

    if (existing.has(period)) {
      if (!replace) { skipped.push({ period, reason: 'already posted' }); continue; }
      await deleteDepreciationJE(depReference(period));
      replaced.push(period);
    }

    await postOneMonth({ period, amount, userId });
    posted.push({ period, amount });
    total += amount;
  }

  return { posted, skipped, replaced, total };
}
