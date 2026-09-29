---
tags: [requirements, sketch, staktrakr]
issue: STRK-146
version: 3.35.9
created: 2026-06-06
updated: 2026-06-06
---

# Requirements — STRK-146 Image storage near quota (silent write failure)

## References

- **Issue:** STRK-146 — "Image storage near quota: writes fail silently → broken 'colored squares', no user warning"
- **Plane:** https://plane.lbruton.cc/lbruton/browse/STRK-146/
- **Branch:** `patch/3.35.9`
- **Reported by:** beta tester PumpkinCrouton (r/Silverbugs, 2026-06-03) at 95.5% local / 96.3% user-image storage.

## Problem

User-uploaded images live in IndexedDB (`StakTrakrImages` → `userImages`). When the store
nears quota, `cacheUserImage()` returns `false` and every interactive caller discards it, so
the write fails **silently** and the image renders as a broken/colored placeholder square.
No warning fires as the store fills, and no error surfaces when an individual save fails.

This is a quota-pressure **UX gap**, NOT a storage-backend migration (distinct from
STRK-139/140/141, which moved _market-history_ to IndexedDB / compressed it). Images already
live in IndexedDB.

## Functional Requirements (EARS)

- **REQ-1 (Warn before failure).** WHEN a user-image save completes AND user-image storage is
  at or above 85% of the soft quota (`_quotaBytes`), the system SHALL surface a non-blocking
  warning toast advising the user to free space, AND SHALL escalate the message at ≥95%.
- **REQ-2 (No repeat spam).** WHILE storage stays in the same pressure band, the system SHALL
  NOT re-warn on every subsequent save — it warns only when the pressure band increases
  (ok → warn → critical), and re-arms after usage drops back below a band.
- **REQ-3 (Explicit save-failure).** WHEN an interactive image save fails because storage is
  full (pre-flight soft-cap exceeded OR a real `QuotaExceededError`), the system SHALL show an
  explicit error toast instead of leaving a silent broken square.
- **REQ-4 (Pre-flight soft-cap guard).** WHEN an interactive image save would push user-image
  storage past `_quotaBytes`, the system SHALL refuse the write and report `quotaExceeded`
  WITHOUT attempting the doomed put (so the failure is detected even on `file://`, where the
  browser estimate is unavailable and real `QuotaExceededError` may not fire at our soft cap).
- **REQ-5 (Background paths unchanged).** Non-interactive saves (split-clone copy, partial-side
  re-saves that shrink the record) SHALL retain their current silent behavior — they only gain
  a more accurate quota-specific console warning, no toast.

## Non-Functional Requirements

- **NFR-1 (Performance).** The pre-flight/warning path SHALL compute storage usage at most once
  per interactive save (no per-store re-scan loops); background bulk paths SHALL NOT trigger a
  scan.
- **NFR-2 (Backward compatibility).** `cacheUserImage()`'s existing boolean signature SHALL be
  preserved so the four untouched call sites keep working.
- **NFR-3 (No new deps, vanilla JS).** Implemented with existing globals (`showToast`,
  `getStorageUsage`); no new libraries, runs on `file://` and HTTP.
- **NFR-4 (Theme/locale).** Toasts use the existing toast component (all four themes) and
  Canadian-English date conventions where dates appear.

## Acceptance Criteria (from the issue)

1. Approaching the image-storage quota shows a clear warning before failures occur. → REQ-1/2
2. A failed image save shows an explicit error rather than a silent broken square. → REQ-3/4
3. Behavior verified near quota (simulate with a lowered `_quotaBytes`). → REQ-4 makes this
   deterministically testable.

## Out of Scope (deferred)

- The issue's _optional_ "auto/aggressive downscale under pressure" (re-encode at lower
  `IMAGE_MAX_DIM`/`IMAGE_QUALITY` when full). Tracked as a possible follow-up; not in 3.35.9.
- Storage-efficiency of shared images (`sharedImageId` may store duplicate blobs per item) —
  separate question, flagged in discovery, not addressed here.
