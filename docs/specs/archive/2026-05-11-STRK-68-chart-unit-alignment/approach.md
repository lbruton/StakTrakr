---
sketch: "STRK-68-chart-unit-alignment"
phase: approach
created: 2026-05-11
---

# STRK-68 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Add a `pricingType` field ("each" | "lot") to the item data model. The field captures the user's display intent — how they think about the price — but does **not** change storage semantics: `item.price` remains per-unit always, and the existing lot→per-unit conversion at `events.js:1417-1420` stays untouched.

The view modal's chart context builder (`_getPriceHistoryContext`) becomes the single decision point for unit scaling. It reads `item.pricingType` and produces pre-scaled values that the chart renderer consumes. A shared `getDisplayUnitQty(item)` helper centralizes the multiplier logic. No `* qty` conditionals are scattered across rendering code — the context builder owns the math. The valuation section is unchanged (continues showing both total and per-unit values).

For legacy items (no `pricingType` field), the absence of the field is the signal. Legacy items get lot-total chart display (matching current behavior per AC-4) and "each" toggle state in the edit modal (matching current default per AC-4). No backfill, no migration.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | `item.price` stays per-unit; `pricingType` is display-intent metadata only | Avoids a data migration. Every calculation that already works per-unit continues to work. The field answers "how should I show this to the user?" not "what unit is the price in?" | Requires the chart to derive the display value rather than just reading it directly |
| D-2 | Scaling logic centralized in `_getPriceHistoryContext()` | Single source of truth for unit math. Chart arrays, valuation section, and any future consumer all read pre-scaled values. | Any future display mode (e.g. per-gram) also needs to go through this function — it's a deliberate bottleneck |

| D-3 | Retail midpoints (`itemPriceHistory` entries) are always scaled to match chosen display unit | Currently midpoints are per-unit and endpoints are lot-total — a bug within the retail line itself. This fix normalizes both to whichever unit `pricingType` indicates. | Slightly more complex scaling in the context builder, but eliminates a pre-existing inconsistency |
| D-4 | Legacy items (no `pricingType` field): chart defaults to lot-total, edit toggle defaults to "each". **On save, preserve existing `pricingType` if present; legacy items inherit toggle state only on explicit toggle interaction.** | Matches current behavior exactly — the chart already multiplies by qty, and the toggle already resets to "each". Zero visual change for existing users. Save path uses `item.pricingType \|\| purchasePriceToggle.getMode()` so editing unrelated fields doesn't silently flip chart behavior. | The legacy path is technically "lot display with each toggle" which is the same mismatch the feature fixes — but changing legacy behavior without user action would be surprising. **Decision: preserve on first save (Lonnie, 2026-05-11).** |

| D-5 | No rename of `purchasePerUnit` variable in this PR | Discovery correctly flagged it as misleading (it's actually purchase-total). Renaming adds diff noise orthogonal to the feature. File as a follow-up. | Misleading name persists one more release |
| D-6 | Goldback items are unaffected | Goldback denomination pricing uses `getGoldbackRetailPrice()` and goldback items have `weightUnit: "gb"`. They almost always have qty=1 (denominations, not multiples). The toggle is hidden at qty ≤ 1 (AC-5), so goldback items never enter the pricingType path. | If a user creates a multi-qty goldback lot (unusual), the scaling would apply — acceptable edge case |

| D-7 | Toggle restore lives in `inventory.js:editItem()`, not in `resetPurchasePriceToggle()` | `editItem()` already has access to the item and is responsible for populating all form fields. The reset function stays as a clean "return to default" for the add-new path. | Two call sites touch the toggle (add resets, edit restores) instead of one smart function |

## File Map

### New
- None

### Modified
- `js/events.js` — (1) Add `pricingType` to `buildItemFields()` return object using preservation rule: `pricingType: item.pricingType || purchasePriceToggle.getMode()` (existing items keep stored value; new items inherit toggle state); (2) capture toggle state in `parseItemFormFields()` so it flows through to the builder
- `js/inventory.js` — (1) In `editItem()`, replace the `resetPurchasePriceToggle()` call with toggle restore: read `item.pricingType`, call `purchasePriceToggle.setMode()` with the stored value (default "each" for legacy items), and convert the displayed price back to lot-total if in lot mode
- `js/viewModal.js` — (1) `_getPriceHistoryContext()`: read `item.pricingType` to decide qty multiplier (1 for "each", `qty` for "lot" or absent); apply multiplier to purchase, melt, and retail values consistently; (2) chart data arrays at ~line 1742: retail midpoints scaled by the same multiplier. **`_buildValuationSection()` is NOT modified** — per Lonnie's decision (2026-05-11), the valuation section continues showing both total and per-unit values unchanged; only the chart respects pricingType.

### Deleted
- None

## Data / Schema Changes

No schema migration. The `pricingType` field is added to each item's in-memory object by `buildItemFields()` and serialized to localStorage via the existing `saveData()` path. Dropbox cloud sync serializes the full item object — the new field propagates automatically with no schema version bump.

Existing items without `pricingType` are handled at read time: absence = legacy = lot-total display + each toggle default.

## Tradeoffs Surfaced for Review

- **Legacy asymmetry (D-4) — RESOLVED:** Preservation rule decided (Lonnie, 2026-05-11). Save path uses `item.pricingType || purchasePriceToggle.getMode()` — existing items keep their stored value; editing unrelated fields doesn't flip chart behavior.
- **No runtime toggle in view modal (per requirements non-goals):** Once saved, the display unit is fixed until the next edit. Explicit rejection of PR #1102's approach.
- **Clone/duplicate out of scope:** `duplicateItem()` resets qty to 1, hiding the toggle. Cloned items get `pricingType: "each"` implicitly — correct for qty=1.
- **`itemPriceHistory` consumer audit:** Only `viewModal.js` reads these entries for display. No export-to-CSV, alerts, or portfolio summary consumers exist.

## Out of Scope (follow-up issues)

- Rename `purchasePerUnit` → `purchaseTotal` (or similar) — cosmetic, pure rename, separate PR
- Portfolio/inventory table lot/each display — the main table is a separate concern (per requirements non-goals)

## Risk Notes

- The retail line fix (D-3) changes visible chart output for items where `itemPriceHistory` entries exist. The current behavior is buggy (mixed units within a single line), so the change is a correction — but it will look different. Verify visually with a real multi-qty item.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-68`.
