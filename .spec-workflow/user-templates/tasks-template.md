# Tasks Document: {{featureName}}

## References

- **Issue:** [STAK-XXX](DocVault/Projects/StakTrakr/Issues/STAK-XXX.md)
- **GitHub PR:** [#NNN](https://github.com/lbruton/StakTrakr/pull/NNN)
- **Spec Path:** `.spec-workflow/specs/{{spec-name}}/`

<!-- VERSION CHECKOUT GATE — MANDATORY
Before implementing ANY task below, you MUST:
1. Run /release patch (or /start-patch) to claim a version and create a worktree
2. Record the assigned version (e.g., 3.34.01) in the first implementation log
3. ALL file edits happen inside the worktree — never in the main repo working directory
4. Verify: `git branch --show-current` returns patch/VERSION, not dev or main
5. If multiple tasks are parallelized across agents, each agent gets its own /release patch
Skipping this gate is a workflow violation. See CLAUDE.md Version Checkout Gate section.

IMPLEMENTATION LOGGING GATE — HARD GATE:
Before marking ANY task [x], you MUST call the log-implementation MCP tool with full
artifacts (functions added/modified, files changed, endpoints created). Do NOT mark [x]
until the log-implementation tool call succeeds. This is non-negotiable.

SPEC COMPLETION GATE — BLOCKING (Phase 5):
After ALL tasks are [x] and implementation logs are recorded:
1. Run /vault-update to update DocVault pages affected by this spec's changed files
2. Close all linked DocVault issues (move to Done, move file to Closed/)
3. Run /verification-before-completion for a final smoke check
4. Verify /bb-test passes or file follow-up DocVault issues for any new failures
5. The spec is NOT complete until all four are verified.
-->

---

## StakTrakr Critical Patterns (applies to all tasks)

- **DOM access**: `safeGetElement('id')` — never `document.getElementById()`
- **Storage reads/writes**: `saveData(key, val)` / `loadData(key)` from `js/utils.js`
- **New storage keys**: must be added to `ALLOWED_STORAGE_KEYS` in `js/constants.js`
- **innerHTML**: always wrap user content in `sanitizeHtml()`
- **New JS files**: add to BOTH `index.html` (correct load-order position) AND `sw.js` CORE_ASSETS
- **Duplicate check**: before editing `events.js` or `api.js`, grep for the function name in both files
- **Variable declarations**: always use `const`/`let` — `var` is banned per AGENTS.md coding style

---

## Phase 1 — [Phase Name]

- [ ] 1. [Task title]
  - File: `js/example.js`
  - [What to implement — be specific about function names, line numbers, and code patterns]
  - [Second bullet if multi-part]
  - Purpose: [Why this task exists — what problem it solves]
  - _Leverage: [Existing functions/constants/patterns to reuse, with file:line references]_
  - _Requirements: REQ-X_
  - _Prompt: Implement the task for spec {{spec-name}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: [Role] | Task: [Detailed implementation instructions referencing specific file paths, line numbers, existing functions, and exact variable names. Include the complete behavior specification.] | Restrictions: [What NOT to do — other files to leave untouched, patterns to avoid, anti-patterns for this codebase] | Success: [Concrete, verifiable acceptance criteria — what works, what doesn't break] PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

- [ ] 2. [Task title]
  - File: `js/example.js`
  - [Implementation details]
  - Purpose: [Why]
  - _Leverage: [Existing code to reuse]_
  - _Requirements: REQ-Y_
  - _Prompt: Implement the task for spec {{spec-name}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: [Role] | Task: [Instructions] | Restrictions: [Constraints] | Success: [Criteria] PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

---

## Phase 2 — [Phase Name] (optional — remove if single-phase)

- [ ] 3. [Task title]
  - File: `js/example.js`
  - [Implementation details]
  - Purpose: [Why]
  - _Leverage: [Existing code to reuse]_
  - _Requirements: REQ-Z_
  - _Prompt: Implement the task for spec {{spec-name}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: [Role] | Task: [Instructions] | Restrictions: [Constraints] | Success: [Criteria] PREREQUISITE: Before writing any code, verify you are working inside a patch worktree (`git branch --show-current` must return patch/VERSION). If not, STOP and run /release patch first. Mark task as [-] in tasks.md before starting. BLOCKING: After implementation, you MUST call the log-implementation tool with full artifacts before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

---

## Standard Closing Tasks

- [ ] N. Smoke test — verify no regressions
  - File: (no file changes — testing only)
  - Run `/bb-test` against the PR preview URL to verify all existing tests pass and no console errors were introduced by this spec. Cloud sync/OAuth flows require manual testing at beta.staktrakr.com.
  - Purpose: Catch regressions before PR merge; validate the new feature doesn't break existing behavior.
  - _Leverage: `/bb-test` skill; Browserbase/Stagehand E2E tests in `tests/runbook/*.md`; PR preview URL from Cloudflare Pages_
  - _Requirements: All_
  - _Prompt: Implement the task for spec {{spec-name}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: QA engineer | Task: Run the StakTrakr E2E test suite via `/bb-test` against the PR preview URL (check Cloudflare Pages deploy for the URL). (1) Invoke the `/bb-test` skill — it runs NL tests from `tests/runbook/*.md` via Browserbase/Stagehand. (2) Review results — all tests should pass. (3) Manually verify the new feature from this spec works end-to-end (list the specific user actions based on spec requirements). (4) Check browser console for any new errors or warnings. (5) If any failures are found, document them clearly and file a DocVault issue — do NOT attempt fixes here. Note: Cloud sync and OAuth flows cannot be tested via Browserbase (different origin breaks Dropbox OAuth) — flag these for manual testing at beta.staktrakr.com. | Restrictions: Do not modify any source files — this is a verification-only task. | Success: Tests complete with results reported. No new console errors. New feature manually verified working. PREREQUISITE: This is a test-only task — no worktree changes needed. Mark task as [-] in tasks.md before starting. BLOCKING: After verification, you MUST call the log-implementation tool with the test results (pass/fail counts) before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._

- [ ] N+1. Update DocVault pages affected by this spec
  - File: (DocVault pages only — no production code changes)
  - Run `/vault-update` to detect and update any DocVault pages whose YAML frontmatter `sourceFiles` reference files changed by this spec. Verify each updated page is accurate against the new implementation.
  - Purpose: Keep DocVault documentation current — stale pages are a recurring source of confusion for agents and developers.
  - _Leverage: `/vault-update` skill; DocVault at `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/`_
  - _Requirements: All_
  - _Prompt: Implement the task for spec {{spec-name}}, first run spec-workflow-guide to get the workflow guide then implement the task: Role: Technical writer | Task: Update DocVault pages affected by this spec. (1) Run the /vault-update skill — it detects which DocVault pages at `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/` have `sourceFiles` frontmatter entries matching the files changed in this spec, then updates those pages from the current source code. (2) Review each updated page for accuracy: do the descriptions match the actual implementation? Are function signatures, file paths, and behavior descriptions correct? (3) If any page needs manual correction, edit it directly. (4) Commit DocVault changes directly to main (DocVault commits go direct to main, no PR needed). (5) List all updated pages and a one-line summary of what changed in each. | Restrictions: Only touch files in DocVault (`/Volumes/DATA/GitHub/DocVault/`). Do not modify any JS, CSS, or HTML production files in the StakTrakr repo. | Success: All DocVault pages whose `sourceFiles` reference changed files have been updated and verified accurate. No stale descriptions of changed functions or constants remain. BLOCKING: After DocVault updates are complete, you MUST call the log-implementation tool listing all updated pages before marking [x]. Do NOT mark [x] until the log-implementation tool call succeeds._
