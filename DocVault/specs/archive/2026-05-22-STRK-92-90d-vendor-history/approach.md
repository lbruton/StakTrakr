---
sketch: "STRK-92-90d-vendor-history"
phase: approach
created: 2026-05-21
---

# STRK-92 — Approach

_How we'll build it. **Don't write code or tests** -- the tasks phase produces the work plan._

## High-Level Architecture

The fix has two parts — a server-side publisher swap and a client-side merge improvement — both small and contained.

**Publisher (server-side).** The v2 publisher in `api-export-v2.js` already has two proven pipelines: `queryRetailRange()` → `buildRetailOhlcaBuckets()` for raw OHLCA (used by 7d and current 90d), and `queryRetailDailyAggregates()` → `buildDailyWithVendors()` for daily aggregates with per-vendor breakdown (used by 30d). The fix replaces the 90d path (lines 642–649) with the 30d pipeline, changing only the start-date calculation from 30 to 90 days. Both `queryRetailDailyAggregates()` and `buildDailyWithVendors()` are already parameterized by date range — no signature changes needed.

**Frontend (client-side).** The dedup merge at `retail.js:928–934` currently does an all-or-nothing vendor handoff: if the finer-granularity entry (30d) has _any_ vendors, it completely overwrites the coarser entry's (90d) vendors. This drops departed vendors — vendors that appear in the 90d window but not in the 30d window — for the overlapping 30-day date range. The fix changes this to a union: start from the coarser entry's vendors, then overlay the finer entry's vendors on top. Per-vendor, the finer value wins; vendors only present in the coarser entry are retained.

**Tests and docs.** The existing `stak-582-market-survivors.spec.js` test needs endpoint-specific mock fixtures (different data for 30d vs 90d) and a >30-day test entry to prove that 90d is the source of vendor data for older rows. The API Reference doc needs a `history-90d.json` entry and a correction to the 7d description.

## Key Decisions

| #   | Decision                                                                                                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                                                       | Tradeoff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Reuse `queryRetailDailyAggregates()` + `buildDailyWithVendors()` for 90d instead of writing a new builder                                                             | Zero new code; 30d pipeline is proven and already parameterized by date range. 630 rows per coin vs 15k+ raw rows = 96% fewer rows transferred from sqld.                                                                                                                                                                                                                       | 90d loses per-vendor intra-day variation: `buildDailyWithVendors` computes each vendor's daily average, then `computeOhlca` derives OHLCA from those averages. On multi-vendor days the OHLCA still reflects variation across vendors' daily averages (e.g., vendor A $33 vs vendor B $35 produces meaningful high/low). On single-vendor days, `open == high == low == close == avg`. Pre-change 90d had genuine intra-day variation from raw samples. Accepted tradeoff per requirements Non-Goals. |
| D-2 | Union vendor sets in the frontend dedup merge instead of all-or-nothing overwrite                                                                                     | Preserves vendor data on cutoff-day overlaps: dates that appear in both 90d and 30d may carry different vendor sets (e.g., a vendor present at the 30d boundary in the coarser window but absent from the finer window's scrape). Without the union, the finer entry's vendor set completely replaces the coarser set, dropping any vendors present only in the coarser window. | Slightly more complex merge logic (3 extra lines). Must handle null/empty `vendors` objects defensively. Edge case: if a departed vendor's avg is stale/misleading, the user still sees it — but showing data beats showing dashes for data we have.                                                                                                                                                                                                                                                  |
| D-3 | Endpoint-specific test fixtures (different mock data per history endpoint) instead of shared `historyRows`                                                            | AC-4 requires proving 90d is the source of older vendor data. Shared fixtures pass regardless of which endpoint provided the data. Tasks must include a concrete vendor-price assertion for the >30d row — row visibility alone is insufficient.                                                                                                                                | Slightly larger test fixture setup. `currency-switch.spec.js` keeps its shared fixtures since it tests currency behavior, not history-source precedence (verified: each spec defines its own local `responseForPath` — no shared helper code).                                                                                                                                                                                                                                                        |
| D-4 | Correct 7d API Reference description from "daily aggregates" to "hourly OHLCA" alongside the 90d addition, and update 30d description to mention per-vendor breakdown | Adjacent stale documentation — fixing it now prevents future confusion when a developer reads the endpoint table. Since 90d will mirror 30d's schema, both descriptions should mention the `vendors` field for consistency.                                                                                                                                                     | Slightly wider doc diff than strictly needed for STRK-92.                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- _none_

### Modified

- `devops/pollers/shared/api-export-v2.js` — replace 90d history block (lines 642–649): swap `queryRetailRange()` + `buildRetailOhlcaBuckets()` + `_vendorPrices` strip for `queryRetailDailyAggregates()` + `buildDailyWithVendors()`, matching the 30d pattern at lines 634–640
- `js/retail.js` — change dedup merge at lines 928–934: union vendor sets instead of all-or-nothing overwrite. **Note:** the `addHistory` ordering at lines 914–916 (90d → 30d → 7d) is load-bearing — the union spread direction depends on coarser entries being set first. This ordering must not be reordered.
- `tests/playwright/retail/stak-582-market-survivors.spec.js` — add endpoint-specific fixtures (30d mock without >30-day entries, 90d mock with a `daysAgo(45)` vendor-populated entry), split `responseForPath()` to return different data per endpoint, add assertion that the >30-day row renders vendor prices (concrete vendor-cell assertion, not just row visibility)
- `DocVault/Projects/StakTrakr/Foundation/Deep Dives/API Reference.md` — add `history-90d.json` to the v2 endpoint table with schema description, correct `history-7d.json` description from "daily aggregates" to "hourly OHLCA buckets", update `history-30d.json` to mention per-vendor breakdown _(DocVault repo — handled via `/vault-update` as a closing task, not committed in the StakTrakr PR)_

### Deleted

- _none_

## Data / Schema Changes

No database schema changes — no migration or persisted-data changes. The `price_snapshots` table and indexes are unchanged. The only change is which query/builder the publisher uses for the 90d output file. Additive API response schema change: the published `history-90d.json` gains a `vendors` field that already exists in 30d output.

## Tradeoffs Surfaced for Review

- **Per-vendor OHLCA flattening for 90d (D-1):** Post-change, 90d entries lose intra-day variation within each individual vendor — each vendor's samples are collapsed to a daily average. However, on days with multiple vendors whose averages differ, the OHLCA still reflects meaningful variation across those vendors. On single-vendor days, `open == high == low == close == avg`. If any downstream consumer (charts, exports) relies on genuine intra-day OHLCA variation from the 90d file, this change will flatten it per-vendor. Currently the only consumer is the Market History table, which displays `avg` — so no visible regression. Flagging in case there are consumers outside this codebase.
- **Departed-vendor visibility (D-2):** The vendor-union merge means users may see prices from vendors that no longer carry a product. The price is the last known average from when the vendor was still active. This is more informative than a dash, but could confuse a user who checks the vendor's site and finds the product gone. The alternative — showing dashes — is the current behavior and represents data loss.

## Out of Scope (follow-up issues)

- **STRK-9 — Per-vendor yearly archives:** Already tracked. Adds `retail/vendors/{vendor}/{slug}/{YYYY}.json`. Orthogonal to this fix.
- **`history-365d.json`:** Not enough sqld history yet (oldest data: 2026-02-21). Future enhancement once sufficient data accumulates.
- **Monthly archive vendor data:** `retail/{slug}/{YYYY}/{MM}.json` still uses aggregate-only `buildRetailOhlcaBuckets` + strip. Not fetched by Market History "All" — separate archival concern.
- **`currency-switch.spec.js` fixture isolation:** Tests currency behavior, not history-source precedence. Keeping shared fixtures is fine for its purpose. Verified: each spec defines its own local `responseForPath` — no shared helper code to break.
- **`avg_median` naming mismatch:** `retail.js:907` maps the API's `avg` (a mean from `computeOhlca`) to `avg_median`, but `retail.js:625` computes `avg_median` as a true median. Pre-existing naming issue, not introduced by STRK-92.

## Risk Notes

- **Risk:** Deployed sqld may not have the indexes that `queryRetailDailyAggregates` benefits from. → **Mitigation:** Both `idx_coin_date` on `(coin_slug, substr(window_start, 1, 10))` and `idx_coin_window` on `(coin_slug, window_start)` are created by `initSqldSchema()` which runs on startup. The query already works for 30d (same indexes). 90d triples the scan range — row count is an estimate; the 30d query's production performance is the better benchmark. Post-deploy, check Fly publish timing for any regression.
- **Risk:** The vendor-union merge could surface stale vendor data that confuses users. → **Mitigation:** The data is real (last known price), just old. The alternative (dashes) is worse — it hides data we have. If this becomes a UX issue, a future enhancement could annotate stale vendor entries.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-92`.

## Review Archive — approach (2026-05-21)

_Reconciled by /sketch reconcile on 2026-05-21. Original reviewer marks preserved below for audit._

### AGY

#### AGY Review (2026-05-21)

##### Verified

- Swapping the 90d publisher path to use `queryRetailDailyAggregates()` and `buildDailyWithVendors()` in [api-export-v2.js](file:///Volumes/DATA/GitHub/StakTrakr/devops/pollers/shared/api-export-v2.js#L642-L649) is verified. The pipelines are already parameterized.
- The dedup/merge point in [retail.js](file:///Volumes/DATA/GitHub/StakTrakr/js/retail.js#L928-L934) exists at lines 928-934, and the all-or-nothing overwrite behavior matches the description.
- Checked [stak-582-market-survivors.spec.js](file:///Volumes/DATA/GitHub/StakTrakr/tests/playwright/retail/stak-582-market-survivors.spec.js#L366-L368) and confirmed it uses a shared mock that does not distinguish endpoint source and uses a date well within the 30d window (`daysAgo(20)`), which necessitates endpoint-specific splitting to verify the 90d precedence correctly.
- Checked API Reference.md (archived) and verified that the `history-7d.json` description is currently listed as "daily aggregates" and needs to be corrected to hourly OHLCA buckets.

##### Top Concerns

1. **Frontend Union Merge Specifics**: We must make sure the union does not introduce empty object references or wipe out valid values if both arrays/objects are empty or undefined. Using a structured check ensures robustness.
2. **Test Isolation**: Splitting `historyRows` into endpoint-specific fixtures is necessary to prevent false-positive passes on the precedence of older vendor prices.
3. **OHLCA Flattening Tradeoff**: While OHLCA flattening is acceptable per requirements, any future chart or calculation downstream relying on genuine intraday high/low ranges for 90d history will receive flat bands. The documentation should clearly state this limitation.

##### AGY — Unverified Assumptions

- **Assumption 1**: It is assumed that the `price_snapshots` SQLite table has enough historical data for the 90-day window (i.e. older than 30 days) in production to make this change immediately useful. This is backed by general Turso storage expectations, but needs deployment confirmation.
- **Assumption 2**: It is assumed that downstream tools (e.g. external exports or custom scripting) do not consume `history-90d.json` expecting raw OHLCA bands without vendor info. Since the JSON envelope addition of `vendors` is additive and OHLCA fields are kept, this is highly likely to be backward-compatible, but remains an assumption.

### DEEPSEEK

#### DEEPSEEK Review (2026-05-21)

##### Verified

- **Publisher 90d path** at api-export-v2.js:642-649 uses `queryRetailRange()` + `buildRetailOhlcaBuckets("daily")` + `_vendorPrices` strip. The 30d pattern at lines 634-640 uses `queryRetailDailyAggregates()` + `buildDailyWithVendors()`. The swap is a direct replacement.
- **`queryRetailDailyAggregates`** (api-export-v2.js:381-401) is parameterized by `(client, coinSlug, startIso, endIso)` — no signature change needed for 90-day range.
- **`buildDailyWithVendors`** (api-export-v2.js:744-774) outputs `{ t, ts, open, high, low, close, avg, n, vendors }` — mechanically identical schema to 30d output.
- **`computeOhlca`** (v2-utils.js:54-72) returns `avg` as the MEAN (sum/length), not median. Both old and new publisher paths use the same function — no semantic change to `avg`.
- **Frontend merge ordering** (retail.js:894-916): `addHistory(hist90)` → `addHistory(hist30)` → `addHistory(hist7)`. The current merge at lines 928-934 does an all-or-nothing vendor handoff: if finer entry has vendors, coarser vendors are discarded entirely.
- **Test fixture** (stak-582-market-survivors.spec.js:366-368): `responseForPath()` returns identical `historyRows[slug]` for all three history endpoints. No endpoint-specific data differentiation exists.
- **API Reference** (API Reference.md:307): `history-7d.json` incorrectly described as "daily aggregates with OHLCA" — code confirms hourly granularity. No `history-90d.json` entry exists.
- **sqld indexes** (sqld-client.js:77-79): Both `idx_coin_window` on `(coin_slug, window_start)` and `idx_coin_date` on `(coin_slug, substr(window_start, 1, 10))` exist. `initSqldSchema` runs via `db.js:69` on every startup.
- **Frontend field mapping** (retail.js:907): `entry.avg ?? entry.close` is mapped to `avg_median` — the name is misleading since `avg` is a mean, not a median. Pre-existing, not introduced by STRK-92.

##### Top Concerns

1. **OHLCA characterization is imprecise.** D-1 and the Tradeoffs section describe "flat bands" (`open == high == low == close == avg`), but `buildDailyWithVendors` aggregates per-vendor daily averages. When multiple vendors have different daily averages (e.g., vendor A $33, vendor B $35), the OHLCA will reflect genuine high/low variation. The flattening is per-vendor (intra-day variation within a single vendor's samples is lost), not per-day. The tasks phase and any downstream documentation should use precise language.
2. **API Reference should update `history-30d.json` description too.** The approach correctly proposes fixing `history-7d.json` and adding `history-90d.json`, but the `history-30d.json` description at line 308 also omits mention of the per-vendor breakdown. Since 90d will now mirror 30d's schema, both entries should mention the `vendors` field for consistency.
3. **Merge ordering is load-bearing.** The union fix at retail.js:928-934 depends on the `addHistory` ordering at lines 914-916 (90d first, 30d second, 7d third). If this ordering were ever reordered (e.g., adding 90d last), the union spread direction would need to be inverted. The tasks phase should explicitly note that this ordering must be preserved.

##### DEEPSEEK — Unverified Assumptions

- **Assumption 3**: No external consumer (outside StakTrakr frontend, outside this codebase) parses `history-90d.json` and depends on the absence of the `vendors` field. The schema change is additive, but any external tool expecting the old shape would encounter new keys.
- **Assumption 4**: The `~403k rows` estimate for sqld scan volume is correct. This cannot be verified without querying production. The 30d query's actual performance is the better benchmark — 90d is 3× the date range.
- **Assumption 5**: `currency-switch.spec.js` will not silently break from the fixture split. It uses the same `responseForPath()` pattern but is correctly exempted in Out of Scope. However, if it shares helper code (e.g., the `responseForPath` function itself), splitting it for one test file could affect the other. The tasks phase should verify no shared helper is modified in a way that breaks currency-switch tests.

### CODEX

#### CODEX Review (2026-05-22)

##### Verified

- Confirmed the exporter mismatch: 30d uses `queryRetailDailyAggregates()` and `buildDailyWithVendors()`, while 90d still uses raw range rows, `buildRetailOhlcaBuckets(..., "daily")`, strips `_vendorPrices`, and writes aggregate-only JSON (`devops/pollers/shared/api-export-v2.js:381-400`, `:625-649`, `:744-774`).
- Confirmed the frontend fetches 90d, then 30d, then 7d, and the current dedup only preserves coarser vendors when the finer entry has no vendors at all (`js/retail.js:894-938`).
- Confirmed the main Playwright fixture uses a 20-day "old" row, serves the same `historyRows` payload for 7d/30d/90d, and currently asserts only row presence after selecting All (`tests/playwright/retail/stak-582-market-survivors.spec.js:18-19`, `:110-148`, `:353-390`).
- Confirmed `currency-switch.spec.js` has its own endpoint-agnostic `responseForPath()` and is not sharing that helper with the survivor spec (`tests/playwright/retail/currency-switch.spec.js:287-303`).
- Confirmed the v2 API Reference table omits `history-90d.json`, still calls 7d daily, and omits the `vendors` detail from 30d; the v2 manifest template already describes history files generically as `retail/{slug}/history-{N}d.json` (`DocVault/Projects/StakTrakr/Foundation/Deep Dives/API Reference.md:301-309`, `devops/pollers/shared/api-export-v2.js:983-995`).
- Confirmed the DocVault API Reference lives in a separate Git repository from StakTrakr, so it cannot be committed inside the StakTrakr patch worktree without an explicit cross-repo step.

##### Top concerns

1. The D-2 departed-vendor example is the wrong failure mode: a vendor seen only 45 days ago will not overlap a 30d date key, so tasks should test a >30d 90d-only row separately from any vendor-union behavior.
2. AC-4 needs a vendor-cell assertion, not just row visibility, because the current test already proves row presence and can still miss endpoint-source/vendor-shape regressions.
3. The file map crosses repo boundaries. The implementation plan needs to say how the DocVault API Reference update is handled outside the StakTrakr PR.

##### CODEX — Unverified Assumptions

- The 90d/30d cutoff-day overlap can actually produce different vendor sets in production often enough to justify the frontend union beyond future-proofing.
- No external client has a strict schema validator that rejects additive keys in `history-90d.json`.
- The DocVault API Reference update is intended to ship in the same human review cycle as the StakTrakr runtime patch, despite living in a separate repository.

### Resolution Summary

- Accepted: 9
- Rejected: 2 (AGY code snippet — implementation detail, not approach; DEEPSEEK Assumption 5 — verified false, no shared helpers)
- Resolved with your input: 0
