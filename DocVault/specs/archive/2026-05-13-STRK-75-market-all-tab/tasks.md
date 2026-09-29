---
sketch: STRK-75-market-all-tab
phase: tasks
created: 2026-05-13
approved: 2026-05-13
---

# STRK-75 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Claim version lock and confirm worktree
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `/start-patch` has been invoked for STRK-75, version lock claimed in `devops/version.lock`, `git worktree list` shows branch `patch/VERSION` at `.worktrees/patch-VERSION/` (per StakTrakr `Foundation/coding-standards.md:437-466`). Working directory is that worktree. If the worktree is missing, `/sketch apply` has been bypassed — STOP and report.
  - **Leverage:** `/start-patch` skill; StakTrakr worktree convention.

## Sprint Cohort A — Core `market-data.js` changes (sequential — single file)

_All tasks touch `js/market-data.js`. Run sequentially to avoid merge conflicts._

- [x] **A.1** — Prepend `all` to the valid tab list and update the default fallback
  - **File(s):** `js/market-data.js` (tab list construction ~line 1266-1274, fallback ~line 1276-1281)
  - **Acceptance:** `vendorPricesActiveTab` fallback constant is `'all'` (not `'xag'`). Valid-tab allowlist includes `'all'` as the first entry. `all` is accepted as a valid stored value. Missing/invalid stored values resolve to `'all'`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4

- [x] **A.2** — Add the All-scope render path to `_renderVendorTable`
  - **File(s):** `js/market-data.js` (render function ~lines 878-1170)
  - **Acceptance:** When `scopeCode === 'all'`, the function iterates all enabled metal groups in priority order (Gold → Silver → Platinum → Palladium if present → Goldback) and renders rows for each group in sequence, sorted by display name using the existing comparator within each group. Per-metal `scopeCode` paths are unchanged. **Per-row spot/premium:** Each row in the All-scope set carries its own ISO metal code; premium math calls `_getSpotPrice(row.isoCode)` per row, not the function-level `metalCode`. Goldback rows continue using `_goldbackG1Rate` fallback at lines 1122-1125.
  - **Leverage:** Reuse `getRetailCoinMeta()` for both tab eligibility and row rendering metadata per D-5. Verify Goldback G1 rate lookup is not metal-scoped before committing.
  - **Depends on:** A.1
  - **Maps to:** AC-5, AC-6, AC-8

- [x] **A.3** — Fix vendor column union for All-scope
  - **File(s):** `js/market-data.js` (vendor column set construction ~lines 981-983)
  - **Acceptance:** When the All tab is active, the vendor column set is the deduplicated union of enabled vendors across all visible row groups, sorted alphabetically by display name. Per-metal column set logic is unchanged.
  - **Depends on:** A.2
  - **Maps to:** AC-7, AC-9

## Sprint Cohort B — Tests (sequential)

- [x] **B.1** — Update `stak-582-market-survivors.spec.js` default-tab assertion
  - **File(s):** `tests/playwright/retail/stak-582-market-survivors.spec.js` (lines 461-476)
  - **Acceptance:** The assertion that previously expected Silver/`xag` as the default active tab now expects `all`. Read the full spec before editing — only change the no-stored-value default assertion; do not alter tests that set `vendorPricesActiveTab` explicitly.
  - **Depends on:** A.1
  - **Maps to:** AC-2

- [x] **B.2** — Add All-tab test cases to `market-sorting.spec.js`
  - **File(s):** `tests/playwright/market-sorting.spec.js`
  - **Acceptance:** Fixture data expanded to include at least gold and Goldback rows (not silver-only). Mock `/goldback/latest.json` route for G1 rate. New test cases cover: (a) All tab present and active by default (no stored value), (b) valid stored tab preserved (`xag` → Silver tab active), (c) invalid stored tab falls back to All, (d) All-tab row group ordering (Gold before Silver before Goldback), (e) clicking a per-metal tab narrows the table correctly, (f) market-filter hiding in All tab (AC-7), (g) per-row spot premium math for at least one non-Goldback metal + Goldback G1 premium (AC-8), (h) vendor-column union across metals (AC-9).
  - **Depends on:** A.2, A.3, B.1
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test`. All existing tests pass; all new tests from Cohort B pass. If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files (`js/market-data.js`, both test files). Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For each AC in requirements.md (AC-1 through AC-10), write one line: `[x] AC-N — verified at <path>:<line>` or `[x] AC-N — verified by <test name>` or `[ ] AC-N — gap: <reason>`. Refuse to proceed to CLOSE-4 if any `[ ]` remains.

> CODEX: `tasks.md` is not listed in `approach.md`'s File Map, so this violates the sketch file-map cross-check as written. Either add this sketch file to the approach File Map or reframe the verification stamp as a control-plane note outside implementation file scope.

- [x] **CLOSE-4. Version bump**
  - **File:** _managed by `/release patch` — see `Foundation/coding-standards.md:421-431` for authoritative file list_
  - **MUST invoke `/release patch`** — paraphrasing version-bump steps inline is not equivalent. The skill owns the file list and enforces project-specific rules.

- [x] **CLOSE-5. Vault update**
  - **MUST invoke `/vault-update`** — run the audit even if no foundation docs appear affected. If zero changes, the skill reports N/A cleanly.
  - _Plane issue remains open — STRK-75 is marked Done by `/sketch archive` (CLOSE-8) after PR merges._

- [x] **CLOSE-6. Open PR**
  - Use worktree branch `patch/VERSION` (created by `/start-patch` in Cohort 0). Target: `dev`. Title: `feat(STRK-75): add All tab as default to vendor price matrix`.
  - Body must include: link to STRK-75, link to `DocVault/Projects/StakTrakr/sketches/STRK-75-market-all-tab/`, test plan checklist covering AC-1 through AC-10.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** — triage both inline diff threads AND review-body findings from Codacy/Copilot/CodeRabbit. All Critical/High must be fixed or marked false-positive with reasoning.

- [x] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-75`** — moves folder to `archive/YYYY-MM-DD-STRK-75-market-all-tab/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort A tasks must run sequentially (single file). Cohort B tasks B.1 and B.2 run sequentially (B.2 depends on B.1 completing first, and expanded multi-metal fixture may share assumptions).

## Review Archive — tasks (2026-05-13)

_Reconciled by /sketch reconcile on 2026-05-13. Original reviewer marks preserved below for audit._

### Codex

**Verified Against Live Code**

- `Foundation/coding-standards.md:437-466` requires version-lock claims and `.worktrees/patch-VERSION` / `patch/VERSION` worktrees.
- `Foundation/coding-standards.md:421-431` documents current release artifacts.
- `js/market-data.js:1033` uses function-level metal context for spot premium math.
- `tests/playwright/market-sorting.spec.js:37-78` currently has only silver fixture data.
- `tests/playwright/retail/stak-582-market-survivors.spec.js:461-476` is the existing default active-tab assertion.

**Top Issues Raised**

1. Cohort 0 and CLOSE-6 use the wrong worktree/branch model for StakTrakr.
2. A.2/B.2 miss the row-specific premium and Goldback/G1 test risk that the live renderer exposes.
3. CLOSE-5 closes the Plane issue before PR creation, review, merge, or sketch archive.

**Unverified Assumptions**

- `/vault-update` is required even though STRK-75 appears scoped to runtime code and tests.
- A verification stamp inside `tasks.md` is intended to be part of the implementation audit trail despite the approach File Map excluding it.
- Running B.1 and B.2 in parallel is still desirable after B.2 expands the fixture and potentially overlaps with shared retail fixture assumptions.

### Resolution Summary
- Accepted: 4
- Rejected: 1 (CLOSE-3 file-map conflict — tasks.md is sketch control-plane, not implementation scope)
- Resolved with your input: 2 (branch model → patch/VERSION via /start-patch; B.1/B.2 → sequential)

## Verification Stamp

_Generated by CLOSE-3 on 2026-05-13. All ACs verified against worktree `patch/3.34.61`._

- [x] AC-1 — All tab is the first tab — verified at `js/market-data.js:1293-1294` (`allMetals` array prepends `{ code: "all", label: "All" }`); confirmed by test "AC-1/AC-2 — All tab is present, first, and active by default" at `tests/playwright/market-sorting.spec.js:380` (asserts tab order `["All", "Gold", "Silver", "Goldback"]`)
- [x] AC-2 — All tab is the default for new users — verified at `js/market-data.js:1304` (`loadDataSync("vendorPricesActiveTab", "all")` default `"all"`), `js/market-data.js:1305` (invalid-tab fallback also resolves to `"all"`); confirmed by test at `market-sorting.spec.js:383` (no `savedTab` set → active tab is `"all"`) and `stak-582-market-survivors.spec.js:470` (`.vendor-prices-tabs button.active` text = "All")
- [x] AC-3 — Valid saved tab preserved — verified at `js/market-data.js:1305` (`metals.some((m) => m.code === savedTab) ? savedTab : "all"`); confirmed by test "AC-3 — valid stored xag tab is preserved" at `market-sorting.spec.js:397` (savedTab `"xag"` → Silver active)
- [x] AC-4 — Invalid saved tab falls back to All — verified at `js/market-data.js:1305` (same ternary; unrecognised value produces `"all"`); confirmed by test "AC-4 — invalid stored tab falls back to All" at `market-sorting.spec.js:409` (savedTab `"stale-metal"` → active tab `"all"`)
- [x] AC-5 — All tab group ordering (Gold → Silver → Platinum → Palladium → Goldback) — verified at `js/market-data.js:903` (`allScopeOrder = ["xau","xag","xpt","xpd","goldback"]`), `js/market-data.js:929-935` (iterates priority order, sorts each group with `rowComparator`); confirmed by test "AC-5 — All-tab rows are grouped Gold, Silver, then Goldback" at `market-sorting.spec.js:418`
- [x] AC-6 — Per-metal tabs still narrow correctly — verified at `js/market-data.js:912` (`isAllScope ? allScopeOrder.includes(isoCode) : isoCode === metalCode` — per-metal path unchanged); confirmed by test "AC-6 — clicking a per-metal tab narrows the table correctly" at `market-sorting.spec.js:431`
- [x] AC-7 — Market filter settings respected in All tab — verified at `js/market-data.js:913-919` (`_isMarketItemEnabled` skips disabled slug/vendor combos in the all-scope row-collection loop) and `js/market-data.js:994-999` (vendor column builder also skips disabled combos in all-scope path); confirmed by test "AC-7 — market-filter hiding applies in the All tab" at `market-sorting.spec.js:442`
- [x] AC-8 — Goldback G1 premium and per-row spot premium — verified at `js/market-data.js:1062` (`_getSpotPrice(isoCode)` uses per-row `isoCode` from `metalSlugs`, not function-level `metalCode`) and `js/market-data.js:1151-1153` (`_goldbackG1Rate` fallback for Goldback rows); confirmed by test "AC-8 — All-tab premium math uses per-row spot and Goldback G1 rate" at `market-sorting.spec.js:460` (+10% gold, +5.6% silver, +20% Goldback G1)
- [x] AC-9 — Vendor columns stable in All tab (union across all visible rows) — verified at `js/market-data.js:988-1012` (`isAllScope` branch collects the enabled vendor union across all `metalSlugs` entries before sorting alphabetically); confirmed by test "AC-9 — All-tab vendor columns are the sorted union across metals" at `market-sorting.spec.js:476` (columns: APMEX, BullionX, Goldback, Hero, JM)
- [x] AC-10 — Test coverage — verified: `tests/playwright/market-sorting.spec.js:379-484` covers AC-1 through AC-9 with expanded fixture (gold + silver + Goldback rows, mocked G1 rate); `tests/playwright/retail/stak-582-market-survivors.spec.js:470` covers AC-2 in a real-data context; all new tests passed in CLOSE-1 run (632/633; 1 pre-existing network flake unrelated to STRK-75)
