import { describe, expect, it } from 'vitest';
import { colName, sheet, toWorkbook, FMT } from '../src/lib/workbook.js';
import { pnlByMonthSheet, balanceSheetSheet, cashBridgeSheet } from '../src/lib/reportWorkbooks.js';
import { balanceSheet, cashBridge, lastMonths, pnlByMonth } from '../src/lib/series.js';
import { evaluator, formulas } from './helpers/formula.js';
import { makeBusiness } from './fixtures/synthetic-business.js';

// The Reports page's workbooks, on the synthetic restaurant: every formula
// recomputes to the value stored with it, the totals are formulas (not typed
// numbers), and the real exceljs workbook carries the formulas and the
// close-package layout.

const TODAY = '2026-11-07';
const b = makeBusiness({ today: TODAY });
const { transactions: tx, categories, statements } = b.data;
const year = lastMonths('2026-12', 12); // Jan–Dec 2026
const L = {
  title: 'Profit and loss by month — 2026', sheet: 'P&L by month', account: 'Account', total: 'Total', revenue: 'Revenue', expenses: 'Expenses',
  totalRevenue: 'Total revenue', totalExpenses: 'Total expenses', netIncome: 'Net income', month: (m) => m,
};
const BL = {
  title: 'Balance sheet — as of 2026-10-31', sheet: 'Balance sheet', section: 'Section', account: 'Account', amount: 'Amount', assets: 'Assets', liabilities: 'Liabilities', equity: 'Equity',
  totalAssets: 'Total assets', totalLiabilities: 'Total liabilities', totalEquity: 'Total equity', retained: 'Retained earnings', netIncome: 'Net income this year',
  liabilitiesAndEquity: 'Liabilities and equity', check: 'Check',
};
const CL = { title: 'Cash bridge — 2026', sheet: 'Cash bridge', step: 'Step', amount: 'Amount', balance: 'Balance', opening: 'Opening balance', closing: 'Closing balance', net: 'Net change', printed: 'Printed ending balance', difference: 'Difference', stepLabel: (k) => k };

function everyFormulaHolds(s) {
  const run = evaluator(s);
  const fs = formulas(s);
  expect(fs.length).toBeGreaterThan(0);
  for (const { ref, f, v } of fs) expect(Math.abs(run(f) - v), `${ref} ${f}`).toBeLessThan(0.01);
  return fs;
}

describe('workbook helpers', () => {
  it('names columns past Z', () => {
    expect([1, 26, 27, 52, 53].map(colName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA']);
  });
  it('keeps sheet names inside Excel\'s rules', () => {
    expect(sheet('P&L: 2026/27 [draft] with a very long name', 't', []).name).toBe('P&L  2026 27  draft  with a ver');
  });
});

describe('P&L by month', () => {
  const pnl = pnlByMonth(tx, categories, year);
  const s = pnlByMonthSheet(pnl, L);
  it('every formula recomputes to its value', () => { everyFormulaHolds(s); });
  it('net income for the year matches the series, and is a formula', () => {
    const net = s.rows.at(-1);
    expect(net.cells[0]).toBe('Net income');
    expect(net.cells[13].f).toBe('N' + (s.rows.findIndex((r) => r.cells[0] === 'Total revenue') + 3) + '-N' + (s.rows.findIndex((r) => r.cells[0] === 'Total expenses') + 3));
    expect(net.cells[13].v).toBeCloseTo(pnl.reduce((t, p) => t + p.net, 0), 1);
  });
  it('the header is the account, twelve months and the total', () => {
    expect(s.header).toHaveLength(14);
  });
  it('cash basis builds too', () => { everyFormulaHolds(pnlByMonthSheet(pnlByMonth(tx, categories, year, { basis: 'cash' }), L)); });
});

describe('balance sheet', () => {
  const bs = balanceSheet(tx, categories, '2026-10-31');
  const s = balanceSheetSheet(bs, BL);
  it('balances on the synthetic books', () => { expect(bs.difference).toBeCloseTo(0, 2); });
  it('every formula recomputes, and the check row is zero', () => {
    everyFormulaHolds(s);
    expect(s.rows.at(-1).cells[2].v).toBeCloseTo(0, 2);
  });
  it('profit shows as retained earnings and this year\'s net income', () => {
    expect(s.rows.some((r) => r.cells[1] === 'Retained earnings')).toBe(true);
    expect(s.rows.some((r) => r.cells[1] === 'Net income this year')).toBe(true);
  });
});

describe('cash bridge', () => {
  it('ties to the last statement\'s printed balance', () => {
    const s = cashBridgeSheet(cashBridge(tx, categories, statements, year), CL);
    everyFormulaHolds(s);
    expect(s.rows.at(-1).cells[0]).toBe('Difference');
    expect(s.rows.at(-1).cells[1].v).toBeCloseTo(0, 2);
  });
  it('without balances it is the net change', () => {
    const bare = statements.map((x) => ({ ...x, statement_totals: null }));
    const s = cashBridgeSheet(cashBridge(tx, categories, bare, year), CL);
    everyFormulaHolds(s);
    expect(s.rows.at(-1).cells[0]).toBe('Net change');
  });
});

describe('exceljs workbook', () => {
  it('carries the formulas, the frozen header band and the money format', async () => {
    const s = pnlByMonthSheet(pnlByMonth(tx, categories, year), L);
    const wb = await toWorkbook([s]);
    const ws = wb.getWorksheet('P&L by month');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 2 });
    expect(ws.getCell('A1').value).toBe(L.title);
    expect(ws.getCell('A2').font.bold).toBe(true);
    const totalRow = s.rows.findIndex((r) => r.cells[0] === 'Total revenue') + 3;
    const c = ws.getCell(`B${totalRow}`);
    expect(c.value.formula).toMatch(/^SUM\(B\d+:B\d+\)$/);
    expect(c.numFmt).toBe(FMT.usd);
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(4000);
  });
});
