-- ============================================================================
-- SelRic SA — Accountant module migration
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor. Idempotent: safe to re-run.
-- All RLS policies use the existing public.is_admin() function (from the
-- earlier security hardening) to avoid recursive subqueries on profiles.
-- ============================================================================

-- 1. Period close tracking ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.period_close (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period     TEXT NOT NULL UNIQUE,                       -- format: '2024-01'
  status     TEXT NOT NULL DEFAULT 'open'
             CHECK (status IN ('open','in_progress','closed')),
  closed_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at  TIMESTAMPTZ,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Per-step close checklist ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.close_checklist (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period       TEXT NOT NULL,                            -- format: '2024-01'
  step_key     TEXT NOT NULL,                            -- 'import_statements'|'categorize'|'post'|'journal_rules'|'reconcile'|'review_balances'|'generate_pl'|'generate_bs'|'close'
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','done','skipped')),
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  notes        TEXT NOT NULL DEFAULT '',
  UNIQUE (period, step_key)
);

CREATE INDEX IF NOT EXISTS idx_close_checklist_period ON public.close_checklist(period);

-- 3. Report deliverables -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_deliverables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period       TEXT NOT NULL,                            -- format: '2024-01'
  report_type  TEXT NOT NULL
               CHECK (report_type IN ('pl','balance_sheet','income_statement','trial_balance','account_analysis','variance')),
  file_url     TEXT NOT NULL DEFAULT '',                 -- storage path in 'reports' bucket
  file_name    TEXT NOT NULL DEFAULT '',
  generated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_report_deliverables_period ON public.report_deliverables(period);

-- 4. Accountant chat history -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accountant_chat (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  actions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accountant_chat_created ON public.accountant_chat(created_at DESC);

-- 5. Accountant audit log ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.accountant_audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action       TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  period       TEXT,
  performed_by TEXT NOT NULL DEFAULT 'user'              -- 'user' or 'agent'
               CHECK (performed_by IN ('user','agent')),
  approved_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_accountant_audit_created ON public.accountant_audit_log(created_at DESC);

-- ============================================================================
-- RLS — all tables admin-only via public.is_admin()
-- ============================================================================

ALTER TABLE public.period_close          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.close_checklist       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_deliverables   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountant_chat       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountant_audit_log  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can CRUD period_close"         ON public.period_close;
DROP POLICY IF EXISTS "Admins can CRUD close_checklist"      ON public.close_checklist;
DROP POLICY IF EXISTS "Admins can CRUD report_deliverables"  ON public.report_deliverables;
DROP POLICY IF EXISTS "Admins can CRUD accountant_chat"      ON public.accountant_chat;
DROP POLICY IF EXISTS "Admins can CRUD accountant_audit_log" ON public.accountant_audit_log;

CREATE POLICY "Admins can CRUD period_close"
  ON public.period_close FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can CRUD close_checklist"
  ON public.close_checklist FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can CRUD report_deliverables"
  ON public.report_deliverables FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can CRUD accountant_chat"
  ON public.accountant_chat FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Admins can CRUD accountant_audit_log"
  ON public.accountant_audit_log FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ============================================================================
-- 6. Private 'reports' storage bucket + policies
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Admins can read reports bucket"   ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload reports bucket" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update reports bucket" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete reports bucket" ON storage.objects;

CREATE POLICY "Admins can read reports bucket"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'reports' AND public.is_admin());

CREATE POLICY "Admins can upload reports bucket"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reports' AND public.is_admin());

CREATE POLICY "Admins can update reports bucket"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'reports' AND public.is_admin())
  WITH CHECK (bucket_id = 'reports' AND public.is_admin());

CREATE POLICY "Admins can delete reports bucket"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'reports' AND public.is_admin());

-- ============================================================================
-- Done. Verify by running:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('period_close','close_checklist','report_deliverables','accountant_chat','accountant_audit_log');
-- ============================================================================
