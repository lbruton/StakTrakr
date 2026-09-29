---
sketch: "STRK-88-fp-price-artifact"
phase: approach
created: 2026-05-19
---

# STRK-88 — Approach

## High-Level Architecture

The fix is a boundary-rounding strategy with an exact-value escape hatch. Internally, `item.price` continues to hold a full-precision JavaScript `number` — no schema change, no truncation at the storage layer. What changes is the treatment of values crossing the **user-visible boundary** (form input, table cells, CSV/PDF exports): each population point passes through a currency-aware rounding helper. To make round-trips through the lot/each toggle lossless, the form caches the user's exact LOT total in a `data-exact-lot-price` attribute on `#itemPrice`. The dataset cache is intentionally chosen over module-scope state because it is form-local, DOM-inspectable during Playwright/debugging, and readable by handlers that already receive or query the input element. Module-level state is technically possible in `js/events.js`, but would be less transparent and would still need equivalent lifecycle cleanup.

The toggle handler, the save handler, the edit-load (LOT and EACH paths), and the duplicate handler are the four consumers. The toggle handler maintains the dataset cache as the user flips modes; the save handler prefers the cache (if present and consistent with the rounded display value) over re-deriving per-unit price from the rounded text; the edit-load and duplicate handlers round display values and rehydrate the dataset cache when a LOT-mode item is loaded. Cache cleanup is explicit: reset/close/cancel/post-save boundaries delete `data-exact-lot-price`, and quantity changes while in LOT mode clear the cache so a changed quantity cannot silently reuse a stale LOT total.

Two small utility additions in `js/utils.js` underpin the change: `getCurrencyFractionDigits(currency)` queries `Intl.NumberFormat.resolvedOptions()` for the active currency's maximum fraction digits, and `roundToCurrencyPrecision(value, currency)` returns a `number` (not a string) rounded to those digits. They must follow the existing global-script export pattern by being available through both `window.*` and `module.exports`. Everything downstream — the input field populate path, the Numista CSV exporter, the existing `formatCurrency` callers — uses these primitives instead of hardcoded `toFixed(2)` or `toFixed(6)`.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Store the exact LOT total in a `data-exact-lot-price` attribute on `#itemPrice`, set by the toggle handler and the edit/duplicate loaders | Form-scoped lifetime with explicit cleanup, DOM-inspectable from Playwright, readable by any handler that already touches the input, no hidden module state for test/debug flows | DOM coupling; if another script clears the attribute mid-form, the round-trip degrades to "rounded display × qty" — mitigation is to re-establish the cache on every toggle/load event and clear it intentionally on reset/close/quantity-change boundaries |
| D-2 | Add `getCurrencyFractionDigits(currency)` and `roundToCurrencyPrecision(value, currency)` helpers in `js/utils.js`, exported alongside `formatCurrency` / `getCurrencySymbol` via both `window.*` and `module.exports` | Single source of truth for currency precision; numeric (not string) return value keeps math composable; uses `Intl.NumberFormat.resolvedOptions()` already familiar in this file | Adds 2 small functions to a busy file; alternative was inlining at each boundary, which would re-spread the bug surface |
| D-3 | Remove `.toFixed(6)` from the lot/each toggle conversion (`events.js:83-87`), the save-time division (`events.js:1443-1445`), and the edit-load LOT multiply (`inventory.js:1732-1740`). Replace with full-precision arithmetic, then round only at the **display** boundary via D-2's helper | `toFixed(6)` actively amplifies the IEEE 754 artifact (truncates `56.6666̄` to `56.666667`, which then multiplies back to `1700.00001`). Removing it bounds the drift to numeric epsilon (~`1700.0000000000002`), which display rounding handles cleanly | Saved per-unit prices for repeating-decimal LOT entries will change in localStorage on the next edit (`56.666667` → `56.666666666666664`); negligible numerically, but Playwright tests inspecting raw stored values must be updated |
| D-4 | Save handler prefers the `data-exact-lot-price` cache over the displayed input text when mode is LOT and the cached value rounds to the displayed value; `#itemQty` input while LOT mode is active clears the cache | Lets the user enter $1700, see $1700, and have $1700 (exactly) be the basis of the divide-by-qty operation, while preventing a stale cache from surviving user edits to the visible price or quantity | One more conditional in the save path plus a quantity listener; the consistency guard and invalidation are required to avoid silently writing stale hidden state |
| D-5 | Round duplicate-mode `#itemPrice` populate via D-2's helper and preserve LOT pricing mode for LOT-mode source items by using `restorePurchasePriceToggle(sourceItem.pricingType, sourceItem.qty)` instead of unconditional `resetPurchasePriceToggle()` | Discovery confirmed `duplicateItem` is a user-visible drift surface; preserving LOT mode makes duplicate behavior match edit-load behavior and lets the exact-total cache be rehydrated instead of dead code | Changes duplicate modal behavior for LOT-mode items from "always EACH" to "preserve source mode"; this should be covered by Playwright so the UX contract is deliberate |
| D-6 | Normalize `js/inventory-import.js:1021` (Numista CSV) by converting internal USD purchase price to the active display currency via `getExchangeRate(activeCurrency)`, then applying `roundToCurrencyPrecision(value, activeCurrency).toFixed(getCurrencyFractionDigits(activeCurrency))` | The header already says `Buying price (${displayCurrency})`, and `importNumistaCsv` converts from header currency back to USD; exporting raw USD under a non-USD header corrupts round-trips | Numista CSV output changes for non-USD users, but the new behavior matches the header, importer, and `formatCurrency` semantics |
| D-7 | JSON / encrypted backup / ZIP backup paths (`js/inventory.js:1969-1980`, `js/inventory-backup.js:22-36`) are **untouched** — they continue to write raw `item.price` | Backups are restore points, not display surfaces; rounding them would change data on round-trip and violate AC-1's "no data loss" intent for non-repeating decimals | None — confirmed by requirements Non-Goals and discovery constraint |

## File Map

### New
- _none — the work fits cleanly into existing files. Tests extend `tests/playwright/inventory/lot-each-purchase-price.spec.js` rather than spawning a new spec; the tasks phase will confirm._

### Modified
- `js/utils.js` — add `getCurrencyFractionDigits(currency)` and `roundToCurrencyPrecision(value, currency)` near `formatCurrency` / `getCurrencySymbol` (lines ~599–675 region); expose both helpers through `window.*` and `module.exports`.
- `js/events.js` — `createLotEachToggle` (~L83-87): drop `toFixed(6)`, round display via D-2 helper, set/update `data-exact-lot-price` dataset on `#itemPrice` for LOT mode; `parseItemFormFields` (~L1443-1445): drop `toFixed(6)` on the per-unit save division, prefer dataset cache when in LOT mode and cache rounds to displayed text (D-4 guard); `resetPurchasePriceToggle`, modal close/cancel, add/reset, and post-save boundaries: delete `data-exact-lot-price`; `#itemQty` input while LOT mode is active: clear `data-exact-lot-price`.
- `js/inventory.js` — `editItem` EACH-mode populate (~L1492-1502): round `displayPrice` via helper before assigning to `#itemPrice.value`; `editItem` LOT-mode restore (~L1732-1740): drop `toFixed(6)` on the `perUnit * item.qty` multiply, round result via helper, rehydrate `data-exact-lot-price` dataset; `duplicateItem` populate (~L1874-1884): same rounding; duplicate post-restore step (~L1931-1933): replace unconditional `resetPurchasePriceToggle()` with LOT-aware `restorePurchasePriceToggle(sourceItem.pricingType, sourceItem.qty)` and rehydrate `data-exact-lot-price` for LOT-mode source items.
- `js/inventory-import.js` — `exportNumistaCsv` (~L1021): convert `purchasePrice` from internal USD to `activeCurrency` using `getExchangeRate(activeCurrency)`, then format with `roundToCurrencyPrecision(value, activeCurrency).toFixed(getCurrencyFractionDigits(activeCurrency))`.
- `tests/playwright/inventory/lot-each-purchase-price.spec.js` — extend with: (a) AC-1 repeating-decimal round trip ($1700 / qty 30); (b) AC-2 EACH display rounds to currency precision; (c) AC-3a/b edit-load both modes; (d) AC-5b LOT-save-then-EACH-load mirror; (e) duplicate-mode rounding and LOT-mode preservation; (f) `data-exact-lot-price` dataset is set/read/cleared at the documented moments; (g) quantity-change invalidation; (h) Numista CSV display-currency conversion for a non-USD currency.

### Deleted
- _none._

## Data / Schema Changes

None — no localStorage schema change, no migration. Per-unit `item.price` continues to hold a full-precision JS number. Legacy items with stored drift (e.g., `56.666667`) display correctly via D-2's helper at every boundary; on next edit, the value rewrites at full-precision (~`56.666666666666664`), but no user-visible value changes. Backups remain byte-identical for items not touched by the user.

## Tradeoffs Surfaced for Review

- **`data-exact-lot-price` over module state / WeakMap** (D-1): committing to a DOM-coupled cache even though `createLotEachToggle` and `parseItemFormFields` share module scope. Reversible if it bites — the consumers all funnel through the same handlers, so a future swap to module-state is mechanical. Chosen because Playwright/debug inspection and form-local ownership are useful here, provided cleanup is explicit.
- **D-6 normalizes Numista CSV** to display-currency values plus currency-aware precision. This changes non-USD Numista export output, but matches the current header and importer semantics. If maintainers prefer to keep Numista CSV strictly USD-2-decimal as a compatibility contract, that should be a separate product decision with a header change to `Buying price (USD)`. Recommended: ship D-6 as display-currency export.
- **Duplicate preserves source pricing mode** for LOT-mode items. This changes the current duplicate modal from always-EACH to source-mode-preserving, but keeps duplicate behavior consistent with edit-load behavior and makes the LOT exact-total cache meaningful.

## Out of Scope (follow-up issues)

- Auditing other `toFixed(6)` callsites in the codebase (weight/oz, spot, premium, melt, retail) — these intentionally use higher precision and are out of scope per requirements Non-Goals.
- Migrating already-drifted localStorage values via a one-time on-load sweep — explicitly Non-Goal per requirements.
- Adding a `getCurrencyFractionDigits`-aware formatter for the inventory table headers / sort comparators — not required for STRK-88, table already displays via `formatCurrency`.

## Risk Notes

- **Risk:** A Playwright test asserts the literal stored value `56.666667` somewhere. → **Mitigation:** Grep tests for `toFixed(6)` and `666667` during tasks phase; loosen any such assertion to a tolerance check or to the AC-driven displayed value.
- **Risk:** Another script (an autosave, a form-fill, a paste handler) clears `#itemPrice.dataset.exactLotPrice` between toggle and save. → **Mitigation:** D-4's consistency guard (cache rounds to displayed value) — if guard fails, the save handler falls back to the divide-by-qty path on the displayed (rounded) value. Worst case: user gets `1700.10` for the $1700/qty 30 LOT save instead of $1700.00, which is the *current* broken behavior — i.e., the fix degrades gracefully.
- **Risk:** Dataset cache leaks across modal uses. → **Mitigation:** clear `data-exact-lot-price` in reset/close/cancel/post-save/add-modal paths and cover with Playwright assertions.
- **Risk:** Quantity changes while in LOT mode reuse an old exact LOT total. → **Mitigation:** clear `data-exact-lot-price` on `#itemQty` input while LOT mode is active, forcing the save handler to respect the current visible value.
- **Risk:** A future currency with non-standard fraction digits surfaces (e.g., a precious-metal currency with 4 decimals). → **Mitigation:** `Intl.NumberFormat.resolvedOptions().maximumFractionDigits` returns the right thing for ISO-4217 currencies automatically; non-ISO currencies (custom denominations) inherit USD's 2 by default in `formatCurrency` today, and D-2's helper inherits that same fallback path.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete and matches discovery's surface inventory. Both open questions from discovery are resolved (D-1 chose dataset with explicit cleanup; D-2 introduces the missing primitive). Then advance: `/sketch-review STRK-88 approach`, reconcile, then `/sketch tasks STRK-88`.

## Review Archive — approach (2026-05-20)

_Reconciled by /sketch reconcile on 2026-05-20. Original reviewer marks preserved below for audit._

### Codex

#### Inline marks

> CODEX: On D-1, the "form-scoped, reset-clean" part needs an explicit cleanup hook. Native `form.reset()` does not clear arbitrary `data-*` attributes, and the current reset/close flows only call `this.reset()` / `elements.inventoryForm.reset()` plus `resetPurchasePriceToggle()` (`js/events.js:2259-2263`, `js/events.js:2334-2352`, `js/events.js:3958-3963`). If the cache lives on `#itemPrice.dataset`, the approach should require `resetPurchasePriceToggle()` or a named cache helper to delete `data-exact-lot-price` on add/reset/cancel/close/save boundaries.

> CODEX: On D-6, changing `.toFixed(2)` to `roundToCurrencyPrecision(value, activeCurrency).toFixed(getCurrencyFractionDigits(activeCurrency))` only changes decimal places; it does not convert the Numista value from internal USD into `displayCurrency`. The current Numista header says `Buying price (${displayCurrency})` (`js/inventory-import.js:968`) but the value comes directly from `item.purchasePrice ?? item.price` (`js/inventory-import.js:992-1021`), while `formatCurrency` converts via `getExchangeRate(currency)` before formatting (`js/utils.js:599-619`). If D-6 is meant to align Numista with CSV/PDF, the approach needs to decide conversion semantics, not just fraction digits.

> CODEX: The duplicate-mode line needs one more branch decision. Current duplicate flow writes the source `item.price` into `#itemPrice`, then unconditionally calls `window.resetPurchasePriceToggle()` (`js/inventory.js:1874-1884`, `js/inventory.js:1931-1933`), which forces EACH mode via `purchasePriceToggle.setMode("each", { convertInput: false })` (`js/events.js:162-176`). If duplicate should rehydrate a LOT exact-total cache for LOT-mode source items, the approach should say whether duplicate preserves the source pricing mode or stays EACH-only and merely rounds the visible per-unit value.

#### Review section

### Verified

- Confirmed StakTrakr is still a zero-build, vanilla JS frontend with strict script-load/global-scope constraints in DocVault (`DocVault/Projects/StakTrakr/Foundation/architecture.md:98-109`, `DocVault/Projects/StakTrakr/Foundation/coding-standards.md:72-94`).
- Confirmed current toggle conversion and save paths use `.toFixed(6)` in `createLotEachToggle` and `parseItemFormFields` (`js/events.js:83-87`, `js/events.js:1443-1445`).
- Confirmed edit-load EACH and LOT paths expose raw/sub-cent drift through `displayPrice` and `(perUnit * item.qty).toFixed(6)` (`js/inventory.js:1492-1502`, `js/inventory.js:1732-1740`).
- Confirmed duplicate flow writes the source price and then resets the purchase toggle to EACH (`js/inventory.js:1874-1884`, `js/inventory.js:1931-1933`, `js/events.js:162-176`).
- Confirmed `formatCurrency` converts internal USD to the target currency via `getExchangeRate`, while Numista CSV labels the column with `displayCurrency` but writes the raw `item.purchasePrice ?? item.price` value with `.toFixed(2)` (`js/utils.js:599-619`, `js/inventory-import.js:968`, `js/inventory-import.js:992-1021`).
- Confirmed current form reset/close/add flows reset form fields and toggle state but do not currently clear arbitrary `#itemPrice.dataset` values (`js/events.js:2259-2263`, `js/events.js:2334-2352`, `js/events.js:3958-3963`).

### Top concerns

1. D-1 assumes the dataset cache is reset-clean, but the current reset/close paths do not clear `data-*` attributes; the approach needs a named cleanup owner.
2. D-6 frames Numista CSV as currency-aware, but the proposed replacement only adapts precision and leaves the raw USD-vs-display-currency mismatch unresolved.
3. Duplicate-mode cache behavior is under-specified because the existing duplicate flow resets the toggle to EACH even when the source item was stored as LOT.

### Unverified assumptions

- `data-exact-lot-price` is acceptable DOM state if cleanup is explicit and centralized.
- The exact-lot cache should survive ordinary toggles but be cleared on add-modal open, cancel/close, post-save reset, and any transition out of the item modal.
- The cache consistency guard compares the cached LOT total against the displayed LOT value after rounding, and also remains correct if quantity changes while the modal is open.
- Numista CSV should either export converted display-currency values or be explicitly documented as raw USD despite the `displayCurrency` header.
- Duplicate mode should preserve source pricing mode when the source is LOT, or else tests should assert only EACH-mode visible rounding for duplicates.
- New currency helpers in `js/utils.js` should be exposed consistently with the app's global-script conventions if tests or other files need `window.*` access.

### Gemini

#### Inline marks

> GEMINI: Agree with CODEX. Native `form.reset()` leaves dataset attributes intact. Clearing `data-exact-lot-price` should be explicitly added to `resetPurchasePriceToggle` (called on add-modal open and duplicate) and form cancel/close flows (e.g. inside `closeItemModal`).

> GEMINI: Agree with CODEX on the currency mismatch. The Numista CSV exporter labels the column `Buying price (${displayCurrency})`, so to be consistent with both the header and the importer (`importNumistaCsv` converts *from* displayCurrency back to USD using exchange rates), the exporter MUST convert the internal USD price to the display currency using `getExchangeRate(activeCurrency)` before formatting and writing it to the CSV.

> GEMINI: Agree with CODEX. In order to keep duplicate behavior intuitive and consistent, duplication of an item stored in LOT mode should preserve LOT mode and rehydrate the `data-exact-lot-price` cache with the multiplied LOT total. The duplicate handler should call `restorePurchasePriceToggle(sourceItem.pricingType, sourceItem.qty)` instead of `resetPurchasePriceToggle()`.

#### Review section

### Verified

- Verified that `resetPurchasePriceToggle` in `js/events.js` (L162-166) is called during new item creation and resets the toggle to EACH, but does not currently touch dataset attributes.
- Verified that `closeItemModal` in `js/events.js` (L2335-2352) handles modal cleanup but does not currently clean input datasets.
- Verified that `duplicateItem` in `js/inventory.js` (L1830-1942) currently defaults the pricing toggle to EACH unconditionally via `resetPurchasePriceToggle` (L1874-1884, L1931-1933).
- Verified that `exportNumistaCsv` in `js/inventory-import.js` (L958-1043) exports raw internal USD prices while labeling the column with `displayCurrency` (L968, L992, L1021).
- Verified that `importNumistaCsv` in `js/inventory-import.js` (L771) parses the column based on the currency in the header and runs `convertToUsd` using exchange rates, confirming that exporting raw USD under a non-USD display currency header causes importing/exchange inflation.
- Verified that `js/utils.js` (L599-619) implements global window-bound helpers and exposes exports via both `window.*` and `module.exports` at the bottom of the file (L3341-3408).

### Top concerns

1. **Numista CSV Export Mismatch (D-6)**: Simply rounding the value without converting it via exchange rates results in exporting raw USD values under a non-USD currency header (e.g. `Buying price (EUR)`). This breaks consistency and corrupts the data upon importing the CSV back. The exporter must perform the exchange rate conversion first.
2. **Duplicate Pricing Mode Reset**: The current duplicate flow unconditionally resets the toggle to EACH even for items saved in LOT mode. To avoid user confusion and keep formatting consistent, the duplicate flow must preserve the source item's pricing mode and rehydrate the LOT exact-total cache.
3. **Form Cache Cleanup (D-1)**: Form resets and cancel/close flows do not clean arbitrary dataset attributes. Leaving `data-exact-lot-price` on `#itemPrice` could leak state across form uses. Wiping the cache explicitly in both `resetPurchasePriceToggle` and `closeItemModal` (or `clearUploadState`) is required.

### Unverified assumptions

1. The exact-lot cache should be cleared on add-modal open, cancellation/close, post-save reset, and duplicate mode initialization if the source item was in EACH mode.
2. Numista CSV exports should format values converted to display currency using the current exchange rate to align with the header currency.
3. Duplicating a LOT-mode item should preserve LOT mode and rehydrate the exact-lot price cache.
4. New currency helpers (`getCurrencyFractionDigits` and `roundToCurrencyPrecision`) will be exposed via both `window.*` and `module.exports` in `js/utils.js` to ensure availability and testability.

### Kimi

#### Inline marks

> KIMI: D-1's rationale that a closure "doesn't satisfy the save handler" is incorrect. `createLotEachToggle` and `parseItemFormFields` both live at module scope in `js/events.js` (lines ~60-160 and ~1430-1460). A module-level `let currentExactLotPrice = null;` declared alongside `purchasePriceToggle` (line 154) would be accessible to both the toggle factory and the save handler without DOM coupling. A `WeakMap` keyed by `priceEl` is another alternative. The approach should justify why DOM dataset is preferable to module-scope closure state, not claim closure is impossible.

> KIMI: D-4's consistency guard handles stale cache when the user hand-edits the price field, but the approach does not specify cache invalidation when the user changes **quantity** while in LOT mode. If qty changes from 30 to 15 after the cache was set to $1700, the displayed lot total is still $1700 (correct), but the approach does not say whether the cache should be cleared on `#itemQty` input events. Without this, a subsequent qty change + save could yield an unexpected per-unit price if the guard passes on the old cache. The task list should include a requirement to clear `data-exact-lot-price` on `#itemQty` input while `purchasePriceToggle.getMode() === "lot"`.

> KIMI: D-6's proposed replacement only adapts decimal precision; it does **not** resolve the currency-conversion mismatch that CODEX and GEMINI flagged. `formatCurrency` (the "rest of the user-facing export surface") converts internal USD to display currency via `getExchangeRate(currency)` before formatting (`js/utils.js:606`). The Numista exporter writes raw `item.purchasePrice ?? item.price` (internal USD) while labeling the column `Buying price (${displayCurrency})` (`js/inventory-import.js:968, 1021`). Simply changing `.toFixed(2)` to `roundToCurrencyPrecision(...).toFixed(...)` still exports USD values under a non-USD header. The importer (`js/inventory-import.js:771-775`) will then call `convertToUsd(rawValue, headerCurrency)`, treating the raw USD number as if it were EUR/CAD/etc and inflating it. The approach must explicitly choose: (a) convert to display currency before export (like `formatCurrency`), or (b) change the header to `Buying price (USD)`.

> KIMI: The File Map says duplicate should "rehydrate `data-exact-lot-price` dataset for LOT-mode source items," but the existing duplicate flow unconditionally calls `window.resetPurchasePriceToggle()` (`js/inventory.js:1931-1933`), which forces EACH mode. The approach does not explicitly state whether to replace this with `window.restorePurchasePriceToggle(sourceItem.pricingType, sourceItem.qty)`. Without that change, the duplicate handler will never enter LOT mode and the dataset rehydration code will be dead. The tasks should include an explicit decision and line edit for this call.

> KIMI: "Form cache cleanup" is not listed in the File Map or Key Decisions, but it is load-bearing. CODEX and GEMINI both identified that `resetPurchasePriceToggle`, `closeItemModal`, and the post-save reset path must explicitly delete `data-exact-lot-price`. This should appear as a distinct file-map entry (e.g., `js/events.js` — `resetPurchasePriceToggle` and `closeItemModal` add `delete priceEl.dataset.exactLotPrice`) rather than being buried in reviewer comments.

#### Review section

### Verified

- Confirmed `createLotEachToggle` and `parseItemFormFields` share the same module scope in `js/events.js` (lines ~60-160 and ~1430-1460), so module-level closure state is accessible to both.
- Confirmed `resetPurchasePriceToggle` (`js/events.js:162-166`) and `closeItemModal` (`js/events.js:2335-2352`) do not currently clear arbitrary `dataset` attributes.
- Confirmed Numista CSV labels the column with `displayCurrency` (`js/inventory-import.js:968`) but writes raw internal USD (`item.purchasePrice ?? item.price`, line 1021) with `.toFixed(2)`.
- Confirmed `importNumistaCsv` parses the header currency and calls `convertToUsd(amount, headerCurrency)` (`js/inventory-import.js:771-775`), which will inflate values if the exported number is actually USD but labeled as another currency.
- Confirmed `duplicateItem` unconditionally calls `window.resetPurchasePriceToggle()` (`js/inventory.js:1931-1933`), forcing EACH mode regardless of source item's `pricingType`.
- Confirmed `formatCurrency` converts USD→displayCurrency via `getExchangeRate` before formatting (`js/utils.js:606`), so D-6's claim of "bringing Numista into line with the rest of the export surface" requires currency conversion, not just precision normalization.
- Confirmed no Playwright tests currently assert `56.666667` or `toFixed(6)` in `tests/playwright/inventory/lot-each-purchase-price.spec.js`.

### Top concerns

1. **D-1's rationale for DOM dataset over closure state is factually incorrect**. Both consumers live in the same module (`js/events.js`). A module-level variable or WeakMap would avoid DOM coupling and eliminate the cleanup problem entirely. The approach should either correct the rationale or switch to module state.
2. **D-6 does not resolve the Numista currency-conversion bug**. The approach frames D-6 as aligning Numista with other exports, but only changes precision. Either the exporter must convert USD→displayCurrency (like `formatCurrency` does) or the header must read `Buying price (USD)`. Shipping D-6 without this decision perpetuates the importer inflation bug.
3. **Cache invalidation on quantity change is unspecified**. The consistency guard (D-4) covers hand-edits of the price field, but not quantity changes while in LOT mode. The approach should require clearing the exact-lot cache on `#itemQty` input events when mode is LOT, otherwise the saved per-unit price may silently diverge from user intent.

### Unverified assumptions

- DOM dataset cache is necessary because module-level state is inaccessible. (False — both handlers are in `js/events.js`.)
- `roundToCurrencyPrecision` followed by `.toFixed(getCurrencyFractionDigits(...))` will not re-introduce IEEE 754 artifacts at the string-boundary. (Unverified — `toFixed` uses round-half-up, while `Intl.NumberFormat` may use a different rounding mode.)
- The Numista importer's user base will accept a precision-only fix without a concurrent currency-conversion fix. (Load-bearing — the existing importer inflation bug remains active.)
- Duplicate mode should preserve source pricing mode. (Assumed by GEMINI but not explicitly decided in the approach text.)
- All currencies StakTrakr supports have ≤2 fraction digits. (JPY has 0; it is not in fallback rates but could appear via the live API. `Intl.NumberFormat` handles this, but tests should verify JPY or other 0-digit paths.)
- The exact-lot cache does not need invalidation when quantity changes while in LOT mode. (Untested — could produce surprising per-unit prices if qty is edited after the cache is set.)

### Resolution Summary

- Accepted: 6
- Rejected: 0
- Resolved with your input: 0
