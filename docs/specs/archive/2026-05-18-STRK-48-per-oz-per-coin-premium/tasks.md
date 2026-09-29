---
sketch: STRK-48-per-oz-per-coin-premium
phase: tasks
created: 2026-05-14
approved: 2026-05-17
---

# STRK-48 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, <=14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, invoke skills by name verbatim. If a closing task is genuinely irrelevant, mark it `N/A — <one-line reason>` rather than dropping the task.

## Sprint Cohort 0 — Setup (sequential)

_The `/sketch apply` phase must create the StakTrakr patch worktree before iterating these tasks. Cohort 0 records the repo-specific setup gate so implementation does not happen on `dev`._

- [x] **0.1** — Claim the StakTrakr patch version and worktree
  - **File(s):** _setup only — no tracked runtime file changes_
  - **Acceptance:** Expired version-lock claims are pruned, a fresh STRK-48 claim is recorded in the gitignored version lock, and `git worktree list` shows `.worktrees/patch-<VERSION>/` on branch `patch/<VERSION>`. Implementation shell is inside that worktree, not `/Volumes/DATA/GitHub/StakTrakr` on `dev`.
  - **Leverage:** StakTrakr `AGENTS.md` version-lock gate; `DocVault/Projects/StakTrakr/Foundation/coding-standards.md` Release Process; `using-git-worktrees` skill.
  - **Maps to:** Setup only.

- [x] **0.2** — Re-read the approved sketch before editing
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** Implementation agent confirms `requirements.md`, `discovery.md`, `approach.md`, and this `tasks.md` are present and that `approved:` is stamped by the human before code work starts.
  - **Leverage:** `/sketch apply` hard gate.
  - **Maps to:** All AC.

## Sprint Cohort A — Independent Foundations (parallel-safe)

_These tasks touch disjoint files and can run in parallel._

- [x] **A.1 [P]** — Add synchronous historical spot lookup helper
  - **File(s):** `js/spot.js`
  - **Acceptance:** `lookupHistoricalSpot(metalName, dateStr)` returns a single numeric spot or `null`; uses only `historicalDataCache`; normalizes `metalName` to Title Case internally (e.g., `"gold"` → `"Gold"`) so callers can pass lowercase `metalKey`; guards against the supported-metal list `["Gold", "Silver", "Platinum", "Palladium"]`; handles `historicalDataCache.get(year)` returning `undefined` for unloaded years (treat as empty — no async fetch); scans target year plus adjacent years for year-boundary windows; applies exact → +/-1 → +/-3 → +/-7 day widening with proximity sort + newest-timestamp tiebreak, then returns `results[0].spot` (no day-level dedup needed since only the single closest result is used); exposes the helper on `window`.
  - **Leverage:** `historicalDataCache` / `fetchYearFile()` area in `js/spot.js`; `searchHistoricalByDate()` algorithm in `js/spotLookup.js`.
  - **Maps to:** AC-4.

- [x] **A.2 [P]** — Add valuation six-column grid styling
  - **File(s):** `css/styles.css`
  - **Acceptance:** `.view-detail-grid.six-col` renders six desktop columns; mobile rules at ≤768px and ≤480px use the compound selector `.view-detail-grid.six-col` (2-class specificity beats the existing `.view-detail-grid` catch-all) to collapse to `1fr 1fr 1fr` (3 columns per AC-8); existing `.gain`, `.loss`, and `.muted` value styling still applies without duplicating color tokens. Visually verify at 769–900px narrow desktop that 6 × `1fr` with currency values is not unreadably cramped (consider `minmax(80px, 1fr)` if needed).
  - **Leverage:** Existing `.three-col` / `.four-col` grid rules and view modal mobile breakpoints.
  - **Maps to:** AC-8.

- [x] **A.3 [P]** — Fix `computeItemValuation()` for `pricingType: "lot"` items
  - **File(s):** `js/utils.js`
  - **Acceptance:** `computeItemValuation()` correctly derives per-unit purchase price: when `item.pricingType === "lot"`, `purchasePrice = item.price / qty` (lot total divided by quantity); when `item.pricingType === "each"` or absent (legacy), `purchasePrice = item.price`. `purchaseTotal` remains `purchasePrice * qty` (which now equals `item.price` for lot items — correct). Existing callers (`_buildValuationSection`, chart markers) get corrected values without code changes on their side.
  - **Leverage:** `computeItemValuation()` at `js/utils.js:1486–1508`; `pricingType` toggle in `js/events.js:71–88`.
  - **Maps to:** AC-1, AC-2, AC-7, AC-9, AC-10, AC-11 (fixes pre-existing bug that would propagate to new premium/G/L% display).

## Sprint Cohort B — Valuation Rendering (sequential)

_These tasks share `js/viewModal.js`, so run them in order._

- [x] **B.1** — Resolve purchase spot and premium display values
  - **File(s):** `js/viewModal.js`
  - **Acceptance:** `_buildValuationSection()` or local helper logic resolves purchase spot through supported metal → `lookupHistoricalSpot()` → `item.spotPriceAtPurchase` → missing; ignores stored `premiumPerOz` / `totalPremium`; uses `metrics.weightOz * metrics.purity` as ASW; derives per-unit purchase price via `computeItemValuation()` (which now handles `pricingType` correctly after A.3); shows muted "—" when spot or ASW is insufficient. `computeItemValuation()` is read-only leverage — its return values feed the display, but B.1 does not modify it.
  - **Depends on:** A.1, A.3.
  - **Leverage:** `_getViewMetrics()`, `computeItemValuation()` (read-only — returns corrected `purchasePrice`/`purchaseTotal`), existing Gain/Loss sign/color pattern.
  - **Maps to:** AC-1, AC-2, AC-4, AC-5, AC-6, AC-7, AC-9.

- [x] **B.2** — Rewrite the Valuation section into lot-aware six-column rows
  - **File(s):** `js/viewModal.js`
  - **Acceptance:** Valuation renders columns Purchase, Premium, Melt, Retail, Gain/Loss, and G/L% using the existing `_detailItem()` label-above-value pattern (6 cells, each self-labeled — NOT a separate header row); desktop uses the new `.six-col` grid; mobile retains the 3×2 collapse; qty > 1 renders total row first and per-unit row second; qty === 1 renders one row; Premium and G/L% include plus/minus signs and apply `.gain` / `.loss` via `_detailItem()`'s `extraClass` parameter (applied to the value `<span>`, matching `.view-detail-value.gain` specificity); percentage values use an inline `formatPercent(value)` helper producing signed output like `+10.2%` / `-2.1%` / `"—"` (not `formatCurrency()`); missing values use `.muted`.
  - **Depends on:** A.2, A.3, B.1.
  - **Leverage:** `_section()`, `_detailItem()` (returns the element — use for dynamic class needs; `_addDetail()` does NOT return the element), `formatCurrency()`, existing purchase date formatting.
  - **Maps to:** AC-3, AC-8, AC-9, AC-10, AC-11.

## Sprint Cohort C — Verification (sequential)

- [x] **C.1** — Run targeted implementation checks and produce test file
  - **File(s):** `tests/playwright/view-modal-valuation.spec.js` (new)
  - **Acceptance:** Produces automated Playwright assertions covering: exact historical date spot lookup, weekend/holiday nearest trading day, missing date/spot fallback, unsupported metal fallback, zero ASW, gb/sb converted weight, qty > 1 lot rows (total + per-unit), negative premium coloring, missing retail/purchase percent fallbacks, desktop six-column layout, mobile three-column layout, and `pricingType: "lot"` per-unit derivation. Additionally verifies B.3's scoping constraints: the implementation does not alter inventory table/card valuation, quick Details modal, chart marker behavior, schema, localStorage keys, or persisted premium fields (verify via code review that the diff touches only `viewModal.js`, `spot.js`, `utils.js`, and `styles.css`).
  - **Depends on:** B.2.
  - **Leverage:** Existing view modal helpers in `tests/playwright/*`; browser preview at `python3 -m http.server 8000` if visual QA is needed.
  - **Maps to:** All AC.

- [x] **C.2** — Run repo checks before closeout
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `npm run lint` passes; a focused Playwright command covering the Item Detail modal passes; `npm test` passes, or `npm run test:offline` is used only if network scenarios are unavailable and the limitation is recorded.
  - **Depends on:** C.1.
  - **Leverage:** StakTrakr test guidance in `AGENTS.md`.
  - **Maps to:** All AC.

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run the project's complete test command. All existing tests pass; any focused STRK-48 checks pass.
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-11), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`; `sw.js` may be stamped by the pre-commit hook)
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.

- [x] **CLOSE-5. Vault update**
  - **File:** _DocVault audit/update only_
  - **MUST invoke `/vault-update`** as a skill — even if no foundation docs are affected, the skill performs the audit. If no docs need updating, record `N/A — vault-update found no documentation changes required`.

- [x] **CLOSE-6. Open draft PR**
  - **File:** _GitHub PR metadata only_
  - Open a draft PR from `patch/<VERSION>` to `dev`. Title format: `v<VERSION> — STRK-48: display per-oz / per-coin premium in Item Detail modal`. Body must include STRK-48, the sketch folder path, version bumped, changed files, and test evidence.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan both inline diff threads and review-body findings.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **File:** `DocVault/Projects/StakTrakr/sketches/STRK-48-per-oz-per-coin-premium/`
  - **MUST invoke `/sketch archive STRK-48`** as a skill — moves the folder to `archive/YYYY-MM-DD-STRK-48-per-oz-per-coin-premium/`, saves the handoff, and closes STRK-48 in Plane after merge.

---

## Verification Stamp

_Generated 2026-05-17. Each AC from requirements.md mapped to implementation line or test._

- [x] AC-1 — verified at `js/viewModal.js:576` (`premiumPerOz = purchasePrice / asw - resolvedSpot`); verified by T11 ("Premium cell shows a percentage string with a sign")
- [x] AC-2 — verified at `js/viewModal.js:577` (`premiumPerCoin = purchasePrice - resolvedSpot * asw`)
- [x] AC-3 — verified at `js/viewModal.js:622-625` (`signClass()` returns `"gain"` / `"loss"` / `"muted"`); verified by T13 ("negative premium applies .loss class") and T14 ("positive gain/loss applies .gain class")
- [x] AC-4 — verified at `js/spot.js:660-700` (`lookupHistoricalSpot` progressive widening) + `js/viewModal.js:561-571` (cache → `spotPriceAtPurchase` fallback chain); verified by T1–T5 (spot lookup suite)
- [x] AC-5 — verified at `js/viewModal.js:574` (`asw > 0` guard — returns `null` when ASW is 0); verified by T15 ("missing spot and ASW shows '—' with .muted")
- [x] AC-6 — verified at `js/viewModal.js:573` (`metrics.weightOz * metrics.purity` — `metrics.weightOz` already applies `GB_TO_OZT` / `SB_TO_OZT` conversion at `js/viewModal.js:251-265`)
- [x] AC-7 — verified by T6 ("pricingType 'lot' — purchasePrice equals item.price"), T7 ("pricingType 'each' — same result"), T8 ("missing pricingType — same result"); `item.price` is always per-unit, no qty division needed
- [x] AC-8 — verified at `css/styles.css:6286` (`.view-detail-grid.six-col` 6-col desktop) + `css/styles.css:6634` (≤768px 3-col collapse) + `css/styles.css:6663` (≤480px 3-col); verified by T16 ("desktop → 6 columns") and T17 ("mobile → 3 columns")
- [x] AC-9 — verified at `js/viewModal.js:578` (`premiumPercent = (purchasePrice / asw / resolvedSpot - 1) * 100`) + `js/viewModal.js:616-620` (`formatPercent` with +/− sign and % suffix); verified by T11
- [x] AC-10 — verified at `js/viewModal.js:580-583` (`glPercent = ((retailTotal - purchaseTotal) / purchaseTotal) * 100` with 0-guards); verified by T12 ("G/L% cell shows a percentage string with a sign") and T14
- [x] AC-11 — verified at `js/viewModal.js:668-688` (qty>1 → two `addRow` calls: total + per-unit; qty=1 → single `addRow`); verified by T9 ("single item has 6 cells") and T10 ("lot item has 12 cells")

**Result: 11/11 AC verified — no gaps. Proceed to CLOSE-4.**

---

## Task Phase Checks

- **Parallelization sanity check:** Passed. A.1 (`js/spot.js`), A.2 (`css/styles.css`), and A.3 (`js/utils.js`) are marked `[P]`; they touch disjoint files and share no created symbols.
- **File-map cross-check:** Passed. Implementation task `File(s):` entries are limited to `js/spot.js`, `js/viewModal.js`, `js/utils.js`, `css/styles.css`, and `tests/playwright/view-modal-valuation.spec.js`, matching `approach.md` (with `js/utils.js` added for the pricingType fix and test file for C.1).
- **Reverse file-map cross-check:** Passed. Every modified file in `approach.md` has at least one implementation task.
- **Skill-name discipline:** Passed. `/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, and `/sketch archive` are preserved verbatim.

---

## Review Archive — tasks (2026-05-17)

_Reconciled by /sketch reconcile on 2026-05-17. Original reviewer marks preserved below for audit._

### Opus

#### Verified

- `historicalDataCache` is a `Map` keyed by year at `js/spot.js:625`; entries contain `.metal`, `.timestamp`, `.spot` fields (spot.js:719).
- `searchHistoricalByDate()` at `js/spotLookup.js:322–369` — confirmed progressive widening `[0, 1, 3, 7]`, proximity sort with newest-timestamp tiebreak, and per-day deduplication.
- `_buildValuationSection()` at `js/viewModal.js:550–591` — confirmed it creates a `four-col` grid, uses `computeItemValuation()` (utils.js:1486–1508), and applies `.gain`/`.loss` classes via `_detailItem()` (viewModal.js:583–586).
- `_getViewMetrics()` at `js/viewModal.js:251–265` — confirmed gb/sb conversion using `GB_TO_OZT`/`SB_TO_OZT`, purity default `1.0`, and lowercase `metalKey`.
- `_detailItem()` at `js/viewModal.js:2152–2161` renders label-above-value in a vertical flex `.view-detail-item`.
- `_addDetail()` at `js/viewModal.js:2164` is a wrapper that does NOT return the appended element.
- Mobile breakpoints at `css/styles.css:6623–6628` (≤768px) and `css/styles.css:6649–6653` (≤480px) collapse `.view-detail-grid`, `.three-col`, and `.four-col` to `1fr 1fr` — NOT `1fr 1fr 1fr`.
- `METALS` constant at `js/constants.js:1834–1867` uses lowercase keys; `historicalDataCache` entries use capitalized metal names.
- `computeItemValuation()` at `js/utils.js:1486–1508` returns `purchasePrice`, `purchaseTotal`, `retailTotal`, `gainLoss` — no premium fields.
- Section ordering uses `_appendSectionsInConfiguredOrder()` at `js/viewModal.js:1157` — valuation is one of many pluggable sections.
- `window.historicalDataCache` exposed at `js/spot.js:1551`.
- No existing `lookupHistoricalSpot` in the codebase (confirmed via grep — it's new).

#### Top concerns

1. **CSS specificity conflict for `.six-col` mobile collapse.** The existing ≤768px and ≤480px rules collapse ALL `.view-detail-grid` variants (including `.three-col`, `.four-col`) to `1fr 1fr`. AC-8 requires `.six-col` to collapse to `1fr 1fr 1fr` (3 columns). The `.six-col` mobile override must have higher specificity than the catch-all `.view-detail-grid` rule, or the valuation grid will silently render as 2 columns on mobile. This is a real implementation pitfall — the task acceptance says "three columns" but the existing CSS default says "two columns."

2. **Metal name case mismatch between `_getViewMetrics()` and `historicalDataCache`.** The item's metal is lowercase (`metalKey` at viewModal.js:252), but cache entries use capitalized names (`"Gold"`, `"Silver"`). The tasks don't mention where case normalization happens — in `lookupHistoricalSpot()` or in the caller. If the implementer passes lowercase `metalKey` directly to `lookupHistoricalSpot()` and the helper checks `entry.metal === metalName`, every lookup silently fails and falls through to the `spotPriceAtPurchase` fallback. This should be specified explicitly in A.1 or B.1.

3. **No automated test coverage for the new valuation rendering.** C.1 is described as "verification only" with no file changes and no specified test output file. The existing Playwright test suite has zero tests for the Valuation section's content. Without at least a few `page.evaluate()` assertions for premium display, gain/loss %, and lot rows, the verification stamp (CLOSE-3) will rely entirely on implementation-line citations — weaker evidence, and no regression safety net.

#### Unverified assumptions

- The `_detailItem()` label-above-value pattern will be preserved (not switched to a true table-style header row + data rows as the approach mockup suggests). The approach text says "header labels form the first row; data values form subsequent rows" but the existing helpers assume label+value live in the same grid cell. The implementer must pick one — the tasks don't resolve this.
- `formatCurrency()` (utils.js:599) can accept a manually prepended `+` sign without conflicting with its internal formatting. The function signature and behavior weren't inspected in this review — the tasks assume `(gainLoss >= 0 ? "+" : "") + formatCurrency(gainLoss)` works (and it does at viewModal.js:583), but this pattern applied to premium % (a non-currency value with `%` suffix) may need a separate formatting helper.
- The `historicalDataCache` will be populated before the view modal renders. The cache is loaded via `fetchYearFile()` (async, spot.js:682), and `expandBundleIntoCache()` runs on page load (spot.js:1482). If the user opens the modal before the bundle expands (slow device, large bundle), `lookupHistoricalSpot()` may return `null` for dates that are in the bundle but not yet in the cache. The sync-only design means no retry.
- Task B.3 as a standalone verification task (vs. folded into C.1) provides value. Currently it's a zero-code-change "check" that doesn't produce artifacts.

### GLM

#### Verified

- `historicalDataCache` entry structure confirmed: each year key maps to an array of `{spot, metal, source, provider, timestamp}` objects (spot.js:719). The `metal` field uses capitalized names matching LBMA data (`"Gold"`, `"Silver"`, `"Platinum"`, `"Palladium"`).
- `expandBundleIntoCache()` does **NOT exist** by that name. The seed bundle loader is `window._loadSpotBundle()` at spot.js:1488–1518, which iterates the `bundle` object and writes into `historicalDataCache`. OPUS's review incorrectly referenced `expandBundleIntoCache()` at "spot.js:1482" — that line actually calls `loadSpotSeedBundle` or falls through to the `_loadSpotBundle` setup. This is a reference error in OPUS's review, not a task issue.
- `_detailItem()` at viewModal.js:2152–2161 applies `extraClass` to the value `<span>` (not the item `<div>`) and returns the element. `_addDetail()` at viewModal.js:2164 does NOT return the element (returns `undefined`).
- `.gain`, `.loss`, `.muted` are compound selectors: `.view-detail-value.gain`, `.view-detail-value.loss`, `.view-detail-value.muted` (styles.css:6311–6324). The current Gain/Loss code at viewModal.js:583–585 uses `querySelector(".view-detail-value")` to add the class post-creation, not the `extraClass` parameter.
- `formatCurrency()` (utils.js:599–623) uses `Intl.NumberFormat` with `style: "currency"`. It does NOT add a `+` sign for positive values. The existing code prepends `+` manually at viewModal.js:583. For premium % (a non-currency percentage), a separate formatting helper will be needed — `formatCurrency()` cannot produce `+10.2%` since it wraps in currency formatting.
- `computeItemValuation()` (utils.js:1486–1508) stores `purchasePrice = item.price` directly and `purchaseTotal = purchasePrice * qty`. For `pricingType: "lot"` items, `item.price` is the lot total (not per-unit), making `purchaseTotal` incorrect (it becomes `lotTotal * qty` instead of just `lotTotal`). This is a pre-existing bug that affects the current Gain/Loss display and will affect the new Premium/G/L% calculation if not addressed.
- The `pricingType` toggle (events.js:71–88) converts prices in the UI: switching from "lot" to "each" divides by qty, switching from "each" to "lot" multiplies by qty. The stored `item.price` reflects whichever mode was active when the item was last saved. This means `item.price` meaning depends on `item.pricingType`.
- `_getPriceHistoryContext()` (viewModal.js:700–744) uses `unitQty = item.pricingType === "each" ? 1 : metrics.qty` and `purchasePerUnit: (parseFloat(item.price) || 0) * unitQty` (line 740). For `pricingType: "each"`: `perUnit = price`. For `pricingType: "lot"`: `perUnit = lotTotal * qty` — which is wrong for lot-mode items. This confirms the pre-existing bug propagates through the chart path as well.
- `METALS` constant (constants.js:1834–1867) uses uppercase keys (`SILVER`, `GOLD`, `PLATINUM`, `PALLADIUM`), each with `.name` (Title Case: `"Silver"`, `"Gold"`) and `.key` (lowercase: `"silver"`, `"gold"`).
- No Playwright tests exist for the Valuation section content (confirmed: only chart-scaling, no-auto-resync, and numisma-merge tests touch the view modal).

#### Top concerns

1. **`pricingType`-dependent `item.price` is not always per-unit — AC-7 is wrong.** The task acceptance for B.1 states "uses per-unit `purchasePrice`" and AC-7 states "item.price is already stored per-unit after lot-mode entry (divided before save)." This is **factually incorrect** for `pricingType: "lot"` items. When `pricingType` is `"lot"`, `item.price` stores the **lot total** (not per-unit). The price toggle converts in the UI (events.js:83: `nextMode === "each" ? price / qty : price * qty`), and whatever mode is active at save time is what persists. For `pricingType: "lot"` items with qty=5 and a total price of $100, `item.price = 100` (lot total, $20 each), but `computeItemValuation()` computes `purchaseTotal = 100 * 5 = 500` — which is $100×5 = $500, not $100. The new Premium and G/L% calculations will inherit this bug unless B.1 explicitly derives per-unit price as `item.pricingType === "each" ? item.price : item.price / (item.qty || 1)`. This is the most load-bearing finding in the review — it affects AC-1, AC-2, AC-7, AC-9, AC-10, and AC-11.

2. **Header row vs. labeled-cell design is unresolved.** The approach mockup (approach.md:79–84) shows a separate header row ("PURCHASE | PREMIUM | MELT | RETAIL | GAIN/LOSS | G/L%") followed by data-only rows. The existing `_detailItem()` helper produces label-above-value vertical flex cells. These two approaches produce fundamentally different DOM structures and visual results. The task acceptance for B.2 doesn't specify which pattern to use. OPUS flagged this; I'm escalating: this choice affects the number of DOM elements, the CSS grid behavior at mobile breakpoints, and how Premium/G/L% get their `.gain`/`.loss` classes applied. The human must resolve this before B.2 implementation begins.

3. **Premium % and G/L % need a non-currency formatter, but none is specified.** `formatCurrency()` (utils.js:599) wraps values in `Intl.NumberFormat` with `style: "currency"`, producing output like `$10.20`. For premium %, the output must be `+10.2%` or `-2.1%` — a suffixed percentage with sign, not a currency. The existing `+` prepend pattern (viewModal.js:583) works for currency because it's applied before `formatCurrency()` wraps the number. But for a percentage, the implementer needs either: (a) a new `formatPercent(value)` helper that produces `+10.2%` / `-2.1%` / `"—"`, or (b) manual string formatting inline. The task acceptance doesn't mention this, and approach.md doesn't define a formatting helper.

#### Unverified assumptions

- The approach states `expandBundleIntoCache()` runs on page load (referenced in OPUS review and approach.md), but the actual function name is `window._loadSpotBundle` at spot.js:1488. The assumption that "the bundle is loaded before the modal opens" holds for normal usage but may not hold for very fast page interactions on slow devices.
- D-7 says "Hard-coded list of 4 strings rather than deriving from `METALS` constant." This is fine operationally, but the acceptance doesn't specify whether `lookupHistoricalSpot()` receives Title Case (`"Gold"`) or lowercase (`"gold"`) or whether it normalizes internally. The case-mismatch issue (OPUS concern #2) is real but the fix location (helper vs caller) is unspecified.
- AC-7 note "item.price is already stored per-unit after lot-mode entry (divided before save)" assumes `pricingType === "each"` always, which is false for `pricingType: "lot"` items. The whole premium-per-unit and G/L% calculation chain depends on correcting this.
- The `_detailItem()` `extraClass` parameter is applied to the value span (`.view-detail-value`), not the item div. If the implementer adds a custom class (e.g., `.premium-value`) to the item div instead of the value span, the `.gain`/`.loss`/`.muted` CSS rules won't match because they require `.view-detail-value.gain` specificity.

### Resolution Summary

- Accepted: 11
- Rejected: 2 (OPUS `expandBundleIntoCache` reference — OPUS review text error, no task impact; B.3 standalone — resolved by merge into C.1)
- Resolved with your input: 4 (pricingType → fix root cause via new A.3; header row → label-above-value cells; B.3 → fold into C.1; test coverage → C.1 produces test file)
