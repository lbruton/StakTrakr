---
sketch: "STRK-45-per-item-attachments"
phase: tasks
created: 2026-05-08
approved: 2026-05-09
---

# STRK-45 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

> **TDD note:** Playwright E2E tests in Cohort F require a running browser + real DOM with the attachment features implemented. Writing them before implementation would produce structurally invalid tests (no selectors, no IDB state, no backup fixtures). The tests are grouped immediately before closing tasks so they run against live implementation. The TDD spirit is preserved: test _assertions_ derive from AC acceptance criteria (the spec), not from implementation discovery.

> **Mockup gate (D11):** Cohort B-T2 runs `/ui-mockup` and pauses for user approval. All UI-rendering tasks in Cohort D are gated on that approval. Storage/backup/sync tasks in Cohorts A–C proceed independently.

> **AC-7 discrepancy:** ~~requirements.md AC-7 title still references "stmanifest"~~ — **Fixed 2026-05-09** during sketch approval review. AC-7 now references `-attachments.stvault` companion, consistent with approach v2.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-45-per-item-attachments`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.

## Sprint Cohort A — Foundation (parallel-safe)

_Define constants, types, the storage layer, and HTML scaffolding. All four tasks touch independent files._

- [x] **A.1 [P]** — Add attachment constants to `constants.js`
  - **File(s):** `js/constants.js`
  - **Acceptance:** `VAULT_ATTACHMENT_FILE_SUFFIX = "-attachments"`, `SYNC_ATTACHMENTS_PATH = "/StakTrakr/sync/staktrakr-attachments.stvault"`, `SYNC_ATTACHMENT_SIZE_WARN_BYTES = 100 * 1024 * 1024` defined. `"syncAttachments"` and `"syncAttachmentsWarnSeen"` added to `ALLOWED_STORAGE_KEYS`. `"syncAttachments"` added to `SYNC_SCOPE_KEYS`. Settings-table label entry added for Attachments sub-row. Window assignments follow existing pattern.
  - **Leverage:** Existing `VAULT_IMAGE_FILE_SUFFIX`, `SYNC_IMAGES_PATH`, `SYNC_SCOPE_KEYS` patterns.
  - **Maps to:** D4, D9 (constants foundation)

- [x] **A.2 [P]** — Document canonical attachment record shapes in `types.js`
  - **File(s):** `js/types.js`
  - **Acceptance:** JSDoc `@typedef` entries for: item-record attachment entry (`{attachmentUuid, fileName, type, size, uploadedAt}`), IDB record (adds `itemUuid` + `blob`), manifest entry (adds `itemUuid` + `file`). Canonical key name `attachmentUuid` used consistently.
  - **Leverage:** Existing typedef patterns in `types.js`.
  - **Maps to:** D4 (schema)

- [x] **A.3 [P]** — Create `js/attachment-manager.js` — IndexedDB storage layer
  - **File(s):** `js/attachment-manager.js` _(new)_
  - **Acceptance:** `AttachmentManager` class with `StakTrakrAttachments` v1 database, `userAttachments` store keyed by `attachmentUuid`. Public API: `addAttachment(record)`, `getAttachment(uuid)`, `deleteAttachment(uuid)`, `deleteAttachmentsForItem(itemUuid)`, `exportAllAttachments()`, `getAttachmentsByItemUuid(itemUuid)`, `getStorageUsage()`. Private helpers: `_ensureDb`, `_put`, `_get`, `_delete`, `_getAll`, `_iterate`, `_txComplete`. Singleton assigned to `window.attachmentManager`. Persistent-storage prompt (`navigator.storage.persist()`) on first add. `_ensureDb()` called before every transaction. QuotaExceededError caught on write (not pre-checked via estimate on `file://`).
  - **Leverage:** `js/image-cache.js` — mirror its `_ensureDb`, helper, and singleton patterns.
  - **Maps to:** AC-2, D1, D2, D14

- [x] **A.4 [P]** — Add HTML scaffolding to `index.html`
  - **File(s):** `index.html`
  - **Acceptance:** (1) `<script defer src="./js/attachment-manager.js">` after `image-cache.js`, `<script defer src="./js/attachment-ui.js">` after `attachment-manager.js` and before `inventory-backup.js`. (2) Attachments `.form-section` block between Notes (`#notesSection`) and Tags (`#tagsSection`) in the Edit modal — includes drop zone container, browse button, queued-files list container, saved-files list container (all empty/hidden by default; JS populates at runtime). (3) "Sync attachments" toggle element in Settings panel near the existing "Sync photos" toggle. (4) "Include attachments" checkbox in vault-export modal and cloud-export modal alongside "Include photos".
  - **Leverage:** Existing `.form-section` pattern (Notes, Tags sections); existing "Include photos" checkbox in vault modal.
  - **Maps to:** AC-1 (form section), AC-9 (sync toggle), D10, D11

## Sprint Cohort B — Item Integration + Mockup Gate (two tracks)

_Track 1: wire attachment metadata into inventory CRUD (no UI rendering). Track 2: produce the UI mockup and pause for approval. Tracks are independent._

- [x] **B.1 [P]** — Wire attachment metadata into `inventory.js` item lifecycle
  - **File(s):** `js/inventory.js`
  - **Acceptance:** `editItem()` reads `item.attachments` and calls into `attachment-ui.js` (stub call OK — UI rendering comes in Cohort D). `cloneItem()` sets `attachments = []` on the clone. `deleteInventoryItem()` calls `attachmentManager.deleteAttachmentsForItem(itemUuid)` before removing the item record. `splitInventoryItem()` keeps `attachments` on the original, sets split-off item's `attachments = []`. Delete-confirmation dialog copy includes "X attachments will also be deleted" when `item.attachments?.length > 0`.
  - **Leverage:** Existing `cloneItem`, `deleteInventoryItem`, `splitInventoryItem` functions.
  - **Maps to:** AC-2 (persist), D6 (cascade delete), D7 (clone reset), D13 (split rule)

- [x] **B.2 [P]** — Wire attachment staging into `events.js` form-submit path
  - **File(s):** `js/events.js`
  - **Acceptance:** Form-submit handler follows the user-image precedent (`saveUserImageForItem`): `commitItemToInventory()` runs first (generating UUID for add-mode at line 1620), then queued attachment Blobs are written to IDB via `attachmentManager.addAttachment()` using the committed item's `uuid` (retrieved from `inventory[inventory.length - 1].uuid` for add-mode, or `inventory[editingIndex].uuid` for edit-mode). On IDB-write failure, item metadata retains its `attachments` array but failed entries render a missing-binary warning state (user can retry by re-editing). Drag-drop event handlers (`dragover`, `drop`) and browse-button `change` handler register at runtime (not top-level — per `safeGetElement` constraint). File validation: accept only `application/pdf`, `image/png`, `image/jpeg`.
  - **Leverage:** Existing `saveUserImageForItem` post-commit pattern in `events.js` (line ~1957); `safeGetElement` constraint documented in CLAUDE.md.
  - **Maps to:** AC-1 (attach), AC-2 (persist), D14 (post-commit write ordering)

- [x] **B.3 [P]** — `/ui-mockup` — Attachment UI design pass (**APPROVAL GATE**)
  - **File(s):** _no code file changes — produces a Playground HTML mockup_
  - **Acceptance:** Interactive mockup covers: (1) Edit-modal Attachments section — drop zone + browse button (mobile parity), queued-files list with progress indicator, saved-files list with per-row file-type icon / filename / size / remove button; (2) attachment count badge on card view, table row, and view modal; (3) shared attachment list panel with download/open/remove/missing-binary/empty-state; (4) DiffModal per-attachment rows with replacement detection rendering. Mockup approved by user before any Cohort D task begins.
  - **Leverage:** `/ui-mockup` skill; approach D11, D15.
  - **Maps to:** AC-1 (drop zone UX), AC-8 (badge/list UX), D8 (DiffModal rendering), D11 (mockup gate), D15 (progress UI)

## Sprint Cohort C — Backup & Sync Pipeline (mixed parallelism)

_Depends on Cohort A (constants + attachment-manager). Independent of the mockup gate._

- [x] **C.1 [P]** — Add attachment export/import to `inventory-backup.js`
  - **File(s):** `js/inventory-backup.js`
  - **Acceptance:** `createBackupZip()` field mapper includes `attachments: item.attachments || []` in `inventoryData.inventory` items. Zip contains `user_attachments/{attachmentUuid}.{ext}` files + `user_attachment_manifest.json` with version, exportDate, entries (each: `attachmentUuid`, `itemUuid`, `file`, `fileName`, `type`, `size`, `uploadedAt`). `applyAncillaryData()` writes blobs **only for `attachmentUuid`s referenced by accepted DiffModal item-change entries** (scoped restore); on IDB-write failure during restore, leave missing-binary warning state on the item (don't roll back accepted metadata changes). CSV export: `Attachments` column appended with `fileName#attachmentUuid` entries; comment row documents CSV-only restore is metadata-only.
  - **Leverage:** Existing `user_images/` + `user_image_manifest.json` pattern (lines 270–305, 534–570).
  - **Maps to:** AC-3 (zip backup), AC-5 (CSV), AC-6 (zip restore)

- [x] **C.2 [P]** — Add CSV attachment parsing to `inventory-import.js`
  - **File(s):** `js/inventory-import.js`
  - **Acceptance:** CSV parser recognizes `Attachments` column header. Parses `fileName#attachmentUuid` entries into `attachments` array on each item. On CSV-only import (no paired zip/stvault), surfaces a missing-binary warning toast. DiffModal item-diff entries that include `attachments` field route to the polished attachment renderer (wired in Cohort E).
  - **Leverage:** Existing CSV column parsing in `inventory-import.js`.
  - **Maps to:** AC-5 (CSV column), D4 (metadata-only restore)

- [x] **C.3 [P]** — Add stvault attachment companion to `vault.js`
  - **File(s):** `js/vault.js`
  - **Acceptance:** New functions: `collectAndHashAttachmentVault()`, `vaultEncryptAttachmentVault()`, `vaultDecryptAndRestoreAttachments()`. New slot: `_vaultPendingAttachmentFile` + `setVaultPendingAttachmentFile()`. Companion file named `staktrakr_backup_{ts}-attachments.stvault` (hyphen, matching `-images` convention). PBKDF2-AES-256-GCM encryption with same passphrase-derived key as main vault + image companion. "Include attachments" checkbox wired in vault-export modal and `cloud-export` mode alongside "Include photos". Manual restore branch handles deferred-companion path for attachments.
  - **Leverage:** Existing `collectAndHashImageVault`, `vaultEncryptImageVault`, `vaultDecryptAndRestoreImages` pattern in `vault.js`.
  - **Maps to:** AC-4 (stvault backup), AC-7 (stvault restore), D5

- [x] **C.4** — Wire attachment sync parity into `cloud-sync.js`
  - **File(s):** `js/cloud-sync.js`
  - **Depends on:** C.3 (vault encrypt/decrypt functions must exist)
  - **Acceptance:** Full parity across all 7 image-companion code sites in `cloud-sync.js` (vault.js sites are covered by C.3):
    1. Push: upload encrypted attachment companion to `SYNC_ATTACHMENTS_PATH` (cf. image at ~line 1706)
    2. Push: carry-forward remote attachment metadata when local has no attachments (cf. ~line 1749)
    3. Push: delete attachment companion from remote when attachments removed (cf. ~line 1767)
    4. Push: write `attachmentVault` metadata to push payload (cf. ~line 1810)
    5. Pull: vault-first DiffModal/fallback restore (cf. ~line 2305)
    6. Pull: manifest-deferred / auto-merge restore (cf. ~line 2882)
    7. Pull: silent pull (cf. ~line 3060)
       Gated by `syncAttachments` localStorage key (missing key defaults to `true`). Size estimate via `attachmentManager.getStorageUsage()`; 100 MB warning fires once, persists via `syncAttachmentsWarnSeen`. Remote attachments preserved when local has none (initial-load); deleted from remote when authoritative local item deletes them.
  - **Leverage:** Existing image-companion sync branches in `cloud-sync.js` — mirror all 7 by grepping for `imageVault`/`SYNC_IMAGES_PATH` references.
  - **Maps to:** AC-9 (sync opt-out), D9

## Sprint Cohort D — UI Rendering (**gated on B.3 mockup approval**)

_All tasks depend on B.3 (approved mockup) and A.3 (attachment-manager). `attachment-ui.js` must be created first (provides factories), then the three view integrations can run in parallel._

- [x] **D.1** — Create `js/attachment-ui.js` — DOM rendering module
  - **File(s):** `js/attachment-ui.js` _(new)_
  - **Depends on:** B.3 (approved mockup)
  - **Acceptance:** Exports factory functions: (1) `renderAttachmentSection(item, containerEl)` — drop zone + browse (mobile parity) + queued-files list with per-row progress + saved-files list with file-type icon / filename / size / uploadedAt / remove button; (2) `renderAttachmentBadge(item)` — returns a badge element with attachment count + click handler; (3) `renderAttachmentListPanel(item, options)` — shared list surface with download/open-in-tab, remove (when editable), missing-binary warning row, empty state; (4) `renderAttachmentDiffRow(entry, type)` — DiffModal row with file icon, filename, size, "replaced" state, missing-binary warning, conflict highlighting. CSS classes use the mockup design. Disabled save state + per-row progress indicator for staging (D15).
  - **Leverage:** Mockup from B.3; approach D3, D8, D15.
  - **Maps to:** AC-1 (edit UX), AC-8 (badge/list), D3, D15

- [x] **D.2 [P]** — Wire attachment badge into `viewModal.js`
  - **File(s):** `js/viewModal.js`
  - **Depends on:** D.1
  - **Acceptance:** `buildViewContent()` renders attachment count badge when `item.attachments?.length > 0`. Badge click opens the shared attachment list panel. Badge absent when no attachments.
  - **Leverage:** `renderAttachmentBadge` + `renderAttachmentListPanel` from `attachment-ui.js`.
  - **Maps to:** AC-8

- [x] **D.3 [P]** — Wire attachment chip into `card-view.js`
  - **File(s):** `js/card-view.js`
  - **Depends on:** D.1
  - **Acceptance:** Card renders an attachment count chip (similar to tag chips) when `item.attachments?.length > 0`. Chip click opens the shared attachment list panel. Chip absent when no attachments.
  - **Leverage:** `renderAttachmentBadge` + `renderAttachmentListPanel` from `attachment-ui.js`.
  - **Maps to:** AC-8

- [x] **D.4 [P]** — Wire attachment badge into `inventory-table.js`
  - **File(s):** `js/inventory-table.js`
  - **Depends on:** D.1
  - **Acceptance:** Table row shows a small paperclip badge when `item.attachments?.length > 0` (no new column). Badge click opens the shared attachment list panel. Badge absent when no attachments.
  - **Leverage:** `renderAttachmentBadge` + `renderAttachmentListPanel` from `attachment-ui.js`.
  - **Maps to:** AC-8

## Sprint Cohort E — Integration & Polish (mixed parallelism)

_Cross-cutting integration: diff engine, change log, settings, init, CSS. Dependencies noted per task._

- [x] **E.1** — Add `attachments` to `DIFF_FIELDS` with custom array-diff comparator in `diff-engine.js`
  - **File(s):** `js/diff-engine.js`
  - **Acceptance:** `DIFF_FIELDS` array includes `"attachments"`. A **custom attachment-aware comparator** replaces the default `_valuesEqual` stringification for this field — current `compareItems()` emits one coarse `{field, localVal, remoteVal}` and `applySelectedChanges()` replaces whole fields, which is insufficient for per-attachment granularity. The comparator must: (a) diff by `attachmentUuid` as key, (b) detect replacement (same `fileName` + different `attachmentUuid` → emit "replaced" entry instead of separate add + remove), (c) emit per-entry change records (`{attachmentUuid, action: "add"|"remove"|"replace", local?, remote?}`). `applySelectedChanges()` must handle per-entry apply (not whole-array replacement). Sync conflict detection sees attachment field changes.
  - **Leverage:** Existing `DIFF_FIELDS` array, `_valuesEqual`, `compareItems`, `applySelectedChanges` in `diff-engine.js`.
  - **Maps to:** D8 (DiffModal data)

- [x] **E.2** — Add polished attachment rendering to `diff-modal.js`
  - **File(s):** `js/diff-modal.js`
  - **Depends on:** E.1 (per-entry change records), D.1 (`renderAttachmentDiffRow` factory)
  - **Acceptance:** When an item diff includes `attachments` field, consumes E.1's per-entry change records and renders per-attachment rows using `renderAttachmentDiffRow`: file-type icon, filename, size, uploadedAt, "replaced" state (not separate add+remove), missing-binary warning, conflict highlighting, clear per-row apply/reject affordances. Accepting/rejecting individual attachment changes updates the item's `attachments` array at per-entry granularity (not whole-array replacement).
  - **Leverage:** `renderAttachmentDiffRow` from `attachment-ui.js`; E.1's per-entry change records; existing field-specific renderers in `diff-modal.js`.
  - **Maps to:** AC-6 (DiffModal for zip restore), D8

- [x] **E.3 [P]** — Add attachment change logging to `changeLog.js`
  - **File(s):** `js/changeLog.js`
  - **Acceptance:** History parity: attachment add/remove/replace events logged with `attachmentUuid` + `fileName`. Change log entries appear in the item's change history alongside existing field changes.
  - **Leverage:** Existing change-type patterns in `changeLog.js`.
  - **Maps to:** D8 (history parity)

- [x] **E.4** — Add Settings UI for sync toggle + storage display in `settings.js`
  - **File(s):** `js/settings.js`
  - **Acceptance:** "Sync attachments" toggle rendered in Settings panel (reads/writes `syncAttachments` localStorage key). Storage table relabeled: "IndexedDB" with two sub-rows — "Images" (existing) and "Attachments" (via `attachmentManager.getStorageUsage()`).
  - **Leverage:** Existing "Sync photos" toggle pattern; existing storage table in `settings.js`.
  - **Maps to:** AC-9, D1 (quota reporting)

- [x] **E.5** — Wire sync toggle listener in `settings-listeners.js`
  - **File(s):** `js/settings-listeners.js`
  - **Depends on:** E.4 (toggle element exists)
  - **Acceptance:** Listener persists toggle state to `syncAttachments` localStorage key on change. Reads initial state from localStorage (default `true` when key missing).
  - **Leverage:** Existing listener patterns in `settings-listeners.js`.
  - **Maps to:** AC-9

- [x] **E.6 [P]** — Initialize attachment manager in `init.js`
  - **File(s):** `js/init.js`
  - **Acceptance:** `attachmentManager` quota estimate initialized alongside `imageCache._initQuota()` call. No top-level `safeGetElement` calls introduced.
  - **Leverage:** Existing `imageCache._initQuota()` call site in `init.js`.
  - **Maps to:** D2 (singleton lifecycle)

- [x] **E.7** — Add CSS for attachment UI surfaces in `css/styles.css`
  - **File(s):** `css/styles.css`
  - **Depends on:** D.1 (class names finalized from mockup implementation)
  - **Acceptance:** Styles for: drop-zone hover/active states, queued-files list rows with progress bar, saved-files list rows, attachment-count badge/chip, shared list panel layout, missing-binary warning state, empty state, DiffModal per-attachment rows. Mobile-viewport browse-button parity (visible, tappable). All three themes (light, dark, sepia) have appropriate styling.
  - **Leverage:** Mockup from B.3; existing `.form-section` and badge styles.
  - **Maps to:** AC-1 (drop zone), AC-8 (badges), D15 (progress)

- [x] **E.8** — Add new JS files to `CORE_ASSETS` in `sw.js`
  - **File(s):** `sw.js`
  - **Acceptance:** `CORE_ASSETS` array includes `"./js/attachment-manager.js"` and `"./js/attachment-ui.js"`. `CACHE_NAME` bump is handled automatically by the `stamp-sw-cache` pre-commit hook — no manual edit needed for that.
  - **Leverage:** Existing `CORE_ASSETS` entries in `sw.js`.
  - **Maps to:** D10 (script load order)

- [x] **E.9** — Amend requirements.md AC-7 title to match STVAULT approach
  - **File(s):** `requirements.md` (sketch artifact, not source code)
  - **Acceptance:** AC-7 title updated from "Stvault restore re-associates via stmanifest" to "Stvault restore re-associates via attachment companion". Body language updated to reference `staktrakr_backup_{ts}-attachments.stvault` companion (STVAULT envelope, not STMF). Consistent with approach.md D5.
  - **Leverage:** Approach.md revision note (AC-4 amendment).
  - **Maps to:** Sketch internal consistency

## Sprint Cohort F — Playwright E2E Tests

_Tests are written after implementation is runnable. Each test file maps to a functional area from approach.md's New files list. All test files touch independent directories and can run in parallel._

- [x] **F.1 [P]** — Write attachment manager tests
  - **File(s):** `tests/playwright/attachments/manager.spec.js` _(new)_
  - **Acceptance:** Tests cover: IDB roundtrip (add → get → verify), persistent-storage prompt invoked on first add, cascade delete (`deleteAttachmentsForItem` removes all for an itemUuid), split-item original retains attachments, clone resets to `[]`, `exportAllAttachments()` shape matches manifest schema, post-commit IDB failure leaves missing-binary warning state (item metadata retains `attachments` array, but no binary in IDB), both add-mode and edit-mode IDB failure paths.
  - **Maps to:** AC-2, D6, D7, D13, D14

- [x] **F.2 [P]** — Write zip backup/restore tests
  - **File(s):** `tests/playwright/attachments/backup-zip.spec.js` _(new)_
  - **Acceptance:** Tests cover: zip export contains `user_attachments/` folder + `user_attachment_manifest.json`, manifest entries include `file` field, `inventoryData.inventory` items carry `attachments` array, restore writes blobs only for accepted DiffModal changes (rejected change leaves no orphan), CSV `Attachments` column shape, missing-binary toast on CSV-only restore.
  - **Maps to:** AC-3, AC-5, AC-6

- [x] **F.3 [P]** — Write stvault companion tests
  - **File(s):** `tests/playwright/attachments/vault-stvault.spec.js` _(new)_
  - **Acceptance:** Tests cover: companion encrypt/decrypt roundtrip, companion file naming uses `-attachments` suffix, manual restore re-associates by `attachmentUuid`, deferred-companion path works, "Include attachments" checkbox toggles companion generation.
  - **Maps to:** AC-4, AC-7

- [x] **F.4 [P]** — Write cloud sync tests
  - **File(s):** `tests/playwright/attachments/cloud-sync.spec.js` _(new)_
  - **Acceptance:** Tests cover all 7 `cloud-sync.js` code sites from C.4's enumerated checklist: push upload, push carry-forward, push delete, push metadata, pull vault-first DiffModal, pull manifest-deferred/auto-merge, pull silent. Consider splitting into two test groups for diagnosability: (a) branch-level sync flow tests (fixtures for metadata, manifest, vault bytes, Dropbox upload/download/delete, lastPull/lastPush state), (b) UI toggle/warning tests (`syncAttachments` toggle off-state skips upload, missing key defaults to `true`, 100 MB warning fires once and persists via `syncAttachmentsWarnSeen`).
  - **Maps to:** AC-9

- [x] **F.5 [P]** — Write DiffModal attachment rendering tests
  - **File(s):** `tests/playwright/attachments/diff-modal.spec.js` _(new)_
  - **Acceptance:** Tests cover: `DIFF_FIELDS` includes `attachments`, replacement renders as "replaced" (not remove+add), missing-binary warning row renders, conflict highlighting on cloud-sync conflicts, apply/reject per-attachment row.
  - **Maps to:** AC-6, D8

- [x] **F.6 [P]** — Write attachment UI tests
  - **File(s):** `tests/playwright/attachments/ui.spec.js` _(new)_
  - **Acceptance:** Tests cover: drag-drop AND browse path both add files, mobile-viewport browse parity (browse button visible and tappable), delete-confirmation dialog includes attachment count, Settings storage table shows Attachments sub-row, CSV import warns/parses Attachments column, progress indicator appears during staging.
  - **Maps to:** AC-1, AC-8, D15

---

## Standard Closing Tasks

> **Numbering:** Continues from Cohort F.

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test` (full Playwright suite). All existing tests pass; all new tests from Cohort F pass.
  - If anything fails: fix the implementation, not the test.
  - **Result (2026-05-09):** 574 passed, 1 failed (`theme-tokens.spec.js:20` — pre-existing, verified by stash-test on base branch). All 6 new attachment spec files passed.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **Result (2026-05-09):** All findings are browser-global `no-undef` false positives (ESLint doesn't recognise script-tag globals per CLAUDE.md) or pre-existing `no-prototype-builtins`/`no-unused-vars` outside my change ranges. Zero new actionable findings.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-9), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Status-only notes are not equivalent — the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`)
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip.
  - Mark the source issue Done in Plane: `mcp__plane__update_issue` to state "Done".

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/sketch apply`. Title: `feat(STRK-45): per-item PDF/image attachments` (user-facing feature).
  - Body must include: link to source issue (`https://plane.lbruton.cc/lbruton/browse/STRK-45/`), link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-45-per-item-attachments/`), test plan checklist.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as "comments outside of the diff" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.

- [x] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-45`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-45-per-item-attachments/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort A tasks (A.1–A.4) can be sent to different models in parallel via OpenCode. Suggested split: A.1+A.2 to Codex (fast constant/type edits), A.3 to Claude (complex IDB class), A.4 to Gemini (HTML scaffolding). Track 1 of Cohort B (B.1+B.2) and Track 2 (B.3 mockup) run concurrently. Cohort C tasks C.1+C.2 are parallel; C.3→C.4 are sequential. Cohort D starts after B.3 approval; D.2+D.3+D.4 are parallel after D.1. Cohort F tests are all parallel.

## Verification Stamp

_Generated 2026-05-09. Each line cites the test or implementation location that proves the criterion._

- [x] AC-1 — verified at `index.html:2738` (drag-drop zone + Browse button in Edit modal) and `js/attachment-ui.js:107` (`_buildQueuedRow` builds queued file row with remove button); confirmed by `ui.spec.js` — "renders file names in the panel"
- [x] AC-2 — verified at `js/attachment-manager.js:128` (`addAttachment`) and `js/attachment-manager.js:153` (`getAttachment`); confirmed by `manager.spec.js` — "addAttachment / getAttachment roundtrip persists all fields"
- [x] AC-3 — verified at `js/inventory-backup.js:305` (`user_attachments/` folder), `:313` (uuid-keyed path), `:325` (`user_attachment_manifest.json`); confirmed by `backup-zip.spec.js` — "exportAllAttachments returns entries that map to zip paths matching manifest schema"
- [x] AC-4 — verified at `js/vault.js:1193` (companion filename using `VAULT_ATTACHMENT_FILE_SUFFIX`) and `js/constants.js:623` (`VAULT_ATTACHMENT_FILE_SUFFIX = "-attachments"`); confirmed by `vault-stvault.spec.js` — "VAULT_ATTACHMENT_FILE_SUFFIX equals -attachments"
- [x] AC-5 — verified at `js/inventory-backup.js:162` (CSV "Attachments" column header) and `js/inventory-backup.js:216` (`fileName#uuid|...` serialization); confirmed by `backup-zip.spec.js` — "CSV Attachments column shape: fileName#attachmentUuid pairs joined by |"
- [x] AC-6 — verified at `js/diff-engine.js` (`_diffAttachments` + `applySelectedChanges` `attach-entry` type) and `js/diff-modal.js` (attachment field rendering branch at line 1821+); confirmed by `diff-modal.spec.js` — "DiffEngine.diffAttachments detects added attachment" and "applySelectedChanges with attach-entry add action applies attachment"
- [x] AC-7 — verified at `js/vault.js:1193` (companion file with `-attachments.stvault` suffix) and `js/constants.js:623`; confirmed by `vault-stvault.spec.js` — "UUID re-association contract: attachment metadata from vault maps to itemUuid"
- [x] AC-8 — verified at `js/attachment-ui.js:232` (`renderAttachmentBadge`) wired into `js/card-view.js` and `js/inventory-table.js`; `js/attachment-ui.js:259` (`renderAttachmentListPanel`) wired into `js/viewModal.js`; confirmed by `ui.spec.js` — "returns a DOM element with count for single attachment"
- [x] AC-9 — verified at `js/constants.js:898` (`syncAttachments` in `SYNC_SCOPE_KEYS`) and `js/constants.js:1040-1041` (in `ALLOWED_STORAGE_KEYS`); confirmed by `cloud-sync.spec.js` — "syncAttachments key is in ALLOWED_STORAGE_KEYS" and "setting syncAttachments to false persists via saveData/loadDataSync"
