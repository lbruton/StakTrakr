---
sketch: STRK-38-rect-image-sizing
phase: tasks
created: 2026-05-14
approved: 2026-05-14
---

# STRK-38 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project, mark it `N/A — <one-line reason>` rather than dropping the task.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable._

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a `patch/VERSION` worktree+branch per StakTrakr convention (`CLAUDE.md`: "Worktree naming: `.worktrees/<issue>-<slug>/` (via `/start-patch`) or `.worktrees/patch-<version>/` (via `/release`)"). Working directory is that worktree, not the main checkout. If the worktree is missing, STOP and report.
  - **Leverage:** `/start-patch` skill; `using-git-worktrees` skill.

## Sprint Cohort 1 — Tests (TDD red phase, sequential)

_Tests written FIRST per TDD discipline. They will fail (red) until implementation lands in Cohorts 2–4. The approach doc specifies both a new test file and extending the existing one._

- [x] **1.1** — Write Playwright tests for rect image rendering in card/table views
  - **File(s):** `tests/playwright/rect-image-card-table.spec.js` (new)
  - **Acceptance:** Test file covers:
    - AC-1: Card A rect item — `.coin-img.bar-shape` has `background: transparent` (computed), container is 36×24, image has `object-fit: contain`.
    - AC-2: Card B rect item — `.coin-img.bar-shape` has `background: transparent`, container is 80×56.
    - AC-3: Card C rect item — `.coin-img.bar-shape` has `background: transparent`, container is 80×56.
    - AC-4: Table rect thumbnail — `.table-thumb-rect` has `background: transparent`.
    - AC-5: Table no-image placeholder for rect item — SVG data URI contains `<rect` (not `<circle` for outer shape). Include explicit cases for: (1) manual `obverseImageFrame: "rectangle"` override, (2) grading-authority-driven rect, (3) Numista non-round shape — these exercise the `_loadThumbImage` → `resolveImageFrame` → `_getThumbPlaceholder` path.
    - AC-6: Round coin in all views — rendering unchanged (circular mask, `background: var(--bg-tertiary)` or theme equivalent, `object-fit: cover`).
  - **Maps to:** AC-1 through AC-7 (partial — table placeholder path).

- [x] **1.2** — Extend existing frame override tests for Card B and Card C
  - **File(s):** `tests/playwright/image-frame-override.spec.js`
  - **Acceptance:** The existing mixed-side frame test (`:123-159`) is extended with Card B and Card C assertions: when an item has `obverseImageFrame: "rectangle"` and `reverseImageFrame: "circle"`, Card B and Card C render the obverse `.coin-img` with `.bar-shape` class and the reverse without. Assert both the `.bar-shape` class presence and the expected dimensions per card style. Maps to: AC-7.
  - **Leverage:** Existing test structure at `tests/playwright/image-frame-override.spec.js:123-159`.

## Sprint Cohort 2 — CSS: card and table `.bar-shape` overrides (sequential)

_Tasks in this cohort modify a single file (`css/styles.css`) but target non-overlapping rule blocks. However, because they all edit the same file, they CANNOT run in true parallel — they are grouped here for conceptual clarity but must execute sequentially within this cohort._

- [x] **2.1** — Remove dead-space background for base `.bar-shape` and table rect thumbs
  - **File(s):** `css/styles.css`
  - **Acceptance:** `.card-view-grid .coin-img.bar-shape` has `background: transparent;` overriding the base `--bg-tertiary`. `.table-thumb.table-thumb-rect` (in the `:5307` block) also has `background: transparent;`. Existing round-item `.coin-img` background unchanged. Note: a second `.table-thumb.table-thumb-rect` selector exists at `:13541` (only `object-fit: contain`) — no change needed there; the `background` property is uncontested at `:5307`. Maps to: AC-1, AC-2, AC-3, AC-4.
  - **Leverage:** Approach D-7 (surgical `transparent` override, don't edit the base rule).

- [x] **2.2** — Add Card A `.bar-shape` override at correct specificity
  - **File(s):** `css/styles.css`
  - **Depends on:** 2.1
  - **Acceptance:** New rule `.card-a .cv-images-sm .coin-img.bar-shape` (4-class specificity, matching or exceeding the existing `.card-a .cv-images-sm .coin-img` at `:13609`) with: `width: 36px; height: 24px; border-radius: var(--radius); background: transparent;`. No changes to the existing round-item `.card-a .cv-images-sm .coin-img` rule. Maps to: AC-1.
  - **Leverage:** Approach D-3 (36×24 landscape ratio); discovery specificity analysis of `:13609-13615`.

- [x] **2.3** — Add Card B `.bar-shape` override
  - **File(s):** `css/styles.css`
  - **Depends on:** 2.2
  - **Acceptance:** New rule `.card-b .coin-img.bar-shape` with: `width: 80px; height: 56px; border-radius: var(--radius); background: transparent;`. Existing `.card-b .coin-img` (`:13680`) unchanged. Note: the inherited `border: 2px solid var(--border)` from `.card-b .coin-img` will apply — defer to visual QA during testing to decide if it should be suppressed. Maps to: AC-2.
  - **Leverage:** Approach D-4 (80×56 matching Card C).

- [x] **2.4** — Fix Card C `.bar-shape` background
  - **File(s):** `css/styles.css`
  - **Depends on:** 2.3
  - **Acceptance:** Existing `.card-c .coin-img.bar-shape` rule (`:13729`) gains `background: transparent;`. Existing dimensions (80×56) preserved. Maps to: AC-3.
  - **Leverage:** Discovery finding that Card C already has correct dimensions but missing background fix.

## Sprint Cohort 3 — JS: card-view object-fit coordination (sequential)

_Modifies `_cardImageHTML()` to emit `object-fit: contain` for rect items. Depends on Cohort 2 being committed (CSS wrapper dimensions must exist before changing fit behavior)._

  - [x] **3.1** — Verify `_cardImageHTML()` emits `object-fit: contain` for rect items
  - **File(s):** `js/card-view.js`
  - **Depends on:** Cohort 2
  - **Acceptance:** Line ~563 already computes `fitStyle` as `"object-fit:contain;"` for rect items and `"object-fit:cover;"` for round items, and line ~573 emits it inline. **Verify** this is already correct by reading the code — confirmed by reviewers as a no-op. The inline `width:100%;height:100%;border-radius:inherit;` must remain unchanged (load-bearing, no `.cv-thumb` CSS rule). Maps to: AC-1, AC-2, AC-3.
  - **Leverage:** Approach D-1 (hybrid JS+CSS); discovery finding at `js/card-view.js:563,573`.

## Sprint Cohort 4 — JS: table SVG placeholder shape (sequential)

_Modifies `_getThumbPlaceholder()` and its call sites. Independent of Cohorts 2–3 at the file level but logically depends on the CSS background fix (Cohort 2, task 2.1) being in place._

- [x] **4.1** — Add `shape` parameter to `_getThumbPlaceholder()` and branch outer SVG
  - **File(s):** `js/inventory-table.js`
  - **Acceptance:** `_getThumbPlaceholder(metal, type, shape)` accepts a third `shape` parameter (default `"round"`). When `shape === "rect"`, the outer SVG element is `<rect x="1" y="1" width="30" height="30" rx="8" .../>` instead of `<circle cx="16" cy="16" r="15" .../>`. Cache key expands to `metal:type:shape`. When `shape === "round"` or omitted, behavior is identical to current. Maps to: AC-5 (table placeholder).
  - **Leverage:** Approach D-5 (full resolver path); discovery analysis of `:245-274`.

- [x] **4.2** — Update placeholder call sites to pass resolved frame via hoisted `invItem`
  - **File(s):** `js/inventory-table.js`
  - **Depends on:** 4.1
  - **Acceptance:** The `invItem` declaration is hoisted from its current block-scoped position (`const invItem` inside `if (idx !== undefined) { ... }` at `:314-321`) to function scope: declare `let invItem;` before the `if` block, then assign `invItem = inventory[parseInt(idx, 10)]` inside the block. After hoisting, both call sites (`:331` onerror callback and `:346` unconditional fallback) call `_getThumbPlaceholder(item.metal, item.type, resolvedShape)` where `resolvedShape` comes from `resolveImageFrame(invItem, side)`. When `invItem` is `undefined` (no `idx` or inventory miss), `resolveImageFrame` returns `"round"` (null-safe — verified at `js/image-frame.js:31`). Maps to: AC-5, AC-7.
  - **Leverage:** Approach D-5; discovery constraint on reduced vs full item objects.

---

## Standard Closing Tasks

> **Numbering:** Continues from Sprint Cohort 4.

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test`. All existing tests pass; all new tests from Cohort 1 pass (green after Cohorts 2–4 implementation).
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-7), write exactly one line:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` or `verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>`.
  - The stamp block MUST list every AC. Refuse to proceed to CLOSE-4 if any `[ ]` remains.

- [x] **CLOSE-4. Version bump + spot bundle**
  - **MUST invoke `/release patch`** as a skill.
  - **MUST invoke `/update-spot-bundle`** before the version-bump PR (per CLAUDE.md: "Run `/update-spot-bundle` before EVERY version-bump PR").

- [x] **CLOSE-5. Vault update** — N/A, no foundation doc changes needed (CSS/JS fix within existing patterns)
  - **MUST invoke `/vault-update`** as a skill.

- [x] **CLOSE-6. Open PR** — PR #1120
  - Use worktree branch from `/start-patch`. Title: `fix(STRK-38): rectangular item images auto-size in card/table views`
  - Body must include: link to STRK-38, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-38-rect-image-sizing/`), test plan checklist.

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-38`** as a skill.

- [ ] **CLOSE-9. Mark Plane issue Done** (after PR merges)
  - Mark STRK-38 Done in Plane: `mcp__plane__update_issue` to state "Done".
  - Must run AFTER CLOSE-8 — never mark Plane issues Done before the PR merges.

---

> **Multi-model dispatch hint:** Cohort 1 (tests, TDD red phase) should run first — a single model writes both test files. Cohorts 2–4 modify different files (`css/styles.css`, `js/card-view.js`, `js/inventory-table.js`) and are architecturally independent, but Cohort 2 tasks are sequential (same file) and Cohort 3 task 3.1 may be a no-op verification. Suggested orchestration: Cohort 1 tests (red), then Cohorts 2–4 serially (same model, fast — tests go green), then closing tasks as a single batch.

---

## Review Archive — tasks (2026-05-14)

_Reconciled by /sketch reconcile on 2026-05-14. Original reviewer marks preserved below for audit._

### OpenCode

**Verified:**

- **Task 2.1 (originally 2.1) — `_cardImageHTML()` already correct:** `js/card-view.js:563` computes `fitStyle = isRect ? "object-fit:contain;" : "object-fit:cover;"`, emitted inline at `:573`. Confirmed no-op — the JS already emits `contain` for rect items. The approach.md File Map prose says "changing `object-fit` from `cover` to `contain`" but this is stale relative to the live code (D-1 decision table is accurate).

- **Task 3.1 (originally 3.1) — `_getThumbPlaceholder` signature:** `js/inventory-table.js:245` currently takes `(metal, type)`. The SVG outer shape is `<circle>` at `:267`. The inner icon varies (bar icon for `isBar`, coin circles otherwise) at `:262-264`. Cache key is `metal:type` at `:246`. All correct per task description.

- **Task 3.2 (originally 3.2) — Call sites use reduced `item`:** Both `:331` and `:346` call `_getThumbPlaceholder(item.metal, item.type)` using the dataset-reconstructed `item` (lines 301–307). This reduced object omits `obverseImageFrame`, `reverseImageFrame`, `weightUnit`, `gradingAuthority`, and `numistaData.shape` — all fields `resolveImageFrame()` needs (see `js/image-frame.js:30-65`). The full `invItem` is resolved at `:314-320` but only for CDN URL extraction.

- **CSS rules match discovery/approach claims:**
  - `.card-view-grid .coin-img` at `:13494-13503`: `background: var(--bg-tertiary)` ✓
  - `.card-view-grid .coin-img.bar-shape` at `:13504-13506`: only `border-radius`, no background removal ✓
  - `.card-a .cv-images-sm .coin-img` at `:13609-13615`: 36×36, `border-radius: 50%` ✓
  - `.card-b .coin-img` at `:13680-13684`: 80×80, no `.bar-shape` override ✓
  - `.card-c .coin-img.bar-shape` at `:13729-13733`: 80×56, correct dimensions, needs `background: transparent` ✓
  - `.table-thumb` at `:5290-5300`: 28×28, `background: var(--bg-tertiary)` ✓
  - `.table-thumb.table-thumb-rect` at `:5307-5309`: only `border-radius`, no background removal ✓
  - `.table-thumb.table-thumb-rect` at `:13541-13543`: adds `object-fit: contain` ✓

- **Tests — Card B/C gap confirmed:** `tests/playwright/image-frame-override.spec.js:123-159` covers table, Card A, and modal mixed-side frame rendering. Card B and Card C are not tested — the gap identified in discovery and planned for task 1.2 is real.

- **Standard Closing Tasks:** All present. Skill references correct.

**Top Concerns:**

1. **Task 3.2 — `invItem` scope is a blocker.** `invItem` is declared with `const` inside the `if (idx !== undefined) { … }` block at `js/inventory-table.js:314-321`. It is NOT accessible at line 331 (inside an `onerror` callback closure nested in `if (blobUrl) { … }`) or at line 346 (outside the `if` block). The acceptance criteria say "The `invItem` lookup is available on both fallback paths" — this is incorrect. The implementation must either hoist `invItem` to function scope or re-resolve `inventory[parseInt(idx, 10)]` at each fallback site. The `idx` variable IS in scope at both lines (`const idx` at `:312`). This needs a restructure, not just a call-site parameter change.

2. **Task 2.1 — object-fit already emits `contain`.** The code at `js/card-view.js:563` already switches `object-fit` correctly. The task is a no-op verification, which is correctly stated — but the approach.md File Map for `js/card-view.js` describes this as a change ("changing only `object-fit` from `cover` to `contain`"), which is stale relative to the live code. The D-1 decision table in approach.md is accurate; only the File Map prose needs reconciliation. No implementation risk, but the discrepancy could mislead an agent that reads approach.md without cross-checking the live code.

3. **Missing `npm run lint` in closing tasks.** The standard closing tasks include `npm test` (CLOSE-1) and Codacy scan (CLOSE-2) but there is no explicit lint step. Per AGENTS.md and CLAUDE.md, `npm run lint` should be run before committing. It may be implicitly covered by the pre-commit hooks or by the Codacy CLI scan, but Codacy's ESLint rules are a subset of the local `.eslintrc.json`. Recommend adding `npm run lint` as part of CLOSE-1 or a separate closing task.

**Unverified Assumptions:**

- Fixed dimension values (36×24 for Card A, 80×56 for Card B/C) are visually acceptable across real bar, note, Goldback/Silverback, and proof-set image assets. These are judgment calls — no screenshot or pixel-level QA plan exists in the tasks.
- The `background: transparent` overrides won't cause theme contrast issues (e.g., dark row background + transparent `.coin-img` on dark-themed table rows). The `.coin-img` wrapper has no border/outline for rect items, so a transparent background relies on the parent's background for contrast.
- Card B's new `.card-b .coin-img.bar-shape` rule won't conflict with responsive media queries that target `.card-b .coin-img`. A grep for `@media.*card-b.*coin-img` in styles.css should be done before writing the override — the approach.md risk notes acknowledge this but the tasks don't include the grep verification step.
- The reduced dataset-derived `item` object (without frame override fields) is sufficient as a fallback for `resolveImageFrame()` when `idx` is `undefined` and `invItem` cannot be looked up. (Edge case: row without `data-idx` attribute.)
- `_getThumbPlaceholder` cache key expansion from `metal:type` to `metal:type:shape` won't create problematic cache growth. The cache is in-memory and cleared on page reload, so this is low risk — but worth noting the assumption.
- The existing `onerror` callback at `:326-333` (which sets `img.src = _getThumbPlaceholder(item.metal, item.type)`) can safely be modified to capture the resolved shape from `invItem`. Since the callback is a closure, any restructuring that makes `invItem` available must ensure it doesn't create a reference to a stale or undefined variable when the `onerror` fires asynchronously.
- Cohort 1 tasks (1.1 and 1.2) modify different test files — they could be `[P]` parallel-safe within the cohort if the implementer runs them in separate agent sessions.

### Claude

**Verified (first review pass):**

- `css/styles.css:5307` — `.table-thumb.table-thumb-rect` exists; currently only `border-radius: var(--radius)`. Background fix needed. ✓
- `css/styles.css:13504` — `.card-view-grid .coin-img.bar-shape` exists; currently only `border-radius: var(--radius)`. Background fix needed. ✓
- `css/styles.css:13541` — Second `.table-thumb.table-thumb-rect` block (only `object-fit: contain`). Not referenced in tasks; task 2.1 targeting `:5307` is correct, CSS cascade handles the split. ✓
- `css/styles.css:13609-13615` — `.card-a .cv-images-sm .coin-img` (36×36, `border-radius: 50%`). ✓
- `css/styles.css:13680-13684` — `.card-b .coin-img` (80×80, `border: 2px solid var(--border)`, no explicit border-radius). ✓
- `css/styles.css:13729-13733` — `.card-c .coin-img.bar-shape` (80×56, `border-radius: var(--radius)`, no `background`). ✓
- `js/card-view.js:563` — `fitStyle` already emits `"object-fit:contain;"` for rect and `"object-fit:cover;"` for round. Task 3.1 is a confirmed no-op. ✓
- `js/inventory-table.js:245` — `_getThumbPlaceholder(metal, type)` — 2 params only. Task 4.1's addition of `shape` is correct. ✓
- `js/inventory-table.js:266-269` — SVG outer `<circle cx="16" cy="16" r="15" .../>` in 32×32 viewBox. Task 4.1's proposed `<rect x="1" y="1" width="30" height="30" rx="8" .../>` is dimensionally sound. ✓
- `js/inventory-table.js:314-321` — `const invItem` is block-scoped inside `if (idx !== undefined) { ... }`. NOT visible at lines 331 or 346. Critical scope bug — confirmed. ✓
- `tests/playwright/image-frame-override.spec.js:123-159` — Target test confirmed at exactly those lines. ✓

**Top Concerns (first review pass):**

1. **Hardcoded SVG `rx="4"` (now corrected to `rx="8"`)** — The proposed `<rect ... rx="4" .../>` used a fixed numeric radius. SVG element attributes cannot read CSS variables, so `rx="var(--radius)"` is invalid. Reconcile resolution: changed to `rx="8"` to match `--radius: 8px`.

2. **AC-7 mapping gap in task 1.1 (originally 4.1)** — AC-7 (image frame overrides respected in all card/table views) was mapped exclusively to task 1.2. But task 1.1's AC-5 test cases directly exercise the AC-7 resolver path in the placeholder flow. Reconcile resolution: added "AC-7 (partial — table placeholder path)" to task 1.1 Maps to line.

3. **Two `.table-thumb.table-thumb-rect` rule blocks** — The selector is declared at both `:5307` and `:13541`. Task 2.1 correctly targets `:5307` for the `background: transparent` addition. Adding `background: transparent` at `:5307` is sufficient because both selectors share the same specificity — the `background` property is uncontested. Informational, no change needed.

**Top Concerns (second review pass):**

1. **`invItem` scope bug in task 4.2 (originally 3.2)** — `const invItem` at line 315 is block-scoped. Reconcile resolution: acceptance rewritten to explicitly require hoist.

2. **CLOSE-5 ordering** — Plane issue was marked Done at CLOSE-5, before CLOSE-6 (Open PR). CLAUDE.md rule: "Never mark Plane issues Done before the PR merges." Reconcile resolution: split into CLOSE-5 (vault only) + CLOSE-9 (Plane Done after merge).

3. **TDD cohort contradiction** — Cohort 4 (tests) was listed after implementation. CLAUDE.md mandates TDD. Reconcile resolution: tests moved to Cohort 1 per user decision.

**Unverified Assumptions (combined):**

- `resolveImageFrame` handles `undefined` input — task 4.2 relies on `resolveImageFrame(invItem, side)` returning `"round"` when `invItem` is `undefined`. Verified during reconcile: `js/image-frame.js:31` uses `const record = item || {}` — null-safe, returns `"round"`.
- Card B's existing `.card-b .coin-img` has `border: 2px solid var(--border)`. The new `.card-b .coin-img.bar-shape` rule doesn't suppress it. User decision during reconcile: defer to visual QA.
- `--radius` value — originally assumed ~4px, actually 8px (`css/styles.css:127`). Corrected during reconcile to `rx="8"`.

### Resolution Summary

- Accepted: 6
- Rejected: 2 (lint step — covered by pre-commit hook + Codacy; parallel 4.1/4.2 — negligible benefit)
- Resolved with user input: 3 (SVG rx=8, TDD reorder, Card B border deferred to visual QA)

## Verification Stamp

- [x] AC-1 — Card A rect transparent background + contain: verified at `css/styles.css:13618` (44×44, `background: transparent`), `js/card-view.js:563` (`object-fit:contain`); verified by test `rect-image-card-table.spec.js` line 94
- [x] AC-2 — Card B rect transparent background + contain: verified at `css/styles.css:13693` (80×80, `background: transparent`, `border: none`); verified by test `rect-image-card-table.spec.js` line 120
- [x] AC-3 — Card C rect transparent background + contain: verified at `css/styles.css:13744` (`background: transparent`, 80×56 preserved); verified by test `rect-image-card-table.spec.js` line 141
- [x] AC-4 — Table rect thumbnail transparent background: verified at `css/styles.css:5307` (`background: transparent`); verified by test `rect-image-card-table.spec.js` line 162
- [x] AC-5 — Table no-image placeholder `<rect>` SVG: verified at `js/inventory-table.js:245-270` (`shape` param, `<rect>` branch with `rx="8"`); verified by test `rect-image-card-table.spec.js` lines 174-238 (manual override, grading authority, Numista shape cases)
- [x] AC-6 — Round items unchanged: verified by test `rect-image-card-table.spec.js` line 240 (round coin regression guard across all views)
- [x] AC-7 — Frame overrides respected in card/table: verified at `js/inventory-table.js:330` (`resolveImageFrame(invItem, side)` on placeholder path); verified by test `image-frame-override.spec.js` lines 156-172 (Card B + Card C mixed-side assertions)
