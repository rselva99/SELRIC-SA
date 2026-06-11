-- 2026-06-11  Statement Import & Match (Accountant close checklist).
--
-- Adds the columns the new import-and-match flow needs onto the existing
-- bank_statements + transactions tables (additive, idempotent), ensures
-- the private bank-statements bucket exists, and gates every read/write
-- through public.is_admin().
--
-- Period format note: the user-facing convention is 'JAN-24' but every
-- existing table that carries a period (period_close, close_checklist,
-- report_deliverables) stores it as 'YYYY-MM'. To keep this column joinable
-- with those tables we store the same 'YYYY-MM' form here and let the UI
-- format it as 'JAN-24'. Cross-table consistency wins over the literal
-- string in the spec.
--
-- This script is safe to re-run. Every DDL uses IF NOT EXISTS / OR REPLACE.

-- ── 1. bank_statements: new columns ─────────────────────────────────────
ALTER TABLE public.bank_statements
  ADD COLUMN IF NOT EXISTS period           TEXT,
  ADD COLUMN IF NOT EXISTS file_path        TEXT,
  ADD COLUMN IF NOT EXISTS statement_totals JSONB,
  ADD COLUMN IF NOT EXISTS match_status     TEXT NOT NULL DEFAULT 'needs_matching';

-- CHECK constraint on match_status. Added once; ignored on re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bank_statements_match_status_check'
  ) THEN
    ALTER TABLE public.bank_statements
      ADD CONSTRAINT bank_statements_match_status_check
      CHECK (match_status IN ('needs_matching', 'matched', 'confirmed_manually'));
  END IF;
END $$;

-- Backfill the `period` text on existing rows from period_start where
-- available so the Accountant checklist can derive state from existing
-- imports. Idempotent: only fills NULL periods.
UPDATE public.bank_statements
   SET period = to_char(period_start, 'YYYY-MM')
 WHERE period IS NULL
   AND period_start IS NOT NULL;

-- Backfill file_path from file_url on rows that haven't been migrated. The
-- new flow writes both columns; this preserves access for older imports.
UPDATE public.bank_statements
   SET file_path = file_url
 WHERE file_path IS NULL
   AND file_url IS NOT NULL
   AND file_url <> '';

CREATE INDEX IF NOT EXISTS idx_bank_statements_period
  ON public.bank_statements (period);

CREATE INDEX IF NOT EXISTS idx_bank_statements_match_status
  ON public.bank_statements (match_status);


-- ── 2. transactions: new columns ────────────────────────────────────────
-- bank_statement_id already exists from earlier migrations; the IF NOT
-- EXISTS guard makes this safe to re-run without bouncing the column.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS bank_statement_id UUID REFERENCES public.bank_statements(id),
  ADD COLUMN IF NOT EXISTS verified          BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_transactions_bank_statement_id
  ON public.transactions (bank_statement_id);


-- ── 3. RLS on bank_statements ───────────────────────────────────────────
-- The table already has policies from earlier work, but we re-assert via
-- public.is_admin() to guarantee the spec's pattern. Replacing is safe
-- because is_admin() is the same shape RLS used before.
ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can CRUD bank_statements" ON public.bank_statements;
DROP POLICY IF EXISTS "Admins can CRUD bank_statements"              ON public.bank_statements;
DROP POLICY IF EXISTS "Admins manage bank_statements"                ON public.bank_statements;

CREATE POLICY "Admins manage bank_statements"
  ON public.bank_statements
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 4. Private storage bucket + policies on storage.objects ─────────────
-- Ensures the bank-statements bucket exists and is private. Storage
-- objects are admin-only via the three policies below; the bucket id
-- 'bank-statements' is the namespace.

INSERT INTO storage.buckets (id, name, public)
VALUES ('bank-statements', 'bank-statements', false)
ON CONFLICT (id) DO UPDATE
   SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Admins upload to bank-statements"   ON storage.objects;
DROP POLICY IF EXISTS "Admins read from bank-statements"   ON storage.objects;
DROP POLICY IF EXISTS "Admins delete from bank-statements" ON storage.objects;

CREATE POLICY "Admins upload to bank-statements"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'bank-statements' AND public.is_admin());

CREATE POLICY "Admins read from bank-statements"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'bank-statements' AND public.is_admin());

CREATE POLICY "Admins delete from bank-statements"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'bank-statements' AND public.is_admin());


-- ── 5. Checklist state ───────────────────────────────────────────────────
-- The three "import_statements" states (A=no statement, B=needs matching,
-- C=matched) are DERIVED in app code from bank_statements.match_status,
-- so no schema change is needed on close_checklist. The existing
-- close_checklist (period, step_key, status) is sufficient for the
-- per-step audit trail; the app reads bank_statements.match_status
-- directly to drive the row's UI state.
