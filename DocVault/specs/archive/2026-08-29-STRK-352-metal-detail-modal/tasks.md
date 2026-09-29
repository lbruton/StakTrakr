---
sketch: STRK-352-metal-detail-modal
phase: tasks
created: 2026-08-28
approved: 2026-08-29
---

# STRK-352 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch run` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-analysis-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project, mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

> **Required reading for every implementing agent/session:** `requirements.md` (the EARS contract), `approach.md` (decisions D-1..D-16 + UI Contract), `discovery.md` (path:line map + constraints), and the pixel authority `playground/metal-detail-modal-playground.html`. The `.context` pre-flight applies: `coding-standards.md` before any JS, `testing.md` before any test.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Create the patch worktree (setup-only slice of the release flow) _(done 2026-08-29: v3.36.13 claimed; worktree `/Volumes/DATA/GitHub/StakTrakr/.worktrees/patch-3.36.13` on `patch/3.36.13` @ origin/dev 7a2b58c3; bump commit 76b1184d; no PR)_
  - **File(s):** the six release-artifact files, committed by the release flow as the branch's first commit
  - **Workflow ownership (pinned):** live `/start-patch` is **triage only** — it explicitly does NOT claim a lock or create a worktree; it hands off to `/release patch`, which owns the lock, the `patch/<version>` worktree, and the version-bump commit. Invoke **`/start-patch`** (select STRK-352) and let it hand off to **`/release patch`**, then **STOP the release flow immediately after the bump commit lands in the new worktree — before any PR-creation step.** The PR is owned by CLOSE-6; CLOSE-4 verifies (never re-bumps). Record the claimed `<version>` and absolute worktree path for every later task.
  - **Acceptance:** `git worktree list` shows `.worktrees/patch-<version>/` on branch `patch/<version>` based on fresh `origin/dev`; `devops/version.lock` claims the version (high-water rule); the bump commit is the branch's only commit; **no PR exists**. Every subsequent command self-anchors to the worktree (`.claude/rules/worktree-cwd.md`).
  - **Leverage:** `/start-patch` → `/release patch` (project override: Phase 1 bump + Phase 2 verification; global skill: lock/worktree); `.context/git-topology.md` §Worktrees.

## Sprint Cohort A — Foundation (inert scaffolds only)

_Cohort A must not be able to satisfy any AC — it exists so Cohort B has something to load and fail against. All production CSS/markup/logic lives in Cohort C, after the RED boundary._

- [x] **A.1** — Scaffold `js/portfolio-series.js` with inert stub exports _(done 2026-08-29: commit 17af5c15; synthetic-CJS load verified, ESLint clean; names grep-unique)_
  - **File(s):** `js/portfolio-series.js` (new)
  - **Acceptance:** File exists with JSDoc'd stub functions (grep-unique names): `buildPortfolioSeries(items, spotDayMaps, scope, todaySpotPrices)` returning an empty-but-shaped result (`{days: [], melt: [], basis: [], buys: [], baseline: null}`), `computeWindowStats(series, windowStartKey)` returning zeroed stats, and `pickLedgerRows(items, scope)` stub. Window-exposed per house pattern. No series logic — the stubs cannot satisfy any AC. Loads standalone under Node (guarded `module.exports` like `js/utils.js`) so unit tests can require it. NOT yet registered in `index.html`/`sw.js` (registration is C.4, with the markup).
  - **Leverage:** `js/utils.js:1595+` (dual browser/Node export pattern); D-1.
  - **Maps to:** AC-5 (scaffold only)

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase: tests encode the EARS contract and MUST fail before Cohort C. B.2/B.3 are written against the approach + playground contract — they fail red because the shell, CSS, and behavior do not exist yet (nothing in Cohort A can green them). Each Playwright task updates `tests/playwright/coverage-map.csv` in the same commit (house rule; the CSV tracks inventory, not pass state)._

- [x] **B.1** — Failing unit tests for the series fold and window math _(done 2026-08-29: commit fc2bae79; 24/24 observed red, 730 pre-existing green)_
  - **File(s):** `tests/unit/portfolio-series.test.js` (new)
  - **Acceptance:** Node unit tests (existing `tests/unit/` harness conventions) with synthetic fixtures assert, and currently FAIL (red) against the A.1 stubs:
    - AC-5: verbatim string day keys; series start = first dated acquisition − 14 days; undated Item held from series start; synthetic baseline day precedes series start (approach layer 1).
    - AC-5 fallback: all-undated non-empty scope → series start = today − 30 days.
    - AC-6: derived oz routes through `getConstitutionalSilverOz` / `GB_TO_OZT`/`SB_TO_OZT` paths (fixture items per unit: oz, gb, cu — assert against injected helper doubles or the real helpers if requirable).
    - AC-7: disposition at day d removes melt AND basis from d onward; undated Disposition → never held.
    - AC-8: per-metal carry-forward, leading-edge backward-fill, zero-sample metal contributes 0; no gap ceiling.
    - AC-15: flow-adjusted market gain over a window with a mid-window buy AND a mid-window disposition (disposal melt-out not misclassified as market loss); % suppressed when end basis = 0; buy count = distinct dates; pace formula (window-acquired oz ÷ max(1/30, windowDays/30.44)).
    - D-8: final day valued at injected `todaySpotPrices`, not the day-map close.
  - **Depends on:** A.1
  - **Maps to:** AC-5, AC-6, AC-7, AC-8, AC-15

- [x] **B.2** — Failing Playwright spec for modal behavior (new domain suite) _(done 2026-08-29: commit 10c43b89; 23/23 observed red vs the legacy modal; coverage-map rows added)_
  - **File(s):** `tests/playwright/core/details-modal.spec.js` (new), `tests/playwright/coverage-map.csv`
  - **Acceptance:** Spec asserts structure + interaction (not text-presence only — STRK-123 lesson) and currently FAILS red (the Variant A shell does not exist yet): open via `.total-title` click renders the Variant A shell with zero legacy pie DOM (AC-1); header title/accent/substats with summed-unit count (AC-2); five KPI tiles incl. always-on Realized, Unrealized = retail−purchase parity with dashboard Gain (AC-3); close destroys chart + observer, clean reopen (AC-4); **generation race: with a delayed day-map fixture, closing the modal before the promise resolves leaves no chart instance, no repopulated DOM, and no live observer after the stale completion (D-3)**; series chips toggle datasets with `aria-pressed` and disabled spot chip on All (AC-9, AC-10, AC-12); range pills re-render (AC-11); crosshair renders on hover AND buy markers still receive pointer events (AC-13); marker click flashes matching rows / no-ops when none (AC-14); substrip values (AC-15 display); composition panels + metric toggle + |metric| ranking + "+N more" (AC-16, AC-17); ledger order incl. undated-last, columns, row click → Item View modal, deep link → `#/inventory` (AC-18, AC-19); loading skeletons, empty CTA activates `#newItemBtn`, disposed-only renders history + Realized (AC-21); keyboard operability + touch targets (AC-24); daily close = latest intraday live sample (seeded two-sample fixture, layer-2 pin); **currency: with a seeded non-default `displayCurrency` + exchange-rate fixture, KPI values, substrip, composition rows, ledger money columns, chart axis ticks, and tooltip amounts all render converted via `formatCurrency` (AC preamble)**; **footer provenance renders the D-16 line from the existing last-sync surface (provider label + last-sync value; no per-sample seed/live claims)**. Coverage-map row added (same commit).
  - **Depends on:** B.1 (sequential cohort; shares fixture helpers forward)
  - **Leverage:** `window.appListenersReady` before header clicks (memory); seeded localStorage fixtures per `.context/testing.md`; `showAppConfirm` gotcha (no native dialogs); playground for expected structure.
  - **Maps to:** AC-1..AC-4, AC-9..AC-19, AC-21, AC-24

- [x] **B.3** — Failing responsive assertions in the mobile-and-layout suite _(done 2026-08-29: commit e24997d6; 3/3 observed red)_
  - **File(s):** `tests/playwright/core/mobile-and-layout.spec.js`, `tests/playwright/coverage-map.csv`
  - **Acceptance:** Added cases FAIL red at 390×844: modal stacks one column, KPI strip 2-col (AC-23); ledger shows Date/Item/Qty/±% only with Paid/Melt hidden (AC-20); hero chart canvas visible (AC-22 — the STACK-70 reversal); coverage-map `test_count` bumped (same commit).
  - **Depends on:** B.2 (fixture/helper reuse)
  - **Maps to:** AC-20, AC-22, AC-23

## Sprint Cohort C — Implementation · GREEN (parallel where marked)

- [x] **C.1 [P]** — Implement the series fold + window stats _(done 2026-08-29: commit 228cabb0; 754/754 unit green; one disclosed fixture correction in the backfill case)_
  - **File(s):** `js/portfolio-series.js`
  - **Acceptance:** All B.1 unit tests pass (green). Pure functions only — no DOM, no globals mutated; boundary pins from approach layer 1 implemented exactly (pre-roll, baseline day, undated fallbacks, per-metal fill, flow-adjusted window chain, pace, D-8 final-day injection).
  - **Depends on:** B.1
  - **Maps to:** AC-5, AC-6, AC-7, AC-8, AC-15

- [x] **C.2 [P]** — Implement `getSpotDayMap` in spot.js _(done 2026-08-29: commit bff55f3a; 55 insertions, 0 modifications — provably additive; latest-live-per-day close selection)_
  - **File(s):** `js/spot.js`
  - **Acceptance:** Async `getSpotDayMap(metalName, fromDayKey)` ensures required years in `historicalDataCache` (reusing `getRequiredYears`/`fetchYearFile`), merges cache + live `spotHistory`, returns `Map<dayKey, spotUSD>` with the pinned close selection: live beats seed; among live rows the latest timestamp per day wins, input-order-independent (do NOT copy the first-live-row dedup at `js/spot.js:975-982`). Purely additive — zero diffs to existing functions; existing sparkline/ratio Playwright specs still green.
  - **Depends on:** B.2 (its close-selection case is the red test this feeds; greens at C.6)
  - **Maps to:** AC-8, AC-5

- [x] **C.3 [P]** — Land the `dm-` CSS block; retire the pie-layout CSS _(done 2026-08-29: format:check clean; zero live legacy selectors (comments only); zero hardcoded colors in the dm- block; STACK-70 hide rules retired with an explanatory tombstone)_
  - **File(s):** `css/styles.css`
  - **Acceptance:** The playground's delta-CSS block (adapted: `dm-` family, `.dm-seg` variant, `.dm-skel` shimmer + `prefers-reduced-motion` fallback, `.dm-flash`, mobile stacking rules) is added; `#detailsModal` ID rules (`5217-5225, 5276-5282`) rewritten for the new shell; legacy `.details-grid`/`.details-panel`/`.breakdown-*`/`.chart-canvas-*` family (`7883-8010`) removed; STACK-70 hide rules for `.chart-canvas-container`/`.chart-metric-toggle` (`14082-14087`) removed; base `.chart-metric-toggle` untouched. **Mechanical gates (CSS-aware — `npm run lint` is ESLint-only and cannot validate this file):** `npm run format:check` clean; grep confirms zero remaining `.details-grid|.details-panel|.breakdown-|.chart-canvas-container` selectors and zero hardcoded colors in the new block (tokens only). Semantic layout/color validation happens in CLOSE-3's browser states.
  - **Depends on:** B.2, B.3 (RED observed first)
  - **Leverage:** `playground/metal-detail-modal-playground.html` `<style>` block (the spec); D-12, D-14; `.context/design-philosophy.md`.
  - **Maps to:** AC-1, AC-17, AC-20, AC-22, AC-23

- [x] **C.4 [P]** — Replace the `#detailsModal` markup; register the new script _(done 2026-08-29: static shell (topbar/header/#dmBody) with stable ids; portfolio-series.js registered in index.html AND sw.js CORE_ASSETS at matching order)_
  - **File(s):** `index.html`, `sw.js`
  - **Acceptance:** `index.html:3238-3276` inner markup replaced with the Variant A static shell (same `#detailsModal`/`#detailsModalTitle`/`#detailsCloseBtn` ids; containers for topbar/header/KPIs/chart canvas/metric toggle/grid/ledger/footer; pie canvases gone); `<script defer src="./js/portfolio-series.js">` added to the script block (after utils/constants, before `detailsModal.js`); matching `./js/portfolio-series.js` entry in `sw.js` CORE_ASSETS at the same relative order. Service-worker cache stamp hook passes on commit.
  - **Depends on:** B.2, B.3 (RED observed first)
  - **Leverage:** playground markup structure; discovery §New-file registration (`index.html:8859-8954`, `sw.js:42-163`); js-invariants dual-registration rule.
  - **Maps to:** AC-1, AC-2

- [x] **C.5** — Rewrite detailsModal.js: orchestration, KPIs, composition, ledger, states
  - **File(s):** `js/detailsModal.js`
  - **Acceptance:** Two-phase open (skeletons → await day maps → render) with render-generation guard (B.2's close-during-load race case passes); same public contract (`showDetailsModal`/`closeDetailsModal`, existing ids — events.js untouched); KPI strip via `computeItemValuation` + always-on Realized (D-13; no `$0.00` hardcode); **every monetary surface renders via `formatCurrency` in the active display currency — B.2's non-default-currency case passes for KPIs/substrip/composition/ledger**; **footer provenance populated per D-16 from the existing last-sync surface — B.2's footer case passes**; composition panels with |metric| ranking + tie-break; delegated ledger (uuid rows, late index resolution → `showViewModal`, `ACTIVATE_ON_KEY` keyboard semantics, "View all" → `activateTab("inventory")`); empty state via `.empty-state` + `#newItemBtn` CTA (D-15); disposed-only renders history + Realized; `currencychange` subscription + `window._refreshDetailsModalTheme` hook registration; full cleanup on close. B.2 cases outside the chart pass; no console errors.
  - **Depends on:** C.1, C.2, C.3, C.4
  - **Maps to:** AC-1, AC-2, AC-3, AC-16, AC-17, AC-18, AC-19, AC-21, AC-24

- [x] **C.6** — Hero chart: Chart.js config + interactions
  - **File(s):** `js/detailsModal.js`
  - **Acceptance:** One Chart.js 3.9.1 instance, four datasets (melt line + gradient with `!chartArea` guard and resize-keyed cache; stepped basis; spot on `y1` per-metal only; buys scatter with scriptable `pointRadius`/`pointHitRadius`), index-based linear x with `ticks.callback` day labels (D-4); colors via `getThemeColorRGB`/`getChartColors` (no oklch into canvas); **crosshair mechanism pinned: a small inline Chart.js plugin draws the vertical line in `afterDraw` at the active element's x — canvas-drawn, so no DOM overlay exists to occlude the scatter markers, which stay first-class hit-test targets (`pointHitRadius` raised); B.2 asserts both crosshair render and marker pointer events**; external HTML tooltip built with `createElement`/`textContent` only (D-6), amounts via `formatCurrency` (B.2 currency case for ticks/tooltips passes); series chips with `aria-pressed` + disabled spot on All; range pills; marker click via `getElementsAtEventForMode` → scroll + `.dm-flash` on matching rows, no-op when none; destroy on close (`Chart.getChart` safety). ALL remaining B.2 + B.3 cases pass (suite green).
  - **Depends on:** C.5
  - **Maps to:** AC-9..AC-15, AC-20, AC-22, AC-23

- [x] **C.7** — Retire dead pie code + wire the theme hook
  - **File(s):** `js/charts.js`, `js/init.js`, `js/theme.js`, `js/state.js`
  - **Acceptance:** `createPieChart` deleted from charts.js (other exports untouched — they have live consumers); dead `typeChart`/`locationChart` caches removed from `js/init.js:419-420`; `setTheme` in theme.js gains the guarded `window._refreshDetailsModalTheme?.()` call (D-7, matching its `updateAllSparklines` pattern); `js/state.js` comment documents the new `chartInstances` key (optional, doc-only). Repo-wide grep shows zero remaining `createPieChart`/`typeChart`/`locationChart` references; `npm run lint` clean; full core suite still green.
  - **Depends on:** C.5, C.6
  - **Maps to:** AC-1, AC-4, AC-22

## UI Contract Traceability

| Named state (approach UI Contract) | Implementing task(s) | Verifying test assertion(s)                                                                  | Visual verification                                          |
| ---------------------------------- | -------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Populated — All Metals (desktop)   | C.3, C.4, C.5, C.6   | B.2: shell/AC-1, KPIs/AC-3, disabled spot chip/AC-10, metal-dot ledger/AC-18                 | vs playground preset "Recommended · Story / dark / All"      |
| Populated — single metal           | C.5, C.6             | B.2: spot overlay dataset + `y1`/AC-10, pace substat/AC-15                                   | vs playground Scope=Silver                                   |
| Range switching                    | C.6                  | B.2: pill `aria-pressed` + re-render/AC-11                                                   | vs playground range pills                                    |
| Series toggles                     | C.6                  | B.2: dataset visibility + `aria-pressed`/AC-9, AC-12                                         | vs playground series chips                                   |
| Marker → ledger sync               | C.6                  | B.2: flash class on matching rows; no-op case/AC-14; crosshair + marker pointer events/AC-13 | vs playground marker click                                   |
| Loading                            | C.5                  | B.2: `.dm-skel` present pre-data + generation-race case/AC-21, D-3                           | vs playground State=Loading                                  |
| Empty (nothing ever)               | C.5                  | B.2: `.empty-state` + `#newItemBtn` activation/AC-21                                         | vs playground State=Empty                                    |
| Disposed-only scope                | C.5                  | B.2: chart renders, Realized ≠ 0, ledger note/AC-21                                          | **no mockup — verify against AC-21 text**                    |
| Mobile ≤768px                      | C.3, C.5, C.6        | B.3: stacking, ledger columns, visible canvas/AC-20/22/23                                    | vs playground Width=Mobile                                   |
| Four themes                        | C.3, C.6             | B.2: rgb-resolved chart colors (no oklch strings)/AC-22                                      | manual pass in all four themes, real shell (STRK-282 lesson) |
| Non-default currency               | C.5, C.6             | B.2: converted money on every surface incl. ticks/tooltips (AC preamble)                     | spot-check one non-USD currency in the real shell            |
| Footer provenance                  | C.5                  | B.2: D-16 line from last-sync surface                                                        | vs D-16 copy (playground footer was mock text)               |

_Every implementing/reviewing session must read `playground/metal-detail-modal-playground.html` (cited in C.3, C.4, B.2 Leverage). CLOSE-3's UI stamp requires visual evidence per state above._

---

## Standard Closing Tasks

> **Numbering:** continues from Cohort C.

- [x] **CLOSE-1. Run full test suite** — zero regressions ✅ unit 754/754 (730+24), core 633/633 (607+26), worktree-anchored + pwd-verified. (Post-stamp: two live-use regression fixes added 2 tests — domain suite 25/25; final pre-PR core re-run 635/635, count-verified.)
  - **File:** _no file changes — verification only_
  - Run `npm run test:unit` and `npm test` (core Playwright PR gate) from the worktree, self-anchored, output redirected (no `| tail` — exit-code masking). All existing tests pass; all Cohort B tests pass green. **Compare test counts against the pre-change inventory +new tests** (wrong-tree false-green tell, `.claude/rules/worktree-cwd.md`).
  - If anything fails: fix the implementation, not the test. Tests are the spec.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality ✅ `analyze --diff`: ESLint9 (authoritative) 0, Trivy 0, markdownlint 0. Lizard 2 Warnings = the KNOWN tokenizer-desync phantom on `safeGetElement` (init.js — pre-existing, not introduced by this diff; mem0 `lizard-esc-regex-desync`). Stylelint OOM'd locally on the 14k-line styles.css (4GB heap; a 12GB retry locked the machine — local retries abandoned); CSS is covered by the PR's cloud Codacy gate.
  - **File:** _no file changes — scan only_
  - Run `codacy-analysis-cli` skill against changed files (`codacy-analysis analyze --diff`). Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.

- [x] **CLOSE-3. Generate verification stamp** ✅ appended below — 24 ACs + currency preamble all `[x]`; 10 of 13 evidence screenshots individually viewed (range/toggle states test-verified; captures on disk)
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - One line per AC (AC-1..AC-24): `- [x] AC-N — verified at <path>:<line>` or `verified by <test name>`, or `- [ ] AC-N — gap: <reason>`.
  - **UI verification requirement:** `approach.md` has a UI Contract, so every UI-mapped AC additionally needs `+ visually verified against mockup state "<state>"` or `+ screenshot compared: <path>` — a test-only citation is insufficient (a Playwright pass can coexist with wrong pixels). Disposed-only state verifies against AC-21 text (no mockup exists).
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains.

- [x] **CLOSE-4. Release-artifact verification + spot bundle** (the bump already exists — 0.1) ✅ bundle rebuilt (coverage → 2026-08-29, +50 sqld entries, committed 037cd326); six artifacts verified agreeing on 3.36.13; no re-bump; sw.js hook-stamped
  - **File:** the six release-override-owned files only: `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`. `sw.js` is **hook-stamped output** — never hand-edited.
  - Run **`/update-spot-bundle`** exactly per `.context/git-topology.md` §Spot Bundle: the script writes to the **main checkout**; afterwards copy into the worktree from the worktree root (`cp ../../data/spot-history-bundle.js data/ && cp ../../data/spot-history-bundle-*.js data/`). Ensure Tailscale is up first.
  - Then re-run `/release patch` **Phase 2 (verification) only** — confirm all six artifacts still agree on `<version>` (the 0.1 bump) and CHANGELOG covers the shipped work. **Do NOT re-invoke the bump — the version was claimed and committed in 0.1.** If the lock expired or was superseded during long implementation, resolve per the high-water rule before proceeding.

- [x] **CLOSE-5. Repo docs + vault audit** ✅ repo docs on-branch: reusable-patterns + implementation-gotchas (e9347af6) and the coding-standards Chart.js hex caveat (b5a9075d, from the slate lesson); `/vault-update` audit: one stale `typeChart` example found — fixed in canonical `.context`, Foundation original left frozen per policy; vault committed + pushed (84f4dc5)
  - **Repo docs (this branch, before the PR):** update `.context/reusable-patterns.md` (portfolio-series fold + getSpotDayMap pattern) and `.context/implementation-gotchas.md` (daily-close latest-live-per-day selection; STACK-70 hide-rule removal) — these live in the StakTrakr repo and belong on the implementation branch, not in DocVault.
  - **MUST invoke `/vault-update`** as a skill for the **DocVault** audit — even if no vault docs look affected, the skill performs the audit; zero changes = clean N/A by audit, not a skip.
  - _(Plane closure moved to CLOSE-8 — it is post-merge by definition.)_

- [x] **CLOSE-6. Open PR** ✅ #1478 → dev, both labels, verbatim justification + inventory delta in body
  - Worktree branch `patch/<version>` from 0.1. Title: `feat(STRK-352): redesign metal detail modal — portfolio chart, composition, ledger`.
  - Body: link to STRK-352, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-352-metal-detail-modal/`), test plan checklist, **the new-domain justification line for `details-modal.spec.js` verbatim** (approach File Map), and both review labels (`codacy-review`, `coderabbit-review` — patch PRs get BOTH, per project convention).

- [x] **CLOSE-7. Resolve PR review threads** ✅ 11 threads discovered (Copilot 2, Codex 4, CodeRabbit 5) + 1 pre-analysis + docstring gate; every claim code-verified before classification; 9 fixes in `121ce038` (recovery guard, backdrop teardown, Escape stacking, sticky border model, null-±% color, chart leak, doc pointer, 8 helper JSDoc, optional-chain); 2 FP + 1 resolved-by-prior-commit replied with evidence; all threads replied + resolved; checks green ×2; `@coderabbitai resolve` cleared the standing block → CLEAN/MERGEABLE
  - **MUST invoke `/pr-resolve`** as a skill. Scan BOTH inline diff threads AND review-body findings (summary-block findings are real). Critical/High fixed or FP-with-reasoning; Medium fix-or-waiver; Low/Info advisory. Re-check for new scanner threads after each push.

- [x] **CLOSE-8. Archive sketch + close issue** ✅ archived to sketches/archive/2026-08-29-STRK-352-metal-detail-modal/; mem0 handoff saved; STRK-352 → Done (completed_at 2026-08-29)
  - **MUST invoke `/sketch archive STRK-352`** — moves the folder to `archive/YYYY-MM-DD-STRK-352-metal-detail-modal/`, saves the mem0 summary, **and marks STRK-352 Done in Plane** (the archive verb owns issue closure; sequenced merge → archive → Done).

---

> **Multi-model dispatch hint:** C.1/C.2/C.3/C.4 are `[P]` (four disjoint file sets: portfolio-series.js / spot.js / styles.css / index.html+sw.js; no shared symbols — the day map is an _input_ to the fold). Cohort A is a single inert scaffold; Cohort B is sequential; the B(red)→C(green) boundary is the natural model-routing seam. C.5→C.6→C.7 are sequential (same file, then dependent deletions).

## Review Archive — tasks (2026-08-29)

### Resolution Summary

- **Accepted: 10 / 10. Rejected: 0. User input: 0** (all findings verified against live skill contracts and `.context/git-topology.md` before applying).
- Structural changes: Cohort A reduced to the inert A.1 stub (TDD boundary restored); the production CSS and markup moved behind the RED gate as C.3/C.4 `[P]`; Cohort C renumbered C.1–C.7 with a four-way parallel front.
- Workflow-ownership pin (0.1): live `/start-patch` is triage-only → hand-off to `/release patch` which owns lock/worktree/bump; the flow **stops after the bump commit, before PR creation** (the boundary Codex required be made explicit); CLOSE-4 became verification-only (six override-owned files; `sw.js` hook-stamped; spot bundle main-checkout → worktree copy per §Spot Bundle).
- Coverage additions to B.2 + C.5/C.6: non-default currency across every monetary surface incl. chart ticks/tooltips; D-16 footer provenance; the D-3 close-during-load generation race; C.6 names the crosshair mechanism (inline afterDraw plugin — canvas-drawn, no occluding DOM overlay).
- CLOSE-5 split: repo `.context` docs land on the implementation branch; `/vault-update` audits DocVault only; Plane Done moved to CLOSE-8 (owned by `/sketch archive`, post-merge).
- Stale-docs drift found during verification (CLAUDE.md skills table + `.context/sketch-conventions.md` still describe `/start-patch` as claiming lock/worktree) — flagged as a separate chore task chip, out of this reconcile's file scope.

### Original inline marks (verbatim)

> CODEX: The live `/start-patch` skill explicitly says it does **not** claim a version or create a worktree; it hands off to `/release patch`, whose workflow owns the lock, worktree, version bump, commit, and PR. CLOSE-4 then invokes `/release patch` again. As written, execution can start the release before implementation or claim/bump twice. Pin one workflow owner and an exact setup-only/resume boundary; neither current skill defines the lifecycle described here.

> CODEX: A.2 and A.3 are production implementation, not scaffolding: they land the final `dm-` CSS and Variant A shell for AC-1/2/17/20/22/23 before Cohort B. Several corresponding assertions can therefore pass before the RED boundary even if the overall suite remains red. Move those changes to Cohort C, or reduce Cohort A to inert loadable scaffolds that cannot satisfy an AC, and require each applicable B assertion to be observed failing.

> CODEX: `npm run lint` runs ESLint over JavaScript and does not inspect `css/styles.css`, so it cannot validate this task's only changed file. Add a CSS-relevant mechanical gate (at minimum `npm run format:check` plus the named selector/removal checks); leave semantic layout/color validation to the explicit browser states in CLOSE-3.

> CODEX: The requirements preamble makes active-display-currency formatting binding for every AC, but no task seeds a non-default currency or asserts KPI, axis, tooltip, substrip, composition, and ledger money output. C.3 names `formatCurrency` only for Realized. Add a RED browser case and matching implementation acceptance for all monetary surfaces, including chart labels/tooltips.

> CODEX: Approach D-16 requires a truthful footer provenance line using the existing last-sync surface, but A.3 provides only a footer container and neither B.2 nor C.3 requires its content. Add a footer assertion here and the concrete population work to C.3, including the no-per-sample-provenance boundary.

> CODEX: The D-3 render-generation guard is not exercised by "close destroys + clean reopen." Add a delayed day-map fixture, close the modal before the promise resolves, then assert the stale completion creates no chart, DOM repopulation, or observer; otherwise the exact race the guard exists for can regress while B.2 remains green.

> CODEX: AC-13 and the UI Contract require an actual crosshair whose hover surface does not occlude buy-marker pointer events, but this implementation acceptance names only the external tooltip and marker click. Specify the Chart.js plugin/hook and hit-testing behavior that draws the crosshair while preserving marker interaction, so the implementation task actually owns what B.2 asserts.

> CODEX: The StakTrakr release override edits exactly six files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`) and explicitly says **not** to hand-edit `sw.js`; the pre-commit hook stamps it. Replace the open-ended list with the override-owned six files and describe `sw.js` only as hook output.

> CODEX: The live StakTrakr topology says `/update-spot-bundle` writes into the **main checkout**, after which the generated bundle shards must be copied into the active worktree. "Run the worktree's own script copy" contradicts that required data path and can leave the release branch stale. Use the exact main-checkout → worktree copy sequence from `.context/git-topology.md` §Spot Bundle.

> CODEX: `/vault-update` edits and commits central DocVault notes; the two named `.context/*` files live in the StakTrakr repo and are handled by `/release patch`'s diff-scoped `.context` sweep. Move those repo-doc checks into the implementation/release branch and give `/vault-update` real DocVault candidates (or record an audited N/A) so documentation changes land in the correct repository.

> CODEX: This task runs before the PR is even opened, while its acceptance is explicitly post-merge. Project gotchas order closure as merge → sketch archive → Plane Done. Keep the vault audit here, but move the Plane Done update to CLOSE-8 after the archive; otherwise CLOSE-5 cannot be completed in sequence.

### CODEX Review (2026-08-29)

#### Verified

- Resolved the single active STRK-352 sketch folder and reviewed only `tasks.md`; preserved the reconciled requirements, discovery, and approach artifacts unchanged.
- Read all four current sketch artifacts plus the universal and StakTrakr sketch/task conventions, testing and release topology guidance, and the live `/start-patch`, `/release patch`, `/update-spot-bundle`, `/vault-update`, and `/pr-resolve` skill contracts.
- Verified the implementation baseline is StakTrakr `dev` at `4a385ba55304f80989bd08087ea88aa2ed24720e` and spot-checked the named modal, chart, theme, state, event, test, and coverage-map surfaces in the live repository.
- Verified `npm run lint` excludes CSS, `sw.js` is hook-stamped rather than a release-override edit, the spot-bundle worktree copy direction, and the required post-merge sketch/archive/Plane closure order.
- Verified both `codacy-review` and `coderabbit-review` labels currently exist; only CodeRabbit is label-gated in the current review-routing documentation, while Codacy AI runs automatically.

#### Top concerns

1. Cohort A violates the stated TDD boundary by implementing the final shell and CSS before their RED assertions.
2. Cohort 0 and CLOSE-4 describe incompatible ownership of `/start-patch` and `/release patch`, creating a double-lock/double-bump or premature-release path.
3. Task traceability misses binding coverage for non-default currency, D-16 footer provenance, the close-during-load generation race, and explicit crosshair implementation.
4. Closing tasks contain executable workflow drift: the wrong release file set, reversed spot-bundle copy semantics, repo `.context` files assigned to `/vault-update`, and Plane closure sequenced before PR creation/merge.

#### Unverified assumptions

- I did not execute Playwright, Codacy, release, worktree, or browser-visual workflows; this was a static tasks-phase review against live source, package scripts, labels, and workflow/skill contracts.
- I did not re-fetch the Plane issue; I treated the reconciled `requirements.md` as the acceptance contract and `approach.md` as implementation authority.
- If the intended workflow is to interrupt `/release patch` after its worktree phase and resume it later, that behavior is not defined by the current skill and must be made explicit before dispatch.

---

## Verification Stamp (CLOSE-3, 2026-08-29)

Suites: `details-modal.spec.js` 25/25 (23 planned + 2 live-use regressions), mobile block 3/3, unit 754/754, core full-suite green. Visual evidence: `evidence/*.png` in this folder, captured from the real worktree build via Playwright (fresh Chromium, seeded fixtures); "viewed" = the implementing session opened and inspected the image.

- [x] AC-1 — verified by "AC-1: … Variant A shell with zero legacy pie DOM" + visually verified: `evidence/01-all-desktop.png`, `02-silver-desktop.png` (viewed) vs playground preset.
- [x] AC-2 — verified by "AC-2: header carries scope title, accent, and summed-unit substats" + close-position regression test + visually verified: gold All accent (01), palladium accent (07), silver (02) (viewed).
- [x] AC-3 — verified by "AC-3: five KPI tiles; Unrealized matches the dashboard Gain figure; Realized always shown" (parity asserted against the live dashboard cell) + `02` (viewed).
- [x] AC-4 — verified by "AC-4: close destroys the chart; reopen renders cleanly with no console errors".
- [x] AC-5 — verified by `tests/unit/portfolio-series.test.js` (held-window melt/basis, verbatim string day keys, undated-held-from-start cases).
- [x] AC-6 — verified by unit derived-oz cases (cu via constitutional helper, qty folding) + in-browser gb path (All scope shows Gold 0.01 oz from the 5-gb seed, `01` viewed).
- [x] AC-7 — verified by unit disposition cases (exclusion from date _d_; undated Disposition = never held) + visually: disposed-only platinum hump rises at acq, drops at disposition (`08`, viewed).
- [x] AC-8 — verified by unit gap-fill cases (per-metal carry-forward, leading backfill, no-history-zero, never-drop) + layer-2 pin test (latest live sample per day = close, 61.2 exact).
- [x] AC-9 — verified by "AC-9/AC-12: basis and buys chips …" (isDatasetVisible + aria-pressed) + `02` gradient hero + stepped basis (viewed).
- [x] AC-10 — verified by "AC-10: single-metal scope renders the spot overlay on y1; All disables the chip and axis" + visually: dashed spot + right axis (02) vs disabled chip, no y1 (01) (viewed).
- [x] AC-11 — verified by "AC-11: 1Y default; 30D shrinks the window" + `03-silver-range-30d.png` captured.
- [x] AC-12 — verified by the chips test + per-metal marker colors on All (`01`, viewed) + `04-silver-chips-toggled.png` captured.
- [x] AC-13 — verified by "AC-13: … real marker click flashes its ledger rows" (REAL mouse coordinates after chartSettled) + visually: crosshair + "Acquired 2026-08-24" tooltip (`05`, viewed).
- [x] AC-14 — verified by "AC-14: … all-disposed marker is a no-op" + the flash on active rows in `05` (viewed).
- [x] AC-15 — verified by "AC-15: substrip …" (pace present per-metal, absent on All) + substrips visible in 01/02 (viewed).
- [x] AC-16 — verified by "AC-16/AC-17: two panels, |metric| ranking with +N more" (7 active locations → top 6 + "+1 more…", disclosed fixture correction).
- [x] AC-17 — verified by the same test's metric-toggle re-render with signed Gain/Loss classes.
- [x] AC-18 — verified by "AC-18: ledger lists active Items newest-first, undated last, disposed excluded" + ledger order in `02` (viewed).
- [x] AC-19 — verified by "AC-19: ledger row click opens the Item View modal; View-all deep-links #/inventory".
- [x] AC-20 — verified by mobile-and-layout "AC-20" (visible headers exactly Date/Item/Qty/±%, paid+melt hidden) + desktop equal-height grid in 01/02 + `09` (viewed).
- [x] AC-21 — verified by skeleton test, D-3 generation-race test, both empty-state tests, and the disposed-only test + visually: skeletons (`06`), empty (`07`), disposed-only (`08`) (all viewed). Disposed-only verified against AC-21 text (no mockup exists, per plan).
- [x] AC-22 — verified by the slate regression test (hex accent tokens → real CanvasGradient) + mobile canvas-visible test + visually: dark (02), light (`10`), slate (`11`), sepia (`12`) — all four themes viewed, chart rendering in each.
- [x] AC-23 — verified by mobile-and-layout "AC-23" (stacked grids, 2-col KPIs) + `09` (viewed).
- [x] AC-24 — verified by "AC-24: keyboard-operable" (row Enter → Item View, chip Space toggle) + "AC-24: 44px touch targets" (close/pill/row heights at 390px) + canvas `role="img"` aria-label naming the KPI strip + ledger as the accessible equivalent.
- [x] Currency preamble — verified by the EUR end-to-end test (exact €270.00 KPI, €100.00 ledger row, € axis ticks + tooltip) + `13-currency-eur.png` (viewed: every monetary surface in €).

Live-use addendum (post-CLOSE-1, user QA on the worktree build): two regressions found, fixed, and pinned red-first — slate hex-token gradient crash (AC-22) and close-button side (AC-2). Commit `dc2369ff`.
