// ─── TRANSACTION AMOUNT SIGN CONVENTION ─────────────────────────────────────
//
// `transactions.amount` is stored with MIXED SIGNS in this database:
//   • Bank-imported rows (BookkeepingPage upload flow) store NEGATIVE amounts
//     for outflows, e.g. -120.00 for a $120 expense debit.
//   • Journal-created rows (Payroll JE, Manual JE, Capitalize, Depreciation,
//     Opening Balances, Revenue Breakdown, Reversal) store POSITIVE amounts,
//     e.g. 37957.97 for a $37,957.97 debit.
// The direction is always carried by the `type` column ('debit' | 'credit').
//
// Display code uses Math.abs(amount) to normalize, but AGGREGATIONS,
// REPORTS, EXPORTS, and SUMS must do the same — never sum raw `t.amount`
// across a mix of rows. The helpers below codify the rule. Prefer them
// over inline `Math.abs(t.amount)`:
//
//   debitOf(t)      // |amount| if type === 'debit', else 0
//   creditOf(t)     // |amount| if type === 'credit', else 0
//   signedDelta(t)  // +|amount| for credit, -|amount| for debit
//                   //   — credit-natural sign; used by revenue/liab/equity
//   debitMinusCredit(t) // +|amount| for debit, -|amount| for credit
//                   //   — debit-natural sign; used by expenses/assets
//   magnitudeOf(t)  // |amount| regardless of type — only for "how much
//                   //   money" sums where direction is irrelevant
//
// If you find yourself writing `t.amount` inside a `reduce`, `+=`, or sum,
// reach for one of these instead. Sign mistakes propagate into the P&L,
// Balance Sheet, Dashboard, GL, and CSV export — every reader funnels
// through this file.
// ────────────────────────────────────────────────────────────────────────────

export function debitOf(t)  { return t?.type === 'debit'  ? Math.abs(Number(t.amount) || 0) : 0; }
export function creditOf(t) { return t?.type === 'credit' ? Math.abs(Number(t.amount) || 0) : 0; }

export function signedDelta(t)       { return creditOf(t) - debitOf(t); }
export function debitMinusCredit(t)  { return debitOf(t)  - creditOf(t); }

export function magnitudeOf(t)       { return Math.abs(Number(t?.amount) || 0); }

// Balance-sheet category types — hidden from transaction-categorization
// dropdowns so day-to-day categorization can't accidentally credit an asset
// or liability and pollute AI suggestions.
const BALANCE_SHEET_TYPES = new Set(['asset', 'liability', 'equity']);

export function isBalanceSheetType(type) {
  return BALANCE_SHEET_TYPES.has((type || '').toLowerCase());
}

// A category is "pickable" from a transaction dropdown if it is a revenue or
// expense category AND not archived. Used everywhere the user assigns a
// category to a transaction (Bookkeeping AI list, Ledger inline edit, the
// Close Wizard's categorize step).
export function isPickableCategory(c) {
  if (!c || c.archived) return false;
  return !isBalanceSheetType(c.type);
}

export function pickableCategories(categories) {
  return (categories || []).filter(isPickableCategory);
}

// Single source of truth for P&L / Balance Sheet aggregation.
//
// The old rule "revenue = any credit, expense = any debit" double-counted
// journal-entry credit legs (payroll reversals, reclasses) as revenue. The
// rules below classify by the category's type instead:
//
//   • revenue  =  credits − debits  on revenue-type categories
//   • expense  =  debits  − credits on expense-type categories  (credits net down)
//
// Categories with no type (or asset/liability/equity) are ignored for P&L.

function buildCategoryTypeMap(categories) {
  const m = new Map();
  for (const c of categories || []) {
    if (!c?.name) continue;
    m.set(c.name, (c.type || '').toLowerCase());
  }
  return m;
}

// Returns { revenue: [{account, amount}], expenses: [{account, amount}],
//           totalRevenue, totalExpenses }.
// `transactions` should be the posted txns for the period; `categories` the
// full chart of accounts (used only for type lookup).
export function aggregateForPnL(transactions, categories) {
  const typeOf  = buildCategoryTypeMap(categories);
  const revByCat = {};
  const expByCat = {};

  for (const t of transactions || []) {
    const cat = t.category;
    if (!cat) continue;
    const type = typeOf.get(cat);
    if (type === 'revenue') {
      // Revenue is credit-natural: credits add, debits (refunds/reversals) subtract.
      revByCat[cat] = (revByCat[cat] || 0) + signedDelta(t);
    } else if (type === 'expense') {
      // Expense is debit-natural: debits add, credits (reversals) net down.
      expByCat[cat] = (expByCat[cat] || 0) + debitMinusCredit(t);
    }
  }

  const revenue = Object.entries(revByCat)
    .filter(([, amount]) => Math.abs(amount) > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([account, amount]) => ({ account, amount }));
  const expenses = Object.entries(expByCat)
    .filter(([, amount]) => Math.abs(amount) > 0.005)
    .sort((a, b) => b[1] - a[1])
    .map(([account, amount]) => ({ account, amount }));

  return {
    revenue,
    expenses,
    totalRevenue:  revenue.reduce((s, r) => s + r.amount, 0),
    totalExpenses: expenses.reduce((s, e) => s + e.amount, 0),
  };
}

// Trial Balance: per-category totals + DR/CR balance, ordered by category type.
//
// Unlike aggregateForPnL / aggregateForBS — which classify and sum at the TYPE
// level — this groups by category NAME so every account gets its own row with
// its own debit total, credit total, and DR-or-CR ending balance.
//
//   transactions  — txns already filtered by date range and voided=false at
//                   the call site. Posted filtering happens here via opts.
//   categories    — the chart of accounts; provides the per-name type.
//   opts.includeUnposted (default true)
//                 — when false, unposted txns are dropped (defensible year-
//                   end TB). When true, the basis matches the existing P&L
//                   so the TB ties to those statements.
//
// Returns:
//   {
//     accounts: [{
//       name, type,                       // 'asset' | 'liability' | 'equity' | ...
//       totalDebits, totalCredits,        // raw sums on each side
//       debitBalance, creditBalance,      // exactly one is > 0 per row
//     }],
//     totalDebits, totalCredits,          // SUM of all txn debits / credits
//     totalDebitBalance, totalCreditBalance, // SUM of ending balances per side
//     imbalance                           // totalDebitBalance - totalCreditBalance
//   }
//
// Zero-balance accounts (totalDebits === 0 && totalCredits === 0) are skipped.
//
// Note on imbalance: this codebase mixes single-entry bank-imported rows with
// double-entry journal-mirrored rows, so total raw debits won't always equal
// total raw credits — the implicit "Cash" leg of statement-imported rows is
// not booked. The TB renderer surfaces any imbalance rather than hiding it.
const TB_TYPE_ORDER = { asset: 1, liability: 2, equity: 3, revenue: 4, expense: 5 };
const TB_TYPE_LABEL = {
  asset: 'Assets', liability: 'Liabilities', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expenses',
};

export function trialBalanceTypeOrder() { return { ...TB_TYPE_ORDER }; }
export function trialBalanceTypeLabel(type) { return TB_TYPE_LABEL[type] || (type || 'Other'); }

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

export function aggregateTrialBalance(transactions, categories, opts = {}) {
  const { includeUnposted = true } = opts;
  const typeOf = buildCategoryTypeMap(categories);

  const byCategory = new Map();
  for (const t of transactions || []) {
    if (!t?.category) continue;
    if (!includeUnposted && !t.posted) continue;
    const b = byCategory.get(t.category) || { debits: 0, credits: 0 };
    b.debits  += debitOf(t);
    b.credits += creditOf(t);
    byCategory.set(t.category, b);
  }

  const accounts = [];
  let totalDebits = 0;
  let totalCredits = 0;
  let totalDebitBalance = 0;
  let totalCreditBalance = 0;

  for (const [name, b] of byCategory.entries()) {
    if (b.debits === 0 && b.credits === 0) continue;
    const type = typeOf.get(name) || 'other';
    const net = b.debits - b.credits; // positive = debit-side ending
    const isDebitNatural = type === 'asset' || type === 'expense';
    let debitBalance = 0;
    let creditBalance = 0;
    if (isDebitNatural) {
      if (net >= 0) debitBalance = net;
      else          creditBalance = -net;
    } else {
      // credit-natural (liability, equity, revenue, and 'other' as fallback)
      if (net <= 0) creditBalance = -net;
      else          debitBalance = net;
    }
    const row = {
      name,
      type,
      totalDebits:   round2(b.debits),
      totalCredits:  round2(b.credits),
      debitBalance:  round2(debitBalance),
      creditBalance: round2(creditBalance),
    };
    accounts.push(row);
    totalDebits += row.totalDebits;
    totalCredits += row.totalCredits;
    totalDebitBalance += row.debitBalance;
    totalCreditBalance += row.creditBalance;
  }

  accounts.sort((a, b) => {
    const ao = TB_TYPE_ORDER[a.type] || 99;
    const bo = TB_TYPE_ORDER[b.type] || 99;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });

  return {
    accounts,
    totalDebits:        round2(totalDebits),
    totalCredits:       round2(totalCredits),
    totalDebitBalance:  round2(totalDebitBalance),
    totalCreditBalance: round2(totalCreditBalance),
    imbalance:          round2(totalDebitBalance - totalCreditBalance),
  };
}

// Balance sheet: groups balances by category, splits into asset/liability/equity.
// Sign convention here is debit-natural — debits add to the per-category bucket,
// credits subtract — so asset rows end up positive and liability/equity rows
// negative. The section split below flips the sign back where it makes sense
// to display each section as a positive number.
export function aggregateForBS(transactions, categories) {
  const balanceByCat = {};
  for (const t of transactions || []) {
    const cat = t.category;
    if (!cat) continue;
    balanceByCat[cat] = (balanceByCat[cat] || 0) + debitMinusCredit(t);
  }
  const sections = { asset: [], liability: [], equity: [] };
  for (const c of categories || []) {
    const bal = balanceByCat[c.name] || 0;
    if (bal === 0) continue;
    const bucket = sections[(c.type || '').toLowerCase()];
    if (bucket) bucket.push({ account: c.name, amount: bal });
  }
  return {
    assets:           sections.asset,
    liabilities:      sections.liability,
    equity:           sections.equity,
    totalAssets:      sections.asset.reduce((s, x) => s + x.amount, 0),
    totalLiabilities: sections.liability.reduce((s, x) => s + x.amount, 0),
    totalEquity:      sections.equity.reduce((s, x) => s + x.amount, 0),
  };
}
