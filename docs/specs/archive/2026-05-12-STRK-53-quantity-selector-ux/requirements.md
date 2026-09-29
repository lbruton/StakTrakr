---
sketch: "STRK-53-quantity-selector-ux"
phase: requirements
created: 2026-05-12
revised: 2026-05-12
supersedes: discussion/requirements.md
---

# STRK-53 — Requirements (Revision 2)

> **Source Issue:** [STRK-53](https://plane.lbruton.cc/lbruton/browse/STRK-53/)
> **Title:** Research quantity selector UX for partial-stack disposition
>
> **Problem:** STRK-44 currently uses a `<input type="number">` Quantity input in the dispose modal. Invalid quantities are caught post-hoc by `confirmRemoveItem` toasts (`js/inventory.js:774, 784`), but the free-entry control allows users to type values that have to be rejected. The validation is defense-in-depth, not prevention.
>
> **Desired outcome:** Replace the free-entry numeric input with a constrained affordance whose UI does not expose any path to an invalid value — no typing of out-of-range numbers, no fractional values, no zero, no value > stack qty. Keyboard, screen-reader, and touch-target accessibility must not regress.
>
> **Context:** This came out of the STRK-44 final review. STRK-44 shipped with toast validation as "good enough for merge." STRK-53 closes the gap by removing the affordance for invalid entry. The toast handlers remain as defense-in-depth for paths that bypass the UI (programmatic DOM access, edge browser states) but they should be unreachable through normal use.

## Decisions baked into this revision

The first-pass review of STRK-53 surfaced four design forks. They are now resolved (operator decision, 2026-05-12) and the ACs below reflect those resolutions:

1. **AC-1 strictness:** Strict — no free typing of quantities anywhere. The control must constrain the option set; clamping a free-text input does not satisfy AC-1.
2. **AC-3 stack-qty-1 behavior:** Show the control with `1` pre-selected and visually de-emphasized. (Reverses STRK-44's hide-the-group behavior; called out in non-goals as an intentional change.)
3. **Worktree / branch:** Cohort 0 of tasks.md hands off to `/start-patch` for worktree + version-lock claim. `/sketch apply` does not create its own worktree.
4. **Mobile target size:** WCAG 2.5.5 AAA — chip min size **44×44 CSS px** with wrapping on narrow viewports. Not deferred.

## Overview

Replace the free-entry numeric Quantity input with a **chip group for small stacks** and a **native `<select>` for large stacks**, both writing to a hidden `#removeItemQty` carrier so the downstream business logic (`confirmRemoveItem`, `splitInventoryItem`, change-log, `transactionId` pairing) is untouched. The toast safety net in `confirmRemoveItem` stays, with an inline comment documenting its defense-in-depth role.

## User Stories

- **US-1:** As a stacker disposing part of a multi-unit stack, I want a quantity control that exposes **only** valid choices (1 through stack qty), so that I cannot type, paste, or otherwise submit an invalid value.
- **US-2:** As a stacker disposing a single-unit stack (qty 1), I want the quantity control to show `1` pre-selected and de-emphasized, so the modal layout stays consistent with multi-unit disposition and the affordance is discoverable if I ever encounter a multi-unit version.
- **US-3:** As a keyboard or screen-reader user, I want the new control to be reachable via Tab, operable via Arrow keys (chip group) or native `<select>` keyboard, announced with a label that includes the stack maximum, and to receive focus on modal open.
- **US-4:** As a touch user on a 360 px-wide modal, I want every chip target to be at least 44×44 CSS px and to wrap to additional rows rather than crowd into a single line that produces sub-44 px chips.

## Acceptance Criteria

### AC-1 (maps to US-1) — Invalid quantities are unreachable in the UI

- **Given** an inventory item with stack quantity N (N ≥ 1)
- **When** the dispose modal is opened
- **Then** the rendered quantity control exposes **exactly** the integers `1…N` as selectable values and provides **no affordance** to type, paste, or otherwise enter a different value:
  - No free-typed numeric input is rendered for any N.
  - For chip mode: only buttons with `data-qty` in `1…N` exist in the DOM.
  - For `<select>` mode: only `<option>` elements with `value` in `1…N` exist; the `<select>` is not editable.
- The toast handlers in `confirmRemoveItem` (`js/inventory.js:774, 784`) remain in place as defense-in-depth and are marked with an inline comment explaining that they are reachable only via programmatic DOM bypass.

### AC-2 (maps to US-1) — Business logic and change-log are unchanged

- **Given** the new control is in place
- **When** the user selects a quantity and submits the dispose form
- **Then** the values reaching `splitInventoryItem` and the resulting `changeLog` entries (shape, fields, `transactionId` pairing) are byte-identical to STRK-44 behavior for the same submitted quantity. No assertions about `changeLog` shape, split-clone behavior, or `transactionId` pairing are modified.

> Tests in `tests/playwright/inventory/partial-stack-disposition.spec.js` that assert **downstream behavior** (split, changeLog, clone fields, G/L math, lot/each interaction) survive unchanged. Tests that assert **the invalid-entry validation path** itself (test #7 `Zero qty blocks submission` and test #8 `Qty > stack blocks submission`) are deliberately replaced with affordance-level tests asserting that those values are unreachable through the UI (no `0` chip exists; no `999` option exists). See tasks.md.

### AC-3 (maps to US-2) — Stack qty 1 shows pre-selected, de-emphasized

- **Given** an inventory item with stack quantity 1
- **When** the dispose modal is opened
- **Then** the quantity control is **rendered visible** with `1` selected and visually de-emphasized (chip in disabled-look style, or `<select>` with single option in muted state). The `#removeItemQtyGroup` is not hidden. The submitted disposed quantity equals 1 and the existing full-stack path in `confirmRemoveItem` (line ~768, `qtyHidden || qtyInputEl.value === ""`) continues to function — the new code path sets `qtyInput.value = 1` so the same outcome reaches `splitInventoryItem`.

### AC-4 (maps to US-3, US-4) — Keyboard, screen reader, and touch accessibility

- **Given** the new control is rendered for any stack quantity N ≥ 1
- **When** the dispose modal opens
- **Then** all of the following hold:
  1. **Focus** lands on the auto-selected value (last chip for chip mode; the `<select>` for select mode; the single chip for N=1) — not on the modal root, not on `#removeItemQty` (which is `type="hidden"`).
  2. **Accessible name** on the container is `Quantity to dispose (max N)` — both the visible `<label>` (`index.html:8307`) and the `aria-label` on the chip group / `<select>` include the maximum.
  3. **Keyboard operation:**
     - Chip mode: ArrowLeft / ArrowRight (and ArrowUp / ArrowDown) move selection within the group via a roving `tabindex`. Home jumps to chip 1; End jumps to chip N. Enter / Space activates the focused chip (already native).
     - `<select>` mode: native keyboard (type-ahead, ArrowUp/Down, Home/End, Enter).
  4. **Screen reader** announces the current selected value on change (chip mode via `aria-pressed`; `<select>` mode via native `aria-selected`).
  5. **Touch targets:** Every chip is **≥ 44 × 44 CSS px** in all viewports the project supports. At the project's narrow breakpoint (~360 px modal interior), chips wrap to additional rows via `flex-wrap: wrap`. The `<select>` element meets 44 px height in the project's existing form-control styles.

### AC-5 (maps to US-1) — Large stacks remain operable

- **Given** an inventory item with stack quantity N ≥ 50
- **When** the dispose modal is opened
- **Then** the rendered control is the native `<select>` with options `1…N`, full-stack value pre-selected. Selecting quantity 47 of 50 takes **≤ 3 interaction events from focus**, where an interaction event is defined as:
  - **One keystroke** (single character or named key like ArrowDown/Tab), **or**
  - **One pointer event** (mousedown→mouseup pair = one interaction, including the implicit list expansion).

  Specifically: typing `"4"` then `"7"` within the native select's type-ahead window, then `Tab`, equals 3 interactions and is the documented happy path.

### AC-6 (maps to US-1) — Mode threshold is a named, single-source constant

- **Given** the chip/select mode switch threshold
- **When** the codebase is grepped
- **Then** the value appears **exactly once** as `const DISPOSE_QTY_CHIP_MAX = 8;` at module scope in `js/inventory.js`. Default value is `8` (fits 2 rows × 4 chips at 44 px on a 360 px modal). The constant is referenced — never re-typed as a literal — anywhere mode is decided. Threshold tuning is a one-line change.

## Non-Goals

- **Not redesigning the rest of the dispose modal.** Lot/Each toggle, disposition type/date/amount/recipient/notes fields, and Confirm/Cancel buttons stay as-is.
- **Not changing dispose business logic.** Stack-split behavior, `changeLog` shape, undo handling, `transactionId` pairing, and the `qtyHidden || value === ""` full-stack branch all remain.
- **Not extending the selector to Add/Edit quantity inputs.** Add-item qty, edit-item qty, and bulk-edit flows are out of scope. If the pattern proves useful, file a follow-up.
- **Not introducing a new dependency.** Vanilla JS + existing CSS only. The chip pattern reuses `.chip-sort-toggle` (with a wrapping variant); the `<select>` is the native browser element.
- **Not removing the toast validation in `confirmRemoveItem`.** It becomes defense-in-depth, documented with a one-line comment so future readers (and Codacy/lint passes) understand it is intentionally kept.
- **Not preserving STRK-44's hide-on-qty-1 behavior.** The control is now visible with `1` pre-selected (AC-3). This is a deliberate change.

## Open Questions

_None — proceed to discovery._

---

> **Phase complete.** Acceptance criteria are concrete, verifiable, and resolve every ambiguity flagged in the first-pass review. Advance: `/sketch discovery STRK-53`.
