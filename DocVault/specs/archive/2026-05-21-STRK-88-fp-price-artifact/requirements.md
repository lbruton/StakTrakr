---
sketch: "STRK-88-fp-price-artifact"
phase: requirements
created: 2026-05-19
---

# STRK-88 — Requirements

> **Source Issue:** [STRK-88](https://plane.lbruton.cc/lbruton/browse/STRK-88/)
> **Title:** Floating-point price artifact in lot/each toggle
> **Priority:** Medium
>
> Entering $1700 as a LOT price for qty 30, the price keeps defaulting to $1700.00001. Switching to EACH shows $56.66667 (1700/30). Switching back to LOT shows the artifact. The odd number persists across save/load cycles.
>
> **Root Cause:** Cascading `toFixed(6)` precision loss in the lot/each conversion pipeline: `events.js:86` (toggle conversion), `events.js:1445` (save path divides lot price by qty), `inventory.js:1739` (edit load multiplies back). Chain: `1700 / 30 = 56.666667` (truncated) → `56.666667 * 30 = 1700.00001` (IEEE 754 artifact). Note: `computeItemValuation` in `js/utils.js:1486` propagates this drift into valuation totals via `item.price * qty`; display-time rounding via `formatCurrency` masks it on the inventory table but not in raw calculations.

## Overview

The lot/each price toggle introduces floating-point drift when converting between per-unit and total-lot prices. Users entering clean currency values (e.g. $1700.00) see fractional cent artifacts ($1700.00001) after a round-trip through the toggle. The drift persists across save/load because the imprecise value is written to localStorage. This erodes trust in the app's precision — critical for a precious metals tracker where exact dollar amounts matter.

## User Stories

- **US-1:** As a StakTrakr user entering a lot price, I want the displayed price to remain exactly what I typed (rounded to cents) after toggling between LOT and EACH modes, so that I can trust the app isn't silently corrupting my data.
- **US-2:** As a StakTrakr user editing an existing item, I want the price field to show a clean currency value (no sub-cent digits) when I open the edit form, so that the form doesn't look broken.
- **US-3:** As a StakTrakr user, I want existing items in my inventory that already have floating-point drift to display correctly (rounded to the active currency's standard fraction digits), so that the fix applies retroactively to my data at display time.

## Acceptance Criteria

### AC-1 — Clean round-trip through toggle (maps to US-1)

- **Given** a user is adding an item with quantity 30 and price mode LOT
- **When** they enter $1700.00 as the lot price, toggle to EACH, then toggle back to LOT
- **Then** the LOT price field displays exactly $1700.00 (not $1700.00001 or any sub-cent value)
- **And** the round-trip remains clean AFTER any `input` event side effects fired by the toggle conversion (`events.js:83-87`) have run
- **Source-of-truth contract:** the implementation MUST preserve an internal exact-value reference for the original lot price that survives toggle conversions. The displayed input value is presentation only — it is NOT the source of truth for round-trip math. (How that reference is held — closure variable, dataset attribute, form-scoped cache — is an approach decision, not a requirements decision.)

### AC-2 — EACH price displays at currency precision (maps to US-1)

- **Given** a lot price of $1700.00 for quantity 30
- **When** the user toggles to EACH mode
- **Then** the per-unit price displays rounded to the active currency's standard fraction digits (typically 2; e.g. $56.67 for USD, not $56.66667). Fraction digits follow the same `Intl.NumberFormat` rules already used by `formatCurrency` in `js/utils.js:599`.
- **Non-source contract:** the displayed rounded EACH value MUST NOT be used as the source for any subsequent conversion back to LOT mode. The exact-value reference established in AC-1 is what drives the return trip.

### AC-3 — Edit form shows clean values (maps to US-2)

Two paths must be covered — LOT-mode edit and EACH-mode edit:

**AC-3a — LOT-mode edit load**

- **Given** an existing inventory item saved with a lot price that has sub-cent floating-point drift (e.g. stored as 56.666667 per unit), and the user has the form in LOT mode
- **When** the user opens the edit form for that item (path: `inventory.js:1732-1745`)
- **Then** the price field shows $1700.00 (rounded to currency precision), not the raw `(perUnit * qty).toFixed(6)` value

**AC-3b — EACH-mode edit load**

- **Given** an existing inventory item with stored per-unit `price: 56.666667`, and `fxRate === 1` (no currency conversion is repricing the value), and the form is in EACH mode
- **When** the edit form populates `#itemPrice` via the `displayPrice` assignment at `js/inventory.js:1492-1502` (BEFORE `restorePurchasePriceToggle` runs)
- **Then** the field shows $56.67, not the raw `56.666667`

### AC-4 — Display-time rounding for legacy data (maps to US-3)

- **Given** existing inventory items in localStorage that were saved with floating-point drift in their price values
- **When** the inventory table renders those items
- **Then** all price columns display values rounded to the active currency's standard fraction digits (already handled by `formatCurrency` in `js/inventory-table.js:621-623`, called against `purchaseTotal` from `computeItemValuation`)

**Export surfaces:**

- **CSV and PDF exports** (user-facing surfaces: `js/inventory-import.js:1095-1120`, `js/inventory.js:2069-2087`) MUST render price values using the same currency-precision rounding as the UI. These are documents users read, not restore points.
- **JSON and encrypted/ZIP backup exports** (data-integrity surfaces: `js/inventory.js:1969-1979`, `js/inventory-backup.js:25-36`) MAY preserve raw internal `item.price` values. These exist for round-trip restore; rounding them would change the data, not just its presentation.

### AC-5 — No data loss for non-repeating decimals AND repeating-decimal save/load

Two cases — terminating and repeating decimals through both directions:

**AC-5a — Terminating EACH-to-LOT (no rounding needed)**

- **Given** a user enters a per-unit price of $56.75 for quantity 30
- **When** they toggle to LOT mode
- **Then** the lot price displays as $1702.50 (exact multiplication, no rounding artifact, no precision loss)

**AC-5b — Repeating-decimal LOT-save-then-EACH-load mirror**

- **Given** a user enters $1700.00 in LOT mode with quantity 30 and saves the item (exercises save-time division at `js/events.js:1443-1445`)
- **When** they reopen the edit form and toggle to EACH (exercises edit-time multiplication at `js/inventory.js:1732-1740`)
- **Then** EACH displays $56.67 (currency-precision), and toggling back to LOT displays $1700.00 (exact recovery via the AC-1 exact-value contract, not by re-multiplying the displayed $56.67)

## Non-Goals

- **Not migrating stored data** — existing localStorage values will not be batch-corrected on load. The fix rounds at display and save boundaries only. A data migration would risk introducing different rounding errors on items where the user intentionally stored high-precision values.
- **Not changing internal storage precision** — price-per-unit will continue to be stored internally at full JavaScript number precision (no per-cent truncation at the storage layer). Internal precision is acceptable; what changes is the UI/user-visible boundary.
- **Distinguishing internal precision from user-visible currency values** — currency rounding applies at the UI input/display boundary AND at user-facing export surfaces (CSV, PDF). Internal computation surfaces (`computeItemValuation`, JSON/encrypted backups) may continue to carry raw `item.price`; their display-time consumers (e.g. the table cell, formatted via `formatCurrency`) handle the rounding.
- **Not implementing arbitrary-precision arithmetic** — libraries like `decimal.js` are overkill for this fix. Standard `Math.round()` or `toFixed(2)` (or currency-aware equivalents via `Intl.NumberFormat`) at the right boundary points is sufficient for currency precision.
- **Scope limited to purchase price mode conversion** — other uses of `toFixed(6)` in the codebase are out of scope: weight/oz conversions, spot price calculations, premium math, melt-value math, and retail-price pipelines all intentionally use more precision and stay untouched by this sketch.

## Open Questions

_None — the issue body provides sufficient root cause analysis, the reviewer round resolved cross-AC source-of-truth tensions, and the fix boundaries are clear._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable, with both source-of-truth and non-source contracts explicit. Open questions list is empty. Ready for discovery.
>
> **Next:** Run `/sketch discovery STRK-88`.

## Review Archive — requirements (2026-05-19)

_Reconciled by /sketch reconcile on 2026-05-19. Original reviewer marks preserved below for audit._

### Inline marks (verbatim)

**On the root-cause block:**

> GEMINI: Verified. Checked `events.js:86`, `events.js:1445`, and `inventory.js:1739` in the codebase; they do perform the described conversions with `toFixed(6)`, leading to the cascading IEEE 754 precision drift. Note also that `computeItemValuation` in `js/utils.js:1486` calculates totals using `item.price * qty` directly, propagating this drift to valuation statistics if not rounded.

**On AC-1:**

> GEMINI: Note that if we display-round the per-unit price in EACH mode to 2 decimal places (per AC-2), toggling back to LOT would yield a different number (e.g., $56.67 * 30 = $1700.10) if we calculate based on the displayed text. The implementation approach will need to track the high-precision or original lot price value to ensure AC-1 is satisfied.

> CODEX: Verified the toggle currently converts the visible input itself via `convertedPrice.toFixed(6)` in `js/events.js:83-87`. This AC should explicitly require the round-trip to remain clean after the form's `input` event side effects run, because tests already assert that mode conversion emits `input` (`tests/playwright/inventory/lot-each-purchase-price.spec.js:461-479`) and any hidden exact-value cache can be invalidated by those listeners.

**On AC-2:**

> CODEX: This is a visible-field requirement, but AC-1 depends on a non-visible exact value. Please make the expected storage/conversion contract testable: after displaying `$56.67`, toggling back must not multiply the rounded text. Existing toggle tests only cover exact divisions like `100 / 2` (`tests/playwright/inventory/lot-each-purchase-price.spec.js:443-458`), so the repeating-decimal case needs a dedicated assertion.

**On AC-3:**

> GEMINI: Verified. In `inventory.js:1732-1745`, the edit form loading path performs `(perUnit * item.qty).toFixed(6)` for LOT items, loading the raw float drift into the input. Rounding this to currency precision (2 decimal places) at this boundary is required.

> CODEX: Verified an additional EACH-mode path: before `restorePurchasePriceToggle`, edit load assigns `elements.itemPrice.value = displayPrice`, where `displayPrice` is the raw `item.price` when `fxRate === 1` (`js/inventory.js:1492-1502`). For an existing EACH-mode item with `price: 56.666667`, AC-3 will fail unless the requirements explicitly cover rounding at that earlier field-population boundary too.

**On AC-4:**

> GEMINI: Verified. The inventory table rendering in `js/inventory-table.js` formats all purchase prices using `formatCurrency` (`js/utils.js:599`), which uses `Intl.NumberFormat` and automatically rounds display output to 2 decimal places. Thus, display-time rounding for table cells is already handled.

> CODEX: AC-4 is already true for the main table's rendered purchase cell: `purchaseTotal` may be computed from raw drift (`js/inventory-table.js:430-436`), but the cell displays `formatCurrency(purchaseTotal)` (`js/inventory-table.js:621-623`). If the intent is to fix more than the table, name the other surfaces; CSV/PDF exports format per-unit `purchasePrice`, not lot total (`js/inventory-import.js:1095-1120`, `js/inventory.js:2069-2087`), and JSON/vault-style exports preserve raw `item.price`.

**On AC-5:**

> CODEX: The example is useful, but it only exercises an EACH-to-LOT conversion with a terminating cent value. Add the mirror save/load assertion for LOT-to-EACH-to-save with qty 30, because the root cause also includes save-time division in `js/events.js:1443-1445` and edit-time multiplication in `js/inventory.js:1732-1740`.

**On Non-Goals:**

> GEMINI: Retaining full precision in storage is preferred to avoid migration risk, but we must make sure the UI inputs and calculations are safely isolated from this precision loss.

> CODEX: This non-goal is plausible, but it needs one more guardrail: if implementation stops truncating to six decimals and stores a fuller per-unit value, exports/backups will still expose raw `item.price` (`js/inventory.js:1969-1979`, `js/inventory-backup.js:25-36`). Requirements should distinguish acceptable internal precision from user-visible/exported currency values.

### Gemini

#### Verified

- Checked codebase paths and line numbers:
  - Verified `events.js:86` performs `Number(convertedPrice.toFixed(6)).toString()` when toggling lot/each.
  - Verified `events.js:1445` performs `(rawInput / parsedQty).toFixed(6)` when saving lot price.
  - Verified `inventory.js:1739` performs `(perUnit * item.qty).toFixed(6)` when loading edit modal.
  - Verified `formatCurrency` in `js/utils.js:599` handles the display-time currency rounding (relying on `Intl.NumberFormat`) which retroactively formats legacy totals in the inventory table.
  - Verified `computeItemValuation` in `js/utils.js:1486` is the central valuation function.

#### Top concerns

1. **Mathematical constraints/conflict between AC-1 and AC-2**: Display-rounding per-unit price to 2 decimal places ($56.67) in EACH mode means that toggling back to LOT mode naively would yield $1700.10 (56.67 * 30) instead of the original $1700.00. The implementation must preserve the precise/unrounded value behind the scenes or detect toggling state without loss.
2. **Impact on valuation calculations**: Since `computeItemValuation` performs calculations using `item.price` (which is stored in localStorage as unit price with precision drift, e.g. `56.666667`), any purchase totals computed as `price * qty` (like `purchaseTotal`) will be `1700.00001`. While `formatCurrency` hides this at display time in the table, it could affect other areas (such as export/import or exact numeric comparisons). We should ensure all intermediate calculations round `purchaseTotal` and other financial metrics to standard currency decimals when appropriate.
3. **Consistency of Save/Load values in Edit Form**: In `inventory.js:1739`, when the edit modal is opened, if the item is in LOT mode, it calculates `(perUnit * qty).toFixed(6)` to populate the input field. This directly loads the drifted value `$1700.00001` into the input field. Display-rounding at this input boundary to currency precision (e.g. 2 decimal places) is required.

#### Unverified assumptions

1. **Timezone/Currency alignment**: Assumed that the display-rounding uses the standard fraction digits for the current active currency. USD/EUR/GBP use 2 decimal places, but if other currencies are added or active (e.g., JPY, or custom/goldback denominations), the rounding must adapt to the currency's standard.

### Codex

#### Verified

- Confirmed the toggle's visible-input conversion path uses `convertedPrice.toFixed(6)` and dispatches `input` after changing the value (`js/events.js:83-87`).
- Confirmed save-time LOT input is divided by quantity with `.toFixed(6)` before becoming stored per-unit price (`js/events.js:1443-1445`).
- Confirmed edit-load LOT mode multiplies stored per-unit price by quantity with `.toFixed(6)` (`js/inventory.js:1732-1740`).
- Confirmed edit-load EACH mode can place raw `item.price` directly into `#itemPrice` when display currency FX is 1 (`js/inventory.js:1492-1502`).
- Confirmed the inventory table formats purchase totals with `formatCurrency`, but computes those totals from raw `item.price * qty` via `computeItemValuation` (`js/inventory-table.js:430-436`, `js/inventory-table.js:621-623`, `js/utils.js:1491-1499`).
- Confirmed existing Playwright coverage exercises lot/each mode behavior, but the visible conversion tests use exact divisions like 100/2 and do not cover the 1700/30 repeating-decimal regression (`tests/playwright/inventory/lot-each-purchase-price.spec.js:443-479`).

#### Top concerns

1. **AC-1 and AC-2 need an explicit hidden-value contract.** Showing `$56.67` in EACH mode cannot become the source of truth for the return to LOT mode, or the app will produce `$1700.10` instead of `$1700.00`.
2. **AC-3 misses the raw EACH-mode edit path.** The LOT edit path is identified, but the earlier `displayPrice` assignment can also show `56.666667` before any lot multiplication occurs.
3. **AC-4 is too narrow if the goal includes exports or downstream totals.** The main table already rounds display via `formatCurrency`; raw precision still flows through valuation calculations and JSON/vault-style exports unless the requirements name those boundaries.

#### Unverified assumptions

1. The implementation may introduce a transient exact-value cache for the open form without changing the persisted item schema.
2. Currency precision should remain two decimal places for the purchase-price input regardless of display currency, even though `Intl.NumberFormat` can vary fraction digits by currency.
3. JSON and encrypted/ZIP backup exports are allowed to retain raw internal `item.price` values, while CSV/PDF and UI surfaces should present currency-rounded values.
4. The fix is limited to purchase price mode conversion and should not round weight, spot, premium, melt, or retail calculations that intentionally use more precision.

### Resolution Summary

- **Accepted: 7** — AC-1 source-of-truth contract; AC-1 post-`input`-event clean state; AC-2 non-source contract; AC-3b EACH-mode edit path; AC-5b repeating-decimal save/load mirror; Non-Goals internal-vs-visible split; Non-Goals explicit scope limit to purchase price.
- **Rejected: 1** — CODEX unverified #1 (transient exact-value cache approach): implementation strategy belongs in approach.md, not requirements. Forwarded to architect.
- **Resolved with reasonable defaults: 3** —
  1. Valuation totals (GEMINI top concern #2): existing `formatCurrency` display path is sufficient; not adding a new AC. Raw computation in valuation function is acceptable internal precision.
  2. Export surfaces (CODEX top concern #3, unverified #3): CSV/PDF round to currency precision (user-facing); JSON/encrypted backups preserve raw `item.price` (data-integrity round-trip). Added to AC-4 and Non-Goals.
  3. Currency-specific fraction digits (GEMINI unverified #1, CODEX unverified #2): honor active currency's standard via existing `Intl.NumberFormat` / `formatCurrency` path rather than hardcoding 2 decimals. Parameterized in AC-2 and AC-4.
