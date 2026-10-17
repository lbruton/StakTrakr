---
name: wrap
description: >
  End-of-session orchestrator — verifies session work, saves ONE detailed session summary to
  mem0 (the big-picture record), writes day-to-day lessons to local memory and durable facts to
  .context/, syncs docs, and reports Session Health. Run at end of any session, optionally after
  /pr-cleanup. Triggers: "wrap", "wrap up", "close session", "end of session",
  "done for the night", "finish up", "closing time".
library-version: 5834a2dcd445
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

`/retro` was retired in DEVS-75 (2026-09-27): its mem0 `retro-learning` entries were never
read back by any session. Lessons now go to each harness's local memory, which it loads.

## Arguments

- **--handoff**: Pass `--handoff` if work continues in a new terminal. Adds the handoff fields
  (continue issue ID, first action, gotchas) to the Step 3 session summary.

---

## Design Principle (read this first — it governs everything below)

Each memory layer has one job (DEVS-75, confirmed by the user 2026-09-27):

| Layer | Holds | Written by /wrap as |
|---|---|---|
| **mem0** | The bigger picture: what was worked on, when, where, and what was decided | ONE detailed session summary (Step 3) |
| **Local agent memory** (Claude Code: auto-memory; Codex: `~/.codex/memories/`) | Active day-to-day operating memory: preferences, corrections, gotchas | Local memory entries (Step 4) |
| **`.context/`** | Long-term foundational context for implementation work | Doc sync via chore PR (Step 5) |
| **SessionFlow + git** | Verbatim turns and exact history | Nothing — indexed automatically |

mem0 + SessionFlow + git history together give the full picture. mem0 does not need to repeat
turn-level detail — it needs searchable anchors (issue IDs, file paths, PR numbers, decisions)
that let a later session find the right SessionFlow turns and commits.

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

If `.claude/project.json` is missing, STOP — the mem0 summary would be tagged to the wrong
project. Warn and fix before continuing:

```
⚠ project.json missing — mem0 project tag will be wrong
  cwd: <pwd>
  git toplevel: <git-toplevel>
  Likely cause: dropped during merge/reset/worktree switch.
```

Offer to create `project.json` from a sibling template and proceed once resolved. Also
warn if `pwd` is a subdir of a different git toplevel — same class of bug.

mem0 scope comes from `project.json` (DEVS-92 standard): `USER = mem0.userId` (default
`"lbruton"`), `PROJECT = mem0.project` (default: `tag`, lowercased).

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

### Step 3 — Session summary to mem0 (always)

Write **ONE** mem0 add call that gives a detailed prose account of the session. This is
the only routine mem0 write. Write it yourself from the conversation — never dispatch a
subagent to summarize.

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
no headings or bullets (mem0 stores text, not markdown). mem0's dashboard instructions tell it
to keep a session summary as one memory; the goal is a broad, searchable "have we worked on X before?"
record shared across harnesses and developers, which then points into SessionFlow, git and
the code for depth. No lessons phrased as rules — those go to local memory in Step 4.

> **mem0 tool prefix (DEVS-94):** mem0 is the official hosted MCP connector now — its live tool
> prefix is `mcp__<connector-id>__*`, not a fixed `mcp__mem0__`. `add_memory` names the
> capability; resolve the live tool from your catalog before calling it.

```
add_memory(
  text: "[<Project> session <YYYY-MM-DD> <HH:MM>–<HH:MM> CT | <branch> | codex] <paragraph>",
  user_id: USER,
  agent_id: "codex",
  metadata: {
    "type": "session-summary",
    "source": "wrap",
    "project": PROJECT,
    "date": "<YYYY-MM-DD>",
    "issues": ["<ID>", ...],
    "handoff": <true if --handoff else false>
  }
)
```

`agent_id` is the harness (`codex` here), never the project. The project lives in
`metadata.project` only (DEVS-92 standard). If the write fails, report it 🟡 — SessionFlow still holds the session.

### Step 4 — Operating memory (local agent memory)

If the session produced something the *next* session should behave differently because of —
a user preference or correction, a mistake that cost time, a codebase gotcha, an approach
that worked — record it in this harness's own local memory:

Update the relevant note in `/Users/lbruton/.codex/memories/` and keep `MEMORY.md` pointing
at it. Don't rewrite generated aggregate memory files if that risks corrupting the local
memory system; report the skip instead.

Save only prescriptive, reusable guidance. Descriptive session facts belong in the Step 3
summary, not in local memory. Skip this step when there is nothing new.

Local memory is **not** promoted to mem0 any more (DEVS-75 retired the old promotion step).

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
  with passing checks, mem0 summary write failed, etc.) but nothing broken
- **🔴 Red** — something is genuinely wrong (PR with failing checks, etc.)

### Step 7 — Print the recap to the user

The recap is the *last* thing the user sees.

```
## Session Wrapped 🟢 / 🟡 / 🔴

**mem0 summary:** saved (<issue IDs>) — or "⚠ write failed"
**Local memory:** <N entries added/updated> (or "nothing new")
**Docs:** <"chore PR #N (auto-merge)" | "shared vault updated (Devops <sha>)" | "no impact">
**Handoff:** <"included in the mem0 summary" if --handoff, else "n/a">

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
- `⚠ mem0 session summary write failed — SessionFlow still holds the session`

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
- **Exactly one routine mem0 write per wrap:** the Step 3 session summary, tagged
  `metadata.project` and `type: session-summary`. No `retro-learning` entries, no local-memory
  promotion, no per-fact mem0 writes.
- **Lessons → local memory. Foundations → `.context/`. Big picture → mem0.**
- **Run actions autonomously where the action is obvious.** Fast-forward pull when clean,
  docs sync. Anything that touches dirty user work becomes a warning, not an action.
- **Session Health is the only place warnings appear.**
- **The recap is the last thing the user sees.** No follow-up questions after it.
- **No subagents for summarization.** You write the summary from your own context.
- **Idempotent.** Running `/wrap` twice should not write two summaries — search mem0 for a
  `session-summary` for this project and date first, and skip if one covers this session.
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
