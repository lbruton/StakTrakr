---
name: plane-archive
description: >
  Archive Done and Cancelled Plane issues for the current project. Sets
  `archived_at` on each qualifying issue via `mcp__plane__update_issue`.
  Triggers on: "plane archive", "archive done issues", "archive cancelled issues",
  "clean up plane", "plane cleanup".
user-invocable: true
allowed-tools: Read, Bash, mcp__plane__list_states, mcp__plane__list_project_issues, mcp__plane__update_issue
---

# Plane Archive

Archive all unarchived issues in **Done** or **Cancelled** state for the current
Plane project. Plane archive is a soft archive: issues move out of active views
but are not deleted, and they can be unarchived from Plane later.

## Step 0: Resolve Project Config

Read `.specflow/config.json` from the current working directory:

```bash
cat .specflow/config.json
```

Extract:

- `plane_project_id` — Plane project UUID to query and update
- `issue_prefix` — project issue prefix for reporting
- `project` — project display name when present

If `.specflow/config.json` is missing or does not contain `plane_project_id`,
stop and ask the user for the Plane project UUID.

## Step 1: Fetch States

Call `mcp__plane__list_states` with the project ID:

```text
mcp__plane__list_states(project_id: "<plane_project_id>")
```

Identify the state UUIDs for Done and Cancelled states. Treat a state as an
archive target when either:

- its `group` is `completed` or `cancelled`, or
- its display/name field matches `Done` or `Cancelled` case-insensitively

Store these UUIDs as `ARCHIVE_STATE_IDS`. Keep a mapping from each UUID to its
state label so the final report can split Done and Cancelled counts.

If no matching states are found, report that Done/Cancelled states could not be
identified and stop without updating issues.

## Step 2: List Project Issues

Call `mcp__plane__list_project_issues` with the project ID:

```text
mcp__plane__list_project_issues(project_id: "<plane_project_id>")
```

Use the complete returned issue list for filtering. Do not use Linear, DocVault
issue files, or local markdown as the source of active issue state.

## Step 3: Filter Candidates

Select issues where:

- `state.id` is in `ARCHIVE_STATE_IDS`
- `archived_at` is `null` or otherwise unset

Exclude issues that already have `archived_at` set.

Report the candidate count before doing any updates:

```text
Found N issues in Done/Cancelled state ready to archive.
```

If `N` is `0`, report:

```text
Nothing to archive: all Done/Cancelled issues are already archived or none exist.
```

Then stop.

## Step 4: Confirm With User

Ask the user to confirm before archiving. Include:

- total candidate count
- Done count
- Cancelled count
- up to 5 sample issue identifiers and names

Example confirmation prompt:

```text
Found 18 unarchived STRK issues in Done/Cancelled state: 14 Done, 4 Cancelled.
Sample: STRK-101 Fix settings save, STRK-98 Retire old feed, ...
Proceed with archiving these issues?
```

Do not archive until the user confirms. If the user explicitly pre-approved a
scheduled or unattended cleanup run, this confirmation step may be skipped.

## Step 5: Archive Candidates

Use today's local date in `YYYY-MM-DD` format for `archived_at`.

For each candidate issue, call `mcp__plane__update_issue`:

```json
{
  "project_id": "<plane_project_id>",
  "issue_id": "<issue_uuid>",
  "issue_data": {
    "archived_at": "<YYYY-MM-DD>"
  }
}
```

Run update calls in parallel when the tool environment supports it. Otherwise,
run them sequentially and keep going after individual failures.

## Step 6: Report Results

Report:

- total archived count
- Done archived count
- Cancelled archived count
- project name or issue prefix
- any failures with issue identifier/name and the error

Use this success shape:

```text
Archived N issues (Done: X, Cancelled: Y) for <project_name_or_prefix>.
```

## Notes

- This does not delete issues.
- To unarchive an issue, set `archived_at` to `null` via
  `mcp__plane__update_issue`.
- The skill is safe to run repeatedly because already-archived issues are
  skipped during candidate filtering.
- If Plane MCP calls fail in a likely transient way, wait about 60 seconds and
  retry once before switching approach.
