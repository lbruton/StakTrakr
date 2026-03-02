// StakTrakr Service Worker
// Enables offline support and installable PWA experience
// Cache version: auto-stamped by devops/hooks/stamp-sw-cache.sh pre-commit hook

const DEV_MODE = false; // Set to true during development — bypasses all caching





const CACHE_NAME = 'staktrakr-v3.33.21-b1772427093';






// Offline fallback for navigation requests when all cache/network strategies fail
const OFFLINE_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>StakTrakr</title></head>' +
  '<body style="font-family:system-ui;text-align:center;padding:4rem">' +
  '<h2>Offline</h2><p>StakTrakr is not available right now.</p>' +
  '<p><button onclick="location.reload()">Try Again</button></p></body></html>';

function offlineResponse() {
  return new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } });
}

// Core shell assets to pre-cache on install
const CORE_ASSETS = [
  './',
  './css/styles.css',
  './js/file-protocol-fix.js',
  './js/debug-log.js',
  './js/constants.js',
  './js/field-meta.js',
  './js/state.js',
  './js/utils.js',
  './js/dialogs.js',
  './js/image-cache.js',
  './js/image-processor.js',
  './js/bulk-image-cache.js',
  './js/image-cache-modal.js',
  './js/fuzzy-search.js',
  './js/autocomplete.js',
  './js/numista-lookup.js',
  './js/seed-images.js',
  './js/versionCheck.js',
  './js/changeLog.js',
  './js/diff-engine.js',
  './js/diff-modal.js',
  './js/charts.js',
  './js/theme.js',
  './js/search.js',
  './js/chip-grouping.js',
  './js/tags.js',
  './js/filters.js',
  './js/sorting.js',
  './js/pagination.js',
  './js/detailsModal.js',
  './js/viewModal.js',
  './js/debugModal.js',
  './js/numista-modal.js',
  './js/spot.js',
  './js/card-view.js',
  './js/seed-data.js',
  './js/priceHistory.js',
  './js/spotLookup.js',
  './js/goldback.js',
  './js/retail.js',
  './js/retail-view-modal.js',
  './js/api.js',
  './js/catalog-api.js',
  './js/pcgs-api.js',
  './js/catalog-providers.js',
  './js/catalog-manager.js',
  './js/inventory.js',
  './js/vault.js',
  './js/cloud-storage.js',
  './js/cloud-sync.js',
  './privacy.html',
  './js/about.js',
  './js/api-health.js',
  './js/faq.js',
  './js/customMapping.js',
  './js/settings.js',
  './js/settings-listeners.js',
  './js/bulkEdit.js',
  './js/clone-picker.js',
  './js/events.js',
  './js/init.js',
  './data/spot-history-bundle.js',
  './data/spot-history-2025.json',
  './data/spot-history-2026.json',
  './images/safe-favicon.svg',
  './images/staktrakr-logo.svg',
  './images/icon-192.png',
  './images/icon-512.png',
  './manifest.json',
  './vendor/papaparse.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js',
  './vendor/chart.min.js',
  './vendor/chartjs-plugin-datalabels.min.js',
  './vendor/jszip.min.js',
  './vendor/forge.min.js'
];

// API domains that should use network-first strategy
const API_HOSTS = [
  'api.metalpriceapi.com',
  'metals-api.com',
  'api.gold-api.com',
  'en.numista.com'
];

// CDN domains that use stale-while-revalidate
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com'
];

// Install: pre-cache core shell
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => {
        console.log('[SW] Install complete, skip waiting');
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Install failed:', err);
        throw err;
      })
  );
});

// Activate: purge old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_NAME);
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        const old = keys.filter((key) => key.startsWith('staktrakr-') && key !== CACHE_NAME);
        if (old.length) console.log('[SW] Purging old caches:', old);
        return Promise.all(old.map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: route requests by strategy
self.addEventListener('fetch', (event) => {
  // Dev mode: bypass all caching, go straight to network
  if (DEV_MODE) return;
  const url = new URL(event.request.url);

  // Never cache OAuth callback — must always hit network for fresh code
  if (url.pathname.includes('oauth-callback')) return;

  // Skip wiki pages — Docsify handles its own routing
  if (url.pathname.startsWith('/wiki/')) return;

  // Network-first for API calls (spot prices, catalog lookups)
  if (API_HOSTS.some((host) => url.hostname === host)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Stale-while-revalidate for CDN libraries
  if (CDN_HOSTS.some((host) => url.hostname === host)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Navigation requests (PWA launch, page reload) — serve cached app shell
  if (event.request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match('./')
        .then((cached) => {
          if (cached) return cached;
          console.log('[SW] Cache miss for ./, fetching from network');
          return fetchAndCache(event.request);
        })
        .then((response) => {
          if (response) return response;
          console.warn('[SW] No response from cache or network, serving offline page');
          return offlineResponse();
        })
        .catch((err) => {
          console.error('[SW] Navigation handler failed:', err);
          return offlineResponse();
        })
    );
    return;
  }

  // Stale-while-revalidate for StakTrakr hourly price API (primary + backup)
  if (url.hostname === 'api.staktrakr.com' || url.hostname === 'api2.staktrakr.com') {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Stale-while-revalidate for seed data (updated between releases by Docker poller)
  if (url.origin === self.location.origin && url.pathname.includes('/data/spot-history')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  // Network-first for local JS/CSS (always serve fresh code when online)
  if (url.origin === self.location.origin && /\.(js|css)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Stale-while-revalidate for other local assets (images, fonts, etc.)
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
});

// Shared: fetch and write successful responses to cache
function fetchAndCache(request) {
  return fetch(request).then((response) => {
    if (response.ok) {
      const clone = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        .catch((err) => console.warn('[SW] Cache put failed:', request.url, err));
    }
    return response;
  }).catch(() => caches.match(request));
}

// Guarantee a Response for respondWith() — catch undefined and rejections
function ensureResponse(promise) {
  return promise
    .then((response) => response || Response.error())
    .catch(() => Response.error());
}

// Strategy: cache-first with network fallback
function cacheFirst(request) {
  return ensureResponse(
    caches.match(request).then((cached) => cached || fetchAndCache(request))
  );
}

// Strategy: network-first with cache fallback
function networkFirst(request) {
  return ensureResponse(fetchAndCache(request));
}

// Strategy: stale-while-revalidate (serve cached, update in background)
function staleWhileRevalidate(request) {
  return ensureResponse(
    caches.match(request).then((cached) => {
      const fetchPromise = fetchAndCache(request);
      return cached || fetchPromise;
    })
  );
}
