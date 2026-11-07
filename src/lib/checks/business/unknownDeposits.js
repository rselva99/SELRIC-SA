// Unknown deposits: money that came into the bank with no category, or with
// a placeholder one (Uncategorized, Ask My Accountant, Suspense…). Until it
// has a source it can be revenue, a loan or the owner's money — three
// different tax answers.
import { creditOf, inPeriod, isBankRow, names, result, row, skip } from '../util.js';

export const key = 'unknown_deposits';
export const severity = 'amber';

export function run(data, ctx = {}) {
  const N = names(ctx);
  const deposits = (data.transactions || []).filter((t) => isBankRow(t) && t.voided !== true && creditOf(t) > 0 && inPeriod(t.date, ctx.period));
  if (!deposits.length) return skip('no_deposits');
  const rows = deposits
    .filter((t) => !String(t.category || '').trim() || N.unknownDeposit.test(t.category))
    .map((t) => row(t.id, t.date, t.description || t.supplier || 'deposit', creditOf(t), { category: t.category || null }));
  return result(severity, { rows });
}
