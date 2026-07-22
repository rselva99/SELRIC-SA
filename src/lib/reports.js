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
//
// Encoding note: jsPDF's default helvetica font is WinAnsi (CP-1252) only —
// characters outside that page (em-dash "—" U+2014, en-dash "–" U+2013,
// curly quotes "" '' U+2018-201D, minus sign "−" U+2212, checkmarks
// U+2713/U+2717, bullets "•" U+2022) render as garbled multi-glyph
// sequences with visible letter-spacing artifacts. Fix: sanitize to ASCII
// equivalents at the boundary. If we ever add a Unicode font (Roboto etc.)
// via addFileToVFS + addFont, this substitution can be removed.
const PDF_UNICODE_MAP = {
  '—': '-',   // em-dash
  '–': '-',   // en-dash
  '−': '-',   // minus sign
  '•': '*',   // bullet
  '‘': "'",   // curly single quote left
  '’': "'",   // curly single quote right
  '“': '"',   // curly double quote left
  '”': '"',   // curly double quote right
  '…': '...', // ellipsis
  ' ': ' ',   // non-breaking space
  '✓': 'OK',  // check mark
  '✗': 'X',   // ballot X
  '→': '->',  // right arrow
  '←': '<-',  // left arrow
  '≤': '<=',  // less-or-equal
  '≥': '>=',  // greater-or-equal
  '·': '.',   // middle dot
};
function sanitizeForPdf(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = ch.charCodeAt(0);
    if (code < 128) { out += ch; continue; }
    const mapped = PDF_UNICODE_MAP[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    // For any remaining character in the CP-1252 range keep it; anything
    // higher gets a '?' placeholder so we never emit unmapped multibyte
    // sequences that jsPDF would render as spaced glyphs.
    out += (code < 256) ? ch : '?';
  }
  return out;
}
function safeText(value, fallback = '') {
  if (value === null || value === undefined) return sanitizeForPdf(fallback);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : sanitizeForPdf(fallback);
  if (typeof value === 'string') return sanitizeForPdf(value);
  // Booleans, dates, anything else — String() never throws.
  try { return sanitizeForPdf(String(value)); } catch { return sanitizeForPdf(fallback); }
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

// Canonical opening-equity category name; matches openingBalances.js so the
// raw-input path can split equity into Opening vs. Distributions reliably.
const OPENING_EQUITY_CATEGORY = "Members' Equity - Opening";

function normalizeBSData(input, periodArg) {
  const period = safeText(input?.period ?? periodArg);
  if (looksRaw(input)) {
    const agg = aggregateForBS(input.transactions, input.categories);
    const pnl = aggregateForPnL(input.transactions, input.categories);
    const netIncome = (Number(pnl.totalRevenue) || 0) - (Number(pnl.totalExpenses) || 0);

    // aggregateForBS returns equity rows debit-natural: opening JE debits
    // "Members' Equity - Opening" so it lands positive; member draws debit
    // their equity category so they ALSO land positive. We surface Opening
    // as its own line and lump every other equity row into Distributions —
    // shown as negative on the report so the three lines arithmetic-add to
    // Total Equity = Opening + NetIncome − Distributions.
    let opening = 0;
    let distributionsRaw = 0;
    for (const row of safeArray(agg.equity)) {
      const amt = Number(row?.amount) || 0;
      if (row?.account === OPENING_EQUITY_CATEGORY) opening += amt;
      else distributionsRaw += amt;
    }

    const yearMatch = String(period).match(/\d{4}/);
    const netIncomeLabel = yearMatch ? `Net Income — ${yearMatch[0]}` : 'Net Income';

    const equity = [
      { account: "Members' Equity — Opening", amount: opening },
      { account: netIncomeLabel,              amount: netIncome },
      { account: 'Distributions',             amount: -distributionsRaw },
    ];
    const totalEquity = opening + netIncome - distributionsRaw;

    return {
      assets:           safeArray(agg.assets),
      liabilities:      safeArray(agg.liabilities),
      equity,
      equityRaw:        safeArray(agg.equity),  // pre-enrichment rows for supporting-detail join
      totalAssets:      Number(agg.totalAssets)      || 0,
      totalLiabilities: Number(agg.totalLiabilities) || 0,
      totalEquity,
      period,
    };
  }
  return {
    assets:           safeArray(input?.assets),
    liabilities:      safeArray(input?.liabilities),
    equity:           safeArray(input?.equity),
    equityRaw:        safeArray(input?.equity),
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

// `opts.doc`: if a pre-existing jsPDF instance is passed, this generator
// renders into it (the caller is responsible for stamping footers at the end).
// Without `opts.doc`, behavior is identical to before — new doc, footers
// stamped, returned to caller. Used by `generateAuditorPackagePdf` to
// compose multiple reports into a single PDF.
export function generatePnLPdf(input, periodArg, opts = {}) {
  const data = normalizePnLData(input, periodArg);
  const doc  = opts?.doc || new jsPDF();
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

  if (!opts?.doc) addFootersToAllPages(doc);
  return doc;
}

// `opts.doc`: see generatePnLPdf header comment.
export function generateBalanceSheetPdf(input, periodArg, opts = {}) {
  const data = normalizeBSData(input, periodArg);
  const doc  = opts?.doc || new jsPDF();
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
      // equityRaw is the per-category aggregate (pre-enrichment with synthetic
      // Net Income / Distributions rows) — only it can be joined to txns.
      { title: 'Equity',      accounts: buildDetailAccounts(data.equityRaw,   input.transactions, 'CR') },
    ];
    renderSupportingDetail(doc, y, sections);
  }

  if (!opts?.doc) addFootersToAllPages(doc);
  return doc;
}

// Income Statement intentionally reuses the P&L layout — same content,
// different filename. Kept as its own export so future divergence is easy.
export function generateIncomeStatementPdf(input, periodArg, opts = {}) {
  return generatePnLPdf(input, periodArg, opts);
}

// ── Book-Structured Balance Sheet ────────────────────────────────────────
//
// Reuses the same engine as the other reports — addHeader, addFooter,
// addFootersToAllPages, ensureSpace, TABLE_BASE — and the FOOTER_RESERVED
// page-break guard. Input shape (built by lib/bookBalanceSheet.js
// buildBookBSSnapshot or read from book_bs_statements.snapshot):
//
//   {
//     year,                                          // integer or string
//     snapshot: { sections, totals, captured_at, locked_by_name? },
//     locked:    { at, by_name } | null,             // present when official
//   }
//
//   opts = { supportingDetail: true | false }
//
// Section + line layout:
//   • Group header  (ASSETS / LIABILITIES / EQUITY)
//   • Section header (L01 · Cash)
//   • Two-column line table: Line | Ending balance
//     Contra-section lines and the contra subtotal render in (parentheses).
//   • Group total band (TOTAL ASSETS …)
// After all groups:
//   • Total Liabilities + Equity band
//   • Balance Check line — green ✓ when |Assets − (L+E)| < 0.005, else red.
// Optional Supporting Detail appendix:
//   • Per line: Beginning / Activity per mapping (with sum) / Adjustments
//     (with notes) / Ending. Ending rendered in (parens) for contra lines.

const BOOK_GROUPS = [
  { key: 'asset',     label: 'ASSETS' },
  { key: 'liability', label: 'LIABILITIES' },
  { key: 'equity',    label: 'EQUITY' },
];

function fmtSigned(amount) {
  const n = Number(amount) || 0;
  return (n >= 0 ? '+' : '') + formatCurrency(n);
}

function fmtContraOrNot(amount, isContra) {
  if (isContra) return `(${formatCurrency(Math.abs(Number(amount) || 0))})`;
  return formatCurrency(amount);
}

function renderOfficialBand(doc, y, locked) {
  y = ensureSpace(doc, y, SUMMARY_BAND_H + 4);
  doc.setFillColor(217, 237, 227);
  doc.roundedRect(PAGE_MARGIN, y, USABLE_WIDTH, SUMMARY_BAND_H, 3, 3, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText('OFFICIAL'), PAGE_MARGIN + 6, y + 8);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const at = locked?.at ? new Date(locked.at).toLocaleString() : '';
  const by = locked?.by_name ? ` by ${locked.by_name}` : '';
  doc.text(safeText(`Locked ${at}${by}`), PAGE_WIDTH - PAGE_MARGIN - 6, y + 12, { align: 'right' });
  return y + SUMMARY_BAND_H + 4;
}

function renderDraftBanner(doc, y) {
  y = ensureSpace(doc, y, 10);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...TEXT_MED);
  doc.text(safeText('DRAFT — not yet locked. Confirm every line and Lock Statement to make this official.'), PAGE_MARGIN, y + 4);
  return y + 8;
}

function renderBookSection(doc, y, section) {
  if (!section?.lines?.length) return y;
  y = ensureSpace(doc, y, 19);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText(`${section.code} · ${section.title}${section.contra ? ' (contra)' : ''}`), PAGE_MARGIN, y);
  y += 5;

  const body = section.lines.map(line => [
    safeText(line.title),
    safeText(fmtContraOrNot(line.ending, section.contra)),
  ]);
  body.push([
    { content: safeText(`Subtotal — ${section.code}`),                                 styles: { fontStyle: 'bold' } },
    { content: safeText(fmtContraOrNot(section.subtotal, section.contra)),             styles: { fontStyle: 'bold' } },
  ]);

  doc.autoTable({
    ...TABLE_BASE,
    startY: y,
    head: [['Line', 'Ending balance']],
    body,
  });

  return (doc.lastAutoTable?.finalY ?? y) + 4;
}

function renderGroupTotalBand(doc, y, label, amount) {
  y = ensureSpace(doc, y, 16);
  doc.setFillColor(...LIGHT_BG);
  doc.roundedRect(PAGE_MARGIN, y, USABLE_WIDTH, 12, 2, 2, 'F');
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText(`TOTAL ${label}`), PAGE_MARGIN + 4, y + 8);
  doc.text(safeText(formatCurrency(amount)), PAGE_WIDTH - PAGE_MARGIN - 4, y + 8, { align: 'right' });
  return y + 16;
}

// CPA tax-recon formatting for NET (INCOME)/LOSS:
//   negative value → income, shown in parens: ($X)
//   positive value → loss, shown plain: $X
function fmtIncomeLoss(amount) {
  const n = Number(amount) || 0;
  if (n < 0) return `(${formatCurrency(Math.abs(n))})`;
  return formatCurrency(n);
}

// Two layouts: the new CPA tax-recon (totals carries totalLiabEquity +
// netIncomeLoss + reconciliationGap) and the legacy Assets − (L+E) check
// (totals carries totalLiabPlusEquity + balanceCheck only). Locked-year
// snapshots written before the tax-recon rewrite still render via the
// legacy branch.
function renderFinalSummary(doc, y, totals) {
  if (!totals) return y;
  const hasCpaFormat = Object.prototype.hasOwnProperty.call(totals, 'partnersCapital')
                     && Object.prototype.hasOwnProperty.call(totals, 'm2Adjustments');
  const isTaxRecon = Object.prototype.hasOwnProperty.call(totals, 'netIncomeLoss');
  if (hasCpaFormat)    return renderCpaFormatSummary(doc, y, totals);
  if (isTaxRecon)      return renderTaxReconSummary(doc, y, totals);
  return renderLegacyBalanceSummary(doc, y, totals);
}

// CPA-format renderer — matches Justin's tax reconciliation layout:
//   TOTAL LIABILITIES & S/E   = L15 + L17 + L20 + L21
//   M-2 ADJUSTMENTS           = M202 + M206A (raw signed sum — L21 stays with L&SE)
//   STRUCTURAL GAP            = -(A + L&SE + M-2)
//   Then a BS-IMPLIED NI vs actual P&L NI comparison, unhidden.
//
// The identity A + L&SE + NIL + M-2 = 0 is validated against Justin's own
// 2023 column to the cent (see SELRIC-FINAL-PREFLIGHT.md).
function renderCpaFormatSummary(doc, y, totals) {
  const A       = Number(totals.totalAssets)      || 0;
  const LSE     = Number(totals.totalLiabEquity)  || 0;      // now excludes M-2
  const M2      = Number(totals.m2Adjustments)    || 0;
  const NIL     = Number(totals.netIncomeLoss)    || 0;
  const bsNI    = Number(totals.bsImpliedNetIncome) || 0;    // = -NIL
  const actual  = totals.actualNetIncome;

  // 1. TOTAL LIABILITIES & S/E (L15 + L17 + L20 + L21 — CPA format, L21 in L&SE)
  y = drawSummaryBand(doc, y, 'TOTAL LIABILITIES & S/E', formatCurrency(LSE), LIGHT_BG, BRAND_DARK);

  // 2. M-2 ADJUSTMENTS (M202 + M206A) — SEPARATE line per CPA format
  y = drawSummaryBand(doc, y, 'M-2 ADJUSTMENTS (M202 + M206A)', formatCurrency(M2), LIGHT_BG, BRAND_DARK);

  // 3. STRUCTURAL GAP — the balancing plug from the CPA identity
  y = drawSummaryBand(doc, y, 'STRUCTURAL GAP — UNBOOKED ACTIVITY', fmtIncomeLoss(NIL), LIGHT_BG, BRAND_DARK);

  // 4. Identity tie: A + L&SE + NIL + M-2 = 0 by construction. Print the literal sum.
  const tie = Math.round((A + LSE + NIL + M2) * 100) / 100;
  y = drawSummaryBand(
    doc, y,
    'CPA IDENTITY: TIES (sums to 0)',
    `A + L&SE + NIL + M-2 = ${formatCurrency(tie)}`,
    [217, 237, 227], BRAND_DARK, 10,
  );

  // 5. BS-IMPLIED NET INCOME (from the CPA-target capital accounts)
  y = drawSummaryBand(doc, y, 'BS-IMPLIED NET INCOME',
    formatCurrency(bsNI), LIGHT_BG, BRAND_DARK);

  // 6. P&L NET INCOME (reference — live recompute)
  if (actual == null) {
    y = drawSummaryBand(doc, y, 'P&L NET INCOME (reference)',
      'not linked — pass categories at snapshot time to enable',
      [255, 244, 214], [146, 64, 14], 10);
    return y;
  }
  y = drawSummaryBand(doc, y, 'P&L NET INCOME (reference)',
    formatCurrency(actual), LIGHT_BG, BRAND_DARK);

  // 7. GAP — displayed prominently, NEVER auto-corrected.
  const gap = Math.round((bsNI - Number(actual || 0)) * 100) / 100;
  const zero = Math.abs(gap) < 0.005;
  y = drawSummaryBand(
    doc, y,
    zero ? 'GAP: BS-IMPLIED vs P&L NET INCOME  ✓' : 'GAP: BS-IMPLIED vs P&L NET INCOME — UNEXPLAINED',
    `BS-implied ${formatCurrency(bsNI)}  −  P&L ${formatCurrency(actual)}  =  ${formatCurrency(gap)}`,
    zero ? [217, 237, 227] : [255, 230, 230],
    zero ? BRAND_DARK       : [224, 49, 49],
    11,
  );
  return y;
}

function renderTaxReconSummary(doc, y, totals) {
  // Liabilities are stored signed-negative (credit-natural); equity is
  // stored signed. Display arithmetic:
  //   L displayed as |totalLiabilities|  (natural positive)
  //   E displayed as totalEquity          (signed; deficit prints negative)
  //   L + E   = |L| + E_signed             (correct arithmetic sum)
  //   Gap     = A − (L + E)                (positive ⇒ assets exceed L+E)
  const A     = Number(totals.totalAssets) || 0;
  const Lnat  = Math.abs(Number(totals.totalLiabilities) || 0);
  const Esign = Number(totals.totalEquity) || 0;
  const LplusE = Math.round((Lnat + Esign) * 100) / 100;
  const gap    = Math.round((A - LplusE) * 100) / 100;

  // 1. TOTAL LIABILITIES (natural positive) and TOTAL EQUITY (signed).
  y = drawSummaryBand(doc, y, 'TOTAL LIABILITIES', formatCurrency(Lnat),  LIGHT_BG, BRAND_DARK);
  y = drawSummaryBand(doc, y, 'TOTAL EQUITY',      formatCurrency(Esign), LIGHT_BG, BRAND_DARK);

  // 2. LIABILITIES + EQUITY (arithmetic sum — deficit reduces).
  y = drawSummaryBand(doc, y, 'TOTAL LIABILITIES + EQUITY', formatCurrency(LplusE), LIGHT_BG, BRAND_DARK);

  // 3. UNRECONCILED DIFFERENCE. Not a plug; sign shown so it does not
  //    read as a booked figure. Positive: assets exceed L+E.
  //    Negative: assets short of L+E.
  const gapLabel = gap >= 0
    ? 'UNRECONCILED DIFFERENCE — assets exceed liabilities plus equity'
    : 'UNRECONCILED DIFFERENCE — assets short of liabilities plus equity';
  y = drawSummaryBand(doc, y, gapLabel, fmtSigned(gap), LIGHT_BG, BRAND_DARK);

  // 4. Identity print: A − (L + E) − gap = 0 by construction.
  const tie = Math.round((A - LplusE - gap) * 100) / 100;
  y = drawSummaryBand(
    doc, y,
    'ARITHMETIC CHECK (sums to 0)',
    `A − (L + E) − Unreconciled = ${formatCurrency(tie)}`,
    [217, 237, 227], BRAND_DARK, 10,
  );

  // 4. P&L NET INCOME (reference) — live recompute from transactions via
  //    aggregateForPnL when categories are passed at snapshot time. Always
  //    informational, never a plug — it is the truth source, not a derived
  //    value. If unavailable, surfaces a "not linked" amber chip.
  const actual = totals.actualNetIncome;
  if (actual == null) {
    y = drawSummaryBand(
      doc, y,
      'P&L NET INCOME (reference)',
      'not linked — pass categories at snapshot time to enable',
      [255, 244, 214], [146, 64, 14], 10,
    );
  } else {
    y = drawSummaryBand(
      doc, y,
      'P&L NET INCOME (reference)',
      formatCurrency(actual),
      LIGHT_BG, BRAND_DARK, 11,
    );
  }

  // (Structural-gap-vs-P&L-net-income drift banner intentionally removed —
  //  the CPA-format L&SE + M-2 identity is enforced elsewhere in the pack.)
  return y;
}

// Legacy "Assets / Liabilities / Equity / Balance Check" renderer. Kept so
// locked snapshots written under the old totals shape still render.
//
// Convention: TOTAL LIABILITIES + EQUITY shows the magnitude sum (positive),
// and BALANCE CHECK reports the signed gap on Assets − |Liabilities| − |Equity|.
// "TIES" when |gap| < $1; "OUT OF BALANCE by <signed gap>" otherwise.
function renderLegacyBalanceSummary(doc, y, totals) {
  // Legacy snapshots also render L displayed as natural positive and E as
  // signed. Any legacy `totalLiabPlusEquity` / `balanceCheck` fields are
  // ignored — they were the |L|+|E| convention which mis-signs equity.
  const A     = Number(totals.totalAssets) || 0;
  const Lnat  = Math.abs(Number(totals.totalLiabilities) || 0);
  const Esign = Number(totals.totalEquity) || 0;
  const LplusE = Math.round((Lnat + Esign) * 100) / 100;
  const gap    = Math.round((A - LplusE) * 100) / 100;

  y = drawSummaryBand(doc, y, 'TOTAL LIABILITIES', formatCurrency(Lnat),  LIGHT_BG, BRAND_DARK);
  y = drawSummaryBand(doc, y, 'TOTAL EQUITY',      formatCurrency(Esign), LIGHT_BG, BRAND_DARK);
  y = drawSummaryBand(doc, y, 'TOTAL LIABILITIES + EQUITY', formatCurrency(LplusE), LIGHT_BG, BRAND_DARK);

  const ties = Math.abs(gap) < 1.0;
  if (ties) {
    return drawSummaryBand(
      doc, y,
      'ARITHMETIC CHECK — TIES',
      'Assets = Liabilities + Equity',
      [217, 237, 227], BRAND_DARK, 10,
    );
  }
  const gapLabel = gap >= 0
    ? 'UNRECONCILED DIFFERENCE — assets exceed liabilities plus equity'
    : 'UNRECONCILED DIFFERENCE — assets short of liabilities plus equity';
  return drawSummaryBand(
    doc, y,
    gapLabel,
    fmtSigned(gap),
    LIGHT_BG, BRAND_DARK, 11,
  );
}

// Shared band drawer for renderFinalSummary. Returns the new y cursor.
function drawSummaryBand(doc, y, leftLabel, rightLabel, fill, textColor, fontSize = 11) {
  y = ensureSpace(doc, y, 16);
  doc.setFillColor(...fill);
  doc.roundedRect(PAGE_MARGIN, y, USABLE_WIDTH, 12, 2, 2, 'F');
  doc.setFontSize(fontSize);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...textColor);
  doc.text(safeText(leftLabel),  PAGE_MARGIN + 4,             y + 8);
  doc.text(safeText(rightLabel), PAGE_WIDTH - PAGE_MARGIN - 4, y + 8, { align: 'right' });
  return y + 16;
}

// Per-line breakdown for the Supporting Detail appendix. Single small table
// with body rows: Beginning, one Activity row per mapping (no mappings →
// one zero-row), one Adjustment row per adjustment, Ending (bold).
function renderBookSupportingLine(doc, y, line, section) {
  y = ensureSpace(doc, y, 24);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TEXT_DARK);
  doc.text(safeText(line.title), PAGE_MARGIN, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MED);
  doc.text(safeText(line.isMapping ? 'Mapping-driven' : 'Manual-only'),
    PAGE_WIDTH - PAGE_MARGIN, y, { align: 'right' });
  y += 3;

  const body = [];
  body.push([safeText('Beginning balance'), safeText(formatCurrency(line.beginning))]);
  const hasCoa    = Array.isArray(line.mappings)      && line.mappings.length      > 0;
  const hasAssets = Array.isArray(line.assetMappings) && line.assetMappings.length > 0;
  if (!hasCoa && !hasAssets) {
    body.push([safeText('Activity (no mappings — manual-only)'), safeText(formatCurrency(0))]);
  } else {
    if (hasCoa) {
      for (const m of line.mappings) {
        body.push([safeText(`Activity · CoA: ${m.name}`), safeText(fmtSigned(m.activity))]);
      }
    }
    if (hasAssets) {
      for (const m of line.assetMappings) {
        const flag = m.exclude ? ' [exclude]' : '';
        const label = m.scope === 'class'
          ? `Activity · Register: ${m.asset_class || m.display_name} (class · ${m.asset_count} asset${m.asset_count === 1 ? '' : 's'})${flag}`
          : `Activity · Register: ${m.display_name}${m.asset_class ? ` (${m.asset_class})` : ''}${flag}`;
        body.push([safeText(label), safeText(fmtSigned(m.contribution))]);
      }
    }
  }
  if (!line.adjustments || line.adjustments.length === 0) {
    body.push([safeText('Adjustments (none)'), safeText(formatCurrency(0))]);
  } else {
    for (const a of line.adjustments) {
      body.push([safeText(`Adjustment · ${a.note}`), safeText(fmtSigned(a.amount))]);
    }
  }
  body.push([
    { content: safeText('Ending balance'),                                  styles: { fontStyle: 'bold' } },
    { content: safeText(fmtContraOrNot(line.ending, section.contra)),        styles: { fontStyle: 'bold' } },
  ]);

  doc.autoTable({
    ...TABLE_BASE,
    startY: y,
    head: undefined,
    body,
  });
  return (doc.lastAutoTable?.finalY ?? y) + 4;
}

function renderBookSupportingDetail(doc, y, snapshot) {
  y = ensureSpace(doc, y, 14);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText('Supporting Detail'), PAGE_MARGIN, y);
  y += 4;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_MED);
  doc.text(safeText('Every ending balance traces back to: beginning + activity per mapped category + manual adjustments.'),
    PAGE_MARGIN, y);
  y += 6;

  for (const section of safeArray(snapshot?.sections)) {
    if (!section.lines?.length) continue;
    y = ensureSpace(doc, y, 12);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND_DARK);
    doc.text(safeText(`${section.code} · ${section.title}${section.contra ? ' (contra)' : ''}`), PAGE_MARGIN, y);
    y += 4;
    for (const line of section.lines) {
      y = renderBookSupportingLine(doc, y, line, section);
    }
    y += 2;
  }
  return y;
}

// Recompute totals at render time from `snapshot.sections`, applying the
// current contra rule (contras always reduce by their magnitude). This
// overrides any pre-baked `snapshot.totals.*` left behind by a locked
// snapshot written before the contra-sign fix landed. Per-section subtotals
// are correct (they're derived from per-line endings at build time); only
// the rolled-up group totals were wrong in the old code.
function recomputeBookTotalsFromSections(sections, storedTotals) {
  let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
  for (const sec of safeArray(sections)) {
    const sub = Number(sec?.subtotal) || 0;
    const contribution = sec?.contra ? -Math.abs(sub) : sub;
    if (sec?.group === 'asset')     totalAssets      += contribution;
    if (sec?.group === 'liability') totalLiabilities += contribution;
    if (sec?.group === 'equity')    totalEquity      += contribution;
  }
  totalAssets      = Math.round(totalAssets * 100) / 100;
  totalLiabilities = Math.round(totalLiabilities * 100) / 100;
  totalEquity      = Math.round(totalEquity * 100) / 100;
  const totalLiabEquity     = Math.round((totalLiabilities + totalEquity) * 100) / 100;
  const liabMagnitude       = Math.abs(totalLiabilities);
  const equityMagnitude     = Math.abs(totalEquity);
  const totalLiabPlusEquity = Math.round((liabMagnitude + equityMagnitude) * 100) / 100;
  const balanceCheck        = Math.round((totalAssets - liabMagnitude - equityMagnitude) * 100) / 100;

  // Preserve dispatch path: snapshots locked under the tax-recon shape carry
  // `netIncomeLoss`; legacy ones don't. renderFinalSummary keys on its
  // presence to pick its layout.
  const wasTaxRecon = !!storedTotals && Object.prototype.hasOwnProperty.call(storedTotals, 'netIncomeLoss');
  const result = {
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalLiabEquity,
    totalLiabPlusEquity,
    balanceCheck,
    actualNetIncome:   storedTotals?.actualNetIncome   ?? null,
    reconciliationGap: storedTotals?.reconciliationGap ?? null,
  };
  if (wasTaxRecon) {
    result.netIncomeLoss = Math.round(-(totalAssets + totalLiabEquity) * 100) / 100;
  }
  return result;
}

// `opts.doc`: see generatePnLPdf header comment.
export function generateBookBalanceSheetPdf(input, periodArg, opts = {}) {
  const year     = safeText(input?.year ?? periodArg, '');
  const snapshot = input?.snapshot || {};
  const locked   = input?.locked   || null;

  // Always recompute totals from sections at render time. See helper docstring.
  const totals = recomputeBookTotalsFromSections(snapshot?.sections, snapshot?.totals);

  const doc = opts?.doc || new jsPDF();
  let y = addHeader(doc, 'Balance Sheet', year);

  y = locked ? renderOfficialBand(doc, y, locked) : renderDraftBanner(doc, y);

  // Group → sections → lines → group total
  for (const g of BOOK_GROUPS) {
    const sectionsInGroup = safeArray(snapshot?.sections).filter(s => s.group === g.key);
    if (!sectionsInGroup.length) continue;

    y = ensureSpace(doc, y, 12);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND_DARK);
    doc.text(safeText(g.label), PAGE_MARGIN, y);
    y += 5;

    for (const sec of sectionsInGroup) {
      y = renderBookSection(doc, y, sec);
    }

    // Per-group totals: ASSETS shown signed (naturally positive on a healthy
    // BS); LIABILITIES shown as natural positive (credit balances are stored
    // negative but displayed positive per standard BS presentation);
    // EQUITY shown SIGNED so an accumulated deficit prints negative and
    // matches the L21 subtotal on the same page.
    let groupTotal = 0;
    if (g.key === 'asset')     groupTotal = totals.totalAssets;
    if (g.key === 'liability') groupTotal = Math.abs(totals.totalLiabilities);
    if (g.key === 'equity')    groupTotal = totals.totalEquity;
    y = renderGroupTotalBand(doc, y, g.label, groupTotal);
  }

  y = renderFinalSummary(doc, y, totals);

  if (opts?.supportingDetail) {
    y = renderBookSupportingDetail(doc, y, snapshot);
  }

  if (!opts?.doc) addFootersToAllPages(doc);
  return doc;
}

// Trial Balance — its own generator. Always raw input + categories.
//   opts.includeUnposted (default true) is forwarded to aggregateTrialBalance.
//   opts.supportingDetail (default false) renders the per-account txn appendix.
//   opts.doc: see generatePnLPdf header comment.
export function generateTrialBalancePdf(input, periodArg, opts = {}) {
  const includeUnposted = opts?.includeUnposted !== false;
  const supportingDetail = !!opts?.supportingDetail;
  const period = safeText(input?.period ?? periodArg);

  const txns = safeArray(input?.transactions);
  const cats = safeArray(input?.categories);
  const tb   = aggregateTrialBalance(txns, cats, { includeUnposted });

  const doc = opts?.doc || new jsPDF();
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

  if (!opts?.doc) addFootersToAllPages(doc);
  return doc;
}

// ── Print for Auditor package ────────────────────────────────────────────────
//
// Composes Cover + P&L + (Book BS for year scope) + Trial Balance into one
// jsPDF instance. Footers are stamped once at the end so page numbers are
// continuous across all sections. Each constituent report renders into the
// shared doc via its `opts.doc` channel; none of them stamp their own
// footers (the `!opts.doc` guard above ensures that).
//
// Input shape:
//   {
//     scope:           'year' | 'month',
//     year:            Number,           // e.g. 2024
//     month:           Number | null,    // 0-11, only meaningful for 'month'
//     periodLabel:     String,           // human-readable, e.g. "Full Year 2024" or "January 2024"
//     transactions:    Array,            // POSTED-ONLY, pre-filtered by date range
//     categories:      Array,
//     bookBSSnapshot:  Object | null,    // required for scope='year', ignored otherwise
//   }

function renderCoverPage(doc, { scope, year, periodLabel }) {
  const pageHeight = doc.internal.pageSize.height;
  addHeader(doc, 'Auditor Package', periodLabel);

  // Centred title block
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText('Audit Reporting Package'), PAGE_WIDTH / 2, 90, { align: 'center' });

  doc.setFontSize(14);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_DARK);
  doc.text(safeText(periodLabel || ''), PAGE_WIDTH / 2, 104, { align: 'center' });

  let generatedAt = '';
  try { generatedAt = `Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`; } catch { generatedAt = 'Generated: —'; }
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_MED);
  doc.text(safeText(generatedAt), PAGE_WIDTH / 2, 116, { align: 'center' });

  // Contents list
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text(safeText('Contents'), PAGE_MARGIN, 150);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_DARK);
  let y = 160;
  doc.text(safeText('• Profit & Loss Statement'), PAGE_MARGIN + 6, y); y += 8;
  if (scope === 'year') {
    doc.text(safeText('• Financing Schedule — Jaris / SpotOn Capital'), PAGE_MARGIN + 6, y); y += 8;
    doc.text(safeText('• Balance Sheet (Book BS — book_bs_lines)'), PAGE_MARGIN + 6, y); y += 8;
    doc.text(safeText('• Members\' Capital — Reconciliation to CPA'), PAGE_MARGIN + 6, y); y += 8;
  }
  doc.text(safeText('• Trial Balance'), PAGE_MARGIN + 6, y); y += 8;

  // Basis note
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MED);
  doc.text(safeText('Basis: posted-only transactions; voided rows excluded.'), PAGE_MARGIN, y + 10);
  if (scope === 'year') {
    doc.text(safeText('Balance Sheet sourced from Book BS Builder (book_bs_lines + adjustments).'), PAGE_MARGIN, y + 16);
  }

  // "For Auditor Use Only" footer
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(...TEXT_MED);
  doc.text(safeText('For Auditor Use Only'), PAGE_WIDTH / 2, pageHeight - 30, { align: 'center' });
}

export function generateAuditorPackagePdf(input, opts = {}) {
  const scope          = input?.scope === 'month' ? 'month' : 'year';
  const year           = input?.year;
  const periodLabel    = safeText(input?.periodLabel, '');
  const transactions   = safeArray(input?.transactions);
  const categories     = safeArray(input?.categories);
  const bookBSSnapshot = input?.bookBSSnapshot || null;

  const doc = new jsPDF();

  // Auditor package trimmed to the three financial statements only.
  // Removed: Cover page, Financing Schedule (Jaris/SpotOn Capital), and
  // Members' Capital Reconciliation. The renderer functions for those
  // three sections are retained (as dead code) further down this file
  // so this trim can be reverted by re-adding the calls below.

  // 1. P&L — renders on page 1 directly (no leading addPage).
  generatePnLPdf({ transactions, categories, period: periodLabel }, undefined, { doc });

  // 2. Balance Sheet (year scope only — Book BS Builder is year-grained).
  if (scope === 'year' && bookBSSnapshot) {
    doc.addPage();
    generateBookBalanceSheetPdf({ year, snapshot: bookBSSnapshot, locked: null }, String(year), { doc });
  }

  // 3. Trial Balance (posted-only basis per opts.includeUnposted = false).
  doc.addPage();
  generateTrialBalancePdf(
    { transactions, categories, period: periodLabel },
    undefined,
    { doc, includeUnposted: false },
  );

  // Single footer pass — continuous page numbers across every section.
  addFootersToAllPages(doc);
  return doc;
}

// ── Financing Schedule — Jaris / SpotOn Capital ──────────────────────────────
//
// SELF-CONTAINED page for the auditor package. Every fact the auditor needs to
// reproduce every number is on this page — the source, the three loans, the
// recognition method, the arithmetic, the year-by-year total, and every
// disclosure verbatim per contract 2026-07-14 (see ~/Documents/SELRIC-JARIS.md
// for the underlying statement analysis).
function renderFinancingSchedulePage(doc, { periodLabel }) {
  addHeader(doc, 'Financing Schedule — Jaris / SpotOn Capital', periodLabel);
  let y = 44;

  function h2(text) {
    y = ensureSpace(doc, y, 12);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND_DARK);
    doc.text(safeText(text), PAGE_MARGIN, y);
    y += 6;
  }
  function body(text, opts = {}) {
    const size    = opts.size || 9;
    const italic  = opts.italic || false;
    const width   = USABLE_WIDTH;
    doc.setFontSize(size);
    doc.setFont('helvetica', italic ? 'italic' : 'normal');
    doc.setTextColor(...TEXT_DARK);
    const lines = doc.splitTextToSize(safeText(text), width);
    for (const line of lines) {
      y = ensureSpace(doc, y, size * 0.55);
      doc.text(line, PAGE_MARGIN, y);
      y += size * 0.55;
    }
    y += 1.5;
  }

  // ── A. SOURCE ────────────────────────────────────────────────────────────
  h2('A. Source documents');
  body(
    'Servicer: Jaris Lending LLC. Lender of record: First Internet Bank of Indiana. ' +
    'Marketed to the borrower as "SpotOn Capital." Merchant ID: SO / KV7FR11. ' +
    'Borrower on the statements: John Harris (member).'
  );
  body(
    'Analysis is based on 16 monthly statements spanning April 2023 through January 2025. ' +
    'Every statement reconciles to the penny — the roll-forward "Check" column reads $0.00 on every one.'
  );

  // ── B. THE THREE LOANS ────────────────────────────────────────────────────
  h2('B. The three sequential loans (each refinanced into the next)');
  y = ensureSpace(doc, y, 40);
  doc.autoTable({
    ...TABLE_BASE,
    startY: y,
    head: [['Loan', 'Funding date', 'Principal', 'Fee (16%)', 'Total obligation', 'Status']],
    body: [
      ['L1', '~Apr 2023',   '$45,000.00',  '$7,200.00',  '$52,200.00',  'PAID OFF 12/04/2023 (principal/fee INFERRED from $52,200 ÷ 1.16)'],
      ['L2',  '12/08/2023',  '$91,800.00',  '$14,688.00', '$106,488.00', 'REFINANCED into L3 on 06/27/2024'],
      ['L3',  '06/27/2024',  '$95,100.00',  '$15,216.00', '$110,316.00', 'OUTSTANDING at 12/31/2024'],
    ],
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 22 },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 72 },
    },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 4;
  body(
    'Fee is a FLAT 16.00% of principal on each loan. It is NOT an APR. It is a flat origination charge assessed at funding and embedded in every repayment dollar.',
    { italic: true }
  );

  // ── C. THE METHOD ─────────────────────────────────────────────────────────
  h2('C. Recognition method (proportional / effective-interest)');
  body(
    'Withholdings are debt service, not expense. The origination fee is the sole P&L item ' +
    'and is recognized proportionally as the loan is repaid, at 13.79% of each dollar repaid ' +
    '(fee / total obligation). The fee is a flat 16% charge, not an APR, and is not time-accrued. ' +
    'The ratio is identical on all three loans: $7,200 / $52,200 = $14,688 / $106,488 = $15,216 / $110,316 = 13.79%.'
  );
  body(
    'Rationale for the proportional method: prepayment yields no discount (proven on L1 — the 12/04/2023 ' +
    'payoff of $4,822.95 exactly equalled the remaining balance). The charge is embedded in every ' +
    'dollar repaid, so it is earned as repaid. Daily withholdings are debt service, not expense — ' +
    'they hit the balance sheet (reducing loan payable) and financing cash flow. Expensing them ' +
    'directly would overstate 2024 costs by roughly $150,000.',
    { size: 8, italic: true }
  );

  // ── D. THE CALCULATION ────────────────────────────────────────────────────
  h2('D. FY2024 finance charge — the arithmetic');
  y = ensureSpace(doc, y, 30);
  doc.autoTable({
    ...TABLE_BASE,
    startY: y,
    head: [['Loan', '2024 withholdings (repaid)', 'Rate', '2024 finance charge']],
    body: [
      ['L3', '$74,676.27', '× 13.79%', '$10,300.18'],
      ['L2', '$1,751.70',  '× 13.79%', '$241.61'],
      [{ content: 'FY2024 INTEREST EXPENSE (documented)', styles: { fontStyle: 'bold' } },
       { content: '',                                      styles: { fontStyle: 'bold' } },
       { content: '',                                      styles: { fontStyle: 'bold' } },
       { content: '$10,541.79',                            styles: { fontStyle: 'bold' } }],
    ],
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 50, halign: 'right' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 50, halign: 'right' },
    },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 4;
  body(
    'Booked as JE-JARIS-2024 (dated 2024-12-31): DR Interest Expense $10,541.79 / CR Loan - Spoton $10,541.79. ' +
    'The fee accretes the liability as it is earned; no cash moves. Supersedes JE-444 and JE-445 (both voided).'
  );

  // ── E. YEAR-BY-YEAR ───────────────────────────────────────────────────────
  h2('E. Year-by-year finance charge (documented method)');
  y = ensureSpace(doc, y, 24);
  doc.autoTable({
    ...TABLE_BASE,
    startY: y,
    head: [['Year', 'Documented finance charge', 'Notes']],
    body: [
      ['2023',  '$7,728.37',  'L1 $6,534.77 + L2 $1,193.60. NOT recorded on the ledger. Prior-year issue — CPA to determine treatment.'],
      ['2024', '$10,541.79',  'L3 $10,300.18 + L2 $241.61. Booked via JE-JARIS-2024 this pass.'],
      ['2025',  '$1,289.57',  'L3 remainder through Jan 2025 (subsequent-year charge).'],
    ],
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 36, halign: 'right' },
      2: { cellWidth: 128 },
    },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 4;

  // ── F. DISCLOSURES ────────────────────────────────────────────────────────
  h2('F. Required disclosures (verbatim)');
  const DISCLOSURES = [
    '1. "L2 statements for Feb–Jul 2024 are missing. If L2 was retired during 2024, an additional $13,252.79 of finance charge belongs in FY2024, bringing the total to $23,794.58. Not recorded — awaiting source documents."',
    '2. "L1 principal ($45,000) and fee ($7,200) are INFERRED from the $52,200 opening balance divided by the 1.16 factor. Not documented."',
    '3. "The borrower of record on the Jaris statements is John Harris, not 3700 Laclede Ave LLC. L1\'s statement address is residential (Chesterfield, MO). L2 and L3 are at 3700 Laclede Ave. CPA to determine whether this debt is an obligation of the LLC or of the member."',
    '4. "Effective cost: 16% flat is NOT 16% APR. On L1 — the only complete lifecycle — $45,000 was borrowed and $52,200 repaid over 220 days. Average outstanding principal was $20,819 (46% of the amount borrowed). Nominal APR 47.3%; effective annual rate 60.4%, by IRR on the 44 actual daily cash flows."',
    '5. "Jaris L2 showed $96,082.69 outstanding at 01/06/2024. The 2023 tax reconciliation records Loan Payable - Spoton at $2,302.67. Apparent understatement of approximately $94,000. Referred to CPA."',
  ];
  for (const d of DISCLOSURES) body(d, { size: 8 });
}

// ── Members' Capital — Reconciliation to CPA ──────────────────────────────
//
// Per contract 2026-07-14 (SELRIC-FINAL-EQUITY.md): after aligning L21 to the
// CPA's expected closing capital accounts and zeroing M-2 flows, the CPA
// treatment implies a FY2024 net income that differs from the general ledger's.
// This page displays the gap and the KNOWN CANDIDATES that MIGHT account for
// it, without claiming any of them explain it. The final "question for the
// CPA" is included verbatim.
function renderMembersCapitalReconciliationPage(doc, { periodLabel, snapshot, transactions, categories }) {
  addHeader(doc, "Members' Capital — Reconciliation to CPA", periodLabel);
  let y = 44;

  function h2(text) {
    y = ensureSpace(doc, y, 12);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND_DARK);
    doc.text(safeText(text), PAGE_MARGIN, y);
    y += 6;
  }
  function body(text, opts = {}) {
    const size    = opts.size || 9;
    const italic  = opts.italic || false;
    doc.setFontSize(size);
    doc.setFont('helvetica', italic ? 'italic' : 'normal');
    doc.setTextColor(...(opts.color || TEXT_DARK));
    const lines = doc.splitTextToSize(safeText(text), USABLE_WIDTH);
    for (const line of lines) {
      y = ensureSpace(doc, y, size * 0.55);
      doc.text(line, PAGE_MARGIN, y);
      y += size * 0.55;
    }
    y += 1.5;
  }

  const totals = snapshot?.totals || {};
  const bsNI   = Number(totals.bsImpliedNetIncome) || 0;
  const actual = totals.actualNetIncome != null ? Number(totals.actualNetIncome) : null;
  const gap    = actual != null ? Math.round((bsNI - actual) * 100) / 100 : null;

  // ── PLAIN STATEMENT ─────────────────────────────────────────────────────
  h2('CPA-aligned treatment (what this year is set to)');
  body('- L21 is set to the CPA\'s expected 2024 closing capital accounts.');
  body('- Retained Earnings is ZERO, per the CPA\'s treatment (acct 3000: preliminary $91,436.11 → adjustment −$91,436.11 → book balance $0.00, then income allocated to member capital).');
  body('- M202 (Capital Contributed) and M206A (Distributions) are ZERO. No 2024 contributions and no 2024 draws. These are M-2 FLOWS, not standing equity.');
  body('- Balance-check identity: A + L&SE + NIL + M-2 = 0.');

  // ── THE GAP ─────────────────────────────────────────────────────────────
  h2('The BS-implied FY2024 net income vs the ledger');
  y = ensureSpace(doc, y, 30);
  doc.autoTable({
    ...TABLE_BASE,
    startY: y,
    head: [['Line', 'Amount']],
    body: [
      ['These capital accounts imply FY2024 net income of',        formatCurrency(bsNI)],
      ['The general ledger reports',                                 actual != null ? formatCurrency(actual) : 'not linked'],
      [{ content: 'GAP — UNEXPLAINED, NOT PLUGGED',
         styles: { fontStyle: 'bold', fillColor: [255, 230, 230], textColor: [153, 27, 27] } },
       { content: gap != null ? formatCurrency(gap) : '—',
         styles: { fontStyle: 'bold', halign: 'right', fillColor: [255, 230, 230], textColor: [153, 27, 27] } }],
    ],
    columnStyles: {
      0: { cellWidth: 130 },
      1: { cellWidth: 52,  halign: 'right' },
    },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 4;
  body(
    'This gap has NOT been plugged. No entry has been posted to close it. It is a real unexplained difference between what the CPA-target capital accounts imply and what the ledger actually reports.',
    { italic: true, size: 9 }
  );

  // ── CANDIDATES ──────────────────────────────────────────────────────────
  h2('Known candidates (NOT claimed to explain the gap)');
  body('The following items are known-open issues on the ledger. Each is listed with its amount so the CPA can consider whether any combination might account for the gap. NONE has been booked, netted, or attributed here.', { size: 9, italic: true });
  y = ensureSpace(doc, y, 60);
  doc.autoTable({
    ...TABLE_BASE,
    startY: y,
    head: [['Candidate', 'Amount']],
    body: [
      ['SpotOn / Jaris liability apparently understated at 2023 close', '≈ $93,780.02'],
      ['  (Jaris L2 outstanding at 01/06/2024 = $96,082.69; 2023 tax recon = $2,302.67)', ''],
      ['"Meridian Payments Made/Not Found" per CPA 2023 sheet — carried at $0 in SELRIC. Payoff status unverified.', '−$157,459.91'],
      ['Merchant Clearing residual — undecomposed (tips, sales tax, SpotOn withholdings)',                          '−$252,375.62'],
      ['Check payments unrecorded (extractor excludes checks)',                                                     '≈ $498,073.42'],
      ['  of which identified: POS/Custom Solutions loan payoff $56,067.90 + Great Southern paydown $39,687.39',    '  ($95,755.29)'],
      ['L2 finance charge not booked — statements Feb–Jul 2024 missing',                                            '$13,252.79'],
      ['21 single-legged JEs',                                                                                       '$15,901.20'],
    ],
    columnStyles: {
      0: { cellWidth: 130 },
      1: { cellWidth: 52,  halign: 'right' },
    },
  });
  y = (doc.lastAutoTable?.finalY ?? y) + 6;

  // ── THE QUESTION ────────────────────────────────────────────────────────
  h2('Question for the CPA (verbatim)');
  y = ensureSpace(doc, y, 24);
  doc.setFillColor(...LIGHT_BG);
  doc.rect(PAGE_MARGIN - 2, y - 4, USABLE_WIDTH + 4, 20, 'F');
  doc.setTextColor(...BRAND_DARK);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'italic');
  const q = doc.splitTextToSize(
    '"What FY2024 net income were you assuming when you prepared these capital accounts? Our general ledger reports ' +
    (actual != null ? formatCurrency(actual) : '$—') + '."',
    USABLE_WIDTH,
  );
  for (const line of q) { doc.text(line, PAGE_MARGIN, y + 4); y += 6; }
  y += 10;

  // ── DO NOT PLUG NOTE ────────────────────────────────────────────────────
  body(
    'This page is a RECONCILIATION artifact, not an adjustment proposal. Nothing above has been booked. ' +
    'Closing the gap requires the CPA to either (a) revise the expected 2024 closing capital accounts, ' +
    '(b) provide the FY2024 net-income figure they used, or (c) authorize specific corrections to the ' +
    'candidates listed above with row-level source documentation. Under NO circumstance should any of ' +
    'these numbers be "corrected" by a plug entry.',
    { size: 8, italic: true }
  );
}
