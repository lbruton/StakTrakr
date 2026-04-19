---
name: gsd
description: "Get Shit Done — casual worktree session for minor fixes, CSS tweaks, syntax corrections, and small improvements that don't need a spec or version bump. Opens a worktree, free-form build/fix, PR as chore."
user-invocable: true
allowed-tools: >-
  Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion,
  mcp__claude-context__search_code,
  mcp__code-graph-context__find_code,
  mcp__mem0__search_memories,
  mcp__mem0__add_memory
---

# GSD — Get Shit Done Mode

## Purpose

Casual, free-form work session for minor fixes and tweaks that don't warrant a Linear issue, spec, or version bump. You and the user bounce ideas, find problems, fix them, and commit — all in an isolated worktree that PRs to `dev` as a chore.

**This is the exception path.** It deliberately skips these gates:

- No Linear issue required
- No spec workflow
- No version bump
- No wiki update (unless the user asks)

**Still enforced:**

- Worktree isolation (never edit `dev` or `main` directly)
- PR to `dev` (protected branch enforces this)
- Descriptive commit messages

---

## When to Use GSD vs Other Paths

| Work                                 | Path                             |
| ------------------------------------ | -------------------------------- |
| CSS fix, padding, colors, font sizes | `/gsd`                           |
| Typo or copy correction              | `/gsd`                           |
| Small syntax/logic cleanup           | `/gsd`                           |
| Adjusting a threshold or constant    | `/gsd`                           |
| Fixing a tooltip or label            | `/gsd`                           |
| New feature or capability            | `/brainstorming` → `/spec`       |
| Bug with unknown root cause          | `systematic-debugging` → `/spec` |
| Anything needing a version bump      | `/release patch`                 |

**Rule of thumb:** If you can describe the change in one sentence and it touches fewer than ~5 files, it's GSD territory.

---

## Step 1: Open Worktree

Create a dated GSD worktree off `dev`:

```bash
# Ensure dev is up to date
git fetch origin dev
git pull origin dev

# Create worktree
BRANCH="gsd/$(date +%Y-%m-%d)"
git worktree add ".worktrees/$BRANCH" -b "$BRANCH" dev
cd ".worktrees/$BRANCH"
```

If a `gsd/YYYY-MM-DD` branch already exists (resuming a session from today), just `cd` into the existing worktree:

```bash
cd ".worktrees/gsd/$(date +%Y-%m-%d)"
```

Confirm to the user:

```
## GSD Mode Active

Worktree: .worktrees/gsd/YYYY-MM-DD
Branch:   gsd/YYYY-MM-DD
Base:     dev

Ready to work. What's bugging you?
```

---

## Step 2: Free-Form Work

This is conversational. The user describes what they want fixed or tweaked, you find the code, fix it, and commit. Repeat.

### Guidelines

- **Read before editing** — always read the file first, even for "obvious" fixes
- **Small commits** — commit after each logical fix, not in one big batch
- **Commit message format:**
  ```
  chore: {short description of what was fixed}
  ```
  Examples:
  - `chore: fix modal header padding on mobile`
  - `chore: correct typo in about dialog version label`
  - `chore: adjust spot price stale threshold from 60 to 75 minutes`
  - `chore: remove unused CSS class .legacy-badge`
- **No feature work** — if the conversation drifts toward something that needs a spec, pause and say so:
  ```
  This is starting to feel like feature work — it'll touch N files and change
  behavior. Want to keep going here, or spin up a /brainstorming session for it?
  ```
- **Search the codebase** — use claude-context, CGC, or Grep/Glob as needed to find the right code. Don't guess file locations.

---

## Step 3: Wrap Up and PR

When the user is done (or says "let's ship it", "that's good", "wrap it up", etc.):

### 3a. Review changes

```bash
git diff --stat dev
```

Show the user what was changed.

### 3b. Push and create PR

```bash
git push -u origin gsd/YYYY-MM-DD
```

Create a draft PR to `dev`:

```bash
gh pr create \
  --base dev \
  --title "chore: GSD session YYYY-MM-DD" \
  --body "$(cat <<'EOF'
## GSD Session — Minor Fixes & Tweaks

### Changes
{bullet list of each commit's description}

### Notes
- No version bump — rolls into next patch release
- No Linear issue — casual fixes below spec threshold
EOF
)" \
  --draft
```

### 3c. Confirm

```
## GSD PR Created

PR:      #NNN — chore: GSD session YYYY-MM-DD
Branch:  gsd/YYYY-MM-DD → dev
Commits: N changes across M files

No version bump needed — these will roll into the next /release patch.

To finalize: review the PR, let Codacy scan, then merge.
To continue working: just keep going, push, and the PR updates.
```

---

## Cleanup

After the PR merges, clean up the worktree:

```bash
cd /Volumes/DATA/GitHub/StakTrakr
git worktree remove .worktrees/gsd/YYYY-MM-DD
git branch -d gsd/YYYY-MM-DD
```

---

## Key Principles

- **Low ceremony, high velocity** — the whole point is to skip the overhead
- **Isolation without friction** — worktree keeps dev clean, PR is the merge mechanism
- **Know when to stop** — if it's getting big, suggest the spec path
- **Descriptive commits** — since there's no Linear issue, the commit messages ARE the documentation
