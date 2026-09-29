---
sketch: STRK-79-market-api-sw-routing
phase: tasks
created: 2026-05-15
approved: 2026-05-15
---

# STRK-79 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the version-locked patch worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows `.worktrees/patch-<VERSION>/` on branch `patch/<VERSION>` after a fresh `devops/version.lock` claim for STRK-79. `git rev-parse --show-toplevel` from the shell equals that worktree path, not `/Volumes/DATA/GitHub/StakTrakr`. If the worktree is missing or the shell is still in the main checkout, STOP and report that `/sketch apply` or `/release patch` setup was bypassed.
  - **Leverage:** Repo `AGENTS.md` issue/worktree gate; `DocVault/Projects/StakTrakr/Foundation/coding-standards.md` Release Process; `devops/version.lock`.

## Sprint Cohort A — Router Contract (parallel-safe)

_This cohort touches only the new router module and its unit tests. It can run before the service-worker integration because it defines the pure contract that `sw.js` will consume._

- [x] **A.1** — Create the endpoint-family classifier
  - **File(s):** `sw-router.js`
  - **Acceptance:** `sw-router.js` exposes `FAMILY_TABLE` and `classifyEndpoint(urlString, selfOrigin)` with a CJS export guard and no browser-only side effects. The classifier returns `{ family, floor, hasEnvelope }` for exactly the approach.md endpoint families: `manifest`, `spot-latest`, `spot-history-daily`, `goldback-latest`, `retail-latest`, `retail-intraday`, `retail-history-short`, `retail-history-long`, `providers`, and `annual-spot-history`; `annual-spot-history` matches both local-origin `/data/spot-history-YYYY.json` and API-root `/spot-history-YYYY.json`; unclassified API paths, non-API hosts, and third-party `staktrakr.com` remote spot-history return `null`.
  - **Leverage:** approach.md `FAMILY_TABLE`; `js/constants.js` `V2_API_ENDPOINTS`; `js/api.js` spot latest and hourly backfill paths; `js/retail.js` provider/retail paths.
  - **Maps to:** AC-1, AC-5

- [x] **A.2** — Cover classifier behavior with Node unit tests
  - **File(s):** `tests/unit/sw-router.test.js`
  - **Acceptance:** Create `tests/unit/` if needed. Unit tests use Node's built-in `node:test` and `node:assert` APIs, import the same `sw-router.js` file that the service worker will load, cover all ten endpoint families across `api.staktrakr.com`, `api2.staktrakr.com`, and local-origin annual spot-history where applicable, and include negative cases for third-party `staktrakr.com`, unrelated API paths, malformed URLs, and non-API hosts. `npm run test:unit` passes and wraps `node --test tests/unit/sw-router.test.js`.
  - **Leverage:** Node built-in `node:test`; approach.md File Map.
  - **Depends on:** A.1
  - **Maps to:** AC-1, AC-4, AC-5

- [x] **A.3** — Wire router tooling coverage
  - **File(s):** `package.json`, `eslint.config.cjs`
  - **Acceptance:** `package.json` defines `test:unit` as `node --test tests/unit/sw-router.test.js`. ESLint coverage includes `sw-router.js` and `tests/unit/**/*.js`, so `npm run lint` checks the new router module and unit tests instead of silently skipping them.
  - **Leverage:** current `package.json` scripts; current `eslint.config.cjs` file globs.
  - **Depends on:** A.2
  - **Maps to:** AC-4

## Sprint Cohort B — Service Worker Integration (sequential)

_These tasks all modify `sw.js`; run them in order to avoid collisions and to keep each verification point small._

- [x] **B.1** — Load the classifier and add classified routing branches
  - **File(s):** `sw.js`, `devops/hooks/stamp-sw-cache.sh`
  - **Acceptance:** `sw.js` loads `sw-router.js` with `importScripts("sw-router.js")`. The existing `api.staktrakr.com` / `api2.staktrakr.com` branch and the local `/data/spot-history-YYYY.json` branch call `classifyEndpoint(event.request.url, self.location.origin)` first; classified requests route to `classifiedFetch(event.request, family)`, and `null` classifications fall through to the existing `staleWhileRevalidate(event.request)` behavior unchanged. All other fetch branches remain unchanged. `devops/hooks/stamp-sw-cache.sh` includes `sw-router.js` in `CACHED_PATTERNS` so future router-only commits roll `CACHE_NAME`; `sw-router.js` is not added to `CORE_ASSETS`.
  - **Leverage:** current `sw.js` fetch handler; approach.md routing sketch; `devops/hooks/stamp-sw-cache.sh` cached asset pattern list.
  - **Depends on:** A.1
  - **Maps to:** AC-1, AC-3

- [x] **B.2** — Implement classified cache age reads
  - **File(s):** `sw.js`
  - **Acceptance:** `matchWithAgeCheck(request, family)` reads `caches.match(request)`, computes age from `x-generated-at` when present and otherwise from `x-cached-at`, compares against `x-stale-after ?? family.floor`, returns a cloned fresh `Response`, and returns `null` for expired, missing, malformed, or legacy entries with neither age header. Existing `fetchAndCache`, `cacheFirst`, `networkFirst`, and `staleWhileRevalidate` bodies remain untouched.
  - **Leverage:** approach.md D-2/D-7; `api-health.js` generated-at freshness contract.
  - **Depends on:** B.1
  - **Maps to:** AC-2, AC-3

- [x] **B.3** — Implement classified network writes
  - **File(s):** `sw.js`
  - **Acceptance:** `fetchAndCacheClassified(request, family)` fetches classified requests with `{ cache: "no-store" }`; returns non-OK upstream responses unchanged and uncached; for OK responses, reads the body once, preserves `status` and `statusText`, writes a cached response with `x-cached-at` plus parsed `x-generated-at` / `x-stale-after` for envelope families, and returns an equivalent response to the caller. Opaque-response guard behavior matches approach.md risk notes.
  - **Leverage:** existing `fetchAndCache` error/caching contract; approach.md D-3/D-4/D-8.
  - **Depends on:** B.2
  - **Maps to:** AC-2, AC-3

- [x] **B.4** — Wire the classified dispatcher and stale fallback
  - **File(s):** `sw.js`
  - **Acceptance:** `classifiedFetch(request, family)` serves fresh cache hits, otherwise blocks on `fetchAndCacheClassified`, and on network failure falls back to raw `caches.match(request)` so stale cached data remains available offline. Classified requests no longer use broad stale-while-revalidate behavior, while unclassified requests still do.
  - **Leverage:** approach.md D-5 and offline/flaky-network US-2.
  - **Depends on:** B.3
  - **Maps to:** AC-1, AC-2, AC-3

- [x] **B.5** — Add temporary SW test instrumentation
  - **File(s):** `sw.js`
  - **Acceptance:** A module-scoped `lastStrategy` records `"cache-hit"`, `"network"`, or `"network-fallback"` only inside `classifiedFetch`. A narrow `message` listener responds only to `event.data?.type === "__sw_test_state__"` by posting `{ type: "__sw_test_state__", lastStrategy }` back to the client. No `/sw-test-state` fetch route and no `self.__SW_LAST_STRATEGY` global are introduced. Instrumentation is scoped to a single service-worker lifetime; tests must read state after each serialized request instead of relying on persistence across reload/reinstall.
  - **Leverage:** approach.md SW-internal test instrumentation section; QWEN/Codex review resolution that rejected a synthetic route.
  - **Depends on:** B.4
  - **Maps to:** AC-4

## Sprint Cohort C — Browser Verification (sequential)

_These tests depend on the router and service-worker integration from Cohorts A and B._

- [x] **C.1** — Add SW-enabled Playwright coverage for classified caching
  - **File(s):** `tests/playwright/sw-caching.spec.js`
  - **Acceptance:** The test file uses `test.use({ serviceWorkers: "allow" })`, waits for the StakTrakr service worker to control the page, exercises at least one envelope family and the annual spot-history family through HTTP fetches, and proves cache miss/network, cache hit, expired revalidation, and network-fallback behavior by reading the `__sw_test_state__` postMessage response. Assertions are serialized as one request followed by one postMessage read within the same page/service-worker lifetime, and the test comments document the `lastStrategy` race mitigation.
  - **Leverage:** `tests/playwright/font-loading.spec.js` SW-enabled precedent; Playwright `baseURL` served by `python3 -m http.server`.
  - **Depends on:** B.5
  - **Maps to:** AC-2, AC-4

- [x] **C.2** — Run focused verification and fix regressions
  - **File(s):** `sw-router.js`, `sw.js`, `tests/unit/sw-router.test.js`, `tests/playwright/sw-caching.spec.js`
  - **Acceptance:** `npm run test:unit` and `npx playwright test tests/playwright/sw-caching.spec.js` pass from the patch worktree. Any failure is fixed in the owning implementation/test file before proceeding to closing tasks.
  - **Leverage:** `npm run lint`; `npm run test:unit`; `npx playwright test tests/playwright/sw-caching.spec.js`.
  - **Depends on:** C.1
  - **Maps to:** AC-1, AC-2, AC-3, AC-4

---

## Standard Closing Tasks

> **Numbering:** Continue from the last sprint task. If your last sprint task is C.1, closing tasks start at C.2 — or relabel as 1, 2, 3 below; consistency matters more than scheme.

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm run lint`, `npm run test:unit`, and `npm test` from the patch worktree. All existing tests pass; all new unit tests and Cohort C Playwright coverage pass.
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Verify findings on changed lines only; ignore pre-existing browser-global `no-undef` noise in `sw.js` unless this patch introduces a new instance or a changed-line regression.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1, AC-2, …), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md. Status-only notes ("PR opened", "tests passing") are not equivalent — the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** release artifacts managed by `/release patch`
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.
  - Acceptance: STRK-79 version lock claim is reflected in the versioned release artifacts; `sw.js` may be restamped by the pre-commit hook and must be included if changed. Do not manually edit `CACHE_NAME` before committing; `devops/hooks/stamp-sw-cache.sh` owns it.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. If no docs need updating, the skill reports zero changes and the task is done; that is a clean N/A by audit, not a skip.
  - Acceptance: `/vault-update` records a durable DocVault reference for AC-5: the endpoint family table, strategy/freshness window per in-scope host/path family, the classified cache age-gate mechanism, and the precedence rule `envelope.stale_after ?? family.floor`. It also records or explicitly skips the stale `data-pipelines.md` retail TTL housekeeping noted in approach.md. Do not mark the source issue Done until after PR merge and `/sketch archive STRK-79`; if the skill proposes closure here, defer it and record that closure is merge-gated.

- [x] **CLOSE-6. Open PR**
  - Use worktree branch `patch/<VERSION>` from `/sketch apply`. Open a draft PR against `dev` with label `codacy-review`.
  - Title format: `v<VERSION> — STRK-79: Market API service-worker routing`.
  - Body must include: link to STRK-79, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-79-market-api-sw-routing/`), version bumped, completed tasks, and test evidence.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: the resolver MUST scan **both** inline diff threads AND review-body findings. Many code review tools (Codacy, Copilot, etc.) post critical findings as "comments outside of the diff" or in summary-style review prose, not as inline threads. Inline-only sweeps miss real bugs hiding in summary blocks.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - Note: scanners often re-post findings on each new commit. After running `/pr-resolve`, check whether new threads appeared from auto-scanners and address those before merge.

- [ ] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-79`** as a skill — moves folder to `archive/YYYY-MM-DD-STRK-79-market-api-sw-routing/` and saves mem0 summary.
  - Acceptance: sketch is archived only after the PR merges; STRK-79 is then marked Done in Plane as part of archive/closeout.

---

## Verification Stamp

_Written 2026-05-15 after CLOSE-2. Each line cites the artifact that proves the criterion._

- [x] AC-1 — verified at `sw-router.js:9-91` (FAMILY_TABLE, 10 families, both API hosts) + `tests/unit/sw-router.test.js` (26 unit tests covering all families × both hosts + annual-spot-history on local origin + all negative cases)
- [x] AC-2 — verified by `sw.js:352-374` (`matchWithAgeCheck`: age clock `x-generated-at` → `x-cached-at` → stale; TTL = `x-stale-after ?? family.floor`) + `sw.js:382-398` (`classifiedFetch`: cache-hit / network / network-fallback dispatch) + SC-1/SC-2/SC-3 Playwright tests in `tests/playwright/sw-caching.spec.js` (cache-miss → cache-hit, stale revalidation, network-fallback)
- [x] AC-3 — verified by `git diff origin/dev`: no changes to `js/`, `data/`, `css/`, or `index.html`; only `sw.js`, `sw-router.js`, `package.json`, `eslint.config.cjs`, `devops/hooks/stamp-sw-cache.sh`, and test files changed. All 650 existing Playwright tests pass (CLOSE-1).
- [x] AC-4 — verified by `npm run test:unit` (26/26 pass — Node `node:test` unit tests for `classifyEndpoint`) + `npx playwright test tests/playwright/sw-caching.spec.js` (3/3 pass — SC-1 cache-hit, SC-2 stale-revalidation, SC-3 network-fallback, all using `test.use({ serviceWorkers: "allow" })` + `__sw_test_state__` postMessage instrumentation)
- [x] AC-5 — verified by DocVault `coding-standards.md` "Classified caching — sw-router.js (STRK-79)" section (committed 2026-05-15, pushed to lbruton/DocVault main): FAMILY_TABLE with all 10 families + floor TTLs + hasEnvelope flags, age-gate header hierarchy (`x-generated-at` → `x-cached-at` → legacy), and `envelope.stale_after ?? family.floor` precedence rule

---

> **Parallelization check:** No tasks are marked `[P]`. Cohort A has an internal dependency (`A.2` depends on `A.1`), Cohort B shares `sw.js`, and Cohort C depends on the integrated service-worker behavior. This intentionally favors serial handoffs over merge-conflict risk.

> **File-map cross-check:** Implementation file paths in the tasks intentionally extend the approach.md File Map with narrowly scoped tooling and documentation surfaces required by task review: `package.json`, `eslint.config.cjs`, `devops/hooks/stamp-sw-cache.sh`, and the DocVault target selected by `/vault-update`. Core implementation paths remain `sw-router.js`, `tests/unit/sw-router.test.js`, `tests/playwright/sw-caching.spec.js`, and `sw.js`.

> **Skill-name discipline check:** Standard Closing Tasks preserve `/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, and `/sketch archive` verbatim.

> **Next:** stamp `approved:` in the frontmatter, then run `/sketch apply STRK-79`.

---

## Review Archive — tasks (2026-05-16)

_Reconciled by /sketch reconcile on 2026-05-16. Original reviewer marks preserved below for audit._

### Kimi

#### KIMI Review (2026-05-15)

### Verified

- **Live SW routing:** `sw.js:202-206` routes `api.staktrakr.com` / `api2.staktrakr.com` through `staleWhileRevalidate`; `sw.js:209` routes local-origin `/data/spot-history` through `staleWhileRevalidate`. Both branches will be updated by B.1 to call `classifyEndpoint` first.
- **Cache age inspection is absent:** `sw.js:253-282` — `cacheFirst`, `networkFirst`, `staleWhileRevalidate` never inspect cache-entry age. Version purge at `sw.js:140-152` is the only expiration mechanism.
- **v2 freshness contract exists above SW:** `api-health.js:61-69`, `api-health.js:82-90`, `api-health.js:101-110` all compute freshness as `(Date.now() - generated_at) / 1000 < stale_after`, matching the approach.md D-7 contract.
- **API host constants:** `js/constants.js:531-538` defines `V2_API_ENDPOINTS` with exactly two hosts (`api.staktrakr.com`, `api2.staktrakr.com`).
- **Spot paths:** `js/api.js:68-70` fetches `/spot/latest.json` via `_staktrakrFetch`; `js/api.js:142` fetches `/spot/{isoKey}/{yyyy}/{mm}/{dd}.json` for hourly backfill. Regex `/\/v2\/spot\/[^/]+\/\d{4}\/\d{2}\/\d{2}\.json$/` matches this shape.
- **Retail paths:** `js/retail.js:822-826` fetches per-slug `latest.json`, `intraday.json`, `history-7d.json`, `history-30d.json`, `history-90d.json`. Regexes in approach.md FAMILY_TABLE match these shapes.
- **Spot-history dual paths:** `js/api.js:2978` fetches `/spot-history-YYYY.json` from API root (after stripping `/v2`); `js/spot.js:649` falls back to `https://staktrakr.com/data/spot-history-YYYY.json`. The `annual-spot-history` family must catch **both** `/data/spot-history-YYYY.json` (local) and `/spot-history-YYYY.json` (API root).
- **Poller/export TTLs match table:** `devops/pollers/shared/api-export-v2.js:599-649` — retail latest 1800, intraday 1200, history-7d 3600, history-30d/90d 86400. `api-export-v2.js:936` — providers 86400.
- **`tests/unit/` does not exist:** The repo has `tests/playwright/` only. Task A.2 proposes creating a new Node unit-test harness.
- **`v2-utils.js` is ESM, not CJS:** `devops/pollers/shared/v2-utils.js:1-4` uses `export function`, not `module.exports`. The CJS export guard in `sw-router.js` is a new pattern, not a match to existing repo precedent.
- **Playwright SW precedent exists:** `tests/playwright/font-loading.spec.js:41-50` uses `test.use({ serviceWorkers: "allow" })` and waits for SW activation. `playwright.config.js:11` globally blocks service workers.
- **Approach.md stale text:** Tradeoff #4 at approach.md line 163 still references `self.__SW_LAST_STRATEGY` as a concern, but the chosen mechanism (module-scoped `lastStrategy` + `postMessage`) was already resolved in the approach review archive. This text should be cleaned up.
- **approach.md "nine" vs "ten" inconsistency:** FAMILY_TABLE has 10 rows, but approach.md says "all nine families" (line 17) and "covering all 9 families" (line 131).

### Top concerns

1. **`tests/unit/` does not exist and the repo has no Node test runner.** Task A.2 says to place `sw-router.test.js` under `tests/unit/`, but this directory does not exist and there is no `package.json` test script or `vitest`/`jest` config for Node unit tests. The acceptance says "A focused unit-test command passes" but does not specify what command. If the intent is `node tests/unit/sw-router.test.js`, the test file must use `require()` and `assert`, or a runner must be added. This is a hidden setup task.

2. **`annual-spot-history` regex is incomplete.** approach.md's regex `/\/data\/spot-history-\d{4}\.json$/` only catches the local-origin path (`data/spot-history-YYYY.json`). But `js/api.js:2978` fetches `/spot-history-YYYY.json` from the API root (after stripping `/v2` from `V2_API_ENDPOINTS`). The classifier must match **both** `/data/spot-history-YYYY.json` and `/spot-history-YYYY.json`, or the API-root variant will fall through to unclassified SWR behavior.

3. **`v2-utils.js` is incorrectly cited as CJS precedent.** approach.md D-1 says `sw-router.js` "Matches `v2-utils.js` precedent" for CJS/Node-test, but `v2-utils.js` is pure ESM (`export function`). The CJS export guard is fine on its own, but claiming precedent from a file that does not use that pattern is misleading and may confuse a future reviewer looking for a matching pattern.

### Unverified assumptions

- That `importScripts("sw-router.js")` from the repo root works correctly in both `file://` and GitHub Pages (`https://staktrakr.com/`) scopes. Since both `sw.js` and `sw-router.js` are at root, this is likely correct but was not tested.
- That the `spot-history-daily` family regex is ordered correctly in `FAMILY_TABLE` so it does not collide with `spot-latest` (`/v2/spot/latest.json`). `spot-latest` must be tested before `spot-history-daily` or the daily regex will incorrectly classify `latest.json`.
- That `sw-router.js` with a CJS export guard can be `require()`'d in Node without issues even though it contains no `require` calls itself. This is standard but was not executed.
- That the `annual-spot-history` API-root path (`/spot-history-YYYY.json` without `/data/`) is served by the same `api.staktrakr.com` host as the v2 endpoints. `api.js:2978` uses `_staktrakrFetch` with base URLs derived from `V2_API_ENDPOINTS` by stripping `/v2`, so the host is `api.staktrakr.com` or `api2.staktrakr.com`. The classifier's allowed-host set covers this.
- That the Playwright test at C.1 can reliably serialize assertions using `postMessage` without race conditions. The approach.md notes the race risk but the mitigation (serialize requests) depends on test implementation discipline.
- That the `stamp-sw-cache` pre-commit hook will correctly handle the new `sw-router.js` file. Since it's not in `CORE_ASSETS`, the hook should ignore it, but if it scans all `.js` files at root it might trigger unexpectedly.
- That the existing `staleWhileRevalidate` behavior for unclassified API requests (e.g., `/v2/retail/{slug}/{YYYY}/{MM}.json`, the monthly archive endpoint at `api-export-v2.js:659`) is acceptable. The monthly archive is not in the FAMILY_TABLE and will fall through to SWR.
- That `market-data.js` single-homing on `api.staktrakr.com` (not iterating `V2_API_ENDPOINTS`) is an acceptable pre-existing limitation that does not need to be fixed in this sketch. This is documented in approach.md as out-of-scope, but it means the SW classifier's `api2` handling will only benefit `api.js` and `retail.js` callers, not `market-data.js`.
- That no other code in the repo reads `Response.url` or `Response.type` from cached classified responses. approach.md Risk Notes claim this was verified by GEMINI in discovery, but the discovery.md file was not reviewed in this session.

---

### Opus

#### OPUS Review (2026-05-15)

### Verified

- **ESLint surface gap:** `eslint.config.cjs` `files` glob is `["js/**/*.js", "sw.js"]` only. The new `sw-router.js` (repo root) and `tests/unit/sw-router.test.js` are outside the lint surface. CLOSE-1's `npm run lint` will silently skip them.
- **`tests/` layout:** `ls tests/` returns only `fixtures`, `playwright`, `runbook`. `tests/unit/` does not exist (confirms KIMI). No `node:test`/`vitest` config in `package.json` scripts; only `lint`, `test` (Playwright), and `test:offline` are defined.
- **`stamp-sw-cache.sh` CACHED_PATTERNS:** `devops/hooks/stamp-sw-cache.sh:26-35` lists `css/`, `fonts/`, `js/`, `index.html`, `data/`, `images/`, `manifest.json`, `sw.js`. **`sw-router.js` is NOT covered.** Combined with the fact that browsers only update SWs when the SW script bytes change, this means a future router-only patch will neither trigger SW re-installation nor roll the cache version.
- **AC-5 mapping:** Only tasks A.1 and A.2 reference AC-5, both producing code (the `FAMILY_TABLE` and its tests). No task creates or updates a DocVault foundation doc that records the per-family freshness window, age-gate mechanism, or precedence rule.
- **Cohort-A non-collision in `FAMILY_TABLE` regex ordering:** KIMI's "unverified assumption" about `spot-history-daily` colliding with `spot-latest` is unfounded — the daily regex `/\/v2\/spot\/[^/]+\/\d{4}\/\d{2}\/\d{2}\.json$/` requires the `/yyyy/mm/dd.json` suffix, which `latest.json` cannot match regardless of FAMILY_TABLE ordering. The two regexes are mutually exclusive; ordering is not load-bearing for this pair.
- **B-cohort sequencing is internally consistent:** B.5 edits `classifiedFetch` (added in B.4) to add the `lastStrategy` write site. The B.4 acceptance describes `classifiedFetch` behavior; B.5 layers instrumentation on top. No collision in the literal sense, but the B.4 spec should arguably be split or B.5 reframed as "extend `classifiedFetch` from B.4 with instrumentation" to make the dependency obvious to the implementer.

### Top concerns

1. **CLOSE-1's `npm run lint` silently ignores the new files.** ESLint globs cover `js/**/*.js` and `sw.js` only. Without widening the glob (`+ "sw-router.js"`, `+ "tests/unit/**/*.js"`) the lint pass is incomplete and a style/regression in `sw-router.js` can ship green. This is a one-line fix that belongs in the same PR; add a task or extend B.1 acceptance to require an ESLint glob update.

2. **No Node unit-test runner exists.** Tasks A.2 and C.2 say "focused unit-test command passes" with no command specified. The repo has no `vitest`/`jest` and no `test:unit` npm script. Pin the runner now (`node --test tests/unit/sw-router.test.js` using built-in `node:test` requires zero new deps and zero new dev-tooling), add a `test:unit` script to `package.json`, and have CLOSE-1 invoke it. Otherwise the "focused" command is unverifiable and a future maintainer may simply forget to run it.

3. **AC-5 has no owner.** AC-5 requires a "durable reference" of strategy/freshness per family across all in-scope hosts plus the mechanism and precedence rule. The tasks map AC-5 to A.1/A.2 (the code), but the AC's wording matches DocVault foundation-doc language (echoing the existing `data-pipelines.md` thresholds table). CLOSE-3's verification stamp will fail or be stamped weakly unless the team decides explicitly: "AC-5 is satisfied by `sw-router.js` `FAMILY_TABLE` + approach.md" — and stamps it that way — OR adds a doc-writing sub-task under CLOSE-5.

### Unverified assumptions

- That implementing all of cohort B inside `sw.js` will not exceed any pre-existing complexity/length thresholds enforced by Codacy or the `.codacy.yml` exclusion file. The current `sw.js` is ~310 lines after the version-purge logic; adding three new helpers + a message listener could push it through a threshold that triggers CLOSE-2 noise.
- That the `node:test` runner (or any test-runner choice) will be acceptable to the project's signing/pre-commit hooks. The repo uses signed commits and pre-commit hooks may need the new `tests/unit/` directory whitelisted.
- That `importScripts("sw-router.js")` resolves correctly when the SW is loaded under nested scopes (e.g., GitHub Pages under a subdirectory). StakTrakr's GitHub Pages config serves from root, so this is likely a non-issue, but should be smoke-tested in C.1.
- That CLOSE-7's `/pr-resolve` invocation will reach the same conclusion as B.5's acceptance about `__SW_LAST_STRATEGY` (it forbids the global), in case a code-review bot flags the module-scoped variable as "missing export" or similar. The contract is explicit but bots regenerate findings on each push.
- That the patch worktree from CLOSE-0/`/sketch apply` will be the one used through CLOSE-8 without intermediate `cd`. Cohorts A/B/C assume a single worktree session; any context switch (especially for `/release patch` in CLOSE-4) needs `EnterWorktree` re-registration per the global gate.
- That removing the temporary `lastStrategy` instrumentation is genuinely out of scope for this patch (no closing task removes it). Approach.md tradeoff #4 suggested a follow-up to remove it, but no `/schedule` or follow-up issue task is in the plan.

### Resolution Summary

- Accepted: 8
  - `annual-spot-history` must match both `/data/spot-history-YYYY.json` and API-root `/spot-history-YYYY.json`.
  - Node unit tests use `node:test`; `package.json` owns `test:unit`.
  - `eslint.config.cjs` must include `sw-router.js` and `tests/unit/**/*.js`.
  - `devops/hooks/stamp-sw-cache.sh` must include `sw-router.js` in `CACHED_PATTERNS`; `sw-router.js` stays out of `CORE_ASSETS`.
  - `lastStrategy` test assertions are serialized within one page/service-worker lifetime.
  - Focused verification commands are pinned: `npm run test:unit` and `npx playwright test tests/playwright/sw-caching.spec.js`.
  - CLOSE-1 now runs lint, unit tests, and the full Playwright suite.
  - CLOSE-5 now requires a DocVault durable reference for AC-5.
- Rejected: 3
  - `spot-history-daily` does not collide with `spot-latest`; the regex suffixes are mutually exclusive.
  - `ROUTER_REV` is not required; `stamp-sw-cache.sh` coverage is the scoped service-worker update fix.
  - Third-party `staktrakr.com` remote spot-history remains out of SW classifier scope.
- Resolved with your input: 1
  - AC-5 durable reference uses option 1: `/vault-update` must write or update the DocVault reference rather than relying only on code plus sketch prose.
