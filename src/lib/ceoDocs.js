// The documents: markdown sections with {{tokens}} resolved from the model.
//
// A document is an ordered list of sections {key, title, body}. The body is a
// small markdown subset — ### headings, paragraphs, - bullets, 1. numbers,
// > quotes, | tables, **bold**, *italic* — plus two kinds of token:
//   {{path|fmt}}       a number from compute(): {{years.2.endARR|usd}}
//   {{table:name}}     a whole computed table, on a line of its own
// A token whose path does not exist renders as ⟨path⟩ so it is seen, not
// silently blank. This file is pure and runs in the browser and under node.

// ── Formats ─────────────────────────────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const loc = (n, d) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const FMT = {
  usd:   (n) => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US'),
  usd2:  (n) => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toFixed(2),
  usdK:  (n) => (Math.abs(n) >= 1000 ? (n < 0 ? '−$' : '$') + (Math.abs(n) / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1) + 'K' : FMT.usd(n)),
  num:   (n) => loc(n, 0),
  num1:  (n) => loc(n, 1),
  num2:  (n) => loc(n, 2),
  int:   (n) => String(Math.round(n)),
  pct:   (x) => Math.round(x * 100) + '%',
  pct1:  (x) => (x * 100).toFixed(1) + '%',
  pct2:  (x) => (x * 100).toFixed(2) + '%',
  x:     (n) => Number(n).toFixed(1) + 'x',
  x2:    (n) => Number(n).toFixed(2) + 'x',
  mon:   (l) => (l ? `${MON[Number(l.slice(5, 7)) - 1]} ${l.slice(2, 4)}` : '—'),
  month: (l) => (l ? `${MONTH[Number(l.slice(5, 7)) - 1]} ${l.slice(0, 4)}` : '—'),
  ym:    (l) => (l == null ? '—' : String(l)),
  list:  (xs) => (Array.isArray(xs) ? xs.join(' → ') : String(xs)),
  raw:   (v) => (v == null ? '—' : String(v)),
  lower: (v) => String(v ?? '').toLowerCase(),
  word:  (n) => (WORDS[Math.round(n)] ?? loc(n, 0)),
};
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

// ── Tokens ──────────────────────────────────────────────────────────────────
const TOKEN = /\{\{\s*([A-Za-z0-9_.$\[\]'"-]+)\s*(?:\|\s*([A-Za-z0-9]+))?\s*\}\}/g;
const TABLE = /^\{\{\s*table:([A-Za-z0-9_.]+)\s*\}\}$/;

export function get(obj, path) {
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').replace(/\[['"]([^'"]+)['"]\]/g, '.$1').split('.').filter(Boolean);
  let v = obj;
  for (const p of parts) { if (v == null) return undefined; v = v[p]; }
  return v;
}

// Replace every {{path|fmt}} in `text`. `ctx.missing` collects unresolved paths.
export function resolve(text, R, ctx = {}) {
  return String(text ?? '').replace(TOKEN, (_, path, fmt) => {
    const v = get(R, path);
    if (v === undefined) { (ctx.missing ||= []).push(path); return `⟨${path}⟩`; }
    const f = fmt ? FMT[fmt] : null;
    if (fmt && !f) { (ctx.missing ||= []).push(`${path}|${fmt}`); return `⟨${path}|${fmt}?⟩`; }
    if (f) return f(v);
    return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : loc(v, 1)) : Array.isArray(v) ? v.join(', ') : String(v);
  });
}

// ── Sections and blocks ─────────────────────────────────────────────────────
// A document file: sections start with `## Title {#key}`; everything up to the
// next `## ` is the body. The key is required so an edit can be matched to
// its place in the rendered document.
export function parseSections(md) {
  const out = []; let cur = null;
  for (const line of String(md).split('\n')) {
    const m = /^##\s+(.*?)\s*\{#([A-Za-z0-9_-]+)\}\s*$/.exec(line);
    if (m) { cur = { key: m[2], title: m[1], body: '' }; out.push(cur); continue; }
    if (cur) cur.body += (cur.body ? '\n' : '') + line;
  }
  for (const s of out) s.body = s.body.trim();
  return out;
}
export const joinSections = (sections) => sections.map((s) => `## ${s.title} {#${s.key}}\n\n${s.body}`).join('\n\n');

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
// Split a table row on `|` — but not on the `|` inside a {{path|fmt}} token.
function cells(line) {
  const s = line.replace(/^\|/, '').replace(/\|$/, ''); const out = []; let cur = '', depth = 0;
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '{{') { depth++; cur += two; i++; continue; }
    if (two === '}}') { depth = Math.max(0, depth - 1); cur += two; i++; continue; }
    if (s[i] === '|' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur.trim()); return out;
}
const isSep = (line) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line);

export function parseBlocks(body) {
  const lines = String(body ?? '').split('\n');
  const blocks = []; let i = 0;
  const para = [];
  const flush = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i], t = line.trim();
    if (!t) { flush(); i++; continue; }
    let m;
    if ((m = TABLE.exec(t))) { flush(); blocks.push({ type: 'ttable', name: m[1] }); i++; continue; }
    if ((m = /^(#{3,4})\s+(.*)$/.exec(t))) { flush(); blocks.push({ type: m[1].length === 3 ? 'h3' : 'h4', text: m[2] }); i++; continue; }
    if (/^---+$/.test(t)) { flush(); blocks.push({ type: 'rule' }); i++; continue; }
    if (t.startsWith('>')) { flush(); const q = []; while (i < lines.length && lines[i].trim().startsWith('>')) { q.push(lines[i].trim().replace(/^>\s?/, '')); i++; } blocks.push({ type: 'quote', text: q.join(' ') }); continue; }
    if (/^[-*]\s+/.test(t)) { flush(); const items = []; while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; } blocks.push({ type: 'ul', items }); continue; }
    if (/^\d+[.)]\s+/.test(t)) { flush(); const items = []; while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++; } blocks.push({ type: 'ol', items }); continue; }
    if (t.startsWith('|')) {
      flush(); const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { const l = lines[i].trim(); if (!isSep(l)) rows.push(cells(l)); i++; }
      if (rows.length) blocks.push({ type: 'table', head: rows[0], rows: rows.slice(1) });
      continue;
    }
    para.push(t); i++;
  }
  flush();
  return blocks;
}

// **bold** and *italic* → runs
export function inline(text) {
  const runs = []; const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g; let last = 0, m;
  const s = String(text ?? '');
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    if (m[2] != null) runs.push({ text: m[2], bold: true }); else runs.push({ text: m[3], italic: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs;
}
export const strip = (text) => inline(text).map((r) => r.text).join('');

// Resolved text with no markup — for the findings on the Research page and
// for the verification.
export function plain(body, R, docs) {
  return parseBlocks(body).map((b) => {
    if (b.type === 'ttable') { const t = tableFor(b.name, R, docs); return t ? t.rows.map((r) => r.join(' — ')).join('\n') : `⟨table:${b.name}⟩`; }
    if (b.type === 'ul' || b.type === 'ol') return b.items.map((x) => strip(resolve(x, R))).join('\n');
    if (b.type === 'table') return [b.head, ...b.rows].map((r) => r.map((c) => strip(resolve(c, R))).join(' | ')).join('\n');
    if (b.type === 'rule') return '';
    return strip(resolve(b.text, R));
  }).filter(Boolean).join('\n');
}

// ── Computed tables ─────────────────────────────────────────────────────────
// Each returns { head, rows, align } with cells already formatted. `docs` is
// { plan: { milestones, roadmap } } for the two tables that come from prose.
const F = FMT;
const tierLabel = (t) => (t.maxHead == null ? `over ${prevMax(t)} head` : `${t.tier.toLowerCase()}`);
let _tiersRef = null; const prevMax = (t) => { const i = _tiersRef?.findIndex((x) => x.key === t.key) ?? -1; return i > 0 ? _tiersRef[i - 1].maxHead : '—'; };

export const TABLES = {
  years: (R) => ({ head: ['', 'Year 1', 'Year 2', 'Year 3'], rows: [
    ['Customers at year end', ...R.years.map((y) => F.num(y.endCustomers))],
    ['ARR at year end', ...R.years.map((y) => F.usd(y.endARR))],
    ['Revenue', ...R.years.map((y) => F.usd(y.revenue))],
    ['Costs incl. cost of revenue', ...R.years.map((y) => F.usd(y.costs))],
    ['Operating profit before the draw', ...R.years.map((y) => F.usd(y.profitBeforeDraw))],
    ['Founder draw', ...R.years.map((y) => F.usd(y.draw))],
    ['**Profit after the draw**', ...R.years.map((y) => `**${F.usd(y.profit)}**`)],
    ['**Cash at year end**', ...R.years.map((y) => F.usd(y.endCash))],
    ['New customers — plan / allowed by hours', ...R.years.map((y) => `${F.num(y.newPlan)} / ${F.num(y.newActual)}`)],
  ], align: ['l', 'r', 'r', 'r'] }),
  scenarios: (R) => { const ks = R.scenarioOrder; return { head: ['', ...ks.map((k) => R.scenarios[k].label)], rows: [
    ['Customers, end of Year 3', ...ks.map((k) => F.num(R.scenarios[k].endCustomers))],
    ['**ARR, end of Year 3**', ...ks.map((k) => `**${F.usd(R.scenarios[k].endARR)}**`)],
    ['Profit, Year 3, after draw', ...ks.map((k) => F.usd(R.scenarios[k].profitY3))],
    ['Cash at end', ...ks.map((k) => F.usd(R.scenarios[k].endCash))],
    ['Draw starts', ...ks.map((k) => F.ym(R.scenarios[k].drawStartsMonth))],
  ], align: ['l', ...ks.map(() => 'r')] }; },
  sensitivity: (R) => ({ head: ['One assumption moved', 'Year-3 ARR, low', 'Year-3 ARR, high', 'Swing'], rows: R.sensitivity.map((s) => [s.name, F.usd(s.low), F.usd(s.high), `**${F.usd(s.swing)}**`]), align: ['l', 'r', 'r', 'r'] }),
  breakeven: (R) => ({ head: [`Break-even (blended ARPU ${F.usd2(R.breakeven.blendedArpu)})`, 'Paying customers'], rows: [
    ['Cover platform and professional services', F.num1(R.breakeven.fixed)],
    ['Cover that plus Year-3 contract help', F.num1(R.breakeven.fixedPlusHelp)],
    [`Pay the founder ${F.usd(R.costs.founderDraw)} a month`, F.num1(R.breakeven.founderDraw)],
  ], align: ['l', 'r'] }),
  unit: (R) => ({ head: ['Measure', 'Business', 'Ganadería (blended)'], rows: [
    ['Monthly price', F.usd2(R.unit.bizArpu), F.usd2(R.unit.ganArpu)],
    ['Expected life (churn curve)', `${F.num(R.unit.life)} months`, `${F.num(R.unit.life)} months`],
    ['Lifetime gross profit', F.usd(R.unit.ltvB), F.usd(R.unit.ltvG)],
    [`True CAC — cash plus ${R.A.capacity.hoursPerNewCustomer} founder hours`, F.usd(R.unit.trueCac), F.usd(R.unit.trueCac)],
    ['**LTV / true CAC**', `**${F.x(R.unit.ltvCacB)}**`, `**${F.x(R.unit.ltvCacG)}**`],
    ['Months to repay true CAC', F.num1(R.unit.paybackB), F.num1(R.unit.paybackG)],
  ], align: ['l', 'r', 'r'] }),
  priceList: (R) => ({ head: ['Program', 'Price / month', 'Share of GDP pc, NI'], rows: [
    ['Business — every market', F.usd(R.prices.business), F.pct(R.affordability.bizNi)],
    ...R.tiers.map((t) => [`Ganadería — ${t.tier.toLowerCase()}`, F.usd(t.price), F.pct(t.affordability)]),
  ], align: ['l', 'r', 'r'] }),
  marketSummary: (R) => ({ head: ['Measure', 'Businesses', 'Value / year', 'Basis'], rows: [
    ['TAM — Ganadería, every producer at the entry tier', F.num(R.market.producers), F.usd(R.market.tamG), 'CENAGRO 2011'],
    ['SAM — Ganadería, tiered', F.num(R.market.samGFarms), F.usd(R.market.samG), 'Upper-medium + large farms, three tiers'],
    [`SAM — Ganadería at the old ${F.usd(R.prices.oldFlat)} flat`, F.num(R.market.largeFarms), F.usd(R.market.samGAtOldFlat), 'Large farms only'],
    ['TAM — Business, US Latino-owned employer firms', F.num(R.market.usLatinoFirms), F.usd(R.market.tamB_us), 'Stanford SOLE 2023'],
    ['SAM — Business, reachable in three years', F.num(R.market.samB_farms), F.usd(R.market.samB), 'MO restaurants + NI MIPYMES (estimate)'],
    ['**SOM — plan case, end of Year 3**', `**${F.num(R.years[2].endCustomers)}**`, `**${F.usd(R.years[2].endARR)} ARR**`, 'From the engine'],
  ], align: ['l', 'r', 'r', 'l'] }),
  tierDerivation: (R) => { const m = R.market, ts = R.tiers; return { head: ['Step', 'Figure', 'Source'], rows: [
    ['Producers owning cattle', F.num(m.producers), 'CENAGRO 2011'],
    ['Share of farms under 60 head', F.pct(m.shareSmallMedium), 'World Bank'],
    ['→ Farms over 60 head', F.num(m.largeFarms), 'remainder'],
    ['National herd', F.num(m.herd), 'BCN / MAGFOR 2015'],
    ['Share of the herd on small and medium farms', F.pct(m.shareHerdOnSmallMedium), 'World Bank'],
    ['→ Head on large farms', F.num(m.headOnLarge), `${F.pct(m.shareHerdOnLarge)} of the herd`],
    ['**→ Average head per large farm**', `**${F.num(m.avgHeadLarge)}**`, 'the anchor'],
    [`Split ${ts.map((t) => t.tier.toLowerCase()).join(' / ')}`, ts.map((t) => F.pct(t.shareOfLarge)).join(' / '), `reconciles to ${F.num(m.mixAvg)} head`],
    ['Medium farms (16–60), assumed', F.num(m.mediumFarms), 'ASSUMPTION'],
    [`→ Upper half addressable at ${F.usd(R.prices.entry)}`, F.num(m.upperMedium), '40–60 head'],
  ], align: ['l', 'r', 'l'] }; },
  tamSam: (R) => ({ head: ['', 'Businesses', 'Price / yr', 'Value / yr'], rows: [
    ...R.tiers.map((t) => [`Ganadería — ${t.tier.toLowerCase()}, ${F.usd(t.price)}`, F.num(t.farms), F.usd(t.price * 12), F.usd(t.valueYr)]),
    ['**SAM — Ganadería, tiered**', `**${F.num(R.market.samGFarms)}**`, '', `**${F.usd(R.market.samG)}**`],
    [`SAM — at ${F.usd(R.prices.oldFlat)} flat`, F.num(R.market.largeFarms), F.usd(R.prices.oldFlat * 12), F.usd(R.market.samGAtOldFlat)],
    ['TAM — Business, US Latino-owned firms', F.num(R.market.usLatinoFirms), F.usd(R.prices.business * 12), F.usd(R.market.tamB_us)],
    ['SAM — Business, reachable in 3 years', F.num(R.market.samB_farms), F.usd(R.prices.business * 12), F.usd(R.market.samB)],
    ['**SOM — plan case, end of Year 3**', `**${F.num(R.years[2].endCustomers)}**`, '', `**${F.usd(R.years[2].endARR)} ARR**`],
  ], align: ['l', 'r', 'r', 'r'] }),
  'competitors.herd': (R) => ({ head: ['Herd software', '$ / month', 'Note'], rows: [
    ...R.competitors.herd.map((c) => [c.name, F.usd2(c.price), c.note || '']),
    ...R.tiers.map((t) => [`**SelRic — ${t.tier.toLowerCase()}**`, `**${F.usd(t.price)}**`, R.meta[`price.ganaderia.${t.key}.price`]?.note || '']),
  ], align: ['l', 'r', 'l'] }),
  'competitors.business': (R) => ({ head: ['Small-business software', '$ / month', 'Why a customer leaves it'], rows: [
    ...R.competitors.business.map((c) => [c.name, F.usd2(c.price), c.note || '']),
    ['**SelRic Business**', `**${F.usd(R.prices.business)}**`, R.meta['price.business']?.note || ''],
  ], align: ['l', 'r', 'l'] }),
  findings: (R, docs) => ({ head: ['Finding', 'What the model says'], rows: (docs?.findings || []).map((s, i) => [`**${i + 1}. ${strip(resolve(s.title, R))}**`, strip(resolve(s.body, R))]), align: ['l', 'l'] }),
  sources: (R) => ({ head: ['Source'], rows: R.sources.map((s) => [s]), align: ['l'] }),
  milestones: (R, docs) => ({ head: ['By', 'Milestone'], rows: (docs?.plan?.milestones || []).map((m) => [m.due, strip(resolve(m.what, R))]), align: ['l', 'l'] }),
  roadmap: (R, docs) => ({ head: ['Quarter', 'Focus', 'Actions'], rows: (docs?.plan?.roadmap || []).map((r) => [r.quarter, r.focus, strip(resolve(r.actions, R))]), align: ['l', 'l', 'l'] }),
  assumptions: (R) => ({ head: ['Assumption', 'Value'], rows: [
    ['Acquisition — new customers a month at months 1 → 12 → 24 → 36', [['usB', 'US · Business'], ['niB', 'Nicaragua · Business'], ['niG', 'Nicaragua · Ganadería']].map(([k, l]) => `${l}: ${R.A.acq[k].join(' → ')}`).join(' · ')],
    ['Pilots', `${R.A.pilots.usB} US Business, ${R.A.pilots.niB} NI Business, ${R.A.pilots.niG} Ganadería · ${F.pct(R.pilots.conversion)} convert in month ${R.pilots.month} (${F.mon(R.pilots.monthLabel)})`],
    ['Churn', `${F.pct(R.A.churn.earlyMonthly)} a month for the first ${R.A.churn.earlyMonths} months, then ${F.pct1(R.A.churn.steadyMonthly)} · expected life ${F.num(R.unit.life)} months`],
    ['Founder hours', `${R.A.capacity.founderSellingHours} selling hours a month · ${R.A.capacity.hoursPerNewCustomer}h per new customer · ${R.A.capacity.supportHoursPerCustomer}h a month per existing customer · an hour valued at $${R.A.capacity.founderHourValue}`],
    ['Contract help', `${R.A.capacity.contractHours.join(' → ')} hours a month at months 1/12/24/36, at $${R.A.capacity.contractRate}/h`],
    ['Costs', `${F.usd(R.costs.fixedMonthly)} a month fixed (platform, tools, accountant) · $${R.A.cost.cashCAC} cash per new customer · founder draw ${F.usd(R.A.cost.founderDraw)} a month once trailing ${R.A.cost.drawTrailingMonths}-month profit covers it · opening cash ${F.usd(R.A.cost.openingCash)}`],
    ['Prices', `Business ${F.usd(R.prices.business)} · Ganadería ${R.tiers.map((t) => F.usd(t.price)).join(' / ')} by herd size → blended ${F.usd2(R.unit.ganArpu)} on the assumed mix`],
    ['Annual prepay', `${F.pct(R.A.price.annualPrepayShare)} of joiners pay a year up front and get ${R.A.price.annualPrepayMonthsFree} months free`],
  ], align: ['l', 'l'] }),
};
export function tableFor(name, R, docs) { const f = TABLES[name]; if (!f) return null; _tiersRef = R.tiers; return f(R, docs); }
export const TABLE_NAMES = Object.keys(TABLES);
