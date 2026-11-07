// No orphans: no journal line whose entry is gone, no entry without lines,
// and no ledger row pointing at an entry that is gone. Each is the remains of
// a half-finished post or delete.
import { abs, inPeriod, monthOf, result, row, skip } from '../util.js';

export const key = 'orphan_lines';
export const severity = 'red';

export function run(data, ctx = {}) {
  const entries = data.entries || [], lines = data.lines || [];
  if (!entries.length && !lines.length) return skip('no_journal');
  const ids = new Set(entries.map((e) => e.id));
  const withLines = new Set(lines.map((l) => l.journal_entry_id));
  const when = (x) => x.date || (x.created_at ? String(x.created_at).slice(0, 10) : null);
  const rows = [];
  for (const l of lines) {
    if (ids.has(l.journal_entry_id) || !inPeriod(when(l), ctx.period)) continue;
    rows.push(row(l.id, when(l), `line without entry · ${l.category || l.description || ''}`, (Number(l.debit_amount) || 0) + (Number(l.credit_amount) || 0), { kind: 'line' }));
  }
  for (const e of entries) {
    if (withLines.has(e.id) || e.status === 'voided' || !inPeriod(e.date, ctx.period)) continue;
    rows.push(row(e.id, e.date, `entry without lines · ${e.reference || ''} ${e.description || ''}`, abs(e.total_amount), { kind: 'entry' }));
  }
  for (const t of data.transactions || []) {
    if (!t.journal_entry_id || ids.has(t.journal_entry_id) || t.voided === true || !inPeriod(t.date, ctx.period)) continue;
    rows.push(row(t.id, t.date, `ledger row of a missing entry · ${t.description || t.category || ''}`, abs(t.amount), { kind: 'ledger' }));
  }
  return result(severity, { rows, months: [...new Set(rows.map((r) => monthOf(r.date)).filter(Boolean))].sort() });
}
