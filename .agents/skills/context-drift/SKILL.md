---
name: context-drift
description: >-
  Audit a project's in-repo `.context/` foundation docs against source-code truth, and surface
  promotion candidates — recurring patterns/decisions that belong in `.context/` + CLAUDE.md but
  aren't captured yet. Checks the factual claims in each `.context/`
  doc (infrastructure.md, architecture.md, coding-standards.md, design-philosophy.md,
  reusable-patterns.md, plus any project extras) against the source with grep and direct reads,
  and flags mismatches. Report-only by default;
  fixes are user-gated and land via worktree + PR (the repo's branch policy). Supersedes
  `/vault-drift` for projects migrated to `.context/` (DEVS-37). Triggers: "context drift", "vault drift", "drift audit", "drift check",
  "context-drift", "audit .context", "check context docs", "foundation drift", "verify foundation",
  "what should be in .context".
library-version: f0ca78a2b4c9
---

# Context Drift

Audits a project's in-repo **`.context/`** foundation docs against source-code truth, and proposes
what *should* be captured but isn't. This is the maintenance counterpart to
`/setup-foundation-context` (which does the one-time migration). Once a project's foundation docs
live in `.context/`, this skill — not `/vault-drift` — keeps them honest.

Two jobs:
1. **Drift audit** — every factual claim in `.context/` verified against code. Source wins.
2. **Promotion candidates** — recurring patterns, gotchas, and decisions present in the code or
   recent work but missing from `.context/` / CLAUDE.md. Surfaced as suggestions, never auto-added.

## Relationship to `/vault-drift`

`/vault-drift` was retired in DEVS-78 (2026-09-28). The DocVault `Foundation/` pages it audited stay in the frozen archive, and every active project keeps foundation docs in `.context/`. This skill is the only drift audit. A revived backburner project runs `/setup-foundation-context` first.

## Arguments

- `[project]` — project name. Auto-detected from `.claude/project.json` if omitted.
- `--apply` — open the fix workflow after the report. **Default is report-only.**
- `--doc <name>` — audit a single `.context/` doc.
- `--no-promote` — skip the promotion-candidate scan (drift audit only).

## Phase 0: Project discovery

```bash
cat .claude/project.json 2>/dev/null   # -> name
ls .context/*.md 2>/dev/null
```

- Repo root = current working directory.
- If no `.context/` directory exists: STOP. "This project hasn't migrated foundation docs to
  `.context/` yet — run `/setup-foundation-context` first." Do not fall back to DocVault.

## Phase 1: Enumerate `.context/` docs

Classify each `.context/*.md`:

- **Baseline (5)** — `infrastructure.md`, `architecture.md`, `coding-standards.md`,
  `design-philosophy.md`, `reusable-patterns.md`. Always audited.
- **Extras** — any other `.md` (e.g. `integrations.md`, `git-topology.md`, `implementation-gotchas.md`).
  Audited too.
- **GLOSSARY.md** — skip drift audit (owned by `/glossary`); note its presence only.
- **Unpopulated stubs** — files whose sections are still `<!-- TODO: fill from code -->`. Do not
  flag as drift; list them under "needs fill" so the user (or this skill's promotion pass) can
  populate them.

## Phase 1b: Conventions snapshot (optional)

If `.claude/project-conventions.json` exists, it's a **frozen snapshot** of release-hygiene facts (test framework and command, version lock, changelog) from the retired SpecFlow MCP. Cross-check it against source alongside the docs. When it disagrees with source, report the JSON as the stale side and offer to update it by hand. If it's absent, skip this step.

## Phase 2: Dispatch the drift-audit agent

The audit is heavy (several searches per doc). Dispatch one general-purpose agent in isolation
to keep the main context clean.

### Audit agent prompt template

```
CONTEXT DRIFT AUDIT — {project}

Compare factual claims in the .context/ foundation docs against actual source-code truth. Flag
every discrepancy. Do NOT trust the docs — they are what we're testing.

## Setup
- Repo: /Volumes/DATA/GitHub/{project}/
- Docs: /Volumes/DATA/GitHub/{project}/.context/*.md
- Find the truth with Grep and Glob on the identifiers, paths and values each claim names, then Read
  the hits. Search for synonyms when the literal name returns nothing.

## For each .context/ doc (skip GLOSSARY.md and unpopulated stubs)
1. Read the doc.
2. Extract factual claims, categorized: config values (ports, timeouts, thresholds) · file paths
   (module/dir locations) · function/symbol names (exports, constants, interfaces) · commands
   (scripts, build/test invocations) · URLs/endpoints · schema (env vars, table/column names) ·
   version numbers · issue prefix / branch policy.
3. For each claim run a targeted Grep (or Glob for paths) to locate the source truth.
4. Compare claim vs truth.

## Output per doc
### {doc}
STATUS: CLEAN | DRIFTED | PARTIAL | UNVERIFIABLE
Claims checked: N
Drift: - Claim "X" -> Actual "Y" (source: path:line)
Clean (spot-checked): [brief list]
Unverifiable: [list + reason]

## Final: priority fix list ranked
- CRITICAL — factually wrong; an agent trusting it would make a bad decision
- MODERATE — outdated but directionally correct
- MINOR — wording drift, low impact
Plus: total claims checked, per-doc health %.
```

Run with `run_in_background: true` for large projects; await for small ones.

## Phase 2b: Promotion-candidate scan (skip if `--no-promote`)

Separate, lighter pass — what *should* be in `.context/` but isn't. Sources of signal:

- **Code reality not documented** — a `lib/` module, a shared helper, a config constant, an env
  var, a hook, or a CI gate that no `.context/` doc mentions. Grep for high-fan-in
  symbols and config files, cross-check against doc contents.
- **Recurring gotchas** — search the repo for `// HACK`, `// NOTE`, `# gotcha`, workaround comments,
  and `.github/` CI config that encode rules not in `coding-standards.md`.
- **Recent decisions** — `mcp__sessionflow__search_all_sessions` (project-scoped, `date_from` ~30d)
  and recent `git log` for decisions/patterns repeatedly re-explained but not written down.
- **Stub gaps** — any unpopulated stub section from Phase 1 is a promotion target: propose content
  derived from code.

Output each candidate as: *what* (the fact), *where it should live* (`.context/<doc>` section, and
whether CLAUDE.md should point at it), *evidence* (file:line / session ref). **Suggestions only** —
never auto-write.

## Phase 3: Write the report

Write to the project's **private companion** in the shared vault. This keeps dated audit history out of the code repo (no PR churn) and out of public repos:

```
$(vault-path private)/drift-reports/{YYYY-MM-DD}-context.md
```

```yaml
---
title: "{project} Context Drift Report — {YYYY-MM-DD}"
type: audit
project: {project}
created: "{YYYY-MM-DD}"
tags: [drift, audit, context, {project}]
---
```

Body: the audit agent's per-doc output + the priority fix list + the promotion candidates.
Commit it to the shared vault with `/vault-sweep` (a direct commit to Devops `main`, scoped to `DocVault/`), or mention the pending file.

## Phase 4: Present findings

```
## {project} Context Drift — {YYYY-MM-DD}

.context/ docs audited: N (+ M extras)   Claims checked: K
Drift: X CRITICAL, Y MODERATE, Z MINOR
Needs fill (stubs): [list or none]
Promotion candidates: P  (top: "...")

CRITICAL drift:
- {doc}: "{claim}" -> actual "{truth}" ({file:line})

Report: $(vault-path private)/drift-reports/{date}-context.md

Fix drift now? Add promotion candidates? [drift / promote / both / no]
```

## Phase 5: Apply fixes (user-gated)

`.context/` lives in the **project repo**, which is branch-protected. Fixes therefore go through the
repo's normal branch policy — **NOT** a direct commit.

1. Confirm scope with the user (which drift items, which promotion candidates).
2. Worktree off the repo's default branch:
   `git -C /Volumes/DATA/GitHub/{project} worktree add -b {project-prefix}-context-drift <path> origin/<default-branch>`
   (respect per-project default branch — e.g. WhoseOnFirst targets `dev`, Forge targets `main`).
3. Edit the `.context/` docs (claim → truth; add promoted content). Bump each doc's frontmatter
   `updated` date.
4. If a promotion candidate also warrants a CLAUDE.md pointer, add it.
5. Commit signed, `chore:` (docs-only — no version bump), open a PR per project policy.
6. Report the PR URL. Do not merge — hand off to `/pr-resolve`.

## Phase 6: Final summary

```
## Context Drift Complete — {project}
Report: $(vault-path private)/drift-reports/{date}-context.md
Fixes: PR <url> ({N} docs) — or "report-only, no fixes"
Foundation health: {before %} -> {after %}
```

## Rules

- **Report-only by default.** Never edit `.context/` without user confirmation.
- **Source code always wins.** Doc disagrees with code → fix the doc, never the reverse (unless the
  user says the code is wrong).
- **Fixes go through the repo's branch policy** — worktree + PR, signed, `chore:`. Never a direct
  push. Respect each project's default branch.
- **Factual mismatches only.** Don't flag stylistic/wording differences as drift.
- **Promotion candidates are suggestions.** Surface evidence; let the user decide. Never auto-add.
- **UNVERIFIABLE is a real verdict.** Grep finds nothing for a claim → the doc may be describing a
  removed feature. Note it.

## What this skill does NOT do

- Run a one-time migration — that's `/setup-foundation-context`.
- Manage GLOSSARY.md — that's `/glossary`.
- Auto-commit or merge — fixes stop at an open PR for `/pr-resolve`.
- Chase every claim — prioritizes facts agents actually rely on (config, paths, commands, APIs,
  prefixes, branch policy) over narrative prose.

## Integration

- **Triggered by:** user request; periodic hygiene; after infra/config changes; before a release.
- **Produces:** a dated context-drift report in the private companion (`vault-path private`); optional fix PR in the project repo.
- **Supersedes:** `/vault-drift` (retired DEVS-78).
