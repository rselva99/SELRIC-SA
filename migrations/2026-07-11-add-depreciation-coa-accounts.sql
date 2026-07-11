-- 2026-07-11  Distinct depreciation Chart-of-Accounts entries.
--
-- Adds two new category rows so the 2024 CPA-sourced depreciation
-- correction (see companion migration 2026-07-11-2024-depreciation-
-- cpa-correction.sql) can post to depreciation-only accounts, keeping
-- amortization out of the same buckets:
--
--   Depreciation Expense           (type=expense, active)
--   Accumulated Depreciation       (type=asset,   active)     [contra by convention]
--
-- The pre-existing combined categories STAY put:
--
--   Depreciation & Amortization             (expense, active)  — historical journals
--   Accumulated Depreciation & Amortization (asset,   active)  — historical opening + accum
--
-- We do NOT retire, rename, or archive the combined accounts here:
-- pre-2024 journals (JE-OPENING, JE-CLOSE-2024) still reference them
-- and the app UI can still surface them if the user wants them. The
-- 2024 monthly journals posted by the correction migration will target
-- the new distinct accounts instead.
--
-- We DO NOT create an amortization account (out of scope — see
-- correction migration header).
--
-- Idempotent: uses WHERE NOT EXISTS guard on `name` (no unique index on
-- categories.name, so ON CONFLICT is not available here).

INSERT INTO public.categories (name, type, description, archived)
SELECT 'Depreciation Expense', 'expense',
       'Depreciation of fixed assets — per CPA tax depreciation schedule (2024 correction, migration 2026-07-11).',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE name = 'Depreciation Expense'
);

INSERT INTO public.categories (name, type, description, archived)
SELECT 'Accumulated Depreciation', 'asset',
       'Contra-asset — cumulative depreciation of fixed assets (2024 correction, migration 2026-07-11).',
       false
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE name = 'Accumulated Depreciation'
);

-- Assert both exist and are active before the correction migration relies on them.
DO $$
DECLARE
  n_expense INT;
  n_accum   INT;
BEGIN
  SELECT COUNT(*) INTO n_expense FROM public.categories
   WHERE name = 'Depreciation Expense' AND type = 'expense' AND archived = false;
  SELECT COUNT(*) INTO n_accum   FROM public.categories
   WHERE name = 'Accumulated Depreciation' AND type = 'asset' AND archived = false;
  IF n_expense <> 1 THEN
    RAISE EXCEPTION 'Depreciation Expense (active, type=expense) not found — got % rows', n_expense;
  END IF;
  IF n_accum <> 1 THEN
    RAISE EXCEPTION 'Accumulated Depreciation (active, type=asset) not found — got % rows', n_accum;
  END IF;
END $$;
