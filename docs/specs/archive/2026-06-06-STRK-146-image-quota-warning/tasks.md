---
tags: [tasks, sketch, staktrakr]
issue: STRK-146
version: 3.35.9
created: 2026-06-06
updated: 2026-06-06
---

# Tasks — STRK-146 (sketch, no per-phase peer review)

## References

- **Issue:** STRK-146 (→ In Review) | **Version:** v3.35.9 | **Branch:** `patch/3.35.9`
- **PR:** [#1218](https://github.com/lbruton/StakTrakr/pull/1218) (draft → dev) | **Commit:** `70047c4a`
- **Worktree:** `.worktrees/patch-3.35.9` (created, deps installed, merge-base == origin/dev)
- **PR target:** `dev`

> Sketch workflow: tasks marked `[x]` directly (no `log-implementation` gate). No CodeRabbit /
> Codacy peer-review tasks per the user's "no per-phase peer reviews" choice — a normal
> pre-PR Codacy/CI pass still runs on the PR.

## Phase 0 — Setup (done)

- [x] 0.1 Version lock (v3.35.9) + worktree on `origin/dev` + `npm install`.

## Phase 0 — TDD foundation

- [x] 0.5 Test baseline — `npm run test:core` = **181 passed (3.5m)**, exit 0 (clean baseline).
- [x] 0.6 Write failing tests `tests/playwright/core/strk-146-image-quota-warning.spec.js` (5 tests) + coverage-map row.
  covering the 4 cases in approach.md (pre-flight error, warning band, regression no-toast,
  no-spam). Add a `coverage-map.csv` row. Tests must FAIL now (methods don't exist yet).

## Phase 1 — Storage layer (`js/image-cache.js`)

- [x] 1. `_put(storeName, record, onError?)` — add optional `onError`; classify
  `QuotaExceededError` / `NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR` in the catch (quota-specific
  console.warn). Existing 2-arg callers unaffected.
- [x] 2. Add `_pressureLevel(used, limit)` and `_emitStorageToast(message, duration=6000)`
  (defensive `typeof showToast`). Constructor: `this._lastWarnedLevel = "ok"`.
- [x] 3. Add `cacheUserImageResult(uuid, obv, rev, sharedImageId)` → `{ok, quotaExceeded,
  usageBytes, limitBytes}` with the pre-flight soft-cap check (delta-aware) + `_put` backstop.
  Move `cacheUserImage`'s validation/db-ensure logic in; make `cacheUserImage` a thin
  `(await cacheUserImageResult(...)).ok` wrapper (boolean contract preserved).
- [x] 4. Add `cacheUserImageWithFeedback(...)` → boolean: error toast on `!ok`, escalation-only
  warning toast on success, update `_lastWarnedLevel`.

## Phase 2 — Wire interactive callers (feedback only at upload choke points)

- [x] 5. `js/events.js:809` `saveUserImageForItem` → `cacheUserImageWithFeedback`.
- [x] 6. `js/bulkEdit.js:2058` `_handleUpload` → `cacheUserImageWithFeedback`.
- [x] 7. `js/inventory.js:2833` thumbnail `_handleUpload` → `cacheUserImageWithFeedback`.
  (Leave the 3 shrinking re-saves + `inventory.js:1432` split-clone copy on plain
  `cacheUserImage` — silent by design.)

## Phase 3 — Verify & ship

- [x] 8. New spec 5/5 green (red→green). Full `npm run test:core` = **185 passed, 0 real
  failures** (1 flake: `history-store-migration.spec.js:331`, unrelated STRK-141 market-history;
  11/11 in isolation). ESLint + Prettier clean.
- [x] 9. Codacy CLI scan: `cacheUserImageResult` CC reduced 12→≤8 (helper extraction); remaining
  findings false-positive (globals config) or pre-existing. No new actionable Critical/High.
- [x] 10. Version bump → 3.35.9 (6 files + What's New=8 verified); `sw.js` auto-stamped
  `staktrakr-v3.35.9-b1780759447`. `/update-spot-bundle` ran — already current (no-op).
- [~] 11. STRK-146 → **In Review** in Plane. `/vault-update` + set Done deferred to post-merge.
- [x] 12. Committed `70047c4a` on `patch/3.35.9`, pushed, draft PR #1218 → `dev`. Merge-base ==
  origin/dev verified.

## Notes

- Out of scope (deferred follow-ups): aggressive auto-downscale under pressure; `sharedImageId`
  storage-dedup investigation (see discovery.md).
