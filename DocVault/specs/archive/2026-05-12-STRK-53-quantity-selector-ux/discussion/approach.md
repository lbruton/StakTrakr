---
sketch: "STRK-53-quantity-selector-ux"
phase: approach
created: 2026-05-11
updated: 2026-05-12
---

# STRK-53 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The quantity selector is replaced with a **mode-aware control** whose rendering is determined by stack quantity at modal-open time. For small stacks (N 2..8), the existing `.chip-sort-toggle` button pattern — already used for the Lot/Each toggle in the same modal — renders one chip per valid integer. For large stacks (N > 8), the existing `<input type="number">` is kept visible but enhanced with real-time hard clamping (`oninput` snaps the value to [1, max]) and styled to remove browser native spinners. Stack qty = 1 continues to hide the control entirely (unchanged from STRK-44).

> CODEX: The hard-clamped large-stack branch is the main approval decision. It no longer preserves the STRK-44 "invalid entry blocks submit" observable behavior: entering `0` or `999` becomes `1` or max before confirm. That can be valid product behavior, but AC-2/tasks cannot also require the old validation-blocking assertions to pass unchanged.

> OPUS: The approach says the stepper is "styled to remove browser native spinners" but no entry in the File Map touches CSS, and no task in Cohort B does either. Either (a) browser spinners stay (UX inconsistency — chips for small, spinners for large), (b) a CSS task is missing, or (c) the styling commitment should be deleted from this paragraph. Pick one before tasks freeze.

In both modes, a single `<input type="number" id="removeItemQty">` serves as the **authoritative value carrier**. In chip mode it is hidden; when a chip is clicked its value is written to `#removeItemQty` and an `input` event dispatched, so the existing `_removeItemQtyPreviewHandler` (which listens to `input` on `#removeItemQty`) works without any change. In stepper mode `#removeItemQty` is the visible input. `confirmRemoveItem` reads `#removeItemQty.value` in both cases — no changes to business logic, toast safety net, or split/changeLog code.

The only files that change are `index.html` (one new `<div>` inside the existing quantity form-group), `js/inventory.js` (updated `openRemoveItemModal` branch + chip builder + clamp handler), and the `setDisposeQty` test helper in `partial-stack-disposition.spec.js` (helper now uses `page.evaluate` for chip mode so it can write to the hidden input without a visibility gate).

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Chip toggle (`role="group"` + `aria-pressed` buttons) for N 2..8 | Reuses `.chip-sort-toggle` — zero new CSS, fully eliminates invalid states, keyboard-native, visually consistent with Lot/Each toggle already in the modal | Buttons crowd at N = 8; threshold is adjustable via a named constant |
| D-2 | Hard-clamped `type="number"` for N > 8 | Large-stack users need to type (e.g. "47" of 50); a `<select>` with 50 options fails AC-5 for mouse users; clamping on `oninput` makes invalid values impossible to persist long enough to submit | Transient mid-keystroke invalid state exists (e.g. "9" while typing "99"); `confirmRemoveItem` always reads the post-clamp value, so submission is never invalid |
| D-3 | Keep `#removeItemQty` as authoritative value carrier in both modes | Minimizes cascading changes to `confirmRemoveItem`, `_removeItemQtyPreviewHandler`, and `setDisposeQty`; chips sync to it via JS dispatch, test helper fills it via `page.evaluate` (bypasses visibility check) | Hidden input in chip mode is indirect — a one-line comment in the chip click handler documents the pattern |
| D-4 | Stack qty = 1 → hide control entirely (AC-3 option a) | Single-item stacks have no partial disposition decision; showing a pre-selected "1" adds visual noise for no input value | If future work needs to surface qty 1 as a choice, the hide gate in `openRemoveItemModal` is the obvious place to revisit |
| D-5 | Chip threshold constant = 8, extracted as `DISPOSE_CHIP_QTY_MAX` | 8 buttons fit comfortably in a modal row on mobile; common real-world stacks (rolls of 20 divided, tubes of 10) fall under 8; the constant name makes it easy to tune without a code search | Arbitrary UX judgment; team may prefer 5 or 6 |

> CODEX: D-1 says "keyboard-native," but button groups do not get radio-group arrow behavior from `role="group"`/`aria-pressed`. If AC-4 expects arrow-key changes within the chip set, the approach needs a roving-tabindex/radio-group-style handler or the AC should explicitly accept Tab + Enter/Space as the equivalent interaction.

> OPUS: D-5's threshold of 8 lands awkwardly against common stack sizes in this domain. A roll/tube of 10 falls into stepper mode and loses the chip benefit it was designed for; 20-count tubes obviously do. If the goal is "the common partial-dispose case is chip-driven," the threshold probably wants to be tuned against actual user inventory shapes (sqld query?), not a generic mobile-row heuristic. The constant makes this easy to change later, but the default value shapes the first-impression UX.

> OPUS: D-3 ("hidden input as carrier") has a subtle pitfall: chip clicks dispatch `new Event("input")` which is non-bubbling by default. The existing `_removeItemQtyPreviewHandler` is bound directly to `#removeItemQty`, so this works — but any future listener attached to a parent (e.g. form-level validation, debug instrumentation) will silently miss chip-driven changes. Either document the constraint in the chip handler or dispatch with `{ bubbles: true }`.

## File Map

### New
_(none)_

### Modified
- `index.html` — add `#removeItemQtyChips` chip container `<div>` inside the existing `#removeItemQtyGroup` `.form-group`; keep `#removeItemQty` `<input>` unchanged except add `style="display:none"` as the initial state (shown/hidden by JS alongside chips)
- `js/inventory.js` — update `openRemoveItemModal`: extract `DISPOSE_CHIP_QTY_MAX = 8` constant near function; add chip-builder branch that creates `<button>` elements inside `#removeItemQtyChips`, wires click → `removeItemQty.value = n; removeItemQty.dispatchEvent(new Event('input'))`; add `oninput` clamp handler for stepper mode; no changes to `confirmRemoveItem`, `splitInventoryItem`, `_removeItemQtyPreviewHandler`, or `changeLog` logic
- `tests/playwright/inventory/partial-stack-disposition.spec.js` — update `setDisposeQty(page, qty)` helper only: detect mode (chip vs stepper) and for chip mode use `page.evaluate` to set `#removeItemQty.value` + dispatch `input`; for stepper mode `page.fill` continues to work unchanged; no changes to any assertion

> CODEX: Directly writing the hidden input is useful for preserving business-logic tests, but it bypasses the actual chip UI and can create values the user cannot pick. Add explicit chip-click assertions somewhere in the plan, or AC-1/AC-4 could pass through an implementation that only works through the hidden carrier.

> OPUS: File Map omits focus management. Today's modal almost certainly autofocuses `#removeItemQty` (verify in discovery). In chip mode that input is `display:none`; the browser will skip it on Tab and focus will land wherever the modal's first non-hidden tabstop is. Decide explicitly: focus the auto-selected last chip, focus the disposition reason field, or rely on whatever happens. Don't ship "whatever happens."

### Deleted
_(none)_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. The dispose flow writes to `localStorage` via `splitInventoryItem` which is untouched.

## Tradeoffs Surfaced for Review

- **D-2 and AC-1 strictness**: The clamped number input allows a transient mid-keystroke invalid value (e.g. the user types "9" before completing "99", then it snaps). AC-1 says "no UI affordance to submit a value outside that set." The clamped input satisfies this at the point of submission; if the team reads it as "no free-typed number under any circumstances," the fallback is a `<select>` for all stack sizes with documented AC-5 keyboard guidance (type first digit to jump). That path adds ~5 extra lines of HTML and removes the stepper-mode code path entirely, but requires a `page.selectOption` update in the test helper.
- **D-5 chip threshold**: 8 is a judgment call. If the product preference is to use chips only for stacks of 5 or fewer (to avoid any crowding risk on narrow modals), tasks.md can change `DISPOSE_CHIP_QTY_MAX = 5` and the behavior is otherwise identical.

> CODEX: This tradeoff section names the AC-1 ambiguity, but it does not propagate the decision into the test strategy. Until the human chooses the strictness level, tasks that require unchanged invalid-entry assertions are likely to send the implementer in the wrong direction.

## Out of Scope (follow-up issues)

- **Extend selector to Add/Edit quantity inputs** — the chip/stepper pattern may be useful elsewhere (e.g. add-item quantity); that's a separate sketch if desired.
- **Inline validation styling** — e.g. a red border on the stepper while the value is momentarily out of range. Not required for any AC; could be a small follow-up `/gsd`.

## Risk Notes

- Risk: `page.fill` does not work on `<select>` elements in Playwright → mitigation: D-3 avoids a `<select>` as the primary control; if the approach changes to `<select>`, the test helper needs `page.selectOption` and a selector-mode detection branch.
- Risk: Browser native form-state can restore a previous `<select>` value across modal open/close cycles (mem0 prior decision ef91dece) → mitigation: N/A for this approach — the `<select>` is not used; the `type="number"` input's value is overwritten in `openRemoveItemModal` every open.

---

> **Phase complete.** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-53`.
