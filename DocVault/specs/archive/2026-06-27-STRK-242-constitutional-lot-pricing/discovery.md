---
sketch: "STRK-242-constitutional-lot-pricing"
phase: discovery
created: 2026-06-25
---

# STRK-242 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

> **Drift verdict:** the original Plane issue cited `js/events.js:1607` as the lot÷qty division — that citation has drifted (1607 is now the `!isCuUnit` **guard**; the division is at :1615). The **CODEX reconciliation already in `requirements.md` cites the current lines accurately** — this discovery re-verified every one against the live checkout. Only cosmetic ±1–9-line drift remains (noted inline). One CODEX citation (`js/inventory.js:2176–2193`) could not be confirmed — see Open Questions.

## Existing Code

_Verified current `path:line` against the live `dev` checkout (2026-06-25). Sourced from a `code-oracle` (CGC + claude-context) sweep._

### The lot/each purchase-price toggle + STRK-88 exact-lot cache (`js/events.js`)

| Path | Role | Notes |
|------|------|-------|
| `js/events.js:60` | `createLotEachToggle` factory | Closure factory; reads `qtyInputId` from config (the single qty-source seam). |
| `js/events.js:188-204` | inner `updateVisibility()` | Reads `safeGetElement(qtyInputId)` → `#itemQty`; **hides the toggle when qty ≤ 1** and forces mode→each. This is the load-bearing visibility gate. |
| `js/events.js:67` + `:216-232` | exact-lot cache (STRK-88) | State is a **closure var `let _lotExactPrice = null`** (NOT the `data-exact-lot-price` dataset the STRK-88 sketch doc describes — doc drift; live code wins). `seedLotCache(price,qty)` **gates on `qty > 1`**; `getExactLotPrice` returns the cached total only when `_lotExactPrice.qty === qty`. |
| `js/events.js:245-252` | `purchasePriceToggle` instance | Wired `qtyInputId: "itemQty"`, `priceInputId: "itemPrice"` — **`#itemQty` is hardwired** as the qty source for visibility, conversion, division, and cache. |
| `js/events.js:255-280` | `resetPurchasePriceToggle` / `restorePurchasePriceToggle` + `window.purchasePriceSeedLotCache` / `…GetExactLotPrice` | `restorePurchasePriceToggle(mode,qty)` returns `true` only when `qty > 1` **and** stored mode is `lot`; then calls `updateVisibility()` which immediately re-reads `#itemQty`. |
| `js/events.js:~2868` | `#itemQty` input listener | Every keystroke calls `purchasePriceToggle.updateVisibility()` — but for cu, `#itemQty` is locked at 1 and the constitutional count field does not fire it. |

### Constitutional save / edit / type-change paths

| Path | Role | Notes |
|------|------|-------|
| `js/events.js:1553-1589` | `parseConstitutionalFields()` | Returns `{mode, variant, weight, qty}`. **Denom mode: `qty` = `#item-constitutional-count`. Face mode: `qty` = 1 (hardcoded).** |
| `js/events.js:1601` | `parsedQty` | `Number(elements.itemQty.value)` — the *old* `#itemQty`, pinned to 1 for cu. |
| `js/events.js:1606-1607` | `isCuUnit` guard | STRK-235: `if (!isCuUnit && getMode()==="lot" && priceInput!=="")` — **the entire lot÷qty block is skipped for cu**. (Issue's drifted "1607 division" → this is the guard.) |
| `js/events.js:1611-1615` | exact-lot lookup + division | `window.purchasePriceGetExactLotPrice(...)` keyed on `parsedQty`; division `priceInput = lotPrice / parsedQty` at **:1615** (divides by `#itemQty`). |
| `js/events.js:1649` | saved `qty` | `qty: cu ? cu.qty : parsedQty` — **`cu.qty` (coin count) is what lands in storage** for cu items. |
| `js/events.js:2412-2453` | `handleTypeChange` cu suppression | STRK-235: forces `unit="cu"`, `setMode("each")`, sets `#itemQty.value="1"`, calls `updateVisibility()` → toggle hidden. |
| `js/inventory.js:1781-1806` | `_editPopulateWeightFields` | Restores `constitutionalVariant` + `item.qty` into the **constitutional card** (`#item-constitutional-count`); **does NOT write `item.qty` into `#itemQty`** for cu. |
| `js/inventory.js:2111-2145` | `_editRestoreLotPricing(item)` | Calls `restorePurchasePriceToggle(item.pricingType, item.qty)`; seeds cache via `purchasePriceSeedLotCache(lotTotal, item.qty)` only when `pricingType==="lot"`. |
| `js/inventory.js:2305-2348` | `_dupRestoreLotPricing(item)` | Duplicate path; same restore + cache-seed pattern. (Likely the intent of CODEX's unconfirmed `:2176-2193` citation.) |

### Display / valuation surfaces (AC-10)

| Path | Role | Notes |
|------|------|-------|
| `js/utils.js:949-971` | `computeItemValuation(item, spot)` | `purchaseTotal = purchasePrice × qty`, reading **stored `item.qty`** (not the DOM). CODEX cited `:949-962` → fn actually ends :971 (cosmetic drift). |
| `js/inventory-table.js:1138-1139` | totals loop | `purchaseTotal = valuation ? valuation.purchaseTotal : qty × price`. Confirmed exact. |
| `js/inventory-table.js:457-467`, `:837-839` | per-row purchase-price cell | `formatCurrency(purchaseTotal)`. |
| `js/viewModal.js:646-760` | `_buildValuationSection` | `purchaseTotal = qty × purchasePrice`; shows "X total / X each" when qty>1. |
| `js/viewModal.js:244-271` | `_getViewMetrics` (cu) | `weightOz = totalOz / qty`, `effectivePurity = 1.0` for cu. |
| `js/viewModal.js:1300-1344` | `_getPriceHistoryContext` | `unitQty = pricingType==="each" ? 1 : qty` drives **chart scaling** — **OUT OF SCOPE** (STRK-68 / AC-10 exclusion). Independent code path from the valuation grid. CODEX cited `:1300-1340` → ends :1344. |

### Test coverage (the gap)

| Path | Role | Notes |
|------|------|-------|
| `tests/playwright/core/inventory-math.spec.js:359-407` | lot precision + EACH→LOT→EACH toggle | **Standard oz items only**, not cu. |
| `tests/playwright/core/inventory-math.spec.js:889-940` | cu denom + face save | Asserts `saved.qty`; **no lot-price assertion** → the gap STRK-242 fills. CODEX `:890-940` → starts :889. |
| `tests/playwright/coverage-map.csv:106` | inventory-math row | Owns cu coverage (STRK-235/238/239/240/233/243/244/245/247) — **STRK-242 / cu-lot-price absent**. Will need a new/updated row (AGENTS.md requirement; only review catches a stale row). |

## Prior Decisions

_From `session-oracle` (mem0 + sessionflow + git). Each is load-bearing for STRK-242._

- **2026-06-23 — STRK-235** (PR #1326, `2896bbee`): the lot/each toggle was hidden for **all** cu items because `#itemQty` is pinned to 1 — a visible LOT toggle would divide the entered total by 1, silently storing the whole lot as the per-coin price. Also set the rule: _register any new persisted field at **every enumeration site**_ (`DIFF_FIELDS`, `logItemChanges`, trackedFields, CSV/ZIP/JSON export+import, card-view valuation). **STRK-242 is the by-denomination carve-out that partially reverses this hide** — the `!isCuUnit` guard (`events.js:1607`) and the `handleTypeChange` suppress (`:2412`) are the two sites that must become entry-mode-aware.
- **2026-06-24 — STRK-241/243** (`684681b9`): extended the registration rule to every **value-change-DETECTION site** — `computeInventoryHash` (cloud-sync.js), the `priceChanged` gate (`events.js:~2000`), `recordBulkPriceHistory` (bulkEdit.js). `constitutionalEntryMode` was **already added** at these sites here. STRK-242 must verify the by-denomination lot value flows correctly through them (likely no new field needed — see Constraints).
- **2026-06-24 — STRK-241/243 pre-ship (genesis of this sketch):** Codex proposed a band-aid to **clear `#itemPrice`** on a Type→Constitutional transition (so a stale lot total isn't saved as per-coin). The user **reverted** it and reframed: by-denomination cu should *natively support* lot pricing, not erase the value. STRK-242 was rewritten from "clear stale value" to "support lot pricing; coin-count = lot qty; face = lot-of-one."
- **2026-05-19→21 — STRK-88** (PR #1135/#1136, `8364d1f0`, v3.34.76): the **exact-lot cache** exists to defeat IEEE-754 round-trip drift (`1700/30 → 56.666667 → ×30 = 1700.00001`). Approach = boundary rounding + an exact-value escape hatch. `seedLotCache` gates on `qty > 1`; cache key is `(price, qty)`. **AC-4 hinges on threading `cu.qty` (not `#itemQty`) into this cache.**
- **2026-05-11 — STRK-68** (PR #1104, `da62afe3`): the viewModal lot/each toggle is **presentation-only** — `item.price` is always stored per-unit; chart scaling keys on `pricingType`. **Out of scope; must not be touched** (AC-10 exclusion).
- **2026-06-24→25 — STRK-244/245** (PR #1336, `7cb5e4b6` / rework `d1381667`, v3.35.57): the governing rule — **form-field value mutations belong at SAVE time in `parseItemFormFields`, keyed on the final type — NOT in the transient `handleTypeChange`**, which should only manage reversible visibility. Directly applicable: STRK-242's price÷count division must happen at save, not on type-change.
- **2026-06-25 — STRK-247** (PR #1339, `3412b529`, v3.35.59): **compute-once post-dispatch** — multi-branch UI state (e.g. `#purityCustomWrapper` visibility) should be computed **once** after the type-branch dispatch as a function of the final type, not set per-branch. Apply the same pattern to the new denom-vs-face toggle visibility.

## External References

- _None — purely internal vanilla-JS work. No libraries, RFCs, or platform docs in scope (the "External" research angle was N/A)._

## Constraints

_Things the implementation must respect._

- **Single qty-source seam.** Visibility (`updateVisibility`), conversion (`maybeConvert`), save-division (`:1615`), and the exact-lot cache (`seedLotCache`/`getExactLotPrice`) **all read `#itemQty` via the hardwired `qtyInputId: "itemQty"`**. For cu, `#itemQty` is pinned to 1. Any cu.qty wiring must reach **all four** consistently — a partial fix (e.g. fixing save-division but not visibility) leaves the toggle hidden or the edit-restore self-reverting (see hazards 1 & 4 below).
- **`seedLotCache` rejects `qty ≤ 1`** — this *correctly* skips face mode (lot-of-one, no cache). Denom mode must feed `cu.qty > 1`.
- **Value mutations at SAVE time only** (STRK-244/245): the ÷count division goes in `parseItemFormFields`; `handleTypeChange` + the entry-mode handler manage **visibility only**.
- **Compute visibility once post-dispatch** (STRK-247): don't spread denom-vs-face toggle state across handler branches.
- **`item.price` stays per-unit, `item.qty` stays `cu.qty`** — therefore the AC-10 total surfaces (`price × qty`) and the viewModal chart need **no changes**; they already line up. Do not force the chart to `price × qty` (STRK-68).
- **`pricingType` registration is an OPEN question — not a no-op.** `item.price`, `item.qty`, and `constitutionalEntryMode` already exist **and** are registered at the enumeration + detection sites (`DIFF_FIELDS`, `logItemChanges`, `computeInventoryHash`). **`pricingType` is the exception:** it is persisted only into localStorage by `parseItemFormFields`/`buildItemFields` (`js/events.js:1670-1674`, `:1830-1832`) and is **absent** from every round-trip surface — `DIFF_FIELDS` (`js/diff-engine.js`), `logItemChanges` (`js/changeLog.js`), `computeInventoryHash` (`js/cloud-sync.js`), CSV value cells (`js/utils.js` + `js/inventory-import.js`), JSON export/import (`js/inventory.js` + `js/inventory-import.js`), and ZIP backup (`js/inventory-backup.js`). **Verified absent on the live `dev` checkout (2026-06-25).** STRK-235's "register at every enumeration site" rule was never applied to `pricingType` because pre-STRK-242 it was presentation-only (chart scaling, STRK-68). STRK-242 makes `pricingType:"lot"` **load-bearing** for by-denomination cu items, so AC-7 (edit restore) and AC-4 (exact-lot round-trip) currently hold **only within the same browser's localStorage**. The approach **must decide** which (if any) of the diff / change-log / hash / CSV / JSON / ZIP surfaces have to carry `pricingType` for AC-7/AC-4 to survive sync, import/export, and backup restore — or explicitly bound those ACs to same-browser localStorage. Either way this is no longer expected to be a no-op.
- **coverage-map.csv:106** must gain a row/description update for the new cu-lot tests (AGENTS.md gate; review-only enforcement).

### Load-bearing hazards surfaced (for the approach phase to neutralize)

1. **Toggle stays hidden:** `updateVisibility()` reads `#itemQty` (=1 for cu) → toggle hidden even after enabling it for denom mode, unless `#itemQty` reflects `cu.qty` **or** the visibility logic gets a cu-specific qty source.
2. **Cache never seeds via the UI:** with `#itemQty=1`, `seedLotCache(qty>1)` never fires through the add path → STRK-88 round-trip broken.
3. **Conversion is a no-op:** `maybeConvert()` reads `#itemQty=1` → LOT⇄EACH button does nothing while 40 coins sit in the card.
4. **Edit-restore self-reverts:** `restorePurchasePriceToggle(item.pricingType, item.qty)` sets mode→lot, but the immediate `updateVisibility()` re-reads `#itemQty=1`, hides the toggle, and `setMode("each")` flips it back (AC-7 failure mode). `_editPopulateWeightFields` (`inventory.js:1781`) does not write `item.qty` into `#itemQty` for cu — candidate extension site.

## Open Questions

_Nothing **blocks** `approach.md` — requirements are reconciled and the agreed design is concrete. Two items the architect should resolve **inside** approach.md (not user-blocking):_

- [ ] **The central mechanism decision (approach owns this):** how to thread `cu.qty` through the single `#itemQty` seam for denom mode — broadly **(a)** mirror `cu.qty` into the `#itemQty` DOM input while in denom mode (so the existing visibility/conversion/division/cache "just work", keeping face mode at 1), vs **(b)** give the cu path a dedicated qty source / override that reads the constitutional count field directly. Each has different blast radius across the four seam consumers; this is the key architecture trade-off for `approach.md`.
  - **`pricingType` persistence is part of this decision.** New items record the live toggle mode, but in edit mode the save preserves `existingItem.pricingType` **unless `purchasePriceToggle.wasInteracted()` is true** (`js/events.js:1670-1674`). A *programmatic* denom-mode LOT default — set by the entry-mode handler, not by a user click — therefore won't persist `pricingType:"lot"` on save unless the approach either **(i)** marks the programmatic state change as an interaction, or **(ii)** computes the saved `pricingType` from the final cu entry mode at save time (the STRK-244/245 "mutate at save, keyed on final type" pattern). Pair this with the registration-surface question in Constraints — together they decide whether a denom-LOT item survives both re-edit **and** round-trip.

- [ ] **Minor verification (non-blocking):** CODEX's `js/inventory.js:2176-2193` citation could not be located on the live checkout; it most plausibly meant the duplicate-restore path now at `:2305-2348`. Confirm during approach/tasks; not a gap, just a stale line reference.

## Discovery Summary

The work lands almost entirely in `js/events.js` (the toggle factory + `parseItemFormFields` + `handleTypeChange`), with edit/duplicate restore touches in `js/inventory.js` and a new Playwright case in `inventory-math.spec.js` + a `coverage-map.csv:106` update. The **easy half** is already true by construction: because `item.price` stays per-unit and `item.qty` is the coin count, every display/valuation surface (AC-10) and the out-of-scope viewModal chart (STRK-68) need zero changes. The **tricky half** is the single hardwired `#itemQty` qty-seam: visibility, conversion, save-division, and the STRK-88 exact-lot cache all read it, cu pins it to 1, and a partial fix leaves the toggle hidden or the edit-restore self-reverting — so the approach must thread `cu.qty` through all four consumers coherently (the (a)-vs-(b) mechanism decision above), keep the value mutation at save time (STRK-244/245), and compute visibility once post-dispatch (STRK-247). A **second** open architecture question sits beside the qty-seam: `pricingType` is persisted only to localStorage and is **not** registered at any sync / diff / import-export / backup surface (verified 2026-06-25), so the approach must decide whether — and where — to register it for AC-7/AC-4 to survive beyond the same browser (see Constraints).

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved (none block; two deferred to approach). Then advance: `/sketch-approach STRK-242`.

## Review Archive — discovery (2026-06-25)

### Resolution Summary

- **Accepted: 2** — (1) `pricingType` registration: corrected the "Likely no new persisted field" constraint after verifying on the live `dev` checkout that `pricingType` is persisted only to localStorage and is **absent** from `DIFF_FIELDS`, `logItemChanges`, `computeInventoryHash`, CSV/JSON export-import, and ZIP backup; reframed as an open architecture question (which surfaces must carry it for AC-7/AC-4 to survive sync/import/export/backup, or whether to bound those ACs to same-browser localStorage). (2) Edit-mode `pricingType` persistence: folded the `wasInteracted()` preservation nuance into the central-mechanism open question, tied to the STRK-244/245 save-time pattern.
- **Rejected: 0**
- **Resolved with your input: 0**

> Both findings were single-source (CODEX) and were verified-correct against the live repo before acceptance — they are factual corrections, not scope/tradeoff calls. The downstream "which surfaces" decision is deferred to `approach.md` (CODEX concurs).

---

### Inline marks (verbatim)

> CODEX: This is not supported by the live code for `pricingType`. `parseItemFormFields`/`buildItemFields` can persist `pricingType` locally (`js/events.js:1667-1674`, `:1830-1832`), but the registration/round-trip surfaces I checked do not include it: `DIFF_FIELDS` (`js/diff-engine.js:30-80`), `logItemChanges` (`js/changeLog.js:142-158`), `computeInventoryHash` (`js/cloud-sync.js:133-155`), CSV value cells (`js/utils.js:997-1013` + `js/inventory-import.js:478-488`), JSON export/import (`js/inventory.js:2435-2449`, `js/inventory-import.js:1336-1375`), and ZIP backup (`js/inventory-backup.js:95-108`). STRK-242 makes `pricingType:"lot"` load-bearing for by-denomination cu items, so approach cannot treat this as a no-op; it needs to decide which enumeration, sync/diff, and import/export surfaces must carry `pricingType` so AC-7 and exact-lot edit restore survive beyond same-browser localStorage.

> CODEX: Fold `pricingType` persistence into this mechanism decision too. Current save logic records the purchase toggle mode for new items, but in edit mode it preserves `existingItem.pricingType` unless `purchasePriceToggle.wasInteracted()` is true (`js/events.js:1667-1674`). A programmatic entry-mode switch that shows/sets LOT for denom mode can therefore display the right state without saving `pricingType:"lot"` unless the approach explicitly marks that state change or computes the saved mode from final cu entry mode.

---

### CODEX Review (2026-06-25)

#### Verified

- Read `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, repo `AGENTS.md`, `.context/GLOSSARY.md`, `.context/implementation-gotchas.md`, `.context/git-topology.md`, `.context/review-and-ci.md`, and `.context/sketch-conventions.md`.
- Re-read reconciled `requirements.md` plus current `discovery.md` for STRK-242.
- Verified purchase toggle/cache and save behavior in `js/events.js:60-280`, `js/events.js:1535-1695`, `js/events.js:1767-1837`, `js/events.js:2232-2450`, and `js/events.js:2850-2873`.
- Verified edit/duplicate restore flow in `js/inventory.js:1781-1806`, `js/inventory.js:2111-2145`, `js/inventory.js:2147-2193`, and `js/inventory.js:2323-2383`.
- Verified display/valuation and chart-scaling claims in `js/utils.js:949-971`, `js/inventory-table.js:454-459`, `js/inventory-table.js:837-839`, `js/inventory-table.js:1131-1139`, and `js/viewModal.js:251-274`, `js/viewModal.js:646-760`, `js/viewModal.js:1300-1344`.
- Verified current test ownership in `tests/playwright/core/inventory-math.spec.js:359-407`, `tests/playwright/core/inventory-math.spec.js:890-940`, and `tests/playwright/coverage-map.csv:106`.
- Verified cited history commits for STRK-235, STRK-241/243, STRK-88, STRK-68, STRK-244/245, and STRK-247 via `git log` / `git show`.

#### Top concerns

- The discovery underestimates the `pricingType` blast radius. It is locally persisted, but not registered in the diff/change-log/hash/import-export surfaces I checked, so by-denomination LOT mode may not survive sync, import/export, backup restore, or matched-item merge paths.
- The central quantity-source decision also needs to cover edited-item `pricingType` persistence. Existing edit saves preserve the previous `pricingType` unless the purchase toggle itself was interacted with, which can miss programmatic denom-mode LOT defaults or entry-mode switches.

#### Unverified assumptions

- I did not query Plane for STRK-242; issue scope was reviewed from the embedded issue text and live repository evidence.
- I did not run Playwright because this review phase only validates discovery claims and edits the phase artifact.
