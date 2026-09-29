---
sketch: "STRK-42-chart-viewport-scaling"
phase: discovery
created: 2026-05-10
---

# STRK-42 — Discovery

_Research the existing system and prior art. **Don't propose solutions** -- that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on. Include paths and a one-line note on each._

| Path | Role | Notes |
|------|------|-------|
| `js/viewModal.js:14` | Price-history range registry | Defines the item detail modal ranges: 7d, 14d, 30d, 60d, 90d, 180d, 1Y, 5Y, 10Y, Purchased, All. |
| `js/viewModal.js:43` | Modal entry point | `showViewModal()` builds the modal, then renders or async-fetches chart data before calling `_createPriceHistoryChart()`. |
| `js/viewModal.js:583` | Chart context builder | `_getPriceHistoryContext()` derives `meltFactor`, reads global `spotHistory`, deduplicates spot entries by day, reads `itemPriceHistory`, and stores `purchasePerUnit` as `item.price`. |
| `js/viewModal.js:614` | Chart DOM builder | `_buildPriceHistorySection()` creates the `#viewPriceHistoryChart` canvas and stores chart inputs on `canvas._chartData`. |
| `js/viewModal.js:635` | Range controls | `_buildChartRangeBar()` and `_onChartRangePillClick()` clear custom date inputs, fetch data for the selected range, and re-render the same canvas. |
| `js/viewModal.js:664` | Custom date controls | `_buildChartDateRangePicker()` fetches full historical data for custom ranges and passes `fromTs`/`toTs` into chart filtering. |
| `js/viewModal.js:1486` | View-modal year cache | `_fetchYearFile()` prefers `window.fetchYearFile()` from `spot.js`, then falls back to local year JSON, XHR, and `https://staktrakr.com/data/spot-history-YYYY.json`. |
| `js/viewModal.js:1577` | Historical spot loader | `_fetchHistoricalSpotData()` merges year-file data with live `spotHistory`, deduplicates by day, and returns sorted `{ts, spot}` entries. For `days <= 180`, it first tries in-memory `spotHistory`; for longer ranges it loads historical files. |
| `js/viewModal.js:1652` | Chart construction | `_createPriceHistoryChart()` filters `allSpotEntries` by range/custom dates, builds melt, purchase, and retail datasets, and delegates base options to `createTimeSeriesChart()`. |
| `js/viewModal.js:1689` | Synthetic anchor branch | `isAllOrCustom = days === 0 || fromTs > 0 || toTs > 0` — only fires for All/Custom ranges. For bounded ranges like 1Y, no synthetic entry is prepended to extend the chart line to the window start. This is a likely root cause of the AC-3 symptom. |
| `js/viewModal.js:1733` | Dataset values | Melt data is `spot * meltFactor`; purchase line is a flat array of `purchasePerUnit`; retail data is sparse and snapped to nearest spot entry. |
| `js/viewModal.js:1802` | Dataset definitions | Purchase Price (`order: 3`), Melt Value (`order: 2`), and Retail Value (`order: 1`) all use `fill: "origin"`. Lower order draws later (on top). Purchase dashed line renders as a red dashed line visually on top of the melt fill band. |
| `js/viewModal.js:1844` | Shared chart utility call | Passes datasets and tick callbacks into `createTimeSeriesChart()`; chart-specific overrides are applied afterward at `js/viewModal.js:1870`. |
| `js/chart-utils.js:94` | Shared Chart.js wrapper | `createTimeSeriesChart()` builds a standard line chart with `scales.x.ticks` and `scales.y.ticks` only; it does not expose min/max/grace configuration today. Does NOT set `beginAtZero`. |
| `js/spot.js:624` | Shared historical cache | `historicalDataCache` and `fetchYearFile()` cache per-year seed/history data for consumers, including the view modal when `window.fetchYearFile` exists. |
| `js/spot.js:735` | Prior sparkline pattern | `getHistoricalSparklineData()` merges historical year files with live `spotHistory`, excludes cached entries for charts, and deduplicates by day with live data winning over seed. |
| `js/spot.js:1488` | Seed bundle loader | `_loadSpotSeedBundle()` expands `data/spot-history-bundle.js` into `historicalDataCache` so year lookups can resolve without network fetches. |
| `js/seed-data.js:10` | Seed year registry | `SEED_DATA_YEARS` spans 1968 through the current year; full reference history stays in cache/year files, while persisted runtime history is intentionally smaller. |
| `js/seed-data.js:7969` | Seed hydration | `loadSeedSpotHistory()` hydrates a storage-safe runtime window only for first-time users and otherwise leaves long-range historical data in the bundle/year-file cache. |
| `js/state.js:317` | Runtime spot state | `spotHistory` is a global array loaded from localStorage, not the complete historical source of truth. |
| `css/styles.css:6395` | Chart container sizing | `.view-chart-container` is fixed at 200px high on desktop and 160px on mobile; short chart height makes viewport padding more visible. |
| `tests/playwright/view-modal-numista-merge.spec.js:131` | Existing view-modal harness | Provides reusable patterns for seeding inventory and opening the item detail modal in Playwright. |
| `tests/playwright/view-modal-no-auto-resync.spec.js:107` | Existing view-modal regression | Confirms view modal can be opened cleanly with seeded inventory and page-error checks. |

### Testability

`_viewModalChartInstance` is declared with `let` in `js/viewModal.js` — NOT on `window`. Only `showViewModal` / `closeViewModal` are exposed globally. Tests must use `Chart.getChart(document.getElementById("viewPriceHistoryChart"))` to access the chart instance. `Chart` (capital C) IS globally available because `vendor/chart.min.js` loads as a plain `<script>` tag. The returned instance exposes `scales.y.min` / `scales.y.max` (effective rendered bounds) and `options.scales.y.suggestedMin` / `suggestedMax` (hints). Tests should assert on effective `scales.y.min`/`max` for visual truth.

### Data Checks

- Local `data/spot-history-2025.json` has 253 Silver entries from `2025-01-02 12:00:00` through `2025-12-31 12:00:00`, covering every month May-Nov 2025.
- Local `data/spot-history-2026.json` has 107 Silver entries from `2026-01-02 12:00:00` through `2026-05-10 12:00:00`.
- A 1Y window from `2025-05-10` through `2026-05-10` has 271 local Silver entries, first `2025-05-12 12:00:00`, last `2026-05-10 12:00:00`.
- The compact `data/spot-history-bundle.js` also contains the same 2025/2026 Silver month coverage. The 1Y symptom therefore does not appear to be caused by missing checked-in seed data for the May-Nov 2025 period.
- However, data presence in files does NOT prove the modal reads those entries at runtime under service-worker cache, seeded bundle, `window.fetchYearFile`, or remote fallback conditions. Implementation should verify live data hydration.

### Root Cause Analysis — 1Y Truncation

Two possible root causes identified:

1. **Fetch path (D-3):** `_fetchHistoricalSpotData()` falls through to `else` branch for 1Y, fetching 58 year files (1968–2026). While individual fetch failures return `[]` silently, the overhead and race conditions may cause intermittent data gaps.

2. **Synthetic anchor (newly identified):** `isAllOrCustom` at viewModal.js:1689 is `false` for bounded ranges (`days=365`). No synthetic entry extends the chart line to the window start. If localStorage `spotHistory` is sparse and year-file fetch hasn't fully populated, the leftmost melt data point could be months past the window start — producing exactly the reported symptom. This is the more likely root cause.

Both should be fixed: the fetch path for performance, the synthetic anchor for correctness.

## Prior Decisions

_Search mem0 and recent sessions for related decisions. Quote the relevant memory or commit, with date._

- 2026-02-15 — Prior sessionflow exploration mapped the view modal chart surface: range pills pass `days` into `_createPriceHistoryChart()`, chart inputs are derived from `spotHistory`, and the chart is rendered from `viewModal.js`. Current code has evolved since that session, but the same core surface remains.
- 2026-02-17 / 2026-02-24 — Prior sessionflow explorations established the spot-history architecture: `spotHistory` is runtime/localStorage state, while long-range reference data is loaded from bundled year files via `historicalDataCache` / `fetchYearFile()`. This matches current `spot.js` and `seed-data.js`.
- 2026-03-10 — `7b15dea3 refactor: migrate viewModal, card-view, spot charts to chart-utils (STAK-484)` moved the view modal onto shared Chart.js helpers. Any chart option change should account for the shared helper boundary.
- 2026-05-05 — `bc483072 chore(STRK-37): item detail modal — chart, catalog, serial number fixes (#1085)` recently touched `js/viewModal.js`; review this commit if approach needs intent around current item-detail chart behavior.
- 2026-05-08 — Memory note from STRK-67: when a sketch starts to look assumption-heavy, re-review the sketch against the real code before task generation. This discovery phase followed that pattern by checking `viewModal.js`, seed data, and existing tests before approach/tasks.

## External References

_Libraries, RFCs, design docs, third-party patterns worth borrowing from._

- [Chart.js Linear Cartesian Axis](https://www.chartjs.org/docs/latest/axes/cartesian/linear.html) -- primary docs for linear y-axis options available in Chart.js, including `grace`, `suggestedMin`, and `suggestedMax`.
- [Chart.js Area Chart / Fill Modes](https://www.chartjs.org/docs/latest/charts/area.html) -- primary docs for line-chart `fill` behavior such as filling to the scale `origin`.
- Bundled library: `vendor/chart.min.js` reports `Chart.js v3.9.1`; implementation should verify option compatibility against Chart.js 3 behavior, not only latest-doc examples.

## Constraints

_Things the implementation must respect: existing APIs, performance budgets, browser support, data shapes._

- Scope should stay in the item detail modal chart unless discovery during implementation proves the year-file fetch path is returning incomplete data at runtime.
- `item.price` is a per-unit USD purchase price; `meltData` is currently total melt value (`spot * weightOz * qty * purity`). Any bounds calculation must respect the existing displayed dataset semantics and the STRK-4 Lot/Each storage contract. The per-unit vs. total mismatch for qty > 1 items is a pre-existing architectural concern outside this sketch's scope.
- The chart has three visible-value families: purchase price, melt value, and optional retail value. Axis fitting must consider hidden/visible dataset behavior carefully so the retail line is not clipped or allowed to dominate unexpectedly.
- Short ranges (`7d` through `180d`) rely first on in-memory `spotHistory`; longer ranges rely on year files / seed bundle. Tests should cover both paths because the bug reports one short-range y-axis issue and one 1Y long-range issue.
- `spotHistory` persistence intentionally trims older seed entries to a runtime window; do not treat missing old entries in localStorage as missing historical data if `historicalDataCache` / year files have them.
- The view modal supports HTTP and `file://` workflows. Year-file loading uses fetch, XHR, and remote fallback; chart tests should not assume network is available unless explicitly marked `@network`.
- `createTimeSeriesChart()` is shared by other chart surfaces. Broadening its option API may affect retail, spot, and card chart callers; a local override in `viewModal.js` has a smaller blast radius.
- Service worker caches `data/spot-history-bundle.js` plus current year files and uses stale-while-revalidate for `data/spot-history*`; live/manual testing may see cached seed assets unless the app is force-refreshed.
- Chart container height is only 200px desktop / 160px mobile, so small axis-padding changes can visibly affect density and label overlap. At 160px, 5% padding consumes ~8px top and bottom — verify mobile visually.
- Existing view modal tests seed inventory but do not currently assert chart axis bounds or full rendered line coverage; STRK-42 needs a focused regression harness.
- `_fetchYearFile()` returns `[]` on total fetch failure. If all year-file fetches fail, `allSpotEntries` is empty and bounds computation must handle the empty-datasets case defensively.

## Open Questions

_None blocking._

Non-blocking verification notes for implementation:

- Reproduce the issue in Playwright or a local browser with a seeded ASE-like item (`price: 38`, Silver spot/melt around `$65-$70`) and check the Chart.js y-axis scale / rendered canvas before and after changes.
- Confirm whether the 1Y visual truncation is reproducible from current `dev` with cache disabled/cleared. Local files contain the expected May-Nov 2025 data, so a live repro should distinguish viewport/rendering behavior from fetch/cache behavior.
- Verify whether the synthetic-anchor fix (extending `isAllOrCustom` to bounded ranges) resolves the 1Y symptom independently of the fetch-path fix.

## Discovery Summary

The work lands primarily in `js/viewModal.js` around `_fetchHistoricalSpotData()` and `_createPriceHistoryChart()`, with `js/chart-utils.js` only involved if approach chooses to extend the shared chart wrapper. The short-range purchase-line issue is a Chart.js viewport/bounds problem on a small fixed-height canvas. The 1Y data symptom has two likely root causes: (1) over-broad fetch path (performance, possibly causing race-condition data gaps) and (2) missing synthetic anchor for bounded ranges (the `isAllOrCustom` branch doesn't fire for 1Y). Both should be fixed. Main care points: keeping purchase/melt/retail value semantics straight, covering both in-memory and year-file data paths, handling empty/degenerate data defensively, and avoiding shared chart-helper churn.

---

> **Phase complete.** Existing code mapped. Prior decisions surfaced. Open questions resolved. Root causes identified.
