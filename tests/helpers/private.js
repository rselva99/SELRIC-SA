// The confidential half of the tests lives outside this public repository.
//
// SELRIC_PRIVATE_DIR (default ~/selric-business) holds the golden fixture —
// fixtures/golden-v<N>.json, written by make_golden.mjs from one stored
// assumptions version — and the seeded documents under docs/. Suites that
// need them call `privateData()`; it returns null when the folder or the
// fixture is missing, and those suites skip with a notice instead of failing.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PRIVATE_DIR = process.env.SELRIC_PRIVATE_DIR || join(homedir(), 'selric-business');

let cached;
export function privateData() {
  if (cached !== undefined) return cached;
  const dir = join(PRIVATE_DIR, 'fixtures');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^golden-v\d+\.json$/.test(f)) : [];
  if (!files.length) {
    console.warn(`[tests] no golden fixture under ${dir} — the confidential suites are skipped`);
    cached = null;
    return cached;
  }
  // The newest version wins; regenerate it with make_golden.mjs when the base case changes.
  const newest = files.sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))[0];
  cached = { file: newest, ...JSON.parse(readFileSync(join(dir, newest), 'utf8')) };
  return cached;
}

export const readPrivate = (rel) => readFileSync(join(PRIVATE_DIR, rel), 'utf8');
export const hasPrivateFile = (rel) => existsSync(join(PRIVATE_DIR, rel));
