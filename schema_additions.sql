-- ============================================================
-- SAHAJA SCHEMA ADDITIONS — v2 (matches actual original schema)
-- Original columns: parts(id,name,code,qty,min_qty,buy_price,sell_price,supplier)
--                   sales(id,receipt_no,sale_date,total,type,customer_name,customer_phone)
--                   sale_items(id,sale_id,part_id,part_name,qty,price,line_total)
--                   credits(id,sale_id,customer_name,customer_phone,total_owed,paid,status,note,credit_date)
-- ============================================================

-- ============================================================
-- STEP 0: Drop any leftover policies from previous failed runs
-- ============================================================
DROP POLICY IF EXISTS "Authenticated users can manage suppliers" ON suppliers;
DROP POLICY IF EXISTS "Authenticated users can manage daily closing" ON daily_closing;
DROP POLICY IF EXISTS "Authenticated users can manage restock requests" ON restock_requests;
DROP POLICY IF EXISTS "Authenticated users can upload part images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for part images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete part images" ON storage.objects;

-- ============================================================
-- 1. SUPPLIERS TABLE (new)
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage suppliers"
  ON suppliers FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 1b. ADD THEME COLUMN TO SHOP_SETTINGS
-- (original schema doesn't have this column)
-- ============================================================
ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'carbon-red';

-- ============================================================
-- 2. ADD NEW COLUMNS TO PARTS
-- (only truly new columns — code/qty/min_qty/buy_price/sell_price already exist)
-- ============================================================
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

-- ============================================================
-- 3. ADD NEW COLUMNS TO SALES
-- (receipt_no/total/type/customer_name/customer_phone already exist)
-- ============================================================
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS mpesa_txn_code TEXT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'cash';
-- payment_method: 'cash' | 'mpesa' | 'credit' (more granular than original 'type')

-- ============================================================
-- 4. ADD NEW COLUMNS TO SALE_ITEMS
-- (part_name/qty/price/line_total already exist)
-- ============================================================
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS buying_price NUMERIC(10,2) DEFAULT 0;

-- ============================================================
-- 5. ADD NEW COLUMNS TO CREDITS
-- (total_owed/paid/status/customer_name/customer_phone already exist)
-- ============================================================
ALTER TABLE credits
  ADD COLUMN IF NOT EXISTS payment_history JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS last_payment_date DATE;

-- ============================================================
-- 6. DAILY CLOSING TABLE (new)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_closing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_sales_cash NUMERIC(10,2) DEFAULT 0,
  total_sales_mpesa NUMERIC(10,2) DEFAULT 0,
  total_sales_credit NUMERIC(10,2) DEFAULT 0,
  total_revenue NUMERIC(10,2) DEFAULT 0,
  transaction_count INTEGER DEFAULT 0,
  items_sold INTEGER DEFAULT 0,
  notes TEXT,
  closed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE daily_closing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage daily closing"
  ON daily_closing FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 7. RESTOCK REQUESTS TABLE (new)
-- ============================================================
CREATE TABLE IF NOT EXISTS restock_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  requested_qty INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE restock_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage restock requests"
  ON restock_requests FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 8. STORAGE BUCKET FOR PART IMAGES (new)
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('part-images', 'part-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can upload part images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'part-images');

CREATE POLICY "Public read access for part images"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'part-images');

CREATE POLICY "Authenticated users can delete part images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'part-images');

-- ============================================================
-- 9. SEED SUPPLIERS
-- ============================================================
INSERT INTO suppliers (name, phone, address, notes) VALUES
  ('Mombasa Road Auto Parts', '+254 722 000001', 'Mombasa Rd, Nairobi', 'Engine & body parts'),
  ('Grogan Road Wholesalers', '+254 733 000002', 'Grogan Rd, Industrial Area', 'Bearings, chains, sprockets'),
  ('River Road Spares', '+254 711 000003', 'River Rd, CBD Nairobi', 'General spare parts'),
  ('Asian Autoparts EA', '+254 720 000004', 'Kirinyaga Rd, Nairobi', 'Electrical & filters')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 10. VIEW: LOW STOCK WITH SUPPLIER INFO
-- Uses actual column names: qty, min_qty, sell_price, code
-- ============================================================
CREATE OR REPLACE VIEW low_stock_with_supplier AS
SELECT
  p.id         AS part_id,
  p.name       AS part_name,
  p.code       AS sku,
  p.category,
  p.qty        AS stock_qty,
  p.min_qty    AS min_stock_threshold,
  p.sell_price AS selling_price,
  s.name       AS supplier_name,
  s.phone      AS supplier_phone
FROM parts p
LEFT JOIN suppliers s ON p.supplier_id = s.id
WHERE p.qty <= p.min_qty
ORDER BY p.qty ASC;

GRANT SELECT ON low_stock_with_supplier TO authenticated;

-- ============================================================
-- 11. VIEW: DAILY SALES SUMMARY
-- Uses actual column names: total, type, payment_method
-- ============================================================
CREATE OR REPLACE VIEW daily_sales_summary AS
SELECT
  DATE(created_at) AS sale_date,
  COUNT(*) AS transaction_count,
  SUM(CASE WHEN COALESCE(payment_method, type) = 'cash'   THEN total ELSE 0 END) AS cash_total,
  SUM(CASE WHEN COALESCE(payment_method, type) = 'mpesa'  THEN total ELSE 0 END) AS mpesa_total,
  SUM(CASE WHEN COALESCE(payment_method, type) = 'credit' THEN total ELSE 0 END) AS credit_total,
  SUM(total) AS grand_total
FROM sales
GROUP BY DATE(created_at)
ORDER BY sale_date DESC;

GRANT SELECT ON daily_sales_summary TO authenticated;

-- ============================================================
-- DONE. What was added in v2:
-- + suppliers table (4 seeded Nairobi suppliers)
-- + parts: image_url, category, supplier_id
-- + sales: mpesa_txn_code, payment_method
-- + sale_items: buying_price
-- + credits: payment_history, last_payment_date
-- + daily_closing table
-- + restock_requests table
-- + part-images storage bucket + policies
-- + low_stock_with_supplier view (using actual column names)
-- + daily_sales_summary view (using actual column names)
-- ============================================================

-- ============================================================
-- SAHAJA SCHEMA ADDITIONS — v3 (New features)
-- ============================================================

-- 1. ADD NEW COLUMNS TO PARTS FOR STOCK SPLITTING
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS shop_qty INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ground_qty INTEGER DEFAULT 0;

-- Migrate existing total quantity to shop_qty if shop_qty is 0
UPDATE parts SET shop_qty = qty WHERE shop_qty = 0 AND qty > 0;

-- 2. ADD NEW COLUMNS TO SALES FOR CHANNELS, OPERATORS & LOCATIONS
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS sales_channel TEXT DEFAULT 'shop', -- 'shop' | 'ground'
  ADD COLUMN IF NOT EXISTS customer_location TEXT,
  ADD COLUMN IF NOT EXISTS operator_name TEXT;

-- 3. OPERATORS TABLE
CREATE TABLE IF NOT EXISTS operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  pin VARCHAR(4) NOT NULL, -- 4-digit PIN
  role TEXT NOT NULL DEFAULT 'employee', -- 'owner' | 'employee'
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE operators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage operators"
  ON operators FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Seed initial operators
INSERT INTO operators (name, pin, role) VALUES
  ('Owner', '9876', 'owner'),
  ('Ann', '1111', 'employee'),
  ('Victor', '2222', 'employee')
ON CONFLICT (name) DO NOTHING;

-- 4. SOURCING LOGS FOR OUT OF STOCK SALES
CREATE TABLE IF NOT EXISTS sourcing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID REFERENCES sales(id) ON DELETE CASCADE,
  part_id UUID REFERENCES parts(id) ON DELETE CASCADE,
  part_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  sourcing_shop TEXT NOT NULL,
  cost_price NUMERIC(10,2) NOT NULL,
  selling_price NUMERIC(10,2) NOT NULL,
  payment_status TEXT NOT NULL, -- 'paid' | 'partial' | 'credit'
  payment_method TEXT NOT NULL, -- 'cash' | 'mpesa' | 'credit'
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sourcing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage sourcing_logs"
  ON sourcing_logs FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- SAHAJA SECURITY UPGRADE — SUPABASE AUTH OPERATOR LINK
-- ============================================================

-- 1. Enable pgcrypto for bcrypt password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Drop old operator_secrets table (no longer needed since we use auth.users)
DROP TABLE IF EXISTS operator_secrets;

-- 3. Recreate public.operators table linked to auth.users
CREATE TABLE IF NOT EXISTS public.operators (
  id UUID PRIMARY KEY, -- References auth.users(id)
  name TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee', -- 'owner' | 'employee'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on operators
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

-- Allow select for all authenticated users (to display staff names)
DROP POLICY IF EXISTS "Allow select for authenticated users" ON public.operators;
CREATE POLICY "Allow select for authenticated users"
  ON public.operators FOR SELECT
  TO authenticated
  USING (true);

-- Allow all modifications only via security definer RPC functions
DROP POLICY IF EXISTS "Restrict modifications to RPC" ON public.operators;

-- 4. Create secure RPC functions (marked SECURITY DEFINER to write to auth schema)

-- Function to verify password against auth.users
CREATE OR REPLACE FUNCTION verify_operator_password(
  p_op_id UUID,
  p_password TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT encrypted_password INTO v_hash 
  FROM auth.users 
  WHERE id = p_op_id;
  
  IF v_hash IS NULL THEN
    RETURN FALSE;
  END IF;
  
  RETURN v_hash = crypt(p_password, v_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to create a Supabase Auth user & Operator profile (Restricted to Owners)
CREATE OR REPLACE FUNCTION admin_create_user(
  p_name TEXT,
  p_email TEXT,
  p_password TEXT,
  p_role TEXT
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Security check: Verify that the caller is an owner
  IF NOT EXISTS (
    SELECT 1 FROM public.operators 
    WHERE id = auth.uid() AND role = 'owner'
  ) THEN
    -- If there are no operators yet, allow the first one (bootstrapping)
    IF (SELECT COUNT(*) FROM public.operators) > 0 THEN
      RAISE EXCEPTION 'Access Denied: Only owners can create operator profiles';
    END IF;
  END IF;

  -- Insert into auth.users (hashes the password with bcrypt)
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    p_email,
    crypt(p_password, gen_salt('bf', 10)),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('name', p_name, 'role', p_role),
    now(),
    now(),
    '',
    ''
  )
  RETURNING id INTO v_user_id;

  -- Insert into public.operators
  INSERT INTO public.operators (id, name, email, role)
  VALUES (v_user_id, p_name, p_email, p_role);

  -- Insert into auth.identities to link login provider
  INSERT INTO auth.identities (
    id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  VALUES (
    p_email,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', p_email),
    'email',
    now(),
    now(),
    now()
  );

  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to delete a user (Restricted to Owners)
CREATE OR REPLACE FUNCTION admin_delete_user(
  p_op_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  -- Security check: Verify that the caller is an owner
  IF NOT EXISTS (
    SELECT 1 FROM public.operators 
    WHERE id = auth.uid() AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Access Denied: Only owners can delete operator profiles';
  END IF;

  -- Delete from auth.users (automatically cascades to operators and identities)
  DELETE FROM auth.users WHERE id = p_op_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Seed default operators safely via our new secure RPC function
SELECT admin_create_user('Victor', 'victor@sahaja.co.ke', 'password123', 'owner');
SELECT admin_create_user('Ann', 'ann@sahaja.co.ke', 'ann123', 'employee');

