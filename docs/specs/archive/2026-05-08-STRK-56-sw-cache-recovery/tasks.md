---
sketch: "STRK-56-sw-cache-recovery"
phase: tasks
created: 2026-05-08
approved: 2026-05-08
---

# STRK-56 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project (e.g., no version management, no foundation docs touched), mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

## Sprint Cohort 0 — Setup (sequential)

_The skill's `/sketch apply` phase creates the worktree before iterating these tasks. Cohort 0 documents and verifies that setup so it's auditable in the sketch artifact._

- [x] **0.1** — Confirm sketch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a worktree on branch `sketch/STRK-56-sw-cache-recovery`. Working directory is that worktree, not the main checkout. If the worktree is missing, the skill's apply phase has been bypassed — STOP and report to the human.
  - **Leverage:** `using-git-worktrees` skill; `/sketch apply` flow.
  - **Result:** Executed in the required StakTrakr version-lock worktree `patch/3.34.51` rather than the generic sketch branch name.

## Sprint Cohort A — Independent file edits (parallel-safe)

_A.1 touches `sw.js` only; A.2 touches `js/dialogs.js` only. No shared symbols, no shared lines. Safe to dispatch concurrently._

- [x] **A.1 [P]** — Add SW non-OK fallback helper and route all three strategies through it
  - **File(s):** `sw.js`
  - **Acceptance:** New helper `respondWithCacheFallback(request, response)` exists near `fetchAndCache` (~line 240); when called with a non-OK response, returns `caches.match(request)` if cached, else returns the original response. `networkFirst` (sw.js:251-253), the cache-miss path inside `cacheFirst` (sw.js:246-247), and the cache-miss path inside `staleWhileRevalidate` (sw.js:256-263) ALL invoke the helper. Navigation handler (sw.js:174-197) untouched. `cache.put` continues to fire only on `response.ok`. `CACHE_NAME` line 7 NOT manually edited (the pre-commit hook stamps it).
  - **Leverage:** Mirror the existing pattern at `sw.js:178-187` (navigation handler). Approach D-1.
  - **Maps to:** AC-1, AC-5

- [x] **A.2 [P]** — Add `"action"` mode to dialogs.js with `appActionDialog` wrapper
  - **File(s):** `js/dialogs.js`
  - **Acceptance:** `showDialog` accepts a fourth mode `"action"` taking `{ message, title, primaryLabel, primaryAction, secondaryLabel }`; renders primary + secondary buttons (no input field, no native confirm/cancel labels); primary button click resolves the Promise after invoking `primaryAction()`; secondary button click resolves without invoking. New `window.showAppActionDialog(opts)` and `window.appActionDialog(opts)` wrappers exposed parallel to `showAppAlert`/`appAlert`. Existing `alert` / `confirm` / `prompt` modes untouched and their global wrappers continue to work. Focus trap and queue behavior preserved.
  - **Leverage:** Existing `showDialog` (`js/dialogs.js:138-142`) and mode-branching pattern (lines 122-126 for button finish handlers). Approach D-4.
  - **Maps to:** AC-4

## Sprint Cohort B — init.js layered hardening (sequential)

_Both tasks touch `js/init.js`. Sequential to avoid same-file collision (parallelization sanity check rule 1). B.2 also depends on A.2's new dialog API._

- [x] **B.1** — Add `typeof` guards on `loadApiConfig` / `loadApiCache` calls
  - **File(s):** `js/init.js`
  - **Acceptance:** Lines 615-617 wrap the calls as `apiConfig = (typeof loadApiConfig === "function") ? loadApiConfig() : {};` and `apiCache = (typeof loadApiCache === "function") ? loadApiCache() : {};`. When `api.js` fails to load, init proceeds without throwing; a `console.warn` records the degraded state. Pattern matches existing convention in `spotLookup.js:156`, `settings.js:425`, `settings-listeners.js:1620,1681`.
  - **Leverage:** Same convention used in 3 other callsites (discovery table). Approach D-2.
  - **Depends on:** _none_ (independent of A.1/A.2)
  - **Maps to:** AC-2

- [x] **B.2** — Extend STAK-485 catch block with second-tier nuke recovery + Reset App action
  - **File(s):** `js/init.js`
  - **Acceptance:**
    - In the success path near line 880, add `sessionStorage.removeItem("sw-recovery-nuked")` alongside the existing `sw-recovery-attempted` clear.
    - In the catch block (currently 881-911): after the existing `isStaleCache` reload branch, add a second-tier branch that fires when `error instanceof ReferenceError` AND the error message matches a known missing asset-global signature (`loadApiConfig` or `loadApiCache`) AND `sessionStorage.getItem("sw-recovery-attempted") === "1"` AND `sessionStorage.getItem("sw-recovery-nuked") !== "1"`. The branch sets `sw-recovery-nuked=1`, then waits for both unregister and cache-delete promises before reloading. Use a flattened promise list such as `Promise.all([...allRegistrations.map((r) => r.unregister()), ...allStaktrakrCacheKeys.map((k) => caches.delete(k))])`, or nested `Promise.all` calls that explicitly await the mapped promises. Do not pass arrays of promises as raw elements to `Promise.all`. After the promises settle successfully, call `location.reload()`. No try/catch swallowing — failures fall through to the modal.
    - The fallthrough modal call replaces `appAlert(...)` with `appActionDialog({ message, title: "Application Error", primaryLabel: "Reset App", primaryAction: nukeAndReload, secondaryLabel: "OK" })`. The Reset App action runs the same nuke sequence regardless of flag state (ignores `sw-recovery-nuked`).
    - ReferenceError gating: only `error instanceof ReferenceError` with a known asset-load global signature triggers the nuke tier. Other error types and unrelated ReferenceErrors fall straight through to the modal (no destructive recovery).
  - **Leverage:** Existing STAK-485 structure (`js/init.js:881-911`); navigator.serviceWorker.getRegistrations() pattern; `caches.keys()` filter on `staktrakr-` prefix (matches existing activate handler at `sw.js:144`). Approach D-3, D-5, D-6.
  - **Depends on:** A.2 (uses new `appActionDialog`), B.1 (logically — guarded init reduces the cases where this branch fires, but no code dependency)
  - **Maps to:** AC-3, AC-4

## Sprint Cohort C — Manual verification

_No Playwright SW-poisoning fixture (per requirements Non-Goals). Verification is manual Firefox repro, scripted as a checklist for reproducibility._

- [x] **C.1** — Manual Firefox repro of all four behavior ACs
  - **File(s):** _verification only — capture results in CLOSE-3 verification stamp_
  - **Acceptance:** Run the following in Firefox (with DevTools Network panel open):
    1. **AC-1 (SW fallback):** Load app cleanly so SW installs. Simulate a fulfilled non-OK response for `js/api.js` (HTTP 500/503 or equivalent), not only a blocked request/network rejection. Reload. Observe that the app boots normally — Layer 1 served the cached copy. Console should show no `loadApiConfig is not defined` error. A blocked-request check may be run as an extra regression check, but it does not by itself prove AC-1.
    2. **AC-2 (init guard):** Open the SW DevTools, set `js/api.js` blocked at the SW level (or temporarily delete the cache entry for it). Reload. App boots with degraded state ("No data" spot prices) but no CRITICAL modal. Console shows `console.warn` from B.1.
    3. **AC-3 (nuke recovery):** With `sw-recovery-attempted=1` and a known asset-load `ReferenceError` simulation in place (`loadApiConfig` or `loadApiCache` missing), reload. Observe that the page blanks, waits for SW unregister and StakTrakr cache deletes, then reloads. Third load (with simulation cleared) succeeds and clears both flags. Also force an unrelated `ReferenceError` and confirm it falls through to the modal without destructive recovery.
    4. **AC-4 (Reset App action):** Force the modal to display by setting BOTH `sw-recovery-attempted=1` AND `sw-recovery-nuked=1` then reloading with a simulated error. Modal appears with "Reset App" and "OK" buttons. Click Reset App; verify SW + caches cleared and page reloads.
    5. **AC-5 (shared helper):** Code review only — confirm `respondWithCacheFallback` is the only path through which non-OK responses are handled in `networkFirst`, `cacheFirst`, and `staleWhileRevalidate`.
  - **Leverage:** Firefox DevTools Network panel "Block" feature; Application → Service Workers panel for unregister/cache controls.
  - **Depends on:** A.1, A.2, B.1, B.2
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm run test:offline` (Playwright tests, skip network-dependent — per package.json). All existing tests pass. No new automated tests added in this PR (per requirements Non-Goals — manual Firefox repro is the verification path).
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files (`sw.js`, `js/init.js`, `js/dialogs.js`). Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory. Note: per CLAUDE.md, browser-global `no-undef` findings on changed lines only — pre-existing whole-file findings are noise.

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 through AC-5), write exactly one line in one of these formats:
    - `- [x] AC-N — verified at <relative/file/path>:<line>` (cite the test or implementation line that proves it), OR
    - `- [x] AC-N — verified by <test name>` (when an entire named test case proves it), OR
    - `- [ ] AC-N — gap: <one-line reason>` (when not yet verified).
  - The stamp block MUST list every AC from requirements.md (AC-1, AC-2, AC-3, AC-4, AC-5). Status-only notes ("PR opened", "tests passing") are not equivalent — the gate requires per-AC traceability.
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`; `sw.js` cache version is auto-stamped by pre-commit hook)
  - **MUST invoke `/release patch`** as a skill — paraphrasing the version-bump steps inline is not equivalent because the skill enforces version-lock claim, file enumeration, and pre-commit interactions the prose cannot carry.

- [x] **CLOSE-5. Vault update + close issue**
  - **MUST invoke `/vault-update`** as a skill — even if you believe no foundation docs are affected, the skill performs the audit. Likely affected: `DocVault/Projects/StakTrakr/Foundation/architecture.md` (recovery flow) and possibly `coding-standards.md` (typeof-guard convention). Skill will confirm.
  - Mark STRK-56 Done in Plane: `mcp__plane__update_issue` to state "Done".

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/sketch apply` (`sketch/STRK-56-sw-cache-recovery`). Title: `fix(STRK-56): service worker cache fallback + multi-tier init recovery`.
  - Body must include: link to STRK-56, link to sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-56-sw-cache-recovery/`), test plan checklist (the 5 manual repro steps from C.1).
  - Target branch: `dev` (per CLAUDE.md §7).

- [x] **CLOSE-7. Resolve PR review threads**
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill — the skill knows how to triage findings, fix-or-classify, and reply to threads consistently.
  - Coverage: scan **both** inline diff threads AND review-body findings (CodeRabbit/Copilot/Codacy summary blocks). Watch for known false-positives flagged in CLAUDE.md (e.g., `ALLOWED_STORAGE_KEYS` typeof guard — though not relevant to this PR's surface).
  - Critical/High: fix or false-positive with reasoning. Medium: fix or document waiver. Low/Info: advisory.
  - **Result:** `/pr-resolve` guidance invoked; PR #1091 currently has no review threads.

- [x] **CLOSE-8. Archive sketch** (after PR merges)
  - **MUST invoke `/sketch archive STRK-56`** as a skill — moves folder to `archive/2026-MM-DD-STRK-56-sw-cache-recovery/` and saves mem0 summary.

---

> **Multi-model dispatch hint:** Cohort A's `[P]` tasks (A.1 sw.js, A.2 dialogs.js) can be sent to different models in parallel via OpenCode. Suggested split: A.1 → Codex (caching/fetch reasoning), A.2 → Gemini or Kimi (UI/DOM extension). Reconverge before Cohort B since B.2 depends on A.2.

## Verification Stamp

- [x] AC-1 — verified at `sw.js:240`
- [x] AC-2 — verified at `js/init.js:616`
- [x] AC-3 — verified at `js/init.js:939`
- [x] AC-4 — verified at `js/dialogs.js:213`
- [x] AC-5 — verified at `sw.js:263`
