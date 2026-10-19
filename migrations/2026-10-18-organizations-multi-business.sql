-- ============================================================================
-- 2026-10-18  ORGANIZATIONS — one isolated workspace per business
-- ============================================================================
--
-- WHY
--   SelRic is moving from "the books of one restaurant" to "business
--   management for any owner-operator". Anyone can now create an account on
--   the public site and gets their OWN workspace. Humphrey's (3700 Laclede Ave
--   LLC) becomes workspace #1 and keeps every row it has today.
--
-- WHAT THIS MIGRATION DOES (all ADDITIVE)
--   1. New table  public.organizations  (+ Humphrey's seeded as the legacy org)
--   2. New table  public.org_invitations (admins invite teammates by email)
--   3. New column org_id on profiles and on EVERY business-data table.
--        - Added as  NOT NULL DEFAULT <Humphrey's id>  — in PostgreSQL ≥ 11 a
--          constant default is stored as metadata ("missing value"), so NO ROW
--          IS REWRITTEN, NO UPDATE RUNS, NO TRIGGER FIRES (updated_at stays
--          untouched, the period-lock trigger is never consulted).
--        - The default is then DROPPED so new rows don't silently inherit it;
--          existing rows keep reading Humphrey's id.
--   4. BEFORE INSERT trigger  aa_set_org_id  on every table: fills org_id from
--      the caller's profile when the app forgets it (so none of the ~85 insert
--      sites in the app had to change). Service-role scripts (no JWT) fall
--      back to the legacy org — Ricardo's import tooling keeps working as-is.
--   5. RESTRICTIVE RLS policy  org_isolation  on every table. Restrictive
--      policies are AND-ed with the existing permissive admin/limited policies,
--      so every existing policy stays exactly as it is — isolation is simply
--      layered on top. service_role bypasses RLS as before.
--   6. Uniqueness re-scoped from global to per-organization for the keys that
--      would otherwise collide the moment a second business posts its first
--      entry (period_close.period, journal_entries.reference, …). The new
--      composite key is strictly LOOSER than the old one, so every existing
--      row remains valid. No data is touched. (This is the only section that
--      drops anything — a constraint/index, never a row or a column.)
--   7. enforce_period_lock() made org-aware so Humphrey's closed 2024 periods
--      no longer lock a different business's 2024 entries. Behaviour for
--      Humphrey's itself is unchanged.
--   8. handle_new_user() rewritten: invited email → joins the inviting org with
--      the invited role; otherwise → brand-new organization, user is its
--      admin, defaults seeded. The client-supplied `role` is still IGNORED.
--   9. seed_organization_defaults(org) — a generic chart of accounts
--      (categories) for a new business.
--
-- WHAT THIS MIGRATION NEVER DOES
--   - No DROP TABLE, no DROP COLUMN, no DELETE, no UPDATE of business rows.
--   - Never touches L17 / L21 partner lines, period_close rows, or payroll JEs.
--
-- IDEMPOTENT — safe to re-run (IF NOT EXISTS / OR REPLACE / existence checks).
-- ROLLBACK — see migrations/ROLLBACK_organizations_multi_business.sql
-- ============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. organizations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text,
  business_type text NOT NULL DEFAULT 'other',
  is_legacy     boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_uq
  ON public.organizations (slug) WHERE slug IS NOT NULL;

-- Humphrey's — fixed id so the app and later migrations can refer to it.
INSERT INTO public.organizations (id, name, slug, business_type, is_legacy)
VALUES ('00000000-0000-4000-8000-000000000001',
        'Humphrey''s Restaurant & Tavern', 'humphreys', 'restaurant_bar', true)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.legacy_org_id()
RETURNS uuid
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT '00000000-0000-4000-8000-000000000001'::uuid $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. profiles.org_id + current_org_id()
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL
    DEFAULT '00000000-0000-4000-8000-000000000001'::uuid
    REFERENCES public.organizations(id);
ALTER TABLE public.profiles ALTER COLUMN org_id DROP DEFAULT;
CREATE INDEX IF NOT EXISTS profiles_org_idx ON public.profiles (org_id);

-- The caller's organization. SECURITY DEFINER so it can read profiles without
-- recursing through the profiles RLS policies (same pattern as is_admin()).
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT org_id FROM public.profiles WHERE id = auth.uid() $$;

GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.legacy_org_id()  TO authenticated, anon, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. org_invitations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.org_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'limited' CHECK (role IN ('admin', 'limited')),
  invited_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_invitations_email_idx ON public.org_invitations (lower(email));
CREATE INDEX IF NOT EXISTS org_invitations_org_idx   ON public.org_invitations (org_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. org_id auto-fill trigger function
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_org_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    -- Authenticated app user → their workspace. No JWT (service-role script,
    -- SQL editor) → the legacy workspace, exactly what those scripts assume.
    NEW.org_id := COALESCE(public.current_org_id(), public.legacy_org_id());
  END IF;
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. org_id + trigger + isolation policy on every business-data table
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t       text;
  tables  text[] := ARRAY[
    -- core books
    'accounts', 'categories', 'transactions', 'transaction_notes',
    'journal_entries', 'journal_entry_lines', 'journal_rules',
    'invoices', 'bank_statements', 'checks',
    -- accountant / close
    'period_close', 'close_checklist', 'report_deliverables',
    'accountant_chat', 'accountant_audit_log', 'cpa_sourced_locks',
    'close_scenarios', 'close_scenario_lines',
    'book_bs_statements', 'book_bs_lines', 'book_bs_line_mappings',
    'book_bs_line_txns', 'book_bs_line_asset_mappings', 'book_bs_line_adjustments',
    -- operations
    'assets', 'payroll_lines', 'payroll_months', 'daily_sales',
    'products', 'inventory_logs', 'supplier_categories',
    'tasks', 'calendar_events', 'marketing_assets', 'marketing_materials', 'reports',
    -- membership
    'profiles', 'org_invitations'
  ];
  v_relkind char;
  v_rls_on  boolean;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'organizations: table public.% not present — skipped', t;
      CONTINUE;
    END IF;
    SELECT c.relkind, c.relrowsecurity INTO v_relkind, v_rls_on
      FROM pg_class c WHERE c.oid = to_regclass('public.' || t);
    IF v_relkind NOT IN ('r', 'p') THEN
      RAISE NOTICE 'organizations: public.% is not a table (relkind %) — skipped', t, v_relkind;
      CONTINUE;
    END IF;

    -- (a) column — metadata-only add, no row rewrite, no triggers fired
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS org_id uuid NOT NULL '
      'DEFAULT ''00000000-0000-4000-8000-000000000001''::uuid '
      'REFERENCES public.organizations(id)', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id DROP DEFAULT', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (org_id)', t || '_org_idx', t);

    -- (b) auto-fill trigger. Name starts with "aa_" so it fires BEFORE the
    --     existing trg_* BEFORE-INSERT triggers (alphabetical order), which
    --     means enforce_period_lock() already sees NEW.org_id.
    EXECUTE format('DROP TRIGGER IF EXISTS aa_set_org_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER aa_set_org_id BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.set_org_id()', t);

    -- (c) isolation policy — RESTRICTIVE, so it only ever narrows what the
    --     existing permissive policies already allow.
    --     A table that had RLS switched OFF (some were created straight in
    --     the dashboard) was open to every authenticated user; keep that
    --     exact behaviour with a permissive policy, then narrow it to the org.
    IF NOT v_rls_on THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t AND p.permissive = 'PERMISSIVE') THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true)',
          'Authenticated users can CRUD ' || t, t);
        RAISE NOTICE 'organizations: public.% had RLS off — enabled with an open permissive policy (then org-isolated)', t;
      END IF;
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', t);
    IF t = 'profiles' THEN
      EXECUTE
        'CREATE POLICY org_isolation ON public.profiles AS RESTRICTIVE FOR ALL TO authenticated '
        'USING (org_id = public.current_org_id() OR id = auth.uid()) '
        'WITH CHECK (org_id = public.current_org_id() OR id = auth.uid())';
    ELSE
      EXECUTE format(
        'CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING (org_id = public.current_org_id()) '
        'WITH CHECK (org_id = public.current_org_id())', t);
    END IF;
  END LOOP;
END $$;

-- Permissive policies for the two NEW tables (restrictive isolation above
-- already applies to org_invitations; organizations is keyed by id).
DROP POLICY IF EXISTS "Members can view their organization" ON public.organizations;
CREATE POLICY "Members can view their organization"
  ON public.organizations FOR SELECT TO authenticated
  USING (id = public.current_org_id());

DROP POLICY IF EXISTS "Admins can update their organization" ON public.organizations;
CREATE POLICY "Admins can update their organization"
  ON public.organizations FOR UPDATE TO authenticated
  USING (id = public.current_org_id() AND public.is_admin())
  WITH CHECK (id = public.current_org_id() AND public.is_admin());

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage invitations" ON public.org_invitations;
CREATE POLICY "Admins can manage invitations"
  ON public.org_invitations FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Re-scope global unique keys to (org_id, …)
--    A second business must be able to close "2024-01", post "JE-001", have a
--    "2024 opening" balance sheet, etc. The composite key keeps every existing
--    Humphrey's row valid (it is a superset of the old guarantee within an org).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pg_temp.rescope_unique(p_table text, p_cols text[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_oid     oid;
  v_conname text;
  v_newname text;
  v_attnums int2[];
  v_cols    text;
BEGIN
  v_oid := to_regclass('public.' || p_table);
  IF v_oid IS NULL THEN
    RAISE NOTICE 'rescope_unique: public.% not present — skipped', p_table;
    RETURN;
  END IF;

  -- attnums of the requested columns, in order
  SELECT array_agg(a.attnum ORDER BY ord) INTO v_attnums
    FROM unnest(p_cols) WITH ORDINALITY AS c(name, ord)
    JOIN pg_attribute a ON a.attrelid = v_oid AND a.attname = c.name AND NOT a.attisdropped;
  IF v_attnums IS NULL OR array_length(v_attnums, 1) <> array_length(p_cols, 1) THEN
    RAISE NOTICE 'rescope_unique: public.% columns % not all present — skipped', p_table, p_cols;
    RETURN;
  END IF;

  v_newname := p_table || '_org_' || array_to_string(p_cols, '_') || '_key';
  v_cols    := (SELECT string_agg(format('%I', c), ', ') FROM unnest(p_cols) c);

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = v_oid AND conname = v_newname) THEN
    RAISE NOTICE 'rescope_unique: public.% already per-org on % — nothing to do', p_table, p_cols;
    RETURN;
  END IF;

  -- (a) a UNIQUE constraint on exactly these columns (tables created by the repo SQL)
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = v_oid AND contype = 'u' AND conkey = v_attnums;
  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', p_table, v_conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (org_id, %s)', p_table, v_newname, v_cols);
    RAISE NOTICE 'rescope_unique: public.%: constraint % -> % (org_id, %)', p_table, v_conname, v_newname, v_cols;
    RETURN;
  END IF;

  -- (b) a plain UNIQUE INDEX on exactly these columns (tables created in the dashboard)
  SELECT ic.relname INTO v_conname
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
   WHERE i.indrelid = v_oid AND i.indisunique AND NOT i.indisprimary
     AND i.indpred IS NULL AND i.indexprs IS NULL
     -- int2vector casts to a ZERO-based array, so compare the element lists
     AND (SELECT array_agg(k ORDER BY ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY u(k, ord)) = v_attnums
     AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid);
  IF v_conname IS NOT NULL THEN
    EXECUTE format('DROP INDEX public.%I', v_conname);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (org_id, %s)', p_table, v_newname, v_cols);
    RAISE NOTICE 'rescope_unique: public.%: index % -> % (org_id, %)', p_table, v_conname, v_newname, v_cols;
    RETURN;
  END IF;

  RAISE NOTICE 'rescope_unique: public.% has no global UNIQUE on % — skipped', p_table, p_cols;
END;
$$;

SELECT pg_temp.rescope_unique('period_close',       ARRAY['period']);
SELECT pg_temp.rescope_unique('close_checklist',    ARRAY['period', 'step_key']);
SELECT pg_temp.rescope_unique('journal_entries',    ARRAY['reference']);
SELECT pg_temp.rescope_unique('cpa_sourced_locks',  ARRAY['year', 'kind']);
SELECT pg_temp.rescope_unique('payroll_months',     ARRAY['pay_month']);

-- book_bs_statements is keyed by bare `year` (PRIMARY KEY). Re-key to
-- (org_id, year) so a second business can have its own 2024/2025 statement.
-- The app upserts on the primary key; aa_set_org_id fills org_id before the
-- conflict check runs, so the existing upsert keeps working unchanged.
DO $$
DECLARE
  v_oid  oid := to_regclass('public.book_bs_statements');
  v_cols text;
BEGIN
  IF v_oid IS NULL THEN RETURN; END IF;
  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO v_cols
    FROM pg_constraint c
    JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = v_oid AND c.contype = 'p';
  IF v_cols = 'year' THEN
    ALTER TABLE public.book_bs_statements DROP CONSTRAINT book_bs_statements_pkey;
    ALTER TABLE public.book_bs_statements ADD CONSTRAINT book_bs_statements_pkey PRIMARY KEY (org_id, year);
    RAISE NOTICE 'book_bs_statements primary key re-keyed to (org_id, year)';
  ELSE
    RAISE NOTICE 'book_bs_statements primary key is (%) — left as is', v_cols;
  END IF;
END $$;
SELECT pg_temp.rescope_unique('checks',             ARRAY['check_no', 'amount', 'clear_date']);
SELECT pg_temp.rescope_unique('close_scenarios',    ARRAY['slug']);
SELECT pg_temp.rescope_unique('daily_sales',        ARRAY['date']);
-- App upserts that name these keys (periodClose.js, CloseWizard, AccountantPage,
-- StatementReviewMatch, BookBalanceSheetPage, DailySalesPage) were updated in the
-- same change to `onConflict: 'org_id,…'`. Deploy order: this migration first,
-- then the code — the new onConflict targets need the composite keys to exist.

-- Unique INDEXES (not constraints) that would collide across businesses.
DO $$
BEGIN
  IF to_regclass('public.book_bs_lines') IS NOT NULL
     AND to_regclass('public.book_bs_lines_year_section_title_uq') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                      WHERE i.indexrelid = 'public.book_bs_lines_year_section_title_uq'::regclass AND a.attname = 'org_id') THEN
    DROP INDEX public.book_bs_lines_year_section_title_uq;
    CREATE UNIQUE INDEX book_bs_lines_year_section_title_uq
      ON public.book_bs_lines (org_id, year, section_code, lower(title));
    RAISE NOTICE 'book_bs_lines_year_section_title_uq re-scoped to org';
  END IF;

  IF to_regclass('public.transactions') IS NOT NULL
     AND to_regclass('public.transactions_import_key_uniq') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                      WHERE i.indexrelid = 'public.transactions_import_key_uniq'::regclass AND a.attname = 'org_id') THEN
    DROP INDEX public.transactions_import_key_uniq;
    CREATE UNIQUE INDEX transactions_import_key_uniq
      ON public.transactions (org_id, import_key) WHERE import_key IS NOT NULL;
    RAISE NOTICE 'transactions_import_key_uniq re-scoped to org';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. enforce_period_lock() — org-aware
--    Identical to the 2026-06-17 version except the period_close lookup is
--    now restricted to the row's own organization. For Humphrey's every row
--    carries the legacy org id, so nothing changes for the existing books.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_period_lock()
RETURNS TRIGGER AS $$
DECLARE
  txn_period   TEXT;
  close_status TEXT;
  target_date  DATE;
  target_org   UUID;
  should_check BOOLEAN := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_date  := OLD.date;
    target_org   := OLD.org_id;
    should_check := true;
  ELSIF TG_OP = 'INSERT' THEN
    target_date  := NEW.date;
    target_org   := NEW.org_id;
    should_check := true;
  ELSIF TG_OP = 'UPDATE' THEN
    target_date  := NEW.date;
    target_org   := NEW.org_id;
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

  -- Rows written by a service-role script before aa_set_org_id ran (it can't:
  -- aa_ sorts first) or legacy rows → fall back to the legacy org.
  target_org := COALESCE(target_org, public.legacy_org_id());

  txn_period := to_char(target_date, 'YYYY-MM');
  SELECT status INTO close_status
    FROM public.period_close
   WHERE period = txn_period
     AND org_id = target_org;

  IF close_status = 'closed' THEN
    RAISE EXCEPTION 'PERIOD_LOCKED: % is closed. Reopen the period from the Accountant page before writing to it.', txn_period
      USING ERRCODE = 'P0001';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Defaults for a new business (generic chart of accounts = categories)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_organization_defaults(p_org uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.categories') IS NULL THEN RETURN; END IF;
  -- Only seed an empty workspace — never add rows to a business that has books.
  IF EXISTS (SELECT 1 FROM public.categories WHERE org_id = p_org) THEN RETURN; END IF;

  INSERT INTO public.categories (org_id, name, type, description) VALUES
    (p_org, 'Cost of Goods Sold (COGS)',   'expense',   'Direct cost of the products or services you sell'),
    (p_org, 'Salaries & Wages',            'expense',   'Gross pay to employees'),
    (p_org, 'Payroll Taxes',               'expense',   'Employer share of payroll taxes'),
    (p_org, 'Contractors',                 'expense',   'Payments to 1099 contractors'),
    (p_org, 'Rent',                        'expense',   ''),
    (p_org, 'Utilities',                   'expense',   'Electric, gas, water, internet, phone'),
    (p_org, 'Repairs & Maintenance',       'expense',   ''),
    (p_org, 'Insurance',                   'expense',   ''),
    (p_org, 'Marketing & Advertising',     'expense',   ''),
    (p_org, 'Office Supplies',             'expense',   ''),
    (p_org, 'Software & Subscriptions',    'expense',   ''),
    (p_org, 'Transport & Delivery',        'expense',   ''),
    (p_org, 'Bank Charges',                'expense',   ''),
    (p_org, 'Merchant Processing Fees',    'expense',   'Card processing fees'),
    (p_org, 'Licenses & Permits',          'expense',   ''),
    (p_org, 'Professional Fees',           'expense',   'Accounting, legal, consulting'),
    (p_org, 'Travel & Meals',              'expense',   ''),
    (p_org, 'Depreciation Expense',        'expense',   'Depreciation of fixed assets'),
    (p_org, 'Miscellaneous',               'expense',   ''),
    (p_org, 'Sales Revenue',               'revenue',   'Product sales'),
    (p_org, 'Service Revenue',             'revenue',   'Services rendered'),
    (p_org, 'Other Income',                'revenue',   ''),
    (p_org, 'Cash',                        'asset',     ''),
    (p_org, 'Bank Account',                'asset',     'Operating checking account'),
    (p_org, 'Accounts Receivable',         'asset',     ''),
    (p_org, 'Inventory',                   'asset',     ''),
    (p_org, 'Equipment',                   'asset',     ''),
    (p_org, 'Accumulated Depreciation',    'asset',     'Contra-asset'),
    (p_org, 'Accounts Payable',            'liability', ''),
    (p_org, 'Credit Card Payable',         'liability', ''),
    (p_org, 'Sales Tax Payable',           'liability', ''),
    (p_org, 'Loans',                       'liability', ''),
    (p_org, 'Owner Equity',                'equity',    ''),
    (p_org, 'Owner Draws',                 'equity',    ''),
    (p_org, 'Retained Earnings',           'equity',    '');
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. handle_new_user() — workspace-aware sign-up
--    Replaces the hardened 2026 version (which forced role = 'limited').
--    The client-supplied `role` is STILL ignored. Only an existing invitation
--    (written by an admin of that org under RLS) can place a new user into an
--    existing workspace.
-- ─────────────────────────────────────────────────────────────────────────────
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
BEGIN
  v_full_name := COALESCE(NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''), '');

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

  INSERT INTO public.profiles (id, full_name, email, role, org_id)
  VALUES (NEW.id, v_full_name, COALESCE(NEW.email, ''), v_role, v_org)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Trigger object is unchanged (AFTER INSERT ON auth.users), recreate only if missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Sanity checks — abort the transaction if anything is off.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_orphans bigint;
  n_profiles bigint;
BEGIN
  SELECT count(*) INTO n_profiles FROM public.profiles WHERE org_id IS NULL;
  IF n_profiles <> 0 THEN
    RAISE EXCEPTION 'organizations: % profiles without org_id', n_profiles;
  END IF;
  IF to_regclass('public.transactions') IS NOT NULL THEN
    SELECT count(*) INTO n_orphans FROM public.transactions WHERE org_id IS NULL;
    IF n_orphans <> 0 THEN
      RAISE EXCEPTION 'organizations: % transactions without org_id', n_orphans;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = public.legacy_org_id()) THEN
    RAISE EXCEPTION 'organizations: legacy organization row missing';
  END IF;
  RAISE NOTICE 'organizations: OK — legacy org present, all rows scoped';
END $$;

COMMIT;
