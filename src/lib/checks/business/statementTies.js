// Each imported statement ties to its printed ending balance: the printed
// beginning balance, plus the deposits and minus the withdrawals imported
// from it, gives the printed ending balance to the cent. A statement whose
// summary was not extracted cannot be checked and is counted apart.
import { abs, creditOf, debitOf, inPeriod, isMirror, result, round2, row, skip } from '../util.js';

export const key = 'statement_ties';
export const severity = 'red';
const TOLERANCE = 0.01;

const num = (v) => (v == null || v === '' ? null : Number(v));

export function run(data, ctx = {}) {
  const statements = (data.statements || []).filter((s) => inPeriod(s.period_end || s.period_start, ctx.period));
  if (!statements.length) return skip('no_statements');
  const byStatement = new Map();
  for (const t of data.transactions || []) {
    if (!t.bank_statement_id || isMirror(t) || t.voided === true) continue;
    const s = byStatement.get(t.bank_statement_id) || { dr: 0, cr: 0, n: 0 };
    s.dr += debitOf(t); s.cr += creditOf(t); s.n += 1;
    byStatement.set(t.bank_statement_id, s);
  }
  const rows = [];
  let unchecked = 0;
  for (const s of statements) {
    const totals = s.statement_totals || {};
    const beg = num(totals.beginning_balance), end = num(totals.ending_balance);
    if (beg == null || end == null) { unchecked++; continue; }
    const m = byStatement.get(s.id) || { dr: 0, cr: 0, n: 0 };
    const implied = beg + m.cr - m.dr;
    const drift = round2(end - implied);
    if (abs(drift) > TOLERANCE) {
      rows.push(row(s.id, s.period_end || s.period_start, `${s.file_name || s.period || 'statement'} · ${m.n} rows`, drift, { printed: end, implied: round2(implied) }));
    }
  }
  if (unchecked === statements.length) return skip('no_statement_totals');
  return result(severity, { rows, unchecked, checked: statements.length - unchecked });
}
