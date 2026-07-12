// Phase 3 verification: try to post a deliberately UNBALANCED JE through
// public.post_journal_entry. The RPC MUST reject it AND MUST write nothing.
//
// Read/write footprint if the RPC is deployed:
//   • one rpc call attempt (rejected → no data)
//   • two count queries before/after against journal_entries + journal_entry_lines
//   • no successful inserts (that's the point)

import { supabase } from './_dbClient.mjs';

const RPC = 'post_journal_entry';

// Snapshot table counts so we can prove 0 rows were written.
async function count(table) {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count;
}

const before = {
  je:    await count('journal_entries'),
  lines: await count('journal_entry_lines'),
  txns:  await count('transactions'),
};
console.log('Row counts BEFORE attempted post:');
console.log(`  journal_entries       = ${before.je}`);
console.log(`  journal_entry_lines   = ${before.lines}`);
console.log(`  transactions          = ${before.txns}`);

const testReference = `TEST-REJECT-${Math.floor(Date.now())}`;
const badEntry = {
  reference:    testReference,
  date:         '2099-12-31',
  description:  'INTENTIONALLY UNBALANCED — must be rejected',
  memo:         'Phase A GATE 7/8 verification',
  total_amount: 100,
  status:       'posted',
  entry_type:   'test',
};
const badLines = [
  { account_id: null, description: 'test dr', debit_amount:  100, credit_amount: 0,   category: 'Miscellaneous' },
  { account_id: null, description: 'test cr', debit_amount:  0,   credit_amount: 50,  category: 'Miscellaneous' },
];
const badTxns = [];

const { data, error } = await supabase.rpc(RPC, {
  p_entry: badEntry,
  p_lines: badLines,
  p_txns:  badTxns,
});

console.log('\nAttempted to post unbalanced JE (DR 100 vs CR 50):');
if (error) {
  console.log(`  RPC error code:    ${error.code}`);
  console.log(`  RPC error message: ${error.message}`);
} else {
  console.log(`  RPC returned:      ${JSON.stringify(data)}`);
}

const after = {
  je:    await count('journal_entries'),
  lines: await count('journal_entry_lines'),
  txns:  await count('transactions'),
};
console.log('\nRow counts AFTER attempted post:');
console.log(`  journal_entries       = ${after.je}   (delta ${after.je - before.je})`);
console.log(`  journal_entry_lines   = ${after.lines}   (delta ${after.lines - before.lines})`);
console.log(`  transactions          = ${after.txns}   (delta ${after.txns - before.txns})`);

// Belt-and-braces: search for the test reference. Should never appear.
const { data: leaked } = await supabase.from('journal_entries')
  .select('id, reference')
  .eq('reference', testReference);
console.log(`\nRows in journal_entries with reference "${testReference}": ${leaked?.length || 0}`);

let verdict = 'UNKNOWN';
if (error?.code === 'PGRST202' || /post_journal_entry/i.test(error?.message || '')) {
  verdict = 'MIGRATION_NOT_APPLIED';
} else if (error && (after.je === before.je && after.lines === before.lines && after.txns === before.txns)) {
  verdict = 'PASS — RPC rejected the unbalanced entry and wrote nothing';
} else if (!error) {
  verdict = 'FAIL — RPC accepted an unbalanced entry (this is a HALT condition)';
} else {
  verdict = 'AMBIGUOUS — error occurred but row counts moved; inspect';
}
console.log(`\nVERDICT: ${verdict}`);

if (verdict.startsWith('PASS')) process.exit(0);
if (verdict.startsWith('MIGRATION_NOT_APPLIED')) process.exit(3);
process.exit(2);
