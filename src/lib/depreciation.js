// Monthly depreciation + amortization aggregator and idempotent poster.
//
// Each month, this module can post up to two journal entries:
//
//   • DEPRECIATION JE (JE-DA-YYYY-MM)
//       DR "Depreciation Expense"        (sum over asset_type='depreciable')
//       CR "Accumulated Depreciation"
//
//   • AMORTIZATION JE (JE-AM-YYYY-MM)
//       DR "Amortization Expense"        (sum over asset_type='amortizable')
//       CR "Accumulated Amortization"
//
// The split is by `assets.asset_type` — 'depreciable' vs 'amortizable'.
// This replaces the earlier combined "Depreciation & Amortization"
// account (still present in the CoA for historical entries) — see
// migrations 2026-07-11-add-depreciation-coa-accounts.sql and
// 2026-07-11-b-add-amortization-coa-accounts.sql for the account setup.
//
// CPA LOCK. Any (year, kind) row in public.cpa_sourced_locks blocks the
// generator for that year+kind. Depreciation and amortization can be
// locked independently. `generateDepreciationThrough` SKIPS every
// locked (year, kind) it encounters — never deletes, never posts — and
// reports them in the result's `cpaSkipped` list. Unlocked periods in
// the same call still run normally (so a mixed 2024-2025 range where
// 2024 is locked will post 2025 while leaving 2024 untouched). When
// the entire call would touch only locked periods (nothing posted or
// replaced), it throws `CpaLockedError` so the caller surfaces a clear
// error instead of a silent no-op. Unlocking is a manual admin
// operation. See src/lib/cpaLocks.js.
//
// "Generate through [month]" catches every missing month from Jan 2024
// to the selected month in one click. A pre-existing JE (matched by
// reference) is skipped unless the caller passes replace=true; replace
// wipes only the matching-kind JE, not the other.

import { supabase } from './supabase';
import {
  listCpaLocks,
  isCpaLocked,
  cpaLockNote,
  CpaLockedError,
} from './cpaLocks';

// ── CoA account names (separate depreciation vs. amortization) ─────────
export const DEP_EXPENSE_CATEGORY      = 'Depreciation Expense';
export const DEP_ACCUM_CATEGORY        = 'Accumulated Depreciation';
export const AMORT_EXPENSE_CATEGORY    = 'Amortization Expense';
export const AMORT_ACCUM_CATEGORY      = 'Accumulated Amortization';

// ── Reference prefixes ─────────────────────────────────────────────────
export const DEP_REFERENCE_PREFIX      = 'JE-DA-';  // depreciation, e.g. JE-DA-2024-01
export const AMORT_REFERENCE_PREFIX    = 'JE-AM-';  // amortization, e.g. JE-AM-2024-01

// ── Descriptions ───────────────────────────────────────────────────────
export const DEP_DESCRIPTION_PREFIX    = 'Depreciation — ';
export const AMORT_DESCRIPTION_PREFIX  = 'Amortization — ';

export const DEPRECIATION_START_PERIOD = '2024-01';

// Two kinds, addressable independently.
export const KIND_DEPRECIATION = 'depreciation';
export const KIND_AMORTIZATION = 'amortization';
export const ALL_KINDS = [KIND_DEPRECIATION, KIND_AMORTIZATION];

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

function yearOfPeriod(period) {
  return parseInt(period.split('-')[0], 10);
}

function depReference(period)   { return `${DEP_REFERENCE_PREFIX}${period}`; }
function amortReference(period) { return `${AMORT_REFERENCE_PREFIX}${period}`; }

// Asset-type predicates. `asset_type` is null-tolerant: rows with an
// unknown type default to depreciable (that was the register's original
// behaviour and it keeps existing seeded rows intact).
function isAmortizable(asset) {
  return (asset?.asset_type || '').toLowerCase() === 'amortizable';
}
function isDepreciable(asset) {
  return !isAmortizable(asset);
}
export function assetKind(asset) {
  return isAmortizable(asset) ? KIND_AMORTIZATION : KIND_DEPRECIATION;
}

// Monthly straight-line amount for one asset (the asset's base rate; period
// gating happens in `monthlyForAssetInPeriod`).
export function monthlyForAsset(asset) {
  const life = Number(asset.life_years) || 0;
  const cost = Number(asset.cost) || 0;
  if (life <= 0 || cost <= 0) return 0;
  return cost / (life * 12);
}

// 1-indexed month-of-life for the asset in `period`. Returns 1 in the
// in-service month, 2 the month after, … < 1 before the in-service month.
function depreciationMonthIndex(serviceDate, period) {
  const [sy, sm] = serviceDate.split('-').map(Number);
  const [py, pm] = period.split('-').map(Number);
  return (py - sy) * 12 + (pm - sm) + 1;
}

// Per-asset periodic charge for `period`. Returns 0 when:
//   • the asset is not yet in service that month (idx < 1),
//   • the retirement month is BEFORE this period (retire month itself
//     still charges — the asset was in service for at least part of it),
//   • the asset has reached the end of its useful life.
// The last month of life pays the rounding stub — caps cumulative
// accrual at cost so accumulated never overshoots.
export function monthlyForAssetInPeriod(asset, period) {
  if (!asset) return 0;
  const life = Number(asset.life_years) || 0;
  const cost = Number(asset.cost) || 0;
  if (life <= 0 || cost <= 0) return 0;

  const idx = depreciationMonthIndex(asset.in_service_date, period);
  if (idx < 1) return 0;

  if (asset.retired_date) {
    const retiredPeriod = asset.retired_date.slice(0, 7);
    if (period > retiredPeriod) return 0;
  }

  const totalMonths = life * 12;
  if (idx > totalMonths) return 0;

  const monthly    = cost / totalMonths;
  const priorAccum = monthly * (idx - 1);
  const remaining  = cost - priorAccum;
  return Math.max(0, Math.min(monthly, remaining));
}

// Sum charge across assets of a given kind for `period`.
function monthlyForKind(assets, period, kind) {
  return (assets || []).reduce((s, a) => {
    if (assetKind(a) !== kind) return s;
    return s + monthlyForAssetInPeriod(a, period);
  }, 0);
}

// Sum monthly across every asset that is depreciating (any kind) in
// `period`. Retained for existing UI callers that just want the total.
export function combinedMonthly(assets, period) {
  return (assets || []).reduce((s, a) => s + monthlyForAssetInPeriod(a, period), 0);
}

// Per-kind wrappers kept alongside `combinedMonthly` so future callers
// can display them separately.
export function depreciationMonthly(assets, period) { return monthlyForKind(assets, period, KIND_DEPRECIATION); }
export function amortizationMonthly (assets, period) { return monthlyForKind(assets, period, KIND_AMORTIZATION); }

// Total charge across multiple periods (used by the catch-up modal to
// show an accurate "Will post" total when monthly amounts vary across
// months, e.g. a new asset comes online mid-range).
export function projectedTotalAcrossPeriods(assets, periods) {
  return (periods || []).reduce((s, p) => s + combinedMonthly(assets, p), 0);
}

// All months from Jan 2024 through `endPeriod`, inclusive. Returns
// ['2024-01', '2024-02', ...].
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

// Look up which months already have a JE-DA or JE-AM posted (so we can
// skip them unless the user chose Replace). Returns a Set of YYYY-MM.
export async function existingDepreciationPeriods(periods) {
  if (!periods.length) return new Set();
  const refs = periods.flatMap(p => [depReference(p), amortReference(p)]);
  const { data, error } = await supabase
    .from('journal_entries')
    .select('reference')
    .in('reference', refs)
    .neq('status', 'voided');
  if (error) throw error;
  const set = new Set();
  for (const r of data || []) {
    const ref = r.reference || '';
    if (ref.startsWith(DEP_REFERENCE_PREFIX))   set.add(ref.slice(DEP_REFERENCE_PREFIX.length));
    if (ref.startsWith(AMORT_REFERENCE_PREFIX)) set.add(ref.slice(AMORT_REFERENCE_PREFIX.length));
  }
  return set;
}

async function deleteJournalByReference(reference) {
  const { data: je } = await supabase.from('journal_entries').select('id').eq('reference', reference).limit(1);
  const row = je?.[0];
  if (!row) return;
  await supabase.from('transactions').delete().eq('journal_entry_id', row.id);
  await supabase.from('journal_entry_lines').delete().eq('journal_entry_id', row.id);
  await supabase.from('journal_entries').delete().eq('id', row.id);
}

// Post one month's JE for a single kind. Returns the JE row, or null
// when amount is effectively zero.
async function postOneMonthKind({ period, amount, kind, userId }) {
  if (amount <= 0.005) return null;

  const isDep       = kind === KIND_DEPRECIATION;
  const expenseCat  = isDep ? DEP_EXPENSE_CATEGORY  : AMORT_EXPENSE_CATEGORY;
  const accumCat    = isDep ? DEP_ACCUM_CATEGORY    : AMORT_ACCUM_CATEGORY;
  const reference   = isDep ? depReference(period)  : amortReference(period);
  const descPrefix  = isDep ? DEP_DESCRIPTION_PREFIX : AMORT_DESCRIPTION_PREFIX;
  const supplierTag = isDep ? 'Depreciation JE'    : 'Amortization JE';

  const date      = lastDayOfPeriod(period);
  const monthName = periodLabel(period);
  const rounded   = Math.round(amount * 100) / 100;

  const { data: entry, error: e1 } = await supabase.from('journal_entries').insert({
    reference,
    date,
    description:  `${descPrefix}${monthName}`,
    memo:         `Straight-line ${kind} for ${monthName}`,
    total_amount: rounded,
    status:       'posted',
    entry_type:   'simple',
    created_by:   userId || null,
    posted_at:    new Date().toISOString(),
  }).select().single();
  if (e1) throw e1;

  const lines = [
    { journal_entry_id: entry.id, account_id: null, description: expenseCat, debit_amount: rounded, credit_amount: 0,       category: expenseCat },
    { journal_entry_id: entry.id, account_id: null, description: accumCat,   debit_amount: 0,       credit_amount: rounded, category: accumCat   },
  ];
  const { error: e2 } = await supabase.from('journal_entry_lines').insert(lines);
  if (e2) throw e2;

  const txns = [
    { date, description: `${isDep ? 'Depreciation' : 'Amortization'} — ${monthName}`, supplier: supplierTag, amount: rounded, type: 'debit',  category: expenseCat, account_id: null, reference, bank_statement_id: null, journal_entry_id: entry.id, posted: true, voided: false },
    { date, description: `${isDep ? 'Depreciation' : 'Amortization'} — ${monthName}`, supplier: supplierTag, amount: rounded, type: 'credit', category: accumCat,   account_id: null, reference, bank_statement_id: null, journal_entry_id: entry.id, posted: true, voided: false },
  ];
  const { error: e3 } = await supabase.from('transactions').insert(txns);
  if (e3) throw e3;

  return entry;
}

// Post every missing month from Jan 2024 through `endPeriod`. For each
// month posts up to TWO JEs (one depreciation, one amortization) —
// whichever kinds have a non-zero charge for that period.
//
// CPA-lock behaviour
//   Fetches CPA locks once, then for every (period, kind) whose year is
//   locked for that kind: records the pair in `cpaSkipped` and continues
//   without touching the DB. Unlocked pairs in the same call still run
//   normally. If the call finishes with NO postings AND NO replacements
//   AND at least one CPA-locked skip, throws `CpaLockedError` so the
//   caller surfaces the block instead of a silent no-op.
//
// Returns:
//   { posted, skipped, replaced, cpaSkipped, total, byKind }
export async function generateDepreciationThrough({ endPeriod, assets, userId, replace = false }) {
  const periods  = monthsThrough(endPeriod);
  const existing = await existingDepreciationPeriods(periods);
  const locks    = await listCpaLocks();

  const posted     = [];
  const skipped    = [];
  const replaced   = [];
  const cpaSkipped = [];
  const byKind     = {
    [KIND_DEPRECIATION]: { posted: 0, total: 0 },
    [KIND_AMORTIZATION]: { posted: 0, total: 0 },
  };
  let total = 0;

  for (const period of periods) {
    const year = yearOfPeriod(period);

    for (const kind of ALL_KINDS) {
      // CPA-lock guard — skip locked (year, kind) before any DB write.
      // Applies regardless of the amount, so a locked kind is never
      // touched even if the register would compute a non-zero charge.
      if (isCpaLocked(locks, year, kind)) {
        cpaSkipped.push({ period, kind, year, note: cpaLockNote(locks, year, kind) });
        continue;
      }

      const amount = monthlyForKind(assets, period, kind);
      if (amount <= 0.005) { continue; }

      const isDep     = kind === KIND_DEPRECIATION;
      const reference = isDep ? depReference(period) : amortReference(period);

      if (existing.has(period) && await refExistsAndNotVoided(reference)) {
        if (!replace) { skipped.push({ period, kind, reason: 'already posted' }); continue; }
        await deleteJournalByReference(reference);
        replaced.push({ period, kind });
      }

      await postOneMonthKind({ period, amount, kind, userId });
      posted.push({ period, kind, amount });
      byKind[kind].posted += 1;
      byKind[kind].total  += amount;
      total += amount;
    }
  }

  // Throw only when the caller explicitly asked to REPLACE and every
  // (year, kind) they targeted was locked. `replace=false` runs on a
  // locked-only range stay silent (all-existing / all-locked have no
  // useful work anyway); `replace=true` on a mixed range still posts
  // the unlocked side and returns cpaSkipped for the locked side.
  if (replace && posted.length === 0 && replaced.length === 0 && cpaSkipped.length > 0) {
    const pairs = [];
    const seen  = new Set();
    for (const s of cpaSkipped) {
      const key = `${s.year}|${s.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ year: s.year, kind: s.kind });
    }
    throw new CpaLockedError(pairs);
  }

  return { posted, skipped, replaced, cpaSkipped, total, byKind };
}

async function refExistsAndNotVoided(reference) {
  const { data } = await supabase
    .from('journal_entries')
    .select('id, status')
    .eq('reference', reference)
    .limit(1);
  const row = data?.[0];
  return !!row && row.status !== 'voided';
}
