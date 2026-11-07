// Tips collected vs paid: card tips are owed to the staff and go out with
// each payroll, so the Tips Payable balance at a month end should be no more
// than half that month's tips (what came in since the last pay date).
import { inPeriod, names, onCategory, result, row, skip } from '../util.js';
import { payableMonths } from './payableKeptCurrent.js';

export const key = 'tips';
export const severity = 'amber';
export const WINDOW = 0.5;

export function run(data, ctx = {}) {
  const months = payableMonths(onCategory(data, names(ctx).tips, null), { tolerance: ctx.arrearsTolerance, today: ctx.today, window: ctx.tipsWindow ?? WINDOW });
  if (!months.length) return skip('no_tips');
  const scope = months.filter((m) => inPeriod(`${m.month}-01`, ctx.period));
  const late = scope.filter((m) => m.late);
  const last = scope[scope.length - 1];
  const rows = late.map((m) => row(m.month, `${m.month}-01`, `${m.month} · collected ${m.collected.toFixed(2)} · paid ${m.paid.toFixed(2)} · owed ${m.owed.toFixed(2)}`, m.arrears));
  return result(severity, { rows, amount: last && last.late ? last.arrears : late.reduce((s, m) => Math.max(s, m.arrears), 0), months: scope });
}
