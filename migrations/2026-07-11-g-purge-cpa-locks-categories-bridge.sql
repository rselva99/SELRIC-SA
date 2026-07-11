-- 2026-07-11-g-purge-cpa-locks-categories-bridge.sql
--
-- The __CPA_LOCKS__ row in `categories` was a pre-DDL bridge that let
-- cpaLocks.js enforce CPA locks before public.cpa_sourced_locks existed
-- (migration 2026-07-11-c). The real table has now been read by the
-- app in production; cpaLocks.js was rewritten to read ONLY the table
-- (removing the fallback code path). Nothing in src/ or api/ still
-- references the bridge — the categories row is dead weight.
--
-- Safe to delete: the row is archived (`archived = true`), does not
-- participate in any journal entry or transaction, and its `type =
-- 'expense'` never surfaces in dropdowns because it is filtered by the
-- archived flag.
--
-- Idempotent: DELETE is a no-op if the row is already gone.

BEGIN;

DELETE FROM public.categories
 WHERE name = '__CPA_LOCKS__';

COMMIT;

-- Verification (run manually after the migration):
--   SELECT count(*) FROM public.categories WHERE name = '__CPA_LOCKS__';
--     -- expected: 0
--   SELECT year, kind, note FROM public.cpa_sourced_locks ORDER BY year, kind;
--     -- expected: 2 rows for 2024 (depreciation, amortization) — untouched.
