// Every animal has a category the vocabulary knows for its species. The
// category decides the lot mix, who can calve and which events the card
// offers, so an empty or unknown one (a typo from an import) is listed.
import { CATEGORIES } from '../../../programs/ganaderia/lib.js';
import { result, row, skip } from '../util.js';

export const key = 'herd_no_category';
export const severity = 'amber';

export function run(data) {
  const animals = data.animals || [];
  if (!animals.length) return skip('no_animals');
  const rows = [];
  for (const a of animals) {
    const known = CATEGORIES[a.species] || CATEGORIES.bovino;
    if (a.category && known.includes(a.category)) continue;
    const what = a.category ? `unknown category "${a.category}"` : 'no category';
    rows.push(row(a.id, null, `${a.name || a.slug} · ${what}`, 0, { kind: a.category ? 'unknown' : 'none', slug: a.slug, name: a.name, tag: a.tag || '', category: a.category || '' }));
  }
  return result(severity, { rows: rows.sort((x, y) => String(x.name).localeCompare(String(y.name))) });
}
