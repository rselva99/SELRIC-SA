// A made-up competitor market for the tests: one SelRic row priced from the
// model through a token, four competitors covering the edge cases — a free
// entry tier, a free plan inside the tiers, one with no comparable price, and
// one dearer than us. Names and prices are invented.
export const syntheticMarket = {
  features: [
    { key: 'feeds', label: 'Feeds', es: 'Conexiones', group: 'infra' },
    { key: 'mobile', label: 'Mobile', es: 'Móvil', group: 'infra' },
    { key: 'spanish', label: 'Spanish', es: 'Español', group: 'market' },
    { key: 'flat', label: 'Flat price', es: 'Precio fijo', group: 'ours' },
  ],
  competitors: [
    { key: 'selric', name: 'Us', self: true, region: 'Here', pricing: { priceToken: 'prices.business', tiers: [] }, features: { feeds: 0, mobile: 0, spanish: 2, flat: 2 } },
    { key: 'a', name: 'Alpha', region: 'X', pricing: { entryUsdMonth: 0, comparableUsdMonth: 8, tiers: [{ name: 'Free', usdMonth: 0 }, { name: 'Pro', usdMonth: 8 }] }, features: { feeds: 2, mobile: 2, spanish: 0, flat: 0 }, betterAtUs: ['feeds'], weakerThanUs: ['no Spanish'] },
    { key: 'b', name: 'Beta', region: 'Y', pricing: { entryUsdMonth: 3, comparableUsdMonth: 6, tiers: [{ name: 'Lite', usdMonth: 0 }, { name: 'Std', usdMonth: 6 }] }, features: { feeds: 1, mobile: 2, spanish: 1, flat: 0 } },
    { key: 'c', name: 'Gamma', region: 'Z', pricing: { entryUsdMonth: 5, comparableUsdMonth: null, tiers: [] }, features: { feeds: 0, mobile: 1, spanish: 2, flat: 1 } },
    { key: 'd', name: 'Delta', region: 'Z', pricing: { entryUsdMonth: 20, comparableUsdMonth: 30, tiers: [{ name: 'Only', usdMonth: 30 }] }, features: { feeds: 2, mobile: 0, spanish: 0, flat: 2 } },
  ],
};

// The same market priced by herd-size tiers (the Ganadería shape).
export const syntheticTieredMarket = {
  ...syntheticMarket,
  competitors: syntheticMarket.competitors.map((c) => (c.self ? { ...c, pricing: { priceToken: 'tiers', tiers: [] } } : c)),
};
