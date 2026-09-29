---
sketch: "STRK-162-image-usage-cache"
phase: discovery
created: 2026-06-06
---

# STRK-162 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

All work lands in a **single file**: `js/image-cache.js`. The `ImageCache` class is the sole owner of `userImages` CRUD.

| Path                                                         | Role                                                                  | Notes                                                                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/image-cache.js:17`                                       | `class ImageCache`                                                    | The class; cache field will be added to the constructor (`:18`).                                                                                                                                    |
| `js/image-cache.js:493`                                      | `_userImagesBytes()`                                                  | The O(N) cursor scan to wrap behind a cached getter.                                                                                                                                                |
| `js/image-cache.js:533`                                      | **The only call site** of `_userImagesBytes()`                        | Inside `cacheUserImageResult`. AC-1 is satisfied by converting this **one** read to the cached getter.                                                                                              |
| `js/image-cache.js:483`                                      | `_recordSize(rec)`                                                    | Legacy-safe per-record byte size (`rec.size ?? blobSizes`). Already used to compute `delta`.                                                                                                        |
| `js/image-cache.js:516`                                      | `cacheUserImageResult()`                                              | The single **write chokepoint**. Computes `used` (533) and signed `delta` (532); success branch (554–563) returns `usageBytes: used + delta` → the increment value already exists.                  |
| `js/image-cache.js:588`                                      | `cacheUserImageWithFeedback()`                                        | Interactive wrapper. **Reuses `res.usageBytes`** for the pressure-band toast — does NOT call `_userImagesBytes()` again. So there is no second read to cache; the warn path stays correct for free. |
| `js/image-cache.js:237`                                      | `clearAll()`                                                          | Clears `userImages` (+ other stores) → **invalidate** site.                                                                                                                                         |
| `js/image-cache.js:629`                                      | `deleteUserImage()`                                                   | `_delete("userImages", uuid)` → **invalidate** site.                                                                                                                                                |
| `js/image-cache.js:650`                                      | `importUserImageRecord()`                                             | `_put("userImages", record)` (ZIP restore) → **invalidate** site.                                                                                                                                   |
| `js/image-cache.js:966-968`                                  | `const imageCache = new ImageCache(); window.imageCache = imageCache` | The singleton + global. Tests drive it via `window.imageCache`.                                                                                                                                     |
| `tests/playwright/core/strk-146-image-quota-warning.spec.js` | STRK-146 quota/toast spec                                             | The **AC-6 regression anchor** — must stay green. New AC-5 delete-then-save coverage lands here or in `tests/unit/`.                                                                                |
| `tests/unit/storage-compression.test.js`                     | Unit storage test                                                     | Node/unit precedent if a unit-level test is preferred for the cache math.                                                                                                                           |

### Caller census — confirms the chokepoint, no bypass

Every external mutation of `userImages` flows through `ImageCache`'s public methods:

- **Writes** → `cacheUserImageWithFeedback` / `cacheUserImage` / `cacheUserImageResult`: `js/events.js:809`, `js/inventory.js:2833,1432,2873`, `js/bulkEdit.js:2058,2098`.
- **`importUserImageRecord`**: `js/inventory-backup.js:592,611`, `js/vault.js:925`.
- **`deleteUserImage`**: `js/events.js:832,847,2407`, `js/inventory.js:1137,1259`, `js/bulkEdit.js:2096`, `js/settings.js:3423`, `js/changeLog.js:822`.
- **`clearAll`**: `js/events.js:3860`, `js/image-cache-modal.js:365`.
- **Direct store access (audited):** the _only_ code touching the `userImages` object store outside `ImageCache` is `js/vault.js:1438-1439` — a **`"readonly"`** transaction calling `.count()`. It is a read, not a write, so it cannot drift the cache.

## Prior Decisions

_mem0 query: `"STRK-146 image storage quota pre-flight userImages bytes pressure toast ImageCache"`_

- **2026-06-02** — STRK-146 validated on beta.staktrakr.com: real storage dropped 10 MB → 2 MB and `QuotaExceededError` was eliminated (mem0 `5243d280`). Context for why the per-save quota guard exists and must keep working (AC-6).
- **2026-06-05** — Codacy **DELTA** complexity/duplication gate trips on new IndexedDB modules that _mirror_ `image-cache.js`; the duplication is design-inherent (mem0 `cf70c8f7`, `b93fe33c`). **Relevance/caveat:** STRK-162 edits `image-cache.js` _in place_ (no new mirrored module), so the duplication angle is unlikely to fire — but added branches can nudge DELTA complexity, so the diff should stay minimal. ⚠ The older memory's "bypass via admin-merge" mitigation is **stale**: per the current `Protect Dev` ruleset (verified 2026-06-06) admin-merge is blocked. Mitigation is "keep the change small," not "admin-merge."
- **2026-03-21** — `BulkImageCache` and `image-cache-modal.js` remain active for metadata sync and must be retained (mem0 `e5fb0a2a`). `image-cache-modal.js:365` is one of our `clearAll` invalidation sites; `BulkImageCache` (`js/bulk-image-cache.js`) operates on its own store/concern and does **not** write `userImages` (confirmed by the direct-write audit above).

## External References

- **None.** No new library, RFC, or third-party pattern. The change is an in-memory numeric field on an existing singleton plus IndexedDB calls that already exist. IndexedDB and `navigator.storage.estimate()` semantics are platform-native and unchanged.

## Constraints

- **Single read site.** Only `js/image-cache.js:533` reads `_userImagesBytes()`; the warn path reuses the returned `usageBytes`. AC-1 is a one-line swap, not a sweep.
- **Increment only on the success branch** (`ok === true`, after `_put` succeeds) and by the **signed** `delta` (negative for a shrinking in-place replace). Pre-flight block (541) and `_put` failure (554) must leave the cache untouched (AC-4).
- **In-memory, per-page-load.** The cache is a field on the singleton; a page reload resets it to cold and it recomputes lazily on first need. No persistence is wanted (the store is the source of truth).
- **Keep the diff small** to avoid nudging the Codacy DELTA complexity gate on `image-cache.js`; admin-merge is no longer an escape hatch.
- **Test gate:** `npm test` (core Playwright) is the PR gate; `tests/playwright/core/strk-146-image-quota-warning.spec.js` is the AC-6 anchor. New cache-coherency coverage (AC-2/3/4/5) needs a deterministic way to assert "scan happened / didn't" — e.g. spy on `_iterate`/`_userImagesBytes` or assert via the returned `usageBytes`.
- **Both `file://` and HTTP** must keep working (project invariant); the cache logic is transport-agnostic.

## Open Questions

_Resolved during this phase — none remain._

- [x] **Cache-bypass risk (from requirements):** RESOLVED. No module writes the `userImages` store directly; the only out-of-class access is a read-only `.count()` in `js/vault.js:1438`. AC-5's three-path invalidation list (`deleteUserImage`, `clearAll`, `importUserImageRecord`) is therefore **complete** — no expansion needed.

## Discovery Summary

The entire change lives in `js/image-cache.js`: add a cached byte total to the singleton, serve the one existing read site (`:533`) from it, increment by the signed `delta` on the `cacheUserImageResult` success branch, and null-invalidate in the three other mutation methods. A full caller audit confirms nothing bypasses the `ImageCache` API to write `userImages` directly, so the invalidation surface is exactly the three methods named in the issue. The only real watch-items are TDD determinism (proving a scan was/wasn't performed) and keeping the diff small enough not to trip Codacy's DELTA complexity gate on this file.

---

> **Phase complete?** Existing code mapped, callers audited, the one open question resolved. Next: `/sketch-review STRK-162 discovery [AGENT]` → `/sketch-reconcile STRK-162 discovery` → `/sketch-approach STRK-162`.
