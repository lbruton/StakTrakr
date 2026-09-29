---
doc_type: prime-report
tags:
  - staktrakr
project: StakTrakr
date: "2026-05-23"
branch: dev
version: 3.34.79
---

# Prime Report — StakTrakr (2026-05-23)

Branch: dev | Status: clean (1 untracked: `.cgcignore`) | Version: 3.34.79 | Sync: even
mem0: 14 records (post-filtered from 20 raw, project=staktrakr)

## Recent Activity

### Recent Commits (last 15)

| Date   | Commit     | Message                                                                              |
| ------ | ---------- | ------------------------------------------------------------------------------------ |
| May 23 | `5397e105` | chore: update CLAUDE.md with /review-claudemd session findings (#1144)               |
| May 22 | `6fc77870` | chore: update GEMINI.md with mcpvault-docvault usage (#1142)                         |
| May 22 | `27ac8cd7` | v3.34.79 — STRK-74: Align inline chip config to saveData wrapper (#1143)             |
| May 22 | `4b8a7a7f` | v3.34.78 — STRK-92: Fill 90-day Market History All view with per-vendor data (#1141) |
| May 21 | `68690b03` | chore: update instructions for Perplexity and SessionFlow (#1140)                    |
| May 21 | `c3fb2488` | v3.34.77 — STRK-93: Fix header Spot button 4x API sync (#1138)                       |
| May 21 | `ebe78b5b` | chore: document specflow approval filePath constraint in CLAUDE.md (#1137)           |
| May 21 | `dbca64c1` | v3.34.76 — STRK-89: Add gold-api.com as first-class spot price provider (#1136)      |
| May 20 | `8364d1f0` | v3.34.75 — STRK-88: Lot/each purchase price rounding and CSV normalization (#1135)   |
| May 19 | `b8e30f1b` | v3.34.74 — STRK-87: Harden Add Item Numista reset state (#1134)                      |
| May 19 | `6e255347` | fix(STRK-84): Show Numista tag preview chips in Add mode (#1133)                     |
| May 18 | `7c083e4c` | v3.34.73 — STRK-84: Numista picker tags applied on first Fill Fields (#1131)         |
| May 18 | `7571baa4` | chore: fetch full Numista detail on search result click (#1130)                      |
| May 18 | `f6f0c05c` | v3.34.72 — STRK-48: Per-oz/per-coin premium in Item Detail modal (#1129)             |
| May 17 | `9dd098ed` | chore: remove orphaned superpowers plugin hook (#1128)                               |

### Open PRs

No open PRs.

### Hot Files (most-changed in 7 days)

| Changes | File                                                                   |
| ------- | ---------------------------------------------------------------------- |
| 13      | sw.js                                                                  |
| 11      | version.json, package.json, js/constants.js, js/about.js, CHANGELOG.md |
| 10      | package-lock.json                                                      |
| 6       | data/spot-history-bundle.js                                            |
| 4       | js/events.js, CLAUDE.md                                                |
| 3       | js/catalog-api.js                                                      |

### This Week by the Numbers

| Metric               | Count                            |
| -------------------- | -------------------------------- |
| Issues completed     | 8                                |
| GitHub issues closed | 0 (Plane-only tracking)          |
| Commits (7d)         | 18                               |
| Version range        | v3.34.69 → v3.34.79 (11 patches) |

## Where We Left Off

This has been a prolific week — 8 issues shipped across 11 patches. The most recent feature work was STRK-74 (align inline chip config to `saveData` wrapper) and STRK-92 (fill 90-day Market History All view with per-vendor data), both merged May 22. The last commit today (May 23) was a chore updating CLAUDE.md from a `/review-claudemd` session. The STRK-89 spec (gold-api.com spot provider) is fully implemented (15/15 tasks) but not yet archived. The open Todo queue is led by STRK-91 (bulk editor mobile viewport — High priority) with STRK-85 and STRK-90 as medium-priority follow-ups. A retro learning from recent sessions confirms the user prefers fully autonomous spec-to-PR execution, stopping only for genuinely ambiguous decisions.

## Index Health

| Tool           | Status | Details                                         |
| -------------- | ------ | ----------------------------------------------- |
| claude-context | Fresh  | 106 files, 2991 chunks (indexed May 22 6:40 PM) |
| CGC (FalkorDB) | Up     | StakTrakr indexed (15 repos total)              |

## Code Health (code-oracle)

### Dead Code

| File                                      | Symbol                           | Line     | Confidence                                          |
| ----------------------------------------- | -------------------------------- | -------- | --------------------------------------------------- |
| `devops/pollers/home-poller/dashboard.js` | `renderCoverageCards_LEGACY`     | 718      | High — `_LEGACY` suffix, grep-verified unreferenced |
| `devops/pollers/home-poller/dashboard.js` | `renderFailureTrendChart_LEGACY` | 1041     | High — `_LEGACY` suffix, grep-verified unreferenced |
| `devops/pollers/home-poller/dashboard.js` | `checkTursoBackup`               | 92       | Medium — may be wired via config                    |
| `devops/pollers/shared/api-export.js`     | `formatSpotRow`                  | 1045     | Low — may serve v1 export path                      |
| `devops/pollers/shared/capture.js`        | `captureCoin` / `captureAll`     | 457, 546 | Low — may be entry points                           |

No dead code detected in `js/` frontend app files — all findings are in `devops/pollers/`.

### Complexity Hotspots

| File                     | Est. Branch Count | Assessment                                |
| ------------------------ | ----------------- | ----------------------------------------- |
| js/events.js             | 1032              | Highest — large event-wiring + logic file |
| js/inventory.js          | 729               | High — item CRUD, validation, bulk-edit   |
| js/api.js                | 660               | High — multi-provider spot fetch, retry   |
| js/settings-listeners.js | 496               | Medium-high — provider toggle, sync       |
| js/retail.js             | 312               | Medium — retail fetch, vendor table       |

### Convention Violations (Last 7 Days)

| Commit     | File              | Violation                                                                           |
| ---------- | ----------------- | ----------------------------------------------------------------------------------- |
| `6e255347` | js/catalog-api.js | Raw `document.getElementById` instead of `safeGetElement()`                         |
| `7c083e4c` | js/catalog-api.js | Raw `document.getElementById` instead of `safeGetElement()`                         |
| `b8e30f1b` | js/events.js      | `innerHTML` with hardcoded string (safe but deviates from `textContent` convention) |

Note: The `catalog-api.js` calls may be intentional if they run at parse time (same constraint as `events.js` top-level code documented in CLAUDE.md).

## Security Reviews

No security reviews on file.

## Codacy Findings (live scan)

### Security (SRM)

No open security findings.

**Summary:** 0 Critical, 0 High | 0 Overdue

### Critical Code Quality Issues

No critical code quality issues.

## Project Status

### Active Specs

| Spec                                 | Phase   | Tasks | Status                   |
| ------------------------------------ | ------- | ----- | ------------------------ |
| STRK-89 (gold-api.com spot provider) | Phase 4 | 15/15 | Complete — needs archive |

### Pending Approvals

No pending approvals.

### Open Bugs (by priority)

No open bugs in current queue.

### Open Features / Todo

| Priority | Issue   | Summary                                                                     |
| -------- | ------- | --------------------------------------------------------------------------- |
| High     | STRK-91 | Bulk editor not usable on mobile/small viewports                            |
| Medium   | STRK-90 | Bulk editor field parity audit + mobile viewport fixes                      |
| Medium   | STRK-85 | Market ticker: goldback premium % missing + tiered premium color thresholds |

### Backlog

| Issue   | Summary                                                                     |
| ------- | --------------------------------------------------------------------------- |
| STRK-83 | Align isDisposed() and direct disposition checks for empty-object payloads  |
| STRK-82 | Byparr sidecar health watchdog + nightly recycle                            |
| STRK-72 | Chip parity audit across all 4 inventory views                              |
| STRK-58 | Goldback scraper: increase poll frequency to match retail cadence           |
| STRK-32 | Refactor price-extract.js — isolate vendor scraping into per-vendor modules |

### Stale Done Issues (need Plane cleanup)

STRK-49, STRK-48, STRK-86, STRK-79, STRK-78 — marked Done but still showing as open in Plane.

## Suggested Session Plan

1. **Archive STRK-89 spec** — 15/15 tasks complete, needs `/sketch archive` to clean up
2. **STRK-91 (High)** — Bulk editor mobile viewport; highest-priority open Todo, ready for `/start-patch`
3. **STRK-85** — Market ticker goldback premium % — quick UI enhancement on an active component
4. **Clean up stale Done issues** — 5 Plane issues marked Done but not closed; quick triage pass
5. **Convention check** — 3 recent `getElementById` / `innerHTML` deviations in catalog-api.js and events.js worth reviewing
