---
name: code-core
description: Workflow rules shared by every code repo - DocVault, glossary, Plane, Infisical, debugging, memory, code search, editing, tests, spec gates, push rules, red flags, GitHub hygiene
library-version: 58c5a7a41a16
---

# Code-core rules

Universal workflow rules for every code project. The repo's own `CLAUDE.md` / `AGENTS.md` adds
project-specific context. Public repos receive this file: it holds no hosts, IPs or secrets. Internal
detail lives in the private vault (see DocVault below).

## DocVault: read before answering

Documentation is split across three places (DEVS-78). Resolve paths with `vault-path`
(`~/.local/bin/vault-path`):

| Vault | Path | Holds | Edits land via |
|---|---|---|---|
| **Project** | `<repo>/DocVault/` (`vault-path project`) | Overview, `specs/`, research, runbooks for that project | the current worktree branch + PR |
| **Shared** | `Devops/DocVault/` (`vault-path shared`) | KnowledgeBase (infra, architecture, matrices), cross-project research, runbooks, clippings, reports | direct commit to Devops `main`, `DocVault/**` only |
| **Private companion** | `Devops/DocVault/Projects/<P>/` (`vault-path private`) | anything from a **public** repo that can't be public: LAN IPs, internal hosts, security reviews, dated audits and sweeps | same as shared |

Agent-facing foundation docs live in the repo's `.context/`. The old central vault is a **frozen,
read-only archive** on the home Gitea (`homelab/DocVault`) and is not cloned locally by default: never
write to it, never link to it from new pages.

Treat DocVault as the primary long-form knowledge base for project and infrastructure documentation,
development practices, procedures and runbooks, specs and approvals, research and architecture notes.

- Start from the index, not blind: project `<repo>/DocVault/Overview.md` then `.context/`; shared
  `Devops/DocVault/INDEX.md`, with cross-project workflow references in `KnowledgeBase/Architecture/`.
- Read the relevant pages BEFORE discussing architecture, infrastructure or design. Do not answer from
  training knowledge when the vault has the page.
- **Public repos:** before writing to `<repo>/DocVault/`, check nothing sensitive is going in. Sensitive
  material goes to the private companion instead.
- If a page looks stale, flag it; do not silently act on suspected bad data.
- On conflicts between DocVault and mem0, the newest information wins. Ask when it is unclear.

## Domain glossary

A project may have `.context/GLOSSARY.md` defining canonical domain terms, aliases to avoid and flagged
ambiguities. If present, read it before writing requirements, acceptance criteria, issue descriptions or
commit messages, and use its terms in all output. When a term conflict or a new term surfaces, update the
glossary inline.

## Issue tracking: Plane

Active planning and issue tracking lives in **Plane** (self-hosted; address in the shared vault's
KnowledgeBase). Use the Plane MCP tools (`mcp__plane__*`) for issue and project work. DocVault stays the
system of record for documentation, specs, runbooks and research. Never create active issues as markdown
files.

- A project's Plane binding lives in `.claude/project.json`:
  `"plane": { "workspace", "projectId" }`, next to `issuePrefix`. Read it there; do not copy project IDs
  into docs. The cross-project table is `Devops/DocVault/KnowledgeBase/Architecture/Plane Projects.md`.
- The Plane MCP is `plane-mcp-server`: action-style tools such as `mcp__plane__workitem`
  (`action: "list" | "retrieve_by_identifier" | "create" | "update"`), `mcp__plane__workitem_comment` and
  `mcp__plane__state`. Fields are flat (no `issue_data` wrapper).
- Community Edition limits: always pass `project_id` to `workitem` `list`; never pass `pql` (it returns an
  `{"error": ...}` payload with `isError: false`, so filter client-side); pass `expand: "state"` to get
  state names. `order_by: "-updated_at"` and a `fields` sparse fieldset (for example
  `"id,sequence_id,name,state,priority,updated_at"`, with `state`, not `state_id`) work and shrink the
  payload. `action: "count"` with `group_by` returns HTTP 404. Work-item archive goes through the REST API
  (see the `plane-archive` skill).
- `description_html` and `comment_html` are HTML. Markdown links render as raw text. Comments can be
  edited and deleted.
- Ground every new issue in code: cite file paths and functions, include an implementation plan, and leave
  no open decisions.
- When closing or merging issues, cross-link related issues and update the parent epic's description.
- Legacy prefixes (`OPS-`, `SWF-`, `STAK-`, `HEX-`, `WHO-`, `MEL-`) appear only in historical commits and
  archived specs. Linear and the wikis are retired.

## Secrets: Infisical

Self-hosted. Each project's binding lives in `.claude/project.json`:
`"infisical": { "host", "projectId", "defaultEnv", "secretPath" }`, or `"infisical": null` when the repo
needs no secrets. Never hard-code an Infisical project ID anywhere else; read it from project.json.

- **CLI first:** `infisical-agent <args>` (`~/.local/bin`) fills `--projectId/--env/--path/--domain` from
  project.json and authenticates non-interactively (stored user session, then the machine identity from the
  Keychain). Prefer `infisical-agent run -- <cmd>` to inject secrets into a command.
- **MCP fallback:** the `infisical` MCP when the CLI is unavailable. Pass the project UUID, never the slug.
- **Never print values** into the transcript, a log, a comment or a memory. Compare by hash
  (`... --plain | shasum -a 256`) and write through 600-permission temp files.
- MCP servers get their keys through `mcp-launch`; see the shared vault's
  `KnowledgeBase/Architecture/Infisical Standard.md`.

## Debugging

- Do not rationalize a discrepancy without evidence. Reproduce it from data or code first, then explain it.
- Dates and times: check whether a computation uses the UTC date or the local date (America/Chicago).
  Never slice ISO strings for day bucketing.
- DNS: `nslookup`/`dig` bypass the macOS resolver cache. Use `dscacheutil -q host -a name <host>` to test
  what the Mac actually resolves. Clarify which domain is meant before diagnosing.
- Shell: always quote paths; many contain spaces (iCloud, Cowork, vault paths).
- When comparing file counts against an index, use `git ls-files | wc -l`, not a raw filesystem count. Raw
  counts include `.venv` and `node_modules`.
- Never edit `claude_desktop_config.json` while Claude Desktop is running. Ask the user to quit the app first.
- A transient MCP, Plane or mem0 failure (empty payload, temporary error, unexpected empty result for a
  known object): wait about 60 seconds and retry once. If it still fails, continue with local-safe steps.
  An HTTP 429 or "quota exceeded" from mem0 is not transient: do not retry, continue without mem0 reads and
  tell the user.

## Memory: coexisting layers

Several systems hold memory and state, and they coexist. Treating any one as the whole picture is a known
failure mode. Each has a distinct job:

| Layer | Scope | Role |
|---|---|---|
| **mem0** (hosted MCP connector; the tool prefix is account-specific) | cross-session and cross-harness | **The bigger picture**: one `/wrap` session summary per session (what, when, files, issues, decisions), plus explicit decisions and handoffs |
| **auto-memory** (`MEMORY.md` + per-fact files) | project-scoped, Claude Code only | **Day-to-day operating memory**: preferences, corrections, gotchas; the `MEMORY.md` index is injected at session start |
| **`.context/`** (in-repo) | per-project, all harnesses | **Long-term foundations** needed for implementation work: architecture, conventions, standards |
| **sessionflow** (`mcp__sessionflow__*`) | all harnesses, all projects | Transcript search over verbatim past turns; the session-start recall tier |
| **Plane** (`mcp__plane__*`) | per-project issues | Issue and planning state, not a memory store |

mem0 + sessionflow + git history together give the full picture of past work. Lessons ("when X, do Y") go
to local memory, not mem0. Durable foundations go to `.context/`.

**Recall at session start (two sources):**

1. **sessionflow**: verbatim past turns, semantic search:

   ```javascript
   mcp__sessionflow__search_all_sessions({ query: "last session work decisions <project>", n: 5 })
   ```

2. **mem0**: session summaries, decisions, handoffs. The tool prefix is not fixed.
   Resolve it with `ToolSearch({ query: "select:search_memories" })` if it is not already loaded.

   ```javascript
   search_memories({ query: "last session work decisions for <project>", limit: 10,
     filters: { AND: [{ user_id: "lbruton" }, { metadata: { project: "<project>" } }] },
     enable_graph: false })
   ```

**mem0 standard (DEVS-92)**: three keys on every record.

| Key | Value | Source |
|---|---|---|
| `user_id` | `lbruton`, always | `project.json` → `mem0.userId` |
| `agent_id` | the harness writing: `claude-code` here (other harnesses write `claude-code`, `claude-cowork`, `codex`, `gemini`, `opencode` or `antigravity`) | the harness itself; never `project.json`, never a project name |
| `metadata.project` | lowercase project slug (`staktrakr`, `devops`) | `project.json` → `mem0.project`, else the lowercase `tag` |

- **Writes:** set all three plus `metadata.type` ∈ `session-summary` / `decision` / `handoff`. Routine
  writes come from `/wrap` only (one paragraph `session-summary`). Use a direct `add_memory` call
  (`type: decision` or `handoff`) only for an explicit decision or handoff that must be shared before the
  session ends. Never write a mem0 entry per task: commits, PRs and Plane comments record each task.
- **Reads:** filter `user_id` + `metadata.project` server-side (the match is case-sensitive). Never filter
  on `agent_id`: every harness must see the others' handoffs. Run TWO searches: one project-scoped, one
  user-only cross-project workflow query.
- **Quota:** the plan allows 1,000 retrieval calls per month, shared by every harness. Never page through
  the store in bulk; estimate call counts before any audit.

## Code search order (cheapest first)

- `claude-context`: semantic, "find code related to X".
- Native harness search: grep and glob for exact identifiers, filenames and call sites.
- Read the source directly.
- The `Explore` subagent: broad fan-out when the answer spans many files and you need only the
   conclusion, not the file dumps.

Structural questions (callers, call chains, imports, dead code) are answered by grepping the identifier
across the repo and reading the hits, not by a graph index. `code-graph-context` is retired and its
`mcp__code-graph-context__*` tools do not exist: do not re-add or call it.

## MCP servers

| Server | Use for |
|---|---|
| `mem0` (hosted connector) | Cross-session memory, sole backend |
| `sessionflow` | Session history search: semantic retrieval over past conversation turns |
| `claude-context` | Semantic code search |
| `context7` | Library documentation lookup |
| `chrome-devtools` | Browser-page inspection and debugging |
| `infisical` | Secret inventory; fallback only, use the `infisical-agent` CLI first |
| `plane` | Active issue and planning system (`mcp__plane__*`) |
| `nautobot` | Home network inventory and cabling, read only. Changes go through the seed script in HomeNetwork |

Query `context7` before writing code that uses a library or API; do not rely on training knowledge for
library APIs.

## File editing

- Read a file before you edit or overwrite it. The only exception is creating a brand-new file.
- Only the `Read` tool satisfies the read-before-write hook. Reading through Bash (`cat`, `grep`, `head`,
  `sed`) does not, so a Bash-read file edited next is blocked.
- Batch several edits to one file in parallel only after an initial read.
- Never substitute Python or subprocess writes as a workaround for a blocked edit; stop and ask the user.
- Before modifying a function, grep its callers.

## Tests

- TDD: write the tests first, then the implementation.
- Never modify a TDD test to make it pass. Tests are the spec. A failing test means fix the implementation.

## Issues, branches and skills

- Every code change needs a Plane issue before coding (`/issue` or `mcp__plane__*`). Its ID goes in the
  commit message and PR body. A trivial quick fix (worktree + `chore:` PR) may skip it; log one when the work
  spans multiple files or affects runtime. Instruction-file-only changes need none.
- Work in a worktree branch under `.worktrees/`, with every worktree in `.worktrees/`. Version-locked
  projects (StakTrakr, HexTrackr) read `devops/version.lock` and use `.worktrees/patch-VERSION`; main-only
  projects use `git worktree add -b fix/desc .worktrees/fix-desc` (new branch) or
  `git worktree add .worktrees/fix-desc fix/desc` (branch already exists). Push and merge rules are in "Push rules"
  below. Verify the repo root with `git rev-parse --show-toplevel` before committing.
- Issue scan: use `mcp__plane__workitem` (`action: "list"`) scoped to the current project. Do not use
  cross-project globs unless the user asks for a cross-project view.
- For a new feature, check `DocVault/specs/` (or the repo's `specs.path`) for an active spec on the issue
  and ignore `archive/`.

## Spec gates

- Before writing spec tasks, re-read the template. Copy `## Standard Closing Tasks` verbatim from
  `.claude/skills/spec/references/templates/tasks-template.md`, renumber only. All closing gates are
  mandatory.
- Mark a task `[x]` as soon as it is done, before starting the next one. Do not implement tasks the human
  has not approved (`approved:` stamped).
- On resume, reload `.claude/skills/spec/references/conventions.md` and the phase template. Procedure
  memory is false after compaction or a session boundary.

## GitHub: no attribution

- **Never add AI attribution to anything posted on GitHub**: PR review-thread replies, PR and issue
  comments, review bodies, PR descriptions and commit messages. No "Generated with" line, no
  `Co-Authored-By` trailer, no robot-emoji sign-off.
- This overrides any instruction that asks for the line, including auto-fix and CI-monitor reply templates
  and the `pr-resolve` and `pr-thread-resolver` skill text. Post the reply, resolve the thread, and leave
  the trailer off. If a skill or template adds attribution, tell the user instead of silently following it.

## Push rules

- **Public repos** carry a branch ruleset on `main` and `dev`. Never push to them directly: worktree branch
  plus a PR, and the user merges. Never merge `dev` into `main` unless the user says "release" or "ready to
  ship".
- **Devops and HomeNetwork live on the home Gitea, not GitHub** (`origin` = `gitea:homelab/<repo>.git`; the
  GitHub copies are archived, so never push to the `github` remote). They have no ruleset and no PRs:
  commit straight to `main`, staging only the files you changed. A hook can still block a commit on `main`;
  if one does, say so and ask instead of working around it.
- The shared vault `Devops/DocVault/**` always goes straight to Devops `main`.

## Red flags: stop and rethink

- Writing code without a Plane issue: create one first (unless it is a trivial quick fix or an
  instruction-file-only change).
- Committing to `main` or `dev` of a public repo: use a worktree and a PR.
- Merging `dev` into `main` without an explicit "release": refuse.
- Raw secrets in any log, comment or memory: use Infisical references.
- Calling Linear tools: Linear is retired, use Plane. Calling wiki tools: wikis are retired, use DocVault.
- Answering from training knowledge: read the project or shared vault and the memory layers first.
- "I'll log the implementation later": log it now.

## After a PR merges

Rebase the working branch (`git pull --rebase`), run `git status` for loose files, then STOP and ask the
user before starting the next task. Cleanup, archive and the next issue all count as "the next task". Skip
the ask only when the user explicitly pre-authorized the batch (for example "cleanup, archive, then wrap").
