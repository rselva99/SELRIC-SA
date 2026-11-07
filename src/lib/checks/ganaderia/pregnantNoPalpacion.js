// Every active animal marked pregnant has a palpación that found her
// pregnant. The mark comes from the palpación (lv_record_event sets it from
// the result), so a mark with no positive check came in some other way — an
// import or a hand edit — and the due date drawn from it cannot be trusted.
import { result, row, skip } from '../util.js';

export const key = 'herd_pregnant_no_palpacion';
export const severity = 'amber';

export function run(data) {
  const pregnant = (data.animals || []).filter((a) => a.status === 'activo' && a.pregnant === true);
  if (!pregnant.length) return skip('no_pregnant');
  const checked = new Set(), positive = new Set();
  for (const e of data.events || []) {
    if (e.type !== 'palpacion') continue;
    checked.add(e.animal_id);
    if (e.data?.result === 'S') positive.add(e.animal_id);
  }
  const rows = [];
  for (const a of pregnant) {
    if (positive.has(a.id)) continue;
    const kind = checked.has(a.id) ? 'negative_only' : 'none';
    const what = kind === 'none' ? 'marked pregnant, no palpación' : 'marked pregnant, every palpación negative';
    rows.push(row(a.id, a.preg_date, `${a.name || a.slug} · ${what}`, 0, { kind, slug: a.slug, name: a.name, tag: a.tag || '' }));
  }
  return result(severity, { rows: rows.sort((x, y) => String(x.name).localeCompare(String(y.name))) });
}
