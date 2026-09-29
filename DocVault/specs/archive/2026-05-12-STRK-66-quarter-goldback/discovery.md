---
sketch: "STRK-66-quarter-goldback"
phase: discovery
created: 2026-05-11
---

# STRK-66 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on. Include paths and a one-line note on each._

| Path                                                               | Role                                                                        | Notes                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/constants.js:588-596`                                          | `GOLDBACK_DENOMINATIONS` array                                              | 8 entries today; prepend 1/4 entry                                                                                                                                                    |
| `js/events.js:1763-1769`                                           | `updateDenomLabels`                                                         | Renders fraction glyphs for ½; needs ¼ branch                                                                                                                                         |
| `js/bulkEdit.js:587-629`                                           | `updateBulkDenomLabels`                                                     | Same pattern as events.js at line 621                                                                                                                                                 |
| `js/retail.js`                                                     | `GOLDBACK_WEIGHTS` map                                                      | Maps slug suffixes to oz weights for slug parser                                                                                                                                      |
| `devops/pollers/shared/goldback-scraper.js:54`                     | `DENOMINATION_MULTIPLIERS`                                                  | Spot-denomination output: feeds `goldback-spot.json`. Needs `g0.25` key.                                                                                                              |
| `devops/pollers/shared/api-export.js:964-970`                      | `buildGoldbackDenominations`                                                | Emits denomination list for v1 API                                                                                                                                                    |
| `devops/pollers/shared/api-export-v2.js:832-840`                   | `buildGoldbackDenominations`                                                | Emits denomination list for v2 API                                                                                                                                                    |
| `devops/pollers/shared/price-extract.js:1527`                      | Bounds-guard regex (per-product slugs like `goldback-idaho-g0.25`)          | `/g(\d+)$/i` — doesn't match decimal suffixes                                                                                                                                         |
| `tests/playwright/goldback-type.spec.js:269`                       | Test 9 — add/edit denomination dropdown                                     | Asserts `toHaveLength(8)`, `options[0].text === "½ Goldback"` — needs update to 9 + `¼`                                                                                               |
| `tests/playwright/goldback-type.spec.js:337`                       | Test 13 — bulk-edit denomination dropdown (Goldback branch at line 360-361) | Asserts `goldOptions.toHaveLength(8)`, `goldOptions[0].text === "½ Goldback"` — needs same update for AC-3                                                                            |
| `index.html`                                                       | Static `#itemGbDenom` options                                               | Runtime rebuilds the dropdown from `GOLDBACK_DENOMINATIONS` via `updateDenomLabels` — static HTML is overwritten on render. No edit required, but verified empirically by tests 9/13. |
| `DocVault/Projects/StakTrakr/Foundation/data-pipelines.md:372-395` | Foundation: denomination table                                              | Idaho row + g0.25 row + slug count recalculation needed                                                                                                                               |
| `DocVault/Projects/StakTrakr/Foundation/reusable-patterns.md:96`   | Foundation: supported denominations line                                    | Update to include g0.25                                                                                                                                                               |

## Prior Decisions

- 2026-05-09 — Slug naming: `g0.25` only (no `gquarter` alias). The `ghalf` alias is grandfathered; new denoms use the numeric form. (Captured in STRK-66 issue body, Decisions section.)
- 2026-05-09 — Scope: single PR covering UI + scraper + bounds-guard fix + foundation docs. Modal option without matching prices would look broken. (Same source.)
- 2026-05-09 — Bounds-guard regex fix bundled into this issue rather than a separate ticket. (Same source.)
- 2026-05-09 — Idaho needs zero state-registration code — frontend is manifest-driven via `_parseGoldbackSlug()` regex. (Same source.)

## External References

- [Goldback official announcement](https://www.goldback.com/the-1-4-goldback-is-coming-soon/) — confirms 1/4 = 1/4000 oz, Idaho series, March 24, 2026 release
- [Hero Bullion 1/4 Goldback overview](https://www.herobullion.com/1-4-goldbacks-news-2026/) — retail context
- Code-oracle recon on dev branch, 2026-05-09 — identified exact file locations and line numbers above

## Constraints

- **No build step:** vanilla JS, changes must work on `file://` and HTTP; no transpilation.
- **ghalf alias is grandfathered** — `GOLDBACK_WEIGHTS` already has `ghalf`; don't remove it; `g0.25` is the new pattern.
- **TDD order:** test update (goldback-type.spec.js) must be written first; test must fail before implementation code is added.
- **Bounds-guard and scraper changes must ship together** — there are two distinct surfaces that must align:
  - `goldback-scraper.js` emits the Goldback spot denomination price map (`goldback-spot.json`). It needs `g0.25` added to `DENOMINATION_MULTIPLIERS` so the spot map publishes a `g0.25` denomination key.
  - `price-extract.js` parses per-product retail slugs (e.g., `goldback-idaho-g0.25`) and gates them against per-denomination price bounds. Without the regex fix, decimal-suffix slugs fall through to G1 bounds — a silent data-quality bug (4× the correct ceiling).
    Both must land in the same PR.

## Open Questions

_None — code-oracle recon surfaced all file locations. Approach phase can proceed._

## Discovery Summary

All in-code changes are localized additive edits: one new object prepended to an array, two label-rendering branches added, one map key added, three publisher files get one new denomination key, one regex tightened to `\d+(?:\.\d+)?`, two test assertions updated from 8→9 (tests 9 and 13), and two Foundation docs updated. No schema migrations, no new files, no cross-cutting refactors.

In addition to the in-code changes, the PR is a **runtime version bump**: `/release patch` edits 6 version-bearing files + the `stamp-sw-cache` pre-commit hook restamps `sw.js`, and `/update-spot-bundle` rebuilds `data/spot-history-bundle.js`. The `check-release-sync` hook will block the commit until all version files are consistent. This is standard StakTrakr release plumbing, not extra scope, but it must be in the same PR.

The trickiest piece is the TDD ordering: edit the failing tests first, run them locally to record the red state, then implement and turn them green — without leaving an intentionally-red intermediate commit on the branch (the PR CI only needs a green final state plus evidence the tests were red pre-implementation).

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-66`.
