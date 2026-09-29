---
sketch: "STRK-42-chart-viewport-scaling"
phase: approach
created: 2026-05-10
---

# STRK-42 — Approach

_How we'll build it. **Don't write code or tests** -- the tasks phase produces the work plan._

## High-Level Architecture

All three fixes live entirely within `_createPriceHistoryChart()` and `_fetchHistoricalSpotData()` in `js/viewModal.js`. No shared utilities or other chart surfaces need to change.

**Bug 1 (y-axis clips purchase price):** After Chart.js auto-scales, the y-axis viewport fits tightly around melt data, ignoring the purchase price line and retail line. The fix computes `suggestedMin` / `suggestedMax` from ALL visible dataset values — melt, purchase, and retail (when shown) — with ~5% padding on each side. This is applied in the existing post-create overrides block (`viewModal.js:1870–1894`) where all other viewModal-specific chart config already lives. Using `suggestedMin`/`suggestedMax` rather than hard `min`/`max` lets Chart.js still pick round tick values — it just guarantees the viewport is at least wide enough to show all data. The bounds apply globally to all ranges (short and long).

**Bug 2a (1Y range fetches too broadly):** When `days=365`, `_fetchHistoricalSpotData()` falls through to the `else` branch (line 1599) that sets `startYear = 1968` and fetches ~58 year files via `Promise.all`. The fix adds an intermediate branch for bounded ranges `days > 180` that computes `startYear` from the actual cutoff date, so 1Y fetches only 2025 + 2026 (two files). The `days === 0` ("All") and `days === -1` ("Purchased") paths remain unchanged.

**Bug 2b (1Y range missing synthetic anchor):** `isAllOrCustom` at viewModal.js:1689 is `false` for bounded ranges (`days=365`), so no synthetic entry is prepended to extend the chart line to the window start. If the earliest fetched data point is after the window start, the line starts late — producing the reported "melt only renders from Nov onward" symptom. The fix extends the synthetic-anchor logic to include bounded ranges where data exists but starts after the window cutoff.

## Key Decisions

| #   | Decision                                                                                   | Rationale                                                                                                                                                                                                                                                                                                                                                          | Tradeoff                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Apply y-axis bounds in viewModal's post-create overrides, NOT in `createTimeSeriesChart()` | Smallest blast radius — only the item detail chart needs purchase-price-aware bounds. The 4 other callers of `createTimeSeriesChart()` (card-view, retail-view-modal x2) have different dataset semantics and don't need this logic.                                                                                                                               | If another chart surface later needs the same bounds logic, it will need its own post-create block (acceptable — different charts have different value families).       |
| D-2 | Use `suggestedMin` / `suggestedMax` (not hard `min`/`max`)                                 | Chart.js treats `suggested*` as hints — the viewport will be at least this wide, but Chart.js may expand for round tick values or to include data that falls outside the suggestion. Hard `min`/`max` would force awkward tick labels.                                                                                                                             | Chart.js may add slight extra padding beyond our 5%, making the chart marginally less dense — acceptable on a 200px canvas.                                             |
| D-3 | Add `days > 180 && days > 0` branch in `_fetchHistoricalSpotData` for bounded long ranges  | The else branch's comment says "All" but it catches 1Y/5Y/10Y too. Computing `startYear` from the cutoff reduces 1Y from ~58 fetches to 2, and 5Y from ~58 to 6. This is a meaningful performance win.                                                                                                                                                             | The fetch fix alone may not resolve the 1Y visual symptom — see D-5.                                                                                                    |
| D-4 | Compute bounds from visible datasets only                                                  | The retail dataset has `hidden: !hasRetail`. If retail is hidden, its values should not influence `suggestedMin`/`suggestedMax` — otherwise, a high retail value could push the viewport up when the user can't see why.                                                                                                                                           | Same-range legend toggling doesn't recompute bounds (range changes destroy/rebuild the chart and naturally recompute). Acceptable for this sketch.                      |
| D-5 | Extend synthetic-anchor logic to bounded ranges                                            | The `isAllOrCustom` condition at viewModal.js:1689 excludes bounded ranges from getting a synthetic start point. For 1Y, this means the chart line starts at the first available data point, which may be well after the window start. Extending the condition to include bounded ranges where `purchaseDate < cutoff` ensures the line begins at the window edge. | Adds a synthetic data point at the window start — acceptable because the same pattern already works for All/Custom ranges.                                              |
| D-6 | Apply bounds globally to all ranges (not just short ranges)                                | The user confirmed that the bounds fix should benefit all ranges, not just short ones. AC-4 has been relaxed from "identically" to "no clipping or visible regression."                                                                                                                                                                                            | Wide ranges that previously auto-scaled with a different floor will now include all visible datasets in bounds computation. This is intentionally the desired behavior. |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- `tests/playwright/view-modal-chart-scaling.spec.js` — regression tests for y-axis bounds (purchase price visibility), 1Y data completeness, and visual verification across ranges

### Modified

- `js/viewModal.js` — (1) add `days > 180` branch in `_fetchHistoricalSpotData()` for bounded long ranges; (2) extend `isAllOrCustom` synthetic-anchor logic to include bounded ranges; (3) add `suggestedMin`/`suggestedMax` computation + application in `_createPriceHistoryChart()` post-create overrides block

### Deleted

- _None_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes.

## Tradeoffs Surfaced for Review

- **Dual root-cause fix for 1Y:** Both the fetch-path narrowing (D-3) and the synthetic-anchor extension (D-5) are implemented. The fetch fix is primarily a performance win; the synthetic anchor is the more likely visual fix. If the symptom persists after both, the rendering/filtering path in `_createPriceHistoryChart()` would need investigation as a follow-up.

- **5% padding on a 200px canvas:** The chart container is only 200px tall (160px on mobile). 5% padding means ~10px on each side — visible but not wasteful. If it feels too tight or too loose in practice, the percentage is a single constant to adjust. Mobile (160px) leaves ~144px for data — verify visually during implementation.

- **Padding floor for degenerate data:** When `dataMax === dataMin` (flat line) and `dataMax === 0`, `padding = dataMax * 0.05 = 0`. Use `Math.max(padding, 1)` as a floor to prevent degenerate zero-range scales.

## Out of Scope (follow-up issues)

- Zoom/pan/crosshair interactions on the chart (feature, not bug)
- Visual style changes (line weights, fill opacity, colors)
- Service worker cache staleness for year files (discovery noted stale-while-revalidate — this is a separate concern)
- Per-unit vs. total mismatch (`purchasePerUnit` vs. total melt for qty > 1 items) — pre-existing architectural smell, not addressed by this viewport fix
- Same-range legend toggling bounds recomputation — range changes already destroy/rebuild the chart; only same-range toggles leave stale bounds, which is acceptable for now

## Risk Notes

- The y-axis fix touches the post-create overrides block that also sets grid, legend, and tooltip options. The change is additive (new `scales.y.suggestedMin`/`suggestedMax` properties) with no overlap to existing overrides, but manual verification of all range pills is important.
- Chart.js v3.9.1 is the bundled version. `suggestedMin`/`suggestedMax` are stable Chart.js 3 features — no compatibility concern.
- The synthetic-anchor extension touches the `isAllOrCustom` condition. This must be careful not to add synthetic entries when data already covers the window start — only when `purchaseDate < cutoff` or the first data point is after the window start.
- Tests should freeze browser time or build fixture dates relative to the same clock used by `_fetchHistoricalSpotData()`, since the fetch branch is time-dependent.

---

> **Phase complete.** Architecture clear, decisions logged with rationale, file map complete.
