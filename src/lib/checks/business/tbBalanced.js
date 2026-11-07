// Trial balance = 0 per period: in every month, the debits on the journal
// lines equal the credits. A month that does not balance is listed with the
// entries whose own lines do not balance (the usual cause).
import { CENT, abs, inPeriod, monthOf, result, round2, row, skip } from '../util.js';

export const key = 'tb_balanced';
export const severity = 'red';

export function run(data, ctx = {}) {
  const entries = new Map((data.entries || []).filter((e) => e.status !== 'voided').map((e) => [e.id, e]));
  const lines = (data.lines || []).filter((l) => entries.has(l.journal_entry_id));
  if (!lines.length) return skip('no_journal_lines');

  const byEntry = new Map();
  for (const l of lines) {
    const e = entries.get(l.journal_entry_id);
    if (!inPeriod(e.date, ctx.period)) continue;
    const s = byEntry.get(e.id) || { e, dr: 0, cr: 0 };
    s.dr += Number(l.debit_amount) || 0;
    s.cr += Number(l.credit_amount) || 0;
    byEntry.set(e.id, s);
  }
  const byMonth = new Map();
  for (const { e, dr, cr } of byEntry.values()) {
    const m = monthOf(e.date);
    byMonth.set(m, (byMonth.get(m) || 0) + dr - cr);
  }
  const months = [...byMonth].filter(([, d]) => abs(d) > CENT).map(([m, d]) => ({ month: m, difference: round2(d) })).sort((a, b) => a.month.localeCompare(b.month));
  const offMonths = new Set(months.map((m) => m.month));
  const rows = [...byEntry.values()]
    .filter(({ e, dr, cr }) => offMonths.has(monthOf(e.date)) && abs(dr - cr) > CENT)
    .map(({ e, dr, cr }) => row(e.id, e.date, `${e.reference || ''} ${e.description || ''}`.trim(), dr - cr, { ref: e.reference || null }));
  return result(severity, { rows, count: months.length, amount: months.reduce((s, m) => s + abs(m.difference), 0), months });
}
