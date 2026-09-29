---
sketch: "STRK-223-item-price-history-clear-tombstone"
phase: discovery
created: 2026-06-21
---

# STRK-223 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| `js/priceHistory.js:677` | `clearItemPriceHistory()` | Confirms, sets `itemPriceHistory = {}`, calls `saveItemPriceHistory()`. **No tombstone/timestamp recorded today.** Entry point for AC-1. |
| `js/priceHistory.js:58` | `saveItemPriceHistory()` | Calls `applyItemPriceRetention` then `saveDataSync`, then **already `scheduleSyncPush()`** (STRK-147 D-5). A clear already triggers a debounced push — no new push trigger needed. |
| `js/priceHistory.js:21` | `applyItemPriceRetention(history)` | Existing **ts-based drop-filter**: `cutoff = Date.now() - MAX_DAYS…`; `entries.filter(e => e && e.ts >= cutoff)`; deletes empty UUIDs. Called from save (:60), merge (:484), and `writeItemPriceHistoryStrict` (:540). The natural single home for a watermark cutoff. |
| `js/priceHistory.js:444` | `mergeItemPriceHistories(local, remote, accepted)` | Commutative union: seeds local, unions accepted remote, dedupes by `_itemPriceEntryFingerprint`, applies retention, re-canonicalizes. Never removes local. Filtering must happen **inside** this (or its retention call) to stay commutative (AC-6). |
| `js/priceHistory.js:402` / `:344` | `canonicalizeItemPriceHistory` / `_itemPriceEntryFingerprint` | Entry shape: each entry is an object with a numeric **`ts`** field (the per-snapshot timestamp the watermark compares against). |
| `js/cloud-sync.js:2186-2262` | Push companion branch | `entryCount > 0` → upload/carry-forward; `else if (_remoteItemPriceHistoryMeta)` → **preserve** (the bug site, :2242); no delete branch. AC-2/AC-4 land here. |
| `js/cloud-sync.js:1698-1710` | Pre-push remote-meta capture | `_remoteItemPriceHistoryMeta` captured from `prePushMeta.itemPriceHistoryVault`; `prePushMeta.timestamp` available to compare against the watermark. |
| `js/cloud-sync.js:2264-2276` | `metaPayload` assembly | Where a `clearedAt` field would be stamped to ride the meta (alongside `itemPriceHistoryVault`). |
| `js/cloud-sync.js:2937` | `_pullItemPriceHistoryVault(...)` | Pull+merge helper. **Returns early when `remoteMeta.itemPriceHistoryVault` is absent** (:2939-2946) and skips when `remoteHash === localHash` (:2951). Both short-circuits mean a deleted/unchanged companion never runs the merge — so a receiving device is **not** cleared by a delete alone. |
| `js/cloud-sync.js` (≈9 call sites) | Companion-pull callers | `_pullItemPriceHistoryVault` is invoked from ~9 sites: poll (:2695), full-overwrite pullSyncVault (:3163), deferred-vault restore (:4113/:4176), silent-pull (:4387/:4449), auto-merge (:4719), vault-first preview (:5085/:5258). Per-call-site changes = the STRK-224 "audit every reliant path" trap. |
| `js/cloud-sync.js:5149-5258` | `pullWithPreview` vault-first | `_vfApplied` gate (set :5158/:5160) wraps the companion pull (:5258). AC-7 cancel-safety must reuse this gate. |
| `js/cloud-sync.js:3250` / `:3348` | `_isTagSyncKey` / `_mergeTagData` | **Closest prior art.** Tag-sync keys are *excluded* from blind settings-overwrite (skipped at :4016/:4302/:4561/:4939/:4946) and instead timestamp-merged via `_mergeTagData` — which runs in every pull path. The template for a synced, timestamp-arbitrated key applied from one chokepoint. |
| `js/constants.js:541` | `ITEM_PRICE_HISTORY_KEY = "item-price-history"` | Companion storage key (in `ALLOWED_STORAGE_KEYS` :957, NOT in `SYNC_SCOPE_KEYS` — it's a companion vault, not main-vault settings). |
| `js/constants.js:876` / `:952` | `SYNC_SCOPE_KEYS` / `ALLOWED_STORAGE_KEYS` | Registration arrays. `itemTagsLastModified` (:881) is the precedent entry for a synced timestamp watermark. A new `itemPriceHistoryClearedAt` key needs **both** (STRK-161 dual-registration). |
| `tests/unit/cloud-sync-item-price-history-merge.test.js` | Unit tests | STRK-147 pure-merge/canonicalize/hash suite — extends here for the watermark drop-filter + commutativity (AC-5/AC-6). |
| `tests/playwright/core/item-price-history-cloud.spec.js` | E2E spec | STRK-147/224 cross-device companion suite (coverage-map row 93, **15 cases**). New cross-device clear-propagation + fresh-device-preserve cases land here; **coverage-map.csv row 93 count must bump**. |

## Prior Decisions

- 2026-06-21 — **STRK-224 lesson** (mem0 `project_strk224_companion_edges_shipped` / search: `"STRK-224 cloud-sync companion pull lastPull syncId"`): removing a broad implicit behavior forced a companion pull onto *every* path that advances `lastPull.syncId`; Codex needed 3 review rounds to find them all. Directly relevant — there are ~9 companion-pull sites; a per-site clear-application would repeat that trap.
- 2026-06-20/21 — **"Watermark advances on cancel"** (mem0 retro, search: `"watermark advances on cancel pullWithPreview _vfApplied"`): companion blocks recorded their sync hash after the restore-preview modal regardless of apply/cancel. STRK-147 gated item-price-history; STRK-225 gated image+attachment — all on `_vfApplied`. Any receive-side clear application must sit behind the same gate (AC-7).
- 2026-06-17 — **STRK-147 shipped** (PR #1285, v3.35.26): the companion vault + commutative merge (D-2) this builds on; the clear-propagation gap was the deferral that became this issue.
- 2026-06-15 — **STRK-161 dual-registration** (mem0 `project_localstorage_dual_registration`): new synced keys need BOTH `ALLOWED_STORAGE_KEYS` (survive `cleanupStorage`) and `SYNC_SCOPE_KEYS` (cloud propagation); persistence tests must reload/`cleanupStorage` or they miss the wipe-on-reload bug. Governs AC-8.

## External References

- _None — fully internal. No new libraries, RFCs, or platform features. The crypto/Dropbox plumbing (`vaultEncryptItemPriceHistory`, `files/delete_v2`, `files/upload`) already exists; only the propagation logic is new._

## Constraints

- **Commutativity (D-2):** `mergeItemPriceHistories` must stay order-independent — the watermark filter must apply identically whether a history is treated as local or remote (AC-6). The unit suite asserts `merge(A,B) === merge(B,A)`.
- **No new per-call-site logic across the 9 companion-pull sites** — favor a single chokepoint (retention filter and/or a tag-style merge hook) over scattered edits (STRK-224 trap).
- **Cancel-gate:** receive-side application must respect `_vfApplied` in `pullWithPreview` (AC-7).
- **Retention coexistence:** the watermark is *additive* to the STRK-141 age/count retention — `applyItemPriceRetention` already drops `ts < ageCutoff`; the watermark drops `ts <= clearedAt`. They compose (effective cutoff = max).
- **Clock model:** `Date.now()` watermark, last-write-wins via max-arbitration — parity with `itemTagsLastModified`. No skew correction.
- **Dual registration (STRK-161):** the watermark key in both `SYNC_SCOPE_KEYS` and `ALLOWED_STORAGE_KEYS`.

## Open Questions

> The single requirements-phase fork, now sharpened by the code map. Resolve in `approach.md`.

- [ ] **Where does the receiving device apply the clear?** The merge-filter (in `applyItemPriceRetention` / `mergeItemPriceHistories`) only runs when a companion pull actually merges — but a deleted or hash-unchanged remote companion short-circuits that (`_pullItemPriceHistoryVault` :2939/:2951). Two viable chokepoints surfaced by discovery, both avoiding the 9-call-site trap:
  - **(a) Tag-style merge hook** — treat `itemPriceHistoryClearedAt` like a tag-sync key (`_isTagSyncKey`/`_mergeTagData` precedent): max-arbitrate on every pull, and on advance re-apply `applyItemPriceRetention` to local history + write. Covers all pull paths from the existing settings-merge chokepoint; no companion-pull dependency.
  - **(b) Empty-vault tombstone** — the clearing push uploads an *empty* companion (new hash, pointer retained) instead of preserving/deleting, so the normal pull+merge runs the filter. Reuses the 9 sites as-is but depends on every receiver actually pulling+merging.
  - Decision affects which files Cohort C touches and how AC-3/AC-7 tests are framed.

## Discovery Summary

The work lands almost entirely in two files: `js/priceHistory.js` (set + honor the watermark — `applyItemPriceRetention` is the existing ts-filter that already runs on save/merge/strict-write) and `js/cloud-sync.js` (push delete/tombstone at :2242 + receive-side application + meta stamping), plus a one-line dual registration in `js/constants.js`. The easy parts are confirmed: entries already carry `ts`, a clear already triggers a sync push, and the tag-sync key handling (`_isTagSyncKey`/`_mergeTagData`) is a working template for a synced timestamp-arbitrated watermark applied across all pull paths. The single tricky decision — exactly where a receiving device applies the clear without touching the ~9 companion-pull call sites (STRK-224 trap) and while respecting the `_vfApplied` cancel-gate — is isolated to one open question for the approach phase.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. The one open question is scoped to approach. Then advance: `/sketch-approach STRK-223`.
