-- ============================================================================
-- 2026-10-19  Waitlist, invite links, pilot plan, invite-only sign-up
-- ============================================================================
-- SelRic becomes a paid product (from $100/month) with free pilot accounts.
-- Until payments exist, public sign-up is INVITE-ONLY and the landing page
-- collects a waitlist instead.
--
--   1. public.waitlist       — anyone may INSERT (the landing-page form);
--                              nothing may read it through the API except the
--                              service role / SQL editor.
--   2. public.invite_codes   — one row per invite link. Only SECURITY DEFINER
--                              functions and the SQL editor touch it.
--   3. public.app_settings   — key/value; 'signup_mode' = 'invite' | 'open'.
--                              Flip to 'open' when payments go live. No deploy.
--   4. organizations.plan    — 'pilot' | 'paid'. Existing workspaces = pilot.
--   5. check_invite(code)    — RPC the sign-up page calls to validate a link
--                              before creating the account.
--   6. get_signup_mode()     — RPC the sign-up page calls to know the mode.
--   7. handle_new_user()     — self-serve sign-ups now REQUIRE a valid invite
--                              code while signup_mode = 'invite' (hard backstop
--                              behind the UI). Team-member invitations from
--                              Manage Users are unaffected.
--
-- Additive. No DROP TABLE/COLUMN, no DELETE, no UPDATE of business rows.
-- Idempotent — safe to re-run.
-- ============================================================================

BEGIN;

-- ─── 1. waitlist ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.waitlist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  full_name     text NOT NULL DEFAULT '',
  business_name text NOT NULL DEFAULT '',
  business_type text NOT NULL DEFAULT 'other',
  locale        text NOT NULL DEFAULT 'en',
  source        text NOT NULL DEFAULT 'landing',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_uq ON public.waitlist (lower(email));
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can join the waitlist" ON public.waitlist;
CREATE POLICY "Anyone can join the waitlist"
  ON public.waitlist FOR INSERT TO anon, authenticated
  WITH CHECK (char_length(email) BETWEEN 5 AND 254 AND position('@' in email) > 1);
GRANT INSERT ON public.waitlist TO anon, authenticated;
REVOKE SELECT, UPDATE, DELETE ON public.waitlist FROM anon, authenticated;
-- (no SELECT/UPDATE/DELETE on purpose: the list is only readable with the
--  service role or from the Supabase SQL editor)

-- ─── 2. invite_codes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invite_codes (
  code        text PRIMARY KEY,
  label       text NOT NULL DEFAULT '',
  plan        text NOT NULL DEFAULT 'pilot' CHECK (plan IN ('pilot', 'paid')),
  max_uses    integer NOT NULL DEFAULT 1,
  uses        integer NOT NULL DEFAULT 0,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invite_codes FROM anon, authenticated;
-- no policies, no grants: reachable only via the functions below or the service role

-- ─── 3. app_settings ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_settings FROM anon, authenticated;
INSERT INTO public.app_settings (key, value) VALUES ('signup_mode', 'invite')
ON CONFLICT (key) DO NOTHING;

-- ─── 4. organizations.plan ──────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS plan text NOT NULL DEFAULT 'pilot';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_plan_check') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_plan_check CHECK (plan IN ('pilot', 'paid'));
  END IF;
END $$;

-- ─── 5. check_invite(code) ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.invite_codes%ROWTYPE;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  SELECT * INTO r FROM public.invite_codes WHERE code = upper(trim(p_code));
  IF NOT FOUND OR r.uses >= r.max_uses OR (r.expires_at IS NOT NULL AND r.expires_at <= now()) THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  RETURN jsonb_build_object('valid', true, 'label', r.label, 'plan', r.plan);
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_invite(text) TO anon, authenticated;

-- ─── 6. get_signup_mode() ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_signup_mode()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT COALESCE((SELECT value FROM public.app_settings WHERE key = 'signup_mode'), 'invite') $$;
GRANT EXECUTE ON FUNCTION public.get_signup_mode() TO anon, authenticated;

-- ─── 7. handle_new_user() — invite-only self-serve sign-up ──────────────────
-- Same as 2026-10-19-profiles-locale.sql, plus the invite gate and the plan.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv       public.org_invitations%ROWTYPE;
  v_code      public.invite_codes%ROWTYPE;
  v_org       uuid;
  v_role      text := 'limited';
  v_full_name text;
  v_org_name  text;
  v_locale    text;
  v_mode      text;
  v_plan      text := 'pilot';
  v_raw_code  text;
BEGIN
  v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), '');
  v_locale    := CASE WHEN NEW.raw_user_meta_data->>'locale' IN ('en', 'es')
                      THEN NEW.raw_user_meta_data->>'locale' ELSE 'en' END;

  -- (1) Invited by an admin of an existing workspace? (Manage Users) — no code needed.
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
    -- (2) Self-serve sign-up → gate, then a brand-new workspace.
    v_mode     := COALESCE((SELECT value FROM public.app_settings WHERE key = 'signup_mode'), 'invite');
    v_raw_code := upper(NULLIF(trim(NEW.raw_user_meta_data->>'invite_code'), ''));

    IF v_mode = 'invite' THEN
      SELECT * INTO v_code
        FROM public.invite_codes
       WHERE code = v_raw_code
         AND uses < max_uses
         AND (expires_at IS NULL OR expires_at > now())
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SELRIC_INVITE_REQUIRED: sign-up is by invitation while SelRic is in pilot. Join the waitlist.';
      END IF;
      UPDATE public.invite_codes SET uses = uses + 1 WHERE code = v_code.code;
      v_plan := v_code.plan;
    ELSE
      -- open mode (payments live): honour a code if one was used, else paid
      IF v_raw_code IS NOT NULL THEN
        SELECT * INTO v_code FROM public.invite_codes
         WHERE code = v_raw_code AND uses < max_uses AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE;
        IF FOUND THEN
          UPDATE public.invite_codes SET uses = uses + 1 WHERE code = v_code.code;
          v_plan := v_code.plan;
        ELSE
          v_plan := 'paid';
        END IF;
      ELSE
        v_plan := 'paid';
      END IF;
    END IF;

    v_org_name := NULLIF(trim(NEW.raw_user_meta_data->>'org_name'), '');
    IF v_org_name IS NULL THEN
      v_org_name := COALESCE(NULLIF(v_full_name, ''), split_part(COALESCE(NEW.email, ''), '@', 1)) || '''s Business';
    END IF;

    INSERT INTO public.organizations (name, business_type, created_by, plan)
    VALUES (v_org_name,
            COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'business_type'), ''), 'other'),
            NEW.id,
            v_plan)
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

-- ============================================================================
-- HOW TO USE (run in the SQL editor; none of this is in the app)
--
--   Create an invite link (one business, one use):
--     INSERT INTO public.invite_codes (code, label, plan, max_uses)
--     VALUES ('PILOT-XXXX-XXXX', 'Pilot — <business name>', 'pilot', 1);
--     → link: https://selric-sa.vercel.app/signup?invite=PILOT-XXXX-XXXX
--
--   Read the waitlist:
--     SELECT created_at, full_name, business_name, business_type, email, locale
--       FROM public.waitlist ORDER BY created_at DESC;
--
--   Open public sign-up when payments are live:
--     UPDATE public.app_settings SET value = 'open', updated_at = now() WHERE key = 'signup_mode';
-- ============================================================================
