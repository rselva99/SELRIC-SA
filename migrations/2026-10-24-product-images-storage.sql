-- ════════════════════════════════════════════════════════════════════════════
-- PRODUCT IMAGES — put the bucket and its policies under version control
--
-- Why: the Chile Nicaragua pilot reported photos "not loading", and when I went
-- looking there was no migration for the `product-images` bucket at all. It was
-- created by hand in the dashboard, so whatever policies it carries have never
-- been reviewed, cannot be diffed, and do not exist in any other environment.
-- A read that works for the service role (which bypasses RLS) tells you nothing
-- about what the owner's own session is allowed to do.
--
-- This migration is additive and idempotent. It does not delete a single object.
--
-- NOTE ON PATHS. Until today every object landed in one flat namespace shared by
-- every workspace (`1792713774058_IMG_6857.jpeg`). From now on the app writes
-- `<org_id>/<timestamp>_<name>`. Both shapes are readable below, because the
-- 25 existing objects still carry the old flat names and their products point
-- at them. Once those are migrated the legacy clause can be dropped.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The bucket ──────────────────────────────────────────────────────────
-- Private. 10 MB ceiling: the browser now downscales before upload, so anything
-- larger is a client that skipped that path. Only formats a browser can paint —
-- HEIC is deliberately excluded, because it uploads fine and then renders
-- nowhere except Safari, which is exactly the "photo is just missing" report.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('product-images', 'product-images', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 2. Policies ────────────────────────────────────────────────────────────
-- A member may read and write their own workspace's folder, plus the legacy
-- flat objects (no "/" in the name) that predate the per-workspace prefix.
DROP POLICY IF EXISTS "product-images read"   ON storage.objects;
DROP POLICY IF EXISTS "product-images insert" ON storage.objects;
DROP POLICY IF EXISTS "product-images update" ON storage.objects;
DROP POLICY IF EXISTS "product-images delete" ON storage.objects;

CREATE POLICY "product-images read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (
      (storage.foldername(name))[1] = public.current_org_id()::text
      OR position('/' in name) = 0            -- legacy flat objects
    )
  );

CREATE POLICY "product-images insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

CREATE POLICY "product-images update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

CREATE POLICY "product-images delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- ─── 3. Sanity ──────────────────────────────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'product-images') THEN
    RAISE EXCEPTION 'product-images: bucket missing';
  END IF;
  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'product-images %';
  IF n <> 4 THEN RAISE EXCEPTION 'product-images: expected 4 policies, found %', n; END IF;
  SELECT count(*) INTO n FROM storage.objects
   WHERE bucket_id = 'product-images' AND position('/' in name) = 0;
  RAISE NOTICE 'product-images: OK — % legacy flat object(s) still readable', n;
END $$;

COMMIT;
