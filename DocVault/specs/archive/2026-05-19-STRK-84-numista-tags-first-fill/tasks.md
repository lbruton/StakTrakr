---
approved: 2026-05-18
sketch: STRK-84-numista-tags-first-fill
phase: tasks
created: 2026-05-18T00:00:00.000Z
---

# STRK-84 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it — this is setup work, not a stop-the-world gate._

- [x] **0.1** — Ensure sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows `.worktrees/patch-<VERSION>` on branch `patch/<VERSION>`. The version is the next patch version derived from `devops/version.lock` high-water mark or `origin/dev` `APP_VERSION` (whichever is higher). Working directory is that worktree, not the main checkout.
  - **If the worktree does not exist yet:** Invoke `/start-patch` (which selects the Plane issue and delegates to `/release patch` for version-lock claim and worktree creation). This is expected on the first run — the agent satisfies this task by doing the setup, not by stopping.
  - **Leverage:** `/start-patch` skill → `/release patch` for lock + worktree creation.

## Sprint Cohort A — Foundation (sequential)

_Test scaffolding needed before Cohort B can write failing tests. No behavioral changes._

- [x] **A.1** — Add `openAddItemPicker` Playwright helper for Add Item flow
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js`
  - **Acceptance:** A new helper function `openAddItemPicker(page, numistaId)` exists in the helper block. It starts from empty inventory (no `seedData` call), clicks `#newItemBtn` to open the Add Item modal, enters the Numista ID in the catalog search field, triggers search, and waits for the picker results panel to be visible. Does NOT call `openEditForm()` or `window.showNumistaResults()` — routes through the real Add Item modal entry point. Helper is callable but no tests use it yet. **Important:** Must NOT reuse `gotoApp()` for navigation — `gotoApp` waits for `window.inventory.length > 0` (line ~177) which hangs on empty inventory. Either create a dedicated `gotoEmptyApp` helper or add an `allowEmpty` flag to `gotoApp`.
  - **Leverage:** Existing `seedData` / `stubCatalogLookup` / `gotoApp` / `openEditForm` / `openNumistaPicker` helpers at `numista-picker-tags.spec.js:93-199` as structural reference (but NOT reused — the new helper must bypass the Edit path). `stubCatalogLookup` IS reused for Numista API stub.
  - **Maps to:** AC-4 (helper prerequisite)

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Write tests that encode the acceptance criteria BEFORE implementation. All new tests MUST fail on current `dev` because the Add-mode tag write path does not exist yet._

- [x] **B.1** — Write failing test for AC-1: tags persist on first Fill Fields for new item
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js`
  - **Acceptance:** A new test case uses `openAddItemPicker` with a Numista ID whose stub response includes at least one tag (e.g. `Bird`). Leaves the default-checked tag ticked, clicks Fill Fields once, submits the Add Item form. Asserts: `page.evaluate(() => JSON.parse(localStorage.getItem('itemTags')))` contains the new row's UUID with the expected tag. Test FAILS on current `dev` (tag application block skipped because `_fillUuid` is null).
  - **Depends on:** A.1
  - **Maps to:** AC-1, AC-4

- [x] **B.2** — Write failing test for AC-2: opt-out recording for unchecked default-on tags on new items
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js`
  - **Acceptance:** Two sub-cases in a single test or `describe` block:
    (a) Direct uncheck: uses `openAddItemPicker`, unchecks one default-on tag via click, clicks Fill Fields, submits. Asserts `itemRemovedTags` contains the unchecked tag for the new UUID.
    (b) Uncheck all: uses `openAddItemPicker`, clicks the \"Uncheck all\" action in the tag section, clicks Fill Fields, submits. Asserts `itemRemovedTags` contains the previously-default-on tags for the new UUID.
    Both sub-cases FAIL on current `dev` (removal walk gated on `_fillUuid`, and `data-user-touched` attribute does not exist yet).
  - **Depends on:** A.1
  - **Maps to:** AC-2, AC-4

- [x] **B.3** — Write failing negative test: no checkbox interaction produces no removedTags entries
  - **File(s):** `tests/playwright/numista-picker-tags.spec.js`
  - **Acceptance:** Uses `openAddItemPicker`, does NOT interact with any tag checkbox (no click, no Check all / Uncheck all), clicks Fill Fields, submits. Asserts `itemRemovedTags` for the new UUID is empty (no keys, or UUID key absent). This test MAY pass on current `dev` (since no tag write path fires at all) — that's acceptable. It becomes a regression guard ensuring AC-2 does not over-record untouched tags.
  - **Depends on:** A.1
  - **Maps to:** AC-2 (negative boundary)

- [x] **B.4** — Verify AC-3 regression guard already passes
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Run existing Test 5 (\"Fill Fields only imports checked tags\") at `numista-picker-tags.spec.js:486-517` in isolation. Confirm it passes on current `dev`. This test covers AC-3 (Edit flow unchanged) — no new test needed because the Edit path is not modified by this sketch. Document the passing test name as the AC-3 anchor.
  - **Maps to:** AC-3

## Sprint Cohort C — Implementation · GREEN (sequential)

_TDD green phase. Write the minimum code that makes all Cohort B tests pass. Each task depends on the previous — all touch catalog-api.js or events.js in a dependency chain._

- [x] **C.1** — Add `data-user-touched` intent tracking to tag checkboxes
  - **File(s):** `js/catalog-api.js`
  - **Acceptance:** In `renderNumistaFieldCheckboxes` (~1840-1981): each tag checkbox gets a `change` event listener that sets `cb.dataset.userTouched = \"1\"`. In the Check all / Uncheck all action handlers (~1966-1980): each affected checkbox gets `cb.dataset.userTouched = \"1\"` set BEFORE the programmatic `cb.checked = true/false` assignment. After this task, the DOM annotates user intent but nothing consumes it yet — B.2 still fails.
  - **Depends on:** B.1, B.2, B.3 (tests exist and are red)
  - **Maps to:** AC-2 (intent tracking prerequisite)

- [x] **C.2** — Add snapshot capture in Fill Fields handler and `clearPendingSnapshot` option to `closeNumistaResultsModal`
  - **File(s):** `js/catalog-api.js`
  - **Acceptance:**
    (1) Fill Fields button handler (~2873-2890): BEFORE calling `closeNumistaResultsModal`, captures `window.pendingNumistaPickerSnapshot = { resultId, checked: [...], removed: [...] }` by walking `input[name=\"numistaTag\"]`. `removed` includes only inputs where `dataset.userTouched === \"1\"` AND `checked === false`. `resultId` is the Numista `catalogId` from the current picker result.
    (2) `closeNumistaResultsModal` (~2456): accepts `{ clearPendingSnapshot?: boolean }` option. When `true`, sets `window.pendingNumistaPickerSnapshot = null`.
    (3) Every non-Fill-Fields caller of `closeNumistaResultsModal` passes `{ clearPendingSnapshot: true }`: Cancel button, results-close button, no-results/quick-pick close (~2855-2889, ~2933-2944, ~2648-2655), and `window.closeNumistaResultsModal` exposure (~2453-2457). Fill Fields handler passes `{ clearPendingSnapshot: false }`.
    (4) Existing `_fillUuid`-gated block at ~2380-2432 is UNCHANGED (Edit path preserved).
    After this task, snapshot is captured to `window` but nothing consumes it — B.1/B.2 still fail.
  - **Depends on:** C.1
  - **Maps to:** AC-1, AC-2 (capture half)

- [x] **C.3** — Add Add-branch snapshot consumer, defensive clear, and delete STAK-126 fallback
  - **File(s):** `js/events.js`
  - **Acceptance:**
    (1) In the submit handler (~2039-2089), in the **Add branch only** (`!isEditing`), AFTER `commitItemToInventory()` succeeds: read `snap = window.pendingNumistaPickerSnapshot`. If `snap` exists and `snap.resultId === fields.catalog` (from `parseItemFormFields`): call `applyNumistaTags(newUuid, snap.checked, true, true)` where `newUuid = inventory[inventory.length - 1].uuid`, then loop `snap.removed` through `addRemovedTag(newUuid, tag)`. Clear `window.pendingNumistaPickerSnapshot = null` regardless of match. The `force=true` mirrors Edit-mode Fill Fields behavior — explicit picker choices must be honored regardless of `numista_tags_auto` setting.
    (2) In `#newItemBtn` click handler (~3938-4008): add `window.pendingNumistaPickerSnapshot = null` as a defensive first step.
    (3) Delete the dead STAK-126 fallback at ~1894-1898 (per D-4 — `window.selectedNumistaResult` is never set, fallback never fires).
    After this task, ALL Cohort B tests should pass (GREEN). B.1 passes because snapshot is captured → consumed → tags applied. B.2 passes because `data-user-touched` + snapshot.removed → `addRemovedTag`. B.3 passes because untouched checkboxes have no `data-user-touched` → empty `removed` list. Existing Test 5 (AC-3) still passes because Edit branch is untouched.
  - **Depends on:** C.2
  - **Maps to:** AC-1, AC-2, AC-3, AC-4

---

## Standard Closing Tasks

> **Numbering:** Continue from the last sprint task. If your last sprint task is C.1, closing tasks start at C.2 — or relabel as 1, 2, 3 below; consistency matters more than scheme.

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run the project's complete test command. All existing tests pass; all new tests from Cohort B pass (green after Cohort C implementation).
  - If anything fails: fix the implementation, not the test. Tests are the spec — a failing test means the implementation is wrong, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1, AC-2, …), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Status-only notes (\"PR opened\", \"tests passing\") are not equivalent — the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (e.g., `package.json`, `js/constants.js`) — `sw.js` is auto-stamped by `stamp-sw-cache.sh` pre-commit hook, not edited manually.
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.
  - If the project opts out of version management (no `devops/version.lock`, or explicit project policy), write `N/A — project opts out of version management (<reason>)` as the acceptance line. Do not silently drop this task.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip.
  - Mark the source issue Done in Plane: `mcp__plane__update_issue` to state \"Done\".
  - If the project genuinely has no DocVault footprint, write `vault-update: N/A — <reason>` as a sub-line on this task and proceed with the issue close. Do not drop the task.

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/sketch apply`. Title: `vX.YY.ZZ — STRK-84: <short summary>` (StakTrakr versioned PR title convention per `coding-standards.md:512-527`). Target: `dev`.
  - Body must include: link to source issue, link to sketch folder (`DocVault/Projects/{project}/sketches/STRK-84-numista-tags-first-fill/`), test plan checklist.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as \"comments outside of the diff\" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.

- [x] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-84`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-84-numista-tags-first-fill/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** No `[P]` parallel tasks in this sketch — all cohorts are sequential because every task either shares a file with its neighbor or depends on the previous task's output. The TDD boundary between Cohort B (red) and Cohort C (green) is the natural model-routing seam: one model writes the failing tests, a different model writes the implementation to make them pass. Suggested split: Codex for A.1 + B.1–B.4 (test scaffolding + test writing), Claude or Gemini for C.1–C.3 (implementation requiring cross-file reasoning across catalog-api.js and events.js).

## Review Archive — tasks (2026-05-18)

_Reconciled by /sketch reconcile on 2026-05-18. Original reviewer marks preserved below for audit._

### Codex

#### Verified

- `tests/playwright/numista-picker-tags.spec.js:93-199` contains the existing helper block; `gotoApp()` currently waits for `window.inventory.length > 0` at `tests/playwright/numista-picker-tags.spec.js:171-178`, which conflicts with the new empty-inventory Add helper unless the task calls for a different readiness path.
- `index.html:2398-2405` defines the live Numista field/button as `#itemCatalog` and `#searchNumistaBtn`; `js/events.js:2627-2683` is the real search path from the Add/Edit modal into `showNumistaResults`.
- `js/catalog-api.js:1858-1980` renders tag checkboxes and bulk Check all / Uncheck all actions; direct programmatic `cb.checked` assignment is still the live behavior.
- `js/catalog-api.js:2396-2403` shows the current Edit Fill Fields tag path uses `applyNumistaTags(_fillUuid, checkedTags, true, true)`.
- `js/tags.js:366-418` confirms `applyNumistaTags()` is add-only and gates default calls on `numista_tags_auto` unless `force=true`; `js/tags.js:331-340` confirms `addRemovedTag()` is the direct opt-out primitive.
- `js/events.js:1838-1848` mints Add-mode UUIDs during `commitItemToInventory()`, `js/events.js:2039-2067` is the unified submit hook, and `js/events.js:3938-4008` is the live New Item button handler.
- `DocVault/Projects/StakTrakr/Foundation/coding-standards.md:463-510` verifies the version-lock and `.worktrees/patch-<VERSION>` convention; `:339-346` and `:465-477` verify `sw.js` cache stamping is hook-owned; `:512-527` verifies versioned commit/PR targeting expectations.

#### Top concerns

1. **C.3 can still drop explicit picker tags when `numista_tags_auto` is false.** The task says to call `applyNumistaTags(newUuid, snap.checked)` with defaults, but the existing Edit path passes `force=true`; Add should almost certainly mirror that explicit-user-choice behavior.
2. **A.1 can hang if it reuses `gotoApp()` unchanged.** The task correctly demands empty inventory, but the existing helper waits for a non-empty inventory array.
3. **The StakTrakr release/worktree closeout is still too generic in two places.** Cohort 0 references an unverified `/start-patch` alias and CLOSE-6 gives a generic `chore(STRK-84)` title instead of the versioned patch flow.

#### Unverified assumptions

- The implementation should force-apply checked Add-flow picker tags regardless of `numista_tags_auto`, matching Edit Fill Fields semantics.
- `stubCatalogLookup()` is sufficient for the true Add-modal search path once the test also satisfies `ensureNumistaConfiguredOrPrompt()`; I verified the stubbed provider methods, but did not run the browser flow during this read-only review.
- The new tests will identify the new row UUID by reading `metalInventory` after submit rather than relying on UI order.
- `itemRemovedTags` intentionally remains local-only for this sketch; I verified `addRemovedTag()` mechanics but did not re-audit sync allowlists in this phase.

### Gemini

#### Verified

- `js/catalog-api.js:1860-1994`: Verified `renderNumistaFieldCheckboxes` rendering logic and programmatic `cb.checked` assignment in bulk actions.
- `js/events.js:1838-1848`: Verified UUID minting for new items.
- `js/events.js:1894`: Confirmed `window.selectedNumistaResult` is undefined due to lexical scope isolation in `catalog-api.js`, making the fallback dead code.
- `tests/playwright/numista-picker-tags.spec.js:177`: Verified `gotoApp` waits for `window.inventory.length > 0`, which will cause A.1 to hang.
- `DocVault/Projects/StakTrakr/Foundation/coding-standards.md:463-510`: Verified `patch/<VERSION>` and version-lock requirements.
- `js/tags.js:376-380`: Verified `applyNumistaTags` behavior regarding `numista_tags_auto`.

#### Top concerns

1. **C.3 Tag Drop Risk:** I strongly support CODEX's concern about `applyNumistaTags` call signature. For new items, the code must pass `force=true` to honor the user's explicit picker selections, regardless of the `numista_tags_auto` setting.
2. **A.1 Test Hang:** `gotoApp` must be updated or a new helper created to support empty inventory tests, as the current readiness check requires existing data.
3. **Worktree/PR Convention Drift:** The tasks for setup (0.1) and PR opening (CLOSE-6) must be updated to explicitly name the StakTrakr versioned worktree and PR title conventions to avoid violating repo standards.

#### Unverified assumptions

- Assumption that the snapshot mechanism is preferred over pre-allocating UUIDs (which would require a larger refactor of `commitItemToInventory`).
- Assumption that `fields.catalog` is the correct comparison target for the snapshot (it is the value of `#itemCatalog`, which is set by the picker).
- Assumption that `/release patch` handles the worktree creation or that the user will perform the manual steps documented in `coding-standards.md`.

### Resolution Summary

- Accepted: 5 (force=true call signature, gotoApp hang guard, sw.js removal, versioned PR title, programmatic cb.checked confirmation)
- Rejected: 2 (/start-patch existence — both reviewers falsely claimed it doesn't exist; /release patch as setup entry — /start-patch is the correct entry point)
- Resolved with your input: 0

## Verification Stamp

- [x] AC-1 — verified by "21. STRK-84 AC-1: tags persist on first Fill Fields for new Add Item" (`tests/playwright/numista-picker-tags.spec.js:1245`)
- [x] AC-2 — verified by "22. STRK-84 AC-2: opt-out recording for unchecked default-on tags on new items" (`tests/playwright/numista-picker-tags.spec.js:1284`) and "22b. STRK-84 AC-2: Uncheck all records opt-outs for default-on tags on new items" (`tests/playwright/numista-picker-tags.spec.js:1327`)
- [x] AC-3 — verified by "5. Existing-item tag persistence — regression guard (pre-fix green)" (`tests/playwright/numista-picker-tags.spec.js:486`); passes both before and after implementation
- [x] AC-4 — verified by tests 21, 22, 22b, 23 using the true Add Item helper path (`seedAddItemData` + `gotoEmptyApp` + `openAddItemPicker`) — distinct from the existing Edit flow helpers; all four fail on `origin/dev` and pass post-fix
