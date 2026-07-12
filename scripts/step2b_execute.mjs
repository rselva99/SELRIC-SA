// ─── STEP 2b — EXECUTE APPROVED DECISIONS ────────────────────────────────
//
// D2  Recategorize 1 bank row Rent → Licenses & Permits
// D5  Void JE-026 (+ its mirror tx) and the orphan "Payroll Report January" tx
// D6  Add CR Cash & Bank leg to 12 Rent JEs   (12 × $7,500 = $90,000)
// D8  Add CR Cash & Bank leg to 13 Payroll plug JEs ($407,759.08 total)
// D10 Add DR Cash & Bank leg to 12 Revenue Breakdown JEs ($1,733,190.26 total)
//
// Idempotent — skips any JE that already has a Cash & Bank leg. Period locks
// are reopened before inserts and restored on the way out (try/finally).

import { supabase, fetchAll } from './_dbClient.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
console.log(DRY_RUN ? '[DRY RUN]' : '[LIVE]');

const je  = await fetchAll(supabase.from('journal_entries').select('*'));
const jel = await fetchAll(supabase.from('journal_entry_lines').select('*'));
const byJEId = new Map();
for (const l of jel) { if (!byJEId.has(l.journal_entry_id)) byJEId.set(l.journal_entry_id, []); byJEId.get(l.journal_entry_id).push(l); }
const byRef = new Map(je.map(e => [e.reference, e]));
const jeById = new Map(je.map(e => [e.id, e]));

// ── D2 target ─────────────────────────────────────────────────────────
const { data: d2Rows } = await supabase
  .from('transactions')
  .select('id, date, amount, description, category')
  .eq('date', '2024-04-10')
  .eq('category', 'Rent')
  .ilike('description', 'Pb Northstar Lea%');
if (d2Rows?.length !== 1) throw new Error(`D2: expected exactly 1 row, found ${d2Rows?.length}`);
const d2Row = d2Rows[0];
console.log(`D2 target: ${d2Row.id}  ${d2Row.date}  ${d2Row.amount}  ${JSON.stringify(d2Row.description)}`);

// ── D5 targets ────────────────────────────────────────────────────────
const je026 = byRef.get('JE-026');
const je026mirrors = await fetchAll(supabase.from('transactions').select('*').eq('journal_entry_id', je026.id));
const { data: orphanRows } = await supabase
  .from('transactions')
  .select('*')
  .eq('date', '2024-01-31')
  .eq('type', 'debit')
  .eq('amount', 44865.41)
  .is('journal_entry_id', null)
  .is('bank_statement_id', null);
if (orphanRows?.length !== 1) throw new Error(`D5: expected exactly 1 orphan tx, found ${orphanRows?.length}`);
const orphan = orphanRows[0];
console.log(`D5 targets: JE-026=${je026.id} (${je026.status}) with ${je026mirrors.length} mirror tx; orphan=${orphan.id}`);

// ── D6 D8 D10 planning ─────────────────────────────────────────────────
const D6_REFS  = ['JE-001','JE-002','JE-003','JE-004','JE-005','JE-006','JE-007','JE-008','JE-009','JE-010','JE-011','JE-012'];
const D8_REFS  = ['JE-033','JE-055','JE-058','JE-035','JE-037','JE-041','JE-043','JE-046','JE-049','JE-052','JE-064','JE-059','JE-061'];
const D10_REFS = ['JE-030','JE-056','JE-036','JE-038','JE-042','JE-044','JE-047','JE-050','JE-053','JE-065','JE-060','JE-063'];

function summarizeExisting(refs, label) {
  console.log(`\n${label}:`);
  const rows = [];
  for (const ref of refs) {
    const j = byRef.get(ref);
    if (!j) throw new Error(`${label}: JE ${ref} not found`);
    const ls = byJEId.get(j.id) || [];
    const dr = ls.reduce((a,l)=>a+(+l.debit_amount||0), 0);
    const cr = ls.reduce((a,l)=>a+(+l.credit_amount||0), 0);
    const hasCash = ls.some(l => l.category === 'Cash & Bank');
    rows.push({ ref, id: j.id, date: j.date, dr, cr, hasCash });
    console.log(`  ${ref}  ${j.date}  DR=${dr.toFixed(2)}  CR=${cr.toFixed(2)}  hasCashLeg=${hasCash}`);
  }
  return rows;
}
const d6 = summarizeExisting(D6_REFS, 'D6 (12 Rent JEs) — expect all DR=7500 CR=0 hasCashLeg=false');
const d8 = summarizeExisting(D8_REFS, 'D8 (13 Payroll JEs) — expect DR sum 407759.08 hasCashLeg=false');
const d10 = summarizeExisting(D10_REFS, 'D10 (12 Revenue JEs) — expect CR sum 1733190.26 hasCashLeg=false');

// ── Reopen 2024 periods ────────────────────────────────────────────────
const PERIODS = ['2024-01','2024-02','2024-03','2024-04','2024-05','2024-06','2024-07','2024-08','2024-09','2024-10','2024-11','2024-12'];
const { data: closedRows } = await supabase.from('period_close').select('*').in('period', PERIODS);
const closedSnapshot = (closedRows || []).filter(r => r.status === 'closed');
async function reopen() {
  if (DRY_RUN) return;
  console.log(`\nReopening ${closedSnapshot.length} 2024 periods for writes`);
  for (const r of closedSnapshot) {
    const { error } = await supabase.from('period_close').update({ status: 'open' }).eq('id', r.id);
    if (error) throw new Error(`reopen ${r.period}: ${error.message}`);
  }
}
async function restore() {
  if (DRY_RUN) return;
  console.log(`\nRestoring ${closedSnapshot.length} 2024 period locks`);
  for (const r of closedSnapshot) {
    const { error } = await supabase.from('period_close').update({ status: 'closed' }).eq('id', r.id);
    if (error) console.error(`restore ${r.period}: ${error.message}`);
  }
}

await reopen();
try {

// ── D2: recategorize ───────────────────────────────────────────────────
if (!DRY_RUN) {
  const { error } = await supabase.from('transactions').update({ category: 'Licenses & Permits' }).eq('id', d2Row.id);
  if (error) throw new Error('D2 update: ' + error.message);
  console.log(`\nD2: recategorized 1 row → Licenses & Permits`);
}

// ── D5: void JE-026 + its mirror + orphan ─────────────────────────────
if (!DRY_RUN) {
  const memo = 'Voided: first-attempt January payroll ($44,865.41) and its reversal. Correct January payroll = bank fragments $6,907.03 + JE-033 plug $37,957.97 = $44,865.00.';
  const { error: e1 } = await supabase
    .from('journal_entries')
    .update({ status: 'voided', memo })
    .eq('id', je026.id);
  if (e1) throw new Error('D5 void JE-026: ' + e1.message);

  for (const m of je026mirrors) {
    const { error: e2 } = await supabase.from('transactions').update({ voided: true }).eq('id', m.id);
    if (e2) throw new Error(`D5 void JE-026 mirror tx ${m.id}: ${e2.message}`);
  }
  const { error: e3 } = await supabase.from('transactions').update({ voided: true }).eq('id', orphan.id);
  if (e3) throw new Error('D5 void orphan: ' + e3.message);
  console.log(`D5: voided JE-026 (+ ${je026mirrors.length} mirror), voided orphan tx`);
}

// ── D6: add CR Cash & Bank to 12 Rent JEs ─────────────────────────────
async function addCashLeg(planRow, side /* 'CR' | 'DR' */, amount, sourceLabel) {
  const { ref, id, date, hasCash } = planRow;
  if (hasCash) { console.log(`  ${ref}: SKIP (already has Cash & Bank leg)`); return null; }
  const jeRow = jeById.get(id);
  const memoDesc = `[Cash leg] ${sourceLabel}`;
  const line = {
    journal_entry_id: id,
    account_id: null,
    description: 'Cash & Bank',
    debit_amount:  side === 'DR' ? amount : 0,
    credit_amount: side === 'CR' ? amount : 0,
    category: 'Cash & Bank',
  };
  const tx = {
    date,
    description: memoDesc,
    supplier: sourceLabel,
    amount,
    type: side === 'DR' ? 'debit' : 'credit',
    category: 'Cash & Bank',
    account_id: null,
    reference: jeRow.reference,
    bank_statement_id: null,
    journal_entry_id: id,
    posted: true,
    voided: false,
  };
  if (DRY_RUN) return null;
  const { error: e1 } = await supabase.from('journal_entry_lines').insert(line);
  if (e1) throw new Error(`insert line for ${ref}: ${e1.message}`);
  const { error: e2 } = await supabase.from('transactions').insert(tx);
  if (e2) throw new Error(`insert mirror tx for ${ref}: ${e2.message}`);
  console.log(`  ${ref}: added ${side} Cash & Bank ${amount.toFixed(2)}`);
  return { line, tx };
}

console.log(`\nD6: adding CR Cash & Bank $7,500 to 12 Rent JEs`);
for (const r of d6) await addCashLeg(r, 'CR', 7500, 'Rent');

console.log(`\nD8: adding CR Cash & Bank to 13 Payroll plug JEs`);
for (const r of d8) await addCashLeg(r, 'CR', r.dr, 'Payroll');

console.log(`\nD10: adding DR Cash & Bank to 12 Revenue JEs`);
for (const r of d10) await addCashLeg(r, 'DR', r.cr, 'Revenue Breakdown');

} finally {
  await restore();
}

console.log('\ndone.');
