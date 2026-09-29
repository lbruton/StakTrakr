---
sketch: "STRK-53-quantity-selector-ux"
phase: approach
created: 2026-05-12
revised: 2026-05-12
supersedes: discussion/approach.md
---

# STRK-53 — Approach (Revision 2)

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The quantity selector becomes a **mode-aware constrained control** with a hidden authoritative carrier:

```
┌─────────────────────────────────────────────────────────────┐
│ #removeItemQtyGroup .form-group                             │
│  <label id="removeItemQtyLabel">                            │
│    Quantity to dispose                                      │
│    <span class="qty-max-suffix"> (max 8)</span>             │
│  </label>                                                   │
│                                                             │
│  ┌──────── chip mode (N ≤ DISPOSE_QTY_CHIP_MAX) ────────┐   │
│  │ #removeItemQtyChips                                  │   │
│  │   role="group" aria-labelledby="removeItemQtyLabel"  │   │
│  │   .chip-sort-toggle.chip-sort-toggle--quantity       │   │
│  │   [1] [2] [3] [4]                                    │   │
│  │   [5] [6] [7] [8]   ← wraps at 44px chips, 360px     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──── select mode (N > DISPOSE_QTY_CHIP_MAX) ────────┐     │
│  │ #removeItemQtySelect                               │     │
│  │   aria-labelledby="removeItemQtyLabel"             │     │
│  │   <option value="1">1</option> ... <option N>      │     │
│  └────────────────────────────────────────────────────┘     │
│                                                             │
│  <input type="hidden" id="removeItemQty">  ← carrier        │
│  <p id="removeItemDisposePreview" aria-live="polite">       │
└─────────────────────────────────────────────────────────────┘
```

**Three render branches** decided at modal-open time inside `openRemoveItemModal`:

1. `stackQty === 1` — chip mode rendered with a single chip `[1]` already in selected/dimmed style. Group `aria-disabled="true"`, chip `tabindex="-1"`, `aria-pressed="true"`. The hidden carrier is set to `1`. Visible — not hidden — per AC-3.
2. `stackQty <= DISPOSE_QTY_CHIP_MAX` (default 8) — chip mode rendered with N chips. Last chip auto-pressed and focused. Roving-tabindex handler enables ArrowLeft/Right/Up/Down/Home/End.
3. `stackQty > DISPOSE_QTY_CHIP_MAX` — `<select>` mode rendered with `<option>` 1..N. Last option selected (full stack). `<select>` focused. Native keyboard handles AC-5 type-ahead.

**Carrier discipline:** `#removeItemQty` becomes `type="hidden"`. Every selection path (chip click, chip Enter/Space, chip arrow-key with auto-select, `<select>` change) executes:

```js
removeItemQty.value = String(n);
removeItemQty.dispatchEvent(new Event("input", { bubbles: true }));
```

The existing `_removeItemQtyPreviewHandler` keeps working unchanged. `confirmRemoveItem` keeps reading `#removeItemQty.value`. `disposeAmountToggle` (`events.js:182`) keeps keying off the same ID.

**Defense-in-depth toasts** at `inventory.js:774, 784` remain, with a one-line comment marking them as unreachable through the UI. This satisfies AC-1 (UI cannot produce invalid values) without deleting code that protects against programmatic DOM bypass.

## Key Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Rationale                                                                                                                                                                                                                                                                                                                                | Tradeoff                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1  | **Chips for N ≤ 8, native `<select>` for N > 8.** No free-text input rendered for any N.                                                                                                                                                                                                                                                                                                                                                                                                                                         | Satisfies strict AC-1 (no free typing anywhere). Chips are visually consistent with Lot/Each. `<select>` gets native a11y + type-ahead for free (AC-5 in 3 keystrokes).                                                                                                                                                                  | Two render paths to maintain. Mitigated by sharing the carrier-write helper.                                                                |
| D-2  | **`#removeItemQty` becomes `type="hidden"` and is the single authoritative value carrier.**                                                                                                                                                                                                                                                                                                                                                                                                                                      | Minimizes blast radius — `confirmRemoveItem`, `disposeAmountToggle`, preview handler, and existing `events.js:4612` reference all keep working without edits.                                                                                                                                                                            | Visible `<label for="removeItemQty">` no longer points at a focusable element — re-association handled in D-7.                              |
| D-3  | **Bubbling dispatch:** `new Event("input", { bubbles: true })`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Future-proofs against ancestor listeners (form-level validation, debug instrumentation) silently missing programmatic writes. OPUS-flagged in first-pass review.                                                                                                                                                                         | None.                                                                                                                                       |
| D-4  | **Roving tabindex for chip group.** ArrowLeft/Right + ArrowUp/Down move selection; Home/End jump to ends; Enter/Space activate (native button behavior). Only one chip has `tabindex="0"` at a time; the others have `tabindex="-1"`.                                                                                                                                                                                                                                                                                            | `role="group"` + `aria-pressed` does **not** provide arrow nav for free (reviewer-flagged). Roving tabindex is the standard ARIA pattern for this.                                                                                                                                                                                       | One additional keydown handler.                                                                                                             |
| D-5  | **Mode threshold:** `const DISPOSE_QTY_CHIP_MAX = 8;` declared at **module scope** in `js/inventory.js`.                                                                                                                                                                                                                                                                                                                                                                                                                         | 8 fits 2 × 4 rows of 44 px chips at the project's 360 px narrow-modal width. Module scope (not function scope) makes the constant grep-discoverable and reusable from the test suite via `window.DISPOSE_QTY_CHIP_MAX` if explicitly exported.                                                                                           | 8 is a judgment call. Common stack sizes of 10/20 land in `<select>` mode; that is acceptable because `<select>` is the AAA-grade fallback. |
| D-6  | **AC-3 stack-qty-1:** show chip group with one `[1]` chip, `aria-disabled="true"`, dimmed via a `.is-disabled` modifier class on the group.                                                                                                                                                                                                                                                                                                                                                                                      | Keeps modal layout consistent across all stack sizes. Affordance is discoverable. Submitted disposed-qty = 1 satisfies the existing full-stack path in `confirmRemoveItem`.                                                                                                                                                              | Reverses STRK-44's hide-on-qty-1 behavior — called out as deliberate in requirements.md non-goals.                                          |
| D-7  | **Label re-association via `aria-labelledby`.** Add `id="removeItemQtyLabel"` to the existing `<label>` and point the chip group / `<select>` at it via `aria-labelledby`. The `for=` attribute on the label stays (`for="removeItemQty"` — harmless because the hidden input still exists). The label text gains a `<span class="qty-max-suffix"> (max N)</span>` that JS updates on modal open.                                                                                                                                | Single source of truth for the label; AAA-compliant programmatic name on the visible control; visible "max N" hint addresses CODEX's first-pass note about AC-4's max-in-label requirement.                                                                                                                                              | Adds one DOM span + one JS update site.                                                                                                     |
| D-8  | **Explicit `.focus()` after render**, not focus-trap implicit. Chip mode focuses the auto-pressed last chip; `<select>` mode focuses the `<select>`; qty-1 mode focuses the (disabled-look) chip with `tabindex="0"` so screen readers announce it even though it cannot change.                                                                                                                                                                                                                                                 | Reviewer-flagged: `#removeItemQty` going `type="hidden"` removes it from the focus trap's scan, so without an explicit `.focus()` the modal would land focus on whatever the trap finds first (likely the dispose checkbox).                                                                                                             | One extra call inside the render branches.                                                                                                  |
| D-9  | **New CSS class:** `.chip-sort-toggle--quantity` (BEM-style modifier) on the chip group. Applies `flex-wrap: wrap`, `gap: 8px`, and resets `overflow: hidden` to `visible`. Chips inside also get `min-width: 44px`, `min-height: 44px`, `padding: 0` (negotiable — sizing comes from min-dimensions).                                                                                                                                                                                                                           | Per-instance variant follows the existing `#purchasePriceModeToggle .chip-sort-btn` precedent at `css/styles.css:7957`. Does not affect Lot/Each toggle or other chip-sort-toggle uses.                                                                                                                                                  | New CSS rule; small surface area, contained to the new selector.                                                                            |
| D-10 | **Replace tests 7 and 8** (`partial-stack-disposition.spec.js`) with **affordance-level coverage**. Original tests asserted "submit with qty=0 blocks via toast" and "submit with qty=999 blocks via toast" — both invalid via the new UI. Replacements assert that the **chip with qty=0 does not exist** (`expect(page.locator('button[data-qty="0"]')).toHaveCount(0)`) and that the `<select>` for a stack-of-50 has **no option > 50** (`expect(page.locator('#removeItemQtySelect option[value="999"]')).toHaveCount(0)`). | Tests 7 and 8 cannot pass meaningfully after STRK-53 — their preconditions (typing 0 or 999) are no longer possible. Replacing them maintains the **intent** (invalid values rejected) at the affordance level. AC-2 (downstream business-logic assertions unchanged) is unaffected because tests 7 and 8 do not touch downstream logic. | Two test bodies rewritten. The replacement tests are simpler than the originals (no UI interaction, just DOM assertions).                   |
| D-11 | **Worktree & version bump handed to `/start-patch`.** Cohort 0 of tasks.md is `invoke /start-patch STRK-53`, which claims `devops/version.lock`, creates `.worktrees/STRK-53-quantity-selector/` on `feature/STRK-53-quantity-selector` (or whatever `/start-patch` produces), and stages the version increment. `/release patch` runs at CLOSE-N to bump 6 files.                                                                                                                                                               | Resolves the reviewer-flagged conflict between sketch-native branch naming and StakTrakr's CLAUDE.md worktree conventions. `/sketch apply` is invoked **inside** the `/start-patch` worktree.                                                                                                                                            | None — this is the documented project flow.                                                                                                 |

## File Map

### New

- _(none — all changes land in existing files)_

### Modified

- **`index.html`** (one form-group edit, ~lines 8305-8316):
  - Change `<input type="number" id="removeItemQty" min="1" />` to `<input type="hidden" id="removeItemQty" />`.
  - Add `id="removeItemQtyLabel"` to the existing `<label>`; append `<span id="removeItemQtyLabelMax" class="qty-max-suffix"></span>` inside the label after the text.
  - Add `<div id="removeItemQtyChips" role="group" aria-labelledby="removeItemQtyLabel" style="display:none"></div>` immediately after the label.
  - Add `<select id="removeItemQtySelect" aria-labelledby="removeItemQtyLabel" style="display:none"></select>` after the chips div.
  - `#removeItemQtyGroup`'s initial `style="display:none"` stays — `openRemoveItemModal` always reveals it now (qty=1 case included).

- **`js/inventory.js`** (additions in `openRemoveItemModal`, new module-level handlers, new helper functions):
  - **Module scope:** add `const DISPOSE_QTY_CHIP_MAX = 8;` near the existing `_removeItemQtyPreviewHandler` declaration (line ~625). Add `let _removeItemQtyChipKeyHandler = null;`.
  - **New helper** (`writeDisposeQty(n)`): sets `#removeItemQty.value = String(n)` and dispatches `new Event("input", { bubbles: true })`. Used by all selection paths.
  - **New helper** (`renderDisposeQtyChips(n, stackQty, qtyLabelMaxEl)`): clears `#removeItemQtyChips`, builds N `<button>`s with `class="chip-sort-btn"`, `data-qty`, `aria-pressed`, `tabindex` (0 only on the auto-selected last chip), attaches per-button click listeners that call `writeDisposeQty`, applies `.chip-sort-toggle--quantity` modifier class, applies `.is-disabled` if `stackQty === 1`, attaches a single `keydown` handler on the group for roving-tabindex arrow/Home/End nav, sets `qtyLabelMaxEl.textContent = ' (max ' + stackQty + ')'`. Calls `.focus()` on the auto-selected chip.
  - **New helper** (`renderDisposeQtySelect(stackQty, qtyLabelMaxEl)`): clears `#removeItemQtySelect`, builds `<option>` 1..N with the last option `selected`, attaches a `change` listener that calls `writeDisposeQty(parseInt(e.target.value, 10))`. Sets `qtyLabelMaxEl.textContent = ' (max ' + stackQty + ')'`. Calls `.focus()` on the `<select>`.
  - **Branch in `openRemoveItemModal`** (replaces lines 685-690): `qtyGroup.style.display = ""` always; then `if (stackQty <= DISPOSE_QTY_CHIP_MAX) renderDisposeQtyChips(stackQty, stackQty, labelMaxEl); else renderDisposeQtySelect(stackQty, labelMaxEl);`. Both helpers also call `writeDisposeQty(stackQty)` to set the initial carrier value.
  - **Cleanup on re-open:** at the top of `openRemoveItemModal`, before re-rendering, remove the prior `_removeItemQtyChipKeyHandler` if any (mirrors the preview-listener cleanup pattern at lines 694-696).
  - **Defense-in-depth comments:** add a one-line comment at lines 774 and 784 explaining the toasts are unreachable through the UI.
  - **No edits** to `splitInventoryItem`, `_removeItemQtyPreviewHandler` body, `disposeAmountToggle` config, or any other function.

- **`css/styles.css`** (one new rule block near line 7957, where other per-instance chip overrides live):
  - `.chip-sort-toggle--quantity { flex-wrap: wrap; gap: 8px; overflow: visible; }`
  - `.chip-sort-toggle--quantity .chip-sort-btn { min-width: 44px; min-height: 44px; padding: 0.5rem; }`
  - `.chip-sort-toggle--quantity.is-disabled .chip-sort-btn { opacity: 0.55; cursor: default; }`
  - `.qty-max-suffix { color: var(--text-secondary); font-weight: 400; font-size: var(--font-size-sm); margin-left: 0.4rem; }`
  - `#removeItemQtySelect { /* inherit existing select styling; only ensure min-height 44px via existing form-control rule or add `min-height: 44px;` here */ }`

- **`tests/playwright/inventory/partial-stack-disposition.spec.js`** (one helper rewrite + two test-body rewrites; **all 60 other tests untouched**):
  - **Helper rewrite** at line 122 (`setDisposeQty`): detect mode via `await page.locator('#removeItemQtyChips:visible').count()` vs `#removeItemQtySelect:visible`. Chip mode → click the chip with `data-qty=N` (real UI interaction, not hidden-input write). Select mode → `await page.selectOption('#removeItemQtySelect', String(n))`. **The hidden carrier is never written directly** — the test exercises the actual UI.
  - **Test 7 rewrite** (line 297, REQ-1.6 Zero qty): assert chip with `data-qty="0"` does not exist; assert `<select>` option `value="0"` does not exist. No submission attempt.
  - **Test 8 rewrite** (line 310, REQ-1.6 Qty > stack): assert chip with `data-qty="999"` does not exist; assert `<select>` option `value="999"` does not exist. No submission attempt.
  - **Test 3** (line 236, "Quantity field hidden when stack qty = 1"): rewrite assertion. Previously expected `#removeItemQtyGroup` to be hidden; new assertion expects it visible with one chip pre-pressed and `aria-disabled="true"` on the group (matches AC-3 branch change).
  - **No edits** to any of the remaining 58 tests.

### Deleted

- _(none)_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. The dispose flow writes via `splitInventoryItem` which is untouched.

## Test Strategy

**Three layers of coverage:**

1. **Existing downstream-business tests pass unchanged** (tests 4, 5, 6, 9–28+, 60 tests total after rewrites). Helper rewrite makes them exercise the new UI instead of `page.fill`.
2. **Replaced affordance-level tests** for invalid-entry prevention (tests 3, 7, 8). Assert that the UI does not render invalid options at all; submission with invalid carrier is impossible via UI and therefore not tested.
3. **New tests** (added at the end of the same spec file or in a new `partial-stack-disposition-selector.spec.js`):
   - Chip mode keyboard nav: open dispose modal for stack-4 item, focus chip 4, press ArrowLeft, assert chip 3 has `aria-pressed="true"` and `#removeItemQty.value === "3"`.
   - Chip mode Home/End jump: focus chip 4, press Home, assert chip 1 selected.
   - Select mode type-ahead AC-5: open dispose modal for stack-50 item, focus the `<select>`, type "4" then "7" within 500 ms, press Tab, assert `#removeItemQty.value === "47"`.
   - Stack-qty-1 visibility: assert `#removeItemQtyGroup` visible, chip group has `aria-disabled="true"`, single chip with `data-qty="1"` pressed.
   - 44 × 44 px chip dimensions: `await page.locator('#removeItemQtyChips .chip-sort-btn').first().boundingBox()` → width and height both ≥ 44.
   - 360 px viewport wrapping: set viewport to 360 × 800, open dispose for stack-8 item, assert chips span at least 2 rows (compare `boundingBox().y` of first and last chip).

**Manual smoke checks** (CLOSE-3 verification stamp):

- Screen reader (macOS VoiceOver) on chip group: announces `Quantity to dispose (max 4) — pressed, 4` on focus; updates on ArrowLeft.
- Native `<select>` keyboard type-ahead in Chrome and Safari.

## Tradeoffs Surfaced for Review

- **Threshold value (D-5):** `DISPOSE_QTY_CHIP_MAX = 8` is the proposed default. Tuning to 5 or 10 is a one-line change. The reviewer-flagged concern (rolls/tubes of 10 falling into `<select>` mode) is acknowledged; `<select>` is the AAA-grade fallback, so it is acceptable, but `10` is a reasonable alternative if user research justifies it.
- **AC-3 visibility change** is a deliberate UX revision relative to STRK-44. The CHANGELOG entry for the release that ships STRK-53 must call this out so users notice the new dispose modal shape on single-item stacks.
- **Two-element rendering** (chip group + `<select>` both in the DOM, one hidden) is slightly more markup than necessary, but keeps the render branches simple and avoids dynamic element creation/removal that would complicate the focus-trap scan. Alternative: render only the active mode and remove the other — adds complexity, no observable benefit.

## Out of Scope (follow-up issues)

- **Extend the chip/select pattern to Add/Edit quantity inputs** — separate sketch.
- **Custom scrollable chip strip for mid-range N (9-20)** — `<select>` covers this acceptably; revisit only if user feedback flags the jump from chips to dropdown as jarring.
- **CHANGELOG.md "What's New" wording for STRK-53** — the `/release` skill handles this, but the deliberate AC-3 visibility change should be highlighted.

## Risk Notes

- **Risk:** Browser native form-state restores a previous `<select>` value across modal open/close (mem0 `ef91dece`). **Mitigation:** `renderDisposeQtySelect` rebuilds `<option>` set from scratch and explicitly assigns `.value = String(stackQty)` after building.
- **Risk:** Focus-trap's first-focusable scan picks an unexpected element after `#removeItemQty` goes hidden. **Mitigation:** D-8 makes focus explicit in the render branches.
- **Risk:** Playwright `page.click` on a chip with another chip's selection state — race condition if click handler hasn't attached yet. **Mitigation:** Render helpers are synchronous; chips are appended with listeners already attached. `page.click` after `await page.locator('#removeItemQtyChips').isVisible()` is safe.
- **Risk:** A user's accessibility extension (e.g. high-contrast mode, large-text) breaks the 44×44 sizing. **Mitigation:** `min-width` / `min-height` in `px` survives `font-size` scaling. Manual smoke at 200% zoom is in the verification stamp.
- **Risk:** Test rewrite drift — implementer rewrites helpers but skips test 7/8 rewrites. **Mitigation:** Explicit cohort gate in tasks.md verifying both replacements are in place before CLOSE-1.

---

> **Phase complete.** Architecture diagrammed, decisions logged with rationale, every reviewer-flagged gap resolved. File map is complete and minimal. Advance: `/sketch tasks STRK-53`.
