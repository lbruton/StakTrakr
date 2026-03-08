---
title: Service Worker
category: frontend
owner: staktrakr
lastUpdated: v3.33.59
date: 2026-03-07
sourceFiles:
  - sw.js
  - devops/hooks/stamp-sw-cache.sh
relatedPages:
  - frontend-overview.md
  - release-workflow.md
---
# Service Worker

> **Last updated:** v3.33.25 — 2026-03-02
> **Source files:** `sw.js`, `devops/hooks/stamp-sw-cache.sh`

## Overview

StakTrakr uses a vanilla Service Worker (`sw.js`) to pre-cache all application assets for offline use and to enable PWA installation. On every commit that touches a cached asset, the pre-commit hook `stamp-sw-cache.sh` auto-stamps a new `CACHE_NAME` into `sw.js`, forcing browsers to treat the cache as stale and re-fetch all assets. No manual edits to `CACHE_NAME` are ever required or permitted.

---

## Key Rules

1. **Never edit `CACHE_NAME` by hand.** It is written exclusively by the pre-commit hook on every commit that touches a cached asset. Manual edits are overwritten immediately on the next commit.
2. **When adding a new JS file**, update **both** `index.html` (script tag, in load order) **and** `CORE_ASSETS` in `sw.js`. Missing either causes a stale-serve bug that disappears on hard refresh but breaks offline mode.
3. **When adding a vendor file**, add `./vendor/your-lib.min.js` to the bottom of `CORE_ASSETS` in `sw.js`.
4. **When adding a new yearly seed file** (e.g., `spot-history-2027.json`), add the entry to `CORE_ASSETS` at the start of the new year.
5. Keep `CORE_ASSETS` in the same logical order as the `<script>` tags in `index.html` to make auditing easier.

---

## CACHE_NAME Auto-Stamping

### Format

```
staktrakr-v{APP_VERSION}-b{EPOCH}
```

Current value in `sw.js`:

```js
const CACHE_NAME = 'staktrakr-v3.33.25-b1772431885';
```

- `APP_VERSION` — read from `js/constants.js` at commit time (e.g. `3.33.25`)
- `EPOCH` — Unix timestamp in seconds at commit time, making every build globally unique
- When the name changes, the browser treats it as a new cache bucket, re-fetches all `CORE_ASSETS`, and the old bucket is deleted in the `activate` handler

### How cache busting works end-to-end

Every patch bump triggers `stamp-sw-cache.sh`, which produces a new `CACHE_NAME`. When a user's browser fetches the updated `sw.js`, it sees an unknown cache name, opens a fresh cache bucket, and re-downloads all `CORE_ASSETS`. The `activate` event then purges every cache key that starts with `staktrakr-` but does not match the current `CACHE_NAME`.

This means:

- Users always receive the latest JS/CSS within one page load of a new deploy.
- No manual cache-clearing is required by the user.
- Offline mode works immediately after the fresh install completes.

---

## CORE_ASSETS Management

The `CORE_ASSETS` array lists all files pre-cached during `install`. As of v3.33.25 there are **76 entries**.

```js
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
```

If a file is missing from this list, it will not be pre-cached. When the app is offline, any request for that file will fall through to whatever runtime strategy applies — if there is no cached copy, the request will fail and the feature will be unavailable offline.

---

## Cache Strategy

Requests are routed through different strategies inside the `fetch` event handler:

| Bucket | Hosts / Paths | Strategy | Rationale |
|---|---|---|---|
| **Pre-cached shell** | All `CORE_ASSETS` entries | Cached on `install` via `cache.addAll()` | Ensures offline availability of core app |
| **External API hosts** | `metalpriceapi.com`, `metals-api.com`, `gold-api.com`, `numista.com` | Network-first | Live price feeds must always return fresh data when online |
| **CDN libraries** | `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com` | Stale-while-revalidate | Serve fast from cache, refresh in background |
| **StakTrakr API** | `api.staktrakr.com`, `api2.staktrakr.com` | Stale-while-revalidate | Hourly price feeds benefit from a fast cached response with background refresh |
| **Spot history seed data** | Same-origin `/data/spot-history*` | Stale-while-revalidate | Seed files are updated between releases by the poller |
| **Local JS/CSS** | Same-origin `*.js`, `*.css` | Network-first | Always serve fresh code when online; fall back to cache if offline |
| **Navigation requests** | Same-origin `navigate` mode | Cache-first (app shell `./`) | PWA launch and page reload serve the cached index; falls back to inline offline page |
| **Other local assets** | Same-origin (images, fonts, etc.) | Stale-while-revalidate | Fast cached response with background refresh |
| **OAuth callback** | Any path containing `oauth-callback` | Bypassed (no SW interception) | Auth flow must always hit the network for a fresh code |
| **Wiki pages** | `/wiki/` prefix | Bypassed (no SW interception) | Docsify handles its own routing |

### Strategy implementations

All three strategies are implemented as helper functions and called from the `fetch` handler:

- **`networkFirst(request)`** — calls `fetchAndCache()`, which fetches from the network and writes a successful response to the cache; falls back to the cache if the network fails.
- **`staleWhileRevalidate(request)`** — serves the cached copy immediately (if present) while simultaneously triggering a background `fetchAndCache()` to update the cache for the next request.
- **`cacheFirst(request)`** — returns the cached copy directly; only falls back to `fetchAndCache()` on a cache miss. Used internally; not assigned to any fetch route in the current build.

The `ensureResponse()` wrapper guarantees that `respondWith()` always receives a valid `Response` object (never `undefined`) by converting both `undefined` returns and rejections into `Response.error()`.

---

## Event Handlers

### `install`

Opens the `CACHE_NAME` bucket and calls `cache.addAll(CORE_ASSETS)`, which fetches all listed assets atomically. If any single asset returns a non-OK response, the entire install fails. After a successful cache fill, `self.skipWaiting()` is called so the new worker activates immediately without waiting for existing tabs to close.

### `activate`

Enumerates all cache keys. Any key that starts with `staktrakr-` but does not match the current `CACHE_NAME` is treated as an old cache and deleted. After purging, `self.clients.claim()` takes control of all open tabs immediately.

### `fetch`

Routes each request through the appropriate strategy based on URL matching (see Cache Strategy table above). Two special cases bypass the SW entirely without calling `event.respondWith()`:

- Requests with `DEV_MODE = true` (compile-time flag at the top of `sw.js`)
- OAuth callback paths
- Wiki page paths (`/wiki/`)

---

## Pre-commit Hook

**File:** `devops/hooks/stamp-sw-cache.sh`
**Installed at:** `.git/hooks/pre-commit` (symlink)

### What it does

1. Checks whether any staged file matches one of the cached path patterns: `css/`, `js/`, `index.html`, `data/`, `images/`, `manifest.json`, or `sw.js` itself.
2. If no cached asset is staged, exits immediately (no-op — the hook is safe to run on any commit).
3. Reads `APP_VERSION` from `js/constants.js` using `grep` + `sed` (macOS-compatible; no `grep -P`).
4. Captures the current Unix epoch with `date +%s`.
5. Constructs `NEW_CACHE = staktrakr-v{APP_VERSION}-b{EPOCH}`.
6. Compares against the current `CACHE_NAME` in `sw.js`; if already equal, exits (idempotent).
7. Rewrites the `CACHE_NAME` line in `sw.js` using `sed`, with a GNU/BSD dual-path for macOS vs Linux compatibility.
8. Runs `git add sw.js` to re-stage the modified file so the rewrite is included in the current commit.
9. Prints `[stamp-sw-cache] CACHE_NAME updated: staktrakr-v...` to stdout.

### Install (one-time, already done in this repo)

```bash
ln -sf ../../devops/hooks/stamp-sw-cache.sh .git/hooks/pre-commit
```

Run this after a fresh clone if the hook is not already in place.

### Trigger patterns

The hook activates on staged changes to:

```
css/
js/
index.html
data/
images/
manifest.json
sw.js
```

Any staged file whose path begins with one of these patterns triggers a cache name bump.

---

## DEV_MODE

`sw.js` exposes a compile-time bypass flag at the top of the file:

```js
const DEV_MODE = false; // Set to true during development — bypasses all caching
```

When `DEV_MODE = true`, the `fetch` handler returns immediately on every request, letting all traffic pass directly to the network. This is useful when debugging live-reload workflows where cached assets would mask changes. This flag is never committed as `true` — always reset it before committing.

---

## Common Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Added a JS file to `index.html` but not `CORE_ASSETS` | Service worker serves the old (missing) version offline; bug disappears on hard refresh | Add `./js/your-file.js` to `CORE_ASSETS` in `sw.js` in load order |
| Edited `CACHE_NAME` manually | Pre-commit hook overwrites it on the next qualifying commit | Do not edit — the hook owns this line |
| Hook not symlinked after a fresh clone | `CACHE_NAME` never updates; users get stale cached assets indefinitely | Run `ln -sf ../../devops/hooks/stamp-sw-cache.sh .git/hooks/pre-commit` |
| Added a vendor file to `vendor/` but not `CORE_ASSETS` | Vendor script missing in offline mode | Add `./vendor/your-lib.min.js` to the bottom of `CORE_ASSETS` |
| `CORE_ASSETS` out of order vs `index.html` | No runtime error, but makes auditing harder | Keep entries in `<script>` load order |
| Left `DEV_MODE = true` in a commit | All caching bypassed for all users in production | Reset to `false` before committing |
| New yearly seed file not added to `CORE_ASSETS` | Spot history for the new year unavailable offline | Add `./data/spot-history-YYYY.json` to `CORE_ASSETS` at year rollover |

---

## Intentional CORE_ASSETS Exclusions

- **`js/test-loader.js`** — intentionally excluded from `CORE_ASSETS`. This is a dev-only test harness that conditionally loads Playwright test specs when a `?test` query parameter is present. It is not needed in the production cache and should never be added to `CORE_ASSETS`.

---

## Related Pages

- [frontend-overview.md](frontend-overview.md) — full JS file list and load order
- [release-workflow.md](release-workflow.md) — patch versioning and the pre-commit hook pipeline
