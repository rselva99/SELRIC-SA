-- ════════════════════════════════════════════════════════════════════════
-- 2026-06-11 — One-time data repair for two misdated statement uploads.
--
-- This is NOT a schema migration. It's a manual fix-it script you paste
-- into the Supabase SQL Editor, run stage by stage, and verify between
-- stages. Scope is tightly bounded to two statements identified by
-- file_name and to UNPOSTED, NON-VOIDED transactions only.
--
-- Targets:
--   • Dec-24.pdf            (most recent re-upload; 132 rows; $115,782.46)
--   • Reprint Oct-24.pdf    (192 rows; $106,212.83)
--
-- Both extractions came back with wrong years for some/all rows:
--   • Dec-24.pdf: every row is dated December 2023; should be December 2024.
--   • Reprint Oct-24.pdf: dates span 2023–2024; the genuinely-2023 ones are
--     all year-inference errors; all rows actually belong to October 2024.
--
-- Repair plan: for the targeted statements only, shift every row whose
-- date.year = 2023 forward by exactly one year (preserving month/day so
-- Nov/Jan boundary days move with their month). The two named statements
-- are the only writes. journal_entries are untouched. No DELETEs.
--
-- Period-lock trigger note: the trigger fires BEFORE UPDATE OF date. Both
-- target months (2024-10, 2024-12) are open as of this script; STAGE 2
-- would raise SQLSTATE P0001 'PERIOD_LOCKED: YYYY-MM is closed' otherwise.
-- If that happens, ABORT (the BEGIN/COMMIT block rolls everything back),
-- reopen the named period from the Accountant page, then re-run STAGE 2.
-- ════════════════════════════════════════════════════════════════════════


-- ── STAGE 1 — PREVIEW (read-only) ──────────────────────────────────────
-- Run this first. Confirm:
--   • Exactly one row per file_name (statements_found = 2 overall).
--   • posted_count = 0 AND voided_count = 0 for both rows.
--   • rows_in_2023 > 0 (otherwise there's nothing to fix; STOP).
-- If any of those conditions fail, STOP and ping the assistant.

WITH targets AS (
  SELECT id, file_name
    FROM public.bank_statements
   WHERE file_name IN ('Dec-24.pdf', 'Reprint Oct-24.pdf')
)
SELECT
  t.file_name,
  COUNT(*)                                                      AS total_rows,
  COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM x.date) = 2023)      AS rows_in_2023,
  COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM x.date) = 2024)      AS rows_in_2024,
  COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM x.date) NOT IN (2023, 2024)) AS rows_other_year,
  COUNT(*) FILTER (WHERE x.posted)                              AS posted_count,
  COUNT(*) FILTER (WHERE x.voided)                              AS voided_count,
  MIN(x.date)                                                   AS min_date,
  MAX(x.date)                                                   AS max_date
FROM targets t
LEFT JOIN public.transactions x ON x.bank_statement_id = t.id
GROUP BY t.file_name
ORDER BY t.file_name;

-- A second look — confirm exactly two statements match (none missing, no
-- duplicates created by an accidental re-upload).
SELECT COUNT(*) AS statements_found
  FROM public.bank_statements
 WHERE file_name IN ('Dec-24.pdf', 'Reprint Oct-24.pdf');


-- ── STAGE 2 — FIX (wrapped in BEGIN/COMMIT) ────────────────────────────
-- Adds 1 year to every transaction.date where the year is 2023, scoped
-- to the two target bank_statement_ids and to unposted, non-voided rows
-- ONLY. Anything else stays untouched.
--
-- The DO $$ block at the top re-asserts the preconditions one more time:
-- if any matching row turns out to be posted or voided (shouldn't happen
-- given STAGE 1, but defends against a race), it raises and the entire
-- BEGIN/COMMIT block rolls back.
--
-- Paste the whole block in one shot — the BEGIN/COMMIT must execute as a
-- single transaction.

BEGIN;

DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO bad_count
    FROM public.transactions t
    JOIN public.bank_statements s ON s.id = t.bank_statement_id
   WHERE s.file_name IN ('Dec-24.pdf', 'Reprint Oct-24.pdf')
     AND EXTRACT(YEAR FROM t.date) = 2023
     AND (t.posted OR t.voided);
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Aborting: % posted-or-voided rows would be touched. Inspect manually.', bad_count;
  END IF;
END $$;

UPDATE public.transactions t
   SET date = (t.date + INTERVAL '1 year')::date
  FROM public.bank_statements s
 WHERE s.id = t.bank_statement_id
   AND s.file_name IN ('Dec-24.pdf', 'Reprint Oct-24.pdf')
   AND EXTRACT(YEAR FROM t.date) = 2023
   AND t.posted = false
   AND t.voided = false;


-- ── STAGE 3 — RECOMPUTE period_start / period_end (scoped) ─────────────
-- The original backfill wrote period_start/period_end from the wrong-year
-- transactions; this overwrite is INTENTIONAL and scoped to only these
-- two statements.

UPDATE public.bank_statements bs
   SET period_start = sub.min_date,
       period_end   = sub.max_date
  FROM (
    SELECT t.bank_statement_id,
           MIN(t.date) AS min_date,
           MAX(t.date) AS max_date
      FROM public.transactions t
     WHERE t.bank_statement_id IN (
       SELECT id FROM public.bank_statements
        WHERE file_name IN ('Dec-24.pdf', 'Reprint Oct-24.pdf')
     )
     GROUP BY t.bank_statement_id
  ) sub
 WHERE bs.id = sub.bank_statement_id;

COMMIT;


-- ── POST-CHECKS — run these and eyeball the output ─────────────────────
-- Both statements should now report period_start/period_end in 2024:
SELECT file_name, period_start, period_end
  FROM public.bank_statements
 WHERE file_name IN ('Dec-24.pdf', 'Reprint Oct-24.pdf')
 ORDER BY file_name;

-- Zero rows should remain dated 2023 for these statements:
SELECT s.file_name,
       COUNT(*) FILTER (WHERE EXTRACT(YEAR FROM t.date) = 2023) AS remaining_2023
  FROM public.transactions t
  JOIN public.bank_statements s ON s.id = t.bank_statement_id
 WHERE s.file_name IN ('Dec-24.pdf', 'Reprint Oct-24.pdf')
 GROUP BY s.file_name
 ORDER BY s.file_name;

-- Sanity — the statement_totals RPC should now match the SQL ground truth:
SELECT bank_statement_id, txn_count, debits, credits
  FROM public.statement_totals(ARRAY(
    SELECT id FROM public.bank_statements
     WHERE file_name IN ('Dec-24.pdf', 'Reprint Oct-24.pdf')
  ));

-- Expected end state:
--   • Dec-24.pdf:           132 / debits + credits = $115,782.46, all 2024.
--   • Reprint Oct-24.pdf:   192 / debits + credits = $106,212.83, all 2024.
--   • period chips display as 'Dec 2024' and 'Oct 2024' (or tight Oct range).
