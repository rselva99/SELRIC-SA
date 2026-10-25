// The shape of the assumptions object, for the editor and the Excel export:
// which inputs exist, how they are grouped, what unit each carries. No values
// live here — those come from platform_assumptions — and no notes either: a
// note is the owner's reason for a number and is stored beside it, in
// data.meta[path].
//
// Types: money · int · num · pct (stored as a fraction, edited as %) · month
// ('YYYY-MM') · text · bool · ramp (four numbers at months 1/12/24/36) · scale
// (a multiplier, 1 = unchanged).
const f = (path, label, type, unit, extra = {}) => ({ path, label, type, unit, ...extra });

export const GROUPS = [
  { key: 'horizon', title: 'Horizon', fields: [
    f('startMonth', 'Start month', 'month', 'month 1'),
    f('horizon', 'Horizon', 'int', 'months', { readonly: true }),
  ] },
  { key: 'pricing', title: 'Pricing', fields: [
    f('price.business', 'Business — every market', 'money', '$ / month'),
    f('price.ganaderia.0.tier', 'Ganadería tier 1 — name', 'text', ''),
    f('price.ganaderia.0.maxHead', 'Ganadería tier 1 — up to', 'int', 'head'),
    f('price.ganaderia.0.price', 'Ganadería tier 1 — price', 'money', '$ / month', { meta: 'price.ganaderia.t50.price' }),
    f('price.ganaderia.1.tier', 'Ganadería tier 2 — name', 'text', ''),
    f('price.ganaderia.1.maxHead', 'Ganadería tier 2 — up to', 'int', 'head'),
    f('price.ganaderia.1.price', 'Ganadería tier 2 — price', 'money', '$ / month', { meta: 'price.ganaderia.t75.price' }),
    f('price.ganaderia.2.tier', 'Ganadería tier 3 — name', 'text', ''),
    f('price.ganaderia.2.price', 'Ganadería tier 3 — price', 'money', '$ / month', { meta: 'price.ganaderia.t100.price' }),
    f('price.oldFlatPrice', 'Old flat Ganadería price', 'money', '$ / month'),
    f('price.annualPrepayMonthsFree', 'Annual prepay — months free', 'int', 'months'),
    f('price.annualPrepayShare', 'Annual prepay — share of joiners', 'pct', '%'),
    f('grossMargin', 'Gross margin', 'pct', '%'),
    f('planCustomerMix.t50', 'Plan mix — tier 1 buyers', 'pct', '% of Ganadería customers', { meta: 'planCustomerMix' }),
    f('planCustomerMix.t75', 'Plan mix — tier 2 buyers', 'pct', '%', { meta: 'planCustomerMix' }),
    f('planCustomerMix.t100', 'Plan mix — tier 3 buyers', 'pct', '%', { meta: 'planCustomerMix' }),
  ] },
  { key: 'market', title: 'Market', fields: [
    f('market.ni_cattle_producers', 'Nicaragua — producers owning cattle', 'int', 'producers'),
    f('market.ni_herd_head', 'Nicaragua — national herd', 'int', 'head'),
    f('market.ni_share_small_medium_farms', 'Share of farms under 60 head', 'pct', '%'),
    f('market.ni_share_herd_on_small_medium', 'Share of the herd on those farms', 'pct', '%'),
    f('market.ni_medium_share_of_producers', 'Share of producers with 16–60 head', 'pct', '%'),
    f('market.ni_mipymes_urban_formal', 'Nicaragua — urban formal MIPYMES', 'int', 'businesses'),
    f('market.us_latino_employer_firms', 'US — Latino-owned employer firms', 'int', 'firms'),
    f('market.mo_restaurants', 'Missouri — restaurant locations', 'int', 'locations'),
    f('market.gdp_pc_ni', 'GDP per capita — Nicaragua', 'money', '$ / year'),
    f('market.gdp_pc_us', 'GDP per capita — United States', 'money', '$ / year'),
    f('tierMixLarge.t50', 'Large farms in tier 1', 'pct', '% of farms over 60 head', { meta: 'tierMixLarge' }),
    f('tierMixLarge.t75', 'Large farms in tier 2', 'pct', '%', { meta: 'tierMixLarge' }),
    f('tierMixLarge.t100', 'Large farms in tier 3', 'pct', '%', { meta: 'tierMixLarge' }),
    f('avgHeadByTier.t50', 'Average head — tier 1 farm', 'int', 'head', { meta: 'avgHeadByTier' }),
    f('avgHeadByTier.t75', 'Average head — tier 2 farm', 'int', 'head', { meta: 'avgHeadByTier' }),
    f('avgHeadByTier.t100', 'Average head — tier 3 farm', 'int', 'head', { meta: 'avgHeadByTier' }),
  ] },
  { key: 'acquisition', title: 'Acquisition plan', fields: [
    f('acq.usB', 'US · Business — new customers a month', 'ramp', 'at months 1 / 12 / 24 / 36'),
    f('acq.niB', 'Nicaragua · Business — new customers a month', 'ramp', 'at months 1 / 12 / 24 / 36'),
    f('acq.niG', 'Nicaragua · Ganadería — new customers a month', 'ramp', 'at months 1 / 12 / 24 / 36'),
  ] },
  { key: 'pilots', title: 'Pilots', fields: [
    f('pilots.usB', 'Pilots — US · Business', 'int', 'workspaces', { meta: 'pilots' }),
    f('pilots.niB', 'Pilots — Nicaragua · Business', 'int', 'workspaces', { meta: 'pilots' }),
    f('pilots.niG', 'Pilots — Nicaragua · Ganadería', 'int', 'workspaces', { meta: 'pilots' }),
    f('pilotConversion', 'Pilot conversion', 'pct', '% that pay'),
    f('pilotConvertMonth', 'Pilots convert in month', 'int', 'month #'),
  ] },
  { key: 'retention', title: 'Retention', fields: [
    f('churn.earlyMonths', 'Early window', 'int', 'months'),
    f('churn.earlyMonthly', 'Churn inside the window', 'pct', '% a month'),
    f('churn.steadyMonthly', 'Churn after it', 'pct', '% a month'),
  ] },
  { key: 'capacity', title: 'Capacity', fields: [
    f('capacity.founderSellingHours', 'Founder selling hours', 'num', 'hours / month'),
    f('capacity.hoursPerNewCustomer', 'Hours to land a customer', 'num', 'hours'),
    f('capacity.supportHoursPerCustomer', 'Support per customer', 'num', 'hours / month'),
    f('capacity.contractHours', 'Contract hours bought', 'ramp', 'hours / month at months 1 / 12 / 24 / 36'),
    f('capacity.contractRate', 'Contract rate', 'money', '$ / hour'),
    f('capacity.founderHourValue', 'Value of a founder hour', 'money', '$ / hour'),
  ] },
  { key: 'costs', title: 'Costs', fields: [
    f('cost.supabase', 'Supabase', 'money', '$ / month'),
    f('cost.vercel', 'Vercel', 'money', '$ / month'),
    f('cost.tools', 'Tools', 'money', '$ / month'),
    f('cost.professional', 'Professional services', 'money', '$ / month'),
    f('cost.infraStepCost', 'Hosting step cost', 'money', '$ / month per step'),
    f('cost.infraStepCustomers', 'Hosting step size', 'int', 'customers'),
    f('cost.cashCAC', 'Cash CAC', 'money', '$ per new customer'),
    f('cost.founderDraw', 'Founder draw', 'money', '$ / month'),
    f('cost.founderDrawWhenCovered', 'Draw switches on when covered', 'bool', ''),
    f('cost.drawTrailingMonths', 'Trailing months that must cover it', 'int', 'months'),
    f('cost.openingCash', 'Opening cash', 'money', '$'),
  ] },
  { key: 'scenarios', title: 'Scenarios', fields: [
    f('scenarios.downside.pilotConversion', 'Downside — pilot conversion', 'pct', '%', { meta: 'scenarios' }),
    f('scenarios.downside.churn.earlyMonthly', 'Downside — early churn', 'pct', '% a month', { meta: 'scenarios' }),
    f('scenarios.downside.churn.steadyMonthly', 'Downside — steady churn', 'pct', '% a month', { meta: 'scenarios' }),
    f('scenarios.downside.acqScale', 'Downside — acquisition ×', 'scale', '× the plan', { meta: 'scenarios' }),
    f('scenarios.upside.pilotConversion', 'Upside — pilot conversion', 'pct', '%', { meta: 'scenarios' }),
    f('scenarios.upside.churn.earlyMonthly', 'Upside — early churn', 'pct', '% a month', { meta: 'scenarios' }),
    f('scenarios.upside.churn.steadyMonthly', 'Upside — steady churn', 'pct', '% a month', { meta: 'scenarios' }),
    f('scenarios.upside.acqScale', 'Upside — acquisition ×', 'scale', '× the plan', { meta: 'scenarios' }),
    f('scenarios.upside.capacity.founderSellingHours', 'Upside — founder selling hours', 'num', 'hours / month', { meta: 'scenarios' }),
    f('scenarios.niBalk.pilotConversion', 'NI pilots balk — pilot conversion', 'pct', '%', { meta: 'scenarios' }),
  ] },
  { key: 'sensitivity', title: 'Sensitivity cases', list: 'sensitivity', labelFrom: 'label', fields: [
    f('hi', 'High (favourable) value', 'auto', ''),
    f('lo', 'Low value', 'auto', ''),
  ] },
  { key: 'competitors', title: 'Competitors — herd software', list: 'competitors.herd', labelFrom: 'name', fields: [
    f('price', 'Price', 'money', '$ / month'),
    f('note', 'Note', 'text', ''),
  ] },
  { key: 'competitorsB', title: 'Competitors — small-business software', list: 'competitors.business', labelFrom: 'name', fields: [
    f('price', 'Price', 'money', '$ / month'),
    f('note', 'Note', 'text', ''),
  ] },
];

// A sensitivity case's values take the unit of the input it moves.
export const PARAM_TYPE = { acqScale: 'scale', founderSellingHours: 'num', steadyMonthly: 'pct', earlyMonthly: 'pct', ganArpu: 'money', pilotConversion: 'pct' };

// Display a stored value in its edited form, and parse it back.
export const toInput = (v, type) => (v == null ? '' : type === 'pct' ? String(+(v * 100).toFixed(4)) : type === 'ramp' ? v.join(', ') : type === 'bool' ? !!v : String(v));
export function fromInput(s, type) {
  if (type === 'bool') return !!s;
  if (type === 'text' || type === 'month') return String(s);
  if (type === 'ramp') { const xs = String(s).split(/[,\s]+/).filter(Boolean).map(Number); return xs.length === 4 && xs.every((x) => Number.isFinite(x)) ? xs : null; }
  const n = Number(String(s).replace(/[$,%\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (type === 'pct') return n / 100;
  if (type === 'int') return Math.round(n);
  return n;
}
export function setPath(obj, path, value) {
  const parts = String(path).split('.'); const copy = structuredClone(obj); let o = copy;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
  o[parts[parts.length - 1]] = value; return copy;
}
