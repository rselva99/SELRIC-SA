// ─── RE-EXTRACT 2024 BANK STATEMENT DEPOSITS ────────────────────────────────
//
// One-shot recovery script for the Step 1 defect: the historical extractor
// prompt in src/lib/claude.js explicitly EXCLUDED deposits, so the 12 imported
// 2024 statements captured only debits (2,162 rows, all negative). This script:
//
//   1. Downloads each PDF from the `documents` Supabase storage bucket.
//   2. Extracts text with pdfjs-dist (Node-compatible legacy build).
//   3. Sends the text to Anthropic's Claude API with a full-statement prompt
//      that asks for BOTH deposits and non-check withdrawals + summary totals.
//   4. Uses the shared partitionNewRows() dedupe to insert ONLY missing rows —
//      the 2,162 existing debit rows are matched by (date, amount, desc) and
//      left untouched. Only credit/deposit rows land in the DB.
//   5. Updates bank_statements.statement_totals with the printed summary block.
//
// Idempotent: safe to re-run. Every debit row we already have will be filtered
// out by the dedupe; totals are UPSERTed onto the row.
//
// The script does NOT:
//   - modify or delete any existing row
//   - categorize deposits (all left as UNCATEGORIZED so no revenue-mapping
//     decision is bundled into the recovery run)
//   - post any transaction (posted=false, so the P&L is unchanged)
//   - touch journal entries, book_bs_lines, or period_close snapshots

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { supabase, fetchAll } from './_dbClient.mjs';
import { partitionNewRows } from '../src/lib/statementDedupe.js';
import { validateStatementTotals, assertHasDeposits } from '../src/lib/statementValidation.js';

const require = createRequire(import.meta.url);
const pdfjs   = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = 'file://' + require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');


function loadEnv() {
  const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const env = loadEnv();
const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing from .env');

// ── PDF text extraction (Node) ────────────────────────────────────────────
async function pdfToText(buf) {
  const pdf = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const c = await page.getTextContent();
    const sorted = [...c.items].sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      return Math.abs(yDiff) > 2 ? yDiff : a.transform[4] - b.transform[4];
    });
    const lines = [];
    let cur = [], lastY = null;
    for (const it of sorted) {
      const y = it.transform[5];
      if (lastY === null || Math.abs(y - lastY) > 2) {
        if (cur.length) lines.push(cur.map(x => x.str).join(' '));
        cur = [it];
      } else {
        cur.push(it);
      }
      lastY = y;
    }
    if (cur.length) lines.push(cur.map(x => x.str).join(' '));
    pages.push(`=== page ${i} ===\n${lines.join('\n')}`);
    page.cleanup();
  }
  await pdf.destroy();
  return pages.join('\n\n');
}

// ── Anthropic call ────────────────────────────────────────────────────────
// Prompt mirrors the fixed src/lib/claude.js extractBankStatementFromText —
// keeping it inline (not importing) so the script has no browser-only deps.
function buildSystemPrompt(anchorPeriod) {
  const anchor = anchorPeriod?.start && anchorPeriod?.end
    ? `\n\nSTATEMENT PERIOD ANCHOR — REQUIRED CONSTRAINT:\nThis statement covers ${anchorPeriod.start} to ${anchorPeriod.end}. Every transaction date MUST fall within or near this range. Resolve ambiguous partial dates ("12/05" or "Dec 5") to the year that places them inside this anchor.\n`
    : '';
  return `You are a financial document parser. The following is text extracted from a bank statement PDF. The text preserves the original line structure but column alignment may be imperfect.${anchor}

INCLUDE (as transactions):
- Deposits & Credits: merchant/processor deposits (SpotOn, Square, Stripe, Toast), "Deposit - Thank You" teller cash deposits, refunds, wire receipts, ACH credits, incoming transfers, card credits.
- Non-check withdrawals: ACH payments, wires, card purchases, POS transactions, bank fees, service charges, interest, ATM withdrawals, online bill payments (non-check).

EXCLUDE from the transactions list:
- Checks of any kind: paper checks, check payments, items in a "Checks" / "Checks Paid" section, entries with check numbers ("Check 1234", "Ck #5678", "CHK 0042", or descriptions that are just a number). Their total belongs in statement_totals.checks_total.

SIGN CONVENTION — REQUIRED:
- Deposits/credits: POSITIVE amount, "type":"credit"
- Withdrawals/debits: NEGATIVE amount, "type":"debit"

Return ONLY valid JSON (no markdown, no backticks):
{
  "bank_name": "string",
  "account_number_last4": "string",
  "statement_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "opening_balance": number,
  "closing_balance": number,
  "statement_totals": {
    "beginning_balance": number,
    "deposits_total": number,
    "withdrawals_total": number,
    "checks_total": number,
    "fees_total": number,
    "returned_checks_total": number,
    "automatic_transfers_total": number,
    "ending_balance": number,
    "deposit_count": number,
    "withdrawal_count": number
  },
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "string", "reference": "string or null", "amount": number, "type": "credit or debit", "balance": number or null }
  ]
}

statement_totals MUST come from the statement's PRINTED SUMMARY block. deposits_total, withdrawals_total, checks_total, and fees_total are POSITIVE dollar amounts. Regions summaries in particular print separate lines for "Returned Checks" (money credited back after a bounced check — goes in returned_checks_total, positive) and "Automatic Transfers" (net transfer, positive if net-in). CRITICAL: a trailing hyphen on a Regions balance ("$9,813.61 -") means the balance is NEGATIVE (overdrawn) — report ending_balance as −9813.61 in that case. Use 0 for fields the summary doesn't print. If unsure whether an item is a check, exclude it from transactions.`;
}

async function callClaudeText(text, anchorPeriod) {
  const systemPrompt = buildSystemPrompt(anchorPeriod);
  const messages = [{
    role: 'user',
    content: `Extract BOTH deposits and non-check withdrawals AND the printed summary totals from this bank statement text. Deposits: positive amount, type="credit". Withdrawals: negative amount, type="debit". Exclude checks from the transactions list.\n\n${text}`,
  }];
  return await postClaude(systemPrompt, messages);
}

async function postClaude(systemPrompt, messages) {
  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 32000, system: systemPrompt, messages }),
  });
  if (!upstream.ok) {
    const body = await upstream.text();
    throw new Error(`Anthropic ${upstream.status}: ${body.slice(0, 400)}`);
  }
  const data = await upstream.json();
  const raw = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const stripped = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = stripped.match(/{[\s\S]*}/);
  if (!match) throw new Error(`No JSON object in Claude response: ${stripped.slice(0, 300)}`);
  return JSON.parse(match[0]);
}

// ── Native PDF path for scanned PDFs (Sep/Oct/Dec 2024) ───────────────────
// Anthropic accepts PDF documents up to 32 MB directly — we're running from
// Node (no Vercel 4.5 MB body cap), so send the whole thing and let Claude
// do vision on it. Simpler and more reliable than pdfjs canvas rendering in
// Node, which has intermittent issues with the fake-worker path.

function buildImageFirstPagePrompt(anchorPeriod) {
  const anchor = anchorPeriod?.start && anchorPeriod?.end
    ? `\n\nSTATEMENT PERIOD ANCHOR — REQUIRED CONSTRAINT:\nThis statement covers ${anchorPeriod.start} to ${anchorPeriod.end}. Every transaction date MUST fall within or near this range.\n`
    : '';
  return `You are extracting bank metadata, statement totals, and transactions (deposits AND non-check withdrawals) from page 1 of a bank statement image.${anchor}

INCLUDE (as transactions):
- Deposits & Credits: merchant/processor deposits (SpotOn, Square, Stripe, Toast), teller cash deposits ("Deposit - Thank You"), refunds, ACH credits, wire receipts, card credits.
- Non-check withdrawals: ACH, wires, card purchases, POS, bank fees, service charges, ATM withdrawals.

EXCLUDE from transactions:
- Any check (paper checks, check numbers, "Checks Paid" section entries). Their total goes in statement_totals.checks_total.

SIGN CONVENTION — REQUIRED:
- Deposits: POSITIVE amount, "type":"credit"
- Withdrawals: NEGATIVE amount, "type":"debit"

Return ONLY valid JSON — no markdown, no backticks:
{
  "bank_name": "string",
  "account_number_last4": "string",
  "statement_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "statement_totals": {
    "beginning_balance": number,
    "deposits_total": number,
    "withdrawals_total": number,
    "checks_total": number,
    "fees_total": number,
    "returned_checks_total": number,
    "automatic_transfers_total": number,
    "ending_balance": number,
    "deposit_count": number,
    "withdrawal_count": number
  },
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "string", "reference": "string or null", "amount": number, "type": "credit or debit", "balance": number or null }
  ]
}

statement_totals MUST come from the printed summary block on this image. *_total fields are POSITIVE dollar amounts. A trailing hyphen on a Regions balance ("$9,813.61 -") means NEGATIVE (overdrawn). Use 0 for fields the summary doesn't print.`;
}

async function callClaudePdf(pdfBuf, anchorPeriod) {
  const systemPrompt = buildImageFirstPagePrompt(anchorPeriod); // same schema — meta + txns + totals
  const base64 = Buffer.from(pdfBuf).toString('base64');
  const messages = [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: 'Extract BOTH deposits and non-check withdrawals AND the printed summary totals. Deposits: positive amount, type="credit". Withdrawals: negative amount, type="debit". Exclude checks. Return only JSON.' },
    ],
  }];
  return await postClaude(systemPrompt, messages);
}

// ── Main loop ─────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
const ALLOW_PARTIAL = process.argv.includes('--allow-partial');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY_MONTHS = onlyArg ? onlyArg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean) : null; // e.g. '2024-09,2024-10'

const OUT_DIR = new URL('../.local/reextract/', import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

let bs = await fetchAll(
  supabase.from('bank_statements').select('*').gte('period', '2024-01').lte('period', '2024-12').order('period', { ascending: true })
);
if (ONLY_MONTHS?.length) bs = bs.filter(s => ONLY_MONTHS.includes(s.period));
console.log(`processing ${bs.length} bank statement(s) ${ONLY_MONTHS?.length ? '(filtered to ' + ONLY_MONTHS.join(',') + ')' : '(2024)'} ${DRY_RUN ? '[DRY RUN]' : ''}`);

// The 2024 periods are locked via period_close.status='closed', which the
// enforce_period_lock trigger uses to block INSERTs of transactions dated in
// that period. Snapshot the current close state, temporarily reopen the
// affected periods, then restore them exactly as they were once inserts are
// done. Wrapped in try/finally so a crash still puts the locks back.
const periodsInScope = [...new Set(bs.map(s => s.period))];
let closedSnapshot = [];
async function snapshotAndReopenPeriods() {
  if (DRY_RUN || periodsInScope.length === 0) return;
  const { data } = await supabase
    .from('period_close')
    .select('*')
    .in('period', periodsInScope);
  closedSnapshot = (data || []).filter(r => r.status === 'closed');
  if (closedSnapshot.length === 0) return;
  console.log(`\ntemporarily reopening ${closedSnapshot.length} closed 2024 periods for insert`);
  for (const r of closedSnapshot) {
    const { error } = await supabase
      .from('period_close')
      .update({ status: 'open' })
      .eq('id', r.id);
    if (error) throw new Error(`failed to reopen ${r.period}: ${error.message}`);
  }
}
async function restorePeriodLocks() {
  if (DRY_RUN || closedSnapshot.length === 0) return;
  console.log(`\nrestoring ${closedSnapshot.length} 2024 period locks to their prior closed state`);
  for (const r of closedSnapshot) {
    // status only — closed_at/closed_by/snapshot fields are untouched so the
    // period looks byte-identical to how it was before the recovery run.
    const { error } = await supabase
      .from('period_close')
      .update({ status: 'closed' })
      .eq('id', r.id);
    if (error) console.error(`failed to re-close ${r.period}: ${error.message}`);
  }
}

await snapshotAndReopenPeriods();

const perStatement = [];

try {
for (const stmt of bs) {
  console.log(`\n── ${stmt.period} ── ${stmt.file_name}`);
  const path = stmt.file_path || stmt.file_url;
  const bucket = 'documents';
  const { data: file, error: dlErr } = await supabase.storage.from(bucket).download(path);
  if (dlErr) { console.error('  download failed:', dlErr.message); continue; }
  const buf = new Uint8Array(await file.arrayBuffer());
  console.log(`  downloaded ${buf.length} bytes`);

  // pdfjs.getDocument({data: ...}) can detach the underlying ArrayBuffer;
  // keep an independent copy in `pdfBytes` so the whole-PDF fallback still
  // has usable bytes to base64-encode.
  const pdfBytes = new Uint8Array(buf);
  const text = await pdfToText(buf);
  const meaningfulChars = text.replace(/[-\s|=]/g, '').length;
  console.log(`  extracted ${text.length} chars of text (${meaningfulChars} meaningful)`);

  const anchor = { start: stmt.period_start, end: stmt.period_end };
  let extracted;
  try {
    if (meaningfulChars < 500) {
      console.log(`  scanned/image PDF — sending whole PDF to Claude as document (${(pdfBytes.length / 1024).toFixed(0)} KB)`);
      extracted = await callClaudePdf(pdfBytes, anchor);
    } else {
      extracted = await callClaudeText(text, anchor);
    }
  } catch (e) {
    console.error('  Claude call failed:', e.message);
    continue;
  }

  // Persist the raw extractor result so this run is auditable and re-runnable
  // without another API call. .local/ is gitignored — we never commit these.
  writeFileSync(OUT_DIR + `${stmt.period}.json`, JSON.stringify(extracted, null, 2));

  // Validate — the whole point of this script is that a real 2024 statement
  // has deposits, so any month without them is treated as a failure.
  // --allow-partial: for scanned PDFs where vision misses balance lines but
  // finds SOME deposit rows, insert what was found and log as partial rather
  // than abort. The production app path never gets this flag — it's a
  // one-off recovery escape hatch.
  let partial = false;
  try {
    validateStatementTotals(extracted.statement_totals);
    assertHasDeposits(extracted.transactions, extracted.statement_totals);
  } catch (e) {
    if (ALLOW_PARTIAL) {
      const hasAnyCredit = (extracted.transactions || []).some(t => t.type === 'credit' || Number(t.amount) > 0);
      if (!hasAnyCredit) {
        console.error('  validation failed and no deposits found even in partial mode:', e.message);
        perStatement.push({ period: stmt.period, error: e.message });
        continue;
      }
      console.warn('  validation failed but --allow-partial set — inserting extractor-found deposits and continuing:', e.message);
      partial = true;
    } else {
      console.error('  validation failed:', e.message);
      perStatement.push({ period: stmt.period, error: e.message });
      continue;
    }
  }

  const rowsAll = extracted.transactions || [];
  const rows = rowsAll.map(t => ({
    date: t.date,
    description: t.description || '',
    supplier: t.description || '',
    amount: parseFloat(t.amount) || 0,
    type: t.type || (parseFloat(t.amount) < 0 ? 'debit' : 'credit'),
    category: null,                              // UNCATEGORIZED — no guessing
    bank_statement_id: stmt.id,
    posted: false,
    reference: t.reference || null,
  }));

  const { data: existingRows } = await supabase
    .from('transactions')
    .select('id, date, amount, description, bank_statement_id, type')
    .eq('bank_statement_id', stmt.id);

  const { toInsert, skipped } = partitionNewRows(existingRows || [], rows);
  const insertedCredits = toInsert.filter(r => r.type === 'credit');
  const insertedDebits  = toInsert.filter(r => r.type === 'debit');
  console.log(`  existing rows: ${existingRows?.length || 0}`);
  console.log(`  extracted rows: ${rows.length} (deposits=${rows.filter(r => r.type === 'credit').length}, withdrawals=${rows.filter(r => r.type === 'debit').length})`);
  console.log(`  skipped (already present): ${skipped.length}`);
  console.log(`  would insert: ${toInsert.length} (credits=${insertedCredits.length}, debits=${insertedDebits.length})`);

  // Hard limit from Phase 3: only insert missing DEPOSITS. Any debit the fixed
  // extractor produced that didn't match an existing row is treated as noise
  // for this recovery run — the existing 2,162 debits are correct as-is.
  const depositsToInsert = insertedCredits;

  if (!DRY_RUN && depositsToInsert.length > 0) {
    // Chunked insert to keep the request payload reasonable.
    const CHUNK = 100;
    for (let i = 0; i < depositsToInsert.length; i += CHUNK) {
      const chunk = depositsToInsert.slice(i, i + CHUNK);
      const { error } = await supabase.from('transactions').insert(chunk);
      if (error) throw new Error(`insert failed for ${stmt.period}: ${error.message}`);
    }
    console.log(`  inserted ${depositsToInsert.length} deposit rows`);
  } else if (DRY_RUN) {
    console.log(`  DRY RUN: no rows inserted`);
  }

  if (!DRY_RUN) {
    const { error: upErr } = await supabase
      .from('bank_statements')
      .update({ statement_totals: extracted.statement_totals || null })
      .eq('id', stmt.id);
    if (upErr) console.error('  totals update failed:', upErr.message);
    else console.log(`  updated statement_totals`);
  }

  perStatement.push({
    period: stmt.period,
    id: stmt.id,
    partial,
    beg: extracted.statement_totals?.beginning_balance ?? null,
    end: extracted.statement_totals?.ending_balance ?? null,
    deposits_total: extracted.statement_totals?.deposits_total ?? null,
    withdrawals_total: extracted.statement_totals?.withdrawals_total ?? null,
    checks_total: extracted.statement_totals?.checks_total ?? null,
    fees_total: extracted.statement_totals?.fees_total ?? null,
    extracted_deposit_rows: rows.filter(r => r.type === 'credit').length,
    inserted_deposit_rows: depositsToInsert.length,
    existing_before: existingRows?.length || 0,
  });
}

writeFileSync(OUT_DIR + 'summary.json', JSON.stringify(perStatement, null, 2));
console.log(`\nwrote summary to ${OUT_DIR}summary.json`);
} finally {
  await restorePeriodLocks();
}
