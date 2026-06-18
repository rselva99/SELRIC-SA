-- 2024 L21 partner allocations corrected from $151,294.37 basis to the
-- $134,505.19 net-income basis (after full $36,232.18 of depreciation), plus
-- a name fix renaming S. Harris -> S. Sanders across the partner-specific
-- lines in L21, M202, and M206A.
-- Generated: 2026-06-18
--
-- Net effect on the Book BS Builder:
--   L21 sum: $319,258.91 -> $24,658.77
--   Retained Earnings adjustment: -$289,863.59 -> -$277,810.96
--   A + L + E gap: $289,863.59 -> $0.00  (verified after execution)
--
-- ── Step 2: Delete prior NI allocations ─────────────────────────────────
DELETE FROM public.book_bs_line_adjustments
WHERE note ILIKE '%2024 Net Income Allocation%';

-- ── Step 3: Insert corrected $134,505.19 allocations on L21 partner lines
INSERT INTO public.book_bs_line_adjustments (line_id, amount, note, created_by) VALUES
  ('08fca07a-e489-4c46-be2a-7ffc883f5c9c'::uuid,  57164.70, '2024 Net Income Allocation — 42.5%', NULL),
  ('663a5153-6f54-4b5d-94f8-5dc562e1de54'::uuid,  10087.89, '2024 Net Income Allocation — 7.5%',  NULL),
  ('410db521-d568-456a-b81e-a28073c426d0'::uuid,  28918.62, '2024 Net Income Allocation — 21.5%', NULL),
  ('ded56137-7a43-4fdb-b4fe-66fda4d8ec5f'::uuid,   9415.36, '2024 Net Income Allocation — 7%',    NULL),
  ('282d4d95-eb0e-4c0b-b393-321fb310b38e'::uuid,  28918.62, '2024 Net Income Allocation — 21.5%', NULL);

-- ── Step 4: Update the Retained Earnings structural-close plug to bring
--    A + L + E to 0 given the new (smaller) L21 partner allocations.
UPDATE public.book_bs_line_adjustments
SET amount = -277810.96
WHERE note = '2024 Year-End Structural Close — pending CPA final allocation';

-- ── Step 5: Clear confirmed values on the 6 affected L21 lines so the
--    Book BS Builder recomputes from beginning + adjustments.
UPDATE public.book_bs_lines
SET ending_balance_confirmed = NULL,
    confirmed_at = NULL,
    confirmed_by = NULL
WHERE year = 2024
  AND title IN (
    'Member Investment — DW Clayton',
    'Member Investment — Dan Miles',
    'Member Investment — J. Harris',
    'Member Investment — Travis Ford',
    'Member Investment — S. Harris',
    'Retained Earnings'
  );

-- ── Step 6: Rename S. Harris → S. Sanders across L21, M202, M206A.
--    Filters by title only (matches every year that has this line).
UPDATE public.book_bs_lines
SET title = 'Member Investment — S. Sanders'
WHERE title = 'Member Investment — S. Harris';

UPDATE public.book_bs_lines
SET title = 'Member Contributions — S. Sanders'
WHERE title = 'Member Contributions — S. Harris';

UPDATE public.book_bs_lines
SET title = 'Member Draw — S. Sanders'
WHERE title = 'Member Draw — S. Harris';

-- ── Post-run verification (executed at write time on 2026-06-18):
--   L21 partner ending balances (computed = beginning + Σ adjustments):
--     DW Clayton:   -$112,456.16   (= -169,620.86 + 57,164.70)
--     Dan Miles:      $10,087.89   (= 0 + 10,087.89)
--     J. Harris:     $201,074.82   (= 172,156.20 + 28,918.62)
--     Travis Ford:     $2,687.36   (= -6,728.00 + 9,415.36)
--     S. Sanders:    $201,075.82   (= 172,157.20 + 28,918.62)
--     Retained Earnings:  -$277,810.96   (= 0 + -277,810.96)
--     L21 sum:        $24,658.77
--
--   Section totals:
--     Total Assets:        $359,199.94
--     Total Liabilities:  -$358,858.71
--     Total Equity:           -$341.23
--     A + L + E:                $0.00   ← closes exactly
