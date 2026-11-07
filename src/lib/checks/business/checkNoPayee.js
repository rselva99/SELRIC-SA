// Every cleared check has a payee. A check with no payee cannot be
// classified, so its money sits in a clearing or unclassified account.
import { abs, inPeriod, result, row, skip } from '../util.js';

export const key = 'check_no_payee';
export const severity = 'amber';
const IGNORED = new Set(['voided', 'excluded']);

export function run(data, ctx = {}) {
  const checks = (data.checks || []).filter((c) => !IGNORED.has(c.status) && inPeriod(c.clear_date, ctx.period));
  if (!checks.length) return skip('no_checks');
  const rows = checks
    .filter((c) => !String(c.payee || '').trim())
    .map((c) => row(c.id, c.clear_date, `check ${c.check_no || '—'}`, abs(c.amount)));
  return result(severity, { rows });
}
