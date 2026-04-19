---
description: "Get Shit Done — casual worktree session for minor fixes that don't need a spec or version bump. Opens branch, fix, PR as chore."
---

GSD mode. Quick fix, no ceremony.

## Setup

1. Create branch: `git checkout -b gsd/$(date +%Y-%m-%d)`
2. If branch exists, use: `gsd/$(date +%Y-%m-%d)-2` (increment suffix)

## Rules

- No issue required (unless user provides one)
- No spec required
- No version bump (test-only or chore changes)
- Commit with `chore:` or `fix:` prefix
- Draft PR targeting `dev` (not main)
- Keep it small — if scope grows, suggest /issue + /spec instead

## When done

1. Stage changed files (specific names, not `git add -A`)
2. Commit with descriptive message
3. Push branch
4. Create draft PR targeting `dev`

## Task

$ARGUMENTS
