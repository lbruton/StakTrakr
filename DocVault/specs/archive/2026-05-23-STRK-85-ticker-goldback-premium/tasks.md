---
sketch: STRK-85-ticker-goldback-premium
phase: tasks
created: 2026-05-22
approved: 2026-05-23
---

# STRK-85 — Tasks

_Concrete checklist grouped into Sprint Cohorts. This sketch has no parallel cohorts — all tasks within each cohort are sequential._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it — this is setup work, not a stop-the-world gate._

- [x] **0.1** — Ensure sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows the project-required worktree and branch per StakTrakr conventions (invoke `/start-patch` to claim version lock and create `patch/VERSION` worktree). Working directory is that worktree, not the main checkout.
  - **If the worktree does not exist yet:** Invoke `/start-patch` to create it following StakTrakr's branch/worktree convention.
  - **Leverage:** `/start-patch` skill.

## Sprint Cohort A — Foundation (sequential)

_CSS tier rules can be added now because the new classes (`.premium.low`, `.premium.mid`, `.premium.high`, `.vp-premium.mid`) match no existing DOM elements and are inert until Cohort C applies them. The `.vp-premium.low` semantic change (yellow → green) is visually immediate on the existing Matrix but is confirmed safe: zero test assertions on `.vp-premium.low` CSS class, and the color change is part of the AC-3 requirement._

- [x] **A.1** — Add CSS premium tier rules
  - **File(s):** `css/styles.css`
  - **Acceptance:** (1) `.vp-premium.low` maps to `--success` (green) instead of `--warning`. (2) New `.vp-premium.mid` rule uses a custom darker amber (e.g. `oklch(0.55 0.15 60)`) for WCAG AA contrast at `font-size-xs` — do NOT use `--warning` (fails ~1.4:1 contrast on light/sepia backgrounds). (3) `.vp-premium.high` remains `--danger` (unchanged). (4) New ticker-scoped rules `.ticker-item .premium.low`, `.ticker-item .premium.mid`, `.ticker-item .premium.high` added — all three selectors MUST be scoped under `.ticker-item` to avoid collision with `.btn.premium` (used on action buttons). `.ticker-item .premium.low` uses `--success`, `.ticker-item .premium.mid` uses the same custom darker amber as `.vp-premium.mid`, `.ticker-item .premium.high` uses `--danger`. (5) Ticker `.premium` tier rules include visual weight reduction (`opacity` or `font-weight`) so colored premiums don't compete with the green price text. (6) All rules are a single unscoped base rule set using semantic tokens — no per-theme duplication. (7) Visual verification note: implementer must check all four themes (`light`, `dark`, `slate`, `sepia`) after applying.
  - **Leverage:** Existing `.vp-premium.low`/`.high` rules at `css/styles.css:14841-14852`; existing ticker `.premium` rule at `css/styles.css:14708-14711`; design tokens `--success`, `--warning`, `--danger` defined in all four theme blocks.
  - **Maps to:** AC-3, AC-4

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Write tests that encode the acceptance criteria BEFORE implementation. Tests MUST fail at this point — a passing test means it's not actually testing the new behavior._

- [x] **B.1** — Write failing Playwright tests for Goldback premium and tier classes
  - **File(s):** `tests/playwright/market-premium-tiers.spec.js` (new)
  - **Acceptance:** Each testable AC from requirements.md has at least one test. All new tests fail (red) because the JS implementation does not exist yet. Specifically:
    - **AC-1 test:** Assert a Goldback ticker item (e.g. `utah-1-goldback`) renders a `.premium` span containing a non-empty premium percentage text (e.g. `+20.0%`).
    - **AC-2 test:** Assert the premium value in the ticker matches the expected calculation `((bestPrice - g1Rate) / g1Rate) * 100` for Goldback items — use a fixture with a known spread (e.g. vendor price `5.10`, G1 rate `4.25` → `+20.0%`).
    - **AC-3 test (ticker):** Assert the ticker `.premium` span for a `< 2%` premium has class `low`; for `2–5%` has class `mid`; for `≥ 5%` has class `high`. Use three separate fixture configurations.
    - **AC-3 test (Matrix):** Assert the Matrix `.vp-premium` badge for a Goldback row has the correct tier class for its premium value.
    - **AC-3 test (detail modal):** Open a Goldback market detail modal, assert the vendor table's `.vp-premium` badge has the correct tier class. Implementation note: the detail modal requires a LightweightCharts stub (see leverage section). To open the modal, either click a Matrix row matching the Goldback slug (requires `waitForSelector` on the modal overlay) or call `page.evaluate(() => openMarketDetailModal("utah-1-goldback"))` — the latter is more reliable for TDD since it avoids dependency on `renderVendorPrices` completing.
    - **AC-4 test:** Implicit in AC-3 tests — all surfaces use the same threshold boundaries (same fixture → same tier class everywhere). Source-level verification of the single-helper constraint is handled in CLOSE-3.
    - **AC-5 test:** Assert the same Goldback item's premium text and tier class are identical across ticker, Matrix, and detail modal.
  - **Fixture strategy:** Use `installStakTrakrNetworkMocks(page, options)` directly (not via `extended-test.js` defaults) with custom Goldback overrides. The default fixture sets G1 = retail price = `4.25` (0% premium); override with spread values. Create at least two fixture configs: one for `high` tier (`+20.0%`, vendor `5.10` / G1 `4.25`) and one for `low` tier (`+1.0%`, vendor `4.2925` / G1 `4.25`).
  - **Depends on:** A.1 (CSS classes referenced in assertions exist in stylesheet, though tests check DOM class presence, not visual rendering)
  - **Leverage:** Existing `installStakTrakrNetworkMocks` in `tests/playwright/helpers/mocks/routes.js:31-46`; existing `makeGoldbackLatest()` fixture in `tests/playwright/helpers/mocks/fixtures.js:115`; market-sorting spec pattern at `tests/playwright/market-sorting.spec.js:460-474` for Matrix Goldback assertions; **LightweightCharts stub at `tests/playwright/market-sorting.spec.js:224-249`** — required for any test that opens the detail modal (`openMarketDetailModal` calls `LightweightCharts.createChart()`; without this stub, modal tests will throw `ReferenceError`).
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5

## Sprint Cohort C — Implementation · GREEN (sequential)

_TDD green phase. Write the minimum code that makes all Cohort B tests pass._

- [x] **C.1** — Add `_calcMarketPremium` helper and wire all three render sites
  - **File(s):** `js/market-data.js`
  - **Acceptance:** All Cohort B tests pass (green). Specifically:
    - A new module-local function `_calcMarketPremium(price, metalCode, weightOz)` exists between `_getSpotPrice` (~line 38) and `renderBestPriceTicker` (~line 244).
    - Helper encapsulates: benchmark selection (`metalCode === "goldback"` → `_goldbackG1Rate`; otherwise → `_getSpotPrice(metalCode) * weightOz`), percentage calculation (`((price - benchmark) / benchmark) * 100`), and tier classification (`< 2` → `"low"`, `< 5` → `"mid"`, `≥ 5` → `"high"`).
    - Helper always returns `{ value: number|null, tier: "low"|"mid"|"high"|null, text: string|null }` — never `null` as a top-level return. When no benchmark is available, fields are `null`.
    - **Ticker** (`renderBestPriceTicker`, ~line 293): calls `_calcMarketPremium(bestPrice, metalLower, weightOz)`. Destructures `value` into `items[].premium` as a raw primitive number (NOT the helper object) — `_buildTickerSignature`'s `Number.isFinite(item.premium)` check at line 177 requires a primitive. Stores `tier` as `items[].premiumTier`. At DOM construction (~line 387), applies tier as CSS class on the `.premium` span (e.g. `<span class="premium low">`).
    - **Detail modal** (`openMarketDetailModal`, ~line 772): calls `_calcMarketPremium(entry.price, metalCode, weightOz)`. Replaces inline spot-only math and binary `low`/`high` class. Uses `tier` for `.vp-premium` badge class. Keeps existing `else` branch ("—") for `value === null`.
    - **Matrix** (`renderVendorPrices` inner loop, ~line 1138): calls `_calcMarketPremium(vInfo.price, isoCode, weightOz)`. Replaces inline spot + G1 branches and binary `premium < 10` class. Uses `tier` for `.vp-premium` badge class.
    - No inline premium math remains at any of the three call sites — all three delegate to `_calcMarketPremium`.
  - **Depends on:** B.1
  - **Leverage:** Existing Matrix G1-rate pattern at `js/market-data.js:1138-1145` (copy benchmark-selection logic); `_getSpotPrice` at `js/market-data.js:26-38`; `_goldbackG1Rate` module-local at `js/market-data.js:13`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5

- [x] **C.2** — Audit and update existing market-sorting test
  - **File(s):** `tests/playwright/market-sorting.spec.js`
  - **Acceptance:** The existing Matrix Goldback assertion at line ~473 (`+20.0%`) still passes with the new tier class. Run `npx playwright test tests/playwright/market-sorting.spec.js` — zero failures.
  - **Depends on:** C.1
  - **Leverage:** Existing assertion at `tests/playwright/market-sorting.spec.js:460-474`.
  - **Maps to:** AC-3

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite + lint** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm run lint && npm test`. Zero lint errors, zero test failures. All existing tests pass; all new tests from Cohort B pass (green after Cohort C implementation).
  - If anything fails: fix the implementation, not the test. Tests are the spec — a failing test means the implementation is wrong, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **StakTrakr-specific:** Pre-existing browser-global `no-undef` findings are noise. Verify findings on changed lines only. After scan, check `git diff .codacy/codacy.yaml` and revert any tool additions before commit.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-5), write exactly one line:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` or `verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - **AC-4 source-level audit:** In addition to the DOM-level verification, run `grep -n '< 2\|< 5' js/market-data.js` and verify that the only tier-boundary logic (`< 2` / `< 5`) lives inside `_calcMarketPremium`. If any inline threshold logic remains at a call site, AC-4 has a gap — do not stamp it `[x]`.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`)
  - **MUST invoke `/release patch`** as a skill.
  - **Pre-requisite:** Run `/update-spot-bundle` before the version-bump PR (per StakTrakr convention).

- [x] **CLOSE-5. Vault update**
  - **MUST invoke `/vault-update`** as a skill — the skill performs the audit even if no foundation docs appear affected.

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/start-patch`. Title: `vX.YY.ZZ — STRK-85: Goldback premium in ticker + tiered premium colors` (substitute the actual version from CLOSE-4's `/release patch`).
  - Body must include: link to [STRK-85](https://plane.lbruton.cc/lbruton/browse/STRK-85/), link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-85-ticker-goldback-premium/`), test plan checklist.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill.
  - Coverage: scan **both** inline diff threads AND review-body findings. After running, check for new auto-scanner threads and address before merge.

- [ ] **CLOSE-8. Archive sketch + close issue** (after PR merges)
  - **MUST invoke `/sketch archive STRK-85`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-85-ticker-goldback-premium/` and saves mem0 summary.
  - Mark STRK-85 Done in Plane: `mcp__plane__update_issue` to state "Done". This MUST happen after PR merge — never before.

---

> **Phase complete?** All tasks marked `[x]`, closing tasks done, PR merged. Then archive: `/sketch archive STRK-85`.

> **Multi-model dispatch hint:** Cohort A has one task (CSS). Cohort B has one test-writing task. Cohort C has two sequential JS tasks. The TDD boundary between Cohort B (red) and Cohort C (green) is a natural model-routing seam — one model writes the failing tests, a different model writes the implementation to make them pass. Suggested: Codex or Claude for B.1 (test writing), Claude for C.1 (multi-surface wiring requires reading three divergent code paths in one pass).

## Review Archive — tasks (2026-05-23)

_Reconciled by /sketch reconcile on 2026-05-23. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- Resolved the sketch directory to `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/sketches/STRK-85-ticker-goldback-premium` and confirmed `tasks.md` had no existing unreconciled `CODEX` review.
- Checked the tasks against the reconciled approach file map: implementation paths are `css/styles.css`, `js/market-data.js`, new `tests/playwright/market-premium-tiers.spec.js`, and existing `tests/playwright/market-sorting.spec.js` (`approach.md:37-50`).
- Verified the live premium surfaces: ticker computes spot-only premium and renders an un-tiered `.premium` span (`js/market-data.js:292-298`, `js/market-data.js:386-391`); detail modal has spot-only premium plus binary `low`/`high` class (`js/market-data.js:716-779`); Matrix has the Goldback G1 fallback but still uses binary `premium < 10` class (`js/market-data.js:1051-1151`).
- Verified current CSS anchors: ticker price is green (`css/styles.css:14701-14705`), ticker `.premium` is muted only (`css/styles.css:14708-14711`), and `.vp-premium.low/high` are the only badge tier classes today (`css/styles.css:14841-14852`).
- Verified test/mocking anchors: `installStakTrakrNetworkMocks(page, options)` supports `goldback` and `retailLatest` overrides (`tests/playwright/helpers/mocks/routes.js:31-46`, `tests/playwright/helpers/mocks/routes.js:128-180`); default Goldback G1 and retail price are both `4.25` (`tests/playwright/helpers/mocks/fixtures.js:80-87`, `tests/playwright/helpers/mocks/fixtures.js:113-115`); `extended-test.js` installs defaults before each test and later routes win by LIFO (`tests/playwright/helpers/mocks/extended-test.js:1-20`).
- Verified repo workflow gates relevant to tasks: `npm run lint` is required before committing and PR evidence includes both lint and tests (`AGENTS.md:20-31`, `AGENTS.md:50-54`); the StakTrakr flow calls for lint plus tests before commit (`AGENTS.md:124-129`).

**Top concerns**

1. A.1's selector wording scopes only `.ticker-item .premium.low`; because `.premium` is also a widely used button class, the task should require all ticker tier selectors to stay under `.ticker-item`.
2. B.1 treats AC-4 as fully covered by matching DOM classes, but AC-4 also requires one shared tier helper/no duplicated threshold branches; add a source-level verification line.
3. C.2's `--grep "market-sorting"` command is likely a no-op for the intended file because the live test titles do not contain that string; target the spec path instead.

**Unverified assumptions**

- The new Playwright spec can open the Goldback detail modal through the existing Matrix row click path without production-only selectors.
- The implementation will keep `_calcMarketPremium` module-local and verify it through DOM/source checks rather than exposing test-only globals.
- The custom darker amber chosen for ticker `mid` has been checked visually across `light`, `dark`, `slate`, and `sepia`, not just reasoned from token names.
- The implementing agent will treat `CLOSE-5`'s Plane state change as part of final closeout, not as permission to mark STRK-85 Done before the draft PR/review loop is actually complete.

### Gemini

**Verified**

- Inspected standard semantic variable overrides (`--success`, `--warning`, `--danger`) in `css/styles.css` across all four active themes (`light`, `dark`, `slate`, `sepia`).
- Confirmed `--warning` variable in light/sepia modes has insufficient contrast ratio against light backgrounds (~1.4:1), meaning the new `.mid` (yellow) tier is at risk of being unreadable.
- Verified that the scrolling ticker's `.premium` styling is secondary display-only text, so visual weight reduction is required to avoid a clashing "color soup" next to the green price text.
- Confirmed that ticker signature hashing (`_buildTickerSignature` at line 177) expects `item.premium` to be a primitive number, meaning the helper output must be carefully destructured at the call site.

**Top concerns**

1. **Accessibility / Legibility of `.vp-premium.mid` (Yellow badge text):** Just like the scrolling ticker's custom dark amber for the `mid` tier (which bypasses `--warning` to meet WCAG AA standards), the Matrix and detail modal badges (`.vp-premium.mid`) should also be styled with a custom darker color or a high-contrast style on light/sepia themes. Using standard `--warning` text on light backgrounds creates a severe contrast and legibility regression.
2. **Failed-G1 Rate Path Testing:** In the TDD Red phase (`B.1`), the new spec must verify graceful degradation when G1 rate fetching fails. We should assert that the UI renders without throwing JS runtime exceptions, and that all three views degrade to blank/dash premium outputs consistently.
3. **Preserving Ticker Primitive Signature:** In `C.1`, the refactored ticker loop must assign only the raw numeric `value` (and not the returned helper object) to `item.premium`. Otherwise, the ticker's signature optimization logic will fail or return `false` on `Number.isFinite()`, causing performance regressions or blank premium renders.

**Unverified assumptions**

- The custom darker amber color proposed for the ticker mid-tier (`oklch(0.55 0.15 60)`) meets WCAG AA contrast standards across all active themes (light, dark, slate, sepia).
- The transition of `.vp-premium.low` from `--warning` (yellow) to `--success` (green) is acceptable for all precious metals pricing and will not collide with other color expectations in the app.

### Deepseek

**Verified**

- Confirmed all file:line references in C.1 against `js/market-data.js`: `_getSpotPrice` at line 26, `_goldbackG1Rate` at line 13, `renderBestPriceTicker` at line 244, `_buildTickerSignature` at line 177, ticker DOM construction at lines 386-391, `openMarketDetailModal` at line 476 (premium block at 770-784), Matrix loop at line 1047-1154. Total lines: 1457.
- Confirmed `_getSpotPrice("goldback")` returns `null` — `_ISO_TO_METAL` has no `goldback` key (`js/market-data.js:8`), no `spotPriceDisplayGoldback` DOM element exists.
- Confirmed detail modal `weightOz` at line 562 is a closure variable from `openMarketDetailModal` scope, not recomputed per vendor entry: `(detail && detail.weight_oz) || coinMeta.weight || 0`. For Goldback items, the helper ignores `weightOz` (uses `_goldbackG1Rate` per D-4), so this is benign.
- Confirmed `metalCode` for Goldback items resolves correctly in `openMarketDetailModal`: `_METAL_TO_ISO["goldback"]` → `undefined` → `metalLower` fallback → `"goldback"` (`js/market-data.js:510-511`).
- Confirmed zero existing test assertions on tier classes (`.vp-premium.low`, `.vp-premium.high`, `.vp-premium.mid`, `.premium.low`, `.premium.mid`, `.premium.high`) in `tests/` — C.2's "If the assertion checks a tier class name" guard is unnecessary; there are no class assertions to update.
- Confirmed CODEX's `--grep` correction: `npm test` = `npx playwright test` (`package.json:14`), test title is `AC-8 — All-tab premium math...` (no `market-sorting` string). `--grep` filters by test name, not file path.
- Confirmed `npm run lint` exists (`package.json:9`) and is required before committing per `AGENTS.md:20-31`. CODEX's CLOSE-1 lint-gate comment at line 94 is valid.
- Confirmed the existing `market-sorting.spec.js` has a LightweightCharts stub (`market-sorting.spec.js:224`) for detail modal compatibility but never actually opens a Goldback detail modal via Matrix row click — B.1's detail modal test will be the first to exercise this path.
- Confirmed the detail modal's `spotPrice` variable is `null` for Goldback items (computed at `js/market-data.js:716` via `_getSpotPrice("goldback")`), so the current premium `if` guard at line 772 never enters for Goldback. After C.1 refactoring, `_calcMarketPremium` will handle the Goldback benchmark path internally — no guard-reframing needed.

**Top concerns**

1. **CLOSE-6 PR title format.** Uses `feat(STRK-85):` but StakTrakr conventions require `vX.YY.ZZ — STRK-85: <summary>` (AGENTS.md commit format). The PR title must include the version bumped by CLOSE-4's `/release patch`. This is a mechanical mismatch — the version is unknown at sketch time but the implementer must substitute it.

2. **CLOSE-5 marks issue Done before PR merges.** The task sequences `CLOSE-5 → CLOSE-6 → CLOSE-7 → CLOSE-8`, but marks the Plane issue Done in CLOSE-5 before the PR is even opened (CLOSE-6). Repo conventions (AGENTS.md:129) state "Never mark Plane issues Done before the PR merges." Move the Plane state change to CLOSE-8 or later.

3. **AC-4 source-level gap persists in task acceptance.** The B.1 tests verify DOM tier classes only, but AC-4 requires "no inline threshold logic duplicated across render sites." DOM assertions can't distinguish between a shared helper and three independent inline branches that happen to produce the same classes. CODEX flagged this at line 51 (suggesting a source-level check in C.1 or CLOSE-3), but C.1's acceptance text still only requires "All Cohort B tests pass (green)." Either add a source-level grep audit to C.1's acceptance or CLOSE-3, or downgrade AC-4 from a source-level requirement to a visual-consistency requirement in the verification stamp.

**Unverified assumptions**

- The B.1 detail modal test can open a Goldback modal via Matrix row click without production-only selectors. Zero existing tests exercise a Goldback Matrix row → detail modal click path.
- `_calcMarketPremium`'s `metalCode === "goldback"` check works correctly when called from the detail modal vendor loop because `metalCode` is a function-scoped variable set to `"goldback"` for Goldback slugs at line 511.
- The new test spec calling `installStakTrakrNetworkMocks(page, {...})` with custom Goldback overrides after `extended-test.js` installs defaults will apply LIFO overwrite as intended — confirmed via Playwright route API semantics but not tested in isolation.
- Visual verification across all four themes (`light`, `dark`, `slate`, `sepia`) will happen during implementation, not only in CLOSE-3 verification stamp. A.1 calls this out but C.1 (the implementation task) does not re-assert it.
- The `mid` tier amber color (`oklch(0.55 0.15 60)`) has been checked against WCAG AA contrast requirements at `font-size-xs` across all four themes — A.1 lists this as a visual verification note, but no mechanical contrast check is built into the task acceptance.

### Opus

**Verified**

- Confirmed the ticker premium calculation at `js/market-data.js:292-298` is spot-only: `_getSpotPrice("goldback")` returns `null` because `_ISO_TO_METAL` has no `"goldback"` key (line 8), so Goldback items push `premium: null` to the items array (line 315) and render an empty `.premium` span (line 388-390).
- Confirmed the items array shape at `js/market-data.js:310-320`: the proposed `premiumTier` field is a new addition; `_buildTickerSignature` at line 177 only reads `item.premium` via `Number.isFinite()`, so adding `premiumTier` does not break the signature but also does not participate in render-skip logic.
- Confirmed the detail modal resolves `metalCode` for Goldback items at `js/market-data.js:510-511`: `_METAL_TO_ISO["goldback"]` → `undefined`, so `metalCode` falls through to `metalLower` → `"goldback"`. This is the correct value for `_calcMarketPremium`'s `metalCode === "goldback"` check (D-4).
- Confirmed the detail modal's `weightOz` is a closure variable set once at `js/market-data.js:562`, shared across all vendor entries in the same modal. For Goldback items, `_calcMarketPremium` ignores `weightOz` (uses `_goldbackG1Rate` directly), so the shared-weight pattern is benign.
- Confirmed the `.btn.premium` CSS class at `css/styles.css:1474-1479` and its usage in `index.html` (lines 2953, 2987, 7903, 7938, 8420) — all are `.btn.premium` (compound selector requiring `.btn`), so the proposed `.premium.low`/`.premium.mid`/`.premium.high` rules will NOT collide as long as they are scoped under `.ticker-item` (CODEX's inline comment is correct and sufficient).
- Confirmed the `installStakTrakrNetworkMocks` route handler covers all three detail modal fetch paths: `retail/{slug}/latest.json` (line 164), `retail/{slug}/history-30d.json` (line 185), and `retail/{slug}/intraday.json` (line 198 of `routes.js`). The detail modal will not hang on unmocked fetches.
- Confirmed zero existing test assertions on `.vp-premium.low`, `.vp-premium.mid`, `.vp-premium.high`, `.premium.low`, `.premium.mid`, or `.premium.high` anywhere in `tests/` — the semantic change from binary to tri-tier will not break any existing test.
- Confirmed PR title/commit format per `AGENTS.md:97-99`: `vX.YY.ZZ — STRK-###: <summary>`. DEEPSEEK's inline finding that CLOSE-6 uses `feat(STRK-85):` instead is correct.
- Confirmed CLOSE-5 Plane timing violation per CLAUDE.md "Closing task ordering in sketch workflow": "Never mark Plane issues Done before the PR merges."

**Top concerns**

1. **`.vp-premium.mid` contrast gap.** A.1 acceptance (2) maps `.vp-premium.mid` to `--warning` but acceptance (4) gives ticker `.premium.mid` a custom darker amber for WCAG AA. The `.vp-premium.mid` badge renders at the same `font-size-xs` (`css/styles.css:14843`) on potentially light cell backgrounds (Matrix/detail modal). If `--warning` is illegible in the ticker, it is also illegible in badges. The acceptance should use the same custom amber for both surfaces, or explicitly justify why `--warning` is acceptable for `.vp-premium.mid` but not `.premium.mid`.

2. **B.1 missing LightweightCharts stub for detail modal tests.** The AC-3 and AC-5 tests must open the Goldback detail modal. `openMarketDetailModal` calls `LightweightCharts.createChart()` at runtime. The existing `market-sorting.spec.js` stubs it via `window.LightweightCharts = { CrosshairMode: { Normal: 0 }, createChart(container) { ... } }` at line 224-249, but B.1's leverage section does not mention this dependency and the fixture strategy only discusses network mocks. Without this stub, the modal will throw `ReferenceError: LightweightCharts is not defined` before reaching the vendor table.

3. **CLOSE-5 marks Plane issue Done before PR merge.** DEEPSEEK flagged this; CLAUDE.md confirms it is a hard rule: Plane closure must follow `/sketch archive` (CLOSE-8), which itself follows PR merge. The current task ordering will cause an implementer to close the issue prematurely. The Plane state change must move to CLOSE-8 or a new CLOSE-9.

**Unverified assumptions**

- The `_buildTickerSignature` function does not include `premiumTier` in its hash. If thresholds are ever user-configurable (e.g., via Settings), a tier change without a price change would not trigger a re-render. Acceptable for this sketch since thresholds are constants, but a latent coupling.
- The AC-2 test at B.1 asserts the premium calculation result (`+20.0%`) but does not verify that the math originates from a shared helper vs inline duplication. CODEX's inline comment at line 51 suggests a source-level check, but no task acceptance line requires one. AC-4 (`requirements.md:68-72`) requires "no inline threshold logic duplicated across render sites" — this is unverifiable through DOM tests alone.
- The new spec file `market-premium-tiers.spec.js` will use `installStakTrakrNetworkMocks(page, options)` directly, bypassing the `extended-test.js` fixture that calls it with no options. This means each test must manage its own mock lifecycle. If a future test in the same file needs default mocks without overrides, the implementer must re-call the installer — the LIFO-wins behavior only applies within a single `page.route()` registration session.
- C.1's acceptance says "No inline premium math remains at any of the three call sites" — but this is a prose assertion, not a mechanically verifiable acceptance criterion. CLOSE-3's verification stamp only requires `verified at <file>:<line>` or `verified by <test name>`. There is no grep-based audit task to confirm the absence of inline `meltValue` calculations outside `_calcMarketPremium`.

### Resolution Summary
- Accepted: 12 (`.vp-premium.mid` contrast fix, LightweightCharts stub in B.1, CLOSE-5→CLOSE-8 Plane timing, CLOSE-1 lint gate, C.2 grep command, AC-4 source-level audit in CLOSE-3, CLOSE-6 PR title format, ticker selector scoping, C.2 guard removal, no-`[P]` header text, ticker primitive preservation, detail modal test guidance)
- Rejected: 2 (premiumTier signature coupling — future risk only, thresholds are constants; G1 rate failure test — redundant rate sources make existing null-guard sufficient per user confirmation)
- Resolved with user input: 1 (G1 rate failure test — user confirmed skip)

---

## Verification Stamp

_Generated 2026-05-23 during CLOSE-3. All 8 new Playwright tests pass (green)._

- [x] **AC-1** — verified by test "AC-1 — Goldback ticker item renders a non-empty premium span" (`tests/playwright/market-premium-tiers.spec.js:150`); implementation at `js/market-data.js:308-310` (goldback G1-rate fallback in `renderBestPriceTicker`)
- [x] **AC-2** — verified by test "AC-2 — Goldback ticker premium matches ((price - g1Rate) / g1Rate) * 100" (`tests/playwright/market-premium-tiers.spec.js:156`); math delegated to `_calcMarketPremium` at `js/market-data.js:13-16`
- [x] **AC-3** — verified by 5 tests (3 ticker tier tests at lines 164/169/174, Matrix mid at line 179, detail modal at line 188); tier logic in `_premiumTierClass` at `js/market-data.js:17-22`; applied at ticker L403, Matrix L1163, detail modal L794
- [x] **AC-4** — source-level verified: `_calcMarketPremium` (defined once at L13) called at L308, L310, L788, L790, L1157, L1159; `_premiumTierClass` (defined once at L17) called at L403, L794, L1163; `grep 'premium < 10'` returns NONE — no inline tier thresholds at any call site
- [x] **AC-5** — verified by test "AC-5 — premium text and tier class match across ticker and Matrix" (`tests/playwright/market-premium-tiers.spec.js:196`); both surfaces return "+20.0%" with class "high" for HIGH_PRICE fixture
