---
sketch: "STRK-170-tier1-complexity-refactor"
phase: discovery
created: 2026-06-14
---

# STRK-170 — Discovery

_Research the existing system and prior art. Solutions belong to the approach phase._

## Method

- Canonical inventory pulled live from Codacy Cloud: `codacy issues gh lbruton StakTrakr --branch dev --tools Lizard --limit 200 -o json` (each record carries `resultDataId`, `filePath`, `lineNumber`, and the metric in `message`).
- Per-file coverage/risk + Tier-2 shape verification: read-only Workflow fan-out, **24 agents (one per target file), 0 failures** (run `wf_214cda30-87c`).
- CGC was unavailable this session (server disconnected); structural analysis came from direct file reads instead.
- Every target below is a current Codacy Lizard finding with a `resultDataId`. Code that *looks* complex but is **not** a current finding (e.g. `bulkEdit.js:1716`, `settings-listeners.js:1082`) is excluded — a target requires a live result id.

## Canonical Tier-1 Inventory (AC-10)

**38 refactor targets** = 30 canonical Tier-1 (named, ccn ≥ 35 OR nloc ≥ 150) + 8 promoted from Tier-2 (genuine functions Lizard labeled "anonymous"; AC-9). This table is the authoritative AC-1/AC-6/AC-7 set; PR slicing keys off it. `resultDataId`s are the live ids as of the 2026-06-14 analyzed commit (lines drift — re-derive at fix time; the closing triage re-queries the residual).

| # | File (cohort) | Function | Line | ccn | nloc | Tier | resultDataId(s) |
|---|---|---|---|---|---|---|---|
| 1 | `api.js` | fetchLatestPrices | 1450 | 36 | — | T1 | 131501217519 |
| 2 | `bulk-image-cache.js` | cacheAll | 66 | 71 | — | T1 | 131476056007 |
| 3 | `bulkEdit.js` | applyBulkEdit | 1393 | 39 | — | T1 | 131475931211 |
| 4 | `catalog-api.js` | searchItems | 586 | — | 907 | T1 | 131501217430 |
| 5 | `changeLog.js` | confirmCascadeUndo | 743 | 39 | — | T1 | 131501217448 |
| 6 | `changeLog.js` | toggleChange | 535 | 61 | 171 | T1 | 131501217432 / 131501217328 |
| 7 | `chip-grouping.js` | extractDynamicChips | 166 | — | 287 | T1 | 131501217370 |
| 8 | `csv-export.js` | buildCsvContent | 123 | 51 | — | T1 | 131502042566 |
| 9 | `diff-modal.js` | _mergeSettingElements | 1979 | 56 | — | T1 | 131476059367 |
| 10 | `diff-modal.js` | _onModifiedClick | 1626 | 35 | — | T1 | 131476059376 |
| 11 | `image-cache-modal.js` | syncNumistaImageUrls | 391 | 35 | — | T1 | 131501237471 |
| 12 | `inventory-backup.js` | applyAncillaryData | 529 | 71 | 186 | T1 | 131501217391 / 131501217528 |
| 13 | `inventory-backup.js` | createBackupZip | 6 | 80 | 285 | T1 | 131501217399 / 131501217483 |
| 14 | `inventory-backup.js` | restoreBackupZip | 404 | 58 | — | T1 | 131501217353 |
| 15 | `inventory-import.js` | complete (importCsv) | 306 | 132 | 322 | T1 | 131501217490 / 131501217454 |
| 16 | `inventory-import.js` | reader.onload | 747 | 37 | — | T1 | 131475931140 |
| 17 | `inventory-import.js` | showImportDiffReview | 86 | 44 | — | T1 | 131475931160 |
| 18 | `inventory-table.js` | updateSummary | 820 | 47 | — | T1 | 131501217445 |
| 19 | `inventory.js` | confirmRemoveItem | 1005 | 46 | — | T1 | 131501217421 |
| 20 | `inventory.js` | duplicateItem | 2032 | 79 | — | T1 | 131475931205 |
| 21 | `inventory.js` | editItem | 1608 | 133 | 204 | T1 | 131475931193 / 131475931146 |
| 22 | `inventory.js` | splitInventoryItem | 1274 | 47 | — | T1 | 131501217333 |
| 23 | `market-data.js` | _renderVendorTable | 918 | 83 | 239 | T1 | 131501217563 / 131501217560 |
| 24 | `market-data.js` | openMarketDetailModal | 516 | 67 | 228 | T1 | 131501217556 / 131501217564 |
| 25 | `market-data.js` | renderBestPriceTicker | 282 | 42 | — | T1 | 131475931234 |
| 26 | `retail.js` | _syncRetailV2 | 702 | 47 | — | T1 | 131501217503 |
| 27 | `vault.js` | handleVaultAction | 1458 | 84 | 285 | T1 | 131443475020 / 131443475038 |
| 28 | `vault.js` | openVaultModal | 1221 | 64 | — | T1 | 131475931229 |
| 29 | `vault.js` | vaultRestoreWithPreview | 393 | 45 | — | T1 | 131475931308 |
| 30 | `viewModal.js` | _createPriceHistoryChart | 2371 | 46 | 193 | T1 | 131475931115 / 131475931302 |
| 31 | `filters.js` | (anon) field-dispatch loop | 978 | 42 | — | T1↑ | 131443475031 |
| 32 | `filters.js` | (anon) multi-word matcher | 1210 | 35 | — | T1↑ | 131475931137 |
| 33 | `filters.js` | (anon) field regex matcher | 1306 | 40 | — | T1↑ | 131475931264 |
| 34 | `search.js` | (anon) series search + fuzzy | 62 | 85 | 201 | T1↑ | 131475931279 / 131475931232 |
| 35 | `search.js` | (anon) field matcher | 312 | 40 | — | T1↑ | 131501217365 |
| 36 | `inventory.js` | (anon) click dispatcher | 2495 | 32 | — | T1↑ | 131475931074 |
| 37 | `inventory-table.js` | (anon) row-render loop | 371 | 86 | 334 | T1↑ | 131475931227 / 131475931124 |
| 38 | `retail.js` | (anon) per-slug processor | 853 | 68 | — | T1↑ | 131501217499 |

**T1↑ = promoted from Tier-2 (AC-9).** `bulkEdit.js:1716` and `settings-listeners.js:1082` were dropped — they are not current Codacy findings (no result id).

## Coverage & Risk Classification (AC-4)

Across all 38 targets: **23 high / 15 med / 0 low** risk. **14 require a characterization test before refactor** (no/thin coverage AND high-risk per AC-4); the other 24 ride existing `core/*` integration coverage.

**Char-test REQUIRED (14):**

| Function | Risk | Why |
|---|---|---|
| `inventory.js editItem` | high | core item mutation, only broad integration coverage |
| `changeLog.js toggleChange` | high | giant field/type cascade, undo-critical |
| `changeLog.js confirmCascadeUndo` | high | two-phase commit + rollback, drift invariants |
| `inventory.js confirmRemoveItem` | high | disposition mutation |
| `api.js fetchLatestPrices` | high | provider dispatch, only folded into settings-api UI flows |
| `bulk-image-cache.js cacheAll` | high | storage + tag mutation |
| `bulkEdit.js applyBulkEdit` | high | multi-field mutation, weight-unit conversion |
| `diff-modal.js _mergeSettingElements` | high | settings merge dispatch, no direct unit test |
| `diff-modal.js _onModifiedClick` | med | event-delegation dispatch |
| `chip-grouping.js extractDynamicChips` | med | **no coverage at all** |
| `retail.js _syncRetailV2` | high | retail v2 sync mutation |
| `vault.js handleVaultAction` | high | crypto/restore action dispatch |
| `vault.js openVaultModal` | med | vault modal state |
| `retail.js:853` (promoted) | high | per-slug history-merge, data-shape-heavy |

**Promoted targets — coverage/risk (AC-4 completeness, mark #2):**

| Promoted | Risk | Coverage | Char test |
|---|---|---|---|
| `filters.js:978` field-dispatch | med | integration — `core/inventory-crud.spec.js`, `filter-chip-and-logic.spec.js` | no |
| `filters.js:1210` multi-word matcher | med | integration — same filter/search specs | no |
| `filters.js:1306` field regex matcher | med | integration — same | no |
| `search.js:62` series search | med | integration — `core/inventory-crud.spec.js` (search box) | no |
| `search.js:312` field matcher | med | integration — same | no |
| `inventory.js:2495` click dispatcher | med | integration — `core/inventory-crud.spec.js` (click actions) | no |
| `inventory-table.js:371` row-render | med | integration — `inventory-crud` / `inventory-math` / `mobile-and-layout` | no |
| `retail.js:853` per-slug processor | **high** | integration — `core/retail-market.spec.js`, `retail/slug-resolution.spec.js` | **yes** (history-merge edge cases under-exercised) |

**Adequate coverage → no new char test (24):** the original `createBackupZip`, `restoreBackupZip`, `applyAncillaryData`, `showImportDiffReview`, `reader.onload`, `complete/importCsv`, `splitInventoryItem`, `duplicateItem`, `searchItems`, `buildCsvContent`, `syncNumistaImageUrls`, `updateSummary`, `_renderVendorTable`, `openMarketDetailModal`, `renderBestPriceTicker`, `vaultRestoreWithPreview`, `_createPriceHistoryChart` + the 7 med-risk promotions above. (per-function spec paths in run `wf_214cda30-87c`.)

## Tier-2 Shape Verification (AC-9) — SCOPE-CHANGING

The ~18 `Method (anonymous)` findings split nearly evenly. **This is the key discovery result.**

### Promote into Tier-1 refactor scope (8 — genuine functions Lizard mislabeled)

Rows 31–38 in the inventory above: `filters.js:978/1210/1306`, `search.js:62/312`, `inventory.js:2495`, `inventory-table.js:371`, `retail.js:853`. New refactor-cohort files this creates (had **no** Tier-1 before): **`filters.js` (+3), `search.js` (+2)**. The rest land in files already in scope.

> **Deferred (Open Question 1, resolved 2026-06-14):** `settings-listeners.js` — its Codacy findings are `:656` (anonymous ccn30) and `:913` (anonymous ccn296 + nloc942). The genuine handlers Lizard folds into that block are entangled with the 942-nloc event-wiring rollup; the **entire file is deferred to STRK-195**, where it can be decomposed holistically. Not promoted, not ignored here — see the carveout in Residual Ignore Composition.

### Confirmed Lizard rollup artifacts → FalsePositive ignore (11)

`init.js:130` (DOMContentLoaded 17-phase init), `inventory-backup.js:3` (module IIFE) & `:26` (map projection), `inventory.js:294` (map normalize), `cloud-storage.js:1331` (provider forEach DOM updates), `filters.js:148` (count accumulation) & `:543` (chip render + listeners), `chip-grouping.js:169` (nested in extractDynamicChips), `retail-view-modal.js:816` (promise chain), `sorting.js:27` (map) & `:138` (sort comparator).

## Residual Ignore Composition (feeds AC-8 closing triage)

After the 38 refactors land, the residual to triage in Codacy Cloud:
- **Tier-3 false-positives (3 findings):** `diff-modal.js _esc` (ccn26 + nloc1399 — the `/"/g` regex-desync artifact) and `dialogs.js escapeDialogText` (nloc246, same escape-helper class) → `FalsePositive`.
- **Tier-2 confirmed rollups (11 findings):** the 11 above → `FalsePositive`.
- **Tier-4 borderline (16 findings, ccn 26–34):** `populateApiHealthModal`, `_spotProviderSyncPromise`, `renderBulkFieldPanel`, `exportNumistaCsv`, `cloudExchangeCode`, `enrichItemIdentities`, `_buildSelectedChanges`, `_toggleSelectAll`, `applyQuickFilter`, `renderActiveFilters`, `inventory-import onApply`, `linkTradeItems`, `_getCachedRetailDetail`, `_flagAnomalies`, `openSpotLookupModal`, `vault onApply` → `AcceptedUse`.
- **DEFERRED — owned by STRK-195, EXCLUDED from this campaign's closing accounting (carveout, mark #4b option A):** `settings-listeners.js:656` (ccn30) and `:913` (ccn296 + nloc942). These 3 findings are neither refactored nor ignored here; they stay open under STRK-195. **This campaign's closing state is therefore "~0 visible Lizard findings _except_ the STRK-195-owned `settings-listeners.js` findings."** The requirements' AC-8 closing-state should be read with this carveout; a one-line AC-8 amendment is the cleanest home for it and is flagged for the approach phase / a separate requirements touch-up.

> The closing task re-queries live `resultDataId`s (`codacy issues … --tools Lizard -o json`) at triage time — ids in the current export will not survive the refactor PRs, and only the residual remains.

## Verifier Command (AC-1) — confirmed

`codacy-analysis analyze` supports `--files <paths…>` (verified via `--help`). Local pre-flight:
```
codacy-analysis init --remote gh lbruton StakTrakr   # regenerate the gitignored local config w/ live ccn-25/nloc-150
codacy-analysis analyze --tool Lizard --files <target-file>
```
`--tool Lizard` is the documented selector; validate on first use. Authoritative gate remains the cloud `Codacy Static Code Analysis` check on the PR.

## Prior Decisions

- **2026-06-14** — STRK-169 closed: file-split campaign drove file-nloc to 0. Established the **no-bump-then-one-release** campaign pattern and the **dedup-in-PR** rule (relocating a ccn>25 fn into a new file re-flags as NEW). ([[strk-169-no-bump-campaign]], [[strk-169-complexity-gate-blocks-splits]])
- **2026-06-14** — Lizard baseline recalibrated 2026-06-10 to ccn25/nloc150/file2500/param25; the local `.codacy/codacy.config.json` mirror was untracked (PR #1264) — local analysis must `init --remote`. ([[project-codacy-coding-standard-editing]])
- **~2026-05** — `_esc` 1399-nloc is a Lizard `/"/g` regex-desync artifact; keep such helpers LAST in a file; `node --check` is blind to it. ([[lizard-esc-regex-desync]])
- Coverage taxonomy: specs consolidated under `tests/playwright/core/*` (STRK-117/118/121); `coverage-map.csv` is the authoritative spec↔domain map and must be updated for any spec add/rename.

## Constraints

- **No behavior change** (AC-5): DOM output, localStorage/IndexedDB shape, and user flows must be byte-stable for refactored functions.
- **Dedup-in-PR** (AC-2): extracted helpers must not themselves exceed ccn 25 / nloc 150.
- **Per-file cohort** (AC-6): one file = one PR; all that file's Tier-1 (+promoted) functions in the same PR.
- **Project gotchas** that intersect targets: `applyBulkEdit` and `loadDataSync` have documented gotchas (`.context/implementation-gotchas.md`); `safeGetElement` returns a truthy dummy (use `instanceof HTMLElement`); script load order (`events.js` top-level can't call `safeGetElement`); `toLocaleDateString('en-CA')` for dates.
- Any new spec file must add a `coverage-map.csv` row (AGENTS.md gate).

## Open Questions

1. **RESOLVED 2026-06-14 — `settings-listeners.js` deferred** to **STRK-195** (child of STRK-168). Its findings (`:656`, `:913`) are carved out of this campaign's closing accounting (see Residual Ignore Composition).

_No open questions block approach._

## Discovery Summary

The authoritative refactor set is **38 targets across ~19 per-file PR cohorts** (30 canonical Tier-1 + 8 promoted genuine functions). The four big anchors (`inventory.js` ×4+1 promoted, `inventory-backup.js` ×3, `inventory-import.js` ×3, `vault.js` ×3) are all high-risk and several need characterization tests first; the promotions add `filters.js` (+3) and `search.js` (+2) as new cohorts. **14** functions require a characterization test before refactor; the other 24 ride existing `core/*` integration coverage. `settings-listeners.js` is deferred to STRK-195 and carved out of the closing count. The closing residual triage ignores 11 confirmed rollups (FalsePositive), 3 Tier-3 regex-desync FPs, and 16 Tier-4 borderline (AcceptedUse).

---

## Review Archive — discovery (2026-06-14)

### Resolution Summary
4 Codex inline marks + 1 `## CODEX Review` section. **All 4 accepted** (0 rejected); one (mark #4b) carried a sub-decision resolved by the user (closing-state **carveout option A** — STRK-195 findings excluded from this campaign's closing accounting). Both factual claims (`bulkEdit.js:1716` and `settings-listeners.js:1082` are not current Codacy findings) verified true against the live export. Net edits: added the full 38-row AC-10 inventory with `resultDataId`s; classified the 8 promotions for coverage/risk/char-test (AC-4, +`retail.js:853` to the char-test list → 14 total); removed `bulkEdit.js:1716`; corrected settings-listeners facts to `:656`+`:913`; recorded the STRK-195 carveout. Codex's "requirements-backed carveout" note: the carveout is recorded here in discovery and flagged for a one-line AC-8 requirements touch-up (outside this reconcile, which edits discovery only).

### Original Codex marks (verbatim)

- **On the AC-10 inventory →** resolved by the full 38-row table with ids:
  > CODEX: This does not satisfy requirements AC-10 yet. I re-ran `codacy issues gh lbruton StakTrakr --branch dev --tools Lizard --limit 200 -o json` and the live export still provides `resultDataId`, `filePath`, `lineNumber`, and metric messages for current findings; AC-10 explicitly requires one row per target with the issue/result id, file path, function label, line, ccn, nloc, and tier decision before PR slicing starts. Omitting ids because future refactors remove them leaves approach/tasks without the canonical inventory AC-1/AC-6 depend on.

- **On AC-4 →** resolved by classifying the promotions:
  > CODEX: AC-4 requires coverage status and risk rating for every Tier-1 target. Once discovery promotes the 9 genuine anonymous findings in the next section, those are Tier-1 refactor scope too, but this classification only accounts for the original 30 (`13 required + 17 adequate`). The promoted `filters.js`, `search.js`, `inventory.js:2495`, `inventory-table.js:371`, `retail.js:853`, and `bulkEdit.js:1716` targets need the same per-target coverage/risk/needs-characterization decision before approach can plan safe refactors.

- **On `bulkEdit.js:1716` →** resolved by removing the promotion:
  > CODEX: I could not verify `bulkEdit.js:1716` as a current Codacy Lizard finding. The live Cloud export for `js/bulkEdit.js` contains `renderBulkFieldPanel` at line 634 and `applyBulkEdit` at line 1393, but no result at 1716; direct code read shows the IIFE exists, yet it is not in the current issue set. Either remove this promotion or back it with the current issue/result id and metric evidence AC-10 requires.

- **On the `settings-listeners.js` deferral →** resolved by the carveout (option A) + fact correction:
  > CODEX: This creates a third bucket that the requirements do not define. Current Codacy Cloud reports `settings-listeners.js:913` twice (ccn296 and nloc942) plus `settings-listeners.js:656` (ccn30), and I found no current result at `:1082`. AC-8 says residual Tier-2/3/4 findings are triaged per-alert, while AC-9 says genuine anonymous complexity is promoted rather than ignored; deferring these outside both buckets requires an explicit requirements carveout, otherwise the visible Lizard backlog cannot approach the stated closing state.

### CODEX Review (2026-06-15) — verbatim

**Verified**
- Read sketch conventions, StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, `.context/sketch-conventions.md`, and Foundation `coding-standards.md`.
- Checked `requirements.md` and `discovery.md` for the STRK-170 sketch, including the reconciled requirements archive and current discovery claims.
- Re-ran Codacy Cloud Lizard overview and JSON export: current `dev` overview is 82 Lizard findings (64 ccn, 18 nloc), and issue records include `resultDataId`, path, line, and metric messages.
- Verified live code around `js/settings-listeners.js:656`, `js/settings-listeners.js:913`, `js/settings-listeners.js:1082`, `js/bulkEdit.js:1716`, and representative Tier-1 functions in `inventory.js`, `changeLog.js`, `chip-grouping.js`, `bulkEdit.js`, and `retail.js`.
- Checked `tests/playwright/coverage-map.csv` and relevant core/extended spec names for the coverage-classification claims.

**Top concerns**
- AC-10 is still incomplete: the canonical target inventory omits per-target result ids, lines, full ccn/nloc metrics, and tier decisions even though the live export provides them.
- AC-4 classification misses the promoted Tier-1 scope and does not give the promoted functions their own coverage/risk/characterization-test decision.
- `bulkEdit.js:1716` is promoted as a current Lizard target but does not appear in the current Cloud export.
- `settings-listeners.js` is deferred to STRK-195 while current findings remain outside both the refactor inventory and residual triage contract; the stated `:1082` finding also did not appear in the current export.

**Unverified assumptions**
- I did not inspect the opaque workflow run `wf_214cda30-87c`; the review is grounded in the discovery artifact, live Codacy Cloud data, and live repo reads.
- I did not verify Plane state for STRK-195; even if it exists, discovery still needs a requirements-backed carveout before treating the STRK-170 open question as resolved.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch-approach STRK-170`.
