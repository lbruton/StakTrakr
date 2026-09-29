---
sketch: "STRK-249-realtime-pricing-network-first"
phase: approach
created: 2026-06-27
---

# STRK-249 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The fix lands in **four already-mapped spots** (discovery §Discovery Summary), grouped into two load-bearing changes and two mechanical ones.

**1. Service worker → per-family network-first (AC-1/2/3).** The realtime choke point is `sw.js:217 → classifiedFetch (sw.js:385)`. Today every classified family runs cache-first-with-TTL: `matchWithAgeCheck` returns a fresh cached copy with no network call (`lastStrategy="cache-hit"`). We add an explicit **`networkFirst: true` descriptor flag** to the three realtime families in `sw-router.js`'s `FAMILY_TABLE` (`spot-latest`, `goldback-latest`, `retail-latest`), propagate that flag through `classifyEndpoint`'s returned descriptor, and branch in `classifiedFetch`: a network-first family **skips `matchWithAgeCheck`** and goes straight to `fetchAndCacheClassified` (network, `lastStrategy="network"`), falling back to the cached copy **only on fetch error** (`lastStrategy="network-fallback"`). The other seven families and all static assets are untouched. This keeps STRK-190's classifier fix and the envelope-freshness machinery intact while reversing only the _strategy choice_ for realtime pricing — restoring STRK-79's original network-first intent.

**2. Market-data failover + anti-short-circuit (AC-8/9, C-8).** The two raw api1-only fetches (`market-data.js:1702` goldback-G1, `:1188` retail-detail) are routed through the existing `_marketV2Fetch` helper (STRK-188), which delegates to `_staktrakrFetch(V2_API_ENDPOINTS, path, {validate})` for ordered api1→api2 failover. Critically, routing alone is **not sufficient**: with the SW now network-first, an api1 _network failure_ makes the SW return its stale cache as a `200`, which `_staktrakrFetch` would otherwise accept and stop — never trying api2 (the C-8 hazard). We close this by passing a **freshness `validate` gate** (the STRK-189 `_checkSpotEnvelopeFreshness` pattern) so a stale api1 envelope is rejected and failover proceeds to api2. This requires extending `_marketV2Fetch` to forward a `validate` option.

**3. Badge repaint (AC-4/5)** and **4. Premium seed (AC-6/7)** are localized one-spot fixes in `goldback.js` and `market-data.js` respectively — adding the missing `renderRatioChips()` repaint and seeding `_goldbackG1Rate` from the already-cached `goldbackPrices['1']` via the seconds-based freshness path AC-6 names.

## Key Decisions

| #       | Decision                                                                                                                                                                                                                 | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tradeoff                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1** | SW network-first via an **explicit `networkFirst: true` descriptor flag** on the three realtime `FAMILY_TABLE` entries, branched inside `classifiedFetch` — **not** the generic `networkFirst()` helper (sw.js:274).     | Keeps `lastStrategy` instrumentation centralized in `classifiedFetch` (C-3: online→`network`, offline→`network-fallback`); reuses `fetchAndCacheClassified`'s envelope-header synthesis + opaque-response handling (C-6); leaves the JS/CSS `networkFirst()` path unpolluted.                                                                                                                                                                                                     | Adds a per-family `if` branch in `classifiedFetch` and a new descriptor field that ripples into `sw-router.test.js`'s per-family expected objects.                                                                                                        |
| **D-2** | **Reject `floor: 0`** as the network-first mechanism.                                                                                                                                                                    | `matchWithAgeCheck` resolves `ttl = x-stale-after ?? family.floor`; production realtime envelopes carry `stale_after`, so `floor: 0` is ignored for them and cache-hits would still occur online. Only an explicit strategy flag forces fetch-first.                                                                                                                                                                                                                              | None — `floor: 0` simply does not satisfy AC-1 for envelope families; documented so tasks doesn't reach for it.                                                                                                                                           |
| **D-3** | Route `market-data.js:1702` + `:1188` through `_marketV2Fetch`, **and** pass a **strict** freshness `validate` gate (rejects by the realtime endpoint's own `generated_at`/`stale_after` budget — no `×6` slack).        | Routing alone leaves the C-8 short-circuit open (a stale SW `200` for api1 ends the loop before api2); a **strict** gate rejects the stale api1 SW-fallback so failover continues to api2. The looser STRK-189 spot policy (`stale_after×6`) is **not** reused as-is — it would accept a stale-but-not-days-old fallback and short-circuit api2 (the AC-8/AC-9 hazard CODEX flagged).                                                                                             | Couples the failover fix to the SW change; requires extending `_marketV2Fetch`'s signature and a **strict** goldback/retail envelope-freshness checker.                                                                                                   |
| **D-4** | Generalize `_checkSpotEnvelopeFreshness` (api.js:92) into a **shared envelope-freshness checker** parameterized by **strictness** (the `stale_after` multiplier + floor), reused for the goldback/retail validate gates. | One freshness algorithm, **two strictness regimes**: **spot** keeps its lenient `age <= max(stale_after*6, SPOT_MAX_PAYLOAD_AGE_MS)` (poller-lag tolerance); the **goldback/retail failover** gates pass a **strict** budget (reject by the endpoint's own `stale_after`, no `×6` slack) so a stale api1 SW-fallback is rejected and failover reaches api2 (AC-8/AC-9). Avoids three near-identical validators drifting apart while keeping each call site's strictness explicit. | Touches `api.js` (a shared module); the spot caller must keep passing its existing lenient config (`×6` multiplier, `SPOT_MAX_PAYLOAD_AGE_MS` floor) so its behavior is preserved; the checker grows a strictness parameter rather than hard-coding `×6`. |
| **D-5** | Badge repaint = **guarded** `renderRatioChips()` appended to `fetchGoldbackApiPrices` success path (goldback.js:481-486), mirroring `updateGoldbackFromSpot` (goldback.js:410).                                          | Smallest fix for AC-4; the spot path already repaints — this removes the API-path asymmetry. Guarded so a failed/empty fetch leaves the prior badge intact (AC-5).                                                                                                                                                                                                                                                                                                                | None material; one call site.                                                                                                                                                                                                                             |
| **D-6** | Premium seed reads `goldbackPrices['1']` via the **seconds-based `readFreshCachedGoldback`/`isGoldbackStale` path** (spot-ratio-math.js:52-58/44), **not** the 25 h `getGoldbackPriceInfo` reader (goldback.js:566).     | C-7: AC-6 explicitly mandates mirroring `readFreshCachedGoldback`; the two staleness windows must not be crossed. Split by connectivity: online → seed only when fresh+positive; offline → seed last-known plain (US-5 / Non-Goal #1, no marker).                                                                                                                                                                                                                                 | Seed must satisfy all three gated render sites (ticker `:386`, modal `:879`, vendor matrix `:1354`) + setter `:1708` (C-9), and the network correction (AC-7) must re-render.                                                                             |

## File Map

_Paths verified against the live tree (discovery §Existing Code). `sw-router.js` is at the **repo root**, not `js/`._

### New

- **(Optional)** a new `tests/playwright/core/*.spec.js` file — **only** if the locked-scope Tests 6a case (**gold-card GB chip present after the async goldback fetch resolves on a normal load**) does **not** fit `core/smoke.spec.js`. **Default: extend `tests/playwright/core/smoke.spec.js`** (lands near `smoke.spec.js:185-193` / `retail-market.spec.js:607-620`) — a new spec file is the exception, not the baseline. The coverage inventory (`tests/playwright/coverage-map.csv`) is **modified, not new** — see Modified.

### Modified

- `sw-router.js` (**repo root**) — add `networkFirst: true` to the `spot-latest`, `goldback-latest`, `retail-latest` entries in `FAMILY_TABLE`; propagate `networkFirst` through `classifyEndpoint`'s returned descriptor (the two `return { family, floor, hasEnvelope }` sites, ~`:129`/`:134`).
- `sw.js` — branch `classifiedFetch` (`:385`) on `family.networkFirst`: skip `matchWithAgeCheck`, go network-first, keep `lastStrategy` = `network` (online) / `network-fallback` (offline). No change to the other-family path or the generic helpers.
- `js/goldback.js` — guarded `renderRatioChips()` in the `fetchGoldbackApiPrices` success path (`:481-486`).
- `js/market-data.js` — (a) seed `_goldbackG1Rate` from cached `goldbackPrices['1']` at market-data init (before the un-awaited network fetch); (b) route the goldback-G1 fetch (`:1702`) and retail-detail fetch (`:1188`) through `_marketV2Fetch`; (c) extend `_marketV2Fetch` (`:11-33`) to forward a `validate` option to `_staktrakrFetch`; (d) supply the goldback/retail freshness validator (from D-4).
- `js/api.js` — generalize `_checkSpotEnvelopeFreshness` (`:92-104`) into a shared, floor-parameterized envelope-freshness checker (D-4); spot caller (`:109`) keeps its existing floor.
- `tests/unit/sw-router.test.js` — per-family expected objects gain `networkFirst` (`true` on the 3 realtime families; absent/`false` on the other 7); `FAMILY_TABLE.length` assertion unchanged (no new families).
- `tests/playwright/extended/service-worker.spec.js` — **rescope SC-4** (`:186`): a fresh `spot-latest` entry online now reports `network`, **not** `cache-hit`. Add `goldback-latest` + `retail-latest` online (`network`) and offline (`network-fallback`, via `browserContext.setOffline(true)` — C-5) coverage. **Leave SC-1 (`annual-spot-history` `cache-hit`, `:83`) unchanged** — protected by AC-3/C-1.
- `tests/unit/spot-ratio-chips.test.js` — must continue to pass (premium-seed touches the shared `resolveGoldbackRate`/`isGoldbackStale` freshness helpers); add a seed-path assertion only if the seed logic is extracted into a testable pure helper.
- `tests/playwright/coverage-map.csv` (**existing inventory — modified, not new**) — add/rescope a **row** for every Playwright test case added or rescoped (AGENTS.md, mandatory; only review catches a stale row). Already tracks `core/smoke.spec.js`, `core/retail-market.spec.js`, and `extended/service-worker.spec.js` (`:78`/`:82`/`:85`); there is **no** root-level `coverage-map.csv`.

### Deleted

- None.

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. localStorage shape (`goldbackPrices`), the v2 envelope contract, and the API payloads are all untouched. The change is purely client-side caching **strategy** plus two app-level fetch-routing fixes. The API is confirmed healthy (requirements §Source Issue).

## Tradeoffs Surfaced for Review

- **`networkFirst` descriptor flag vs. a separate `NETWORK_FIRST_FAMILIES` Set (D-1).** The chosen flag makes `FAMILY_TABLE` the single source of truth but changes `classifyEndpoint`'s return shape, forcing the `sw-router.test.js` per-family expected objects to be updated (locks the strategy contract, which is desirable). A `Set` in `sw.js` would avoid the return-shape churn but split family config across two files (drift risk). **Recommendation: the descriptor flag (SSOT).** Flagging in case you prefer to minimize the unit-test diff.
- **Freshness `validate` gate scope (D-3/D-4).** The gate is load-bearing for AC-8/AC-9 (without it, an api1-down + stale-SW-cache scenario silently won't fail over). **Resolved (CODEX review):** the failover gate must be **strict** — generalize `_checkSpotEnvelopeFreshness` in `api.js` into a checker **parameterized by strictness**, so spot keeps its lenient `stale_after×6` poller-lag tolerance while the goldback/retail failover gates reject by the endpoint's own `stale_after` (no `×6` slack). Reusing the loose spot policy as-is would accept a stale api1 SW-fallback `200` and short-circuit api2. The rejected alternative — a goldback/retail-local validator in `market-data.js` — avoids `api.js` blast radius but reintroduces near-duplication.

## UI Contract

**No new UI surface and no visual/layout/token change.** This is a behavioral fix to two **pre-existing** surfaces; appearance is identical, only _timing/presence on a normal (non-hard-refresh) load_ changes. The "Firefox Network tab" reference in the issue is a network diagnostic, **not** a UI mockup/prototype — there is no design artifact to bind to. The two affected surfaces are documented below so the Playwright/visual assertions trace to a contract rather than to AC prose alone.

### Mockup Artifacts

| Artifact | Path / URL | What it defines                                                                               |
| -------- | ---------- | --------------------------------------------------------------------------------------------- |
| _none_   | —          | No mockup/playground/prototype exists or is required (behavioral fix to existing components). |

### Named States / Screens

| State                                          | Description                                                                                                                                                                                                             | Mockup reference                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Gold card — GB chip painted (normal load)      | The gold spot card's goldback "GB" badge shows the current rate after `fetchGoldbackApiPrices()` resolves, **without** a hard refresh (AC-4).                                                                           | Existing component: `renderRatioChip` (`spot-ratio-chips.js:211`).                     |
| Gold card — GB chip unchanged on fetch failure | A failed/empty goldback fetch leaves the previously-rendered badge intact (no throw, no blank-out) (AC-5).                                                                                                              | Same component, guarded repaint.                                                       |
| Market table — premiums in lockstep            | Goldback premium cells (ticker `:386`, modal `:879`, vendor matrix `:1354`) render in the **same paint** as spot-based premiums when a fresh cached G1 rate exists (AC-6); the network fetch then corrects them (AC-7). | Existing cells: `_buildVendorPriceCell` / `_buildTickerItem` / `_buildModalVendorRow`. |

### Component / Token Requirements

- No new components, CSS, or design tokens. Reuses `renderRatioChips` / `renderRatioChip` and the three existing market-cell builders unchanged.

### Interaction Contract

- No new user interactions. The only observable behavioral change: fresh realtime pricing (badge + premiums) appears on a **normal page load**, where today it requires `Cmd/Ctrl+Shift+R`.

## Out of Scope (follow-up issues)

- **Spot-derived estimate badge in `api` mode** (`spot-ratio-math.js:95`, issue fix #4 / Non-Goal #1) — deferred; possible follow-up. Once the SW is network-first, the stale-cache case it would cover only occurs offline, lowering its value.
- **STRK-248** — goldback intraday price-history endpoint / `latest.json` hourly-overwrite data-model flaw. Separate issue; needs its own `/discover` + `/spec`. STRK-249 only _defers_ to it.
- **Broadening api2 failover** beyond the two confirmed `market-data.js` gaps — paths that already loop `V2_API_ENDPOINTS` (`goldback.js:422`, `api.js`, `retail.js:657`) are untouched (Non-Goal).

## Risk Notes

- **SW activation lag** → the network-first behavior only takes effect once the **new** service worker installs **and activates**; users on the prior SW keep cache-first until the update cycle completes. Mitigation: the `sw.js` cache version must bump (handled by the `/release` path / pre-commit hook — _not_ hand-edited here) so the new SW supersedes the old; verify activation in DevTools during `/deploy-verify`.
- **SW fetch interception in tests** → `page.route` **cannot** intercept SW-originated fetches (C-5); the offline-fallback (`network-fallback`) assertions must use `browserContext.setOffline(true)`. Inherited opaque-response ordering (`response.type === "opaque"` before `!response.ok`, C-6) is already handled by `fetchAndCacheClassified` — the network-first branch reuses it, so no new exposure.
- **`_marketV2Fetch` degenerate fallback** → its inline plain-fetch path (`:23-32`) runs only if `_staktrakrFetch` is undefined (api.js not yet executed) and does **not** apply the `validate` gate. Both files are `defer` and api.js loads after market-data.js, so by the time any fetch runs `_staktrakrFetch` exists (comment at `market-data.js:8-10`). Accept as a defensive degenerate path; the validate gate applies on the real `_staktrakrFetch` path.
- **Regression guard on SC-1** → only **SC-4** is rescoped; SC-1's `annual-spot-history` `cache-hit` must stay green (AC-3/C-1). A _global_ strategy flip would wrongly break it — the per-family flag (D-1) prevents that by construction.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch-tasks STRK-249`.

## Review Archive — approach (2026-06-27)

### Resolution Summary

- **Accepted: 1** — File Map coverage-map accuracy: the coverage inventory is `tests/playwright/coverage-map.csv` (**modified, not new**), and a new `tests/playwright/core/` spec file is **optional** (default: extend `core/smoke.spec.js`). Verified against the live tree (`coverage-map.csv` is the sole inventory; tracks the three specs at `:78`/`:82`/`:85`).
- **Rejected: 0** — both CODEX claims verified against live code (`js/api.js:92-104` confirms the `×6` slack; `js/api.js:42-59` confirms accept-first failover).
- **Resolved with human input: 1** — D-4 failover-gate strictness: **reparameterize the shared checker** so spot stays lenient (`stale_after×6`) and the goldback/retail failover gates reject by the endpoint's own `stale_after`. Updated D-3, D-4, and the Tradeoffs "Freshness validate gate scope" bullet accordingly.

### Inline marks (stripped from body — verbatim)

> CODEX: D-4's proposed `age <= max(stale_after*6, floor)` validator is too permissive for AC-8/AC-9's anti-short-circuit contract. Live `_staktrakrFetch` accepts the first endpoint whose `validate(json)` returns ok (`js/api.js:51-59`), and the new SW network-first fallback would return a cached api1 envelope as an ordinary 200 before `_staktrakrFetch` tries api2 (`sw.js:391-399`). Because the STRK-189 spot gate can still accept payloads older than their own `stale_after` window, a stale-but-not-days-old api1 SW fallback can still stop the failover loop. The approach should require the market-data goldback/retail validators to reject payloads stale by the realtime endpoint's own `generated_at`/`stale_after` budget, or otherwise detect SW fallback, before reusing the looser spot freshness policy.

> CODEX: The concrete coverage file is `tests/playwright/coverage-map.csv`, and the live map already tracks `tests/playwright/core/smoke.spec.js`, `tests/playwright/core/retail-market.spec.js`, and `tests/playwright/extended/service-worker.spec.js` there (`tests/playwright/coverage-map.csv:78,82,85`). Leaving this as bare `coverage-map.csv` plus a "New" directory entry can send tasks toward the wrong path or a new root file; make the file map explicit that the existing CSV is modified, and that a new core spec file is optional only if the case does not fit `core/smoke.spec.js`.

### CODEX Review (2026-06-27)

#### Verified

- Read `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/sketch-conventions.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, and the StakTrakr Foundation coding/design references.
- Resolved the sketch folder to `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/sketches/STRK-249-realtime-pricing-network-first`; read `requirements.md`, `discovery.md`, and `approach.md`.
- Checked live SW/classifier paths: `sw-router.js:9-140`, `sw.js:216-409`, `tests/unit/sw-router.test.js:30-271`, and `tests/playwright/extended/service-worker.spec.js:68-209`.
- Checked live goldback/market/API paths: `js/goldback.js:422-486`, `js/spot-ratio-math.js:38-96`, `js/spot-ratio-chips.js:122-368`, `js/market-data.js:1-33,374-388,856-880,1187-1204,1351-1356,1699-1718`, and `js/api.js:42-110`.
- Checked script ordering in `index.html:8773-8829` and Playwright coverage bookkeeping in `tests/playwright/coverage-map.csv:78-85`.

#### Top concerns

- D-4's reused STRK-189 freshness policy can still accept stale-by-`stale_after` api1 SW fallback payloads, allowing `_staktrakrFetch` to stop before api2 and undermining AC-8/AC-9.
- The File Map should name `tests/playwright/coverage-map.csv` as the existing modified coverage inventory and avoid implying a new root `coverage-map.csv` or mandatory new `tests/playwright/core/` file.

#### Unverified assumptions

- I did not inspect Plane STRK-249 live or hit the production API endpoints; this pass used the sketch artifacts plus current repo files.
