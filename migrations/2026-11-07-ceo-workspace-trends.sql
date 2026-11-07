-- ════════════════════════════════════════════════════════════════════════════
-- CEO OVERVIEW — twelve weeks of activity and the last check run, per workspace
--
-- The Overview and Pilots tabs on /ceo show, for every customer workspace, a
-- sparkline of what people put in week by week and a health score from the
-- integrity checks. Both come from ceo_overview(), which already aggregates
-- each workspace without showing its rows. Two keys are added to each
-- workspace object; everything else the function returns is unchanged:
--
--   activity_weeks  twelve counts, oldest first, the newest week ending now:
--                   rows created in sales, customers, inventory_logs,
--                   lv_animals and lv_events (the same sources as
--                   activity_30d and last_activity)
--   checks          the newest integrity_results row per check:
--                   [{ key, status, skipped, run_at }] — the page turns it
--                   into the score with the same healthScore() as /checks
--
-- Internal and test workspaces are still left out (NOT o.is_internal AND NOT
-- o.is_test), as in 2026-11-05-is-test-orgs.sql. Until this file is applied
-- the two keys are absent and the page says "no runs yet" / no sparkline.
--
-- Requires 2026-11-05-is-test-orgs.sql (is_test, the current ceo_overview())
-- and 2026-11-07-integrity-checks.sql (integrity_results) — the first block
-- raises if the second is missing. Idempotent: CREATE OR REPLACE FUNCTION.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.integrity_results') IS NULL THEN
    RAISE EXCEPTION 'apply migrations/2026-11-07-integrity-checks.sql first (integrity_results is missing)';
  END IF;
END $$;

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
      ),
      -- Week 11 is the seven days ending now; week 0 began 84 days ago.
      'activity_weeks', (
        SELECT jsonb_agg(COALESCE(x.n, 0) ORDER BY g.wk)
          FROM generate_series(0, 11) AS g(wk)
          LEFT JOIN (
            SELECT 11 - floor(extract(epoch FROM (now() - t.at)) / 604800)::int AS wk, count(*) AS n
              FROM (
                SELECT s.created_at AS at FROM public.sales s          WHERE s.org_id = o.id AND s.created_at > now() - interval '84 days'
                UNION ALL
                SELECT c.created_at FROM public.customers c            WHERE c.org_id = o.id AND c.created_at > now() - interval '84 days'
                UNION ALL
                SELECT i.created_at FROM public.inventory_logs i       WHERE i.org_id = o.id AND i.created_at > now() - interval '84 days'
                UNION ALL
                SELECT a.created_at FROM public.lv_animals a           WHERE a.org_id = o.id AND a.created_at > now() - interval '84 days'
                UNION ALL
                SELECT e.created_at FROM public.lv_events e            WHERE e.org_id = o.id AND e.created_at > now() - interval '84 days'
              ) t
             GROUP BY 1
          ) x ON x.wk = g.wk
      ),
      -- The newest stored result of each check for this workspace.
      'checks', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('key', r.check_key, 'status', r.status, 'skipped', r.detail ? 'skipped', 'run_at', r.run_at) ORDER BY r.check_key)
          FROM (
            SELECT DISTINCT ON (ir.check_key) ir.check_key, ir.status, ir.detail, ir.run_at
              FROM public.integrity_results ir
             WHERE ir.org_id = o.id
             ORDER BY ir.check_key, ir.run_at DESC
          ) r
      ), '[]'::jsonb)
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
  def text := pg_get_functiondef('public.ceo_overview()'::regprocedure);
BEGIN
  IF position('NOT o.is_test' IN def) = 0 OR position('NOT o.is_internal' IN def) = 0 THEN
    RAISE EXCEPTION 'ceo_overview() no longer skips internal and test workspaces';
  END IF;
  IF position('activity_weeks' IN def) = 0 OR position('integrity_results' IN def) = 0 THEN
    RAISE EXCEPTION 'ceo_overview() is missing activity_weeks or the checks';
  END IF;
  IF has_function_privilege('anon', 'public.ceo_overview()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute ceo_overview()';
  END IF;
  RAISE NOTICE 'ceo_overview(): activity_weeks and checks per workspace; internal and test workspaces skipped';
END $$;

COMMIT;
