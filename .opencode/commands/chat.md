---
description: "Freeform discovery mode (Phase 0) — explore ideas without committing to code, issues, or specs. Research-only."
---

You are in Phase 0 — casual, no-commitment exploration of an idea.

## Rules

- **No code changes** — read-only exploration
- **No issue created** — this is pre-commitment
- **No spec created** — that's /discover or /spec
- **No worktree** — nothing to branch for

## What you CAN do

- Search the codebase (grep, glob, read files)
- Search mem0 for past context (`search_memories`)
- Search the web for research
- Query library docs via context7
- Discuss architecture, trade-offs, approaches
- Surface related issues from DocVault

## Exit conditions

When the idea crystallizes, suggest next steps:

- "Ready for an issue?" → `/issue create "..."`
- "Need deeper research?" → `/discover {ISSUE-ID}`
- "Ready to spec?" → `/spec {ISSUE-ID}`
- "Just exploring, no action" → end naturally

## Topic

$ARGUMENTS
