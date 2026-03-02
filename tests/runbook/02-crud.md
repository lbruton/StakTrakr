# Section 02 — CRUD

Covers all Create, Read, Update, and Delete operations for inventory items. Tests in this section build on each other: items added in early tests are edited, searched, filtered, and deleted by later tests. The section begins with a seed count of 8 items (established by `00-setup.md`) and ends with a cleanup block that removes all BB-* items added here, restoring the seed state.

Tests 2.7–2.11 cover the image upload and pattern-match features. Note that Stagehand cannot interact with OS-level file picker dialogs; those tests validate the UI flow up to the upload trigger. Full file upload verification requires manual confirmation.

---

### Test 2.1 — Add item — Silver Coin
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Seed inventory loaded (8 items). No filters or search active.
**Steps:**
- act: "click the Add Item button"
- act: "select Silver from the metal dropdown"
- act: "select Coin from the type dropdown"
- act: "type 'BB-SILVER-COIN' into the name field"
- act: "type '1' into the weight field"
- act: "type '25' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- extract: "count the number of inventory item cards displayed" → expect: 9
- screenshot: "02-crud-add-silver"
**Pass criteria:** Item count increases to 9 and BB-SILVER-COIN is visible in the inventory.
**Tags:** crud, add, silver
**Section:** 02-crud

---

### Test 2.2 — Add item — Gold Bar
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.1 complete (count = 9). No filters or search active.
**Steps:**
- act: "click the Add Item button"
- act: "select Gold from the metal dropdown"
- act: "select Bar from the type dropdown"
- act: "type 'BB-GOLD-BAR' into the name field"
- act: "type '1' into the weight field"
- act: "type '2000' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- extract: "count the number of inventory item cards displayed" → expect: 10
**Pass criteria:** Item count increases to 10 and BB-GOLD-BAR is visible in the inventory.
**Tags:** crud, add, gold
**Section:** 02-crud

---

### Test 2.3 — Add item — Platinum Round
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Tests 2.1 and 2.2 complete (count = 10). No filters or search active.
**Steps:**
- act: "click the Add Item button"
- act: "select Platinum from the metal dropdown"
- act: "select Round from the type dropdown"
- act: "type 'BB-PLAT-ROUND' into the name field"
- act: "type '1' into the weight field"
- act: "type '1000' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- extract: "count the number of inventory item cards displayed" → expect: 11
**Pass criteria:** Item count increases to 11 and BB-PLAT-ROUND is visible in the inventory.
**Tags:** crud, add, platinum
**Section:** 02-crud

---

### Test 2.4 — Add item — Palladium Bar
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.3 complete (count = 11). No filters or search active.
**Steps:**
- act: "click the Add Item button"
- act: "select Palladium from the metal dropdown"
- act: "select Bar from the type dropdown"
- act: "type 'BB-PALL-BAR' into the name field"
- act: "type '1' into the weight field"
- act: "type '1000' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- extract: "count the number of inventory item cards displayed" → expect: 12
**Pass criteria:** Item count increases to 12 and BB-PALL-BAR is visible in the inventory.
**Tags:** crud, add, palladium
**Section:** 02-crud

---

### Test 2.5 — Add item — Goldback
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.4 complete (count = 12). No filters or search active.
**Steps:**
- act: "click the Add Item button"
- act: "select Goldback from the metal dropdown"
- act: "type 'BB-GOLDBACK' into the name field"
- act: "type '1' into the weight field"
- act: "type '5' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- extract: "count the number of inventory item cards displayed" → expect: 13
**Pass criteria:** Item count increases to 13 and BB-GOLDBACK is visible in the inventory.
**Tags:** crud, add, goldback
**Section:** 02-crud

---

### Test 2.6 — Add items with each weight unit (oz, g, kg, dwt)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.5 complete (count = 13). No filters or search active.
**Steps:**
- act: "click the Add Item button"
- act: "select Silver from the metal dropdown"
- act: "type 'BB-OZ-ITEM' into the name field"
- act: "select oz from the weight unit dropdown"
- act: "type '1' into the weight field"
- act: "type '25' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- act: "click the Add Item button"
- act: "select Silver from the metal dropdown"
- act: "type 'BB-G-ITEM' into the name field"
- act: "select g from the weight unit dropdown"
- act: "type '31.1' into the weight field"
- act: "type '25' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- act: "click the Add Item button"
- act: "select Silver from the metal dropdown"
- act: "type 'BB-KG-ITEM' into the name field"
- act: "select kg from the weight unit dropdown"
- act: "type '0.0311' into the weight field"
- act: "type '25' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- act: "click the Add Item button"
- act: "select Silver from the metal dropdown"
- act: "type 'BB-DWT-ITEM' into the name field"
- act: "select dwt from the weight unit dropdown"
- act: "type '20' into the weight field"
- act: "type '25' into the purchase price field"
- act: "click the Add to Inventory or Save button"
- extract: "count the number of inventory item cards displayed" → expect: 17
- screenshot: "02-crud-weight-units"
**Pass criteria:** All 4 weight-unit items (BB-OZ-ITEM, BB-G-ITEM, BB-KG-ITEM, BB-DWT-ITEM) saved with their respective weight units; count reaches 17.
**Tags:** crud, add, weight-units
**Section:** 02-crud

---

### Test 2.7 — Upload obverse image
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Tests 2.1–2.6 complete (count = 17). BB-SILVER-COIN exists. Note: Stagehand cannot interact with OS file picker dialogs. This test validates the UI flow up to the upload trigger only; full file upload requires manual verification.
**Steps:**
- act: "click the Table view button (D) in the card sort bar to switch to table view"
- act: "click the edit pencil icon on the BB-SILVER-COIN row in the inventory table"
- act: "click the Upload Obverse Image button or area in the edit modal"
- extract: "is an upload prompt, file picker trigger, or image upload area visible?" → expect: true
- screenshot: "02-crud-obverse-image"
**Pass criteria:** The obverse image upload button is clickable and triggers the upload UI without error.
**Tags:** crud, images, upload, obverse
**Section:** 02-crud

---

### Test 2.8 — Upload reverse image
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.7 complete. BB-SILVER-COIN edit modal is open (or re-open it). Note: same Stagehand file picker limitation as 2.7 applies.
**Steps:**
- act: "click the Upload Reverse Image button or area in the edit modal"
- extract: "is an upload prompt, file picker trigger, or image upload area visible?" → expect: true
- screenshot: "02-crud-reverse-image"
**Pass criteria:** The reverse image upload button is clickable and triggers the upload UI without error.
**Tags:** crud, images, upload, reverse
**Section:** 02-crud

---

### Test 2.9 — Remove an uploaded image
_Added: v3.33.25 (STAK-396)_
**Preconditions:** An image was successfully uploaded to BB-SILVER-COIN in 2.7. If no image was uploaded (due to file picker limitation), this test is manual only — document and skip. Edit modal for BB-SILVER-COIN is open or re-open it from table view.
**Steps:**
- act: "click the remove or delete button on the obverse image in the edit modal if one is present"
- extract: "is the obverse image thumbnail no longer shown in the edit modal?" → expect: true
**Pass criteria:** The obverse image is removed and no longer displayed in the item edit form. If no image was present (file picker not interactable), note as manual verification required.
**Tags:** crud, images, remove
**Section:** 02-crud

---

### Test 2.10 — Apply pattern-matched image to multiple items
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Close the edit modal if open. At least one item image exists in inventory. Search for a pattern-match or bulk image apply feature in the UI.
**Steps:**
- act: "close the edit modal if it is still open"
- extract: "is a Pattern Match, Apply Image to All Similar Items, or bulk image apply button or option visible in the UI?" → expect: true
- screenshot: "02-crud-pattern-match-check"
**Pass criteria:** A pattern-match or bulk image application option is accessible. If the feature is not surfaced in this UI state, the test documents its absence for follow-up; pass if the feature is reachable.
**Tags:** crud, images, pattern-match
**Section:** 02-crud

---

### Test 2.11 — Remove pattern-matched image from multiple items
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.10 complete. A pattern-matched image was applied to one or more items (if feature was accessible).
**Steps:**
- extract: "is there an option to remove or clear pattern-matched images from the matched items?" → expect: true
- act: "click the remove or clear button for the pattern-matched image set"
- extract: "are pattern-matched images removed from the previously matched items?" → expect: true
**Pass criteria:** Pattern-matched images are removed from all items that received them via the pattern-match feature. If the feature was not accessible in 2.10, note as manual verification required.
**Tags:** crud, images, pattern-match, remove
**Section:** 02-crud

---

### Test 2.12 — Edit an existing item (all fields)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** BB-GOLD-BAR exists in inventory (added in 2.2). Table view active or can be switched to.
**Steps:**
- act: "click the Table view button (D) in the card sort bar to switch to table view"
- act: "click the edit pencil icon on the BB-GOLD-BAR row in the inventory table"
- act: "clear the name field and type 'BB-GOLD-BAR-EDITED'"
- act: "clear the purchase price field and type '2100'"
- act: "clear the notes field and type 'edited in test 2.12'"
- act: "click the Save Changes button to submit the edit form"
- extract: "is 'BB-GOLD-BAR-EDITED' visible in the inventory table?" → expect: true
- screenshot: "02-crud-edit"
**Pass criteria:** Item name updated to BB-GOLD-BAR-EDITED and purchase price updated to 2100; the edited item is visible in the table.
**Tags:** crud, edit
**Section:** 02-crud

---

### Test 2.13 — Delete item — confirmation dialog appears before delete
_Added: v3.33.25 (STAK-396)_
**Preconditions:** BB-PLAT-ROUND exists in inventory (added in 2.3). Inventory visible (any view).
**Steps:**
- act: "click the delete button on the BB-PLAT-ROUND card or row"
- extract: "is a confirmation dialog or confirmation prompt visible before the item is deleted?" → expect: true
- screenshot: "02-crud-delete-confirm"
**Pass criteria:** A confirmation dialog appears after clicking delete, before the item is actually removed from the inventory.
**Tags:** crud, delete, confirmation
**Section:** 02-crud

---

### Test 2.14 — Item count badge updates after add/edit/delete
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Confirmation dialog is visible from 2.13 (BB-PLAT-ROUND pending deletion).
**Steps:**
- act: "click the Confirm or Delete button in the confirmation dialog"
- extract: "count the number of inventory item cards displayed" → expect: 16
- screenshot: "02-crud-count-badge"
**Pass criteria:** Item count decrements by 1 (from 17 to 16) immediately after confirming the deletion of BB-PLAT-ROUND.
**Tags:** crud, count, badge
**Section:** 02-crud

---

### Test 2.15 — Search for an item by name
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.14 complete (count = 16). BB-SILVER-COIN exists (added in 2.1). No active filters.
**Steps:**
- act: "type 'BB-SILVER' into the search input field"
- extract: "count the number of inventory item cards currently visible after the search" → expect: ≥1
- screenshot: "02-crud-search"
**Pass criteria:** Only items whose name contains "BB-SILVER" are shown (at minimum BB-SILVER-COIN); count is ≥1.
**Tags:** crud, search
**Section:** 02-crud

---

### Test 2.16 — Filter chips reflect search results
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Search for 'BB-SILVER' is active from 2.15. At least one result is visible.
**Steps:**
- extract: "do the filter chip labels or result counts update to reflect the current search results rather than the full inventory?" → expect: true
**Pass criteria:** Filter chips show a filtered state (updated counts or active indicator) that corresponds to the search-narrowed result set, not the total inventory.
**Tags:** crud, search, filter-chips
**Section:** 02-crud

---

### Test 2.17 — Sort via filter chip (metal)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.16 complete. Clear any active search before this test.
**Steps:**
- act: "clear the search input field"
- act: "click the Silver filter chip"
- extract: "count the number of inventory item cards currently visible" → expect: ≥1
- extract: "are any non-Silver items visible in the filtered inventory?" → expect: false
**Pass criteria:** Only Silver metal items are shown after clicking the Silver filter chip; no non-Silver items are visible.
**Tags:** crud, filter, sort
**Section:** 02-crud

---

### Test 2.18 — Remove filter chip narrows/expands results
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Silver filter chip is active from 2.17.
**Steps:**
- act: "click the Silver filter chip again to deactivate it and remove the filter"
- extract: "count the number of inventory item cards currently displayed" → expect: 16
**Pass criteria:** Removing the Silver filter chip restores the full unfiltered inventory (16 items at this point in the section).
**Tags:** crud, filter, remove
**Section:** 02-crud

---

### Test 2.19 — Switch card views A → B → C → Table (D)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Test 2.18 complete. No active search or filters. Count = 16.
**Steps:**
- act: "click the View A card style button in the card sort bar"
- extract: "count the number of inventory item cards displayed in View A" → expect: ≥1
- act: "click the View B card style button in the card sort bar"
- extract: "count the number of inventory item cards displayed in View B" → expect: ≥1
- act: "click the View C card style button in the card sort bar"
- extract: "count the number of inventory item cards displayed in View C" → expect: ≥1
- act: "click the Table view button (D) in the card sort bar"
- extract: "count the number of inventory item rows displayed in Table view" → expect: ≥1
- screenshot: "02-crud-card-views"
**Pass criteria:** All 4 view modes (A, B, C, Table/D) display inventory items without error or blank content.
**Tags:** crud, views, ui
**Section:** 02-crud

---

### Test 2.20 — Melt value recalculates correctly when spot price changes
_Added: v3.33.25 (STAK-396)_
**Preconditions:** BB-SILVER-COIN exists (from 2.1). Silver spot price is loaded (visible in the spot price cards at the top of the page). Note: this test validates displayed values are consistent with the melt formula (melt ≈ weight × qty × spot); triggering a live spot price update would require external API intervention and is out of scope for this automated check.
**Steps:**
- extract: "what is the melt value displayed on the BB-SILVER-COIN card or row?" → expect: a non-zero dollar amount (e.g., $25.00 or higher)
- extract: "what is the Silver spot price shown in the spot price cards at the top of the page?" → expect: a non-zero dollar amount (e.g., $28.00 or higher)
**Pass criteria:** BB-SILVER-COIN displays a non-zero melt value and the Silver spot price card shows a non-zero value; the melt value is consistent with being derived from weight × spot (proportionality check, not exact match).
**Tags:** crud, melt-value, spot-prices
**Section:** 02-crud

---

### Test 2.21 — Cleanup — Delete all BB-* test items
_Added: v3.33.25 (STAK-396)_
**Preconditions:** All BB-* items from Tests 2.1–2.6 exist (minus BB-PLAT-ROUND deleted in 2.13 and any deleted in earlier edit tests). Table view may be active or card view — switch if needed.
**Steps:**
- act: "click the Table view button (D) to switch to table view for easier row-level access"
- act: "find the BB-SILVER-COIN row, click its delete button, and confirm deletion in the confirmation dialog"
- act: "find the BB-GOLD-BAR-EDITED row (or BB-GOLD-BAR if not renamed), click its delete button, and confirm deletion"
- act: "find the BB-PALL-BAR row, click its delete button, and confirm deletion"
- act: "find the BB-GOLDBACK row, click its delete button, and confirm deletion"
- act: "find the BB-OZ-ITEM row, click its delete button, and confirm deletion"
- act: "find the BB-G-ITEM row, click its delete button, and confirm deletion"
- act: "find the BB-KG-ITEM row, click its delete button, and confirm deletion"
- act: "find the BB-DWT-ITEM row, click its delete button, and confirm deletion"
- extract: "count the number of inventory item cards or rows displayed" → expect: 8
- screenshot: "02-crud-cleanup"
**Pass criteria:** All BB-* items added during section 02-crud are removed. The inventory count returns to 8 (seed state), confirming subsequent sections start from a clean baseline.
**Tags:** crud, cleanup
**Section:** 02-crud
