---
sketch: "STRK-162-image-usage-cache"
phase: requirements
created: 2026-06-06
---

# STRK-162 — Requirements

> **Source Issue:** [STRK-162](https://plane.lbruton.cc/lbruton/browse/STRK-162/)
> **Title:** Cache user-image storage usage (O(1) pre-flight) instead of full-store scan per save
>
> **Context (from issue):** Follow-up from STRK-146 (PR #1218 Codacy review, MEDIUM). The STRK-146 quota guard calls `_userImagesBytes()` on every interactive image save, which does an O(N) cursor scan of the `userImages` store. The scan reads each record's `size` field plus blob _references_ (blob data is not deserialized, so GC pressure is bounded) and matches the pre-existing `getStorageUsage()` pattern — but it still scales linearly with the number of stored images, on the exact path heavy-image users hit most.
>
> **Proposed optimization (from issue):**
>
> - Maintain a cached `userImages` byte total on the `ImageCache` singleton, computed lazily on first need.
> - Update it incrementally in `cacheUserImageResult()` after a successful put (it already knows `used` + `delta`).
> - Invalidate (null → recompute) on the other mutation paths: `deleteUserImage`, `clearAll`, `importUserImageRecord`.
> - This makes the pre-flight check O(1) amortized while keeping invalidation conservative (any external mutation forces a fresh scan).
>
> **Acceptance criteria (from issue):**
>
> - Pre-flight quota check no longer performs a full-store scan on every save once the cache is warm.
> - Cache stays correct across save / delete / clearAll / import (add a test exercising delete-then-save).
> - No regression in the STRK-146 warning/error toast behavior.
>
> **Notes (from issue):** Deferred from STRK-146 deliberately: adding a usage cache introduces coherency surface across 4+ mutation paths and warrants its own scoped change + tests rather than a bolt-on under PR review pressure. The HIGH-risk legacy-record accuracy issue from the same review WAS fixed in STRK-146 (both `_recordSize` delta and `_userImagesBytes` sum now handle records lacking `size`).

## Overview

Replace the O(N) full-store cursor scan that `cacheUserImageResult()` runs on **every** interactive image save (the STRK-146 quota pre-flight, [js/image-cache.js:533](../../../../../StakTrakr/js/image-cache.js)) with an amortized O(1) cached byte total maintained on the `ImageCache` singleton. The cache is computed lazily on first need, incremented by the net record delta after each successful save, and invalidated (set to recompute) on the other three mutation paths. This keeps the hot save path fast as a user's image library grows, while keeping the STRK-146 quota warning/block behavior byte-for-byte unchanged. Conservative invalidation (increment only where the exact delta is known; recompute everywhere else) is the safety property that prevents the cached total from drifting.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a heavy-image user with hundreds of cached images, I want each image save to stay fast as my library grows, so that the app does not get progressively more sluggish on the exact path I use most.
- **US-2:** As any user, I want the storage-quota warnings and overflow blocks to stay exactly as accurate after this optimization, so that I am still protected from silent write failures.

## Acceptance Criteria

> EARS syntax. Each line is individually testable and becomes a TDD Cohort B assertion.

### AC-1 (maps to US-1) — warm-cache pre-flight skips the scan

- **WHILE** the user-image usage cache is warm (non-null), the `ImageCache` **SHALL** satisfy the `cacheUserImageResult` pre-flight quota check **without** performing a full-store cursor scan of the `userImages` store.
- _Verifiable:_ spy/instrument `_userImagesBytes` (or the underlying `_iterate("userImages", …)`); it is **not** invoked on a save when the cache is warm.

### AC-2 (maps to US-1) — lazy first computation

- **WHEN** the usage total is needed and the cache is cold (null), the `ImageCache` **SHALL** compute it exactly once via a single `userImages` scan and retain the result for subsequent reads.
- _Verifiable:_ first need triggers one scan; an immediately following need triggers zero additional scans.

### AC-3 (maps to US-2) — incremental update on success

- **WHEN** a `cacheUserImageResult` write completes successfully, the `ImageCache` **SHALL** update the cached usage total by the net record delta, where the delta is positive for new or grown records and negative for a shrinking in-place replace.
- _Verifiable:_ after a successful save the cached total equals the prior total plus the signed delta, including a shrink case.

### AC-4 (maps to US-2) — no update on a non-write

- **IF** a `cacheUserImageResult` call returns without a successful put (pre-flight quota block, or an IndexedDB quota/`_put` error), **THEN** the `ImageCache` **SHALL** leave the cached usage total unchanged.
- _Verifiable:_ a pre-flight-blocked save and a forced `_put` failure each leave the cached total identical to its pre-call value.

### AC-5 (maps to US-2) — invalidation on the other mutation paths

- **WHEN** `deleteUserImage`, `clearAll`, or `importUserImageRecord` mutates the store, the `ImageCache` **SHALL** invalidate the cached usage total so the next read recomputes it from a fresh scan.
- _Verifiable (load-bearing):_ a **delete-then-save** sequence reflects the deletion in the post-save total — i.e. the save's pre-flight `used` does not include the deleted record's bytes.

### AC-6 (maps to US-2) — no STRK-146 regression

- The `ImageCache` **SHALL** preserve the STRK-146 quota behavior unchanged: the pre-flight overflow block (`delta > 0 && used + delta > limit`), the returned `usageBytes`/`limitBytes`, and the pressure-band warning toasts (`ok`/`warn`/`critical` thresholds and copy).
- _Verifiable:_ existing STRK-146 tests remain green; warn/critical bands fire at the same usage fractions as before.

## Non-Goals

_Explicit list of things this sketch does NOT do. Each entry should make a future reader confident the omission was intentional._

- **Not** changing `getStorageUsage()` (the all-store scan that powers the Settings storage display) — only the per-save `userImages` pre-flight path is optimized.
- **Not** adding locking or serialization for concurrent in-flight saves — interleaving semantics match today's behavior exactly; any pre-existing race is neither introduced nor fixed here.
- **Not** caching the `coinImages`, `patternImages`, or `coinMetadata` totals — `userImages` only.
- **Not** altering the soft-cap value (`_quotaBytes`), pressure thresholds, or toast copy — those are STRK-146 contract and AC-6 pins them.

## Open Questions

_Anything that blocks the next phase. Empty by the time discovery starts._

- [ ] **Cache bypass risk (for discovery to confirm, not a requirements blocker):** Do all mutations of the `userImages` store flow through `ImageCache`'s own methods (`cacheUserImageResult` / `cacheUserImage` / `deleteUserImage` / `clearAll` / `importUserImageRecord`)? `js/bulk-image-cache.js`, `js/inventory-backup.js`, and `js/vault.js` reference these stores — discovery must confirm none write `userImages` directly (which would bypass the cache and require its own invalidation call). If a direct writer exists, AC-5's path list expands.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. The one open question is a discovery task, not a requirements blocker. Next: `/sketch-review STRK-162 requirements [AGENT]` → `/sketch-reconcile STRK-162 requirements` → `/sketch-discovery STRK-162`.
