-- ============================================================================
-- 2026-10-19  sale_items.unit_cost — cost of each line at the moment of sale
-- ============================================================================
-- The Simple-mode reports show margin per product ("which supplement makes me
-- the most money", not just "which sells the most"). Margin needs the cost at
-- the time of the sale, not today's cost, so each sale line now snapshots
-- products.cost_price when it is recorded.
--
--   1. sale_items.unit_cost (numeric, default 0) — new column.
--   2. Backfill: lines recorded before this migration that still have 0 take
--      the product's CURRENT cost_price (best available estimate).
--   3. record_sale() — same function as 2026-10-19-sales-and-customers.sql
--      with one change: the product UPDATE also returns cost_price and the
--      sale_items INSERT stores it. Everything else is identical.
--
-- Additive, idempotent. Requires 2026-10-19-sales-and-customers.sql.
-- ============================================================================

BEGIN;

-- ─── 1. column ──────────────────────────────────────────────────────────────
ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0);

-- ─── 2. backfill (only lines that have no cost yet) ─────────────────────────
UPDATE public.sale_items si
   SET unit_cost = COALESCE(p.cost_price, 0)
  FROM public.products p
 WHERE p.id = si.product_id
   AND si.unit_cost = 0
   AND COALESCE(p.cost_price, 0) > 0;

-- ─── 3. record_sale — stores the cost at sale time ──────────────────────────
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
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'sale_items' AND column_name = 'unit_cost') THEN
    RAISE EXCEPTION 'sale-item-cost: unit_cost column missing';
  END IF;
  IF to_regprocedure('public.record_sale(jsonb)') IS NULL THEN RAISE EXCEPTION 'sale-item-cost: record_sale missing'; END IF;
  RAISE NOTICE 'sale-item-cost: OK';
END $$;

COMMIT;
