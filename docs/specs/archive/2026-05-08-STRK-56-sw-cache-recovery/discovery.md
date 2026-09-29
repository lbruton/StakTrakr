---
sketch: "STRK-56-sw-cache-recovery"
phase: discovery
created: 2026-05-08
---

# STRK-56 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| `sw.js:120-135` | `install` event — `cache.addAll(CORE_ASSETS)` is atomic; on success, every CORE_ASSET (including `js/api.js` line 70) IS cached. | Means cached-copy fallback path is reachable for every CORE_ASSET. |
| `sw.js:138-150` | `activate` event — purges old caches matching `staktrakr-` prefix, calls `clients.claim()`. | Untouched by this work. |
| `sw.js:153-222` | `fetch` event — strategy router (API/CDN/navigation/local-JS-CSS/seed-data/other-local). | Adds non-OK fallback inside strategies; router itself doesn't change. |
| `sw.js:174-197` | Navigation handler — already has the canonical "non-OK → caches.match('./')" pattern we want to mirror. | Reference implementation for AC-1 / AC-5. |
| `sw.js:225-238` | `fetchAndCache(request)` — only writes cache when `response.ok`; only falls back to cache on `.catch()` (network rejection). | Source of the bug — non-OK responses pass through. |
| `sw.js:241-243` | `ensureResponse(promise)` — guarantees a Response (upgrades undefined/rejection to `Response.error()`). | Keep — already protects respondWith() contract. |
| `sw.js:246-247` | `cacheFirst(request)` — calls `caches.match` then falls through to `fetchAndCache`. | Cache miss inherits the same non-OK passthrough bug. |
| `sw.js:251-253` | `networkFirst(request)` — wraps `fetchAndCache` directly. | Primary defect site for AC-1. |
| `sw.js:256-263` | `staleWhileRevalidate(request)` — serves cached if present, else returns raw `fetchPromise`. | Cache miss inherits non-OK passthrough. |
| `js/init.js:50-58` | `controllerchange` listener — auto-reloads on new SW takeover (STAK-485). | Untouched — orthogonal to recovery escalation. |
| `js/init.js:615-617` | `apiConfig = loadApiConfig(); apiCache = loadApiCache();` — bare calls, no `typeof` guard. | Defect site for AC-2. |
| `js/init.js:879-880` | Clears `sw-recovery-attempted` flag on successful init. | Need analogous clear for new `sw-recovery-nuked` flag. |
| `js/init.js:881-911` | `catch(error)` block — STAK-485 single-shot recovery, then standard `appAlert`. | Defect site for AC-3 / AC-4 — extend with second tier and Reset App action. |
| `js/api.js:383` | `loadApiConfig = () => {...}` (definition). | Confirms the function lives in api.js — bug is correct re: which file failure breaks init. |
| `js/api.js` callsites | 9 internal callers; events.js:3843 calls without guard; spotLookup.js:156/203 + settings.js:425 + settings-listeners.js:1620/1681 ALL use `typeof loadApiConfig === "function"` guards. | Establishes that the typeof-guard pattern is the convention for this function — `init.js:615-617` is the genuine outlier. Strengthens AC-2's "targeted hardening" framing. |
| `js/dialogs.js:147-191` | `showAppAlert` / `showAppConfirm` / `showAppPrompt` + `appAlert` / `appConfirm` / `appPrompt` wrappers. | API surface for AC-4 — see Constraints below. |
| `index.html:8294` | `dialogs.js` script tag. | Loads BEFORE `api.js` (line 8330) and BEFORE `init.js` (last). Means `appAlert` IS available in the init catch block even when `api.js` failed. |
| `devops/hooks/stamp-sw-cache.sh` | Pre-commit hook stamping `CACHE_NAME = staktrakr-v{APP_VERSION}-b{EPOCH}` when cached assets are staged. | Will auto-bump cache on this PR's `sw.js` change — no manual cache version edit needed. |

## Prior Decisions

- **2026-03-21 — STAK-494**: "still bugged after merge due to browser serving pre-fix cached `catalog-api.js` via service worker; enabling 'Update on reload', hard refresh, or verifying fix in console resolves issue." (mem0 `6c9864a3`). Direct precedent for the failure mode — stale SW-cached JS hiding a deployed fix. Reinforces that *this* fix needs to land with a cache version bump (which `stamp-sw-cache.sh` handles automatically).
- **2026-04-17 — sw.js CACHE_NAME sync**: "User fixed a stale sw.js CACHE_NAME issue, ensuring the service worker's CACHE_NAME matches the current version after version bumps." (mem0 `c7208c21`). Confirms the auto-stamping behavior is the canonical sync mechanism.
- **STAK-485 (in-code reference)**: `init.js:50-58, 879-911` — single-shot stale-cache reload via `sessionStorage["sw-recovery-attempted"]`. The framing ("stale cache detected") in line 898 anticipated exactly this class of bug; the gap is just that "stale cache" was modeled as a one-shot transient, not a persistent HTTP-cache-poisoning scenario.
- **`cache.addAll` atomicity (mem0 `17ff1dd3`)**: "cache.addAll() is all-or-nothing; if any URL receives a redirect response, the entire service worker installation fails, causing the old broken service worker to remain active and leading to an ERR_FAILED crash loop. Fix: use './' instead of './index.html' in CORE_ASSETS." Constraint reminder — do NOT add new CORE_ASSETS entries casually in this PR.

## External References

- [MDN — Cache.addAll](https://developer.mozilla.org/en-US/docs/Web/API/Cache/addAll) — confirms atomic semantics; relevant for understanding why we can rely on every CORE_ASSET being cached after a successful install.
- [MDN — Service Worker fetch event / respondWith](https://developer.mozilla.org/en-US/docs/Web/API/FetchEvent/respondWith) — confirms `respondWith()` accepts a Promise<Response> and that returning Response.error() is a valid fail-shut signal.
- [MDN — ServiceWorkerRegistration.unregister()](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/unregister) — semantics for the "nuke" tier of recovery: returns a Promise resolving to a boolean; does not affect already-running pages until they navigate away.
- [Workbox — NetworkFirst plugin source](https://developer.chrome.com/docs/workbox/modules/workbox-strategies#network_first_network_falling_back_to_cache) — reference implementation; their NetworkFirst falls back to cache on both network rejection AND non-OK responses by default. Validates our chosen direction.

## Constraints

- **`appAlert` is alert-only — single OK button.** Per `dialogs.js:177-180`, `appAlert` resolves Promise<void> with no return value. To deliver AC-4's "Reset App" action, options are: (a) repurpose `appConfirm` with explicit button-relabeling (currently buttons are hardcoded "OK"/"Cancel" — not configurable), (b) extend `dialogs.js` to support custom button labels (broader change, may belong in a separate issue), or (c) inject a small inline DOM modal directly in the init catch block, sidestepping `dialogs.js` entirely. **Decision deferred to approach phase.**
- **Browser support floor:** PWA-supporting browsers (Chrome, Firefox, Safari, Edge). All have `navigator.serviceWorker.getRegistrations()`, `caches.delete()`, `sessionStorage` — no compatibility concern.
- **No new CORE_ASSETS entries** unless absolutely required (atomicity constraint above). The fix is logic-only inside existing files.
- **Cache version bump is automatic** via `stamp-sw-cache.sh` — do NOT hand-edit `CACHE_NAME` in `sw.js`.
- **Vanilla JS, no build step** (per CLAUDE.md). No new dependencies; helper must be a plain function in `sw.js`.
- **Script load order:** `dialogs.js` loads before `api.js` and `init.js`; safe to assume `appAlert` exists in the init catch block. `init.js` is last; if `init.js` itself fails to load there's nothing we can do — out of scope.
- **Recovery escalation must be bounded.** AC-3 explicitly requires that the third load fail-shut to the modal (no infinite loop). The `sw-recovery-nuked` sessionStorage flag is the bound; it must be cleared on successful init alongside `sw-recovery-attempted` (line 880 reference).
- **ReferenceError signature gate** — Codex flagged that the nuke tier should NOT trigger on every init failure. Only `error instanceof ReferenceError` (and ideally a regex/list match against known asset-load globals) qualifies; a TypeError from a logic bug must NOT trigger a destructive recovery.
- **Manual verification path** is Firefox DevTools network-blocking on `js/api.js` (per AC-1 and STRK-56 issue body). No Playwright SW-poisoning test harness exists in the project; do not attempt to build one in this sketch.

## Open Questions

_Resolved during this phase — no blockers for approach._

- [x] **Are there other unguarded `loadApiConfig` callsites we should fix in this PR?** `events.js:3843` lacks the guard. Decision: out of scope for this sketch — it runs after init (i.e., api.js is known-loaded by then) and adding the guard there is cosmetic. Document as a follow-up note in approach.md, do not change.
- [x] **Does STAK-485's `controllerchange` listener (init.js:50-58) need any change for the new tier?** No — it auto-reloads on new SW takeover, which is what happens *after* unregister + reload. It's actually helpful: ensures the post-nuke load picks up the freshly-installed SW.
- [x] **Should the new tier also clear the SW Cache Storage explicitly?** YES — `caches.delete(CACHE_NAME)` is part of Strategy A. Without it, the unregister leaves caches behind that a re-registered SW would re-claim. Belt-and-suspenders: `caches.keys()` then `Promise.all(keys.map(caches.delete))` for any `staktrakr-` prefix.
- [x] **Where should the shared SW non-OK helper live?** Add a new `respondWithCacheFallback(request, response)` helper near `fetchAndCache` (around `sw.js:240`). Each strategy calls it inline after receiving the network response; the navigation handler stays as-is (already correct, no churn).

## Discovery Summary

The work lands in two files (`sw.js`, `js/init.js`) plus a possible minor touch on `js/dialogs.js` if AC-4's Reset App button needs an extended dialog mode. The tricky bit is AC-4's UI — `appAlert` is single-button, so the approach phase must choose between extending the dialog API, repurposing `appConfirm`, or inlining a custom modal in the catch block. Everything else is mechanical: a shared SW fallback helper, two `typeof` guards in `init.js`, and a second-tier sessionStorage-flagged unregister-and-reload path in the existing catch block. Cache version bump is fully automated by the existing `stamp-sw-cache` pre-commit hook — no manual `CACHE_NAME` edit needed.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-56`.
