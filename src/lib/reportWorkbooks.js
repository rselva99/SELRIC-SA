// The Reports page's three statements as workbook sheets (see workbook.js):
// profit and loss by month, the balance sheet and the cash bridge. Figures
// come from series.js; every subtotal, total and check here is a formula
// over the rows above it. Labels are passed in, so the workbook is in the
// language the person reads the page in.
import { colName, formula, sheet, sumOf } from './workbook.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// pnl: pnlByMonth(…) for the months to show. L: { title, account, total,
// revenue, expenses, totalRevenue, totalExpenses, netIncome, month(m) }.
export function pnlByMonthSheet(pnl, L) {
  const months = pnl.map((p) => p.month);
  const n = months.length;
  const last = colName(n + 1);       // the last month's column
  const totalCol = colName(n + 2);
  const s = sheet(L.sheet || L.title, L.title, [L.account, ...months.map(L.month), L.total]);
  const accounts = (key) => {
    const seen = new Map();
    for (const p of pnl) for (const [a, v] of Object.entries(p[key])) seen.set(a, (seen.get(a) || 0) + v);
    return [...seen].sort((a, b) => b[1] - a[1]).map(([a]) => a);
  };
  const block = (key, label, totalLabel) => {
    s.section(label);
    const names = accounts(key);
    let first = null, lastRow = null;
    for (const a of names) {
      const vals = pnl.map((p) => r2(p[key][a] || 0));
      const row = s.add([a, ...vals, null]);
      s.rows[s.rows.length - 1].cells[n + 1] = formula(`SUM(B${row}:${last}${row})`, vals.reduce((x, y) => x + y, 0));
      first ??= row; lastRow = row;
    }
    const totals = months.map((_, i) => names.reduce((x, a) => x + (pnl[i][key][a] || 0), 0));
    const cells = [totalLabel, ...totals.map((v, i) => (first == null ? 0 : sumOf(colName(i + 2), first, lastRow, v)))];
    const row = s.add(cells, 'total');
    s.rows[s.rows.length - 1].cells[n + 1] = formula(`SUM(B${row}:${last}${row})`, totals.reduce((x, y) => x + y, 0));
    return { row, totals };
  };
  const rev = block('revenueBy', L.revenue, L.totalRevenue);
  s.blank();
  const exp = block('expenseBy', L.expenses, L.totalExpenses);
  s.blank();
  const net = months.map((_, i) => rev.totals[i] - exp.totals[i]);
  const cells = [L.netIncome, ...net.map((v, i) => formula(`${colName(i + 2)}${rev.row}-${colName(i + 2)}${exp.row}`, v))];
  s.add(cells, 'total');
  s.rows[s.rows.length - 1].cells[n + 1] = formula(`${totalCol}${rev.row}-${totalCol}${exp.row}`, net.reduce((x, y) => x + y, 0));
  return s;
}

// bs: balanceSheet(…). L: { title, section, account, amount, assets,
// liabilities, equity, totalAssets, totalLiabilities, totalEquity,
// retained, netIncome, liabilitiesAndEquity, check }.
export function balanceSheetSheet(bs, L) {
  const s = sheet(L.sheet || L.title, L.title, [L.section, L.account, L.amount]);
  const part = (label, rows, totalLabel) => {
    let first = null, last = null;
    for (const x of rows) {
      const row = s.add([label, x.account ?? L[x.key], x.amount]);
      first ??= row; last = row;
    }
    const total = rows.reduce((t, x) => t + x.amount, 0);
    return s.add([label, totalLabel, sumOf('C', first ?? 1, last ?? 0, total)], 'total');
  };
  const a = part(L.assets, bs.assets, L.totalAssets);
  s.blank();
  const l = part(L.liabilities, bs.liabilities, L.totalLiabilities);
  s.blank();
  const e = part(L.equity, bs.equity, L.totalEquity);
  s.blank();
  s.add(['', L.liabilitiesAndEquity, formula(`C${l}+C${e}`, bs.totalLiabilities + bs.totalEquity)], 'total');
  s.add(['', L.check, formula(`C${a}-C${l}-C${e}`, bs.difference)], 'total');
  return s;
}

// bridge: cashBridge(…), bars as labelled steps. L: { title, step, amount,
// balance, opening, closing, net, printed, difference, stepLabel(key) }.
export function cashBridgeSheet(bridge, L) {
  const s = sheet(L.sheet || L.title, L.title, [L.step, L.amount, L.balance]);
  let level = bridge.opening ?? 0;
  let prev = null;
  if (bridge.opening != null) {
    prev = s.add([L.opening, bridge.opening, formula(`B3`, bridge.opening)]);
  }
  const start = prev ?? 3;
  for (const st of bridge.steps) {
    level = r2(level + st.delta);
    const row = s.rows.length + 3;
    s.add([L.stepLabel(st.key), st.delta, prev == null ? formula(`B${row}`, st.delta) : formula(`C${prev}+B${row}`, level)]);
    prev = row;
  }
  const end = prev ?? 2;
  const endLabel = bridge.opening == null ? L.net : L.closing;
  const endValue = bridge.opening == null ? bridge.net : bridge.closing;
  const total = s.add([endLabel, sumOf('B', start, end, endValue), null], 'total');
  if (bridge.opening != null && bridge.printedClosing != null) {
    const printed = s.add([L.printed, bridge.printedClosing, null]);
    s.add([L.difference, formula(`B${total}-B${printed}`, (endValue ?? 0) - bridge.printedClosing), null], 'total');
  }
  return s;
}
