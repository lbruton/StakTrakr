---
sketch: "STRK-66-quarter-goldback"
phase: approach
created: 2026-05-11
---

# STRK-66 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The 1/4 Goldback is a pure additive extension of the existing denomination pattern. Every part of the system that handles goldback denominations does so via a lookup table or constant array — there is no logic hardcoded to specific weights. Adding `g0.25` means inserting one entry into each of those tables.

On the frontend, `GOLDBACK_DENOMINATIONS` in `js/constants.js` is the canonical source of denominations; the label-rendering functions (`updateDenomLabels` in `events.js` and `updateBulkDenomLabels` in `bulkEdit.js`) special-case ½ → "½" and need a parallel branch for ¼ → "¼". The slug-to-weight lookup in `js/retail.js` (`GOLDBACK_WEIGHTS` map) drives `_parseGoldbackSlug()` and needs `"g0.25": 0.00025` added.

In the poller layer, `goldback-scraper.js` uses `DENOMINATION_MULTIPLIERS` to convert scraped prices into the spot denomination map (`goldback-spot.json`); `api-export.js` and `api-export-v2.js` each have a `buildGoldbackDenominations` function that emits the list of supported denomination keys. All three need `g0.25` added. The bounds-guard in `price-extract.js` (which parses per-product slugs like `goldback-idaho-g0.25`) currently uses `/g(\d+)$/i` which matches only integer suffixes — tightening this to `/g(\d+(?:\.\d+)?)$/i` accepts well-formed integer and decimal suffixes while rejecting malformed shapes like `g.`, `g1.2.3`, or `g0..5` (a loose `[\d.]+` would let those through and feed `NaN` to the bounds check).

## Key Decisions

| #   | Decision                                                                                                                                                          | Rationale                                                                                                                                                                                                                                                                                                                                                                                  | Tradeoff                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Slug `g0.25` only, no `gquarter` alias                                                                                                                            | Issue pre-decision: new denoms use numeric form; `ghalf` alias is grandfathered but not extended                                                                                                                                                                                                                                                                                           | Slightly less readable in code, but consistent with future denominations (g0.1 etc.)                                          |
| D-2 | Bundle UI + poller + bounds-fix + docs in one PR                                                                                                                  | Without the bounds-fix, any scraped 1/4 price is silently sanity-checked against G1 bounds (4× too high). Splitting the PR would introduce a window of data corruption.                                                                                                                                                                                                                    | PR is wider than usual, but each change is a 1–3 line edit in its own file — low merge-conflict risk                          |
| D-3 | TDD: write the failing Playwright test first                                                                                                                      | Issue explicitly flags this as TDD. Test 9 currently asserts `toHaveLength(8)` — updating the assertion to 9 before the constant change ensures the test is red before the implementation turns it green                                                                                                                                                                                   | Test file is modified before implementation, which is an ordering constraint for tasks                                        |
| D-4 | Prepend 1/4 entry to `GOLDBACK_DENOMINATIONS` (index 0)                                                                                                           | Acceptance criterion AC-1 explicitly requires it at index 0 — smallest denomination first, consistent with ascending physical value order                                                                                                                                                                                                                                                  | `options[0]` behavior in the dropdown must match; label-rendering branches must fire before the array is iterated             |
| D-5 | Worktree path `.worktrees/STRK-66-quarter-goldback/`, branch `sketch/STRK-66-quarter-goldback`, version bump via `/release patch` inside that worktree at CLOSE-4 | Reconciles `/sketch`'s issue-named branch convention with StakTrakr's release workflow. `/release patch` does not require a fresh worktree — it edits version files within the current worktree, and the `stamp-sw-cache` pre-commit hook handles `sw.js`. Version-lock is claimed at Cohort 0 (before any code edits) to avoid two simultaneous patches racing for the same version slot. | Slightly heavier setup than a typical `/sketch`, but matches StakTrakr's hard gate without forcing a second worktree mid-flow |
| D-6 | PR title follows StakTrakr release convention `vX.YY.ZZ — STRK-66: add ¼ Goldback denomination (Idaho, g0.25)`                                                    | Repo convention for version-bumping PRs (see recent `dev` history: `v3.34.59 — STRK-69`, `v3.34.58 — STRK-42`). The sketch is a feat-equivalent runtime change, but the title format is set by release plumbing, not by Conventional Commits.                                                                                                                                              | Departs from typical `/sketch` default `feat(STRK-NN):` title, but consistent with project history                            |

## File Map

### New

_None — all changes are additive edits to existing files._

### Modified

- `js/constants.js` — prepend `{ weight: 0.25, label: "¼ Goldback", goldOz: 0.00025 }` to `GOLDBACK_DENOMINATIONS`
- `js/events.js` — add `d.weight === 0.25 ? "¼"` branch in `updateDenomLabels` (parallel to existing `=== 0.5 ? "½"`)
- `js/bulkEdit.js` — add same `¼` branch in `updateBulkDenomLabels` (line ~621)
- `js/retail.js` — add `"g0.25": 0.00025` to `GOLDBACK_WEIGHTS` map
- `devops/pollers/shared/goldback-scraper.js` — add `g0.25: 0.25` to `DENOMINATION_MULTIPLIERS`
- `devops/pollers/shared/api-export.js` — add `g0.25` to `buildGoldbackDenominations`
- `devops/pollers/shared/api-export-v2.js` — add `g0.25` to `buildGoldbackDenominations`
- `devops/pollers/shared/price-extract.js` — tighten bounds-guard regex from `/goldback-.*?-?g(\d+)$/i` to `/goldback-.*?-?g(\d+(?:\.\d+)?)$/i` (accepts integer + well-formed decimal, rejects `g.` / `g1.2.3`)
- `tests/playwright/goldback-type.spec.js` — update **test 9** (add/edit, line 269): `toHaveLength(8)` → `(9)`; assert `options[0].text === "¼ Goldback"`, `options[1].text === "½ Goldback"`. **Test 13** (bulk-edit, line 337): in the Goldback assertion block (line 360-361), `goldOptions.toHaveLength(8)` → `(9)`; `goldOptions[0].text === "½ Goldback"` → `"¼ Goldback"`
- `DocVault/Projects/StakTrakr/Foundation/data-pipelines.md` — add Idaho row to state table (9 states total); add `g0.25 | 1/4 Goldback | 1/4000 oz` row to denomination table; **recalculate slug count as 56 + 8 (Idaho's 7 standard + 1 quarter) = 64**, not 9 × 9 — only Idaho publishes `g0.25` at launch
- `DocVault/Projects/StakTrakr/Foundation/reusable-patterns.md` — update supported denominations line to include `g0.25`
- `js/about.js`, `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `sw.js` — version-bump artifacts touched by `/release patch` at CLOSE-4 (not hand-edited)
- `data/spot-history-bundle.js` — rebuilt by `/update-spot-bundle` before PR (every version-bump PR)

### Deleted

_None._

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. `GOLDBACK_DENOMINATIONS` is a runtime constant in JS memory; existing localStorage items with `weight: 0.5` through `weight: 100` are unaffected. The new `weight: 0.25` value is simply a new option users can select going forward.

## Tradeoffs Surfaced for Review

- **TDD evidence without a red intermediate commit.** Tests 9 and 13 must be updated to expect 9 entries / `¼ Goldback` BEFORE the implementation lands. The evidence requirement is to **run the updated tests locally and capture a red result** (paste into the verification stamp), not to push a red commit to the branch. Cohort A can be staged together with Cohort B in a single working commit, so CI never sees red.
- **Price-extract regex is in the poller, not the app.** The fix only matters when the home poller container is rebuilt post-merge. Until then, any scraped `g0.25` prices would pass bounds incorrectly. The issue documents this as a post-merge ops step.

## Out of Scope (follow-up issues)

- Florida, Oklahoma, Arizona 1/4 Goldbacks — manifest-driven; no code needed when API publishes those slugs.
- Home poller container rebuild — post-merge ops, tracked in issue task 12.
- Retail price scraping for 1/4 denominations — automatic once vendors list Idaho 1/4 Goldbacks and the poller scrapes them.

## Risk Notes

- **Bounds-guard + scraper must ship together** — if `goldback-scraper.js` gets the `g0.25` multiplier but `price-extract.js` keeps the broken regex, scraped prices for `g0.25` slugs would pass bounds-check against G1 limits (4× the correct ceiling). This is a data-quality silent failure. Both changes must be in the same PR and must not be cherry-picked separately.
- **TDD test modification** — the `block-tdd-test-modification` hookify rule fires on test edits. This is intentional: the test reflects the new spec (9 denominations), not an error fix. The hook is a reminder; when the PR reviewer sees the test change, they should confirm the test was written before (or alongside) the implementation code, not after it was made to pass.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-66`.
