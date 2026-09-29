---
sketch: "STRK-75-market-all-tab"
phase: requirements
created: 2026-05-13
---

# STRK-75 — Requirements

> **Source Issue:** [STRK-75](https://plane.lbruton.cc/lbruton/browse/STRK-75/)
>
> **Title:** Market price table should default to an All tab before Gold/Silver/Platinum/Goldback
>
> **Summary:** The market price matrix currently opens on the Goldback tab for some users, giving a Goldback-first first impression. The fix is to add an **All** tab as the first tab and make it the default view for new users. The All tab shows all market-tracked items grouped by type: Gold → Silver → Platinum → Palladium (if present) → Goldback. Existing per-metal tabs stay and narrow the table to that type. The active-tab preference stored in `vendorPricesActiveTab` is preserved for returning users who already selected a specific tab; only missing/invalid/unavailable saved values fall back to `all`.

## Overview

This sketch delivers an **All tab** prepended to the vendor price matrix tab bar, making it the default landing view for new users and anyone whose saved tab is absent or invalid. The All tab renders every enabled market-tracked slug in a single unified matrix grouped by metal type. Per-metal tabs remain and behave identically to today. The feature matters now because the current default (fallback `xag` or a saved `goldback`) creates a poor first impression for the core gold/silver audience.

## User Stories

- **US-1:** As a new StakTrakr user, I want the market price table to open on an All tab so that I can see every tracked metal at a glance without knowing the app's tab order in advance.
- **US-2:** As a returning user who selected Silver last session, I want my tab preference remembered so that I don't have to re-select it on every visit.
- **US-3:** As a gold/silver stacker, I want Gold and Silver rows to appear before Goldback rows in the All tab so that the most relevant data is above the fold.
- **US-4:** As a user, I want to click a per-metal tab (e.g. Gold) and see only that metal's rows so that I can focus on one market without scrolling past others.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 — All tab is the first tab (maps to US-1, US-3)
- **Given** the market price section is rendered
- **When** the tab bar is built
- **Then** an "All" tab appears as the leftmost tab, before Gold, Silver, Platinum, Palladium (if enabled), and Goldback

### AC-2 — All tab is the default for new users (maps to US-1)
- **Given** `vendorPricesActiveTab` is not set in localStorage (fresh session)
- **When** the vendor price section initialises
- **Then** the All tab is active and the table shows all enabled market-tracked slugs

### AC-3 — Valid saved tab is preserved (maps to US-2)
- **Given** `vendorPricesActiveTab` is set to a value that is present in the current tab list (e.g. `xag`)
- **When** the vendor price section initialises
- **Then** that tab is active — the user's prior selection is not overridden

### AC-4 — Invalid/unavailable saved tab falls back to All (maps to US-2)
- **Given** `vendorPricesActiveTab` is set to a value that is not in the current tab list (e.g. a stale or unrecognised value)
- **When** the vendor price section initialises
- **Then** the All tab becomes active (not a crash, not an empty table)

### AC-5 — All tab group ordering (maps to US-3)
- **Given** the All tab is active
- **When** the table renders
- **Then** rows are grouped in this order: Gold, Silver, Platinum, Palladium (if present), then Goldback; within each group rows are sorted by display name using the existing comparator (numeric-aware `localeCompare` with slug tie-breaker)

### AC-6 — Per-metal tabs still narrow correctly (maps to US-4)
- **Given** the user clicks the Gold tab
- **When** the table re-renders
- **Then** only Gold rows appear, sorted alphabetically, identical to current Gold-tab behaviour

### AC-7 — Market filter settings respected in All tab
- **Given** one or more slug/vendor combinations are disabled in market filter settings
- **When** the All tab renders
- **Then** disabled combinations are hidden, consistent with per-metal tab behaviour

### AC-8 — Goldback premium column still works in All tab
- **Given** the All tab is active and Goldback rows are present
- **When** the table renders
- **Then** Goldback premium is computed against the G1 Goldback rate (same as today's Goldback tab), and spot-metal premiums (Gold, Silver, Platinum, Palladium) use each row's own metal context for `_getSpotPrice` — not a single function-level `metalCode`

### AC-9 — Vendor columns stable in All tab
- **Given** the All tab is active
- **When** the table renders
- **Then** vendor columns are the union of vendors across all visible rows, sorted alphabetically by display name

### AC-10 — Test coverage
- **Given** the test suite runs
- **When** market-sorting and market-survivors specs execute
- **Then** tests cover: All-tab default, valid-saved-tab preservation, invalid-saved-tab fallback, group ordering, single-tab narrowing, market-filter hiding (AC-7), Goldback/G1 premium and per-row spot premium (AC-8), and vendor-column union stability (AC-9). Fixture data must expand beyond silver-only to include at least gold and Goldback rows.

## Non-Goals

- Not changing the inventory table above the market price section
- Not changing the market filter settings UI (filter behaviour is preserved, not redesigned)
- Not changing retail pollers, vendor scrape data, or Goldback pricing sources
- Not force-resetting existing `vendorPricesActiveTab` values; returning users keep their saved tab
- Not touching the best-price ticker at `index.html:1118-1119` — scoped to the vendor price matrix only

## Open Questions

_Product-level decisions are resolved in the issue body._ One implementation/UX assumption remains: whether the All tab uses visible group headers (e.g. "Gold", "Silver" label rows) or relies on implicit consecutive grouping (rows appear in priority order without labels). This is deferred as a design assumption — implicit grouping is chosen in the approach phase (D-4), with group headers as a potential follow-up if UX feedback requests them.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-75`.

## Review Archive — requirements (2026-05-13)

_Reconciled by /sketch reconcile on 2026-05-13. Original reviewer marks preserved below for audit._

### Codex

**Verified Against Live Code**

- Plane STRK-75 requires an All tab default while preserving valid `vendorPricesActiveTab` choices; the issue also scopes the change to the vendor price matrix below inventory.
- `js/market-data.js:878-1170` currently renders one metal per call, filters rows at `js/market-data.js:904-906`, sorts row names at `js/market-data.js:918-923`, builds vendor columns at `js/market-data.js:973-983`, and computes spot premium from a single `metalCode` at `js/market-data.js:1033`.
- `js/market-data.js:1122-1125` already falls back to `_goldbackG1Rate`, and `js/market-data.js:1385-1401` fetches that G1 rate during market-data init.
- `tests/playwright/market-sorting.spec.js:37-78` is currently silver-only; `tests/playwright/retail/stak-582-market-survivors.spec.js:461-476` asserts the current active tab is Silver.

**Top Issues Raised**

1. AC-8 needs to cover per-row spot/premium context for all metals, not only Goldback G1 behavior.
2. AC-10 does not require tests for AC-7, AC-8, or AC-9, and the named sorting fixture cannot prove Goldback or multi-metal behavior as written.
3. The "no open questions" statement hides the group-header/implicit-grouping UX assumption that later phases choose without product confirmation.

**Unverified Assumptions**

- Palladium should appear in the All ordering when present, even though the issue title and primary desired-behavior paragraph emphasize Gold/Silver/Platinum/Goldback.
- Sparse vendor columns are acceptable in the All view.
- Implicit consecutive grouping is sufficient without visible group labels.

### Resolution Summary
- Accepted: 4
- Rejected: 0
- Resolved with your input: 1 (AC-5 sort wording — use existing comparator)
