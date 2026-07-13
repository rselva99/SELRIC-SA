-- 2026-07-14 · Two new expense categories for the FY2024 Miscellaneous
-- reclassification pass. Idempotent — safe to run repeatedly.
--
-- BACKGROUND. The FY2024 Miscellaneous expense account holds $34,412.64
-- (DR $34,471.47, CR $58.83) across 364 posted, non-void rows. Owner
-- (J. Harris) and the reclass workflow assign every row to a proper
-- expense account. Two destinations required categories that did not
-- previously exist:
--
--   • Meals & Entertainment — business meals at third-party restaurants.
--     Subject to the 50% deduction limit under §274(n). The CPA applies
--     the limit at return prep; we book at 100% here so the raw activity
--     is captured accurately.
--
--   • Donations — charitable and political contributions. Political
--     contributions are NON-DEDUCTIBLE under §162(e). The CPA must
--     separate charitable (Schedule A / A K-1 pass-through) from
--     political and back the political portion out on the return.
--
-- TYPE CONVENTION. Existing rows in `categories.type` use singular
-- lowercase strings — `'asset'`, `'liability'`, `'equity'`, `'revenue'`,
-- `'expense'`. Both new rows follow that convention.
--
-- SCHEMA NOTE. `categories.name` has no unique constraint at DDL time
-- (verified against the applied migration history in this repo). To make
-- this file safely re-runnable, we guard each INSERT with WHERE NOT
-- EXISTS on the target name. If a manual UI insert has already added
-- either category, this migration is a no-op for that name.
--
-- SIDE-EFFECTS.
--   • aggregateForPnL (src/lib/finance.js) maps category names to types
--     via this table. Inserting these rows makes reclassed transactions
--     tagged with either name count as expense for P&L purposes.
--   • BookBalanceSheetPage / Reports auditor package pull categories
--     from this table too — the dropdown gains two new options.
--   • No transactions rows are modified by this migration. Row reclass
--     is a separate script step.

INSERT INTO public.categories (name, type, description, archived, created_at)
SELECT 'Meals & Entertainment',
       'expense',
       'Business meals at third-party restaurants. NOTE: subject to the 50% deduction limit under §274(n) — CPA to apply the limitation on the return.',
       FALSE,
       now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE name = 'Meals & Entertainment'
);

INSERT INTO public.categories (name, type, description, archived, created_at)
SELECT 'Donations',
       'expense',
       'Charitable and political contributions. NOTE: political contributions are NON-DEDUCTIBLE under §162(e) — CPA to back out on the return. Charitable pass through on the K-1s.',
       FALSE,
       now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE name = 'Donations'
);

-- Verification (informational):
--   SELECT name, type, archived
--     FROM public.categories
--    WHERE name IN ('Meals & Entertainment', 'Donations')
--    ORDER BY name;
--
--   Expected: 2 rows, both type='expense', archived=false.
