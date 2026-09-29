---
sketch: "STRK-352-metal-detail-modal"
phase: approach
created: 2026-08-28
---

# STRK-352 — Approach

_How we'll build it. Code and task ordering belong to the tasks phase._

## High-Level Architecture

Three layers, split so the hard math is Node-unit-testable and the DOM layer stays thin:

1. **Series computation — new `js/portfolio-series.js` (pure, no DOM).** Given `(items, spotDayMaps, scope, todaySpotPrices)`, builds the day-indexed holdings series per AC-5..AC-8 with these pinned boundaries:
   - **Series start** = first dated acquisition in scope **− 14 days** (the AC-11 ALL pre-roll is built into the series, not sliced later); range pills slice the tail. **All-undated fallback**: a non-empty scope with zero dated acquisitions starts at **today − 30 days** (flat line of undated holdings; the 30D pill covers it natively).
   - **Baseline day**: the fold emits one synthetic day before series start holding the pre-history portfolio (undated Items only, valued at the start day's spot). Window stats for a window starting at day _w_ always baseline against day _w−1_ (which therefore always exists), count flows on days [_w_..end], and buy count = distinct acquisition dates in [_w_..end] — so the first visible day's Δmelt is never dropped or misclassified.
   - Verbatim `YYYY-MM-DD` string day keys; per-item contribution interval `[acqDay, dispDay)`; undated-acquisition = held since series start; undated-Disposition = never held; derived oz via the existing unit helpers; per-metal carry-forward/backward-fill over the supplied day maps (no ceiling — `lookupHistoricalSpot` is explicitly NOT used, per discovery).
   - Window stats per AC-15: flow-adjusted market gain, invested, buy count, and **pace = Σ acquired oz on dates inside the window (regardless of later disposition) ÷ max(1/30, windowDays/30.44) months** — the prototype formula, adopted explicitly.
   - Everything here is a pure function of its inputs — TDD Cohort B targets this file with synthetic fixtures.

2. **Spot day-map assembly — small addition to `js/spot.js`.** A new async `getSpotDayMap(metalName, fromDayKey)` ensures the needed year files/seed years are in `historicalDataCache` (reusing `getRequiredYears`/`fetchYearFile`), merges cache rows with live `spotHistory`, and returns a `Map<dayKey, spotUSD>` of raw samples — no gap filling (that's the fold's job in layer 1, where it's testable). **Daily-close selection is pinned**: for each day, live rows beat seed rows, and among live rows the **latest timestamp wins, independent of input order** — the existing `getHistoricalSparklineData` dedup keeps the _first_ live row of a day (`js/spot.js:975-982`) and must not be copied verbatim, or a morning quote charts as the close. It lives in spot.js because `historicalDataCache` is file-scoped there.

3. **Modal orchestration — `js/detailsModal.js` full rewrite.** Same public contract (`showDetailsModal(metal)` / `closeDetailsModal`, same `#detailsModal`/`#detailsModalTitle`/`#detailsCloseBtn` ids so events.js wiring and the Escape chain are untouched). Open flow is two-phase: render shell + skeletons synchronously, `await` day-map assembly, then render chart/KPIs/panels/ledger — guarded by a render-generation counter so a close-during-load can't repopulate a stale modal (reusable-patterns discipline). Chart.js 3.9.1 renders the hero chart; composition bars and the ledger are plain DOM (like the playground).

## Key Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                            | Rationale                                                                                                                                                                                                    | Tradeoff                                                                                                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| D-1  | New `js/portfolio-series.js` (kebab-case per coding standards) for series math instead of inlining in detailsModal.js                                                                                                                                                                                                                               | Pure functions → Node unit tests carry the TDD load (fold, dispositions, fills, window math) without Playwright; detailsModal stays DOM-only                                                                 | One more global-scope file: dual registration (index.html + sw.js) and grep-unique top-level names required |
| D-2  | New async `getSpotDayMap` export in spot.js (latest-live-per-day close selection); fold stays in portfolio-series                                                                                                                                                                                                                                   | Reuses the only code that knows year files + cache + live merge; avoids a second cache; close semantics pinned in layer 2                                                                                    | Touches a hot file; must not disturb existing sparkline paths                                               |
| D-3  | Two-phase open (skeleton → data → render) with a render-generation guard                                                                                                                                                                                                                                                                            | AC-21 loading state is real (year files can fetch); guard kills stale async repopulation                                                                                                                     | More states to test than a blocking open                                                                    |
| D-4  | Chart x-axis is **index-based linear** (0..N−1) with `ticks.callback` labeling from the day-key array — not epoch-ms, not `type:'time'`                                                                                                                                                                                                             | Zero Date-object conversion (frame-safe by construction, AC-5); `type:'time'` throws without an adapter; matches the sparkline precedent; the filled series is uniform-daily so index spacing ≡ time spacing | Any future non-uniform series (e.g. intraday) would need rework                                             |
| D-5  | One chart, four datasets: melt line (gradient fill), basis stepped line, spot overlay on `y1`, buys as scatter with scriptable `pointRadius`/`pointHitRadius`                                                                                                                                                                                       | All native v3.9.1 (discovery-verified); one instance to destroy                                                                                                                                              | Scatter needs `{x,y}` objects and its own tooltip mode handling                                             |
| D-6  | External HTML tooltip (one reusable positioned div) built **exclusively via `createElement`/`textContent`** — Item names and any user/import-controlled strings never pass through `innerHTML` (house sanitization policy)                                                                                                                          | AC-13's multi-line acquisition lists need real markup; canvas callbacks can't; XSS boundary pinned                                                                                                           | Manual show/hide/position lifecycle to get right                                                            |
| D-7  | Chart colors resolved at render via `getThemeColorRGB`/`getChartColors`; re-render on `currencychange` (event exists) and on theme switch via a **guarded direct call added to `setTheme` in js/theme.js** (`window._refreshDetailsModalTheme?.()` — the same pattern as its existing `updateAllSparklines` call; no theme event exists in the app) | Chart.js cannot parse oklch (prior PR-review catch); currency rule (AC preamble); theme refresh gets a real, owned mechanism                                                                                 | js/theme.js joins the file map (one guarded line)                                                           |
| D-8  | Final series day = **today, valued at live `spotPrices`** (per metal); earlier days at daily closes (latest live sample per day, per layer 2)                                                                                                                                                                                                       | Grill decision 3 promises chart-end ≡ KPI totals; daily closes alone lag live spot intraday                                                                                                                  | The last point mixes frames deliberately — commented at the site per coding standards                       |
| D-9  | KPIs computed from active Items via `computeItemValuation` (dashboard parity), never from the series                                                                                                                                                                                                                                                | AC-3 pins Unrealized = retail−purchase; matches `_accumulateItemTotals` semantics users already see                                                                                                          | Two computation paths for melt (KPI live vs series daily) — reconciled by D-8's final point                 |
| D-10 | Composition + ledger are plain DOM; `createPieChart` is deleted from charts.js (its only callers die with the pies); `getChartTextColor`/`getChartBackgroundColor`/`generateColors` stay                                                                                                                                                            | Bars are divs in the approved prototype; no chart instance overhead; other charts.js helpers have live consumers                                                                                             | None real — the pies have no other users                                                                    |
| D-11 | Ledger uses delegated click + keydown on its container with `data-uuid` rows; index resolved late (`findIndex`) into `showViewModal(index)`                                                                                                                                                                                                         | Rows re-render per open — delegation avoids per-row listeners (spot-ratio-chips precedent); late resolution survives inventory mutation                                                                      | uuid→index scan per click (trivial N)                                                                       |
| D-12 | CSS: add the `dm-` block from the playground delta; retire `.details-grid`/`.details-panel`/`.breakdown-*`/`.chart-canvas-*`; rewrite the `#detailsModal` ID rules; **remove the STACK-70 hide rules** (`css/styles.css:14082-14087`); add `.dm-seg` variant (base `.chart-metric-toggle` untouched — sole consumer anyway)                         | Playground delta is the approved spec; STACK-70 rules would blank the chart+toggle on mobile (AC-17/22)                                                                                                      | Largest CSS diff of the sketch; four-theme regression surface                                               |
| D-13 | Realized KPI always renders (user-confirmed); computed by summing `disposition.realizedGainLoss                                                                                                                                                                                                                                                     |                                                                                                                                                                                                              | 0`over disposed Items in scope, formatted via`formatCurrency`                                               | Discovery: `showRealizedGainLoss` is dashboard-scoped; `_writeRealizedCell` hardcodes `"$0.00"` and must not be copied | Diverges from dashboard visibility behavior by design |
| D-14 | Skeletons: net-new minimal `.dm-skel` shimmer keyframe, `prefers-reduced-motion` fallback to static blocks                                                                                                                                                                                                                                          | No precedent exists (discovery); AC-21 requires a loading state                                                                                                                                              | New animation CSS to theme-check ×4                                                                         |
| D-15 | Empty-state CTA activates the existing **`#newItemBtn` click path** (`safeGetElement("newItemBtn").click()` — the card-view precedent), never `openModalById("itemModal")` directly                                                                                                                                                                 | The live handler clears edit/picker state and resets the form (`js/events.js:4587-4667`); bypassing it can expose stale edit data                                                                            | CTA depends on the button existing (it always does in the shell)                                            |
| D-16 | Footer provenance line reuses the app's existing last-sync surface (the same store the spot cards' "Last API Sync" line reads) with neutral copy — "Local data · Spot: {provider label} · Last sync {value}"; no per-day seed/live provenance claims                                                                                                | `getSpotDayMap` returns only day/price pairs; claiming per-sample provenance would be untruthful for mixed seed/live data                                                                                    | Footer says less than the playground's mock copy — honest over ornate                                       |

## File Map

### New

- `js/portfolio-series.js` — pure series/window/buys math (D-1); registered in `index.html` script block (after utils/constants, before detailsModal) **and** `sw.js` CORE_ASSETS in matching order
- `tests/unit/portfolio-series.test.js` — Cohort B unit spec for the fold
- `tests/playwright/core/details-modal.spec.js` — modal behavior spec (open/close, states, interactions, a11y). **New-domain justification (required by the destination policy):** no existing domain suite owns `showDetailsModal`/`#detailsModal` (zero current coverage — discovery); `valuation` owns item-level math, not modal UI. Responsive/mobile assertions do NOT go here — they land as additions to the existing `mobile-and-layout` suite. This justification line goes in the PR body verbatim.
- `tests/playwright/coverage-map.csv` rows for the new file + the `mobile-and-layout` additions

### Modified

- `js/detailsModal.js` — full rewrite (shell render, two-phase open, chart config, composition, ledger, states, cleanup)
- `js/spot.js` — add `getSpotDayMap` (async ensure+merge; latest-live-per-day close; no fill) alongside existing cache internals
- `js/charts.js` — delete `createPieChart` only; keep the other exports (live consumers)
- `js/theme.js` — add one guarded call in `setTheme`: `window._refreshDetailsModalTheme?.()` (D-7)
- `index.html` — replace the `#detailsModal` inner markup (`:3238-3276`) with the Variant A shell; add the portfolio-series script tag
- `sw.js` — CORE_ASSETS entry for portfolio-series.js
- `css/styles.css` — dm- block (from playground delta); retire legacy pie-layout family (`7883-8010`); rewrite `#detailsModal` ID rules (`5217-5225, 5276-5282`); remove/replace STACK-70 hide rules (`14081-14105` subset); mobile stacking rules
- `js/init.js` — drop dead `typeChart`/`locationChart` element caches (`:419-420`); keep the rest of the modal element wiring
- `js/state.js` — (optional, documentation-only) note new chart key on `chartInstances`; not a prerequisite (discovery correction)
- `tests/playwright/core/mobile-and-layout.spec.js` — responsive assertions for the modal (AC-20/23 mobile columns, stacking)

### Deleted

- _No whole files._ (`createPieChart` and the pie canvases go, but their host files remain.)

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. Range/metric/series-chip selections are per-open state (Non-Goal). All new reads come from existing stores (`inventory`, `spotHistory`, year files, `spotPrices`, display currency).

## Tradeoffs Surfaced for Review

- **D-4 index-x** trades future intraday flexibility for frame safety and adapter-free rendering. If an intraday portfolio view ever ships, the axis strategy gets revisited.
- **D-8 synthetic today point** knowingly mixes the daily-close frame with live spot for the final sample to honor "chart end = KPIs". The alternative (pure closes) shows a stale right edge all day.
- **Performance envelope**: the fold is O(items × days). Realistic worst case (~400 line items × ~2,000 days for a 5-year ALL range) ≈ well under 1M simple ops — no memoization needed for v1; recompute per open/range switch. If ALL ranges ever span decades with thousands of items, memoize per scope.
- **spot.js surface**: `getSpotDayMap` must be additive — zero behavior change to sparkline/ratio paths (their tests are the regression net).

## UI Contract

_The binding specification for design fidelity. An implementer who follows the tasks but ignores this contract has not completed the work._

### Mockup Artifacts

| Artifact                                       | Path / URL                                                        | What it defines                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approved Variant A prototype (pixel authority) | `playground/metal-detail-modal-playground.html` (merged PR #1475) | Layout, spacing, the full `dm-` delta-CSS spec, chart visual language, all interactive behaviors, loading/empty states, mobile narrow mode, four themes |
| Copy-prompt block inside the playground        | same file, `updatePrompt()` output                                | Prose restatement of every approved decision                                                                                                            |

### Named States / Screens

| State                            | Description                                                                                                          | Mockup reference                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Populated — All Metals (desktop) | 5 KPIs, chart w/o spot overlay (chip disabled), By Metal + By Purchase Location, full ledger w/ metal dots           | Playground: preset "Recommended · Story / dark / All"                     |
| Populated — single metal         | Spot overlay on right axis, By Type panel, pace stat in substrip                                                     | Playground: Scope=Silver                                                  |
| Range switching                  | 30D/90D/1Y/ALL re-render chart + substrip                                                                            | Playground: range pills                                                   |
| Series toggles                   | basis/spot/buys chips toggle datasets, `aria-pressed`, dimmed off-state, disabled spot on All                        | Playground: series chips                                                  |
| Marker → ledger sync             | Click marker → scroll + flash matching active rows; no-op when none                                                  | Playground: marker click                                                  |
| Loading                          | Skeleton blocks for KPIs, chart, panels                                                                              | Playground: State=Loading                                                 |
| Empty (nothing ever)             | `.empty-state` icon/copy/CTA ("No {metal} items yet" / "No items yet" for All; CTA activates `#newItemBtn` per D-15) | Playground: State=Empty                                                   |
| **Disposed-only scope**          | Normal render: historical chart → 0, zeroed holdings KPIs, nonzero Realized, empty ledger + quiet note               | **No playground reference — spec'd by AC-21 text (added post-prototype)** |
| Mobile ≤768px                    | One column, KPI strip 2-col, ledger slims to Date/Item/Qty/±%, chart renders                                         | Playground: Width=Mobile                                                  |
| Four themes                      | dark/light/slate/sepia, tokens only, chart colors rgb-resolved per theme                                             | Playground: Theme picker                                                  |

### Component / Token Requirements

- `dm-` class family exactly as in the playground delta CSS (`.dm-topbar`, `.dm-header[data-accent]`, `.dm-kpis`/`.dm-kpi*`, `.dm-chart-card`, `.dm-series-chip[data-on]`, `.dm-substrip`, `.dm-comp-*`, `.dm-panel`, `.dm-ledger*`, `.dm-lrow`, `.dm-grid--ledger`, `.dm-ledger-fill`, `.dm-foot`, `.dm-empty` semantics via existing `.empty-state`, `.dm-skel`, `.dm-flash`)
- `.chart-metric-toggle.dm-seg` hugging variant (padding 0, no bg, static, overflow hidden); base class untouched
- Metal accent tokens (`--silver`…`--copper`, `--primary` for All); `--type-*` chip tokens in the ledger; `--info` for spot; `--text-muted` for basis; success/danger for signed values
- Chart colors resolved through `getThemeColorRGB`/`getChartColors` — never raw token strings into Chart.js
- All money through `formatCurrency`; weights via existing formatting; dates in the ledger as stored `YYYY-MM-DD` strings ("—" for undated)
- Footer provenance per D-16: existing last-sync surface, neutral copy, no per-sample seed/live claims

### Interaction Contract

- Close button on its own top row (static position), then serif header — never overlapping substats
- Segmented controls hug their buttons (no padded box) — range pills and metric toggle
- Ledger panel absolute-fills its grid cell to match the composition column height, scrolling internally (desktop); natural flow + own scroll cap on mobile
- Ledger row click / Enter / Space → existing Item View modal for that Item; "View all in Inventory →" → `activateTab("inventory")`
- Marker click → scroll first matching active row into view + flash all rows sharing the date (`.dm-flash`); zero active matches → no-op
- Crosshair hover never occludes marker interactivity (markers sit above the hover surface — the playground's post-review fix)
- Tooltip DOM built with `createElement`/`textContent` only — Item names and imported fields are unsafe for raw `innerHTML` (D-6; house sanitization policy)
- Keyboard: every control operable, `aria-pressed` on toggles, disabled state on All-scope spot chip, rows `tabindex="0" role="button"` with `ACTIVATE_ON_KEY` semantics, ≥44px touch targets on mobile (AC-24)

## Out of Scope (follow-up issues)

- Dashboard totals-card sparkline redesign (playground bonus section) — separate issue when wanted
- Persisting range/metric/chip preferences — possible follow-up
- Intraday portfolio view / non-uniform x-axis — revisit D-4 if ever wanted
- Money-weighted/time-weighted return math — AC-15's flow-adjusted chain is the shipped semantics

## Risk Notes

- **spot.js regression risk** → mitigation: `getSpotDayMap` purely additive; sparkline/ratio Playwright specs are the net; no changes to existing functions.
- **Chart.js gradient scriptable** requires the `if (!chartArea) return` guard + resize-keyed cache (discovery) → encode in implementation, verify on resize. External-tooltip, mixed hit-testing, and gradient caching remain implementation-time validations (no throwaway prototype was built).
- **Year-file fetch failure** (offline, file://) → day map falls back to whatever the cache/seed holds; AC-8's fill rules keep the series defined; footer provenance stays truthful per D-16.
- **Theme switch while modal open** → handled by the D-7 `setTheme` guarded call (`js/theme.js` joins the file map); verify during visual QA (all four themes).
- **Playground green ≠ integration green** (STRK-282 lesson) → CLOSE-3 visual verification runs in the real app shell, per named state above.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch-tasks STRK-352`.

## Review Archive — approach (2026-08-29)

### Resolution Summary

- **Accepted: 7 / 7 inline marks** + 2 gaps folded from the review's Unverified Assumptions (provenance-footer contract → D-16; pace denominator → pinned in layer 1). **Rejected: 0. User input: 0** (all resolutions follow verified house patterns; no product decisions were at stake).
- Key resolutions: series boundary pinned (−14d pre-roll in the series, synthetic baseline day, all-undated fallback = today−30d); daily close = latest live sample per day (the existing first-live-row dedup must not be copied); filename → `js/portfolio-series.js`; new core spec justified as a new product domain with responsive assertions routed to `mobile-and-layout`; empty CTA via `#newItemBtn`; tooltip XSS boundary pinned; theme refresh via a guarded `setTheme` call with `js/theme.js` added to the file map.
- Review claims verified against the repo before applying: `.context/coding-standards.md` naming table + test destination policy, `js/theme.js:11-25` (no event; direct guarded calls), `js/events.js:4587+` (newItemBtn state reset), `js/spot.js:969-984` (first-live-row-wins dedup).

### Original inline marks (verbatim)

> CODEX: The series boundary is incomplete in two load-bearing cases. AC-11 requires ALL to begin 14 days before the first dated acquisition, while this starts on the acquisition day; AC-15 also needs the sample immediately before every selected window so the first visible day's `Δmelt` is not dropped or misclassified. More fundamentally, a scope containing only active undated Items has no "first dated acquisition," yet AC-21 says it must render rather than take the empty state. Pin the fallback start day and the warm-up/pre-roll contract here so tasks cannot invent incompatible behavior.

> CODEX: "Live-over-seed" does not define the required daily close. The cited implementation sorts ascending and keeps the first non-seed row for a day (`js/spot.js:969-984`), whereas D-8 explicitly says historical points use daily closes; `spotHistory` can contain multiple intraday samples per day. Require an explicit latest-timestamp-per-day selection (independent of input order), while still giving live rows precedence over seed rows, or the last 180 days can chart a morning quote as the close.

> CODEX: Rename this file consistently to `js/portfolio-series.js`. The binding/functions can remain camelCase, but project coding standards require file names to be kebab-case (`.context/coding-standards.md:43-53`), and the current name would add another legacy-style exception.

> CODEX: The File Map prescribes a new core suite, but the test policy routes valuation/chart behavior to the existing `valuation` domain suite and responsive assertions to `mobile-and-layout`, permitting a new core file only with an explicit "new product domain" or split justification (`.context/coding-standards.md:613-627`). Either map the cases into those suites or record the required justification here; deferring the boundary to tasks leaves a file-map/test-policy conflict.

> CODEX: "Opens Add Item modal" must route through the existing `#newItemBtn` activation path, not call `openModalById("itemModal")` directly. The live button handler clears edit state and pending picker state, resets form/defaults, sections, price/history/image controls, and only then opens the modal (`js/events.js:4587-4667`); bypassing it can expose stale edit data from the empty-state CTA.

> CODEX: D-6 chooses an external HTML tooltip whose marker content includes user/import-controlled Item names, but the approach never specifies a safe rendering boundary. Require DOM construction with `textContent` or `sanitizeHtml` at every user-content interpolation; the project policy explicitly treats Item names and imported fields as unsafe for raw `innerHTML` (`.context/coding-standards.md:147-182,218-220`).

> CODEX: No such shared theme event exists. `setTheme()` directly calls `updateAllSparklines()` and dispatches no event (`js/theme.js:11-25`); only currency changes emit `currencychange` (`js/utils-format.js:319-341`). D-7's currency subscription therefore cannot re-resolve an open chart's canvas colors after a theme switch, and the File Map omits `js/theme.js`. Pin an actual mechanism and its file ownership (for example, a new `themechange` event consumed by the modal) before tasks.

### CODEX Review (2026-08-29)

#### Verified

- Read the reconciled requirements, discovery, live Plane issue, approved playground, universal/project sketch conventions, design/testing/coding guidance, and the live style-guide patterns.
- Traced the existing modal entry/close/Escape wiring and Add Item initialization path in `js/detailsModal.js`, `js/events.js`, `js/init.js`, `js/state.js`, and `js/utils.js`.
- Verified the Spot History cache/year-file/live merge behavior in `js/spot.js`, including the current first-live-row daily dedup behavior and seed-bundle cache population.
- Verified derived-weight and valuation behavior (`getConstitutionalSilverOz`, `getUnitOztWeight`, `computeMeltValue`, `computeItemValuation`) and the current Chart.js ownership/teardown helpers.
- Checked the proposed file map against the real script/CORE_ASSETS order, test destination policy, coverage map, CSS specificity/mobile hide rules, four-theme implementation, and `activateTab("inventory")` hash behavior.

#### Top concerns

1. The series contract omits ALL's 14-day pre-roll, the prior-day sample needed for correct window `Δmelt`, and any start-day fallback for an all-undated non-empty scope.
2. The proposed Spot History merge does not guarantee daily closes; its cited precedent keeps the first live sample of a day, contradicting D-8.
3. Theme switching cannot work as claimed because the live app emits no theme event and the approach assigns no owner for adding one.
4. The external HTML tooltip lacks the mandatory user-content sanitization boundary.
5. The empty-state CTA can reopen stale edit state unless it reuses the full `#newItemBtn` initialization path.
6. The new production filename violates the kebab-case rule, and the new Playwright file lacks the required existing-suite-versus-new-domain decision.

#### Unverified assumptions

- The approach's provenance footer has no defined data contract: `getSpotDayMap` returns only day/price pairs, so I could not verify how "Spot: … · Last sync …" will remain truthful for mixed seed/live data or non-StakTrakr Spot Providers.
- AC-15/approach still do not define the exact pace denominator or whether acquisitions later disposed inside the selected window count toward pace; the prototype uses acquired oz divided by `max(1/30, windowDays/30.44)`, but that sample-data behavior is not explicitly adopted here.
- I did not build a throwaway Chart.js prototype for the external-tooltip, mixed scatter/line hit-testing, or resize-keyed gradient configuration; those advanced mechanics remain implementation-time validations.
