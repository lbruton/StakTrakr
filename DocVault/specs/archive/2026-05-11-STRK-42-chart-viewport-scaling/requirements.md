---
sketch: "STRK-42-chart-viewport-scaling"
phase: requirements
created: 2026-05-10
---

# STRK-42 — Requirements

> **Source Issue:** [STRK-42](https://plane.lbruton.cc/lbruton/browse/STRK-42/)
> **Title:** Item detail chart: viewport auto-scaling clips data and purchase price line on shorter ranges
>
> Chart.js auto-scaling in the item detail modal price history chart causes two rendering issues:
> 1. **Purchase price line clipped on short ranges (7d, 14d, 30d)** — On an ASE with purchase price $38 and current melt ~$65-$70, the y-axis min is set too high, pushing the $38 dashed line off the bottom edge or under the fill area.
> 2. **Melt data visually truncated on 1Y range** — The x-axis spans the full year but melt value line only renders from ~Nov 2025 onward; May-Nov data is present (visible on 5Y/Purchased) but clipped or compressed out.
>
> Root cause hypothesis: `_createPriceHistoryChart` in `viewModal.js` sets no explicit `suggestedMin`/`suggestedMax` on either axis, and the year-file fetch path may return incomplete data for earlier months.

## Overview

The item detail modal's price history chart has two viewport-scaling bugs that hide meaningful data from the user. On short ranges (7d/14d/30d), the purchase price reference line — the single most important comparison anchor — gets clipped below the y-axis minimum because Chart.js auto-scales tightly around the melt value data. On the 1Y range, the x-axis shows the correct span but the melt value line only renders for roughly the last 6 months, making the chart appear data-sparse when the data actually exists. Both bugs undermine the chart's core purpose: showing the user how their item's melt value has moved relative to what they paid.

## User Stories

- **US-1:** As a metals holder viewing an item's price history, **I want** the purchase price reference line to always be visible on every time range, **so that** I can see at a glance how current melt compares to what I paid — even when the purchase price is far below current melt.

- **US-2:** As a metals holder viewing an item's price history, **I want** the full date range of melt data to render when I select a time range like 1Y, **so that** I can see the complete price trajectory without unexplained gaps.

## Acceptance Criteria

### AC-1 — Purchase price line visible on all ranges (maps to US-1)
- **Given** an item with purchase price significantly below current melt (e.g. $38 purchase, ~$70 melt)
- **When** I open the item detail modal and switch to any time range (7d, 14d, 30d, 90d, 1Y, 5Y, Purchased, All)
- **Then** the purchase price dashed line is fully visible within the chart viewport with at least ~5% padding below it

### AC-2 — Purchase price line visible when above melt (maps to US-1)
- **Given** an item with purchase price above current melt (e.g. bought at a premium during a dip)
- **When** I open the item detail modal and switch to any time range
- **Then** the purchase price dashed line is fully visible within the chart viewport with adequate padding above it, and melt data below is not compressed to the bottom edge

### AC-3 — Full melt data renders on 1Y range (maps to US-2)
- **Given** an item with melt value data spanning the full past year
- **When** I select the 1Y time range in the item detail modal chart
- **Then** the melt value line renders from near the start of the 1Y window to today, with no unexplained gaps exceeding 45 days in the middle months

### AC-4 — No clipping or visible regression on wide ranges
- **Given** any item with historical data
- **When** I select 5Y, 10Y, Purchased, or All time ranges
- **Then** all three data lines (purchase, melt, retail when present) are visible within the viewport — no line is clipped off the top or bottom edge. The bounds fix applies globally to all ranges.

### AC-5 — Retail price line unaffected
- **Given** an item that has retail price data displayed on the chart
- **When** I switch between time ranges
- **Then** the retail price line's visibility and scaling behaves consistently — it is not clipped by the y-axis bounds, and benefits from the same viewport-fitting logic as purchase and melt

### AC-6 — Visual verification across all ranges and viewports
- **Given** any item with purchase, melt, and retail data
- **When** I view the chart at desktop (200px) and mobile (160px) viewport heights across all time ranges
- **Then** all three data lines are visually distinguishable (not obscured or compressed to invisibility), and tick labels remain legible

## Non-Goals

- Not redesigning the chart component or switching away from Chart.js — this is a configuration fix within the existing charting setup
- Not changing the visual style (colors, line weights, fill opacity) of the chart — only axis scaling behavior
- Not adding new chart features (zoom, pan, crosshair, annotations) — scope is strictly axis scaling and data completeness
- Not changing how the chart behaves for items with no purchase price recorded — the purchase price line simply won't render in that case (existing behavior)
- Not fixing the per-unit vs. total mismatch between purchase price (`item.price` per unit) and melt value (`spot * weightOz * qty * purity` total). This is a pre-existing architectural smell for qty > 1 items — the bounds fix will faithfully display the existing chart contract. File a follow-up issue if this needs addressing.
- Not fixing z-order/fill obscuration between the melt fill area and the purchase dashed line. The purchase line renders as a red dashed line on top of the melt fill in current code; the z-order is confirmed correct. If visual overlap between the translucent melt fill and the purchase line is a concern, that's a style change outside this sketch's scope.
- Not recomputing bounds on same-range legend toggling. Range-pill changes destroy and rebuild the chart (recomputing bounds naturally); only same-range legend toggle would leave stale bounds, which is an edge case acceptable for this sketch.

## Open Questions

_None — the issue body is detailed enough to proceed to discovery._

---

> **Phase complete.** Acceptance criteria are concrete and verifiable. Open questions list is empty.
