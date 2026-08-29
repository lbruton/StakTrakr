---
title: "StakTrakr — Reusable Patterns"
project: StakTrakr
audience: agent
canonical: .context/reusable-patterns.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/reusable-patterns.md" # historical provenance; migrated 2026-08-12
updated: "2026-07-24"
---

# StakTrakr — Reusable Patterns

Proven patterns that recur across the StakTrakr codebase. Covers vendor normalization, providers.json structure, the retail modal lifecycle, and shared UI abstractions. Read this before writing new retail, modal, or chart code.

---

## Vendor Normalization

### Vendor Identity

Vendor identity is always a short string key: `apmex`, `monumentmetals`, `sdbullion`, `jmbullion`, `herobullion`, `bullionexchanges`, `summitmetals`, `goldback`, `providentmetals`, `gainesvillecoins`, `mintbuilder`. These keys are used as-is across all maps, APIs, and localStorage.

### Four-Map Consistency Rule (was Three-Map; extended by STRK-322)

Every vendor must be present in all three frontend maps in `retail.js` **plus** the poller's manifest map. They share the same key set and must stay in sync:

- `RETAIL_VENDOR_NAMES` — `{ [vendorId]: displayName }` — drives iteration order everywhere
- `RETAIL_VENDOR_COLORS` — `{ [vendorId]: hexColor }` — brand colors for charts and legend swatches
- `RETAIL_VENDOR_URLS` — `{ [vendorId]: url }` — fallback homepage URLs
- `VENDOR_META` (`devops/pollers/shared/api-export-v2.js`) — feeds the published `manifest.json`; a missing entry silently emits the `{name: vid, color: "#94a3b8", url: null}` placeholder

**Adding a new vendor:** Update all four maps together in the same PR. A vendor missing from `RETAIL_VENDOR_NAMES` will not appear in the legend, forward-fill, anomaly consensus, or intraday table regardless of the other maps — `RETAIL_VENDOR_NAMES` keys drive iteration everywhere (only the two modal charts union-discover vendors from data).

**Test enforcement (STRK-322, v3.35.91):** a Playwright test in `tests/playwright/core/retail-market.spec.js` pins the three `retail.js` maps to the same key set with unique colors, and `devops/pollers/shared/api-export-v2-vendor-meta.test.mjs` pins every `VENDOR_META` entry's shape (name / hex color / https url). Half-registration now fails tests; full non-registration is still only caught by review. MintBuilder shipped half-registered (poller-only) from STRK-307 until STRK-322 closed the gap.

### Display Info Resolution Priority

`getVendorDisplay(vendorId)` resolves in this order:

1. `manifest._vendor_meta` (dynamic, from the API manifest)
2. `RETAIL_VENDOR_NAMES` / `RETAIL_VENDOR_COLORS` / `RETAIL_VENDOR_URLS` (hardcoded)
3. Fallback: vendor key as the label, `#6c757d` (gray) as the color

### Vendor URL Resolution (Two-Tier)

Used everywhere a vendor is linked (grid card rows, list view chips, retail modal legend):

```text
retailProviders[slug][vendorId]   // specific product page from providers.json
  || RETAIL_VENDOR_URLS[vendorId] // vendor homepage fallback
```

`providers.json` is fetched once per sync and cached in localStorage under `RETAIL_PROVIDERS_KEY`. If the fetch fails, the frontend falls back silently to homepage URLs — no user-visible error is shown.

Vendor links always open in a named popup: `window.open(url, 'retail_vendor_{vendorId}', 'width=1250,height=800,...)`. Falls back to `_blank` if the popup is blocked.

### Market Price Matrix — Column and Row Sort Order

`_renderVendorTable()` in `js/market-data.js` renders the vendor comparison matrix. Both axes are sorted alphabetically on every render (STRK-21, v3.34.39):

- **Vendor columns:** `Array.from(allVendorIds).sort((a, b) => _shortVendor(a).localeCompare(_shortVendor(b)))` — sorted by `_shortVendor()` display name (APMEX, BullionX, Gville, Hero, JM, Monument, Provident, SD, Summit). New vendors auto-sort into the correct column on next render. In the All-tab scope (STRK-75, v3.34.65), the vendor set is the deduplicated union across all enabled metal groups, still sorted by display name.
- **Item rows (per-metal tab):** `metalSlugs.sort((a, b) => String(a.meta.name || a.slug).localeCompare(String(b.meta.name || b.slug)))` — sorted by `meta.name`, falling back to slug if name is null. New items auto-sort into the correct row on next render.
- **Item rows (All tab, v3.34.65):** Grouped in metal priority order (`xau → xag → xpt → xpd → goldback`), then sorted by `meta.name` within each group using the same `localeCompare` comparator. Per-row `isoCode` is used for spot price lookup — premium math calls `_getSpotPrice(row.isoCode)` per row, not a single function-level metal code.

Prior to v3.34.39, both axes reflected data load order (Set insertion order for vendors, JSON key order for items), producing layout drift between page loads.

### Retail Price Currency Formatting

Retail source data remains USD, but active retail and market-price surfaces format display values through `formatCurrency()` or thin wrappers around it. `saveDisplayCurrency()` dispatches a `currencychange` event; market, retail history, inventory totals, spot sparklines, and Goldback settings subscribe locally instead of relying on Settings handlers to orchestrate every render path.

### OOS State

OOS detection happens in the poller. The frontend reads and persists it.

**OOS check pattern:** `retailAvailability[slug][vendorId] === false` means OOS. A missing key is treated as in-stock: `isAvailable = availability[key] !== false`. Never use `=== true` to check in-stock status.

**Persistence caveat:** `retailAvailability` is merged with `Object.assign` on each sync. Once a vendor is marked OOS in localStorage, it stays OOS until the next sync where `availability_by_site` explicitly sets it back to `true`. If the poller omits a vendor entirely, the prior stored state persists.

The active market surface is the vendor comparison matrix in `market-data.js`. Its OOS cells render an `OOS` marker; the former card/list sort and medal rules were removed with the card-list view.

### OOS Rendering by Context

| Context                                    | Rendering                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| Retail modal legend (`_buildVendorLegend`) | 50% opacity, `<del>` for last-known price, red `OOS` badge                             |
| Daily history chart                        | `null` returned for OOS entries; `spanGaps: false` renders actual gap in Chart.js line |

### Goldback — Special Vendor

Goldback has a separate pipeline. Its price comes from `getGoldbackVendorPrice(slug)`, not from the standard `priceData.vendors` map. The former card-list injection and medal behavior were removed with that view.

Goldback staleness: `getGoldbackVendorPrice()` applies its 25-hour threshold to the local `goldbackPrices` cache. This is a separate legacy display path; API-envelope consumers use their v2 `stale_after` values.

Goldback slug parsing: `_parseGoldbackSlug(slug)` parses the pattern `goldback-{state}-{denomination}`. Supported denominations: `g0.25`, `g0.5`/`ghalf`, `g1`, `g2`, `g5`, `g10`, `g25`, `g50`. Unrecognized slugs return `{ weight: 0, metal: "unknown" }`.

**Goldback premium calculation (STRK-85, v3.34.80):** Two shared helpers in `js/market-data.js` unify premium math across all three render surfaces (ticker, Matrix, detail modal):

- `_calcMarketPremium(price, referenceRate)` → `((price - referenceRate) / referenceRate) * 100` or `null` if either arg ≤ 0
- `_premiumTierClass(pct)` → `"high"` (≥5%), `"mid"` (≥2%), `"low"` (<2%)

For goldback items, when no spot price + weight is available, the reference rate falls back to `_goldbackG1Rate` (the G1 USD value from `goldback/latest.json`, loaded by `initMarketData()`). CSS tier colors: low → `--success`, mid → `oklch(0.55 0.15 60)` (WCAG-AA amber), high → `--danger`.

---

## providers.json

### Role and Source of Truth

`providers.json` defines which vendors to scrape for each coin, the URL for each vendor/coin pair, and coin weights for price-per-oz normalization. **As of STAK-348 (2026-02-25), sqld is the single source of truth.** The JSON files are generated snapshots — do not edit them directly.

To update provider URLs: use the dashboard at `http://192.168.1.81:3010/providers` or `provider-db.js` CRUD functions.

### Structure

```json
{
  "last_updated": "YYYY-MM-DD",
  "coins": {
    "ase": {
      "name": "American Silver Eagle",
      "weight_oz": 1,
      "providers": [
        {
          "id": "jmbullion",
          "name": "JM Bullion",
          "urls": ["https://...", "https://..."]
        },
        {
          "id": "apmex",
          "name": "APMEX",
          "url": "https://..."
        }
      ]
    }
  }
}
```

### `url` vs `urls`

| Field  | Type   | When to Use                                                 |
| ------ | ------ | ----------------------------------------------------------- |
| `url`  | string | Single stable URL (random-year / dates-our-choice SKUs)     |
| `urls` | array  | Multiple fallback URLs (year-specific SKUs that may go OOS) |

Never set both on the same entry. The scraper tries `urls` in sequence — first successful price stops the loop.

**Prefer random-year / dates-our-choice SKUs** — they stay stable year-over-year and typically represent the best price.

### Year-Start Exception: Monument Metals

Monument Metals runs parallel SKUs. At year-start (Jan–Mar), random-year SKUs go to pre-order; year-specific is the only in-stock option. Switch to year-specific until bulk random-year stock returns (typically March–April).

### JMBullion Pre-Order Tolerance

JMBullion marks some coins as "Presale" at year-start but still shows purchasable prices. These are not OOS. Affected coins: `buffalo`, `maple-silver`, `maple-gold`, `krugerrand-silver`.

Preorder tolerance is resolved **per vendor** by `resolvePreorderTolerant()` (`devops/pollers/shared/price-extract-shared.js:106-110`, consumed at `:214`): a `preorderTolerant` field on the vendor descriptor wins, and `LEGACY_PREORDER_TOLERANT_PROVIDERS` (`:72`) is only the fallback. That legacy set holds **two** vendors — `jmbullion` and `monumentmetals`. There is no `PREORDER_TOLERANT_PROVIDERS` constant.

Poller-side (STRK-334), `jmbullion` prices are FBP-sourced rather than JM-direct scraped: `price-extract-vendor-jmbullion-fbp.js` follows the standard `MIGRATED_VENDOR_MAP` `scrape(context)` contract and consumes a `context.fetchFbpPage` seam (see `.context/data-pipelines.md`).

### Frontend Consumption

The frontend fetches `providers.json` once per sync and caches it in localStorage. The modal uses `retailProviders[slug][vendorId]` for deep-link URLs, falling back to `RETAIL_VENDOR_URLS[vendorId]`.

---

## Market Detail Modal Range Model

The Market Detail Modal rendered by `js/market-data.js` is distinct from the older two-tab Retail Modal rendered by `js/retail-view-modal.js`. Its selected range controls are fixed in this order: **24H, 7D, 30D, 60D, 90D**, with **7D** selected on every open.

`_fetchModalData(slug)` fetches the current detail snapshot, intraday history, `history-30d.json`, and `history-90d.json` independently through `_marketV2Fetch()`. The shared fetcher retains ordered api1 → api2 failover. A failed source disables only the periods that depend on it:

- **24H:** `intraday.json`, using raw per-Vendor observations.
- **7D / 30D:** `history-30d.json`, using the latest per-Vendor daily average for each UTC date.
- **60D / 90D:** `history-90d.json`, using the latest per-Vendor daily average for each UTC date.

`_buildMarketDetailRangeModel()` is the single normalization boundary for both the chart and the four summary values. It:

- applies an exact timestamp window rather than slicing by row count;
- accepts only finite positive Vendor prices;
- deduplicates daily rows by Vendor plus UTC calendar date, keeping the greatest parsed timestamp and using source-last order for equal timestamps;
- computes Median, Low, High, and Spread from the accepted raw-USD observations; and
- emits the per-Vendor series consumed by `createVendorIntradayChart()` or `createVendorHistoryChart()`.

Keep summary calculation and chart series attached to this same model. Converting or filtering them independently can make the displayed summary disagree with the plotted observations. Currency conversion happens only at the display boundary, and the current Vendor comparison table remains sourced from the latest snapshot rather than the selected historical window.

Every selected-range render destroys the prior Lightweight Charts instance before rebuilding it. Closing the modal also increments the render generation and destroys the active chart, preventing a late async response from reopening or repopulating a stale modal.

---

## Retail Modal

### Legacy compatibility modal — `retail.js` vs `retail-view-modal.js`

The active per-coin product-detail experience is the **Market Detail Modal** in
`js/market-data.js`; its matrix click handler calls `openMarketDetailModal(slug)`.
`retail-view-modal.js` remains loaded, exported, and test-covered as a legacy compatibility
surface. Do not use it for new product-detail work. Its maintenance notes are retained below
only for fixes to that legacy surface.

Script load order in `index.html` places `retail.js` before `retail-view-modal.js`.
`retail-view-modal.js` reads globals defined in `retail.js` through `window` — never use imports.

**`retail.js` owns:**

- All static coin and vendor configuration constants
- All module-level state (`retailPrices`, `retailPriceHistory`, `retailIntradayData`, `retailProviders`, `retailAvailability`, etc.)
- All localStorage persistence helpers (`saveRetailPrices`, `saveRetailIntradayData`, etc.)
- Full sync pipeline (`syncRetailPrices`)
- Retail data cache and market-filter persistence; `market-data.js` renders the vendor comparison matrix from that persisted filter state (STAK-515)

**`retail-view-modal.js` owns:**

- Per-coin detail modal only: open, close, tab switch, chart render, table render, vendor legend
- Intraday data processing pipeline: `_trimTo24h`, `_bucketWindows`, `_forwardFillVendors`, `_flagAnomalies`
- Both Chart.js instances: `_retailViewModalChart` (daily history), `_retailViewIntradayChart` (24h intraday)
- Background refresh on modal open (per-coin only)

### Legacy Modal Open Sequence

`openRetailViewModal(slug)`:

1. Read `RETAIL_COIN_META[slug]` — returns early if slug not found
2. Populate title (`#retailViewCoinName`) and subtitle (`#retailViewModalSubtitle`)
3. Remove any stale `.retail-stale-data-warning` banner from the prior open
4. Call `_buildVendorLegend(slug)`
5. Build 30-day history table (7 columns: date, avg_median, avg_low, apmex, monument, sdb, jm)
6. Destroy `_retailViewModalChart` if exists, build daily history Chart.js chart
7. Call `_buildIntradayChart(slug)` — this also calls `_buildIntradayTable` internally
8. Wire row-count `<select>` dropdown (`#retailViewIntradayRowCount`)
9. Default to intraday tab via `_switchRetailViewTab("intraday")`
10. Open modal via `openModalById("retailViewModal")`
11. Fire async background refresh (`Promise.all` for latest.json + history-30d.json)

### Modal Close

`closeRetailViewModal()` must destroy both Chart.js instances before calling `closeModalById`. Skipping this causes "Canvas is already in use" on the next open and may prevent chart rendering entirely.

### Chart.js Instance Management

Both chart instances are module-level variables. Always use `replaceChart()` from `chart-utils.js` — it destroys the existing instance before creating a replacement. Never assign a new `Chart()` to these variables directly.

### `_buildVendorLegend(slug)`

Clears its container on every call — must remain idempotent. Called on modal open and again after the async background refresh.

- Reads current prices from `retailPrices.prices[slug].vendors`
- Reads OOS state from `retailAvailability[slug]`
- Top-level `hasAny` guard: renders section if any vendor has either a non-null price or an OOS flag
- Per-vendor guard: rows with `price == null` are omitted (OOS-only vendors do not appear in the legend)
- In-stock vendors with a URL: rendered as `<a>` elements in a named popup window

### Intraday Pipeline (24h Chart)

```text
windows_24h (raw 15-min windows, up to 96 stored)
  → _trimTo24h()         filter to last 24h relative to newest entry timestamp
  → _bucketWindows()     60-min aligned slots, up to 24 entries, oldest first
  → _forwardFillVendors() gap fill; tags _carriedVendors: Set on each window
  → _flagAnomalies()     null out spikes; preserve originals in _anomalyOriginals
  → qualifiedVendors filter (exclude vendors with zero real non-carried prices)
  → _buildIntradayChart()
  → _buildIntradayTable()  (called internally — never call both independently)
```

**`_forwardFillVendors` is a pure function** — never mutates input objects. Shallow-copy each window before attaching `_carriedVendors`.

**Multi-hop carry logic (STAK-498):** Single-hop carries (previous window had real data) render as solid lines. Only 2+ consecutive missing windows (previous window also carried) render as dotted lines.

**`_trimTo24h` uses the newest data timestamp** — not `Date.now()`. This prevents multi-day spans when the API returns more data than expected.

### Anomaly Detection (Two-Pass)

Applied by `_flagAnomalies()` before intraday chart/table rendering:

**Pass 1 — Temporal spike detection:** At window `t`, if neighbors `t-1` and `t+1` are stable (within 5% of each other) but `t` deviates beyond 5% from their average → null the price; preserve in `_anomalyOriginals`.

**Pass 2 — Cross-vendor median consensus:** For windows with 3+ vendors, any vendor deviating more than 40% from the median is nulled. Guard: if all vendors would be flagged, none are (prevents false consensus collapse).

Constants: `RETAIL_SPIKE_NEIGHBOR_TOLERANCE` (default 5%), `RETAIL_ANOMALY_THRESHOLD` (default 40%).

### History (Price History Tab) Pipeline

```text
getRetailHistoryForSlug(slug)   → history[] (daily entries, newest first)
                                   today's entry patched with live vendor prices (full sync only)
  → reversed for chart (oldest first)
  → Chart.js per-vendor .avg lines (spanGaps: false for OOS gaps)
  → 7-column history table
```

**Price field disambiguation:**

| Context               | Field              | Source                                      |
| --------------------- | ------------------ | ------------------------------------------- |
| Live price (card row) | `vendorData.price` | `latest.json → priceData.vendors[id].price` |
| History chart (daily) | `vendorData.avg`   | `history-30d.json → entry.vendors[id].avg`  |

Never mix `.price` and `.avg` — they represent different aggregation windows.

> **Removed with the card-list view (v3.34.30, `45af18ef`, STAK-582 / PR #1028).** The 7-day
> trend card chart and its `_filterHistorySpikes()` three-pass filter, `_interpolateGaps()`,
> and `_calcVendorAvg()` no longer exist. Spike/anomaly handling that survives lives in the
> retail modal path — see `_flagAnomalies` and the intraday chart section above.

### Background Refresh on Modal Open

After rendering from cache, `openRetailViewModal` fires `Promise.all([latest.json, history-30d.json])` for the opened slug only. On success: rebuilds intraday chart and vendor legend in-place. On both failing: inserts `.retail-stale-data-warning` banner.

**Note:** The modal's background refresh writes `retailPriceHistory[slug]` directly from the raw `history-30d.json` response without the live-price patch. After a modal-only refresh, `retailPriceHistory[slug]` contains unpatched daily averages until the next full sync.

### localStorage Constraints

- `saveRetailIntradayData` caps each slug's `windows_24h` to the last 96 entries before persisting (24h at hourly resolution)
- All retail data flows through `saveData()`/`loadData()` from `js/utils.js` — never write to localStorage directly

---

## Shared Chart Abstractions (`chart-utils.js`)

Extracted from duplicated patterns across `retail.js`, `retail-view-modal.js`, and `spot.js` in STAK-484 (v3.33.71). Consumed as `window` globals by both retail files.

| Global                  | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| `replaceChart`          | Safely destroys an existing Chart.js instance before creating a replacement |
| `buildVendorDatasets`   | Creates per-vendor Chart.js datasets with standard color/style              |
| `chartPriceTooltip`     | Shared tooltip callback for dollar-formatted chart values                   |
| `chartDollarTicks`      | Y-axis tick formatter for dollar values                                     |
| `createTimeSeriesChart` | Factory for time-series line charts with standard options                   |
| `createSparkline`       | Lightweight mini chart builder for inline trend sparklines                  |

`chart-utils.js` must be placed before both retail files in `index.html` script load order.

**Chart.js tooltip null guard:** Always check `if (ctx.raw == null) return;` in tooltip callbacks. `Number(null).toFixed(2)` returns `"0.00"` — no error, silently wrong. `spanGaps: true` causes Chart.js to pass `ctx.raw = null` for gap points.

---

## Portfolio Series Fold + Per-Day Spot Maps (STRK-352)

The detail modal's value-over-time chart is fed by two composable layers:

| Layer       | Global                                                                                                            | Contract                                                                                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Day maps    | `getSpotDayMap(metalName, fromDayKey)` — `js/spot.js`                                                             | Async; ensures year files (1968 floor), merges `historicalDataCache` + live `spotHistory`, returns `Map<dayKey, $/oz>`. **Daily close = latest live timestamp per day; live beats seed.**  |
| Series fold | `buildPortfolioSeries(items, spotDayMaps, scope, todaySpotPrices, todayKey, helpers?)` — `js/portfolio-series.js` | Pure, unit-tested. Returns `{days, melt, basis, buys, baseline, _flows}`. Per-metal carry-forward + leading backfill; holding interval `[acq, disp)`; final day overridden with live spot. |

`computeWindowStats(series, startKey)` (flow-adjusted window stats) and `pickLedgerRows(inventory, scope)` (active items, newest first, undated last) ride along in `portfolio-series.js`. The fold's helpers (`getUnitOztWeight`, `getConstitutionalSilverOz`, `isDisposed`) default to the browser globals but are injectable — the unit suite passes doubles, no DOM needed.

**Consumption seam:** `detailsModal.js` calls `window.getSpotDayMap` — window indirection on purpose, because a bare const reference in the shared script scope cannot be stalled or stubbed by tests.

Any future dashboard time-series (net-worth widget, per-metal trend cards) should consume these two layers instead of re-deriving day math.

---

## Slug Resolution and the `_isSlugResolved` Predicate (STAK-521)

`getActiveRetailSlugs()` applies `_isSlugResolved` on every return path. Slugs whose metadata falls back to `{ name: slug, metal: "unknown" }` (bare Goldback denomination stubs, unmapped manifest slugs) are quarantined before any downstream consumer sees them.

**This is the single chokepoint.** Do not add per-consumer re-filters — trust this predicate.

---

## Chip Filter Pattern

The **persistence half of this pattern is live**: the per-slug/per-vendor filter matrix is stored via `_loadMarketFilter` / `_saveMarketFilter`, cached in `_marketFilterCache`, invalidated by `_invalidateMarketFilterCache()`, and read through `_isMarketItemEnabled` — all at `js/retail.js:128-168`.

> **The rendering half was removed with the card-list view** (v3.34.30, `45af18ef`). `_marketMetalFilter`, `_getFilteredSortedSlugs()`, `_renderMarketListView()`, and the `marketExpandAllBtn` expand/collapse reset no longer exist.

---

## Modal System (Shared)

All modals use the FIFO dialog queue in `js/dialogs.js`:

- `openModalById(id)` / `closeModalById(id)` — the only correct way to open/close modals
- `showDialog()` / `presentDialog()` — queue management
- Settings sections use config objects: `{ id, title, icon, contentBuilder }`
- Close button selector is `.modal-close` — **not** `.close-btn`, and **not** `[data-bs-dismiss]` (the Bootstrap JS library is not loaded in this project; `data-bs-*` appears zero times in `index.html` and `js/`)
- `safeGetElement(id)` is the preferred DOM lookup for all new code in modal files

---

## Common Mistakes Catalog

This list aggregates pitfalls documented across Vendor Quirks, Providers Config, and Retail Modal source pages.

| Mistake                                                               | Correct Pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Using `=== true` to check in-stock status                             | Use `availability[key] !== false` — missing key is in-stock                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Assuming `vendorData.price` is a number                               | Null-check: can be `null` (polled, no price) or `undefined` (vendor absent)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Editing one vendor map without the others                             | Always update `RETAIL_VENDOR_NAMES`, `RETAIL_VENDOR_COLORS`, `RETAIL_VENDOR_URLS`, and poller `VENDOR_META` together (parity test-enforced since STRK-322)                                                                                                                                                                                                                                                                                                                                                                  |
| Calling `_buildIntradayChart` and `_buildIntradayTable` independently | `_buildIntradayChart` calls `_buildIntradayTable` internally — calling both builds the table twice                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Mutating objects in `_forwardFillVendors`                             | Shallow-copy each window before attaching `_carriedVendors`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Skipping Chart.js instance destruction before modal close             | Always call `replaceChart` or explicitly destroy before reassigning                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Missing null guard in Chart.js tooltip callback                       | `if (ctx.raw == null) return;` before any `.toFixed()` call                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Opening the modal for a slug not in `RETAIL_COIN_META`                | `openRetailViewModal` returns early silently — ensure dynamic slugs are resolved via `getRetailCoinMeta`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Mixing `.price` and `.avg` fields                                     | `.price` = single-poll snapshot; `.avg` = daily average; different aggregation windows                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Editing `providers.json` files directly                               | All changes go through the dashboard or `provider-db.js` — files are overwritten on next publish                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Setting both `url` and `urls` on a provider entry                     | Use `url` for single stable URLs, `urls` for multi-URL fallback arrays — never both                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Expecting `retail-view-modal.js` functions in `retail.js`             | Modal file reads globals from `retail.js` through `window`, never the reverse                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Adding a persisted item field without registering it everywhere       | A new field (e.g. `constitutionalVariant`) must be added to **every** field-enumeration site: `DIFF_FIELDS` (diff-engine.js), `logItemChanges` (changeLog.js), `markUserModified` trackedFields (events.js), CSV export headers + `buildCsvValueCells` + import reader, JSON export/import, ZIP backup projection, and any parallel valuation math (`card-view.js`). Missing one → silent cloud-sync/undo loss or mis-valuation. Grep every site that reads the property (STRK-235 needed 3 review rounds to find them all) |

---

## Related

- .context/deep-dives/vendor-quirks.md— source for vendor normalization patterns
- Providers Config (deprecated DocVault page) — source for providers.json patterns
- .context/deep-dives/retail-modal.md— source for modal lifecycle and data flow
- Retail Pipeline (deprecated DocVault page) — end-to-end pipeline from poller to frontend
- .context/deep-dives/dom-patterns.md— general DOM utility patterns
- design-philosophy — design system and color tokens
