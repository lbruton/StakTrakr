---
sketch: STRK-167-numista-instance-dedup
phase: tasks
created: 2026-06-07
approved: 2026-06-07
---

# STRK-167 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Paths trace to `approach.md`'s File Map._

> **Approval gate:** `/sketch run` refuses to run unless `approved:` above holds a `YYYY-MM-DD` date ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks name specific skills/commands verbatim (`/start-patch`, `codacy-analysis analyze --diff`, `/update-spot-bundle`, `/release patch`, `/vault-update`, `/pr-resolve`, `/sketch archive`). Invoke them as named — paraphrasing the steps inline is not equivalent. The Codacy scan is a **command** (`codacy-analysis analyze --diff`, Gen-3 CLI per `.context/sketch-conventions.md`), runnable via the `codacy-skills:codacy-analysis-cli` plugin skill in Claude; a non-Claude runner must use the command directly (it has no such slash skill).

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Ensure sketch worktree exists (StakTrakr `/start-patch` convention)
  - **File(s):** _no file changes — setup only_
  - **Acceptance:** `git worktree list` shows the patch worktree at `.worktrees/STRK-167-numista-instance-dedup/` (or `.worktrees/patch-<version>/`) on a `patch/<version>` branch based on `origin/dev`; `git merge-base origin/dev HEAD` equals `git rev-parse origin/dev`. Working dir is that worktree, not the main checkout.
  - **If the worktree does not exist yet:** create it via **`/start-patch`** (claims the version lock + creates the `patch/<version>` branch/worktree). Do NOT use the generic `sketch/{ISSUE-ID}` name — StakTrakr requires `patch/<version>` (`.context/sketch-conventions.md`, `.context/git-topology.md`).
  - **Leverage:** `/start-patch` skill.

## Sprint Cohort A — Foundation (parallel-safe)

- [x] **A.1** — Add diff-modal control + badge CSS to the `#diffReviewModal` style block
  - **File(s):** `index.html` (inline `<style>` block — the home of all `dm-*` styles)
  - **Acceptance:** `.dm-qty-options` (radiogroup row), `.dm-qty-opt` (`.local`/`.remote`/`.sum` variants, ≥44px touch target), `.dm-qty-verb`, `.dm-qty-num`, `.dm-dup-flag` (+`.dm-dup-icon`/`.dm-dup-text`), and `.sr-only` rules exist. Badge uses `background: color-mix(in srgb, var(--warning) 15%, var(--bg-secondary)); color: var(--warning-text, var(--warning));` — **no hardcoded hex**, no raw `--warning` background-with-text. Sum-verb accent uses `--info`; selected state reuses `.dm-field-value.selected`.
  - **Leverage:** mockup `playground/STRK-167-numista-merge/index.html` style block; `.context/implementation-gotchas.md:26-30` (`--warning` contrast); `css/styles.css` token defs.
  - **Maps to:** AC-10, AC-11 (presentational); D-4/A6 (contrast)

## Sprint Cohort B — Tests · RED (sequential within file; B.1 ∥ B.2)

_Write tests that encode the EARS acceptance criteria BEFORE implementation. All must FAIL initially (impl absent)._

- [x] **B.1 [P]** — Unit tests for the instance key, enrichment, and collapse
  - **File(s):** `tests/unit/diff-engine-instance-key.test.js` (new)
  - **Acceptance:** Failing (red) tests covering — AC-1: `computeItemKey` instance tier = `numistaId|year|grade|certNumber`, grade/cert trim+lowercase, empty→`""`; AC-2: `changeLog.js` `computeItemKey` returns identical keys to `DiffEngine.computeItemKey` (3-site equivalence); AC-3: API-sourced vs CSV-sourced same ungraded instance (differing name/acquisition-date) → identical keys; AC-4: differing `year` OR `grade` OR `certNumber` → different keys; AC-6: the extracted pure helper `DiffEngine.collapseByInstanceKey(rows)` sums `qty` for same-instance-key rows and keeps distinct years/grades separate (loadable in the same diff-engine harness); **D-7**: `enrichItemIdentities` consumes one local UUID per incoming match (FIFO, `usedUUIDs` invariant) AND a numista-bearing incoming row that misses the instance bucket is **NOT** enriched via `name|date` (stays an add).
  - **Leverage:** harness pattern in `tests/unit/diff-engine-normalization.test.js:21-24` (`readFileSync` + `new Function("window", src)`); load BOTH `js/diff-engine.js` and `js/changeLog.js` for the equivalence test.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-6, D-7

- [x] **B.2 [P]** — Playwright tests for the merge flow + UI controls (rewrite the onboarding spec)
  - **File(s):** `tests/playwright/core/numista-import-onboarding.spec.js` (rewrite), `tests/playwright/coverage-map.csv` (update Numista entry ~:75)
  - **Acceptance:** Failing (red) tests covering — AC-7: non-empty inventory import opens the diff-review modal (`#diffReviewModal`), NOT a destructive replace dialog; AC-8: importing the same CSV twice with no changes between yields **zero** duplicate `numistaId+year+grade+cert` items; AC-9: empty-inventory import presents all rows as adds through the merge path (no replace branch); AC-6 (import flow): a CSV with repeated N# (same year, ungraded) collapses to a single row with summed `qty` after the merge applies; AC-10: qty 3-way control renders Keep/Replace(default)/Add, selecting "Add to existing" applies `local+remote`, and Space/Enter activates a focused `[role=radio]`; AC-11: an ungraded import row sharing `numistaId+year` with a **graded** existing item shows the advisory badge, is still skippable, and **no `_possibleDuplicate` key persists** on any saved item after apply (D-4); AC-12: the STRK-165 onboarding-replace dialog no longer appears; AC-13: `importNumistaCsv(file, true)` replaces directly with no diff modal.
  - **Leverage:** existing modal-mock pattern in `tests/playwright/core/import-export.spec.js:278-398`; dialog-testing pattern (`#appDialogModal`) per `CLAUDE.md`; the CSV is built inline (as the current spec does at `:44-47`).
  - **Maps to:** AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, D-4

## Sprint Cohort C — Implementation · GREEN (sequential; same-file tasks cannot be `[P]`)

- [x] **C.1** — Instance key + shared helpers in `diff-engine.js`
  - **File(s):** `js/diff-engine.js`
  - **Acceptance:** `_instanceKey(item)` helper returns `numistaId|year|grade|certNumber` (year=`item.year`; grade/cert trim+lowercase, empty→`""`); `computeItemKey`'s tertiary tier uses it. **Also add the pure helper `DiffEngine.collapseByInstanceKey(rows)`** (group rows by `_instanceKey`, sum `qty`, distinct years/grades stay separate) for the import collapse. B.1's AC-1/3/4 and AC-6 unit tests pass.
  - **Depends on:** B.1
  - **Maps to:** AC-1, AC-3, AC-4, AC-6 · D-2
  - **Leverage:** current ladder at `js/diff-engine.js:325-343`.

- [x] **C.2** — Enrich buckets + no `name|date` fallback for numista rows
  - **File(s):** `js/diff-engine.js`
  - **Acceptance:** `enrichItemIdentities` numista lookup is FIFO buckets (array per key, shift-to-consume, preserving `usedUUIDs`); a numista-bearing incoming row that misses the instance bucket does **not** fall through to `name|date`. B.1's D-7 tests pass.
  - **Depends on:** C.1 (same file; uses `_instanceKey`)
  - **Maps to:** D-7 · AC-11 (data-safety)
  - **Leverage:** current enrich at `js/diff-engine.js:359-422`; fallback to forbid at `:413-417`.

- [x] **C.3 [P]** — `changeLog.js` delegates to `DiffEngine.computeItemKey`
  - **File(s):** `js/changeLog.js`
  - **Acceptance:** `computeItemKey` calls `DiffEngine.computeItemKey` when available (guarded), with a minimal inline fallback matching the new ladder incl. the explicit serial guard; B.1's AC-2 equivalence test passes.
  - **Depends on:** C.1 (logical: authoritative key) — parallel-safe vs C.2 (different file, no shared symbol)
  - **Maps to:** AC-2 · D-1, OQ-7
  - **Leverage:** current mirror at `js/changeLog.js:24-30`; load order (changeLog before diff-engine) → call-time delegation only.

- [x] **C.4** — `importNumistaCsv`: collapse → enrich → stamp-unmatched → compare; re-route to merge
  - **File(s):** `js/inventory-import.js`
  - **Acceptance:** Numista rows are collapsed via `DiffEngine.collapseByInstanceKey(rows)` (qty summed) before identity stamping; sequence is `collapse → enrichItemIdentities(inventory, rows) → stamp uuid/serial on still-unmatched rows → showImportDiffReview(...)` mirroring `importCsv` (`:647`); `replaceInventory` closure + STRK-165 onboarding dialog removed; `override→runReplace` retained. B.2's AC-6 (import-flow)/7/8/9/12/13 tests pass.
  - **Depends on:** C.1, C.2 (matching needs the new key + enrich)
  - **Maps to:** AC-6, AC-7, AC-8, AC-9, AC-12, AC-13 · D-3
  - **Leverage:** reference call `js/inventory-import.js:647`; current `importNumistaCsv` `:710-1013`; stamp facts `js/inventory.js:351-364`.

- [x] **C.5** — Possible-duplicate sidecar in `showImportDiffReview`
  - **File(s):** `js/inventory-import.js`
  - **Acceptance:** `showImportDiffReview` computes a sidecar (Set/map keyed by instance-key or item ref) of added rows whose `numistaId+year` matches an existing item with populated grade/cert, and passes it to `DiffModal.show` (e.g. `options.possibleDuplicates`). The flag is **never** written onto an item. B.2's AC-11 "no `_possibleDuplicate` persists" assertion passes.
  - **Depends on:** C.4 (same file)
  - **Maps to:** AC-11 · D-4
  - **Leverage:** `showImportDiffReview` `:86-157`; it already holds `inventory`.

- [x] **C.6** — qty 3-way control: render + select + sum + keyboard
  - **File(s):** `js/diff-modal.js`
  - **Acceptance:** `_renderModifiedSection` renders the qty field as Keep/Replace(default)/Add `[role=radio]` cells; `_onModifiedClick` handles the `sum` state and syncs `aria-checked`; a keydown handler activates Space/Enter on a focused `[role=radio]`; `_buildSelectedChanges` emits `value = localVal + remoteVal` for `sum`. B.2's AC-10 tests pass.
  - **Depends on:** A.1 (CSS), B.2
  - **Maps to:** AC-10 · D-5
  - **Leverage:** mockup override `playground/STRK-167-numista-merge/diff-modal.js` (the prototype diff is the starting point); mount points `js/diff-modal.js:1683` (modified render), `:2325-2341` (click), `:2762-2821` (build).

- [x] **C.7** — Render the possible-duplicate badge from the sidecar
  - **File(s):** `js/diff-modal.js`
  - **Acceptance:** `_renderOrphanCards` (still `(type, items)`) renders `.dm-dup-flag` (with `.sr-only` sentence) on an added row when its key ∈ the sidecar passed to `DiffModal.show`; advisory only (Import/Skip unaffected). B.2's AC-11 badge test passes.
  - **Depends on:** C.5 (sidecar), C.6 (same file)
  - **Maps to:** AC-11
  - **Leverage:** mockup badge markup; render site `js/diff-modal.js:1540-1668`.

---

## UI Contract Traceability

| UI state (approach.md)                          | Implementing task(s)                    | Verifying assertion (B.2)                                        | Visual verification                                                        |
| ----------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Modified row — qty differs (Keep/Replace/Add)   | C.6 (+A.1 CSS)                          | AC-10: control renders, "Add" applies sum, Space/Enter activates | Compare to `shot-ac10-light.png` across all 4 themes                       |
| Modified row — non-qty field (unchanged 2-cell) | C.6 (no regression)                     | AC-10: price row still 2-cell local/remote                       | `shot-ac10-light.png`                                                      |
| Added row — possible duplicate (badge)          | C.5 (detect) + C.7 (render) + A.1 (CSS) | AC-11: badge present, advisory, no persist                       | `shot-dark.png`, `shot-ac11-sepia.png`; verify badge contrast all 4 themes |
| Added row — normal (no badge)                   | C.7                                     | AC-11: no badge on non-matching add                              | `shot-dark.png` (Krugerrand)                                               |
| Narrow viewport 320px                           | A.1 (CSS) + C.6                         | (manual) single-row, no truncation                               | `shot-ac10-320.png`; re-verify at 320px                                    |

Mockup artifacts required reading for C.6/C.7: `playground/STRK-167-numista-merge/{index.html,diff-modal.js}` + the five `shot-*.png`.

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _verification only_
  - Run **`npm test`** (core Playwright PR gate) + `npm run test:unit`. All existing tests pass; all new B.1/B.2 tests green. If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy scan** — security + quality
  - **File:** _scan only_
  - Run the Gen-3 Codacy CLI command **`codacy-analysis analyze --diff`** against changed files (per `.context/sketch-conventions.md`). In Claude this is available via the `codacy-skills:codacy-analysis-cli` plugin skill; a non-Claude runner invokes the command directly. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Watch CCN ≤10 / file-nloc ≤1500 (the diff-modal.js additions).

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** append to bottom of this `tasks.md` under `## Verification Stamp`.
  - One line per AC (AC-1 … AC-13) citing the test/impl line that proves it, or `gap:`. **UI verification (UI Contract present):** AC-10 and AC-11 require visual evidence — `verified by <test> + visually verified against mockup state "<name>"` or `+ screenshot compared: <path>`. Refuse CLOSE-4 if any `[ ]` remains.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files.
  - Run **`/update-spot-bundle`** first (every version-bump PR), then **`/release patch`** (the only valid version-bump path; copy the rebuilt bundle into the worktree per `git-topology.md` §Spot Bundle).

- [x] **CLOSE-5. Vault update** — N/A: no Foundation doc documents the changed internals (computeItemKey / enrich / Numista import flow); clean audit, no edits.
  - Invoke **`/vault-update`** (audits Foundation docs; merge/diff-engine/identity changes may touch `architecture.md`/`reusable-patterns.md`). **Do NOT mark the Plane issue Done here** — per `.context/implementation-gotchas.md:49-56` the close order is `version bump → spot bundle → gh pr create → post-merge archive → mark Plane Done`; the Done transition happens in CLOSE-8 after the PR merges.

- [x] **CLOSE-6. Open PR** — https://github.com/lbruton/StakTrakr/pull/1233
  - Branch from Cohort 0 (`patch/<version>`). Title: `fix(STRK-167): instance-aware Numista dedup + safe merge`. Body links the source issue + sketch folder `DocVault/Projects/StakTrakr/sketches/STRK-167-numista-instance-dedup/` + a test-plan checklist. Stage & commit before `gh pr create`; verify `--repo` targets local origin; confirm `merge-base origin/dev HEAD == origin/dev`.

- [x] **CLOSE-7. Resolve PR review threads** — all checks green (Codacy/CodeQL/CodeRabbit/Cloudflare); no unresolved threads or review-body findings.
  - **File:** _GitHub PR threads; code fixes land in the worktree_
  - Invoke **`/pr-resolve`**. Scan BOTH inline diff threads AND review-body findings (Codacy/Copilot summary blocks). Critical/High: fix or false-positive with reasoning; Medium: fix or waive; Low/Info: advisory. Re-check for new auto-scanner threads after each push. Expect old-prefix (STAK) false positives — pre-classify.

- [x] **CLOSE-8. Archive sketch + mark Plane Done** (after PR merges) — PR #1233 merged 2026-06-08; STRK-167 → Done; folder archived; mem0 summary saved.
  - Invoke **`/sketch archive STRK-167`** — moves the folder to `archive/2026-..-STRK-167-numista-instance-dedup/`, saves the mem0 summary, and marks **STRK-167 Done** in Plane (the post-merge close transition per implementation-gotchas.md:49-56).

---

> **Multi-model dispatch hint:** B.1 (unit) ∥ B.2 (Playwright) are different files → parallelizable. The TDD seam (B red → C green) is a natural model-routing boundary. Within C, same-file tasks (C.1→C.2, C.4→C.5, C.6→C.7) are strictly sequential; C.3 is the only safe `[P]` (separate file) once C.1 lands.

## Verification Stamp (2026-06-07, `/sketch run`)

All 13 ACs verified on branch `patch/3.35.14`. Tests: `tests/unit/diff-engine-instance-key.test.js` (B.1, 18/18) + `tests/playwright/core/numista-import-onboarding.spec.js` (B.2, 7/7). Full suite: 216 unit + 213 core Playwright pass (1 pre-existing flake `numista-catalog.spec.js:219` confirmed passing in isolation).

- **AC-1** — instance key `numistaId|year|grade|certNumber`, grade/cert trim+lowercase, empty→`""`: `DiffEngine._instanceKey` (`js/diff-engine.js:323`) via `computeItemKey` tertiary tier — verified by B.1 "AC-1" block (4 tests).
- **AC-2** — changeLog ↔ DiffEngine key equivalence: `js/changeLog.js` `computeItemKey` delegates to `window.DiffEngine.computeItemKey` — verified by B.1 "AC-2" block (5 tests).
- **AC-3** — API vs CSV same ungraded instance (differing name/date) → identical keys: name/date excluded from the tier — verified by B.1 "AC-3".
- **AC-4** — differing year/grade/certNumber → different keys: verified by B.1 "AC-4" (3 tests).
- **AC-6** — within-CSV collapse sums qty, distinct years/grades separate: `DiffEngine.collapseByInstanceKey` (`js/diff-engine.js`) + import-flow route in `importNumistaCsv` — verified by B.1 "AC-6" (3 tests) + B.2 "AC-6" (collapse to qty 6).
- **AC-7** — non-empty import opens `#diffReviewModal` (merge), not replace: `importNumistaCsv` merge route — verified by B.2 "AC-7/AC-12".
- **AC-8** — re-import same CSV → zero duplicate `numistaId+year+grade+cert`: enrich backfill + uuid match — verified by B.2 "AC-8".
- **AC-9** — empty inventory → all rows as adds via merge: verified by B.2 "AC-9".
- **AC-10** — qty 3-way Keep/Replace(default)/Add, sum on apply, Space/Enter activation: `_renderModifiedSection` qty branch + `_onModifiedClick` (sum/aria) + `_onModifiedKeydown` + `_buildSelectedChanges` (sum) in `js/diff-modal.js` — verified by B.2 "AC-10" **+ visually verified against mockup state "shot-ac10-light" across all 4 themes; screenshots compared: /tmp/strk167-ac10-{light,dark,slate,sepia}.png** (Replace default-selected green, sum-verb in `--info`, "1 + 5 = 6").
- **AC-11** — ungraded import sharing numistaId+year with graded existing: advisory badge, skippable, no `_possibleDuplicate` persists: sidecar in `showImportDiffReview` (`js/inventory-import.js`) + `.dm-dup-flag` render in `_renderOrphanCards` (`js/diff-modal.js`) — verified by B.2 "AC-11" (added not modified, badge visible, graded preserved, no persisted flag, 2 separate items) **+ visually verified against mockup state "shot-dark"/"shot-ac11-sepia"; screenshots compared: /tmp/strk167-ac11-{light,dark,slate,sepia}.png** (WCAG-AA dark-amber `--warning-text` on tinted bg passes in light/sepia).
- **AC-12** — STRK-165 onboarding-replace dialog removed: `showAppActionDialog` replace branch deleted — verified by B.2 "AC-7/AC-12" (`#appDialogModal` hidden).
- **AC-13** — `importNumistaCsv(file, true)` replaces directly, no diff modal: override path retained — verified by B.2 "AC-13".

Codacy (CLOSE-2): new functions `computeItemKey` (changeLog) + `runReplace` refactored under ccn≤10. Remaining Lizard Mediums are pre-existing baseline (giant pre-existing functions: `showImportDiffReview` 44, `_onModifiedClick` 35, `_buildSelectedChanges` 35, `buildCsvContent`, `importCsvFromText` 89, etc.) — my edits added ≤4 ccn to functions already far over threshold; documented, not introduced. Codacy Cloud PR threads (if any) handled in CLOSE-7.

## Review Archive — tasks (2026-06-07)

### Resolution Summary

- **Accepted (3):** F1 — AC-6 TDD target disambiguated by extracting `DiffEngine.collapseByInstanceKey` (unit-tested in B.1, added to C.1) + an AC-6 import-flow assertion in B.2 (CODEX); F2 — CLOSE-5 no longer marks Plane Done (moved to post-merge CLOSE-8 per implementation-gotchas.md:49-56) (CODEX); F3 — Codacy closeout bound to the command `codacy-analysis analyze --diff` per sketch-conventions.md, with the `codacy-skills:codacy-analysis-cli` plugin skill named as the Claude vehicle (CODEX). All integrated above.
- **Resolved with user input (0).**
- **Rejected (0).** _Note on F3: CODEX's literal "skill does not exist" is a false-positive from its environment — Claude has `codacy-skills:codacy-analysis-cli` — but the underlying point (bind to the command for cross-harness portability) is correct and was applied._

### CODEX Review (2026-06-07)

#### Verified

- Read `requirements.md`, `discovery.md`, `approach.md`, and this `tasks.md`, plus `DocVault/sketch/conventions.md`, `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, `.context/sketch-conventions.md`, and `DocVault/Projects/StakTrakr/Foundation/coding-standards.md`.
- Checked live identity/import surfaces: `js/diff-engine.js:325-343`, `:359-422`, `:439-468`, `:488-496`, `:744-746`; `js/changeLog.js:24-30`, `:191-210`; `js/inventory-import.js:86-157`, `:212-222`, `:647`, `:710-1013`, and `:1603`.
- Checked UI and test anchors: `js/diff-modal.js:1540-1668`, `:1683-1916`, `:2325-2341`, `:2762-2821`; `index.html:7058-7541`, `:8549-8551`; `tests/unit/diff-engine-normalization.test.js:21-24`; `tests/playwright/coverage-map.csv:75`.
- Checked local skill roots for a `codacy-analysis-cli` skill and found no matching skill file.

#### Top concerns

1. **AC-6 has no unambiguous red/green target.** The task list puts the within-CSV collapse test in a diff-engine unit file while the implementation lives in `inventory-import.js`, and the Playwright task does not list AC-6 despite C.4 depending on it.
2. **Plane issue closure is ordered too early.** CLOSE-5 marks STRK-167 Done before PR creation/merge, contrary to StakTrakr's closing-order rule.
3. **The Codacy closeout skill name appears stale/nonexistent.** Project conventions name `codacy-analysis analyze --diff`; the tasks name `codacy-analysis-cli` as if it were a skill.

#### Unverified assumptions

- I did not run the unit or Playwright suites; this was a review-only source/document pass.
- I did not verify Plane issue state or version-lock state, because the tasks review is comment-only and should not start implementation setup.
