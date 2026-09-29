---
sketch: STRK-85-ticker-goldback-premium
phase: requirements
created: "2026-05-22"
---

# STRK-85 — Requirements

> **Source Issue:** [STRK-85](https://plane.lbruton.cc/lbruton/browse/STRK-85/)
> **Title:** Market ticker: goldback premium % missing + tiered premium color thresholds
>
> **Bug:** The market ticker does not display premium values for goldback rows, even though the Market Matrix (rendered below the inventory) shows them correctly. The math/function clearly exists — it just isn't wired into the ticker render path for goldbacks.
>
> **Expected:**
>
> - Ticker shows goldback premium % alongside spot-based items, computed from the current daily goldback rate we collect.
> - Reuse the same premium calculation the Market Matrix uses (avoid duplicating the formula).
>
> **Investigation hints:**
>
> - Find where the ticker builds its rows vs where the Market Matrix does — likely a branch that early-returns or skips goldbacks because they don't have a traditional spot.
> - Check `isGoldbackLookup` vs `isGoldbackRetailLookup` usage in the ticker pipeline (per CLAUDE.md, easy to confuse).
>
> **Reconciled implementation note:** `isGoldbackRetailLookup` should be treated as a stale/nonexistent hint. The only existing lookup predicate identified during review is `isGoldbackLookup`; market-data Goldback handling should be verified from the live retail pipeline rather than assuming a second predicate exists.
>
> **Enhancement: tiered premium color coding**
> While we're in there, retune the premium color thresholds across wherever premium % is rendered (ticker + matrix + anywhere else):
>
> - **< 1%** → green (great deal)
> - **2–4%** → yellow (fair)
> - **5%+** → orange/red (premium-heavy)
> - (Need to define the 1–2% gap — likely roll into green or yellow; flag during impl.)
>
> Verify in the codebase first how premium colors currently work — there may already be a CSS class scheme or a JS helper returning a tier. Don't introduce a parallel system.
>
> **Acceptance:**
>
> - Ticker displays goldback premium % using the existing matrix calculation.
> - Premium color tiers applied consistently (ticker + matrix + any other premium displays) using a single shared helper.
> - No duplicate premium math; reuse the existing function.

## Overview

The market ticker currently shows premium % for spot-based metals (gold, silver, platinum, palladium) but displays nothing for goldback rows — even though the Market Matrix panel below the inventory already calculates and renders goldback premium over the G1 rate. This sketch wires the same market-premium calculation into the ticker, includes the retail detail vendor table as the third market premium surface, and replaces the existing binary color scheme (low/high at 10% threshold) with a mechanically complete multi-tier system that gives users meaningful at-a-glance color signals across all market dealer premium displays.

## User Stories

- **US-1:** As a goldback collector, I want to see premium % in the market ticker for goldback items, so that I can quickly gauge dealer markup without scrolling to the Market Matrix.
- **US-2:** As any user watching the ticker or Market Matrix, I want premium percentages color-coded by meaningful tiers (green/yellow/orange-red), so that I can instantly identify great deals vs premium-heavy pricing.

## Acceptance Criteria

### AC-1: Goldback premium in ticker (maps to US-1)

- **Given** the market ticker is visible and goldback retail data has loaded with a valid G1 rate
- **When** the ticker renders goldback items
- **Then** each goldback item shows a premium % calculated as `((bestPrice - g1Rate) / g1Rate) * 100`, matching the formula used in the Market Matrix vendor panel

### AC-2: Goldback premium uses existing calculation path (maps to US-1)

- **Given** the Market Matrix already computes goldback premium via the `_goldbackG1Rate` variable
- **When** the ticker needs goldback premium
- **Then** it uses a shared market-premium calculation helper that covers both spot-based premiums and Goldback-over-G1 premiums across all in-scope market premium render sites — no duplicated formula in the ticker, Market Matrix, or retail detail vendor table

### AC-3: Tiered premium color thresholds (maps to US-2)

- **Given** any premium % value is rendered (ticker, Market Matrix vendor badges, or any other display)
- **When** the premium value falls into a defined tier
- **Then** it receives a color class per this scheme:
  - **< 2%** → green (`low` / excellent deal)
  - **>= 2% and < 5%** → yellow (`mid` / fair)
  - **>= 5%** → orange-red (`high` / premium-heavy)
- **And** the source issue's unresolved 1–2% gap is intentionally resolved by treating the entire `< 2%` range as green

### AC-4: Single shared color helper (maps to US-2)

- **Given** premium color is applied in multiple locations (ticker `.premium` span, Market Matrix `.vp-premium` badges)
- **When** any location determines what color class to apply
- **Then** all locations call a single shared function (e.g., `getPremiumTierClass(premium)`) — no inline threshold logic duplicated across render sites
- **And** the helper/class scheme applies to ticker premium spans and market premium badges with consistent semantics

### AC-5: Consistent rendering across all premium displays

- **Given** the ticker, Market Matrix vendor panels, and retail detail vendor table all render market dealer premium
- **When** the same item appears in multiple views
- **Then** the premium value and color tier are identical in every location
- **And** the inventory/view-modal purchase premium surface is excluded because it represents the user's cost basis versus spot, not current dealer markup

## Non-Goals

- Not redesigning the ticker layout or adding new ticker item types beyond goldback premium
- Not changing the premium calculation formula for spot-based metals (gold/silver/platinum/palladium remain `(price - meltValue) / meltValue`)
- Not adding premium to the CSV export or clipboard copy (ticker is display-only)
- Not introducing animation or transition effects for color tier changes
- Not addressing goldback items missing from the ticker entirely (if they already appear without premium, this sketch only adds the missing % — if they don't appear at all, that's a separate bug)
- Not changing the inventory/view-modal purchase premium row; that premium is based on the user's own cost basis and uses gain/loss styling, not market dealer markup tiers
- Not adding a fallback Goldback rate source unless discovery confirms `/goldback/latest.json` failure should display something other than a blank premium

## Open Questions

- Discovery should verify whether Goldback items reliably appear in the ticker from the current retail data path; if not, determine whether missing ticker rows are the same bug or a separate issue.
- Discovery should verify whether a failed `/goldback/latest.json` fetch should leave Goldback premiums blank or fall back to an older local/cache/settings source.
- Approach should choose final CSS class names. Requirements permit `low` / `mid` / `high` semantics, but implementation may choose less overloaded names if that better matches the existing CSS migration.

---

> **Phase reconciled?** Acceptance criteria are concrete and verifiable, active reviewer marks are archived below, and remaining questions are assigned to discovery/approach. Then advance: `/sketch discovery STRK-85`.

---

## Review Archive — requirements (2026-05-23)

### Resolution Summary

- Accepted the shared-helper concern: AC-2 now requires a single market-premium calculation helper across ticker, Market Matrix, and retail detail vendor table.
- Accepted the threshold-boundary concern: AC-3 now uses complete bounds of `< 2%`, `>= 2% and < 5%`, and `>= 5%`.
- Accepted the scope-boundary concern: AC-5 now explicitly includes the retail detail vendor table and excludes inventory/view-modal purchase premium.
- Preserved discovery follow-ups for Goldback ticker-row presence, Goldback-rate failure behavior, and final CSS class naming.

### Archived Inline Reviewer Notes

- DEEPSEEK noted that `isGoldbackRetailLookup` does not exist in the codebase and should not be referenced downstream; the source-issue note was rewritten as a reconciled implementation note.
- DEEPSEEK verified the ticker's spot-only premium path, the Market Matrix Goldback fallback, and the existing binary threshold; this evidence was folded into the overview and archive below.
- CODEX flagged AC-2 as too weak because direct `_goldbackG1Rate` access could still duplicate premium math; AC-2 was tightened to require a shared helper.
- CODEX flagged AC-3's missing `> 4% and < 5%` tier; AC-3 now defines complete continuous bounds.
- DEEPSEEK and CODEX both flagged the retail detail vendor table as a third market premium surface; AC-5 now includes it explicitly.
- CODEX flagged the view-modal purchase premium as a different concept; AC-5 and Non-Goals now exclude it.
- DEEPSEEK noted that Goldback ticker-row presence still needs discovery verification; that is now an open discovery question.
- CODEX objected to "Open Questions: None"; open questions now preserve the remaining discovery/approach decisions.

### DEEPSEEK Review (2026-05-22)

### Verified

All claims checked against the live codebase at `/Volumes/DATA/GitHub/StakTrakr/`:

| Claim                                            | Source                                                                  | Verdict       |
| ------------------------------------------------ | ----------------------------------------------------------------------- | ------------- |
| Ticker lacks goldback premium branch             | `market-data.js:293-298` — only `(price - meltValue) / meltValue * 100` | **Confirmed** |
| Market Matrix has goldback premium               | `market-data.js:1142-1144` — `else if (_goldbackG1Rate && ...)`         | **Confirmed** |
| `_goldbackG1Rate` exists as module variable      | `market-data.js:13` — populated at lines 1401-1410                      | **Confirmed** |
| Binary 10% threshold: `"low"/"high"`             | `market-data.js:775` and `:1147` — `premium < 10 ? "low" : "high"`      | **Confirmed** |
| No existing `getPremiumTierClass` helper         | Grep across all `js/*.js` — zero matches                                | **Confirmed** |
| `.vp-premium.low` / `.vp-premium.high` CSS       | `styles.css:14847-14852` — maps to `--warning` / `--danger`             | **Confirmed** |
| Ticker `.premium` span has no color class        | `styles.css:14708-14711` — only `color: var(--text-muted)`              | **Confirmed** |
| `isGoldbackRetailLookup` does NOT exist          | Grep across all `js/*.js` — zero matches                                | **Confirmed** |
| `isGoldbackLookup` exists                        | `spotLookup.js:30` — `itemWeightUnit?.value === "gb"`                   | **Confirmed** |
| Design tokens `--success`/`--warning`/`--danger` | `styles.css:51-57` (light theme, +dark+contrast variants)               | **Confirmed** |
| `_renderVendorTable` also lacks goldback premium | `market-data.js:770-784` — spot-only branch, no fallback                | **Confirmed** |
| Goldback metal code "goldback" has no spot price | `_ISO_TO_METAL` at `market-data.js:8` — only xag/xau/xpt/xpd            | **Confirmed** |

### Top Concerns

1. **Third premium display site unscoped.** The retail detail modal's vendor table (`_renderVendorTable`, `market-data.js:770-784`) also renders premium with the same spot-only logic and binary color scheme. AC-5 says "any other premium-bearing UI" but only ticker + Market Matrix are explicitly named. If `_renderVendorTable` is excluded from scope, the non-goals should say so. If included, it needs a goldback branch AND tiered colors.

2. **Threshold values differ between issue and AC-3.** The source issue says `< 1%` green with a `1–2%` unresolved gap. AC-3 resolves the gap by making `< 2%` green, which is a fine design decision, but the issue's quoted text still sits above it with the old values. This could confuse reviewers reading the issue for context. Consider adding a brief note that the 1–2% gap was resolved by extending green to `< 2%`.

3. **AC-3 parenthetical class names collide with current semantics.** AC-3 says `low`/`mid`/`high` as class names. But today `"low"` means `< 10%` and maps to yellow (`--warning`). After this change, `"low"` means `< 2%` and would map to green (`--success`). This is a semantic break in the class naming that may confuse anyone reading old code or old screenshots. Consider names like `tier-green`/`tier-yellow`/`tier-red` to avoid overloading `"low"`.

### Unverified Assumptions

- **Goldback items appear in the ticker at all.** The non-goal assumes they do — but `renderBestPriceTicker()` at line 254 iterates all coin slugs without a metal filter, and goldback slugs from `_getRetailCoins()` should be present. However, `_getRetailCoins()` is a caching wrapper around `window._v2RetailData` — goldbacks may be in a separate data path. Verify during discovery.

- **`_goldbackG1Rate` is guaranteed before ticker render.** At `initMarketData` (line 1401), the G1 fetch happens BEFORE `renderBestPriceTicker()` is called at line 1418. In the success path this is fine, but if the G1 fetch fails, `_goldbackG1Rate` stays null and goldback premium renders empty. The acceptance criteria don't cover the failure case — is an empty premium acceptable, or should there be a fallback (e.g., cached G1 rate)?

- **Goldback items have a weight > 0 in the retail data.** The ticker checks `weightOz > 0` at line 295. If goldback retail metadata sets `weight` to 0 (since they're denominated in GB, not troy oz), the ticker may need to bypass the weight check entirely for goldbacks. The Market Matrix at line 1052 uses `detail.weight_oz || meta.weight || 0`, so weight 0 is possible.

- **ViewModal premium display is unrelated.** The `viewModal.js` Premium row at lines 646-648 uses `signClass` (gain/loss binary), which is about the user's purchase premium vs spot, not the market dealer premium. AC-5 says "any other premium-bearing UI" — clarify that the viewModal valuation premium is NOT in scope (it's a different concept).

- **CSS classes for mid tier need `.vp-premium.mid` plus ticker equivalents.** Currently `.vp-premium.low`/`.vp-premium.high` exist in `styles.css`. The ticker's `.premium` span has no tier classes at all. The CSS changes are non-trivial: rename or repurpose `"low"`, add `"mid"` (and possibly `"low"`/`"high"` for the ticker), ensure all three theme variants (light/dark/contrast) are consistent.

- **`renderBestPriceTicker` is the only ticker render path.** The codebase has `renderBestPriceTicker` as the sole entry point for the scrolling ticker. There is no secondary ticker or abbreviated ticker that also needs updating. Confirmed by grep — `renderBestPriceTicker` is called only at `initMarketData:1418`.

### CODEX Review (2026-05-22)

### Verified

- Confirmed the ticker builds from `Object.keys(coins)` and only computes spot-based premium when `_getSpotPrice(metalLower)` and `weightOz > 0` are present (`js/market-data.js:244-298`), then renders an unclassed `.premium` span (`js/market-data.js:386-391`; `css/styles.css:14708-14711`).
- Confirmed the Market Matrix already has a Goldback fallback using `_goldbackG1Rate` (`js/market-data.js:1138-1150`) after `initMarketData()` fetches `/goldback/latest.json` before rendering ticker/vendor prices (`js/market-data.js:1400-1419`).
- Confirmed a third market premium render site exists in the retail detail vendor table and still uses spot-only math plus the binary `premium < 10 ? "low" : "high"` class (`js/market-data.js:770-779`).
- Confirmed the current premium badge CSS only has `.vp-premium.low` and `.vp-premium.high`, with `.low` mapped to `--warning`, not green (`css/styles.css:14841-14852`).
- Confirmed `isGoldbackLookup` exists in `js/spotLookup.js:30`, while `isGoldbackRetailLookup` has no matches in `js/`, `css/`, or `index.html`.
- Checked DocVault project context: StakTrakr is a vanilla-JS PWA with retail and Goldback feeds (`Projects/StakTrakr/Overview.md:12-34`); market data DOM includes `bestPriceTickerEl` and vendor price containers (`Foundation/Deep Dives/DOM Patterns.md:214-228`); the reusable patterns doc says market matrix premium math is per-row and tied to `js/market-data.js` (`Foundation/reusable-patterns.md:56-62`).

### Top concerns

1. AC-2 currently permits implementation to copy the Goldback formula into the ticker as long as it directly references `_goldbackG1Rate`, which contradicts the no-duplicate-premium-math acceptance line.
2. AC-3 is not mechanically complete because `> 4% and < 5%` is not assigned to any tier, and live premium values are continuous before display rounding.
3. AC-5 needs a sharper scope boundary: include the retail detail vendor table as a market premium surface, but exclude `viewModal.js` purchase premium because it is a different user-cost concept.

### Unverified assumptions

- A shared calculation helper can be added in `js/market-data.js` without needing broader module exports or script-load changes; this is likely because all three market premium render sites are in that file, but the implementation shape should be confirmed during approach.
- The product intent is to preserve the existing `low` / `high` class names while changing their semantics, rather than introducing less overloaded class names such as `tier-green`, `tier-yellow`, and `tier-red`.
- Goldback ticker rows should show premium whenever `_goldbackG1Rate` is available, even if the Goldback slug metadata weight is missing or zero; live hardcoded metadata uses nonzero Goldback weights in `js/retail.js:39-53`, but manifest data should be checked in discovery.
- Failure to fetch `/goldback/latest.json` should leave Goldback premium blank rather than using the older local Goldback settings/cache path from `js/goldback.js`; the requirements do not state fallback behavior.
