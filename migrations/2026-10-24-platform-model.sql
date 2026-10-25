-- ============================================================================
-- platform-model: the editable model — assumptions and document prose,
-- versioned and append-only.
--
--   • platform_assumptions — one row per version of the assumptions object the
--     engine in src/lib/ceoModel.js runs on. The engine itself holds no
--     constants; every number the CEO pages show is computed from the newest
--     row of this table at page load.
--   • platform_documents   — one row per version of each document's prose
--     (business_plan, market_gtm, findings, plan), as sections of markdown
--     with {{tokens}} that the app resolves from the model.
--
-- Both are readable and appendable only by platform admins. There are no
-- UPDATE or DELETE grants: a save is a new version, a restore is a new version
-- copied from an old one, and the history is the audit trail. The version
-- number is assigned by a trigger, never by the client.
--
-- Idempotent. Requires 2026-10-24-ceo-overview.sql (is_platform_admin()).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_platform_admin'
  ) THEN
    RAISE EXCEPTION 'platform-model: public.is_platform_admin() is missing — run 2026-10-24-ceo-overview.sql first';
  END IF;
END $$;

-- ─── 1. Assumptions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_assumptions (
  id          bigserial PRIMARY KEY,
  version     integer NOT NULL,
  data        jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  note        text,                                  -- why this version exists
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version)
);

CREATE OR REPLACE FUNCTION public.platform_assumptions_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(max(version), 0) + 1 INTO NEW.version FROM public.platform_assumptions;
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_assumptions_version ON public.platform_assumptions;
CREATE TRIGGER platform_assumptions_version
  BEFORE INSERT ON public.platform_assumptions
  FOR EACH ROW EXECUTE FUNCTION public.platform_assumptions_version();

ALTER TABLE public.platform_assumptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_assumptions admin read" ON public.platform_assumptions;
CREATE POLICY "platform_assumptions admin read" ON public.platform_assumptions
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "platform_assumptions admin append" ON public.platform_assumptions;
CREATE POLICY "platform_assumptions admin append" ON public.platform_assumptions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

REVOKE ALL ON public.platform_assumptions FROM anon, authenticated;
GRANT SELECT, INSERT ON public.platform_assumptions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.platform_assumptions_id_seq TO authenticated;

-- ─── 2. Documents ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_documents (
  id          bigserial PRIMARY KEY,
  doc         text NOT NULL CHECK (doc IN ('business_plan', 'market_gtm', 'findings', 'plan')),
  version     integer NOT NULL,
  sections    jsonb NOT NULL,                        -- ordered [{key, title, body}]; 'plan' holds {milestones, roadmap}
  note        text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc, version)
);

CREATE OR REPLACE FUNCTION public.platform_documents_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  SELECT COALESCE(max(version), 0) + 1 INTO NEW.version FROM public.platform_documents WHERE doc = NEW.doc;
  NEW.created_by := auth.uid();
  NEW.created_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS platform_documents_version ON public.platform_documents;
CREATE TRIGGER platform_documents_version
  BEFORE INSERT ON public.platform_documents
  FOR EACH ROW EXECUTE FUNCTION public.platform_documents_version();

ALTER TABLE public.platform_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_documents admin read" ON public.platform_documents;
CREATE POLICY "platform_documents admin read" ON public.platform_documents
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "platform_documents admin append" ON public.platform_documents;
CREATE POLICY "platform_documents admin append" ON public.platform_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

REVOKE ALL ON public.platform_documents FROM anon, authenticated;
GRANT SELECT, INSERT ON public.platform_documents TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.platform_documents_id_seq TO authenticated;

-- ─── 3. Sanity ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(t, ', ') INTO bad FROM unnest(ARRAY['platform_assumptions', 'platform_documents']) AS t
  WHERE NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'platform-model: missing %', bad; END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('platform_assumptions', 'platform_documents')
      AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('UPDATE', 'DELETE')
  ) THEN RAISE EXCEPTION 'platform-model: an UPDATE or DELETE grant slipped through'; END IF;
END $$;

COMMIT;
