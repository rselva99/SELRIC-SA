async function callClaude(messages, systemPrompt) {
  const response = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, systemPrompt }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(`Claude API error: ${response.status} — ${err.error}`);
  }

  const data = await response.json();
  return data.text;
}

// Robustly extract a JSON object from Claude's response.
// Handles: residual markdown fences, preamble prose, trailing text.
// Throws with the raw response excerpt on failure so the error is debuggable.
function parseClaudeJson(raw) {
  // Strip any remaining markdown code fences (api/claude.js also strips these,
  // but be defensive in case the response passes through a different path)
  const stripped = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Extract the outermost JSON object — handles "Here is the JSON: {...} Hope that helps!"
  const match = stripped.match(/{[\s\S]*}/);
  if (!match) {
    throw new Error(`No JSON object found in Claude response. Got: ${stripped.slice(0, 300)}`);
  }

  try {
    return JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`JSON parse failed: ${err.message}. Response excerpt: ${stripped.slice(0, 400)}`);
  }
}

export async function extractBankStatement(base64Pdf) {
  const systemPrompt = `You are a financial document parser. Extract electronic withdrawal/debit transactions from this bank statement.

STRICT EXCLUSION RULES — do NOT include any of the following:
- Checks of any kind: paper checks, check payments, items listed under a "Checks" or "Checks Paid" section, entries with check numbers (e.g. "Check 1234", "Ck #5678", "CHK 0042", or any item whose description is just a number)
- Deposits, credits, or incoming payments of any kind

INCLUDE ONLY:
- Electronic debits: ACH payments, wire transfers, direct debits
- Card purchases and point-of-sale transactions
- Bank fees, service charges, interest charges
- Online bill payments (non-check)
- ATM withdrawals

Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "bank_name": "string",
  "account_number_last4": "string",
  "statement_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "opening_balance": number,
  "closing_balance": number,
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "string",
      "reference": "string or null",
      "amount": number,
      "type": "debit",
      "balance": number or null
    }
  ]
}
Use negative numbers for amounts. If you are unsure whether an item is a check, exclude it.`;

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64Pdf,
          },
        },
        {
          type: 'text',
          text: 'Extract only electronic withdrawal/debit transactions. Exclude ALL checks (any item in a Checks section, any check number, any paper check payment). Exclude all deposits and credits. Return only JSON.',
        },
      ],
    },
  ];

  const raw = await callClaude(messages, systemPrompt);
  return parseClaudeJson(raw);
}

// ── Text-based extraction (primary path for all bank statement PDFs) ─────────
//
// PDF.js extracts the text layer from a digital PDF in the browser.
// The resulting string is typically 20–100 KB — well under Vercel's 4.5 MB
// request body limit even for 9 MB PDFs. No base64, no images, no size issues.

// Optional `anchorPeriod = { start, end }` (YYYY-MM-DD) tells the model
// the statement's actual date range so entries without an explicit year
// (e.g. "12/05" rendered without "2024" in the source row) resolve to
// THIS period's year, not the model's default. See src/lib/statementPeriod.js
// for how the upload pipeline derives the anchor.
function anchorClause(anchorPeriod) {
  if (!anchorPeriod?.start || !anchorPeriod?.end) return '';
  return `\n\nSTATEMENT PERIOD ANCHOR — REQUIRED CONSTRAINT:\nThis statement covers ${anchorPeriod.start} to ${anchorPeriod.end}. Every transaction date MUST fall within or near this range. If a row's date is written without an explicit year (e.g. "12/05" or "Dec 5"), resolve it to the year(s) that place it inside this anchor — never to the current calendar year.\n`;
}

export async function extractBankStatementFromText(text, anchorPeriod = null) {
  const systemPrompt = `You are a financial document parser. The following is text extracted from a bank statement PDF. The text preserves the original line structure but column alignment may be imperfect.${anchorClause(anchorPeriod)}

STRICT EXCLUSION RULES — do NOT include:
- Checks of any kind: paper checks, check payments, items listed under a "Checks" or "Checks Paid" section, entries with check numbers (e.g. "Check 1234", "Ck #5678", "CHK 0042", or any description that is just a number)
- Deposits, credits, or incoming payments of any kind

INCLUDE ONLY:
- Electronic debits: ACH payments, wire transfers, direct debits
- Card purchases and point-of-sale transactions
- Bank fees, service charges, interest charges
- Online bill payments (non-check)
- ATM withdrawals

Parse the text carefully. Dates are typically in MM/DD/YYYY or similar formats. Amounts may appear in separate columns. Return ONLY valid JSON (no markdown, no backticks):
{
  "bank_name": "string",
  "account_number_last4": "string",
  "statement_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "opening_balance": number,
  "closing_balance": number,
  "statement_totals": {
    "withdrawals_total": number,
    "deposits_total": number,
    "withdrawal_count": number,
    "deposit_count": number,
    "beginning_balance": number,
    "ending_balance": number
  },
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "string",
      "reference": "string or null",
      "amount": number,
      "type": "debit",
      "balance": number or null
    }
  ]
}

statement_totals MUST come from the statement's own PRINTED SUMMARY section
(usually labelled "Account Summary", "Activity Summary", or similar), not
computed from the rows you extracted. withdrawals_total and deposits_total
are positive dollar amounts. If the summary doesn't print a value, use 0
for that field — never invent it.

Use negative numbers for transaction amounts (debits). If unsure whether
an item is a check, exclude it.`;

  const messages = [{
    role: 'user',
    content: `Extract only electronic withdrawal/debit transactions AND the statement's printed summary section from this bank statement text. Exclude ALL checks and deposits from the transactions list.\n\n${text}`,
  }];

  const raw = await callClaude(messages, systemPrompt);
  return parseClaudeJson(raw);
}

// ── Page-by-page extraction for large PDFs ────────────────────────────────
//
// Vercel Serverless Functions have a hard 4.5 MB request body limit that
// cannot be raised via config. A single base64-encoded PDF can easily exceed
// this (3.4 MB PDF → 4.5 MB base64). The fix: render the PDF to individual
// page images client-side, send each ~200 KB image as a separate request,
// then merge the results here.

function pageTxnSystem(anchorPeriod) {
  return `You are extracting withdrawal/debit transactions from a single page of a bank statement image.${anchorClause(anchorPeriod)}

STRICT EXCLUSION RULES:
- No checks of any kind (paper checks, check numbers, "Checks Paid" section entries)
- No deposits, credits, or incoming payments

INCLUDE ONLY electronic debits: ACH, wire transfers, card purchases, bank fees, ATM withdrawals.

Return ONLY valid JSON — no markdown:
{
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "string", "reference": "string or null", "amount": number, "type": "debit", "balance": number or null }
  ]
}
Use negative numbers for amounts. If unsure whether an item is a check, exclude it.
If this page contains no relevant transactions, return { "transactions": [] }.`;
}

function pageMetaSystem(anchorPeriod) {
  return `You are extracting bank account metadata and withdrawal/debit transactions from the first page of a bank statement image.${anchorClause(anchorPeriod)}

STRICT EXCLUSION RULES:
- No checks of any kind (paper checks, check numbers, "Checks Paid" section entries)
- No deposits, credits, or incoming payments

INCLUDE ONLY electronic debits: ACH, wire transfers, card purchases, bank fees, ATM withdrawals.

Return ONLY valid JSON — no markdown:
{
  "bank_name": "string",
  "account_number_last4": "string",
  "statement_period": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "opening_balance": number,
  "closing_balance": number,
  "statement_totals": {
    "withdrawals_total": number,
    "deposits_total": number,
    "withdrawal_count": number,
    "deposit_count": number,
    "beginning_balance": number,
    "ending_balance": number
  },
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "string", "reference": "string or null", "amount": number, "type": "debit", "balance": number or null }
  ]
}

statement_totals MUST come from the printed summary block on this image
(not summed from rows). Use 0 for fields the summary doesn't print.
Use negative numbers for transaction amounts.`;
}

async function extractPageImage(base64Jpeg, isFirstPage, anchorPeriod) {
  const systemPrompt = isFirstPage ? pageMetaSystem(anchorPeriod) : pageTxnSystem(anchorPeriod);
  const messages = [{
    role: 'user',
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Jpeg } },
      { type: 'text', text: 'Extract only electronic debit transactions. Exclude all checks and deposits. Return only JSON.' },
    ],
  }];
  const raw = await callClaude(messages, systemPrompt);
  return parseClaudeJson(raw);
}

/**
 * Process a PDF that has already been rendered to per-page JPEG images.
 * Each image is sent as a separate API call to stay under Vercel's 4.5 MB
 * body limit. Results are merged and duplicates are removed.
 *
 * @param {string[]} pageImages  base64 JPEG strings, one per page
 * @param {function} onProgress  optional callback(pageNum, total)
 */
export async function extractBankStatementFromImages(pageImages, onProgress, anchorPeriod = null) {
  if (!pageImages.length) throw new Error('No pages to process');

  let meta = {};
  const allTransactions = [];

  for (let i = 0; i < pageImages.length; i++) {
    if (onProgress) onProgress(i + 1, pageImages.length);
    const result = await extractPageImage(pageImages[i], i === 0, anchorPeriod);
    if (i === 0) meta = result; // capture bank_name, period, balances from page 1
    if (result.transactions?.length) allTransactions.push(...result.transactions);
  }

  // Deduplicate: same date + amount + description is likely the same transaction
  const seen = new Set();
  const unique = allTransactions.filter(t => {
    const key = `${t.date}|${t.amount}|${t.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ...meta, transactions: unique };
}

export async function extractInvoice(base64Data, mediaType) {
  const systemPrompt = `You are an invoice data extractor. Extract key information from this invoice.
Return ONLY valid JSON (no markdown, no backticks) in this exact format:
{
  "supplier_name": "string",
  "supplier_address": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD",
  "due_date": "YYYY-MM-DD or null",
  "payment_terms": "string or null",
  "currency": "string",
  "subtotal": number or null,
  "tax_amount": number or null,
  "total_amount": number,
  "line_items": [
    {
      "description": "string",
      "quantity": number or null,
      "unit_price": number or null,
      "amount": number
    }
  ],
  "notes": "string or null"
}`;

  const isImage = mediaType.startsWith('image/');
  const contentBlock = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } }
    : { type: 'document', source: { type: 'base64', media_type: mediaType, data: base64Data } };

  const messages = [
    {
      role: 'user',
      content: [
        contentBlock,
        { type: 'text', text: 'Extract all data from this invoice. Return only JSON.' },
      ],
    },
  ];

  const raw = await callClaude(messages, systemPrompt);
  return parseClaudeJson(raw);
}

export async function suggestCategory(description, existingCategories) {
  const systemPrompt = `You categorize business transactions for a college bar.
Given the transaction description and existing category list, return the single best matching category name.
If none fit well, suggest a new category name.
Return ONLY the category name as plain text, nothing else.`;

  const messages = [
    {
      role: 'user',
      content: `Transaction: "${description}"\n\nExisting categories:\n${existingCategories.join('\n')}\n\nReturn only the category name.`,
    },
  ];

  const result = await callClaude(messages, systemPrompt);
  return result.trim();
}

// ── AI-powered batch categorization ──────────────────────────────────────────
//
// Second-pass categorizer that runs after fuzzy matching.  Sends uncategorized
// transactions to Claude with known supplier→category examples as context, so
// it can understand that "Recurring Card Transaction Spotify USA 4899" is the
// same vendor as "Spotify" even when string matching fails.
//
// Returns [{id, category}] — only entries Claude can categorize confidently.

export async function batchCategorize(transactions, knownMappings) {
  if (!transactions.length) return [];

  const mappingsText = knownMappings.length
    ? knownMappings.slice(0, 80).map(m => `${m.supplier} → ${m.category}`).join('\n')
    : '(no historical data yet)';

  const txnsList = transactions
    .map(t => `ID: ${t.id}\nDesc: ${(t.description || t.supplier || '').slice(0, 180)}`)
    .join('\n---\n');

  const systemPrompt = `You are an expense categorizer for a college bar in St. Louis, MO.

Bank statement descriptions are messy — they include card types, location codes, reference numbers, and abbreviated names. Identify the real vendor and assign the correct category.

KNOWN VENDOR→CATEGORY MAPPINGS (historical data — treat as ground truth):
${mappingsText}

CATEGORY REFERENCE:
- Cost of Goods Sold (COGS): food/beverage/alcohol distributors (Sysco, US Foods, Southern Glazer's, Performance Food Group, PFG, Restaurant Depot)
- Salaries & Wages: payroll processors (ADP, Paychex, Gusto, Square Payroll)
- Bank Charges: bank fees, wire fees, ACH fees, overdraft charges, interest
- Utilities: electricity, gas, water, internet, phone (Ameren, Evergy, Laclede, Spectrum, AT&T, Verizon)
- Rent: rent, lease, real estate
- Insurance: any insurance premium
- Marketing & Advertising: Google Ads, Meta, Instagram, Facebook, promotional services
- Entertainment: music streaming/licensing (Spotify, Apple Music, BMI, ASCAP, SESAC)
- Licenses & Permits: permits, certifications, liquor license renewals
- Professional Fees: accounting, legal, consulting
- Repairs & Maintenance: repairs, plumbing, HVAC, cleaning, pest control, maintenance
- Transport & Delivery: delivery, Uber, DoorDash, FedEx, UPS, shipping

PATTERN EXAMPLES:
"Recurring Card Transaction Spotify USA 4899" → Entertainment
"ADP PAYROLL FEES CCD 123456" → Salaries & Wages
"AMEREN ILLINOIS 987654 WEB" → Utilities
"SYSCO FOOD SERV OF STL 0012 TX" → Cost of Goods Sold (COGS)
"SOUTHERN GLAZERS WINE 00123" → Cost of Goods Sold (COGS)

Return ONLY this JSON object — no markdown, no explanation:
{"suggestions": [{"id": "the-exact-uuid", "category": "exact_category_name"}]}

Only include transactions you can categorize with high confidence. Omit uncertain ones entirely.`;

  const messages = [{ role: 'user', content: `Categorize these transactions:\n\n${txnsList}` }];
  const raw   = await callClaude(messages, systemPrompt);
  const parsed = parseClaudeJson(raw);
  const suggestions = Array.isArray(parsed) ? parsed : (parsed.suggestions || []);
  return suggestions.filter(s => s.id && s.category && s.category !== 'Uncategorized');
}
