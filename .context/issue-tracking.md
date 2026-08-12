---
title: "StakTrakr — Issue Tracking (Plane)"
project: StakTrakr
audience: agent
canonical: .context/issue-tracking.md
updated: "2026-08-12"
---

# Issue Tracking — Plane

Plane project: `https://plane.lbruton.cc/lbruton/projects/026dbe54-fe52-4a9f-9f1b-7edcb9bbdceb/`
(workspace `lbruton`, prefix **STRK**). Create issues via `/issue` or `mcp__plane__create_issue`.
Backend config lives in `.specflow/config.json`.

Pre-migration issues are archived at `DocVault/Archive/Issues-Pre-Plane/StakTrakr/`.

## State conventions

| State       | UUID (re-fetch if stale)                         | Use for                                               |
| ----------- | ------------------------------------------------ | ----------------------------------------------------- |
| Epic        | `0d1317b4-883f-44f0-b277-8f1f7f0388c0`           | Parent epic issues — appears in its own Kanban column |
| Todo        | `6f8780df-5ca8-4dc1-9951-fd96e9886647` (default) | Normal child issues not yet started                   |
| In Progress | `36cd8909-caa7-48ca-aeab-9f6cd4913740`           | Actively being worked                                 |
| In Review   | `1a90f64f-be80-42ae-aa82-dd8d3f28db88`           | Complete, awaiting review                             |
| Done        | `b6039898-c1c1-46ea-8396-1ae8b52f0692`           | Merged / closed                                       |
| Backlog     | `fc9a6f2f-7152-43ee-8f8d-95a05d9b2480`           | Parked, not yet scheduled                             |
| Cancelled   | `7645f387-5f01-4395-9f40-03d75fda6fda`           | Won't fix                                             |

## Conventions

- When creating an epic, set state to **Epic**. Child issues inherit the standard states:
  Todo → In Progress → In Review → Done.
- UUIDs are convenience references. Re-fetch via `mcp__plane__list_states` if a session
  boundary or compaction may have introduced drift.
- Mark issues Done only after the PR merges.
- Issue scans: use `mcp__plane__list_project_issues` scoped to this project — no
  cross-project globs unless the user asks.
- `list_project_issues` omits the `parent` field — an epic can look childless (false 0);
  fetch per-issue when counting children.
- Plane comments are **plain text only** and permanent — no edit or delete anywhere.
