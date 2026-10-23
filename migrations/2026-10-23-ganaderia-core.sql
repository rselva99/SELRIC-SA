-- ============================================================================
-- 2026-10-23  Batavia Ganadería — core tables (phase 2, first cut)
-- ============================================================================
-- The Ganadería program keeps a card per animal and a line for everything
-- that happens to it. Two tables, prefixed lv_ (livestock) so the Business
-- tables never touch them and vice versa:
--
--   1. public.lv_animals  — one row per animal: name, tag (chapa), brand
--                           (fierro), species, category, sex, lot, dam/sire,
--                           calvings, last pregnancy check, last weight,
--                           status, flags, notes. `slug` is the stable key a
--                           workspace knows the animal by (the import id, or
--                           a slug of the name) — unique per workspace.
--   2. public.lv_events   — the timeline: type, date, a small jsonb of typed
--                           fields, a free note, the source text it was read
--                           from (the notebook / the inventory sheet) and an
--                           import_key so a seed can be re-run safely.
--   3. lv_record_event(jsonb) — writes one event and applies what it means
--                           to the animal in the SAME transaction: a calving
--                           adds one to `calvings` (and can create the calf's
--                           card), a pregnancy check sets pregnant / months,
--                           a weight sets the last weight, a sale or a death
--                           closes the card, a move changes the lot.
--   4. lv_delete_event(uuid)  — removes an event and undoes the simple
--                           effects above (recomputes from the events left).
--   5. check_invite(text)   — now also returns the invite's program, so the
--                           sign-up form can ask for a finca's name.
--
-- Both tables get the standard multi-business treatment from
-- 2026-10-18-organizations-multi-business.sql: org_id, the aa_set_org_id
-- BEFORE INSERT trigger, a permissive member policy and the RESTRICTIVE
-- org_isolation policy. The RPCs are SECURITY INVOKER, so RLS applies.
--
-- Additive: new tables and functions only. Nothing in the Business tables is
-- read or changed. Idempotent — safe to run again. Tested on the replica.
-- The pilot's herd (Finca Batavia, 0426 inventory) is loaded by a separate
-- seed that lives outside this repository.
-- ============================================================================

BEGIN;

-- ─── 1. lv_animals ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lv_animals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug             text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,78}$'),
  name             text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  name_original    text NOT NULL DEFAULT '' CHECK (char_length(name_original) <= 80),
  aliases          text[] NOT NULL DEFAULT '{}',
  tag              text NOT NULL DEFAULT '' CHECK (char_length(tag) <= 40),      -- chapa / arete
  brand            text NOT NULL DEFAULT '' CHECK (char_length(brand) <= 40),    -- fierro
  brand_note       text NOT NULL DEFAULT '' CHECK (char_length(brand_note) <= 200),
  species          text NOT NULL DEFAULT 'bovino' CHECK (species IN ('bovino', 'porcino')),
  category         text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 30), -- vaca, toro, ternero, ternera, novillo, vaquilla, cerda, verraco, lechon, engorde
  sex              text NOT NULL CHECK (sex IN ('H', 'M')),
  lot              text NOT NULL DEFAULT '' CHECK (char_length(lot) <= 60),
  breed            text NOT NULL DEFAULT '' CHECK (char_length(breed) <= 60),
  dam_id           uuid REFERENCES public.lv_animals(id) ON DELETE SET NULL,
  dam_name         text NOT NULL DEFAULT '' CHECK (char_length(dam_name) <= 80),  -- survives a missing / deleted dam card
  sire_id          uuid REFERENCES public.lv_animals(id) ON DELETE SET NULL,
  sire_name        text NOT NULL DEFAULT '' CHECK (char_length(sire_name) <= 80),
  birth_date       date,
  calvings         integer NOT NULL DEFAULT 0 CHECK (calvings >= 0),             -- partos
  pregnant         boolean,                                                       -- last pregnancy check; NULL = not checked
  preg_months      numeric(3,1) CHECK (preg_months BETWEEN 0 AND 12),
  preg_date        date,
  last_weight_kg   numeric(7,2) CHECK (last_weight_kg >= 0),
  last_weight_date date,
  status           text NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'vendido', 'muerto', 'historico')),
  flags            text[] NOT NULL DEFAULT '{}',
  notes            text[] NOT NULL DEFAULT '{}',
  origin           text NOT NULL DEFAULT 'app' CHECK (char_length(origin) <= 40),
  extra            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);
ALTER TABLE public.lv_animals DROP CONSTRAINT IF EXISTS lv_animals_extra_is_object;
ALTER TABLE public.lv_animals ADD CONSTRAINT lv_animals_extra_is_object CHECK (jsonb_typeof(extra) = 'object');
CREATE INDEX IF NOT EXISTS lv_animals_org_idx        ON public.lv_animals (org_id);
CREATE INDEX IF NOT EXISTS lv_animals_org_status_idx ON public.lv_animals (org_id, status);
CREATE INDEX IF NOT EXISTS lv_animals_org_lot_idx    ON public.lv_animals (org_id, lot);
CREATE INDEX IF NOT EXISTS lv_animals_dam_idx        ON public.lv_animals (dam_id) WHERE dam_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lv_animals_sire_idx       ON public.lv_animals (sire_id) WHERE sire_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.lv_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lv_animals_touch_updated_at ON public.lv_animals;
CREATE TRIGGER lv_animals_touch_updated_at
  BEFORE UPDATE ON public.lv_animals
  FOR EACH ROW EXECUTE FUNCTION public.lv_touch_updated_at();

-- ─── 2. lv_events ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lv_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  animal_id   uuid NOT NULL REFERENCES public.lv_animals(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN (
                'parto', 'mal_parto', 'palpacion', 'servicio', 'celo', 'destete',
                'peso', 'leche', 'vacuna', 'salud', 'venta', 'muerte', 'traslado', 'nota')),
  date        date NOT NULL DEFAULT CURRENT_DATE,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text NOT NULL DEFAULT '' CHECK (char_length(note) <= 2000),
  source      text NOT NULL DEFAULT '' CHECK (char_length(source) <= 400),  -- the notebook / sheet text it came from
  origin      text NOT NULL DEFAULT 'app' CHECK (char_length(origin) <= 40),
  import_key  text CHECK (char_length(import_key) <= 80),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lv_events DROP CONSTRAINT IF EXISTS lv_events_data_is_object;
ALTER TABLE public.lv_events ADD CONSTRAINT lv_events_data_is_object CHECK (jsonb_typeof(data) = 'object');
CREATE INDEX IF NOT EXISTS lv_events_org_date_idx   ON public.lv_events (org_id, date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS lv_events_animal_idx     ON public.lv_events (animal_id, date DESC);
CREATE INDEX IF NOT EXISTS lv_events_org_type_idx   ON public.lv_events (org_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS lv_events_import_key_idx ON public.lv_events (org_id, import_key) WHERE import_key IS NOT NULL;

-- ─── org_id trigger + RLS on both tables ────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lv_animals', 'lv_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS aa_set_org_id ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER aa_set_org_id BEFORE INSERT ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.set_org_id()', t);

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Members can CRUD ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO authenticated '
      'USING (true) WITH CHECK (true)', 'Members can CRUD ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (org_id = public.current_org_id()) '
      'WITH CHECK (org_id = public.current_org_id())', t);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
  END LOOP;
END $$;

-- ─── 3. lv_record_event(jsonb) ──────────────────────────────────────────────
-- p = {
--   animal_id: uuid,
--   type:      one of the lv_events types,
--   date:      'YYYY-MM-DD'            (default today),
--   data:      { … typed fields … }     (optional),
--   note:      text                     (optional)
-- }
-- Typed fields the app sends, by type (everything else is kept as given):
--   parto      { calf_sex: 'H'|'M', create_calf: bool, calf_name?: text }
--   palpacion  { result: 'S'|'N', months?: 0-12 (halves allowed) }
--   peso       { kg: number }
--   leche      { liters: number, shift: 'am'|'pm' }
--   vacuna     { product, dose? }        salud    { reason, product? }
--   servicio   { kind: 'monta'|'ia', sire? }   destete { kg? }
--   venta      { buyer?, price?, currency? }   muerte  { cause? }
--   traslado   { lot }
-- Returns { id, animal_id, calf_id }.
CREATE OR REPLACE FUNCTION public.lv_record_event(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_animal   public.lv_animals%ROWTYPE;
  v_type     text := p->>'type';
  v_date     date := COALESCE(NULLIF(p->>'date', '')::date, CURRENT_DATE);
  v_data     jsonb := CASE WHEN jsonb_typeof(p->'data') = 'object' THEN p->'data' ELSE '{}'::jsonb END;
  v_note     text := COALESCE(p->>'note', '');
  v_event_id uuid;
  v_calf_id  uuid;
  v_calf_sex text;
  v_slug     text;
  v_n        integer := 0;
BEGIN
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'lv_record_event: type is required';
  END IF;

  SELECT * INTO v_animal
    FROM public.lv_animals
   WHERE id = (p->>'animal_id')::uuid
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lv_record_event: animal not found';
  END IF;

  -- A calving may create the calf's card first, so the event can point to it.
  IF v_type = 'parto' AND COALESCE((v_data->>'create_calf')::boolean, false) THEN
    v_calf_sex := CASE WHEN v_data->>'calf_sex' = 'M' THEN 'M' ELSE 'H' END;
    v_slug := 'cria-' || v_animal.slug || '-' || to_char(v_date, 'YYMMDD');
    LOOP
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.lv_animals WHERE org_id = v_animal.org_id AND slug = v_slug || CASE WHEN v_n = 0 THEN '' ELSE '-' || v_n END);
      v_n := v_n + 1;
    END LOOP;
    v_slug := v_slug || CASE WHEN v_n = 0 THEN '' ELSE '-' || v_n END;

    INSERT INTO public.lv_animals
      (org_id, slug, name, species, category, sex, lot, dam_id, dam_name, birth_date, status, flags, origin, created_by)
    VALUES
      (v_animal.org_id, v_slug,
       COALESCE(NULLIF(btrim(v_data->>'calf_name'), ''), 'Cría de ' || v_animal.name),
       v_animal.species,
       CASE WHEN v_animal.species = 'porcino' THEN 'lechon'
            WHEN v_calf_sex = 'M' THEN 'ternero' ELSE 'ternera' END,
       v_calf_sex, v_animal.lot, v_animal.id, v_animal.name, v_date, 'activo',
       ARRAY['por_confirmar'], 'derivado', auth.uid())
    RETURNING id INTO v_calf_id;
    v_data := v_data - 'create_calf' - 'calf_name' || jsonb_build_object('calf_id', v_calf_id, 'calf_sex', v_calf_sex);
  END IF;

  INSERT INTO public.lv_events (org_id, animal_id, type, date, data, note, origin, created_by)
  VALUES (v_animal.org_id, v_animal.id, v_type, v_date, v_data, v_note, 'app', auth.uid())
  RETURNING id INTO v_event_id;

  -- What the event means for the card.
  IF v_type = 'parto' THEN
    UPDATE public.lv_animals
       SET calvings = calvings + 1, pregnant = false, preg_months = NULL
     WHERE id = v_animal.id;
  ELSIF v_type = 'mal_parto' THEN
    UPDATE public.lv_animals
       SET pregnant = false, preg_months = NULL,
           flags = CASE WHEN 'mal_parto' = ANY(flags) THEN flags ELSE flags || 'mal_parto' END
     WHERE id = v_animal.id;
  ELSIF v_type = 'palpacion' THEN
    UPDATE public.lv_animals
       SET pregnant    = (v_data->>'result' = 'S'),
           preg_months = CASE WHEN v_data->>'result' = 'S' THEN NULLIF(v_data->>'months', '')::numeric ELSE NULL END,
           preg_date   = v_date
     WHERE id = v_animal.id
       AND (preg_date IS NULL OR v_date >= preg_date);
  ELSIF v_type = 'peso' AND NULLIF(v_data->>'kg', '') IS NOT NULL THEN
    UPDATE public.lv_animals
       SET last_weight_kg = (v_data->>'kg')::numeric, last_weight_date = v_date
     WHERE id = v_animal.id
       AND (last_weight_date IS NULL OR v_date >= last_weight_date);
  ELSIF v_type = 'venta' THEN
    UPDATE public.lv_animals SET status = 'vendido' WHERE id = v_animal.id;
  ELSIF v_type = 'muerte' THEN
    UPDATE public.lv_animals SET status = 'muerto' WHERE id = v_animal.id;
  ELSIF v_type = 'traslado' AND NULLIF(btrim(v_data->>'lot'), '') IS NOT NULL THEN
    UPDATE public.lv_animals SET lot = btrim(v_data->>'lot') WHERE id = v_animal.id;
  END IF;

  RETURN jsonb_build_object('id', v_event_id, 'animal_id', v_animal.id, 'calf_id', v_calf_id);
END;
$$;

-- ─── 4. lv_delete_event(uuid) ───────────────────────────────────────────────
-- Removes the event and recomputes what it had set on the card from the
-- events that remain. A calf card created by a calving is NOT deleted — it is
-- an animal of its own now; delete it from its card if it was a mistake.
CREATE OR REPLACE FUNCTION public.lv_delete_event(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ev   public.lv_events%ROWTYPE;
  v_last public.lv_events%ROWTYPE;
BEGIN
  SELECT * INTO v_ev FROM public.lv_events WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lv_delete_event: event not found';
  END IF;
  PERFORM 1 FROM public.lv_animals WHERE id = v_ev.animal_id FOR UPDATE;

  DELETE FROM public.lv_events WHERE id = p_id;

  IF v_ev.type = 'parto' THEN
    UPDATE public.lv_animals SET calvings = GREATEST(calvings - 1, 0) WHERE id = v_ev.animal_id;
  ELSIF v_ev.type IN ('venta', 'muerte') THEN
    -- back to active unless another sale / death is still on record
    UPDATE public.lv_animals a
       SET status = CASE
             WHEN EXISTS (SELECT 1 FROM public.lv_events e WHERE e.animal_id = a.id AND e.type = 'muerte') THEN 'muerto'
             WHEN EXISTS (SELECT 1 FROM public.lv_events e WHERE e.animal_id = a.id AND e.type = 'venta')  THEN 'vendido'
             ELSE 'activo' END
     WHERE a.id = v_ev.animal_id AND a.status IN ('vendido', 'muerto');
  ELSIF v_ev.type = 'palpacion' THEN
    SELECT * INTO v_last FROM public.lv_events
     WHERE animal_id = v_ev.animal_id AND type = 'palpacion'
     ORDER BY date DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.lv_animals
         SET pregnant    = (v_last.data->>'result' = 'S'),
             preg_months = CASE WHEN v_last.data->>'result' = 'S' THEN NULLIF(v_last.data->>'months', '')::numeric ELSE NULL END,
             preg_date   = v_last.date
       WHERE id = v_ev.animal_id;
    ELSE
      UPDATE public.lv_animals SET pregnant = NULL, preg_months = NULL, preg_date = NULL WHERE id = v_ev.animal_id;
    END IF;
  ELSIF v_ev.type = 'peso' THEN
    SELECT * INTO v_last FROM public.lv_events
     WHERE animal_id = v_ev.animal_id AND type = 'peso' AND NULLIF(data->>'kg', '') IS NOT NULL
     ORDER BY date DESC, created_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.lv_animals SET last_weight_kg = (v_last.data->>'kg')::numeric, last_weight_date = v_last.date WHERE id = v_ev.animal_id;
    ELSE
      UPDATE public.lv_animals SET last_weight_kg = NULL, last_weight_date = NULL WHERE id = v_ev.animal_id;
    END IF;
  END IF;
END;
$$;

-- ─── 5. check_invite(code) also says which program the invite is for ───────
-- Same as 2026-10-19-waitlist-and-invites.sql plus `program`, so the sign-up
-- form can ask for the finca's name instead of a business type.
CREATE OR REPLACE FUNCTION public.check_invite(p_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.invite_codes%ROWTYPE;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  SELECT * INTO r FROM public.invite_codes WHERE code = upper(trim(p_code));
  IF NOT FOUND OR r.uses >= r.max_uses OR (r.expires_at IS NOT NULL AND r.expires_at <= now()) THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  RETURN jsonb_build_object('valid', true, 'label', r.label, 'plan', r.plan,
                            'program', COALESCE(NULLIF(r.program, ''), 'business'));
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_invite(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.lv_record_event(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lv_delete_event(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lv_record_event(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lv_delete_event(uuid)  TO authenticated;

COMMIT;

-- ============================================================================
-- CHECK (optional):
--   SELECT o.name, count(a.*) AS animals,
--          (SELECT count(*) FROM public.lv_events e WHERE e.org_id = o.id) AS events
--     FROM public.organizations o
--     LEFT JOIN public.lv_animals a ON a.org_id = o.id
--    GROUP BY o.id, o.name ORDER BY o.name;
--   → every workspace 0 / 0 until the pilot seed runs.
-- ============================================================================
