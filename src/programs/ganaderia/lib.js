import {
  Baby, HeartCrack, Stethoscope, Dna, Flame, Milk, Scale, Droplets, Syringe, Cross,
  Tag, Skull, ArrowRightLeft, StickyNote,
} from 'lucide-react';

// Batavia Ganadería — the vocabulary the pages share.
//
// Values stored in the database are the Spanish keys below (the notebook's
// own words); the labels come from translations under `lv.*`, so the UI
// reads the same in English and Spanish.

export const SPECIES = ['bovino', 'porcino'];

export const CATEGORIES = {
  bovino:  ['vaca', 'toro', 'novillo', 'vaquilla', 'ternero', 'ternera'],
  porcino: ['cerda', 'verraco', 'lechon', 'engorde'],
};

// What a category says about the animal: sex and whether it can calve.
export const CATEGORY_SEX = {
  vaca: 'H', toro: 'M', novillo: 'M', vaquilla: 'H', ternero: 'M', ternera: 'H',
  cerda: 'H', verraco: 'M', lechon: null, engorde: null,
};
export const BREEDING_FEMALE = new Set(['vaca', 'vaquilla', 'cerda']);

export const STATUSES = ['activo', 'vendido', 'muerto', 'historico'];
export const STATUS_TONE = { activo: 'green', vendido: 'amber', muerto: 'red', historico: 'muted' };

export const FLAGS = ['vender', 'vieja', 'mal_parto', 'mala_madre', 'una_tetilla', 'por_confirmar'];

// Event types. `fields` are the typed inputs the form shows; `tone` colours
// the timeline mark. Order = the order of the "record" tiles.
export const EVENT_TYPES = [
  { key: 'parto',     icon: Baby,           tone: 'green',  fields: ['calf_sex', 'create_calf', 'calf_name'] },
  { key: 'palpacion', icon: Stethoscope,    tone: 'blue',   fields: ['result', 'months'] },
  { key: 'peso',      icon: Scale,          tone: 'amber',  fields: ['kg'] },
  { key: 'leche',     icon: Milk,           tone: 'blue',   fields: ['liters', 'shift'] },
  { key: 'vacuna',    icon: Syringe,        tone: 'red',    fields: ['product', 'dose'] },
  { key: 'salud',     icon: Cross,          tone: 'red',    fields: ['reason', 'product'] },
  { key: 'servicio',  icon: Dna,            tone: 'blue',   fields: ['kind', 'sire'] },
  { key: 'celo',      icon: Flame,          tone: 'amber',  fields: [] },
  { key: 'destete',   icon: Droplets,       tone: 'amber',  fields: ['kg'] },
  { key: 'traslado',  icon: ArrowRightLeft, tone: 'muted',  fields: ['lot'] },
  { key: 'venta',     icon: Tag,            tone: 'sand',   fields: ['buyer', 'price', 'currency'] },
  { key: 'muerte',    icon: Skull,          tone: 'red',    fields: ['cause'] },
  { key: 'mal_parto', icon: HeartCrack,     tone: 'red',    fields: [] },
  { key: 'nota',      icon: StickyNote,     tone: 'muted',  fields: [] },
];
export const EVENT_BY_KEY = Object.fromEntries(EVENT_TYPES.map((e) => [e.key, e]));

// Events that close a card, and events only a breeding female gets.
export const CLOSING_EVENTS = new Set(['venta', 'muerte']);
export const FEMALE_EVENTS = new Set(['parto', 'mal_parto', 'palpacion', 'celo', 'servicio', 'leche']);

export const CURRENCIES = ['NIO', 'USD'];

// Bovine gestation, days. A pregnancy check at N months puts the calving at
// preg_date + (GESTATION - N × 30.4).
export const GESTATION_DAYS = { bovino: 283, porcino: 114 };

export function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'animal';
}

// Two letters for the avatar: "Pinta Roja" → "PR", "Canela" → "CA".
export function monogram(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '·';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function toDate(s) {
  if (!s) return null;
  const d = typeof s === 'string' ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')) : s;
  return Number.isNaN(d.getTime()) ? null : d;
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const d = toDate(iso);
  if (!d) return null;
  d.setDate(d.getDate() + n);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const da = toDate(a), db = toDate(b);
  if (!da || !db) return null;
  return Math.round((db - da) / 86400000);
}

// Age in whole years and months from a birth date.
export function ageParts(birth, ref = todayISO()) {
  const b = toDate(birth), r = toDate(ref);
  if (!b || !r || r < b) return null;
  let months = (r.getFullYear() - b.getFullYear()) * 12 + (r.getMonth() - b.getMonth());
  if (r.getDate() < b.getDate()) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12, days: daysBetween(birth, ref) };
}

// When a pregnant animal is expected to calve, from its last check.
export function expectedCalving(animal) {
  if (!animal?.pregnant || !animal.preg_date) return null;
  const gest = GESTATION_DAYS[animal.species] || GESTATION_DAYS.bovino;
  const months = Number(animal.preg_months) || 0;
  return addDays(animal.preg_date, Math.round(gest - months * 30.4));
}

export function isActive(animal) {
  return animal?.status === 'activo';
}

export function formatNum(n, max = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: max });
}

// Sort helper: newest first by date, then by creation.
export function byDateDesc(a, b) {
  return (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || '');
}

// ── What the pages derive from the herd ─────────────────────────────────────
// Every helper takes `today` so the tests can pin it; the pages pass the
// device's local date.

export function daysUntil(iso, today = todayISO()) {
  return daysBetween(today, iso);
}

// Months a pregnant animal carries today: what the check found plus the time
// since the check.
export function pregnancyMonths(animal, today = todayISO()) {
  if (!animal?.pregnant) return null;
  const atCheck = Number(animal.preg_months) || 0;
  const since = animal.preg_date ? Math.max(0, daysBetween(animal.preg_date, today) || 0) : 0;
  return Math.round((atCheck + since / 30.4) * 10) / 10;
}

// Length of a pregnancy in months, for the 0–9 track.
export function gestationMonths(animal) {
  return (GESTATION_DAYS[animal?.species] || GESTATION_DAYS.bovino) / 30.4;
}

// A breeding cow or heifer that is not known pregnant and has had no
// palpación in `days`. The last check is the card's preg_date (the RPC sets
// it on every palpación) or the newest palpación event, whichever is later.
export function overdueForPalpation(animal, days = 90, today = todayISO(), animalEvents = []) {
  if (!isActive(animal) || !['vaca', 'vaquilla'].includes(animal.category) || animal.pregnant === true) return false;
  const lastEvent = animalEvents.find((e) => e.type === 'palpacion')?.date || null;
  const last = [animal.preg_date, lastEvent].filter(Boolean).sort().pop();
  return !last || daysBetween(last, today) > days;
}

// Litres recorded on one day.
export function todayMilk(events, today = todayISO()) {
  let liters = 0, milkings = 0;
  for (const e of events) {
    if (e.type !== 'leche' || e.date !== today) continue;
    milkings += 1;
    liters += Number(e.data?.liters) || 0;
  }
  return { liters: Math.round(liters * 10) / 10, milkings };
}

// Litres per day for the last `days` days, oldest first.
export function milkSeries(events, days = 7, today = todayISO()) {
  const from = addDays(today, -(days - 1));
  const byDay = {};
  for (const e of events) {
    if (e.type !== 'leche' || e.date < from || e.date > today) continue;
    byDay[e.date] = (byDay[e.date] || 0) + (Number(e.data?.liters) || 0);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, liters: Math.round((byDay[date] || 0) * 10) / 10 };
  });
}

// The animals that gave the most milk over the last `days` days.
export function topMilkers(events, days = 7, today = todayISO(), n = 3) {
  const from = addDays(today, -(days - 1));
  const sum = {};
  for (const e of events) {
    if (e.type !== 'leche' || e.date < from || e.date > today) continue;
    sum[e.animal_id] = (sum[e.animal_id] || 0) + (Number(e.data?.liters) || 0);
  }
  return Object.entries(sum)
    .map(([animal_id, liters]) => ({ animal_id, liters: Math.round(liters * 10) / 10 }))
    .sort((a, b) => b.liters - a.liters)
    .slice(0, n);
}

// What a category counts as in a lot's composition bar.
export const CATEGORY_GROUP = {
  vaca: 'hembras', cerda: 'hembras',
  vaquilla: 'jovenes', novillo: 'jovenes', engorde: 'jovenes',
  ternero: 'crias', ternera: 'crias', lechon: 'crias',
  toro: 'machos', verraco: 'machos',
};
export const GROUP_ORDER = ['hembras', 'jovenes', 'crias', 'machos'];

// Active animals per lot: the head count, how many are pregnant, and the mix.
// Biggest lot first; animals with no lot are one group under ''.
export function lotComposition(animals) {
  const lots = {};
  for (const a of animals) {
    if (!isActive(a)) continue;
    const k = a.lot || '';
    const l = (lots[k] ||= { lot: k, total: 0, pregnant: 0, cats: {}, groups: { hembras: 0, jovenes: 0, crias: 0, machos: 0 } });
    l.total += 1;
    if (a.pregnant === true) l.pregnant += 1;
    l.cats[a.category] = (l.cats[a.category] || 0) + 1;
    const g = CATEGORY_GROUP[a.category];
    if (g) l.groups[g] += 1;
  }
  return Object.values(lots).sort((x, y) => y.total - x.total || x.lot.localeCompare(y.lot));
}

// ── Informes: the series the herd charts draw ───────────────────────────────

// 'YYYY-MM' plus n months.
export function monthAdd(month, n) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// Calvings per month: the year behind (the partos recorded) and the months
// ahead (active pregnant animals by their expected date). A late calving
// counts as expected in this month: it has not happened yet. The months run
// to the last expected calving, at most `ahead` months out.
export function calvingsByMonth(animals, events, today = todayISO(), back = 12, ahead = 10) {
  const now = today.slice(0, 7);
  const first = monthAdd(now, -(back - 1));
  const end = monthAdd(now, ahead);
  const recorded = {}, expected = {};
  for (const e of events) {
    if (e.type !== 'parto' || !e.date) continue;
    const m = e.date.slice(0, 7);
    if (m >= first && m <= now) recorded[m] = (recorded[m] || 0) + 1;
  }
  let last = now;
  for (const a of animals) {
    if (!isActive(a)) continue;
    const date = expectedCalving(a);
    if (!date) continue;
    const m = date.slice(0, 7) < now ? now : date.slice(0, 7);
    if (m > end) continue;
    expected[m] = (expected[m] || 0) + 1;
    if (m > last) last = m;
  }
  const out = [];
  for (let m = first; m <= last; m = monthAdd(m, 1)) {
    out.push({ month: m, recorded: m <= now ? recorded[m] || 0 : null, expected: m >= now ? expected[m] || 0 : null });
  }
  return out;
}

// Litres per cow per milking day, week by week for the last `weeks` weeks;
// the newest week ends today and each row is named by its first day. One cow
// milked twice on a day is one cow-day. A week with no milk is null — a gap
// in the line, not a zero.
export function milkPerCow(events, weeks = 12, today = todayISO()) {
  const from = addDays(today, -(weeks * 7 - 1));
  const rows = Array.from({ length: weeks }, (_, i) => ({ date: addDays(from, i * 7), liters: 0, cowDays: new Set(), cows: new Set() }));
  for (const e of events) {
    if (e.type !== 'leche' || !e.date || e.date < from || e.date > today) continue;
    const r = rows[Math.floor(daysBetween(from, e.date) / 7)];
    r.liters += Number(e.data?.liters) || 0;
    r.cowDays.add(`${e.animal_id}|${e.date}`);
    r.cows.add(e.animal_id);
  }
  return rows.map((r) => {
    const n = r.cowDays.size;
    return { date: r.date, liters: Math.round(r.liters * 10) / 10, cows: r.cows.size, cowDays: n, perCow: n ? Math.round((r.liters / n) * 10) / 10 : null };
  });
}

// The pregnant animals in calving order, grouped by the month they are due.
// A late calving sits in this month; a pregnancy with no check date (so no
// due date) comes last, under month null.
export function pregnancyTimeline(animals, today = todayISO()) {
  const now = today.slice(0, 7);
  const rows = animals
    .filter((a) => isActive(a) && a.pregnant === true)
    .map((a) => { const date = expectedCalving(a); return { animal: a, date, days: date ? daysBetween(today, date) : null }; })
    .sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999') || x.animal.name.localeCompare(y.animal.name));
  const groups = new Map();
  for (const r of rows) {
    const m = r.date ? (r.date.slice(0, 7) < now ? now : r.date.slice(0, 7)) : null;
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(r);
  }
  return [...groups].map(([month, list]) => ({ month, rows: list }));
}

// Flags that ask for something to be done (the rest describe the animal).
export const ACTION_FLAGS = ['por_confirmar', 'vender'];

// "Hoy te toca": overdue calvings, calvings within `window` days, one line for
// the cows due a palpación, one line per action flag — in that order.
export function needsYou(animals, today = todayISO(), eventsByAnimal = {}, window = 45) {
  const active = animals.filter(isActive);
  const overdue = [], due = [];
  for (const a of active) {
    const date = expectedCalving(a);
    if (!date) continue;
    const days = daysBetween(today, date);
    if (days < 0) overdue.push({ kind: 'overdue', animal: a, date, days: -days });
    else if (days <= window) due.push({ kind: 'due', animal: a, date, days });
  }
  overdue.sort((x, y) => y.days - x.days);
  due.sort((x, y) => x.days - y.days);
  const rows = [...overdue, ...due];
  const unchecked = active.filter((a) => overdueForPalpation(a, 90, today, eventsByAnimal[a.id] || [])).length;
  if (unchecked) rows.push({ kind: 'unchecked', n: unchecked });
  for (const flag of ACTION_FLAGS) {
    const n = active.filter((a) => a.flags?.includes(flag)).length;
    if (n) rows.push({ kind: 'flag', flag, n });
  }
  return rows;
}

// The record tiles in the order this workspace uses them: most recorded
// first, the vocabulary's own order breaking ties.
export function typeOrder(events) {
  const count = {};
  for (const e of events) count[e.type] = (count[e.type] || 0) + 1;
  return EVENT_TYPES
    .map((e, i) => ({ key: e.key, n: count[e.key] || 0, i }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((e) => e.key);
}

// The next chapa: one more than the highest all-digit chapa in the herd,
// padded to the same width ("0812" → "0813"). Empty when no chapa is a number.
export function nextTag(animals) {
  let best = null;
  for (const a of animals) {
    const tag = String(a.tag || '').trim();
    if (!/^\d{1,9}$/.test(tag)) continue;
    if (!best || Number(tag) > Number(best)) best = tag;
  }
  if (!best) return '';
  return String(Number(best) + 1).padStart(best.length, '0');
}

// Search the herd. A number finds the chapa first (exact, then starts with,
// then contains); words find the name, alias or chapa. Active animals first.
export function matchAnimals(animals, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return animals;
  const rank = (a) => {
    const tag = String(a.tag || '').toLowerCase();
    if (tag && tag === s) return 0;
    if (tag && tag.startsWith(s)) return 1;
    if (tag && tag.includes(s)) return 2;
    if (a.name.toLowerCase().startsWith(s)) return 3;
    if (a.name.toLowerCase().includes(s)) return 4;
    if ((a.aliases || []).some((x) => x.toLowerCase().includes(s))) return 5;
    if (a.brand && a.brand.toLowerCase().includes(s)) return 6;
    if (a.dam_name && a.dam_name.toLowerCase().includes(s)) return 7;
    return null;
  };
  return animals
    .map((a) => ({ a, r: rank(a) }))
    .filter((x) => x.r != null)
    .sort((x, y) => x.r - y.r || (isActive(y.a) - isActive(x.a)) || x.a.name.localeCompare(y.a.name))
    .map((x) => x.a);
}

// Sort by chapa when both have one (numerically), then by name.
export function byTag(a, b) {
  const ta = Number(a.tag), tb = Number(b.tag);
  const na = !!a.tag && Number.isFinite(ta), nb = !!b.tag && Number.isFinite(tb);
  if (na && nb) return ta - tb;
  if (na !== nb) return na ? -1 : 1;
  return a.name.localeCompare(b.name);
}
