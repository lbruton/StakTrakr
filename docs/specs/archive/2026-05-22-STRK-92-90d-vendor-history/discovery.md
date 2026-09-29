---
sketch: STRK-92-90d-vendor-history
phase: discovery
created: '2026-05-21'
---
# STRK-92 — Discovery

_Research the existing system and prior art. **Don't propose solutions** -- that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on._

### Publisher (server-side — home poller + Fly.io remote poller)

| Path | Role | Notes |
|------|------|-------|
| `devops/pollers/shared/api-export-v2.js:642-649` | 90-day history publisher | Currently uses `queryRetailRange()` → `buildRetailOhlcaBuckets(rows, "daily")` → strips `_vendorPrices`. This is the root cause — vendor data is discarded before write. |
| `devops/pollers/shared/api-export-v2.js:634-640` | 30-day history publisher | Uses `queryRetailDailyAggregates()` → `buildDailyWithVendors()`. Produces entries with a `vendors` object. This is the working reference for what 90d should look like. |
| `devops/pollers/shared/api-export-v2.js:625-632` | 7-day history publisher | Uses `queryRetailRange()` → `buildRetailOhlcaBuckets(rows, "hourly")` → strips `_vendorPrices`. Hourly OHLCA, no vendor data. Out of scope. |
| `devops/pollers/shared/api-export-v2.js:381-401` | `queryRetailDailyAggregates()` | SQL: `GROUP BY date, vendor` over `price_snapshots`. Returns one row per (date, vendor) with `avg_price`, `min_price`, `max_price`, `sample_count`, `in_stock`. Already parameterized by `startIso`/`endIso` — no changes needed to support 90 days. Note: `buildDailyWithVendors()` only uses `avg_price` — per-vendor `min_price`/`max_price` are discarded. This is an inherited 30d tradeoff, not new to this change. |
| `devops/pollers/shared/api-export-v2.js:367-379` | `queryRetailRange()` | SQL: `SELECT *` from `price_snapshots` ordered by `window_start, vendor`. Returns raw hourly snapshots — used by current 90d path but will be replaced. |
| `devops/pollers/shared/api-export-v2.js:744-774` | `buildDailyWithVendors()` | Groups daily-aggregate rows by date, builds OHLCA from repeated averages, attaches `vendors` object with `{avg, in_stock}` per vendor per day. Pure function — takes query output, returns entry array. |
| `devops/pollers/shared/api-export-v2.js:428-449` | `buildRetailOhlcaBuckets()` | Groups raw snapshots into hourly or daily OHLCA buckets, stores vendor prices in `_vendorPrices` (prefixed with underscore — intended as internal, stripped before write). Currently used by 90d path. **Naming convention:** `_vendorPrices` (underscore) = internal/stripped; `vendors` (no underscore) = public/retained. The strip pattern `({ _vendorPrices, ...rest }) => rest` at lines 631, 648 relies on this — approach must not rename the field. |

### Frontend (client-side)

| Path | Role | Notes |
|------|------|-------|
| `js/retail.js:818-827` | History fetch | Fetches `history-7d`, `history-30d`, `history-90d` in parallel via `_fetchV2Json()`. No change needed. |
| `js/retail.js:894-916` | History merge (`addHistory`) | Pushes all entries into a flat array, reading `entry.vendors || null`. Order is 90d → 30d → 7d (coarsest first). No change needed. |
| `js/retail.js:918-938` | Dedup by date | Uses a `Map` keyed by date. Later entries (finer granularity) overwrite earlier ones, but preserves `vendors` from the coarser entry if the finer one lacks them. This logic already does the right thing once 90d entries carry `vendors`. No change needed. |
| `js/retail.js:1253-1258` | Vendor column rendering | Reads `entry.vendors[vid].avg` per vendor. Returns `—` (em dash) via `_fmtRetailPrice()` when null/undefined. No change needed — will display prices once data arrives. |
| `js/retail.js:297-298` | `_fmtRetailPrice()` | Formats numeric values via `formatCurrency()`, returns `—` (em dash) for null/undefined. The "dashes" symptom comes from here when `vendors` is null. |
| `js/retail.js:568` | `getRetailHistoryForSlug()` | Returns `retailPriceHistory[slug] || []`. Simple accessor — no change needed. |
| `js/retail.js:1216-1229` | Timeframe filtering | "All" returns full `allHistory` array; numeric days filter by cutoff date. No change needed. |

### Tests

| Path | Role | Notes |
|------|------|-------|
| `tests/playwright/retail/stak-582-market-survivors.spec.js:12-19` | Date helpers | `daysAgo(20)` for `oldDate` — within 30-day window, so does not exercise the 90d-specific gap. Needs `daysAgo(45)` or similar to prove 90d is the vendor-data source for older rows (AC-4). |
| `tests/playwright/retail/stak-582-market-survivors.spec.js:110-148` | `historyRows` fixture | Both slugs use the same vendor-populated entries. `oldDate` is 20 days ago — falls within both 30d and 90d windows, so the test can't distinguish which endpoint provided vendor data even with per-endpoint mocks. |
| `tests/playwright/retail/stak-582-market-survivors.spec.js:353-368` | `responseForPath()` | Returns identical `historyRows[slug]` for all three history endpoints (`history-7d`, `history-30d`, `history-90d`). No endpoint-specific fixture differentiation — cannot prove 90d is the source of older vendor data. |
| `tests/playwright/retail/currency-switch.spec.js:287-303` | `responseForPath()` | Same endpoint-agnostic pattern — returns identical `historyRows[slug]` for all three history endpoints. Tests currency behavior, not history-source precedence. Whether it stays as-is or gets fixture isolation is an approach-phase decision. |

### Documentation

| Path | Role | Notes |
|------|------|-------|
| `DocVault/Projects/StakTrakr/Foundation/Deep Dives/API Reference.md:307-308` | v2 endpoint table | Lists `history-7d` and `history-30d` but omits `history-90d` entirely. Also misstates 7d as "daily aggregates" — code uses `buildRetailOhlcaBuckets(hist7dRows, "hourly")` at `api-export-v2.js:630`, producing hourly OHLCA, not daily. The doc update for this sketch must not copy the error. |

## Prior Decisions

- **2026-04-27 — Root-cause analysis (Claude Code session):** Confirmed that `price_snapshots` in sqld has no pruning, no TTL, no retention policy. The vendor data is not lost — only the published 90d file strips it. Fix shape identified: replace `buildRetailOhlcaBuckets` + strip with `buildDailyWithVendors(queryRetailDailyAggregates(...))` for the 90d path. File-size estimate: ~100–150 KB per slug per year with ~10 vendors.
- **2026-04-27 — STRK-9 (parallel issue):** Created for a broader API rebuild including yearly per-vendor archives at `retail/vendors/{vendor}/{slug}/{YYYY}.json`. That work touches the same publisher loop but adds new output paths — orthogonal to the current scope of fixing the existing 90d file.
- **2026-05-21 — STRK-92 issue clarification (Codex session):** Reshaped from "extend to one-year" to "fill 90-day All view with per-vendor data." User confirmed "All can also be 90 days to start" — the priority is filling vendor columns for the data we already have, not extending the time horizon.

## External References

- No external libraries or RFCs apply. This is a self-contained change to the publisher's query/builder pipeline — pure SQL + JS restructuring within the existing codebase.

## Constraints

- **Query efficiency:** `queryRetailDailyAggregates()` with `GROUP BY date, vendor` over 90 days returns ~630 rows per coin (90 days × ~7 vendors) vs. ~15,120 raw hourly rows from `queryRetailRange()`. The aggregate query is already used for 30d and scales linearly — 3× the date range, same query plan.
- **sqld schema and indexes:** The repo defines five indexes on `price_snapshots` in `sqld-client.js:75-81` (`idx_coin_window`, `idx_window`, `idx_coin_date`, `idx_coin_vendor_stock`, `idx_scraped_at`); `db.js:50-55` mirrors the first four for local SQLite. The `queryRetailDailyAggregates` query groups by `substr(window_start, 1, 10), vendor` — `idx_coin_date` should cover this. It already runs successfully for 30 days; 90 days triples the scan range. Given ~403k rows total (as of 2026-05-21), this is well within SQLite's capabilities. **Unverified assumption:** the deployed sqld database has the same index set as `initSqldSchema()`. Approach should decide whether a deployed query-plan verification step is needed.
- **Payload size:** Daily entries with vendor objects for 90 days ≈ 10–15 KB per slug (confirmed by the 30d file pattern). Well within acceptable limits for a file served from GitHub Pages / Fly.io CDN.
- **OHLCA semantics change:** Switching from `buildRetailOhlcaBuckets` (raw intra-day samples) to `buildDailyWithVendors` (per-vendor daily averages) changes how OHLCA is computed for 90d entries. Specifically: `buildDailyWithVendors` at `api-export-v2.js:752` replicates each vendor's single daily average `sample_count` times into `allPrices[]`. Since all replicated values are identical per vendor, the daily OHLCA degenerates to `open == high == low == close == avg` (flat bands). Charts consuming 90d OHLC shape will show no intra-day variation post-deploy. This is acceptable for the "per-vendor price column" goal and documented as an accepted tradeoff in requirements (Non-Goals section).
- **Deployment topology:** Only the Fly.io remote poller directly runs `api-export-v2.js` (via `run-publish.sh:33-37`). The home poller cron (`docker-entrypoint.sh:27-35`) runs retail scraping, spot extraction, goldback, provider export, and backup sync — it does NOT invoke `api-export-v2.js`. The home dashboard can trigger Fly's publish via the Machines API (`dashboard.js:2964-3003`), but that's an indirect path. A single code change to `devops/pollers/shared/api-export-v2.js` propagates on next Fly deploy — no home poller redeploy needed for this fix.
- **Frontend merge order + vendor-set union (IN SCOPE):** `addHistory()` processes 90d first, then 30d, then 7d (line 914-916). For overlapping dates (the most recent 30 days), the 30d entry overwrites the 90d entry's aggregates. The current merge logic at `retail.js:929-933` preserves coarser `vendors` only when the finer entry lacks vendors entirely — it does NOT union vendor sets. This means a departed vendor (scraped >30 days ago but not since) would disappear from the overlapping 30-day window because the 30d entry's `vendors` object completely overwrites the 90d entry's. **Fix required in this sketch:** change the dedup merge to union vendor sets (prefer finer entry's value per-vendor, but retain vendors from the coarser entry that the finer entry doesn't have). This adds a frontend change to the scope.
- **`history-7d.json` is untouched:** Uses hourly OHLCA from raw snapshots via `buildRetailOhlcaBuckets(hist7dRows, "hourly")` at `api-export-v2.js:630`. Different granularity, different builder. Out of scope per requirements. Note: the API Reference doc erroneously describes 7d as "daily aggregates" — the doc update for this sketch must correct this when adding the 90d entry.
- **Monthly archives remain aggregate-only:** `retail/{slug}/{YYYY}/{MM}.json` uses `buildRetailOhlcaBuckets` + strip. The Market History "All" view does not fetch monthly archives — they're a separate archival concern. Out of scope.
- **Frontend change required (vendor-set union):** While `addHistory()` and `_renderVendorHistoryTable` handle `vendors` objects from any source and will render 90d vendor data automatically, the dedup merge logic at `retail.js:929-933` needs modification to union vendor sets instead of overwriting. See "Frontend merge order" constraint above.

## Open Questions

_None blocking discovery._ The following are documented as **unverified assumptions** that approach should decide whether to verify:

1. **Deployed sqld index set** — the repo defines indexes in `initSqldSchema()`, but whether the live sqld database has the same set (particularly `idx_coin_date` for the daily-aggregate query) has not been confirmed against the running instance. Approach decides if a query-plan check is needed before or after deploy.
2. **Fly-only publish path** — discovery confirmed the remote poller is the sole direct invoker of `api-export-v2.js`. No deploy/runbook verification step appears needed beyond the standard Fly deploy, but approach should confirm.

## Discovery Summary

The primary fix is server-side in `api-export-v2.js`: replace the 90-day history path (lines 642-649) so it uses `queryRetailDailyAggregates()` + `buildDailyWithVendors()` — the same pipeline already proven by the 30-day history path (lines 634-640). Both functions are parameterized by date range, so extending from 30 to 90 days requires changing only the start-date calculation and swapping the builder call. A secondary frontend fix is also in scope: the dedup merge at `retail.js:929-933` must union vendor sets instead of overwriting, so departed vendors (scraped >30 days ago) are not lost on overlapping dates. The test gap is that `stak-582-market-survivors.spec.js` (and `currency-switch.spec.js`) use endpoint-agnostic fixtures with entries only 20 days old — endpoint-specific mocks with a >30-day entry are needed to prove 90d is the vendor-data source for older rows. The API Reference doc omits `history-90d.json` entirely and misstates the 7d granularity.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-92`.

## Review Archive — discovery (2026-05-21)

_Reconciled by /sketch reconcile on 2026-05-21. Original reviewer marks preserved below for audit._

### Antigravity

Review complete. Verified all file paths and symbols; no gaps found.

### Codex

#### Verified
- Confirmed the publisher mismatch: 30d uses `queryRetailDailyAggregates()` and `buildDailyWithVendors()`, while 90d uses `queryRetailRange()`, `buildRetailOhlcaBuckets(..., "daily")`, strips `_vendorPrices`, and writes aggregate-only output (`devops/pollers/shared/api-export-v2.js:381-400`, `devops/pollers/shared/api-export-v2.js:634-649`, `devops/pollers/shared/api-export-v2.js:744-774`).
- Confirmed the frontend fetches `history-7d`, `history-30d`, and `history-90d`, merges 90d before 30d before 7d, preserves coarser vendor data when a finer duplicate lacks it, and renders vendor cells from `entry.vendors[vid].avg` with an em dash for nullish values (`js/retail.js:297-298`, `js/retail.js:818-938`, `js/retail.js:1216-1258`).
- Confirmed the listed Playwright gap in `stak-582-market-survivors.spec.js`: `oldDate` is `daysAgo(20)`, the fixture includes vendor-populated rows, and `responseForPath()` serves the same history payload for all three history endpoints (`tests/playwright/retail/stak-582-market-survivors.spec.js:12-19`, `tests/playwright/retail/stak-582-market-survivors.spec.js:110-148`, `tests/playwright/retail/stak-582-market-survivors.spec.js:353-368`).
- Confirmed a missed adjacent mock with the same endpoint-equivalence shape in `tests/playwright/retail/currency-switch.spec.js:287-303`.
- Confirmed the v2 API Reference endpoint table lists `history-7d` and `history-30d` but omits `history-90d`, while the v2 manifest template supports `retail/{slug}/history-{N}d.json` (`DocVault/Projects/StakTrakr/Foundation/Deep Dives/API Reference.md:301-311`, `devops/pollers/shared/api-export-v2.js:985-1000`).
- Confirmed the repo does define `price_snapshots` indexes in both sqld and local SQLite helpers, contrary to the discovery constraint wording (`devops/pollers/shared/sqld-client.js:75-81`, `devops/pollers/shared/db.js:50-55`).
- Confirmed the remote publish script directly runs `api-export-v2.js`, while the home poller cron does not directly invoke it; the home dashboard instead triggers Fly's publish command (`devops/pollers/remote-poller/run-publish.sh:33-37`, `devops/pollers/home-poller/docker-entrypoint.sh:27-35`, `devops/pollers/home-poller/dashboard.js:2964-3003`).

#### Top concerns
- The sqld schema/index constraint is currently wrong. Approach should not reason from "no index definitions exist"; it should decide whether the existing `idx_coin_window` / `idx_coin_date` definitions are enough and whether deployed sqld needs verification.
- Deployment topology is overstated. A single shared code edit may be enough, but the discovery evidence points to Fly's publisher as the actual v2 export path, not two independent publisher imports.
- Test discovery is slightly incomplete because `currency-switch.spec.js` also encodes endpoint-agnostic history mocks. Leaving that unmentioned risks one test continuing to normalize the old behavior while AC-4 is hardened elsewhere.

#### Unverified assumptions
- The deployed sqld database currently has the same index set as `initSqldSchema()` / `CREATE_INDEXES`, or at least a query plan that keeps 90-day daily aggregation cheap enough for the publish cadence.
- The 403k-row table-size fact and 2026-02-21 oldest-history fact from the prior Claude/Codex issue analysis are still current enough for approach; I did not verify live sqld contents in this read-only sketch review.
- Fly.io publish is the sole writer for v2 `history-90d.json` in production, and home-poller involvement is limited to scraping/provider export/manual publish trigger rather than direct v2 JSON export.
- Keeping `retail/{slug}/{YYYY}/{MM}.json` aggregate-only is intentional even though it uses the same `_vendorPrices` strip pattern as the current 90d endpoint.
- `currency-switch.spec.js` does not need endpoint-specific history isolation because it is focused on currency behavior rather than history source precedence.

### DeepSeek

#### Verified

- Confirmed the root cause: 90d at `api-export-v2.js:642-649` uses `queryRetailRange()` → `buildRetailOhlcaBuckets(rows, "daily")` → strips `_vendorPrices`. Vendor data is computed but discarded (`api-export-v2.js:428-449`, `api-export-v2.js:642-649`).
- Confirmed the 30d reference path at `api-export-v2.js:634-640`: `queryRetailDailyAggregates()` → `buildDailyWithVendors()` produces entries with `vendors` objects.
- Confirmed `buildDailyWithVendors()` at `api-export-v2.js:744-774` groups by date, replicates `avg_price` `sample_count` times into `allPrices[]`, stores per-vendor `{avg, in_stock}` in `vendors`, and computes OHLCA from the replicated averages.
- Confirmed `buildRetailOhlcaBuckets()` at `api-export-v2.js:428-449` uses `vendorPrices` (no underscore for the internal accumulator) but writes `_vendorPrices` (with underscore) on the output object — the strip pattern `({ _vendorPrices, ...rest }) => rest` at lines 631 and 648 catches this correctly.
- Confirmed frontend `addHistory()` at `js/retail.js:894-938`: 90d first, then 30d, then 7d; `entry.vendors || null` at line 910; dedup at lines 920-936 preserves coarser vendor data only when finer data lacks vendors entirely — no union/merge of vendor sets.
- Confirmed render function at `js/retail.js:1253-1258` reads `entry.vendors[vid].avg` and `_fmtRetailPrice()` at `js/retail.js:297-298` returns em dash for null/undefined. No frontend code change needed.
- Confirmed `vendorIds` is populated from `_manifestVendorMeta` first, then falls back to scanning all history entries' `vendors` keys (`js/retail.js:1148-1165`). All known vendors get columns regardless of data availability.
- Confirmed `oldDate = daysAgo(20)` at `stak-582-market-survivors.spec.js:19` — within 30-day window, so cannot distinguish 90d from 30d even with endpoint-specific mocks. A >30-day entry (e.g., `daysAgo(45)`) is needed for AC-4.
- Confirmed `responseForPath()` at `stak-582-market-survivors.spec.js:366-368` returns identical `historyRows[slug]` for `history-7d`, `history-30d`, `history-90d`. Same pattern in `currency-switch.spec.js:301-303` (CODEX already flagged).
- Confirmed the repo DOES define `price_snapshots` indexes: `idx_coin_window`, `idx_window`, `idx_coin_date`, `idx_coin_vendor_stock`, `idx_scraped_at` at `sqld-client.js:75-81`; `db.js:50-55` mirrors the first four. The discovery's "no index definitions exist" constraint is false (CODEX already corrected).
- Confirmed the home poller cron at `docker-entrypoint.sh:27-35` does NOT invoke `api-export-v2.js` — only retail scraping, spot extraction, goldback, provider export, and Fly health check. The Fly publish script at `run-publish.sh:33-37` directly runs `api-export-v2.js` and `api-export.js`. The home dashboard can trigger Fly publish via Machines API at `dashboard.js:2964-3003`. The discovery statement at line 70 overstates the home poller's involvement (CODEX already corrected).
- Confirmed the v2 API Reference doc omits `history-90d.json` from both the v1 per-coin table and the v2 endpoint tree. The v2 7d entry says "daily aggregates" but code uses hourly OHLCA at `api-export-v2.js:630`. The v2 manifest template at line 994 covers all N via `retail/{slug}/history-{N}d.json` but doesn't explicitly list 90d.

#### Top concerns

1. **Vendor data loss in dedup merge for departed vendors.** After the fix, when 90d has vendors no longer in the 30d window, the dedup at `js/retail.js:920-936` overwrites 90d entries with 30d entries on overlapping dates, losing those extra vendors. The current merge preserves coarser vendors only when finer lacks vendors entirely — it does NOT union vendor sets. This needs explicit acknowledgment as a tradeoff (or a merge fix) in requirements.
2. **OHLCA flattening from `sample_count` replication.** `buildDailyWithVendors()` at `api-export-v2.js:752` replicates each vendor's single daily average `sample_count` times into `allPrices[]`, making all values identical and producing `open == high == low == close == avg`. Raw intra-day variation (currently present in 90d output via `buildRetailOhlcaBuckets`) will become flat bands. The discovery mentions "OHLCA values will differ" but doesn't capture this specific departure from genuine intra-day OHLCA. Charts and any downstream consumer of 90d OHLC shape will be affected.
3. **Test fixture `oldDate` is too recent.** At 20 days, the fixture entry falls within the 30-day window served by both endpoints. Even endpoint-specific mocks can't prove 90d is the vendor-data source for older rows. At minimum, a >30-day entry (e.g., `daysAgo(45)`) is needed to make AC-4 testable. Both the endpoint-agnostic mock issue (CODEX) AND the date-range issue (this finding) must be addressed together.

#### Unverified assumptions

- The deployed sqld database has the same index set as `initSqldSchema()` (`idx_coin_window`, `idx_window`, `idx_coin_date`, `idx_coin_vendor_stock`, `idx_scraped_at`) and the 90-day daily-aggregate query plan is acceptably fast for the publish cadence. (CODEX flagged same.)
- The 403k-row table-size estimate and 2026-02-21 oldest-data claim are still current. I did not query live sqld.
- Fly.io publish is the sole writer for v2 `history-90d.json` in production. The home poller does not directly run v2 export.
- `retail/{slug}/{YYYY}/{MM}.json` staying aggregate-only is intentional (uses `_vendorPrices` strip pattern without `buildDailyWithVendors`).
- `currency-switch.spec.js` does not need per-endpoint history isolation because it tests currency behavior, not history-source precedence.
- Losing departed-vendor data on the overlapping 30-day window (dedup merge behavior) is an acceptable tradeoff — the author should confirm explicitly.
- Changing 90d from raw `queryRetailRange()` rows to daily-aggregate rows won't cause any existing chart consumers to break due to the flatter shape of daily-vs-hourly OHLCA after `buildDailyWithVendors`.
- The `_vendorPrices` underscore-prefix convention (lines 445, 631, 648) will remain unchanged in `buildRetailOhlcaBuckets` so the strip pattern continues to work for 7d and monthly archives that still use it.

### Resolution Summary
- Accepted: 8
- Rejected: 0
- Resolved with your input: 1 (departed-vendor merge → fix in this sketch)
