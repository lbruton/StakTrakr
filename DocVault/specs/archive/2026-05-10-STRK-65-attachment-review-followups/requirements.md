---
sketch: "STRK-65-attachment-review-followups"
phase: requirements
created: 2026-05-09
---

# STRK-65 - Requirements

> **Source Issue:** [STRK-65](https://plane.lbruton.cc/lbruton/browse/STRK-65/)
>
> **Title:** Storage tab reports inconsistent localStorage and IndexedDB usage
>
> **Related review fallout:** [STRK-59](https://plane.lbruton.cc/lbruton/browse/STRK-59/), [STRK-60](https://plane.lbruton.cc/lbruton/browse/STRK-60/), [STRK-61](https://plane.lbruton.cc/lbruton/browse/STRK-61/), [STRK-62](https://plane.lbruton.cc/lbruton/browse/STRK-62/), [STRK-63](https://plane.lbruton.cc/lbruton/browse/STRK-63/), [STRK-64](https://plane.lbruton.cc/lbruton/browse/STRK-64/)
>
> **Context:** STRK-45 shipped per-item attachments in v3.34.55. PR review and beta testing surfaced several attachment reliability, sync, restore, accessibility, and storage-diagnostics issues. This sketch batches those into one follow-up patch.

## Overview

Harden the STRK-45 attachment feature after review by fixing duplicate-file queue behavior, attachment list/open/accessibility polish, sync-vault hash handling, storage diagnostics, large attachment vault safeguards, diff correctness, local missing-binary semantics, orphan cleanup, and realistic test coverage. The patch should preserve the shipped attachment data model wherever possible while closing bugs that can remove the wrong file, re-download attachment vaults repeatedly, mislead users about storage quota, or silently drop attachment data.

## Original Sketch Deliverable Check

| Issue   | Was this part of STRK-45 deliverables? | Why                                                                                                                                                                  |
| ------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STRK-59 | Yes, implied by AC-1                   | The original requirements allowed multiple queued files and required each queued row to have a remove button. Duplicate filenames make that remove action ambiguous. |
| STRK-60 | Partly                                 | Open/download behavior was in the STRK-45 approach, but object-URL revocation timing was not specified. Treat as follow-up hardening.                                |
| STRK-61 | Yes                                    | Full attachment cloud-sync parity and hash metadata were explicit deliverables. Missing `attachmentHash` writes are a bug against that scope.                        |
| STRK-62 | Mixed                                  | The 100 MB warning was explicit. Chunked/per-file vault serialization was not; the original sketch accepted the single STVAULT companion pattern.                    |
| STRK-63 | Yes, edge case                         | DiffEngine attachment replacement semantics were explicit. Duplicate filename safety was an omitted edge case in that deliverable.                                   |
| STRK-64 | Mixed                                  | Contains duplicates of STRK-59/60 plus bugs against STRK-45 schema/sync/tests, implementation polish, and one product change around split behavior.                  |
| STRK-65 | No, related area                       | STRK-45 only required attachment rows in Storage settings. The broader localStorage vs IndexedDB quota diagnostic confusion is follow-up scope.                      |

## User Stories

- **US-1 (queue reliability):** As a user attaching files, I want each queued file row to be uniquely removable even when filenames repeat, so I do not lose or keep the wrong document before saving.
- **US-2 (attachment access):** As a user opening or downloading large attachments, I want the app to avoid premature blob URL cleanup and silent drops, so my document access feels reliable.
- **US-3 (sync safety):** As a cloud-sync user, I want attachment vault pulls, hashes, opt-out state, and missing-binary status to behave consistently across devices, so attachments do not repeatedly download or pollute other devices with local-only flags.
- **US-4 (restore and diff safety):** As a user restoring or merging backups, I want duplicate attachment filenames, malformed manifests, and removed attachment references handled safely, so the app does not remove or orphan the wrong binary.
- **US-5 (storage clarity):** As a user reviewing Settings -> Storage, I want clear localStorage, IndexedDB, attachment, and browser quota reporting, so I can tell whether the app is near a real limit.
- **US-6 (maintainability):** As a maintainer, I want shared helpers and realistic tests for attachment paths, so future attachment changes do not reintroduce review-found regressions.

## Acceptance Criteria

### AC-1 (maps to US-1, US-2) - Queue and file-picker hardening

- **Given** a user queues two attachments with the same filename
- **When** the user removes either queued row
- **Then** only that exact queued entry is removed; the other same-name entry remains queued
- **And** queued entries are keyed by a stable per-entry id or object reference, not `file.name`
- **And** the Browse control is keyboard-focusable and triggers the hidden file input without relying on a non-focusable label
- **And** if `attachmentManager` is unavailable while files are queued, the user sees an error and the queue is not silently discarded

### AC-2 (maps to US-2, US-6) - Attachment list and UI polish

- **Given** a user opens an attachment in a new tab
- **When** the attachment is a large PDF or image
- **Then** the object URL is not revoked by a fixed short timer that can race the new tab load
- **And** download object URLs keep a bounded cleanup path
- **And** table/card/view attachment badges use the shared `renderAttachmentBadge` helper or a single shared helper contract
- **And** attachment icon colors use theme tokens or CSS custom properties instead of per-theme hardcoded hex blocks
- **And** new `attachment-ui.js` DOM id lookups follow the project `safeGetElement` rule except where a real existence check is required

### AC-3 (maps to US-3, US-4) - Attachment metadata stays portable and local state stays local

- **Given** attachment metadata is saved, exported, synced, or imported
- **When** the item record is serialized
- **Then** its attachment entries contain only the canonical portable fields: `attachmentUuid`, `fileName`, `type`, `size`, and `uploadedAt`
- **And** local missing-binary state is derived at render/import time instead of persisted into sync payloads
- **And** attachment references removed by restore or sync trigger a reconciliation pass that removes orphaned IDB binaries
- **And** `deleteAttachmentsForItem(itemUuid)` deletes by IDB key cursor without loading blob payloads into memory
- **And** stack split behavior is intentionally changed from STRK-45: purchase documents remain available on both split records by duplicating attachment metadata and IDB blobs with new `attachmentUuid`s for the split-off item

### AC-4 (maps to US-3) - Cloud sync attachment pull helper

- **Given** a remote payload contains `attachmentVault.hash`
- **When** any attachment pull path restores, skips, or 404s the attachment companion
- **Then** the local last-pull metadata records the attachment hash consistently so the next sync does not re-download the same vault
- **And** the repeated pull block is extracted into a shared helper that handles hash check, download, decrypt/restore, logging, 404, and returned hash metadata
- **And** all existing attachment pull paths call the helper instead of copy-pasting the full block
- **And** cloud-sync attachment changes receive the required peer review before PR closeout

### AC-5 (maps to US-3, US-5) - Attachment vault memory guard and size warning

- **Given** total stored attachment bytes exceed `SYNC_ATTACHMENT_SIZE_WARN_BYTES`
- **When** cloud sync or encrypted vault export would Base64 serialize attachments into a single STVAULT payload
- **Then** the app treats 100 MB as a warning/preflight threshold, not as a hard STVAULT format cap
- **And** the app warns before serialization using stored byte counts plus an estimated Base64/JSON/encryption memory budget, so it does not discover the risk only after allocating large strings
- **And** cloud sync pauses attachment-binary upload until the user confirms "sync attachments anyway" or opts out; metadata sync may continue
- **And** background/headless auto-sync cannot show a prompt, so it skips attachment-binary upload, records/logs the pending warning, and waits for the next foreground/manual sync opportunity without setting `syncAttachmentsWarnSeen`
- **And** manual encrypted vault export allows an explicit "continue anyway" path after warning, but only after the preflight warning; implementation must not rely on catching a real out-of-memory failure after Base64/JSON allocation
- **And** ZIP backup/restore and manual encrypted export/import remain first-class supported flows for attachment-heavy users; ZIP may show a similar large-export warning because JSZip is still in-memory, but the guard must not silently downgrade disaster-recovery coverage
- **And** no stored attachment is deleted or migrated merely because the vault companion is skipped

### AC-6 (maps to US-4) - Diff and restore edge cases

- **Given** local and remote attachment lists contain duplicate filenames
- **When** DiffEngine compares attachments
- **Then** a replacement is emitted only when the candidate is unambiguous or a stronger fingerprint matches
- **And** duplicate filename additions are emitted as additions, not replacements that consume an unrelated local attachment
- **And** malformed `user_attachment_manifest.json` produces a warning and continues restoring the rest of the backup when possible

### AC-7 (maps to US-5) - Storage diagnostics clarity

- **Given** Settings -> Storage is rendered after attachments are present
- **When** the app calculates usage
- **Then** localStorage, IndexedDB image/cache data, IndexedDB attachments, and combined origin estimates are labeled with their actual counting basis
- **And** localStorage bars do not imply the entire browser origin is capped at 5 MB
- **And** IndexedDB totals include image cache plus attachment manager data with clear exact vs estimated rows
- **And** footer, summary cards, and detail tables agree on units and denominators
- **And** compressed localStorage values are either labeled as stored-string bytes or decompressed before record-count parsing, but not mixed silently

### AC-8 (maps to US-6) - Tests cover real flows

- **Given** the follow-up patch is complete
- **When** Playwright tests run
- **Then** coverage includes duplicate queued filenames, IDB-unavailable queue failure, object URL lifecycle behavior where practical, split attachment duplication, orphan cleanup, DiffEngine duplicate filename behavior, malformed manifest fail-soft restore, cloud-sync helper/hash paths, size-warning/opt-out behavior, and storage diagnostics math
- **And** attachment backup tests exercise real ZIP generation and restore/inspection paths rather than handcrafted objects that duplicate implementation assumptions

## Non-Goals

- Not replacing the STRK-45 attachment data model with a generalized document system.
- Not implementing OCR, inline PDF preview, thumbnails, sharing, or third-party document links.
- Not creating a new multi-file or per-file encrypted attachment vault format in this patch; this sketch uses a conservative memory guard around the existing single STVAULT payload.
- Not migrating existing attachments unless required to duplicate split-off records safely.
- Not redesigning the entire Settings area; only the Storage diagnostics surface is in scope.
- Not merging or closing the source issues automatically; this sketch prepares the follow-up patch plan.

## Open Questions

- [x] 100 MB behavior settled 2026-05-09: it is a warning/preflight threshold, not a hard STVAULT cap. Manual encrypted export offers "continue anyway"; cloud sync pauses attachment-binary upload until the user confirms or opts out.
- [x] Product priority settled 2026-05-09: keep ZIP and encrypted export/import reliable for attachment-heavy users; treat cloud attachment sync as beta hardening with a known future chunked/per-file solution if real-world usage demands it.
- [x] Issue structure settled 2026-05-09: STRK-65 is the parent issue for STRK-59 through STRK-64. Child issues still receive closeout comments and are marked resolved after verification.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions should be resolved before `/sketch apply STRK-65`.
