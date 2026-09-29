---
sketch: "STRK-52-numista-resync-tag-membership"
phase: discovery
created: 2026-05-08
---

# STRK-52 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| `js/catalog-api.js:1453` | `renderNumistaFieldCheckboxes()` — renders the entire field + tag picker UI | Tag-picker subsection lives at lines 1856–1978; this is the primary surface for STRK-52. |
| `js/catalog-api.js:1872` | `tagList = result.tags || (selectedNumistaResult && selectedNumistaResult.tags) || []` | Picker iterates *only* the Numista result's tag list, so manual-only tags never enter the loop (relevant to AC-4). |
| `js/catalog-api.js:1910–1911` | Blacklist detection via `isTagBlacklisted(capitalized)` | Blacklisted tags rendered unchecked + disabled + `(blacklisted)` hint (lines 1930–1937). Must remain protected by Check/Uncheck-all (AC-10). |
| `js/catalog-api.js:1912` | `isOnItem` detection | `itemCurrentTags.some((t) => t.toLowerCase() === capitalized.toLowerCase())` — case-insensitive match already correct (AC-5, AC-6). |
| `js/catalog-api.js:1914` | `removedTags.some((t) => t.toLowerCase() === capitalized.toLowerCase())` | Removed-opt-out detection is already case-insensitive. |
| `js/catalog-api.js:1938–1946` | **Bug site** | Sets `cb.checked = true; cb.disabled = true;` for existing-on-item tags. AC-1/AC-2/AC-3 require `disabled = false` while preserving the visible "on item" hint. |
| `js/catalog-api.js:1967–1977` | Check-all / Uncheck-all handlers | Both currently skip `cb.disabled`. Once the existing-tag `disabled` is removed, these handlers will need a new guard (or a class/data-attribute) to honor AC-9 / AC-10. |
| `js/catalog-api.js:2011` | `showNumistaResults()` | Modal entry point; sets `selectedNumistaResult` global at line 2019. |
| `js/catalog-api.js:2377–2403` | Fill Fields handler | Calls `applyNumistaTags()` (2388) and clears removal tracking for re-checked tags (2393–2402). No explicit removal path today because unchecked tag checkboxes are not inspected at submit. |
| `js/tags.js:123–145` | `removeItemTag(uuid, tag)` | Removes by exact string match (`t === tag`) before calling `addRemovedTag()`. This is a case-sensitivity hazard for AC-6 if the picker passes Numista's normalized candidate text while the item stores a different casing. |
| `js/tags.js:259–267` | `loadTagBlacklist()` | Global blacklist source. |
| `js/tags.js:282–286` | `isTagBlacklisted()` | Used in picker render. |
| `js/tags.js:324–362` | `loadRemovedTags(uuid)`, `addRemovedTag(uuid, tag)`, `clearRemovedTag(uuid, tag)` | `itemRemovedTags` storage shape: `{ [uuid]: string[] }` in localStorage. `addRemovedTag` capitalizes on entry; `clearRemovedTag` uses case-insensitive comparison (AC-6, AC-7). |
| `js/tags.js:391–392` | Tag capitalization helper (first-letter upper) | Determines stored case for new tags via `addItemTag()`. |
| `js/inventory.js:1832` | JSON export payload | Includes `itemRemovedTags: loadDataSync("itemRemovedTags", {})` — round-trips opt-outs across exports. |
| `js/inventory-import.js:546–560` | CSV import | Parses `removedTags` column into `itemRemovedTags`. |
| `js/inventory-import.js:1031, 1087` | CSV export | Header `"removedTags"`, value `Array.isArray(_removedTagsMap[i.uuid]) ? _removedTagsMap[i.uuid].join("; ") : ""`. |
| `js/inventory-import.js:1167–1169, 1395–1397` | JSON / STVAULT import | Restores `parsedRemovedTags` from payload. |
| `tests/playwright/numista-picker-tags.spec.js:61–71` | Test fixture `NUMISTA_RESULT` | Tags `["Bullion", "Eagle", "Investment"]` — likely reusable for STRK-52 tests. |
| `tests/playwright/numista-picker-tags.spec.js:281–298` | Test 3 — "already-present tags checked and disabled" | Asserts `toBeDisabled()` at line 293; this test currently codifies the bug and must be reframed (see Constraints). |
| `tests/playwright/numista-picker-tags.spec.js:379–424` | Test 6 — Check/Uncheck-all locked states | Existing coverage for AC-9 / AC-10 baseline. |
| `tests/playwright/numista-picker-tags.spec.js:508–546` | Test 9 — Removed tag tracking and hint | Existing coverage for AC-3 / AC-7 baseline. |
| `tests/playwright/numista-picker-tags.spec.js:591–748` | Tests 11–13 — JSON/CSV/STVAULT export-import round-trip with `itemRemovedTags` | Confirms storage shape is part of the public data contract. |

## Prior Decisions

- 2026-05-08 — STRK-51 expanded the Numista import modal field set (commit `4ed3080c`); the modal layout, render entry, and `selectedNumistaResult` plumbing referenced above are post-STRK-51 shape. STRK-52 inherits that surface unchanged.
- 2026-05-08 — STRK-55 (commit `b1d57f36`) fixed the View modal to respect per-item Numista edits — confirms that "respect saved per-item state" is an active norm in this area, consistent with AC-8's preserve-on-unchecked field behavior.
- The `itemRemovedTags` storage shape (`{ uuid: string[] }`) and case-insensitive `clearRemovedTag` predate STRK-52 — first-time write of this concept appears to be the original tag-picker work that introduced removed-tag tracking and is already part of the JSON / CSV / STVAULT export contract.
- No mem0 memory found specifically for "Numista re-sync tag lock" — this is the first dedicated pass on AC-1 / AC-3 behavior.

## External References

- None required. All behavior is internal to StakTrakr; no third-party tag taxonomy or RFC applies. Numista's API contract is consumed read-only via the existing `catalog-api.js` plumbing.

## Constraints

- **Vanilla JS, script-tag globals, no build.** All edits land in existing `js/catalog-api.js` / `js/tags.js`. Respect script load order from CLAUDE.md (`safeGetElement` unsafe at parse time in some files — not an issue inside render functions).
- **localStorage discipline.** `itemRemovedTags` must be read/written via `loadData()` / `loadDataSync()` / `saveData()` (see `js/tags.js:324–362`), never raw `localStorage.getItem()`.
- **Capitalization contract.** `addRemovedTag()` capitalizes on store; matching reads use `.toLowerCase()` on both sides. `removeItemTag()` is the exception today: it removes by exact string. Any STRK-52 removal path must account for that exact-match behavior to honor AC-6.
- **Custom dialogs.** Any new confirm/alert flows must use `showAppConfirm` / `showAppAlert` (not native), and any new Playwright tests must wait on `#appDialogModal` per the project's testing rule in CLAUDE.md.
- **TDD integrity vs Test 3.** `numista-picker-tags.spec.js` line 293 asserts `toBeDisabled()` — the *current* spec the test encodes is wrong relative to STRK-52's accepted requirements. Per the global TDD rule ("if the test is flawed, that means the spec was wrong — restart the spec"), STRK-52 *is* the spec correction; the test must be rewritten in the same change to assert `not.toBeDisabled()` plus the new uncheck-to-remove path. This is not a "modify test to make code green" violation — it is a spec-driven test rewrite, but it must be called out explicitly in approach.md and tasks.md so a reviewer doesn't read the diff as a TDD bypass.
- **Bulk-control invariant after the fix.** Once existing-tag checkboxes lose `disabled`, the existing `if (!cb.disabled)` guard in Check/Uncheck-all (lines 1967–1977) will *no longer* protect them. AC-9 / AC-10 therefore require a new mechanism (e.g., a `data-existing="1"` attribute or class) — discovery only flags this; approach.md picks the mechanism.
- **No per-tag provenance.** Storage and rendering must remain provenance-free; matching text (case-insensitive) is one logical tag (AC-3, AC-5).
- **Modal layout discipline.** Per requirements §Non-Goals, any visible affordance for "already on item" must be a small chip/hint, not a layout overhaul.
- **Catalog API config access.** If any new code needs the Numista API key, use `catalogConfig.getNumistaConfig()`, never `loadApiConfig().keys.numista` (STAK-573 root cause).

## Open Questions

- None. All requirements ACs map to concrete files/lines, the storage shape is already proven by export/import tests, and case-insensitive matching primitives exist. Approach phase can proceed.

## Discovery Summary

The fix lands primarily in `js/catalog-api.js:1856–1978` (tag-picker render + bulk handlers) and the Fill Fields submit path at `js/catalog-api.js:2377–2403`, with removal helpers in `js/tags.js`. The single bug-site line (`cb.disabled = true` at 1940) needs to come off, but doing so unprotects existing-tag checkboxes from the bulk Uncheck-all loop — so AC-9 / AC-10 require introducing a new "existing-on-item" marker that bulk handlers honor in addition to (not instead of) the `disabled` blacklist guard. AC-6 adds one more implementation hazard: the current picker detection is case-insensitive, but `removeItemTag()` removes by exact string, so the removal path must not pass `Tree` and leave a stored `tree` behind. The Playwright spec at `tests/playwright/numista-picker-tags.spec.js` already covers the adjacent paths (removed-tag hint, bulk locking, export round-trip), so test deltas are surgical: rewrite Test 3 to assert enabled-and-uncheckable, and add cases for AC-3, AC-6, and AC-10's new bulk-protection behavior.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-52`.
