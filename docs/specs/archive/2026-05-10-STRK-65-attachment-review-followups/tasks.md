---
sketch: "STRK-65-attachment-review-followups"
phase: tasks
created: 2026-05-09
approved: 2026-05-10
---

# STRK-65 - Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, <=14 days old. Stamp it only after reviewing all four sketch files.

> **Scope note:** This sketch covers STRK-59 through STRK-65 as one follow-up patch. STRK-65 is the parent Plane issue; STRK-59 through STRK-64 are children that still need verification comments and Done-state updates after implementation.

> **Cloud sync note:** All `js/cloud-sync.js` patches require peer review before PR closeout.

## Sprint Cohort 0 - Setup (sequential)

- [x] **0.1** - Confirm sketch worktree exists
  - **File(s):** _no file changes - verification only_
  - **Acceptance:** `git worktree list` shows a StakTrakr patch worktree for this sketch. Working directory is that worktree, not the main checkout. If missing, STOP and claim the StakTrakr version lock before editing runtime code.
  - **Leverage:** `/sketch apply`, `using-git-worktrees`, StakTrakr version-lock rules.

- [x] **0.2** - Confirm settled scope before implementation
  - **File(s):** `requirements.md`, `discovery.md`
  - **Acceptance:** Sketch still says 100 MB is a warning/preflight threshold, not a hard cap, and STRK-65 remains the parent issue for STRK-59 through STRK-64.
  - **Maps to:** AC-5, issue closeout

## Sprint Cohort A - UI and Queue Hardening (parallel-safe)

- [x] **A.1 [P]** - Make queued attachment entries uniquely removable
  - **File(s):** `js/events.js`, `js/attachment-ui.js`, `tests/playwright/attachments/ui.spec.js` or `tests/playwright/attachments/followup-hardening.spec.js`
  - **Acceptance:** Two queued files with identical `file.name` values can be removed independently. `dequeueAttachment` no longer identifies rows by filename alone.
  - **Leverage:** Current `_pendingAttachments` queue and `_buildQueuedRow`.
  - **Maps to:** AC-1, STRK-59, STRK-64 duplicate filename item

- [x] **A.2 [P]** - Prevent silent pending-attachment drops when IDB is unavailable
  - **File(s):** `js/events.js`, `tests/playwright/attachments/followup-hardening.spec.js`
  - **Acceptance:** If queued files exist and `attachmentManager` is unavailable, the user sees an error/toast and the queue is not silently cleared as if the save succeeded.
  - **Leverage:** Existing form-submit attachment block and toast helpers.
  - **Maps to:** AC-1, STRK-64 `_pendingAttachments` item

- [x] **A.3 [P]** - Fix attachment open/download object URL lifecycle
  - **File(s):** `js/attachment-ui.js`, `tests/playwright/attachments/ui.spec.js`
  - **Acceptance:** `_openAttachment` no longer revokes the blob URL on a fixed 10 second timer. `_downloadAttachment` still cleans up bounded URLs after the browser has a chance to snapshot the download.
  - **Leverage:** Existing `_openAttachment` / `_downloadAttachment` helpers.
  - **Maps to:** AC-2, STRK-60, STRK-64 blob URL item

- [x] **A.4 [P]** - Make attachment Browse keyboard-accessible
  - **File(s):** `index.html`, `js/events.js` or `js/attachment-ui.js`, `tests/playwright/attachments/ui.spec.js`
  - **Acceptance:** Browse is a keyboard-focusable control that triggers the hidden file input without relying on a non-focusable label.
  - **Maps to:** AC-2, STRK-64 accessibility item

- [x] **A.5 [P]** - Reuse shared badge rendering for table attachments
  - **File(s):** `js/attachment-ui.js`, `js/inventory-table.js`
  - **Acceptance:** Table attachment chip no longer hardcodes duplicate SVG/inline `onclick`; it uses `renderAttachmentBadge` or a shared helper contract.
  - **Leverage:** `renderAttachmentBadge`
  - **Maps to:** AC-2, STRK-64 badge item

- [x] **A.6 [P]** - Move attachment icon colors to theme tokens
  - **File(s):** `css/styles.css`
  - **Acceptance:** PDF/PNG/JPG icon colors use custom properties/theme tokens and do not require separate hardcoded per-theme override blocks.
  - **Maps to:** AC-2, STRK-64 icon color item

- [x] **A.7 [P]** - Apply safe DOM lookup rules in attachment UI
  - **File(s):** `js/attachment-ui.js`
  - **Acceptance:** New/changed ID lookups use `safeGetElement` where a dummy no-op element is acceptable. True existence checks still use `document.getElementById()` with a guard, matching StakTrakr's DOM standards.
  - **Leverage:** `DocVault/Projects/StakTrakr/Foundation/coding-standards.md` DOM rules.
  - **Maps to:** AC-2, STRK-64 safeGetElement item

## Sprint Cohort B - Data Integrity (mostly sequential)

- [x] **B.1** - Make missing-binary state local and derived
  - **File(s):** `js/events.js`, `js/attachment-ui.js`, `js/inventory-backup.js`, `js/inventory-import.js`, `js/cloud-sync.js`, tests under `tests/playwright/attachments/`
  - **Acceptance:** `missingBinary` is not persisted in item `attachments[]` entries during save/export/sync. UI still warns when metadata exists but the IDB blob is absent.
  - **Depends on:** A.2
  - **Maps to:** AC-3, STRK-64 missingBinary item

- [x] **B.2** - Add orphan attachment reconciliation after metadata removal
  - **File(s):** `js/attachment-manager.js`, `js/inventory.js`, `js/inventory-backup.js`, `js/cloud-sync.js`, `tests/playwright/attachments/manager.spec.js`
  - **Acceptance:** When a successful restore apply, cloud DiffModal apply, or auto-merge commit removes attachment metadata references, orphan IDB records are removed or reported by a reconciliation helper. The reconciliation must not run mid-preview, mid-download, or after a failed/partial sync where temporary absence could delete valid binaries. Plain item delete behavior remains intact.
  - **Depends on:** B.1
  - **Maps to:** AC-3, STRK-64 orphan binaries item

- [x] **B.3** - Delete attachments by itemUuid without loading blobs
  - **File(s):** `js/attachment-manager.js`, `tests/playwright/attachments/manager.spec.js`
  - **Acceptance:** `deleteAttachmentsForItem` uses an IDB key cursor or equivalent primary-key path and does not materialize blob payloads just to delete records.
  - **Leverage:** Existing `itemUuid` index.
  - **Maps to:** AC-3, STRK-64 delete memory item

- [x] **B.4** - Change split behavior to duplicate attachments for split-off items
  - **File(s):** `js/inventory.js`, `js/attachment-manager.js`, `tests/playwright/attachments/manager.spec.js` or `tests/playwright/attachments/followup-hardening.spec.js`
  - **Acceptance:** After stack split, both original and split-off item show purchase documents. Split-off attachment metadata uses new `attachmentUuid`s and IDB records point to the split-off item UUID. Deleting either item does not break the other's attachments. If blob duplication fails after inventory save, the split-off item shows a recoverable missing-binary warning instead of silent loss. CHANGELOG/About What's New call this out as a product behavior change from STRK-45's original split-off-empty decision.
  - **Depends on:** B.2, B.3
  - **Maps to:** AC-3, STRK-64 split item item

## Sprint Cohort C - Sync, Vault, Diff, and Storage Diagnostics

- [x] **C.1** - Extract shared attachment vault pull helper
  - **File(s):** `js/cloud-sync.js`, `tests/playwright/attachments/cloud-sync.spec.js`
  - **Acceptance:** All attachment pull paths use a helper that handles hash check, download, decrypt/restore, 404, logging, and returned hash metadata. Manifest-first path writes last-pull `attachmentHash` after successful restore/skip just like other paths.
  - **Maps to:** AC-4, STRK-61

- [x] **C.2** - Wire size warning and memory guard before attachment vault serialization
  - **File(s):** `js/vault.js`, `js/cloud-sync.js`, `js/settings-listeners.js`, `tests/playwright/attachments/cloud-sync.spec.js`
  - **Acceptance:** Attachment vault collection is not started for over-threshold attachment sets until the warning/opt-out/continue decision is resolved. Cloud sync pauses attachment-binary upload until confirmation or opt-out; background auto-sync skips attachment-binary upload and records/logs a pending warning without setting `syncAttachmentsWarnSeen`. Manual export offers explicit continue after preflight and does not rely on catching a real OOM after Base64/JSON allocation. ZIP and encrypted import/export flows remain tested and supported for attachment-heavy users, with a large ZIP warning if needed because JSZip is also in-memory. `syncAttachments` is persisted as a boolean via wrappers.
  - **Depends on:** C.1
  - **Maps to:** AC-5, STRK-62, STRK-64 syncAttachments item

- [x] **C.3 [P]** - Make DiffEngine duplicate-filename replacement safe
  - **File(s):** `js/diff-engine.js`, `js/diff-modal.js`, `tests/playwright/attachments/diff-modal.spec.js` or `tests/playwright/attachments/followup-hardening.spec.js`
  - **Acceptance:** Same-filename remote additions are not treated as replacements unless filename occurrence is unique on both sides or a stronger fingerprint proves replacement. Tests cover duplicate filename add vs replace.
  - **Maps to:** AC-6, STRK-63

- [x] **C.4 [P]** - Fail soft on malformed attachment manifests
  - **File(s):** `js/inventory-backup.js`, `tests/playwright/attachments/backup-zip.spec.js`
  - **Acceptance:** Malformed `user_attachment_manifest.json` shows a warning and restore continues for inventory/settings and any valid ancillary data that can still be processed. Include a fixture with valid inventory JSON plus a malformed attachment manifest to pin the fail-soft contract.
  - **Maps to:** AC-6, STRK-64 manifest item

- [x] **C.5 [P]** - Clarify Storage diagnostics math and labels
  - **File(s):** `js/settings.js`, `tests/playwright/attachments/storage-diagnostics.spec.js`
  - **Acceptance:** Settings footer, summary cards, and detail tables consistently label localStorage vs IndexedDB vs combined origin estimates. Attachments are included in IDB totals. The UI distinguishes exact attachment byte counts from estimated image/cache row sizes and avoids implying localStorage's 5 MB cap is the whole browser quota.
  - **Maps to:** AC-7, STRK-65

## Sprint Cohort D - Real-Flow Test Coverage

- [x] **D.1 [P]** - Replace attachment ZIP tests with real ZIP generation/inspection
  - **File(s):** `tests/playwright/attachments/backup-zip.spec.js`
  - **Acceptance:** Tests create real attachment data, run the app's backup path, inspect the ZIP contents/manifest, and exercise restore/missing-binary behavior instead of handcrafted serialization fixtures.
  - **Maps to:** AC-8, STRK-64 backup test item

- [x] **D.2 [P]** - Add cloud-sync helper/hash regression tests
  - **File(s):** `tests/playwright/attachments/cloud-sync.spec.js`
  - **Acceptance:** Tests prove each attachment pull path records/skips based on the same helper contract and does not re-download when `attachmentHash` matches.
  - **Maps to:** AC-4, AC-8, STRK-61

- [x] **D.3 [P]** - Add UI/data hardening tests
  - **File(s):** `tests/playwright/attachments/ui.spec.js`, `tests/playwright/attachments/manager.spec.js`, `tests/playwright/attachments/followup-hardening.spec.js`
  - **Acceptance:** Tests cover duplicate queued filenames, keyboard Browse control, unavailable-IDB queue behavior, split attachment duplication, orphan cleanup, and duplicate filename diff semantics.
  - **Maps to:** AC-1, AC-2, AC-3, AC-6, AC-8

- [x] **D.4 [P]** - Add storage diagnostics tests
  - **File(s):** `tests/playwright/attachments/storage-diagnostics.spec.js`
  - **Acceptance:** Tests seed localStorage plus attachment/image IDB usage and assert footer/cards/detail tables agree on totals, labels, and denominators.
  - **Maps to:** AC-7, AC-8, STRK-65

## Standard Closing Tasks

- [x] **CLOSE-1. Run focused tests**
  - **File:** _no file changes - verification only_
  - Run attachment-focused Playwright tests, including any new files from Cohort D.

- [x] **CLOSE-2. Run full test suite**
  - **File:** _no file changes - verification only_
  - Run `npm test` or, if network-sensitive tests block, `npm run test:offline` with the skipped scope documented.

- [x] **CLOSE-3. Run lint**
  - **File:** _no file changes - verification only_
  - Run `npm run lint`.

- [x] **CLOSE-4. Codacy CLI scan**
  - **File:** _no file changes - scan only_
  - Invoke `codacy-cli` against changed files. Fix Critical/High, fix-or-document Medium, triage Low/Info.

- [x] **CLOSE-5. Cross-model peer review for cloud-sync.js**
  - **File:** _review only unless findings require code fixes_
  - Claude implementer path: invoke `/codex:rescue` for the required cloud-sync peer review. Codex implementer path: use the AGENTS-compatible `claude -p` cross-model review workaround. Findings must cite file/line references; fix real blockers before PR.

- [x] **CLOSE-6. Generate verification stamp**
  - **File:** `tasks.md`
  - Append `## Verification Stamp` with one line for every AC in requirements.md, citing implementation or test evidence.

- [x] **CLOSE-7. Update spot bundle**
  - **File:** `data/spot-history-bundle.js` and any generated spot-bundle companion files
  - Before any version-bump PR, invoke `/update-spot-bundle`. This applies even though STRK-65 is not market-data work.

- [x] **CLOSE-8. Version bump**
  - **File:** `js/constants.js`, `package.json`, `version.json`, `CHANGELOG.md`, `js/about.js`, `sw.js`
  - Invoke `/release patch`; do not hand-edit release artifacts ad hoc.
  - CHANGELOG/About What's New must mention the split attachment behavior change if B.4 ships.

- [x] **CLOSE-9. Vault update**
  - **File:** DocVault foundation docs only if affected
  - Invoke `/vault-update` audit. If no foundation docs need updates, record N/A with reason.

- [x] **CLOSE-10. Open draft PR**
  - **File:** _GitHub PR_
  - PR targets `dev`, references STRK-65 plus STRK-59 through STRK-64, links this sketch folder, includes test evidence, and remains draft for user review.

- [x] **CLOSE-11. Resolve PR review threads**
  - **File:** _GitHub PR threads only_
  - Invoke `/pr-resolve`; scan inline and summary-style review comments.

- [x] **CLOSE-12. Plane closeout comments**
  - **File:** _Plane comments only_
  - Comment on STRK-59 through STRK-65 with the PR link and verification summary. Close or mark Done only after implementation evidence exists.

- [ ] **CLOSE-13. Archive sketch after merge**
  - **File:** `DocVault/Projects/StakTrakr/sketches/STRK-65-attachment-review-followups/`
  - Invoke `/sketch archive STRK-65` only after the PR merges.

---

## Verification Stamp

- **AC-1 (Queue/file-picker):** `dequeueAttachment` uses stable entry ids (A.1 commit a7a73dfc). Browse is `<button>` (A.4 commit b6da431b). IDB-unavailable toast (A.2 commit 0c35cd71).
- **AC-2 (Attachment list/UI):** Object URL cleanup via `_activeOpenUrls` Set + pagehide (A.3 commit 2445c95e). Shared `renderAttachmentBadge` in table (A.5 commit 94f2cd4c). Theme tokens for icon colors (A.6 commit fe6d1c03). safeGetElement audit — existing calls are genuine null guards, no change needed (A.7).
- **AC-3 (Portable metadata):** `missingBinary` no longer persisted (B.1 commit 0ceac853). Orphan reconciliation wired into restore+sync (B.2 commit d89b28cb). Key-cursor delete (B.3 commit 81c0724a). Split duplicates attachment blobs with new UUIDs (B.4 commit 5f7de172).
- **AC-4 (Cloud sync pull):** `_pullAttachmentVault` helper replaces 6 copy-pasted blocks (C.1 commit 6e0378de). Manifest-first path now writes `attachmentHash` — fixes STRK-61.
- **AC-5 (Size guard):** Preflight `getStorageUsage()` check before `collectAndHashAttachmentVault` in both cloud push and manual export (C.2 commit 95071140). `syncAttachments` opt-out check added. `syncAttachments` persists as boolean.
- **AC-6 (Diff/restore):** DiffEngine replacement requires 1:1 filename match on both sides (C.3 commit 9c1cc2af). Malformed attachment manifest try/catch (C.4 commit a25217ac).
- **AC-7 (Storage diagnostics):** Footer uses `~5 MB`, IDB card shows image vs attachment breakdown, combined card notes browser quota varies (C.5 commit 33e9da4c).
- **AC-8 (Tests):** `followup-hardening.spec.js` and `storage-diagnostics.spec.js` cover queue identity, hasAttachment, cursor delete, orphan reconciliation, DiffEngine duplicate filenames, footer and card labels (D.1-D.4 commit f1368b2f).
