-- 2026-07-11 (c)  CPA-sourced period lock: prevents depreciation.js from
-- silently overwriting a CPA-set schedule.
--
-- Motivation. `src/lib/depreciation.js generateDepreciationThrough` posts
-- monthly straight-line D&A for every asset. Running it with `replace=true`
-- would wipe and re-post the 2024 CPA-sourced schedule ($7,082.90/yr for
-- depreciation + $11,704.33/yr for amortization) with the wrong straight-
-- line combined figure (~$4,860.75/month). This table lets us mark a
-- (year, kind) pair as CPA-sourced so the generator refuses.
--
-- Design
--   • Grain: one row per (year, kind). kind ∈ {'depreciation','amortization'}.
--     Separate rows so depreciation and amortization can be locked
--     independently (matching the fact they now post to separate accounts).
--   • Admin-only via RLS (uses public.is_admin(), same pattern as other
--     financial tables).
--   • Unlocking is reversible by an admin — but never automatic. There is
--     no trigger or code path that inserts / deletes rows here except
--     explicit admin action or a migration.
--
-- Seed. 2024 is locked for BOTH kinds by this migration (per the ongoing
-- CPA-sourced correction). If you ever need to re-run depreciation.js
-- against 2024, DELETE the relevant row(s) first via the Accountant page
-- or a new migration — do not comment out the check in code.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, WHERE NOT EXISTS on the 2024 rows.

CREATE TABLE IF NOT EXISTS public.cpa_sourced_locks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year        INTEGER NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('depreciation', 'amortization')),
  note        TEXT    NOT NULL DEFAULT '',
  locked_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  locked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (year, kind)
);

CREATE INDEX IF NOT EXISTS cpa_sourced_locks_year_idx
  ON public.cpa_sourced_locks (year);

ALTER TABLE public.cpa_sourced_locks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage cpa_sourced_locks" ON public.cpa_sourced_locks;
CREATE POLICY "Admins manage cpa_sourced_locks"
  ON public.cpa_sourced_locks
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Seed the 2024 locks (idempotent via WHERE NOT EXISTS).
INSERT INTO public.cpa_sourced_locks (year, kind, note)
SELECT 2024, 'depreciation',
       'CPA-sourced 2024 fixed-asset depreciation schedule ($7,082.90 total). Do not regenerate via depreciation.js.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cpa_sourced_locks WHERE year = 2024 AND kind = 'depreciation'
);

INSERT INTO public.cpa_sourced_locks (year, kind, note)
SELECT 2024, 'amortization',
       'CPA-sourced 2024 Section 195 start-up amortization ($11,704.33 total, from L12B movement). Do not regenerate via depreciation.js.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.cpa_sourced_locks WHERE year = 2024 AND kind = 'amortization'
);

DO $$
DECLARE
  n_locks INT;
BEGIN
  SELECT COUNT(*) INTO n_locks FROM public.cpa_sourced_locks
   WHERE year = 2024 AND kind IN ('depreciation','amortization');
  IF n_locks <> 2 THEN
    RAISE EXCEPTION 'Expected 2 CPA locks for 2024, got %', n_locks;
  END IF;
END $$;
