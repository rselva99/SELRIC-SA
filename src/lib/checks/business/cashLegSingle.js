// Every bank-imported expense row has exactly one cash leg — the mirror row
// the transactions_ensure_cash_leg trigger writes (reference CASH-LEG-<id>,
// category Cash & Bank, the opposite direction). The rule for which rows need
// one is the trigger's own: posted, not voided, from a statement, an expense
// category other than Cash & Bank. Rows booked before the per-row mirrors
// were covered in batches tagged CASH-LEG-2024 / CASH-LEG-REFUND-2024; those
// count once per matching statement, date, amount and opposite direction.
import { abs, inPeriod, isMirror, names, result, row, skip, typeMap } from '../util.js';

export const key = 'cash_leg_single';
export const severity = 'red';

const LEGACY = new Set(['CASH-LEG-2024', 'CASH-LEG-REFUND-2024']);
const flip = (type) => (type === 'debit' ? 'credit' : 'debit');

export function run(data, ctx = {}) {
  const N = names(ctx);
  const typeOf = typeMap(data.categories);
  const tx = (data.transactions || []);
  const needs = (t) => t.posted === true && t.voided !== true && t.bank_statement_id && (t.type === 'debit' || t.type === 'credit')
    && t.category && !N.cash.test(t.category) && t.amount != null && typeOf.get(t.category) === 'expense' && !isMirror(t);
  const sources = tx.filter(needs);
  if (!sources.length) return skip('no_bank_expenses');

  const legs = new Map();
  const legacy = new Map();
  for (const t of tx) {
    if (!isMirror(t) || t.voided === true) continue;
    if (LEGACY.has(t.reference)) {
      const k = `${t.bank_statement_id}|${t.date}|${Number(t.amount)}|${t.type}`;
      legacy.set(k, (legacy.get(k) || 0) + 1);
    } else {
      legs.set(t.reference, (legs.get(t.reference) || 0) + 1);
    }
  }
  const rows = [];
  for (const t of sources) {
    let n = legs.get(`CASH-LEG-${t.id}`) || 0;
    if (n === 0) {
      const k = `${t.bank_statement_id}|${t.date}|${Number(t.amount)}|${flip(t.type)}`;
      if ((legacy.get(k) || 0) > 0) { legacy.set(k, legacy.get(k) - 1); n = 1; }
    }
    if (n !== 1 && inPeriod(t.date, ctx.period)) {
      rows.push(row(t.id, t.date, t.description || t.supplier || t.category, abs(t.amount), { legs: n }));
    }
  }
  return result(severity, { rows, missing: rows.filter((r) => r.legs === 0).length, extra: rows.filter((r) => r.legs > 1).length });
}
