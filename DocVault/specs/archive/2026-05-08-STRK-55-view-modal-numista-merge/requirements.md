---
sketch: "STRK-55-view-modal-numista-merge"
phase: requirements
created: 2026-05-08
---

# STRK-55 — Requirements

> **Source Issue:** [STRK-55](https://plane.lbruton.cc/lbruton/browse/STRK-55/)
>
> **Title:** View modal Catalog Data ignores `item.numistaData` (regression)
>
> **Summary:** The Item View modal renders its "Catalog Data" section purely from a Numista IndexedDB cache (`coinMetadata`, keyed by `catalogId`), ignoring user-saved values stored on the inventory item itself (`item.numistaData`). The Edit modal correctly persists user choices (incl. STRK-51 fields like obverseDesc/reverseDesc/edgeDesc/commemorative/mintage/rarityIndex/kmRef/length/width/denomination), but those edits never appear in the View modal — and obverse/reverse descriptions only render as image hover tooltips, never visible text. Two items sharing the same Numista N# show identical View data regardless of per-item edits. Surfaced during STRK-51 QA.

## Overview

The Item Detail (View) modal must reflect each item's saved Numista field values, not the shared Numista API/cache snapshot. Per-item edits must always win; cache values are a fallback when an item has no saved data. Obverse, reverse, and edge descriptions must be visible text in the Catalog Data section, with parity to the Edit modal (additive — keep image tooltips).

## User Stories

- **US-1:** As a stacker who customized a Numista field during import (e.g. unchecked "Composition" to keep my own value), I want the View modal to show **my** saved value, so that what I entered is what I see.
- **US-2:** As a collector inspecting a coin's history, I want the obverse, reverse, and edge descriptions visible in the Catalog Data section of the View modal, so that I can read them without hovering the image.
- **US-3:** As a stacker with two items that share the same Numista N# but have different per-item edits, I want each item's View modal to show its own values, so that the modals don't collapse into one shared snapshot.
- **US-4:** As a stacker who has edited a Numista field via the Edit modal, I want the View modal to show the updated value immediately on next open, so that there is no stale cache lag between edit and view.

## Acceptance Criteria

### AC-1 (maps to US-1)
- **Given** an item where `item.numistaData.composition === "Silver (.9999)"` and the IndexedDB `coinMetadata` cache for the same `catalogId` has `composition === "Silver"`,
- **When** the user opens the View modal for that item,
- **Then** the Catalog Data section renders **"Silver (.9999)"** (item value wins).

### AC-2 (maps to US-2)
- **Given** an item with non-empty `item.numistaData.obverseDesc`, `reverseDesc`, and/or `edgeDesc`,
- **When** the user opens the View modal,
- **Then** each non-empty description renders as a visible **full-width** detail row in the Catalog Data section, with labels "Obverse", "Reverse", and "Edge" respectively.
- **And** the existing image hover tooltips for obverseDesc/reverseDesc continue to function (additive, not replaced).

### AC-3 (maps to US-3)
- **Given** two inventory items A and B with the same `catalogId` (`N#571841`) but different `item.numistaData.composition` values,
- **When** the user opens the View modal for A, then closes and opens it for B,
- **Then** A and B render their own respective composition values.

### AC-4 (maps to US-4)
- **Given** an item whose `item.numistaData.diameter` was just changed from `39` to `40` via the Edit modal,
- **When** the user closes Edit and opens View,
- **Then** the Catalog Data section shows **"40 mm"** (no stale cache hit).

### AC-5 (field coverage parity)
- **Given** an item whose `item.numistaData` includes any of: `denomination`, `mintage`, `rarityIndex`, `kmRef`, `length`, `width`, `commemorative`, `commemorativeDesc`, `obverseDesc`, `reverseDesc`, `edgeDesc`, `country`, `composition`, `shape`, `diameter`, `thickness`, `orientation`, `technique`,
- **When** the View modal opens with that item,
- **Then** every populated field is rendered in the Catalog Data section (subject to the user's existing field-visibility config in Settings → Item Detail Modal).

### AC-6 (kmRef shape reconciliation)
- **Given** an item with `item.numistaData.kmRef === "KM#273"` (string, from Edit modal save),
- **When** the View modal opens,
- **Then** "KM Reference: KM#273" renders. The renderer must also still handle the cache-only `kmReferences` array shape for items without `item.numistaData.kmRef`.

### AC-7 (no regression on cache-only items)
- **Given** an item that was added before STRK-51 and has no `item.numistaData` saved (only the cache holds metadata),
- **When** the View modal opens,
- **Then** Catalog Data renders from the cache exactly as it does today — visible behavior is unchanged for legacy items.

### AC-8 (partial item metadata)
- **Given** an item with only some keys populated in `item.numistaData` (e.g. `{ kmRef: "KM#274" }` — `kmRef` user-customized, all other fields absent),
- **When** the View modal opens,
- **Then** the customized field renders the item value (`KM Reference: KM#274`), and **all other Catalog Data fields render from the cache** for that catalogId.
- **And** the IndexedDB cache TTL refresh continues to operate normally for the un-customized fields (cache freshness is independent of item-priority foreground render).

> CODEX: Consider an explicit edge case for "partial item metadata" rather than only all-item or no-item data. The proposed D-6 behavior treats any `item.numistaData` key as enough to suppress TTL/API refresh, so an item with only `kmRef` or only `obverseDesc` could keep falling back to a stale cache for every other field indefinitely. That may be acceptable, but it is user-visible and not covered by AC-1/AC-7 as written.
> → **RESOLVED:** added AC-8 above. Approach D-6 reworked: foreground render is item-over-cache; background cache refresh continues normally so partial items don't accumulate staleness. New B.1 test case verifies partial-item rendering + ongoing cache refresh.

## Non-Goals

- **Not** changing the import-modal checkbox/sync-toggle behavior — that is STRK-52 and lives in `js/catalog-api.js` / import flow, separate from this fix.
- **Not** changing the IndexedDB cache schema or `imageCache.cacheMetadata()` — the cache stays as-is; only the View renderer's read path changes.
- **Not** touching the Edit modal save path (`js/events.js` `parseNumistaFields`) — modal saves already write a normalized shape (empty values stripped). The merge helper handles import/clone bypass paths defensively rather than fixing them at source.
- **Not** introducing a per-item metadata cache or sync between cache and item — they remain independent stores.
- **Not** changing the Settings → Item Detail Modal field-visibility config — existing toggles continue to govern which fields render. Two new defaults (`obverse`, `reverse`) are added; that's additive, not a change to existing toggles.

> CODEX: The "right shape" assumption is true for modal saves, but not for every persistence path. JSON import preserves `raw.numistaData` directly before shallow sanitization (`inventory-import.js:1247-1280`; `utils.js:1016-1036`), and clone can carry `numistaData` wholesale. If stale or differently shaped `numistaData` is in scope for "what the user entered is what I see," add a note that imported/restored `numistaData` may bypass `parseNumistaDataFields` invariants.
> → **RESOLVED:** non-goal language tightened above. Approach D-1 mandates helper-side defensive empty-value stripping so the renderer is robust against unnormalized item.numistaData regardless of write path. Discovery's Existing Code table now lists `inventory-import.js` and `clone-picker.js` as alternate write paths.

## Open Questions

_Resolved during initial diagnosis; none block discovery._

- [x] Where does the Edit modal save Numista values? → `item.numistaData.*` (verified: `js/events.js:1331-1353`).
- [x] Where does the View modal currently read from? → `imageCache.getMetadata(catalogId)` then API fallback (verified: `js/viewModal.js:1052-1074`).
- [x] Are obverseDesc/reverseDesc currently rendered as text? → No, only as image `title` tooltips (verified: `js/viewModal.js:1146-1157`).

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-55`.
>
> V4-PRO (2026-05-08): **AC coverage is solid.** AC-8 (partial item metadata + ongoing TTL refresh) is the hardest to verify end-to-end because it requires observing `imageCache.cacheMetadata()` activity without re-rendering. The Playwright test (B.1 test 8) will need either a spy injection or IndexedDB read-before/after. This test case is the highest implementation risk in the entire sketch — see approach.md V4-PRO §6.
>
> V4-PRO: **Non-functional requirement missing.** The sketch does not address what happens when a user has BOTH `item.numistaData` AND the IndexedDB cache is empty (e.g., first load after clearing browser data). The current code returns early at `if (!meta) return` (line 1074). With the merge helper, an item with rich `numistaData` but no cache would render nothing — a regression for users who clear their cache but have per-item edits. The helper should handle the `cacheMeta`-is-null case: if cache is unavailable, render from item data alone.
>
> V4-PRO: **Tags-dedupe is not an AC.** The tasks file folds a tags-row removal into A.3 as "non-AC visible-behavior change." This is correct for discoverability (users see tags twice today) but it ships untestable against the requirements. Fine — just make sure the CHANGELOG and PR body call it out so it doesn't look like an accidental deletion.
