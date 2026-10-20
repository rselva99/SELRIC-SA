// Workspace config — how a business shapes its own portal (Simple mode).
//
// Stored in organizations.config (jsonb). The logic underneath is the same
// for every workspace; the config only decides vocabulary, visibility and
// emphasis: which modules show in the sidebar, what they are called, and
// what the dashboard shows. `resolveConfig` turns whatever is stored (even
// {}) into a complete object the app can read without null checks.
//
// Translation keys for the labels live in translations.js under `portal.*`.

export const CONFIG_VERSION = 1;

// Modules a workspace can turn on or off. Dashboard, Transactions, Reports'
// Summary, Team and Settings are always there — they are the core.
export const MODULES = [
  { key: 'sales',     path: '/sales',     labelKey: 'nav.salesSimple' },
  { key: 'customers', path: '/customers', labelKey: 'nav.customers' },
  { key: 'inventory', path: '/inventory', labelKey: 'nav.inventory' },
  { key: 'tasks',     path: '/tasks',     labelKey: 'nav.tasks' },
  { key: 'reports',   path: '/reports',   labelKey: 'nav.reports' },
];

// Dashboard sections that can be hidden. The three money KPIs and
// "what needs you" always show.
export const DASHBOARD_SECTIONS = ['chart', 'breakdown', 'products', 'recent'];

// Templates: a starting configuration per kind of business. Picked on the
// setup screen (or suggested from the sign-up business type) and adjustable
// afterwards in Settings → Your portal.
export const TEMPLATES = [
  {
    key: 'maker',
    modules: { sales: true, customers: true, inventory: true, tasks: false, reports: true },
    dashboard: { chart: true, breakdown: true, products: true, recent: true },
    businessTypes: ['other', 'contractor'],
  },
  {
    key: 'retail',
    modules: { sales: true, customers: true, inventory: true, tasks: false, reports: true },
    dashboard: { chart: true, breakdown: true, products: true, recent: true },
    businessTypes: ['retail'],
  },
  {
    key: 'services',
    modules: { sales: true, customers: true, inventory: false, tasks: true, reports: true },
    dashboard: { chart: true, breakdown: true, products: false, recent: true },
    businessTypes: ['services', 'health', 'nonprofit'],
  },
  {
    key: 'restaurant',
    modules: { sales: true, customers: false, inventory: true, tasks: true, reports: true },
    dashboard: { chart: true, breakdown: true, products: true, recent: true },
    businessTypes: ['restaurant_bar'],
  },
];

export const DEFAULT_TEMPLATE = 'retail';

// Custom fields (phase 2): per-workspace extra details on products, customers
// and sales, stored in each table's `extra jsonb` column and defined here as
// config.fields = { products: [...], customers: [...], sales: [...] }.
// A definition is { key, label, type, options? }:
//   key     — stable slug used in `extra` (made from the label once, never
//             changed afterwards so renaming the label keeps the data)
//   label   — what the user sees, ≤ 40 chars
//   type    — 'text' | 'number' | 'date' | 'list'
//   options — for 'list': the choices, ≤ 20 of ≤ 40 chars
// Which module each entity belongs to (the editor only offers fields for
// modules that are on).
export const FIELD_ENTITIES = [
  { key: 'products',  module: 'inventory' },
  { key: 'customers', module: 'customers' },
  { key: 'sales',     module: 'sales' },
];
export const FIELD_TYPES = ['text', 'number', 'date', 'list'];
export const MAX_FIELDS = 10;
export const MAX_OPTIONS = 20;

// A slug for a label: "Fecha de vencimiento" → "fecha_de_vencimiento".
// Unique among `taken` (suffix _2, _3…).
export function fieldKey(label, taken = []) {
  const base = String(label || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'field';
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base}_${i}`;
  return k;
}

// Normalise one entity's field list: drop junk, cap lengths, assign keys to
// new rows, keep existing keys, dedupe.
export function cleanFields(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const taken = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const label = typeof f.label === 'string' ? f.label.trim().slice(0, 40) : '';
    if (!label) continue;
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const key = typeof f.key === 'string' && /^[a-z0-9_]{1,32}$/.test(f.key) && !taken.includes(f.key) ? f.key : fieldKey(label, taken);
    const def = { key, label, type };
    if (type === 'list') {
      const raw = Array.isArray(f.options) ? f.options : typeof f.options === 'string' ? f.options.split(',') : [];
      def.options = raw.map((o) => String(o).trim().slice(0, 40)).filter(Boolean)
        .filter((o, i, a) => a.indexOf(o) === i).slice(0, MAX_OPTIONS);
    }
    out.push(def);
    taken.push(key);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

function cleanFieldSets(stored) {
  const fields = {};
  for (const e of FIELD_ENTITIES) fields[e.key] = cleanFields(stored?.[e.key]);
  return fields;
}

export function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null;
}

// Which template fits a sign-up business type (the setup screen preselects it).
export function templateForBusinessType(businessType) {
  const hit = TEMPLATES.find((t) => t.businessTypes.includes(businessType));
  return (hit || getTemplate(DEFAULT_TEMPLATE)).key;
}

// True when the admin has been through setup (or saved the portal settings).
export function isConfigured(organization) {
  const c = organization?.config;
  return !!(c && typeof c === 'object' && c.template);
}

// A complete config: stored values over the template's defaults over the
// retail defaults. Unknown keys are dropped; label overrides are trimmed.
export function resolveConfig(organization) {
  const stored = organization?.config && typeof organization.config === 'object' ? organization.config : {};
  const templateKey = getTemplate(stored.template) ? stored.template : templateForBusinessType(organization?.business_type);
  const template = getTemplate(templateKey) || getTemplate(DEFAULT_TEMPLATE);

  const modules = {};
  for (const m of MODULES) {
    const v = stored.modules?.[m.key];
    modules[m.key] = typeof v === 'boolean' ? v : !!template.modules[m.key];
  }
  const dashboard = {};
  for (const s of DASHBOARD_SECTIONS) {
    const v = stored.dashboard?.[s];
    dashboard[s] = typeof v === 'boolean' ? v : template.dashboard[s] !== false;
  }
  const labels = {};
  for (const m of MODULES) {
    const v = stored.labels?.[m.key];
    if (typeof v === 'string' && v.trim()) labels[m.key] = v.trim().slice(0, 40);
  }
  const fields = cleanFieldSets(stored.fields);
  return { v: CONFIG_VERSION, template: templateKey, modules, labels, dashboard, fields, configured: isConfigured(organization) };
}

// What to store: only the fields the app knows, so a stale key can never
// hang around in the row.
export function serializeConfig({ template, modules, labels, dashboard, fields }) {
  const out = { v: CONFIG_VERSION, template: getTemplate(template) ? template : DEFAULT_TEMPLATE, modules: {}, labels: {}, dashboard: {}, fields: {} };
  for (const m of MODULES) out.modules[m.key] = !!modules?.[m.key];
  for (const s of DASHBOARD_SECTIONS) out.dashboard[s] = dashboard?.[s] !== false;
  for (const m of MODULES) {
    const v = labels?.[m.key];
    if (typeof v === 'string' && v.trim()) out.labels[m.key] = v.trim().slice(0, 40);
  }
  out.fields = cleanFieldSets(fields);
  return out;
}

// ── Values ──────────────────────────────────────────────────────────────────
// What a row's `extra` should hold for these definitions: known keys typed
// and trimmed, empties dropped. Keys the definitions no longer mention are
// kept as they were — removing a field from the portal hides it, it never
// deletes what was typed.
export function cleanExtra(fields, raw) {
  const out = {};
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const known = new Set((fields || []).map((f) => f.key));
  for (const [k, v] of Object.entries(src)) if (!known.has(k) && v != null && v !== '') out[k] = v;
  for (const f of fields || []) {
    const v = src[f.key];
    if (v == null || v === '') continue;
    if (f.type === 'number') {
      const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (f.type === 'date') {
      const s = String(v).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out[f.key] = s;
    } else if (f.type === 'list') {
      const s = String(v).trim();
      if (s && (!f.options?.length || f.options.includes(s))) out[f.key] = s;
    } else {
      const s = String(v).trim().slice(0, 200);
      if (s) out[f.key] = s;
    }
  }
  return out;
}
