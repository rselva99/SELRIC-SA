// ─── STATEMENT VALIDATION ────────────────────────────────────────────────────
//
// Runs at import time against whatever the extractor returned. Two roles:
//
//   1. Reject implausible extractions early — a statement with zero deposits
//      is the failure mode this module was created to catch. Every prior 2024
//      statement in this app came back with 0 deposits because the extractor
//      prompt actively excluded them; the fix is to make that state a hard
//      import error, not a silent success.
//
//   2. Assert the printed summary reconciles: beg + deposits − withdrawals −
//      checks − fees == end. If it doesn't, the extraction is unreliable and
//      shouldn't feed the ledger.
//
// The functions here are UI-agnostic — callers pass the parsed extractor
// result and receive either a resolved validation object or a thrown Error
// with a user-facing message.

const RECON_TOLERANCE = 0.01; // one-cent slack against rounding in printed totals

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// The extractor may report either 0 or omit the field entirely when a printed
// total isn't broken out. We treat "printed the field with 0" and "didn't
// print the field" the same way — both mean "not usable as a reconciliation
// anchor," and both are fine as long as at least one summary side is present.
export function validateStatementTotals(totals, opts = {}) {
  const { requireReconciliation = true } = opts;
  if (!totals || typeof totals !== 'object') {
    throw new Error('Statement summary block was not extracted. The importer needs beginning + ending balance to validate.');
  }
  const beg  = num(totals.beginning_balance);
  const end  = num(totals.ending_balance);
  const dep  = num(totals.deposits_total);
  const wd   = num(totals.withdrawals_total);
  const chk  = num(totals.checks_total);
  const fee  = num(totals.fees_total);
  const rchk = num(totals.returned_checks_total);       // credited back — adds
  const atr  = num(totals.automatic_transfers_total);   // signed as reported
  if (!requireReconciliation) return { beg, end, dep, wd, chk, fee, rchk, atr };
  if (beg === 0 && end === 0) {
    throw new Error('Statement summary was extracted but both beginning and ending balances are zero — refusing to import.');
  }
  const implied = beg + dep + rchk + atr - wd - chk - fee;
  const drift = Math.round((implied - end) * 100) / 100;
  if (Math.abs(drift) > RECON_TOLERANCE) {
    throw new Error(
      `Statement does not reconcile: beg $${beg.toFixed(2)} + deposits $${dep.toFixed(2)} + returned_checks $${rchk.toFixed(2)} + auto_transfers $${atr.toFixed(2)} − withdrawals $${wd.toFixed(2)} − checks $${chk.toFixed(2)} − fees $${fee.toFixed(2)} = $${implied.toFixed(2)}, but printed ending is $${end.toFixed(2)} (drift $${drift.toFixed(2)}).`
    );
  }
  return { beg, end, dep, wd, chk, fee, rchk, atr, drift };
}

// Zero-deposit statements were the silent-failure mode we're fixing. A real
// checking statement for an operating business is essentially guaranteed to
// have at least one credit line in the month. Reject anything the extractor
// returned without credits.
export function assertHasDeposits(transactions, totals) {
  const list = Array.isArray(transactions) ? transactions : [];
  const credits = list.filter(t => t && (t.type === 'credit' || Number(t.amount) > 0));
  const summaryClaims = num(totals?.deposits_total) > 0 || num(totals?.deposit_count) > 0;
  if (credits.length === 0 && summaryClaims) {
    throw new Error(
      `Extractor found ${list.length} rows but zero deposits, yet the printed summary says deposits total $${num(totals?.deposits_total).toFixed(2)} across ${num(totals?.deposit_count)} entries. This is the exact failure mode Step 1 fixed — refusing to import.`
    );
  }
  if (credits.length === 0 && list.length === 0) {
    throw new Error('Extractor returned no transactions at all — refusing to import.');
  }
  if (credits.length === 0) {
    throw new Error(
      `Extractor found ${list.length} rows but zero deposits, and the summary block is missing the deposits total to cross-check against. An operating checking statement with zero credits is implausible — refusing to import.`
    );
  }
}

// One-stop pre-insert gate. Throws on any failure so the caller can surface
// a toast and abort cleanly.
export function validateExtractedStatement(extracted) {
  const totals = extracted?.statement_totals;
  const summary = validateStatementTotals(totals);
  assertHasDeposits(extracted?.transactions, totals);
  return summary;
}
