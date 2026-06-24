// ============================================================
// SAHAJA SHOP TOOL — MAIN APPLICATION
// ============================================================

// ---- Live Clock ----
let _clockInterval = null;

function startLiveClock() {
  // Clear any previous interval
  if (_clockInterval) clearInterval(_clockInterval);

  function tick() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const date = now.toLocaleDateString('en-KE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

    // Sidebar clock
    const sbTime = document.getElementById('sidebar-clock-time');
    if (sbTime) sbTime.textContent = time;

    // Mobile top bar clock
    const mobileClk = document.getElementById('mobile-clock');
    if (mobileClk) mobileClk.textContent = time;

    // Header clocks (dashboard / POS)
    const hdrTime = document.getElementById('header-live-time');
    if (hdrTime) hdrTime.textContent = time;
    const hdrDate = document.getElementById('header-live-date');
    if (hdrDate) hdrDate.textContent = date;
  }

  tick(); // Run immediately
  _clockInterval = setInterval(tick, 1000);
}

// ============================================================
// SECURITY UTILITIES
// ============================================================

/**
 * XSS Sanitizer — ALWAYS use this when injecting user-supplied
 * data into innerHTML. Converts < > " ' & into HTML entities.
 * @param {any} val - value to sanitize
 * @returns {string} safe HTML string
 */
function sanitize(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize a number for safe display (prevents NaN/Infinity injection)
 * @param {any} val
 * @returns {number}
 */
function safeNum(val) {
  const n = parseFloat(val);
  return isNaN(n) || !isFinite(n) ? 0 : n;
}

/**
 * Validate M-PESA transaction code format (alphanumeric, 10 chars)
 * Prevents arbitrary text being stored as transaction codes
 */
function validateMpesaCode(code) {
  if (!code) return true; // optional field
  return /^[A-Z0-9]{6,12}$/.test(code.trim().toUpperCase());
}

/**
 * Strip any script/html tags from free-text input fields
 * Used before saving customer names, notes etc.
 */
function sanitizeInput(val) {
  if (!val) return '';
  return String(val).replace(/<[^>]*>/g, '').trim().substring(0, 500);
}

const App = (() => {

  // Switch POS tab on mobile (parts ↔ cart)
  function switchPOSTab(tab) {
    const layout = document.getElementById('pos-layout');
    if (layout) layout.dataset.tab = tab;
    document.getElementById('tab-parts')?.classList.toggle('active', tab === 'parts');
    document.getElementById('tab-cart')?.classList.toggle('active', tab === 'cart');
  }

  // ---- Navigation ----
  let state = {
    user: null,
    settings: {},
    currentPage: 'dashboard',
    parts: [],
    categories: [],
    suppliers: [],
    credits: [],
    cart: [],
    cartPayment: 'cash',
    cartMpesaTxn: '',
    searchQuery: '',
    selectedCategory: 'all',
    lowStockCount: 0,
    toastTimer: null,
    currentSalesChannel: 'shop',
    customerDatabase: [],
    selectedCustomerKey: null,
    enteredPin: '',
  };

  // ---- Toast ----
  function showToast(message, type = 'success', duration = 3500) {
    const icons = { success: '✓', error: '✕', warning: '⚠' };
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  function renderMobileNav(activePage) {
    // Use matchMedia — same engine as CSS, more reliable than innerWidth
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobile) return; // desktop: skip entirely

    // Remove existing mobile elements
    document.getElementById('mobile-topbar')?.remove();
    document.getElementById('mobile-bottom-nav')?.remove();

    const s = state.settings;
    const navItems = [
      { page: 'dashboard', label: 'Home',      icon: icons.dashboard },
      { page: 'pos',       label: 'Sale',       icon: icons.pos },
      { page: 'inventory', label: 'Stock',      icon: icons.inventory },
      { page: 'credits',   label: 'Credits',    icon: icons.credit },
      { page: 'reports',   label: 'Reports',    icon: icons.reports },
    ];

    // Top bar
    const topbar = document.createElement('div');
    topbar.className = 'mobile-topbar';
    topbar.id = 'mobile-topbar';
    const opInitials = state.operator?.name?.slice(0, 2).toUpperCase() || 'SS';
    topbar.innerHTML = `
      <div class="mobile-topbar-logo" onclick="App.confirmSwitchOperator()" title="Switch Operator">
        <div class="mobile-topbar-badge" style="background:var(--accent); color:#fff; font-size:11px; font-weight:700">
          ${opInitials}
        </div>
        <div class="mobile-topbar-name">Sahaja Shop</div>
      </div>
      <div style="display:flex; align-items:center; gap:10px">
        <div class="mobile-topbar-time" id="mobile-clock">--:--:-- --</div>
        <button class="mobile-topbar-settings-btn" onclick="App.navigate('settings')">
          ${icons.settings}
        </button>
      </div>
    `;

    // Bottom nav
    const nav = document.createElement('div');
    nav.className = 'mobile-bottom-nav';
    nav.id = 'mobile-bottom-nav';
    nav.innerHTML = navItems.map(item => `
      <button class="mobile-nav-item ${item.page === activePage ? 'active' : ''}"
        onclick="App.navigate('${item.page}')">
        ${item.icon}
        <span>${item.label}</span>
        ${item.page === 'inventory' && state.lowStockCount > 0
          ? `<span class="mobile-nav-badge">${state.lowStockCount}</span>` : ''}
      </button>
    `).join('');

    // Insert topbar before main-content, nav at end of body
    const app = document.getElementById('app');
    app.insertBefore(topbar, app.firstChild);
    document.body.appendChild(nav);
  }

  function navigate(page) {
    state.currentPage = page;
    // Desktop sidebar active state
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });
    // Mobile bottom nav active state
    document.querySelectorAll('.mobile-nav-item').forEach(el => {
      const matches = el.getAttribute('onclick')?.includes(`'${page}'`);
      el.classList.toggle('active', !!matches);
    });
    renderPage(page);
  }

  // ---- Format KSh ----
  function ksh(amount) {
    return `KSh ${Number(amount || 0).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
  }

  // ---- Stock status helper ----
  function stockStatus(part) {
    if (part.stock_qty <= 0) return 'out';
    if (part.stock_qty <= (part.min_stock_threshold || 5)) return 'low';
    return 'good';
  }

  // ---- Stock dot ----
  function stockDot(part) {
    const s = stockStatus(part);
    return `<span class="stock-dot ${s}"></span>`;
  }

  // ---- SVG icons (inline) ----
  const icons = {
    dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`,
    inventory: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 3l-4 4-4-4"/></svg>`,
    pos: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
    credit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`,
    reports: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    barcode: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5v14M7 5v14M13 5v14M17 5v14M21 5v14M3 5h2M19 5h2M3 19h2M19 19h2M7 5h2M7 19h2M13 5h4M13 19h4"/></svg>`,
    cart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 001.95-1.57L23 6H6"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4a1,1 0,0,1 1-1h4a1,1 0,0,1 1,1v2"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    print: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 6,2 18,2 18,9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>`,
    alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><triangle x1="12" y1="2" x2="2" y2="22" x3="22" y3="22"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    logout: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6,9 12,15 18,9"/></svg>`,
    user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  };

  // ============================================================
  // AUTH
  // ============================================================

  function renderAuth() {
    document.getElementById('app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('auth-screen').innerHTML = `
      <div class="auth-card">
        <div class="auth-logo">
          <div class="auth-logo-badge">
            <img src="logo.png" alt="Logo" class="logo-img" onload="this.closest('.auth-logo-badge')?.classList.add('has-logo')" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block'; this.closest('.auth-logo-badge')?.classList.remove('has-logo');">
            <span style="display: none;">SS</span>
          </div>
          <div>
            <div class="auth-shop-name">Sahaja Spare Shop</div>
            <div class="auth-shop-sub">Industrial Ops</div>
          </div>
        </div>
        <div class="auth-title">Sign In</div>
        <div class="auth-sub">Enter your credentials to access the shop tool.</div>
        <div id="auth-error" class="auth-error hidden"></div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="auth-email" class="form-input" placeholder="owner@sahaja.co.ke" autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="auth-password" class="form-input" placeholder="••••••••" autocomplete="current-password">
        </div>
        <button class="btn btn-primary btn-full btn-lg mt-4" id="sign-in-btn" onclick="App.signIn()">Sign In</button>
      </div>
    `;

    // Allow Enter key
    document.getElementById('auth-screen').addEventListener('keydown', e => {
      if (e.key === 'Enter') App.signIn();
    });
  }

  async function signIn() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const btn = document.getElementById('sign-in-btn');
    const errEl = document.getElementById('auth-error');

    btn.textContent = 'Signing in...';
    btn.disabled = true;
    errEl.classList.add('hidden');

    const { data, error } = await DB.Auth.signIn(email, password);
    if (error) {
      errEl.textContent = 'Invalid email or password. Please try again.';
      errEl.classList.remove('hidden');
      btn.textContent = 'Sign In';
      btn.disabled = false;
      return;
    }

    state.user = data.user;
    await initApp();
  }

  // ============================================================
  // APP INIT
  // ============================================================

  // ---- SW update listener: silently reload when new version deploys ----
  function registerSWUpdateListener() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[App] New SW active — reloading for fresh version');
      window.location.reload();
    });
  }

  async function initApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');

    // Listen for SW updates — auto-reload when new version deploys
    registerSWUpdateListener();

    // Load settings
    const { data: settings } = await DB.ShopSettings.get();
    state.settings = settings || {};
    applyTheme(state.settings.theme || 'carbon-red');

    // Load initial data
    await loadBaseData();

    // Load operators
    const { data: ops } = await DB.Operators.getAll();
    state.operators = ops || [];

    // Automatically resolve the operator profile based on the logged-in email
    if (state.user) {
      const matchedOp = state.operators.find(op => op.email?.toLowerCase() === state.user.email?.toLowerCase() || op.id === state.user.id);
      if (matchedOp) {
        state.operator = matchedOp;
        sessionStorage.setItem('current_operator', JSON.stringify(matchedOp));
        
        renderSidebar();
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        if (isMobile) {
          renderMobileNav('dashboard');
        }
        navigate('dashboard');
      } else {
        showToast('Operator profile not found for ' + state.user.email, 'error');
        await DB.Auth.signOut();
        sessionStorage.removeItem('current_operator');
        state.operator = null;
        state.user = null;
        document.getElementById('app').classList.add('hidden');
        renderAuth();
      }
    } else {
      document.getElementById('app').classList.add('hidden');
      renderAuth();
    }
  }

  function confirmSwitchOperator() {
    confirmSignOut();
  }

  function showPinVerificationModal(onSuccess) {
    if (!state.operator) {
      showToast('No logged in operator', 'error');
      return;
    }
    const modal = createModal('Security Verification', `
      <div style="font-size:13px; color:var(--text-muted); text-align:center; margin-bottom:12px">
        Please enter your operator password to authorize this action.
      </div>
      <div class="form-group">
        <input type="password" id="operator-verification-password-input" class="form-input" placeholder="Enter password" maxlength="32" style="text-align:center; font-size:16px; letter-spacing:2px; height:44px; margin-bottom:12px;">
      </div>
    `, [
      { text: 'Cancel', class: 'btn-secondary', action: () => closeModal() },
      { text: 'Verify', class: 'btn-primary', action: async () => {
          const input = document.getElementById('operator-verification-password-input');
          const password = input?.value;
          if (!password) { showToast('Password is required', 'error'); return; }

          const btn = document.querySelector('#part-modal .btn-primary');
          if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

          const { data: verified, error } = await DB.Operators.verifyPassword(state.operator.id, password);
          if (error) {
            showToast('Verification error: ' + error.message, 'error');
            if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
            return;
          }

          if (verified) {
            closeModal();
            onSuccess();
          } else {
            showToast('Incorrect password', 'error');
            if (input) { input.value = ''; input.focus(); }
            if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
          }
        }
      }
    ]);

    document.body.appendChild(modal);

    setTimeout(() => {
      const input = document.getElementById('operator-verification-password-input');
      input?.focus();
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          document.querySelector('#part-modal .btn-primary')?.click();
        }
      });
    }, 100);
  }

  function navigateWithPIN(page) {
    showPinVerificationModal(() => {
      navigate(page);
    });
  }

  async function loadBaseData() {
    const [partsRes, suppliersRes, creditsRes, catsRes] = await Promise.all([
      DB.Parts.getAll(),
      DB.Suppliers.getAll(),
      DB.Credits.getAll(),
      DB.Parts.getCategories()
    ]);
    state.parts = partsRes.data || [];
    state.suppliers = suppliersRes.data || [];
    state.credits = creditsRes.data || [];
    state.categories = catsRes.data || [];
    state.lowStockCount = state.parts.filter(p => stockStatus(p) !== 'good').length;

    // Update nav badge
    const badge = document.getElementById('low-stock-badge');
    if (badge) {
      badge.textContent = state.lowStockCount;
      badge.classList.toggle('hidden', state.lowStockCount === 0);
    }
  }

  // ============================================================
  // SIDEBAR
  // ============================================================

  function renderSidebar() {
    const s = state.settings;
    const operatorName = state.operator?.name || 'No Operator';
    const operatorRole = state.operator?.role || 'Staff';
    const opInitials = operatorName.slice(0, 2).toUpperCase();

    document.getElementById('sidebar').innerHTML = `
      <div class="sidebar-logo">
        <div class="sidebar-logo-badge">
          <img src="logo.png" alt="Logo" class="logo-img" onload="this.closest('.sidebar-logo-badge')?.classList.add('has-logo')" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block'; this.closest('.sidebar-logo-badge')?.classList.remove('has-logo');">
          <span style="display: none;">SS</span>
        </div>
        <div class="sidebar-shop-name">Sahaja Spare Shop</div>
        <div class="sidebar-sub">Industrial Ops</div>
      </div>

      <button class="new-sale-btn" onclick="App.navigate('pos')">
        ${icons.plus} New Sale
      </button>

      <nav class="sidebar-nav">
        <div class="section-label">Main</div>
        <div class="nav-item" data-page="dashboard" onclick="App.navigate('dashboard')">${icons.dashboard} Dashboard</div>
        <div class="nav-item" data-page="inventory" onclick="App.navigate('inventory')">${icons.inventory} Inventory <span id="low-stock-badge" class="nav-badge hidden">${state.lowStockCount}</span></div>
        <div class="nav-item" data-page="pos" onclick="App.navigate('pos')">${icons.pos} Sales POS</div>
        <div class="nav-item" data-page="credits" onclick="App.navigate('credits')">${icons.credit} Credit Log</div>
        <div class="nav-item" data-page="customers" onclick="App.navigateWithPIN('customers')">${icons.user} Customers</div>

        <div class="section-label">Analytics</div>
        <div class="nav-item" data-page="reports" onclick="App.navigate('reports')">${icons.reports} Reports</div>

        <div class="section-label">System</div>
        <div class="nav-item" data-page="settings" onclick="App.navigate('settings')">${icons.settings} Settings</div>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-clock">
          <span>🕐</span><span class="sidebar-clock-time" id="sidebar-clock-time">--:--:-- --</span>
        </div>
        <div class="sidebar-user" onclick="App.confirmSwitchOperator()">
          <div class="user-avatar" style="background:var(--accent); color:#fff">${opInitials}</div>
          <div class="user-info">
            <div class="user-name">${operatorName}</div>
            <div class="user-role">${operatorRole.toUpperCase()}</div>
          </div>
          <span class="logout-icon" title="Switch Operator">${icons.logout}</span>
        </div>
      </div>
    `;
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    state.settings.theme = theme;
  }

  // ============================================================
  // PAGE ROUTER
  // ============================================================

  function renderPage(page) {
    // Stop live clock when leaving dashboard/POS
    if (page !== 'dashboard' && page !== 'pos') {
      if (_clockInterval) { clearInterval(_clockInterval); _clockInterval = null; }
    }
    const content = document.getElementById('main-content');
    switch (page) {
      case 'dashboard': renderDashboard(content); break;
      case 'inventory': renderInventory(content); break;
      case 'pos': renderPOS(content); break;
      case 'credits': renderCredits(content); break;
      case 'reports': renderReports(content); break;
      case 'settings': renderSettings(content); break;
      case 'customers': renderCustomers(content); break;
    }
  }

  // ============================================================
  // DASHBOARD
  // ============================================================

  async function renderDashboard(container) {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const { data: todaySales } = await DB.Sales.getToday();
    const { data: recentSales } = await DB.Sales.getRecent(8);
    const totalCredit = await DB.Credits.getTotalOutstanding();

    const todayRevenue = (todaySales || []).reduce((s, sale) => s + (sale.total_amount || 0), 0);
    const todayCount = (todaySales || []).length;

    // Stock by category
    const catStockMap = {};
    state.parts.forEach(p => {
      const cat = p.category || 'General';
      if (!catStockMap[cat]) catStockMap[cat] = { total: 0, current: 0 };
      catStockMap[cat].current += p.stock_qty || 0;
      catStockMap[cat].total += (p.min_stock_threshold || 5) * 4;
    });

    const catBars = Object.entries(catStockMap).slice(0, 5).map(([cat, vals]) => {
      const pct = Math.min(100, Math.round((vals.current / (vals.total || 1)) * 100));
      const cls = pct < 20 ? 'out' : pct < 40 ? 'low' : 'good';
      const label = pct < 20 ? `${cat.toUpperCase()} (LOW)` : cat.toUpperCase();
      return `
        <div class="stock-cat-item">
          <div class="stock-cat-header">
            <span class="stock-cat-name ${cls === 'out' || cls === 'low' ? 'text-danger' : ''}">${label}</span>
            <span class="stock-cat-pct ${cls === 'out' || cls === 'low' ? 'low' : ''}">${pct}%</span>
          </div>
          <div class="progress-bar"><div class="progress-bar-fill ${cls}" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');

    // Recent sales
    const recentRows = (recentSales || []).map(sale => {
      const items = sale.sale_items || [];
      const firstName = items[0]?.part_name || 'Multiple items';
      const suffix = items.length > 1 ? ` +${items.length - 1}` : '';
      const payBadge = sale.payment_method === 'credit' ? 'badge-credit' : sale.payment_method === 'mpesa' ? 'badge-mpesa' : 'badge-cash';
      return `
        <div class="recent-sale-item" style="cursor:pointer" onclick="App.viewTransactionDetails('${sale.id}')">
          <div class="recent-sale-info">
            <div class="recent-sale-name">${sanitize(firstName)}${suffix}</div>
            <div class="recent-sale-meta">${sale.receipt_number || ''} • ${new Date(sale.created_at).toLocaleTimeString('en-KE', { hour:'2-digit', minute:'2-digit' })}</div>
          </div>
          <div class="recent-sale-right">
            <div class="recent-sale-amount">${ksh(sale.total_amount)}</div>
            <span class="badge ${payBadge}">${sale.payment_method || 'cash'}</span>
          </div>
        </div>
      `;
    }).join('') || '<div class="text-muted text-sm" style="padding:16px">No sales recorded today</div>';

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <div class="page-title">Overview</div>
            <div class="page-subtitle">${state.settings.shop_name || 'Sahaja Motorcycle Spare Parts'}</div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px">
              Welcome back, <strong style="color:var(--accent); font-weight:600">${sanitize(state.operator?.name || 'Operator')}</strong> (${(state.operator?.role || 'employee').toUpperCase()})
            </div>
          </div>
          <div style="text-align:right">
            <div class="header-meta" id="header-live-date">${dateStr}</div>
            <div style="font-size:18px; font-weight:800; font-family:var(--font-mono); color:var(--text-primary); letter-spacing:1px; margin-top:2px" id="header-live-time">--:--:-- --</div>
          </div>
        </div>
      </div>

      <div class="page-body">
        <!-- Stat Tiles -->
        <div class="stat-grid">
          <div class="stat-tile">
            <div class="stat-label">Total Sales Today</div>
            <div class="stat-value">${ksh(todayRevenue)}</div>
            <div class="stat-change up">↑ ${todayCount} transaction${todayCount !== 1 ? 's' : ''}</div>
          </div>
          <div class="stat-tile">
            <div class="stat-dot"></div>
            <div class="stat-label">Low Stock Items</div>
            <div class="stat-value danger">${state.lowStockCount}</div>
            <div class="stat-change">items need restocking</div>
          </div>
          <div class="stat-tile">
            <div class="stat-label">Outstanding Credit</div>
            <div class="stat-value warning">${ksh(totalCredit)}</div>
            <div class="stat-change">in credit sales</div>
          </div>
          <div class="stat-tile">
            <div class="stat-label">Parts in Inventory</div>
            <div class="stat-value">${state.parts.length}</div>
            <div class="stat-change">${state.categories.length} categories</div>
          </div>
        </div>

        <!-- Main grid -->
        <div class="dashboard-grid">
          <div class="dashboard-main">
            <!-- Stock by category -->
            <div class="card">
              <div class="card-header">
                <div class="card-title">Stock Levels by Category</div>
                <button class="btn btn-ghost btn-sm" onclick="App.navigate('inventory')">Details →</button>
              </div>
              <div class="stock-category-list">
                ${catBars || '<div class="text-muted text-sm">No inventory data</div>'}
              </div>
            </div>

            <!-- Sales chart placeholder -->
            <div class="card">
              <div class="card-header">
                <div class="card-title">Finance Analytics</div>
                <span class="text-xs text-muted">Last 7 days</span>
              </div>
              <div class="chart-wrap">
                <canvas id="revenue-chart"></canvas>
              </div>
            </div>
          </div>

          <!-- Recent Sales sidebar -->
          <div class="dashboard-side">
            <div class="card" style="flex:1; overflow:hidden; display:flex; flex-direction:column;">
              <div class="card-header">
                <div class="card-title">Recent Sales</div>
              </div>
              <div class="recent-sales-list" style="flex:1; overflow-y:auto;">
                ${recentRows}
              </div>
              <button class="view-all-btn" onclick="App.navigate('reports')">View All Sales</button>
            </div>

            <!-- Low stock alert -->
            ${state.lowStockCount > 0 ? `
              <div class="card" style="border-color: rgba(239,68,68,0.3);">
                <div class="card-header">
                  <div class="card-title text-danger">Low Stock Alert</div>
                  <span class="badge badge-danger">${state.lowStockCount} items</span>
                </div>
                <div id="low-stock-list">
                  ${state.parts.filter(p => stockStatus(p) !== 'good').slice(0,5).map(p => `
                    <div class="recent-sale-item">
                      <div class="recent-sale-name" style="font-size:12px">${p.name}</div>
                      <span class="stock-text ${stockStatus(p)}" style="font-size:12px">${p.stock_qty} left</span>
                    </div>
                  `).join('')}
                </div>
                <button class="view-all-btn" onclick="App.navigate('inventory')">View Inventory</button>
              </div>
            ` : ''}

            <!-- Daily close -->
            <button class="btn btn-secondary btn-full" onclick="App.showDailyClose()">
              ${icons.print} Daily Closing Report
            </button>
          </div>
        </div>
      </div>
    `;

    // Draw revenue chart
    await drawRevenueChart();
    // Start live clock
    startLiveClock();
  }

  async function drawRevenueChart() {
    const { data: summary } = await DB.Sales.getDailySummary();
    const canvas = document.getElementById('revenue-chart');
    if (!canvas || !summary || !window.Chart) return;

    const last7 = (summary || []).slice(0, 7).reverse();
    const labels = last7.map(d => {
      const dt = new Date(d.sale_date);
      return dt.toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric' });
    });
    const cashData = last7.map(d => d.cash_total || 0);
    const mpesaData = last7.map(d => d.mpesa_total || 0);
    const creditData = last7.map(d => d.credit_total || 0);

    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--accent').trim();
    const info = style.getPropertyValue('--info').trim();
    const warning = style.getPropertyValue('--warning').trim();
    const border = style.getPropertyValue('--border').trim();
    const textMuted = style.getPropertyValue('--text-muted').trim();

    new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Cash', data: cashData, backgroundColor: accent + 'bb', borderRadius: 3 },
          { label: 'MPESA', data: mpesaData, backgroundColor: info + 'bb', borderRadius: 3 },
          { label: 'Credit', data: creditData, backgroundColor: warning + 'bb', borderRadius: 3 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textMuted, font: { size: 11 }, boxWidth: 12 } },
          tooltip: {
            callbacks: { label: ctx => ` KSh ${ctx.raw.toLocaleString()}` }
          }
        },
        scales: {
          x: { stacked: true, grid: { color: border }, ticks: { color: textMuted, font: { size: 11 } } },
          y: { stacked: true, grid: { color: border }, ticks: { color: textMuted, font: { size: 11 }, callback: v => `KSh ${v.toLocaleString()}` } }
        }
      }
    });
  }

  // ============================================================
  // POS
  // ============================================================

  function renderPOS(container) {
    const now = new Date();
    const txnId = `TXN-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <div class="page-title">Point of Sale</div>
            <div style="display:flex; align-items:center; gap:10px; margin-top:4px;">
              <span class="live-indicator"><span class="live-dot"></span> Live Auto-Deduct Active</span>
              <div class="pos-channel-toggle">
                <button class="channel-btn ${state.currentSalesChannel === 'shop' ? 'active' : ''}" id="channel-shop" onclick="App.setSalesChannel('shop')">
                  Shop Stock
                </button>
                <button class="channel-btn ${state.currentSalesChannel === 'ground' ? 'active' : ''}" id="channel-ground" onclick="App.setSalesChannel('ground')">
                  Ground Stock
                </button>
              </div>
            </div>
          </div>
          <div style="text-align:right;">
            <div class="header-meta">${txnId}</div>
            <div class="header-meta" id="header-live-date">${now.toLocaleDateString('en-KE', { weekday:'short', day:'2-digit', month:'short', year:'numeric' })}</div>
            <div style="font-size:15px; font-weight:800; font-family:var(--font-mono); color:var(--text-primary); letter-spacing:0.5px; margin-top:2px" id="header-live-time">--:--:-- --</div>
          </div>
        </div>
      </div>

      <div class="pos-layout" id="pos-layout" data-tab="parts" style="flex:1; overflow:hidden;">

        <!-- Mobile tab bar — hidden on desktop via CSS -->
        <div class="pos-mobile-tabs">
          <button class="pos-tab active" id="tab-parts" onclick="App.switchPOSTab('parts')">
            ${icons.inventory} Browse Parts
          </button>
          <button class="pos-tab" id="tab-cart" onclick="App.switchPOSTab('cart')">
            ${icons.cart} Cart&nbsp;<span class="pos-tab-badge" id="pos-tab-badge">0</span>
          </button>
        </div>
        <!-- LEFT: Part grid -->
        <div class="pos-grid-panel">
          <div class="pos-search-bar">
            <div class="pos-search-row">
              <div class="search-wrap" style="flex:1">
                ${icons.search}
                <input type="text" id="pos-search" class="search-input" placeholder="Scan barcode or search by part name, SKU..." oninput="App.filterPOSParts(this.value)" autofocus>
              </div>
              <div class="barcode-hint">${icons.barcode} Barcode</div>
            </div>
            <div class="filter-pills" id="pos-pills">
              <span class="pill active" data-cat="all" onclick="App.setPOSCategory('all', this)">All Parts</span>
              ${state.categories.map(cat => `<span class="pill" data-cat="${cat}" onclick="App.setPOSCategory('${cat}', this)">${cat}</span>`).join('')}
            </div>
          </div>
          <div class="pos-parts-scroll">
            <div class="parts-grid" id="pos-parts-grid">
              ${renderPartCards(state.parts)}
            </div>
          </div>
        </div>

        <!-- RIGHT: Cart -->
        <div class="pos-cart-panel" id="pos-cart-panel">
          <div class="cart-header">
            <div class="cart-title">Sale Summary</div>
            <span class="cart-count" id="cart-count">0 Items</span>
            <!-- Mobile back button -->
            <button class="cart-back-btn" onclick="App.switchPOSTab('parts')">
              ← Back
            </button>
          </div>
          <div class="cart-items" id="cart-items">
            <div class="cart-empty-state">
              ${icons.cart}
              <div>Cart is empty</div>
              <div class="text-xs mt-2">Select parts from the grid to add them</div>
            </div>
          </div>
          <div class="cart-summary">
            <div class="summary-row">
              <span>Subtotal</span>
              <span id="cart-subtotal">KSh 0.00</span>
            </div>
            <div class="vat-note">*All prices inclusive of applicable taxes</div>
            <div class="summary-row total">
              <span>Total</span>
              <span id="cart-total">KSh 0.00</span>
            </div>

            <div class="payment-methods">
              <button class="pay-method-btn active" id="pay-cash" onclick="App.setPayMethod('cash')">Cash</button>
              <button class="pay-method-btn" id="pay-mpesa" onclick="App.setPayMethod('mpesa')">MPESA</button>
              <button class="pay-method-btn" id="pay-credit" onclick="App.setPayMethod('credit')">Credit</button>
            </div>

            <div id="mpesa-txn-wrap" class="mpesa-txn-wrap hidden">
              <input type="text" id="mpesa-txn-input" class="form-input" placeholder="MPESA TXN code e.g. QK7X3AB9P" maxlength="12" style="text-transform:uppercase; font-family:var(--font-mono)">
            </div>

            <div id="credit-customer-wrap" style="margin-top: 10px;">
              <input type="text" id="credit-customer-name" class="form-input mb-2" placeholder="Customer name (Optional)">
              <input type="tel" id="credit-customer-phone" class="form-input mb-2" placeholder="Customer phone e.g. 0712 345 678">
              <input type="text" id="credit-customer-location" class="form-input" placeholder="Customer location (Optional)">
            </div>

            <button class="process-btn mt-3" id="process-btn" onclick="App.processSale()" disabled>
              ${icons.pos} Process Sale
            </button>
          </div>
        </div>
      </div>
    `;

    state.cart = [];
    state.cartPayment = 'cash';
    updateCart();
    // Start live clock on POS
    startLiveClock();
  }

  function renderPartCards(parts) {
    if (!parts || parts.length === 0) {
      return `<div class="empty-state" style="grid-column:1/-1"><div class="text-muted">No parts found</div></div>`;
    }
    return parts.map(part => {
      const channel = state.currentSalesChannel || 'shop';
      const qty = channel === 'ground' ? (part.ground_qty ?? 0) : (part.shop_qty ?? 0);
      const isOut = qty <= 0;
      const isLow = qty > 0 && qty <= (part.min_stock_threshold || 5);
      const status = isOut ? 'out' : isLow ? 'low' : 'good';
      
      const imgEl = part.image_url
        ? `<img class="part-card-img" src="${part.image_url}" alt="${part.name}" loading="lazy">`
        : `<div class="part-card-img-placeholder">${icons.image}</div>`;

      return `
        <div class="part-card ${isOut ? 'out-of-stock' : ''}" onclick="App.addToCart('${part.id}')">
          ${imgEl}
          <div class="part-card-body">
            <div class="part-card-top">
              <span class="badge badge-category" style="font-size:9px">${part.category || 'PART'}</span>
              <span class="stock-dot ${status}" title="${qty} units left in ${channel}"></span>
            </div>
            <div class="part-card-name">${sanitize(part.name)}</div>
            <div class="part-card-sku">${sanitize(part.sku)}</div>
            <div class="part-card-footer">
              <div class="part-card-price">${ksh(part.selling_price)}</div>
              <button class="part-card-add" onclick="event.stopPropagation(); App.addToCart('${part.id}')">${icons.plus}</button>
            </div>
          </div>
          ${isOut ? `<div class="out-overlay" style="pointer-events: none;"><div class="out-label">Out of Stock (Can Source)</div></div>` : ''}
        </div>
      `;
    }).join('');
  }

  function filterPOSParts(query) {
    state.searchQuery = query;
    applyPOSFilter();
  }

  function setPOSCategory(cat, el) {
    state.selectedCategory = cat;
    document.querySelectorAll('#pos-pills .pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    applyPOSFilter();
  }

  function applyPOSFilter() {
    let parts = state.parts;
    if (state.selectedCategory !== 'all') {
      parts = parts.filter(p => p.category === state.selectedCategory);
    }
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      parts = parts.filter(p =>
        p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)
      );
    }
    document.getElementById('pos-parts-grid').innerHTML = renderPartCards(parts);
  }

  function addToCart(partId) {
    const part = state.parts.find(p => p.id === partId);
    if (!part) return;

    const existing = state.cart.find(i => i.part_id === partId);
    if (existing) {
      existing.quantity += 1;
    } else {
      state.cart.push({
        part_id: part.id,
        part_name: part.name,
        sku: part.sku,
        unit_price: part.selling_price,
        buying_price: part.buying_price || 0,
        quantity: 1
      });
    }
    updateCart();
  }

  function updateCartQty(partId, qty) {
    const item = state.cart.find(i => i.part_id === partId);
    if (!item) return;
    item.quantity = Math.max(1, parseInt(qty) || 1);
    updateCart();
  }

  function removeFromCart(partId) {
    state.cart = state.cart.filter(i => i.part_id !== partId);
    updateCart();
  }

  function updateCart() {
    const subtotal = state.cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const count = state.cart.reduce((s, i) => s + i.quantity, 0);

    document.getElementById('cart-count').textContent = `${count} Item${count !== 1 ? 's' : ''}`;
    document.getElementById('cart-subtotal').textContent = ksh(subtotal);
    document.getElementById('cart-total').textContent = ksh(subtotal);

    const processBtn = document.getElementById('process-btn');
    if (processBtn) processBtn.disabled = state.cart.length === 0;

    // Sync mobile tab badge
    const tabBadge = document.getElementById('pos-tab-badge');
    if (tabBadge) {
      tabBadge.textContent = state.cart.length;
      tabBadge.style.display = state.cart.length > 0 ? 'inline-flex' : 'none';
    }

    const cartEl = document.getElementById('cart-items');
    if (!cartEl) return;

    if (state.cart.length === 0) {
      cartEl.innerHTML = `<div class="cart-empty-state">${icons.cart}<div>Cart is empty</div><div class="text-xs mt-2">Select parts from the grid to add them</div></div>`;
      return;
    }

    cartEl.innerHTML = state.cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-name">${sanitize(item.part_name)}</div>
        <div class="cart-item-sku">${sanitize(item.sku)}</div>
        <div class="cart-item-row">
          <div class="qty-control">
            <button class="qty-btn" onclick="App.updateCartQty('${item.part_id}', ${item.quantity - 1})">−</button>
            <input class="qty-val" type="number" value="${item.quantity}" min="1" onchange="App.updateCartQty('${item.part_id}', this.value)">
            <button class="qty-btn" onclick="App.updateCartQty('${item.part_id}', ${item.quantity + 1})">+</button>
          </div>
          <div class="cart-item-total">${ksh(item.unit_price * item.quantity)}</div>
          <button class="cart-remove" onclick="App.removeFromCart('${item.part_id}')">${icons.trash}</button>
        </div>
        <div class="text-xs text-muted">${ksh(item.unit_price)} each</div>
      </div>
    `).join('');
  }

  function setPayMethod(method) {
    state.cartPayment = method;
    ['cash', 'mpesa', 'credit'].forEach(m => {
      document.getElementById(`pay-${m}`)?.classList.toggle('active', m === method);
    });
    document.getElementById('mpesa-txn-wrap')?.classList.toggle('hidden', method !== 'mpesa');
    
    const nameInput = document.getElementById('credit-customer-name');
    if (nameInput) {
      if (method === 'credit') {
        nameInput.placeholder = 'Customer name * (Required)';
      } else {
        nameInput.placeholder = 'Customer name (Optional)';
      }
    }
  }

  function showSourcingModal(shortItems, onProceed) {
    const formHTML = shortItems.map((si, index) => `
      <div class="sourcing-item-form" data-index="${index}" data-part-id="${si.part.id}" data-shortage="${si.shortage}">
        <div class="sourcing-item-title">
          <span>${sanitize(si.part.name)}</span>
          <span style="color:var(--danger)">Shortage: ${si.shortage} units (Order: ${si.item.quantity}, Stock: ${si.available})</span>
        </div>
        <div class="sourcing-form-grid">
          <div class="form-group">
            <label class="form-label" style="font-size:10px">Sourcing Shop *</label>
            <input type="text" class="form-input src-shop" placeholder="e.g. Grogan Road Spares" required>
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size:10px">Cost Price (Per Unit) *</label>
            <input type="number" class="form-input src-cost" placeholder="0.00" min="0" step="0.01" value="${si.part.buying_price || ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size:10px">Payment Status *</label>
            <select class="form-select src-status">
              <option value="paid">Fully Paid</option>
              <option value="partial">Partially Paid</option>
              <option value="credit">On Credit</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size:10px">Payment Method *</label>
            <select class="form-select src-method">
              <option value="cash">Cash</option>
              <option value="mpesa">Mpesa</option>
              <option value="credit">Credit / None</option>
            </select>
          </div>
        </div>
      </div>
    `).join('');

    const modal = createModal('Out-of-Stock Sourcing Details', `
      <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px">
        Some items exceed available stock. Please log where the extra items are being sourced from for internal bookkeeping.
      </div>
      <div style="max-height: 350px; overflow-y: auto;">
        ${formHTML}
      </div>
    `, [
      { text: 'Cancel', class: 'btn-secondary', action: () => {
          closeModal();
          const btn = document.getElementById('process-btn');
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = `${icons.pos} Process Sale`;
          }
        }
      },
      { text: 'Save & Complete Sale', class: 'btn-primary', action: () => {
          const forms = document.querySelectorAll('.sourcing-item-form');
          let valid = true;
          const sourcingDetails = [];

          forms.forEach(f => {
            const shop = f.querySelector('.src-shop').value.trim();
            const cost = parseFloat(f.querySelector('.src-cost').value);
            const status = f.querySelector('.src-status').value;
            const method = f.querySelector('.src-method').value;
            const partId = f.dataset.partId;
            const shortage = parseInt(f.dataset.shortage);

            if (!shop || isNaN(cost) || cost < 0) {
              valid = false;
            } else {
              sourcingDetails.push({
                part_id: partId,
                quantity: shortage,
                sourcing_shop: shop,
                cost_price: cost,
                payment_status: status,
                payment_method: method
              });
            }
          });

          if (!valid) {
            showToast('Please fill out all sourcing details', 'error');
            return;
          }

          closeModal();
          onProceed(sourcingDetails);
        }
      }
    ]);

    document.body.appendChild(modal);
  }

  async function processSale() {
    if (state.cart.length === 0) return;
    const btn = document.getElementById('process-btn');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    const subtotal = state.cart.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const receiptNum = await DB.Sales.getNextReceiptNumber(state.settings.receipt_prefix || 'SAH');
    const mpesaTxn = document.getElementById('mpesa-txn-input')?.value?.trim().toUpperCase() || null;
    const customerName = document.getElementById('credit-customer-name')?.value?.trim() || null;
    const customerPhone = document.getElementById('credit-customer-phone')?.value?.trim() || null;
    const customerLocation = document.getElementById('credit-customer-location')?.value?.trim() || null;

    if (state.cartPayment === 'credit' && !customerName) {
      showToast('Customer name is required for credit sales', 'error');
      btn.disabled = false;
      btn.innerHTML = `${icons.pos} Process Sale`;
      return;
    }

    // Sourcing check
    const shortItems = [];
    for (const item of state.cart) {
      const part = state.parts.find(p => p.id === item.part_id);
      if (part) {
        const channelQty = (state.currentSalesChannel === 'ground') ? (part.ground_qty || 0) : (part.shop_qty || 0);
        if (item.quantity > channelQty) {
          shortItems.push({
            item: item,
            part: part,
            available: channelQty,
            shortage: item.quantity - channelQty
          });
        }
      }
    }

    const proceedWithSale = async (sourcingList = []) => {
      sourcingList.forEach(detail => {
        const item = state.cart.find(i => i.part_id === detail.part_id);
        if (item) {
          item.sourcing = detail;
        }
      });

      const sale = {
        total_amount: subtotal,
        payment_method: state.cartPayment,
        receipt_number: receiptNum,
        mpesa_txn_code: state.cartPayment === 'mpesa' ? mpesaTxn : null,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_location: customerLocation,
        operator_name: state.operator?.name || 'Unknown',
        sales_channel: state.currentSalesChannel || 'shop',
        created_at: new Date().toISOString()
      };

      const { data: saleData, error } = await DB.Sales.create(sale, state.cart);

      if (error) {
        showToast('Error recording sale: ' + error.message, 'error');
        btn.disabled = false;
        btn.innerHTML = `${icons.pos} Process Sale`;
        return;
      }

      // If credit, create credit record
      if (state.cartPayment === 'credit' && customerName) {
        await DB.Credits.create({
          customer_name: customerName,
          customer_phone: customerPhone,
          amount_owed: subtotal,
          original_amount: subtotal,
          status: 'pending',
          payment_history: [],
          sale_id: saleData.id
        });
      }

      // Refresh parts (stock updated)
      const { data: parts } = await DB.Parts.getAll();
      state.parts = parts || [];
      state.lowStockCount = state.parts.filter(p => stockStatus(p) !== 'good').length;

      showToast(`Sale recorded! ${receiptNum}`, 'success');

      // Show receipt modal
      showReceiptModal(saleData, state.cart, receiptNum);

      // Clear cart
      state.cart = [];
      state.cartPayment = 'cash';
      updateCart();

      // Reset fields
      const nameInput = document.getElementById('credit-customer-name');
      if (nameInput) nameInput.value = '';
      const phoneInput = document.getElementById('credit-customer-phone');
      if (phoneInput) phoneInput.value = '';
      const locInput = document.getElementById('credit-customer-location');
      if (locInput) locInput.value = '';
      const mpesaInput = document.getElementById('mpesa-txn-input');
      if (mpesaInput) mpesaInput.value = '';
    };

    if (shortItems.length > 0) {
      showSourcingModal(shortItems, proceedWithSale);
    } else {
      await proceedWithSale();
    }
  }

  function showReceiptModal(sale, items, receiptNum, isViewOnly = false) {
    const s = state.settings;
    const receiptHTML = Receipt.generateReceiptHTML(
      { ...sale, receipt_number: receiptNum },
      items.map(i => ({ ...i, line_total: i.unit_price * i.quantity })),
      s
    );

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'receipt-modal';
    
    // Add Share PDF button for mobile
    const isMobile = window.matchMedia('(max-width: 768px)').matches;
    const shareBtn = isMobile ? `
      <button class="btn btn-secondary" onclick="App.shareReceiptPDF('${sale.id || ''}', '${receiptNum}')">
        ${icons.download} Share PDF
      </button>
    ` : '';
    
    const title = isViewOnly ? `Transaction Details — ${receiptNum}` : `Sale Complete — ${receiptNum}`;
    const closeAction = isViewOnly 
      ? `document.getElementById('receipt-modal').remove()` 
      : `document.getElementById('receipt-modal').remove(); App.navigate('pos')`;

    const buttonLabel = isViewOnly ? 'Close' : 'New Sale';

    modal.innerHTML = `
      <div class="modal modal-wide">
        <div class="modal-header">
          <div class="modal-title">${title}</div>
          <button class="modal-close no-print" onclick="${closeAction}">${icons.close}</button>
        </div>
        <div class="receipt-modal-body">
          ${receiptHTML}
        </div>
        <div class="receipt-actions no-print" style="gap:8px">
          <button class="btn btn-secondary" onclick="${closeAction}">${buttonLabel}</button>
          ${shareBtn}
          <button class="btn btn-primary" onclick="window.print()">${icons.print} Print Receipt</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  function setSalesChannel(channel) {
    state.currentSalesChannel = channel;
    document.getElementById('channel-shop')?.classList.toggle('active', channel === 'shop');
    document.getElementById('channel-ground')?.classList.toggle('active', channel === 'ground');
    
    // Refresh POS Browse parts grid
    applyPOSFilter();
  }

  async function viewTransactionDetails(saleId) {
    showPinVerificationModal(async () => {
      const { data: sale } = await DB.Sales.getSaleWithItems(saleId);
      if (!sale) { showToast('Sale details not found', 'error'); return; }
      showReceiptModal(sale, sale.sale_items, sale.receipt_number, true);
    });
  }

  function shareReceiptPDF(saleId, receiptNum) {
    const element = document.getElementById('receipt-printable');
    if (!element) { showToast('Receipt preview not found', 'error'); return; }
    
    showToast('Generating PDF...', 'info');
    
    const opt = {
      margin:       0.2,
      filename:     `receipt-${receiptNum}.pdf`,
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2 },
      jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
    };
    
    html2pdf().set(opt).from(element).outputPdf('blob').then(async (blob) => {
      const file = new File([blob], `receipt-${receiptNum}.pdf`, { type: 'application/pdf' });
      
      if (navigator.share) {
        try {
          await navigator.share({
            files: [file],
            title: `Sahaja Spare Shop Receipt ${receiptNum}`,
            text: `Receipt for purchase ${receiptNum} at Sahaja Motorcycle Spare Parts.`
          });
          showToast('Receipt shared successfully', 'success');
        } catch (err) {
          if (err.name !== 'AbortError') {
            showToast('Sharing failed, downloading PDF', 'warning');
            triggerPDFDownload(blob, `receipt-${receiptNum}.pdf`);
          }
        }
      } else {
        showToast('Share not supported, downloading PDF', 'info');
        triggerPDFDownload(blob, `receipt-${receiptNum}.pdf`);
      }
    }).catch(err => {
      showToast('PDF generation error: ' + err.message, 'error');
    });
  }

  function triggerPDFDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ============================================================
  // INVENTORY
  // ============================================================

  function renderInventory(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <div class="page-title">Inventory Ledger</div>
            <div class="page-subtitle">Manage spare parts, stock levels, and pricing.</div>
          </div>
          <div style="display:flex;gap:10px">
            <button class="btn btn-secondary" onclick="App.showTransferStockModal()">Transfer Stock</button>
            <button class="btn btn-secondary" onclick="App.exportInventoryCSV()">${icons.download} Export</button>
            <button class="btn btn-primary" onclick="App.showAddPartModal()">${icons.plus} Add Part</button>
          </div>
        </div>
      </div>
      <div class="page-body">
        <div class="inventory-toolbar">
          <div class="search-wrap" style="flex:1; max-width:320px">
            ${icons.search}
            <input type="text" id="inv-search" class="search-input" placeholder="Search by SKU or part name..." oninput="App.filterInventory()">
          </div>
          <select class="filter-select" id="inv-cat-filter" onchange="App.filterInventory()">
            <option value="">All Categories</option>
            ${state.categories.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <select class="filter-select" id="inv-supplier-filter" onchange="App.filterInventory()">
            <option value="">All Suppliers</option>
            ${state.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
          <select class="filter-select" id="inv-stock-filter" onchange="App.filterInventory()">
            <option value="">Stock Status</option>
            <option value="low">Low Stock</option>
            <option value="out">Out of Stock</option>
            <option value="good">In Stock</option>
          </select>
        </div>

        <div class="inventory-table-wrap">
          <div class="table-wrap">
            <table class="inventory-table">
              <thead>
                <tr>
                  <th><input type="checkbox" class="checkbox" id="select-all" onchange="App.toggleSelectAll(this)"></th>
                  <th></th>
                  <th>Part Name & Category</th>
                  <th>SKU / P.N</th>
                  <th style="text-align:center">Shop Qty</th>
                  <th style="text-align:center">Ground Qty</th>
                  <th style="text-align:center">Total Stock</th>
                  <th>Unit Price</th>
                  <th>Buying Price</th>
                  <th>Supplier</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="inv-table-body">
                ${renderInventoryRows(state.parts)}
              </tbody>
            </table>
          </div>
          <div class="inventory-footer">
            <div class="inventory-count" id="inv-count">Showing ${state.parts.length} parts</div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-secondary btn-sm" id="bulk-restock-btn" onclick="App.bulkRestockSelected()" style="display:none">Restock Selected</button>
              <button class="btn btn-danger btn-sm" id="bulk-delete-btn" onclick="App.bulkDeleteSelected()" style="display:none">Delete Selected</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderInventoryRows(parts) {
    if (!parts || parts.length === 0) {
      return `<tr><td colspan="11"><div class="empty-state">No parts found. <button class="btn btn-primary btn-sm mt-3" onclick="App.showAddPartModal()">Add first part</button></div></td></tr>`;
    }
    return parts.map(part => {
      const status = stockStatus(part);
      const imgEl = part.image_url
        ? `<img class="part-thumb" src="${part.image_url}" alt="${part.name}">`
        : `<div class="part-thumb-placeholder">${icons.image}</div>`;

      return `
        <tr>
          <td><input type="checkbox" class="checkbox row-check" data-id="${part.id}" onchange="App.updateBulkButtons()"></td>
          <td>${imgEl}</td>
          <td>
            <div class="part-info">
              <div class="part-name">${sanitize(part.name)}</div>
              <span class="part-cat-badge">${part.category || 'General'}</span>
            </div>
          </td>
          <td class="mono">${sanitize(part.sku || '—')}</td>
          <td style="text-align:center">
            <span class="stock-text ${part.shop_qty <= 0 ? 'out' : part.shop_qty <= (part.min_stock_threshold || 5) ? 'low' : 'good'}">${part.shop_qty}</span>
          </td>
          <td style="text-align:center">
            <span class="stock-text ${part.ground_qty <= 0 ? 'out' : 'good'}">${part.ground_qty}</span>
          </td>
          <td style="text-align:center">
            <div class="stock-qty-cell" style="justify-content:center">
              ${stockDot(part)}
              <span class="stock-text ${status}">${part.stock_qty}</span>
            </div>
          </td>
          <td>${ksh(part.selling_price)}</td>
          <td>${ksh(part.buying_price)}</td>
          <td style="font-size:12px; color:var(--text-secondary)">${part.suppliers?.name || '—'}</td>
          <td>
            <div class="action-btns">
              <button class="icon-btn" onclick="App.showEditPartModal('${part.id}')" title="Edit">${icons.edit}</button>
              <button class="icon-btn" onclick="App.quickRestock('${part.id}')" title="Restock" style="color:var(--success)">+</button>
              <button class="icon-btn danger" onclick="App.deletePart('${part.id}')" title="Delete">${icons.trash}</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function filterInventory() {
    const q = document.getElementById('inv-search')?.value.toLowerCase() || '';
    const cat = document.getElementById('inv-cat-filter')?.value || '';
    const suppId = document.getElementById('inv-supplier-filter')?.value || '';
    const stockF = document.getElementById('inv-stock-filter')?.value || '';

    let parts = state.parts;
    if (q) parts = parts.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q));
    if (cat) parts = parts.filter(p => p.category === cat);
    if (suppId) parts = parts.filter(p => p.supplier_id === suppId);
    if (stockF) parts = parts.filter(p => stockStatus(p) === stockF);

    document.getElementById('inv-table-body').innerHTML = renderInventoryRows(parts);
    document.getElementById('inv-count').textContent = `Showing ${parts.length} of ${state.parts.length} parts`;
  }

  function showAddPartModal(editPart = null) {
    const isEdit = !!editPart;
    const p = editPart || {};
    const title = isEdit ? 'Edit Part' : 'Add New Part';

    const modal = createModal(title, `
      <div class="part-form-grid">
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Part Name *</label>
          <input type="text" id="pf-name" class="form-input" value="${p.name || ''}" placeholder="e.g. Spark Plug NGK CR9EIX" required>
        </div>
        <div class="form-group">
          <label class="form-label">SKU / Part Number</label>
          <input type="text" id="pf-sku" class="form-input" value="${p.sku || ''}" placeholder="e.g. ENG-NGK-987X" style="font-family:var(--font-mono)">
        </div>
        <div class="form-group">
          <label class="form-label">Category</label>
          <input type="text" id="pf-category" class="form-input" value="${p.category || ''}" placeholder="e.g. Engine, Brakes" list="cat-list">
          <datalist id="cat-list">
            ${state.categories.map(c => `<option value="${c}">`).join('')}
          </datalist>
        </div>
        <div class="form-group">
          <label class="form-label">Selling Price (KSh) *</label>
          <input type="number" id="pf-sell" class="form-input" value="${p.selling_price || ''}" placeholder="0.00" min="0" step="0.01" oninput="App.updateMarginPreview()">
        </div>
        <div class="form-group">
          <label class="form-label">Buying Price (KSh)</label>
          <input type="number" id="pf-buy" class="form-input" value="${p.buying_price || ''}" placeholder="0.00" min="0" step="0.01" oninput="App.updateMarginPreview()">
        </div>
        <div class="form-group">
          <label class="form-label">Stock Quantity *</label>
          <input type="number" id="pf-qty" class="form-input" value="${p.stock_qty || 0}" min="0">
        </div>
        <div class="form-group">
          <label class="form-label">Low Stock Alert (Min Qty)</label>
          <input type="number" id="pf-min" class="form-input" value="${p.min_stock_threshold || 5}" min="0">
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Supplier</label>
          <select id="pf-supplier" class="form-select">
            <option value="">No supplier</option>
            ${state.suppliers.map(s => `<option value="${s.id}" ${p.supplier_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <div id="margin-preview" class="margin-preview" style="display:none">
            <span>Margin</span><span class="margin-value" id="margin-val">—</span>
          </div>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Part Image</label>
          <div class="img-upload-box" id="img-upload-box" onclick="document.getElementById('pf-image').click()">
            ${p.image_url
              ? `<div class="img-preview-wrap"><img src="${p.image_url}" id="img-preview"><button class="img-remove" onclick="event.stopPropagation(); App.clearPartImage()" type="button">×</button></div>`
              : `${icons.image}<div style="margin-top:8px">Click to upload part image</div><div class="text-xs text-muted mt-2">JPG, PNG, WEBP — max 5MB</div>`
            }
          </div>
          <input type="file" id="pf-image" accept="image/*" style="display:none" onchange="App.previewPartImage(this)">
        </div>
      </div>
    `, [
      { text: 'Cancel', class: 'btn-secondary', action: () => closeModal() },
      { text: isEdit ? 'Save Changes' : 'Add Part', class: 'btn-primary', action: () => savePartForm(isEdit ? p.id : null) }
    ]);

    document.body.appendChild(modal);
    updateMarginPreview();
  }

  async function showEditPartModal(partId) {
    const { data: part } = await DB.Parts.getById(partId);
    if (part) showAddPartModal(part);
  }

  function previewPartImage(input) {
    if (!input.files[0]) return;
    const reader = new FileReader();
    reader.onload = e => {
      const box = document.getElementById('img-upload-box');
      box.innerHTML = `<div class="img-preview-wrap"><img src="${e.target.result}" id="img-preview"><button class="img-remove" onclick="event.stopPropagation(); App.clearPartImage()" type="button">×</button></div>`;
      box.classList.add('has-image');
    };
    reader.readAsDataURL(input.files[0]);
  }

  function clearPartImage() {
    const box = document.getElementById('img-upload-box');
    box.innerHTML = `${icons.image}<div style="margin-top:8px">Click to upload part image</div><div class="text-xs text-muted mt-2">JPG, PNG, WEBP — max 5MB</div>`;
    box.classList.remove('has-image');
    document.getElementById('pf-image').value = '';
  }

  function updateMarginPreview() {
    const sell = parseFloat(document.getElementById('pf-sell')?.value) || 0;
    const buy = parseFloat(document.getElementById('pf-buy')?.value) || 0;
    const preview = document.getElementById('margin-preview');
    const val = document.getElementById('margin-val');
    if (!preview || !val) return;
    if (sell > 0 && buy > 0) {
      const margin = ((sell - buy) / sell * 100).toFixed(1);
      const profit = sell - buy;
      val.textContent = `${margin}% (${ksh(profit)} per unit)`;
      preview.style.display = 'flex';
    } else {
      preview.style.display = 'none';
    }
  }

  async function savePartForm(editId) {
    const name = document.getElementById('pf-name').value.trim();
    if (!name) { showToast('Part name is required', 'error'); return; }

    const existingPart = editId ? state.parts.find(p => p.id === editId) : null;
    const newQty = parseInt(document.getElementById('pf-qty').value) || 0;

    const partData = {
      name,
      sku: document.getElementById('pf-sku').value.trim() || null,
      category: document.getElementById('pf-category').value.trim() || 'General',
      selling_price: parseFloat(document.getElementById('pf-sell').value) || 0,
      buying_price: parseFloat(document.getElementById('pf-buy').value) || 0,
      min_stock_threshold: parseInt(document.getElementById('pf-min').value) || 5,
      supplier_id: document.getElementById('pf-supplier').value || null,
    };

    if (existingPart) {
      const ground = existingPart.ground_qty || 0;
      const shop = Math.max(0, newQty - ground);
      partData.shop_qty = shop;
      partData.ground_qty = ground;
    } else {
      partData.shop_qty = newQty;
      partData.ground_qty = 0;
    }

    // Handle image upload
    const imgFile = document.getElementById('pf-image')?.files[0];
    const saveBtn = document.querySelector('#part-modal .btn-primary');
    if (saveBtn) { saveBtn.textContent = 'Saving...'; saveBtn.disabled = true; }

    let imageUrl = editId ? (state.parts.find(p => p.id === editId)?.image_url || null) : null;

    if (imgFile) {
      const tempId = editId || 'new-' + Date.now();
      const { url, error: imgErr } = await DB.PartImages.upload(imgFile, tempId);
      if (!imgErr && url) imageUrl = url;
    }

    partData.image_url = imageUrl;

    let result;
    if (editId) {
      result = await DB.Parts.update(editId, partData);
    } else {
      result = await DB.Parts.create(partData);
    }

    if (result.error) {
      showToast('Error saving part: ' + result.error.message, 'error');
      if (saveBtn) { saveBtn.textContent = 'Save'; saveBtn.disabled = false; }
      return;
    }

    showToast(editId ? 'Part updated!' : 'Part added!', 'success');
    closeModal();
    await loadBaseData();
    renderInventory(document.getElementById('main-content'));
  }

  function showTransferStockModal() {
    const modal = createModal('Transfer Stock (Shop ↔ Ground)', `
      <div class="form-group" style="margin-bottom: 12px;">
        <label class="form-label">Select Part *</label>
        <select id="transfer-part-id" class="form-select">
          <option value="">-- Choose Part --</option>
          ${state.parts.map(p => `<option value="${p.id}">${p.name} [SKU: ${p.sku || '—'}]</option>`).join('')}
        </select>
      </div>
      
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
        <div class="form-group">
          <label class="form-label">From Pool *</label>
          <select id="transfer-from" class="form-select">
            <option value="shop">Shop Stock</option>
            <option value="ground">Ground Stock</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">To Pool *</label>
          <select id="transfer-to" class="form-select" disabled>
            <option value="ground">Ground Stock</option>
            <option value="shop">Shop Stock</option>
          </select>
        </div>
      </div>
      
      <div id="transfer-limits-preview" style="font-size:12px; color:var(--text-muted); margin-bottom:12px; background:var(--bg-secondary); padding:8px; border-radius:4px; display:none">
        <span>Available Shop: <strong id="t-limit-shop">0</strong> units</span> | 
        <span>Available Ground: <strong id="t-limit-ground">0</strong> units</span>
      </div>
      
      <div class="form-group" style="margin-bottom: 16px;">
        <label class="form-label">Transfer Quantity *</label>
        <input type="number" id="transfer-qty" class="form-input" min="1" placeholder="Enter quantity to transfer">
      </div>
    `, [
      { text: 'Cancel', class: 'btn-secondary', action: () => closeModal() },
      { text: 'Transfer', class: 'btn-primary', action: () => performStockTransfer() }
    ]);
    
    document.body.appendChild(modal);
    
    // Bind change listener programmatically
    document.getElementById('transfer-part-id')?.addEventListener('change', updateTransferModalLimits);
    document.getElementById('transfer-from')?.addEventListener('change', toggleTransferDestination);
    
    updateTransferModalLimits();
  }

  function toggleTransferDestination() {
    const fromVal = document.getElementById('transfer-from').value;
    const toSelect = document.getElementById('transfer-to');
    if (fromVal === 'shop') {
      toSelect.value = 'ground';
    } else {
      toSelect.value = 'shop';
    }
  }

  function updateTransferModalLimits() {
    const partId = document.getElementById('transfer-part-id')?.value;
    const preview = document.getElementById('transfer-limits-preview');
    if (!partId) {
      if (preview) preview.style.display = 'none';
      return;
    }
    
    const part = state.parts.find(p => p.id === partId);
    if (!part) return;
    
    document.getElementById('t-limit-shop').textContent = part.shop_qty || 0;
    document.getElementById('t-limit-ground').textContent = part.ground_qty || 0;
    preview.style.display = 'block';
  }

  async function performStockTransfer() {
    const partId = document.getElementById('transfer-part-id').value;
    if (!partId) { showToast('Please select a part', 'error'); return; }
    
    const part = state.parts.find(p => p.id === partId);
    if (!part) return;
    
    const fromPool = document.getElementById('transfer-from').value;
    const qtyInput = document.getElementById('transfer-qty').value;
    const qty = parseInt(qtyInput);
    
    if (isNaN(qty) || qty <= 0) { showToast('Invalid quantity', 'error'); return; }
    
    const available = fromPool === 'shop' ? (part.shop_qty || 0) : (part.ground_qty || 0);
    if (qty > available) {
      showToast(`Insufficient quantity. Only ${available} units available in ${fromPool}.`, 'error');
      return;
    }
    
    let newShopQty = part.shop_qty || 0;
    let newGroundQty = part.ground_qty || 0;
    
    if (fromPool === 'shop') {
      newShopQty -= qty;
      newGroundQty += qty;
    } else {
      newShopQty += qty;
      newGroundQty -= qty;
    }
    
    const saveBtn = document.querySelector('#part-modal .btn-primary');
    if (saveBtn) { saveBtn.textContent = 'Transferring...'; saveBtn.disabled = true; }
    
    const { error } = await DB.Parts.updateStockPools(partId, newShopQty, newGroundQty);
    if (error) {
      showToast('Error transferring stock: ' + error.message, 'error');
      if (saveBtn) { saveBtn.textContent = 'Transfer'; saveBtn.disabled = false; }
      return;
    }
    
    showToast(`Transferred ${qty} units of ${part.name} successfully`, 'success');
    closeModal();
    await loadBaseData();
    filterInventory();
  }

  async function quickRestock(partId) {
    const part = state.parts.find(p => p.id === partId);
    if (!part) return;
    const qty = prompt(`Restock "${part.name}"\nCurrent stock: ${part.stock_qty}\n\nEnter quantity to add:`);
    if (qty === null || isNaN(parseInt(qty))) return;
    const { error } = await DB.Parts.updateStock(partId, part.stock_qty + parseInt(qty));
    if (error) { showToast('Error restocking', 'error'); return; }
    showToast(`Restocked +${qty} units`, 'success');
    await loadBaseData();
    filterInventory();
  }

  async function deletePart(partId) {
    const part = state.parts.find(p => p.id === partId);
    if (!part || !confirm(`Delete "${part.name}"? This cannot be undone.`)) return;
    const { error } = await DB.Parts.delete(partId);
    if (error) { showToast('Error deleting part', 'error'); return; }
    showToast('Part deleted', 'success');
    await loadBaseData();
    filterInventory();
  }

  function toggleSelectAll(checkbox) {
    document.querySelectorAll('.row-check').forEach(cb => { cb.checked = checkbox.checked; });
    updateBulkButtons();
  }

  function updateBulkButtons() {
    const anyChecked = document.querySelectorAll('.row-check:checked').length > 0;
    document.getElementById('bulk-restock-btn')?.style.setProperty('display', anyChecked ? 'inline-flex' : 'none');
    document.getElementById('bulk-delete-btn')?.style.setProperty('display', anyChecked ? 'inline-flex' : 'none');
  }

  function exportInventoryCSV() {
    const headers = ['Name', 'SKU', 'Category', 'Stock Qty', 'Selling Price', 'Buying Price', 'Supplier'];
    const rows = state.parts.map(p => [
      p.name, p.sku || '', p.category || '', p.stock_qty,
      p.selling_price, p.buying_price || 0, p.suppliers?.name || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `sahaja-inventory-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Inventory exported as CSV', 'success');
  }

  // ============================================================
  // CREDITS
  // ============================================================

  function renderCredits(container) {
    const total = state.credits.filter(c => c.status === 'pending').reduce((s, c) => s + (c.amount_owed || 0), 0);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <div class="page-title">Credit Log (Deni)</div>
            <div class="page-subtitle">Total outstanding: <strong style="color:var(--warning)">${ksh(total)}</strong></div>
          </div>
          <div class="header-meta">${state.credits.filter(c => c.status === 'pending').length} active credit accounts</div>
        </div>
      </div>
      <div class="page-body">
        <div class="credit-toolbar">
          <div class="search-wrap" style="flex:1; max-width:300px">
            ${icons.search}
            <input type="text" id="credit-search" class="search-input" placeholder="Search by name or phone..." oninput="App.filterCredits()">
          </div>
          <div class="filter-pills">
            <span class="pill active" onclick="App.filterCreditStatus('all', this)">All</span>
            <span class="pill" onclick="App.filterCreditStatus('pending', this)">Pending</span>
            <span class="pill" onclick="App.filterCreditStatus('paid', this)">Cleared</span>
          </div>
        </div>

        <div class="credit-table-wrap">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Sale Date</th>
                  <th>Original Amount</th>
                  <th>Balance Due</th>
                  <th>Last Payment</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="credits-table-body">
                ${renderCreditRows(state.credits)}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function renderCreditRows(credits) {
    if (!credits || credits.length === 0) {
      return `<tr><td colspan="7"><div class="empty-state">No credit records found.</div></td></tr>`;
    }

    return credits.map(c => {
      const isOverdue = c.status === 'pending' && c.last_payment_date &&
        (new Date() - new Date(c.last_payment_date)) > 30 * 24 * 60 * 60 * 1000;
      const overdueBadge = isOverdue ? `<span class="overdue-flag">Overdue</span>` : '';

      return `
        <tr>
          <td>
            <div class="customer-cell">
              <div class="customer-name">${sanitize(c.customer_name)}${overdueBadge}</div>
              <div class="customer-phone">${sanitize(c.customer_phone || '—')}</div>
            </div>
          </td>
          <td style="font-size:12px; color:var(--text-muted)">${new Date(c.created_at).toLocaleDateString('en-KE')}</td>
          <td>${ksh(c.original_amount || c.amount_owed)}</td>
          <td><span class="balance-cell ${c.amount_owed > 0 ? 'balance-positive' : 'balance-zero'}">${ksh(c.amount_owed)}</span></td>
          <td style="font-size:12px; color:var(--text-muted)">${c.last_payment_date ? new Date(c.last_payment_date).toLocaleDateString('en-KE') : '—'}</td>
          <td><span class="badge ${c.status === 'paid' || c.status === 'cleared' ? 'badge-cash' : 'badge-credit'}">${c.status === 'paid' || c.status === 'cleared' ? 'Cleared' : c.status}</span></td>
          <td>
            <div class="action-btns">
              ${c.status !== 'cleared' ? `<button class="btn btn-sm btn-primary" onclick="App.showPaymentModal('${c.id}')">Pay</button>` : ''}
              <button class="icon-btn" onclick="App.toggleCreditHistory('${c.id}')">${icons.chevronDown}</button>
            </div>
          </td>
        </tr>
        <tr id="history-${c.id}" style="display:none">
          <td colspan="7" class="credit-history-row">
            <div class="credit-history-inner">
              <div class="credit-history-title">Payment History</div>
              <div class="payment-history-list">
                ${(c.payment_history || []).length === 0
                  ? '<div class="text-muted text-sm">No payments recorded yet</div>'
                  : (c.payment_history || []).map(ph => `
                    <div class="payment-history-item">
                      <span class="payment-history-date">${new Date(ph.date).toLocaleDateString('en-KE')}</span>
                      <span class="payment-history-amount">+${ksh(ph.amount)}</span>
                      <span class="text-muted text-sm">Balance: ${ksh(ph.balance_after)}</span>
                    </div>
                  `).join('')
                }
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function toggleCreditHistory(id) {
    const row = document.getElementById(`history-${id}`);
    if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
  }

  function filterCredits() {
    const q = document.getElementById('credit-search')?.value.toLowerCase() || '';
    let credits = state.credits;
    if (q) credits = credits.filter(c => c.customer_name.toLowerCase().includes(q) || (c.customer_phone || '').includes(q));
    document.getElementById('credits-table-body').innerHTML = renderCreditRows(credits);
  }

  function filterCreditStatus(status, el) {
    document.querySelectorAll('.filter-pills .pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    let credits = state.credits;
    if (status !== 'all') credits = credits.filter(c => c.status === status);
    document.getElementById('credits-table-body').innerHTML = renderCreditRows(credits);
  }

  function showPaymentModal(creditId) {
    const credit = state.credits.find(c => c.id === creditId);
    if (!credit) return;

    const quickAmounts = [500, 1000, 2000, 5000, credit.amount_owed].filter(a => a > 0 && a <= credit.amount_owed);

    const modal = createModal(`Record Payment — ${credit.customer_name}`, `
      <div class="pay-form">
        <div>
          <div class="text-sm text-muted">Outstanding Balance</div>
          <div style="font-size:22px; font-weight:800; color:var(--warning)">${ksh(credit.amount_owed)}</div>
        </div>
        <div class="form-group">
          <label class="form-label">Payment Amount (KSh)</label>
          <input type="number" id="pay-amount" class="form-input" placeholder="0.00" min="0.01" max="${credit.amount_owed}" step="0.01">
        </div>
        <div>
          <div class="text-xs text-muted mb-2">Quick amounts:</div>
          <div class="quick-amounts">
            ${quickAmounts.map(a => `<button class="quick-amt-btn" onclick="document.getElementById('pay-amount').value=${a}">${ksh(a)}</button>`).join('')}
            <button class="quick-amt-btn" style="border-color:var(--success); color:var(--success)" onclick="document.getElementById('pay-amount').value=${credit.amount_owed}">Full amount</button>
          </div>
        </div>
      </div>
    `, [
      { text: 'Cancel', class: 'btn-secondary', action: () => closeModal() },
      { text: 'Record Payment', class: 'btn-primary', action: () => recordPayment(creditId) }
    ]);

    document.body.appendChild(modal);
  }

  async function recordPayment(creditId) {
    const amount = parseFloat(document.getElementById('pay-amount')?.value);
    if (!amount || amount <= 0) { showToast('Enter a valid amount', 'error'); return; }

    const { error } = await DB.Credits.recordPayment(creditId, amount);
    if (error) { showToast('Error recording payment', 'error'); return; }

    showToast(`Payment of ${ksh(amount)} recorded!`, 'success');
    closeModal();
    const { data } = await DB.Credits.getAll();
    state.credits = data || [];
    renderCredits(document.getElementById('main-content'));
  }

  // ============================================================
  // REPORTS
  // ============================================================

  async function renderReports(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <div class="page-title">Reports</div>
            <div class="page-subtitle">Sales analytics and business insights.</div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" onclick="App.exportSalesCSV()">${icons.download} Export Sales</button>
          </div>
        </div>
      </div>
      <div class="page-body">
        <div class="reports-toolbar">
          <div class="period-pills">
            <span class="period-pill active" onclick="App.loadReportPeriod('today', this)">Today</span>
            <span class="period-pill" onclick="App.loadReportPeriod('week', this)">7 Days</span>
            <span class="period-pill" onclick="App.loadReportPeriod('month', this)">30 Days</span>
          </div>
          <div class="date-range-group">
            <span>Custom:</span>
            <input type="date" id="rep-from" class="form-input" style="width:140px">
            <span>to</span>
            <input type="date" id="rep-to" class="form-input" style="width:140px">
            <button class="btn btn-secondary btn-sm" onclick="App.loadCustomDateRange()">Apply</button>
          </div>
        </div>

        <div id="report-content">
          <div class="loading-overlay"><div class="spinner"></div> Loading report...</div>
        </div>
      </div>
    `;

    // Set defaults
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('rep-from').value = today;
    document.getElementById('rep-to').value = today;

    await loadReportPeriod('today', document.querySelector('.period-pill.active'));
  }

  async function loadReportPeriod(period, el) {
    document.querySelectorAll('.period-pill').forEach(p => p.classList.remove('active'));
    if (el) el.classList.add('active');

    const today = new Date();
    let from, to = today.toISOString().split('T')[0];

    if (period === 'today') {
      from = to;
    } else if (period === 'week') {
      const d = new Date(today);
      d.setDate(d.getDate() - 7);
      from = d.toISOString().split('T')[0];
    } else {
      const d = new Date(today);
      d.setDate(d.getDate() - 30);
      from = d.toISOString().split('T')[0];
    }

    await renderReportContent(from, to);
  }

  async function loadCustomDateRange() {
    const from = document.getElementById('rep-from')?.value;
    const to = document.getElementById('rep-to')?.value;
    if (!from || !to) return;
    await renderReportContent(from, to);
  }

  async function renderReportContent(from, to) {
    const { data: sales } = await DB.Sales.getByDateRange(from, to);
    const s = sales || [];

    const totalRev = s.reduce((sum, sale) => sum + (sale.total_amount || 0), 0);
    const cashRev = s.filter(x => x.payment_method === 'cash').reduce((sum, x) => sum + (x.total_amount || 0), 0);
    const mpesaRev = s.filter(x => x.payment_method === 'mpesa').reduce((sum, x) => sum + (x.total_amount || 0), 0);
    const creditRev = s.filter(x => x.payment_method === 'credit').reduce((sum, x) => sum + (x.total_amount || 0), 0);
    const avgSale = s.length > 0 ? totalRev / s.length : 0;

    // Top parts
    const partMap = {};
    s.forEach(sale => {
      (sale.sale_items || []).forEach(item => {
        if (!partMap[item.part_name]) partMap[item.part_name] = { qty: 0, revenue: 0 };
        partMap[item.part_name].qty += item.quantity;
        partMap[item.part_name].revenue += item.line_total;
      });
    });
    const topParts = Object.entries(partMap).sort((a,b) => b[1].qty - a[1].qty).slice(0, 10);

    const topPartsHTML = topParts.map(([name, data], i) => `
      <div class="top-part-item">
        <div class="top-part-rank">${i+1}</div>
        <div class="top-part-info">
          <div class="top-part-name">${sanitize(name)}</div>
          <div class="top-part-units">${data.qty} units sold</div>
        </div>
        <div class="top-part-revenue">${ksh(data.revenue)}</div>
      </div>
    `).join('') || '<div class="text-muted text-sm">No sales in this period</div>';

    const salesTableRows = s.slice(0, 50).map(sale => {
      const payBadge = sale.payment_method === 'credit' ? 'badge-credit' : sale.payment_method === 'mpesa' ? 'badge-mpesa' : 'badge-cash';
      return `
        <tr style="cursor:pointer" onclick="App.viewTransactionDetails('${sale.id}')" title="Click to view details (Requires PIN)">
          <td class="mono">${sanitize(sale.receipt_number || '—')}</td>
          <td style="font-size:12px">${new Date(sale.created_at).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td style="font-size:12px">${(sale.sale_items || []).length} item${(sale.sale_items || []).length !== 1 ? 's' : ''}</td>
          <td><span class="badge ${payBadge}">${sale.payment_method || 'cash'}</span></td>
          <td style="font-weight:700">${ksh(sale.total_amount)}</td>
          ${sale.mpesa_txn_code ? `<td class="mono">${sanitize(sale.mpesa_txn_code)}</td>` : '<td>—</td>'}
        </tr>
      `;
    }).join('');

    document.getElementById('report-content').innerHTML = `
      <div class="stat-grid" style="margin-bottom:16px">
        <div class="stat-tile">
          <div class="stat-label">Total Revenue</div>
          <div class="stat-value">${ksh(totalRev)}</div>
          <div class="stat-change">${s.length} transactions</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Cash</div>
          <div class="stat-value success">${ksh(cashRev)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">MPESA</div>
          <div class="stat-value" style="color:var(--info)">${ksh(mpesaRev)}</div>
        </div>
        <div class="stat-tile">
          <div class="stat-label">Credit</div>
          <div class="stat-value warning">${ksh(creditRev)}</div>
        </div>
      </div>

      <div class="reports-grid">
        <div class="card">
          <div class="card-header"><div class="card-title">Top Selling Parts</div></div>
          <div class="top-parts-list">${topPartsHTML}</div>
        </div>
        <div class="card">
          <div class="card-header"><div class="card-title">Summary</div></div>
          <div style="display:flex; flex-direction:column; gap:10px">
            <div class="summary-row" style="justify-content:space-between; font-size:13px">
              <span class="text-secondary">Transactions</span><strong>${s.length}</strong>
            </div>
            <div class="summary-row" style="justify-content:space-between; font-size:13px">
              <span class="text-secondary">Average Sale</span><strong>${ksh(avgSale)}</strong>
            </div>
            <div class="summary-row" style="justify-content:space-between; font-size:13px">
              <span class="text-secondary">From</span><strong>${from}</strong>
            </div>
            <div class="summary-row" style="justify-content:space-between; font-size:13px">
              <span class="text-secondary">To</span><strong>${to}</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="card mt-4">
        <div class="card-header"><div class="card-title">All Transactions</div><span class="text-xs text-muted">${s.length > 50 ? 'Showing first 50' : ''}</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Receipt No.</th><th>Date & Time</th><th>Items</th><th>Payment</th><th>Amount</th><th>MPESA Ref</th></tr></thead>
            <tbody>${salesTableRows || '<tr><td colspan="6"><div class="empty-state">No transactions in this period</div></td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  async function exportSalesCSV() {
    const from = document.getElementById('rep-from')?.value || new Date().toISOString().split('T')[0];
    const to = document.getElementById('rep-to')?.value || from;
    const { data: sales } = await DB.Sales.getByDateRange(from, to);
    if (!sales || sales.length === 0) { showToast('No sales in selected period', 'warning'); return; }

    const headers = ['Receipt No', 'Date', 'Items', 'Payment Method', 'Total', 'MPESA Ref', 'Customer'];
    const rows = sales.map(s => [
      s.receipt_number || '',
      new Date(s.created_at).toLocaleDateString('en-KE'),
      (s.sale_items || []).length,
      s.payment_method,
      s.total_amount,
      s.mpesa_txn_code || '',
      s.customer_name || ''
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `sahaja-sales-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Sales exported', 'success');
  }

  // ============================================================
  // CUSTOMERS & DATABASE
  // ============================================================

  async function loadCustomerDatabase() {
    const { data: sales } = await DB.Sales.getRecent(2000);
    const { data: credits } = await DB.Credits.getAll();

    const s = sales || [];
    const c = credits || [];

    const customersMap = {};

    s.forEach(sale => {
      if (!sale.customer_name) return;
      const name = sale.customer_name.trim();
      const phone = (sale.customer_phone || '').trim();
      const key = `${name.toLowerCase()}___${phone}`;

      if (!customersMap[key]) {
        customersMap[key] = {
          name: name,
          phone: phone,
          location: sale.customer_location || '',
          totalSpent: 0,
          totalOwed: 0,
          salesCount: 0,
          transactions: []
        };
      }
      customersMap[key].totalSpent += (sale.total_amount || 0);
      customersMap[key].salesCount++;
      customersMap[key].transactions.push({
        id: sale.id,
        date: sale.created_at,
        receipt_number: sale.receipt_number,
        amount: sale.total_amount,
        type: 'sale',
        payment_method: sale.payment_method
      });
      if (sale.customer_location && !customersMap[key].location) {
        customersMap[key].location = sale.customer_location;
      }
    });

    c.forEach(credit => {
      if (!credit.customer_name) return;
      const name = credit.customer_name.trim();
      const phone = (credit.customer_phone || '').trim();
      const key = `${name.toLowerCase()}___${phone}`;

      if (!customersMap[key]) {
        customersMap[key] = {
          name: name,
          phone: phone,
          location: '',
          totalSpent: 0,
          totalOwed: 0,
          salesCount: 0,
          transactions: []
        };
      }
      customersMap[key].totalOwed += (credit.total_owed || 0) - (credit.paid || 0);
      customersMap[key].transactions.push({
        id: credit.id,
        sale_id: credit.sale_id,
        date: credit.credit_date || credit.created_at,
        receipt_number: credit.receipt_number || 'Credit Note',
        amount: credit.total_owed,
        type: 'credit',
        status: credit.status
      });
    });

    state.customerDatabase = Object.values(customersMap).sort((a, b) => b.totalSpent - a.totalSpent);
  }

  async function renderCustomers(container) {
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <div class="page-title">Customer Ledger & Database</div>
            <div class="page-subtitle">Track customer purchase history and credit status.</div>
          </div>
        </div>
      </div>
      <div class="page-body">
        <div class="loading-state" id="customer-loading">Loading customers...</div>
      </div>
    `;

    try {
      await loadCustomerDatabase();
      container.querySelector('.page-body').innerHTML = renderCustomerLayout();
      
      // Select the first customer if any
      if (state.customerDatabase.length > 0) {
        const first = state.customerDatabase[0];
        const key = `${first.name.toLowerCase()}___${first.phone}`;
        selectCustomerDetail(key);
      } else {
        document.getElementById('customer-detail-content').innerHTML = `
          <div class="empty-state">No customers recorded yet.</div>
        `;
      }
    } catch (err) {
      container.querySelector('.page-body').innerHTML = `
        <div class="empty-state error">Error loading customers: ${err.message}</div>
      `;
    }
  }

  function renderCustomerLayout() {
    return `
      <div class="customer-list-layout">
        <div class="customer-sidebar-panel">
          <div class="customer-search-wrap">
            <div class="search-wrap">
              ${icons.search}
              <input type="text" id="cust-search" class="search-input" placeholder="Search customer..." oninput="App.filterCustomers(this.value)">
            </div>
          </div>
          <div class="customer-list-scroll" id="customer-list-scroll">
            ${renderCustomerListRows(state.customerDatabase)}
          </div>
        </div>
        
        <div class="customer-detail-panel" id="customer-detail-content">
          <!-- Load dynamically -->
        </div>
      </div>
    `;
  }

  function renderCustomerListRows(customers) {
    if (customers.length === 0) {
      return `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">No matches found</div>`;
    }
    return customers.map(c => {
      const key = `${c.name.toLowerCase()}___${c.phone}`;
      const isActive = state.selectedCustomerKey === key ? 'active' : '';
      return `
        <div class="customer-list-item ${isActive}" onclick="App.selectCustomerDetail('${key}')" id="cust-item-${key}">
          <div class="customer-list-name">${sanitize(c.name)}</div>
          <div class="customer-list-meta">
            <div>📞 ${sanitize(c.phone || 'No phone')}</div>
            ${c.location ? `<div>📍 ${sanitize(c.location)}</div>` : ''}
            <div style="margin-top: 4px; display:flex; gap:6px; font-weight:600">
              <span style="color:var(--success)">Spent: ${ksh(c.totalSpent)}</span>
              ${c.totalOwed > 0 ? `<span style="color:var(--warning)">Deni: ${ksh(c.totalOwed)}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function filterCustomers(query) {
    const q = query.toLowerCase().trim();
    const filtered = state.customerDatabase.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.phone.toLowerCase().includes(q) || 
      (c.location || '').toLowerCase().includes(q)
    );
    const scrollEl = document.getElementById('customer-list-scroll');
    if (scrollEl) {
      scrollEl.innerHTML = renderCustomerListRows(filtered);
    }
  }

  function selectCustomerDetail(key) {
    state.selectedCustomerKey = key;
    
    // Highlight in list
    document.querySelectorAll('.customer-list-item').forEach(el => {
      el.classList.remove('active');
    });
    const activeItem = document.getElementById(`cust-item-${key}`);
    if (activeItem) activeItem.classList.add('active');

    const customer = state.customerDatabase.find(c => `${c.name.toLowerCase()}___${c.phone}` === key);
    const detailEl = document.getElementById('customer-detail-content');
    if (!detailEl || !customer) return;

    // Sort transactions by date descending
    const sortedTxns = [...customer.transactions].sort((a,b) => new Date(b.date) - new Date(a.date));

    const ledgerRows = sortedTxns.map(t => {
      const dateStr = new Date(t.date).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' });
      if (t.type === 'sale') {
        const badgeClass = t.payment_method === 'credit' ? 'badge-credit' : t.payment_method === 'mpesa' ? 'badge-mpesa' : 'badge-cash';
        return `
          <tr style="cursor:pointer" onclick="App.viewTransactionDetails('${t.id}')" title="Click to view receipt">
            <td>${dateStr}</td>
            <td>Sale: <span class="mono">${sanitize(t.receipt_number)}</span></td>
            <td><span class="badge ${badgeClass}">${t.payment_method}</span></td>
            <td style="font-weight:700" class="success">+${ksh(t.amount)}</td>
            <td>—</td>
          </tr>
        `;
      } else {
        const badgeClass = t.status === 'paid' ? 'badge-success' : 'badge-warning';
        return `
          <tr style="cursor:pointer" onclick="App.viewTransactionDetails('${t.sale_id}')" title="Click to view sale">
            <td>${dateStr}</td>
            <td>Credit: <span class="mono">${sanitize(t.receipt_number)}</span></td>
            <td><span class="badge ${badgeClass}">Credit (${t.status})</span></td>
            <td>—</td>
            <td style="font-weight:700" class="warning">${ksh(t.amount)}</td>
          </tr>
        `;
      }
    }).join('');

    detailEl.innerHTML = `
      <div class="customer-header-box">
        <h3 style="margin:0; font-size:18px; color:var(--text-primary)">${sanitize(customer.name)}</h3>
        <div style="display:flex; gap:16px; margin-top:8px; font-size:12px; color:var(--text-muted)">
          <span>📞 ${sanitize(customer.phone || 'No phone')}</span>
          ${customer.location ? `<span>📍 Location: ${sanitize(customer.location)}</span>` : ''}
        </div>
      </div>

      <div class="customer-summary-cards">
        <div class="customer-summary-card">
          <div class="customer-summary-label">Total Purchases</div>
          <div class="customer-summary-value success">${ksh(customer.totalSpent)}</div>
        </div>
        <div class="customer-summary-card">
          <div class="customer-summary-label">Outstanding Balance</div>
          <div class="customer-summary-value warning">${ksh(customer.totalOwed)}</div>
        </div>
        <div class="customer-summary-card">
          <div class="customer-summary-label">Total Visits</div>
          <div class="customer-summary-value" style="color:var(--info)">${customer.salesCount} sale${customer.salesCount !== 1 ? 's' : ''}</div>
        </div>
      </div>

      <div class="card mt-4" style="flex:1; display:flex; flex-direction:column; overflow:hidden">
        <div class="card-header"><div class="card-title">Transaction History & Ledger</div></div>
        <div class="table-wrap" style="flex:1; overflow-y:auto">
          <table>
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Description</th>
                <th>Type/Payment</th>
                <th>Paid Amount</th>
                <th>Owed Amount</th>
              </tr>
            </thead>
            <tbody>
              ${ledgerRows || '<tr><td colspan="5"><div class="empty-state">No transaction history</div></td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ============================================================
  // OWNER SECURITY & OPERATORS TABS
  // ============================================================

  function showOwnerPinVerificationModal(onSuccess) {
    const owners = state.operators.filter(o => o.role === 'owner');
    if (owners.length === 0) {
      showToast('No owner operator profiles found in system', 'error');
      return;
    }

    const modal = createModal('Owner Verification Required', `
      <div style="font-size:13px; color:var(--text-muted); text-align:center; margin-bottom:12px">
        Please enter an Owner/Admin password to authorize this action.
      </div>
      <div class="form-group">
        <input type="password" id="owner-password-input" class="form-input" placeholder="Enter Owner password" maxlength="32" style="text-align:center; font-size:16px; letter-spacing:2px; height:44px; margin-bottom:12px;">
      </div>
    `, [
      { text: 'Cancel', class: 'btn-secondary', action: () => closeModal() },
      { text: 'Verify', class: 'btn-primary', action: async () => {
          const input = document.getElementById('owner-password-input');
          const password = input?.value;
          if (!password) { showToast('Password is required', 'error'); return; }

          const btn = document.querySelector('#part-modal .btn-primary');
          if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }

          let verified = false;
          for (const owner of owners) {
            const { data } = await DB.Operators.verifyPassword(owner.id, password);
            if (data) {
              verified = true;
              break;
            }
          }

          if (verified) {
            closeModal();
            onSuccess();
          } else {
            showToast('Verification failed: Owner credentials required', 'error');
            if (input) { input.value = ''; input.focus(); }
            if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
          }
        }
      }
    ]);

    document.body.appendChild(modal);

    setTimeout(() => {
      const input = document.getElementById('owner-password-input');
      input?.focus();
      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          document.querySelector('#part-modal .btn-primary')?.click();
        }
      });
    }, 100);
  }

  async function renderSettingsOperators(container) {
    container.innerHTML = `
      <div class="settings-card">
        <div class="settings-card-title">Operator Profiles</div>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:16px;">
          Manage login profiles and passwords. Restricted to Owner access.
        </p>
        <div class="table-wrap" style="margin-bottom:20px">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="operators-list-tbody">
              <tr><td colspan="4">Loading operators...</td></tr>
            </tbody>
          </table>
        </div>

        <div style="border-top:1px solid var(--border); padding-top:16px">
          <h4 style="margin:0 0 12px; font-size:14px">Create New Operator</h4>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Operator Name *</label>
              <input type="text" id="op-new-name" class="form-input" placeholder="e.g. Victor">
            </div>
            <div class="form-group">
              <label class="form-label">Email *</label>
              <input type="email" id="op-new-email" class="form-input" placeholder="e.g. victor@sahaja.co.ke">
            </div>
            <div class="form-group">
              <label class="form-label">Password *</label>
              <input type="password" id="op-new-password" class="form-input" placeholder="Enter password (max 32)" maxlength="32">
            </div>
            <div class="form-group">
              <label class="form-label">Role *</label>
              <select id="op-new-role" class="form-select">
                <option value="employee">Employee</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>
          <button class="btn btn-primary mt-2" onclick="App.addOperator()">Add Operator</button>
        </div>
      </div>
    `;

    await loadSettingsOperatorsTable();
  }

  async function loadSettingsOperatorsTable() {
    const tbody = document.getElementById('operators-list-tbody');
    if (!tbody) return;

    const { data: ops } = await DB.Operators.getAll();
    state.operators = ops || [];

    tbody.innerHTML = state.operators.map(op => {
      const isProtected = op.role === 'owner' || op.id === state.operator?.id;
      return `
        <tr>
          <td style="font-weight:600">${sanitize(op.name)}</td>
          <td>${sanitize(op.email || '')}</td>
          <td><span class="badge ${op.role === 'owner' ? 'badge-credit' : 'badge-cash'}">${op.role}</span></td>
          <td>
            ${isProtected 
              ? `<span style="font-size:11px; color:var(--text-muted)">Protected</span>` 
              : `<button class="btn btn-secondary btn-sm" onclick="App.deleteOperator('${op.id}')" style="color:var(--accent)">Delete</button>`
            }
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4">No operators registered.</td></tr>';
  }

  async function addOperator() {
    const nameInput = document.getElementById('op-new-name');
    const emailInput = document.getElementById('op-new-email');
    const pwdInput = document.getElementById('op-new-password');
    const roleInput = document.getElementById('op-new-role');

    const name = nameInput?.value?.trim();
    const email = emailInput?.value?.trim();
    const password = pwdInput?.value;
    const role = roleInput?.value || 'employee';

    if (!name || !email || !password) { showToast('Please enter operator name, email and password', 'error'); return; }
    if (password.length < 4 || password.length > 32) { showToast('Password must be between 4 and 32 characters', 'error'); return; }

    showOwnerPinVerificationModal(async () => {
      const { error } = await DB.Operators.create({ name, email, password, role });
      if (error) {
        showToast('Error creating operator: ' + error.message, 'error');
      } else {
        showToast(`Operator ${name} added!`, 'success');
        if (nameInput) nameInput.value = '';
        if (emailInput) emailInput.value = '';
        if (pwdInput) pwdInput.value = '';
        await loadSettingsOperatorsTable();
      }
    });
  }

  async function deleteOperator(opId) {
    if (!confirm('Are you sure you want to delete this operator profile?')) return;
    
    showOwnerPinVerificationModal(async () => {
      const { error } = await DB.Operators.delete(opId);
      if (error) {
        showToast('Error deleting operator: ' + error.message, 'error');
      } else {
        showToast('Operator deleted successfully', 'success');
        await loadSettingsOperatorsTable();
      }
    });
  }

  // ============================================================
  // SOURCING LOGS
  // ============================================================

  async function renderSettingsSourcingLogs(container) {
    container.innerHTML = `
      <div class="settings-card">
        <div class="settings-card-title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>Out of Stock Sourcing Logs</span>
          <button class="btn btn-secondary btn-sm" onclick="App.exportSourcingCSV()">${icons.download} Export CSV</button>
        </div>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:16px;">
          Records of items purchased externally to fulfill orders that exceeded stock levels.
        </p>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Part Name</th>
                <th>Qty</th>
                <th>Sourcing Shop</th>
                <th>Cost Price</th>
                <th>Sahaja Price</th>
                <th>Profit Margin</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody id="sourcing-logs-tbody">
              <tr><td colspan="8">Loading sourcing logs...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    await loadSettingsSourcingLogsTable();
  }

  async function loadSettingsSourcingLogsTable() {
    const tbody = document.getElementById('sourcing-logs-tbody');
    if (!tbody) return;

    const { data: logs } = await DB.SourcingLogs.getAll();
    const l = logs || [];

    tbody.innerHTML = l.map(log => {
      const cost = log.cost_price || 0;
      const sell = log.selling_price || 0;
      const profit = sell - cost;
      const dateStr = new Date(log.created_at).toLocaleDateString('en-KE');

      return `
        <tr>
          <td>${dateStr}</td>
          <td style="font-weight:600">${sanitize(log.part_name)}</td>
          <td>${log.quantity}</td>
          <td>${sanitize(log.sourcing_shop)}</td>
          <td>${ksh(cost)}</td>
          <td>${ksh(sell)}</td>
          <td style="font-weight:600; color:${profit >= 0 ? 'var(--success)' : 'var(--accent)'}">
            ${ksh(profit)}
          </td>
          <td>
            <span class="badge ${log.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}">
              ${log.payment_status} (${log.payment_method})
            </span>
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="8">No external sourcing logs recorded.</td></tr>';
  }

  async function exportSourcingCSV() {
    const { data: logs } = await DB.SourcingLogs.getAll();
    const l = logs || [];
    if (l.length === 0) { showToast('No sourcing logs to export', 'warning'); return; }

    const headers = ['Date', 'Part Name', 'Quantity', 'Sourcing Shop', 'Cost Price', 'Selling Price', 'Profit', 'Status', 'Payment Method'];
    const rows = l.map(log => [
      new Date(log.created_at).toLocaleDateString('en-KE'),
      log.part_name,
      log.quantity,
      log.sourcing_shop,
      log.cost_price,
      log.selling_price,
      log.selling_price - log.cost_price,
      log.payment_status,
      log.payment_method
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `sahaja-sourcing-logs.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Sourcing logs exported', 'success');
  }

  // ============================================================
  // SETTINGS
  // ============================================================

  function renderSettings(container) {
    const s = state.settings;
    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-row">
          <div>
            <div class="page-title">Settings</div>
            <div class="page-subtitle">Configure the tool for your shop.</div>
          </div>
        </div>
      </div>
      <div class="page-body">
        <div class="settings-layout">
          <div class="settings-nav">
            <div class="settings-nav-item active" onclick="App.showSettingsSection('profile', this)">Shop Profile</div>
            <div class="settings-nav-item" onclick="App.showSettingsSection('theme', this)">Appearance</div>
            <div class="settings-nav-item" onclick="App.showSettingsSection('receipt', this)">Receipt</div>
            <div class="settings-nav-item" onclick="App.showSettingsSection('suppliers', this)">Suppliers</div>
            <div class="settings-nav-item" onclick="App.showSettingsSection('operators', this)">Operators</div>
            <div class="settings-nav-item" onclick="App.showSettingsSection('sourcing', this)">Sourcing Logs</div>
            <div class="settings-nav-item" onclick="App.showSettingsSection('backup', this)">Backup</div>
          </div>
          <div class="settings-section" id="settings-content">
            ${renderSettingsProfile()}
          </div>
        </div>
      </div>
    `;
  }

  function showSettingsSection(section, el) {
    document.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
    const content = document.getElementById('settings-content');
    switch(section) {
      case 'profile': content.innerHTML = renderSettingsProfile(); break;
      case 'theme': content.innerHTML = renderSettingsTheme(); break;
      case 'receipt': content.innerHTML = renderSettingsReceipt(); break;
      case 'suppliers': renderSettingsSuppliers(content); break;
      case 'operators': renderSettingsOperators(content); break;
      case 'sourcing': renderSettingsSourcingLogs(content); break;
      case 'backup': content.innerHTML = renderSettingsBackup(); break;
    }
  }

  function renderSettingsProfile() {
    const s = state.settings;
    return `
      <div class="settings-card">
        <div class="settings-card-title">Shop Profile</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Shop Name</label>
            <input type="text" id="s-name" class="form-input" value="${sanitize(s.shop_name || 'SAHAJA MOTORCYCLE LIMITED')}">
          </div>
          <div class="form-group">
            <label class="form-label">Phone Number</label>
            <input type="text" id="s-phone" class="form-input" value="${sanitize(s.phone || '')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" id="s-address" class="form-input" value="${sanitize(s.address || 'CBD, Nairobi')}">
        </div>
        <button class="btn btn-primary" onclick="App.saveShopProfile()">Save Profile</button>
      </div>
    `;
  }

  function renderSettingsTheme() {
    const themes = [
      { id: 'carbon-red', name: 'Carbon Red', sidebar: '#111', accent: '#e63946', main: '#161616' },
      { id: 'graphite-amber', name: 'Graphite Amber', sidebar: '#131312', accent: '#f59e0b', main: '#181816' },
      { id: 'midnight-teal', name: 'Midnight Teal', sidebar: '#0b1515', accent: '#14b8a6', main: '#0f1818' }
    ];

    return `
      <div class="settings-card">
        <div class="settings-card-title">Color Theme</div>
        <div class="theme-options">
          ${themes.map(t => `
            <div class="theme-option ${state.settings.theme === t.id ? 'active' : ''}" onclick="App.selectTheme('${t.id}', this)">
              <div class="theme-preview">
                <div class="theme-preview-sidebar" style="background:${t.sidebar}"></div>
                <div class="theme-preview-accent" style="background:${t.accent}"></div>
                <div class="theme-preview-main" style="background:${t.main}"></div>
              </div>
              <div class="theme-name">${t.name}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function renderSettingsReceipt() {
    const s = state.settings;
    return `
      <div class="settings-card">
        <div class="settings-card-title">Receipt Configuration</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Receipt Prefix</label>
            <input type="text" id="s-prefix" class="form-input" value="${sanitize(s.receipt_prefix || 'SAH')}" maxlength="6" style="font-family:var(--font-mono)">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Receipt Footer Message</label>
          <input type="text" id="s-footer" class="form-input" value="${sanitize(s.receipt_footer || 'Goods once sold are not returnable. Thank you!')}">
        </div>
        <div class="divider"></div>
        <div class="text-sm text-muted mb-3">Receipt Preview</div>
        <div class="receipt-live-preview">
          <div style="text-align:center; font-weight:900">${sanitize(s.shop_name || 'SAHAJA MOTORCYCLE LIMITED')}</div>
          <div style="text-align:center; font-size:9px">Tel: ${sanitize(s.phone || '')}</div>
          <div style="text-align:center; font-size:9px">${sanitize(s.address || '')}</div>
          <hr style="border:1px dashed #bbb; margin:6px 0">
          <div style="font-size:9px">Date: ${new Date().toLocaleDateString('en-KE')}</div>
          <div style="text-align:center; border:1px solid #000; padding:2px; font-weight:900; margin:4px 0; font-size:10px">CASH SALE</div>
          <hr style="border:1px dashed #bbb; margin:6px 0">
          <div style="font-size:9px; text-align:center">${sanitize(s.receipt_footer || 'Goods once sold are not returnable.')}</div>
        </div>
        <button class="btn btn-primary mt-4" onclick="App.saveReceiptSettings()">Save Receipt Settings</button>
      </div>
    `;
  }

  async function renderSettingsSuppliers(container) {
    container.innerHTML = `
      <div class="settings-card">
        <div class="settings-card-title" style="display:flex;justify-content:space-between;align-items:center">
          Suppliers
          <button class="btn btn-primary btn-sm" onclick="App.showAddSupplierModal()">${icons.plus} Add Supplier</button>
        </div>
        <div class="supplier-list">
          ${state.suppliers.map(s => `
            <div class="supplier-card">
              <div class="supplier-info">
                <div class="supplier-name">${sanitize(s.name)}</div>
                <div class="supplier-phone">${sanitize(s.phone || '—')} ${s.address ? `· ${sanitize(s.address)}` : ''}</div>
              </div>
              <div class="action-btns">
                <button class="icon-btn danger" onclick="App.deleteSupplier('${s.id}')">${icons.trash}</button>
              </div>
            </div>
          `).join('') || '<div class="text-muted text-sm">No suppliers added yet</div>'}
        </div>
      </div>
    `;
  }

  function renderSettingsBackup() {
    return `
      <div class="settings-card">
        <div class="settings-card-title">Data Backup</div>
        <div class="text-sm text-secondary mb-4">Export all your data as a JSON file as an emergency backup. Keep this file safe.</div>
        <button class="btn btn-secondary" onclick="App.exportBackup()">${icons.download} Export Full Backup (JSON)</button>
      </div>
    `;
  }

  function selectTheme(themeId, el) {
    applyTheme(themeId);
    document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    DB.ShopSettings.save({ ...state.settings, theme: themeId });
    showToast(`Theme changed to ${themeId}`, 'success');
  }

  async function saveShopProfile() {
    const newSettings = {
      shop_name: sanitizeInput(document.getElementById('s-name')?.value),
      phone: sanitizeInput(document.getElementById('s-phone')?.value),
      address: sanitizeInput(document.getElementById('s-address')?.value),
    };
    Object.assign(state.settings, newSettings);
    await DB.ShopSettings.save(state.settings);
    showToast('Shop profile saved!', 'success');
    renderSidebar();
  }

  async function saveReceiptSettings() {
    const updates = {
      receipt_prefix: sanitizeInput(document.getElementById('s-prefix')?.value?.toUpperCase()).substring(0, 6),
      receipt_footer: sanitizeInput(document.getElementById('s-footer')?.value),
    };
    Object.assign(state.settings, updates);
    await DB.ShopSettings.save(state.settings);
    showToast('Receipt settings saved!', 'success');
  }

  function showAddSupplierModal() {
    const modal = createModal('Add Supplier', `
      <div class="form-group"><label class="form-label">Supplier Name *</label><input type="text" id="sup-name" class="form-input" placeholder="e.g. River Road Spares"></div>
      <div class="form-group"><label class="form-label">Phone</label><input type="tel" id="sup-phone" class="form-input" placeholder="+254 ..."></div>
      <div class="form-group"><label class="form-label">Address</label><input type="text" id="sup-address" class="form-input" placeholder="e.g. River Rd, Nairobi"></div>
      <div class="form-group"><label class="form-label">Notes</label><input type="text" id="sup-notes" class="form-input" placeholder="What do they supply?"></div>
    `, [
      { text: 'Cancel', class: 'btn-secondary', action: () => closeModal() },
      { text: 'Add Supplier', class: 'btn-primary', action: () => addSupplier() }
    ]);
    document.body.appendChild(modal);
  }

  async function addSupplier() {
    const name = document.getElementById('sup-name')?.value.trim();
    if (!name) { showToast('Supplier name required', 'error'); return; }
    const { error } = await DB.Suppliers.create({
      name,
      phone: document.getElementById('sup-phone')?.value.trim(),
      address: document.getElementById('sup-address')?.value.trim(),
      notes: document.getElementById('sup-notes')?.value.trim()
    });
    if (error) { showToast('Error adding supplier', 'error'); return; }
    showToast('Supplier added!', 'success');
    closeModal();
    const { data } = await DB.Suppliers.getAll();
    state.suppliers = data || [];
    renderSettingsSuppliers(document.getElementById('settings-content'));
  }

  async function deleteSupplier(id) {
    if (!confirm('Delete this supplier?')) return;
    await DB.Suppliers.delete(id);
    const { data } = await DB.Suppliers.getAll();
    state.suppliers = data || [];
    showToast('Supplier removed', 'success');
    renderSettingsSuppliers(document.getElementById('settings-content'));
  }

  async function exportBackup() {
    const [partsRes, salesRes, creditsRes, suppRes] = await Promise.all([
      DB.Parts.getAll(), DB.Sales.getRecent(1000), DB.Credits.getAll(), DB.Suppliers.getAll()
    ]);
    const backup = {
      exported_at: new Date().toISOString(),
      parts: partsRes.data || [],
      credits: creditsRes.data || [],
      suppliers: suppRes.data || [],
      settings: state.settings
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `sahaja-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup exported!', 'success');
  }

  // ============================================================
  // DAILY CLOSE
  // ============================================================

  async function showDailyClose() {
    const report = await DB.DailyClosing.getTodayReport();
    const settings = state.settings;
    const reportHTML = Receipt.generateDailyReportHTML(report, settings);

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'daily-close-modal';
    modal.innerHTML = `
      <div class="modal modal-wide">
        <div class="modal-header">
          <div class="modal-title">Daily Closing Report — ${new Date().toLocaleDateString('en-KE')}</div>
          <button class="modal-close no-print" onclick="document.getElementById('daily-close-modal').remove()">${icons.close}</button>
        </div>

        <div class="closing-summary-tiles" style="padding:16px 24px 0; display:grid; grid-template-columns:repeat(4,1fr); gap:10px">
          <div class="closing-tile"><div class="closing-tile-label">Cash</div><div class="closing-tile-value cash">${ksh(report.total_cash)}</div></div>
          <div class="closing-tile"><div class="closing-tile-label">MPESA</div><div class="closing-tile-value mpesa">${ksh(report.total_mpesa)}</div></div>
          <div class="closing-tile"><div class="closing-tile-label">Credit</div><div class="closing-tile-value credit">${ksh(report.total_credit)}</div></div>
          <div class="closing-tile"><div class="closing-tile-label">Total</div><div class="closing-tile-value total">${ksh(report.total_revenue)}</div></div>
        </div>

        <div class="daily-close-preview">
          ${reportHTML}
        </div>

        <div class="receipt-actions no-print">
          <button class="btn btn-secondary" onclick="document.getElementById('daily-close-modal').remove()">Close</button>
          <button class="btn btn-primary" onclick="window.print()">${icons.print} Print Report</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // ============================================================
  // CONFIRM SIGN OUT
  // ============================================================

  async function confirmSignOut() {
    if (!confirm('Sign out of the Sahaja Shop Tool?')) return;
    await DB.Auth.signOut();
    document.getElementById('app').classList.add('hidden');
    renderAuth();
  }

  // ============================================================
  // MODAL HELPERS
  // ============================================================

  function createModal(title, body, buttons) {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.id = 'part-modal';
    modal.innerHTML = `
      <div class="modal modal-wide">
        <div class="modal-header">
          <div class="modal-title">${title}</div>
          <button class="modal-close" onclick="App.closeModal()">${icons.close}</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer" id="modal-footer-container"></div>
      </div>
    `;

    const footer = modal.querySelector('#modal-footer-container');
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.className = `btn ${b.class}`;
      btn.textContent = b.text;
      btn.addEventListener('click', b.action);
      footer.appendChild(btn);
    });

    return modal;
  }

  function closeModal() {
    const m = document.getElementById('part-modal');
    if (m) m.remove();
  }

  // ============================================================
  // PUBLIC API
  // ============================================================

  return {
    signIn,
    navigate,
    // POS
    filterPOSParts, setPOSCategory, addToCart, updateCartQty, removeFromCart,
    setPayMethod, processSale, switchPOSTab, setSalesChannel, shareReceiptPDF, viewTransactionDetails,
    // Inventory
    filterInventory, showAddPartModal, showEditPartModal, previewPartImage,
    clearPartImage, updateMarginPreview, savePartForm, quickRestock, deletePart,
    toggleSelectAll, updateBulkButtons, exportInventoryCSV, showTransferStockModal,
    // Credits
    filterCredits, filterCreditStatus, toggleCreditHistory, showPaymentModal, recordPayment,
    // Reports
    loadReportPeriod, loadCustomDateRange, exportSalesCSV,
    // Settings
    showSettingsSection, selectTheme, saveShopProfile, saveReceiptSettings,
    showAddSupplierModal, addSupplier, deleteSupplier, exportBackup,
    addOperator, deleteOperator, exportSourcingCSV,
    // Operators
    confirmSwitchOperator, navigateWithPIN,
    // Customers
    filterCustomers, selectCustomerDetail,
    // Daily close
    showDailyClose,
    // Auth
    confirmSignOut,
    // Modal
    closeModal,
    // Init
    async init() {
      // Check for existing session
      const { data: { session } } = await DB.Auth.getSession();
      if (session) {
        state.user = session.user;
        await initApp();
      } else {
        renderAuth();
      }

      // Listen for auth changes
      DB.Auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
          document.getElementById('app').classList.add('hidden');
          renderAuth();
        }
      });
    }
  };
})();

window.App = App;
