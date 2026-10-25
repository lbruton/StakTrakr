---
name: setup-foundation-context
description: >-
  One-shot, idempotent onboarding of a project's agent-facing foundation docs into in-repo
  `.context/` and scaffolds the in-repo `DocVault/` vault. Detects the source state (archived DocVault Foundation/, docs already in-repo
  elsewhere like /docs/, or missing), migrates or scaffolds the 5 baseline foundation docs
  plus any project extras into `.context/`, and rewires CLAUDE.md to point at the in-repo
  copies. Dry-run by default. Run once per project in a fresh session. Operationalizes
  DEVS-37. Triggers: "/setup-foundation-context", "setup foundation context", "migrate
  foundation docs to .context", "onboard foundation docs", "context foundation setup".
library-version: b9ae376f5f2b
---

# Setup Foundation Context

Onboards a project's **agent-facing foundation docs** into in-repo `.context/`, so they travel
with the code and worktrees and are never silently skipped by a sandboxed out-of-repo read
(the DEVS-37 rationale). This is a **one-time** migration per project — once `.context/` is the
canonical home, ongoing upkeep is `/context-drift`'s job, not this skill's.

## The baseline doc set

The floor is **5 docs**; a project may have more. Migrate/scaffold these 5 into `.context/`:

| `.context/` file | What it holds |
|------------------|---------------|
| `infrastructure.md` | hosting, deploy, ports, services, env, external systems |
| `architecture.md` | components, data flow, module boundaries, key abstractions |
| `coding-standards.md` | language/style conventions, lint gates, test conventions |
| `design-philosophy.md` | product/UX principles, the "why" behind decisions |
| `reusable-patterns.md` | recurring code patterns, helpers, idioms to reach for |

**Project extras are preserved, not forced into the 5.** Files like `git-topology.md`,
`implementation-gotchas.md`, `review-and-ci.md`, `integrations.md`, `spec-conventions.md`,
and `GLOSSARY.md` stay as their own `.context/` files. The 5 is a minimum, not a cap.

## Arguments

- `[project]` — project name (e.g. `Forge`). Auto-detected from `.claude/project.json` if omitted.
- `--apply` — perform the migration. **Default is dry-run** (plan only, no writes).
- `--doc <name>` — limit to one baseline doc (e.g. `--doc infrastructure.md`).

## Phase 0: Project discovery

```bash
cat .claude/project.json 2>/dev/null   # -> name
```

Resolve paths:
- Repo root: current working directory (the project repo).
- Project vault: `$(vault-path project)`, i.e. `<repo>/DocVault/` (exit 2 = not scaffolded yet; Phase 3 step 0 creates it)
- Archived Foundation dir (case a source): `$(vault-path archive)/Projects/{name}/Foundation/`. After DEVS-78 these originals only exist in the frozen central repo; they stay there.

If no `.claude/project.json` and no `[project]` arg, list the repos under `$GITHUB_ROOT` (default `/Volumes/DATA/GitHub`)
and ask the user to pick. **Confirm the resolved repo root is the project you intend to migrate**
before any write — this skill writes into the repo.

## Phase 1: Detect source state

For each of the 5 baseline docs, classify the source. A project can mix states across docs.

```bash
ls .context/ 2>/dev/null                                              # already migrated?
ls "$(vault-path archive)/Projects/{name}/Foundation/" 2>/dev/null   # case (a) source (frozen archive)
ls docs/ docs/planning/ docs/reference/ 2>/dev/null                   # case (b) source
```

- **Already in `.context/`** — baseline doc exists in `.context/`. Skip it (idempotent). Note in plan.
- **Case (a) — archived DocVault `Foundation/`** — a matching `Foundation/<doc>.md` exists. Source = migrate from Obsidian.
- **Case (b) — in-repo elsewhere** — a matching doc lives under `docs/` (or similar). Source = consolidate in-repo.
- **Case (c) — missing** — no source anywhere. Action = scaffold a stub.

Name-matching is not always 1:1 (e.g. WOF's `docs/planning/technical-stack.md` → `infrastructure.md`,
`docs/reference/code-patterns.md` → `reusable-patterns.md`). **Propose a mapping; do not auto-rename
silently.** Surface every (source → `.context/` slot) mapping in the dry-run for human approval.

Also enumerate **extras**: any non-baseline `.md` in the archived `Foundation/` or existing `.context/`
(e.g. `integrations.md`, `git-topology.md`, `GLOSSARY.md`). These migrate/stay as-is, never overwritten.

## Phase 2: Build the migration plan

Produce a per-doc plan. Do not write anything yet.

```
## Foundation Context Plan — {project}  (DRY RUN)

Repo:     {repo root}
Vault:    {repo}/DocVault/ (exists | will scaffold)
Archive:  {archived Foundation dir or none}

### Baseline (5)
| Doc                  | State        | Source                                    | Action            |
|----------------------|--------------|-------------------------------------------|-------------------|
| infrastructure.md    | (a) DocVault | Foundation/infrastructure.md              | migrate → .context|
| architecture.md      | (a) DocVault | Foundation/architecture.md                | migrate → .context|
| coding-standards.md  | already      | .context/coding-standards.md              | skip (idempotent) |
| design-philosophy.md | (c) missing  | —                                         | scaffold stub     |
| reusable-patterns.md | (b) in-repo  | docs/reference/code-patterns.md           | consolidate → .context (rename) |

### Extras (preserved)
- integrations.md (DocVault Foundation/) → migrate
- GLOSSARY.md (.context/) → keep untouched

### CLAUDE.md rewire
- L7: `/docs/reference/code-patterns.md` → `.context/reusable-patterns.md`
- L8: absolute DocVault Foundation path → `.context/...`
(<N> reference lines to update)

### Archived originals
Left in the frozen archive. Read-only, no edits.
```

In dry-run (default), **stop here** and present the plan. Proceed to Phase 3 only on `--apply`
or explicit user approval.

## Phase 3: Apply

Only after approval. Order matters — write docs before rewiring CLAUDE.md so references never dangle.

0. **Scaffold the project vault** if `vault-path project` exits 2: follow `$(vault-path shared)/Templates/project-vault/README.md` (Overview.md, `.obsidian/`, `specs/`, `.gitignore` lines). Public repo: add a deploy exclusion for `DocVault/` if the repo is web-served (Pages or Cloudflare).
1. `mkdir -p .context/`
2. **Migrate (a)** — Read each archived `Foundation/<doc>.md`, Write to `.context/<doc>.md`.
   Strip Obsidian-only cruft if obvious (wikilinks to vault-internal pages → plain text or repo
   paths), but **never alter facts**. Keep it faithful.
3. **Consolidate (b)** — Read the in-repo source, Write to the mapped `.context/<doc>.md`.
   Do not delete the old in-repo file in this skill — flag it for the user to remove in the same
   PR if they want (avoids breaking other references mid-migration).
4. **Scaffold (c)** — Write the stub (see appendix). Mark each stub section `<!-- TODO: fill from code -->`
   so `/context-drift` and the user can see it's unpopulated.
5. **Extras** — migrate archived extras into `.context/`; leave existing `.context/` files untouched.
6. **Rewire CLAUDE.md** — Read it, then Edit each reference line from an absolute central-DocVault path or
   old in-repo path to the `.context/` relative path. Preserve surrounding prose. If CLAUDE.md has no
   foundation-doc pointers yet, add a short `## Foundation Context` section listing the `.context/` docs.
7. **Archived originals**: leave them untouched. The central repo is frozen.

## Phase 4: Verify and report

```bash
git -C {repo root} status --short
ls -la {repo root}/.context/
git -C {repo root} diff --stat CLAUDE.md
```

Report:
```
## Foundation Context — {project} — APPLIED
- .context/ now has: <list>  (5 baseline + <N> extras)
- CLAUDE.md: <N> references rewired
- Scaffolded stubs needing fill: <list or none>
- DocVault/: scaffolded | already present
- Archived originals: untouched
- Next: review the diff, then commit on the project's branch (worktree + PR per project policy).
- Then run /context-drift to verify the migrated docs against code truth.
```

**Do not commit or push.** This skill only stages content in the working tree; the project's own
branch/PR policy governs the commit (most projects: worktree + PR).

## Idempotency

Safe to re-run. A baseline doc already present in `.context/` is reported `skip (idempotent)` and
never overwritten. Re-running after a partial migration only fills the gaps. Extras are never
clobbered. CLAUDE.md rewire is a no-op if references already point at `.context/`.

## Non-goals

- Does **not** commit, push, or open a PR — project branch policy owns that.
- Does **not** delete archived originals or old in-repo docs. It flags them and the user decides.
- Does **not** audit doc content against code — that's `/context-drift`.
- Does **not** touch genuinely shared/global docs (MCP Server Registry, Repo Boundaries, Plane
  Projects, Host Inventory). Those stay canonical in the shared vault (`vault-path shared`).

## Appendix — stub template (case c)

```markdown
---
title: <Doc Title>
project: <project>
audience: agent
canonical: .context/<doc>.md
---

# <Doc Title>

<!-- TODO: fill from code -->

## <Section per the doc's purpose>

<!-- TODO: fill from code -->
```

Section skeletons per baseline doc:
- **infrastructure.md** — Hosting / Deploy / Ports & services / Env & secrets / External systems
- **architecture.md** — Components / Data flow / Module boundaries / Key abstractions
- **coding-standards.md** — Language & style / Lint & format gates / Test conventions / Commit & PR rules
- **design-philosophy.md** — Product principles / UX principles / Decision rationale
- **reusable-patterns.md** — Recurring patterns / Shared helpers / Idioms to reach for / Anti-patterns to avoid
