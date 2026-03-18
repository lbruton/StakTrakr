---
name: start-patch
description: Use when starting a new patch session and needing to pick a Linear issue to work on before claiming a version lock and creating a worktree.
user-invocable: true
allowed-tools: Bash, Read, mcp__infisical__get-secret, mcp__mem0__search_memories
---

# Start Patch

Rapid session-start triage: fetch Linear issues, rank by priority + session continuity, let the user pick, then hand off to `release patch` for lock + worktree creation.

**Does NOT:** read CHANGELOG, constants, or the full codebase. That's `/prime`.
**Does NOT:** claim a version lock or create a worktree. That's `/release patch`.

---

## Step 0: Project Detection

Read `.claude/project.json` (in the current working directory):

```bash
cat .claude/project.json
```

Extract:
- `linearTeamId` → used for all Linear queries
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

### Linear query (single GraphQL call replaces 3 MCP calls)

Fetch the API key from Infisical:
```
mcp__infisical__get-secret(secretName: "LINEAR_API_KEY", environmentSlug: "dev", projectId: "319a1db5-207d-49d0-a61d-3f3e6b440ded")
```

Then run a single query that returns In Progress, Todo, and Backlog issues:

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(cat <<'GRAPHQL'
{"query": "{ team(id: \"<TEAM_ID>\") { issues(filter: { state: { type: { nin: [\"completed\", \"canceled\"] } } }, orderBy: priority, first: 50) { nodes { identifier title priority state { name type } assignee { name } labels { nodes { name } } createdAt } } }"}
GRAPHQL
)"
```

> Linear priority values: 1 = Urgent, 2 = High, 3 = Medium, 4 = Low.

### mem0 — session continuity

```
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
```
⚠️  Active version claims:
    - v3.32.29 — claude / STAK-315 (expires 10:30Z)
    - v3.32.30 — user / hotfix (expires 10:35Z)
    Next available version: v3.32.31
    (Claims expire after 30 min and are pruned automatically on next lock read.)
```

**If local branch is behind origin/dev (rev-list count > 0): HARD STOP before showing table:**
```
⛔ Local dev is N commits behind origin/dev.

Run: git pull origin dev
Then re-run /start-patch.
```
Do not display the issue table. Stop here and wait for the user.

### Ranking algorithm (4-tier)

Apply in order — within each tier, use Linear priority as the tiebreaker (Urgent > High > Medium > Low):

| Tier | Criteria |
|------|----------|
| 1 (highest) | State = "In Progress" |
| 2 | In current active cycle (if cycle data available) |
| 3 | State = "Todo" or "Backlog", priority Urgent/High |
| 4 | Lower priority or no cycle membership |

**mem0 boost:** Any issue found in mem0 recent-session results moves up +1 within its tier (stays within tier boundaries — a Tier 3 issue can't become Tier 1).

### Display table

```
## [ProjectName] — Session Candidates  (YYYY-MM-DD)

 #  │ Issue    │ Title                          │ State       │ Priority │ Notes
────┼──────────┼────────────────────────────────┼─────────────┼──────────┼───────────────
 1  │ STAK-183 │ Configurable vault timeout     │ In Progress │ High     │ 🔄 In Progress
 2  │ STAK-199 │ API health badge               │ Todo        │ High     │ 📅 In cycle
 3  │ STAK-201 │ Memory sync command            │ Todo        │ Medium   │ 🧠 mem0 recent
 4  │ STAK-155 │ Mobile layout fixes            │ Backlog     │ High     │
 5  │ STAK-177 │ Retail price confidence UI     │ Backlog     │ Medium   │

Version lock: UNLOCKED  |  Branch: dev  |  Sync: ✅ up to date
```

Notes legend:
- `🔄 In Progress` — Linear state is In Progress
- `📅 In cycle` — issue is in the active Linear cycle
- `🧠 mem0 recent` — appeared in mem0 session-continuity results
- (blank) — no special signal

Limit the table to **10 rows maximum.** If more issues qualify, show the top 10 and note how many were omitted.

---

## Step 3: User Picks Issue(s)

Ask:

```
Which issue(s) will we work on? (Enter number(s), e.g. `1` or `1,3`)
```

Wait for the user's selection.

Once selected, display a brief confirmation:

```
Selected:
  1. STAK-183 — Configurable vault timeout
  3. STAK-201 — Memory sync command

Invoking release patch to claim version lock and create worktree...
```

---

## Step 4: Handoff to Release Skill

Invoke the `release` skill with `patch` as the argument. Pass the selected issue title(s) as context so the release skill's Step 1 ("determine what's being released") is pre-populated.

```
Skill tool: skill="release", args="patch"
```

Pre-populate Step 1 context for the release skill:

```
Context from /start-patch:
  Working on: STAK-183 — Configurable vault timeout
              STAK-201 — Memory sync command
```

The release skill takes full ownership from here — sync gate, lock claim, worktree, seed-sync, version bump, PR.

---

## What This Skill Does NOT Do

- No CHANGELOG read (that's `/prime`)
- No full codebase index (that's `/prime`)
- No mem0 log/save (that's `/prime` or `/save-insights`)
- No Phase 1–5 of the release workflow (that's `/release`)
- No worktree or lock logic — delegates entirely to `release patch`
