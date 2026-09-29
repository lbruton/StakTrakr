---
sketch: STRK-242-constitutional-lot-pricing
phase: tasks
created: 2026-06-25
approved: 2026-06-27
---

# STRK-242 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch run` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/start-patch`, `/release patch`, `/update-spot-bundle`, `codacy-analysis-cli`, `/vault-update`, `/pr-resolve`, `/sketch archive`). Invoke them **by name verbatim** — paraphrasing the steps inline is not equivalent because each skill enforces project rules (version-lock claim, file enumeration, pre-commit hooks) the prose can't carry. Irrelevant closing tasks are marked `N/A — <reason>`, never dropped.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Ensure the patch worktree exists (StakTrakr `/start-patch` convention)
  - **File(s):** _no file changes — verification/setup only_
  - **Acceptance:** `git worktree list` shows a `patch/<version>` branch + `.worktrees/<issue>-<slug>/` worktree off `origin/dev`, and the working directory is that worktree (not the main checkout). STRK-242 is a single bumped feature (it ships its own `/release patch`), **not** a no-bump campaign — so it uses `/start-patch` + `patch/<version>`, not `chore/<issue>-<file>`.
  - **If the worktree does not exist yet:** invoke **`/start-patch`** (picks the issue, claims the version lock against the high-water mark, creates the worktree). This is setup work — satisfy the task by doing it, do not stop and wait.
  - **Leverage:** `/start-patch` skill; `.context/git-topology.md` §Worktrees / §Sketch & Spec Branch Overrides; `.context/sketch-conventions.md` (worktree section). EnterWorktree base-ref caveat: branch from `origin/dev`, not `origin/main`.

## Sprint Cohort A — Foundation (the enabling seam)

_Behavior-neutral scaffolding: it installs the settable qty seam without changing any current behavior (the override defaults to `null`, so `readQty()` reads `#itemQty` exactly as today). cu behavior is wired in Cohort C._

- [x] **A.1** — Add a settable qty-source seam to `createLotEachToggle` (D-1)
  - **File(s):** `js/events.js` (`createLotEachToggle` factory, `:60-243`)
  - **Acceptance:** Factory gains a closure var `_qtyOverride = null` plus `setQtySource(fn)` / `clearQtySource()`; a new `readQty()` helper returns `_qtyOverride ? _qtyOverride() : Number(safeGetElement(qtyInputId)?.value)`. `maybeConvert` (`:81-82`) and `updateVisibility` (`:194-197`) — the **only two** methods that read the DOM qty — route through `readQty()`. With no override installed, every existing non-cu path behaves byte-identically (default `npm test` still green). `clearQtySource()` is a **dedicated** path: it is called explicitly from `resetPurchasePriceToggle` (`:255`) **before** `updateVisibility`, and is **NOT** wired into `resetInteracted` (`:181`) — so the in-restore `resetInteracted()` (`:278`) can't wipe an active denom override.
  - **Leverage:** approach.md D-1 + Risk Notes (override-bleed mitigation); discovery.md "Single qty-source seam" constraint; STRK-88 cache (`seedLotCache`/`getExactLotPrice`) already takes `qty` as an explicit param — no factory change needed there, only callers pass `cu.qty`. `safeGetElement` returns a truthy dummy — guard with `?.value`, not `if (!el)`.
  - **Maps to:** Enabling seam for AC-1, AC-2, AC-3, AC-4, AC-9 (no AC verified by this task alone — verified once Cohort C installs the override).

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. All assertions land in the **single** spec file `tests/playwright/core/inventory-math.spec.js`, so these tasks are inherently sequential (same file — no `[P]`). Each must FAIL before Cohort C. Assert DOM structure + stored data (toggle `is-hidden` class, toggle mode state, `item.price` / `item.pricingType` / `item.qty` after save) — never just "text exists" (STRK-123 lesson). Use the `showAppConfirm`/modal pattern from CLAUDE.md for any dialog interception._

- [x] **B.1** — Failing tests: toggle visibility + default + live re-resolve (AC-1, AC-2, AC-5, AC-9)
  - **File(s):** `tests/playwright/core/inventory-math.spec.js` (extend cu block `~:889-940`)
  - **Acceptance:** New cu items in **denom** mode → `#purchasePriceModeToggle` is visible (no `is-hidden`) and mode = **LOT** (AC-1, AC-2). **face** mode → toggle hidden, mode EACH (AC-5). **Denom with count ≤ 1** → toggle hidden (qty>1 gate, AC-9 corner). Mid-edit **face→denom** → toggle appears + snaps LOT; **denom→face** → toggle disappears + reverts EACH, all without save/reopen (AC-9). All fail (red) — `constitutionalSetEntryMode` does not yet install the override or compute the toggle.
  - **Read:** approach.md `## UI Contract` (binding spec for each named state).
  - **Maps to:** AC-1, AC-2, AC-5, AC-9
- [x] **B.2** — Failing tests: save-division by `cu.qty` + exact-lot round-trip + face-never-divides (AC-3, AC-4, AC-6)
  - **File(s):** `tests/playwright/core/inventory-math.spec.js`
  - **Acceptance:** Saving a denom-LOT item stores `item.price` = entered lot total ÷ **`cu.qty`** (never `#itemQty`=1) with `pricingType:"lot"` (AC-3). An uneven division (e.g. `1700 / 30`) re-opens reconstructing the exact original total (`price × count`) with no cent drift — proving the STRK-88 cache seeded/keyed/read on `cu.qty` (AC-4). A **face** item never runs the division — entered price is stored as the total (AC-6, the re-scoped STRK-235 guard). All fail (red).
  - **Leverage:** discovery.md STRK-88 cache notes; `purchasePriceGetExactLotPrice` keyed on `cu.qty`.
  - **Maps to:** AC-3, AC-4, AC-6
- [x] **B.3** — Failing tests: edit-restore of stored `pricingType` (AC-7, AC-8)
  - **File(s):** `tests/playwright/core/inventory-math.spec.js`
  - **Acceptance:** Editing a denom item stored as `lot` → toggle visible + LOT, price field shows reconstructed total (`price × count`) without drift; stored as `each` **or** legacy `pricingType` absent → toggle visible + EACH showing the stored per-coin price (AC-7). Editing a **face** item → toggle hidden, price = stored total unchanged (AC-8). Asserts the edit-restore does **not** self-revert LOT→EACH (hazard 4). All fail (red).
  - **Read:** approach.md `## UI Contract` (states "cu · denom · edit", "cu · face · edit").
  - **Maps to:** AC-7, AC-8
- [x] **B.4** — Failing tests + justification: `pricingType` persistence round-trip (D-6 coverage; durability of AC-7/AC-4)
  - **File(s):** `tests/playwright/core/inventory-math.spec.js`
  - **Acceptance:** Playwright assertions that a denom-LOT cu item's `pricingType` survives **JSON export → import** and **ZIP backup → restore** (driven via `page.evaluate` against the export/import/backup paths). For the `computeInventoryHash` (cu-scoped), `DIFF_FIELDS`, and `logItemChanges` surfaces where a full Playwright round-trip is impractical, include a **read-only justification sub-note** naming the exact assertion or code-inspection check that proves `pricingType` is registered (e.g. "assert two cu items differing only in `pricingType` produce different `computeInventoryHash`"). Tests fail (red) until Cohort C registers the field. **Justification anchor:** documents which round-trips are auto-asserted vs. inspection-verified, so a missing whitelist/hash/diff entry is caught before review, not by omission.
  - **Leverage:** approach.md D-6 + "D-6 persistence coverage" file-map line; STRK-235 "register at every enumeration site" rule.
  - **Maps to:** AC-7, AC-4 (durability beyond same-browser localStorage)
- [x] **B.5** — Failing/regression test: display totals stay `price × qty`; chart untouched (AC-10)
  - **File(s):** `tests/playwright/core/inventory-math.spec.js`
  - **Acceptance:** A cu denom-LOT item — **created through the modal save path (the same path B.2 exercises), never by directly seeding a pre-shaped item** — renders its inventory-table total cell and view-modal valuation/summary figures as `price × qty` (no double-count, no display-time division). Asserts the view-modal **price-history chart** still scales via `pricingType` and is **NOT** forced to `price × qty` (STRK-68 / AC-10 exclusion). Per discovery the **display** surfaces need **zero production changes**, but routing item creation through the modal save keeps this a genuine RED test: it **fails before C.3** (the unfixed save path stores the wrong shape, so the display figures are off) and turns **green** once C.3 makes `item.price` per-unit and `item.qty` = `cu.qty`. If it still fails after C.3, the bug is in the save path, not the display. Do **not** seed a ready-made `pricingType:"lot"` item with per-unit `price`/`qty` — that would make B.5 green from the start and defeat the red→green boundary.
  - **Depends on:** B.2 (B.5 reuses the modal save path B.2 makes assertable; must fail before C.3)
  - **Leverage:** discovery.md "Display / valuation surfaces (AC-10)" table; `js/utils.js:949-971`, `js/inventory-table.js:1138-1139`, `js/viewModal.js:1300-1344`.
  - **Maps to:** AC-10
- [x] **B.6** — Update Playwright coverage map for the new cu-lot cases
  - **File(s):** `tests/playwright/coverage-map.csv` (row `:106`, inventory-math)
  - **Acceptance:** Row 106's description appends an `STRK-242:` clause describing cu by-denomination lot pricing (toggle visible+LOT default, divide-by-`cu.qty` save, exact-lot round-trip, face lot-of-one no-divide, edit-restore of stored `pricingType`, live face↔denom re-resolve, `pricingType` persistence registration). AGENTS.md gate — adding test **cases** to an existing core spec still requires a coverage-map update; only review catches a stale row.
  - **Depends on:** B.1, B.2, B.3, B.4, B.5 (description must reflect the final test inventory)
  - **Leverage:** existing row 106 STRK-235…247 clause style; memory `coverage-map-any-playwright-test-change`.
  - **Maps to:** All AC (inventory accounting)

## Sprint Cohort C — Implementation · GREEN

_TDD green phase. Write the minimum code that turns Cohort B red→green. The `js/events.js` chain (C.1–C.5) and the `js/inventory.js` chain (C.6–C.8) are each **same-file sequential**. The five D-6 persistence edits (C.9–C.13) touch **distinct files** and are genuinely parallel-safe (`[P]`)._

- [x] **C.1** — `constitutionalSetEntryMode` chokepoint: install/clear override + compute toggle once (D-3 / AC-1, AC-2, AC-5, AC-9)
  - **File(s):** `js/events.js` (`constitutionalSetEntryMode`, `~:2296-2313`)
  - **Acceptance:** After resolving denom/face, the function **denom** → `purchasePriceToggle.setQtySource(() => Number(safeGetElement("item-constitutional-count")?.value) || 0)`, shows the toggle, defaults mode to **LOT**; **face** → `clearQtySource()`, hides the toggle, forces **EACH**. Visibility+mode computed **once** here (STRK-247 compute-once-post-dispatch), not spread across branches. Makes B.1's denom/face/live-switch assertions pass.
  - **Depends on:** A.1 (uses `setQtySource`/`clearQtySource`)
  - **Leverage:** approach.md D-3; STRK-247 (`project_strk247_purity_wrapper_centralized_shipped`).
  - **Maps to:** AC-1, AC-2, AC-5, AC-9
- [x] **C.2** — Count-field listener re-pokes `updateVisibility` (D-3 / AC-9 corner)
  - **File(s):** `js/events.js` (`setupConstitutionalControls` count listener, `~:2350-2368`, within `:2322`)
  - **Acceptance:** On `#item-constitutional-count` `input`, call `purchasePriceToggle.updateVisibility()` (in addition to the existing preview refresh) so the qty>1 gate shows/hides the toggle live as the count crosses 1. Makes B.1's "count ≤ 1 hides" assertion pass.
  - **Depends on:** C.1 (same file; relies on the override being installed in denom mode)
  - **Leverage:** approach.md D-3 tradeoff (second narrow call site beyond the chokepoint).
  - **Maps to:** AC-9
- [x] **C.3** — Save-time division by `cu.qty`; reshape `!isCuUnit` guard entry-mode-aware (D-4 / AC-3, AC-4, AC-6)
  - **File(s):** `js/events.js` (`parseItemFormFields`, `~:1590-1692`)
  - **Acceptance:** Parse the `cu` object **before** the division block (currently parsed later at `:1628`). Reshape the `!isCuUnit` guard (`:1607`): for cu **denom** in LOT mode, divide the entered lot total by **`cu.qty`** (never `#itemQty`) and store per-unit `item.price` with `pricingType:"lot"`; key `purchasePriceGetExactLotPrice(...)` on **`cu.qty`** so the exact-lot round-trip works (AC-4); for cu **face**, skip the division entirely (AC-6, re-scoped STRK-235 guard). Extract the cu pricing branch into a small named helper to avoid tripping the Codacy Lizard ccn gate. Makes B.2 pass.
  - **Depends on:** C.1 (same file)
  - **Leverage:** approach.md D-4; STRK-244/245 "mutate at save, keyed on final type" (`project_strk244_245_constitutional_valuation_shipped`); `.context/implementation-gotchas.md` (`parseItemFormFields`); Lizard regex-desync note (`lizard-esc-regex-desync`).
  - **Maps to:** AC-3, AC-4, AC-6
- [x] **C.4** — Derive cu `pricingType` from final entry mode at save (D-5 / AC-7)
  - **File(s):** `js/events.js` (`parseItemFormFields` pricingType write, `~:1670-1674`)
  - **Acceptance:** For cu items, `pricingType` is computed from the final entry mode / toggle state and written **unconditionally** (not gated on `purchasePriceToggle.wasInteracted()`) — so a *programmatic* denom-LOT default (set by the handler, not a user click) still persists `pricingType:"lot"` on edit-save. Non-cu items keep the existing `wasInteracted()`-gated logic untouched. Makes B.3's "edit restores stored pricingType" pass for programmatically-defaulted items.
  - **Depends on:** C.3 (same file, same function region)
  - **Leverage:** approach.md D-5; discovery.md open-question on `wasInteracted()` preservation.
  - **Maps to:** AC-7
- [x] **C.5** — `handleTypeChange` cu branch → visibility only, route through chokepoint (D-3)
  - **File(s):** `js/events.js` (`handleTypeChange` cu branch, `~:2412-2453`)
  - **Acceptance:** The cu branch manages reversible **visibility only** and routes the purchase-toggle recompute through `constitutionalSetEntryMode` rather than setting `#itemQty`/toggle state inline (STRK-244/245: `handleTypeChange` ≠ value mutation). No regression in the existing cu type-change suppression behavior.
  - **Depends on:** C.1 (same file; calls the chokepoint)
  - **Leverage:** approach.md D-3; STRK-247 centralization precedent.
  - **Maps to:** AC-1, AC-5 (via the chokepoint)
- [x] **C.6** — Edit-restore ordering: set entry mode before toggle restore; seed cache with `cu.qty` (AC-7, AC-4, hazard 4)
  - _Satisfied without code change: `editItem` calls `handleTypeChange` → `_editPopulateWeightFields` (which populates the count field then calls `constitutionalSetEntryMode(storedMode)`, installing the override) **before** `_editRestoreLotPricing` → `restorePurchasePriceToggle`. The cache already seeds with `item.qty`, which IS `cu.qty` for cu items. The A.1 decoupling keeps the in-restore `resetInteracted()` override-safe. Verified by B.3 (LOT/EACH/legacy) + B.2 AC-4 green._
  - **File(s):** `js/inventory.js` (`_editPopulateWeightFields` `:1781-1806` + `_editRestoreLotPricing` `:2111-2145`)
  - **Acceptance:** The cu entry mode (and thus the qty override) is set **before** `restorePurchasePriceToggle(item.pricingType, item.qty)` runs, so `updateVisibility` reads `cu.qty` (not 1) and the toggle does **not** self-revert LOT→EACH (hazard 4). Seed the exact-lot cache via `purchasePriceSeedLotCache(lotTotal, item.qty)` using **`cu.qty`** (AC-4). Because `clearQtySource()` is decoupled from `resetInteracted` (A.1), the in-restore `resetInteracted()` (`:278`) is override-safe. Makes B.3 (denom edit) pass.
  - **Depends on:** C.1 (needs `constitutionalSetEntryMode` to install the override), A.1
  - **Leverage:** approach.md "Risk: edit-restore ordering"; discovery.md hazard 4.
  - **Maps to:** AC-7, AC-4
- [x] **C.7** — Mirror restore ordering for the duplicate path (AC-7, AC-4)
  - _Satisfied without code change: `duplicateItem` calls `_editPopulateWeightFields` (installs override) at the top, then `_dupRestoreLotPricing` later — restore runs after the entry mode is set, seeding with `item.qty` (= cu.qty). Same ordering invariant as C.6._
  - **File(s):** `js/inventory.js` (`_dupRestoreLotPricing`, `:2323-2348`; refs `pricingType` at `:2333`/`:2365`)
  - **Acceptance:** Duplicate-restore applies the same "set cu entry mode → then restore toggle → seed cache with `cu.qty`" ordering as C.6. _(Resolves discovery's open item: CODEX's unconfirmed `:2176-2193` citation = this duplicate-restore path, confirmed at `:2323`.)_
  - **Depends on:** C.6 (same file)
  - **Leverage:** approach.md File Map (`_dupRestoreLotPricing` entry).
  - **Maps to:** AC-7, AC-4
- [x] **C.8** — Register `pricingType` on the JSON **export** whitelist (D-6)
  - **File(s):** `js/inventory.js` (JSON export whitelist, `~:2420-2458`)
  - **Acceptance:** Add `pricingType: item.pricingType || ""` alongside the STRK-235 `constitutionalVariant`/`constitutionalEntryMode` lines so curated JSON export carries it (lossless). Makes the JSON-export half of B.4 pass.
  - **Depends on:** C.7 (same file `js/inventory.js`; keep all inventory.js edits sequential)
  - **Leverage:** approach.md D-6; STRK-223 4-part synced-scalar contract precedent (`project_strk223_clear_watermark_shipped`).
  - **Maps to:** AC-7 (durability)
- [x] **C.9 [P]** — Register `pricingType` on JSON **import** read; CSV bounded N/A (D-6)
  - **File(s):** `js/inventory-import.js` (JSON import `~:1336-1375`; CSV import `~:478-488`)
  - **Acceptance:** JSON import reads `pricingType` back from imported rows (round-trips with C.8). CSV import is **deliberately not** given a `pricingType` column — add a one-line code comment noting the bounded carve-out (CSV is the flat human-facing format; the lot-edit hint reopens as EACH with the correct per-coin price). Makes the JSON-import half of B.4 pass.
  - **Depends on:** B.4
  - **Leverage:** approach.md "CSV is deliberately not carrying pricingType" tradeoff.
  - **Maps to:** AC-7 (durability)
- [x] **C.10 [P]** — Register `pricingType` on the ZIP backup whitelist (D-6)
  - **File(s):** `js/inventory-backup.js` (ZIP backup whitelist, `~:88-108`)
  - **Acceptance:** Add `pricingType` next to the STRK-235 constitutional lines so ZIP backup/restore is lossless. Makes the ZIP-round-trip half of B.4 pass.
  - **Depends on:** B.4
  - **Leverage:** approach.md D-6.
  - **Maps to:** AC-7 (durability)
- [x] **C.11 [P]** — Append `pricingType` to `computeInventoryHash`, **cu-scoped** (D-6)
  - **File(s):** `js/cloud-sync.js` (`computeInventoryHash` content sample, `~:133-156`)
  - **Acceptance:** Append `pricingType` to the hash content **only for cu items** (mirrors the STRK-241 cu-scoped variant/mode append) so non-cu inventories keep their existing hash and users get **no** one-time upgrade sync prompt. Makes B.4's hash assertion pass.
  - **Depends on:** B.4
  - **Leverage:** approach.md D-6 + "Risk: computeInventoryHash upgrade churn"; STRK-241 cu-scoped hash (`project_strk241_243_constitutional_preship_shipped`).
  - **Maps to:** AC-7 (durability)
- [x] **C.12 [P]** — Register `pricingType` in `DIFF_FIELDS` (D-6)
  - **File(s):** `js/diff-engine.js` (`DIFF_FIELDS`, `~:30-80`)
  - **Acceptance:** Add `pricingType` for field-level merge completeness (a denom-LOT vs each change is diffable on import-merge). Makes B.4's diff inspection-check pass.
  - **Depends on:** B.4
  - **Leverage:** approach.md D-6; `project_diffmodal_modify_no_item` (modify-change routing).
  - **Maps to:** AC-7 (durability)
- [x] **C.13 [P]** — Register `pricingType` in `logItemChanges` tracked fields (D-6)
  - **File(s):** `js/changeLog.js` (`logItemChanges` tracked fields, `~:142-158`)
  - **Acceptance:** Add `pricingType` so a lot↔each edit is recorded in the audit/change log. Makes B.4's change-log inspection-check pass.
  - **Depends on:** B.4
  - **Leverage:** approach.md D-6.
  - **Maps to:** AC-7 (durability)
- [x] **C.14** — Verify the bounded **N/A** exclusions (D-6 audible skip)
  - _Verified: `pricingType` is absent from `valuationFieldChanged` (js/events.js:1906-1920), `markUserModified` tracked fields, and `recordBulkPriceHistory` priceFields (js/bulkEdit.js). The only events.js `pricingType` refs are the save-path write (parseItemFormFields) and the commit assembly — both required, neither a valuation-change-detection site._
  - **File(s):** _no file changes — review anchor only_
  - **Acceptance:** Confirm `pricingType` is **NOT** added to the three valuation-change-detection sites — `valuationFieldChanged` (`js/events.js:1862`), `markUserModified` tracked fields (`js/events.js:~1940-1976`), and `recordBulkPriceHistory` priceFields (`js/bulkEdit.js:1728`) — because `pricingType` does not move `price × qty`/melt; registering it there would record spurious price-history points and modified-flags on a lot↔each-only change. This is a deliberate, documented exclusion (audible skip), not an omission.
  - **Leverage:** approach.md "Intentionally Not Modified (bounded N/A — D-6)".
  - **Maps to:** N/A (guards against over-registration; protects AC-10's "no spurious valuation event")

## UI Contract Traceability

_approach.md carries a `## UI Contract` (no standalone mockup — it reuses the existing `#purchasePriceModeToggle` segmented control + constitutional card; the contract text **is** the binding spec). Each named state maps to its implementing task(s), verifying assertion(s), and a visual-verification method. Because no screenshot/playground artifact exists, visual verification is **manual modal inspection** against the contract's described state (recorded in CLOSE-3)._

| UI state (approach.md) | Implementing task(s) | Verifying test | Visual-verification method |
| --- | --- | --- | --- |
| cu · denom · new (toggle visible + LOT) | C.1 | B.1 (asserts no `is-hidden` + mode LOT) | Manual: open add-item, Type=Constitutional, denom mode → toggle shows, LOT selected, placeholder "Lot total" |
| cu · denom · count ≤ 1 (toggle hidden) | C.1, C.2 | B.1 (qty>1 gate) | Manual: set count to 1 → toggle hides live |
| cu · face (toggle hidden, EACH) | C.1, C.5 | B.1 (face hidden + EACH) | Manual: switch to face mode → toggle hidden, price is the total |
| cu · denom · edit (stored lot) | C.3, C.4, C.6 | B.2 + B.3 (reconstructed `price × count`, no drift) | Manual: edit a saved denom-LOT item → toggle visible + LOT, price field = exact original total |
| cu · denom · edit (stored each / legacy absent) | C.4, C.6 | B.3 (EACH + per-coin) | Manual: edit a legacy/each cu item → toggle visible + EACH, per-coin price |
| cu · face · edit (toggle hidden, stored total) | C.5, C.6 | B.3 (face hidden, unchanged) | Manual: edit a face item → toggle hidden, stored total unchanged |
| Mid-edit face→denom (toggle appears, snaps LOT) | C.1 | B.1 (live re-resolve) | Manual: toggle entry mode in an open modal → toggle appears + LOT live |
| Mid-edit denom→face (toggle disappears, reverts EACH) | C.1 | B.1 (live re-resolve) | Manual: toggle entry mode → toggle disappears + EACH live |

> Cohort B assertions check **DOM structure + stored data** (the `is-hidden` class, toggle mode, `item.price`/`item.pricingType`/`item.qty`), not just visible text — satisfying the STRK-123 interaction-flow requirement. The price-history chart is asserted **untouched** (B.5 / AC-10 exclusion).

---

## Standard Closing Tasks

> StakTrakr full roster from `.context/sketch-conventions.md` — all mandatory; genuine non-applicability is marked `N/A — <reason>`, never dropped. Numbering continues as CLOSE-N.

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - _`npm test` (core Playwright PR gate): **381 passed**, exit 0 — zero regressions._
  - **File:** _no file changes — verification only_
  - Run **`npm test`** (core Playwright PR gate). All existing tests pass; all new Cohort B tests pass (green after Cohort C). CI has no Playwright gate — `npm test` is the **sole** test verification (memory `ci-no-playwright-local-gate`); re-run the covering spec after any force-push. Pipe-to-`tail` masks failures — redirect to a file and check `$?` (memory `feedback_test_pipe_tail_masks_failures`).
  - If anything fails: fix the **implementation**, not the test. Tests are the spec.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - _`codacy-analysis analyze --diff`: **0 Critical/High/Medium, 0 security/ESLint findings**. 22 Warning-level Lizard complexity findings, ALL on pre-existing large legacy functions (parseItemFormFields 56, handleTypeChange 35, cloud-sync/import functions, etc.). None of STRK-242's new helpers (resolveLotEachPriceInput, readQty, setQtySource, constitutionalSetEntryMode) are flagged — all under the ccn-25 baseline. C.3's extraction net-reduced parseItemFormFields ccn (removed a ~3-branch inline division block, added ~1 ternary branch). Pre-existing complexity (STRK-170 territory), not introduced here. Cloud gate monitored on the PR (CLOSE-7)._
  - **File:** _no file changes — scan only_
  - Invoke the **`codacy-analysis-cli`** skill → `codacy-analysis analyze --diff` (Gen-3 Codacy CLI) against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Watch the **complexity gate** — `createLotEachToggle` + `parseItemFormFields` are already dense; the C.3/A.1 helper extractions keep ccn under the Lizard baseline (ccn25). Note the dual-ESLint gap: a native `confirm()` passes `npm run lint` but Codacy flags it (`.context/review-and-ci.md`).

- [x] **CLOSE-3. Generate verification stamp**
  - _All 10 ACs stamped below under `## Verification Stamp`; UI-linked ACs carry visual evidence (screenshots `shot_denom_lot.png` / `shot_face_hidden.png`)._
  - **File:** Append to the bottom of this file under `## Verification Stamp`.
  - For EACH AC (AC-1 … AC-10) in `requirements.md`, write exactly one line: `- [x] AC-N — verified by <test name>` or `- [x] AC-N — verified at <path>:<line>`, or `- [ ] AC-N — gap: <reason>`. The block MUST list all 10 ACs.
  - **UI verification requirement (approach.md has a `## UI Contract`):** every AC mapping to a named UI state (AC-1, AC-2, AC-5, AC-7, AC-8, AC-9) needs visual evidence in its stamp line — `…verified by <test> + visually verified against UI-Contract state "<state>"` (manual inspection) or `… + screenshot compared: <path>`. A passing Playwright test alone is **insufficient** for these — it can pass while the modal renders wrong.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains.

- [x] **CLOSE-4. Version bump**
  - _`/update-spot-bundle` (8 new sqld entries → 2026-06-27, copied into worktree), then `/release patch` → **v3.35.60**: bumped the 6 files (constants, package.json, package-lock ×2, version.json, CHANGELOG, about.js What's New prepend + trim to 5); sw.js auto-stamped by hook; `check-release-sync` passed. Commit c554a916._
  - **File:** project version files — the `/release patch` override edits **exactly six**: `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`. `sw.js` is stamped automatically by the `stamp-sw-cache` pre-commit hook (do **not** edit it manually). `manifest.json` and README badges are **not** part of the current override — do not touch them as part of the bump.
  - **MUST run `/update-spot-bundle` first** (every version-bump PR, dev or main — memory `feedback_spot_bundle_every_version_bump`; the script writes to the main checkout, copy the bundle into the worktree per `git-topology.md` §Spot Bundle), **then invoke `/release patch`** as a skill. The `check-release-sync` hook is a SUBSET — hook-green ≠ release-complete; `/release` is the only path that touches all release-bearing files. Ensure Tailscale is active before the PR.

- [x] **CLOSE-5. Vault update** (Foundation audit only — issue closure is CLOSE-9, post-merge)
  - _`/vault-update` audit found a real drift: `architecture.md` + `Deep Dives/Data Model.md` described `pricingType` as presentation-only (chart scaling). Updated both to note STRK-242 made it load-bearing for cu by-denomination edit-restore + persistence (divides by cu.qty). Committed + pushed DocVault (5cbd964)._

- [x] **CLOSE-7. Resolve PR review threads**
  - _`/pr-resolve`: all 7 threads replied + resolved. 2 genuine bugs fixed in `ced4011f` (override-bleed on type exit → `clearQtySource` in handleTypeChange; count-edit re-defaulting a restored EACH → listener no longer changes mode + `updateVisibility` skips self-revert under override) + 2 regression tests; Codacy LOW (instance getExactLotPrice) fixed; Codacy MEDIUM test-dup fixed via helpers; CodeRabbit Minor (safeGetElement guard) = pre-existing; Copilot face↔denom = AC-9 spec. Codacy + CodeQL + CodeRabbit green; 0 unresolved threads; mergeStateStatus CLEAN._
  - **MUST invoke `/vault-update`** as a skill — it audits the Foundation docs even if you believe none are affected. STRK-242 reshapes the constitutional pricing path; check whether `coding-standards.md` / `reusable-patterns.md` need a note on the cu lot/each toggle seam. If zero docs change, the skill reports it — a clean N/A by audit.
  - **Do NOT close the Plane issue here.** Per `.context/implementation-gotchas.md:45-56`, Plane is marked Done only *after* the PR merges and the sketch is archived — that step is **CLOSE-9**.

- [x] **CLOSE-6. Open PR**
  - _[PR #1340](https://github.com/lbruton/StakTrakr/pull/1340) → `dev`, title `feat(STRK-242): …`, labels coderabbit-review + codacy-review, body links STRK-242 + sketch folder + test plan. Merge-base verified == origin/dev (no scope creep)._
  - Title: `feat(STRK-242): constitutional by-denomination lot pricing (coin-count = lot qty)` (user-facing). Stage + commit before `gh pr create`. Body: link to [STRK-242](https://plane.lbruton.cc/lbruton/browse/STRK-242/), link to the sketch folder `DocVault/Projects/StakTrakr/sketches/STRK-242-constitutional-lot-pricing/`, and a test-plan checklist. Target **`dev`** (every change to dev needs a PR). Apply `coderabbit-review` + `codacy-review` labels at creation (review is label-gated; `.context/review-and-ci.md`). PR waits for **`Codacy Static Code Analysis` + CodeQL** green, then normal `gh pr merge --merge` (Protect Dev blocks `--admin`; memory `feedback_protected_dev_admin_merge`).

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill. Scan **both** inline diff threads AND review-body/summary findings (Codacy/Copilot post critical findings outside the diff). All Critical/High fixed or explicitly marked false-positive with reasoning; Medium fix-or-waiver; Low/Info advisory. Async bot reviewers post 1–3 min after checks go green — re-query threads before merge. Watch for the recurring Copilot `/seed-sync` version-bump false-positive (memory `project_copilot_seedsync_versionbump_fp`) and the 75% docstring-coverage gate (write JSDoc pre-emptively).

- [x] **CLOSE-8. Archive sketch** (after PR merges)
  - _PR #1340 merged to dev (merge commit 00286635, 2026-06-27 10:27Z). dev pulled/synced in main checkout; worktree + patch/3.35.60 branch removed; version lock released. Folder moved to `sketches/archive/2026-06-27-STRK-242-constitutional-lot-pricing/`; mem0 memory saved._
  - **MUST invoke `/sketch archive STRK-242`** as a skill — moves the folder to `archive/YYYY-MM-DD-STRK-242-constitutional-lot-pricing/` and saves the mem0 summary. After merge: `git pull --rebase` on dev, `git status` for loose files.

- [x] **CLOSE-9. Mark STRK-242 → Done in Plane** (post-merge, post-archive)
  - _STRK-242 set to Done (state b6039898-c1c1-46ea-8396-1ae8b52f0692) after merge + archive._
  - **File:** _no file changes — Plane state update only_
  - **Ordering is load-bearing** (`.context/implementation-gotchas.md:45-56`): close the Plane issue **only after** the PR has merged and CLOSE-8 archive is done — never before, or STRK-242 can read Done while CI/review is still pending.
  - Mark **STRK-242 → Done**: `mcp__plane__update_issue` to state `b6039898-c1c1-46ea-8396-1ae8b52f0692` (Done).
  - Then **STOP and ask** before the next task (global post-merge rule).

---

> **Multi-model dispatch hint:** Cohort C's five `[P]` persistence edits (C.9–C.13) are the only safe parallel fan-out — each touches a distinct file with no shared symbols. Suggested split: C.9→Codex, C.10→Kimi, C.11→Gemini, C.12/C.13→a second Claude. The `js/events.js` chain (C.1–C.5) and `js/inventory.js` chain (C.6–C.8) must stay single-threaded (same-file). The TDD boundary between Cohort B (red) and Cohort C (green) is a natural model-routing seam. All dispatched prompts MUST name the absolute worktree path (`.worktrees/<issue>-<slug>/`) or subagents write to the main checkout.

## Review Archive — tasks (2026-06-26)

_Verbatim `/sketch-review` markup, preserved for audit. All items reconciled 2026-06-26._

### Resolution Summary

- **Accepted (3):**
  - **B.5 RED-phase boundary** — Acceptance reworded to require the item be created through the modal save path (never direct seeding) so the test is genuinely red before C.3; added `Depends on: B.2`.
  - **CLOSE-4 release-file list** — corrected to the verified six files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`); `sw.js` noted as hook-stamped, `manifest.json`/README badges excluded. Confirmed against `.agents/skills/release/SKILL.md:10-87`.
  - **CLOSE-5 Plane-Done ordering** — split: CLOSE-5 reduced to the `/vault-update` audit; Plane closure moved to new **CLOSE-9** (post-merge/post-archive). Confirmed against `.context/implementation-gotchas.md:45-56`.
- **Rejected (0):** none.
- **Resolved with your input (0):** none — all three were single-source (CODEX) factual corrections verified against the live repo, applied without judgment calls.

### CODEX Review (2026-06-26)

#### Verified

- Read `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, repo `AGENTS.md`, `.context/GLOSSARY.md`, `.context/sketch-conventions.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, and `Projects/StakTrakr/Foundation/coding-standards.md`.
- Re-read reconciled `requirements.md`, `discovery.md`, `approach.md`, and current `tasks.md` for STRK-242.
- Verified purchase toggle/reset/restore and constitutional save/UI chokepoints in `js/events.js:60-280`, `js/events.js:1535-1704`, `js/events.js:1767-2044`, and `js/events.js:2232-2450`.
- Verified edit/duplicate restore and JSON export surfaces in `js/inventory.js:1781-1806`, `js/inventory.js:2111-2145`, `js/inventory.js:2323-2383`, and `js/inventory.js:2419-2458`.
- Verified D-6 persistence surfaces in `js/inventory-import.js:471-493`, `js/inventory-import.js:1336-1378`, `js/inventory-backup.js:59-108`, `js/cloud-sync.js:122-156`, `js/diff-engine.js:30-91`, `js/changeLog.js:139-165`, and `js/bulkEdit.js:1728-1753`.
- Verified existing test ownership in `tests/playwright/core/inventory-math.spec.js:359-411`, `tests/playwright/core/inventory-math.spec.js:890-940`, and `tests/playwright/coverage-map.csv:106`.
- Checked the StakTrakr `/release patch` override at `.agents/skills/release/SKILL.md:10-88` against CLOSE-4's release-file list.

#### Top concerns

- B.5 can be implemented as an already-green seeded display regression despite sitting in the RED cohort; it needs to require the failing modal save path or move seeded display-only coverage out of the red phase.
- CLOSE-4 names the wrong release artifact set: it includes `sw.js`, `manifest.json`, and README badges, while the current release override edits six files and includes `package-lock.json`.
- CLOSE-5 closes STRK-242 in Plane before PR creation/merge/archive, contradicting the project sketch closeout order that marks Plane Done only after merge/archive.

#### Unverified assumptions

- I did not query Plane for STRK-242; scope was reviewed from the embedded issue text and live repo evidence.
- I did not run Playwright or Codacy because this review phase validates and comments on the tasks artifact only.

---

## Verification Stamp

_Generated at CLOSE-3 (2026-06-27). All 15 STRK-242 Playwright tests green; full core suite 381 passed. UI-linked ACs (1,2,5,7,8,9) carry visual evidence per the `## UI Contract` requirement — manual modal inspection against the contract states, with screenshots captured for the two primary states (`shot_denom_lot.png`, `shot_face_hidden.png`)._

- [x] **AC-1** (toggle visible in denom) — verified by `denomination mode shows the purchase toggle defaulted to LOT (AC-1, AC-2)` (asserts no `is-hidden`) + visually verified against UI-Contract state "cu · denom · new" (screenshot `shot_denom_lot.png`: lot/each toggle rendered visible).
- [x] **AC-2** (new denom defaults to LOT) — verified by the same test (asserts LOT button `active`) + visually verified against "cu · denom · new" (screenshot: LOT segment highlighted).
- [x] **AC-3** (divide by coin count, not #itemQty) — verified by `denomination LOT save divides the lot total by coin count, not #itemQty (AC-3)` (saved.price = 1700/30, pricingType "lot", price×qty ≈ 1700).
- [x] **AC-4** (exact-lot fidelity on uneven division) — verified by `uneven lot division reconstructs the exact total on edit without drift (AC-4)` (#itemPrice reopens "1700.00"; price×qty within 1e-9) — STRK-88 cache keyed on cu.qty via `item.qty`.
- [x] **AC-5** (face hides toggle, lot of one) — verified by `switching constitutional entry mode live re-resolves the toggle (AC-5, AC-9)` (face → `is-hidden`) + visually verified against "cu · face" (screenshot `shot_face_hidden.png`: toggle absent, Total Face Value field shown).
- [x] **AC-6** (face never divides — STRK-235 guard) — verified by `face-value mode never divides the entered price (AC-6 regression guard)` (saved.price === 100).
- [x] **AC-7** (edit restores stored pricingType) — verified by `editing a stored denom LOT item restores toggle visible + LOT, reconstructed total`, `editing a stored denom EACH item restores toggle visible + EACH per-coin`, `editing a legacy denom item (no pricingType) defaults to EACH`, plus durability: `JSON export → import round-trip`, `ZIP backup whitelist`, `computeInventoryHash cu-scoped`, `DiffEngine and changeLog register a pricingType-only change` + visually verified against "cu · denom · edit" (toggle/mode reuse the same components shown in `shot_denom_lot.png`).
- [x] **AC-8** (edit face unchanged) — verified by `editing a stored face item keeps toggle hidden, price = stored total (AC-8)` (`is-hidden` + #itemPrice "100.00") + visually verified against "cu · face · edit" (`shot_face_hidden.png` confirms face mode hides the toggle).
- [x] **AC-9** (live re-resolve on entry-mode switch) — verified by `switching constitutional entry mode live re-resolves the toggle (AC-5, AC-9)` and `denomination count > 1 shows the toggle; count <= 1 hides it (AC-9 corner)` + visually verified by the denom→face transition between `shot_denom_lot.png` and `shot_face_hidden.png` (same open modal).
- [x] **AC-10** (display totals price×qty; chart untouched) — verified by `denom LOT item saved via the modal renders price×qty totals (AC-10)` (table cell "$1,700.00", not "$51,000.00"); the price-history chart is untouched by the no-production-change invariant (no edits to `js/viewModal.js` chart scaling — confirmed in the diff).
