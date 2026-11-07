// Every returned item is paired with the deposit it reverses. Two sources:
// bank rows that read as a returned item (money out) with no deposit of the
// same amount in the 45 days before it, and checks flagged returned with no
// record of how the return was settled.
import { abs, addDays, creditOf, debitOf, inPeriod, isBankRow, names, result, row, skip } from '../util.js';

export const key = 'returned_unpaired';
export const severity = 'amber';
const LOOKBACK_DAYS = 45;

export function run(data, ctx = {}) {
  const N = names(ctx);
  const bank = (data.transactions || []).filter((t) => isBankRow(t) && t.voided !== true);
  const returned = bank.filter((t) => debitOf(t) > 0 && N.returnedItem.test(`${t.description || ''} ${t.supplier || ''}`));
  const flagged = (data.checks || []).filter((c) => c.returned_flag === true);
  if (!returned.length && !flagged.length) return skip('no_returned_items');

  // Deposits by amount in cents; each deposit pairs with one return at most.
  const deposits = new Map();
  for (const t of bank) {
    if (creditOf(t) <= 0) continue;
    const k = Math.round(creditOf(t) * 100);
    (deposits.get(k) || deposits.set(k, []).get(k)).push(t);
  }
  const used = new Set();
  const rows = [];
  for (const t of [...returned].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const from = addDays(t.date, -LOOKBACK_DAYS);
    const match = (deposits.get(Math.round(debitOf(t) * 100)) || []).find((d) => !used.has(d.id) && d.date >= from && d.date <= t.date);
    if (match) { used.add(match.id); continue; }
    if (inPeriod(t.date, ctx.period)) rows.push(row(t.id, t.date, t.description || t.supplier || 'returned item', debitOf(t), { kind: 'bank' }));
  }
  for (const c of flagged) {
    if (String(c.return_source || '').trim() || !inPeriod(c.returned_date || c.clear_date, ctx.period)) continue;
    rows.push(row(c.id, c.returned_date || c.clear_date, `returned check ${c.check_no || '—'} · ${c.payee || ''}`, abs(c.returned_amount ?? c.amount), { kind: 'check' }));
  }
  return result(severity, { rows });
}
