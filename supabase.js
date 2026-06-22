// ============================================================
// SUPABASE CLIENT — All database queries for Sahaja Shop Tool
//
// COLUMN MAPPING NOTE:
// The original DB schema uses different column names from what the app expects.
// All read functions apply mappers to normalize field names.
// All write functions reverse-map before inserting/updating.
//
// DB column   → App field
// parts.code  → sku
// parts.qty   → stock_qty
// parts.min_qty → min_stock_threshold
// parts.sell_price → selling_price
// parts.buy_price  → buying_price
// sales.receipt_no → receipt_number
// sales.total      → total_amount
// sales.type / payment_method → payment_method
// sale_items.qty   → quantity
// sale_items.price → unit_price
// credits.total_owed - credits.paid → amount_owed
// credits.total_owed → original_amount
// ============================================================

const SUPABASE_URL = 'https://cirunbcvqsssneyuykyp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpcnVuYmN2cXNzc25leXV5a3lwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MzExNTQsImV4cCI6MjA5NzUwNzE1NH0.-bSuzDZtIUVeDYP68uLiniNXOLjl5sfRfHdcIG2zCpc';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
// COLUMN MAPPERS — normalize DB columns to app field names
// ============================================================

function mapPart(p) {
  if (!p) return p;
  return {
    ...p,
    sku: p.code || '',                                  // code → sku
    stock_qty: p.qty ?? 0,                              // qty → stock_qty
    min_stock_threshold: p.min_qty ?? 5,                // min_qty → min_stock_threshold
    selling_price: p.sell_price ?? 0,                   // sell_price → selling_price
    buying_price: p.buy_price ?? 0,                     // buy_price → buying_price
  };
}

function mapSale(s) {
  if (!s) return s;
  return {
    ...s,
    receipt_number: s.receipt_no || '',                 // receipt_no → receipt_number
    total_amount: s.total ?? 0,                         // total → total_amount
    payment_method: s.payment_method || s.type || 'cash', // prefer new column, fallback to type
    sale_items: (s.sale_items || []).map(mapSaleItem)
  };
}

function mapSaleItem(i) {
  if (!i) return i;
  return {
    ...i,
    quantity: i.qty ?? 0,                               // qty → quantity
    unit_price: i.price ?? 0,                           // price → unit_price
  };
}

function mapCredit(c) {
  if (!c) return c;
  const remaining = (c.total_owed ?? 0) - (c.paid ?? 0);
  return {
    ...c,
    amount_owed: Math.max(0, remaining),                // remaining balance
    original_amount: c.total_owed ?? 0,                 // original total
    status: c.status === 'paid' ? 'cleared' : c.status, // normalize 'paid' → 'cleared' for UI
  };
}

// Reverse mapper: app field names → DB column names (for inserts/updates)
function unmapPart(appPart) {
  const db = {
    name: appPart.name,
    code: appPart.sku || null,
    qty: appPart.stock_qty ?? 0,
    min_qty: appPart.min_stock_threshold ?? 5,
    sell_price: appPart.selling_price ?? 0,
    buy_price: appPart.buying_price ?? 0,
    category: appPart.category || 'General',
    supplier_id: appPart.supplier_id || null,
    image_url: appPart.image_url || null,
    supplier: appPart.supplier || null,
  };
  // Remove undefined keys
  Object.keys(db).forEach(k => db[k] === undefined && delete db[k]);
  return db;
}

// ============================================================
// AUTH
// ============================================================

const Auth = {
  async signIn(email, password) {
    return _supabase.auth.signInWithPassword({ email, password });
  },
  async signOut() {
    return _supabase.auth.signOut();
  },
  async getSession() {
    return _supabase.auth.getSession();
  },
  onAuthStateChange(callback) {
    return _supabase.auth.onAuthStateChange(callback);
  }
};

// ============================================================
// PARTS
// ============================================================

const Parts = {
  async getAll() {
    const { data, error } = await _supabase
      .from('parts')
      .select('*, suppliers(name, phone)')
      .order('name');
    return { data: (data || []).map(mapPart), error };
  },

  async getById(id) {
    const { data, error } = await _supabase
      .from('parts')
      .select('*, suppliers(name, phone)')
      .eq('id', id)
      .single();
    return { data: mapPart(data), error };
  },

  async search(query) {
    const { data, error } = await _supabase
      .from('parts')
      .select('*, suppliers(name, phone)')
      .or(`name.ilike.%${query}%,code.ilike.%${query}%`)
      .order('name');
    return { data: (data || []).map(mapPart), error };
  },

  async getByCategory(category) {
    const { data, error } = await _supabase
      .from('parts')
      .select('*, suppliers(name, phone)')
      .eq('category', category)
      .order('name');
    return { data: (data || []).map(mapPart), error };
  },

  async create(appPart) {
    const dbPart = unmapPart(appPart);
    const { data, error } = await _supabase
      .from('parts')
      .insert([dbPart])
      .select('*, suppliers(name, phone)')
      .single();
    return { data: mapPart(data), error };
  },

  async update(id, appPart) {
    const dbPart = unmapPart(appPart);
    const { data, error } = await _supabase
      .from('parts')
      .update(dbPart)
      .eq('id', id)
      .select('*, suppliers(name, phone)')
      .single();
    return { data: mapPart(data), error };
  },

  async updateStock(id, newQty) {
    // DB column is 'qty'
    const { data, error } = await _supabase
      .from('parts')
      .update({ qty: newQty })
      .eq('id', id)
      .select()
      .single();
    return { data: mapPart(data), error };
  },

  async delete(id) {
    return _supabase.from('parts').delete().eq('id', id);
  },

  async getLowStock() {
    // View already maps to app-friendly names (stock_qty, sku, etc.)
    const { data, error } = await _supabase
      .from('low_stock_with_supplier')
      .select('*');
    return { data, error };
  },

  async getCategories() {
    const { data, error } = await _supabase
      .from('parts')
      .select('category')
      .not('category', 'is', null);
    if (error) return { data: [], error };
    const cats = [...new Set(data.map(p => p.category).filter(Boolean))].sort();
    return { data: cats, error: null };
  }
};

// ============================================================
// PART IMAGE UPLOAD
// ============================================================

const PartImages = {
  async upload(file, partId) {
    const ext = file.name.split('.').pop();
    const path = `${partId}.${ext}`;
    const { data, error } = await _supabase.storage
      .from('part-images')
      .upload(path, file, { upsert: true });
    if (error) return { url: null, error };
    const { data: urlData } = _supabase.storage
      .from('part-images')
      .getPublicUrl(path);
    return { url: urlData.publicUrl, error: null };
  },

  async delete(path) {
    return _supabase.storage.from('part-images').remove([path]);
  }
};

// ============================================================
// SALES
// ============================================================

const Sales = {
  async create(appSale, items) {
    // Map app sale fields → DB column names
    const dbSale = {
      receipt_no: appSale.receipt_number,
      sale_date: new Date().toISOString().split('T')[0],
      total: appSale.total_amount,
      // original 'type' only supports 'cash'|'credit' — map mpesa → cash for compat
      type: appSale.payment_method === 'credit' ? 'credit' : 'cash',
      payment_method: appSale.payment_method,  // new column: cash|mpesa|credit
      mpesa_txn_code: appSale.mpesa_txn_code || null,
      customer_name: appSale.customer_name || null,
      customer_phone: appSale.customer_phone || null,
      created_by: appSale.created_by || null,
    };

    const { data: saleData, error: saleError } = await _supabase
      .from('sales')
      .insert([dbSale])
      .select()
      .single();

    if (saleError) return { data: null, error: saleError };

    // Map sale_items: app fields → DB column names
    const dbItems = items.map(item => ({
      sale_id: saleData.id,
      part_id: item.part_id,
      part_name: item.part_name,
      qty: item.quantity,            // quantity → qty
      price: item.unit_price,        // unit_price → price
      line_total: item.quantity * item.unit_price,
      buying_price: item.buying_price || 0,
    }));

    const { error: itemsError } = await _supabase
      .from('sale_items')
      .insert(dbItems);

    if (itemsError) return { data: null, error: itemsError };

    // Deduct stock — DB column is 'qty'
    for (const item of items) {
      const { data: part } = await _supabase
        .from('parts')
        .select('qty')
        .eq('id', item.part_id)
        .single();
      if (part) {
        await _supabase
          .from('parts')
          .update({ qty: Math.max(0, (part.qty || 0) - item.quantity) })
          .eq('id', item.part_id);
      }
    }

    return { data: mapSale(saleData), error: null };
  },

  async getToday() {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await _supabase
      .from('sales')
      .select('*, sale_items(*)')
      .eq('sale_date', today)
      .order('created_at', { ascending: false });
    return { data: (data || []).map(mapSale), error };
  },

  async getByDateRange(from, to) {
    const { data, error } = await _supabase
      .from('sales')
      .select('*, sale_items(*)')
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('created_at', { ascending: false });
    return { data: (data || []).map(mapSale), error };
  },

  async getRecent(limit = 10) {
    const { data, error } = await _supabase
      .from('sales')
      .select('*, sale_items(*)')
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data: (data || []).map(mapSale), error };
  },

  async getSaleWithItems(saleId) {
    const { data, error } = await _supabase
      .from('sales')
      .select('*, sale_items(*)')
      .eq('id', saleId)
      .single();
    return { data: mapSale(data), error };
  },

  async getDailySummary() {
    const { data, error } = await _supabase
      .from('daily_sales_summary')
      .select('*')
      .limit(30);
    return { data, error };
  },

  async getNextReceiptNumber(prefix = 'SAH') {
    // DB column is 'receipt_no'
    const { data } = await _supabase
      .from('sales')
      .select('receipt_no')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) return `${prefix}-0001`;
    const last = data[0].receipt_no || '';
    const num = parseInt(last.split('-').pop() || '0') + 1;
    return `${prefix}-${String(num).padStart(4, '0')}`;
  }
};

// ============================================================
// CREDITS
// ============================================================

const Credits = {
  async getAll() {
    const { data, error } = await _supabase
      .from('credits')
      .select('*')
      .order('created_at', { ascending: false });
    return { data: (data || []).map(mapCredit), error };
  },

  async getById(id) {
    const { data, error } = await _supabase
      .from('credits')
      .select('*')
      .eq('id', id)
      .single();
    // Return raw (unmapped) for internal use in recordPayment
    return { data, error };
  },

  async create(appCredit) {
    // Map app fields → DB columns
    const dbCredit = {
      customer_name: appCredit.customer_name,
      customer_phone: appCredit.customer_phone || null,
      total_owed: appCredit.amount_owed,   // amount_owed → total_owed
      paid: 0,
      status: 'pending',
      payment_history: appCredit.payment_history || [],
      credit_date: new Date().toISOString().split('T')[0],
      sale_id: appCredit.sale_id || null,
      note: appCredit.note || null,
    };

    const { data, error } = await _supabase
      .from('credits')
      .insert([dbCredit])
      .select()
      .single();
    return { data: mapCredit(data), error };
  },

  async recordPayment(id, amount) {
    // Fetch raw DB record (not mapped) to get actual DB column values
    const { data: credit, error: fetchErr } = await Credits.getById(id);
    if (fetchErr || !credit) return { error: 'Credit not found' };

    const newPaid = Math.min(credit.total_owed, (credit.paid || 0) + amount);
    const newBalance = credit.total_owed - newPaid;

    const history = credit.payment_history || [];
    history.push({
      date: new Date().toISOString(),
      amount: amount,
      balance_after: newBalance
    });

    const { data, error } = await _supabase
      .from('credits')
      .update({
        paid: newPaid,
        payment_history: history,
        last_payment_date: new Date().toISOString().split('T')[0],
        status: newBalance <= 0 ? 'paid' : 'pending'
      })
      .eq('id', id)
      .select()
      .single();
    return { data: mapCredit(data), error };
  },

  async getTotalOutstanding() {
    const { data, error } = await _supabase
      .from('credits')
      .select('total_owed, paid')
      .eq('status', 'pending');
    if (error) return 0;
    return data.reduce((sum, c) => sum + ((c.total_owed || 0) - (c.paid || 0)), 0);
  }
};

// ============================================================
// SUPPLIERS
// ============================================================

const Suppliers = {
  async getAll() {
    const { data, error } = await _supabase
      .from('suppliers')
      .select('*')
      .order('name');
    return { data, error };
  },

  async create(supplier) {
    const { data, error } = await _supabase
      .from('suppliers')
      .insert([supplier])
      .select()
      .single();
    return { data, error };
  },

  async update(id, updates) {
    const { data, error } = await _supabase
      .from('suppliers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  },

  async delete(id) {
    return _supabase.from('suppliers').delete().eq('id', id);
  }
};

// ============================================================
// SHOP SETTINGS
// Uses original schema: name, phone, address, footer, prefix
// Maps to app fields: shop_name, receipt_footer, receipt_prefix
// ============================================================

const ShopSettings = {
  _defaults: {
    shop_name: 'SAHAJA MOTORCYCLE LIMITED',
    phone: '0724-399 708',
    address: 'CBD, Nairobi',
    receipt_prefix: 'SAH',
    receipt_footer: 'Goods once sold are not re-turnable. Thank you!',
    theme: 'carbon-red'
  },

  _mapFromDB(row) {
    if (!row) return ShopSettings._defaults;
    return {
      ...ShopSettings._defaults,
      shop_name: row.name || ShopSettings._defaults.shop_name,
      phone: row.phone || ShopSettings._defaults.phone,
      address: row.address || ShopSettings._defaults.address,
      receipt_prefix: row.prefix || ShopSettings._defaults.receipt_prefix,
      receipt_footer: row.footer || ShopSettings._defaults.receipt_footer,
      theme: row.theme || ShopSettings._defaults.theme,
      id: row.id
    };
  },

  _mapToDB(appSettings) {
    return {
      name: appSettings.shop_name,
      phone: appSettings.phone,
      address: appSettings.address,
      prefix: appSettings.receipt_prefix,
      footer: appSettings.receipt_footer,
      theme: appSettings.theme,
      updated_at: new Date().toISOString()
    };
  },

  async get() {
    const { data, error } = await _supabase
      .from('shop_settings')
      .select('*')
      .limit(1)
      .single();
    return { data: ShopSettings._mapFromDB(data), error: null };
  },

  async save(appSettings) {
    const dbSettings = ShopSettings._mapToDB(appSettings);

    // Add theme column if not in original schema — safe with upsert
    const existing = await _supabase
      .from('shop_settings')
      .select('id')
      .limit(1)
      .single();

    if (existing.data) {
      const { data, error } = await _supabase
        .from('shop_settings')
        .update(dbSettings)
        .eq('id', existing.data.id)
        .select()
        .single();
      return { data: ShopSettings._mapFromDB(data), error };
    } else {
      const { data, error } = await _supabase
        .from('shop_settings')
        .insert([dbSettings])
        .select()
        .single();
      return { data: ShopSettings._mapFromDB(data), error };
    }
  }
};

// ============================================================
// DAILY CLOSING
// ============================================================

const DailyClosing = {
  async save(report) {
    const { data, error } = await _supabase
      .from('daily_closing')
      .insert([report])
      .select()
      .single();
    return { data, error };
  },

  async getHistory(limit = 30) {
    const { data, error } = await _supabase
      .from('daily_closing')
      .select('*')
      .order('closing_date', { ascending: false })
      .limit(limit);
    return { data, error };
  },

  async getTodayReport() {
    const { data: sales } = await Sales.getToday();
    if (!sales) return null;

    // sales are already mapped — use app field names (total_amount, payment_method)
    const cashSales   = sales.filter(s => s.payment_method === 'cash');
    const mpesaSales  = sales.filter(s => s.payment_method === 'mpesa');
    const creditSales = sales.filter(s => s.payment_method === 'credit');

    const totalCash   = cashSales.reduce((s, x)   => s + (x.total_amount || 0), 0);
    const totalMpesa  = mpesaSales.reduce((s, x)  => s + (x.total_amount || 0), 0);
    const totalCredit = creditSales.reduce((s, x) => s + (x.total_amount || 0), 0);

    const totalItems = sales.reduce((s, sale) => {
      return s + (sale.sale_items || []).reduce((n, i) => n + (i.quantity || 0), 0);
    }, 0);

    // Top parts
    const partMap = {};
    sales.forEach(sale => {
      (sale.sale_items || []).forEach(item => {
        const key = item.part_name;
        if (!partMap[key]) partMap[key] = { name: key, qty: 0, revenue: 0 };
        partMap[key].qty += (item.quantity || 0);
        partMap[key].revenue += (item.line_total || 0);
      });
    });
    const topParts = Object.values(partMap)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    return {
      date: new Date().toISOString().split('T')[0],
      transaction_count: sales.length,
      total_cash: totalCash,
      total_mpesa: totalMpesa,
      total_credit: totalCredit,
      total_revenue: totalCash + totalMpesa + totalCredit,
      items_sold: totalItems,
      top_parts: topParts
    };
  }
};

// ============================================================
// RESTOCK
// ============================================================

const Restock = {
  async getAll() {
    const { data, error } = await _supabase
      .from('restock_requests')
      .select('*, parts(name, code, qty), suppliers(name, phone)')
      .order('created_at', { ascending: false });
    return { data, error };
  },

  async create(request) {
    const { data, error } = await _supabase
      .from('restock_requests')
      .insert([request])
      .select()
      .single();
    return { data, error };
  },

  async updateStatus(id, status) {
    const { data, error } = await _supabase
      .from('restock_requests')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    return { data, error };
  }
};

// ============================================================
// EXPORT
// ============================================================
window.DB = {
  Auth,
  Parts,
  PartImages,
  Sales,
  Credits,
  Suppliers,
  ShopSettings,
  DailyClosing,
  Restock
};
