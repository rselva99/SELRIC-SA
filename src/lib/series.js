// Month-by-month figures for the dashboard charts and the reports, built on
// finance.js (the one place the ledger's sign rules live) — never a second
// copy of them. Every function is pure: rows in, plain numbers out, months as
// 'YYYY-MM' strings, so the same figures can be tested under node, drawn by
// recharts and written to a workbook.
//
// The rows are one workspace's live ledger (`transactions`, voided removed by
// the caller or here). Mirror rows (reference CASH-LEG-…) are the cash leg the
// trigger books for a bank expense; they sit on 'Cash & Bank', which no P&L
// line reads, and the cash figures below skip them so a bank line is counted
// once.
import { aggregateForPnL, creditOf, debitOf, debitMinusCredit, signedDelta } from './finance.js';
import { DEFAULT_NAMES, isBankRow, isMirror, monthOf, monthsBetween, round2 } from './checks/util.js';
import { payableMonths } from './checks/business/payableKeptCurrent.js';

export { monthsBetween };

// The n months that end with `endMonth`, oldest first.
export function lastMonths(endMonth, n = 12) {
  const [y, m] = endMonth.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

const live = (rows) => (rows || []).filter((t) => t && t.voided !== true && t.date);
function byMonth(rows, months) {
  const keep = new Set(months);
  const map = new Map(months.map((m) => [m, []]));
  for (const t of live(rows)) { const m = monthOf(t.date); if (keep.has(m)) map.get(m).push(t); }
  return map;
}
const typeOf = (categories) => new Map((categories || []).map((c) => [c.name, String(c.type || '').toLowerCase()]));

// The P&L of each month, through aggregateForPnL. Basis:
//   accrual — every row, as the books record it;
//   cash    — only what went through the bank: bank lines on P&L accounts.
//             A bill booked to Accounts Payable shows when it is paid only if
//             the payment is categorized to the expense; one paid against the
//             payable stays on the balance sheet. That is the books' cash
//             view, not a full accrual-to-cash conversion.
export function pnlByMonth(rows, categories, months, { basis = 'accrual' } = {}) {
  const grouped = byMonth(rows, months);
  return months.map((month) => {
    const list = basis === 'cash' ? grouped.get(month).filter(isBankRow) : grouped.get(month).filter((t) => !isMirror(t));
    const agg = aggregateForPnL(list, categories);
    return {
      month,
      revenue: round2(agg.totalRevenue),
      expenses: round2(agg.totalExpenses),
      net: round2(agg.totalRevenue - agg.totalExpenses),
      revenueBy: Object.fromEntries(agg.revenue.map((r) => [r.account, round2(r.amount)])),
      expenseBy: Object.fromEntries(agg.expenses.map((r) => [r.account, round2(r.amount)])),
    };
  });
}

// Money in and out of the bank each month, from the statement lines.
export function cashByMonth(rows, months) {
  const grouped = byMonth(rows, months);
  return months.map((month) => {
    const bank = grouped.get(month).filter(isBankRow);
    const inflow = bank.reduce((s, t) => s + creditOf(t), 0);
    const outflow = bank.reduce((s, t) => s + debitOf(t), 0);
    return { month, inflow: round2(inflow), outflow: round2(outflow), net: round2(inflow - outflow) };
  });
}

// Keep the `top` largest keys over the window (by total) and fold the rest
// into 'other'. Order is by size and fixed for every month, so a series keeps
// its colour from month to month.
export function topKeys(maps, top) {
  const totals = new Map();
  for (const m of maps) for (const [k, v] of Object.entries(m || {})) totals.set(k, (totals.get(k) || 0) + v);
  const ranked = [...totals].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return { keys: ranked.slice(0, top), folded: ranked.slice(top) };
}

// Revenue by account, month by month: the `top` accounts and Other.
export function revenueByCategory(pnl, top = 3) {
  const { keys, folded } = topKeys(pnl.map((p) => p.revenueBy), top);
  const fold = new Set(folded);
  const rows = pnl.map((p) => {
    const r = { month: p.month };
    for (const k of keys) r[k] = round2(p.revenueBy[k] || 0);
    if (folded.length) r.__other = round2(Object.entries(p.revenueBy).filter(([k]) => fold.has(k)).reduce((s, [, v]) => s + v, 0));
    return r;
  });
  return { keys, hasOther: folded.length > 0, rows };
}

// Where the money went over the whole window: expense accounts, largest
// first, the tail folded into one Other bar.
export function expenseMix(pnl, top = 7) {
  const { keys, folded } = topKeys(pnl.map((p) => p.expenseBy), top);
  const total = (k) => round2(pnl.reduce((s, p) => s + (p.expenseBy[k] || 0), 0));
  const rows = keys.map((k) => ({ name: k, value: total(k) }));
  if (folded.length) rows.push({ name: '__other', value: round2(folded.reduce((s, k) => s + total(k), 0)) });
  return rows;
}

// Sales tax: collected (credits) and remitted (debits) each month, with what
// is still owed at the end of it. The same arithmetic as the sales-tax check.
export function salesTaxByMonth(rows, months, { pattern = DEFAULT_NAMES.salesTax } = {}) {
  const on = live(rows).filter((t) => !isMirror(t) && t.category && pattern.test(t.category));
  const all = new Map(payableMonths(on).map((m) => [m.month, m]));
  return months.map((month) => {
    const m = all.get(month);
    return { month, collected: m?.collected || 0, remitted: m?.paid || 0, owed: m?.owed ?? null };
  });
}

// Card processing fees each month and what they are as a share of the
// month's card sales (the debits the sales entries put into merchant
// clearing). The rate is null when there were no card sales.
export const FEE_PATTERN = /card\s+processing|processing\s+fee|merchant\s+(fee|service|discount)|card\s+fee|bank\s*card\s+fee/i;
export function merchantFeesByMonth(rows, categories, months, { pattern = FEE_PATTERN, clearing = DEFAULT_NAMES.merchantClearing } = {}) {
  const types = typeOf(categories);
  const grouped = byMonth(rows, months);
  return months.map((month) => {
    const list = grouped.get(month).filter((t) => !isMirror(t) && t.category);
    const fees = list.filter((t) => pattern.test(t.category) && types.get(t.category) === 'expense').reduce((s, t) => s + debitMinusCredit(t), 0);
    const cardSales = list.filter((t) => clearing.test(t.category) && !t.bank_statement_id).reduce((s, t) => s + debitOf(t), 0);
    return { month, fees: round2(fees), cardSales: round2(cardSales), rate: cardSales > 0 ? fees / cardSales : null };
  });
}

// Paper checks by status: how many and how much.
export const CHECK_STATUSES = ['posted', 'classified', 'unclassified', 'excluded', 'voided'];
export function checkPool(checks) {
  const by = new Map();
  for (const c of checks || []) {
    const s = c.status || 'unclassified';
    const x = by.get(s) || { status: s, count: 0, amount: 0 };
    x.count += 1; x.amount += Math.abs(Number(c.amount) || 0);
    by.set(s, x);
  }
  const order = (s) => { const i = CHECK_STATUSES.indexOf(s); return i < 0 ? 99 : i; };
  return [...by.values()].map((x) => ({ ...x, amount: round2(x.amount) })).sort((a, b) => order(a.status) - order(b.status) || a.status.localeCompare(b.status));
}

// The cash bridge: from the bank balance at the start of the window to the
// balance at its end, one step per kind of money in or out. The opening
// balance is the printed beginning balance of the first statement that
// starts inside the window; without one the bridge shows the net change only
// (opening null). Steps are grouped by what the line was categorized to.
export const BRIDGE_IN = ['sales', 'otherIn'];
export const BRIDGE_OUT = ['payroll', 'operating', 'taxes', 'debt', 'owner', 'otherOut'];
const PAYROLL = /payroll|wage|salar|tips?\s+payable/i;
const TAX = /tax/i;
const DEBT = /loan|note\s+payable|line\s+of\s+credit|interest|financing/i;
export function bridgeGroup(t, types, clearing = DEFAULT_NAMES.merchantClearing) {
  const cat = t.category || '';
  const type = types.get(cat);
  if (t.type === 'credit') return type === 'revenue' || clearing.test(cat) ? 'sales' : 'otherIn';
  if (PAYROLL.test(cat) && !/payroll\s+tax/i.test(cat)) return 'payroll';
  if (TAX.test(cat)) return 'taxes';
  if (DEBT.test(cat)) return 'debt';
  if (type === 'equity') return 'owner';
  if (type === 'expense') return 'operating';
  return 'otherOut';
}
export function cashBridge(rows, categories, statements, months) {
  const types = typeOf(categories);
  const from = `${months[0]}-01`;
  const keep = new Set(months);
  const bank = live(rows).filter((t) => isBankRow(t) && keep.has(monthOf(t.date)));
  const sums = Object.fromEntries([...BRIDGE_IN, ...BRIDGE_OUT].map((k) => [k, 0]));
  for (const t of bank) sums[bridgeGroup(t, types)] += t.type === 'credit' ? creditOf(t) : debitOf(t);
  const first = (statements || [])
    .filter((s) => s.period_start && s.period_start >= from && keep.has(monthOf(s.period_start)) && s.statement_totals && s.statement_totals.beginning_balance != null)
    .sort((a, b) => a.period_start.localeCompare(b.period_start))[0];
  const opening = first ? round2(Number(first.statement_totals.beginning_balance)) : null;
  const net = round2(bank.reduce((s, t) => s + signedDelta(t), 0));
  const steps = [
    ...BRIDGE_IN.map((k) => ({ key: k, delta: round2(sums[k]) })),
    ...BRIDGE_OUT.map((k) => ({ key: k, delta: -round2(sums[k]) })),
  ].filter((s) => Math.abs(s.delta) > 0.005);
  return { opening, steps, net, closing: opening == null ? null : round2(opening + net) };
}

// The bridge as bars for a waterfall: each bar spans [low, high]; totals
// start at zero. `kind` is 'total', 'up' or 'down'.
export function waterfallBars(bridge, labelOf) {
  const bars = [];
  let level = bridge.opening ?? 0;
  if (bridge.opening != null) bars.push({ key: 'opening', name: labelOf('opening'), range: [0, level], value: level, kind: 'total' });
  for (const s of bridge.steps) {
    const next = round2(level + s.delta);
    bars.push({ key: s.key, name: labelOf(s.key), range: [Math.min(level, next), Math.max(level, next)], value: s.delta, kind: s.delta >= 0 ? 'up' : 'down' });
    level = next;
  }
  const endKey = bridge.opening == null ? 'net' : 'closing';
  const end = bridge.opening == null ? bridge.net : bridge.closing;
  bars.push({ key: endKey, name: labelOf(endKey), range: [Math.min(0, end), Math.max(0, end)], value: end, kind: 'total' });
  return bars;
}
