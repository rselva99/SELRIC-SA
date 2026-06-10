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
    const amt  = Math.abs(t.amount || 0);
    if (type === 'revenue') {
      const delta = t.type === 'credit' ? amt : -amt;
      revByCat[cat] = (revByCat[cat] || 0) + delta;
    } else if (type === 'expense') {
      const delta = t.type === 'debit' ? amt : -amt;
      expByCat[cat] = (expByCat[cat] || 0) + delta;
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
// Sign convention: debit increases assets, credit increases liabilities/equity.
export function aggregateForBS(transactions, categories) {
  const balanceByCat = {};
  for (const t of transactions || []) {
    const cat = t.category;
    if (!cat) continue;
    const delta = t.type === 'credit' ? -Math.abs(t.amount) : Math.abs(t.amount);
    balanceByCat[cat] = (balanceByCat[cat] || 0) + delta;
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
