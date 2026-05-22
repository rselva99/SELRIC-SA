-- ============================================
-- SelRic SA — Complete Supabase SQL Schema
-- ============================================
-- Run this ENTIRE script in Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → Paste → Run)
-- ============================================

-- ==========================================
-- 1. PROFILES TABLE
-- ==========================================
-- Stores user profile info linked to Supabase Auth
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'limited' CHECK (role IN ('admin', 'limited')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'limited')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists, then create
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- RLS for profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- ==========================================
-- 2. CATEGORIES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('expense', 'revenue', 'asset', 'liability', 'equity')),
  description TEXT DEFAULT '',
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can CRUD categories"
  ON categories FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- 3. ACCOUNTS TABLE (Chart of Accounts)
-- ==========================================
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  code TEXT DEFAULT '',
  description TEXT DEFAULT '',
  balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can CRUD accounts"
  ON accounts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- 4. TRANSACTIONS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL DEFAULT '',
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'debit' CHECK (type IN ('debit', 'credit')),
  category TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  bank_statement_id UUID,
  invoice_id UUID,
  reconciled BOOLEAN NOT NULL DEFAULT false,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can CRUD transactions"
  ON transactions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- 5. INVOICES TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier TEXT NOT NULL DEFAULT '',
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  date DATE,
  due_date DATE,
  payment_terms TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  category TEXT DEFAULT '',
  file_url TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  extracted_data JSONB DEFAULT '{}',
  reconciled BOOLEAN NOT NULL DEFAULT false,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can CRUD invoices"
  ON invoices FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- 6. BANK STATEMENTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS bank_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name TEXT NOT NULL DEFAULT '',
  file_url TEXT DEFAULT '',
  upload_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  period_start DATE,
  period_end DATE,
  transaction_count INTEGER DEFAULT 0,
  extracted_data JSONB DEFAULT '[]',
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can CRUD bank_statements"
  ON bank_statements FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- 7. PRODUCTS TABLE (Inventory)
-- ==========================================
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT DEFAULT 'Other',
  unit TEXT DEFAULT 'units',
  cost_price DECIMAL(10,2) DEFAULT 0,
  sell_price DECIMAL(10,2) DEFAULT 0,
  current_stock INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER DEFAULT 5,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can CRUD products"
  ON products FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- 8. INVENTORY LOGS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS inventory_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('received', 'sold', 'used', 'adjustment')),
  quantity INTEGER NOT NULL DEFAULT 0,
  date DATE DEFAULT CURRENT_DATE,
  notes TEXT DEFAULT '',
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can CRUD inventory_logs"
  ON inventory_logs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- 9. SUPPLIER CATEGORIES TABLE
-- ==========================================
-- Remembers which category was used for each supplier
CREATE TABLE IF NOT EXISTS supplier_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier TEXT NOT NULL,
  category TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(supplier, user_id)
);

ALTER TABLE supplier_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can CRUD supplier_categories"
  ON supplier_categories FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ==========================================
-- 10. STORAGE BUCKETS
-- ==========================================
-- Create buckets for file uploads
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('invoices', 'invoices', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: authenticated users can upload/read
CREATE POLICY "Authenticated users can upload documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id IN ('documents', 'invoices'));

CREATE POLICY "Authenticated users can read documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id IN ('documents', 'invoices'));

CREATE POLICY "Authenticated users can delete documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id IN ('documents', 'invoices'));

-- ==========================================
-- 11. SEED DEFAULT CATEGORIES
-- ==========================================
INSERT INTO categories (name, type) VALUES
  ('Cost of Goods Sold (COGS)', 'expense'),
  ('Salaries & Wages', 'expense'),
  ('Rent', 'expense'),
  ('Utilities', 'expense'),
  ('Repairs & Maintenance', 'expense'),
  ('Insurance', 'expense'),
  ('Marketing & Advertising', 'expense'),
  ('Office Supplies', 'expense'),
  ('Transport & Delivery', 'expense'),
  ('Bank Charges', 'expense'),
  ('Licenses & Permits', 'expense'),
  ('Professional Fees', 'expense'),
  ('Depreciation', 'expense'),
  ('Entertainment', 'expense'),
  ('Cleaning', 'expense'),
  ('Security', 'expense'),
  ('Miscellaneous', 'expense'),
  ('Bar Sales', 'revenue'),
  ('Food Sales', 'revenue'),
  ('Event Revenue', 'revenue'),
  ('Cash', 'asset'),
  ('Bank Account', 'asset'),
  ('Inventory', 'asset'),
  ('Accounts Receivable', 'asset'),
  ('Equipment', 'asset'),
  ('Accounts Payable', 'liability'),
  ('Loans', 'liability'),
  ('Owner Equity', 'equity'),
  ('Retained Earnings', 'equity')
ON CONFLICT DO NOTHING;

-- ==========================================
-- DONE! Your database is ready.
-- ==========================================
