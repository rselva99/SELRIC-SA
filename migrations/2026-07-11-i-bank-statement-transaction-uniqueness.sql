-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-07-11-i — DB-level idempotency for bank-imported transactions
--
-- The Step 1 re-extraction runs are guarded at the app layer by the
-- partitionNewRows() helper in src/lib/statementDedupe.js, but a concurrent
-- import into the same statement_id can still race past that check. This
-- partial unique index enforces the same (bank_statement_id, date, amount,
-- description) match at the DB.
--
-- Partial (WHERE bank_statement_id IS NOT NULL) so JE-mirrored transactions
-- and cash-leg mirrors — which legitimately duplicate (date, amount, desc) —
-- are not blocked.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS transactions_bank_dedupe_ux
  ON public.transactions (
    bank_statement_id,
    date,
    amount,
    description
  )
  WHERE bank_statement_id IS NOT NULL;
