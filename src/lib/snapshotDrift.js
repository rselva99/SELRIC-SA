// Detects when a closed-period snapshot has drifted from live ledger
// data. The snapshot is written at close time (see migrations/
// 2026-06-11-period-close-snapshot.sql) and stays put through reopens;
// once the books move under it (an edit during a brief reopen, a
// reconciliation tweak, etc.), the snapshot's totals stop matching
// what aggregateForPnL produces against live data.
//
// Cheap by design: pulls only the columns the aggregator needs for
// the requested period, and runs only when an explicitly closed
// period is loaded. Not run for the other 11 chips on the year grid.

import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { aggregateForPnL } from './finance';

const TOLERANCE = 0.01; // dollars

// Live vs. snapshot comparison for one period. Returns:
//   { kind: 'no-snapshot' }   — closed period has no snapshot captured
//   { kind: 'verified', live, snap, snapshotAt }  — totals within tolerance
//   { kind: 'stale', revDelta, expDelta, largestDelta, live, snap, snapshotAt }
//
// largestDelta.account names the single category whose live − snapshot
// difference has the largest magnitude (e.g. "Payroll" with -1781.30
// means live payroll is $1,781.30 lower than the snapshot's payroll).
export async function computeSnapshotDrift({ periodStart, periodEnd, categories, snapshot, snapshotAt }) {
  if (!snapshot?.pl) return { kind: 'no-snapshot' };

  // Paginated: monthly volume can exceed the 1,000-row cap. Under-fetching
  // here would show "drift" that is really just missing rows on the live side.
  const txns = await fetchAll(
    supabase
      .from('transactions')
      .select('id, date, category, amount, type')
      .gte('date', periodStart).lte('date', periodEnd)
      .eq('posted', true).eq('voided', false)
      .order('date', { ascending: true })
  );

  const live = aggregateForPnL(txns || [], categories);
  const snap = snapshot.pl;

  const revDelta = (live.totalRevenue  || 0) - (snap.totalRevenue  || 0);
  const expDelta = (live.totalExpenses || 0) - (snap.totalExpenses || 0);

  // Per-category drift, biggest |delta| wins. Run across BOTH revenue
  // and expense buckets — drift can hide on either side.
  const buckets = [
    ['revenue',  snap.revenue,  live.revenue],
    ['expenses', snap.expenses, live.expenses],
  ];
  let largestDelta = { account: null, side: null, amount: 0 };
  for (const [side, snapRows, liveRows] of buckets) {
    const snapMap = new Map((snapRows || []).map(r => [r.account, r.amount]));
    const liveMap = new Map((liveRows || []).map(r => [r.account, r.amount]));
    const accounts = new Set([...snapMap.keys(), ...liveMap.keys()]);
    for (const acct of accounts) {
      const d = (liveMap.get(acct) || 0) - (snapMap.get(acct) || 0);
      if (Math.abs(d) > Math.abs(largestDelta.amount)) {
        largestDelta = { account: acct, side, amount: d };
      }
    }
  }

  const stale = Math.abs(revDelta) > TOLERANCE || Math.abs(expDelta) > TOLERANCE;
  if (!stale) return { kind: 'verified', snapshotAt, live, snap };

  return {
    kind: 'stale',
    revDelta,
    expDelta,
    largestDelta,
    snapshotAt,
    live: { totalRevenue: live.totalRevenue, totalExpenses: live.totalExpenses },
    snap: { totalRevenue: snap.totalRevenue, totalExpenses: snap.totalExpenses },
  };
}
