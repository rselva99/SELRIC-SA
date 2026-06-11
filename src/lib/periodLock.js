// Detects when a write hits a closed period. The Postgres trigger
// `public.enforce_period_lock` (see migrations/2026-06-11-period-lock-
// trigger.sql) raises 'PERIOD_LOCKED: <period> is closed...' with
// SQLSTATE 'P0001'. The helpers below normalize that error and provide
// a client-side preflight + reopen flow.

import { supabase } from './supabase';

export const PERIOD_LOCK_MARKER = 'PERIOD_LOCKED:';

export class PeriodClosedError extends Error {
  constructor(period, original) {
    super(`Period ${period} is closed. Reopen it to write.`);
    this.name      = 'PeriodClosedError';
    this.period    = period;
    this.original  = original;
  }
}

// Pull period from a YYYY-MM-DD date string.
export function periodOf(dateStr) {
  return (dateStr || '').slice(0, 7);
}

// Returns null when the period is open or has no row in period_close.
// Returns { period, status, closedAt, closedBy } when the period exists.
// Throws on any other Supabase failure.
export async function checkPeriodStatus(dateStr) {
  const period = periodOf(dateStr);
  if (!period) return null;
  const { data, error } = await supabase
    .from('period_close')
    .select('period, status, closed_at, closed_by')
    .eq('period', period)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { period, status: data.status, closedAt: data.closed_at, closedBy: data.closed_by };
}

// True when the supplied error came from our period-lock trigger.
// Postgres surfaces P0001 as `error.code === 'P0001'` AND the message
// retains the 'PERIOD_LOCKED:' prefix.
export function isPeriodLockedError(err) {
  if (!err) return false;
  const msg = err.message || err.error_description || '';
  return err.code === 'P0001' || msg.includes(PERIOD_LOCK_MARKER);
}

// Extracts the period from the trigger message ('PERIOD_LOCKED: 2024-01 is …').
export function periodFromLockedError(err) {
  const msg = err?.message || '';
  const m = msg.match(/PERIOD_LOCKED:\s*(\d{4}-\d{2})/);
  return m ? m[1] : null;
}

// Wraps a Supabase error so callers can rethrow it as PeriodClosedError
// without losing the underlying cause.
export function wrapIfPeriodLocked(err) {
  if (!isPeriodLockedError(err)) return err;
  const period = periodFromLockedError(err) || '?';
  return new PeriodClosedError(period, err);
}

// Reopens a closed period. Used by the "Reopen and post" path in the
// PeriodLockedDialog after the user explicitly confirms. Idempotent.
export async function reopenPeriod(period, userId) {
  const { error: updErr } = await supabase
    .from('period_close')
    .update({ status: 'open', closed_at: null, closed_by: null })
    .eq('period', period);
  if (updErr) throw updErr;
  // Audit trail. Best-effort — never blocks the reopen if the audit log
  // table isn't writable for this user.
  try {
    await supabase.from('accountant_audit_log').insert({
      action: 'reopen_period',
      description: `Reopened ${period} via inline period-lock prompt`,
      period,
      performed_by: 'user',
      approved_by: userId || null,
    });
  } catch { /* ignore */ }
}
