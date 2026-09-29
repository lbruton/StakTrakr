---
title: "StakTrakr Context Deep-Dive Drift Report — 2026-08-13"
type: audit
project: staktrakr
created: "2026-08-13"
tags: [drift, audit, context, staktrakr]
---

# StakTrakr Context Deep-Dive Drift — 2026-08-13

## Scope and method

- **Canonical corpus:** 13 `.context/deep-dives/` documents and 14 non-glossary
  top-level `.context` documents. `.context/GLOSSARY.md` received a structural-only
  reference check; vocabulary maintenance remains owned by `/glossary`.
- **Authority:** direct source/configuration reads and exact `rg` existence searches.
  The prior 2026-08-13 Tier-1 report was treated as a lead list, not proof that a
  correction was complete.
- **Provenance:** all inherited `source:` frontmatter keys were changed to
  `migration_source:`. The value is historical origin metadata only; it is not an
  authority over the repository document or live source.
- **Public configuration boundary:** deployment secrets and identifiers are authoritative only
  in the operator-managed Infisical, Fly.io, or Portainer stores. The public `.context` corpus
  may document configuration categories and safe troubleshooting, but not a deployed inventory,
  values, internal addresses, rotation steps, or secret-reading commands.

## Corrected findings

1. **Removed market card-list subsystem.** `retail-modal.md` and
   `vendor-quirks.md` described the v3.34.30-deleted card/list implementation as
   live. There are no live-source hits for `_renderMarketListView`,
   `_buildMarketListCard`, `_buildOOSVendorRow`, `_marketMetalFilter`,
   `_getFilteredSortedSlugs`, `marketExpandAllBtn`, `_filterHistorySpikes`,
   `_interpolateGaps`, or `_calcVendorAvg`. Active market rendering is the vendor
   comparison matrix in `js/market-data.js`; the documents now say so.
2. **v2 and provider configuration.** Removed conditional `USE_V2_API` guidance.
   The frontend consumes v2 unconditionally, using an envelope `stale_after` when
   present and defensive constants only for malformed data. Replaced obsolete
   `PROVIDER_CONFIG` references with `providerCfg()` / vendor-module configuration.
3. **Goldback API distinction.** The v2 rate envelope generates six denomination
   keys (`g0.25`, `g1`, `g5`, `g10`, `g25`, `g50`) in
   `api-export-v2.js`. Compatibility slug forms accepted by `retail.js` are not
   evidence of additional v2 envelope keys; fixed hard-coded catalog totals and
   endpoint claims accordingly.
4. **Tier-1 carryover drift.** Corrected dead Bootstrap API/modal guidance,
   stale `ALLOWED_STORAGE_KEYS` line references, the cloud-sync simple-salt location
   and removal prediction, a stale `DIFF_FIELDS` count, and the API data repository
   `main`-branch / retired-workflow instructions. `git ls-remote` verified that
   `lbruton/StakTrakrApi` exposes only the publisher-managed `api` branch.
5. **PR-review and secret-boundary follow-up.** Replaced hard-coded spacing in the modal
   example with design tokens and consolidated duplicated market-filter guidance. Source confirms
   that the active per-coin product-detail flow is `openMarketDetailModal(slug)` in
   `js/market-data.js`; `retail-view-modal.js` is now explicitly labelled a legacy
   compatibility surface. Replaced deployed secret inventories in the infrastructure and poller
   guidance with store ownership, configuration categories, and safe self-hosted troubleshooting.

## Audit ledger

| Document                              | Result                   | Evidence / disposition                                                                                                                               |
| ------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `architecture.md`                     | corrected                | API repository branch boundary corrected.                                                                                                            |
| `cloud-sync.md`                       | corrected                | Simple-mode and `DIFF_FIELDS` statements updated from source.                                                                                        |
| `cloud-sync-convergence.md`           | verified                 | Named invariant surfaces and tests still resolve.                                                                                                    |
| `coding-standards.md`                 | corrected                | Removed unusable Bootstrap API guidance and stale line references.                                                                                   |
| `data-pipelines.md`                   | corrected                | v2 freshness, provider configuration, and Goldback-envelope claims corrected.                                                                        |
| `design-philosophy.md`                | verified                 | Structural scan found no stale source/path claim.                                                                                                    |
| `git-topology.md`                     | verified                 | Structural scan found no stale source/path claim.                                                                                                    |
| `implementation-gotchas.md`           | verified                 | Historical/resolved markers and named source surfaces resolve.                                                                                       |
| `infrastructure.md`                   | corrected                | Corrected retired API-repository workflow guidance and removed the deployed secret inventory in favor of the public configuration boundary.          |
| `issue-tracking.md`                   | verified                 | Plane-only terminology and references are current.                                                                                                   |
| `reusable-patterns.md`                | corrected                | Removed live card-list rules; retained explicit removal history and labelled the retail-view modal as legacy compatibility only.                     |
| `review-and-ci.md`                    | verified                 | Current review routing and `.context` lint coverage remain documented.                                                                               |
| `sketch-conventions.md`               | verified                 | Project pointers resolve to the in-repo context model.                                                                                               |
| `testing.md`                          | verified                 | Current coverage-map and test-tier references resolve.                                                                                               |
| `api-reference.md`                    | corrected                | Removed stale hard-coded per-state Goldback matrix assumptions.                                                                                      |
| `data-model.md`                       | verified                 | Named storage/model surfaces resolve.                                                                                                                |
| `dom-patterns.md`                     | verified                 | DOM helper names and script-order guidance resolve.                                                                                                  |
| `health-checks.md`                    | corrected                | Removed retired API-repository workflow commands, v2 flag claim, and deployed external-feed credential name.                                         |
| `home-poller.md`                      | corrected                | Replaced obsolete provider-config name and deployed Portainer environment inventory with configuration-category guidance.                            |
| `image-pipeline.md`                   | verified                 | Named image-cache and image-processor surfaces resolve.                                                                                              |
| `playwright-suite-rationalization.md` | corrected                | Marked as historical planning, not a current test inventory.                                                                                         |
| `provider-database.md`                | corrected                | Named sqld/provider surfaces resolve; migration instructions now use the target deployment's secret store rather than an inline inventory.           |
| `remote-poller.md`                    | corrected                | Its v1 references are explicitly archival/publishing context; frontend consumption remains v2-only and deployed secret inventory is omitted.         |
| `retail-modal.md`                     | corrected                | Removed deleted market-card/list ownership and trend-chart sections.                                                                                 |
| `secret-keys.md`                      | corrected                | Replaced the deployed inventory, internal addresses, rotation procedures, and secret-reading commands with store ownership and safe troubleshooting. |
| `vendor-quirks.md`                    | corrected                | Replaced v1/card-list/OOS/trend claims with current matrix behavior and the active Market Detail Modal flow.                                         |
| `webscale-cookie-re-solve.md`         | corrected                | Runbook paths and Webscale helper references resolve; replaced deployed Portainer inventory/inspection guidance with safe recovery checks.           |
| `GLOSSARY.md`                         | structural-only verified | No broken in-repo links or stale Foundation-path authority found; no vocabulary change proposed.                                                     |

## Cross-document closure checks

- The known-dead card-list symbols now occur only in explicit historical-removal notes.
- `USE_V2_API` no longer appears as a live feature flag.
- `PROVIDER_CONFIG` no longer appears as the active provider-configuration interface.
- No live source occurrence exists for the removed card-list symbols.
- Public context contains no deployed secret inventory; self-hosting guidance defers exact
  configuration names and values to enabled source/configuration and the operator's secret store.

## Closure

All 27 scope documents have a final evidence disposition, with `.context/GLOSSARY.md` also
structurally reviewed. There are no unresolved cross-document contradictions in the audited corpus.
Live code/configuration remains authoritative for application behavior; operator-managed secret
stores remain authoritative for deployed configuration.
