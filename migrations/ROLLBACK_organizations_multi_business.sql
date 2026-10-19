-- ============================================================================
-- ROLLBACK for 2026-10-18-organizations-multi-business.sql
-- ============================================================================
-- Run ONLY if the multi-business layer has to come off. Two stages:
--
--   STAGE A (safe, reversible, no data loss) — switches the app back to the
--   single-workspace behaviour it had before: removes the org_isolation
--   policies and the aa_set_org_id triggers, and restores the previous
--   versions of enforce_period_lock() and handle_new_user(). Every org_id
--   column, the organizations / org_invitations tables and all rows stay in
--   place, so re-applying the forward migration later is a no-op.
--
--   STAGE B (destructive, commented out) — drops the org_id columns and the
--   two new tables. Only meaningful if no other business ever signed up.
--   Deliberately left commented: read it, decide, uncomment.
--
-- NOTE on unique keys: the forward migration re-scoped several UNIQUE keys to
-- (org_id, …) and re-keyed book_bs_statements to (org_id, year). Those are
-- strictly looser than the originals and are left as they are here — putting
-- the global keys back would fail if a second business has already posted
-- rows. Stage B shows how to restore them when the DB holds one org only.
-- ============================================================================

BEGIN;

-- ─── STAGE A ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_policies
     WHERE schemaname = 'public' AND policyname = 'org_isolation'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', r.tablename);
  END LOOP;

  FOR r IN
    SELECT c.relname
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND t.tgname = 'aa_set_org_id' AND NOT t.tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS aa_set_org_id ON public.%I', r.relname);
  END LOOP;
END $$;

-- The open permissive policies the forward migration added to tables that had
-- RLS switched off are left in place: they reproduce the pre-migration
-- behaviour (any authenticated user) now that isolation is gone.

-- enforce_period_lock(): back to the 2026-06-17 version (global lookup).
CREATE OR REPLACE FUNCTION public.enforce_period_lock()
RETURNS TRIGGER AS $$
DECLARE
  txn_period   TEXT;
  close_status TEXT;
  target_date  DATE;
  should_check BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_date  := OLD.date;
    should_check := true;
  ELSIF TG_OP = 'INSERT' THEN
    target_date  := NEW.date;
    should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    target_date  := NEW.date;
    IF NEW.date IS DISTINCT FROM OLD.date THEN
      should_check := true;
    ELSIF TG_TABLE_NAME = 'transactions' THEN
      IF NEW.posted IS DISTINCT FROM OLD.posted AND NEW.posted = true THEN
        should_check := true;
      END IF;
    END IF;
  END IF;

  IF NOT should_check THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  txn_period := to_char(target_date, 'YYYY-MM');
  SELECT status INTO close_status
    FROM public.period_close
   WHERE period = txn_period;

  IF close_status = 'closed' THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: % is closed. Reopen the period from the Accountant page before writing to it.', txn_period
      USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- handle_new_user(): back to the hardened single-workspace version. New
-- sign-ups land in the legacy workspace as 'limited' (the org_id column, if
-- still present, is filled with the legacy org).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_org boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'org_id'
  ) INTO has_org;

  IF has_org THEN
    INSERT INTO public.profiles (id, full_name, email, role, org_id)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''), 'limited',
            '00000000-0000-4000-8000-000000000001'::uuid)
    ON CONFLICT (id) DO NOTHING;
  ELSE
    INSERT INTO public.profiles (id, full_name, email, role)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), COALESCE(NEW.email, ''), 'limited')
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;

-- ─── STAGE B (DESTRUCTIVE — uncomment deliberately) ─────────────────────────
-- Refuses to run if more than one organization exists.
--
-- DO $$
-- DECLARE
--   r record;
--   n_orgs int;
-- BEGIN
--   SELECT count(*) INTO n_orgs FROM public.organizations;
--   IF n_orgs > 1 THEN
--     RAISE EXCEPTION 'Stage B refused: % organizations exist — other businesses have data', n_orgs;
--   END IF;
--
--   -- restore global unique keys (safe: one org only)
--   ALTER TABLE public.period_close      DROP CONSTRAINT IF EXISTS period_close_org_period_key,            ADD CONSTRAINT period_close_period_key UNIQUE (period);
--   ALTER TABLE public.close_checklist   DROP CONSTRAINT IF EXISTS close_checklist_org_period_step_key_key, ADD CONSTRAINT close_checklist_period_step_key_key UNIQUE (period, step_key);
--   ALTER TABLE public.journal_entries   DROP CONSTRAINT IF EXISTS journal_entries_org_reference_key,       ADD CONSTRAINT journal_entries_reference_key UNIQUE (reference);
--   ALTER TABLE public.cpa_sourced_locks DROP CONSTRAINT IF EXISTS cpa_sourced_locks_org_year_kind_key,     ADD CONSTRAINT cpa_sourced_locks_year_kind_key UNIQUE (year, kind);
--   ALTER TABLE public.payroll_months    DROP CONSTRAINT IF EXISTS payroll_months_org_pay_month_key,        ADD CONSTRAINT payroll_months_pay_month_key UNIQUE (pay_month);
--   ALTER TABLE public.checks            DROP CONSTRAINT IF EXISTS checks_org_check_no_amount_clear_date_key, ADD CONSTRAINT checks_check_no_amount_clear_date_key UNIQUE (check_no, amount, clear_date);
--   ALTER TABLE public.close_scenarios   DROP CONSTRAINT IF EXISTS close_scenarios_org_slug_key,            ADD CONSTRAINT close_scenarios_slug_key UNIQUE (slug);
--   ALTER TABLE public.book_bs_statements DROP CONSTRAINT IF EXISTS book_bs_statements_pkey,                ADD CONSTRAINT book_bs_statements_pkey PRIMARY KEY (year);
--   DROP INDEX IF EXISTS public.book_bs_lines_year_section_title_uq;
--   CREATE UNIQUE INDEX book_bs_lines_year_section_title_uq ON public.book_bs_lines (year, section_code, lower(title));
--   DROP INDEX IF EXISTS public.transactions_import_key_uniq;
--   CREATE UNIQUE INDEX transactions_import_key_uniq ON public.transactions (import_key) WHERE import_key IS NOT NULL;
--
--   -- drop org_id everywhere
--   FOR r IN
--     SELECT table_name FROM information_schema.columns
--      WHERE table_schema = 'public' AND column_name = 'org_id'
--        AND table_name NOT IN ('org_invitations')
--   LOOP
--     EXECUTE format('ALTER TABLE public.%I DROP COLUMN org_id', r.table_name);
--   END LOOP;
--
--   DROP TABLE IF EXISTS public.org_invitations;
--   DROP TABLE IF EXISTS public.organizations;
--   DROP FUNCTION IF EXISTS public.seed_organization_defaults(uuid);
--   DROP FUNCTION IF EXISTS public.set_org_id();
--   DROP FUNCTION IF EXISTS public.current_org_id();
--   DROP FUNCTION IF EXISTS public.legacy_org_id();
-- END $$;
