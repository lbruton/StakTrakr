---
tags: [discovery, sketch, staktrakr]
issue: STRK-146
version: 3.35.9
created: 2026-06-06
updated: 2026-06-06
---

# Discovery — STRK-146

All file:line references verified against `origin/dev` @ `25c4d5f5` (worktree `patch/3.35.9`).

## Root-cause verification (issue claims vs live code)

| Claim                                                                              | Status | Evidence                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `cacheUserImage()` returns `false` on failure                                      | ✅     | `js/image-cache.js:434-467` → delegates to `_put` (`:721-731`), which catches **all** errors generically and returns `false` |
| Callers swallow the boolean                                                        | ✅     | 6 of 7 sites discard it; only `js/events.js:809` captures `saved` and only `debugLog`s it                                    |
| `getUserImageUrl()` returns `null` for missing/zero-size blob                      | ✅     | `js/image-cache.js:413-419` → null → placeholder render                                                                      |
| `_initQuota()` = 60% of available, min 500 MB, max 4 GB; `file://` stays at 500 MB | ✅     | `js/image-cache.js:31-45`                                                                                                    |
| No pre-write threshold warning                                                     | ✅     | `_quotaBytes` is computed but **never gates a write** — only feeds the display meter                                         |

**Understated nuance:** `_put` does not distinguish `QuotaExceededError` from any other failure,
so a quota failure is indistinguishable from a transient DB error today (both → silent `false`).

## Caller classification (all 7 `cacheUserImage` call sites)

**Interactive uploads (user actively uploading → must get feedback):**

- `js/events.js:809` — `saveUserImageForItem` (view-modal manual + Numista save). Called by
  `js/events.js:2435` which captures `const saved`. **The path PumpkinCrouton hit.**
- `js/bulkEdit.js:2058` — `_handleUpload` (bulk-table image popover).
- `js/inventory.js:2833` — `_handleUpload` (inline thumbnail popover, Upload + Camera).

**Re-saves that shrink the record (cannot exceed quota → stay silent):**

- `js/events.js:850` (partial-side delete re-save), `js/bulkEdit.js:2098` (`_handleRemove`),
  `js/inventory.js:2873` (remove re-save).

**Background copy (silent by design — "non-blocking"):**

- `js/inventory.js:1432` — `splitInventoryItem` clone copy (note: duplicates image bytes).

## Prior art (makes the fix cheap)

- **`js/attachment-manager.js:128-146`** (`addAttachment`) already implements the exact
  quota-classification pattern REQ-3 wants: catches `QuotaExceededError` /
  `NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR` specifically and warns. Mirror this in image-cache `_put`.
- **Storage meter already exists:** `js/settings.js:3288+` renders `#imageStorageStats` with a
  color-coded bar (turns `var(--danger)` > 90%); `js/image-cache-modal.js:353` reads usage.
  So measurement + a danger threshold already exist — the gap is _proactive_ (toast) feedback
  during upload, when the user isn't looking at Settings.
- **`showToast` global** exists (`js/init.js:181`, used throughout `js/changeLog.js`).
- **`getStorageUsage()`** (`js/image-cache.js:257-324`) already returns `userImageBytes`,
  `totalBytes`, `limitBytes` — reused for the pre-flight check and the warning.

## Effect of last week's work

- v3.35.1 (STRK-140): lz-string compression of market history (~80% reduction).
- v3.35.3 (STRK-141): market history → IndexedDB; item price history capped.
- These gutted the biggest localStorage hog, so hitting the wall is **less likely** — but they
  touched none of the image write-failure path. The heavy user (and any `file://` user capped
  at 500 MB) can still hit it. STRK-146 is the remaining loose thread and a silent-data-loss /
  trust issue, not a nice-to-have.

## Open observation (out of scope, flag only)

`cacheUserImage` stores the `obverse`/`reverse` blobs **and** a `sharedImageId` pointer
(`js/image-cache.js:455-462`). It is not confirmed whether the shared path dedupes bytes or
stores a full copy per item. If it copies, the "use bulk image tags" advice helps users
organizationally but not on storage footprint. Worth a separate investigation/issue.
