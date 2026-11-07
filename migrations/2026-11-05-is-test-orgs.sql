-- ════════════════════════════════════════════════════════════════════════════
-- TEST WORKSPACES — organizations.is_test, and the overview leaves them out
--
-- Two workspaces exist only to check the app: "Finca Prueba (smoke)", which the
-- automated smoke test signs in to, and "Finca Demo", the invented herd the
-- Ganadería screenshots are taken from. Both are ordinary organizations with
-- real rows, so ceo_overview() counted them as pilots. They are marked is_test
-- by id, and ceo_overview() — the Overview and Pilots tabs on /ceo and the
-- platform totals — skips them the same way it already skips internal ones.
--
-- Also narrows EXECUTE on ceo_overview() to authenticated (it raises for
-- anyone who is not a platform admin; anon has no reason to reach it).
--
-- Requires 2026-10-24-ceo-workspace.sql (is_internal, the current ceo_overview()).
-- Idempotent: ADD COLUMN IF NOT EXISTS, an IS DISTINCT FROM guard on the update,
-- CREATE OR REPLACE FUNCTION.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The flag ────────────────────────────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

-- ─── 2. The two test workspaces, by id ──────────────────────────────────────
UPDATE public.organizations
   SET is_test = true
 WHERE id IN ('5379dede-2533-46d8-808e-74be0f92f1e6',   -- Finca Prueba (smoke)
              '15c2cb5d-cb2f-4466-aeb4-eb7cfc485652')   -- Finca Demo
   AND is_test IS DISTINCT FROM true;

-- ─── 3. The overview ignores internal and test organizations ────────────────
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
    WHERE NOT o.is_internal AND NOT o.is_test
  ) s;

  result := result || jsonb_build_object(
    'platform', jsonb_build_object(
      'workspaces',      (SELECT count(*) FROM public.organizations WHERE NOT is_internal AND NOT is_test),
      'users',           (SELECT count(*) FROM public.profiles pr
                            JOIN public.organizations o ON o.id = pr.org_id WHERE NOT o.is_internal AND NOT o.is_test),
      'paying',          (SELECT count(*) FROM public.organizations
                           WHERE NOT is_internal AND NOT is_test AND COALESCE(plan, 'pilot') NOT IN ('pilot', 'trial')),
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

REVOKE EXECUTE ON FUNCTION public.ceo_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ceo_overview() TO authenticated;

-- ─── Sanity ─────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_test  int;
  names   text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'is_test') THEN
    RAISE EXCEPTION 'organizations.is_test missing';
  END IF;
  SELECT count(*), string_agg(name, ' | ' ORDER BY name) INTO n_test, names
    FROM public.organizations WHERE is_test;
  IF n_test <> 2 OR names <> 'Finca Demo | Finca Prueba (smoke)' THEN
    RAISE EXCEPTION 'expected exactly Finca Demo and Finca Prueba (smoke) as test workspaces, got % (%)', n_test, names;
  END IF;
  IF position('NOT o.is_test' IN pg_get_functiondef('public.ceo_overview()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'ceo_overview() does not skip test workspaces';
  END IF;
  IF has_function_privilege('anon', 'public.ceo_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can still execute ceo_overview()';
  END IF;
  RAISE NOTICE 'is_test: % test workspaces (%); ceo_overview() skips them', n_test, names;
END $$;

COMMIT;
