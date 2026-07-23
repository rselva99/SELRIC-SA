-- 2026-07-22 · Close scenarios — read-only presentation of proposed FY-close numbers
--
-- ═══════════════════════════════════════════════════════════════════════
-- ISOLATION CONTRACT
--
-- These tables are a PRESENTATION layer for scenario/proposed-close figures.
-- They do NOT modify any ledger table. Nothing here posts to `transactions`,
-- `journal_entries`, `journal_entry_lines`, `book_bs_lines`, `book_bs_line_adjustments`,
-- `book_bs_statements`, `checks`, `period_close`, or `assets`. The scenario tables
-- are a display cache populated from off-repo working papers (gitignored loader).
--
-- Every scenario row carries an evidence tier and source reference so the UI
-- can surface tier badges and hover-source labels for every line.
--
-- NO financial figures are stored in this migration. All numeric values are
-- loaded post-migration by a local gitignored loader.
--
-- IDEMPOTENCE. Every DDL is IF NOT EXISTS / CREATE OR REPLACE / DROP IF
-- EXISTS + CREATE. Re-running never double-creates.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. close_scenarios ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.close_scenarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  label             text NOT NULL,
  fiscal_year       integer NOT NULL,
  status            text NOT NULL DEFAULT 'PROPOSED_NOT_POSTED'
                    CHECK (status IN ('PROPOSED_NOT_POSTED','REVIEWED','SUPERSEDED')),
  generated_at      timestamptz NOT NULL DEFAULT now(),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_close_scenarios_slug ON public.close_scenarios(slug);

-- ── 2. close_scenario_lines ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.close_scenario_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id       uuid NOT NULL REFERENCES public.close_scenarios(id) ON DELETE CASCADE,
  statement         text NOT NULL CHECK (statement IN ('PL','BS','EQUITY','RESIDUAL','OPEN_ITEM')),
  section           text,
  line_label        text NOT NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  amount            numeric(14,2),
  evidence_tier     char(1) CHECK (evidence_tier IN ('A','B','C','D')),
  source_ref        text,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_close_scenario_lines_scenario ON public.close_scenario_lines(scenario_id);
CREATE INDEX IF NOT EXISTS idx_close_scenario_lines_statement ON public.close_scenario_lines(scenario_id, statement, sort_order);

-- ── 3. updated_at trigger for close_scenarios ──────────────────────────
CREATE OR REPLACE FUNCTION public.tg_close_scenarios_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS close_scenarios_touch ON public.close_scenarios;
CREATE TRIGGER close_scenarios_touch
BEFORE UPDATE ON public.close_scenarios
FOR EACH ROW EXECUTE FUNCTION public.tg_close_scenarios_touch();

-- ── 4. RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.close_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.close_scenario_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS close_scenarios_admin_select ON public.close_scenarios;
CREATE POLICY close_scenarios_admin_select ON public.close_scenarios
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS close_scenarios_admin_insert ON public.close_scenarios;
CREATE POLICY close_scenarios_admin_insert ON public.close_scenarios
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS close_scenarios_admin_update ON public.close_scenarios;
CREATE POLICY close_scenarios_admin_update ON public.close_scenarios
  FOR UPDATE USING (public.is_admin())
             WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS close_scenarios_admin_delete ON public.close_scenarios;
CREATE POLICY close_scenarios_admin_delete ON public.close_scenarios
  FOR DELETE USING (public.is_admin());

DROP POLICY IF EXISTS close_scenario_lines_admin_select ON public.close_scenario_lines;
CREATE POLICY close_scenario_lines_admin_select ON public.close_scenario_lines
  FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS close_scenario_lines_admin_insert ON public.close_scenario_lines;
CREATE POLICY close_scenario_lines_admin_insert ON public.close_scenario_lines
  FOR INSERT WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS close_scenario_lines_admin_update ON public.close_scenario_lines;
CREATE POLICY close_scenario_lines_admin_update ON public.close_scenario_lines
  FOR UPDATE USING (public.is_admin())
             WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS close_scenario_lines_admin_delete ON public.close_scenario_lines;
CREATE POLICY close_scenario_lines_admin_delete ON public.close_scenario_lines
  FOR DELETE USING (public.is_admin());

-- ── END ────────────────────────────────────────────────────────────────
-- No INSERTs. No figures. Schema only. Populated by a gitignored loader.
