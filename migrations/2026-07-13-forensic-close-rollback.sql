-- 2026-07-13 · Forensic-close rollback plan
--
-- This is a documentation-only migration recording the rollback procedure
-- for the FY2024 forensic-close fixes applied on 2026-07-13.
--
-- Fixes applied this run (each in its own numbered migration):
--   • 2026-07-13-fix-cc-processing-cash-legs.sql — posts 12 offsetting
--     cash-leg credits for the "CC Processing" single-legged JEs
--
-- To roll back:
--
--   1. Restore /Users/ricardoselva/Documents/SELRIC_PRE_FIX_SNAPSHOT.json
--      contents to the transactions / journal_entries / journal_entry_lines
--      tables — this is the authoritative rollback path.
--
--   2. If pinpoint rollback is needed instead, run:
--
--      -- Undo CC Processing cash legs
--      DELETE FROM transactions
--      WHERE meta->>'source_migration' = '2026-07-13-fix-cc-processing-cash-legs'
--        AND date >= '2024-01-01' AND date <= '2024-12-31';
--
--      -- Note: transactions inserted via post_journal_entry trigger auto-updates
--      -- balance snapshots. Deleting them may leave stale snapshots — re-run
--      -- period-snapshot refresh migration if that becomes an issue.
--
-- The full-restore procedure via snapshot is preferred because it is
-- guaranteed correct regardless of trigger side-effects.

DO $$
BEGIN
  RAISE NOTICE 'Rollback migration is documentation-only. See file header for procedure.';
END $$;
