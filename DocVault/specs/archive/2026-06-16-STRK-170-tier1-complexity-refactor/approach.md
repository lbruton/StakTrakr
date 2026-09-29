---
sketch: "STRK-170-tier1-complexity-refactor"
phase: approach
created: 2026-06-14
---

# STRK-170 — Approach

_How we'll build it. The tasks phase produces the concrete work plan._

## High-Level Architecture

This is a **behavior-preserving refactor campaign**, not a feature. There is no new architecture and no new runtime surface — the shape of the work is: take each of the 38 god-functions in the AC-10 inventory and decompose it below ccn 25 / nloc 150 by extracting cohesive sub-logic into **module-private helper functions in the same file**, while its rendered DOM, storage writes, and user flows stay byte-stable (AC-5).

The unit of delivery is the **per-file PR cohort** (AC-6): one PR refactors _all_ of a file's targeted functions together, so helper extraction can't shift complexity onto an un-addressed sibling. Each cohort follows the same internal pipeline:

1. For the file's char-test-required functions, add a characterization test that pins **current** behavior _first_ (TDD, same PR — AC-4).
2. Refactor, giving **every extracted helper a JSDoc block** (D-7).
3. Verify locally: `codacy-analysis analyze --tool Lizard --files <cohort files>` shows every targeted function ≤ 25/150 **and** no new finding (dedup-in-PR, AC-2).
4. Run the cohort-type verification gate (D-8): `npm test` for every cohort, **plus the extended visual/layout spec for DOM-render cohorts** (AC-3).
5. Open an **unbumped** PR to `dev`.

After all ~19 cohorts merge, a single `/release patch` (preceded by `/update-spot-bundle`) ships the campaign (AC-7), and a final Codacy-Cloud residual triage pass ignores the justified leftovers per-alert (AC-8), excluding the STRK-195 carveout.

The refactor _technique_ is chosen per function shape (the discovery `refactor_hint`s cluster into four), but the _mechanism_ is uniform: extract named, JSDoc'd helpers, keep them private to the module, keep behavior identical. No public API, storage schema, or DOM contract changes.

## Key Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                     | Rationale                                                                                                                                                                                                                                                                                                | Tradeoff                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | **Extracted helpers stay module-private in the same file** (not new sibling modules)                                                                                                                                                                                                                                                                                         | This is a _function_-complexity issue, not a file-size one (file-nloc is already 0 findings at 2500). Same-file helpers avoid re-triggering the dedup-in-PR hazard and keep STRK-170 distinct from STRK-169's file-split campaign (a non-goal).                                                          | File locality/length stays roughly flat; a future reader still opens one large file. Mitigated by D-1a.                                                                                                        |
| D-1a | **Fallback: if same-file extraction would push file-nloc > 2500, extract to a cohesive sibling module** (STRK-169 style), ensuring the moved helper is itself < 25/150. In this zero-build app that also means: add the new `js/<name>.js`, wire a `<script>` into `index.html` at the correct load-order position, and expose/consume globals intentionally (see File Map). | Prevents a refactor from creating a _new_ file-nloc finding (an AC-2 violation).                                                                                                                                                                                                                         | Reintroduces a cross-file move + an `index.html` script-order edit for that one cohort; verify the sibling has no Tier-1 of its own and loads after its dependencies (the `safeGetElement` load-order gotcha). |
| D-2  | **Technique chosen per function shape**, not one uniform pattern: `table-dispatch` for if/else-or-switch cascades · `split-render` for DOM builders · `guard-clause early-return` for nested-conditional validators · `extract-helper` for the rest                                                                                                                          | The 38 targets are genuinely different shapes (a 12-branch undo cascade vs a 45-column CSV builder vs a 17-field matcher); forcing one pattern would bloat some and obscure others.                                                                                                                      | No single mechanical recipe the tasks phase can copy-paste; each cohort names its technique.                                                                                                                   |
| D-3  | **Characterization tests pin the EXISTING function's observable behavior** (golden output of the god-function as it is _today_), added in the same PR before the refactor (TDD). Unit test (`tests/unit/`) for pure-logic targets; Playwright (`core/` or `extended/`) for DOM/storage/flow targets                                                                          | The 14 char-test functions are the thin-coverage hot spots; a golden-output test of current behavior is the only proof the refactor preserved it. The test calls the _current_ function — never a not-yet-extracted helper.                                                                              | 14 new/extended test artifacts; some Playwright char tests are slow.                                                                                                                                           |
| D-4  | **Per-file cohort PRs, shipped unbumped; one closing `/release patch`**                                                                                                                                                                                                                                                                                                      | Contains each PR's blast radius to one module, makes dedup-in-PR checkable per file, and mirrors the proven STRK-169 no-bump campaign.                                                                                                                                                                   | ~19 PRs of review/CI overhead instead of a few big ones. Accepted — small reviewable diffs beat one un-reviewable mega-PR for a complexity refactor.                                                           |
| D-5  | **dedup-in-PR enforced by a local `codacy-analysis` pre-flight before each push** — `codacy-analysis init --remote gh lbruton StakTrakr` once, then `codacy-analysis analyze --tool Lizard --files <cohort files>`                                                                                                                                                           | Catches relocated complexity (AC-2) _before_ the cloud check, so a PR doesn't bounce on a net-new finding.                                                                                                                                                                                               | A manual pre-flight step per cohort; local thresholds must be the live cloud values (hence `init --remote`, since the config is gitignored).                                                                   |
| D-6  | **`settings-listeners.js` is out of scope** (deferred to STRK-195); its findings are carved out of the closing accounting (AC-8 amendment)                                                                                                                                                                                                                                   | Its genuine handlers are entangled in a 942-nloc event-wiring rollup and sit on the highest-regression parse-time surface; surgical extraction is riskier than a dedicated holistic effort.                                                                                                              | This campaign's dashboard won't read literal-zero until STRK-195 lands. Accepted and documented.                                                                                                               |
| D-7  | **Every extracted or newly-named helper carries a JSDoc block**                                                                                                                                                                                                                                                                                                              | The repo's CodeRabbit **75% docstring-coverage pre-merge gate** blocks a PR (`CHANGES_REQUESTED` / `BLOCKED`) with all status checks green and 0 threads if new/modified JS functions lack docstrings (`.context/review-and-ci.md`). A 19-file helper-minting campaign would hit this on _every_ cohort. | Doc overhead on each helper. Non-negotiable for merge — and the failure is invisible to `statusCheckRollup`, so skipping it silently blocks the PR.                                                            |
| D-8  | **Verification gate is per cohort type:** `npm test` (core) for every cohort; **DOM-render cohorts additionally run `npm run test:extended -- tests/playwright/extended/visual-layout-regressions.spec.js`** (`core/mobile-and-layout.spec.js` is already in `npm test`)                                                                                                     | AC-5 byte-stable DOM for render functions is guarded by the _visual_ suite, which lives in `extended` and is **not** part of `npm test` (core). Without this, a cohort can pass the pipeline while skipping the UI guard.                                                                                | Slower CI for render cohorts.                                                                                                                                                                                  |

## File Map

_The "modified" set is the refactor target files (in-place). Test files are created or extended per the char-test plan. Tasks.md maps cohorts to these paths._

### New

- `tests/unit/*.test.js` — characterization **unit** tests for pure-logic char-test targets (e.g. `extractDynamicChips`). Each calls the existing god-function and asserts current output. Exact files decided in tasks. **Unit-only additions do NOT require a `coverage-map.csv` row** (that map covers Playwright specs only).
- **D-1a fallback only** — a sibling `js/<cohesive-name>.js` module **if** a cohort must move a helper out of an over-2500 file. Introducing one also requires the `index.html` edit below.

### Modified

- **Refactor targets (19 files, in place):** `js/api.js` · `js/bulk-image-cache.js` · `js/bulkEdit.js` · `js/catalog-api.js` · `js/changeLog.js` · `js/chip-grouping.js` · `js/csv-export.js` · `js/diff-modal.js` · `js/filters.js` · `js/image-cache-modal.js` · `js/inventory-backup.js` · `js/inventory-import.js` · `js/inventory-table.js` · `js/inventory.js` · `js/market-data.js` · `js/retail.js` · `js/search.js` · `js/vault.js` · `js/viewModal.js`
- `index.html` — **only if** a D-1a sibling module is introduced: add its `<script defer>` at the correct load-order position (after dependencies, before consumers).
- Existing `tests/playwright/core/*.spec.js` — extended in place for DOM/storage char-test targets (prefer extending over new files).
- `tests/playwright/coverage-map.csv` — one row **per new or renamed Playwright spec** only (AGENTS.md gate). Not required for unit-only test additions.
- Release artifacts (closing PR only, via `/release patch`): `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js` (What's New) + `data/spot-history-bundle.js` (via `/update-spot-bundle`).

### Deleted

- None. (Helpers are extracted in-place; D-1a _adds_ a file, never deletes one.)

## Cohort Map (PR structure — sequencing is a tasks-phase concern)

19 cohorts, grouped by weight for the tasks phase to order. Each row = one unbumped PR.

| Group                                                  | Cohorts (file → # targeted fns)                                                                                                                                                                                                                                                                 | Notes                                                                                                                                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Anchors (heaviest + highest-risk, most char tests)** | `inventory.js` (5: editItem⭐, duplicateItem, confirmRemoveItem, splitInventoryItem, +click-dispatcher) · `inventory-import.js` (3: complete⭐, reader.onload, showImportDiffReview) · `inventory-backup.js` (3) · `vault.js` (3: handleVaultAction⭐, openVaultModal, vaultRestoreWithPreview) | editItem ccn133 / complete ccn132 / handleVaultAction ccn84 — the campaign's hardest decompositions. `inventory.js` is the most likely D-1a fallback candidate (check file-nloc headroom first). |
| **Mid (2–4 fns)**                                      | `market-data.js` (3, DOM-render) · `changeLog.js` (2) · `diff-modal.js` (2) · `filters.js` (3, all promoted) · `search.js` (2, promoted) · `inventory-table.js` (2: updateSummary + promoted row-render, DOM-render)                                                                            | `filters.js`/`search.js` are new cohorts from AC-9 promotions. DOM-render cohorts trigger the D-8 visual gate.                                                                                   |
| **Mop-ups (1 fn each)**                                | `api.js` · `bulk-image-cache.js` · `bulkEdit.js` · `catalog-api.js` (searchItems⭐ 907nloc) · `csv-export.js` · `chip-grouping.js` · `image-cache-modal.js` · `retail.js` (2: _syncRetailV2 + promoted per-slug) · `viewModal.js` (DOM-render)                                                  | Small, parallelizable late. `catalog-api.searchItems` is nloc-only (907) — pure split-render.                                                                                                    |

> ⭐ = top-priority decomposition (ccn > 100 or nloc > 300). DOM-render cohorts (`market-data.js`, `inventory-table.js`, `viewModal.js`, parts of `diff-modal.js`) carry the D-8 extended visual gate.

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. Behavior preservation (AC-5) explicitly forbids any change to localStorage/IndexedDB shape or DOM output.

## Tradeoffs Surfaced for Review

- **D-1 vs D-1a** is the one judgment worth confirming at tasks time per-file: default is same-file helpers, but a couple of already-large files (`inventory.js` especially) may force the sibling-module fallback (with its `index.html` script-order edit). Tasks should check current file-nloc headroom for each anchor before committing to in-file extraction.
- **~19 PRs** is a lot of review surface. If you'd prefer fewer, the only safe consolidation is _by directory of concern_ (e.g. all `inventory*` files in one PR) — but that weakens the per-file dedup check. Recommend keeping them split.

## UI Contract

**N/A — no new UI surface.** This is a behavior-preserving refactor; no new views, modals, or layout. ~8 targets _are_ DOM-render functions (`_renderVendorTable`, `openMarketDetailModal`, `inventory-table` row-render, `_createPriceHistoryChart`, etc.), and AC-5 requires their rendered output to stay **byte-stable**. The guard is enforced as a hard gate by **D-8**: DOM-render cohorts must run `tests/playwright/extended/visual-layout-regressions.spec.js` (extended) in addition to `npm test` — not merely "should stay green." `core/mobile-and-layout.spec.js` is already covered by `npm test`. No new mockup or contract is introduced.

## Out of Scope (follow-up issues)

- **STRK-195** — Refactor `settings-listeners.js` event-wiring complexity (the deferred `:656`/`:913` findings). Already filed (child of STRK-168).
- Tier-4 borderline (ccn 26–34) functions and Tier-3 regex-desync false-positives are **not refactored** — handled by the AC-8 closing triage (ignore), not code.

## Risk Notes

- **Risk:** in-file helper extraction pushes `inventory.js` (or another large file) over file-nloc 2500 → a _new_ Codacy finding (AC-2 violation). → **Mitigation:** D-1a — pre-check file-nloc headroom in tasks; fall back to a cohesive sibling module (+ `index.html` script-order edit) for that cohort.
- **Risk:** the **CodeRabbit docstring-coverage gate** silently blocks a cohort PR (`CHANGES_REQUESTED` with all checks green, 0 threads) when an extracted helper lacks JSDoc — the failure is invisible to `statusCheckRollup`. → **Mitigation:** D-7 — JSDoc every helper as it's written; check the CodeRabbit pre-merge panel before assuming a PR is mergeable.
- **Risk:** a "behavior-preserving" refactor silently changes rendered DOM or a storage write on a thin-coverage function. → **Mitigation:** the 14 char tests (D-3) + the D-8 visual gate for render cohorts.
- **Risk:** Lizard re-rolls an _extracted_ helper into its parent (the `_esc`-class desync) if a helper containing a tricky regex/quote lands mid-file. → **Mitigation:** keep regex-heavy helpers last in the file (the [[lizard-esc-regex-desync]] rule); verify each cohort with the local Lizard pre-flight, not just `node --check`.
- **Risk:** `catalog-api.searchItems` is nloc-only (907) with no high CCN — splitting it is pure mechanical extraction, but it's a network/parse path; a dropped `await` or reordered param-build changes behavior. → **Mitigation:** it has Numista integration coverage; verify the mocked search spec stays green.

---

## Review Archive — approach (2026-06-14)

### Resolution Summary

5 Codex inline marks + 1 `## CODEX Review` section. **All 5 accepted** (0 rejected, 0 your-call) — every claim verified against the repo / prior phases. Net edits: fixed the pipeline command to `codacy-analysis analyze --tool Lizard --files …` (mark #1); added **D-7** (JSDoc on every helper — CodeRabbit docstring gate, mark #2); expanded **D-1a** + File Map with the zero-build sibling-module + `index.html` script-order provision (mark #3); rewrote **D-3** + File Map so char tests pin the _existing_ function (not post-extraction helpers) and clarified `coverage-map.csv` is Playwright-only (mark #4); added **D-8** + hardened the UI Contract so DOM-render cohorts run the extended visual spec, not just `npm test` (mark #5).

### Original Codex marks (verbatim)

- **On the pipeline command (architecture) → resolved by the `analyze` fix:**

  > CODEX: The local verifier command is missing the `analyze` subcommand, so tasks copying this pipeline will fail before checking Lizard. `codacy-analysis --help` exposes `analyze [options] [path]`, and `codacy-analysis analyze --help` confirms the supported shape is `codacy-analysis analyze --tool Lizard --files <cohort files>`. The approach should use that exact command shape here, matching AC-1 and D-5.

- **On D-1 (docstring gate) → resolved by D-7:**

  > CODEX: This helper-heavy approach needs to carry the repo's CodeRabbit docstring gate into the architecture. `.context/review-and-ci.md` says new or modified JS functions need JSDoc or PRs can remain `CHANGES_REQUESTED`/`BLOCKED` with green status checks. Because STRK-170 will create many private helper functions across 19 files, D-1/D-2 should require JSDoc on extracted helpers so every cohort can merge cleanly.

- **On D-1a (sibling module / File Map) → resolved by the D-1a + File Map expansion:**

  > CODEX: D-1a is not fully reflected in the File Map. In this zero-build script-tag app, any new sibling JS module has to be named, loaded in `index.html` at the right point in the script order, and expose or consume globals intentionally. The current File Map has no possible `js/*` helper files and no `index.html`/entry-point script updates, so tasks have no safe path if they decide `inventory.js` or another anchor must use the D-1a fallback.

- **On D-3 (char-test looseness / coverage-map) → resolved by the D-3 + File Map rewrite:**

  > CODEX: The test guidance is too loose for TDD. Characterization tests must pass against the current code before extraction, but the File Map later suggests unit tests for `filters.js`/`search.js` matchers "if extracted as pure helpers"; those helpers do not exist pre-refactor, and discovery classifies the promoted filter/search targets as no-char-test-needed. Also, `coverage-map.csv` is the Playwright coverage map; unit-only tests under `tests/unit/*.test.js` should not be forced into that map unless a Playwright file is added or renamed.

- **On the UI Contract (visual gate) → resolved by D-8:**
  > CODEX: This conflicts with the cohort pipeline above, which only requires `npm test` (`test:core`). If visual/layout coverage "must stay green" for DOM-render cohorts, the approach should make the verification rule explicit by cohort type, for example `npm test` for every cohort plus `npm run test:extended -- tests/playwright/extended/visual-layout-regressions.spec.js` or the relevant extended/core layout target for DOM-render cohorts. Otherwise tasks can satisfy the pipeline while skipping the UI Contract's stated guard.

### CODEX Review (2026-06-15) — verbatim

**Verified**

- Read sketch conventions, StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, `.context/sketch-conventions.md`, and Foundation `coding-standards.md`.
- Checked current `requirements.md`, reconciled `discovery.md`, and `approach.md` for STRK-170.
- Verified the Codacy Analysis CLI command surface with `codacy-analysis --help` and `codacy-analysis analyze --help`.
- Checked `package.json` test scripts, `tests/unit/*.test.js`, `tests/playwright/coverage-map.csv`, and the entry-point script order in `index.html`.
- Read representative live target code in `js/chip-grouping.js`, `js/filters.js`, `js/search.js`, and script/global exposure patterns in major target files.

**Top concerns**

- The main cohort pipeline uses an invalid `codacy-analysis --tool Lizard` command; it needs `codacy-analysis analyze --tool Lizard --files <cohort files>`.
- The helper-extraction plan omits the CodeRabbit docstring gate for new/modified JS functions.
- The D-1a sibling-module fallback lacks File Map and script-loading guidance for this zero-build app.
- Characterization-test guidance risks testing post-extraction helpers instead of current behavior, and overstates `coverage-map.csv` obligations for unit-only tests.
- The UI Contract says visual/layout suites must stay green, but the pipeline only requires `npm test`; DOM-render cohorts need an explicit extended/layout verification gate.

**Unverified assumptions**

- I did not re-query Codacy Cloud because network is restricted in this turn; I relied on the reconciled discovery inventory plus local CLI help and live repo reads.
- I did not verify the Plane state for STRK-195; the approach and requirements now both carry the carveout wording.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch-tasks STRK-170`.
