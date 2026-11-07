// Duplicate candidates: two live rows of the ledger in the same category and
// direction, within $0.50 and 15 days of each other, that came from different
// sources (two statements, or a statement and a journal or manual entry).
// The same payment booked twice is the usual reason; a pair is a candidate,
// not a verdict, so this check is amber.
import { abs, daysBetween, inPeriod, isMirror, result, round2, row, skip } from '../util.js';

export const key = 'duplicate_candidates';
export const severity = 'amber';
export const AMOUNT_WINDOW = 0.5;
export const DAY_WINDOW = 15;

const sourceOf = (t) => (t.bank_statement_id ? `statement:${t.bank_statement_id}` : t.journal_entry_id ? `journal:${t.journal_entry_id}` : 'manual');

export function run(data, ctx = {}) {
  const tx = (data.transactions || []).filter((t) => t.voided !== true && !isMirror(t) && abs(t.amount) > 0 && t.date);
  if (!tx.length) return skip('no_transactions');
  const amountWin = ctx.duplicateAmount ?? AMOUNT_WINDOW, dayWin = ctx.duplicateDays ?? DAY_WINDOW;
  const sorted = [...tx].sort((a, b) => abs(a.amount) - abs(b.amount));
  const seen = new Set();
  const rows = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length && abs(sorted[j].amount) - abs(a.amount) <= amountWin; j++) {
      const b = sorted[j];
      if (a.type !== b.type || (a.category || '') !== (b.category || '')) continue;
      const sa = sourceOf(a), sb = sourceOf(b);
      if (sa === sb || (sa.startsWith('journal:') && sb.startsWith('journal:'))) continue;
      if (Math.abs(daysBetween(a.date, b.date)) > dayWin) continue;
      const [first, second] = a.date <= b.date ? [a, b] : [b, a];
      if (seen.has(second.id) || !inPeriod(second.date, ctx.period)) continue;
      seen.add(second.id);
      rows.push(row(second.id, second.date, `${second.description || second.category || ''} ↔ ${first.date} ${first.description || ''}`, abs(second.amount), { pair: first.id, gap: round2(abs(second.amount) - abs(first.amount)) }));
    }
  }
  return result(severity, { rows });
}
