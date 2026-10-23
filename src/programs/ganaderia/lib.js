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

// Two letters for the avatar: "Cara Negra" → "CN", "Urraca" → "UR".
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
