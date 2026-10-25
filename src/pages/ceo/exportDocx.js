// A document — sections of markdown with tokens — rendered to Word.
//
// Runs in the browser (Download on the Documents tab, lazy-loaded so `docx`
// stays out of the public bundle) and under node (~/selric-business builds
// the frozen edition with the same code), so the file a reader downloads is
// the file the builder would have produced. Nothing in here is prose or a
// number: all of that arrives in `sections` and `R`.
import {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, Packer, PageBreak, PageNumber, Paragraph,
  ShadingType, Table, TableCell, TableOfContents, TableRow, TextRun, WidthType,
} from 'docx';
import { inline, parseBlocks, resolve, tableFor } from '../../lib/ceoDocs.js';

export const DOCX_FILES = { business_plan: 'SelRic_Business_Plan.docx', market_gtm: 'SelRic_Market_Analysis_and_GTM.docx' };

const LETTER = { width: 12240, height: 15840 }, MARGIN = { top: 1080, right: 1080, bottom: 1080, left: 1080 };
const CW = LETTER.width - MARGIN.left - MARGIN.right;
const BRAND = '1D4737', GREY = '666666';
const numbering = { config: [
  { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 230 } } } }] },
  { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 230 } } } }] },
] };
const styles = { default: { document: { run: { font: 'Calibri', size: 21 }, paragraph: { spacing: { after: 140, line: 276 } } },
  heading1: { run: { font: 'Georgia', size: 30, bold: true, color: BRAND }, paragraph: { spacing: { before: 360, after: 160 } } },
  heading2: { run: { font: 'Georgia', size: 25, bold: true, color: BRAND }, paragraph: { spacing: { before: 280, after: 120 } } },
  heading3: { run: { font: 'Calibri', size: 22, bold: true, color: '333333' }, paragraph: { spacing: { before: 200, after: 100 } } } } };

const runs = (text, extra = {}) => inline(text).map((r) => new TextRun({ text: r.text, bold: r.bold || extra.bold, italics: r.italic || extra.italics, size: extra.size, color: extra.color }));
const P = (text, extra = {}) => new Paragraph({ children: runs(text, extra) });
const H = (text, level) => new Paragraph({ children: runs(text), heading: level });
const LI = (text, ref) => new Paragraph({ children: runs(text), numbering: { reference: ref, level: 0 } });
const Q = (text) => new Paragraph({ children: runs(text, { italics: true, color: '444444' }), indent: { left: 360 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: BRAND, space: 12 } }, spacing: { before: 160, after: 160 } });
const RULE = () => new Paragraph({ text: '', border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 6 } }, spacing: { after: 160 } });
const SP = () => new Paragraph({ text: '' }), PB = () => new Paragraph({ children: [new PageBreak()] });

// Column widths: a key/value table leans right; otherwise the first column
// gets a third and the rest share the remainder.
function widths(n, keyValue) {
  if (n === 1) return [100];
  if (n === 2) return keyValue ? [18, 82] : [34, 66];
  const first = n === 3 ? 30 : 32; const rest = (100 - first) / (n - 1);
  return [first, ...Array.from({ length: n - 1 }, () => rest)];
}
function table(head, rows, align = []) {
  const n = Math.max(head.length, ...rows.map((r) => r.length));
  const keyValue = head.every((h) => !String(h).trim());
  const w = widths(n, keyValue), cols = w.map((x) => Math.round((x / 100) * CW)); cols[cols.length - 1] += CW - cols.reduce((a, b) => a + b, 0);
  const cell = (text, i, isHead) => new TableCell({
    width: { size: cols[i], type: WidthType.DXA },
    shading: isHead ? { type: ShadingType.CLEAR, fill: 'EFEDE7' } : undefined,
    margins: { top: 60, bottom: 60, left: 90, right: 90 },
    children: [new Paragraph({ alignment: align[i] === 'r' ? AlignmentType.RIGHT : AlignmentType.LEFT, spacing: { after: 0 }, children: runs(String(text ?? ''), { bold: isHead || undefined, size: 19 }) })],
  });
  const body = rows.map((r) => new TableRow({ children: Array.from({ length: n }, (_, i) => cell(r[i] ?? '', i, false)) }));
  return new Table({ width: { size: CW, type: WidthType.DXA }, columnWidths: cols, rows: keyValue ? body : [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, i, true)) }), ...body] });
}

function blocksToDocx(body, R, docs) {
  const out = [];
  for (const b of parseBlocks(body)) {
    const r = (t) => resolve(t, R);
    if (b.type === 'h3') out.push(H(r(b.text), HeadingLevel.HEADING_2));
    else if (b.type === 'h4') out.push(H(r(b.text), HeadingLevel.HEADING_3));
    else if (b.type === 'p') out.push(P(r(b.text)));
    else if (b.type === 'quote') out.push(Q(r(b.text)));
    else if (b.type === 'ul') for (const it of b.items) out.push(LI(r(it), 'bullets'));
    else if (b.type === 'ol') for (const it of b.items) out.push(LI(r(it), 'numbers'));
    else if (b.type === 'rule') out.push(RULE());
    else if (b.type === 'table') { out.push(table(b.head.map(r), b.rows.map((row) => row.map(r)))); out.push(SP()); }
    else if (b.type === 'ttable') { const t = tableFor(b.name, R, docs); if (t) { out.push(table(t.head, t.rows, t.align)); out.push(SP()); } else out.push(P(`⟨table:${b.name}⟩`)); }
  }
  return out;
}

// `sections` is the document's section list; the one keyed `_cover` is the
// cover page (title + the body's paragraphs); the rest are chapters.
export function docxDocument({ sections, R, docs, edition }) {
  const cover = sections.find((s) => s.key === '_cover');
  const chapters = sections.filter((s) => s.key !== '_cover');
  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'SelRic LLC · Confidential · ', size: 16, color: GREY }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY })] })] });
  const children = [];
  if (cover) {
    const lines = parseBlocks(cover.body).filter((b) => b.type === 'p').map((b) => resolve(b.text, R));
    children.push(new Paragraph({ text: '', spacing: { after: 2400 } }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'SelRic LLC', font: 'Georgia', size: 56, bold: true, color: BRAND })] }));
    children.push(new Paragraph({ spacing: { after: 400 }, children: [new TextRun({ text: resolve(cover.title, R), font: 'Georgia', size: 36, color: '333333' })] }));
    children.push(RULE());
    lines.forEach((l, i) => children.push(P(l, { size: i === 0 ? 22 : 20, color: i === 0 ? '444444' : GREY })));
    children.push(new Paragraph({ text: '', spacing: { after: 3200 } }));
    children.push(P('St. Louis, Missouri · Managua, Nicaragua', { size: 20, color: GREY }));
    if (edition) children.push(P(edition, { size: 20, color: GREY }));
    children.push(PB());
  }
  children.push(H('Contents', HeadingLevel.HEADING_1), new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }), P('(In Word: right-click the field and choose Update Field.)', { italics: true, size: 18, color: GREY }), PB());
  chapters.forEach((s, i) => {
    if (i > 0 && i % 3 === 0) children.push(PB());
    children.push(H(resolve(s.title, R), HeadingLevel.HEADING_1));
    children.push(...blocksToDocx(s.body, R, docs));
  });
  return new Document({ styles, numbering, features: { updateFields: true }, sections: [{ properties: { page: { size: LETTER, margin: MARGIN } }, footers: { default: footer }, children }] });
}
export const docxBlob = (opts) => Packer.toBlob(docxDocument(opts));
export const docxBuffer = (opts) => Packer.toBuffer(docxDocument(opts));
