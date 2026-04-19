---
description: "Spec-driven development orchestrator — Requirements → Design → Tasks → Implementation with dashboard approvals. Pass an issue ID (e.g., STAK-543) and optionally --resume."
---

You are running the spec workflow for issue $ARGUMENTS.

## Setup

1. Call `spec-workflow-guide` to load the full workflow
2. Call `spec-list` with query "$1" to check for existing spec
3. Read `.specflow/config.json` to resolve the specflow root path

## Workflow

If no existing spec: create Requirements → Design → Tasks → Implementation (Phases 1-4).
If existing spec with `--resume`: call `spec-status` to find current phase, resume there.

## MCP Tools Available

- `spec-workflow-guide` — load workflow instructions (call FIRST, every time)
- `spec-list` — search for existing specs by issue ID or title
- `spec-status` — check phase progress for a spec
- `approvals` — request/status/delete dashboard approval after each document
- `log-implementation` — record implementation artifacts (HARD GATE before marking tasks [x])

## Rules

- Read the template for each phase before writing any document
- Templates live in `DocVault/specflow/StakTrakr/templates/` (project override) or `DocVault/specflow/templates/` (global fallback)
- NEVER accept verbal approval — use the `approvals` tool with action:"request"
- Poll `approvals` with action:"status" until approved, then action:"delete" before proceeding
- Every task marked [x] MUST have a prior `log-implementation` call
- Spec documents go in `DocVault/specflow/StakTrakr/specs/{ISSUE-ID}-{kebab-title}/`
- Issues are in `DocVault/Projects/StakTrakr/Issues/`

## Phase Sequence

Phase 1 (Requirements) → approval → Phase 2 (Design) → approval → Phase 3 (Tasks) → approval → Phase 3.9 (Readiness Gate) → approval → Phase 4 (Implementation)

Read the spec-workflow-guide output for full details on each phase.
