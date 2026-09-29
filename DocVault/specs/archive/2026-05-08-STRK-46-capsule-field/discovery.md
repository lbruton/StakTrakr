---
sketch: "STRK-46-capsule-field"
phase: discovery
created: 2026-05-08
---

# STRK-46 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on._

| Path                        | Role                                        | Notes                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.html:2513-2599`      | Catalog Data form section                   | `<div id="numistaDataSection">` — Diameter input at `:2565`, Thickness at `:2584`. Uses `grid grid-3-equal` layout. **Insertion point** for capsule fields near Diameter/Thickness cluster.                                                                                                                   |
| `js/events.js:1289-1310`    | Item object construction on save            | Builds item from form elements; `numistaData` assigned at `:1304` via `parseNumistaDataFields()`. Top-level capsule field would be added alongside `notes`, `tags`, etc.                                                                                                                                      |
| `js/events.js:1319-1349`    | `parseNumistaDataFields()`                  | Uses `getOrPrev(id, prevVal)` pattern. Clears fields on Numista catalog number change — critical evidence against nesting capsule here (user-entered data would be wiped).                                                                                                                                    |
| `js/inventory.js:1158-1182` | `populateNumistaDataFields()` fieldMap      | Maps form IDs → item/cache keys for Numista-sourced data. Pattern reference only — capsule shouldn't use this if top-level.                                                                                                                                                                                   |
| `js/viewModal.js:1167-1209` | View modal Catalog Data rendering           | `_section("Catalog Data")` at `:1168`, Diameter display at `:1191`. **Display insertion point** for capsule after Diameter/Thickness block.                                                                                                                                                                   |
| `js/search.js:81-100`       | Multi-word search `itemText` array          | Joins top-level fields for search. **Must extend** with `item.capsule \|\| ""` for AC-8.                                                                                                                                                                                                                      |
| `js/filters.js:1116-1138`   | Advanced filter `itemText` + searchCache    | Same field list pattern with caching. **Must extend** and invalidate cache for capsule.                                                                                                                                                                                                                       |
| `js/autocomplete.js`        | Existing autocomplete infrastructure        | `AUTOCOMPLETE_CONFIG` (maxSuggestions: 8, minCharacters: 2, threshold: 0.3), `PREBUILT_LOOKUP_DATA` array, `LookupTable` typedef. **Reuse target** for Air-Tite size autocomplete. Note: `extractUniqueValues` defaults `caseSensitive: false` — capsule extraction must opt in to `{ caseSensitive: true }`. |
| `js/constants.js:821-830`   | `SYNC_SCOPE_KEYS`                           | Includes `"metalInventory"` — cloud sync serializes full inventory blob. **No changes needed** for new item fields.                                                                                                                                                                                           |
| `js/constants.js:891+`      | `ALLOWED_STORAGE_KEYS` whitelist            | Capsule lives on items in `metalInventory`, not a separate key. **No changes needed.**                                                                                                                                                                                                                        |
| `js/clone-picker.js:82-89`  | `cloneItemDeep()`                           | Uses `structuredClone(item)` — auto-copies all fields. **No changes needed.** Section toggle at `:123` uses `numistaDataSection`.                                                                                                                                                                             |
| `js/card-view.js`           | Card view rendering                         | Confirmed: does NOT display Catalog Data fields (no diameter/thickness/catalog references). **No changes needed.**                                                                                                                                                                                            |
| `js/field-meta.js`          | `initFieldMeta()` per-field origin tracking | Less relevant — capsule is always manually entered, not Numista-sourced. May not need field-meta integration.                                                                                                                                                                                                 |

## Prior Decisions

_Search mem0 and recent sessions for related decisions._

- **No prior capsule work found.** First time touching this surface — no mem0 entries, no session history, no prior issues related to capsule fields.
- **Hybrid autocomplete approach decided in pre-sketch chat (2026-05-08):** small static Air-Tite mm-size table for autocomplete + diameter-based suggestion + user history. Not a full coin→capsule mapping database.
- **Top-level field preference emerged during research:** evidence from `parseNumistaDataFields` clear-on-change behavior, search array patterns using top-level fields, and `itemX` naming convention all point toward `item.capsule` rather than nesting in `numistaData`.

## External References

_Libraries, RFCs, design docs, third-party patterns worth borrowing from._

- [OnFireGuy Air-Tite Capsule Size Chart](https://onfireguy.com/pages/capsule-size-chart) — comprehensive diameter→model mapping for all Air-Tite series (A, H, I, X-Ring). Source for the static lookup table.
- [Air-Tite Official Size Guide](https://www.air-tites.com) — canonical model codes and diameter ranges. Direct Fit (A-series, by mm) and Ring Type (H/I/X with foam rings).
- [JP's Corner Capsule Reference](https://jpscorner.com) — community reference for capsule sizing. Confirms Air-Tite as dominant US brand.
- No open JSON/CSV dataset exists anywhere for coin capsule sizes — confirmed via extensive web search. Must curate ~25 Air-Tite entries manually.

## Constraints

_Things the implementation must respect._

- **Script load order:** `init.js` (defines `safeGetElement`) loads AFTER `events.js` (both `defer`). Top-level code in `events.js` must use `document.getElementById` directly. Runtime closures are fine.
- **`saveData()` / `loadData()` wrappers:** all localStorage writes go through `saveData()` which wraps in `JSON.stringify`. Always read back through `loadData()` / `loadDataSync()`. Raw `localStorage.getItem()` returns stringified payload.
- **Input ID naming convention:** top-level fields use `itemX` pattern (e.g., `itemNotes`, `itemTags`). Numista-sourced fields use `numistaX` (e.g., `numistaDiameter`). Capsule is user-entered, so should follow `itemCapsule` / `itemCapsuleNotes`.
- **Form layout integrity (AC-7):** the Catalog Data section uses `grid grid-3-equal` for Diameter/Thickness/Orientation. Adding fields must not disrupt this layout on desktop or mobile.
- **`ALLOWED_STORAGE_KEYS` whitelist:** any new top-level localStorage key must be registered. But capsule fields live on items within `metalInventory`, so no new key needed.
- **`structuredClone` in clone-picker:** auto-copies all item fields — new fields need no explicit handling.
- **Cloud sync scope:** `SYNC_SCOPE_KEYS` includes `metalInventory` — new fields on items are synced automatically.

## Open Questions

_Things that need answering before approach.md can be written._

- [x] **Top-level `item.capsule` vs nested `item.numistaData.capsule`?**
      → **Resolved: top-level.** Three lines of evidence:
  1. `parseNumistaDataFields()` clears all nested fields when the Numista catalog number changes — this would wipe user-entered capsule data.
  2. Search arrays (`search.js:81-100`, `filters.js:1116-1138`) join top-level fields — nesting would require a different access pattern.
  3. Naming convention: user-entered fields are `itemX` (`itemNotes`, `itemTags`); Numista-sourced fields are `numistaX`. Capsule is user-entered.

- [x] **Pre-load a capsule dataset or let users populate?**
      → **Resolved: Hybrid.** Small static Air-Tite mm-size table (~25 entries) for autocomplete suggestions + diameter-based nearest-match suggestion + user's previously-entered capsule values. No full coin→capsule mapping.

- [x] **Which capsule brands to support in the static table?**
      → **Resolved: Air-Tite only.** Dominant US brand. Field accepts any text, so Lighthouse/Guardhouse/generic mm values work fine as typed input.

- [x] **Where in the UI?**
      → **Resolved: Catalog Data section** of Edit/Create modals, near Diameter/Thickness (per issue description and requirements AC-7).

## Discovery Summary

The capsule feature has a clean integration path. New fields (`capsule`, `capsuleNotes`) go top-level on items — cloud sync, clone-picker, and structured-clone all auto-handle them without code changes. The main work is: (1) HTML form inputs in the Catalog Data section near Diameter/Thickness, (2) item construction in `events.js`, (3) view modal rendering in `viewModal.js`, (4) a small static Air-Tite lookup table + diameter→suggestion logic, (5) autocomplete integration reusing `autocomplete.js` infrastructure, and (6) search index extension in both `search.js` and `filters.js`. The trickiest part is the autocomplete UX — merging static Air-Tite sizes with user history into a single dropdown — but `autocomplete.js` already has the infrastructure pattern (`PREBUILT_LOOKUP_DATA`, `LookupTable` typedef).

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-46`.
