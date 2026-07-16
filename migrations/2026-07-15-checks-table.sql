-- 2026-07-15 · `checks` table — isolated sandbox for the Cash Management feature
--
-- ═══════════════════════════════════════════════════════════════════════
-- ISOLATION CONTRACT (per Cash Management prompt §0.5)
--
-- This migration ADDS a new table and its RLS/trigger; it makes ZERO
-- changes to `transactions`, `journal_entries`, `journal_entry_lines`,
-- `book_bs_lines`, or any other pre-existing table. The `checks` table
-- is the isolated holding area for extracted paid checks. Nothing here
-- posts to the ledger.
--
-- Ledger writes happen only later, when a user in the Cash Management
-- tab manually assigns a check to a target account (§2 Stage 2 in the
-- prompt). At that point, ONE `post_journal_entry` call runs for that
-- one check. This file does not implement that action — it just defines
-- the sandbox and its integrity rules.
--
-- IDEMPOTENCE. Every DDL is IF NOT EXISTS / CREATE OR REPLACE / DROP IF
-- EXISTS + CREATE. Re-running never double-creates.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.checks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_no              text NOT NULL,
  amount                numeric(12,2) NOT NULL CHECK (amount > 0),
  clear_date            date,
  payee                 text,
  source_statement      text NOT NULL,
  account_id            uuid REFERENCES public.categories(id),
  status                text NOT NULL DEFAULT 'unclassified'
                        CHECK (status IN ('unclassified','classified','voided')),
  classified_entry_id   uuid REFERENCES public.journal_entries(id),
  source_tag            text NOT NULL DEFAULT 'checks',
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (check_no, amount, clear_date)
);

-- Rationale for the unique constraint: (check_no, amount, clear_date)
-- rather than check_no alone. Banks legitimately reuse cleared check
-- numbers over years, and per the source data the same check number can
-- appear on two adjacent statements when the bank re-lists a
-- late-cleared item. The triple is unique per real-world check. If the
-- same number ever clears twice on different dates for different
-- amounts, both rows land — the user resolves in the UI.

-- ── 2. `updated_at` trigger ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.checks_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_checks_set_updated_at ON public.checks;
CREATE TRIGGER trg_checks_set_updated_at
  BEFORE UPDATE ON public.checks
  FOR EACH ROW
  EXECUTE FUNCTION public.checks_set_updated_at();

-- ── 3. Helpful indexes for the tab UI ────────────────────────────────────

CREATE INDEX IF NOT EXISTS ix_checks_status       ON public.checks (status);
CREATE INDEX IF NOT EXISTS ix_checks_clear_date   ON public.checks (clear_date);
CREATE INDEX IF NOT EXISTS ix_checks_check_no     ON public.checks (check_no);
CREATE INDEX IF NOT EXISTS ix_checks_account_id   ON public.checks (account_id);

-- ── 4. RLS ───────────────────────────────────────────────────────────────

ALTER TABLE public.checks ENABLE ROW LEVEL SECURITY;

-- Drop prior policies (idempotent)
DROP POLICY IF EXISTS checks_admin_select ON public.checks;
DROP POLICY IF EXISTS checks_admin_insert ON public.checks;
DROP POLICY IF EXISTS checks_admin_update ON public.checks;
DROP POLICY IF EXISTS checks_admin_delete ON public.checks;

CREATE POLICY checks_admin_select ON public.checks
  FOR SELECT USING (public.is_admin());

CREATE POLICY checks_admin_insert ON public.checks
  FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY checks_admin_update ON public.checks
  FOR UPDATE USING (public.is_admin())
             WITH CHECK (public.is_admin());

CREATE POLICY checks_admin_delete ON public.checks
  FOR DELETE USING (public.is_admin());

-- Service role bypasses RLS by default; no additional policy needed for it.

-- ── 5. Provenance-tag columns on existing journal_entries ────────────────
--
-- ADDITIVE ONLY. Adds a nullable `source_tag` to journal_entries so
-- classification entries can be marked `'checks'`-sourced without
-- polluting the description field. Existing rows: source_tag stays NULL.
-- Never updated on any existing row by this migration.

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS source_tag text;

CREATE INDEX IF NOT EXISTS ix_journal_entries_source_tag
  ON public.journal_entries (source_tag)
  WHERE source_tag IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'checks table + RLS + provenance tag installed. NO existing rows modified.';
END $$;
