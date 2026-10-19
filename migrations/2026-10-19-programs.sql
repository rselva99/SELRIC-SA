-- ============================================================================
-- 2026-10-19  SelRic programs: one account, a program per thing you run
-- ============================================================================
-- SelRic becomes a platform: SelRic Business is the first program, Batavia
-- Ganadería the second, and the next one is a folder plus a registry entry
-- (src/programs/index.js). This migration adds the one table the shell needs
-- to know which programs a workspace runs, and tags the waitlist and invite
-- codes with a program.
--
--   1. public.org_programs      — (org_id, program, plan, enabled_at). One row
--                                 per program a workspace has turned on. Every
--                                 existing workspace gets 'business'.
--   2. waitlist.program         — which program the person asked about.
--   3. invite_codes.program     — which program a pilot invite turns on.
--   4. handle_new_user()        — a new workspace gets its first program row
--                                 (the invite's program, else 'business').
--
-- Additive. No DROP, no DELETE, no UPDATE of business rows. Idempotent.
-- The app tolerates this not being applied yet (it assumes 'business').
-- ============================================================================

BEGIN;

-- ─── 1. org_programs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_programs (
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  program    text NOT NULL CHECK (char_length(program) BETWEEN 2 AND 40),
  plan       text NOT NULL DEFAULT 'pilot' CHECK (plan IN ('pilot', 'paid')),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, program)
);
ALTER TABLE public.org_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their programs" ON public.org_programs;
CREATE POLICY "Members can view their programs"
  ON public.org_programs FOR SELECT TO authenticated
  USING (org_id = public.current_org_id());

DROP POLICY IF EXISTS "Admins can manage their programs" ON public.org_programs;
CREATE POLICY "Admins can manage their programs"
  ON public.org_programs FOR ALL TO authenticated
  USING (org_id = public.current_org_id() AND public.is_admin())
  WITH CHECK (org_id = public.current_org_id() AND public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_programs TO authenticated;
REVOKE ALL ON public.org_programs FROM anon;

-- Every workspace that exists today runs Business, on the plan it already has.
INSERT INTO public.org_programs (org_id, program, plan)
SELECT id, 'business', plan FROM public.organizations
ON CONFLICT (org_id, program) DO NOTHING;

-- ─── 2. waitlist.program ────────────────────────────────────────────────────
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS program text NOT NULL DEFAULT 'business';

-- ─── 3. invite_codes.program ────────────────────────────────────────────────
ALTER TABLE public.invite_codes
  ADD COLUMN IF NOT EXISTS program text NOT NULL DEFAULT 'business';

-- ─── 4. handle_new_user() — first program row for a new workspace ───────────
-- Same as 2026-10-19-accounting-mode.sql plus the org_programs insert.
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
  v_program   text := 'business';
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
      v_plan    := v_code.plan;
      v_program := COALESCE(NULLIF(v_code.program, ''), 'business');
    ELSE
      -- open mode (payments live): honour a code if one was used, else paid
      IF v_raw_code IS NOT NULL THEN
        SELECT * INTO v_code FROM public.invite_codes
         WHERE code = v_raw_code AND uses < max_uses AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE;
        IF FOUND THEN
          UPDATE public.invite_codes SET uses = uses + 1 WHERE code = v_code.code;
          v_plan    := v_code.plan;
          v_program := COALESCE(NULLIF(v_code.program, ''), 'business');
        ELSE
          v_plan := 'paid';
        END IF;
      ELSE
        v_plan := 'paid';
      END IF;
      -- a program chosen on the sign-up form wins when there is no code
      IF v_code.code IS NULL AND NULLIF(trim(NEW.raw_user_meta_data->>'program'), '') IS NOT NULL THEN
        v_program := trim(NEW.raw_user_meta_data->>'program');
      END IF;
    END IF;

    v_org_name := NULLIF(trim(NEW.raw_user_meta_data->>'org_name'), '');
    IF v_org_name IS NULL THEN
      v_org_name := COALESCE(NULLIF(v_full_name, ''), split_part(COALESCE(NEW.email, ''), '@', 1)) || '''s Business';
    END IF;

    INSERT INTO public.organizations (name, business_type, created_by, plan, accounting_mode)
    VALUES (v_org_name,
            COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'business_type'), ''), 'other'),
            NEW.id,
            v_plan,
            'simple')
    RETURNING id INTO v_org;

    INSERT INTO public.org_programs (org_id, program, plan)
    VALUES (v_org, v_program, v_plan)
    ON CONFLICT (org_id, program) DO NOTHING;

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
-- CHECK (optional):
--   SELECT o.name, p.program, p.plan FROM public.org_programs p
--     JOIN public.organizations o ON o.id = p.org_id ORDER BY o.created_at;
--   → one 'business' row per workspace.
--
-- Turn a program on for a workspace by hand (the owner can also do it in Settings):
--   INSERT INTO public.org_programs (org_id, program, plan)
--   SELECT id, 'ganaderia', 'pilot' FROM public.organizations WHERE name = '<business>'
--   ON CONFLICT DO NOTHING;
--
-- A pilot invite for a Ganadería workspace:
--   INSERT INTO public.invite_codes (code, label, plan, max_uses, program)
--   VALUES ('PILOT-XXXX-XXXX', 'Pilot — <finca>', 'pilot', 1, 'ganaderia');
-- ============================================================================
