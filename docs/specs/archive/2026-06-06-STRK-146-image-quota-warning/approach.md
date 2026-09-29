---
tags: [approach, sketch, staktrakr]
issue: STRK-146
version: 3.35.9
created: 2026-06-06
updated: 2026-06-06
---

# Approach — STRK-146

## Strategy

Make `_quotaBytes` a **real soft-cap guard** (today it's display-only) and route interactive
image saves through a feedback-aware method that (a) refuses + reports doomed writes and
(b) warns when crossing pressure bands. Keep the storage layer's public boolean contract intact
for the four background call sites. One small, guarded `showToast` touch lives in
`image-cache.js`; everything else is pure data.

## Key decisions

1. **Pre-flight soft-cap check (REQ-4).** Before the put, if `userImageBytes + delta > _quotaBytes`
   (delta = newSize − existingRecordSize, so shrinks never block), refuse and report
   `quotaExceeded`. This makes failure detectable on `file://` (no browser estimate) and makes
   AC3 deterministically testable by lowering `_quotaBytes`. The real-browser
   `QuotaExceededError` catch stays as a backstop.
2. **Preserve `cacheUserImage()` boolean signature (NFR-2).** Add `cacheUserImageResult()`
   returning `{ok, quotaExceeded, usageBytes, limitBytes}`; `cacheUserImage` becomes a thin
   `(await cacheUserImageResult(...)).ok` wrapper. The 4 background callers are untouched.
3. **Interactive vs background split (REQ-5).** Only the 3 interactive upload sites switch to
   `cacheUserImageWithFeedback()`. Re-saves (shrinking) and the split-clone copy stay silent
   (they only gain the better quota-specific console warning from `_put`).
4. **Escalation-only warning + throttle (REQ-1/2).** Pressure bands: `ok` < 85% ≤ `warn` < 95% ≤
   `critical`. Warn only when the band **increases** vs `_lastWarnedLevel`; always store the
   current band so dropping below re-arms a future warning. Single usage scan per interactive
   save (NFR-1).
5. **`showToast(message, duration)` only** — no severity arg exists. Use 6000 ms for storage
   messages (longer read time). Called at runtime, defensively guarded — no load-order trap.

### Tradeoff (documented)

The pre-flight check blocks at our soft cap (60% of available, min 500 MB, max 4 GB), which is
**more conservative** than the browser's hard limit. A user with lots of free disk could be
stopped at the soft cap. Accepted: leaving headroom + a clear message beats silent broken
squares, and 4 GB max / 500 MB floor is generous. Revisit if users report premature blocks.

## File Touch Map

| Action | File | Scope |
|--------|------|-------|
| MODIFY | `js/image-cache.js` | `_put` (+ `onError`, quota classify); new `cacheUserImageResult`, `cacheUserImageWithFeedback`, `_pressureLevel`, `_emitStorageToast`; `cacheUserImage` → wrapper; constructor `_lastWarnedLevel` |
| MODIFY | `js/events.js` | `:809` `saveUserImageForItem` → `cacheUserImageWithFeedback` |
| MODIFY | `js/bulkEdit.js` | `:2058` `_handleUpload` → `cacheUserImageWithFeedback` |
| MODIFY | `js/inventory.js` | `:2833` thumbnail `_handleUpload` → `cacheUserImageWithFeedback` |
| TEST   | `tests/playwright/core/strk-146-image-quota-warning.spec.js` | pre-flight error toast, warning toast, regression no-toast, no-spam |
| MODIFY | `tests/playwright/core/coverage-map.csv` | add row for the new spec |

**Total:** 4 modified source, 1 test added, 1 coverage-map row. **Cross-cutting:** version bump
files handled by `/release` shipping task (not counted here).

## UI Contract (toast copy)

- **Pre-flight / quota failure (error):**
  `"Storage full — image not saved. Free up space (remove unused images) and try again."`
- **Other save failure:** `"Couldn't save image. Please try again."`
- **Warning band (≥85%):** `"Image storage NN% full — consider removing unused images."`
- **Critical band (≥95%):** `"Image storage NN% full — saves may start failing. Remove unused images soon."`

All via `showToast(message, 6000)` → `.cloud-toast` div (all four themes inherit existing style).

## Reference implementation sketch (`js/image-cache.js`)

```js
// constructor: this._lastWarnedLevel = "ok";

async _put(storeName, record, onError) {
  try {
    const tx = this._db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(record);
    await this._txComplete(tx);
    return true;
  } catch (err) {
    const isQuota = err?.name === "QuotaExceededError" || err?.name === "NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR";
    console.warn(`ImageCache: put to ${storeName} failed${isQuota ? " (quota exceeded)" : ""}`, err);
    if (typeof onError === "function") onError(err);
    return false;
  }
}

_pressureLevel(used, limit) {
  if (!limit || limit <= 0) return "ok";
  const p = used / limit;
  if (p >= 0.95) return "critical";
  if (p >= 0.85) return "warn";
  return "ok";
}

_emitStorageToast(message, duration = 6000) {
  if (typeof showToast === "function") showToast(message, duration);
  else console.warn("ImageCache:", message);
}

async cacheUserImageResult(uuid, obverse, reverse = null, sharedImageId = null) {
  if (!uuid || (!obverse && !reverse)) return { ok: false, quotaExceeded: false };
  if (!(await this._ensureDb())) { /* re-init retry as today */ }
  if (!this._db.objectStoreNames.contains("userImages")) return { ok: false, quotaExceeded: false };

  const newSize = (obverse?.size || 0) + (reverse?.size || 0);
  const existing = await this._get("userImages", uuid);
  const delta = newSize - (existing?.size || 0);
  const usage = await this.getStorageUsage();
  const used = usage.userImageBytes;
  const limit = this._quotaBytes;

  if (delta > 0 && used + delta > limit) {
    return { ok: false, quotaExceeded: true, usageBytes: used, limitBytes: limit };
  }

  const record = { uuid, obverse, reverse: reverse || null, sharedImageId: sharedImageId || null, cachedAt: Date.now(), size: newSize };
  let quotaErr = false;
  const ok = await this._put("userImages", record, (e) => {
    quotaErr = e?.name === "QuotaExceededError" || e?.name === "NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR";
  });
  return { ok, quotaExceeded: !ok && quotaErr, usageBytes: ok ? used + delta : used, limitBytes: limit };
}

async cacheUserImage(uuid, obverse, reverse = null, sharedImageId = null) {
  return (await this.cacheUserImageResult(uuid, obverse, reverse, sharedImageId)).ok;
}

async cacheUserImageWithFeedback(uuid, obverse, reverse = null, sharedImageId = null) {
  const res = await this.cacheUserImageResult(uuid, obverse, reverse, sharedImageId);
  if (!res.ok) {
    this._emitStorageToast(res.quotaExceeded
      ? "Storage full — image not saved. Free up space (remove unused images) and try again."
      : "Couldn't save image. Please try again.");
    return false;
  }
  const level = this._pressureLevel(res.usageBytes, res.limitBytes);
  const bands = { ok: 0, warn: 1, critical: 2 };
  if (bands[level] > bands[this._lastWarnedLevel || "ok"]) {
    const pct = Math.round((res.usageBytes / res.limitBytes) * 100);
    this._emitStorageToast(level === "critical"
      ? `Image storage ${pct}% full — saves may start failing. Remove unused images soon.`
      : `Image storage ${pct}% full — consider removing unused images.`);
  }
  this._lastWarnedLevel = level;           // store current band (drop re-arms)
  return true;
}
```
> Note: `Date.now()` is fine in app code (the no-`Date.now()` rule is for Workflow scripts only).

## Test design (Playwright — deterministic via `_quotaBytes`)

Set `window.imageCache._quotaBytes` immediately before each save (avoids the async `_initQuota`
overwrite race). Build sized blobs: `new Blob([new Uint8Array(N)])` → `.size === N`.

1. **Pre-flight error (REQ-3/4):** `_quotaBytes = 1000`; save a 50 000-byte blob via
   `cacheUserImageWithFeedback`. Assert `.cloud-toast` contains "Storage full", the returned
   `ok === false / quotaExceeded === true`, and `getUserImage(uuid)` is null (write refused).
2. **Warning band (REQ-1):** `_quotaBytes = 1_000_000`; save an 850 000-byte blob → fits
   (85%). Assert `.cloud-toast` contains "full" and `getUserImage(uuid)` exists (saved).
3. **Regression (NFR-2):** `_quotaBytes = 100_000_000`; save a 50 000-byte blob → `ok`, NO
   toast appears, `getUserImageUrl` returns a `blob:` URL; legacy `cacheUserImage()` returns true.
4. **No-spam (REQ-2):** two saves staying in the `warn` band → exactly one warning toast.
