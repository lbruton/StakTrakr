---
sketch: "STRK-92-90d-vendor-history"
phase: requirements
created: 2026-05-21
---

# STRK-92 — Requirements

> **Source Issue:** [STRK-92](https://plane.lbruton.cc/lbruton/browse/STRK-92/)
> **Title:** Fill 90-day Market History All view with per-vendor data
>
> **Problem:** The Settings > Log > Market History "All" view should give new users a complete current picture from the data we already serve. The immediate user-facing bug is not that the app lacks a 90-day endpoint: v2 does publish `history-90d.json`, and the frontend does fetch it. The gap shown in the 2026-05-21 screenshots is that rows older than the 30-day endpoint have aggregate values but blank vendor columns, because the 90-day endpoint is aggregate-only.
>
> **Updated discovery verdict:**
> - **Collection is working:** the home poller writes retail snapshots hourly at `:30` and spot at `:15/:45`; Fly publishes every 15 minutes. The write path inserts into `price_snapshots` and does not delete from sqld.
> - **sqld is not being purged by the app code found in this audit:** the only `DELETE FROM price_snapshots` found is in `devops/pollers/shared/api-export.js`, and it prunes the publisher's local `prices-cache.db` mirror after syncing from sqld, not the sqld source-of-truth.
> - **90-day history is already partially done:** v2 emits `retail/{slug}/history-7d.json`, `history-30d.json`, and `history-90d.json`. The frontend fetches all three and "All" displays the merged local history.
> - **The immediate gap is publisher schema/detail:** `history-30d.json` is built with `buildDailyWithVendors()` and includes per-vendor daily breakdown. `history-90d.json` is built with `buildRetailOhlcaBuckets()` and strips `_vendorPrices`, so entries older than 30 days cannot populate the vendor columns in the history table.
> - **One-year history can remain a future extension:** as of 2026-05-21, sqld has retail history only back to `2026-02-21T16:15:00Z`. We can eventually publish 365d once enough data exists or after a backfill, but the current fix can focus on making the existing 90d All view complete.
>
> **Code evidence:**
> - `devops/pollers/shared/api-export-v2.js:634-640`: `history-30d.json` uses daily aggregates with vendors.
> - `devops/pollers/shared/api-export-v2.js:642-649`: `history-90d.json` uses daily OHLCA and removes vendor data.
> - `js/retail.js:818-827`: frontend already fetches `history-7d`, `history-30d`, and `history-90d`.
> - `js/retail.js:894-916`: frontend merges those fetched histories into one local array.
> - `js/retail.js:918-932`: frontend already preserves vendor data when a newer/finer entry lacks it.
>
> **Recommended implementation scope:**
> 1. Change `api-export-v2.js` so `retail/{slug}/history-90d.json` includes per-vendor daily breakdown, likely by reusing/generalizing `queryRetailDailyAggregates()` + `buildDailyWithVendors()` for 90 days.
>   > ANTIGRAVITY: Reusing and extending `queryRetailDailyAggregates()` for 90 days is highly optimal. Querying all hourly snapshots for 90 days via `queryRetailRange()` would fetch 90 days * 24 hours * 7 vendors = 15,120 rows per coin. Using the SQLite daily aggregate query with `GROUP BY date, vendor` retrieves only 90 * 7 = 630 rows per coin, a ~96% transfer reduction from SQLite to the exporter process.
> 2. Keep payloads daily, per slug, and avoid hourly/vendor detail for all 90 days unless intentionally needed.
> 3. Verify whether `js/retail.js` needs any change.
>   > ANTIGRAVITY: Checked [retail.js](file:///Volumes/DATA/GitHub/StakTrakr/js/retail.js#L894-L916). The frontend's history merging and deduplication logic is already fully capable of parsing and merging vendor objects from `history-90d.json` into the local history array. It will require no client changes.
> 4. Add/adjust Playwright coverage so an older-than-30-days entry in `history-90d.json` includes a vendor value and appears in the All table instead of dashes.
>   > ANTIGRAVITY: The current Playwright mock test in [stak-582-market-survivors.spec.js](file:///Volumes/DATA/GitHub/StakTrakr/tests/playwright/retail/stak-582-market-survivors.spec.js#L110-L134) uses an `oldDate` of 20 days ago, which is within the 30-day range. To properly cover AC-4, the test mock should be updated to include an entry at e.g., `daysAgo(45)` to ensure a row older than 30 days is rendered with vendor columns populated.
> 5. Update DocVault/API docs to describe 90d and clarify 30d/90d schema parity.
> 6. Leave one-year `history-365d.json` as a later enhancement.

## Overview

The Settings > Log > Market History "All" view displays 90 days of retail price history, but rows older than 30 days show dashes in the vendor columns because the `history-90d.json` endpoint serves aggregate-only OHLCA data without per-vendor breakdown. The data exists in sqld — the publisher simply discards it during 90-day export. This sketch makes the 90-day endpoint schema-compatible with the 30-day endpoint so the existing frontend renders vendor prices for the full 90-day window.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a stacker viewing Market History "All", I want to see per-vendor prices for all 90 days of history, so that I can compare dealer pricing trends beyond the most recent 30 days.
- **US-2:** As a new user opening Market History for the first time, I want the "All" view to show a complete picture from available data, so that I don't think vendor tracking only started recently.
- **US-3:** As a developer maintaining the retail data pipeline, I want the 90-day and 30-day endpoints to share the same schema, so that the frontend merge logic doesn't need special-case handling per endpoint.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1: 90-day endpoint includes vendor data (maps to US-1, US-3)
- **Given** sqld contains `price_snapshots` with per-vendor rows for a date older than 30 days ago
- **When** the v2 publisher generates `retail/{slug}/history-90d.json`
- **Then** entries for that date include a `vendors` object with per-vendor price data, matching the same schema as `history-30d.json` entries

### AC-2: Market History "All" renders vendor prices for older rows (maps to US-1, US-2)
- **Given** `history-90d.json` now includes vendor data for dates older than 30 days
- **When** the user opens Settings > Log > Market History and selects the "All" view
- **Then** rows older than 30 days display vendor prices in the vendor columns instead of dashes, wherever sqld had data for those vendors on those dates

### AC-3: 7-day and 30-day behavior unchanged (regression guard)
- **Given** the existing `history-7d.json` and `history-30d.json` endpoints
- **When** the v2 publisher generates these files after the change
- **Then** their schemas, entry counts, and vendor data remain identical to pre-change output, verified by automated regression test

### AC-4: Playwright test covers older-than-30d vendor data (maps to US-1)
- **Given** endpoint-specific test fixtures where `history-90d.json` includes a vendor-populated entry for a date >30 days ago that `history-30d.json` does not contain
- **When** the Market History "All" view loads
- **Then** the test asserts the older row's vendor column contains a price value (not a dash), proving the 90-day endpoint is the source of the older vendor data

### AC-5: API documentation updated (maps to US-3)
- **Given** the DocVault API Reference currently omits or understates the 90-day endpoint
- **When** documentation is reviewed post-implementation
- **Then** the API Reference documents `history-90d.json` with its schema (including vendor data), clarifies that 30d and 90d now share the same daily-with-vendors format, and corrects the stale `history-7d.json` description from "daily aggregates" to "hourly OHLCA buckets"

## Non-Goals

- **Not implementing `history-365d.json`** — sqld history only goes back to 2026-02-21; one-year history is a future enhancement once sufficient data accumulates.
- **Not adding hourly granularity to the 90-day endpoint** — daily aggregation is sufficient; hourly would balloon payload size for minimal user value at this time horizon.
- **Not changing the 7-day endpoint** — `history-7d.json` already uses a different aggregation strategy (finer granularity) and is not part of this scope.
- **Not backfilling sqld with historical vendor data** — this sketch works with whatever history sqld already has; missing vendor rows for old dates will still show dashes (that's correct behavior, not a bug).
- **Not modifying the v1 publisher** — v1's 31-day local cache prune is a separate concern; this work is v2-only.
- **Not preserving current 90-day OHLCA computation method** — switching from raw-sample OHLCA (via `buildRetailOhlcaBuckets`) to daily-average-based OHLCA (via `buildDailyWithVendors`) is an intentional tradeoff. The resulting OHLCA values for 90d entries will differ from pre-change output; this is accepted in favor of schema parity with the 30-day endpoint.

## Open Questions

_None — the issue body includes live API evidence, code paths, and schema analysis sufficient to proceed to discovery._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-92`.

## Review Archive — requirements (2026-05-21)

_Reconciled by /sketch reconcile on 2026-05-21. Original reviewer marks preserved below for audit._

### Antigravity

#### Verified Codebase Alignment
- **Publisher Script (`api-export-v2.js`):** Verified that `history-90d.json` is currently written using `buildRetailOhlcaBuckets(slug)` in [api-export-v2.js:642-649](file:///Volumes/DATA/GitHub/StakTrakr/devops/pollers/shared/api-export-v2.js#L642-L649). Replacing this with `queryRetailDailyAggregates` & `buildDailyWithVendors` over 90 days is correct.
- **Frontend Client (`retail.js`):** Confirmed in [retail.js](file:///Volumes/DATA/GitHub/StakTrakr/js/retail.js#L894-L916) that the UI merging logic handles incoming `vendors` objects properly. No client changes are needed to display vendor columns for older rows once `history-90d.json` exposes them.
- **Playwright Test Coverage:** Verified that [stak-582-market-survivors.spec.js](file:///Volumes/DATA/GitHub/StakTrakr/tests/playwright/retail/stak-582-market-survivors.spec.js#L110-L134) tests vendor history rendering. Adding a mock entry older than 30 days (e.g., `daysAgo(45)`) will verify AC-4 properly.
- **Documentation Gap:** Verified that `history-90d.json` is currently missing from API Reference.md (archived).

#### Top Review Concerns
- **Payload Size & DB Overhead:** Verified that using daily aggregates avoids database overhead issues (630 rows vs 15k+ hourly rows per coin query). Daily aggregation payload size for 90 days is tiny (~10-15KB), so performance is not a concern.
- **Schema Parity:** Reusing the same v2 daily aggregate query structure ensures the 90d schema aligns perfectly with the 30d schema.

#### Unverified Assumptions
- It is assumed `api-export-v2.js` is the sole publisher script generating v2 outputs; no other script modifies `history-90d.json`.

### Codex

#### Verified
- Confirmed the publisher mismatch: `history-30d.json` is built via `queryRetailDailyAggregates()` and `buildDailyWithVendors()`, while `history-90d.json` uses raw range rows, daily OHLCA buckets, and strips `_vendorPrices` before writing (`devops/pollers/shared/api-export-v2.js:634-649`, `devops/pollers/shared/api-export-v2.js:744-774`).
- Confirmed the frontend already fetches `history-7d`, `history-30d`, and `history-90d`, merges them in that order, preserves vendor data when a newer/finer duplicate lacks it, and renders vendor columns from `entry.vendors[vid].avg` (`js/retail.js:818-938`, `js/retail.js:1217-1258`).
- Confirmed the candidate Playwright surface exists, but its current mock serves the same history data for all three history endpoints and uses a 20-day "old" row (`tests/playwright/retail/stak-582-market-survivors.spec.js:18-19`, `tests/playwright/retail/stak-582-market-survivors.spec.js:110-134`, `tests/playwright/retail/stak-582-market-survivors.spec.js:353-368`).
- Confirmed the API Reference omits `history-90d.json` from the v2 endpoint table and currently describes 7d as daily despite the exporter using hourly buckets (`DocVault/Projects/StakTrakr/Foundation/Deep Dives/API Reference.md:293-312`, `devops/pollers/shared/api-export-v2.js:625-632`).

#### Top concerns
- AC-4 needs an endpoint-specific fixture expectation. Without separate 7d/30d/90d mocks, the test can pass while failing to prove that 90d is the source of older vendor data.
- AC-5 should correct the adjacent stale 7d documentation while adding 90d, because the endpoint table currently misstates the 7d granularity.
- The requirements depend on runtime sqld history being present beyond 30 days. That is fine as a Given, but implementation should not promise backfill or universal vendor coverage for dates where sqld lacks rows.

#### Unverified Assumptions
- sqld currently contains enough >30-day `price_snapshots` rows, across enough slugs/vendors, for a post-deploy smoke check to visibly demonstrate the fix outside a mocked test.
- Reusing `buildDailyWithVendors()` for 90d is acceptable even though its OHLCA values are computed from per-vendor daily averages rather than the raw intra-day samples used by current 90d OHLCA.
- Keeping monthly archive files aggregate-only is intentional because the Settings > Log > Market History All view does not fetch `retail/{slug}/{YYYY}/{MM}.json`.

### Qwen

#### Verified
- **Publisher schema mismatch confirmed**: `history-30d.json` uses `queryRetailDailyAggregates()` + `buildDailyWithVendors()` (`api-export-v2.js:634-640`) while `history-90d.json` uses `queryRetailRange()` + `buildRetailOhlcaBuckets()` + `_vendorPrices` strip (`api-export-v2.js:642-649`). The fix is to reuse the 30d pipeline for 90d.
- **Frontend merge logic is capable**: `js/retail.js:894-938` fetches all three history endpoints, merges by date, and preserves `vendors` from coarser entries when finer ones lack them. No client changes needed.
- **Vendor column rendering**: `_renderVendorHistoryTable` (`js/retail.js:1253-1258`) reads `entry.vendors[vid].avg` and `_fmtRetailPrice` (`js/retail.js:297-298`) renders `—` (em dash) for null/undefined — confirming the "dashes" symptom.
- **Playwright test gap**: `tests/playwright/retail/stak-582-market-survivors.spec.js:366-368` returns identical `historyRows[slug]` for all three history endpoints, and `oldDate` is only 20 days ago (line 19). The fixture already includes `vendors` objects (line 121), so the gap is endpoint-specific routing and date range.
- **API docs gap**: `API Reference.md:301-311` omits `history-90d.json` and misstates 7d as "daily aggregates" when the code uses hourly buckets (`api-export-v2.js:630`).
- **`buildDailyWithVendors()` output shape**: `api-export-v2.js:744-774` produces entries with a top-level `vendors` key (line 770), matching what the frontend reads. The OHLCA values are computed from per-vendor daily averages repeated `sample_count` times (lines 752, 766-767), not raw intra-day samples.
- **v1 publisher non-goal**: `DELETE FROM price_snapshots` only appears in `api-export.js` (v1 mirror), not in `api-export-v2.js`.

#### Top concerns
1. **AC-3 is not mechanically verifiable as written**: "Remain identical to pre-change output" needs a golden-file or snapshot test. Without one, regression detection relies on manual payload comparison.
2. **AC-4 needs endpoint-specific fixture isolation**: The current test's `responseForPath` returns the same data for 7d/30d/90d. If the fix only changes `oldDate` to 45 days without splitting fixtures, the test passes even if 90d still lacks vendor data.
3. **OHLCA semantics change for 90d**: `buildDailyWithVendors()` computes OHLCA from per-vendor daily averages (not raw samples), so 90d OHLCA values will differ from current 90d output. This is acceptable for the stated scope but should be documented as an intentional tradeoff, not an oversight.

#### Unverified Assumptions
- **sqld index on `(coin_slug, window_start)`**: `queryRetailDailyAggregates()` runs a `GROUP BY date, vendor` over a 90-day range. No index definition was found in this repo's codebase — the query plan depends on sqld's schema, which is managed externally. If no covering index exists, a 90-day scan could be slow for large `price_snapshots` tables.
- **`buildDailyWithVendors()` handles empty vendor days gracefully**: The function skips dates with no `allPrices` (line 764: `if (!allPrices.length) continue`). If a vendor has no snapshots for a given day, that vendor won't appear in the `vendors` object for that date — which is correct behavior but means the "All" view will still show dashes for that vendor on that day.
- **No other script writes `history-90d.json`**: The requirements assume `api-export-v2.js` is the sole publisher. Verified no other file in `devops/pollers/` references `history-90d.json`, but this depends on the deployment topology (home poller + Fly.io remote poller both use the shared module).

### Resolution Summary
- Accepted: 4 (AC-3 verification tightening, AC-4 endpoint-specific fixtures, AC-5 7d docs correction, OHLCA computation non-goal)
- Rejected: 5 (sqld index — discovery scope; empty vendor days — already covered by non-goal; sole publisher — discovery scope; sqld data availability — runtime concern; monthly archives — out of scope)
- Resolved with your input: 0
