// The checks engine: the registry of checks and the two things every reader
// needs from it — run them all, and turn a run into one health score.
//
//   runChecks(data, { program, period, today })  →  [{ key, program, severity, status, amount, count, detail }]
//   healthScore(results)                          →  { score 0–100 | null, green, amber, red, skipped }
//
// `data` is what ./fetch.js reads for one workspace; every check is a pure
// function over it (see ./util.js for the result shape), so the same run
// works in the browser, in `npm run checks` and in the tests.
import * as tbBalanced from './business/tbBalanced.js';
import * as cashLegSingle from './business/cashLegSingle.js';
import * as orphanLines from './business/orphanLines.js';
import * as statementTies from './business/statementTies.js';
import * as checkNoPayee from './business/checkNoPayee.js';
import * as returnedUnpaired from './business/returnedUnpaired.js';
import * as merchantClearing from './business/merchantClearing.js';
import * as salesTax from './business/salesTax.js';
import * as tips from './business/tips.js';
import * as payrollCleared from './business/payrollCleared.js';
import * as accruedNoCash from './business/accruedNoCash.js';
import * as duplicateCandidates from './business/duplicateCandidates.js';
import * as closedPeriodEntries from './business/closedPeriodEntries.js';
import * as unknownDeposits from './business/unknownDeposits.js';
import * as loanVsLender from './business/loanVsLender.js';

const tag = (program) => (m) => ({ key: m.key, program, severity: m.severity, run: m.run });

// Display order: the books' own integrity first, then the bank, then the
// accounts that should clear, then the review lists.
export const BUSINESS_CHECKS = [
  tbBalanced, orphanLines, closedPeriodEntries, cashLegSingle, statementTies, unknownDeposits,
  returnedUnpaired, checkNoPayee, duplicateCandidates, merchantClearing, salesTax, tips,
  payrollCleared, accruedNoCash, loanVsLender,
].map(tag('business'));

export const CHECKS = [...BUSINESS_CHECKS];
export const checkByKey = (key) => CHECKS.find((c) => c.key === key) || null;

export function runChecks(data, ctx = {}) {
  const list = CHECKS.filter((c) => !ctx.program || c.program === ctx.program);
  const today = ctx.today || new Date().toISOString().slice(0, 10);
  return list.map((c) => {
    try {
      return { key: c.key, program: c.program, severity: c.severity, ...c.run(data, { ...ctx, today }) };
    } catch (e) {
      // A check that throws is a red result with the reason, never a crash
      // of the whole run.
      return { key: c.key, program: c.program, severity: c.severity, status: 'red', amount: 0, count: 1, detail: { rows: [], total: 0, error: String(e?.message || e).slice(0, 200) } };
    }
  });
}

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
