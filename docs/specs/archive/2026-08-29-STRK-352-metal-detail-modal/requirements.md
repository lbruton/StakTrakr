---
sketch: "STRK-352-metal-detail-modal"
phase: requirements
created: 2026-08-28
---

# STRK-352 — Requirements

> **Source Issue:** [STRK-352](https://plane.lbruton.cc/lbruton/browse/STRK-352/)
> **Title:** Metal detail modal redesign — portfolio chart, composition bars, acquisitions ledger (Variant A)
>
> **Body summary (full spec in the issue; pixel authority: `playground/metal-detail-modal-playground.html`, PR #1475):**
> Replace the two-pie details modal (`#detailsModal`, `js/detailsModal.js`) with the approved Variant A "Stack Story" layout, opened from the dashboard totals-card titles via the existing `showDetailsModal(metal)` entry point.
>
> - **Layout:** close row → Instrument Serif header with metal-accent underline + mono substats → 5-KPI strip (Purchase / Melt / Retail / Unrealized / Realized) → hero chart card → metric toggle → equal-height two-column grid (composition panels | acquisitions ledger) → provenance footer.
> - **Hero chart:** ledger-driven portfolio melt value backdated to first acquisition (metal token color + gradient), stepped cost-basis line, Spot/oz overlay on right axis (per-metal scopes only), buy markers sized by purchase amount; crosshair + tooltips; marker click flashes the matching ledger row; range pills 30D/90D/1Y (default)/ALL; substrip = market gain (excludes contributions) · invested · buy count · pace oz/mo.
> - **Composition:** stacked horizontal bars + single-line rows (top 6 + "+N more"), existing Purchase/Melt/Retail/Gain-Loss metric toggle in a new hugging `.dm-seg` variant. All → by metal + by purchase location; per-metal → by type + by purchase location.
> - **Ledger:** acquisitions newest-first (Date | Item + type chip | Qty | Paid | Melt now | ±%); row click opens the existing Item View modal; "View all in Inventory" deep-link; equal height via absolute-fill; mobile slims to Date | Item | Qty | ±%.
> - **States:** loading skeletons, empty CTA. All four themes, tokens only. Chart.js 3.9.1, destroy on close.
> - **Traps pinned in the issue:** `#detailsModal` ID-specificity CSS rules must be updated; derived oz must route through `getConstitutionalSilverOz` / `GB_TO_OZT` / `SB_TO_OZT`; Dispositions must drop melt contribution at disposition date (prototype gap); UTC-vs-local date frames; dual registration if a new `js/` file is added.
> - **Out of scope:** dashboard totals-card sparkline redesign; Variants B/C; premium/what-if calculators.

## Overview

Replace the app's oldest surviving UI — the two-pie details modal — with the approved Variant A "Stack Story" layout: a ledger-driven portfolio value chart (melt value vs cost basis, Spot Price overlay, acquisition markers), compact composition bars, and a mini acquisitions ledger, opened from the six dashboard totals-card titles (All Metals, Silver, Gold, Platinum, Palladium, Copper). Competitive research (2026-08-28) showed the dual-line value-vs-basis chart with buy markers is the canonical stock-app pattern that no metals tracker ships well — this closes that gap, free. The approved playground prototype is the binding visual/interaction contract.

## Grill Brief (light pass — issue was pre-specified by the approved prototype)

**Decisions settled by the playground iteration + issue:** Variant A layout; close button on its own top row; hugging `.dm-seg` segmented controls; equal-height ledger; mobile ledger columns Date | Item | Qty | ±%; chart renders on mobile; melt drops at Disposition date; composition metric default = Melt; default range = 1Y.

**Decisions resolved in grill + reconcile (2026-08-28, user-confirmed):**

1. **Basis line drops at Disposition** — both chart lines reflect *current holdings*: a disposed Item's purchase cost leaves the cost-basis line at its Disposition date, so the melt-vs-basis gap always reads as unrealized gain on current holdings (holdings view, not invested-ever view).
2. **Ledger lists active Items only** — disposed Items stay visible in the Inventory table and Change Log, not in the modal's mini-ledger.
3. **Undated Items are held-since-start** — an Item with no acquisition date (Date N/A) contributes to melt and basis for the entire series, gets no buy marker, and sorts to the bottom of the ledger with "—" for date. The chart's right edge therefore always equals the KPI totals.
4. **Buy markers show all history** — markers include acquisitions of since-disposed Items (the series includes them until Disposition). Marker click flashes all active ledger rows for that date; with zero active matches it is a no-op (the tooltip still lists the items).
5. **Disposed-only scopes render history** — the empty state appears only when a scope has zero active AND zero disposed Items. A scope whose Items were all disposed renders normally: historical chart ending at zero, zeroed holdings KPIs, nonzero Realized, empty ledger with a quiet note.

**Terms (per `.context/GLOSSARY.md`):** Item, Disposition, Spot Price, Spot History, Melt Value, Constitutional Silver (derived oz via `getConstitutionalSilverOz`), Goldback Denomination (`item.weight` stores Denomination for `gb`/`sb`, Face Value for `cu` — never raw oz).

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a stacker, I want to see my stack's melt value plotted against what I actually paid, backdated to my first acquisition, so that I can tell at a glance whether I'm up and by how much.
- **US-2:** As a stacker viewing one metal, I want the Spot Price overlaid on my portfolio chart, so that I can tell whether a value change came from the market moving or from me buying more.
- **US-3:** As a stacker, I want my acquisitions marked on the chart and listed in a ledger that links to each Item, so that I can connect "what happened to my value" with "what I bought and when."
- **US-4:** As a stacker, I want composition breakdowns (by metal or type, and by purchase location) with the familiar Purchase/Melt/Retail/Gain-Loss lens, so that I can see what my stack is made of without reading two pie charts.
- **US-5:** As a mobile user, I want the same modal to work single-column on my phone with the chart intact, so that the redesign doesn't demote mobile to a stats-only view.
- **US-6:** As a user of any theme, I want the modal to render correctly in dark, light, slate, and sepia, so that the redesign doesn't break my chosen look.

## Acceptance Criteria (EARS)

> Each line is individually testable and becomes a TDD Cohort B assertion. "The modal" = the redesigned `#detailsModal`; "scope" = the metal argument of `showDetailsModal(metal)` (`All` or one metal). **Currency rule (applies to every AC):** all monetary values, axis labels, and unit suffixes SHALL render through `formatCurrency` in the active display currency — no literal currency symbols in markup or new code.

### Shell & entry (US-1, US-6)

- **AC-1:** WHEN a dashboard totals-card title is clicked, the modal SHALL open for that scope via `showDetailsModal(metal)` with the Variant A layout (close row, header, KPI strip, chart card, metric toggle, composition + ledger grid, footer) and none of the legacy pie-chart DOM.
- **AC-2:** The modal header SHALL render the scope title ("All Metals — Portfolio" / "{Metal} — Detailed Breakdown") with the scope's 4px accent underline (`--primary` for All, metal token otherwise) and mono substats `{count} items · {oz} oz · since {Mon YYYY}`, where `{count}` is the sum of `qty` across active Items in scope (unit count, matching the dashboard totals cards) and `{oz}` is summed derived oz.
- **AC-3:** The KPI strip SHALL render five tiles — Purchase (sub: avg per-oz cost), Melt Value (sub per-metal: bought ±% vs spot now; sub for All: "at today's spot"), Retail Value, Unrealized (success/danger colored, sub: ±% vs purchase), Realized — computed from active Items in scope via `computeItemValuation`. **Unrealized** SHALL equal Σ `computeItemValuation().gainLoss` (retailTotal − purchaseTotal, matching the dashboard cards' Gain figure — distinct from the chart's melt-vs-basis gap). **Realized** SHALL sum realized gain from Disposition records in scope.
- **AC-4:** WHEN the modal closes, the modal SHALL destroy all Chart.js instances and disconnect its ResizeObserver (no "Canvas is already in use" on reopen; no orphaned observers).

### Portfolio series (US-1)

- **AC-5:** The portfolio series SHALL be computed from the Item ledger backdated to the scope's first dated acquisition: for each day *t*, melt(t) = Σ over Items held on *t* of derived-oz × purity × Spot Price(t), and basis(t) = Σ of purchase cost of Items held on *t*. **Date frame:** `item.date` and `disposition.date` are date-only `YYYY-MM-DD` strings and SHALL map verbatim to series day keys (string comparison, no Date-object timezone conversion). **Undated Items** (empty `date`) SHALL count as held from the series start (grill decision 3).
- **AC-6:** Derived oz SHALL route through the existing unit helpers — `getConstitutionalSilverOz` for `cu` (qty already included), Denomination conversion via `GB_TO_OZT`/`SB_TO_OZT` for `gb`/`sb`, and troy-oz passthrough otherwise — never raw `item.weight` for `gb`/`sb`/`cu`.
- **AC-7:** WHEN an Item has a Disposition dated *d*, the series SHALL exclude that Item's melt AND basis contributions for all days ≥ *d* (holdings view; grill decision 1). An undated Disposition SHALL exclude the Item from the entire series (never held, matching the active-Items KPIs).
- **AC-8:** Spot gaps SHALL fill per metal independently: a day with no Spot History sample for a metal carries forward that metal's most recent prior sample; days before a metal's first sample backward-fill from that first sample; a metal with no Spot History at all contributes 0 melt. The series SHALL never drop to zero or skip a day because of a data gap.

### Hero chart (US-1, US-2, US-3)

- **AC-9:** The chart SHALL render the melt-value series as the hero line (scope accent color, gradient fill) and the cost-basis series as a stepped muted line (default ON, toggleable via its series chip) — both on the left value axis.
- **AC-10:** WHILE the scope is a single metal, the chart SHALL render a Spot-per-oz overlay (dashed, `--info`, right axis; default ON, toggleable); WHILE the scope is All, the spot series-chip SHALL render disabled (with accessible disabled state) and no right axis SHALL render.
- **AC-11:** The chart SHALL provide range pills 30D / 90D / 1Y / ALL with 1Y default; WHEN a pill is selected, the chart and substrip SHALL re-render to that window (ALL = first dated acquisition − 14 days).
- **AC-12:** WHEN buy markers are on (default ON, toggleable), the chart SHALL render one marker per acquisition date in the window — including acquisitions of since-disposed Items (grill decision 4) — positioned on the melt line, radius scaled by that date's total purchase amount, filled with the per-metal token color when scope is All. Each series chip (basis, spot, buys) SHALL toggle its series and expose its on/off state via `aria-pressed`.
- **AC-13:** WHEN the pointer hovers the plot area, the chart SHALL show a crosshair and a tooltip with the UTC-framed date, melt, basis (if on), spot (if on), and ± vs basis; WHEN the pointer hovers a marker, the tooltip SHALL list that date's acquisitions; markers SHALL receive real pointer events (not be occluded by the hover surface).
- **AC-14:** WHEN a buy marker is clicked, the modal SHALL scroll the first matching active ledger row into view and flash every active row sharing that acquisition date; IF the date has zero active rows (all disposed), THEN the click SHALL be a no-op (grill decision 4).
- **AC-15:** The substrip SHALL show, for the selected window: **market gain** = Σ over window days of [Δmelt(day) − buy cost dated that day + melt-out value of Dispositions dated that day] (so buys and disposals are flows, not market movement), with % against end-of-window basis and the % suppressed when end-of-window basis is 0; **invested** = Σ purchase cost of acquisitions dated in the window; **buy count** = number of distinct acquisition dates in the window (equal to the marker count); and — per-metal scopes only — **pace** in oz/month.

### Composition (US-4)

- **AC-16:** The composition section SHALL render two panels — by metal (All scope) or by type (single metal), plus by purchase location — each as a stacked horizontal bar with single-line rows for the top 6 entries and a "+N more…" row beyond that. Entries SHALL rank by absolute value of the selected metric descending (Gain-Loss by |value|), tie-broken alphabetically by label, re-ranking when the metric changes.
- **AC-17:** The metric toggle (Purchase / Melt / Retail / Gain-Loss, default Melt) SHALL re-render both panels' bars and rows for the selected metric, with Gain-Loss values signed and success/danger colored.

### Ledger (US-3)

- **AC-18:** The ledger SHALL list active (non-disposed) Items in scope sorted by acquisition date descending — undated Items last with "—" for date (grill decision 3) — with columns Date | Item (type chip, plus metal dot when scope is All) | Qty | Paid | Melt now | ±% (grill decision 2).
- **AC-19:** WHEN a ledger row is clicked, the app SHALL open the existing Item View modal for that Item; WHEN "View all in Inventory →" is clicked, the app SHALL navigate to `#/inventory`.
- **AC-20:** On desktop, the ledger panel SHALL match the composition column's height exactly (scrolling internally); on mobile (≤768px) it SHALL flow naturally with columns reduced to Date | Item | Qty | ±%.

### States, themes, responsive, accessibility (US-5, US-6)

- **AC-21:** WHILE series data is being computed, the modal SHALL show skeleton placeholders (KPIs, chart, panels). IF the scope has zero active AND zero disposed Items, THEN the modal SHALL show the empty state — icon, "No {metal} items yet" (All scope: "No items yet"), and an Add Item CTA that opens the existing Add Item modal. IF the scope has zero active but ≥1 disposed Item, THEN the modal SHALL render normally — historical chart, zeroed holdings KPIs, nonzero Realized, and an empty ledger with a quiet "no active items" note (grill decision 5).
- **AC-22:** The modal SHALL render correctly in all four themes using CSS tokens only (no hardcoded colors in new CSS), and the hero chart SHALL render on mobile (the legacy hide-charts-on-mobile behavior applies only to the removed pies).
- **AC-23:** On viewports ≤768px, the layout SHALL stack to one column with the KPI strip at two columns, per the playground's narrow mode.
- **AC-24:** All interactive controls (range pills, series chips, metric toggle, ledger rows, close, empty-state CTA) SHALL be keyboard-operable with accessible names and states (`aria-pressed` on toggles, disabled state on the All-scope spot chip, ledger rows focusable and Enter/Space-activatable) and ≥44px touch targets on mobile; the KPI strip and ledger SHALL serve as the accessible equivalent of chart-only information (per the `.context/design-philosophy.md` accessibility baseline).

## Non-Goals

- **No dashboard totals-card sparkline redesign** — the playground's "bonus" section is a separate decision/issue.
- **No Variants B or C** — rejected in prototype review.
- **No per-item premium or what-if calculators** — competitive-research candidates, later.
- **No new persisted keys** — range/metric selections reset per open; persisting preferences is a possible follow-up.
- **No change to `showDetailsModal`'s public entry contract** — same global, same metal argument.
- **No money-weighted return math** — the substrip's market-gain figure uses the flow-adjusted daily chain defined in AC-15; proper MWR/TWR is out of scope.
- **No changes to the ticker or Spot Price cards.**

## Open Questions

_None — grill and reconcile complete, decisions recorded above._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch-discovery STRK-352`.

## Review Archive — requirements (2026-08-28)

### Resolution Summary

- **Accepted: 10 / 10** (7 mechanical pins; 3 resolved with user input — undated-Item policy, marker/ledger mapping, disposed-only-scope behavior).
- **Rejected: 0.**
- Code claims spot-verified against the live repo before applying: `js/events.js:1643-1645` (Date N/A → `date: ""`), `js/utils.js:1111-1132` (`gainLoss = retailTotal − purchaseTotal`), `js/inventory-table.js:1218-1223` (`totals.totalItems += qty`).
- Net changes: currency rule added to the AC preamble; AC-2 count pinned to summed units; AC-3 Unrealized pinned to `computeItemValuation().gainLoss`; AC-5 date-frame + undated policy; AC-7 undated-Disposition rule; AC-8 leading/no-data + per-metal fill; AC-9/10/12 chip defaults + `aria-pressed`; AC-12/14 disposed-marker + multi-match click semantics; AC-15 flow-adjusted market-gain chain + invested/buy-count/zero-denominator pins; AC-16 ranking rule; AC-21 three-state empty/disposed-only/loading; AC-24 (new) accessibility baseline.

### Original inline marks (verbatim)

> CODEX: `{count}` is ambiguous for multi-quantity Items. The live totals cards sum `qty` (`js/inventory-table.js:1218-1223`), while the glossary defines an Item as one record that may represent multiple identical pieces. Pin whether this substat counts active records or summed units so the header assertion cannot pass with either interpretation.

> CODEX: The production currency and Unrealized basis are not pinned. The prototype is explicitly EUR sample data, but the live app supports 17 `displayCurrency` values and converts through `formatCurrency` (`js/constants.js:418-436`, `js/utils-format.js:289-313`); the ACs also repeat literal `€` in the chart and substrip. Require every value/axis/unit label to follow the active display currency (or explicitly declare an incompatible EUR-only feature). Also state whether Unrealized means `computeItemValuation().gainLoss` (Retail minus Purchase in `js/utils.js:1111-1132`) or the hero chart's Melt-minus-basis gap.

> CODEX: The app deliberately supports an Item with no acquisition date through the Date N/A control (`js/events.js:1643-1645`), so "first acquisition" and whether an undated Item contributes to any day are undefined. The source issue also flags the UTC/local crossing, but no AC defines how date-only `item.date` and `disposition.date` values map to UTC series days. Add testable missing/invalid-date behavior and an explicit calendar-frame rule; otherwise two conforming implementations can shift or omit holdings differently.

> CODEX: Carry-forward defines only an interior gap with a prior sample. Pin the leading/no-data behavior when an acquisition predates the first sample or one metal has no usable sample, and phrase All scope as an independent carry-forward per constituent metal. Without that, AC-5 has no defined Melt Value for a supported data state.

> CODEX: The three optional series controls are underspecified. The approved prototype defaults Cost basis, Spot, and Buys on, but AC-9/10/12 only say "when toggled on" or "offer"; they do not require the chips to toggle, pin each open-state, or expose an accessible pressed/disabled state. Record those interaction defaults in the contract.

> CODEX: AC-12/14 conflict with AC-18 for historical holdings. A disposed Item contributes a historical acquisition marker until its Disposition, but the ledger intentionally excludes disposed Items, so a disposed-only marker has no matching row. A date marker can also group several acquisitions while AC-14 names one row. Define whether markers include disposed acquisitions and what click does for zero or multiple active matches.

> CODEX: This formula was proven only by the prototype's no-Disposition data. Once basis drops at a Disposition (AC-7), `basis(end) − basis(start)` becomes a net contribution/withdrawal and can be negative; if "invested" instead means buy spend, the disposed Melt Value is misclassified as market loss. Define the contribution/withdrawal convention, the displayed "invested" meaning, the zero end-basis denominator, and whether buy count means acquisition dates, Item records, or summed units.

> CODEX: "Top 6" has no ordering rule. Pin whether categories re-rank by the selected metric, whether Gain-Loss ranks by signed or absolute value (the prototype uses absolute value), and a stable tie-breaker; otherwise the visible rows and "+N more…" set are not deterministic.

> CODEX: A scope with only disposed Items satisfies "zero active" but still has historical series and a nonzero Realized KPI, all of which this rule suppresses. Confirm that loss of history is intentional, and pin the All-scope copy plus the Add Item CTA action (the current wording would permit "No All items yet" and a nonfunctional button).

> CODEX: No AC carries the project's accessibility baseline into the new interactive surfaces. Require keyboard operation and accessible names/states for range, series, metric, ledger-row, close, and CTA controls; retain the 44px mobile touch target; and provide an accessible equivalent for chart-only information. Pointer-only hover/click criteria are insufficient for the same workflows.

### CODEX Review (2026-08-28)

#### Verified

- Resolved the single active sketch folder and reviewed only `requirements.md`; the file is currently untracked in DocVault, so verification uses direct readback rather than a Git diff.
- Read the live Plane issue STRK-352 and confirmed the approved prototype is `playground/metal-detail-modal-playground.html`; PR #1475 is merged to `dev` at merge commit `4a385ba55304f80989bd08087ea88aa2ed24720e`.
- Checked the current modal entry/cleanup and mobile-pie behavior in `js/detailsModal.js:254-418`, the shell/CSS specificity in `index.html:3238-3274` and `css/styles.css:5217-5282`, and vendored Chart.js 3.9.1 in `vendor/chart.min.js:2`.
- Checked active-versus-disposed totals and quantity semantics in `js/inventory-table.js:1198-1254`, canonical Disposition detection in `js/constants.js:605-618`, Item View's index contract in `js/viewModal.js:77-93`, and valuation semantics in `js/utils.js:1092-1132`.
- Checked multi-currency support in `js/constants.js:410-439` and `js/utils-format.js:283-365`, supported undated Items in `js/events.js:1643-1645`, the Spot History files/data frame, and the prototype's no-Disposition series/window math in `playground/metal-detail-modal-playground.html:1325-1381,1435-1439,1632-1647`.
- Confirmed there is no dedicated existing Playwright coverage for `showDetailsModal` or `#detailsModal`; `tests/playwright/coverage-map.csv` remains the inventory boundary when the later implementation changes test inventory.

#### Top concerns

- The historical series contract does not define supported undated Items, date-frame normalization, or leading/missing Spot History.
- Disposition-aware window math is not defined after the newly settled basis drop, so "market" and "invested" can become misleading or contradictory.
- Historical/grouped buy markers cannot always map to the active-only, one-row click target required by the ledger criteria.
- Prototype EUR copy and ambiguous Unrealized semantics conflict with the live multi-currency valuation surfaces.
- Interactive chart and ledger behavior lacks the repository's keyboard, accessible-state, and touch-target requirements.

#### Unverified assumptions

- I did not infer the intended cash-flow treatment, disposed-marker fallback, or undated-Item policy; those are product decisions that must be reconciled into the requirements.
- I reviewed the approved prototype source and merged PR state but did not re-run a visual browser comparison; pixel-level implementation verification belongs to the later UI implementation/review gate.
