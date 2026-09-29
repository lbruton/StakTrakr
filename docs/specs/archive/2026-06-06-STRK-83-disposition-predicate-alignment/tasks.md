---
sketch: "STRK-83-disposition-predicate-alignment"
phase: tasks
created: 2026-06-05
approved: 2026-06-05
---

# STRK-83 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** the execution verbs (`/sketch run | workflow | dispatch`) refuse to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks name specific skills (`/start-patch`, `codacy-cli`, `/release patch`, `/update-spot-bundle`, `/vault-update`, `/pr-resolve`, `/sketch archive`). Invoke them by name verbatim — paraphrasing the steps inline drops the project rules the skill enforces. Genuinely irrelevant tasks → `N/A — <reason>`, never silently dropped.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Ensure sketch worktree exists ✓ `.worktrees/patch-3.35.8` on branch `patch/3.35.8` off `origin/dev` (merge-base == origin/dev `8f454884`); version `3.35.8` claimed in `version.lock`; STRK-83 → In Progress.
  - **File(s):** _no file changes — setup only_
  - **Acceptance:** `git worktree list` shows a StakTrakr `patch/<version>` branch under `.worktrees/STRK-83-disposition-predicate-alignment/` (NOT the generic `sketch/...` name — see `.context/sketch-conventions.md`). Working dir is that worktree, on `origin/dev` base. `git merge-base origin/dev HEAD == git rev-parse origin/dev`.
  - **If missing:** invoke **`/start-patch`** for STRK-83 to claim the version lock (high-water mark: `max(version.lock entries incl. expired, APP_VERSION on origin/dev)`) and create the worktree/branch. This is setup work — create it, don't stop.
  - **Leverage:** `/start-patch`; `.context/git-topology.md` §Worktrees + `EnterWorktree` base-ref caveat (branch from `origin/dev`, not `origin/main`).

## Sprint Cohort A — Foundation (parallel-safe)

- [x] **A.1** — N/A — no scaffolding/helpers/data structures needed
  - **File(s):** _none_
  - **Acceptance:** Documented skip. The change reuses the existing global `isDisposed` chokepoint and the existing `EMPTY_DISPOSITION_ITEM` Playwright fixtures (`tests/playwright/core/disposition.spec.js:56`, `tests/playwright/archive/issue-ac-matrices/strk-117-disposition-section-config.spec.js:52-58`). No new modules, types, or fixtures are introduced before the test/impl cohorts.

## Sprint Cohort B — Tests · RED (parallel-safe across files)

- [x] **B.1 [P]** — Failing unit tests for the canonical `isDisposed()` contract ✓ primary path (new unit file, no fallback → `[P]` held); RED confirmed: `{}`, `[]`, non-object return `true` today (3 fails), other 5 pass.
  - **File(s):** `tests/unit/disposition-predicate.test.js` (new) — _or extend an existing `tests/unit/*` file if one already covers `js/constants.js` helpers._
  - **Acceptance:** Assertions cover AC-1 in full: `isDisposed()` returns `false` for `{disposition:{}}`, `{disposition:null}`, `{disposition:undefined}` / `{}`, `{disposition:[]}`, `{disposition:"x"}` (non-object); returns `true` for `{disposition:{type:"sold"}}`. All new assertions FAIL (red) against current `return !!item?.disposition;` (the `{}` and `[]` cases currently return true).
  - **Leverage:** mirror the load/import pattern of `tests/unit/cloud-sync-convergence-audit.test.js` for pulling `js/constants.js` globals into Node. **Fallback if the browser global can't be cleanly imported in Node:** assert AC-1 via Playwright `page.evaluate(() => window.isDisposed(...))` inside `tests/playwright/core/disposition.spec.js` instead (that file is already in the File Map).
  - **`[P]` caveat:** the `[P]` parallelism is valid ONLY on the primary path (new unit file). **If the Playwright fallback is taken, B.1 shares `disposition.spec.js` with B.2 → strip `[P]` and run B.1 after B.2 (or fold both into one task).** The execution conductor must re-confirm the path before dispatching B.1 and B.2 concurrently.
  - **Maps to:** AC-1

- [x] **B.2 [P]** — Failing Playwright tests for empty-disposition consistency ✓ RED confirmed: empty-disposition row renders `class="disposed-row"` + `disposition-badge--undefined` today (fails `not.toHaveClass`).
  - **File(s):** `tests/playwright/core/disposition.spec.js` (modify)
  - **Acceptance:** Reusing `EMPTY_DISPOSITION_ITEM`, add assertions that FAIL against current behavior:
    - **AC-3 filter symmetry:** in disposed-filter **hide/active** mode the empty-disposition Item **is visible**; in **show-only** mode it **is excluded**. (Currently it's hidden in hide mode AND included in show-only — both wrong.)
    - **AC-2 cross-surface:** the empty-disposition Item shows **no** "disposed" inline badge, **no** `disposed-row`/`disposed-card` styling, and is **not** counted in the disposed summary total. (Currently all treat `{}` as disposed.)
    - **AC-4 (regression guard, should stay GREEN):** assert the empty-disposition Item still renders **zero** disposition sections in the view modal — the existing test at `disposition.spec.js:615-635` already covers this; keep it passing.
  - **Leverage:** existing `EMPTY_DISPOSITION_ITEM` fixture; existing disposed-filter + summary test helpers in the same spec; the `showAppConfirm`/modal patterns already used in the file.
  - **Maps to:** AC-2, AC-3, AC-4

## Sprint Cohort C — Implementation · GREEN (sequential — single atomic commit)

- [x] **C.1** — Consolidate all disposition checks on `isDisposed()` ✓ GREEN: unit 176/176, disposition.spec 18/18 (incl. AC-4 empty-section + trade-linking). 5 sites migrated; provenance fallbacks + 17 isDisposed callers untouched.
  - **File(s):** `js/constants.js`, `js/viewModal.js`, `js/filters.js`, `js/inventory.js`
  - **Acceptance:** All B.1 + B.2 RED tests pass; the existing zero-section test (`disposition.spec.js:615-635`), the trade-linking suite (`disposition.spec.js:661-827`), and the archived AC-6 test stay GREEN. Edits, in **one commit** (the lockstep — `isDisposed` tighten + `filters.js:968` migration MUST land together or empty-disposition Items vanish from all views):
    1. `js/constants.js:518` — tighten `isDisposed()` to: non-null, `typeof === "object"`, not `Array.isArray`, `Object.keys(item.disposition).length > 0`. Update its JSDoc to state empty/array/non-object reject. (AC-1)
    2. `js/viewModal.js:862-868` — replace the duplicated 4-part guard with `if (!isDisposed(item)) return null;`. (AC-4, D-2)
    3. `js/viewModal.js:~1139` — trade autocomplete `!inv.disposition` → `!isDisposed(inv)`. (AC-5)
    4. `js/filters.js:~968` — hide-mode `!item.disposition` → `!isDisposed(item)`. (AC-3, AC-5)
    5. `js/inventory.js:~876, ~912, ~982` — trade-link guards `!disposedItem?.disposition` → `!isDisposed(disposedItem)`. (AC-5)
    - **Leave unchanged:** `js/viewModal.js:769,795` (`source.disposition || {}` provenance fallbacks — Non-Goal). **No edits** at the 17 existing `isDisposed()` call sites (card-view, inventory-table, events, the inventory.js dispose/restore guards, viewModal restore button, `filters.js:972`) — they inherit the fix via the chokepoint.
  - **Depends on:** B.1, B.2
  - **Leverage:** the existing `_buildDispositionSection()` 4-part guard is the exact (inverted) target semantics for step 1; `window.isDisposed` global already in scope at every call site (load order verified — constants.js before viewModal.js; runtime-only calls).
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5
  - **Commit:** `fix(STRK-83): C.1 consolidate disposition checks on isDisposed()`

---

## Standard Closing Tasks

> Numbered CLOSE-1…8, continuing the checklist. StakTrakr skill bindings per `.context/sketch-conventions.md` — verbatim, none optional.

- [x] **CLOSE-1. Run full test suite** — zero regressions ✓ `npm run test:unit` 176/176, `npm test` (core Playwright) 181/181 (3.3m).
  - **File:** _verification only_
  - Run **`npm run test:unit`** (B.1) and **`npm test`** (core Playwright PR gate — B.2 + all existing disposition/trade-linking specs). All green. If anything fails, fix the implementation, not the test (tests are the spec).

- [x] **CLOSE-2. Codacy CLI scan** — security + quality ✓ `codacy-cli` ran. **0 findings attributable to the change.** Project ESLint (`npm run lint`) = exit 0. Codacy CLI's 1260 raw findings are all config-artifact (1161 `no-undef` for browser/script-tag globals — Codacy's ESLint lacks the repo `.eslintrc`) or pre-existing (64 Lizard complexity on large methods; my edits are complexity-neutral; 8 `no-case-declarations` in an untouched switch). opengrep crashed (locale `ascii` bug — no SAST run); trivy multi-target CLI quirk. Watch item for the dashboard: `new Function` in the unit test (trusted-source slice-and-eval, mirrors existing `cloud-sync-*.test.js`) → classify false-positive at CLOSE-7 if re-posted.
  - **File:** _scan only_

- [x] **CLOSE-3. Generate verification stamp** ✓ all 6 ACs cited in `## Verification Stamp` below; no gaps.
  - **File:** append to bottom of this `tasks.md` under `## Verification Stamp`.
  - One line per AC (AC-1…AC-6) citing the proving test/impl line or named test. **UI verification:** N/A — `approach.md` UI Contract is N/A (no UI surface), so test-only citations are sufficient; no mockup screenshot required. Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp.

- [x] **CLOSE-4. Version bump** ✓ `3.35.7 → 3.35.8` (6 files via `/release` Phase 1 resume) + `/update-spot-bundle` (+4 sqld, coverage → 2026-06-06); sw.js re-stamped `v3.35.8` by hook; check-release-sync passed. Commit `2f463177`.
  - **File:** project version files (owned by the skill).
  - **MUST invoke `/release patch`**, **preceded by `/update-spot-bundle`** (runs on every StakTrakr version-bump PR; writes to the main checkout — copy the bundle into the worktree afterward per `git-topology.md` §Spot Bundle).

- [x] **CLOSE-5. Vault update + close issue** ✓ architecture.md warning replaced with single-source-of-truth note (AC-6) + sketch committed to DocVault `main` (`d11279f`). Used a **scoped** commit, not the full `/vault-update`/vault-sweep, because DocVault held 7+ unrelated dirty files (specflow templates/conventions) that must not be bundled. Plane STRK-83 → **In Review** (Done deferred to merge per lifecycle; see CLOSE-8).
  - **Maps to:** AC-6

- [x] **CLOSE-6. Open PR** → targets **`dev`** ✓ draft [#1214](https://github.com/lbruton/StakTrakr/pull/1214), base `dev`, head `patch/3.35.8`, label `codacy-review`. Body links STRK-83 + sketch folder + test plan.
  - Title: `fix(STRK-83): align disposition predicates on empty-object payloads`.
  - Body: link to [STRK-83](https://plane.lbruton.cc/lbruton/browse/STRK-83/), link to the sketch folder `DocVault/Projects/StakTrakr/sketches/STRK-83-disposition-predicate-alignment/`, and a test-plan checklist.
  - Verify `--repo` targets local origin; ensure `/update-spot-bundle` ran and the worktree is rebased on `origin/dev`.

- [~] **CLOSE-7. Resolve PR review threads** — Codacy AI reviewer posted 2 inline findings (after the draft CI pass); both triaged, fixed in `9c8bd456`, replied, and **resolved**:
  - 🟡 MEDIUM `inventory.js:876` — valid: trade-link cleanup guards shouldn't use the display predicate (bailed on `{}`, leaving orphaned `tradedFromUuid`). **Acted** — reverted 876/912/982 to `!disposedItem?.disposition` (user-confirmed scope refinement).
  - ⚪ LOW `disposition-predicate.test.js:19` — valid: slice-and-eval depended on `LS_KEY` order. **Acted** — regex extraction on the function's own closing brace.
  - 6 other comments were bot summaries (Copilot overview "no comments", 2× Cloudflare deploy, Codacy "0 issues / 8 complexity").
  - **CodeRabbit round** (after the PR was marked ready, commit `55eb564b`): 4 comments — 2 **acted** (added STRK-83 row to `coverage-map.csv`; added active-row idx-0 assertions across all 3 filter modes), 2 **declined with rationale** (What's New 3–5 cap → conflicts with `/release` skill's enforced cap of 8; strict `!== null` → no `eqeqeq` rule + 271 `!= null` uses in `js/`, established idiom). All replied + resolved.
  - **Final: 0 unresolved threads; PR ready + MERGEABLE; CI green (CodeQL re-running, reliably passes).**
  - **MUST invoke `/pr-resolve`** — scan BOTH inline diff threads AND review-body findings (Codacy/Copilot post criticals as summary comments too). Critical/High fixed or false-positive-with-reason; Medium fix-or-waive; Low/Info advisory. Re-check for auto-scanner re-posts after each new commit. _Pre-classify any STAK-prefix nags as false positives (post-migration noise)._

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-83`** — moves the folder to `archive/YYYY-MM-DD-STRK-83-disposition-predicate-alignment/`, saves a mem0 summary, confirms the issue is Done.

---

## UI Contract Traceability

**N/A** — `approach.md` `## UI Contract` is N/A (no UI surface; no mockup/playground/screenshot cited in any prior phase). The empty-disposition rendering side-effects (badge/styling/section absence, filter placement) are verified behaviorally in Cohort B (AC-2, AC-3, AC-4), not against a visual-fidelity contract.

---

## Verification Stamp

Per-AC traceability (CLOSE-3). UI Contract is N/A → test/impl citations suffice (no mockup screenshot required).

- [x] AC-1 — `isDisposed()` strict contract — verified by `tests/unit/disposition-predicate.test.js` (8 assertions: `{}`/null/`[]`/non-object/undefined → false; populated + single-key → true); impl `js/constants.js:518`.
- [x] AC-2 — empty `{}` treated not-disposed across surfaces — verified by `tests/playwright/core/disposition.spec.js` "empty-disposition items stay active across filter modes, badge, and styling (STRK-83)" (show-all: no `disposed-row` class, no `.disposition-badge`); the `js/constants.js:518` chokepoint propagates to all 17 `isDisposed()` callers (row/card/table styling, badge, `updateSummary` tally).
- [x] AC-3 — filter symmetry / no vanishing item — verified by the same Playwright test (hide mode → empty row visible; show-only → excluded; real disposed inverse); impl `js/filters.js:968` (`!isDisposed(item)`) moving in lockstep with `:972`.
- [x] AC-4 — renderer consumes `isDisposed()` — verified by `tests/playwright/core/disposition.spec.js:615` "active and empty-disposition items do not render a Disposition section" (stays green); impl `js/viewModal.js` `_buildDispositionSection()` → `if (!isDisposed(item)) return null;`.
- [x] AC-5 — single source of truth for **display/filter/selection** decisions — `isDisposed()` now governs: the disposed filter (`filters.js:968`), the section renderer (`viewModal.js` guard), the trade autocomplete (`viewModal.js`), and the 17 existing callers (styling/badge/summary). **Refined post-review (Codacy MEDIUM):** the 3 trade-link **data-mutation** guards (`inventory.js:876/912/982`) keep `!disposedItem?.disposition` (object-presence) — they need to operate on a malformed `{}` disposition for cleanup, so they are deliberately NOT routed through the display predicate. `source.disposition || {}` provenance fallbacks remain exempt. Trade-linking suite green (`disposition.spec.js:661-827`).
- [x] AC-6 — architecture.md warning removed — verified at `DocVault/Projects/StakTrakr/Foundation/architecture.md:361-363` (replaced with a "Single source of truth (STRK-83)" note); DocVault commit lands via `/vault-update` at CLOSE-5.

All 6 ACs verified — no gaps.

---

> **Multi-model dispatch hint:** B.1 and B.2 are `[P]` (independent files — unit vs Playwright) and can be split across two models in the RED phase. C.1 is a single atomic commit (the lockstep) and is best done by one model, then verified. The B→C boundary is the natural TDD model-routing seam.
