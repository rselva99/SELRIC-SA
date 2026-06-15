-- 2026-06-15  Book Balance Sheet Builder — Stage 1 schema.
--
-- Five tables that capture the firm's book-structured balance sheet:
--
--   book_bs_lines               — one row per (year, section_code, title) line
--   book_bs_line_mappings       — line → CoA category roll-in (1:many)
--   book_bs_line_adjustments    — manual signed adjustments per line, each with a note
--   book_bs_line_txns           — RESERVED for Stage 5 (per-transaction picker).
--                                 Created now so we don't migrate twice; not yet
--                                 used by the app.
--   book_bs_statements          — one row per locked / official year statement
--
-- All admin-only via public.is_admin() — the same RLS pattern used by
-- bank_statements and the close tables (see migrations/README.md).
--
-- The Stage-1 app code only reads from book_bs_lines and writes seeded rows
-- when the user clicks "Add Year". The other tables are created here so the
-- schema is complete and Stages 2–5 don't require further migrations.

-- ── 1. book_bs_lines ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.book_bs_lines (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year                     INTEGER NOT NULL,
  section_code             TEXT NOT NULL,
  title                    TEXT NOT NULL,
  display_order            INTEGER NOT NULL DEFAULT 0,
  beginning_balance        NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ending_balance_confirmed NUMERIC(14, 2),
  confirmed_by             UUID REFERENCES auth.users(id),
  confirmed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS book_bs_lines_year_section_title_uq
  ON public.book_bs_lines (year, section_code, lower(title));
CREATE INDEX IF NOT EXISTS book_bs_lines_year_idx
  ON public.book_bs_lines (year);

ALTER TABLE public.book_bs_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage book_bs_lines" ON public.book_bs_lines;
CREATE POLICY "Admins manage book_bs_lines"
  ON public.book_bs_lines
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 2. book_bs_line_mappings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.book_bs_line_mappings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id         UUID NOT NULL REFERENCES public.book_bs_lines(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES public.categories(id)    ON DELETE CASCADE,
  category_name   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS book_bs_line_mappings_uq
  ON public.book_bs_line_mappings (line_id, category_id);
CREATE INDEX IF NOT EXISTS book_bs_line_mappings_line_idx
  ON public.book_bs_line_mappings (line_id);

ALTER TABLE public.book_bs_line_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage book_bs_line_mappings" ON public.book_bs_line_mappings;
CREATE POLICY "Admins manage book_bs_line_mappings"
  ON public.book_bs_line_mappings
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 3. book_bs_line_adjustments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.book_bs_line_adjustments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id     UUID NOT NULL REFERENCES public.book_bs_lines(id) ON DELETE CASCADE,
  amount      NUMERIC(14, 2) NOT NULL,
  note        TEXT NOT NULL,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_bs_line_adjustments_line_idx
  ON public.book_bs_line_adjustments (line_id);

ALTER TABLE public.book_bs_line_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage book_bs_line_adjustments" ON public.book_bs_line_adjustments;
CREATE POLICY "Admins manage book_bs_line_adjustments"
  ON public.book_bs_line_adjustments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 4. book_bs_line_txns  (RESERVED FOR STAGE 5) ─────────────────────────
-- Created now to avoid a second migration when the per-transaction picker
-- ships. The Stage-1 app does not read or write this table.
CREATE TABLE IF NOT EXISTS public.book_bs_line_txns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id         UUID NOT NULL REFERENCES public.book_bs_lines(id) ON DELETE CASCADE,
  transaction_id  UUID NOT NULL REFERENCES public.transactions(id)  ON DELETE CASCADE,
  include         BOOLEAN NOT NULL DEFAULT true,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS book_bs_line_txns_uq
  ON public.book_bs_line_txns (line_id, transaction_id);
CREATE INDEX IF NOT EXISTS book_bs_line_txns_line_idx
  ON public.book_bs_line_txns (line_id);

ALTER TABLE public.book_bs_line_txns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage book_bs_line_txns" ON public.book_bs_line_txns;
CREATE POLICY "Admins manage book_bs_line_txns"
  ON public.book_bs_line_txns
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 5. book_bs_statements ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.book_bs_statements (
  year        INTEGER PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'locked')),
  locked_by   UUID REFERENCES auth.users(id),
  locked_at   TIMESTAMPTZ,
  snapshot    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.book_bs_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins manage book_bs_statements" ON public.book_bs_statements;
CREATE POLICY "Admins manage book_bs_statements"
  ON public.book_bs_statements
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- DONE.
