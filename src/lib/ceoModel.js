// The SelRic business model — the engine, and only the engine.
//
// No constant lives in this file. Every number comes in through the
// assumptions object (the newest row of platform_assumptions, kept outside
// the repository) and every number the CEO pages show comes out of compute().
// The same file runs under node from ~/selric-business/ for the verification
// and the file builds, so there is exactly one engine and it cannot drift.
//
// The model is a month-by-month cohort engine:
//   • acquisition ramps linearly between four targets (months 1, 12, 24, 36)
//     and is capped by the hours available to land and support customers
//   • churn is front-loaded: the first months carry a higher rate
//   • the pilots convert in a specific month
//   • cash is tracked, including annual prepay and a founder draw that
//     switches on only once trailing profit can carry it

// ── Helpers ─────────────────────────────────────────────────────────────────
const KNOTS = (H) => [1, 12, 24, Math.max(36, H)];
export const lerp = (pts, m, H) => {
  const xs = KNOTS(H);
  if (m <= xs[0]) return pts[0];
  for (let i = 1; i < xs.length; i++) if (m <= xs[i]) { const t = (m - xs[i - 1]) / (xs[i] - xs[i - 1]); return pts[i - 1] + t * (pts[i] - pts[i - 1]); }
  return pts[pts.length - 1];
};
export const monthLabel = (start, i) => { const [y, mo] = start.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + i, 1)).toISOString().slice(0, 7); };
const scaleAcq = (acq, f) => Object.fromEntries(Object.entries(acq).map(([k, v]) => [k, v.map((n) => n * f)]));
const tierMap = (a) => Object.fromEntries(a.price.ganaderia.map((t) => [t.key, t]));

// ── Derived facts: market sizes, tiers, affordability, expected life ────────
export function derive(a) {
  const m = a.market, T = tierMap(a), keys = a.price.ganaderia.map((t) => t.key), entry = a.price.ganaderia[0];
  const largeFarms = Math.round(m.ni_cattle_producers * (1 - m.ni_share_small_medium_farms));
  const headOnLarge = m.ni_herd_head * (1 - m.ni_share_herd_on_small_medium);
  const avgHeadLarge = headOnLarge / largeFarms;
  const mixAvg = keys.reduce((s, k) => s + a.tierMixLarge[k] * a.avgHeadByTier[k], 0);
  const mediumFarms = Math.round(m.ni_cattle_producers * m.ni_medium_share_of_producers);
  const upperMedium = Math.round(mediumFarms / 2);
  const tiers = Object.fromEntries(keys.map((k) => [k, { farms: Math.round(largeFarms * a.tierMixLarge[k]) + (k === entry.key ? upperMedium : 0), price: T[k].price }]));
  const samG = keys.reduce((s, k) => s + tiers[k].farms * tiers[k].price * 12, 0);
  const samGFarms = keys.reduce((s, k) => s + tiers[k].farms, 0);
  const ganArpu = keys.reduce((s, k) => s + a.planCustomerMix[k] * T[k].price, 0);
  const c = a.churn; let surv = 1, life = 0;
  for (let k = 0; k < 600; k++) { life += surv; surv *= 1 - (k < c.earlyMonths ? c.earlyMonthly : c.steadyMonthly); if (surv < 1e-4) break; }
  return {
    largeFarms, headOnLarge, avgHeadLarge, mixAvg, mediumFarms, upperMedium, tiers, samG, samGFarms, ganArpu,
    expectedLifeMonths: life,
    samGAtOldFlat: largeFarms * a.price.oldFlatPrice * 12,
    tamG: m.ni_cattle_producers * entry.price * 12,
    tamB_us: m.us_latino_employer_firms * a.price.business * 12,
    samB: (m.mo_restaurants + m.ni_mipymes_urban_formal) * a.price.business * 12,
    samB_farms: m.mo_restaurants + m.ni_mipymes_urban_formal,
    affordability: {
      bizNi: (a.price.business * 12) / m.gdp_pc_ni, bizUs: (a.price.business * 12) / m.gdp_pc_us,
      tier: Object.fromEntries(keys.map((k) => [k, (T[k].price * 12) / m.gdp_pc_ni])),
    },
  };
}

// ── The month-by-month cohort engine ────────────────────────────────────────
// `o` overrides one or more assumptions for a scenario or a sensitivity case:
//   { pilotConversion, ganArpu, acq, acqScale, churn: {…}, capacity: {…}, capacityConstrained }
export function run(a, o = {}) {
  const H = a.horizon;
  const d = derive(a);
  const churn = { ...a.churn, ...(o.churn || {}) };
  const acq = o.acq || (o.acqScale != null ? scaleAcq(a.acq, o.acqScale) : a.acq);
  const conv = o.pilotConversion ?? a.pilotConversion;
  const ganArpu = o.ganArpu ?? d.ganArpu;
  const cap = { ...a.capacity, ...(o.capacity || {}) };
  const capOn = o.capacityConstrained ?? true;
  const prices = { usB: a.price.business, niB: a.price.business, niG: ganArpu };
  const segs = ['usB', 'niB', 'niG'];

  const cohorts = Object.fromEntries(segs.map((s) => [s, []]));
  const months = [];
  let cash = a.cost.openingCash;
  const fixedMo = a.cost.supabase + a.cost.vercel + a.cost.tools + a.cost.professional;
  const W = a.cost.drawTrailingMonths;
  const hist = [];
  let drawOn = false;

  for (let i = 1; i <= H; i++) {
    for (const s of segs) for (const c of cohorts[s]) {
      const age = i - c.start;
      if (age >= 1) c.n *= 1 - (age <= churn.earlyMonths ? churn.earlyMonthly : churn.steadyMonthly);
    }
    let pilotsIn = 0;
    if (i === a.pilotConvertMonth) for (const s of segs) if (a.pilots[s]) { cohorts[s].push({ start: i, n: a.pilots[s] * conv }); pilotsIn += a.pilots[s] * conv; }
    const existing = segs.reduce((t, s) => t + cohorts[s].reduce((x, c) => x + c.n, 0), 0) - pilotsIn;
    const contractH = lerp(cap.contractHours, i, H);
    const supportH = existing * cap.supportHoursPerCustomer;
    const hoursForNew = Math.max(0, cap.founderSellingHours + contractH - supportH);
    const maxNew = hoursForNew / cap.hoursPerNewCustomer;
    const plan = Object.fromEntries(segs.map((s) => [s, lerp(acq[s], i, H)]));
    const planTotal = segs.reduce((t, s) => t + plan[s], 0);
    const scale = capOn && planTotal > maxNew ? maxNew / planTotal : 1;
    const added = {};
    for (const s of segs) { added[s] = plan[s] * scale; if (added[s] > 0) cohorts[s].push({ start: i, n: added[s] }); }
    const newActual = segs.reduce((t, s) => t + added[s], 0);

    const cust = Object.fromEntries(segs.map((s) => [s, cohorts[s].reduce((x, c) => x + c.n, 0)]));
    const total = segs.reduce((t, s) => t + cust[s], 0);
    const mrrBy = Object.fromEntries(segs.map((s) => [s, cust[s] * prices[s]]));
    const mrr = segs.reduce((t, s) => t + mrrBy[s], 0);
    const revenue = mrr;
    const cogs = revenue * (1 - a.grossMargin);
    const infra = Math.ceil(total / a.cost.infraStepCustomers) * a.cost.infraStepCost;
    const sm = newActual * a.cost.cashCAC;
    const contract = contractH * cap.contractRate;
    const opBeforeDraw = revenue - cogs - fixedMo - infra - sm - contract;
    hist.push(opBeforeDraw);
    if (a.cost.founderDrawWhenCovered && !drawOn && i >= W && hist.slice(-W).reduce((t, x) => t + x, 0) / W >= a.cost.founderDraw) drawOn = true;
    const draw = drawOn ? a.cost.founderDraw : 0;
    const profit = opBeforeDraw - draw;

    // Cash: a share of joiners prepay (12 − free) months at their ARPU; those
    // customers are then not billed monthly. Everyone else pays as they go.
    const joiners = newActual + pilotsIn;
    const arpu = total > 0 ? mrr / total : 0;
    const prepayIn = a.price.annualPrepayShare * joiners * (12 - a.price.annualPrepayMonthsFree) * arpu;
    const notBilledMonthly = a.price.annualPrepayShare * mrr;
    cash += (revenue - notBilledMonthly + prepayIn) - cogs - fixedMo - infra - sm - contract - draw;

    const hoursNeeded = supportH + newActual * cap.hoursPerNewCustomer;
    months.push({
      i, label: monthLabel(a.startMonth, i - 1),
      newPlan: planTotal, newActual, capped: scale < 0.999, maxNew,
      cust, total, mrrBy, mrr, revenue, cogs, opex: fixedMo + infra + sm + contract, contract, draw, profit, opBeforeDraw, cash,
      hoursNeeded, hoursFounder: Math.max(0, hoursNeeded - contractH), hoursAvailable: cap.founderSellingHours + contractH, contractH, drawOn,
    });
  }

  const years = [0, 1, 2].map((y) => {
    const ms = months.slice(y * 12, y * 12 + 12); const last = ms[ms.length - 1];
    const sum = (k) => ms.reduce((t, m) => t + m[k], 0);
    return {
      year: y + 1, label: last.label, revenue: sum('revenue'), costs: sum('opex') + sum('cogs'), draw: sum('draw'),
      profit: sum('profit'), profitBeforeDraw: sum('opBeforeDraw'),
      endCustomers: last.total, endMRR: last.mrr, endARR: last.mrr * 12, endCash: last.cash,
      newPlan: sum('newPlan'), newActual: sum('newActual'), cappedMonths: ms.filter((m) => m.capped).length,
      hoursFounderPeak: Math.max(...ms.map((m) => m.hoursFounder)),
    };
  });

  const gm = a.grossMargin, life = d.expectedLifeMonths;
  const trueCac = a.cost.cashCAC + cap.hoursPerNewCustomer * cap.founderHourValue;
  const last = months[H - 1];
  const blended = last.total ? last.mrr / last.total : (prices.usB + ganArpu) / 2;
  const fixedYr = fixedMo * 12;
  const gpPerCustYr = blended * gm * 12;
  const contractYr3 = lerp(cap.contractHours, 36, H) * cap.contractRate * 12;
  const breakeven = { fixed: fixedYr / gpPerCustYr, fixedPlusHelp: (fixedYr + contractYr3) / gpPerCustYr, founderDraw: (fixedYr + contractYr3 + a.cost.founderDraw * 12) / gpPerCustYr, blendedArpu: blended };
  return {
    months, years, prices, blendedArpu: blended, fixedYr, fixedMo,
    unit: { bizArpu: prices.usB, ganArpu, life, ltvB: prices.usB * gm * life, ltvG: ganArpu * gm * life, cashCac: a.cost.cashCAC, trueCac,
      ltvCacB: (prices.usB * gm * life) / trueCac, ltvCacG: (ganArpu * gm * life) / trueCac,
      paybackB: trueCac / (prices.usB * gm), paybackG: trueCac / (ganArpu * gm) },
    breakeven: { ...breakeven, fixedN: Math.ceil(breakeven.fixed), fixedPlusHelpN: Math.ceil(breakeven.fixedPlusHelp), founderDrawN: Math.ceil(breakeven.founderDraw) },
    drawStartsMonth: months.find((m) => m.drawOn)?.label || null,
    cashLow: months.reduce((lo, m) => (m.cash < lo.cash ? m : lo), months[0]),
    derived: d,
  };
}

// ── Sensitivity: one assumption moved at a time, Year-3 ARR read off ────────
// A case is { key, label, param, hi, lo }. `param` names the one input moved;
// the case's name is built from its values so an edit to the values renames it.
const PARAM = {
  acqScale:            { over: (v) => ({ acqScale: v }),                          one: (v) => `${v >= 1 ? '+' : '−'}${Math.round(Math.abs(v - 1) * 100)}%` },
  founderSellingHours: { over: (v) => ({ capacity: { founderSellingHours: v } }), one: (v) => String(v), suffix: ' a month' },
  steadyMonthly:       { over: (v) => ({ churn: { steadyMonthly: v } }),          one: (v) => `${(v * 100).toFixed(1)}%` },
  earlyMonthly:        { over: (v) => ({ churn: { earlyMonthly: v } }),           one: (v) => `${Math.round(v * 100)}%` },
  ganArpu:             { over: (v) => ({ ganArpu: v }),                           one: (v) => `all $${v}` },
  pilotConversion:     { over: (v) => ({ pilotConversion: v }),                   one: (v, a) => `${Math.round(v * pilotsTotal(a))} of ${pilotsTotal(a)}` },
};
export const SENSITIVITY_PARAMS = Object.keys(PARAM);
const pilotsTotal = (a) => Object.values(a.pilots).reduce((s, n) => s + n, 0);

export function sensitivity(a) {
  const base = run(a).years[2].endARR;
  return a.sensitivity.map((c) => {
    const p = PARAM[c.param];
    const high = run(a, p.over(c.hi)).years[2].endARR, low = run(a, p.over(c.lo)).years[2].endARR;
    const hiLabel = p.one(c.hi, a), loLabel = p.one(c.lo, a);
    return { key: c.key, label: c.label, param: c.param, hiVal: c.hi, loVal: c.lo, hiLabel, loLabel, name: `${c.label} ${hiLabel} / ${loLabel}${p.suffix || ''}`, base, high, low, swing: high - low };
  }).sort((x, y) => Math.abs(y.swing) - Math.abs(x.swing));
}

// ── Scenarios: the same engine with a few things changed at once ────────────
export function scenarios(a) {
  return Object.fromEntries(Object.entries(a.scenarios).map(([k, s]) => {
    const { label, ...over } = s;
    return [k, { label, ...run(a, over) }];
  }));
}

// ── Everything the pages, the documents and the files read ──────────────────
export function compute(a) {
  const D = derive(a), B = run(a), S = scenarios(a), Se = sensitivity(a);
  const keys = a.price.ganaderia.map((t) => t.key), T = tierMap(a), entry = a.price.ganaderia[0];
  const capped = B.months.filter((m) => m.capped);
  const planNew = B.years.reduce((t, y) => t + y.newPlan, 0), allowedNew = B.years.reduce((t, y) => t + y.newActual, 0);
  const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const herdMedian = med(a.competitors.herd.map((c) => c.price));
  const pilotsN = pilotsTotal(a);
  const scen = (k) => ({ key: k, label: S[k].label, endCustomers: S[k].years[2].endCustomers, endARR: S[k].years[2].endARR, profitY3: S[k].years[2].profit, endCash: S[k].years[2].endCash, drawStartsMonth: S[k].drawStartsMonth, years: S[k].years, mrr: S[k].months.map((m) => m.mrr), total: S[k].months.map((m) => m.total), cash: S[k].months.map((m) => m.cash) });
  return {
    A: a, startMonth: a.startMonth, horizon: a.horizon,
    prices: {
      business: a.price.business,
      ganaderia: a.price.ganaderia.map((t) => ({ key: t.key, tier: t.tier, maxHead: t.maxHead, price: t.price })),
      entry: entry.price, top: a.price.ganaderia[a.price.ganaderia.length - 1].price, oldFlat: a.price.oldFlatPrice,
      entryShareOfOldFlat: entry.price / a.price.oldFlatPrice, entryVsHerdMedian: entry.price / herdMedian, herdMedian,
    },
    tiers: keys.map((k) => ({ key: k, tier: T[k].tier, maxHead: T[k].maxHead, farms: D.tiers[k].farms, price: D.tiers[k].price, valueYr: D.tiers[k].farms * D.tiers[k].price * 12, shareOfLarge: a.tierMixLarge[k], avgHead: a.avgHeadByTier[k], planMix: a.planCustomerMix[k], affordability: D.affordability.tier[k] })),
    market: {
      producers: a.market.ni_cattle_producers, herd: a.market.ni_herd_head, shareSmallMedium: a.market.ni_share_small_medium_farms, shareHerdOnSmallMedium: a.market.ni_share_herd_on_small_medium, shareHerdOnLarge: 1 - a.market.ni_share_herd_on_small_medium,
      largeFarms: D.largeFarms, headOnLarge: D.headOnLarge, avgHeadLarge: D.avgHeadLarge, mixAvg: D.mixAvg, mediumFarms: D.mediumFarms, upperMedium: D.upperMedium,
      samGFarms: D.samGFarms, samG: D.samG, samGAtOldFlat: D.samGAtOldFlat, tamG: D.tamG,
      usLatinoFirms: a.market.us_latino_employer_firms, tamB_us: D.tamB_us, samB_farms: D.samB_farms, samB: D.samB, moRestaurants: a.market.mo_restaurants, niMipymes: a.market.ni_mipymes_urban_formal,
      gdpNi: a.market.gdp_pc_ni, gdpUs: a.market.gdp_pc_us,
      somShare: B.years[2].endCustomers / (D.samGFarms + D.samB_farms),
    },
    affordability: D.affordability,
    unit: B.unit, breakeven: B.breakeven, blendedArpu: B.blendedArpu, drawStartsMonth: B.drawStartsMonth,
    cashLow: { label: B.cashLow.label, cash: B.cashLow.cash },
    capped: { count: capped.length, first: capped[0]?.label || null },
    totals: { planNew, allowedNew },
    pilots: { total: pilotsN, converting: pilotsN * a.pilotConversion, conversion: a.pilotConversion, month: a.pilotConvertMonth, monthLabel: monthLabel(a.startMonth, a.pilotConvertMonth - 1) },
    costs: { fixedMonthly: B.fixedMo, fixedYr: B.fixedYr, platformMonthly: a.cost.supabase + a.cost.vercel + a.cost.tools, platformYr: (a.cost.supabase + a.cost.vercel + a.cost.tools) * 12, founderDraw: a.cost.founderDraw, founderDrawYr: a.cost.founderDraw * 12, cashCAC: a.cost.cashCAC },
    monthly: B.months.map((m) => ({ i: m.i, label: m.label, newPlan: m.newPlan, newActual: m.newActual, capped: m.capped, maxNew: m.maxNew, total: m.total, cust: m.cust, mrr: m.mrr, mrrBy: m.mrrBy, revenue: m.revenue, cogs: m.cogs, opex: m.opex, contract: m.contract, draw: m.draw, profit: m.profit, opBeforeDraw: m.opBeforeDraw, cash: m.cash, hoursNeeded: m.hoursNeeded, hoursFounder: m.hoursFounder, hoursAvailable: m.hoursAvailable, contractH: m.contractH })),
    years: B.years,
    scenarios: Object.fromEntries(Object.keys(S).map((k) => [k, scen(k)])), scenarioOrder: Object.keys(S),
    sensitivity: Se, sens: Object.fromEntries(Se.map((s) => [s.key, s])),
    competitors: { herd: a.competitors.herd, business: a.competitors.business, herdMedian },
    sources: a.sources,
    meta: a.meta || {},
  };
}
