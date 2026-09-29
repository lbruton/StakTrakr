---
sketch: STRK-147-item-price-history-cloud-sync
phase: tasks
created: 2026-06-17
approved: 2026-06-17
---

# STRK-147 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch run | workflow | dispatch` refuses to start unless `approved:` above holds a `YYYY-MM-DD` date ≤14 days old. Human-only — stamp it after reviewing all four sketch files.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Ensure sketch worktree exists (StakTrakr `/start-patch` convention)
  - **File(s):** _no file changes — setup only_
  - **Acceptance:** `git worktree list` shows the StakTrakr `patch/<version>` worktree under `.worktrees/<issue>-<slug>/`, branched off `origin/dev` (not `origin/main` — see `.context/git-topology.md`). Working dir is that worktree.
  - **If missing:** invoke **`/start-patch`** (claims the version lock + creates the `patch/<version>` branch). This is a runtime feature (single PR, version-bumped at close) — NOT a no-bump campaign, so `/start-patch` applies.
  - **Leverage:** `/start-patch`; `.context/sketch-conventions.md`; `.context/git-topology.md`.

## Sprint Cohort A — Foundation (parallel-safe)

_Pure helpers, constants, crypto. No cloud-sync wiring yet. Disjoint files → all `[P]`._

- [x] **A.1 [P]** — Add companion-vault path constant
  - **File(s):** `js/constants.js`
  - **Acceptance:** `SYNC_ITEM_PRICE_HISTORY_PATH = "/StakTrakr/sync/staktrakr-item-price-history.stvault"` exported alongside `SYNC_IMAGES_PATH`/`SYNC_ATTACHMENTS_PATH`. `ALLOWED_STORAGE_KEYS`, `SYNC_SCOPE_KEYS`, `HISTORY_IDB_KEYS` are byte-for-byte unchanged.
  - **Leverage:** existing path constants `js/constants.js:831,834,837,840`.
  - **Maps to:** D-4 (enables AC-8)

- [x] **A.2 [P]** — Companion-vault crypto helpers
  - **File(s):** `js/vault.js`
  - **Acceptance:** `vaultEncryptItemPriceHistory(password, payload)` and `vaultDecryptItemPriceHistory(password, bytes)` exist, mirroring the image/attachment vault encrypt/decrypt helpers (same AES-256-GCM path). Round-trip (encrypt→decrypt) returns the input payload.
  - **Leverage:** `vaultEncryptImageVault` / `vaultEncryptAttachmentVault` in `js/vault.js`.
  - **Maps to:** D-9

- [x] **A.3 [P]** — Pure merge / canonicalize / hash + throwing write path
  - **File(s):** `js/priceHistory.js`
  - **Acceptance:** Four new pure/throwing functions exist and are reachable for unit slice-and-eval:
    - `canonicalizeItemPriceHistory(history)` — decompress→parse→drop malformed UUID entries→sort UUIDs→sort entries by **full-fingerprint comparator** (`ts`, then `itemName`, `retail`, `spot`, `melt`)→stable-stringify (D-8).
    - `mergeItemPriceHistories(local, remote, acceptedUuids)` — UUID-keyed union; filters remote to `acceptedUuids`; dedupes by **full-entry fingerprint** (not `ts` alone); applies `applyItemPriceRetention` to the merged result; commutative + idempotent (D-2, D-6, AC-3/AC-10).
    - `collectAndHashItemPriceHistory()` — returns `{ payload, hash, uuidCount, entryCount }` over canonical content (D-8, AC-9).
    - A **throwing/reporting** write path for companion merges (e.g. `writeItemPriceHistoryStrict()`) that rethrows `saveDataSync` failures instead of swallowing them like `saveItemPriceHistory()` (`js/priceHistory.js:51-58`) (D-7, enables AC-7).
  - **Leverage:** `_mergeTagData` convergence model; `applyItemPriceRetention` `js/priceHistory.js:21-45`; entry shape `js/priceHistory.js:180-186`.
  - **Maps to:** AC-2, AC-3, AC-9, AC-10 (and enables AC-1/AC-6/AC-7)

## Sprint Cohort B — Tests · RED (parallel-safe; disjoint new files)

_Failing tests encoding each EARS AC. Must fail (red) — feature not wired yet._

- [x] **B.1 [P]** — Unit tests for the pure merge/canonicalize/hash
  - **File(s):** `tests/unit/cloud-sync-item-price-history-merge.test.js` (new)
  - **Acceptance:** One+ failing assertion per: cross-device union (AC-1), idempotent re-merge (AC-2), same-`ts` distinct preservation + exact-dup collapse (AC-3), commutativity incl. tie order `merge(A,B)===merge(B,A)` + compressed-vs-plain hash equality (AC-9), retention applied after merge (AC-10), `acceptedUuids` filter drops orphan UUIDs (AC-6). Slice-and-eval the real helpers.
  - **Depends on:** A.3
  - **Leverage:** `tests/unit/cloud-sync-tag-merge.test.js` (slice-and-eval + commutativity pattern).
  - **Maps to:** AC-1, AC-2, AC-3, AC-6, AC-9, AC-10

- [x] **B.2 [P]** — E2E cloud-sync Playwright spec
  - **File(s):** `tests/playwright/core/item-price-history-cloud.spec.js` (new)
  - **Acceptance:** Failing tests for: two-device union + idempotent second sync (AC-1), history-only save schedules a push when inventory unchanged (AC-4), **poll hash-shortcut detects a companion-only remote change** (D-11/AC-5), silent metadata-only merge shows no diff modal (AC-5), rejected remote Item leaves no orphan history (AC-6), quota/write failure leaves `lastPull` stale + partial state (AC-7), manifest excludes full history JSON / only `{hash,count}` metadata present (AC-8).
  - **Depends on:** A.1, A.2, A.3
  - **Leverage:** `tests/playwright/core/attachments-cloud.spec.js` (`seedCloudState`/`routeDropbox`/`encryptedManifest`/`pullWithPreview`).
  - **Maps to:** AC-1, AC-4, AC-5, AC-6, AC-7, AC-8

- [x] **B.3 [P]** — Register the new spec in the coverage map
  - **File(s):** `tests/playwright/coverage-map.csv`
  - **Acceptance:** Row added for `tests/playwright/core/item-price-history-cloud.spec.js` — `domain: item-price-sync`, `risk_class: P0 money-data loss`, `decision: active`, rationale references STRK-147. (AGENTS.md requirement; not caught by lint/check-release-sync.)
  - **Leverage:** existing rows in `tests/playwright/coverage-map.csv`.
  - **Maps to:** _process requirement (AGENTS.md)_

## Sprint Cohort C — Implementation · GREEN (sequential — all touch `js/cloud-sync.js`)

_Minimum wiring to turn Cohort B green. Sequential: shared file `js/cloud-sync.js`._

- [x] **C.1** — Push: companion-vault collect/hash/encrypt/upload + metadata
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** On push, when the companion hash differs (or remote meta absent), collect/hash/encrypt/upload to `SYNC_ITEM_PRICE_HISTORY_PATH` and attach `metaPayload.itemPriceHistoryVault = {hash,uuidCount,entryCount}`; preserve remote ref when local empty (mirror image-vault preservation). Companion JSON stays OUT of the manifest. B.2 manifest/metadata assertions (AC-8) pass.
  - **Depends on:** A.1, A.2, A.3, B.1, B.2
  - **Leverage:** image-vault push `js/cloud-sync.js:1895-2009`, preservation `1954-1965`, `metaPayload` `2168-2177`, manifest `1293-1316`.
  - **Maps to:** AC-8

- [x] **C.2** — Pull: companion fetch + merge across all three apply paths
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** Companion vault fetched only when remote hash ≠ `lastPull.itemPriceHistoryHash`, then merged via `mergeItemPriceHistories` with the correct `acceptedUuids` per path — silent-pull (current local inventory UUIDs), manifest-first deferred (`newInv` from `_deferredVaultRestore`, `js/cloud-sync.js:3560-3561`), vault-first (post-apply inventory UUIDs). B.2 union (AC-1), silent-merge (AC-5), orphan-boundary (AC-6) tests pass.
  - **Depends on:** C.1
  - **Leverage:** image pull silent `3813-3846`, vault-first `4440-4474`, deferred-vault `3560-3619`.
  - **Maps to:** AC-1, AC-5, AC-6

- [x] **C.3** — Poll hash-shortcut companion branch + `lastPull.itemPriceHistoryHash`
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** In the poll fast-path (`js/cloud-sync.js:2474-2483`), when inv+settings hashes match, compare `remoteMeta.itemPriceHistoryVault?.hash` to stored `lastPull.itemPriceHistoryHash`; if different, route into the silent companion merge before `syncSetLastPull()` instead of short-returning. B.2 poll-shortcut detection test (D-11/AC-5) passes.
  - **Depends on:** C.2
  - **Leverage:** poll shortcut `js/cloud-sync.js:2474-2483`; `syncGetLastPull`/`syncSetLastPull` `377-407`.
  - **Maps to:** AC-5 (D-11)

- [x] **C.4** — Partial-failure safety: don't advance `lastPull` on failed merge write
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** Companion merge persists via the throwing write path (A.3); on failure, `lastPull` (incl. `itemPriceHistoryHash`) is NOT advanced and a partial/error state is recorded for retry — mirroring the settings-write-failure path. B.2 quota-failure test (AC-7) passes.
  - **Depends on:** C.2
  - **Leverage:** settings-write-failure handling; `lastPull` `377-407`.
  - **Maps to:** AC-7

- [x] **C.5** — Debounced push trigger from `saveItemPriceHistory()`
  - **File(s):** `js/priceHistory.js`
  - **Acceptance:** `saveItemPriceHistory()` calls `scheduleSyncPush()` (when Cloud Sync available) after a successful save, so a history-only change schedules a push even with inventory unchanged. B.2 push-trigger test (AC-4) passes. Existing swallow-and-log save behavior for the non-strict path is otherwise unchanged.
  - **Depends on:** C.1
  - **Leverage:** `scheduleSyncPush`; `saveItemPriceHistory` `js/priceHistory.js:51-58`.
  - **Maps to:** AC-4

---

## Standard Closing Tasks

> StakTrakr roster (`.context/sketch-conventions.md`) — skill names verbatim, none optional.

- [x] **CLOSE-1. Full test suite** — zero regressions
  - **File:** _verification only_
  - Run `npm test` (core Playwright PR gate) **and** `npm run test:unit`. All existing tests pass — including the STRK-141 guard `history-store-migration.spec.js` "no market-history key is in the cloud auto-sync scope" (**AC-11**) — plus all new B.1/B.2 tests (green after Cohort C).
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy scan** — security + quality
  - **File:** _scan only_
  - Run the **`codacy-analysis-cli`** skill against changed files (`codacy-analysis analyze --diff`). Baseline-compare per `.context/review-and-ci.md` (file-level NLOC/ccn on lightly-touched files is usually pre-existing). Critical/High fix; Medium fix-or-document.
  - **Verdict (2026-06-17):** 0 Critical/High, 0 security. 6 Lizard complexity Warnings — **all pre-existing** (baseline-verified via direct `lizard` on `origin/dev`): `syncRestoreOverrideBackup` ccn30, `buildAndUploadManifest` ccn33, `recordItemPrice` ccn26, file-NLOC 3942 (all in code STRK-147 never modified), and `pollForRemoteChanges` (dev baseline 203 NLOC / 47 ccn — already over threshold). None of STRK-147's new functions are flagged. **Fixed:** the C.3 branch had worsened `pollForRemoteChanges` to 241/59; extracted to sub-threshold helper `_pollCompanionItemPriceHistory` (ccn12/nloc39, `b49130f5`), restoring `pollForRemoteChanges` to ~baseline (210/49). The 5 remaining are untouched pre-existing — documented, not fixed (out of scope).

- [x] **CLOSE-3. Verification stamp**
  - **File:** append `## Verification Stamp` to this file.
  - One line per AC-1…AC-11 citing the test/impl line or named test proving it (or `gap:` reason). Must list every AC. No `[ ]` may remain before CLOSE-4.
  - **UI:** approach UI Contract is `N/A — no UI surface`, so no visual-verification lines required.

- [x] **CLOSE-4. Version bump**
  - Run **`/update-spot-bundle`** first (StakTrakr: every version-bump PR), then **`/release patch`** as a skill. Do not hand-edit release artifacts. Copy the rebuilt bundle into the worktree (see `git-topology.md` §Spot Bundle).

- [x] **CLOSE-5. Vault update + close issue** — cloud-sync.md updated (DocVault `629dd90`); STRK-147 → In Review (Done deferred to post-merge per never-merge-self)
  - Invoke **`/vault-update`** (runs the Foundation-docs audit — `cloud-sync.md` likely touched). Mark STRK-147 **Done** in Plane (`mcp__plane__update_issue`).

- [x] **CLOSE-6. Open PR** → `dev` — [#1285](https://github.com/lbruton/StakTrakr/pull/1285)
  - Title `feat(STRK-147): cloud-sync item-price-history with UUID-aware merge`. Body: link STRK-147, link this sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-147-item-price-history-cloud-sync/`), test-plan checklist. Apply `coderabbit-review` + `codacy-review` labels (review-worthy runtime change).

- [x] **CLOSE-7. Resolve PR review threads** — 0 unresolved; reviewDecision cleared. 4 fixes landed (`14710b7c`); deferred → STRK-224 (failure/cancel/retry edges) + STRK-223 (explicit-clear tombstone). Codacy gate (duplication +33 + test-password TestCode) = **user UI dismissal** (inherent test-pattern mirroring; accepted per AskUserQuestion).
  - Invoke **`/pr-resolve`**. Scan BOTH inline diff threads AND review-body findings. Watch for async bot reviewers (Copilot/Codacy AI) posting 1–3 min after green. 75% docstring gate: write JSDoc on new functions pre-emptively.

- [x] **CLOSE-8. Archive sketch** (after PR merges) — PR #1285 merged 2026-06-17 (`c9e8e6d9`); folder archived; STRK-147 → Done.
  - Invoke **`/sketch archive STRK-147`**.

---

## UI Contract Traceability

**N/A** — `approach.md` UI Contract is "N/A — no UI surface." All ACs are verified by unit + Playwright behavior assertions; no mockup/playground/screenshot is referenced anywhere in the sketch.

---

> **Multi-model dispatch hint:** Cohort A (`[P]`) splits cleanly by file — A.1 constants, A.2 vault crypto, A.3 merge helpers to three models. Cohort B (`[P]`) splits by test file — B.1 unit / B.2 E2E / B.3 coverage-map. The B→C TDD boundary (one model writes red tests, another writes green impl) is a natural routing seam. Cohort C is sequential (shared `js/cloud-sync.js`) — single executor.

---

## Verification Stamp

_All 11 ACs proven. Suite green (CLOSE-1): unit 302/0, core Playwright 281/0. B.2 spec independently re-run: 7/7 green. UI Contract is `N/A — no UI surface`, so no visual-verification lines required._

- **AC-1** (cross-device union) — B.2 "two devices converge on the union…" ✓ + B.1 cross-device union assertion. Impl: `mergeItemPriceHistories` UUID-keyed union (C.2 pull wiring, `f5b55415`).
- **AC-2** (idempotent/convergent) — B.2 second-pull-no-op ✓ + B.1 `merge(X,X)===canonicalize(X)`. Impl: canonical output guarantees convergence (A.3, `b5e768d9`).
- **AC-3** (same-`ts` distinct + exact-dup collapse) — B.1 same-`ts` distinct/exact-dup test ✓. Impl: full-entry fingerprint dedupe `_itemPriceEntryFingerprint` (A.3).
- **AC-4** (history-only push trigger) — B.2 "history-only save schedules a debounced sync push" ✓. Impl: `saveItemPriceHistory()` → `scheduleSyncPush()` (C.5, `a4f64bab`).
- **AC-5** (silent metadata-only merge) — B.2 "companion-only pull merges silently without a diff modal" ✓ + "poll hash-shortcut detects companion-only change" ✓. Impl: silent companion merge + poll-shortcut companion branch / D-11 (C.2/C.3, `f5b55415`/`cb093f63`/`ef6634bf`).
- **AC-6** (orphan prevention) — B.2 "rejected remote Item imports no orphan history" ✓ + B.1 `acceptedUuids` filter. Impl: per-path `acceptedUuids` boundary in `mergeItemPriceHistories` (C.2).
- **AC-7** (partial-failure safety) — B.2 "quota/write failure leaves lastPull stale + partial state" ✓. Impl: throwing `writeItemPriceHistoryStrict` + `lastPull` hold on failure (A.3 + C.4, `cb093f63`).
- **AC-8** (lightweight manifest) — B.2 "manifest/metadata carries only {hash,count}, never full history JSON" ✓. Impl: `metaPayload.itemPriceHistoryVault={hash,uuidCount,entryCount}`; full JSON rides the `.stvault`, stays out of the manifest (C.1, `5177fa2f`).
- **AC-9** (logical commutative convergence) — B.1 commutativity `merge(A,B)===merge(B,A)` + compressed-vs-plain hash equality. Impl: `canonicalizeItemPriceHistory` + `collectAndHashItemPriceHistory` over canonical content (A.3).
- **AC-10** (retention preserved) — B.1 retention-applied-after-merge (400-day drop / 1000-entry cap). Impl: `applyItemPriceRetention` applied post-union in `mergeItemPriceHistories` (A.3).
- **AC-11** (STRK-141 boundaries) — `history-store-migration.spec.js` "no market-history key is in the cloud auto-sync scope" guard ran green in the CLOSE-1 core suite. Impl: `ALLOWED_STORAGE_KEYS`/`SYNC_SCOPE_KEYS` left byte-for-byte unchanged; `item-price-history` rides the dedicated companion vault, never the LWW settings path (A.1, `e2f1b262`).
