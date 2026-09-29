---
sketch: "STRK-123-trade-linking"
phase: discovery
created: 2026-05-26
---

# STRK-123 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on. Include paths and a one-line note on each._

| Path                                                  | Role                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html:8298`                                     | Remove Item modal markup           | Existing dispose UI contains type/date/amount/recipient/notes. Trade linking needs a new optional section inside `#removeItemDisposeFields` without disturbing non-trade dispose/delete controls.                                                                                                                                                                                                                                                                       |
| `js/inventory.js:747`                                 | Opens and resets Remove Item modal | `openRemoveItemModal()` resets disposition fields, quantity controls, and amount mode before opening the modal. Any trade-link UI state must be reset here too.                                                                                                                                                                                                                                                                                                         |
| `js/inventory.js:856`                                 | Confirms delete/dispose flow       | `confirmRemoveItem()` validates disposition fields, resolves amount mode, splits partial stacks, writes full-stack disposition records, saves inventory, and logs `"Disposed"`. Trade-link persistence must hook into both partial and full-stack paths.                                                                                                                                                                                                                |
| `js/inventory.js:1016`                                | Restores disposed items            | `restoreInPlace()` clears `item.disposition` and logs `"Disposition Undone"`; `undoDisposition()` has a separate partial-stack merge/separate path. Trade-link cleanup on restore must cover both paths.                                                                                                                                                                                                                                                                |
| `js/inventory.js:1119`                                | Partial-stack disposition clone    | `splitInventoryItem()` creates a cloned disposed item with a new UUID and `disposition.splitFromUuid`, then commits inventory and change-log entries transactionally. The clone is `splice`d in at `originalIdx + 1` (line 1179), shifting all subsequent indices. Trade links created during partial disposition attach to the clone's UUID, not the remaining active source row — received items' `tradedFromUuid` must bind to `clone.uuid` in the same transaction. |
| `js/viewModal.js:739`                                 | Existing disposition section       | `_buildDispositionSection()` renders the generic "Disposition" section, amount, optional recipient/notes, and realized gain/loss. Trade-specific rendering belongs around this section boundary.                                                                                                                                                                                                                                                                        |
| `js/viewModal.js:598`                                 | Current valuation section          | `_buildValuationSection()` already computes purchase, melt, retail, gain/loss, and premium data via `computeItemValuation()`. Trade comparison can reuse the same valuation semantics for linked items.                                                                                                                                                                                                                                                                 |
| `js/viewModal.js:1241`                                | View modal section assembly        | `buildViewContent()` registers section builders, including `disposition`, then calls `_appendSectionsInConfiguredOrder()`. Prior line ranges for this area are stale; current disposition builder registration is at `js/viewModal.js:1247-1258`.                                                                                                                                                                                                                       |
| `js/utils.js:1457`                                    | Melt value helper                  | `computeMeltValue(item, spot)` centralizes `weightOz * qty * spot * purity`, including Goldback/Silverback unit conversion. AC-8 should reuse this rather than duplicating formula logic.                                                                                                                                                                                                                                                                               |
| `js/utils.js:1499`                                    | Retail value helper                | `calculateRetailPrice()` and `computeItemValuation()` normalize current melt/retail/gain-loss display, including manual retail and Goldback denomination pricing.                                                                                                                                                                                                                                                                                                       |
| `js/spot.js:664`                                      | Historical spot lookup             | `lookupHistoricalSpot(metalName, dateStr)` is synchronous and cache-only. It returns `null` when year data is missing and searches exact, +/-1d, +/-3d, then +/-7d windows. Cache is populated from `data/spot-history-bundle.js` via `_loadSpotSeedBundle()` (`js/spot.js:1539-1565`) and from live year-file fetches. Cache-miss only occurs for dates outside bundle coverage and unfetched years.                                                                   |
| `data/spot-history-bundle.js`                         | Historical spot seed data          | Compact `{ year: { metal: [[MM-DD, price], ...] } }` bundle loaded at startup via `window._loadSpotSeedBundle`. Provides the `historicalDataCache` entries that `lookupHistoricalSpot` searches. Rebuilt by `/update-spot-bundle` before each release.                                                                                                                                                                                                                  |
| `js/changeLog.js:40`                                  | Simple change logging              | `logChange()` writes one change entry and persists `changeLog`; current full-stack dispose and restore use this legacy path.                                                                                                                                                                                                                                                                                                                                            |
| `js/changeLog.js:115`                                 | Structured item diff logging       | `logItemChanges()` compares user-editable fields and already treats `disposition` as an object field. It maintains its own field allowlist (distinct from `DIFF_FIELDS` at `js/diff-engine.js:32` — two separate edit sites). Nested `disposition.tradedForUuids` is automatically captured by both, but a top-level `tradedFromUuid` must be added explicitly to both lists.                                                                                           |
| `js/changeLog.js:495`                                 | Undo/redo router                   | `toggleChange()` handles Added/Deleted/Disposed and generic scalar-field undo. Relationship changes that touch two items need explicit logging semantics, not only a scalar field assignment.                                                                                                                                                                                                                                                                           |
| `js/diff-engine.js:32`                                | Sync diff field allowlist          | `DIFF_FIELDS` includes `disposition` but not `tradedFromUuid`; matched-item cloud diffs will ignore a new top-level received-side field unless it is added here.                                                                                                                                                                                                                                                                                                        |
| `js/cloud-sync.js:114`                                | Inventory hash fingerprint         | `computeInventoryHash()` hashes image URLs, Numista ID, grade, and `disposition`, but not arbitrary top-level relationship fields. Received-side-only edits require hash coverage.                                                                                                                                                                                                                                                                                      |
| `js/inventory-backup.js:24`                           | ZIP JSON backup shape              | `inventory_data.json` is built from an explicit field list and includes `disposition`, but not `tradedFromUuid` or any top-level trade metadata.                                                                                                                                                                                                                                                                                                                        |
| `js/inventory-backup.js:145`                          | ZIP CSV export shape               | ZIP `inventory_export.csv` has a separate explicit CSV header list (34 columns) that is **not aligned** with standalone CSV (39 columns) — omits Disposition Recipient, Notes, Currency, DisposedAt, and Split From UUID. This is a pre-existing inconsistency. Approach must decide: (a) widen ZIP CSV to match standalone then add trade columns to both, or (b) add trade columns only to standalone and accept ZIP CSV as a lossy snapshot.                         |
| `js/inventory-import.js:360`                          | CSV import parser                  | CSV import reads disposition columns into a nested `disposition` object and builds item records through `sanitizeImportedItem()`. It currently has no trade-link columns — `disposition.tradedForUuids` and top-level `tradedFromUuid` parsing are missing at `:369-426`. Without these, import will silently drop trade relationships.                                                                                                                                 |
| `js/inventory-import.js:1080`                         | Standalone CSV export              | `buildCsvContent()` exports disposition columns including `splitFromUuid`; new trade-link fields need round-trip columns here.                                                                                                                                                                                                                                                                                                                                          |
| `js/events.js:1775`                                   | Add/Edit item commit               | `commitItemToInventory()` creates new UUIDs for normal Add Item saves and logs Added/Edit changes. Called from a single save path at `js/events.js:2289` (Add/Edit submit handler). Line 2427 comments "commitItemToInventory() has already run, so savedItem.uuid is stable" — this is the natural UUID-capture handoff point for a trade-picker flow that auto-links a newly added received item.                                                                     |
| `js/types.js:1`                                       | JSDoc item schema                  | The current typedef does not document `disposition`, `tradedFromUuid`, or future trade value metadata. Schema documentation is already behind the live model and should be updated during implementation.                                                                                                                                                                                                                                                               |
| `tests/playwright/core/disposition.spec.js:296`       | Core disposition coverage          | Existing tests cover partial dispose, amount math, cascade undo, restore choices, sync push scheduling, CSV round-trip, and disposition rendering. This is the natural home for trade-link behavior tests.                                                                                                                                                                                                                                                              |
| `tests/playwright/core/import-export.spec.js:62`      | Core backup/export coverage        | Existing ZIP/CSV tests verify explicit field preservation and should cover trade-link fields to prevent money-data loss.                                                                                                                                                                                                                                                                                                                                                |
| `tests/playwright/core/attachments-cloud.spec.js:151` | Core cloud sync coverage           | Main `test.describe("core/attachments-cloud")` block starting at :151. Existing cloud tests cover sync-visible metadata and manifest behavior. New trade-link sync/hash tests should anchor here or in a dedicated block, not at the narrowly-scoped tag-merge test at :420.                                                                                                                                                                                            |
| `playground/STRK-123-trade-linking.html:1`            | Local UI mockup                    | Untracked local HTML mockup exists in the repo. Useful as visual prior art, but it is not a source-of-truth artifact and should not be committed accidentally unless intentionally adopted.                                                                                                                                                                                                                                                                             |

## Prior Decisions

_Search mem0 and recent sessions for related decisions. Quote the relevant memory or commit, with date._

- Requirements are already reconciled in `requirements.md` under `## Review Archive — requirements (2026-05-26)`. Accepted decisions include: optional linking, one trade event per source disposition, active received-side compact provenance, post-disposal editing from both sides, conflict confirmation when moving a received item between trades, restore cleanup, and Activity Log entries for link changes.
- DocVault `Foundation/Deep Dives/Data Model.md` says inventory is localStorage-backed browser state; `meltValue` is never stored; `disposition` is stored on the item and `realizedGainLoss` is computed once at disposition time.
- DocVault `Foundation/cloud-sync.md` says `saveInventory()` triggers debounced cloud push and that `cloud-sync.js` patches must preserve the atomic rollback pattern.
- Memory note: prior disposition sketches carried stale `viewModal.js` line ranges; verify live source before drafting tasks. Current verified registration point is `buildViewContent()` at `js/viewModal.js:1241-1264`, not older `1117-1123` references.

## External References

_Libraries, RFCs, design docs, third-party patterns worth borrowing from._

- No new external library appears necessary. The app is a no-build vanilla JS SPA; existing helpers (`safeGetElement`, `showAppConfirm`, modal utilities, `computeMeltValue`, `lookupHistoricalSpot`, `computeItemValuation`) cover the needed primitives.
- Local visual prior art: `playground/STRK-123-trade-linking.html` contains a dark-theme trade-linking mockup using StakTrakr-like tokens. Treat it as exploratory UI reference only.

## Constraints

_Things the implementation must respect: existing APIs, performance budgets, browser support, data shapes._

- The app is zero-build vanilla JS with strict script load order. New JS files require registration in `index.html` and `sw.js`; otherwise prefer existing modules when scope is small.
- DOM lookups in new app code should use `safeGetElement()` except where real absence must be detected. User-entered item names, notes, recipients, and trade-link labels must be sanitized before `innerHTML`.
- `disposition.type === "traded"` already requires a positive amount. The current validation message is shared with sold/refund paths.
- Full-stack and partial-stack disposition paths are different. Full-stack mutates the existing item in place; partial-stack creates a disposed clone with a new UUID and leaves the original active item behind.
- Link cleanup must be bidirectional and transactional enough that `disposition.tradedForUuids` and received-item `tradedFromUuid` cannot drift after save, restore, undo, delete, CSV import, or cloud merge.
- `lookupHistoricalSpot()` is cache-only and can return `null`; trade-value auto-fill must handle cache misses as first-class behavior.
- Current valuation helpers compute current melt/retail totals; storing current values would violate the data model. Only frozen trade-time values or user overrides should persist.
- New top-level item fields must be added to **six distinct surfaces** (two are easily conflated): (1) `DIFF_FIELDS` at `js/diff-engine.js:32`, (2) `logItemChanges()` field allowlist at `js/changeLog.js:115` (separate list, separate file — comment says "must match DIFF_FIELDS" but they are physically independent), (3) CSV import at `js/inventory-import.js:360`, (4) standalone CSV export at `js/inventory-import.js:1080`, (5) ZIP JSON backup at `js/inventory-backup.js:26`, (6) cloud hash sample at `js/cloud-sync.js:114`.
- A nested `disposition` addition is already deep-compared and included in cloud hash (the whole `disposition` object is `JSON.stringify`'d into the sample), but received-side-only changes are not covered unless `tradedFromUuid` is added to the relevant top-level field lists.
- ZIP backup has two inventories: JSON `inventory_data.json` and generated `inventory_export.csv`; standalone CSV has a separate header list. **Pre-existing drift:** ZIP CSV has 34 columns, standalone CSV has 39 (missing Disposition Recipient, Notes, Currency, DisposedAt, Split From UUID). Approach must decide: (a) align both first then add trade columns, or (b) accept ZIP CSV as a lossy snapshot and add trade columns only to standalone.
- Activity Log undo currently handles scalar item fields generically and special-cases Added/Deleted/Disposed. A link edit touches at least two inventory records, so a naive single scalar log entry is not enough for reliable undo.
- Existing core Playwright disposition and import/export suites are large but already cover this feature's risk surfaces. Updating `tests/playwright/coverage-map.csv` is required if a new test file is added.
- **UUID-vs-index discipline:** Every trade-link surface (UI selection, save handler, undo, sync merge) must address items by `uuid`, never by inventory index. Partial-stack `splitInventoryItem` inserts the clone at `originalIdx + 1` (`js/inventory.js:1179`), shifting all subsequent indices — index snapshots go stale after the splice.
- **Value-freezing sites:** `realizedGainLoss` is computed once and stored at `js/inventory.js:957` (full-stack) and `:1161-1173` (partial-stack). Approach must mirror this exact freeze pattern for trade-time melt/retail values: store at disposition time, never recompute on render.
- **JSON backup field mapping:** `createBackupZip` (`js/inventory-backup.js:26-74`) explicitly maps `inventory_data.json` properties. New top-level fields like `tradedFromUuid` must be added here or backup round-trips silently lose trade data.
- **`tradedForUuids` is a working name** — discovery uses it as a placeholder for the disposed-side array field. Approach must evaluate alternatives and confirm the chosen storage shape deliberately.
- **`tradedForUuids` array size under localStorage/JSON limits:** A single trade event could link many received items. Approach must consider whether an unbounded UUID array in `disposition` could hit serialization or localStorage quota issues for power users.
- **`undoDisposition` cascade cleanup:** `undoDisposition` merges clones back and cascades tag/image cleanup. Any trade-link references on the received side (`tradedFromUuid`) must be cleared in the same undo transaction to prevent orphaned pointers.

## Open Questions

_Things that need answering before approach.md can be written. If non-empty, stop here and resolve with the user._

- None blocking. Approach must still choose the exact stored shape for per-linked-item trade-time value metadata and its undo payload, but discovery found the constraints that decision must satisfy: frozen value must be persisted, current melt/retail must stay computed, and received-side-only edits must be sync-visible.

## Discovery Summary

_2–3 sentences: where the work will land, what looks tricky, what's already easy._

STRK-123 lands primarily in the existing disposition flow (`index.html`, `js/inventory.js`), view modal rendering (`js/viewModal.js`), valuation helpers (`js/utils.js`, `js/spot.js`), and persistence/sync surfaces (`js/inventory-import.js`, `js/inventory-backup.js`, `js/cloud-sync.js`, `js/diff-engine.js`, `js/changeLog.js`). The hard parts are lifecycle consistency and undoability: partial vs full disposition, restore/redo/delete behavior, and bidirectional link updates across two item records. The easy parts are value calculation and current-value display because `computeMeltValue()`, `lookupHistoricalSpot()`, and `computeItemValuation()` already provide the core math.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-123`.

## Review Archive — discovery (2026-05-26)

_Reconciled by /sketch reconcile on 2026-05-26. Original reviewer marks preserved below for audit._

### Opus

#### Verified

Spot-checked every cited file/line against the live codebase. All major anchors check out; line numbers for source files are accurate or very close. Specifically confirmed:

- `index.html:8298` opens the `#removeItemModal` block; `#removeItemDisposeFields` is at 8347 inside it — discovery's anchor at 8298 is the correct modal-wide entry point.
- `js/inventory.js:747` (`openRemoveItemModal`), `:856` (`confirmRemoveItem`), `:1016` (`restoreInPlace`), `:1036` (`undoDisposition`), `:1119` (`splitInventoryItem`) all match.
- `js/viewModal.js:598` (`_buildValuationSection`), `:739` (`_buildDispositionSection`), `:1241` (`buildViewContent`) all match; disposition section builder is registered at `:1257`.
- `js/utils.js:1457` (`computeMeltValue`) — confirmed it handles `gb`/`sb` weightUnit conversion via `GB_TO_OZT`/`SB_TO_OZT`.
- `js/utils.js:1499` (`calculateRetailPrice`), `:1538` (`computeItemValuation`) — both compute current melt/retail/gain-loss as discovery describes.
- `js/spot.js:664` (`lookupHistoricalSpot`) — confirmed cache-only, returns `null` on missing year data, scans windows `[0, ±1d, ±3d, ±7d]`.
- `js/changeLog.js:40` (`logChange`), `:115` (`logItemChanges`), `:495` (`toggleChange`) all match.
- `js/diff-engine.js:32` (`DIFF_FIELDS`) — verified `disposition` is in the list (line 73); no `tradedFromUuid`.
- `js/cloud-sync.js:114` (`computeInventoryHash`) — confirmed content sample is `obverseImageUrl|reverseImageUrl|numistaId|grade|JSON.stringify(disposition)`. A nested `disposition.tradedForUuids` WOULD be covered (because the whole disposition object is JSON-serialized into the sample). A top-level `tradedFromUuid` would NOT be covered without an explicit code change. Discovery's claim is correct.
- `js/inventory-backup.js:23-75` (JSON shape) and `:146-181` (CSV header). ZIP CSV has 34 columns; standalone CSV at `js/inventory-import.js:1082-1122` has 39 columns. Discovery's "they must remain aligned" claim is correct but understates that they are already _not_ aligned.
- `js/inventory-import.js:355-426` (CSV import disposition parsing) — matches discovery's description.
- `js/events.js:1775` (`commitItemToInventory`) matches.
- `js/types.js` — confirmed the `InventoryItem` typedef does not document `disposition` (the prior drift bullet is accurate).
- `js/constants.js:507` — `DISPOSITION_TYPES.traded` has `requiresAmount: true`. Discovery's claim is correct.
- `playground/STRK-123-trade-linking.html` exists as `??` (untracked) per `git status`.

#### Top concerns

1. **Implicit UUID-vs-index rule**. The partial-stack `splitInventoryItem` inserts the disposed clone at `originalIdx + 1` (`js/inventory.js:1179`), shifting every subsequent inventory index. Approach.md must codify "trade-link IDs are UUIDs, never indices" — otherwise any selection-time index snapshot can silently point to the wrong item after the split commits. Discovery hints at this but doesn't state it.
2. **`logItemChanges()` vs `DIFF_FIELDS` are two separate lists in two files**. Discovery's Constraints bullet `"DIFF_FIELDS, logItemChanges() fields, …"` reads like one item but is actually two physically distinct allowlists at `js/diff-engine.js:32` and `js/changeLog.js:115`. Either could ship with the trade field added and the other forgotten — STAK-493 precedent shows this exact failure mode. Approach.md should enumerate them as separate change sites.
3. **ZIP CSV vs standalone CSV are already out of alignment** (34 vs 39 columns). Discovery says trade columns must be added "in both places," but the two header lists are not currently aligned even for existing disposition fields. Approach.md needs to explicitly pick an option: align both header lists first (preferred), or accept that ZIP CSV remains a lossy snapshot and add trade columns only to standalone CSV.

#### OPUS — Unverified Assumptions

- That the `commitItemToInventory()` "+ Add new item" → auto-link handoff at `js/events.js:1775` has a single deterministic post-commit hook. `events.js` is ~4,944 lines and `commitItemToInventory` is called from multiple Add Item paths (modal save, bulk add). Approach should identify _which_ call site receives the auto-link signal and whether the trade-picker modal needs its own dedicated callback rather than re-entering the normal Add Item flow.
- That mem0 / sessionflow contains no prior trade-linking decisions or aborted prototypes. Discovery's Prior Decisions bullets cite mem0 only for the disposition stale-line-numbers note. A explicit search for `tradedFromUuid`, `tradedForUuids`, `trade linking`, `STRK-123` across sessionflow would either close this assumption or surface prior thinking. (I did not search; recommend the originating agent do so before approach.md is written.)
- That `lookupHistoricalSpot()`'s cache contains spot history covering the dates users will dispose from. Cache-miss is treated as "first-class behavior" per Constraints, but discovery doesn't quantify how common the miss case is for typical historical dates — the approach must decide between (a) showing "no historical price; enter manually," (b) using current spot with a UI warning, or (c) querying `spot-history-bundle.js` synchronously. The bundle file is not referenced in Existing Code.
- That no other modules read explicit top-level item fields via their own allowlist. I verified `DIFF_FIELDS`, `logItemChanges()` fields, ZIP JSON, ZIP CSV, standalone CSV, `computeInventoryHash` content sample. Not verified: search indexers, tag filters, undo-stack serializers, attachment manifests, or any future export tier (PDF report). A grep for `DIFF_FIELDS|computeInventoryHash|inventoryHash|item\.disposition` across all `js/*.js` before tasks.md would close this.
- That `disposition.tradedForUuids` is the chosen storage shape on the disposed side. Discovery leaves the exact shape to approach.md (Open Questions, line 81) but the Constraints bullets refer to `disposition.tradedForUuids` by name (line 68) as if already chosen. Approach should either confirm the name or list the alternatives (`disposition.tradeLinks`, `disposition.receivedUuids`, etc.) and pick deliberately.
- That `safeGetElement()` is appropriate for the new trade-picker UI. Global CLAUDE.md / project notes say `safeGetElement()` returns a _truthy dummy_ element rather than null when the ID is missing — see `feedback_safeGetElement_truthy_dummy.md` in auto-memory. Trade-picker code that does `if (!el) return;` will silently fail; the approach must specify `instanceof HTMLElement` guards or assert pattern for the new elements.

### AGY

#### Verified

Verified all references against the live codebase:

- Modal and fields markup are verified at `index.html:8298` (Remove Item modal) and `8347` (fields wrapper).
- Core disposition handlers are verified in `js/inventory.js` at `:747` (`openRemoveItemModal`), `:856` (`confirmRemoveItem`), `:1016` (`restoreInPlace`), `:1119` (`splitInventoryItem`).
- Valuation functions are verified in `js/utils.js` at `:1457` (`computeMeltValue`), `:1499` (`calculateRetailPrice`), and `:1538` (`computeItemValuation`).
- Diff and sync arrays verified at `js/diff-engine.js:32` (`DIFF_FIELDS`), `js/cloud-sync.js:114` (`computeInventoryHash`), and `js/changeLog.js:115` (`logItemChanges` fields).
- CSV export/import mappings verified at `js/inventory-backup.js:146` (34 columns) and `js/inventory-import.js:1082` (39 columns).
- Playwright specs verified at `tests/playwright/core/disposition.spec.js:296`, `tests/playwright/core/import-export.spec.js:62`, and `tests/playwright/core/attachments-cloud.spec.js:420` (narrow tag-merge test).

#### Top concerns

1. **Silent Data Loss in CSV Round-trip**: Standalone CSV export/import and ZIP CSV export omit `disposition.tradedForUuids` and top-level `tradedFromUuid`. These columns must be added to preserve trade relationships across file migrations.
2. **Silent Data Loss in JSON Backups**: `createBackupZip` in `js/inventory-backup.js:26` does not serialize `tradedFromUuid` into `inventory_data.json`, which breaks backup recovery.
3. **Trade Link Relocation on Stack Split**: Partial stack disposition splits the stack and inserts a cloned disposed item with a new UUID. Any trade links (received items' `tradedFromUuid`) must be updated to target the clone's UUID rather than the original item's UUID in the split transaction.

#### AGY — Unverified Assumptions

- That `disposition.tradedForUuids` will not hit serialization length bounds if many items are bundled in a trade.
- That the search indexer does not need updates to ignore or index `tradedFromUuid` for local query performance.
- That `undoDisposition` (which merges clones back) will successfully cascade tag/image cleanup without leaving orphaned trade-link references on the received side.

### Resolution Summary

- Accepted: 9
- Rejected: 3 (no prior trade-linking decisions exist; field-allowlist grep exhaustive; no search indexer in project)
- Resolved with your input: 3 (tradedForUuids left as working name for approach; call site detail added; serialization + cascade concerns added as constraints)
