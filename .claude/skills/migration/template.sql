-- ============================================================================
-- <short-description>: <one line — what this migration does>.
--
-- <Why it exists, in two or three sentences. What reads or writes the new
-- objects, and who may (RLS).>
--
-- Requires <earlier migration files, or "nothing">. Idempotent — safe to run
-- again. No DELETE or rewrite of existing data.
-- ============================================================================

BEGIN;

-- Guard: fail early, with a message that says what to run first.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'current_org_id') THEN
    RAISE EXCEPTION '<short-description>: public.current_org_id() is missing';
  END IF;
END $$;

-- ─── 1. <Object> ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.<table> (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON public.<table>;
CREATE POLICY org_isolation ON public.<table>
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<table> TO authenticated;
REVOKE ALL ON public.<table> FROM anon;

-- ─── 2. Sanity ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = '<table>') THEN
    RAISE EXCEPTION '<short-description>: <table> missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = '<table>' AND policyname = 'org_isolation') THEN
    RAISE EXCEPTION '<short-description>: <table> org_isolation missing';
  END IF;
  RAISE NOTICE '<short-description>: OK';
END $$;

COMMIT;
