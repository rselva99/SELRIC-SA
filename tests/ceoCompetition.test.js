import { describe, expect, it } from 'vitest';
import { stats, ladderRows, matrix, sortByFeature, featureTotal, median, selfPrices } from '../src/lib/ceoCompetition.js';
import { syntheticMarket, syntheticTieredMarket } from './fixtures/synthetic-competition.js';

// A stand-in for compute(): only the paths the price tokens read.
const R = { prices: { business: 10 }, tiers: [{ tier: 'S', price: 4 }, { tier: 'M', price: 7 }, { tier: 'L', price: 12 }] };

describe('ceoCompetition — stats', () => {
  const S = stats(syntheticMarket, R);

  it('prices our own row from the model, not from the dataset', () => {
    expect(S.ours).toBe(10);
    expect(stats(syntheticMarket, { prices: { business: 25 } }).ours).toBe(25);
  });

  it('counts over every competitor — one denominator for cheaper and free', () => {
    expect(S.total).toBe(4);
    expect(S.compared).toBe(3);      // Gamma has no comparable price
    expect(S.cheaper).toBe(2);       // Alpha 8 and Beta 6 are under 10; Delta 30 is not; Gamma is n/a
    expect(S.freeTier).toBe(2);      // Alpha (entry 0) and Beta (a $0 tier)
  });

  it('takes medians over the field, ignoring missing prices', () => {
    expect(S.medianEntry).toBe(4);           // 0, 3, 5, 20
    expect(S.medianComparable).toBe(8);      // 6, 8, 30
    expect(median([null, 1, undefined, 3])).toBe(2);
    expect(median([])).toBeNull();
  });

  it('uses the middle tier as comparable and keeps all tiers as ticks for a tiered price', () => {
    const T = stats(syntheticTieredMarket, R);
    expect(T.ours).toBe(7);
    expect(T.ticks.map((t) => t.price)).toEqual([4, 7, 12]);
    expect(T.cheaper).toBe(1);               // only Beta (6) is under 7
    expect(selfPrices(syntheticTieredMarket.competitors[0], R).top).toBe(12);
  });
});

describe('ceoCompetition — ladder and matrix', () => {
  it('lists every competitor in the ladder, dearest first, n/a last', () => {
    const rows = ladderRows(syntheticMarket, R);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.key)).toEqual(['d', 'selric', 'a', 'b', 'c']);
    expect(rows.at(-1).comparable).toBeNull();
  });

  it('groups the features infra → market → ours and pins us first', () => {
    const M = matrix(syntheticMarket, 'es');
    expect(M.groups.map((g) => g.key)).toEqual(['infra', 'market', 'ours']);
    expect(M.groups[0].features.map((f) => f.label)).toEqual(['Conexiones', 'Móvil']);
    expect(M.rows[0].self).toBe(true);
  });

  it('sorts by a feature and keeps us pinned', () => {
    const M = matrix(syntheticMarket);
    const sorted = sortByFeature(M.rows, 'feeds');
    expect(sorted[0].self).toBe(true);
    expect(sorted.slice(1).map((r) => r.scores.feeds)).toEqual([2, 2, 1, 0]);
    expect(featureTotal(M.rows[0], M.groups)).toBe(4);
  });
});
