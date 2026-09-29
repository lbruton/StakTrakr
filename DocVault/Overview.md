---
tags: []
doc_type: overview
project: StakTrakr
source: manual
created: "2026-04-26"
updated: "2026-09-28"
---

# StakTrakr

Precious metals inventory tracker — vanilla-JS PWA with offline-first localStorage, real-time spot prices, retail dealer monitoring, and encrypted Dropbox sync.

## At a Glance

| Field         | Value                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------ |
| Repo          | [lbruton/StakTrakr](https://github.com/lbruton/StakTrakr)                                        |
| Version       | Read `version.json` at the repo root — not repeated here so it cannot go stale                   |
| Issue Tracker | [Plane STRK](https://plane.lbruton.cc/lbruton/) (migrated 2026-04-26 — was `STAK-` historically) |
| PR Target     | `dev` (signed commits + PR + status checks required); `main` is release-only                     |

## Where the docs live

| Location                 | Audience | Holds                                                                  |
| ------------------------ | -------- | ---------------------------------------------------------------------- |
| `.context/*.md`          | Agents   | Canonical foundation + policy docs — index table in `CLAUDE.md`        |
| `.context/deep-dives/`   | Agents   | Subsystem reference (data model, pollers, API, vendor quirks, …)       |
| `DocVault/specs/`        | Humans   | Spec artifacts; completed specs under `specs/archive/` are historical |
| Private companion vault  | Humans   | Anything with LAN hosts, drift reports — resolve with `vault-path private` |

This vault holds specs only. Architecture, infrastructure, pipelines, and workflow live in
`.context/` — link there rather than restating them here. Source code wins over every document.

Pre-Plane issues live in the frozen central DocVault archive (`lbruton/DocVault`,
`Archive/Issues-Pre-Plane/StakTrakr/`); see `.context/issue-tracking.md`. Earlier vault notes
(research drafts, prime reports, release drafts, June drift reports) were removed on
2026-09-28 and remain in git history.
