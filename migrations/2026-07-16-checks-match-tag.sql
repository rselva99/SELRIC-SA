-- 2026-07-16 · Additive `match_tag` column on `checks` for supplier-match tagging
--
-- ═══════════════════════════════════════════════════════════════════════
-- ISOLATION CONTRACT
--
-- Adds ONE nullable text column to `public.checks`. Touches nothing else.
-- Zero writes to `transactions`, `journal_entries`, `journal_entry_lines`,
-- `book_bs_lines`, or any other pre-existing table.
--
-- PURPOSE
--
-- The Cash Management tab surfaces a "Lohr (N)" filter chip so the user
-- can zero in on all checks matched to the Lohr supplier statement and
-- bulk-classify them to Liquor in one action. That match set lives only
-- in `docs/LOHR_MATCH.csv` — the app can't see it. This column gives the
-- match a durable, queryable home on the row.
--
-- Values used so far: 'LOHR'. Future supplier statements would use
-- 'SYSCO', 'BREAKTHRU', etc. The column is a free-text tag by design so
-- no code change is needed for a new supplier — just tag the rows and
-- add a filter chip.
--
-- IDEMPOTENCE. IF NOT EXISTS on both the column add and the index. A
-- second run is a no-op. Safe to include in the standing migration set.
--
-- FALLBACK. If this migration is not yet applied when the tagging script
-- runs, the script writes '[LOHR] ' as a prefix into `checks.notes`
-- instead. The UI recognises either form, so the feature ships either
-- way; running this migration is the cleaner path.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.checks
  ADD COLUMN IF NOT EXISTS match_tag text;

CREATE INDEX IF NOT EXISTS ix_checks_match_tag
  ON public.checks (match_tag)
  WHERE match_tag IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE
    'match_tag column ready on public.checks. Existing rows: match_tag = NULL. '
    'Tagging is performed by the LOHR tag script (or future supplier scripts) — '
    'this migration adds the column only.';
END $$;
