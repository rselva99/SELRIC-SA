-- 2024 Taxes-category cleanup: 26 JP MO Rev Tax rows → Sales Tax Payable
-- (liability); 1 Card Purchase Stl 9311 row → Miscellaneous (expense). Four
-- "Bank Debit" rows (totaling $41,318.65) stay in Taxes — those are the
-- real tax expenses (payroll / FUTA / SUTA).
--
-- After reclass:
--   P&L Net Income:    $230,807.71   (was $122,704.91 — recovers Sales Tax that
--                                     never belonged in expense)
--   Allocation base:   $214,018.53   ( = NI − $16,789.18 depreciation gap )
--   L21 NI allocations (sum):       $214,018.53
--   RE plug:                       -$357,324.30
--   A + L + E structural gap:               $0.00
-- Generated: 2026-06-18

-- ── Step 2: ensure Sales Tax Payable and Miscellaneous categories exist ────
INSERT INTO public.categories (name, type)
SELECT 'Sales Tax Payable', 'liability'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Sales Tax Payable');

-- (Miscellaneous already exists; no insert needed.)

-- ── Step 3: Reclassify Group A (JP MO Rev Tax) → Sales Tax Payable ─────────
UPDATE public.transactions
SET category = 'Sales Tax Payable'
WHERE category ILIKE '%tax%'
  AND (description ILIKE '%JP MO%' OR description ILIKE '%MO Rev%')
  AND date >= '2024-01-01' AND date <= '2024-12-31';

-- ── Step 4: Reclassify Group B (Card Purchase Stl 9311) → Miscellaneous ────
UPDATE public.transactions
SET category = 'Miscellaneous'
WHERE category ILIKE '%tax%'
  AND (description ILIKE '%9311%' OR description ILIKE '%800-2689%')
  AND date >= '2024-01-01' AND date <= '2024-12-31';

-- ── Step 8: Replace L21 NI allocations at $214,018.53 basis ────────────────
DELETE FROM public.book_bs_line_adjustments
WHERE note ILIKE '%2024 Net Income Allocation%';

INSERT INTO public.book_bs_line_adjustments (line_id, amount, note, created_by) VALUES
  ('08fca07a-e489-4c46-be2a-7ffc883f5c9c'::uuid,  90957.88, '2024 Net Income Allocation — 42.5%', NULL),  -- DW Clayton
  ('663a5153-6f54-4b5d-94f8-5dc562e1de54'::uuid,  16051.39, '2024 Net Income Allocation — 7.5%',  NULL),  -- Dan Miles
  ('410db521-d568-456a-b81e-a28073c426d0'::uuid,  46013.98, '2024 Net Income Allocation — 21.5%', NULL),  -- J. Harris
  ('ded56137-7a43-4fdb-b4fe-66fda4d8ec5f'::uuid,  14981.30, '2024 Net Income Allocation — 7%',    NULL),  -- Travis Ford
  ('282d4d95-eb0e-4c0b-b393-321fb310b38e'::uuid,  46013.98, '2024 Net Income Allocation — 21.5%', NULL); -- S. Sanders

-- ── Step 10 (executed before Step 9): clear confirmed on 6 L21 lines ──────
-- Required so Step 9 measures the post-allocation gap rather than reading
-- stale ending_balance_confirmed values.
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
    'Member Investment — S. Sanders',
    'Retained Earnings'
  );

-- ── Step 9: update RE plug to close the structural gap ────────────────────
UPDATE public.book_bs_line_adjustments
SET amount = -357324.30
WHERE note = '2024 Year-End Structural Close — pending CPA final allocation';

-- ── Post-run verification (executed at write time):
--   Section subtotals (Book BS Builder formula):
--     L01    +    2,857.00  asset       L15    -    5,063.00  liability
--     L03    +   26,411.57  asset       L17    -    2,016.90  liability
--     L09A   +  823,420.89  asset       L20A   -  351,778.81  liability
--     L09B   -  633,941.29  asset(C)    L20B   +        0.00  liability
--     L12A   +  175,564.72  asset       L21    +   24,658.77  equity
--     L12B   -   35,112.95  asset(C)    M202   -   25,000.00  equity
--                                       M206A  +        0.00  equity
--     Total Assets:        $359,199.94
--     Total Liabilities:  -$358,858.71
--     Total Equity:          -$341.23
--     A + L + E:                $0.00   ← closes exactly
--
--   Remaining Taxes entries (Group C — Bank Debit only):
--     2024-01-16  -$5,010.00   Bank Debit
--     2024-12-13  -$15,010.00  Bank Debit
--     2024-12-23  -$9,288.65   Bank Debit
--     2024-12-30  -$12,010.00  Bank Debit
--     Taxes line total:  $41,318.65
