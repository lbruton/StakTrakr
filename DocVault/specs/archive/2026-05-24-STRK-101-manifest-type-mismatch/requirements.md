---
sketch: "STRK-101-manifest-type-mismatch"
phase: requirements
created: 2026-05-23
---

# STRK-101 — Requirements

> **Source Issue:** [STRK-101](https://plane.lbruton.cc/lbruton/browse/STRK-101/)
> **Title:** Manifest-first sync silently drops all item field edits (type mismatch)
>
> Cloud sync's manifest-first pull path silently drops all item-level field edits due to a type-name mismatch between the changeLog and the manifest diff builder. The changeLog uses `"item-edit"`, `"item-add"`, `"item-delete"` types, but `_buildDiffFromManifest()` checks for `"edit"`, `"add"`, `"delete"`. Since none match, all item changes are silently skipped. Also broken: `buildAndUploadManifest()` summary counts (same mismatch). Secondary issue: ZIP export `inventory-backup.js` uses an explicit field allowlist that omits 13+ newer fields.

## Overview

Fix a type-name mismatch that causes the manifest-first cloud sync pull path to silently drop all item-level field edits (name, weight, price, image frame shapes, etc.). The changeLog writes `"item-edit"` but the manifest diff builder checks for `"edit"`, so edits are invisible and the pull takes the silent path. Additionally, bring the ZIP export field allowlist up to date with the current item schema so backup/restore preserves all fields.

## User Stories

- **US-1:** As a multi-device user, **I want** field-level edits (name, weight, shapes, grades, etc.) made on one device to sync correctly to my other devices via cloud sync, **so that** my inventory stays consistent across all my browsers without manual re-entry.
- **US-2:** As a user exporting a ZIP backup, **I want** all item fields (including image frame shapes, currency, capsule data, numistaData, etc.) preserved in the export, **so that** restoring from a ZIP backup does not silently lose data.
- **US-3:** As a multi-device user, **I want** the sync manifest summary to accurately report how many items were added, edited, or deleted, **so that** I can trust the sync activity log and debug sync issues.

## Acceptance Criteria

### AC-1 — All manifest consumers recognize item change types (maps to US-1)
- **Given** Device A edits a field on an existing item (e.g., sets `obverseImageFrame` to `"rectangle"`) and pushes a sync
- **When** Device B pulls via the manifest-first path
- **Then** every manifest consumer that filters or classifies by change type — including `_buildDiffFromManifest()` (diff classification) and manifest conflict detection (`mc.type === "edit"` guard) — correctly recognizes `"item-edit"`, `"item-add"`, and `"item-delete"` types, and the DiffModal shows the field change (not a silent pull)

### AC-2 — Manifest-first diff recognizes item adds (maps to US-1)
- **Given** Device A adds a new item and pushes a sync
- **When** Device B pulls via the manifest-first path
- **Then** `_buildDiffFromManifest()` classifies the item as "added" (not relying solely on the count-guard vault-first fallback)

### AC-3 — Manifest-first diff recognizes item deletes (maps to US-1)
- **Given** Device A deletes an item and pushes a sync
- **When** Device B pulls via the manifest-first path
- **Then** `_buildDiffFromManifest()` classifies the item as "deleted"

### AC-4 — Manifest summary counts are accurate (maps to US-3)
- **Given** a sync push includes 1 added, 2 edited, and 1 deleted item
- **When** `buildAndUploadManifest()` generates the manifest payload
- **Then** `manifest.summary` reports `itemsAdded: 1`, `itemsEdited: 2`, `itemsDeleted: 1` (not all zeros)
- **Note:** `buildAndUploadManifest()` summary counting is in scope despite being a producer-side function. The Non-Goal about "consumer side" protects changeLog type names from changing — it does not exempt summary logic from recognizing the prefixed types.

### AC-5 — ZIP export preserves all sync-relevant item fields (maps to US-2)
- **Given** an item has fields tracked by `DIFF_FIELDS` in `js/diff-engine.js` (the canonical field list for sync-relevant item data — includes image frames, numistaData, fieldMeta, capsule, capsuleNotes, currency, attachments, etc.)
- **When** the user exports a ZIP backup via `createBackupZip()`
- **Then** `inventory_data.json` in the ZIP contains every `DIFF_FIELDS` entry with its value intact
- **Canonical source:** `DIFF_FIELDS` array in `js/diff-engine.js`. The ZIP JSON allowlist in `js/inventory-backup.js` must be brought into alignment with `DIFF_FIELDS` — any field diffed during sync must survive a backup/restore round-trip.

### AC-6 — CSV exports include image frame columns (maps to US-2)
- **Given** an item has `obverseImageFrame: "rectangle"` and `reverseImageFrame: "circle"`
- **When** the user exports via either ZIP backup CSV or standalone CSV export (`exportCsv()` / `buildCsvContent()`)
- **Then** both CSVs have columns for `Obverse Frame` and `Reverse Frame` with the correct values

### AC-7 — No regression in vault-first fallback path (maps to US-1)
- **Given** the manifest is unavailable or stale (count mismatch)
- **When** Device B pulls and falls through to vault-first
- **Then** the full `DiffEngine.compareItems()` comparison still works correctly (existing behavior preserved)

## Non-Goals

- Not refactoring the dual-path (manifest-first + vault-first) sync architecture — the fallback design is sound, only the type matching is broken
- Not adding new fields to the item schema — only ensuring existing fields survive export/sync
- Not changing the changeLog type names (`"item-edit"`, etc.) — the fix normalizes on the consumer side, not the producer side, to avoid breaking changeLog rendering or undo
- Not adding CSV columns for all missing ZIP JSON fields — both ZIP CSV and standalone CSV get the two most user-visible gaps (image frames); the rest are internal/metadata fields better suited to JSON-only export

## Open Questions (Resolved)

1. **Normalization approach** — Resolved: each manifest consumer normalizes the prefixed type names on the read side. Whether to use a shared helper or per-consumer checks is an implementation decision for approach.md, not a requirements concern. The requirement is that all consumers handle the types correctly (AC-1).
2. **Canonical field list for ZIP JSON** — Resolved: `DIFF_FIELDS` in `js/diff-engine.js` is the canonical source. The ZIP JSON allowlist must match it (AC-5).
3. **CSV frame column scope** — Resolved: both ZIP CSV and standalone CSV export get image frame columns to prevent divergence (AC-6).

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-101`.

## Review Archive — requirements (2026-05-23)

_Reconciled by /sketch reconcile on 2026-05-23. Original reviewer marks preserved below for audit._

### Codex

**Verified** — Checked the changeLog producer types in `js/changeLog.js:152-172`; manifest grouping and summary counting in `js/cloud-sync.js:1043-1082`; manifest diff classification in `js/cloud-sync.js:2925-2959`; manifest pull/silent path behavior in `js/cloud-sync.js:3285-3361`; manifest conflict detection in `js/cloud-sync.js:3596-3611`; vault-first fallback comparison in `js/cloud-sync.js:3710-3741`; ZIP JSON/CSV export allowlists in `js/inventory-backup.js:22-62` and `js/inventory-backup.js:131-224`; current item field write paths in `js/events.js:1584-1628`; and field comparison coverage in `js/diff-engine.js:35-89` / `js/changeLog.js:80-124`.

**Top concerns** — First, AC-1 is too narrow because `_buildDiffFromManifest()` is not the only manifest consumer with the short-type assumption; conflict detection still checks `mc.type === "edit"` and should be in scope. Second, AC-5 says "all item fields" but relies on an example list that does not cover every currently diffed item field, most notably `attachments`, and includes ambiguous `purchasePrice`/`retailPrice` names that do not map cleanly to persisted form fields. Third, Open Questions should not be empty until the requirements decide whether type normalization belongs in one shared helper, in the manifest payload shape, or in each consumer.

**Unverified assumptions** — The intended fix is consumer-side only even though manifest summary generation is a producer-side function. `purchasePrice` and `retailPrice` are intended to be preserved as item fields rather than treated as display aliases for `price` and `marketValue`. ZIP CSV should gain frame columns, but standalone CSV export may remain unchanged. Attachment metadata loss is out of scope even though attachments are part of `DIFF_FIELDS` and current ZIP-related tests describe attachment metadata as item data.

#### Codex — Unverified Assumptions

- The manifest should continue storing `"item-add"`, `"item-edit"`, and `"item-delete"` and every reader should normalize those values locally.
- `buildAndUploadManifest()` summary counting should be changed under this issue despite the Non-Goal wording that says the fix normalizes on the consumer side.
- `inventory_data.json` should be driven by a canonical item-field list rather than a hand-maintained allowlist, but the requirements have not named that canonical source.
- `purchasePrice` and `retailPrice` are load-bearing field names for backup preservation, even though the live item form stores purchase cost as `price` and PCGS retail price through the market value input path.
- CSV frame columns are required only for ZIP backup CSV unless discovery decides standalone CSV export must stay in parity.

### Resolution Summary
- Accepted: 6
- Rejected: 1 (normalization-helper-vs-per-consumer is an implementation decision for approach.md, not requirements)
- Resolved with your input: 3 (AC-1 scope, DIFF_FIELDS canonical, CSV scope both exports)
