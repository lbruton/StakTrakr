---
title: "StakTrakr DocVault Staleness Audit — 2026-09-28"
type: audit
project: StakTrakr
created: 2026-09-28
source_commit: 731b29a8
tags:
  - docvault
  - audit
  - staleness
---

# StakTrakr DocVault Staleness Audit — 2026-09-28

## Summary

The clearest current-state drift is in the DocVault navigation pages and research notes still marked active. The overview describes the pre-migration Foundation tree, advertises an obsolete audit command, and reports an old app version. A test-suite roadmap still presents May inventory as current. Several exploratory plans contain expired dates or assumptions that have changed in the code.

The dated Prime reports, release drafts, clippings, and prior drift reports are historical records. Their old facts should remain intact as history, but their pages should be understood as snapshots rather than current operating guidance.

## Scope and method

- Audited the DocVault entry pages, research/status-bearing material, dated reports, and Markdown links; searched the full vault for legacy path and API tokens.
- Before adding this report, the vault contained 24 Markdown files outside specs, plus 187 Markdown files in 47 directories under specs/archive. There are no active spec directories.
- Cross-checked current claims against the checked-out source at commit 731b29a8, especially version metadata, API endpoints, supported metals, poller defaults, and the Playwright inventory.
- Archived specs and dated captures were checked structurally and by targeted search, not revalidated line by line. They record past decisions and acceptance criteria and should not be treated as current requirements.
- This report does not validate remote sqld contents, deployed environment overrides, live site behavior, third-party product URLs, pricing, or terms of service. It does not reproduce credentials or environment-specific network values.

## Findings

### High — The main navigation still points to the retired Foundation layout

[[Overview]] calls Projects/StakTrakr/Foundation the canonical documentation location, points readers to Foundation/Deep Dives, invokes /vault-drift, and links to the old pre-Plane issue archive (lines 38–75). Those locations are not present under this project DocVault. The repository’s current agent-facing references are in .context/ and .context/deep-dives/; the global workflow guidance retires /vault-drift.

The newer [[StakTrakr]] index still labels the Overview archived and lists Foundation and subpages as archived sources (lines 8–39), although those are not files in the in-repo vault. This sends readers away from the current .context documentation. Overview also reports npm version 3.35.6 (line 22), while version.json reports 3.36.34.

**Suggested correction:** Rework Overview and StakTrakr as in-repo entry points. Link to the current .context pages, identify archived material as historical provenance, remove obsolete commands, replace the old archive pointer with a supported portable link, and avoid maintaining a release version in a long-lived overview.

### Medium — The drift-report index uses a workstation-specific link

[[drift-reports/_Index]] links to the 2026-08-13 report through an absolute local filesystem path outside this repository (line 11). The target currently exists in the shared DocVault, so the report content is not missing; the index link is tied to one workstation and does not travel with this project checkout.

**Suggested correction:** Replace it with a vault-resolvable link to the shared report, or add a project-local copy if this index is intended to be self-contained.

### High — The test-consolidation roadmap’s current inventory is stale

[[Research/Test Suite Consolidation Roadmap]] is still marked status active and describes 715 tests in 61 files as the current landscape (lines 4, 18, and 24–36). In this checkout, tests/playwright/core and tests/playwright/extended contain 40 active spec files with 822 test() declarations. The 58 issue-acceptance spec files under tests/playwright/archive are historical inventory. playwright.config.js still defaults to one worker, so that part of the roadmap remains accurate.

The canonical .context/deep-dives/playwright-suite-rationalization.md already labels its May snapshot as historical and directs readers to the live coverage map and test tree. The DocVault research copy does not carry that warning.

**Suggested correction:** Mark the DocVault copy as a historical proposal, remove its current-inventory wording, and rebase any remaining recommendations on tests/playwright/coverage-map.csv and the active test tree.

### Medium — Monetization research uses an old API fallback hostname and stale source line numbers

[[Research/StakTrakr API Sponsor Tier - Monetization Research]] describes the API pair as api.staktrakr.com plus api1.staktrakr.com and reasons about api1 as the GitHub Pages fallback (lines 18 and 150–162). The current frontend endpoint list is api.staktrakr.com and api2.staktrakr.com in js/constants.js:653–660; the fallback architecture described in the research no longer matches source.

The cited About-page locations have also shifted: the quoted public copy is still present, but now appears around index.html:6675 and 6730 and about.html:537, rather than the research’s old line references (lines 32–35 and 50). The brief also retains a March 2026 timing assumption (line 207) and April research on competitor pricing and vendor terms. Those external claims were not rechecked here.

**Suggested correction:** Update the endpoint description and source anchors before using the brief. Keep its exploratory, non-decision status, and refresh external pricing and terms research before making product or legal decisions.

### Medium — Spot Deals research says palladium support is still upcoming

[[Research/Spot Deals Feature Research]] says the app tracks gold, silver, and platinum, with palladium “soon” (line 44). Palladium is already present in the live spot-provider symbol map and metal configuration in js/constants.js:19–24 and 2127–2133. The Spot Deals concept itself remains research; this audit found no implementation to treat as committed product behavior.

**Suggested correction:** Update the supported-metal statement and retain a clear draft label for the unimplemented concept. Recheck the dealer and promotion claims before using its external research.

### Medium — Reddit automation plan conflicts with the current release gate

[[Research/Reddit Weekly Update Automation Research]] proposes shipping dev to main every weekend (lines 17–19 and 28), while current project instructions require an explicit user release signal. Its Infisical instructions also use the project slug; current project guidance requires the UUID binding because the slug lookup fails (lines 25 and 88–90).

The note remains a draft. No reddit-weekly implementation was found in the repository, so its “no code written” statement remains accurate for this checkout.

**Suggested correction:** Keep posting as a separately approved follow-up, remove the implied automatic weekly release cadence, and update the secret-store reference to the current approved binding before anyone implements the plan.

### Medium — The May MCP audit recommends a retired analysis tool

[[Audit/2026-05-22-mcp-exploration]] recommends CGC for call tracing, dead-code analysis, and complexity work (sections 1 and 7, especially lines 182–197). The current project instructions retire code-graph-context and say not to re-add it. The audit is dated, but the recommendation is phrased as reusable guidance.

**Suggested correction:** Mark the CGC sections as historical and direct readers to current code-search guidance.

### Medium — The new-items research schedule has expired and URLs remain unverified

[[Research/New Items and Vendors Research]] schedules work for late May and mid-June 2026 and labels its product URLs “NEEDS VERIFY” (lines 13–15, 50–107, and 150–174). Those target dates have passed, and the research still does not establish that the URLs were checked.

The document’s baseline of 11 coins and 7 providers still matches the repository defaults in devops/pollers/shared/capture.js:49–61. The proposed additions are not in those defaults. Runtime sqld data and deployment overrides are outside this source checkout, so this finding does not establish their deployed state.

**Suggested correction:** Mark the schedule expired and verify current URLs and runtime provider data before resuming the proposal. Preserve the baseline counts as code defaults, not a guaranteed live catalog.

## Historical material and non-findings

- The three reports dated 2026-05-23 ([[Prime/2026-05-23-prime-report|Prime]], [[Prime/2026-05-23-prime-report-codex|Codex]], and [[Prime/2026-05-23-prime-report-antigravity|Antigravity]]), the v3.34.85 and v3.35.48 release drafts, the Reddit conversation capture, and the dated drift reports describe events from their stated dates. They are not live status pages; retain them as history.
- The Gold API page is an external documentation clipping. Its authentication and rate-limit statements were not validated against current third-party documentation.
- The “11 coins / 7 providers” default in New Items and Vendors Research still matches capture.js. It was not counted as drift.
- Archived issue specs intentionally contain old API names, flags, and implementation plans. A legacy-token match in an archived spec is not evidence of a current-code defect.

## Recommended order

1. Refresh Overview.md and StakTrakr.md so project navigation points to current in-repo docs.
2. Mark the test roadmap and May MCP audit historical; repair the drift-report index link.
3. Update the API sponsor and palladium statements; reconcile the Reddit plan with the explicit release gate.
4. Close or refresh expired research timelines and verify external facts before reviving those proposals.
