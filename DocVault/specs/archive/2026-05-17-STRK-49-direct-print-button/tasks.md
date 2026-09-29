---
sketch: STRK-49-direct-print-button
phase: tasks
created: 2026-05-14
approved: 2026-05-17
---

# STRK-49 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). Invoke skills by name verbatim — paraphrasing is not equivalent because the skill enforces project-specific rules the prose can't carry.

> **Browser support note:** AC-1's print-dialog promise is "best-effort auto-print." Chrome/Edge/Safari trigger the dialog via `/OpenAction Print`; Firefox opens the PDF without auto-triggering print (user must Ctrl+P). This is an accepted v1 limitation — do not treat Firefox manual-print as a test failure.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Confirm worktree exists and branch is active
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree at `.worktrees/patch-<VERSION>/` on a `patch/<VERSION>` branch created from `origin/dev` via `/start-patch`. Working directory is that worktree. `devops/version.lock` contains an unexpired STRK-49 claim for the same `<VERSION>`. If either check fails, run `/start-patch` to create the worktree and claim the version lock — this is setup work, not a stop-the-world gate.
  - **Leverage:** `/start-patch` skill; StakTrakr CLAUDE.md worktree naming convention.

## Sprint Cohort A — HTML Layout Changes (sequential within Export card, A.3 parallel-safe)

_A.1 and A.2 both edit the Export card region of `index.html` — A.2 depends on A.1 (it fills the row vacated by ZIP removal). A.3 touches Data Reset (~200 lines away) and is safe to run in parallel with A.1 or A.2._

- [x] **A.1** — Relocate Restore ZIP controls from Export card to Import card
  - **File(s):** `index.html`
  - **Acceptance:** `#importZipBtn` and `#importZipFile` appear inside the Import card (below Import CSV/JSON buttons), as a full-width button (`grid-column: span 2`). Neither ID appears in the Export card. The hidden `#importZipFile` input is co-located with `#importZipBtn`. No JS changes needed — wiring is purely ID-based (`js/events.js:3694-3706`).
  - **Leverage:** Discovery line-number references: `index.html:4897-4909` (current location), `index.html:4730-4795` (Import card).
  - **Maps to:** AC-5

- [x] **A.2** — Add Print button with `aria-describedby` span in Export card
  - **File(s):** `index.html`
  - **Acceptance:** A new `<button class="btn success" id="printBtn" aria-describedby="printDesc" title="Direct browser print of your full inventory" style="font-size: 0.82rem; padding: 0.4rem 0.6rem; min-height: 0; width: 100%; grid-column: span 2">Print</button>` followed by `<span id="printDesc" class="sr-only">Direct browser print of your full inventory</span>` appears in the Export card. Button uses `grid-column: span 2` to fill the full-width row vacated by ZIP restore's removal. Pattern matches the four existing export buttons exactly (inline sizing, `aria-describedby`, sibling `sr-only` span).
  - **Depends on:** A.1
  - **Leverage:** Discovery: existing button pattern at `index.html:4796-4914`; reconciled AC-2 sizing spec.
  - **Maps to:** AC-1, AC-2

- [x] **A.3 [P]** — Add inline sizing styles to Data Reset buttons
  - **File(s):** `index.html`
  - **Acceptance:** `#removeInventoryDataBtn` and `#boatingAccidentBtn` both have `style="font-size: 0.82rem; padding: 0.4rem 0.6rem; min-height: 0"` (or equivalent inline style addition — retain existing `class` and colors). Visual sizing matches the 0.6rem-padded card buttons. `bulkEditBtn` is NOT modified (out of scope).
  - **Leverage:** Discovery: `index.html:5025-5038` (current location); existing test at `tests/playwright/settings-data-reset.spec.js:82-103`.
  - **Maps to:** AC-6

## Sprint Cohort B — JavaScript Implementation (sequential)

_These tasks depend on each other: state slot → renderer refactor → print function → init → event wiring._

- [x] **B.1** — Add `printBtn` slot to `js/state.js`
  - **File(s):** `js/state.js`
  - **Acceptance:** `printBtn: null` appears in the Export elements block (after `exportPdfBtn: null`, before `cloudSyncBtn: null`). No other changes to the file.
  - **Leverage:** Existing pattern at `js/state.js:105-108`.
  - **Maps to:** AC-1 (infrastructure)

- [x] **B.2** — Extract `_buildInventoryPdf()` from `exportPdf()` and add `printInventory()`
  - **File(s):** `js/inventory.js`
  - **Acceptance:**
    1. A new `_buildInventoryPdf()` function exists that contains the shared rendering logic (jsPDF creation, 21-column row map, autoTable config, portfolio summary text). It returns the `doc` object.
    2. `exportPdf()` now calls `_buildInventoryPdf()` then `doc.save(filename)` — behavior is identical to before the refactor.
    3. A new `printInventory()` function exists that calls `_buildInventoryPdf()`, then `doc.autoPrint()`, then `const popup = window.open(doc.output("bloburl"), "_blank"); if (!popup) { appAlert("Your browser blocked the print window — allow popups for this page."); }`.
    4. The `window.open` call is synchronous in the click handler's stack (no `await` between button click and `window.open`). Brief inline comment on the `window.open` line noting the synchronous constraint for popup-blocker compliance.
    5. Manual verification: click Export PDF — produces the same file as before the refactor.
  - **Depends on:** B.1
  - **Leverage:** Existing `exportPdf()` at `js/inventory.js:2036-2183`; popup null-check pattern from `js/viewModal.js:1570-1579`.
  - **Maps to:** AC-1, AC-3, AC-4

- [x] **B.3** — Add `elements.printBtn` initialization in `js/init.js`
  - **File(s):** `js/init.js`
  - **Acceptance:** `elements.printBtn = safeGetElement("printBtn");` appears in the import/export elements initialization block (after `elements.exportPdfBtn` at line ~292). Runs at init time, not top-level.
  - **Depends on:** B.1
  - **Leverage:** Existing pattern at `js/init.js:290-292`.
  - **Maps to:** AC-1 (infrastructure)

- [x] **B.4** — Wire Print button event listener in `js/events.js`
  - **File(s):** `js/events.js`
  - **Acceptance:** `optionalListener(elements.printBtn, "click", printInventory, "Print inventory");` appears alongside the existing export listeners (after line ~3684). No top-level `safeGetElement` call.
  - **Depends on:** B.2, B.3
  - **Leverage:** Existing pattern at `js/events.js:3682-3684`.
  - **Maps to:** AC-1

## Sprint Cohort C — Tests (sequential)

- [x] **C.1** — Write Playwright tests for Print button, ZIP relocation, and Data Reset sizing
  - **File(s):** `tests/playwright/settings-print-button.spec.js` (new file)
  - **Acceptance:**
    1. **Print button presence:** Test asserts `#printBtn` exists inside the Export card, has class `btn success`, has `aria-describedby="printDesc"`, and the sibling `#printDesc` span contains "Direct browser print of your full inventory".
    2. **Print action fires `window.open` with blob URL:** Test stubs `window.open` via `page.evaluate`, clicks `#printBtn`, asserts the stub was called with a URL starting with `blob:`. (Does NOT assert print dialog — that's manual.)
    3. **Restore ZIP in Import card:** Test asserts `#importZipBtn` is inside the Import card and NOT inside the Export card.
    4. **Data Reset sizing:** Test asserts `#removeInventoryDataBtn` and `#boatingAccidentBtn` exist within `#settingsPanel_system` and have the expected inline sizing styles (`font-size: 0.82rem`, `padding` containing `0.6rem`).
    5. **PDF export regression:** Test clicks `#exportPdfBtn` with a `doc.save` spy/stub in place. Asserts the spy is called exactly once with a filename matching `metal_inventory_YYYYMMDD.pdf` pattern — verifies the refactor didn't break the download path.
    6. All tests pass against the implementation from Cohorts A+B.
  - **Depends on:** A.1, A.2, A.3, B.4
  - **Leverage:** Existing test patterns in `tests/playwright/settings-data-reset.spec.js`; D-7 decision (stub `window.open`, not `window.print`).
  - **Maps to:** AC-1, AC-2, AC-5, AC-6

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test`. All existing tests pass; all new tests from Cohort C pass. If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - **MUST invoke `codacy-cli`** skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **Post-scan:** Run `git diff .codacy/codacy.yaml` and revert any tool additions (PMD, Python, Java stanzas, ESLint version bump) before commit — these are CLI side effects, not real config changes (per CLAUDE.md gotcha).

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion (AC-1 through AC-6), write exactly one line:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` or `- [x] AC-N — verified by <test name>`
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified)
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files
  - **MUST invoke `/release patch`** — the skill enforces version-lock claim, file enumeration, and pre-commit interactions.
  - **Before invoking:** Run `/update-spot-bundle` (required before every version-bump PR per CLAUDE.md).

- [x] **CLOSE-5. Vault update**
  - **MUST invoke `/vault-update`** — the skill audits foundation docs for staleness.
  - Issue closure deferred to CLOSE-8 (`/sketch archive STRK-49` marks Done after PR merge).

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/start-patch`. Title: `v<VERSION> — STRK-49: Direct Print button for inventory`.
  - Body must include: link to STRK-49 Plane issue, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-49-direct-print-button/`), test plan checklist, browser-support note (Chrome/Edge/Safari auto-print; Firefox manual).
  - Stage and commit all changes (including `tasks.md` marks and spot-bundle) before `gh pr create`.

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** — the skill triages findings, fixes-or-classifies, and replies consistently.
  - Coverage: scan both inline diff threads AND review-body/summary findings. After running, check for new auto-scanner threads and address before merge.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-49`** — moves folder to `archive/YYYY-MM-DD-STRK-49-direct-print-button/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort A is mostly sequential (A.1→A.2 share the Export card region); only A.3 is parallel-safe. Cohort B is strictly sequential due to function dependencies. Suggested routing: Cohort A+B → single session (Claude or Codex — refactoring precision needed for B.2); Cohort C → Claude (test authoring with stub patterns). For `/sketch orchestrate`, the single-session routing means Cohorts A+B print as serial blocks.

## Review Archive — tasks (2026-05-17)

_Reconciled by /sketch reconcile on 2026-05-17. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- No active `CODEX` review blocks were present in `tasks.md` before this pass.
- The current Import/Export HTML matches the task's source map: Import controls live at `index.html:4730-4795`, Export buttons and Restore ZIP currently live at `index.html:4796-4914`, with `#importZipBtn` / `#importZipFile` at `index.html:4897-4909`.
- Data Reset buttons currently have no inline sizing styles at `index.html:5031-5038`; existing coverage only asserts their settings-tab location in `tests/playwright/settings-data-reset.spec.js:82-103`.
- Export DOM refs follow the `state.js` -> `init.js` -> `events.js` pattern: export slots at `js/state.js:105-109`, init assignments at `js/init.js:290-293`, export listeners at `js/events.js:3681-3684`, and `optionalListener` is the local helper at `js/events.js:52-54`.
- Existing `exportPdf()` is a monolithic jsPDF renderer/save path at `js/inventory.js:2036-2183`, including 21 table columns at `js/inventory.js:2075-2125`; `window.exportPdf` is exposed at `js/inventory.js:2197-2200`.
- The popup null-check pattern cited by the plan exists in `js/viewModal.js:1570-1581`.
- jsPDF and autotable are loaded from local vendor assets in `index.html:60-64`, and the vendored jsPDF build exposes `autoPrint()` with a default `/OpenAction Print` implementation in `vendor/jspdf.umd.min.js:104-109`.
- The approach File Map conflicts with the task's new test file: approach `### New` says `_None_` at `approach.md:37-40`, while the modified map only names `tests/playwright/` generically at `approach.md:42-48`.
- StakTrakr release/worktree gates require a Plane issue, patch worktree, and version-lock claim before code changes (`AGENTS.md:60-64`), versioned PR title/branch conventions (`AGENTS.md:97-99`), and a draft PR left for human review (`AGENTS.md:126-131`).
- `/sketch archive` is the workflow step that moves the sketch after PR merge and marks the issue Done if it is still open (`/Users/lbruton/.agents/skills/sketch/SKILL.md:614-618`).

**Top concerns**

1. Cohort 0 implies the version lock through `/start-patch`, but its acceptance only checks the worktree/branch. Add an explicit unexpired `devops/version.lock` STRK-49 claim check for the same `<VERSION>`.
2. The PDF export regression acceptance allows "no error is thrown," which can pass without proving `doc.save()` still runs after the renderer extraction. Make the test spy on `doc.save` and assert the expected generated filename shape.
3. Closing tasks currently mark STRK-49 Done before PR creation and use a non-versioned PR title. Move issue closure to post-merge/archive and use the repo's `v<VERSION> — STRK-49: ...` PR title convention.

**Unverified assumptions**

- Assumes `/start-patch` is available in the implementing harness and creates both the patch worktree and the version-lock claim.
- Assumes the specific new test file name is preferred over extending an existing settings/export spec.
- Assumes a Playwright `window.open` stub can observe the blob URL reliably after the jsPDF/autotable path runs with test inventory data.
- Assumes a manual Export PDF comparison is available in addition to the mechanical `doc.save` assertion.
- Assumes the product owner has accepted Firefox's manual-print PDF fallback for STRK-49 v1.
- Assumes `/update-spot-bundle` is available at apply/closeout time and its outputs are staged with the release commit when it changes tracked data.

### Resolution Summary

- Accepted: 5
- Rejected: 0
- Resolved with your input: 0

## Verification Stamp

- [x] AC-1 — verified by `tests/playwright/settings-print-button.spec.js` test 2 (window.open called with blob:); `doc.autoPrint()` at `js/inventory.js:2196`
- [x] AC-2 — verified by `tests/playwright/settings-print-button.spec.js` test 1 (btn success class, aria-describedby, sizing); `index.html:4909-4928`
- [x] AC-3 — satisfied by mechanism: PDF opens in a new browser tab (PDF viewer only, no app chrome); `js/inventory.js:2192-2198`
- [x] AC-4 — verified at `js/inventory.js:2044` (`new jsPDF("landscape")`); autoTable default repeating headers at `js/inventory.js:2101-2132`
- [x] AC-5 — verified by `tests/playwright/settings-print-button.spec.js` test 3 (#importZipBtn in import-block, absent from export-block)
- [x] AC-6 — verified by `tests/playwright/settings-print-button.spec.js` test 4 (font-size 0.82rem, padding 0.6rem on both buttons)
