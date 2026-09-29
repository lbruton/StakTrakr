---
sketch: "STRK-161-spot-card-ratio-chips"
phase: approach
created: 2026-06-07
---

# STRK-161 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The feature is a **pure display layer** over data the app already holds (`spotPrices` and the cached goldback G1 rate) — no new data source, endpoint, or persisted schema. A new self-contained module **`js/spot-ratio-chips.js`** owns three things: (1) the ratio/goldback math, (2) a single idempotent **`renderRatioChips()`** that creates/updates/removes one `.spot-ratio-chip` element per spot card, and (3) a body-appended `position: fixed` tooltip singleton. It exposes window globals (script-tag pattern) so existing render paths can invoke it without imports.

The chip render is driven through **one choke point invoked from every existing spot/goldback DOM-write path** — the central finding of the reconciled discovery. `renderRatioChips()` re-reads current state and re-paints all four chips on each call, so it is safe to drop the same idempotent call at the tail of each path: `js/spot.js` (API/manual/cache branches), `js/api.js` (`refreshFromCache`, save/test, `syncAllProviders`, reset), and the goldback paths (`onGoldSpotPriceChanged`, `fetchGoldbackApiPrices`, and the `js/settings-listeners.js:343-404` source-switch). Missing any one leaves a stale chip on that path (AC-8/AC-9), so the call-site list is a checklist, not a suggestion.

Visibility is layered: a new localStorage master toggle ("Show spot ratios", default ON, via `wireStorageToggle`) gates all four chips; the **gold card chip additionally** respects `goldbackPricingSource` (off → hidden) and a freshness guard `(now − data.ts) > stale_after`. Because `fetchGoldbackApiPrices` currently **discards** `data.ts`/`stale_after` (discovery OQ-1), the goldback fetch is extended to retain them on the cached G1 entry — the only change that reaches into the goldback engine.

## Key Decisions

| # | Decision | Rationale | Tradeoff (the loser) |
|---|----------|-----------|----------------------|
| D-1 | **New module `js/spot-ratio-chips.js`** rather than growing `js/spot.js` | Feature is cross-cutting (callers in spot.js, api.js, goldback.js, settings-listeners.js); a dedicated module is isolatable + unit-testable and keeps the already-large spot.js untouched in structure | One more script tag to order + cache in `sw.js`; the render logic lives apart from the spot writes that trigger it |
| D-2 | **Single idempotent `renderRatioChips()` choke point**, called at each render-path tail (not per-branch inline) | Discovery proved ≥7 spot write sites across spot.js+api.js plus 3 goldback paths; one re-read-all-and-repaint fn keeps every path in sync and makes the call sites a verifiable checklist | ~10 one-line call-site edits across 4 files; a full repaint (4 chips) on every spot tick instead of surgical per-metal updates (cost is trivial — 4 tiny DOM writes) |
| D-3 | **Extend `fetchGoldbackApiPrices` to persist `data.ts` + `stale_after`** on the cached G1 entry (OQ-1 option a) | AC-5/AC-6 define staleness as *source-generation* time (`now − data.ts > stale_after`); only the envelope's own fields can express that. Change is **additive** (new fields; existing `{price, updatedAt, source}` untouched) | Touches `js/goldback.js` — the AC-16 regression surface. Rejected option (b) "approximate from client `updatedAt`" measures *when we fetched*, not when the source generated → fails the AC's stated semantics |
| D-4 | **JS-positioned `position: fixed` tooltip singleton** (appended to `<body>`), shown on hover AND focus | Verified in the playground: `.spot-card { overflow: hidden }` clips any card-local `::after` bubble, and native `title=""` never fires on keyboard focus — both fail AC-13 | More JS (position + flip-if-no-room + hide-on-scroll) than a pure-CSS bubble; one shared element to manage |
| D-5 | **"Own row" chip placement** (normal flow, centered between `.spot-card-change` and `.spot-card-timestamp`) | User-approved from the playground. Zero collision with the centered timestamp; hidden chip → row collapses (no reserved gap); avoids `backdrop-filter` entirely | Adds one row of height to every spot card (offset by D-8's timestamp-block merge) → still a dashboard layout-regression target |
| D-6 | **Reuse `wireStorageToggle` + `.chip-sort-btn` yes/no container** for the toggle; new key `SPOT_RATIOS_KEY` in `constants.js` + `ALLOWED_STORAGE_KEYS` | Matches the Currency panel's existing control vocabulary (discovery); `onApply` is the live AC-11 show/hide hook; allowlist entry prevents `cleanupStorage` from purging the key | Toggle is a pill yes/no, not a checkbox — must follow that markup shape, not improvise |
| D-7 | **Tokens-only styling**, pill grammar borrowed from `.trade-linked-chip`; metal accent via `--silver/--platinum/--palladium` + `--type-goldback-bg`; `~EST` marker uses `--warning` | AC-14 four-theme legibility; metal tokens are already WCAG-tuned per theme; inline SVG glyph uses `stroke="currentColor"` so it inherits theme color | No bespoke per-theme hex — any hardcoded color is a defect |
| D-8 | **Merge the spot-card source/provider name onto the same row as the "Last API Sync" time** (one line, e.g. `StakTrakr · Last API Sync …`) instead of the current two `<br>`-stacked lines | User-approved 2026-06-07 (playground-vs-live comparison). Reclaims one vertical line to offset D-5's added chip row → net card height ≈ flat, preserving the 4-up grid rhythm; all timestamp info (provider + time) retained | Intentionally touches AC-16's "preserve timestamps" surface — a visual reflow of `getLastUpdateTime` (`js/utils.js:339`), not a data change; the per-line source/time split is lost |
| D-9 | **Responsive timestamp block** — below the `<960px` grid breakpoint, hide the provider name and shorten the label to `Last Synced {time}`; the full `provider · Last API Sync {time}` returns at desktop width. Provider stays discoverable via `title`/tooltip | D-8's one-line merge truncates at mobile 2-col (observed: `StakTrakr · Last API Sy…`). Sync time is need-to-know, provider nice-to-know → shed the decorative half where space is scarce. Extends AC-15's no-overflow intent to the line D-8 widened | Provider not visible at a glance on mobile (by design); pure-CSS media query (no JS) but adds responsive `<span>` markup to `getLastUpdateTime` |

## File Map

_Every file this sketch will create, modify, or delete. `tasks.md` cross-checks against this map. Test placement follows the reconciled discovery's **Tests & coverage map**: extend existing core/extended specs + add a `coverage-map.csv` delta — **no new root or issue-prefixed Playwright spec.**_

### New
- `js/spot-ratio-math.js` — **math layer** (split from chips for the Codacy per-file complexity gate; loads first): `computeRatio` (`gold ÷ metal`), `formatRatio`, `isGoldbackStale`, `resolveGoldbackRate` (+ internal `readFreshCachedGoldback` / `readGoldbackSpotEstimate`). Window-exposed globals. _(Split added at PR review — Codacy file-complexity gate.)_
- `js/spot-ratio-chips.js` — **render layer**: `renderRatioChips()` / `renderRatioChip(metalKey)`, chip create/update/remove (own-row), `.spot-ratio-chip-spacer` alignment, `position:fixed` tooltip singleton, keyboard-focus wiring. Reads the math globals bare. Window-exposed render globals.
- `playground/STRK-161-spot-ratio-chips.html` — **already created + approved 2026-06-07** (UI Contract artifact; not production code).
- `tests/unit/spot-ratio-chips.test.js` _(or the project's unit-test home)_ — pure-function coverage: ratio math, decimal formatting, `Infinity`/`NaN` guard, staleness `(now − data.ts) > stale_after`, estimate fallback selection.

### Modified
- `index.html` — (1) `<script>` tag for `js/spot-ratio-chips.js` in correct load order (after `spot.js`/`goldback.js`/`init.js`); (2) "Show spot ratios" toggle in the Currency & Pricing panel (~5585) using the `.chip-sort-btn` yes/no container. _(Tooltip element is JS-created on `<body>` — no markup here.)_
- `js/spot.js` — `renderRatioChips()` call at each render-path tail (`fetchSpotPrice` 451, `updateManualSpot` 503, `updateSpotChangePercent` 1086, and the cache/sync DOM-write branches).
- `js/utils.js` — (D-8) `getLastUpdateTime` (339) joins provider + `Last API Sync` time onto **one line** (`${sourceLine} · ${timeLine}`) instead of `<br>`-separated, reclaiming card height for the chip's own row. (D-9) wrap the provider in `<span class="ts-provider" title="…">` and emit full/short label spans so CSS can hide the provider + swap `Last API Sync`→`Last Synced` below 960px. Preserve the existing cache↔api toggle behavior and the "Seed"/"Shift+click" hint branches.
- `js/api.js` — `renderRatioChips()` call in `refreshFromCache` (1177-1214), save/test (2151-2175), `syncAllProviders` (2267-2297), reset (2625-2646).
- `js/goldback.js` — (D-3) extend `fetchGoldbackApiPrices` (420) to persist `data.ts` + `stale_after`; add `renderRatioChips()` call in `onGoldSpotPriceChanged` (387).
- `js/settings-listeners.js` — `renderRatioChips()` call in the goldback pricing-source switch handler (343-404), so the gold chip hides live on switch-to-`off` (AC-7).
- `js/settings.js` — wire the new toggle via `wireStorageToggle(..., { defaultVal: true, onApply: renderRatioChips })` in settings init.
- `js/constants.js` — add `SPOT_RATIOS_KEY = "show-spot-ratios"` (595-area) and register it in `ALLOWED_STORAGE_KEYS` (939).
- `css/styles.css` — `.spot-ratio-chip` (own-row layout), glyph, `~EST` marker, and tooltip styles; four-theme via tokens only. Plus a `@media (max-width: 959px)` rule (D-9) hiding `.ts-provider` + the full label and showing the short `Last Synced` label.
- `sw.js` — register/cache `js/spot-ratio-chips.js` + bump cache version (pre-PR `/pr-ready` checks this).
- `tests/playwright/core/smoke.spec.js` — chip presence + per-path live-update smoke (API sync, manual edit).
- `tests/playwright/core/settings-api.spec.js` — toggle in Currency panel (default ON, persist, live show/hide AC-11/12) alongside the existing Goldback controls test (125-155).
- `tests/playwright/extended/visual-layout-regressions.spec.js` — four-theme chip legibility + own-row card-height regression.
- `tests/playwright/coverage-map.csv` — add the STRK-161 coverage delta row(s).

### Deleted
- _None._

## Data / Schema Changes

- **No persisted schema/migration.** The only persisted addition is the localStorage key `show-spot-ratios` (`'true'/'false'`), registered in `ALLOWED_STORAGE_KEYS`.
- In-memory only: each `goldbackPrices[key]` cache entry gains `ts` + `staleAfter` (from the API envelope). No backfill needed — recomputed on the next hourly fetch; absence is treated as "unknown freshness" → conservative hide in `api` mode.

## Tradeoffs Surfaced for Review

- **D-3 reaches into `js/goldback.js`** (the AC-16 regression surface) to make staleness honest. The alternative (client-fetch-time approximation) keeps the engine untouched but silently weakens AC-5/AC-6 semantics. Flagging because "don't touch the goldback engine" is otherwise the safe default — here the AC wording forces it.
- **D-5 grows every spot card by one row.** Accepted for collision-safety, but it's a visible dashboard change; if the added height reads as too heavy in practice, the fallback is the absolute lower-left placement (already prototyped) — a CSS-only swap, no logic change.
- **D-8 reflows the timestamp block** (provider + sync-time → one line). A deliberate, user-approved change to existing spot-card rendering that AC-16 otherwise says to "preserve" — flagged so review signs off explicitly. No timestamp data is lost (provider and time both still shown); only the two-line layout changes. With D-5, net card height stays ≈ flat.
- **D-9 hides the provider on mobile.** Chosen over shrinking the font or letting the line truncate — the provider is decorative vs. the sync time. Folded into STRK-161 (not a follow-up issue) because D-8 is what introduced the mobile truncation; shipping D-8 without D-9 would ship a visible mobile paper-cut. Provider stays available via `title`/tap affordance.

## UI Contract

_Binding spec for design fidelity. Tasks and tests trace here, not to AC prose alone._

### Mockup Artifacts

| Artifact | Path | What it defines |
|----------|------|-----------------|
| Spot ratio chips playground | `playground/STRK-161-spot-ratio-chips.html` | **Approved 2026-06-07.** All four themes; all chip states; own-row placement; tooltip-clip proof (JS-fixed vs CSS-inside); estimate marker; mobile 2×2 |

### Named States / Screens

| State | Description | Mockup reference |
|-------|-------------|------------------|
| Populated | 4 chips: `Au:Ag 63.8`, `GB $8.68`, `Au:Pt 2.43`, `Au:Pd 3.53` | default load |
| Goldback off | gold-card chip absent; 3 ratio chips remain (AC-7) | gb mode = off |
| Goldback api + stale | gold-card chip absent (AC-6) | gb api + cache stale |
| Goldback spot/manual + stale | gold-card chip = `computeGoldbackEstimatedRate`, with `~EST` marker (AC-5) | gb spot + cache stale |
| Invalid spot | that card's ratio chip absent, never `Infinity`/`NaN` (AC-3) | silver ≤ 0 toggle |
| Master off | all four chips absent (AC-12) | master toggle off |
| Loading | chips absent during skeleton; appear once data lands | loading toggle |
| Hover / Focus | tooltip shown above chip (flips below if no room), on pointer hover AND keyboard focus (AC-13) | focus a chip |
| Mobile (<960px) | 2×2 grid; timestamp shows `Last Synced {time}` only (provider hidden — no truncation); chip stays centered in its own row (AC-15, D-9) | mobile width toggle |

### Component / Token Requirements

- `.spot-ratio-chip` — pill grammar from `.trade-linked-chip`: `display:inline-flex`, `gap:4px`, `border-radius: var(--radius-pill)`, `font-size: var(--font-size-xs)`, `font-family: var(--font-mono)`.
- Metal accent via `--metal` set per card to `var(--silver)` / `var(--platinum)` / `var(--palladium)` / `var(--type-goldback-bg)`; value text in `var(--text-primary)`; border `var(--border)`.
- `~EST` marker in `var(--warning)`. Focus ring `var(--primary)` + `var(--focus-ring)`.
- Glyph: inline SVG, ~12px, `stroke="currentColor"` (balance-scale for ratios, banknote for goldback). **No hardcoded hex anywhere.**
- Toggle: `.chip-sort-btn` yes/no container (NOT a checkbox), wired by `wireStorageToggle`.

### Interaction Contract

- Chip sits in its **own centered row** between `.spot-card-change` and `.spot-card-timestamp`; when hidden it is **removed** (row collapses) — never `visibility:hidden` leaving a gap.
- Tooltip is a **single `<body>`-appended `position:fixed` element** (escapes `.spot-card { overflow:hidden }`); shown on `mouseenter`+`focus`, hidden on `mouseleave`+`blur`; repositions/ hides on scroll; flips below the chip when there's no room above.
- Chip is `tabindex="0"` and exposes the explanation via `aria-describedby` → the tooltip (or `aria-label`). **Static — no click handler** (no toggle, no inverse view).
- The toggle's `onApply` re-runs `renderRatioChips()` for live (no-reload) show/hide.
- The spot-card bottom block shows **provider + "Last API Sync" time on a single line** (below the chip's own row), not two stacked lines (D-8).
- **Below 960px** the bottom block collapses to **`Last Synced {time}`** (provider hidden, label shortened) so it never truncates in the 2-col grid; provider remains as a `title`/tooltip (D-9).

## Out of Scope (follow-up issues)

_From requirements Non-Goals — file as separate StakTrakr issues if pursued._

- Dedicated 5th "goldback" card with its own show/hide/sort.
- Inverse-ratio displays / click-to-toggle alternate views.
- Historical-ratio sparkline or band/extreme threshold coloring (e.g. tint GSR when > 80).

## Risk Notes

- **Missed render path → stale chip (AC-8/9).** Mitigation: idempotent `renderRatioChips()` + the discovery's enumerated call-site checklist + one Playwright assertion per path (API sync, manual edit, cache refresh, reset, goldback refresh).
- **`js/goldback.js` edit (D-3) regresses goldback flow (AC-16).** Mitigation: additive fields only; existing settings-api Goldback spec guards the flow.
- **Script load order / `safeGetElement`.** `spot-ratio-chips.js` loads after its deps; any parse-time wiring uses `document.getElementById`; chip/tooltip wiring runs in an init function, never at top level.
- **`position:fixed` tooltip drift** on scroll/mobile. Mitigation: recompute on each show; hide on scroll.
- **Own-row height regression.** Mitigation: covered by `visual-layout-regressions.spec.js`; absolute-corner fallback is a CSS-only revert.

---

> **Phase complete?** Architecture clear, decisions carry rationale + tradeoff, file map complete, UI Contract bound to the approved playground. Then: `/sketch-review STRK-161 approach [AGENT]` → `/sketch-reconcile STRK-161 approach` → `/sketch-tasks STRK-161`.
