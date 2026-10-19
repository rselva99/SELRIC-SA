-- ============================================================================
-- 2026-10-19  Accounting mode per workspace: 'full' | 'simple'
-- ============================================================================
-- Each business chooses how it keeps its books (Settings → Accounting):
--
--   full    — the complete package: Bookkeeping, Cash management, General
--             ledger, Journal, Chart of accounts, Accountant, plus Payroll
--             and Assets.
--   simple  — one "Transactions" tab for recording money in / money out.
--             The accounting pages, Payroll and Assets are hidden.
--
-- Both modes write to the SAME tables (transactions, categories, …). The mode
-- only decides which pages the sidebar shows, so switching is never
-- destructive and can be undone at any time.
--
--   • organizations.accounting_mode — column DEFAULT 'full', so every
--     EXISTING workspace (Humphrey's, Lopez Bakery test) keeps everything it
--     has today. Metadata-only ADD COLUMN: no row rewrite.
--   • handle_new_user() — brand-new self-serve workspaces start in 'simple'
--     (the owner can switch in Settings). Same function as
--     2026-10-19-waitlist-and-invites.sql plus that one column.
--   • Admins already have an UPDATE policy on their own organization row
--     ("Admins can update their organization"), so the Settings page needs
--     no new policy.
--
-- Additive. No DROP, no DELETE, no UPDATE of business rows. Idempotent.
-- ============================================================================

BEGIN;

-- ─── 1. organizations.accounting_mode ──────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS accounting_mode text NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_accounting_mode_check') THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_accounting_mode_check CHECK (accounting_mode IN ('full', 'simple'));
  END IF;
END $$;

-- ─── 2. handle_new_user() — new workspaces start in 'simple' ───────────────
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

    -- New workspaces start with the simple Transactions tab; Settings → Accounting
    -- switches to the full package whenever the owner wants it.
    INSERT INTO public.organizations (name, business_type, created_by, plan, accounting_mode)
    VALUES (v_org_name,
            COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'business_type'), ''), 'other'),
            NEW.id,
            v_plan,
            'simple')
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
-- CHECK (optional):
--   SELECT name, plan, accounting_mode FROM public.organizations ORDER BY created_at;
--   → every existing workspace shows accounting_mode = 'full'.
--
-- To change a workspace by hand (the owner can also do it in Settings):
--   UPDATE public.organizations SET accounting_mode = 'simple' WHERE name = '<business>';
-- ============================================================================
