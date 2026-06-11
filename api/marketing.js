export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration' });

  const { prompt, assetDescriptions = [] } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  const assetsCtx = assetDescriptions.length
    ? `\n\nBrand assets available: ${assetDescriptions.join(' | ')}`
    : '';

  const systemPrompt = `You are a bold, creative marketing designer for "TheBar" — a college bar directly across from Saint Louis University (SLU) in St. Louis, MO. Target audience: SLU students aged 21+.

Generate TWO complete HTML marketing designs and return them as a single JSON object:
{
  "flyer_html": "...",
  "social_html": "..."
}

FLYER_HTML (8.5×11 printable):
- Complete <!DOCTYPE html> document
- <body style="width:850px;height:1100px;margin:0;padding:0;overflow:hidden;font-family:sans-serif">
- Bold college-bar energy, high contrast, eye-catching
- Must include: "TheBar" name, "Across from SLU" tagline, event details, date/time if given
- Use a <style> block with @import for Google Fonts (Bebas Neue, Anton, or similar bold display font)
- Prices, drink specials, dress code prominently if mentioned
- No external images — use CSS gradients, shapes, emoji, or styled text for visuals

SOCIAL_HTML (1080×1080 Instagram/Facebook):
- Complete <!DOCTYPE html> document
- <body style="width:1080px;height:1080px;margin:0;padding:0;overflow:hidden;font-family:sans-serif">
- Square format — fill the entire space, nothing cropped
- Bolder, more minimal than flyer — one strong visual statement
- Perfect for Instagram: high contrast, large text, vivid colors
- Same Google Fonts @import
- No external images — CSS only

Design style: Think college bar promo poster. Loud, fun, urgent. Big headline dominates. Secondary info below. Brand colors optional but pick something striking (neon, team colors, etc.). St. Louis context — Blues (blue/gold), Cardinals (red), SLU Billikens (navy/gold) are relevant.

Return ONLY valid JSON. No markdown, no explanation.`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Create marketing materials for: ${prompt}${assetsCtx}` }],
    }),
  });

  if (!upstream.ok) {
    const rawBody = await upstream.text();
    console.error('[api/marketing] upstream error', upstream.status, rawBody);
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
