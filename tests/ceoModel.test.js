import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { compute, derive, run, monthLabel } from '../src/lib/ceoModel.js';
import { syntheticAssumptions } from './fixtures/synthetic-model.js';
import { privateData } from './helpers/private.js';

// Relative tolerance: the golden values are the engine's own floats, so any
// difference beyond rounding noise is a change in behaviour.
const close = (got, want) => expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)));

describe('ceoModel — invariants on synthetic assumptions', () => {
  const a = syntheticAssumptions();
  const R = compute(a);

  it('runs the horizon month by month from the start month', () => {
    expect(R.monthly).toHaveLength(a.horizon);
    R.monthly.forEach((m, i) => expect(m.label).toBe(monthLabel(a.startMonth, i)));
    expect(R.years).toHaveLength(3);
    R.years.forEach((y) => close(y.endARR, y.endMRR * 12));
  });

  it('keeps cash equal to opening cash plus every month’s flow when nobody prepays', () => {
    const r = run(syntheticAssumptions({ price: { annualPrepayShare: 0 } }));
    let cash = 0;
    for (const m of r.months) { cash += m.revenue - m.cogs - m.opex - m.draw; close(m.cash, cash); }
  });

  it('never acquires more than the hours allow, and caps only when it must', () => {
    const tight = run(syntheticAssumptions({ acq: { usB: [5, 5, 5, 5], niB: [5, 5, 5, 5], niG: [5, 5, 5, 5] }, capacity: { founderSellingHours: 5 } }));
    expect(tight.months.some((m) => m.capped)).toBe(true);
    for (const m of tight.months) expect(m.newActual).toBeLessThanOrEqual(m.maxNew + 1e-9);
    expect(run(a).months.some((m) => m.capped)).toBe(false);
  });

  it('lets the uncapped scenario reach at least the base case', () => {
    const tight = syntheticAssumptions({ capacity: { founderSellingHours: 5 } });
    const T = compute(tight);
    expect(T.scenarios.open.endCustomers).toBeGreaterThanOrEqual(T.scenarios.base.endCustomers - 1e-9);
  });

  it('runs every scenario the assumptions name, and Base equals the plain run', () => {
    expect(R.scenarioOrder).toEqual(Object.keys(a.scenarios));
    close(R.scenarios.base.endARR, R.years[2].endARR);
  });

  it('sorts sensitivity by swing and names each case from its values', () => {
    const swings = R.sensitivity.map((s) => Math.abs(s.swing));
    expect([...swings].sort((x, y) => y - x)).toEqual(swings);
    expect(R.sens.acq.name).toBe('Acquisition +50% / −50%');
    expect(R.sens.hours.name).toBe('Hours 2000 / 10 a month');
    R.sensitivity.forEach((s) => close(s.swing, s.high - s.low));
  });

  it('orders break-even: fixed ≤ fixed + help ≤ paying the founder', () => {
    expect(R.breakeven.fixed).toBeLessThanOrEqual(R.breakeven.fixedPlusHelp);
    expect(R.breakeven.fixedPlusHelp).toBeLessThanOrEqual(R.breakeven.founderDraw);
    expect(R.breakeven.fixedPlusHelpN).toBe(Math.ceil(R.breakeven.fixedPlusHelp));
  });

  it('derives the market from the inputs, with the tiers summing to the SAM', () => {
    const d = derive(a);
    expect(Object.values(d.tiers).reduce((s, t) => s + t.farms, 0)).toBe(d.samGFarms);
    close(d.ganArpu, 0.4 * 4 + 0.4 * 6 + 0.2 * 8);
    close(d.affordability.bizNi, (10 * 12) / 1000);
  });

  it('moves with an input: a higher business price raises Year-3 ARR', () => {
    const up = compute(syntheticAssumptions({ price: { business: 20 } }));
    expect(up.years[2].endARR).toBeGreaterThan(R.years[2].endARR);
  });
});

describe('ceoModel — holds no constants', () => {
  // Structural literals only: month knots (1, 12, 24, 36), small counters and
  // indexes, percent formatting (100), label slicing (7), the life-sum cutoff
  // (600, 1e-4) and the cap tolerance (0.999). A business number added to the
  // engine shows up here first.
  const ALLOWED = new Set(['0', '1', '2', '3', '7', '12', '24', '36', '100', '600', '1e-4', '0.999']);
  it('has no numeric literal outside the structural allow-list', () => {
    const src = readFileSync(new URL('../src/lib/ceoModel.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const found = [...src.matchAll(/(?<![A-Za-z_0-9.])\d+(?:\.\d+)?(?:e-?\d+)?/g)].map((m) => m[0]);
    expect([...new Set(found.filter((n) => !ALLOWED.has(n)))]).toEqual([]);
  });
});

const P = privateData();
describe.skipIf(!P)('ceoModel — golden fixture (outside the repo)', () => {
  const R = P ? compute(P.assumptions) : null;
  const E = P?.expected;

  it('reproduces the three years to the cent', () => {
    E.years.forEach((y, i) => { for (const k of Object.keys(y)) (typeof y[k] === 'number' ? close(R.years[i][k], y[k]) : expect(R.years[i][k]).toBe(y[k])); });
  });
  it('reproduces break-even, unit economics, the draw month and the cash low', () => {
    for (const k of Object.keys(E.breakeven)) close(R.breakeven[k], E.breakeven[k]);
    for (const k of Object.keys(E.unit)) close(R.unit[k], E.unit[k]);
    expect(R.drawStartsMonth).toBe(E.drawStartsMonth);
    close(R.cashLow.cash, E.cashLow.cash);
    expect(R.cashLow.label).toBe(E.cashLow.label);
    expect(R.capped).toEqual(E.capped);
  });
  it('reproduces every scenario and sensitivity case', () => {
    for (const [k, s] of Object.entries(E.scenarios)) { close(R.scenarios[k].endARR, s.endARR); close(R.scenarios[k].endCash, s.endCash); expect(R.scenarios[k].drawStartsMonth).toBe(s.drawStartsMonth); }
    E.sensitivity.forEach((s) => { const g = R.sens[s.key]; expect(g.name).toBe(s.name); close(g.low, s.low); close(g.high, s.high); });
  });
  it('reproduces every month and the market', () => {
    E.monthly.forEach((m, i) => { close(R.monthly[i].total, m.total); close(R.monthly[i].mrr, m.mrr); close(R.monthly[i].cash, m.cash); expect(R.monthly[i].capped).toBe(m.capped); });
    for (const k of Object.keys(E.market)) close(R.market[k], E.market[k]);
  });
});
