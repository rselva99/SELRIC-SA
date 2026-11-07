// Shared pieces of the checks engine. Every check is a pure function over one
// workspace's rows (see ./fetch.js for what `data` holds) and returns
// { status, amount, count, detail }:
//   status  'green' when nothing is wrong, else the check's severity
//   amount  the money involved in what is wrong, as a positive number
//   count   how many things are wrong (rows, months, pairs — the check says)
//   detail  { rows: [{ id, date, text, amount }], total, skipped?, … }
//           rows are the drill-down list, capped at MAX_ROWS; total is the
//           full count before the cap. `skipped` says why nothing was checked
//           (no data of that kind), so "green" never pretends to be a pass.
import { debitOf, creditOf } from '../finance.js';

export const MAX_ROWS = 50;
export const CENT = 0.005;

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const abs = (n) => Math.abs(Number(n) || 0);
export const sum = (xs, f = (x) => x) => xs.reduce((s, x) => s + (Number(f(x)) || 0), 0);

export const monthOf = (date) => (date ? String(date).slice(0, 7) : null);
// Is a date inside the run's period? 'all' (or nothing) means every date.
export const inPeriod = (date, period) => !period || period === 'all' || monthOf(date) === period;
export const daysBetween = (a, b) => Math.round((Date.parse(String(b).slice(0, 10)) - Date.parse(String(a).slice(0, 10))) / 86400000);
export const addDays = (date, n) => new Date(Date.parse(String(date).slice(0, 10)) + n * 86400000).toISOString().slice(0, 10);
export const endOfMonth = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const nextMonth = (month) => { const [y, m] = month.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
// Every month from a to b inclusive ('YYYY-MM').
export function monthsBetween(a, b) {
  const out = [];
  for (let m = a; m <= b && out.length < 600; m = nextMonth(m)) out.push(m);
  return out;
}

// The accounts the checks look for, by name. A workspace names its chart of
// accounts its own way, so these are patterns, overridable through
// ctx.names. The cash account is the one the cash-leg trigger uses.
export const DEFAULT_NAMES = {
  cash: /^cash\s*&\s*bank$/i,
  merchantClearing: /merchant\s+clearing/i,
  salesTax: /sales\s+tax\s+payable/i,
  tips: /tips?\s+payable/i,
  accrual: /accounts\s+payable|accrued/i,
  loan: /loan|note\s+payable|line\s+of\s+credit/i,
  unknownDeposit: /uncategori[sz]ed|unknown|unidentified|ask\s+my\s+accountant|suspense/i,
  returnedItem: /return(ed)?\s+(item|deposit|check|chk)|\bnsf\b|chargeback|deposited\s+item\s+returned/i,
};
export const names = (ctx) => ({ ...DEFAULT_NAMES, ...(ctx?.names || {}) });

export const typeMap = (categories) => new Map((categories || []).map((c) => [c.name, String(c.type || '').toLowerCase()]));
export const isMirror = (t) => typeof t.reference === 'string' && t.reference.startsWith('CASH-LEG-');
export const isLive = (t) => t && t.voided !== true;
export const isBankRow = (t) => !!t.bank_statement_id && !isMirror(t);
export { debitOf, creditOf };

// One drill-down row. `text` is what a person reads; `amount` is signed as
// the check wants it shown.
/** @returns {{ id: any, date: string | null, text: string, amount: number, [k: string]: any }} */
export const row = (id, date, text, amount, extra = {}) => ({ id, date: date || null, text: String(text || '').slice(0, 140), amount: round2(amount || 0), ...extra });

// The result a check returns. Issues decide the status; the rows are sorted
// by size so the cap keeps the ones that matter most.
/** @typedef {{ status: string, amount: number, count: number, detail: { rows: any[], total: number, skipped?: string, [k: string]: any } }} CheckResult */
/**
 * @param {string} severity
 * @param {{ rows?: any[], amount?: number, count?: number, skipped?: string, [k: string]: any }} [found]
 * @returns {CheckResult}
 */
export function result(severity, { rows = [], amount, count, skipped, ...more } = {}) {
  const sorted = [...rows].sort((a, b) => abs(b.amount) - abs(a.amount));
  const n = count ?? rows.length;
  return {
    status: n > 0 ? severity : 'green',
    amount: round2(amount ?? sum(rows, (r) => abs(r.amount))),
    count: n,
    detail: { rows: sorted.slice(0, MAX_ROWS), total: rows.length, ...(skipped ? { skipped } : {}), ...more },
  };
}
/** @returns {CheckResult} */
export const skip = (reason) => ({ status: 'green', amount: 0, count: 0, detail: { rows: [], total: 0, skipped: reason } });

// Rows of the transactions ledger that move a category, live and in period.
export const onCategory = (data, pattern, period) =>
  (data.transactions || []).filter((t) => isLive(t) && t.category && pattern.test(t.category) && inPeriod(t.date, period));
