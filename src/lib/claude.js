const CLAUDE_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Send a document (PDF as base64 or image) to Claude for extraction
 */
async function callClaude(messages, systemPrompt) {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/**
 * Extract withdrawal transactions from a bank statement PDF
 */
export async function extractBankStatement(base64Pdf) {
  const systemPrompt = `You are a financial document parser. Extract ONLY withdrawal/debit transactions from this bank statement. Ignore all deposits, credits, and incoming payments.
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
Use negative numbers for the amounts. Only include withdrawals, payments, fees, and debits. Do NOT include any deposits or credits.`;

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
          text: 'Extract ONLY withdrawal/debit transactions from this bank statement. Ignore deposits and credits. Return only JSON.',
        },
      ],
    },
  ];

  const raw = await callClaude(messages, systemPrompt);
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(clean);
}

/**
 * Extract data from an invoice (PDF or image)
 */
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
  const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(clean);
}

/**
 * Smart categorization: given a transaction description and existing categories, suggest a category
 */
export async function suggestCategory(description, existingCategories) {
  const
