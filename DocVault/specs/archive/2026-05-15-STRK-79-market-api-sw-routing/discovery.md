---
sketch: "STRK-79-market-api-sw-routing"
phase: discovery
created: 2026-05-15
---

# STRK-79 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path                                                             | Role                                                         | Notes                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sw.js:7`                                                        | `CACHE_NAME` — versioned per release                         | Auto-stamped by `devops/hooks/stamp-sw-cache.sh`. Whole-cache purge on activate (`sw.js:147`) keys off this string — the only expiration mechanism in the live code.                                                                                                                                                                |
| `sw.js:117`                                                      | `API_HOSTS` constant                                         | Network-first list (`metalpriceapi`, `metals-api`, `gold-api`, `numista`). StakTrakr's own host is NOT in this list — handled below.                                                                                                                                                                                                |
| `sw.js:120`                                                      | `CDN_HOSTS` constant                                         | SWR list (cdnjs, jsdelivr, unpkg).                                                                                                                                                                                                                                                                                                  |
| `sw.js:147`                                                      | Version-prefix purge on activate                             | `keys.filter(k => k.startsWith("staktrakr-") && k !== CACHE_NAME)` — effectively the only TTL mechanism today (max age = until next release).                                                                                                                                                                                       |
| `sw.js:156-225`                                                  | `fetch` event handler                                        | Ordered host/path routing. OAuth-callback bypass at `:162`, API_HOSTS at `:165`, CDN_HOSTS at `:171`, navigate at `:177`, **`api.staktrakr.com` / `api2.staktrakr.com` SWR at `:202-205`**, local `/data/spot-history` SWR at `:209`, local `.js`/`.css` network-first at `:215`, other local SWR at `:221`.                        |
| `sw.js:228-241`                                                  | `fetchAndCache(request)`                                     | Shared helper. `cache.put(request, clone)` writes the response verbatim — no envelope/age metadata. Any age-gate mechanism that lives "inside the cache" routes through here.                                                                                                                                                       |
| `sw.js:253-282`                                                  | `cacheFirst` / `networkFirst` / `staleWhileRevalidate`       | All three serve from `caches.match()` with **zero age inspection**. Confirms requirements' core defect.                                                                                                                                                                                                                             |
| `js/constants.js:531-538`                                        | `V2_API_ENDPOINTS`                                           | Ordered: `https://api.staktrakr.com/data/v2`, `https://api2.staktrakr.com/data/v2`. Both hosts are real traffic — failover, not legacy.                                                                                                                                                                                             |
| `js/api.js:36-60`                                                | `_staktrakrFetch(urls, path)`                                | Iterates `V2_API_ENDPOINTS` with 5 s `AbortController` timeout per host. Primary → backup transition is failure-driven, not user-visible — both hosts must inherit the same per-family policy or the failover changes cache behavior.                                                                                               |
| `js/api.js:2970-2973`                                            | `apiBaseUrls` construction                                   | Derives data-root URLs by stripping `/v2` from `V2_API_ENDPOINTS`, with a fallback to `API_PROVIDERS.STAKTRAKR.baseUrl`. `api2.staktrakr.com` URLs hit `sw.js:203` identically to primary.                                                                                                                                          |
| `js/api.js:2978`                                                 | `_staktrakrFetch(apiBaseUrls, "/spot-history-${year}.json")` | Annual archive via API host. **No v2 envelope** — endpoint returns a bare array. `stale_after` does not apply.                                                                                                                                                                                                                      |
| `js/market-data.js:5`                                            | `V2_API` hardcoded constant                                  | `"https://api.staktrakr.com/data/v2"` — **never uses `V2_API_ENDPOINTS` or `_staktrakrFetch`**. All manifest, goldback, and retail detail/history/intraday fetches from `market-data.js` are single-homed to `api.staktrakr.com` and never hit `api2.staktrakr.com`.                                                                |
| `js/market-data.js:96`                                           | Manifest fetch (`/v2/manifest.json`)                         | v2 envelope with `stale_after` per `js/api-health.js:56-66`.                                                                                                                                                                                                                                                                        |
| `js/market-data.js:513-531`                                      | Detail / history-30d / intraday fetches per slug             | `/v2/retail/<slug>/latest.json`, `/v2/retail/<slug>/history-30d.json`, `/v2/retail/<slug>/intraday.json`. All v2 envelopes.                                                                                                                                                                                                         |
| `js/market-data.js:1403`                                         | Goldback fetch (`/v2/goldback/latest.json`)                  | v2 envelope.                                                                                                                                                                                                                                                                                                                        |
| `js/retail.js:640-656`                                           | `_pickFreshestV2Endpoint()`                                  | Selects first healthy V2 base via manifest fetches — drives all retail v2 traffic through `V2_API_ENDPOINTS` (unlike `market-data.js`).                                                                                                                                                                                             |
| `js/retail.js:765-774`                                           | `/providers.json` fetch                                      | Fetches `/providers.json` from the selected v2 base. v2 envelope shape: `{ v, generated_at, stale_after, data }`. Publisher `stale_after` = 86400 s.                                                                                                                                                                                |
| `js/retail.js:818-825`                                           | Per-slug retail fetches                                      | Five endpoints per slug: `latest.json`, `intraday.json`, `history-7d.json`, `history-30d.json`, `history-90d.json`. All v2 envelopes with distinct publisher TTLs (see OQ-4).                                                                                                                                                       |
| `js/spot.js:697-726`                                             | Annual spot-history loader — 3-tier fallback                 | `fetch("data/spot-history-${year}.json")` (origin-local) → `xhrLoadJSON` (file:// path) → `fetch("https://staktrakr.com/data/spot-history-${year}.json")` (third-party remote). First tier hits `sw.js:209`; third tier (`staktrakr.com`) is a third-party origin the SW cannot intercept. Nothing hits `sw.js:203` from `spot.js`. |
| `js/seed-data.js:8011`                                           | Bundled spot history (script-tag global)                     | Primary load: `data/spot-history-bundle.js` is a `<script>` tag, pre-cached in `CORE_ASSETS` at `sw.js:96` — bypasses the SW `fetch()` handler. The `fetch()` at `:8011` is a **fallback only** (runs when bundle cache is empty) and IS origin-local, routing through `sw.js:209`. The new age-gate applies to this fallback path. |
| `js/api-health.js:8-10`                                          | Fallback stale constants                                     | `API_HEALTH_MARKET_STALE_MIN = 30`, `API_HEALTH_SPOT_STALE_MIN = 20`, `API_HEALTH_GOLDBACK_STALE_MIN = 25 * 60`. Used only when envelope `stale_after` is absent.                                                                                                                                                                   |
| `js/api-health.js:56-118`                                        | v2 envelope freshness consumer                               | Pattern: `typeof envelope.stale_after === "number" ? Math.ceil(envelope.stale_after / 60) : <FALLBACK_CONST>`. **Envelope wins when present; constant is fallback only** (not a floor). De-facto contract the SW must align with: `envelope.stale_after ?? SW_FAMILY_FLOOR`.                                                        |
| `devops/pollers/home-poller/docker-entrypoint.sh:29-33`          | Home poller cron                                             | Retail `30 * * * *` (hourly, :30), spot `15,45 * * * *` (twice/hour), goldback `5 16 * * *` (daily 16:05 UTC), providers `*/5 * * * *` (every 5 min). **Writes to Turso only — never exports JSON files.**                                                                                                                          |
| `devops/pollers/remote-poller/run-publish.sh`                    | v2 JSON export                                               | Runs on Fly.io at `8,23,38,53 * * * *` (every 15 min). Invokes `api-export-v2.js` — the only process that writes v2 JSON files (including the manifest).                                                                                                                                                                            |
| `devops/pollers/shared/api-export-v2.js:599-649`                 | Publisher-side `stale_after` per retail endpoint             | `latest.json` 1800 s; `intraday.json` 1200 s; `history-7d.json` 3600 s; `history-30d.json` 86400 s; `history-90d.json` 86400 s; `providers.json` 86400 s (`:936`).                                                                                                                                                                  |
| `DocVault/Projects/StakTrakr/Foundation/data-pipelines.md:55-64` | Documented `stale_after` per family                          | Spot 1200 s (20 m), Retail 1800 s (30 m, **stale — flattens sub-endpoints**), Goldback 90000 s (25 h), Manifest 1800 s (30 m). Use `api-export-v2.js` as authoritative source for retail sub-endpoint TTLs.                                                                                                                         |
| `playwright.config.js:9-12`                                      | Test harness baseline                                        | `serviceWorkers: "block"` globally. SW tests require per-spec opt-in.                                                                                                                                                                                                                                                               |
| `tests/playwright/font-loading.spec.js:41-50`                    | SW-enabled test precedent                                    | `test.use({ serviceWorkers: "allow" });` plus `python3 -m http.server` baseURL. Reusable shape for the SW integration test required by requirements AC-4.                                                                                                                                                                           |

## Prior Decisions

- **2025 — Envelope-first freshness for v2 endpoints.** `js/api-health.js:56-118` and `js/retail.js:774` consume envelope `stale_after`, with `API_HEALTH_*_STALE_MIN` constants as the fallback path. DocVault `data-pipelines.md:55-64` documents publisher-side TTLs (spot/goldback values correct; retail value stale — use `api-export-v2.js` as authoritative). The v2 contract is `envelope.stale_after ?? SW_FAMILY_FLOOR` — envelope wins when present, constant is fallback only. Any SW table must follow the same pattern to avoid two competing freshness clocks.
- **STRK / `CACHE_NAME` versioning.** `devops/hooks/stamp-sw-cache.sh` stamps `CACHE_NAME` on every JS/CSS/image commit, so a release effectively flushes the entire SW cache. New per-family TTLs operate beneath this ceiling — requirements AC-2 already captures the precedence.
- **Dual-host spot-history is intentional.** `spot.js:697-726` documents the 3-tier fallback chain in its comments ("Fallback 1: XHR for file://", "Fallback 2: remote staktrakr.com"). The two SW paths (`sw.js:203` for `api.staktrakr.com/data/...`, `sw.js:209` for origin `/data/...`) are an artifact of host topology, not of distinct data semantics.
- **No prior mem0 entry on SW routing policy.** First time touching the per-family SW layer; only adjacent precedent is the cache-version stamping hook and the envelope-first health check.

## External References

- [MDN — Cache API: `Response.headers`](https://developer.mozilla.org/en-US/docs/Web/API/Cache) — confirms `cache.put` stores Response headers verbatim, so a synthesized `x-cached-at` header survives round-trips and is readable on retrieval.
- [MDN — `Date` request/response header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Date) — GitHub Pages emits `Date` on every response, but the Cloudflare edge in front of `api.staktrakr.com` may rewrite or strip it; reliance on `Date` for age-gating is fragile across the four hosts in scope.
- [Workbox `ExpirationPlugin`](https://developer.chrome.com/docs/workbox/modules/workbox-expiration) — pattern reference only. StakTrakr's "no build step, no bundler, no third-party SW library" non-goal rules out adopting Workbox itself; the design pattern (entry-age check before serving from cache, prune on threshold) is portable.

## Constraints

- **Zero-build / vanilla JS** — no Workbox, no bundler. The classifier and age-gate must be implementable inside `sw.js` with hand-written JS.
- **Script-tag globals** — `sw.js` does not import from `js/constants.js`; any list that needs to stay in sync (e.g., `V2_API_ENDPOINTS`, family TTL table) lives inside `sw.js` itself or is duplicated.
- **`_staktrakrFetch` failover semantics** — primary→backup transition is opaque to the SW (each host is a separate `Request`). `api.staktrakr.com` and `api2.staktrakr.com` must therefore share policy keyed on the URL **path**, not the host.
- **Annual spot-history has no envelope** — bare JSON array, no `stale_after`. Envelope-first precedence rule must define a non-envelope branch.
- **`seed-data.js` primary load bypasses SW** — the `<script>` tag load of `data/spot-history-bundle.js` (pre-cached in `CORE_ASSETS`) bypasses the SW `fetch()` handler. The `fetch()` fallback at `:8011` is origin-local and routes through `sw.js:209` — the age-gate applies to this fallback path.
- **Playwright SW block-by-default** — `serviceWorkers: "block"` in `playwright.config.js:11`. The AC-4 integration test must opt in per-spec using the `font-loading.spec.js` precedent.
- **Cloudflare edge in front of `api.staktrakr.com`** — `Date` and `Cache-Control` headers may be rewritten by the edge; the age-gate mechanism should not depend on origin-server-controlled response headers.
- **`fetchAndCache` is the single write point** — `sw.js:228-241`. Any mechanism that wraps cache entries needs to refactor this one helper; nothing else writes to the cache.
- **`js/market-data.js` is single-homed** — hardcodes `V2_API = "https://api.staktrakr.com/data/v2"` at `:5` and never uses `V2_API_ENDPOINTS` or `_staktrakrFetch`. Manifest, goldback, and retail detail/history/intraday fetches from `market-data.js` have no failover to `api2.staktrakr.com`. The SW classifier handles both hosts correctly but cannot compensate for this gap — approach.md must document it.
- **Opaque response guard** — `fetchAndCache` handles ALL cache writes, including CDN assets and no-cors requests which may be opaque (`response.type === "opaque"`). Constructing `new Response` from an opaque body is rejected by the browser. Header synthesis must be skipped for opaque responses.
- **`x-cached-at` synthesis loses `Response.url`** — `new Response(body, { headers })` produces a response with empty `url` and `type: "default"`. Scope synthesis to classified API endpoint responses only; do not wrap all cached responses globally.
- **Browser HTTP cache double-caching** — if Cloudflare's `Cache-Control` allows browser-level caching of API responses, SW `fetch(request)` may receive a stale HTTP-cached copy and stamp it with a fresh `x-cached-at`. Approach.md must decide whether to set `{ cache: "no-store" }` on classified API fetches.

## Open Questions

_All five blocking questions from requirements.md are resolved here. Approach.md will commit to concrete numbers and a file map._

- [x] **OQ-1 — Freshness authority precedence.** **Resolved: envelope `stale_after` is primary; SW family table is fallback only (`envelope.stale_after ?? SW_FAMILY_FLOOR`).** Evidence: `js/api-health.js:56-118` already treats envelope `stale_after` as authoritative with a hard-coded fallback per family. The SW must follow the same `envelope ?? floor` pattern — deliberately matching `js/api-health.js:62-118` — to avoid two competing freshness clocks. Approach.md must **not** use `min(envelope.stale_after, SW_FAMILY_FLOOR)`; that would create a new stricter policy diverging from the existing app freshness contract. The annual spot-history endpoint has no envelope, so it always uses the family floor.

- [x] **OQ-2 — Age-gate mechanism.** **Resolved: wrap each cached response with an `x-cached-at` header inside a refactored `fetchAndCache`.** Compared:
  - (a) **Sidecar timestamp index (IndexedDB/localStorage).** Two storage systems; cleanup and version-purge become bimodal; one more place to drift. Rejected on complexity.
  - (b) **Cached `Response.headers.get("Date")`.** Fragile — the Cloudflare edge in front of `api.staktrakr.com` may rewrite/strip `Date`, and origin-local GitHub Pages emits a `Date` but its value depends on edge cache behavior. Different reliability across the four in-scope hosts. Rejected on portability.
  - (c) **Wrap response with `x-cached-at` synthesized inside `fetchAndCache`.** Self-contained — all TTL state lives inside the existing Cache Storage API; version-purge invalidates everything in one operation; testable as a pure helper. Refactor is local to `sw.js:228-241`. Selected.

  **Read-side implementation** is a design decision for approach.md: options are (a) a new `matchWithAgeCheck()` helper called by all three strategy functions instead of raw `caches.match()`, or (b) age-gate logic baked individually into `cacheFirst`, `networkFirst`, and `staleWhileRevalidate` (`sw.js:253-282`). Option (a) is the cleaner factoring — one read-side change point.

- [x] **OQ-3 — Dual spot-history unification.** **Resolved: single `annual-spot-history` family, matched by URL pathname suffix `/data/spot-history-YYYY.json` regardless of host.** Evidence: `spot.js:697-726` already treats both as logically the same data; the host difference is fallback topology, not semantics. The classifier should normalize on path, returning the same family/strategy/TTL for both. This collapses two SW branches (`sw.js:203` and `sw.js:209`) into one classifier rule.

  `staktrakr.com` (the `HISTORICAL_DATA_REMOTE` fallback at `spot.js:649`) is a third-party origin — the SW cannot intercept third-party requests. It is **explicitly out-of-scope**. The `annual-spot-history` family covers only paths from interceptable hosts: `api.staktrakr.com`, `api2.staktrakr.com`, and origin-local.

- [x] **OQ-4 — Concrete TTL floor values, derived from publisher cadence.** Approach.md picks the final numbers from this verified set (source: `api-export-v2.js:599-649`, `run-publish.sh`):

  | Family               | Pattern (path-keyed)                                                   | Export cadence                              | `stale_after` (envelope) | SW floor |
  | -------------------- | ---------------------------------------------------------------------- | ------------------------------------------- | ------------------------ | -------- |
  | manifest             | `/v2/manifest.json`                                                    | Fly.io, every 15 min (`8,23,38,53 * * * *`) | 1800 s (30 m)            | 30 m     |
  | spot-latest          | `/v2/spot/latest.json`                                                 | 4×/hr (home poller)                         | 1200 s (20 m)            | 20 m     |
  | goldback-latest      | `/v2/goldback/latest.json`                                             | daily 16:05 UTC                             | 90000 s (25 h)           | 25 h     |
  | retail-latest        | `/v2/retail/<slug>/latest.json`                                        | hourly (:30)                                | 1800 s (30 m)            | 30 m     |
  | retail-intraday      | `/v2/retail/<slug>/intraday.json`                                      | hourly                                      | 1200 s (20 m)            | 20 m     |
  | retail-history-short | `/v2/retail/<slug>/history-7d.json`                                    | hourly                                      | 3600 s (60 m)            | 60 m     |
  | retail-history-long  | `/v2/retail/<slug>/history-30d.json`, `history-90d.json`               | daily (append-only)                         | 86400 s (24 h)           | 24 h     |
  | providers            | `/v2/providers.json`                                                   | Fly.io, every 15 min                        | 86400 s (24 h)           | 24 h     |
  | annual-spot-history  | `/data/spot-history-YYYY.json` (path-suffix; interceptable hosts only) | append-only after year close                | _none — bare array_      | 24 h     |

  All recommended floors are **no looser than export cadence** per requirements AC-1; envelope `stale_after` tightens where present. The `data-pipelines.md` "Retail 1800 s" value is stale — use `api-export-v2.js` as authoritative.

- [x] **OQ-5 — api2 failover policy.** **Resolved: api2 inherits primary host's per-family policy via path-keyed classifier.** The classifier dispatches on `url.pathname` and ignores host (after confirming host ∈ `{api.staktrakr.com, api2.staktrakr.com}`). `staktrakr.com` is a third-party origin and is **not** in this host set. No tightened TTL on the failover — both hosts serve the same publisher snapshots. The existing `_staktrakrFetch` failover behavior at `js/api.js:36-60` (5 s timeout per host) remains the recovery path.

  Note: `js/market-data.js:5` hardcodes `V2_API = "https://api.staktrakr.com/data/v2"` and never iterates `V2_API_ENDPOINTS`. All manifest, goldback, and retail detail/history/intraday fetches from `market-data.js` are single-homed — no failover to `api2.staktrakr.com`. The SW classifier handles both hosts but cannot compensate for this gap. Approach.md should document this architectural limitation explicitly.

## Discovery Summary

The work lands in `sw.js` — the new path-keyed classifier, family-floor table, and `x-cached-at` age-gate all fit inside the existing file. One new test surface (pure `classifyEndpoint(url)` extracted for Node-level unit tests) plus one Playwright spec modeled on `font-loading.spec.js:41-50`. Two equally significant implementation surfaces: (1) the `fetchAndCache` write-side refactor at `sw.js:228-241` — wrapping responses with `x-cached-at`, scoped to classified API endpoints only, guarded for opaque responses; (2) the read-side age-gate — approach.md must resolve whether this is a new `matchWithAgeCheck()` helper or per-strategy modifications to the three functions at `sw.js:253-282`. What's already easy: envelope `stale_after` precedence is the documented v2 contract, so the policy is alignment (`envelope ?? floor`), not invention; the dual spot-history collapse is mechanical once the classifier keys on pathname.

**Approach.md must specify the `classifyEndpoint` extraction strategy.** `sw.js` currently has no module boundary. Options: (a) a new pure JS helper module imported via `importScripts`, (b) a guarded ESM export from `sw.js`, (c) Playwright-only testing with the classifier staying inline.

---

## Review Archive — discovery (2026-05-15)

_Reconciled by /sketch reconcile on 2026-05-15. Original reviewer marks preserved below for audit._

### QWEN

**Inline marks:**

> QWEN: **Line reference is wrong.** Lines 141-150 are the batch historical spot-data fetch loop (`_staktrakrFetch(V2_API_ENDPOINTS, path)` for per-day ISO keys). The actual `apiBaseUrls` construction is at `js/api.js:2970-2973` — it derives data-root URLs by stripping `/v2` from `V2_API_ENDPOINTS`, with a fallback to `API_PROVIDERS.STAKTRAKR.baseUrl`. The behavioral claim (api2 hits sw.js:203 identically) is correct, but the file pointer should be `js/api.js:2970-2973`.

> QWEN: **Line range is slightly off.** The 3-tier fallback chain itself is `js/spot.js:697-726` (`fetch(localUrl)` → `.catch(xhrLoadJSON)` → `.catch(fetch(remoteUrl))`). Lines 648-697 cover the `HISTORICAL_DATA_REMOTE` constant (`:649`), `xhrLoadJSON` helper (`:658-672`), and the `fetchYearFile` function header (`:682`). The claim that "nothing hits sw.js:203 from spot.js" is correct — `spot.js` only hits origin-local `data/` (caught by sw.js:209) or the remote `staktrakr.com/data/` (not caught by any api.staktrakr.com branch).

> QWEN: **Partially correct but imprecise.** The script-tag bundle (`data/spot-history-bundle.js`, pre-cached in `CORE_ASSETS` at `sw.js:96`) does bypass the SW fetch handler. However, `seed-data.js:8011` is a **fallback fetch** (`fetch("data/spot-history-" + year + ".json")`) that runs only when the bundle cache is empty — and this fetch IS origin-local, so it routes through `sw.js:209` (the `/data/spot-history` SWR branch). The "bypasses SW entirely" claim is true for the primary script-tag load path but not for the seed-data.js fetch fallback. This matters because the new age-gate will affect the seed-data.js fetch path if the bundle isn't pre-cached.

> QWEN: **OQ-2 resolves the WRITE side (synthesizing `x-cached-at` in `fetchAndCache`) but leaves the READ side implicit.** The age-gate check must also happen on the cache-read path — currently `caches.match(request)` in `staleWhileRevalidate` (`sw.js:276`), `cacheFirst` (`sw.js:257`), and `networkFirst` (indirectly via `fetchAndCache` at `sw.js:240`). Approach.md needs to specify whether the age-gate is (a) a new helper wrapping `caches.match()` that checks `x-cached-at` before returning, (b) baked into each of the three strategy functions, or (c) a new strategy function that the classifier routes to. Option (a) is the cleanest — one read-side helper, minimal ripple. But this is a design decision that should be explicit in approach.md, not implied.

> QWEN: **There is a third spot-history path not mentioned here.** `spot.js:649` defines `HISTORICAL_DATA_REMOTE = "https://staktrakr.com/data/"` — the GitHub Pages remote fallback used in `spot.js:704` (`fetch(remoteUrl)`). This hits `staktrakr.com` (NOT `api.staktrakr.com` and NOT origin-local), so it bypasses BOTH `sw.js:203` (api host check) and `sw.js:209` (origin-local check). It always goes to network. The classifier rule for `annual-spot-history` should either (a) explicitly exclude `staktrakr.com` as out-of-scope (it's a third-party origin, no SW control), or (b) add it as a matched host if the approach intends to cache it. Not a blocker, but approach.md's file map should account for it.

> QWEN: **Three retail sub-endpoints listed as separate families share identical poller cadence, stale_after, and recommended floor (30 m).** The classifier in approach.md could collapse `retail-latest`, `retail-history-30d`, and `retail-intraday` into a single `retail` family matched by `/v2/retail/` path prefix, since they all share the same TTL semantics. Listing them separately is useful for traceability but approach.md should clarify whether these become one classifier rule or three. Also: the "manifest publisher rebuilds with each retail/spot poll" claim needs verification — I checked `docker-entrypoint.sh:29-33` and confirmed the retail (`30 * * * *`) and spot (`15,45 * * * *`) cron jobs, but there is no explicit "manifest rebuild" cron. The manifest is presumably regenerated as a side-effect of the retail/spot poller pipeline. Worth confirming in approach.md that the 30 m floor is safe even if the manifest lags behind a poll cycle.

> QWEN: **`staktrakr.com` is included in the host set but is NOT an api2 failover host.** `staktrakr.com` is the GitHub Pages origin (used by `HISTORICAL_DATA_REMOTE` at `spot.js:649`), while `api.staktrakr.com` and `api2.staktrakr.com` are the Fly.io API hosts. Grouping `staktrakr.com` with the API hosts in the same classifier host-set is technically correct for the spot-history path (both serve `/data/spot-history-*.json`), but it conflates two different infrastructure tiers. Approach.md should clarify whether `staktrakr.com` is in the classifier's allowed-host list for ALL families (it shouldn't be — only for `annual-spot-history`) or just for that one family.

> QWEN: **Summary understates the read-side ripple.** "Every existing strategy routes through it" is true for the WRITE side (`fetchAndCache`), but the READ side (`caches.match()` in each strategy) also needs age-gate logic. The summary says "wrapping responses with `x-cached-at` ripples through reads" but doesn't name the read-side refactor explicitly. Approach.md should budget for modifying all three strategy functions (`cacheFirst`, `networkFirst`, `staleWhileRevalidate` at `sw.js:253-282`) or introducing a new `matchWithAgeCheck()` helper that all three call instead of raw `caches.match()`.

**Review section:**

#### Verified

| Claim                                                      | Verification                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `sw.js:7` CACHE_NAME auto-stamped                          | Confirmed — `sw.js:7` = `"staktrakr-v3.34.67-b1778874630"`, stamp hook at `devops/hooks/stamp-sw-cache.sh`      |
| `sw.js:117` API_HOSTS                                      | Confirmed — `["api.metalpriceapi.com", "metals-api.com", "api.gold-api.com", "en.numista.com"]`                 |
| `sw.js:120` CDN_HOSTS                                      | Confirmed — `["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"]`                                         |
| `sw.js:147` version-prefix purge                           | Confirmed — `keys.filter(k => k.startsWith("staktrakr-") && key !== CACHE_NAME)`                                |
| `sw.js:203-206` api.staktrakr.com SWR                      | Confirmed — hostname check → `staleWhileRevalidate(event.request)`                                              |
| `sw.js:209` origin-local spot-history SWR                  | Confirmed — `url.origin === self.location.origin && url.pathname.includes("/data/spot-history")`                |
| `sw.js:228-241` fetchAndCache                              | Confirmed — `fetch(request)` → `cache.put(request, clone)` → return response; catch → `caches.match(request)`   |
| `sw.js:253-282` three strategies, zero age inspection      | Confirmed — all three call `caches.match()` with no header/age check                                            |
| `js/constants.js:532-535` V2_API_ENDPOINTS                 | Confirmed — `[api.staktrakr.com/data/v2, api2.staktrakr.com/data/v2]`                                           |
| `js/api.js:36-60` _staktrakrFetch 5s timeout               | Confirmed — `setTimeout(() => ctrl.abort(), 5000)` per host                                                     |
| `js/api.js:2970-2973` apiBaseUrls from V2_API_ENDPOINTS    | Confirmed — `.map(ep => ep.replace(/\/v2$/, ""))`                                                               |
| `js/api.js:2978` spot-history bare array fetch             | Confirmed — `_staktrakrFetch(apiBaseUrls, /spot-history-${year}.json)`                                          |
| `js/market-data.js:96` manifest fetch                      | Confirmed — `fetch(V2_API + "/manifest.json")`                                                                  |
| `js/market-data.js:513-531` retail detail/history/intraday | Confirmed — `/v2/retail/<slug>/latest.json`, `history-30d.json`, `intraday.json`                                |
| `js/market-data.js:1403` goldback fetch                    | Confirmed — `fetch(V2_API + "/goldback/latest.json")`                                                           |
| `js/retail.js:774` v2 envelope shape                       | Confirmed — comment: `{ v, generated_at, stale_after, data }`                                                   |
| `js/spot.js:697-726` 3-tier spot-history fallback          | Confirmed — fetch → xhrLoadJSON → fetch(remoteUrl)                                                              |
| `js/seed-data.js:8011` seed-data fetch fallback            | Confirmed — `fetch("data/spot-history-" + year + ".json")`                                                      |
| `js/api-health.js:8-10` fallback stale constants           | Confirmed — 30, 20, 25*60 minutes                                                                               |
| `js/api-health.js:56-118` envelope-first freshness         | Confirmed — `typeof stale_after === "number" ? Math.ceil(stale_after/60) : FALLBACK` for market, spot, goldback |
| `docker-entrypoint.sh:29-33` poller cron                   | Confirmed — retail `30 * * * *`, spot `15,45 * * * *`, goldback `5 16 * * *`, providers `*/5 * * * *`           |
| `data-pipelines.md:55-64` stale_after values               | Confirmed — spot 1200s, retail 1800s, goldback 90000s, manifest 1800s                                           |
| `playwright.config.js:11` serviceWorkers: "block"          | Confirmed                                                                                                       |
| `font-loading.spec.js:41-50` SW-enabled precedent          | Confirmed — `test.use({ serviceWorkers: "allow" })`                                                             |

#### Top concerns

1. **Read-side age-gate not explicitly resolved.** OQ-2 selects `x-cached-at` wrapping in `fetchAndCache` (WRITE) but the READ path — `caches.match()` in all three strategy functions (`sw.js:253-282`) — also needs age inspection before serving. Approach.md must specify whether this is a new `matchWithAgeCheck()` helper or modifications to each strategy.
2. **`staktrakr.com` conflated with API failover hosts.** OQ-5's host set `{api.staktrakr.com, api2.staktrakr.com, staktrakr.com}` mixes Fly.io API hosts with the GitHub Pages origin. The classifier should scope `staktrakr.com` to the `annual-spot-history` family only.
3. **`seed-data.js` fetch fallback DOES go through SW.** True for the script-tag bundle, but the `fetch()` at line 8011 is origin-local and routes through `sw.js:209`. Low-probability path but should be documented in approach.md's risk section.

#### Unverified assumptions

- **Manifest rebuild cadence.** The discovery says manifest "publisher rebuilds with each retail/spot poll" but no explicit manifest cron exists in `docker-entrypoint.sh`. The 30 m SW floor assumes the manifest is refreshed at least as often as the retail poller (hourly).
- **Retail history/intraday are append-only.** The discovery treats `history-30d.json` and `intraday.json` as having the same staleness semantics as `latest.json`. History is append-only — a stale cache entry is still correct for historical timestamps.
- **`x-cached-at` header synthesis on opaque responses.** All four in-scope hosts should be same-origin or CORS-enabled, but this should be verified before approach.md commits to header synthesis.

---

### CODEX

**Inline marks:**

> CODEX: **Adjacent live fetch surface is missing.** `js/retail.js` also drives v2 traffic: it selects the first healthy `V2_API_ENDPOINTS` base through manifest fetches (`js/retail.js:640-656`), fetches `/providers.json` (`js/retail.js:765-774`), then pulls `/retail/<slug>/latest.json`, `/intraday.json`, `/history-7d.json`, `/history-30d.json`, and `/history-90d.json` for every manifest slug (`js/retail.js:818-825`). Because the current SW caches every `api.staktrakr.com` / `api2.staktrakr.com` request with host-level SWR (`sw.js:202-205`), approach.md needs to explicitly decide which of these v2 files get family TTLs and which remain generic/pass-through. Otherwise the classifier may cover only the modal/detail paths while the background sync keeps inheriting the old broad cache behavior.

> CODEX: **The verified consumer is envelope-or-fallback, not `min(envelope, fallback)`.** `js/api-health.js:62-65`, `js/api-health.js:83-86`, and `js/api-health.js:103-106` use `stale_after` whenever present and only fall back to the constants when absent. That means "constant is floor" is imprecise if approach.md later implements `min(envelope.stale_after, SW_FAMILY_FLOOR)`: that would let the SW table tighten an envelope-bearing endpoint and create the split freshness clock this discovery says to avoid.

> CODEX: **This resolution contradicts its own precedence rule.** The live health consumer does not clamp envelope values to a fallback floor; it chooses envelope `stale_after` when present and fallback only when absent (`js/api-health.js:62-65`, `js/api-health.js:83-86`, `js/api-health.js:103-106`). Approach.md should pick one behavior explicitly: (a) envelope-authoritative `envelope ?? familyFallback`, matching the existing consumer, or (b) SW-tightened `min(envelope, familyFloor)`, which is a new policy and should be called out as stricter than today's app freshness contract.

> CODEX: **The endpoint `stale_after` values in this table are not all live-code accurate.** The v2 publisher writes `retail/<slug>/latest.json` with 1800 s (`devops/pollers/shared/api-export-v2.js:599-615`), but writes `retail/<slug>/intraday.json` with 1200 s (`devops/pollers/shared/api-export-v2.js:617-623`) and `retail/<slug>/history-30d.json` with 86400 s (`devops/pollers/shared/api-export-v2.js:634-640`). It also publishes `history-7d.json` at 3600 s and `history-90d.json` at 86400 s (`devops/pollers/shared/api-export-v2.js:625-649`), which `js/retail.js:818-825` fetches even though this discovery table does not list them. This changes the TTL family map materially.

> CODEX: **The proposed Node-level test surface needs a harness decision.** `sw.js` is currently a browser service-worker script with top-level `self.addEventListener("fetch", ...)` (`sw.js:156`) and no export/module boundary (`sw.js:16-282`), while the existing pure Node precedent lives in an ESM utility module with inline tests (`devops/pollers/shared/v2-utils.js:1-4`, `devops/pollers/shared/v2-utils.js:86-221`). Extracting `classifyEndpoint(url)` for Node tests is viable, but approach.md should name whether that means a new pure helper module imported by `sw.js`, a guarded CommonJS/ESM export from `sw.js`, or a Playwright-only test that evaluates classifier behavior in the SW context.

**Review section:**

#### Verified

| Claim                                                 | Verification                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current SW routing is host/path ordered and age-blind | Confirmed: StakTrakr API hosts route to SWR at `sw.js:202-205`, origin `/data/spot-history` routes to SWR at `sw.js:208-211`, and all strategies use raw `caches.match()` / `cache.put()` without age inspection at `sw.js:228-241` and `sw.js:253-282`.                                                                                                                        |
| v2 endpoint bases and failover are real               | Confirmed: `V2_API_ENDPOINTS` lists primary and backup at `js/constants.js:531-538`; `_staktrakrFetch` tries each base with 5 s timeout at `js/api.js:36-60`; retail sync independently chooses a healthy v2 base at `js/retail.js:640-656`.                                                                                                                                    |
| The discovery's listed market modal endpoints exist   | Confirmed: manifest at `js/market-data.js:96`, per-slug latest/history-30d/intraday at `js/market-data.js:513-531`, and goldback latest at `js/market-data.js:1403-1404`.                                                                                                                                                                                                       |
| A broader retail v2 fetch surface exists              | Confirmed: `js/retail.js:765-774` fetches `/providers.json`, and `js/retail.js:818-825` fetches per-slug latest, intraday, history-7d, history-30d, and history-90d.                                                                                                                                                                                                            |
| Publisher TTLs differ by retail endpoint              | Confirmed: latest 1800 s at `devops/pollers/shared/api-export-v2.js:599-615`, intraday 1200 s at `devops/pollers/shared/api-export-v2.js:617-623`, history-7d 3600 s at `devops/pollers/shared/api-export-v2.js:625-632`, history-30d 86400 s at `devops/pollers/shared/api-export-v2.js:634-640`, and history-90d 86400 s at `devops/pollers/shared/api-export-v2.js:642-649`. |
| Existing health freshness is envelope-or-fallback     | Confirmed: `js/api-health.js:62-65`, `js/api-health.js:83-86`, and `js/api-health.js:103-106` use `stale_after` when present, otherwise fallback constants.                                                                                                                                                                                                                     |
| Spot-history remote fallback is third-origin          | Confirmed: `js/spot.js:649` sets `HISTORICAL_DATA_REMOTE = "https://staktrakr.com/data/"`, and `js/spot.js:697-726` falls from origin fetch to XHR to that remote URL.                                                                                                                                                                                                          |
| SW-enabled Playwright precedent exists                | Confirmed: global `serviceWorkers: "block"` at `playwright.config.js:9-12`, with per-spec opt-in in `tests/playwright/font-loading.spec.js:41-50`.                                                                                                                                                                                                                              |

#### Top concerns

1. **Retail endpoint TTL map is materially wrong/incomplete.** The discovery table flattens retail latest, history-30d, and intraday to 1800 s and omits history-7d/history-90d/providers, but the live publisher and `js/retail.js` fetch paths prove distinct TTLs and broader SW exposure.
2. **Freshness precedence is internally contradictory.** The prose says envelope `stale_after` is authoritative, but the proposed `min(envelope.stale_after, SW_FAMILY_FLOOR)` would create a new SW-tightened policy that does not match `api-health.js`.
3. **The read-side cache contract is still the real implementation hinge.** `fetchAndCache` can stamp writes, but every stale response comes from the raw `caches.match()` read paths in `cacheFirst`, `networkFirst` fallback, and `staleWhileRevalidate`.

#### Unverified assumptions

- The SW policy is intended to cover all current v2 API traffic, including `providers.json`, `retail/latest.json`, `retail/vendors/*`, and history-7d/history-90d, not only the endpoints named in `market-data.js`.
- It is acceptable for the SW to use stricter freshness than the v2 envelope for selected families; the existing app health path does not do that today.
- `classifyEndpoint(url)` can be tested in Node without introducing a new helper/module boundary or SW-specific test harness.
- `staktrakr.com` remote spot-history should be normalized into the same annual-spot-history family even though the current SW cannot intercept it unless the app is served from that origin.
- Synthesized `x-cached-at` headers will be accepted for every cached response type the classifier touches, including CORS responses from `api.staktrakr.com` and `api2.staktrakr.com`.

---

### GEMINI

**Review section:**

#### Verified

| Claim                                     | Verification                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetchAndCache` is the single write point | Confirmed: `sw.js:228-241` wraps the cache write for `cacheFirst`, `networkFirst`, and `staleWhileRevalidate`.                                                              |
| API fetch paths use CORS mode             | Confirmed: `js/api.js:45` and throughout `fetch` calls use `{ mode: "cors" }`, which guarantees the v2 API responses are not opaque and their headers can be safely copied. |
| SW does not use `Response.url` internally | Confirmed: Grep for `.url` in SW and fetch consumers (`js/api.js`, `js/retail.js`) shows no reliance on the `url` property of the `Response` object returned from caches.   |

#### Top concerns

1. **Opaque response cloning risk in `fetchAndCache`.** Since `fetchAndCache` handles ALL cache writes (including local assets and third-party CDNs), synthesizing `x-cached-at` for opaque (`no-cors`) responses will either throw an error or corrupt the cache. We must explicitly skip header synthesis for `response.type === "opaque"`.
2. **`fetchAndCache` synthesis loses `Response.url`.** When wrapping a response via `new Response(response.body, { headers: ... })`, the resulting cached object will have an empty string for its `url` property, and its `type` becomes `"default"`. While current code doesn't read `response.url`, this alters the cached object shape for all files (JS, CSS, images). The age-gate should only synthesize `x-cached-at` for the specific API endpoints it classifies, not globally.
3. **Browser HTTP cache defeating the SW age-gate.** If the SW's `fetch(request)` does not explicitly bust the browser's HTTP cache (e.g. Cloudflare's `Cache-Control` on API endpoints), the browser might serve a stale HTTP-cached response _into_ the SW, which the SW then stamps with a fresh `x-cached-at` timestamp. This creates a double-caching bug where stale data looks artificially fresh.

#### Unverified assumptions

- **Seamless fallback for legacy cached items.** The design assumes that if an item was cached before the age-gate feature (lacking `x-cached-at`), the SW will safely fall back to the floor TTL or treat it as stale, without throwing an error when attempting to parse the missing header.
- **`staleWhileRevalidate` read-side race conditions.** If the SWR strategy checks the age-gate and decides the cache is too old, it must block and wait for the network, effectively falling back to `networkFirst`. The current SWR strategy (`sw.js:276-281`) always returns `cached || fetchPromise`. Adding an age-gate implies returning the network promise if the cache is stale, fundamentally altering the SWR timing model.

---

### KIMI

**Inline marks:**

> KIMI: **`js/market-data.js` hardcodes `V2_API = "https://api.staktrakr.com/data/v2"` (`js/market-data.js:5`) and never uses `V2_API_ENDPOINTS` or `_staktrakrFetch`.** All manifest, retail detail/history/intraday, and goldback fetches from `market-data.js` are single-homed to `api.staktrakr.com` — they never hit `api2.staktrakr.com`. The SW classifier must cover `api.staktrakr.com` for these paths, but the implicit assumption that "all v2 traffic could hit either host" is false for a significant frontend surface area.

> KIMI: **`api-export-v2.js` (and therefore manifest rebuilds) is NOT in the home poller cron.** The v2 publisher lives in `remote-poller/run-publish.sh` (`devops/pollers/remote-poller/run-publish.sh`), which runs on Fly.io at `8,23,38,53 * * * *` (every 15 min). The home poller writes to Turso but never exports JSON. The claim "publisher rebuilds with each retail/spot poll" is imprecise — manifest rebuilds happen on a separate 15-min cadence in the remote poller only.

> KIMI: **The `data-pipelines.md` table is stale and oversimplifies retail.** The live publisher (`api-export-v2.js`) writes `retail/<slug>/intraday.json` with 1200 s, `history-7d.json` with 3600 s, and `history-30d.json`/`history-90d.json` with 86400 s. It also writes `providers.json` with 86400 s (`api-export-v2.js:936`). The discovery table flattens all retail to 1800 s and omits `history-7d`, `history-90d`, and `providers.json` entirely. Approach.md needs a corrected TTL family map.

> KIMI: **The retail sub-endpoints do NOT share identical `stale_after` values.** CODEX already flagged this, but it bears repeating: the publisher writes `latest.json` at 1800 s, `intraday.json` at 1200 s, `history-7d.json` at 3600 s, and `history-30d.json`/`history-90d.json` at 86400 s (`api-export-v2.js:599-649`). Collapsing them into a single `retail` family with one floor would mean the classifier ignores the publisher's own TTL differentiation. Approach.md should either (a) match the publisher's per-endpoint TTLs, or (b) explicitly decide to tighten/loosen them and document the deviation.

> KIMI: **The classifier host-set should also account for `market-data.js` being single-homed.** Even though `api2.staktrakr.com` is in `V2_API_ENDPOINTS`, `js/market-data.js:5` hardcodes `api.staktrakr.com` and never iterates failover endpoints. If `api.staktrakr.com` is down, market-data.js fetches fail regardless of api2 health. The SW cannot fix this (it only sees the requested URL), but approach.md should document this architectural gap explicitly rather than implying all v2 traffic enjoys dual-host resilience.

**Review section:**

#### Verified

| Claim                                                                  | Verification                                                                                                      |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `sw.js:7` CACHE_NAME auto-stamped                                      | Confirmed.                                                                                                        |
| `sw.js:117` API_HOSTS                                                  | Confirmed.                                                                                                        |
| `sw.js:120` CDN_HOSTS                                                  | Confirmed.                                                                                                        |
| `sw.js:147` version-prefix purge                                       | Confirmed.                                                                                                        |
| `sw.js:202-205` api.staktrakr.com SWR                                  | Confirmed.                                                                                                        |
| `sw.js:208-211` origin-local spot-history SWR                          | Confirmed.                                                                                                        |
| `sw.js:228-241` fetchAndCache single write point                       | Confirmed.                                                                                                        |
| `sw.js:253-282` three strategies, zero age inspection                  | Confirmed.                                                                                                        |
| `js/constants.js:531-538` V2_API_ENDPOINTS                             | Confirmed.                                                                                                        |
| `js/api.js:36-60` _staktrakrFetch 5s timeout                           | Confirmed.                                                                                                        |
| `js/api.js:2970-2973` apiBaseUrls construction                         | Confirmed QWEN correction.                                                                                        |
| `js/api.js:2978` spot-history bare array fetch                         | Confirmed.                                                                                                        |
| `js/market-data.js:96` manifest fetch                                  | Confirmed.                                                                                                        |
| `js/market-data.js:513-531` retail detail/history/intraday             | Confirmed.                                                                                                        |
| `js/market-data.js:1403` goldback fetch                                | Confirmed.                                                                                                        |
| `js/retail.js:640-656` _pickFreshestV2Endpoint                         | Confirmed.                                                                                                        |
| `js/retail.js:765-774` providers.json fetch                            | Confirmed.                                                                                                        |
| `js/retail.js:818-825` per-slug retail fetches                         | Confirmed.                                                                                                        |
| `js/retail.js:774` v2 envelope shape comment                           | Confirmed.                                                                                                        |
| `js/spot.js:697-726` 3-tier fallback chain                             | Confirmed QWEN correction.                                                                                        |
| `js/seed-data.js:8011` seed-data fetch fallback                        | Confirmed.                                                                                                        |
| `js/api-health.js:8-10` fallback constants                             | Confirmed.                                                                                                        |
| `js/api-health.js:56-118` envelope-first freshness consumer            | Confirmed — it is `envelope ?? fallback`, NOT `min(envelope, fallback)`.                                          |
| `docker-entrypoint.sh:29-33` poller cron                               | Confirmed.                                                                                                        |
| `playwright.config.js:11` serviceWorkers: "block"                      | Confirmed.                                                                                                        |
| `font-loading.spec.js:41-50` SW-enabled precedent                      | Confirmed.                                                                                                        |
| `devops/pollers/shared/api-export-v2.js` publisher TTLs                | Confirmed CODEX findings: retail/intraday 1200s, history-7d 3600s, history-30d/90d 86400s, providers.json 86400s. |
| `devops/pollers/shared/v2-utils.js:77-84` wrapEnvelope shape           | Confirmed `{ v, generated_at, stale_after, data }`.                                                               |
| `devops/pollers/remote-poller/run-publish.sh` manifest rebuild cadence | Confirmed: cron is `8,23,38,53 * * * *` (every 15 min), NOT tied to retail/spot polls.                            |

#### Top concerns

1. **`js/market-data.js` is single-homed and never hits api2.** `js/market-data.js:5` hardcodes `const V2_API = "https://api.staktrakr.com/data/v2"` and uses direct `fetch()` for manifest, retail detail/history/intraday, and goldback. It does not use `V2_API_ENDPOINTS` or `_staktrakrFetch`. This means a significant portion of v2 frontend traffic has no failover — if `api.staktrakr.com` is down, market-data.js fetches fail outright. The discovery implies dual-host resilience for "all v2 traffic," which is incorrect. Approach.md should document this gap.
2. **The retail TTL family map is materially incomplete and `data-pipelines.md` is stale.** The discovery table flattens all retail to 1800 s, but the publisher writes `intraday.json` at 1200 s, `history-7d.json` at 3600 s, `history-30d.json`/`history-90d.json` at 86400 s, and `providers.json` at 86400 s. `js/retail.js:818-825` fetches all five per-slug endpoints plus `providers.json`. The classifier needs at least four distinct retail TTLs, not one.
3. **Manifest rebuild cadence is mischaracterized.** The discovery claims manifest "publisher rebuilds with each retail/spot poll," but `api-export-v2.js` is only invoked by `remote-poller/run-publish.sh` on Fly.io at `8,23,38,53 * * * *` (every 15 min). The home poller writes to Turso but never exports JSON.

#### Unverified assumptions

- **`market-data.js` single-homed v2 traffic is acceptable.** The discovery assumes all v2 traffic benefits from dual-host failover, but `market-data.js` never hits `api2.staktrakr.com`. Is this a known limitation or a migration gap?
- **`data-pipelines.md` stale values are treated as authoritative.** The discovery cites `data-pipelines.md:55-64` as documenting publisher-side TTLs, but the doc says "Retail 1800 s" while the publisher writes 1200/3600/86400.
- **History endpoints need the same freshness policy as latest.** `history-30d` and `history-90d` are append-only (old rows never change). The discovery's recommended 30 m floor for history-30d is stricter than the publisher's 86400 s envelope and ignores the append-only nature.
- **`providers.json` is consumed with envelope awareness.** `js/retail.js:767` parses `providers.json` defensively, but the discovery omits it from the TTL table entirely. It has a 86400 s envelope — should it get its own family or be grouped with retail?
- **The home poller's lack of JSON export is intentional.** The home poller does not run `api-export-v2.js`. If the Fly.io remote poller is down, the GitHub Pages JSON files stop updating even though the home poller continues scraping. Is this a known SPOF?

### Resolution Summary

- Accepted: 14
- Rejected: 0
- Resolved with your input: 2 (OQ-1 policy → envelope-authoritative `envelope ?? floor`; OQ-4 retail families → per-publisher-TTL-tier with four distinct families)
