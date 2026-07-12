// ─── STATEMENT DEDUPE ────────────────────────────────────────────────────────
//
// Idempotent insert for bank statement transactions. Re-running an extractor
// against a statement that's already been imported must NOT create duplicate
// rows for the ones we've already seen — it should only INSERT what the
// statement genuinely shows that the DB doesn't yet hold.
//
// Match key: (date, amount_cents, normalized_description). The three fields
// together are stable across re-extractions of the same PDF and unique enough
// to identify a bank line. We DON'T include bank_statement_id in the key:
// callers pass in existing rows already scoped by bank_statement_id, so the
// key doesn't need to carry it.
//
// MULTIPLICITY IS PRESERVED.
// Banks legitimately post the same amount to the same description on the
// same day more than once — Apple.com $2.99 twice a day, an ATM withdrawal
// plus its $3 fee twice the same day, two Rackco charges. The Step 0 audit
// found 15 (now 16) such pairs in the real 2024 data. `partitionByMultiplicity`
// (the current API) matches by COUNT per key and inserts the difference, so
// legit multiplicity survives. The older `partitionNewRows` (Set-based) DID
// NOT preserve multiplicity — it treated every same-key row after the first
// as a duplicate — and is only kept as a deprecated shim for any caller not
// yet migrated. Prefer `partitionByMultiplicity` for anything new.

function amountCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function normDescription(d) {
  return String(d || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Match key EXCLUDES bank_statement_id: partitions run per-statement, and the
// caller has already filtered `existing` by bank_statement_id before calling.
//
// We deliberately KEY ON (date, amount_cents) ONLY — not description. OCR
// variance across extractor versions renders the same real transaction with
// different descriptions ("Coca-C" vs "Coca,C", "Glazer*" vs "Glazer'",
// trailing ")" present vs missing, trailing card-BIN "5433" present vs
// stripped). Including description in the key caused the same-PDF re-upload
// simulation to mark 40 October debits as "new" when they were the exact same
// rows. Amount + date is the identity the bank actually posts against;
// description is display metadata that drifts.
//
// Rare edge case: two different real transactions with the same date+amount
// but different vendors. Multiplicity still handles this correctly — if the
// statement shows 2 rows at (date, amount) and the DB has 1, we insert 1
// more regardless of which vendor. Over-insertion is impossible.
export function txKey(row) {
  return `${row.date}|${amountCents(row.amount)}`;
}

// Retained for callers that still want the description-sensitive key.
// Not used inside partitionByMultiplicity anymore.
export function txKeyWithDescription(row) {
  return `${row.date}|${amountCents(row.amount)}|${normDescription(row.description)}`;
}

// COUNT-BASED partition — the current API.
//
// For each (date, amount, description) key, compare the count in the incoming
// (statement) rows against the count in the existing (DB) rows. Insert the
// gap; the rest are already present. `toInsert` is a stable slice of the
// incoming rows (last N of each key), so caller-side ordering is preserved.
//
// Example (Dec 12/20 two Rackco $99.95 credits):
//   existing: 1 row for this key
//   incoming: 2 rows for this key
//   → alreadyPresent gets 1 (the first), toInsert gets 1 (the second)
//
// Example (an ATM withdrawal + fee that legitimately posts twice per day):
//   existing: 2 rows for this key (both correctly captured earlier)
//   incoming: 2 rows for this key
//   → alreadyPresent gets 2, toInsert gets 0 (nothing added, nothing lost)
export function partitionByMultiplicity(existingRows, incoming) {
  const dbCounts = new Map();
  for (const r of existingRows || []) {
    const k = txKey(r);
    dbCounts.set(k, (dbCounts.get(k) || 0) + 1);
  }
  const stmtRowsByKey = new Map();
  for (const r of incoming || []) {
    const k = txKey(r);
    if (!stmtRowsByKey.has(k)) stmtRowsByKey.set(k, []);
    stmtRowsByKey.get(k).push(r);
  }
  const toInsert = [];
  const alreadyPresent = [];
  for (const [k, rows] of stmtRowsByKey.entries()) {
    const dbCount = dbCounts.get(k) || 0;
    const gap = rows.length - dbCount;
    if (gap <= 0) {
      alreadyPresent.push(...rows);
    } else {
      alreadyPresent.push(...rows.slice(0, dbCount));
      toInsert.push(...rows.slice(dbCount));
    }
  }
  return { toInsert, alreadyPresent };
}

// DEPRECATED — Set-based partition that treats every same-key row after the
// first as a duplicate and collapses legit multiplicity. Kept only as a
// backwards-compatible shim; delete once no caller imports it.
export function partitionNewRows(existingRows, incoming) {
  const { toInsert, alreadyPresent } = partitionByMultiplicity(existingRows, incoming);
  return { toInsert, skipped: alreadyPresent };
}
