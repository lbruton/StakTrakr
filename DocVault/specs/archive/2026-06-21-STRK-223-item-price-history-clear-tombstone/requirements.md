---
sketch: "STRK-223-item-price-history-clear-tombstone"
phase: requirements
created: 2026-06-21
---

# STRK-223 — Requirements

> **Source Issue:** [STRK-223](https://plane.lbruton.cc/lbruton/browse/STRK-223/)
>
> **Title:** Cloud-sync item-price-history: propagate explicit clears via tombstone (deferred from STRK-147)
>
> **Problem:** When a user **clears all** item-price-history locally and Cloud Sync pushes while the remote still has a companion vault, `entryCount` is zero so the push **preserves the old remote pointer** (the preserve-when-local-empty branch at `js/cloud-sync.js:2242`). The clear never propagates — other devices keep pulling the stale companion vault. Even a remote-file delete alone would not clear device B, because the pull helper `_pullItemPriceHistoryVault` (`js/cloud-sync.js:2937`) returns early on a missing pointer and `mergeItemPriceHistories` (`js/priceHistory.js:444`) is a commutative union that seeds local and never removes.
>
> **Fix direction (from issue):** Distinguish an _intentional local clear_ from a _fresh device with no history yet_, analogous to the tag-sync tombstone (`itemRemovedTags` / `itemTagsLastModified`).
>
> **Issue acceptance:** (1) Clearing all on device A + sync clears device B on next pull. (2) A fresh device with empty history does NOT erase a populated remote companion.
>
> _Discovery brief (chosen approach: synced `itemPriceHistoryClearedAt` watermark merge-filter) lives in the issue's `## Discovery` section._

## Overview

Make an intentional "Clear all item price history" propagate across synced devices, the way a deliberate tag removal already does — without a fresh/empty device ever wiping populated cloud history. The fix is bidirectional: the clearing device must signal intent (not just "I happen to have no history"), and every other device must honor that signal on its next sync while still keeping any price snapshots genuinely created _after_ the clear. The signalling vehicle is a synced **clear watermark** (a timestamp), mirroring the existing `itemTagsLastModified` tag tombstone that already rides the main vault to every device.

## User Stories

- **US-1:** As a multi-device StakTrakr user, I want clearing all item price history on one device to also clear it on my other devices after they sync, so that a deliberate cleanup actually takes effect everywhere instead of silently reappearing.
- **US-2:** As a user setting up StakTrakr on a fresh/empty device, I want my existing cloud price history to download intact, so that a new install never wipes my data.
- **US-3:** As a user who clears history on device A while device B independently records new price snapshots, I want the newer snapshots to survive while the cleared ones stay gone, so that a clear can't destroy legitimately newer data.

## Acceptance Criteria

> EARS syntax. The "system" is **Cloud Sync**. Each line is individually testable and becomes a TDD Cohort B assertion. Entry timestamps below refer to the existing per-entry `ts` field on item-price-history records.

### AC-1 — Clear is recorded as intentional (maps to US-1)

WHEN the user confirms "Clear all item price history", Cloud Sync **SHALL** record an intentional-clear watermark timestamped at the moment of the clear.

### AC-2 — Push propagates the clear (maps to US-1)

WHEN a Cloud Sync push runs and the local history is empty **because** an intentional-clear watermark is newer than the remote companion's last write, Cloud Sync **SHALL** ensure the remote no longer advertises the cleared history (delete or tombstone the companion) and **SHALL** carry the clear watermark forward in the pushed metadata so other devices receive it.

### AC-3 — Other devices clear on sync (maps to US-1)

WHEN a device runs a cloud sync after another device has cleared all history and pushed, Cloud Sync **SHALL** remove from the receiving device every item-price-history entry that existed at the time of the clear, leaving only entries whose `ts` is strictly newer than the clear watermark.

### AC-4 — Fresh / empty device preserves remote (maps to US-2)

IF a device has no local item-price-history **and** no intentional-clear watermark (a fresh or never-populated device), THEN a Cloud Sync push **SHALL** preserve the existing remote companion vault pointer and **SHALL NOT** delete or tombstone it.

### AC-5 — Newer data survives the clear (maps to US-3)

WHILE a clear watermark is in effect, the item-price-history merge **SHALL** retain every entry whose `ts` is strictly greater than the watermark and **SHALL** drop every entry whose `ts` is less than or equal to it.

### AC-6 — Merge stays commutative (maps to US-3)

The item-price-history merge **SHALL** remain order-independent: applying the clear-watermark filter **SHALL** produce the same result regardless of which device's history is treated as "local" versus "remote" (preserves the STRK-147 D-2 property).

### AC-7 — Cancel safety (maps to US-1, US-2)

IF a vault-first restore preview is cancelled, THEN Cloud Sync **SHALL NOT** apply the clear watermark, drop local entries, or advance the item-price-history pull watermark (mirrors the STRK-147 / STRK-225 `_vfApplied` gate that prevents "watermark advances on cancel").

### AC-8 — Watermark survives reload and cleanup

The clear-watermark value **SHALL** persist across page reload and `cleanupStorage` (registered in `ALLOWED_STORAGE_KEYS`) and **SHALL** be carried in cloud-sync scope (`SYNC_SCOPE_KEYS`) so it reaches other devices — both registrations are required (per STRK-161 dual-registration).

## Non-Goals

- **Not** generalizing the tombstone to the image or attachment companion vaults — they share the same gap, but that is a separate follow-up (lean defer). This sketch touches item-price-history only.
- **Not** introducing per-UUID or per-entry clear tombstones — "Clear all" is a single global operation, so a single global watermark suffices. Re-merge of an individually-deleted single history row is a distinct gap, out of scope here.
- **Not** changing the "Clear all" button, its confirm dialog, or any UI surface — the behavior change is in the sync/merge layer only.
- **Not** replacing or altering existing retention (STRK-141 `MAX_DAYS` / `MAX_ENTRIES`) — the watermark is an _additional_ drop-filter layered on top of retention, not a substitute.
- **Not** solving cross-device clock skew beyond the last-write-wins behavior the timestamp already implies — parity with the existing `itemTagsLastModified` tag tombstone (also `Date.now()`-based); gross skew mis-ordering a clear vs a concurrent add is an accepted, pre-existing limitation.

## Open Questions

> One design fork for the discovery/approach phase. Observable behavior (the ACs) is settled; the mechanism is not.

- [ ] **Apply-on-receipt vs. empty-vault tombstone (for AC-3).** If the push _deletes_ the remote companion, the receiving device's pull helper `_pullItemPriceHistoryVault` returns early on the 404 and never runs the drop-filter — so device B would not actually clear. Two candidate mechanisms to resolve in `approach.md`: **(a)** on receiving a newer clear watermark (via the main-vault settings merge), proactively apply the drop-filter to local history regardless of any companion pull; or **(b)** have the clearing push write an _empty / tombstoned_ companion instead of deleting, so the normal pull+merge path runs the filter. Decide in approach; it changes which code sites Cohort C touches.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. The one open question is explicitly scoped to discovery/approach. Then advance: `/sketch-discovery STRK-223`.
