// Phase 2B / Task 5 — Class A Cash & Bank backfill for 2,162 rows.
//
// For each posted FY2024 bank-imported debit row (both `expense`-typed
// categories and the 13 Loans-category Southern Bank payments), insert a
// standalone mirror `transactions` row:
//   type='credit', category='Cash & Bank', reference='CASH-LEG-2024',
//   amount = source.amount (preserving the bank sign convention),
//   posted=true, journal_entry_id=NULL, bank_statement_id=source.bank_statement_id
//
// The `creditOf(t) = abs(amount) if type='credit'` aggregator behaves
// correctly regardless of amount sign — pairing a debit-side expense of $X
// with a credit-side Cash & Bank of $X produces the missing double-entry.
//
// Uses the shared fetchAll pagination. Reopens 2024 periods for INSERT.
// Idempotent: re-running skips rows that already have a CASH-LEG-2024 tag.

import { supabase, fetchAll } from './_dbClient.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
console.log(DRY_RUN ? '[DRY RUN]' : '[LIVE]');

const cats = await fetchAll(supabase.from('categories').select('*'));

const rows = await fetchAll(
  supabase.from('transactions').select('*')
    .gte('date','2024-01-01').lte('date','2024-12-31')
    .eq('voided', false).eq('posted', true).eq('type', 'debit')
    .not('bank_statement_id', 'is', null)
);
console.log('candidate rows (posted bank-imported debits FY2024):', rows.length);

// Idempotency: find rows that already have a CASH-LEG-2024 mirror.
const existingLegs = await fetchAll(
  supabase.from('transactions').select('id, description, date, amount, bank_statement_id')
    .eq('reference', 'CASH-LEG-2024')
);
console.log('CASH-LEG-2024 rows already present:', existingLegs.length);
const legKeys = new Set();
for (const l of existingLegs) {
  legKeys.add(`${l.bank_statement_id}|${l.date}|${Math.round((+l.amount||0)*100)}|${(l.description||'').slice(0,40)}`);
}

const toBackfill = rows.filter(r => {
  const desc = `[Cash leg] ${r.description || ''}`.slice(0,40);
  const k = `${r.bank_statement_id}|${r.date}|${Math.round((+r.amount||0)*100)}|${desc}`;
  return !legKeys.has(k);
});
console.log('rows still needing backfill:', toBackfill.length);
if (toBackfill.length === 0) { console.log('nothing to do'); process.exit(0); }

const totalMag = toBackfill.reduce((a,r) => a + Math.abs(+r.amount||0), 0);
console.log('total magnitude to backfill: $' + totalMag.toFixed(2));

// Reopen periods
const PERIODS = ['2024-01','2024-02','2024-03','2024-04','2024-05','2024-06','2024-07','2024-08','2024-09','2024-10','2024-11','2024-12'];
const { data: pcRows } = await supabase.from('period_close').select('*').in('period', PERIODS);
const closedSnapshot = (pcRows||[]).filter(r => r.status === 'closed');

async function reopenPeriods() {
  if (DRY_RUN) return;
  console.log(`Reopening ${closedSnapshot.length} 2024 periods`);
  for (const r of closedSnapshot) {
    const { error } = await supabase.from('period_close').update({ status: 'open' }).eq('id', r.id);
    if (error) throw new Error('reopen ' + r.period + ': ' + error.message);
  }
}
async function restorePeriods() {
  if (DRY_RUN) return;
  console.log(`Restoring ${closedSnapshot.length} 2024 period locks`);
  for (const r of closedSnapshot) {
    const { error } = await supabase.from('period_close').update({ status: 'closed' }).eq('id', r.id);
    if (error) console.error('restore ' + r.period + ': ' + error.message);
  }
}

await reopenPeriods();
try {
  const legRows = toBackfill.map(r => ({
    date: r.date,
    description: `[Cash leg] ${r.description || ''}`.slice(0, 255),
    supplier: r.supplier || r.description || '',
    amount: r.amount,                       // preserve original sign; type flips
    type: 'credit',
    category: 'Cash & Bank',
    account_id: null,
    reference: 'CASH-LEG-2024',
    bank_statement_id: r.bank_statement_id, // per DataContext pattern
    journal_entry_id: null,
    posted: true,
    voided: false,
  }));
  if (DRY_RUN) {
    console.log('would insert', legRows.length, 'mirror rows');
  } else {
    // Batch insert in chunks of 500 to stay under Supabase row limits.
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < legRows.length; i += CHUNK) {
      const batch = legRows.slice(i, i + CHUNK);
      const { error } = await supabase.from('transactions').insert(batch);
      if (error) throw new Error(`insert batch ${i}: ${error.message}`);
      inserted += batch.length;
      console.log(`  inserted ${inserted}/${legRows.length}`);
    }
    console.log(`Backfill complete: ${inserted} mirror rows inserted`);
  }
} finally {
  await restorePeriods();
}
console.log('done.');
