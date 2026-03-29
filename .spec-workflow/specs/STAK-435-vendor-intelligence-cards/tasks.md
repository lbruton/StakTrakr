# Tasks Document: Vendor Intelligence Cards

## References

- **Issue:** STAK-435
- **Spec Path:** `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/`

{/* VERSION CHECKOUT GATE — MANDATORY
Before implementing ANY task below, you MUST:
1. Run /release patch (or /start-patch) to claim a version and create a worktree
2. Record the assigned version (e.g., 3.34.01) in the first implementation log
3. ALL file edits happen inside the worktree — never in the main repo working directory
4. Verify: `git branch --show-current` returns patch/VERSION, not dev or main
5. If multiple tasks are parallelized across agents, each agent gets its own /release patch
Skipping this gate is a workflow violation. See CLAUDE.md Version Checkout Gate section.

SPEC COMPLETION GATE — BLOCKING (Phase 5):
After ALL tasks are [x] and implementation logs are recorded:
1. Run /wiki-update to update all wiki pages whose frontmatter sourceFiles match this spec's changed files
2. Close all linked vault issues (move to Done)
3. Verify /bb-test passes or file follow-up issues for any new failures
4. The spec is NOT complete until all three are verified.
*/}

---

## StakTrakr Critical Patterns (applies to all tasks)

- **DOM access**: `safeGetElement('id')` — never `document.getElementById()`
- **Storage reads/writes**: `saveData(key, val)` / `loadData(key)` from `js/utils.js`
- **New storage keys**: must be added to `ALLOWED_STORAGE_KEYS` in `js/constants.js`
- **innerHTML**: always wrap user content in `sanitizeHtml()`
- **New JS files**: add to BOTH `index.html` (correct load-order position) AND `sw.js` CORE_ASSETS
- **Duplicate check**: before editing `events.js` or `api.js`, grep for the function name in both files
- **Variable declarations**: always use `const`/`let` — `var` is banned per AGENTS.md coding style

---

## File Touch Map

| Action | File | Scope |
|--------|------|-------|
| CREATE | `js/vendor-cards.js` | Core module: alias map, vendor resolution, stats computation, card rendering, carousel nav |
| MODIFY | `js/constants.js:1159` | Add `vendorCards` entry to `LAYOUT_SECTION_DEFAULTS` |
| MODIFY | `index.html:~602` | Add `<section id="vendorCardsSectionEl">` container with carousel wrapper, nav buttons, dots |
| MODIFY | `index.html:~5285` | Add `<script defer src="./js/vendor-cards.js">` in script load order (after `retail-view-modal.js`) |
| MODIFY | `sw.js:~93` | Add `'./js/vendor-cards.js'` to `CORE_ASSETS` |
| MODIFY | `js/init.js:~177` | Register `elements.vendorCardsSectionEl = safeGetElement('vendorCardsSectionEl')` |
| MODIFY | `js/settings.js:1478` | Add `vendorCards: elements.vendorCardsSectionEl` to `sectionMap` in `applyLayoutOrder()` |
| MODIFY | `js/inventory-table.js:~684` | Call `renderVendorCards()` after `updateSummary()` accumulator loop |
| MODIFY | `js/retail.js:~460` | Call `renderVendorCards()` after `syncRetailPrices()` completes |
| MODIFY | `css/styles.css` | Add `.vendor-card`, `.vendor-cards-wrapper`, `.vendor-cards-nav-btn`, `.vendor-cards-dot` styles |
| TEST | `tests/runbook/06-ui-ux.md` | New test blocks for vendor card visibility, content, click interaction |

---

## Phase 1 — Core Module and Infrastructure

- [x] 0.1. Create visual prototype — Playground HTML (v1 — rejected, see 0.1b)

- [x] 0.1b. Rebuild prototype — 4 design variations with market prices
  - File: `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/artifacts/playground.html`
  - Build an interactive single-file HTML playground showing the vendor cards carousel with mock data for 4 vendors (APMEX, JM Bullion, Monument, Hero). Include: card layout with brand-color header accent, stat rows (weight, cost, melt, retail, G/L with color), premium rows, carousel arrows and dots, empty-state hint. Use CSS variables matching StakTrakr's dark theme tokens. Include a theme switcher (dark/light/sepia) to verify contrast.
  - Purpose: Get visual approval before implementing real cards. The prototype IS the design source of truth.
  - _Leverage: `css/styles.css:3904-3990` for `.total-card` and carousel patterns; `js/retail.js:82-93` for vendor brand colors_
  - _Requirements: REQ-2, REQ-4, REQ-6_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend designer | Task: Create an interactive HTML playground at `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/artifacts/playground.html`. This is a self-contained single-file prototype (HTML+CSS+JS in one file) showing vendor intelligence cards in a horizontal scrollable carousel. Use mock data for 4 vendors: APMEX (color #60a5fa, 60 items, $2728 cost, $3382 melt, $3441 retail, +$712 gain), JM Bullion (#fbbf24, 25 items), Monument (#c4b5fd, 15 items), Hero (#f87171, 8 items). Each card shows: vendor name with brand color top-border, item count, weight, cost basis, melt value, retail value, gain/loss (green for gain, red for loss), divider, market premium %, my premium %. Include carousel navigation (prev/next arrows, dot indicators). Include an empty-state hint banner: "Tag items with a vendor source to see vendor intelligence cards." Include a theme switcher with dark (default), light, and sepia modes using CSS custom properties matching StakTrakr's design tokens from css/styles.css. Read css/styles.css lines 3904-3990 for the .total-card pattern to match. | Restrictions: Single file only — no external dependencies. Do not create production code. This is a visual prototype only. | Success: Playground opens in browser, shows 4 vendor cards in a scrollable carousel, theme switcher works across all 3 themes, gain/loss is color-coded, brand colors are visible, empty-state hint is shown when cards are hidden. PREREQUISITE: This is a prototype task — no worktree needed. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

- [ ] 0.2. User approves visual prototype
  - File: (no file changes — approval only)
  - Present the playground to the user for interactive review. Collect explicit visual approval.
  - Purpose: Gate UI implementation behind visual approval.
  - _Requirements: All UI requirements_
  - _Prompt: Present the playground prototype at `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/artifacts/playground.html` to the user. Wait for their review. If they request changes, iterate. Once approved, update design.md Prototype Artifacts section with the playground file path._

- [ ] 0.3. Update design.md with prototype artifact paths
  - File: `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/design.md`
  - After user approves prototype, fill in the Stitch Screen IDs and Playground File fields in the UI Impact Assessment section.
  - Purpose: Record approved visual reference for implementers.
  - _Requirements: All_

- [ ] 1. Create `js/vendor-cards.js` — core module
  - File: `js/vendor-cards.js`
  - Implement the full vendor-cards module containing:
    - `SOURCE_VENDOR_ALIASES` static map (see design.md Data Models section)
    - `_resolveVendor(source)` — normalization + direct match + alias lookup, excludes `goldback`
    - `_computeVendorStats()` — single-pass inventory accumulator returning `Map<vendorId, VendorStats>`
    - `_computeMarketPremium(vendorId)` — averages vendor premiums across active retail slugs
    - `renderVendorCards()` — orchestrator: compute stats → build card DOM → init carousel. Exported to `window.renderVendorCards`
    - `_initVendorCarousel()` — scroll-snap nav with arrows, dots, responsive breakpoints
    - Card click handler: sets `activeFilters['purchaseLocation']` with all source values for vendor, calls `renderTable()` + `renderActiveFilters()`, scrolls to inventory table
    - Empty-state hint when zero vendors matched
  - All DOM access via `safeGetElement()`. All user text (`purchaseLocation`) through `sanitizeHtml()`. All currency via `formatCurrency()`. All valuations via `computeItemValuation()`.
  - Purpose: Self-contained vendor intelligence card module. Single new file keeps the feature isolated.
  - _Leverage: `js/inventory-table.js:627-684` for updateSummary() accumulator pattern; `js/retail.js:130` for getVendorDisplay(); `js/retail.js:107` for getActiveRetailSlugs(); `js/retail.js:121` for getRetailCoinMeta(); `js/retail.js:152` for retailPrices; `js/utils.js:1350` for computeItemValuation(); `js/card-view.js:1230-1290` for _initTotalsCarousel() carousel pattern; `js/filters.js:8` for activeFilters; `js/filters.js:1145` for applyQuickFilter(); `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/artifacts/playground.html` for approved visual design_
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-7_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Create `js/vendor-cards.js` — the complete vendor intelligence cards module. This is the core implementation task. Read the approved prototype at `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/artifacts/playground.html` — source your DOM structure, class names, and visual layout from it. (1) Define `SOURCE_VENDOR_ALIASES` map per design.md. (2) Implement `_resolveVendor(source)` — normalize (trim, lowercase, strip protocol/www/.com, collapse whitespace), direct match against `RETAIL_VENDOR_NAMES`, alias lookup, return null for goldback. (3) Implement `_computeVendorStats()` — single pass over global `inventory`, skip disposed items and goldback, use `computeItemValuation(item, spotPrices[metalKey])` for valuations (with fallback if unavailable, see inventory-table.js:669-681), accumulate per vendor: totalItems, totalWeight, totalPurchased, totalMeltValue, totalRetailValue, totalGainLoss, sourceValues (Set of original purchaseLocation strings). (4) Implement `_computeMarketPremium(vendorId)` — iterate `getActiveRetailSlugs()`, for each slug check `retailPrices.prices[slug]?.vendors?.[vendorId]`, if inStock compute `(price - coinMelt) / coinMelt` where coinMelt = `getRetailCoinMeta(slug).weight * spotPrices[metal]`, average all premiums, return null if zero data points. (5) Implement `renderVendorCards()` — get container via safeGetElement, compute stats, if no vendors show empty-state hint banner ("Tag items with a vendor source to see vendor intelligence cards"), else build one `.vendor-card` per vendor using `getVendorDisplay()` for branding, `formatCurrency()` for money, `sanitizeHtml()` on any purchaseLocation text rendered to DOM, color-code gain/loss (green positive, red negative). Attach click handler per card: set `activeFilters['purchaseLocation'] = { values: [...vendorStats.sourceValues] }`, call `renderTable()`, call `renderActiveFilters()`, scroll inventory table into view. Export to `window.renderVendorCards`. (6) Implement `_initVendorCarousel()` adapting `_initTotalsCarousel()` from card-view.js:1230 — query `.vendor-card` elements, build dots in `#vendorCardsDots`, wire prev/next buttons, scroll-snap with `scroll-snap-align: start`, update dot active state on scroll, disable buttons at scroll boundaries. Hide nav at wide breakpoint when all cards fit. | Restrictions: Only create `js/vendor-cards.js` — do NOT modify any other files in this task. Use `safeGetElement()` never `document.getElementById()`. Use `const`/`let` never `var`. Do not add new localStorage keys. Do not import/require — all dependencies are available as globals (file-scope or window). Do not duplicate computeItemValuation logic — call the function. | Success: `js/vendor-cards.js` exists with all 6 components. `window.renderVendorCards` is exported. Calling `renderVendorCards()` in browser console (after manual script load) generates cards from inventory data. PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

- [ ] 2. Add CSS styles for vendor cards
  - File: `css/styles.css`
  - Add vendor card styles following the `.total-card` pattern. Include:
    - `.vendor-cards-section` — section container
    - `.vendor-cards-wrapper` — relative wrapper for carousel + nav (mirrors `.totals-wrapper`)
    - `.vendor-cards` — flex container with `overflow-x: auto`, `scroll-snap-type: x mandatory`, gap (mirrors `.totals`)
    - `.vendor-card` — card styling: `var(--bg-secondary)` background, border-radius, padding, border, shadow, scroll-snap-align, responsive flex breakpoints matching `.total-card` (mobile: ~full width with peek, 580px: 50%, 960px: 33%, wide: flex-1)
    - `.vendor-card-header` — vendor name + count with brand color top border
    - `.vendor-card-row`, `.vendor-card-label`, `.vendor-card-value` — stat row layout (label left, value right)
    - `.vendor-card-gainloss.gain` / `.loss` — green/red coloring
    - `.vendor-card-divider` — subtle separator between portfolio and premium sections
    - `.vendor-cards-nav-btn` — carousel arrows (mirrors `.totals-nav-btn`)
    - `.vendor-cards-dot` / `.vendor-cards-dots` — dot indicators (mirrors `.totals-dot` / `.totals-dots`)
    - `.vendor-cards-hint` — empty state banner styling (subtle, muted text)
    - Responsive breakpoints: hide nav at wide viewport (matches totals pattern)
    - Dark mode overrides if needed (check `.total-card` dark mode at styles.css:3993)
  - Purpose: Visual consistency with existing totals carousel while being distinct enough to not confuse with metal cards.
  - _Leverage: `css/styles.css:3860-3990` for `.totals`, `.total-card`, `.totals-wrapper`, `.totals-nav-btn`, `.totals-dot` patterns; `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/artifacts/playground.html` for approved visual design_
  - _Requirements: REQ-4, REQ-6_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer (CSS) | Task: Add vendor card styles to `css/styles.css`. Read the approved prototype at `.spec-workflow/specs/STAK-435-vendor-intelligence-cards/artifacts/playground.html` for the exact visual design. Read `css/styles.css:3860-3990` for the existing `.totals` / `.total-card` / `.totals-nav-btn` / `.totals-dot` pattern. Mirror this pattern for vendor cards using `.vendor-cards-*` class names. Key classes: `.vendor-cards-section`, `.vendor-cards-wrapper` (relative, for arrow positioning), `.vendor-cards` (flex, overflow-x auto, scroll-snap-type x mandatory, gap var(--spacing)), `.vendor-card` (bg-secondary, radius-lg, padding-lg, border, shadow, snap-align start, responsive flex breakpoints: mobile calc(100% - 1.5rem), 580px 50%, 960px 33%, wide flex-1), `.vendor-card-header` (flex space-between, vendor name bold, count muted, brand color via 3px border-top), `.vendor-card-row` (flex space-between), `.vendor-card-label` (muted text), `.vendor-card-value` (bold, right-aligned), `.vendor-card-gainloss.gain` (green), `.vendor-card-gainloss.loss` (red), `.vendor-card-divider` (1px border-top, margin-y), `.vendor-cards-nav-btn` (absolute positioned, same as totals-nav-btn), `.vendor-cards-dot` / `.vendor-cards-dots` (same as totals-dot pattern), `.vendor-cards-hint` (text-center, muted, padding, italic). Add responsive media queries matching the totals breakpoints. Check for dark mode — if `.total-card` has dark-mode overrides at :3993, mirror them for `.vendor-card`. | Restrictions: Only modify `css/styles.css`. Add styles in a new clearly-commented section after the totals carousel section. Do not modify existing `.total-card` styles. Use existing CSS custom properties (var(--bg-secondary), var(--border), etc.) — no hardcoded colors except gain/loss green/red. | Success: Adding the `.vendor-card` class to a `<div>` in the browser produces the same visual as the approved prototype. Responsive breakpoints match totals cards. All three themes render correctly. PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

---

## Phase 2 — Integration and Wiring

- [ ] 3. Add HTML container and script tag to `index.html`
  - File: `index.html`
  - Add the vendor cards section container after the totals section (`totalsSectionEl` at line 601) and before the search section. Include:
    - `<section id="vendorCardsSectionEl">` wrapper
    - `.vendor-cards-wrapper` div with prev/next nav buttons and carousel container
    - `#vendorCardsCarousel` div (the scrollable flex container)
    - `#vendorCardsDots` div for dot indicators
    - `#vendorCardsHint` div for empty-state hint (hidden by default)
  - Add `<script defer src="./js/vendor-cards.js"></script>` in the script load order after `retail-view-modal.js` and before `api.js`.
  - Purpose: Provide DOM container and load the module.
  - _Leverage: `index.html:601-605` for totals section container pattern; `index.html:~5283-5285` for script load order position_
  - _Requirements: REQ-3, REQ-4_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Add vendor cards HTML to `index.html`. (1) After the closing `</section>` of `totalsSectionEl` (around line 845) and before `searchSectionEl`, insert a new section: `<section id="vendorCardsSectionEl">` containing a `.vendor-cards-wrapper` div. Inside the wrapper: a `<button class="vendor-cards-nav-btn vendor-cards-prev" id="vendorCardsPrev" aria-label="Previous vendor card">‹</button>`, a `<div class="vendor-cards" id="vendorCardsCarousel"></div>`, a `<button class="vendor-cards-nav-btn vendor-cards-next" id="vendorCardsNext" aria-label="Next vendor card">›</button>`, and below the wrapper a `<div class="vendor-cards-dots" id="vendorCardsDots"></div>`. Also add a `<div class="vendor-cards-hint" id="vendorCardsHint" style="display:none">Tag items with a vendor source to see vendor intelligence cards.</div>` inside the section but outside the wrapper. (2) In the script load order section (search for the existing `<script defer src="./js/retail-view-modal.js">` tag), add `<script defer src="./js/vendor-cards.js"></script>` on the next line after it. | Restrictions: Only modify `index.html`. Do not change any existing sections. Match the HTML pattern and indentation of the totals section. | Success: The new section is present in the DOM. `document.getElementById('vendorCardsSectionEl')` returns the section. `vendor-cards.js` loads after `retail-view-modal.js`. PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

- [ ] 4. Register element and wire layout system
  - Files: `js/init.js`, `js/settings.js`, `js/constants.js`, `sw.js`
  - Four small changes:
    1. `js/constants.js:1163` — Add `{ id: 'vendorCards', label: 'Vendor intelligence', enabled: true }` to `LAYOUT_SECTION_DEFAULTS` array (before the `table` entry, so default position is: spotPrices, totals, vendorCards, search, table)
    2. `js/init.js:~177` — Add `elements.vendorCardsSectionEl = safeGetElement('vendorCardsSectionEl');` in the element registration block
    3. `js/settings.js:1482` — Add `vendorCards: elements.vendorCardsSectionEl,` to the `sectionMap` object in `applyLayoutOrder()`
    4. `sw.js` — Add `'./js/vendor-cards.js',` to the `CORE_ASSETS` array (after `./js/retail-view-modal.js`)
  - Purpose: Wire the vendor cards section into the layout system so it appears in Settings drag-reorder and responds to visibility toggles.
  - _Leverage: `js/constants.js:1159-1164` for LAYOUT_SECTION_DEFAULTS; `js/init.js:113-396` for element registration block; `js/settings.js:1476-1493` for applyLayoutOrder; `sw.js:29-113` for CORE_ASSETS_
  - _Requirements: REQ-3, REQ-7_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Wire vendor cards into the layout system with 4 changes across 4 files. (1) In `js/constants.js` at the `LAYOUT_SECTION_DEFAULTS` array (line 1159), add a new entry `{ id: 'vendorCards', label: 'Vendor intelligence', enabled: true }` BEFORE the `table` entry (after `search`). This positions vendor cards between search and table by default. (2) In `js/init.js`, find the element registration block (around lines 113-396 where `elements.X = safeGetElement(...)` calls are), add `elements.vendorCardsSectionEl = safeGetElement('vendorCardsSectionEl');`. (3) In `js/settings.js` in the `applyLayoutOrder()` function (line 1476), add `vendorCards: elements.vendorCardsSectionEl,` to the `sectionMap` object at line 1482. (4) In `sw.js`, add `'./js/vendor-cards.js',` to the `CORE_ASSETS` array after the `./js/retail-view-modal.js` entry. | Restrictions: Only modify these 4 files with these specific changes. Do not rename existing entries. Do not change the order of existing LAYOUT_SECTION_DEFAULTS entries. In sw.js, do NOT manually update CACHE_NAME — the pre-commit hook handles that. | Success: `getLayoutSectionConfig()` returns an array containing a `vendorCards` entry. `applyLayoutOrder()` can show/hide the vendor cards section. `elements.vendorCardsSectionEl` is populated. `sw.js` caches `vendor-cards.js`. PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

- [ ] 5. Wire render triggers
  - Files: `js/inventory-table.js`, `js/retail.js`
  - Two changes:
    1. `js/inventory-table.js` — After the `updateSummary()` accumulator loop (around line 684, after the `metalTotals` iteration completes and DOM updates are done), add: `if (typeof window.renderVendorCards === 'function') window.renderVendorCards();`. This covers all 13 existing trigger sites automatically.
    2. `js/retail.js` — After `syncRetailPrices()` completes (find where `retailPrices` state is updated and retail cards are rendered), add: `if (typeof window.renderVendorCards === 'function') window.renderVendorCards();`. This ensures vendor card premiums update when market data refreshes.
  - Purpose: Ensure vendor cards stay current on all data changes without modifying 13 individual call sites.
  - _Leverage: `js/inventory-table.js:627-696` for updateSummary() end; `js/retail.js:458` for syncRetailPrices()_
  - _Requirements: REQ-7_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Wire the render triggers for vendor cards. (1) In `js/inventory-table.js`, find the end of the `updateSummary()` function — after the metalTotals DOM update loop (the `Object.values(METALS).forEach(...)` block that updates text content of total elements). At the end of updateSummary, BEFORE the closing brace, add: `if (typeof window.renderVendorCards === 'function') window.renderVendorCards();`. This is a guarded call — if vendor-cards.js hasn't loaded yet, it's a no-op. (2) In `js/retail.js`, find where `syncRetailPrices()` finishes its work — look for where it updates `retailPrices` state and renders retail market cards. At the end of that process, add the same guarded call: `if (typeof window.renderVendorCards === 'function') window.renderVendorCards();`. Read the function carefully to find the right insertion point — it may be in a `.then()` callback or after an await. | Restrictions: Only modify these 2 files. Only add the guarded `window.renderVendorCards` call — do not restructure the existing functions. The guard (`typeof ... === 'function'`) is essential for load-order safety. | Success: Opening the app shows vendor cards populated. Changing spot prices updates vendor card values. Syncing retail prices updates vendor card premiums. Adding/removing inventory items updates vendor cards. PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

- [ ] 6. Add startup call in `js/init.js`
  - File: `js/init.js`
  - Add an initial `renderVendorCards()` call near the existing `updateSummary()` call at init.js:610. Use the same guard pattern: `if (typeof window.renderVendorCards === 'function') window.renderVendorCards();`.
  - Purpose: Ensure vendor cards render on initial page load, not just on subsequent data changes.
  - _Leverage: `js/init.js:610` for existing updateSummary() startup call_
  - _Requirements: REQ-7_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Frontend developer | Task: Add startup render call for vendor cards. In `js/init.js`, find the existing `updateSummary()` call at approximately line 610 (the startup initialization). After it, add: `if (typeof window.renderVendorCards === 'function') window.renderVendorCards();`. This ensures vendor cards render on first page load. | Restrictions: Only modify `js/init.js`. Only add this one line. Do not move or restructure existing init code. | Success: On fresh page load, vendor cards appear immediately (if inventory has vendor-matched items). PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

---

## Standard Closing Tasks

- [ ] 7. Smoke test — verify no regressions
  - File: (no file changes — testing only)
  - Start local HTTP server, attempt Playwright via browserless first. If browserless hangs or fails, fall back to Browserbase (cloud). Verify all existing tests pass and no console errors were introduced by this spec.
  - Purpose: Catch regressions before PR merge; validate the new feature doesn't break existing behavior.
  - _Leverage: Playwright specs in `tests/*.spec.js`; browserless Docker at `devops/browserless/`; local server via `npx serve /Volumes/DATA/GitHub/StakTrakr -p 8765`; Browserbase fallback via `/bb-test` skill_
  - _Requirements: All_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA engineer | Task: Run the StakTrakr smoke test suite using the following two-tier approach. **Tier 1 — Playwright/browserless (preferred, free):** (1) Start local server: `npx serve /Volumes/DATA/GitHub/StakTrakr -p 8765`. (2) Start browserless: `cd devops/browserless && docker compose up -d`. (3) Run tests: `BROWSER_BACKEND=browserless TEST_URL=http://host.docker.internal:8765 npm test` from the repo root. (4) If tests produce output within 60 seconds, report pass/fail counts and any failing test names. **Tier 2 — Browserbase fallback (if Tier 1 hangs or errors):** If Tier 1 produces no output after 60 seconds or throws a connection error, STOP it immediately and switch to Tier 2: invoke the `/bb-test` skill via the Skill tool. Browserbase runs NL checks against the live preview URL and returns results. Note in the log that Tier 1 was skipped and why. **Both tiers:** (5) Manually verify vendor cards feature works end-to-end: cards appear for vendor-matched items, carousel scrolls, click filters inventory, empty state shows for no matches, Settings toggle works. (6) Check browser console for any new errors or warnings. (7) If any failures are found, document them clearly and file a follow-up issue — do NOT attempt fixes here. | Restrictions: Do not modify any source files — this is a verification-only task. Browserbase is paid — only use it as a fallback, not as first choice. | Success: Tests complete (either tier) with results reported. No new console errors. Vendor cards feature manually verified working. PREREQUISITE: This is a test-only task — no worktree changes needed. Mark task as [-] in tasks.md before starting. BLOCKING: After verification, you MUST call the log-implementation tool with the test results (tier used, pass/fail counts) before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

- [ ] 8. Update DocVault pages affected by this spec
  - File: (DocVault pages only — no production code changes)
  - Run `/vault-update` to detect and rewrite any DocVault pages whose YAML frontmatter `sourceFiles` reference files changed by this spec. Verify each updated page is accurate against the new implementation.
  - Purpose: Keep documentation current — stale DocVault pages are a recurring source of confusion.
  - _Leverage: `/vault-update` skill; DocVault at `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/`_
  - _Requirements: All_
  - _Prompt: Implement the task for spec STAK-435-vendor-intelligence-cards, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical writer | Task: Update all DocVault pages affected by this spec. (1) Run the /vault-update skill — it detects which pages have `sourceFiles` frontmatter entries matching the files changed in this spec (js/vendor-cards.js, js/constants.js, js/init.js, js/settings.js, js/inventory-table.js, js/retail.js, index.html, sw.js, css/styles.css), then rewrites those pages from the current source code. (2) Review each updated page for accuracy: do the descriptions match the actual implementation? Are function signatures, file paths, and behavior descriptions correct? (3) If any page needs manual correction, edit it directly. (4) List all updated pages and a one-line summary of what changed in each. | Restrictions: Only touch files in DocVault. Do not modify any JS, CSS, or HTML production files. | Success: All DocVault pages whose sourceFiles reference changed files have been updated and verified accurate. No stale descriptions remain. BLOCKING: After updates are complete, you MUST call the log-implementation tool listing all updated pages before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._
