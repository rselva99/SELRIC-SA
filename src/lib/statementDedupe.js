// ─── STATEMENT DEDUPE ────────────────────────────────────────────────────────
//
// Idempotent insert for bank statement transactions. Re-running an extractor
// against a statement that's already been imported must NOT create duplicate
// rows for the ones we've already seen — it should only INSERT rows that are
// new (typically deposits added by a later, fixed extractor).
//
// Match key: (bank_statement_id, date, amount_cents, normalized_description).
//   - amount_cents to sidestep floating-point equality
//   - normalized_description collapses whitespace and case; bank layouts often
//     re-render the same line with slightly different spacing between runs
//
// The dedupe is intentionally string-loose on description. Card refs and
// reference numbers vary across formats but the core vendor/date/amount tuple
// is stable enough that duplicates never sneak past.

function amountCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function normDescription(d) {
  return String(d || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function txKey(row) {
  return `${row.bank_statement_id}|${row.date}|${amountCents(row.amount)}|${normDescription(row.description)}`;
}

// Given the extracted rows and the already-persisted rows for the same
// bank_statement_id, return only the rows that don't already exist.
export function partitionNewRows(existingRows, incoming) {
  const seen = new Set((existingRows || []).map(txKey));
  const toInsert = [];
  const skipped = [];
  for (const row of incoming || []) {
    const key = txKey(row);
    if (seen.has(key)) { skipped.push(row); continue; }
    seen.add(key);
    toInsert.push(row);
  }
  return { toInsert, skipped };
}
