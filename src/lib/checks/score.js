// Turning check results into one health score. Its own module so the pages
// that only show a score (the dashboard tile, the CEO roll-up) do not load
// every check; ./index.js re-exports all three.

// Green counts 1, amber ½, red 0, averaged over the checks that had
// something to check. Nothing checked at all is "no score", not 100.
export function healthScore(results) {
  const counted = (results || []).filter((r) => !r.detail?.skipped);
  const tally = { green: 0, amber: 0, red: 0 };
  for (const r of counted) tally[r.status] = (tally[r.status] || 0) + 1;
  const score = counted.length ? Math.round((100 * (tally.green + tally.amber / 2)) / counted.length) : null;
  return { score, ...tally, skipped: (results || []).length - counted.length, total: (results || []).length };
}

// The newest result per check out of a list of stored rows (any order).
export function latestByCheck(rows) {
  const by = new Map();
  for (const r of rows || []) {
    const cur = by.get(r.check_key);
    if (!cur || String(r.run_at) > String(cur.run_at)) by.set(r.check_key, r);
  }
  return by;
}

// One workspace's last run as ceo_overview() returns it — the newest row per
// check, [{ key, status, skipped, run_at }] — scored like a fresh run, with
// the time of the newest row. Not a list (the overview predates the checks)
// → null; an empty list → no score and no run time ("no run yet").
export function healthOfStored(rows) {
  if (!Array.isArray(rows)) return null;
  const h = healthScore(rows.map((r) => ({ status: r.status, detail: r.skipped ? { skipped: true } : {} })));
  const runAt = rows.reduce((m, r) => (r.run_at && String(r.run_at) > String(m || '') ? r.run_at : m), null);
  return { ...h, runAt };
}
