---
name: start-patch
description: Use when starting a new patch session and needing to pick a Plane issue to work on before claiming a version lock and creating a worktree.
user-invocable: true
---

# Start Patch

Rapid session-start triage: fetch Plane issues, rank by priority + session continuity, let the user pick, then hand off to `release patch` for lock + worktree creation.

**Does NOT:** read CHANGELOG, constants, or the full codebase. That's `/prime`.
**Does NOT:** claim a version lock or create a worktree. That's `/release patch`.

---

## Step 0: Project Detection

Read `.codex/project.json` (in the current working directory):

```bash
cat .codex/project.json
```

Extract:

- `plane.projectId` → used for Plane queries (referred to below as `<plane_project_id>`)
- `name` → display label

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

Use the Plane MCP project ID from `.codex/project.json` (`plane.projectId`). This needs **two** calls —
Pass `expand: "state"` so each issue carries `state.name` and `state.group` (without it,
`state` is a bare UUID string). Always pass `project_id` and never pass `pql` — Community
Edition returns an `{"error": ...}` payload instead of results.

```text
mcp__plane__workitem(action: "list", project_id: "<plane_project_id>", expand: "state", per_page: 100)
```

Priority is a plain string (`urgent`, `high`, `medium`, `low`, `none`).

Filter out completed and cancelled states, then keep In Progress, Todo, and Backlog items.
Do not query Linear and do not read DocVault issue files for active work.

### mem0 — session continuity

Resolve the hosted `search_memories` tool dynamically from the current catalog.
Use `user_id: lbruton` and `metadata.project: staktrakr` filters; never filter on
`agent_id`. Run one project-scoped query for recent handoffs and one user-only
query for cross-project workflow decisions. Match the current tool schema.
Do not retry an HTTP 429 or quota-exceeded response.

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

The release skill takes full ownership from here — sync gate, lock claim, worktree, version bump, PR.

The release skill does **not** refresh the spot bundle. Run `/update-spot-bundle` before the version-bump PR is opened, then copy the refreshed bundle and year JSON files into the worktree and stage them — see "Spot Bundle" in `.context/git-topology.md`.

---

## What This Skill Does NOT Do

- No CHANGELOG read (that's `/prime`)
- No full codebase index (that's `/prime`)
- No mem0 log/save (that's `/prime` or `/save-insights`)
- No Phase 1–5 of the release workflow (that's `/release`)
- No worktree or lock logic — delegates entirely to `release patch`
