---
sketch: "STRK-48-per-oz-per-coin-premium"
phase: approach
created: 2026-05-14
---

# STRK-48 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The feature replaces the current 4-column Valuation grid with a 6-column, table-style layout that adds Premium and G/L% columns. For lots (qty > 1), two data rows appear — lot totals on top, per-unit values below. All values are **recomputed at display time** from source fields; no schema changes, no new localStorage keys.

The implementation touches three layers:

1. **Spot lookup layer** (`js/spot.js`): A new synchronous, cache-only helper — `lookupHistoricalSpot(metalName, dateStr)` — implements the proven date-matching algorithm from `searchHistoricalByDate()` (progressive widening, absolute-nearest trading day) but operates exclusively on the in-memory `historicalDataCache`. Returns a single spot value (number) or `null`. Lives in `spot.js` alongside the cache, exposed on `window`.

2. **Display layer** (`js/viewModal.js`): `_buildValuationSection()` is rewritten from a 4-cell grid to a 6-column table-style layout using the existing `.view-detail-grid` CSS grid. The function resolves spot-at-purchase, computes premium (dollar and %), gain/loss %, and renders either 1 row (single item) or 2 rows (lot: totals + per-unit). Header labels form the first row; data values form subsequent rows.

3. **CSS layer** (`css/styles.css`): A new `.six-col` grid class (`1fr 1fr 1fr 1fr 1fr 1fr`) for desktop, collapsing to `1fr 1fr 1fr` (3×2) on mobile breakpoints. The existing `.gain`/`.loss`/`.muted` value styles apply unchanged.

No changes to `computeItemValuation()` — premium and G/L% logic stays local to the view layer.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | New sync helper `lookupHistoricalSpot()` in `spot.js`, not extracting/refactoring `searchHistoricalByDate()` | `searchHistoricalByDate()` is async, uses `fetchYearFile()`, returns an array, and is scoped to the Spot Lookup modal. A standalone sync helper reuses the *algorithm* (progressive widening, absolute-nearest trading day, tiebreak) without coupling to the async fetch path. Both read the same `historicalDataCache`. | Two functions with similar logic. Acceptable — the sync variant is ~25 lines and the coupling risk of refactoring the async function outweighs DRY. |
| D-2 | Absolute nearest trading day (not prior-only) | AC-4 says "nearest trading day." `searchHistoricalByDate()` uses `Math.abs(dayOffset)`. Matching avoids divergence between the Spot Lookup modal and this display. | Weekend purchase could resolve to Monday's spot instead of Friday's. Either adjacent day is equally valid. |
| D-3 | Grid layout: 6-column single row with header row + data row(s) | The user's design calls for a table-like layout — 6 labeled columns in one row (Purchase, Premium, Melt, Retail, Gain/Loss, G/L%), with data rows beneath. For lots, two data rows (total, then per-unit). On mobile (≤768px), collapses to 3 columns × 2 rows per data set. | Replaces the current 4-cell grid with a more structured table. Slightly more DOM elements, but better information density. |
| D-4 | Take `results[0].spot` when multiple entries exist for the same day | LBMA bundle stores entries normalized to `12:00:00` — one per metal per day in practice. Proximity sort + newest-timestamp tiebreak picks the PM fix if multiples exist. | Invisible to users. |
| D-5 | Fallback chain: supported metal → `lookupHistoricalSpot()` → `item.spotPriceAtPurchase` → "—" | Only Gold/Silver/Platinum/Palladium have cache entries. Non-precious metals skip the cache. `spotPriceAtPurchase` is a last resort (may be current-spot backfill from legacy migration). When both fail, show "—". | Legacy items with backfilled spot may show inaccurate premium. Known limitation — cache covers 1968–present for all four metals. |
| D-6 | Premium and Premium % both show "—" when ASW = 0 | Division by zero guard. Even though `price - 0 = price` is mathematically valid for the dollar premium, showing the full purchase price as "premium" is misleading. | Consistent "—" for both columns when data is insufficient. |
| D-7 | Guard unsupported metals before cache scan | `["Gold", "Silver", "Platinum", "Palladium"].includes(metalName)` fast-path. Items with `"Alloy"`, `"Paper"`, etc. skip to fallback. | Hard-coded list of 4 strings rather than deriving from `METALS` constant (which uses lowercase keys vs. cache's capitalized names). |
| D-8 | Premium % formula: `((price / ASW) / resolvedSpot - 1) × 100` | This gives "premium as percentage of spot" — e.g., if spot is $30/oz and you paid $33/oz, premium is +10%. Intuitive for stackers: "I paid X% over spot." | For negative premiums (bought below spot), the percentage is negative. Straightforward. |
| D-9 | G/L% formula: `((retailTotal - purchaseTotal) / purchaseTotal) × 100` | Standard ROI percentage. Uses the same retail/purchase values already computed by `computeItemValuation()`. | Shows "—" when purchase is $0 (division guard) or retail is $0 (no meaningful comparison). |
| D-10 | Lot rows: total row first, per-unit row second | Total row shows the aggregate investment and return (what the lot is worth as a whole). Per-unit row shows individual coin/bar economics (what each piece cost, its premium, its melt). Total row comes first because the lot is the user's actual position. | For single items (qty=1), only one row appears — no visual difference from the per-unit view since total = per-unit. |

## File Map

### New
- _(none)_

### Modified
- `js/spot.js` — Add `lookupHistoricalSpot(metalName, dateStr)` function (~25 lines) and expose on `window`. Placed near `historicalDataCache` and `fetchYearFile`.
- `js/viewModal.js` — Rewrite `_buildValuationSection()` to produce a 6-column layout using existing `_detailItem()` label-above-value cells, lot-aware data rows, premium computation, premium %, and G/L%. Add helper functions for premium resolution, `formatPercent()`, and row building.
- `js/utils.js` — Fix `computeItemValuation()` to correctly derive per-unit `purchasePrice` when `item.pricingType === "lot"` (divide `item.price` by `qty`). Fixes pre-existing bug where lot-mode items incorrectly computed `purchaseTotal = lotTotal * qty`.
- `css/styles.css` — Add `.view-detail-grid.six-col` grid class (`1fr 1fr 1fr 1fr 1fr 1fr`). Add mobile breakpoint rules using compound selector `.view-detail-grid.six-col` to collapse to `1fr 1fr 1fr` (3×2). Existing `.gain`/`.loss`/`.muted` styles apply unchanged.

### Deleted
- _(none)_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. The feature reads existing item fields (`price`, `weight`, `purity`, `weightUnit`, `metal`, `date`, `qty`, `spotPriceAtPurchase`, `marketValue`) plus the in-memory `historicalDataCache`. No fields are written.

## Layout Mockup — Before & After

### Desktop (≥769px) — Before: `four-col` (4 cells, 1 row)

```
┌──────────────────────────────────────────────────────────────────────┐
│  VALUATION                                                           │
├─────────────────┬─────────────────┬─────────────────┬────────────────┤
│ PURCHASE        │ MELT VALUE      │ RETAIL          │ GAIN/LOSS      │
│ $339.65 total   │ $381.36         │ $381.36         │ +$41.71        │
│ $67.93 each     │                 │                 │ (green)        │
│ (3/21/26)       │                 │                 │                │
└─────────────────┴─────────────────┴─────────────────┴────────────────┘
```

### Desktop (≥769px) — After: `six-col` (6 columns, header + data rows)

**Single item (qty = 1):**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  VALUATION                                                                       │
├──────────────┬──────────────┬──────────────┬──────────────┬───────────┬──────────┤
│ PURCHASE     │ PREMIUM      │ MELT         │ RETAIL       │ GAIN/LOSS │ G/L%     │
├──────────────┼──────────────┼──────────────┼──────────────┼───────────┼──────────┤
│ $67.93       │ +10.2%       │ $76.27       │ $76.27       │ +$8.34    │ +12.3%   │
│ (3/21/26)    │ (green)      │              │              │ (green)   │ (green)  │
└──────────────┴──────────────┴──────────────┴──────────────┴───────────┴──────────┘
```

**Lot item (qty = 5):**

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  VALUATION                                                                       │
├──────────────┬──────────────┬──────────────┬──────────────┬───────────┬──────────┤
│ PURCHASE     │ PREMIUM      │ MELT         │ RETAIL       │ GAIN/LOSS │ G/L%     │
├──────────────┼──────────────┼──────────────┼──────────────┼───────────┼──────────┤
│ $339.65 total│ +10.2%       │ $381.36      │ $381.36      │ +$41.71   │ +12.3%   │
│ (3/21/26)    │              │              │              │ (green)   │ (green)  │
├──────────────┼──────────────┼──────────────┼──────────────┼───────────┼──────────┤
│ $67.93 each  │ +10.2%       │ $76.27       │ $76.27       │ +$8.34    │ +12.3%   │
│              │              │              │              │ (green)   │ (green)  │
└──────────────┴──────────────┴──────────────┴──────────────┴───────────┴──────────┘
```

### Mobile (≤768px) — After: 3-col collapse

**Single item:**

```
┌──────────────────────────────────────────────────┐
│  VALUATION                                        │
├────────────────┬────────────────┬─────────────────┤
│ PURCHASE       │ PREMIUM        │ MELT            │
│ $67.93         │ +10.2%         │ $76.27          │
│ (3/21/26)      │ (green)        │                 │
├────────────────┼────────────────┼─────────────────┤
│ RETAIL         │ GAIN/LOSS      │ G/L%            │
│ $76.27         │ +$8.34 (green) │ +12.3% (green)  │
└────────────────┴────────────────┴─────────────────┘
```

### Edge case — missing spot-at-purchase

```
│ PURCHASE       │ PREMIUM        │ MELT            │ RETAIL         │ GAIN/LOSS      │ G/L%           │
│ $67.93         │ — (muted)      │ $76.27          │ $76.27         │ +$8.34 (green) │ +12.3% (green) │
```

### Edge case — negative premium (bought below spot)

```
│ PURCHASE       │ PREMIUM        │ MELT            │ RETAIL         │ GAIN/LOSS      │ G/L%           │
│ $28.50         │ -2.1% (red)    │ $30.14          │ $30.14         │ +$1.64 (green) │ +5.8% (green)  │
```

## Tradeoffs Surfaced for Review

- **D-6 (Premium "—" when ASW=0):** AC-5 says Premium/coin "may still compute if resolvedSpot > 0," but with a % column now the primary premium display, computing `price / 0` is a non-starter. Both premium columns show "—" when ASW=0.

- **Lot row premium %:** Premium % is the same for the total row and per-unit row (the ratio is identical regardless of quantity). Both rows show the same percentage. This is correct but may look redundant. The alternative — suppressing premium % on one row — was rejected because each row should be self-contained and readable in isolation (especially on mobile where lot rows wrap independently).

## Out of Scope (follow-up issues)

- **Premium column in inventory table/cards** — modal-only per non-goals. Could be a follow-up if users want sorting/filtering by premium.
- **Retroactive `premiumPerOz`/`totalPremium` field repair** — stored fields are wrong for legacy items. This feature ignores them.
- **Premium dollar amount column** — the original issue proposed `Premium/oz` and `Premium/coin` as dollar values. The expanded design uses % as the single premium column. Dollar values could be added as a tooltip or secondary display in a follow-up.

## Risk Notes

- **Purity default 1.0 vs 0.999:** Items where purity was never stored default to `1.0` via `_getViewMetrics()`. For .999 fine silver/gold, ~0.1% error in premium %. Known minor limitation.
- **Legacy spot backfill in fallback:** When cache misses and fallback uses `item.spotPriceAtPurchase`, that value may be current spot from migration time. Premium % for such items will be inaccurate. Mitigated by the cache covering 1968–present.
- **6-column width on narrow desktop (769–900px):** Six columns with currency values may feel tight at the low end of the desktop breakpoint. The 3-col mobile collapse at ≤768px provides relief. If 769–900px proves cramped during implementation, consider lowering the mobile breakpoint or using `minmax()` in the grid definition. Verify during visual testing.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch review STRK-48 approach`, then `/sketch tasks STRK-48`.
