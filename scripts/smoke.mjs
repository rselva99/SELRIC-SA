// Smoke test: the app, signed in, at desktop and phone width.
//
//   node scripts/smoke.mjs                 # builds dist if missing, serves it with vite preview
//   node scripts/smoke.mjs --url <base>    # test a running server instead (no build, no preview)
//
// Two test accounts, from .env (never printed):
//   SMOKE_CEO_EMAIL / SMOKE_CEO_PASSWORD   a platform admin → the /ceo tabs and the Documents sub-tabs
//   SMOKE_GAN_EMAIL / SMOKE_GAN_PASSWORD   a Ganadería test workspace → the herd pages
// and two mocked Business workspaces, served from tests/fixtures (no account,
// no request reaches the real database — every Supabase call is answered by
// tests/fixtures/mock-supabase.js inside the browser context):
//   BIZ    the synthetic restaurant, twelve months of books, one planted problem per check
//   BIZ0   a brand-new Business workspace with nothing in it
// plus the public pages, signed out. Every view is opened at 1366 and 390 px
// and must have no console or page error, no failed request, SVG marks in every
// chart, no horizontal overflow, and (mocked views) no write. Screenshots and
// the full report go to .smoke/ (gitignored); the console report is 20 lines at
// most. Exit 1 on any failure, including missing credentials — a skipped
// account is a failed check.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { makeBusiness } from '../tests/fixtures/synthetic-business.js';
import { mockSupabase, fakeSession } from '../tests/fixtures/mock-supabase.js';
import { runChecks } from '../src/lib/checks/index.js';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}.smoke`;
const WIDTHS = [[1366, 900], [390, 844]];
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

// .env, read without printing anything.
const env = {};
if (existsSync(`${ROOT}.env`)) for (const line of readFileSync(`${ROOT}.env`, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
const cred = (who) => ({ email: process.env[`SMOKE_${who}_EMAIL`] || env[`SMOKE_${who}_EMAIL`], password: process.env[`SMOKE_${who}_PASSWORD`] || env[`SMOKE_${who}_PASSWORD`] });
const SUPA = (process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');

// The mocked Business workspaces. The synthetic restaurant's last check run
// is computed here, the way "Run checks now" would, and served as stored rows.
const TODAY = new Date().toISOString().slice(0, 10);
function mockedWorkspace(who) {
  if (who === 'BIZ') {
    const b = makeBusiness({ today: TODAY, issues: true });
    const runAt = `${TODAY}T06:00:00.000Z`;
    const integrity_results = runChecks(b.data, { today: TODAY, program: 'business' })
      .map((r, i) => ({ id: `ir-${i}`, org_id: b.org.id, check_key: r.key, period: 'all', status: r.status, amount: r.amount, count: r.count, detail: r.detail, run_at: runAt }));
    return { ...b, tables: { ...b.tables, integrity_results, integrity_checks: [] } };
  }
  const b = makeBusiness({ today: TODAY, months: 1, name: 'New Bistro (synthetic)' });
  const keep = ['organizations', 'profiles', 'org_programs', 'categories'];
  return { ...b, tables: { ...Object.fromEntries(keep.map((k) => [k, b.tables[k]])), integrity_results: [], integrity_checks: [] } };
}
const MOCKED = new Set(['BIZ', 'BIZ0']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS', 'access-control-expose-headers': 'content-range, content-profile' };

// A browser context whose Supabase is the mock: the session sits in
// localStorage where supabase-js looks for it, the accountant PIN gate is
// already passed for the tab, and every request to the project is answered
// from the fixture. Writes are counted, never applied.
async function mockedContext(browser, who, viewport) {
  const w = mockedWorkspace(who);
  const session = fakeSession(w.user);
  const handle = mockSupabase({ tables: w.tables, user: w.user, session, rpc: { is_platform_admin: false, get_signup_mode: 'invite', statement_totals: [] } });
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'en-US' });
  const key = `sb-${new URL(SUPA).hostname.split('.')[0]}-auth-token`;
  await ctx.addInitScript(({ key, session }) => {
    try { localStorage.setItem(key, JSON.stringify(session)); localStorage.setItem('selric.lang', 'en'); sessionStorage.setItem('selric.accountant-pin-ok', '1'); } catch { /* storage off */ }
  }, { key, session });
  await ctx.route(`${SUPA}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const res = handle({ method: req.method(), url: req.url(), headers: req.headers(), body: req.postData() });
    return route.fulfill({ status: res.status, headers: { ...CORS, ...res.headers }, body: res.body });
  });
  return { ctx, writes: handle.writes };
}

// Views: [account, path, label, optional sub-tab button text]
const VIEWS = [
  [null, '/', 'public /'],
  [null, '/login', 'public /login'],
  ['CEO', '/ceo', '/ceo'],
  ['CEO', '/ceo/pilots', '/ceo/pilots'],
  ['CEO', '/ceo/funnel', '/ceo/funnel'],
  ['CEO', '/ceo/research', '/ceo/research'],
  ['CEO', '/ceo/competition', '/ceo/competition'],
  ['CEO', '/ceo/model', '/ceo/model'],
  ['CEO', '/ceo/documents', '/ceo/documents · plan'],
  ['CEO', '/ceo/documents', '/ceo/documents · market', 'Market Analysis & GTM'],
  ['CEO', '/ceo/documents', '/ceo/documents · model', 'Financial Model'],
  ['CEO', '/ceo/documents', '/ceo/documents · findings', 'Findings & milestones'],
  ['CEO', '/ceo/plan', '/ceo/plan'],
  ['GAN', '/ganaderia', '/ganaderia'],
  ['GAN', '/ganaderia/animales', '/ganaderia/animales'],
  ['GAN', '/ganaderia/animales/:first', '/ganaderia/animales/:slug'],
  ['GAN', '/ganaderia/eventos', '/ganaderia/eventos'],
  ['GAN', '/ganaderia/lotes', '/ganaderia/lotes'],
  ['GAN', '/ganaderia/informes', '/ganaderia/informes'],
  ['BIZ', '/dashboard', 'biz /dashboard'],
  ['BIZ', '/checks', 'biz /checks'],
  ['BIZ0', '/checks', 'biz new /checks'],
];

async function serve() {
  const url = arg('--url');
  if (url) return { base: url.replace(/\/+$/, ''), stop: () => {} };
  if (!existsSync(`${ROOT}dist/index.html`)) {
    const b = spawn('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'ignore' });
    if (await new Promise((r) => b.on('exit', r))) throw new Error('vite build failed');
  }
  const port = 4173;
  const p = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore', detached: true });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) return { base, stop: () => { try { process.kill(-p.pid); } catch { /* gone */ } } }; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  try { process.kill(-p.pid); } catch { /* gone */ }
  throw new Error(`vite preview did not answer on ${base}`);
}

// Wait until spinners are gone and the DOM has been still for a moment.
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('.animate-spin'), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function signIn(page, base, c) {
  await page.goto(`${base}/login`);
  await page.fill('input[type="email"]', c.email);
  await page.fill('input[type="password"]', c.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  await settle(page);
}

// What one view must satisfy, measured in the page.
const measure = () => {
  const marks = '.recharts-curve, .recharts-area-area, .recharts-bar-rectangle, .recharts-rectangle, .recharts-dot, .recharts-sector';
  const charts = [...document.querySelectorAll('.recharts-wrapper')];
  const empty = charts.filter((w) => w.offsetWidth < 40 || !w.querySelector(marks)).length;
  const de = document.scrollingElement || document.documentElement;
  const main = document.querySelector('main');
  const overflow = de.scrollWidth > window.innerWidth + 1 || (main && main.scrollWidth > main.clientWidth + 1);
  return { charts: charts.length, empty, overflow, title: document.title };
};

async function run() {
  mkdirSync(OUT, { recursive: true });
  const server = await serve();
  // Playwright's own Chromium does not run on macOS 13; drive the installed Chrome.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = [];
  try {
    for (const [w, h] of WIDTHS) {
      const contexts = {};
      for (const view of VIEWS) {
        const [who, path, label, subTab] = view;
        const r = { label, width: w, ok: true, problems: [], charts: 0 };
        results.push(r);
        const mocked = MOCKED.has(who);
        const c = who && !mocked ? cred(who) : null;
        if (c && (!c.email || !c.password)) { r.ok = false; r.problems.push(`no credentials (SMOKE_${who}_EMAIL / _PASSWORD)`); continue; }
        if (mocked && !SUPA) { r.ok = false; r.problems.push('no VITE_SUPABASE_URL to mock'); continue; }
        const key = who || 'public';
        if (!contexts[key]) {
          const m = mocked ? await mockedContext(browser, who, { width: w, height: h }) : null;
          const ctx = m ? m.ctx : await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
          const page = await ctx.newPage();
          const log = [];
          page.on('console', (msg) => { if (msg.type() === 'error') log.push(msg.text().slice(0, 160)); });
          page.on('pageerror', (e) => log.push(`pageerror: ${String(e.message).slice(0, 160)}`));
          page.on('response', (res) => { if (res.status() >= 400) log.push(`HTTP ${res.status()} ${res.url().replace(server.base, '').slice(0, 120)}`); });
          contexts[key] = { ctx, page, log, signedIn: mocked, writes: m ? m.writes : null };
        }
        const S = contexts[key];
        try {
          if (who && !S.signedIn) { await signIn(S.page, server.base, c); S.signedIn = true; S.log.length = 0; }
          const writesBefore = S.writes ? S.writes.length : 0;
          let target = path;
          if (path.endsWith('/:first')) {
            await S.page.goto(`${server.base}/ganaderia/animales`); await settle(S.page);
            const href = await S.page.evaluate(() => [...document.querySelectorAll('a[href^="/ganaderia/animales/"]')].map((a) => a.getAttribute('href'))[0] || null);
            if (!href) { r.problems.push('no animal to open (add one to the test herd)'); r.ok = false; continue; }
            target = href;
          }
          S.log.length = 0;
          await S.page.goto(`${server.base}${target}`);
          await settle(S.page);
          if (subTab) { await S.page.getByRole('button', { name: subTab, exact: true }).first().click(); await settle(S.page); }
          const m = await S.page.evaluate(measure);
          r.charts = m.charts;
          if (S.log.length) { r.ok = false; r.problems.push(...S.log.slice(0, 3)); }
          if (m.empty) { r.ok = false; r.problems.push(`${m.empty} of ${m.charts} charts without marks`); }
          if (m.overflow) { r.ok = false; r.problems.push('horizontal overflow'); }
          if (S.writes && S.writes.length > writesBefore) { r.ok = false; r.problems.push(`${S.writes.length - writesBefore} write(s) on open: ${S.writes.slice(writesBefore, writesBefore + 2).map((x) => `${x.method} ${x.table}`).join(', ')}`); }
          const file = `${OUT}/${w}-${label.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}.png`;
          await S.page.screenshot({ path: file });
        } catch (e) {
          r.ok = false; r.problems.push(String(e.message).split('\n')[0].slice(0, 160));
        }
      }
      for (const { ctx } of Object.values(contexts)) await ctx.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
  return results;
}

// Report: one line per view (both widths), at most 20 lines in all.
function report(results) {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 1));
  const byLabel = new Map();
  for (const r of results) { if (!byLabel.has(r.label)) byLabel.set(r.label, []); byLabel.get(r.label).push(r); }
  const failed = results.filter((r) => !r.ok);
  const lines = [`smoke — ${byLabel.size} views × ${WIDTHS.length} widths — ${failed.length ? `${failed.length} FAILED` : 'all passed'} (details: .smoke/report.json)`];
  for (const [label, rs] of byLabel) {
    const marks = rs.map((r) => `${r.ok ? '✓' : '✗'} ${r.width}`).join('  ');
    const first = rs.find((r) => !r.ok)?.problems[0];
    lines.push(`${marks}  ${label.padEnd(28)} ${first ? '— ' + first : rs[0].charts ? `charts ${rs[0].charts}` : ''}`.slice(0, 150));
  }
  if (lines.length > 20) { const extra = lines.length - 19; lines.splice(19, lines.length, `… ${extra} more lines in .smoke/report.json`); }
  console.log(lines.join('\n'));
  return failed.length === 0;
}

run().then((r) => process.exit(report(r) ? 0 : 1)).catch((e) => { console.error(`smoke: ${e.message}`); process.exit(1); });
