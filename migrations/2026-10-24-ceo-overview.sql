-- ════════════════════════════════════════════════════════════════════════════
-- CEO OVERVIEW — cross-workspace oversight for the people who run SelRic
--
-- Every other read in this database is deliberately trapped inside one
-- workspace by the org_isolation policies. That is correct for customers and
-- useless for the founder, who cannot otherwise tell that a pilot has gone
-- quiet.
--
-- Rather than weaken any policy, this adds a narrow, explicit exception:
--   • platform_admins — a short list of EMAILS, readable only by the person it names
--   • ceo_overview()  — SECURITY DEFINER, returns aggregates ONLY, and raises
--                       if the caller is not on that list
--
-- The function returns counts and dates. It never returns a customer's rows,
-- a transaction, an animal or a person's name from another workspace. If a
-- future version needs to, it should be a different function with its own
-- justification, not an extension of this one.
--
-- WHY EMAIL AND NOT user_id. The first draft keyed on auth.users(id), which
-- silently does nothing when the account does not exist yet — and the intended
-- CEO account, novoaricardo7@gmail.com, did not. Keying on email means the
-- person becomes a platform admin the moment they sign up, in either order,
-- with no second step to forget. For a list of one or two people that is the
-- right trade; it would not be for a large one.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Who is allowed to see across workspaces ─────────────────────────────
-- An earlier draft of this table was keyed on user_id. Drop it if it is there;
-- nothing has ever been written to it.
DROP TABLE IF EXISTS public.platform_admins;

CREATE TABLE public.platform_admins (
  email      text PRIMARY KEY,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- You may see your own row and nobody else's. There is no INSERT, UPDATE or
-- DELETE grant at all: adding a platform admin is a deliberate SQL statement
-- run by a human, which is the point of the table.
DROP POLICY IF EXISTS "platform_admins self read" ON public.platform_admins;
CREATE POLICY "platform_admins self read" ON public.platform_admins
  FOR SELECT TO authenticated
  USING (lower(email) = lower((SELECT u.email FROM auth.users u WHERE u.id = auth.uid())));
GRANT SELECT ON public.platform_admins TO authenticated;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.platform_admins pa
      JOIN auth.users u ON u.id = auth.uid()
     WHERE lower(pa.email) = lower(u.email)
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM anon;

-- ─── 2. The overview ────────────────────────────────────────────────────────
-- Aggregates per workspace plus platform totals. Counts and dates only.
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
      -- "Alive" means someone put something in recently. Rows the founder
      -- back-filled himself still count, so this is a ceiling on health, never
      -- a floor: a workspace that looks quiet here is definitely quiet.
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
  ) s;

  -- Platform-level counts that do not belong to any one workspace.
  result := result || jsonb_build_object(
    'platform', jsonb_build_object(
      'workspaces',      (SELECT count(*) FROM public.organizations),
      'users',           (SELECT count(*) FROM public.profiles),
      'paying',          (SELECT count(*) FROM public.organizations WHERE COALESCE(plan, 'pilot') NOT IN ('pilot', 'trial')),
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
GRANT EXECUTE ON FUNCTION public.ceo_overview() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.ceo_overview() FROM anon;

-- ─── 3. The platform admins ─────────────────────────────────────────────────
-- Email keyed, so this works whether or not the account exists yet. The CEO
-- account is novoaricardo7@gmail.com; the outlook address is the founder's
-- login on the Humphrey's workspace and is listed so he does not lock himself
-- out of oversight while the new account is being set up. Delete that second
-- row once the CEO account is in use.
INSERT INTO public.platform_admins (email, note) VALUES
  ('novoaricardo7@gmail.com',       'CEO'),
  ('ricardo.humphreys@outlook.com', 'Founder — existing login, remove once the CEO account is in use')
ON CONFLICT (email) DO NOTHING;

-- To add someone later:
--   INSERT INTO public.platform_admins (email, note) VALUES ('<email>', '<who>');
-- To remove:
--   DELETE FROM public.platform_admins WHERE email = '<email>';

-- ─── 4. Sanity ──────────────────────────────────────────────────────────────
DO $$
DECLARE n integer; m integer;
BEGIN
  SELECT count(*) INTO n FROM public.platform_admins;
  IF n = 0 THEN RAISE EXCEPTION 'ceo-overview: no platform admins were seeded'; END IF;
  SELECT count(*) INTO m
    FROM public.platform_admins pa
    JOIN auth.users u ON lower(u.email) = lower(pa.email);
  RAISE NOTICE 'ceo-overview: OK — % admin email(s) listed, % of them with an account that exists today', n, m;
  IF m = 0 THEN
    RAISE WARNING 'ceo-overview: none of the listed emails has an account yet. Oversight unlocks when one signs in.';
  END IF;
END $$;

COMMIT;
