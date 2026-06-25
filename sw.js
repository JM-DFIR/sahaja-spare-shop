// ============================================================
// SERVICE WORKER — Sahaja Shop Tool
// Auto-versioned: uses build timestamp so it's ALWAYS fresh
// ============================================================

// This timestamp changes every time you edit this file and redeploy
// It forces all clients to dump old cache and fetch new files
const CACHE_VERSION = 'sahaja-2026-06-25-v1';
const CACHE_NAME = `sahaja-shop-${CACHE_VERSION}`;

const SHELL_FILES = [
  '/index.html',
  '/app.js',
  '/supabase.js',
  '/receipt.js',
  '/styles/main.css',
  '/styles/pos.css',
  '/styles/components.css',
  '/styles/receipt-print.css',
  '/styles/mobile.css',
  '/manifest.json',
  '/logo.png'
];

// ---- Install ----
self.addEventListener('install', event => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache files one by one so one failure doesn't break all
      return Promise.allSettled(
        SHELL_FILES.map(file => cache.add(file).catch(e => console.warn('[SW] Failed to cache:', file, e)))
      );
    })
  );
  // Activate immediately without waiting for old SW to die
  self.skipWaiting();
});

// ---- Activate: wipe ALL old caches ----
self.addEventListener('activate', event => {
  console.log('[SW] Activating, clearing old caches...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      );
    }).then(() => {
      console.log('[SW] All old caches cleared. Taking control.');
      return self.clients.claim(); // take control of ALL open tabs immediately
    })
  );
});

// ---- Fetch strategy ----
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. Never intercept Supabase API calls — always live data
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
    return;
  }

  // 2. Never intercept CDN calls (Chart.js, Supabase JS, Google Fonts)
  if (url.hostname.includes('jsdelivr.net') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('gstatic.com')) {
    return;
  }

  // 3. HTML pages and root → NETWORK FIRST (always get latest code)
  if (event.request.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/index.html')) // offline fallback only
    );
    return;
  }

  // 4. CSS / JS / images → Cache first, then network fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).then(response => {
        if (response && response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

// ---- Message handler: force update from app ----
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
