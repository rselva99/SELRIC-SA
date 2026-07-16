-- ROLLBACK_checks_load.sql
--
-- Reverses the Cash Management feature completely.
-- Safe to run at any time.
--
-- Guaranteed to touch ONLY what this feature added:
--   • the `checks` table (dropped completely)
--   • journal_entries rows whose `source_tag = 'checks'` (from classification)
--   • their mirror transactions rows (found via journal_entry_id link)
--   • the additive `source_tag` column on `journal_entries` (dropped)
--
-- Pre-existing rows and non-checks JEs remain byte-for-byte untouched.
--
-- Snapshot recovery: if a full-fidelity restore is needed instead, use
-- the JSON snapshot at
--   /Users/ricardoselva/Documents/SELRIC_CHECKS_LOAD_TX_SNAPSHOT_YYYYMMDD.json
-- produced by scripts/load_checks.mjs.

BEGIN;

-- 1. Void every classification journal entry (source_tag='checks').
--    Their mirror transactions are voided by cascade via voided flag.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.journal_entries WHERE source_tag = 'checks'
  LOOP
    UPDATE public.journal_entries SET status = 'voided' WHERE id = r.id;
    UPDATE public.transactions    SET voided = true      WHERE journal_entry_id = r.id;
  END LOOP;
END $$;

-- 2. Drop the checks table itself. All triggers/policies/indexes go with it.
DROP TABLE IF EXISTS public.checks CASCADE;

-- 3. Drop the additive source_tag column on journal_entries.
--    Only safe because we voided the classification entries above; if we
--    kept them, dropping the tag would erase their provenance.
ALTER TABLE public.journal_entries DROP COLUMN IF EXISTS source_tag;

DO $$ BEGIN RAISE NOTICE 'Cash Management feature fully rolled back.'; END $$;

COMMIT;
