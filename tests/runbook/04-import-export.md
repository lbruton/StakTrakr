# Section 04 — Import & Export

This section covers CSV/eBay import flows, duplicate detection, the merge diff viewer, selective import, and PDF export. It is distinct from Section 03 (backup/restore) in that it focuses on structured data import from external sources and the merge/conflict resolution UX rather than full inventory backup cycles.

**File picker limitation:** Stagehand cannot interact with OS-level file picker dialogs. For any test that requires selecting a file from disk, the test validates the UI flow up to the point where the file picker is triggered. Actual file selection and downstream import results require manual verification.

---

### Test 4.1 — Import from CSV Source 1 (Generic Format)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** App is loaded at the PR preview URL. Inventory contains the 8 seed items.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Import from CSV or Import CSV button"
- extract: "Is an import panel, modal, or file picker prompt visible?" → expect: true
- screenshot: "04-import-csv1"
**Pass criteria:** The generic CSV import option is accessible and clicking it opens an import panel, modal, or file picker prompt without error.
**Tags:** import, csv
**Section:** 04-import-export

---

### Test 4.2 — Import from CSV Source 2 (eBay Format)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** App is loaded at the PR preview URL. Inventory contains the 8 seed items.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Import from eBay CSV or eBay format import option if available"
- extract: "Is an eBay-format import option, modal, or file picker prompt accessible?" → expect: true (if feature exists)
- screenshot: "04-import-csv2"
**Pass criteria:** eBay CSV import option is accessible in the import UI, or its absence is clearly documented. If the feature does not exist, this test is marked as not applicable and noted for future implementation.
**Tags:** import, csv, ebay
**Section:** 04-import-export

---

### Test 4.3 — Duplicate Detection — Flags Items That Already Exist
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Inventory contains 8 seed items. A CSV import file is available that contains at least one item matching an existing inventory entry (same name or metal/type combination). Note: OS file picker interaction cannot be automated via Stagehand — test validates that duplicate detection UI is present in the import flow. Manual verification of duplicate flagging requires completing the file selection step.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Import from CSV or Import CSV button"
- extract: "Is an import panel, modal, or flow visible that would show duplicate detection after file selection?" → expect: true
- screenshot: "04-import-duplicates"
**Pass criteria:** The import UI is accessible and is expected to flag duplicate items before the import completes. Manual verification confirms that duplicate items are highlighted or listed separately from new items.
**Tags:** import, duplicates, detection
**Section:** 04-import-export

---

### Test 4.4 — Merge Diff Viewer Appears When Merging
_Added: v3.33.25 (STAK-396)_
**Preconditions:** MANUAL/CONTROLLED TEST — Duplicate items were detected in Test 4.3. The import flow has reached the stage where duplicates are identified and the diff viewer should be shown. File selection is required (not automatable via Stagehand) — manual execution needed to progress past the OS file picker.
**Steps:**
- extract: "Is a diff viewer, merge comparison panel, or side-by-side comparison of existing vs incoming item data visible?" → expect: true
- screenshot: "04-import-diff-viewer"
**Pass criteria:** A diff viewer or merge comparison UI appears when duplicate items are detected during import, allowing the user to review differences before deciding how to proceed.
**Tags:** import, merge, diff
**Section:** 04-import-export

---

### Test 4.5 — Diff Viewer Shows Field-Level Diffs
_Added: v3.33.25 (STAK-396)_
**Preconditions:** MANUAL/CONTROLLED TEST — Diff viewer is visible from Test 4.4. At least one field differs between the existing item and the incoming item (e.g., purchase price, name, or weight). Requires prior manual file selection step.
**Steps:**
- extract: "Does the diff viewer show individual field-level differences, such as old vs new purchase price, old vs new name, or old vs new weight?" → expect: at least one field difference visible
**Pass criteria:** The diff viewer displays field-level differences (not just item-level flags), allowing users to see exactly what would change for each duplicate item.
**Tags:** import, merge, diff, fields
**Section:** 04-import-export

---

### Test 4.6 — Selectively Import — Check/Uncheck Items from Diff
_Added: v3.33.25 (STAK-396)_
**Preconditions:** MANUAL/CONTROLLED TEST — Diff viewer is visible with at least two items listed. Each item has a checkbox or toggle to include/exclude it from the import. Requires prior manual file selection step.
**Steps:**
- act: "uncheck or deselect one item in the diff viewer or import list"
- extract: "Is the unchecked item marked as skip, excluded, or visually distinguished from selected items?" → expect: true
**Pass criteria:** Individual items can be deselected in the diff/import view. Deselected items are visually marked as skipped or excluded.
**Tags:** import, merge, select, skip
**Section:** 04-import-export

---

### Test 4.7 — Skipped Item Leaves Existing Data Intact
_Added: v3.33.25 (STAK-396)_
**Preconditions:** MANUAL/CONTROLLED TEST — One item was unchecked/excluded in Test 4.6. The import has been confirmed or completed. Requires prior manual file selection step.
**Steps:**
- act: "confirm or complete the import with the one item left unchecked"
- extract: "Does the skipped item still appear in the inventory with its original values unchanged?" → expect: original values unchanged
**Pass criteria:** The item that was deselected from the import retains its pre-import values. The import did not overwrite or remove the skipped item's existing data.
**Tags:** import, merge, skip, data-integrity
**Section:** 04-import-export

---

### Test 4.8 — Import Summary Reports N Added / N Skipped / N Merged
_Added: v3.33.25 (STAK-396)_
**Preconditions:** An import has been completed (from any prior test in this section, or a fresh import run). The import involved at least one added item, one skipped item, or one merged item.
**Steps:**
- extract: "Is there a summary message or results panel showing counts for how many items were added, skipped, or merged?" → expect: summary with numeric counts visible
- screenshot: "04-import-summary"
**Pass criteria:** After import completes, a summary is displayed showing at minimum one numeric count (e.g., "3 added", "1 skipped", "0 merged"). The counts accurately reflect the import outcome.
**Tags:** import, summary
**Section:** 04-import-export

---

### Test 4.9 — PDF Export — No Error, File Downloads
_Added: v3.33.25 (STAK-396)_
**Preconditions:** App is loaded at the PR preview URL. Inventory contains the 8 seed items.
**Steps:**
- act: "click the Settings gear icon in the header"
- act: "click the Inventory tab in the settings panel"
- act: "click the Export PDF or Print PDF button"
- extract: "Is any error message visible on the page after clicking Export PDF?" → expect: no error
- screenshot: "04-import-pdf-export"
**Pass criteria:** PDF export triggers without a visible error message. (File download verification is limited in cloud browsers — absence of error is sufficient.)
**Tags:** export, pdf
**Section:** 04-import-export
