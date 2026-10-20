-- ============================================================================
-- 2026-10-20  Decimal quantities — stock, recipes, movements and sale lines
-- ============================================================================
-- "0.5 kg of flour per loaf", "2.25 lb of chiles sold": quantities were
-- integers everywhere. This widens every quantity column to numeric(12,3)
-- (three decimals — grams on a kilo, ounces on a pound) and re-creates the
-- three sale functions with numeric arithmetic. Existing values are kept
-- exactly (an integer widens losslessly). Counts of sales (`items_count`)
-- widen too, since they sum quantities.
--
--   products.current_stock, reorder_level, target_stock
--   product_components.quantity
--   inventory_logs.quantity
--   sale_items.quantity            (line_total is a generated column: it is
--                                   dropped and re-added over the new type)
--   sales.items_count
--   record_sale / void_sale / update_sale — identical logic, numeric vars.
--
-- Additive in effect (no row is deleted or changed), idempotent (ALTER TYPE
-- to the same type is a no-op), tested on the replica. Requires
-- 2026-10-20-product-components.sql.
-- ============================================================================

BEGIN;

-- ─── 1. Columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.products
  ALTER COLUMN current_stock TYPE numeric(12,3) USING current_stock::numeric,
  ALTER COLUMN reorder_level TYPE numeric(12,3) USING reorder_level::numeric,
  ALTER COLUMN target_stock  TYPE numeric(12,3) USING target_stock::numeric;

ALTER TABLE public.product_components
  ALTER COLUMN quantity TYPE numeric(12,3) USING quantity::numeric;

ALTER TABLE public.inventory_logs
  ALTER COLUMN quantity TYPE numeric(12,3) USING quantity::numeric;

-- sale_items.line_total is GENERATED from quantity; it must go before the
-- type changes and come back after.
ALTER TABLE public.sale_items DROP COLUMN IF EXISTS line_total;
ALTER TABLE public.sale_items
  ALTER COLUMN quantity TYPE numeric(12,3) USING quantity::numeric;
ALTER TABLE public.sale_items
  ADD COLUMN line_total numeric(12,2) GENERATED ALWAYS AS (round(quantity * unit_price, 2)) STORED;

ALTER TABLE public.sales
  ALTER COLUMN items_count TYPE numeric(12,3) USING items_count::numeric;

-- ─── 2. record_sale — numeric quantities ────────────────────────────────────
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
  v_count      numeric(12,3) := 0;
  v_pos        integer := 0;
  v_qty        numeric(12,3);
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
    v_qty   := round(COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0), 3);
    v_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);
    v_pid   := NULLIF(v_item->>'product_id', '')::uuid;
    v_pname := btrim(COALESCE(v_item->>'name', ''));
    v_cost  := 0;
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'SALE_BAD_QUANTITY: quantity must be more than 0' USING ERRCODE = 'P0001';
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
      IF v_cust_id IS NOT NULL THEN
        INSERT INTO public.customer_prices (org_id, customer_id, product_id, unit_price)
        VALUES (v_org, v_cust_id, v_pid, v_price)
        ON CONFLICT (customer_id, product_id)
        DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = now();
      END IF;

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
           SET current_stock = GREATEST(0, current_stock - round(v_comp.per_unit * v_qty, 3)),
               updated_at    = now()
         WHERE id = v_comp.component_id AND org_id = v_org;
        INSERT INTO public.inventory_logs (org_id, product_id, type, quantity, date, notes, user_id, sale_id)
        VALUES (v_org, v_comp.component_id, 'used', round(v_comp.per_unit * v_qty, 3), v_date,
                v_label || ' — ' || v_pname, v_uid, v_sale.id);
        v_cost := v_cost + (v_comp.per_unit * v_comp.ccost);
      END LOOP;
    ELSIF v_pname = '' THEN
      RAISE EXCEPTION 'SALE_BAD_ITEM: an item needs a product or a name' USING ERRCODE = 'P0001';
    END IF;

    v_pos := v_pos + 1;
    INSERT INTO public.sale_items (org_id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, position)
    VALUES (v_org, v_sale.id, v_pid, v_pname, v_qty, v_price, round(v_cost, 2), v_pos);
    v_total := v_total + round(v_qty * v_price, 2);
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

-- ─── 3. void_sale — unchanged logic; record vars pick up numeric ─────────────
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
      INSERT INTO public.inventory_logs (org_id, product_id, type, quantity, date, notes, user_id)
      VALUES (v_sale.org_id, v_item.product_id, 'returned', v_item.quantity, CURRENT_DATE,
              'Sale #' || v_sale.number || ' deleted — stock returned', v_uid);
    END IF;
  END LOOP;

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

  DELETE FROM public.sales WHERE id = p_sale_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.void_sale(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.void_sale(uuid) FROM anon;

-- ─── Verify ─────────────────────────────────────────────────────────────────
DO $$
DECLARE v text;
BEGIN
  SELECT data_type INTO v FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'current_stock';
  IF v <> 'numeric' THEN RAISE EXCEPTION 'decimal-quantities: products.current_stock is %', v; END IF;
  SELECT data_type INTO v FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sale_items' AND column_name = 'quantity';
  IF v <> 'numeric' THEN RAISE EXCEPTION 'decimal-quantities: sale_items.quantity is %', v; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sale_items' AND column_name = 'line_total') THEN
    RAISE EXCEPTION 'decimal-quantities: sale_items.line_total missing';
  END IF;
  RAISE NOTICE 'decimal-quantities: OK';
END $$;

COMMIT;
