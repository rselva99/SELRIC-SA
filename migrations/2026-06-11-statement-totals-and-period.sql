-- 2026-06-11  Fixes the "Direct from PDF pull" statement totals and adds
-- the per-statement period range needed by the Reports filter.
--
-- ── Safety rules ──────────────────────────────────────────────────────────
-- • READ-ONLY against transactions and journal_entries. This migration
--   never modifies their rows.
-- • Additive only. The only DDL is `ADD COLUMN IF NOT EXISTS` on
--   bank_statements (two new NULLABLE columns) and `CREATE OR REPLACE
--   FUNCTION` for the aggregation RPC.
-- • The single UPDATE statement writes ONLY to the new period_start /
--   period_end columns on bank_statements, and only when they are NULL,
--   so re-running is a no-op.
-- ──────────────────────────────────────────────────────────────────────────
--
-- WHY this migration exists:
--
-- Part 1 (the bug). Today the client fetches raw transaction rows with
-- `.in('bank_statement_id', stmt_ids)` and groups/sums in JavaScript.
-- PostgREST caps every query at 1000 rows by default, so as soon as a
-- pool of statements together has more than 1000 linked txns (the live
-- DB has ~1,800+), every statement gets an arbitrary slice. The
-- Bookkeeping list shows one partial slice (smaller pool of statements
-- per page) and the Reports list shows another (all statements at once),
-- which is exactly why the same statement displayed different numbers in
-- the two places. The fix replaces the row fetch with a server-side
-- aggregate. Sums are computed inside Postgres on every matching row;
-- only one row per statement crosses the wire. No row cap can possibly
-- truncate the result.
--
-- Part 2 (the period). bank_statements already has period_start /
-- period_end DATE columns in the original schema, but nothing populated
-- them. The IF NOT EXISTS guards on the ADD COLUMN lines make this
-- migration safe to run regardless of whether the columns were created
-- by the original CREATE TABLE; either way they end up NULLABLE DATE.
-- The backfill walks the existing linked transactions and writes
-- MIN(date)/MAX(date) onto each bank_statements row where the period
-- columns are still NULL. Re-running is a no-op because the WHERE
-- clause keeps it scoped to NULLs only.

-- ── 1. Period columns on bank_statements ─────────────────────────────────
ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS period_start DATE,
  ADD COLUMN IF NOT EXISTS period_end   DATE;

-- ── 2. statement_totals RPC ──────────────────────────────────────────────
-- Per-statement aggregates computed server-side. Sign convention follows
-- src/lib/finance.js — debits and credits use ABS(amount) keyed off the
-- type column so the mixed-sign storage convention can't bite us here.
-- SECURITY INVOKER (default) so RLS on transactions applies normally.
CREATE OR REPLACE FUNCTION public.statement_totals(stmt_ids UUID[])
RETURNS TABLE (
  bank_statement_id UUID,
  txn_count         BIGINT,
  debits            NUMERIC,
  credits           NUMERIC,
  posted_count      BIGINT,
  voided_count      BIGINT
)
LANGUAGE SQL
STABLE
SECURITY INVOKER
AS $$
  SELECT
    bank_statement_id,
    COUNT(*)::BIGINT AS txn_count,
    COALESCE(SUM(CASE WHEN type = 'debit'  THEN ABS(amount) ELSE 0 END), 0) AS debits,
    COALESCE(SUM(CASE WHEN type = 'credit' THEN ABS(amount) ELSE 0 END), 0) AS credits,
    COUNT(*) FILTER (WHERE posted)::BIGINT AS posted_count,
    COUNT(*) FILTER (WHERE voided)::BIGINT AS voided_count
  FROM public.transactions
  WHERE bank_statement_id = ANY(stmt_ids)
  GROUP BY bank_statement_id;
$$;

GRANT EXECUTE ON FUNCTION public.statement_totals(UUID[]) TO authenticated;

-- ── 3. Backfill period_start / period_end ────────────────────────────────
-- Idempotent: only fills rows where the period is still NULL. Reads from
-- transactions, writes ONLY to the two new bank_statements columns.
UPDATE public.bank_statements bs
   SET period_start = COALESCE(bs.period_start, sub.min_date),
       period_end   = COALESCE(bs.period_end,   sub.max_date)
  FROM (
    SELECT bank_statement_id,
           MIN(date) AS min_date,
           MAX(date) AS max_date
      FROM public.transactions
     WHERE bank_statement_id IS NOT NULL
     GROUP BY bank_statement_id
  ) sub
 WHERE bs.id = sub.bank_statement_id
   AND (bs.period_start IS NULL OR bs.period_end IS NULL);
