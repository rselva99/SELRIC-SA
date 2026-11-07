// Entries dated inside a closed period: once a month is closed, nothing new
// should carry a date in it. An entry or a ledger row created after the
// close, dated inside the closed month, changes numbers already reported.
// (The period lock trigger refuses these; anything here got past it.)
import { abs, inPeriod, isMirror, monthOf, result, row, skip, sum } from '../util.js';

export const key = 'closed_period_entries';
export const severity = 'red';

export function run(data, ctx = {}) {
  const closed = new Map((data.periodClose || []).filter((p) => p.status === 'closed' && p.closed_at).map((p) => [p.period, p.closed_at]));
  if (!closed.size) return skip('no_closed_periods');
  const late = (date, createdAt) => {
    const at = closed.get(monthOf(date));
    return at && createdAt && Date.parse(createdAt) > Date.parse(at);
  };
  const linesBy = new Map();
  for (const l of data.lines || []) (linesBy.get(l.journal_entry_id) || linesBy.set(l.journal_entry_id, []).get(l.journal_entry_id)).push(l);
  const rows = [];
  for (const e of data.entries || []) {
    if (e.status === 'voided' || !inPeriod(e.date, ctx.period) || !late(e.date, e.created_at)) continue;
    const amount = e.total_amount != null ? abs(e.total_amount) : sum(linesBy.get(e.id) || [], (l) => l.debit_amount);
    rows.push(row(e.id, e.date, `${e.reference || ''} ${e.description || ''}`.trim(), amount, { kind: 'entry', created_at: e.created_at }));
  }
  for (const t of data.transactions || []) {
    if (t.journal_entry_id || isMirror(t) || t.voided === true || !inPeriod(t.date, ctx.period) || !late(t.date, t.created_at)) continue;
    rows.push(row(t.id, t.date, t.description || t.category || '', abs(t.amount), { kind: 'ledger', created_at: t.created_at }));
  }
  return result(severity, { rows });
}
