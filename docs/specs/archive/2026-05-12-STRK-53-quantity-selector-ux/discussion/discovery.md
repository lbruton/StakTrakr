---
sketch: "STRK-53-quantity-selector-ux"
phase: discovery
created: 2026-05-11
updated: 2026-05-12
---

# STRK-53 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| `index.html` ~8258 | `#removeItemModal` — dispose/delete modal | `role="dialog"`, `aria-modal="true"`, `aria-labelledby="removeItemModalTitle"` |
| `index.html` ~8306–8314 | Qty `.form-group` + `#removeItemQty` | `type="number"`, `min="1"`, `max` set dynamically; group has `style="display:none"` by default — shown only when stack qty > 1 |
| `index.html` ~8310–8314 | `#removeItemDisposePreview` | `aria-live="polite"` helper text; shows "Disposing X of N — Y will remain"; hidden when qty is full-stack or invalid |
| `index.html` ~8336–8344 | `#removeItemAmountModeToggle` | `.chip-sort-toggle` Lot/Each segmented control; `role="group"`, `aria-label="Amount mode"`, `aria-pressed` on child buttons |
| `js/inventory.js` line 628 | `openRemoveItemModal(idx, preDispose)` | Sets `qtyInput.value = stackQty`, `qtyInput.max = stackQty`; hides qty group when stack qty = 1; wires live preview listener |
| `js/inventory.js` line 694–712 | `_removeItemQtyPreviewHandler` | Module-level var holds the event handler; removed and re-attached on each modal open to avoid listener accumulation |
| `js/inventory.js` line 737 | `confirmRemoveItem()` | Reads `#removeItemQty` value; validates non-integer (line 774) and out-of-range (line 784) — both show toasts |
| `js/inventory.js` line 996 | `splitInventoryItem(originalIdx, disposedQty, dispositionInput)` | Does the actual stack split; reduces original qty, creates clone with disposedQty, inserts adjacent, writes paired changeLog entries with `transactionId` |
| `js/events.js` lines 4600–4617 | Dispose qty input side-effect listener | `#removeItemQty` also drives `disposeAmountToggle.updateVisibility()` and `updatePlaceholder()` on `input`; any hidden-input/chip dispatch must preserve that side effect, not only the preview listener |
| `css/styles.css` lines 7910–7957 | `.chip-sort-toggle` / `.chip-sort-btn` | Inline-flex pill container; `.chip-sort-btn.active` = primary bg, inverse text; already used for Lot/Each toggle — the ready-made styled pattern for segmented controls |
| `tests/playwright/inventory/partial-stack-disposition.spec.js` | Full STRK-44 E2E suite | 16 test cases covering qty field visibility, split behavior, preview text, validation blocking, lot/each toggle interaction |
| `tests/playwright/02-crud/crud.spec.js` line 383–424 | Crud remove flow | References `#removeItemModal`, `#removeItemDeleteBtn` — not qty-specific, not at risk |

> CODEX: The STRK-44 suite now has more than the "16 test cases" described here; the current file includes qty-specific assertions such as invalid zero/over-max blocking and the max-attribute regression test. Those assertions are directly affected by a clamp-on-input design.

> OPUS: Discovery doesn't enumerate `paste` and `change` listeners on `#removeItemQty` — only `input`. A user pasting "9999" into the stepper triggers a single `input` event with the post-paste value, so the proposed clamp catches it; but a user changing focus after typing fires `change`, not `input`, and the discovery never confirms whether anything listens for `change`. Worth a one-line grep before approach commits to "all writes flow through `input`".

### Key test helper: `setDisposeQty(page, qty)`

Defined at line ~150 of `partial-stack-disposition.spec.js`. Calls `page.fill("#removeItemQty", String(qty))`. If the element ID changes or element type changes (e.g. to `<select>`), this helper must be updated — but the *assertions* about dispose outcomes won't change. AC-2 requires test assertions pass unchanged; helper changes are expected and acceptable.

### Lot/Each toggle precedent (STRK-4 → STRK-44)

During STRK-44, the Lot/Each `.chip-sort-toggle` pattern was lifted from `events.js` and reused in the dispose modal. That same pattern is the existing styled primitive for constrained choice in this project. (mem0: 2026-05-07, id 54b73885)

## Prior Decisions

- **2026-05-07** — STRK-44 adopted the `.chip-sort-toggle` segmented-button pattern from STRK-4 for Lot/Each in the dispose modal. Pattern: inline-flex pill, `.chip-sort-btn.active` for selected state, `aria-pressed` on buttons, `role="group"` + `aria-label` on container. (mem0 id: 54b73885)
- **2026-05-07** — STRK-44 discovery classified dispose-modal scope as medium. The qty field, preview, and toggle were all added in that session; STRK-53 builds on that foundation. (mem0 id: a4eb71a6)
- **Prior art — modal `<select>` reset** — a mem0 retro note (id: ef91dece) warns that browser native form-state persistence can restore the last-selected `<select>` value across modal open/close cycles. Fix: add a placeholder/required attribute and call `form.reset()` defensively in the modal-open handler. Directly relevant if approach.md chooses `<select>`.
- **STRK-44 accepted toast validation as "good enough for merge"** — STRK-53's explicit origin: the issue was filed post-merge to track the cleaner long-term fix.

## External References

- [MDN `<select>` element](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/select) — native browser accessibility for free (keyboard, screen reader, `aria-label`); but UX degrades for large option lists on mobile
- [MDN ARIA `spinbutton` role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/spinbutton_role) — semantic role for a stepper; pairs with `aria-valuemin`, `aria-valuemax`, `aria-valuenow`
- [ARIA Authoring Practices: Spinbutton](https://www.w3.org/WAI/ARIA/apg/patterns/spinbutton/) — keyboard contract: Arrow Up/Down increment/decrement; Home/End jump to min/max

## Constraints

1. **No new libraries.** Must be implementable with vanilla JS + existing CSS only.
2. **`splitInventoryItem` is unchanged.** The replace targets only the UI affordance; all split logic, changeLog entries, and `transactionId` pairing remain untouched.
3. **`confirmRemoveItem()` reads `qtyInput.value`.** The qty control (whatever shape it takes) must expose `.value` as a numeric string, OR `confirmRemoveItem()` must be updated to read from the replacement. Whichever path approach.md picks, the validation function and the toast safety net stay.
4. **`_removeItemQtyPreviewHandler` is keyed to `#removeItemQty` `input` events.** Replacement must either keep `#removeItemQty` as the source element or rewire the preview listener in `openRemoveItemModal`.
5. **Hidden-when-qty-1 behavior must be preserved.** `qtyGroup.style.display = "none"` when `stackQty === 1` (inventory.js line 688). New control must participate in the same show/hide gate.
6. **`partial-stack-disposition.spec.js` assertions must not be modified.** Test helper `setDisposeQty` references `#removeItemQty`; helper update is acceptable, assertion change is not (AC-2).
7. **AC-5 bar: selecting qty 47 of 50 takes ≤ 3 interactions.** This rules out a plain `<select>` with 50+ sequential options as the sole affordance for large stacks.

> CODEX: Constraint 6 appears infeasible if approach.md keeps hard clamping. Existing tests that call `setDisposeQty(page, 0)` and `setDisposeQty(page, 999)` expect submission to stay blocked; with a live clamp those values become valid before confirm, so the old assertions stop representing the new UX.

> CODEX: If the chip branch uses `role="group"` plus regular buttons, discovery should call out that arrow-key navigation is not provided by that pattern. Native button Tab/Enter may be acceptable as "equivalent native interaction," but that is a product/accessibility decision rather than automatic ARIA coverage.

> OPUS: Discovery is missing two structural items the approach phase will need: (1) where focus lands after `openRemoveItemModal` runs today — if the modal autofocuses `#removeItemQty`, hiding that input in chip mode silently moves focus to the modal root, which is a noticeable a11y regression; (2) whether `<label for="removeItemQty">` exists in `#removeItemQtyGroup` — if it does, in chip mode it associates with a `display:none` input, leaving the chip group without a visible label tied to it. A `grep -n 'for="removeItemQty"' index.html` belongs in the table above.

## Open Questions

_None that block approach.md. The three design decisions below are in-scope for the next phase:_

- **(Decided in approach.md)** Large-stack affordance: stepper with keyboard-typed number vs. `<select>` with grouped ranges vs. hybrid. The AC-5 bar rules out a plain `<select>` alone; approach.md picks and justifies the winner.
- **(Decided in approach.md)** AC-3 branch: hide qty control entirely for stack qty = 1, or show pre-selected to 1 and de-emphasize.
- **(Decided in approach.md)** ID continuity: keep `#removeItemQty` on the replacement element to minimize test-helper churn, or rename and update the helper. Both are valid; approach.md records the choice.

## Discovery Summary

The dispose modal's quantity field lives in `index.html` (~8306–8314) with its backing logic split between `openRemoveItemModal` (field setup + preview wiring, `inventory.js` ~670–712) and `confirmRemoveItem` (toast validation, `inventory.js` ~766–786). The only touch surface for STRK-53 is the input element itself, the preview listener, and the confirm-function's value read — the stack split, changeLog, and all downstream business logic are fully out of scope. The `.chip-sort-toggle` segmented pattern is the project's established primitive for constrained in-modal choice, and the AC-5 bar (≤ 3 interactions for large stacks) is the key constraint that will drive the affordance decision in approach.md.

---

> **Phase complete.** Open questions resolved. Advance: `/sketch approach STRK-53`.
