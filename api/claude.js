export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: missing API key' });
  }

  const { messages, systemPrompt } = req.body || {};
  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: 'messages and systemPrompt are required' });
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      system: systemPrompt,
      messages,
    }),
  });

  if (!upstream.ok) {
    // Surface the real Anthropic 400 message instead of swallowing it.
    // The API returns JSON of the form
    //   {"type":"error","error":{"type":"invalid_request_error","message":"..."}}
    // so we forward error.message when we can parse it, fall back to raw
    // body text otherwise, and always log the full body server-side so
    // Vercel logs capture the exact reason for next time.
    const rawBody = await upstream.text();
    console.error('[api/claude] upstream error', upstream.status, rawBody);
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
  const raw = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  // Strip markdown code fences at the API layer so every client gets clean text
  // regardless of whether Claude ignored the "no backticks" instruction.
  const text = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  return res.status(200).json({ text });
}
