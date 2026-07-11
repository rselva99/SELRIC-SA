-- 2026-07-11 (e)  Purge stale book_bs_line_adjustments on 2024 L09B.
--
-- Motivation. The 2024 L09B "Accumulated Depreciation" line carries four
-- adjustment rows that were used to reason about the pre-CPA 2024 close:
--
--   -11,704.31  "2024 amortization (Start-Up Costs $175,564.72 ÷ 180 months)"
--   -24,527.87  "2024 amortization (Start-Up Costs $175,564.72 ÷ 180 months)"
--   +36,232.18  "To correct labeling, will book"
--   -36,232.18  "Est. 2024 depreciation based on 2023 actual — pending CPA 2024 schedule"
--
-- They net to -36,232.18 but the Book BS Builder ignores them entirely
-- because ending_balance_confirmed on this line is set to -604,792.01
-- (the confirmed value overrides any beginning + adjustments math).
--
-- Deleting them therefore MUST NOT move the rendered L09B ending — that
-- invariant is asserted below. If the assertion fails, the builder was
-- unexpectedly folding these rows in and the delete would silently move
-- the balance sheet; the DO block ROLLS BACK in that case.
--
-- Idempotent: DELETE with a WHERE ... AND note = ... clause. Re-running
-- after the rows are gone is a no-op.

BEGIN;

-- Capture BEFORE state (informational only — printed on migration re-run
-- to keep an audit trail in the SQL editor output).
DO $$
DECLARE
  net_before numeric(14,2);
  n_before   int;
  end_before numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(a.amount), 0), COUNT(*)
    INTO net_before, n_before
    FROM public.book_bs_line_adjustments a
    JOIN public.book_bs_lines l ON l.id = a.line_id
   WHERE l.year = 2024 AND l.section_code = 'L09B' AND l.title = 'Accumulated Depreciation';
  SELECT ending_balance_confirmed INTO end_before
    FROM public.book_bs_lines
   WHERE year = 2024 AND section_code = 'L09B' AND title = 'Accumulated Depreciation';
  RAISE NOTICE 'L09B/2024 orphan-adj BEFORE: % rows netting %  |  ending_balance_confirmed %', n_before, net_before, end_before;
END $$;

-- Delete the 4 stale adjustment rows on 2024 L09B.
DELETE FROM public.book_bs_line_adjustments
 WHERE line_id IN (
   SELECT id FROM public.book_bs_lines
    WHERE year = 2024 AND section_code = 'L09B' AND title = 'Accumulated Depreciation'
 )
   AND note IN (
     '2024 amortization (Start-Up Costs $175,564.72 ÷ 180 months)',
     'To correct labeling, will book',
     'Est. 2024 depreciation based on 2023 actual — pending CPA 2024 schedule'
   );

-- Assert: 0 adjustment rows remain, and L09B ending is UNCHANGED (proves
-- the builder was ignoring them).
DO $$
DECLARE
  n_after int;
  end_after numeric(14,2);
BEGIN
  SELECT COUNT(*) INTO n_after
    FROM public.book_bs_line_adjustments a
    JOIN public.book_bs_lines l ON l.id = a.line_id
   WHERE l.year = 2024 AND l.section_code = 'L09B' AND l.title = 'Accumulated Depreciation';
  IF n_after <> 0 THEN
    RAISE EXCEPTION 'Purge left % rows behind on 2024 L09B — investigate before proceeding', n_after;
  END IF;

  SELECT ending_balance_confirmed INTO end_after
    FROM public.book_bs_lines
   WHERE year = 2024 AND section_code = 'L09B' AND title = 'Accumulated Depreciation';
  IF end_after <> -604792.01 THEN
    RAISE EXCEPTION 'L09B moved after purge: ending_balance_confirmed = % (expected -604,792.01) — ROLLING BACK', end_after;
  END IF;

  RAISE NOTICE 'L09B/2024 orphan-adj AFTER: 0 rows | ending_balance_confirmed % (unchanged)', end_after;
END $$;

COMMIT;
