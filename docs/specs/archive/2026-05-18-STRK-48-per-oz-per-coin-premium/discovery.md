---
sketch: STRK-48-per-oz-per-coin-premium
phase: discovery
created: '2026-05-14'
---

# STRK-48 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

### Valuation section — the insertion point

| Path | Role | Notes |
|------|------|-------|
| `js/viewModal.js:550-591` | `_buildValuationSection(item, metrics)` | Builds the Valuation grid. Currently renders 4 cells: Purchase, Melt Value, Retail, Gain/Loss. Premium lines will be added here. |
| `js/viewModal.js:568` | `_el("div", "view-detail-grid four-col")` | Creates the valuation grid as a 4-column CSS grid. Adding 2 more cells pushes to 6 items in the grid. |
| `js/viewModal.js:582-588` | Gain/Loss coloring | Uses `_detailItem()` + `.gain`/`.loss` CSS classes on `.view-detail-value`. Same pattern needed for premium coloring. Gain/Loss is always rendered (either with a value or a muted "—"), so the grid always has exactly 4 items currently. |

### Metrics resolution — weight, purity, unit conversion

| Path | Role | Notes |
|------|------|-------|
| `js/viewModal.js:251-265` | `_getViewMetrics(item)` | Returns `{ currentSpot, qty, weight, purity, isGb, isSb, weightOz, metalColor }`. Already converts `gb`/`sb` units via `GB_TO_OZT`/`SB_TO_OZT` (both `0.001` at `js/constants.js:571-574`). `metrics.weightOz` is the pre-converted value — use it, not raw `item.weight`. Gram/kg/lb conversions happen at form-save time in `js/events.js:1373-1386` (`parseWeight`), not in `_getViewMetrics`. |
| `js/viewModal.js:560` | `purchasePrice` | `computed?.purchasePrice ?? (parseFloat(item.price) \|\| 0)` — per-unit price (lot-mode items are already divided before save per AC-7 requirement). |

### Spot-at-purchase resolution — the data source chain

| Path | Role | Notes |
|------|------|-------|
| `js/spot.js:625` | `historicalDataCache = new Map()` | `Map<year, Array<{spot, metal, source, provider, timestamp}>>`. Keyed by integer year. Entries have `timestamp` as `"YYYY-MM-DD HH:MM:SS"` string. This is the **primary source** for purchase-day spot. |
| `js/spot.js:1488-1508` | `_loadSpotSeedBundle(bundle)` | Expands the compact bundle format into full cache entries. Bundle loaded synchronously by `data/spot-history-bundle.js` `<script>` tag — available before any modal opens. 47,828 entries spanning 1968–present. |
| `js/spot.js:682-729` | `fetchYearFile(year)` | Fetches individual year JSON files, caches result. Three-tier: local fetch → XHR (file://) → remote staktrakr.com. Not needed for most items since the bundle pre-populates the cache. |
| `js/spot.js:1551` | `window.historicalDataCache` | Exposed on `window` — accessible from `viewModal.js`. |
| `js/events.js:1834-1835` | `spotPriceAtPurchase` on new items | Set from the Spot Lookup modal value, or falls back to current `spotPrices[metalKey]`. Reliable for items added with the lookup modal; unreliable for items added without it (gets current spot, not historical). |
| `js/inventory.js:293-321` | Legacy migration backfill | Items missing `premiumPerOz` get `spotPriceAtPurchase: spotPrice` where `spotPrice` is the **current** spot at load time, not the historical value. Also sets `premiumPerOz` and `totalPremium` using raw weight and current spot, making both fields permanently wrong for legacy items. These stored fields must not be reused for display. |

### Existing lookup utility — async, modal-scoped

| Path | Role | Notes |
|------|------|-------|
| `js/spotLookup.js:322-369` | `searchHistoricalByDate(metalName, dateStr)` | Async. Fetches target year ± adjacent years via `fetchYearFile()`, filters by `entry.metal`, computes day offsets, progressive widening (exact → ±1 → ±3 → ±7), sorts by `Math.abs(dayOffset)` with newest-timestamp tiebreak, dedupes by calendar day. Returns an `Array<Object>` (multiple results, not a single spot value). Currently local to `spotLookup.js` and scoped to the Spot Lookup modal — not shared across modules. |

### Existing premium fields — unreliable, do not use for display

| Path | Role | Notes |
|------|------|-------|
| `js/events.js:1842-1843` | `premiumPerOz: 0, totalPremium: 0` | Hard-coded to zero on new item creation. Never computed at save time. |
| `js/utils.js:1383-1387` | `sanitizeItem()` | Can reset premium fields to zero during sanitization passes. |
| `js/inventory.js:303-304` | Legacy computation | `premiumPerOz = spotPrice > 0 ? item.price / item.weight - spotPrice : 0` — uses raw weight (not ASW), current spot (not purchase-day), and no purity factor. Wrong on all three axes. |
| `js/bulkEdit.js:39-40,64-65` | Bulk edit labels | `premiumPerOz` and `totalPremium` appear in the bulk-edit field list as "Premium / Oz" and "Total Premium". These are data fields, not display — this feature ignores them. |

### Valuation computation — the existing pattern

| Path | Role | Notes |
|------|------|-------|
| `js/utils.js:1486-1508` | `computeItemValuation(item, currentSpot)` | Returns `{ qty, purchasePrice, purchaseTotal, meltValue, retailTotal, gainLoss, ... }`. Used by `_buildValuationSection`. Does **not** compute premium — it has no access to historical spot. Called synchronously from `viewModal.js:551-554`; making it async would break the call chain. Adding premium would require either a new `historicalSpot` parameter or keeping premium computation entirely in `_buildValuationSection`. |
| `js/utils.js:1447-1465` | `calculateRetailPrice(item, currentSpot)` | Sub-routine called by `computeItemValuation`. Handles goldback denomination pricing and manual market values. |

### DOM helpers — the building blocks

| Path | Role | Notes |
|------|------|-------|
| `js/viewModal.js:2152-2161` | `_detailItem(label, value, extraClass)` | Creates a `.view-detail-item` with `.view-detail-label` + `.view-detail-value`. Used for all grid cells. |
| `js/viewModal.js:2164-2166` | `_addDetail(grid, label, value, extraClass)` | Shorthand that appends a `_detailItem` to a grid container. |

### CSS grid layout — responsive behavior

| Path | Role | Notes |
|------|------|-------|
| `css/styles.css:6272-6284` | Grid column definitions | `.view-detail-grid` = 2-col default. `.three-col` = 3-col. `.four-col` = 4-col. |
| `css/styles.css:6292-6294` | `.view-detail-item.full-width` | Spans all columns (`grid-column: 1 / -1`). Available if approach decides a premium row deserves wider formatting. |
| `css/styles.css:6311-6324` | `.gain` / `.loss` / `.muted` value styles | `.gain` = `var(--success)`, `.loss` = `var(--danger)`, `.muted` = `var(--text-secondary)` italic. All with `font-weight: 600`. |
| `css/styles.css:6624-6628` | Mobile breakpoint ≤768px | All grid variants collapse to `1fr 1fr` (2-column). The `four-col` class has no special mobile handling — it just becomes 2-col. |
| `css/styles.css:6649-6652` | Extra-small ≤480px | Same 2-col collapse. |

### Currency formatting

| Path | Role | Notes |
|------|------|-------|
| `js/utils.js:599-624` | `formatCurrency(value, currency)` | Uses `Intl.NumberFormat`. Handles multi-currency via `getExchangeRate()`. Returns empty string for `NaN`. Does **not** prepend `+` sign — that must be added by the caller (see Gain/Loss at `viewModal.js:583`). |

## Prior Decisions

- **2026-05-14** — STRK-75 (v3.34.65, PR #1115): Per-row spot premium math implemented for the vendor price matrix. Distinct context (market/vendor layer, not inventory item modal), but confirms the pattern of resolving spot per metal code per row. (mem0)
- **2026-05-14** — STRK-48 sketch scaffolded. Requirements phase completed and reconciled 2026-05-17. No prior implementation decisions. (sessionflow)
- **No prior decisions found** for `historicalDataCache` usage in premium calculation or for spot-at-purchase resolution in the Item Detail modal context. This is the first time this surface is being built.

## External References

- No external libraries needed. The feature reuses existing `historicalDataCache` (LBMA data, 59 years), existing `formatCurrency()`, and existing `.gain`/`.loss` CSS classes.
- The premium math is standard precious metals calculation: `premium/oz = (price / ASW) - spot` and `premium/coin = price - (spot × ASW)`, where ASW = actual silver/gold weight = `weightOz × purity`.

## Constraints

- **No synchronous, cache-only lookup utility is shared across modules.** `searchHistoricalByDate()` at `js/spotLookup.js:322-369` already implements full lookup mechanics (progressive widening, proximity sorting, dedup) but is async and scoped to the Spot Lookup modal. The view modal needs a synchronous, cache-only variant. The approach must decide: extract a sync helper from the existing function's logic, write a new sync cache scanner, or export a shared utility to `js/spot.js`. The underlying algorithm is proven — the gap is the sync/shared interface, not the lookup logic itself.
- **`historicalDataCache` is async-loaded for individual years, but the bundle is synchronous.** The bundle (`spot-history-bundle.js`) loads via `<script>` tag and calls `_loadSpotSeedBundle()` synchronously, pre-populating the cache with 1968–present data. For any item with a purchase date in that range, the data is already in memory when the modal opens. No async fetch needed.
- **The `timestamp` format in cache entries is `"YYYY-MM-DD HH:MM:SS"`.** Comparison should use the `YYYY-MM-DD` prefix (`.slice(0, 10)`) to match against the item's `date` field. Items store dates as `YYYY-MM-DD` strings.
- **Nearest-trading-day fallback needed.** Weekends and holidays have no LBMA data. If the exact purchase date has no entry, the lookup must find the nearest trading day (absolute nearest, not prior-only — matching AC-4 and the existing `searchHistoricalByDate` behavior which uses `Math.abs(dayOffset)`). Cache entries within each year+metal are chronologically sorted in practice (LBMA data is ordered, and `_loadSpotSeedBundle` preserves insertion order), though there is no explicit sort step — a defensive implementation may sort or use max-tracking.
- **`searchHistoricalByDate` returns an array, not a single spot value.** Multiple entries may exist for the same day (e.g., AM vs PM fix). The existing Spot Lookup modal takes `results[0]`. The approach must decide how the view modal picks from multiple results.
- **`item.metal` is stored as display name** (e.g. `"Silver"`, `"Gold"`), which matches the cache's `metal` field directly for the four precious metals. However, `parseNumistaMetal()` at `js/utils.js:1092-1100` also returns `"Paper"` and `"Alloy"` for non-precious compositions, and manual CSV/JSON imports may have arbitrary metal strings. Only Gold, Silver, Platinum, and Palladium have cache entries. **Unsupported metals need a defined fallback chain:** supported metal → cache lookup → `spotPriceAtPurchase` → "—". A guard like `["Gold", "Silver", "Platinum", "Palladium"].includes(item.metal)` should short-circuit before scanning.
- **`item.date` may be empty or malformed for legacy items.** Requirements AC-3 specifies a purchase date, but legacy items may have `date === ""` or `date === undefined`. The approach must define fallback behavior — likely fall through to `spotPriceAtPurchase`, then to "—".
- **`formatCurrency()` does not prepend `+` signs.** The existing Gain/Loss line at `viewModal.js:583` manually prepends `+` via template literal: `(gainLoss >= 0 ? "+" : "") + formatCurrency(gainLoss)`. Premium display must follow the same pattern.
- **Grid goes from exactly 4 to exactly 6 items.** The Gain/Loss cell is always rendered (either with value or muted "—"), so the grid currently has exactly 4 items. Adding 2 premium cells means exactly 6 items. On desktop the `four-col` grid auto-wraps, producing 2 rows (4+2) — a natural visual hierarchy with core metrics on top and premium below. On mobile (≤768px) everything is 2-col, so 6 items = 3 rows — acceptable. The `full-width` CSS class at `css/styles.css:6292-6294` is available if approach decides a premium row deserves wider formatting.
- **`computeItemValuation()` is the wrong place for premium.** It takes `currentSpot` (live spot), not historical spot. It is called synchronously; adding async cache lookup would break the call chain. Premium logic should live in `_buildValuationSection` itself or in a new helper, keeping `computeItemValuation` pure.
- **Premium/oz shows "—" when ASW is 0.** AC-5 explicitly guards per-coin (may still compute if `resolvedSpot > 0`), but per-oz would be division by zero (`price / 0 - spot`). Both premium lines display "—" when ASW=0, with Premium/coin as the only exception when `resolvedSpot > 0`.
- **Purity defaults to 1.0 for items without an explicit purity field.** `parsePurity()` at `js/events.js:1412-1420` returns `1.0` when no purity select exists or when the value is empty/invalid. `_getViewMetrics()` also defaults to `1.0` via `parseFloat(item.purity) || 1.0`. For .999 fine items where purity was never stored, premium calculations will use 1.0 instead of 0.999, introducing a ~0.1% error. Known minor limitation, not a blocker.
- **`viewModal.js` can safely read `window.historicalDataCache` synchronously.** Both files are `defer` scripts executing in order after DOM parse. The bundle populates the cache via `_loadSpotSeedBundle()` before any user-triggered modal open. Timing is safe.
- **No new localStorage keys or schema changes.** Per non-goals, this is read-only display from existing data. The existing `premiumPerOz` and `totalPremium` fields are unreliable and must be ignored for display.

## Open Questions

_(None — all blockers resolved during research.)_

## Discovery Summary

The insertion point is `_buildValuationSection()` in `js/viewModal.js:550-591`, which currently builds a 4-cell grid (Purchase, Melt, Retail, Gain/Loss — always exactly 4 items). The premium calculation is straightforward math from `item.price`, `metrics.weightOz`, `metrics.purity`, and a resolved historical spot. A lookup-by-date utility already exists — `searchHistoricalByDate()` at `js/spotLookup.js:322-369` — covering progressive widening, proximity sorting, and dedup, but it is async and scoped to the Spot Lookup modal. The view modal needs a synchronous, cache-only variant; the approach must decide whether to extract, adapt, or write a new sync helper. The cache is pre-populated synchronously by the bundle script (47K+ entries, 1968–present), so no async complexity is needed for the lookup itself. The main design decisions for approach are: (1) how to provide a sync cache-only spot lookup (extract from existing vs. new helper), (2) how to handle the 4→6 grid item layout on desktop, and (3) whether to keep premium logic local to `_buildValuationSection` or factor it into a separate helper.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch review STRK-48 discovery`, then `/sketch approach STRK-48`.

## Review Archive — discovery (2026-05-17)

_Reconciled by /sketch reconcile on 2026-05-17. Original reviewer marks preserved below for audit._

### Codex

#### Verified

- Confirmed `_buildValuationSection()` creates the Valuation section, uses `computeItemValuation(item, metrics.currentSpot)`, builds a `view-detail-grid four-col`, and renders Purchase, Melt Value, Retail, and Gain/Loss in `js/viewModal.js:550-591`.
- Confirmed `_getViewMetrics()` returns `metrics.weightOz` and converts only `gb`/`sb` denomination units there; gram/kg/lb form input is converted before storage in `js/events.js:1373-1386`, while `computeMeltValue()` mirrors the gb/sb conversion in `js/utils.js:1405-1415`.
- Confirmed `historicalDataCache` is a year-keyed `Map` in `js/spot.js:624-625`, `fetchYearFile()` returns cached year arrays when present in `js/spot.js:682-686`, `_loadSpotSeedBundle()` expands bundle rows into `{spot, metal, source, provider, timestamp}` cache entries in `js/spot.js:1488-1507`, and `window.historicalDataCache` is exposed in `js/spot.js:1551`.
- Confirmed `index.html:8518-8519` loads `js/spot.js` before `data/spot-history-bundle.js`, and the bundle header says it covers 1968 to 2026-05-17 with 47,828 entries.
- Confirmed an existing historical-date lookup exists in `js/spotLookup.js:322-369`, but it is local to that file, async, and uses `fetchYearFile()` plus target/adjacent years.
- Confirmed new items store `spotPriceAtPurchase`, `premiumPerOz: 0`, and `totalPremium: 0` in `js/events.js:1831-1843`; legacy load can backfill premium fields and `spotPriceAtPurchase` from current spot in `js/inventory.js:293-321`; `sanitizeItem()` can reset premium fields to zero in `js/utils.js:1383-1387`.
- Confirmed grid and value styling exist at `css/styles.css:6272-6324`, with `four-col` collapsing to two columns at mobile breakpoints in `css/styles.css:6623-6628` and `css/styles.css:6648-6652`.

#### Top concerns

1. Discovery says no lookup utility exists, but `searchHistoricalByDate()` already covers most lookup mechanics; approach should decide reuse/extraction versus a new sync cache-only helper.
2. Discovery narrows fallback to "nearest prior trading day", while approved requirements only say "nearest trading day" and existing lookup behavior is absolute-nearest within a widening window.
3. Discovery assumes `item.metal` always matches cache metals, but live parsing can produce `Alloy` or `Paper`; unsupported metals need an explicit display/fallback rule.

#### Unverified assumptions

- The view modal can safely read `window.historicalDataCache` synchronously after all deferred scripts load, even though `viewModal.js` itself is loaded before `spot.js` in `index.html`.
- Product intent is prior trading day rather than absolute nearest trading day for weekend/holiday purchases.
- Unsupported item metals should show "—" rather than falling back to possibly stale `spotPriceAtPurchase`.
- Extracting lookup behavior from `spotLookup.js` will not create unwanted coupling to add/edit modal UI state.
- Premium/coin with invalid ASW should compute as `price - 0` per AC-5, rather than display "—" alongside Premium/oz.

### Gemini

#### Verified

- Verified `_buildValuationSection()` insertion point in `js/viewModal.js:550-591`.
- Verified `_getViewMetrics()` correctly calculates `weightOz` from `gb`/`sb` units in `js/viewModal.js:251-277`.
- Verified `historicalDataCache` source and exposure in `js/spot.js:625, 1551`.
- Verified `searchHistoricalByDate()` existing in `js/spotLookup.js:322-371`.
- Verified legacy migration behavior in `js/inventory.js:293-321` using current spot as a fallback.
- Verified CSS grid classes and mobile responsive behavior in `css/styles.css:6272-6324, 6623-6628, 6648-6652`.

#### Top concerns

1. **Spot Lookup Reuse:** `searchHistoricalByDate` is currently `async` and local to `spotLookup.js`. The approach must decide whether to extract it to `js/spot.js` as a shared utility or implement a synchronous cache-only version for `viewModal.js`.
2. **Metal Coverage:** The seed bundle only supports Gold, Silver, Platinum, and Palladium. Items with other metals (e.g., Copper, Brass, Alloy) will need a graceful "—" display to avoid calculation errors.
3. **Pure Function Integrity:** `computeItemValuation` should remain pure and focused on current valuation. Adding historical premium logic there would introduce dependencies on the historical cache that are better handled at the view or controller layer.

#### Unverified assumptions

- All relevant items have a `date` field in `YYYY-MM-DD` format (already checked in `requirements.md` but worth noting for implementation).
- `historicalDataCache` is fully populated via the bundle before any modal interaction (bundle is synchronous, so this should hold).
- The `+` sign prepend behavior for Gain/Loss is the desired pattern for premium display as well.

### GLM

#### Verified

- Confirmed `_buildValuationSection()` at `js/viewModal.js:550-591` builds a `four-col` valuation grid with Purchase, Melt, Retail, and Gain/Loss cells. Gain/Loss uses `.gain`/`.loss` classes and manually prepends `+` for positive values at line 583.
- Confirmed `_getViewMetrics()` at `js/viewModal.js:251-265` returns `{ currentSpot, qty, weight, purity, isGb, isSb, weightOz, metalColor }`. `weightOz` converts `gb`/`sb` via `GB_TO_OZT`/`SB_TO_OZT` (both `0.001` at `js/constants.js:571-574`).
- Confirmed `historicalDataCache` is a `Map<number, Array>` at `js/spot.js:625`, populated synchronously by `_loadSpotSeedBundle()` at `js/spot.js:1488-1507`, and exposed on `window` at `js/spot.js:1551`. Bundle format uses `{spot, metal, source, provider, timestamp}` entries with timestamps as `"YYYY-MM-DD HH:MM:SS"`.
- Confirmed `searchHistoricalByDate()` exists at `js/spotLookup.js:322-369` — async, uses `fetchYearFile()`, progressive widening (exact → ±1 → ±3 → ±7), returns results sorted by absolute proximity with newest-timestamp tiebreak, deduped by day.
- Confirmed `computeItemValuation(item, currentSpot)` at `js/utils.js:1486-1508` receives only live `currentSpot`, delegates to `calculateRetailPrice`, returns no premium fields. Extendable only with a signature change.
- Confirmed `parseNumistaMetal()` at `js/utils.js:1092-1100` returns `"Silver"`, `"Gold"`, `"Platinum"`, `"Palladium"`, `"Paper"`, or `"Alloy"` — only the first four have cache entries.
- Confirmed `METALS` constant at `js/constants.js:1834-1867` defines exactly four metals (Silver, Gold, Platinum, Palladium) with `name`, `key`, `spotKey`, `localStorageKey`, `color`, `defaultPrice`.
- Confirmed legacy migration backfill at `js/inventory.js:293-321` uses **current** `spotPrices[metalConfig.key]` (not historical) for `spotPriceAtPurchase` and computes `premiumPerOz` with raw `item.price / item.weight - spotPrice` — wrong on all three axes (raw weight, no purity, current spot).
- Confirmed `sanitizeItem()` resets `premiumPerOz` and `totalPremium` to 0 when `!sanitized.price || !sanitized.weight` at `js/utils.js:1383-1387`.
- Confirmed CSS grid classes at `css/styles.css:6272-6284` (2-col default, 3-col, 4-col) with `.gain`/`.loss`/`.muted` value styling at `6311-6324`. Mobile breakpoints at `6623-6628` (≤768px) and `6648-6652` (≤480px) both collapse all grids to 2-col.
- Confirmed `bulkEdit.js:39-40` lists `premiumPerOz` and `totalPremium` as editable fields.
- Confirmed `item.metal` stored as display name matches cache `metal` field for the four precious metals. Items with `metal: "Alloy"` or `"Paper"` have no cache entries.

#### Top concerns

1. **Discovery header claims "No lookup utility exists" but `searchHistoricalByDate` does exist.** The distinction matters: it is async and uses `fetchYearFile()` (which can XHR remote data), but the view modal needs a synchronous, cache-only lookup since the bundle pre-populates the cache. Approach must decide: extract a shared sync helper from `searchHistoricalByDate`'s progressive-widening logic, or write a fresh sync scanner. Rewriting from scratch without considering extraction would duplicate 47 lines of proven date-widening logic.

2. **"Nearest prior trading day" vs. "nearest trading day" ambiguity remains unresolved.** Both CODEX and GEMINI flagged this. Requirements AC-4 says "nearest trading day" (absolute nearest), the existing `searchHistoricalByDate` implements absolute nearest, but the discovery constraint text says "nearest **prior** trading day." Approach needs an explicit product decision before implementation.

3. **`item.metal` can be `"Alloy"` or `"Paper"` — no explicit display/fallback rule for unsupported metals.** The discovery acknowledges this in a comment but doesn't list it as a constraint or open question. For items where the cache has no matching metal, the approach must specify: show "—", show nothing, or fall back to `item.spotPriceAtPurchase` (which itself may be current spot, not historical). Each option has different UX implications.

#### Unverified assumptions

- **Cache entries within a year are unsorted.** `_loadSpotSeedBundle()` pushes entries in `Object.keys(bundle)` iteration order, which is insertion order for string keys in modern engines (chronological for numeric-year keys), but the inner loop iterates over `Object.keys(metals[yearStr])` (metal names) then pairs — not sorted by date within a year. The approach must specify whether the sync helper sorts before searching, or whether sequential scan-with-tracking is sufficient.
- **`item.date` is always in `YYYY-MM-DD` format for cache lookups.** Requirements AC-3 specifies date, but legacy items may have empty or malformed dates. The approach should define behavior for `date === ""` or `date === undefined`.
- **The view modal can safely read `window.historicalDataCache` synchronously.** `viewModal.js` is loaded before `spot.js` in the HTML (both `defer`), so both execute in order after DOM parse. `_loadSpotSeedBundle` is called by `data/spot-history-bundle.js` (also a `<script>` tag, loaded after `spot.js`). Since `viewModal.js` only reads the cache on modal open (user action), the bundle will have long since populated it. This assumption is safe but not explicitly documented in the discovery.
- **Premium per coin with zero or invalid ASW should compute as `price - 0`** per AC-5, but the discovery doesn't specify whether Premium/oz should also display `price / 0 - spot` (division by zero) or show "—". AC-5 only mentions the per-coin case.

### Qwen

#### Verified

- Confirmed `_buildValuationSection()` at `js/viewModal.js:550-591` builds a `four-col` grid with Purchase, Melt Value, Retail, and Gain/Loss. Gain/Loss is conditionally rendered (lines 582-588) — only if `gainLoss !== null && retailTotal > 0`, otherwise a muted "—" is shown. This means the grid has 4 or 5 items, not always 4, which affects the 4→6 wrap geometry.
- Confirmed `_getViewMetrics()` at `js/viewModal.js:251-265` returns `{ currentSpot, qty, weight, purity, isGb, isSb, weightOz, metalColor }`. `weightOz` converts `gb`/`sb` via `GB_TO_OZT`/`SB_TO_OZT` (both `0.001` at `js/constants.js:571-574`). Gram/kg/lb conversions happen at form-save time in `js/events.js:1373-1386`, not in `_getViewMetrics`.
- Confirmed `historicalDataCache` is a `Map<number, Array>` at `js/spot.js:625`, populated synchronously by `_loadSpotSeedBundle()` at `js/spot.js:1488-1507`, and exposed on `window` at `js/spot.js:1551`. Bundle entries use `{spot, metal, source, provider, timestamp}` with timestamps as `"YYYY-MM-DD HH:MM:SS"`.
- Confirmed `searchHistoricalByDate()` at `js/spotLookup.js:322-369` — async, fetches target year ± adjacent years via `fetchYearFile()`, filters by metal, computes day offsets, progressive widening (exact → ±1 → ±3 → ±7), sorts by absolute proximity with newest-timestamp tiebreak, dedupes by calendar day. This is the most significant discovery inaccuracy: the header "No lookup utility exists" is contradicted by this 47-line function.
- Confirmed `computeItemValuation(item, currentSpot)` at `js/utils.js:1486-1508` receives only live `currentSpot`, delegates to `calculateRetailPrice`, returns no premium fields. Extending it would require a signature change.
- Confirmed `parseNumistaMetal()` at `js/utils.js:1092-1100` returns `"Silver"`, `"Gold"`, `"Platinum"`, `"Palladium"`, `"Paper"`, or `"Alloy"` — only the first four have cache entries.
- Confirmed `METALS` constant at `js/constants.js:1834-1867` defines exactly four metals with name, key, spotKey, localStorageKey, color, defaultPrice.
- Confirmed legacy migration backfill at `js/inventory.js:293-321` uses **current** `spotPrices[metalConfig.key]` (not historical) for `spotPriceAtPurchase` and computes `premiumPerOz` with raw `item.price / item.weight - spotPrice` — wrong on all three axes (raw weight, no purity, current spot).
- Confirmed `sanitizeItem()` resets `premiumPerOz` and `totalPremium` to 0 when `!sanitized.price || !sanitized.weight` at `js/utils.js:1383-1387`.
- Confirmed CSS grid classes at `css/styles.css:6272-6284` (2-col default, 3-col, 4-col) with `.gain`/`.loss`/`.muted` value styling at `6311-6324`. `.view-detail-item.full-width` at `6292-6294` spans all columns (`grid-column: 1 / -1`). Mobile breakpoints at `6623-6628` (≤768px) and `6648-6652` (≤480px) both collapse all grids to 2-col.
- Confirmed `formatCurrency()` at `js/utils.js:599-624` uses `Intl.NumberFormat`, handles multi-currency via `getExchangeRate()`, returns empty string for `NaN`. Does not prepend `+` sign.
- Confirmed `_detailItem()` at `js/viewModal.js:2152-2161` and `_addDetail()` at `js/viewModal.js:2164-2166` — standard DOM helpers for grid cells.
- Confirmed `bulkEdit.js:39-40,64-65` lists `premiumPerOz` and `totalPremium` as editable fields with labels "Premium / Oz" and "Total Premium".
- Confirmed script load order in `index.html`: `viewModal.js` (line 8515), `spot.js` (line 8518), `spot-history-bundle.js` (line 8519) — all `defer`, execute in order after DOM parse. Modal opens are user-triggered, so cache is always populated by then.
- Confirmed new items store `spotPriceAtPurchase` from lookup modal or current spot fallback, plus `premiumPerOz: 0` and `totalPremium: 0` at `js/events.js:1831-1843`.
- Confirmed AC-4 at `requirements.md:62-67` says "nearest trading day" (absolute nearest), not "nearest prior trading day".

#### Top concerns

1. **"No lookup utility exists" is the most load-bearing inaccuracy.** `searchHistoricalByDate()` at `js/spotLookup.js:322-369` implements 47 lines of progressive widening, day-offset computation, sorting, and dedup. The discovery header, constraint text, and summary all assert this logic must be written from scratch. Three prior reviewers (CODEX, GEMINI, GLM) flagged this; the discovery text has not been amended. The approach phase will inherit a false premise unless corrected.

2. **"Nearest prior trading day" vs "nearest trading day" remains unresolved.** Requirements AC-4 says "nearest trading day" (absolute nearest). `searchHistoricalByDate` implements absolute nearest. The discovery says "nearest prior." This is a product decision that must be resolved before approach locks in an algorithm. All three prior reviewers flagged it; it is still open.

3. **Gain/Loss conditional rendering affects grid geometry.** The discovery says "Grid goes from 4 to 6 items" but Gain/Loss is only rendered when `gainLoss !== null && retailTotal > 0` (`viewModal.js:582-588`). So the grid has 4 or 5 items currently, not always 4. Adding 2 premium cells means 5→7 or 6→8 items depending on Gain/Loss presence. This changes the wrap behavior on desktop and should be explicitly accounted for in the approach layout decision.

#### Unverified assumptions

- **Cache entries within a year are unsorted by date.** `_loadSpotSeedBundle()` at `js/spot.js:1490-1506` iterates `Object.keys(bundle)` (year strings in insertion order), then `Object.keys(metals)` (metal names), then pushes pairs. The pairs within a metal are `["MM-DD", spot]` tuples from the bundle format. The bundle is generated from LBMA data which is chronologically ordered, so the pairs should be in date order within each metal. But the discovery's claim that entries are "not guaranteed sorted" is technically correct — there is no explicit sort step. A sync scanner should either sort or use a max-tracking scan.

- **`item.date` is always in `YYYY-MM-DD` format for cache lookups.** Requirements AC-3 specifies date, but legacy items may have empty or malformed dates. The approach should define behavior for `date === ""` or `date === undefined` — likely fall through to `spotPriceAtPurchase` then to "—".

- **Unsupported item metals (`"Alloy"`, `"Paper"`, or any user-entered string) should display "—" rather than attempting a cache scan.** The discovery acknowledges the mismatch in a reviewer comment but doesn't list it as a constraint. The approach must specify the fallback chain: supported metal → cache lookup → `spotPriceAtPurchase` → "—".

- **`viewModal.js` can safely read `window.historicalDataCache` synchronously.** This is safe because modal opens are user-triggered (long after all `defer` scripts execute), but it is not explicitly documented. The approach should note this timing assumption.

- **Premium per coin with zero ASW computes as `price - 0` per AC-5, but Premium/oz would be `price / 0 - spot` (division by zero).** AC-5 only guards the per-coin case. The approach must specify that Premium/oz also displays "—" when ASW is zero.

### Kimi

#### Verified

- Confirmed `_buildValuationSection()` at `js/viewModal.js:550-591` builds a `four-col` grid. Purchase, Melt Value, and Retail are unconditional. Gain/Loss is **always** rendered: either with a colored value (lines 582–586) or a muted "—" (line 588). The grid currently has exactly 4 items, not 4 or 5.
- Confirmed `_getViewMetrics()` at `js/viewModal.js:251-265` returns `weightOz` with gb/sb conversion via `GB_TO_OZT`/`SB_TO_OZT` (`js/constants.js:571-574`). Gram/kg/lb conversions happen at save time in `js/events.js:1373-1386` (`parseWeight`), not in `_getViewMetrics`.
- Confirmed `historicalDataCache` is a `Map<number, Array>` at `js/spot.js:625`. `_loadSpotSeedBundle()` at `js/spot.js:1488-1507` populates it synchronously from `data/spot-history-bundle.js` (loaded at `index.html:8519`, after `spot.js`). Entries within each metal for each year are sorted chronologically by date (verified by parsing the actual bundle for 2025 Silver: 253 entries, strictly sorted by MM-DD).
- Confirmed `searchHistoricalByDate()` at `js/spotLookup.js:322-369` already implements full lookup mechanics: fetches target/adjacent years, filters by metal, computes `dayOffset`, progressive widening `[0, 1, 3, 7]`, sorts by `Math.abs(dayOffset)` with newest-timestamp tiebreak, and dedupes by calendar day. It is async and returns an `Array<Object>` (not a single spot value).
- Confirmed `computeItemValuation(item, currentSpot)` at `js/utils.js:1486-1508` receives only live spot, returns no premium fields, and is called synchronously from `_buildValuationSection`. Making it async to resolve historical spot would break the call chain.
- Confirmed `parseNumistaMetal()` at `js/utils.js:1092-1100` returns capitalized metal names for the four precious metals, plus "Paper" and "Alloy". `buildItemFields()` stores this directly in `item.metal`. The cache `metal` field uses the same capitalized names from bundle keys. Match is exact for the four supported metals.
- Confirmed legacy migration at `js/inventory.js:293-321` backfills `spotPriceAtPurchase` with **current** spot at load time and computes `premiumPerOz` from raw weight, current spot, and no purity. These stored fields are permanently unreliable for legacy items.
- Confirmed `formatCurrency()` at `js/utils.js:599-624` does not prepend `+`; the Gain/Loss line manually adds it at `viewModal.js:583`.
- Confirmed CSS grid classes at `css/styles.css:6272-6324`. `.view-detail-grid.four-col` is `1fr 1fr 1fr 1fr`. With exactly 6 items, CSS grid auto-wraps to 2 rows (4+2). Mobile breakpoints at `6623-6628` and `6648-6652` collapse to 2 columns, giving 3 rows — acceptable.
- Confirmed script load order at `index.html:8515-8519`: `viewModal.js` → `spot.js` → `spot-history-bundle.js`. All `defer`. Modal opens are user-triggered, so cache is always populated.

#### Top concerns

1. **"No lookup utility exists" is inaccurate and misleading.** `searchHistoricalByDate()` at `js/spotLookup.js:322-369` is a 47-line function that covers exact match, progressive widening, proximity sorting, and dedup. The approach phase's first design decision should be "extract a sync cache-only variant" or "add a shared helper," not "write lookup logic from scratch." The discovery header, constraint text, and summary all repeat this false premise.
2. **QWEN incorrectly states the grid has "4 or 5 items currently."** The Gain/Loss cell is unconditionally rendered — either with a value or muted "—". The grid is always 4 items, so adding 2 premium cells is a clean 4→6 geometry. The approach phase does not need to account for variable item counts in the Valuation grid.
3. **Cache entries within a year+metal are sorted in practice.** The bundle stores LBMA data chronologically within each metal. `_loadSpotSeedBundle()` preserves this order when pushing entries. The discovery's "not guaranteed sorted" framing is technically defensive but obscures a useful invariant: after filtering by metal, the array is date-sorted, making exact-match scans reliable and enabling binary search if desired.

#### Unverified assumptions

- **Purity defaults to 1.0 for items without an explicit purity field.** `parsePurity()` at `js/events.js:1412-1420` returns `1.0` when no purity select exists or when the value is empty/invalid. `_getViewMetrics()` also defaults to `1.0` via `parseFloat(item.purity) || 1.0`. For .999 fine silver where purity was never stored, premium calculations will use 1.0 instead of 0.999, introducing a ~0.1% error. The discovery does not address whether this is acceptable.
- **`searchHistoricalByDate()` returns an array, not a single spot value.** The approach must decide how to handle multiple returned entries (e.g., AM vs PM fix on the same day). The existing spot lookup modal takes `results[0]`, but the discovery does not mention this.
- **The fallback chain for unsupported metals is not explicitly defined.** AC-4 specifies fallback to `spotPriceAtPurchase`, then "—". But for metals like "Alloy" or "Paper", `spotPriceAtPurchase` may itself be current spot (unreliable for legacy items) or zero. The approach should define the exact fallback chain: supported metal → cache lookup → `spotPriceAtPurchase` → "—".
- **Premium/coin when ASW=0 but price>0.** AC-5 says Premium/oz displays "—" when ASW=0, but allows Premium/coin to compute if `resolvedSpot > 0`. The formula would be `price - 0 = price`, which is mathematically valid but UX-wise confusing (showing the full purchase price as "premium"). The approach should confirm this is the intended behavior.

### Resolution Summary

- Accepted: 10
- Rejected: 1 (QWEN's "4 or 5 items" grid count — verified incorrect against code at viewModal.js:582-588; Gain/Loss always renders)
- Resolved with your input: 0
