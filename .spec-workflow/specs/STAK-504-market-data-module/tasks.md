# Tasks Document: Market Data Module (Revised)

## References

- **Issue:** STAK-504
- **Spec Path:** `.spec-workflow/specs/STAK-504-market-data-module/`
- **Visual Reference:** `artifacts/prototype-7-full-integrated.html`

{/* VERSION CHECKOUT GATE — MANDATORY
Before implementing ANY task below, you MUST:
1. Run /release patch (or /start-patch) to claim a version and create a worktree
2. Record the assigned version in the first implementation log
3. ALL file edits happen inside the worktree — never in the main repo working directory
4. Verify: git branch --show-current returns patch/VERSION, not dev or main
Skipping this gate is a workflow violation.

SPEC COMPLETION GATE — BLOCKING (Phase 5):
After ALL tasks are [x] and implementation logs are recorded:
1. Run /vault-update to update all DocVault pages
2. Close all linked vault issues (set status: done)
3. Verify /bb-test passes
4. The spec is NOT complete until all three are verified.
*/}

---

## File Touch Map

| File | Action | Scope |
|------|--------|-------|
| `js/constants.js` | MODIFY | Add `bestPriceTicker` + `vendorPrices` to `LAYOUT_SECTION_DEFAULTS`, add 3 new localStorage keys to `ALLOWED_STORAGE_KEYS`, add window exports |
| `js/market-data.js` | CREATE | Ticker, vendor prices section, detail modal orchestration |
| `js/market-charts.js` | CREATE | Lightweight Charts wrapper for detail modal |
| `js/settings.js` | MODIFY | Add `bestPriceTicker` + `vendorPrices` to `sectionMap` in `applyLayoutOrder()` |
| `js/init.js` | MODIFY | Call `initMarketData()` after retail sync completes |
| `index.html` | MODIFY | Add 1 CDN script tag, add ticker + vendor prices sections, add 2 script defer tags, add modal HTML shell |
| `css/styles.css` | MODIFY | Ticker styles, vendor table styles, modal styles, theme overrides |
| `sw.js` | MODIFY | Add 2 new JS files to CORE_ASSETS |

---

## StakTrakr Critical Patterns (applies to all tasks)

- **DOM access**: `safeGetElement('id')` — never `document.getElementById()`
- **Storage reads/writes**: `saveData(key, val)` / `loadData(key)` from `js/utils.js`
- **New storage keys**: must be added to `ALLOWED_STORAGE_KEYS` in `js/constants.js`
- **innerHTML**: always wrap user content in `sanitizeHtml()`
- **New JS files**: add to BOTH `index.html` (correct load-order position) AND `sw.js` CORE_ASSETS
- **Variable declarations**: always use `const`/`let` — `var` is banned

---

## Phase 0 — Visual Prototype Refinement

- [x] 0.1. Create interactive prototype playground
  - _(Completed — see `artifacts/prototype-7-full-integrated.html`)_

- [x] 0.2. User visual approval
  - File: (no file changes — review only)
  - Present the vendor prices table and ticker sections from prototype-7 to the user. Confirm the visual design for: ticker placement, vendor table layout, clickable price behavior, metal tabs, "More Details" button placement. Iterate if needed.
  - Purpose: Lock down the visual design before implementation.
  - _Requirements: REQ-1, REQ-2, REQ-4, REQ-6_
  - _Prompt: Present the vendor prices section and ticker from prototype-7-full-integrated.html to the user. Focus on: (1) ticker strip below spot cards — speed, styling, content, (2) vendor prices table — metal tabs, price cells, premium badges, best-price highlighting, (3) "More Details" button placement and behavior. Ask for explicit visual approval or revision requests._

---

## Phase 1 — Foundation (sequential)

- [x] 1. Constants, layout entries, and storage keys
  - File: `js/constants.js`
  - Add `{ id: 'bestPriceTicker', label: 'Best Price Ticker', enabled: true }` and `{ id: 'vendorPrices', label: 'Vendor Prices', enabled: true }` to `LAYOUT_SECTION_DEFAULTS` (ticker after `spotPrices`, vendorPrices after `table`). Add 3 keys to `ALLOWED_STORAGE_KEYS`: `vendorPricesActiveTab`, `v2SpotHistory`, `v2SpotHistoryTs`. Add window exports.
  - Purpose: Config infrastructure for layout integration.
  - _Leverage: `LAYOUT_SECTION_DEFAULTS` at `js/constants.js:1178`; `ALLOWED_STORAGE_KEYS` at `js/constants.js:889`; window exports at `js/constants.js:1823`_
  - _Requirements: REQ-5, REQ-7_
  - Recommended Agent: Claude
  - _Prompt: Implement the task for spec STAK-504-market-data-module, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend infrastructure developer | Task: Edit `js/constants.js` to add market data layout entries and storage keys. (1) Add two entries to `LAYOUT_SECTION_DEFAULTS` after the existing `table` entry (~line 1183): `{ id: 'bestPriceTicker', label: 'Best Price Ticker', enabled: true }` and `{ id: 'vendorPrices', label: 'Vendor Prices', enabled: true }`. (2) Add 3 keys to `ALLOWED_STORAGE_KEYS`: `vendorPricesActiveTab`, `v2SpotHistory`, `v2SpotHistoryTs`. (3) Add window exports for any new constants. | Restrictions: Do NOT modify existing entries. Use `const`. | Success: `LAYOUT_SECTION_DEFAULTS` has 6 entries. 3 new keys in `ALLOWED_STORAGE_KEYS`. PREREQUISITE: Verify worktree. Mark [-] before starting. BLOCKING: Call log-implementation before marking [x]._

- [ ] 2. HTML skeleton and script registration
  - File: `index.html`, `sw.js`
  - Add ticker section `<div id="bestPriceTickerEl" class="market-ticker"></div>` after `spotPricesSection`. Add vendor prices section `<section id="vendorPricesSectionEl" class="vendor-prices-section"></section>` after `tableSectionEl`. Add modal HTML shell `<div id="marketDetailModal" class="market-detail-overlay" hidden>`. Add 1 CDN script in head: Lightweight Charts. Add 2 script defer tags for `js/market-charts.js` then `js/market-data.js` (after `chart-utils.js`, before `events.js`). Add both to `sw.js` CORE_ASSETS.
  - Purpose: DOM skeleton and script registration.
  - _Leverage: `index.html:465` (spotPricesSection), `index.html:958` (tableSectionEl), `sw.js` CORE_ASSETS_
  - _Requirements: REQ-1, REQ-2, REQ-4, REQ-5_
  - Recommended Agent: Claude
  - _Prompt: Implement the task for spec STAK-504-market-data-module, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Edit `index.html` and `sw.js` to add the market data DOM skeleton. (1) After `spotPricesSection` (~line 540 area, after the closing tag of spot prices), add: `<div id="bestPriceTickerEl" class="market-ticker" hidden></div>`. (2) After `tableSectionEl` (~line 958 area), add: `<section class="vendor-prices-section" id="vendorPricesSectionEl"><div class="section-title">Vendor Prices</div><div id="vendorPricesContainer"></div></section>`. (3) Before closing body tag, add the modal shell: `<div id="marketDetailModal" class="market-detail-overlay" hidden><div class="market-detail-modal"><button class="market-detail-close" id="marketDetailCloseBtn" title="Close">&times;</button><div id="marketDetailContent"></div></div></div>`. (4) In head, add CDN script: `<script defer src="https://cdn.jsdelivr.net/npm/lightweight-charts@4/dist/lightweight-charts.standalone.production.js"></script>`. (5) In the body script block, after `chart-utils.js` and before `events.js`, add: `<script defer src="js/market-charts.js"></script>` then `<script defer src="js/market-data.js"></script>`. (6) In `sw.js`, add both files to `CORE_ASSETS`. | Restrictions: Do NOT move existing sections. Do NOT change script order for existing files. | Success: Ticker div, vendor section, modal shell, CDN tag, 2 script tags, CORE_ASSETS updated. PREREQUISITE: Verify worktree. Mark [-] before starting. BLOCKING: Call log-implementation before marking [x]._

- [ ] 3. Settings layout integration
  - File: `js/settings.js`
  - Add `bestPriceTicker: safeGetElement('bestPriceTickerEl')` and `vendorPrices: safeGetElement('vendorPricesSectionEl')` to `sectionMap` in `applyLayoutOrder()`.
  - Purpose: Make ticker and vendor prices toggleable/reorderable in Settings > Layout.
  - _Leverage: `applyLayoutOrder()` at `js/settings.js:1476`; `sectionMap` at line 1478_
  - _Requirements: REQ-5_
  - Recommended Agent: Claude
  - _Prompt: Implement the task for spec STAK-504-market-data-module, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Add market data entries to the layout system. In `applyLayoutOrder()` (~line 1478), add to `sectionMap`: `bestPriceTicker: safeGetElement('bestPriceTickerEl')` and `vendorPrices: safeGetElement('vendorPricesSectionEl')`. Test that toggling these in Settings > Layout hides/shows them correctly. | Restrictions: Only add to sectionMap — do NOT modify applyLayoutOrder logic. | Success: Both sections appear in Settings > Layout toggle list. Toggling hides/shows. Reordering works. PREREQUISITE: Verify worktree. Mark [-] before starting. BLOCKING: Call log-implementation before marking [x]._

---

## Phase 2 — CSS (can run parallel with Phase 1 — only touches css/styles.css)

- [x] 4. CSS styles for ticker, vendor table, and modal
  - File: `css/styles.css`
  - Add all market data CSS: ticker strip, ticker track animation (60s), ticker items, vendor prices section, metal tab bar, vendor table (sticky first column on mobile), price cells with premium badges, best-price highlight, carried/OOS states, modal overlay + modal container + close button. All 3 theme variants with vivid dark mode colors.
  - Purpose: Complete CSS foundation.
  - _Leverage: `css/styles.css:1-230` for theme variables; prototype-7 vendor prices and ticker CSS_
  - _Requirements: REQ-1, REQ-2, REQ-4, REQ-6_
  - Recommended Agent: Claude
  - _Prompt: Implement the task for spec STAK-504-market-data-module, first run spec-workflow-guide to get the workflow guide then implement the task: Role: CSS/frontend designer | Task: Add all market data CSS to `css/styles.css`. Read the prototype at `.spec-workflow/specs/STAK-504-market-data-module/artifacts/prototype-7-full-integrated.html` for the visual design — source class names and spacing from the vendor prices and ticker sections. Add at end of file. Key classes: `.market-ticker` (overflow hidden, subtle bg), `.ticker-track` (flex, `@keyframes ticker-scroll` -50% over 60s linear infinite), `.ticker-track.static` (no animation), `.ticker-item` (pill-shaped items), `.vendor-prices-section`, `.vendor-prices-tabs` (tab bar with active bottom border), `.vendor-prices-table` (full-width, sticky first column on mobile), `.vp-price` (monospace, pointer cursor, hover effect), `.vp-premium` (small colored badge: green under 5%, yellow 5-15%, red over 15%), `.vp-best` (green highlight for best price), `.vp-carried` (dashed border + C), `.vp-oos` (muted italic), `.market-detail-overlay` (fixed backdrop z-index 10000), `.market-detail-modal` (max-width 900px, rounded, card bg), `.market-detail-close` (top-right X button). All 3 themes: dark = vivid saturated, light + sepia = adjusted. Use only `var()` for colors. | Restrictions: Add only, don't modify existing. No hardcoded hex. | Success: All components styled in 3 themes. Table scrollable on mobile. Modal centered. Ticker smooth. PREREQUISITE: Verify worktree. Mark [-] before starting. BLOCKING: Call log-implementation before marking [x]._

---

## Phase 3 — Components (sequential — tasks 5-7 share market-data.js)

- [ ] 5. Best Price Ticker
  - File: `js/market-data.js` (CREATE)
  - Create module with `initMarketData()`, `refreshMarketData()`, and `renderBestPriceTicker()`. Reads cached retail data, finds cheapest in-stock vendor per coin, builds ticker items. Duplicates for scroll loop. Static if < 4 items. Hidden if no data.
  - Purpose: Glanceable deal finder — first market data feature.
  - _Leverage: Cached retail data; `_manifestCoinMeta`; `_manifestVendorMeta`; `sanitizeHtml()`; `safeGetElement`_
  - _Requirements: REQ-1, REQ-7_
  - Recommended Agent: Claude
  - _Prompt: Implement the task for spec STAK-504-market-data-module, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Create `js/market-data.js` and implement the Best Price Ticker. Read prototype-7 for visual reference. (1) `initMarketData()` — async entry point. Read cached retail data from `window._v2RetailData` or `loadData('v2ManifestCache')`. Read spot data for premium calc. Call `renderBestPriceTicker()`. Stub `renderVendorPrices()` for task 6. (2) `renderBestPriceTicker()` — container via `safeGetElement('bestPriceTickerEl')`. For each non-goldback coin, find lowest in-stock vendor. Calculate premium %. Build items: metal dot + coin name + vendor + price + premium. If >= 4 items, duplicate array, enable scroll. If < 4, static. If 0, keep hidden. Else remove `hidden`. (3) `refreshMarketData()` — re-renders from cache. Export both on window. `sanitizeHtml()` all names. | Restrictions: Vanilla JS, `safeGetElement`, `loadData`/`saveData`, `sanitizeHtml`. No `var`. | Success: Ticker renders below spot cards, scrolls gently, correct prices. PREREQUISITE: Verify worktree. Mark [-] before starting. BLOCKING: Call log-implementation before marking [x]._

- [ ] 6. Vendor Prices Section
  - File: `js/market-data.js`
  - Implement `renderVendorPrices()`. Metal tabs, per-slug vendor detail fetches, table with clickable price cells (popup to vendor product page), premium badges, best-price highlight, carried/OOS. "More Details" button per row.
  - Purpose: Core feature — actionable vendor price comparison with buy links.
  - _Leverage: `_buildMarketVendorLink()` pattern from `retail.js:1030`; `retailProviders` for URLs; `_manifestVendorMeta`; `sanitizeHtml()`_
  - _Requirements: REQ-2, REQ-3, REQ-5_
  - Recommended Agent: Claude
  - _Prompt: Implement the task for spec STAK-504-market-data-module, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Implement `renderVendorPrices()` in `js/market-data.js`. Read prototype-7 vendor prices table for visual reference. (1) Container via `safeGetElement('vendorPricesContainer')`. (2) Metal tab bar: Gold/Silver/Platinum/Palladium/Goldback. Active tab styled. Persist via `saveData('vendorPricesActiveTab', metal)`. (3) On tab click: filter coins by metal from cached retail. Fetch per-slug detail: `Promise.allSettled(slugs.map(...))`. (4) Table: Coin column + vendor columns + Median + Spread. (5) Price cells: monospace price, premium badge below (green under 5%, yellow 5-15%, red over 15%). Clickable: `window.open(retailProviders[slug][vendorId] || _manifestVendorMeta[vendorId].url, 'retail_vendor_' + vendorId, 'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no')` with `popup.opener = null`. (6) Best price per row: `.vp-best`. Carried: `.vp-carried`. OOS: `.vp-oos`. (7) "More Details" button per row with `data-slug`, calls `openMarketDetailModal(slug)` (stub). (8) Call from `initMarketData()`. | Restrictions: `sanitizeHtml` all names. Match existing popup pattern exactly. No `var`. | Success: Table renders with tabs, clickable prices, popups, badges. PREREQUISITE: Verify worktree. Mark [-] before starting. BLOCKING: Call log-implementation before marking [x]._

- [ ] 7. Market Detail Modal
  - File: `js/market-data.js`, `js/market-charts.js` (CREATE)
  - Implement `openMarketDetailModal(slug)` and `closeMarketDetailModal()` in market-data.js. Create market-charts.js with `createCoinChart()`, `destroyCoinChart()`, `getChartThemeColors()`. Modal: coin header, price summary, Lightweight Charts 7d chart, vendor table with buy links. Close via button/backdrop/Escape. Watermark disabled.
  - Purpose: Per-coin deep dive with charts and buy links.
  - _Leverage: Lightweight Charts `createChart()` + `AreaSeries`; `getComputedStyle` for theme colors; `sanitizeHtml()`; `safeGetElement`_
  - _Requirements: REQ-4, REQ-6_
  - Recommended Agent: Claude
  - _Prompt: Implement the task for spec STAK-504-market-data-module, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend chart developer | Task: Implement Market Detail Modal and create market-charts.js. **market-data.js:** (1) `openMarketDetailModal(slug)` — fetch `/v2/retail/{slug}/latest.json`. Fetch spot history once: `/v2/spot/history/7d.json` → cache in localStorage. Build content: coin header (name/metal/weight), price summary (median/low/high), chart container, vendor table with buy links. Show modal by removing `hidden`. (2) `closeMarketDetailModal()` — destroy chart, clear content, add `hidden`, remove Escape listener. (3) Event listeners: close button, backdrop click, Escape key. **market-charts.js (new):** (1) `getChartThemeColors()` — read CSS custom properties. (2) `createCoinChart(containerId, metalCode)` — guard `typeof LightweightCharts !== 'undefined'`. Create chart with `autoSize: true`, `watermark: { visible: false }`, transparent bg, theme-colored grid. Add AreaSeries with metal color. Set data from cached history. Return instance. (3) `destroyCoinChart(chart)` — `chart.remove()`. Export all on window. | Restrictions: typeof guard for LightweightCharts. `watermark: { visible: false }` MANDATORY. `sanitizeHtml` all text. No `var`. | Success: Modal opens with chart + vendor table. Chart shows 7d. Buy links work. Closes cleanly. Falls back to table-only without CDN. PREREQUISITE: Verify worktree. Mark [-] before starting. BLOCKING: Call log-implementation before marking [x]._

---

## Phase 4 — Integration

- [ ] 8. Init integration and theme handler
  - File: `js/init.js`
  - Call `initMarketData()` after retail sync. Add theme change listener for `refreshMarketData()`. Verify full page load flow.
  - Purpose: Wire market data into app lifecycle.
  - _Leverage: `js/init.js:555`; theme change events; `refreshMarketData()`_
  - _Requirements: REQ-5, REQ-6, REQ-7_
  - Recommended Agent: Claude
  - _Prompt: Implement the task for spec STAK-504-market-data-module, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend integration developer | Task: Wire initMarketData into app startup. (1) In init.js after applyLayoutOrder(), add: `if (typeof initMarketData === 'function') initMarketData().catch(e => { if (typeof debugLog === 'function') debugLog('[market-data] Init failed: ' + e.message, 'warn'); });` (2) Add theme change listener that calls refreshMarketData(). (3) Verify layout toggle works for both sections. | Restrictions: Don't block app init. Use typeof guards. Don't modify theme.js. | Success: initMarketData fires after spot/retail. Theme toggle updates. Layout toggle works. PREREQUISITE: Verify worktree. Mark [-] before starting. BLOCKING: Call log-implementation before marking [x]._

---

## Standard Closing Tasks

- [ ] 9. Smoke test
  - File: (testing only)
  - Run `/bb-test`. Manually verify: ticker, vendor table, clickable prices, modal, theme switching, layout toggle, mobile.
  - _Requirements: All_
  - _Prompt: Role: QA engineer | Smoke test all market data features. PREREQUISITE: Test-only. Mark [-] before starting. BLOCKING: Log results before marking [x]._

- [ ] 10. Update DocVault pages
  - File: (DocVault only)
  - Run `/vault-update`. Verify affected pages.
  - _Requirements: All_
  - _Prompt: Role: Technical writer | Run /vault-update. Verify updates. BLOCKING: Log before marking [x]._
