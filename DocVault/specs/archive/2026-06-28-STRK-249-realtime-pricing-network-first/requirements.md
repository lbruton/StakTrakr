---
sketch: "STRK-249-realtime-pricing-network-first"
phase: requirements
created: 2026-06-27
---

# STRK-249 — Requirements

> **Source Issue:** [STRK-249](https://plane.lbruton.cc/lbruton/browse/STRK-249/)

## Source Issue (pasted at scaffold — 2026-06-27)

**Title:** Realtime pricing served stale by service worker cache-first (goldback badge missing + premium delay on normal load)

**Symptoms (both on a NORMAL load; both fixed by a hard refresh):**

- Gold spot card is missing its goldback badge on a normal page load. `Cmd/Ctrl+Shift+R` reliably makes the current goldback rate appear.
- Market/premiums table goldback premiums lag ~1–2s behind spot-based premiums, which render immediately.

**Root cause — service worker serving realtime pricing cache-first:**

- The SW (`sw.js` + `sw-router.js`) intercepts `api.staktrakr.com` and serves it **cache-first with a TTL**. The `goldback-latest` family has a **25-hour floor** (`sw-router.js` floor `90000`s; `sw.js` `matchWithAgeCheck`/`classifiedFetch`). On a normal load the SW hands back a stale cached copy; a hard refresh bypasses the SW and hits the network.
- **Key gotcha:** the init goldback fetch uses `fetch(url, { cache: "no-store" })` (`js/goldback.js:437`). `cache: "no-store"` only affects the **HTTP cache** — it does **NOT** bypass a service worker. So the SW still serves its Cache Storage copy.
- **Confirmed** in the Firefox Network tab: `goldback/latest.json` is served by the SW on a normal load.
- API is **healthy** — live `/v2/goldback/latest.json` returns today's `g1_usd: 8.18`, `generated_at` current, `source: goldback.com`. Purely a frontend/SW issue.

**Contributing frontend bugs:**

- **Badge never repaints:** `fetchGoldbackApiPrices()` success path (`js/goldback.js:481-486`) updates state (`saveGoldbackPrices`/`recordGoldbackPrices`/`syncGoldbackSettingsUI`) but **never calls** `renderRatioChips()`. The badge is painted earlier by `fetchSpotPrice()` (`init.js:762`) before the async goldback fetch resolves, so late-arriving fresh data is never drawn.
- **Separate, un-awaited market fetch:** the premiums table runs its own `fetch(V2_API + "/goldback/latest.json")` into `_goldbackG1Rate` (`js/market-data.js:1700-1715`, fired un-awaited at `init.js:821`), no fast fallback. Goldback premium cells are gated on `_goldbackG1Rate > 0` (`market-data.js:1354`), so they stay blank until that round-trip resolves — the ~1–2s delay. (This fetch also lacks `cache: "no-store"`.)
- **No api-mode fallback:** `resolveGoldbackRate()` returns `null` (no badge at all) on a stale cache in the default `"api"` mode (`js/spot-ratio-math.js:83-96`), with no spot-derived estimate fallback.

**Design decision (this session):** Realtime spot/market/goldback pricing is API-derived and should always reflect current values; there is no real benefit to serving it cache-first. The app already persists last-known values in **localStorage**, which covers offline display. These price endpoints should therefore be **network-first** (or stale-while-revalidate with a very short floor): fresh when online, cached copy only as an offline fallback — not removed from the SW entirely.

**Fix plan (ranked, from issue):**

1. **SW:** change the goldback (and other realtime price) endpoint families from cache-first-25h to **network-first / SWR with a short floor** (`sw-router.js` / `sw.js`). Primary fix for the hard-refresh symptom.
2. **Repaint badge:** add a guarded `renderRatioChips()` to the `fetchGoldbackApiPrices()` success path (`js/goldback.js`).
3. **Kill the premium delay:** seed `_goldbackG1Rate` from the already-cached `goldbackPrices['1']` immediately, then let the network fetch correct it (`js/market-data.js`); align its cache strategy with #1.
4. **Optional:** in `api` mode, fall back to a spot-derived estimate badge (marked estimated) when the cache is stale instead of hiding it (`js/spot-ratio-math.js`).

**Verification (from issue):**

- DevTools Network: `goldback/latest.json` hits the **network** (not the SW) on a normal load and shows today's `data.t`.
- Gold badge appears **without** a hard refresh; goldback premiums render in lockstep with spot premiums.
- `npm run test:core` + add a Playwright case asserting the gold-card GB chip is present after the async goldback fetch resolves on a normal load; add the `coverage-map.csv` row (AGENTS.md).

**Process (from issue):** Runtime code (`js/`, `sw.js`) → full discipline: worktree → PR to `dev`. Multi-file → `/sketch`-sized. Companion to the goldback intraday-history data-pipeline issue (STRK-248); that one needs its own `/discover` + `/spec`.

### Codex issue-review comment (2026-06-27) — backup API feed requirement

StakTrakr realtime pricing has **two hosted origins** (`api.staktrakr.com` + `api2.staktrakr.com`); every lookup must try the backup origin **before** falling back to SW cache, localStorage cache, stale rendered data, or calculated/spot-derived pricing.

- **Already correct:** `V2_API_ENDPOINTS` (`constants.js:561`, primary-first) → `api.staktrakr.com`, then `api2.staktrakr.com`; `_staktrakrFetch` (`api.js:42`) walks them; `goldback.js:422` loops them; `retail.js:657` picks first reachable; `sw.js:216` classifies both hosts (request strategy only — not app-level failover).
- **Confirmed gaps:** `market-data.js:1188` (retail detail) and `market-data.js:1702` (goldback) use the hardcoded primary-only `V2_API` (`market-data.js:5`), skipping the existing `_marketV2Fetch` failover helper (`market-data.js:11`, STRK-188).
- **Recommended AC:** every StakTrakr-hosted realtime price family used here must attempt `V2_API_ENDPOINTS` in order and only then fall back to CacheStorage/localStorage/stale UI/calculated paths.

### Locked scope decisions (2026-06-27 session — feed into Phase 1)

1. **SW** → network-first/SWR-short-floor for **ALL** realtime price families (spot / goldback / retail-latest) in `sw-router.js` + `sw.js`.
2. **Badge repaint** → guarded `renderRatioChips()` in `fetchGoldbackApiPrices()` success path (`goldback.js`).
3. **Premium delay** → seed `_goldbackG1Rate` from cached `goldbackPrices['1']` + align cache strategy (`market-data.js`).
4. **api2 failover (FOLD BOTH)** → route goldback `@1702` AND retail-detail `@1188` through the existing `_marketV2Fetch` helper (`market-data.js`).
5. **DEFER** → optional spot-estimate fallback (fix #4, `spot-ratio-math.js`) — out of scope; possible follow-up.
6. **Tests** → (a) Playwright case: gold-card GB chip present after async goldback fetch on normal load; (b) **direct SW-strategy assertion** (unit `tests/unit/sw-router.test.js` or extended `tests/playwright/extended/service-worker.spec.js`): an online request for each affected realtime family does NOT yield `lastStrategy = "cache-hit"`, and cached data is observed only after a network failure (`lastStrategy = "network-fallback"`); + `coverage-map.csv` row.

---

## Overview

StakTrakr's service worker serves the realtime price endpoints (`spot`, `goldback`, `retail-latest`) **cache-first** with long TTL floors — the `goldback-latest` family floors at 25 hours. On a normal (non-hard-refresh) load the SW therefore hands back a stale cached copy: the gold card's goldback badge is missing and the market table's goldback premiums lag ~1–2s behind spot premiums. This sketch flips those realtime families to **network-first** (cache retained only as an offline fallback), repaints the goldback badge when fresh data arrives, seeds the premium rate from cache so the table paints in lockstep, and routes the two `market-data.js` fetches that currently bypass the api1→api2 failover helper through it. The deferred estimate-badge fix and the goldback intraday-history data work are explicitly out of scope.

## User Stories

- **US-1:** As a StakTrakr user, I want the gold card's goldback badge to show the current rate on a normal page load, so that I don't have to hard-refresh to see accurate goldback pricing.
- **US-2:** As a StakTrakr user, I want the market table's goldback premiums to appear at the same time as spot-based premiums, so that the table isn't visibly incomplete for the first 1–2 seconds.
- **US-3:** As a StakTrakr user who is online, I want realtime prices (spot, goldback, retail) to always reflect current server values, so that a cached service-worker copy never shows me stale prices.
- **US-4:** As a StakTrakr user, I want every realtime price lookup to try the backup API origin (api2) before degrading to cache/stale/estimated data, so that a single-origin outage doesn't silently show me worse pricing.
- **US-5:** As a StakTrakr user who is offline, I want the app to keep showing the last-known prices, so that making pricing network-first doesn't break offline display.

## Acceptance Criteria

> Stated in **EARS** syntax. `<system>` = StakTrakr's frontend / service worker. Each line is individually testable and becomes a TDD Cohort B assertion downstream.

### Service-worker caching strategy

- **AC-1 (US-3, event-driven):** WHEN a controlled page requests a realtime price family endpoint (`/spot/latest.json`, `/goldback/latest.json`, retail `*/latest.json`) AND the network is reachable, the service worker SHALL return the freshly-fetched network response and SHALL NOT return a cached copy as the initial response — regardless of any freshness floor. A cached copy SHALL be served only after the network attempt fails (see AC-2).
- **AC-2 (US-5, unwanted):** IF the network is unreachable for a realtime price family request, THEN the service worker SHALL serve the most recent cached copy of that endpoint.
- **AC-3 (US-3, state-driven):** WHILE the SW caching change is applied, non-realtime families (static assets and the existing 24-hour reference families) SHALL retain their current cache-first strategy unchanged.

### Goldback badge repaint

- **AC-4 (US-1, event-driven):** WHEN `fetchGoldbackApiPrices()` resolves successfully, the system SHALL repaint the gold card's goldback badge so the freshly-fetched rate is displayed without a hard refresh.
- **AC-5 (US-1, unwanted):** IF `fetchGoldbackApiPrices()` fails or returns no usable rate, THEN the system SHALL leave the previously-rendered badge unchanged (no throw, no blank-out of an already-good badge) — the repaint is guarded.

### Market premium delay

- **AC-6 (US-2/US-5, event-driven):** WHEN market data initializes AND the network is reachable, the system SHALL seed `_goldbackG1Rate` from `goldbackPrices['1']` only when that cached entry is fresh and positive (mirroring `readFreshCachedGoldback()`, `spot-ratio-math.js:52-58`), so an online load never paints a stale premium. WHILE the network is unreachable, the system SHALL seed from the last-known `goldbackPrices['1']` even if stale, rendered plain (no stale/estimated marker — that marker is Non-Goal #1), preserving US-5. When a qualifying value exists, goldback premium cells render in the same paint as spot-based premiums.
- **AC-7 (US-2, event-driven):** WHEN the market goldback network fetch resolves with a fresh rate, the system SHALL update `_goldbackG1Rate` and re-render so the displayed premium reflects the latest rate.

### Backup-origin failover

- **AC-8 (US-4, event-driven):** WHEN the market-data goldback rate fetch runs, the system SHALL attempt `V2_API_ENDPOINTS` in order (api1 → api2) via `_marketV2Fetch` before falling back to cache/stale/estimated values, AND a stale service-worker cache response for the api1 origin SHALL NOT short-circuit the attempt on api2 (a SW stale-fallback for api1 SHALL NOT be treated as a successful api1 result that ends the failover loop).
- **AC-9 (US-4, event-driven):** WHEN the market-data retail-detail fetch runs, the system SHALL attempt `V2_API_ENDPOINTS` in order (api1 → api2) via `_marketV2Fetch` before returning a null / detail-less result, AND a stale service-worker cache response for the api1 origin SHALL NOT short-circuit the attempt on api2.

## Non-Goals

- **Not** implementing the spot-derived estimate badge fallback in `api` mode (issue fix #4) — deferred; possible follow-up. Once the SW is network-first, the stale-cache case it would cover only occurs offline, lowering its value.
- **Not** addressing the goldback intraday price-history endpoint / `latest.json` hourly-overwrite data-model flaw — that is **STRK-248**, which needs its own `/discover` + `/spec`.
- **Not** removing realtime endpoints from the service worker — they remain cached purely as an offline fallback (AC-2).
- **Not** changing any data feed, poller, or API payload shape — purely a frontend + service-worker change; the API is confirmed healthy.
- **Not** altering caching for static assets or the 24-hour reference families (AC-3) — only the realtime price families' strategy changes.
- **Not** broadening api2 failover beyond the two confirmed `market-data.js` gaps — paths that already loop `V2_API_ENDPOINTS` (`goldback.js:422`, `api.js`, `retail.js:657`) are untouched.

## Open Questions

_None block discovery. Scope was locked 2026-06-27 (see Source Issue block). Two decisions are deferred downstream by design:_

- _(approach) The exact revalidation mechanism that satisfies AC-1's fresh-while-online contract — pure network-first, or a classified strategy with an effectively-zero online floor (fetch-first on every online load) — for the realtime families. Classic serve-stale-first SWR is excluded by AC-1._
- _(discovery) The precise `sw-router.js` family entries and `sw.js` matcher paths that constitute the "realtime price families."_

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch-discovery STRK-249`.

## Review Archive — requirements (2026-06-27)

### Resolution Summary

- **Accepted (3):** A — direct SW-strategy test assertion added to locked-scope Tests (item 6); B — AC-1 tightened to fresh-while-online and the Open Question reframed (classic serve-stale-first SWR excluded); D — SW-stale-short-circuit guard added to AC-8 and AC-9.
- **Rejected (0):** none — all four code-existence claims verified true against the live repo (`spot-ratio-math.js:52-58`, `sw.js:281-289/386-399`, `api.js:42-59`).
- **Resolved with your input (1):** C — AC-6 seed constrained "split by connectivity, plain" (online: fresh + positive only; offline: last-known shown plain, no marker, per US-5 / Non-Goal #1).
- **Unverified Assumptions:** archived below as informational; no action taken — the scaffolded source-issue text stands as the requirements basis.

The original review is preserved verbatim below.

### CODEX Review (2026-06-27)

#### Verified

- Read `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, and `.context/sketch-conventions.md`.
- Resolved the sketch folder to `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/sketches/STRK-249-realtime-pricing-network-first`; `requirements.md` is currently untracked in the DocVault repo, so verification should use direct readback rather than relying on tracked diffs only.
- Checked `sw-router.js:9-90` and `tests/unit/sw-router.test.js:30-49,230-244`: the classified families include `spot-latest`, `spot-history-daily`, `goldback-latest`, `retail-latest`, `retail-intraday`, `retail-history-short`, and `retail-history-long`.
- Checked `sw.js:280-289,351-399`: existing SWR/classified paths can return cached responses before or after failed network attempts, and `lastStrategy` already exposes `cache-hit`, `network`, and `network-fallback` for testing.
- Checked `js/goldback.js:422-486`, `js/market-data.js:11-33,1187-1204,1351-1356,1699-1718`, and `js/api.js:42-59`: goldback API fetching loops endpoints, the two market-data paths still have primary-only fetches, and `_staktrakrFetch` accepts the first ok JSON response.
- Checked existing test surfaces in `tests/playwright/core/smoke.spec.js:185-193,268-288`, `tests/playwright/core/retail-market.spec.js:607-620`, and `tests/playwright/extended/service-worker.spec.js:176-209`.

#### Top concerns

- AC-1 allows "stale-while-revalidate with a short floor" even though SWR can still serve a cached response while online, which is the core normal-load failure mode.
- AC-8/AC-9 need to prevent SW stale cache fallback from short-circuiting app-level api1→api2 failover.
- AC-6 should define whether cached G1 seeding must be fresh/positive or whether stale last-known display is allowed only offline/visibly marked.
- Verification should include direct SW behavior coverage, not only the gold-card UI assertion.

#### Unverified assumptions

- I did not inspect Plane STRK-249 live; this review used the scaffolded source issue text in this requirements file plus live repo code.
- I did not verify the current production API payload timestamps because the requirements phase only needs the frontend/SW contract locked before discovery.
