// PreToolUse hook for Bash: guards every `git commit` Claude runs in this repo.
//
// Claude Code passes the tool call as JSON on stdin. Anything that is not a
// git commit passes straight through (exit 0). A commit is blocked (exit 2,
// with the reason on stderr, which Claude reads) when:
//   1. the same command also stages files — the hook runs before the command,
//      so it could not see them; stage in one call, commit in the next
//   2. a staged path is on the never-stage list (this repository is public)
//   3. a staged diff carries something that looks like a key
//   4. `npm run check` fails (build, EN/ES parity, unit tests, smoke)
// The checks it runs are the same ones a human runs by hand; nothing here
// writes to the repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const NEVER = [
  [/^\.env(\.|$)(?!example$)/, 'environment file'],
  [/^\/?reports\//, 'local reports'],
  [/^\.smoke\//, 'smoke screenshots'],
  [/^\.claude\/settings\.local\.json$/, 'per-machine Claude settings'],
  [/^\.claude\/launch\.json$/, 'per-machine launch config'],
  [/^migrations\/.*fy2025.*\.sql$/i, 'FY2025 bookkeeping migration'],
  [/^migrations\/2026-09-/, 'FY2025 bookkeeping migration'],
  [/^migrations\/2026-07-22-book-bs-l20a-upstart-loan\.sql$/, 'pilot bookkeeping migration'],
  [/^data\//, 'imported financial data'],
  [/^\.local\//, 'recovery artifacts'],
  [/^docs\/(?!ARCHITECTURE\.md$)/, 'local docs (only docs/ARCHITECTURE.md is tracked)'],
  [/^scripts\/(?!i18n_parity\.mjs$|smoke\.mjs$|checks\.mjs$)/, 'local scripts (only i18n_parity.mjs, smoke.mjs and checks.mjs are tracked)'],
];
const SECRET = /(eyJ[A-Za-z0-9_-]{60,}\.[A-Za-z0-9_-]{20,})|sb_secret_[A-Za-z0-9]{10,}|sk-ant-[A-Za-z0-9-]{10,}|SERVICE_ROLE_KEY\s*=\s*\S{20,}/;

// The shell words only: here-document bodies and quoted strings (a commit
// message, an echo) are removed first, so text that merely mentions
// `git commit` or `git add` is not mistaken for the command.
export function shellWords(cmd) {
  let s = String(cmd);
  s = s.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, ' \n');
  s = s.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return s;
}
export const isCommit = (cmd) => /(^|[\s;&|()])git(\s+-[Cc]\s+\S+)*\s+commit(\s|$)/.test(shellWords(cmd));
export const alsoStages = (cmd) => { const s = shellWords(cmd); return /(^|[\s;&|()])git(\s+-[Cc]\s+\S+)*\s+(add|rm|mv)\s/.test(s) || /\bgit\s+commit\b[^;&|\n]*\s-(a|am|-all)\b/.test(s); };
export const checkStaged = (paths) => paths.map((p) => [p, NEVER.find(([re]) => re.test(p))]).filter(([, hit]) => hit).map(([p, [, why]]) => `${p} — ${why}`);

function block(msg) { process.stderr.write(`guard-commit: ${msg}\n`); process.exit(2); }

function main() {
  let input = {};
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const cmd = input?.tool_input?.command || '';
  if (input.tool_name && input.tool_name !== 'Bash') process.exit(0);
  if (!isCommit(cmd)) process.exit(0);

  const cwd = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  if (alsoStages(cmd)) block('this command stages and commits in one go, so the staged set cannot be checked first. Stage (and show `git diff --cached --stat`) in one call, then run `git commit` alone in the next.');

  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' }).split('\n').filter(Boolean);
  if (!staged.length) block('nothing is staged.');
  const bad = checkStaged(staged);
  if (bad.length) block(`never-stage paths are staged — unstage them (git restore --staged <path>):\n  ${bad.join('\n  ')}`);

  const diff = execFileSync('git', ['diff', '--cached', '-U0', '--no-color'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const leak = diff.split('\n').find((l) => l.startsWith('+') && SECRET.test(l));
  if (leak) block(`a staged line looks like a key or token — remove it before committing:\n  ${leak.slice(0, 80)}…`);

  const r = spawnSync('npm', ['run', 'check'], { cwd, encoding: 'utf8', timeout: 540000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const tail = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-25).join('\n');
    block(`\`npm run check\` failed${r.signal ? ` (${r.signal})` : ''} — fix it before committing:\n${tail}`);
  }
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
