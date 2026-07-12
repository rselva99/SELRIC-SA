// Phase 2 — quantify how much the currently-stored period_close snapshots
// under-report because they were computed by an un-paginated fetch.
//
// Read-only: does NOT refresh or re-close any period.

import { supabase, fetchAll } from './_dbClient.mjs';

const closes = await fetchAll(
  supabase.from('period_close').select('period, status, snapshot, snapshot_at')
    .order('period')
);

const cats = await fetchAll(supabase.from('categories').select('*'));

// Minimal port of aggregateForPnL so we can recompute net income from a
// paginated fetch. Uses the same category-type table (asset/liability/
// equity/revenue/expense) and sign rules as src/lib/finance.js.

const debitOf  = (t) => (t?.type === 'debit'  ? Math.abs(Number(t.amount) || 0) : 0);
const creditOf = (t) => (t?.type === 'credit' ? Math.abs(Number(t.amount) || 0) : 0);

function aggregateForPnL(txns, categories) {
  const typeByName = new Map();
  for (const c of categories) typeByName.set(c.name, c.type);
  const revenueByCat = {};
  const expenseByCat = {};
  for (const t of txns) {
    const cat = (t.category || '').trim();
    if (!cat) continue;
    const kind = typeByName.get(cat);
    if (kind === 'revenue' || kind === 'income') {
      revenueByCat[cat] = (revenueByCat[cat] || 0) + (creditOf(t) - debitOf(t));
    } else if (kind === 'expense') {
      expenseByCat[cat] = (expenseByCat[cat] || 0) + (debitOf(t) - creditOf(t));
    }
  }
  const totalRevenue  = Object.values(revenueByCat).reduce((s, v) => s + v, 0);
  const totalExpenses = Object.values(expenseByCat).reduce((s, v) => s + v, 0);
  return { totalRevenue, totalExpenses, netIncome: totalRevenue - totalExpenses };
}

function periodRange(period) {
  const [yr, mo] = period.split('-');
  const y = parseInt(yr, 10);
  const m = parseInt(mo, 10);
  const last = new Date(y, m, 0).getDate();
  return {
    start: `${yr}-${mo}-01`,
    end:   `${yr}-${mo}-${String(last).padStart(2, '0')}`,
  };
}

console.log(`period_close rows found: ${closes.length}\n`);

const w = (s, n) => (s + ' '.repeat(n)).slice(0, n);
const wr = (s, n) => (' '.repeat(n) + s).slice(-n);

console.log(
  `${w('PERIOD', 8)}  ${wr('SNAP_TXN', 10)}  ${wr('LIVE_TXN', 10)}  TRUNC?  ${wr('SNAP_REV', 14)}  ${wr('LIVE_REV', 14)}  ${wr('SNAP_EXP', 14)}  ${wr('LIVE_EXP', 14)}  ${wr('SNAP_NI', 14)}  ${wr('LIVE_NI', 14)}  ${wr('NI_DELTA', 14)}`
);
console.log(''.padEnd(190, '-'));

const results = [];
for (const c of closes) {
  const { start, end } = periodRange(c.period);
  const live = await fetchAll(
    supabase
      .from('transactions')
      .select('id, date, description, category, amount, type')
      .gte('date', start).lte('date', end)
      .eq('posted', true).eq('voided', false)
      .order('date', { ascending: true })
  );
  const snap = c.snapshot || {};
  const snapTxn = snap.txn_count ?? null;
  const liveTxn = live.length;
  const truncated = snapTxn != null && snapTxn >= 1000;

  const snapRev = snap.pl?.totalRevenue ?? 0;
  const snapExp = snap.pl?.totalExpenses ?? 0;
  const snapNI  = snapRev - snapExp;

  const liveAgg = aggregateForPnL(live, cats);

  const niDelta = liveAgg.netIncome - snapNI;
  results.push({ period: c.period, snapTxn, liveTxn, truncated, snapNI, liveNI: liveAgg.netIncome, niDelta });

  console.log(
    `${w(c.period, 8)}  ${wr(String(snapTxn), 10)}  ${wr(String(liveTxn), 10)}  ${wr(truncated ? 'YES' : 'no', 6)}  ${wr(snapRev.toFixed(2), 14)}  ${wr(liveAgg.totalRevenue.toFixed(2), 14)}  ${wr(snapExp.toFixed(2), 14)}  ${wr(liveAgg.totalExpenses.toFixed(2), 14)}  ${wr(snapNI.toFixed(2), 14)}  ${wr(liveAgg.netIncome.toFixed(2), 14)}  ${wr(niDelta.toFixed(2), 14)}`
  );
}

const totalDelta = results.reduce((s, r) => s + r.niDelta, 0);
const truncCount = results.filter((r) => r.truncated).length;
const anyDelta = results.filter((r) => Math.abs(r.niDelta) > 0.005);
console.log(`\nTotals across ${results.length} periods:`);
console.log(`  Periods whose stored snapshot txn_count >= 1000 (obvious truncation): ${truncCount}`);
console.log(`  Periods where recomputed NI differs from stored NI by > $0.005:       ${anyDelta.length}`);
console.log(`  Sum of live_NI − snapshot_NI across all 12 periods:                   ${totalDelta.toFixed(2)}`);
