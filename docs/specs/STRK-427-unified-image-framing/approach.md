---
spec: "STRK-427-unified-image-framing"
phase: approach
created: 2026-10-10
---

# STRK-427 — Approach

_How we'll build it. No code and no tests here; the `tasks` phase produces the work plan and its order. Inputs: `requirements.md` (corrected 2026-10-10) and `discovery.md`. Evidence for every claim about current code is in `discovery.md`; this file cites it by section rather than repeating it._

## High-Level Architecture

One new module, `js/image-frame-editor.js`, owns the **presentation and state** of image framing: the shared shape control, one portrait/landscape control per side, the live-shaped preview frames, and the swap of per-side orientation. It does not own any image I/O. Both hosts (the Add/Edit Item modal in `events.js`/`inventory.js` and the Edit Collection builder in `collections-picker.js`) keep their own Upload, URL, Camera, Remove and persistence code and mount the editor into **slots** that their own markup provides (`data-ife-*` hooks). Because hosts keep their DOM, every id and class that existing core tests pin (`#itemImagePreviewImg{Obv,Rev}`, `#swapImagesBtn`, `.collections-builder-covers .collections-image-pick`, …) stays where it is, and the item modal's swap race guards (`_pendingItemImageSwap`, generation token, `inert`) remain in `events.js` untouched (AC-1.3).

The pure rules live in `js/image-frame.js`, which already loads before `inventory.js`, `events.js` and every Collections script: `deriveImageShape(signals)` (the one resolver, AC-4.1/4.2), the orientation default and enum normalizers, a **reader** that resolves an item's shape and per-side orientation (new fields, else legacy `*ImageFrame`, else derived), and a **writer** that turns the editor's final state into the sparse fields to store and the legacy projection to dual-write. `collections-core.js` stays pure and DOM-free: its `defaultImageShapeForType` delegates to `window.deriveImageShape` through the same fail-closed `window` seam it already uses for `getUnitOztWeight`, and the unit harness loads the real `image-frame.js` the way it loads the real `utils.js`. Everything pure is unit-testable in Node.

Item persistence is sparse and additive. Three optional fields (`imageShape`, `obverseImageOrientation`, `reverseImageOrientation`) are stored only when the user's choice **deviates from the derived default**, together with the legacy `*ImageFrame` projection for older builds. Collections gain one definition key, `reverseImageOrientation`, canonicalised away when it equals the obverse value. The new fields are registered at every enumeration site the discovery lists (diff, change log, hash, ZIP, JSON, CSV, types). **P1** ships the editor, the resolver, storage, sync/import/export, and the five Collections surfaces; item **renderers are untouched in P1** and keep reading the legacy binary resolver. **P2** moves the table, cards and view modal onto the shared frames.

## Key Decisions

| # | Decision | Rationale | Tradeoff accepted |
|---|----------|-----------|-------------------|
| D-1 | The resolver is a pure `deriveImageShape(signals)` in `js/image-frame.js`, with the AC-4.2 order: grading, then Type, then Coin-only Numista, else Round. `collectionsCore.defaultImageShapeForType` becomes a thin wrapper that calls `window.deriveImageShape({type})` and **fails closed to Round** when the seam is absent. The picker's inline map and `suggestedShape` are deleted. | One source for items and Collections (AC-4.1). `image-frame.js` is already ahead of every consumer in load order (`index.html:8965` vs Collections at 9019), and the `getUnitOztWeight` seam is the repo's own precedent for core-to-global dependencies. | The pure core now depends on a global and on load order. Mitigated by the fail-closed default and by a harness that loads the real file. Rejected alternatives: a copy in the core (two maps again) and a new pure file (one more registry entry for no gain). |
| D-2 | **Store only a deviation from the derived default.** `imageShape` is written iff the final shape differs from `deriveImageShape(final signals)`. Orientation is written iff the shape is Bar or Note **and** the value differs from that shape's default (Bar portrait, Note landscape). Non-rotating final shape: both orientation keys are removed. | Satisfies AC-7.1 ("derived values never stored") with one deterministic rule, keeps sparse items following Type (AC-8.1), and gives users a reset path with no "Auto" option: pick the shape the Type already implies. | An explicit choice that equals today's default is not pinned; if the Numista shape or grade later changes the default, that item follows it. Accepted and documented (AC-4.3 already makes it follow a Type change). |
| D-3 | **Reader precedence** (AC-8.1/8.2): valid new field, else legacy mapped, else derived. Legacy mapping uses the **obverse** field only (AC-8.4): `circle` becomes Round; `rectangle` becomes `deriveImageShape` of the item **if that is not Round, else Bar**. The reverse legacy value is ignored on read. Values are validated against the enums; anything else reads as absent. | The AC-8.1 literal text yields Round for an ungraded round Coin, which reverses the user's stored intent (today `rectangle` renders rect, `image-frame.js:33-36`). Bar is the nearest rectangular frame and matches the existing `bar-shape` class name. | A legacy `rectangle` on a plain Coin becomes Bar (portrait default) in the editor and, in P2, in the renderers; this fills a gap in AC-8.1 and is flagged for review. |
| D-4 | **Writer and legacy projection.** When `imageShape` is stored, write `obverseImageFrame` and `reverseImageFrame` both as `circle` (Round) or `rectangle` (anything else). When the final state is sparse, `delete` both legacy keys (the STRK-67 D-11 discipline at `events.js:1930-1931`, extended to the new keys). On the **edit** path, write or delete only when the editor is **dirty** (shape or orientation differs from its seed); an untouched legacy item, including a mixed pair, keeps its legacy fields exactly. The **add/clone** path always applies the writer. | Resolves "unchanged edit" and "mixed legacy sides" without a silent lossy rewrite on an unrelated edit (AC-8.5: migrate only on user action). | A dirty save overwrites a mixed legacy pair with one projection; older builds then render both sides alike. Documented in the matrix (I-8). |
| D-5 | **Value-based Type following** replaces the `imageShapeTouched` flag. Whenever a signal (Type, `gradingAuthority`, Numista shape) changes, the editor computes the shape the **previous** signals derived; if the current shape equals it, the shape re-derives, otherwise it stays (AC-4.3/4.4/4.5/4.6). A shape change, by any cause, restarts that shape's orientation at its default (AC-4.8); a re-derive to the same shape keeps the orientation. | Deterministic, needs no per-session flag, and matches `updateCustomDefinition` (`collections-core.js:696-703`). | None beyond D-2: the rule cannot tell "chose X" from "X equals the default". |
| D-6 | **Signals.** The editor is seeded with explicit signals from the record (not the DOM, because `#numistaShape` is filled after the seed in `editItem`) and afterwards reads signals through a host callback. The host calls `signalsChanged()` from: the real Type `change` listener and `handleTypeChange` (`events.js:2419`), new `change` listeners on `#itemGradingAuthority` and `#numistaShape`, and the programmatic setters (`pcgs-api.js:618-621`, `catalog-numista-modal.js:1097`, and after `populateNumistaDataFields`). A call that derives the same shape is a no-op. | Programmatic `.value =` fires no event (discovery §B); `handleTypeChange` also fires at edit-open, clone and prefill, so the seeded baseline must be set explicitly. | Four small edits in files otherwise unrelated to framing; the alternative (dispatching synthetic `change` events) would also trigger the dimension-toggle listener. |
| D-7 | **Editor contract is slot-based.** `mount(root, options)` returns a controller. The host root carries hooks: a shape-control slot, a frame element and an orientation slot per side. The controller exposes: seed/reset, `signalsChanged`, `swapSides`, `resetSide(side)`, `setSideHasImage(side, bool)`, `getState`, `getResult`, `dispose`, and an `onChange` callback. It sets `data-shape` and `data-orientation` on the frames and nothing else in the host. | Keeps pinned ids/classes and the swap guards out of the editor (AC-1.2/1.3), and lets one module serve a static `index.html` form and a JS-built form. | Hosts must carry the hooks; a missing required slot is a developer error, so the editor throws loudly instead of building a fallback layout. |
| D-8 | **Controls reuse existing CSS.** The shape and orientation controls are radiogroups using the shipped `.collections-segmented*` classes (already themed, 44px targets under the builder's mobile rule) and Option C from the STRK-424 playground, one orientation group per side. The editor builds its own small DOM helper and glyph set; the picker's closure-local `segmented()` stays for Coin side and other controls. | No new control CSS (UI reuse lesson, PR #1557). The picker's helper depends on its closure (`el`, `builderIcon`), so extracting it would touch unrelated controls. | About 25 lines of helper duplication and Collections-named classes in the item modal. Renaming is out of scope. |
| D-9 | **Swap.** Item modal: the existing guarded swap handler stays; after it swaps images it calls `controller.swapSides()`, which exchanges per-side orientation and leaves the shared shape alone (AC-3.1). Builder: `imageChooser` gains snapshot/apply so a swap can **materialise** each side's effective image (chosen `File`, else the stored blob read from `imageCache`, else empty) into the other chooser; the existing `persistChosenImages` then writes both sides and re-stamps the `cover` and `title:reverse` artwork on save (AC-3.2). | The builder never writes images live (`picker:1671-1673`), so swapping at the chooser level reuses the one save path and the stamping it already does. | A swap of two stored images reads two blobs and rewrites both on save. Orientation exchange is synchronous; the image exchange is async and takes the same busy/`inert` treatment as the item modal. |
| D-10 | **Collections reverse key: `reverseImageOrientation`** on the definition, parallel to the item field names; `imageOrientation` stays the obverse/shared value. `normalizeDefinition` whitelists the key and **drops it when the shape does not rotate or when it equals the obverse value** (canonical form). `reverseImageOrientationFor(shape, definition)` resolves reverse, else obverse (with the existing legacy-landscape pin). Create/update mirror the obverse rules (`collections-core.js:706-710`). | A canonical form keeps uniform pairs byte-identical to what an older build produces, so they never diverge on tie-breaks; only genuinely mixed pairs depend on the key (AC-5.2/5.3). | A reverse that equals the obverse is not stored and follows it on later obverse edits. The builder always posts both sides, so a save re-evaluates both; the follow only happens when they are equal at save time. |
| D-11 | **All five Collections surfaces read the nominal side.** The entry projection carries `reverseImageOrientation`; the Album title pair picks per side in its `titleSides` loop; Slot tiles, Ledger rows and Hub medallions pick by `definition.side`. When a coin shows the other side's image through the title fallback (`getTitleImage`), the **coin's nominal side** decides the frame. Series Template entries keep projecting landscape for Bar/Note. | The frame belongs to the slot or side, not to whichever image happens to fill it; this is the only rule that gives the builder preview and the Album the same answer. | A fallback image may be cropped to the other side's frame. Rare, since a reverse-less collection also has uniform orientation after canonicalisation. |
| D-12 | **Hash.** Append a truthiness-gated segment for the three new item fields after the existing STRK-241/242 block, tagged so it cannot be confused with that block; items without the fields contribute the identical string they do today. The legacy `*ImageFrame` fields are **not** added. | STRK-241/242 precedent; adding legacy frames would change the hash for every framed inventory and trigger a one-time spurious sync prompt. | The existing blind spot (a frame-only change on an unmigrated item is invisible to the poll fast path) stays; filed as a follow-up. A device on an older build sees a hash mismatch with an empty field diff for inventories that carry the new fields (matrix H-3). |
| D-13 | **Registration at every enumeration site** (discovery §E): `DIFF_FIELDS` (Images group), `changeLog.js` field array, `types.js`, ZIP JSON writer, JSON export and import, standard CSV and ZIP CSV, and both CSV importer branches (including the test-only branch at `inventory-import.js:1848-2006`). Writers omit absent keys; readers validate enums; the sanitizer needs no exemption because every value is alphanumeric. | The STRK-235/242 standing rule; the discovery shows JSON export and three importers drop frames today. | More files touched, each with a one-line change; mitigated by a single checklist test that asserts the five fields round-trip through each path. |
| D-14 | **CSV layout.** New columns `Image Shape`, `Obverse Image Orientation`, `Reverse Image Orientation` are **appended after the last item column and before `Collections`** in both lists (after `Traded From UUID` in the 44-column export, after `Attachments` in the 37-column ZIP CSV). Importers match by header name, with camelCase aliases as elsewhere. | Matches the STRK-371 rule that appending keeps positional groups intact, keeps `Obverse Frame`/`Reverse Frame` adjacent to `Reverse Image URL` and `Collections` last (both pinned by core tests), and leaves the `[15..30]` and `[31..35]` index comments valid. | The frame fields and the new shape fields sit far apart in the sheet; users who edit CSVs by hand see two groups. |
| D-15 | **CSS.** The ratio tokens move to `:root` as `--frame-bar-portrait`, `--frame-bar-landscape`, `--frame-note-portrait`, `--frame-note-landscape` and `--frame-slab: 0.68`; the `--collections-frame-*` declarations at `css/styles.css:17997-18003` are removed and the medallion, album and builder rules read the shared tokens. The editor's frame rules live under `.ife` and key off `data-shape`/`data-orientation`; they **replace** the builder's per-shape ratio rules (`19628-19650`) while the builder frame elements keep their `collections-image-pick` class so the STRK-421/424 tests still resolve the same selector. The only intended Collections visual change is the builder Slab box going from 3:4 to 0.68 (AC-10.1). | One source of values and one source of selectors for ratios; no edit to protected assertions (they assert rendered ratios and widths, not token names). | The builder's width rules (`--collections-cover-size`, 108/160/100px) stay as they are, so ratio is shared but sizing is per host. |
| D-16 | **Item-modal sizing and scope.** Enlarged previews apply at `@media (min-width: 769px)` only. The base `.image-upload-preview img { max-height: 140px }` rule at `css/styles.css:3822-3828` is not edited, because Settings → Images shares it; the item modal gets `.ife`-scoped sizing under `#inventoryForm`. The group renders both frames from first open as empty placeholders (AC-1.5), and the `COIN_IMAGES` flag keeps hiding the whole group exactly as today. | AC-1.4/6.1/6.2; 768px is mobile today (`max-width: 768px`), so desktop starts at 769. | With the flag off, users cannot set a shape; they keep the derived default. Image framing only matters with images, so this is accepted. The modal stays inside its current 700px dialog unless the mockup proves it cannot (see Tradeoffs). |
| D-17 | **P2 renderers** read the shared reader and set `data-shape` and `data-orientation` on their existing wrappers (`.coin-img`, `.table-thumb`, `.view-image-slot`). The current wrapper box becomes the **bounding box**: the frame is the largest ratio rectangle that fits it (`aspect-ratio` with max width/height), and images use `object-fit: contain`, matching the Collections medallions, so bullion photos are never cropped. `resolveImageFrame` stays as a thin wrapper (non-round shape means `rect`) and the `bar-shape`, `table-thumb-rect` and `view-shape-rect` classes stay alongside the new attributes, so the pinned core assertions keep passing. The table thumb keeps its 28px height with a ratio-derived width clamped to a small range; the placeholder SVG cache key gains shape and orientation. | Keeps every protected test valid while moving the visuals; one wrapper contract for three renderers. | Bar and Note thumbs change width in the table; legacy rect items change from natural aspect to a fixed ratio (reverses STRK-38 on purpose). Confirmed per surface in the P2 mockup. |
| D-18 | **Legacy-visible resolver differences are accepted at P2, not P1.** In P1 the renderers still call the unchanged `resolveImageFrame`, so nothing existing changes without a user save. In P2 the shared reader replaces its inputs, which brings the two real differences: the Numista non-round rule now applies to Coin only, and `weightUnit` `gb`/`sb` no longer forces a frame by itself (Goldback and Silverback are Type options, so the Type rule covers real items). Grading-first changes the shape name (Bar to Slab) but not the round/rect binary. | The discovery found that only items with a non-Coin Type plus a non-round Numista shape, or an anomalous `weightUnit`/Type pair, change. | A small set of anomalous items may re-frame in P2; covered by the AC-9.3 four-theme before/after check. |

## File Map

Every path below is justified by `discovery.md`. Phase tags: P1, P2.

### New

- `js/image-frame-editor.js` — the shared editor (P1).
- `playground/STRK-427-image-frame-editor.html` — the `/ui-mockup` artifact the UI Contract requires; **must be approved before implementation** (P1). A second section covers the P2 table, card and view-modal states.
- `tests/unit/image-frame.test.js` — resolver, reader, writer, enum normalizers and legacy mapping (P1).
- `tests/unit/cloud-sync-image-frame-hash.test.js` — the gated hash append, using `tests/unit/helpers/source-extract.js` like the STRK-241 hash test (P1).
- `tests/playwright/core/image-frame-editor.spec.js` — the item-modal workflow and builder parity in four themes at desktop and 390px (P1). A new file is justified because no core domain suite covers the item-modal image section; `coverage-map.csv` gets a row.
- `tests/playwright/core/image-frame-renderers.spec.js` — table, card and view-modal frames and the legacy-rect checks (P2).

### Modified

P1, shared logic and editor mounting:

- `js/image-frame.js` — adds `deriveImageShape`, orientation default, normalizers, the reader and the writer; `resolveImageFrame` is unchanged in P1.
- `index.html` — registers the editor immediately after `image-frame.js` (`:8965`); adds the slot hooks to the item modal image section (`:1865-2038`) and removes the two `.frame-toggle` buttons.
- `sw.js` — `CORE_ASSETS` entry immediately after `./js/image-frame.js` (`:88`).
- `js/events.js` — removes the pending-frame state and helpers (`:404-406`, `:479-523`) and the `cycleFrame` wiring (`:3095-3103`); mounts the editor; resets it from `clearUploadState` (`:614-684`); calls `resetSide` from Remove, `swapSides` from the swap handler, and `signalsChanged` from the Type, grading and Numista listeners; replaces the frame read and write at `:1688`, `:1835-1840`, `:1930-1931` with the editor result and the pure writer. Net line count falls.
- `js/inventory.js` — `editItem` seeds the editor from the record (replaces `setPendingImageFrames`, `:2095-2097`); `exportJson` projection (`:2554-2596`) gains the five fields, sparsely.
- `js/pcgs-api.js`, `js/catalog-numista-modal.js` — notify the editor after the programmatic grading and Numista-shape sets (`:618-621`, `:1097`).
- `js/diff-engine.js` — `DIFF_FIELDS` gains the three fields in the Images group (`:75-76`).
- `js/changeLog.js` — field array gains the three fields (`:181-182`).
- `js/cloud-sync.js` — gated hash segment (`:158-165`).
- `js/types.js` — `InventoryItem` typedef (`:38-39`).
- `js/inventory-backup.js` — ZIP JSON writer: the three new fields plus omit-when-absent for all five (`:121-135`); `BACKUP_CSV_HEADERS` and cells (`:8-47`, `:251-288`) with the index comments updated.
- `js/csv-export.js` — headers and cells (`:100-146`, `:163-200`).
- `js/inventory-import.js` — JSON import fields (`:1564-1602`), CSV `_readCsvIdentityFields` (`:747-755`) and the test-only parse branch (`:1848-2006`): read the new fields and the legacy frames, validate enums.
- `js/collections-core.js` — seam-backed `defaultImageShapeForType`; `reverseImageOrientation` in `normalizeDefinition`, create, update and the exports; `reverseImageOrientationFor`.
- `js/collections-picker.js` — mounts the editor in collection mode; removes the shape and orientation controls, `imageShapeTouched` and `suggestedShape` (`:1193-1288`); seeds and saves the reverse value (`builderSeed`, `:1612-1681`); adds snapshot/apply to `imageChooser` for swap; removes the shape glyph entries from `BUILDER_ICONS` if nothing else references them.
- `js/collections-ui.js` — entry projection adds `reverseImageOrientation` (`:699-738`).
- `js/collections-album.js` — title pair picks the orientation per side (`:95-121`); `buildSlotCoin` picks by `definition.side` (`:569-599`).
- `js/collections-hub.js` — `buildEntryCoin` picks by `definition.side` (`:394-413`).
- `css/styles.css` — tokens, `.ife` rules, desktop preview sizing, the builder ratio rules removed (`:19628-19650`), the medallion Slab and builder Slab on `--frame-slab`.
- `tests/unit/collections-core.test.js` — **harness change only**: `loadCore` also loads the real `js/image-frame.js` into the surface (needed because the seam fails closed); no existing assertion is edited. New cases are added for the reverse key, canonical omission and tie-order commutativity.
- `tests/playwright/core/collections.spec.js`, `collections-data-paths.spec.js`, `import-export.spec.js` — additive cases only (mixed-pair surfaces, definition round-trip, new columns and JSON/CSV/ZIP round trip).
- `tests/playwright/coverage-map.csv` — new rows, updated counts, and the rationale of the superseded frame rows (see Tradeoffs).
- `.context/GLOSSARY.md`, `.context/deep-dives/data-model.md`, `.context/cloud-sync-convergence.md`, `.context/style.html` — new fields and terms, the sync/hash row and limitation, and the editor component replacing the 140px-capped "Image Uploads" pattern text (`style.html:1616-1730`).

P2, renderers:

- `js/card-view.js` (`:563-593`), `js/inventory-table.js` (`:350-385`, `:408-468`, `:1448-1482`), `js/viewModal.js` (`:2996-3017`, `:1963-1977`), `css/styles.css` (table, card and view-modal blocks), `js/image-frame.js` (the `resolveImageFrame` wrapper) — move to the shared frames; the view modal must keep its re-apply after Numista enrichment.

### Deleted

- No files. Removed code: the item pending-frame state and `cycleFrame` toggle (`events.js`), `imageShapeTouched` and `suggestedShape` (`collections-picker.js`), the `--collections-frame-*` declarations and the builder per-shape ratio rules (`styles.css`).

## Data / Schema Changes

- **Item** (`metalInventory` records): optional `imageShape` (`round`, `bar`, `note`, `slab`), `obverseImageOrientation` and `reverseImageOrientation` (`portrait`, `landscape`). Absent means "derived". No backfill and no bulk migration (AC-8.5): an item is touched only when the user saves it with a changed frame. Legacy `obverseImageFrame`/`reverseImageFrame` stay, dual-written on an explicit shape.
- **Custom Collection definition:** optional `reverseImageOrientation` (`portrait`, `landscape`); `imageOrientation` keeps meaning obverse/shared. `SCHEMA_VERSION` stays 1; an older build drops the key on load, by design (AC-5.3).
- **Exports:** three CSV columns in both lists, five fields in JSON and ZIP JSON.
- **Hash:** inventories without the fields hash exactly as today.

## Cross-version matrix (AC-5.3, AC-8.3)

N is a build with this spec; O is the current build. Each row is a test target for `tasks`.

### Items

| # | Scenario | Expected result | Preserved | Lost |
|---|----------|-----------------|-----------|------|
| I-1 | N saves an explicit shape; O opens it | O renders round or rect from the legacy projection and ignores the new keys; they stay in the record | Shape and orientation in the record | The fixed Bar/Note/Slab ratio and per-side orientation in O's view |
| I-2 | N saves a sparse default; O opens it | Legacy keys were deleted; O derives its own frame | Following Type | Nothing (P2 may differ for anomalous items, D-18) |
| I-3 | O edits Type on a migrated item | Record keeps the new fields (edits spread `...oldItem`); N reads the new fields | The user's explicit shape | O's Type change does not move the frame (AC-8.2 limitation) |
| I-4 | O cycles the frame toggle on a migrated item | Legacy value changes; new fields unchanged; N ignores the legacy value | The explicit shape | O's frame edit (AC-8.2, no detection heuristic) |
| I-5 | O edits grade or catalog on a sparse item | N re-derives from the new signals | Following Type | Nothing |
| I-6 | O edits Type on an unmigrated legacy-rect item | Legacy value stays; N maps `rectangle` through the new Type, or Bar when that is Round | The rectangular intent | Nothing |
| I-7 | Stale orientation: N stored an orientation under a sparse Bar shape; O changes Type to Coin | N reads Round, so the orientation is ignored and **not deleted**; it applies again if the Type returns to a rotating shape | The stored value | A guarantee that it is cleared |
| I-8 | Legacy mixed sides (`circle` / `rectangle`) | N reads the obverse mapping; an untouched save leaves both fields as they were; a dirty save overwrites both with one projection | The obverse intent | The reverse side's own legacy value on a dirty save |
| I-9 | Missing, empty or `auto` values | All read as absent; N never writes `auto` or `''` | Sparse form | Nothing |
| I-10 | Invalid enum in a new field (hand edit, other tool) | Reader treats it as absent | A safe default | The bad value |

### Sync, hash and diff

| # | Scenario | Expected result |
|---|----------|-----------------|
| H-1 | N to N, logically equal records (absent vs `''`) | Identical hash; no diff |
| H-2 | N to N, different shape or orientation | Different hash; field-level diff via `DIFF_FIELDS` |
| H-3 | N item carrying the fields, O device | O's hash lacks the segment, so the poll sees a mismatch with an empty field diff (STRK-241 class). Only inventories that carry the fields are affected. Accepted |
| H-4 | Any inventory with no new fields | Hash byte-identical to the current build (pinned against a hash computed by the unchanged function) |
| H-5 | O applies a `modify` from N | O patches only its own `DIFF_FIELDS`, so new-field changes are not applied; an `add` copies the whole record and keeps them |

### Import and export

| # | Scenario | Expected result |
|---|----------|-----------------|
| E-1 | N export to N import (ZIP, JSON, CSV) | All five fields round-trip |
| E-2 | N export to O import | CSV: unknown columns ignored and frames dropped (as today). JSON import: new keys dropped (as today for frames). ZIP restore: items are parsed verbatim, so `add` keeps the keys and `modify` does not |

### Custom Collections

| # | Scenario | Expected result |
|---|----------|-----------------|
| C-1 | N writes a mixed pair; O loads and saves anything | `normalizeDefinition` drops the key on load and the save persists the loss; the reverse falls back to the obverse value. `metaModified` is unchanged, so the copy ties with N's |
| C-2 | Tie on `metaModified` between a stripped copy and a full copy | The existing `stableStringify` tie-break picks one deterministically; `merge(A,B)` equals `merge(B,A)`; the mixed pair may be lost. No extra mechanism (AC-5.3) |
| C-3 | O edits the definition (the stamp advances) | O's copy wins whole; the reverse key is gone |
| C-4 | N edits after O | N's stamp is later and wins; the user re-chooses the reverse |
| C-5 | Uniform pair (reverse equals obverse) | Key canonically absent, so N's and O's definitions are identical and never diverge |

## Tradeoffs Surfaced for Review

Decisions that go beyond the literal requirements and need a human yes before `tasks` commits to them.

1. **Legacy `rectangle` fallback (D-3).** AC-8.1 literally yields Round for a plain Coin; this approach yields Bar instead.
2. **Store only deviations (D-2).** No "Auto" option; picking the default shape is the reset. An explicit choice that matches the default is not pinned.
3. **AC-6.2 "mobile unchanged".** The shape row and per-side orientation toggles are new elements on mobile; "unchanged" is read as no change to existing elements' size or stacking. The new controls use the builder's 44px mobile target.
4. **Desktop size inside 700px (D-16).** If the mockup shows the 700px item dialog cannot give two usefully larger previews, widening the dialog on desktop is a scope escalation that needs sign-off.
5. **P2 reverses STRK-38 on purpose (D-17).** Legacy rect items go from natural aspect to a fixed ratio, with a portrait Bar default. Users with landscape bar photos will see letterboxing until they pick Landscape.
6. **Superseded tests.** The archived `strk-121-image-frame-override.spec.js` cases for the three-state toggle (`:183-223`) describe an interaction this spec removes by design (AC-4.7). They are not edited; `coverage-map.csv` marks them superseded, and they will fail under `npm run test:legacy`. The alternative is to re-baseline the archive in a separate chore.
7. **Harness change (file map).** `tests/unit/collections-core.test.js` `loadCore` must also load `image-frame.js`, because the seam fails closed. This changes test infrastructure, not any assertion.
8. **ZIP writer omit-when-absent (D-13)** is applied to the two legacy frame keys as well as the three new ones, so `''` is never written for any of them. Reader tolerance for `''` stays.
9. **Hash scope (D-12).** The legacy frames stay out of the hash.

## UI Contract

### Mockup Artifacts

| Artifact | Path / URL | What it defines |
|----------|-----------|-----------------|
| Orientation control, Option C | `playground/STRK-424-orientation-toggle.html` (variant C at ~228-262) | The segmented Portrait/Landscape control and its glyphs. It mocks **one** shared orientation, not two. |
| Shared image-frame editor (**to be created, gate before implementation**) | `playground/STRK-427-image-frame-editor.html` | All named states below, in light, dark, slate and sepia, at desktop width and 390px, for the item modal and the builder side by side. Sets the exact desktop preview size (AC-6.1) and the two-modal layout. P2 section: table row, card A/B/C and view modal. |
| Approved baselines to match | `playground/STRK-421-collection-modal-variants.html` (builder hero and covers) | The builder's existing hero layout the editor must not regress. |

### Named States / Screens

| State | Description | Mockup reference |
|-------|-------------|------------------|
| E-empty | New item, no images: shape row visible, both frames render as empty placeholders, controls enabled (AC-1.5) | STRK-427 playground, item modal |
| E-one | One side filled, the other empty | STRK-427 playground |
| E-mixed | Both filled with different orientations (portrait obverse, landscape reverse) | STRK-427 playground |
| E-round | Round selected: circular frames, no orientation controls (AC-2.3) | STRK-427 playground |
| E-slab | Slab selected or derived from a grade: 0.68 frames, no orientation controls | STRK-427 playground |
| E-follow | Type changes while the shape is derived: the frames reshape immediately (Coin to Goldback shows Note, AC-4.6) | STRK-427 playground |
| E-pinned | A shape that differs from the derived one: a Type change leaves it alone (AC-4.4) | STRK-427 playground |
| B-builder | Edit Collection builder with the same editor, hero layout preserved | STRK-427 and STRK-421 playgrounds |
| M-390 | All of the above at 390px, full-screen modal shell as today | STRK-427 playground |
| T-4 | Every state above in light, dark, slate and sepia | STRK-427 playground |
| P2-table, P2-card, P2-view | Frames in the table row, card A/B/C and view modal, including the legacy-rect case | STRK-427 playground, P2 section |

### Component / Token Requirements

- Root class `.ife`, with `data-shape` and `data-orientation` on each frame; hook attributes `data-ife-*` on host markup.
- Controls use `.collections-segmented`, `.collections-segmented-option`, `.collections-builder-caption` markup (no new control CSS).
- Ratios read `--frame-bar-portrait`, `--frame-bar-landscape`, `--frame-note-portrait`, `--frame-note-landscape`, `--frame-slab`; Round is 1. No literal ratios in component CSS.
- Backgrounds and borders use `--bg-card`, `--bg-secondary`, `--bg-tertiary`, `--border`, `--border-hover`; **not** `--surface` (light-only, STRK-426). The remove badge keeps its shipped tokens.
- Existing builder classes stay on the builder frames: `.collections-builder-covers`, `.collections-image-pick`, `.collections-builder-title-option`.
- Existing item-modal ids stay: `#imageUploadGroup`, `#swapImagesBtn`, `#itemImagePreview{Obv,Rev}`, `#itemImagePreviewImg{Obv,Rev}`, `#itemImageFile{Obv,Rev}`, `#itemImageRemoveBtnObv`, `#itemObverseImageUrl`, `#itemReverseImageUrl`.
- Radiogroup names: "Image shape", "Obverse orientation", "Reverse orientation" (the builder's existing "Image shape" and "Orientation" names remain resolvable for the shared group).
- A `style.html` entry documents the component with its tokens.

### Interaction Contract

- Choosing a shape reshapes both frames immediately and without saving (AC-2.1). A shape change restarts orientation at the new shape's default; a re-derive to the same shape keeps it.
- The orientation group appears per side only for Bar and Note and hides for Round and Slab (AC-2.3, AC-5.1).
- Swap exchanges the two images and their orientation in both modals and never the shape (AC-3.1/3.2). In the item modal it is still the existing button, visible only when both images exist, and the existing busy/`inert` behavior is unchanged.
- Remove resets that side's orientation to its default and leaves the shape (AC-3.3).
- Keyboard: radiogroups follow native radio behavior (arrow keys move the choice, the checked option is in the tab order); focus ring is the existing `:focus-visible` outline. Mobile tap targets are 44px.
- Reduced motion: any frame transition is disabled under `prefers-reduced-motion`.
- The item modal stays inside the existing dialog; mobile layout of existing elements is unchanged (AC-6.2).

## Out of Scope (follow-up issues)

To be filed under STRK when this spec is approved; none are filed yet.

- Add the legacy `*ImageFrame` fields to `computeInventoryHash` (closes the frame-only blind spot; changes every framed inventory's hash, so it needs its own migration plan).
- Frame the remaining item-image surfaces: the thumb popover (`inventory.js:3089-3106`), `bulk-row-images.js` and `diff-modal.js` images.
- STRK-425 (an automatic shape that follows the uploaded image's ratio) stays separate and low priority; AC-4.7 fixes the four shapes.
- A shape field in bulk edit (already a Non-Goal).
- Detecting an older build's edit to a migrated item (already a Non-Goal).
- Renaming the `.collections-segmented*` classes to a neutral name.
- Cleanup: the stale JS file count in `.github/copilot-instructions.md:9`.

## Risk Notes

- **Protected selectors.** STRK-421/424 core tests assert widths and ratios on `.collections-builder-covers .collections-image-pick`. Mitigation: D-15 keeps the class and removes only the duplicate rules; the first task after the mockup is to run those specs against the new CSS.
- **Core purity.** A missing seam silently derives Round and would look like a passing run for Type-only cases. Mitigation: the harness change in the file map, plus a unit test that the core fails closed.
- **Sparse-write regression.** Any new sparse key not deleted on edit leaves a stale value (`events.js:1909-1911` spread). Mitigation: the writer returns the keys to delete, and the dirty-gate test (I-8, I-9) pins both directions.
- **Hash.** An unconditional or `!== undefined` gate would change every inventory's hash. Mitigation: H-4 is pinned against a hash computed by the unchanged function.
- **Sanitizer.** `sanitizeObjectFields` strips non-alphanumerics from every string field. Mitigation: all enum values are single lowercase words; a test asserts they survive `loadInventory`.
- **Two CSV lists and four importer paths.** Missing one silently drops data. Mitigation: the round-trip checklist test (D-13) and real-export CSV round trips (a hand-built CSV hides PapaParse's carriage return on the last header).
- **events.js and inventory.js are large** (5551 and 3357 lines). Mitigation: the item modal change is net-negative in `events.js` and the new logic sits in `image-frame.js` and the editor.
- **Builder swap failure window.** Images are written after the modal closes (`picker:1671-1673`), so a failed write after a swap leaves the definition ahead of the images. Mitigation: the existing `saveImage` failure toast stays; no new window is opened beyond today's.
- **Plane brief drift.** The brief still says three phases and hidden item orientation controls in P1. This approach follows `requirements.md`.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/spec-tasks STRK-427`.
