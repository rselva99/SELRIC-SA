// Smoke test: the app, signed in, at desktop and phone width.
//
//   node scripts/smoke.mjs                 # builds dist if missing, serves it with vite preview
//   node scripts/smoke.mjs --url <base>    # test a running server instead (no build, no preview)
//
// Two test accounts, from .env (never printed):
//   SMOKE_CEO_EMAIL / SMOKE_CEO_PASSWORD   a platform admin → the /ceo tabs and the Documents sub-tabs
//   SMOKE_GAN_EMAIL / SMOKE_GAN_PASSWORD   a Ganadería test workspace → the herd pages
// and six mocked workspaces, served from tests/fixtures (no account,
// no request reaches the real database — every Supabase call is answered by
// tests/fixtures/mock-supabase.js inside the browser context):
//   BIZ    the synthetic restaurant, full package, twelve months of books, one
//          planted problem per check — every full-package route
//   BIZS   the same restaurant in Simple mode — every Simple route
//   BIZ0   a brand-new Business workspace with nothing in it
//   BIZU   a Simple workspace whose portal is not set up yet — /setup
//   HERD   the synthetic finca, a year of herd records and one planted problem
//          per herd check — Inicio and Informes with every chart drawn
//   CEOS   an invented SelRic office: /ceo and Pilots with four invented
//          workspaces' twelve-week activity and check scores (no plan loaded)
// plus the public pages, signed out. `--only <text>` runs the views whose
// label contains the text (for a quick look; the full run is the gate).
// Every view is opened at 1366 and 390 px
// and must have no console or page error, no failed request, SVG marks in every
// chart, no horizontal overflow, and (mocked views) no write. Screenshots and
// the full report go to .smoke/ (gitignored); the console report is 20 lines at
// most. Exit 1 on any failure, including missing credentials — a skipped
// account is a failed check.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { makeBusiness } from '../tests/fixtures/synthetic-business.js';
import { makeHerd } from '../tests/fixtures/synthetic-herd.js';
import { makeCeo } from '../tests/fixtures/synthetic-ceo.js';
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
  if (who === 'HERD') return makeHerd({ today: TODAY, issues: true });
  if (who === 'CEOS') return makeCeo({ today: TODAY });
  if (who === 'BIZ') {
    const b = makeBusiness({ today: TODAY, issues: true });
    const runAt = `${TODAY}T06:00:00.000Z`;
    const integrity_results = runChecks(b.data, { today: TODAY, program: 'business' })
      .map((r, i) => ({ id: `ir-${i}`, org_id: b.org.id, check_key: r.key, period: 'all', status: r.status, amount: r.amount, count: r.count, detail: r.detail, run_at: runAt }));
    return { ...b, tables: { ...b.tables, integrity_results, integrity_checks: [] } };
  }
  if (who === 'BIZS') {
    // Every module on, so every Simple route opens instead of redirecting.
    const b = makeBusiness({ today: TODAY, mode: 'simple' });
    const modules = { sales: true, customers: true, inventory: true, tasks: true, reports: true };
    const organizations = b.tables.organizations.map((o) => ({ ...o, config: { ...o.config, modules } }));
    return { ...b, tables: { ...b.tables, organizations, integrity_results: [], integrity_checks: [] } };
  }
  const b = makeBusiness({ today: TODAY, months: 1, name: 'New Bistro (synthetic)', mode: who === 'BIZU' ? 'simple' : 'full' });
  const keep = ['organizations', 'profiles', 'org_programs', 'categories'];
  const tables = { ...Object.fromEntries(keep.map((k) => [k, b.tables[k]])), integrity_results: [], integrity_checks: [] };
  // Not set up yet: no portal config, so an admin is sent to /setup.
  if (who === 'BIZU') tables.organizations = tables.organizations.map((o) => ({ ...o, config: {} }));
  return { ...b, tables };
}
const MOCKED = new Set(['BIZ', 'BIZS', 'BIZ0', 'BIZU', 'HERD', 'CEOS']);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS', 'access-control-expose-headers': 'content-range, content-profile' };

// A browser context whose Supabase is the mock: the session sits in
// localStorage where supabase-js looks for it, the accountant PIN gate is
// already passed for the tab, and every request to the project is answered
// from the fixture. Writes are counted, never applied.
async function mockedContext(browser, who, viewport) {
  const w = mockedWorkspace(who);
  const session = fakeSession(w.user);
  const handle = mockSupabase({ tables: w.tables, user: w.user, session, rpc: { is_platform_admin: false, get_signup_mode: 'invite', statement_totals: [], ...w.rpc } });
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
  return { ctx, writes: handle.writes, tables: w.tables };
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
  // The invented office: sparklines and check scores with something in them.
  ['CEOS', '/ceo', 'ceo synthetic /ceo'],
  ['CEOS', '/ceo/pilots', 'ceo synthetic /ceo/pilots'],
  ['GAN', '/ganaderia', '/ganaderia'],
  ['GAN', '/ganaderia/animales', '/ganaderia/animales'],
  ['GAN', '/ganaderia/animales/:first', '/ganaderia/animales/:slug'],
  ['GAN', '/ganaderia/eventos', '/ganaderia/eventos'],
  ['GAN', '/ganaderia/lotes', '/ganaderia/lotes'],
  ['GAN', '/ganaderia/informes', '/ganaderia/informes'],
  // The synthetic finca: the herd charts with data in them.
  ['HERD', '/ganaderia', 'herd /ganaderia'],
  ['HERD', '/ganaderia/informes', 'herd /ganaderia/informes'],
  ['HERD', '/ganaderia/lotes', 'herd /ganaderia/lotes'],
  // Business, full package: every route.
  ['BIZ', '/dashboard', 'biz /dashboard'],
  ['BIZ', '/bookkeeping', 'biz /bookkeeping'],
  ['BIZ', '/bookkeeping/reconcile', 'biz /bookkeeping/reconcile'],
  ['BIZ', '/cash-management', 'biz /cash-management'],
  ['BIZ', '/ledger', 'biz /ledger'],
  ['BIZ', '/journal', 'biz /journal'],
  ['BIZ', '/accounts', 'biz /accounts'],
  ['BIZ', '/sales', 'biz /sales'],
  ['BIZ', '/customers', 'biz /customers'],
  ['BIZ', '/inventory', 'biz /inventory'],
  ['BIZ', '/payroll', 'biz /payroll'],
  ['BIZ', '/assets', 'biz /assets'],
  ['BIZ', '/tasks', 'biz /tasks'],
  ['BIZ', '/transactions', 'biz /transactions'],
  ['BIZ', '/accountant', 'biz /accountant'],
  ['BIZ', '/accountant/review-match/:stmt', 'biz /accountant/review-match'],
  ['BIZ', '/accountant/book-balance-sheet', 'biz /accountant/book-balance'],
  ['BIZ', '/reports', 'biz /reports · P&L'],
  ['BIZ', '/reports', 'biz /reports · balance sheet', 'Balance sheet'],
  ['BIZ', '/reports', 'biz /reports · cash bridge', 'Cash bridge'],
  ['BIZ', '/reports/fy2024-corrected', 'biz /reports/fy2024-corrected'],
  ['BIZ', '/checks', 'biz /checks'],
  ['BIZ', '/users', 'biz /users'],
  ['BIZ', '/settings', 'biz /settings'],
  // Business, Simple mode: every route.
  ['BIZS', '/dashboard', 'simple /dashboard'],
  ['BIZS', '/transactions', 'simple /transactions'],
  ['BIZS', '/sales', 'simple /sales'],
  ['BIZS', '/customers', 'simple /customers'],
  ['BIZS', '/inventory', 'simple /inventory'],
  ['BIZS', '/tasks', 'simple /tasks'],
  ['BIZS', '/reports', 'simple /reports'],
  ['BIZS', '/users', 'simple /users'],
  ['BIZS', '/settings', 'simple /settings'],
  ['BIZU', '/setup', 'simple new /setup'],
  ['BIZ0', '/checks', 'biz new /checks'],
  ['BIZ0', '/dashboard', 'biz new /dashboard'],
].filter((v) => !arg('--only') || v[2].includes(arg('--only')));

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
  const nav = document.querySelector('[data-testid="biz-bottom-nav"]');
  // A string the translations do not have shows up as its key (lv.shift.PM).
  const groups = 'common|nav|site|programs|pending|landing|pricing|waitlist|auth|dash|settings|tx|sales|crm|rep|cats|inv|lv|portal|ceoComp|charts|checks';
  const rawKeys = [...new Set(document.body.innerText.match(new RegExp(`\\b(?:${groups})\\.[A-Za-z_]+(?:\\.[A-Za-z_]+)*`, 'g')) || [])];
  return { charts: charts.length, empty, overflow, rawKeys, title: document.title, bottomNav: !!nav && nav.getBoundingClientRect().height > 0 };
};

// The first load stays under budget: the chunk index.html loads (every page
// is a lazy chunk of its own). Only for a local build, not with --url.
const ENTRY_BUDGET = 600 * 1000;
function entryBudget() {
  const html = readFileSync(`${ROOT}dist/index.html`, 'utf8');
  const entry = /src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
  const size = entry ? statSync(`${ROOT}dist/assets/${entry}`).size : 0;
  const r = { label: `entry chunk ${(size / 1000).toFixed(0)} kB`, width: 'build', ok: !!entry && size < ENTRY_BUDGET, problems: [], charts: 0 };
  if (!r.ok) r.problems.push(entry ? `over the ${ENTRY_BUDGET / 1000} kB budget` : 'no entry script in dist/index.html');
  return r;
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const server = await serve();
  // Playwright's own Chromium does not run on macOS 13; drive the installed Chrome.
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const results = arg('--url') ? [] : [entryBudget()];
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
          contexts[key] = { ctx, page, log, signedIn: mocked, writes: m ? m.writes : null, tables: m ? m.tables : null };
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
          // A mocked route that names a statement opens the workspace's first one.
          if (path.includes(':stmt')) target = path.replace(':stmt', S.tables?.bank_statements?.[0]?.id || 'none');
          S.log.length = 0;
          await S.page.goto(`${server.base}${target}`);
          await settle(S.page);
          if (subTab) { await S.page.getByRole('button', { name: subTab, exact: true }).first().click(); await settle(S.page); }
          const m = await S.page.evaluate(measure);
          r.charts = m.charts;
          // The route itself must have rendered: a gate or a redirect that
          // lands somewhere else is not coverage of it.
          const landed = new URL(S.page.url()).pathname;
          if (landed !== target) { r.ok = false; r.problems.push(`landed on ${landed}`); }
          // Inside the Business shell on a phone, the bottom nav is the way around.
          if (mocked && !['HERD', 'CEOS'].includes(who) && w < 768 && target !== '/setup' && !m.bottomNav) { r.ok = false; r.problems.push('no bottom nav on the phone'); }
          if (S.log.length) { r.ok = false; r.problems.push(...S.log.slice(0, 3)); }
          if (m.empty) { r.ok = false; r.problems.push(`${m.empty} of ${m.charts} charts without marks`); }
          if (m.overflow) { r.ok = false; r.problems.push('horizontal overflow'); }
          if (m.rawKeys.length) { r.ok = false; r.problems.push(`untranslated: ${m.rawKeys.slice(0, 3).join(', ')}`); }
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
  // Failures first, so the 20-line cut never hides one.
  const sorted = [...byLabel].sort(([, a], [, b]) => Number(a.every((r) => r.ok)) - Number(b.every((r) => r.ok)));
  for (const [label, rs] of sorted) {
    const marks = rs.map((r) => `${r.ok ? '✓' : '✗'} ${r.width}`).join('  ');
    const first = rs.find((r) => !r.ok)?.problems[0];
    lines.push(`${marks}  ${label.padEnd(28)} ${first ? '— ' + first : rs[0].charts ? `charts ${rs[0].charts}` : ''}`.slice(0, 150));
  }
  if (lines.length > 20) { const extra = lines.length - 19; lines.splice(19, lines.length, `… ${extra} more lines in .smoke/report.json`); }
  console.log(lines.join('\n'));
  return failed.length === 0;
}

run().then((r) => process.exit(report(r) ? 0 : 1)).catch((e) => { console.error(`smoke: ${e.message}`); process.exit(1); });
