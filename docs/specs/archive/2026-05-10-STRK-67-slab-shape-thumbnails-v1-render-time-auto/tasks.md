---
sketch: "STRK-67-slab-shape-thumbnails"
phase: tasks
created: 2026-05-10
approved:
---

# STRK-67 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [ ] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-67-slab-shape-thumbnails`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

## Standard Closing Tasks

- [ ] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run the project's complete test command. All existing tests pass; all new tests pass.
  - If anything fails: fix the implementation, not the test.

- [ ] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [ ] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1, AC-2, …), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [ ] **CLOSE-4. Version bump**
  - **File:** project version files (e.g., `package.json`, `js/constants.js`, `sw.js`)
  - **MUST invoke `/release patch`** as a skill.

- [ ] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill.
  - Mark the source issue Done in Plane: `mcp__plane__update_issue` to state "Done".

- [ ] **CLOSE-6. Open PR**
  - Use worktree branch from `/sketch apply`. Title: `feat(STRK-67): shape-aware thumbnail rendering for slabbed coins`
  - Body must include: link to source issue, link to sketch folder, test plan checklist.

- [ ] **CLOSE-7. Resolve PR review threads**
  - **MUST invoke `/pr-resolve`** as a skill.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-67`** as a skill.

---

> **Multi-model dispatch hint:** Cohort A tasks marked `[P]` can be sent to different models in parallel via OpenCode. Each model reads the sketch folder, executes its task, commits to the worktree branch. Reconverge before Cohort B.
