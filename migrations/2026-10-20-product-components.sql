-- ════════════════════════════════════════════════════════════════════════════
-- PRODUCT COMPONENTS — what a product is made of ("receta")
--
-- The gap this closes: packaging existed in Inventory as a `supply`, but nothing
-- ever consumed it. You bought 500 bags and the count stayed at 500 forever,
-- and the margin on a sale ignored the bag it went out in.
--
-- Selling one unit of a parent product now consumes `quantity` units of each
-- component, and the component's cost is folded into sale_items.unit_cost, so
-- the margin in Reports → Products is the real one.
--
-- ACCOUNTING — deliberately no new transaction is written.
-- Supplies are expensed when you buy them (that is how this app already works:
-- receiving stock creates no transaction, you record the purchase by hand).
-- Booking a COGS expense at sale time as well would count the same bag twice.
-- The cost lands in unit_cost → margin, not in the P&L. If you ever move to
-- perpetual inventory, that is the change that adds COGS, and it also has to
-- stop treating supply purchases as an expense.
--
-- QUANTITIES ARE WHOLE UNITS. products.current_stock is integer and the UI
-- parseInt()s it in several places, so "0.5 kg of flour" needs that column
-- widened first. Whole units cover packaging, which is the case this is for.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. The recipe table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.product_components (
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity      integer NOT NULL CHECK (quantity > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, component_id),
  CONSTRAINT product_components_not_self CHECK (product_id <> component_id)
);
CREATE INDEX IF NOT EXISTS product_components_org_idx ON public.product_components (org_id);
CREATE INDEX IF NOT EXISTS product_components_component_idx ON public.product_components (component_id);

DROP TRIGGER IF EXISTS aa_set_org_id ON public.product_components;
CREATE TRIGGER aa_set_org_id BEFORE INSERT ON public.product_components
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id();

ALTER TABLE public.product_components ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can CRUD product_components" ON public.product_components;
CREATE POLICY "Members can CRUD product_components" ON public.product_components
  AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS org_isolation ON public.product_components;
CREATE POLICY org_isolation ON public.product_components
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_components TO authenticated;

COMMIT;

-- ─── 2. record_sale — now consumes the recipe ───────────────────────────────
CREATE OR REPLACE FUNCTION public.record_sale(p jsonb)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org        uuid := public.current_org_id();
  v_uid        uuid := auth.uid();
  v_date       date;
  v_cust_id    uuid := NULLIF(p->'customer'->>'id', '')::uuid;
  v_cust_name  text := btrim(COALESCE(p->'customer'->>'name', ''));
  v_cust_email text := btrim(COALESCE(p->'customer'->>'email', ''));
  v_cust_phone text := btrim(COALESCE(p->'customer'->>'phone', ''));
  v_payment    text := COALESCE(NULLIF(p->>'payment_method', ''), 'cash');
  v_notes      text := COALESCE(p->>'notes', '');
  v_items      jsonb := COALESCE(p->'items', '[]'::jsonb);
  v_item       jsonb;
  v_sale       public.sales;
  v_number     integer;
  v_total      numeric(12,2) := 0;
  v_count      integer := 0;
  v_pos        integer := 0;
  v_qty        integer;
  v_price      numeric(12,2);
  v_cost       numeric(12,2);
  v_pid        uuid;
  v_pname      text;
  v_pname_db   text;
  v_category   text;
  v_txn_id     uuid;
  v_label      text;
  v_comp       record;
BEGIN
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'NO_WORKSPACE: sign in to a workspace first' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    v_date := COALESCE((p->>'date')::date, CURRENT_DATE);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'SALE_BAD_DATE: % is not a date', p->>'date' USING ERRCODE = 'P0001';
  END;
  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'SALE_NO_ITEMS: add at least one item' USING ERRCODE = 'P0001';
  END IF;
  IF v_payment NOT IN ('cash', 'card', 'transfer', 'other') THEN
    RAISE EXCEPTION 'SALE_BAD_PAYMENT: % is not a payment method', v_payment USING ERRCODE = 'P0001';
  END IF;

  IF v_cust_id IS NOT NULL THEN
    UPDATE public.customers
       SET email      = COALESCE(NULLIF(v_cust_email, ''), email),
           phone      = COALESCE(NULLIF(v_cust_phone, ''), phone),
           updated_at = now()
     WHERE id = v_cust_id
     RETURNING name INTO v_cust_name;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SALE_BAD_CUSTOMER: customer not found' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_cust_name <> '' THEN
    SELECT id INTO v_cust_id
      FROM public.customers
     WHERE org_id = v_org AND lower(name) = lower(v_cust_name)
     ORDER BY created_at
     LIMIT 1;
    IF v_cust_id IS NULL THEN
      INSERT INTO public.customers (org_id, name, email, phone, created_by)
      VALUES (v_org, v_cust_name, v_cust_email, v_cust_phone, v_uid)
      RETURNING id INTO v_cust_id;
    ELSE
      UPDATE public.customers
         SET email      = COALESCE(NULLIF(v_cust_email, ''), email),
             phone      = COALESCE(NULLIF(v_cust_phone, ''), phone),
             updated_at = now()
       WHERE id = v_cust_id
       RETURNING name INTO v_cust_name;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('sales:' || v_org::text));
  SELECT COALESCE(MAX(number), 0) + 1 INTO v_number FROM public.sales WHERE org_id = v_org;

  INSERT INTO public.sales (org_id, number, date, customer_id, customer_name, payment_method, notes, created_by)
  VALUES (v_org, v_number, v_date, v_cust_id, v_cust_name, v_payment, v_notes, v_uid)
  RETURNING * INTO v_sale;

  v_label := 'Sale #' || v_number || CASE WHEN v_cust_name <> '' THEN ' — ' || v_cust_name ELSE '' END;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_qty   := COALESCE(NULLIF(v_item->>'quantity', '')::integer, 0);
    v_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);
    v_pid   := NULLIF(v_item->>'product_id', '')::uuid;
    v_pname := btrim(COALESCE(v_item->>'name', ''));
    v_cost  := 0;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'SALE_BAD_QUANTITY: quantity must be at least 1' USING ERRCODE = 'P0001';
    END IF;
    IF v_price < 0 THEN
      RAISE EXCEPTION 'SALE_BAD_PRICE: price cannot be negative' USING ERRCODE = 'P0001';
    END IF;

    IF v_pid IS NOT NULL THEN
      UPDATE public.products
         SET current_stock = GREATEST(0, current_stock - v_qty),
             updated_at    = now()
       WHERE id = v_pid
       RETURNING name, COALESCE(cost_price, 0) INTO v_pname_db, v_cost;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SALE_BAD_PRODUCT: product not found' USING ERRCODE = 'P0001';
      END IF;
      IF v_pname = '' THEN v_pname := v_pname_db; END IF;
      INSERT INTO public.inventory_logs (org_id, product_id, type, quantity, date, notes, user_id, sale_id)
      VALUES (v_org, v_pid, 'sold', v_qty, v_date, v_label, v_uid, v_sale.id);
      -- The price agreed with this customer: the last one used wins.
      IF v_cust_id IS NOT NULL THEN
        INSERT INTO public.customer_prices (org_id, customer_id, product_id, unit_price)
        VALUES (v_org, v_cust_id, v_pid, v_price)
        ON CONFLICT (customer_id, product_id)
        DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = now();
      END IF;

      -- Absorb the recipe: one unit sold eats `quantity` of each component.
      -- The component's cost is added PER UNIT, so v_cost stays a unit cost and
      -- sale_items.unit_cost ends up as product cost + packaging cost.
      FOR v_comp IN
        SELECT pc.component_id,
               pc.quantity                 AS per_unit,
               c.name                      AS cname,
               COALESCE(c.cost_price, 0)   AS ccost
          FROM public.product_components pc
          JOIN public.products c ON c.id = pc.component_id
         WHERE pc.product_id = v_pid AND pc.org_id = v_org
         ORDER BY c.name
      LOOP
        UPDATE public.products
           SET current_stock = GREATEST(0, current_stock - (v_comp.per_unit * v_qty)),
               updated_at    = now()
         WHERE id = v_comp.component_id AND org_id = v_org;
        -- Logged against the sale so void_sale can put back exactly what it took,
        -- even if the recipe is edited afterwards.
        INSERT INTO public.inventory_logs (org_id, product_id, type, quantity, date, notes, user_id, sale_id)
        VALUES (v_org, v_comp.component_id, 'used', v_comp.per_unit * v_qty, v_date,
                v_label || ' — ' || v_pname, v_uid, v_sale.id);
        v_cost := v_cost + (v_comp.per_unit * v_comp.ccost);
      END LOOP;
    ELSIF v_pname = '' THEN
      RAISE EXCEPTION 'SALE_BAD_ITEM: an item needs a product or a name' USING ERRCODE = 'P0001';
    END IF;

    v_pos := v_pos + 1;
    INSERT INTO public.sale_items (org_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, position)
    VALUES (v_org, v_sale.id, v_pid, v_pname, v_qty, v_price, v_cost, v_pos);
    v_total := v_total + (v_qty * v_price);
    v_count := v_count + v_qty;
  END LOOP;

  SELECT name INTO v_category
    FROM public.categories
   WHERE org_id = v_org AND lower(type) = 'revenue'
   ORDER BY (lower(name) IN ('sales revenue', 'sales', 'ventas', 'ingresos por ventas')) DESC, name
   LIMIT 1;
  IF v_category IS NULL THEN
    INSERT INTO public.categories (org_id, name, type, description)
    VALUES (v_org, 'Sales Revenue', 'revenue', 'Product sales')
    RETURNING name INTO v_category;
  END IF;

  INSERT INTO public.transactions (org_id, date, description, supplier, amount, type, category, reference, posted, user_id)
  VALUES (v_org, v_date, v_label, v_cust_name, v_total, 'credit', v_category, 'SALE-' || v_sale.id::text, true, v_uid)
  RETURNING id INTO v_txn_id;

  UPDATE public.sales
     SET subtotal = v_total, total = v_total, items_count = v_count, transaction_id = v_txn_id, updated_at = now()
   WHERE id = v_sale.id
   RETURNING * INTO v_sale;

  RETURN v_sale;
END;
$$;
GRANT EXECUTE ON FUNCTION public.record_sale(jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.record_sale(jsonb) FROM anon;

-- ─── 3. void_sale — puts the recipe back ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_sale public.sales;
  v_item record;
  v_comp record;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Money-in row first: a closed month raises PERIOD_LOCKED here and the
  -- whole delete rolls back, stock included.
  IF v_sale.transaction_id IS NOT NULL THEN
    DELETE FROM public.transactions WHERE id = v_sale.transaction_id;
  END IF;

  FOR v_item IN
    SELECT product_id, quantity FROM public.sale_items
     WHERE sale_id = p_sale_id AND product_id IS NOT NULL
  LOOP
    UPDATE public.products
       SET current_stock = current_stock + v_item.quantity, updated_at = now()
     WHERE id = v_item.product_id;
    IF FOUND THEN
      -- No sale_id here: the sale row is about to go, and the note says why.
      INSERT INTO public.inventory_logs (org_id, product_id, type, quantity, date, notes, user_id)
      VALUES (v_sale.org_id, v_item.product_id, 'returned', v_item.quantity, CURRENT_DATE,
              'Sale #' || v_sale.number || ' deleted — stock returned', v_uid);
    END IF;
  END LOOP;

  -- Give the recipe components back too. Read from the logs, not from the
  -- recipe: the recipe may have changed since the sale, the logs cannot.
  FOR v_comp IN
    SELECT product_id, quantity FROM public.inventory_logs
     WHERE sale_id = p_sale_id AND type = 'used'
  LOOP
    UPDATE public.products
       SET current_stock = current_stock + v_comp.quantity, updated_at = now()
     WHERE id = v_comp.product_id;
    IF FOUND THEN
      INSERT INTO public.inventory_logs (org_id, product_id, type, quantity, date, notes, user_id)
      VALUES (v_sale.org_id, v_comp.product_id, 'returned', v_comp.quantity, CURRENT_DATE,
              'Sale #' || v_sale.number || ' deleted — materials returned', v_uid);
    END IF;
  END LOOP;

  DELETE FROM public.sales WHERE id = p_sale_id;   -- sale_items cascade
END;
$$;
GRANT EXECUTE ON FUNCTION public.void_sale(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.void_sale(uuid) FROM anon;

-- ─── 4. update_sale — keeps component log rows on the sale's date ───────────
CREATE OR REPLACE FUNCTION public.update_sale(p_sale_id uuid, p jsonb)
RETURNS public.sales
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_org        uuid := public.current_org_id();
  v_uid        uuid := auth.uid();
  v_sale       public.sales;
  v_date       date;
  v_cust_id    uuid := NULLIF(p->'customer'->>'id', '')::uuid;
  v_cust_name  text := btrim(COALESCE(p->'customer'->>'name', ''));
  v_cust_email text := btrim(COALESCE(p->'customer'->>'email', ''));
  v_cust_phone text := btrim(COALESCE(p->'customer'->>'phone', ''));
  v_payment    text;
  v_notes      text;
  v_label      text;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    v_date := COALESCE((p->>'date')::date, v_sale.date);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'SALE_BAD_DATE: % is not a date', p->>'date' USING ERRCODE = 'P0001';
  END;
  v_payment := COALESCE(NULLIF(p->>'payment_method', ''), v_sale.payment_method);
  v_notes   := COALESCE(p->>'notes', v_sale.notes);
  IF v_payment NOT IN ('cash', 'card', 'transfer', 'other') THEN
    RAISE EXCEPTION 'SALE_BAD_PAYMENT: % is not a payment method', v_payment USING ERRCODE = 'P0001';
  END IF;

  IF p ? 'customer' THEN
    IF v_cust_id IS NOT NULL THEN
      UPDATE public.customers
         SET email = COALESCE(NULLIF(v_cust_email, ''), email),
             phone = COALESCE(NULLIF(v_cust_phone, ''), phone),
             updated_at = now()
       WHERE id = v_cust_id
       RETURNING name INTO v_cust_name;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'SALE_BAD_CUSTOMER: customer not found' USING ERRCODE = 'P0001';
      END IF;
    ELSIF v_cust_name <> '' THEN
      SELECT id INTO v_cust_id FROM public.customers
       WHERE org_id = v_org AND lower(name) = lower(v_cust_name)
       ORDER BY created_at LIMIT 1;
      IF v_cust_id IS NULL THEN
        INSERT INTO public.customers (org_id, name, email, phone, created_by)
        VALUES (v_org, v_cust_name, v_cust_email, v_cust_phone, v_uid)
        RETURNING id INTO v_cust_id;
      ELSE
        UPDATE public.customers
           SET email = COALESCE(NULLIF(v_cust_email, ''), email),
               phone = COALESCE(NULLIF(v_cust_phone, ''), phone),
               updated_at = now()
         WHERE id = v_cust_id
         RETURNING name INTO v_cust_name;
      END IF;
    END IF;
  ELSE
    v_cust_id   := v_sale.customer_id;
    v_cust_name := v_sale.customer_name;
  END IF;

  v_label := 'Sale #' || v_sale.number || CASE WHEN v_cust_name <> '' THEN ' — ' || v_cust_name ELSE '' END;

  IF v_sale.transaction_id IS NOT NULL THEN
    UPDATE public.transactions
       SET date = v_date, description = v_label, supplier = v_cust_name
     WHERE id = v_sale.transaction_id;
  END IF;
  UPDATE public.inventory_logs
     SET date = v_date, notes = v_label
   WHERE sale_id = p_sale_id AND type = 'sold';
  -- Component rows follow the date; their note names the parent item, so keep it.
  UPDATE public.inventory_logs
     SET date = v_date
   WHERE sale_id = p_sale_id AND type = 'used';

  UPDATE public.sales
     SET date = v_date, customer_id = v_cust_id, customer_name = v_cust_name,
         payment_method = v_payment, notes = v_notes, updated_at = now()
   WHERE id = p_sale_id
   RETURNING * INTO v_sale;
  RETURN v_sale;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_sale(uuid, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.update_sale(uuid, jsonb) FROM anon;

-- ─── 5. Sanity ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'product_components') THEN
    RAISE EXCEPTION 'product-components: table missing';
  END IF;
  RAISE NOTICE 'product-components: OK';
END $$;
