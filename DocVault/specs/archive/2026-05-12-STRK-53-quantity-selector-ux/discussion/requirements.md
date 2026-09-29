---
sketch: "STRK-53-quantity-selector-ux"
phase: requirements
created: 2026-05-11
---

# STRK-53 — Requirements

> **Source Issue:** [STRK-53](https://plane.lbruton.cc/lbruton/browse/STRK-53/)
> **Title:** Research quantity selector UX for partial-stack disposition
>
> **Problem:** STRK-44 currently uses a numeric Quantity input in the dispose modal. Invalid quantities are blocked, but validation currently appears as a toast and the free-entry control leaves room for avoidable invalid states.
>
> **Desired outcome:** Research and design a cleaner quantity control for partial-stack disposition, likely a dropdown, stepper, or segmented selector pre-populated from 1 through the stack quantity. The control should make invalid quantities impossible or much harder to enter and should preserve keyboard/screen-reader usability.
>
> **Context:** This came out of the STRK-44 final review. We accepted the existing toast validation for merge to avoid extending a long session, but want to circle back with a better long-term UX rather than only adding inline validation to the current text/number input.
>
> **Validation:** Confirm the selected design handles stack qty 1, large stack quantities, keyboard operation, screen-reader labels, and partial-vs-full disposition behavior without regressing STRK-44 tests.

## Overview

Replace the free-entry numeric Quantity input in the dispose modal with a constrained selector whose options are bounded by the stack's actual quantity, so users cannot enter an invalid value in the first place. The current toast-based post-hoc validation works but is a remediation, not a guard — this sketch closes the gap by removing the affordance for invalid entry while preserving keyboard and screen-reader workflows and leaving the surrounding dispose flow (lot/each toggle, business logic, change-log entries) untouched.

## User Stories

- **US-1:** As a stacker disposing part of a multi-unit stack, I want a quantity control that only offers valid choices (1 through stack qty), so that I cannot accidentally enter a number greater than I own or a non-integer and have to recover from an error.
- **US-2:** As a stacker disposing a single-unit stack (qty 1), I want the quantity control to disappear or auto-select 1, so that the modal stays focused on the disposition fields that actually need my input.
- **US-3:** As a keyboard or screen-reader user, I want the new control to be reachable via Tab, operable via arrow keys / Enter, and announced with a meaningful label and current value, so that the change doesn't regress accessibility relative to the existing number input.

## Acceptance Criteria

### AC-1 (maps to US-1) — Invalid quantities are unreachable

- **Given** an inventory item with stack quantity N (N ≥ 2)
- **When** the user opens the dispose modal for that item
- **Then** the quantity control exposes exactly the integers 1…N as selectable values, and there is no UI affordance to submit a value outside that set (no free-typed number, no fractional value, no zero, no value > N).

> CODEX: This AC is stricter than the current approach for large stacks. approach.md keeps a free-typed number input for N > 8 and relies on clamping, so the human should decide whether "no UI affordance" means no free typing at all or only no invalid value at submit time.

> OPUS: AC-1 also doesn't say how `paste` is handled. A pasted "9999" produces one `input` event with the post-paste value, so a clamp listener catches it — but a pasted "9.5" parsed via `parseInt` becomes `9`, silently truncating decimals. That's a third invalid affordance ("non-integer") the AC enumerates, and the proposed clamp doesn't reject it, it rounds it. Worth deciding whether "non-integer" pastes show feedback or silently floor.

### AC-2 (maps to US-1) — No regression in dispose business logic

- **Given** the new quantity control is in place
- **When** the user selects a quantity and submits the dispose form
- **Then** the resulting change-log entry, inventory split behavior, and lot/each toggle interaction are identical to the STRK-44 behavior, and the existing STRK-44 Playwright tests pass without modification of test assertions about dispose outcomes.

### AC-3 (maps to US-2) — Stack qty 1 collapses cleanly

- **Given** an inventory item with stack quantity 1
- **When** the user opens the dispose modal
- **Then** either (a) the quantity control is hidden and disposition proceeds as a full-stack action, or (b) the control is present but pre-selected to 1 and visually de-emphasized — chosen behavior is documented in approach.md and consistent with the rest of the modal.

### AC-4 (maps to US-3) — Keyboard and screen-reader parity

- **Given** the new quantity control is rendered
- **When** a keyboard-only user reaches the modal
- **Then** the control receives focus in the existing tab order, exposes an accessible name that includes the word "Quantity" and the stack's maximum (e.g. `Quantity (max 12)`), announces the current value on change, and is fully operable without a pointer (arrow keys or equivalent native interaction).

> CODEX: The later tasks add `aria-label="Quantity"` on the chip group, which does not include the max, and plain `aria-pressed` buttons do not automatically create arrow-key group navigation or a single announced current value. This needs an explicit design/test decision before approval.

> OPUS: AC-4 is silent on touch / mobile. Chips of digits 1..8 in a row on a 360px modal will be ~32px wide buttons — below WCAG 2.5.5 (44×44) and uncomfortable for thumb taps. If mobile is in-scope (CLAUDE.md says it is — "mobile matters"), this AC should either set a min target size or commit the design to wrap/stack chips on narrow viewports. Otherwise B.2 ships an a11y regression that no chosen AC catches.

### AC-5 (maps to US-1) — Large stack quantities remain usable

- **Given** an inventory item with stack quantity ≥ 50
- **When** the user opens the dispose modal
- **Then** the control remains usable without forcing the user to scroll/click through every integer (e.g. stepper with keyboard typing, or selector with grouped options) — the specific affordance is chosen in approach.md but the AC bar is "selecting qty 47 of 50 takes ≤ 3 interactions from focus".

> CODEX: Because the existing modal pre-fills the full stack quantity, the large-stack interaction should define what "from focus" means. If focus lands on a prefilled `50`, reaching `47` may require select-all/clear plus typing; the test plan should verify this manually, not just with Playwright `fill()`.

> OPUS: "≤ 3 interactions" is also unit-ambiguous. Is each keystroke an interaction (`4`, `7`, Tab = 3 — works) or is "type 47" one interaction (then Tab = 2)? The looser reading makes the AC trivially satisfiable; the stricter reading rules out "Ctrl+A, type 47, Tab" (4). Pin the unit before reviewers measure inconsistent thresholds.

## Non-Goals

- **Not redesigning the rest of the dispose modal.** Lot/each toggle, disposition reason, sale price fields, and the Confirm/Cancel buttons stay as they are.
- **Not changing dispose business logic.** Stack-split behavior, change-log shape, undo handling, and `transactionId` pairing are out of scope — this sketch only swaps the input affordance.
- **Not extending the selector to other quantity inputs.** Add-item quantity, edit-item quantity, and any future bulk-edit flows are out of scope; if the chosen pattern is reusable, that's a follow-up sketch.
- **Not introducing a new dependency.** The control must be implementable with existing vanilla JS + project CSS — no new libraries.
- **Not removing the toast validation.** The toast remains as a defense-in-depth fallback in case any submission path bypasses the new control; the goal is to make it unreachable in practice, not to remove the safety net.

> OPUS: If the strict reading of AC-1 wins, the toast branches in `confirmRemoveItem` (`inventory.js` lines 774, 784) become unreachable code — and Codacy/linters will likely flag them. "Defense in depth" is a defensible justification, but the closing tasks need a one-line comment at those branches explaining why the dead-looking code stays, or a follow-up will delete them.

## Open Questions

_None — proceed to discovery._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-53`.
