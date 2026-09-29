---
sketch: "STRK-45-per-item-attachments"
phase: discovery
created: 2026-05-08
---

# STRK-45 — Discovery

## Existing Code Relevant to This Work

### IndexedDB layer — `js/image-cache.js`

The `ImageCache` class (singleton `imageCache`) manages `StakTrakrImages` v3 with four stores:

| Store           | Key                | Purpose                                                         |
| --------------- | ------------------ | --------------------------------------------------------------- |
| `coinImages`    | `catalogId`        | Legacy Numista coin images (deprecated, kept for schema compat) |
| `coinMetadata`  | `catalogId`        | Enriched Numista metadata                                       |
| `userImages`    | `uuid` (item UUID) | User-uploaded coin photos (obverse + reverse Blobs)             |
| `patternImages` | `ruleId`           | Pattern-rule match images                                       |

The DB upgrade uses `onupgradeneeded` with per-version guards. Adding a `userAttachments` store is a **v4 bump** following the exact same pattern:

```js
if (e.oldVersion < 4) {
  if (!db.objectStoreNames.contains("userAttachments")) {
    db.createObjectStore("userAttachments", { keyPath: "attachmentUuid" });
  }
}
```

All CRUD helpers (`_put`, `_get`, `_delete`, `_getAll`, `_iterate`, `_txComplete`) are private methods on `ImageCache`. Two options for the attachment store: (1) add a `userAttachments` store to the existing DB inside `ImageCache` — keeps everything in one DB, re-uses all helpers; (2) create a new `AttachmentManager` class with its own DB (`StakTrakrAttachments v1`) — clean separation, zero risk to image DB. Option 1 is the simpler path; option 2 avoids touching the image class entirely. **Surface as open question in approach.md.**

The `ImageCache` singleton is available on `window.imageCache` after `js/image-cache.js` loads (before `defer` scripts on page). Any new attachment module must load after `image-cache.js`.

**`_ensureDb()` pattern** — every public method calls this before any transaction. This guards against browser-initiated DB connection closure under memory pressure. New attachment methods must follow the same pattern.

**Quota tracking** — `ImageCache._quotaBytes` estimates available space via `navigator.storage.estimate()`. A parallel attachment quota estimate is not strictly required (the IndexedDB origin quota covers both), but surfacing attachment usage in the Settings storage table is desirable.

---

### ZIP backup — `js/inventory-backup.js`

`createBackupZip()` and `restoreBackupZip()` are the canonical backup pipeline. The user image integration (STAK-225 / STAK-226) is the direct template for attachments:

**Backup side (lines 270–305):**

```js
const allUserImages = await imageCache.exportAllUserImages();
const userImgFolder = zip.folder("user_images");
const userImageManifest = { version, exportDate, entries: [] };
for (const rec of allUserImages) {
  userImgFolder.file(`${rec.uuid}_obverse.jpg`, rec.obverse);
  userImageManifest.entries.push({ uuid, itemName, hasObverse, obverseFile, ... });
}
zip.file("user_image_manifest.json", JSON.stringify(userImageManifest));
```

**Attachment equivalent** would add:

- `user_attachments/` folder containing `{attachmentUuid}.{ext}` (the raw Blob)
- `user_attachment_manifest.json` mapping `attachmentUuid → { itemUuid, fileName, type, size, uploadedAt }`
- `inventoryData.inventory` items gain an `attachments: [{uuid, fileName, type, size, uploadedAt}]` array

**Restore side** — `restoreBackupZip` parses the zip then calls `applyAncillaryData()` _after_ the user accepts the DiffModal. The attachment binary restore would go inside `applyAncillaryData()`, following the same `user_image_manifest.json` parsing pattern already on lines 534–570. If no manifest is present, the fallback can reconstruct from filename parsing (`{uuid}.ext`).

**Important**: The item records' `attachments` metadata array travels in `inventory_data.json`, not in the manifest. The manifest only carries binary-to-uuid association. This means DiffModal sees `attachments` field changes on items (add/remove entries) via the existing `DiffEngine.compareItems()` item diff — but the default DiffEngine comparison is insufficient for per-attachment granularity (see approach.md D8 v3 for the custom comparator contract).

---

### Stvault — `js/vault.js`

Two encrypted companion file patterns already exist:

**Image vault (STAK-181)** — `collectAndHashImageVault()` exports all `userImages` records, serializes Blob fields to base64, computes a stability hash, then `vaultEncryptImageVault()` encrypts using the same PBKDF2-AES-256-GCM path as the main vault. Download name: `staktrakr_backup_{ts}_images.stvault`. Import: `vaultDecryptAndRestoreImages()`.

**Stmanifest format (STAK-188)** — `encryptManifest()` / `decryptManifest()` use a separate STMF header format for lightweight JSON manifests.

For attachments, the image vault pattern is the correct template since attachments are also binary (Blob) data. The companion download name would be `staktrakr_backup_{ts}_attachments.stvault`. Functions needed: `collectAndHashAttachmentVault()`, `vaultEncryptAttachmentVault()`, `vaultDecryptAndRestoreAttachments()`.

The constant `VAULT_IMAGE_FILE_SUFFIX` (e.g. `"_images"`) already exists. A parallel `VAULT_ATTACHMENT_FILE_SUFFIX = "_attachments"` would go in `constants.js`.

The `_vaultPendingImageFile` / `setVaultPendingImageFile` pattern in the vault modal UI handles the optional companion file during import. An analogous `_vaultPendingAttachmentFile` slot is needed.

---

### Cloud sync — `js/cloud-sync.js` and `js/vault.js`

`cloud-sync.js` auto-sync only covers `SYNC_SCOPE_KEYS` (localStorage keys). There is no current mechanism to auto-sync IndexedDB binary data via the sync loop.

The manual "Include photos" checkbox path in `handleVaultAction` (vault.js lines ~1145–1362) is the existing precedent for cloud-uploading IndexedDB binary data. This path: (1) checks for existing user images in IndexedDB, (2) injects a checkbox into the vault modal, (3) on export, serializes + encrypts + uploads to `SYNC_IMAGES_PATH`.

The attachment equivalent would follow the same flow but upload to a new `SYNC_ATTACHMENTS_PATH` constant. The "Sync attachments" toggle in Settings (AC-9) would persist to `localStorage` (a new key in `ALLOWED_STORAGE_KEYS`) and control whether the upload step runs.

**Size threshold**: AC-9 requires a warning at 100 MB total attachment size. `navigator.storage.estimate()` is already used by `ImageCache._initQuota()`; a parallel estimate across the `userAttachments` store can fire the warning.

---

### Edit modal — `index.html` + `js/inventory.js`

The item add/edit modal (`#itemModal`) uses a collapsible `.form-section` pattern. Existing sections: Core fields, Details, Certificate, Images (photo upload), Notes, Tags. The Attachments section would be inserted **between Notes (`#notesSection`) and Tags (`#tagsSection`)** following the same `form-section` + `form-section-header` + `form-section-body` structure.

`editItem()` in `inventory.js` (line 1280) is the entry point for populating the modal. It reads from the item's fields and sets UI state. The new Attachments section would be populated in `editItem()` after loading the item — it would read the item's `attachments` array and render the current list, then wire drag-drop for new uploads.

The item's `attachments` metadata array is small (just UUIDs and filenames) and lives in `localStorage` via `metalInventory`. The binary blobs stay in IndexedDB. This separation keeps the inventory item record compact.

**`saveInventory()`** already handles the full item serialization — adding `attachments: item.attachments || []` to the serialized record is the only change needed there.

---

### View modal — `js/viewModal.js`

`showViewModal(index)` builds DOM content dynamically from `buildViewContent(item, index)`. An attachment count badge can be injected into `buildViewContent` when `item.attachments?.length > 0`. Clicking the badge would open an inline attachment list panel (or a dedicated attachment list modal).

### Card view — `js/card-view.js`

Card view renders items as cards. An attachment count chip (similar to tag chips) can be appended when `item.attachments?.length > 0`. Card template is generated in `card-view.js`; the hook is straightforward.

### Inventory table — `js/inventory-table.js`

Table rows are rendered in `inventory-table.js`. A full attachment column would be visually cluttered; a small badge on the existing row is preferred for MVP.

---

### CSV export — `js/inventory-backup.js`

`csvHeaders` array (line 131) and `csvRows` (lines 165–215) already include all inventory fields. Adding an `Attachments` column requires:

1. Appending `"Attachments"` to `csvHeaders`
2. Computing `item.attachments?.map(a => `${a.fileName}#${a.uuid}`).join(", ") || ""` in `csvRows`
3. Mirroring the same change in the standalone `exportCsv()` function if it exists separately

---

### Script load order

Current load order (from `index.html` bottom `<script defer>` block, lines 8348–8380):

```
image-cache.js → ... → inventory-backup.js → inventory-import.js →
inventory-table.js → inventory.js → card-view.js → vault.js →
cloud-storage.js → cloud-sync.js → ... → events.js → init.js
```

A new `js/attachment-manager.js` must load **after `image-cache.js`** and **before `inventory-backup.js`** and `inventory.js` (both call into it). Its `<script defer>` tag goes between `image-cache.js` and `inventory-backup.js` in `index.html`.

---

### SW cache — `sw.js`

The `stamp-sw-cache` pre-commit hook auto-stages `sw.js` when JS files are committed. A new `js/attachment-manager.js` will be picked up automatically by the hook. No manual `sw.js` edit needed.

---

## Prior Decisions

No prior session decisions found specific to STRK-45. The patterns for image vault, zip backup, and IndexedDB integration were established across:

- STAK-181 — image vault companion file (the direct template for attachment vault)
- STAK-225/226 — user image backup in zip (the direct template for attachment zip)
- STAK-484 — backup extraction from inventory.js
- STACK-88 — metadata backup
- STAK-188 — STMF manifest format (lighter-weight crypto path, suitable for metadata-only payloads)

---

## External References

- [MDN: Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB) — `onupgradeneeded` versioning pattern
- [MDN: IDBObjectStore](https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore) — store operations
- [JSZip docs](https://stuk.github.io/jszip/) — `zip.folder()`, `file.async("blob")` patterns
- [Web Crypto API: AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt) — used in `vaultEncrypt()` / `vaultDecrypt()`
- [Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API) — for the drop zone in the edit modal

---

## Constraints

- **No localStorage for binaries** — attachment blobs must live in IndexedDB. Metadata (uuid, fileName, type, size, uploadedAt, itemUuid) is the only attachment state in `metalInventory`.
- **No UI framework** — vanilla JS only. Drag-drop, file lists, and badge rendering all use raw DOM APIs.
- **`safeGetElement` unavailable at top-level in `events.js`** — attachment event handlers must register at runtime, not top-level (consistent with existing pattern).
- **Cloned items should NOT clone attachments** — cloning creates a new UUID; the clone starts with an empty `attachments` array. This is intentional: a cloned item's purchase documents differ from the original.
- **File:// protocol** — app must work on `file://`. `navigator.storage.estimate()` returns 0 quota on `file://`; attachment quota checks must guard for this. IndexedDB itself works on `file://`.

---

## Open Questions — Resolved

- [x] **DB choice**: **New DB** — `StakTrakrAttachments v1` in a new `js/attachment-manager.js`. Self-documenting, clean separation, avoids touching the 810-line image class.

- [x] **Stvault companion format**: **STVAULT pattern** — encrypted, must survive the full import/export/cloud-sync lifecycle. Same AES-256-GCM path as images.

- [x] **UI polish scope**: **Full polish required** in planning — covers two surfaces:
  - _DiffModal_: attachment field diffs must render meaningfully (e.g., filenames added/removed), not as raw JSON. Plan a design pass; may gate as a separate approval issue.
  - _Edit modal attachment section_: needs a design decision on form placement and input chrome before implementation. Images live near the top of the form; attachments are a different concern (document filing vs. visual display). Likely position: **after Notes, before Tags** — but this should be confirmed with a mockup or explicit layout discussion rather than assumed. Consider a `/ui-mockup` pass covering both the drop-zone input chrome and the inline file list (filename, size, type icon, remove button).

- [x] **Cascade delete on item delete**: **Yes** — items are the anchor. `deleteInventoryItem()` must delete all IndexedDB attachments for that item UUID.

- [x] **Cloud sync toggle location**: **Both** — persistent toggle in Settings + per-export checkbox on vault modal. Also applies to the manual cloud backup path (`cloud-export` mode in vault modal) — verify it uses the same "Include attachments" checkbox pattern as "Include photos".

---

> **Phase complete?** All relevant code paths documented. Five open questions identified — architecture judgment calls, not blockers. Advance: `/sketch approach STRK-45`.
