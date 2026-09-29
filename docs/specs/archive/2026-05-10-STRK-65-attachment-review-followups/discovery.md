---
sketch: "STRK-65-attachment-review-followups"
phase: discovery
created: 2026-05-09
---

# STRK-65 - Discovery

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| `js/events.js:386` | Attachment queue | `_pendingAttachments` stores raw `File` objects. `dequeueAttachment(fileName)` removes by first filename match, which causes STRK-59. |
| `js/events.js:2005` | Form-submit attachment commit | Queued files write after item commit. If `attachmentManager` is unavailable, the `else` path clears the queue silently. |
| `js/attachment-ui.js:70` | Open/download helpers | `_openAttachment` revokes object URLs after 10 seconds. `_downloadAttachment` uses the same timer and is less risky because download should snapshot. |
| `js/attachment-ui.js:107` | Queued row rendering | Row dataset and remove handler both use `file.name`; this mirrors the `events.js` collision. |
| `js/attachment-ui.js:192` | DOM lookup | `renderQueuedAttachments` and nearby functions use `document.getElementById`; project standard prefers `safeGetElement` unless the code needs true null. |
| `index.html:2738` | Attachment browse control | Uses a styled `<label>` for hidden file input; Plane issue notes it is not keyboard-focusable. |
| `js/attachment-manager.js:174` | Cascade delete | `deleteAttachmentsForItem` loads full records with blobs through `getAttachmentsByItemUuid` before deleting them. |
| `js/inventory.js:866` | Delete cascade | Plain item delete calls `deleteAttachmentsForItem`, but sync/restore metadata removal does not have a reconciliation pass. |
| `js/inventory.js:996` | Stack split | Current implementation explicitly sets the split-off item's `attachments = []`, matching STRK-45 D13 but conflicting with STRK-64's new product expectation. |
| `js/diff-engine.js:180` | Attachment diff comparator | Replacement detection indexes local attachments by `fileName`; any different UUID with the same name can be consumed as a replacement. |
| `js/inventory-backup.js:642` | Attachment restore | Manifest parsing and missing-binary behavior live here; malformed attachment manifests can abort restore unless fail-soft parsing is added. |
| `js/vault.js:961` | Attachment vault export | `collectAndHashAttachmentVault` converts every attachment blob to Base64 and then hashes a JSON representation, materializing large strings in memory. |
| `js/vault.js:1182` | Manual encrypted export | Exports a single `-attachments.stvault` companion without a size guard before Base64 serialization. |
| `js/cloud-sync.js:1811` | Attachment push | Push path calls `collectAndHashAttachmentVault` and `vaultEncryptAttachmentVault`; size warning/opt-out must happen before this conversion to avoid OOM. |
| `js/cloud-sync.js:2485` | Auto-sync pull | One attachment pull path updates `pullMeta.attachmentHash` correctly after restore or 404. |
| `js/cloud-sync.js:3113` | Manifest-first pull | Copy-pasted attachment pull block restores attachments but does not write the attachment hash into last-pull metadata. |
| `js/cloud-sync.js:3341` | Silent-pull path | Similar attachment pull logic writes `_silentPullMeta.attachmentHash`. Candidate to replace with helper. |
| `js/cloud-sync.js:3575` | Auto-merge path | Attachment pull block has its own `syncSetLastPull` update. Candidate to replace with helper. |
| `js/cloud-sync.js:3948` | Vault-first silent pull | Attachment pull block writes `_previewPullMeta.attachmentHash`. Candidate to replace with helper. |
| `js/cloud-sync.js:4064` | Vault-first DiffModal path | Attachment pull block mutates last-pull metadata after restore. Candidate to replace with helper. |
| `js/settings-listeners.js:1213` | Sync attachments toggle | Writes `String(this.checked)` via `saveDataSync`; read side tolerates strings and booleans, but the original approach called it a boolean key. |
| `js/settings.js:1690` | Settings footer | Footer reports `LS: ... / 5 MB` and only image-cache IDB usage, not attachment manager usage. |
| `js/settings.js:3491` | Storage diagnostics panel | Detail panel counts localStorage UTF-16 bytes, image-cache estimates, and attachment exact bytes, but denominator labels can imply mixed caps. |
| `js/inventory-table.js:571` | Table attachment badge | Hardcodes badge HTML and inline `onclick` instead of using the attachment badge helper. |
| `tests/playwright/attachments/backup-zip.spec.js:15` | Backup tests | Tests build derived objects instead of generating a real ZIP and validating actual backup/restore behavior. |
| `tests/playwright/attachments/cloud-sync.spec.js:21` | Cloud tests | Current tests cover constants/defaults and a few DiffEngine assumptions, not all attachment vault pull paths. |

## Prior Decisions

- 2026-05-09 - STRK-45 accepted the metadata-first add-mode tradeoff because `commitItemToInventory()` generates the item UUID before blobs can be written. The current follow-up should preserve that ordering but avoid persisting local-only `missingBinary` flags into portable item metadata.
- 2026-05-09 - STRK-45 chose a separate `StakTrakrAttachments` IndexedDB database and single `-attachments.stvault` companion, mirroring image vault architecture. STRK-62 is a follow-up hardening item, not evidence that the original sketch promised chunked vault files.
- 2026-05-09 - STRK-45 explicitly chose "split-off item starts empty" for attachments. STRK-64 changes that product decision, so this sketch should call it out as a deliberate v1.1 behavior change rather than pretending it was missed.
- 2026-05-09 - STRK-45 cloud sync parity was considered high-risk; `cloud-sync.js` patches require peer review before merge.

## Original Sketch Evidence

- `requirements.md:37` required multiple queued files and per-file remove controls.
- `requirements.md:85` required attachment binaries in cloud sync by default with a settings opt-out and a 100 MB warning.
- `approach.md:91` defined `SYNC_ATTACHMENT_SIZE_WARN_BYTES`, `syncAttachments`, and `syncAttachmentsWarnSeen`.
- `approach.md:96` required attachment diff replacement detection.
- `approach.md:101` required full cloud-sync branch parity and size warning behavior.
- `approach.md:201` accepted two IndexedDB databases and called out doubled quota-reporting surface.
- `approach.md:207` explicitly kept split attachments on the original and left the split-off item empty.
- `approach.md:222` required quota handling to avoid estimate-only blocking on `file://`.
- `tasks.md:C.4` required all attachment cloud-sync pull branches to be covered.
- `tasks.md:F.2` expected ZIP export/restore tests, but the current test file uses handcrafted fixtures in several cases.

## Codebase Impact Report

**Project:** StakTrakr

**Query:** Attachment PR-review follow-ups across queue, UI, sync, vault, diff, restore, and storage diagnostics.

**CGC Status:** Available but low-signal for this surface. Literal function queries returned no graph matches, so planning relies on source reads plus Claude-context semantic search and exact `rg` results.

### Files Affected

- `js/events.js:386-409` - queue entry identity and dequeue API.
- `js/events.js:2005-2044` - unavailable-IDB handling for pending attachments.
- `js/attachment-ui.js:70-89` - object URL lifecycle.
- `js/attachment-ui.js:107-130` - queued-row identity and remove handler.
- `js/attachment-ui.js:192-211` - DOM id lookup style.
- `index.html:2738-2747` - keyboard-accessible browse control.
- `js/attachment-manager.js:174-192` - efficient delete by `itemUuid`.
- `js/inventory.js:866-871` - delete cascade precedent.
- `js/inventory.js:996-1148` - split behavior and image-copy precedent.
- `js/diff-engine.js:180-215` - duplicate-filename replacement detection.
- `js/inventory-backup.js:642-664` - attachment restore and missing-binary warning.
- `js/vault.js:961-1028` - Base64 attachment vault collection and hash.
- `js/cloud-sync.js:1811-1830` - attachment push and pre-serialization size guard site.
- `js/cloud-sync.js:2485-2545`, `js/cloud-sync.js:3113-3148`, `js/cloud-sync.js:3341-3382`, `js/cloud-sync.js:3575-3630`, `js/cloud-sync.js:3948-3990`, `js/cloud-sync.js:4064-4103` - repeated attachment pull blocks.
- `js/settings.js:1690-1720`, `js/settings.js:3491-3722` - storage footer and diagnostics panel.
- `js/settings-listeners.js:1213-1221` - `syncAttachments` persistence type.
- `js/inventory-table.js:571-574` - duplicated attachment chip markup.
- `css/styles.css` - attachment icon color tokens.
- `tests/playwright/attachments/*.spec.js` - follow-up coverage.

### Existing Patterns to Follow

- `js/image-cache.js` and `AttachmentManager._ensureDb()` style: every public IDB method ensures an open connection before a transaction.
- `js/inventory.js:1132-1142`: split-item custom images are copied non-blockingly after inventory persistence; attachment duplication can follow the same post-persist/non-blocking pattern with clearer failure messaging.
- `js/settings.js:3566-3608`: summary card helper exists; reuse or refine rather than adding another storage summary path.
- `js/cloud-sync.js:2485-2545`: auto-sync pull already returns a `pulledAttachmentHash` and records it in `pullMeta`; this is the cleanest helper contract seed.
- `js/utils.js:1103-1178`: `saveDataSync` / `loadDataSync` preserve boolean values correctly when passed booleans; avoid converting to strings unless an existing scalar key requires it.

### Globals / Storage Keys Involved

- `SYNC_ATTACHMENTS_PATH` - remote Dropbox path for attachment companion vault.
- `SYNC_ATTACHMENT_SIZE_WARN_BYTES` - 100 MB threshold from STRK-45.
- `syncAttachments` - attachment cloud-sync opt-out key, default true when missing.
- `syncAttachmentsWarnSeen` - one-time warning latch.
- `attachmentManager` - IndexedDB attachment singleton.
- `AttachmentManager.getStorageUsage()` - returns exact attachment bytes from stored record sizes.
- `DiffEngine.compareItems()` / `applySelectedChanges()` - item diff and merge path for attachment metadata.

### Gaps / Unknowns

- The 100 MB attachment threshold is a warning/preflight point, not an intrinsic STVAULT cap. Manual encrypted export should allow explicit continue; cloud sync should pause attachment-binary upload until confirmation or opt-out.
- Product priority from 2026-05-09 discussion: ZIP and encrypted backup/restore must remain reliable for users with many attachments. Cloud sync is still beta, so STRK-65 should harden it without expanding into chunked/per-file vault architecture unless real usage proves the need.
- STRK-65 is the parent issue for STRK-59 through STRK-64. Child issues still need verification comments and Done-state updates after the parent patch lands.
- CGC did not provide graph-level call relationships for these vanilla-script globals, so source reads are the authoritative impact map.

### Overengineering Risks

- Replacing the single STVAULT companion format with chunked/per-file encrypted blobs would expand this beyond sketch scope and require compatibility decisions.
- Adding a generic storage framework would be heavier than fixing the current diagnostics labels and math.
- Introducing shared attachment reference counting for split items would be more complex than duplicating binaries with new UUIDs for the split-off item.

## External References

- None required for implementation beyond existing browser APIs already used by the app: IndexedDB, Blob/Object URL, StorageManager estimate/persist, and Web Crypto.

## Constraints

- Works on `file://` and HTTP; quota estimates can be zero or misleading on `file://`.
- No build step; script load order in `index.html` and `sw.js` `CORE_ASSETS` still matters.
- New DOM lookups should use `safeGetElement` unless true null/existence is required.
- User content rendered through HTML must be sanitized.
- Attachment blobs must remain in IndexedDB; localStorage only carries lightweight metadata and sync settings.
- `cloud-sync.js` changes need peer review before PR closeout.
- StakTrakr runtime code PRs must use version-locked patch workflow when applied.

## Open Questions

- [x] 100 MB behavior settled 2026-05-09: warning/preflight threshold, not hard cap.
- [x] Product priority settled 2026-05-09: prioritize ZIP and encrypted export/import reliability; cloud attachment sync remains beta hardening.
- [x] Issue structure settled 2026-05-09: STRK-65 is the parent patch issue; STRK-59 through STRK-64 are children.

## Discovery Summary

Most review items are narrow defects in the shipped attachment feature, but STRK-62 and STRK-65 are broader hardening/design questions. The safest one-patch shape is a v1.1 hardening pass: fix identity bugs, local-only state, sync helper drift, diagnostics math, and realistic tests, while guarding the existing single attachment-vault format instead of replacing it with a new encrypted file architecture.

---

> **Phase complete?** Existing code mapped. Two policy/UX questions remain for the human before apply.
