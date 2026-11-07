import { describe, expect, it } from 'vitest';
import { aggregateForPnL } from '../src/lib/finance.js';
import {
  lastMonths, pnlByMonth, cashByMonth, revenueByCategory, expenseMix, salesTaxByMonth,
  merchantFeesByMonth, checkPool, cashBridge, waterfallBars, bridgeGroup,
} from '../src/lib/series.js';
import { makeBusiness } from './fixtures/synthetic-business.js';

// The chart and report series, on the synthetic restaurant (every number
// invented). The invariants tie each series back to finance.js or to the
// statements, so a chart can never disagree with the books it draws.

const TODAY = '2026-11-07';
const b = makeBusiness({ today: TODAY });
const { transactions: tx, categories, statements, checks } = b.data;
const months = lastMonths('2026-11', 12);
const close = (a, x) => expect(Math.abs(a - x)).toBeLessThan(0.02);

describe('months', () => {
  it('lastMonths runs oldest first across a year end', () => {
    expect(lastMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(months).toHaveLength(12);
    expect(months.at(-1)).toBe('2026-11');
  });
});

describe('P&L by month', () => {
  const pnl = pnlByMonth(tx, categories, months);
  it('sums to aggregateForPnL over the whole window', () => {
    const window = tx.filter((t) => !t.voided && t.date >= `${months[0]}-01` && !String(t.reference || '').startsWith('CASH-LEG-'));
    const whole = aggregateForPnL(window, categories);
    close(pnl.reduce((s, p) => s + p.revenue, 0), whole.totalRevenue);
    close(pnl.reduce((s, p) => s + p.expenses, 0), whole.totalExpenses);
  });
  it('net is revenue less expenses each month', () => {
    for (const p of pnl) close(p.net, p.revenue - p.expenses);
  });
  it('cash basis reads only bank lines', () => {
    const cash = pnlByMonth(tx, categories, months, { basis: 'cash' });
    // Sales reach the bank through merchant clearing and Cash & Bank, not a
    // revenue account, so cash-basis revenue is what was categorized there.
    expect(cash.every((p) => p.revenue === 0)).toBe(true);
    expect(cash.some((p) => p.expenses > 0)).toBe(true);
    // Depreciation is a journal entry with no bank line; rent is paid from the bank.
    for (const [i, p] of cash.entries()) {
      expect(p.expenseBy['Depreciation Expense']).toBeUndefined();
      close(p.expenseBy.Rent || 0, pnl[i].expenseBy.Rent || 0);
    }
  });
});

describe('cash', () => {
  const cash = cashByMonth(tx, months);
  it('net is in less out, from bank lines only', () => {
    for (const c of cash) close(c.net, c.inflow - c.outflow);
    expect(cash.some((c) => c.inflow > 0)).toBe(true);
  });
  it('the bridge closes on the last statement\'s printed ending balance', () => {
    const bridge = cashBridge(tx, categories, statements, months);
    const inWindow = statements.filter((s) => s.period_start >= `${months[0]}-01`).sort((x, y) => x.period_start.localeCompare(y.period_start));
    expect(bridge.opening).toBe(inWindow[0].statement_totals.beginning_balance);
    close(bridge.closing, inWindow.at(-1).statement_totals.ending_balance);
    close(bridge.steps.reduce((s, x) => s + x.delta, 0), bridge.net);
    close(cash.reduce((s, c) => s + c.net, 0), bridge.net);
  });
  it('without a statement balance the bridge shows the net change only', () => {
    const bare = statements.map((s) => ({ ...s, statement_totals: null }));
    const bridge = cashBridge(tx, categories, bare, months);
    expect(bridge.opening).toBeNull();
    expect(bridge.closing).toBeNull();
    const bars = waterfallBars(bridge, (k) => k);
    expect(bars[0].key).not.toBe('opening');
    expect(bars.at(-1)).toMatchObject({ key: 'net', kind: 'total' });
  });
  it('waterfall bars chain: each step starts where the last ended', () => {
    const bridge = cashBridge(tx, categories, statements, months);
    const bars = waterfallBars(bridge, (k) => k);
    expect(bars[0]).toMatchObject({ key: 'opening', kind: 'total' });
    let level = bars[0].value;
    for (const bar of bars.slice(1, -1)) {
      const next = level + bar.value;
      close(bar.range[0], Math.min(level, next));
      close(bar.range[1], Math.max(level, next));
      level = next;
    }
    close(bars.at(-1).value, level);
  });
  it('groups bank lines by what they paid for', () => {
    const types = new Map(categories.map((c) => [c.name, c.type]));
    expect(bridgeGroup({ type: 'debit', category: 'Payroll' }, types)).toBe('payroll');
    expect(bridgeGroup({ type: 'debit', category: 'Payroll Taxes' }, types)).toBe('taxes');
    expect(bridgeGroup({ type: 'debit', category: 'Sales Tax Payable' }, types)).toBe('taxes');
    expect(bridgeGroup({ type: 'debit', category: 'Tips Payable' }, types)).toBe('payroll');
    expect(bridgeGroup({ type: 'debit', category: 'Equipment Loan' }, types)).toBe('debt');
    expect(bridgeGroup({ type: 'debit', category: 'Rent' }, types)).toBe('operating');
    expect(bridgeGroup({ type: 'credit', category: 'Merchant Clearing' }, types)).toBe('sales');
    expect(bridgeGroup({ type: 'credit', category: 'Cash & Bank' }, types)).toBe('otherIn');
  });
});

describe('breakdowns', () => {
  const pnl = pnlByMonth(tx, categories, months);
  it('revenue by category keeps a fixed set of keys and folds the rest', () => {
    const r = revenueByCategory(pnl, 1);
    expect(r.keys).toHaveLength(1);
    expect(r.hasOther).toBe(true);
    for (const [i, row] of r.rows.entries()) close(row[r.keys[0]] + row.__other, pnl[i].revenue);
  });
  it('expense mix adds up to the window\'s expenses', () => {
    const mix = expenseMix(pnl, 4);
    expect(mix.at(-1).name).toBe('__other');
    close(mix.reduce((s, x) => s + x.value, 0), pnl.reduce((s, p) => s + p.expenses, 0));
    expect(mix[0].value).toBeGreaterThanOrEqual(mix[1].value);
  });
  it('sales tax: what is collected in a month is remitted the next', () => {
    const st = salesTaxByMonth(tx, months);
    for (let i = 1; i < st.length - 1; i++) if (st[i - 1].collected > 0 && st[i].remitted > 0) close(st[i].remitted, st[i - 1].collected);
  });
  it('merchant fees are about 2.6% of card sales', () => {
    const fees = merchantFeesByMonth(tx, categories, months).filter((m) => m.rate != null);
    expect(fees.length).toBeGreaterThan(6);
    for (const m of fees) expect(m.rate).toBeCloseTo(0.026, 3);
  });
  it('check pool counts and sums every check by status', () => {
    const pool = checkPool([...checks, { status: 'voided', amount: -50 }, { status: null, amount: 10 }]);
    expect(pool.reduce((s, x) => s + x.count, 0)).toBe(checks.length + 2);
    expect(pool.find((x) => x.status === 'voided').amount).toBe(50);
    expect(pool.find((x) => x.status === 'unclassified').count).toBe(1);
  });
});
