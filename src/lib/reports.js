import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';

const BRAND_GREEN = [39, 110, 82];
const BRAND_DARK = [25, 59, 46];
const TEXT_DARK = [33, 37, 41];
const TEXT_MED = [73, 80, 87];
const LIGHT_BG = [241, 243, 245];

function addHeader(doc, title, period) {
  // Green banner
  doc.setFillColor(...BRAND_GREEN);
  doc.rect(0, 0, 210, 36, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('SelRic SA', 14, 16);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('College Bar Finance', 14, 24);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 196, 16, { align: 'right' });

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(period, 196, 24, { align: 'right' });

  doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 196, 30, { align: 'right' });

  return 44; // y position after header
}

function addFooter(doc, pageNum) {
  const pageHeight = doc.internal.pageSize.height;
  doc.setDrawColor(206, 212, 218);
  doc.line(14, pageHeight - 16, 196, pageHeight - 16);
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_MED);
  doc.text('SelRic SA — Confidential', 14, pageHeight - 10);
  doc.text(`Page ${pageNum}`, 196, pageHeight - 10, { align: 'right' });
}

/**
 * Generate a P&L PDF
 */
export function generatePnLPdf(data, period) {
  const doc = new jsPDF();
  let y = addHeader(doc, 'Profit & Loss Statement', period);

  // Revenue section
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text('Revenue', 14, y);
  y += 6;

  const revenueRows = (data.revenue || []).map((r) => [r.account, '', formatCurrency(r.amount)]);
  revenueRows.push([
    { content: 'Total Revenue', styles: { fontStyle: 'bold' } },
    '',
    { content: formatCurrency(data.totalRevenue || 0), styles: { fontStyle: 'bold' } },
  ]);

  doc.autoTable({
    startY: y,
    head: [['Account', '', 'Amount']],
    body: revenueRows,
    theme: 'plain',
    styles: { fontSize: 9, textColor: TEXT_DARK, cellPadding: 3 },
    headStyles: { fillColor: LIGHT_BG, textColor: TEXT_MED, fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 0: { cellWidth: 100 }, 2: { halign: 'right', cellWidth: 40 } },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 10;

  // Expenses section
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BRAND_DARK);
  doc.text('Expenses', 14, y);
  y += 6;

  const expenseRows = (data.expenses || []).map((e) => [e.account, '', formatCurrency(e.amount)]);
  expenseRows.push([
    { content: 'Total Expenses', styles: { fontStyle: 'bold' } },
    '',
    { content: formatCurrency(data.totalExpenses || 0), styles: { fontStyle: 'bold' } },
  ]);

  doc.autoTable({
    startY: y,
    head: [['Account', '', 'Amount']],
    body: expenseRows,
    theme: 'plain',
    styles: { fontSize: 9, textColor: TEXT_DARK, cellPadding: 3 },
    headStyles: { fillColor: LIGHT_BG, textColor: TEXT_MED, fontStyle: 'bold', fontSize: 8 },
    columnStyles: { 0: { cellWidth: 100 }, 2: { halign: 'right', cellWidth: 40 } },
    margin: { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 12;

  // Net profit box
  const netProfit = (data.totalRevenue || 0) - (data.totalExpenses || 0);
  doc.setFillColor(...(netProfit >= 0 ? [217, 237, 227] : [255, 230, 230]));
  doc.roundedRect(14, y, 182, 18, 3, 3, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...(netProfit >= 0 ? BRAND_DARK : [224, 49, 49]));
  doc.text('Net Profit', 20, y + 12);
  doc.text(formatCurrency(netProfit), 190, y + 12, { align: 'right' });

  addFooter(doc, 1);
  return doc;
}

/**
 * Generate Balance Sheet PDF
 */
export function generateBalanceSheetPdf(data, period) {
  const doc = new jsPDF();
  let y = addHeader(doc, 'Balance Sheet', period);

  const sections = [
    { title: 'Assets', items: data.assets || [], total: data.totalAssets || 0 },
    { title: 'Liabilities', items: data.liabilities || [], total: data.totalLiabilities || 0 },
    { title: 'Equity', items: data.equity || [], total: data.totalEquity || 0 },
  ];

  sections.forEach((section) => {
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...BRAND_DARK);
    doc.text(section.title, 14, y);
    y += 6;

    const rows = section.items.map((i) => [i.account, formatCurrency(i.amount)]);
    rows.push([
      { content: `Total ${section.title}`, styles: { fontStyle: 'bold' } },
      { content: formatCurrency(section.total), styles: { fontStyle: 'bold' } },
    ]);

    doc.autoTable({
      startY: y,
      head: [['Account', 'Amount']],
      body: rows,
      theme: 'plain',
      styles: { fontSize: 9, textColor: TEXT_DARK, cellPadding: 3 },
      headStyles: { fillColor: LIGHT_BG, textColor: TEXT_MED, fontStyle: 'bold', fontSize: 8 },
      columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right', cellWidth: 50 } },
      margin: { left: 14, right: 14 },
    });

    y = doc.lastAutoTable.finalY + 10;
  });

  addFooter(doc, 1);
  return doc;
}

/**
 * Generate Income Statement PDF
 */
export function generateIncomeStatementPdf(data, period) {
  // Income statement is essentially the same as P&L with more detail
  return generatePnLPdf(data, period);
}

function formatCurrency(amount) {
  return Number(amount).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export { formatCurrency };
