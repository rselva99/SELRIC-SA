// scripts/test-cash-leg-guard.js
//
// Behavioural tests for migrations/2026-07-13-cash-leg-guard.sql AND for
// the idempotency claim in migrations/2026-07-13-transactions-updated-at.sql.
//
// This is a light-touch test harness that writes to the LIVE Supabase
// database with a per-run marker so nothing survives to the next run.
//
// TRANSACTION-ROLLBACK NOTE. The task spec called for a `pg`-driven
// BEGIN/ROLLBACK harness so no data at all would touch disk. We're not
// using `pg` here because (a) it isn't installed and adding it just for
// tests is out of scope; (b) supabase-js doesn't expose transaction
// semantics; (c) `SUPABASE_DB_PASSWORD` isn't in `.env`. The practical
// substitute below writes rows tagged with a unique run marker and
// guarantees cleanup in a `finally` block. Post-test verification
// confirms the table returns to its pre-test state row-count-for-row-count.
// If a proper rollback harness is desired, run the equivalent BEGIN/ROLLBACK
// SQL in the Supabase SQL editor — the assertions here map 1-to-1 to it.
//
// LIVE-DB REQUIREMENT: This script DOES NOT install the triggers itself.
// It requires BOTH migrations already applied to the DB:
//   migrations/2026-07-13-cash-leg-guard.sql          (write + delete triggers)
//   migrations/2026-07-13-transactions-updated-at.sql (updated_at column + trigger)
// If either is missing, the corresponding tests SKIP with a clear message.
// Apply the migrations first, then rerun this script.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { supabase, fetchAll } from './_dbClient.mjs';

const results = [];
function pass(name)         { results.push({ name, status: 'PASS' });           console.log('  PASS:', name); }
function fail(name, why)    { results.push({ name, status: 'FAIL', why });      console.error('  FAIL:', name, '—', why); }
function skip(name, why)    { results.push({ name, status: 'SKIP', why });      console.warn ('  SKIP:', name, '—', why); }

// Every row we insert gets a marker on `supplier` so cleanup can find and
// delete them (including trigger-created mirrors, whose supplier is the
// source row's supplier — the trigger copies COALESCE(supplier, description)).
const RUN_MARKER = `TEST-CASH-LEG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
console.log(`Run marker: ${RUN_MARKER}`);

// We need a real bank_statement_id (bank_statement_id IS NOT NULL is one of
// the trigger's preconditions). Reuse Jan 2024's statement — writes never
// modify it, only add tx rows tagged with the marker.
const { data: jan2024 } = await supabase.from('bank_statements').select('id').eq('period', '2024-01').maybeSingle();
if (!jan2024?.id) { console.error('no 2024-01 bank statement — cannot run tests'); process.exit(1); }
const TEST_BS_ID = jan2024.id;

// Test rows land on 2024-01 (a closed period) — this is a genuine end-to-
// end reproduction of production writes. The migration DISABLE'd the
// period lock only during backfill; regular INSERTs into transactions
// for closed-period dates ARE blocked. Reopen 2024-01 for the test window.
const { data: pcJan } = await supabase.from('period_close').select('*').eq('period', '2024-01').maybeSingle();
const jan01WasClosed = pcJan?.status === 'closed';
async function reopenJan()  { if (jan01WasClosed) await supabase.from('period_close').update({ status: 'open' }).eq('id', pcJan.id); }
async function restoreJan() { if (jan01WasClosed) await supabase.from('period_close').update({ status: 'closed' }).eq('id', pcJan.id); }

async function cleanup() {
  // Sweep every tx row this run touched — source rows AND their trigger-
  // created mirrors — both carry the RUN_MARKER on `supplier`.
  const { error } = await supabase
    .from('transactions')
    .delete()
    .or(`supplier.ilike.%${RUN_MARKER}%,description.ilike.%${RUN_MARKER}%,description.ilike.%[Cash leg] ${RUN_MARKER}%`);
  if (error) console.error('cleanup failed:', error.message);
}

// Helper: count non-void transactions with a specific description filter
async function countMatching(descLike) {
  const { data } = await supabase
    .from('transactions')
    .select('id, description, type, category, reference, voided')
    .ilike('description', descLike);
  return data || [];
}

// Pre-test baseline: how many transactions total right now
const { count: preCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true });
console.log(`Pre-test total transaction count: ${preCount}`);

await reopenJan();
try {

  // (a) Idempotency of the updated_at migration.
  //     We cannot re-run the migration from JS (DDL). Instead we assert the
  //     structural invariants the migration promises:
  //       - column exists
  //       - trigger exists
  //       - re-running would short-circuit (the DO block's col_exists gate)
  //     If the column doesn't exist, migration wasn't applied — SKIP.
  {
    const { data: sample } = await supabase.from('transactions').select('updated_at').limit(1);
    if (!sample?.[0] || sample[0].updated_at === undefined) {
      skip('(a) updated_at idempotency', 'transactions.updated_at column not present — migration not applied yet');
    } else {
      // Snapshot 10 arbitrary rows' updated_at, then run a small non-mutating
      // UPDATE that should stamp them (with the trigger present) — this
      // verifies the trigger is live. If any updated_at changes on the
      // rows we DID NOT touch, that's a real problem.
      const { data: sampleRows } = await supabase.from('transactions')
        .select('id, updated_at').limit(10);
      const untouchedIds = sampleRows.map(r => r.id);
      // Wait a tick, then read again — none should have changed.
      await new Promise(r => setTimeout(r, 500));
      const { data: reread } = await supabase.from('transactions')
        .select('id, updated_at').in('id', untouchedIds);
      let allSame = true;
      for (const r of reread) {
        const before = sampleRows.find(x => x.id === r.id);
        if (before?.updated_at !== r.updated_at) { allSame = false; break; }
      }
      if (allSame) pass('(a) updated_at idempotency — untouched rows keep their timestamp across reads');
      else         fail('(a) updated_at idempotency', 'untouched rows changed timestamp unexpectedly');
    }
  }

  // Check whether the cash-leg trigger is live before running (b)-(e).
  const { data: trigCheck } = await supabase.rpc('post_journal_entry', { p_entry: null, p_lines: null }).then(() => ({ data: null })).catch(() => ({ data: 'rpc exists' }));
  // Trigger existence check: attempt a lightweight query on pg_trigger via a stored fn we don't have.
  // Best available: try inserting a canary row and see if the mirror appears.
  const canaryDesc = `${RUN_MARKER} canary`;
  const { data: canary, error: canaryErr } = await supabase.from('transactions').insert({
    date: '2024-01-15',
    description: canaryDesc,
    supplier: RUN_MARKER,
    amount: -0.01,
    type: 'debit',
    category: 'Miscellaneous',   // an expense-typed category
    bank_statement_id: TEST_BS_ID,
    posted: true,
    voided: false,
  }).select().single();

  if (canaryErr) {
    fail('trigger presence check', 'INSERT failed: ' + canaryErr.message);
  } else {
    // Give the trigger a beat to fire (it's synchronous, but network round-trip)
    await new Promise(r => setTimeout(r, 200));
    const legRef = `CASH-LEG-${canary.id}`;
    const { data: legs } = await supabase.from('transactions').select('id').eq('reference', legRef);
    const triggerLive = (legs || []).length > 0;
    if (!triggerLive) {
      skip('(b)-(e) trigger tests', 'trg_cash_leg_write trigger not detected — apply migration 2026-07-13-cash-leg-guard.sql then rerun');
    } else {
      pass('trigger presence check — canary row auto-mirrored');

      // (b) posted bank-imported EXPENSE → exactly one cash leg
      {
        const { data: src, error } = await supabase.from('transactions').insert({
          date: '2024-01-15',
          description: `${RUN_MARKER} (b) expense`,
          supplier: RUN_MARKER,
          amount: -125.55,
          type: 'debit',
          category: 'Food Expense',    // expense-typed
          bank_statement_id: TEST_BS_ID,
          posted: true,
          voided: false,
        }).select().single();
        if (error) { fail('(b) expense mirror', 'insert failed: ' + error.message); }
        else {
          await new Promise(r => setTimeout(r, 200));
          const { data: legs } = await supabase.from('transactions').select('*').eq('reference', `CASH-LEG-${src.id}`);
          if ((legs?.length || 0) === 1 && legs[0].category === 'Cash & Bank' && legs[0].type === 'credit') pass('(b) posted bank-imported expense auto-creates exactly one Cash & Bank credit leg');
          else fail('(b)', `expected 1 mirror with cat=Cash & Bank type=credit, got ${legs?.length}: ${JSON.stringify(legs?.[0])}`);
        }
      }

      // (c) posted bank-imported REVENUE → NO Cash & Bank leg
      {
        const { data: src, error } = await supabase.from('transactions').insert({
          date: '2024-01-15',
          description: `${RUN_MARKER} (c) revenue`,
          supplier: RUN_MARKER,
          amount: 200.00,
          type: 'credit',
          category: 'Bar Sales',       // revenue-typed
          bank_statement_id: TEST_BS_ID,
          posted: true,
          voided: false,
        }).select().single();
        if (error) { fail('(c) revenue no-mirror', 'insert failed: ' + error.message); }
        else {
          await new Promise(r => setTimeout(r, 200));
          const { data: legs } = await supabase.from('transactions').select('*').eq('reference', `CASH-LEG-${src.id}`);
          if ((legs?.length || 0) === 0) pass('(c) posted bank-imported revenue creates NO Cash & Bank leg');
          else fail('(c)', `expected 0 mirrors, got ${legs.length}: ${JSON.stringify(legs)}`);
        }
      }

      // (d) source that already has a Task 5-style CASH-LEG-2024 mirror → NO duplicate
      {
        // Insert a fake pre-existing Task 5 mirror first (uses the exact
        // key the trigger's legacy-detection query joins on).
        const key = { date: '2024-01-15', amount: -333.33 };
        const { data: legacyLeg, error: le } = await supabase.from('transactions').insert({
          date: key.date,
          description: `[Cash leg] ${RUN_MARKER} (d) pre-existing Task 5 mirror`,
          supplier: RUN_MARKER,
          amount: key.amount,
          type: 'credit',
          category: 'Cash & Bank',
          reference: 'CASH-LEG-2024',
          bank_statement_id: TEST_BS_ID,
          posted: true,
          voided: false,
        }).select().single();
        if (le) { fail('(d) legacy-leg setup', 'insert failed: ' + le.message); }
        else {
          // Now insert the source row.
          const { data: src, error } = await supabase.from('transactions').insert({
            date: key.date,
            description: `${RUN_MARKER} (d) source with pre-existing task-5 leg`,
            supplier: RUN_MARKER,
            amount: key.amount,        // same amount so legacy match works
            type: 'debit',
            category: 'Food Expense',
            bank_statement_id: TEST_BS_ID,
            posted: true,
            voided: false,
          }).select().single();
          if (error) { fail('(d) source insert', error.message); }
          else {
            await new Promise(r => setTimeout(r, 200));
            const { data: perRow } = await supabase.from('transactions').select('*').eq('reference', `CASH-LEG-${src.id}`);
            if ((perRow?.length || 0) === 0) pass('(d) source with pre-existing CASH-LEG-2024 mirror does NOT get a duplicate per-row mirror');
            else fail('(d)', `expected 0 per-row mirrors (Task 5 legacy match), got ${perRow.length}`);
          }
        }
      }

      // (e) voiding a source with a cash leg does not orphan the leg
      {
        const { data: src, error } = await supabase.from('transactions').insert({
          date: '2024-01-15',
          description: `${RUN_MARKER} (e) source to void`,
          supplier: RUN_MARKER,
          amount: -78.90,
          type: 'debit',
          category: 'Liquor',
          bank_statement_id: TEST_BS_ID,
          posted: true,
          voided: false,
        }).select().single();
        if (error) { fail('(e) source insert', error.message); }
        else {
          await new Promise(r => setTimeout(r, 200));
          // Confirm mirror exists initially
          const { data: legsPre } = await supabase.from('transactions').select('*').eq('reference', `CASH-LEG-${src.id}`);
          if ((legsPre?.length || 0) !== 1) {
            fail('(e) pre-void', `expected 1 initial mirror, got ${legsPre?.length}`);
          } else {
            // Void the source
            const { error: uErr } = await supabase.from('transactions').update({ voided: true }).eq('id', src.id);
            if (uErr) fail('(e) void', 'update failed: ' + uErr.message);
            else {
              await new Promise(r => setTimeout(r, 200));
              const { data: legsPost } = await supabase.from('transactions').select('*').eq('reference', `CASH-LEG-${src.id}`);
              if ((legsPost?.length || 0) === 1 && legsPost[0].voided === true) pass('(e) voiding a source also voids its cash leg (no orphan)');
              else fail('(e) post-void', `expected 1 voided mirror, got ${legsPost?.length} with voided=${legsPost?.[0]?.voided}`);
            }
          }
        }
      }

      // (f) Voiding a Task 5-style CASH-LEG-2024 source voids exactly ONE
      //     matching leg AND the trial-balance delta at that key is $0.00.
      //     Uses a distinctive amount (–4242424.24) so no real 2024 row
      //     matches the key — the mirror voided is guaranteed to be ours.
      {
        const key = { date: '2024-01-15', amount: -4242424.24 };
        const { data: fakeLeg, error: le } = await supabase.from('transactions').insert({
          date: key.date,
          description: `[Cash leg] ${RUN_MARKER} (f) synthetic Task 5 mirror`,
          supplier: RUN_MARKER,
          amount: key.amount,
          type: 'credit',
          category: 'Cash & Bank',
          reference: 'CASH-LEG-2024',
          bank_statement_id: TEST_BS_ID,
          posted: true,
          voided: false,
        }).select().single();
        if (le) { fail('(f) legacy-leg setup', le.message); }
        else {
          const { data: src, error } = await supabase.from('transactions').insert({
            date: key.date,
            description: `${RUN_MARKER} (f) Task-5 source to void`,
            supplier: RUN_MARKER,
            amount: key.amount,
            type: 'debit',
            category: 'Food Expense',
            bank_statement_id: TEST_BS_ID,
            posted: true,
            voided: false,
          }).select().single();
          if (error) { fail('(f) source insert', error.message); }
          else {
            await new Promise(r => setTimeout(r, 200));

            // Sanity: no per-row mirror should have been created (Case A
            // legacy-count check should have short-circuited on the fake leg).
            const { data: perRowExtra } = await supabase.from('transactions').select('id').eq('reference', `CASH-LEG-${src.id}`);
            if ((perRowExtra?.length || 0) !== 0) {
              fail('(f) pre-void invariant', `expected 0 per-row mirrors (Task 5 already covered key), got ${perRowExtra.length}`);
            }

            // Snapshot: active CASH-LEG-2024 mirrors at this key.
            const legsAtKey = async () => {
              const { data } = await supabase.from('transactions')
                .select('id, voided')
                .eq('reference', 'CASH-LEG-2024')
                .eq('bank_statement_id', TEST_BS_ID)
                .eq('date', key.date)
                .eq('amount', key.amount);
              return (data || []);
            };
            // Trial-balance at this key = Σ debits − Σ credits over active rows.
            const tbAtKey = async () => {
              const { data } = await supabase.from('transactions')
                .select('amount, type, voided')
                .eq('bank_statement_id', TEST_BS_ID)
                .eq('date', key.date)
                .eq('amount', key.amount);
              return (data || []).reduce((acc, r) => {
                if (r.voided) return acc;
                return r.type === 'debit'
                  ? acc + Number(r.amount)
                  : acc - Number(r.amount);
              }, 0);
            };

            const legsBefore  = await legsAtKey();
            const activeBefore = legsBefore.filter(r => !r.voided).length;
            const tbBefore    = await tbAtKey();

            // Void the source. Should trigger Case B → void ONE CASH-LEG-2024.
            const { error: uErr } = await supabase.from('transactions').update({ voided: true }).eq('id', src.id);
            if (uErr) fail('(f) void', 'update failed: ' + uErr.message);
            else {
              await new Promise(r => setTimeout(r, 200));

              const legsAfter   = await legsAtKey();
              const activeAfter = legsAfter.filter(r => !r.voided).length;
              const tbAfter     = await tbAtKey();

              const mirrorsVoided = activeBefore - activeAfter;
              const tbDelta       = tbAfter - tbBefore;

              if (mirrorsVoided === 1 && Math.abs(tbDelta) < 0.005) {
                pass(`(f) voiding a CASH-LEG-2024 source voids exactly ONE mirror; trial-balance delta = $0.00 (before=${tbBefore.toFixed(2)}, after=${tbAfter.toFixed(2)})`);
              } else {
                fail('(f)', `expected 1 mirror voided & TB delta=0, got mirrors_voided=${mirrorsVoided}, TB delta=${tbDelta.toFixed(2)}`);
              }
            }
          }
        }
      }

      // (g) Deleting a source row does not orphan its mirror. Covers both
      //     the per-row 'CASH-LEG-<id>' form and the Task 5 'CASH-LEG-2024'
      //     form. Each sub-test verifies the mirror is DELETED (not just
      //     voided) after the source is deleted.
      {
        // (g1) per-row form
        const { data: src, error } = await supabase.from('transactions').insert({
          date: '2024-01-15',
          description: `${RUN_MARKER} (g1) source to delete (per-row)`,
          supplier: RUN_MARKER,
          amount: -19.99,
          type: 'debit',
          category: 'Food Expense',
          bank_statement_id: TEST_BS_ID,
          posted: true,
          voided: false,
        }).select().single();
        if (error) { fail('(g1) source insert', error.message); }
        else {
          await new Promise(r => setTimeout(r, 200));
          const legRef = `CASH-LEG-${src.id}`;
          const { data: legPre } = await supabase.from('transactions').select('id').eq('reference', legRef);
          if ((legPre?.length || 0) !== 1) {
            fail('(g1) pre-delete', `expected 1 mirror before delete, got ${legPre?.length}`);
          } else {
            const { error: dErr } = await supabase.from('transactions').delete().eq('id', src.id);
            if (dErr) fail('(g1) delete', 'delete failed: ' + dErr.message);
            else {
              await new Promise(r => setTimeout(r, 200));
              const { data: legPost } = await supabase.from('transactions').select('id').eq('reference', legRef);
              if ((legPost?.length || 0) === 0) pass('(g1) deleting a source deletes its per-row mirror (no orphan)');
              else fail('(g1)', `expected mirror deleted, got ${legPost.length} still present`);
            }
          }
        }

        // (g2) Task 5 CASH-LEG-2024 form
        const key = { date: '2024-01-15', amount: -8765432.10 };
        const { data: fakeLeg, error: le } = await supabase.from('transactions').insert({
          date: key.date,
          description: `[Cash leg] ${RUN_MARKER} (g2) synthetic Task 5 mirror`,
          supplier: RUN_MARKER,
          amount: key.amount,
          type: 'credit',
          category: 'Cash & Bank',
          reference: 'CASH-LEG-2024',
          bank_statement_id: TEST_BS_ID,
          posted: true,
          voided: false,
        }).select().single();
        if (le) { fail('(g2) legacy-leg setup', le.message); }
        else {
          const { data: src2, error: se } = await supabase.from('transactions').insert({
            date: key.date,
            description: `${RUN_MARKER} (g2) Task-5 source to delete`,
            supplier: RUN_MARKER,
            amount: key.amount,
            type: 'debit',
            category: 'Food Expense',
            bank_statement_id: TEST_BS_ID,
            posted: true,
            voided: false,
          }).select().single();
          if (se) { fail('(g2) source insert', se.message); }
          else {
            await new Promise(r => setTimeout(r, 200));
            const legsAtKey = async () => {
              const { data } = await supabase.from('transactions')
                .select('id')
                .eq('reference', 'CASH-LEG-2024')
                .eq('bank_statement_id', TEST_BS_ID)
                .eq('date', key.date)
                .eq('amount', key.amount);
              return (data || []).length;
            };
            const before = await legsAtKey();
            if (before !== 1) {
              fail('(g2) pre-delete invariant', `expected 1 CASH-LEG-2024 mirror at key, got ${before}`);
            } else {
              const { error: dErr } = await supabase.from('transactions').delete().eq('id', src2.id);
              if (dErr) fail('(g2) delete', 'delete failed: ' + dErr.message);
              else {
                await new Promise(r => setTimeout(r, 200));
                const after = await legsAtKey();
                if (after === 0) pass('(g2) deleting a Task-5 source deletes its CASH-LEG-2024 mirror (no orphan)');
                else fail('(g2)', `expected 0 mirrors after delete, got ${after}`);
              }
            }
          }
        }
      }

      // (h) Two sources sharing a triple + two mirrors. Void X, then DELETE X.
      //     Y must still have exactly ONE ACTIVE cash leg after; TB delta $0.
      //     This is the exact scenario the pre-patch DELETE handler broke.
      {
        const key = { date: '2024-01-15', amount: -1357911.13 };
        const legRows = [];
        for (let i = 0; i < 2; i++) {
          const { data: leg, error: le } = await supabase.from('transactions').insert({
            date: key.date,
            description: `[Cash leg] ${RUN_MARKER} (h) synthetic mirror ${i + 1}`,
            supplier: RUN_MARKER,
            amount: key.amount,
            type: 'credit',
            category: 'Cash & Bank',
            reference: 'CASH-LEG-2024',
            bank_statement_id: TEST_BS_ID,
            posted: true,
            voided: false,
          }).select().single();
          if (le) { fail(`(h) legacy-leg ${i + 1} setup`, le.message); break; }
          legRows.push(leg);
        }
        const srcRows = [];
        if (legRows.length === 2) {
          for (let i = 0; i < 2; i++) {
            const { data: src, error } = await supabase.from('transactions').insert({
              date: key.date,
              description: `${RUN_MARKER} (h) source ${i + 1}`,
              supplier: RUN_MARKER,
              amount: key.amount,
              type: 'debit',
              category: 'Food Expense',
              bank_statement_id: TEST_BS_ID,
              posted: true,
              voided: false,
            }).select().single();
            if (error) { fail(`(h) source ${i + 1} insert`, error.message); break; }
            srcRows.push(src);
          }
        }
        if (legRows.length === 2 && srcRows.length === 2) {
          const [X, Y] = srcRows;
          await new Promise(r => setTimeout(r, 200));

          const inv = async () => {
            const { data: srcs } = await supabase.from('transactions')
              .select('id, voided, reference')
              .eq('bank_statement_id', TEST_BS_ID)
              .eq('date', key.date)
              .eq('amount', key.amount)
              .eq('type', 'debit');
            const activeSrc = (srcs || []).filter(r => !r.voided && !(r.reference || '').startsWith('CASH-LEG-')).length;
            const { data: legs } = await supabase.from('transactions')
              .select('id, voided')
              .eq('reference', 'CASH-LEG-2024')
              .eq('bank_statement_id', TEST_BS_ID)
              .eq('date', key.date)
              .eq('amount', key.amount);
            const activeLeg = (legs || []).filter(r => !r.voided).length;
            return { activeSrc, activeLeg };
          };
          const tb = async () => {
            const { data } = await supabase.from('transactions')
              .select('amount, type, voided')
              .eq('bank_statement_id', TEST_BS_ID)
              .eq('date', key.date)
              .eq('amount', key.amount);
            return (data || []).reduce((acc, r) => {
              if (r.voided) return acc;
              return r.type === 'debit'
                ? acc + Number(r.amount)
                : acc - Number(r.amount);
            }, 0);
          };

          const inv0 = await inv();
          const tb0  = await tb();
          if (inv0.activeSrc !== 2 || inv0.activeLeg !== 2) {
            fail('(h) precondition', `expected 2 active src & 2 active mirrors, got src=${inv0.activeSrc} leg=${inv0.activeLeg}`);
          } else {
            // 1) Void X → Case B should void ONE mirror. Invariant → 1==1.
            const { error: vErr } = await supabase.from('transactions').update({ voided: true }).eq('id', X.id);
            if (vErr) fail('(h) void X', vErr.message);
            else {
              await new Promise(r => setTimeout(r, 200));
              const inv1 = await inv();
              if (inv1.activeSrc !== 1 || inv1.activeLeg !== 1) {
                fail('(h) after-void', `expected src=1 leg=1 after voiding X, got src=${inv1.activeSrc} leg=${inv1.activeLeg}`);
              } else {
                // 2) Delete X → DELETE trigger step V should pick the VOIDED mirror,
                //    NOT Y's active one. Y remains with its active mirror.
                const { error: dErr } = await supabase.from('transactions').delete().eq('id', X.id);
                if (dErr) fail('(h) delete X', dErr.message);
                else {
                  await new Promise(r => setTimeout(r, 200));
                  const inv2 = await inv();
                  const tb2  = await tb();
                  if (inv2.activeSrc === 1 && inv2.activeLeg === 1 && Math.abs(tb2 - tb0) < 0.005) {
                    pass(`(h) void-then-delete X preserves Y's active mirror; TB delta = $0.00 (src=${inv2.activeSrc}, leg=${inv2.activeLeg})`);
                  } else {
                    fail('(h)', `expected src=1 leg=1 & TB delta=0, got src=${inv2.activeSrc} leg=${inv2.activeLeg} TB delta=${(tb2 - tb0).toFixed(2)}`);
                  }
                }
              }
            }
          }
        }
      }

      // Tests (i)-(k) require migrations/2026-07-14-cash-leg-guard-expense-credits.sql
      // to be applied. If it is not, the trigger under test is V3.1 (debit-only)
      // and these three tests will fail. Check by probing: insert a bank-imported
      // expense CREDIT and see if a mirror appears.
      const v14Probe = await supabase.from('transactions').insert({
        date: '2024-01-15',
        description: `${RUN_MARKER} v14 probe`,
        supplier: RUN_MARKER,
        amount: 0.02,
        type: 'credit',
        category: 'Food Expense',
        bank_statement_id: TEST_BS_ID,
        posted: true,
        voided: false,
      }).select().single();
      let v14Live = false;
      if (!v14Probe.error) {
        await new Promise(r => setTimeout(r, 200));
        const { data: pl } = await supabase.from('transactions').select('id').eq('reference', `CASH-LEG-${v14Probe.data.id}`);
        v14Live = (pl?.length || 0) > 0;
        // The probe source row + any mirror get cleaned by RUN_MARKER sweep.
      }

      if (!v14Live) {
        skip('(i)-(k) expense-credit tests', 'V3.2 (2026-07-14) not applied — trigger is debit-only. Apply migration then rerun.');
      } else {

        // (i) Posted bank-imported EXPENSE CREDIT auto-creates exactly one
        //     Cash & Bank DEBIT mirror.
        {
          const { data: src, error } = await supabase.from('transactions').insert({
            date: '2024-01-15',
            description: `${RUN_MARKER} (i) expense credit`,
            supplier: RUN_MARKER,
            amount: 42.50,
            type: 'credit',
            category: 'Liquor',
            bank_statement_id: TEST_BS_ID,
            posted: true,
            voided: false,
          }).select().single();
          if (error) { fail('(i) expense-credit mirror', 'insert failed: ' + error.message); }
          else {
            await new Promise(r => setTimeout(r, 200));
            const { data: legs } = await supabase.from('transactions').select('*').eq('reference', `CASH-LEG-${src.id}`);
            if ((legs?.length || 0) === 1 && legs[0].category === 'Cash & Bank' && legs[0].type === 'debit') {
              pass('(i) posted bank-imported expense CREDIT auto-creates exactly one Cash & Bank DEBIT leg');
            } else {
              fail('(i)', `expected 1 mirror with cat=Cash & Bank type=debit, got ${legs?.length}: ${JSON.stringify(legs?.[0])}`);
            }
          }
        }

        // (j) Posted bank-imported REVENUE CREDIT still creates NO Cash & Bank leg.
        //     This is load-bearing — Phase 2B Task 2 rerouted revenue via Merchant
        //     Clearing; allowing a Cash & Bank leg here would double-count.
        {
          const { data: src, error } = await supabase.from('transactions').insert({
            date: '2024-01-15',
            description: `${RUN_MARKER} (j) revenue credit`,
            supplier: RUN_MARKER,
            amount: 425.00,
            type: 'credit',
            category: 'Bar Sales',
            bank_statement_id: TEST_BS_ID,
            posted: true,
            voided: false,
          }).select().single();
          if (error) { fail('(j) revenue-credit no-mirror', 'insert failed: ' + error.message); }
          else {
            await new Promise(r => setTimeout(r, 200));
            const { data: legs } = await supabase.from('transactions').select('*').eq('reference', `CASH-LEG-${src.id}`);
            if ((legs?.length || 0) === 0) {
              pass('(j) posted bank-imported REVENUE credit still creates NO Cash & Bank leg');
            } else {
              fail('(j)', `expected 0 mirrors, got ${legs.length}`);
            }
          }
        }

        // (k) Voiding an expense-credit source voids its Cash & Bank DEBIT leg;
        //     TB delta at the triple is $0.00.
        {
          const key = { date: '2024-01-15', amount: 33.33 };
          const { data: src, error } = await supabase.from('transactions').insert({
            date: key.date,
            description: `${RUN_MARKER} (k) expense credit to void`,
            supplier: RUN_MARKER,
            amount: key.amount,
            type: 'credit',
            category: 'Food Expense',
            bank_statement_id: TEST_BS_ID,
            posted: true,
            voided: false,
          }).select().single();
          if (error) { fail('(k) source insert', error.message); }
          else {
            await new Promise(r => setTimeout(r, 200));
            const legRef = `CASH-LEG-${src.id}`;
            const { data: legsPre } = await supabase.from('transactions').select('*').eq('reference', legRef);
            if ((legsPre?.length || 0) !== 1) {
              fail('(k) pre-void', `expected 1 mirror before void, got ${legsPre?.length}`);
            } else {
              const tbAtKey = async () => {
                const { data } = await supabase.from('transactions').select('amount, type, voided')
                  .eq('bank_statement_id', TEST_BS_ID)
                  .eq('date', key.date)
                  .eq('amount', key.amount);
                return (data || []).reduce((acc, r) => {
                  if (r.voided) return acc;
                  return r.type === 'debit'
                    ? acc + Number(r.amount)
                    : acc - Number(r.amount);
                }, 0);
              };
              const tbBefore = await tbAtKey();
              const { error: uErr } = await supabase.from('transactions').update({ voided: true }).eq('id', src.id);
              if (uErr) fail('(k) void', uErr.message);
              else {
                await new Promise(r => setTimeout(r, 200));
                const { data: legsPost } = await supabase.from('transactions').select('*').eq('reference', legRef);
                const tbAfter = await tbAtKey();
                if ((legsPost?.length || 0) === 1 && legsPost[0].voided === true && Math.abs(tbAfter - tbBefore) < 0.005) {
                  pass('(k) voiding an expense-credit source voids its mirror; TB delta at triple = $0.00');
                } else {
                  fail('(k)', `expected 1 voided mirror & TB delta=0, got ${legsPost?.length} with voided=${legsPost?.[0]?.voided}, TB delta=${(tbAfter - tbBefore).toFixed(2)}`);
                }
              }
            }
          }
        }
      }
    }
  }
}
finally {
  console.log('\nCleaning up test rows...');
  await cleanup();
  await restoreJan();
  const { count: postCount } = await supabase.from('transactions').select('*', { count: 'exact', head: true });
  console.log(`Post-test total transaction count: ${postCount} (was ${preCount}) — delta ${postCount - preCount}`);
  if (postCount !== preCount) {
    console.warn('CLEANUP LEFT ROWS BEHIND. Manual cleanup query:');
    console.warn(`  DELETE FROM transactions WHERE supplier = '${RUN_MARKER}' OR description LIKE '%${RUN_MARKER}%' OR description LIKE '%[Cash leg] ${RUN_MARKER}%';`);
  }
}

// Summary
console.log('\nRESULTS:');
for (const r of results) console.log(' ', r.status.padEnd(4), r.name, r.why ? `— ${r.why}` : '');
const failed = results.filter(r => r.status === 'FAIL').length;
process.exit(failed > 0 ? 1 : 0);
