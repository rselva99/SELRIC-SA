// Runs the integrity checks (src/lib/checks/) for one workspace, prints a
// table, and saves the run to integrity_results.
//
//   npm run checks -- --org <uuid> [--period YYYY-MM] [--program business|ganaderia] [--no-save]
//
// Reads with the service-role key from .env (never printed). That key sees
// every workspace, so --org is required and every read filters on it.
// When integrity_results does not exist yet (the migration has not been
// applied) the checks still run and print, nothing is saved, and the run says
// which file to apply — that alone is not a failure. Exit 1 when any check is
// red, 2 on a usage or connection error.
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { runChecks, healthScore } from '../src/lib/checks/index.js';
import { fetchBusinessData, fetchHerdData } from '../src/lib/checks/fetch.js';
import { saveResults, MIGRATION_FILE } from '../src/lib/checks/store.js';
import { translations } from '../src/i18n/translations.js';

const ROOT = new URL('..', import.meta.url).pathname;
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const fail = (msg) => { console.error(`checks: ${msg}`); process.exit(2); };

const env = {};
if (existsSync(`${ROOT}.env`)) for (const line of readFileSync(`${ROOT}.env`, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
const URL_ = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

const orgId = arg('--org');
const period = arg('--period') || 'all';
const program = arg('--program') || 'business';
const save = !process.argv.includes('--no-save');
if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) fail('--org <workspace uuid> is required');
if (period !== 'all' && !/^\d{4}-\d{2}$/.test(period)) fail('--period must be YYYY-MM');
if (!['business', 'ganaderia'].includes(program)) fail(`unknown --program ${program}`);
if (!URL_ || !KEY) fail('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env');

const client = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: org, error: orgErr } = await client.from('organizations').select('id, name').eq('id', orgId).maybeSingle();
if (orgErr) fail(`could not read the workspace: ${orgErr.message}`);
if (!org) fail(`no workspace ${orgId}`);

const today = new Date().toISOString().slice(0, 10);
const data = program === 'ganaderia' ? await fetchHerdData(client, orgId) : await fetchBusinessData(client, orgId);
const results = runChecks(data, { program, period, today });

const names = translations.en.checks.items;
const money = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mark = { green: '✓', amber: '!', red: '✗' };
console.log(`checks · ${org.name} · ${program} · period ${period} · ${today}`);
console.log(`${'status'.padEnd(8)} ${'check'.padEnd(27)} ${'count'.padStart(6)} ${'amount'.padStart(14)}  name`);
for (const r of results) {
  const st = r.detail?.skipped ? '- skip' : `${mark[r.status]} ${r.status}`;
  console.log(`${st.padEnd(8)} ${r.key.padEnd(27)} ${String(r.count).padStart(6)} ${(program === 'ganaderia' ? '' : money(r.amount)).padStart(14)}  ${names[r.key]?.name || ''}${r.detail?.skipped ? ` (${r.detail.skipped})` : ''}${r.detail?.error ? ` — error: ${r.detail.error}` : ''}`);
}
const h = healthScore(results);
console.log(`health ${h.score == null ? 'n/a' : h.score} · ${h.green} green · ${h.amber} amber · ${h.red} red · ${h.skipped} with nothing to check`);

if (save) {
  const s = await saveResults(client, { orgId, period, results }).catch((e) => ({ error: e }));
  if (s.error) fail(`saving failed: ${s.error.message || s.error}`);
  if (s.missing) console.log(`results not saved: run migration ${MIGRATION_FILE} (integrity_results does not exist yet)`);
  else console.log(`saved ${s.saved} results to integrity_results (run_at ${s.runAt})`);
} else {
  console.log('results not saved (--no-save)');
}
process.exit(h.red > 0 ? 1 : 0);
