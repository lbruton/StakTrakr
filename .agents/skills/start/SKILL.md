---
name: start
description: >
  Lightweight session reorientation — queries sessionflow + mem0 for recent session
  context, checks git state and active work (worktrees, stashes, open PRs, recent remote
  branches, version-lock claims), and surfaces the 5 most recent open issues. Use it
  for continuing same-day work or resuming after a short break.
  No indexing, no code search, no agent dispatch.
  Triggers: "start", "quick start", "resume", "orient me", "where were we".
library-version: b9ae376f5f2b
---

# Start

Lightweight session reorientation. Use this when you're continuing recent work and just
need to know where you left off — not when you need a full environment boot.

**Under 15 seconds.** No code indexing, no agent dispatch. One Bash sweep for active work,
one Plane list, and two fast memory calls (sessionflow + mem0).

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
that never reached mem0 (no `/wrap` yet) and that the Step 3 keywords would not match.
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
gh pr list --state open --limit 20 --json number,title,headRefName,isDraft,updatedAt,author \
  --jq '.[] | "#\(.number) \(.headRefName) \(if .isDraft then "[draft] " else "" end)\(.title) — \(.author.login), \(.updatedAt)"' 2>/dev/null || echo "⚠ gh unavailable"
echo "== version lock =="; [ -f devops/version.lock ] && cat devops/version.lock || echo none
}
```

`devops/version.lock` is the StakTrakr-style local claim file (gitignored); projects
without one print `none`.

Classify what it finds (cross-reference with the Plane `started` list from Step 2):

- **⚠ Active** — a non-main worktree that is dirty or committed in the last 24h; a remote
  branch or PR updated in the last 24h; an unexpired version-lock claim. Surface these at
  the TOP of the report — someone may be mid-task, so do not start overlapping work
  without asking.
- **Orphan** — worktree, stash, or branch with no matching open Plane issue and no PR.
- **Stale claim** — Plane issue `In Progress` / `In Review` with no worktree, branch, PR,
  or lock claim behind it. Report it as "likely stale"; do not change its state.
- **Bot** — Dependabot/Renovate PRs: list them in one line; they still need a decision.

Match work to issues by issue ID in the branch name, PR title, last commit subject, or
lock claim (patch branches like `patch/3.36.46` usually carry the ID only in the PR title,
commit subject, or lock claim). Feed every issue ID found here into the Step 3 keywords.

### Step 2 — Open issues

Fetch from Plane (all projects use Plane — `issuePrefix` and `plane.projectId` live in
`.claude/project.json`) in one call, server-sorted and trimmed:

```
mcp__plane__workitem(action: "list", project_id: "<uuid>", expand: "state",
  order_by: "-updated_at", per_page: 100,
  fields: "id,sequence_id,name,state,priority,updated_at")
```

> **Plane Community Edition limits (verified 2026-10-10):** `pql` is rejected (`"PQL and
> structured filters are not supported on this Plane edition"`, returned as a payload,
> not an error) and `action: "count"` returns HTTP 404 — filter client-side. `order_by`
> and the `fields` sparse fieldset DO work and cut the payload sharply; `fields` uses
> `state`, not `state_id`. Always pass `project_id` and `expand: "state"` (without it,
> `state` is a bare UUID; with it, each item carries `state.name` and `state.group`).
> Don't hedge ("likely closed") on issue status — read it.

From the results, client-side:

1. **Top 5 recent** — state group ∈ `{backlog, unstarted, started}` plus the state named
   `In Review`; exclude `Done` and `Cancelled`. Already sorted; take the first 5.
2. **In flight** — every issue whose group is `started` or whose state is `In Review`,
   regardless of age. These feed the Step 1b cross-reference.

Display as: `[<PREFIX>-<seq>] <title> — <state-name>`

If `.claude/project.json` lacks the project UUID, resolve it via
`mcp__plane__project(action: "list")` and match on `identifier == issuePrefix`.
If Plane returns nothing or errors, note it briefly and move on.

### Step 3 — Build targeted keywords from Steps 1, 1b and 2

Before querying sessionflow or mem0, extract 3-5 keywords from what you already learned:

- **Issue IDs** from active work (Step 1b) first, then open issues
- **Key terms** from issue titles (e.g. `tag taxonomy`, `dual-write`, `frontmatter`)
- **Distinct words** from recent commit messages and active branch names — skip boilerplate (`docs:`, `fix:`, `issue(...)`, merge noise); keep nouns and feature names
- Always append: `handoff` (catches /wrap session summaries and handoffs regardless of topic)

Compose a targeted query string: `"<issue-id> <key-term> <commit-keyword> handoff"`

Example: `"DOCV-1 tag taxonomy tag-normalize dual-write handoff"`

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
  query="<targeted keyword string from Step 3>",
  project_root="<ROOT>",
  date_from="<today YYYY-MM-DD>",
  n=5,
  sort_by="hybrid"
)
```

> **Required param gotcha (2026-09-17):** `sort_by` is non-optional in the
> current SessionFlow MCP schema — omitting it returns an `invalid_type`
> validation error. Always pass `"hybrid"` (the default behavior) explicitly.

Omit `provider` for the normal `/start` flow so this searches every indexed harness for the
current project. Use a provider filter only when diagnosing coverage for one harness.

> **Verified 2026-05-23:** Filesystem path works correctly as `project_root`. Using `"*"`
> intentionally crosses projects and is only for broad workflow/history investigations.

**Pass 2 — fallback (only if Pass 1 returns nothing):**

Fires when returning from a multi-day break and today's date filter is empty.

Reuse the **same targeted keyword string from Step 3** — just drop `date_from` to widen
the time window. Do NOT swap in a generic query like `"last session wrap retro handoff
next steps decisions"`: those words appear verbatim in every prior boot transcript and in
the `/start`/`/prime` SKILL.md text captured into transcripts, so a boilerplate query
returns Relevance-1.00 skill-definition dumps and stale boot rituals instead of real work.
Keep querying with domain vocabulary (issue IDs, feature/file names) that only appears in
actual work.

```
mcp__sessionflow__search_all_sessions(
  query="<targeted keyword string from Step 3>",   # SAME as Pass 1, NOT boilerplate
  project_root="<ROOT>",
  n=3,
  sort_by="hybrid"
)
```

Still omit `provider` so the fallback remains cross-harness.

If both keyword passes come back empty, omit `query` and pass `sort_by="recency"` to list
the project's most recent turns, newest first (SESF-16; streamed since SESF-36, so it no
longer hits the Milvus "query results exceed the limit size" error). Listing rows show
`Relevance: 0.00` because nothing was matched, not because the call failed (SESF-68
tracks hiding it).

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

Merge all passes, deduplicate by session ID + provider + turn index. Skip any session ID
starting with `agent-a` — subagent dispatches and context compaction blobs. Prefer
UUID-format session IDs, but keep non-Claude provider IDs when SessionFlow returns them with
a valid `provider` label.

**Pass 3 — mem0** (run in parallel with Pass 0+1):

Take `USER` and `PROJECT` from the `project.json` read in Step 0 (DEVS-92 standard):
`USER = mem0.userId` (default `"lbruton"`), `PROJECT = mem0.project` (default: `tag`,
lowercased).

> mem0's live tool prefix is connection-specific (`mcp__<connector-id>__*`), not a fixed
> `mcp__mem0__`. Resolve `search_memories` from the tool catalog (Claude Code:
> `ToolSearch({query: "select:search_memories"})`) and use the identifier it returns.

```
search_memories(
  query="<targeted keyword string from Step 3>",
  top_k=10,
  filters={"AND": [{"user_id": USER}, {"metadata": {"project": PROJECT}}]}
)
```

> **Never filter on `agent_id`.** It names the harness that wrote the record
> (`claude-code`, `codex`, …), and `/start` must see every harness's handoffs.

> **Param shape (verified 2026-09-29, hosted connector DEVS-94):** the result count is
> `top_k`, not `limit`, and there is no `enable_graph` param. Always pass `filters` with
> at least a `user_id` clause. If the live schema differs, follow the live schema, not
> this doc.

> **Quota:** mem0 allows 1,000 retrieval calls per month across every harness. On a
> 429 / "quota exceeded", don't retry — print `⚠ mem0 read quota exhausted — context
> from sessionflow only` and continue.

Merge with sessionflow findings — mem0 adds `/wrap` session summaries, decisions and handoffs.

**Degradation:** If sessionflow unreachable, use mem0 only + warn:
`⚠ sessionflow unavailable — context from mem0 only`.
If both unavailable, note it and continue.


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

### Open Issues (5 most recent)
- [<ID>] <title> — <status>
- [<ID>] <title> — <status>
- ...

---

**Handoff:** <Any handoff/next-session items surfaced from sessionflow or mem0 — omit if none>

---

### Last Session
<3-5 sentence recap synthesized from sessionflow turns + mem0 memories — what was worked on, decisions made, next steps>

---
```
