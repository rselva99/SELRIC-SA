-- 2026-06-16  Book Balance Sheet Builder — asset-register mappings.
--
-- Adds one new table that lets each book_bs_lines row pull GROSS COST from
-- the fixed-asset register (public.assets) for L09A / L12A asset cost
-- lines. The contra lines L09B / L12B do NOT need their own mappings; the
-- app derives an INFORMATIONAL straight-line accumulated-depreciation
-- reference figure from the union of their cost-section's mappings.
--
-- One mapping row = one rule for one line:
--   scope='class'  → include every asset whose asset_class = asset_class
--   scope='asset'  → include just one specific asset (by id)
-- The `exclude` flag turns either form into a subtraction so a line can be
-- "all of class X minus this one asset" or "all of class X plus this one
-- asset from a different class".
--
-- The activity contribution computed by the app stays activity-driven:
--   activity_from_register(line, year) =
--      Σ asset.cost  where asset is in scope AND included at EOY(year)
--    − Σ asset.cost  where asset is in scope AND was included at EOY(year-1)
--
-- This file ONLY adds the new table. It does NOT touch:
--   • public.assets
--   • public.book_bs_lines / book_bs_line_mappings / book_bs_line_adjustments
--   • public.book_bs_line_txns (Stage-5 reserved)
--   • public.book_bs_statements (Stage-4 lock)
-- and changes nothing about the ledger, posting, CoA-category mapping, the
-- Stage-3 roll-forward flow, or the Stage-4 lock/snapshot.

-- ── Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.book_bs_line_asset_mappings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id      UUID NOT NULL REFERENCES public.book_bs_lines(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('class','asset')),
  asset_class  TEXT NULL,
  asset_id     UUID NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  exclude      BOOLEAN NOT NULL DEFAULT false,
  note         TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Exactly one of (asset_class, asset_id) must be set, matching the scope.
  CONSTRAINT book_bs_line_asset_mappings_scope_shape CHECK (
    (scope = 'class' AND asset_class IS NOT NULL AND asset_id    IS NULL)
    OR
    (scope = 'asset' AND asset_id    IS NOT NULL AND asset_class IS NULL)
  )
);

-- Look-up by line is the only hot path.
CREATE INDEX IF NOT EXISTS book_bs_line_asset_mappings_line_idx
  ON public.book_bs_line_asset_mappings (line_id);

-- Uniqueness — partial indexes so each (line_id, asset_class) and each
-- (line_id, asset_id) can only appear once. Include + exclude rows for the
-- same target are still possible if needed because `exclude` is part of
-- the row identity at the application level, but the duplicate-mapping
-- shape we actually care to block (two rows mapping the same target with
-- the same direction) is what would create double-counting; the partial
-- unique indexes catch that.
CREATE UNIQUE INDEX IF NOT EXISTS book_bs_line_asset_mappings_class_uq
  ON public.book_bs_line_asset_mappings (line_id, asset_class, exclude)
  WHERE scope = 'class';

CREATE UNIQUE INDEX IF NOT EXISTS book_bs_line_asset_mappings_asset_uq
  ON public.book_bs_line_asset_mappings (line_id, asset_id, exclude)
  WHERE scope = 'asset';

-- ── RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.book_bs_line_asset_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage book_bs_line_asset_mappings"
  ON public.book_bs_line_asset_mappings;

CREATE POLICY "Admins manage book_bs_line_asset_mappings"
  ON public.book_bs_line_asset_mappings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- DONE. Run this in the Supabase SQL Editor, then ping back so the app
-- code can land.
