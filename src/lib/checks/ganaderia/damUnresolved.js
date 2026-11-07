// Every mother named on a card is in the herd. A card names its mother by a
// link (dam_id) or by name only (dam_name, kept when the mother has no card).
// Listed: a link to a card this workspace does not have, a link to a male,
// and a name no card answers to — the mother should be added or linked.
import { result, row, skip } from '../util.js';

export const key = 'herd_dam_unresolved';
export const severity = 'amber';

const norm = (s) => String(s || '').trim().toLowerCase();

export function run(data) {
  const animals = data.animals || [];
  const named = animals.filter((a) => a.dam_id || norm(a.dam_name));
  if (!named.length) return skip('no_dams');
  const byId = new Map(animals.map((a) => [a.id, a]));
  const names = new Set();
  for (const a of animals) for (const n of [a.name, ...(a.aliases || [])]) if (norm(n)) names.add(norm(n));
  const rows = [];
  for (const a of named) {
    let kind = null;
    if (a.dam_id) {
      const dam = byId.get(a.dam_id);
      if (!dam) kind = 'missing';
      else if (dam.sex === 'M') kind = 'male';
    } else if (!names.has(norm(a.dam_name))) {
      kind = 'unlinked';
    }
    if (!kind) continue;
    const dam = a.dam_name || byId.get(a.dam_id)?.name || '';
    const what = { missing: 'mother card not in this herd', male: 'mother card is a male', unlinked: 'no card for the mother' }[kind];
    rows.push(row(a.id, a.birth_date, `${a.name || a.slug} · ${what}${dam ? ` (${dam})` : ''}`, 0, { kind, slug: a.slug, name: a.name, tag: a.tag || '', dam }));
  }
  return result(severity, { rows: rows.sort((x, y) => String(x.name).localeCompare(String(y.name))) });
}
