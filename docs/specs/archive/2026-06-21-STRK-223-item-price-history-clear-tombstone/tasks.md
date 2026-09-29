---
sketch: "STRK-223-item-price-history-clear-tombstone"
phase: tasks
created: 2026-06-21
approved: 2026-06-21
---

# STRK-223 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch run` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Ensure sketch worktree exists ✅ `.worktrees/STRK-223-clear-tombstone` on `patch/3.35.41` off `origin/dev` (merge-base == origin/dev `ce2f6252`); npm install done; v3.35.41 reserved by branch.
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows the StakTrakr `patch/<version>` worktree on a branch off `origin/dev`. Working dir is that worktree, not the main checkout.
  - **If missing:** invoke **`/start-patch`** (StakTrakr convention — claims the version lock + creates `.worktrees/<issue>-<slug>/` on a `patch/<version>` branch). This is a version-bumping single-PR feature, so `/start-patch` (not a no-bump `chore/` branch) is correct.
  - **Leverage:** `/start-patch`; `.context/git-topology.md` §Worktrees; version-lock high-water mark = `max(all version.lock entries, APP_VERSION on origin/dev)`.

## Sprint Cohort A — Foundation (scaffolding, no behavior yet)

_Config + pure accessors the Cohort B tests import. No filter/merge/push behavior here — that is Cohort C, so the RED tests stay red._

- [x] **A.1** — Register the clear-watermark storage key
  - **File(s):** `js/constants.js`
  - **Acceptance:** `ITEM_PRICE_HISTORY_CLEARED_AT_KEY = "itemPriceHistoryClearedAt"` declared; added to **both** `SYNC_SCOPE_KEYS` (:876, beside `itemTagsLastModified`) and `ALLOWED_STORAGE_KEYS` (:952, beside `ITEM_PRICE_HISTORY_KEY`); `window.*` export added. `node --check js/constants.js` passes.
  - **Leverage:** `itemTagsLastModified` registration (constants.js:881) — exact mirror; STRK-161 dual-registration rule.
  - **Maps to:** AC-8

- [x] **A.2** — Pure watermark accessors
  - **File(s):** `js/priceHistory.js`
  - **Acceptance:** `loadItemPriceClearedAt()` returns a number (absent/NaN ⇒ `0`); `saveItemPriceClearedAt(ts)` writes via `saveDataSync(ITEM_PRICE_HISTORY_CLEARED_AT_KEY, …)`; both `window.*`-exported. **No filtering logic** (that is C.2) — accessors only.
  - **Leverage:** existing `loadDataSync`/`saveDataSync`; `loadItemPriceHistory` (priceHistory.js:76) as the read/write shape.
  - **Depends on:** A.1 (uses the key constant)
  - **Maps to:** AC-1, AC-3, AC-5 (foundation)

## Sprint Cohort B — Tests · RED (sequential)

_Every test below MUST fail now — the behavior lives in Cohort C. (STRK-224 lesson: no "allowed-to-pass" test sneaks into Cohort B.)_

- [x] **B.1 [P]** — Unit: watermark drop-filter + commutativity ✅ RED confirmed: AC-5 fails (real `applyItemPriceRetention` keeps `['old','at','new']` vs expected `['new']`); AC-4/AC-6 guards + all 7 STRK-147 cases green (10 total, 1 RED). Slice-and-eval loads the REAL function so the watermark term is verified against shipped code.
  - **File(s):** `tests/unit/cloud-sync-item-price-history-merge.test.js`
  - **Acceptance:** New cases assert (AC-5) `applyItemPriceRetention` / `mergeItemPriceHistories` **keep** entries with `ts > clearedAt` and **drop** entries with `ts <= clearedAt`; (AC-6) `merge(A,B) === merge(B,A)` holds with a non-zero watermark in play. All new cases **fail** (retention has no watermark term yet).
  - **Leverage:** existing STRK-147 pure-merge suite in this file; `applyItemPriceRetention` ts-filter shape (priceHistory.js:30).
  - **Depends on:** A.1, A.2
  - **Maps to:** AC-5, AC-6

- [x] **B.2 [P]** — Playwright: clear stamps · push deletes · fresh-device preserves ✅ RED: AC-1 (no watermark stamped), AC-2 (no delete_v2) fail; AC-4 preserve guard passes.
  - **File(s):** `tests/playwright/core/item-price-history-cloud.spec.js`
  - **Acceptance:** Cases assert (AC-1) confirming "Clear all" sets `itemPriceHistoryClearedAt`; (AC-2) a push with empty local history **and** a clear newer than the remote meta deletes the remote companion (`files/delete_v2` issued, pointer omitted); (AC-4) a fresh/empty device with **no** watermark preserves the remote companion (no delete). All **fail** initially.
  - **Leverage:** STRK-147/224 companion-vault E2E patterns already in this spec; `showAppConfirm` dialog pattern (CLAUDE.md Playwright dialog note); STAK-426 image-delete shape (cloud-sync.js:1990-2009).
  - **Depends on:** A.1, A.2
  - **Maps to:** AC-1, AC-2, AC-4

- [x] **B.3** — Playwright: cross-device propagation · cancel-safety · persistence ✅ RED: AC-3 (`mergeItemPriceClearWatermark` not a function), AC-8 (watermark not stamped) fail; AC-7 cancel guard passes. (Exact-array asserts relaxed to invariants — app auto-records a snapshot on boot.)
  - **File(s):** `tests/playwright/core/item-price-history-cloud.spec.js`
  - **Acceptance:** Cases assert (AC-3) after device A clears + pushes, device B's sync drops every `ts <= clearedAt` entry while keeping `ts > clearedAt`; (AC-7) **cancelling** the vault-first restore preview leaves the watermark unadvanced and local entries intact (no drop); (AC-8) after a clear, a reload + `cleanupStorage()` retains the watermark. All **fail** initially.
  - **Leverage:** STRK-225 cancel-safety test (seeds `cloud_sync_last_pull` as an object without the hash field — mem0 retro); `_vfApplied` gate (cloud-sync.js:5149-5258); localStorage persistence test pattern (must reload/`cleanupStorage` per STRK-161).
  - **Depends on:** B.2 (same spec file — serialize to avoid collision)
  - **Maps to:** AC-3, AC-7, AC-8

## Sprint Cohort C — Implementation · GREEN (sequential)

_Minimum code to turn Cohort B green. `priceHistory.js` tasks (C.1/C.2) and `cloud-sync.js` tasks (C.3/C.4) are same-file pairs → strictly sequential._

- [x] **C.1** — Stamp the watermark on clear ✅ AC-1 + AC-8 Playwright green.
  - **File(s):** `js/priceHistory.js`
  - **Acceptance:** `clearItemPriceHistory()` (:677) calls `saveItemPriceClearedAt(Date.now())` before wiping `itemPriceHistory` and saving. AC-1 test (B.2) green.
  - **Depends on:** B.1, B.2, B.3
  - **Maps to:** AC-1

- [x] **C.2** — Watermark drop-filter + apply helper ✅ B.1 unit 10/10 green (real fn sliced).
  - **File(s):** `js/priceHistory.js`
  - **Acceptance:** `applyItemPriceRetention` (:21) keeps an entry only when `e.ts >= ageCutoff && e.ts > loadItemPriceClearedAt()`; add `applyItemPriceClearWatermark()` that re-runs retention against the global + `writeItemPriceHistoryStrict`. B.1 green (drop-filter + commutativity).
  - **Depends on:** C.1
  - **Maps to:** AC-5, AC-6

- [x] **C.3** — Push: conditional companion delete vs preserve ✅ AC-2 (delete on intentional clear) + AC-4 (fresh preserve) green. Tests fixed to reach the branch: matching syncId (avoid unpulled-change block) + force-empty history (app auto-records a boot snapshot).
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** preserve-when-empty branch (:2242) becomes: if local empty **and** `loadItemPriceClearedAt() > prePushMeta.timestamp` → `files/delete_v2` the companion (mirror STAK-426 :1990-2009) + leave `itemPriceHistoryVaultMeta = null`; else preserve as today. B.2 (AC-2/AC-4) green.
  - **Depends on:** C.2
  - **Maps to:** AC-2, AC-4

- [x] **C.4** — Receive-side watermark merge at the tag-merge chokepoints ✅ AC-3 green; full spec 21/21. Audit done: `_isManagedSyncKey` excludes the key at all 5 blind-overwrite sites (4118/4404/4663/5041/5048); `_mergeItemPriceClearWatermark` (max-arbitrate + idempotent apply) wired at `_applyAndFinalize` (via `remoteRawSettings` at 3 call sites) + the manifest one-sided path; exported via CloudSyncTest.
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** add `_mergeItemPriceClearWatermark(remoteSettings)` — `local = max(local, remote)` and, on advance, call `applyItemPriceClearWatermark()`. Exclude the key from the blind-overwrite loops (extend `_isTagSyncKey` or add a sibling guard at the :4016/:4302/:4561/:4939/:4946 skip sites) and invoke the merge **beside `_mergeTagData`** at `_applyAndFinalize` (:3550, joining its rollback snapshot set) **and** `_mergeOneSidedTagSettings` (:3486). B.3 (AC-3/AC-7) green.
  - **Audit (STRK-224):** enumerate **every** `_mergeTagData` / `_isTagSyncKey` site and prove the watermark merge + exclusion sit alongside each; list them in the PR description. This is the primary review target.
  - **Depends on:** C.3
  - **Maps to:** AC-3, AC-7

- [x] **C.5** — Update Playwright coverage map ✅ row 93 count 15→21 + STRK-223 description appended (comma-free, CSV-safe).
  - **File(s):** `tests/playwright/coverage-map.csv`
  - **Acceptance:** row 93 (`item-price-history-cloud.spec.js`) case count bumped to the new total and the description extended to mention STRK-223 clear-propagation / fresh-device-preserve / cancel-safety. (AGENTS.md requirement — review-only gate.)
  - **Depends on:** B.1, B.2, B.3 (final inventory known)
  - **Maps to:** test inventory bookkeeping (all AC)

---

## Standard Closing Tasks

> Numbering continues as CLOSE-N. StakTrakr roster bound verbatim from `.context/sketch-conventions.md` — none are optional drops.

- [x] **CLOSE-1. Run full test suite** — zero regressions ✅ `npm test` → **311 passed (3.9m)**, exit 0, discovered==passed (no hidden failures).
  - **File:** _verification only_
  - Run `npm test` (core Playwright PR gate). All existing + new Cohort B tests pass. A failure means fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality ✅ ESLint9 **0 issues**; **0 Error/Critical/High**. 6 Lizard complexity Warnings are all pre-existing (syncRestoreOverrideBackup/buildAndUploadManifest/pollForRemoteChanges/recordItemPrice + whole-file NLOC ~4200, all predate the diff; none on my new functions). Baselined, not chased. (Cloud duplication gate runs on the PR — STAK-426-mirrored delete may flag; handle in CLOSE-7.)
  - **File:** _scan only_
  - Run the `codacy-analysis-cli` skill: `codacy-analysis analyze --diff` against changed files. Critical/High must fix; Medium fix-or-document; Low/Info advisory. Baseline pre-existing findings against `origin/dev` (don't fix unrelated complexity flags).

- [x] **CLOSE-3. Generate verification stamp** ✅ all 8 ACs verified (no `[ ]` gaps) — see `## Verification Stamp` at the bottom of this file.
  - **File:** append `## Verification Stamp` to this file.
  - One line per AC (AC-1…AC-8): `- [x] AC-N — verified at <path>:<line>` or `verified by <test name>`, or `- [ ] AC-N — gap: <reason>`. No UI Contract (approach is N/A — no visual-verification lines required). Refuse CLOSE-4 while any `[ ]` remains.

- [x] **CLOSE-4. Version bump** ✅ `/update-spot-bundle` (no new sqld rows; bundle rebuilt 47,968 entries, 757 KB) + 6-file bump to **v3.35.41** per the release Phase-1 recipe (constants/package/package-lock/version.json/CHANGELOG/about.js, What's New capped at 5). Applied directly in-worktree (the global `/release` wrapper would claim a lock + open its own PR, conflicting with CLOSE-5/6); the `check-release-sync` pre-commit hook validated the bump + sw.js auto-stamp.
  - **File:** version-bearing files via the skill.
  - Run **`/update-spot-bundle`** then **`/release patch`** (StakTrakr override — bumps the 6 files, trims What's New, sw.js via pre-commit). Never hand-edit release artifacts.

- [x] **CLOSE-5. Vault update + close issue** ✅ `/vault-update`: added a STRK-223 clear-watermark paragraph to `Foundation/cloud-sync.md` (Item-Price-History Companion Vault §) + SYNC_SCOPE_KEYS enumeration; sketch artifacts committed → DocVault main `a0dcc3d`. Issue → **In Review** (Done deferred to post-merge per project closure rule, not marked Done here).
  - Invoke **`/vault-update`** (audits Foundation docs — cloud-sync.md may want a note on the clear-watermark; the skill reports zero changes if not). Then mark **STRK-223 Done** in Plane via `mcp__plane__update_issue`.

- [x] **CLOSE-6. Open PR** ✅ [#1313](https://github.com/lbruton/StakTrakr/pull/1313) → `dev`, both review labels applied, body has issue + sketch + C.4 audit + test plan. Issue STRK-223 → **In Review** (Done deferred to post-merge per project closure rule).
  - To `dev`. Title `fix(STRK-223): propagate item-price-history clear via synced watermark tombstone`. Body links the issue + sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-223-item-price-history-clear-tombstone/`) + the C.4 chokepoint-audit list + test plan. Apply `coderabbit-review` + `codacy-review` labels (review-worthy).

- [x] **CLOSE-7. Resolve PR review threads** ✅ 7 bot comments triaged. **2 real bugs fixed** (the review's biggest value): Copilot — manifest-first silent-return swallowed a watermark-only change (`f25623bb`, `_hasItemPriceClearChange` guard mirroring `_hasTagChanges` + regression test); Codex P2 — vault-first silent-record had the same gap (`279843b5`). **5 replied with rationale**: Codacy HIGH (use companion meta timestamp) = FP — the `{hash,uuidCount,entryCount}` pointer has no timestamp; `prePushMeta.timestamp` is the intentional D-5 proxy and the suggestion breaks AC-4. Copilot seed-sync = FP (`/seed-sync` retired; `/update-spot-bundle` ran, no new rows). 2× test-dup = intentional readability (AC-2/AC-4 isolate the one variable). slice-and-eval = matches the file's existing `loadHelpers` harness. **CodeRabbit: passed** (pre-merge checks all ✅; docstring 78.57% ≥ 75%). **Second review round** added an 8th comment — Codex P2 (priceHistory.js): `saveItemPriceClearedAt` swallowed a write error so a quota failure silently lost the clear → fixed (`ee31ada7`): `applyItemPriceClearWatermark(explicitClearedAt)` drops with the incoming watermark directly + surfaces the persist failure. CodeRabbit nitpick (stale "RED until" comments) cleaned. **Round 3** (Codex): manifest watermark-only change fell through to an empty DiffModal → widened the tag-only silent-apply guard to `(_mHasTagChanges || _mHasIphClear)` (`1b8b4a13`); plus a write-failure-hold gap — the receive hook swallowed an `applyItemPriceClearWatermark` write error and recorded `lastPull` → now re-throws and all 3 call sites hold `lastPull` like the STRK-224 companion (`dac78e43`). **Proactive audit** closed the full-overwrite fallback (`09b4a85a`, `applyItemPriceClearWatermark()` after restore). **6 real fixes total** (5 reviewer-found + 1 proactive), all in the STRK-224 "exclude-but-re-detect / hold-on-write-failure" family; **10/10 threads resolved** with footer replies. Every pull path now covered (poll→delegate, manifest silent-no-op guard + tag/watermark-only silent-apply + STAK-470, vault-first silent-record, DiffModal-apply via remoteRawSettings, full-overwrite). Full suite 312/312 (runs 2-5); final run confirming round-3. **PR was CLEAN/mergeable before each new async review round re-opened it.**

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - Invoke **`/sketch archive STRK-223`** — moves folder to `archive/YYYY-MM-DD-STRK-223-item-price-history-clear-tombstone/` + saves mem0 summary.

---

> **Multi-model dispatch hint:** `[P]` in Cohort B (B.1 unit ∥ B.2 playwright — different files) is the only real parallel seam. The TDD B→C boundary is the natural model-routing seam (one model writes the failing tests, another makes them green). Cohorts A and C are same-file sequential.

---

## Verification Stamp

*Generated 2026-06-21 (CLOSE-3). `approach.md` UI Contract = N/A (no UI surface) → no visual-verification lines required. Full suite: 311 passed.*

- [x] AC-1 (clear stamps watermark) — verified by Playwright `AC-1: confirming 'Clear all' stamps the clear watermark and wipes local history` + impl `js/priceHistory.js:743` (`saveItemPriceClearedAt(Date.now())` in `clearItemPriceHistory`)
- [x] AC-2 (cleared push deletes companion) — verified by Playwright `AC-2: a cleared device's push deletes the remote companion vault` + impl `js/cloud-sync.js` push preserve-when-empty branch (`files/delete_v2` when `loadItemPriceClearedAt() > prePushMeta.timestamp`)
- [x] AC-3 (receiving device drops cleared entries) — verified by Playwright `AC-3: receiving a newer clear watermark drops local entries at/older than it` + impl `js/cloud-sync.js:3578` (`_mergeItemPriceClearWatermark`)
- [x] AC-4 (fresh device preserves) — verified by Playwright `AC-4 (GUARD): a fresh device with no watermark preserves the remote companion` + impl `js/cloud-sync.js` else-branch (preserve when `clearedAt` ≤ remote)
- [x] AC-5 (newer survives, ≤ watermark dropped) — verified by unit `AC-5: drops entries at/older than the watermark, keeps strictly newer` + impl `js/priceHistory.js:37` (`e.ts >= cutoff && e.ts > clearedAt`)
- [x] AC-6 (merge stays commutative) — verified by unit `AC-6: the watermark filter is order-independent (deterministic survivor set)` + existing `AC-9: merge is commutative` (the watermark is a pure per-entry ts predicate applied inside the commutative union)
- [x] AC-7 (cancel safety) — verified by Playwright `AC-7 (GUARD): cancelling the restore preview leaves the watermark and history untouched` (hook runs only inside `_applyAndFinalize` / one-sided apply paths, never on a cancelled preview — the `_vfApplied` gate)
- [x] AC-8 (survives reload + cleanupStorage) — verified by Playwright `AC-8: the clear watermark survives a reload and cleanupStorage` + impl `js/constants.js` dual registration (`SYNC_SCOPE_KEYS` + `ALLOWED_STORAGE_KEYS`)
