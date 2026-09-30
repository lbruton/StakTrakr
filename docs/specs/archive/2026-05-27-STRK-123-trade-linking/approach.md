---
sketch: "STRK-123-trade-linking"
phase: approach
created: 2026-05-26
---

# STRK-123 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Trade linking adds an optional bidirectional UUID relationship between a disposed "traded" item and one or more active received items, with frozen trade-time values and a live comparison view. The feature touches three vertical slices: (1) the **dispose/edit flow** in `inventory.js` and `index.html`, where links are created, edited, and cleaned up; (2) the **view modal** in `viewModal.js`, where trade sections replace the generic disposition section and provenance lines appear on received items; and (3) the **persistence/sync layer** across `inventory-backup.js`, `inventory-import.js`, `cloud-sync.js`, `diff-engine.js`, and `changeLog.js`, where the new fields must round-trip through every serialization surface.

No new JS files are needed. The disposed-side data (`tradedForUuids` and per-item trade values) lives inside the existing `disposition` object, which is already serialized into the cloud hash, captured by `DIFF_FIELDS`, and round-tripped through backup/CSV. The received-side pointer (`tradedFromUuid`) is a new top-level item field requiring explicit registration in six surfaces (see D-2). All trade-link mutations (create, edit, unlink, restore-cleanup) are bidirectional writes that update both the source disposition and each affected received item in a single `saveInventory()` call to prevent one-sided orphans.

The view modal's `sectionBuilders` map in `buildViewContent()` already registers a `disposition` key. The implementation replaces that builder with a trade-aware function that detects `disposition.type === "traded"` with linked items and renders the expanded Trade section (comparison table, edit controls), while falling through to the existing `_buildDispositionSection()` for all non-trade dispositions and unlinked trades. The received-item provenance line is injected via a new `tradeProvenance` section builder registered alongside `disposition`.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Confirm `disposition.tradedForUuids` as the disposed-side field name — array of UUID strings stored inside the existing `disposition` object | Lives inside `disposition`, which is already JSON-serialized in the cloud hash (`computeInventoryHash`), included in `DIFF_FIELDS`, and round-tripped by ZIP JSON backup. Standalone CSV exports only scalar disposition columns (type, date, amount, etc.) — nested objects like `tradedForUuids` and `tradeValues` do not survive standalone CSV round-trip (see D-10). No new top-level field registration needed on the disposed side. Name matches the existing `splitFromUuid` pattern (UUID reference fields use `*Uuid` / `*Uuids` suffix). | The `disposition` object grows larger for trades — but an unbounded UUID array is still tiny vs. localStorage limits (~5MB). A trade linking 100 items = ~3.6KB of UUIDs. |
| D-2 | `tradedFromUuid` is a new top-level item field (not nested inside anything) | The received item is an active inventory item with no `disposition`. A top-level field is the natural place, and it follows the `splitFromUuid` precedent. Must be added to all six registration surfaces: (1) `DIFF_FIELDS`, (2) `logItemChanges` fields, (3) ZIP JSON backup map, (4) standalone CSV export headers + row builder, (5) CSV import parser, (6) `computeInventoryHash` content sample. | Six edit sites — one missed = silent data loss (STAK-493 precedent). Tasks must enumerate each site explicitly. |
| D-3 | Per-linked-item trade values stored as `disposition.tradeValues: { [uuid]: { meltValue, spotPrice, isCustom } }` | Keeps all trade metadata on the disposed side (single source of truth). `meltValue` is the frozen trade-time value; `spotPrice` is the historical spot used; `isCustom` flags user overrides. Nested inside `disposition` → gets cloud hash and diff coverage for free. | `disposition` object becomes a bit heavier. Alternative was a flat array of `{ uuid, meltValue, ... }` objects — but a UUID-keyed map is faster for lookup/update during edit flows and prevents duplicate entries. |
| D-4 | Replace the `disposition` section builder, don't add a second one | `buildViewContent()` registers builders by key in `sectionBuilders`. A single `disposition` key that dispatches to trade-aware or generic rendering avoids section-ordering changes and duplicate sections. The existing `_buildDispositionSection()` becomes an internal helper called for non-trade cases. | Slightly longer function, but keeps the section registry clean. |
| D-5 | Received-item provenance renders inside the existing `disposition` section builder | A compact one-line provenance ("Acquired via trade — gave up: [name], [cost], [date]") with a clickable link, rendered as a sub-block within the `disposition` section builder when `item.tradedFromUuid` is set and the source item exists. No new `VIEW_MODAL_SECTION_DEFAULTS` entry needed — provenance rides inside the already-configured `disposition` section. Users who disable "Disposition" in view-modal settings also hide provenance, which is conceptually correct. | Provenance is not independently toggleable. Acceptable — it only renders for traded items and is logically part of disposition context. |
| D-6 | Trade-link edits use per-operation change-log entries, not scalar field assignment | Adding/removing a link touches two items. Each add writes one entry per affected item (disposed + received). Each remove writes one entry per affected item. Entries use field name `"tradeLink"` with structured JSON old/new values containing both UUIDs. **Requires a dedicated `toggleChange()` branch** (like `priceHistoryDelete`) that reads the structured JSON and updates `disposition.tradedForUuids`/`tradeValues` on the disposed side and `tradedFromUuid` on the received side — the generic scalar fallthrough (`item[entry.field] = entry.oldValue`) would create a spurious `item.tradeLink` property instead of updating the real relationship fields. | More change-log entries per edit vs. a single entry. But single-entry undo would need custom cascade logic (like `splitInventoryItem`'s transactionId). Per-operation entries are simpler and undoable individually. |
| D-7 | Undo for trade-link edits is per-entry, not cascaded | Each trade-link change-log entry can be undone independently: undoing "linked item B to trade X" removes B from X's `tradedForUuids` and clears B's `tradedFromUuid`. No transactionId grouping needed. This is simpler than the split-disposition cascade and sufficient because link edits are conceptually independent operations (unlike a split, which is atomic). | A user who linked 5 items in one batch and wants to undo all 5 must undo 5 entries. Acceptable — the Activity Log already shows individual changes. |
| D-8 | Restore (undo disposition) clears all trade links bidirectionally | When `restoreInPlace()` or `undoDisposition()` clears `item.disposition`, also iterate `disposition.tradedForUuids`, find each received item by UUID, clear its `tradedFromUuid`, and log one change-log entry per cleared link. This prevents orphaned `tradedFromUuid` pointers after restore. | Extra work in the restore path, but the alternative (orphaned pointers) is worse. The UUID lookup is O(n) per linked item — fast for realistic trade sizes. |
| D-9 | Item picker UI is a searchable dropdown built with existing modal/DOM patterns | No external library (Select2, Choices.js). A text input with filtered suggestion list, styled with existing CSS tokens. Accessible with keyboard nav. Reuses `sanitizeHtml()` for item names displayed in the picker. | More implementation effort than a library, but zero-dependency is a project constraint and the interaction is simple enough (filter-by-text, click-to-select). |
| D-10 | Both ZIP CSV and standalone CSV are intentionally lossy for trade data — ZIP JSON is the full-fidelity path | ZIP CSV (34 columns) and standalone CSV (39 columns) are already out of alignment. Aligning them is a separate cleanup task. Two trade relationship columns (`Traded For UUIDs`, `Traded From UUID`) are added to standalone CSV export/import only. **Frozen trade values (`tradeValues` — meltValue, spotPrice, isCustom) do not survive standalone CSV round-trip** — this is intentional. Current CSV import reconstructs `disposition` from named scalar columns, not JSON blobs, so variable-cardinality nested maps don't fit the format. ZIP JSON backup covers full-fidelity round-trip including `tradeValues`. Tests should assert the intentionally lossy behavior (relationships preserved, values lost). | ZIP CSV users won't see trade columns, and standalone CSV users lose frozen trade values. But ZIP JSON in the same archive is lossless, and standalone CSV was already lossy for other nested disposition fields. A future alignment issue can add trade columns to ZIP CSV. |
| D-11 | Auto-fill via `computeMeltValue()` + `lookupHistoricalSpot()` with null-fallback | When items are linked, compute trade-time value using the existing helpers with the trade date's historical spot. If `lookupHistoricalSpot()` returns `null` (cache miss), show "—" and require manual entry. No current-spot fallback — that would produce inaccurate trade values for old dates. | Users disposing items with dates outside the spot-history-bundle coverage will need to enter values manually. This is the correct tradeoff: accurate data > convenient auto-fill. |
| D-12 | Conflict confirmation when re-linking an already-linked item | If a selected item already has `tradedFromUuid` set (linked to a different trade), show `showAppConfirm()` asking whether to move it. On confirm: clear the old trade's `tradedForUuids` entry, update the new trade's `tradedForUuids`, update the item's `tradedFromUuid`. Produces **3 Activity Log entries** (one per affected item: old trade, new trade, received item) — consistent with the D-7 per-operation undo pattern. Each entry is individually undoable. | Extra confirmation dialog and 3 log entries for a single user action, but prevents accidental data loss and maintains per-entry undo consistency. |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New
- _none_ — all changes fit within existing files

### Modified
- `index.html` — Add trade-linking section markup inside `#removeItemDisposeFields` (item picker, linked items list, value fields). Add `tradeProvenance` section placeholder in view modal template if needed.
- `js/inventory.js` — Extend `confirmRemoveItem()` full-stack and partial-stack paths to write `tradedForUuids` and `tradeValues` into `disposition` and set `tradedFromUuid` on each received item. Extend `restoreInPlace()` and `undoDisposition()` to clear trade links bidirectionally. Add helper functions: `linkTradeItems()`, `unlinkTradeItem()`, `clearTradeLinks()`.
- `js/viewModal.js` — Replace `_buildDispositionSection()` with trade-aware dispatcher. Add `_buildTradeSection()` for disposed items with links. Add provenance sub-block rendering inside the disposition builder for received items with `tradedFromUuid` (no new `sectionBuilders` key — provenance rides inside the existing `disposition` section). Add inline edit controls (add/remove links, value editing).
- `js/events.js` — Wire up trade-picker UI events (search input, suggestion list, item selection, remove button, "+ Add new item" action, save/cancel). Wire up unlink-from-received-side action. Wire up Edit Trade button in view modal.
- `js/utils.js` — Add `findItemByUuid(uuid)` helper (O(n) scan, returns item or null). Add `computeTradeValue(item, dateStr)` wrapper that calls `computeMeltValue()` with `lookupHistoricalSpot()`.
- `js/changeLog.js` — Add `"tradeLink"` field handling in `toggleChange()` for undo/redo of link edits. Extend `logItemChanges()` field list to include `tradedFromUuid`.
- `js/diff-engine.js` — Add `"tradedFromUuid"` to `DIFF_FIELDS` array.
- `js/cloud-sync.js` — Add `(item.tradedFromUuid || "")` to `computeInventoryHash()` content sample string.
- `js/inventory-backup.js` — Add `tradedFromUuid: item.tradedFromUuid || null` to ZIP JSON backup field map.
- `js/inventory-import.js` — Add `"Traded For UUIDs"` and `"Traded From UUID"` columns to standalone CSV export headers and row builder. Add parsing for these columns in CSV import. No changes to ZIP CSV (D-10).
- `js/types.js` — Update `InventoryItem` JSDoc typedef to document `tradedFromUuid` and `disposition.tradedForUuids` / `disposition.tradeValues`.
- `css/styles.css` — Trade section styling: comparison table, provenance line, item picker dropdown, value labels ("spot value" / "custom"), linked-item list with remove buttons. All using existing design tokens and theme variables. Existing disposition badge styling is at `css/styles.css:968-990`.
- `tests/playwright/core/disposition.spec.js` — New test block for trade-linking: create trade with links, verify view modal, edit links, unlink from received side, restore cleanup, partial-stack linking.
- `tests/playwright/core/import-export.spec.js` — Trade-link CSV round-trip tests (standalone CSV).
- `tests/playwright/core/attachments-cloud.spec.js` — Trade-link cloud sync hash visibility test (received-side-only edit produces hash change).

### Deleted
- _none_

## Data / Schema Changes

All changes are to the in-browser localStorage item model. No server/database changes.

### Disposed item — `disposition` object additions

```js
item.disposition = {
  // existing fields (unchanged)
  type: "traded",
  date: "2026-05-26",
  amount: 1850.00,
  currency: "USD",
  recipient: "TradePartner",
  notes: "...",
  realizedGainLoss: 150.00,
  disposedAt: "2026-05-26T...",
  splitFromUuid: "...",  // only if partial-stack

  // NEW — trade linking
  tradedForUuids: ["uuid-1", "uuid-2"],  // UUIDs of received items
  tradeValues: {                          // per-item frozen trade values
    "uuid-1": { meltValue: 925.00, spotPrice: 31.25, isCustom: false },
    "uuid-2": { meltValue: 925.00, spotPrice: 31.25, isCustom: false },
  },
};
```

### Received item — new top-level field

```js
item.tradedFromUuid = "disposed-item-uuid";  // or absent/null if not from a trade
```

### Backward compatibility

Both fields are optional. Items without them behave exactly as today. No migration needed — existing data is unaffected. The `disposition` object is already persisted as a JSON blob; adding keys to it requires no structural change to storage.

## Tradeoffs Surfaced for Review

1. **ZIP CSV stays lossy (D-10).** Trade columns are added to standalone CSV only. ZIP CSV is already missing 5 disposition columns. Full alignment is a separate task. The ZIP JSON backup in the same archive is lossless. **Accept or should we align ZIP CSV too?**

2. **No current-spot fallback for cache misses (D-11).** When `lookupHistoricalSpot()` returns `null`, the user must enter a value manually. Using current spot for an old trade date would produce inaccurate tax data. This is the conservative choice. **Acceptable?**

3. **Per-entry undo vs. cascaded undo for link edits (D-7).** Linking 5 items in one Edit Trade session produces 5 separate Activity Log entries, each individually undoable. An alternative would be transactionId-grouped cascade undo (like `splitInventoryItem`). The per-entry approach is simpler and the UX is acceptable for typical trade sizes (1-5 items). **Acceptable?**

## Out of Scope (follow-up issues)

- **ZIP CSV alignment** — aligning the 34-column ZIP CSV with the 39-column standalone CSV is pre-existing drift. Trade-linking shouldn't own this cleanup. File as a separate STRK issue.
- **Multi-event trade linking** — one trade = one dispose event (per Non-Goals). A follow-up could allow grouping multiple dispositions into a "trade bundle."
- **Trade analytics/reporting** — aggregated trade performance over time, trade history table, export. Natural follow-up once the base linking exists.
- **Bulk edit trade links** — per Non-Goals, trade links are per-item via the view modal.

## Risk Notes

- **Six-surface registration for `tradedFromUuid`** — the STAK-493 precedent shows that missing one surface causes silent data loss during sync. Tasks must enumerate each site as a separate acceptance check. Risk mitigation: the TDD test cohort will include a round-trip test for each surface before implementation begins.
- **Bidirectional consistency** — every mutation (link, unlink, restore, delete-via-splice) must update both sides in the same `saveInventory()` call. If the write is split across two saves, a crash or tab close between them creates one-sided orphans. Risk mitigation: all link mutations go through dedicated helper functions (`linkTradeItems`, `unlinkTradeItem`, `clearTradeLinks`) that enforce both-sides-then-save.
- **`safeGetElement` truthy dummy** — new DOM elements for the trade picker must use `instanceof HTMLElement` guards, not `if (!el)`, per the project convention (see CLAUDE.md). Risk mitigation: coding-standards pre-flight before implementation.
- **Partial-stack UUID binding** — when a trade is created during partial disposition, `tradedForUuids` and received items' `tradedFromUuid` must point to the *clone's* UUID (the disposed item), not the original's. The clone UUID is generated inside `splitInventoryItem()`. Risk mitigation: trade-link writes must happen **inside** `splitInventoryItem()` after `clone.uuid` is assigned but **before** `tryPersistInventory()` — the current split function persists inventory+changeLog before returning, so a post-return write from `confirmRemoveItem()` would create a second save boundary, violating the single-save/no-orphan contract. Implementation must either inject the trade-link writes into the split flow or refactor the split to accept a pre-persist callback.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch-review STRK-123 approach`, then `/sketch tasks STRK-123`.

## Review Archive — approach (2026-05-26)

_Reconciled by /sketch reconcile on 2026-05-26. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- Confirmed the dispose/restore/split flow in `js/inventory.js`: `confirmRemoveItem()` writes full-stack dispositions then calls `saveInventory()` (`js/inventory.js:856-974`), `restoreInPlace()` clears `disposition` and saves (`js/inventory.js:1016-1034`), and `splitInventoryItem()` assigns `clone.uuid` before building/persisting the clone disposition (`js/inventory.js:1119-1288`).
- Confirmed the view modal section registry and configured-order rendering in `js/viewModal.js:1130-1140` and `js/viewModal.js:1241-1258`, plus the default section ids in `js/constants.js:1337-1348`.
- Confirmed sync/export surfaces: `DIFF_FIELDS` includes `disposition` but not `tradedFromUuid` yet (`js/diff-engine.js:32-89`), `logItemChanges()` has the parallel field list (`js/changeLog.js:115-162`), `computeInventoryHash()` samples selected fields plus JSON `disposition` (`js/cloud-sync.js:125-134`), ZIP JSON backs up full `disposition` (`js/inventory-backup.js:26-74`), and standalone CSV currently uses named scalar disposition columns only (`js/inventory-import.js:1080-1181`, `js/inventory-import.js:369-425`, `js/inventory-import.js:1666-1703`).
- Confirmed `lookupHistoricalSpot()` exists in `js/spot.js:664-685` and `computeMeltValue()` exists in `js/utils.js:1457-1468`.
- Confirmed the file map's proposed core Playwright targets exist and are tracked in the coverage-map domains, but the stylesheet path should be `css/styles.css`, not `css/main.css`.

**Top concerns**

1. The approach currently says nested `disposition` additions round-trip through backup/CSV, but standalone CSV does not preserve arbitrary nested `disposition` fields today. This is the main data-loss risk for `tradeValues`.
2. `tradeProvenance` will not render if it is only added to `sectionBuilders`; the configured section list must also include the id or the content must ride inside an existing configured section.
3. `tradeLink` undo cannot use generic change-log scalar assignment. It needs explicit `toggleChange()` handling or a different entry shape, otherwise undo writes `item.tradeLink` instead of maintaining the two real relationship fields.

**Unverified assumptions**

- The product accepts standalone CSV being relationship-only but not frozen-value-complete; the approach asks about ZIP CSV lossiness but not standalone CSV `tradeValues` lossiness.
- The user wants provenance controlled as an independent configurable view-modal section rather than always appearing inside the existing Inventory/Disposition sections.
- Per-entry undo is acceptable after users create several links in one edit session; the approach compares it to split cascade but does not validate expected Activity Log density.
- Trade-link helpers can be integrated into the current partial-stack two-phase persistence flow without creating a second save boundary.
- Re-linking an already-linked item should move the item rather than require manual unlink first; the confirmation copy and audit semantics are not yet specified.

### Resolution Summary

- Accepted: 4 (CSS path fix, D-1 CSV coverage precision, D-6 toggleChange branch requirement, partial-stack timing constraint)
- Rejected: 0
- Resolved with your input: 3 (standalone CSV intentionally lossy for tradeValues, provenance inside disposition section, D-12 re-link produces 3 entries)
