---
tags: [index]
updated: "2026-09-28"
created: "2026-04-26"
---

# StakTrakr Index

Entry point for the in-repo vault. Start at [[Overview]]; agent-facing foundation docs are in `.context/` and `.context/deep-dives/` (see the table there). The pre-migration Foundation pages were never carried into this vault — they remain only in the frozen central DocVault archive as historical provenance.

## Vault contents

| Area                                     | What's there                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| [[Overview]]                             | One-page summary, doc-location map, pointers into `.context/`                      |
| `specs/`                                 | Spec artifacts; completed specs under `specs/archive/` are historical, not current |
| `Research/`                              | Exploratory notes — each carries a status/staleness banner; verify before relying  |
| `Audit/`                                 | Dated audits (historical snapshots)                                                |
| `Prime/`, `releases/`, `Reddit Replies/` | Dated session reports and drafts (historical)                                      |
| `drift-reports/`                         | Dated `.context` drift audits — see [[drift-reports/_Index]]                       |
| `reports/`                               | Dated vault audits — see [[reports/2026-09-28-staleness-audit]]                    |

## Agent docs in `.context/`

Architecture, infrastructure, coding standards, design philosophy, reusable patterns, data pipelines, cloud sync, testing, git topology, gotchas, and review/CI policy. Deep dives cover the API, data model, DOM patterns, health checks, pollers, image pipeline, provider database, retail modal, secret keys, and vendor quirks.
