---
name: start
description: >
  Lightweight session reorientation — queries SessionFlow transcripts and memory for recent session
  context, checks git state and active work (worktrees, stashes, open PRs including bot PRs,
  recent remote branches, version-lock claims), ranks open issues by state, priority and due
  date with children nested under their parent, and marks open handoffs. Use it
  for continuing same-day work or resuming after a short break.
  No indexing, no code search, no agent dispatch.
  Triggers: "start", "quick start", "resume", "orient me", "where were we".
library-version: a30d29ec7463
---

# Start

Lightweight session reorientation. Use this when you're continuing recent work and just
need to know where you left off — not when you need a full environment boot.

**Under 30 seconds.** No code indexing, no agent dispatch. One Bash sweep for active work,
one Plane list, and one parallel batch of SessionFlow calls (transcripts and memory). A search with a
query is reranked and takes a few seconds; run the calls together, not one after another.

> **Harness-neutral.** One master in `Devops/skill-library/skills/start/`, deployed to
> `.claude/skills/` (Claude Code) and `.agents/skills/` (Codex). Edit the master. MCP tool
> names below name capabilities; resolve the live identifier from your tool catalog
> (Claude Code: `ToolSearch`), since some prefixes are connection-specific.

---

### Step 0 — Verify project identity (MUST run first, blocking)

Read `.claude/project.json` (relative to cwd) with the file-read tool, and run:

```bash
pwd && git rev-parse --show-toplevel
```

If `.claude/project.json` is missing OR `pwd` differs from `git rev-parse --show-toplevel`
(e.g., launched from a subdir whose parent is a different git repo — common when a project
like Devops/ sits inside an outer workspace repo), STOP the flow and warn prominently.
Call the verified root `ROOT`; every later command anchors to it.


### Step 1 — Git state snapshot

If the harness injected a `gitStatus` block at session start (Claude Code does), read the
current branch, uncommitted changes, and last 5 commits from it — it is authoritative for
the **current checkout only**. Otherwise run:

```bash
cd "$ROOT" && git status --short && git branch --show-current && git log --oneline -10
```

Only reach for GitHub (`mcp__github__list_commits`) if the user asks to verify or you
suspect stale context after a force-push / external merge.

### Step 1b — Active work sweep (MUST run, every time)

The injected git block cannot see other worktrees, stashes, or work another harness or
machine pushed. Codex, another Claude account, or a cloud session may have work in flight
that never reached SessionFlow memory (no `/wrap` yet) and that the Step 3 keywords would not match.
Run this single Bash call:

```bash
cd "$ROOT" && {
git fetch --quiet --prune origin 2>/dev/null || echo "⚠ fetch failed — remote refs may be stale"
echo "== worktrees =="
git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r wt; do
  b=$(git -C "$wt" branch --show-current 2>/dev/null)
  d=$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  l=$(git -C "$wt" log -1 --format='%cr — %s' 2>/dev/null)
  echo "$wt | ${b:-detached} | dirty:$d | $l"
done
echo "== stashes =="; git stash list
echo "== recent remote branches =="
git for-each-ref --sort=-committerdate --format='%(committerdate:relative)|%(refname:short)|%(authorname)' refs/remotes/origin \
  | grep -vE '\|origin(/(HEAD|dev|main|master))?\|' | head -8
echo "== open PRs =="
case "$(git remote get-url origin 2>/dev/null)" in
  *github.com*)
    gh pr list --state open --limit 200 \
      --json number,title,headRefName,isDraft,updatedAt,author,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup \
      --jq '(.[] | "#\(.number) \(.headRefName) \(if .isDraft then "[draft] " else "" end)\(.title) — \(.author.login)\(if .author.is_bot then " [bot]" else "" end), \(.updatedAt[0:10]) | review:\(if (.reviewDecision // "") == "" then "none" else .reviewDecision end) merge:\(.mergeable)/\(.mergeStateStatus) checks:\([.statusCheckRollup[]? | if (.conclusion // "") != "" then .conclusion else (.state // .status) end] | group_by(.) | map("\(.[0])=\(length)") | join(","))"), (if length >= 200 then "⚠ 200 PRs listed: more may be open" else empty end)' \
      2>/dev/null || echo "⚠ gh unavailable" ;;
  *) echo "origin is not GitHub: no PRs to list" ;;
esac
echo "== version lock =="; [ -f devops/version.lock ] && cat devops/version.lock || echo none
}
```

`devops/version.lock` is the StakTrakr-style local claim file (gitignored); projects
without one print `none`. Repos on the home Gitea (Devops, HomeNetwork) have PRs switched off, so the PR
section prints one line and moves on.

Classify what it finds (cross-reference with the Plane `started` list from Step 2):

- **⚠ Active** — a non-main worktree that is dirty or committed in the last 24h; a remote
  branch or PR updated in the last 24h; an unexpired version-lock claim. Surface these at
  the TOP of the report — someone may be mid-task, so do not start overlapping work
  without asking.
- **Orphan** — worktree, stash, or branch with no matching open Plane issue and no PR.
- **Stale claim** — Plane issue `In Progress` / `In Review` with no worktree, branch, PR,
  or lock claim behind it. Report it as "likely stale"; do not change its state.
- **Pending PR** — every open PR, bot or human. Call a PR a merge candidate only when it shows
  `merge:MERGEABLE/CLEAN`: `CLEAN` means GitHub found every required check and review satisfied.
  `BLOCKED`, `UNSTABLE` or `BEHIND` means a required gate is not met even when the visible checks are
  green; name the state. `UNKNOWN` means GitHub has not computed it: report the merge state as unknown,
  not as ready. Bot PRs (Dependabot, Renovate: `[bot]` in the author) follow the same rule. Every
  pending PR goes into the **Before you start** list of the report, so the user clears or defers it
  before new work begins.

Match work to issues by issue ID in the branch name, PR title, last commit subject, or
lock claim (patch branches like `patch/3.36.46` usually carry the ID only in the PR title,
commit subject, or lock claim). Feed every issue ID found here into the Step 3 keywords.

### Step 2 — Open issues, ranked and nested

Fetch from Plane (all projects use Plane — `issuePrefix` and `plane.projectId` live in
`.claude/project.json`) in one call, server-sorted and trimmed:

```
mcp__plane__workitem(action: "list", project_id: "<uuid>", expand: "state",
  order_by: "-updated_at", per_page: 100,
  fields: "id,sequence_id,name,state,priority,updated_at,parent,target_date")
```

`parent` is the parent's UUID (or null). Keep the closed items of the page too: they resolve a parent
UUID to its `sequence_id`, name and state. When a parent is not on the page, fetch it with
`action: "retrieve"`. When `next_page_results` is true, read the next page with `cursor` before ranking.

> **Plane Community Edition limits (verified 2026-10-10):** `pql` is rejected (`"PQL and
> structured filters are not supported on this Plane edition"`, returned as a payload,
> not an error) and `action: "count"` returns HTTP 404 — filter client-side. `order_by`
> and the `fields` sparse fieldset DO work and cut the payload sharply; `fields` uses
> `state`, not `state_id`. Always pass `project_id` and `expand: "state"` (without it,
> `state` is a bare UUID; with it, each item carries `state.name` and `state.group`).
> Don't hedge ("likely closed") on issue status — read it.

From the results, client-side:

1. **Open set.** Keep state group ∈ `{backlog, unstarted, started}` plus any state named `In Review`.
   Match `In Review` by name: some projects put it in the `completed` group. Drop every other
   `completed` and `cancelled` item.
2. **In flight.** Every open issue whose group is `started` or whose state is `In Review`, whatever
   its age. These feed the Step 1b cross-reference.
3. **Rank each open issue** by these keys, in order:
   1. State tier: in flight (`started`, `In Review`) → `unstarted` (Todo) → `backlog`.
   2. Priority: `urgent` → `high` → `medium` → `low` → `none`.
   3. Due date: a `target_date` that is set and soonest first; a past date flags the line `overdue`.
   4. `updated_at`, newest first.
4. **Nest children under their parent.** An issue with a `parent` is listed under that parent, not
   on its own. A parent group ranks by the best rank among the parent (when it is open) and its open
   children, so a Todo child lifts a Backlog epic. Children inside a group follow the same rank order.
   A parent that is closed still heads its group, marked with its state, because its open children
   are still part of that work. Nest one level: a grandchild sits under its top open ancestor.
   An epic is a parent by convention (`[Epic]` or `Epic:` in the title, or any issue with children);
   Plane Community Edition has no work-item types, so do not rely on `type_id`.
5. **Show the top 5 groups.** Under each parent show up to 3 children and a `+N more` line for the
   rest. Count the other open issues in one closing line (`+N more open: X Todo, Y Backlog`).

Display:

```
- [<ID>] <title> — <state> · <priority>[ · due <date>][ · overdue] [🔁 handoff]
  - [<ID>] <child title> — <state> · <priority> [🔁 handoff]
```

The handoff marks come from Step 4 Pass 3; add them after that pass returns.

If `.claude/project.json` lacks the project UUID, resolve it via
`mcp__plane__project(action: "list")` and match on `identifier == issuePrefix`.
If Plane returns nothing or errors, note it briefly and move on.

### Step 3 — Build targeted keywords from Steps 1, 1b and 2

Before querying transcripts or memory, pick the focus from what you already learned:

- **Focus issues:** the in-flight issues (Step 1b, Step 2), then the top-ranked Todo issue. At most
  3. These get per-issue lookups with the `issue_id` filter in Step 4.
- **Topic query:** one or two issue IDs plus the distinct nouns from their titles, recent commit
  subjects and active branch names. Skip boilerplate (`docs:`, `fix:`, merge noise). A plain question
  works too: SessionFlow parses natural language and reranks the top results.

Example: `"DOCV-1 tag taxonomy dual-write"` or `"what is left on the DOCV-1 tag taxonomy?"`

Keep the query short. Do not list every open issue ID: earlier `/start` reports name all of them, so a
long ID list ranks those reports first. Do not add `handoff`: handoffs are typed memories now (Pass 3).

### Step 4 — Retrieve recent session context (multi-harness)

SessionFlow ingests multiple harness providers. Do not discover "last session" by reading
`~/.claude/projects/...` first; that only sees Claude Code CLI transcripts and misses
Codex, OpenCode, Antigravity, and any other provider SessionFlow has indexed.

**Pass 0 — provider inventory:**

Run in parallel with Pass 1 and Pass 3:

```
mcp__sessionflow__get_session_stats()
```

Use the provider list only as a coverage sanity check. Current known provider labels include
`claude_code_cli`, `codex`, `opencode`, `antigravity_cli`, and `antigravity_desktop`. Other
providers may appear over time. Claude Desktop / CoWork may be probe-only unless stats show
indexed turns for a provider; do not promise Desktop context if SessionFlow has not indexed it.

**Pass 1 — today's project-scoped, all-provider sweep:**

```
mcp__sessionflow__search_all_sessions(
  query="<topic query from Step 3>",
  project_root="<ROOT>",
  date_from="<today YYYY-MM-DD>",
  n=5
)
```

`sort_by` defaults to `hybrid`, and the reranker scores the top 10 rows, so keep `n` at 10 or below.
Omit `provider` so this searches every indexed harness. A filesystem path as `project_root` also covers
the repo's worktrees (the `Scope:` line lists them); `"*"` crosses projects and is only for broad
history questions.

**Pass 1b — latest turn per focus issue** (parallel, one call per focus issue):

```
mcp__sessionflow__search_all_sessions(
  issue_id="<ID>", project_root="<ROOT>", sort_by="recency", n=3, format="json"
)
```

This answers "when was this issue last touched, in which harness and branch" without a query. Ignore
the `[/start]` rows it returns (see the filters below) and keep the newest real working turn.

**Pass 2 — fallback (only if Pass 1 returns nothing):**

Fires when returning from a multi-day break and today's date filter is empty.

Reuse the **same topic query from Step 3** and drop `date_from` to widen the time window. Do not swap
in a generic query like `"last session wrap handoff next steps decisions"`: those words appear in
every earlier `/start` and `/wrap` report, so a boilerplate query ranks old boot reports first. Keep to
domain words (issue IDs, feature and file names) that appear only in real work.

```
mcp__sessionflow__search_all_sessions(
  query="<topic query from Step 3>",   # SAME as Pass 1, NOT boilerplate
  project_root="<ROOT>",
  n=5
)
```

If both keyword passes come back empty, omit `query` and pass `sort_by="recency"` to list the
project's most recent turns, newest first. A listing is not reranked.

**Pass 2a — unscoped Antigravity Desktop fallback (temporary):**

Use only when `get_session_stats()` shows `antigravity_desktop`, the normal project-scoped
passes miss expected Antigravity work, and today's workflow explicitly used Antigravity.
Some Desktop transcripts may be indexed with `project_root="unknown"` until SessionFlow's
desktop project-detection issue is fixed.

```
mcp__sessionflow__search_all_sessions(
  query="<targeted keyword string from Step 3>",
  project_root="*",
  date_from="<today YYYY-MM-DD>",
  provider="antigravity_desktop",
  n=3,
  sort_by="hybrid"
)
```

Label any results from this fallback as "unscoped Antigravity Desktop hits" rather than
normal project-scoped history. Do not use this broad search for every run; it is a last
coverage check until the MCP server assigns Desktop project roots correctly.

**Pass 2b — Claude-only exact-session fallback (optional):**

Only use this if the all-provider searches above miss an obviously relevant Claude Code CLI
handoff and you need to inspect the most recent prior Claude session directly. This is a
fallback, not the primary path:

```bash
ls -t ~/.claude/projects/<encoded-path>/*.jsonl | head -2 | tail -1
```

Then call `mcp__sessionflow__search_session(session_id="<uuid>", query="<targeted keyword string from Step 3>", n=5)`.

Merge all passes and filter:

- **Drop `/start` reports.** Skip a row whose user text is `[/start]` or whose reply opens with
  `## Session Start`. Each report names every open issue, so it matches any issue query and repeats
  stale state. `/wrap` reports stay: they record what a session finished.
- **Collapse duplicates.** Forked and resumed sessions copy turns under a new session ID. Keep one row
  per identical text, the newest.
- **Read passages whole.** A `turn_passage` row is one part of a long turn. Call `get_turns` with its
  `session_id` and `turn_index` when the part is not enough.
- Skip session IDs starting with `agent-a` (subagent dispatches and compaction blobs).

**Pass 3 — SessionFlow memory** (run in parallel with Pass 0+1):

Take `PROJECT` from the `project.json` read in Step 0: `memory.project` (default: `tag`,
lowercased). The session-start hook already printed the three newest session summaries. Run these in
parallel:

```
# a. Open handoffs: what a session left for the next one to pick up
mcp__sessionflow__list_memories(project=PROJECT, type="handoff", limit=20, format="json")

# b. Recent summaries; older wraps flag a handoff only in extra.handoff
mcp__sessionflow__list_memories(project=PROJECT, type="session-summary", limit=8, format="json")

# c. Per focus issue: the summaries, decisions and handoffs that name it
mcp__sessionflow__search_memories(query="<issue title>", project=PROJECT, issue_id="<ID>", n=3,
                                  format="json")

# d. The topic query, for decisions that name no issue
mcp__sessionflow__search_memories(query="<topic query from Step 3>", project=PROJECT, n=5,
                                  format="json")
```

`list_memories` and `search_memories` return only `active` records, so a handoff that a later
`/wrap` superseded drops out. Map each handoff to issues by `extra.issues`, then by `issue_ids`:

- **Issue handoff:** one issue in `extra.issues`. Mark that issue's line `🔁 handoff`.
- **Chain handoff:** `extra.chain` names a parent or epic, or `extra.issues` holds several issues
  under one parent. Mark the parent line `🔁 chain handoff (<n> issues)` and each listed child.
- **Legacy flag:** a session summary from (b) with `extra.handoff: true` and no newer summary for
  the same issues counts as an issue handoff.

A handoff whose issues are all closed in Plane is stale: list it under **Before you start** as
"handoff on a closed issue" instead of marking a line.

> **Never filter on `agent_id`.** It names the harness that wrote the record
> (`claude-code`, `codex`, …), and `/start` must see every harness's handoffs.

When a hit needs its session, call `mcp__sessionflow__get_memory_context(memory_id, project=PROJECT)`
instead of searching transcripts again.

Merge with the transcript findings — memory adds `/wrap` session summaries, decisions and handoffs.

**Degradation:** SessionFlow serves both transcripts and memory, so check which part failed. A
`memory_unavailable` error means the memory store has not started: warn
`⚠ SessionFlow memory unavailable — context from transcripts only` and continue. If the whole
server is unreachable, use the summaries the session-start hook printed (they may be from its
cache; it says so) and note it.


## Output Format

Print a compact orientation report. Omit the `⚠ Active Work` callout when Step 1b found
nothing active.

```
## Session Start — <ProjectName> (<date>)

> ⚠ **Active work detected:** <one line per Active item — what, where, how recent>

---

### Git State
- **Branch:** <current branch>
- **Recent commits:** <last 3-5, one-liners>
- **Uncommitted:** <count or "clean">

---

### Active Work
- **Worktrees:** <non-main worktrees with branch, dirty count, last commit age — or "main checkout only">
- **Open PRs:** <#n branch title (age) — or "none">
- **Remote branches:** <recent non-dev/main branches without a PR — or "none">
- **Stashes / lock claims:** <list or "none">
- **Stale claims:** <Plane In Progress / In Review with nothing behind them — or "none">

---

### Open Issues (ranked)
- [<ID>] <title> — In Progress · high [🔁 handoff]
- [<ID>] [Epic] <title> — Backlog · medium [🔁 chain handoff (2 issues)]
  - [<ID>] <child title> — Todo · high [🔁 handoff]
  - [<ID>] <child title> — Backlog · low
  - +N more
- [<ID>] <title> — Todo · medium · due <date>
- ...
- +N more open: X Todo, Y Backlog

---

### Before you start
- <PR #n (bot) title: checks green, merge candidate | checks failing: look first>
- <PR #n title: approved, waiting on a merge | review requested>
- <stale claim, orphan worktree, handoff on a closed issue>

Omit this section when nothing is pending.

---

**Handoff:** <each open handoff: issue or chain, first action, gotchas, from which session and harness — omit if none>

---

### Suggested next
<One or two lines: the top item of Before you start when one exists, else the open handoff, else the
top-ranked issue. A suggestion, not a decision: the user picks.>

---

### Last Session
<3-5 sentence recap synthesized from SessionFlow turns and memories — what was worked on, decisions made, next steps>

---
```
