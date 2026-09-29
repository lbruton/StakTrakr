---
sketch: "STRK-161-spot-card-ratio-chips"
phase: requirements
created: 2026-06-07
---

# STRK-161 — Requirements

> **Source Issue:** [STRK-161](https://plane.lbruton.cc/lbruton/browse/STRK-161/)
>
> **Title:** Spot card ratio chips: GSR + gold/platinum + gold/palladium ratios, goldback rate on gold card
>
> **Summary.** Add a small corner chip to each of the four spot-price cards showing a precious-metals **ratio**, giving stackers an at-a-glance relative-value signal without leaving the dashboard. Each non-gold card shows its **gold-denominated ratio**; the gold card (no self-ratio) shows the **daily goldback G1 rate** instead. One settings toggle controls visibility. Static chip with a hover tooltip — no click interactions, no inverse views.
>
> **Ratio model (bullion convention — gold is always numerator):**
>
> | Card | Ratio | Formula | Example (spot 2026-06-06) |
> |------|-------|---------|---------------------------|
> | Silver | Gold/Silver (GSR) | gold ÷ silver | 4328.97 ÷ 67.84 ≈ **63.8** |
> | Platinum | Gold/Platinum | gold ÷ platinum | 4328.97 ÷ 1778.07 ≈ **2.43** |
> | Palladium | Gold/Palladium | gold ÷ palladium | 4328.97 ÷ 1225.67 ≈ **3.53** |
> | Gold | — (no self-ratio) | Goldback G1 rate | **$8.68** (1 goldback) |
>
> **Locked design decisions:**
> - **Ratio model:** gold-denominated ratio per card (GSR lives on the *silver* card). No inverse ratios, no per-card alternate views.
> - **Gold card corner:** daily goldback G1 rate (NOT a ratio).
> - **Interaction:** static chip + hover tooltip with a plain-English explanation. No click-to-toggle.
> - **Visibility:** single toggle in the Currency & Pricing settings panel, default ON. The goldback chip *additionally* respects the existing goldback pricing mode (off/api/spot/manual).
>
> **Goldback data source (verified 2026-06-06):** Source the gold-card rate from the existing client cache — `getGoldbackDenominationPrice(1)` reads `goldbackPrices["1"]`, populated by `fetchGoldbackApiPrices()` from `V2_API_ENDPOINTS[0]/goldback/latest.json`. Endpoint healthy: returns `g1_usd: 8.68`, `stale_after: 90000` (25h) budget, `data.ts` unix timestamp. Scrape is hourly at :05 (cron `5 * * * *`, set by STRK-58). **Freshness guard:** treat as stale when `(now − data.ts) > stale_after`; on stale/unavailable in `spot`/`manual` modes, fall back to `computeGoldbackEstimatedRate(spotPrices.gold)`. When goldback pricing mode is `off`, show no gold-card chip (correct, not a bug).
>
> **Proposed UI:** one chip per card in a consistent lower corner (recommend lower-left), leaving the "Last API Sync" timestamp in place — final corner/layout TBD in design. Compact label using element symbols + value, pro-terminal voice: `Au:Ag 63.8`, `Au:Pt 2.43`, `Au:Pd 3.53`, `GB $8.68`. Hover tooltip spells it out for casual users. Small inline SVG glyph using the codebase `stroke="currentColor"` pattern so it inherits theme color — must read well in all **four** themes (light, dark, slate, sepia) via design tokens. Decimals: GSR 1 dp; Au:Pt / Au:Pd 2 dp; goldback 2 dp. Responsive: cards stack on mobile — chip must not overflow or collide with the timestamp.
>
> **Acceptance criteria (from issue):**
> - **AC1:** Silver, platinum, palladium cards each render their gold-denominated ratio chip with correct math from `spotPrices`.
> - **AC2:** Gold card renders the goldback G1 rate chip, sourced from `getGoldbackDenominationPrice(1)` with the freshness guard and spot-estimate fallback.
> - **AC3:** A ratio chip is hidden when either required spot price is ≤ 0 (no `Infinity`/`NaN` ever shown). The goldback chip is hidden when goldback pricing mode is `off` or no valid G1 is available.
> - **AC4:** Chips update whenever spot prices change (API sync and manual edits) and whenever the goldback rate refreshes.
> - **AC5:** A single "Show spot ratios" toggle in the Currency & Pricing panel (via `wireStorageToggle`, default ON, persisted to localStorage) shows/hides all chips live.
> - **AC6:** Each chip exposes a hover tooltip with a plain-English explanation.
> - **AC7:** Chips render correctly and legibly in all four themes and on mobile widths.
> - **AC8:** No regression to existing spot card rendering, timestamps, sparklines, or the goldback settings flow.
>
> **Implementation pointers (from issue):**
> - Cards markup: `index.html:900-1130` — IDs `spotPriceDisplay{Metal}`, `spotChange{Metal}`, `spotTimestamp{Metal}`.
> - Spot values: `spotPrices.{gold,silver,platinum,palladium}` (USD/oz) at `js/state.js:327`.
> - Render hooks: `js/spot.js` — `fetchSpotPrice()` (451), `updateSpotChangePercent()` (1086); re-render on `updateManualSpot()` (503) and goldback refresh.
> - Goldback: `getGoldbackDenominationPrice(1)` (`js/goldback.js:300`), `fetchGoldbackApiPrices()` (420), `computeGoldbackEstimatedRate()` (378), `goldbackPricingSource` (10), `onGoldSpotPriceChanged()` (387).
> - Toggle: `wireStorageToggle()` (`js/settings.js:1837`); Currency & Pricing panel at `index.html:5585`; add a key constant in `js/constants.js`.
> - v2 endpoint list: `V2_API_ENDPOINTS` at `js/constants.js:559`.
> - SVG pattern: inline `stroke="currentColor"` at `js/attachment-ui.js:20`.
> - Mind the `safeGetElement` / script-load-order gotchas for any parse-time wiring.
>
> **Out of scope (deferred):** dedicated 5th "goldback" card; inverse-ratio displays + click-to-toggle alternate views; historical-ratio sparkline / band-extreme coloring.

## Overview

STRK-161 adds a small, static **ratio chip** to each of the four spot-price cards on the dashboard, giving users an at-a-glance relative-value signal without leaving the page or doing mental math. The three non-gold cards (silver, platinum, palladium) each show their **gold-denominated ratio** (gold ÷ metal); the gold card — which has no self-ratio — shows the current **daily goldback G1 rate** instead. A single Currency & Pricing setting (default ON) controls visibility of all four chips, and each chip carries a plain-English tooltip on hover and keyboard focus. The feature is purely a **display layer** over data the app already fetches (`spotPrices` and the cached goldback rate) — no new data sources, schema, or API changes — which is why it sits in `/sketch` rather than `/spec`.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a **stacker**, I want each non-gold spot card to show its gold-denominated ratio at a glance, so that I can judge relative value across metals without leaving the dashboard or doing the math.
- **US-2:** As a **goldback holder**, I want the gold card to show the current daily goldback (G1) rate, so that I have a live goldback reference alongside spot.
- **US-3:** As a **user who values a clean dashboard**, I want a single setting to show or hide all ratio chips, so that I can declutter the spot cards when I don't need the signal.
- **US-4:** As a **casual user unfamiliar with metal ratios**, I want a plain-English explanation on hover or keyboard focus, so that I understand what the number means and its typical range.

## Acceptance Criteria

> EARS syntax. Each line is individually testable and becomes a TDD Cohort B assertion downstream. Parenthetical tags trace each line back to the issue's original AC (and note where a 2026-06-07 grill clarified an open behavior).

### Group A — Ratio chips (silver, platinum, palladium)

- **AC-1** — **WHILE** the "Show spot ratios" setting is enabled **AND** both the gold spot price and the card's metal spot price are greater than 0, the system **SHALL** render a ratio chip on that metal's card showing `gold ÷ metal`, computed from `spotPrices`. _(issue AC1; US-1)_
- **AC-2** — The system **SHALL** format the displayed ratios as: Gold/Silver (GSR) to **1** decimal place; Gold/Platinum and Gold/Palladium to **2** decimal places. _(issue AC1; US-1)_
- **AC-3** — **IF** either spot price required for a card's ratio is ≤ 0 or non-finite, **THEN** the system **SHALL** hide that card's ratio chip and **SHALL NEVER** display `Infinity` or `NaN`. _(issue AC3; US-1)_

### Group B — Goldback chip (gold card)

- **AC-4** — **WHILE** the "Show spot ratios" setting is enabled **AND** goldback pricing mode is not `off` **AND** a valid current G1 rate is available, the gold card **SHALL** render a chip showing the goldback G1 rate from `getGoldbackDenominationPrice(1)`, formatted to **2** decimal places. _(issue AC2; US-2)_
- **AC-5** — **IF** the cached G1 rate is stale (`now − data.ts > stale_after`) **AND** goldback pricing mode is `spot` or `manual`, **THEN** the system **SHALL** source the gold card chip from `computeGoldbackEstimatedRate(spotPrices.gold)`. _(issue AC2; US-2)_
- **AC-6** — **IF** the cached G1 rate is stale **AND** goldback pricing mode is `api`, **THEN** the system **SHALL** hide the gold card chip — a stale API rate is treated as no valid current G1. _(grill-clarified 2026-06-07; US-2)_
- **AC-7** — **IF** goldback pricing mode is `off`, **OR** no valid G1 rate is available, **THEN** the system **SHALL** hide the gold card chip. _(issue AC3; US-2)_

### Group C — Live updates

- **AC-8** — **WHEN** spot prices change via API sync or manual edit, the system **SHALL** recompute and re-render every affected ratio chip. _(issue AC4; US-1)_
- **AC-9** — **WHEN** the goldback rate refreshes, the system **SHALL** re-render the gold card chip. _(issue AC4; US-2)_

### Group D — Visibility toggle

- **AC-10** — The Currency & Pricing settings panel **SHALL** provide a single "Show spot ratios" toggle, defaulting to **ON** and persisted to localStorage via `wireStorageToggle` under a new key in `constants.js`. _(issue AC5; US-3)_
- **AC-11** — **WHEN** the user changes the "Show spot ratios" toggle, the system **SHALL** show or hide all four chips **live**, without a page reload. _(issue AC5; US-3)_
- **AC-12** — **WHILE** the "Show spot ratios" setting is disabled, the system **SHALL** hide all four chips regardless of goldback pricing mode or spot validity. _(issue AC5; US-3)_

### Group E — Tooltip

- **AC-13** — Each rendered chip **SHALL** expose a plain-English explanatory tooltip, shown on **both** pointer hover **and** keyboard focus; the chip **SHALL** be keyboard-focusable. _(issue AC6 + grill-clarified 2026-06-07; US-4)_

### Group F — Themes & responsive

- **AC-14** — The chips **SHALL** render legibly in all **four** themes (light, dark, slate, sepia), using design tokens for color and an inline SVG glyph with `stroke="currentColor"` — no hardcoded colors. _(issue AC7)_
- **AC-15** — **WHILE** the viewport is at mobile/narrow widths (cards stacked), the system **SHALL** keep each chip visible and reflow or resize it so it does not overflow its card or collide with the "Last API Sync" timestamp. _(issue AC7 + grill-clarified 2026-06-07)_

### Group G — Regression

- **AC-16** — The system **SHALL** preserve existing spot-card rendering, timestamps, sparklines, and the goldback settings flow with **no regression**. _(issue AC8)_

## Non-Goals

_Explicit list of things this sketch does NOT do. Each entry should make a future reader confident the omission was intentional._

- **Not** adding a dedicated 5th "goldback" card with its own show/hide/sort settings — deemed too heavy for a first pass (issue: out of scope).
- **Not** adding inverse-ratio displays or click-to-toggle alternate views — the gold-numerator convention dissolves the "show the inverse?" question entirely (issue: out of scope).
- **Not** adding a historical-ratio sparkline or band/extreme threshold coloring (e.g. tinting GSR red when > 80) — good follow-up, separate issue (issue: out of scope).
- **Not** changing the goldback poller, endpoint, or scrape cadence — this feature is a read-only consumer of the existing `goldback/latest.json` data already cached client-side.
- **Not** adding per-card independent visibility toggles — a single master "Show spot ratios" toggle governs all four chips (the goldback chip is *additionally* gated by the existing goldback pricing mode).

## Open Questions

_Anything that blocks the next phase. Empty by the time discovery starts._

- **None blocking.** The following are **design-phase decisions intentionally deferred** to `/ui-mockup` + `/sketch-approach`; none of them changes any acceptance criterion above:
  - Exact chip **corner placement** (issue recommends lower-left, leaving the "Last API Sync" timestamp in place) — final corner/layout to be confirmed against a visual mockup.
  - **Glyph/iconography** for the inline SVG and the **compact label typography** (`Au:Ag 63.8`, `Au:Pt 2.43`, `Au:Pd 3.53`, `GB $8.68`).
  - Tooltip **rendering mechanism** (styled custom tooltip vs. another approach) — AC-13 pins the *behavior* (hover + focus, plain-English); the mechanism is an approach decision.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list carries no blockers (deferred items are design-phase, non-blocking). Then advance: `/sketch-discovery STRK-161`.
