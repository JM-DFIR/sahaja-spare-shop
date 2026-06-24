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
-- SAHAJA SECURITY MIGRATION — ALPHANUMERIC PASSWORDS
-- ============================================================

-- 1. Enable pgcrypto for bcrypt hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Create operators table if it doesn't exist, and drop PIN column if it does
CREATE TABLE IF NOT EXISTS operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE operators DROP COLUMN IF EXISTS pin;

CREATE TABLE IF NOT EXISTS operator_secrets (
  operator_id UUID PRIMARY KEY REFERENCES operators(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL
);

-- Enable RLS on secrets table
ALTER TABLE operator_secrets ENABLE ROW LEVEL SECURITY;

-- Deny all direct client-side CRUD operations on secrets table (fully locked down)
DROP POLICY IF EXISTS "Deny all direct secrets access" ON operator_secrets;
-- Note: Having no policies on operator_secrets implicitly denies all operations.

-- 3. Clear existing seeded operators to start clean
TRUNCATE TABLE operators CASCADE;

-- 4. Create secure RPC management functions (SECURITY DEFINER bypasses RLS safely)

-- Function to create an operator profile
CREATE OR REPLACE FUNCTION create_operator_profile(
  p_name TEXT,
  p_password TEXT,
  p_role TEXT
)
RETURNS UUID AS $$
DECLARE
  v_op_id UUID;
BEGIN
  -- Insert into public operators table
  INSERT INTO operators (name, role)
  VALUES (p_name, p_role)
  RETURNING id INTO v_op_id;

  -- Insert bcrypt hashed password into secrets table
  INSERT INTO operator_secrets (operator_id, password_hash)
  VALUES (v_op_id, crypt(p_password, gen_salt('bf', 8)));

  RETURN v_op_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to verify an operator's password
CREATE OR REPLACE FUNCTION verify_operator_password(
  p_op_id UUID,
  p_password TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_hash TEXT;
BEGIN
  SELECT password_hash INTO v_hash 
  FROM operator_secrets 
  WHERE operator_id = p_op_id;
  
  IF v_hash IS NULL THEN
    RETURN FALSE;
  END IF;
  
  RETURN v_hash = crypt(p_password, v_hash);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to delete an operator profile
CREATE OR REPLACE FUNCTION delete_operator_profile(
  p_op_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
  DELETE FROM operators WHERE id = p_op_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to change an operator's password
CREATE OR REPLACE FUNCTION change_operator_password(
  p_op_id UUID,
  p_new_password TEXT,
  p_current_password TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_verified BOOLEAN;
BEGIN
  -- Verify current password first
  SELECT verify_operator_password(p_op_id, p_current_password) INTO v_verified;
  
  IF NOT v_verified THEN
    RETURN FALSE;
  END IF;
  
  -- Update with new bcrypt hashed password
  UPDATE operator_secrets 
  SET password_hash = crypt(p_new_password, gen_salt('bf', 8))
  WHERE operator_id = p_op_id;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Seed default operators safely via our new secure RPC function
SELECT create_operator_profile('Victor', 'password123', 'owner');
SELECT create_operator_profile('Ann', 'ann123', 'employee');

