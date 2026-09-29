---
sketch: "STRK-57-quiet-playwright-logs"
phase: tasks
created: 2026-05-11
approved:
---

# STRK-57 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [ ] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-57-quiet-playwright-logs`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

## Sprint Cohort A — Implementation (sequential)

_Single-file, single-line change. No parallel dispatch possible._
> CODEX: Agreed that this cohort is inherently sequential. Because there is only one implementation task and one file in play, any dispatch hint below should either be removed or reframed as review-only parallelism after implementation, not concurrent edits to the same branch.
> KIMI: **Parallelization mistake:** The multi-model dispatch hint at the bottom of this file references "A.1 to Codex, A.2 to Kimi, A.3 to Gemini" and "Cohort A tasks marked `[P]`", but Cohort A contains only ONE task (A.1) with no `[P]` markers. There are no A.2 or A.3. This hint appears to be copy-pasted from a different sketch and will confuse any automated dispatch.
> GEMINI: The parallel dispatch hint is incorrect. Cohort A only has one task (A.1). There are no A.2 or A.3 tasks to distribute.

- [ ] **A.1** — Replace `webServer.command` in `playwright.config.js` with quiet Python one-liner
  - **File(s):** `playwright.config.js:16`
  - **Acceptance:** The `command:` value is a Python one-liner that starts `http.server` on port 3000 with `log_message` overridden to a no-op. Running `python3 -c "<the command>"` from the repo root starts a server that serves files but emits zero access log lines (no `GET /path 200` lines). The startup message `Serving HTTP on :: port 3000` still appears. Syntax is valid Python 3 (no `SyntaxError`).
  - **Leverage:** Python `http.server` stdlib module; `SimpleHTTPRequestHandler` subclass; `log_message` override pattern from [CPython docs](https://docs.python.org/3/library/http.server.html#http.server.BaseHTTPRequestHandler.log_message).
  - **Maps to:** AC-1, AC-2
> CODEX: This acceptance is the most infeasible part of the task list. It validates a reconstructed shell command, not the actual `playwright.config.js` string after JS escaping, and it hard-codes the IPv6-flavored startup banner. The executable proof needs to be a real Playwright invocation plus a looser startup-output check.
> KIMI: **Infeasible acceptance criterion:** "Running `python3 -c "<the command>"` from the repo root" tests the raw Python string, NOT the actual Playwright config value. JS string escaping (double quotes, backslashes) means the config string and the raw terminal command are different. The acceptance should require verifying via `npx playwright test` (or at least quoting the exact config string), not just raw `python3 -c`.
> GEMINI: As KIMI noted, testing the raw Python command is insufficient. The real test is `npx playwright test` (or `npx playwright show-config`) to ensure the escaping in `playwright.config.js` is correct.
> CLAUDE: **If the `stderr: "ignore"` approach is adopted, this entire task reduces to adding one property** to the `webServer` block in `playwright.config.js`: `stderr: "ignore"`. No Python one-liner, no escaping concerns, no acceptance criterion about `python3 -c`. The acceptance criterion would simply be: "the `webServer` config includes `stderr: \"ignore\"`, and `npx playwright test` output contains zero `[WebServer]` access log lines."

## Sprint Cohort B — Verification (sequential)

_Confirm the fix works and no regressions in the test suite._

- [ ] **B.1** — Run focused Playwright test and confirm zero `[WebServer]` noise
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Run `npx playwright test tests/playwright/01-page-load/page-load.spec.js --timeout=30000`. The output contains zero lines matching `[WebServer]` prefix (no access log lines). All 12 tests pass. The server startup line (`Serving HTTP on :: port 3000`) may appear but is acceptable.
  - **Depends on:** A.1
  - **Maps to:** AC-1, AC-2
> CODEX: I’d keep this as a fast smoke test only if the human wants a quick preflight before the expensive full suite. Otherwise B.2 subsumes it, and the duplicate startup-string assertion adds noise without adding much confidence.
> KIMI: Efficiency note: B.2 (full suite) effectively subsumes B.1 (focused run). If B.2 passes with zero noise, B.1 is redundant. Consider dropping B.1 or demoting it to an optional fast-check to save CI/developer time. Not a bug, but a parallelization/efficiency observation.
> GEMINI: Agreed. B.1 is redundant if B.2 passes. I would recommend merging them or keeping B.1 only as a quick smoke test.

- [ ] **B.2** — Run full Playwright test suite and confirm zero regressions
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Run `npm test`. All existing tests pass (identical pass count to baseline — currently 278 passing, 0 failing, 0 skipped). Output contains zero `[WebServer]` access log lines interleaved with test status.
  - **Depends on:** A.1
  - **Maps to:** AC-3

---

## Standard Closing Tasks

> **Numbering:** Continue from the last sprint task. Closing tasks start at CLOSE-1.

- [ ] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run the project's complete test command. All existing tests pass; all new tests from Cohort C pass.
  - If anything fails: fix the implementation, not the test.
> CODEX: This is copy-paste drift. There is no Cohort C in this sketch, so this closing task currently asks the implementer to verify work that does not exist.
> KIMI: **Infeasible reference:** "all new tests from Cohort C pass" — there is no Cohort C in this sketch. This appears to be copy-paste residue from another sketch and should be removed.
> GEMINI: "all new tests from Cohort C" is a phantom reference. This should be cleaned up.

- [ ] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [ ] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1, AC-2, AC-3), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Status-only notes ("PR opened", "tests passing") are not equivalent — the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [ ] **CLOSE-4. Version bump**
  - **File:** project version files (e.g., `package.json`, `js/constants.js`, `sw.js`)
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.
  - If the project opts out of version management (no `devops/version.lock`, or explicit project policy), write `N/A — project opts out of version management (<reason>)` as the acceptance line. Do not silently drop this task.
> CODEX: This needs a human decision before apply. Repo guidance says runtime-code PRs must bump the version; this sketch says it is harness-only. If the team wants harness-only PRs to stay versionless, the task should explicitly route to `N/A` instead of leaving implementers to discover the conflict mid-closeout.
> KIMI: **Process smell:** AGENTS.md states "Every PR that ships runtime code must bump the version." This sketch explicitly does NOT ship runtime code (Non-Goals: "Not changing the production server, deployment config, or runtime code"). A version bump for a test-harness-only change may be unnecessary overhead. Consider whether CLOSE-4 should be `N/A — test-harness only, no runtime code shipped` with rationale.
> GEMINI: Since this is test-harness only and ships zero runtime code, a version bump might actually be confusing or unnecessary according to project standards for "runtime code" only bumps. Confirm with user.
> CLAUDE: Agree with KIMI/Gemini/Codex. This sketch modifies only `playwright.config.js` — test infrastructure, zero runtime code. CLOSE-4 should be marked `N/A — test-harness only, no runtime code shipped`. A version bump here would trigger `/update-spot-bundle`, CHANGELOG entries, and sw.js cache stamp — all meaningless overhead for a config property change.

- [ ] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip.
  - Mark the source issue Done in Plane: `mcp__plane__update_issue` to state "Done".
  - If the project genuinely has no DocVault footprint, write `vault-update: N/A — <reason>` as a sub-line on this task and proceed with the issue close. Do not drop the task.
> CODEX: Sequencing is off from here through CLOSE-8. Issue close, PR-thread resolution, and sketch archive all depend on events that happen after PR creation and often after human review or merge, so bundling them into one linear closeout checklist invites false completion.
> KIMI: **Infeasible sequencing:** "Mark the source issue Done in Plane" is listed before the PR is opened (CLOSE-6) and long before merge. In standard workflow, issues close after merge or deployment. Closing the issue here misaligns the sketch with the actual issue lifecycle and should happen post-merge or be moved to CLOSE-8.

- [ ] **CLOSE-6. Open PR**
  - Use worktree branch from `/sketch apply`. Title: `chore(STRK-57): suppress python http.server access logs in webServer command` or `chore(STRK-57): …` if user-facing.
  - Body must include: link to source issue, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-57-quiet-playwright-logs/`), test plan checklist.

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as "comments outside of the diff" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.
> KIMI: **Infeasible sequencing:** `/pr-resolve` is listed as a standard closing task, but review threads only exist AFTER reviewers have commented on the opened PR. It cannot be executed immediately after CLOSE-6 in the same flow. This should be a post-review follow-up task, not a pre-merge checklist item.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-57`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-57-quiet-playwright-logs/` and saves mem0 summary.
> KIMI: **Infeasible sequencing:** "Archive sketch (after PR merges)" is in the same pre-merge task list. Since `/sketch apply` runs before implementation and this project prohibits auto-merge, this task cannot be completed in the same session as the other closing tasks.
> GEMINI: The sequencing of CLOSE-5 through CLOSE-8 is problematic. You cannot "Archive sketch" or "Resolve PR review threads" in the same task list as "Open PR" if the process is sequential and involves human review. It should be a separate post-merge manual step or handled by a post-merge hook, not a checkbox in the pre-merge list.

---

> **Multi-model dispatch hint:** Cohort A tasks marked `[P]` can be sent to different models in parallel via OpenCode. Suggested split: send A.1 to Codex, A.2 to Kimi, A.3 to Gemini. Each model reads the sketch folder, executes its task, commits to the worktree branch. Reconverge before Cohort B.
> CODEX: This hint is not executable as written. There are no `[P]` tasks in Cohort A, there are no A.2 or A.3 tasks, and asking multiple models to commit concurrent edits for a one-file change is the opposite of what this sketch needs.
> CLAUDE: **Copy-paste artifact — delete this entire dispatch hint.** Cohort A has exactly one task (A.1) targeting one property in one file. There is nothing to parallelize. The referenced A.2 and A.3 tasks do not exist, and the `[P]` markers referenced do not appear anywhere in Cohort A. This hint will confuse any automated or human reader.
