// A made-up assumptions object with the engine's shape. Every number here is
// invented for the tests — round, deliberately unlike any real plan — so the
// engine's behaviour can be tested in a public repository. It must never be
// edited to resemble the real assumptions.
export function syntheticAssumptions(over = {}) {
  const a = {
    startMonth: '2030-01',
    horizon: 36,
    price: {
      business: 10,
      ganaderia: [
        { key: 't50', tier: 'Small', maxHead: 10, price: 4 },
        { key: 't75', tier: 'Medium', maxHead: 20, price: 6 },
        { key: 't100', tier: 'Large', maxHead: null, price: 8 },
      ],
      oldFlatPrice: 20,
      annualPrepayMonthsFree: 1,
      annualPrepayShare: 0.1,
    },
    market: {
      ni_cattle_producers: 1000, ni_herd_head: 40000,
      ni_share_small_medium_farms: 0.9, ni_share_herd_on_small_medium: 0.5, ni_medium_share_of_producers: 0.2,
      ni_mipymes_urban_formal: 500, us_latino_employer_firms: 2000, mo_restaurants: 300,
      gdp_pc_ni: 1000, gdp_pc_us: 10000,
    },
    tierMixLarge: { t50: 0.5, t75: 0.3, t100: 0.2 },
    avgHeadByTier: { t50: 10, t75: 20, t100: 40 },
    planCustomerMix: { t50: 0.4, t75: 0.4, t100: 0.2 },
    acq: { usB: [1, 1, 1, 1], niB: [1, 1, 1, 1], niG: [1, 1, 1, 1] },
    pilots: { usB: 1, niB: 1, niG: 0 },
    pilotConversion: 0.5,
    pilotConvertMonth: 2,
    churn: { earlyMonths: 2, earlyMonthly: 0.1, steadyMonthly: 0.02 },
    grossMargin: 0.9,
    capacity: {
      founderSellingHours: 1000, hoursPerNewCustomer: 1, supportHoursPerCustomer: 0.1,
      contractHours: [0, 10, 10, 10], contractRate: 10, founderHourValue: 10,
    },
    cost: {
      supabase: 1, vercel: 1, tools: 1, professional: 1,
      infraStepCost: 1, infraStepCustomers: 10, cashCAC: 1,
      founderDraw: 5, founderDrawWhenCovered: true, drawTrailingMonths: 2, openingCash: 0,
    },
    scenarios: {
      low: { label: 'Low', acqScale: 0.5 },
      base: { label: 'Base' },
      high: { label: 'High', acqScale: 2 },
      open: { label: 'Uncapped', capacityConstrained: false },
    },
    sensitivity: [
      { key: 'acq', label: 'Acquisition', param: 'acqScale', hi: 1.5, lo: 0.5 },
      { key: 'hours', label: 'Hours', param: 'founderSellingHours', hi: 2000, lo: 10 },
      { key: 'churn', label: 'Churn', param: 'steadyMonthly', hi: 0.01, lo: 0.05 },
    ],
    competitors: { herd: [{ name: 'Herd A', price: 3 }], business: [{ name: 'Books A', price: 5 }] },
    sources: ['made up for tests'],
    meta: {},
  };
  return deepMerge(a, over);
}

function deepMerge(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b === undefined ? a : b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) && typeof a?.[k] === 'object' ? deepMerge(a[k], v) : v;
  return out;
}
