-- ============================================================================
-- 2026-10-19  Sales with inventory + Customers (Simple accounting mode)
-- ============================================================================
-- A workspace on the Simple package records each sale as it happens instead
-- of typing a daily total. One sale = date, the customer (name, email, phone),
-- the items sold at the price they actually went for, and how it was paid.
-- Saving a sale does three things in ONE database transaction:
--
--   • takes the quantity off products.current_stock and writes the matching
--     inventory_logs row (type 'sold') — the Inventory page shows it;
--   • posts the money-in row to `transactions` (type 'credit', category
--     'Sales Revenue', posted, reference 'SALE-<sale id>') — the Transactions
--     tab, dashboard and reports read it like any other income;
--   • files the customer in `customers` (created on first sale, reused by
--     name afterwards) — the Customers tab.
--
-- Objects:
--   1. public.customers       — the people/businesses a workspace sells to.
--   2. public.sales           — one row per sale (header). Per-workspace
--                               running number (#1, #2 …).
--   3. public.sale_items      — the lines: product (optional), name snapshot,
--                               quantity, unit price as sold.
--   4. inventory_logs         — type CHECK widened with 'waste' (the Inventory
--                               page already offers it) and 'returned' (stock
--                               put back when a sale is deleted); new nullable
--                               sale_id linking a 'sold' log to its sale.
--   5. record_sale(jsonb)     — the atomic write above. SECURITY INVOKER:
--                               RLS applies, the period-lock trigger applies.
--   6. update_sale(uuid,jsonb)— edit the header (date, customer, payment,
--                               notes); mirrors date/description onto the
--                               money-in row. Items are not edited in place:
--                               delete the sale and record it again.
--   7. void_sale(uuid)        — delete a sale: removes the money-in row,
--                               returns the stock (inventory_logs 'returned'),
--                               removes the sale and its items.
--   8. public.customer_stats  — view: sales count, total spent, first/last
--                               sale per customer. security_invoker, so RLS
--                               on the underlying tables applies.
--
-- Every table gets the standard multi-business treatment from
-- 2026-10-18-organizations-multi-business.sql: org_id, the aa_set_org_id
-- BEFORE INSERT trigger, a permissive member policy and the RESTRICTIVE
-- org_isolation policy.
--
-- Additive. No DROP of data, no DELETE, no UPDATE of existing business rows.
-- Idempotent — safe to run again. Tested on the replica. The Full package's
-- Daily Sales page is untouched; Simple workspaces get the new Sales tab.
-- ============================================================================

BEGIN;

-- ─── 1. customers ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.customers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  email       text NOT NULL DEFAULT '' CHECK (char_length(email) <= 200),
  phone       text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  notes       text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS customers_org_idx      ON public.customers (org_id);
CREATE INDEX IF NOT EXISTS customers_org_name_idx ON public.customers (org_id, lower(name));

-- ─── 2. sales ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sales (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  number          integer NOT NULL CHECK (number > 0),
  date            date NOT NULL DEFAULT CURRENT_DATE,
  customer_id     uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name   text NOT NULL DEFAULT '',          -- snapshot: survives a customer delete
  payment_method  text NOT NULL DEFAULT 'cash'
                  CHECK (payment_method IN ('cash', 'card', 'transfer', 'other')),
  subtotal        numeric(12,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  total           numeric(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  items_count     integer NOT NULL DEFAULT 0 CHECK (items_count >= 0),
  notes           text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  transaction_id  uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE INDEX IF NOT EXISTS sales_org_idx          ON public.sales (org_id);
CREATE INDEX IF NOT EXISTS sales_org_date_idx     ON public.sales (org_id, date DESC);
CREATE INDEX IF NOT EXISTS sales_customer_idx     ON public.sales (customer_id);
CREATE INDEX IF NOT EXISTS sales_transaction_idx  ON public.sales (transaction_id);

-- ─── 3. sale_items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sale_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sale_id       uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  product_id    uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name  text NOT NULL CHECK (char_length(btrim(product_name)) BETWEEN 1 AND 160),
  quantity      integer NOT NULL CHECK (quantity > 0),
  unit_price    numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total    numeric(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  position      smallint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sale_items_org_idx     ON public.sale_items (org_id);
CREATE INDEX IF NOT EXISTS sale_items_sale_idx    ON public.sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sale_items_product_idx ON public.sale_items (product_id);

-- ─── org_id trigger + RLS on the three tables ───────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'sales', 'sale_items'] LOOP
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

-- ─── 4. inventory_logs — 'waste' and 'returned' types, sale_id link ─────────
-- Every existing row is one of the four original values, so re-adding the
-- CHECK validates instantly. sale_id ties a 'sold' log to the sale that made
-- it (kept, set to NULL, if the sale is later deleted).
ALTER TABLE public.inventory_logs DROP CONSTRAINT IF EXISTS inventory_logs_type_check;
ALTER TABLE public.inventory_logs
  ADD CONSTRAINT inventory_logs_type_check
  CHECK (type IN ('received', 'sold', 'used', 'waste', 'adjustment', 'returned'));
ALTER TABLE public.inventory_logs
  ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES public.sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inventory_logs_sale_idx ON public.inventory_logs (sale_id) WHERE sale_id IS NOT NULL;

-- ─── 5. record_sale(jsonb) ──────────────────────────────────────────────────
-- p = {
--   date: 'YYYY-MM-DD',
--   customer: { id: uuid|null, name, email, phone },   -- all optional (walk-in)
--   items: [ { product_id: uuid|null, name, quantity, unit_price } ],
--   payment_method: 'cash'|'card'|'transfer'|'other',
--   notes
-- }
-- Returns the finished sales row. Raises SALE_* / PERIOD_LOCKED on problems;
-- any raise rolls back every write above.
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

  -- Customer: an existing one by id (RLS hides other workspaces' rows), else
  -- reuse the one with the same name in this workspace, else create. Email and
  -- phone typed on the sale fill or replace the customer's — blanks keep what
  -- is already filed.
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

  -- Per-workspace running number. The advisory lock serialises two people
  -- saving at the same instant so they cannot both take the same number.
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
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'SALE_BAD_QUANTITY: quantity must be at least 1' USING ERRCODE = 'P0001';
    END IF;
    IF v_price < 0 THEN
      RAISE EXCEPTION 'SALE_BAD_PRICE: price cannot be negative' USING ERRCODE = 'P0001';
    END IF;

    IF v_pid IS NOT NULL THEN
      -- Take the stock. Clamped at 0 like the Inventory page does: a stale
      -- count must never block a real sale; the next stock count fixes it.
      UPDATE public.products
         SET current_stock = GREATEST(0, current_stock - v_qty),
             updated_at    = now()
       WHERE id = v_pid
       RETURNING name INTO v_pname_db;
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
    INSERT INTO public.sale_items (org_id, sale_id, product_id, product_name, quantity, unit_price, position)
    VALUES (v_org, v_sale.id, v_pid, v_pname, v_qty, v_price, v_pos);
    v_total := v_total + (v_qty * v_price);
    v_count := v_count + v_qty;
  END LOOP;

  -- The money-in row. Category: the workspace's sales-revenue category, else
  -- its first revenue category, else a fresh 'Sales Revenue'.
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

-- ─── 6. update_sale(uuid, jsonb) — header only ──────────────────────────────
-- p = { date, customer: { id|null, name, email, phone }, payment_method, notes }
-- Changing the date of a sale in a closed month raises PERIOD_LOCKED from the
-- transactions trigger and nothing changes.
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

-- ─── 7. void_sale(uuid) ─────────────────────────────────────────────────────
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

  DELETE FROM public.sales WHERE id = p_sale_id;   -- sale_items cascade
END;
$$;
GRANT EXECUTE ON FUNCTION public.void_sale(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.void_sale(uuid) FROM anon;

-- ─── 8. customer_stats view ─────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.customer_stats
WITH (security_invoker = true) AS
SELECT c.id                         AS customer_id,
       c.org_id,
       count(s.id)::integer         AS sales_count,
       COALESCE(sum(s.total), 0)    AS total_spent,
       min(s.date)                  AS first_sale_date,
       max(s.date)                  AS last_sale_date
  FROM public.customers c
  LEFT JOIN public.sales s ON s.customer_id = c.id
 GROUP BY c.id, c.org_id;
GRANT SELECT ON public.customer_stats TO authenticated;
REVOKE ALL ON public.customer_stats FROM anon;

-- ─── Verify ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t text; n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'sales', 'sale_items'] LOOP
    SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'org_isolation';
    IF n <> 1 THEN RAISE EXCEPTION 'sales: org_isolation missing on %', t; END IF;
    SELECT count(*) INTO n FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass AND tgname = 'aa_set_org_id';
    IF n <> 1 THEN RAISE EXCEPTION 'sales: aa_set_org_id missing on %', t; END IF;
  END LOOP;
  IF to_regprocedure('public.record_sale(jsonb)') IS NULL THEN RAISE EXCEPTION 'sales: record_sale missing'; END IF;
  IF to_regprocedure('public.void_sale(uuid)') IS NULL THEN RAISE EXCEPTION 'sales: void_sale missing'; END IF;
  IF to_regprocedure('public.update_sale(uuid, jsonb)') IS NULL THEN RAISE EXCEPTION 'sales: update_sale missing'; END IF;
  IF to_regclass('public.customer_stats') IS NULL THEN RAISE EXCEPTION 'sales: customer_stats missing'; END IF;
  RAISE NOTICE 'sales-and-customers: OK';
END $$;

COMMIT;

-- ============================================================================
-- Checks to run after applying:
--   SELECT count(*) FROM customers;  SELECT count(*) FROM sales;   -- 0 and 0
--   SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('record_sale','void_sale','update_sale');
--     -- prosecdef = false (SECURITY INVOKER) for all three
-- ============================================================================
