// The financial model rendered to Excel, from a compute() result.
//
// Values, not formulas: the cohort engine cannot be expressed as a sheet, so
// the workbook is a faithful print of one run — every number traceable to the
// assumptions version on its first tab. Runs in the browser (lazy-loaded) and
// under node with the same code.
import ExcelJS from 'exceljs';
import { get, plain, FMT } from '../../lib/ceoDocs.js';
import { GROUPS, PARAM_TYPE } from '../../lib/ceoFields.js';

export const XLSX_FILE = 'SelRic_Financial_Model.xlsx';
const USD = '"$"#,##0;[Red]-"$"#,##0', USD2 = '"$"#,##0.00', NUM1 = '#,##0.0', NUM = '#,##0', PCT = '0.0%', PCT0 = '0%';

export function xlsxWorkbook(R, { version = '—', docs = {} } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SelRic LLC'; wb.created = new Date();
  // The summary is created first so it is the first tab, and filled last.
  const summary = wb.addWorksheet('Summary', { views: [{ state: 'frozen', ySplit: 1 }] });
  const sheet = (name, widths) => { const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }] }); widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; }); return ws; };
  const head = (ws, row, labels) => { const r = ws.getRow(row); labels.forEach((l, i) => { const c = r.getCell(i + 1); c.value = l; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4737' } }; c.alignment = { vertical: 'middle', wrapText: true }; }); r.height = 20; };
  const title = (ws, text, span) => { const r = ws.getRow(1); r.getCell(1).value = text; r.getCell(1).font = { bold: true, size: 13, color: { argb: 'FF1D4737' } }; for (let c = 1; c <= span; c++) r.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEDE7' } }; };
  const put = (ws, row, values, fmts = []) => { const r = ws.getRow(row); values.forEach((v, i) => { const c = r.getCell(i + 1); c.value = v; if (fmts[i]) c.numFmt = fmts[i]; }); return r; };

  // ── Assumptions ───────────────────────────────────────────────────────────
  const AS = sheet('Assumptions', [22, 46, 16, 28, 70]);
  title(AS, `ASSUMPTIONS — version ${version} (edit on the Model tab; this sheet is a print)`, 5);
  head(AS, 2, ['Group', 'Input', 'Value', 'Unit', 'Note']);
  let r = 3;
  const meta = R.meta || {};
  for (const g of GROUPS) {
    if (g.list) {
      const items = get(R.A, g.list) || [];
      items.forEach((it, i) => { for (const f of g.fields) { const type = f.type === 'auto' ? PARAM_TYPE[it.param] || 'num' : f.type; put(AS, r++, [g.title, `${it[g.labelFrom]} — ${f.label}`, it[f.path], f.unit, f.path === 'note' ? '' : (it.note || '')], [null, null, type === 'pct' ? PCT : type === 'money' ? USD2 : null]); } });
      continue;
    }
    for (const f of g.fields) {
      const v = get(R.A, f.path); const m = meta[f.meta || f.path] || {};
      put(AS, r++, [g.title, f.label, Array.isArray(v) ? v.join(' → ') : v, f.unit, [m.note, m.source].filter(Boolean).join(' — ')], [null, null, f.type === 'pct' ? PCT : f.type === 'money' ? USD2 : null]);
    }
  }
  AS.getColumn(5).alignment = { wrapText: true, vertical: 'top' };

  // ── Monthly ───────────────────────────────────────────────────────────────
  const M = sheet('Monthly', [10, 10, 10, 9, 9, 9, 9, 10, 11, 11, 11, 11, 10, 11, 11, 10, 10, 10]);
  title(M, `MONTHLY — base case, ${R.horizon} months`, 18);
  head(M, 2, ['Month', 'New (plan)', 'New (allowed)', 'Capped', 'US Biz', 'NI Biz', 'NI Gan', 'Customers', 'MRR', 'Revenue', 'Opex', 'Contract', 'Draw', 'Op. profit pre-draw', 'Profit', 'Cash', 'Hours needed', 'Hours available']);
  R.monthly.forEach((m, i) => put(M, 3 + i, [m.label, m.newPlan, m.newActual, m.capped ? 'yes' : '', m.cust.usB, m.cust.niB, m.cust.niG, m.total, m.mrr, m.revenue, m.opex, m.contract, m.draw, m.opBeforeDraw, m.profit, m.cash, m.hoursNeeded, m.hoursAvailable], [null, NUM1, NUM1, null, NUM1, NUM1, NUM1, NUM1, USD, USD, USD, USD, USD, USD, USD, USD, NUM1, NUM1]));

  // ── Annual ────────────────────────────────────────────────────────────────
  const Y = sheet('Annual', [40, 16, 16, 16]);
  title(Y, 'ANNUAL — base case', 4);
  head(Y, 2, ['', 'Year 1', 'Year 2', 'Year 3']);
  const yrows = [['Customers at year end', 'endCustomers', NUM1], ['MRR at year end', 'endMRR', USD], ['ARR at year end', 'endARR', USD], ['Revenue', 'revenue', USD], ['Costs incl. cost of revenue', 'costs', USD], ['Operating profit before the draw', 'profitBeforeDraw', USD], ['Founder draw', 'draw', USD], ['Profit after the draw', 'profit', USD], ['Cash at year end', 'endCash', USD], ['New customers — plan', 'newPlan', NUM1], ['New customers — allowed by hours', 'newActual', NUM1], ['Months capped by hours', 'cappedMonths', NUM], ['Peak founder hours a month', 'hoursFounderPeak', NUM1]];
  yrows.forEach(([l, k, f], i) => put(Y, 3 + i, [l, ...R.years.map((y) => y[k])], [null, f, f, f]));
  r = 3 + yrows.length + 1;
  head(Y, r++, [`Break-even (blended ARPU ${FMT.usd2(R.breakeven.blendedArpu)})`, 'Paying customers']);
  put(Y, r++, ['Cover platform and professional services', R.breakeven.fixed], [null, NUM1]);
  put(Y, r++, ['Cover that plus Year-3 contract help', R.breakeven.fixedPlusHelp], [null, NUM1]);
  put(Y, r++, [`Pay the founder ${FMT.usd(R.costs.founderDraw)} a month`, R.breakeven.founderDraw], [null, NUM1]);

  // ── Scenarios & sensitivity ───────────────────────────────────────────────
  const ks = R.scenarioOrder;
  const SC = sheet('Scenarios', [40, ...ks.map(() => 15)]);
  title(SC, 'SCENARIOS — end of Year 3', 1 + ks.length);
  head(SC, 2, ['', ...ks.map((k) => R.scenarios[k].label)]);
  [['Customers, end of Year 3', 'endCustomers', NUM1], ['ARR, end of Year 3', 'endARR', USD], ['Profit, Year 3, after draw', 'profitY3', USD], ['Cash at end', 'endCash', USD], ['Draw starts', 'drawStartsMonth', null]].forEach(([l, k, f], i) => put(SC, 3 + i, [l, ...ks.map((s) => R.scenarios[s][k] ?? '—')], [null, ...ks.map(() => f)]));
  r = 10;
  head(SC, r++, ['SENSITIVITY — Year-3 ARR when one assumption moves', 'Low', 'High', 'Swing']);
  R.sensitivity.forEach((s) => put(SC, r++, [s.name, s.low, s.high, s.swing], [null, USD, USD, USD]));

  // ── Market & tiers ────────────────────────────────────────────────────────
  const MK = sheet('Market & Tiers', [52, 16, 16, 18]);
  title(MK, 'MARKET — Ganadería tiers derived from census and herd data', 4);
  head(MK, 2, ['Step', 'Figure', '', 'Source']);
  const m = R.market;
  [['Producers owning cattle', m.producers, NUM, 'CENAGRO 2011'], ['Share of farms under 60 head', m.shareSmallMedium, PCT0, 'World Bank'], ['→ Farms over 60 head', m.largeFarms, NUM, ''], ['National herd', m.herd, NUM, 'BCN / MAGFOR 2015'], ['Share of the herd on small and medium farms', m.shareHerdOnSmallMedium, PCT0, 'World Bank'], ['→ Head on large farms', m.headOnLarge, NUM, ''], ['→ Average head per large farm', m.avgHeadLarge, NUM, 'the anchor'], ['Medium farms (16–60), assumed', m.mediumFarms, NUM, 'ASSUMPTION'], ['→ Upper half addressable at the entry tier', m.upperMedium, NUM, '']].forEach(([l, v, f, s], i) => put(MK, 3 + i, [l, v, '', s], [null, f]));
  r = 13; head(MK, r++, ['', 'Businesses', 'Price / yr', 'Value / yr']);
  R.tiers.forEach((t) => put(MK, r++, [`Ganadería — ${t.tier}, ${FMT.usd(t.price)}`, t.farms, t.price * 12, t.valueYr], [null, NUM, USD, USD]));
  put(MK, r++, ['SAM — Ganadería, tiered', m.samGFarms, '', m.samG], [null, NUM, null, USD]);
  put(MK, r++, [`SAM — at ${FMT.usd(R.prices.oldFlat)} flat`, m.largeFarms, R.prices.oldFlat * 12, m.samGAtOldFlat], [null, NUM, USD, USD]);
  put(MK, r++, ['TAM — Business, US Latino-owned firms', m.usLatinoFirms, R.prices.business * 12, m.tamB_us], [null, NUM, USD, USD]);
  put(MK, r++, ['SAM — Business, reachable in 3 years', m.samB_farms, R.prices.business * 12, m.samB], [null, NUM, USD, USD]);
  put(MK, r++, ['SOM — plan case, end of Year 3', R.years[2].endCustomers, '', R.years[2].endARR], [null, NUM1, null, USD]);
  r++; head(MK, r++, ['Affordability — a year of software as a share of GDP per capita', 'Nicaragua', 'United States', '']);
  put(MK, r++, ['Business', R.affordability.bizNi, R.affordability.bizUs, ''], [null, PCT, PCT]);
  R.tiers.forEach((t) => put(MK, r++, [`Ganadería — ${t.tier}`, t.affordability, '', ''], [null, PCT]));

  // ── Unit economics ────────────────────────────────────────────────────────
  const U = sheet('Unit Economics', [44, 18, 18]);
  title(U, 'UNIT ECONOMICS — per customer', 3);
  head(U, 2, ['Measure', 'Business', 'Ganadería (blended)']);
  [['Monthly price', 'bizArpu', 'ganArpu', USD2], ['Expected life, months', 'life', 'life', NUM1], ['Lifetime gross profit', 'ltvB', 'ltvG', USD], ['True CAC (cash + founder hours)', 'trueCac', 'trueCac', USD], ['LTV / true CAC', 'ltvCacB', 'ltvCacG', NUM1], ['Months to repay true CAC', 'paybackB', 'paybackG', NUM1]].forEach(([l, a, b, f], i) => put(U, 3 + i, [l, R.unit[a], R.unit[b]], [null, f, f]));

  // ── Summary, filled last ──────────────────────────────────────────────────
  summary.getColumn(1).width = 44; summary.getColumn(2).width = 16; summary.getColumn(3).width = 16; summary.getColumn(4).width = 16; summary.getColumn(5).width = 70;
  const d = new Date(), today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  title(summary, `SELRIC LLC — FINANCIAL MODEL (assumptions v${version}, computed ${today})`, 5);
  head(summary, 2, ['', 'Year 1', 'Year 2', 'Year 3', '']);
  [['Customers at year end', 'endCustomers', NUM1], ['ARR at year end', 'endARR', USD], ['Revenue', 'revenue', USD], ['Profit after the draw', 'profit', USD], ['Cash at year end', 'endCash', USD]].forEach(([l, k, f], i) => put(summary, 3 + i, [l, ...R.years.map((y) => y[k])], [null, f, f, f]));
  put(summary, 9, ['Founder draw switches on', R.drawStartsMonth || 'not within the horizon']);
  put(summary, 10, ['Cash low point', R.cashLow.cash, R.cashLow.label], [null, USD]);
  put(summary, 11, ['Months capped by hours', R.capped.count, R.capped.first || ''], [null, NUM]);
  put(summary, 13, ['Break-even — fixed costs', R.breakeven.fixed], [null, NUM1]);
  put(summary, 14, ['Break-even — fixed + contract help', R.breakeven.fixedPlusHelp], [null, NUM1]);
  put(summary, 15, [`Break-even — founder paid ${FMT.usd(R.costs.founderDraw)}/mo`, R.breakeven.founderDraw], [null, NUM1]);
  if (docs.findings?.length) {
    head(summary, 17, ['Findings', '', '', '', '']);
    docs.findings.forEach((s, i) => { const row = put(summary, 18 + i, [plain(s.title, R, docs), '', '', '', plain(s.body, R, docs)]); row.getCell(1).font = { bold: true }; row.getCell(5).alignment = { wrapText: true, vertical: 'top' }; });
  }
  return wb;
}

export async function xlsxBlob(R, opts) { const buf = await xlsxWorkbook(R, opts).xlsx.writeBuffer(); return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); }
export async function xlsxBuffer(R, opts) { return xlsxWorkbook(R, opts).xlsx.writeBuffer(); }
