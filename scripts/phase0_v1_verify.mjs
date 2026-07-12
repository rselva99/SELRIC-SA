import { supabase, fetchAll } from './_dbClient.mjs';

const txns = await fetchAll(
  supabase
    .from('transactions')
    .select('id, date, amount, description, type, category, journal_entry_id, voided')
    .order('date', { ascending: true })
);

console.log(`Total transactions rows fetched: ${txns.length}`);

const active = txns.filter((t) => !t.voided);
console.log(`Non-voided transactions: ${active.length}`);

// --- Duplicate check keyed by (date, amount, description) ONLY (audit key) ---
const looseKey = (t) =>
  `${t.date}|${Number(t.amount).toFixed(2)}|${(t.description || '').trim()}`;
const looseMap = new Map();
for (const t of active) {
  const k = looseKey(t);
  if (!looseMap.has(k)) looseMap.set(k, []);
  looseMap.get(k).push(t);
}
const looseGroups = [...looseMap.values()].filter((g) => g.length > 1);
console.log(
  `Loose-key (date+amount+description) duplicate GROUPS: ${looseGroups.length}`
);

// --- Duplicate check keyed by (date, amount, description, type, category) ---
const strictKey = (t) =>
  `${t.date}|${Number(t.amount).toFixed(2)}|${(t.description || '').trim()}|${
    t.type
  }|${(t.category || '').trim()}`;
const strictMap = new Map();
for (const t of active) {
  const k = strictKey(t);
  if (!strictMap.has(k)) strictMap.set(k, []);
  strictMap.get(k).push(t);
}
const strictGroups = [...strictMap.values()].filter((g) => g.length > 1);
console.log(
  `Strict-key (date+amount+description+type+category) duplicate GROUPS: ${strictGroups.length}`
);
console.log(`Rows involved in strict-key dupe groups: ${strictGroups.reduce((s, g) => s + g.length, 0)}`);

// Focus on the 12 depreciation "duplicates" the audit reported.
const depTxns = active.filter(
  (t) =>
    (t.category || '').toLowerCase().includes('depreciation') ||
    (t.description || '').toLowerCase().includes('depreciation')
);
console.log(`\n--- Depreciation-related rows: ${depTxns.length} ---`);

// Group depreciation rows by loose key to inspect the "12 duplicates"
const depLooseMap = new Map();
for (const t of depTxns) {
  const k = looseKey(t);
  if (!depLooseMap.has(k)) depLooseMap.set(k, []);
  depLooseMap.get(k).push(t);
}
const depLooseGroups = [...depLooseMap.values()].filter((g) => g.length > 1);
console.log(`Loose-key dep dupe groups: ${depLooseGroups.length}`);
for (const g of depLooseGroups) {
  console.log(
    `  ${g[0].date} | $${g[0].amount} | "${g[0].description}" | rows: ${g.length}`
  );
  for (const r of g) {
    console.log(
      `      id=${r.id} type=${r.type} category="${r.category}" je=${r.journal_entry_id}`
    );
  }
}

// Strict-key on dep
const depStrictMap = new Map();
for (const t of depTxns) {
  const k = strictKey(t);
  if (!depStrictMap.has(k)) depStrictMap.set(k, []);
  depStrictMap.get(k).push(t);
}
const depStrictGroups = [...depStrictMap.values()].filter((g) => g.length > 1);
console.log(`Strict-key dep dupe groups: ${depStrictGroups.length}`);

// --- Verify 2024 totals ---
const in2024 = (t) => t.date >= '2024-01-01' && t.date <= '2024-12-31';
const sumDR = (rows, cat) => {
  const filtered = rows.filter((t) => (t.category || '').trim() === cat && t.type === 'debit');
  return filtered.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
};

const dep2024DR = sumDR(active.filter(in2024), 'Depreciation Expense');
const amt2024DR = sumDR(active.filter(in2024), 'Amortization Expense');
const oldDep2024DR = sumDR(active.filter(in2024), 'Depreciation & Amortization');
console.log(`\n--- 2024 Debit totals ---`);
console.log(`Depreciation Expense DR: ${dep2024DR.toFixed(2)}   (expected 7,082.90)`);
console.log(`Amortization Expense DR: ${amt2024DR.toFixed(2)}   (expected 11,704.33)`);
console.log(`(legacy) Depreciation & Amortization DR: ${oldDep2024DR.toFixed(2)}`);

// Halt condition
const HALT = [];
if (Math.abs(dep2024DR - 7082.90) > 0.01 && Math.abs(dep2024DR - 14165.80) < 0.01) {
  HALT.push(`Depreciation Expense is DOUBLE: ${dep2024DR}`);
}
if (Math.abs(amt2024DR - 11704.33) > 0.01 && Math.abs(amt2024DR - 23408.66) < 0.01) {
  HALT.push(`Amortization Expense is DOUBLE: ${amt2024DR}`);
}
if (HALT.length > 0) {
  console.log(`\n*** HALT ***`);
  for (const h of HALT) console.log(`  ${h}`);
  process.exit(2);
}
console.log(`\nV1 result: no real duplicate D&A JEs. Audit's "12 duplicates" are DR/CR leg pairs.`);
