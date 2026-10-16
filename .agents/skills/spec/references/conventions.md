# Spec — Universal Conventions

Single source of truth for the cross-cutting rules every `/spec-*` skill and the `/spec` driver share. Phase skills are intentionally thin; they open by pointing here so these rules live in **one** place and never drift across the family.

> **Two-tier convention model.** This file holds the rules that are the **same for every project**. Per-project specifics (worktree/branch naming, version-lock, which closing skills apply) live in each project's `.context/spec-conventions.md`. A skill reads **both**: this file for mechanics, the project file for local overrides. If a project file is absent, fall back to the generic defaults noted here.

---

## Command grammar (read this first)

The family splits into two buckets with **consistent argument order** inside each:

| Bucket | Grammar | Members |
|--------|---------|---------|
| **Phase / process skills** — ISSUE always first | `/spec-<noun> ISSUE [PHASE] [AGENT]` | `/spec-requirements ISSUE` · `/spec-discovery ISSUE` · `/spec-approach ISSUE` · `/spec-tasks ISSUE` · `/spec-reconcile ISSUE PHASE` · `/spec-review ISSUE PHASE [AGENT]` |
| **Lifecycle driver** — verb first | `/spec <verb> ISSUE` | `/spec new` · `/spec run` · `/spec workflow` · `/spec dispatch` · `/spec archive` |

**Execution verbs (driver):**

| Verb | Behaviour |
|------|-----------|
| `run` | Claude executes tasks **inline**, one at a time. Simplest, lowest concurrency. |
| `workflow` | **In-harness** subagent orchestration — `[P]` tasks within a cohort run in true parallel via the Task tool. |
| `dispatch` | **Prints self-contained prompts** to hand off to an **external terminal** (Codex / OpenCode / Antigravity / second Claude session). |

> Historical note: an earlier version of the skill used `apply`/`dispatch`/`orchestrate`. The mapping is `apply→run`, `dispatch→workflow`, `orchestrate→dispatch`. The word **`dispatch` changed meaning** — it now denotes external-terminal handoff, not in-harness subagents.

---

## ISSUE-ID format

`{PROJECT-PREFIX}-{N}` — e.g. `STRK-123`, `DEVS-7`. Derive `{project}` from the prefix via the registry in the `issue` skill's table.

## Folder resolution

A spec lives **in the project's repo** at `{specs-root}/{ISSUE-ID}-{slug}/` (DEVS-78, DEVS-112). Every other spec skill and template says `{specs-root}` and means the value resolved here.

**Resolve `{specs-root}`** (repo-relative, from the repo root; in a worktree, the worktree's root):

1. Read `specs.path` from `.claude/project.json` (every harness reads this file) — e.g. `jq -r '.specs.path // empty' .claude/project.json`.
2. If set, `{specs-root}` = that path (e.g. `docs/specs`). Create the directory if absent. Do **not** scaffold a DocVault.
3. If unset, `{specs-root}` = `DocVault/specs` (the default). `vault-path project` → `<repo root>/DocVault`; if it exits 2 (no `DocVault/` yet), scaffold it from `$(vault-path shared)/Templates/project-vault/README.md`.

Either way the specs root is inside the checkout, so in a worktree spec edits ride the feature branch and land with the PR. The archive is always `{specs-root}/archive/`.

**Locate a spec:** glob `{specs-root}/{ISSUE-ID}-*` (ignore `{specs-root}/archive/`). There must be **exactly one** match. Zero or multiple → STOP and print the candidates.

**Public repos:** spec files are public. Keep LAN IPs, internal hostnames other than `plane.lbruton.cc`, and credentials out of them. Put any such detail in `$(vault-path private)/specs/{ISSUE-ID}-{slug}/` and link to it by path.

Conventions and templates ship with the `spec` skill at `.agents/skills/spec/references/`, deployed into each repo from `Devops/skill-library` (DEVS-124).

## The four artifacts

| File | Question it answers | Voice |
|------|---------------------|-------|
| `requirements.md` | What are we building, and how do we know we're done? | Product/PM |
| `discovery.md` | What's already there, what does prior art say, what's unknown? | Research |
| `approach.md` | How will we build it? Architecture, decisions, file map. | Architect |
| `tasks.md` | Concrete checklist, sprint cohorts, `[P]` markers, file paths. | Tech lead |

The markdown **is** the state. Any model in any harness can execute any phase by reading the folder — no shared tool state required.

---

## Phase-boundary discipline (load-bearing)

Each phase produces **exactly ONE artifact and STOPS.** Do not advance to the next phase — even if it seems trivial, even if the original ask spanned multiple phases, even with spare context budget. The human explicitly invokes the next `/spec-<phase> ISSUE`. **This is the review seam; collapsing it defeats the workflow.**

If a phase's prompt and the user's framing seem to ask for multiple phases at once, do the FIRST phase only and surface the apparent multi-phase ask at the end. The human decides whether to continue.

## Unreconciled-marks pre-check (every phase after requirements)

Before drafting any phase that builds on a prior one, scan **all prior phase files** for reviewer marks left by `/spec-review` that have **not** yet been reconciled:

- inline `> CODEX:`, `> GEMINI:`, `> OPUS:`, `> DEEPSEEK:`, `> KIMI:`, or `> {OTHER}:` blocks in the body, **and**
- `## {AGENT} Review` or `## {AGENT} — Unverified Assumptions` sections

…that are **NOT** nested under a `## Review Archive` heading. Anything under `## Review Archive` is already reconciled — ignore it.

If any unreconciled marks exist, **STOP** and print:

```
{file} has not been reconciled — run /spec-reconcile {ISSUE-ID} {phase} first.
```

Do not draft on top of un-reconciled review.

## The `approved:` field (human-only)

`tasks.md` frontmatter carries `approved: YYYY-MM-DD`. **No phase prompt may ever write it.** The single exception: in chat, after all phases are done, an explicit verbal approval signal ("approved", "stamp it", "you can stamp the date", "I approve, run it") authorises the agent to write **today's** date. Generic "looks good" chatter is **not** approval — wait for an explicit instruction.

## Reviewer tags

Review blocks are prefixed with an uppercase tag (`OPUS`, `GEMINI`, `DEEPSEEK`, `KIMI`, `CODEX`, …). Never auto-detect the tag from the model name — models misidentify themselves across harnesses. The tag is supplied as the `[AGENT]` arg to `/spec-review` or prompted for.

---

## Per-project overrides — `.context/spec-conventions.md`

Each project's `.context/spec-conventions.md` (when present) defines:

- **Worktree & branch naming** — what the project's setup skill creates.
- **Version-lock / release path** — the skill that owns version bumps.
- **Closing-task roster** — which Standard Closing Tasks apply and their exact skill names.
- **Project doc pointers** — `AGENTS.md`, Foundation docs, `.context/git-topology.md`.

Read it during `new`, the `tasks` phase (Cohort 0 + closing tasks), and all execution verbs. When absent, fall back to: branch `spec/{ISSUE-ID}-{slug}`, a plain `git worktree add`, and the Standard Closing Tasks block from the `spec` skill's `references/templates/tasks-template.md`.
