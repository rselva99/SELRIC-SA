// ─── STEP 1b — RE-EXTRACT SCANNED 2024 STATEMENTS (Oct + Dec) ───────────────
//
// Step 1 recovered 424 deposits for 2024 but two months came back partial:
// October (3 rows, 4.6% of the Revenue JE) and December (13 rows, 54.2%).
// Both statements are scanned image PDFs with zero text layer; Step 1's fix
// sent the full multi-page PDF to Claude's vision-mode document block in one
// shot and the model missed the majority of the deposit lines at that scale.
//
// This script:
//   1. Downloads each PDF from the `documents` Supabase Storage bucket.
//   2. Renders every page to a high-DPI JPEG using pdfjs-dist + @napi-rs/canvas
//      via a proper canvasFactory (the naive `page.render({canvasContext})`
//      path from Step 1's script threw "Cannot transfer object of unsupported
//      type." because pdfjs v5 needs the factory to allocate its own canvases).
//   3. Sends each page image to Claude as a separate `type:"image"` message.
//      Page 1 gets a meta prompt (asks for statement_totals + transactions);
//      subsequent pages get a txn-only prompt. Results merge into the same
//      shape as the digital-text path.
//   4. Applies MULTIPLICITY-AWARE dedupe (per Step 1b's spec):
//        count of (date, amount, description) in the statement
//        − count of (date, amount, description) already in DB
//        = how many rows to insert.
//      This preserves the 15 legitimate same-day duplicate pairs already in
//      the DB (Apple $2.99 twice/day, an ATM withdrawal + its $3 fee twice
//      the same day, two identical Rackco charges, etc.) — the abandoned
//      unique-index would have wrongly collapsed them.
//   5. Updates bank_statements.statement_totals with the printed summary block.
//
// Idempotent. Only touches Oct + Dec. Does not modify or delete anything else.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { supabase, fetchAll } from './_dbClient.mjs';
import { validateStatementTotals, assertHasDeposits } from '../src/lib/statementValidation.js';

const require = createRequire(import.meta.url);
const pdfjs   = await import('pdfjs-dist/legacy/build/pdf.mjs');
pdfjs.GlobalWorkerOptions.workerSrc = 'file://' + require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
const napiCanvas = await import('@napi-rs/canvas');

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

const DRY_RUN = process.argv.includes('--dry-run');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY_MONTHS = onlyArg
  ? onlyArg.slice('--only='.length).split(',').map(s => s.trim()).filter(Boolean)
  : ['2024-10', '2024-12'];

const OUT_DIR = new URL('../.local/reextract-scanned/', import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

// ── pdfjs canvas factory (Node) ───────────────────────────────────────────
class NodeCanvasFactory {
  create(width, height) {
    const canvas = napiCanvas.createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

// scale 2.5 on 612x792 pt pages → 1530x1980 px ≈ 200 DPI, ~450–550 KB JPEG.
// High enough that Claude vision can enumerate the deposit table exhaustively;
// low enough that each request stays well under Anthropic's 5 MB per-image cap.
async function renderPagesToJpegs(buf, scale = 2.5) {
  const factory = new NodeCanvasFactory();
  const pdf = await pdfjs.getDocument({
    data: buf,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    canvasFactory: factory,
  }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const cc = factory.create(Math.floor(viewport.width), Math.floor(viewport.height));
    await page.render({ canvasContext: cc.context, viewport, canvasFactory: factory }).promise;
    const jpeg = cc.canvas.toBuffer('image/jpeg', 82);
    out.push(jpeg.toString('base64'));
    factory.destroy(cc);
    page.cleanup();
  }
  await pdf.destroy();
  return out;
}

// ── Anthropic per-page prompts ────────────────────────────────────────────
function anchorClause(a) {
  if (!a?.start || !a?.end) return '';
  return `\n\nSTATEMENT PERIOD ANCHOR: this statement covers ${a.start} to ${a.end}. Every transaction date MUST fall within or near this range.\n`;
}

function firstPagePrompt(anchor) {
  return `You are extracting bank metadata, statement totals, and transactions (deposits AND non-check withdrawals) from PAGE 1 of a bank statement image.${anchorClause(anchor)}

INCLUDE (as transactions):
- Deposits & Credits: merchant/processor deposits (SpotOn, Square, Stripe, Toast), teller cash deposits ("Deposit - Thank You"), refunds, ACH credits, wire receipts, card credits.
- Non-check withdrawals: ACH, wires, card purchases, POS, bank fees, service charges, ATM withdrawals.

EXCLUDE from transactions:
- Any check (paper checks, check numbers, "Checks Paid" section entries). Their total goes in statement_totals.checks_total.

SIGN CONVENTION — REQUIRED:
- Deposits: POSITIVE amount, "type":"credit"
- Withdrawals: NEGATIVE amount, "type":"debit"

IMPORTANT — banks legitimately post the SAME amount to the SAME description on the SAME day more than once (an Apple.com $2.99 charge twice a day, an ATM withdrawal and its $3 fee twice the same day, two Rackco charges). When you see repeats, INCLUDE EACH ONE as a separate row. Never collapse repeats.

Return ONLY valid JSON (no markdown, no backticks):
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

statement_totals MUST come from the printed summary block on this image. *_total fields are POSITIVE dollar amounts. Regions summaries print separate lines for "Returned Checks" (goes in returned_checks_total, positive) and "Automatic Transfers". CRITICAL: a trailing hyphen on a Regions balance ("$9,813.61 -") means NEGATIVE (overdrawn) — report ending_balance as −9813.61 in that case. Use 0 for fields the summary doesn't print.`;
}

function laterPagePrompt(anchor) {
  return `You are extracting deposits and non-check withdrawals from a single page of a bank statement image.${anchorClause(anchor)}

INCLUDE:
- Deposits & Credits: merchant/processor deposits, teller cash deposits, refunds, ACH credits, wire receipts, card credits.
- Non-check withdrawals: ACH, wires, card purchases, POS, bank fees, service charges, ATM withdrawals.

EXCLUDE: any check (paper checks, check numbers, "Checks Paid" entries).

SIGN CONVENTION: deposits POSITIVE amount type="credit"; withdrawals NEGATIVE amount type="debit".

IMPORTANT — same-day, same-amount, same-description REPEATS are real. Include each row separately; never collapse repeats.

ENUMERATE EXHAUSTIVELY: walk down every row visible on this page. Do not skip small amounts, do not summarize. If the page shows 40 rows, return 40 rows.

Return ONLY valid JSON — no markdown:
{ "transactions": [ { "date": "YYYY-MM-DD", "description": "string", "reference": "string or null", "amount": number, "type": "credit or debit", "balance": number or null } ] }
If the page has none of the above, return { "transactions": [] }.`;
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

async function extractPagesSequentially(pageImages, anchor) {
  let meta = {};
  const allTxns = [];
  for (let i = 0; i < pageImages.length; i++) {
    const isFirst = i === 0;
    const systemPrompt = isFirst ? firstPagePrompt(anchor) : laterPagePrompt(anchor);
    const messages = [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: pageImages[i] } },
        { type: 'text', text: isFirst
            ? 'Extract the printed summary block AND every deposit + non-check withdrawal from THIS page. Return only JSON.'
            : 'Enumerate every deposit and non-check withdrawal on THIS page — do not skip anything. Return only JSON.' },
      ],
    }];
    console.log(`    page ${i + 1}/${pageImages.length}: calling Claude`);
    const parsed = await postClaude(systemPrompt, messages);
    if (isFirst) meta = { ...parsed };
    const rows = parsed.transactions || [];
    console.log(`      page ${i + 1}: ${rows.length} rows (${rows.filter(t => t.type === 'credit').length} deposits, ${rows.filter(t => t.type === 'debit').length} withdrawals)`);
    allTxns.push(...rows);
  }
  // NOTE: no cross-page dedupe by (date, amount, desc). Multi-page statements
  // never re-print the same row on two pages — Regions splits by section, not
  // by pagination — so identical rows across pages are actual bank repeats.
  return { ...meta, transactions: allTxns };
}

// ── Multiplicity-aware dedupe ─────────────────────────────────────────────
// Match on COUNT per (date, amount_cents, normalized_description). Insert the
// DIFFERENCE between what the statement shows and what the DB already has —
// so legitimate same-day repeats (15 pairs in the existing 2024 data) survive.
function amountCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
function normDescription(d) {
  return String(d || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function txKey(row) {
  return `${row.date}|${amountCents(row.amount)}|${normDescription(row.description)}`;
}
function partitionByMultiplicity(existingRows, incoming) {
  const dbCounts = new Map();
  for (const r of existingRows || []) {
    const k = txKey(r);
    dbCounts.set(k, (dbCounts.get(k) || 0) + 1);
  }
  const stmtCounts = new Map();
  const stmtRowsByKey = new Map();
  for (const r of incoming || []) {
    const k = txKey(r);
    stmtCounts.set(k, (stmtCounts.get(k) || 0) + 1);
    if (!stmtRowsByKey.has(k)) stmtRowsByKey.set(k, []);
    stmtRowsByKey.get(k).push(r);
  }
  const toInsert = [];
  const alreadyPresent = [];
  for (const [k, stmtCount] of stmtCounts.entries()) {
    const dbCount = dbCounts.get(k) || 0;
    const gap = stmtCount - dbCount;
    const rows = stmtRowsByKey.get(k);
    if (gap <= 0) {
      alreadyPresent.push(...rows);
    } else {
      alreadyPresent.push(...rows.slice(0, dbCount));
      toInsert.push(...rows.slice(dbCount));
    }
  }
  return { toInsert, alreadyPresent };
}

// ── Period-lock reopen/restore (identical to Step 1) ─────────────────────
const periodsInScope = [...new Set(ONLY_MONTHS)];
let closedSnapshot = [];
async function snapshotAndReopenPeriods() {
  if (DRY_RUN || periodsInScope.length === 0) return;
  const { data } = await supabase.from('period_close').select('*').in('period', periodsInScope);
  closedSnapshot = (data || []).filter(r => r.status === 'closed');
  if (closedSnapshot.length === 0) return;
  console.log(`\ntemporarily reopening ${closedSnapshot.length} closed periods for insert`);
  for (const r of closedSnapshot) {
    const { error } = await supabase.from('period_close').update({ status: 'open' }).eq('id', r.id);
    if (error) throw new Error(`failed to reopen ${r.period}: ${error.message}`);
  }
}
async function restorePeriodLocks() {
  if (DRY_RUN || closedSnapshot.length === 0) return;
  console.log(`\nrestoring ${closedSnapshot.length} period locks to their prior closed state`);
  for (const r of closedSnapshot) {
    const { error } = await supabase.from('period_close').update({ status: 'closed' }).eq('id', r.id);
    if (error) console.error(`failed to re-close ${r.period}: ${error.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
let bs = await fetchAll(
  supabase.from('bank_statements').select('*').in('period', ONLY_MONTHS).order('period', { ascending: true })
);
console.log(`processing ${bs.length} bank statement(s): ${ONLY_MONTHS.join(', ')} ${DRY_RUN ? '[DRY RUN]' : ''}`);

const perStatement = [];

await snapshotAndReopenPeriods();
try {
for (const stmt of bs) {
  console.log(`\n── ${stmt.period} ── ${stmt.file_name}`);
  const path = stmt.file_path || stmt.file_url;
  const { data: file, error: dlErr } = await supabase.storage.from('documents').download(path);
  if (dlErr) { console.error('  download failed:', dlErr.message); continue; }
  const buf = new Uint8Array(await file.arrayBuffer());
  console.log(`  downloaded ${buf.length} bytes`);

  console.log(`  rendering pages to high-DPI JPEGs (scale 2.5, ≈200 DPI)`);
  let pageImages;
  try {
    pageImages = await renderPagesToJpegs(buf);
  } catch (e) {
    console.error(`  render failed: ${e.message}`);
    perStatement.push({ period: stmt.period, error: 'render: ' + e.message });
    continue;
  }
  console.log(`  rendered ${pageImages.length} page images (${pageImages.map(p => Math.round(p.length * 0.75 / 1024) + 'KB').join(', ')})`);

  const anchor = { start: stmt.period_start, end: stmt.period_end };
  let extracted;
  try {
    extracted = await extractPagesSequentially(pageImages, anchor);
  } catch (e) {
    console.error(`  extraction failed: ${e.message}`);
    perStatement.push({ period: stmt.period, error: 'extract: ' + e.message });
    continue;
  }

  writeFileSync(OUT_DIR + `${stmt.period}.json`, JSON.stringify(extracted, null, 2));

  const totals = extracted.statement_totals || {};
  let reconciled = false;
  let reconcileErr = null;
  try {
    validateStatementTotals(totals);
    assertHasDeposits(extracted.transactions, totals);
    reconciled = true;
  } catch (e) {
    reconcileErr = e.message;
    console.warn(`  reconciliation NOT achieved: ${e.message}`);
  }

  const rowsAll = (extracted.transactions || []).map(t => ({
    date: t.date,
    description: t.description || '',
    supplier: t.description || '',
    amount: parseFloat(t.amount) || 0,
    type: t.type || (parseFloat(t.amount) < 0 ? 'debit' : 'credit'),
    category: null,                                // UNCATEGORIZED
    bank_statement_id: stmt.id,
    posted: false,
    reference: t.reference || null,
  }));
  const depositsAll = rowsAll.filter(r => r.type === 'credit');
  const withdrawalsAll = rowsAll.filter(r => r.type === 'debit');

  const { data: existingRows } = await supabase
    .from('transactions')
    .select('id, date, amount, description, bank_statement_id, type')
    .eq('bank_statement_id', stmt.id);

  const { toInsert: depositsToInsert, alreadyPresent: depositsPresent } =
    partitionByMultiplicity(existingRows || [], depositsAll);

  console.log(`  existing rows for this statement: ${existingRows?.length || 0}`);
  console.log(`  extracted: ${rowsAll.length} rows (deposits=${depositsAll.length}, withdrawals=${withdrawalsAll.length})`);
  console.log(`  multiplicity-dedupe result:`);
  console.log(`    deposits already present (matched by count): ${depositsPresent.length}`);
  console.log(`    deposits to insert (statement count − DB count): ${depositsToInsert.length}`);

  if (!DRY_RUN && depositsToInsert.length > 0) {
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

  if (!DRY_RUN && totals && (totals.beginning_balance || totals.ending_balance || totals.deposits_total)) {
    const { error: upErr } = await supabase
      .from('bank_statements')
      .update({ statement_totals: totals })
      .eq('id', stmt.id);
    if (upErr) console.error('  totals update failed:', upErr.message);
    else console.log(`  updated statement_totals`);
  }

  perStatement.push({
    period: stmt.period,
    id: stmt.id,
    reconciled,
    reconcileErr,
    beg: totals.beginning_balance ?? null,
    end: totals.ending_balance ?? null,
    deposits_total: totals.deposits_total ?? null,
    withdrawals_total: totals.withdrawals_total ?? null,
    checks_total: totals.checks_total ?? null,
    fees_total: totals.fees_total ?? null,
    extracted_deposit_rows: depositsAll.length,
    inserted_deposit_rows: depositsToInsert.length,
    existing_before: existingRows?.length || 0,
  });
}

writeFileSync(OUT_DIR + 'summary.json', JSON.stringify(perStatement, null, 2));
console.log(`\nwrote summary to ${OUT_DIR}summary.json`);
} finally {
  await restorePeriodLocks();
}
