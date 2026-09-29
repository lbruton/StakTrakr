---
sketch: "STRK-67-image-frame-override"
phase: discovery
created: 2026-05-10
---

# STRK-67 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on. Grouped by role; line numbers are present-tense at the time of discovery (2026-05-10) and may shift if other PRs land before approach._

### The bug surface — three views' current shape predicates

| Path | Role | Notes |
|------|------|-------|
| `js/inventory-table.js:512-520` | `_isRectThumb` predicate | Type-only check (`bar`/`note`/`aurum`/`set`/`gb`/`sb`). Sets `table-thumb-rect` class on the wrapper. Ignores `numistaData.shape` and `gradingAuthority` entirely — root cause for AC-3/AC-4/AC-5. |
| `js/card-view.js:550-557` | `isRect` predicate (sync render) | Same type-only check. **Drives both the `bar-shape` class AND the inline `object-fit` style at `card-view.js:569`**: `object-fit: contain` for rect, `cover` for round. The inline style is the reason a class-only fix would still center-crop slab images. The fix path needs to keep these two in sync (or, with the new resolver, both follow the same predicate). |
| `js/viewModal.js:255-262` | `isRectShape` predicate (sync build) | Same type-only check; sets `view-shape-rect` on `#viewImageSection` at first render. |
| `js/viewModal.js:1173-1180` | Late shape override (`_renderNumistaSection`) | Adds `view-shape-rect` after the Numista API merge if `merged.shape` is non-round. Uses raw lowercase compare `shapeStr !== "round" && shapeStr !== "circular"` — does NOT use `classifyShape()`. Will become a vestigial safety net once the sync build is shape-aware; can stay in place. |

### Async image loaders (read-only context — NOT modified by this sketch)

| Path | Role | Notes |
|------|------|-------|
| `js/inventory-table.js:280-360` | `_enhanceTableThumbnails` + `_loadThumbImage` | IntersectionObserver lazy-load. Resolves CDN URL or IDB blob; sets `<img>.src`. Does NOT touch shape — and won't need to in v2, because shape is decided at sync render time from the resolved frame, not from the resolved image. |
| `js/card-view.js:1058-1148` | `_enhanceCardImages` + `_loadCardImage` | Same pattern. Same simplification — no async shape probe in v2. |
| `js/viewModal.js:1019-1033` (~) | `loadViewImages` | Resolves both sides via `imageCache.resolveImageUrlForItem`. |
| `js/image-cache.js:413` | `getUserImageUrl(uuid, side)` | Allocates a blob URL per call (caller must revoke). v2 does NOT call this for shape detection — replaces the v1 sketch's IDB probe. |
| `js/image-cache.js:474` | `getUserImage(uuid)` | Returns the raw record `{ uuid, obverse: Blob, reverse: Blob, ... }`. Also unused for shape in v2 — we no longer probe IDB for slab detection. |

### Auto-resolution dependency

| Path | Role | Notes |
|------|------|-------|
| `js/catalog-api.js:528-536` | `classifyShape(shapeStr)` | Returns one of `"round" \| "rectangular" \| "square" \| "oval" \| "other"`. Falsy/empty input returns `"round"` — built-in default that AC-6 relies on. |
| `js/catalog-api.js:2661` | `window.classifyShape = classifyShape` | Exposed globally; safe to call from any module without an import. |

### Form save flow (where the new fields get persisted)

| Path | Role | Notes |
|------|------|-------|
| `js/types.js:7-42` | `InventoryItem` JSDoc typedef | Documents the canonical item shape for IDE support. Existing image fields at lines 36-39 (`obverseImageUrl`, `reverseImageUrl`, `obverseSharedImageId`, `reverseSharedImageId`) and `attachments` at line 41 (added by STRK-45). **The two new fields MUST be added here as `@property {"auto" \| "circle" \| "rectangle"} [obverseImageFrame]` and same for reverse.** Easy to miss because the file is documentation-only and not loaded at runtime. |
| `js/events.js:1268-1346` | `parseItemFormFields(isEditing, existingItem)` | Reads form DOM elements into a flat field object. Returns the values that flow into `commitItemToInventory`. **The two new fields will be read here from the toggle's pending state, not from a DOM input** (the toggle is button-driven, not form-control-driven). |
| `js/events.js:1442-1470` | `buildItemFields(f)` | Builds the persisted object shape from parsed fields. Returns ~24 fields including `gradingAuthority`, `certNumber`, `purity`. Top-level image URL fields (`obverseImageUrl` / `reverseImageUrl`) are NOT in this list — they're attached separately during commit. **The two new fields likely belong here OR alongside the URL handling, depending on approach.md's call.** |
| `js/events.js:1476-…` | `commitItemToInventory(f, isEditing, editIdx)` | Writes to `inventory[]`, calls `saveInventory()`, fires `logItemChanges`. Existing add/edit pathway. |
| `js/events.js:1848-1904` | Form submit handler | Top-level handler chain — parse → validate → commit. |
| `js/events.js:233-253` | Pending image state (module-scoped) | `_pendingObverseBlob`, `_pendingReverseBlob`, `_pendingObversePreviewUrl`, `_pendingReversePreviewUrl`, `_deleteObverseOnSave`, `_deleteReverseOnSave`. Module-scoped state for the modal session. **The toggle's pending value should follow the same module-scoped pattern**: `_pendingObverseFrame`, `_pendingReverseFrame`, defaulting to `"auto"`, reset on modal close. |
| `js/events.js:2207-2217` | URL pill button visibility toggle | Click handler that shows/hides the `#itemImageUrlInputObv` / `#itemImageUrlInputRev` URL input wrapper. **No live URL preview today** — there is NO `input`/`change`/`blur` listener on the URL field that updates the preview. Per AC-14, this needs to be added so URL-pasted images become visible (and the Frame toggle becomes reachable) within the same modal session. |
| `js/events.js:2280-2310` | Remove button click handler | Existing handler clears preview, image src, size info, file input, URL field, and sets `_deleteOnSave` flag. **Per AC-15, must also reset that side's `_pendingObverseFrame` / `_pendingReverseFrame` to `"auto"`.** |
| `js/events.js:2336-2406` | Swap obverse/reverse handler (`#swapImagesBtn`, STAK-341) | Atomically swaps pending blobs, preview URLs, delete flags, visible `<img>.src`, URL field values, size-info text, clears file inputs. **Per AC-13, must also swap the two `_pendingObverseFrame` / `_pendingReverseFrame` values in the same operation.** Missing this swap is the dangerous trapdoor — the image moves but its frame preference stays behind, silently corrupting the override semantics. |
| `js/inventory.js:1314-1367` | `editItem(idx, logIdx)` | Populates the modal from `inventory[idx]`. **The new fields must be read into the toggle's initial state here** — read `item.obverseImageFrame || "auto"` and `item.reverseImageFrame || "auto"` into `_pendingObverseFrame` / `_pendingReverseFrame`, and reflect in the toggle's visual state. |
| `js/inventory.js:1407-1408` | URL field hydration on edit | `elements.itemObverseImageUrl.value = item.obverseImageUrl || ""`. URL value goes into the input, but no preview is rendered automatically — the user must click the URL pill button to reveal the field. AC-14's live preview should fire on the existing URL value when the input becomes visible (or be triggered when `editItem` populates a non-empty URL). |
| `js/inventory.js:1544-1550` | URL input wrapper visibility on edit | Shows `#itemImageUrlInputObv` / `#itemImageUrlInputRev` only when the item already has a URL value. Approach.md should decide whether AC-14's live preview should also fire here for items that already have a URL on edit-modal-open. |

> CODEX: The prior code-surface gaps are now covered here: `types.js`, swap, remove, and URL-preview entry points are all called out. For approach.md, I would treat this table as the minimum file map; dropping any of these rows would likely reopen one of the five concerns.

### Migration / load — how legacy items pick up the new fields

| Path | Role | Notes |
|------|------|-------|
| `js/inventory.js:281-364` | `loadInventory()` | Maps every loaded item through a normalize pass that fills missing optional fields with defaults (`gradingAuthority: item.gradingAuthority \|\| ""`, `purity: parseFloat(item.purity) \|\| 1.0`, etc.). **Per AC-10 we explicitly do NOT add `obverseImageFrame: "auto"` here** — absence of the field must remain the canonical default. Adding it would dirty every existing item the first time the user opens the app, polluting cloud-sync diffs and undo/redo. |
| `js/utils.js:1322-…` | `sanitizeImportedItem(item)` | Secondary sanitization pass on imported items. Same rule: do not stamp absent fields. |

### Cloud sync, change log, and the STAK-493 precedent

| Path | Role | Notes |
|------|------|-------|
| `js/diff-engine.js:32-81` | `DIFF_FIELDS` constant | Canonical list of fields compared during cloud sync. Comment at line 30 (and the file header at line 12-13): "When adding a new field to the item schema, add it here too — otherwise cloud sync will silently drop it on matched items (STAK-493)." **`obverseImageFrame` / `reverseImageFrame` MUST be added here.** |
| `js/changeLog.js:80-117` | `logItemChanges` field list | A second, parallel list — comment at line 78-79 explicitly warns that this list MUST stay in sync with `DIFF_FIELDS`. **Adding to one and not the other is the STAK-493 bug.** Both edits are required. |
| `js/cloud-sync.js:365-417` | `syncSaveOverrideBackup` | Uses `SYNC_SCOPE_KEYS` (localStorage-key allowlist). Operates at storage-key granularity, not field granularity — does NOT need updating for new item fields, because inventory is already in scope. |
| `js/inventory-backup.js:352+` | `restoreBackupZip` (and the matching export in the same file) | ZIP backup writes `inventory_data.json` from `loadDataSync(LS_KEY, [])`, so the new fields ride along automatically as part of the JSON blob. Round-trip works without changes (AC-12). |
| `js/api.js:2678+` | `downloadCompleteBackup` | CSV-only backup with explicit field list — does NOT include image URLs or shape today. Image-frame is not relevant in flat CSV output. **No change required.** |

### Modal HTML & CSS (UI surface for the toggle)

| Path | Role | Notes |
|------|------|-------|
| `index.html:1858-1960` | Add/Edit Item modal image group | Class structure validated by the v2 mockup at `artifacts/variant-a-in-modal.html`. The toggle button will be a new child of `.image-upload-preview` (currently `#itemImagePreviewObv` / `#itemImagePreviewRev`). |
| `css/styles.css:3192-3329` | Slot/card/pill styles | `.image-upload-side`, `.image-card`, `.image-card-actions`, `.btn.img-btn-upload` (orange `--primary`), `.btn.img-btn-url` (success-tinted). |
| `css/styles.css:9715-9744` | `#inventoryForm` slot styles | Dashed-border drop zone (`.image-upload-side` gets a 2px dashed border with hover state). The `.image-upload-preview` element does NOT currently have `position: relative` — must be added so the toggle's `position: absolute; bottom/right` lands on the preview, not the dashed wrapper. **One-line CSS prerequisite.** |

### Bulk edit & diff (out of scope per requirements)

| Path | Role | Notes |
|------|------|-------|
| `js/bulkEdit.js:54+` | Bulk-editable field list | Per requirements Non-Goals, NOT extending bulk edit in v1. Listed here so a future follow-up issue knows where to add it. |

### Tests

No existing Playwright tests cover image-shape rendering on the inventory grid views. A search for `table-thumb-rect`, `bar-shape`, `view-shape-rect`, or `shape` in `tests/playwright/*.spec.js` returned only unrelated tests (capsule field, Numista picker tags, view-modal-no-auto-resync). **New tests are required for all 15 acceptance criteria (AC-1 through AC-15)**, including the three later additions: AC-13 (frame swap on `#swapImagesBtn`), AC-14 (live URL preview on URL field input), and AC-15 (remove resets the frame to `auto`). Closest existing patterns to crib from: `tests/playwright/view-modal-no-auto-resync.spec.js` for view-modal interaction; `tests/playwright/numista-picker-tags.spec.js` for modal form-field manipulation; STRK-45's `tests/playwright/attachment-manager.spec.js` and `tests/playwright/attachment-ui.spec.js` for the same shape of "new persisted field with modal UI" coverage.

## Prior Decisions

_Search mem0 and recent sessions for related decisions. Quote the relevant memory or commit, with date._

- **2026-05-09 — STRK-45 (per-item PDF/image attachments)** shipped as squash `9dc1888a` (and follow-up STRK-65 as `93bcad0b`). This is the closest precedent for "add a new optional field to inventory items that must round-trip through cloud sync, ZIP backup, and view rendering." The STRK-45 implementation added `attachments` to `DIFF_FIELDS`, taught `logItemChanges` to handle it (with a coarse one-record-per-item rule because it's array-shaped), and exercised the same migration philosophy of "absent = empty default; do not stamp on load." mem0: `25b67ec5-3fd0-4feb-8050-f250a39c4400`. **Approach.md should mirror STRK-45's pattern for the two new scalar string fields, minus the array complexity.**
- **2026-04-19 — STAK-556 (Numista picker tag checkboxes + userModified flag)** introduced the `fieldMeta` system at `js/field-meta.js:21` for tracking per-field origin (`source: "numista" | "user"` / `userModified: bool`). v1 sketch considered and rejected extending `fieldMeta` to `obverseImageUrl` / `reverseImageUrl` for image-origin tracking. **v2 inherits that rejection** — the Frame override field makes origin tracking unnecessary for this issue (Non-Goals).
- **STAK-493 (silent data loss in cloud sync)** is the load-bearing precedent for the dual-list update. Comments survive in `diff-engine.js:13`, `:30`, `:68`, `cloud-sync.js:3015`, `changeLog.js:79`. The bug pattern: a new persisted field added to `buildItemFields` but missed in `DIFF_FIELDS` and `logItemChanges` would round-trip locally but silently disappear when remote sync merged a matching item. **Approach.md must explicitly enumerate both list updates as mandatory tasks.**
- No prior decision in mem0 covers the per-side image frame override or render-time shape resolution — this is greenfield surface inside StakTrakr.

## External References

- **Variant A mockup (selected UI):** `artifacts/variant-a-in-modal.html` — interactive Variant A in a faithful reproduction of the production modal. Defines the exact DOM placement, sizing, and cycle interaction the implementation must match.
- **Variant comparison (decision audit trail):** `artifacts/frame-toggle-mockups.html` — four-variant interactive comparison; preserved for traceability of why Variant A was chosen.
- **Spec Kit `[P]` parallel marker convention** (referenced in sketch tasks template) — already in use across StakTrakr sketches; tasks.md will use it for the three view-predicate edits, which are independent and safe to parallelize.
- **No external libraries needed.** No new dependencies. Implementation is pure vanilla JS + CSS, consistent with StakTrakr's no-build-step ethos.

## Constraints

_Things the implementation must respect: existing APIs, performance budgets, browser support, data shapes._

- **No build step.** Vanilla JS, plain `<script>` tags. New code lives in existing modules or in a new bare `js/<file>.js` file added to `index.html` script tags in load order.
- **Script load order matters.** `events.js` loads BEFORE `init.js` (both `defer`). Top-level code in `events.js` cannot call `safeGetElement` — that helper is defined in `init.js` and isn't available at parse time. Factory closures within `events.js` are fine (they execute at runtime). Toggle wiring must respect this if any setup runs at module top level.
- **localStorage write path is `saveData()`, NOT raw `localStorage.setItem`.** The wrapper does `JSON.stringify`. Any reader must use `loadData()` / `loadDataSync()` to deserialize. Inventory is read/written as a whole array via `LS_KEY` — the new fields ride along automatically.
- **The two new fields are scalar strings, optional, and storage-lean.** Per AC-10 absence ≡ `"auto"`. Persisting `"auto"` explicitly is allowed (and may be necessary if a user cycles into and back out of an override) but writing it on legacy items at load is forbidden. Approach.md should decide the on-save rule (omit when `"auto"`? always persist?).
- **`stamp-sw-cache` pre-commit hook** auto-stages `sw.js` when JS/CSS/image files commit. No manual sw.js edits.
- **`check-release-sync` pre-commit hook** validates version files; not relevant during sketch implementation, only at the closing `/release patch` task.
- **Squash-merge only** to `dev` via worktree + PR. `dev` is protected.
- **Cloud sync field list is dual-listed.** `diff-engine.js:DIFF_FIELDS` AND `changeLog.js:logItemChanges` MUST both be updated, both in the same PR. Updating only one re-creates STAK-493.
- **Plane issue #STRK-67's body still describes the v1 fix.** Approach.md should note that the issue body's "Proposed Fix" section was superseded by the v2 sketch; otherwise reviewers may compare implementation to the wrong specification.
- **CSS prerequisite:** `.image-upload-preview` does not have `position: relative` today. The toggle's absolute positioning depends on it. This is a one-line CSS edit, but it's load-bearing — must be in the file map.
- **Performance budget unchanged.** Sync render path (Phase 1 of v2 design) adds one function call per row to `classifyShape()` — sub-microsecond, immaterial. No new IDB lookups, no new network calls, no new async work.

## Open Questions

_Things that need answering before approach.md can be written. If non-empty, stop here and resolve with the user._

_None._ Discovery resolved every prerequisite. The remaining decisions (where the resolver helper lives, when to persist `"auto"` vs omit, how the toggle module wires its event listeners) are pure approach-phase choices, not blockers.

## Discovery Summary

The implementation surface is well-bounded but has more sharp edges than a quick read suggests. **The shape of the work**: three sync-render predicates in `inventory-table.js`, `card-view.js`, `viewModal.js`; one new modal control under `.image-upload-preview` in `index.html`; one CSS prerequisite (`position: relative`); the STAK-493 dual-list update across `diff-engine.js`, `changeLog.js`, AND the JSDoc typedef in `types.js`; module-scoped pending-state in `events.js` mirroring the existing `_pendingObverseBlob` pattern, threaded through the **swap** (`events.js:2336`), **remove** (`events.js:2280`), and **edit-modal-open** (`inventory.js:1314`) handlers; a small new live-URL-preview listener (AC-14) on the URL inputs to make per-image overrides reachable for URL-pasted images; and the auto-resolution rule itself, which reuses the already-window-exposed `classifyShape` helper.

**Four tricky details to flag for approach.md:**
1. **`card-view.js:569` inline `object-fit`.** A class-only fix leaves slab images center-cropped — the resolver must drive both the wrapper class AND the `<img>` `objectFit` for the card view.
2. **STAK-493 dual-list update.** `DIFF_FIELDS` (diff-engine.js) and the field array inside `logItemChanges` (changeLog.js) MUST both gain `obverseImageFrame` and `reverseImageFrame`; updating only one re-creates the silent-sync-loss bug. Plus the JSDoc typedef in `types.js` for IDE completeness.
3. **No live URL preview today.** AC-14 adds one. Without it, AC-7's "image preview is visible" precondition is unreachable for URL-pasted images, and US-4 (URL-pasted slab override) cannot be exercised in a single modal session.
4. **Per-image semantics enforcement.** AC-13 (swap) and AC-15 (remove) commit to "the override travels with the image, not the slot." Missing the frame-pair swap inside the existing `#swapImagesBtn` handler would silently corrupt overrides — the visible image moves but its preferred frame stays behind. Missing the reset-on-remove would leave stale preferences haunting a slot after the user uploads a different image.

> CODEX: This summary is accurate and ready to hand to the Approach phase. One small tasking note: the tests line above still says AC-1 through AC-12, but the requirements now run through AC-15. Approach/tasks should expand the planned coverage to include swap, URL live preview, and remove-reset.

STRK-45 (attachments) remains the closest precedent — same shape of work for cloud-sync, change-log, and types.js integration. The expanded scope from Codex's review (types.js, swap, URL preview, remove-resets) adds three small handler edits and one JSDoc edit; none individually is large, but each is load-bearing for the per-image semantic the requirements now commit to.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-67`.
