---
name: spec-tasks
description: "Spec Phase 4 — break approach into a TDD sprint-cohort checklist in tasks.md. Standalone, ISSUE-first. Reads universal + per-project conventions and the tasks template."
user-invocable: true
allowed-tools: >-
  Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion
library-version: 3265cf015af6
---

# /spec-tasks ISSUE

Phase 4: turn the approach into a concrete, parallel-aware, TDD-ordered checklist in `tasks.md`. One artifact, then STOP.

## Invocation

```
/spec-tasks <ISSUE-ID>
```

Missing `<ISSUE-ID>` → print `Usage: /spec-tasks <ISSUE-ID>` and exit.

## Read first

- **`.claude/skills/spec/references/conventions.md`** — folder resolution, phase-boundary discipline, unreconciled-marks pre-check.
- The project's **`.context/spec-conventions.md`** — worktree/branch convention for Cohort 0, version-lock, and the verbatim closing-task roster.
- **`.claude/skills/spec/references/templates/tasks-template.md`** — the canonical structure (Cohort 0 setup, A/B/C TDD cohorts, Standard Closing Tasks). Follow it; renumber only.

## Steps

1. **Resolve the spec folder**; read all three prior phase docs (`requirements`, `discovery`, `approach`).
2. **Unreconciled-marks PRE-CHECK** (per conventions.md) on all three. Any unreconciled marks → STOP and name the file + `/spec-reconcile {ISSUE-ID} {phase}`.
3. **Draft `tasks.md`** from the template:
   - **Sprint Cohort 0 — Setup**: worktree-confirmation task using the **project's** convention from `.context/spec-conventions.md` (e.g. StakTrakr → `/start-patch`, `patch/<version>` branch). Generic fallback `spec/{ISSUE-ID}-{slug}` only when no project convention exists.
   - **TDD cohorts**: A = foundation/scaffolding, B = tests (RED — failing tests encoding each EARS acceptance criterion), C = implementation (GREEN). If a task has no testable behavior, B gets a read-only justification task, not a silent skip.
   - Mark parallel-safe tasks `[P]`; give every task explicit `File(s):`, an `Acceptance:` line, `Maps to: AC-N`, and `Leverage:` hints.
   - **Standard Closing Tasks**: copy from the template, bind skill names to the project roster **verbatim** (`/release patch`, `codacy-analysis-cli`, `/vault-update`, `/pr-resolve`, `/spec archive`). Irrelevant ones → `N/A — <reason>`, never dropped.
   - Set frontmatter `approved:` **empty** — the human stamps it.

### Mandatory cross-checks before saving

- **Parallelization safety** — for each `[P]`: does it share a `File(s):` path with another `[P]` in the cohort? depend on a symbol another `[P]` creates? risk a merge conflict? If yes to any, strip `[P]` and add `Depends on: <task>`. `[P]` is a provable no-collision promise.
- **File-map cross-check** — every `File(s):` path must appear in `approach.md`'s File Map. A task referencing a file outside the map is scope creep → STOP, list offenders, ask whether to drop the task or amend the map. Reverse too: a File Map entry no task touches → surface it.
- **UI Contract traceability** — if `approach.md` has a `## UI Contract` (or any prior doc cites a mockup/playground/screenshot), add a `## UI Contract Traceability` block mapping each named UI state → implementing task(s) → verifying test assertion(s) → visual-verification method. Every cited mockup must appear in some task's `Leverage:`/`Read:` line. Cohort B tests must assert interaction flow + DOM structure, not just "text exists." (STRK-123 lesson.)

4. **Save `tasks.md`.** Touch no other file.

## Output

Summarize: sprint cohorts, parallelization-check result, file-map cross-check result, skill-name discipline result (should be zero paraphrased/dropped), then:

```
next: /spec-review {ISSUE-ID} tasks [AGENT]
then: /spec-reconcile {ISSUE-ID} tasks
then: stamp approved: in tasks.md frontmatter, then /spec run | workflow | dispatch {ISSUE-ID}
```

## Do NOT

- Mark tasks `[x]`, run tasks, or set `approved:` yourself.
- Add files outside `approach.md`'s File Map without explicit human confirmation.
- Paraphrase or drop any named closing skill. Put tests after implementation (TDD: B before C).
- Advance phases.
