---
sketch: "STRK-52-numista-resync-tag-membership"
phase: tasks
created: 2026-05-08
approved: 2026-05-08
---

# STRK-52 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive STRK-52`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. None of these closing tasks are N/A for StakTrakr (project has version management, DocVault footprint, Codacy enabled).

> **TDD framing for Cohort A.** Cohort A rewrites Test 3 in `tests/playwright/numista-picker-tags.spec.js`, which currently encodes the **wrong spec** (the locked-checked behavior STRK-52 corrects — see approach.md D-5). Per CLAUDE.md "TDD Test Integrity — RED FLAG", modifying tests to make code green is forbidden. This is the legitimate exception: spec-driven test correction. If the hookify `block-tdd-test-modification` rule fires, treat it as a halt-and-explain signal — surface STRK-52 as the spec correction to the user, get explicit approval, and document that approval in the PR description. **Do not disable, suppress, or coach around the hook to land the test edit.**

## Sprint Cohort 0 — Setup (parallel-safe)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact, plus runs a cheap collision check before naming finalization._

- [x] **0.1 [P]** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-52-numista-resync-tag-membership`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

- [x] **0.2 [P]** — Verify `data-on-item` attribute name does not collide
  - **File(s):** _no file changes — grep only_
  - **Acceptance:** Run `grep -r "dataset.onItem\|data-on-item" js/` from the worktree root. Expected: zero matches. If any match, surface to the human and choose an alternative name (e.g. `data-numista-on-item`) before Cohort B begins. (Risk #3 from approach.md.)
  - **Leverage:** approach.md §Risk Notes risk #3.

## Sprint Cohort A — TDD test scaffold (sequential, single file)

_All five test edits land in `tests/playwright/numista-picker-tags.spec.js`. Same-file edits cannot be `[P]` (parallelization sanity check rule 1). Tests are written before implementation — they MUST fail at A.6 (TDD red) before Cohort B starts._

- [x] **A.1** — Rewrite Test 3 to assert existing on-item tag is enabled
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js` (lines 281–298)
  - **Acceptance:** Test asserts the existing-on-item tag checkbox is `not.toBeDisabled()`, is `toBeChecked()`, and shows the `(on item)` hint adjacent to the label. Title is updated to reflect the new behavior (no longer "checked and disabled"). Test currently fails (the picker still emits `disabled=true`).
  - **Leverage:** approach.md D-5 (spec-corrected test rewrite); existing fixture `NUMISTA_RESULT` at lines 61–71.
  - **Maps to:** AC-1, AC-2

- [x] **A.2** — Add test for AC-3: uncheck existing on-item tag → removed + future-sync opt-out
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js`
  - **Acceptance:** New test seeds an item with a Numista tag already on it, opens the picker, directly unchecks that tag, clicks Fill Fields, and asserts: (a) the tag is no longer in `getItemTags(uuid)`; (b) `loadRemovedTags(uuid)` contains the tag; (c) reopening the picker shows the tag unchecked with the `removed` hint. Fails before B.3 lands.
  - **Leverage:** existing Test 9 (lines 508–546) covers a related path — model after it.
  - **Maps to:** AC-3, AC-7

- [x] **A.3** — Add test for AC-6: case-insensitive removal
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js`
  - **Acceptance:** New test seeds an item with a manually-added tag in lowercase casing (e.g. `tree`), runs a Numista re-sync whose result contains the same tag in different casing (e.g. `Tree`). Asserts: (a) the picker renders one row, checked; (b) unchecking and clicking Fill Fields removes the stored `tree` (verifies via `getItemTags(uuid)` returning empty for that label); (c) `itemRemovedTags` records the opt-out (capitalization per `addRemovedTag`). Fails before B.3 lands.
  - **Leverage:** approach.md D-3 (local case-resolution via `getItemTags(uuid)` lookup before `removeItemTag()`).
  - **Maps to:** AC-5, AC-6

- [x] **A.4** — Add test for AC-10: Uncheck-all preserves blacklisted AND on-item rows simultaneously
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js`
  - **Acceptance:** New test seeds an item that has one on-item tag, plus a Numista result that includes one blacklisted tag, one removed tag, one new tag, and one matching on-item tag. Clicks Uncheck-all. Asserts: blacklisted row stays unchecked-and-disabled, on-item row stays checked, new and removed rows go unchecked. Fails before B.2 lands. (This single test exercises the both-guard mitigation from approach.md Risk #1.)
  - **Leverage:** existing Test 6 (lines 379–424) covers blacklisted-only bulk locking — extend the same pattern.
  - **Maps to:** AC-9, AC-10

- [x] **A.5** — Add regression test for AC-5: matching manual + Numista tag renders as one logical row
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js`
  - **Acceptance:** New test seeds an item with a manually-added tag whose text matches a Numista result tag (e.g. both `Bullion`). Asserts the picker renders exactly one tag row for `Bullion`, checked, with the `(on item)` hint. Currently passes incidentally (per approach.md D-6, the case-insensitive `isOnItem` predicate at line 1912 already collapses duplicates) — this test locks the behavior in against future refactors.
  - **Leverage:** approach.md D-6 (no implementation change required — regression lock only).
  - **Maps to:** AC-5

- [x] **A.6** — Run Playwright suite, confirm tests A.1–A.4 fail (TDD red), A.5 passes (regression lock)
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `npm test` (or `npm run test:offline` if Browserbase is unavailable in the worktree) reports A.1, A.2, A.3, A.4 as failing for the expected reasons (still-disabled checkbox, no removal path, no bulk-protect guard). A.5 passes against unmodified code. Pre-existing tests (6, 9, 11–13) still pass. If any expected-to-pass test fails, STOP and investigate before Cohort B.
  - **Leverage:** Coding standards skill — `npm test` is the canonical Playwright entry point.
  - **Maps to:** All AC (red phase of TDD)

## Sprint Cohort B — Implementation (sequential, single file)

_All three implementation regions land in `js/catalog-api.js`. Same-file edits cannot be `[P]`. Order matters: B.1 introduces the `data-on-item` attribute that B.2 and B.3 both consume._

- [x] **B.1** — Tag-picker render: replace `disabled` lock with `data-on-item` marker + visible hint
  - **File(s):** `js/catalog-api.js` (around lines 1938–1946; see approach.md File Map)
  - **Acceptance:** In the existing-on-item branch of `renderNumistaFieldCheckboxes()`, remove `cb.disabled = true`. Set `cb.dataset.onItem = "1"`. Append a plain-text `(on item)` hint after the label, mirroring the `(blacklisted)` pattern at lines 1930–1937 (D-4). The blacklist branch (1910–1937) must be left exactly as-is. Verify `cb.checked = true` is preserved for existing tags. Test A.1 passes after this task.
  - **Leverage:** approach.md D-1, D-4; the adjacent blacklist-hint pattern at lines 1930–1937 is the structural template.
  - **Depends on:** Cohort A complete; 0.2 confirmed no name collision.
  - **Maps to:** AC-1, AC-2

- [x] **B.2** — Bulk Uncheck-all: add `!cb.dataset.onItem` guard
  - **File(s):** `js/catalog-api.js` (around lines 1967–1977)
  - **Acceptance:** The Uncheck-all loop's existing `if (!cb.disabled)` guard is augmented to `if (!cb.disabled && !cb.dataset.onItem)`. Check-all is left unchanged (asymmetric by design per D-2 — Check-all is "fill the gaps" so no-op on already-checked rows is correct). Add a brief inline comment at the call site explaining why the guards are asymmetric so a future reader does not "fix" the asymmetry. Test A.4 passes after this task.
  - **Leverage:** approach.md D-2; the existing blacklist-protect guard pattern.
  - **Depends on:** B.1 (relies on `data-on-item` being set).
  - **Maps to:** AC-9, AC-10

- [x] **B.3** — Fill Fields submit: walk unchecked on-item checkboxes, resolve case via `getItemTags`, call `removeItemTag`
  - **File(s):** `js/catalog-api.js` (around lines 2377–2403)
  - **Acceptance:** After the existing checked-tag application path, walk all tag-row checkboxes for `_fillUuid`. For each `cb` where `cb.dataset.onItem === "1"` AND `!cb.checked`, look up the user's stored-exact-case string via `getItemTags(_fillUuid)` (case-insensitive search of the array) and call `removeItemTag(_fillUuid, exactStored)`. Do **not** call `addRemovedTag()` again — `removeItemTag()` already does that internally. The walk must run even when zero checked tag checkboxes exist, so it cannot live inside the existing `if (tagCheckboxes.length > 0 && _fillUuid)` block. The existing re-check-clears-removed branch at lines 2393–2402 stays intact. Tests A.2 and A.3 pass after this task.
  - **Leverage:** approach.md D-3; `getItemTags()` and `removeItemTag()` already exist in `js/tags.js`; capitalization on store comes free via `addRemovedTag()` inside `removeItemTag()`.
  - **Depends on:** B.1 (relies on `data-on-item` being set).
  - **Maps to:** AC-3, AC-6, AC-7

- [x] **B.4** — Re-run Playwright suite, confirm full green
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `npm test` reports A.1–A.5 passing, plus all pre-existing tests in `numista-picker-tags.spec.js` (Tests 1–13 minus the rewritten Test 3) and unrelated suites. Zero regressions. If any test still fails, fix the implementation, NOT the test (CLAUDE.md TDD rule).
  - **Leverage:** Coding standards skill.
  - **Depends on:** B.1, B.2, B.3 complete.
  - **Maps to:** All AC (green phase of TDD)

## Sprint Cohort C — Cross-cutting verification (parallel-safe)

_Both tasks are read-only verification of properties not directly tested by the new Playwright cases. They touch nothing and can run concurrently._

- [x] **C.1 [P]** — Verify export-import round-trip is unaffected
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Tests 11, 12, 13 in `numista-picker-tags.spec.js` (lines 591–748) still pass, confirming JSON / CSV / STVAULT export-import round-trips of `itemRemovedTags` are unchanged. (Approach.md §Data / Schema Changes asserts no schema change — this is the empirical check.)
  - **Leverage:** existing test coverage; `npm test` already runs these.
  - **Maps to:** Schema-stability invariant from approach.md.

- [x] **C.2 [P]** — Verify checked-tag application order does not strip stored casing before unchecked walk runs
  - **File(s):** _no file changes — code-trace verification only_
  - **Acceptance:** Read the Fill Fields handler end-to-end after B.3 lands. Confirm: when the handler applies checked-tag changes (calls `applyNumistaTags()` at line 2388), does it mutate the item's tag list in a way that loses the casing of the original stored tag? If yes, the unchecked-on-item walk must capture a snapshot of `getItemTags(_fillUuid)` BEFORE `applyNumistaTags()` runs, then operate on the snapshot. If no, no further change needed. Document the finding in a one-line PR comment so future refactors know the assumption. (Risk #2 from approach.md.)
  - **Leverage:** approach.md §Risk Notes risk #2.
  - **Maps to:** Implementation correctness for AC-6.

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run the project's complete test command (`npm test`, or `npm run test:offline` if Browserbase isn't available). All existing tests pass; all new tests from Cohort A pass.
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - StakTrakr-specific: pre-existing browser-global `no-undef` findings on script-tag globals are noise — verify findings on **changed lines only** per CLAUDE.md "Pre-PR scan gotchas".

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-10), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md (AC-1 through AC-10). Status-only notes ("PR opened", "tests passing") are not equivalent — the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files — `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md` (and `sw.js` is auto-stamped by the `stamp-sw-cache` pre-commit hook).
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if no foundation docs appear affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip. Likely candidates for update: `coding-standards.md` (new `data-on-item` dataset attribute pattern), `reusable-patterns.md` (case-insensitive removal pattern via `getItemTags` lookup).
  - Mark STRK-52 Done in Plane: `mcp__plane__update_issue` to state "Done" (resolve via `mcp__plane__list_states` to get the current Done state UUID — do not copy from prior session memory).

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/sketch apply`. Title: `fix(STRK-52): Numista re-sync allows removing existing on-item tags` (user-facing behavioral change → `fix:` not `chore:`).
  - Body must include: link to STRK-52 (`https://plane.lbruton.cc/lbruton/browse/STRK-52/`), link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-52-numista-resync-tag-membership/`), test plan checklist mapping each AC to the verifying test, **and an explicit note that Test 3 was rewritten as a spec correction per approach.md D-5** so reviewers do not misread the diff as a TDD bypass.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as "comments outside of the diff" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.
  - Watch for the StakTrakr-known false positives (CLAUDE.md "Known Reviewer False Positives"): `ALLOWED_STORAGE_KEYS` undefined-guard noise, automated re-review duplicates with `line: null`.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-52`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-52-numista-resync-tag-membership/` and saves mem0 summary.

---

## Verification Stamp

_Per-AC traceability as of 2026-05-08. Each entry cites the test or implementation line that proves the criterion._

- [x] AC-1 — verified by test "3. existing on-item tag is shown checked and enabled with '(on item)' hint (STRK-52)" (`numista-picker-tags.spec.js:288`) + `catalog-api.js:1938–1946` (render branch)
- [x] AC-2 — verified by test "3. existing on-item tag is shown checked and enabled..." (leaves-it-checked path); `removeItemTag` not called when checkbox stays checked (`catalog-api.js:2414–2415`)
- [x] AC-3 — verified by test "3-AC3: unchecking an on-item tag records removal and opts-out future syncs (STRK-52)" (`numista-picker-tags.spec.js:314`)
- [x] AC-4 — verified by existing behavior: picker iterates only the Numista `tagList` (`catalog-api.js:1907`); manual-only tags never enter the loop — confirmed passing by full suite (524 tests)
- [x] AC-5 — verified by test "3-AC5: matching manual and Numista tag renders as one checked on-item row (STRK-52)" (`numista-picker-tags.spec.js:453`); case-insensitive `isOnItem` predicate at `catalog-api.js:1912`
- [x] AC-6 — verified by test "3-AC6: unchecking removes the stored tag case-insensitively (STRK-52)" (`numista-picker-tags.spec.js:381`); case-insensitive lookup at `catalog-api.js:2421`
- [x] AC-7 — verified by existing test "10. Re-importing a removed tag clears tracking" + re-check-clears-removed branch at `catalog-api.js:2396–2405` (unchanged)
- [x] AC-8 — verified by existing test "5. Fill Fields only imports checked tags" + pre-existing scalar-field behavior unchanged (no edits to non-tag checkbox paths)
- [x] AC-9 — verified by test "3-AC10: Uncheck-all protects on-item and blacklisted rows simultaneously (STRK-52)" (`numista-picker-tags.spec.js:387`); `!cb.dataset.onItem` guard at `catalog-api.js:1980`
- [x] AC-10 — verified by test "3-AC10" (mixed blacklisted + on-item + removed + new); both `!cb.disabled` AND `!cb.dataset.onItem` guards in Uncheck-all (`catalog-api.js:1980`); blacklist guard unchanged in Check-all (`catalog-api.js:1974`)

---

> **Multi-model dispatch hint:** Only Cohort 0 and Cohort C have `[P]` markers. Cohorts A and B are intentionally sequential because every task in each cohort touches the same file (test file in A, `js/catalog-api.js` in B). Suggested split: Cohort 0 — dispatch 0.1 to one session and 0.2 to another in parallel; Cohort C — dispatch C.1 and C.2 likewise. Cohorts A and B run on a single agent in order. Per CLAUDE.md, write tests (Cohort A) first, run them red (A.6), then implement (Cohort B), then run them green (B.4).
