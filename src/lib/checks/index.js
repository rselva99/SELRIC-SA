// The checks engine: the registry of checks and the two things every reader
// needs from it — run them all, and turn a run into one health score.
//
//   runChecks(data, { program, period, today })  →  [{ key, program, severity, status, amount, count, detail }]
//   healthScore(results)                          →  { score 0–100 | null, green, amber, red, skipped }
//
// `data` is what ./fetch.js reads for one workspace — the books, or the herd
// ({ animals, events }); every check is a pure function over it (see
// ./util.js for the result shape), so the same run works in the browser, in
// `npm run checks` and in the tests. A program's checks skip when the data
// holds none of what they read.
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
import * as herdNoCategory from './ganaderia/noCategory.js';
import * as herdOrphanEvents from './ganaderia/orphanEvents.js';
import * as herdPregnantNoPalpacion from './ganaderia/pregnantNoPalpacion.js';
import * as herdDamUnresolved from './ganaderia/damUnresolved.js';

const tag = (program) => (m) => ({ key: m.key, program, severity: m.severity, run: m.run });

// Display order: the books' own integrity first, then the bank, then the
// accounts that should clear, then the review lists.
export const BUSINESS_CHECKS = [
  tbBalanced, orphanLines, closedPeriodEntries, cashLegSingle, statementTies, unknownDeposits,
  returnedUnpaired, checkNoPayee, duplicateCandidates, merchantClearing, salesTax, tips,
  payrollCleared, accruedNoCash, loanVsLender,
].map(tag('business'));

// The herd: the timeline's own integrity first, then what the cards say.
export const HERD_CHECKS = [
  herdOrphanEvents, herdNoCategory, herdPregnantNoPalpacion, herdDamUnresolved,
].map(tag('ganaderia'));

export const CHECKS = [...BUSINESS_CHECKS, ...HERD_CHECKS];
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

// The score lives in ./score.js so a page that only shows it loads no check.
export { healthScore, latestByCheck, healthOfStored } from './score.js';
