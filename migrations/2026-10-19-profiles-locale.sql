-- ============================================================================
-- 2026-10-19  profiles.locale — the user's UI language (en / es)
-- ============================================================================
-- Additive. One nullable-with-default column on profiles, and the sign-up
-- trigger learns to copy `locale` from the sign-up metadata so a person who
-- chose Spanish on the landing page gets Spanish inside their new workspace.
-- Existing users default to 'en'; the app also honours a per-device choice
-- (localStorage) and the browser language when nothing is saved.
--
-- Nothing else changes: no DROP, no DELETE, no UPDATE of existing rows.
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_locale_check') THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_locale_check CHECK (locale IN ('en', 'es'));
  END IF;
END $$;

-- Same function as 2026-10-18-organizations-multi-business.sql §9, plus the
-- locale column in the INSERT. Client-supplied `role` is still ignored.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv       public.org_invitations%ROWTYPE;
  v_org       uuid;
  v_role      text := 'limited';
  v_full_name text;
  v_org_name  text;
  v_locale    text;
BEGIN
  v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), '');
  v_locale    := CASE WHEN NEW.raw_user_meta_data->>'locale' IN ('en', 'es')
                      THEN NEW.raw_user_meta_data->>'locale' ELSE 'en' END;

  -- (1) Invited by an admin of an existing workspace?
  SELECT * INTO v_inv
    FROM public.org_invitations
   WHERE lower(email) = lower(COALESCE(NEW.email, ''))
     AND accepted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND THEN
    v_org  := v_inv.org_id;
    v_role := v_inv.role;
    UPDATE public.org_invitations SET accepted_at = now() WHERE id = v_inv.id;
  ELSE
    -- (2) Self-serve sign-up → a brand-new workspace; this user is its admin.
    v_org_name := NULLIF(trim(NEW.raw_user_meta_data->>'org_name'), '');
    IF v_org_name IS NULL THEN
      v_org_name := COALESCE(NULLIF(v_full_name, ''), split_part(COALESCE(NEW.email, ''), '@', 1)) || '''s Business';
    END IF;

    INSERT INTO public.organizations (name, business_type, created_by)
    VALUES (v_org_name,
            COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'business_type'), ''), 'other'),
            NEW.id)
    RETURNING id INTO v_org;

    v_role := 'admin';
    PERFORM public.seed_organization_defaults(v_org);
  END IF;

  INSERT INTO public.profiles (id, full_name, email, role, org_id, locale)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''), v_role, v_org, v_locale)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMIT;
