---
sketch: "STRK-84-numista-tags-first-fill"
phase: requirements
created: 2026-05-18
---

# STRK-84 — Requirements

> **Source Issue:** [STRK-84](https://plane.lbruton.cc/lbruton/browse/STRK-84/) — **Numista tag checkboxes not applied on first Fill Fields for new items**

### Source Issue Body

**Summary.** When adding a *new* item via the Add Item modal and using the Numista picker, tag checkboxes selected in the Fill Fields panel are silently dropped on the first sync. The user must save the item, reopen the edit modal, re-run the Numista search, and click Fill Fields a second time for tags to persist.

**Reproduction.**
1. Open Add Item modal (not Edit).
2. Enter Numista ID `65421` (2015 Australian Kookaburra) and search.
3. Picker loads with *Bird* tag pre-checked.
4. Click **Fill Fields**.
5. Return to Edit modal — tag is missing.
6. Save item, reopen, re-search, click Fill Fields again — tag now appears.

**Root cause.** In `js/catalog-api.js` ~lines 2380–2406, the tag-application block is gated by `_fillUuid`:

```js
const _fillIdx  = (typeof editingIndex !== 'undefined' && editingIndex !== null) ? editingIndex : null;
const _fillItem = _fillIdx !== null && Array.isArray(inventory) ? inventory[_fillIdx] : null;
const _fillUuid = _fillItem?.uuid || null;

const tagCheckboxes = container.querySelectorAll('input[name="numistaTag"]:checked');
if (tagCheckboxes.length > 0 && _fillUuid) {
  // ... applyNumistaTags() ...
}
```

For a new item, `editingIndex === null` (cleared by the `newItemBtn` click handler at `js/events.js:3938-3966`, specifically the `editingIndex = null` assignment at ~line 3946 when the Add Item button is pressed), so `_fillUuid` is `null` and the whole tag-application branch is skipped. The STRK-52 on-item removal walk just below (line 2412) has the same gate.

Scalar fields (name, type, year, weight, metal) work on the first pass because they flow through `commitItemToInventory()` via the `fields` object at submit time. Tags use a separate side-channel (`applyNumistaTags()` writes to per-UUID storage like `itemTags`), which requires the inventory row — and therefore a UUID — to already exist.

**Secondary observation.** Field checkboxes (Year, Type, Orientation, Technique, Obverse, Reverse, Edge descriptions) are unchecked by default in the picker. Governed by each field's `defaultOn` attribute at `catalog-api.js:1592–1593` (`cb.checked = f.available && !!f.value && effectiveDefaultOn`). Likely a separate config tweak in the field-meta source — could fold into this issue or split out. Not blocking.

**Acceptance criteria (from issue).**
- Adding a new Numista item with at least one tag checkbox checked persists the tag(s) on the first Fill Fields click — no second sync required.
- Existing-item edit flow still applies tags correctly (regression check).
- STRK-52 on-item removal walk still records opt-outs correctly for both new and existing items.
- Playwright coverage: extend an existing Numista picker spec to add an item with a pre-checked tag and assert the tag is present in the saved row.

**References.**
- `js/catalog-api.js:2380-2432` — tag application + removal walk
- `js/events.js:1828` — `editingIndex = null` on Add Item open
- `js/events.js:2049-2066` — `commitItemToInventory` dispatch
- Related history: STAK-556 (introduced tag checkboxes), STRK-52 (removal walk)

## Overview

When a user adds a new inventory item through the Numista picker and ticks one or more tag checkboxes in the Fill Fields panel, those tags are silently dropped on the first sync — they only persist after saving, reopening, and re-running Fill Fields. This sketch closes that gap so tags applied during Add Item behave identically to tags applied during Edit Item: one click, one save, tags present. The same fix unblocks the STRK-52 on-item removal walk for new items, which is gated on the same missing UUID.

## User Stories

- **US-1:** As a stacker adding a new coin via the Numista picker, I want the tag checkboxes I leave ticked in Fill Fields to apply on the first click, so that I don't have to save-reopen-re-sync just to get tags onto a brand-new row.
- **US-2:** As a stacker who unchecks a default-on tag during Add Item, I want that opt-out recorded against the new item just like it would be for an existing item, so that the STRK-52 removal walk behaves consistently regardless of entry path.
- **US-3:** As a stacker editing an existing item with tags already applied, I want the current Fill Fields → tag flow to continue working unchanged, so that this fix doesn't regress the path that already works.

## Acceptance Criteria

### AC-1 — Tags persist on first Fill Fields for a new item (maps to US-1)
- **Given** the Add Item modal is open (not Edit) and no inventory row exists yet for this item
- **When** the user enters Numista ID `65421`, searches, leaves the pre-checked *Bird* tag ticked, clicks **Fill Fields**, and then submits the Add Item form
- **Then** the saved inventory row has the *Bird* tag applied — verifiable by reopening the row's Edit modal and seeing the tag listed, or by inspecting the item's tag storage for the new UUID

### AC-2 — STRK-52 opt-out walk records removals for new items (maps to US-2)
- **Given** the Add Item modal is open and the Numista picker has loaded with at least one default-on tag pre-checked
- **When** the user un-checks one of those default-on tags before clicking **Fill Fields**, then submits the form
- **Then** the saved row has the un-checked tag recorded as an opt-out (`itemRemovedTags`), not silently absent

> **Note — intentional contract expansion.** The live STRK-52 removal walk at `js/catalog-api.js:1938-1940` and `js/catalog-api.js:2416-2427` only records opt-outs for tags whose checkbox carries `data-on-item="1"`, which by construction never applies to a brand-new Add flow (no existing item tags exist yet). This AC **intentionally broadens** that contract: unchecked default-on Numista tags on a new item become `itemRemovedTags` opt-outs, even though they were never "on item" in the prior sense. The product rule is "opt-outs follow the user's choice, regardless of whether the item pre-existed". Approach must implement this expansion explicitly, not rely on the existing on-item-only walk.

### AC-3 — Edit Item flow unchanged (maps to US-3, regression guard)
- **Given** an existing inventory row with a Numista catalog reference
- **When** the user opens Edit Item, runs the Numista search, and clicks Fill Fields with one or more tag checkboxes ticked
- **Then** the tag application behaves exactly as it does on `dev` today — no new code path, no extra round-trip, no ordering change visible to the user

### AC-4 — Playwright regression coverage
- **Given** the existing Numista picker Playwright spec (`tests/playwright/numista-picker-tags.spec.js`)
- **When** the spec is extended with a new test case that uses a **true Add Item helper path** — starting from empty inventory (no seeded row) and opening the picker through the Add Item modal entry, NOT through the existing `openEditForm()` / `window.showNumistaResults()` helpers at `tests/playwright/numista-picker-tags.spec.js:93-199` — then enters a Numista ID with a tag pre-checked, clicks Fill Fields once, and submits
- **Then** the test asserts the saved row contains the expected tag — failing on `dev` (pre-fix) and passing post-fix
- **And** the test exercises the missing-UUID condition that is the actual bug, rather than accidentally re-covering the existing UUID-backed Edit flow at `tests/playwright/numista-picker-tags.spec.js:486-517` which already passes today

## Non-Goals

- **Not changing the `defaultOn` defaults** for Year/Type/Orientation/Technique/Obverse/Reverse/Edge scalar field checkboxes. The issue surfaces this as a secondary observation; it lives in `catalog-api.js:1592–1593` and is a separate config concern — see Open Questions.
- **Not refactoring `applyNumistaTags()` itself** or the per-UUID tag storage shape. The fix must reach the existing function with a valid UUID, not redesign the side-channel.
- **Not touching the PCGS picker path** — this sketch is Numista-only. PCGS uses a different field-fill route and is not affected by the `_fillUuid` gate.
- **Not adding a new pending-state UI** (spinner, "tags will apply on save" hint). The fix should be invisible to the user — first click just works.
- **Not migrating existing dropped-tag scenarios.** Items previously affected by this bug are not retroactively fixed; only new Add Item flows post-fix benefit. (Existing rows can be repaired by the user via the documented save-reopen-resync workaround until they choose to.)

## Open Questions

- [ ] **Q1 — Fold the `defaultOn` secondary observation into this sketch, or split it out?** The issue body flags Year/Type/Orientation/Technique/Obverse/Reverse/Edge field checkboxes as unchecked by default and notes it's "could fold into this issue or split out. Not blocking." Folding it in widens scope to field-meta config; splitting it out keeps this sketch focused on the tag UUID gate. **Recommendation:** split — file a follow-up issue, keep this sketch tag-only. Confirm before discovery.
- [ ] **Q2 — Orphan state cleanup if an approach writes tags before form submit (local AND cloud).** If the chosen approach causes `applyNumistaTags()` to persist before the inventory row is committed and the user then cancels/closes the Add modal, the write lands in BOTH local storage AND the Dropbox sync queue. Verified: `itemTags` is in `SYNC_SCOPE_KEYS` (`js/constants.js:831-835`), `saveItemTags()` calls `scheduleSyncPush()` (`js/tags.js:45-54`), and `applyNumistaTags()` saves through that path when it adds tags (`js/tags.js:400-405`). Discovery must confirm whether the chosen approach writes synchronously — if so, approach must include a cleanup path for cancelled Adds covering both the local `itemTags` key and the queued cloud push.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-84`.

## Review Archive — requirements (2026-05-18)

_Reconciled by /sketch reconcile on 2026-05-18. Original reviewer marks preserved below for audit._

### Codex

**Inline marks (originally interleaved in body)**

> CODEX (on Root cause line citation): Live-code check: the `_fillUuid` gate is real at `js/catalog-api.js:2380-2412`, but the Add Item citation is stale. `js/events.js:1828` is edit-commit cleanup; the Add Item button clears `editingIndex` at `js/events.js:3938-3966`. Please correct this before discovery so later phases do not chase the wrong entry point.

> CODEX (on Proposed fix direction subsection): This section is already choosing an implementation shape in requirements. Code evidence says pre-allocation would make `saveItemTags()` persist `itemTags` and call `scheduleSyncPush()` before the inventory row exists (`js/tags.js:45-54`, `js/tags.js:366-415`), while `commitItemToInventory()` currently creates the add UUID only at submit (`js/events.js:1838-1848`). Consider reframing this as a discovery tradeoff and include a third alternative: carry the checked/unchecked tag selection through the form submit path and apply it immediately after `commitItemToInventory()` has created the row UUID.

> CODEX (on AC-2): This is the most load-bearing ambiguity I found. The live STRK-52 removal walk only records unchecked tags where the checkbox had `data-on-item="1"` (`js/catalog-api.js:1938-1940`, `js/catalog-api.js:2416-2427`); a brand-new Add flow has no existing item tags, so default-checked Numista tags are not "on item" yet. If the desired product rule is "unchecked default Numista tags on Add become `itemRemovedTags` opt-outs", state that explicitly, because it is broader than the existing on-item removal contract.

> CODEX (on AC-4): The target spec exists (`tests/playwright/numista-picker-tags.spec.js`), but its helpers currently seed at least one existing row and open the picker through `openEditForm()` / `window.showNumistaResults()` (`tests/playwright/numista-picker-tags.spec.js:93-199`). The new regression should add a true empty/Add Item helper path, otherwise it can accidentally keep testing the existing UUID-backed Edit flow that already passes at `tests/playwright/numista-picker-tags.spec.js:486-517`.

> CODEX (on Q2): Verified: `itemTags` is in `SYNC_SCOPE_KEYS` (`js/constants.js:831-835`), `saveItemTags()` calls `scheduleSyncPush()` (`js/tags.js:45-54`), and `applyNumistaTags()` saves through that path when it adds tags (`js/tags.js:400-405`). This is not just a cloud question; it is also local orphan-state cleanup for cancel/close after Fill Fields if the approach writes before submit.

**Original Review section (CODEX — 2026-05-18)**

#### Verified

- `js/catalog-api.js:2380-2412` gates both checked tag application and STRK-52 removal tracking on `_fillUuid`.
- `js/events.js:3938-3966` is the live Add Item modal entry point that clears `editingIndex`; `js/events.js:1828` is not that entry point.
- `js/events.js:1663-1848` commits new inventory rows and currently mints the add-mode UUID at submit.
- `js/tags.js:45-54` and `js/tags.js:366-415` show that successful Numista tag application persists `itemTags` and schedules sync.
- `js/catalog-api.js:1840-1981` renders Numista tag checkboxes; only existing item tags get `data-on-item="1"`.
- `tests/playwright/numista-picker-tags.spec.js:93-199` provides existing seeded/edit helpers; `tests/playwright/numista-picker-tags.spec.js:486-517` covers Fill Fields tag import for an existing UUID-backed item.
- DocVault foundation confirms StakTrakr is a zero-build vanilla JS SPA with strict script order and localStorage-backed user data (`Projects/StakTrakr/Foundation/architecture.md:98-110`, `Projects/StakTrakr/Foundation/architecture.md:323-330`), and storage/sync keys must be allowlisted/sync-scoped intentionally (`Projects/StakTrakr/Foundation/coding-standards.md:222-294`).

#### Top concerns

1. The requirements cite the wrong Add Item line, which can mislead discovery and implementation toward edit-submit cleanup instead of the Add Item open path.
2. AC-2 currently broadens STRK-52 from "unchecked on-item tag" to "unchecked default Numista tag on a new item" without making that product-rule expansion explicit.
3. AC-4 needs a true Add Item regression helper; extending the existing edit-oriented helper path would miss the bug's missing-UUID condition.

#### Unverified assumptions

- The selected reproduction ID `65421` still returns a `Bird` tag from the live Numista API in current environments; I verified code paths, not external API contents.
- The preferred fix should pre-allocate UUIDs rather than carry pending tag decisions through submit; that tradeoff needs discovery because pre-submit persistence creates cancel/orphan cleanup obligations.
- `itemRemovedTags` should record opt-outs for unchecked default Numista tags on new items, even though those tags were never on the item.
- Existing STAK-126 add-mode auto-tag fallback via `window.selectedNumistaResult` is intentionally out of scope; live code references a window property that I did not find exposed by `catalog-api.js`.

### Resolution Summary

- Accepted: 3 (line citation fix; AC-4 true Add Item helper requirement; Q2 expanded to cover local + cloud orphan cleanup).
- Rejected: 0.
- Resolved with your input: 2 (stripped "Proposed fix direction" subsection entirely — discovery will surface alternatives; AC-2 rewritten to make STRK-52 contract expansion explicit).
