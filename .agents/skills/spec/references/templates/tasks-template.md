---
spec: "{{ISSUE-ID}}-{{SLUG}}"
phase: tasks
created: {{DATE}}
approved:
---

# {{ISSUE-ID}} — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/spec run` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four spec files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-analysis-cli`, `/spec archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it — this is setup work, not a stop-the-world gate._

- [ ] **0.1** — Ensure spec worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows the project-required worktree and branch from the repo's `AGENTS.md` and/or `.context/coding-standards.md` / `.context/spec-conventions.md`. Working directory is that worktree, not the main checkout. If the project has no documented worktree convention, fall back to branch `spec/{{ISSUE-ID}}-{{SLUG}}`.
  - **If the worktree does not exist yet:** Create it. Follow the project's worktree convention (invoke the project's setup skill — e.g. `/start-patch` for StakTrakr — or a plain `git worktree add` if no project convention exists). This is expected on the first run — the agent satisfies this task by doing the setup, not by stopping.
  - **Leverage:** `git worktree add`; project-specific setup skills (e.g. `/start-patch`).

## Sprint Cohort A — Foundation (parallel-safe)

_Tasks in this cohort touch independent files and can be dispatched to different models/sessions concurrently. Scaffolding, helpers, data structures — no behavioral logic yet._

- [ ] **A.1 [P]** — _short imperative title_
  - **File(s):** `path/to/file.ts`
  - **Acceptance:** _how we know this task is done — usually one or two lines tying back to a specific AC_
  - **Leverage:** _existing helpers, prior art, mem0 memory id if applicable_
  - **Maps to:** AC-1

- [ ] **A.2 [P]** — _title_
  - **File(s):** `path/to/other.ts`
  - **Acceptance:** …
  - **Leverage:** …
  - **Maps to:** AC-2

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Write tests that encode the acceptance criteria BEFORE implementation. Tests MUST fail at this point — a passing test means it's not actually testing the new behavior. If the spec has no testable behavior, include a read-only justification task instead (see below)._

- [ ] **B.1** — Write failing tests for _feature_
  - **File(s):** `tests/feature.test.ts` (new)
  - **Acceptance:** Each testable AC from requirements.md has at least one test. All new tests fail (red) because the implementation does not exist yet.
  - **Extend before add:** For each AC, search the project's suites for a test of the same behavior first. Extend that test with the new assertion; add a new test only when no existing test fits. List each extended test here.
  - **Depends on:** A.1, A.2 (if tests import scaffolding from Cohort A)
  - **Maps to:** All AC

> **When no automated test applies.** Not every task has testable behavior — CSS-only changes, config tweaks, copy updates, pure data-file edits. When that's the case, replace the failing-test task with a **read-only justification task**:
>
> ```markdown
> - [ ] **B.1** — Test justification: _short reason_
>   - **File(s):** _no file changes — review anchor only_
>   - **Acceptance:** Documented below. Reviewers verify the justification is sound and no automated test is feasible.
>   - **Justification:** _Why no automated test applies (e.g., "CSS-only layout change — no behavioral logic to assert against")._
>   - **Manual validation:** _How a reviewer or QA pass can verify correctness (e.g., "visual inspection at 320px and 1440px breakpoints", "confirm config key renders in Settings panel", "diff data file for expected shape")._
>   - **Maps to:** All AC
> ```
>
> The justification task gives reviewers an explicit anchor — they can challenge the "no test needed" decision rather than discovering a gap by omission. If a reviewer disagrees, promote to a real test task before proceeding to Cohort C.

## Sprint Cohort C — Implementation · GREEN (sequential)

_TDD green phase. Write the minimum code that makes all Cohort B tests pass. Tasks here depend on Cohort B (tests exist and are red)._

- [ ] **C.1** — _implementation title_
  - **File(s):** `path/to/wired-up.ts`
  - **Acceptance:** All Cohort B tests pass (green). _Plus any additional acceptance lines tying back to specific ACs._
  - **Depends on:** B.1
  - **Maps to:** AC-1, AC-2

- [ ] **C.2** — _title_
  - **File(s):** …
  - **Acceptance:** …
  - **Depends on:** C.1

---

## Standard Closing Tasks

> **Numbering:** Continue from the last sprint task. If your last sprint task is C.1, closing tasks start at C.2 — or relabel as 1, 2, 3 below; consistency matters more than scheme.

- [ ] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run the project's complete test command. All existing tests pass; all new tests from Cohort B pass (green after Cohort C implementation).
  - If anything fails: fix the implementation, not the test. Tests are the spec — a failing test means the implementation is wrong, not the test.

- [ ] **CLOSE-2. Fold new tests** — net test-count delta
  - **File:** test files only — no behavior change
  - For each test this spec added, fold it into an existing test of its domain suite. Keep it separate only when it covers code no other test covers, or asserts something no other test asserts; write that reason here.
  - Record the net delta against the count before the spec: `+N -M tests, +X -Y files`. Rerun the affected tests after folding.

- [ ] **CLOSE-3. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-analysis-cli` skill against changed files (`codacy-analysis analyze --diff`). Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [ ] **CLOSE-4. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1, AC-2, …), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Status-only notes ("PR opened", "tests passing") are not equivalent — the gate requires per-AC traceability.
  - **UI verification requirement:** If `approach.md` contains a `## UI Contract` section (i.e., this spec has UI surface), then for every AC that maps to a named UI state or interaction in the UI Contract:
    - A test-only citation (`verified by <test name>`) is **insufficient**. The stamp line MUST include visual verification evidence in one of these forms:
      - `- [x] AC-N — verified by <test name> + visually verified against mockup state "<state name>"` (manual inspection), OR
      - `- [x] AC-N — verified by <test name> + screenshot compared: <path-to-screenshot>` (captured evidence).
    - If the AC has UI surface but no visual verification was performed, mark it `- [ ] AC-N — gap: test passes but UI not visually verified against mockup`.
    - **Rationale:** A Playwright test can pass while the UI is wrong if it only checks that text exists or data is stored. The UI Contract in approach.md defines the visual/interaction specification — tests verify behavior, visual QA verifies fidelity.
  - Refuse to proceed to CLOSE-5 if any `[ ]` remains in the stamp block.

- [ ] **CLOSE-5. Version bump**
  - **File:** project version files (e.g., `package.json`, `js/constants.js`, `sw.js`)
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.
  - If the project opts out of version management (no `devops/version.lock`, or explicit project policy), write `N/A — project opts out of version management (<reason>)` as the acceptance line. Do not silently drop this task.

- [ ] **CLOSE-6. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip.
  - Mark the source issue Done in Plane: `mcp__plane__workitem` (`action: "update"`) to state "Done".
  - Vault edits go in the repo's `DocVault/` (if it has one) inside this worktree and ride this PR; there is no separate vault commit. Shared-vault edits (`vault-path shared`) commit directly to Devops `main`.
  - If the project genuinely has no DocVault footprint, write `vault-update: N/A — <reason>` as a sub-line on this task and proceed with the issue close. Do not drop the task.

- [ ] **CLOSE-7. Open PR**
  - Use worktree branch from `/spec run`. Title: `chore({{ISSUE-ID}}): <short summary>` or `feat({{ISSUE-ID}}): …` if user-facing.
  - Body must include: link to source issue, link to spec folder (`{{ISSUE-ID}}-{{SLUG}}/` under this repo's specs root — `specs.path` in `.claude/project.json`, default `DocVault/specs/`), test plan checklist.

- [ ] **CLOSE-8. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as "comments outside of the diff" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.

- [ ] **CLOSE-9. Archive spec** (after PR merges)
  - **MUST invoke `/spec archive {{ISSUE-ID}}`** as a skill — moves folder to `archive/YYYY-MM-DD-{{ISSUE-ID}}-{{SLUG}}/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort A tasks marked `[P]` can be sent to different models in parallel. Suggested split: send A.1 to Codex, A.2 to Kimi, A.3 to Gemini. Each model reads the spec folder, executes its task, commits to the worktree branch. Reconverge before Cohort B (tests). The TDD boundary between Cohort B (red) and Cohort C (green) is a natural model-routing seam — one model writes the failing tests, a different model writes the implementation to make them pass.
