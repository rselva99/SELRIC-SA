-- 2026-07-16 · Extend `checks.status` CHECK constraint to include 'excluded'
--
-- ═══════════════════════════════════════════════════════════════════════
-- CONTRACT REFERENCE: docs/CHECKS_RUN_LOG.md §3 — "Already recorded"
-- outcome (outcome C). When the user marks a check as Already Recorded
-- the row is set to status='excluded' — no JE is posted. The check is
-- simply removed from the work queue. It can be undone at any time
-- (reset to 'unclassified') without touching the ledger.
--
-- IDEMPOTENCE. This file is safe to apply more than once.
--   - DROP CONSTRAINT IF EXISTS never errors if the constraint is absent.
--   - ADD CONSTRAINT is wrapped in a DO block that checks
--     pg_constraint before issuing the ALTER, so a second run is a no-op.
--
-- SCOPE. Touches only `public.checks`. Zero changes to `transactions`,
-- `journal_entries`, `journal_entry_lines`, or any other table.
--
-- APPLY ORDER. Must run AFTER 2026-07-15-checks-table.sql.
-- ═══════════════════════════════════════════════════════════════════════

-- Step 1: Drop the existing CHECK constraint (auto-named by Postgres as
--         `checks_status_check`). Use IF EXISTS so a double-run is safe.
ALTER TABLE public.checks
  DROP CONSTRAINT IF EXISTS checks_status_check;

-- Step 2: Re-add the constraint with the four allowed values.
--         Wrapped in a DO block to guard against a second run where the
--         constraint already exists with the new definition.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint c
    JOIN   pg_class      t ON t.oid = c.conrelid
    JOIN   pg_namespace  n ON n.oid = t.relnamespace
    WHERE  n.nspname   = 'public'
      AND  t.relname   = 'checks'
      AND  c.conname   = 'checks_status_check'
  ) THEN
    ALTER TABLE public.checks
      ADD CONSTRAINT checks_status_check
      CHECK (status IN ('unclassified', 'classified', 'voided', 'excluded'));
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE
    'checks_status_check updated: allowed values now = {unclassified, classified, voided, excluded}. '
    'Existing rows unchanged. Zero ledger tables modified.';
END $$;
