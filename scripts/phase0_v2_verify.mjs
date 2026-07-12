import { supabase, fetchAll } from './_dbClient.mjs';

const entries = await fetchAll(
  supabase
    .from('journal_entries')
    .select('id, date, reference, description, status')
    .order('date', { ascending: true })
);
const lines = await fetchAll(
  supabase.from('journal_entry_lines').select('*')
);

console.log(`journal_entries fetched: ${entries.length}`);
console.log(`journal_entry_lines fetched: ${lines.length}`);

const nonVoided = entries.filter((e) => e.status !== 'voided');
console.log(`non-voided JEs: ${nonVoided.length}`);

// Build map je_id -> lines
const linesByJE = new Map();
for (const l of lines) {
  if (!linesByJE.has(l.journal_entry_id))
    linesByJE.set(l.journal_entry_id, []);
  linesByJE.get(l.journal_entry_id).push(l);
}

// Include voided-line filter: check if lines have a "voided" or similar column
if (lines.length > 0) {
  console.log(`line columns: ${Object.keys(lines[0]).join(', ')}`);
}

const num = (v) => Number(v || 0);

const buckets = { drOnly: [], crOnly: [], other: [], balanced: [] };
let totalDR = 0,
  totalCR = 0;

for (const je of nonVoided) {
  const ls = linesByJE.get(je.id) || [];
  const dr = ls.reduce((s, l) => s + num(l.debit_amount), 0);
  const cr = ls.reduce((s, l) => s + num(l.credit_amount), 0);
  const diff = dr - cr;
  totalDR += dr;
  totalCR += cr;
  const row = {
    ref: je.reference,
    date: je.date,
    desc: (je.description || '').slice(0, 60),
    lines: ls.length,
    dr,
    cr,
    diff,
  };
  if (Math.abs(diff) < 0.005) {
    buckets.balanced.push(row);
  } else if (cr === 0) {
    buckets.drOnly.push(row);
  } else if (dr === 0) {
    buckets.crOnly.push(row);
  } else {
    buckets.other.push(row);
  }
}

const sum = (arr, k) => arr.reduce((s, r) => s + r[k], 0);
console.log(
  `\nBalanced JEs: ${buckets.balanced.length}   Unbalanced JEs: ${
    buckets.drOnly.length + buckets.crOnly.length + buckets.other.length
  }`
);
console.log(`  (a) DR-only    count=${buckets.drOnly.length}   totalDR=${sum(buckets.drOnly, 'dr').toFixed(2)}   totalCR=${sum(buckets.drOnly, 'cr').toFixed(2)}   totalDiff=${sum(buckets.drOnly, 'diff').toFixed(2)}`);
console.log(`  (b) CR-only    count=${buckets.crOnly.length}   totalDR=${sum(buckets.crOnly, 'dr').toFixed(2)}   totalCR=${sum(buckets.crOnly, 'cr').toFixed(2)}   totalDiff=${sum(buckets.crOnly, 'diff').toFixed(2)}`);
console.log(`  (c) multi-line count=${buckets.other.length}   totalDR=${sum(buckets.other, 'dr').toFixed(2)}   totalCR=${sum(buckets.other, 'cr').toFixed(2)}   totalDiff=${sum(buckets.other, 'diff').toFixed(2)}`);

console.log(`\nTotals across non-voided JEs (headers, from JE-lines):`);
console.log(`  SUM(DR) = ${totalDR.toFixed(2)}`);
console.log(`  SUM(CR) = ${totalCR.toFixed(2)}`);
console.log(`  DR - CR = ${(totalDR - totalCR).toFixed(2)}   (audit reported -1,264,395.39)`);

console.log(`\nTotals across ALL lines (voided included) — audit reported -1,264,395.39`);
const rawDR = lines.reduce((s, l) => s + num(l.debit_amount), 0);
const rawCR = lines.reduce((s, l) => s + num(l.credit_amount), 0);
console.log(`  SUM(DR) all lines = ${rawDR.toFixed(2)}`);
console.log(`  SUM(CR) all lines = ${rawCR.toFixed(2)}`);
console.log(`  DR - CR all lines = ${(rawDR - rawCR).toFixed(2)}`);

const printRows = (label, rows) => {
  console.log(`\n--- ${label} (${rows.length}) ---`);
  const w = (s, n) => (s + ' '.repeat(n)).slice(0, n);
  console.log(
    `  ${w('REF', 12)} ${w('DATE', 12)} ${w('DESC', 60)} ${w('LN', 3)} ${w('DR', 12)} ${w('CR', 12)} ${w('DIFF', 12)}`
  );
  for (const r of rows.sort((a, b) => (a.date > b.date ? 1 : -1))) {
    console.log(
      `  ${w(r.ref || '', 12)} ${w(r.date, 12)} ${w(r.desc, 60)} ${w(String(r.lines), 3)} ${w(r.dr.toFixed(2), 12)} ${w(r.cr.toFixed(2), 12)} ${w(r.diff.toFixed(2), 12)}`
    );
  }
};
printRows('DR-only', buckets.drOnly);
printRows('CR-only', buckets.crOnly);
printRows('multi-line unbalanced', buckets.other);

console.log(`\nArithmetic proof:`);
const sumAllDiff = sum(buckets.drOnly, 'diff') + sum(buckets.crOnly, 'diff') + sum(buckets.other, 'diff');
console.log(`  Sum of diffs across all unbalanced JEs = ${sumAllDiff.toFixed(2)}`);
console.log(`  (audit reported total DR - CR = -1,264,395.39)`);
console.log(`  Match? ${Math.abs(sumAllDiff - (-1264395.39)) < 0.05 ? 'YES' : 'NO'}`);

// Note: with 59 unbalanced JEs, no way all-DR-only can sum to negative.
// Audit's claim "all DR-only" contradicts "DR-CR = -1.26M". Let's show that.
console.log(`\nContradiction test:`);
console.log(`  If all 59 unbalanced were DR-only, sum of diffs would be positive.`);
console.log(`  Observed sum of diffs = ${sumAllDiff.toFixed(2)}`);
console.log(`  DR-only entries alone contribute: ${sum(buckets.drOnly, 'diff').toFixed(2)}`);
console.log(`  CR-only + multi entries contribute: ${(sum(buckets.crOnly, 'diff') + sum(buckets.other, 'diff')).toFixed(2)}`);
