---
sketch: "STRK-78-playwright-mock-audit"
phase: requirements
created: 2026-05-15
reconciled: 2026-05-15
---

# STRK-78 — Requirements

> **Source Issue:** [STRK-78](https://plane.lbruton.cc/lbruton/browse/STRK-78/)
>
> **Title:** Audit and consolidate Playwright test suite — reduce flaky failures from API rate limiting
>
> **Priority:** high
>
> **Body summary (corrected against live tree, 2026-05-15):**
>
> The Playwright suite is **56 spec files / 643 tests**. With `fullyParallel: false` and `workers: 1` (`playwright.config.js:5-7`), a full run fires hundreds of real external requests in rapid succession against `api.staktrakr.com` / `api2.staktrakr.com` (GitHub Pages), `open.er-api.com`, `cdn.jsdelivr.net`, and (transitively, via app code when catalog credentials are present) Numista — tripping HTTP 429 rate limits. Failures cluster near the end of the run; the same tests pass in isolation. Retries: 0 local, 1 in CI. **12 of 56 files use `page.route()` mocking; 44 do not (472 tests).** Reference mocked patterns: `tests/playwright/view-modal-chart-scaling.spec.js` and `tests/playwright/market-sorting.spec.js` (both at the suite root — no `11-market-data/` directory exists).
>
> Additional external surfaces beyond the original issue body, found in app code and/or current specs: `api2.staktrakr.com` (`js/constants.js:531-535`, `js/retail.js:639-664`), `cdn.jsdelivr.net` (`index.html:333-336`), dealer URLs (`herobullion.com`, `apmex.com`, `bullionexchanges.com`, `goldback.com`, `jmbullion.com`), and the cloud-sync providers (Dropbox/Box/pCloud). Discovery must produce the full inventory.
>
> **Two workstreams:**
>
> 1. **Mock all external API calls** at the test boundary — add `page.route()` (or shared fixture installers) to every spec file that actually triggers external requests. Note: not all 44 unmocked files trigger external traffic; `config-validation.spec.js` (94 tests) is pure filesystem validation and `about-page.spec.js` (45 tests) loads only local assets — together 139 tests need no mocking. Discovery must classify the remaining 42 files.
> 2. **Consolidate redundant tests** — verified clusters: Numista catalog (34 tests across `numista-picker-tags.spec.js` (26), `numista-search.spec.js` (5), `numista-not-configured.spec.js` (3)); view modal (34 tests across `view-modal-chart-scaling.spec.js` (18), `view-modal-no-auto-resync.spec.js` (5), `view-modal-numista-merge.spec.js` (11)); cloud sync (26 tests across `cloud-sync-header-button.spec.js` (3), `cloud-sync.spec.js` (9), `settings-cloud-tab.spec.js` (9), `view-modal-no-auto-resync.spec.js` (5)). "Market data" is _not_ a verified cluster — ~17 files reference "market" but most are settings/retail specs with incidental market content; discovery must define the consolidation boundary precisely.
>
> Additional improvements to evaluate in discovery/approach: `fullyParallel: true` + `workers: 4+`, `test.slow()` markers, MSW as a global mock layer (see Non-Goals — currently deferred), `@network` tagging policy.
>
> **Priority order of unmocked files** (paths corrected to repo state): `tests/playwright/settings-currency.spec.js` (7), `tests/playwright/goldback-type.spec.js` (16), `tests/playwright/silverback.spec.js` (10), `tests/playwright/filter-chip-and-logic.spec.js` (14), `tests/playwright/numista-picker-tags.spec.js` (26), `tests/playwright/numista-search.spec.js` (5) → 78 tests in the named priority files. The remaining unmocked surface is **~394 tests across 38 files** (after subtracting the 139 pure-UI/filesystem tests in `config-validation` + `about-page` and the 78 priority tests from the 472 unmocked total).
>
> **Success criteria from issue:** zero real external API calls from specs that exercise the browser; reduced non-redundant test count; 10 consecutive clean runs locally; `npm test` and `npm run test:offline` produce identical results once mocking is complete.

## Overview

Audit the Playwright suite, eliminate all real external API calls by mocking them at the test boundary, and consolidate redundant coverage. The work converts a sequential, rate-limit-fragile 643-test run into a deterministic, parallelizable suite that runs without network access. This unblocks future test additions (each new spec no longer compounds the rate-limit risk), restores trust in CI (no more "rerun, it's flaky"), and is a prerequisite for enabling parallel workers — itself a wall-clock reduction worth the effort.

**Scoping clarification — not all "unmocked" files need mocks.** Of the 44 spec files without `page.route()`, two are confirmed to make zero external requests: `config-validation.spec.js` (94 tests, pure filesystem checks) and `about-page.spec.js` (45 tests, static local HTML). That's 139 tests with no mocking work. The remaining 42 files must be classified during discovery as "actually triggers external requests" vs "pure UI/localStorage/filesystem"; only the former need route handlers.

**Parallel-readiness is broader than mocking.** Mock isolation is necessary but not sufficient for `fullyParallel: true`. Shared localStorage state, file-descriptor pressure under multiple Chromium workers, and test-order side effects are independent risks. AC-6 below scopes this sketch to the _readiness audit_ (which names and files those risks as follow-ups), not the actual parallel flip.

## User Stories

- **US-1:** As a StakTrakr maintainer, I want the full Playwright suite to make zero real external API requests, so that flaky failures from upstream rate limiting (`api.staktrakr.com`, `api2.staktrakr.com`, `open.er-api.com`, `cdn.jsdelivr.net`, and any Numista calls that fire transitively via app code) disappear and CI signal is trustworthy. The audit must explicitly prove whether Numista is reached from the suite (e.g., via app code when catalog credentials are configured) and either mock that path or document that the suite never exercises it.
- **US-2:** As a contributor running tests locally, I want `npm test` and `npm run test:offline` to produce identical pass/fail results, so that I can iterate offline and on planes without hidden network dependencies.
- **US-3:** As a maintainer adding a new test, I want a shared mock fixture library to import from, so that I do not duplicate manifest / spot / slug / currency / Numista response shapes in every new spec.
- **US-4:** As a reviewer of test failures, I want the suite to be free of redundant coverage, so that a single regression does not surface as N near-identical failing tests across overlapping specs.
- **US-5:** As a maintainer waiting on CI, I want the suite to run with parallel workers once tests are isolated, so that the full run completes in a fraction of the current wall-clock time.

## Acceptance Criteria

### AC-1 (maps to US-1) — No real external requests

- **Given** the Playwright suite is run locally with network egress monitoring enabled (`page.on('request')` audit hook or external proxy)
- **When** `npm test` completes end-to-end across the post-consolidation spec set
- **Then** every outgoing request is matched against an explicit **allow/deny list** maintained in the sketch artifacts. The deny list (must be zero hits) includes at minimum: `api.staktrakr.com`, `api2.staktrakr.com`, `open.er-api.com`, `cdn.jsdelivr.net`, `api.numista.com`, Dropbox/Box/pCloud OAuth and content endpoints, and every dealer URL referenced in retail specs (`herobullion.com`, `apmex.com`, `bullionexchanges.com`, `goldback.com`, `jmbullion.com`). The allow list (if any survives) must enumerate each entry with a justification in the PR body. Every deny-list URL pattern is intercepted by a `page.route()` handler (mock or stub) or by an equivalent shared-fixture installer.

### AC-2 (maps to US-2) — `test:offline` parity

- **Given** the working tree is at the same commit
- **When** `npm test` and `npm run test:offline` are each invoked back-to-back
- **Then** both runs report the same passing test count, the same skipped count, and no test transitions from pass→fail (or vice versa) between the two modes. This requires removing the four `@network` tags from `tests/playwright/01-page-load/page-load.spec.js` once those tests are mocked and offline-safe (see Non-Goals — the `@network` clause has been relaxed accordingly).

### AC-3 (maps to US-3) — Shared fixture library exists and is used

- **Given** at least three spec files needed mocked manifest/spot/Numista responses pre-sketch
- **When** those specs are inspected post-implementation
- **Then** each imports its mock response data from a shared fixture module under `tests/playwright/helpers/mocks/` (or equivalent path agreed in approach.md), and no two specs contain a copy-pasted inline JSON blob for the same endpoint. Discovery will decide whether the fixture layer is pure response data, route installers, or both — `helpers/mocks/` does not yet exist; the existing `helpers/seed.js` is a localStorage inventory seeder and is not a viable base without redesign.

### AC-4 (maps to US-4) — Consolidation hits a defensible target

- **Given** the pre-sketch baseline of 643 tests across 56 files
- **When** consolidation completes
- **Then** the new test count is documented (with delta), every removed test has a one-line rationale captured in tasks.md (or a follow-up checklist in the PR body), and no acceptance criterion previously covered is now uncovered. Verification is via a **manual coverage map** produced as part of the consolidation PR (the suite has no automated coverage tooling wired in today, so a mechanical coverage diff is not available).

### AC-5 (maps to US-1, US-5) — Suite stability

- **Given** the consolidated, fully-mocked suite
- **When** `npm test` is run **10 consecutive times** on a single workstation without clearing browser state
- **Then** all 10 runs report identical green results — no transient failures, no rate-limit errors, no test-order-dependent regressions.

### AC-6 (maps to US-5) — Parallel-readiness audit + follow-ups

- **Given** all tests are mock-isolated
- **When** a parallel-readiness audit is performed against the consolidated suite
- **Then** the audit produces (a) a written assessment of remaining isolation risks — explicitly covering shared localStorage state, file-descriptor pressure under multiple Chromium workers, and test-order side effects — and (b) one follow-up Plane issue per remaining risk class. The actual `fullyParallel: true` / `workers: 4` flip is **out of scope for this sketch** (see Non-Goals) and is the deliverable of the follow-up issue(s).

## Non-Goals

- **Not flipping `fullyParallel: true` in this sketch.** Parallel-readiness (AC-6) is the audit deliverable; the flag flip happens in a follow-up so any new isolation bugs surface against a known-good mocked baseline rather than a moving target.
- **MSW is deferred outright.** Approach.md will weigh only `page.route()` per-spec vs. a shared fixture library. If MSW later looks compelling, file a follow-up sketch. (Reconciliation note: the prior wording said both "not added" and "implemented if discovery picks it" — that contradiction is now resolved in favor of deferral.)
- **Not increasing retry counts.** Retries mask the rate-limit problem rather than fixing it; success criteria require zero real requests, after which retries become unnecessary.
- **Not retaining vestigial `@network` tags after mocking.** Once the four `@network`-tagged tests in `tests/playwright/01-page-load/page-load.spec.js:93-147` are mocked and offline-safe, their `@network` tags may be removed so AC-2 parity holds genuinely. The `test:offline` npm script itself remains for a transition period.
- **Not rewriting test assertions.** Mocking is a boundary swap; the assertions that ran against real data must run against representative mock data with the same expectations. Mock data must mirror real-world response shapes so existing assertions remain valid.
- **Not touching the `sw.js` service worker registration logic in app code.** App-level SW behavior is out of scope. Note: `playwright.config.js:12` already sets `serviceWorkers: "block"`, so the test environment has no active SW — the "MSW coexistence with SW" concern from earlier framing is moot for Playwright's context.
- **Not auditing or refactoring the 12 already-mocked files** beyond extracting their fixtures into the shared library if approach.md selects that path. They are reference patterns, not rework candidates.

## Open Questions

_Anything that blocks the next phase. Empty by the time discovery starts._

- [ ] Does any spec rely on **non-deterministic real data** (e.g., asserting "spot price > 0" without a fixed value)? Those need to be re-pinned against mock values during the swap.
- [ ] Are there integration smoke tests intentionally hitting production that should be preserved under a `@smoke` tag and run separately?
- [ ] During discovery, classify the 42 unmocked spec files (44 minus `config-validation.spec.js` and `about-page.spec.js`) as "triggers external requests" vs "pure UI/localStorage/filesystem" — only the former need route handlers. Discovery should also confirm whether Numista calls fire transitively from app code during any test (no current spec references `api.numista.com` directly).

---

## Review Archive — requirements (2026-05-15)

_Reconciled by `/sketch reconcile` on 2026-05-15. Original reviewer marks preserved below for audit._

### DeepSeekV4Pro

#### Inline marks (verbatim, originally embedded in Source Issue block)

> **DeepSeekV4Pro — numbers need updating:** The suite currently has **56** spec files (not 55) and **643** tests (not 647). Files with `page.route()`: **12** (not 19). Files without: **44** (not 26). Unmocked test count: **472** (not ~223). Reference filenames are correct but the claim they live under `11-market-data/` is wrong — they are at `tests/playwright/view-modal-chart-scaling.spec.js` and `tests/playwright/market-sorting.spec.js`. No `11-market-data/` directory exists.

> **DeepSeekV4Pro — `api.numista.com` is not called from any test file.** A grep for `numista\.com` or `api\.numista` across all Playwright specs returns zero matches. Numista tests use local fixture data (`numistaId`, `numistaData` objects). This endpoint should be removed from the list of rate-limit trippers unless discovery finds it in app code triggered during test runs.

> **DeepSeekV4Pro — additional external endpoints found in spec files that are not listed in the issue body:** `api2.staktrakr.com`, `cdn.jsdelivr.net`, and dealer URLs (`herobullion.com`, `apmex.com`, `bullionexchanges.com`, `goldback.com`, `jmbullion.com`). Discovery should inventory these.

> **DeepSeekV4Pro — consolidation area counts need discovery-phase verification:**
>
> - **Cloud sync:** 4 spec files found (not 5+): `cloud-sync-header-button.spec.js` (3), `cloud-sync.spec.js` (9), `settings-cloud-tab.spec.js` (9), `view-modal-no-auto-resync.spec.js` (5). Total: 26 tests. The 35 test estimate is ~35% too high.
> - **Market data:** The "5 files / 54 tests" claim is hard to map to actual files. Grep for "market" hits ~17 files, most of which are settings or retail specs with incidental market content. Discovery should define the consolidation boundary precisely.
> - **Numista catalog:** Verified — `numista-picker-tags.spec.js` (26), `numista-search.spec.js` (5), `numista-not-configured.spec.js` (3) = 34 tests across 3 files. ✓
> - **View modal:** Verified — `view-modal-chart-scaling.spec.js` (18), `view-modal-no-auto-resync.spec.js` (5), `view-modal-numista-merge.spec.js` (11) = 34 tests across 3 files. ✓

> **DeepSeekV4Pro — "remaining 20 files (145+ tests)" is inaccurate.** The test counts in the 6 named priority files sum to 78. Subtracting from the 472 tests in 44 unmocked files leaves ~394 tests across 38 remaining unmocked files — much larger than claimed. Re-run the count against actual file state.

> **DeepSeekV4Pro — `test:offline` currently skips only 1 file.** `npm run test:offline` runs `--grep-invert @network`. Only `tests/playwright/01-page-load/page-load.spec.js` (4 tests tagged `@network`) is excluded. The distinction is already near-vestigial. This doesn't invalidate AC-2 but contextualizes the work — after full mocking, `@network` tags become entirely vestigial and could be removed along with the offline script, though the non-goal says not to. Worth a discussion note for discovery.

> **DeepSeekV4Pro — preliminary grep results:** `dropbox` and `pcgs` (case-insensitive) return zero matches in test files. `cdn.jsdelivr.net` does appear. The open question is well-formed to catch what the grep missed — app-level code that fetches during a test run even if the test file doesn't reference the URL directly.

> **DeepSeekV4Pro — `playwright.config.js:12` already sets `serviceWorkers: "block"`.** The test environment has no active SW to coexist with. This doesn't invalidate the non-goal (don't modify app SW) but changes the calculus for MSW: SW interference is a non-issue. The non-goal's "relevant if MSW is considered" framing is moot in Playwright's test context.

#### DeepSeekV4Pro Review (2026-05-15)

##### Verified

| Claim                                        | Status                | Evidence                                                                                                                             |
| -------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 55 spec files                                | **Incorrect**         | 56 files. `find tests/playwright -name '*.spec.js' \| wc -l → 56`                                                                    |
| 647 tests                                    | **Incorrect**         | 643 tests. `rg -c '^\s*(test\|test\.skip)\(' tests/playwright -g '*.spec.js' \| awk -F: '{s+=$2} END {print s}' → 643`               |
| 19 files have `page.route()`                 | **Incorrect**         | 12 files. `rg -l 'page\.route\(' tests/playwright -g '*.spec.js' \| wc -l → 12`                                                      |
| 26 files lack `page.route()`                 | **Incorrect**         | 44 files. `find ... -exec grep -L ... → 44`                                                                                          |
| ~223 tests unmocked                          | **Incorrect**         | 472 tests in unmocked files                                                                                                          |
| `fullyParallel: false`, `workers: 1`         | **Correct**           | `playwright.config.js:5-6`                                                                                                           |
| `test:offline` uses `--grep-invert @network` | **Correct**           | `package.json:9`                                                                                                                     |
| Reference mock files exist                   | **Partially correct** | Files exist but at wrong paths: both under `tests/playwright/` root, not `tests/playwright/11-market-data/`                          |
| Priority file test counts                    | **Correct**           | settings-currency (7), goldback-type (16), silverback (10), filter-chip-and-logic (14), numista-picker-tags (26), numista-search (5) |
| View modal: 34 tests / 3 files               | **Correct**           | 18+5+11=34 across 3 files                                                                                                            |
| Numista catalog: 34 tests / 3 files          | **Correct**           | 26+5+3=34 across 3 files                                                                                                             |
| `retries` 0 local, 1 CI                      | **Correct**           | `playwright.config.js:7` (`process.env.CI ? 1 : 0`)                                                                                  |
| `api.numista.com` as a rate-limit target     | **Unverified**        | Zero occurrences in any test file. Match in source code, not tests.                                                                  |
| Cloud sync: 35 tests / 5+ files              | **Incorrect**         | 26 tests across 4 files                                                                                                              |
| Market data: 54 tests / 5 files              | **Unclear**           | No clear boundaries; ~17 files reference "market"                                                                                    |

##### Top Concerns

1. **Numbers are substantially wrong across the three most load-bearing claims** (file count, test count, mocked/unmocked split). The delta between claimed 26 unmocked and actual 44 unmocked files means the scope of the mocking workstream is nearly 70% larger than the requirements assume. Tasks and effort estimates derived from these numbers will be unreliable.

2. **`api.numista.com` is cited as a rate-limit source but does not appear in any test file.** If Numista API calls originate from app code triggered during test runs (not test fixtures), that needs to be proven in discovery. Otherwise US-1's scope should drop Numista as a target and the list in AC-1 should be corrected.

3. **Consolidation area boundaries are undefined for "market data."** Unlike view modal and Numista (which have clean 3-file clusters) and cloud sync (4 files), "market data" has ~17 loosely related files spanning settings, retail, and root-level specs. Without a concrete scoping rule (e.g., "files under `tests/playwright/03-settings/` whose primary purpose is market control UI"), consolidation may drift into adjacent concerns during implementation.

##### Unverified Assumptions

These are stated or implied by the requirements but not yet backed by code, docs, or a prior decision. Discovery should resolve them.

1. **All 44 unmocked files trigger external API calls.** Many test files test pure localStorage operations, UI rendering, or settings that don't fetch remote data. The requirement's "zero real external API calls" goal is correct, but the count of files needing mocking may be lower than 44.
2. **Dealer URLs (`herobullion.com`, `jmbullion.com`, etc.) are intentional test targets or test noise.** The requirements don't mention them, but they appear in spec file strings. If these are test configuration for retail price display (not live fetch targets), they are out of scope for mocking.
3. **`api2.staktrakr.com` is a separate rate-limit concern from `api.staktrakr.com`.** It appears in test files but is not listed in the issue body or requirements.
4. **The 12 already-mocked files' `page.route()` patterns are suitable as reference implementations.** The requirements declare them as reference patterns without verifying that their mock strategies are complete, consistent, or follow best practices.
5. **The existing `helpers/seed.js` is a sufficient base for the fixture library.** It exists but is a single file with inventory seeding helpers. Whether the new mock library should extend seed.js or be a parallel module needs a design decision.
6. **`cdn.jsdelivr.net` requests (Polyfill.io, Font Awesome, etc.) need mocking.** CDN requests are external but may not cause rate limits. Whether they're in scope for AC-1 is ambiguous.
7. **30–40% test reduction is achievable without removing acceptance coverage.** This is stated as a target range for market data consolidation but has no grounding in redundancy analysis. The discovery phase should produce actual overlap metrics.
8. **Parallel execution (US-5) is gated only on mock isolation.** Other factors (shared browser state, localStorage collisions, test ordering side effects, file-descriptor limits) could also block `fullyParallel: true`. Mentioned implicitly in the AC-6 follow-up clause but not explored.

### Codex

#### Inline marks (verbatim, originally embedded in body)

> CODEX: The 647-test baseline is stale in the live tree: I verified 56 spec files under `tests/playwright` and 643 `test(` / `test.skip(` declarations, while `playwright.config.js:5-7` still has `fullyParallel: false`, one worker by default, and 0 local / 1 CI retry. Please update the overview baseline before it drives task sizing. Also, mock isolation is necessary for parallel readiness but not sufficient by itself; shared localStorage/state and file-descriptor pressure are separate risks that AC-6 should name or defer explicitly.

> CODEX: "Numista" needs tighter wording here. I found the app provider base at `js/catalog-api.js:573-580`, but no `api.numista.com` / `numista.com` references in current Playwright specs. If the suite reaches Numista only through app code when catalog credentials are configured, the requirement should say that and define how the audit proves it; otherwise this reads like a known current test endpoint when the live specs do not show one.

> CODEX: AC-1's endpoint list is too narrow for the stated "zero real external API requests" goal. The app also declares `api2.staktrakr.com` in `js/constants.js:531-535` and fetches from the selected v2 endpoint in `js/retail.js:639-664`; `index.html:333-336` loads `cdn.jsdelivr.net`; Dropbox/Box/pCloud paths exist in cloud storage modules. Either AC-1 should be all external requests with an allow/deny list, or it should explicitly scope to rate-limit-prone market/catalog endpoints.

> CODEX: This conflicts with the current `test:offline` mechanics and the non-goal below. `package.json:13-14` defines offline as `--grep-invert @network`, and `tests/playwright/01-page-load/page-load.spec.js:93-147` currently has four `@network` tests, so identical skipped counts are impossible unless those tags are removed, renamed, or mocked and no longer excluded. That directly collides with "Not adjusting `@network` tags" at line 101.

> CODEX: This is directionally good, and I verified `tests/playwright/helpers/seed.js:1-23` is only an inventory/localStorage seeding helper today; there is no existing `tests/playwright/helpers/mocks/` directory. Discovery should decide whether the fixture layer is pure response data, route installers, or both, because tests like `market-sorting.spec.js:257-285` currently combine route behavior with per-test scenario data.

> CODEX: "Coverage diff" may not be mechanically available for this vanilla Playwright suite; I did not find coverage tooling in the current test command (`package.json:13`). This AC is still testable if it requires a manual coverage map, but the "coverage diff" option should either name the tool that will produce it or be removed to avoid an unverifiable acceptance path.

> CODEX: This is framed as a follow-up branch, so it is not directly verifiable as an acceptance criterion for this sketch. Consider making the deliverable a documented parallel-readiness audit plus follow-up issue creation, or move the actual `fullyParallel: true` run into this sketch's validation. Live config confirms the current gate is still disabled at `playwright.config.js:5-6`.

> CODEX: This non-goal contradicts itself: it says MSW is not added in this sketch, then says the sketch implements MSW if discovery picks it. Since `playwright.config.js:11` blocks service workers, MSW may be technically feasible only through its Node/server mode or config changes, but the requirements need one clear boundary: either MSW is an allowed approach candidate or it is deferred.

> CODEX: This is the same conflict as AC-2: as long as `npm run test:offline` remains `--grep-invert @network` (`package.json:14`) and four tests still carry `@network` (`tests/playwright/01-page-load/page-load.spec.js:93-147`), the two commands cannot have identical skipped counts. The requirement should choose between preserving the tag distinction with intentionally different counts, or removing/retagging once mocks make those tests offline-safe.

#### CODEX — Unverified Assumptions

These are stated or implied by the requirements but not yet backed by live-code evidence or a settled product decision.

1. **Every unmocked spec needs a route handler.** I verified 44 spec files lack `page.route()`, but some may be pure localStorage/UI tests and may only need a global "fail on unexpected external request" audit rather than endpoint-specific mocks.
2. **`npm test` and `npm run test:offline` should have identical counts while preserving `@network`.** Current scripts and tags make that impossible without changing one of those requirements.
3. **The endpoint scope is only `api.staktrakr.com`, `open.er-api.com`, and `api.numista.com`.** Live app code and specs also reference `api2.staktrakr.com`, `cdn.jsdelivr.net`, and cloud-provider endpoints.
4. **MSW is both out of scope and a viable selected implementation.** The non-goal currently says both; approach cannot safely proceed until this boundary is reconciled.
5. **Parallel-readiness can be accepted without running the suite in parallel.** AC-6 currently pushes the actual flag flip to a follow-up branch, leaving the readiness claim only partly verifiable here.
6. **A coverage diff is available for consolidation validation.** I verified the test commands but not any coverage tooling, so the manual coverage map may be the only practical acceptance path.

#### CODEX Review (2026-05-15)

##### Verified

- Current Playwright config keeps the suite serial by default: `fullyParallel: false`, `workers` defaulting to 1, and retries set to 0 locally / 1 in CI at `playwright.config.js:5-7`; service workers are blocked at `playwright.config.js:11`.
- Current npm scripts run full Playwright for `npm test` and `--grep-invert @network` for `npm run test:offline` at `package.json:13-14`.
- Current suite inventory is 56 `*.spec.js` files, 643 `test(` / `test.skip(` declarations, 12 files with `page.route()`, and 44 files without `page.route()`.
- The only current `@network` tags are four tests in `tests/playwright/01-page-load/page-load.spec.js:93-147`, so offline parity cannot preserve identical skipped counts while those tags remain excluded.
- Existing route patterns include StakTrakr v2, fallback `api2`, exchange-rate, CDN, and image routes, for example `tests/playwright/market-sorting.spec.js:257-285` and `tests/playwright/retail/currency-switch.spec.js:245-270`.
- The app contains additional external request surfaces beyond AC-1's list: `cdn.jsdelivr.net` in `index.html:333-336`, v2 primary/fallback endpoints in `js/constants.js:531-535`, retail v2 fetches in `js/retail.js:639-664`, exchange rates in `js/constants.js:331-332` and `js/utils.js:754-765`, and Numista provider config in `js/catalog-api.js:573-580`.
- The existing Playwright helper layer has `tests/playwright/helpers/seed.js:1-23`, but no `tests/playwright/helpers/mocks/` directory yet.

##### Top concerns

1. **AC-2 contradicts the non-goal around `@network`.** The current offline command excludes four tagged tests, so identical counts cannot be accepted unless the requirements allow tag changes or redefine parity.
2. **AC-1's endpoint list is narrower than the actual "zero external request" goal.** The app and current specs include `api2.staktrakr.com`, CDN, and cloud-provider surfaces that need an explicit allow/deny decision.
3. **Several acceptance paths are not directly verifiable as written.** AC-4's "coverage diff" lacks an identified tool, and AC-6 defers the actual parallel run to a follow-up branch while still using it as this sketch's readiness gate.

##### Unverified assumptions

See `## CODEX — Unverified Assumptions` above. The load-bearing unresolved assumptions are the `@network` parity decision, the full endpoint inventory, and whether MSW is allowed or deferred.

### Qwen

#### Inline marks (verbatim, originally embedded in body)

> QWEN: `settings-currency.spec.js` lives at `tests/playwright/settings-currency.spec.js` (root), not under `03-settings/`. Also, the "remaining 20 files (145+ tests)" arithmetic is wrong — 472 unmocked minus 78 priority = ~394 across 38 files, not 145 across 20.

> QWEN: The 647-test baseline is stale (actual: 643 tests, 56 files). More importantly, 139 of the 472 unmocked tests are in files that make zero external requests (`config-validation.spec.js` = 94 pure filesystem checks, `about-page.spec.js` = 45 static HTML content checks). The "all unmocked files need mocking" framing should be refined to "all unmocked files that actually trigger external requests need mocking."

> QWEN: `tests/playwright/helpers/mocks/` does not exist yet — only `seed.js` (localStorage seeding) and two PNG fixtures are present. The existing mocked files (`market-sorting.spec.js:258-285`, `view-modal-chart-scaling.spec.js:77`) use per-test inline route handlers with inline JSON. Discovery should decide whether the fixture layer is pure response data, route installers, or both.

#### QWEN — Unverified Assumptions

These are stated or implied by the requirements but not yet backed by live-code evidence or a settled product decision.

1. **All 44 unmocked files need `page.route()` handlers.** I verified that `config-validation.spec.js` (94 tests) is pure filesystem validation — it imports `fs` and `path`, reads repo config files, and never opens a browser. `about-page.spec.js` (45 tests) loads `about.html` which contains only local image paths and anchor links — no external JS/CSS/CDN requests. That's **139 tests across 2 files that make zero external requests** and need no mocking. The actual mocking scope is smaller than 44 files.
2. **AC-2 parity is achievable without touching `@network`.** It is not. `package.json:14` excludes `@network`-tagged tests, and `tests/playwright/01-page-load/page-load.spec.js:93-147` carries four such tags. Identical skipped counts are impossible unless the tags are removed, retagged, or the tests are mocked and no longer excluded.
3. **The "remaining 20 files (145+ tests)" arithmetic is recoverable.** It is not. The six named priority files sum to 78 tests. Subtracting from 472 unmocked tests leaves ~394 across 38 remaining files. The original numbers are off by a factor of ~2.7x.
4. **MSW is excluded while remaining a viable candidate.** The non-goal says MSW is not added in this sketch, then says the sketch implements it if discovery selects it. Since `playwright.config.js:11` already blocks service workers, MSW would need its Node/server mode, but the boundary needs one clear decision.
5. **`settings-currency.spec.js` lives at `tests/playwright/03-settings/settings-currency.spec.js`.** It does not. It lives at `tests/playwright/settings-currency.spec.js` (root level). The priority list path is wrong.
6. **Parallel-readiness is gated only on network isolation.** Shared localStorage state, file-descriptor pressure under parallel Chromium instances, and test-order side effects are independent risks not addressed by mocking alone.

#### QWEN Review (2026-05-15)

##### Verified

| Claim                                                    | Status       | Evidence                                                                                                                      |
| -------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 56 spec files                                            | **Correct**  | `find tests/playwright -name '*.spec.js' \| wc -l → 56`                                                                       |
| 643 tests                                                | **Correct**  | `rg -c '^\s*(test\|test\.skip)\(' tests/playwright -g '*.spec.js' → 643`                                                      |
| 12 files with `page.route()`                             | **Correct**  | `rg -l 'page\.route\(' tests/playwright -g '*.spec.js' → 12`                                                                  |
| 44 files without `page.route()`                          | **Correct**  | `find ... -exec grep -L → 44`                                                                                                 |
| 472 unmocked tests                                       | **Correct**  | Sum of test counts across 44 unmocked files                                                                                   |
| `fullyParallel: false`, workers=1, retries 0/1           | **Correct**  | `playwright.config.js:5-7`                                                                                                    |
| `serviceWorkers: "block"`                                | **Correct**  | `playwright.config.js:11`                                                                                                     |
| `test:offline` = `--grep-invert @network`                | **Correct**  | `package.json:14`                                                                                                             |
| 4 `@network` tests in page-load.spec.js                  | **Correct**  | `tests/playwright/01-page-load/page-load.spec.js:93-147`                                                                      |
| Cloud sync: 26 tests / 4 files                           | **Correct**  | 3+9+9+5=26                                                                                                                    |
| View modal: 34 tests / 3 files                           | **Correct**  | 18+5+11=34                                                                                                                    |
| Numista catalog: 34 tests / 3 files                      | **Correct**  | 26+5+3=34                                                                                                                     |
| Priority file counts (7,16,10,14,26,5)                   | **Correct**  | Verified individually                                                                                                         |
| `api.numista.com` not in test files                      | **Correct**  | `rg 'numista\.com\|api\.numista' tests/playwright -g '*.spec.js' → 0 matches`                                                 |
| `11-market-data/` directory does not exist               | **Correct**  | `ls tests/playwright/11-market-data/ → No such file`                                                                          |
| `tests/playwright/helpers/mocks/` does not exist         | **Correct**  | Only `seed.js` and two PNG fixtures in helpers/                                                                               |
| `config-validation.spec.js` makes zero external requests | **Verified** | Pure `fs`/`path` file reads, no browser, no fetch, no HTTP refs                                                               |
| `about-page.spec.js` makes zero external requests        | **Verified** | `about.html` has only local image paths and anchor links; no CDN/script tags                                                  |
| `settings-currency.spec.js` at root, not `03-settings/`  | **Correct**  | `find tests/playwright -name '*currency*' → settings-currency.spec.js at root`                                                |
| Existing mock patterns are per-test inline               | **Verified** | `market-sorting.spec.js:258-285` routes v2 and api2 inline; `view-modal-chart-scaling.spec.js:77` routes exchange rate inline |

##### Top concerns

1. **139 tests across 2 files (`config-validation.spec.js`, `about-page.spec.js`) make zero external requests and do not need mocking.** The requirements treat all 44 unmocked files as equal mocking candidates. This inflates the perceived scope by ~30% and will distort task sizing in the tasks phase. The requirements should classify files by "actually fetches external data" vs "pure UI/localStorage/filesystem" before task breakdown.

2. **AC-2 and the `@network` non-goal are mutually exclusive.** As long as `npm run test:offline` excludes four `@network`-tagged tests (`package.json:14`, `page-load.spec.js:93-147`), the two commands cannot produce identical skipped counts. The requirements must choose: either allow tag changes once mocks make those tests offline-safe, or redefine parity to exclude skipped-count matching.

3. **AC-1's endpoint allow-list is narrower than the app's actual external surface.** The app references `api2.staktrakr.com` (`js/constants.js:531-535`), `cdn.jsdelivr.net` (`index.html:333`), Dropbox/Box/pCloud cloud providers, and Numista/PCGS catalog endpoints. AC-1 should either scope explicitly to "rate-limit-prone market and catalog APIs" or adopt an allow-list/deny-list approach for all external requests.

##### Unverified assumptions

See `## QWEN — Unverified Assumptions` above. The load-bearing unresolved items are the file-classification question (assumption 1), the AC-2/@network conflict (assumption 2), and the MSW boundary contradiction (assumption 4).

### Resolution Summary

- Accepted: 12 (number corrections, path corrections, endpoint scope expansion, US-1 Numista wording, AC-3 discovery-decides note, AC-4 manual coverage map, AC-1 file-classification carve-out, SW non-goal mootness note)
- Rejected: 0
- Resolved with your input: 3
  - **A. AC-2 vs `@network`** — relaxed the non-goal to allow removing `@network` tags once mocked tests are offline-safe; AC-2 kept as written.
  - **B. MSW boundary** — deferred outright; approach.md weighs only `page.route()` per-spec vs. shared fixture library.
  - **C. AC-6 verifiability** — reframed AC-6 deliverable as a written parallel-readiness audit + follow-up Plane issues; the actual `fullyParallel: true` flip is out of scope for this sketch.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is scoped to discovery-resolvable items. Next: `/sketch review STRK-78 discovery` is not yet applicable — first run `/sketch discovery STRK-78`.
