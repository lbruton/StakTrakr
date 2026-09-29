---
sketch: "STRK-68-chart-unit-alignment"
phase: discovery
created: 2026-05-11
---

# STRK-68 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

### Edit modal toggle — creation and wiring

| Path | Role | Notes |
|------|------|-------|
| `js/events.js:60-136` | `createLotEachToggle()` factory | Reusable lot/each toggle. Returns `{ setMode, getMode, updateVisibility, updatePlaceholder }`. `maybeConvert()` (lines 70-87) auto-converts the price input when toggling. Toggle hidden at qty ≤ 1 (lines 118-133). |
| `js/events.js:138-144` | `purchasePriceToggle` instance | Wired to edit modal: `toggleId: "purchasePriceModeToggle"`, `priceInputId: "itemPrice"`, `qtyInputId: "itemQty"`. |
| `js/events.js:146-149` | `resetPurchasePriceToggle()` | **Always resets to "each" on modal open.** This is why the toggle state is lost on re-edit (AC-3 blocker). |
| `js/events.js:2238-2248` | Button click listeners | Clicking a toggle button calls `purchasePriceToggle.setMode(button.dataset.mode)`. |
| `js/events.js:2257` | Qty change listener | Calls `purchasePriceToggle.updateVisibility()` when qty input changes. |

### Price persistence — the root cause

| Path | Role | Notes |
|------|------|-------|
| `js/events.js:1417-1420` | **Lot→per-unit conversion on save** | If toggle is in "lot" mode, divides input price by qty. After this block, `priceInput` is **always per-unit**. The toggle state is discarded. |
| `js/events.js:1451` | Price stored | `price: parsePriceToUSD(priceInput, ...)` — already per-unit by this point. |
| `js/events.js:1555-1561` | Lot mode validation | Validates qty ≥ 1 when in lot mode. Reads `purchasePriceToggle.getMode()` ephemerally. |
| `js/events.js:1582-1616` | `buildItemFields(f)` | Builds the item record. No `pricingType` field exists — only `price` (per-unit). |
| `js/events.js:1624-1627` | `commitItemToInventory()` | Persists item to `inventory[]` via `buildItemFields()`. |

### View modal — chart

| Path | Role | Notes |
|------|------|-------|
| `js/viewModal.js:183-198` | `_getViewMetrics(item)` | Extracts `qty`, `weightOz`, `purity` from item. Used by both valuation and chart. |
| `js/viewModal.js:583-611` | `_getPriceHistoryContext()` | Builds chart context. Key values: `meltFactor = weightOz * qty * purity` (lot total multiplier, line 585). `purchasePerUnit = item.price * qty` (lot total, line 608). `currentRetail = marketValue * qty` (lot total, line 610). Misleading variable name — `purchasePerUnit` is actually purchase-per-lot. |
| `js/viewModal.js:614-633` | `_buildPriceHistorySection()` | Creates canvas element and stores `_chartData` with the context values. |
| `js/viewModal.js:1742-1743` | Chart data arrays | `meltData = spotEntries.map(e => e.spot * meltFactor)` — lot total. `purchaseLine = spotEntries.map(() => purchasePerUnit)` — lot total. Both lines always show lot totals regardless of user intent. |

| `js/viewModal.js:1770-1779` | Retail anchor start | Snaps `purchasePerUnit` (lot total) to the purchase date. |
| `js/viewModal.js:1783-1789` | Retail midpoints | `retailData[idx] = re.retail` — raw from `itemPriceHistory`, which stores **per-unit** retail (see priceHistory.js:101). |
| `js/viewModal.js:1792-1793` | Retail anchor end | `currentRetail` (lot total) pinned to the last entry. |

**Note:** The chart does not render melt midpoints from `itemPriceHistory` — only `re.retail` is consumed for sparse midpoints. Melt is computed from spot data directly. No melt-midpoint scaling is needed.

### View modal — valuation section

| Path | Role | Notes |
|------|------|-------|
| `js/viewModal.js:481-517` | `_buildValuationSection()` | `purchaseTotal = qty * purchasePrice` (lot total, line 487). `retailTotal = qty * marketVal` (lot total, line 489). Both always show lot totals. Display at line 500-502 shows both total and per-unit for qty > 1 items, but only in "lot" framing. |

### Price history recording

| Path | Role | Notes |
|------|------|-------|
| `js/priceHistory.js:87-101` | `recordItemPrice()` | Records `retail: item.marketValue` — **per-unit**. Also records `melt` (per-unit via `computeMeltValue`). These are the midpoints used in chart retail lines. |

### Item data model

| Path | Role | Notes |
|------|------|-------|
| `js/state.js:297` | `let inventory = [];` | Global inventory array, serialized via `saveData()`. |
| `js/constants.js:903-1042` | `ALLOWED_STORAGE_KEYS` | **Not relevant** — governs top-level `localStorage` key names, not fields within the serialized `inventory` array. Adding `pricingType` to an item object requires no `ALLOWED_STORAGE_KEYS` change. |

## Unit Mismatch Summary

The chart has a **three-way unit inconsistency** on dev:

| Chart line | Source | Unit | Evidence |
|------------|--------|------|----------|
| Purchase | `item.price * qty` (viewModal.js:608) | Lot total | Always multiplied by qty |
| Melt | `spot * weightOz * qty * purity` (viewModal.js:585, 1742) | Lot total | meltFactor includes qty |
| Retail (midpoints) | `re.retail` from itemPriceHistory (priceHistory.js:101) | **Per-unit** | Recorded as raw `item.marketValue` |
| Retail (endpoints) | `marketValue * qty` (viewModal.js:610, 1792) | Lot total | Multiplied by qty |

The purchase and melt lines are consistently lot-total. The retail line **mixes** per-unit midpoints with lot-total endpoints — a bug within the retail line itself.

## Prior Decisions

- **2026-04-27** — STRK-4 shipped: Lot/Each toggle added to edit modal for purchase price (PR #1037, v3.34.34). Toggle was intentionally ephemeral — per-unit conversion was the design, not an oversight. The view modal was mentioned in the spec requirements but lot persistence was not implemented. (mem0 id: 32dcb7f1)
- **2026-05-07** — STRK-44 discovery: `createLotEachToggle` factory pattern explicitly recommended for reuse in other modals. Disposition modal toggle added. (mem0 id: 54b73885)
- **2026-05-11** — STRK-68 created: User noticed mismatch while working on STRK-42 chart viewport scaling. Purchase line at ~$68 (per-unit), melt line at ~$401 (lot total for 5× 1oz items). (session e9f8362b, turn 512987)
- **2026-05-11** — PR #1102 closed: Codex added a runtime lot/each toggle to the view modal. User rejected this — the correct UX is to respect the edit modal's saved choice, not add a second toggle. (session 8b8edf75, turn 283987)

## External References

- None needed — this is an internal data flow bug, not a library/API integration.

## Constraints

- **`item.price` is always per-unit after save** — the lot→per-unit conversion at events.js:1417-1420 is baked into every saved item. A new `pricingType` field must be added to indicate user intent at save time; the stored price value itself stays per-unit.
- **No migration required** — existing items without `pricingType` get a sensible default at read time (per requirements AC-4).
- **Cloud sync is unaffected** — Dropbox sync serializes the full item object; a new field propagates automatically.
- **`resetPurchasePriceToggle()` always resets to "each"** — restoring saved pricingType on edit requires changing this function (or its call site) to accept the existing item's stored mode.
- **`purchasePerUnit` variable name is misleading** — it's actually `purchaseTotal` (per-unit × qty). Any fix should rename it or document the semantics change.
- **Retail line has its own internal inconsistency** — midpoints from `itemPriceHistory` are per-unit, but endpoints are `marketValue * qty` (lot total). This must be addressed alongside the main fix, not left as a separate issue.
- **Goldback denomination pricing** — `recordItemPrice()` uses a special `getGoldbackRetailPrice()` path (priceHistory.js:98-99). Ensure any unit-scaling logic doesn't double-apply to goldback items, which have denomination-based pricing distinct from weight-based melt.

## Open Questions

_All resolved during codebase analysis:_

- [x] ~~Does `pricingType` already exist anywhere?~~ No — grep confirms zero matches across all JS files. It must be added as a new field.
- [x] ~~Do `ALLOWED_STORAGE_KEYS` need updating?~~ No — that array governs top-level localStorage key names, not fields within the serialized inventory array.
- [x] ~~What unit are `itemPriceHistory` retail entries stored in?~~ Per-unit — `recordItemPrice()` at priceHistory.js:101 stores raw `item.marketValue` without qty multiplication.
- [x] ~~Does the retail line have the same lot/each issue?~~ Yes, but worse — it mixes per-unit midpoints with lot-total endpoints within the same line.

**Note:** `buildItemFields()` is the implicit schema boundary — any field not in its return object is dropped on save. This reinforces the "absence = legacy" approach: no migration needed.

**Out of scope:** Missing/stale `marketValue` (0 or undefined) can cause retail-line visual drops regardless of lot/each. Separate follow-up.

## Discovery Summary

The work centers on three files: `events.js` (persist a new `pricingType` field on save with preservation rule for existing items), `inventory.js` (restore toggle state on edit), and `viewModal.js` (chart context builder reads `pricingType` to decide lot vs. each display). The valuation section is unchanged — it continues showing both total and per-unit values. The hardest part is getting the retail line right — it has its own internal unit inconsistency (per-unit midpoints vs. lot-total endpoints) independent of the lot/each feature. The easiest part is persistence: `buildItemFields()` just needs one more field.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-68`.
