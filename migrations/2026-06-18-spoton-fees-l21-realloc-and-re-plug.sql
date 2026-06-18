-- SpotOn financing fees + Sales Tax Payable category (created but unused —
-- no non-bank JP MO Rev Tax entries existed in 2024) + L21 NI allocations
-- recomputed against the post-correction P&L net income of $122,704.91 and
-- depreciation-gap-adjusted allocation base of $105,915.73 + RE plug updated
-- to close the structural gap.
-- Generated: 2026-06-18
--
-- Resulting state (verified after run):
--   P&L Net Income:               $122,704.91
--     Total Revenue:             $1,733,190.26
--     Total Expenses:            $1,610,485.35   (includes new Financing Fees)
--     Financing Fees line:          $28,640.27   ($14,688.00 + $13,952.27)
--   Allocation base:                $105,915.73   ( = $122,704.91 − $16,789.18 deprec gap )
--   L21 NI allocations (sum):       $105,915.73
--   RE plug:                       -$249,221.50
--   A + L + E structural gap:               $0.00

-- ── Step 2: create Financing Fees expense category (idempotent) ─────────────
INSERT INTO public.categories (name, type)
SELECT 'Financing Fees', 'expense'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Financing Fees');

-- ── Step 3: SpotOn financing fee transactions (idempotent via reference) ────
INSERT INTO public.transactions
  (date, description, supplier, amount, type, category, account_id, reference, bank_statement_id, journal_entry_id, posted, voided)
SELECT '2024-01-31', 'SpotOn Capital Round 1 — financing fee (16% on $91,800 advance)', 'SpotOn Capital',
       14688.00, 'debit', 'Financing Fees', NULL, 'MANUAL-SPOTON-FEE-2024-01', NULL, NULL, true, false
WHERE NOT EXISTS (SELECT 1 FROM public.transactions WHERE reference = 'MANUAL-SPOTON-FEE-2024-01');

INSERT INTO public.transactions
  (date, description, supplier, amount, type, category, account_id, reference, bank_statement_id, journal_entry_id, posted, voided)
SELECT '2024-08-31', 'SpotOn Capital Round 2 — financing fee (16% on $87,201.66 advance)', 'SpotOn Capital',
       13952.27, 'debit', 'Financing Fees', NULL, 'MANUAL-SPOTON-FEE-2024-08', NULL, NULL, true, false
WHERE NOT EXISTS (SELECT 1 FROM public.transactions WHERE reference = 'MANUAL-SPOTON-FEE-2024-08');

-- ── Step 5: create Sales Tax Payable liability category (idempotent) ────────
-- Step 4 found 26 JP MO Rev Tax matches in 2024, all bank-imported (Group A
-- → stay in Taxes per spec). 0 non-bank rows existed, so Step 6 was a no-op.
-- The category is still created for future use.
INSERT INTO public.categories (name, type)
SELECT 'Sales Tax Payable', 'liability'
WHERE NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Sales Tax Payable');

-- ── Step 9: replace L21 NI allocation adjustments at $105,915.73 basis ──────
DELETE FROM public.book_bs_line_adjustments
WHERE note ILIKE '%2024 Net Income Allocation%';

INSERT INTO public.book_bs_line_adjustments (line_id, amount, note, created_by) VALUES
  ('08fca07a-e489-4c46-be2a-7ffc883f5c9c'::uuid,  45014.19, '2024 Net Income Allocation — 42.5%', NULL),  -- DW Clayton
  ('663a5153-6f54-4b5d-94f8-5dc562e1de54'::uuid,   7943.68, '2024 Net Income Allocation — 7.5%',  NULL),  -- Dan Miles
  ('410db521-d568-456a-b81e-a28073c426d0'::uuid,  22771.88, '2024 Net Income Allocation — 21.5%', NULL),  -- J. Harris
  ('ded56137-7a43-4fdb-b4fe-66fda4d8ec5f'::uuid,   7414.10, '2024 Net Income Allocation — 7%',    NULL),  -- Travis Ford
  ('282d4d95-eb0e-4c0b-b393-321fb310b38e'::uuid,  22771.88, '2024 Net Income Allocation — 21.5%', NULL); -- S. Sanders

-- ── Step 10: update RE plug to close the structural gap ────────────────────
UPDATE public.book_bs_line_adjustments
SET amount = -249221.50
WHERE note = '2024 Year-End Structural Close — pending CPA final allocation';

-- ── Step 11: clear confirmed values on 6 affected L21 lines ────────────────
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

-- ── Post-run verification (executed at write time):
--   Section subtotals (Book BS Builder formula):
--     L01    +    2,857.00  asset       L15    -    5,063.00  liability
--     L03    +   26,411.57  asset       L17    -    2,016.90  liability
--     L09A   +  823,420.89  asset       L20A   -  351,778.81  liability
--     L09B   -  633,941.29  asset(C)    L20B   +        0.00  liability
--     L12A   +  175,564.72  asset       L21    +   24,658.77  equity
--     L12B   -   35,112.95  asset(C)    M202   -   25,000.00  equity
--                                       M206A  +        0.00  equity
--
--     Total Assets:        $359,199.94
--     Total Liabilities:  -$358,858.71
--     Total Equity:          -$341.23
--     A + L + E:                $0.00   ← closes exactly
