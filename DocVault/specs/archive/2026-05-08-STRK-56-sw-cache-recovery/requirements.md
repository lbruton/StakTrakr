---
sketch: "STRK-56-sw-cache-recovery"
phase: requirements
created: 2026-05-08
---

# STRK-56 — Requirements

> **Source Issue:** [STRK-56](https://plane.lbruton.cc/lbruton/browse/STRK-56/)
>
> **Title:** Service worker `networkFirst()` returns broken responses with no cache fallback — "loadApiConfig is not defined" on Firefox
>
> **Summary:** On Firefox at `beta.staktrakr.com` (v3.34.49), a transient bad response for `js/api.js` produced an unrecoverable `Application initialization failed: loadApiConfig is not defined` modal. Hard refresh did NOT recover; only fully quitting Firefox and relaunching cleared the state. Investigation (with Codex peer review) identified three stacked defects:
>
> 1. **`sw.js` strategies pass through non-OK responses** — `networkFirst()` (sw.js:251-253), `cacheFirst()` (sw.js:246-247), and `staleWhileRevalidate()` on cache miss (sw.js:258-260) all return non-OK responses without falling back to cached copies. The navigation handler at sw.js:174-197 already does this correctly and is the canonical pattern.
> 2. **`js/init.js:615-617` calls `loadApiConfig()` / `loadApiCache()` without `typeof` guards** — making a missed `api.js` load fatal where most other init calls are recoverable.
> 3. **STAK-485 stale-cache recovery is single-shot** — `init.js:879-903` reloads once on `ReferenceError`, then a sessionStorage flag prevents re-attempt. When the bad response persists across reload (Firefox HTTP cache poisoning), the second load shows the unrecoverable CRITICAL modal instead of escalating.
>
> **Codex independent review** confirmed all three and endorsed Strategy A (unregister + `caches.delete()` + reload) as the second-tier recovery, gated to `ReferenceError` signatures to avoid destructive loops.

## Overview

Harden StakTrakr's PWA boot path against transient asset-load failures. Today, a single bad response for a core JS asset (e.g. `js/api.js`) produces an unrecoverable "Application initialization failed" modal on Firefox — the user must quit the browser entirely to escape. This sketch closes three stacked defects so the same scenario degrades gracefully: the service worker falls back to cached copies on non-OK responses, the init path tolerates missing optional globals, and the existing single-shot stale-cache recovery escalates to a clean SW reinstall before showing the user a fatal modal. Matters now because the bug was reported on the v3.34.49 beta build by a real user and represents a Firefox-reproducible failure mode for any PWA visitor experiencing flaky network or CDN-edge errors.

## User Stories

- **US-1:** As a StakTrakr user on Firefox (or any PWA-supporting browser) experiencing a flaky network or CDN edge error, **I want** the app to recover automatically when one of its JS assets fails to load, **so that** I can use the app without quitting my browser.
- **US-2:** As a StakTrakr user, **I want** the worst-case error dialog to offer me an in-app reset action, **so that** I have a way out without knowing browser-level cache tricks.
- **US-3:** As a maintainer, **I want** the service worker's fetch strategies to apply non-OK fallback consistently, **so that** future feature work doesn't have to re-derive the same caching gotcha for each new strategy.

## Acceptance Criteria

### AC-1 (maps to US-1) — SW serves cached copy when network returns broken response

- **Given** the service worker is installed with all CORE_ASSETS cached and the user reloads the app
- **When** a same-origin request handled by `networkFirst`, `cacheFirst`, or `staleWhileRevalidate` receives a non-OK response (e.g. simulated 500 or aborted body) AND a cached copy exists for that request
- **Then** the SW returns the cached copy instead of propagating the broken response, AND the broken response is NOT written to Cache Storage

### AC-2 (maps to US-1) — init tolerates missing api.js globals

- **Given** the page loads but `js/api.js` failed to execute (e.g. simulated by removing the script tag or stubbing the load)
- **When** `init.js` reaches the API initialization step (currently lines 615-617)
- **Then** init does NOT throw a `ReferenceError` for `loadApiConfig` or `loadApiCache`; it logs a warning, uses an empty config object, and continues; spot-price and catalog features may show degraded state but the app shell stays interactive

### AC-3 (maps to US-1) — second-tier recovery on persistent ReferenceError

- **Given** the existing STAK-485 single-shot reload has already been attempted (`sessionStorage["sw-recovery-attempted"] === "1"`)
- **When** `init.js` catches another `ReferenceError` matching the asset-load signature
- **Then** the recovery path unregisters all service workers, deletes the StakTrakr Cache Storage entries, sets a second-tier flag (`sw-recovery-nuked`), and reloads — BEFORE showing the CRITICAL modal
- **And** if the third load STILL fails, the CRITICAL modal IS shown (no infinite loop)
- **And** the `sw-recovery-nuked` flag is cleared on successful init, just like `sw-recovery-attempted`

### AC-4 (maps to US-2) — CRITICAL modal offers a Reset App action

- **Given** all auto-recovery tiers have failed and the CRITICAL modal is about to display
- **When** the modal appears
- **Then** it includes a "Reset App" button alongside OK; pressing Reset App performs the same unregister + caches.delete + reload sequence as AC-3 (regardless of flag state)

### AC-5 (maps to US-3) — non-OK fallback shared across SW strategies

- **Given** the SW source after the patch
- **When** reading `networkFirst`, `cacheFirst`, and `staleWhileRevalidate`
- **Then** all three route non-OK responses through a single shared fallback helper (avoiding three near-duplicate implementations); the navigation handler at `sw.js:174-197` continues to work as today

## Non-Goals

- **Not** rewriting the SW caching architecture or changing which strategy each asset uses — only the non-OK fallback gap is in scope.
- **Not** addressing the unrelated unguarded init call to `migrateSpotPricingSource()` (line 612) — Codex flagged it but it does not contribute to this bug; track separately if desired.
- **Not** changing `cache.addAll` install behavior, `CACHE_NAME` versioning conventions, or the existing `stamp-sw-cache` pre-commit hook.
- **Not** adding telemetry or remote logging for recovery events — a future observability concern, out of scope here.
- **Not** writing E2E Playwright tests against a live service worker — manual Firefox repro via DevTools network blocking is the target verification path. (May add a unit-style test for the SW helper if practical, but not a hard requirement.)
- **Not** addressing Chrome/Safari-specific PWA cache behavior — the bug was reproduced on Firefox; behavior on other browsers is verified opportunistically, not as a release gate.

## Open Questions

_Resolve before discovery completes._

- [x] Should the "Reset App" button be on the existing `appAlert` modal or a custom error UI? — **Decision:** extend the existing CRITICAL modal path to inject a second action button; do not introduce a new modal component. (Discovery to confirm `appAlert` supports this; if not, a small inline override in `init.js` catch block is acceptable.)
- [x] Where should the shared SW non-OK helper live in the file? — **Decision:** discovery phase will choose; default is to add a `withCacheFallback(request, response)` helper near the existing strategy functions in `sw.js` and call it from each.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-56`.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-56`.
