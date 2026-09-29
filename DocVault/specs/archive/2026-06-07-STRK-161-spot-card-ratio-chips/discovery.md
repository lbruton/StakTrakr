---
sketch: "STRK-161-spot-card-ratio-chips"
phase: discovery
created: 2026-06-07
---

# STRK-161 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_All issue-cited pointers were re-verified against current `dev` (2026-06-07). The issue's `function X` symbol names are actually `const X = (…) =>` arrow declarations — verified by direct grep, lines below are current._

### Markup

| Path | Role | Notes |
|------|------|-------|
| `index.html:899-1124` | The four spot cards | `<section #spotPricesSection>` → `.spot-cards-grid` → four `.spot-input.{metal}` → `.spot-card[data-metal]`. DOM order is **Silver, Gold (2nd), Platinum, Palladium**. Each card ends with `.spot-card-value#spotPriceDisplay{Metal}`, `.spot-card-change#spotChange{Metal}`, `.spot-card-timestamp#spotTimestamp{Metal}` — the chip mounts inside `.spot-card`, in a lower corner near the timestamp. |
| `index.html:927-941` | Existing inline themed SVG (sync icon) | Already uses `stroke="currentColor"` inside `.spot-card` — **local prior art** for the issue's glyph requirement (cf. the issue's `attachment-ui.js:20` pointer; the cards themselves already demonstrate the pattern). |
| `index.html:5586` | Currency & Pricing settings panel (`<h3>Currency &amp; Pricing</h3>`) | `gb-source-btn` pricing-source pills at 5623-5650. The new "Show spot ratios" toggle lands in this panel (AC-10). |

### State & ratio source

| Path | Role | Notes |
|------|------|-------|
| `js/state.js:327` | `spotPrices = { gold, silver, platinum, palladium }` (USD/oz) | The numerator/denominator source for all three ratios (AC-1). |

### Spot render hooks (live-update surface — AC-8)

| Path | Role | Notes |
|------|------|-------|
| `js/spot.js:451` | `fetchSpotPrice` | API-sync entry. |
| `js/spot.js:503` | `updateManualSpot(metalKey)` | Manual-edit path. |
| `js/spot.js:1086` | `updateSpotChangePercent(metalKey, …)` | Change-percent render. |
| `js/spot.js` (DOM writes) | `elements.spotPriceDisplay[metalKey].textContent = formatCurrency(…)` at **366, 463/475, 525, 583**; timestamp via `getElementById('spotTimestamp'+name)` at **483, 532, 592** | API-data branch, manual branch, cache/sync branch. |
| `js/api.js:1177-1214` | `refreshFromCache` | Writes `elements.spotPriceDisplay[metal].textContent` (~1192) and `spotTimestamp{Name}` (~1199) directly — **outside `js/spot.js`.** |
| `js/api.js:2151-2175` | API save/test flow | Same `spotPriceDisplay` / `spotTimestamp` write pair (~2159 / ~2162). |
| `js/api.js:2267-2297` | `syncAllProviders` | Same write pair (~2286 / ~2289; timestamp via `safeGetElement`). |
| `js/api.js:2625-2646` | API reset | `elements.spotPriceDisplay[metalConfig.key].textContent` (~2641). |

**The full spot-card render surface spans `js/spot.js` _and_ `js/api.js`** — at least seven distinct write sites across API-data, manual, cache-refresh, save/test, sync-all, and reset paths. The chip render must fire on **every** one, or AC-8 passes for manual/default loading while API sync, cache refresh, or reset leaves ratio chips stale. This is the strongest argument for one shared `renderRatioChip(metalKey)` invoked from a single choke point (see OQ-2) rather than inline per-branch.

### Goldback (gold-card chip — AC-2/4/5/6/7)

| Path | Role | Notes |
|------|------|-------|
| `js/goldback.js:10` | `goldbackPricingSource` (`"off"\|"api"\|"spot"\|"manual"`) | Module `let`, window-exposed (18, 741). Gates the gold chip. |
| `js/goldback.js:300` | `getGoldbackDenominationPrice(weightGb)` | Returns `goldbackPrices[String(w)].price` if `> 0`, else `null`. **Carries no freshness/timestamp** — only the price. |
| `js/goldback.js:313` | `isGoldbackPricingActive()` → `goldbackPricingSource !== "off"` | Handy guard. |
| `js/goldback.js:378` | `computeGoldbackEstimatedRate(goldSpot)` = `2 * (goldSpot/1000) * goldbackEstimateModifier` | The AC-5 spot-estimate fallback. |
| `js/goldback.js:387` | `onGoldSpotPriceChanged()` | Recomputes denominations in **spot** mode when gold spot changes; calls `syncGoldbackSettingsUI()`. A natural re-render trigger for AC-9. |
| `js/goldback.js:420` | `fetchGoldbackApiPrices(options)` | Fetches `…/goldback/latest.json`, reads `envelope.data.g1_usd`/`denominations`, stores `goldbackPrices[key] = { price, updatedAt: Date.now(), source: "api" }`. **Discards `envelope.data.ts` and `stale_after`.** ← root of Open Question 1. |
| `js/settings-listeners.js:343-404` | Goldback pricing-source switch handler | Mutates `goldbackPricingSource`, then branches: `api` → `fetchGoldbackApiPrices({ expectedSource })`, `spot`/`manual` → recompute; finally calls `syncGoldbackSettingsUI()` / `renderTable()` **only** (no chip render). **AC-7's hide-on-`off` re-render trigger** — the chip render must hook here too, alongside `fetchGoldbackApiPrices()` and `onGoldSpotPriceChanged()`. |

### Settings toggle plumbing (AC-10/11)

| Path | Role | Notes |
|------|------|-------|
| `js/settings.js:1837` | `wireStorageToggle(elementId, storageKey, { defaultVal, onApply })` | Reads/writes a **raw** localStorage key as `'true'/'false'`, syncs visual state, and fires `opts.onApply(isEnabled)` — **`onApply` is the live show/hide hook for AC-11.** Expects a `.chip-sort-btn` yes/no container, not a checkbox. |
| `js/settings.js:1816` | `syncChipToggle(elementId, isOn)` | Single source of truth for toggle visual state (mem0-confirmed). |

### Constants

| Path | Role | Notes |
|------|------|-------|
| `js/constants.js:559` | `V2_API_ENDPOINTS` | Endpoint list (already consumed by `fetchGoldbackApiPrices`). |
| `js/constants.js:595` | `GOLDBACK_PRICING_SOURCE_KEY = "goldback-pricing-source"` | Existing goldback-mode key. New ratio-toggle key follows the pattern `const FOO_KEY = "foo"; // nosemgrep: codacy.javascript.security.hard-coded-password`. |
| `js/constants.js:939` | `ALLOWED_STORAGE_KEYS = [ … ]` | Persisted-key allowlist consumed by `cleanupStorage`/vault scope. Existing raw toggle keys (table-images, show-realized) are registered here → **the new ratio-toggle key must be added** or it gets purged. |

### CSS prior art

| Path | Role | Notes |
|------|------|-------|
| `css/styles.css:~1089` | `.trade-linked-chip` / `.chip-remove` | Existing chip/pill vocabulary. |
| `css/styles.css:~3835` | `.chip-grouping-*` | Further chip styling precedent. No existing **ratio/GSR** code anywhere — the math is greenfield. |

### Tests & coverage map

_Verified against current `dev` (2026-06-07). StakTrakr enforces a `coverage-map.csv` discipline (STRK-121/122 consolidated source specs into the core/extended tiers and archived the originals) — new coverage adds a map row, not a stray root spec._

| Path | Role | Notes |
|------|------|-------|
| `tests/playwright/core/smoke.spec.js` | Spot-card smoke | Already exercises the spot cards (multiple `spot` selectors) — natural home for a chip presence/visibility smoke check. |
| `tests/playwright/core/settings-api.spec.js:125-155` | Currency-panel Goldback controls + history | The "Show spot ratios" toggle (AC-10/11) lands in this panel — the existing Currency-panel test to extend, not a new spec. |
| `tests/playwright/core/mobile-and-layout.spec.js` | Responsive / layout precedent | Chip-must-not-overflow / mobile-stack assertions (requirements §UI line 32) belong alongside existing layout coverage. |
| `tests/playwright/extended/visual-layout-regressions.spec.js` | Theme-token / visual regression | Four-theme chip legibility (AC-14) fits the existing theme-token visual tier. |
| `tests/playwright/coverage-map.csv:50,62` | Coverage-map ledger | Rows 50/62 record the settings-currency→settings-api and theme-tokens→visual-layout-regressions consolidations — the pattern STRK-161 must follow: **add a coverage-map delta; do not create a new root or issue-prefixed spec.** |

## Prior Decisions

_mem0 query: `"StakTrakr goldback pricing mode spot card rendering GSR ratio settings toggle persistence four themes chip"`._

- **2026-04-22 — STAK-570 / PR #1009** (mem0 `2b2271c7`, `3f119271`): built the Currency & Pricing panel the new toggle lands in. Merged the Goldback tab into Currency, introduced the 4-option pricing source (`off/api/spot/manual`), and replaced legacy boolean keys with the single `goldback-pricing-source` key. Established `gb-source-btn` pill radios + `gb-*` layout vocab. Core `goldback.js` pricing engine left unchanged.
- **2026-05-12 — STRK-71** (mem0 `a31de3c6`/`3a380042`/`d67a290f`, archived sketch): the chip-toggle pattern — `syncChipToggle` as single source of truth, `chipMap/orderedChips` pipeline, persisted via `saveData()`. Precedent for adding a user-toggle that shows/hides chips.
- **2026-06-06 — STRK-58 / goldback cadence** (mem0 `ef499df5`): the goldback scrape is **hourly at :05**; `g1_usd` verified live (8.68) and reused client-side via `getGoldbackDenominationPrice(1)` — confirms the gold chip should consume the cache, not fetch.
- **2026-06-06 — STRK-161 filing** (mem0 `6c7f540d`, `fa3740aa`): the three UI forks were locked up front and the issue shipped with verified file:line pointers — which this discovery re-verified.

## External References

- **None.** This is a pure internal-codebase feature: no new library, RFC, or third-party pattern. The themed glyph reuses the codebase's existing inline-SVG-with-`stroke="currentColor"` convention; theme colors come from existing design tokens.

## Constraints

- **`ALLOWED_STORAGE_KEYS` registration** — the new persisted toggle key must be added to the allowlist at `js/constants.js:939`, or `cleanupStorage` purges it (existing raw-toggle keys are already registered there).
- **Four themes, tokens only** — chips must read legibly in light/dark/slate/sepia using design tokens; glyph color via `stroke="currentColor"`; no hardcoded hex (AC-14).
- **`safeGetElement` / script-load-order gotcha** — `safeGetElement` is undefined at parse time in some modules and returns a truthy dummy at runtime; use `document.getElementById` for any parse-time wiring and guard DOM access (cf. CLAUDE.md gotchas). Toggle wiring should run in an init/closure, not top-level.
- **Multi-path re-render** — the chip render must fire on **every** spot DOM-write path across `js/spot.js` (API / manual / cache branches) **and** `js/api.js` (`refreshFromCache`, save/test, `syncAllProviders`, reset), plus the goldback refresh paths — including the `js/settings-listeners.js:343-404` source-switch (AC-7 hide-on-`off`) — or AC-8/AC-9 break on whichever path is missed.
- **Number formatting** — GSR 1 dp; Au:Pt / Au:Pd 2 dp; goldback 2 dp. Hide (never render) `Infinity`/`NaN` (AC-2/AC-3).
- **No regression** — sparkline canvas, timestamp, change-percent, and the goldback settings flow must be untouched in behavior (AC-16).

## Open Questions

_The behavior is fully locked by requirements; the items below are mechanism decisions for `/sketch-approach` to resolve (with tradeoffs surfaced at approach review). None blocks drafting the approach — they ARE the approach's central decisions._

- **OQ-1 (load-bearing) — Where does the freshness signal come from?** AC-5/AC-6 require detecting `(now − data.ts) > stale_after`, but `fetchGoldbackApiPrices` currently **discards** both `data.ts` and `stale_after`, persisting only `{ price, updatedAt: <client-fetch-time>, source }`. Approach must choose how to make staleness detectable. Candidate directions (for approach to weigh, not decided here):
  - (a) Extend `fetchGoldbackApiPrices` to persist the envelope's `data.ts` + `stale_after` (module-level meta, or fields on the cached G1 entry). Same endpoint/data — no new source — but touches the goldback engine (AC-16 regression surface).
  - (b) Approximate staleness from the existing `updatedAt` (client fetch time) against a constant budget. Simpler, no goldback-engine change, but semantically weaker (measures "when we fetched," not "when the source generated").
  - (c) Use the cached entry's `.source` field (`"api"`/`"spot"`/`"manual"`) to drive the mode-aware branch, combined with (a) or (b) for the time test.
- **OQ-2 — Chip render choke point.** Given ≥3 `spot.js` DOM-write paths, approach should decide between a single shared `renderRatioChip(metalKey)` called from one post-update hook vs. per-path calls. (Recommendation leans shared, but it's an approach call.)
- **OQ-3 — Toggle markup shape.** `wireStorageToggle` expects the `.chip-sort-btn` yes/no container pattern, not a checkbox. Approach should confirm the new toggle reuses that markup for consistency with the panel's existing controls.

## Discovery Summary

The work lands almost entirely in `js/spot.js` (chip render + multi-path hook), the `.spot-card` markup in `index.html`, a new toggle in the Currency & Pricing panel via the existing `wireStorageToggle` helper, one new key constant + `ALLOWED_STORAGE_KEYS` entry, and chip CSS across four themes. The ratio math and toggle plumbing are **easy** — all the primitives exist and were verified. The **one genuinely tricky** piece is the goldback freshness guard (OQ-1): the issue assumed `data.ts`/`stale_after` were available, but the current cache discards them, so approach must decide whether to extend the goldback fetch to retain them (cleaner, but touches the engine) or approximate from client fetch time (simpler, weaker). Everything else is a well-trodden path. The existing test surface is now inventoried (see **Tests & coverage map** under Existing Code): STRK-161 coverage **extends an existing core spec and adds a `coverage-map.csv` delta** rather than introducing a new root or issue-prefixed Playwright spec.

---

## Review Archive — discovery (2026-06-07)

### Resolution Summary

- **Accepted (3):** all CODEX, all code-verified against `dev` before applying. (A) Added the `js/api.js` spot-card write paths (`refreshFromCache`, save/test, `syncAllProviders`, reset) to the render-surface inventory + expanded the choke-point note. (B) Added the `js/settings-listeners.js:343-404` Goldback source-switch path as the AC-7 hide-on-`off` re-render trigger. (C) Added a **Tests & coverage map** inventory and folded it into the Discovery Summary.
- **Rejected (5):** ANTIGRAVITY Top concerns 1–3 (already captured in OQ-1 / Constraints "Multi-path re-render" / Constraints "ALLOWED_STORAGE_KEYS"); ANTIGRAVITY assumption #2 hide-when-`off` (locked by requirements AC-7 + §UI line 30); ANTIGRAVITY assumption #1 tooltip cross-theme (mechanism deferred to approach by requirements line 127; collision + four-theme already in Constraints); CODEX unverified-endpoint note (envelope `g1_usd`/`stale_after`/`data.ts` already verified in requirements §UI line 30, 2026-06-06); 7× ANTIGRAVITY inline verification marks (confirmations only — nothing to apply).
- **Your input (0):** none — reviewers concurred (CODEX completed the multi-path inventory ANTIGRAVITY raised) and requirements settled both open assumptions.

---

### ANTIGRAVITY Review (2026-06-07)

#### Verified
- Checked `index.html` spot cards markup and selectors (`spotPriceDisplay{Metal}`, `spotTimestamp{Metal}`).
- Checked `js/state.js:327` for the `spotPrices` global definition.
- Checked `js/spot.js` for all `elements.spotPriceDisplay` DOM writes.
- Checked `js/goldback.js` for `getGoldbackDenominationPrice` and `fetchGoldbackApiPrices` cache behavior, confirming that `data.ts` and `stale_after` are currently fetched but discarded.
- Checked `js/settings.js:1837` for `wireStorageToggle`.
- Checked `js/constants.js:939` for `ALLOWED_STORAGE_KEYS`.

#### Top concerns
1. **Goldback Freshness Tracking (OQ-1):** Since `fetchGoldbackApiPrices` currently discards `envelope.data.ts` and `stale_after`, the approach must extend the global cache or the cached price objects in `goldbackPrices` to store these values. Otherwise, it will not be possible to enforce the stale-after guard correctly on the front-end.
2. **Multi-Path Rendering Synchronization:** There are at least three distinct paths in `js/spot.js` that write spot values to the DOM. Implementing a single shared update/render function (`renderRatioChip`) called from a central post-update hook is critical to prevent visual desync where ratios are not updated when a user edits spot prices manually vs. when they auto-sync.
3. **Storage Key Purging:** The new setting toggle key must be explicitly registered in `ALLOWED_STORAGE_KEYS` in `js/constants.js`, or it will be silently purged by the next storage cleanup pass.

#### Unverified assumptions
1. It is assumed that the custom tooltips required by AC-13 can be styled and positioned uniformly across all themes without causing layout shifts or overlapping with the sparklines and timestamp elements.
2. It is assumed that when the Goldback pricing source is switched to "off", hiding the chip on the gold card is the desired behavior and won't confuse users who expect to see at least a ratio or static label there.

### CODEX Review (2026-06-07)

#### Verified
- Read `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, `.context/sketch-conventions.md`, and the Foundation coding/design docs.
- Checked `index.html:899-1124` spot-card markup and `index.html:5584-5658` Currency & Pricing / Goldback controls.
- Checked spot update writes in `js/spot.js:451-604` and the additional API/cache/reset writes in `js/api.js:1177-1214`, `2151-2175`, `2267-2297`, and `2625-2646`.
- Checked Goldback cache/source behavior in `js/goldback.js:300-477` and source-switch listeners in `js/settings-listeners.js:343-404`.
- Checked `wireStorageToggle` in `js/settings.js:1816-1855`, storage allowlist shape in `js/constants.js:939-970`, spot-card CSS in `css/styles.css:1949-2144`, and relevant Playwright inventory/coverage-map rows.

#### Top concerns
1. The discovery undercounts the spot-card render surface by omitting direct `js/api.js` DOM writes. This could cause stale chips on API sync/cache/reset paths even if `js/spot.js` manual paths are handled.
2. The discovery omits the existing Goldback pricing-source switch event path, which is required for the gold-card chip to hide live when the user switches Goldback pricing to `off`.
3. The discovery does not map existing Playwright targets or the coverage map, increasing the chance that approach/tasks put STRK-161 coverage in the wrong tier or miss the project-required coverage-map update.

#### Unverified assumptions
- I did not verify the live `goldback/latest.json` endpoint contents during this review; I only verified how the current client consumes and discards the envelope fields.
- I did not run browser screenshots for chip placement because discovery has not yet selected a visual approach or mockup.

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions are scoped as approach decisions (none blocks drafting). Then advance: `/sketch-approach STRK-161`.
