// scripts/test-pagination-stability.js
//
// Regression test for the ReportsPage-style silent pagination-corruption bug
// (see ~/Documents/SELRIC-ALARM-NI-DRIFT.md, Jul 12 2026).
//
// The bug: `.order('date').range(...)` with a non-unique sort key drops some
// rows and duplicates others across page boundaries. Row COUNT often matches
// ground truth (dups ≈ misses) so nothing looks wrong at first glance — the
// per-category sums silently disagree.
//
// This test runs THREE fetches against LIVE Supabase and asserts they agree:
//
//   A) BUGGY reference implementation — `.order('date').range(...)`, no
//      tiebreaker. This is the pre-fix ReportsPage code, copied verbatim, so
//      the test can DEMONSTRATE the bug on the live data.
//   B) FIXED via helper — `fetchAll(...)` from src/lib/fetchAll.js (mirrored
//      in scripts/_dbClient.mjs). This is the code path every UI page uses
//      after Task 2.
//   C) FIXED explicit — same shape as A but with `.order('id')` appended as
//      a tiebreaker. Sanity check that the fix in ReportsPage:63 works when
//      applied directly.
//
// The test asserts:
//   1. B and C both return the SAME row-id set as the ground-truth
//      posted+non-void set from a large unpaginated query (batched via
//      _dbClient.mjs fetchAll, which now has its own tiebreaker).
//   2. B and C's per-category expense sums equal ground truth.
//   3. If A returns row-set equal to B/C, log SKIP (dataset too small to
//      demonstrate the bug). Otherwise assert A is DIFFERENT — that's the
//      regression proof (must FAIL vs A pre-fix and PASS via B/C).
//
// Runs on: LIVE database. Read-only. Writes nothing.

import { supabase, fetchAll } from './_dbClient.mjs';

const YEAR = 2024;
const START = `${YEAR}-01-01`;
const END   = `${YEAR}-12-31`;
const FETCH_BATCH = 1000;

console.log(`Pagination-stability regression test — FY${YEAR}`);
console.log('Runs on LIVE DB (read-only).');
console.log('');

// --- Ground truth: id + category + type + amount + date + reference ----------
// fetchAll now enforces .order('id') internally, so this is stable.
const truth = await fetchAll(
  supabase.from('transactions')
    .select('id, date, amount, type, category, posted, voided, reference')
    .eq('posted', true).eq('voided', false)
);
console.log(`Ground truth (posted, non-void, all-time): ${truth.length} rows`);

// FY2024 subset used by A/B/C.
const truthYear = truth.filter(t => t.date >= START && t.date <= END);
console.log(`Ground truth FY${YEAR}: ${truthYear.length} rows`);
console.log('');

// Category type map — for per-category sums.
const cats = await fetchAll(supabase.from('categories').select('name, type'));
const catType = new Map(cats.map(c => [c.name, c.type]));

function sumsByCategory(rows) {
  const m = new Map();
  for (const r of rows) {
    const kind = catType.get(r.category);
    if (kind !== 'expense' && kind !== 'revenue') continue;
    const abs = Math.abs(Number(r.amount) || 0);
    // expense: dr adds, cr subtracts; revenue: cr adds, dr subtracts.
    const delta = kind === 'expense'
      ? (r.type === 'debit' ? abs : -abs)
      : (r.type === 'credit' ? abs : -abs);
    m.set(r.category, (m.get(r.category) || 0) + delta);
  }
  return m;
}

const truthSums = sumsByCategory(truthYear);
const truthIds  = new Set(truthYear.map(r => r.id));

// --- Method A: BUGGY (pre-fix ReportsPage code, no tiebreaker) ---------------
async function fetchMethodA() {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, date, amount, type, category, posted, voided, reference')
      .gte('date', START).lte('date', END).eq('voided', false)
      .order('date', { ascending: true })   // ← THE BUG — no unique tiebreaker
      .range(from, from + FETCH_BATCH - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < FETCH_BATCH) break;
    from += FETCH_BATCH;
  }
  return out.filter(t => t.posted);
}

// --- Method B: fetchAll helper (which now enforces .order('id') internally) --
async function fetchMethodB() {
  return fetchAll(
    supabase.from('transactions')
      .select('id, date, amount, type, category, posted, voided, reference')
      .gte('date', START).lte('date', END).eq('voided', false)
      .order('date', { ascending: true })
  ).then(rows => rows.filter(t => t.posted));
}

// --- Method C: explicit tiebreaker (post-fix ReportsPage:63 shape) -----------
async function fetchMethodC() {
  const out = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, date, amount, type, category, posted, voided, reference')
      .gte('date', START).lte('date', END).eq('voided', false)
      .order('date', { ascending: true })
      .order('id',   { ascending: true })   // ← THE FIX
      .range(from, from + FETCH_BATCH - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < FETCH_BATCH) break;
    from += FETCH_BATCH;
  }
  return out.filter(t => t.posted);
}

// --- Run --------------------------------------------------------------------
const [A, B, C] = await Promise.all([fetchMethodA(), fetchMethodB(), fetchMethodC()]);
console.log(`Method A (BUGGY, date-only order):    ${A.length} rows`);
console.log(`Method B (fetchAll — helper fix):     ${B.length} rows`);
console.log(`Method C (explicit tiebreaker):       ${C.length} rows`);
console.log(`Ground truth FY${YEAR}:                    ${truthYear.length} rows`);
console.log('');

function assertMatchesTruth(name, rows) {
  const distinct = new Set(rows.map(r => r.id));
  const dupCount = rows.length - distinct.size;
  const missing  = [...truthIds].filter(id => !distinct.has(id));
  const extra    = [...distinct].filter(id => !truthIds.has(id));
  const sums     = sumsByCategory(rows);

  const idSetEqual = missing.length === 0 && extra.length === 0 && dupCount === 0;
  let sumsEqual = true;
  const sumDiffs = [];
  for (const [cat, v] of truthSums) {
    const d = (sums.get(cat) || 0) - v;
    if (Math.abs(d) > 0.005) { sumsEqual = false; sumDiffs.push([cat, d]); }
  }
  for (const [cat, v] of sums) {
    if (!truthSums.has(cat)) { sumsEqual = false; sumDiffs.push([cat, v]); }
  }
  return { name, rows: rows.length, distinct: distinct.size, dupCount, missing: missing.length, extra: extra.length, idSetEqual, sumsEqual, sumDiffs };
}

const results = [assertMatchesTruth('A (buggy)', A), assertMatchesTruth('B (fetchAll)', B), assertMatchesTruth('C (explicit)', C)];

let failed = 0;
for (const r of results) {
  const idFlag  = r.idSetEqual  ? 'PASS' : 'FAIL';
  const sumFlag = r.sumsEqual   ? 'PASS' : 'FAIL';
  console.log(`  ${r.name.padEnd(20)}  id-set:${idFlag}   per-cat-sums:${sumFlag}   rows=${r.rows} distinct=${r.distinct} dups=${r.dupCount} missing=${r.missing} extra=${r.extra}`);
  if (r.sumDiffs.length && r.name.startsWith('A')) {
    // For the buggy method, print the divergences that demonstrate the bug.
    console.log(`    (per-category divergence — the silent-corruption evidence):`);
    for (const [c, d] of r.sumDiffs.slice(0, 10)) console.log(`       ${c.padEnd(30)}  Δ = ${d.toFixed(2)}`);
  }
}
console.log('');

// --- Assertions -------------------------------------------------------------
// B (helper) and C (explicit) MUST both match ground truth.
if (!results[1].idSetEqual || !results[1].sumsEqual) {
  console.error('❌ FAIL: Method B (fetchAll helper) does not match ground truth.');
  failed++;
}
if (!results[2].idSetEqual || !results[2].sumsEqual) {
  console.error('❌ FAIL: Method C (explicit .order(id) tiebreaker) does not match ground truth.');
  failed++;
}

// A (buggy) SHOULD diverge (that's the demo). If A happens to match on this
// dataset — meaning no rows straddle a page boundary — SKIP with a message.
if (results[0].idSetEqual && results[0].sumsEqual) {
  console.warn('⚠ SKIP: Method A (buggy) happened to match ground truth on this dataset. Dataset likely too small (<1000 rows) or no rows straddle the 1000-boundary. The bug is not demonstrable RIGHT NOW, but the fix is still verified via B and C above.');
} else {
  console.log('✓ Method A (buggy) DIVERGES from ground truth — pagination bug demonstrated on live data.');
  console.log(`  A missing ${results[0].missing} row(s), A extra ${results[0].extra} row(s), A dup ${results[0].dupCount} row(s).`);
  console.log('  (Post-fix, ReportsPage.jsx no longer uses this shape. B and C use the fix.)');
}

console.log('');
if (failed === 0) {
  console.log('✓ All fix-path assertions PASS.');
  process.exit(0);
} else {
  console.log(`✗ ${failed} fix-path assertion(s) FAILED. Do not deploy.`);
  process.exit(1);
}
