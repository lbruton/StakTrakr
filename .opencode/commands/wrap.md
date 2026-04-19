---
description: "End-of-session orchestrator — writes session digest to DocVault and saves summary to mem0. Run after /retro."
---

End-of-session wrap for this project. Run autonomously — no permission needed between steps.

## Flow

1. Detect project: `basename $(git rev-parse --show-toplevel)`
2. Check git state: `git status --short`, `git log --oneline -10`, `git worktree list`
3. Identify session work: commits made, PRs opened/merged, issues closed
4. Write session digest to `DocVault/Daily Digests/{Project}/{YYYY-MM-DD}.md`
5. Save curated summary to mem0 via `add_memory`

## Digest Template

```markdown
## HH:MM — {Agent} ({Model})

### Summary

{2-3 paragraph summary of session work}

### Retro Lessons

{from /retro if run, or extract inline}

### Git State

- **Branch:** {current}
- **Session commits:** {count} — {short hashes}
- **Session PRs:** {#NNN STATUS}
- **Worktrees:** {count}
- **Uncommitted at wrap:** {files or "clean"}

### Session Health {emoji}

{warnings about uncommitted changes, stale worktrees, pending deploys}

### Next Session

{what to do next — concrete, actionable}
```

## Rules

- Append to existing daily digest file (multiple sessions per day)
- Session health: green = clean, yellow = warnings, red = blockers
- If /retro was NOT run before /wrap, extract retro lessons inline
- Save to mem0 with tags: project, session-digest, date

$ARGUMENTS
