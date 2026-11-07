import { describe, expect, it } from 'vitest';
import {
  formatCurrency, generatePnLPdf, generateIncomeStatementPdf, generateBalanceSheetPdf,
  generateTrialBalancePdf, generateBookBalanceSheetPdf, generateAuditorPackagePdf, setReportBusinessName,
} from '../src/lib/reports.js';
import { aggregateForPnL, aggregateForBS, aggregateTrialBalance, debitOf, creditOf } from '../src/lib/finance.js';
import { makeBusiness } from './fixtures/synthetic-business.js';

// The report PDFs (src/lib/reports.js) and the aggregation they print
// (src/lib/finance.js), on the synthetic restaurant. jsPDF runs under node;
// the tests read back the text each page draws — the strings in the PDF's
// `(…) Tj` operators — so they check what a reader of the PDF would see.
// Every number is the synthetic restaurant's or written here.

const TODAY = '2026-11-07';
const { data } = makeBusiness({ today: TODAY });
const RAW = { transactions: data.transactions, categories: data.categories, period: 'Synthetic year' };

// The strings drawn on every page, in drawing order.
function texts(doc) {
  const raw = doc.output();
  return [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
}
// The string drawn right after `label` (a table cell, a total's amount).
const after = (t, label) => t[t.indexOf(label) + 1];

describe('reports — formatCurrency', () => {
  it('formats dollars with two decimals and a sign', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
    expect(formatCurrency(-0.004)).toBe('-$0.00');
    expect(formatCurrency(-1234.567)).toBe('-$1,234.57');
  });

  it('never prints $NaN: missing or broken amounts are $0.00', () => {
    for (const v of [null, undefined, 'abc', NaN, Infinity, {}]) expect(formatCurrency(v)).toBe('$0.00');
    expect(formatCurrency('12.5')).toBe('$12.50');
  });
});

describe('reports — finance aggregation', () => {
  it('P&L: revenue nets debits against credits, expenses net credits against debits, by category type', () => {
    const categories = [{ name: 'Sales', type: 'revenue' }, { name: 'Rent', type: 'expense' }, { name: 'Cash', type: 'asset' }];
    const transactions = [
      { category: 'Sales', type: 'credit', amount: 500 },
      { category: 'Sales', type: 'debit', amount: 20 },   // a refund
      { category: 'Rent', type: 'debit', amount: 300 },
      { category: 'Rent', type: 'credit', amount: 50 },   // a reversal
      { category: 'Cash', type: 'debit', amount: 999 },   // not P&L
      { category: null, type: 'credit', amount: 999 },
    ];
    const p = aggregateForPnL(transactions, categories);
    expect(p.revenue).toEqual([{ account: 'Sales', amount: 480 }]);
    expect(p.expenses).toEqual([{ account: 'Rent', amount: 250 }]);
    expect(p.totalRevenue - p.totalExpenses).toBe(230);
  });

  it('trial balance: every account on its natural side, totals equal the raw sums', () => {
    const tb = aggregateTrialBalance(data.transactions, data.categories);
    const posted = data.transactions.filter((t) => t.category);
    const round = (n) => Math.round(n * 100) / 100;
    expect(tb.totalDebits).toBeCloseTo(round(posted.reduce((s, t) => s + debitOf(t), 0)), 2);
    expect(tb.totalCredits).toBeCloseTo(round(posted.reduce((s, t) => s + creditOf(t), 0)), 2);
    for (const a of tb.accounts) expect(a.debitBalance === 0 || a.creditBalance === 0).toBe(true);
    expect(tb.imbalance).toBeCloseTo(tb.totalDebitBalance - tb.totalCreditBalance, 2);
  });

  it('trial balance: includeUnposted false drops unposted rows', () => {
    const categories = [{ name: 'Cash', type: 'asset' }];
    const transactions = [{ category: 'Cash', type: 'debit', amount: 10, posted: true }, { category: 'Cash', type: 'debit', amount: 5, posted: false }];
    expect(aggregateTrialBalance(transactions, categories).totalDebits).toBe(15);
    expect(aggregateTrialBalance(transactions, categories, { includeUnposted: false }).totalDebits).toBe(10);
  });
});

describe('reports — the P&L PDF', () => {
  const pnl = aggregateForPnL(data.transactions, data.categories);

  it('prints every revenue and expense account with its amount, the totals and the net profit', () => {
    const t = texts(generatePnLPdf(RAW));
    expect(t).toContain('Profit & Loss Statement');
    expect(t).toContain('Synthetic year');
    for (const r of [...pnl.revenue, ...pnl.expenses]) expect(after(t, r.account)).toBe(formatCurrency(r.amount));
    expect(after(t, 'Total Revenue')).toBe(formatCurrency(pnl.totalRevenue));
    expect(after(t, 'Total Expenses')).toBe(formatCurrency(pnl.totalExpenses));
    expect(t.join('|')).toContain(formatCurrency(pnl.totalRevenue - pnl.totalExpenses));
    expect(t).toContain('Confidential');
    expect(t).toContain('Page 1');
  });

  it('takes the pre-aggregated shape with a separate period label, and the income statement is the same page', () => {
    const a = texts(generatePnLPdf({ ...pnl }, 'October 2026'));
    const b = texts(generateIncomeStatementPdf({ ...pnl }, 'October 2026'));
    expect(a).toContain('October 2026');
    expect(after(a, 'Total Revenue')).toBe(formatCurrency(pnl.totalRevenue));
    // Only the generation timestamp may differ between two runs.
    expect(a.filter((s) => !s.startsWith('Generated'))).toEqual(b.filter((s) => !s.startsWith('Generated')));
  });

  it('survives empty, missing and non-ASCII input — jsPDF.text never sees null, NaN or a glyph it cannot draw', () => {
    expect(() => generatePnLPdf(null)).not.toThrow();
    expect(() => generatePnLPdf({ revenue: [{ account: null, amount: NaN }], expenses: 'x', totalRevenue: 'abc' })).not.toThrow();
    const t = texts(generatePnLPdf({ revenue: [{ account: 'Café — “special” · sales…', amount: 10 }], expenses: [], totalRevenue: 10, totalExpenses: 0 }, 'Q4'));
    expect(t).toContain('Café - "special" . sales...');
    expect(t.every((s) => [...s].every((ch) => ch.charCodeAt(0) < 256))).toBe(true);
  });

  it('with supporting detail, lists the transactions behind each account and checks they add up', () => {
    const doc = generatePnLPdf(RAW, undefined, { supportingDetail: true });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    const t = texts(doc);
    expect(t.some((s) => s.startsWith('Subtotal matches summary'))).toBe(true);
    expect(t.some((s) => s.startsWith('Subtotal does NOT match'))).toBe(false);
    // Every page carries the footer.
    for (let p = 1; p <= doc.getNumberOfPages(); p++) expect(t).toContain(`Page ${p}`);
  });

  it('prints the business name set for the session on the header', () => {
    setReportBusinessName('Synthetic Bistro');
    try {
      expect(texts(generatePnLPdf(RAW))).toContain('Synthetic Bistro');
    } finally {
      setReportBusinessName(null);
    }
  });
});

describe('reports — the balance sheet PDF', () => {
  it('prints assets, liabilities and equity with the totals from the aggregation', () => {
    const bs = aggregateForBS(data.transactions, data.categories);
    const t = texts(generateBalanceSheetPdf(RAW));
    expect(t).toContain('Balance Sheet');
    expect(after(t, 'Total Assets')).toBe(formatCurrency(bs.totalAssets));
    expect(after(t, 'Total Liabilities')).toBe(formatCurrency(bs.totalLiabilities));
    for (const r of bs.assets) expect(after(t, r.account)).toBe(formatCurrency(r.amount));
  });

  it('turns equity credit-natural: opening and draws negated, net income added', () => {
    const categories = [
      { name: 'Cash', type: 'asset' }, { name: 'Sales', type: 'revenue' }, { name: 'Rent', type: 'expense' },
      { name: "Members' Equity - Opening", type: 'equity' }, { name: 'Owner Draws', type: 'equity' },
    ];
    const transactions = [
      { category: "Members' Equity - Opening", type: 'credit', amount: 1000 },
      { category: 'Owner Draws', type: 'debit', amount: 200 },
      { category: 'Sales', type: 'credit', amount: 700 },
      { category: 'Rent', type: 'debit', amount: 300 },
      { category: 'Cash', type: 'debit', amount: 1200 },
    ];
    const t = texts(generateBalanceSheetPdf({ transactions, categories, period: 'Year 2026' }));
    expect(after(t, "Members' Equity - Opening")).toBe('$1,000.00');
    expect(after(t, 'Net Income - 2026')).toBe('$400.00');
    expect(after(t, 'Distributions')).toBe('-$200.00');
    expect(after(t, 'Total Equity')).toBe('$1,200.00');
    expect(after(t, 'Total Assets')).toBe('$1,200.00');
  });
});

describe('reports — the trial balance PDF', () => {
  it('prints the grand totals of the aggregation and says when it is out of balance', () => {
    const tb = aggregateTrialBalance(data.transactions, data.categories);
    const t = texts(generateTrialBalancePdf(RAW));
    expect(t).toContain('Trial Balance');
    expect(t).toContain(`Debits ${formatCurrency(tb.totalDebits)}    Credits ${formatCurrency(tb.totalCredits)}`);
    expect(t.some((s) => s.startsWith('OUT OF BALANCE'))).toBe(Math.abs(tb.imbalance) >= 0.005);
  });

  it('with supporting detail, the balance sheet and the trial balance list the rows behind each account', () => {
    for (const make of [generateBalanceSheetPdf, generateTrialBalancePdf]) {
      const doc = make(RAW, undefined, { supportingDetail: true });
      expect(doc.getNumberOfPages()).toBeGreaterThan(1);
      expect(texts(doc).some((s) => s.startsWith('Subtotal'))).toBe(true);
    }
  });

  it('a balanced two-account ledger prints no warning', () => {
    const categories = [{ name: 'Cash', type: 'asset' }, { name: 'Sales', type: 'revenue' }];
    const transactions = [{ category: 'Cash', type: 'debit', amount: 50, posted: true }, { category: 'Sales', type: 'credit', amount: 50, posted: true }];
    const t = texts(generateTrialBalancePdf({ transactions, categories, period: 'P' }));
    expect(t.some((s) => s.startsWith('OUT OF BALANCE'))).toBe(false);
    expect(t).toContain('Balance: $50.00 DR . $50.00 CR');
  });
});

describe('reports — the book balance sheet PDF', () => {
  // An invented snapshot as the Book BS builder stores it.
  const snapshot = {
    sections: [
      { group: 'asset', code: 'A1', title: 'Cash', lines: [{ title: 'Operating account', ending: 12000 }], subtotal: 12000 },
      { group: 'asset', code: 'A2', title: 'Accumulated depreciation', contra: true, lines: [{ title: 'Equipment', ending: 3000 }], subtotal: 3000 },
      { group: 'liability', code: 'L1', title: 'Loans', lines: [{ title: 'Equipment loan', ending: -5000 }], subtotal: -5000 },
      { group: 'equity', code: 'E1', title: 'Capital', lines: [{ title: 'Members', ending: -4000 }], subtotal: -4000 },
    ],
    totals: {},
  };

  it('recomputes the group totals from the sections, a contra section counting against its group', () => {
    const t = texts(generateBookBalanceSheetPdf({ year: 2026, snapshot }));
    expect(t).toContain('ASSETS');
    expect(t).toContain('A2 . Accumulated depreciation (contra)');
    expect(after(t, 'TOTAL ASSETS')).toBe('$9,000.00');
    expect(after(t, 'TOTAL LIABILITIES')).toBe('$5,000.00');
    expect(after(t, 'TOTAL EQUITY')).toBe('-$4,000.00');
  });

  it('a draft says so; a locked year says OFFICIAL and who locked it', () => {
    const draft = texts(generateBookBalanceSheetPdf({ year: 2026, snapshot }));
    const locked = texts(generateBookBalanceSheetPdf({ year: 2026, snapshot, locked: { at: `${TODAY}T00:00:00Z`, by_name: 'Synthetic Owner' } }));
    expect(draft.some((s) => s.startsWith('DRAFT - not yet locked'))).toBe(true);
    expect(locked).toContain('OFFICIAL');
    expect(locked.some((s) => s.startsWith('Locked ') && s.endsWith('by Synthetic Owner'))).toBe(true);
  });

  it('a tax-reconciliation snapshot prints liabilities plus equity from the recomputed totals', () => {
    const t = texts(generateBookBalanceSheetPdf({ year: 2026, snapshot: { ...snapshot, totals: { netIncomeLoss: 0, actualNetIncome: 500, reconciliationGap: 0 } } }));
    expect(after(t, 'TOTAL LIABILITIES + EQUITY')).toBe('$1,000.00');   // |−5,000| + (−4,000)
  });

  // Found while writing these tests, left as it is (it is the partners'
  // capital presentation): recomputeBookTotalsFromSections keeps
  // netIncomeLoss but drops partnersCapital and m2Adjustments, so the CPA
  // layout's dispatch never matches and the tax-reconciliation one prints.
  it.todo('a CPA-format snapshot (partnersCapital + m2Adjustments) prints the CPA identity bands');

  it('supporting detail traces each line from its beginning balance through its mapped activity', () => {
    const detailed = {
      sections: [{
        group: 'asset', code: 'A1', title: 'Cash', subtotal: 1500,
        lines: [
          { title: 'Operating account', beginning: 1000, ending: 1500, isMapping: true, mappings: [{ name: 'Checking', activity: 500 }] },
          { title: 'Petty cash', beginning: 0, ending: 0 },
        ],
      }],
      totals: {},
    };
    const t = texts(generateBookBalanceSheetPdf({ year: 2026, snapshot: detailed }, undefined, { supportingDetail: true }));
    expect(t).toContain('Supporting Detail');
    expect(t).toContain('Mapping-driven');
    expect(t).toContain('Manual-only');
    expect(after(t, 'Beginning balance')).toBe('$1,000.00');
    expect(t).toContain('Activity . CoA: Checking');
    expect(t).toContain('Activity (no mappings - manual-only)');
  });

  it('survives an empty snapshot', () => {
    expect(() => generateBookBalanceSheetPdf({ year: 2026 })).not.toThrow();
  });
});

describe('reports — the auditor package', () => {
  it('a month is the P&L then the trial balance, with continuous page numbers', () => {
    const doc = generateAuditorPackagePdf({ scope: 'month', year: 2026, month: 9, periodLabel: 'October 2026', transactions: data.transactions, categories: data.categories });
    const t = texts(doc);
    expect(t.indexOf('Profit & Loss Statement')).toBeLessThan(t.indexOf('Trial Balance'));
    expect(t).not.toContain('Balance Sheet');
    for (let p = 1; p <= doc.getNumberOfPages(); p++) expect(t).toContain(`Page ${p}`);
  });

  it('a year with a book snapshot adds the balance sheet between them', () => {
    const snapshot = { sections: [{ group: 'asset', code: 'A1', title: 'Cash', lines: [{ title: 'Operating', ending: 10 }], subtotal: 10 }], totals: {} };
    const t = texts(generateAuditorPackagePdf({ scope: 'year', year: 2026, periodLabel: 'Year 2026', transactions: data.transactions, categories: data.categories, bookBSSnapshot: snapshot }));
    const pl = t.indexOf('Profit & Loss Statement'), bs = t.indexOf('Balance Sheet'), tb = t.indexOf('Trial Balance');
    expect(pl).toBeLessThan(bs);
    expect(bs).toBeLessThan(tb);
  });
});
