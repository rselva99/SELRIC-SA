-- ============================================================================
-- 2026-10-19  Product kind (for sale vs supply) + agreed prices per customer
-- ============================================================================
-- From the Chile Nicaragua pilot: they buy raw materials (bags, stickers,
-- chiles), make their product, and sell it at a price agreed with each
-- customer. Two things the data model needed:
--
--   1. products.kind — 'sale' (a product you sell) or 'supply' (raw material,
--      packaging; stock only, no sell price, never offered in the Sales tab).
--      products.target_stock is also created here IF NOT EXISTS — it was
--      added straight in the dashboard earlier and never had a migration.
--   2. public.customer_prices — the agreed unit price of a product for one
--      customer. record_sale() learns it automatically from every sale
--      (last price wins); the Customers page lets the owner correct it.
--
-- record_sale() is re-created with that one addition; the rest is identical
-- to 2026-10-19-sale-item-cost.sql.
--
-- Additive, idempotent. Requires the two earlier 2026-10-19 sales migrations.
-- ============================================================================

BEGIN;

-- ─── 1. products.kind + target_stock ────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'sale';
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_kind_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_kind_check CHECK (kind IN ('sale', 'supply'));
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS target_stock integer NOT NULL DEFAULT 0;

-- ─── 2. customer_prices ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customer_prices (
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit_price   numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);
CREATE INDEX IF NOT EXISTS customer_prices_org_idx ON public.customer_prices (org_id);

DROP TRIGGER IF EXISTS aa_set_org_id ON public.customer_prices;
CREATE TRIGGER aa_set_org_id BEFORE INSERT ON public.customer_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_org_id();
ALTER TABLE public.customer_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Members can CRUD customer_prices" ON public.customer_prices;
CREATE POLICY "Members can CRUD customer_prices" ON public.customer_prices
  AS PERMISSIVE FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS org_isolation ON public.customer_prices;
CREATE POLICY org_isolation ON public.customer_prices
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (org_id = public.current_org_id())
  WITH CHECK (org_id = public.current_org_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_prices TO authenticated;
REVOKE ALL ON public.customer_prices FROM anon;

-- ─── 3. record_sale — learns the customer's price for each product ──────────
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

-- ─── Verify ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'kind') THEN
    RAISE EXCEPTION 'product-kind: products.kind missing';
  END IF;
  IF to_regclass('public.customer_prices') IS NULL THEN RAISE EXCEPTION 'product-kind: customer_prices missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'customer_prices' AND policyname = 'org_isolation') THEN
    RAISE EXCEPTION 'product-kind: customer_prices org_isolation missing';
  END IF;
  RAISE NOTICE 'product-kind-and-customer-prices: OK';
END $$;

COMMIT;
