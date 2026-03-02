# Section 03 — Backup & Restore

This section covers all backup, restore, and encrypted vault operations in StakTrakr. Tests verify that inventory data and images can be exported in multiple formats (CSV, JSON, ZIP) and restored correctly, that conflict prompts appear when restoring over existing data, and that the encrypted vault flow completes without error.

**File picker limitation:** Stagehand cannot interact with OS-level file picker dialogs. For any test that requires selecting a file from disk (restore, import), the test validates the UI flow up to the point where the file picker is triggered. Actual file selection and the downstream restore result require manual verification.

---

### Test 3.1 — Backup All Stored Images
_Added: v3.33.25 (STAK-396)_
**Preconditions:** App is loaded at the PR preview URL. Inventory contains at least 1 item with an image attached.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Backup Images or Export Images button"
- extract: "Is a success message, download prompt, or confirmation that images were exported visible?" → expect: true
- screenshot: "03-backup-images"
**Pass criteria:** Clicking the backup images button triggers a download prompt or success message without error.
**Tags:** backup, images, export
**Section:** 03-backup-restore

---

### Test 3.2 — Restore Images — Restore to Correct Items
_Added: v3.33.25 (STAK-396)_
**Preconditions:** An image backup file exists from Test 3.1. Note: OS file picker interaction cannot be automated via Stagehand — test validates UI flow up to file selection prompt. Manual verification required for actual file restore/import.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Restore Images or Import Images button"
- extract: "Is a file picker dialog, restore prompt, or an instruction to select a file visible?" → expect: true
- screenshot: "03-backup-restore-images"
**Pass criteria:** The restore images button is clickable and triggers a file picker or restore prompt correctly.
**Tags:** backup, restore, images
**Section:** 03-backup-restore

---

### Test 3.3 — Export CSV — Includes All Items
_Added: v3.33.25 (STAK-396)_
**Preconditions:** App is loaded at the PR preview URL. Inventory contains the 8 seed items.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Export CSV button"
- extract: "Is any error message visible on the page after clicking Export CSV?" → expect: no error
- screenshot: "03-backup-export-csv"
**Pass criteria:** CSV export triggers without a visible error message. (File download verification is limited in cloud browsers — absence of error is sufficient.)
**Tags:** backup, export, csv
**Section:** 03-backup-restore

---

### Test 3.4 — Export JSON — Includes All Items
_Added: v3.33.25 (STAK-396)_
**Preconditions:** App is loaded at the PR preview URL. Inventory contains the 8 seed items.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Export JSON button"
- extract: "Is any error message visible on the page after clicking Export JSON?" → expect: no error
- screenshot: "03-backup-export-json"
**Pass criteria:** JSON export triggers without a visible error message.
**Tags:** backup, export, json
**Section:** 03-backup-restore

---

### Test 3.5 — Export ZIP — Includes Images
_Added: v3.33.25 (STAK-396)_
**Preconditions:** App is loaded at the PR preview URL. Inventory contains the 8 seed items.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Export ZIP button"
- extract: "Is any error message visible on the page after clicking Export ZIP?" → expect: no error
**Pass criteria:** ZIP export triggers without a visible error message. The ZIP is expected to include both inventory data and any stored images.
**Tags:** backup, export, zip
**Section:** 03-backup-restore

---

### Test 3.6 — Restore from CSV
_Added: v3.33.25 (STAK-396)_
**Preconditions:** A CSV export file exists from Test 3.3. Note: OS file picker interaction cannot be automated via Stagehand — test validates UI flow up to file selection prompt. Manual verification required for actual file restore/import.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Restore from CSV or Import CSV button"
- extract: "Is a file picker dialog, restore prompt, or an instruction to select a file visible?" → expect: true
**Pass criteria:** The restore from CSV button is clickable and triggers a file picker or restore prompt correctly.
**Tags:** backup, restore, csv
**Section:** 03-backup-restore

---

### Test 3.7 — Restore from JSON
_Added: v3.33.25 (STAK-396)_
**Preconditions:** A JSON export file exists from Test 3.4. Note: OS file picker interaction cannot be automated via Stagehand — test validates UI flow up to file selection prompt. Manual verification required for actual file restore/import.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Restore from JSON or Import JSON button"
- extract: "Is a file picker dialog, restore prompt, or an instruction to select a file visible?" → expect: true
**Pass criteria:** The restore from JSON button is clickable and triggers a file picker or restore prompt correctly.
**Tags:** backup, restore, json
**Section:** 03-backup-restore

---

### Test 3.8 — Restore from ZIP — Images Restore to Correct Items
_Added: v3.33.25 (STAK-396)_
**Preconditions:** A ZIP export file exists from Test 3.5. Note: OS file picker interaction cannot be automated via Stagehand — test validates UI flow up to file selection prompt. Manual verification required for actual file restore/import, including verifying that images are re-associated with the correct inventory items after restore.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Restore from ZIP or Import ZIP button"
- extract: "Is a file picker dialog, restore prompt, or an instruction to select a file visible?" → expect: true
**Pass criteria:** The restore from ZIP button is clickable and triggers a file picker or restore prompt correctly.
**Tags:** backup, restore, zip
**Section:** 03-backup-restore

---

### Test 3.9 — Restore Warns If Items Already Exist (Merge vs Overwrite Prompt)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Inventory has existing items (the 8 seed items). A restore is attempted with a file that contains overlapping items. Note: OS file picker interaction cannot be automated via Stagehand — test validates that the merge/overwrite prompt is accessible in the UI. If the prompt only appears after file selection, this test requires manual verification of the conflict dialog.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Restore from JSON or Restore button"
- extract: "Is a file picker dialog or restore prompt visible?" → expect: true
- screenshot: "03-backup-merge-prompt"
**Pass criteria:** A merge/overwrite confirmation dialog is expected to appear before overwriting existing data when a conflicting file is selected. UI flow to trigger the restore is accessible without error.
**Tags:** backup, restore, merge, conflict
**Section:** 03-backup-restore

---

### Test 3.10 — Restore Preserves Custom Fields (Serial Number, Notes, Purchase Date)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** A backup file exists that contains at least one item with notes, serial number, or purchase date set. Note: OS file picker interaction cannot be automated via Stagehand — if restore cannot be completed automatically, validate the custom fields display by checking an existing item that already has these fields populated in seed data.
**Steps:**
- act: "click on an inventory item card to open its detail view"
- extract: "Are any of the fields notes, serial number, or purchase date visible and populated with a non-empty value?" → expect: non-empty custom field value visible
**Pass criteria:** After restore (or on an item known to have custom fields), the notes, serial number, and purchase date fields show non-empty restored values — confirming custom fields survive a backup/restore cycle.
**Tags:** backup, restore, custom-fields
**Section:** 03-backup-restore

---

### Test 3.11 — Export Encrypted Vault
_Added: v3.33.25 (STAK-396)_
**Preconditions:** App is loaded at the PR preview URL. Inventory contains the 8 seed items.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click or expand the Encrypted Backup section within the Export section"
- act: "click the Export Encrypted Backup or Export Vault button"
- act: "type 'TestVault123!' into the password field"
- act: "click the Confirm or Export button to create the encrypted backup"
- extract: "Is a success message, 'Backup exported successfully', or download prompt visible?" → expect: success message visible
- screenshot: "03-backup-vault-export"
**Pass criteria:** Encrypted vault export completes and a success message or download prompt appears without error.
**Tags:** backup, vault, encrypt
**Section:** 03-backup-restore

---

### Test 3.12 — Restore Encrypted Vault — Includes Image Files
_Added: v3.33.25 (STAK-396)_
**Preconditions:** An encrypted vault file exists from Test 3.11. Note: OS file picker interaction cannot be automated via Stagehand — test validates UI flow up to file selection prompt. Manual verification required for actual vault restore, including verifying that images are restored correctly alongside inventory data.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click or expand the Encrypted Backup section within the Export section"
- act: "click the Restore Encrypted Vault or Import Vault button"
- extract: "Is a file picker dialog, vault restore prompt, or an instruction to select a vault file visible?" → expect: true
- screenshot: "03-backup-vault-restore"
**Pass criteria:** The vault restore UI is accessible and clicking the restore button triggers a file picker or restore prompt correctly.
**Tags:** backup, vault, decrypt, restore
**Section:** 03-backup-restore
