---
sketch: "STRK-123-trade-linking"
phase: requirements
created: 2026-05-26
---

# STRK-123 — Requirements

> **Source Issue:** [STRK-123](https://plane.lbruton.cc/lbruton/browse/STRK-123/)
> **Title:** Trade linking — link disposed items to received inventory items
> **Origin:** User feature request from `dddqqq69`. Users who trade bullion lose the connection between disposed items and what they received. This feature lets users see the full trade story with value comparisons.

## Overview

When a user disposes an item via "Traded", allow them to optionally link the inventory item(s) they received in the trade. This creates a bidirectional relationship between disposed and received items, enabling both tax-correct realized gain/loss tracking and a dynamic "how's my trade looking now" value comparison. Linking is optional — unlinked trades work exactly as they do today (zero regression). Links are fully editable post-disposal to support incremental cataloging (e.g., trade a kilo bar for a box of coins, catalog and link them over multiple days).

## User Stories

- **US-1:** As a stacker who trades bullion, I want to link the items I received in a trade to the disposed item, so that I can see the full trade story in one place — what I gave up, what I got, and how the values compare over time.

- **US-2:** As a stacker viewing a disposed item, I want to see the current melt/retail value of the items I received alongside what my disposed item would be worth today, so that I can evaluate whether the trade was a good deal in hindsight.

- **US-3:** As a stacker viewing an active item I received via trade, I want to see a compact provenance line showing what was traded to acquire it, so that I know the item's origin without cluttering the active item's modal.

- **US-4:** As a stacker who trades in bulk, I want to add and remove trade links incrementally after the initial disposal, so that I can catalog received items over multiple sessions and correct mistakes.

- **US-5:** As a tax-conscious investor, I want trade values auto-filled from spot prices at the trade date with the option to override, so that my realized gain/loss is accurate for tax reporting without requiring manual lookup of historical prices.

## Acceptance Criteria

### AC-1 — Dispose modal: optional item linking when Type is "Traded" (maps to US-1)

- **Given** a user opens the Remove Item modal and toggles "Track this item as disposed" with Type set to "Traded"
- **When** they reach the disposition form
- **Then** an optional "Link received items" section appears below the existing Recipient/Notes fields, allowing them to:
  - **Search and select** one or more active inventory items via a searchable picker
  - **Add a new item** via an "+ Add new item to inventory" action that opens the standard Add Item modal; on save the new item is automatically added to the linked items list
  - If a selected item already has `tradedFromUuid` set (linked to another trade), a confirmation dialog asks "This item is linked to [trade name]. Move it to this trade?" — clearing the old link on confirmation
- The existing Recipient and Notes fields remain unchanged. If no items are linked, the dispose flow completes exactly as it does today.

### AC-2 — Data model: bidirectional UUID references (maps to US-1)

- **Given** a user confirms a trade disposition with linked items
- **When** the disposition is saved
- **Then** the disposed item's `disposition` object gains a `tradedForUuids: string[]` array containing the UUIDs of all linked received items, AND each linked received item gains a `tradedFromUuid: string` field pointing back to the disposed item's UUID. Existing items without trade links are unaffected (both fields are optional/absent). Per-linked-item trade value metadata (value amount, spot-vs-custom flag) storage location to be determined in discovery phase.

### AC-3 — Disposed item view modal: "Trade" section with comparison (maps to US-1, US-2)

- **Given** a disposed item has `disposition.type === 'traded'` AND `disposition.tradedForUuids` contains one or more valid UUIDs
- **When** the user views the disposed item's modal
- **Then** the standard "DISPOSITION" section header changes to "TRADE" and includes:
  - All existing disposition fields (type, date, amount, recipient, notes)
  - Realized gain/loss relabeled as "TRADE GAIN/LOSS" (frozen at trade time)
  - A table/list of linked received items showing: name, qty, current melt value, current retail value
  - A summary comparison line: current value of disposed item vs. current total value of received items

### AC-4 — Disposed item view modal: fallback for unlinked trades (maps to US-1)

- **Given** a disposed item has `disposition.type === 'traded'` but `tradedForUuids` is empty or absent
- **When** the user views the disposed item's modal
- **Then** the standard "DISPOSITION" section renders exactly as it does today (no regression).

### AC-5 — Received item view modal: compact provenance (maps to US-3)

- **Given** an active inventory item has a `tradedFromUuid` field pointing to a valid disposed item
- **When** the user views the received item's modal
- **Then** a "TRADE" section appears showing a compact provenance line (e.g., "Acquired via trade — gave up: [item name], [cost], [date]") with a clickable link that opens the disposed item's view modal. No full comparison table on this side.

### AC-6 — Incremental edit: add/remove trade links post-disposal (maps to US-4)

- **Given** a disposed item with `disposition.type === 'traded'` (with or without existing links)
- **When** the user opens the disposed item's view modal
- **Then** an "Edit Trade" action is available that opens an inline editor allowing them to:
  - Add new items via a searchable item picker (active inventory items only)
  - Add a new item via "+ Add new item to inventory" that opens the standard Add Item modal; on save the new item is auto-linked
  - If a selected item already has `tradedFromUuid` set, a confirmation dialog asks before reassigning
  - Remove existing linked items via a remove (×) button on each
  - Save or cancel changes
    Changes update both `tradedForUuids` on the disposed item and `tradedFromUuid` on each affected received item. Each add/remove writes a change-log entry (before/after state), visible in Activity Log, undoable.

### AC-7 — Incremental edit: unlink from received side (maps to US-4)

- **Given** an active item with `tradedFromUuid` set
- **When** the user views the received item's modal
- **Then** an "Unlink from Trade" action is available that removes this item from the trade relationship (clears its own `tradedFromUuid` and removes its UUID from the disposed item's `tradedForUuids` array). Writes a change-log entry, visible in Activity Log, undoable.

### AC-8 — Trade value auto-fill from spot (maps to US-5)

- **Given** a user links items during the dispose flow (or via Edit Trade)
- **When** items are linked
- **Then** each linked item's trade value is auto-calculated using `computeMeltValue()` with the historical spot price at the trade date (via `lookupHistoricalSpot()`), respecting existing qty, unit conversion, and purity semantics. A muted label shows "spot value" for auto-filled values or "custom" for user-edited values. A reset icon allows reverting to spot. The dispose form's Amount field auto-sums the linked items' values. The user can override any individual value or the total Amount.
- **When** historical spot data is unavailable (cache miss — `lookupHistoricalSpot()` returns `null`)
- **Then** the value field shows "—" and prompts the user to enter a value manually. The "spot value" label is not shown; the field behaves as "custom" by default.

### AC-9 — Graceful handling of missing, re-disposed, and restored linked items (maps to US-4)

- **Given** a disposed item has `tradedForUuids` referencing linked items
- **When** the user views the disposed item's Trade section
- **Then:**
  - **Deleted item** (UUID no longer in inventory): renders as a placeholder (e.g., "Item removed from inventory"). The user can remove the stale link via Edit Trade.
  - **Re-disposed item** (item exists but has its own `disposition` set): renders normally in the table but with a visual indicator (e.g., "Disposed" badge). Still clickable to view.
  - **Restored source item** (user undoes the trade disposition via Restore): all trade links are cleared bidirectionally — `tradedForUuids` is removed from the restored item and `tradedFromUuid` is cleared on all previously linked received items. A change-log entry records the cleanup.

### AC-10 — Realized G/L: tax-correct, relabeled for trades (maps to US-5)

- **Given** a trade disposition with an Amount value
- **When** the disposed item's view modal renders
- **Then** realized gain/loss is calculated as `Amount - (pricePerUnit × disposedQty)` (same as today), but the label shows "TRADE GAIN/LOSS" instead of "REALIZED GAIN/LOSS". Amount is always required for traded dispositions (auto-filled from spot sum, user can override).

### AC-11 — Persistence: backup, CSV, and cloud sync coverage (maps to US-1, US-4)

- **Given** a user has items with trade links (`tradedForUuids` on disposed items, `tradedFromUuid` on received items)
- **When** the user performs a ZIP backup, CSV export/import, or cloud sync
- **Then:**
  - **ZIP backup** (`inventory-backup.js`): both `tradedForUuids` (in `disposition`) and `tradedFromUuid` (top-level) are included in the serialized item data.
  - **CSV export/import** (`inventory-import.js`): new columns for `tradedForUuids` (comma-separated UUID list) and `tradedFromUuid` are added. Round-trip preserves links.
  - **Cloud sync** (`cloud-sync.js`): `tradedFromUuid` is included in the inventory hash content sample so that received-side-only link edits produce a sync-visible content change.

## Non-Goals

- **Not supporting multi-event linking** — one trade = one disposal event. Trading item A in January and item B in March for item C requires two separate dispositions, not a single linked trade. This may be revisited in a follow-up.
- **Not bypassing the standard Add Item flow** — the "+ Add new item" action in the trade picker opens the full Add Item modal (the normal inventory entry flow). It does not provide an inline "quick add" with fewer fields. The convenience is accessibility (reachable from the picker without leaving the dispose flow), not a reduced-friction shortcut.
- **Not changing the existing dispose flow for non-trade types** — Sold, Lost, Gifted, and Returned dispositions are completely unaffected.
- **Not adding trade linking to bulk edit** — trade links are managed per-item via the view modal, not through the bulk edit flow.
- **Not supporting cross-device trade sync in v1** — trade links use UUID references in localStorage. Cloud sync compatibility will follow the existing Dropbox sync patterns but is not a first-class design target for this sketch.

## Open Questions

_All resolved during design session 2026-05-26. None blocking._

- [x] ~~Should the received item's trade section show value comparison?~~ → Light provenance line + link to disposed item, not full comparison table.
- [x] ~~Should we support linking items from different dispose events?~~ → No. One trade = one event. Many-to-many within a single trade is fine.
- [x] ~~Edit/unlink UX — inline in view modal or via the edit item flow?~~ → Both sides. Disposed side = primary editor. Received side = unlink shortcut.
- [x] ~~Should trades show realized G/L?~~ → Yes, relabeled as "Trade Gain/Loss". Tax-correct. Amount always required.
- [x] ~~How to calculate trade values?~~ → Auto-fill via `computeMeltValue()` with historical spot, editable with "spot value" / "custom" labels. Null-spot fallback: manual entry with "—" placeholder.
- [x] ~~Should Amount auto-sum from linked items?~~ → Yes. Auto-populates, user can override.
- [x] ~~Incremental editing?~~ → Yes. Trade links fully mutable post-disposal from either side.
- [x] ~~What if an item is already linked to another trade?~~ → Confirmation dialog before reassigning. Old link cleared, new link established.
- [x] ~~What happens on restore (undo disposition)?~~ → Clear all trade links bidirectionally. Clean break.
- [x] ~~Should link changes appear in Activity Log?~~ → Yes. Full change-log with before/after, undoable.
- [x] ~~Should users be able to add new items from the picker?~~ → Yes. "+ Add new item" opens the standard Add Item modal; on save, auto-links.

---

## Review Archive — requirements (2026-05-26)

_Reconciled by /sketch reconcile on 2026-05-26. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- Remove Item modal has the existing dispose toggle, Type selector with `traded`, Amount, Recipient, and Notes fields that AC-1 extends (`index.html:8298-8412`), and `openRemoveItemModal()` resets those fields before opening (`js/inventory.js:747-839`).
- Full-stack and partial-stack disposition already store `type`, `date`, `amount`, `currency`, `recipient`, `notes`, `realizedGainLoss`, and `disposedAt`; partial dispositions also store `splitFromUuid` (`js/inventory.js:931-974`, `js/inventory.js:1137-1176`).
- Disposed item view currently renders a generic "Disposition" section with Amount, optional Recipient/Notes, and "Realized Gain/Loss" (`js/viewModal.js:739-800`); valuation helpers for current melt/retail totals already exist (`js/viewModal.js:598-613`, `js/utils.js:1538-1559`).
- UUIDs are canonical item identifiers in the app model (`js/types.js:35`), generated for new/split items (`js/inventory.js:1137-1139`), and used by existing related data such as tags and price history.
- Backup/export/import/cloud-sync paths are not automatically covered by adding a new top-level item field (`js/inventory-backup.js:35-74`, `js/inventory-import.js:1080-1121`, `js/cloud-sync.js:121-135`).

**Top concerns**

1. Persistence coverage is under-specified for `tradedFromUuid` and any per-linked-item trade value metadata; without explicit JSON backup, CSV round-trip, and cloud-sync criteria, the relationship can become one-sided or invisible to sync.
2. AC-8 defines UI/value behavior that the proposed AC-2 data model cannot store, and its spot formula omits existing qty/unit conversion and cache-miss behavior.
3. Link lifecycle rules are incomplete for restore, deletion, and re-disposition; current code distinguishes deleted items from disposed items, so AC-9's fallback wording is too broad.

**Unverified assumptions**

- Each received item can belong to only one trade at a time; AC-2's single `tradedFromUuid` implies this but the requirements do not state conflict behavior when a user links an already-linked item to another trade.
- Trade links should survive ordinary inventory edits, imports, and cloud sync merges exactly like other item metadata; that is load-bearing but not yet an acceptance criterion.
- Editing links from either side should write a change-log entry and be undoable from the existing Activity Log, matching current disposition affordances.
- Restoring the disposed source item should either clear all trade links or keep provenance in a clearly defined non-disposed state; the current requirements do not choose.
- Auto-filled historical spot values are available at link time; the live lookup can return `null` when the cache lacks the target year/date.

**Inline marks on AC-2:** Persistence/export/sync gap — backup allowlist, CSV columns, and cloud sync hash don't cover new fields.

**Inline marks on AC-8:** Data model for per-item values not specified; formula omits `computeMeltValue()` semantics and `lookupHistoricalSpot()` null-return behavior.

**Inline marks on AC-9:** Re-disposed items are not deleted — they remain in inventory with `disposition` set. Requirements should distinguish deleted vs re-disposed vs restored.

**Inline marks on AC-10:** `$0 or empty` suppression branch conflicts with `DISPOSITION_TYPES.traded.requiresAmount = true` and `confirmRemoveItem()` validation at line 923-928.

### Resolution Summary

- Accepted: 10
- Rejected: 0
- Resolved with user input: 4 (Amount validation, link conflict, restore behavior, change-log)

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-123`.
