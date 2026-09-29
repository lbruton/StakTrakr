---
sketch: "STRK-50-payment-method-dropdown"
phase: requirements
created: 2026-05-11
---

# STRK-50 — Requirements

> **Source Issue:** [STRK-50](https://plane.lbruton.cc/lbruton/browse/STRK-50/)
> **Title:** Optional structured Payment Method dropdown
>
> **Problem:** Users want to filter/report by how they paid (Zelle, PayPal, Credit Card, Cash, Wire, Crypto). Today this lives in the Notes field — works, but isn't structured.
>
> **Proposed:** Add an **optional** Payment Method dropdown in the Edit Item modal, near the Purchase Date / Purchase Location fields. Options: Zelle, PayPal, Credit Card, Debit Card, Cash, Check, Wire, Crypto, Other, (blank).
>
> **Use cases unlocked:**
> - Filter chip: "Show me all credit-card purchases" (helps reconcile statements).
> - Sort/group by payment method.
> - Future: monthly spend reports broken out by method.
>
> **Caveat:** Genuinely optional — Notes already covers this. Lower priority unless users ask for it explicitly. Filing per Reddit feedback.
>
> **Source:** Reddit ISO-Lost-Marbles, Q5. Original clipping is currently at `DocVault/.trash/Reddit User Feedback - StakTrakr.md` (moved from Inbox). Q5 text at line 10 supports the problem statement; the structured dropdown suggestion appears at lines 90–94.

## Overview

This sketch delivers an optional `paymentMethod` field on inventory items, surfaced as a dropdown in the Edit Item modal (positioned alongside Purchase Location) and as a filterable filter-chip category in the inventory view. The enumeration covers 10 values: Zelle, PayPal, Credit Card, Debit Card, Cash, Check, Wire, Crypto, Other, and blank. Of these, the Reddit source explicitly names Zelle, PayPal, Credit Card, Cash, Wire, and Crypto; Debit Card, Check, Other, and blank are product additions to round out the set. Existing items silently default to blank — no migration. The Notes field is untouched; this is additive only.

## User Stories

- **US-1:** As a stacker, I want to record the payment method used for a purchase, so that I can match inventory items to my card or bank statements when reconciling.
- **US-2:** As a stacker, I want the payment method field to be entirely optional with a blank default, so that existing items and quick entries are unaffected.
- **US-3:** As a stacker, I want to filter my inventory by payment method via filter chips and text search, so that I can instantly see every item I bought on credit card, paid via Zelle, etc.
- **US-4:** As a stacker, I want to see the recorded payment method in the item detail view, so that I can check it without opening the edit modal.
- **US-5:** As a stacker, I want to bulk-edit payment method across multiple items, so that I can tag historical purchases efficiently without editing each one individually.

## Acceptance Criteria

### AC-1 — Dropdown present in Edit Item modal (maps to US-1)
- **Given** I am adding a new item or editing an existing item
- **When** the Edit Item modal opens
- **Then** a "Payment Method" `<select>` field is visible in the modal's purchase section, positioned in the same row as Purchase Location (or immediately following it)
- **And** the dropdown options are, in this order: `(blank)`, Zelle, PayPal, Credit Card, Debit Card, Cash, Check, Wire, Crypto, Other

### AC-2 — Value persists in localStorage (maps to US-1)
- **Given** I select "Credit Card" in the Payment Method dropdown
- **When** I click Save
- **Then** the saved item in localStorage has `paymentMethod: "Credit Card"`
- **And** editing an existing item and changing the payment method updates the stored value
- **And** the persistence path covers both add-mode and edit-mode save flows

### AC-3 — Field is optional; existing items load without error (maps to US-2)
- **Given** an existing item that has no `paymentMethod` property in localStorage
- **When** I open that item in the Edit Item modal
- **Then** the Payment Method dropdown shows the blank option (no error, no console warning)
- **And** saving without selecting a method stores no `paymentMethod` key on the item (omit, not empty string)
- **And** editing an item that already has a non-blank `paymentMethod` and clearing the dropdown back to blank deletes the `paymentMethod` key from the stored item (not preserved as stale)

### AC-4 — Payment method appears as a filter chip (maps to US-3)
- **Given** items in inventory have non-blank `paymentMethod` values meeting the chipMinCount threshold (default 3)
- **When** the filter chip row is rendered
- **Then** the distinct payment method values appear as filter chips
- **And** `paymentMethod` is registered in `FILTER_CHIP_CATEGORY_DEFAULTS` and the chip descriptor map, enabled by default
- **And** the chip category appears in the chip settings panel so users can show/hide and reorder it alongside existing categories
- **And** clicking a chip sets `activeFilters["paymentMethod"]` with a corresponding filter predicate case, and the table shows only matching items
- **And** clicking the active chip again clears that filter
- **And** payment method values are included in text search results (matching how Purchase Location participates in `filterInventoryAdvanced` text search today)

### AC-5 — Payment method visible in View modal (maps to US-4)
- **Given** an item has `paymentMethod: "Zelle"` recorded
- **When** I open that item's view modal (`showViewModal()` in `js/viewModal.js`)
- **Then** "Zelle" is displayed in the purchase details section alongside Purchase Date and Purchase Location

### AC-6 — Cloud sync and backup/restore preserve paymentMethod (maps to US-1)
- **Given** an item has `paymentMethod: "Wire"` recorded
- **When** I perform a cloud sync (Dropbox), or create and restore a ZIP backup
- **Then** the restored/synced item retains `paymentMethod: "Wire"` with no data loss
- **And** cloud sync carries the field transparently via the raw localStorage payload
- **And** ZIP backup/restore includes `paymentMethod` in its field map

### AC-7 — JSON, CSV, ZIP, and PDF exports include paymentMethod (maps to US-1)
- **Given** items have `paymentMethod` values recorded
- **When** I export via JSON, CSV, ZIP backup, or PDF
- **Then** the exported data includes the `paymentMethod` field/column
- **And** CSV/JSON import correctly round-trips the `paymentMethod` value back into inventory

### AC-8 — Playground mockup reviewed before implementation (layout gate)
- **Given** the edit modal's purchase section already has two-column rows (Date/Price, Purchase Location/Storage Location)
- **When** a Payment Method dropdown is added
- **Then** a playground mockup copying the real edit modal layout must be created and reviewed for desktop and mobile before implementation begins
- **And** the mockup demonstrates that Purchase Price retains full usable width, Purchase Location is not cramped, and the dropdown is readable on mobile

> **Current layout reference** — Purchase Date and Purchase Price share a single row. The proposed layout places Payment Method as a third element on that same row (far right): `[Purchase Date] [Purchase Price] [Payment Method]`. Purchase Location / Storage Location row is unchanged.
>
> ![Current edit modal — purchase section](../../../../Screenshot%202026-05-13%20at%2010.31.42%20AM.png)

### AC-9 — Bulk edit supports paymentMethod (maps to US-5)
- **Given** I have selected multiple items in the inventory
- **When** I open the bulk edit interface
- **Then** Payment Method appears as a selectable bulk-edit field with the same dropdown options as the edit modal
- **And** bulk-setting to blank clears the `paymentMethod` key on all affected items (same contract as AC-3)

### AC-10 — Clone preserves paymentMethod
- **Given** an item has `paymentMethod: "PayPal"` recorded
- **When** I clone that item
- **Then** the cloned copy retains `paymentMethod: "PayPal"`

## Non-Goals

- **No custom free-text for "Other"** — selecting Other stores the string `"Other"` only; a follow-up issue can add a companion text field if needed.
- **No column sort/group by payment method** — filter chip (AC-4) is the first step; table-column sorting is a separate follow-up.
- **No monthly spend reports** — the issue explicitly marks this as a future use case.
- **No automatic migration of Notes → paymentMethod** — Notes field is untouched; users enter the field manually going forward.

## Open Questions

_Must be resolved before discovery starts._

- [ ] **Blank storage vs filter system** — AC-3 says omit the key when blank; AC-4 requires a filter predicate. Discovery must confirm the filter system handles a missing key (vs. `""`) without special-casing, or define the normalization approach.
- [ ] **All code paths** — Discovery must trace every path that touches item fields: add, edit, clone, bulk edit, import (CSV/JSON), backup restore, cloud sync restore. Each path must learn `paymentMethod`.

---

> **Phase complete.** All acceptance criteria are concrete and verifiable. Two open questions remain for discovery. Next: `/sketch review STRK-50 requirements` (round 2 if desired), then `/sketch discovery STRK-50`.

## Review Archive — requirements (2026-05-13)

_Reconciled by /sketch reconcile on 2026-05-13. Original reviewer marks preserved below for audit._

### Codex

**What I verified**

- Source citation: `DocVault/Inbox/Reddit User Feedback - StakTrakr.md` is not present; the matching file currently exists at `/Volumes/DATA/GitHub/DocVault/.trash/Reddit User Feedback - StakTrakr.md`. Q5 supports the problem statement at `.trash/Reddit User Feedback - StakTrakr.md:10`, and the structured dropdown suggestion appears at `.trash/Reddit User Feedback - StakTrakr.md:90-94`.
- Add/edit modal: the unified item modal lives in `index.html:1837-1852`; Purchase Date/Price are at `index.html:2167-2230`; Purchase Location/Storage Location are at `index.html:2231-2241`. The element cache contains purchase/storage/notes/date fields but no payment-method field at `js/state.js:51-88`.
- Persistence path: form parsing includes purchase location/storage/notes/date at `js/events.js:1454-1489`, `buildItemFields()` copies known fields at `js/events.js:1616-1644`, edit mode preserves old fields before overwriting known fields at `js/events.js:1690-1710`, and add mode pushes the built field object at `js/events.js:1834-1858`.
- Filter chips: category counting and descriptors are fixed at `js/filters.js:136-146`, `js/filters.js:283-297`, and `js/filters.js:351-369`; filter predicates are explicit cases starting at `js/filters.js:907-970`; default chip categories are fixed at `js/constants.js:1157-1170`; generic filter click storage happens at `js/filters.js:1361-1406`.
- View modal: `showViewModal()` builds the item modal at `js/viewModal.js:55-68`; Date and Source are rendered in the Inventory section at `js/viewModal.js:473-481`.
- Export/sync surfaces: encrypted vault/cloud sync copies raw localStorage via `js/vault.js:308-355` and `js/vault.js:487-495`; ZIP/JSON/CSV/PDF exports use explicit field maps at `js/inventory-backup.js:26-59`, `js/inventory.js:1844-1878`, `js/inventory-import.js:1044-1081`, `js/inventory-import.js:1100-1137`, and `js/inventory.js:1935-1970`.

**Top 3 Issues Raised**

1. AC-3 does not cover clearing an existing non-blank payment method. Because edit mode spreads `oldItem` before applying known parsed fields, omitting a blank field can preserve stale `paymentMethod` unless the implementation explicitly deletes it.
2. AC-4 assumes filter chips work once `activeFilters["paymentMethod"]` is set, but current code requires adding payment method to summary counting, descriptor/default settings, and the filter predicate. The "at least one item" condition also conflicts with the existing chip minimum count default of 3.
3. The sync/export non-goal is partly wrong. Dropbox encrypted sync should carry the raw item object through localStorage, but JSON/CSV/PDF/ZIP exports use explicit field lists and will drop or omit `paymentMethod` unless intentionally updated or declared out of scope.
4. The requirements do not ask for a UI mockup or layout proof. Given the proposed control sits in an already dense purchase section, discovery/approach should include a quick mockup or screenshot-level acceptance check for desktop and mobile before implementation is accepted.

**Unverified Assumptions**

- The source clipping can remain in `.trash` or be restored before later phases cite it. This is load-bearing for traceability because the requirements currently point at a non-existent Inbox path.
- Debit Card, Check, Other, and blank are accepted product additions beyond the Reddit examples. The source supports Zelle, PayPal/Paypal, Credit Card, Cash, Wire, and Crypto, but not the complete 10-value list.
- A fixed enum is preferable to alternatives such as: tags/custom filter groups only, a reusable user-configurable enum setting, or a short controlled dropdown plus optional custom text for values outside the list.
- Payment method should be excluded from table columns and sort/grouping for this sketch, even though the source issue mentions future reporting and the current app has table/card sort surfaces.
- Payment method should not appear in CSV/JSON/PDF/ZIP exports, or else those export maps must be updated despite the "plain item property" framing.
- Cloud sync, backup/restore, CSV import/export, and JSON import/export are all expected to preserve the field. This is not yet stated as an acceptance criterion and should be made explicit if it is a product requirement.
- A quick mockup is unnecessary because the UI change is small. This is load-bearing: the purchase form is already structured into fixed rows, and adding another dropdown can easily degrade the purchase price/location layout if not checked visually.
- Text search should not match payment method values unless the user clicks chips. This is unresolved because notes and purchase location are already searchable.
- Existing saved chip category settings should automatically surface a new default category. The merge helper appends new defaults, but only if `paymentMethod` is added to `FILTER_CHIP_CATEGORY_DEFAULTS`; existing user ordering and enabled/disabled expectations still need an explicit decision.

### Resolution Summary
- Accepted: 12
- Rejected: 2 (source file restoration is housekeeping not a blocker; alternative enum designs are over-engineering for sketch tier)
- Resolved with your input: 3 (text search → chips + search; exports → all in scope; bulk edit → add as bulk-editable field)