// Merchant clearing is within ±2% of card sales, month by month. Card sales
// land in the clearing account as debits from the sales entries; the
// processor's deposits and fees take them out as credits. What is left at
// the end of a month — the residual — should be small next to that month's
// card sales: settlement timing, not missing deposits or unbooked fees.
import { abs, creditOf, debitOf, monthOf, names, onCategory, result, round2, row, skip } from '../util.js';

export const key = 'merchant_clearing';
export const severity = 'red';
export const TOLERANCE = 0.02;

export function run(data, ctx = {}) {
  const N = names(ctx);
  const tol = ctx.merchantTolerance ?? TOLERANCE;
  const mc = onCategory(data, N.merchantClearing, ctx.period);
  if (!mc.length) return skip('no_merchant_clearing');
  const byMonth = new Map();
  for (const t of mc) {
    const m = monthOf(t.date);
    const s = byMonth.get(m) || { cardSales: 0, residual: 0 };
    if (!t.bank_statement_id) s.cardSales += debitOf(t);
    s.residual += debitOf(t) - creditOf(t);
    byMonth.set(m, s);
  }
  const months = [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, s]) => ({
    month, cardSales: round2(s.cardSales), residual: round2(s.residual),
    share: s.cardSales > 0 ? s.residual / s.cardSales : null,
  }));
  const off = months.filter((m) => (m.cardSales > 0 ? abs(m.residual) > tol * m.cardSales : abs(m.residual) > 1));
  const rows = off.map((m) => row(m.month, `${m.month}-01`, `${m.month} · card sales ${m.cardSales.toFixed(2)}${m.share == null ? '' : ` · ${(m.share * 100).toFixed(1)}%`}`, m.residual));
  return result(severity, { rows, months, tolerance: tol });
}
