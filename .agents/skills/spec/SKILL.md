---
name: spec
description: "Phased spec workflow above a quick fix. Driver for the /spec-* phase family + execution engines (run/workflow/dispatch). Phased markdown artifacts in the repo's specs root (specs.path in .claude/project.json, default DocVault/specs/)."
user-invocable: true
library-version: 04dbfc6b5d14
---

# Spec — Phased Spec Workflow (driver)

Markdown-first, agent-agnostic workflow for anything bigger than a quick fix. Target window: **30–90 minutes**; larger or high-risk work uses the same phases with mandatory per-phase review.

This skill is the **lifecycle driver**. The four authoring phases and the review/reconcile steps are now **standalone, ISSUE-first skills** (see *Command family* below). The driver owns scaffolding (`new`), the three execution engines (`run` / `workflow` / `dispatch`), and lifecycle ops (`archive`).

> **Read `.agents/skills/spec/references/conventions.md` first** — it is the single source of truth for command grammar, folder resolution, the four artifacts, phase-boundary discipline, the unreconciled-marks pre-check, reviewer tags, and the `approved:` rule. The per-project `.context/spec-conventions.md` carries worktree/branch/closing-task overrides. This driver does not restate them.

## When to use which tier

| Tier | Use when | Time |
|------|----------|------|
| Quick fix (no skill: worktree + `chore:` PR) | 1–3 files, trivial fix/CSS/syntax | <30 min |
| `/spec` | 3–15 files, multi-step refactor/feature, multi-model collab valuable | 30–90 min |
| `/spec` + mandatory review | Cross-cutting, public API, schema/data migration, security-sensitive — run `/spec-review` (≥1 other model) on **every** phase | 1–6 h |

## Command family

**Phase / process skills** — ISSUE always first (standalone skills, not subcommands):

| Skill | Phase |
|-------|-------|
| `/spec-requirements ISSUE` | 1 — grill + EARS requirements.md |
| `/spec-discovery ISSUE` | 2 — research sweep → discovery.md |
| `/spec-approach ISSUE` | 3 — architecture + file map → approach.md |
| `/spec-tasks ISSUE` | 4 — TDD sprint cohorts → tasks.md |
| `/spec-review ISSUE PHASE [AGENT]` | peer review of one phase |
| `/spec-reconcile ISSUE PHASE` | apply review marks, archive originals |

**Lifecycle driver** — `/spec <verb> ISSUE`:

| Verb | Action |
|------|--------|
| `new <ISSUE-ID> "<slug>"` | Scaffold the spec folder + 4 empty artifacts from templates. |
| `run <ISSUE-ID>` | **HARD GATE**, then execute tasks.md **inline**, one task at a time. |
| `workflow <ISSUE-ID>` | **HARD GATE**, then **in-harness subagent** conductor — `[P]` tasks run in true parallel via the Task tool. |
| `dispatch <ISSUE-ID>` | **HARD GATE**, then print self-contained prompt blocks to **hand off to an external terminal** (Codex / OpenCode / Antigravity / second Claude session). |
| `archive <ISSUE-ID>` | Move folder to `archive/`, save a milestone memory, mark issue Done. |

> **Verb history (the `dispatch` flip):** the old subcommands were `apply`/`dispatch`/`orchestrate`. Mapping: `apply→run`, `dispatch→workflow`, `orchestrate→dispatch`. **The word `dispatch` changed meaning** — it now means external-terminal handoff, not in-harness subagents.

### Backward-compat shim

If invoked as `/spec <phase>` where `<phase>` ∈ `requirements | discovery | approach | tasks | reconcile | review`, do not execute it here — print:

```
Phases are now standalone skills (ISSUE-first):
  /spec-<phase> {ISSUE-ID}        (e.g. /spec-requirements STRK-123)
  /spec-review {ISSUE-ID} {phase} [AGENT]
```

…and stop. If invoked as `/spec apply|orchestrate`, print the rename (`apply→run`, `orchestrate→dispatch`) and stop.

### `new` — scaffold

1. Parse `<ISSUE-ID>` → derive `{project}` from the prefix (registry in the `issue` skill's table).
2. Resolve `{specs-root}` per conventions.md (Folder resolution) and target `{specs-root}/{ISSUE-ID}-{slug}/`; create the specs root if absent.
3. Copy the four templates from `.agents/skills/spec/references/templates/`, dropping the `-template` suffix.
4. Replace `{{ISSUE-ID}}`, `{{SLUG}}`, `{{DATE}}` placeholders with concrete values.
5. Fetch the Plane issue via `mcp__plane__workitem` (`action: "retrieve_by_identifier"`); paste title + description into a "Source Issue" block at the top of `requirements.md`.
6. Print the path and: `next: /spec-requirements {ISSUE-ID}`.

---

## The hard gate (shared by `run` / `workflow` / `dispatch`)

All three execution verbs refuse to start unless every check passes:

- `requirements.md`, `discovery.md`, `approach.md`, `tasks.md` each exist with ≥10 lines of body beyond frontmatter.
- `tasks.md` frontmatter `approved:` holds a `YYYY-MM-DD` value **≤14 days old**.

**Worktree setup** — read the project's `.context/spec-conventions.md` (and `.context/git-topology.md` / `AGENTS.md`). Follow the project's convention exactly — invoke the project setup skill (e.g. `/start-patch` for StakTrakr → `patch/<version>` branch) rather than creating the worktree manually. Generic fallback only when no project convention exists: `git worktree add ../<project>-spec-{ISSUE-ID} -b spec/{ISSUE-ID}-{slug}`. This creates the worktree that task 0.1 verifies; if missing when you reach 0.1, create it then — 0.1 is "create if missing", not "halt if missing". Record the absolute path as `{worktree_path}`.

**Mark issue In Progress** — `mcp__plane__state` (`action: "list"`), find the `started`-group state, `mcp__plane__workitem` (`action: "update"`). If none exists, warn and continue. Then add yourself as an assignee per the `issue` skill's **Pick up** section (`manage_assignee`, merge, never replace).

---

### `run` — inline execution

Claude executes every task itself, one at a time. Simplest, lowest concurrency.

Execute `tasks.md` task-by-task. For EACH task, in this exact order (never batch marks):

1. Read the next unchecked `[ ]` item.
2. Do the work it describes.
3. Verify its acceptance line is met.
4. **Edit `tasks.md` to mark the item `[x]` BEFORE starting the next task.** Non-optional, non-deferrable. Save.
5. Commit. (Tasks in one Sprint Cohort may share a commit if logically grouped — but all their `[x]` marks must be written before the next cohort begins.)

**Why in-flight marking is mandatory:** the `[x]` marks are the audit trail and the recovery point. If implementation fails mid-cohort, the file's mark state is the only resume signal. Batching marks destroys both.

When the Standard Closing Tasks block is reached, run them in order (verify, scan, ship), same per-task `[x]`-before-next rule. Open the PR with a body referencing `Spec: {specs-root}/{ID}-{slug}/` (the resolved path, e.g. `docs/specs/STRK-411-…/`).

---

### `workflow` — in-harness subagent conductor

Use this only when the user explicitly invoked `/spec workflow` or otherwise asked for in-harness subagents. The main Codex session is the **conductor**; subagents do bounded task work.

**Subagent discovery.** Prefer a project-specific agent from `.codex/agents/` (e.g. `staktrakr-implementer`) when available; otherwise use `worker` for implementation and `explorer` for read-only checks. A task's explicit `Subagent:` hint overrides discovery for that task. Each subagent must commit and report its commit SHA plus any contract details downstream tasks must preserve.

**Parse sprint cohorts** in document order. Within each: `[P]` unchecked items → parallel batch (Task calls in one message); non-`[P]` → serial queue.

**PARALLELIZATION SAFETY — re-verify before dispatch.** A `[P]` marker is a promise from the tasks author; re-check it: do any two `[P]` tasks share a `File(s):` path? does one depend on a symbol another creates? If yes, force them serial. This re-check is cheap and catches authoring drift.

**Dispatch loop.** Per cohort: send the parallel batch in one message, await all; then run the serial queue one at a time. **After each task** — verify before marking `[x]`:
- `cd {worktree_path} && git log --oneline origin/{base}..HEAD` — confirm a new commit landed.
- `git show <SHA>` / `git diff HEAD~1` — confirm file scope matches the task's declared `File(s):`. If the diff touches files outside that scope, STOP and surface the drift — do not mark `[x]`.

Mark `[x]` in `tasks.md` **before** dispatching the next task/cohort (same discipline as `run`).

**Prompt template — self-contained per task.** Every Task `prompt` MUST contain: the **absolute `{worktree_path}`** with "cd there, work ONLY here, do NOT touch the main checkout" (subagents inherit `cwd` — this is the load-bearing split-diff safety rule); read-only spec-context paths; prior-commits list; the task title/`File(s):`/`Acceptance:`/`Maps to:` verbatim; any pinned contract details from earlier subagent reports; the UI Contract block if `approach.md` has one ("design is the spec — a test that passes while the UI diverges is a FAILING implementation"); constraints ("only the named files"; "do NOT mark `[x]` — the conductor does"); commit-message format `{type}({ISSUE-ID}): {N.M} {desc}`.

**Closing tasks — DO NOT dispatch.** The conductor invokes named skills directly (`/release patch`, `/vault-update`, `/pr-resolve`, `/spec archive`) or runs commands inline — these are orchestrator-level ops that need worktree/version-lock/PR-thread state a fresh subagent doesn't carry. For a genuinely subagent-friendly closing task, use a specialized agent type (`codacy-cloud-cli`, `pr-thread-resolver`).

**Anti-patterns:** don't dispatch `[P]` without re-checking file scope; don't omit the worktree path from any prompt; don't trust a "task complete" report without verifying the diff scope; don't dispatch a closing task that has a named skill.

---

### `dispatch` — external-terminal handoff (conductor mode)

The main agent is a **conductor**: it reads `tasks.md`, generates a self-contained handoff prompt per task/batch, **prints it**, waits for the human to paste it into whichever external terminal (Codex / OpenCode / Antigravity / second Claude session), then marks `[x]` and advances. No task runs inline. Same print-and-wait pattern as `/spec-review`.

**Parse sprint cohorts** as in `workflow`: `[P]` → parallel batch (sendable to multiple terminals at once); non-`[P]` → serial.

**Model assignment.** For each task look for a `Model:` hint line (e.g. `Model: codex`) — a routing label for the human, controlling the prompt header. If a cohort has unassigned tasks, `AskUserQuestion` (Codex / Gemini / Claude-other / Other) before printing it, and apply the answer to all unassigned tasks in that cohort.

**Orchestration loop.** Per cohort: print all `[P]` blocks together under `=== Cohort N — Parallel Batch ===` and tell the human they can run simultaneously; wait for "all done". For serial tasks, print one block, wait for "done", then the next. **After each confirmed-complete task**, edit `tasks.md` to mark it `[x]` (non-deferrable — same rule as `run`).

**Prompt block format** — self-contained so any model in any terminal executes it without prior context: ROLE; TASK (verbatim); ACCEPTANCE CHECK; FILES TO MODIFY (absolute paths under `{worktree_path}`); WORKTREE ROOT; READ-ONLY CONTEXT (the four spec files); UI CONTRACT block if `approach.md` has one; INSTRUCTIONS ("work exclusively in WORKTREE ROOT"; "verify acceptance before finishing"; "commit referencing the task"; "do NOT mark `[x]` — the conductor does"; "one task per prompt").

**Project note:** per `.context/spec-conventions.md`, StakTrakr closing tasks have no model-routing ambiguity or parallel hazard → dispatch them as a single batched prompt.

**Headless note (power users):** some CLIs support non-interactive mode (`codex --no-interactive`, etc.) to pipe a saved block without a manual paste. Advanced; default to print-and-paste unless you know the target CLI handles headless reliably.

---

### `archive`

1. After PR merges (or abandonment), move the folder to `{specs-root}/archive/YYYY-MM-DD-{ID}-{slug}/`.
2. Save a milestone memory with `mcp__sessionflow__add_memory`: text "Spec {ID} {slug} shipped {date} — outcome: {summary}", `project` from `project.json` (`memory.project`, else lowercase `tag`), `type: "milestone"`, `topic_key: "spec:{ID}"`, `agent_id` the harness, `extra: {"source": "spec-archive"}`.
3. If the issue is still open, mark it Done via `mcp__plane__workitem` (`action: "update"`).

---

## Multi-harness usage

The driver and phase skills run from any harness that reads SKILL.md. The markdown is the durable interface — once `/spec new` scaffolds the folder, any model in any harness executes any phase by reading the folder. Hand-offs happen via files, not shared tool state. Typical flow (review baked in per phase):

1. `/spec new DEVS-12 "rate-limiter"` → `/spec-requirements DEVS-12`
2. `/spec-review DEVS-12 requirements CODEX` (+ other reviewers) → `/spec-reconcile DEVS-12 requirements`
3. `/spec-discovery DEVS-12` → review → reconcile
4. `/spec-approach DEVS-12` → review → reconcile
5. `/spec-tasks DEVS-12` → review → reconcile
6. Human stamps `approved:`, then picks an engine: `/spec run` (inline) · `/spec workflow` (in-harness parallel subagents) · `/spec dispatch` (external-terminal handoff).

## Anti-patterns

- **Don't** mark tasks complete or set `approved:` from a phase skill. Phases write content; the human approves. The only exception: an explicit verbal approval in chat lets the agent stamp today's date in `approved:`. "Looks good" is not approval.
- **Don't** skip phases or skip per-phase review — each phase and each `/spec-review` is a seam where a flaw is caught before later phases inherit it.
- **Don't** advance a phase while unreconciled `> AGENT:` marks remain (phase skills PRE-CHECK and stop). Run `/spec-reconcile` first.
- **Don't** batch `[x]` marks at the end of execution (any engine) — mark before the next task begins; the marks are the audit trail.
- **Don't** run tasks inline during `workflow` or `dispatch` — the conductor dispatches/prints and tracks; only Cohort 0 setup and closing-task skill invocations are done by the conductor itself.
- **Don't** omit the worktree path from a `workflow`/`dispatch` prompt — inherited `cwd` is the #1 split-diff cause.
- **Don't** put tests after implementation, or modify a failing test to make it pass — tests are the spec (TDD: Cohort B before C).
- **Don't** let green tests substitute for visual QA on UI-heavy specs — if `approach.md` has a `## UI Contract`, CLOSE-4 (verification stamp) needs visual verification per UI-linked AC (STRK-123).
- **Don't** run schema migrations, public API, or security-sensitive specs without a `/spec-review` from at least one other model on every phase.

## Decision matrix recap

Want to start coding immediately → quick fix (worktree + `chore:` PR). Want to plan in phases first → `/spec`. High-risk change → `/spec` with per-phase peer review.
