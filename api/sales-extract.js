export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration' });

  const { base64Data, mediaType } = req.body || {};
  if (!base64Data) return res.status(400).json({ error: 'base64Data is required' });

  const systemPrompt = `Extract daily sales data from a POS system report, receipt, screenshot, or CSV.
Return ONLY valid JSON (no markdown):
{
  "date": "YYYY-MM-DD",
  "total_sales": number,
  "food_sales": number,
  "liquor_sales": number,
  "beer_sales": number,
  "wine_sales": number,
  "other_sales": number,
  "notes": "brief note"
}
Rules: If category breakdown is unavailable set those to 0 and put total in total_sales. If multiple dates appear, use the primary/most recent. All numbers are non-negative. Omit $ signs.`;

  const isImage = mediaType?.startsWith('image/');
  const contentBlock = isImage
    ? { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } };

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: 'Extract the sales data. Return only JSON.' }] }],
    }),
  });

  if (!upstream.ok) {
    const rawBody = await upstream.text();
    console.error('[api/sales-extract] upstream error', upstream.status, rawBody);
    let message = `Upstream error: ${upstream.status}`;
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed?.error?.message) message = parsed.error.message;
      else if (typeof parsed?.error === 'string') message = parsed.error;
    } catch {
      if (rawBody) message = `Upstream error: ${upstream.status} — ${rawBody.slice(0, 500)}`;
    }
    return res.status(upstream.status).json({ error: message, upstreamStatus: upstream.status });
  }

  const data = await upstream.json();
  const raw = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

  try {
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return res.status(200).json(JSON.parse(clean));
  } catch {
    return res.status(500).json({ error: 'Failed to parse AI response' });
  }
}
