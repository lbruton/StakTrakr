---
sketch: "STRK-65-attachment-review-followups"
phase: approach
created: 2026-05-09
---

# STRK-65 - Approach

## High-Level Architecture

This is a hardening patch on top of STRK-45, not a second attachment feature. The implementation should keep the existing `AttachmentManager`, item `attachments[]` metadata, ZIP manifest, STVAULT companion, and cloud-sync path, then tighten the places where review found ambiguous identity, local-only state leaking into portable data, duplicate code drift, and storage UI confusion.

The patch splits into four work streams. First, fix attachment UI reliability: queue entries get stable ids, browse is keyboard-accessible, object URLs are managed by context, and table badges reuse a shared helper. Second, fix data integrity: `missingBinary` becomes derived local state, sync/restore cleanup reconciles orphan IDB blobs, split behavior duplicates attachment blobs for the split-off item, and delete-by-item uses an IDB key cursor. Third, fix sync/vault/storage: cloud attachment pulls go through one helper that returns hash metadata, large single-payload attachment vault creation is guarded before Base64 serialization, and Settings -> Storage labels the actual quota basis. Fourth, replace review-finding coverage gaps with real-flow Playwright tests.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Queue entries get stable local ids | Filename is not unique and cannot identify a queued row | Requires wrapping raw `File` objects or parallel metadata in `_pendingAttachments` |
| D-2 | Use context-specific object URL cleanup | Open-in-new-tab cannot safely use a fixed 10 second revoke timer | A pagehide/unload cleanup may retain blob URLs longer during the session |
| D-3 | Derive `missingBinary` locally | STRK-45 canonical item metadata did not include local failure flags; syncing them pollutes other devices | Rendering may need async IDB checks to display missing state |
| D-4 | Split-off items duplicate attachment blobs with new UUIDs | STRK-64 changes product behavior: receipts/invoices should remain visible on both split records | Uses more IDB space than shared references, but keeps delete cascade simple |
| D-5 | Extract `_pullAttachmentVault` helper in `cloud-sync.js` | Repeated blocks already drifted; helper can consistently record `attachmentHash` | Must thread path labels/logging context through helper |
| D-6 | Treat 100 MB as a warning/preflight threshold, not a hard cap | Prevents surprise OOM risk from Base64 JSON materialization while preserving an explicit manual-export path | Background cloud sync must defer attachment binaries because it cannot prompt |
| D-7 | Clarify storage denominators instead of inventing a new storage engine | STRK-65 is a diagnostics/reporting problem unless investigation finds data in the wrong backend | Some browser quota numbers remain estimates and must be labeled as such |
| D-8 | Promote review-found examples into real-flow tests | Existing tests prove constants and handcrafted shapes more than behavior | More Playwright setup, but lower regression risk |

## File Map

### New

- `tests/playwright/attachments/followup-hardening.spec.js` - queue identity, split duplication, diff duplicate names, malformed manifest, IDB-unavailable queue behavior.
- `tests/playwright/attachments/storage-diagnostics.spec.js` - Settings storage cards/footer/detail table denominator and attachment row checks.

### Modified

- `js/events.js` - stable queued attachment entries, dequeue by id/object reference, IDB-unavailable error path.
- `js/attachment-ui.js` - queued row ids, open/download object URL cleanup, safe element lookup, shared badge rendering contract if needed.
- `index.html` - keyboard-focusable Browse button for attachment file picker.
- `js/attachment-manager.js` - key-cursor delete path and optional reconciliation helper for orphan binaries.
- `js/inventory.js` - split attachment duplication and delete/reconcile call sites.
- `js/inventory-backup.js` - malformed attachment manifest fail-soft restore and local derived missing-binary handling.
- `js/inventory-import.js` - ensure CSV metadata-only import does not persist `missingBinary`; derive warning locally.
- `js/diff-engine.js` - duplicate filename-safe replacement detection.
- `js/diff-modal.js` - consume updated attachment diff actions if needed.
- `js/cloud-sync.js` - shared attachment pull helper, last-pull hash consistency, size warning/opt-out guard before serialization, orphan reconciliation after accepted metadata removals.
- `js/vault.js` - preflight attachment vault size guard before Base64 serialization for manual encrypted export and cloud export helpers.
- `js/settings.js` - storage footer/details math and labels for localStorage, IndexedDB, attachments, and combined/origin quota.
- `js/settings-listeners.js` - persist `syncAttachments` as a boolean through wrappers.
- `js/inventory-table.js` - replace hardcoded attachment chip markup with shared helper or a shared rendering function.
- `css/styles.css` - attachment icon colors through theme tokens/custom properties.
- `tests/playwright/attachments/backup-zip.spec.js` - replace handcrafted-object assertions with real ZIP generation/inspection/restore coverage.
- `tests/playwright/attachments/cloud-sync.spec.js` - add helper/hash coverage for attachment vault pull paths and warning/opt-out behavior.
- `tests/playwright/attachments/diff-modal.spec.js` - add duplicate filename replacement/addition coverage if not covered in the new follow-up spec.
- `tests/playwright/attachments/manager.spec.js` - add efficient delete/reconciliation/split duplication assertions.
- `tests/playwright/attachments/ui.spec.js` - add keyboard browse and duplicate queued filename coverage if not covered in the new follow-up spec.
- `CHANGELOG.md`, `js/about.js`, `js/constants.js`, `package.json`, `version.json`, `sw.js` - release patch artifacts handled during `/release patch`.
- `DocVault/Projects/StakTrakr/sketches/STRK-65-attachment-review-followups/tasks.md` - task verification stamp during closeout.

### Deleted

- None.

## Data / Schema Changes

- Existing item `attachments[]` schema remains canonical: `attachmentUuid`, `fileName`, `type`, `size`, `uploadedAt`.
- Persisted `missingBinary` flags should be removed or ignored on save/export/sync. Missing-binary display becomes derived from missing IDB blob state or import context.
- Split-off duplicated attachments get new `attachmentUuid` values and new IDB records with `itemUuid` set to the split-off item's UUID.
- No attachment database version bump is expected unless a cleanup index is missing. `itemUuid` index already exists in `StakTrakrAttachments` v1.
- No new cloud-sync storage keys. Existing `syncAttachments` and `syncAttachmentsWarnSeen` are reused.

## Tradeoffs Surfaced for Review

- **Large attachment vault behavior:** This sketch intentionally avoids designing chunked/per-file encrypted attachment vaults. It uses 100 MB as a warning/preflight threshold: manual encrypted export can continue after explicit confirmation, while cloud sync pauses attachment-binary upload until the user confirms or opts out. Background auto-sync has no prompt surface, so it should skip attachment-binary upload, log/record the pending warning, and wait for foreground confirmation without latching `syncAttachmentsWarnSeen`. ZIP and manual encrypted backup/restore reliability are the priority; cloud attachment sync is beta hardening. If users routinely exceed this and need hands-off sync at larger sizes, promote STRK-62 into a larger chunked/per-file vault spec.
- **Split attachment duplication:** Duplicating binaries is simpler and safer than reference counting. A 20 MB invoice attached to a split item will consume another 20 MB after split.
- **Derived missing-binary state:** Rendering may need async checks, but it keeps sync payloads clean and prevents one device's missing local blob from becoming another device's false warning.
- **Storage diagnostics scope:** This patch clarifies math and labels; it does not change where inventory, images, or attachments are stored unless a bug is found during implementation.

## Out of Scope (follow-up issues)

- Chunked or per-file encrypted attachment vault format for very large attachment sets.
- Attachment deduplication/reference counting across split or cloned items.
- Full Settings redesign outside the Storage tab.
- Attachment thumbnails, OCR, inline preview, sharing, or external document links.

## Risk Notes

- **Cloud sync helper extraction:** Mistakes here can create duplicate downloads or missed attachment pulls. Keep helper small and add focused tests around returned hash metadata.
- **Split duplication:** Failure after inventory save but before blob duplication could leave the split-off item with missing binaries. Use a recoverable missing-state warning and test this path if feasible.
- **Storage math:** Browser quota APIs vary by browser and origin. Labels must communicate estimate/exact status instead of promising precision.
- **Manifest fail-soft:** Continuing after malformed attachment manifest must not hide data loss. Surface a warning and keep the rest of restore safe.
- **Large vault guard:** Avoid reading blobs to Base64 before warning the user or deciding whether cloud sync should pause attachment-binary upload. Do not rely on catching a real browser OOM after `JSON.stringify` or Base64 allocation.

---

> **Phase complete?** Architecture clear. Resolve open questions in requirements/discovery before approving tasks.
