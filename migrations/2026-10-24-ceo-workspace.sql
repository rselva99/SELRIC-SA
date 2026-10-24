-- ════════════════════════════════════════════════════════════════════════════
-- CEO WORKSPACE — SelRic as its own entity, separate from every customer
--
-- The CEO account (novoaricardo7@gmail.com) must have nothing to do with the
-- founder's login on Humphrey's. It gets its own organization, marked
-- is_internal, and the app gives it its own shell instead of a workspace.
--
-- How a platform admin gets in: by signing up. handle_new_user() now checks
-- whether the new email is on platform_admins. If it is, the workspace it
-- creates is named "SelRic", marked internal, given no program and no seed
-- data. Being on the list IS the invitation — there is no second step.
--
-- ceo_overview() stops counting internal organizations, so SelRic does not
-- show up on its own dashboard as a pilot that was "never used".
--
-- Also removes ricardo.humphreys@outlook.com from platform_admins. That is a
-- customer workspace login and oversight does not belong on it.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Mark internal organizations ─────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

-- organizations.plan is CHECK-constrained to ('pilot', 'paid') by
-- 2026-10-19-waitlist-and-invites.sql. 'internal' is a real third state — not a
-- pilot, never going to pay — so the constraint is widened rather than dodged.
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_plan_check CHECK (plan IN ('pilot', 'paid', 'internal'));

-- ─── 2. Sign-up: a platform-admin email gets the SelRic workspace ───────────
-- Identical to 2026-10-19-programs.sql except for the new branch (2a).
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
  v_is_admin  boolean;
BEGIN
  v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), '');
  v_locale    := CASE WHEN NEW.raw_user_meta_data->>'locale' IN ('en', 'es')
                      THEN NEW.raw_user_meta_data->>'locale' ELSE 'en' END;
  v_raw_code  := upper(NULLIF(trim(NEW.raw_user_meta_data->>'invite_code'), ''));

  SELECT EXISTS (SELECT 1 FROM public.platform_admins pa
                  WHERE lower(pa.email) = lower(COALESCE(NEW.email, '')))
    INTO v_is_admin;

  -- (1) Invited by an admin of an existing workspace? (Manage Users) — no code needed.
  SELECT * INTO v_inv
    FROM public.org_invitations
   WHERE lower(email) = lower(COALESCE(NEW.email, ''))
     AND accepted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1;

  IF FOUND AND NOT v_is_admin THEN
    v_org  := v_inv.org_id;
    v_role := v_inv.role;
    UPDATE public.org_invitations SET accepted_at = now() WHERE id = v_inv.id;

  ELSIF v_is_admin THEN
    -- (2a) A platform admin: the SelRic workspace. No gate, no program, no
    -- seed data. If a code was typed, consume it so it cannot be reused.
    IF v_raw_code IS NOT NULL THEN
      UPDATE public.invite_codes SET uses = uses + 1
       WHERE code = v_raw_code AND uses < max_uses;
    END IF;

    INSERT INTO public.organizations (name, business_type, created_by, plan, accounting_mode, is_internal)
    VALUES ('SelRic', 'software', NEW.id, 'internal', 'simple', true)
    RETURNING id INTO v_org;
    v_role := 'admin';

  ELSE
    -- (2) Self-serve sign-up → gate, then a brand-new workspace.
    v_mode := COALESCE((SELECT value FROM public.app_settings WHERE key = 'signup_mode'), 'invite');

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

-- ─── 3. The overview ignores internal organizations ─────────────────────────
CREATE OR REPLACE FUNCTION public.ceo_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'workspaces', COALESCE(jsonb_agg(w ORDER BY w->>'name'), '[]'::jsonb)
  )
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'id',              o.id,
      'name',            o.name,
      'created_at',      o.created_at,
      'accounting_mode', COALESCE(o.accounting_mode, 'full'),
      'plan',            COALESCE(o.plan, 'pilot'),
      'configured',      COALESCE(o.config, '{}'::jsonb) <> '{}'::jsonb,
      'program',         COALESCE((SELECT string_agg(p.program, ',' ORDER BY p.program)
                                     FROM public.org_programs p WHERE p.org_id = o.id), 'business'),
      'users',           (SELECT count(*) FROM public.profiles pr WHERE pr.org_id = o.id),
      'counts', jsonb_build_object(
        'transactions',   (SELECT count(*) FROM public.transactions t      WHERE t.org_id = o.id),
        'sales',          (SELECT count(*) FROM public.sales s             WHERE s.org_id = o.id),
        'products',       (SELECT count(*) FROM public.products p          WHERE p.org_id = o.id),
        'customers',      (SELECT count(*) FROM public.customers c         WHERE c.org_id = o.id),
        'inventory_logs', (SELECT count(*) FROM public.inventory_logs i    WHERE i.org_id = o.id),
        'animals',        (SELECT count(*) FROM public.lv_animals a        WHERE a.org_id = o.id),
        'herd_events',    (SELECT count(*) FROM public.lv_events e         WHERE e.org_id = o.id)
      ),
      'last_activity', GREATEST(
        COALESCE((SELECT max(s.created_at)::date FROM public.sales s          WHERE s.org_id = o.id), '1900-01-01'),
        COALESCE((SELECT max(p.updated_at)::date FROM public.products p       WHERE p.org_id = o.id), '1900-01-01'),
        COALESCE((SELECT max(c.created_at)::date FROM public.customers c      WHERE c.org_id = o.id), '1900-01-01'),
        COALESCE((SELECT max(i.created_at)::date FROM public.inventory_logs i WHERE i.org_id = o.id), '1900-01-01'),
        COALESCE((SELECT max(a.created_at)::date FROM public.lv_animals a     WHERE a.org_id = o.id), '1900-01-01'),
        COALESCE((SELECT max(e.created_at)::date FROM public.lv_events e      WHERE e.org_id = o.id), '1900-01-01')
      ),
      'activity_30d', (
        (SELECT count(*) FROM public.sales s          WHERE s.org_id = o.id AND s.created_at > now() - interval '30 days') +
        (SELECT count(*) FROM public.customers c      WHERE c.org_id = o.id AND c.created_at > now() - interval '30 days') +
        (SELECT count(*) FROM public.inventory_logs i WHERE i.org_id = o.id AND i.created_at > now() - interval '30 days') +
        (SELECT count(*) FROM public.lv_animals a     WHERE a.org_id = o.id AND a.created_at > now() - interval '30 days') +
        (SELECT count(*) FROM public.lv_events e      WHERE e.org_id = o.id AND e.created_at > now() - interval '30 days')
      )
    ) AS w
    FROM public.organizations o
    WHERE NOT o.is_internal
  ) s;

  result := result || jsonb_build_object(
    'platform', jsonb_build_object(
      'workspaces',      (SELECT count(*) FROM public.organizations WHERE NOT is_internal),
      'users',           (SELECT count(*) FROM public.profiles pr
                            JOIN public.organizations o ON o.id = pr.org_id WHERE NOT o.is_internal),
      'paying',          (SELECT count(*) FROM public.organizations
                           WHERE NOT is_internal AND COALESCE(plan, 'pilot') NOT IN ('pilot', 'trial')),
      'waitlist',        (SELECT count(*) FROM public.waitlist),
      'invites_open',    (SELECT count(*) FROM public.invite_codes WHERE uses < max_uses),
      'invites_used',    (SELECT count(*) FROM public.invite_codes WHERE uses >= max_uses)
    ),
    'invites', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'code', ic.code, 'label', ic.label, 'program', ic.program,
        'plan', ic.plan, 'uses', ic.uses, 'max_uses', ic.max_uses
      ) ORDER BY ic.created_at DESC)
      FROM public.invite_codes ic
    ), '[]'::jsonb)
  );

  RETURN result;
END;
$$;

-- ─── 4. The list: the CEO account only ──────────────────────────────────────
DELETE FROM public.platform_admins WHERE lower(email) = 'ricardo.humphreys@outlook.com';
INSERT INTO public.platform_admins (email, note) VALUES ('novoaricardo7@gmail.com', 'CEO')
ON CONFLICT (email) DO NOTHING;

-- The sign-up page needs a code in the URL to open at all. This one satisfies
-- that gate; the email is what makes the workspace internal.
-- plan is 'pilot' only because invite_codes.plan is CHECK-constrained to
-- pilot/paid; the admin branch of handle_new_user() never reads it.
INSERT INTO public.invite_codes (code, label, plan, max_uses, program)
VALUES ('SELRIC-CEO-0001', 'SelRic — CEO account', 'pilot', 1, 'business')
ON CONFLICT (code) DO NOTHING;

-- ─── 5. Sanity ──────────────────────────────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'is_internal') THEN
    RAISE EXCEPTION 'ceo-workspace: organizations.is_internal missing';
  END IF;
  SELECT count(*) INTO n FROM public.platform_admins;
  RAISE NOTICE 'ceo-workspace: OK — % platform admin(s); sign up at /signup?invite=SELRIC-CEO-0001', n;
END $$;

COMMIT;
