---
sketch: "STRK-66-quarter-goldback"
phase: requirements
created: 2026-05-11
---

# STRK-66 — Requirements

> **Source Issue:** [STRK-66](https://plane.lbruton.cc/lbruton/browse/STRK-66/)
> **Title:** Add 1/4 Goldback denomination support (Idaho first; Florida/Oklahoma/Arizona to follow)
>
> Goldback Inc. released a new **1/4 Goldback** denomination (1/4000 troy oz of 24K gold) on March 24, 2026, debuting with the new **Idaho** state series. StakTrakr currently supports 8 canonical denominations (1/2, 1, 2, 5, 10, 25, 50, 100). We need to add 1/4 across the inventory UI, the goldback scraper/publisher, and fix a bounds-guard regex bug found during recon.
>
> **Decisions captured in issue:** slug naming is `g0.25` only (no `gquarter` alias); ships as a single PR covering UI + scraper + bounds-guard fix + foundation docs.

## Overview

Add `g0.25` (1/4 Goldback, 1/4000 troy oz of 24K gold) as the ninth canonical denomination in StakTrakr. The change touches the frontend denomination constant array, the label-rendering logic in item-add/edit and bulk-edit modals, the retail slug parser, three poller publisher files, the bounds-guard regex in `price-extract.js`, the Playwright denomination tests (both add/edit and bulk-edit paths), and two Foundation docs. All changes ship in a single PR so the dropdown option and the price data are never out of sync.

This is a runtime code PR. It claims `devops/version.lock` and bumps the version via `/release patch` per StakTrakr's hard gate (see `CLAUDE.md` §"Git Topology"). Worktree path is `.worktrees/STRK-66-quarter-goldback/` on branch `sketch/STRK-66-quarter-goldback`; `/release patch` runs inside that worktree to bump version files — it does not create a separate worktree.

## User Stories

- **US-1:** As a collector, I want to add a 1/4 Idaho Goldback to my inventory so that StakTrakr tracks its correct gold content (0.00025 oz) and current market value.
- **US-2:** As a collector, I want the item add/edit and bulk-edit dropdowns to display "¼ Goldback" (not "0.25 Goldback") so that the denomination label matches how the physical coin is branded.
- **US-3:** As a developer/operator, I want the goldback poller to emit `g0.25` denomination entries and apply correct price bounds so that 1/4 Goldback retail prices are scraped and published without silent data-quality errors.

## Acceptance Criteria

### AC-1 — Denomination constant

- **Given** the app is loaded
- **When** `GOLDBACK_DENOMINATIONS` is read from `js/constants.js`
- **Then** the array contains exactly 9 entries and `GOLDBACK_DENOMINATIONS[0]` equals `{ weight: 0.25, label: "¼ Goldback", goldOz: 0.00025 }`

### AC-2 — Item add/edit modal label

- **Given** a user opens the add or edit modal for a Goldback item
- **When** they expand the denomination dropdown
- **Then** the first option reads "¼ Goldback" (Unicode fraction, not "0.25 Goldback")

### AC-3 — Bulk-edit modal label

- **Given** a user opens the bulk-edit modal for Goldback items
- **When** they expand the denomination dropdown
- **Then** the first option reads "¼ Goldback" and the dropdown contains 9 entries
- **Verified by:** test 13 in `tests/playwright/goldback-type.spec.js` (Goldback assertion block at line 360-361 — `goldOptions` length and `goldOptions[0].text`)

### AC-4 — Slug parser resolution

- **Given** a retail manifest slug `goldback-idaho-g0.25`
- **When** `_parseGoldbackSlug()` (or equivalent) processes it
- **Then** the resolved weight is `0.00025` oz (i.e., `GOLDBACK_WEIGHTS["g0.25"] === 0.00025`)

### AC-5 — Poller denomination output

- **Given** `goldback-scraper.js`, `api-export.js`, and `api-export-v2.js` are executed
- **When** they call `buildGoldbackDenominations` (or equivalent)
- **Then** all three emit `g0.25` as a denomination key in their output

### AC-6 — Bounds-guard regex

- **Given** `price-extract.js` runs its bounds-guard check on a Goldback slug
- **When** the slug suffix is `g0.25` (decimal form)
- **Then** the regex matches and extracts the correct multiplier (0.25), not falling through to G1 bounds
- **And** the regex rejects malformed suffixes like `g.`, `g1.2.3`, or `g0..5`
- **And** legacy integer suffixes (`g1`, `g2`, …, `g50`) continue to match with their existing multipliers
- **Note:** `ghalf` (the grandfathered word-form alias) is handled by a separate code path in `js/retail.js` `GOLDBACK_WEIGHTS` map and is **intentionally out of scope** for this regex fix. No new word-form aliases will be added; future fractional denominations use numeric form (`g0.1`, `g0.25`, …).

### AC-7 — Playwright tests updated

- **Given** `tests/playwright/goldback-type.spec.js` tests 9 AND 13 run
- **When** they check the denomination dropdowns
- **Then** in test 9 (add/edit): `options` has length 9, `options[0].text === "¼ Goldback"`, `options[1].text === "½ Goldback"`
- **And** in test 13 (bulk-edit Goldback assertion block): `goldOptions` has length 9, `goldOptions[0].text === "¼ Goldback"`

### AC-8 — Foundation docs updated

- **Given** `data-pipelines.md` and `reusable-patterns.md` are read
- **When** a developer looks up Goldback denomination support
- **Then** `g0.25 | 1/4 Goldback | 1/4000 oz` appears in the denomination table, Idaho appears in the state table, and the slug count is accurate

### AC-9 — Manual end-to-end

- **Given** the deployed app with this change
- **When** a user adds a "1/4 Idaho Goldback" item to their inventory
- **Then** the gold-content calculation shows 0.00025 oz per coin

## Non-Goals

- Not adding Florida, Oklahoma, or Arizona 1/4 Goldbacks — those series are aspirational for 2026; the frontend is manifest-driven so they appear automatically once the API publishes slugs. No additional code needed.
- Not rebuilding or redeploying the home poller container — that is a post-merge ops step tracked in the issue, not part of the PR.
- Not adding a `gquarter` alias slug — slug naming convention is `g0.25` only (numeric form); `ghalf` alias is grandfathered but no new aliases.
- Not adding per-state registration code — `_parseGoldbackSlug()` is regex-driven; Idaho resolves as soon as manifest entries appear.

## Open Questions

_None — issue has complete pre-decisions. Discovery phase may surface code-level details._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-66`.
