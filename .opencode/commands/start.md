---
description: "Lightweight session reorientation — reads last digest, checks git state, surfaces open issues. Fast alternative to /prime."
---

Quick session reorientation. Under 15 seconds. No MCP calls, no indexing.

## Run in parallel

### 1. Last session digest

```bash
PROJECT=$(basename $(git rev-parse --show-toplevel))
ls -t "/Volumes/DATA/GitHub/DocVault/Daily Digests/$PROJECT/"*.md 2>/dev/null | head -1
```

Read the most recent entry. Show Summary and Next Session.

### 2. Git state

```bash
git status --short
git branch --show-current
git log --oneline -10
git worktree list
```

### 3. Open issues (5 most recent)

```bash
grep -rl 'status:.*\(backlog\|todo\|in-progress\|in-review\)' "/Volumes/DATA/GitHub/DocVault/Projects/$PROJECT/Issues" 2>/dev/null | grep -v _Index | xargs ls -t 2>/dev/null | head -5
```

## Output format

Compact report: last session summary, git state (branch, recent commits, uncommitted, worktrees), open issues list. Under 50 lines.

$ARGUMENTS
