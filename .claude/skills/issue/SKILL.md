---
name: issue
description: >
  Issue management — create, read, update, list. All projects use Plane via
  `mcp__plane__*` tools. Config lives in `.claude/project.json` (`plane` block).
  Triggers on: "create issue", "issue", "new issue", "new bug", "file a bug",
  "track this".
user-invocable: false
library-version: ce6718eb297b
---

# Issue Management

All issue operations route through Plane MCP. Read the project config first.

## Step 0 — Read project config

Use the `Read` tool on `.claude/project.json` (relative to the repo root).

Extract:
- `name` — display name
- `issuePrefix` — e.g. `HOME`, `DEVS`, `STRK`
- `plane.workspace` — e.g. `"lbruton"`
- `plane.projectId` — uuid (used below as `{plane_project_id}`)

If there is no `plane` block, stop and tell the user the project isn't wired to Plane.

---

## Operations

### Create

1. **Resolve state and label IDs once per session:**

   ```
   mcp__plane__state   action: "list", project_id: {plane_project_id}
   mcp__plane__label   action: "list", project_id: {plane_project_id}
   ```

   Map names → uuids. Cache for the rest of the session.

2. **Pick state and label from user intent:**

   | Intent | State | Label |
   |---|---|---|
   | New backlog item | `Backlog` | based on type |
   | Ready to work | `Todo` | based on type |
   | Active work | `In Progress` | based on type |

   Type → label map (matches conventional commits):

   | Type | Label |
   |---|---|
   | `feature`, `feat` | `Feature` |
   | `bug`, `fix` | `Bug` |
   | `chore` | `Chore` |
   | `docs`, `documentation` | `Documentation` |
   | `patch`, `hotfix` | `Patch` |

3. **Create the issue:**

   ```
   mcp__plane__workitem
     action: "create"
     project_id: {plane_project_id}
     name: "{title}"
     description_html: "{html-rendered description}"
     state: {state_uuid}
     labels: [{label_uuid}]
     priority: "urgent"|"high"|"medium"|"low"|"none"
   ```

   Fields are flat — there is no `issue_data` wrapper on the current server (DEVS-77).

   Plane assigns `sequence_id` automatically — capture from the response. The full issue ID is `{issue_prefix}-{sequence_id}` (e.g. `SFLW-8`).

4. **Assign:** follow "Assign after create" below. Do not pass `assignees` in step 3.

5. **Confirm:**

   ```
   Created {issue_prefix}-{sequence_id}: {title}
     URL: https://plane.lbruton.cc/lbruton/browse/{issue_prefix}-{sequence_id}/
     State: {state}
     Labels: {labels}
     Priority: {priority}
   ```

### Read

```
mcp__plane__workitem
  action: "retrieve_by_identifier"
  workitem_identifier: "{issue_prefix}-{sequence_id}"    # e.g. "SFLW-8"
  expand: "state"
```

Returns `name`, `description_html`, `state`, `labels` (uuid array), `priority`, `created_at`, etc. With `expand: "state"`, `state` is an object with `id`, `name` and `group`; without it, `state` is a bare UUID. Resolve label UUIDs via the cached label list from the Create flow. The Plane workspace is baked into the MCP server's startup config — the tool does not accept a `workspace_slug` parameter.

Comments: `mcp__plane__workitem_comment` with `action: "list" | "create" | "update" | "delete"` (`project_id`, `workitem_id`, `comment_html`, `comment_id`). HTML is preserved, and comments can be edited and deleted.

### Update / close

Status change:

```
mcp__plane__workitem
  action: "update"
  project_id: {plane_project_id}
  workitem_id: {issue_uuid}
  state: {new_state_uuid}
```

Only the fields you pass are changed.

For closing: set state to `Done` (or `Cancelled` for cancellation). Plane records `completed_at` automatically.

### Pick up (an agent starts work on an issue)

Whenever an agent picks up an existing issue (moves it to a `started`-group state, or begins work the user pointed at), add **itself** as an assignee so Plane shows who is working it and the user can sort the notification emails by agent:

1. Resolve the agent's own Plane user id once per session: `mcp__plane__member` `action: "me"` → `id` (Claude is `claude@lbruton.cc`, Codex is `codex@lbruton.cc`; never hardcode the id).
2. `mcp__plane__workitem` `action: "manage_assignee"`, `project_id`, `workitem_id`, `add_user_id: {my_id}`. This **merges**, so the human owner or the other agent stays assigned. Never use `update` with `assignees`, which replaces the list.
3. Skip if the agent is already assigned. Leave the agent assigned when the issue closes.

### Assign after create (who gets the email)

Plane emails only an issue's **subscribers**, never the person who made the change, and has no project-lead notification. The creator is subscribed automatically. An assignee is subscribed only when Plane processes an assignee **change**: an assignee passed on `create`, or a project default assignee, is assigned but **not** subscribed and gets no email (verified against Plane v1.4.2 source and DEVS-120/121, 2026-10-04).

Never set `assignees` on `create`. Assign in a follow-up `manage_assignee` call:

- **The agent will work the issue itself:** add itself per Pick up above. Its notification emails reach the human through the agent's mailbox.
- **The issue needs action from the human** (a decision, a manual step, a review, credentials): assign the human so the email goes to them directly. Resolve their id with `mcp__plane__member` `action: "list_project"` (match the email `lbruton@pm.me`; never hardcode the id), then `manage_assignee` with `add_user_id`.
  - If the `create` response already lists the human in `assignees` (the project has them as default assignee), that assignment did not subscribe them. Call `manage_assignee` with `remove_user_id` first, then a **second** call with `add_user_id`. One call carrying both nets to no change.
- **Neither:** leave it as created. The human does not need to be on every issue.

Comments posted through the API notify **nobody** (the public API skips the notification step for comments and comment mentions). When the human must see something, make a state or property change alongside the comment, or assign them as above.

### List

```
mcp__plane__workitem
  action: "list"
  project_id: {plane_project_id}    # required on Community Edition
  expand: "state"
  per_page: 100                     # follow next_cursor while next_page_results is true
```

Filter client-side on `state.group` (`backlog` / `unstarted` / `started` / `completed` / `cancelled`). Do **not** pass `pql`: Community Edition doesn't support it, and the tool returns an `{"error": ...}` payload (with `isError: false`) instead of results. Omitting `project_id` returns 404 on CE.

### Notes

- Plane assigns `sequence_id` atomically — no counter file needed.
- Plane has first-class parent-child issues — pass `parent: {parent_uuid}` to `workitem` `create` and the child gets its own normal sequence_id (e.g. `SFLW-9` with parent `SFLW-3`).
- Plane's GitHub integration is configured at the workspace level. If the project has it wired up, syncing is automatic. Inbound GH bugs that need ingestion can be created directly via the same `workitem` `create` call.
- To cross-reference vault docs, paste wikilinks into the Plane issue's description (Plane preserves markdown).

---

## Prefix Registry

Authoritative source: each project's `.claude/project.json` (`issuePrefix` + `plane.projectId`). The table below is a convenience reference.

| Prefix | Project |
|---|---|
| `HOME` | HomeNetwork |
| `DEVS` | Devops |
| `SFLW` | SpecFlow |
| `RES` | autoresearch-mlx |
| `STRK` | StakTrakr |
| `HXTR` | HexTrackr |
| `FRGE` | Forge |
| `WOF` | WhoseOnFirst |
| `MELO` | MyMelo |
| `CFLOW` | claude-context (retired) |
| `PAPI` | PAPiTA |
| `SESF` | SessionFlow |
| `DOCV` | DocVault |
| `WWW` | Portfolio |

---

## Issue Creation Rules

Every code change needs an issue. Exceptions: instruction-file-only edits (CLAUDE.md, skills) and quick fixes for trivial changes.

The issue ID format `{PREFIX}-{NUM}` is used in commit messages, PR bodies, and version lock claims.
