---
sketch: "STRK-46-capsule-field"
phase: tasks
created: 2026-05-08
approved: 2026-05-08
---

# STRK-46 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-46-capsule-field`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.
  - **Implementation note:** StakTrakr's repo hard gate overrides the generic sketch branch name. Worktree created at `/Volumes/DATA/GitHub/StakTrakr/.worktrees/patch-3.34.53/` on branch `patch/3.34.53`; baseline `npm run lint` exited 0 with two pre-existing warnings.

## Sprint Cohort A — Foundation (parallel-safe)

_Each task touches exactly one file. Edits follow existing patterns and use the field names defined in approach.md (`capsule`, `capsuleNotes`, `itemCapsule`, `itemCapsuleNotes`). No task creates a symbol that another Cohort A task references — safe to dispatch to different models concurrently._

- [x] **A.1 [P]** — Add Capsule and Capsule Notes HTML inputs to Catalog Data section
  - **File(s):** `index.html`
  - **Acceptance:** A new `<div class="grid grid-2">` row exists immediately after the Diameter/Thickness/Orientation `grid-3-equal` row inside `<div id="numistaDataSection">`. Contains: (1) `<input id="itemCapsule" type="text" placeholder="e.g. A-32, X-38-Ring">` with label "Capsule", (2) `<input id="itemCapsuleNotes" type="text" placeholder="e.g. Guardhouse 38mm — tight fit">` with label "Capsule Notes", (3) a `<span id="capsuleSuggestion">` hint element below or beside the Capsule input for diameter-based suggestion display. Existing layout of Diameter/Thickness/Orientation grid is unchanged. Satisfies AC-7 (layout integrity).
  - **Leverage:** Existing `grid grid-2` pattern used by Technique/Mintage row below. Follow the `<label> + <input>` structure of surrounding fields.
  - **Maps to:** AC-1, AC-2, AC-3, AC-6, AC-7
  - **Implementation note:** Added the Capsule/Capsule Notes grid row after the Diameter/Thickness/Orientation row with `itemCapsule`, `itemCapsuleNotes`, and `capsuleSuggestion` elements.

- [x] **A.2 [P]** — Register capsule element placeholders in state
  - **File(s):** `js/state.js`
  - **Acceptance:** `elements` object contains `itemCapsule: null` and `itemCapsuleNotes: null` alongside existing entries like `itemNotes`. Also add `capsuleSuggestion: null` for the suggestion hint span.
  - **Leverage:** Follow the existing `itemSerialNumber: null, itemNotes: null` pattern at ~line 67.
  - **Maps to:** _plumbing — enables A.4, B.1, B.2_
  - **Implementation note:** Registered `itemCapsule`, `itemCapsuleNotes`, and `capsuleSuggestion` in the shared `elements` object.

- [x] **A.3 [P]** — Add Air-Tite data, suggestion function, and capsule autocomplete integration
  - **File(s):** `js/autocomplete.js`
  - **Acceptance:** Five additions:
    1. **`AIRTITE_CAPSULE_SIZES`** — static array of `{diameter, model, series, description}` entries covering all Air-Tite Direct Fit (A-series) and common Ring Type (H, I, X) sizes (~25 entries). Placed near `PREBUILT_LOOKUP_DATA`.
    2. **`getNearestAirtiteSize(diameterMm)`** — function that returns the closest Air-Tite match `{model, diameter, series}` or `null` if no diameter provided. Uses simple nearest-mm logic. **Must be explicitly exposed** (e.g. on `window` or via the module's public API object) so `init.js` can call it cross-file.
    3. **`updateCapsuleSuggestion(diameterMm)`** — thin wrapper that calls `getNearestAirtiteSize()` and sets `elements.capsuleSuggestion.textContent`. Exposed for direct call from `inventory.js` populate paths (avoids synthetic event dispatch — per Codex review).
    4. **`LookupTable` typedef** gains `capsules` field (string array). `generateLookupTable` extracts capsule values via `extractUniqueValues(data, "capsule", { caseSensitive: true })` — **must use `caseSensitive: true`** to preserve user-entered casing like `X-38-Ring`. Merges with Air-Tite model codes from the static array. Returns combined sorted array.
    5. **`attachAutocomplete`** call added for `elements.itemCapsule` with sourceType `"capsules"` in the initialization block (~line 1240). Guard against duplicate listener stacking if `initializeAutocomplete` is called more than once.
  - **Leverage:** `PREBUILT_LOOKUP_DATA` pattern for static data. `attachAutocomplete` / `getSourceArray` pattern for dropdown. `extractUniqueValues` `caseSensitive` option confirmed at line 414.
  - **Maps to:** AC-3, AC-4, AC-5
  - **Implementation note:** Added Air-Tite capsule seed data, nearest-size suggestion helpers, capsule lookup-table generation, user-capsule registration, duplicate autocomplete listener guards, and public `window.autocomplete` exports.

- [x] **A.4 [P]** — Add capsule and capsuleNotes to item object construction on save
  - **File(s):** `js/events.js`
  - **Acceptance:** The item object built on save (~line 1289) includes `capsule: elements.itemCapsule?.value?.trim() ?? ""` and `capsuleNotes: elements.itemCapsuleNotes?.value?.trim() ?? ""` as top-level fields alongside existing fields like `notes` and `tags`.
  - **Leverage:** Follow the `notes: elements.itemNotes ? elements.itemNotes.value.trim() : ""` pattern. Use optional chaining since elements may be null during tests.
  - **Maps to:** AC-1, AC-2
  - **Implementation note:** Added `capsule` and `capsuleNotes` to form parsing, item field construction, edit change tracking, and runtime capsule lookup registration.

- [x] **A.5 [P]** — Add capsule and capsuleNotes display in the View modal
  - **File(s):** `js/viewModal.js`
  - **Acceptance:** In the Catalog Data section (`_section("Catalog Data")` at ~line 1168), capsule and capsuleNotes display rows appear after the Diameter/Thickness block (~line 1191). Capsule is shown if `item.capsule` is truthy. Capsule Notes is shown if `item.capsuleNotes` is truthy. Both use the existing `_row(label, value)` or equivalent display pattern.
  - **Leverage:** Follow the `_row("Diameter", ...)` pattern at ~line 1191.
  - **Maps to:** AC-1, AC-6
  - **Implementation note:** View modal now renders Capsule and Capsule Notes in Catalog Data, including manual items that have capsule data but no catalog ID.

- [x] **A.6 [P]** — Extend search index with capsule field
  - **File(s):** `js/search.js`
  - **Acceptance:** Three search paths updated:
    1. **Multi-word `itemText` array** (~line 81): add `item.capsule || ""` to the join array.
    2. **Single-word `fieldMatch` chain** (~line 326): add `(item.capsule && wordRegex.test(item.capsule))` to the regex OR chain alongside `item.notes`, `item.serialNumber`, etc.
    3. **Fuzzy fallback** (~line 361): add `item.capsule` to the fuzzy-checked fields (gate behind `q.length > 2` like `storageLocation`).
       `capsuleNotes` follows the same pattern as `notes` — include in `itemText` and `fieldMatch` for full-text search coverage.
  - **Leverage:** Follow the existing `item.notes` pattern in each of the three search paths. Confirmed: search.js lines 81-100 (itemText), 326-349 (fieldMatch), 358-374 (fuzzy).
  - **Maps to:** AC-8
  - **Implementation note:** Added `capsule` and `capsuleNotes` to multi-word, single-word, and fuzzy search paths.

- [x] **A.7 [P]** — Extend filter index with capsule field
  - **File(s):** `js/filters.js`
  - **Acceptance:** Three search paths updated (mirrors A.6 for filters.js):
    1. **Multi-word cached `itemText` array** (~line 1116): add `item.capsule || ""` and `item.capsuleNotes || ""` to the join array.
    2. **Single-word `fieldMatch` chain** (~line 1242): add `(item.capsule && wordRegex.test(item.capsule))` to the regex OR chain.
    3. **Fuzzy fallback `fieldsToCheck`** (~line 1280): add `item.capsule || ""` to the array.
       Cache note: `searchCache` is a `WeakMap` keyed on item objects. Edit paths replace `inventory[editIdx]` with a new object (cache miss = rebuild, correct). Verify bulk/import paths also create new objects rather than mutating in place.
  - **Leverage:** Follow the existing `item.notes` pattern in each path. Confirmed: filters.js lines 1116-1134 (itemText), 1242-1264 (fieldMatch), 1280-1285 (fuzzy).
  - **Maps to:** AC-8
  - **Implementation note:** Added `capsule` and `capsuleNotes` to advanced filter cache, field-match, and fuzzy fallback paths.

## Sprint Cohort B — Wiring (sequential)

_Tasks in this cohort reference symbols and patterns created in Cohort A. Run in order after all Cohort A tasks are complete._

- [x] **B.1** — Bind capsule elements and wire diameter-based suggestion listener
  - **File(s):** `js/init.js`
  - **Acceptance:** Three additions:
    1. `elements.itemCapsule = safeGetElement("itemCapsule")` and `elements.itemCapsuleNotes = safeGetElement("itemCapsuleNotes")` and `elements.capsuleSuggestion = safeGetElement("capsuleSuggestion")` in the element-binding block (~line 212).
    2. A listener on the `numistaDiameter` input field that calls `updateCapsuleSuggestion()` (exported from `autocomplete.js` in A.3) to update the suggestion hint. This is a direct function call, not a synthetic event dispatch.
    3. The listener fires on `"input"` events so it updates dynamically as the user types a diameter (AC-3). For blank, non-numeric, or non-round (length x width) dimensions: clear the suggestion hint — no match shown.
  - **Depends on:** A.1 (HTML IDs exist), A.2 (state keys registered), A.3 (`updateCapsuleSuggestion` function defined and exposed)
  - **Leverage:** Follow existing `safeGetElement` binding pattern. The diameter input is `numistaDiameter` (Numista-sourced field).
  - **Maps to:** AC-3
  - **Implementation note:** Bound all three new elements and wired `numistaDiameter` input directly to `updateCapsuleSuggestion()`.

- [x] **B.2** — Populate capsule fields on edit and duplicate modal open
  - **File(s):** `js/inventory.js`
  - **Acceptance:** Two separate code paths updated:
    1. **Edit path** (~line 1328): `if (elements.itemCapsule) elements.itemCapsule.value = item.capsule || "";` and same for `itemCapsuleNotes`. After `populateNumistaDataFields()` and any shape/dimension normalization completes, call `updateCapsuleSuggestion()` directly with the final diameter value — do NOT use synthetic `input` event dispatch (ordering is fragile when diameter normalization runs).
    2. **Duplicate path** (~line 1679): Same capsule population lines. Same direct `updateCapsuleSuggestion()` call after diameter is settled.
       Verify: opening an existing item for edit shows its saved capsule value AND the diameter-based suggestion. Opening a new item shows empty capsule fields and suggestion updates as diameter is entered.
  - **Depends on:** A.2 (state keys), B.1 (element binding, suggestion listener wired), A.3 (`updateCapsuleSuggestion` exposed)
  - **Leverage:** Follow `elements.itemNotes.value = item.notes || ""` pattern. Call `updateCapsuleSuggestion(diameterValue)` after all Numista field population is complete.
  - **Maps to:** AC-1, AC-3
  - **Implementation note:** Edit, duplicate, and Numista metadata population paths now fill capsule fields and refresh the suggestion after dimensions settle. JSON backup import/export also preserves the new fields to avoid full-backup data loss.

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite + manual smoke pass** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm run test:offline` (skip network-dependent tests). All existing tests pass.
  - **Manual browser smoke pass** (capsule-specific E2E tests are out of scope for this sketch): open the app in Chrome, verify these flows in the dev server or via `file://`:
    1. Create a new item with capsule value + capsule notes → saves and displays in View modal (AC-1, AC-2, AC-6)
    2. Edit an existing item → capsule fields populate, persist on save (AC-1)
    3. Enter/change diameter → suggestion hint updates dynamically; blank/non-numeric diameter → no suggestion (AC-3)
    4. Type in capsule field → autocomplete shows Air-Tite matches + user history (AC-4, AC-5)
    5. Search for a capsule code → item found via all search paths (AC-8)
    6. Resize to mobile viewport → capsule row doesn't break layout (AC-7)
  - If anything fails: fix the implementation, not the test.
  - **Verification:** `npm run lint` passed with 0 errors / 2 pre-existing warnings in `js/diff-engine.js` and `js/diff-modal.js`; `npx playwright test tests/playwright/capsule-field.spec.js` passed; `npm run test:offline` passed 518/518 after hardening the seed-image loader race exposed by STAK-437; manual browser smoke covered add, edit, suggestion clear/update, autocomplete, search, view modal, and mobile layout.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - Note: fresh worktree — commit at least once before scanning to avoid the empty-diff fallthrough to whole-repo scan (per CLAUDE.md pre-PR scan gotcha).
  - **Verification:** Codacy CLI completed after the first commit. Parsed `codacy-findings.sarif` against `git diff --name-only <merge-base>...HEAD`; changed-file findings: 0. Generated SARIF was removed after parsing.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-8), write exactly one line:
    - `- [x] AC-N — verified at <relative/file/path>:<line>`, OR
    - `- [x] AC-N — verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>`.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.
  - Note: UI-behavioral ACs (AC-3, AC-7) may use `verified by manual browser check` format — they cannot be proven from file lines alone.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`)
  - **MUST invoke `/release patch`** — the skill enforces version-lock claim, 6-file enumeration, What's New trimming, and `stamp-sw-cache` pre-commit hook interactions.
  - **Verification:** Version bumped to `3.34.53` in all release artifacts. Pre-commit hooks passed and stamped `sw.js` cache name in commit `0ee96bf1`.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** — even if no foundation docs seem affected, the skill audits. Capsule fields are a data-model addition; `architecture.md` may need a mention.
  - Mark STRK-46 Done in Plane: `mcp__plane__update_issue` to state "Done".
  - **Status:** Vault update completed for the data-model change in `Projects/StakTrakr/Foundation/Deep Dives/Data Model.md`; Plane comment added with PR/status/validation. Issue state intentionally not moved to Done because draft PR review and merge/live verification remain pending.

- [x] **CLOSE-6. Open PR**
  - Use worktree branch `sketch/STRK-46-capsule-field`. Title: `feat(STRK-46): Structured Capsule field + capsule notes`.
  - Body must include: link to [STRK-46](https://plane.lbruton.cc/lbruton/browse/STRK-46/), link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-46-capsule-field/`), test plan checklist.
  - **Verification:** Draft PR opened from StakTrakr patch branch `patch/3.34.53`: https://github.com/lbruton/StakTrakr/pull/1093

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** — the skill triages findings, fixes or classifies, and replies to threads consistently.
  - Coverage: scan **both** inline diff threads AND review-body findings (Codacy, Copilot, CodeRabbit summaries).
  - All Critical/High: fix or false-positive with reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - **Verification:** Resolved 8 bot review threads on draft PR #1093. Follow-up commit `9d42919b` fixed diameter parsing, fit-aware capsule sizing, non-round suggestion clearing, redundant sanitizer handling, and formatting cleanup; the complexity extraction suggestion was documented as deferred. Final GitHub checks passed and `mergeStateStatus` is `CLEAN`.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-46`** — moves folder to `archive/2026-MM-DD-STRK-46-capsule-field/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort A tasks (A.1–A.7) can be sent to different models in parallel via OpenCode. Each model reads the sketch folder, executes its task on the worktree branch, and commits. Reconverge before Cohort B. Suggested split: A.3 (autocomplete, heaviest) to Codex; A.1 (HTML) and A.5 (viewModal) to Kimi; remaining small tasks to Claude.

## Verification Stamp

- [x] AC-1 — verified at js/events.js:1287
- [x] AC-2 — verified at js/viewModal.js:1202
- [x] AC-3 — verified at js/autocomplete.js:429
- [x] AC-4 — verified at js/autocomplete.js:1381
- [x] AC-5 — verified at js/autocomplete.js:1106
- [x] AC-6 — verified at tests/playwright/capsule-field.spec.js:152
- [x] AC-7 — verified by manual browser smoke mobile layout check
- [x] AC-8 — verified at tests/playwright/capsule-field.spec.js:131
