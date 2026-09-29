---
sketch: "STRK-162-image-usage-cache"
phase: tasks
created: 2026-06-06
approved: 2026-06-06
---

# STRK-162 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch run|workflow|dispatch` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Scope note:** the sprint tasks touch exactly the three files in `approach.md`'s File Map — `js/image-cache.js`, `tests/playwright/core/strk-162-image-usage-cache.spec.js`, `tests/playwright/coverage-map.csv`. Closing tasks additionally touch release/version artifacts via `/release patch` (expected, not scope creep).

## UI Contract Traceability

**N/A — no UI surface.** `approach.md`'s UI Contract is `N/A`; the only user-visible behavior in scope is the _existing_ STRK-146 quota toasts, covered as a regression assertion (AC-6). No mockups/playgrounds/screenshots are referenced, so no per-state visual-verification mapping is required and CLOSE-3 accepts test-only citations.

## Sprint Cohort 0 — Setup (sequential)

- [x] **0.1** — Ensure sketch worktree exists (StakTrakr `/start-patch` convention)
  - **File(s):** _no file changes — verification/setup only_
  - **Acceptance:** `git worktree list` shows the StakTrakr patch worktree (`.worktrees/STRK-162-image-usage-cache/` or `.worktrees/patch-<version>/`) on a `patch/<version>` branch based on `origin/dev`; `git merge-base origin/dev HEAD` equals `git rev-parse origin/dev`. Working dir is that worktree, not the main checkout.
  - **If the worktree does not exist yet:** invoke **`/start-patch`** (claims the version lock with the high-water-mark rule, selects STRK-162, creates the `patch/<version>` worktree off `origin/dev`). This is setup work — satisfy it by running the skill, not by stopping.
  - **Leverage:** `/start-patch`; `.context/git-topology.md` §Worktrees + the `EnterWorktree` base-ref caveat (branch off `origin/dev`, not `origin/main`).

## Sprint Cohort A — Foundation (test scaffolding)

_Register the new test surface. No behavioral logic and no assertions yet — pure scaffolding, so Cohort B can write failing tests against a real file._

- [x] **A.1** — Scaffold the dedicated spec + register it in the coverage map
  - **File(s):** `tests/playwright/core/strk-162-image-usage-cache.spec.js` (new), `tests/playwright/coverage-map.csv`
  - **Acceptance:** the new spec exists with a `test.describe("core/strk-162-image-usage-cache", …)` block and shared helpers only — (a) a helper to seed N `userImages` records of known byte sizes via `window.imageCache`, and (b) an in-page scan-counter that wraps `window.imageCache._userImagesBytes` (and/or `_iterate`) to count invocations across a sequence (set up via `page.evaluate`). `coverage-map.csv` gains one row: `tests/playwright/core/strk-162-image-usage-cache.spec.js,<test_count>,image-storage,P1 core user workflow,active,tests/playwright/core/strk-162-image-usage-cache.spec.js,STRK-162: userImages usage-cache coherency (lazy/increment/invalidate)`. No `test(...)` assertions yet.
  - **Leverage:** `tests/playwright/core/strk-146-image-quota-warning.spec.js` for boot/setup patterns; `coverage-map.csv` rows 73–74 for the column format; the `page.evaluate` + `window.imageCache` conventions from discovery.
  - **Maps to:** scaffolding for AC-1…AC-6

## Sprint Cohort B — Tests · RED (sequential)

_Write tests that encode every EARS acceptance criterion. They MUST fail against current code (which scans on every save and has no cache field)._

- [x] **B.1** — Write failing coherency tests (one+ per AC)
  - **File(s):** `tests/playwright/core/strk-162-image-usage-cache.spec.js`
  - **Acceptance:** each criterion has at least one test, and all are RED against `origin/dev`:
    - **AC-1** — after a first save warms the cache, a second save performs **no** new `userImages` scan (scan-counter unchanged across the 2nd save).
    - **AC-2** — the first usage need triggers exactly **one** scan; an immediately following need triggers **zero**.
    - **AC-3** — after a successful save, usage = prior + **signed** delta; includes a **shrink** case (replace a record with a smaller blob → usage decreases).
    - **AC-4** — a pre-flight-blocked save (delta over limit) **and** a forced `_put` failure each leave the total moved by **zero delta**. Assert _"the total did not move by delta"_ — **not** `cache === null` (per the reconcile pin: cold→warm scan is allowed; only `delta` is gated).
    - **AC-5** — **delete-then-save** reflects the deletion (post-save `used` excludes the deleted bytes); `clearAll` → next read = 0; `importUserImageRecord` → next read recomputes including the imported record.
    - **AC-6** — STRK-146 contract intact: the pre-flight overflow path still returns `{quotaExceeded:true, usageBytes, limitBytes}` and the pressure-band warn/critical toast still fires at the same fractions (the canonical regression anchor remains the untouched `strk-146` spec).
  - **Depends on:** A.1
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6

## Sprint Cohort C — Implementation · GREEN (sequential)

_Minimum code in `js/image-cache.js` to turn Cohort B green. Keep the diff minimal (Codacy DELTA complexity on this file; admin-merge is not available)._

- [x] **C.1** — Cache field + lazy accessor + read swap
  - **File(s):** `js/image-cache.js`
  - **Acceptance:** constructor (`:18`) adds `this._userImagesBytesCache = null` (null = cold) with a doc comment; a new private `async _cachedUserImagesBytes()` near `:493` returns the field, computing it once via `await this._userImagesBytes()` when `=== null` (strict null check — **never** falsy, so an empty-store `0` is not mistaken for cold); the pre-flight read at `:533` calls the accessor instead of `_userImagesBytes()` directly. `_userImagesBytes()` itself is unchanged (sole scan seam). AC-1 and AC-2 tests pass.
  - **Depends on:** B.1
  - **Maps to:** AC-1, AC-2
- [x] **C.2** — Increment on success + invalidate on the other three paths
  - **File(s):** `js/image-cache.js`
  - **Acceptance:** on the `ok === true` success branch of `cacheUserImageResult` (`:544–563`), set the field to `used + delta` (signed); the pre-flight block (`:541`) and `_put`-failure exit (`:554`) apply **no** delta (the accessor may still have warmed a cold field to `used` — allowed). `clearAll` (`:237`), `deleteUserImage` (`:629`), and `importUserImageRecord` (`:650`) each set the field to `null` (inline, with a one-line comment per D-4). AC-3, AC-4, AC-5 tests pass; AC-6 unaffected.
  - **Depends on:** C.1
  - **Maps to:** AC-3, AC-4, AC-5, AC-6

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run **`npm test`** (core Playwright PR gate). All existing tests pass; all new Cohort B tests are green after Cohort C.
  - If anything fails: fix the implementation, not the test. Tests are the spec.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run the **`codacy-analysis-cli`** skill: **`codacy-analysis analyze --diff`** (Gen-3 CLI) against the changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Watch the **DELTA complexity/duplication** signal on `js/image-cache.js` — keep the diff minimal rather than refactoring around it.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** append to the bottom of this `tasks.md` under `## Verification Stamp`.
  - For EACH AC in `requirements.md`, write one line: `- [x] AC-N — verified by <test name>` or `- [x] AC-N — verified at <file>:<line>`, or `- [ ] AC-N — gap: <reason>`.
  - **UI verification:** N/A — `approach.md`'s UI Contract is `N/A`, so test-only citations are sufficient for every AC (including AC-6, whose anchor is the `strk-146` spec).
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (via skill).
  - **MUST run `/update-spot-bundle` first** (StakTrakr rule: `/update-spot-bundle` runs before every version-bump PR; the script writes to the main checkout — copy the bundle into the worktree afterward).
  - Then **MUST invoke `/release patch`** as a skill (it enforces version-lock claim, file enumeration, and the pre-commit `sw.js` step). Do not hand-edit release artifacts.

- [x] **CLOSE-5. Vault update + close issue** _(vault-update: N/A by audit — no Foundation contradiction; issue → In Review, Done at archive after merge)_
  - **MUST invoke `/vault-update`** as a skill (it audits Foundation docs even if you expect zero changes; a perf-only `ImageCache` tweak likely reports no doc changes — that's a clean N/A by audit).
  - Mark **STRK-162 Done** in Plane: `mcp__plane__update_issue` → state "Done".

- [x] **CLOSE-6. Open PR** — [#1225](https://github.com/lbruton/StakTrakr/pull/1225)
  - Use the `patch/<version>` worktree branch from Cohort 0. Title: `perf(STRK-162): cache userImages storage usage (O(1) pre-flight)`.
  - Body must include: link to [STRK-162], link to the sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-162-image-usage-cache/`), and a test-plan checklist (AC-1…AC-6 + `npm test` green).

- [x] **CLOSE-7. Resolve PR review threads** _(no threads/findings — all checks green; CodeRabbit skipped on non-default base; Codacy clean)_
  - **MUST invoke `/pr-resolve`** as a skill. Scan **both** inline diff threads AND review-body findings (Codacy/Copilot often post outside the diff). All Critical/High fixed or marked false-positive with reasoning; Medium fix-or-waiver; Low/Info advisory. Re-check for new auto-scanner threads after each push.

- [x] **CLOSE-8. Archive sketch** (after PR merges) — merged in [#1225](https://github.com/lbruton/StakTrakr/pull/1225) (`6a1c62e8`)
  - **MUST invoke `/sketch archive STRK-162`** as a skill — moves the folder to `archive/YYYY-MM-DD-STRK-162-image-usage-cache/` and saves the mem0 summary.

---

> **Multi-model dispatch hint:** this is a single-implementation-file change with a strict TDD chain (A → B → C, all sequential), so there are **no `[P]` parallel tasks**. The natural model-routing seam is the TDD boundary: one model writes the Cohort B failing tests, a different model writes the Cohort C implementation to make them green. Closing tasks are conductor-run skills (no dispatch).

---

## Verification Stamp

_All ACs verified by the dedicated spec `tests/playwright/core/strk-162-image-usage-cache.spec.js`. `approach.md`'s UI Contract is N/A, so test-only citations are sufficient. Full core suite: **198 passed** (4.8m), zero regressions._

- [x] AC-1 — verified by `AC-1: a warm cache serves the pre-flight without re-scanning userImages` (scan-counter unchanged on the 2nd save)
- [x] AC-2 — verified by `AC-2: usage is computed once and retained across needs` (two cold-start saves → exactly one scan)
- [x] AC-3 — verified by `AC-3: the cached total tracks the signed delta, including a shrinking replace` (1000 → 3000 → 2500)
- [x] AC-4 — verified by `AC-4: a blocked write and a failed _put leave the cached total unmoved` (asserts no delta applied, not `null`; per reconcile pin)
- [x] AC-5 — verified by `AC-5: delete / clearAll / import invalidate the cache so the next read recomputes` (delete-then-save = 2500; clearAll = 700; import = 1100)
- [x] AC-6 — verified by `AC-6: STRK-146 quota contract intact (block report + warn toast)` + the untouched `tests/playwright/core/strk-146-image-quota-warning.spec.js` (6/6 green in the full-suite run)

**Quality:** ESLint clean on changed files. Codacy `--diff` Lizard findings (cacheUserImageResult ccn 9; file 597 NLOC; sw.js anonymous ccn 16/9) all confirmed **pre-existing** vs the `origin/dev` baseline — zero introduced. `cacheUserImageResult` is 9→9 (no delta).
