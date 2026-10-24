-- ════════════════════════════════════════════════════════════════════════════
-- PLATFORM LEADS — the sales funnel, for the people who run SelRic
--
-- Two motions feed it: the founder reaching out to businesses in the United
-- States, and a field agent gathering ranches for Batavia in Nicaragua. Both
-- land in one table, tagged by region and program, so the dashboard can show
-- each funnel on its own and compare it to a benchmark.
--
-- Every stage change is logged to platform_lead_events by trigger, which is
-- what makes velocity (days from first contact to paying) measurable later
-- without anyone remembering to write it down.
--
-- Readable and writable only by platform admins, same gate as everything
-- else under /ceo. The `owner` column is where the Nicaragua agent's name
-- goes today; giving that agent their own login, scoped to their region, is
-- a later migration — this schema is shaped so it will not need to change.
--
-- Idempotent. The seed is the five real prospects that exist today.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Leads ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  region           text NOT NULL CHECK (region IN ('us', 'ni')),
  program          text NOT NULL CHECK (program IN ('business', 'ganaderia')),
  name             text NOT NULL,                       -- the business or the finca
  contact          text,                                -- the person
  phone            text,
  email            text,
  head_count       integer CHECK (head_count IS NULL OR head_count >= 0),   -- Ganadería: decides the tier
  source           text NOT NULL DEFAULT 'outbound'
                     CHECK (source IN ('referral', 'outbound', 'event', 'agent', 'inbound', 'other')),
  referred_by      text,
  stage            text NOT NULL DEFAULT 'lead'
                     CHECK (stage IN ('lead', 'contacted', 'demo', 'pilot', 'paying', 'lost')),
  stage_changed_at timestamptz NOT NULL DEFAULT now(),
  lost_reason      text,
  owner            text NOT NULL DEFAULT 'founder',     -- who is working it: 'founder' or the agent's name
  next_action      text,
  next_action_at   date,
  notes            text
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_leads_name_program_idx
  ON public.platform_leads (lower(name), program);
CREATE INDEX IF NOT EXISTS platform_leads_stage_idx ON public.platform_leads (region, program, stage);

-- ─── 2. Stage history ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_lead_events (
  id         bigserial PRIMARY KEY,
  lead_id    uuid NOT NULL REFERENCES public.platform_leads(id) ON DELETE CASCADE,
  at         timestamptz NOT NULL DEFAULT now(),
  from_stage text,
  to_stage   text NOT NULL,
  note       text
);
CREATE INDEX IF NOT EXISTS platform_lead_events_lead_idx ON public.platform_lead_events (lead_id, at);

-- Written by trigger only. SECURITY DEFINER so the insert into the events
-- table works without granting authenticated any write on it.
CREATE OR REPLACE FUNCTION public.platform_leads_track()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.platform_lead_events (lead_id, from_stage, to_stage) VALUES (NEW.id, NULL, NEW.stage);
    RETURN NEW;
  END IF;
  NEW.updated_at := now();
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    NEW.stage_changed_at := now();
    IF NEW.stage <> 'lost' THEN NEW.lost_reason := NULL; END IF;
    INSERT INTO public.platform_lead_events (lead_id, from_stage, to_stage, note)
    VALUES (NEW.id, OLD.stage, NEW.stage, CASE WHEN NEW.stage = 'lost' THEN NEW.lost_reason END);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS platform_leads_track_ins ON public.platform_leads;
CREATE TRIGGER platform_leads_track_ins AFTER INSERT ON public.platform_leads
  FOR EACH ROW EXECUTE FUNCTION public.platform_leads_track();
DROP TRIGGER IF EXISTS platform_leads_track_upd ON public.platform_leads;
CREATE TRIGGER platform_leads_track_upd BEFORE UPDATE ON public.platform_leads
  FOR EACH ROW EXECUTE FUNCTION public.platform_leads_track();

-- ─── 3. Access: platform admins only ────────────────────────────────────────
ALTER TABLE public.platform_leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_leads admin all" ON public.platform_leads;
CREATE POLICY "platform_leads admin all" ON public.platform_leads
  FOR ALL TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "platform_lead_events admin read" ON public.platform_lead_events;
CREATE POLICY "platform_lead_events admin read" ON public.platform_lead_events
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

REVOKE ALL ON public.platform_leads       FROM anon, authenticated;
REVOKE ALL ON public.platform_lead_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_leads TO authenticated;
GRANT SELECT ON public.platform_lead_events TO authenticated;

-- ─── 4. Seed: the prospects that exist today ────────────────────────────────
-- The four pilots, at the pilot stage, and Finca Batavia, which has an unused
-- invitation — contacted, not yet in. Nothing invented.
INSERT INTO public.platform_leads (region, program, name, source, stage, owner, notes)
SELECT CASE WHEN o.name ILIKE 'Humphrey%' THEN 'us' ELSE 'ni' END,
       COALESCE((SELECT p.program FROM public.org_programs p WHERE p.org_id = o.id ORDER BY p.program LIMIT 1), 'business'),
       o.name, 'referral', 'pilot', 'founder',
       'Seeded from the live workspace on ' || to_char(now(), 'YYYY-MM-DD') || '. Free pilot; not billed.'
  FROM public.organizations o
 WHERE NOT o.is_internal
ON CONFLICT (lower(name), program) DO NOTHING;

INSERT INTO public.platform_leads (region, program, name, source, stage, owner, next_action, notes)
VALUES ('ni', 'ganaderia', 'Finca Batavia', 'referral', 'contacted', 'founder',
        'Sign up with PILOT-BATV-0001 and load the first 10-15 animals',
        'The reference ranch. Invitation issued 2026-10-23, unused.')
ON CONFLICT (lower(name), program) DO NOTHING;

-- ─── 5. Sanity ──────────────────────────────────────────────────────────────
DO $$
DECLARE n integer; e integer;
BEGIN
  SELECT count(*) INTO n FROM public.platform_leads;
  SELECT count(*) INTO e FROM public.platform_lead_events;
  IF n = 0 THEN RAISE EXCEPTION 'platform-leads: seed produced no rows'; END IF;
  IF e < n THEN RAISE EXCEPTION 'platform-leads: trigger did not log the seed (% leads, % events)', n, e; END IF;
  RAISE NOTICE 'platform-leads: OK — % lead(s), % event(s)', n, e;
END $$;

COMMIT;
