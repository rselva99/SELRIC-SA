// Shared period-close routine. Two call sites use this today:
//   • AccountantPage's "Close Period" button
//   • CloseWizard's doFinalClose (final step of the close wizard)
// And, as of the Amazon Reclass flow, a third:
//   • AmazonReclassModal — re-close a period after posting the reclass JE
//     so the close snapshot reflects the post-reclass numbers.
//
// Closing a period is NOT just a status flip:
//   1. We compute a snapshot of the live P&L + Balance Sheet for the period
//      from posted, non-voided transactions.
//   2. We upsert period_close with status='closed' AND that snapshot, so the
//      View Snapshot modal can render a frozen point-in-time view even if
//      the live ledger is later edited.
//   3. We write an audit-log row.
//
// Any flow that writes into a closed period MUST re-close through this
// helper so the snapshot is regenerated; otherwise the snapshot drifts
// and the close stops representing what the books actually say.

import { supabase } from './supabase';
import { fetchAll } from './fetchAll';
import { aggregateForPnL, aggregateForBS } from './finance';

const MONTHS_FULL = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const PAD2 = (n) => String(n).padStart(2, '0');

function periodRange(period) {
  const [yr, mo] = (period || '').split('-');
  const y = parseInt(yr, 10);
  const m = parseInt(mo, 10);
  const lastDay = new Date(y, m, 0).getDate();
  return {
    start: `${yr}-${mo}-01`,
    end:   `${yr}-${mo}-${PAD2(lastDay)}`,
  };
}

function periodFullLabel(period) {
  if (!period) return '';
  const [yr, mo] = period.split('-');
  return `${MONTHS_FULL[parseInt(mo, 10) - 1] || mo} ${yr}`;
}

// Compute the P&L + Balance Sheet aggregations against current live data and
// freeze them as a snapshot. Stored on period_close.snapshot at close time
// so a closed period's reports read from this, not from the live ledger.
//
// Matches the shape produced by AccountantPage and CloseWizard before this
// helper was extracted. Both files now call this directly.
export async function buildPeriodSnapshot(period, categories) {
  const { start, end } = periodRange(period);
  // Paginated: single-period volume approaches 1,000 rows in busy months, and
  // PostgREST silently caps un-ranged responses at 1,000. Any snapshot
  // computed from truncated data under-reports every P&L / BS number.
  const txns = await fetchAll(
    supabase.from('transactions')
      .select('id, date, description, category, amount, type')
      .gte('date', start).lte('date', end)
      .eq('posted', true).eq('voided', false)
      .order('date', { ascending: true })
  );
  return {
    period,
    pl:            aggregateForPnL(txns || [], categories),
    balance_sheet: aggregateForBS(txns || [], categories),
    txn_count:     (txns || []).length,
    captured_at:   new Date().toISOString(),
  };
}

// Close (or re-close) a period: capture snapshot, upsert period_close row,
// write audit-log entry. Throws on the supabase upsert error; audit-log
// failures are logged but non-fatal (closing the period is the real work).
//
//   period      — 'YYYY-MM'
//   userId      — auth.uid() of the caller, stored on closed_by + approved_by
//   categories  — full categories list, used by the snapshot aggregator
//   description — optional override for the audit-log row's description
//
// Returns { snapshot, snapshotAt } so callers can stash the values they
// already computed if they need them (e.g. wizard finals page).
export async function closePeriod({ period, userId, categories, description }) {
  if (!period) throw new Error('closePeriod: period required');
  const snapshot   = await buildPeriodSnapshot(period, categories);
  const snapshotAt = new Date().toISOString();
  const { error } = await supabase.from('period_close').upsert({
    period,
    status:       'closed',
    closed_by:    userId || null,
    closed_at:    snapshotAt,
    snapshot,
    snapshot_at:  snapshotAt,
  }, { onConflict: 'period' });
  if (error) throw error;

  try {
    await supabase.from('accountant_audit_log').insert({
      action:       'close_period',
      description:  description || `Closed ${periodFullLabel(period)} (snapshot captured)`,
      period,
      performed_by: 'user',
      approved_by:  userId || null,
    });
  } catch (auditErr) {
    // Audit-log failures never block the actual close.
    console.warn('closePeriod: audit log insert failed', auditErr);
  }

  return { snapshot, snapshotAt };
}
