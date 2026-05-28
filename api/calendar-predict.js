export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Server misconfiguration' });

  const { name, event_type, date, description = '' } = req.body || {};
  if (!name || !date) return res.status(400).json({ error: 'name and date are required' });

  const dayOfWeek = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const monthName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' });

  const systemPrompt = `You predict crowd levels for "TheBar" — a college bar directly across from Saint Louis University (SLU) in St. Louis, MO. Primary patrons are SLU students (21+). The bar is on the main strip near campus.

Return ONLY this JSON object — no markdown, no explanation:
{ "color_label": "dark_red|orange|green|yellow|blue|gray", "reason": "one concise sentence" }

Color scale (pick the best fit):
- dark_red = PACKED / standing room only: SLU home basketball games, March Madness, Halloween, St. Patrick's Day, Mardi Gras, New Year's Eve, SLU homecoming Saturday, NCAA tournament
- orange = VERY BUSY / near capacity: Blues or Cardinals home games, SLU homecoming events, big Greek formals/crush parties, Super Bowl, major rivalry games on TV, Cinco de Mayo
- green = BUSY / above average: regular Fri or Sat night, sports games on TV (non-marquee), live music night, themed bar specials on a weekday
- yellow = NORMAL / average crowd: typical weeknight bar special (Tue–Thu), minor sporting events, Happy Hour promos
- blue = SLOW / below average: SLU finals week (late April–early May, mid-December), Thanksgiving break, winter break, summer weekday afternoons
- gray = CLOSED / private: private event, holiday the bar is closed, zero public attendance

Key rules:
- Fri/Sat baseline = green minimum
- SLU home basketball (Nov–Mar) = dark_red
- Finals week overrides almost everything = blue (unless it's Halloween etc.)
- Day of week matters a lot — same event on Sat vs Mon is very different
- Summer (June–Aug) weekdays skew blue unless there's a Cardinals/Blues game`;

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Event: "${name}" | Type: ${event_type} | Date: ${date} (${dayOfWeek}, ${monthName})${description ? ` | Notes: ${description}` : ''}`,
      }],
    }),
  });

  if (!upstream.ok) return res.status(upstream.status).json({ error: `Upstream error: ${upstream.status}` });

  const data = await upstream.json();
  const raw = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

  try {
    const clean = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return res.status(200).json(JSON.parse(clean));
  } catch {
    return res.status(200).json({ color_label: 'green', reason: 'Default prediction' });
  }
}
