-- ============================================================================
-- 2026-10-19  Workspace config — each business shapes its own portal
-- ============================================================================
-- Phase 1 of "let the customer design the portal": one JSON per workspace
-- that decides which modules show, what they are called, and what the
-- dashboard shows. The logic underneath (record_sale, the P&L, period locks)
-- stays the same for everyone — only vocabulary, visibility and emphasis
-- are configurable. Shape (version 1, resolved in src/lib/workspaceConfig.js):
--
--   {
--     "v": 1,
--     "template":  "maker" | "retail" | "services" | "restaurant",
--     "modules":   { "sales": true, "customers": true, "inventory": true, "tasks": false, "reports": true },
--     "labels":    { "customers": "Pulperías", ... },          -- optional overrides
--     "dashboard": { "chart": true, "breakdown": true, "products": true, "recent": true }
--   }
--
-- An empty object means "not set up yet": the app shows the one-step setup
-- screen to the workspace admin on next sign-in (Simple mode only). Full
-- mode workspaces (Humphrey's) are untouched — they never see it.
--
-- Additive, idempotent. Admins update it through the existing
-- "Admins can update their organization" policy.
-- ============================================================================

BEGIN;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_config_object;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_config_object CHECK (jsonb_typeof(config) = 'object');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'config') THEN
    RAISE EXCEPTION 'workspace-config: organizations.config missing';
  END IF;
  RAISE NOTICE 'workspace-config: OK';
END $$;

COMMIT;
