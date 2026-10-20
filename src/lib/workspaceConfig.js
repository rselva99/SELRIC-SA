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
  return { v: CONFIG_VERSION, template: templateKey, modules, labels, dashboard, configured: isConfigured(organization) };
}

// What to store: only the fields the app knows, so a stale key can never
// hang around in the row.
export function serializeConfig({ template, modules, labels, dashboard }) {
  const out = { v: CONFIG_VERSION, template: getTemplate(template) ? template : DEFAULT_TEMPLATE, modules: {}, labels: {}, dashboard: {} };
  for (const m of MODULES) out.modules[m.key] = !!modules?.[m.key];
  for (const s of DASHBOARD_SECTIONS) out.dashboard[s] = dashboard?.[s] !== false;
  for (const m of MODULES) {
    const v = labels?.[m.key];
    if (typeof v === 'string' && v.trim()) out.labels[m.key] = v.trim().slice(0, 40);
  }
  return out;
}
