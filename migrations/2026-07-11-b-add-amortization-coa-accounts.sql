-- 2026-07-11 (b)  Distinct amortization Chart-of-Accounts entries.
--
-- Companion to `2026-07-11-add-depreciation-coa-accounts.sql`. Adds two
-- new category rows so the 2024 CPA-sourced amortization side-effect
-- remediation can post to amortization-only accounts (mirrors the split
-- already done for depreciation):
--
--   Amortization Expense        (type=expense, active)
--   Accumulated Amortization    (type=asset,   active)     [contra by convention]
--
-- Together with the existing distinct depreciation accounts, this gives
-- every future depreciation.js post a proper separated destination.
--
-- The pre-existing combined categories STAY put:
--
--   Depreciation & Amortization             (expense, active)  — historical
--   Accumulated Depreciation & Amortization (asset,   active)  — historical + JE-OPENING
--
-- No amort/dep account is deleted, renamed, or archived; historical JEs
-- (JE-OPENING and any prior-year entries) still reference them.
--
-- Idempotent: uses WHERE NOT EXISTS guard on `name` (no unique index on
-- categories.name in this schema).

INSERT INTO public.categories (name, type, description, archived)
SELECT 'Amortization Expense', 'expense',
       'Amortization of intangibles (Section 195 start-up costs, etc.) — added by migration 2026-07-11-b.',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE name = 'Amortization Expense'
);

INSERT INTO public.categories (name, type, description, archived)
SELECT 'Accumulated Amortization', 'asset',
       'Contra-asset — cumulative amortization of intangibles (added by migration 2026-07-11-b).',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE name = 'Accumulated Amortization'
);

DO $$
DECLARE
  n_exp INT;
  n_ac  INT;
BEGIN
  SELECT COUNT(*) INTO n_exp FROM public.categories
   WHERE name = 'Amortization Expense' AND type = 'expense' AND archived = false;
  SELECT COUNT(*) INTO n_ac  FROM public.categories
   WHERE name = 'Accumulated Amortization' AND type = 'asset' AND archived = false;
  IF n_exp <> 1 THEN
    RAISE EXCEPTION 'Amortization Expense (active, type=expense) not found — got % rows', n_exp;
  END IF;
  IF n_ac <> 1 THEN
    RAISE EXCEPTION 'Accumulated Amortization (active, type=asset) not found — got % rows', n_ac;
  END IF;
END $$;
