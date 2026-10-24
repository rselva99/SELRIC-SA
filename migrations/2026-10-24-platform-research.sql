-- ════════════════════════════════════════════════════════════════════════════
-- PLATFORM RESEARCH — the business plan, model and market analysis, served
-- only to platform admins
--
-- The repository is public on GitHub and anything under public/ or in the
-- client bundle is public on Vercel. So nothing from the business plan lives
-- in the repo at all. The dashboard's Research tab reads:
--   • one jsonb document from platform_research (key = 'research')
--   • three files from the private bucket platform-docs, via signed URLs
-- Both are readable only when is_platform_admin() — the same gate as
-- ceo_overview(). Nothing can write to either from the app: there is no
-- INSERT/UPDATE/DELETE policy and no grant. Writes happen only through
-- ~/selric-business/publish.mjs with the service role, from outside the repo.
--
-- Idempotent. Re-running it changes nothing.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The research document ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_research (
  key        text PRIMARY KEY,
  doc        jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_research ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_research admin read" ON public.platform_research;
CREATE POLICY "platform_research admin read" ON public.platform_research
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

REVOKE ALL ON public.platform_research FROM anon, authenticated;
GRANT SELECT ON public.platform_research TO authenticated;

-- ─── 2. The documents bucket ────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('platform-docs', 'platform-docs', false, 52428800,
        ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/json'])
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "platform-docs admin read" ON storage.objects;
CREATE POLICY "platform-docs admin read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'platform-docs' AND public.is_platform_admin());
-- No INSERT, UPDATE or DELETE policy on purpose: uploads use the service role.

-- ─── 3. Sanity ──────────────────────────────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'platform-docs') THEN
    RAISE EXCEPTION 'platform-research: bucket missing';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'platform_research';
  IF n <> 1 THEN RAISE EXCEPTION 'platform-research: expected 1 table policy, found %', n; END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'platform-docs admin read';
  IF n <> 1 THEN RAISE EXCEPTION 'platform-research: bucket policy missing'; END IF;
  RAISE NOTICE 'platform-research: OK — publish with: node ~/selric-business/publish.mjs';
END $$;

COMMIT;
