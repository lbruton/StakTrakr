---
sketch: "STRK-48-per-oz-per-coin-premium"
phase: requirements
created: 2026-05-14
---

# STRK-48 — Requirements

> **Source Issue:** [STRK-48](https://plane.lbruton.cc/lbruton/browse/STRK-48/)
>
> **Title:** Display per-oz / per-coin premium as labeled numbers
>
> **Description:**
> The `spotPriceAtPurchase` field is captured at purchase time and visible as a marker on the price-history chart (Item Detail modal), but the user doesn't see a labeled number like "You paid $3.40/oz over spot" or "$2.10 premium per coin." The math is doable from existing data but isn't surfaced.
>
> **Proposed:** In the Item Detail modal's Valuation section, add two new lines beneath Purchase:
> - **Premium / oz:** `(purchasePricePerCoin / weightOzt) - spotPriceAtPurchase`
> - **Premium / coin:** `purchasePricePerCoin - (spotPriceAtPurchase * weightOzt * purity)`
>
> Show as positive (premium paid above spot) or negative (rare — bought below spot) with appropriate coloring.
>
> **Edge cases:**
> - If `spotPriceAtPurchase` is missing for legacy items, display "—" instead of zeroing.
> - For multi-metal bars or fractional coins, math must use ASW (actual silver/gold weight), not gross weight.
>
> **Source:** Reddit ISO-Lost-Marbles, Q4 — `DocVault/Inbox/Reddit User Feedback - StakTrakr.md`

## Overview

Surface the premium-over-spot the user paid at purchase time as labeled values in the Item Detail modal's Valuation section, alongside premium %, gain/loss %, and lot-aware rows. This answers the fundamental stacker question — "what did I actually pay above melt?" — without forcing the user to do mental math.

The premium values are **recomputed at display time** from source fields (`price`, `weight`, `purity`, and the resolved spot-at-purchase), not read from the stored `premiumPerOz` / `totalPremium` fields on the item. Those stored fields are often zeroed on new items and backfilled from current (not purchase-day) spot on legacy items, making them unreliable for display.

The spot-at-purchase is resolved from the `historicalDataCache` (59 years of LBMA data in `spot-history-bundle.js`) keyed by the item's purchase date, with `spotPriceAtPurchase` as a fallback for dates outside the cache range.

## User Stories

- **US-1:** As a precious metals collector, I want to see how much premium per troy ounce I paid above spot at purchase, so that I can evaluate whether I got a fair deal relative to other purchases.
- **US-2:** As a precious metals collector, I want to see how much total premium per coin/bar I paid above its melt value at purchase, so that I can compare premiums across items of different sizes and purities.
- **US-3:** As a user with legacy items (pre-`spotPriceAtPurchase` field), I want the UI to gracefully indicate missing data rather than showing misleading zero values.
- **US-4:** As a user viewing the Item Detail modal, I want the Valuation section to present premium alongside existing metrics in a consistent, readable grid layout that doesn't wrap awkwardly across breakpoints.
- **US-5:** As a precious metals collector, I want to see the premium as a percentage of spot, so I can quickly compare relative premiums across items at different price points.
- **US-6:** As a precious metals collector, I want to see gain/loss as a percentage, so I can evaluate return on investment without mental math.
- **US-7:** As a user with lot items (qty > 1), I want to see both the lot-total valuation and per-unit breakdown in the same grid, so I can assess the lot as a whole and per coin/bar.

## Acceptance Criteria

### AC-1 — Premium per oz displayed (maps to US-1)
- **Given** an item with a resolved spot-at-purchase > 0 and valid `price`, `weight > 0`, `purity > 0`
- **When** the Item Detail modal's Valuation section renders
- **Then** a "Premium/oz" line appears showing `(price / ASW) - resolvedSpot`, where ASW = `weightOz * purity`, formatted as currency with +/− sign

### AC-2 — Premium per coin displayed (maps to US-2)
- **Given** an item with a resolved spot-at-purchase > 0 and valid `price`, `weight > 0`, `purity > 0`
- **When** the Item Detail modal's Valuation section renders
- **Then** a "Premium/coin" line appears showing `price - (resolvedSpot * weightOz * purity)`, formatted as currency with +/− sign

### AC-3 — Positive/negative coloring
- **Given** the premium values are computed
- **When** premium is ≥ 0
- **Then** the value uses the existing `.gain` CSS class (green in default theme)
- **When** premium is < 0
- **Then** the value uses the existing `.loss` CSS class (red in default theme)

### AC-4 — Spot-at-purchase resolution (maps to US-3)
- **Given** an item with a purchase date
- **When** premium is computed
- **Then** the resolved spot-at-purchase is looked up from `historicalDataCache` for the item's metal on the purchase date (nearest trading day if exact date is missing)
- **Given** the purchase date is not in the cache
- **Then** fall back to `spotPriceAtPurchase` from the item record
- **Given** neither source provides a spot value > 0 (no purchase date AND no `spotPriceAtPurchase`)
- **Then** both premium fields display "—" (em-dash)

### AC-5 — Zero/invalid weight or purity fallback
- **Given** an item where `weight` is 0/missing or the computed ASW (`weightOz * purity`) is 0
- **When** the Valuation section renders
- **Then** "Premium/oz" displays "—" (division by zero guard); "Premium/coin" may still compute if `resolvedSpot > 0`

### AC-6 — Unit conversion correctness
- **Given** an item with `weightUnit` of `"gb"` (goldback) or `"sb"` (silverback)
- **When** premium is computed
- **Then** the calculation uses the already-converted `metrics.weightOz` (which applies `GB_TO_OZT` / `SB_TO_OZT`), not the raw `weight` field

### AC-7 — Multi-quantity items
- **Given** an item with `qty > 1`
- **When** premium is computed
- **Then** the premium values are per-unit (per single coin/bar), not multiplied by quantity
- **Note:** `item.price` is already stored per-unit after lot-mode entry (divided before save), so no qty adjustment is needed in the formula

### AC-8 — Valuation grid layout: 6-column single row (maps to US-4)
- **Given** the Valuation section renders with premium data
- **When** viewed on desktop (≥769px)
- **Then** the grid displays 6 columns in a single row: Purchase, Premium, Melt, Retail, Gain/Loss, G/L%
- **When** viewed on mobile (≤768px)
- **Then** the 6 columns collapse to a 3×2 grid (3 columns, 2 rows)

### AC-9 — Premium % displayed (maps to US-5)
- **Given** an item with a resolved spot-at-purchase > 0 and valid ASW > 0
- **When** the Valuation section renders
- **Then** the Premium column shows the premium as a percentage of spot: `((price / ASW) / resolvedSpot - 1) × 100`, formatted with +/− sign and `%` suffix
- **Given** the resolved spot is 0 or missing
- **Then** the Premium column displays "—"

### AC-10 — Gain/Loss % displayed (maps to US-6)
- **Given** an item with `purchaseTotal > 0` and `retailTotal > 0`
- **When** the Valuation section renders
- **Then** the G/L% column shows `((retailTotal - purchaseTotal) / purchaseTotal) × 100`, formatted with +/− sign and `%` suffix, with `.gain`/`.loss` coloring
- **Given** `purchaseTotal` is 0 or `retailTotal` is 0
- **Then** the G/L% column displays "—"

### AC-11 — Lot rows for multi-quantity items (maps to US-7)
- **Given** an item with `qty > 1`
- **When** the Valuation section renders
- **Then** two data rows appear: the first shows lot-total values (total purchase, total melt, total retail, total gain/loss), the second shows per-unit values (each price, per-unit premium, per-unit melt, per-unit retail, per-unit gain/loss)
- **Given** an item with `qty === 1`
- **Then** only one data row appears (per-unit values)

## Non-Goals

- **Not adding premium to the inventory table/cards** — this is modal-only; a table column may be a follow-up issue.
- ~~**Not computing "premium %" as a percentage**~~ — _Removed: scope expanded during approach phase to include premium % and G/L% columns (AC-9, AC-10)._
- **Not retroactively fixing stored `premiumPerOz` / `totalPremium` fields** — those fields are unreliable; this feature recomputes from source fields at display time and ignores them.
- **Not adding premium to the Details Modal (quick-view)** — only the full Item Detail modal (`viewModal.js`) is in scope.
- **Not touching the chart or its spot-at-purchase marker** — that feature is independent and working.
- **Not introducing new localStorage keys or data schema changes** — this is a read-only presentation of existing fields plus historical cache lookup.

## Open Questions

_(None — resolved during requirements reconciliation.)_

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch review STRK-48 requirements`, then `/sketch discovery STRK-48`.

## Review Archive — requirements (2026-05-17)

_Reconciled by /sketch reconcile on 2026-05-17. Original reviewer marks preserved below for audit._

### Codex

#### Verified

- Confirmed the full Item Detail modal Valuation section is built by `_buildValuationSection()` in `js/viewModal.js:550-591`.
- Confirmed modal metrics already convert `weightUnit: "gb"` / `"sb"` into `metrics.weightOz` in `js/viewModal.js:251-265`, using `GB_TO_OZT` / `SB_TO_OZT`.
- Confirmed existing `.gain` / `.loss` styling is used on Valuation values in `js/viewModal.js:582-586` and defined for `.view-detail-value` in `css/styles.css:6311-6319`.
- Confirmed `item.price` is stored per-unit after lot-mode entry via the STRK-4 tests in `tests/playwright/inventory/lot-each-purchase-price.spec.js:234-248` and `tests/playwright/inventory/lot-each-purchase-price.spec.js:250-271`.
- Confirmed legacy normalization can backfill `spotPriceAtPurchase` from current spot in `js/inventory.js:293-321`.
- Confirmed new items still persist `premiumPerOz: 0` and `totalPremium: 0` in `js/events.js:1838-1843`, and sanitization can reset those premium fields to zero in `js/utils.js:1383-1387`.

#### Top concerns

1. AC-4 assumes legacy items with no true purchase spot remain visibly missing, but live migration can populate `spotPriceAtPurchase` from current spot, making some legacy values look authoritative.
2. AC-1/AC-2 do not define behavior for positive spot plus zero/invalid weight or purity; the current metric parser makes that possible.
3. The requirements do not say whether to ignore existing stored premium fields, which matters because those fields are already present but often zero/stale.

#### Unverified assumptions

- The implementation will recompute the two display values from `price`, `spotPriceAtPurchase`, `metrics.weightOz`, and `purity` rather than using stored `premiumPerOz` / `totalPremium`.
- A migrated `spotPriceAtPurchase` written from current spot is acceptable purchase-time evidence, or there will be a way to identify and suppress it.
- Formatting with a plus sign can be layered on top of `formatCurrency()` without breaking non-USD display currency behavior.
- Adding two more Valuation cells to the existing `four-col` grid will remain visually acceptable on mobile.
- The feature should not apply to the quick Details modal, even though `detailsModal.js` also computes valuation totals for the summary breakdown.

### Resolution Summary
- Accepted: 3 (zero-weight guard → AC-5; stored premium fields unreliable → Overview + Non-Goals; per-unit price dependency → AC-7 note)
- Rejected: 0
- Resolved with user input: 2 (legacy spot backfill → AC-4 now uses historicalDataCache as primary source instead of trusting backfilled field; layout concerns → US-4 + AC-8 added, details deferred to approach)
