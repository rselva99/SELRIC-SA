// Expense accrued with no cash in 90 days: on each payable account (accounts
// payable, accrued expenses) a credit is a bill booked and a debit is a
// payment. A payment of exactly a bill's amount settles that bill (the oldest
// one of that amount); any other payment settles the oldest open bills first.
// A bill still open 90 days after it was booked is listed with what remains
// unpaid on it.
import { addDays, creditOf, debitOf, inPeriod, isLive, names, result, round2, row, skip, typeMap } from '../util.js';

export const key = 'accrued_no_cash';
export const severity = 'amber';
export const AGE_DAYS = 90;

export function run(data, ctx = {}) {
  const N = names(ctx);
  const typeOf = typeMap(data.categories);
  const rows0 = (data.transactions || []).filter((t) => isLive(t) && t.category && N.accrual.test(t.category)
    && (typeOf.get(t.category) || 'liability') === 'liability' && t.date);
  if (!rows0.length) return skip('no_payables');
  const cutoff = addDays(ctx.today || new Date().toISOString().slice(0, 10), -(ctx.accrualAgeDays ?? AGE_DAYS));
  const out = [];
  const byAccount = new Map();
  for (const t of rows0) (byAccount.get(t.category) || byAccount.set(t.category, []).get(t.category)).push(t);
  for (const [account, list] of byAccount) {
    list.sort((a, b) => String(a.date).localeCompare(String(b.date)) || creditOf(b) - creditOf(a));
    const open = [];
    for (const t of list) {
      if (creditOf(t) > 0) { open.push({ t, left: creditOf(t) }); continue; }
      let pay = debitOf(t);
      const exact = open.findIndex((o) => Math.abs(o.left - pay) < 0.01);
      if (exact >= 0) { open.splice(exact, 1); continue; }
      while (pay > 0.004 && open.length) {
        const o = open[0];
        const take = Math.min(o.left, pay);
        o.left -= take; pay -= take;
        if (o.left <= 0.004) open.shift();
      }
    }
    for (const o of open) {
      if (o.t.date > cutoff || !inPeriod(o.t.date, ctx.period)) continue;
      out.push(row(o.t.id, o.t.date, `${account} · ${o.t.description || o.t.supplier || ''}`, round2(o.left)));
    }
  }
  return result(severity, { rows: out });
}
