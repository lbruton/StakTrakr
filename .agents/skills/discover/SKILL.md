---
name: discover
description: >
  Structured brainstorm and research phase before a spec.
  Takes an issue ID, dispatches research agents, runs codebase analysis,
  and produces a Discovery Brief with all open questions resolved. Bridges the
  gap between casual exploration and a spec (/spec).
  Triggers on "/discover", "/brainstorm", "research this issue", "explore this
  before we spec it".
user-invocable: true
library-version: 5834a2dcd445
---

# Discover — Phase 1 Structured Brainstorm

> **Vault paths (DEVS-78):** resolve once per session with `vault-path` (`~/.local/bin/vault-path`).
> `PROJECT_VAULT=$(vault-path project)` is `<repo>/DocVault/`, and edits ride the current branch and PR.
> `SHARED_VAULT=$(vault-path shared)` is usually `/Volumes/DATA/GitHub/Devops/DocVault/`, and edits commit
> directly to Devops `main` (`DocVault/**` only). Sensitive pages from public repos go in `$(vault-path private)`.

Structured research and design exploration for an issue. Produces a **Discovery Brief** with all open questions resolved, then hands off to `/spec` (or a quick fix for small work).

**Does NOT:** create spec documents (that's `/spec`).
**Does NOT:** write code or create worktrees.
**Does NOT:** skip the issue requirement — issue ID is mandatory.

---

## Step 0: Parse Arguments

**Argument:** `{ISSUE-ID}` (issue ID, required). If not provided, stop and ask.

If the user passes a topic instead of an issue ID:
```
An issue is required before structured brainstorming.
Would you like to:
1. Create one now: create an issue in Plane (`/issue`)
2. Explore casually first, in plain conversation
```

### Project detection

Use the `Read` tool on `.claude/project.json` — extract `issuePrefix`, `name`, `plane.workspace`, `plane.projectId`. Project vault: `$(vault-path project)` (`<repo>/DocVault/`). Shared vault: `$(vault-path shared)` (`Devops/DocVault/`).

### Fetch issue

```
mcp__plane__workitem
  action: "retrieve_by_identifier"
  workitem_identifier: {ISSUE-ID}    # e.g. "DEVS-77"
  expand: "state"
```

For `HXTR-3`, pass `project_identifier: "HXTR"`, `issue_identifier: "3"`.

Cache the full response — Step 6 needs `id` (uuid), `description_html`, and `name` to splice the Discovery block back in.

Extract: `name` → title, `description_html` (or `description_stripped`) → body, `priority`, `state` (resolve via `mcp__plane__state` (`action: "list"`), cache once), `labels` (resolve via `mcp__plane__label` (`action: "list"`) if needed) → tags.

### Check for an existing spec

Glob `{specs-root}/{ISSUE-ID}-*/` (ignore `archive/`), where `{specs-root}` is `specs.path` from `.claude/project.json`, default `DocVault/specs` (rule: `.agents/skills/spec/references/conventions.md` → Folder resolution). If a spec already exists for this issue, tell the user and suggest resuming it with `/spec {ISSUE-ID}` instead.

---

## Research fan-out (Steps 1–3) — run as a read-only Workflow

Steps 1–3 are pure read work across independent angles — the canonical use for the `Workflow` orchestration tool. When the research surface is broad (multiple subsystems, prior art *and* external docs *and* mem0 history), dispatch the sweep as a **`Workflow` fan-out**: one parallel agent per angle —

1. **Prior context** — mem0 + the project and shared vaults (claude-context).
2. **Codebase impact** — claude-context semantic + Grep/Glob structural.
3. **External** — context7 + Brave (only if libraries/APIs/platform features are involved).

Each agent returns structured findings; **you** synthesize them into the Discovery Brief — do not let an agent write the brief. **Record every query string used** (they become Step 6 Context Pointers so future sessions re-hydrate deterministically). For a narrow issue where one or two angles obviously suffice, skip the Workflow and run the searches inline below — match the fan-out to the surface area.

## Step 1: Surface Prior Context

Run these in parallel. **Record every query string used** — they go into the issue's Discovery block at Step 6 as Context Pointers so future sessions can re-hydrate deterministically.

### mem0 search
> mem0's live tool prefix is connection-specific (`mcp__<connector-id>__*`), not the fixed
> `mcp__mem0__`. `search_memories` and `add_memory` below name capabilities; resolve the live
> tool from your catalog before calling it.
```
search_memories
  query: "{issue title} {key terms from description}"
  limit: 10
  filters: {AND: [{user_id: "lbruton"}, {metadata: {project: "<mem0.project from project.json, else lowercase tag>"}}]}
```

### Vault search
Search both: the project vault (in-repo, so the repo index covers it) and the shared vault.
```
mcp__claude-context__search_code
  query: "{topic}"
  path: "<repo root>"            # includes <repo>/DocVault/
mcp__claude-context__search_code
  query: "{topic}"
  path: "/Volumes/DATA/GitHub/Devops"   # shared vault lives in Devops/DocVault/
```

Present any relevant past decisions, related work, or prior discussions.

**Track for Step 6:** the exact query strings used (mem0 + claude-context) and any Research Brief / KB / Foundation page hits — these become the Context Pointers list.

---

## Step 2: Codebase Impact Research

Run the codebase search tier protocol (minimum tiers 1-2):

### Tier 1: Claude-Context — Semantic
```
mcp__claude-context__search_code
  query: "{feature domain}"
```

Run 2-3 queries covering:
1. The feature/domain being planned
2. Existing patterns that should be reused
3. Integration points and dependencies

### Tier 2: Grep/Glob — Structural and literal
Take the identifiers Tier 1 surfaced and grep each one repo-wide to find every call site,
import, and reference. Also use Grep directly for specific identifiers, storage keys, and
constants you already know the name of. Semantic search ranks by similarity and will not
return all N references — Grep is what makes the impact list exhaustive.

### Produce Impact Summary

```
### Impact Summary

**Files likely affected:**
- `path/to/file.ts:XX-YY` — [why]

**Existing patterns to follow:**
- [Pattern name]: [file:line] — [description]

**Integration points:**
- [System/API]: [how this connects]

**Potential risks:**
- [Risk]: [mitigation]
```

---

## Step 3: External Research (If Needed)

For features involving libraries, APIs, or platform capabilities:

### Context7 — Library docs
```
mcp__context7__resolve-library-id  topic: "{library name}"
mcp__context7__query-docs  libraryId: "{id}"  topic: "{specific feature}"
```

### Web search — Prior art
```
mcp__brave-search__brave_web_search  query: "{topic} best practices 2025 2026"
```

---

## Step 4: Open Questions

Compile a list of every unresolved question. Categorize them:

```
### Open Questions

**Must resolve before spec (blocking):**
1. [Question] — [why it matters]
2. [Question] — [who can answer]

**Nice to resolve (non-blocking):**
3. [Question] — [can defer to design phase]

**Answered during research:**
4. ~~[Question]~~ — [answer found: source]
```

### Resolution Loop

For each blocking question:
1. Can we answer it from codebase research? → answer it
2. Can we answer it from docs/web search? → answer it
3. Need user input? → ask the user directly

<HARD-GATE>
All blocking open questions must be resolved before producing the Discovery Brief.
Non-blocking questions can carry forward to the spec's Open Questions section.
</HARD-GATE>

---

## Step 5: Design Exploration

With context gathered and questions answered, explore approaches:

### Present 2-3 approaches

For each approach:
- **Summary**: one-sentence description
- **Pros**: why this might be best
- **Cons**: downsides and risks
- **Effort estimate**: small / medium / large
- **Codebase fit**: how well it aligns with existing patterns

### Discuss with user

Get the user's reaction. They may:
- Pick an approach → note as the recommended approach
- Want to explore further → dig deeper on specific aspects
- Combine approaches → synthesize a hybrid
- Reject all → brainstorm alternatives

---

## Step 6: Produce Discovery Brief → Write to Issue

The Discovery Brief is the durable, session-independent home for discovery output. Write it **to the issue file** via Edit tool so that `/spec` (possibly in a fresh session) and a quick fix (which skips the spec entirely) both pick it up naturally.

### Brief structure

Keep it concise — summary + pointers, not transcripts. A quick-fix-only consumer should have enough context to execute without re-researching.

```markdown
## Discovery

*Completed: {YYYY-MM-DD} via /discover*

### Problem Statement
[One paragraph — what, who, why]

### Recommended Approach
[One paragraph — detailed enough that a quick fix can execute without re-research]

### Files Affected
- `path/to/file.ts:XX-YY` — why

### Patterns to Follow
- [Pattern name]: [file:line] — description

### Remaining Open Questions
- [Non-blocking question] — carry forward to spec

### Context Pointers
- **mem0:** `search: "<exact query used in Step 1>"` — [what it surfaces]
- **mem0:** `search: "<another query>"` — [what it surfaces]
- **Research Brief:** [[Research/{topic}]] (if one exists or was created)
- **KB:** [[KnowledgeBase/{page}]] — [why relevant]
- **Foundation:** [[Foundation/{doc}]] — [why relevant]
- **External:** https://... — only if load-bearing

### Estimated Scope
small | medium | large — [justification]
```

### Write procedure

1. Use the `description_html` and `id` cached from Step 0 (refetch via `mcp__plane__workitem` (`action: "retrieve_by_identifier"`) if not cached).
2. Build the Discovery block as HTML — use `<h2>Discovery</h2>`, `<h3>` for subsections, `<p>` for paragraphs, `<ul><li>` for lists, `<code>` for inline code/paths. Plane TipTap renders these natively. Wikilinks like `[[Foundation/X]]` can stay as literal text inside `<p>` — they don't render as links in Plane but `/spec` parses them back when reading the issue, so they're load-bearing for the workflow.
3. Splice into existing `description_html`:
   - If a previous `<h2>Discovery</h2>` block exists (from the issue template placeholder or a prior `/discover` run), replace from that opening `<h2>` through to the next sibling `<h2>` or end-of-document.
   - Otherwise, append the new block to the end of `description_html`.
4. PUT via:
   ```
   mcp__plane__workitem
     action: "update"
     project_id: {plane_project_id}
     workitem_id: {issue uuid from Step 0}
     description_html: {spliced html}
   ```
5. Plane manages `updated_at` automatically — do not attempt to set it.

### Overflow rule

If the brief exceeds ~60 lines, split:
- Keep the **summary + Context Pointers** in the issue `## Discovery` section.
- Write the long-form research to `$(vault-path project)/Research/{topic}.md` as a Research Brief (cross-project topics: `$(vault-path shared)/Research/`) (see [Research Brief Pipeline]($SHARED_VAULT/Research/Research Brief Pipeline.md)).
- Link from the issue's Context Pointers: `**Research Brief:** [[Research/{topic}]]`.

### Also emit to conversation

Show the user the brief you just wrote, so they see what landed in the issue without opening it.

---

## Step 7: Hand Off

### Save discovery summary to mem0 (semantic retrieval)

The issue is now authoritative — mem0 is the semantic-retrieval mirror. Keep the memory **short** since the full detail lives in the issue.

```
add_memory(
  text: "Discovery complete for {ISSUE-ID} — {one-sentence recommended approach}. Full brief in Plane issue. Scope: {size}.",
  user_id: "lbruton",
  agent_id: "codex",
  metadata: {
    "type": "decision",
    "source": "discover",
    "project": "<mem0.project from project.json, else lowercase tag>",
    "issue": "{ISSUE-ID}",
    "issue_url": "https://plane.lbruton.cc/lbruton/browse/{ISSUE-ID}/",
    "issue_uuid": "{plane issue uuid}",
    "category": "architecture"
  }
)
```

### Suggest next step

```
Discovery complete for {ISSUE-ID}. Brief written to the issue's Discovery section:
  URL: https://plane.lbruton.cc/lbruton/browse/{ISSUE-ID}/

Ready to formalize? Run:
  /spec new {ISSUE-ID} "<slug>"  — phased requirements → discovery → approach → tasks
  quick fix                        — small enough to build directly; issue has enough context

Both read the issue, so discovery carries across sessions automatically.
```

---

## Integration

**Upstream:**
- Casual conversation → when exploration identifies a concrete idea → create issue → `/discover`
- User directly: `/discover PROJ-123`

**Downstream:**
- `/spec {ISSUE-ID}` — phased spec using the discovery findings (reads the issue)
- Quick fix (worktree + `chore:` PR) — direct build for small work
