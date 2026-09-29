---
sketch: STRK-85-ticker-goldback-premium
phase: approach
created: '2026-05-22'
---
# STRK-85 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

All changes land in two existing files: `js/market-data.js` (logic) and `css/styles.css` (tier colors). No new modules, no build changes, no exports to `window`.

A single module-local helper function `_calcMarketPremium(price, metalCode, weightOz)` is added between `_getSpotPrice` (~line 38) and `renderBestPriceTicker` (~line 244) in `market-data.js`. This helper encapsulates the full premium pipeline: benchmark selection (spot price for precious metals, `_goldbackG1Rate` for goldback), percentage calculation, and tier classification. It always returns an object `{ value: number|null, tier: "low"|"mid"|"high"|null, text: string|null }` — when no benchmark is available (failed G1 fetch, missing spot), the fields are `null` but the shape is stable. This uniform return contract eliminates per-call-site null-vs-object branching. Each render site calls the helper and handles its own DOM construction from the returned object; the helper never touches the DOM.

The three in-scope render sites are updated to call `_calcMarketPremium` instead of inline math:
1. **Ticker** (`renderBestPriceTicker`, line ~293) — currently has no Goldback premium at all (`_getSpotPrice("goldback")` returns `null`, so the spot guard never enters for Goldback items). Replace the inline `spot * weightOz` calculation with `_calcMarketPremium(bestPrice, metalLower, weightOz)`. Destructure the result: store `value` into `items[].premium` (preserving the raw number shape that `_buildTickerSignature` depends on via `Number.isFinite(item.premium)` at line 177) and store `tier` separately (e.g. as `items[].premiumTier`). Apply the `tier` as a CSS class on the `.premium` span at DOM construction time.
2. **Detail modal vendor table** (`openMarketDetailModal`, line ~772) — currently spot-only with no Goldback branch. Replace the inline calculation and binary `low`/`high` with `_calcMarketPremium(entry.price, metalCode, weightOz)`. The existing `else` branch ("—") stays for the `value === null` case.
3. **Market Matrix** (`renderVendorPrices` inner loop, line ~1138) — already has the G1 fallback but uses the binary 10% threshold. Replace the inline spot + G1 branches and binary class with `_calcMarketPremium(vInfo.price, isoCode, weightOz)`.

CSS changes add a `.mid` tier class to `.vp-premium` and add tier classes to the ticker's `.premium` span. For Matrix and detail modal, tier classes map to existing design tokens (`--success`, `--warning`, `--danger`). For the ticker, the `mid` tier uses a custom darker amber (e.g. `oklch(0.55 0.15 60)`) instead of `--warning` to meet WCAG AA contrast requirements at `font-size-xs` against light/sepia `--bg-secondary` backgrounds. Ticker `.premium` spans also get reduced visual weight (e.g. `opacity: 0.85` or `font-weight: 400`) so tier colors don't compete with the green price text (`color: var(--success)`). All tier rules are a single unscoped base rule set using semantic tokens — no per-theme duplication. Visual verification across all four themes (`light`, `dark`, `slate`, `sepia`) is required.

Test coverage extends the existing market-sorting spec and adds a new ticker/detail-modal spec using the shared Goldback fixtures, asserting premium text content and tier CSS classes through DOM queries.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Single `_calcMarketPremium` helper encapsulating benchmark selection + math + tier | Eliminates the root cause (each surface had its own benchmark logic — ticker/detail had none for Goldback). One function owns "which benchmark for which metal." | Adds a layer of indirection; three call sites must destructure the return. Worth it because the alternative is three independent Goldback branches that drift. |
| D-2 | Helper returns `{ value, tier, text }` — DOM stays per-surface | Ticker uses `<span class="premium low">`, Matrix/detail use `<span class="vp-premium low">`. Unifying DOM would require reworking ticker markup. The helper's contract stops at data; rendering stays local. Ticker must destructure `value` into `items[].premium` (raw number) to preserve `_buildTickerSignature`'s `Number.isFinite(item.premium)` check; `tier` is stored separately and applied at DOM construction time only. | Two slightly different CSS class hierarchies (`.premium.low` vs `.vp-premium.low`) remain — but they already exist and map to the same color tokens. |
| D-3 | Tier thresholds: `< 2%` → `low` (green), `2–5%` → `mid` (yellow), `≥ 5%` → `high` (red) | Matches AC-3's accepted tiers. Reuses existing class names `low`/`mid`/`high` rather than inventing `tier-green`/`tier-yellow`/`tier-red`. Verified: zero existing test assertions on `.vp-premium.low` class, so the semantic change from "< 10% → yellow" to "< 2% → green" will not break any Playwright tests. | Semantic shift: `low` changes meaning. Acceptable because (a) there is no public API contract on these class names, (b) the old threshold was not meaningful to users, and (c) the color change makes the low tier *more* positive, not less. |
| D-4 | Goldback benchmark detection uses `metalCode` string, not a predicate function | `_calcMarketPremium` checks `metalCode === "goldback"` to decide G1-rate path. This mirrors the Matrix's existing `isoCode` pattern and avoids importing `isGoldbackLookup` from `spotLookup.js` (which tests unit/item context, not metal identity). | Hardcoded string — but "goldback" as a metal code is already hardcoded in `allScopeOrder`, `allMetals`, and `_ISO_TO_METAL` exclusion. No new coupling. |
| D-5 | Failed G1 fetch → blank premium for `refreshMarketData()` and `currencychange` paths; Market Refresh button retries | `initMarketData` awaits the G1 fetch; on failure `_goldbackG1Rate` stays null and `_calcMarketPremium` returns `{ value: null, tier: null, text: null }` for Goldback rows. `refreshMarketData()` (line 1424-1427) only re-renders and `currencychange` (line 1430-1439) only re-renders/reopens the modal — neither re-fetches G1. However, the visible Market Refresh button (line 1229-1245) sets `_marketDataInitialized = false` and calls `initMarketData()`, which will retry the G1 fetch if `_goldbackG1Rate` is still null (line 1401). Note: "blank premium" for ticker and detail modal is *new visibility* of G1-based premiums, not regression — currently these surfaces have NO Goldback premium at all. | Goldback premium stays blank in ticker/detail after a transient G1 failure until the user clicks the Market Refresh button or reloads the page. Acceptable because: (a) requirements make cross-module fallback out of scope, (b) the G1 endpoint has a 25h SW cache floor that cushions transient failures, (c) adding retry logic to `refreshMarketData` is scope creep for a premium-display fix. |
| D-6 | Ticker `.premium` span gets tier color classes with reduced visual weight | Currently muted text for all premiums. After this change, ticker premiums get the same `low`/`mid`/`high` color coding as Matrix/detail badges, but with reduced visual weight (opacity or font-weight) so they maintain secondary emphasis relative to the green price text. The `mid` tier uses a custom darker amber instead of `--warning` for contrast accessibility at `font-size-xs`. | Visual change to existing ticker — but the muted styling was an absence of design, not an intentional choice. Colored premiums are strictly more informative; reduced weight prevents "color soup." |
| D-7 | Test via DOM assertions, not `window` export | `_calcMarketPremium` stays module-local. Tests assert class names (`.premium.low`, `.vp-premium.mid`) and text content (`+20.0%`) on rendered DOM elements. | Cannot unit-test the helper in isolation from Playwright — but the helper is simple arithmetic with a branch; DOM tests cover the integration end-to-end. Exposing via `window` would add test-only coupling to production code. |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- `tests/playwright/market-premium-tiers.spec.js` — Playwright spec covering Goldback premium in ticker + detail modal, and tiered color classes across all three surfaces. Uses `installStakTrakrNetworkMocks(page, options)` with custom Goldback price overrides for non-zero premium spread (default fixtures set G1 = retail price = 0% premium).

### Modified

- `js/market-data.js` — Add `_calcMarketPremium` helper (~15 lines) between `_getSpotPrice` and `renderBestPriceTicker`; refactor ticker premium calc (line ~293–298) to call helper and destructure into `premium`/`premiumTier`; refactor detail modal premium calc (line ~772–779) to call helper and add G1 fallback; refactor Matrix premium calc (line ~1138–1151) to call helper; apply tier class to ticker `.premium` span (line ~387).
- `css/styles.css` — Add `.vp-premium.mid` rule mapping to `--warning`; change `.vp-premium.low` from `--warning` to `--success`; add `.ticker-item .premium.low`, `.premium.mid`, `.premium.high` rules (`.premium.mid` uses a custom darker amber for contrast at `font-size-xs`, not `--warning`); add visual-weight reduction to ticker `.premium` spans. All as a single unscoped base rule set — no per-theme duplication. Visual verification across all four themes (`light`, `dark`, `slate`, `sepia`).
- `tests/playwright/market-sorting.spec.js` — Update existing Matrix Goldback assertion (line ~473) if tier class changes from `high` to match new thresholds (20% premium → `high` under new scheme, so no text change needed; may need class assertion update).

### Deleted

- None.

## Data / Schema Changes

None — no schema, migration, or persisted-data changes.

## Tradeoffs Surfaced for Review

- **D-3 class-name reuse vs new names.** Reusing `low`/`mid`/`high` with changed semantics (green/yellow/red instead of yellow/red) is the simpler path but means any external CSS override targeting `.vp-premium.low` for "yellow" will silently become green. Since StakTrakr has no documented external CSS API and no third-party themes, this is acceptable — but worth noting.
- **D-5 no-retry on G1 failure (scoped).** If users report persistent blank Goldback premiums after transient network issues, a follow-up issue could add G1 re-fetch to `refreshMarketData()`. The Market Refresh button already retries. This is intentionally deferred to keep the sketch focused on premium display, not data fetching reliability.
- **D-6 ticker color change.** Ticker premiums going from muted gray to green/yellow/red is a visible UX change. This is a deliberate improvement per the issue's intent, but if the user prefers muted ticker premiums, D-6 can be reverted to keep ticker premiums styled with `--text-muted` regardless of tier. Visual weight is reduced to avoid competing with the price.

## Out of Scope (follow-up issues)

- **G1 rate retry on refresh** — if `_goldbackG1Rate` is null after init, `refreshMarketData()` could re-attempt the fetch. Deferred per D-5; file as a separate STRK issue if users report persistent blank premiums.
- **Stale architecture.md claim** — discovery identified that `Foundation/architecture.md` says `market-data.js` only reads cached data, which is stale (it makes direct API calls). Should be corrected via `/vault-update` but is not part of this implementation.
- **Stale API Reference Goldback wording** — `Foundation/Deep Dives/API Reference.md` still labels per-state Goldback retail endpoints as "planned/future" when they are live. Same treatment: `/vault-update`, separate issue.
- **CSS tier rule visual verification.** The tier color rules are a single unscoped base rule set using semantic tokens (`--success`, `--warning`/custom amber, `--danger`). Ticker `.premium.mid` uses a custom darker amber for contrast accessibility. Implementation must verify visually across all four themes (`light`, `dark`, `slate`, `sepia`) that all tier colors are readable.
- **Existing test breakage from threshold change.** The market-sorting spec asserts `+20.0%` text for Goldback Matrix cells. Under the new thresholds, 20% maps to `high` (same as before at 10% threshold), so text doesn't change. Verified: no tests assert `.vp-premium.low` CSS class, so the threshold semantics change is safe. Mitigation: audit existing premium class assertions in the test task.

---

**Verified**

- Confirmed the three in-scope premium render sites in `js/market-data.js`: ticker spot-only premium at `js/market-data.js:292-298` and span render at `js/market-data.js:386-391`; detail modal spot-only premium with binary low/high class at `js/market-data.js:716-779`; Matrix premium with the existing `_goldbackG1Rate` fallback and binary low/high class at `js/market-data.js:1051-1151`.
- Confirmed Goldback benchmark fetch and refresh behavior: `_goldbackG1Rate` is module-local at `js/market-data.js:13`, populated by `initMarketData()` before initial render at `js/market-data.js:1400-1419`, not fetched by `refreshMarketData()` at `js/market-data.js:1424-1427`, and not fetched by the `currencychange` handler at `js/market-data.js:1430-1439`. Market Refresh button (line 1229-1245) retries via `initMarketData()` when `_goldbackG1Rate` is still null.
- Confirmed CSS/test anchors: ticker `.premium` is muted only (`css/styles.css:14708-14711`), `.vp-premium.low/high` are the only badge tier classes today (`css/styles.css:14841-14852`) as unscoped base rules using semantic tokens, Playwright network mocks support Goldback override data (`tests/playwright/helpers/mocks/routes.js:31-46`, `tests/playwright/helpers/mocks/routes.js:128-180`), and the existing market-sorting fixture already asserts `+20.0%` for a Goldback Matrix cell (`tests/playwright/market-sorting.spec.js:460-474`).
- Confirmed four active themes: `light` (:root), `dark` (`css/styles.css:211`), `slate` (`css/styles.css:340`), `sepia` (`css/styles.css:461`). No `contrast` theme exists.
- Confirmed zero existing test assertions on `.vp-premium.low` CSS class — threshold semantic change is safe.
- Confirmed `_buildTickerSignature` reads `item.premium` as raw number (`Number.isFinite(item.premium)` at line 177) — ticker `items[]` shape must not change.

**Unverified assumptions**

- The implementation will keep `_calcMarketPremium` module-local and verify through DOM assertions rather than exporting a test-only helper.
- All relevant market premium displays are limited to ticker, Matrix, and retail detail vendor table; inventory/view-modal purchase premium remains intentionally excluded.
- Users accept blank Goldback premium after failed G1 fetch for `refreshMarketData()` and `currencychange` paths, with the Market Refresh button as the manual retry mechanism.
- Token colors `--success` and `--danger` plus the custom darker amber for `mid` provide acceptable contrast for small ticker text across `light`, `dark`, `slate`, and `sepia`.
- The new test can drive the detail modal through an existing market-row click/open path without adding production-only selectors or exporting internals.

## Review Archive — approach (2026-05-22)

_Reconciled by /sketch reconcile on 2026-05-22. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- Confirmed the three in-scope premium render sites in `js/market-data.js`: ticker spot-only premium at `js/market-data.js:292-298` and span render at `js/market-data.js:386-391`; detail modal spot-only premium with binary low/high class at `js/market-data.js:716-779`; Matrix premium with the existing `_goldbackG1Rate` fallback and binary low/high class at `js/market-data.js:1051-1151`.
- Confirmed Goldback benchmark fetch and refresh behavior: `_goldbackG1Rate` is module-local at `js/market-data.js:13`, populated by `initMarketData()` before initial render at `js/market-data.js:1400-1419`, not fetched by `refreshMarketData()` at `js/market-data.js:1424-1427`, and not fetched by the `currencychange` handler at `js/market-data.js:1430-1439`.
- Confirmed CSS/test anchors: ticker `.premium` is muted only (`css/styles.css:14708-14711`), `.vp-premium.low/high` are the only badge tier classes today (`css/styles.css:14841-14852`), Playwright network mocks support Goldback override data (`tests/playwright/helpers/mocks/routes.js:31-46`, `tests/playwright/helpers/mocks/routes.js:128-180`), and the existing market-sorting fixture already asserts `+20.0%` for a Goldback Matrix cell (`tests/playwright/market-sorting.spec.js:460-474`).

**Top concerns**

1. The CSS risk note names the wrong theme set and implies per-theme rule duplication; live StakTrakr has `light`, `dark`, `slate`, and `sepia`, while the existing tier classes are base token-driven rules.
2. D-5's "no retry on refresh" wording is too broad because the exported `refreshMarketData()` does not retry, but the visible Market refresh button can re-enter `initMarketData()` and retry `_goldbackG1Rate` if it is still null.
3. The new Playwright spec needs explicit non-zero Goldback fixture overrides; the shared default fixtures make Goldback retail price equal to the G1 rate, so default DOM assertions would not exercise `mid` or `high` tiers.

**Unverified assumptions**

- The implementation will keep `_calcMarketPremium` module-local and verify through DOM assertions rather than exporting a test-only helper.
- All relevant market premium displays are limited to ticker, Matrix, and retail detail vendor table; inventory/view-modal purchase premium remains intentionally excluded.
- Existing tests do not assert `.vp-premium.low` semantics for 2-10% premiums; tasks should grep before changing the threshold meaning.
- Users accept blank Goldback premium after failed G1 fetch for `refreshMarketData()` and `currencychange` paths, with no same-source retry except the visible Market refresh flow.
- Token colors `--success`, `--warning`, and `--danger` provide acceptable contrast for small ticker text across `light`, `dark`, `slate`, and `sepia`.
- The new test can drive the detail modal through an existing market-row click/open path without adding production-only selectors or exporting internals.

**Inline marks:**

- (Line 14, Architecture) Verified the helper placement and boundary are compatible with the live module: `_getSpotPrice` is at `js/market-data.js:26-38`, `_goldbackG1Rate` is module-local at `js/market-data.js:13`, and all three premium surfaces live in this same file (`renderBestPriceTicker` at `js/market-data.js:244-391`, `openMarketDetailModal` at `js/market-data.js:476-784`, and the Matrix loop at `js/market-data.js:1047-1151`). One contract nit for tasks: either return `null` for unavailable premiums or always return an object with nullable fields, but avoid implementing both shapes unless the call sites explicitly normalize it.
- (D-3) Verified the existing class contract is local CSS only: `.vp-premium.low` currently maps to `--warning`, `.vp-premium.high` maps to `--danger`, and no `.vp-premium.mid` exists (`css/styles.css:14841-14852`); ticker premium spans are just `.premium` with muted text (`css/styles.css:14708-14711`). The approach is safe on the "no public API" claim, but tasks should include a grep/audit for existing `.vp-premium.low` test assertions before changing semantics.
- (D-5) The failure behavior is mostly verified, but "no retry on refresh" needs wording precision. The exported `refreshMarketData()` only re-renders (`js/market-data.js:1424-1427`) and `currencychange` only re-renders/reopens the modal (`js/market-data.js:1430-1439`), so they will not refill `_goldbackG1Rate`. The visible Market "Refresh" button, however, sets `_marketDataInitialized = false` and calls `initMarketData()` after `startRetailBackgroundSync()` (`js/market-data.js:1229-1245`), so it can retry the same G1 fetch when `_goldbackG1Rate` is still null (`js/market-data.js:1400-1416`). Tasks should state which refresh path is expected to remain blank.
- (Out of Scope, CSS) This risk note drifts from the live stylesheet. StakTrakr exposes `light`, `dark`, `slate`, and `sepia` themes in the settings UI (`index.html:3896-3935`) and CSS (`css/styles.css:211`, `css/styles.css:340`, `css/styles.css:461`); there is no `contrast` theme. Also, the current `.vp-premium` tier rules are unscoped base rules that consume semantic tokens (`css/styles.css:14841-14852`), so the lower-risk implementation is likely a single base rule set using `--success`/`--warning`/`--danger`, plus verification across all four themes, not duplicated "theme block" edits.
- (New file, File Map) Good new-spec target. Verified the shared mock fixture defaults Goldback G1 to the same price as the default Goldback retail row (`tests/playwright/helpers/mocks/fixtures.js:80-87`, `tests/playwright/helpers/mocks/fixtures.js:113-115`), so custom overrides really are required to exercise non-zero tier classes. The route installer supports those overrides via `installStakTrakrNetworkMocks(page, options)` (`tests/playwright/helpers/mocks/routes.js:31-46`, `tests/playwright/helpers/mocks/routes.js:128-180`), but the default `extended-test.js` fixture installs no per-test options (`tests/playwright/helpers/mocks/extended-test.js:16-20`); tasks should spell out whether the new spec registers override routes or calls the installer directly.

### Gemini

**Verified**

- Confirmed that `_getSpotPrice(metalCode)` handles both ISO codes (like `"xau"`) and English names (like `"gold"`), meaning the unified helper can safely accept either shape as `metalCode`.
- Confirmed that ticker items rely on `Number.isFinite(item.premium)` inside the signature checking for rendering cache, meaning the helper's raw numeric output must be correctly bound to `item.premium`.
- Checked semantic CSS variables `--success`, `--warning`, and `--danger` in `css/styles.css` across all four active themes (`light`, `dark`, `slate`, and `sepia`).

**Top concerns**

1. **Ticker visual soup (UX):** Ticker prices are already colored with `color: var(--success)` (green). Adjacent colored premium percentages (`low`/`mid`/`high` in green/yellow/red) will look busy and run the risk of clashing. Ticker premiums should be styled with smaller font-size, lighter font weight, or a slight opacity so they don't compete with the primary price indicator.
2. **Contrast of warning tokens:** In some light/sepia backgrounds, warning colors (yellow) can have poor contrast. Since we are introducing a new yellow `mid` tier for premiums, we should visually verify that `--warning` text has sufficient contrast.
3. **Goldback premium calculations:** Because Goldbacks calculate premium relative to the G1 rate rather than spot gold, the premium values represent retail markups and will be low enough to distribute properly across the 2% and 5% thresholds.

**Unverified assumptions**

- The custom Playwright overrides will be cleanly implemented without duplicating or breaking existing `extended-test.js` or route mocks.
- The visual hierarchy of the ticker will remain clean once colors are applied.

**Inline marks:**

- (Line 14, Architecture) Agree with CODEX's return contract normalization. Returning a single shape (e.g., `{ value: number|null, tier: string|null, text: string|null }`) or `null` when no benchmark exists is preferred. Additionally, we must verify that the ticker item's signature building (which relies on `Number.isFinite(item.premium)`) gets the raw numeric value from this helper correctly.
- (D-6) In StakTrakr, ticker prices are styled with `color: var(--success)` (green). Styling ticker premiums with color classes (green/yellow/red) next to a green price could create visual noise ("color soup"). The design should ensure the premium has secondary visual weight (e.g., smaller font-size, lighter font weight, or slightly lower opacity) so as not to compete with the primary price indicator.
- (Out of Scope, CSS) Agree with CODEX that theme-independent base rules using semantic tokens (`--success`, `--warning`, `--danger`) is the cleanest, lowest-risk path. We must visually inspect the warning color (`--warning`) in both `light` and `sepia` themes to confirm it is readable on the ticker capsule's background (`--bg-secondary`) and the matrix cells.

### DeepSeek

**Verified**

- Confirmed all four active themes: `light` (:root, `css/styles.css:1-206`), `dark` (`css/styles.css:211`), `slate` (`css/styles.css:340`), `sepia` (`css/styles.css:461`); no `contrast` theme exists (`grep` for `contrast` in `css/styles.css` returns only WCAG commentary).
- Confirmed `_getSpotPrice("goldback")` returns `null`: `_ISO_TO_METAL` has no `goldback` key (`js/market-data.js:8`), and no `spotPriceDisplayGoldback` DOM element exists, so the fallback chain exhausts and returns `null` at line 37.
- Confirmed the ticker currently has NO Goldback premium rendering: `renderBestPriceTicker` checks `if (spot && spot > 0 && weightOz > 0)` at `js/market-data.js:295`, and `spot` is always `null` for `metalLower === "goldback"`.
- Confirmed the ticker signature hash reads `item.premium` as a raw number: `_buildTickerSignature` at `js/market-data.js:177` calls `Number.isFinite(item.premium)`, so changing `items[].premium` to an object breaks the ticker's render-skip optimization.
- Confirmed the detail modal premium calculation at `js/market-data.js:772-779` has no Goldback branch: it only uses `spotPrice` from `_getSpotPrice(metalCode)` (line 716).
- Confirmed the Matrix already has G1 fallback at `js/market-data.js:1142-1144` using binary 10% threshold, confirming the pattern D-4 follows is established.
- Confirmed default Goldback fixture `g1_usd: 4.25` equals the default retail price `4.25` (`tests/playwright/helpers/mocks/fixtures.js:84-86, 113-115`), yielding 0% premium — non-zero tiers require custom overrides.
- Confirmed zero existing test assertions on `.vp-premium.low` CSS class (`grep` in `tests/` returns no matches), so the threshold semantics change from `<10%→yellow` to `<2%→green` will not break any Playwright tests.
- Confirmed `--warning` contrast risk: light theme `--warning: oklch(0.666 0.157 58.3)` (L=0.666) against `--bg-secondary: oklch(0.96 0.008 253.9)` (L=0.96) produces ~1.4:1 contrast at `font-size: var(--font-size-xs)`, well below WCAG AA (4.5:1 for normal text).
- Confirmed the Market Refresh button (line 1229-1245) DOES retry `_goldbackG1Rate` by setting `_marketDataInitialized = false` and calling `initMarketData()`, which contains the same G1 fetch guard `if (!_goldbackG1Rate)` at line 1401.

**Top concerns**

1. **Return contract ambiguity (`null` vs nullable object):** The approach says the helper "returns an object ... — or null." This creates three code paths per call site. Always-return-object `{ value: null, tier: null, text: null }` is simpler, avoids `_calcMarketPremium(...) || fallbackObject` boilerplate at every call site, and integrates cleanly with destructuring. The ticker signature hash (`Number.isFinite(item.premium)`) further reinforces this: if `items[].premium` stores the result object, `_buildTickerSignature` breaks. Recommend either (a) destructure `value` into `premium` for item storage while keeping a separate `premiumTier` field, or (b) call `_calcMarketPremium` from `buildTickerItem` (line 349) at DOM construction time, keeping `items[]` shape unchanged. Option (b) is lower-risk.

2. **Ticker `--warning` (yellow) contrast accessibility:** Light and sepia themes pair `--warning` (L=0.666) on light background (L=0.96/0.892), yielding sub-WCAG-AA contrast for the ticker's `font-size: var(--font-size-xs)` text. The `mid` tier (yellow) will be illegible, not just "visually noisy." The `high` tier (red, `--danger`) has better contrast but still at risk at small sizes. This is more than a UX preference issue — users will literally not be able to read yellow premium values in light/sepia themes. Unless the tasks include a specific mitigation (darker mid color, font-weight bump, minimum font-size guard, or shadow), this is a functional accessibility regression.

3. **File Map theme count and "theme block" duplication:** The File Map on line 55 and Out of Scope on line 77 both reference "three theme blocks (light/dark/contrast)" and imply per-theme rule duplication. The correct count is four themes (`light`, `dark`, `slate`, `sepia`), and the existing `.vp-premium` tier rules are unscoped base rules using semantic tokens. Tasks should implement a single base rule set, then verify visually across all four themes, not duplicate per-theme selectors. If per-theme duplication is coded, it creates maintenance debt and risk of future theme-add drift.

**Unverified assumptions**

- `_calcMarketPremium` placement "below `_getSpotPrice`" (line 14) must still be ABOVE `renderBestPriceTicker` (line 244) and `renderVendorPrices` — the approach doesn't state this explicitly, and in a 1400+ line file, placement order matters.
- The helper's `metalCode` parameter accepts both `"goldback"` (string) and `"xau"` (ISO) — `_getSpotPrice` handles this via `_ISO_TO_METAL[metalCode] || metalCode` (line 27), which is fine, but the approach doesn't state whether `_calcMarketPremium` will reuse that normalization or do its own.
- Tick and detail modal `weightOz` values: ticker uses `meta.weight || 0` (line 292), detail modal uses `(detail && detail.weight_oz) || coinMeta.weight || 0` (line 562), Matrix uses `detail.weight_oz || meta.weight || 0` (line 1052) — three different weight sources. The helper receives `weightOz` as a parameter, so these differences are decoupled; confirmed safe.
- The `low` tier CSS color change from `--warning` (yellow) to `--success` (green) is semantically backwards for negative premiums (below-spot). While rare, a negative premium would show green when it should show... something else. The approach doesn't address the edge case of `value < 0`.
- The detail modal `weightOz` variable at line 562 is a closure variable from `openMarketDetailModal`'s scope, not re-computed per vendor entry. This means all vendors in the same modal use the same weight — correct for per-sku modals, but the tasks should verify this is the weight passed to the helper.
- The new Playwright spec `market-premium-tiers.spec.js` will need to install custom overrides that don't use `extended-test.js`'s default `installStakTrakrNetworkMocks(page, {})` call (which passes no options). The spec must either bypass `extended-test.js` entirely or call `installStakTrakrNetworkMocks` with custom Goldback/retail overrides AFTER the default install — route order matters because later-registered routes overwrite earlier ones in Playwright's route API.

### Resolution Summary
- Accepted: 7
- Rejected: 1 (negative premium edge case — below-spot prices are extremely rare in retail and never for Goldback; scope creep)
- Resolved with your input: 4 (darker mid color for ticker contrast, visual-weight reduction for ticker premiums, explicit helper placement range, test override strategy note in File Map)
