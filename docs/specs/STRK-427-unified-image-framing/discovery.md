---
spec: "STRK-427-unified-image-framing"
phase: discovery
created: 2026-10-10
---

# STRK-427 — Discovery

_Research only. No solutions are proposed here; that is the `approach` phase. Line numbers were read in the `chore/strk-427-spec` worktree at `6c2fc0a8`. The anchors that the open questions lean on (resolver order, CSV last column, sparse-delete, swap, hash gate, merge tie-break, CSS ratios, registries, sanitizer) were re-read by the author; the remainder come from the four research passes._

## Existing Code

### A. Item frame model and resolver

| Path | Role | Notes |
|------|------|-------|
| `js/image-frame.js:8-72` | `normalizeImageFrame`, `cycleFrame` (auto→circle→rectangle→auto), `resolveImageFrame(item, side)` → `"round"\|"rect"`; window exports at 68-72 | Output is binary; no Bar/Note/Slab or orientation concept. |
| `js/image-frame.js:33-65` | Resolver order today: per-side override → `type` ∈ {bar, note, aurum, set} **or** `weightUnit` ∈ {gb, sb} → rect → non-empty `gradingAuthority` → rect → `numistaData.shape` via `window.classifyShape` (non-round → rect) → round | `classifyShape` lives in `js/catalog-api.js:482` (export 1336). Goldback/Silverback are caught **only** via `weightUnit`, not by Type name. |
| `js/inventory-table.js:438`, `:1116`, `:1455` | Thumb async path, `hasImageFrameResolver` flag, `_thumbShapeClass` → `table-thumb-rect` | Class decided at HTML-build time per side. |
| `js/inventory-table.js:350-385` | `_getThumbPlaceholder(metal, type, shape)` cached SVG, keyed `metal:type:shape`; rect also chosen by a `/bar\|ingot/` type regex | Only round/rect variants; colors resolved per theme at build time. |
| `js/card-view.js:563-593` | `_cardImageHTML` adds `bar-shape` when resolver returns rect | Card A 44×44, B 80×80, C 56×56 round vs 80×56 `bar-shape` (`css/styles.css:15103-15246`). |
| `js/viewModal.js:2996-3017`, `:1963-1977` | `_applyViewSlotFrame` toggles `view-shape-rect`; re-run after late Numista enrichment only when `merged.shape` is truthy | Any P2 frame logic must be callable twice. |
| `tests/playwright/core/mobile-and-layout.spec.js:198-222` | Pins `resolveImageFrame` outputs (`explicit rect`, `grading rect`, `fallback round`) and `.card-a/.card-b .coin-img.bar-shape` transparent background | Protected TDD tests (`.context/testing.md`). |

Only these four render sites plus the edit modal call the resolver. `bulk-row-images.js`, the thumb popover (`js/inventory.js:3089-3106`) and `diff-modal.js` image loading do not use it.

### B. Add/Edit Item modal (image I/O host)

| Path | Role | Notes |
|------|------|-------|
| `index.html:1865-2038` | `#imageUploadGroup` `<details>`; `.image-upload-sides` with two `.image-upload-side` columns around `#swapImagesBtnWrapper`; per side `.image-card > .image-upload-preview > img + button.frame-toggle`, plus `.image-card-actions` (Upload/URL/Camera/Remove), size info, URL input | Whole group is `display:none` unless `COIN_IMAGES` is on (`js/events.js:3078`; default `enabled:true`, `js/constants.js:1750`). |
| `js/events.js:385-411` | Module-private `let`s: pending blobs, `_pendingItemImageSwap`, `_itemImageEditGeneration`, preview URLs, delete flags, `_pendingObverseFrame/_pendingReverseFrame` (404-406), URL-preview generation tokens/timers | |
| `js/events.js:468-477` | `updateSwapButtonVisibility` shows the swap wrapper only when **both** previews are visible | Swap, and today's frame toggle (inside the preview), are hidden until an image exists. |
| `js/events.js:479-523` | `_frameSuffix/_getPendingFrame/_setPendingFrame`, `_renderFrameToggle`, `renderFrameToggles`, `setPendingImageFrames` | |
| `js/events.js:614-684` | `clearUploadState` resets frames to `auto` (621-622), bumps the generation, clears previews | Callers: `events.js:813, 820, 851, 2810, 2816, 2842, 2983, 4735`; `inventory.js:2094`. Single reset chokepoint. |
| `js/events.js:1688-1689`, `:1835-1840` | `parseItemFormFields` reads the pending frames; `buildItemFields` writes a frame key only when truthy and ≠ `auto` | |
| `js/events.js:1909-1911`, `:1930-1931` | Edit commit spreads `{...oldItem, ...buildItemFields(f)}`, then explicitly `delete`s a frame key set to `auto` | STRK-67 D-11: without the delete a reverted choice persists. |
| `js/events.js:2688` | Submit awaits an in-flight swap, then parses, commits, then clears | Read-before-clear order already correct. |
| `js/events.js:3059-3182` | Per-side wiring (frame toggle `cycleFrame` 3095-3103, URL, camera mobile+secure only, upload, Remove 3131-3181). Remove resets that side's frame to `auto` (3137, 3145) | |
| `js/events.js:3208-3319` | Swap handler: early-return on `_pendingItemImageSwap`; generation check + modal-hidden check after awaits (3237-3238); `inert` + `aria-busy` (3296-3299); finally-block restores only if generation unchanged (3309-3316). Frames swapped independently at 3258-3261 | `tests/playwright/core/collections.spec.js:418-422` reads the lexical `_pendingItemImageSwap` and `#imageUploadGroup[inert]` directly. |
| `js/inventory.js:2076-2098`, `:2262-2301` | `editItem`: Type set + `handleTypeChange` first; `_editApplyEditModeChrome` → `clearUploadState` (2094) → `setPendingImageFrames(item.obverseImageFrame, item.reverseImageFrame)` (2095-2097); async `_editLoadImages` (2106-2200); `_editRenderModalSections` → `populateNumistaDataFields` **after** frames are seeded | `#numistaShape` is filled after the frame seed. |
| `js/inventory.js:2402-2527` | `cloneItem` = `editItem` + `enterCloneMode`; `duplicateItem` (2482) has no caller in `js/` or `index.html` | Stack-split clone (~1587) copies the original record. |
| `js/events.js:2419` (`handleTypeChange`) | The only Type chokepoint, but it is also called programmatically from `events.js:2557, 3546` (real `change` listener 3538-3546, `4725`), `inventory.js:2300`, `catalog-numista-modal.js:1285`, `collections-store.js:640` | Fires on edit-open, New Item reset, Numista apply and Slot prefill, not only user changes. |
| `index.html:2465`, `:2722` | `#itemGradingAuthority` and `#numistaShape` are `<select>`s | `gradingAuthority` has no JS listener; `#numistaShape` only a dimension-toggle listener (`events.js:3675-3686`). Programmatic setters (`pcgs-api.js:618-621`, `catalog-numista-modal.js:1097`) fire no DOM event. |
| `css/styles.css:3762-3877` | `.image-upload-sides/-side`, `.image-swap-wrapper`, `.image-card` (flex row, min-height 100), `.image-upload-preview`, `.frame-toggle` | The 140px cap is `.image-upload-preview img { max-height:140px }` at `:3822-3828`, **unscoped**. |
| `css/styles.css:10943-10968`, `:5213-5220` | `#inventoryForm .image-upload-side` dashed-slot chrome; `#itemModal .modal-content` is `width:90%; max-width:700px` | Desktop preview growth is bounded by the ~700px dialog unless the mockup changes that. |
| `index.html:4646-4747`, `js/settings.js:3309-3342`, `css/styles.css:3800` | Settings → Images uses the same `.image-upload-*` / `.image-card` / `.image-swap-wrapper` classes | Only `#settingsPanel_images .image-card` is scoped. |

### C. Custom Collections (builder, core, Album)

| Path | Role | Notes |
|------|------|-------|
| `js/collections-core.js:217`, `:231-235` | `IMAGE_SHAPES`; `defaultImageShapeForType` (Bar/Set→bar; Note/Aurum/Goldback/Silverback→note; else round) | Type is the **only** input; no grading or Numista branch. |
| `js/collections-core.js:236-270` | `defaultImageOrientationForShape` (bar portrait, note landscape), `imageOrientationFor` (absence → landscape for Bar/Note; `""` for round/slab), `newImageOrientation` (submitted else shape default) | The legacy pin cannot tell legacy absence from a new sparse default. Exported at 1294-1295. |
| `js/collections-core.js:303-347` | `normalizeDefinition` rebuilds the definition from an explicit whitelist; orientation written at 341 | A reverse key is stripped on every load/merge unless whitelisted. |
| `js/collections-core.js:613-784` | `createCustomCollection`; `updateCustomDefinition` (bumps `metaModified` via `nextStamp` at 695, assigns 781; keeps previous shape unless it equalled the previous Type's derived shape, 696-703; keeps orientation only when shape unchanged, 706-710; writes only `imageShape`/`imageOrientation`, 764-765) | The shape rule is AC-4.3/4.4 in miniature. |
| `js/collections-core.js:1190-1259` | `pickWinner`: stamp, then `stableStringify(project(a)) >= stableStringify(project(b))`; `mergeCollection` takes the **whole** definition from one side | Not a per-key merge. `.context/cloud-sync.md:385` documents the whole-definition rule. |
| `js/collections-core.js:1-34`, `tests/unit/collections-core.test.js:28-45` | Core is pure/DOM-free; the unit harness evaluates it with `new Function("window", src)` and a hand-built surface | Only precedent for an external dependency is `window.getUnitOztWeight` (core 1047-1057). A shared resolver needs that seam or an inline copy. |
| `js/collections-store.js:41-62`, `:125-150`, `:492-502` | `load()` runs `normalizeState` on every read; `save()` persists `getState()`; `mergeIn` normalizes both sides | An older build drops unknown definition keys on load and persists the loss on its next save. `SCHEMA_VERSION` is 1 with no newer-schema gate. |
| `js/collections-picker.js:1193-1321` | **The builder lives in the picker, not `collections-ui.js`.** Two `imageChooser`s (1293-1294), `.collections-builder-covers[data-shape][data-orientation]`, Image-shape segmented control (1195-1209), one shared Orientation segmented control (1211-1221, hidden for round/slab) | No ids on the choosers; test hooks are radiogroup names "Image shape" / "Orientation", classes `collections-builder-title-option` and `collections-image-pick`. |
| `js/collections-picker.js:1241-1288` | `imageShapeTouched` seeded from an inline Type map (1241-1247); `suggestedShape` duplicates it (1248-1253); Type-change handler (1278-1288) | The code AC-4.1 deletes. It checks a touched flag, not "equals the previous Type's derived shape". |
| `js/collections-picker.js:758-822` | `imageChooser` returns `{node, getFile, isRemoved, setPreview, dispose}`; holds a `File` until save | No `setFile` and no way to hand a stored image to the other side. |
| `js/collections-picker.js:462-620`, `:1006-1027`, `:1612-1681` | Images are IndexedDB pattern images (`collection--<id>`, `collection--<id>--@title-reverse`); artwork stamps `cover`/`title:reverse` live in `collection.artwork`, separate from the definition; images written only on save (`persistChosenImages`, after `closeModalById` at 1671) | Today there is no builder swap. |
| `js/collections-picker.js:918-997` | `builderSeed`: legacy vs new orientation keyed on `request.editId` | A reverse seed value is not present today. |
| `js/collections-ui.js:699-738` | Entry projection: `entryShape`, then `imageOrientation = imageOrientationFor(entryShape, isCustom ? definition.imageOrientation : undefined)` | One orientation per entry. Series Template Bar/Note always project landscape. |
| `js/collections-ui.js:1246-1278`, `:1604-1661` | `buildCoin` adds `collections-coin--shape-<shape>` and `collections-coin--<orientation>` (only `--portrait` has CSS); `resolveCoin` tries the linked Item photo first | `getTitleImage` (`picker 575-589`) falls back to the other side's image when the requested side has none. |
| `js/collections-album.js:91-121` | Title pair loop passes the same `entry.imageShape`/`entry.imageOrientation` to both `buildCoin` calls (116-117) | Series Template pairs (122-124) pass neither. |
| `js/collections-album.js:569-599`, `js/collections-hub.js:394-413` | Slot, Ledger-row and Hub medallions read `definition.side` and pass the shared shape/orientation | See Reverse-face surface inventory below. |
| `playground/STRK-424-orientation-toggle.html:1-423` | Option C (segmented Portrait/Landscape) at ~228-262; ratio tokens ~84-90 | Mocks **one** shared orientation, not two per-side toggles. Uses `--frame-bar-*`, not production `--collections-frame-*`. No STRK-427 playground exists. |

### D. CSS ratio tokens and themes

| Path | Role | Notes |
|------|------|-------|
| `css/styles.css:17997-18003` | `--collections-frame-bar-portrait: 3 / 5`, `-bar-landscape: 1.6`, `-note-portrait: 1 / 2.05`, `-note-landscape: 2.05`, declared on `.collections-coin, .collections-builder-covers` | Not on `:root`. No `--frame-*` token exists. Table/card/view renderers sit outside both selectors. |
| `css/styles.css:18023-18030` | Medallion Slab: `aspect-ratio: 0.68; border-radius: 10px; border: 4px solid var(--border-hover)`, `img` padding 3px | Border and padding are not captured by a ratio token. |
| `css/styles.css:19587-19655`, `:19647-19650` | Builder covers: per-shape `--collections-cover-size` (bar 108/portrait 80, note 160/portrait 80, slab 100, default 128); Slab pick is the lone literal `aspect-ratio: 3 / 4` | The Slab disagreement (0.68 vs 0.75). |
| `css/styles.css:19765-19815` | `.collections-image-chooser/-remove/-pick` | `.collections-image-pick` is also used by the Slot-row chooser (`picker:850`, 44px circle). |
| `css/styles.css:19771-19789` | STRK-426 `.collections-image-remove`: `background: var(--bg-card)`, comment records `--surface` is light-only | `--surface` declared only at `:68`; `--bg-card` in all four themes (`:75, 273, 401, 524`). |
| `css/styles.css:45, 216, 349, 474` | Theme blocks: `:root` light, `dark`, `slate`, `sepia` | `--surface`/`--surface-alt` are not per-theme; `--radius*`/`--spacing-*` only in `:root`. |
| `css/styles.css:5903-5985`, `:15035-15040` | `.table-thumb` 28×28 round; `.table-thumb-rect` adds radius, `object-fit: contain`; placeholder styles | No aspect-ratio. |
| `css/styles.css:6673-6760`, `:7168-7295` | View modal slots: round max 180×180; `.view-shape-rect img` max 200×260 natural aspect; rect placeholder 140×200 | |
| `css/styles.css:787, 4826, 7168, 14477` (+15 more) | Mobile convention is `@media (max-width: 768px)` (19 lines); builder uses `(max-width: 767px)` (1 line, `:19686`) | At exactly 768px the existing rules are mobile. |
| `css/styles.css:14477-14500` | Item and builder modals are full-screen under `max-width: 768px` | "Mobile layout unchanged" includes this shell. |
| `.context/style.html:1616-1730` | Documents the existing 140px-capped image-upload pattern | `.context/design-philosophy.md:276-280` requires a style.html entry for new components. |

### E. Data model, sync, hash, import/export

| Path | Role | Notes |
|------|------|-------|
| `js/types.js:38-39` | `InventoryItem` typedef documents `obverseImageFrame/reverseImageFrame` | Documentation only. |
| `js/utils.js:459-488` | `sanitizeObjectFields` runs on every item on load (`inventory.js:289-352`, `init.js:577`) and strips non-alphanumerics from every string field except `notes`, `capsuleNotes` and a short exempt list (`obverseImageUrl`, `reverseImageUrl`, `uuid`, `tradedFromUuid`, `constitutionalVariant`) | `round/bar/note/slab/portrait/landscape` survive. A hyphen/underscore value would be rewritten. There is **no** item-field whitelist; `ALLOWED_STORAGE_KEYS` governs storage keys, not item fields. `validateInventoryItem` (`utils.js:594`) checks only name/metal/qty/weight/price/location. |
| `js/diff-engine.js:30-94` | `DIFF_FIELDS`; frames at 75-76 (Images group); comment at 24-29 says every new item field must be added | `_valuesEqual` (143-161) normalizes `undefined` and `''` to null; `'auto'` or `'round'` is a distinct value. |
| `js/changeLog.js:142-197` | `logItemChanges` has its own hardcoded `fields` array (frames at 181-182) | No test enforces parity with `DIFF_FIELDS`. |
| `js/diff-engine.js:839-905` | `applySelectedChanges` patches only fields named in `modify` changes; `add` appends the whole remote item | Unknown keys persist verbatim on add; older-build edits spread `...oldItem` so unknown keys survive. |
| `js/cloud-sync.js:123-177` | `computeInventoryHash`: per item `itemKey + '::' + contentSample` (pipe-joined `obverseImageUrl, reverseImageUrl, numistaId, grade, tradedFromUuid, disposition…`), plus the STRK-241/242 block appended **only** when `constitutionalVariant \|\| constitutionalEntryMode` is truthy (158-165); keys sorted, SHA-256 | The legacy `obverseImageFrame/reverseImageFrame` are **not** in the hash today, so a frame-only remote change is invisible to the poll fast path. Poll compares manifest hash at `cloud-sync.js:2885-2889`. Tests slice the function with `new Function` in `tests/unit/cloud-sync-constitutional-hash.test.js:36-72`. |
| `.context/cloud-sync-convergence.md:8-22`, `:56` | STRK-154 invariant: compare/merge/hash on normalized logical content; merges commutative on ties | No section on adding an item field. Inventory travels as raw `metalInventory` JSON. |
| `js/inventory-backup.js:121-135` | `_backupItemImaging` allowlist; frames written as `item.obverseImageFrame \|\| ''` (124-125) | ZIP writes `''` for absent frames. `.context/cloud-sync.md:626`: this allowlist must mirror `DIFF_FIELDS`. |
| `js/inventory-backup.js:8-47`, `:251-288` | `BACKUP_CSV_HEADERS` (37 columns): `…Reverse Image URL, Obverse Frame, Reverse Frame, Disposition Type … Realized Gain/Loss, Attachments, Collections` | Separate from the standard list; index comments (`[15..30]`, `[31..35]`) go stale if columns are inserted. |
| `js/csv-export.js:100-146` | Standard export: 44 columns; `Obverse Frame`/`Reverse Frame` at positions 30-31 right after `Reverse Image URL`; ends `…Traded From UUID, Collections` under the comment `STRK-371: LAST on purpose` (144) | **No `Attachments` column in the standard export.** Cells via `buildCsvRow` (208), `buildCsvCatalogColumns` (163-181), `buildCsvDispositionColumns` (188-200). |
| `tests/playwright/core/collections-data-paths.spec.js:406` | Asserts `parsed.meta.fields.at(-1) === "Collections"` | The enforced contract. |
| `tests/playwright/core/import-export.spec.js:91-100`, `:360-374`, `:379-400` | `expectFrameColumns` requires `Obverse Frame`, `Reverse Frame` **immediately after** `Reverse Image URL`; ZIP JSON test pins frame keys | New columns cannot go between them without editing these tests. |
| `js/inventory.js:2554-2596` | `exportJson` per-item projection | Has `obverseImageUrl/reverseImageUrl` (2589-2590) but **no** frame fields: JSON export is already lossy for frames. |
| `js/inventory-import.js:1564-1602` | `importJson` builds `processedItem` from an explicit field list; frames are never read from `raw` | Optional-field pattern: `...(pricingType ? { pricingType } : {})` (1597-1600). |
| `js/inventory-import.js:747-792`, `:1023-1026`, `:1848-2006` | CSV import is header-name keyed (`transformHeader` trims and canonicalizes only `collections`); `_readCsvIdentityFields` reads only the two image URLs (752-753); a second, test-only parse branch (1848-2006) also never reads frames | Aliases are hand-written per field. |
| `js/bulkEdit.js:63` | Bulk edit has `obverseImageUrl` but no frame field | Matches the Non-Goals. |
| Other `DIFF_FIELDS` writers | `inventory-import.js:466/544`, `cloud-sync.js:4451/4650`, `vault.js:586/799`, `diff-modal.js:2221` | |

### F. Registries and test infrastructure

| Path | Role | Notes |
|------|------|-------|
| `index.html:8965`, `sw.js:88` | `image-frame.js` is the only registration of that file besides `.codacy` test config. In `index.html` it sits after `catalog-numista-modal.js` (8964) and before `pcgs-api.js`/`inventory-import.js`; in `sw.js` `CORE_ASSETS` it sits after `detailsModal.js` and before `viewModal.js` | The two orders already differ, so "script-tag order" is not literally checkable today for this file. `events.js` is at `index.html:8989`, `inventory.js` at 8973, Collections scripts at 9019-9029. |
| `tests/unit/script-global-scope-collisions.test.js` | Compiles every `index.html` `js/` script in one `vm.Script` scope; a duplicate top-level `const/let/class` fails | Names to avoid: `_frameSuffix`, `renderFrameToggles`, `cycleFrame`, `setPendingImageFrames`, `imageShapeTouched`, `suggestedShape` (until deleted). |
| `eslint.config.cjs` | `js/**/*.js`, ecmaVersion 2020, no-undef off | No logical-assignment operators. |
| `playwright.config.js:1-40`, `tests/playwright/helpers/` | Single chromium project, workers 1, service workers blocked, per-worktree port | Item modal opened via `#newItemBtn` after `window.appListenersReady`, or `window.editItem(idx)`; themes via `window.setTheme(name)`. |
| `tests/playwright/coverage-map.csv:1-164` | 163 data rows, one per spec file; `core/collections.spec.js` is row 161 (117 tests), `core/collections-data-paths.spec.js` row 163, `mobile-and-layout` row 160 | Header `file,test_count,domain,risk_class,decision,replacement_target,rationale`. |
| `tests/playwright/archive/issue-ac-matrices/strk-121-image-frame-override.spec.js:76-223` (+ `strk-121-rect-image-card-table`, `strk-118-csv-frame-columns`, `strk-118-backup-zip`, `strk-118-cloud-sync-manifest-type`) | The only edit-modal frame coverage | Run under `test:legacy` only. Core has no swap-with-frames coverage. |
| `tests/playwright/core/collections.spec.js:925-1010`, `:1497-1681` | STRK-421 builder layout (pick width ≥ 120 at 1280 and 375; Note wider than tall); STRK-426 badge contrast in four themes; STRK-424 ratios 0.6 / 1.6 / 2.05 on `.collections-builder-covers .collections-image-pick`, reload pin, clone default | Selector migration into a shared editor class would touch these protected tests. |
| `tests/unit/collections-core.test.js:771-1008`, `:1451-1462` | Shape defaults, orientation rules, `metaModified` rule, slot-link tie convergence | No test covers a definition-level tie divergence or a stripped unknown key. |

### G. Reverse-face / orientation surface inventory (answers the requirements open question)

A Custom Collection's reverse face or `imageOrientation` is read by **five** surfaces, not two:

1. **Builder preview**: `collections-picker.js:1193-1317`, CSS `styles.css:19587-19650`.
2. **Album title pair**: `collections-album.js:95-121` (one orientation for both sides).
3. **Album Slot tiles and Ledger rows**: `buildSlotCoin` (`collections-album.js:569-599`, used at 617, 636, 692) passes `definition.side` and the shared orientation.
4. **Hub card and Ledger row medallions**: `buildEntryCoin` (`collections-hub.js:394-413`, used at 503, 549) with `definition.side`.
5. The builder's Slot-row choosers (`picker:850`) are always round 44px and do **not** consume shape or orientation.

`definition.side` (`collections-core.js:343, 655, 770-775`, builder control `picker:1065-1072`) decides which face the Slot and Hub medallions show, so a reverse-side Collection shows its reverse face outside the title pair. Detail views, the item-view chip (`collections-item-view.js`) and exports do not render the pair; `viewModal.js:2015` "orientation" is Numista coin data.

Persistence of definitions (sync `_mergeCollectionState` `cloud-sync.js:3736-3745`, vault restore `vault.js:694, 809`, ZIP `inventory-backup.js:226-233, 722`, standalone `collections-io.js:60, 84-107`) all pass through `normalize`/`merge`; a key added to the `normalizeDefinition` whitelist is carried by every path. `collections` is in `SYNC_SCOPE_KEYS` (`constants.js:1079`).

## Prior Decisions

**mem0** (filters `user_id=lbruton`, `metadata.project=staktrakr`), exact queries: `image orientation Bar Note slab collections` · `ImageFrame circle rectangle item modal` · `inventory hash append field sync convergence` · `CSV import export column order attachments` · `image frame shared component playground mockup`.
**sessionflow**, exact queries: `STRK-427 unified image framing discovery brief` (from 2026-10-09) · `STRK-424 image orientation toggle Bar Note legacy landscape` · `STRK-67 item image frame circle rectangle auto` · `discovery.md STRK-427 sanitizer whitelist programmatic grading update async reverse image fallback` (from 2026-10-10, relevance); `get_turns` on session `01a125b2-5b0a-77d0-85bd-d956c361575a` turn 82.
**Plane**: `STRK-427`, `STRK-424`, `STRK-426`, `STRK-371`, `STRK-389` retrieved; `STRK-67/154/241/242` returned 404 (read from `docs/specs/archive` and `.context/` instead).

- 2026-10-10 — mem0 `7162421c-6c84-42e3-bfe3-cf4069a8ecbe`, `33f34cf7-bfd0-4e96-9446-66b2bbb7dcba`: Discovery Brief decisions (graded items auto-derive to Slab; collection shape governs Album Slot framing). The three-cohort split recorded there is superseded by the reconciled two-phase `requirements.md`. Neither record captures the later outcomes (P1 now includes item storage; Slab 0.68).
- 2026-10-08 — STRK-424 (Done, v3.36.44): keep four shapes; Bar defaults portrait, Note landscape; Round/Slab have no orientation; control shown only for Bar/Note; mockup Option C. A stored Bar/Note with no orientation is legacy and reads landscape; only new collections and clones start at the shape default; a Type change that derives the same shape must not reset orientation. (Plane STRK-424; `js/collections-core.js:236-270`.)
- 2026-10-08 — STRK-427 comment and mem0 session summary: the edit-modal preview has never reacted to the frame toggle since v3.34.57, so this is not a STRK-424 regression.
- 2026-05-10 — STRK-67 (`docs/specs/archive/2026-05-10-STRK-67-image-frame-override/approach.md:28,37`, requirements `:104-108, 124-128`): frame fields are sparse (`auto` omitted) and explicitly `delete`d on edit-commit (D-2, D-11); the override belongs to the image, so swap exchanges per-side frame and Remove resets that side to `auto` (AC-13, AC-15). D-10 pre-built per-slot shape classes as "north-star alignment" for per-side portrait/landscape, so per-side orientation is a deferred STRK-67 extension. Graded→rect was an accepted STRK-67 change (requirements `:57-61, 152`).
- 2026-05-14 — STRK-38 (`docs/specs/archive/2026-05-14-STRK-38-rect-image-sizing`): rect items render at **natural aspect** with `object-fit: contain`, and a rectangular table placeholder. P2 (AC-9.1/9.2) intentionally reverses this; its archived tests encode the old contract.
- 2026-05-23 — STRK-101 (`20544398`): added `Obverse Frame`/`Reverse Frame` right after `Reverse Image URL` in both CSVs; tests pin that adjacency.
- STRK-371 (Done): `Collections` is the last CSV column in both lists ("LAST on purpose"); `buildStandardHeaders`/`buildCsvCatalogColumns` and `BACKUP_CSV_HEADERS`/`_backupCsvIdentityCells` are two lists edited together; the zero-diff no-op trap applies to off-item data, not to on-item fields like frames.
- STRK-241 / STRK-242 (`docs/specs/archive/2026-06-27-STRK-242-constitutional-lot-pricing/approach.md:28,55,62,131`): append new hash fields **only** for items that carry them; register a new persisted field at every enumeration site (`DIFF_FIELDS`, `logItemChanges`, CSV headers, backup CSV headers, import reader, JSON export/import). STRK-241's root cause was a field omitted from the hash.
- STRK-154 (`.context/cloud-sync-convergence.md`): compare/merge/hash on normalized logical content; `merge(A,B) = merge(B,A)` including ties.
- STRK-389 (Done): two devices editing the whole collection `definition` before syncing keep only the later edit; the same mechanism bounds the reverse-orientation key.
- STRK-426 (Done, v3.36.45; memory `feedback_surface_token_light_only`): `--surface` is light-only; use `--bg-card`; assert four-theme contrast through a canvas, since computed styles return oklch.
- 2026-09-29/30 downgrade hazard (`.context/implementation-gotchas.md:58-64`; memory `project_beta_cloudflare_branch_alias_downgrade_hazard`): `cleanupStorage()` on an older build wiped Collections; 3.36.35 is the first safe build; STRK-412 tracks rollback. New item fields live inside the inventory array, so they are not key-swept, but older builds still strip or ignore unknown item fields on their own saves.
- Memory `feedback_codex_ui_must_reuse_shared_css` / AGENTS.md UI gates: the builder first shipped bespoke CSS that drifted from the Add Item form; compare both modals side by side in dark and at 390px.
- 2026-10-10 — Codex discovery review (sessionflow `01a125b2…`, turns 73, 82) reports four concerns: CSV column-order conflict, an incorrect sanitizer-whitelist claim, missing programmatic grading/catalog update paths, missing async reverse-image fallback inventory. The `discovery.md` it says it updated is **not** in the repo or this worktree (`docs/specs/STRK-427-unified-image-framing/` held only `requirements.md`). All four are covered above (CSV: section E; sanitizer: section E; programmatic setters: section B; reverse fallback: sections C and G).

## External References

None needed. CSV uses vendored `vendor/papaparse.min.js`, ZIP uses `jszip.min.js`, sync compression `lz-string.min.js`; tests use `@playwright/test ^1.63.0`. The requirements rely only on CSS `aspect-ratio` and `object-fit`, already used in `css/styles.css`. Context7 was not needed. A mem0 retro notes a hand-built CSV hides PapaParse's carriage-return on the last header, so CSV tests should round-trip the real export.

## Constraints

Facts the approach must respect (each from the code above, not a design choice):

- **Resolver contract is pinned.** `resolveImageFrame` returns `"round"|"rect"` and `.bar-shape` is asserted by core tests (`mobile-and-layout.spec.js:198-222`); four production call sites consume the boolean. Those tests cannot be edited to pass.
- **Today's resolver differs from AC-4.2 in three legacy-visible ways.** (a) Type/`weightUnit` rules run **before** grading, so a graded Bar is rect via the Type rule; AC-4.2 puts `gradingAuthority` first (Slab). (b) The Numista non-round rule applies to **any** Type that falls through, whereas AC-4.2 limits it to Coin. (c) `weightUnit` `gb`/`sb` forces rect today; AC-4.2 names Type only, and Goldback/Silverback are currently caught only through `weightUnit`.
- **Legacy `rectangle` can flip to Round.** AC-8.1 maps `rectangle` to the resolver's derived shape for the item's Type and grade. For an ungraded Coin whose Numista shape is round or absent, that is Round, so a stored rectangle override reads as round (today it renders rect, `image-frame.js:33-36`).
- **Un-migrated items can change appearance on upgrade without a save** once the resolver changes, because legacy absence keeps following Type (AC-8.1/8.5).
- **No item-field whitelist exists**; new fields persist through load, edit and clone via object spreads. The one trap is `sanitizeObjectFields` stripping non-alphanumerics from string fields. Values must be alphanumeric or exempted.
- **Sparse write discipline** (STRK-67 D-2/D-11): any new sparse field needs the explicit `delete` on edit-commit (`events.js:1930-1931` pattern), or a stale value survives a revert to default.
- **ZIP backup writes `''` for absent optional fields** (`inventory-backup.js:124-125`). A hash gate on `!== undefined`, or a reader treating `''` as a value, would make restored legacy items look migrated.
- **Hash:** unaffected inventories must keep their existing hash (truthiness-gated append, `cloud-sync.js:158-165`). Devices carrying the new fields will mismatch an older build's hash for the same data and open a pull with an empty field diff (the STRK-241 class).
- **Enumeration sites to cover** for each new item field: `DIFF_FIELDS` (`diff-engine.js:30-94`), `logItemChanges` (`changeLog.js:142-197`), `computeInventoryHash`, ZIP JSON (`inventory-backup.js:121-135`), JSON export (`inventory.js:2554-2596`), JSON import (`inventory-import.js:1564-1602`), standard CSV export + `BACKUP_CSV_HEADERS` + both CSV importers (incl. the test-only parse branch `1848-2006`), `types.js`.
- **JSON export currently omits the legacy frames too**, so AC-8.7's JSON round trip needs an export change for the new fields and for the legacy projection, not only an import change.
- **CSV position constraints** (tests): `Obverse Frame`/`Reverse Frame` must stay immediately after `Reverse Image URL` (`import-export.spec.js:91-100`) and `Collections` must be last (`collections-data-paths.spec.js:406`).
- **Core purity:** `collections-core.js` is DOM-free and evaluated by the unit harness with a hand-built surface; any external dependency must be injected in `loadCore` (`collections-core.test.js:28-45`).
- **Whole-definition merge**: Collections merge picks one side's entire definition; a stripped copy and a full copy serialize differently, so a tie resolves deterministically but not necessarily to the full copy. An older build also advances `metaModified` on its own edits (`updateCustomDefinition` 695, 781), after which the stripped copy wins a later merge.
- **Builder images are committed after the modal closes** (`picker:1671, 1673`); artwork stamps are per-key and independent of the definition. A builder swap would touch both.
- **Shared CSS:** `.image-upload-preview img`, `.image-card`, `.image-upload-sides`, `.image-swap-wrapper` serve Settings → Images too; `.collections-image-pick` serves the Slot-row chooser. New editor CSS must be scoped (AC-1.4).
- **Existing protected selectors:** core specs pin DOM ids `#imageUploadGroup`, `#swapImagesBtn`, `#itemImagePreview{Obv,Rev}`, `#itemImagePreviewImg{Obv,Rev}`, `#itemImageFile{Obv,Rev}`, `#itemImageRemoveBtnObv`, `#itemObverseImageUrl/#itemReverseImageUrl` (`collections.spec.js:349-540`, `inventory-crud.spec.js`, `mobile-and-layout.spec.js:166`), and the lexical `_pendingItemImageSwap` (`collections.spec.js:418-422`). STRK-421/424 tests pin builder selectors and ratios.
- **Tokens:** use `--bg-card` (per-theme), not `--surface` (light-only); `--warning`/`--success` fail contrast; four themes only.
- **Breakpoint:** existing mobile rules are `max-width: 768px` (19 lines), so 768px is mobile today, while AC-6.1/6.2 define desktop as 768px or wider.
- **Both modals are capped near 700px** (`styles.css:5219, 19505`) and full-screen at ≤768px.
- **Two CSV header lists** (`csv-export.js:100-146` 44 columns; `inventory-backup.js:8-47` 37 columns) and their cell builders must change together; the standard list has no `Attachments` column.
- **PR gates:** `events.js` (5551 lines) and `inventory.js` (3357 lines) already exceed the 2500-line Codacy file-size standard noted in memory; whether they are exempt is unconfirmed. The 75% docstring gate and the Codacy duplication gate apply to new code and tests.

## Open Questions

Blocking `approach.md`, grouped. Each cites the evidence; none is answered here.

**Requirements text contradicted by the code. Corrected in `requirements.md` on 2026-10-10 (struck through with a cited callout); only the approach-level remainder stays open:**

- [x] ~~**AC-8.8 names the wrong last column.**~~ Corrected in `requirements.md` AC-8.8 (`Collections` last; frame columns stay after `Reverse Image URL`). Still open for approach: where the new item columns sit, whether the standard (44) and ZIP (37) lists both get them, and whether importers need camelCase aliases.
- [x] ~~**AC-5.2 scope.**~~ Corrected in `requirements.md` AC-5.2 (five surfaces). Still open for approach: which side's orientation applies when a coin shows the other side's image through the title fallback.
- [x] ~~**AC-6.1/6.2 threshold.**~~ Corrected in `requirements.md` (769px or wider / 768px or narrower). Still open for approach: the builder's `max-width: 767px` outlier (`css/styles.css:19686`).
- [x] ~~**AC-1.1 "script-tag order".**~~ Corrected in `requirements.md` AC-1.1. Still open for approach: the exact insertion point in `index.html` and in `sw.js` `CORE_ASSETS`.
- [ ] **AC-1.5 vs markup.** Annotated in `requirements.md` (not struck: it is a requested change, not an error). Still open: should the preview frame render as an empty placeholder, and should shape/orientation (and persisted `imageShape`) be available when the flag is off?
- [x] ~~**AC-8.7 / AC-9.4 inaccuracies.**~~ Also corrected in `requirements.md`: JSON export omits the frames too (`inventory.js:2554-2596`), and AC-9.4 is existing behavior (`collections-album.js:569-599`), now a regression guard.

**Behavior the requirements leave undefined:**

- [ ] **Legacy-visible resolver changes (AC-4.2 vs today).** Are the three differences (grading-first, Coin-only Numista, drop `weightUnit` gb/sb) accepted legacy-visible changes, or must existing items keep today's rect/round output? AC-9.3 covers only P2 rendering.
- [ ] **Legacy `rectangle` fallback (AC-8.1).** What does a stored `rectangle` resolve to when the resolver would return Round (ungraded Coin, round/absent Numista shape), and does the P1 reader still return `rect` for it?
- [ ] **Returning to "follow Type".** AC-7.1 writes sparsely but nothing says how a user clears an explicit shape back to derived on an item (the STRK-67 D-11 equivalent). Which phase/AC owns it? Does AC-3.3 (Remove resets that side's orientation, keeps the shared shape) deliberately differ from STRK-67 AC-15?
- [ ] **"Untouched" baseline at edit-open (AC-4.3/4.4/7.2).** `handleTypeChange` also fires on edit-open, clone, New Item reset, Numista apply and Slot prefill without a `change` event, and the gradingAuthority/Numista setters fire none. How is "previous Type's derived shape" captured at seed time, and which signals notify the editor (AC-4.5)?
- [ ] **Seeding order.** `editItem` seeds frames before `#numistaShape` and the images are populated. Should the editor derive from the item record or from the DOM fields?
- [ ] **Swap and mixed legacy pairs.** For a legacy item whose two sides disagree (AC-8.4), is the reverse side's legacy value cleared on save or kept dual-written? Swap exchanges images and orientation but not the shared shape; is that the intended result?
- [ ] **Host boundary.** Does the editor take over `_pendingItemImageSwap`/generation/`inert` logic, or stay host callbacks? Core tests read the lexical variable and `#imageUploadGroup[inert]` directly.
- [ ] **Hash scope.** AC-8.6 appends only the new fields. Should the legacy `*ImageFrame` fields also enter the hash (closing the existing frame-only blind spot) even though that changes the hash for every framed inventory?
- [ ] **Reverse key name and fallback (AC-5.2/5.3).** The key name is unset. Does absence mean "follow obverse" while the legacy landscape pin still applies when both are absent? Is a reverse value kept or reset on shape change as `updateCustomDefinition` does for the shared value (706-710)? Is deliberate fallback to obverse acceptable even when the stripped copy wins a tie, and does the AC-8.3 matrix need a row for an older-build edit that advances `metaModified`?
- [ ] **Title-image fallback.** `getTitleImage` falls back to the other side's image; which side's orientation applies to a title coin showing a fallback image (nominal side or `resolvedImageSide`)?
- [ ] **Builder swap for stored images.** `imageChooser` holds a `File` only until save and has no `setFile`. Swap blobs and `cover`/`title:reverse` artwork stamps at save time, or only live `File` state?
- [ ] **Shared resolver seam.** How does one resolver, using Item inputs (`gradingAuthority`, Numista shape), reach the pure `collectionsCore` (`window.*` seam like `getUnitOztWeight`, or an inline copy)? The template-backed entry path (`collections-ui.js:701`) passes only Type.
- [ ] **Series Templates vs clones.** Templates always project landscape for Bar/Note while a clone of a template starts at the portrait Bar default. Is that asymmetry kept?
- [ ] **Token scope.** Do the shared `--frame-*` tokens live on `:root` or a new editor class? Today they are scoped to the two collection classes and the item renderers sit outside both. The Slab medallion also carries a 4px border and 3px image padding that a ratio token alone does not capture.
- [ ] **P2 renderer details.** Table thumbs are a fixed 28×28 box: how do Bar/Note/Slab ratios fit at 28px? Which other surfaces are in AC-9 scope (thumb popover `inventory.js:3089-3106`, `bulk-row-images.js`, `diff-modal.js`), and does P2 keep `resolveImageFrame` and `.bar-shape` or supersede the protected core assertions? How are the archived `strk-121-*` matrices (the old natural-aspect contract) handled under `test:legacy`?
- [ ] **Desktop size and modal width (AC-6.1).** May the Add/Edit modal widen beyond ~700px, or must previews grow inside it? No STRK-427 `/ui-mockup` playground exists yet (only STRK-424's single-orientation one), and per-side orientation is not mocked there.
- [ ] **Selector migration.** Moving the builder preview into a shared editor class changes selectors that STRK-421/424 core tests assert (`.collections-builder-covers .collections-image-pick` ratios and widths). How is the migration planned without editing those tests to pass?
- [ ] **Out-of-scope check.** STRK-425 (Auto image shape that follows the uploaded image ratio, low priority) is not mentioned in the requirements; confirm it is out of scope.
- [ ] **File-size gate.** Confirm whether `events.js` (5551 lines) and `inventory.js` (3357 lines) are exempt from the Codacy file-size standard before deciding how much code lands in them versus `js/image-frame-editor.js`.

**Housekeeping:**

- [ ] The Plane Discovery Brief still says three phases and "item storage unchanged / orientation controls hidden in P1", which `requirements.md` supersedes (two phases; AC-5.4 enables item controls in P1). `tasks.md` must follow `requirements.md`; consider updating the Plane description. Plane returned 404 for `STRK-67/154/241/242` and `workitem_relation list`, so linked and blocking issues could not be verified.
- [ ] `.github/copilot-instructions.md:9` states "71 JS files in js/ (70 loaded)" while the tree has 94 `index.html` script tags; adding a file may draw reviewer noise on that stale doc.

## Discovery Summary

The work lands in three places: a new `js/image-frame-editor.js` mounted by `events.js`/`inventory.js` (item modal) and `collections-picker.js` (builder), a rewritten resolver feeding both `image-frame.js` and `collectionsCore`, and item-field plumbing across about nine enumeration sites (`DIFF_FIELDS`, `changeLog`, hash, ZIP/JSON/CSV export and import). The easy parts are the existing sparse-write and hash-append precedents (STRK-67, STRK-241/242) and the fact that Collections' definition persistence is fully covered by one whitelist entry. The tricky parts are the legacy-visible resolver differences, the undefined `rectangle`→Round case, the whole-definition merge that cannot protect a reverse-orientation key, a wider-than-stated reverse-face surface set, and several requirement lines that the code contradicts (AC-8.8's last column, the 768px threshold, "script-tag order", controls visible before an image).

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. The requirement contradictions are corrected in `requirements.md`. The remaining open questions are approach-level decisions (resolver parity, legacy `rectangle` fallback, "follow Type" reset, reverse-key name, shared-resolver seam, token scope, P2 sizing); `/spec-approach` is where they get decided. Then advance: `/spec-approach STRK-427`.
