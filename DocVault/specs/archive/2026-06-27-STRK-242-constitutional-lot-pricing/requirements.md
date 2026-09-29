---
sketch: "STRK-242-constitutional-lot-pricing"
phase: requirements
created: 2026-06-25
---

# STRK-242 — Requirements

> **Source Issue:** [STRK-242](https://plane.lbruton.cc/lbruton/browse/STRK-242/)
>
> **Title:** Constitutional by-denomination should support lot pricing (coin-count = lot qty); face-value = lot of one
>
> **Body (Plane):** Follow-up design improvement (deferred from the v3.35.55 ship; supersedes the original band-aid framing).
>
> - **Gap:** In constitutional mode, "By denomination" with a Coin Count of N is effectively a _lot of N coins_, but the purchase price is locked to "Each" with no lot/each toggle. A user entering what they paid for the whole lot has it stored as the per-coin price.
> - **Agreed approach:**
>   - **By denomination:** auto-set the purchase-price toggle to LOT and unhide it so the lot total breaks down per-coin. KEY nuance: the existing lot÷qty division (cited `js/events.js:1607` — _drifted, see discovery_) divides by `#itemQty`, but for cu items `#itemQty` is forced to 1 — the real count lives in the constitutional card (`cu.qty`). The division must use the coin count, not `#itemQty`. The data model already cooperates: `pricingType:"lot"` stores a per-unit price and cu's stored `qty` is the coin count, so table/view totals (price × qty) line up.
>   - **By face value:** no coin count is determinable, so treat as a lot of one (qty 1) → each mode (price is the total, no division). Simplest to hide the toggle in face-value mode.
> - **Alternative considered:** a dedicated "total / per-coin" switch inside the constitutional card instead of reusing the global lot/each toggle — more isolated but more UI surface; reusing the existing toggle is preferred.
> - The original "clear the stale lot value on Type→Constitutional transition" band-aid was **reverted** (it conflicts with this direction, which wants to USE a lot value, not erase it). The narrow transition edge case is subsumed by this proper design.

## Overview

Constitutional ("cu" / junk-silver) items entered **by denomination** are really a _lot of N coins_, but the purchase-price field is currently locked to "Each" with the lot/each toggle hidden (STRK-235 deliberately suppressed it for cu). A user who paid one price for the whole lot has that total silently stored as the per-coin price, corrupting cost basis. This sketch restores lot pricing for the by-denomination case — auto-LOT toggle, dividing the entered lot total by the **coin count** (`cu.qty`), not the form's `#itemQty` (which cu pins to 1) — while keeping the **by-face-value** case as a lot-of-one (each mode, no division). It matters now because the band-aid that merely _erased_ stale lot values was reverted in favor of this proper design, leaving the cost-basis gap open.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a stacker entering junk silver **by denomination**, I want to record what I paid for the whole lot, so that the per-coin cost is derived automatically and my totals/cost-basis are correct.
- **US-2:** As a stacker entering junk silver **by face value**, I want the price treated as the total (no division), so that a single face-value entry is never mis-divided into a bogus per-coin figure.
- **US-3:** As a stacker **editing** an existing constitutional item, I want the price toggle to reopen in the mode I saved it in, so that historical data (including legacy per-coin entries) is never misread as a lot total.

## Acceptance Criteria

> EARS syntax. Each line is individually testable and becomes a TDD Cohort B assertion. `<system>` = the add/edit-item modal + `parseItemFormFields` save path.

### AC-1 (maps to US-1) — toggle visible in denomination mode

- **WHILE** the constitutional card is in **by-denomination** mode, the system **SHALL** display the purchase-price lot/each toggle (overriding the STRK-235 blanket hide for cu).

### AC-2 (maps to US-1) — new denom items default to LOT

- **WHEN** a new by-denomination constitutional item is added, the system **SHALL** default the purchase-price toggle to **LOT**.

### AC-3 (maps to US-1) — divide by coin count, not #itemQty

- **WHEN** a by-denomination constitutional item is saved with the toggle in **LOT** mode, the system **SHALL** divide the entered lot total by the **coin count (`cu.qty`)** — never by `#itemQty` — and store the result as `item.price` with `pricingType: "lot"`.

### AC-4 (maps to US-1) — exact-lot fidelity on uneven division

- **WHERE** a lot total does not divide evenly by the coin count, the system **SHALL** preserve the exact unrounded lot total via the STRK-88 exact-lot cache, so that re-opening the item reconstructs the original total (`price × count`) without cent-level drift.
- The STRK-88 cache **SHALL** seed, key, and read against the **constitutional coin count (`cu.qty`)**, not the purchase toggle's `#itemQty` (which cu pins to 1). The existing helper reads `qtyInputId: "itemQty"` and rejects seeding when qty ≤ 1, so the cache quantity source must be made explicit — otherwise AC-3's save division can be fixed while the exact round-trip/cache path still fails for cu denomination items.

### AC-5 (maps to US-2) — face value is a lot of one

- **WHILE** the constitutional card is in **by-face-value** mode, the system **SHALL** hide the purchase-price toggle and treat the entered price as the total (each mode, qty 1, no division).

### AC-6 (maps to US-2) — face value never divides (STRK-235 regression guard)

- **IF** a constitutional item is in face-value mode (no determinable coin count), **THEN** the system **SHALL NOT** run any lot÷qty division against the stale `#itemQty` (the STRK-235 protection must survive, re-shaped to fire only for face mode rather than for all cu items).

### AC-7 (maps to US-3) — edit restores stored pricingType (denomination)

- **WHEN** an existing by-denomination constitutional item is opened for edit, the system **SHALL** restore the purchase-price toggle to the item's stored `pricingType` — `lot` reconstructs and displays the total (`price × count`); `each` shows the per-coin price — **defaulting to `each`** when `pricingType` is absent (legacy items).

### AC-8 (maps to US-3) — edit restores face value unchanged

- **WHEN** an existing face-value constitutional item is opened for edit, the system **SHALL** keep the toggle hidden and the price displayed as the stored total.

### AC-9 (maps to US-1/US-2) — live re-resolve on entry-mode switch

- **WHEN** the user switches the constitutional card from face-value to by-denomination while the modal is open, the system **SHALL** show the toggle and set it to LOT; **WHEN** switching from by-denomination to face-value, the system **SHALL** hide the toggle and revert to each.

### AC-10 (maps to US-1) — display totals stay consistent

- The system **SHALL** render constitutional item totals as `price × qty` on the **valuation/summary total surfaces** — the inventory-table total cell and the view-modal valuation/summary figures — consistent with `pricingType: "lot"` storing a per-unit price and `cu.qty` being the coin count (no double-counting, no division at display time).
- This **SHALL NOT** extend to the view-modal **price-history chart**, which intentionally uses `pricingType` to choose per-unit vs lot-total scaling; that behavior is out of scope and must not be forced to `price × qty` (preserving STRK-68 chart behavior).

## Non-Goals

_Explicit list of things this sketch does NOT do._

- **Not** changing bulk-edit Type→Constitutional pricing behavior — applying lot pricing through the bulk-edit bundle-injection path is a separate concern, out of scope here.
- **Not** changing how constitutional **melt/valuation** is computed — value is variant-derived (`getConstitutionalSilverOz`) and unaffected by purchase price.
- **Not** adding a separate "total / per-coin" switch inside the constitutional card — the rejected alternative; this reuses the existing global lot/each toggle.
- **Not** migrating or backfilling existing cu items — legacy items keep their stored `pricingType` (absent → treated as `each`); no data rewrite on load.
- **Not** changing face-value valuation or the `con-90-subsidiary` sentinel.

## Open Questions

_All resolved during the requirements grill (2026-06-25)._

- [x] Uneven lot÷count rounding → **reuse the STRK-88 exact-lot cache** for cu (exact round-trip).
- [x] Edit-restore toggle mode → **respect stored `pricingType`** (legacy/absent → each).
- [x] Mid-edit face↔denomination switch → **re-resolve the toggle live**.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch-discovery STRK-242`.

## Review Archive — requirements (2026-06-25)

### Resolution Summary

- **Accepted: 3** — AC-4 (STRK-88 cache must seed/key/read against `cu.qty`, not `#itemQty`), AC-10 (narrowed "view modal" to valuation/summary total surfaces; explicitly excluded the `pricingType`-driven price-history chart), Non-Goals (corrected the drifted bulk-edit STRK reference).
- **Rejected: 0**
- **Resolved with your input: 1** — Non-Goals bulk-edit reference: STRK-246 is bulk Type→Goldback (coverage-map.csv:106), not constitutional; dropped the number and reworded generically since no existing ticket cleanly owns bulk constitutional lot pricing.

---

### CODEX Review (2026-06-25)

#### Verified

- Reviewed `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, repo `AGENTS.md`, `.context/GLOSSARY.md`, `.context/implementation-gotchas.md`, `.context/git-topology.md`, `.context/review-and-ci.md`, and `.context/sketch-conventions.md`.
- Verified the current purchase-price toggle/cache helpers in `js/events.js:60-280`, including `#itemQty`-based visibility/cache behavior and `restorePurchasePriceToggle()`.
- Verified constitutional save/edit paths in `js/events.js:1553-1690`, `js/events.js:2232-2481`, and `js/inventory.js:1781-1806`, `js/inventory.js:2111-2145`, `js/inventory.js:2176-2193`.
- Verified total/valuation surfaces in `js/utils.js:949-962`, `js/inventory-table.js:1138-1139`, and view-modal chart scaling in `js/viewModal.js:1300-1340`.
- Verified current Playwright coverage ownership in `tests/playwright/core/inventory-math.spec.js:359-385`, `tests/playwright/core/inventory-math.spec.js:890-940`, and `tests/playwright/coverage-map.csv:106`.

#### Top concerns

- AC-4 relies on STRK-88's exact-lot cache but does not require that cache to use `cu.qty`; the existing helper is currently wired to `#itemQty`, which cu pins to 1.
- AC-10's broad "view modal" wording could accidentally pull the price-history chart into scope and conflict with existing `pricingType` chart-unit behavior.
- The bulk-edit non-goal likely cites the wrong STRK issue number for constitutional staging.

#### Unverified assumptions

- I did not query Plane for STRK-242 or the referenced follow-up issue IDs; the issue-scope concern is based on live repo coverage notes and code history present in this checkout.
