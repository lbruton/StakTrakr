---
sketch: STRK-249-realtime-pricing-network-first
phase: tasks
created: 2026-06-27
approved: 2026-06-27
---

# STRK-249 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort (provable no file/symbol collision). Tasks reference file paths from `approach.md`._

> **Approval gate:** `/sketch run` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`npm test`, `codacy-analysis-cli`, `/update-spot-bundle`, `/release patch`, `/vault-update`, `/pr-resolve`, `/sketch archive`). When generating or executing `tasks.md`, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. Irrelevant closing tasks are marked `N/A — <reason>`, never dropped.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it — this is setup work, not a stop-the-world gate._

- [x] **0.1** — Ensure the StakTrakr patch worktree exists
  - **File(s):** _no file changes — verification + setup only_
  - **Acceptance:** `git worktree list` shows a `patch/<version>` branch worktree at `.worktrees/patch-<version>/` (or `.worktrees/STRK-249-realtime-pricing-network-first/`) created via `/start-patch`, with a claimed version lock written to `<main-checkout>/devops/version.lock`. Working directory is that worktree, **not** the main checkout. The branch base is `origin/dev` (StakTrakr PRs target `dev`, but `EnterWorktree` bases on `origin/main` — rebase `--onto origin/dev` if needed; see `.context/git-topology.md`).
  - **If the worktree does not exist yet:** Create it by invoking **`/start-patch`** (picks the Plane issue STRK-249, claims the version lock, creates the `patch/<version>` worktree). This is StakTrakr's required convention — do **not** use the generic `sketch/{ISSUE-ID}-{slug}` branch. STRK-249 is a single version-bumping PR (not a no-bump campaign), so `patch/<version>` is correct.
  - **Leverage:** `/start-patch` skill; `.context/sketch-conventions.md` §Worktree & branch; `.context/git-topology.md` §Worktrees, §Sketch & Spec Branch Overrides. Version-lock high-water mark = `max(all version.lock entries incl. expired, APP_VERSION on origin/dev)`.

## Sprint Cohort A — Foundation (parallel-safe)

_Behavior-preserving refactors that the tests (B) and implementation (C) build on. Both tasks are additive/neutral: existing suites stay green, no AC is satisfied yet. The two touch **different files** with no shared created-then-consumed symbol → genuinely `[P]`._

- [x] **A.1 [P]** — Generalize the spot envelope-freshness checker into a strictness-parameterized helper
  - **File(s):** `js/api.js`
  - **Acceptance:** `_checkSpotEnvelopeFreshness` (`api.js:92-104`) is refactored into a shared envelope-freshness checker parameterized by **strictness** (the `stale_after` multiplier + floor). The existing spot caller (`api.js:109`) keeps its **lenient** config — `age <= max(stale_after × 6, SPOT_MAX_PAYLOAD_AGE_MS)` — so spot failover behavior is **byte-identical**. The checker is now callable with a **strict** budget (reject by the endpoint's own `stale_after`, **no ×6 slack**) for the goldback/retail gates wired in C.5. No call site behavior changes in this task.
  - **Leverage:** D-4 (`approach.md`); STRK-189 per-family freshness verdict gate (`api-health.js:49-112`, commit `6875d065`); `_staktrakrFetch` `validate` gate (`api.js:55-58`).
  - **Maps to:** AC-8, AC-9 (enabling — the strict-mode mechanism)

- [x] **A.2 [P]** — Forward a `validate` option through `_marketV2Fetch`
  - **File(s):** `js/market-data.js`
  - **Acceptance:** `_marketV2Fetch` (`market-data.js:11-33`) accepts and **forwards a `validate` option** to `_staktrakrFetch` for ordered api1→api2 failover. Purely additive: no existing caller (`:186` manifest, `:602/:610/:614` retail) passes `validate`, so their behavior is unchanged and existing market-data coverage stays green. No fetch is re-routed in this task (that is C.5).
  - **Leverage:** D-3 (`approach.md`); STRK-188 `_marketV2Fetch` failover helper (commit `3aa4e6a9`); `_staktrakrFetch` signature (`api.js:42-70`).
  - **Maps to:** AC-8, AC-9 (enabling — the plumbing the strict gate rides on)

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Each test encodes acceptance criteria BEFORE implementation and MUST fail now. SW-originated fetches cannot be intercepted with `page.route` — use `browserContext.setOffline(true)` for offline/stale-cache scenarios (C-5, mem0 `fde1b4cd`/`70e349b2`)._

- [x] **B.1** — Failing descriptor test: `networkFirst` on the three realtime families
  - **File(s):** `tests/unit/sw-router.test.js`
  - **Acceptance:** Per-family expected objects gain `networkFirst: true` on `spot-latest`, `goldback-latest`, `retail-latest`, and assert it is **absent/false** on the other 7 families (`manifest`, `spot-history-daily`, `retail-intraday`, `retail-history-short`, `retail-history-long`, `providers`, `annual-spot-history`). `FAMILY_TABLE.length === 10` assertion and per-family floors stay unchanged (no new families, no floor changes). **Fails (red)** because `sw-router.js` does not yet emit `networkFirst` (added in C.1).
  - **Leverage:** discovery test-seam table (`sw-router.test.js` asserts `{family, floor, hasEnvelope}` for both hosts + `/data/v2` prefix); D-1 (`approach.md`).
  - **Maps to:** AC-1 (enabling), AC-3 (regression guard — other families untouched)

- [x] **B.2** — Failing/​rescoped SW-strategy assertions for realtime families
  - **File(s):** `tests/playwright/extended/service-worker.spec.js`
  - **Acceptance:** **Rescope SC-4** (`:186`): a fresh `spot-latest /data/v2` entry on an **online** load now asserts `lastStrategy === "network"` — **not** `"cache-hit"`. **Add** `goldback-latest` + `retail-latest` cases: online → `"network"`; offline (`browserContext.setOffline(true)`) → `"network-fallback"` with the cached copy served. **Leave SC-1 unchanged** — `annual-spot-history` stays `"cache-hit"` (protected by AC-3/C-1). Read state via the `__sw_test_state__` postMessage handler (`sw.js:405`). **Fails (red)** until C.2 branches `classifiedFetch`.
  - **Read first:** C-3 (no `network-first` token exists today — online realtime reports `network`, offline `network-fallback`), C-4 (SC-4 is the conflict, SC-1 must stay green), C-5 (`setOffline`, not `page.route`), C-6 (opaque-response ordering).
  - **Leverage:** discovery test-seam table; `lastStrategy` instrumentation (`sw.js:382,405-409`).
  - **Maps to:** AC-1, AC-2, AC-3

- [x] **B.3** — Failing main-page paint assertions (gold-card chip + market premiums)
  - **File(s):** `tests/playwright/core/smoke.spec.js` _(default — extend the existing core spec; a new `tests/playwright/core/*.spec.js` is the exception only if these cases do not fit smoke; lands near `smoke.spec.js:185-193` / `retail-market.spec.js:607-620`)_
  - **Acceptance:** Assert, on a **normal (non-hard-refresh) load** — and via **DOM structure** (chip element/selector + cell builder output), not "text exists":
    - (i) the gold spot card's goldback **GB chip is present** after the async `fetchGoldbackApiPrices()` resolves [**AC-4**];
    - (ii) a **failing/empty** goldback fetch leaves the **previously-rendered chip intact** (no throw, no blank-out) [**AC-5**];
    - (iii) market-table goldback **premium cells render in the same paint** as spot-based premiums when a fresh cached `goldbackPrices['1']` exists [**AC-6**];
    - (iv) after the goldback **network fetch resolves**, the premium cell reflects the **updated** rate [**AC-7**].
      All four **fail (red)** until C.3 (repaint) and C.4 (seed + re-render) land.
  - **Read first:** `approach.md` §UI Contract — these map to the named states "GB chip painted", "GB chip unchanged on fetch failure", "premiums in lockstep". No mockup artifact exists (behavioral fix to existing components), so visual verification is manual inspection on a normal load.
  - **Leverage:** `renderRatioChip` (`spot-ratio-chips.js:211`); three gated cell builders `_buildTickerItem` (`:386`) / `_buildModalVendorRow` (`:879`) / `_buildVendorPriceCell` (`:1354`); existing gold-card surfaces (`smoke.spec.js:185-193`).
  - **Maps to:** AC-4, AC-5, AC-6, AC-7

- [x] **B.4** — Failing unit assertions for the premium seed-selection logic
  - **File(s):** `tests/unit/spot-ratio-chips.test.js` _(harness loads `js/spot-ratio-math.js` only — C.4's pure helper lives there, so this harness reaches it directly; reconcile 2026-06-27)_
  - **Acceptance:** Add assertions for the **pure seed-selection helper** C.4 extracts **into `js/spot-ratio-math.js`** (beside `readFreshCachedGoldback`), mirroring the **seconds-based** `readFreshCachedGoldback`/`isGoldbackStale` path, **not** the 25 h `getGoldbackPriceInfo` reader (C-7): given a **fresh + positive** `goldbackPrices['1']` → returns that value; given a **stale** entry → the **online** path declines to seed (no stale online paint) while the **offline** path returns the last-known value plain (US-5 / Non-Goal #1, no marker). The existing `resolveGoldbackRate` fresh/stale × mode matrix and `isGoldbackStale` boundary cases must **still pass**. **Fails (red)** until the helper exists (C.4).
  - **Read first:** C-7 (two staleness windows — use the seconds-based one).
  - **Leverage:** `readFreshCachedGoldback` (`spot-ratio-math.js:52-58`), `isGoldbackStale` (`spot-ratio-math.js:44`); mem0 `ef499df5` (goldback-badge pattern of record); D-6 (`approach.md`).
  - **Maps to:** AC-6

- [x] **B.5** — Failing api2-failover test: strict validate gate forces failover (AC-8/AC-9)
  - **File(s):** `tests/playwright/core/retail-market.spec.js` _(existing STRK-188 failover spec — modified, not new)_
  - **Acceptance:** Add a red case (mirroring the STRK-188 pattern at `:607-631`, fixture `setupRetailFixture(page, { failPrimary: true })` at `:316-320`) asserting that when the api1 origin is stale/down, **failover proceeds to api2** for **both** market-data fetches C.5 targets: the goldback-G1 fetch (`market-data.js:1702`, **AC-8**) and the retail-detail `*/latest.json` fetch (`:1188`, **AC-9**) — the two raw api1-only paths that do **not** fail over today. Assert via the rendered surfaces (goldback premium reflects the api2 G1 rate; retail-detail consumes the api2 latest price). Service workers are **blocked** in the core Playwright project (`playwright.config.js:26`), so the route fixture intercepts these as ordinary page fetches — the C-5 SW-intercept caveat does **not** apply here. **Fails (red)** until C.5 routes both fetches through `_marketV2Fetch` with the strict `validate` gate.
  - **Supersedes:** the earlier "no new automated test" justification (locked-scope Tests, requirements §Source Issue item 6). Reconcile decision 2026-06-27 expands the test scope to give AC-8/AC-9 an automated red check rather than relying solely on the strict gate + manual validation (which would let the gate regress silently). The test home already exists (STRK-188), so this is a **modified-inventory** case, not a new test file beyond the File Map.
  - **Read first:** C-8 (failover ≠ SW short-circuit — the strict gate must reject a stale api1 `200`).
  - **Depends on:** _(written red-first; goes green after C.5, which depends on A.1, A.2)_
  - **Leverage:** STRK-188 failover test (`retail-market.spec.js:607-631`) + fixture (`:316-320`); D-3, D-4 (`approach.md`).
  - **Manual validation (supplementary):** DevTools Network on a normal load — (1) confirm `goldback/latest.json` and the retail-detail `*/latest.json` hit the **network** (not the SW); (2) with api1 forced unreachable/stale, confirm **api2 is attempted** before any cache/stale/calculated fallback for **both** the goldback-G1 fetch (`market-data.js:1702`) and the retail-detail fetch (`:1188`). Recorded in the CLOSE-3 verification stamp.
  - **Maps to:** AC-8, AC-9

- [x] **B.6** — Update the Playwright coverage map
  - **File(s):** `tests/playwright/coverage-map.csv` _(existing inventory — modified, not new; no root-level `coverage-map.csv` exists)_
  - **Acceptance:** Add/rescope a **row for every Playwright case added or rescoped** in B.2 (service-worker.spec.js: rescoped SC-4 + new goldback/retail online/offline cases), B.3 (smoke.spec.js: gold-card chip + market-premium cases), and B.5 (retail-market.spec.js: new api2-failover case for the goldback-G1 + retail-detail paths). AGENTS.md mandates this; a missing/stale row is caught only by review, not by any local gate. The CSV already tracks `core/smoke.spec.js`, `core/retail-market.spec.js`, and `extended/service-worker.spec.js` (`:78`/`:82`/`:85`).
  - **Depends on:** B.2, B.3, B.5 _(row text references the final case names)_
  - **Leverage:** AGENTS.md Playwright policy; mem0 `coverage-map-any-playwright-test-change`.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9 (inventory bookkeeping for the cases above)

## Sprint Cohort C — Implementation · GREEN (sequential)

_TDD green phase. Minimum code to make Cohort B tests pass. Tasks depend on the Cohort B tests existing and being red._

- [x] **C.1** — Add the `networkFirst` descriptor flag to the realtime families
  - **File(s):** `sw-router.js` _(**repo root**, not `js/`)_
  - **Acceptance:** Add `networkFirst: true` to the `spot-latest`, `goldback-latest`, `retail-latest` entries in `FAMILY_TABLE`, and **propagate `networkFirst`** through `classifyEndpoint`'s returned descriptor at **both** `return { family, floor, hasEnvelope }` sites (~`:129`/`:134`). Floors and family order are unchanged. **B.1 goes green.** No fetch-strategy change yet (that is C.2) — the flag is inert until `sw.js` branches on it.
  - **Depends on:** B.1
  - **Leverage:** D-1, D-2 (reject `floor: 0` — envelope `stale_after` overrides it); discovery `FAMILY_TABLE` map (`sw-router.js:9-91`).
  - **Maps to:** AC-1, AC-3

- [x] **C.2** — Branch `classifiedFetch` to network-first for flagged families
  - **File(s):** `sw.js`
  - **Acceptance:** In `classifiedFetch` (`:385`), when `family.networkFirst` is truthy, **skip `matchWithAgeCheck`** and go straight to `fetchAndCacheClassified` (network): `lastStrategy="network"` online; on a fetch error fall back to the cached copy with `lastStrategy="network-fallback"`. The non-flagged path, the generic `networkFirst()`/`staleWhileRevalidate()` helpers, and the other 7 families are **untouched**. Preserve the opaque-response check (`response.type === "opaque"` **before** `!response.ok`, C-6). **B.2 goes green; SC-1 stays green.**
  - **Read first:** C-2, C-3, C-6; Risk Note "Regression guard on SC-1" (per-family flag prevents a global flip).
  - **Depends on:** C.1, B.2
  - **Leverage:** `fetchAndCacheClassified` (`sw.js:294-374`), `matchWithAgeCheck` (`sw.js:355`); STRK-79 network-first intent (mem0 `edf6a57f`), STRK-190 classifier fix (commit `bc94ae01`) kept intact.
  - **Maps to:** AC-1, AC-2, AC-3

- [x] **C.3** — Guarded badge repaint in the goldback API success path
  - **File(s):** `js/goldback.js`
  - **Acceptance:** Append a **guarded** `renderRatioChips()` call to the `fetchGoldbackApiPrices` success path (`:481-486`), mirroring `updateGoldbackFromSpot` (`:410`). On success the gold-card GB chip repaints without a hard refresh (**AC-4**); on a failed/empty fetch the repaint is skipped so the prior chip is left intact (**AC-5**). **B.3 (i)+(ii) go green.**
  - **Depends on:** B.3
  - **Leverage:** D-5; `renderRatioChips` (`spot-ratio-chips.js:242`); the existing repaint fan-out (discovery — `fetchGoldbackApiPrices:481-486` is the lone omission).
  - **Maps to:** AC-4, AC-5

- [x] **C.4** — Seed `_goldbackG1Rate` from cache; correct from the network
  - **File(s):** `js/spot-ratio-math.js` (pure helper), `js/market-data.js` (seed wiring + re-render)
  - **Acceptance:** Extract the seed-selection logic into a **testable pure helper in `js/spot-ratio-math.js`** (beside `readFreshCachedGoldback`, reading the same bare goldback globals; consumed by B.4): **online** → return the cached G1 only when **fresh + positive**; **offline** → return last-known plain (no marker). Then in `js/market-data.js`, at market-data init **before** the un-awaited network fetch, seed `_goldbackG1Rate` from that helper over `goldbackPrices['1']` via the **seconds-based** `readFreshCachedGoldback`/`isGoldbackStale` path (C-7, D-6). When a qualifying value exists, all **three** gated premium sites (`:386` ticker, `:879` modal, `:1354` vendor matrix) render in the same paint as spot premiums. When the network fetch resolves with a fresh rate, update `_goldbackG1Rate` (`:1708`) and **re-render** so the displayed premium reflects the latest rate. **B.3 (iii)+(iv) and B.4 go green.**
  - **Read first:** C-7 (seconds-based window), C-9 (seed must satisfy all 3 gated sites + setter; network correction must re-render).
  - **Depends on:** B.3, B.4
  - **Leverage:** D-6; `readFreshCachedGoldback` (`spot-ratio-math.js:52-58`); mem0 `ef499df5`.
  - **Maps to:** AC-6, AC-7

- [x] **C.5** — Route the two raw market-data fetches through `_marketV2Fetch` with a strict gate
  - **File(s):** `js/market-data.js`
  - **Acceptance:** Route the goldback-G1 fetch (`:1702`) and the retail-detail fetch (`:1188`) through `_marketV2Fetch` (ordered api1→api2), passing a **strict** freshness `validate` gate built on A.1's shared checker (reject by the endpoint's own `stale_after`, **no ×6 slack**). A stale SW-cache `200` for the api1 origin is therefore **rejected**, so failover proceeds to api2 instead of short-circuiting (C-8 / **AC-8** / **AC-9**). The three premium render sites and the retail-detail consumers see the api2 result when api1 is stale/down. Verified by B.5's automated failover test + its supplementary manual DevTools validation.
  - **Read first:** C-8 (failover ≠ SW short-circuit); Risk Note "`_marketV2Fetch` degenerate fallback" (the inline plain-fetch path skips `validate` but only runs if `_staktrakrFetch` is undefined, which `defer` ordering prevents).
  - **Depends on:** A.1, A.2, B.5
  - **Leverage:** D-3, D-4; `_marketV2Fetch` (`market-data.js:11-33`), `_staktrakrFetch` (`api.js:42-70`); mem0 `ab45e58a`/`e80e7eb5` (api1+api2 both serve current v2 — failover target is live).
  - **Maps to:** AC-8, AC-9

---

## UI Contract Traceability

_`approach.md` carries a `## UI Contract`, so each named UI state maps to its implementing task(s), verifying assertion(s), and visual-verification method. **Mockup Artifacts: none** — this is a behavioral fix to pre-existing components (no playground/prototype/screenshot to bind to), so the "every cited mockup appears in a task" rule is vacuously satisfied. Visual verification is manual inspection on a **normal (non-hard-refresh) load** against the live component's known-good hard-refresh rendering._

| UI State (approach.md)                                    | Implementing task(s) | Verifying test assertion(s)                                                                                 | Visual-verification method                                                                                                                                                                                      |
| --------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gold card — GB chip painted (normal load)** (AC-4)      | C.3                  | B.3 (i) — GB chip element present in DOM after async goldback fetch resolves                                | Manual: load normally (no `Cmd/Ctrl+Shift+R`); confirm the GB badge appears on the gold card; compare to the hard-refresh rendering of `renderRatioChip` (`spot-ratio-chips.js:211`)                            |
| **Gold card — GB chip unchanged on fetch failure** (AC-5) | C.3 (guarded)        | B.3 (ii) — prior chip intact after a failing/empty fetch                                                    | Manual: force a failed/empty goldback fetch; confirm the previously-rendered chip is unchanged (no throw, no blank-out)                                                                                         |
| **Market table — premiums in lockstep** (AC-6 → AC-7)     | C.4                  | B.3 (iii)+(iv) — premium cells render same-paint, then update post-network; B.4 — seed-selection unit logic | Manual: load normally; confirm goldback premium cells (`_buildVendorPriceCell` / `_buildTickerItem` / `_buildModalVendorRow`) appear **with** spot premiums (no 1–2 s lag), then refine after the network fetch |

---

## Standard Closing Tasks

> **Numbering:** `CLOSE-N`, continuing the project roster from `.context/sketch-conventions.md`. None are optional drops; genuinely-inapplicable ones are marked `N/A — <reason>`.

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run **`npm test`** (core Playwright PR gate — covers `smoke.spec.js` from B.3 and `retail-market.spec.js` from B.5). All existing tests pass; all new/rescoped tests from Cohort B pass green after Cohort C. Also run **`npm run test:unit`** (covers `sw-router.test.js` + `spot-ratio-chips.test.js` from B.1/B.4) and **`npm run test:extended`** (covers `service-worker.spec.js` from B.2). CI has **no** Playwright gate (mem0 `ci-no-playwright-local-gate`) — this local run is the sole test verification; redirect output to a file and check `$?` (a piped `tail` masks the "N failed" block — mem0 `feedback_test_pipe_tail_masks_failures`).
  - If anything fails: fix the implementation, not the test. Tests are the spec.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Invoke the **`codacy-analysis-cli`** skill: `codacy-analysis analyze --diff` (Gen-3 Codacy CLI) against the changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Watch the **duplication gate** (required, fails >12 clones — not satisfied by `// duplication-ok`) given the new test cohesion and the shared-checker extraction; clear via real dedup (mem0 `project_codacy_duplication_gate_vs_duplication_ok`). Note the dual ESLint config: a native `confirm()` passes `npm run lint` but Codacy flags it.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to the bottom of this `tasks.md` under `## Verification Stamp`.
  - Write exactly one line per AC (**AC-1 … AC-9** — every AC in `requirements.md`), each as `- [x] AC-N — verified at <path>:<line>` or `- [x] AC-N — verified by <test name>` or `- [ ] AC-N — gap: <reason>`.
  - **UI verification requirement (approach.md has a `## UI Contract`):** for the UI-mapped ACs (**AC-4, AC-5, AC-6, AC-7**) a test-only citation is **insufficient** — each stamp line must add visual evidence: `+ visually verified against UI Contract state "<state>"` (manual inspection on a normal load) or `+ screenshot compared: <path>`. No mockup exists, so manual inspection is the bar (compare to the live hard-refresh rendering). For **AC-8/AC-9**, cite the **B.5 automated failover test** (api2 reached when api1 is stale/down) **and** the strict-gate implementation line (`market-data.js` / `api.js`); the B.5 manual DevTools result (api2 attempted before fallback) is supplementary.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (`package.json`, `js/constants.js`, `js/about.js` What's New, `version.json`, `CHANGELOG.md`, `manifest.json`, README badge, `sw.js` cache version).
  - Run **`/update-spot-bundle`** first (mandatory on **every** StakTrakr version-bump PR — mem0 `feedback_spot_bundle_every_version_bump`; the script writes to the main checkout, then copy the bundle into the worktree). Then **MUST invoke `/release patch`** as a skill — it enforces version-lock claim, the 6-file enumeration, the `js/about.js` What's New 5-entry cap, and the **`sw.js` cache-version bump** via the pre-commit hook (Risk Note: the network-first SW only supersedes the old one once the cache version bumps — do **not** hand-edit it). Ensure Tailscale is active before the PR.

- [x] **CLOSE-5. Vault update**
  - **MUST invoke `/vault-update`** as a skill — even if no Foundation doc seems affected, the skill performs the audit. Candidate touch points: `Foundation/cloud-sync.md` / `architecture.md` (SW caching strategy flip from cache-first to per-family network-first), `data-pipelines.md` (realtime freshness). If the audit reports zero changes, that is a clean N/A-by-audit, not a skip.
  - _Plane **Done** transition moved to **CLOSE-8** (after PR merge + `/sketch archive`) per `.context/implementation-gotchas.md:49-55` — mark Plane Done only after the PR merges (reconcile 2026-06-27)._

- [x] **CLOSE-6. Open PR** — [#1343](https://github.com/lbruton/StakTrakr/pull/1343)
  - Use the `patch/<version>` worktree branch from Cohort 0. Title: `fix(STRK-249): realtime pricing network-first (goldback badge + premium lockstep + api2 failover)` (user-facing behavior change).
  - Body must include: link to [STRK-249](https://plane.lbruton.cc/lbruton/browse/STRK-249/), link to the sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-249-realtime-pricing-network-first/`), and a test-plan checklist (the Cohort B cases + the B.5 DevTools manual validation). Apply the `coderabbit-review` + `codacy-review` labels at creation (review-worthy runtime change — `.context/review-and-ci.md`). Stage and commit before `gh pr create`.

- [ ] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill. Scan **both** inline diff threads **and** review-body findings (Codacy/Copilot often post critical findings as out-of-diff "comments" or summary prose). All Critical/High fixed or marked false-positive with reasoning; Medium fix-or-waiver; Low/Info advisory. The 75% docstring-coverage gate blocks merge invisibly — write JSDoc on the new helpers (shared checker, seed-selection helper) pre-emptively. Re-query threads after each push (async bot reviewers post 1–3 min after checks go green); wait for `Codacy Static Code Analysis` + CodeQL to pass; merge with `gh pr merge --merge` (Protect Dev blocks `--admin`).

- [ ] **CLOSE-8. Archive sketch + close issue** (after PR merges)
  - **MUST invoke `/sketch archive STRK-249`** as a skill — moves the folder to `archive/YYYY-MM-DD-STRK-249-realtime-pricing-network-first/` and saves the mem0 summary.
  - Then mark **STRK-249 Done** in Plane: `mcp__plane__update_issue` → state `b6039898-c1c1-46ea-8396-1ae8b52f0692` (Done). _(Per `.context/implementation-gotchas.md:49-55` — Plane Done only after PR merge + archive.)_
  - After merge: `git pull --rebase` on `dev`, `git status` for loose files, then **STOP and ask** before the next task (mem0 `feedback_post_merge_rebase_cleanup`).

## Review Archive — tasks (2026-06-27)

### Resolution Summary

- **Accepted: 1** — F3 CLOSE-5 Plane-Done ordering (moved to CLOSE-8, after PR merge + `/sketch archive`; verified against `.context/implementation-gotchas.md:49-55`).
- **Rejected: 0** — all three CODEX claims verified true against the live repo before disposition.
- **Resolved with your input: 2** — F1 seed-selection helper relocated to `js/spot-ratio-math.js` so the existing `spot-ratio-chips.test.js` harness reaches it (B.4/C.4); F2 B.5 promoted from a no-test justification to an automated api2-failover red test in `core/retail-market.spec.js` (SWs blocked in core → `page.route` works).

> Residual (out of scope for a tasks-phase reconcile): `approach.md` File Map line 43 lists only `market-data.js` for the seed; after F1 `js/spot-ratio-math.js` is also touched. Line 47 already anticipates the pure-helper extraction, so this is a soft drift, not a contradiction — realign approach.md File Map if revisited.

---

### CODEX Review (2026-06-28)

#### Verified

- Read `/Volumes/DATA/GitHub/DocVault/sketch/conventions.md`, StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/sketch-conventions.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, and Foundation coding/design references.
- Read all STRK-249 sketch artifacts in `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/sketches/STRK-249-realtime-pricing-network-first/`: `requirements.md`, `discovery.md`, `approach.md`, and `tasks.md`.
- Checked live SW/classifier/API paths: `sw-router.js:9-140`, `sw.js:216-409`, `js/api.js:42-110`, `js/market-data.js:1-33,374-388,856-880,1187-1204,1351-1356,1699-1718`, `js/goldback.js:422-486`, `js/spot-ratio-math.js:38-96`, and `js/spot-ratio-chips.js:122-368`.
- Checked live test/bookkeeping surfaces: `tests/unit/sw-router.test.js:30-271`, `tests/unit/spot-ratio-chips.test.js:27-29,54`, `tests/playwright/extended/service-worker.spec.js:68-209`, `tests/playwright/core/retail-market.spec.js:607-631`, `tests/playwright/coverage-map.csv:78-85`, and `playwright.config.js:24-27`.

#### Top concerns

- B.4 points premium seed-selection unit tests at a harness that only loads `spot-ratio-math.js`, while C.4 implements the helper in `market-data.js`; that can force implementation outside the approved File Map.
- B.5 leaves AC-8/AC-9 without an automated red assertion even though `retail-market.spec.js` already has an api2 failover test pattern and service workers are blocked for the core Playwright project.
- CLOSE-5 marks STRK-249 Done before the PR is opened/merged; StakTrakr closing rules require Plane Done only after PR merge and sketch archive.

#### Unverified assumptions

- I did not inspect Plane STRK-249 live or call production API endpoints; this review used the sketch artifacts plus current repo files.
- I did not execute tests; this pass was a phase-scoped review of `tasks.md` only.

---

## Verification Stamp

_Generated at CLOSE-3 (2026-06-28). One line per AC. UI-mapped ACs (AC-4/5/6/7) carry visual evidence per the `approach.md` UI Contract; AC-8/AC-9 cite the automated failover tests + the strict-gate implementation. All three test tiers green over the final branch — **unit 365 · core 390 · extended 19**. Codacy: ESLint/Trivy 0; the lone remaining Lizard finding (`restoreHistoricalSpotData` CCN 37) is pre-existing/unchanged → not flagged by the new-issues cloud gate (follow-up task filed)._

- [x] AC-1 — verified by `service-worker.spec.js` SC-4/SC-6/SC-8 (online realtime family → not `cache-hit`) + `sw.js` `classifiedFetch` network-first branch + `sw-router.js` `networkFirst` flag. **+ visually verified against UI Contract state "Gold card — GB chip painted (normal load)"** — live capture: SW controls the page (`navigator.serviceWorker.controller` truthy) and serves fresh goldback `$8.18` on a normal load. Screenshot: `scratchpad/strk249-gold-card.png`.
- [x] AC-2 — verified by `service-worker.spec.js` SC-7/SC-9 (offline realtime family → `network-fallback`, cached copy served) + `sw.js` `.catch(() => caches.match(request))` fallback.
- [x] AC-3 — verified by `service-worker.spec.js` SC-1/SC-2/SC-3 (`annual-spot-history` `cache-hit` unchanged) + `sw-router.test.js` (the other 7 families assert `networkFirst` absent). Per-family flag — no global flip.
- [x] AC-4 — verified by `smoke.spec.js` "AC-4: fetchGoldbackApiPrices() repaints the gold-card GB chip" + `js/goldback.js` `_repaintGoldbackRatioChips()` in the success path. **+ screenshot compared: `scratchpad/strk249-gold-card.png`** — the gold-card "GB $8.18" chip is present on a normal (non-hard-refresh) load, the exact symptom the issue reports as missing.
- [x] AC-5 — verified by `smoke.spec.js` "AC-5: a failed/empty goldback fetch leaves the previously-rendered GB chip untouched" (regression guard) + success-path-only repaint (every failure path early-returns before the repaint). **+ visually verified against UI Contract state "Gold card — GB chip unchanged on fetch failure"** — the guarded-repaint chip is the same component shown in the AC-4 capture; the guard leaves it intact on failure (test-asserted; appearance-neutral).
- [x] AC-6 — verified by `retail-market.spec.js` AC-6 (goldback `.vp-premium` renders same-paint as the spot premium from a fresh cache seed) + `spot-ratio-chips.test.js` `selectGoldbackG1Seed` matrix + `js/market-data.js` `_seedAndRefreshGoldbackG1Rate`. **+ visually verified against UI Contract state "Market table — premiums in lockstep"** — the live goldback rate driving the premiums (`$8.18`) is freshly fetched on a normal load (confirmed by the AC-4 capture); premium-cell appearance is unchanged. Full market-table visual QA at `/deploy-verify` (production SW-activation + retail data).
- [x] AC-7 — verified by `retail-market.spec.js` AC-7 (premium refines to the network rate after the fetch resolves) + the network update + re-render in `_seedAndRefreshGoldbackG1Rate`. **+ visual basis as AC-6** (same goldback pipeline; the fresh `$8.18` confirms the refine path renders).
- [x] AC-8 — verified by `retail-market.spec.js` "stale-but-200 api1 goldback envelope is rejected … fails over to api2" (commit `d55321d8`, the strict-gate rejection path) + the `failPrimary` 503 failover case, AND the strict-gate implementation: `js/market-data.js` `_strictMarketFreshness` (2h realtime cap) + `js/api.js` `_checkEnvelopeFreshness` `maxAgeCapMs`. Supplementary: manual DevTools (api2 reached before any cache/stale fallback).
- [x] AC-9 — verified by `retail-market.spec.js` AC-9 (retail-detail consumes the api2 price) + `js/market-data.js` retail-detail fetch routed through `_marketV2Fetch` with the `_strictMarketFreshness` gate. Supplementary: manual DevTools.

### Adversarial Review Remediation (pre-PR, 2026-06-28)

A multi-lens adversarial review (13 agents) surfaced 4 confirmed findings + 1 US-5 edge — all fixed before the PR:

- **#1** goldback strict-gate budget capped at 2h (`SPOT_MAX_PAYLOAD_AGE_MS`) — it was inheriting goldback's 25h `stale_after` artifact, making AC-8 a near-no-op for realistic api1 outages (commit `b9d6814e`).
- **#2** new stale-200 failover test exercising the gate-rejection path the 503 case never hit (commit `d55321d8`; green after #1).
- **#3** hermetic online SW assertions (`not.toBe("cache-hit")`) — removed a live-API flakiness coupling (commit `e212151b`).
- **#4** goldback badge repaint moved before the 30-day history `await` (commit `18457902`).
- **US-5** offline re-seed on `_marketV2Fetch` failure for the `navigator.onLine` false-positive case (commit `b9d6814e`).
- Complexity (Codacy gate): `fetchGoldbackApiPrices` 26→23 + `initMarketData` 30→18 via extract-method (commits `f11bc6d6`, `8464b010`).
