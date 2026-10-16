---
type: index
project: devops
status: active
tags: [spec, workflow, index]
created: 2026-05-07
---

# Spec — Index

The phased spec workflow (the top tier since the SpecFlow MCP was retired, DEVS-68). Markdown-first, agent-agnostic, designed for multi-model orchestration.

## Resources

- [[Guide]] — human-readable walkthrough with worked example and multi-model patterns
- [[templates/requirements-template]] — Phase 1: user stories + acceptance criteria
- [[templates/discovery-template]] — Phase 2: existing code, prior decisions, references
- [[templates/approach-template]] — Phase 3: architecture, decisions, file map
- [[templates/tasks-template]] — Phase 4: sprint cohorts with `[P]` markers + closing tasks

## Quick reference

| Command | Phase |
|---------|-------|
| `/spec new <ID> "<slug>"` | Scaffold folder + 4 templates |
| `/spec requirements <ID>` | Fill requirements.md |
| `/spec discovery <ID>` | Fill discovery.md |
| `/spec approach <ID>` | Fill approach.md |
| `/spec tasks <ID>` | Fill tasks.md with sprint cohorts |
| `/spec-review <ID> <phase>` | Per-phase peer review (standalone skill). Run after each phase. |
| `/spec reconcile <ID> <phase>` | Classify reviewer findings, ask about ambiguous items inline, edit the phase file on your approval, archive marks. Run before the next phase. |
| `/spec apply <ID>` | **HARD GATE** → worktree + implementation |
| `/spec archive <ID>` | Move to archive, close issue, save mem0 |

## Tier comparison

| Tier | Time | Files touched | Approval | Peer review |
|------|------|---------------|----------|-------------|
| Quick fix | <30 min | 1–3 | None | Optional |
| `/spec` | 30–90 min | 3–15 | File-based stamp | Per-phase cross-model via `/spec-review <ID> <phase>` |
| `/spec` (high-risk) | 1–6 h | Any | File-based stamp | Mandatory: ≥1 other model reviews **every** phase |

## Per-project spec folders

Specs live under each project, not here. Pattern:

```
{specs-root}/{ISSUE-ID}-{slug}/
```

`{specs-root}` is `specs.path` from the project's `.claude/project.json`, defaulting to `DocVault/specs` (resolution rule: `conventions.md` → Folder resolution).

## Tracking

- DEVS-7 — original issue for the /spec v0 build



/spec orchestrate... 
