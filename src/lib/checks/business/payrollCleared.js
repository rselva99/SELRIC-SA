// Payroll register vs cleared paychecks: every paycheck on the register more
// than 30 days old has been matched to a cleared check or a transfer. Lines
// marked unmatched or "no disbursement" are listed with that state.
import { abs, addDays, inPeriod, result, row, skip } from '../util.js';

export const key = 'payroll_cleared';
export const severity = 'amber';
export const GRACE_DAYS = 30;
const OPEN = new Set(['unmatched', 'no_disbursement', 'needs_matching']);

export function run(data, ctx = {}) {
  const lines = (data.payrollLines || []).filter((l) => (Number(l.net_pay) || 0) > 0 && inPeriod(l.pay_date, ctx.period));
  if (!lines.length) return skip('no_payroll_register');
  const cutoff = addDays(ctx.today || new Date().toISOString().slice(0, 10), -(ctx.payrollGraceDays ?? GRACE_DAYS));
  const rows = lines
    .filter((l) => l.pay_date && l.pay_date <= cutoff && !l.matched_check_id && !l.matched_transaction_id && (!l.match_status || OPEN.has(l.match_status)))
    .map((l) => row(l.id, l.pay_date, `${l.pay_month || ''} paycheck · ${l.match_status || 'unmatched'}`, abs(l.net_pay), { state: l.match_status || 'unmatched' }));
  return result(severity, { rows });
}
