---
sketch: STRK-88-fp-price-artifact
phase: tasks
created: 2026-05-19
approved: 2026-05-19
---

# STRK-88 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it — this is setup work, not a stop-the-world gate._

- [x] **0.1** — Claim StakTrakr patch version and enter the patch worktree
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `devops/version.lock` has an active STRK-88 patch-version claim, `git worktree list` shows `.worktrees/patch-<VERSION>` on branch `patch/<VERSION>`, and all implementation commands run from that patch worktree, not `/Volumes/DATA/GitHub/StakTrakr` on `dev`.
  - **If the worktree does not exist yet:** Follow StakTrakr `AGENTS.md` and `DocVault/Projects/StakTrakr/Foundation/coding-standards.md`: prune expired claims, claim the next patch version, then create `.worktrees/patch-<VERSION>` with branch `patch/<VERSION>`.
  - **Leverage:** StakTrakr version-lock/worktree rules; do not fall back to `sketch/STRK-88-fp-price-artifact`.

---

## Sprint Cohort A — Foundation / Preflight (parallel-safe)

_This cohort confirms the code and tests still match the sketch before RED/GREEN work starts._

- [x] **A.1 [P]** — Verify current precision-sensitive callsites
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Record in the implementation note that the live worktree still contains the STRK-88 callsites: `js/events.js` toggle conversion and LOT save division, `js/inventory.js` edit/duplicate price population and LOT restore, `js/inventory-import.js` Numista buying-price export, and no existing lot/each Playwright test for the `1700 / 30` repeating-decimal case.
  - **Leverage:** `rg "toFixed\\(6\\)|56\\.666|1700|exportNumistaCsv|purchasePriceToggle" js tests/playwright/inventory/lot-each-purchase-price.spec.js`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5

## Sprint Cohort B — Tests · RED (sequential)

_Write failing coverage before implementation. These tests should fail against the current code because visible values still flow through `.toFixed(6)` or raw stored floats._

- [x] **B.1** — Add STRK-88 regression coverage to the lot/each Playwright spec
  - **File(s):** `tests/playwright/inventory/lot-each-purchase-price.spec.js`
  - **Acceptance:** New tests fail before implementation. Each AC sub-scenario gets its own `test()` block for failure isolation. Coverage includes: add-mode `$1700` LOT / qty `30` toggles to `$56.67` EACH and back to `$1700`; the toggle still emits the `input` event once after conversion; saving a LOT-mode `$1700` / qty `30` item reopens with `$56.67` EACH and `$1700` LOT; drifted legacy edit-load values show `$56.67` in EACH mode and `$1700` in LOT mode; duplicate mode rounds drifted values and preserves LOT mode for LOT source items; changing qty while LOT mode is active invalidates the exact-lot cache; the exact-lot dataset is cleared on reset/close/post-save boundaries; Numista CSV with a non-USD display currency exports converted display-currency values with active-currency precision; non-USD Numista CSV round-trip (export at EUR then reimport) preserves the original USD price within rounding tolerance.
  - **Leverage:** Existing helpers in the same file (`seedData`, `gotoApp`, `openAddModal`, `openEditModal`, `openCloneModal`, `selectPurchaseMode`, `submitItemForm`); current tests 15-17 for toggle conversion and input-event style.
  - **Maps to:** AC-1, AC-2, AC-3a, AC-3b, AC-4, AC-5a, AC-5b

## Sprint Cohort C — Implementation · GREEN (sequential)

_Make the Cohort B tests pass while staying inside the approved file map._

- [x] **C.1** — Add currency fraction and numeric rounding helpers
  - **File(s):** `js/utils.js`
  - **Acceptance:** `getCurrencyFractionDigits(currency)` and `roundToCurrencyPrecision(value, currency)` exist near `formatCurrency` / `getCurrencySymbol`, use `Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits` with a try/catch that defaults to `2` for non-ISO currencies (goldback `GB`, custom denominations) to prevent `NaN`, return numeric values suitable for inputs/math, and are exposed on `window.*` (matching `getCurrencySymbol` sibling pattern; add to `module.exports` only if a Node-side test consumer is introduced).
  - **Depends on:** B.1
  - **Maps to:** AC-2, AC-3, AC-4, AC-5

- [x] **C.2** — Make purchase-price toggle/save use exact LOT state and display rounding
  - **File(s):** `js/events.js`
  - **Acceptance:** Parameterize `createLotEachToggle` with an optional `roundDisplay(value)` config callback — `purchasePriceToggle` passes a function using `roundToCurrencyPrecision`/`getCurrencyFractionDigits`, `disposeAmountToggle` passes `null` to preserve existing `toFixed(6)` behavior; `maybeConvert` calls `roundDisplay` when provided, otherwise falls back to current `toFixed(6)` logic. LOT→EACH displays rounded active-currency precision while preserving `data-exact-lot-price`; EACH→LOT uses the cached exact LOT total when valid; `parseItemFormFields` prefers the exact LOT cache for LOT saves when the cache rounds to the visible LOT value. Cache cleanup at each named site: `resetPurchasePriceToggle` (~L162), `closeItemModal` (~L2335), post-save reset (~L3962), and a new `#itemQty` input listener (alongside existing `purchasePriceToggle.updateVisibility` qty listener) that clears the cache when purchase mode is LOT. Consider a small `clearExactLotPriceCache(priceEl)` helper to centralize `delete priceEl.dataset.exactLotPrice` across all four sites.
  - **Depends on:** C.1
  - **Maps to:** AC-1, AC-2, AC-5a, AC-5b

- [x] **C.3** — Round edit and duplicate form population without changing storage schema
  - **File(s):** `js/inventory.js`
  - **Acceptance:** Edit-mode EACH population rounds drifted `item.price` values before assigning `#itemPrice`; edit-mode LOT restore multiplies full-precision unit price by qty, rounds for display, and rehydrates `data-exact-lot-price`; replace both `.toFixed(2)` hardcodes in the `fxRate !== 1` branches at ~L1495 (edit) and ~L1877 (duplicate) with `roundToCurrencyPrecision(value, activeCurrency).toFixed(getCurrencyFractionDigits(activeCurrency))` for correct non-2-digit currency display (JPY=0, BHD=3); duplicate-mode population applies the same rounding; LOT-mode duplicates call `restorePurchasePriceToggle(sourceItem.pricingType, sourceItem.qty)` instead of unconditional `resetPurchasePriceToggle()`, preserve LOT mode, and rehydrate the exact LOT cache; JSON / ZIP backup export code remains untouched.
  - **Depends on:** C.1, C.2
  - **Maps to:** AC-3a, AC-3b, AC-5b

- [x] **C.4 [P]** — Normalize Numista CSV visible buying-price output
  - **File(s):** `js/inventory-import.js`
  - **Acceptance:** `exportNumistaCsv` keeps the `Buying price (${displayCurrency})` header, converts internal USD purchase price into the active display currency via `getExchangeRate(displayCurrency)`, then writes a rounded string using `roundToCurrencyPrecision(...).toFixed(getCurrencyFractionDigits(...))`; general CSV/PDF and JSON/backup behavior remain unchanged.
  - **Depends on:** C.1 (no overlap with C.2 or C.3 — safe to run parallel with C.3)
  - **Maps to:** AC-4

- [x] **C.5** — Run focused STRK-88 checks and remove stale precision assertions
  - **File(s):** `tests/playwright/inventory/lot-each-purchase-price.spec.js`
  - **Acceptance:** Focused Playwright run for `tests/playwright/inventory/lot-each-purchase-price.spec.js` passes; any prior raw-value assertions in this file are updated to assert visible currency-rounded behavior or numeric tolerance rather than literal `56.666667`; no unrelated tests are weakened.
  - **Depends on:** C.2, C.3, C.4
  - **Maps to:** All AC

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - **Acceptance:** `npm run lint` and `npm test` pass from `.worktrees/patch-<VERSION>` with all new STRK-88 tests green. If the full suite is blocked by environment limits, run `npm run test:offline` plus the focused STRK-88 Playwright file and record the exact blocker.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - **Acceptance:** Run `codacy-cli` against changed files. Critical/High findings are fixed; Medium findings are fixed or explicitly documented; `.codacy/codacy.yaml` tool-version churn is restored or excluded unless this task intentionally changes Codacy config.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** `DocVault/Projects/StakTrakr/sketches/STRK-88-fp-price-artifact/tasks.md`
  - **Acceptance:** Append `## Verification Stamp` to this file with one line for each AC from `requirements.md`: `AC-N — verified at <path>:<line>` or `AC-N — verified by <test name>`. Refuse to proceed to CLOSE-4 while any AC remains unstamped or marked as a gap.

- [x] **CLOSE-4. Version bump**
  - **File:** StakTrakr release artifacts owned by `/release patch`
  - **Acceptance:** MUST invoke `/release patch`. Resulting release artifacts are synchronized for the claimed patch version: `js/constants.js`, `package.json`, `version.json`, `CHANGELOG.md`, `js/about.js`, and hook-stamped `sw.js` if the pre-commit hook updates it.

- [/] **CLOSE-5. Vault update + close issue**
  - **File:** DocVault audit/update owned by `/vault-update`
  - **Acceptance:** MUST invoke `/vault-update`; if no foundation docs need updates, record the clean audit. Then mark STRK-88 Done in Plane only after the PR has merged or the user explicitly directs early closeout.

- [x] **CLOSE-6. Open draft PR**
  - **File:** _GitHub PR metadata only_
  - **Acceptance:** Push branch `patch/<VERSION>` and open a draft PR targeting `dev` with title `v<VERSION> — STRK-88: <summary>`, label `codacy-review`, linked Plane issue STRK-88, sketch path `DocVault/Projects/StakTrakr/sketches/STRK-88-fp-price-artifact/`, and test evidence.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the patch worktree as needed_
  - **Acceptance:** MUST invoke `/pr-resolve`; scan inline diff threads and review-body findings. Critical/High findings are fixed or explicitly classified as false-positive with reasoning; rerun relevant checks after any fix commits. (N/A — draft PR opened, no threads yet)

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **File:** `DocVault/Projects/StakTrakr/sketches/STRK-88-fp-price-artifact/`
  - **Acceptance:** MUST invoke `/sketch archive STRK-88` after the PR merges; the folder moves to `DocVault/Projects/StakTrakr/sketches/archive/YYYY-MM-DD-STRK-88-fp-price-artifact/` and the archive summary is saved to memory.

---

> **Multi-model dispatch hint:** A.1 is `[P]` (preflight). In Cohort C, C.3 and C.4 are both `[P]` (safe to run in parallel after C.1 — they edit non-overlapping files `js/inventory.js` and `js/inventory-import.js`). Sequence: C.1 → C.2 → C.3 `[P]` C.4 → C.5.

## Review Archive — tasks (2026-05-19)

_Reconciled by /sketch reconcile on 2026-05-19. Original reviewer marks preserved below for audit._

### Opus

#### Verified

- Confirmed `createLotEachToggle` factory is invoked twice with shared `maybeConvert` closure: `purchasePriceToggle` (`js/events.js:154-160`) and `disposeAmountToggle` (`js/events.js:179-185`, exposed via `window.disposeAmountToggle` at L187). Removing `toFixed(6)` from L86 changes BOTH consumers — directly contradicting C.2's "non-purchase toggles … keep their existing higher-precision behavior" clause.
- Confirmed all four code targets exist at the cited lines: toggle `toFixed(6)` at `js/events.js:86`, save-time `toFixed(6)` at `js/events.js:1445`, edit-load LOT `toFixed(6)` at `js/inventory.js:1739`, Numista `.toFixed(2)` at `js/inventory-import.js:1021`.
- Confirmed `js/inventory.js:1495` and `:1877` both hardcode `.toFixed(2)` in the `fxRate !== 1` branch for edit and duplicate populate respectively — these are not addressed by C.3 acceptance as written.
- Confirmed `resetPurchasePriceToggle` (`js/events.js:162-166`), `closeItemModal` (`js/events.js:2335-2352`), and post-save reset (`js/events.js:3962`) do not currently touch any `data-*` attribute on `#itemPrice`.
- Confirmed `js/utils.js:3394-3408` exports a curated `module.exports` list that EXCLUDES `formatCurrency` and `getCurrencySymbol`; `getCurrencyFractionDigits` would be a new pattern, not parallel to siblings.
- Confirmed `tests/playwright/inventory/lot-each-purchase-price.spec.js` has helpers `seedData`, `gotoApp`, `openAddModal`, `openEditModal`, `openCloneModal`, `selectPurchaseMode`, `submitItemForm` (lines 41, 87, 99, 109, 114, 152, 171) — all of B.1's `Leverage` references are accurate.
- Confirmed no existing test asserts the literal `56.666667` or `1700.00001`, so C.5's "remove stale precision assertions" clause is precautionary, not load-bearing.

#### Top concerns

1. **Shared-factory contradiction (C.2).** `createLotEachToggle` is the same function instance for purchase price AND disposition amount via closure capture, so the "disposition keeps higher-precision behavior" clause is unimplementable without parameterizing the factory (config callback) or threading rounding policy through `setMode`. Tasks must state which path is taken — otherwise the implementer either silently changes disposition (acceptance violation) or hand-edits the wrong place.
2. **`.toFixed(2)` survives the fxRate-conversion branch (C.3).** The exact code C.3 modifies (`js/inventory.js:1495`, `:1877`) already hardcodes 2 decimals when `fxRate !== 1`. For non-2-digit display currencies, this is inconsistent with AC-2/AC-4. C.3 should explicitly replace both `.toFixed(2)` hardcodes with the new currency-aware helpers.
3. **Cache-cleanup sites are unnamed in the File Map (C.2).** Acceptance lumps "reset/add/cancel/close/post-save paths delete `data-exact-lot-price`" into one clause; the actual sites span `resetPurchasePriceToggle`, `closeItemModal`, `#itemQty` listener, and post-save reset. Without an explicit subtask list, the implementer can ship a half-cleaned cache that leaks state across modals — exactly what KIMI's approach review warned about.

#### Unverified assumptions

- The implementer will parameterize `createLotEachToggle` to accept a per-instance rounding policy rather than branching inside `maybeConvert` (approach didn't decide).
- `Intl.NumberFormat` returns sensible `maximumFractionDigits` for goldback (`GB`) and any custom non-ISO currency — if it throws, `roundToCurrencyPrecision` must fall back to 2 to avoid `NaN`.
- A Node/jest consumer needs `getCurrencyFractionDigits` in `module.exports` — if not, the acceptance line should match `getCurrencySymbol`'s window-only sibling pattern.
- Adding `data-exact-lot-price` cleanup to `closeItemModal` does not interfere with concurrent modal flows (e.g., Numista picker, restore-choice modal) — none currently touch `#itemPrice.dataset`, but the assertion is worth a Playwright check.
- The Numista CSV round-trip (export at non-USD then reimport at the same currency) is acceptable when exchange rates are stable; rate drift between export and reimport will silently re-price legacy items.
- Disposition amount NOT changing behavior is actually desired by product. If product wants disposition to also display at currency precision, C.2's acceptance line should flip rather than the factory be parameterized.
- B.1's "single comprehensive RED task" structure won't mask partial failures — each subcase should ideally be its own `test()` so a failure surface names the AC it broke.

#### Inline marks on C.1

- **Sibling pattern mismatch on `module.exports`.** `formatCurrency` and `getCurrencySymbol` are NOT in `module.exports` today (`js/utils.js:3394-3408` exports only `stripNonAlphanumeric`, `sanitizeObjectFields`, `sanitizeImportedItem`, `computeMeltValue`, `calculateRetailPrice`, `computeItemValuation`, `getContrastColor`, `debounce`, `generateUUID`, `setButtonLoading`, `escapeHtml`). The "exposed via both `window.*` and `module.exports`" rule is approach.md D-2's preference, not the project's actual sibling pattern.
- **`Intl.NumberFormat` fallback for non-ISO currencies.** Goldback (`GB`), custom denominations, and any non-ISO-4217 currency throw or fall through inside `Intl.NumberFormat({ style: "currency", currency: "GB" })`. `formatCurrency` already has a try/catch wrapper for this (`js/utils.js:599+`).

#### Inline marks on C.2

- **Shared factory hazard.** `createLotEachToggle` (`js/events.js:60`) is invoked TWICE — once as `purchasePriceToggle` (L154) and once as `disposeAmountToggle` (L179). The `toFixed(6)` lives inside `maybeConvert` (L83-87), which is closure-captured per factory invocation.
- **`data-exact-lot-price` cleanup is invisible in the File Map.** C.2 acceptance listed cleanup as one clause, but the actual code touchpoints span at least `resetPurchasePriceToggle` (L162), `closeItemModal` (L2335-2352), and the post-save reset at L3962.
- **Quantity-change invalidation needs a concrete listener target.** `#itemQty` already has multiple listeners (visibility-toggling at `updateVisibility`, validation).

#### Inline marks on C.3

- **Hardcoded `.toFixed(2)` survives in the `fxRate !== 1` branch.** At `js/inventory.js:1495` and `:1877` — these were not addressed by C.3 acceptance as written.

#### Inline marks on C.4

- **C.4 has no overlap with C.2 or C.3.** It edits `js/inventory-import.js` (single callsite at L1021). Could safely run in parallel with C.3.
- **Reverse-trip semantics with `importNumistaCsv` need a Playwright assertion.** The importer (`js/inventory-import.js:771-775`) calls `convertToUsd(amount, headerCurrency)`.

### Gemini

#### Verified

- Confirmed that `createLotEachToggle` in `js/events.js` (lines 60-88) is shared between `purchasePriceToggle` (L154) and `disposeAmountToggle` (L179), meaning any changes inside the factory closure without parameterization will affect both.
- Confirmed that the `fxRate !== 1` display price logic in `js/inventory.js` (line 1495 and line 1877) currently hardcodes `.toFixed(2)` for USD conversion, which bypasses the display currency precision rules.
- Confirmed that `js/utils.js` (lines 3394-3408) does not export `formatCurrency` or `getCurrencySymbol` via `module.exports`, meaning exporting the new helpers there would be inconsistent with sibling utilities.
- Confirmed that `exportNumistaCsv` in `js/inventory-import.js` (line 1021) writes a `.toFixed(2)` formatted value without currency translation, and that `importNumistaCsv` (lines 771-775) parses this value back assuming the display currency, leading to data inflation.
- Confirmed that the `lot-each-purchase-price.spec.js` Playwright spec does not have tests asserting exact floating-point tolerances or the repeating decimal case of `1700 / 30`.

#### Top concerns

1. **Shared Factory Coupling (`js/events.js`):** Stripping the `toFixed(6)` truncation inside `createLotEachToggle` directly impacts both `purchasePriceToggle` and `disposeAmountToggle`. To keep the higher precision for disposition amounts, the factory must be parameterized to support customizable rounding behavior per instance.
2. **Hardcoded `.toFixed(2)` in `fxRate !== 1` Branches:** The edit/duplicate form population code in `js/inventory.js` still has hardcoded `.toFixed(2)` formatting for non-USD conversions. These need to be replaced with the new currency-aware helper to avoid display bugs under 0-decimal or 3-decimal currencies.
3. **Implicit `module.exports` Requirement:** The tasks specify exporting the helpers through `module.exports` in `js/utils.js`. Because sibling formatting utilities are only exposed on `window` and no Node/Jest test runner is active in the codebase, this represents dead code and should be removed.

#### Unverified assumptions

- **Exchange Rate Stability during Numista Import/Export:** We assume that the user will not face significant price changes when importing a Numista CSV that was exported under a slightly different rate, though this is a known limitation of using display-converted values in CSV exchange formats.
- **`Intl.NumberFormat` custom code fallback:** We assume that when using non-ISO/custom currencies (like Goldback `GB`), the fallback fraction digits will default to `2` to prevent downstream calculations from receiving `NaN` or failing to format.
- **Side effects of clearing exact LOT price cache:** We assume that clearing `data-exact-lot-price` on `#itemPrice` during modal close/reset is fully sufficient and will not interfere with concurrent forms like the Numista picker or change log restorations.

#### Inline marks on C.1

- **Graceful non-ISO fallback.** Agreed with OPUS — `getCurrencyFractionDigits` must try/catch and default to `2`.
- **Export alignment.** Sibling pattern excludes currency helpers from `module.exports`; omit unless Node tests introduced.

#### Inline marks on C.2

- **Parameterizing `createLotEachToggle`.** Optional `roundDisplay` function or `precisionMode` parameter. `purchasePriceToggle` gets currency precision; `disposeAmountToggle` gets null/higher-precision fallback.
- **Centralized Cache Clearing Helper.** Small `clearExactLotPriceCache(priceEl)` helper at all reset/cancel/close boundaries.

#### Inline marks on C.3

- **Fixing `toFixed(2)` in `fxRate !== 1` branch.** Replace hardcoded formatting with `roundToCurrencyPrecision(value, currency).toFixed(getCurrencyFractionDigits(currency))`.

#### Inline marks on C.4

- **Parallel execution with C.3.** C.4 depends only on C.1; no file overlap with C.2 or C.3.

### Resolution Summary

- Accepted: 7
- Rejected: 0
- Resolved with your input: 3 (disposition keeps 6-decimal via factory parameterization; B.1 uses individual test() blocks; B.1 adds non-USD round-trip assertion)

## Verification Stamp

- **AC-1** — verified by `18. STRK-88 AC-1: $1700 LOT/qty 30 toggles to $56.67 EACH (not $56.666667)` and `19. STRK-88 AC-1: EACH→LOT with exact-lot cache restores original $1700`
- **AC-2** — verified by `20. STRK-88 AC-2: toggle emits exactly one input event after LOT→EACH conversion`
- **AC-3a** — verified by `22. STRK-88 AC-3a: editing a LOT-saved item reopens in LOT mode showing $1700`
- **AC-3b** — verified by `21. STRK-88 AC-3b: editing an EACH-saved item with drift reopens in EACH mode showing $56.67`
- **AC-4** — verified at `js/inventory-import.js:1025-1036` and by `26. STRK-88 AC-4: Numista CSV export writes display-currency buying price` plus `27. STRK-88 AC-4: Numista EUR export reimports without USD price inflation`; PDF remains covered by existing `formatCurrency` path in `js/inventory.js:2095-2116`
- **AC-5a** — verified by existing terminating LOT save coverage `5. Lot mode divides on save (4x at $400 -> $100 each)` and the unchanged toggle conversion checks
- **AC-5b** — verified by `20b. STRK-88 AC-5b: saving $1700 LOT/qty 30 does not persist six-decimal drift`, `22. STRK-88 AC-3a: editing a LOT-saved item reopens in LOT mode showing $1700`, and `25. STRK-88 AC-5b: duplicating a LOT-saved item preserves LOT mode and total`
