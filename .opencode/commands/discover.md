---
description: "Structured research phase (Phase 1) — takes an issue ID, runs codebase analysis, produces a Discovery Brief. Bridges /chat and /spec."
---

Run structured discovery for issue $ARGUMENTS.

## Setup

1. Read `.specflow/config.json` to resolve paths
2. Read the issue file from `DocVault/Projects/{project}/Issues/{ISSUE-ID}.md`
3. Search mem0 for prior context on this topic

## Research Steps

1. **Codebase analysis** — grep/glob for related files, functions, patterns
2. **Existing patterns** — how does the codebase handle similar features?
3. **Impact assessment** — which files would be affected?
4. **Open questions** — what needs answering before we can spec this?
5. **Competing approaches** — propose 2-3 approaches with pros/cons

## Output

Write a Discovery Brief to:
`DocVault/specflow/{project}/specs/{ISSUE-ID}-{kebab-title}/discovery.md`

Submit for dashboard approval via the `approvals` MCP tool.

## Rules

- Read-only on source code — no edits
- Discovery brief goes in the spec directory even though no spec exists yet
- All blocking questions must be resolved before recommending /spec
