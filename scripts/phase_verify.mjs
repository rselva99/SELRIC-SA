// Aggregates the numbers needed for the 12-row VERIFY table.

import { supabase, fetchAll } from './_dbClient.mjs';

const txns = await fetchAll(
  supabase
    .from('transactions')
    .select('id, date, amount, description, type, category, journal_entry_id, voided, posted')
    .order('date')
);

const in2024 = (t) => t.date >= '2024-01-01' && t.date <= '2024-12-31';
const activeNonVoided = txns.filter((t) => !t.voided);
const y2024 = activeNonVoided.filter(in2024);

// Row 6: AccountantPage year fetch should now return all 2,368 rows
console.log(`Row 6 (year fetch returns all 2024 txns): ${y2024.length}`);
console.log(`Row 6b (total non-voided rows): ${activeNonVoided.length}`);

// Row 10: 12 depreciation JEs still total 7,082.90
const depTxns = y2024.filter((t) => (t.category || '').trim() === 'Depreciation Expense' && t.type === 'debit');
const depTotal = depTxns.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
console.log(`Row 10 (12 dep JEs total): ${depTotal.toFixed(2)}  (${depTxns.length} rows)`);

// Row 11: 12 amortization JEs still total 11,704.33
const amtTxns = y2024.filter((t) => (t.category || '').trim() === 'Amortization Expense' && t.type === 'debit');
const amtTotal = amtTxns.reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
console.log(`Row 11 (12 amort JEs total): ${amtTotal.toFixed(2)}  (${amtTxns.length} rows)`);

// Row 12: L09A, L09B, L12A, L12B unchanged (book_bs_lines)
const bs = await fetchAll(supabase.from('book_bs_lines').select('*').eq('year', 2024));
const lookup = (code) => bs.find((l) => l.section_code === code);
for (const code of ['L09A', 'L09B', 'L12A', 'L12B']) {
  const l = lookup(code);
  console.log(`Row 12 ${code}: title=${l?.title}, beginning=${l?.beginning_balance}, ending=${l?.ending_balance_confirmed}`);
}
