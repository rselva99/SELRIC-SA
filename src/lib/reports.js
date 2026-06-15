// Report PDF generators (P&L, Balance Sheet, Income Statement).
//
// Three call sites use these:
//   • ReportsPage         — generatePnLPdf({ transactions, categories, period })
//   • AccountantPage      — generatePnLPdf(aggregateForPnL(...), 'October 2024')
//   • CloseWizard         — generatePnLPdf(aggregateForPnL(...), 'October 2024')
//
// The first passes RAW data and lets the generator aggregate; the other two
// pass a pre-aggregated object plus a separate period label. Normalizers
// below collapse both shapes into a single internal form so the rest of
// the file doesn't care which caller is on the other end.
//
// Hardening (see "Invalid arguments passed to jsPDF.text" crash):
//
//   1. Every value that lands at doc.text() goes through safeText(), which
//      coerces null/undefined/NaN/non-finite numbers to '' (or a caller-
//      supplied fallback). jsPDF.text throws on anything that isn't a
//      string, so this is the only reliable defence.
//   2. formatCurrency tolerates null / undefined / non-numeric strings and
//      returns "$0.00" instead of "$NaN" or throwing.
//   3. autoTable uses a fixed tableWidth equal to the page's usable area
//      (210 − 2 × 14 margin = 182mm), with explicit two-column widths that
//      sum exactly to 182. No empty middle column, no auto-sizing surprises,
//      no "X units could not fit page" warnings.
//   4. Long account names wrap (overflow:'linebreak') rather than truncate.
//
// Footer-overlap fix:
//
//   The page's bottom FOOTER_RESERVED millimetres are off-limits to content.
//   autoTable respects this via margin.bottom (it paginates rather than
//   spilling into the zone). The Net Profit / summary band uses ensureSpace
//   to break to a new page if it doesn't fit above the reserved area.
//   addFootersToAllPages walks every page at the end so the confidentiality
//   line + page number land on every sheet, not just the first.
//
// Open periods (no close snapshot) and closed periods (snapshot present)
// both render the same way here — the generators always compute against
// the data they're handed. Closed-period reports already use snapshot
// numbers because their caller passes the snapshot's aggregate in. See
// AccountantPage.jsx for that path.

import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';
import { aggregateForPnL, aggregateForBS } from './finance';

const BRAND_GREEN = [39, 110, 82];
const BRAND_DARK  = [25, 59, 46];
const TEXT_DARK   = [33, 37, 41];
const TEXT_MED    = [73, 80, 87];
const LIGHT_BG    = [241, 243, 245];

// A4 portrait page is 210mm × 297mm. We leave a 14mm margin on each side,
// so every table and box must fit within 182mm of horizontal space.
const PAGE_WIDTH    = 210;
const PAGE_MARGIN   = 14;
const USABLE_WIDTH  = PAGE_WIDTH - PAGE_MARGIN * 2; // 182

// Footer occupies the bottom FOOTER_RESERVED mm of every page (line at
// pageHeight − 16, text at pageHeight − 10). Content must stay above this
// band, with a small visual gap, so we reserve a few extra mm above the
// line for breathing room.
const FOOTER_RESERVED = 24;
// When ensureSpace pushes content to a new page, this is where the new
// page's content starts. No banner is redrawn on overflow pages — only
// page 1 carries the green title bar.
const NEW_PAGE_TOP    = PAGE_MARGIN + 6;
// Height of the Net Profit / totals summary band (rounded rect + label).
const SUMMARY_BAND_H  = 18;

// jsPDF.text throws "Invalid arguments passed to jsPDF.text" when handed
// null, undefined, NaN, or a raw number. Coerce here at the boundary.
function safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  if (typeof value === 'string') return value;
  // Booleans, dates, anything else — String() never throws.
  try { return String(value); } catch { return fallback; }
}

// Currency formatter that never returns "$NaN". Null/undefined/NaN → $0.00.
export function formatCurrency(amount) {
  const n = Number(amount);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function safeArray(v) { return Array.isArray(v) ? v : []; }

// True when the input looks like raw {transactions, categories} rather than
// the pre-aggregated shape. The aggregated shape carries .revenue / .assets
// arrays; the raw shape doesn't.
function looksRaw(input) {
  return !!(input
    && Array.isArray(input.transactions)
    && Array.isArray(input.categories));
}

function normalizePnLData(input, periodArg) {
  const period = safeText(input?.period ?? periodArg);
  if (looksRaw(input)) {
    const agg = aggregateForPnL(input.transactions, input.categories);
    return {
      revenue:       safeArray(agg.revenue),
      expenses:      safeArray(agg.expenses),
      totalRevenue:  Number(agg.totalRevenue)  || 0,
      totalExpenses: Number(agg.totalExpenses) || 0,
      period,
    };
  }
  return {
    revenue:       safeArray(input?.revenue),
    expenses:      safeArray(input?.expenses),
    totalRevenue:  Number(input?.totalRevenue)  || 0,
    totalExpenses: Number(input?.totalExpenses) || 0,
    period,
  };
}

function normalizeBSData(input, periodArg) {
  const period = safeText(input?.period ?? periodArg);
  if (looksRaw(input)) {
    const agg = aggregateForBS(input.transactions, input.categories);
    return {
      assets:           safeArray(agg.assets),
      liabilities:      safeArray(agg.liabilities),
      equity:           safeArray(agg.equity),
      totalAssets:      Number(agg.totalAssets)      || 0,
      totalLiabilities: Number(agg.totalLiabilities) || 0,
      totalEquity:      Number(agg.totalEquity)      || 0,
      period,
    };
  }
  return {
    assets:           safeArray(input?.assets),
    liabilities:      safeArray(input?.liabilities),
    equity:           safeArray(input?.equity),
    totalAssets:      Number(input?.totalAssets)      || 0,
    totalLiabilities: Number(input?.totalLiabilities) || 0,
    totalEquity:      Number(input?.totalEquity)      || 0,
    period,
  };
}

function addHeader(doc, title, period) {
  doc.setFillColor(...BRAND_GREEN);
  doc.rect(0, 0, PAGE_WIDTH, 36, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(safeText('SelRic SA'), PAGE_MARGIN, 16);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(safeText('College Bar Finance'), PAGE_MARGIN, 24);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(safeText(title, 'Report'), PAGE_WIDTH - PAGE_MARGIN, 16, { align: 'right' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  // Period can be empty for ad-hoc exports — show an em-dash rather than ''.
  doc.text(safeText(period, '—'), PAGE_WIDTH - PAGE_MARGIN, 24, { align: 'right' });

  let generatedAt = '';
  try {
    generatedAt = `Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`;
  } catch {
    generatedAt = 'Generated: —';
  }
  doc.text(safeText(generatedAt), PAGE_WIDTH - PAGE_MARGIN, 30, { align: 'right' });

  return 44;
}

// Single-page footer renderer. addFootersToAllPages walks the doc at the
// end of each generator so this runs on every page, not just page 1.
function addFooter(doc, pageNum) {
  const pageHeight = doc.internal.pageSize.height;
  doc.setDrawColor(206, 212, 218);
  doc.line(PAGE_MARGIN, pageHeight - 16, PAGE_WIDTH - PAGE_MARGIN, pageHeight - 16);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MED);
  doc.text(safeText('SelRic SA — Confidential'), PAGE_MARGIN, pageHeight - 10);
  doc.text(safeText(`Page ${pageNum}`), PAGE_WIDTH - PAGE_MARGIN, pageHeight - 10, { align: 'right' });
}

function addFootersToAllPages(doc) {
  const count = doc.internal.getNumberOfPages();
  for (let i = 1; i <= count; i++) {
    doc.setPage(i);
    addFooter(doc, i);
  }
  // Land back on the last page so any incidental post-call drawing doesn't
  // hop pages unexpectedly.
  doc.setPage(count);
}

// Page-break guard. If drawing something `neededHeight` tall at `y` would
// intrude into the bottom FOOTER_RESERVED band, push to a new page and
// return the new top-of-content y. Otherwise return y unchanged.
function ensureSpace(doc, y, neededHeight) {
  const pageHeight = doc.internal.pageSize.height;
  if (y + neededHeight > pageHeight - FOOTER_RESERVED) {
    doc.addPage();
    return NEW_PAGE_TOP;
  }
  return y;
}

// Shared autoTable settings. Two columns whose explicit widths sum to
// exactly USABLE_WIDTH so the table can never overflow the page.
// margin.bottom keeps autoTable from drawing into the reserved footer zone
// — it paginates instead, and addFootersToAllPages stamps each new page.
const ACCOUNT_COL_WIDTH = 132;
const AMOUNT_COL_WIDTH  = USABLE_WIDTH - ACCOUNT_COL_WIDTH; // 50

const TABLE_BASE = {
  theme: 'plain',
  styles: {
    fontSize: 9,
    textColor: TEXT_DARK,
    cellPadding: 2,
    overflow: 'linebreak',
  },
  headStyles: {
    fillColor: LIGHT_BG,
    textColor: TEXT_MED,
    fontStyle: 'bold',
    fontSize: 8,
  },
  margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: FOOTER_RESERVED },
  tableWidth: USABLE_WIDTH,
  columnStyles: {
    0: { cellWidth: ACCOUNT_COL_WIDTH },
    1: { cellWidth: AMOUNT_COL_WIDTH, halign: 'right' },
  },
};

// Render one section (Revenue, Expenses, Assets, etc.) and return the y
// position immediately below the section so the caller can stack the next
// one underneath. The section title (the bold "Revenue" / "Assets" label)
// gets its own ensureSpace check — if there's no room for even the title
// plus one row of table, the title and table go on a fresh page together.
function renderSection(doc, y, title, rows, total, totalLabel) {
  // Title (6mm) + header row (~7mm) + at least one body row (~6mm) = ~19mm.
  // autoTable will continue paginating any further overflow.
  y = ensureSpace(doc, y, 19);

  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText(title), PAGE_MARGIN, y);
  y += 6;

  const body = safeArray(rows).map((r) => [
    safeText(r?.account, '—'),
    safeText(formatCurrency(r?.amount)),
  ]);
  body.push([
    { content: safeText(totalLabel || `Total ${title}`), styles: { fontStyle: 'bold' } },
    { content: safeText(formatCurrency(total)),          styles: { fontStyle: 'bold' } },
  ]);

  doc.autoTable({
    ...TABLE_BASE,
    startY: y,
    head: [['Account', 'Amount']],
    body,
  });

  return (doc.lastAutoTable?.finalY ?? y) + 10;
}

// Draw the Net Profit / totals summary band at y. Page-breaks first if
// it wouldn't fit cleanly above the footer.
function renderSummaryBand(doc, y, label, amount, positive) {
  // Band itself is SUMMARY_BAND_H tall; pad an extra 4mm above the footer
  // reserve so there's clear visual separation between band and the
  // confidentiality line.
  y = ensureSpace(doc, y, SUMMARY_BAND_H + 4);

  doc.setFillColor(...(positive ? [217, 237, 227] : [255, 230, 230]));
  doc.roundedRect(PAGE_MARGIN, y, USABLE_WIDTH, SUMMARY_BAND_H, 3, 3, 'F');

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...(positive ? BRAND_DARK : [224, 49, 49]));
  doc.text(safeText(label),                       PAGE_MARGIN + 6,              y + 12);
  doc.text(safeText(formatCurrency(amount)),      PAGE_WIDTH - PAGE_MARGIN - 6, y + 12, { align: 'right' });

  return y + SUMMARY_BAND_H + 4;
}

// ── Public API ───────────────────────────────────────────────────────────

export function generatePnLPdf(input, periodArg) {
  const data = normalizePnLData(input, periodArg);
  const doc  = new jsPDF();
  let y = addHeader(doc, 'Profit & Loss Statement', data.period);

  y = renderSection(doc, y, 'Revenue',  data.revenue,  data.totalRevenue,  'Total Revenue');
  y = renderSection(doc, y, 'Expenses', data.expenses, data.totalExpenses, 'Total Expenses');

  const netProfit = data.totalRevenue - data.totalExpenses;
  renderSummaryBand(doc, y, 'Net Profit', netProfit, netProfit >= 0);

  addFootersToAllPages(doc);
  return doc;
}

export function generateBalanceSheetPdf(input, periodArg) {
  const data = normalizeBSData(input, periodArg);
  const doc  = new jsPDF();
  let y = addHeader(doc, 'Balance Sheet', data.period);

  y = renderSection(doc, y, 'Assets',      data.assets,      data.totalAssets,      'Total Assets');
  y = renderSection(doc, y, 'Liabilities', data.liabilities, data.totalLiabilities, 'Total Liabilities');
  y = renderSection(doc, y, 'Equity',      data.equity,      data.totalEquity,      'Total Equity');

  addFootersToAllPages(doc);
  return doc;
}

// Income Statement intentionally reuses the P&L layout — same content,
// different filename. Kept as its own export so future divergence is easy.
export function generateIncomeStatementPdf(input, periodArg) {
  return generatePnLPdf(input, periodArg);
}
