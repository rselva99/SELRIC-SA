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
