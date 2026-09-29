---
sketch: "STRK-45-per-item-attachments"
phase: requirements
created: 2026-05-08
---

# STRK-45 — Requirements

> **Source Issue:** [STRK-45](https://plane.lbruton.cc/lbruton/browse/STRK-45/)
>
> **Title:** Per-item PDF / image attachment (receipts, COAs, dealer invoices)
>
> **Problem:** Users want to attach purchase receipts (PDF), Certificates of Authenticity (PDF/image), or dealer invoices to individual inventory items for record-keeping. Today the Notes field can hold a URL but no file is attached locally.
>
> **Proposed:** Add an Attachments section to the Edit Item modal — accepts PDF, PNG, JPG. Multiple files per item.
>
> **Storage:** localStorage caps at ~5 MB per origin → too small. Use IndexedDB (already used for image cache via `js/image-cache.js`). Store attachments by item ID, reference from item record. Attachments must be included in encrypted backup ZIPs and CSV exports.
>
> **UX:** Drag-drop zone in Edit modal. List of attached files with size, type icon, download/remove buttons. Detail modal shows attachment count badge; clicking opens a list.
>
> **Source:** Reddit ISO-Lost-Marbles, Q3 — `DocVault/Inbox/Reddit User Feedback - StakTrakr.md`.

## Overview

Add a per-item attachment capability — multiple PDF/PNG/JPG files attached to a single inventory item, persisted in IndexedDB, fully integrated into the existing zip backup, encrypted stvault, CSV export, and cloud sync pipelines. Reuses the manifest-based re-association pattern already proven by the custom image system, so disaster recovery rebuilds the entire audit trail (inventory rows + binary evidence) without manual re-pairing.

## User Stories

- **US-1 (capture):** As an inventory holder, I want to attach receipts, COAs, and dealer invoices directly to individual items, so I have an authoritative record co-located with the item rather than scattered across email folders.
- **US-2 (preserve):** As a user backing up my data, I want my attachments to travel with both encrypted vault and zip exports, so a disaster-recovery restore rebuilds the full audit trail rather than orphaned inventory rows.
- **US-3 (restore):** As a user restoring a backup, I want attachments to re-associate with their original items via stable identifiers, so I never have to manually re-pair PDFs to coins.
- **US-4 (browse):** As a user reviewing an item, I want to see at a glance whether it has attachments and click through to download or remove them.
- **US-5 (sync):** As a user with cloud sync enabled, I want control over whether attachment binaries traverse the sync channel, so I can opt out if my upload bandwidth or remote-storage budget is constrained.

## Acceptance Criteria

### AC-1 (maps to US-1) — Attach via Edit modal

- **Given** the Edit Item modal is open
- **When** the user drags PDF/PNG/JPG files onto the Attachments drop zone OR clicks "Browse" and selects files
- **Then** each file appears in an Attachments list showing filename, size, type icon, and a remove button; multiple files may be queued before saving

### AC-2 (maps to US-1) — Persist to IndexedDB

- **Given** files have been added in the Edit modal
- **When** the user saves the item
- **Then** each attachment is written to a new IndexedDB store (`userAttachments`) keyed by an attachment-scoped uuid; the inventory item record gains an `attachments` array of `{uuid, fileName, type, size, uploadedAt}` entries with `itemUuid` linking back; reloading the page shows the attachments still attached

### AC-3 (maps to US-2) — Zip backup includes attachments

- **Given** inventory contains items with attachments
- **When** the user runs the zip backup flow (`inventory-backup.js`)
- **Then** the zip contains a `user_attachments/` folder with one file per attachment named `{attachment-uuid}.{ext}`, a `user_attachment_manifest.json` mapping `attachmentUuid → {itemUuid, fileName, type, size, uploadedAt, file}`, and `inventory_data.json` item records carry the `attachments` array

### AC-4 (maps to US-2) — Stvault backup includes attachments

- **Given** inventory contains items with attachments
- **When** the user creates an encrypted stvault export
- **Then** a companion `staktrakr_backup_{ts}-attachments.stvault` file is produced alongside the existing `-images.stvault` companion, encrypted with the same PBKDF2-AES-256-GCM scheme and the same passphrase-derived key as the main vault and image companion (full STVAULT envelope, not lighter STMF, because attachments are binary Blobs and need full encryption parity with the image companion)

### AC-5 (maps to US-2) — CSV export references attachments

- **Given** inventory contains items with attachments
- **When** the user runs the CSV export
- **Then** the CSV includes an `attachments` column listing comma-separated `{fileName}#{uuid}` entries per item; the CSV export documents (in a comment row or header tooltip) that binary data lives in the paired zip and CSV-only restore is metadata-only

### AC-6 (maps to US-3) — Zip restore re-associates via manifest

- **Given** a zip backup containing attachments is being restored
- **When** the restore flow parses the zip and computes the diff
- **Then** the DiffModal lists attachment additions/changes grouped by parent item; accepting a change writes the attachment binary to `userAttachments` IndexedDB store and updates the item record's `attachments` array using the manifest's `itemUuid`

### AC-7 (maps to US-3) — Stvault restore re-associates via companion vault

- **Given** an encrypted stvault with `-attachments.stvault` companion is being restored
- **When** the user unlocks the vault
- **Then** attachments restore from the companion file using the same STVAULT decrypt flow as image vault restore (`vault.js` companion-decrypt path), preserving uuid → item association

### AC-8 (maps to US-4) — Visibility on item views

- **Given** an item has ≥1 attachment
- **When** the item appears in the card view, table view, or detail modal
- **Then** a paperclip icon with attachment count is visible; clicking the badge opens a list view with per-attachment download and remove actions

### AC-9 (maps to US-5) — Cloud sync opt-out toggle

- **Given** cloud sync is enabled and items have attachments
- **When** the sync runs
- **Then** attachment binaries are included in the synced payload by default; a "Sync attachments" toggle in settings allows the user to opt out (item metadata still syncs, only binaries are skipped); when total attachment size exceeds a configurable threshold (default 100 MB) a one-time warning prompts the user to confirm or opt out

## Non-Goals

- **Not implementing OCR or PDF content extraction.** Attachments are opaque files.
- **Not implementing inline PDF preview.** Download/open-in-tab is sufficient.
- **Not implementing third-party cloud links.** Only locally-stored attachments — no Dropbox/Drive URL fields.
- **Not implementing per-attachment permissions or sharing.** Attachments live and die with their parent item.
- **Not implementing image thumbnail generation for image attachments.** Use a generic file-type icon. Thumbnail generation is a possible follow-up.
- **Not changing the existing obverse/reverse custom image system.** Attachments are additive; the existing `userImages` IndexedDB store and item image fields are untouched.
- **Not implementing version history of replaced attachments.** Replacing an attachment = remove + re-add (a new uuid, no kept history).
- **Not implementing per-file size caps beyond browser quota.** The IndexedDB origin quota (≥4 GB observed in Firefox) is the only ceiling. A non-blocking warning at e.g. 50 MB per file is acceptable but not a hard limit.

## Open Questions

_Empty — sized to be resolved by the user before discovery starts. Anything still uncertain after discovery.md is written must be surfaced before approach.md._

- [ ] _none — all known design questions are deferred to discovery.md or are explicit non-goals._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-45`.
