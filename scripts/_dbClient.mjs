import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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
export const SUPABASE_URL = env.VITE_SUPABASE_URL;
export const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Stable pagination: caller-supplied `.order()` clauses (if any) act as PRIMARY
// sort; we append `.order('id', { ascending: true })` as the unique tiebreaker.
// See src/lib/fetchAll.js for the full rationale — this is the CLI mirror of
// that helper. Non-unique sort keys (date, created_at, category, amount, ...)
// re-order ties non-deterministically across `.range()` calls, silently
// duplicating some rows and dropping others by exactly the same count so the
// total looks fine while per-category / per-account subtotals are wrong.
// See ~/Documents/SELRIC-ALARM-NI-DRIFT.md (Jul 12 2026).
//
// Opt-out (opts.tiebreaker = false) is available for tables without an `id`
// column, but the caller MUST supply their own unique-key .order() first —
// otherwise the silent-corruption class this helper was written to close is
// re-opened.
export async function fetchAll(query, opts = {}) {
  const { tiebreaker = 'id', pageSize = 1000 } = opts;
  const stable = tiebreaker === false ? query : query.order(tiebreaker, { ascending: true });
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await stable.range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
  }
  return out;
}
