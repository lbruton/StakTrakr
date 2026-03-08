---
title: Frontend Overview
category: frontend
owner: staktrakr
lastUpdated: v3.33.59
date: 2026-03-07
sourceFiles:
  - index.html
  - js/constants.js
  - sw.js
  - js/file-protocol-fix.js
relatedPages:
  - data-model.md
  - storage-patterns.md
  - dom-patterns.md
  - service-worker.md
---
# Frontend Overview

> **Last updated:** v3.33.58 — 2026-03-07
> **Source files:** `index.html`, `js/constants.js`, `sw.js`, `js/file-protocol-fix.js`

## Overview

StakTrakr is a single-page precious metals inventory tracker built with pure HTML and vanilla JavaScript. It has **zero build step, zero install, and zero server-side dependencies**. The application runs identically under both `file://` (local ZIP extraction) and HTTP (web hosting or local server). All user data is persisted in `localStorage`; image and metadata caches use IndexedDB. There is no backend beyond static API feeds served from `api.staktrakr.com`.

**Portfolio value model:** `meltValue = weightOz × qty × spotPrice × purity`. Three price columns are tracked per holding: Purchase Price, Melt Value, and Retail Price.

**Supported metals:** Silver, Gold, Platinum, Palladium, and Goldback.

---

## Key Rules

Read these before touching any frontend file:

- **New JS files must be registered in two places.** Add a `<script defer>` tag to `index.html` in the correct load order AND add the file path to `CORE_ASSETS` in `sw.js`. Missing either registration means the file silently fails to load or the service worker skips it on offline fetch.
- **Never use `document.getElementById()` directly** outside of `about.js` and `init.js` startup code — always call `safeGetElement(id)`.
- **Never write to `localStorage` directly** — always use `saveData()` / `loadData()` from `js/utils.js`.
- **All localStorage keys must be declared** in `ALLOWED_STORAGE_KEYS` in `js/constants.js`.
- **Always call `sanitizeHtml()`** before assigning user-controlled content to `innerHTML`.
- **Never edit `sw.js` `CACHE_NAME` manually.** The `devops/hooks/stamp-sw-cache.sh` pre-commit hook auto-stamps it on every commit. Manual edits will be overwritten.
- **Script load order in `index.html` is strict.** Dependencies must appear before dependents. There are currently **70 `<script>` tags** in `index.html` (including inline, vendor, and application scripts).

---

## Architecture

### Runtime model

```text
index.html  (single-page app — all UI panels, modals, and sections)
  ├── <head> scripts (synchronous, load first)
  │     └── js/file-protocol-fix.js   — localStorage fallback for file:// protocol
  │
  └── <body> deferred scripts (66 files, strict load order)
        ├── js/debug-log.js           — debug logging utility
        ├── js/constants.js           — APP_VERSION, all constants, ALLOWED_STORAGE_KEYS
        ├── js/field-meta.js          — field metadata definitions
        ├── js/state.js               — shared mutable application state
        ├── js/utils.js               — saveData(), loadData(), sanitizeHtml(), etc.
        ├── js/dialogs.js             — modal dialog helpers
        ├── ... (feature modules in dependency order)
        ├── js/events.js              — global event bindings
        ├── js/test-loader.js         — test harness loader (dev only)
        └── js/init.js                — bootstraps the app after all scripts load
```

### Versioning

`APP_VERSION` in `js/constants.js` follows the `BRANCH.RELEASE.PATCH` format:

```text
3   .   33   .   56
^       ^        ^
Branch  Release  Patch
```

Current version: **3.33.56**

Optional state suffixes: `a` = alpha, `b` = beta, `rc` = release candidate.

Run `/release patch` after every meaningful committed change — one change, one patch tag. The version appears in seven files when bumped; always use the `/release` skill rather than editing manually.

### Key entry points

| File | Role |
|---|---|
| `index.html` | Single-page shell — all panels, modals, and UI sections live here |
| `js/constants.js` | Global constants, `APP_VERSION`, `ALLOWED_STORAGE_KEYS`, `FEATURE_FLAGS` |
| `js/state.js` | Shared mutable state (spot prices, inventory cache, filter state) |
| `js/utils.js` | Core utilities: `saveData()`, `loadData()`, `sanitizeHtml()` |
| `js/init.js` | App bootstrap, `safeGetElement()` — runs last, wires everything together after all scripts are deferred-loaded |

### Script load order

The 66 deferred application scripts in `index.html` load in this sequence (abridged):

| Position | File | Why here |
|---|---|---|
| 1 (sync, `<head>`) | `js/file-protocol-fix.js` | Must run before any other script to patch `localStorage` for `file://` |
| 2 | `js/debug-log.js` | Logging utility needed by all subsequent scripts |
| 3 | `js/constants.js` | Global constants consumed by every other module |
| 4 | `js/field-meta.js` | Field definitions used by state and utils |
| 5 | `js/state.js` | Mutable state object; must precede all readers/writers |
| 6 | `js/utils.js` | Core helpers; must precede all callers |
| 7–54 | Feature modules | Roughly: dialog/image → search/filter → sort/paginate → modals → spot/retail/catalog → inventory → cloud |
| 55 | `js/events.js` | Global event bindings — all modules must be loaded first |
| 56 | `js/test-loader.js` | Test harness (dev only; loads conditionally) |
| 57 | `js/init.js` | Bootstrap — must be last |

Full order is canonical in `sw.js` `CORE_ASSETS` and reflected in `index.html`.

### Service worker

`sw.js` provides offline support and PWA installability. Key behaviors:

- **Install phase:** pre-caches all files listed in `CORE_ASSETS` (76 paths: JS, CSS, images, vendor libs, seed data). Note: `CORE_ASSETS` is the production/offline cache subset — dev-only scripts like `js/test-loader.js` are intentionally excluded.
- **Activate phase:** purges any old caches whose name starts with `staktrakr-` but does not match the current `CACHE_NAME`.
- **Fetch routing strategies:**
  - `file://` or OAuth callback: bypassed (no caching).
  - `/wiki/` paths: bypassed (Docsify handles its own routing).
  - `api.metalpriceapi.com`, `metals-api.com`, `api.gold-api.com`, `en.numista.com`: **network-first**.
  - CDN hosts (`cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`): **stale-while-revalidate**.
  - `api.staktrakr.com` / `api2.staktrakr.com`: **stale-while-revalidate**.
  - `/data/spot-history*`: **stale-while-revalidate** (seed files updated between releases).
  - Local `.js` / `.css` files: **network-first** (always serve fresh code when online).
  - Navigation requests (PWA launch): served from cached app shell.
  - All other local assets: **stale-while-revalidate**.
- **`CACHE_NAME`** format: `staktrakr-v{VERSION}-b{BUILD_HASH}` — auto-stamped by the `stamp-sw-cache.sh` pre-commit hook.
- **`DEV_MODE`** flag: set `true` during active development to bypass all caching and go straight to network.

### `file://` protocol support

`js/file-protocol-fix.js` is loaded **synchronously in `<head>` before all other scripts**. It detects when the app is running under `file://` (e.g., opened from an extracted ZIP) and applies a lightweight `localStorage` fallback:

- Wraps `localStorage.setItem`, `getItem`, and `removeItem` in try/catch blocks.
- On failure, falls back to `window.tempStorage` (an in-memory object).
- This ensures inventory reads and writes work even in environments where `file://` origins block `localStorage`.

On `http://` or `https://` origins the wrapping is still installed but never triggered — native `localStorage` calls succeed normally.

### Diff review modal (`#diffReviewModal`)

The diff review modal is a reusable change-review UI used by cloud sync and import flows (STAK-184, STAK-451, STAK-454). It is defined in `index.html` with a scoped `<style>` block immediately before its markup. All CSS classes are prefixed with `dm-` and scoped under `#diffReviewModal` to avoid conflicts with existing app styles.

**Layout:** `max-width: 860px`. At or below the `768px` breakpoint the modal expands to full-screen (`width: 100vw; height: 100dvh; max-width: none; border-radius: 0`).

**Section containers** inside `#diffReviewModal .modal-body`:

| Element ID | Purpose |
|---|---|
| `diffSummaryDashboard` | High-level counts dashboard shown at the top of the review |
| `diffProgressTracker` | Conflict-resolution progress bar (visible only for cloud sync sources) |
| `diffSectionConflicts` | Renders conflicting items that require user resolution |
| `diffSectionOrphans` | Card-based rendering of Added and Deleted items. Each card shows dual OBV/REV image thumbnails (3-tier: IndexedDB blob → CDN URL → metal gradient placeholder), metal-colored name, weight/qty metadata, and Import/Skip or Keep/Remove action buttons |
| `diffSectionModified` | Card-based rendering of Modified items with expandable per-field click-to-pick values (local vs remote), resolve progress bar, and per-card/section-level bulk actions (max-height 500px, bordered) |

**State model (STAK-454):** The card-based UI uses three state objects: `_orphanActions` (per-item import/skip/keep/remove), `_fieldSelections` (per-field local/remote winner), and `_resolvedConflicts` (confirmed conflict cards). Legacy `_checkedItems` is maintained for backward compatibility with older callers.

Supporting elements: `diffReviewTitle`, `diffReviewSource`, `diffReviewCountRow`, `diffReviewCountWarning`, `diffReviewSettings`. Action buttons: `diffReviewSelectAll`, `diffReviewDismissX`.

### Vendor libraries

Seven vendor libraries are bundled locally in `./vendor/` for offline and `file://` compatibility:

| Library | Global | Purpose |
|---|---|---|
| `papaparse.min.js` | `Papa` | CSV parsing |
| `jspdf.umd.min.js` | `jspdf` | PDF generation |
| `jspdf.plugin.autotable.min.js` | (extends jsPDF) | PDF table layout |
| `chart.min.js` | `Chart` | Portfolio charts |
| `chartjs-plugin-datalabels.min.js` | `ChartDataLabels` | Chart data labels |
| `jszip.min.js` | `JSZip` | ZIP backup import/export |
| `forge.min.js` | `forge` | Encryption (vault/cloud sync) |

CDN fallbacks with SRI hashes fire automatically on `DOMContentLoaded` if any local copy failed to define its global.

### PWA support

- `manifest.json` enables installability on mobile and desktop.
- Theme color: `#1a1a2e`.
- Icons: `images/icon-192.png`, `images/icon-512.png`.
- Apple mobile meta tags present for iOS home-screen install.

### Content Security Policy

The CSP is intentionally permissive (`default-src * 'unsafe-inline' 'unsafe-eval' data: blob:`). This is required because:

- `file://` origin requires `unsafe-inline` for inline event handlers and styles.
- Vendor libraries (JSZip, Forge) require `unsafe-eval`.

Runtime mitigations compensate: all user-controlled HTML is escaped via `sanitizeHtml()`, OAuth tokens are scoped to `localStorage`, and vault passwords are cached in `sessionStorage` with XOR obfuscation and an auto-clear idle timer.

---

## Common Mistakes

- **Adding a new JS file to `index.html` but forgetting `sw.js` CORE_ASSETS (or vice versa).** The app works in dev but breaks for users with a cached service worker on the next visit.
- **Calling `document.getElementById()` outside of `about.js` / `init.js`.** The safe wrapper `safeGetElement()` provides error logging and avoids silent null-reference failures.
- **Writing directly to `localStorage` instead of `saveData()`.** This bypasses key validation and `ALLOWED_STORAGE_KEYS` enforcement.
- **Editing `sw.js` `CACHE_NAME` manually.** The pre-commit hook will overwrite it on the next commit; always let the hook stamp the value.
- **Placing a new `<script>` tag in the wrong position in `index.html`.** Scripts that reference globals from a file that loads later will throw at page load time.
- **Assuming `spot-history-YYYY.json` is live data.** It is a seed file (noon UTC daily snapshot) and always appears approximately 10 hours stale in health checks, even when the poller is healthy.
- **Hardcoding a storage quota.** Storage quota is derived dynamically from `navigator.storage.estimate()` in `js/image-cache.js`; do not hardcode values like `50 * 1024 * 1024`.
- **Bumping the version manually.** The version string appears in 7 files; always run `/release patch` via the skill to keep all occurrences in sync.

---

## Related Pages

- [Data Model](data-model.md)
- [Storage Patterns](storage-patterns.md)
- [DOM Patterns](dom-patterns.md)
- [Service Worker](service-worker.md)
