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
    const err = await upstream.text();
    return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` });
  }

  const data = await upstream.json();
  const text = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  return res.status(200).json({ text });
}
