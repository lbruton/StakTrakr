---
sketch: STRK-108-cloud-sync-tags
phase: tasks
created: 2026-05-25
approved: 2026-05-25
---

# STRK-108 — Tasks

_Concrete checklist grouped into Sprint Cohorts. `[P]` marks tasks that can run in parallel within a cohort. Tasks reference file paths from approach.md._

> **Approval gate:** `/sketch apply` refuses to run unless the `approved:` frontmatter field above contains a date in `YYYY-MM-DD` format, ≤14 days old. Stamp it only after reviewing all four sketch files.

> **Skill-name discipline:** Closing tasks below name specific skills (`/release patch`, `/vault-update`, `codacy-cli`, `/pr-resolve`, `/sketch archive`). When generating or executing tasks.md, **invoke skills by name verbatim** — paraphrasing the steps inline is not equivalent because the skill enforces project-specific rules the prose can't carry.

## Sprint Cohort 0 — Setup (sequential)

_Cohort 0 ensures the worktree exists before implementation begins._

- [x] **0.1** — Ensure patch worktree exists
  - **File(s):** _no file changes — verification only_
  - **Acceptance:** `git worktree list` shows a patch worktree branched from `origin/dev` (post-STRK-107 merge aed3ce88). Working directory is that worktree. Version lock claimed via `/start-patch`.
  - **If the worktree does not exist yet:** Invoke `/start-patch` to pick STRK-108, claim version lock, and create the worktree. Branch from fresh `origin/dev`.
  - **Leverage:** `/start-patch` skill; StakTrakr worktree convention (`.worktrees/patch-<version>/`).

## Sprint Cohort A — Foundation (parallel-safe where marked)

_Scaffolding: constants, timestamp infrastructure, and batch-caller stamp wiring. A.1 and A.2 touch independent files and can run in parallel. A.3 depends on A.2 (needs `stampTagTimestamp` to exist on `window`)._

- [x] **A.1 [P]** — Add tag sync constants and scope keys
  - **File(s):** `js/constants.js`
  - **Acceptance:** `ITEM_TAGS_LAST_MODIFIED_KEY` constant defined (value `"itemTagsLastModified"`). `ITEM_REMOVED_TAGS_KEY` constant defined (value `"itemRemovedTags"`). Both `"itemRemovedTags"` and `"itemTagsLastModified"` added to `SYNC_SCOPE_KEYS` array. `"itemTagsLastModified"` added to `ALLOWED_STORAGE_KEYS` array. Both new constants exposed on `window`.
  - **Leverage:** Existing `ITEM_TAGS_KEY` pattern at `:630`; `SYNC_SCOPE_KEYS` at `:852`; `ALLOWED_STORAGE_KEYS` at `:1018`.
  - **Maps to:** AC-2, AC-4

- [x] **A.2 [P]** — Add timestamp infrastructure to tags.js
  - **File(s):** `js/tags.js`
  - **Acceptance:** Three new functions exist: `loadTagTimestamps()` (returns `{ [uuid]: number }` from localStorage), `saveTagTimestampsDirect(map)` (writes via `saveDataSync`, does NOT call `scheduleSyncPush`), and `stampTagTimestamp(uuids)` (loads current map, stamps `Date.now()` for each UUID, saves). All three exposed on `window`. Mutators updated: `addItemTag` (when `persist=true`), `removeItemTag`, `deleteItemTags`, `renameTag`, `deleteTagGlobal` each call `stampTagTimestamp` with affected UUID(s) after mutation. `persist=false` contract comment added to `addItemTag` JSDoc noting callers must stamp manually.
  - **Leverage:** Existing `loadDataSync`/`saveDataSync` pattern; `loadItemTags()` as structural model.
  - **Maps to:** AC-2

- [x] **A.3** — Wire `stampTagTimestamp` into batch callers
  - **File(s):** `js/inventory.js`, `js/inventory-import.js`, `js/events.js`, `js/tags.js`
  - **Acceptance:** Every `addItemTag(uuid, tag, false)` batch site has a `stampTagTimestamp([uuid])` call inserted after the batch loop completes and before `saveItemTags()` is called. Known sites (10 total):
    - `inventory.js:1253` — split/clone tags
    - `inventory.js:1817` — edit-modal multi-tag
    - `inventory-import.js:47` — CSV import tags
    - `inventory-import.js:168` — JSON import tags
    - `inventory-import.js:561` — merge import tags
    - `inventory-import.js:1444` — pending tags on import
    - `events.js:2028` — add-item pending tags
    - `events.js:2302` — clone-item pending tags
    - `tags.js:~405` — applyNumistaTags persist=true batch
    - `tags.js:~564` — commitTag editable tag input
  - **Depends on:** A.2 (stampTagTimestamp must exist on `window`)
  - **Leverage:** Each site follows the pattern: batch `addItemTag(..., false)` → `stampTagTimestamp([uuid])` → `saveItemTags()`.
  - **Maps to:** AC-2

## Sprint Cohort B — Tests · RED (sequential)

_TDD red phase. Write Playwright tests encoding all ACs. Tests MUST fail because cloud-sync.js merge logic does not exist yet._

- [x] **B.1** — Write failing cloud sync tag tests
  - **File(s):** `tests/playwright/cloud-sync-tags.spec.js` (new)
  - **Acceptance:** Test file contains at least 6 test cases mapping to the ACs:
    1. AC-1: Tags from a constructed remote payload appear in localStorage after merge (via `_applyAndFinalize` with `remoteTagData`)
    2. AC-2: Per-UUID last-writer-wins — remote UUID with newer timestamp wins; local UUID with newer timestamp is preserved
    3. AC-3: `window.itemTags` (in-memory) matches localStorage after merge (loadItemTags refresh)
    4. AC-4: `itemRemovedTags` merge + re-add-wins conflict rule (tag present in winning `itemTags` → removal discarded)
    5. AC-5: Tag-only remote change (no item/settings diff) is detected and merged — silent-pull guard does not swallow it
    6. STAK-470: One-sided settings auto-merge path routes tag keys through `_mergeTagData()` instead of raw `localStorage.setItem`
    All tests fail (red) when run against current `origin/dev` code.
  - **Depends on:** A.1, A.2 (tests reference the new constants and timestamp functions)
  - **Leverage:** Existing test patterns in `tests/` — construct localStorage state via `page.evaluate`, trigger sync pull flow via exposed cloud-sync helpers.
  - **Maps to:** AC-1, AC-2, AC-3, AC-4, AC-5

## Sprint Cohort C — Implementation · GREEN (sequential)

_TDD green phase. All tasks modify `js/cloud-sync.js`. Each builds on the prior — strictly serial._

- [x] **C.1** — Add skip guards for new keys in settings-diff loops
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** All three settings-diff loops (deferred vault `:~3134`, manifest-first `:~3326`, vault-first `:~3772/3779`) now skip `"itemRemovedTags"` and `"itemTagsLastModified"` alongside the existing `"itemTags"` skip. Pattern matches existing `itemTags` guard structure.
  - **Maps to:** AC-4 (prerequisite — prevents new keys from falling through generic settings-diff)

- [x] **C.2** — Implement `_hasTagChanges()` and widen the silent-pull guard
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** New private function `_hasTagChanges(remoteSettings)` compares three raw localStorage strings (`itemTags`, `itemRemovedTags`, `itemTagsLastModified`) against the remote equivalents. Returns `true` if any differ. The silent-pull guard at `:~3345` calls `_hasTagChanges()` — when it returns `true`, execution continues to `_applyAndFinalize()` instead of the early return.
  - **Depends on:** C.1 (skip guards must be in place first so new keys don't interfere with settings-diff)
  - **Maps to:** AC-5

- [x] **C.3** — Implement `_mergeTagData()` helper
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** New private function `_mergeTagData(remoteTagData)` implements the algorithm from approach.md: per-UUID last-writer-wins comparison using `itemTagsLastModified`, re-add-wins pass, writes via `saveDataSync()` (NOT `saveItemTags()`), and calls `loadItemTags()` at the end. Returns `{ merged: true, uuidsUpdated: number }` for rollback tracking. Handles cold-start gracefully (missing timestamps default to `0`). Remote tag strings (`itemTags`, `itemRemovedTags`, `itemTagsLastModified`) arrive as raw `localStorage.getItem()` values — decode them with the same semantics as `loadDataSync()` before per-UUID comparison (do NOT compare or merge raw JSON/compressed strings directly).
  - **Depends on:** C.1 (uses constants defined in A.1)
  - **Maps to:** AC-1, AC-2, AC-3, AC-4

- [x] **C.4** — Wire `_mergeTagData` into `_applyAndFinalize()` call sites
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** `_applyAndFinalize()` signature gains an `options.remoteTagData` parameter. All three call sites (deferred vault `:~3153`, DiffModal preview `:~2945`, vault-first) extract `itemTags`, `itemRemovedTags`, `itemTagsLastModified` from their respective remote payloads and pass them in `options.remoteTagData`. Inside `_applyAndFinalize()`, if `options.remoteTagData` is present, `_mergeTagData()` is called and its result participates in the existing rollback gate (failure → pull not recorded).
  - **Depends on:** C.3
  - **Maps to:** AC-1, AC-2, AC-3, AC-4

- [x] **C.5** — Route STAK-470 auto-merge path through `_mergeTagData()`
  - **File(s):** `js/cloud-sync.js`
  - **Acceptance:** The STAK-470 one-sided-settings auto-merge path (`:~3441-3609`) now has skip-guards for `itemTags`, `itemRemovedTags`, and `itemTagsLastModified`. When any of these keys appear in the one-sided diff, they are extracted, passed to `_mergeTagData()` as a batch, and excluded from the raw `localStorage.setItem` iteration for remaining non-tag keys.
  - **Depends on:** C.3, C.4
  - **Maps to:** AC-5 (tag-only changes arriving as one-sided settings are properly merged)

---

## Standard Closing Tasks

- [x] **CLOSE-1. Run full test suite** — zero regressions
  - **File:** _no file changes — verification only_
  - Run `npm test`. All existing tests pass; all new tests from Cohort B pass (green after Cohort C implementation).
  - If anything fails: fix the implementation, not the test.

- [x] **CLOSE-2. Codacy CLI scan** — security + quality
  - **File:** _no file changes — scan only_
  - Run `codacy-cli` skill against changed files. Triage: Critical/High must fix, Medium fix-or-document, Low/Info advisory.
  - **Note:** Revert `.codacy/codacy.yaml` tool-addition mutations before committing (known CLI side effect per CLAUDE.md).

- [x] **CLOSE-3. Generate verification stamp**
  - **File:** Append to bottom of `tasks.md` (this file) under heading `## Verification Stamp`.
  - For EACH acceptance criterion (AC-1 through AC-5), write exactly one line:
    - `- [x] AC-N — verified at <path>:<line>` or `- [x] AC-N — verified by <test name>`
    - `- [ ] AC-N — gap: <reason>` (if unverified)
  - Refuse to proceed to CLOSE-4 if any `[ ]` remains.

- [x] **CLOSE-4. Version bump**
  - **File:** project version files
  - **MUST invoke `/release patch`** — not hand-edit. Includes `/update-spot-bundle` (run before version bump per CLAUDE.md pre-flight).
  - **Leverage:** `/release` skill handles 6-file bump + `stamp-sw-cache` hook.

- [x] **CLOSE-5. Vault update**
  - **MUST invoke `/vault-update`** — the skill audits whether `Foundation/cloud-sync.md` needs updating (it almost certainly does given the new merge logic and payload schema changes).

- [x] **CLOSE-6. Open PR**
  - Use worktree branch from `/start-patch`. Title: `vVERSION — STRK-108: cloud sync tag merge` (fill version from CLOSE-4 bump).
  - Body includes: link to STRK-108, link to sketch folder, test plan checklist referencing all 6 test cases.
  - **Note:** `cloud-sync.js` is security-sensitive — expect `/sketch-review` (Opus) peer review requirement.

- [x] **CLOSE-7. Resolve PR review threads**
  - **MUST invoke `/pr-resolve`** — scan both inline diff threads AND review-body findings (Codacy, Copilot, CodeRabbit).
  - All Critical/High findings: fix or mark false-positive with reasoning. Medium: fix or document.

- [ ] **CLOSE-8. Archive sketch + close issue** (after PR merges)
  - **MUST invoke `/sketch archive STRK-108`** — moves folder to `archive/2026-MM-DD-STRK-108-cloud-sync-tags/` and saves mem0 summary.
  - Mark STRK-108 Done in Plane: `mcp__plane__update_issue` to state "Done".

---

## Sprint Cohort Summary

| Cohort | Tasks | Parallelizable | Key File(s) |
|--------|-------|----------------|-------------|
| 0 | 0.1 | — | worktree setup |
| A | A.1, A.2, A.3 | A.1 ∥ A.2; A.3 serial after A.2 | constants.js, tags.js, inventory.js, inventory-import.js, events.js |
| B | B.1 | — | tests/playwright/cloud-sync-tags.spec.js |
| C | C.1–C.5 | all serial (same file) | cloud-sync.js |
| Closing | CLOSE-1–8 | serial | various |

## Review Archive — tasks (2026-05-25)

_Reconciled by /sketch reconcile on 2026-05-25. Original reviewer marks preserved below for audit._

### Codex

#### Verified

- Verified no prior unreconciled CODEX review existed in this `tasks.md` before adding comments.
- Verified task file map against the live tag mutation surface: `js/tags.js` exposes tag mutators globally and contains additional `addItemTag(..., false)` batch sites at `js/tags.js:400-405` and `js/tags.js:560-564`; other listed batch sites exist in `js/inventory.js`, `js/inventory-import.js`, and `js/events.js`.
- Verified test discovery: `playwright.config.js:4` sets `testDir: "./tests/playwright"`, and existing `*.spec.js` files are under `tests/playwright/`, so `tests/cloud-sync-tags.spec.js` would not be discovered by the configured suite.
- Verified sync payload shape: `collectVaultData("sync")` stores raw `localStorage.getItem()` values in `payload.data` (`js/vault.js:328-342`), manifest settings snapshots store raw values (`js/cloud-sync.js:1152-1160`), and vault-first code documents `remotePayload.data` as raw localStorage strings (`js/cloud-sync.js:3738-3742`).
- Verified current cloud-sync skip/early-return surfaces named by the task plan: `_applyAndFinalize()` applies settings with rollback on write failure (`js/cloud-sync.js:2686-2783`), settings loops skip `itemTags` today (`js/cloud-sync.js:3133-3138`, `js/cloud-sync.js:3323-3328`, `js/cloud-sync.js:3768-3780`), and the STAK-470 auto-merge branch raw-writes one-sided settings (`js/cloud-sync.js:3441-3501`).

#### Top concerns

1. A.3 misses two live `persist=false` tag batch paths in `js/tags.js`, which can leave successful tag edits unstamped and undermine last-writer-wins.
2. B.1 creates tests outside Playwright's configured `testDir`, so the new AC coverage may not run under `npm test`.
3. C.3/C.4 do not explicitly require decoding raw remote tag strings before merge, even though both manifest and vault payloads carry raw localStorage values.

#### Unverified assumptions

- `_mergeTagData()` can reuse existing decompress/parse helpers cleanly for remote strings without requiring a temporary localStorage write.
- Timestamp stamping every successful `persist=false` batch in `js/tags.js` will not double-stamp paths where a caller also invokes a higher-level helper.
- The six Playwright tests can exercise private cloud-sync helpers without adding temporary test-only globals or weakening encapsulation.
- Moving Plane Done to post-merge will not conflict with the user's current Plane status policy for sketch-driven patch work.

### Resolution Summary

- Accepted: 6
- Rejected: 0
- Resolved with your input: 0

## Verification Stamp

- [x] AC-1 — verified by `cloud sync tag merge › AC-1 — selective merge applies remote item tags`
- [x] AC-2 — verified by `cloud sync tag merge › AC-2 — per-UUID last-writer-wins preserves newer local tags`
- [x] AC-3 — verified by `cloud sync tag merge › AC-3 — merge refreshes in-memory itemTags`
- [x] AC-4 — verified by `cloud sync tag merge › AC-4 — removed tags merge and re-add wins over removal`
- [x] AC-5 — verified by `cloud sync tag merge › AC-5 — tag-only remote changes are detected before silent pull`
