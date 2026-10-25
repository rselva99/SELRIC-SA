// EN/ES key parity for src/i18n/translations.js.
//
//   node scripts/i18n_parity.mjs
//
// Flattens both trees to dotted paths and compares them. Prints the counts and
// `parity` when they match; otherwise lists every path missing on either side
// and exits 1, so a batch cannot report with a key in one language only.
import { translations } from '../src/i18n/translations.js';

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
const en = new Set(flat(translations.en)), es = new Set(flat(translations.es));
const onlyEn = [...en].filter((k) => !es.has(k)).sort();
const onlyEs = [...es].filter((k) => !en.has(k)).sort();

if (!onlyEn.length && !onlyEs.length) {
  console.log(`EN ${en.size} / ES ${es.size} parity`);
} else {
  console.log(`EN ${en.size} / ES ${es.size} — MISMATCH`);
  if (onlyEn.length) console.log(`  missing in es (${onlyEn.length}):\n    ${onlyEn.join('\n    ')}`);
  if (onlyEs.length) console.log(`  missing in en (${onlyEs.length}):\n    ${onlyEs.join('\n    ')}`);
  process.exit(1);
}
