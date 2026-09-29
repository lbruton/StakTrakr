---
sketch: "STRK-79-market-api-sw-routing"
phase: approach
created: 2026-05-15
---

# STRK-79 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The solution adds a **path-keyed routing layer** to the existing service worker fetch handler. A new pure JS module, `sw-router.js`, defines a `classifyEndpoint(url, selfOrigin)` function and a `FAMILY_TABLE` constant that maps URL patterns to `{ family, floor, hasEnvelope }` descriptors for the ten in-scope endpoint families. The service worker loads this module via `importScripts("sw-router.js")`. At fetch time, the existing `api.staktrakr.com`/`api2.staktrakr.com` and local-spot-history dispatch blocks try the classifier first; a non-null result routes the request through a new `classifiedFetch(request, family)` path, while a null result falls through to the existing `staleWhileRevalidate` call unchanged. The classified path **bypasses** `cacheFirst` / `networkFirst` / `staleWhileRevalidate` entirely — those functions are still invoked for unclassified requests, and their bodies are not edited.

The age-gate has two halves, both contained inside `sw.js`. On **write**, a new `fetchAndCacheClassified(request, family)` helper fetches with `{ cache: "no-store" }` to bypass browser HTTP cache, reads the full response body once via `arrayBuffer()`, and — for envelope families — parses `generated_at` and `stale_after` from the v2 envelope. It then synthesizes a new `Response` carrying up to three extra headers: `x-cached-at` (ms epoch string at write time), `x-generated-at` (envelope `generated_at` in seconds, present only for envelope families with a parseable value), and `x-stale-after` (envelope `stale_after` in seconds, present only for envelope families). Status and statusText are preserved from the upstream response, and **only `response.ok` results are cached** — non-OK responses are returned to the caller untouched and never stamped with these headers (matches the existing `fetchAndCache` contract at `sw.js:228-240`). Both the returned response and the cached copy are built from the same buffer, so the body is never consumed twice. On **read**, a new `matchWithAgeCheck(request, family)` helper calls `caches.match()`, then computes age authoritatively from `x-generated-at` when present (matching `api-health.js:61-110`), falling back to `x-cached-at` for `hasEnvelope: false` families (`annual-spot-history`) and for legacy/opaque entries that lack `x-generated-at`. The response is returned only if `ageSeconds < (x-stale-after ?? family.floor)`. A missing `x-cached-at` AND `x-generated-at` (truly legacy) is treated as stale, forcing one cold network hit. The `classifiedFetch` dispatcher calls `matchWithAgeCheck` first; on a null result it calls `fetchAndCacheClassified`; on a fetch failure it falls back to raw `caches.match()` to serve whatever is cached (stale is better than nothing). The global `CACHE_NAME` version-purge on activate (`sw.js:147`) remains the outer ceiling — per-family TTLs operate entirely beneath it.

The `sw-router.js` file uses a CJS export guard (`typeof module !== "undefined" && (module.exports = ...)`) so the same file can be `importScripts`'d in the service worker and `require()`'d in Node unit tests — the same pattern used by `devops/pollers/shared/v2-utils.js:1-4`. Node unit tests live in `tests/unit/sw-router.test.js` and cover all nine families and all in-scope hosts. The Playwright integration test in `tests/playwright/sw-caching.spec.js` opts into service workers (`test.use({ serviceWorkers: "allow" })`) against `python3 -m http.server`, following the `font-loading.spec.js:41-50` precedent, and asserts cache-hit / expired / miss paths using temporary SW-internal instrumentation (a `__SW_LAST_STRATEGY` global that the test can read via `page.evaluate`).

---

## Key Decisions

| #   | Decision                                                                                                                                       | Rationale                                                                                                                                                                                                                                                                                                                                                                                | Tradeoff                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | `sw-router.js` as a separate `importScripts`'d module with CJS guard                                                                           | Same file usable in SW (`importScripts`) and Node tests (`require`). Matches `v2-utils.js` precedent. Classifier is isolated, testable, and not tangled with SW lifecycle code.                                                                                                                                                                                                          | `sw-router.js` must stay in the repo root alongside `sw.js`; path is hardcoded in `importScripts`. Any rename requires updating both the import and `.gitignore` if the root accumulates too many files.                                                                                                                                                                  |
| D-2 | `matchWithAgeCheck(request, family)` is the single read-side helper for the classified path                                                    | All age-check logic lives in one place; the classified path bypasses the existing strategy functions entirely so their bodies stay untouched. Per-strategy baking would scatter envelope-age conditionals across three functions.                                                                                                                                                        | Only called from `classifiedFetch`. If a future change calls it on non-classified paths, legacy entries (no `x-cached-at`/`x-generated-at`) would always read stale, subtly changing cache behavior. The dispatcher boundary is the enforcement seam.                                                                                                                     |
| D-3 | Envelope `generated_at` + `stale_after` read at **write time**, stored as `x-generated-at` and `x-stale-after` headers                         | Matches the existing v2 freshness contract (`api-health.js:61-110`) — age is measured from publisher mint time, not cache-write time, so a stale publisher response fetched after an outage does not get blessed for another full TTL. All TTL state lives inside Cache Storage alongside the response — version-purge invalidates both atomically.                                      | Requires `arrayBuffer()` + `JSON.parse` on every classified API cache write. For responses with large bodies (e.g., `history-90d.json`), this adds a small synchronous parse cost. Acceptable since the network fetch already dominates the write path. For `hasEnvelope: false` families (`annual-spot-history`) and legacy entries, age falls back to `x-cached-at`.    |
| D-4 | `{ cache: "no-store" }` on all classified API fetches                                                                                          | Prevents browser HTTP cache double-caching: if Cloudflare's `Cache-Control` allows browser caching, a SW `fetch(request)` without this flag may receive a stale HTTP-cached copy and stamp it fresh. `cache: "no-store"` ensures the SW is the sole freshness arbiter.                                                                                                                   | Bypasses the browser HTTP cache entirely for classified API requests — the SW cache is the only layer. On a SW cache miss, the request always goes to origin (no HTTP-cache short-circuit). Slightly higher latency on first miss vs. serving from HTTP cache.                                                                                                            |
| D-5 | **Cache-first-with-TTL** semantics for all classified families                                                                                 | Simpler than preserving SWR background-revalidation. Current SWR always returned stale cache immediately + revalidated in background. New behavior: within TTL → serve cache; past TTL → block on network, update cache. No background fetch races.                                                                                                                                      | Users on slow networks pay one full RTT when a cached entry expires, instead of instant-stale + silent background refresh. Given TTL minimums (20m for spot/intraday), expired cache is rare in normal browsing sessions. Behavior is the same as `cacheFirst` with expiration, which is what Workbox calls "cache-first with expiration."                                |
| D-6 | Single `annual-spot-history` family keyed on path suffix `/data/spot-history-YYYY.json` regardless of host                                     | Collapses the two existing SW branches (`sw.js:203` for `api.staktrakr.com`, `sw.js:209` for local origin) into one classifier rule with shared semantics (floor: 86400 s, no envelope). `spot.js:697-726` treats both as the same data.                                                                                                                                                 | `staktrakr.com` (the third-party remote fallback at `spot.js:649`) is out of SW scope — the SW cannot intercept third-party origins. Must be documented in the classifier; the `annual-spot-history` family is scoped to `api.staktrakr.com`, `api2.staktrakr.com`, and the local origin only.                                                                            |
| D-7 | Freshness precedence: age measured against `envelope.stale_after ?? family.floor`, age clock is `generated_at` when present else `x-cached-at` | Matches existing `api-health.js:62-118` contract exactly — envelope `generated_at` is the authoritative age origin and `stale_after` the authoritative TTL; constants are fallback only. Avoids two competing freshness clocks (cache-write age vs publisher mint age). Using `min(envelope.stale_after, floor)` would tighten policy beyond the v2 contract and is explicitly rejected. | Floor values become the actual TTL for `annual-spot-history` (no envelope) and as the SW fallback whenever Fly.io omits `stale_after`. Cache-write age becomes the fallback clock only for non-envelope families and for legacy entries. Floor values are derived from publisher cron cadences (verified in discovery OQ-4) so they are never looser than export cadence. |
| D-8 | Opaque response guard in `fetchAndCacheClassified`                                                                                             | `new Response(buffer, { headers })` is rejected for opaque responses. The classified path covers only CORS-mode API hosts so opaque responses should not occur, but the guard is a safety net. If reached, fall back to `cache.put(request, response.clone())` without synthesis.                                                                                                        | An opaque-guarded entry has no `x-cached-at` header; `matchWithAgeCheck` will treat it as stale on every access, effectively making it a no-op cache entry. Acceptable — the guard is a never-expected code path.                                                                                                                                                         |

---

## Endpoint Family Table (the `FAMILY_TABLE` defined in `sw-router.js`)

| Family                 | URL pattern (path-keyed)                                                                                                 | `floor` (s) | `hasEnvelope` | Strategy             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------- | -------------------- |
| `manifest`             | `/v2/manifest.json`                                                                                                      | 1800        | true          | cache-first-with-TTL |
| `spot-latest`          | `/v2/spot/latest.json`                                                                                                   | 1200        | true          | cache-first-with-TTL |
| `spot-history-daily`   | `/v2/spot/<iso>/<yyyy>/<mm>/<dd>.json` (regex: `/\/v2\/spot\/[^/]+\/\d{4}\/\d{2}\/\d{2}\.json$/`)                        | 3600        | true          | cache-first-with-TTL |
| `goldback-latest`      | `/v2/goldback/latest.json`                                                                                               | 90000       | true          | cache-first-with-TTL |
| `retail-latest`        | `/v2/retail/<slug>/latest.json` (regex: `/\/v2\/retail\/[^/]+\/latest\.json$/`)                                          | 1800        | true          | cache-first-with-TTL |
| `retail-intraday`      | `/v2/retail/<slug>/intraday.json` (regex: `/\/v2\/retail\/[^/]+\/intraday\.json$/`)                                      | 1200        | true          | cache-first-with-TTL |
| `retail-history-short` | `/v2/retail/<slug>/history-7d.json` (regex: `/\/v2\/retail\/[^/]+\/history-7d\.json$/`)                                  | 3600        | true          | cache-first-with-TTL |
| `retail-history-long`  | `/v2/retail/<slug>/history-30d.json` or `history-90d.json` (regex: `/\/v2\/retail\/[^/]+\/history-(?:30d\|90d)\.json$/`) | 86400       | true          | cache-first-with-TTL |
| `providers`            | `/v2/providers.json`                                                                                                     | 86400       | true          | cache-first-with-TTL |
| `annual-spot-history`  | `/data/spot-history-YYYY.json` (regex: `/\/data\/spot-history-\d{4}\.json$/`, any in-scope host or local origin)         | 86400       | false         | cache-first-with-TTL |

`spot-history-daily` floor of 3600 s matches the StakTrakr hourly backfill cadence (`js/api.js:142-145`); the publisher emits these files on the same hourly cycle.

Floors are set at publisher export cadence (never looser): sourced from `api-export-v2.js:599-649` and `run-publish.sh`. The `data-pipelines.md` retail "1800 s" value is stale — this table is authoritative.

**Allowed hosts for classification**: `api.staktrakr.com`, `api2.staktrakr.com`. Plus the SW's own `self.location.origin` for `annual-spot-history` path matching. `staktrakr.com` (GitHub Pages remote fallback, third-party origin) is out of scope — SW cannot intercept.

---

## `classifyEndpoint` function shape (in `sw-router.js`)

```
classifyEndpoint(urlString, selfOrigin) → { family, floor, hasEnvelope } | null
```

- `urlString`: absolute URL string (or `Request.url`)
- `selfOrigin`: the SW's `self.location.origin` (passed by sw.js; tests inject a mock origin)
- Returns a family descriptor from `FAMILY_TABLE` if the URL matches; returns `null` for all other URLs (pass-through to existing routing)

Classification logic: check hostname against the allowed API hosts set; if match, classify by `pathname` against the ordered FAMILY_TABLE regex/suffix patterns. If no pathname match on an API host, return `null` (unclassified API request — existing `staleWhileRevalidate` handles it). Additionally check `url.origin === selfOrigin && annualSpotHistoryRegex.test(url.pathname)` for local-origin `annual-spot-history` entries.

---

## Functions added to `sw.js`

| Function                  | Signature                                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `matchWithAgeCheck`       | `(request, family) → Promise<Response\|null>` | Reads cache; computes age from `x-generated-at` when present (envelope families) else from `x-cached-at`; compares against `x-stale-after ?? family.floor`. Returns Response if fresh, null otherwise. Entries lacking both headers are treated as stale.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `fetchAndCacheClassified` | `(request, family) → Promise<Response>`       | Fetches with `{cache:"no-store"}`. If `!response.ok`, returns the upstream response unchanged and does **not** cache it (matches the `fetchAndCache` contract at `sw.js:228-240`). Otherwise reads body via `arrayBuffer()`; for envelope families parses `generated_at` + `stale_after`; synthesizes a new Response preserving upstream `status` and `statusText`, adding `x-cached-at` (always), `x-generated-at` (envelope families with parseable value only), and `x-stale-after` (envelope families with parseable value only). Writes to cache, returns response. Opaque-response guard included — opaque entries pass through without synthesized headers. |
| `classifiedFetch`         | `(request, family) → Promise<Response>`       | Dispatcher: `matchWithAgeCheck` → if fresh return; else `fetchAndCacheClassified`; on network failure fall back to raw `caches.match()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Existing functions untouched:** `fetchAndCache`, `cacheFirst`, `networkFirst`, `staleWhileRevalidate`.

---

## `sw.js` routing change (fetch handler, lines ~202-212)

Current:

```
if (api host) → staleWhileRevalidate(event.request)
if (local spot-history) → staleWhileRevalidate(event.request)
```

New:

```
if (api host) → {
  const family = classifyEndpoint(event.request.url, self.location.origin);
  family ? classifiedFetch(event.request, family) : staleWhileRevalidate(event.request)
}
if (local spot-history) → {
  const family = classifyEndpoint(event.request.url, self.location.origin);
  family ? classifiedFetch(event.request, family) : staleWhileRevalidate(event.request)
}
```

All other routing branches remain unchanged.

---

## SW-internal test instrumentation (temporary)

The Playwright test needs to assert whether a classified request was served from cache or went to network. **Mechanism: `postMessage` round-trip**, not a synthetic fetch route — inventing `/sw-test-state` would be intercepted by the local-asset SWR catch-all at `sw.js:221-223` and become indistinguishable from a normal asset request.

Interface (pinned here; implementation is a task-phase detail):

- Inside `sw.js`, a module-scoped variable `lastStrategy` (NOT `self.__SW_LAST_STRATEGY` — avoid global pollution) is set by `classifiedFetch` to `"cache-hit"`, `"network"`, or `"network-fallback"` before returning. Scoped to the classified path only; unclassified requests do not touch it.
- The SW adds a `message` listener that responds to `event.data?.type === "__sw_test_state__"` by calling `event.source.postMessage({ type: "__sw_test_state__", lastStrategy })`. Only this message type is handled — no general RPC surface.
- The Playwright test posts the message via `navigator.serviceWorker.controller.postMessage(...)` and awaits the reply through a `navigator.serviceWorker.addEventListener('message', ...)` promise. The test serializes assertions (one request → one read) to avoid a race where two classified requests overlap before the test reads the variable.

---

## `market-data.js` single-homed gap (architectural note)

`js/market-data.js:5` hardcodes `const V2_API = "https://api.staktrakr.com/data/v2"` and never iterates `V2_API_ENDPOINTS` or calls `_staktrakrFetch`. Manifest, goldback, and retail detail/history/intraday fetches from `market-data.js` have no failover to `api2.staktrakr.com`. The SW classifier handles both hosts correctly, but it cannot compensate for this gap — if `api.staktrakr.com` is down, these fetches fail regardless of `api2` health. This is a pre-existing architectural limitation, not introduced by this sketch. Documented here; the follow-up issue is listed below.

---

## File Map

### New

- `sw-router.js` — pure `classifyEndpoint(url, selfOrigin)` + `FAMILY_TABLE`; CJS guard for Node `require`
- `tests/unit/sw-router.test.js` — Node unit tests covering all 9 families × host variants (primary, failover, local origin, third-party-excluded)
- `tests/playwright/sw-caching.spec.js` — Playwright SW-enabled integration test; verifies cache-hit, expired, and miss paths using `test.use({ serviceWorkers: "allow" })` + `python3 -m http.server`

### Modified

- `sw.js` — (1) `importScripts("sw-router.js")` at top; (2) api-host and local-spot-history dispatch blocks updated to try `classifyEndpoint` first, fall through on null; (3) `matchWithAgeCheck`, `fetchAndCacheClassified`, `classifiedFetch` added; (4) module-scoped `lastStrategy` variable + `message` listener for `__sw_test_state__` test-instrumentation message

### Deleted

- _None_ — existing `fetchAndCache`, `cacheFirst`, `networkFirst`, `staleWhileRevalidate` remain untouched.

---

## Data / Schema Changes

Cache Storage entries for classified endpoints gain up to three synthesized response headers:

- `x-cached-at` — epoch milliseconds (string) at time of cache write. Always present on classified, OK-status entries.
- `x-generated-at` — envelope `generated_at` value in seconds (string), present only when `hasEnvelope: true` and the response body contained a numeric `generated_at` field. This is the authoritative age origin (matches `api-health.js:61-110`).
- `x-stale-after` — envelope `stale_after` value in seconds (string), present only when `hasEnvelope: true` and the response body contained a numeric `stale_after` field.

Read-side age computation falls back gracefully: `x-generated-at` (envelope families) → `x-cached-at` (non-envelope families like `annual-spot-history`, plus legacy entries with neither) → treat as stale. Legacy cached entries without `x-cached-at` AND without `x-generated-at` are refreshed on next access. In practice, the `CACHE_NAME` version-purge on activate flushes the entire cache on each release, so legacy entries are expected only during a browser session that spans the feature deploy without a page reload.

No changes to localStorage, sessionStorage, IndexedDB, or any app-level data structures.

---

## Tradeoffs Surfaced for Review

1. **SWR timing model change.** Existing `api.staktrakr.com` requests returned stale cache immediately while revalidating in background. New behavior blocks on network when TTL expires (cache-first-with-TTL is closer to networkFirst-when-stale). Users on slow networks pay one RTT after an entry expires. TTL minimums are 20 m (spot/intraday), so expiry events are rare in normal browsing. Worth flagging because the UX contract changes subtly.

2. **`arrayBuffer()` parse on every cache write for classified endpoints.** Adds a JSON parse cost at write time for envelope families. Bodies are typically small (< 50 kB); the network fetch itself dominates. Acceptable, but noted.

3. **`{cache: "no-store"}` bypasses browser HTTP cache entirely for classified fetches.** If Cloudflare or GitHub Pages already provides good HTTP-level caching, this wastes that layer for classified endpoints. The SW cache is the sole freshness arbiter. This is intentional (prevents double-caching) but means slightly higher origin load on SW cache misses.

4. **`self.__SW_LAST_STRATEGY` test instrumentation.** A global mutation inside the SW is unconventional and slightly pollutes the SW namespace. Acceptable for test coverage; a follow-up can remove it after the test stabilizes.

---

## Out of Scope (follow-up issues)

- **`js/market-data.js` single-homed v2 traffic** — all manifest, goldback, and retail-detail fetches from `market-data.js` use hardcoded `api.staktrakr.com` and have no `api2` failover. This is a separate architectural gap, not introduced by this sketch. File a STRK issue to migrate `market-data.js` to `_staktrakrFetch` / `V2_API_ENDPOINTS`.
- **`data-pipelines.md` stale retail TTL values** — the Foundation doc still shows "Retail 1800 s" which flattens all retail sub-endpoints. Should be updated to reflect per-endpoint TTLs from `api-export-v2.js`. DocVault housekeeping; can be done during `/vault-update` in the closing tasks.
- **`staktrakr.com` remote spot-history out of SW scope** — `spot.js:649` falls back to `staktrakr.com/data/` (third-party origin; SW cannot intercept). If this fallback path needs caching, it requires a separate approach (e.g., pre-fetching into a local cache during SW install). Not addressed here.

---

## Risk Notes

- **Non-OK responses are passed through, never cached.** `fetchAndCacheClassified` returns 4xx/5xx upstream responses to the caller unchanged and does not stamp them with `x-cached-at`/`x-generated-at`/`x-stale-after`. This matches the existing `fetchAndCache` contract at `sw.js:228-240` so error responses cannot accidentally be cached as 200s with synthesized freshness headers.
- **`new Response(buffer, {headers})` loses `Response.url` and sets `type: "default"`** — mitigated by GEMINI's verification in discovery that no existing code reads `.url` from a cached classified response. Synthesis is scoped to classified endpoints only (not all cache writes), and only to OK responses.
- **Opaque response guard** — the classified path covers CORS-enabled API hosts, so opaque responses should never be reached. The guard's fallback (write raw response, no `x-cached-at`) means that entry is treated as stale on every subsequent read, effectively a cache bypass for that URL. Acceptable safety net.
- **Legacy cache entries treated as stale on first post-deploy access** — one cold network hit per classified URL per browser session that spans the deploy. Mitigated by the fact that `CACHE_NAME` version-purge on activate already clears all caches on every release; legacy entries should not exist after a SW activation cycle.
- **Fly.io manifest rebuild cadence** — manifest is exported by `run-publish.sh` every 15 min (`8,23,38,53 * * * *`). SW floor of 30 m is safe, but if Fly.io is down, the manifest stops updating regardless of SW policy. Known SPOF; out of scope for this sketch.
- **`lastStrategy` test instrumentation race** — if two classified requests overlap, the module-scoped variable may reflect the second request when the Playwright test reads it via `postMessage`. Mitigation: tests serialize classified requests; assert one at a time. Task-phase detail.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch review STRK-79 approach`, then `/sketch tasks STRK-79`.

## Review Archive — approach (2026-05-15)

_Reconciled by /sketch reconcile on 2026-05-15. Original reviewer marks preserved below for audit._

### Codex

#### CODEX Review (2026-05-15)

**Verified**

- Current SW routing sends `api.staktrakr.com` / `api2.staktrakr.com` and local `/data/spot-history` requests through `staleWhileRevalidate` (`sw.js:202-211`), while the reusable strategies and cache-write helper live at `sw.js:227-282`.
- Cache activation purges old `staktrakr-*` caches by `CACHE_NAME` (`sw.js:140-152`), matching the approach's outer-ceiling claim.
- v2 freshness today is envelope-based: `api-health.js:61-69`, `api-health.js:82-90`, and `api-health.js:101-110` compare `generated_at` age against `stale_after`; `devops/pollers/shared/v2-utils.js:77-83` emits those fields.
- API host constants are exactly `https://api.staktrakr.com/data/v2` and `https://api2.staktrakr.com/data/v2` in `js/constants.js:531-538`.
- Spot latest uses `_staktrakrFetch(V2_API_ENDPOINTS, "/spot/latest.json")` (`js/api.js:68-70`), and hourly backfill also fetches `/spot/{iso}/{yyyy}/{mm}/{dd}.json` (`js/api.js:142-145`).
- Annual spot-history restore reads local `data/spot-history-YYYY.json` first, then API-root `/spot-history-YYYY.json` through `_staktrakrFetch` (`js/api.js:2950-2979`).
- Retail v2 sync chooses one API base from the manifest, fetches `providers.json`, then per-slug latest/intraday/history-7d/history-30d/history-90d (`js/retail.js:639-668`, `js/retail.js:758-827`).
- `market-data.js` is single-homed on `https://api.staktrakr.com/data/v2` for manifest, retail detail/history/intraday, and goldback fetches (`js/market-data.js:5`, `js/market-data.js:96`, `js/market-data.js:513-531`, `js/market-data.js:970`, `js/market-data.js:1403`).
- Poller/export TTLs match most table values: retail latest 1800, intraday 1200, history-7d 3600, history-30d/90d 86400 (`devops/pollers/shared/api-export-v2.js:599-649`), providers 86400 (`devops/pollers/shared/api-export-v2.js:927-936`), and publish cadence is 8/23/38/53 minutes hourly (`devops/pollers/remote-poller/run-publish.sh:5`, `devops/pollers/remote-poller/run-publish.sh:33-40`).
- Playwright globally blocks service workers (`playwright.config.js:9-12`), with an existing per-test allow precedent in `tests/playwright/font-loading.spec.js:41-50`.

**Top concerns**

1. The proposed TTL check uses cache-write age, not envelope `generated_at` age, so it can bless already-stale publisher data as fresh after any successful fetch.
2. The endpoint family table omits live `/v2/spot/{iso}/{yyyy}/{mm}/{dd}.json` backfill requests even though requirements framed in-scope API coverage broadly.
3. The synthesized-response helper needs an explicit `response.ok` / status-preservation contract before tasks are written, or non-OK responses can accidentally become cached 200s.

**Unverified assumptions**

- The author assumes SW freshness may be measured from `x-cached-at`; live health code measures from envelope `generated_at`.
- The author assumes the nine listed endpoint families cover the in-scope surface; live hourly spot backfill suggests at least one additional family or an intentional exclusion is needed.
- The author assumes `new Response(buffer, { headers })` is behaviorally equivalent enough to the original response; status, statusText, redirected, and url semantics are not fully specified.
- The author assumes task-phase test instrumentation can be deferred; the current `/sw-test-state` sketch has no matching service-worker route.
- The author assumes stale-on-network-failure is acceptable for all classified families, including ones whose envelope may already report stale data.
- The author assumes `api2` classification helps all market API reads; `market-data.js` remains single-homed, so that benefit does not apply to its current fetches until a follow-up changes the caller.

### Qwen

#### QWEN Review (2026-05-15)

**Verified**

- `sw.js:221-223` handles "other local assets" via `staleWhileRevalidate`; there is no `/sw-test-state` route anywhere in the service worker.
- `playwright.config.js:11` sets `serviceWorkers: "block"` globally, so any Playwright test asserting SW behavior must explicitly override with `test.use({ serviceWorkers: "allow" })`.
- `js/constants.js:531-538` defines `V2_API_ENDPOINTS` with exactly two hosts (`api.staktrakr.com`, `api2.staktrakr.com`), confirming the classifier's allowed-host set.
- `js/api.js:68-70` uses `_staktrakrFetch` for spot latest, which iterates both API hosts; `js/api.js:142-145` uses the same pattern for hourly backfill.
- `js/retail.js:639-668` and `js/retail.js:758-827` confirm retail sync fetches per-slug latest, intraday, history-7d, history-30d, and history-90d from a single chosen API base.
- `devops/pollers/shared/v2-utils.js:77-83` wraps responses with `generated_at` and `stale_after` in the v2 envelope.
- `js/api-health.js:61-69`, `js/api-health.js:82-90`, `js/api-health.js:101-110` all compute freshness as `(Date.now() - generated_at) / 1000 < stale_after`, not from cache-write time.

**Top concerns**

1. **Observability mechanism is underspecified.** The approach mentions `fetch('/sw-test-state')` as a possible test-read path, but no such route exists. The fallback at `sw.js:221-223` would intercept it via `staleWhileRevalidate`, making it indistinguishable from a normal asset request. Use `postMessage` or a `MessageChannel` to the SW instead of inventing a synthetic route. This should be decided in approach so tasks can implement a concrete mechanism.
2. **`x-cached-at` vs `generated_at` freshness mismatch.** The approach stores freshness at cache-write time (`x-cached-at`), but the live v2 health policy (`api-health.js`) measures freshness from the envelope's `generated_at`. These are semantically different: a stale publisher response fetched after an outage would be treated as fresh for another full TTL under the proposed scheme. Either store the envelope's `generated_at` alongside `x-cached-at` and check both, or explicitly state that SW freshness intentionally diverges from the app health policy.
3. **Missing `spot-history-daily` family.** `/v2/spot/{iso}/{yyyy}/{mm}/{dd}.json` is a live endpoint fetched during hourly backfill (`js/api.js:142-145`). It is not in the FAMILY_TABLE and will fall through to `staleWhileRevalidate`. If this is intentional, document it as an explicit exclusion; if not, add a `spot-history-daily` family with an appropriate floor (likely 3600 s, matching the hourly backfill cadence).

**Unverified assumptions**

- The author assumes `postMessage`/`MessageChannel` is acceptable for test instrumentation; this is recommended but not yet confirmed as the chosen mechanism.
- The author assumes `response.ok` gating in `fetchAndCacheClassified` will match the existing `fetchAndCache` contract (`sw.js:228-240`), but the approach does not explicitly state this.
- The author assumes the `annual-spot-history` family's 86400 s floor is safe for both local-origin and API-host variants; local files may be served from disk with no network latency, making the TTL less relevant.
- The author assumes `matchWithAgeCheck` will only be called from `classifiedFetch`; if a future change calls it on non-classified paths, legacy entries would always appear stale, subtly changing cache behavior.
- The author assumes documented retail TTL drift can be fixed as closing-task housekeeping, but multiple Foundation/API docs still present flattened retail thresholds and may keep misleading future reviewers.

### Resolution Summary

- Accepted: 4
  - Freshness clock switched to envelope `generated_at` with `x-cached-at` fallback (CODEX + QWEN consensus).
  - `spot-history-daily` family added to FAMILY_TABLE (CODEX + QWEN consensus).
  - `fetchAndCacheClassified` contract explicitly preserves `status`/`statusText` and only caches `response.ok` (CODEX line 84, QWEN unverified assumption).
  - D-2 + high-level wording rewritten: classified path bypasses the strategy functions; strategy bodies remain untouched (CODEX line 36).
- Rejected: 3 (all already addressed elsewhere in approach.md)
  - `api2` benefit limited by `market-data.js` single-homing — already documented at approach.md "single-homed gap" section and Out-of-Scope follow-ups.
  - `matchWithAgeCheck` called from non-classified paths — already addressed in D-2 tradeoff column.
  - `data-pipelines.md` retail TTL drift — already listed as Out-of-Scope follow-up.
- Resolved with your input: 1
  - Test instrumentation mechanism: `postMessage` round-trip with module-scoped `lastStrategy` (not a synthetic fetch route, not a global). Approved by user inline before edit.
