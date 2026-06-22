---
name: start-patch
description: Use when starting a new patch session and needing to pick a Plane issue to work on before claiming a version lock and creating a worktree.
user-invocable: true
allowed-tools: Bash, Read, mcp__mem0__search_memories, mcp__plane__list_project_issues, mcp__plane__list_states
---

# Start Patch

Rapid session-start triage: fetch Plane issues, rank by priority + session continuity, let the user pick, then hand off to `release patch` for lock + worktree creation.

**Does NOT:** read CHANGELOG, constants, or the full codebase. That's `/prime`.
**Does NOT:** claim a version lock or create a worktree. That's `/release patch`.

---

## Step 0: Project Detection

Read `.Codex/project.json` and `.specflow/config.json` (in the current working directory):

```bash
cat .Codex/project.json
cat .specflow/config.json
```

Extract:

- `plane_project_id` from `.specflow/config.json` → used for Plane queries
- `name` from `.Codex/project.json` → display label

Also capture git state:

```bash
git branch --show-current
cat devops/version.lock 2>/dev/null || echo "UNLOCKED"
```

---

## Step 1: Parallel Fetch (~10 seconds)

Run ALL of the following in parallel — do not wait for one before starting another.

### Git sync check

```bash
git fetch origin
git rev-list HEAD..origin/dev --count
git log --oneline -5
git status --short
```

### Plane query

Use the Plane MCP project ID from `.specflow/config.json`. This needs **two** calls —
`list_project_issues` returns each issue's state as a bare UUID with `name: null` (the
MCP never populates the state name in either list or single-issue responses), so the
human-readable state name has to come from a separate `list_states` join.

```text
mcp__plane__list_states(project_id: "<plane_project_id>")
mcp__plane__list_project_issues(project_id: "<plane_project_id>")
```

Build a `{state_id → state_name}` map from `list_states` once, then resolve each issue's
`state.id` against it to recover the readable state (`In Progress`, `Todo`, `Backlog`, …).
Priority needs no such join — it already comes back readable on `priority.id` (`urgent`,
`high`, `medium`, `low`, `none`).

Filter out completed and canceled states, then keep In Progress, Todo, and Backlog items.
Do not query Linear and do not read DocVault issue files for active work.

### mem0 — session continuity

```text
mcp__mem0__search_memories
  query: "recent session handoff in progress"
  filters: { "AND": [{ "agent_id": "<project agent_id>" }] }
  limit: 5
```

Note which issue IDs appear in the mem0 results — these get a continuity boost in ranking.

---

## Step 2: Rank & Display

### Lock and sync warnings (surface FIRST, before the table)

**If `devops/version.lock` exists with active (non-expired) claims:**

```text
⚠️  Active version claims:
    - v3.32.29 — Codex / STRK-315 (expires 10:30Z)
    - v3.32.30 — user / hotfix (expires 10:35Z)
    Next available version: v3.32.31
    (Claims expire after 30 min and are pruned automatically on next lock read.)
```

**If local branch is behind origin/dev (rev-list count > 0): HARD STOP before showing table:**

```text
⛔ Local dev is N commits behind origin/dev.

Run: git pull origin dev
Then re-run /start-patch.
```

Do not display the issue table. Stop here and wait for the user.

### Ranking algorithm (4-tier)

Apply in order — within each tier, use Plane priority as the tiebreaker (urgent > high > medium > low):

| Tier        | Criteria                                          |
| ----------- | ------------------------------------------------- |
| 1 (highest) | State = "In Progress"                             |
| 2           | In current active cycle (if cycle data available) |
| 3           | State = "Todo" or "Backlog", priority Urgent/High |
| 4           | Lower priority or no cycle membership             |

**mem0 boost:** Any issue found in mem0 recent-session results moves up +1 within its tier (stays within tier boundaries — a Tier 3 issue can't become Tier 1).

### Display table

```text
## [ProjectName] — Session Candidates  (YYYY-MM-DD)

 #  │ Issue    │ Title                          │ State       │ Priority │ Notes
────┼──────────┼────────────────────────────────┼─────────────┼──────────┼───────────────
 1  │ STRK-183 │ Configurable vault timeout     │ In Progress │ high     │ 🔄 In Progress
 2  │ STRK-199 │ API health badge               │ Todo        │ high     │ 📅 In cycle
 3  │ STRK-201 │ Memory sync command            │ Todo        │ medium   │ 🧠 mem0 recent
 4  │ STRK-155 │ Mobile layout fixes            │ Backlog     │ high     │
 5  │ STRK-177 │ Retail price confidence UI     │ Backlog     │ medium   │

Version lock: UNLOCKED  |  Branch: dev  |  Sync: ✅ up to date
```

Notes legend:

- `🔄 In Progress` — Plane state is In Progress
- `📅 In cycle` — issue is in the active Plane cycle
- `🧠 mem0 recent` — appeared in mem0 session-continuity results
- (blank) — no special signal

Limit the table to **10 rows maximum.** If more issues qualify, show the top 10 and note how many were omitted.

---

## Step 3: User Picks Issue(s)

Ask:

```text
Which issue(s) will we work on? (Enter number(s), e.g. `1` or `1,3`)
```

Wait for the user's selection.

Once selected, display a brief confirmation:

```text
Selected:
  1. STRK-183 — Configurable vault timeout
  3. STRK-201 — Memory sync command

Invoking release patch to claim version lock and create worktree...
```

---

## Step 4: Handoff to Release Skill

Invoke the `release` skill with `patch` as the argument. Pass the selected issue title(s) as context so the release skill's Step 1 ("determine what's being released") is pre-populated.

```text
Skill tool: skill="release", args="patch"
```

Pre-populate Step 1 context for the release skill:

```text
Context from /start-patch:
  Working on: STRK-183 — Configurable vault timeout
              STRK-201 — Memory sync command
```

The release skill takes full ownership from here — sync gate, lock claim, worktree, seed-sync, version bump, PR.

---

## What This Skill Does NOT Do

- No CHANGELOG read (that's `/prime`)
- No full codebase index (that's `/prime`)
- No mem0 log/save (that's `/prime` or `/save-insights`)
- No Phase 1–5 of the release workflow (that's `/release`)
- No worktree or lock logic — delegates entirely to `release patch`
