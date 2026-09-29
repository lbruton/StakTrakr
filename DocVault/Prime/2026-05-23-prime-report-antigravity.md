---
branch: dev
date: '2026-05-23'
doc_type: prime-report
project: StakTrakr
tags:
  - staktrakr
version: 3.34.79
---
# Prime Report — StakTrakr (2026-05-23)
Branch: dev | Status: clean (1 untracked: `.cgcignore`) | Version: 3.34.79 | Sync: even
mem0: 14 records (post-filtered from 20 raw, project=staktrakr)

## Recent Activity

### Recent Commits (last 15)
| Date | Commit | Message |
|------|--------|---------|
| May 23 | `5397e105` | chore: update CLAUDE.md with /review-claudemd session findings (#1144) |
| May 22 | `6fc77870` | chore: update GEMINI.md with mcpvault-docvault usage (#1142) |
| May 22 | `27ac8cd7` | v3.34.79 — STRK-74: Align inline chip config to saveData wrapper (#1143) |
| May 22 | `4b8a7a7f` | v3.34.78 — STRK-92: Fill 90-day Market History All view with per-vendor data (#1141) |
| May 21 | `68690b03` | chore: update instructions for Perplexity and SessionFlow (#1140) |
| May 21 | `c3fb2488` | v3.34.77 — STRK-93: Fix header Spot button 4× API sync (#1138) |
| May 21 | `ebe78b5b` | chore: document specflow approval filePath constraint in CLAUDE.md (#1137) |
| May 21 | `dbca64c1` | v3.34.76 — STRK-89: Add gold-api.com as first-class spot price provider (#1136) |
| May 20 | `8364d1f0` | v3.34.75 — STRK-88: Lot/each purchase price rounding and CSV normalization (#1135) |
| May 19 | `b8e30f1b` | v3.34.74 — STRK-87: Harden Add Item Numista reset state (#1134) |
| May 19 | `6e255347` | fix(STRK-84): Show Numista tag preview chips in Add mode (#1133) |
| May 18 | `7c083e4c` | v3.34.73 — STRK-84: Numista picker tags applied on first Fill Fields for new items (#1131) |
| May 18 | `7571baa4` | chore: fetch full Numista detail on search result click (#1130) |
| May 18 | `f6f0c05c` | v3.34.72 — STRK-48: Per-oz/per-coin premium in Item Detail modal (#1129) |
| May 17 | `9dd098ed` | chore: remove orphaned superpowers plugin hook, refresh CLAUDE.md notes (#1128) |

### Open PRs
No open PRs.

### Hot Files (most-changed in 7 days)
| Changes | File |
|---------|------|
| 13 | sw.js |
| 11 | CHANGELOG.md |
| 11 | js/about.js |
| 11 | js/constants.js |
| 11 | package.json |
| 11 | version.json |
| 10 | package-lock.json |
| 6 | data/spot-history-2026.json |
| 6 | data/spot-history-bundle.js |
| 4 | CLAUDE.md |
| 4 | js/events.js |
| 3 | js/catalog-api.js |

### This Week by the Numbers
| Metric | Count |
|--------|-------|
| Issues completed | 11 |
| GitHub issues closed | 0 (Plane-only tracking) |
| Commits (7d) | 18 |
| Version range | v3.34.69 → v3.34.79 (11 patches) |

## Where We Left Off
We completed a solid sprint of 11 patches (v3.34.69 to v3.34.79) addressing 11 key issues. Feature highlights include `STRK-74` (aligning inline chip config to the `saveData` wrapper), `STRK-92` (filling the 90-day Market History All view with per-vendor data), and `STRK-89` (integrating gold-api.com as a first-class spot price provider). The last session concluded with minor chores updating instructions in `CLAUDE.md` and `GEMINI.md` to document the new `mcpvault-docvault` constraints. 
The immediate path forward points to `STRK-91` (bulk editor mobile viewport usability) and `STRK-90` (field parity audit). Workflow rules are stable: always run patch flows within versioned worktrees, bump release artifacts in sync, and execute specs autonomously.

## Index Health
| Tool | Status | Details |
|------|--------|---------|
| claude-context | Fresh | 106 files, 2991 chunks (Last updated: 5/22/2026, 6:40:39 PM) |
| CGC (Neo4j) | Up | StakTrakr indexed (15 repos total) |

## Code Health (code-oracle)

### Dead Code
| File | Symbol | Line | Confidence |
|------|--------|------|------------|
| `devops/pollers/home-poller/dashboard.js` | `renderCoverageCards_LEGACY` | 718 | High — Grep-verified unreferenced |
| `devops/pollers/home-poller/dashboard.js` | `renderFailureTrendChart_LEGACY` | 1041 | High — Grep-verified unreferenced |
| `devops/pollers/home-poller/dashboard.js` | `checkTursoBackup` | 92 | Medium — Might be wired via configuration |
| `devops/pollers/shared/api-export.js` | `formatSpotRow` | 1045 | Low — Legacy export path support |
| `devops/pollers/shared/capture.js` | `captureCoin` / `captureAll` | 457, 546 | Low — Scraper entry points |

### Complexity Hotspots
| File | Function/Area | Complexity (Branches) |
|------|---------------|-----------------------|
| `js/events.js:2160` | `setupItemFormListeners` | 293 |
| `js/cloud-sync.js:3214` | `pullWithPreview` | 211 |
| `js/catalog-api.js:1453` | `renderNumistaFieldCheckboxes` | 187 |
| `js/inventory.js:1437` | `editItem` | 186 |
| `js/inventory-import.js:253` | `importCsv` | 168 |

### Convention Issues
| File | Finding |
|------|---------|
| `js/events.js` | `innerHTML` usage in `b8e30f1b` (should be `textContent` or template elements) |
| `js/catalog-api.js` | Raw `document.getElementById` in `6e255347` (should be `safeGetElement`) |
| `js/catalog-api.js` | Raw `document.getElementById` in `7c083e4c` (should be `safeGetElement`) |

## Security Reviews
Latest formal review on file is 2026-03-28 under deprecated security docs (`Projects/StakTrakr/Depreciated/2026-03-28.md`). It flagged the public frontend as moderate risk and the internal admin plane as weaker, especially the unauthenticated home-poller dashboard.
⚠ Review is stale (56 days old) — consider scheduling a new scan.

## Codacy Findings (live scan)

### Security (SRM)
No open security findings.

**Summary:** 0 Critical, 0 High | 0 Overdue

### Critical Code Quality Issues
No critical code quality issues.

## Project Status

### Active Specs
No active specs (all completed specs are archived).

### Pending Approvals
| Spec | Status | Note |
|------|--------|------|
| `STRK-44-partial-stack-disposition/tasks.md` | concerns | Tasks revision 2 approval still not clean (minor note on Task 14 minimal CSS touch map alignment) |

### Open Bugs (by priority)
| Priority | Issue | Summary |
|----------|-------|---------|
| High | STRK-91 | Bulk editor not usable on mobile/small viewports |
| Medium | STRK-85 | Market ticker: goldback premium % missing + tiered premium color thresholds |
| Medium | STRK-83 | Align isDisposed() and direct disposition checks for empty-object payloads |

### Open Features / Todo
| Priority | Issue | Summary |
|----------|-------|---------|
| Medium | STRK-90 | Bulk editor field parity audit + mobile viewport fixes |
| Medium | STRK-72 | Chip parity audit across all 4 inventory views |
| Medium | STRK-58 | Goldback scraper: increase poll frequency to match retail cadence |

### Backlog
| Issue | Summary |
|-------|---------|
| STRK-82 | Byparr sidecar health watchdog + nightly recycle |
| STRK-32 | Refactor price-extract.js — isolate vendor scraping into per-vendor modules |

## Suggested Session Plan
1. **STRK-91 (High) & STRK-90 (Medium)** — Start the patch session for the mobile bulk editor viewport fixes and the field parity audit.
2. **Reconcile STRK-44 (Concerns)** — Address the approval concern on the partial stack disposition tasks list before starting implementation.
3. **STRK-85 (Medium)** — Implement goldback premium percentage and color thresholds in the market ticker.
4. **Hardening & Security Triage** — Triage the stale 2026-03-28 security findings, focusing on adding auth/restrictions to the home-poller dashboard control plane.
5. **Handle `.cgcignore`** — Commit or clean up the untracked `.cgcignore` file in the next patch PR.
