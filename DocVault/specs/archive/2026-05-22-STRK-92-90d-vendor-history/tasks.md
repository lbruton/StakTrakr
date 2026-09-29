---
sketch: STRK-92-90d-vendor-history
phase: tasks
created: 2026-05-21
approved: 2026-05-22
---
# STRK-92 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it — this is setup work, not a stop-the-world gate._

- [x] **0.1** — Ensure patch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a `.worktrees/patch-<VERSION>/` worktree with branch `patch/<VERSION>` based on `origin/dev`. Working directory is that worktree. Version lock claimed in `devops/version.lock`.
  - **If missing:** Invoke `/start-patch` skill (StakTrakr convention). Select STRK-92 as the target issue.
  - **Leverage:** `/start-patch` skill.

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Write tests that encode the acceptance criteria BEFORE implementation. Tests MUST fail at this point._

> **Note on Cohort A (Foundation):** No foundation/scaffolding cohort is needed for this sketch. All changes are modifications to existing files with existing functions — no new modules, helpers, or data structures to scaffold. Proceeding directly to tests.

- [x] **B.1** — Write endpoint-specific test fixtures and failing vendor-union assertion
  - **File(s):** `tests/playwright/retail/stak-582-market-survivors.spec.js`
  - **Acceptance:**
    1. `historyRows` split into three separate fixture objects: `history7dRows`, `history30dRows`, `history90dRows`.
    2. `history90dRows` includes a vendor-populated entry at `daysAgo(45)` (outside 30d window) that does NOT appear in `history30dRows`.
    3. `history90dRows` includes an overlapping-date entry (e.g., `daysAgo(15)`) with a departed vendor (`jmbullion`) that the same date's `history30dRows` entry lacks — i.e., `history30dRows` lists only `apmex` for that date while `history90dRows` lists both `apmex` and `jmbullion`.
    4. `responseForPath()` returns the appropriate fixture per endpoint path (`history-7d` → `history7dRows`, `history-30d` → `history30dRows`, `history-90d` → `history90dRows`).
    5. New test case: "90d-only row renders vendor prices" — selects "All" timeframe, asserts the `daysAgo(45)` row contains a vendor price value (not `—`). **Expected: PASS** (frontend already handles `vendors` from any mock — this is a regression guard for AC-4).
    6. New test case: "departed vendor retained via union merge" — selects "All" timeframe, asserts the overlapping `daysAgo(15)` row renders `jmbullion`'s price (the departed vendor) alongside `apmex` (the active vendor). **Expected: FAIL (RED)** — current all-or-nothing merge at `retail.js:928-934` discards the departed vendor.
    7. Existing test assertions at lines 385 (`not.toContainText(oldDate)`) and 389 (`toContainText(oldDate)`) reference the global `oldDate` and `historyRows` variables — migrate these to use the split fixtures (`history30dRows` / `history90dRows`) and update `responseForPath()` routing so they continue to exercise the "30d hides old row, All shows it" behavior.
  - **Leverage:** Existing `daysAgo()` helper, existing `VENDORS` array, existing `setupRetailFixture()` pattern.
  - **Maps to:** AC-2, AC-4

- [x] **B.2** — Test justification: publisher change (AC-1) has no Playwright-testable RED phase
  - **File(s):** _no file changes — review anchor only_
  - **Acceptance:** Documented below. Reviewers verify the justification is sound.
  - **Justification:** The publisher change (`api-export-v2.js`) runs server-side in the Fly.io poller. Playwright tests mock API responses at the route level — they don't exercise the publisher. No unit test infrastructure exists for the Node poller code in this project. The publisher change is verified by: (a) code inspection (same pipeline as 30d, proven), (b) post-deploy smoke check of published JSON shape, (c) CLOSE-1 regression guard on existing tests.
  - **Manual validation:** After deploy, fetch `https://api.staktrakr.com/v2/retail/{slug}/history-90d.json` and confirm entries older than 30 days include a `vendors` object with per-vendor `avg` values.
  - **Maps to:** AC-1, AC-3

## Sprint Cohort C — Implementation · GREEN (sequential)

_TDD green phase. Write the minimum code that makes all Cohort B tests pass._

- [x] **C.1 [P]** — Swap 90d publisher to daily-with-vendors pipeline
  - **File(s):** `devops/pollers/shared/api-export-v2.js`
  - **Acceptance:** Lines 642–649 replaced: `queryRetailRange()` + `buildRetailOhlcaBuckets("daily")` + `_vendorPrices` strip → `queryRetailDailyAggregates()` + `buildDailyWithVendors()`, matching the 30d pattern at lines 634–640. Only the start-date calculation changes (90 days instead of 30). The `writeV2File` call retains `86400` TTL. Comment updated to reflect "daily OHLCA with per-vendor breakdown".
  - **Leverage:** Copy the 30d pattern verbatim (lines 634–640) and change `30 * MS_PER_DAY` → `90 * MS_PER_DAY` and variable names.
  - **Maps to:** AC-1, AC-3

- [x] **C.2 [P]** — Implement vendor-set union in frontend dedup merge
  - **File(s):** `js/retail.js`
  - **Acceptance:** The dedup merge at lines 928–934 unions vendor sets instead of all-or-nothing overwrite: start from the coarser entry's `vendors`, overlay the finer entry's `vendors` on top (per-vendor, finer wins; vendors only in coarser are retained). Null/empty `vendors` handled defensively. The B.1 "departed vendor retained via union merge" test passes (GREEN). The `addHistory` ordering at lines 914–916 (90d → 30d → 7d) is preserved unchanged.
  - **Depends on:** B.1
  - **Leverage:** Conditional union to preserve `null` convention: only assign the union object if at least one side has vendor keys, otherwise keep `null`. Pattern: `if (mergedHasVendors || existingHasVendors) { merged.vendors = { ...(existing.vendors || {}), ...(merged.vendors || {}) }; } else { merged.vendors = null; }`. Finer entry (`merged`/`e`) spreads last so its values win per-vendor; coarser entry (`existing`) provides departed vendors.
  - **Additional:** Add a one-line comment at the `addHistory` ordering site (`retail.js:914-916`) documenting that the union spread depends on coarsest-first order (90d → 30d → 7d).
  - **Maps to:** AC-2

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test`. All existing tests pass; both new B.1 test cases pass (green after C.2 implementation).
  - If anything fails: fix the implementation, not the test. Tests are the spec.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **Note:** Pre-existing `no-undef` findings on browser globals are noise — verify findings on changed lines only per CLAUDE.md.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-5), write exactly one line citing the test or implementation line that proves it. **AC-1 has no Playwright-testable path** (see B.2 justification) — cite the `api-export-v2.js` line replacements and post-deploy manual smoke check instead.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.
  - **Note:** This file lives in DocVault (sketch folder), not the StakTrakr patch worktree. The stamp is committed as a sketch artifact via `/vault-update` (CLOSE-5) or `/sketch archive` (CLOSE-8).

- [x] **CLOSE-4. Version bump + spot bundle**
  - **File:** project version files (`package.json`, `js/constants.js`, `version.json`, `js/about.js`, `CHANGELOG.md`)
  - **MUST invoke `/release patch`** as a skill.
  - **MUST invoke `/update-spot-bundle`** in the same cohort (StakTrakr pre-flight requirement — run before every version-bump PR).

- [x] **CLOSE-5** — Vault update
  - **MUST invoke `/vault-update`** as a skill — API Reference doc update (add `history-90d.json`, correct `history-7d.json` from "daily aggregates" to "hourly OHLCA buckets", update `history-30d.json` to mention per-vendor breakdown) is performed here.
  - **Plane issue closure deferred to CLOSE-8** (post-merge) per StakTrakr gate: "Never mark Plane issues Done before the PR merges."

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/start-patch`.
  - Title format: `v<VERSION> — STRK-92: Fill 90-day Market History All view with per-vendor data` (StakTrakr versioned patch convention). Use `--draft --label codacy-review`.
  - Body must include: link to STRK-92, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-92-90d-vendor-history/`), test plan checklist.

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill.
  - All Critical/High findings must be either fixed or marked false-positive with explicit reasoning.

- [ ] **CLOSE-8. Archive sketch + close issue** (after PR merges)
  - **MUST invoke `/sketch archive STRK-92`** as a skill.
  - Mark STRK-92 as Done in Plane via `mcp__plane__update_issue` — deferred from CLOSE-5 to respect the post-merge gate.

---

> **Multi-model dispatch hint:** C.1 (publisher/Node) and C.2 (frontend/vanilla JS) touch independent files and can run in parallel. Suggested split: send C.1 to Codex (strong at contained Node edits), C.2 to Claude/Opus (needs to reason about merge semantics). B.1 should run first in any model — it sets up the test fixtures that C.2 must satisfy.

## Review Archive — tasks (2026-05-22)

_Reconciled by /sketch reconcile on 2026-05-22. Original reviewer marks preserved below for audit._

### DeepSeek

**Verified:**
- Publisher 30d pipeline at `api-export-v2.js:634-640`: uses `queryRetailDailyAggregates()` + `buildDailyWithVendors()` with 30-day date range and 86400 TTL. ✓
- Publisher 90d pipeline at `api-export-v2.js:642-649`: uses `queryRetailRange()` + `buildRetailOhlcaBuckets("daily")` + `_vendorPrices` strip. The task says "lines 642–649 replaced" — the current code spans exactly those 8 lines (comment + 7 code lines). ✓
- `queryRetailDailyAggregates` at `api-export-v2.js:381-401`: parameterized by `(client, coinSlug, startIso, endIso)` — accepts arbitrary date range, no signature change needed for 90d. ✓
- `buildDailyWithVendors` at `api-export-v2.js:744-774`: outputs `{ t, ts, ...ohlca, vendors }` — mechanically identical schema to 30d output. ✓
- Frontend `addHistory` ordering at `retail.js:914-916`: `addHistory(hist90)` → `addHistory(hist30)` → `addHistory(hist7)`. ✓
- Frontend dedup merge at `retail.js:928-934`: current all-or-nothing vendor handoff — if finer entry has vendors, coarser vendors are discarded entirely. The spread fix in C.2 (`{ ...existing.vendors, ...e.vendors }`) is correct given `e` is always the finer entry. ✓
- Vendor column rendering at `retail.js:1253-1259`: reads `entry.vendors[vid].avg` and formats via `_fmtRetailPrice`. ✓
- Test fixture at `stak-582-market-survivors.spec.js:366-368`: `responseForPath()` returns identical `historyRows[slug]` for all three history endpoints. ✓
- Test fixture date at `stak-582-market-survivors.spec.js:18-19`: `oldDate = daysAgo(20)` — within 30-day window, so current mock cannot distinguish 30d from 90d data sources. ✓
- Existing test assertions at lines 385 (`not.toContainText(oldDate)`) and 389 (`toContainText(oldDate)`) reference the global `oldDate` and `historyRows` — will need updating when fixtures are split in B.1. ✓

## Verification Stamp

- [x] **AC-1** — `api-export-v2.js:642-649` replaced: `queryRetailRange` + `buildRetailOhlcaBuckets` + `_vendorPrices` strip → `queryRetailDailyAggregates` + `buildDailyWithVendors`, matching 30d pattern. Post-deploy: fetch `history-90d.json` and confirm `vendors` object present on entries >30d old.
- [x] **AC-2** — `stak-582-market-survivors.spec.js` test "90d-only row renders vendor prices in All view": asserts `veryOldDate` (45 days ago) row contains `$38.50` (vendor price) and no dashes. Passes GREEN.
- [x] **AC-3** — 7d/30d publisher code (`api-export-v2.js:625-640`) untouched; all 5 pre-existing `stak-582-market-survivors` tests pass unchanged. Full suite: 694 passed, 12 pre-existing failures (unrelated files).
- [x] **AC-4** — `stak-582-market-survivors.spec.js` test "departed vendor retained via union merge on overlapping dates": endpoint-specific fixtures (`history90dRows` has jmbullion on `overlapDate`, `history30dRows` does not), asserts both `$41.20` (apmex from 30d) and `$40.50` (jmbullion from 90d) appear. Passes GREEN.
- [x] **AC-5** — Deferred to CLOSE-5 (`/vault-update` skill invocation for API Reference doc update).
- API Reference at `API Reference.md:307`: `history-7d.json` described as "daily aggregates" but code uses hourly OHLCA buckets (`api-export-v2.js:630`). ✓
- API Reference at `API Reference.md:308`: `history-30d.json` described as "daily aggregates with OHLCA" — omits per-vendor breakdown. ✓
- API Reference at `API Reference.md:301-311`: no `history-90d.json` entry exists. ✓
- `[P]` markers: C.1 touches `api-export-v2.js` (Node), C.2 touches `js/retail.js` (browser JS) — independent files, no collision. ✓

**Top Concerns:**
1. CLOSE-5 closes the issue before PR merges — violates the StakTrakr CLAUDE.md gate "Never mark Plane issues Done before the PR merges" and the sketch workflow rule "Plane closure tasks must follow `/sketch archive` after merging" (CLOSE-8). Move the `mcp__plane__update_issue` call into CLOSE-8 or reorder these closing tasks.
2. `addHistory` ordering (90d→30d→7d) at `retail.js:914-916` has no guard — C.2's union spread `{ ...existing.vendors, ...e.vendors }` depends on `existing` being the coarser entry. If anyone refactors `addHistory` to push 90d last (coarsest data last is a natural instinct), `e` becomes the coarser entry and the union direction silently breaks. The task says ordering is "preserved unchanged" but doesn't add a guard — neither a comment at the ordering site nor a test assertion. The comment I suggested at the C.2 task body is the minimum defense.
3. B.1 fixture split requires updating existing test assertions. The existing test at lines 385 and 389 references the global `oldDate` (20 days) and global `historyRows`. After splitting into `history7dRows`/`history30dRows`/`history90dRows`, the existing "last 30 days hides old row, All shows it" assertions must be migrated to use the split fixtures. The task doesn't explicitly list this update. Noted inline above — should be added to B.1 acceptance items.

**Unverified Assumptions:**
- Assumption 6: `queryRetailDailyAggregates` with a 90-day range performs acceptably on production sqld. The 30d query works; 90d is 3× the date range. The same indexes (`idx_coin_window`, `idx_coin_date`) are used. Reasonable but unverified without production metrics.
- Assumption 7: No external consumer (outside StakTrakr frontend) parses `history-90d.json` and depends on the absence of the `vendors` field. The schema change is additive, but any external tool expecting the old shape would encounter new keys.
- Assumption 8: The DocVault API Reference update (CLOSE-5) ships in the same review cycle as the StakTrakr PR. These live in separate repos — the StakTrakr PR description should reference the corresponding DocVault commit/PR.
- Assumption 9: B.1 item 5 ("Expected: PASS") — asserts the frontend already handles `vendors` from any mock source. Verified: the renderer at `retail.js:1253-1259` reads `entry.vendors[vid].avg` irrespective of which endpoint provided the data. However, the test's setup (fetch + merge + render) runs the full frontend pipeline, not just the renderer. If the mock setup changes (e.g., endpoint-specific routing), the full pipeline behavior may differ from the renderer's code path alone.

### AGY

**Verified:**
- Endpoint Routing and Fixtures (B.1): Splitting `historyRows` into `history7dRows`, `history30dRows`, and `history90dRows` is necessary to ensure `responseForPath()` can accurately respond with timeframe-specific mocks. ✓
- Daily Aggregates Node Pipeline (C.1): Reusing `queryRetailDailyAggregates` and `buildDailyWithVendors` with a 90-day window (`90 * MS_PER_DAY`) matches the proven pattern for the 30-day feed. ✓
- Array Dedup Order (C.2): Pushing 90d first, then 30d, then 7d via `addHistory` ensures that finer-grained entries process last, allowing them to overwrite coarser entries while retaining coarser vendor history via union. ✓

**Top Concerns:**
1. Test Fixture Mismatch (B.1): The B.1 acceptance item 3 references a departed vendor `vendorB`. However, the test suite defines only `apmex` and `jmbullion` in its mocked VENDORS array and manifest. A completely new vendor ID like `vendorB` will fail to render because the UI depends on defined vendor structures. *Recommendation:* Mock this behavior by omitting `jmbullion` from the 30-day mock on the duplicate date while keeping it in the 90-day mock.
2. Logic Pollution in Vendor Merge (C.2): Unconditionally spreading `{ ...(existing.vendors || {}), ...(e.vendors || {}) }` will result in `vendors: {}` for rows that have no vendor data on either feed. This pollutes the history cache and violates the convention of setting absent vendor data to `null`. *Recommendation:* Perform the merge conditionally.
3. Plane Release Gate Violation (CLOSE-5): Transitioning STRK-92 to "Done" in Plane during CLOSE-5 violates StakTrakr release rules. *Recommendation:* Restrict CLOSE-5 to `/vault-update`, move Plane update to CLOSE-8.

**Unverified Assumptions:**
- Performance on 90-day SQLite queries: Assumes the `idx_coin_window` and `idx_coin_date` indexes scale efficiently for 90 days of daily aggregates under typical database sizes.
- Cache-Busting and Service Worker Cache Stamping: Assumes that the `sw.js` cache-stamping hook will correctly register the new version when merged, ensuring users fetch the new `history-90d.json` schema without cache collision.

### Codex

**Verified:**
- Verified the publisher delta: 30d currently uses `queryRetailDailyAggregates()` plus `buildDailyWithVendors()`, while 90d still uses `queryRetailRange()`, `buildRetailOhlcaBuckets(..., "daily")`, strips `_vendorPrices`, and writes aggregate-only JSON (`devops/pollers/shared/api-export-v2.js:381-400`, `:625-649`, `:744-774`).
- Verified the frontend merge surface: `addHistory(hist90)`, `addHistory(hist30)`, then `addHistory(hist7)` feeds a date-dedup map, and the current merge only preserves coarser vendors when the finer row has no vendors at all (`js/retail.js:894-938`).
- Verified B.1's current fixture shape: the survivor spec defines only `apmex` and `jmbullion`, serves the same `historyRows` payload for all history endpoints, and existing timeframe assertions use `oldDate = daysAgo(20)` (`tests/playwright/retail/stak-582-market-survivors.spec.js:7-19`, `:110-148`, `:353-390`).
- Verified the vendor rendering path uses the known vendor IDs to read `entry.vendors[vid].avg`, so undefined mock vendor IDs do not exercise the intended union behavior (`js/retail.js:1253-1259`).
- Verified release conventions require the patch worktree/version lock, versioned commit/PR title, draft PR against `dev`, and post-merge worktree cleanup.
- Verified the API Reference update is cross-repo: the StakTrakr approach maps it to `DocVault/Projects/StakTrakr/Foundation/Deep Dives/API Reference.md`, and the live table still omits `history-90d.json`, mislabels 7d as daily, and omits the 30d `vendors` detail.

**Top Concerns:**
1. CLOSE-6 uses a non-versioned PR title. That conflicts with the StakTrakr patch flow and can produce a PR that looks like an ordinary feature PR instead of a versioned patch release. Use `v<VERSION> — STRK-92: ...` and keep the draft/codacy-review flags explicit.
2. CLOSE-3 writes a verification stamp into DocVault without saying how that cross-repo artifact is handled. The StakTrakr patch worktree cannot commit this `tasks.md` change, so the task should name whether the stamp is part of `/vault-update`, sketch archive, or a separate DocVault commit.
3. B.1 still names `vendorB` even though the fixture and renderer only know `apmex` and `jmbullion`. Use a known vendor, likely `jmbullion`, as the departed vendor so the RED failure proves the merge bug rather than a bad fixture.

**Unverified Assumptions:**
- The verification stamp is intended to remain in the active sketch file during implementation rather than move to a separate artifact.
- The DocVault API Reference update should land in the same human review cycle as the StakTrakr runtime PR, even though it cannot be part of the same repository commit.
- The post-deploy smoke check for `history-90d.json` will have a concrete slug with older-than-30-day vendor data available when validation runs.

### Resolution Summary

- Accepted: 8
- Rejected: 0
- Resolved with your input: 1 (ordering comment at addHistory — approved)
