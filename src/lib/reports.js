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
import {
  aggregateForPnL, aggregateForBS, aggregateTrialBalance,
  trialBalanceTypeOrder, trialBalanceTypeLabel,
  debitOf, creditOf,
} from './finance';

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

  // Left side: business-line heading promoted to the primary banner text
  // now that the SelRic SA wordmark is gone. Sized to balance the title /
  // period / timestamp stack on the right.
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(safeText('College Bar Finance'), PAGE_MARGIN, 22);

  // Right side: title (top), period (middle), generated-at (bottom).
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
  doc.text(safeText('Confidential'), PAGE_MARGIN, pageHeight - 10);
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

// ── Trial Balance section renderer ───────────────────────────────────────
// 5-column layout: Account / Type / Debit total / Credit total / Balance.
// Sum to USABLE_WIDTH (182mm): 74 + 22 + 28 + 28 + 30 = 182.
const TB_COL_WIDTHS  = { account: 74, type: 22, debit: 28, credit: 28, balance: 30 };
const TB_TABLE_BASE  = {
  theme: 'plain',
  styles: { fontSize: 9, textColor: TEXT_DARK, cellPadding: 2, overflow: 'linebreak' },
  headStyles: { fillColor: LIGHT_BG, textColor: TEXT_MED, fontStyle: 'bold', fontSize: 8 },
  margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: FOOTER_RESERVED },
  tableWidth: USABLE_WIDTH,
  columnStyles: {
    0: { cellWidth: TB_COL_WIDTHS.account },
    1: { cellWidth: TB_COL_WIDTHS.type },
    2: { cellWidth: TB_COL_WIDTHS.debit,   halign: 'right' },
    3: { cellWidth: TB_COL_WIDTHS.credit,  halign: 'right' },
    4: { cellWidth: TB_COL_WIDTHS.balance, halign: 'right' },
  },
};

function balanceCellText(row) {
  if (row.debitBalance > 0)  return `${formatCurrency(row.debitBalance)} DR`;
  if (row.creditBalance > 0) return `${formatCurrency(row.creditBalance)} CR`;
  return formatCurrency(0);
}

function renderTrialBalanceSection(doc, y, typeLabel, rows) {
  if (!rows.length) return y;

  y = ensureSpace(doc, y, 19);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText(typeLabel), PAGE_MARGIN, y);
  y += 6;

  let sectionDebits  = 0;
  let sectionCredits = 0;
  let sectionDB      = 0;
  let sectionCB      = 0;
  const body = rows.map((r) => {
    sectionDebits  += r.totalDebits;
    sectionCredits += r.totalCredits;
    sectionDB      += r.debitBalance;
    sectionCB      += r.creditBalance;
    return [
      safeText(r.name),
      safeText(trialBalanceTypeLabel(r.type)),
      safeText(formatCurrency(r.totalDebits)),
      safeText(formatCurrency(r.totalCredits)),
      safeText(balanceCellText(r)),
    ];
  });
  const sectionNet = sectionDB - sectionCB;
  const subtotalBalance = sectionNet >= 0
    ? `${formatCurrency(sectionNet)} DR`
    : `${formatCurrency(-sectionNet)} CR`;
  body.push([
    { content: safeText(`Subtotal — ${typeLabel}`), colSpan: 2, styles: { fontStyle: 'bold' } },
    { content: safeText(formatCurrency(sectionDebits)),  styles: { fontStyle: 'bold' } },
    { content: safeText(formatCurrency(sectionCredits)), styles: { fontStyle: 'bold' } },
    { content: safeText(subtotalBalance),                styles: { fontStyle: 'bold' } },
  ]);

  doc.autoTable({
    ...TB_TABLE_BASE,
    startY: y,
    head: [['Account', 'Type', 'Debits', 'Credits', 'Balance']],
    body,
  });

  return (doc.lastAutoTable?.finalY ?? y) + 8;
}

// ── Supporting Detail renderer ───────────────────────────────────────────
//
// sections = [{ title, accounts: [{ name, stated, statedSide, expectedNet, transactions: [...] }] }]
//
// Per account: small autoTable with Date / Description / Reference / Debit /
// Credit columns. Subtotal row sums every transaction (cap-truncation does
// NOT affect the subtotal — we render only the first DETAIL_ROW_CAP rows but
// sum them all). A ✓ / ✗ badge compares the subtotal's net to the stated
// balance from the summary above.
//
// All sub-tables share margin.bottom = FOOTER_RESERVED so autoTable
// paginates rather than spilling into the footer zone. addFootersToAllPages
// (called at the end of each generator) stamps every page.

const DETAIL_ROW_CAP   = 500;
const DETAIL_COL_WIDTHS = { date: 22, description: 86, reference: 24, debit: 25, credit: 25 };
// Sums to USABLE_WIDTH = 182.

const DETAIL_TABLE_BASE = {
  theme: 'plain',
  styles: { fontSize: 8, textColor: TEXT_DARK, cellPadding: 1.5, overflow: 'linebreak' },
  headStyles: { fillColor: LIGHT_BG, textColor: TEXT_MED, fontStyle: 'bold', fontSize: 7 },
  margin: { left: PAGE_MARGIN, right: PAGE_MARGIN, bottom: FOOTER_RESERVED },
  tableWidth: USABLE_WIDTH,
  columnStyles: {
    0: { cellWidth: DETAIL_COL_WIDTHS.date },
    1: { cellWidth: DETAIL_COL_WIDTHS.description, overflow: 'linebreak' },
    2: { cellWidth: DETAIL_COL_WIDTHS.reference },
    3: { cellWidth: DETAIL_COL_WIDTHS.debit,  halign: 'right' },
    4: { cellWidth: DETAIL_COL_WIDTHS.credit, halign: 'right' },
  },
};

function renderDetailAccount(doc, y, account) {
  const all = safeArray(account?.transactions);
  // Sort by date ascending — already done by caller but defensive.
  const sorted = [...all].sort((a, b) => (a?.date || '').localeCompare(b?.date || ''));

  // Reserve enough space for header row + table head + 1 body row + subtotal.
  y = ensureSpace(doc, y, 24);

  // Account heading line: name + stated balance.
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_DARK);
  doc.text(safeText(account?.name, '—'), PAGE_MARGIN, y);

  const statedLabel = account?.statedSide
    ? `${formatCurrency(Math.abs(Number(account.stated) || 0))} ${account.statedSide}`
    : formatCurrency(account?.stated);
  doc.text(safeText(statedLabel), PAGE_WIDTH - PAGE_MARGIN, y, { align: 'right' });
  y += 3;

  // Compute the full-population subtotal BEFORE truncating for display.
  let sumDebits = 0;
  let sumCredits = 0;
  for (const t of sorted) {
    sumDebits  += debitOf(t);
    sumCredits += creditOf(t);
  }
  const net = sumDebits - sumCredits;
  // expectedNet is the signed amount (DR positive, CR negative) the caller
  // computed from the summary aggregator. The detail's net must equal it.
  const expected = Number(account?.expectedNet ?? (
    account?.statedSide === 'CR'
      ? -Math.abs(Number(account?.stated) || 0)
      : Math.abs(Number(account?.stated) || 0)
  ));
  const diff    = Math.round((net - expected) * 100) / 100;
  const matches = Math.abs(diff) < 0.005;

  const visible    = sorted.slice(0, DETAIL_ROW_CAP);
  const omittedCount = Math.max(0, sorted.length - visible.length);

  const body = visible.map((t) => {
    const d = debitOf(t);
    const c = creditOf(t);
    return [
      safeText(t?.date, '—'),
      safeText(t?.description, '—'),
      safeText(t?.reference, '—'),
      safeText(d > 0 ? formatCurrency(d) : ''),
      safeText(c > 0 ? formatCurrency(c) : ''),
    ];
  });
  if (omittedCount > 0) {
    body.push([
      { content: safeText(`+${omittedCount} more rows (not shown) — subtotal below still includes them`),
        colSpan: 5,
        styles: { fontStyle: 'italic', textColor: TEXT_MED } },
    ]);
  }

  const matchBadge = matches
    ? 'Subtotal matches summary  ✓'
    : `Subtotal does NOT match summary — off by ${formatCurrency(Math.abs(diff))}  ✗`;
  body.push([
    { content: safeText(matchBadge), colSpan: 3, styles: { fontStyle: 'bold' } },
    { content: safeText(formatCurrency(sumDebits)),  styles: { fontStyle: 'bold' } },
    { content: safeText(formatCurrency(sumCredits)), styles: { fontStyle: 'bold' } },
  ]);

  if (sorted.length === 0) {
    // No transactions for this account in the period — render an empty
    // table with a single note so the report stays consistent.
    body.length = 0;
    body.push([
      { content: safeText('No transactions in period'), colSpan: 5, styles: { fontStyle: 'italic', textColor: TEXT_MED } },
    ]);
    body.push([
      { content: safeText(matchBadge), colSpan: 3, styles: { fontStyle: 'bold' } },
      { content: safeText(formatCurrency(0)), styles: { fontStyle: 'bold' } },
      { content: safeText(formatCurrency(0)), styles: { fontStyle: 'bold' } },
    ]);
  }

  doc.autoTable({
    ...DETAIL_TABLE_BASE,
    startY: y,
    head: [['Date', 'Description', 'Reference', 'Debit', 'Credit']],
    body,
  });

  return (doc.lastAutoTable?.finalY ?? y) + 5;
}

function renderSupportingDetail(doc, y, sections) {
  if (!Array.isArray(sections) || !sections.length) return y;

  // Section title for the whole appendix.
  y = ensureSpace(doc, y, 14);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText('Supporting Detail'), PAGE_MARGIN, y);
  y += 4;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MED);
  doc.text(safeText('Every balance above is backed by the transactions listed below, grouped by account. Each account\'s subtotal must match its summary balance.'), PAGE_MARGIN, y);
  y += 6;

  for (const section of sections) {
    if (!section?.accounts?.length) continue;

    y = ensureSpace(doc, y, 12);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND_DARK);
    doc.text(safeText(section.title), PAGE_MARGIN, y);
    y += 5;

    for (const account of section.accounts) {
      y = renderDetailAccount(doc, y, account);
    }
    y += 3;
  }

  return y;
}

// Builds the supporting-detail "accounts" list for one section by joining
// each aggregator row with its raw transactions (filtered to that category).
// statedSide is 'DR' or 'CR'; the expectedNet is the signed net (DR positive,
// CR negative) that the subtotal must match.
function buildDetailAccounts(rows, txns, statedSide) {
  return safeArray(rows).map((r) => {
    const name = r?.account ?? r?.name ?? '';
    const stated = Math.abs(Number(r?.amount ?? r?.balance ?? 0));
    const expectedNet = statedSide === 'CR' ? -stated : stated;
    const transactions = (txns || [])
      .filter((t) => t?.category === name)
      .sort((a, b) => (a?.date || '').localeCompare(b?.date || ''));
    return { name, stated, statedSide, expectedNet, transactions };
  });
}

// ── Public API ───────────────────────────────────────────────────────────

// Common pattern for the BS/P&L/IS extension: when opts.supportingDetail is
// true, callers MUST pass the raw transactions and categories so the detail
// can be joined. Pre-aggregated callers (Accountant page snapshot replay)
// don't get detail because they don't have the underlying txns.
function detailDataAvailable(input) {
  return Array.isArray(input?.transactions) && Array.isArray(input?.categories);
}

export function generatePnLPdf(input, periodArg, opts = {}) {
  const data = normalizePnLData(input, periodArg);
  const doc  = new jsPDF();
  let y = addHeader(doc, 'Profit & Loss Statement', data.period);

  y = renderSection(doc, y, 'Revenue',  data.revenue,  data.totalRevenue,  'Total Revenue');
  y = renderSection(doc, y, 'Expenses', data.expenses, data.totalExpenses, 'Total Expenses');

  const netProfit = data.totalRevenue - data.totalExpenses;
  let cursor = renderSummaryBand(doc, y, 'Net Profit', netProfit, netProfit >= 0);

  if (opts?.supportingDetail && detailDataAvailable(input)) {
    const sections = [
      { title: 'Revenue',  accounts: buildDetailAccounts(data.revenue,  input.transactions, 'CR') },
      { title: 'Expenses', accounts: buildDetailAccounts(data.expenses, input.transactions, 'DR') },
    ];
    renderSupportingDetail(doc, cursor + 2, sections);
  }

  addFootersToAllPages(doc);
  return doc;
}

export function generateBalanceSheetPdf(input, periodArg, opts = {}) {
  const data = normalizeBSData(input, periodArg);
  const doc  = new jsPDF();
  let y = addHeader(doc, 'Balance Sheet', data.period);

  y = renderSection(doc, y, 'Assets',      data.assets,      data.totalAssets,      'Total Assets');
  y = renderSection(doc, y, 'Liabilities', data.liabilities, data.totalLiabilities, 'Total Liabilities');
  y = renderSection(doc, y, 'Equity',      data.equity,      data.totalEquity,      'Total Equity');

  if (opts?.supportingDetail && detailDataAvailable(input)) {
    const sections = [
      // Assets are debit-natural; liabilities + equity are credit-natural.
      // The aggregator stores liab/equity with a NEGATIVE amount (debit-credit
      // is negative for credit-natural accounts) so buildDetailAccounts takes
      // Math.abs() of stated. expectedNet uses the natural side.
      { title: 'Assets',      accounts: buildDetailAccounts(data.assets,      input.transactions, 'DR') },
      { title: 'Liabilities', accounts: buildDetailAccounts(data.liabilities, input.transactions, 'CR') },
      { title: 'Equity',      accounts: buildDetailAccounts(data.equity,      input.transactions, 'CR') },
    ];
    renderSupportingDetail(doc, y, sections);
  }

  addFootersToAllPages(doc);
  return doc;
}

// Income Statement intentionally reuses the P&L layout — same content,
// different filename. Kept as its own export so future divergence is easy.
export function generateIncomeStatementPdf(input, periodArg, opts = {}) {
  return generatePnLPdf(input, periodArg, opts);
}

// Trial Balance — its own generator. Always raw input + categories.
//   opts.includeUnposted (default true) is forwarded to aggregateTrialBalance.
//   opts.supportingDetail (default false) renders the per-account txn appendix.
export function generateTrialBalancePdf(input, periodArg, opts = {}) {
  const includeUnposted = opts?.includeUnposted !== false;
  const supportingDetail = !!opts?.supportingDetail;
  const period = safeText(input?.period ?? periodArg);

  const txns = safeArray(input?.transactions);
  const cats = safeArray(input?.categories);
  const tb   = aggregateTrialBalance(txns, cats, { includeUnposted });

  const doc = new jsPDF();
  let y = addHeader(doc, 'Trial Balance', period);

  // Group by type, then render each section.
  const order = trialBalanceTypeOrder();
  const buckets = new Map();
  for (const row of tb.accounts) {
    const key = row.type in order ? row.type : 'other';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const sectionKeys = ['asset', 'liability', 'equity', 'revenue', 'expense']
    .filter((k) => buckets.has(k))
    .concat([...buckets.keys()].filter((k) => !['asset','liability','equity','revenue','expense'].includes(k)));

  for (const k of sectionKeys) {
    y = renderTrialBalanceSection(doc, y, trialBalanceTypeLabel(k), buckets.get(k));
  }

  // Grand total band. If raw debits ≠ raw credits, render a separate
  // imbalance band underneath in red so the user sees it immediately.
  y = ensureSpace(doc, y, SUMMARY_BAND_H + 4);
  doc.setFillColor(...LIGHT_BG);
  doc.roundedRect(PAGE_MARGIN, y, USABLE_WIDTH, SUMMARY_BAND_H, 3, 3, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText('Grand Total'), PAGE_MARGIN + 6, y + 8);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  // Right-side: print "Debits  $X    Credits  $Y".
  const totalsLine = `Debits ${formatCurrency(tb.totalDebits)}    Credits ${formatCurrency(tb.totalCredits)}`;
  doc.text(safeText(totalsLine), PAGE_WIDTH - PAGE_MARGIN - 6, y + 8, { align: 'right' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const balLine = `Balance: ${formatCurrency(tb.totalDebitBalance)} DR · ${formatCurrency(tb.totalCreditBalance)} CR`;
  doc.text(safeText(balLine), PAGE_WIDTH - PAGE_MARGIN - 6, y + 14, { align: 'right' });
  y += SUMMARY_BAND_H + 4;

  const balanced = Math.abs(tb.imbalance) < 0.005;
  if (!balanced) {
    y = ensureSpace(doc, y, 16);
    doc.setFillColor(255, 230, 230);
    doc.roundedRect(PAGE_MARGIN, y, USABLE_WIDTH, 14, 3, 3, 'F');
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(224, 49, 49);
    const off = Math.abs(tb.imbalance);
    doc.text(safeText(`OUT OF BALANCE by ${formatCurrency(off)}  (bank-imported txns without an explicit cash leg cause this — book the missing entries via Journal)`), PAGE_MARGIN + 4, y + 9);
    y += 18;
  }

  if (supportingDetail) {
    const sections = sectionKeys.map((k) => ({
      title: trialBalanceTypeLabel(k),
      accounts: buckets.get(k).map((r) => {
        const statedSide = r.debitBalance > 0 ? 'DR' : (r.creditBalance > 0 ? 'CR' : 'DR');
        const stated = r.debitBalance > 0 ? r.debitBalance : r.creditBalance;
        const expectedNet = (r.totalDebits - r.totalCredits);
        const transactions = txns
          .filter((t) => t?.category === r.name)
          .filter((t) => includeUnposted || t?.posted)
          .sort((a, b) => (a?.date || '').localeCompare(b?.date || ''));
        return { name: r.name, stated, statedSide, expectedNet, transactions };
      }),
    }));
    renderSupportingDetail(doc, y, sections);
  }

  addFootersToAllPages(doc);
  return doc;
}
