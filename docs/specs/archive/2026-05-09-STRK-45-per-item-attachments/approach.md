---
sketch: "STRK-45-per-item-attachments"
phase: approach
created: 2026-05-08
revised: 2026-05-08
---

# STRK-45 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

> **Revision note (2026-05-08):** v1 was reviewed by Codex. v2 incorporates all factual codebase corrections, schema canonicalization, and these scope decisions: requirements AC-4 amended to STVAULT companion (was `.stmanifest.attachments`); polished DiffModal rendering pulled in-scope; `/ui-mockup` is an approval gate (no placeholders); split-item rule = original keeps attachments, split-off starts empty. v3 incorporates Codex sketch review findings: D14 changed from pre-commit staging to post-commit write ordering (add-mode UUID unavailability); cloud-sync branch count corrected from 7 to 11 with full enumeration; D8 expanded to require custom array-diff comparator for per-attachment granularity; backup README clause removed (no such file exists); restore failure behavior made explicit (missing-binary warning, no metadata rollback).

## High-Level Architecture

Per-item attachments are a parallel system to the existing user-image system, intentionally re-using its proven patterns at every layer. Four concerns separate cleanly:

1. **Storage layer.** A new IndexedDB database (`StakTrakrAttachments v1`) with a single object store (`userAttachments`, keyed by `attachmentUuid`) holds the binary Blobs. A new `js/attachment-manager.js` exposes a singleton (`window.attachmentManager`) that mirrors `imageCache`'s **public** API surface (`addAttachment`, `getAttachment`, `deleteAttachment`, `deleteAttachmentsForItem`, `exportAllAttachments`, `getAttachmentsByItemUuid`, `getStorageUsage`). Underscore methods stay private. A separate DB — rather than a `v4` upgrade of `StakTrakrImages` — keeps attachment lifecycle decoupled from images and avoids touching the 810-line image class. The first attachment upload reuses the existing **persistent-storage prompt** that the image-upload path uses (`navigator.storage.persist()`), since attachments are larger and more loss-sensitive than photos.

2. **Item record + persistence.** Each item gains an `attachments: [{attachmentUuid, fileName, type, size, uploadedAt}]` array on its `metalInventory` record. Only metadata travels with the inventory record; binaries live in IndexedDB. The write path follows the **user-image precedent** (`saveUserImageForItem` in `events.js`): `commitItemToInventory()` runs first (generating the item UUID for add-mode at line 1620), then attachment binaries are written to IDB using the committed item's `uuid`. On IDB-write failure, the item metadata retains its `attachments` array but each failed entry renders a **missing-binary warning state** in the UI (consistent with CSV-only restore). This ordering avoids the add-mode UUID problem: `commitItemToInventory()` generates `uuid: generateUUID()` internally, so staging blobs before commit would have no `itemUuid` to associate. Cascade delete is mandatory on `deleteInventoryItem`. **`splitInventoryItem`** keeps attachments on the original; the split-off item starts with an empty array (lighter storage, intentional break — different physical lots may have different paperwork; user can re-attach if needed). **`cloneItem`** also resets to `[]`. The delete-confirmation copy includes "X attachments will also be deleted" when relevant. Imported metadata that has no matching binary (CSV-only restore) renders a missing-binary warning state.

3. **Backup / sync integration.** Three pipelines must carry attachments end-to-end — not just upload:

   - **Zip backup.** `user_attachments/{attachmentUuid}.{ext}` folder + `user_attachment_manifest.json` mapping `attachmentUuid → {itemUuid, file, fileName, type, size, uploadedAt}`. The `inventory_data.json` item shape is built by an explicit field-mapper in `createBackupZip()` — attachments must be **added to the mapper** (the v1 sketch's "already carries" claim was incorrect). On restore, attachment blobs are written **only when the matching DiffModal change is accepted** — never blanket-imported, or rejected metadata changes would leave orphan binaries.
   - **Stvault.** Companion file `staktrakr_backup_{ts}-attachments.stvault` (note: hyphen, matching the shipped `-images` convention). Same PBKDF2-AES-256-GCM envelope as the image companion, same passphrase-derived key. New functions: `collectAndHashAttachmentVault`, `vaultEncryptAttachmentVault`, `vaultDecryptAndRestoreAttachments`. New slot: `_vaultPendingAttachmentFile` + `setVaultPendingAttachmentFile`. Wired into all branches that currently handle the image companion (see Cloud sync below).
   - **Cloud sync.** The image companion appears in **11 distinct code sites** across `cloud-sync.js` and `vault.js`. Attachments need parity in **all of them**:

     **`cloud-sync.js` (7 sites):**
     1. Push: upload encrypted companion to `SYNC_ATTACHMENTS_PATH` (cf. line ~1706)
     2. Push: carry-forward remote attachment metadata when local has no attachments (cf. line ~1749)
     3. Push: delete attachment companion from remote when attachments removed (cf. line ~1767)
     4. Push: write `attachmentVault` metadata to push payload (cf. line ~1810)
     5. Pull: vault-first DiffModal/fallback restore (cf. line ~2305)
     6. Pull: manifest-deferred / auto-merge restore (cf. line ~2882)
     7. Pull: silent pull (cf. line ~3060)

     **`vault.js` (4 sites):**
     8. Manual vault export: encrypt + download attachment companion (cf. line ~993)
     9. Cloud export: upload attachment companion to Dropbox (cf. line ~1323)
     10. Manual vault restore: decrypt pending attachment companion file (cf. line ~1435)
     11. Set pending attachment file slot (cf. line ~1723)

     A new `SYNC_ATTACHMENTS_PATH = "/StakTrakr/sync/staktrakr-attachments.stvault"` is the upload target; `attachmentVaultHash` is added to push metadata for change detection; remote attachments are **preserved** when local has none (initial-load case) and **deleted from remote** when the authoritative local item deletes them. A persistent `syncAttachments` localStorage key (added to `SYNC_SCOPE_KEYS`) gates the sync path; **missing key defaults to `true`** (parity with photo-sync default behavior). Per-export "Include attachments" checkbox on the vault modal (and `cloud-export` mode) provides the immediate control. A one-time 100 MB warning persists via `syncAttachmentsWarnSeen`.

4. **UI surfaces.** Polished, end-to-end, not just badges. `js/attachment-ui.js` owns DOM rendering for:

   - **Edit-modal Attachments section** — drop zone + browse button (mobile parity), queued-files list, saved-files list with per-row remove. Position confirmed by `/ui-mockup` (see D11).
   - **View modal / card view / inventory table** — attachment count badge with click-to-list; the list is a **shared list surface** (download/open action, remove where the item is editable, missing-binary warning row, file-type icon, size, uploadedAt, empty state). Consistent across all three entry points.
   - **Settings storage table** — relabel current "IndexedDB (Images)" row to "IndexedDB" with two sub-rows ("Images", "Attachments") so both stores are visible.
   - **Upload progress / error UI** — **mandatory** (not optional): disabled save state while files stage, visible per-row write state, recoverable failure state. Without this, a multi-hundred-megabyte attachment can look like the app froze or like the save succeeded with mismatched metadata/binary.
   - **DiffModal** — polished rendering for attachment field diffs (see D8 below): per-attachment rows with file icon, filename, size, replacement detection (same `fileName` + different `attachmentUuid` renders as "replaced," not as remove+add), missing-binary warning, and conflict highlighting.

   `safeGetElement` is unavailable at top-level in `events.js`; all attachment event wiring registers at runtime.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D1 | New IDB database `StakTrakrAttachments v1` (not a v4 upgrade of `StakTrakrImages`) | Clean separation; zero risk to existing image store; no large-class edit | Two DBs to manage in quota reporting; settings storage table relabeled to "IndexedDB" with Images + Attachments sub-rows |
| D2 | New module `js/attachment-manager.js` (singleton `window.attachmentManager`) mirroring `imageCache`'s **public** API (`addAttachment`/`getAttachment`/`deleteAttachment`/`deleteAttachmentsForItem`/`exportAllAttachments`/`getAttachmentsByItemUuid`/`getStorageUsage`) | Review symmetry; testable in isolation; private helpers stay private | One more file in the script load order |
| D3 | Split UI into `js/attachment-ui.js` (drop zone, list, badges, list panel) | Keeps `inventory.js` and `viewModal.js` lean; isolates DOM concerns from storage; consistent with existing card-view/inventory-table separation | An extra defer script; cross-module wiring needs explicit init order |
| D4 | Item record carries metadata array `attachments: [...]` only — binaries stay in IndexedDB. **Canonical key name: `attachmentUuid` everywhere** (item record entries, IDB record, manifest). Item record entry shape: `{attachmentUuid, fileName, type, size, uploadedAt}`. IDB record additionally carries `itemUuid` + `blob`. Manifest entry additionally carries `itemUuid` + `file` (the path inside `user_attachments/`). | Inventory record stays compact; respects 5 MB localStorage cap; one canonical name avoids subtle field-mismatch bugs across boundaries | CSV-only restore is metadata-only (item shows attachments column entries with no binary; missing-binary warning rendered) |
| D5 | Stvault companion file `staktrakr_backup_{ts}-attachments.stvault` (full STVAULT, hyphen suffix matching shipped `-images` convention) | Binary Blobs need full encryption envelope; matches image-companion pattern; same passphrase-derived key. **Requirements AC-4 amended to match.** | Two stvault companions per backup; slightly heavier import flow |
| D6 | Cascade delete attachments when parent item is deleted; delete-confirmation copy includes "X attachments will also be deleted" when relevant | Items are the anchor; orphan attachments would never re-associate; user mental model from US-3; avoids surprise data loss | Deletion is irreversible (consistent with existing item deletion); no undo |
| D7 | `cloneItem` resets `attachments` to `[]` | Cloned item is a new artefact; original purchase documents don't apply | User must re-attach if they intentionally want shared docs (acceptable per requirements) |
| D8 | **DiffModal renders polished attachment field diffs in this patch** — per-attachment rows (file icon, filename, size), replacement detection (same fileName + different uuid → "replaced"), missing-binary warning, conflict highlighting. Adds `attachments` to `DIFF_FIELDS` in `js/diff-engine.js` **with a custom array-diff comparator** (current `_valuesEqual` compares arrays via stable stringification and `compareItems` emits one coarse field change; `applySelectedChanges` replaces whole fields — none of these support per-attachment granularity). The comparator must: (a) diff by `attachmentUuid`, (b) detect replacement (same `fileName` + different `attachmentUuid`), (c) emit per-entry add/remove/replace change records. `diff-modal.js` consumes these records for per-row rendering; `applySelectedChanges` applies at per-entry granularity. History parity in `js/changeLog.js`; type docs in `js/types.js`. | Discovery's "full polish required" + AC-6's "additions/changes grouped by parent item" require this in the first patch, not a follow-up. Without `DIFF_FIELDS` entry, sync conflict detection silently ignores attachment changes — a data-corruption-class bug. Per-entry diff/apply is required because whole-array accept/reject would force users to accept all attachment changes or none — unacceptable for data that includes binary files. | Larger patch surface; more test coverage required (cloud-sync conflict scenarios); diff-engine contract expansion beyond simple field-level comparison |

| D9 | Cloud sync: default = include attachments, missing `syncAttachments` key defaults to `true`, key added to `SYNC_SCOPE_KEYS`. 100 MB one-time warning + Settings opt-out toggle + per-export checkbox. **Full parity in all 11 image-companion code sites** (7 in `cloud-sync.js` + 4 in `vault.js` — see Architecture §3 for enumeration) | Matches "Include photos" precedent; respects bandwidth-constrained users; partial parity would silently drop data in non-happy paths | Three control surfaces (Settings toggle, vault-modal checkbox, size warning) require careful permutation testing; 11-site parity is the work multiplier |
| D10 | New scripts load via `<script defer src="./js/attachment-manager.js">` then `<script defer src="./js/attachment-ui.js">`, after `image-cache.js` and before `inventory-backup.js` / `inventory.js` | Singleton must be constructed before downstream callers; `./js/...` matches local convention | Two more position-sensitive entries in the script-tag block |
| D11 | Edit-modal Attachments section placed after Notes, before Tags. **`/ui-mockup` is an approval-gated task** (see tasks.md): mockup must be produced and approved by user before any UI implementation task downstream of it begins. Storage layer + backup pipeline tasks are not gated. | Discovery resolved the position; user-approved mockup avoids placeholder/half-polish risk; non-UI work proceeds in parallel | One sequencing edge in tasks.md (UI tasks have an explicit `Depends on: ui-mockup-approved` marker) |
| D12 | `cloneItem` and bulk operations explicitly do NOT carry attachments | Avoid silent multiplication of binary storage; user-initiated re-attach is the only path | Confirmed non-goal in requirements |
| D13 | **`splitInventoryItem` keeps attachments on the original; split-off item starts with empty array.** | Splitting is typically for sale/disposition — physical lots may need different paperwork; lighter storage; user can re-attach to the split-off if intentional | User splitting two halves of the same paperwork must re-attach manually (acceptable; rare) |
| D14 | **Post-commit write ordering** — follows the user-image precedent: `commitItemToInventory()` runs first (generating the item UUID in add-mode), then attachment binaries are written to IDB using the committed item's `uuid`. On IDB-write failure, item metadata keeps its `attachments` array but failed entries render a missing-binary warning state (consistent with CSV-only restore behavior). This ordering is required because `commitItemToInventory()` generates `uuid: generateUUID()` internally (line 1620) — staging blobs before commit would have no `itemUuid`. | Avoids the add-mode UUID unavailability problem (Codex finding); consistent with `saveUserImageForItem` pattern | On IDB failure after metadata commit, the item has attachment metadata pointing to missing binaries — mitigated by the missing-binary warning UI, and the user can retry by re-editing |
| D15 | **Progress / error UI is mandatory, not optional** — disabled save state while files stage, visible per-row write state, recoverable failure state with retry/remove options | No per-file size cap means a 200+ MB attachment is plausible; without progress UI, the app appears frozen and silent failures are misread as success | Requires CSS work (`css/styles.css`) and reusable progress component patterns |

## File Map

### New

- `js/attachment-manager.js` — `AttachmentManager` class + `window.attachmentManager` singleton. Public API mirrors `imageCache` (`addAttachment`, `getAttachment`, `deleteAttachment`, `deleteAttachmentsForItem`, `exportAllAttachments`, `getAttachmentsByItemUuid`, `getStorageUsage`). Private helpers (`_ensureDb`, `_put`, `_get`, `_delete`, `_getAll`, `_iterate`, `_txComplete`) follow the `imageCache` pattern. Persistent-storage prompt reuse on first add.
- `js/attachment-ui.js` — DOM rendering for: Edit-modal Attachments section (drop zone + browse + queued/saved lists with progress + remove); attachment count badge factory; shared attachment list panel (download/open/remove/missing-binary/empty-state) used by view modal, card view, inventory table; DiffModal per-attachment row factory.
- `tests/playwright/attachments/manager.spec.js` — IDB roundtrip, persistent-storage prompt invoked once, cascade delete, split-item leaves original intact, clone resets, export/import shape, atomic-write rollback (simulate IDB-write failure → no orphan metadata; simulate metadata-commit failure → no orphan blobs).
- `tests/playwright/attachments/backup-zip.spec.js` — Zip export contains `user_attachments/` + `user_attachment_manifest.json`, manifest entries include `file` field, restore writes blobs only for accepted DiffModal changes (rejected change leaves no orphan), CSV column shape, missing-binary toast on CSV-only restore.
- `tests/playwright/attachments/vault-stvault.spec.js` — Stvault companion encrypt/decrypt roundtrip, companion file naming uses `-attachments` suffix, manual restore re-associates by `attachmentUuid`, deferred-companion path works.
- `tests/playwright/attachments/cloud-sync.spec.js` — All seven cloud-sync branches: manual restore, silent pull, manifest-deferred pull, auto-merge pull, cloud export, push metadata (`attachmentVaultHash` present), remote preserve when local empty, remote delete when local item deleted. Plus: `syncAttachments` toggle off-state skips upload; missing key defaults to `true`; 100 MB warning fires once.
- `tests/playwright/attachments/diff-modal.spec.js` — DIFF_FIELDS includes `attachments`; replacement renders as "replaced" not remove+add; missing-binary warning row; conflict highlighting on cloud-sync conflicts.
- `tests/playwright/attachments/ui.spec.js` — Drag-drop AND browse path both work; mobile-viewport browse parity; delete confirmation copy includes attachment count; settings storage table shows Attachments sub-row; CSV import warns/parses Attachments column.

### Modified

- `js/constants.js` — Add `VAULT_ATTACHMENT_FILE_SUFFIX = "-attachments"`, `SYNC_ATTACHMENTS_PATH = "/StakTrakr/sync/staktrakr-attachments.stvault"`, `SYNC_ATTACHMENT_SIZE_WARN_BYTES = 100 * 1024 * 1024`. Add `"syncAttachments"` and `"syncAttachmentsWarnSeen"` to `ALLOWED_STORAGE_KEYS`. Add `"syncAttachments"` to `SYNC_SCOPE_KEYS`. Settings-table label entry. Window assignments to mirror existing pattern.
- `js/inventory.js` — `editItem` populates the Attachments section after item load. `cloneItem` sets `attachments = []`. `deleteInventoryItem` cascades via `attachmentManager.deleteAttachmentsForItem(itemUuid)`. `splitInventoryItem` keeps attachments on original, sets new item's `attachments = []`. Delete-confirmation copy updated to include attachment count.
- `js/events.js` — Form-submit path follows the user-image precedent: `commitItemToInventory()` runs first (generating UUID for add-mode), then attachment Blobs are written to IDB via `attachmentManager.addAttachment` using the committed item's `uuid`. On IDB-write failure, item metadata retains its `attachments` array but failed entries render a missing-binary warning state. Drag-drop and attachment-list click handlers register at runtime (per `safeGetElement` constraint). Browse-button file input wiring.
- `js/inventory-backup.js` — Add `attachments` to the explicit field mapper that builds `inventoryData.inventory` items in `createBackupZip()`. Add `user_attachments/` folder writes + `user_attachment_manifest.json` (manifest entries include `file` field naming the stored path). Restore: `applyAncillaryData()` writes blobs **only for `attachmentUuid`s referenced by accepted DiffModal item-change entries** (scoped restore, not blanket import); on IDB-write failure during restore, leave missing-binary warning state on the item (don't roll back accepted metadata changes). CSV export: append `Attachments` column with `fileName#attachmentUuid` entries; add header comment row noting CSV-only restore is metadata-only.
- `js/inventory-import.js` — CSV parser teaches itself to recognize the `Attachments` column (preserves metadata array on parse, surfaces missing-binary warning toast on CSV-only import). DiffModal item-diff entries that include `attachments` field route to the polished renderer in `diff-modal.js`.
- `js/diff-engine.js` — Add `attachments` to `DIFF_FIELDS` so sync conflict detection sees attachment changes. Define array-diff comparison semantics (replacement detection: same `fileName` + different `attachmentUuid` → emit "replaced" entry instead of separate add/remove).
- `js/diff-modal.js` — Polished per-attachment row rendering: file-type icon, filename, size, uploadedAt; "replaced" state; missing-binary warning row; conflict highlighting; clear apply/reject affordances per row.
- `js/changeLog.js` — History parity for attachment changes (add/remove/replace events logged with `attachmentUuid` + `fileName`).
- `js/types.js` — Document the canonical attachment record shapes (item-record entry, IDB record, manifest entry).
- `js/vault.js` — `collectAndHashAttachmentVault`, `vaultEncryptAttachmentVault`, `vaultDecryptAndRestoreAttachments`, `_vaultPendingAttachmentFile` slot + `setVaultPendingAttachmentFile`. Wire "Include attachments" checkbox into vault-export modal alongside "Include photos"; mirror in `cloud-export` mode. Manual restore branch handles the deferred-companion path for attachments.
- `js/cloud-sync.js` — **Full seven-branch parity:** manual vault restore, silent pull, manifest-deferred pull, auto-merge pull, cloud export, push metadata (`attachmentVaultHash`), remote preserve/delete. Gated by `syncAttachments` localStorage key (default `true` when missing). Size estimate via `attachmentManager.getStorageUsage()`; 100 MB warning persists via `syncAttachmentsWarnSeen`.
- `js/viewModal.js` — `buildViewContent`: render attachment count badge + click-to-shared-list-surface when `item.attachments?.length > 0`.
- `js/card-view.js` — Attachment count chip + click-to-shared-list when `item.attachments?.length > 0`.
- `js/inventory-table.js` — Small badge in existing row when `item.attachments?.length > 0` (no new column); badge click opens shared list surface.
- `js/settings.js` — Add "Sync attachments" toggle UI; relabel storage row to "IndexedDB" with Images + Attachments sub-rows. Surface attachment storage usage via `attachmentManager.getStorageUsage()`.
- `js/settings-listeners.js` — Wire the new "Sync attachments" toggle listener; persist to `syncAttachments` key.
- `js/init.js` — Initialize `attachmentManager` quota estimate alongside `imageCache._initQuota()`.
- `js/about.js` — What's New entry (handled by `/release`).
- `index.html` — `<script defer src="./js/attachment-manager.js">` after `image-cache.js`, then `<script defer src="./js/attachment-ui.js">`. Insert Attachments `.form-section` between Notes and Tags in Edit modal. Insert "Sync attachments" toggle in Settings panel. Insert "Include attachments" checkbox in vault-export and cloud-export modals.
- `css/styles.css` — Drop-zone hover/active states, queued-files list rows, saved-files list rows with progress bar, attachment-count badge/chip, shared list panel layout, missing-binary warning state, empty state, DiffModal per-attachment rows, mobile-viewport browse-button parity.
- `sw.js` — Add `js/attachment-manager.js` and `js/attachment-ui.js` to `CORE_ASSETS` array. `CACHE_NAME` bump auto-stamped by `stamp-sw-cache` pre-commit hook.
- `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md` — Version bump (handled by `/release`).
- `requirements.md` (this sketch) — AC-4 amended in v1.1 of this revision (STVAULT companion, hyphen suffix).

### Deleted

_None._

## Data / Schema Changes

### Canonical key name

`attachmentUuid` is the canonical identifier in **every** layer. Item-record entries, IDB records, manifest entries, CSV column references, and DiffEngine all use this name. There is no `uuid` alias.

### IndexedDB

**New database:** `StakTrakrAttachments` v1.

**Object store:** `userAttachments`, `keyPath: "attachmentUuid"`.

**Record shape:**

```
{
  attachmentUuid: string (uuid v4),
  itemUuid:       string (foreign reference to inventory item),
  fileName:       string,
  type:           string (MIME, e.g. "application/pdf", "image/png", "image/jpeg"),
  size:           number (bytes),
  uploadedAt:     string (ISO 8601),
  blob:           Blob
}
```

### localStorage — `metalInventory`

Each item record gains an optional `attachments` field. Missing/empty array = backward-compatible (existing inventories load unchanged):

```
attachments: [
  { attachmentUuid: string, fileName: string, type: string, size: number, uploadedAt: string },
  ...
]
```

The item-record entry intentionally **omits `itemUuid`** — the parent relationship is implicit (the entry lives inside that item's record). Backup/diff/CSV/UI reconstruct the parent by reading from the parent item context, never by inspecting the entry itself. The IDB record and the manifest entry both carry `itemUuid` explicitly, because they live outside the item-record context and need it for re-association.

### `ALLOWED_STORAGE_KEYS` additions

- `syncAttachments` — boolean, **default `true` when missing**, also added to `SYNC_SCOPE_KEYS`.
- `syncAttachmentsWarnSeen` — boolean; latches `true` after the user dismisses the 100 MB warning.

### Zip backup payload

**Folder:** `user_attachments/` containing one Blob per attachment, named `{attachmentUuid}.{ext}` (extension derived from MIME or original fileName extension — the manifest's `file` field is authoritative).

**Manifest:** `user_attachment_manifest.json`

```json
{
  "version": 1,
  "exportDate": "<ISO 8601>",
  "entries": [
    {
      "attachmentUuid": "...",
      "itemUuid":       "...",
      "file":           "user_attachments/{attachmentUuid}.pdf",
      "fileName":       "receipt-2024.pdf",
      "type":           "application/pdf",
      "size":           412333,
      "uploadedAt":     "..."
    }
  ]
}
```

`inventoryData.inventory` item shape — built by the explicit field mapper in `createBackupZip()` — must add `attachments: item.attachments || []` to the mapped fields. Without that, `attachments` silently drops out of the zip backup (this was a v1-sketch error that would have caused data loss).

### Stvault companion

**File:** `staktrakr_backup_{ts}-attachments.stvault` (hyphen, matching shipped `-images` convention). Same PBKDF2-AES-256-GCM envelope as the image companion, same passphrase-derived key.

### CSV export

**New column:** `Attachments` (last column). Format: `fileName#attachmentUuid, fileName#attachmentUuid, ...`. Header comment row precedes the standard CSV header: `# Attachments column references binaries stored in the paired ZIP/stvault — CSV-only restore restores metadata only`.

CSV import (`js/inventory-import.js`) parses the column, populates the item-record `attachments` array, and surfaces a missing-binary warning toast when a CSV-only import is detected (no paired ZIP/stvault).

## Tradeoffs Surfaced for Review

- **Two IDB databases (D1).** Decouples lifecycle but doubles the quota-reporting + disaster-recovery surface. Settings storage table relabeled to make this visible. Future consolidation is a non-breaking refactor if it ever becomes painful.
- **Cloud sync default ON (D9).** Bandwidth-constrained users get a one-time warning at 100 MB but otherwise pay for attachment uploads by default. Alternative ("default OFF, opt-in") would surprise the majority of users who expect parity with photo sync. The warning + Settings toggle + per-export checkbox is the safety stack.
- **Seven-branch cloud-sync parity (D9).** Significant work multiplier vs. "add upload path." Skipping any branch would create silent data drops on non-happy paths (e.g., manifest-deferred pull works, auto-merge silently doesn't). Accepted: the only safe path is full parity.
- **No per-file size cap (per requirements non-goal).** Browser quota is the only ceiling. A 1 GB PDF would technically be allowed. Mitigated by mandatory progress UI (D15). Revisit if feedback shows abuse.
- **CSV-only restore is metadata-only (D4).** Header comment row + missing-binary warning toast on CSV-only import + per-row missing-binary warning in the list panel. Alternative (omit the column from CSV) would lose the human-readable filename audit trail.
- **Drag-drop primary, browse fallback.** Mobile users without drag-drop rely on browse. Mockup pass (D11) confirms equal discoverability of both controls.
- **Split keeps attachments on original, split-off starts empty (D13).** Lighter default; users splitting for sale/disposition typically want a clean second item. Users splitting two halves of the same paperwork must re-attach manually — acceptable per user direction.

## Out of Scope (follow-up issues)

- **Image thumbnail generation for image attachments** (US non-goal) — current approach uses generic file-type icons. A follow-up could generate thumbnails for `image/*` attachments.
- **Inline PDF preview** (US non-goal) — current approach is download/open-in-tab. Possible future feature using `<object data="...">` or PDF.js.
- **Version history of replaced attachments** (US non-goal) — current approach is remove + re-add (new uuid). A future feature could keep prior versions.
- **OCR / PDF content extraction** (US non-goal).
- **Third-party cloud storage links** (US non-goal) — only locally-stored attachments. No Dropbox/Drive URL field.
- **Per-attachment permissions or sharing** (US non-goal).

> Note: polished DiffModal rendering — previously listed here as a follow-up — has been **pulled in-scope per user direction.** See D8.

## Risk Notes

- **`navigator.storage.estimate()` returns 0 on `file://`.** Quota checks must guard for this. Use IndexedDB writes as the source of truth (catch `QuotaExceededError`) rather than blocking pre-write based on the estimate. Matches existing `imageCache` behavior.
- **Large file uploads can lock the UI.** Reading a 200 MB PDF synchronously into a Blob then writing to IDB can stall the main thread. **Mitigation is mandatory (D15):** disabled save state during stage, per-row progress indicator, recoverable failure state with retry/remove. Async stream paths used where browser support allows.
- **Backup zip size growth.** A user with 20 items each carrying a 5 MB receipt produces a 100 MB zip. JSZip handles this in memory but the download-blob step can OOM on low-RAM devices. Risk acceptable; existing image backup has the same shape.
- **Cloud sync bandwidth surprise.** Even with the 100 MB warning, users on metered connections may hit unexpected data usage. Settings toggle is the durable opt-out; per-export checkbox is the immediate control; missing key defaults to `true` (parity with image sync default).
- **Post-commit IDB failure (D14).** Commit metadata first (following user-image precedent), then write blobs to IDB. On IDB-write failure, item metadata retains `attachments` array but failed entries render a missing-binary warning state (user can retry by re-editing). This ordering is required because `commitItemToInventory()` generates the item UUID internally in add-mode. Tested explicitly — both add-mode and edit-mode IDB failure paths must be covered.
- **DB migration if D1 ever changes.** A future v2 of `StakTrakrAttachments` follows the same `onupgradeneeded` pattern as `image-cache.js`. v1 schema documented above is the migration baseline.
- **Cloned/split attachment leakage.** D7 and D13 both produce new items that should NOT carry attachment binaries. Regression risk: a code path that copies the array (without copying binaries) would produce dangling references. Covered by Playwright tests on both flows.
- **Cascade delete and undo.** D6 makes deletion irreversible. The delete-confirmation dialog must mention "X attachments will also be deleted" when relevant — already in scope (D6, file map: `inventory.js`).
- **`safeGetElement` not available top-level in `events.js`.** All new attachment event wiring registers at runtime.
- **`/ui-mockup` approval gate (D11).** UI-implementation tasks downstream of the mockup are blocked until the user approves the mockup. Storage layer + backup pipeline tasks are unaffected. Tasks.md will mark this dependency explicitly.
- **DiffEngine completeness (D8).** `DIFF_FIELDS` must include `attachments` or sync conflict detection silently ignores attachment changes — a data-corruption-class bug. The Codex review caught this in v1; the test suite locks it in.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete and cross-referenced with task acceptance lines. v2 reconciles all Codex review notes. Then advance: `/sketch tasks STRK-45`.
