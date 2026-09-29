---
sketch: "STRK-223-item-price-history-clear-tombstone"
phase: approach
created: 2026-06-21
---

# STRK-223 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Introduce one synced scalar — **`itemPriceHistoryClearedAt`**, a millisecond timestamp (absent ⇒ `0` ⇒ "never cleared") — that travels device-to-device on the main vault exactly like `itemTagsLastModified`, and is reconciled by **max-arbitration** (newest clear wins). It has three touch points, each mapping to a known chokepoint:

1. **Record (origin device).** `clearItemPriceHistory()` (`priceHistory.js:677`) stamps the watermark with `Date.now()` _before_ wiping local history and saving. `saveItemPriceHistory()` already calls `scheduleSyncPush()`, so the clear self-propagates with no new push trigger.

2. **Honor (the drop-filter — one home).** `applyItemPriceRetention()` (`priceHistory.js:21`) already filters by `e.ts`; it gains a watermark term so an entry survives only when `e.ts >= ageCutoff` **and** `e.ts > clearedAt`. Because this function is the shared tail of `saveItemPriceHistory`, `mergeItemPriceHistories` (`:484`), and `writeItemPriceHistoryStrict` (`:540`), _every_ write/merge path enforces the watermark automatically — and because the filter runs inside the commutative merge, AC-6 commutativity is preserved for free.

3. **Apply on receipt (the receiving device).** The watermark is registered in `SYNC_SCOPE_KEYS` + `ALLOWED_STORAGE_KEYS` but, like the tag-sync keys, is **excluded from the blind settings-overwrite** and instead routed through a dedicated merge `_mergeItemPriceClearWatermark(remoteSettings)` that (a) sets `local = max(local, remote)` and (b) **on advance**, re-applies `applyItemPriceRetention(itemPriceHistory)` + `writeItemPriceHistoryStrict` so local entries `<= clearedAt` drop immediately — even when no companion vault is pulled. This hook is invoked beside `_mergeTagData` at its **two centralized chokepoints** — `_applyAndFinalize()` (`:3550`, which already carries the apply-only `_vfApplied` gate and the snapshot/rollback used for tag merge) and the one-sided/silent path (`_mergeOneSidedTagSettings` `:3486`). This is what keeps the receive-side change off the ~9 `_pullItemPriceHistoryVault` call sites (the STRK-224 "audit every reliant path" trap).

On the **push** side, the preserve-when-empty branch (`cloud-sync.js:2242`) becomes conditional: if local history is empty **and** `clearedAt > prePushMeta.timestamp` (the clear post-dates the entire remote state), delete the remote companion (`files/delete_v2`, mirroring the STAK-426 image path `:1990-2009`) and omit the pointer; otherwise preserve exactly as today (AC-4). The watermark itself propagates via the main vault — **not** stamped on `metaPayload` — so there is a single source of truth, matching how `itemTagsLastModified` already works.

## Key Decisions

| #   | Decision                                                                                                                                                                                                                                                                    | Rationale                                                                                                                                    | Tradeoff                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | One **global** watermark scalar `itemPriceHistoryClearedAt`, not per-UUID                                                                                                                                                                                                   | "Clear all" is a single global op; a scalar is the minimal sufficient state                                                                  | A future per-item "delete this row" propagation needs its own mechanism (out of scope, noted as follow-up)                                                                                                                                                                           |
| D-2 | Drop-filter lives in `applyItemPriceRetention` — survive iff `ts >= ageCutoff && ts > clearedAt`                                                                                                                                                                            | Single home already called by save/merge/strict-write ⇒ universal + commutative (AC-5/AC-6) with no new filter sites                         | Couples watermark semantics into "retention"; any caller wanting raw unfiltered history would have to bypass it (none exist today — must be documented)                                                                                                                              |
| D-3 | Propagate **only** via the main vault (`SYNC_SCOPE_KEYS`), not `metaPayload`                                                                                                                                                                                                | Mirrors `itemTagsLastModified`; one channel, one source of truth                                                                             | Watermark isn't visible to a hypothetical meta-pointer-only consumer; acceptable (none exists)                                                                                                                                                                                       |
| D-4 | Receive-side apply via a tag-style special-cased merge `_mergeItemPriceClearWatermark` (max-arbitrate + drop-on-advance), excluded from blind overwrite like `_isTagSyncKey`, invoked at the **2** tag-merge chokepoints (`_applyAndFinalize`, `_mergeOneSidedTagSettings`) | Covers all pull paths from 2 central sites + inherits the `_vfApplied` apply-gate and rollback; avoids the 9-site companion trap (AC-3/AC-7) | Adds a second bespoke synced-key family alongside the tag keys (more special-cased merge logic vs. generic overwrite)                                                                                                                                                                |
| D-5 | Push **deletes** the remote companion (STAK-426 `files/delete_v2`) when `clearedAt > prePushMeta.timestamp`; else preserve                                                                                                                                                  | Stops the stale companion advertising cleared history (AC-2) while protecting fresh/empty devices (AC-4)                                     | Uses the overall remote-meta `timestamp` as a companion-write proxy (no per-companion timestamp exists). Conservative: a concurrent post-clear push from another device makes us _preserve_, which is still correct — the watermark drops the old entries on every device regardless |
| D-6 | `Date.now()` + last-write-wins `max` arbitration; no skew correction                                                                                                                                                                                                        | Parity with `itemTagsLastModified`                                                                                                           | Gross cross-device clock skew can mis-order a clear vs a concurrent add (pre-existing, accepted)                                                                                                                                                                                     |

## File Map

### New

- _None._ All logic extends existing functions; new tests reuse existing files.

### Modified

- `js/constants.js` — add `ITEM_PRICE_HISTORY_CLEARED_AT_KEY = "itemPriceHistoryClearedAt"`; register it in `SYNC_SCOPE_KEYS` (:876) **and** `ALLOWED_STORAGE_KEYS` (:952); add the `window.*` export. (AC-8 dual-registration)
- `js/priceHistory.js` —
  - `clearItemPriceHistory()` (:677): stamp the watermark before wipe (AC-1).
  - `applyItemPriceRetention()` (:21): add the `ts > clearedAt` term (AC-5).
  - add small pure helpers: `loadItemPriceClearedAt()` / `saveItemPriceClearedAt(ts)` (read/write the key; absent ⇒ 0), and an `applyItemPriceClearWatermark()` that re-runs retention + strict-write (called by the cloud-sync hook on advance).
- `js/cloud-sync.js` —
  - push preserve branch (:2242): conditional `files/delete_v2` per D-5 (AC-2/AC-4).
  - add `_mergeItemPriceClearWatermark(remoteSettings)` + exclude the key from the blind-overwrite loops (the `_isTagSyncKey` skip sites at :4016/:4302/:4561/:4939/:4946 — either extend the predicate or add a sibling guard) and invoke the merge beside `_mergeTagData` at `_applyAndFinalize` (:3550) and `_mergeOneSidedTagSettings` (:3486) (AC-3/AC-7). **Exact call-site enumeration is a tasks deliverable + review focus (STRK-224 audit).**
- `tests/unit/cloud-sync-item-price-history-merge.test.js` — watermark drop-filter + commutativity-with-watermark unit cases (AC-5/AC-6).
- `tests/playwright/core/item-price-history-cloud.spec.js` — cross-device clear-propagation, fresh-device-preserve, and cancel-safety E2E cases (AC-2/AC-3/AC-4/AC-7).
- `tests/playwright/coverage-map.csv` — bump row 93 case count and extend the description (mandatory per AGENTS.md).

### Deleted

- _None._

## Data / Schema Changes

- New localStorage key `itemPriceHistoryClearedAt` — string-encoded ms timestamp; **absent reads as `0`** (never cleared). No backfill or migration: existing devices read `0` and behave exactly as today until the first clear, so the change is invisible until used.

## Tradeoffs Surfaced for Review

- **D-2 retention coupling:** folding the watermark into `applyItemPriceRetention` is the lever that makes the filter universal and commutative in one edit, but it means "retention" now also means "clear-enforcement." If a reviewer prefers separation of concerns, the alternative is a standalone `applyClearWatermark()` called at the same three sites — more call sites, looser coupling. Flagging for the review seam.
- **D-5 timestamp proxy:** comparing `clearedAt` against the whole-meta `timestamp` (not a per-companion write time, which doesn't exist) is conservative-correct but worth a reviewer's eye on the concurrent-multi-device race described in the D-5 tradeoff cell.

## UI Contract

N/A — no UI surface. The "Clear all item price history" button and its `showAppConfirm` dialog (`priceHistory.js:677`) are unchanged; all behavior change is in the cloud-sync/merge layer.

## Out of Scope (follow-up issues)

- **Generalize the clear-watermark tombstone to the image + attachment companion vaults** — they share the identical preserve-when-empty gap (image: `cloud-sync.js:1968`). File under StakTrakr once this pattern is proven.
- **Per-entry / per-UUID single-row delete propagation** — deleting one history row (vs. "clear all") and having it stay deleted across devices is a distinct convergence gap; separate issue.

## Risk Notes

- Risk: the ~9 `_pullItemPriceHistoryVault` call sites → mitigation: D-4 routes the receive-side apply through the 2 tag-merge chokepoints, leaving all companion-pull sites untouched.
- Risk: "watermark advances on cancel" (STRK-147/225) → mitigation: the hook runs only inside `_applyAndFinalize` (apply-only) and the silent path — never on a cancelled preview (AC-7). Tasks must add an explicit cancel-safety test.
- Risk: incomplete chokepoint coverage (a pull path that applies settings but bypasses both tag-merge entry points) → mitigation: tasks enumerate every `_mergeTagData` / `_isTagSyncKey` site and assert the watermark merge sits alongside each; this is the primary review target given STRK-224.
- Risk: rollback parity — `_applyAndFinalize` snapshots tag keys for rollback on merge failure; the watermark write must join that snapshot/restore set so a failed apply doesn't leave a half-advanced watermark.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch-tasks STRK-223`.
