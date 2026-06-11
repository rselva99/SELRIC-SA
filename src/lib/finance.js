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
