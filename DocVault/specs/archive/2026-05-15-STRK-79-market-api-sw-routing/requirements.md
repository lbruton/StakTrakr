---
sketch: "STRK-79-market-api-sw-routing"
phase: requirements
created: 2026-05-15
reconciled: 2026-05-15
---

# STRK-79 — Requirements

> **Source Issue:** [STRK-79](https://plane.lbruton.cc/lbruton/browse/STRK-79/)
> **Title:** Audit market data caching pipeline — add explicit SW routing for api.staktrakr.com
>
> **Issue summary (reconciled):** The market data cache stack is working: localStorage persists long-lived market metadata and spot history, sessionStorage caches API responses for the current session, and in-memory maps deduplicate detail/history fetches. The service worker already has an explicit `api.staktrakr.com` / `api2.staktrakr.com` branch at `sw.js:203-206` routing through `staleWhileRevalidate`. The real gap is threefold: (1) that single branch applies one bulk strategy with **no per-endpoint-family sub-routing**, (2) **none of the three SW strategy functions** (`cacheFirst`, `networkFirst`, `staleWhileRevalidate` at `sw.js:253-282`) **inspect cache-entry age**, and (3) the policy is not coordinated with adjacent paths consumed by the app — the `api2.staktrakr.com` failover, the `api.staktrakr.com/data/spot-history-YYYY.json` annual archive, and the origin-local `staktrakr.com/data/spot-history-YYYY.json` GitHub Pages path served via `sw.js:209`. The only current expiration mechanism is whole-cache version-purge on activate (`sw.js:147`).

## Overview

This sketch defines an intentional, auditable service-worker caching policy that covers four hosts/path-families: the primary `api.staktrakr.com` v2 endpoints, the `api2.staktrakr.com` failover, the `api.staktrakr.com/data/spot-history-YYYY.json` annual archive, and the origin-local `staktrakr.com/data/spot-history-YYYY.json` GitHub Pages path. The goal is not to replace the existing localStorage, sessionStorage, or in-memory caches; it is to make the service-worker layer explicit, age-aware, and aligned with the freshness expectations of each endpoint family — including the duplicate spot-history shape exposed on two different hosts.

## User Stories

- **US-1:** As a StakTrakr user, I want market data loaded through the service worker to follow endpoint-specific freshness rules so that spot, manifest, detail, historical, and hourly responses do not rely on accidental cache behavior.
- **US-2:** As an offline or flaky-network user, I want previously fetched market data to remain available with known freshness guarantees so that the app remains useful without pretending stale data is live.
- **US-3:** As a maintainer, I want the market API service-worker route and TTL choices documented and testable so that future cache changes do not regress the existing multi-tier cache pipeline.

## Acceptance Criteria

### AC-1 (maps to US-1, US-3)

- **Given** requests directed at any of the four in-scope hosts/path-families — `api.staktrakr.com/v2/*`, `api2.staktrakr.com/v2/*`, `api.staktrakr.com/data/spot-history-YYYY.json`, and `staktrakr.com/data/spot-history-YYYY.json`
- **When** the service worker handles the request
- **Then** an explicit per-endpoint-family classifier inside the StakTrakr SW selects a documented strategy (cache-first / network-first / stale-while-revalidate) for each of the live endpoint families: per-vendor `latest`, per-vendor `intraday`, per-vendor `history-30d`, top-level `manifest`, `spot/latest`, `goldback/latest`, and annual `spot-history-YYYY` (both hosts). Concrete TTL values for each family are deferred to `approach.md` after `discovery.md` resolves the freshness-authority and mechanism Open Questions; the requirement here is that the classifier exists, is exhaustive over the named families, and that any TTL it eventually carries is no looser than the home poller's publish cadence (`devops/pollers/home-poller/docker-entrypoint.sh:29-33`: spot 30m, retail 1h, goldback 24h, providers 5m).

### AC-2 (maps to US-2)

- **Given** a cached response for any in-scope endpoint family and a later request for the same URL
- **When** the SW evaluates whether to serve from cache
- **Then** the cache-entry age is checked against the per-family freshness window before the response is served as fresh; entries past the window are revalidated (or, for `cache-first` families, refused as stale) according to the family's strategy. The whole-cache version-purge on activate (`sw.js:147`) remains the ceiling — the new per-family TTLs operate beneath it, not above. The mechanism by which entry age is determined (sidecar timestamp index / cached `Date` header / wrapped Response with `x-cached-at`) is deferred to `discovery.md` and `approach.md`.

### AC-3 (maps to US-1, US-3)

- **Given** the existing app-level market data caches and bundle loaders remain in place
- **When** the service-worker policy is added
- **Then** localStorage, sessionStorage, the `api.js` in-memory deduplication maps, and the app-level market-data rendering continue to work without changes to their public data shapes or storage keys. The `seed-data.js` spot-history bundle (`seed-data.js:8011`) and the `spot.js:697` bundle-fallback path are explicitly preserved — they bypass `fetch()` and therefore the SW entirely; the new policy must not introduce any code path that breaks that bypass.

### AC-4 (maps to US-3)

- **Given** the service-worker routing change is implemented
- **When** verification runs
- **Then** two complementary test modes prove correctness: (a) Node-level unit tests of an extracted pure router/classifier function (e.g. `classifyEndpoint(url)` / `chooseStrategy(url)`) covering every in-scope endpoint family and every host, and (b) a targeted Playwright test using `test.use({ serviceWorkers: "allow" })` against the existing `python3 -m http.server` baseURL — modeled on the precedent at `tests/playwright/font-loading.spec.js:41-50` — that exercises cache-hit / cache-miss / cache-stale paths and asserts the age gate behaves correctly. Temporary SW-internal instrumentation needed by these tests is permitted.

### AC-5 (maps to US-3)

- **Given** the implementation is complete
- **When** maintainers read the sketch or the corresponding DocVault update
- **Then** the intended strategy and freshness window for **each in-scope endpoint family on each in-scope host** is recorded in a durable reference — covering `api.staktrakr.com/v2/*`, `api2.staktrakr.com/v2/*`, and both spot-history paths — along with the documented mechanism chosen for age enforcement and the precedence rule resolving SW table vs envelope `stale_after`.

## Non-Goals

- Not replacing localStorage, sessionStorage, or in-memory market caches; this sketch only makes the service-worker layer intentional.
- Not changing the StakTrakr API publisher, GitHub Pages deployment, poller schedules, or backend data export format.
- Not adding request debouncing for concurrent modal opens as required scope; that may be evaluated as a follow-up after the routing policy is settled.
- Not adding permanent end-user-visible cache observability; temporary SW-internal instrumentation needed to support AC-4 verification is permitted, but no user-facing cache-hit/miss UI is in scope.
- Not adding API retry/backoff or rate-limit-aware behavior to `_staktrakrFetch()` as required scope; that remains an evaluated follow-up.
- Not changing user-facing freshness badges unless discovery shows the service-worker policy exposes a current mismatch.
- Not introducing a build step, bundler, or third-party SW library (e.g. Workbox); StakTrakr remains zero-build vanilla JS, so the classifier and any age-gate mechanism must be implementable inside the existing `sw.js`.
- Not treating `api2.staktrakr.com` as semantically distinct from `api.staktrakr.com` for routing purposes — it inherits the primary host's per-family policy; whether the failover gets a tightened freshness window is captured as OQ-5, not asserted here.

## Open Questions

- **OQ-1 — Freshness authority precedence.** v2 API envelopes already expose `stale_after`, consumed today by `api-health.js:56-118`, and DocVault `data-pipelines.md:55-64` records concrete current thresholds (manifest 30m, spot 20m, retail 30m, goldback 25h). Should the SW (a) honor `stale_after` from the envelope and fall back to a hard-coded table only when the envelope is absent, (b) use its own table exclusively and ignore the envelope, or (c) treat the table as a ceiling and the envelope as a floor? Discovery must propose a precedence rule before approach.md picks TTL numbers.
- **OQ-2 — Age-gate mechanism.** Three candidate mechanisms differ by roughly an order of magnitude in implementation cost: (a) sidecar timestamp index in IndexedDB or localStorage keyed by request URL, (b) read each cached `Response`'s `Date` header on every hit, (c) wrap each cache entry in a new `Response` carrying an `x-cached-at` header (requires refactoring `fetchAndCache` at `sw.js:228-241`). Discovery must compare and recommend.
- **OQ-3 — Dual spot-history unification.** The annual spot-history JSON is fetched from two different hosts: `api.staktrakr.com/data/spot-history-YYYY.json` via `api.js:2978` (matched today by the API branch at `sw.js:203`) and `staktrakr.com/data/spot-history-YYYY.json` via `spot.js:649,695` (matched today by the local-origin branch at `sw.js:209`). Same data shape, different SW paths. Should the new classifier collapse both into a single `annual-spot-history` family with shared TTL, or keep them as parallel branches with shared semantics documented?
- **OQ-4 — Concrete TTL numbers.** Discovery must enumerate the poller cadences already verified in `devops/pollers/home-poller/docker-entrypoint.sh:29-33` and propose per-family floor values that respect them. Approach.md will then commit to specific numbers.
- **OQ-5 — api2 failover policy.** sw.js:203 currently treats `api2.staktrakr.com` identically to the primary host. Does the new policy keep that parity, or apply a tightened freshness window on the failover because it's only hit when the primary is down?

## Assumptions Reconciled (2026-05-15)

- **Refuted (OPUS, confirmed KIMI + CODEX):** the assumption baked into the original issue title — that `api.staktrakr.com` is "not explicitly routed" by `sw.js` — is wrong. `sw.js:203-206` already has the explicit branch. The Source Issue paragraph above has been rewritten to describe the real defect (no sub-routing, no age gate, no cross-host coordination). Carry this correction forward into discovery.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list five load-bearing items that discovery must resolve. Then advance: `/sketch discovery STRK-79`.

---

## Review Archive — requirements (2026-05-15)

_Reconciled by /sketch reconcile on 2026-05-15. Original reviewer marks preserved below for audit._

### Opus

#### Inline marks (verbatim)

> OPUS: This premise is factually wrong. [sw.js:203-206](../../../../../StakTrakr/sw.js) **already** has an explicit branch: `if (url.hostname === "api.staktrakr.com" || url.hostname === "api2.staktrakr.com")` routing to `staleWhileRevalidate(...)`. The actual gap is that the single existing branch applies one bulk strategy without per-endpoint differentiation and with **no TTL enforcement at all** — `staleWhileRevalidate` in sw.js does not check cache-entry age. Rewrite this paragraph so requirements is grounded in the real defect (undifferentiated single-strategy branch + no age gate) rather than a non-existent missing branch, otherwise AC-1 looks like it's already satisfied today.

> OPUS: As written, the existing sw.js:203 branch already matches this AC — it's an explicit branch, distinct from the local-origin SWR path at sw.js:221. Either (a) tighten AC-1 to require **endpoint-family sub-routing inside the api.staktrakr.com branch**, or (b) collapse AC-1 into AC-2. Otherwise AC-1 is vacuously true on `dev` today.

> OPUS: AC-1 also silently ignores the `api2.staktrakr.com` backup host that sw.js:203 currently treats identically. Either include both hosts explicitly, or add a non-goal stating the backup host is out of scope (and explain why — the V2_API_ENDPOINTS array in [constants.js:533](../../../../../StakTrakr/js/constants.js) and the `apiBaseUrls` fallback in [api.js:146](../../../../../StakTrakr/js/api.js) route real traffic through it).

> OPUS: **Three of the five endpoint paths in this AC do not exist in the live codebase.** Verified against [js/market-data.js:96,513,524,531,1403](../../../../../StakTrakr/js/market-data.js) and [js/api.js:69,145,2978](../../../../../StakTrakr/js/api.js):
>
> | AC says              | Live path                                                                                                              |
> | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
> | `/manifest.json`     | ✅ `/v2/manifest.json`                                                                                                 |
> | `/spot/latest.json`  | ✅ `/v2/spot/latest.json`                                                                                              |
> | `/slug/*/detail`     | ❌ actual: `/v2/retail/<slug>/latest.json`                                                                             |
> | `/historical/*.json` | ❌ actual: `/v2/retail/<slug>/history-30d.json` AND `/data/spot-history-<year>.json` (two different historical shapes) |
> | `/hourly/*.json`     | ❌ actual: `/v2/retail/<slug>/intraday.json`                                                                           |
>
> Also missing: `/v2/goldback/latest.json` (market-data.js:1403) and `/v2/retail` listings (retail.js:574). Discovery cannot reconcile this — requirements must list the real paths, or AC-2 should be reworded in terms of endpoint **families** (e.g., "per-slug detail", "per-slug intraday", "annual spot history") with concrete pattern mapping deferred to approach.md.

> OPUS: TTL values are stated without justification. Why 24h for manifest? The home poller's manifest publish cadence dictates this — without checking [devops/pollers/home-poller/docker-entrypoint.sh](../../../../../StakTrakr/devops/pollers/home-poller/docker-entrypoint.sh), these numbers are guesses. Either cite the poller cadence in discovery, or weaken the AC to "TTL ≥ poller publish interval" so the actual numbers are derivable rather than asserted.

> OPUS: **This is the largest hidden scope in the sketch.** sw.js currently has no mechanism to enforce per-entry TTL — `cacheFirst`, `networkFirst`, and `staleWhileRevalidate` (sw.js:253-282) all serve whatever is in the Cache Storage API with no age check. Enforcing "only within window" requires either (a) storing a sidecar timestamp index in IndexedDB/localStorage keyed by request URL, (b) reading the cached Response's `Date` header on every hit, or (c) wrapping each cache entry in a versioned Response with an `x-cached-at` header. Pick one in requirements or call it out as a discovery question — implementation cost differs by an order of magnitude across the three.

> OPUS: Note that [sw.js:147](../../../../../StakTrakr/sw.js) already purges old caches by version prefix on activate, so the effective max TTL today is "until next release." Requirements should acknowledge this baseline and explain whether the new per-endpoint TTLs are tighter ceilings on top of that, or replace it.

> OPUS: "Tests or equivalent verification" is not mechanically verifiable. Service worker logic in StakTrakr has historically been hard to Playwright-test because the SW must be installed and activated against a real origin, not `file://`. State concretely whether AC-5 is satisfied by (a) Playwright tests with SW-activated HTTP context, (b) Node-level unit tests of pure router functions extracted from sw.js, or (c) manual verification with documented checklist. Each has a different impact on approach.md's file map.

> OPUS: "None for requirements" is overconfident given the verification gaps above. At minimum add: (1) Which TTL-enforcement mechanism (sidecar timestamp store / Date header / wrapped Response)? (2) Is `api2.staktrakr.com` in scope? (3) Are `/data/spot-history-<year>.json` and `/v2/goldback/latest.json` in scope (both consumed via api.staktrakr.com but not named in AC-2)? (4) Is the home-poller publish cadence the authoritative source for TTL floors? These belong in requirements because they materially change what "done" means.

#### OPUS Review section (verbatim)

### Verified

- **Live SW routing**: [sw.js:203-206](../../../../../StakTrakr/sw.js) already has explicit `api.staktrakr.com` / `api2.staktrakr.com` branch via `staleWhileRevalidate`. AC-1's premise is wrong on `dev`.
- **No TTL enforcement anywhere in sw.js**: confirmed by reading sw.js:253-282 — `cacheFirst`, `networkFirst`, `staleWhileRevalidate` never inspect age; cache purge only happens on version change (sw.js:147).
- **Endpoint paths**: enumerated against [js/market-data.js](../../../../../StakTrakr/js/market-data.js) and [js/api.js](../../../../../StakTrakr/js/api.js). Three of five AC-2 paths do not match live paths; two additional endpoint families (`/v2/goldback/latest.json`, spot-history yearly JSON) are unmentioned.
- **API consumers**: `_staktrakrFetch` exists at [js/api.js:36](../../../../../StakTrakr/js/api.js), iterates over `V2_API_ENDPOINTS` from [js/constants.js:533](../../../../../StakTrakr/js/constants.js) which lists `api.staktrakr.com/data/v2` as sole entry today.
- **api2 host usage**: `apiBaseUrls` fallback construction in [js/api.js:146](../../../../../StakTrakr/js/api.js) and [js/api-health.js:146](../../../../../StakTrakr/js/api-health.js) confirms the backup host is real consumed traffic, not legacy.

### Top concerns

1. **Wrong premise / vacuous AC-1.** sw.js already routes `api.staktrakr.com` explicitly. Without rewording, the requirement is satisfied by the existing code and the spec ships nothing.
2. **Endpoint paths are wrong.** AC-2's path patterns (`/slug/*/detail`, `/historical/*.json`, `/hourly/*.json`) do not exist; live API uses `/v2/retail/<slug>/{latest,history-30d,intraday}.json` plus `/data/spot-history-<year>.json` and `/v2/goldback/latest.json`. Approach.md will build a router against fictional paths if this is not corrected.
3. **TTL enforcement is unbuilt infrastructure, not a config knob.** AC-3 silently introduces a per-entry age-gate mechanism that sw.js does not have. The cost-of-implementation delta between the three plausible mechanisms (sidecar timestamps, Date-header check, wrapped Response) is large enough that requirements must pick or explicitly defer to discovery.

### OPUS — Unverified Assumptions

- That the `api.staktrakr.com` branch in sw.js is "accidental/default" behavior. **Refuted**: it is an intentional explicit branch (sw.js:203).
- That the TTL numbers stated in AC-2 (24h / 5-10m / 1h / 7d / 1h) are correct for StakTrakr's poller cadence. Not verified against [docker-entrypoint.sh](../../../../../StakTrakr/devops/pollers/home-poller/docker-entrypoint.sh).
- That endpoint families map cleanly to single TTL classes. The two distinct "historical" shapes (`/v2/retail/<slug>/history-30d.json` is per-vendor, 30-day rolling; `/data/spot-history-<year>.json` is per-year, append-only) likely deserve different TTL semantics — one rolls, one is immutable-after-year-end.
- That `api2.staktrakr.com` should mirror `api.staktrakr.com` policy exactly. The fact that AC-1 names only the primary host while sw.js currently treats them identically suggests the requirements author may not have noticed the secondary host.
- That non-goal "not adding cache-hit/miss observability" is compatible with AC-3/AC-5's testability. If you can't observe whether a request hit cache vs. network, you cannot mechanically verify the freshness-window behavior — the tests need at least temporary instrumentation.
- That the `sw.js` cache-version purge (sw.js:147) is independent of the new TTL layer. They interact: a release that bumps `CACHE_NAME` invalidates every per-endpoint TTL ceiling simultaneously.

### Kimi

#### Inline marks (verbatim)

> KIMI: **Confirmed.** Reading sw.js:203-206 and sw.js:253-282 confirms the explicit branch exists and all three strategy functions (`cacheFirst`, `networkFirst`, `staleWhileRevalidate`) serve from Cache Storage API without inspecting entry age. The real defect is accurately described by OPUS.

> KIMI: The overview correctly limits scope to the SW layer, but it should also acknowledge that `api2.staktrakr.com` is currently treated identically in sw.js:203. If the new policy intentionally covers only the primary host, that should be stated as a non-goal or scope boundary. Otherwise both hosts must be addressed.

> KIMI: **Confirmed.** sw.js:203 explicitly matches both `api.staktrakr.com` and `api2.staktrakr.com`. AC-1 as written is already satisfied. I recommend collapsing AC-1 into AC-2: reword AC-2 to require per-endpoint-family sub-routing **within** the existing api.staktrakr.com / api2.staktrakr.com branch, and delete AC-1 as a separate criterion.

> KIMI: **Confirmed all path discrepancies.** Additional finding: spot-history files have a **dual-path architecture** that AC-2 does not capture:
>
> - `spot.js:649,695` fetches from `https://staktrakr.com/data/spot-history-YYYY.json` (GitHub Pages origin — caught by sw.js:209)
> - `api.js:2978` fetches from `api.staktrakr.com/data/spot-history-YYYY.json` via `_staktrakrFetch` (caught by sw.js:203)
>   These are different hosts and different SW code paths. If the goal is comprehensive SW routing policy, both paths need explicit treatment or a non-goal explaining why `staktrakr.com/data/spot-history-*` is excluded.

> KIMI: **Polled cadence verified** in `docker-entrypoint.sh:29-33`:
>
> - Spot: every 30 min (`:15,:45`)
> - Retail: every hour (`:30`)
> - Goldback: daily at `16:05` UTC
> - Provider export: every 5 min
>   These cadences directly affect TTL justification. A 24h manifest TTL is reasonable (poller exports providers every 5 min, but manifest structure changes only when coins/vendors are added — much less frequent). A 5-10 min spot TTL aligns well with the 30 min poller cadence. However, the 1h "intraday" TTL should be justified against the hourly retail poller, and the 7d "historical" TTL is clearly an artifact of the 30-day rolling window's immutability for already-published days.

> KIMI: **Confirmed.** sw.js:253-282 confirms zero age inspection. I want to add a fourth option to OPUS's list: (d) **Workbox-style cache expiration plugin** — but StakTrakr is zero-build vanilla JS with no bundler, so importing Workbox is likely out of scope. That makes option (c) — wrapping Response with `x-cached-at` — the most self-contained and testable approach, since it keeps all TTL metadata inside the Cache Storage API without introducing a second storage system. However, it requires intercepting `cache.put()` calls, which means the simple `fetchAndCache` helper (sw.js:228-241) would need to be replaced or wrapped. Requirements should either pick (c) or explicitly defer the mechanism choice to discovery/approach.

> KIMI: **Verified.** `market-data.js`, `api.js`, and `spot.js` all consume responses via standard `fetch()` and parse JSON independently of the SW layer. Changing SW routing strategies does not alter response shapes or app-level cache keys. This AC is sound, but it should also include `spot-history` bundle loading (`seed-data.js:8011` and `spot.js:697`) which bypasses the app-level caches entirely and loads from `<script>` or `fetch()` of local files.

> KIMI: **Agree with OPUS.** The `npm test` Playwright suite in this repo runs against `file://` (AGENTS.md notes `python3 -m http.server 8000` for local testing). Service workers do not activate on `file://`. Therefore option (a) requires spinning up a local server in the test harness — feasible but not currently done. Option (b) is the most pragmatic: extract a pure `classifyEndpoint(url)` or `chooseStrategy(url)` function from sw.js, unit-test it in Node with Jest/Vitest, and keep the existing sw.js integration thin. This would be a new test file and possibly a new build-free test runner. Requirements should pick one now or add it to Open Questions.

> KIMI: **Sound AC.** But note that if `api2.staktrakr.com` and `staktrakr.com/data/spot-history-*` are in scope, the documentation must cover them too. If they are excluded, the non-goals should say so explicitly.

> KIMI: Missing non-goal needed: **Whether `api2.staktrakr.com` is in scope.** sw.js:203 currently treats it identically to the primary host. If the new policy applies only to `api.staktrakr.com`, that should be a stated non-goal with rationale (e.g., "api2 is a failover with identical semantics, so it inherits the same policy" or "api2 is out of scope because traffic volume is negligible"). Also missing: whether `staktrakr.com/data/spot-history-*.json` (the GitHub Pages path used by `spot.js:649`) is in scope, since it is currently routed by sw.js:209 separately from the api.staktrakr.com branch.

> KIMI: **Strongly agree with OPUS.** I verified the poller cadence in `docker-entrypoint.sh:29-33` and it directly impacts TTL justification. The four OPUS questions are load-bearing. I would add a fifth: (5) **How should the SW handle the dual spot-history path?** `spot.js:649` fetches from `staktrakr.com/data/` (origin-local, caught by sw.js:209), while `api.js:2978` fetches from `api.staktrakr.com/data/` (caught by sw.js:203). They serve the same data shape but through different hosts and different SW branches. Does the new policy unify them or leave them separate?

#### KIMI Review section (verbatim)

### Verified

- **Live SW routing**: Confirmed sw.js:203-206 explicitly matches `api.staktrakr.com` and `api2.staktrakr.com` with `staleWhileRevalidate`. AC-1 is vacuously satisfied today.
- **No TTL enforcement**: Confirmed sw.js:253-282 — `cacheFirst`, `networkFirst`, `staleWhileRevalidate` never inspect cache-entry age. Version-based purge at sw.js:147 is the only expiration mechanism.
- **Endpoint paths**: Verified against `js/market-data.js:96,513,524,531,1403` and `js/api.js:69,145,2978`. Three of five AC-2 paths are wrong; `/v2/goldback/latest.json` is missing entirely.
- **Dual spot-history paths**: Discovered `spot.js:649,695` fetches from `staktrakr.com/data/spot-history-YYYY.json` (origin-local, SW line 209), while `api.js:2978` fetches from `api.staktrakr.com/data/spot-history-YYYY.json` (SW line 203). Same data shape, different hosts and SW branches.
- **Poller cadence**: Read `devops/pollers/home-poller/docker-entrypoint.sh:29-33` — spot every 30 min, retail every hour, goldback daily, providers every 5 min.
- **api2 host is real traffic**: `constants.js:533-534` lists both endpoints; `api.js:36-59` iterates over both with 5-second timeout fallback.
- **Test feasibility**: Playwright suite runs against `file://` (AGENTS.md), which cannot activate service workers. Testing SW behavior requires a local HTTP server or Node-level unit tests of extracted pure functions.

### Top concerns

1. **AC-1 is already satisfied and should be deleted or collapsed into AC-2.** The existing sw.js:203 branch is explicit and distinct from the local-origin fallback. Keeping AC-1 as a standalone criterion implies the spec must deliver something that already exists.
2. **AC-2 endpoint paths are fiction, not code.** `/slug/*/detail`, `/historical/*.json`, and `/hourly/*.json` do not exist. The live paths are `/v2/retail/<slug>/{latest,history-30d,intraday}.json`, plus `/v2/goldback/latest.json`, plus the dual spot-history paths. Approach.md will build a router against imaginary URLs if this is not fixed.
3. **AC-3 introduces unscoped infrastructure work.** Enforcing per-entry TTL requires a mechanism that does not exist in sw.js today. The cost delta between sidecar timestamps (new storage system), Date-header parsing (fragile, depends on server config), and wrapped Response with `x-cached-at` (self-contained but requires refactoring `fetchAndCache`) is large enough that requirements must either pick one or explicitly defer to discovery.

### KIMI — Unverified Assumptions

- That the sketch's scope is limited to `api.staktrakr.com` only. sw.js:203 currently applies identical policy to `api2.staktrakr.com`, and `spot.js:649` loads spot-history from `staktrakr.com` (a third host). If these are intentionally excluded, the non-goals must say so.
- That TTL values in AC-2 (24h / 5-10m / 1h / 7d / 1h) are optimal. I verified poller cadence but not whether these TTLs were derived from it. The 7-day "historical" TTL conflates two distinct data shapes with different immutability guarantees.
- That the `sw.js` version-purge (sw.js:147) and new per-endpoint TTLs are additive rather than conflicting. A release bumping `CACHE_NAME` would invalidate all per-endpoint ceilings simultaneously — requirements should state whether this is acceptable.
- That AC-5 can be satisfied without cache observability. The non-goal explicitly excludes cache-hit/miss logging, but verifying "cached fallback behavior" requires knowing whether a response came from cache or network. Reconcile this tension before approach.md defines the test file map.

### Codex

#### Inline marks (verbatim)

> CODEX: There is one more TTL source that requirements should not skip: v2 API envelopes already expose `stale_after`, and `api-health.js:56-118` uses it as the freshness source for manifest, spot, and goldback. DocVault also records current v2 stale thresholds as manifest 30m, spot 20m, retail 30m, and goldback 25h in `Projects/StakTrakr/Foundation/data-pipelines.md:55-64`. The hard-coded AC-2 TTLs conflict with that existing contract, especially "manifest 24h" versus the documented/consumed 30m `stale_after`. Requirements should decide whether the service worker honors response-provided `stale_after`, imposes separate SW ceilings, or uses a fallback only when the envelope/header is absent.

> CODEX: Update the testability premise here: the live Playwright config does use an HTTP `baseURL` and `python3 -m http.server 3000`, but it globally sets `serviceWorkers: "block"` in `playwright.config.js:9-12`. There is precedent for a targeted SW-enabled test via `test.use({ serviceWorkers: "allow" })` in `tests/playwright/font-loading.spec.js:41-50`, so AC-5 can choose either an SW-enabled browser test or extracted router/unit coverage. As written, "tests or equivalent verification" still is not mechanically checkable, and any Playwright route mocking of `api.staktrakr.com` will only prove the page's fetch behavior unless the test explicitly allows and waits for the service worker.

> CODEX: Add a sixth requirements-level question: is the authoritative freshness source the endpoint envelope's `stale_after`, the service worker's endpoint-family table, or both? `api-health.js:62-65`, `api-health.js:83-86`, and `api-health.js:103-106` already prefer `stale_after` over hard-coded constants, while the current AC-2 writes independent TTL numbers. If the two disagree, the requirement needs a deterministic precedence rule before discovery or approach can define "fresh enough."

#### CODEX Review section (verbatim)

### Verified

- **Explicit SW API routing already exists**: `sw.js:202-205` routes `api.staktrakr.com` and `api2.staktrakr.com` through `staleWhileRevalidate`, so AC-1 is already true on the live branch.
- **No age gate in SW strategies**: `sw.js:227-282` writes and serves Cache Storage entries without reading response age, `Date`, or custom metadata; `sw.js:140-151` only purges whole versioned caches on activation.
- **v2 freshness contract already exists above the SW layer**: `api-health.js:56-118` reads `generated_at` plus `stale_after`, and DocVault records v2 stale thresholds in `Projects/StakTrakr/Foundation/data-pipelines.md:55-64`.
- **Endpoint paths differ from AC-2**: live consumers use `js/market-data.js:96`, `js/market-data.js:513-531`, `js/market-data.js:1403`, `js/api.js:68-69`, and `js/api.js:141-145`, not `/slug/*/detail`, `/historical/*.json`, or `/hourly/*.json`.
- **Playwright can run SW tests only when explicitly enabled**: the global config blocks service workers in `playwright.config.js:9-12`, while `tests/playwright/font-loading.spec.js:41-50` shows a targeted `serviceWorkers: "allow"` pattern.

### Top concerns

1. **TTL authority is unresolved.** AC-2 invents fixed TTLs that conflict with the existing v2 `stale_after` envelope contract and DocVault's documented thresholds. Requirements need a precedence rule before implementation can be correct.
2. **AC-1 and the issue premise still describe a missing branch that already exists.** The real work is sub-routing/classification plus freshness enforcement within the current API-host branch.
3. **AC-5 needs a concrete verification mode.** The test suite blocks service workers by default, so Playwright coverage must opt into SW activation and wait for control, or requirements should instead require extracted pure routing tests plus a documented integration check.

### CODEX — Unverified Assumptions

- That service-worker TTLs should be separate from, and allowed to override, the `stale_after` values already shipped in v2 API envelopes.
- That hard-coded TTLs in AC-2 are preferable to deriving SW freshness from response metadata with fallback defaults.
- That `api2.staktrakr.com` should always mirror the primary host's SW policy, rather than having an explicit failover policy.
- That cache-hit/miss observability can remain a non-goal while still proving AC-3 fallback behavior mechanically.
- That a Playwright SW integration test is worth the added setup compared with extracting a pure router/classifier from `sw.js` and keeping one smaller manual/browser verification step.

### Resolution Summary

- Accepted: 12 (Source Issue rewrite; Overview 4-host scope; AC-1→AC-2 collapse with renumber; AC-2 reworded in endpoint-family terms with TTLs deferred; AC-2 cites verified poller cadences as floors; new AC-2 (age gate) cites sw.js:147 baseline; AC-3 extended to preserve seed-data.js spot-history bundle bypass; AC-4 specifies two-mode verification (Node unit + Playwright SW with font-loading precedent); AC-5 documentation extended to all 4 hosts; observability non-goal tightened to allow temporary SW-internal instrumentation; zero-build / no-Workbox non-goal added; api2-parity non-goal added)
- Rejected: 0 (all findings either accepted directly or routed to Open Questions per user scope/strategy decisions)
- Resolved with your input: 4 (hosts/paths in scope = all four; freshness authority = defer to discovery as OQ-1; age-gate mechanism = defer to discovery as OQ-2; verification mode = Both Node unit + Playwright SW)
