// An invented cattle finca, generated the same way every time: "Finca
// Sintética (synthetic)". About forty cards in three lots — cows, heifers,
// a bull, steers and this year's calves linked to their mothers — and a year
// of events: the calvings behind those calves, palpaciones (six cows pregnant,
// one past her date), two milkings a day for the cows in milk over the last
// ten weeks, monthly weights for the steers and one vaccination day. Every
// name and number comes from the lists and the seeded generator below; none
// is real.
//
//   makeHerd({ today, issues = false, seed = 11 })
//     → { org, user, profile, programs, tables: { <table>: rows }, data, planted }
//
// `tables` uses the database's column names (the smoke's mocked Supabase
// serves it); `data` is the herd checks' input ({ animals, events }, what
// src/lib/checks/fetch.js reads). With `issues: true` one problem is planted
// for each herd check; `planted` lists them by check key.

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const PREFIX = { org: 'ca771e00', user: 'ca771e01', animal: 'ca771e02', event: 'ca771e03' };
const uid = (kind, n) => `${PREFIX[kind]}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const addDays = (date, n) => new Date(Date.parse(date) + n * 86400000).toISOString().slice(0, 10);
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const HERD_ORG_ID = uid('org', 1);
export const HERD_USER_ID = uid('user', 1);

const COWS = ['Canela', 'Lucero', 'Pinta', 'Mora', 'Luna', 'Estrella', 'Paloma', 'Gaviota', 'Perla', 'Flor', 'Bonita', 'Chispa', 'Dulce', 'Rosita', 'Azucena', 'Margarita'];
const HEIFERS = ['Brisa', 'Nube', 'Alondra', 'Violeta', 'Golondrina'];
const STEERS = ['Tornado', 'Relámpago', 'Bravo'];
const CALVES = [['Trueno', 'ternero'], ['Rocío', 'ternera'], ['Lucerito', 'ternero'], ['Aurora', 'ternera'], ['Pinto', 'ternero'], ['Neblina', 'ternera'], ['Cometa', 'ternero'], ['Brisita', 'ternera']];

export function makeHerd({ today = '2026-11-07', issues = false, seed = 11 } = {}) {
  const r = rng(seed);
  const n = { animal: 0, event: 0 };
  const next = (k) => uid(k, ++n[k]);
  const created = `${addDays(today, -400)}T12:00:00.000Z`;
  const animals = [], events = [];

  const card = (o) => {
    const a = {
      id: next('animal'), org_id: HERD_ORG_ID, slug: slug(o.name), name: o.name, name_original: '', aliases: [], tag: '', brand: '', brand_note: '',
      species: 'bovino', sex: 'H', lot: '', breed: 'Brahman', dam_id: null, dam_name: '', sire_id: null, sire_name: '', birth_date: null,
      calvings: 0, pregnant: null, preg_months: null, preg_date: null, last_weight_kg: null, last_weight_date: null,
      status: 'activo', flags: [], notes: [], origin: 'app', extra: {}, created_by: HERD_USER_ID, created_at: created, updated_at: created, ...o,
    };
    animals.push(a);
    return a;
  };
  const event = (animal, type, date, data = {}) => {
    events.push({ id: next('event'), org_id: HERD_ORG_ID, animal_id: animal.id || animal, type, date, data, note: '', source: '', origin: 'app', import_key: null, created_by: HERD_USER_ID, created_at: `${date}T07:${String(events.length % 60).padStart(2, '0')}:00.000Z` });
  };

  const cows = COWS.map((name, i) => card({ name, category: 'vaca', tag: String(101 + i).padStart(4, '0'), lot: i % 2 ? 'Potrero Sur' : 'Potrero Norte', birth_date: addDays(today, -(4 + (i % 5)) * 365 - i * 11), calvings: 1 + (i % 4) }));
  HEIFERS.forEach((name, i) => card({ name, category: 'vaquilla', tag: String(201 + i).padStart(4, '0'), lot: 'Potrero Sur', birth_date: addDays(today, -700 - i * 23) }));
  card({ name: 'Capitán', category: 'toro', sex: 'M', tag: '0301', lot: 'Potrero Norte', birth_date: addDays(today, -6 * 365) });
  const steers = STEERS.map((name, i) => card({ name, category: 'novillo', sex: 'M', tag: String(401 + i).padStart(4, '0'), lot: 'Corral', birth_date: addDays(today, -520 - i * 17) }));

  // This year's calves: each one a calving of its mother, a month or so apart.
  const mothers = cows.slice(0, CALVES.length);
  CALVES.forEach(([name, category], i) => {
    const born = addDays(today, -(18 + i * 34 + Math.floor(r() * 9)));
    const dam = mothers[i];
    card({ name, category, sex: category === 'ternero' ? 'M' : 'H', lot: 'Corral', birth_date: born, dam_id: dam.id, dam_name: dam.name });
    event(dam, 'parto', born, { calf_sex: category === 'ternero' ? 'M' : 'H' });
  });
  // Two calvings from last year, so the chart has a year behind it.
  event(cows[10], 'parto', addDays(today, -330), { calf_sex: 'H' });
  event(cows[11], 'parto', addDays(today, -300), { calf_sex: 'M' });

  // Palpaciones: six cows found pregnant at different stages (cows[8], the
  // first, is now past her date); a few found empty.
  const stages = [[8, 202, 3], [9, 40, 6], [10, 75, 4], [11, 20, 5], [12, 95, 2], [13, 60, 3]];
  for (const [i, ago, months] of stages) {
    const date = addDays(today, -ago);
    Object.assign(cows[i], { pregnant: true, preg_months: months, preg_date: date });
    event(cows[i], 'palpacion', date, { result: 'S', months });
  }
  for (const i of [14, 15, 0]) {
    const date = addDays(today, -(30 + i));
    Object.assign(cows[i], { pregnant: false, preg_date: date });
    event(cows[i], 'palpacion', date, { result: 'N' });
  }

  // Milk: the six cows that calved most recently, two milkings a day for ten
  // weeks, tapering slowly after the calving.
  for (const [k, cow] of mothers.slice(0, 6).entries()) {
    const base = 7 + k * 0.8 + r() * 2;
    for (let d = 69; d >= 0; d--) {
      const date = addDays(today, -d);
      const am = Math.round((base - (69 - d) * 0.02 + (r() - 0.5)) * 10) / 10;
      event(cow, 'leche', date, { liters: am, shift: 'am' });
      event(cow, 'leche', date, { liters: Math.round(am * 0.6 * 10) / 10, shift: 'pm' });
    }
  }

  // Monthly weights for the steers; one vaccination day for the cows.
  for (const [k, steer] of steers.entries()) {
    for (let m = 5; m >= 0; m--) {
      const kg = Math.round(260 + k * 15 + (5 - m) * 22 + r() * 6);
      const date = addDays(today, -m * 30 - 3);
      event(steer, 'peso', date, { kg });
      if (m === 0) Object.assign(steer, { last_weight_kg: kg, last_weight_date: date });
    }
  }
  const vaccineDay = addDays(today, -88);
  for (const cow of cows) event(cow, 'vacuna', vaccineDay, { product: 'Aftosa', dose: '2 ml' });
  cows[15].flags = ['vender'];

  const planted = {};
  if (issues) {
    // An event whose card is gone.
    event(uid('animal', 999), 'nota', addDays(today, -12));
    planted.herd_orphan_events = 1;
    // A category the vocabulary does not have (a typo for novillo).
    card({ name: 'Manchada', category: 'novilla', tag: '0404', lot: 'Corral', birth_date: addDays(today, -480) });
    planted.herd_no_category = 1;
    // Marked pregnant on the card with no palpación on record.
    Object.assign(cows[5], { pregnant: true, preg_months: 4, preg_date: addDays(today, -15) });
    planted.herd_pregnant_no_palpacion = 1;
    // A calf whose mother is named but has no card.
    card({ name: 'Huérfana', category: 'ternera', lot: 'Corral', birth_date: addDays(today, -60), dam_name: 'Vieja Blanca' });
    planted.herd_dam_unresolved = 1;
  }

  const org = { id: HERD_ORG_ID, name: 'Finca Sintética (synthetic)', slug: 'finca-sintetica', business_type: 'ganaderia', is_legacy: false, created_by: HERD_USER_ID, created_at: created, updated_at: created, plan: 'pilot', accounting_mode: 'simple', config: {}, is_internal: false, is_test: true };
  const user = { id: HERD_USER_ID, aud: 'authenticated', role: 'authenticated', email: 'owner@finca-sintetica.invalid', email_confirmed_at: created, app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Finca Owner' }, created_at: created };
  // English like the smoke's tab, so opening a page never writes the locale.
  const profile = { id: HERD_USER_ID, org_id: HERD_ORG_ID, role: 'admin', full_name: 'Finca Owner', email: user.email, locale: 'en', created_at: created };
  const programs = [{ program: 'ganaderia', plan: 'pilot', enabled_at: created, org_id: HERD_ORG_ID }];

  return {
    org, user, profile, programs,
    tables: { organizations: [org], profiles: [profile], org_programs: programs, lv_animals: animals, lv_events: events },
    data: { animals, events },
    planted,
  };
}
