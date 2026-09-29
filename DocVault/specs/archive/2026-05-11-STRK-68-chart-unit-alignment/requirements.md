---
sketch: "STRK-68-chart-unit-alignment"
phase: requirements
created: 2026-05-11
---

# STRK-68 — Requirements

> **Source Issue:** [STRK-68](https://plane.lbruton.cc/lbruton/browse/STRK-68/)
> **Title:** Price history chart lot/each mismatch for multi-quantity items
>
> When viewing a multi-quantity item (e.g. 5x 1oz Silver rounds), the three price history chart
> lines use inconsistent units. The edit modal has a lot/each toggle but the choice is lost on
> save — `item.price` is always converted to per-unit before persisting (`events.js:1417-1419`).
> The chart then multiplies everything by qty, forcing lot-total display regardless of how the
> user entered the price.

## Overview

Persist the edit modal's lot/each pricing choice on each item so the view modal's price history chart can display all three lines (purchase, melt, retail) in the unit the user intended. When the user enters "50 each" for qty 5, the chart shows per-unit values; when they enter "250 lot" for qty 5, the chart shows lot totals. For qty=1 items, lot and each are identical — no visible change.

## User Stories

- **US-1:** As a stacker with multi-quantity lots, **I want** my price history chart lines to match the pricing unit I chose when I entered the item, **so that** the chart is visually meaningful — purchase, melt, and retail use the same unit of measure.
- **US-2:** As a user editing an existing item, **I want** the edit modal to remember whether I priced it as lot or each, **so that** re-editing shows the correct toggle state and doesn't silently reinterpret my price.

## Acceptance Criteria

### AC-1 — Chart lines use consistent units based on stored pricingType (maps to US-1)

- **Given** an item with qty=5, price=$50, pricingType="each"
- **When** I open the view modal and look at the price history chart
- **Then** the purchase line is at $50, melt line is `spot * weightOz * 1 * purity` (per-unit melt), and retail line is per-unit retail value. All three lines are in per-unit terms.

### AC-2 — Chart lines show lot totals for lot-priced items (maps to US-1)

- **Given** an item with qty=5, price=$50, pricingType="lot" (so the lot total is $250)
- **When** I open the view modal and look at the price history chart
- **Then** the purchase line is at $250, melt line is `spot * weightOz * 5 * purity` (lot melt), and retail line is `marketValue * 5`. All three lines are in lot terms.

### AC-3 — pricingType persists across save/reload (maps to US-2)

- **Given** I add a new item, set qty=5, toggle to "Lot", enter $250 as the price, and save
- **When** I reload the page and edit that item
- **Then** the edit modal shows the lot/each toggle in "Lot" mode with $250 in the price field (not $50 in "Each" mode)

### AC-4 — Existing items default to sensible behavior (maps to US-1, US-2)

- **Given** an item saved before this feature (no pricingType field stored)
- **When** I open its view modal or edit it
- **Then** the chart defaults to lot-total display (matching current behavior where `purchasePerUnit = item.price * qty`), and the edit modal shows "Each" mode (matching the current default toggle state). **On save, the item preserves its existing `pricingType` if present; legacy items (no `pricingType`) inherit the toggle state only when the user explicitly interacts with the toggle. Editing unrelated fields (notes, tags, etc.) does NOT silently flip chart behavior.**

### AC-5 — Qty=1 items are unaffected

- **Given** an item with qty=1
- **When** I open its modal and look at the chart
- **Then** the chart looks identical to today — no toggle shown, no behavioral change

### AC-6 — Valuation section unchanged; chart uses stored pricingType

- **Given** any multi-quantity item
- **When** I open its view modal
- **Then** the Valuation section continues to show both total and per-unit values (e.g., "$339.65 total · $67.93 each") — current behavior unchanged. The price history chart below it uses the unit determined by the stored `pricingType` (lot-total or per-unit)

- **No runtime toggle in the view modal** — Codex's closed PR (#1102) added a lot/each toggle to the view modal. This is unnecessary: the user's intent was already captured in the edit modal. The chart should just respect the stored choice.
- **No changes to the portfolio/inventory table** — the main table's display is a separate concern
- **No migration script** — existing items get a sensible default at read time; no explicit data migration needed
- **No changes to cloud sync schema** — pricingType is just another item field; Dropbox sync serializes the full item object
- **Clone/duplicate is out of scope** — `duplicateItem()` resets qty to 1, hiding the toggle (AC-5). Cloned items get `pricingType: "each"` implicitly, which is correct for qty=1.

## Open Questions

_All resolved during discovery._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-68`.
