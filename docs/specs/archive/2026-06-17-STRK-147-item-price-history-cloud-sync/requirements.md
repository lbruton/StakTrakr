---
sketch: "STRK-147-item-price-history-cloud-sync"
phase: requirements
created: 2026-06-17
---

# STRK-147 — Requirements

> **Source Issue:** [STRK-147](https://plane.lbruton.cc/lbruton/browse/STRK-147/)
>
> **Title:** Cloud-sync item-price-history with UUID-aware merge
>
> **Summary:** Split out of STRK-141 (Phase 2 market-history IndexedDB migration) during
> design, 2026-06-04. `item-price-history` is UUID-keyed structured JSON
> (`{ [uuid]: [{ ts, itemName, retail, spot, melt }, ...] }`), intentionally kept out of
> `SYNC_SCOPE_KEYS` today. It cannot ride the last-write-wins (LWW) settings path
> (`DiffEngine.compareSettings`) — LWW would silently drop history entries added on a second
> device, and embedding full history JSON would bloat the lightweight change-detection
> manifest. This issue adds true cross-device cloud sync via a **dedicated, UUID-aware merge
> path** (union/merge per-item history arrays), keeping the manifest snapshot lightweight.
> STRK-141 left item-price-history in localStorage with a retention cap (365d / 1000
> entries/UUID) and manual encrypted-vault + ZIP backup; this issue adds the cross-device
> channel on top. Priority: low. Workflow: /spec or /sketch — needs a real merge design +
> multi-device test.
>
> **Discovery basis:** Codex discovery comment (2026-06-17, reviewing `dev` @ `775e01aa`,
> v3.35.24), independently verified against the live codebase in this session. Recommended
> approach: a dedicated **companion vault** modeled on the existing image/attachment vaults.

## Overview

Add true cross-device cloud sync for per-Item price history (`item-price-history`). History
is user-authored, append-only data keyed by Item UUID; it must merge by **union**, never by
last-write-wins, so entries recorded on different devices are never silently dropped. The
sync rides a dedicated companion-vault channel (not `SYNC_SCOPE_KEYS`), keeping the
change-detection manifest lightweight and merging silently without a "Review Sync Changes"
prompt. Per the 2026-06-17 product decision, sync is **always-on** whenever Cloud Sync is
enabled — no separate toggle.

## User Stories

- **US-1:** As a multi-device user, I want the price history I record on one device to appear
  on my other devices, so that my per-Item price record is complete everywhere.
- **US-2:** As a user, I want history merges to union entries rather than overwrite, so that
  records added independently on two devices are never lost.
- **US-3:** As a user, I want history sync to happen quietly and without bloating my sync,
  so that it never triggers spurious review prompts or slows the normal push/pull.
- **US-4:** As a user, I want existing local-only and manual-backup behavior preserved, so
  that this new capability adds sync without regressing what already works.

## Acceptance Criteria

> EARS syntax. Each line is individually testable and becomes a TDD Cohort B assertion.
> AC-1…AC-7 map to the seven acceptance-test targets enumerated in the Codex discovery;
> AC-8…AC-10 encode the convergence contract and STRK-141 regression guard.

### AC-1 — Cross-device union (maps to US-1, US-2)
- **WHEN** two devices each add different history entries for the same Item UUID and then
  sync, the system **SHALL** result in both devices holding the union of both devices'
  entries for that UUID.

### AC-2 — Idempotent / convergent (maps to US-2)
- **WHEN** a sync runs again with no new local or remote changes, the system **SHALL** make
  no further changes to item-price-history (the merge is idempotent and convergent on ties).

### AC-3 — Same-timestamp distinct preservation (maps to US-2)
- **IF** two history entries share the same `ts` but differ in any value field
  (`itemName`, `retail`, `spot`, `melt`), **THEN** the system **SHALL** preserve both
  entries; exact-duplicate entries (all fields equal) **SHALL** collapse to one.

### AC-4 — History-only push trigger (maps to US-1, US-3)
- **WHEN** item-price-history is saved and Cloud Sync is available, the system **SHALL**
  schedule a (debounced) sync push even when inventory is otherwise unchanged.

### AC-5 — Silent metadata-only merge (maps to US-3)
- **WHEN** a remote pull differs only in item-price-history companion-vault metadata, the
  system **SHALL** download and merge the companion vault **WITHOUT** presenting an
  item/settings diff modal to the user.

### AC-6 — Orphan prevention (maps to US-2)
- **IF** a remote-added Item is rejected in the diff modal, **THEN** the system **SHALL NOT**
  import that Item's remote price history (remote history is filtered to UUIDs present in the
  accepted inventory boundary).

### AC-7 — Partial-failure safety (maps to US-3, US-4)
- **IF** the item-price-history merge write fails (e.g. storage quota), **THEN** the system
  **SHALL NOT** advance `lastPull`, and **SHALL** record a partial/error state so the next
  poll retries.

### AC-8 — Lightweight manifest (maps to US-3)
- The system **SHALL** keep full item-price-history JSON out of the change-detection
  manifest; only a companion-vault `{hash, count}` metadata pointer **SHALL** appear on the
  sync metadata payload.

### AC-9 — Logical, commutative convergence (maps to US-2)
- The system **SHALL** compare and hash item-price-history on normalized logical content
  (decompressed, JSON-parsed, sorted UUIDs, entries sorted by numeric `ts`, stable-
  stringified) so that compression-vs-plain and key-order variants do not produce phantom
  conflicts, and the merge **SHALL** be commutative (`merge(A,B) == merge(B,A)`).

### AC-10 — Retention preserved (maps to US-4)
- **WHEN** entries are merged, the system **SHALL** apply the existing retention cap
  (`applyItemPriceRetention`: 365 days / 1000 entries per UUID) after merging, before saving.

### AC-11 — STRK-141 boundaries preserved (maps to US-4)
- The system **SHALL** keep spot/retail market histories out of cloud auto-sync scope, and
  **SHALL** keep `item-price-history` out of `SYNC_SCOPE_KEYS` (no LWW settings path) while
  it remains in `ALLOWED_STORAGE_KEYS` for cleanup and manual backup. The existing guard
  test (`history-store-migration.spec.js` "no market-history key is in the cloud auto-sync
  scope") **SHALL** still pass.

## Non-Goals

- **Not** syncing spot/retail market histories — those stay IndexedDB-local per STRK-141.
- **Not** adding a user-facing toggle — sync is always-on with Cloud Sync (decision 2026-06-17).
- **Not** migrating item-price-history out of localStorage — it stays in localStorage with
  the existing retention cap; only a sync channel is added.
- **Not** building conflict/review UI for history — merges are automatic union, no user review.
- **Not** changing the user-observable behavior of manual ZIP / encrypted-vault restore for
  item-price-history (any internal refactor of the ZIP merge helper must preserve restore behavior).

## Open Questions

_None blocking discovery. The choice between reusing/refactoring the existing ZIP
`mergeItemPriceHistory()` (ts-only dedupe) vs. a new fingerprint-based merge is an
**approach-phase** decision, not a requirements gap._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch-discovery STRK-147`.
