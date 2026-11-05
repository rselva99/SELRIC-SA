// Smoke test: the app, signed in, at desktop and phone width.
//
//   node scripts/smoke.mjs                 # builds dist if missing, serves it with vite preview
//   node scripts/smoke.mjs --url <base>    # test a running server instead (no build, no preview)
//
// Two test accounts, from .env (never printed):
//   SMOKE_CEO_EMAIL / SMOKE_CEO_PASSWORD   a platform admin → the /ceo tabs and the Documents sub-tabs
//   SMOKE_GAN_EMAIL / SMOKE_GAN_PASSWORD   a Ganadería test workspace → the herd pages
// plus the public pages, signed out. Every view is opened at 1366 and 390 px
// and must have no console or page error, no failed request, SVG marks in every
// chart, and no horizontal overflow. Screenshots and the full report go to
// .smoke/ (gitignored); the console report is 20 lines at most. Exit 1 on any
// failure, including missing credentials — a skipped account is a failed check.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = `${ROOT}.smoke`;
const WIDTHS = [[1366, 900], [390, 844]];
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

// .env, read without printing anything.
const env = {};
if (existsSync(`${ROOT}.env`)) for (const line of readFileSync(`${ROOT}.env`, 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
const cred = (who) => ({ email: process.env[`SMOKE_${who}_EMAIL`] || env[`SMOKE_${who}_EMAIL`], password: process.env[`SMOKE_${who}_PASSWORD`] || env[`SMOKE_${who}_PASSWORD`] });

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
        const c = who ? cred(who) : null;
        if (who && (!c.email || !c.password)) { r.ok = false; r.problems.push(`no credentials (SMOKE_${who}_EMAIL / _PASSWORD)`); continue; }
        const key = who || 'public';
        if (!contexts[key]) {
          const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
          const page = await ctx.newPage();
          const log = [];
          page.on('console', (m) => { if (m.type() === 'error') log.push(m.text().slice(0, 160)); });
          page.on('pageerror', (e) => log.push(`pageerror: ${String(e.message).slice(0, 160)}`));
          page.on('response', (res) => { if (res.status() >= 400) log.push(`HTTP ${res.status()} ${res.url().replace(server.base, '').slice(0, 120)}`); });
          contexts[key] = { ctx, page, log, signedIn: false };
        }
        const S = contexts[key];
        try {
          if (who && !S.signedIn) { await signIn(S.page, server.base, c); S.signedIn = true; S.log.length = 0; }
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
