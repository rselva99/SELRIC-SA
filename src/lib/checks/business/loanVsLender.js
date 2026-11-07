// Loan balance vs lender statement, when one is on file. A lender statement
// is a balance the workspace confirmed for a loan at a date (today: a loan
// line of the book balance sheet with a confirmed ending balance, mapped to
// the ledger accounts that make it up). The ledger balance of those accounts
// on that date should equal it to the dollar. With no statement on file the
// check has nothing to compare and says so.
import { abs, creditOf, debitOf, inPeriod, isLive, result, round2, row, skip } from '../util.js';

export const key = 'loan_vs_lender';
export const severity = 'red';
export const TOLERANCE = 1;

export function run(data, ctx = {}) {
  const statements = (data.lenderStatements || []).filter((s) => s.as_of && s.balance != null && (s.categories || []).length && inPeriod(s.as_of, ctx.period));
  if (!statements.length) return skip('no_lender_statement');
  const rows = [];
  for (const s of statements) {
    const cats = new Set(s.categories);
    // Liabilities are credit-natural: what is owed is credits less debits.
    const ledger = (data.transactions || []).filter((t) => isLive(t) && cats.has(t.category) && t.date && t.date <= s.as_of)
      .reduce((n, t) => n + creditOf(t) - debitOf(t), 0);
    const diff = round2(ledger - Number(s.balance));
    if (abs(diff) > (ctx.loanTolerance ?? TOLERANCE)) {
      rows.push(row(s.id || s.label, s.as_of, `${s.label} · ledger ${round2(ledger).toFixed(2)} · lender ${Number(s.balance).toFixed(2)}`, diff));
    }
  }
  return result(severity, { rows, compared: statements.length });
}
