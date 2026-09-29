---
sketch: STRK-224-companion-failure-edges
phase: tasks
created: 2026-06-20
approved: 2026-06-21
---

# STRK-224 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch run` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-analysis-cli`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry. If a closing task is genuinely irrelevant to the project, mark it `N/A — <one-line reason>` rather than dropping the task. Audible skips beat silent skips.

> **Parallelization reality for this sketch:** all six production touch points land in the **single file** `js/cloud-sync.js`, and all five new E2E cases land in the **single file** `item-price-history-cloud.spec.js`. Two tasks in the same file are never `[P]` (merge-conflict risk). So the only `[P]`-eligible task is the coverage-map update (a distinct CSV). This is deliberate, not an oversight — `[P]` is a provable no-collision promise, and these tasks collide by construction. Cross-checks recorded at the bottom.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins. If the worktree is missing, the executing agent creates it — this is setup work, not a stop-the-world gate._

- [x] **0.1** — Ensure the STRK-224 patch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a `patch/<version>` branch worktree for STRK-224 (e.g. `.worktrees/patch-<version>/` or `.worktrees/224-companion-failure-edges/`), branched off `origin/dev` (not `origin/main`). Working directory is that worktree, not the main checkout. The version is the high-water mark = `max(all version.lock entries incl. expired, APP_VERSION on origin/dev)`.
  - **If the worktree does not exist yet:** Create it via **`/start-patch`** (StakTrakr's required setup skill — claims the version lock and creates the `patch/<version>` branch). Do **not** use the generic `sketch/{ISSUE-ID}-{slug}` name. This is a single-PR runtime change (full discipline: Plane issue → worktree → PR to `dev`), **not** a no-bump campaign — so `patch/<version>` via `/start-patch` is correct.
  - **Leverage:** `/start-patch` skill; `.context/sketch-conventions.md` §Worktree & branch; `.context/git-topology.md` §`EnterWorktree` base-ref caveat (branch on `origin/dev` first).

## Sprint Cohort A — Foundation (read-only prep)

_No code is written here — there is no standalone scaffolding to build (the fix is in-place control-flow hardening in one existing file). The one foundational task is to neutralize the biggest execution risk this sketch carries: the line numbers in the issue, discovery, and approach **have drifted** (STRK-225 / #1306 shifted the apply paths) and the working-tree `js/cloud-sync.js` does not respond to bare `grep`._

- [x] **A.1** — Re-anchor all cited line numbers + confirm test scaffolding against worktree HEAD
  - **File(s):** _no file changes — read-only re-anchoring_
  - **Acceptance:** Using `git grep` / the Read tool (NOT bare `grep` — it silently returns nothing on this file, per discovery), confirm the live location of every function/site the approach names: `pollForRemoteChanges` poll shortcut + companion pre-merge, `_pollCompanionItemPriceHistory`, `_pullItemPriceHistoryVault` (and its **six** call sites after D-5 adds STAK-470 — currently five: poll `~2685`, deferred `~4026`, silent-pull `~4230`, vault-first-silent `~4787`, vault-first-post-apply `~4917`), `_applyAndFinalize`'s `syncSetLastPull` record (`~3598`), the STAK-414 local-newer branch (`~2616-2635`), and the STAK-470 auto-merge branch (`~4289-4480`). Confirm the spec scaffolds exist: `item-price-history-cloud.spec.js` `writeItemPriceHistoryStrict`-throw test (~line 517) and `attachments-cloud.spec.js` cancel-modal pattern, plus `vault-fixtures.js` `encryptVaultPayload`.
  - **Leverage:** discovery.md "Existing Code" table + anchor note; `.context/implementation-gotchas.md`; `tests/playwright/helpers/vault-fixtures.js`.
  - **Maps to:** All AC (de-risks every downstream task)

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Write E2E tests encoding each acceptance criterion BEFORE implementation._

**Two kinds of test live in this cohort — read this before writing them:**

- **Four red/green spec tests — B.1, B.3, B.4, B.5.** These drive new behavior. Each **MUST fail** at this point; a passing one means it isn't exercising the bug, so the test is wrong.
- **One green/green non-regression guard — B.2.** This asserts behavior that **already works today** (the STRK-147 silent fast-path). It is **expected green before implementation and still green after** — its job is to go RED *only if* C.3's reorder regresses the silent merge. **Do not "fix" B.2 to make it fail in this cohort** — a green B.2 here is correct, not a defect. It is authored here, alongside the others, so one model writes all five tests and so the guard protects the C.3 reorder from the moment that reorder lands.

_All five cases land in `tests/playwright/core/item-price-history-cloud.spec.js` (same file → sequential, not `[P]`). Reuse the existing throw-scaffold (~line 517), the `attachments-cloud.spec.js` cancel-modal pattern, and `vault-fixtures.js` `encryptVaultPayload`. Custom modals (`#restorePreviewModal` / `#appDialogModal`) are NOT intercepted by `page.on("dialog")` — drive them via `waitForSelector` → `#appDialogOk`/`#appDialogCancel`, or stub `showRestorePreviewModal` to resolve `false`._

- [x] **B.1** — Failing test: Edge 1 — cancel of a DiffModal carrying a concurrent companion change
  - **File(s):** `tests/playwright/core/item-price-history-cloud.spec.js` (add case)
  - **Acceptance:** Seed a remote sync with **both** an inventory/settings change (forces the DiffModal) **and** an item-price-history companion change. Drive `pollForRemoteChanges()`, wait for the modal, click Cancel. Assert local item-price-history is **unchanged** AND `lastPull.itemPriceHistoryHash`/`lastPull.syncId` did **not** advance. Test FAILS today because the poll pre-merge merges + records the hash before Cancel.
  - **Depends on:** A.1
  - **Leverage:** `attachments-cloud.spec.js` vault-first cancel pattern; `vault-fixtures.js` `encryptVaultPayload`.
  - **Maps to:** AC-1, AC-2, AC-9(a)

- [x] **B.2** — Non-regression guard (green/green): Edge 1 — companion-only change still merges silently
  - **File(s):** `tests/playwright/core/item-price-history-cloud.spec.js` (add case)
  - **Acceptance:** Seed a remote sync with a companion change **only** (no inv/settings diff → no DiffModal). Drive `pollForRemoteChanges()`. Assert the history merged silently AND `lastPull.itemPriceHistoryHash` advanced — preserving the STRK-147 D-11 silent fast-path. This guards the reorder in C.3 from over-deferring. (May initially pass while the silent path is untouched; its job is to go RED if C.3's reorder regresses the silent merge, and stay green otherwise.)
  - **Depends on:** A.1
  - **Leverage:** STRK-147 D-11 silent fast-path (discovery Prior Decisions); `vault-fixtures.js`.
  - **Maps to:** AC-3, AC-9 (non-regression anchor)

- [x] **B.3** — Failing test: Edge 2 — null-hash transient failure leaves `lastPull` stale, next poll retries
  - **File(s):** `tests/playwright/core/item-price-history-cloud.spec.js` (add case)
  - **Acceptance:** Force a transient companion download/decrypt failure so `_pullItemPriceHistoryVault` returns `{hash:null}` **non-throwing** (e.g. stub fetch to a non-ok response). First poll: assert `lastPull.syncId` and `lastPull.itemPriceHistoryHash` did **not** advance. Then restore a healthy response and poll again: assert the companion now merges (the stale `syncId` did not trip the `lastPull.syncId === remoteMeta.syncId` shortcut into skipping). Test FAILS today because the null-hash return is treated as `failed:false`, advancing the watermark.
  - **Depends on:** A.1
  - **Leverage:** existing `writeItemPriceHistoryStrict`-throw retry test (~line 517) as the structural template; discovery Constraint on the ambiguous `{hash:null,skipped:false}` shape.
  - **Maps to:** AC-4, AC-6, AC-9(b) — partial coverage of AC-5 (poll path)

- [x] **B.4** — Failing test: Edge 3 manifest-first — post-apply write-throw → no `syncId` advance → retry
  - **File(s):** `tests/playwright/core/item-price-history-cloud.spec.js` (add case)
  - **Acceptance:** Route a sync through the **manifest-first** deferred apply path (`_deferredVaultRestore` → `_applyAndFinalize` → companion pull). Stub `writeItemPriceHistoryStrict` to throw on the post-apply companion write. Assert the **full** prior `lastPull` (not just `syncId`) is intact afterward, then unstub and poll again to confirm the companion eventually merges. Test FAILS today because `_applyAndFinalize` records `syncId` before the companion write.
  - **Depends on:** A.1
  - **Leverage:** throw-scaffold (~line 517); discovery Edge-3 manifest-first mapping (`_deferredVaultRestore` companion at `~4026`).
  - **Maps to:** AC-7, AC-8, AC-9(c-manifest-first)

- [x] **B.5** — Failing test: Edge 3 vault-first — post-apply write-throw → no `syncId` advance → retry
  - **File(s):** `tests/playwright/core/item-price-history-cloud.spec.js` (add case)
  - **Acceptance:** Route a sync through the **vault-first** path (`pullWithPreview` → `showRestorePreviewModal.onApply` → `_applyAndFinalize` → `_vfApplied`-gated companion pull at `~4917`). Stub the post-apply companion write to throw. Assert the full prior `lastPull` is restored, then unstub + re-poll to confirm eventual merge. This case is distinct from B.4 because the snapshot must be captured **inside `onApply` before `_applyAndFinalize`** — a test that only covers the manifest path would leave this snapshot-placement bug unverified (CODEX). Test FAILS today.
  - **Depends on:** A.1
  - **Leverage:** STRK-225 `_vfApplied` gate; `attachments-cloud.spec.js` vault-first scaffolding.
  - **Maps to:** AC-7, AC-8, AC-9(c-vault-first)

## Sprint Cohort C — Implementation · GREEN (sequential)

_TDD green phase. Write the minimum code that turns Cohort B green. All production tasks touch `js/cloud-sync.js` → strictly sequential. Ordered so the shared `failed`-flag primitive (C.1) lands first, then its consumers, then the Edge-1 reorder, then the Edge-3 snapshot/restore work._

- [x] **C.1** — Edge 2 primitive: add `failed` flag to `_pullItemPriceHistoryVault`
  - **File(s):** `js/cloud-sync.js` (`_pullItemPriceHistoryVault`, `~2905`)
  - **Acceptance:** Add `result.failed:boolean` (default `false`), set `true` **only** on the two transient-failure returns — download `!resp.ok` (`~2947-2953`) and decrypt-catch (`~2957-2964`). Benign returns stay `failed:false`: precondition-miss/missing-deps (`~2906-2914`), hash-match skip (`~2919-2924`), 404 (`~2939-2945`). Refresh the stale STRK-147 retry-assumption JSDoc on this function (discovery doc-rot note). No behavioral change yet at call sites — this only enriches the contract.
  - **Depends on:** B.1–B.5 (tests exist and are red)
  - **Leverage:** approach D-2; the `failed` flag `_pollCompanionItemPriceHistory` already returns is the shape to mirror.
  - **Maps to:** AC-4 (foundation for AC-5/AC-6)

- [x] **C.2** — Edge 2: consume `failed` at the poll helper + silent-pull call sites
  - **File(s):** `js/cloud-sync.js` (`_pollCompanionItemPriceHistory` `~2673`; silent-pull sites `~4230`, `~4787`)
  - **Acceptance:** `_pollCompanionItemPriceHistory` returns `{hash, failed:true}` when its inner pull reports `failed`, so the poll bails **without** recording `syncId`/hash. The two silent-pull sites already order `syncSetLastPull` after the pull — guard those existing records on `!failed` (no snapshot needed; their `syncId` hasn't advanced — they are NOT Edge-3 sites). B.3 (poll path) goes green.
  - **Depends on:** C.1
  - **Leverage:** approach D-2 + the "Silent-pull call sites" callout; discovery AC-5 scope note.
  - **Maps to:** AC-4, AC-5 (poll + silent-pull sites), AC-6

- [x] **C.3** — Edge 1: reorder `pollForRemoteChanges` so the companion pre-merge runs only on no-modal exits
  - **File(s):** `js/cloud-sync.js` (`pollForRemoteChanges`, `~2534-2660`)
  - **Acceptance:** Invoke `_pollCompanionItemPriceHistory` inside the **silent fast-path** (before recording `_pollPullMeta`, `~2585-2600`) and inside the **STAK-414 local-newer branch** (before `scheduleSyncPush`, `~2616-2635`); **remove** the unconditional pre-merge that currently runs ahead of `handleRemoteChange` (`~2649`). The DiffModal route now relies on `pullWithPreview`'s existing STRK-225 `_vfApplied`-gated companion pull (`~4917`) to merge on Apply / skip on Cancel. Keep the silent-path record logic byte-for-byte aside from *where* the companion call sits. B.1 + B.2 go green. If this reorder pushes `pollForRemoteChanges` cyclomatic complexity over the Codacy per-function gate, extract the routing decision into a small helper — do **not** weaken the threshold (STRK-169 lesson).
  - **Depends on:** C.2
  - **Leverage:** approach D-1, D-4; STRK-225 `_vfApplied` gate (the apply-gate being reused).
  - **Maps to:** AC-1, AC-2, AC-3

- [x] **C.4** — Edge 1 fallout: add a companion pull to the STAK-470 settings-only auto-merge branch
  - **File(s):** `js/cloud-sync.js` (STAK-470 auto-merge branch, `~4289-4480`)
  - **Acceptance:** Because C.3 removes the pre-merge ahead of the `handleRemoteChange`/`pullWithPreview` route, this **no-modal** version-upgrade auto-merge branch would otherwise silently drop remote price history. Add a companion pull with `failed` handling and **accepted-UUIDs = current inventory** (`_currentInventoryUuids()`, the STRK-147 D-6 boundary — mirror it exactly to avoid orphan import). Also prevent a new Edge 3 here: the branch records `syncSetLastPull` at `~4368` **before** its companion work (`~4397-4472`) — defer that record until after the IPH pull succeeds, or snapshot/restore the full prior `lastPull` for the branch.
  - **Depends on:** C.3, C.1
  - **Leverage:** approach D-5; discovery Constraint "STAK-470 manifest auto-merge has no companion call of its own"; STRK-147 D-6 accepted-UUIDs boundary.
  - **Maps to:** AC-1 (regression guard), AC-5 (sixth call site), AC-7/AC-8 (this branch)

- [x] **C.5** — Edge 3 manifest-first: snapshot/restore `lastPull` around the deferred companion pull
  - **File(s):** `js/cloud-sync.js` (`_deferredVaultRestore`, snapshot before `_applyAndFinalize` `~3956`; companion `~4026`)
  - **Acceptance:** Snapshot the **full** prior `lastPull` object before `_applyAndFinalize` advances `syncId` (`~3598`); if the companion pull returns `failed` or its write throws, restore the whole snapshot (not just `syncId`). Leave `_applyAndFinalize`'s shared settings/tag rollback and its other callers untouched — localize the change to the companion try/catch (KIMI caveat). B.4 goes green.
  - **Depends on:** C.1
  - **Leverage:** approach D-3 (manifest-first half); discovery Edge-3 mapping + `_applyAndFinalize` shared-finalizer caveat.
  - **Maps to:** AC-7, AC-8 (manifest-first)

- [x] **C.6** — Edge 3 vault-first: capture snapshot inside `onApply`, carry via closure to the post-apply pull
  - **File(s):** `js/cloud-sync.js` (`showRestorePreviewModal.onApply` `~3738`; `_vfApplied`-gated companion pull `~4917`)
  - **Acceptance:** Capture the full prior `lastPull` **inside `showRestorePreviewModal.onApply` before `_applyAndFinalize` (`~3738`)** and carry it via closure to the post-apply companion block (`~4917`); restore on `failed`/throw. Do **NOT** snapshot at `~4917` — `syncId` already advanced at `~3598`; a too-late snapshot is a defect (B.5 must fail if the snapshot is post-apply). B.5 goes green.
  - **Depends on:** C.1
  - **Leverage:** approach D-3 (vault-first half) + Risk Note on snapshot placement; STRK-225 `_vfApplied` gate.
  - **Maps to:** AC-7, AC-8 (vault-first)

- [x] **C.7 [P]** — Update the Playwright coverage map for the five new cases
  - **File(s):** `tests/playwright/coverage-map.csv` (active `item-price-sync` row `:93`)
  - **Acceptance:** Update the `item-price-sync` row to reflect all **five** added cases — (a) cancel-with-companion, (b) companion-only silent-merge non-regression guard (B.2), (c) null-hash retry, (d) post-apply write-throw manifest-first, and (e) post-apply write-throw vault-first. Required by AGENTS.md (broader than CLAUDE.md “new spec” — adding cases to an existing spec still needs the row updated; only review catches a stale row). `[P]`-eligible: distinct CSV, no symbol dependency on any `js/cloud-sync.js` task.
  - **Depends on:** B.1–B.5 (final test inventory known)
  - **Leverage:** memory `coverage-map-any-playwright-test-change`; `AGENTS.md` Playwright policy.
  - **Maps to:** AC-9

---

## Standard Closing Tasks

> **Numbering:** CLOSE-1 … CLOSE-8, continuing past sprint task C.7.

- [x] **CLOSE-1. Run full test suite** — zero regressions (301 passed; sole failure = pre-existing numista-catalog flake, passes in isolation, unrelated to cloud-sync)
  - **File:** _no file changes — verification only_
  - Run **`npm test`** (core Playwright PR gate). All existing tests pass; all five new Cohort B cases pass (green after Cohort C). `npm test` is the **only** test verification — there is no CI Playwright gate (memory `ci-no-playwright-local-gate`), so re-run the covering spec after any force-push.
  - If anything fails: fix the implementation, not the test. Tests are the spec.
  - Beware `test 2>&1 | tail` — it masks failures; redirect to a file and check `$?` (memory `feedback_test_pipe_tail_masks_failures`).

- [x] **CLOSE-2. Codacy CLI scan** — security + quality (ESLint9 0, Trivy 0; 5 Lizard complexity warnings ALL pre-existing — verified identical to origin/dev baseline, pollForRemoteChanges CCN 49→49 unchanged; no threshold weakened)
  - **File:** _no file changes — scan only_
  - Run the **`codacy-analysis-cli`** skill against changed files (`codacy-analysis analyze --diff`, Gen-3 Codacy CLI). Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - Watch the per-function complexity gate on `pollForRemoteChanges` (C.3/C.4 grow a hot function — STRK-169: relocating/adding into a hot function can trip a **new** finding). If it trips, extract a helper; never weaken the threshold. Compare against a baseline scan of the same file on `origin/dev` before treating any finding as introduced (the analysis CLI's `--diff` reports pre-existing file issues too).

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to the bottom of this `tasks.md` under `## Verification Stamp`.
  - For EACH acceptance criterion in `requirements.md` (AC-1 … AC-9), write exactly one line:
    - `- [x] AC-N — verified at <relative/file/path>:<line>`, OR
    - `- [x] AC-N — verified by <test name>`, OR
    - `- [ ] AC-N — gap: <one-line reason>`.
  - The block MUST list every AC. For AC-5 ("every call site"), cite the call-site audit (the six `_pullItemPriceHistoryVault` sites) **plus** the B.3 poll-path E2E — a single E2E cannot exercise all six sites, so the audit is the primary evidence.
  - **UI verification:** N/A — approach.md `## UI Contract` is `N/A — no UI surface`. No state requires screenshot/mockup evidence; a test citation suffices for every AC. (Edge 1's cancel path is *exercised* by B.1 via the existing custom-modal pattern, but no UI markup changes.)
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains in the stamp block.

- [x] **CLOSE-4. Version bump** (v3.35.40 — spot bundle refreshed, 6 files bumped, check-release-sync passed, sw.js stamped)
  - **File:** the **six** files the StakTrakr `/release patch` override edits — `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`. Do **not** hand-edit `manifest.json`, `sw.js`, or README badges here: `sw.js` is auto-stamped by the pre-commit hook and the others are outside the override's scope. Let the release skill enumerate the exact set (verified against `.claude/skills/release/SKILL.md:10-12`).
  - **MUST invoke `/release patch`** as a skill — paraphrasing the bump inline is not equivalent (it enforces version-lock claim, file enumeration, and pre-commit interactions).
  - **Precede with `/update-spot-bundle`** — required before **every** version-bump PR (dev or main); the script writes to the main checkout, then copy the bundle into the worktree (`.context/git-topology.md` §Spot Bundle; memory `feedback_spot_bundle_every_version_bump`).
  - This is a runtime change shipping its own PR (not a no-bump campaign), so the bump applies — **not** N/A.

- [x] **CLOSE-5. Vault update** (audit found drift — updated Foundation/cloud-sync.md: six pull call sites + Edge-1 cancel + Edge-2/3 retry semantics, pushed 2f32f87; STRK-224 NOT marked Done — deferred to CLOSE-8)
  - **MUST invoke `/vault-update`** as a skill — it performs the Foundation-doc audit even if you believe none are affected. STRK-224 is internal control-flow hardening with no architecture/infra change, so the likely outcome is "zero changes" — a clean N/A by audit, not a skip. `cloud-sync.js` watermark semantics live in `Foundation/cloud-sync.md`; if the audit flags it, update it.
  - **Do NOT mark STRK-224 Done yet.** Plane closure is post-merge only (`.context/implementation-gotchas.md`: "Mark Plane issues Done only after the PR merges"). STRK-224 stays open through PR + review; the Done update happens in CLOSE-8 after the PR merges and the sketch is archived.

- [x] **CLOSE-6. Open PR** (#1312 → dev, coderabbit-review + codacy-review labels, not merged)
  - Use the `patch/<version>` worktree branch. Title: `fix(STRK-224): harden cloud-sync companion failure/cancel/retry edges` (bug fix; `fix(...)` over `chore(...)`).
  - Target **`dev`** (never push `dev` directly). Body must include: link to [STRK-224](https://plane.lbruton.cc/lbruton/browse/STRK-224/), link to the sketch folder (`DocVault/Projects/StakTrakr/sketches/STRK-224-companion-failure-edges/`), and a test-plan checklist — **four new edge cases (B.1, B.3, B.4, B.5) + one silent-path non-regression guard (B.2)** — so reviewers don't expect B.2 to have gone red in Cohort B.
  - Apply the `coderabbit-review` + `codacy-review` labels at creation (review is label-gated; required `Codacy Static Code Analysis` + CodeQL run regardless). Stage + commit before `gh pr create`; verify `--repo` targets local origin. **Do not merge** — leave ready-to-merge and STOP.

- [x] **CLOSE-7. Resolve PR review threads** (bots caught 4 real edge bugs A1-A4 + duplication gate — all fixed in 103b9fd3, +2 regression tests; 11 threads resolved; Codacy/CodeQL/CodeRabbit all pass, mergeStateStatus CLEAN, 0 unresolved)
  - **File:** _GitHub PR threads only — code fixes land via the worktree as needed_
  - **MUST invoke `/pr-resolve`** as a skill. Scan **both** inline diff threads AND review-body findings (Codacy/Copilot post critical findings as "comments outside of the diff").
  - Critical/High: fix or mark false-positive with explicit reasoning; Medium: fix or document waiver; Low/Info: advisory. Watch the 75% docstring-coverage gate — it blocks merge invisibly (green checks + 0 threads but `CHANGES_REQUESTED`); write JSDoc pre-emptively. Async bots (Copilot, Codacy AI) post threads 1–3 min after checks go green — re-query before declaring clean.

- [ ] **CLOSE-8. Archive sketch + close issue** (after PR merges)
  - **MUST invoke `/sketch archive STRK-224`** as a skill — moves the folder to `archive/YYYY-MM-DD-STRK-224-companion-failure-edges/` and saves the mem0 summary.
  - **Now** mark STRK-224 **Done** in Plane via `mcp__plane__update_issue` (re-fetch the Done state UUID if stale). This is the post-merge closure step relocated from CLOSE-5 — the PR is merged and the sketch archived, so the issue is genuinely complete.

---

> **Multi-model dispatch hint:** Limited parallelism here by design — all production work is one file (`js/cloud-sync.js`) and all tests are one spec, so Cohort A/B/C run sequentially. The one cross-model seam is the natural TDD boundary: one model writes the five Cohort B cases — **four failing red/green edge tests (B.1, B.3, B.4, B.5) plus one green/green non-regression guard (B.2)** — and a different model writes the Cohort C implementation to turn the four red ones green while keeping B.2 green. C.7 (coverage-map) is the lone `[P]` task and can be handed off independently once B is final.

## Review Archive — tasks (2026-06-21)

### Resolution Summary

- **Accepted (2):**
  - **CLOSE-4 release file list** (CODEX + KIMI consensus) — replaced the over-broad list (`manifest.json`, `sw.js`, README badges) with the StakTrakr `/release patch` override's six files; `sw.js` left to the pre-commit hook. Verified against `.claude/skills/release/SKILL.md:10-12`.
  - **CLOSE-5 / CLOSE-8 Plane-Done timing** (CODEX + KIMI consensus) — CLOSE-5 keeps the `/vault-update` audit but no longer marks Done; the Plane Done update moved to post-merge CLOSE-8. Verified against `.context/implementation-gotchas.md:55-56`.
- **Rejected (0):** none — every finding was valid and grounded.
- **Resolved with your input (1):** **B.2 classification** (CODEX + KIMI consensus root finding). Kept B.2 in Cohort B as an explicit **green/green non-regression guard** (not a red/green spec test); relocating it to a post-C.3 cohort was rejected because it would author the regression guard *after* the code it protects, breaking the TDD authoring seam. Cascading rewrites: Cohort B intro (two-kinds-of-test carve-out), B.2 title, C.7 enumeration (now lists all five incl. B.2), CLOSE-6 PR-body, and the dispatch hint — all now read "four failing edge cases + one non-regression guard (B.2)."
- **Verification-only marks archived (no edit):** KIMI anchor confirmations on A.1, C.3, C.4, C.5, C.6 — all line numbers confirmed against `dev` HEAD `0dd17e70`; substance preserved in the KIMI Review "Verified" block below.

---

## CODEX Review (2026-06-21)

### Verified

- Read `DocVault/sketch/conventions.md`, StakTrakr `.context/sketch-conventions.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, `.context/GLOSSARY.md`, repo `AGENTS.md`, and `Projects/StakTrakr/Foundation/coding-standards.md`.
- Read all STRK-224 phase artifacts: `requirements.md`, `discovery.md`, `approach.md`, and `tasks.md`.
- Verified live repo state is `dev` at `0dd17e70`, matching the discovery/approach review anchor.
- Verified current `js/cloud-sync.js` surfaces named by the task plan: poll pre-merge at `:2545`, `_pollCompanionItemPriceHistory` at `:2673`, `_pullItemPriceHistoryVault` at `:2905`, `_applyAndFinalize` recording at `:3598`, manifest-first companion at `:4026`, STAK-470 auto-merge at `:4289-4480`, and vault-first companion at `:4917`.
- Verified test and bookkeeping surfaces: `tests/playwright/core/item-price-history-cloud.spec.js`, `tests/playwright/core/attachments-cloud.spec.js`, `tests/playwright/helpers/vault-fixtures.js`, and `tests/playwright/coverage-map.csv:93`.
- Verified the StakTrakr project release override `.claude/skills/release/SKILL.md` edits six files and delegates `sw.js` stamping to the pre-commit hook.

### Top concerns

1. Cohort B's red-test contract conflicts with B.2: the companion-only non-regression is explicitly allowed to pass before implementation, so it should not be framed as a mandatory failing test.
2. C.7 says five new cases but updates the coverage map for only four, omitting the B.2 companion-only silent merge case if it remains in the test inventory.
3. The closing tasks currently risk workflow drift: CLOSE-4 names release files outside the StakTrakr release override, and CLOSE-5 marks STRK-224 Done before PR open/merge instead of after merge/archive.

### Unverified assumptions

- I did not run Playwright or Codacy; this was a static tasks-phase review against the live repo and project workflow docs.
- I did not re-fetch the Plane issue body; I treated `requirements.md` as the current STRK-224 acceptance contract.

## KIMI Review (2026-06-21)

### Verified

- Re-read the full STRK-224 sketch set: `requirements.md`, `discovery.md`, `approach.md`, and `tasks.md`.
- Verified repo root is `/Volumes/DATA/GitHub/StakTrakr`; `js/cloud-sync.js` is the only production file this sketch modifies.
- Verified all line-number anchors in A.1 against current `dev` HEAD `0dd17e70`:
  - `pollForRemoteChanges` poll path at `js/cloud-sync.js:2534-2649` (pre-merge at `:2545`).
  - `_pollCompanionItemPriceHistory` at `:2673-2718`.
  - `_pullItemPriceHistoryVault` at `:2905-2998` (transient failures at `:2947-2953` and `:2957-2964`).
  - `_applyAndFinalize` records `syncSetLastPull(meta)` at `:3598`.
  - `showRestorePreviewModal.onApply` calls `_applyAndFinalize` at `:3738`.
  - `_deferredVaultRestore` calls `_applyAndFinalize` at `:3956` and companion pull at `:4026`.
  - Silent-pull companion sites at `:4230` and `:4787`.
  - STAK-470 auto-merge branch at `:4289-4480` with no current `_pullItemPriceHistoryVault` call.
  - Vault-first post-apply companion pull at `:4917`.
- Verified `_currentInventoryUuids(items)` exists at `js/cloud-sync.js:2874`.
- Verified test surfaces: `item-price-history-cloud.spec.js` line 517 throw-scaffold exists; `attachments-cloud.spec.js` has a vault-first cancel test at line 659; `vault-fixtures.js` exports `encryptVaultPayload`; `coverage-map.csv:93` is the active row.
- Verified StakTrakr release override (`.claude/skills/release/SKILL.md:10-13`) edits exactly six files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `CHANGELOG.md`, `js/about.js`) and delegates `sw.js` stamping to the pre-commit hook.
- Verified `.context/implementation-gotchas.md` (referenced in `AGENTS.md`) expects Plane issues to be marked Done after PR merge/archive.

### Top concerns

1. **B.2 classification inconsistency.** It is labeled a “Failing test” in Cohort B but explicitly allowed to pass initially, while the cohort intro says every test MUST fail. This contradiction propagates to CLOSE-1, CLOSE-6, and the multi-model dispatch hint.
2. **C.7 coverage-map count mismatch.** The acceptance says “five new cases” but enumerates four, omitting B.2. The same count is repeated in CLOSE-1 and CLOSE-6 without resolving B.2’s status.
3. **CLOSE-4 and CLOSE-5 workflow drift.** CLOSE-4 names release files outside the StakTrakr release override (`manifest.json`, `sw.js`, README badges), inviting manual edits; CLOSE-5 marks STRK-224 Done before PR open/merge, conflicting with the project’s post-merge/archive closure rule.

### Unverified assumptions

- I did not run Playwright or Codacy; verification was static against live source and project docs.
- I did not re-fetch the STRK-224 Plane issue body; I treated `requirements.md` as the acceptance contract.
- I assumed `dev` HEAD `0dd17e70` is the implementation baseline and line numbers have not shifted since `tasks.md` was drafted.
- I assumed B.2’s expected behavior after C.3 is “remains green” rather than “goes red then green,” based on the task’s own note.

---

## Verification Stamp

_STRK-224 — generated 2026-06-21 against worktree `patch/3.35.40` (base `origin/dev` `0dd17e70`). All 12 item-price-sync E2E cases pass; full core suite 301 passed (1 unrelated pre-existing numista-catalog flake, passes in isolation)._

- [x] AC-1 — verified at `js/cloud-sync.js` poll reorder (companion pre-merge removed from ahead of `handleRemoteChange`; now runs only on the silent fast-path + STAK-414 local-newer no-modal exits) + E2E `Edge 1: cancelling a DiffModal that also carries a companion change does not merge or record it`.
- [x] AC-2 — verified by E2E `Edge 1: cancelling a DiffModal that also carries a companion change does not merge or record it` (asserts history unchanged AND `itemPriceHistoryHash`/`syncId` not advanced after Cancel).
- [x] AC-3 — verified by E2E `Edge 1 guard: a companion-only change still merges silently and records its hash (STRK-224 non-regression)` (silent fast-path retains the companion merge; the green/green guard).
- [x] AC-4 — verified at `js/cloud-sync.js` `_pullItemPriceHistoryVault` (`result.failed = true` on the two transient returns — download `!resp.ok` and decrypt-catch) + E2E `Edge 2: a transient companion download failure holds lastPull stale and retries on the next poll`.
- [x] AC-5 — verified by call-site audit: all SIX `_pullItemPriceHistoryVault` sites consume `failed` — `:2690` poll helper (C.2), `:4068` manifest-first (C.5), `:4297` manifest silent-pull (C.2), `:4565` STAK-470 auto-merge (C.4, the new sixth site), `:4917` vault-first silent-pull (C.2), `:5071` vault-first post-apply (C.6). The poll path is additionally exercised by the B.3 E2E (a single E2E cannot drive all six sites — the audit is the primary evidence).
- [x] AC-6 — verified by E2E `Edge 2: ...` (the healthy second poll merges; the stale `syncId` did not trip the same-syncId shortcut into skipping).
- [x] AC-7 — verified at `js/cloud-sync.js` snapshot-before-`_applyAndFinalize`/restore-on-throw (manifest-first `_deferredVaultRestore`, vault-first pre-modal capture) + E2Es `Edge 3 (manifest-first): ...` and `Edge 3 (vault-first): ...` (assert full prior `lastPull` intact after the write-throw).
- [x] AC-8 — verified by E2Es `Edge 3 (manifest-first): ...` and `Edge 3 (vault-first): ...` (the retry pull merges after the write-throw).
- [x] AC-9 — verified by the five new E2E cases in `tests/playwright/core/item-price-history-cloud.spec.js`: (a) Edge-1 cancel (B.1), (b) Edge-2 null-hash retry (B.3), (c-manifest-first) post-apply write-throw (B.4), (c-vault-first) post-apply write-throw (B.5), plus the B.2 companion-only silent-merge non-regression guard. Coverage-map `item-price-sync` row updated.

**UI verification:** N/A — `approach.md` `## UI Contract` is `N/A — no UI surface`. No markup changes; Edge-1's cancel path is *exercised* by B.1 via the existing `#restorePreviewModal`/`#appDialogModal` custom-modal pattern, but no UI state changes — a test citation suffices for every AC.

**Fixture note (user-approved, scope clarified):** the C.3 reorder required updating **five** pre-existing companion-only poll tests (converge, orphan, poll-shortcut, silent-no-modal, quota) — not the two originally estimated — to drive the silent fast-path (matching `inventoryHash`, no `settingsHash` → `settingsMatch` defaults true). They previously passed only via the removed unconditional pre-merge; all assertions are unchanged.
