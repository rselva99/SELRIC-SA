-- 2026-07-11 (c2)  Fallback / bridge row for the CPA-sourced period locks
-- (Fix 2 of the amortization side-effect remediation).
--
-- Companion to `2026-07-11-c-create-cpa-sourced-locks-and-lock-2024.sql`,
-- which creates the canonical `public.cpa_sourced_locks` table. That
-- migration cannot run through the app's normal deploy path — DDL has
-- to be applied via the Supabase SQL editor. Until the DDL lands, the
-- code in `src/lib/cpaLocks.js` reads the locks from THIS row instead:
-- a single reserved-name `categories` row whose `description` column
-- holds the same lock state as JSON.
--
-- Once 2026-07-11-c is applied and the same lock rows exist in the
-- table, this fallback row can be safely deleted — `listCpaLocks`
-- prefers the table when it's present.
--
-- Idempotent: UPDATE (no-op if row already carries the target JSON),
-- INSERT WHERE NOT EXISTS otherwise.

INSERT INTO public.categories (name, type, description, archived)
SELECT
  '__CPA_LOCKS__',
  'expense',                 -- reserved row; type is unused by anything but the CHECK constraint
  jsonb_build_object(
    '2024', jsonb_build_object(
      'depreciation',
        jsonb_build_object('note', 'CPA-sourced 2024 fixed-asset depreciation schedule ($7,082.90 total). Do not regenerate via depreciation.js.'),
      'amortization',
        jsonb_build_object('note', 'CPA-sourced 2024 Section 195 start-up amortization ($11,704.33 total, from L12B movement). Do not regenerate via depreciation.js.')
    )
  )::text,
  true                       -- archived so this row never appears in category pickers
WHERE NOT EXISTS (
  SELECT 1 FROM public.categories WHERE name = '__CPA_LOCKS__'
);

-- If the row exists but doesn't already carry a 2024 lock, extend it.
UPDATE public.categories
   SET description = jsonb_build_object(
     '2024', jsonb_build_object(
       'depreciation',
         jsonb_build_object('note', 'CPA-sourced 2024 fixed-asset depreciation schedule ($7,082.90 total). Do not regenerate via depreciation.js.'),
       'amortization',
         jsonb_build_object('note', 'CPA-sourced 2024 Section 195 start-up amortization ($11,704.33 total, from L12B movement). Do not regenerate via depreciation.js.')
     )
   )::text,
   archived = true
 WHERE name = '__CPA_LOCKS__'
   AND (description IS NULL
        OR description = ''
        OR description NOT LIKE '%2024%'
        OR description NOT LIKE '%depreciation%'
        OR description NOT LIKE '%amortization%');

DO $$
DECLARE
  n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM public.categories
   WHERE name = '__CPA_LOCKS__'
     AND archived = true
     AND description LIKE '%2024%'
     AND description LIKE '%depreciation%'
     AND description LIKE '%amortization%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Fallback CPA-lock row not seeded correctly (got %)', n;
  END IF;
END $$;
