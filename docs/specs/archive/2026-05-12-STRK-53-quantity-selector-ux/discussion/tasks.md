---
sketch: "STRK-53-quantity-selector-ux"
phase: tasks
created: 2026-05-12
approved:
---

# STRK-53 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive STRK-53`). Invoke skills verbatim — paraphrasing loses project-specific guarantees. If a closing task is genuinely N/A, write `N/A — <reason>` rather than dropping the task.

## Sprint Cohort 0 — Setup (sequential)

_The `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [ ] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-53-quantity-selector-ux`. Working directory is that worktree, not the main checkout. If the worktree is missing, the apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

> CODEX: This conflicts with the StakTrakr repo gate for runtime code. The repo-level AGENTS.md requires claiming `devops/version.lock` first and working in `.worktrees/patch-<VERSION>` on `patch/<VERSION>`, not a generic `sketch/STRK-53-quantity-selector-ux` branch. Resolve this before `/sketch apply` so implementation does not start in the wrong worktree.

> OPUS: Project CLAUDE.md is explicit: "Worktree naming: `.worktrees/<issue>-<slug>/` (via `/start-patch`) or `.worktrees/patch-<version>/` (via `/release`). Pick what the entry skill creates and keep it for the branch lifetime." A `sketch/...` branch name is neither pattern and will not match `check-release-sync`, `stamp-sw-cache`, or any tooling that keys off branch prefix. Either teach `/sketch` to use `.worktrees/STRK-53-quantity-selector/` on a `feature/STRK-53-*` branch, or hand off to `/start-patch` for Cohort 0.

---

## Sprint Cohort A — HTML Structure & Test Helper (parallel-safe)

_A.1 and A.2 touch independent files (`index.html` vs. `partial-stack-disposition.spec.js`). They share no symbols and can be dispatched to separate models/sessions concurrently._

- [ ] **A.1 [P]** — Add chip container div to dispose modal HTML
  - **File(s):** `index.html`
  - **What:** Inside `#removeItemQtyGroup` (the `.form-group` wrapper that contains `#removeItemQty`), add an empty `<div id="removeItemQtyChips" role="group" aria-label="Quantity" style="display:none"></div>` immediately before the `<input id="removeItemQty">` element. Leave the `<input>` intact — JS will show/hide it and the chip container independently.
  - **Acceptance:** `grep -n "removeItemQtyChips" index.html` returns the new element inside `#removeItemQtyGroup`. The existing `<input id="removeItemQty">` and `#removeItemDisposePreview` elements are unchanged.
  - **Leverage:** Existing `.chip-sort-toggle` HTML at `index.html` ~8336–8344 (Lot/Each toggle in same modal) as structural reference — chips get the class applied at runtime by JS, not in static HTML.
  - **Maps to:** AC-1, AC-3, AC-4

- [ ] **A.2 [P]** — Update `setDisposeQty` test helper for chip vs. stepper mode
  - **File(s):** `tests/playwright/inventory/partial-stack-disposition.spec.js`
  - **What:** At line ~150, `setDisposeQty(page, qty)` currently calls `page.fill("#removeItemQty", String(qty))`. Replace with mode-detection logic:
    1. `const chipMode = await page.isVisible("#removeItemQtyChips");`
    2. If chip mode: `await page.evaluate(({qty}) => { const el = document.getElementById("removeItemQty"); el.value = qty; el.dispatchEvent(new Event("input")); }, {qty: String(qty)});` — writes directly to the hidden input and fires the preview listener, bypassing Playwright's visibility gate.
    3. If stepper mode: keep the existing `page.fill("#removeItemQty", String(qty))` call unchanged.
  - **No changes to any test assertion** (`expect`, `toBe`, `toHaveText`, etc.) — only the helper body changes.
  - **Acceptance:** `setDisposeQty` contains the `isVisible("#removeItemQtyChips")` branch. `grep -n "expect\|toBe\|toHaveText\|toBeVisible\|toContainText" tests/playwright/inventory/partial-stack-disposition.spec.js` shows no changes outside the helper function. All 16 existing test cases remain structurally identical.
  - **Leverage:** approach.md D-3; `page.evaluate` for hidden-input write; `page.fill` for stepper path (unchanged).
  - **Maps to:** AC-2

> CODEX: A.2 is not independently verifiable until A.1 and the JS mode logic exist, so it is parallel-edit-safe but not parallel-acceptance-safe. More importantly, keeping all invalid-quantity assertions unchanged is infeasible with the proposed stepper clamp: tests that set `0` or `999` will no longer represent blocked invalid submission.

> OPUS: A.2's `await page.isVisible("#removeItemQtyChips")` runs before any modal-open call in some tests — the chip container may not exist or be display:none at the time the helper is called, depending on test setup. Detection should happen inside the same evaluate that does the write, or after an explicit `await page.waitForSelector("#removeItemModal", {state:"visible"})`. As written, the helper can race the modal-open and pick the wrong mode silently.

> CODEX: The helper writes to the hidden carrier instead of using the chip UI. Keep that for split-business tests if desired, but add separate chip-click coverage; otherwise the tests can pass while the visible control is not keyboard/click accessible.

---

## Sprint Cohort B — JS Mode Logic (sequential, all `js/inventory.js`)

_B.1 → B.2 → B.3 are sequential: the constant must exist before the chip-builder reads it; the chip-builder's if-branch must be written before the else-branch clamp handler. All three modify `openRemoveItemModal` in `js/inventory.js`._

- [ ] **B.1** — Extract `DISPOSE_CHIP_QTY_MAX` constant
  - **File(s):** `js/inventory.js`
  - **What:** Near the top of `openRemoveItemModal` (line ~628), declare `const DISPOSE_CHIP_QTY_MAX = 8;`. Define at function scope, directly inside the function, so it stays co-located with the code that uses it.
  - **Acceptance:** `grep -n "DISPOSE_CHIP_QTY_MAX" js/inventory.js` returns exactly one line, inside `openRemoveItemModal`. Value is `8`.
  - **Depends on:** A.1 (chip container must exist in HTML before wiring)
  - **Maps to:** AC-1, AC-5

- [ ] **B.2** — Implement chip-builder branch in `openRemoveItemModal`
  - **File(s):** `js/inventory.js`
  - **What:** After the existing `stackQty === 1` hide-gate (line ~688), add a branching block:
    - `if (stackQty <= DISPOSE_CHIP_QTY_MAX)` → chip mode:
      1. Get refs: `const chipsEl = safeGetElement("removeItemQtyChips"); const qtyInput = safeGetElement("removeItemQty");`
      2. Apply toggle class and clear: `chipsEl.className = "chip-sort-toggle"; chipsEl.innerHTML = ""; chipsEl.style.display = "";`
      3. Hide the raw input: `qtyInput.style.display = "none";`
      4. For `n` from `1` to `stackQty`: create `<button type="button" class="chip-sort-btn" aria-pressed="false" data-qty="${n}">${n}</button>`, append to `chipsEl`.
      5. Wire click on each button: set `aria-pressed="true"` on clicked, `"false"` on siblings; then `qtyInput.value = n; qtyInput.dispatchEvent(new Event("input"));`
      6. Auto-select the last chip (full-stack default, matching existing `qtyInput.value = stackQty` behavior).
    - `else` → stepper mode (N > CHIP_MAX): `chipsEl.style.display = "none"; qtyInput.style.display = "";` (clamp handler wired in B.3).
  - **Acceptance:** Opening the dispose modal for a stack-4 item renders 4 chip buttons numbered 1–4; chip 4 has `aria-pressed="true"`. Opening for a stack-20 item renders the bare number input. Stack-1 items still hide `#removeItemQtyGroup` entirely (unchanged gate from line ~688).
  - **Depends on:** B.1
  - **Maps to:** AC-1, AC-3, AC-4, AC-5

> CODEX: Step 5 updates `aria-pressed` but does not mention toggling the `.active` class that actually drives the existing visual selected state in `css/styles.css`. Without that, the selected chip can be announced as active but not look active.

> CODEX: AC-4 needs more than click wiring if arrow-key operation is required. Native buttons support Tab plus Enter/Space, but not ArrowLeft/ArrowRight movement within the group; either add key handling here or explicitly accept native button navigation as the equivalent.

> OPUS: B.2 step 5 also doesn't address re-entry: each modal-open rebuilds chips via `innerHTML = ""` then re-creates buttons (step 4). That's fine for content, but click listeners attached inline via `.addEventListener` (step 5) on freshly-created elements don't accumulate (new nodes), so no cleanup needed — confirm step 5 uses per-button `addEventListener` and not a delegated listener on `chipsEl` that *would* accumulate across opens. Worth one explicit sentence so the implementer doesn't default to delegation.

- [ ] **B.3** — Add hard-clamp `oninput` handler for stepper mode
  - **File(s):** `js/inventory.js`
  - **What:** In the `else` (stepper) branch from B.2, wire a clamp listener on `#removeItemQty`:
    ```js
    const _disposeClampHandler = () => {
      const v = parseInt(qtyInput.value, 10);
      if (!isNaN(v)) qtyInput.value = Math.min(Math.max(v, 1), stackQty);
    };
    qtyInput.addEventListener("input", _disposeClampHandler);
    ```
    Mirror the removal pattern used by `_removeItemQtyPreviewHandler`: store in a module-level variable and call `qtyInput.removeEventListener("input", _disposeClampHandler)` at the top of `openRemoveItemModal` to prevent listener accumulation across modal opens.
  - **Acceptance:** For a stack-50 item: typing `99` in the qty field snaps to `50` on `oninput`; typing `0` snaps to `1`; typing `47` stays `47`. A second modal open does not double-attach the handler (confirm via `getEventListeners` in DevTools or by inspecting the preview-update behavior — one preview update per keystroke, not two).
  - **Depends on:** B.2
  - **Maps to:** AC-1, AC-5

> CODEX: Be careful with listener ordering. The existing `_removeItemQtyPreviewHandler` also runs on `input`; if the preview handler sees `99` before the clamp changes it to `50`, the preview can stay hidden/stale unless the clamp runs first or dispatches a follow-up update after mutation.

> CODEX: The sample declares `_disposeClampHandler` as a local `const`, but the cleanup requirement needs a module-level variable like `_removeItemQtyPreviewHandler`. Also remove the prior clamp listener when switching from stepper mode back to chip or qty-1 mode, not only when reopening another large stack.

> OPUS: B.3 doesn't address `paste`. `parseInt("9.5", 10) === 9` — a pasted decimal silently floors, which AC-1 lists as a banned affordance ("no fractional value"). And `parseInt("abc", 10)` is `NaN`, so the clamp short-circuits via `!isNaN(v)` and leaves `"abc"` in the input verbatim. Either strip non-digits in the handler (`qtyInput.value = qtyInput.value.replace(/\D/g, "")` before parsing) or accept that the toast safety net is the actual guard for those cases — and then resurface that the toast is *not* dead code after all (cf. OPUS note in requirements.md).

---

## Standard Closing Tasks

- [ ] **CLOSE-1. Run full test suite** — zero regressions
  - **File(s):** _no file changes — verification only_
  - Run `npm test` (full Playwright suite, local Chromium). All 16 STRK-44 tests in `partial-stack-disposition.spec.js` pass. Full suite passes. If anything fails: fix the implementation, not the test.

> CODEX: This repeats the infeasible "all 16 unchanged" assumption. The current test file has direct invalid-entry cases and more qty-specific checks than this wording captures; if the UX clamps invalid values, the validation-blocking tests need a deliberate rewrite or replacement, not an implementation contortion.

- [ ] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File(s):** _no file changes — scan only_
  - Run `codacy-cli` skill against `index.html`, `js/inventory.js`, and `tests/playwright/inventory/partial-stack-disposition.spec.js`. Triage: Critical/High must fix; Medium fix-or-document; Low/Info advisory. Note: `no-undef` on browser globals (`safeGetElement`, etc.) in `inventory.js` is a known project false-positive (CLAUDE.md pre-PR noise section) — classify as false-positive with one-line note.

> OPUS: Missing tasks for two things approach.md commits to but Cohort B doesn't deliver: (1) CSS work to "remove browser native spinners" on the stepper input — there is no CSS file in the file map and no task targets `css/styles.css`; (2) a mobile/responsive smoke check for chip wrapping at the project's narrow breakpoints, since AC-3/AC-4 and CLAUDE.md "mobile matters" both apply. Without these, the implementer ships chips that look fine at desktop and unusable at 360px wide, with native spinner arrows next to the field for stack-9+ items.

- [ ] **CLOSE-3. Generate verification stamp**
  - **File(s):** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For each of AC-1 through AC-5, write exactly one line:
    - `- [x] AC-N — verified at <file>:<line>` (cite the test or impl line that proves it), OR
    - `- [x] AC-N — verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>` (if not yet verified).
  - AC-4 (keyboard/screen-reader) requires a manual smoke observation in addition to any automated coverage — document the specific interaction tested.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [ ] **CLOSE-4. Version bump**
  - **File(s):** `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`, `sw.js` (auto-stamped by hook)
  - **MUST invoke `/release patch`** as a skill. Per CLAUDE.md, `/release` is the only valid version-bump path — hand-editing files is not equivalent and will miss `about.js` What's New, `manifest.json`, and the pre-commit hook interaction.

> CODEX: In StakTrakr, the version claim/worktree is a pre-implementation gate, not only a closing task. This block should not be the first time `/release patch` or `devops/version.lock` enters the flow.

- [ ] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if no foundation docs appear affected, the skill performs the audit and produces a clean zero-change report if nothing needs updating.
  - After vault audit: mark STRK-53 Done in Plane via `mcp__plane__update_issue`. Fetch the Done state UUID fresh via `mcp__plane__list_states` — do not reuse UUIDs from prior session context.

> CODEX: Closing the Plane issue before the PR is opened/merged is premature for this repo's current workflow. If kept, this should move after merge/live verification or be changed to "leave issue open; close during archive" so status does not get ahead of shipped state.

- [ ] **CLOSE-6. Open PR**
  - Branch: `sketch/STRK-53-quantity-selector-ux` (from `/sketch apply` worktree).
  - Title: `feat(STRK-53): mode-aware quantity selector for partial-stack disposition`
  - Body must include: link to [STRK-53](https://plane.lbruton.cc/lbruton/browse/STRK-53/), link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-53-quantity-selector-ux/`), test plan checklist (chip mode smoke for N ≤ 8, stepper mode smoke for N > 8, qty-1 hide, keyboard nav, full STRK-44 Playwright suite).
  - Target branch: `dev`.

> CODEX: Same branch mismatch as Cohort 0: StakTrakr code PRs should come from `patch/<VERSION>` with the release-version title/commit convention. Also include the version bump evidence in the PR body, because release artifacts are mandatory for runtime code changes.

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File(s):** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill. Scan both inline diff threads AND review-body findings (Codacy, Copilot, CodeRabbit post summaries in review body, not only inline). Critical/High must be fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory. After running, check for auto-scanner re-posts on new commits and address before merge.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-53`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-53-quantity-selector-ux/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort A tasks are `[P]`-safe. Suggested split: send A.1 to Codex (HTML structure), A.2 to Gemini (test helper update). Each reads the sketch folder, executes its task, commits to the worktree branch. Reconverge before Cohort B (all B tasks are sequential in `inventory.js`).

> OPUS: Global CLAUDE.md is explicit: "Before dispatching parallel subagents that write files → pass each an explicit worktree target path. Inherited cwd produces split diffs." This dispatch hint doesn't say which worktree path to pass — and given Cohort 0's branch-name conflict (above), there isn't an agreed path yet. Resolve Cohort 0 first, then encode the absolute worktree path here as part of the dispatch instruction. Otherwise the two agents will commit into different worktrees / branches and B will start from a partially-merged state.
