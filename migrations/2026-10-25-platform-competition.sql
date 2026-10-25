-- ============================================================================
-- platform-competition: a fifth document — 'competition' — in platform_documents.
--
-- The competition document is prose sections as before, plus one section
-- {key:'dataset', kind:'json', data} holding the competitor dataset (two
-- markets, their features and every competitor's prices, feature scores and
-- sources), so the dataset is versioned, edited and restored with the rest.
-- SelRic's own rows carry a priceToken instead of a number: the app resolves
-- our price from the model, so the ladder moves when the Model tab changes.
--
-- Idempotent. Requires 2026-10-24-platform-model.sql. No RLS change: the
-- policies on platform_documents are per table, not per doc.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'platform_documents') THEN
    RAISE EXCEPTION 'platform-competition: platform_documents is missing — run 2026-10-24-platform-model.sql first';
  END IF;
END $$;

-- The column CHECK was created inline, so Postgres named it platform_documents_doc_check.
ALTER TABLE public.platform_documents DROP CONSTRAINT IF EXISTS platform_documents_doc_check;
ALTER TABLE public.platform_documents
  ADD CONSTRAINT platform_documents_doc_check
  CHECK (doc IN ('business_plan', 'market_gtm', 'findings', 'plan', 'competition'));

-- Sanity: the new value is accepted, the old ones still are, and no write grant appeared.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid = 'public.platform_documents'::regclass AND conname = 'platform_documents_doc_check';
  IF def IS NULL OR def NOT LIKE '%competition%' OR def NOT LIKE '%business_plan%' THEN
    RAISE EXCEPTION 'platform-competition: doc CHECK not as expected: %', def;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
             WHERE table_schema = 'public' AND table_name = 'platform_documents'
               AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('UPDATE', 'DELETE')) THEN
    RAISE EXCEPTION 'platform-competition: an UPDATE or DELETE grant slipped through';
  END IF;
END $$;

COMMIT;
