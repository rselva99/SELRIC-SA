// Sales tax collected vs remitted: the Sales Tax Payable balance at each
// month end should be about one month of collections. More than that means
// a month's tax was not paid (or not booked as paid).
import { inPeriod, names, onCategory, result, row, skip } from '../util.js';
import { payableMonths } from './payableKeptCurrent.js';

export const key = 'sales_tax';
export const severity = 'amber';

export function run(data, ctx = {}) {
  const months = payableMonths(onCategory(data, names(ctx).salesTax, null), { tolerance: ctx.arrearsTolerance, today: ctx.today });
  if (!months.length) return skip('no_sales_tax');
  const scope = months.filter((m) => inPeriod(`${m.month}-01`, ctx.period));
  const late = scope.filter((m) => m.late);
  const last = scope[scope.length - 1];
  const rows = late.map((m) => row(m.month, `${m.month}-01`, `${m.month} · collected ${m.collected.toFixed(2)} · paid ${m.paid.toFixed(2)} · owed ${m.owed.toFixed(2)}`, m.arrears));
  return result(severity, { rows, amount: last && last.late ? last.arrears : late.reduce((s, m) => Math.max(s, m.arrears), 0), months: scope });
}
