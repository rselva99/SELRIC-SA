-- 2026-07-13 · transactions.updated_at — audit-trail hardening (REWRITE)
--
-- SUPERSEDES an earlier draft of this file which was rejected because:
--   (a) its blanket "UPDATE transactions SET updated_at = created_at WHERE
--       created_at IS NOT NULL" ran on EVERY re-run and — because the
--       trigger already existed by the second run — the trigger would
--       overwrite every updated_at to now(), destroying the audit trail;
--   (b) that same UPDATE would trip the enforce_period_lock trigger for
--       every 2024 row (all 12 2024 periods are 'closed');
--   (c) it had a boolean-precedence and xmax check that were incoherent.
-- This rewrite fixes all three by (i) wrapping the backfill in a guard
-- that only fires when the column was just created THIS run, (ii)
-- disabling enforce_period_lock for the backfill only, (iii) removing the
-- broken UPDATE entirely.
--
-- BEHAVIOUR ON REPEAT RUNS:
--   Run #1  (column doesn't exist):
--            1. `updated_at` column is added (nullable).
--            2. `trg_period_lock_transactions` is temporarily DISABLED (the
--               only trigger that would block the backfill UPDATE on rows
--               dated in closed periods). No app-side triggers exist yet
--               for updated_at (this file creates them in step 4 below).
--            3. `UPDATE transactions SET updated_at = created_at` runs.
--               enforce_period_lock is inactive so no PERIOD_LOCKED errors.
--            4. `trg_period_lock_transactions` re-enabled.
--            5. `updated_at` gets NOT NULL + DEFAULT now() constraints.
--            6. Trigger function + trigger + helper index created.
--   Run #2  (column exists — this is the important idempotent branch):
--            1. The DO block short-circuits at the col_exists check.
--               No UPDATE runs. Existing `updated_at` values — which have
--               since been mutated by real activity — are preserved.
--            2. CREATE OR REPLACE FUNCTION reinstalls the trigger fn
--               (identical body).
--            3. DROP TRIGGER IF EXISTS + CREATE TRIGGER reinstalls the
--               trigger (identical binding).
--            4. CREATE INDEX IF NOT EXISTS is a no-op.
--   Run #3+: identical to Run #2.
--
-- EXPLICITLY: no code path in this file ever runs an UPDATE on
--   `transactions` after the trg_period_lock_transactions trigger has been
--   re-enabled and the trg_transactions_set_updated_at trigger exists. The
--   updated_at column can only be moved by real app UPDATEs going forward.

-- 1. Add the column and backfill from created_at, ONE TIME ONLY.
DO $$
DECLARE
  col_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'transactions'
      AND column_name  = 'updated_at'
  ) INTO col_exists;

  IF col_exists THEN
    RAISE NOTICE 'transactions.updated_at already exists — backfill skipped (idempotent).';
    RETURN;
  END IF;

  ALTER TABLE public.transactions ADD COLUMN updated_at TIMESTAMPTZ;

  -- Temporarily suspend the period-lock trigger so the backfill UPDATE can
  -- touch closed-period rows. `session_replication_role = replica` also
  -- suspends every trigger session-wide, but that requires superuser rights
  -- on some deployments. Disabling this one specific trigger is narrower
  -- and doesn't need special role. The EXCEPTION block re-enables it if
  -- anything raises between the DISABLE and the ENABLE.
  BEGIN
    ALTER TABLE public.transactions DISABLE TRIGGER trg_period_lock_transactions;
    UPDATE public.transactions SET updated_at = created_at;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.transactions ENABLE TRIGGER trg_period_lock_transactions;
    RAISE;
  END;
  ALTER TABLE public.transactions ENABLE TRIGGER trg_period_lock_transactions;

  ALTER TABLE public.transactions
    ALTER COLUMN updated_at SET NOT NULL,
    ALTER COLUMN updated_at SET DEFAULT now();
END $$;

-- 2. Trigger function — stamps updated_at on every UPDATE.
CREATE OR REPLACE FUNCTION public.transactions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger — fires on every UPDATE (not INSERT; the DEFAULT handles inserts).
DROP TRIGGER IF EXISTS trg_transactions_set_updated_at ON public.transactions;
CREATE TRIGGER trg_transactions_set_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.transactions_set_updated_at();

-- 4. Helper index on updated_at.
--
--    Original draft used a partial index
--       WHERE updated_at > '2026-07-13'::timestamptz
--    Postgres requires partial-index predicates to be IMMUTABLE. The cast
--    text -> timestamptz is marked STABLE (not IMMUTABLE) — its result
--    depends on the session TimeZone setting when the string has no
--    explicit offset. `'2026-07-13'::timestamptz` has no offset and is
--    therefore STABLE, which typically triggers
--       ERROR: functions in index predicate must be marked IMMUTABLE
--    We have no arbitrary-SQL RPC (`exec_sql` etc.) or direct DB
--    connection available from the migration harness in this repo, so
--    the predicate could not be tested live. Rather than assume, we
--    take the user's fallback: drop the WHERE clause and index the
--    whole column. The index doubles as an ORDER BY helper for the
--    audit-timeline query the app uses to display recent edits.
CREATE INDEX IF NOT EXISTS transactions_updated_at_idx
  ON public.transactions (updated_at);
