// Shared by the sales-tax and tips checks: a pass-through liability (money
// collected for someone else) should be paid out about as fast as it comes
// in. At the end of each month the balance owed should be no more than
// `window` times that month's collections — a whole month for sales tax
// (filed the month after), half a month for tips (paid with each payroll).
// Anything above that is money held back — the arrears.
// The month `today` is in has not ended, so last month's payment may still
// be on its way: it is shown but never counted late.
import { creditOf, debitOf, monthOf, monthsBetween, round2 } from '../util.js';

export const ARREARS_TOLERANCE = 0.10;

export function payableMonths(rows, { tolerance = ARREARS_TOLERANCE, today = null, window = 1 } = {}) {
  const current = monthOf(today);
  const live = rows.filter((t) => t.date);
  if (!live.length) return [];
  const by = new Map();
  for (const t of live) {
    const m = monthOf(t.date);
    const s = by.get(m) || { collected: 0, paid: 0 };
    s.collected += creditOf(t); s.paid += debitOf(t);
    by.set(m, s);
  }
  const keys = [...by.keys()].sort();
  let balance = 0;
  return monthsBetween(keys[0], keys[keys.length - 1]).map((month) => {
    const s = by.get(month) || { collected: 0, paid: 0 };
    balance += s.collected - s.paid;
    const arrears = balance - window * s.collected;
    const allowed = Math.max(1, tolerance * s.collected);
    return { month, collected: round2(s.collected), paid: round2(s.paid), owed: round2(balance), arrears: round2(arrears), late: month !== current && arrears > allowed };
  });
}
