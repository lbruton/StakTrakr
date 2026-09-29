---
sketch: STRK-71-table-chip-settings
phase: tasks
created: 2026-05-12
approved: 2026-05-12
---

# STRK-71 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

> **TDD ordering note:** Cohort A writes the Playwright spec FIRST (per CLAUDE.md "tests first, then implementation"). The spec is expected to FAIL at the end of Cohort A — that failure is the gate that proves the test actually exercises the new behavior. Cohort B's implementation is what turns it green. Do NOT modify the spec to make it pass; if it stays red after Cohort B, fix the implementation.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [ ] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-71-table-chip-settings`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

## Sprint Cohort A — Test scaffolding (sequential, TDD-first)

_New integration spec is written and verified-failing before implementation begins. Single file, single task — no parallelism within the cohort. Cohort A is gated: do not start Cohort B until A.1's acceptance is met (spec compiles, runs, fails for the right reason)._

- [ ] **A.1** — Write Playwright integration spec for inline-chip attachment settings
  - **File(s):** `tests/playwright/03-settings/04-inline-chip-attachment.spec.js` _(new)_
  - **Acceptance:**
    - File exists with one `test.describe("STRK-71 — inline chip: attachment settings", …)` block.
    - **Per-AC test coverage** (each AC has at least one named test case):
      - AC-1 — hides `.attach-count-chip` from a row that HAS attachment data after the user toggles "Attachments" off in `#inlineChipConfigContainer`. Test MUST seed at least one inventory item with non-empty `attachments` (the shared `tests/fixtures/seed-inventory.js` has zero attachment-bearing rows — verified at `discovery.md:31` — so the spec must seed directly via `page.evaluate(() => localStorage.setItem('inventory', JSON.stringify(...)))` or an equivalent helper before navigation).
      - AC-2 — re-toggling "Attachments" back on restores `.attach-count-chip` in the same row.
      - AC-3 — with all 10 inline chips disabled, the Name cell of a disposed item shows the `.disposition-badge` and NO `.attach-count-chip` / other inline chips. The spec MUST seed at least one disposed item directly (seed-inventory has zero disposed rows — verified at `discovery.md:31`).
      - AC-4 — moving "Attachments" to position 1 via the existing up-arrow controls in `_renderSectionConfigTable` renders `.attach-count-chip` to the LEFT of all other chips in the Name cell (i.e. `.attach-count-chip` precedes `.grade-tag`/`.numista-tag`/`.year-tag` in document order). This assertion is REQUIRED — a generic "reorder works" test against grade vs numista would pass even if `${attachChip}` were left as a trailing suffix in the template, defeating AC-4.
      - AC-5 — after a `page.reload()`, the chip visibility and order from the previous step persist (verifies `inlineChipConfig` localStorage round trip).
      - AC-6(a) — fresh install (`localStorage` cleared of `inlineChipConfig`): default render shows `grade, numista, year, attachment` in that left-to-right order in the Name cell for an attachment-bearing row.
      - AC-6(b) — upgrade path: pre-seed `inlineChipConfig` with the historical 9-entry shape (no `attachment` entry), reload, assert the merge logic at `js/constants.js:1123-1127` appended `attachment` at the end of the saved order, AND the chip renders rightmost in the Name cell.
      - AC-7 — toggling "Attachments" off in table view does NOT suppress the card-view attachment chip (`.cv-chip-attach`). Switch to a card view (A/B/C) and assert the chip is still rendered.
      - AC-8 — open Settings → Appearance → Layout → Inline Name Chips (`#inlineChipConfigContainer`), assert exactly 10 togglable rows are visible, one labeled "Attachments". The panel container's `scrollHeight` does not exceed its visible bounding rect by more than its natural 10-row height (no unexpected overflow / clipping at default viewport).
    - Spec runs (`npx playwright test tests/playwright/03-settings/04-inline-chip-attachment.spec.js`) and reports failures on the assertions that depend on the unshipped behavior — specifically AC-1 (chip cannot be hidden today), AC-3 (chip not in chipMap so "all-hidden" leaves it), AC-4 (chip pinned rightmost), AC-8 (panel has 9 rows, not 10). AC-2/5/7 may already pass coincidentally; that's fine. AC-6(a)/(b) will fail because default-rendered order won't include `attachment` as a controlled chip.
    - The spec is committed in a state that COMPILES and runs without syntax errors — failing assertions are the goal; failing-to-load is not.
  - **Leverage:** `tests/playwright/03-settings/03-appearance.spec.js:120-135` (panel visibility); `tests/playwright/attachments/ui.spec.js:6-57` (badge unit prior art); `tests/fixtures/seed-inventory.js` (shape reference, not directly usable — needs attachment + disposition rows seeded inline).
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8 (all)

## Sprint Cohort B — Implementation (parallel-safe)

_All three implementation tasks touch independent files (`js/constants.js`, `js/inventory-table.js`, `css/styles.css`) and reference `"attachment"` only as a string id. No file collisions; no symbol contracts shared at the data-structure level. Safe to dispatch to three different models concurrently. Reconverge and run A.1's spec at the end of the cohort to verify all assertions pass._

- [ ] **B.1 [P]** — Add `attachment` entry to `INLINE_CHIP_DEFAULTS`
  - **File(s):** `js/constants.js`
  - **Acceptance:**
    - At `js/constants.js:1106` (immediately after the `tags` entry), append `{ id: "attachment", label: "Attachments", enabled: true }` so `INLINE_CHIP_DEFAULTS` is a 10-entry array ending with `attachment`.
    - No other edit in this file. (The optional comment-update at `:848` is tracked separately as B.4.)
    - `getInlineChipConfig()` round trip: in browser DevTools (or unit-style probe) `getInlineChipConfig().at(-1)` returns `{ id: "attachment", label: "Attachments", enabled: true }` for a fresh install.
  - **Leverage:** existing `INLINE_CHIP_DEFAULTS` shape (`js/constants.js:1096-1106`); forward-additive merge (`:1123-1127`) handles upgrade path automatically — no migration code.
  - **Maps to:** AC-6(a), AC-6(b)

- [ ] **B.2 [P]** — Add `.attach-count-chip` to flex-shrink selector
  - **File(s):** `css/styles.css`
  - **Acceptance:**
    - Edit the selector at `css/styles.css:5369-5380` to include `.attach-count-chip` alongside the existing nine chip classes. The rule body (`flex-shrink: 0`) is unchanged.
    - No other CSS edit.
    - Visual check (manual or via Playwright AC-4 assertion): with "Attachments" in position 1 and a long-name inventory item rendered in a narrow viewport, the `.attach-count-chip` is not compressed or clipped.
  - **Leverage:** existing flex-shrink rule pattern at `css/styles.css:5369-5380` (enumerates every other chip class explicitly).
  - **Maps to:** AC-4 (specifically the leftmost-position case under flex pressure)

- [ ] **B.3 [P]** — Wire attachment chip through `chipMap` pipeline
  - **File(s):** `js/inventory-table.js`
  - **Acceptance:** Three coordinated edits inside the row-render loop, applied as one commit:
    1. **Move** the `attachChip` construction block (currently lines 567-577) to immediately AFTER the `tagsChip` construction (currently line 550), so `attachChip` is in scope before `chipMap` is declared. The block's logic is unchanged — same `if (item.attachments?.length > 0)` guard, same `renderAttachmentBadge(item, { variant: "table" })` call, same inline `onclick` string-attribute path, same `.outerHTML` extraction. Do NOT switch to the `{ onClick }` callback API (verified unusable at `discovery.md:27` — `.outerHTML` strips event listeners).
    2. **Add** `attachment: attachChip` as the 10th entry in the `chipMap` object literal (currently lines 552-562), after `tags: tagsChip`.
    3. **Drop** the trailing `${attachChip}` from the Name cell template at line 603. The surviving template MUST preserve the disposition-badge prefix: `${isDisposed(item) ? '<span class="disposition-badge…">…</span>' : ""}${orderedChips}`. Do not touch the disposition-badge conditional — AC-3 depends on it remaining always-on.
    - After edit: `chipMap` is a 10-entry object; `orderedChips` filter (`c.enabled && chipMap[c.id]`) correctly excludes the chip when `attachChip === ""` (no attachments) OR when the user has toggled it off.
    - **Regression sanity check:** open a large fixture (≥100 rows, attachment-bearing) with "Attachments" toggled OFF in settings. Table renders without visible jank or measurable render-time regression vs. pre-STRK-71 baseline. (`renderAttachmentBadge` runs eagerly even for disabled rows — known residual cost from approach D-1; the check confirms it stays below the noise floor.)
  - **Leverage:** existing `chipMap`/`orderedChips` pipeline pattern (`js/inventory-table.js:552-566`); `tagsChip` construction at `:547-550` as the canonical pattern for chip values; `renderAttachmentBadge` table variant at `js/attachment-ui.js:262-281`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7

- [ ] **B.4** — Optional: refresh stale `ALLOWED_STORAGE_KEYS` comment
  - **File(s):** `js/constants.js`
  - **Depends on:** B.1 (same file — sequenced to avoid concurrent edits to `js/constants.js`)
  - **Acceptance:**
    - At `js/constants.js:848` the comment reads `// inline chip config (grade, year, etc.)`. Either (a) update the parenthetical to include `attachment`, OR (b) drop the parenthetical entirely. Cosmetic only — pick whichever the author prefers.
    - If skipped, this task may be checked as `N/A — cosmetic comment, no functional impact` per the skill-name discipline rule.
  - **Leverage:** none; trivial.
  - **Maps to:** _no AC — cosmetic_

> **Cohort B gate (before advancing to closing tasks):** Run `npx playwright test tests/playwright/03-settings/04-inline-chip-attachment.spec.js`. Every AC-* assertion in A.1 must now pass. If any AC-* fails, fix the implementation — do NOT relax the spec.

## Sprint Cohort C — Out-of-scope follow-up filing (sequential)

_Bookkeeping for technical debt surfaced during sketch review but explicitly out of scope for STRK-71. File these BEFORE the closing tasks so the issue IDs can be referenced in the PR description._

- [ ] **C.1** — File Plane issue: `saveData()`/`loadData()` wrapper alignment for `saveInlineChipConfig`
  - **File(s):** _no file changes — Plane issue creation only_
  - **Acceptance:**
    - Create a new Plane issue (prefix `STRK`) via `mcp__plane__create_issue`.
    - Title: "Align `saveInlineChipConfig` with `saveData()`/`loadData()` wrapper".
    - Body cites: (a) the wrapper drift at `js/constants.js:1140-1147` (raw `localStorage.setItem`), (b) the STRK-71 sketch path `DocVault/Projects/StakTrakr/sketches/STRK-71-table-chip-settings/` as the source decision, (c) approach D-5 rationale (out-of-scope for STRK-71 because pre-existing inconsistency).
    - Issue ID is captured for reference in CLOSE-6's PR body.
    - If the author chooses to defer this filing, mark `N/A — deferred to post-merge backlog grooming` and surface the deferral in the PR body. Do not silently drop.
  - **Leverage:** `mcp__plane__create_issue`; project prefix STRK; existing follow-up pattern from prior sketches.
  - **Maps to:** _no AC — bookkeeping_

---

## Standard Closing Tasks

> **Numbering:** Continues from C.1. CLOSE-1..CLOSE-8 are project-mandatory; mark `N/A — <reason>` rather than dropping if any genuinely does not apply (per skill-name discipline rule above). For StakTrakr none of these is N/A by default — version bump, vault audit, PR, threads, and archive are all in-scope.

- [ ] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run the project's complete test command (`npm test` for full Playwright suite). All existing tests pass; all new tests from Cohort A pass (now green after Cohort B).
  - If anything fails: fix the implementation, not the test. In particular, do NOT modify the spec from A.1 to make it pass — that violates TDD discipline and erases the AC traceability.

- [ ] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files (`js/constants.js`, `js/inventory-table.js`, `css/styles.css`, `tests/playwright/03-settings/04-inline-chip-attachment.spec.js`). Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Pre-existing browser-global `no-undef` findings on lines you did not touch are noise per CLAUDE.md ("project uses script-tag globals the auto-config doesn't recognize") — verify findings on changed lines only.

- [ ] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-8), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case in `tests/playwright/03-settings/04-inline-chip-attachment.spec.js` proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md (AC-1 through AC-8 — count: 8). Status-only notes ("PR opened", "tests passing") are not equivalent — the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [ ] **CLOSE-4. Version bump**
  - **File:** project version files — `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`, and `sw.js` (auto-stamped by pre-commit hook).
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, the six-file enumeration, pre-commit interactions, and `/update-spot-bundle` invocation that the prose cannot carry. Per CLAUDE.md: `/release` is the ONLY valid version-bump path for StakTrakr; `check-release-sync` hook validates a subset only and a manual hand-edit of `package.json` will ship incomplete.
  - Run `/update-spot-bundle` first if not already current — required for every version-bump PR per `feedback_spot_bundle_every_version_bump.md`.

- [ ] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. STRK-71 is narrow (one chip integration, no architectural change) so the audit may legitimately report zero changes; that is a clean N/A by audit, not a skip.
  - Mark STRK-71 Done in Plane: fetch the project's states via `mcp__plane__list_states`, find the state whose `group` is `completed` (typically "Done"), then `mcp__plane__update_issue` with that state.

- [ ] **CLOSE-6. Open PR**
  - Use worktree branch `sketch/STRK-71-table-chip-settings` (created by `/sketch apply`). PR target: `dev`.
  - Title: `feat(STRK-71): wire table attachment chip through inline-chip settings` (user-facing — the chip becomes user-configurable).
  - Body must include:
    - Link to source issue (`https://plane.lbruton.cc/lbruton/browse/STRK-71/`)
    - Link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-71-table-chip-settings/`)
    - Test plan checklist (one bullet per AC-1..AC-8 mapping to the matching test name in `04-inline-chip-attachment.spec.js`)
    - Reference to C.1's follow-up issue ID (or the deferral note)
    - Confirmation that `/update-spot-bundle` was run for this version bump

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as "comments outside of the diff" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - Known false-positive shortcuts (auto-resolve allowed per CLAUDE.md "Known Reviewer False Positives"): Gemini duplicates with `"line": null`; CodeRabbit "simplify code" auto-PRs; `ALLOWED_STORAGE_KEYS` typeof-guard "undefined" flag.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-71`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-71-table-chip-settings/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort B's three `[P]` tasks (B.1, B.2, B.3) touch three different files (`js/constants.js`, `css/styles.css`, `js/inventory-table.js`) with no shared symbol contracts — safe to dispatch to three different models in parallel via OpenCode. Suggested split: send B.1 to Codex (mechanical defaults edit), B.2 to Kimi (one-line CSS), B.3 to Gemini or Opus (three-edit refactor with line-order sensitivity). B.4 is NOT `[P]` — it touches the same file as B.1 (`js/constants.js`) and must run sequentially after B.1 to avoid concurrent edits; bundle it into the same Codex session that ran B.1. Reconverge before running A.1's spec to verify all assertions pass; advance to closing tasks only if green.

## Verification Stamp

Stamped: 2026-05-12 — all 9 Playwright ACs GREEN (8 tests + 1 coincidental pass)

- [x] AC-1 — verified by "AC-1 — toggling Attachments off in settings hides .attach-count-chip"
- [x] AC-2 — verified by "AC-2 — re-toggling Attachments on restores .attach-count-chip"
- [x] AC-3 — verified by "AC-3 — all chips disabled: .attach-count-chip absent from name cell"
- [x] AC-4 — verified by "AC-4 — Attachments at position 1 renders .attach-count-chip before .grade-tag"
- [x] AC-5 — verified by "AC-5 — chip settings persist across page reload"
- [x] AC-6 — verified by "AC-6a — fresh install: default Name cell chip order is grade, numista, year, attachment" + "AC-6b — upgrade from 9-entry config: attachment appended rightmost after merge"
- [x] AC-7 — verified by "AC-7 — table Attachments toggle does not suppress card-view .cv-chip-attach"
- [x] AC-8 — verified by "AC-8 — inline chip settings panel has exactly 10 rows including Attachments"
