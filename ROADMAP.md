# StakTrakr Roadmap

> Auto-generated from DocVault issues. Last updated: 2026-04-11.
> Version: v3.33.96 | Branch: dev

## Summary

| Category             | Count  |
| -------------------- | ------ |
| Completed (all time) | **67** |
| Active (todo)        | **7**  |
| Backlog              | **20** |
| Blocked              | **1**  |
| Total open           | **28** |

## Recently Completed

| Issue    | Title                                                                              | Type    | Completed  |
| -------- | ---------------------------------------------------------------------------------- | ------- | ---------- |
| STAK-521 | Unresolved slugs hidden from filter matrix but default to enabled                  | bug     | 2026-04-11 |
| STAK-526 | Cloud sync \_applyAndFinalize records success after partial settings write failure | bug     | 2026-04-10 |
| STAK-536 | Add <www.lbruton.cc> portfolio link to footer/about page                           | chore   | 2026-04-07 |
| STAK-533 | Numista API key stripped during cloud sync — recurring regression                  | bug     | 2026-04-05 |
| STAK-531 | SECURITY: Malicious GitHub Actions workflow exfiltrating secrets                   | bug     | 2026-04-04 |
| STAK-528 | Shape-aware dimension fields — bars show Length/Width instead of Diameter          | feature | 2026-04-03 |
| STAK-508 | Epic: Full v2 API Migration — Frontend Cutover                                     | epic    | 2026-04-01 |
| STAK-509 | V1 API dead code cleanup                                                           | chore   | 2026-04-01 |
| STAK-518 | StakTrakr API cache settings revert to 24h — simplify to enable v2                 | bug     | 2026-04-01 |
| STAK-519 | Cloud sync fails to apply API keys and loops on blank storage                      | bug     | 2026-04-01 |
| STAK-520 | Market filter deep validation on load                                              | bug     | 2026-03-31 |
| STAK-525 | Market sync button stuck in Syncing state — status text overflow                   | bug     | 2026-03-31 |
| STAK-515 | Replace Market Settings tab with Ticker & Market Filter content                    | feature | 2026-03-29 |
| STAK-510 | APMEX Goldback prices pull CC/PayPal instead of Check/Wire                         | bug     | 2026-03-29 |
| STAK-516 | Vendor prices refresh button and timestamp stuck on file://                        | bug     | 2026-03-29 |

## Active Work Streams

### Market & Retail Pricing

Live vendor price surfacing, per-item mapping, and the providers endpoint.

| Issue    | Title                                                                      | Status  | Priority |
| -------- | -------------------------------------------------------------------------- | ------- | -------- |
| STAK-537 | Re-add Clear Lock button to home poller dashboard                          | todo    | P2       |
| STAK-501 | Per-item retail price mapping — link inventory items to live market prices | backlog | P2       |
| STAK-507 | Add /v2/providers.json endpoint to StakTrakrApi                            | backlog | P2       |

### Settings Redesign

Full tab-by-tab overhaul of the Settings UI. STAK-443 (API tab) is the highest-priority sub-issue.

| Issue    | Title                                                                          | Status  | Priority |
| -------- | ------------------------------------------------------------------------------ | ------- | -------- |
| STAK-443 | Settings Redesign: API tab — full redesign with sectioned card layout          | backlog | P2       |
| STAK-436 | Settings Redesign: Appearance tab — Realized Row toggle + remove clutter       | backlog | P3       |
| STAK-437 | Settings Redesign: Remove Search page, move to Filters tab as card             | backlog | P3       |
| STAK-438 | Settings Redesign: Filters tab — combine settings into cards with toggles      | backlog | P3       |
| STAK-439 | Settings Redesign: Images tab — remove redundancy, move Numista assets         | backlog | P3       |
| STAK-440 | Settings Redesign: Move Currency and Pricing to Appearance tab                 | backlog | P3       |
| STAK-441 | Settings Redesign: Goldback tab — condense to single toggle + rate display     | backlog | P3       |
| STAK-442 | Settings Redesign: Storage tab — move danger buttons to Inventory tab          | backlog | P3       |
| STAK-444 | Settings Redesign: Cloud tab — restore Cloud Settings menu, simplify           | backlog | P3       |
| STAK-446 | Settings Redesign: LOG/Changelog — audit CRUD logging, rename and clean        | backlog | P3       |
| STAK-447 | Settings Redesign: Market tab in LOG — 30-day rolling history with chart       | backlog | P3       |
| STAK-445 | Settings Redesign: Move FAQ below LOG, keep as-is                              | backlog | P4       |
| STAK-535 | Move Metal Order and Inline Chips settings from Filter Chips tab to Appearance | todo    | P4       |

### Testing Infrastructure

Migrate to Playwright as the primary E2E test runner.

| Issue    | Title                                                                | Status  | Priority |
| -------- | -------------------------------------------------------------------- | ------- | -------- |
| STAK-532 | Migrate from Browserbase-only to Playwright-first testing            | backlog | P3       |
| STAK-539 | Playwright regression test for \_isSlugResolved predicate (STAK-521) | blocked | P4       |

### Bug Queue

| Issue    | Title                                                                     | Status  | Priority |
| -------- | ------------------------------------------------------------------------- | ------- | -------- |
| STAK-529 | Settings — default sort direction (asc/desc) control missing              | todo    | P3       |
| STAK-527 | STAKTRAKR toggle bypasses priority collision logic and leaves stale state | backlog | P3       |

### Infrastructure & Reliability

| Issue    | Title                                                              | Status | Priority |
| -------- | ------------------------------------------------------------------ | ------ | -------- |
| STAK-479 | Health check API endpoints for Fly.io remote monitoring            | todo   | P3       |
| STAK-482 | Verify flock guard on retail poller cron prevents overlapping runs | todo   | P4       |

### Cleanup & Polish

| Issue      | Title                                                                  | Status  | Priority |
| ---------- | ---------------------------------------------------------------------- | ------- | -------- |
| STAK-538   | Remove first-run acknowledgment modal (ackModal) — covered by InfoBar  | todo    | P3       |
| STAK-540   | Drop orphaned staktrakr.market_filter entries for unresolved slugs     | todo    | P4       |
| STAK-493-C | Surface image vault push/pull failures to user                         | backlog | P3       |
| STAK-517   | Wire market filter settings into cloud sync, import/export, and backup | backlog | P3       |
| STAK-530   | Rarity & mintage as table columns with compact visual indicator        | backlog | P3       |
| STAK-534   | Explore replacing firecrawl in /scan-mentions with web-to-markdown     | backlog | P3       |

## Blocked

| Issue    | Title                                                     | Blocked By | Notes                                                                     |
| -------- | --------------------------------------------------------- | ---------- | ------------------------------------------------------------------------- |
| STAK-539 | Playwright regression test for \_isSlugResolved predicate | STAK-532   | Requires Playwright config and tests/playwright/ directory to exist first |

## Dependency Graph

```text
STAK-532 (Playwright migration)
  └── STAK-539 (slug resolution regression test) — blocked until STAK-532 lands
```

---

## Completed (Full History)

<details>
<summary>Shipped features (click to expand)</summary>

- **v3.33.96** — STAK-521: Quarantine unresolved slugs from market filter matrix
- **v3.33.95** — STAK-526: Cloud sync atomic rollback on settings write failure
- **v3.33.94** — STAK-533: Fix Numista API key stripped during cloud sync
- **v3.33.x** — STAK-508/509/518/519: Full v2 API migration, v1 dead code cleanup, cache settings fix, cloud sync key fix
- **v3.33.x** — STAK-515/520/525/528: Market Settings tab replacement, market filter validation, sync button fix, shape-aware dimensions
- **v3.31.x** — STAK-98/104: Item tags system (Numista + custom tags, filter chip integration), Save Search as Custom Filter Chip
- **v3.30.00** — STAK-118/106/124/125/126: Card View Engine, Mobile Overhaul & UI Polish — three card styles with sparkline headers, CDN image URLs, mobile viewport overhaul, rows-per-page with back-to-top, theme-aware sparklines
- **v3.29.06** — STAK-115/116/117: Design System & Settings Polish — unified toggle styles, Appearance tab fieldset redesign, living style guide (style.html), CSS design system coding standards
- **v3.29.04** — STAK-110/111/113: View Modal Visual Sprint — cert badge overlay with authority colors, chart range pills (1Y/5Y/10Y/Purchased), valuation-first default order, purchase date in valuation
- **v3.29.03** — STAK-108/109/103: Price history bug fix, per-item price history management UI with inline delete and undo/redo, chart fixes (seed bundle for file://, adaptive x-axis labels, custom date range picker)
- **v3.29.02** — PWA crash fix: service worker error handling for all fetch strategies
- **v3.29.01** — Codacy duplication reduction: shared toggle helpers, merged config renderers, deduplicated builders
- **v3.29.00** — STAK-94 (Epic): Local Image System — image processor (STAK-95), seeded image library (STAK-96), images settings tab (STAK-102), user photo upload (STAK-32), mobile camera capture (STAK-33), image quota manager (STAK-97), edit modal pattern rule toggle
- **v3.28.04** — STAK-91: Item View Modal overhaul — price history charts, valuation section, section reordering
- **v3.28.03** — STAK-84: Table row thumbnail images with hover/click preview
- **v3.28.02** — STAK-87/88: Bulk cache all inventory coin images, include image cache in ZIP backup/restore
- **v3.28.01** — STAK-89/92: Fix 24h % on spot cards, spot card comparison mode setting (Close/Close, Open/Open, Open/Close)
- **v3.28.00** — STAK-90/93/107: Mobile API settings fix, What's New splash bug fix, backup restore hydration fix
- **v3.27.05** — STAK-81/82/83/85/86: parsePriceToUSD fix, stale spot-lookup fix, Activity Log stale data fix, Samsung S24+ layout fix, remove redundant View icon
- **v3.27.04** — STAK-63: Time Zone Selection for Timestamps
- **v3.27.03** — STAK-74: PWA support — manifest, service worker, installable app experience
- **v3.27.02** — Multi-color storage bar: stacked localStorage (blue) + IndexedDB (green) segments with tooltips
- **v3.27.01** — Iframe to popup window migration for source URLs and Numista links
- **v3.27.00** — STAK-37: Coin image cache (IndexedDB, 50MB quota) & item view modal with Numista enrichment, metadata caching, eBay search
- **v3.26.03** — STAK-79/80: XSS & HTML injection hardening with shared `escapeHtml()` utility
- **v3.26.02** — Autocomplete migration fix, version check CORS fix
- **v3.26.01** — Fuzzy autocomplete settings toggle
- **v3.26.00** — STAK-62: Autocomplete & fuzzy search pipeline with abbreviation expansion
- **v3.25.05** — STAK-71: Details modal QoL — responsive charts, pie slice labels, scrollable breakdown
- **v3.25.04** — STAK-70: Mobile-optimized modals — full-screen at ≤768px, touch-sized inputs, landscape card view
- **v3.25.03** — STAK-31/38: Responsive card view & mobile layout — CSS card view at ≤768px, table CSS hardening
- **v3.25.02** — STAK-56/61: Codebase refactoring — complexity reduction, CCN decomposition, modularization
- **v3.25.01** — STAK-64/67: Version splash fix (friendly announcements), footer version badge with remote update check, sponsor badges
- **v3.25.00** — STAK-54/65/66: Appearance settings (header buttons, layout toggles), spot lookup fix, sparkline improvements
- **v3.24.01** — STAK-57: ZIP/JSON backup fix — Goldback fields, weightUnit, purity, marketValue preserved on restore
- **v3.24.00** — STAK-50: Multi-currency support with 17-currency display, daily exchange rate conversion, dynamic formatting
- **v3.23.02** — STAK-52: Bulk Edit pinned selections, dormant prototype cleanup
- **v3.23.01** — Goldback real-time estimation, Settings reorganization
- **v3.23.00** — STAK-42/43/44/45: Persistent UUIDs, silent price history recording, Settings Log sub-tabs, Goldback denomination pricing & type support
- **v3.22.01** — Form layout, bulk edit dropdowns, purity chips
- **v3.22.00** — STAK-22/24/25/27: Purity field & melt formula, PCGS quota bar, pie chart metric toggle, test-loader extraction
- **v3.21.03** — STAK-23: Search matches custom chip group labels
- **v3.21.02** — Seed data & first-time UX: 720 seed spot history entries, 8 sample inventory items, README overhaul
- **v3.21.01 – v3.21.02** — Spot card % change, spot history import/export, provider sync toggle, PCGS persistence
- **v3.21.00** — PCGS# field & cert verification, Bearer token config, PCGS in search/bulk edit/export
- **v3.20.00** — Bulk Edit tool: full-screen modal, 16 editable fields, searchable table, copy/delete in bulk
- **v3.19.00** — Filter chip category toggles & sort in Settings > Chips
- **v3.18.00** — API Settings redesign: Numista first-class tab, drag-to-reorder, compact header
- **v3.17.00** — Inline chip settings, search expansion, ZIP backup includes chip settings
- **v3.16.00 – v3.16.02** — Custom chip grouping, chip blacklist, dynamic name chips, API settings fix
- **v3.14.00 – v3.14.01** — Encrypted portable backup (.stvault), AES-256-GCM
- **v3.12.00 – v3.12.02** — Portal view (scrollable table), NGC cert lookup, Numista Sets
- **v3.11.00** — Unified settings modal with sidebar navigation
- **v3.10.00 – v3.10.01** — Serial # field, Year/Grade/N# filter chips, Numista UX improvements
- **v3.09.04 – v3.09.05** — Inline catalog & grading tags, grade badges, cert verification
- **v3.09.02 – v3.09.03** — Numista API fix (base URL, endpoints, auth, params, field mapping)
- **v3.09.00 – v3.09.01** — Filter chips system, keyword grouping, 280-item normalizer dictionary
- **v3.08.00 – v3.08.01** — Spot price card redesign, sparkline charts, trend range dropdown
- **v3.07.00 – v3.07.03** — Portfolio visibility overhaul, retail/gain-loss confidence styling, metal detail modal
- **v3.07.00 + v3.07.02** — Retail column UX & inline editing
- **v3.07.01** — Light & Sepia theme contrast pass (WCAG AAA)
- **v3.06.01 – v3.06.02** — eBay search split, SVG icon, About modal overhaul
- **v3.06.00** — StakTrakr rebrand with domain-based auto-branding
- **v3.05.00 – v3.05.04** — Unified add/edit modal, weight precision, fraction input, duplicate button

</details>
