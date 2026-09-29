---
sketch: "STRK-242-constitutional-lot-pricing"
phase: approach
created: 2026-06-25
---

# STRK-242 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The work is a surgical reshaping of the existing purchase-price lot/each toggle so it serves constitutional ("cu") items by **entry mode** instead of being blanket-hidden (STRK-235). The toggle is a singleton built by `createLotEachToggle` (`js/events.js:60`) whose qty source is hardwired to `#itemQty`, which cu pins to 1. The central move is to give the factory a **settable qty source** — a small override function the cu flow installs while in by-denomination mode (reading `#item-constitutional-count`) and clears in by-face-value mode (falling back to `#itemQty`). Only two factory methods actually read the DOM qty — `maybeConvert()` and `updateVisibility()` — so this override is the entire seam; the STRK-88 exact-lot cache (`seedLotCache`/`getExactLotPrice`) already takes `qty` as an explicit parameter and needs no qty-source change, only callers that pass `cu.qty`.

State changes are concentrated at two chokepoints, consistent with the constitutional cluster's governing patterns. **Visibility/mode are computed once** in `constitutionalSetEntryMode()` (`js/events.js:2296`) — the single place denom↔face switches flow through (STRK-247 "compute-once post-dispatch"): denom installs the qty override, shows the toggle, and defaults it to LOT; face clears the override, hides the toggle, and forces EACH. **Value mutation happens only at save** in `parseItemFormFields()` (`js/events.js:1590`) keyed on the final entry mode (STRK-244/245): the `!isCuUnit` guard at `:1607` becomes entry-mode-aware — for cu denom it divides the entered lot total by `cu.qty` (never `#itemQty`); for cu face it never divides (re-shaping STRK-235's regression guard to fire on face only). `handleTypeChange` (`:2412`) manages visibility only and defers the toggle recompute to the `constitutionalSetEntryMode` chokepoint.

Because `item.price` stays per-unit and `item.qty` stays `cu.qty`, every valuation/total surface (AC-10) and the out-of-scope price-history chart (STRK-68) already line up and need **zero** changes. The one genuinely new persistence concern is `pricingType`: STRK-242 promotes it from a presentation-only chart hint (STRK-68) to a **load-bearing** edit-restore signal for cu denom items (AC-7) and the exact-lot round-trip (AC-4). It currently persists only into the raw `metalInventory` localStorage blob — which means cloud-sync (a raw-blob snapshot) already carries it, but the curated JSON-export and ZIP-backup whitelists silently drop it. We register it on those whitelists following the STRK-235/241 precedent, leaving cost-basis fidelity (which rides on `price`×`qty`) intact on every path regardless.

## Key Decisions

| #   | Decision                                                                                                                                                                                                                              | Rationale                                                                                                                                                                                                                                                                              | Tradeoff                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **Dedicated, settable qty source on the toggle factory** (mechanism (b)) — `createLotEachToggle` gains `setQtySource(fn)`/`clearQtySource()`; `maybeConvert` + `updateVisibility` read through it. cu denom installs `() => count`.   | Preserves STRK-235's invariant that `#itemQty` stays 1 for cu everywhere else; makes the cu/non-cu qty divergence explicit instead of overloading a shared DOM field with a contradictory value; only 2 methods touch the seam (the cache already takes `qty` as a parameter).          | Adds a small piece of mutable per-instance state on the singleton toggle that the entry-mode handler must set **and clear** (bleed risk across modal opens) — mitigated by a dedicated `clearQtySource()` called **explicitly** at modal reset (in `resetPurchasePriceToggle`, **before** `updateVisibility`) and on face/non-cu transitions, **never** tied to `resetInteracted()` — which fires mid-restore and would wipe the just-installed denom override. |
| D-2 | **Rejected: mirror `cu.qty` into `#itemQty` during denom mode** (mechanism (a))                                                                                                                                                      | Would require zero factory changes (everything "just works" off the DOM). _Loser:_ re-couples the two qty concepts STRK-235 deliberately separated, sprays a value of 40 into a field documented as pinned to 1, and risks other `#itemQty` readers (`_rawQty`, validation) misreading it. | n/a (rejected)                                                                                                                                                                                                  |
| D-3 | **Compute toggle visibility/mode once in `constitutionalSetEntryMode`** (the denom↔face chokepoint), not per-branch in `handleTypeChange`                                                                                              | STRK-247 compute-once-post-dispatch; STRK-244/245 keep `handleTypeChange` to reversible visibility only. AC-9 (live re-resolve on mid-edit switch) falls out for free since every switch routes here.                                                                                  | The count-field `input` listener (`:2350`) must also re-poke `updateVisibility()` so the qty>1 gate shows/hides live — a second, narrow call site beyond the chokepoint.                                          |
| D-4 | **Divide at save by `cu.qty`; reshape the `!isCuUnit` guard to entry-mode-aware**; parse the `cu` object _before_ the division block                                                                                                  | The division sits at `:1607-1615` but `cu` is parsed later at `:1628`; AC-3 needs `cu.qty`/`cu.mode` available at division time. Save-time mutation keyed on final type is the STRK-244/245 rule.                                                                                      | Reorders `parseItemFormFields` internals (parse `cu` earlier) — localized but load-bearing; face mode must explicitly skip division (AC-6) so STRK-235's protection survives, re-scoped to face.                  |
| D-5 | **cu `pricingType` derived from final entry mode/toggle at save, written unconditionally for cu** (not gated on `wasInteracted()`)                                                                                                    | A programmatic denom-LOT default (set by the handler, not a user click) would fail the `wasInteracted()` gate at `:1670-1674` and not persist `pricingType:"lot"` on edit-save. Deriving from final state is the STRK-244/245 pattern; non-cu keeps the existing gated logic.          | A cu carve-out branch in the `pricingType` expression — slightly more conditional logic at one site, in exchange for AC-7 surviving re-edit.                                                                      |
| D-6 | **Register `pricingType` on the curated export/backup whitelists + cu-scoped sync detection**; sync full-snapshot unchanged; CSV bounded                                                                                              | STRK-235's standing rule: register every load-bearing persisted field at every enumeration site. JSON/ZIP are lossless-contract formats; cu-scoped hash mirrors STRK-241 (no non-cu upgrade churn). Sync already carries it via the raw blob. **Valuation-change detection sites are N/A** — `pricingType` doesn't move `price`×`qty`/melt, so it is excluded from `valuationFieldChanged`/`markUserModified`/`recordBulkPriceHistory` (see File Map N/A note).                                          | More edit sites than strictly needed for cost-basis correctness (`price`×`qty` is always right); a deliberate CSV carve-out leaves the lot-edit hint non-round-tripping through CSV. See Tradeoffs.                |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- _None._ Tests extend the existing `inventory-math.spec.js` (per discovery — no new spec file).

### Modified

- `js/events.js`
  - `createLotEachToggle` factory (`:60-243`) — **D-1**: add `_qtyOverride` + `setQtySource(fn)`/`clearQtySource()`; route `maybeConvert` (`:81-82`) and `updateVisibility` (`:194-197`) through a `readQty()` helper. `clearQtySource()` is a **dedicated** clear path — do **not** clear inside `resetInteracted` (`:181`); instead call it explicitly from `resetPurchasePriceToggle` (`:255`) **before** `updateVisibility`, and on face/non-cu type changes, so the override can't bleed across modal opens yet survives the in-restore `resetInteracted()` (`:278`).
  - `constitutionalSetEntryMode` (`:2296-2313`) — **D-3 / AC-1, AC-2, AC-5, AC-9**: after resolving denom/face, install or clear the qty override and compute the purchase-toggle visibility+mode **once** (denom → show + LOT default; face → hide + EACH).
  - `setupConstitutionalControls` count listener (`:2350-2368`) — **D-3 / AC-9**: on `#item-constitutional-count` input, re-resolve `purchasePriceToggle.updateVisibility()` (qty>1 gate) in addition to the existing preview refresh.
  - `parseItemFormFields` (`:1590-1692`) — **D-4 / AC-3, AC-6**: parse `cu` before the division block; reshape the `!isCuUnit` guard (`:1607`) to divide by `cu.qty` for cu denom and skip entirely for cu face; key `purchasePriceGetExactLotPrice` on `cu.qty` (AC-4). **D-5 / AC-7**: cu `pricingType` from final entry mode/toggle, written unconditionally for cu (`:1670-1674`).
  - `handleTypeChange` cu branch (`:2412-2453`) — **D-3**: keep to visibility only; route the toggle recompute through `constitutionalSetEntryMode` rather than setting `#itemQty`/toggle state inline.
- `js/inventory.js`
  - `_editPopulateWeightFields` (`:1781-1806`) + `_editRestoreLotPricing` (`:2111-2145`) — **AC-7 / hazard 4**: ensure the cu entry mode (and thus the qty override) is set **before** `restorePurchasePriceToggle(item.pricingType, item.qty)` runs, so `updateVisibility` reads `cu.qty` (not 1) and does not self-revert LOT→EACH; seed the exact-lot cache with `cu.qty` (AC-4). Because `clearQtySource()` is decoupled from `resetInteracted`, the `resetInteracted()` inside `restorePurchasePriceToggle` (`:278`) is **override-safe** — the active denom override survives the restore pass.
  - `_dupRestoreLotPricing` (`:2305-2348`, refs `pricingType` at `:2333`, `:2365`) — mirror the restore ordering for the duplicate path. _(Resolves discovery's open item: CODEX's unconfirmed `:2176-2193` citation = this duplicate-restore path.)_
  - JSON export whitelist (`:2420-2458`) — **D-6**: add `pricingType: item.pricingType || ""` alongside the STRK-235 `constitutionalVariant`/`constitutionalEntryMode` lines.
- `js/inventory-import.js`
  - JSON import (`~:1336-1375`) — **D-6**: read `pricingType` back from imported rows. CSV import (`~:478-488`) — **bounded** (no `pricingType` column; see Tradeoffs).
- `js/inventory-backup.js`
  - ZIP backup whitelist (`:88-108`) — **D-6**: add `pricingType` next to the STRK-235 constitutional lines (lossless restore).
- `js/cloud-sync.js`
  - `computeInventoryHash` content sample (`:133-156`) — **D-6**: append `pricingType` **scoped to cu items** (mirrors the STRK-241 cu-scoped variant/mode append; non-cu inventories keep their hash → no one-time upgrade sync prompt).
- `js/diff-engine.js`
  - `DIFF_FIELDS` (`~:30-80`) — **D-6**: add `pricingType` for field-level merge completeness.
- `js/changeLog.js`
  - `logItemChanges` tracked fields (`~:142-158`) — **D-6**: add `pricingType` for audit-log completeness.
- `tests/playwright/core/inventory-math.spec.js`
  - Extend the cu denom/face block (`~:889-940`) — Cohort B assertions for AC-1…AC-9 (denom shows+defaults LOT, divides by count not `#itemQty`, exact-lot round-trip, face hides+no-divide, edit restores stored `pricingType`, live face↔denom re-resolve).
  - **D-6 persistence coverage** — add targeted assertions (or an explicit manual-verification note in tasks.md) for the `pricingType` round-trip through JSON export/import, ZIP backup/restore, the cu-scoped `computeInventoryHash`, `DIFF_FIELDS`, and `logItemChanges`, so a missing whitelist/hash/diff entry is caught before review rather than only by inspection.
- `tests/playwright/coverage-map.csv`
  - Row `:106` — update the inventory-math description to cite STRK-242 / cu-lot-price (AGENTS.md gate; review-only enforcement).

### Intentionally Not Modified (bounded N/A — D-6)

- `valuationFieldChanged` (`js/events.js:1862-1875`), `markUserModified` trackedFields (`js/events.js:1940-1976`), and `recordBulkPriceHistory` priceFields (`js/bulkEdit.js:1733-1743`) carry `constitutionalVariant`/`constitutionalEntryMode` because those drive the **derived melt** for cu items. `pricingType` does **not** affect `price`×`qty`/melt, so it is deliberately excluded from these valuation-change-detection sites — registering it there would record spurious price-history points and modified-flags on a lot↔each-only change. (`markUserModified` is additionally N/A because `pricingType` is never Numista-sourced and needs no clobber-protection.)

### Deleted

- _None._

## Data / Schema Changes

- **`pricingType` becomes load-bearing for cu denom items** (was presentation-only, STRK-68). No new field is added and no migration runs: it already persists into `metalInventory`. **Backfill not needed** — legacy cu items with absent `pricingType` are treated as `each` (AC-7), which displays the correct stored per-coin price; absence only means "don't reconstruct a lot total on edit."
- The field is newly carried on JSON export/import + ZIP backup + cu-scoped sync hash/diff/changelog (D-6). `item.price` (per-unit) and `item.qty` (`cu.qty`) are unchanged on every surface.

## Tradeoffs Surfaced for Review

- **`pricingType` registration scope (D-6) — recommended vs. minimal.** Cost basis (`price`×`qty`) is correct on every path no matter what; losing `pricingType` only degrades the **edit-restore UX** (a denom-LOT item reopens in EACH mode showing the correct per-coin price, having "forgotten" it was entered as a lot). The **recommended** path follows STRK-235's "register everywhere" rule: JSON/ZIP whitelists + cu-scoped hash + `DIFF_FIELDS` + `logItemChanges` (sync snapshot already free). The **minimal alternative** is to bound AC-7/AC-4 to "localStorage + sync-snapshot only" and skip the JSON/ZIP/hash/diff/changelog edits (~6 fewer sites), accepting that manual JSON export and ZIP backup/restore are lossy for the lot-vs-each hint. I recommend the full path — it's mechanical, matches the established pattern, keeps backup/export lossless, and pre-empts a near-certain reviewer flag ("new load-bearing field not registered at all sites"). **Flagging because it sets the surface area of tasks.md.**
- **CSV is deliberately not carrying `pricingType`.** CSV is the flat, human-facing interchange format that already omits many structured fields; adding a column is low value and widens the format. The lot-edit hint will not round-trip through CSV export→import (the item reopens in EACH with the correct per-coin price). Calling this out so the carve-out is an audible skip, not a silent one. Reversible as a follow-up if desired.

## UI Contract

_No standalone mockup/playground/screenshot exists — this sketch reuses two existing, already-styled components (the purchase-price lot/each segmented toggle and the constitutional card). The contract below is the binding spec; tasks/tests trace to it._

### Mockup Artifacts

| Artifact                 | Path / URL | What it defines                                                               |
| ------------------------ | ---------- | ----------------------------------------------------------------------------- |
| _None — reuses existing_ | n/a        | Contract is the existing `#purchasePriceModeToggle` + constitutional card UI. |

### Named States / Screens

| State                                           | Description                                                                                       | Reference                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| cu · denom · new                                | Purchase toggle **visible**, defaulted to **LOT**; price field placeholder "Lot total".          | AC-1, AC-2                                 |
| cu · denom · count ≤ 1                          | Toggle **hidden**, mode EACH (qty>1 gate); price is per-coin.                                     | `updateVisibility` qty>1 gate, AC-9 corner |
| cu · face                                       | Toggle **hidden**, mode EACH; price is the total (lot-of-one, no division).                       | AC-5, AC-6                                 |
| cu · denom · edit (stored lot)                  | Toggle **visible + LOT**; price field shows reconstructed total (`price`×`count`) without drift.  | AC-7, AC-4                                 |
| cu · denom · edit (stored each / legacy absent) | Toggle **visible**, mode **EACH**; price shows stored per-coin.                                   | AC-7                                       |
| cu · face · edit                                | Toggle **hidden**; price shows stored total unchanged.                                            | AC-8                                       |
| Mid-edit face→denom                             | Toggle appears and snaps to LOT live.                                                             | AC-9                                       |
| Mid-edit denom→face                             | Toggle disappears and reverts to EACH live.                                                       | AC-9                                       |

### Component / Token Requirements

- Reuse the existing `#purchasePriceModeToggle` segmented control and its `is-hidden` visibility class — **no new toggle UI** (the rejected alternative was a separate "total / per-coin" switch inside the card).
- Placeholders come from the factory config (`eachPlaceholder: "Each"` / `lotPlaceholder: "Lot total"`); do not hardcode new copy.
- Visibility is driven solely by `toggle.classList.toggle("is-hidden", …)` (factory `updateVisibility`); no new CSS.

### Interaction Contract

- The lot/each toggle and the constitutional card live in the **same add/edit-item modal** — no new surface, no separate page.
- The displayed price field is the single input; LOT⇄EACH conversion mutates it in place (existing `maybeConvert` behavior), now keyed off `cu.qty` in denom mode.
- Switching the constitutional entry mode (face↔denom) re-resolves the toggle **immediately** while the modal is open (AC-9) — no save/reopen required.
- The view-modal **price-history chart is untouched** (STRK-68 / AC-10 exclusion); its `pricingType`-driven scaling must not be forced to `price`×`qty`.

## Out of Scope (follow-up issues)

- **Bulk-edit Type→Constitutional lot pricing** — applying lot pricing through the bulk-edit bundle-injection path (no single existing ticket cleanly owns it; file under STRK if pursued). Non-Goal in requirements.
- **CSV `pricingType` column** — if lossless CSV round-trip of the lot-vs-each hint is later wanted, add a column + import read (file under STRK).
- No change to constitutional melt/valuation (`getConstitutionalSilverOz`), the `con-90-subsidiary` sentinel, or legacy-item backfill (all explicit Non-Goals).

## Risk Notes

- **Risk: qty-override bleed across modal opens** (a stale denom override leaks into the next item). → Mitigation: clear the override via a **dedicated** `clearQtySource()` called explicitly from `resetPurchasePriceToggle` (modal reset, **before** `updateVisibility`), from `constitutionalSetEntryMode("face")`, and on non-cu type changes — **not** from `resetInteracted()`, which fires inside `restorePurchasePriceToggle` and would wipe an active denom override mid-restore.
- **Risk: edit-restore ordering (hazard 4)** — if `restorePurchasePriceToggle` runs before the entry mode/override is set, `updateVisibility` reads `#itemQty`=1, hides the toggle, and self-reverts LOT→EACH. → Mitigation: pin "set cu entry mode (install override) → then restore toggle" ordering in `_editRestoreLotPricing`/`_dupRestoreLotPricing`; assert it in a Playwright edit-restore test. Decoupling `clearQtySource()` from `resetInteracted` keeps the in-restore `resetInteracted()` (`:278`) override-safe.
- **Risk: partial qty-seam wiring** — fixing save-division but not visibility (or vice-versa) leaves the toggle hidden or self-reverting. → Mitigation: D-1 funnels both DOM-reading consumers through one `readQty()`; tasks must verify visibility + conversion + save-division + cache against `cu.qty` in one cohort.
- **Risk: `computeInventoryHash` upgrade churn** if `pricingType` is added un-scoped. → Mitigation: scope the hash append to cu items (STRK-241 pattern) so non-cu inventories keep their existing hash.
- **Risk: complexity gate** — `createLotEachToggle` and `parseItemFormFields` are already dense; additions could trip Codacy Lizard ccn. → Mitigation: extract `readQty()`/override and the cu pricing branch into small named helpers rather than inflating the existing functions.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch-tasks STRK-242`.

## Review Archive — approach (2026-06-25)

### Resolution Summary

- **Accepted (2):** F1 — qty-override lifetime reworked to a dedicated `clearQtySource()` decoupled from `resetInteracted`, with explicit reset/restore ordering (D-1, factory file-map entry, restore entries, Risk Notes). F3 — D-6 persistence-coverage requirement added to the test plan.
- **Rejected (0):** none — every CODEX code-existence claim was verified true against live source before reconciling.
- **Resolved with your input (1):** F2 — the three valuation-change-detection sites (`valuationFieldChanged`, `markUserModified`, `recordBulkPriceHistory`) are bounded **N/A**; `pricingType` is not a valuation field, so it stays off those lists while remaining registered on JSON/ZIP/hash/diff/changelog.

### CODEX Review (2026-06-26)

#### Verified

- Read `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, repo `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, `.context/sketch-conventions.md`, and `Projects/StakTrakr/Foundation/coding-standards.md`.
- Re-read reconciled `requirements.md`, `discovery.md`, and current `approach.md` for STRK-242.
- Verified purchase toggle/reset/restore behavior in `js/events.js:60-280`, save/validation/change-detection paths in `js/events.js:1535-1695` and `js/events.js:1767-2044`, and constitutional entry-mode wiring in `js/events.js:2232-2450`.
- Verified edit/duplicate restore ordering and JSON export shape in `js/inventory.js:1781-1806`, `js/inventory.js:2111-2145`, `js/inventory.js:2323-2383`, and `js/inventory.js:2419-2458`.
- Verified `pricingType` absence/preservation surfaces in `js/inventory-import.js:471-493`, `js/inventory-import.js:1336-1378`, `js/inventory-backup.js:59-108`, `js/cloud-sync.js:122-156`, `js/diff-engine.js:30-90`, `js/changeLog.js:139-158`, `js/bulkEdit.js:1728-1748`, and `js/utils.js:674-730`.
- Verified current test ownership in `tests/playwright/core/inventory-math.spec.js:359-407`, `tests/playwright/core/inventory-math.spec.js:890-940`, and `tests/playwright/coverage-map.csv:106`.

#### Top concerns

- The qty-override lifetime is underspecified and conflicts with live reset/restore ordering: tying override cleanup to `resetInteracted()` would clear the active denom override immediately after edit/duplicate restore, while `resetPurchasePriceToggle()` currently recomputes visibility before clearing reset state.
- D-6's "register everywhere" claim omits live enumeration/detection lists that already carry constitutional metadata (`valuationFieldChanged`, `markUserModified` tracked fields, and `recordBulkPriceHistory`) or needs to explicitly mark them N/A.
- The test plan verifies modal math but not the widened persistence/hash/diff/export scope created by D-6.

#### Unverified assumptions

- I did not query Plane for STRK-242; review scope came from the embedded issue text and live repository evidence.
- I did not run Playwright because this review phase only validates the approach artifact and edits `approach.md`.
