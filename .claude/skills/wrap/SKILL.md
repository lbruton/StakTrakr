---
name: wrap
description: >
  End-of-session orchestrator — verifies session work, saves ONE detailed session summary to
  SessionFlow memory (the big-picture record), writes day-to-day lessons to local memory and durable
  facts to .context/, syncs docs, and reports Session Health. Run at end of any session, optionally after
  /pr-cleanup. Triggers: "wrap", "wrap up", "close session", "end of session",
  "done for the night", "finish up", "closing time".
library-version: 8cb423b84b38
---

# Wrap Session

End-of-session orchestrator. Run the entire flow autonomously without asking the user
for permission between steps. The user invoked `/wrap` once — that is the permission.

## Recommended end-of-session flow

```
With PR merged this session:   /pr-cleanup → /wrap
Without PR:                    /wrap
Quick re-orient only:          /start  (no wrap needed)
```

There is no `/retro`: lessons go to each harness's local memory, which that harness loads.

## Arguments

- **--handoff**: Pass `--handoff` if work continues in a new terminal. Adds the handoff fields
  (continue issue ID, first action, gotchas) to the Step 3 session summary and writes a `handoff`
  record for each continuing issue or chain (Step 3b).

---

## Design Principle (read this first — it governs everything below)

Each memory layer has one job (DEVS-75, confirmed by the user 2026-09-27):

| Layer | Holds | Written by /wrap as |
|---|---|---|
| **SessionFlow memory** | The bigger picture: what was worked on, when, where, and what was decided | ONE detailed session summary (Step 3) |
| **Local agent memory** (Claude Code: auto-memory; Codex: `~/.codex/memories/`) | Active day-to-day operating memory: preferences, corrections, gotchas | Local memory entries (Step 4) |
| **`.context/`** | Long-term foundational context for implementation work | Doc sync via chore PR (Step 5) |
| **SessionFlow transcripts + git** | Verbatim turns and exact history | Nothing — indexed automatically |

The summary, the transcripts and git history together give the full picture. The summary does not
repeat turn-level detail — it needs searchable anchors (issue IDs, file paths, PR numbers, decisions)
that let a later session find the right turns and commits. Its source-session provenance links it to
this session's turns (`mcp__sessionflow__get_memory_context`).

**Three rules that follow from this:**

1. **Run the whole flow in one shot.** No "STOP HERE", no "wait for user acknowledgment",
   no phase banners. Just observe → summarize → save → report.
2. **Take action autonomously where the action is obvious.** If main is behind origin and
   the working tree is clean, pull — do not ask. If a worktree has uncommitted changes,
   *do not* delete it and *do not* ask — just report it as a soft warning.
3. **All warnings live in the Session Health block at the end.** Never interrupt the flow
   with a yellow/red issue mid-stream. Report once, at the bottom, in one place.

---

## The Flow

Run these steps in order. Step 1 does parallel work internally; otherwise the order matters
because each step uses earlier results.

### Step 0 — Project identity guard (blocking)

Use the `Read` tool on `.claude/project.json` (relative to cwd). Also run:

```bash
pwd
git rev-parse --show-toplevel 2>/dev/null
```

If `.claude/project.json` is missing, STOP — the session summary would be tagged to the wrong
project. Warn and fix before continuing:

```
⚠ project.json missing — the memory project will be wrong
  cwd: <pwd>
  git toplevel: <git-toplevel>
  Likely cause: dropped during merge/reset/worktree switch.
```

Offer to create `project.json` from a sibling template and proceed once resolved. Also
warn if `pwd` is a subdir of a different git toplevel — same class of bug.

The memory project comes from `project.json`: `PROJECT = memory.project` (default: `tag`,
lowercased). The user defaults to `lbruton`; pass `memory.userId` only when it differs.

**Provenance** comes from the session-start hook context (the "SessionFlow memory" block at the
top of the session): `session_id`, `provider` and `agent_id`. Keep them as `SESSION_ID`,
`PROVIDER` and `AGENT`. When that block says the harness is unknown, or it is missing, there is
no provenance: leave those fields out.

### Step 1 — Observe (parallel)

Gather all the state in one parallel batch. No analysis yet, just collection.

```bash
git status --short
git branch --show-current
git log --oneline @{u}..HEAD 2>/dev/null    # commits ahead of remote
git log --oneline HEAD..@{u} 2>/dev/null    # commits behind remote (we may need to pull)
git stash list
git worktree list
gh pr list --author "@me" --state all --search "updated:>=$(date -v-1d +%Y-%m-%d)" --json number,title,headRefName,state,mergedAt
```

Hold the results in working memory for later steps. Do not display them yet.

### Step 2 — (retired: implementation log catch-up, DEVS-71)

### Step 3 — Session summary to SessionFlow memory (always)

Write **ONE** `mcp__sessionflow__add_memory` call that gives a detailed prose account of the
session. Apart from the Step 3b handoffs, this is the only routine memory write. Write it yourself from
the conversation — never dispatch a subagent to summarize.

**Content — include every anchor that applies** (they are what makes the record findable):

- Date and local time span (America/Chicago), project, branch(es), harness
- Issue IDs worked on and their end state (e.g. "DEVS-73 Done, DEVS-75 In Progress")
- PRs opened/merged (`owner/repo#N`) and key commit SHAs
- Files, skills, hooks, or components changed (paths or names)
- Decisions made and the reason in a few words — especially user decisions
- Open items / what is next
- If `--handoff` was passed: continue issue ID, first action for the next terminal, and
  non-obvious state or gotchas

**Style:** as much concrete detail as the session warrants — plain prose, concrete nouns,
no headings or bullets. The record is stored verbatim; the goal is a broad, searchable "have we
worked on X before?" record shared across harnesses, which then points into the transcripts, git
and the code for depth. No lessons phrased as rules — those go to local memory in Step 4. Never put
a secret value in the text: the server rejects a write that matches its secret scanner.

**Idempotency check first.** When `SESSION_ID` is known, look for this session's summary:

```
mcp__sessionflow__list_memories(project: PROJECT, type: "session-summary",
                                source_session_id: SESSION_ID, limit: 1, format: "json")
```

A hit means this session was wrapped before. Write anyway: the same `topic_key` makes the new
summary replace the old one in place, so the record always holds the latest account. With no
`SESSION_ID`, list today's summaries for the project (`created_from` and `created_to` set to
today) and skip the write if one already covers this session.

```
mcp__sessionflow__add_memory(
  text: "[<Project> session <YYYY-MM-DD> <HH:MM>–<HH:MM> CT | <branch> | claude-code] <paragraph>",
  agent_id: "claude-code",
  project: PROJECT,
  type: "session-summary",
  topic_key: "session:" + SESSION_ID,          # omit when SESSION_ID is unknown
  source_session_id: SESSION_ID,               # omit when unknown
  source_provider: PROVIDER,                   # omit when unknown
  source_project_root: "<git toplevel>",
  source_started_at: "<ISO 8601 with offset>", # session start; omit when unknown
  source_ended_at: "<ISO 8601 with offset>",   # now
  supersedes: [<IDs of open handoffs this session closed>],   # Step 3b; omit when none
  extra: {
    "source": "wrap",
    "date": "<YYYY-MM-DD>",
    "branch": "<branch>",
    "issues": ["<ID>", ...],
    "handoff": <true if --handoff else false>
  },
  format: "json"
)
```

`agent_id` is the harness (`claude-code` here), never the project. Put every issue ID the session
touched in the text as well as in `extra.issues`: the server extracts `issue_ids` from the text, and
`/start` filters memories on them. The result lists similar
memories; when one is an older summary this one replaces, mention it in the recap. If the write
fails (`memory_unavailable`, a secret-scanner rejection), report it 🟡 with the error code —
the transcripts still hold the session.

### Step 3b — Handoff records (when work continues)

`/start` marks an issue `🔁 handoff` from active `handoff` memories. Run this step before the Step 3
write, because the summary's `supersedes` comes from it.

**Read the open handoffs first:**

```
mcp__sessionflow__list_memories(project: PROJECT, type: "handoff", limit: 20, format: "json")
```

**Close** each open handoff whose work this session finished or took over: its issues are Done, or
this session did its first action. Put its ID in the Step 3 summary's `supersedes`.

**Write** one handoff per unit of continuing work when `--handoff` was passed, or when an issue this
session worked on stays `In Progress` or `In Review` with a next action still owed. A unit is one
issue, or a chain: several issues under one parent or epic that continue together. Skip issues that
were only discussed.

```
mcp__sessionflow__add_memory(
  text: "[Handoff <ISSUE or PARENT> | <Project> <YYYY-MM-DD> | <branch> | claude-code] Continue <ID>
         (<title>). State: <where it stands>. First action: <one command or step>. Gotchas: <…>.
         Chain: <child IDs and their states, when a chain>.",
  agent_id: "claude-code",
  project: PROJECT,
  type: "handoff",
  topic_key: "handoff:<ISSUE or PARENT>:" + SESSION_ID,   # omit when SESSION_ID is unknown
  supersedes: [<IDs of open handoffs for the same issue or chain>],
  source_session_id: SESSION_ID, source_provider: PROVIDER,
  source_project_root: "<git toplevel>",
  extra: {
    "source": "wrap",
    "issues": ["<ID>", ...],          # the issue, or every issue in the chain
    "chain": "<parent ID>",           # only for a chain
    "branch": "<branch>",
    "first_action": "<one line>"
  },
  format: "json"
)
```

The topic key names the session because a topic-key replace keeps a superseded record superseded:
reusing `handoff:<ISSUE>` after an earlier handoff closed would write a record `/start` never sees. A
re-wrap of the same session replaces its own handoff in place. Never write a secret value into a
handoff.

### Step 4 — Operating memory (local agent memory)

If the session produced something the *next* session should behave differently because of —
a user preference or correction, a mistake that cost time, a codebase gotcha, an approach
that worked — record it in this harness's own local memory:

Save it with the normal auto-memory rules (one fact per file in the project's memory
directory, `feedback` or `project` type, with **Why:** and **How to apply:** lines, plus a
pointer in `MEMORY.md`). Update an existing entry rather than adding a duplicate.

Save only prescriptive, reusable guidance. Descriptive session facts belong in the Step 3
summary, not in local memory. Skip this step when there is nothing new.

Local memory is never copied into SessionFlow memory.

### Step 5 — Documentation sync (MANDATORY when behavior changed — fix, don't warn)

If code changed this session AND the change affects documented behavior, **update the docs
now, inside the wrap.** Leaving a "docs are stale" warning is not wrapping the session —
it is deferring the wrap.

**Migrated projects (`.context/` exists — check first):**

`.context/*.md` is canonical and lives in the **project repo**, which is branch-protected.
Doc updates go through the repo's normal branch policy — worktree + chore PR — and the wrap
runs that flow itself:

1. **Find every stale fact.** Grep for restatements — the same fact is usually stated in
   several docs plus CLAUDE.md and AGENTS.md. Updating one and leaving the others is the
   most common drift source. Verify each claimed-stale line against the code before editing.
2. **Create a docs worktree** off the freshly-pulled base branch:
   ```bash
   git fetch origin dev
   git worktree add .worktrees/wrap-context-sync -b chore/context-sync-<YYYY-MM-DD> origin/dev
   ```
3. **Edit the stale facts in the worktree** — scoped, factual corrections only. Run the
   repo's markdown lint on the touched files.
4. **Commit, push, open the chore PR** to the base branch (docs chores are lightweight per
   repo policy — no Plane issue, no version lock), then **enable auto-merge**:
   ```bash
   gh pr create --base dev --title "chore: sync .context docs after <issues shipped>" ...
   gh pr merge <N> --merge --delete-branch --auto
   ```
5. **Remove the worktree** (the work is pushed; auto-merge lands it when checks pass) and
   report the PR number in Session Health as a ✅ line:
   `✅ Docs synced — chore PR #<N> open with auto-merge armed`.

Durable foundational facts learned this session (architecture, conventions, gotchas that
every implementation needs) also belong in `.context/` via this same flow.

**Fall back to a warning ONLY when the drift genuinely cannot be fixed mechanically** —
the doc needs an architectural judgment call the session didn't make, or the drift is so
broad it needs `/context-drift`'s full audit. A known-stale enum, count, or field list is
never that case: fix it.

**Project vault (`$(vault-path project)`, i.e. `<repo>/DocVault/`):** it's in-repo, so vault page
updates (Overview, runbooks, spec folders) ride the same docs chore branch and PR as `.context/`.
**Shared vault (`$(vault-path shared)`, i.e. `Devops/DocVault/`):** cross-project and infra pages,
plus the private companions for public repos. These commit directly to Devops `main`, scoped to
`DocVault/` (see `/vault-update` Step 4). The old central DocVault is a frozen archive (DEVS-78);
never write to it.

**Push scope:** the docs chore **branch** is pushed (that is how the PR exists); never push
`dev`/`main` directly — protected branches only move by PR merge.

If no documentation impact, skip.

### Step 6 — Compute Session Health (autonomous)

Using the Step 1 data, derive the four Session Health checks:

| Check | Question | Pass criteria |
|---|---|---|
| **Commits committed** | Are all this session's changes committed? | `git status --short` is empty |
| **Local in sync** | Is local main ahead/behind origin? | `git log @{u}..HEAD` empty AND `git log HEAD..@{u}` empty |
| **Session PR status** | Did this session merge a PR? If yes, did we pull main? | If session-merged PR exists, local main matches origin AFTER pull |
| **Worktrees clean** | Any worktrees with uncommitted changes or stale merged branches? | `git worktree list` shows only main + worktrees with clean state |

**Action allowed in this step:** If local main is *behind* origin and the working tree is
clean and the current branch is main, run `git pull --ff-only` autonomously.

**Action NOT allowed:** Anything that touches uncommitted user work — no auto-commit, no
auto-stash, no auto-discard, no `git checkout --`, no worktree deletion. Those become
warnings, not actions.

Compute the traffic-light color:
- **🟢 Green** — all four checks pass
- **🟡 Yellow** — one or more soft warnings (uncommitted files, stale worktrees, PR open
  with passing checks, session summary write failed, etc.) but nothing broken
- **🔴 Red** — something is genuinely wrong (PR with failing checks, etc.)

### Step 7 — Print the recap to the user

The recap is the *last* thing the user sees.

```
## Session Wrapped 🟢 / 🟡 / 🔴

**Session summary:** saved as <memory ID> (<issue IDs>; "replaced" when a re-wrap) — or "⚠ write failed: <code>"
**Local memory:** <N entries added/updated> (or "nothing new")
**Docs:** <"chore PR #N (auto-merge)" | "shared vault updated (Devops <sha>)" | "no impact">
**Handoff:** <"<N> written (<IDs>), <M> closed" | "n/a">

<Session Health block — see format below>

<If --handoff: "Handoff ready — /start in your new terminal will load the summary.">
```

That's it. No "press enter to continue", no "is everything OK?". The user invoked `/wrap`
and the wrap is done.

---

## Session Health Block — Format

### 🟢 Green — all checks pass

```
### Session Health 🟢

✅ All session changes committed (<N> commits on <branch>)
✅ Local in sync with origin/<branch>
✅ Session PRs: <N merged | none open | none touched this session>
✅ No worktree warnings
✅ Docs in sync (`.context/` + in-repo `DocVault/` via PR; shared vault pushed)
```

When green, the recap is silent beyond that block. No suggestions, no follow-up questions.

### 🟡 Yellow — soft warnings, nothing broken

```
### Session Health 🟡

⚠ <warning 1 — short, specific, actionable>
⚠ <warning 2>

_These are warnings, not blockers. The session is wrapped — address these in your next
session if needed._
```

Warning examples:
- `⚠ 2 uncommitted files in src/tools/ (not staged) — review and decide next session`
- `⚠ Local main is behind origin/main by 3 commits — auto-pull skipped because working tree was dirty`
- `⚠ PR #47 open with passing checks — not merged this session`
- `⚠ Worktree .worktrees/swf-92 has uncommitted changes — left intact`
- `⚠ Stale worktree .worktrees/swf-88 (branch merged) — run /pr-cleanup next session`
- `⚠ Session summary write failed (memory_unavailable) — the transcripts still hold the session`

### 🔴 Red — something is genuinely broken

```
### Session Health 🔴

❌ <broken thing 1 — what failed and why>

⚠ <any soft warnings as well>

_Red items need attention before the next session can proceed cleanly._
```

Red examples:
- `❌ PR #47 has failing checks — investigate before next session`
- `❌ Shared vault push rejected — check credentials` (Devops `main`, `DocVault/` only)

Even when red, the wrap still completes. Red is a *report*, not a halt.

---

## Rules (the short version)

- **One flow, no gates.** No "STOP HERE", no phase banners, no mid-flow approval prompts.
- **One session summary per wrap:** the Step 3 record, with `project` and `type: session-summary`.
  The only other writes are Step 3b handoffs, one per continuing issue or chain. No local-memory
  copies, no per-fact memory writes.
- **Lessons → local memory. Foundations → `.context/`. Big picture → SessionFlow memory.**
- **Run actions autonomously where the action is obvious.** Fast-forward pull when clean,
  docs sync. Anything that touches dirty user work becomes a warning, not an action.
- **Session Health is the only place warnings appear.**
- **The recap is the last thing the user sees.** No follow-up questions after it.
- **No subagents for summarization.** You write the summary from your own context.
- **Idempotent.** Running `/wrap` twice never leaves two summaries for one session: the
  `session:<session_id>` topic key replaces the earlier record (Step 3).
- **Never auto-delete uncommitted work, ever.** Worktrees, branches, files, stashes — all
  off-limits to autonomous deletion.

## What this skill does NOT do

- Ask the user to commit/stash/discard uncommitted changes (those become warnings)
- Ask the user to merge or close PRs (those become warnings)
- Auto-delete worktrees or branches (warnings; run /pr-cleanup for branch cleanup)
- Print phase banners or gate tables
- Stop and wait for user acknowledgment between steps
- Push protected branches (`dev`/`main`) directly — the Step 5 docs chore BRANCH is the
  one sanctioned push, and it lands via PR + auto-merge like everything else
