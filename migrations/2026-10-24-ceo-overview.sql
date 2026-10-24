-- ════════════════════════════════════════════════════════════════════════════
-- CEO OVERVIEW — cross-workspace oversight for the people who run SelRic
--
-- Every other read in this database is deliberately trapped inside one
-- workspace by the org_isolation policies. That is correct for customers and
-- useless for the founder, who needs to see all of them at once and cannot,
-- today, tell that a pilot has gone quiet.
--
-- Rather than weaken any policy, this adds a narrow, explicit exception:
--   • platform_admins — a short list of user ids, readable only by the people on it
--   • ceo_overview()  — SECURITY DEFINER, returns aggregates ONLY, and raises
--                       if the caller is not on that list
--
-- The function returns counts and dates. It never returns a customer's rows,
-- a transaction, an animal or a person's name from another workspace. If a
-- future version needs to, it should be a different function with its own
-- justification, not an extension of this one.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Who is allowed to see across workspaces ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Only a platform admin can see the list, and nobody can edit it from the app.
-- Adding someone is a deliberate SQL statement, which is the point.
DROP POLICY IF EXISTS "platform_admins self read" ON public.platform_admins;
CREATE POLICY "platform_admins self read" ON public.platform_admins
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT ON public.platform_admins TO authenticated;

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
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
      -- "Alive" means someone put something in recently. Rows that the founder
      -- back-filled himself are still activity, so this is a ceiling on health,
      -- never a floor: a quiet workspace here is definitely quiet.
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

-- ─── 3. Seed the founder ────────────────────────────────────────────────────
-- Ricardo's account on Humphrey's. Idempotent; does nothing if the user is absent.
INSERT INTO public.platform_admins (user_id, note)
SELECT id, 'Founder'
  FROM auth.users
 WHERE lower(email) = 'ricardo.humphreys@outlook.com'
ON CONFLICT (user_id) DO NOTHING;

-- ─── 4. Sanity ──────────────────────────────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM public.platform_admins;
  RAISE NOTICE 'ceo-overview: OK — % platform admin(s)', n;
  IF n = 0 THEN
    RAISE WARNING 'ceo-overview: nobody is a platform admin yet. Add one with: INSERT INTO public.platform_admins (user_id, note) SELECT id, ''Founder'' FROM auth.users WHERE lower(email) = ''<your email>'';';
  END IF;
END $$;

COMMIT;
