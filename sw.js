// StakTrakr Service Worker
// Enables offline support and installable PWA experience
// Cache version: auto-stamped by devops/hooks/stamp-sw-cache.sh pre-commit hook
//
// Service-worker globals plus the symbols sw-router.js publishes via
// importScripts. Declared here because the repo's legacy .eslintrc.json sets
// no-undef: off while Codacy's ESLint 9 config enforces it, so these read as
// undefined there without an explicit declaration.
//
// List only what sw.js actually calls — a name declared here but never used is
// itself a lint finding. isRootShellNavigation is deliberately absent: it is
// exported by sw-router.js and covered by tests/unit/sw-router.test.js, but
// sw.js calls navShellCacheKey directly (STRK-310).
/* global self, caches, importScripts, classifyEndpoint, parseGeneratedAtSeconds, shouldFallBackToCache, navShellCacheKey */

importScripts("sw-router.js");

const DEV_MODE = false; // Set to true during development — bypasses all caching

// Directory this worker is served from — "/" at origin root (Cloudflare Pages
// today), "/StakTrakr/" under a subpath deployment. navShellCacheKey resolves
// navigations relative to it so the shell mapping follows the deployment
// instead of assuming the origin root (STRK-310). Derived from self.location
// rather than registration.scope: it needs no async access and is already the
// base the relative "./" cache keys resolve against.
const SW_SCOPE_PATH = new URL("./", self.location.href).pathname;

const CACHE_NAME = "staktrakr-v3.36.19-b1788044657";

// Offline fallback for navigation requests when all cache/network strategies fail
const OFFLINE_HTML =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><title>StakTrakr</title></head>' +
  '<body style="font-family:system-ui;text-align:center;padding:4rem">' +
  "<h2>Offline</h2><p>StakTrakr is not available right now.</p>" +
  '<p><button onclick="location.reload()">Try Again</button></p></body></html>';

function offlineResponse() {
  return new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html" } });
}

// Core shell assets to pre-cache on install
const CORE_ASSETS = [
  "./",
  "./css/styles.css",
  "./fonts/geist-variable.woff2",
  "./fonts/instrument-serif-regular.woff2",
  "./fonts/geist-mono-variable.woff2",
  "./js/file-protocol-fix.js",
  "./js/debug-log.js",
  "./js/boot-diagnostics.js",
  "./js/constants.js",
  "./js/field-meta.js",
  "./js/state.js",
  "./js/utils-storage.js",
  "./js/utils-format.js",
  "./js/utils-storage-report.js",
  "./js/utils.js",
  "./js/dialogs.js",
  "./js/image-cache.js",
  "./js/image-processor.js",
  "./js/bulk-image-cache.js",
  "./js/image-cache-modal.js",
  "./js/attachment-manager.js",
  "./js/history-store.js",
  "./js/attachment-ui.js",
  "./js/fuzzy-search.js",
  "./js/autocomplete.js",
  "./js/numista-lookup.js",
  "./js/seed-images.js",
  "./js/versionCheck.js",
  "./js/changeLog.js",
  "./js/diff-engine.js",
  "./js/diff-modal-settings.js",
  "./js/diff-modal.js",
  "./js/chart-utils.js",
  "./js/market-charts.js",
  "./js/market-data.js",
  "./js/charts.js",
  "./js/theme.js",
  "./js/search.js",
  "./js/chip-grouping.js",
  "./js/tags.js",
  "./js/filters.js",
  "./js/sorting.js",
  "./js/pagination.js",
  "./js/portfolio-series.js",
  "./js/detailsModal.js",
  "./js/image-frame.js",
  "./js/viewModal.js",
  "./js/debugModal.js",
  "./js/numista-modal.js",
  "./js/spot.js",
  "./js/spot-ratio-math.js",
  "./js/spot-ratio-chips.js",
  "./js/ratios-panel.js",
  "./js/card-view.js",
  "./js/seed-data.js",
  "./js/priceHistory.js",
  "./js/spotLookup.js",
  "./js/goldback.js",
  "./js/retail.js",
  "./js/retail-view-modal.js",
  "./js/api.js",
  "./js/catalog-api.js",
  "./js/catalog-numista-modal.js",
  "./js/pcgs-api.js",
  "./js/catalog-providers.js",
  "./js/catalog-manager.js",
  "./js/inventory-backup.js",
  "./js/inventory-import.js",
  "./js/csv-export.js",
  "./js/inventory-table.js",
  "./js/inventory.js",
  "./js/vault-crypto.js",
  "./js/vault.js",
  "./js/cloud-storage.js",
  "./js/cloud-sync.js",
  "./privacy.html",
  "./js/about.js",
  "./js/api-health.js",
  "./js/faq.js",
  "./js/customMapping.js",
  "./js/settings.js",
  "./js/settings-listeners.js",
  "./js/bulkEdit.js",
  "./js/bulk-row-images.js",
  "./js/clone-picker.js",
  "./js/form-sections.js",
  "./js/events.js",
  "./js/tabs.js",
  "./js/init.js",
  "./data/spot-history-bundle.js",
  "./data/spot-history-2025.json",
  "./data/spot-history-2026.json",
  "./images/safe-favicon.svg",
  "./images/staktrakr-logo.svg",
  "./images/icon-logo.svg",
  "./images/banner-logo.svg",
  "./images/banner-logo-compact.svg",
  "./images/icon-192.png",
  "./images/icon-512.png",
  "./images/icon-maskable-192.png",
  "./images/icon-maskable-512.png",
  "./manifest.json",
  // Ratios PWA shell + assets (STRK-274) — panel/math scripts, styles.css,
  // chart vendor, and the seed bundle are already precached above.
  "./ratios/",
  "./ratios/manifest.json",
  "./js/ratios-page.js",
  "./images/ratios-icon.svg",
  "./images/ratios-icon-192.png",
  "./images/ratios-icon-512.png",
  "./images/ratios-icon-maskable-192.png",
  "./images/ratios-icon-maskable-512.png",
  "./images/ratios-apple-touch-icon.png",
  "./vendor/papaparse.min.js",
  "./vendor/jspdf.umd.min.js",
  "./vendor/jspdf.plugin.autotable.min.js",
  "./vendor/chart.min.js",
  "./vendor/chartjs-plugin-datalabels.min.js",
  "./vendor/jszip.min.js",
  "./vendor/forge.min.js",
  "./vendor/lz-string.min.js",
];

// API domains that should use network-first strategy
const API_HOSTS = ["api.metalpriceapi.com", "metals-api.com", "api.gold-api.com", "en.numista.com"];

// CDN domains that use stale-while-revalidate
const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"];

// Install: pre-cache core shell
self.addEventListener("install", (event) => {
  console.log("[SW] Installing", CACHE_NAME);
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => {
        console.log("[SW] Install complete, skip waiting");
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error("[SW] Install failed:", err);
        throw err;
      })
  );
});

// Activate: purge old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating", CACHE_NAME);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const old = keys.filter((key) => key.startsWith("staktrakr-") && key !== CACHE_NAME);
        if (old.length) console.log("[SW] Purging old caches:", old);
        return Promise.all(old.map((key) => caches.delete(key)));
      })
      .then(() => self.clients.claim())
  );
});

// Fetch: route requests by strategy
self.addEventListener("fetch", (event) => {
  // Dev mode: bypass all caching, go straight to network
  if (DEV_MODE) return;
  const url = new URL(event.request.url);

  // Never cache OAuth callback — must always hit network for fresh code
  if (url.pathname.includes("oauth-callback")) return;

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

  // Navigation requests (PWA launch, page reload) — network-first for fresh HTML.
  // Each app SHELL (tracker "./", ratios "./ratios/" — STRK-274) reads/writes
  // ONLY its own nav-cache key: before the STRK-273 guard, any same-origin
  // navigation (privacy.html, /ratios/) overwrote the cached tracker shell.
  // Non-shell pages bypass the nav cache and get honest error/offline responses.
  // SW_SCOPE_PATH keeps the mapping deployment-agnostic (STRK-310).
  if (event.request.mode === "navigate" && url.origin === self.location.origin) {
    const shellKey = navShellCacheKey(url.pathname, SW_SCOPE_PATH);
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            if (shellKey) {
              const clone = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(shellKey, clone))
                .catch((err) => console.warn("[SW] Nav cache put failed:", err));
            }
            return response;
          }
          // Non-OK response (4xx/5xx) — shells fall back to their cached copy;
          // other pages get the honest error response.
          if (!shellKey) return response;
          return caches.match(shellKey).then((cached) => cached || response);
        })
        .catch(() => {
          if (!shellKey) return offlineResponse();
          return caches
            .match(shellKey)
            .then((cached) => cached || offlineResponse())
            .catch(() => offlineResponse());
        })
    );
    return;
  }

  // Classified cache-first-with-TTL for StakTrakr API (primary + backup)
  if (url.hostname === "api.staktrakr.com" || url.hostname === "api2.staktrakr.com") {
    const family = classifyEndpoint(event.request.url, self.location.origin);
    event.respondWith(
      family ? classifiedFetch(event.request, family) : staleWhileRevalidate(event.request)
    );
    return;
  }

  // Classified cache-first-with-TTL for seed data (updated between releases by Docker poller)
  if (url.origin === self.location.origin && url.pathname.includes("/data/spot-history")) {
    const family = classifyEndpoint(event.request.url, self.location.origin);
    event.respondWith(
      family ? classifiedFetch(event.request, family) : staleWhileRevalidate(event.request)
    );
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
  return fetch(request)
    .then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, clone))
          .catch((err) => console.warn("[SW] Cache put failed:", request.url, err));
      }
      return response;
    })
    .catch(() => caches.match(request));
}

function respondWithCacheFallback(request, response) {
  if (!response || response.ok) return response;
  return globalThis.caches.match(request).then((cached) => cached || response);
}

// Guarantee a Response for respondWith() — catch undefined and rejections
function ensureResponse(promise) {
  return promise.then((response) => response || Response.error()).catch(() => Response.error());
}

// Strategy: network-first with cache fallback
function networkFirst(request) {
  return ensureResponse(
    fetchAndCache(request).then((response) => respondWithCacheFallback(request, response))
  );
}

// Strategy: stale-while-revalidate (serve cached, update in background)
function staleWhileRevalidate(request) {
  return ensureResponse(
    caches.match(request).then((cached) => {
      const fetchPromise = fetchAndCache(request).then((response) =>
        respondWithCacheFallback(request, response)
      );
      return cached || fetchPromise;
    })
  );
}

// Classified strategy: fetch with no-store, synthesize a cacheable Response with freshness headers.
// Only caches response.ok results (matches fetchAndCache contract at sw.js:232-240).
// Envelope families (hasEnvelope: true) parse generated_at / stale_after from the response body.
function fetchAndCacheClassified(request, family) {
  return fetch(request, { cache: "no-store" }).then((response) => {
    if (response.type === "opaque") {
      // Opaque responses have status 0 (ok=false) — check before !response.ok guard.
      // Cannot synthesize freshness headers — store raw, no age headers.
      caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(request, response.clone()))
        .catch((err) => console.warn("[SW] Classified opaque cache put failed:", err));
      return response.clone();
    }
    if (!response.ok) {
      // Non-OK upstream responses are returned unchanged and never cached
      return response;
    }
    return response.arrayBuffer().then((buffer) => {
      const now = Date.now();
      const syntheticHeaders = {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "x-cached-at": String(now),
      };
      if (family.hasEnvelope) {
        try {
          const body = JSON.parse(new TextDecoder().decode(buffer));
          // v2 envelopes carry generated_at as an ISO-8601 string; the header
          // contract downstream (matchWithAgeCheck) is unix seconds (STRK-189)
          const genSeconds = parseGeneratedAtSeconds(body);
          if (genSeconds !== null) {
            syntheticHeaders["x-generated-at"] = String(genSeconds);
          }
          if (typeof body.stale_after === "number") {
            syntheticHeaders["x-stale-after"] = String(body.stale_after);
          }
        } catch {
          // Non-JSON or malformed envelope — x-generated-at and x-stale-after remain absent
        }
      }
      const toCache = new Response(buffer, {
        status: response.status,
        statusText: response.statusText,
        headers: syntheticHeaders,
      });
      const toReturn = new Response(buffer, {
        status: response.status,
        statusText: response.statusText,
        headers: syntheticHeaders,
      });
      return caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(request, toCache))
        .catch((err) => console.warn("[SW] Classified cache put failed:", request.url, err))
        .then(() => toReturn);
    });
  });
}

// Classified strategy: read cache and check age against family TTL.
// Returns a cloned Response if the cached entry is fresh, null otherwise.
// Age clock: x-generated-at (envelope families) → x-cached-at (non-envelope / legacy) → stale.
// TTL: x-stale-after (envelope) ?? family.floor.
function matchWithAgeCheck(request, family) {
  return caches.match(request).then((cached) => {
    if (!cached) return null;
    const headers = cached.headers;
    const staleAfterHeader = headers.get("x-stale-after");
    const ttl = staleAfterHeader !== null ? Number(staleAfterHeader) : family.floor;
    let ageSeconds;
    const generatedAt = headers.get("x-generated-at");
    if (generatedAt !== null) {
      // Authoritative age origin: publisher mint time (matches api-health.js contract)
      ageSeconds = Date.now() / 1000 - Number(generatedAt);
    } else {
      const cachedAt = headers.get("x-cached-at");
      if (cachedAt === null) {
        // Legacy entry with no age headers — treat as stale, force one cold network hit
        return null;
      }
      ageSeconds = (Date.now() - Number(cachedAt)) / 1000;
    }
    if (isNaN(ageSeconds) || ageSeconds >= ttl) return null;
    return cached.clone();
  });
}

// Test instrumentation: tracks the last classified-fetch strategy decision within this SW lifetime.
// Written only by classifiedFetch; read by the __sw_test_state__ postMessage listener below.
// Tests must serialize requests (one request → one postMessage read) to avoid race conditions.
let lastStrategy = null;

/**
 * Resolve a completed network attempt, preferring a cached copy when the
 * response is unusable.
 *
 * A fetch that rejects (offline, DNS failure) is handled by the .catch() paths
 * below. This covers the other half: a fetch that *resolves* with a non-OK
 * status. A transient upstream 500/503 used to be handed straight to the page
 * even with a good cached copy on disk, so the user saw an error state instead
 * of last-known-good prices (STRK-256).
 *
 * When nothing is cached the original response is returned unchanged, so a
 * genuine error still reaches the page with its real status rather than being
 * masked as a generic network failure.
 *
 * Sets the lastStrategy test instrumentation as a side effect.
 *
 * @param {Request} request - The classified request being served.
 * @param {Response} response - The response the network attempt resolved with.
 * @returns {Response|Promise<Response>} The response to serve to the page.
 */
function resolveWithCacheFallback(request, response) {
  if (!shouldFallBackToCache(response)) {
    lastStrategy = "network";
    return response;
  }
  return caches.match(request).then((stale) => {
    if (stale) {
      lastStrategy = "network-fallback";
      return stale;
    }
    lastStrategy = "network";
    return response;
  });
}

// Classified dispatcher: cache-first-with-TTL, network on miss, stale fallback on error.
// Realtime families (family.networkFirst) skip the TTL check and go straight to network,
// falling back to the cached copy on a fetch error or an unusable response.
function classifiedFetch(request, family) {
  if (family.networkFirst) {
    return fetchAndCacheClassified(request, family)
      .then((response) => resolveWithCacheFallback(request, response))
      .catch(() => {
        lastStrategy = "network-fallback";
        return caches.match(request).then((stale) => stale || Response.error());
      });
  }
  return matchWithAgeCheck(request, family).then((cached) => {
    if (cached) {
      lastStrategy = "cache-hit";
      return cached;
    }
    return fetchAndCacheClassified(request, family)
      .then((response) => resolveWithCacheFallback(request, response))
      .catch(() => {
        lastStrategy = "network-fallback";
        return caches.match(request).then((stale) => stale || Response.error());
      });
  });
}

// Test instrumentation: respond to __sw_test_state__ postMessages with the lastStrategy value.
// No general RPC surface — only this specific message type is handled.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "__sw_test_state__") {
    event.source.postMessage({ type: "__sw_test_state__", lastStrategy: lastStrategy });
  }
});
