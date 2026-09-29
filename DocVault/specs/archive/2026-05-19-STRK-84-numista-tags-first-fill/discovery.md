---
sketch: "STRK-84-numista-tags-first-fill"
phase: discovery
created: 2026-05-18
---

# STRK-84 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| `js/catalog-api.js:2380-2406` | Fill Fields tag application block (STAK-556) | Gates checked-tag write on `_fillUuid`. In Add mode `editingIndex === null`, so `_fillUuid` is `null` and the entire block no-ops. Also clears `itemRemovedTags` for re-imported tags — also gated. |
| `js/catalog-api.js:2408-2432` | STRK-52 on-item removal walk | Same `_fillUuid` gate. Iterates `input[name="numistaTag"]` and records opt-outs for unchecked checkboxes whose `dataset.onItem === "1"`. For a brand-new item, **no** checkbox has `data-on-item="1"` (set only in the `isOnItem` branch of the renderer at line 1940), so even with `_fillUuid` populated this loop currently produces zero removals on Add. |
| `js/catalog-api.js:2382-2385` | `_fillUuid` resolution | `_fillIdx = editingIndex` or `null`; `_fillItem = inventory[_fillIdx]`; `_fillUuid = _fillItem?.uuid`. Resolves at Fill-Fields button time, not at submit time — a fundamental ordering mismatch with Add. |
| `js/catalog-api.js:1840-1981` | `renderNumistaFieldCheckboxes` tag-section renderer | Checks default to `!!numistaTagsAuto` (true by default) for tags not on-item, not removed, not blacklisted. `cb.dataset.tag = capitalized` is the stable tag identifier on each checkbox. |
| `js/catalog-api.js:1858-1870` | Tag-section state lookup | `editingUuid` drives `getItemTags()` / `loadRemovedTags()`. In Add flow `editingUuid` is falsy → empty `itemCurrentTags` and `removedTags`, so no checkbox gets `data-on-item="1"` or `(removed)` hint. |
| `js/catalog-api.js:2873-2890` | Fill Fields button handler | Calls `fillFormFromNumistaResult()` (which runs the gated tag block) then `closeNumistaResultsModal()`. The picker DOM is destroyed before form submit — any state we want to carry forward must be captured before close. |
| `js/catalog-api.js:1164, 2022, 2116, 2456, 2916` | `selectedNumistaResult` module-scoped global | Holds the picked Numista result. Nulled in `closeNumistaResultsModal` (line 2456). Declared with `let` — NOT on `window`. `events.js` reads `window.selectedNumistaResult` in 7 locations (lines 1703, 1707, 1848, 1853, 1857, 1895, 1897) — all evaluate to `undefined` (namespace isolation gap between script-tag files). |
| `js/events.js:1894-1898` | **STAK-126 add-mode auto-tag fallback** (dead code) | Calls `applyNumistaTags(newUuid, window.selectedNumistaResult.tags)` at form submit — but `window.selectedNumistaResult` is never set (see row above), so the `if` guard always evaluates to `undefined` and `applyNumistaTags` is never called. No working tag write path exists for Add-mode items. Any tags that appear on Add-flow items come from `numistaData` in the item object, not `itemTags` entries. |

| `js/events.js:1838-1862` | Add-branch row creation in `commitItemToInventory` | `inventory.push({ ..., uuid: generateUUID(), ... })`. UUID minted only at submit. |
| `js/events.js:1828` | `editingIndex = null` (edit-branch postlude) | Edit-branch cleanup. **Not** the Add Item entry point — requirements correctly cite `events.js:3938-3966` for that. |
| `js/events.js:3938-3966` | New Item button handler | Clears `editingIndex = null` and `editingChangeLogIndex = null` at the moment the Add modal opens. This is why `_fillUuid` is null when Fill Fields fires inside the Add flow. |
| `js/events.js:2039-2089` | `setupItemFormListeners` submit handler | Captures `isEditing = editingIndex !== null` then calls `commitItemToInventory(fields, isEditing, editingIndex)`. Right after commit, the new row is at `inventory[inventory.length-1]`. Clone-mode handling (lines 2069-2089) is a precedent for "act on the just-committed row" — it reaches into `inventory[inventory.length - 1]` and calls `addItemTag` / `saveItemTags` for clone-source tag copying. |
| `js/tags.js:45-58` | `saveItemTags()` | Persists `itemTags` then calls `scheduleSyncPush()`. Any write goes to BOTH localStorage and the Dropbox sync queue. |
| `js/tags.js:366-418` | `applyNumistaTags(uuid, numistaTags, persist, force, respectEdits)` | Add-only (never removes). `persist=true` is the default — saves and sync-pushes inside the function. Filters blacklisted; with `respectEdits=true` filters previously-removed. **No filter for "user unchecked this in the picker"** — that filtering must happen at the call site. |
| `js/tags.js:130, 324-353` | `removeItemTag` / `addRemovedTag` / `loadRemovedTags` / `clearAllRemovedTags` | Mechanics of the `itemRemovedTags` UUID-keyed map. `removeItemTag` internally calls `addRemovedTag`. Same persistence + sync-push pattern as `saveItemTags`. **Add-mode limitation:** `removeItemTag()` returns false when `itemTags[uuid]` is absent (line 124) — for an unchecked default Numista tag that was never stored, it cannot record the opt-out. AC-2 requires direct `addRemovedTag()` write after the new UUID exists. |
| `js/constants.js:608-609, 831-835, 997` | `ITEM_TAGS_KEY = "itemTags"` + sync/allowlist registrations | Confirms `itemTags` is in `SYNC_SCOPE_KEYS` and `ALLOWED_STORAGE_KEYS`. Confirms `itemRemovedTags` is in `ALLOWED_STORAGE_KEYS` (queried separately — see Constraints). |
| `js/inventory-import.js:35-90, 275, 468, 553-559` | **`pendingTagsByUuid` deferred-application pattern** | Closest in-repo prior art for deferred tag side effects: builds a Map of pending tag lists during parse, walks the Map after import confirmation and calls `addItemTag` + `saveItemTags`. Import rows already have UUIDs during parse (minted at lines 844, 1292); the transferable pattern is "defer side effects until the item exists and the user has confirmed," not the UUID-minting timing specifically. |

| `js/utils.js:55-67` | `generateUUID` | crypto.randomUUID with CSPRNG fallback. Nothing about new-UUID minting blocks pre-allocation — the function is cheap and synchronous. |
| `tests/playwright/numista-picker-tags.spec.js:93-199` | `seedData` / `stubCatalogLookup` / `gotoApp` / `openEditForm` / `openNumistaPicker` helpers | All seed at least one inventory row and open the picker via `openEditForm()` → `editItem(idx)`. Every existing test enters through the Edit path. |
| `tests/playwright/numista-picker-tags.spec.js:486-517` | Test 5 — "Fill Fields only imports checked tags" | Closest existing coverage. Seeds `BASE_ITEM`, opens **edit**, opens picker, unchecks Eagle, clicks Fill Fields, asserts saved tags. Passes today because Edit flow has a non-null `_fillUuid`. **Does not cover the bug.** |

## Prior Decisions

- **2026-04-19 — STAK-556 shipped per-tag checkboxes + `itemRemovedTags` tracking** (PRs #993, #995; commits 89f8e357, 55c78acc). Decision was that `applyNumistaTags()` stays minimal/add-only; gating happens at call sites. The STRK-84 bug is a direct consequence of that decision combined with the `_fillUuid` resolution timing.
- **2026-05-08 — STRK-51 shipped userModified protection** for Numista Data tab fields (mem0 `36e85244-7315-4978-91ed-8ce0eaf1e806`). Reinforces the pattern that *user picker choices override defaults* — STRK-84 is the tag-side counterpart of the same product principle for Add flows.
- **2026-05-08 — STRK-52 shipped on-item removal walk** (mem0 `76366663-406b-4db2-8c76-7a2bec849079`; PR #1095, commit 4e154212). Replaced the `disabled` lock on on-item tags with the `data-on-item` dataset marker so the picker walk could distinguish "on the item, unchecked → opt-out" from "not on the item, unchecked → never wanted". The walk's `_fillUuid` precondition is inherited from STAK-556 and is the structural shape STRK-84 must extend.
- **2026-02-26 — STAK-346 (tags-optional-on-import)** decided per-callsite gating of `applyNumistaTags` rather than internal gating. Establishes the architectural precedent: the picker is the place that decides which tags get applied, not `applyNumistaTags` itself.
- **STAK-126 (commit 282fa593, ~late 2025) — original auto-tag fallback** at `events.js:1895-1897`. Predates the per-tag-checkbox picker. Was correct at the time (no picker existed); is now dead code — `window.selectedNumistaResult` is never set (namespace isolation), so the fallback never fires. No tag write path currently exists for Add-mode items. Removing it carries zero regression risk.

## External References

- _none_ — this is an internal flow with no external library or RFC counterpart. The directly applicable prior art (`pendingTagsByUuid` in `inventory-import.js`) is in-repo and cited above.

## Constraints

- **Zero-build, vanilla JS, script-tag globals.** Anything new must be loaded in correct script order — `tags.js` and `catalog-api.js` already share global namespace with `events.js`, so a deferred-application helper can live in any of them without new wiring.
- **`safeGetElement` is NOT available at parse time in `events.js`** (script order). Event-wiring code at top level must use `document.getElementById`. Runtime closures inside handlers are fine.
- **`itemTags` is in `SYNC_SCOPE_KEYS` (`constants.js:831-835`).** Any approach that persists tags before form submit lands a cloud-sync push for state the user may then cancel. Orphan cleanup must cover BOTH local storage AND the queued sync push.
- **`itemRemovedTags` is in `ALLOWED_STORAGE_KEYS`** (verified in code) but is **NOT** in `SYNC_SCOPE_KEYS` at constants.js:831-867 — it is a local-only opt-out store. Approach must avoid implying cloud-sync semantics for removal records.
- **STAK-126 fallback at `events.js:1895-1897` is dead code.** `window.selectedNumistaResult` is never set (namespace isolation), so the guard always evaluates to `undefined`. Removing it carries zero regression risk. Any new tag write path for Add flows is an addition, not a replacement.
- **`selectedNumistaResult` namespace isolation.** Module-scoped `let` in `catalog-api.js` ≠ `window.selectedNumistaResult` in `events.js`. `closeNumistaResultsModal()` nulls the `let` variable; `window.selectedNumistaResult` was never populated. The `events.js` references (7 locations: fieldMeta, imageUrl, reverseImageUrl, tags) are all dormant.
- **Bridging `selectedNumistaResult` to `window` has broad side effects.** A `window.selectedNumistaResult = ...` bridge would activate not just the tag fallback but also image URL and `fieldMeta` fallbacks in `events.js` (lines 1703, 1707, 1848, 1853, 1857). If approach chooses this path, regression coverage must extend beyond tags.
- **`addItemTag` writes synchronously to in-memory `itemTags`.** Calling it before `saveItemTags()` does NOT persist or sync — useful for staging.
- **TDD requirement (project standard).** The fix must be driven by a failing Playwright test that exercises the missing-UUID Add path. The existing `numista-picker-tags.spec.js` helpers all seed inventory and use `openEditForm()` — a new helper that opens the Add modal from empty inventory and routes the picker through that modal is required (already called out in AC-4).
- **Tag checkbox identity is `cb.dataset.tag` (capitalized).** Any "snapshot the checkbox state" approach can rely on `dataset.tag` + `cb.checked` as the stable representation. `cb.dataset.onItem` is set only for on-item tags (always empty on Add) and `cb.disabled` is set only for blacklisted (always to be excluded).
- **Clone-mode precedent at `events.js:2069-2089`** acts on `inventory[inventory.length - 1]` immediately after `commitItemToInventory`. Same window is available to Add-mode tag application — this is the architecturally cleanest hook point, although discovery does not pick a side.

## Open Questions

- [x] **Q1 — RESOLVED: `window.selectedNumistaResult` is never set.** The module-scoped `let` at `catalog-api.js:1164` does NOT create a `window` property. All 7 `events.js` references evaluate to `undefined`. The STAK-126 fallback never fires. The timing question is moot. Approach must decide: (a) bridge the variable to `window`, or (b) avoid it entirely via a different state-passing mechanism (see Q3 option c).
- [ ] **Q2 — Should the AC-2 contract expansion (unchecked default-on Numista tags on Add become `itemRemovedTags`) persist to localStorage on every Add, or only when the user explicitly unchecked at least one tag?** Verbatim recording of every unchecked tag adds noise (most Add flows leave defaults alone) and bulks the `itemRemovedTags` map; recording only when the user touched the checkbox preserves intent but requires tracking a "user-interacted" flag on each checkbox. Decision is product-shape, deferred to approach phase. AC-2 currently says "the user un-checks one of those default-on tags" — implying the latter; flag for explicit confirmation.
- [x] **Q3 — RESOLVED: STAK-126 fallback is dead code; remove it.** The fallback never fires (`window.selectedNumistaResult` is never set). The auto-pick path at `catalog-api.js:2116` sets module-scoped `selectedNumistaResult` only — does NOT propagate to `window`. Removing the fallback is zero-risk. The remaining approach question is what replaces it: (a) bridge `selectedNumistaResult` to `window` (activates dormant image/fieldMeta behavior — needs regression coverage), (b) new dedicated tag-write path at submit time, or (c) snapshot picker checkbox state at Fill Fields time, store as pending form state, consume after `commitItemToInventory()` creates the UUID — keeps image/fieldMeta behavior dormant.

## Discovery Summary

The bug reduces to a single root cause: the Fill Fields tag block gates on `_fillUuid`, which is `null` in Add mode because no UUID exists at picker time. No alternative tag write path exists — the STAK-126 fallback at `events.js:1895-1897` is dead code (`window.selectedNumistaResult` is never set due to namespace isolation). The fix surface is small: a state-snapshot or deferred-application mechanism at Fill Fields time, consumed after `commitItemToInventory()` mints the UUID. The repo has precedent for deferred side effects (`pendingTagsByUuid` in `inventory-import.js`). One open question remains (Q2: when to record opt-outs). The test surface is well-isolated (one spec file, one new Add-mode helper, one new test case) and `applyNumistaTags` needs no internal changes — only a new call site after UUID minting. `removeItemTag()` cannot handle Add-mode opt-outs (tag never stored); direct `addRemovedTag()` is needed for AC-2.

---

> **Phase complete.** Existing code mapped. Prior decisions surfaced. Open questions resolved (Q1, Q3) or logged for approach (Q2). Next: `/sketch approach STRK-84`.

## Review Archive — discovery (2026-05-18)

_Reconciled by /sketch reconcile on 2026-05-18. Original reviewer marks preserved below for audit._

### GLM

#### Verified

- **Line numbers** for `catalog-api.js:2380-2406` (Fill Fields tag block), `2408-2432` (STRK-52 walk), `2382-2385` (`_fillUuid`), `1858-1870` (tag state lookup), `2873-2890` (Fill Fields handler), `2456` (`closeNumistaResultsModal`), `2116` (auto-pick) — all confirmed against live source.
- **`events.js:1838-1862`** Add-branch row creation, `1894-1898` STAK-126 fallback, `2039-2089` submit handler with clone-mode precedent, `3938-3966` New Item button — all confirmed.
- **`tags.js:45-58`**, `366-418`, `123-145`, `324-362` — confirmed add-only semantics, persistence patterns, removal tracking.
- **`inventory-import.js:35-50`** — `pendingTagsByUuid` deferred pattern confirmed.
- **`constants.js`** — `itemTags` in `SYNC_SCOPE_KEYS` (line 834), `itemRemovedTags` in `ALLOWED_STORAGE_KEYS` (line 1037) but NOT in `SYNC_SCOPE_KEYS` — confirmed.
- **`utils.js:55-67`** — `generateUUID` with CSPRNG fallback confirmed synchronous.
- **Test file** — only covers Edit flow, no Add-mode coverage — confirmed.
- **`renderNumistaFieldCheckboxes`** (1840-1981) — default `!!numistaTagsAuto` for non-on-item tags, `dataset.tag = capitalized` identity, `dataset.onItem` set only in edit — all confirmed.

#### Top concerns

1. **CRITICAL: `window.selectedNumistaResult` is never set.** `catalog-api.js:1164` uses `let selectedNumistaResult = null`, which does NOT create a `window` property (`let` in script scope is block-scoped, not `window`-scoped). `events.js` references `window.selectedNumistaResult` in 7 locations — all resolve to `undefined`. The STAK-126 fallback at `events.js:1895-1897` is **dead code** that never fires. The entire premise of Q1 (when does this go null?) is moot for events.js. This is the single most load-bearing finding of the review because it reframes the bug: there is no working tag write path for Add flows at all — not even an imperfect one.

2. **Discovery line 22 claims "some tags appear post-save" via the STAK-126 fallback, but this is incorrect.** If tags appear on Add-flow items, they must come from `numistaData` field storage (the item object stores `numistaData` which includes tags as data, but those are scalar metadata fields, not `itemTags` entries). Approach phase must verify with a Playwright test whether any `itemTags` entries exist after a standard Add-flow without the picker — the answer is likely "no."

3. **Q3 is dramatically simplified by finding #1.** The STAK-126 fallback isn't load-bearing — it never fires. Removing it is zero-risk. The real question becomes: should the fix bridge `selectedNumistaResult` to `window` (for cross-module access), or should it avoid the global variable entirely (e.g. by capturing checkbox state in the Fill Fields handler and carrying it to submit via a different mechanism)?

#### Unverified assumptions

1. **Assumption**: Tags that appear on Add-flow items today come from `numistaData` stored in the item (scalar field storage) rather than from `applyNumistaTags` (itemTags map). This needs Playwright verification — create an item via Add without the picker, then check `localStorage.getItem('itemTags')` to confirm zero tag entries. If any tags exist, there's an undiscovered write path.
2. **Assumption**: No other code path bridges `selectedNumistaResult` to `window`. I searched all `.js` files and found no `window.selectedNumistaResult =` assignment. If there's a runtime-only bridge (e.g. via eval, dynamic script injection, or a dependency I missed), the STAK-126 fallback could theoretically fire — but this is extremely unlikely in a zero-build app.
3. **Assumption**: The auto-pick path at `catalog-api.js:2116` sets module-scoped `selectedNumistaResult = results[0]` but since there's no `window` bridge, `events.js` can't see it. If the fix bridges the variable, the auto-pick path also needs the bridge (or needs explicit handling).
4. **Assumption**: Discovery line 24 (`js/events.js:1828`) is described as "edit-branch postlude" but the actual line references may have shifted. The New Item handler at `events.js:3938-3945` (lines verified) correctly sets `editingIndex = null`.

### Codex

#### Verified

- `js/catalog-api.js:1164`, `2022`, `2116`, `2456`, `2916`: `selectedNumistaResult` is module/global-lexical state, not assigned onto `window`.
- `js/events.js:1703`, `1707`, `1848`, `1853`, `1857`, `1895`, `1897`: add/edit submit code reads `window.selectedNumistaResult`, so the dormant selected-result problem is broader than tags.
- `js/catalog-api.js:2380-2432`: checked-tag application and STRK-52 on-item removal both require `_fillUuid`.
- `js/tags.js:123-130`, `331-340`, `366-418`: `removeItemTag()` cannot record an Add-mode opt-out for a tag that was never stored; `addRemovedTag()` is the direct removed-tag primitive; `applyNumistaTags()` adds only.
- `js/inventory-import.js:37-50`, `553-564`, `844`, `1292`: import tag deferral is real, but import items already have UUIDs before pending tag application.
- `tests/playwright/numista-picker-tags.spec.js:93-199`, `486-517`: current helpers and coverage exercise seeded Edit flow, not a true Add Item flow.

#### Top concerns

1. The dead `window.selectedNumistaResult` path should not be treated as tag-only. Bridging it would also activate image URL and `fieldMeta` fallbacks in `events.js`, so approach needs to either avoid the bridge or test those side effects.
2. AC-2's new Add-mode opt-out behavior cannot rely on `removeItemTag()` as currently shaped, because unchecked default Numista tags are absent from `itemTags` and `removeItemTag()` exits before writing `itemRemovedTags`.
3. `pendingTagsByUuid` is good precedent for deferred post-confirmation side effects, but it is not a one-to-one UUID-minting analogue; approach should use the pattern carefully rather than inherit the import keying shape by default.

#### Unverified assumptions

1. The preferred implementation will snapshot picker state at Fill Fields time and consume it after submit, instead of pre-allocating UUIDs or bridging `selectedNumistaResult` to `window`.
2. Add-mode unchecked default tags should be written directly to `itemRemovedTags` only when the user actually unchecked them, not for every unchecked/non-default tag in the picker.
3. Removing the dead STAK-126 fallback is acceptable cleanup inside STRK-84, even though leaving it inert would also be functionally safe.
4. No manual browser reproduction is required before approach; this review verified source paths only and did not run tests or the app, per sketch-review constraints.

### Resolution Summary

- Accepted: 9
- Rejected: 1 (events.js:1828 line reference concern — body already correctly labels it as edit-branch postlude)
- Resolved with your input: 0
