---
sketch: "STRK-56-sw-cache-recovery"
phase: approach
created: 2026-05-08
---

# STRK-56 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The fix layers three independent defenses, each closing one of the stacked defects identified during investigation. **Layer 1 (sw.js):** add a single `respondWithCacheFallback(request, response)` helper that returns a cached copy when the network response is non-OK; route all three caching strategies (`networkFirst`, `cacheFirst` cache-miss path, `staleWhileRevalidate` cache-miss path) through it. The navigation handler (sw.js:174-197) already implements this pattern correctly and stays untouched as the reference implementation. **Layer 2 (init.js:615-617):** wrap the two `loadApiConfig()` / `loadApiCache()` calls in `typeof X === "function"` guards matching the established convention used by `spotLookup.js`, `settings.js`, and `settings-listeners.js`. On a missed `api.js` load, the guards substitute `{}` / `{}` and continue init with degraded API features instead of throwing a fatal `ReferenceError`. **Layer 3 (init.js:881-911):** extend the existing STAK-485 catch block with a second-tier recovery. When `sw-recovery-attempted` is already set AND the error is a `ReferenceError` for a known asset-load global (`loadApiConfig` or `loadApiCache`), perform `navigator.serviceWorker.getRegistrations()` → `unregister()` + `caches.keys()` → `caches.delete()` for all `staktrakr-` prefixed caches, set a new `sw-recovery-nuked` flag, and reload. If THAT load also fails (both flags set), fall through to the existing error modal path. The CRITICAL modal is augmented with a Reset App action that runs the same nuke sequence regardless of flag state, giving the user an in-app escape hatch.

The three layers are orthogonal: any one alone reduces user impact, all three together close the failure mode at every level. Layer 1 prevents most users from ever seeing the bug. Layer 2 gives the app a softer failure mode if Layer 1 still misses. Layer 3 ensures even users in the worst-case persistent-poisoning scenario have an automatic escape (and an in-app manual one). The cache version bump that ships this PR is auto-stamped by `devops/hooks/stamp-sw-cache.sh` — no manual `CACHE_NAME` edit.

## Key Decisions

| #   | Decision                                                                                                                                                                                                                    | Rationale                                                                                                                                                                                                                                                                   | Tradeoff                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Add a single `respondWithCacheFallback(request, response)` helper in `sw.js` near `fetchAndCache` (~line 240); call inline from each strategy.                                                                              | One source of truth for non-OK fallback; mirrors the navigation handler pattern; minimal diff.                                                                                                                                                                              | Adds one more named function to `sw.js`; if a future strategy is added, the author must remember to call it (mitigated by leaving the navigation handler as canonical reference).                                                |
| D-2 | Wrap `loadApiConfig()` / `loadApiCache()` in `typeof === "function"` guards with sentinel `{}` fallbacks, matching the project-established convention.                                                                      | Restores symmetry with 3 other callsites already using this pattern; avoids inventing a new defensive idiom.                                                                                                                                                                | Silent degradation if `api.js` fails — spot prices and catalog features will appear non-functional. Acceptable given the alternative is a fatal modal; degraded > broken.                                                        |
| D-3 | Gate the second-tier nuke recovery on `error instanceof ReferenceError` AND a known asset-load global signature, starting with `loadApiConfig` / `loadApiCache`.                                                            | Codex's caveat: a TypeError or unrelated ReferenceError must not trigger destructive recovery. A known-missing-global allowlist keeps the recovery tied to "script asset failed to load" instead of "any init bug".                                                         | Won't catch every possible cache-poisoning flavor or every missing global unless explicitly allowlisted. Acceptable; this sketch is scoped to the reproduced `api.js` failure and can add signatures later if evidence warrants. |
| D-4 | Reset App button on the CRITICAL modal: extend `dialogs.js` with a fourth mode `"action"` that takes `{ message, title, primaryLabel, primaryAction, secondaryLabel }` returning Promise<void>; call from init catch block. | Cleaner than repurposing `appConfirm` (whose hardcoded "OK"/"Cancel" labels would confuse users) and cleaner than inlining a custom modal in init.js (which would duplicate styling/focus-trap logic). One small extension to dialogs.js is the lowest-blast-radius option. | Touches `dialogs.js` — a third file in the PR. The new mode is generally useful (reusable for future error UIs), so the cost is paid once and amortized.                                                                         |
| D-5 | Use sessionStorage (not localStorage) for `sw-recovery-nuked`, mirroring `sw-recovery-attempted`. Clear on successful init alongside the existing flag.                                                                     | Recovery state should reset between browser sessions; persistent localStorage would cause "stuck" states across days/weeks. Matches the existing flag's lifecycle.                                                                                                          | None significant — sessionStorage is the right primitive here.                                                                                                                                                                   |
| D-6 | Nuke sequence runs SW unregister + cache deletion in parallel (`Promise.all`), waits for both, then reloads. Do NOT wrap in `try/catch` swallowing — let failures surface to the user via the modal.                        | Fast, simple. If unregister fails or cache.delete fails, the user is no worse off than before this fix; they still get the modal.                                                                                                                                           | Slightly larger diff in catch block; acceptable.                                                                                                                                                                                 |
| D-7 | Out-of-scope: do NOT add a guard to `events.js:3843`'s unguarded `loadApiConfig()` call.                                                                                                                                    | That callsite runs after init has already succeeded; if api.js failed, init would have already recovered or shown the modal — events.js code never executes in the broken-api.js scenario.                                                                                  | If a future change makes events.js code reachable pre-init, the gap re-opens. Documented in Out of Scope so a follow-up issue is easy to file.                                                                                   |

## File Map

### New

- _none_ — all work is in existing files.

### Modified

- `sw.js` — Add `respondWithCacheFallback(request, response)` helper near line 240; modify `networkFirst` (251-253), `cacheFirst` (246-247), and `staleWhileRevalidate` (256-263) to route non-OK responses through the helper. (`CACHE_NAME` line 7 is auto-bumped by pre-commit hook — not a manual edit.)
- `js/init.js` — Add `typeof` guards on lines 615-617 (loadApiConfig, loadApiCache); extend catch block 881-911 with second-tier nuke recovery (new `sw-recovery-nuked` flag); add `sessionStorage.removeItem("sw-recovery-nuked")` to the success path near line 880; replace the existing single `appAlert(...)` call with a call to the new `appActionDialog` (D-4) that includes a Reset App secondary action.
- `js/dialogs.js` — Add a fourth mode `"action"` to `showDialog`; expose `window.showAppActionDialog` and `window.appActionDialog` wrappers parallel to existing `showAppAlert`/`appAlert`.

### Deleted

- _none_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. New sessionStorage key `sw-recovery-nuked` is ephemeral and self-clearing on successful init.

## Tradeoffs Surfaced for Review

- **D-2 silent degradation:** Wrapping `loadApiConfig` in a typeof guard means a user whose `api.js` failed to load will see "no spot price data" and "Catalog API system ready" warnings in console, but the rest of the app works. Some maintainers prefer a loud failure here. We're choosing degraded-functional over fatal-modal because (a) the fatal modal is the bug we're fixing, and (b) the boot-diagnostics layer (line 50-58 STAK-485 controllerchange listener) will still catch SW updates that resolve the issue on next reload.
- **D-4 dialog API extension:** We're adding one new mode to `dialogs.js` rather than building a one-off modal in init.js. This is a minor public API change (new global `appActionDialog`). Worth flagging because a future PR could reuse it for other recovery dialogs (e.g., quota exceeded, sync conflict resolution). If you'd prefer to keep `dialogs.js` frozen and inline a custom modal in init.js's catch block, say so before tasks.
- **D-7 events.js non-fix:** Codex's review noted `events.js:3843` is also unguarded. We're not touching it because the execution timing makes it unreachable in the broken-api.js scenario — but it IS technically the same shape of fragility. If the user prefers to fix it for symmetry, the cost is one line; otherwise it stays in Out of Scope.

## Out of Scope (follow-up issues)

- **events.js:3843 unguarded `loadApiConfig()`** — file under StakTrakr (Plane STRK prefix). Low priority; orthogonal to STRK-56's failure mode but the same pattern. Tag with `defensive-hardening`.
- **`migrateSpotPricingSource()` (init.js:612) unguarded call** — flagged by Codex during the partial correction. Not contributing to this bug. Same low-priority follow-up.
- **Telemetry for recovery events** — when the Layer-3 nuke fires, we have no visibility into how often this happens in production. Future observability concern; not part of this PR.
- **Playwright SW-poisoning test harness** — a real automated test for AC-1/AC-2/AC-3 would require a fixture that stubs network responses inside a registered SW. Significant infrastructure work; manual Firefox repro is sufficient for this patch.
- **Dialog API consolidation** — if D-4's new `"action"` mode proves reusable, a future refactor could collapse `alert`/`confirm`/`action` into a single configurable mode. Not now.

## Risk Notes

- **Risk: Recovery boot-loop if Layer-3 nuke triggers on a non-cache-related ReferenceError.** Mitigation: D-3 known-global signature gating + `sw-recovery-nuked` flag bound. Worst case is two extra reloads before the modal shows — which is the same UX as today (one reload then modal).
- **Risk: `caches.delete()` race with a concurrent fetch from a not-yet-killed SW client.** Mitigation: we unregister before deleting; even if a stale fetch is in flight, by the time the page reloads the caches are gone and a fresh SW install runs `cache.addAll` cleanly.
- **Risk: User clicks Reset App during normal operation (curious/confused).** Mitigation: Reset App only appears on the CRITICAL error modal — never reachable during normal operation. The destructive action is appropriately gated by context.
- **Risk: D-4 dialog extension breaks existing `appAlert`/`appConfirm` callers.** Mitigation: new mode is additive; existing modes (`alert`/`confirm`/`prompt`) untouched. Existing 3 wrappers and their tests continue to work unchanged.
- **Risk: Cache version bump fails to fire because `sw.js` change isn't detected as cached-asset commit.** Mitigation: `stamp-sw-cache.sh` hook explicitly stamps when `sw.js` itself is staged — verified via mem0 (April 2026 fix). Falsifies on commit if there's drift.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-56`.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-56`.
