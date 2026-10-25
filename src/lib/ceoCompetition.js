// The competitor dataset, read for the eye: ladders, medians, the feature
// matrix. Pure functions over the `dataset` section of the competition
// document and a compute() result; no constant lives here. SelRic's own rows
// carry a priceToken instead of a number — our price is the model's.
import { get } from './ceoDocs.js';

export const GROUP_ORDER = ['infra', 'market', 'ours'];

export const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

// Our own price points for a market, from the model. Business is one number;
// Ganadería is three tiers — entry, comparable (the middle tier) and top.
export function selfPrices(row, R) {
  const tok = row?.pricing?.priceToken;
  if (!R || !tok) return { entry: null, comparable: null, ticks: [] };
  const v = get(R, tok);
  if (typeof v === 'number') return { entry: v, comparable: v, ticks: [{ label: row.name, price: v }] };
  if (Array.isArray(v) && v.length) {
    const ticks = v.map((t) => ({ label: t.tier, price: t.price }));
    return { entry: v[0].price, comparable: v[Math.min(1, v.length - 1)].price, top: v[v.length - 1].price, ticks };
  }
  return { entry: null, comparable: null, ticks: [] };
}

// Every competitor with its prices resolved; SelRic from the model.
export function ladder(market, R) {
  return (market?.competitors || []).map((c) => {
    const self = !!c.self;
    const p = self ? selfPrices(c, R) : { entry: c.pricing?.entryUsdMonth ?? null, comparable: c.pricing?.comparableUsdMonth ?? null, ticks: [] };
    const tiers = self ? p.ticks.map((t) => ({ name: t.label, usdMonth: t.price })) : (c.pricing?.tiers || []);
    return { key: c.key, name: c.name, self, region: c.region, entry: p.entry, comparable: p.comparable, top: p.top ?? null, ticks: p.ticks, tiers, model: c.pricing?.model, note: c.pricing?.comparableNote || c.pricing?.note || '', fx: !!c.pricing?.fx, source: c.source, checked: c.checked, betterAtUs: c.betterAtUs || [], weakerThanUs: c.weakerThanUs || [] };
  });
}

// The KPI strip: our price against the field.
export function stats(market, R) {
  const rows = ladder(market, R);
  const us = rows.find((r) => r.self);
  const field = rows.filter((r) => !r.self);
  const withComparable = field.filter((r) => r.comparable != null);
  const ours = us?.comparable ?? null;
  return {
    us, ours, ticks: us?.ticks || [],
    medianEntry: median(field.map((r) => r.entry)),
    medianComparable: median(withComparable.map((r) => r.comparable)),
    // Over every competitor: one without a comparable price is not 'cheaper', it is n/a.
    cheaper: ours == null ? null : withComparable.filter((r) => r.comparable < ours).length,
    compared: withComparable.length, total: field.length,
    freeTier: field.filter((r) => r.entry === 0 || (r.tiers || []).some((t) => t.usdMonth === 0)).length,
  };
}

// Ladder rows sorted for a horizontal bar chart: dearest first, SelRic kept in place by price,
// competitors without a comparable price last (drawn as n/a, so the count of rows is the count of competitors).
export const ladderRows = (market, R) => ladder(market, R).sort((a, b) => (b.comparable ?? -1) - (a.comparable ?? -1));

// The matrix: feature columns grouped, rows with SelRic pinned first.
export function matrix(market, lang = 'en') {
  const feats = market?.features || [];
  const groups = GROUP_ORDER.map((g) => ({ key: g, features: feats.filter((f) => (f.group || 'infra') === g).map((f) => ({ key: f.key, label: lang === 'es' && f.es ? f.es : f.label })) })).filter((g) => g.features.length);
  const rows = (market?.competitors || []).map((c) => ({ key: c.key, name: c.name, self: !!c.self, scores: c.features || {} }));
  return { groups, rows: pinSelf(rows) };
}
export const pinSelf = (rows) => [...rows.filter((r) => r.self), ...rows.filter((r) => !r.self)];
export const sortByFeature = (rows, key) => (key ? pinSelf([...rows].sort((a, b) => (b.scores[key] ?? 0) - (a.scores[key] ?? 0))) : rows);
export const featureTotal = (row, groups) => groups.flatMap((g) => g.features).reduce((s, f) => s + (row.scores[f.key] ?? 0), 0);
