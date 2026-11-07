// Excel workbooks the app hands out, laid out the way SelRic's close package
// is: a title in row 1, a light header band in row 2 frozen above the data,
// no merged cells, bold headers and totals, $#,##0.00, fitted widths — and
// every total a live formula, so the workbook recalculates and any figure can
// be traced to the rows under it.
//
// A sheet is described as data first: rows of cells that are a number, a
// string, or { f, v } (a formula and the value it computes to). The
// formulas can then be checked under node (tests/workbook.test.js), and
// toWorkbook() renders the sheets with exceljs, which is imported only when
// someone downloads.
import { saveBlob } from './download.js';

export const FMT = { usd: '$#,##0.00', date: 'mm/dd/yyyy', pct: '0.0%' };
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// 1 → A, 27 → AA.
export function colName(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
export const formula = (f, v) => ({ f, v: round2(v) });
// SUM over a column's rows; an empty range sums to a plain 0.
export const sumOf = (col, from, to, v) => (to < from ? 0 : formula(`SUM(${col}${from}:${col}${to})`, v));

// A sheet under construction. add() returns the Excel row number of the row
// it added, so later formulas can point at it.
export function sheet(name, title, header) {
  const rows = [];
  return {
    name: String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31),
    title,
    header,
    rows,
    add(cells, kind = 'data') { rows.push({ cells, kind }); return rows.length + 2; },
    section(label) { rows.push({ cells: [label], kind: 'section' }); return rows.length + 2; },
    blank() { rows.push({ cells: [], kind: 'blank' }); return rows.length + 2; },
  };
}

const isFormula = (c) => c && typeof c === 'object' && 'f' in c;
const textLen = (v) => {
  if (v == null || v === '') return 0;
  const n = isFormula(v) ? v.v : v;
  if (typeof n === 'number') return (n < 0 ? 2 : 1) + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length + 1;
  return String(n).length;
};

// The sheets as an exceljs workbook.
export async function toWorkbook(sheets, { creator = 'SelRic' } = {}) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name, { views: [{ state: 'frozen', ySplit: 2 }] });
    ws.getCell('A1').value = s.title;
    ws.getCell('A1').font = { bold: true, size: 12 };
    const head = ws.getRow(2);
    s.header.forEach((label, i) => {
      const c = head.getCell(i + 1);
      c.value = label;
      c.font = { bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } };
      c.border = { bottom: { style: 'thin', color: { argb: 'FF999999' } } };
      if (i > 0) c.alignment = { horizontal: 'right' };
    });
    s.rows.forEach((r, i) => {
      const row = ws.getRow(i + 3);
      r.cells.forEach((v, j) => {
        const c = row.getCell(j + 1);
        if (isFormula(v)) c.value = { formula: v.f, result: v.v };
        else c.value = v ?? null;
        if (typeof v === 'number' || isFormula(v)) c.numFmt = v?.fmt || FMT.usd;
        if (r.kind === 'total' || r.kind === 'section') c.font = { bold: true };
        if (r.kind === 'total') c.border = { top: { style: 'thin', color: { argb: 'FF999999' } } };
      });
    });
    const ncols = Math.max(s.header.length, ...s.rows.map((r) => r.cells.length));
    for (let j = 1; j <= ncols; j++) {
      const w = Math.max(textLen(s.header[j - 1]), ...s.rows.map((r) => (r.kind === 'section' && j === 1 ? 0 : textLen(r.cells[j - 1]))), j === 1 ? textLen(s.title) * 0.6 : 0);
      ws.getColumn(j).width = Math.min(60, Math.max(10, Math.ceil(w) + 2));
    }
  }
  return wb;
}

export async function downloadWorkbook(sheets, filename) {
  const wb = await toWorkbook(sheets);
  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
