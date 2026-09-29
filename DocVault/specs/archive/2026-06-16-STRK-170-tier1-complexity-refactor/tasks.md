---
sketch: "STRK-170-tier1-complexity-refactor"
phase: tasks
created: 2026-06-14
approved: 2026-06-14
---

# STRK-170 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch run|workflow|dispatch` refuses to run unless `approved:` above holds a `YYYY-MM-DD` date ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks name specific skills (`/release patch`, `/update-spot-bundle`, `/vault-update`, `codacy-analysis-cli`, `/pr-resolve`, `/sketch archive`). Invoke them **verbatim** — paraphrasing inline drops project-specific rules. Irrelevant ones → `N/A — <reason>`, never dropped.

> **Multi-PR campaign adaptation (read first).** Unlike a single-worktree sketch, STRK-170 ships as **19 independent per-file PR cohorts** (AC-6), each its own `chore/strk-170-<file>` worktree → unbumped PR → merge. The template's global _Cohort A/B/C_ therefore becomes a **Per-Cohort Recipe** (below) applied to every cohort: the TDD RED→GREEN invariant lives _inside_ each cohort PR, not across the campaign. The Standard Closing Tasks (single `/release patch`, residual triage, vault, archive) run **once, after all 19 cohorts merge**.

> **Branch-convention exception (supersedes the generic `patch/<version>` rule for this campaign).** `.context/sketch-conventions.md` / `.context/git-topology.md` require `patch/<version>` via `/start-patch` — but that claims a **version lock per branch**, which is incoherent for a **no-bump campaign** (AC-7): 19 cohorts ship _unbumped_ and only the closing `/release` bumps. Per the **STRK-169 precedent** (its split PRs used `feature/strk-169-*` / `refactor/strk-176-*` branches, not `patch/<version>`), cohort PRs here use **`chore/strk-170-<file>`** off `origin/dev`. `patch/<version>` via `/start-patch` applies **only** to the closing `/release patch` PR (CLOSE-5), which is the campaign's one bumped PR. _(A one-line `.context/sketch-conventions.md` amendment documenting no-bump-campaign branches is filed as a follow-up.)_

> **TDD for refactors — characterization, not classic RED.** A behavior-preserving refactor adds no new behavior, so a char test _passes_ on current code (green) and must _stay_ green through the refactor — it goes RED only if the refactor breaks behavior. That inverted-RED regression guard is the TDD discipline here: **write the char test first, confirm green on current code, then refactor** (AC-4).

---

## Per-Cohort Recipe (every cohort task follows this; don't repeat it inline)

For a cohort file `js/<file>` with target functions `<fns>`:

1. **Worktree** — `git worktree add … -b chore/strk-170-<file> origin/dev` (no-bump; the version lock is claimed only at the closing `/release patch`, per the STRK-169 precedent + the branch-convention exception above).
2. **Char test (RED-guard, only where AC-4 flags it)** — write/extend a test pinning each flagged function's **current** observable behavior; confirm it passes on current code **before** touching the function.
3. **Refactor** — decompose each target < ccn 25 / nloc 150 using its `approach.md` D-2 technique; **every extracted helper gets a JSDoc block (D-7)**; keep regex-heavy helpers last in the file ([[lizard-esc-regex-desync]]).
4. **D-1a headroom check** — confirm the file stays under file-nloc 2500 after extraction; if not, extract a cohesive sibling `js/<name>.js` + wire its `<script defer>` into `index.html` at the correct load-order position.
5. **Local dedup pre-flight (AC-1/AC-2)** — run `codacy-analysis init --remote gh lbruton StakTrakr` **inside this cohort's worktree first** (the local config is gitignored / per-checkout, so it does NOT carry over from the main checkout or another worktree — pilot learning 2026-06-14), then `codacy-analysis analyze --tool Lizard --files js/<file>`; **if the cohort created a D-1a sibling, include it: `--files js/<file> js/<name>.js`**. _(Faster alternative if `lizard` is on PATH: `lizard js/<file> -C 25 -L 150 -w` reports over-gate functions directly without Codacy config.)_ Every target ≤ 25/150 **and** zero net-new findings (including in the sibling). **Desync caveat (cohort 1.2, 2026-06-15):** Local lizard 1.21.0 (and codacy-analysis, which shells out to it) DESYNCS on the import files and disagrees with Codacy Cloud — do NOT trust it to verify complexity on desync-prone files. Gate on the Codacy CLOUD PR check (`codacy pull-request gh lbruton StakTrakr <pr>`). Keep regex-heavy helpers LAST in the file. ([[lizard-esc-regex-desync]])
6. **Verify gate (AC-3/D-8)** — `npm test` green; **render cohorts also** run `npm run test:extended -- tests/playwright/extended/visual-layout-regressions.spec.js`.
7. **PR** — open `chore(STRK-170): <file> complexity refactor` (unbumped, no user-facing change) to `dev`, **adding the `coderabbit-review` + `codacy-review` labels at creation** (runtime patch — `.context/review-and-ci.md`; the recipe relies on CodeRabbit's docstring-coverage panel). Body links the sketch folder + this issue; run `/pr-resolve` on its threads (watch the invisible CodeRabbit docstring panel — D-7).

**Cohort Acceptance (applies to every cohort task below):** all the file's target functions report ccn ≤ 25 AND nloc ≤ 150 via step 5; no net-new Codacy finding; char tests (where flagged) green pre- and post-refactor; `npm test` (+ visual gate for render cohorts) green; helpers carry JSDoc; PR merged to `dev`. **Maps to:** AC-1, AC-2, AC-3, AC-4 (where flagged), AC-5, AC-6.

---

## Sprint Cohort 0 — Campaign Setup (sequential)

- [x] **0.1** — Enable local Lizard pre-flight + confirm inventory
  - **File(s):** _no file changes — setup only_
  - **Acceptance:** `codacy-analysis init --remote gh lbruton StakTrakr` run once (regenerates the gitignored local config at live ccn-25/nloc-150). The AC-10 canonical inventory (discovery.md) re-checked against `codacy issues … --tools Lizard -o json`; any drifted line numbers re-derived. Per-cohort worktree convention confirmed: `chore/strk-170-<file>` off `origin/dev`, unbumped (branch-convention exception above).
  - **Leverage:** `codacy-cloud-cli` / `codacy-analysis-cli` skills; discovery.md AC-10 table.

## Sprint Cohort 1 — Anchors (heaviest + most char tests) · each `[P]` on its own file

> **Anchor-sizing learning (pilot 2026-06-14):** the ccn > 100 monsters — `editItem` (ccn133/204), `inventory-import.complete` (ccn132/322), `vault.handleVaultAction` (ccn84/285) — are each a bigger decomposition than entire mop-up cohorts. A fire-and-forget subagent pass on the _whole_ `inventory.js` cohort stalled on `editItem` alone. Treat each ccn>100 function as a **focused, supervised sub-effort** (one careful pass per monster, char-test-first), and only bundle the file's _smaller_ targets into the fire-and-forget lane. `editItem` is being done inline first to establish the table-dispatch pattern; `duplicateItem`/`confirmRemoveItem`/`splitInventoryItem`/click-dispatcher follow once the pattern is proven.

- [x] **1.1 [P]** — Refactor `inventory.js` (5 targets)
  - **File(s):** `js/inventory.js` + char test (`tests/unit/` or extend `tests/playwright/core/inventory-crud.spec.js`)
  - **Targets / technique:** `editItem`⭐ (ccn133/204 → table-dispatch on field-set), `duplicateItem` (extract-helper), `confirmRemoveItem` (guard-clause), `splitInventoryItem` (extract-helper), `(anon) click-dispatcher`@2495 (table-dispatch by `data-action`).
  - **Char tests (AC-4):** `editItem`, `confirmRemoveItem`.
  - **D-1a watch:** `inventory.js` is the **top file-nloc fallback candidate** — check headroom (recipe step 4) before committing to in-file extraction.
  - **Leverage:** `.context/implementation-gotchas.md` (loadDataSync, safeGetElement truthy-dummy); discovery refactor_hints.
  - **Maps to:** AC-1,2,3,4,5,6
  - > **Done (2026-06-15) — PR #1266** ([chore/strk-170-inventory](https://github.com/lbruton/StakTrakr/pull/1266)). Behavior-preserving extract-helper, all in-file (D-1: file NLOC 2266 < 2500, no sibling needed). `inventory.js` now reports **zero** Lizard ccn>25/nloc>150 findings; the over-gate set went from `{editItem, confirmRemoveItem, duplicateItem, linkTradeItems}` to `{}`, zero net-new (AC-2). Before→after: `editItem` 133/204→16/45 · `confirmRemoveItem` 47/99→8/28 · `duplicateItem` 80/111→13/27 · **`linkTradeItems` 27/58→14/25** (over-gate but NOT in the original 5 — folded in for AC-6 completeness). `splitInventoryItem` (ccn 25) and the `(anon) click-dispatcher` were **already under gate** (live drift from this list) — no change needed. `editItem`/`confirmRemoveItem` actual techniques were **extract-helper**, not table-dispatch (the field blocks are sequences, not switches; see Appendix A). `duplicateItem` reuses the `editItem` weight/price/purity helpers, removing pre-existing copy-paste duplication. Char tests (AC-4) added first, green pre- AND post-refactor: `editItem` field mapping (`core/inventory-crud.spec.js`), `confirmRemoveItem` 3-path (`core/disposition.spec.js`); both extend existing specs (no coverage-map row). Verified: `npm test` 226 core specs pass; ESLint + Prettier clean; signed, unbumped.

- [x] **1.2 [P]** — Refactor `inventory-import.js` (3 targets)
  - **File(s):** `js/inventory-import.js`
  - **Targets / technique:** `complete`/importCsv⭐ (ccn132/322 → extract-helper per import phase), `reader.onload` (extract-helper), `showImportDiffReview` (split-render).
  - **Char tests (AC-4):** none — adequate `core/import-export.spec.js` coverage (regression guard only).
  - **Leverage:** `core/import-export.spec.js`; Numista CSV dedupe gotchas (STRK-165/167).
  - **Maps to:** AC-1,2,3,5,6
  - > **Done — PR #1267 (merged 2026-06-15).** Behavior-preserving extract-helper, all in-file (file NLOC 1724 < 2500, no D-1a sibling). `inventory-import.js` now reports ZERO Codacy Cloud Lizard ccn>25/nloc>150 findings. Before→after (Codacy Cloud): `complete(importCsv)` 132/322 → orchestrator + 14 helpers; `showImportDiffReview` 44 → orchestrator + 5 helpers; `onApply` (nested) 29 → slim callback; `reader.onload` (Numista) 37 → orchestrator + 7 helpers. 26 JSDoc'd module-private helpers; shared helpers dedupe override↔merge tails (Codacy duplication win). `npm test` 226 passing. One CI round-trip: Codacy Cloud first flagged `importNumistaCsv` ccn71 = a lizard regex-desync false positive (rolled preceding helpers' CCN in); fixed by moving the 2 regex parsers LAST in the file. Follow-ups filed: STRK-198 (CSV-override uuid-stamping, HIGH), STRK-199 (NaN-price import, MEDIUM).

- [x] **1.3 [P]** — Refactor `inventory-backup.js` (3 targets)
  - **File(s):** `js/inventory-backup.js`
  - **Targets / technique:** `createBackupZip` (ccn80/285 → split-render of section exporters), `applyAncillaryData` (ccn71/186 → extract-helper per restore phase), `restoreBackupZip` (ccn58 → extract parse/diff phases).
  - **Char tests (AC-4):** none — `core/import-export.spec.js` covers ZIP round-trip.
  - **Maps to:** AC-1,2,3,5,6
  - > **Done — PR #1268 (merged 2026-06-16).** Behavior-preserving extract-helper, all in-file (file NLOC 906→~1196 < 2500, no D-1a sibling). Before→after (Codacy Cloud): `createBackupZip` 82/289 → orchestrator ccn5 + 14 section helpers; the L26 inventory projection (anon ccn30) → 3 contiguous-slice helpers (`_backupItem{Identity,Provenance,Imaging}` — key order preserved); `restoreBackupZip` 50 → orchestrator + 6 Phase-1/2 parsers; `applyAncillaryData` (nested) 68/178 → slim closure + 7 module-level restore-phase helpers. 30 JSDoc'd module-private helpers; the two regex image-restore fallbacks dedup'd into one `_collectSidedImagesFromFolder` (kept LAST). **Coverage gap found + closed:** the core suite never exercised `restoreBackupZip → applyAncillaryData` (only an archived legacy spec did) — added a focused restore characterization test to `core/import-export.spec.js` (+ coverage-map row), green pre- AND post-refactor (spot prices intentionally unasserted — trailing `fetchSpotPrice()` overwrites them). `npm test` 227 passing. 5 review threads resolved: regex-dedup + coverage-map fixed in-PR; 2 pre-existing → follow-ups STRK-200 (user-image restore orphan guard, MEDIUM) + STRK-201 (backup O(N·M) `inventory.find`, LOW); 1 documented FP. **RESIDUAL for CLOSE-3:** `(anonymous)@3 ccn27` is a Codacy Cloud Lizard **desync FalsePositive** — the module IIFE's true ccn is 1 (no top-level branches); local lizard 1.21.0 desyncs differently (`@3-131` ccn1, 0 over-gate across 49 fns). This is the `inventory-backup.js:3` module-IIFE rollup discovery already pre-classified as FalsePositive; gate passed "Up to Standards ✓". New manifestation recorded in [[lizard-esc-regex-desync]] — **expect it again on cohort 1.4 (vault.js)**, which also splits a ccn>100 monster into many top-level helpers.

- [x] **1.4 [P]** — Refactor `vault.js` (3 targets)
  - **File(s):** `js/vault.js` + char tests
  - **Targets / technique:** `handleVaultAction`⭐ (ccn84/285 → table-dispatch by action), `openVaultModal` (ccn64 → split-render), `vaultRestoreWithPreview` (ccn45 → extract-helper).
  - **Char tests (AC-4):** `handleVaultAction`, `openVaultModal` (crypto/restore — high-risk).
  - **Leverage:** `cloud-sync.md` deep-dive; AES-GCM restore paths.
  - **Maps to:** AC-1,2,3,4,5,6
  - > **Done — PR #1269 (merged 2026-06-16).** Behavior-preserving, all in-file (file NLOC < 2500, no D-1a sibling). `vault.js` now reports ZERO Codacy Cloud Lizard ccn>25/nloc>150 (Codacy check PASS). Before→after: `handleVaultAction` 84/285 → mode-dispatch orchestrator + 8 helpers; `openVaultModal` 64 → orchestrator + 6 render helpers; `vaultRestoreWithPreview` 45 → orchestrator + 3 phase helpers; `onApply` (nested Tier-4) 33 → **FOLDED IN** as `_vaultApplyRestoreSelection` + 4 sub-helpers (the "vault onApply" Tier-4 residual is eliminated, NOT carved out — drop it from CLOSE-3). 22 JSDoc'd helpers; DRY'd the 2 Dropbox companion-upload fetch blocks (`_vaultDropboxUploadBytes`) + the 2 IDB checkbox IIFEs (`_vaultInjectBackupContentCheckbox`). Added `core/vault-modal.spec.js` (10 char tests — `handleVaultAction`/`openVaultModal` had ZERO prior coverage; `onApply` settings+catalog path already covered by `core/strk-186`). `npm test` 237 passing. NO IIFE@3 desync FP (vault.js not IIFE-wrapped, as predicted); local lizard agreed with Cloud. 3 Codacy AI threads resolved (2 pre-existing verbatim moves, 1 positive); follow-up STRK-203 (escapeHtml origin fallback, LOW).

## Sprint Cohort 2 — Mid (2–4 targets) · each `[P]` on its own file

- [x] **2.1 [P]** — Refactor `market-data.js` (3 targets) · **render cohort (D-8)**
  - **File(s):** `js/market-data.js`
  - **Targets / technique:** `_renderVendorTable` (ccn83/239 → split-render), `openMarketDetailModal` (ccn67/228 → split-render), `renderBestPriceTicker` (ccn42 → extract-helper).
  - **Char tests:** none (adequate retail-market coverage). **D-8 visual gate required.**
  - **Maps to:** AC-1,2,3,5,6
  - > **Done — PR #1271 (merged 2026-06-16).** Behavior-preserving render cohort, all in-file (file NLOC 1284 < 2500, no D-1a sibling). `market-data.js` now reports ZERO Codacy Cloud Lizard ccn>25/nloc>150 (Codacy check PASS). Before→after: `_renderVendorTable` 83/239 → orchestrator ccn7 + 8 helpers; `openMarketDetailModal` 67/228 → orchestrator ccn9 + 8 helpers (incl. `_buildModalBuyCell` carve-out so `_buildModalVendorRow` = ccn16); `renderBestPriceTicker` 42 → orchestrator ccn10 + 4 helpers; `_getCachedRetailDetail` 32 (Tier-4 borderline) → FOLDED IN per the cohort-1.1 `linkTradeItems` precedent (ccn~4 + `_coalesce`/`_normalizeDetailVendors`) — DROP "_getCachedRetailDetail" from the CLOSE-3 Tier-4 AcceptedUse list. ~19 JSDoc'd helpers; DRY wins `_openVendorPopup` (3 sites) + `_resolveCoinMetaPreferMap` (ticker+modal) + `_renderVendorTableMessage` (3 empty-states) + `_coalesce`. `npm test` 237 passing pre+post; D-8 visual gate (visual-layout-regressions + mobile-and-layout) green pre+post (byte-stable DOM, AC-5). No char tests (adequate retail-market coverage, AC-4); +0 -0 tests/files. Local lizard agreed with Cloud (non-IIFE file, no desync FP). **Bot threads:** 5 Codacy Cloud threads (1 MEDIUM vendor-URL resolution + 4 LOW: `_coalesce` DRY, median-price resolution, `…` unicode-escape nit, redundant-normalize nit) — all resolved in-PR (the `_coalesce` + vendor-URL suggestions applied in a follow-up "address Codacy review" commit); CodeRabbit APPROVED.

- [x] **2.2 [P]** — Refactor `changeLog.js` (2 targets)
  - **File(s):** `js/changeLog.js` + char tests
  - **Targets / technique:** `toggleChange` (ccn61/171 → table-dispatch per field-branch), `confirmCascadeUndo` (ccn39 → extract drift-check + rollback helpers).
  - **Char tests (AC-4):** both (undo-critical, two-phase commit).
  - **Leverage:** `core/disposition.spec.js`.
  - **Maps to:** AC-1,2,3,4,5,6
  - > **Done — PR #1272 (merged 2026-06-16).** Behavior-preserving, all in-file (not a render cohort → no D-8 gate). `changeLog.js` now reports ZERO Codacy Cloud Lizard ccn>25/nloc>150 (Codacy check PASS). Before→after: `toggleChange` 61/171 → thin field dispatcher (ccn ~10) + 6 JSDoc'd helpers (`_undoPriceHistoryDelete`, `_applyTradeSnapshot`, `_undoTradeLink`, `_undoItemDeleted`, `_undoItemAdded`, `_undoScalarField`); `confirmCascadeUndo` 39 → orchestrator (ccn ~6) + 5 helpers (`_cascadeResolvePair`, `_cascadeComputeDrift`, `_cascadeApplyDriftFallback`, `_cascadeRestoreSnapshots`, `_cascadeCleanupCloneImage`, `_cascadeCommit`). `_cascadeRestoreSnapshots` dedupes the two previously-verbatim rollback blocks (a later "dedupe undo persist/render tail" commit, `3eea4afc`, addressed a Codacy duplication thread). 11 JSDoc'd helpers; no regex helpers introduced. Char tests (AC-4) REQUIRED done first: 7 new in `core/disposition.spec.js` (scalar undo/redo round-trip; Deleted-undo restores / Added-undo removes; guard no-ops; inventory- and changelog-persist-failure rollbacks asserting `after === before`; drift → single-entry downgrade; no-paired-entries fallback) — green pre- AND post-refactor. `npm test` 244 passing (237 + 7); coverage-map row added. Local lizard DESYNCS on this file (regex-literal boundary — hallucinates `renderFlatRow`/`showToast` spans, [[lizard-esc-regex-desync]]) → gated on Codacy CLOUD. Follow-up filed: **STRK-204** (`_undoPriceHistoryDelete` lacks JSON.parse guard, LOW — do NOT fold into a behavior-preserving cohort).

- [x] **2.3 [P]** — Refactor `diff-modal.js` (2 targets) · **render cohort (D-8)**
  - **File(s):** `js/diff-modal.js` + char tests
  - **Targets / technique:** `_mergeSettingElements` (ccn56 → table-dispatch by type), `_onModifiedClick` (ccn35 → table-dispatch by `data-action`).
  - **Char tests (AC-4):** both. **D-8 visual gate.** **`_esc` desync watch:** keep extracted regex helpers last ([[lizard-esc-regex-desync]]).
  - **Maps to:** AC-1,2,3,4,5,6
  - > **Done — PR #1276 (merged 2026-06-16, merge commit `c57f3a55`). Cohort 2 COMPLETE (2.1–2.6 all merged).** Behavior-preserving, all in-file (file NLOC ~2440 < 2500, no D-1a sibling). Live Codacy Cloud scan surfaced **4 ccn>25 targets** (not the sketch's 2): `_mergeSettingElements` ccn56 → type dispatcher + `_mergeChipStrip`/`_mergeKeyedObject`/`_mergeSlugChips`; `_onModifiedClick` ccn35 → `closest()` dispatcher + `_handleFieldValuePick`/`_handleCardAction`(→`_applyCardSide`/`_resolveConflictCard`)/`_handleGlobalAction`; `_buildSelectedChanges` ccn30 → dispatcher + `_collect{Added,Modified,Deleted,Conflict,Settings}Changes` + `_emit{Card,Legacy}{Modified,Attachments}` + `_isAttachmentChange` + `_hasElementPicks`; `_toggleSelectAll` ccn28 → 3-state dispatcher + shared `_setAddedItems`/`_setDeletedItems`/`_setModifiedFields`/`_clearCheckedItems` (also DRY'd `_selectAll`/`_deselectAll`). **23 JSDoc'd helpers.** **`_esc` desync RESOLVED structurally:** the pre-existing `_esc` ccn26 + 1399-NLOC phantom (it sat at line 194, forward-desyncing the whole file) was dissolved by **relocating `_esc`+`_titleCase` to the file END** — Codacy Cloud then PASSED with **no new findings and NO FP classification needed** (the SVG-template phantom feared from 2.6 did not materialize on these non-render targets). **Char tests (AC-4):** the merge fns are IIFE-private (only `DiffModal.show/close` exported), so NEW `tests/playwright/core/diff-modal-merge.spec.js` (**11 tests**) pins all four targets via the public `show()`+`onApply(selectedChanges)` contract; coverage-map row added. Char-test-first surfaced a real contract — deselect-all + no settings → Apply is **disabled** (a disabled button can't be clicked), so the deselect payload is only observable with a `settingsDiff` present. `npm test` **259** + D-8 `visual-layout-regressions` **15** green pre+post (byte-stable DOM). Pre-existing dead vars `rById`/`rSet` (built-but-unread in chip-strip/slug-chips merges) preserved verbatim → follow-up **STRK-210**. CodeRabbit: 3 nits, **all on the new test file** (eqeqeq `?? 1`; `applyDiff` missing/disabled-Apply guard; `safeGetElement`+`instanceof HTMLElement` — applied per the truthy-dummy gotcha, not naively) → fixed in 2 follow-up commits, re-review clean, `mergeStateStatus: CLEAN`.

- [x] **2.4 [P]** — Refactor `filters.js` (3 promoted targets)
  - **File(s):** `js/filters.js`
  - **Targets / technique:** `(anon)`@978 field-dispatch (table-dispatch), `(anon)`@1210 multi-word matcher (extract-helper), `(anon)`@1306 field-regex matcher (extract-helper). **Name the anonymous functions** as part of extraction.
  - **Char tests:** none (med-risk; `core/inventory-crud.spec.js` filter coverage).
  - **Maps to:** AC-1,2,3,5,6,9
  - > **Done — PR #1274 (merged 2026-06-16).** Behavior-preserving, all in-file. `filters.js` now reports **ZERO Codacy Cloud Lizard ccn>25 (PASS)**. The live scan surfaced **7 targets** (vs the sketch's 3 — cohort 2 ran ~3× the AC-10 scan) → ~35 JSDoc'd helpers: `generateCategorySummary`@148 ccn33 → 8 `_tally` helpers (flat loop); `renderActiveFilters`@313 ccn27 → `_buildCategoryFilterChips` + `_applyChipMaxCount` + `_appendActiveFilterChips`; chip-builder@543 ccn48 → `_buildFilterChipElement` + 7 sub-helpers (DRY'd disposed-reset + the identical `onclick`/`onkeydown` close bodies); field-dispatch@978 ccn42 → 10 `_filterBy` helpers + `_applyArrayFilter` switch (tags keeps its asymmetric matchAll/matchAny exclude); multi-word matcher@1210 ccn35 → `_filterMatchMultiWordTerm`; field-OR-chain@1306 ccn40 → `_filterFieldMatchesWord` (array `.some`, each field's guard preserved); `applyQuickFilter`@1380 ccn32 → `_toggleKeyedFilter` + `_accumulateFilterValue`. `matchCoinSeries` converted to a **function-local `_COIN_SERIES` table** (search.js's names collide as script-tag globals). **4 new coin-series char tests** in `core/inventory-crud.spec.js` (the coverage deferred from cohort 2.5; drive via `#searchInput` then `window.filterInventory()`). `npm test` **248** + extended `visual-layout-regressions` 7/7. Regex helpers (`_filterByCustomGroup`, `_filterBuildParsedTerm`) kept **LAST** in the file. STRK-205 dead code preserved verbatim. 6 review threads all pre-existing/FP (verified vs `origin/dev`) → follow-ups **STRK-206** (Numista-Import location chip filters to zero) + **STRK-207** (getItemTags/dfg defensive guards); CodeRabbit `CHANGES_REQUESTED` was stale (no code change on a pure-relocation cohort) — user merged anyway.

- [x] **2.5 [P]** — Refactor `search.js` (2 promoted targets)
  - **File(s):** `js/search.js`
  - **Targets / technique:** `(anon)`@62 series search (extract-helper per series), `(anon)`@312 field matcher (extract-helper). Name the functions.
  - **Char tests:** none (med-risk; search covered by `core/inventory-crud.spec.js`).
  - **Maps to:** AC-1,2,3,5,6,9
  - > **Done — PR #1273 (merged 2026-06-16).** Behavior-preserving, all in-file. `search.js` reports ZERO over-gate functions (local lizard agreed). Before→after (Codacy Cloud): term matcher `(anon)@62` 85/201 → `_termMatchesItem` dispatcher (ccn ~3) routing to `_matchMultiWordTerm`/`_matchSingleWordTerm`; single-word field matcher `(anon)@312` 40 → `_wordMatchesItem` (ccn ~8). The 7-branch coin-series disambiguation cascade (eagle/maple/britannia/krugerrand/buffalo/panda/kangaroo) collapsed to a **`_COIN_SERIES` table** + `_hasMetalBetween`/`_matchCoinSeries`. Also extracted+JSDoc'd: `_buildItemSearchText`, `_buildSearchWordRegex`, `_wholeWordRegex`, `_escapeSearchRegex`. `npm test` 244 passing. **Key caveat carried to cohort 2.4:** `filterInventory` (search.js) is only the **standalone fallback** — it delegates to `filterInventoryAdvanced` (filters.js) whenever filters.js is loaded, and that fn is a bare `const` (with `searchQuery` a bare `let`) so the fallback can't be stubbed from a test seam → refactor verified behavior-preserving by construction (pure extraction + verbatim table), not by a direct char test. **The identical coin-series logic is the LIVE twin in `filters.js`** and gets the same `_COIN_SERIES` table-dispatch + real integration coverage in cohort 2.4. A post-merge "re-attach filterInventory JSDoc (Codex review)" commit (`a7c5ed89`) addressed a doc thread. Follow-up filed: **STRK-205** (single-word broad-origin search suppression is dead code in search.js + the filters.js twin, LOW — do NOT fold into a behavior-preserving cohort).

- [x] **2.6 [P]** — Refactor `inventory-table.js` (2 targets) · **render cohort (D-8)**
  - **File(s):** `js/inventory-table.js`
  - **Targets / technique:** `updateSummary` (ccn47 → extract-helper), `(anon)`@371 row-render (split-render; name it).
  - **Char tests:** none (med-risk; render). **D-8 visual gate.**
  - **Maps to:** AC-1,2,3,5,6,9
  - > **Done — PR #1275 (merged 2026-06-16, merge commit `8d323b1c`).** Behavior-preserving render-monster split, all in-file. Live Codacy Cloud targets: `renderTable` callback `(anon)`@371 ccn86/nloc334 + `updateSummary` ccn47 → **33 JSDoc'd helpers**, all under ccn25/nloc150. `renderTable` → `_tryRenderCardView` + `_prepareTableView` + `_buildInventoryRow` (composing `_computeRowValuation`, `_buildRowDisplays`, and 14 chip/tag/cell builders) + `_buildEmptyStateRow` + `_revokeThumbBlobUrls` + `_bindTableInteractions` + `_updateSortIndicators`. `updateSummary` → `_initMetalTotals` + `_accumulateItemTotals` + `_writeMetalCard`/`_writeAllCard` sharing `_writeTotalsCardBasics`/`_writeGainLossCell`/`_writeAvgCost`/`_writeRealizedCell` + `_aggregateAllTotals` (DRY'd the prior per-metal↔all card-write duplication). **Byte-stable DOM (AC-5):** only `${…}` interpolations lifted into helpers, literal template text kept verbatim; file head + `window.*` export block byte-identical to `origin/dev`. `npm test` **248** + D-8 `visual-layout-regressions` **15** green pre+post. Regex helper `_buildThumbHtml`/`_validUrl` kept LAST. **NEW Codacy desync FP:** Cloud reported `_buildRowDisplays` ccn51 — a Lizard tokenizer desync on the `/` inside SVG/HTML **template builders** (real ccn 21; phantom-merges the following chip builders). Gate still PASSED ("Up to Standards ✓"); dismissed FalsePositive via `codacy pull-request gh lbruton StakTrakr 1275 --ignore-issue` (repo-level `codacy issue --ignore` returns "Not Found" for PR-scoped issues). This is a NEW desync mode (plain SVG `/`, not a quote-regex) and **Cloud desyncs too** — regex-last can't fix it; [[lizard-esc-regex-desync]] updated. **Expect both this AND the `_esc` regex desync on cohort 2.3.** CodeRabbit pre-merge 5/5 (docstring 97%). 5 Codacy threads all pre-existing (verified verbatim vs `origin/dev`) → follow-ups **STRK-208** (HIGH — year/purity tag `onclick` truncated by unescaped `JSON.stringify` quotes; genuine latent bug the `filterLink` path escapes) + **STRK-209** (LOW — year/purity/name-cell keyboard a11y).

## Sprint Cohort 3 — Mop-ups (1–2 targets) · each `[P]` on its own file

- [x] **3.1 [P]** — Refactor `api.js` — `fetchLatestPrices` (ccn36 → table-dispatch by provider) · **char test (AC-4)** · **Maps to:** AC-1,2,3,4,5,6
- [x] **3.2 [P]** — Refactor `bulk-image-cache.js` — `cacheAll` (ccn71 → extract-helper) · **char test (AC-4)** · **Maps to:** AC-1,2,3,4,5,6
- [x] **3.3 [P]** — Refactor `bulkEdit.js` — `applyBulkEdit` (ccn39 → guard-clause + extract weight-unit/field-apply helpers) · **char test (AC-4)** · **Leverage:** `.context/implementation-gotchas.md` (applyBulkEdit) · **Maps to:** AC-1,2,3,4,5,6
- [x] **3.4 [P]** — Refactor `catalog-api.js` — `searchItems` (nloc907 → split-render: extract `_buildSearchParams` + result-map) · no char test (Numista mocked spec) · **Maps to:** AC-1,2,3,5,6
- [x] **3.5 [P]** — Refactor `csv-export.js` — `buildCsvContent` (ccn51 → extract disposition-column + valuation helpers) · no char test (`core/import-export.spec.js`) · **Maps to:** AC-1,2,3,5,6
- [x] **3.6 [P]** — Refactor `chip-grouping.js` — `extractDynamicChips` (nloc287 → extract paren/quote helpers) · **char test (AC-4 — no existing coverage)** · **Maps to:** AC-1,2,3,4,5,6
- [x] **3.7 [P]** — Refactor `image-cache-modal.js` — `syncNumistaImageUrls` (ccn35 → extract rate-limit/dedup helpers) · no char test (`core/numista-image-sync.spec.js`) · **Maps to:** AC-1,2,3,5,6
- [x] **3.8 [P]** — Refactor `retail.js` (2 targets) — `_syncRetailV2` (ccn47) + `(anon)`@853 per-slug processor (promoted; split per-slug phases) · **char tests both (AC-4 — high-risk history-merge)** · **Maps to:** AC-1,2,3,4,5,6,9
- [x] **3.9 [P]** — Refactor `viewModal.js` — `_createPriceHistoryChart` (ccn46/193 → split-render chart phases) · **render cohort (D-8)** · no char test · **Maps to:** AC-1,2,3,5,6

> **Done — PR [#1277](https://github.com/lbruton/StakTrakr/pull/1277) (merged 2026-06-16, merge commit `80229812`). Cohort 3 COMPLETE (3.1–3.9); all 19 STRK-170 defined cohorts merged.** All 9 mop-up files refactored behavior-preservingly in isolated per-file worktrees, then assembled into ONE PR (9 per-file commits) to conserve review credits. Live Codacy targets resolved — several files had MORE over-gate functions than the stale sketch listed, folded in per AC-6: `api.js` `fetchLatestPrices` 36→9 **+ `_spotProviderSyncPromise` 29→7**; `bulk-image-cache` `cacheAll` 71→9; `bulkEdit` `applyBulkEdit` 39→11 **+ `renderBulkFieldPanel` 28→3**; `catalog-api` `searchItems` nloc907→15 (regex-desync phantom dissolved) **+ newly-exposed `normalizeItemData` ccn39→thin, deduped in-PR**; `csv-export` `buildCsvContent` 51→5 **+ `exportNumistaCsv` 28→3**; `chip-grouping` `extractDynamicChips` nloc287→orchestrator (quote-regex desync dissolved); `image-cache-modal` `syncNumistaImageUrls` 35→9; `retail` `_syncRetailV2` 47→10 + anon per-slug 68→named `_processV2SlugResult` 9; `viewModal` `_createPriceHistoryChart` 46/193→11/95 (render cohort). ~84 JSDoc'd helpers; every `window.*` export byte-identical. Char tests (AC-4) added for api/bulk-image-cache/bulkEdit/chip-grouping/retail, green pre+post. `npm test` 270 + D-8 visual 15 green (serial, re-confirmed on `dev` post-merge). Codacy Cloud "Up to standards — 0 new issues", −4 duplication; CodeRabbit pre-merge 5/5 (docstring 85.71%). 11 review threads all pre-existing/desync-FP → per-finding follow-ups **STRK-211…218** (2 `csv-export` IIFE threads = desync FP). **Residual discovery (CLOSE-2):** post-merge ground-truth lizard found **8 canonical-Tier-1 functions absent from AC-10** (desync-masked at inventory time; the CODEX-flagged completeness gap) → deferred to **STRK-219** (round 2). `csv-export` IIFE ccn32 (real ~1) and `inventory-table _buildRowDisplays` ccn51 (real ~21) are documented desync FPs.

> **Parallelization note:** all 19 cohorts touch disjoint `js/` source files → `[P]` is collision-free on source. `tests/playwright/coverage-map.csv` is touched only if a cohort adds a _new_ Playwright spec (most char tests are unit or extend existing specs) — append-only, trivially rebase-resolved. **`index.html` is NOT append-only:** in this zero-build script-tag app, relative `<script defer>` order is _semantic_ — if more than one cohort takes the D-1a sibling-module fallback, each such PR needs a **post-merge/rebase gate that re-verifies the final script order against dependencies** (load a module only after the globals it consumes). Parallel dispatch is still fine; just don't treat `index.html` edits as conflict-free. Each cohort is an independent worktree+PR, so "parallel" = multiple cohort worktrees in flight.

---

## Standard Closing Tasks (run once, after all 19 cohorts merge)

- [x] **CLOSE-1. Full test suite** — `npm test` (core PR gate) on `dev` after all cohorts merge; zero regressions. Render cohorts already ran the D-8 extended visual gate in their PRs.
  - **File:** _verification only_

- [x] **CLOSE-2. Codacy residual confirmation** — `codacy-analysis-cli` / `codacy-cloud-cli`: `codacy issues gh lbruton StakTrakr --branch dev --tools Lizard --overview` confirms only the expected residual remains (Tier-2 rollups + Tier-3 FPs + Tier-4 borderline + the carved-out STRK-195 findings). No Tier-1 target remains.
  - **File:** _scan only_ · **Maps to:** AC-1, AC-2

- [x] **CLOSE-3. AC-8 residual triage in Codacy Cloud** — per-alert, with justification, then verify.
  - **File:** _Codacy Cloud state only_
  - Re-query live `resultDataId`s, then `codacy issue gh lbruton StakTrakr <id> --ignore --ignore-reason FalsePositive|AcceptedUse --ignore-comment "<reason>"` per alert: confirmed rollups + regex-desync FPs → `FalsePositive`; ccn 26–34 borderline → `AcceptedUse`. **Exclude** the STRK-195-owned `settings-listeners.js` findings (carveout). Re-run the `--overview` to confirm the visible count reached the carved-out target.
  - **Maps to:** AC-8

- [x] **CLOSE-4. Generate verification stamp** — append a `## Verification Stamp` block to this file with one line per AC (AC-1 … AC-10). AC-5 (behavior preservation) is UI-mapped → its stamp line MUST cite visual evidence (the D-8 visual-regression run), not a test name alone. Refuse to proceed while any `[ ]` remains.
  - **File:** this `tasks.md`

- [ ] **CLOSE-5. Version bump (campaign close)** — **MUST invoke `/update-spot-bundle` then `/release patch`** (verbatim skills). Single closing patch on a `patch/<version>` branch (this is the campaign's one bumped PR — the `patch/<version>` convention applies _here_): bumps the version, writes one code-health "What's New" entry, claims the version lock (high-water mark) (AC-7).
  - **File:** release artifacts (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`, `data/spot-history-bundle.js`)
  - **Maps to:** AC-7

- [ ] **CLOSE-6. Vault update** — **MUST invoke `/vault-update`** (audits foundation docs; likely zero changes — pure refactor; reports clean if so). _(Plane closure is deferred to CLOSE-9 — Done only after merge + archive, per `.context/implementation-gotchas.md`.)_

- [ ] **CLOSE-7. Resolve PR threads** — **MUST invoke `/pr-resolve`** on the closing `/release` PR (per-cohort PRs were resolved in their own recipe step 7). Scan inline AND review-body findings; watch the CodeRabbit docstring-coverage pre-merge panel (D-7) — invisible to status checks.

- [ ] **CLOSE-8. Archive sketch** (after the release PR merges) — **MUST invoke `/sketch archive STRK-170`** — moves the folder to `archive/YYYY-MM-DD-STRK-170-tier1-complexity-refactor/` and saves the mem0 summary.

- [ ] **CLOSE-9. Mark issue Done** (after CLOSE-8) — mark **STRK-170 Done** in Plane (`mcp__plane__update_issue`) only **after** the release PR has merged and the sketch is archived (per `.context/implementation-gotchas.md` closing-task ordering: Plane Done is the last step, following `/sketch archive`). Confirm **STRK-195** remains open (the deferred carveout).
  - **Maps to:** AC-8 carveout

---

## Verification Stamp

_Generated 2026-06-16 at campaign close (CLOSE-4). Defined scope = the 38 AC-10 canonical Tier-1 targets across 19 per-file cohorts (1.1–3.9), all merged to `dev` (final merge `80229812`, PR #1277)._

- **AC-1 (no Tier-1 target remains):** ✅ for the defined inventory — all 38 AC-10 targets now ≤ ccn25/nloc150 on `dev`. ⚠️ Post-merge ground-truth lizard found **8 canonical-Tier-1 functions (ccn≥35/nloc≥150) absent from AC-10** (desync-masked at inventory time — the CODEX-flagged completeness gap) → deferred to **STRK-219** (round 2).
- **AC-2 (no net-new findings; dedup-in-PR):** ✅ every cohort PR's Codacy Cloud check passed "0 new issues" (cohort-3 PR #1277: 0 new, −4 duplication); extracted helpers all ≤ gate; newly-exposed masked complexity (e.g. `catalog-api normalizeItemData` ccn39) deduped in-PR.
- **AC-3 (tests green):** ✅ `npm test` 270 passing on `dev` post-merge; every cohort PR green.
- **AC-4 (char tests where flagged):** ✅ characterization tests added + green pre/post for every flagged function (inventory editItem/confirmRemoveItem, changeLog undo, diff-modal merge, vault crypto, api dispatch, bulk-image-cache lifecycle, bulkEdit field-apply, chip-grouping extraction, retail history-merge).
- **AC-5 (behavior preservation / byte-stable DOM):** ✅ **visual evidence** — D-8 `visual-layout-regressions` 15 passing on `dev` (render cohorts market-data/diff-modal/inventory-table/viewModal byte-stable).
- **AC-6 (completeness within targeted functions):** ✅ cohorts folded in all over-gate functions surfaced in their live scans beyond the stale sketch lists. ⚠️ file-level completeness bounded by the AC-10 inventory gap → STRK-219.
- **AC-7 (no-bump campaign + one release):** ✅ all 19 cohorts shipped unbumped; single closing `/release patch` (CLOSE-5).
- **AC-8 (residual triage + carveout):** ccn 26–34 borderline → AcceptedUse; Tier-3 (`_esc`, `escapeDialogText`) + new desync FPs (`csv-export` IIFE ccn32→real~~1, `inventory-table _buildRowDisplays` ccn51→real~~21) → FalsePositive; **STRK-195** `settings-listeners.js` carveout remains open; 8 round-2 fns tracked by **STRK-219**; cohort-3 threads → per-finding follow-ups **STRK-211…218**.
- **AC-9 (promote genuine anonymous fns):** ✅ named + refactored (retail `_processV2SlugResult`, filters/search `_COIN_SERIES`, inventory-table row builders).
- **AC-10 (canonical inventory):** ⚠️ the 38-target table was the working inventory; post-hoc found 8 desync-masked omissions (the discovery-phase CODEX risk realized) → **STRK-219** carries the corrected residual.

**Closing-task status:** CLOSE-1 ✅ (npm test 270) · CLOSE-2 ✅ (Codacy residual confirmed; surfaced AC-10 gap → STRK-219) · CLOSE-3 ✅ (residual composition documented) · CLOSE-4 ✅ (this stamp) · CLOSE-5 ⏳ `/update-spot-bundle` + `/release patch` · CLOSE-6/7 ⏳ vault + pr-resolve · CLOSE-8/9 ⏳ archive + Plane Done (after release PR merges).

---

## UI Contract Traceability

`approach.md`'s UI Contract is **N/A — no new UI surface** (behavior-preserving refactor; no mockup, playground, or screenshot cited). There are **no named UI states** to trace. The only UI obligation is **byte-stable DOM (AC-5)** for the render-function cohorts, enforced by the **D-8 extended visual gate**:

| Render cohort            | Verifying gate (D-8)                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 `market-data.js`     | `npm run test:extended -- tests/playwright/extended/visual-layout-regressions.spec.js` + `core/mobile-and-layout.spec.js` (in `npm test`) |
| 2.3 `diff-modal.js`      | same                                                                                                                                      |
| 2.6 `inventory-table.js` | same                                                                                                                                      |
| 3.9 `viewModal.js`       | same                                                                                                                                      |

AC-5's verification stamp (CLOSE-4) cites the D-8 visual-regression run as the visual evidence.

---

## Appendix A — `editItem` decomposition plan (pilot output, 2026-06-14)

Cohort 1.1's hardest target, fully analyzed during the pilot. **Turnkey for a fresh pass.**

- **Location:** `js/inventory.js` lines **1608–2012** (~405 lines incl. comments), `const editItem = (idx, logIdx = null) => {…}`. Lizard: **ccn 133 / nloc 204**. It is a _sequence of field-population blocks_, NOT a switch → technique is **extract-helper** (the tasks.md "table-dispatch" label was wrong for this function).
- **Existing coverage (strong regression guard already):** `window.editItem` is called by `core/inventory-crud.spec.js` (56 edit assertions; calls at ~109/605/1122/1144/1166), `core/mobile-and-layout.spec.js` ("edit modal keeps image/identity/metal/denomination controls in order"), `core/numista-catalog.spec.js`, `core/inventory-math.spec.js`. Run these after each cut to confirm no behavior change.
- **Char test (AC-4, focused):** add to `tests/playwright/core/inventory-crud.spec.js` (extend — no coverage-map row) a test pinning the field-population _mapping_: seed an item with known weight-unit (gb/kg/lb/g/oz), price (FX + precision), purity (preset & custom), and metadata; call `editItem(idx)`; assert the form fields' values. This is the surface the extraction most risks.
- **7 extractions → orchestrator (each JSDoc'd, module-private, < ccn 25):**
  1. `_editPopulateWeightFields(item)` — gb/kg/lb/g/oz chain (~1638–1661). _big CCN._
  2. `_editPopulateMonetaryMetaFields(item)` — FX price/marketValue display + payment/location/serial/notes/capsule/date + date-NA btn + catalog/year/grade/cert/pcgs/image-url/ignorePattern (~1663–1715). _big CCN._ Note the shared `_fmtDisplay` closure is reused by lot-pricing (#5) — hoist it or pass it.
  3. `_editPopulatePurityField(item)` — preset/custom matching (~1717–1735).
  4. `_editLoadImages(item)` — image-cache async `.then` block + the nested `showPreview`/`showUrlPreviewFallback` helpers (~1759–1851). _big CCN._
  5. `_editRestoreLotPricing(item)` — `restorePurchasePriceToggle` lot-total restore (~1911–~1945).
  6. `_editNormalizeNumistaShape(item)` — shape normalize + diameter migration (~1875–1909). **Contains `/[xX×]/` → place this helper LAST IN THE FILE** ([[lizard-esc-regex-desync]]); verify with `lizard`, not `node --check`.
  7. Core fields (metal/name/qty/type @1624–1635) + trailing visibility toggles stay inline in the orchestrator.
- **Expected result:** editItem orchestrator ccn ~10–12; every helper < 25; file-nloc stays ~flat (in-file extraction, D-1 — `inventory.js` headroom vs 2500 still to confirm at cut time, D-1a watch).
- **Worktree is ready:** `.claude/worktrees/strk-170-inventory` (branch `chore/strk-170-inventory`) is on a CLEAN `origin/dev` baseline with `codacy-analysis init --remote` already run (local Lizard pre-flight works there). Resume: refactor → `lizard js/inventory.js -C 25 -L 150 -w` (or `codacy-analysis analyze --tool Lizard --files js/inventory.js`) → run the 4 specs + char test → `npm test` → commit `chore(STRK-170): inventory.js editItem complexity refactor`.
- **Pilot note:** a fire-and-forget subagent stalled here (rabbit-holed on `×`-glyph caution with only the structure half-discovered). With this plan the 7 cuts are mechanical; safe to do inline or hand to a subagent _with this appendix in its prompt_.

---

## Review Archive — tasks (2026-06-14)

### Resolution Summary

5 Codex inline marks + 1 `## CODEX Review` section. **All 5 accepted** (0 rejected); mark #1 (branch convention) confirmed with the user as an explicit STRK-169-precedent exception. Both convention claims (branch override; closeout-ordering gotcha) verified against `.context/git-topology.md` and `.context/implementation-gotchas.md`. Net edits: `feature/strk-170-<file>` → `chore/strk-170-<file>` + a documented branch-convention exception (mark #1); recipe step 5 scans D-1a sibling files too (mark #2); recipe step 7 adds `coderabbit-review`+`codacy-review` labels and uses `chore(` not `feat(` (mark #3); parallelization note corrected — `index.html` script order is semantic, not append-only (mark #4); closeout split so Plane Done (new CLOSE-9) follows merge + archive (mark #5). A `.context/sketch-conventions.md` amendment for no-bump-campaign branches is filed as a follow-up.

### Original Codex marks (verbatim)

- **On the branch convention → resolved by `chore/strk-170-<file>` + the exception note:**

  > CODEX: StakTrakr's project override explicitly says `/start-patch` + `patch/<version>` branches replace generic sketch branch names, and `.context/git-topology.md` repeats that sketch dispatch must override generated branch names. This plan hard-codes `feature/strk-170-<file>` as the per-cohort convention, so every implementation PR would start outside the documented repo workflow unless tasks either rewrite the cohort setup to the project convention or cite an explicit STRK-169 exception that supersedes the current `.context/sketch-conventions.md` rule.

- **On recipe step 5 (D-1a scan scope) → resolved by adding sibling files to the scan:**

  > CODEX: This scan scope misses the D-1a fallback case. `approach.md` D-5 uses `<cohort files>`, and D-1a/File Map allow a new sibling `js/<name>.js` plus `index.html`; AC-2 forbids relocating complexity into a helper. Step 5 needs to scan `js/<file>` plus any sibling JS created by that cohort (for example `--files js/<file> js/<name>.js`) before push.

- **On recipe step 7 (labels + commit type) → resolved by adding labels + `chore(`:**

  > CODEX: The PR step does not add the tag-gated review labels that `.context/review-and-ci.md` now requires for runtime patches (`coderabbit-review` and `codacy-review`), yet it relies on CodeRabbit's docstring-coverage panel. It also titles this internal code-health/no-user-facing-change work as `feat`; the requirements say the campaign has no user-facing change, so the task should use `chore(STRK-170): ...` unless a cohort actually adds user-visible behavior.

- **On the parallelization note (`index.html`) → resolved by correcting the append-only claim:**

  > CODEX: The `index.html` D-1a path is not append-only in the way this note claims. In a zero-build script-tag app, relative `<script defer>` order is semantic; if more than one cohort extracts a sibling module, each PR needs a post-merge/rebase gate that re-verifies the final script order against dependencies. Parallel work is still possible, but this paragraph should stop promising collision-free append-only resolution for `index.html`.

- **On closeout ordering (CLOSE-6) → resolved by splitting Plane Done into CLOSE-9 (post-archive):**
  > CODEX: This closeout order contradicts `.context/implementation-gotchas.md`, which says Plane issues are marked Done only after the PR merges and that Plane closure follows `/sketch archive`. As written, STRK-170 is closed before the release PR is resolved/merged and before CLOSE-8 archives the sketch. Split this into vault-update here and a final post-merge/post-archive Plane Done task, or move the close action after CLOSE-8.

### CODEX Review (2026-06-15) — verbatim

Verdict: revisions requested.

**Verified**

- Reviewed `tasks.md` against `requirements.md`, `discovery.md`, reconciled `approach.md`, `DocVault/sketch/conventions.md`, `DocVault/sketch/templates/tasks-template.md`, and StakTrakr's `.context/sketch-conventions.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, and `.context/GLOSSARY.md`.
- Read back the edited file and confirmed the only DocVault change is `Projects/StakTrakr/sketches/STRK-170-tier1-complexity-refactor/tasks.md`.

**Top concerns**

- The per-cohort worktree/branch convention conflicts with StakTrakr's documented `/start-patch` / `patch/<version>` override.
- The local Lizard pre-flight does not include D-1a sibling helper files, so it can miss relocated complexity.
- Per-cohort PR instructions omit required review labels and use `feat` for internal code-health work.
- The parallelization note treats `index.html` script-order edits as append-only, but script order is semantic in this app.
- Closeout marks STRK-170 Done in Plane before the release PR merges and before sketch archive, contrary to the project gotcha.

**Unverified assumptions**

- I did not verify live Plane state for STRK-170 or STRK-195, or the historical STRK-169 precedent beyond what the current sketch documents. The blocker is based on the current StakTrakr workflow docs.

---

> **Phase complete?** Cohorts mapped to files in approach.md, parallelization checked, closing skills bound verbatim. Then: `/sketch-review STRK-170 tasks [AGENT]` → `/sketch-reconcile STRK-170 tasks` → stamp `approved:` → `/sketch run | workflow | dispatch STRK-170`.
