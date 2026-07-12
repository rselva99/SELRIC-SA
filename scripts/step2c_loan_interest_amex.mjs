// ─── LOAN INTEREST SPLIT + AMEX RECLASS ──────────────────────────────────
//
// STEP 1: create "Interest Expense" category (type=expense, active).
// STEP 2: recategorize 3 AMEX rows (April 2024) from Loans → Utilities.
// STEP 3: post one aggregate JE dated 2024-12-31:
//           DR Interest Expense 45,580.78
//           CR Loans           45,580.78
//         via the post_journal_entry RPC.
// STEP 4: reopen 2024-12 if needed; restore its prior status on exit.
//
// Approach chosen: SINGLE aggregate reclass JE (not 13 per-payment JEs).
// Rationale:
//   - Original 13 bank rows stay UNTOUCHED — they still tie to bank
//     reconciliation and to statement_totals.
//   - One JE is cleaner in the Journal history than 13 identical-purpose
//     entries; audit trail lives in the JE memo which itemizes the split
//     source (lender Loan History PDF).
//   - The RPC balances DR = CR atomically, so partial failure is impossible.

import { supabase, fetchAll } from './_dbClient.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
console.log(DRY_RUN ? '[DRY RUN]' : '[LIVE]');

// ── Constants ─────────────────────────────────────────────────────────
const TOTAL_INTEREST = 45580.78;
const TOTAL_PRINCIPAL = 29289.53;
const TOTAL_PAYMENTS  = 74870.31;
const AMEX_TOTAL      = 800.00;
const JE_DATE         = '2024-12-31';
const JE_DESCRIPTION  = 'Reclass 2024 loan interest — Southern Bank #150189510';
const JE_MEMO         = `Per lender Loan History PDF: 13 payments totaling $${TOTAL_PAYMENTS.toFixed(2)} split as principal $${TOTAL_PRINCIPAL.toFixed(2)} + interest $${TOTAL_INTEREST.toFixed(2)}. Original 13 bank rows are LEFT INTACT — their bank_statement_id is preserved for statement reconciliation. This JE simply moves the interest portion off the Loans liability and onto Interest Expense.`;

// ── Phase 1 verifies (re-run inline before writes) ────────────────────
console.log('\nRe-verifying Phase 1 immediately before writes...');

// 1.1/1.3/1.4 — Loans category
const loans = await fetchAll(
  supabase.from('transactions').select('*')
    .gte('date','2024-01-01').lte('date','2024-12-31')
    .eq('category','Loans').eq('voided',false)
);
const debits = loans.filter(r => r.type === 'debit');
const credits = loans.filter(r => r.type === 'credit');
const dSum = debits.reduce((a,r)=>a+Math.abs(+r.amount||0),0);
const cSum = credits.reduce((a,r)=>a+Math.abs(+r.amount||0),0);
if (Math.abs(dSum - 75670.31) > 0.005) throw new Error(`Loans DR ${dSum.toFixed(2)} != 75670.31`);
if (Math.abs(cSum - 443486.57) > 0.005) throw new Error(`Loans CR ${cSum.toFixed(2)} != 443486.57`);
console.log(`  Loans: 17 rows OK (DR ${dSum.toFixed(2)}, CR ${cSum.toFixed(2)})`);

// 1.3 AMEX rows
const amexRows = loans.filter(r => /AMEX Epayment/i.test(r.description || ''));
if (amexRows.length !== 3) throw new Error(`Expected 3 AMEX rows, got ${amexRows.length}`);
const amexSum = amexRows.reduce((a,r)=>a+Math.abs(+r.amount||0),0);
if (Math.abs(amexSum - AMEX_TOTAL) > 0.005) throw new Error(`AMEX sum ${amexSum} != 800`);
console.log(`  3 AMEX rows in Loans total ${amexSum.toFixed(2)} OK`);

// 1.5 Interest Expense category
const { data: intCatExisting } = await supabase.from('categories').select('*').eq('name', 'Interest Expense');
const intCatAlreadyThere = (intCatExisting?.length || 0) > 0;
console.log(`  Interest Expense category exists: ${intCatAlreadyThere ? 'YES (idempotent)' : 'NO — will create'}`);

// 1.6 P&L baseline
const cats = await fetchAll(supabase.from('categories').select('*'));
const typeOf = new Map();
for (const c of cats) typeOf.set(c.name, (c.type||'').toLowerCase());
const tx24 = await fetchAll(
  supabase.from('transactions').select('*')
    .gte('date','2024-01-01').lte('date','2024-12-31').eq('voided', false)
);
function debitOf(t){ return t?.type==='debit'?Math.abs(Number(t.amount)||0):0; }
function creditOf(t){ return t?.type==='credit'?Math.abs(Number(t.amount)||0):0; }
function signedDelta(t){ return creditOf(t)-debitOf(t); }
function debMinusCred(t){ return debitOf(t)-creditOf(t); }
let rev=0, exp=0;
for (const t of tx24) {
  const c = t.category;
  if (!c) continue;
  const ty = typeOf.get(c);
  if (ty === 'revenue') rev += signedDelta(t);
  else if (ty === 'expense') exp += debMinusCred(t);
}
if (Math.abs(rev - 1733190.26) > 0.01) throw new Error(`GATE 1.6 fail: Rev ${rev.toFixed(2)} != 1,733,190.26`);
if (Math.abs(exp - 1607834.87) > 0.01) throw new Error(`GATE 1.6 fail: Exp ${exp.toFixed(2)} != 1,607,834.87`);
if (Math.abs((rev-exp) - 125355.39) > 0.01) throw new Error(`GATE 1.6 fail: NI ${(rev-exp).toFixed(2)} != 125,355.39`);
console.log(`  P&L gate OK: rev ${rev.toFixed(2)} / exp ${exp.toFixed(2)} / ni ${(rev-exp).toFixed(2)}`);

// ── Snapshot period_close 2024-12 status ──────────────────────────────
const { data: pcDec } = await supabase.from('period_close').select('*').eq('period','2024-12').maybeSingle();
const priorStatus = pcDec?.status;
console.log(`\nperiod_close 2024-12 status: ${priorStatus}`);

async function reopenDec() {
  if (DRY_RUN || priorStatus !== 'closed') return;
  const { error } = await supabase.from('period_close').update({ status: 'open' }).eq('id', pcDec.id);
  if (error) throw new Error('reopen 2024-12: ' + error.message);
  console.log('  reopened 2024-12');
}
async function restoreDec() {
  if (DRY_RUN || priorStatus !== 'closed') return;
  const { error } = await supabase.from('period_close').update({ status: priorStatus }).eq('id', pcDec.id);
  if (error) console.error('restore 2024-12: ' + error.message);
  else console.log('  restored 2024-12 → ' + priorStatus);
}

try {

// ── STEP 1: create Interest Expense category ──────────────────────────
if (!intCatAlreadyThere) {
  if (DRY_RUN) {
    console.log('\nSTEP 1: would insert Interest Expense category');
  } else {
    const { error } = await supabase.from('categories').insert({
      name: 'Interest Expense',
      type: 'expense',
      description: 'Loan / financing interest expense',
      archived: false,
    });
    if (error) throw new Error('create Interest Expense category: ' + error.message);
    console.log('\nSTEP 1: created Interest Expense category');
  }
} else {
  console.log('\nSTEP 1: Interest Expense category already exists — skipping');
}

// ── STEP 2: recategorize 3 AMEX rows Loans → Utilities ───────────────
if (DRY_RUN) {
  console.log(`\nSTEP 2: would recategorize ${amexRows.length} AMEX rows → Utilities:`);
  for (const r of amexRows) console.log(`  ${r.id} ${r.date} ${r.amount} ${JSON.stringify(r.description).slice(0,60)}`);
} else {
  for (const r of amexRows) {
    const { error } = await supabase.from('transactions')
      .update({ category: 'Utilities' })
      .eq('id', r.id);
    if (error) throw new Error(`AMEX ${r.id} update: ${error.message}`);
  }
  console.log(`\nSTEP 2: recategorized ${amexRows.length} AMEX rows → Utilities (total ${AMEX_TOTAL.toFixed(2)})`);
}

// ── STEP 3: post aggregate reclass JE via RPC ────────────────────────
// Reference allocation: next JE-NNN sequentially. Match the pattern the
// app uses (nextJournalReference in src/lib/journalReference.js).
const allJe = await fetchAll(supabase.from('journal_entries').select('reference').ilike('reference', 'JE-%'));
const maxN = allJe
  .map(e => (e.reference || '').match(/^JE-(\d+)$/))
  .filter(Boolean)
  .map(m => parseInt(m[1], 10))
  .reduce((a, b) => Math.max(a, b), 0);
const nextRef = `JE-${String(maxN + 1).padStart(3, '0')}`;
console.log(`\nSTEP 3: posting reclass JE as ${nextRef} on ${JE_DATE}`);

await reopenDec();

const entry = {
  reference: nextRef,
  date: JE_DATE,
  description: JE_DESCRIPTION,
  memo: JE_MEMO,
  status: 'posted',
  entry_type: 'simple',
};
const lines = [
  { description: 'Interest Expense', category: 'Interest Expense', debit_amount:  TOTAL_INTEREST, credit_amount: 0 },
  { description: 'Loans',            category: 'Loans',            debit_amount: 0, credit_amount: TOTAL_INTEREST },
];
// Mirrored transactions — same shape the post_journal_entry RPC expects.
const txns = [
  { date: JE_DATE, description: 'Interest Expense',                supplier: 'Southern Bank',   amount: TOTAL_INTEREST, type: 'debit',  category: 'Interest Expense', posted: true },
  { date: JE_DATE, description: 'Reclass 2024 loan interest',      supplier: 'Southern Bank',   amount: TOTAL_INTEREST, type: 'credit', category: 'Loans',            posted: true },
];

if (DRY_RUN) {
  console.log('  would call post_journal_entry with:');
  console.log('   entry:', JSON.stringify(entry));
  console.log('   lines:', JSON.stringify(lines));
  console.log('   txns :', JSON.stringify(txns));
} else {
  const { data, error } = await supabase.rpc('post_journal_entry', { p_entry: entry, p_lines: lines, p_txns: txns });
  if (error) throw new Error('post_journal_entry: ' + error.message);
  console.log(`  posted ${data?.reference} (id ${data?.entry_id}) — DR ${data?.debits} CR ${data?.credits}`);
}

} finally {
  await restoreDec();
}

console.log('\ndone.');
