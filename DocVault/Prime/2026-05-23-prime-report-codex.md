---
doc_type: prime-report
tags: [staktrakr]
project: StakTrakr
date: "2026-05-23"
branch: dev
version: 3.34.79
---

# Prime Report — StakTrakr (2026-05-23)

Branch: dev | Status: dirty (`?? .cgcignore`) | Version: 3.34.79 | Sync: even
mem0: 14 records (post-filtered from 20 raw, project=staktrakr)

## Recent Activity

### Recent Commits (last 15)

| Date       |     Commit | Message                                                                              |
| ---------- | ---------: | ------------------------------------------------------------------------------------ |
| 2026-05-23 | `5397e105` | chore: update CLAUDE.md with /review-claudemd session findings (#1144)               |
| 2026-05-22 | `6fc77870` | chore: update GEMINI.md with mcpvault-docvault usage (#1142)                         |
| 2026-05-22 | `27ac8cd7` | v3.34.79 — STRK-74: Align inline chip config to saveData wrapper (#1143)             |
| 2026-05-22 | `4b8a7a7f` | v3.34.78 — STRK-92: Fill 90-day Market History All view with per-vendor data (#1141) |
| 2026-05-21 | `c3fb2488` | v3.34.77 — STRK-93: Fix header Spot button 4x API sync (#1138)                       |
| 2026-05-21 | `dbca64c1` | v3.34.76 — STRK-89: Add gold-api.com as first-class spot provider (#1136)            |
| 2026-05-20 | `8364d1f0` | v3.34.75 — STRK-88: Lot/each purchase price rounding (#1135)                         |

### Open PRs

No open PRs.

### Hot Files (most-changed in 7 days)

| Changes | File                                                                             |
| ------: | -------------------------------------------------------------------------------- |
|      13 | `sw.js`                                                                          |
|      11 | `version.json`, `package.json`, `js/constants.js`, `js/about.js`, `CHANGELOG.md` |
|      10 | `package-lock.json`                                                              |
|       6 | `data/spot-history-bundle.js`, `data/spot-history-2026.json`                     |

### This Week by the Numbers

| Metric                       |                Count |
| ---------------------------- | -------------------: |
| Issues referenced in commits |                    8 |
| Commits since 2026-05-18     |                   13 |
| Open PRs                     |                    0 |
| Plane issues returned        |                   21 |
| Version range                | v3.34.72 -> v3.34.79 |

## Where We Left Off

SessionFlow is healthy across providers, but project-scoped semantic recall surfaced stale April/March handoff hits rather than a current May handoff. The live repo shows a recent run of tightly scoped StakTrakr patches through v3.34.79, with no open PRs and no active worktrees. The active issue surface points next toward STRK-91/STRK-90 bulk editor mobile/parity work, STRK-85 market ticker premium display, and cleanup of the lingering STRK-44 approval concern. mem0 reinforces the workflow guardrails: create the versioned worktree before implementation or external handoff, and run spec-to-PR flows autonomously unless something is genuinely ambiguous.

## Carry-Forward Notes

- `.cgcignore` is intentional. Include it in the next appropriate StakTrakr PR rather than deleting it as stray local noise.

## Index Health

| Tool           | Status | Details                                                   |
| -------------- | ------ | --------------------------------------------------------- |
| claude-context | Fresh  | 106 files, 2991 chunks; last updated 2026-05-22 18:40     |
| CGC (Neo4j)    | Up     | StakTrakr indexed; complexity/dead-code queries succeeded |

## Code Health (code-oracle)

### Dead Code

| File                   | Function                         | Note                                         |
| ---------------------- | -------------------------------- | -------------------------------------------- |
| `js/retail.js:576`     | `_processSlugResult`             | Only definition found outside generated docs |
| `js/spot.js:465`       | `updateManualSpot`               | No callsites found                           |
| `js/api.js:740`        | `setupProviderSettingsListeners` | Only definition found                        |
| `js/api.js:859`        | `refreshProviderStatuses`        | Only definition found                        |
| `js/inventory.js:2005` | `toggleGlobalPriceView`          | Deprecated compat export only                |

### Complexity Hotspots

| File                          | Function/Area                  | Signal |
| ----------------------------- | ------------------------------ | -----: |
| `js/inventory-import.js:266`  | `importCsv` complete callback  |   ~148 |
| `js/inventory.js:1437`        | `editItem`                     |   ~132 |
| `js/inventory-import.js:1202` | `importJson` onload callback   |   ~128 |
| `js/catalog-api.js:1453`      | `renderNumistaFieldCheckboxes` |    ~88 |
| `js/viewModal.js:1399`        | `loadViewNumistaData`          |    ~84 |

### Convention Issues

| File                            | Finding                                     |
| ------------------------------- | ------------------------------------------- |
| `js/settings-listeners.js:898`  | Uses `var` in `renderCloudBackupList`       |
| `js/settings-listeners.js:1056` | Dense `var` block / old callback style      |
| `js/filters.js:347`             | Uses `var` in `renderActiveFilters`         |
| `js/init.js:552`                | Uses `var` in recovery boot path            |
| `js/settings.js:1576`           | Uses `var historySelect`; should be `const` |

## Security Reviews

Latest formal review on file is 2026-03-28 under deprecated security docs. It flagged the public frontend as moderate risk and the internal admin plane as weaker, especially the unauthenticated home-poller dashboard.

Review is stale — consider scheduling a new scan.

## Codacy Findings (live scan)

### Security (SRM)

No open Critical/High SRM findings.

**Summary:** 0 Critical, 0 High | 0 Overdue

### Critical Code Quality Issues

No critical `security` or `errorprone` code quality issues.

## Project Status

### Active Specs

| Spec                                           | Status                                  | Tasks |
| ---------------------------------------------- | --------------------------------------- | ----: |
| `STRK-89-add-gold-api-com-spot-price-provider` | completed, still in active specs folder | 15/15 |

### Pending Approvals

| Spec                                         | Status   | Note                                      |
| -------------------------------------------- | -------- | ----------------------------------------- |
| `STRK-44-partial-stack-disposition/tasks.md` | concerns | Tasks revision 2 approval still not clean |

### Priority 1 — Blocking

| Issue           | Priority | Summary                                                      |
| --------------- | -------- | ------------------------------------------------------------ |
| STRK-91         | high     | Bulk editor not usable on mobile/small viewports             |
| Security review | high     | Home-poller dashboard unauthenticated internal admin surface |
| STRK-44         | concerns | Approval state needs reconciliation before phase movement    |

### Open Bugs (by priority)

| Priority | Issue   | Summary                                                   |
| -------- | ------- | --------------------------------------------------------- |
| high     | STRK-91 | Bulk editor not usable on mobile/small viewports          |
| medium   | STRK-85 | Market ticker goldback premium missing / color thresholds |
| medium   | STRK-83 | Align disposed checks for empty-object payloads           |

### Open Features / Todo

| Priority | Issue   | Summary                                                |
| -------- | ------- | ------------------------------------------------------ |
| medium   | STRK-90 | Bulk editor field parity audit + mobile viewport fixes |
| medium   | STRK-72 | Chip parity audit across inventory views               |
| medium   | STRK-58 | Goldback scraper poll frequency                        |

### Backlog

| Issue   | Summary                                           |
| ------- | ------------------------------------------------- |
| STRK-82 | Byparr sidecar health watchdog + nightly recycle  |
| STRK-32 | Refactor price extraction into per-vendor modules |

## Suggested Session Plan

1. Triage STRK-91 / STRK-90 as the next likely implementation lane: mobile bulk editor usability plus field parity.
2. Reconcile the pending STRK-44 approval concern before advancing any related spec work.
3. Archive or move completed `STRK-89-add-gold-api-com-spot-price-provider` out of active specs.
4. Schedule a fresh security review for the home-poller/admin-plane findings.
5. Include intentional `.cgcignore` in the next appropriate app PR, or commit it separately if it becomes its own scoped change.
