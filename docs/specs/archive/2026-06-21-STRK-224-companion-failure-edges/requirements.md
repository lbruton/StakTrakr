---
sketch: "STRK-224-companion-failure-edges"
phase: requirements
created: 2026-06-20
---

# STRK-224 — Requirements

> **Source Issue:** [STRK-224](https://plane.lbruton.cc/lbruton/browse/STRK-224/)
> **Title:** Cloud-sync item-price-history: harden companion failure/cancel/retry edges (deferred from STRK-147)
>
> **Context (from issue):** Surfaced by Codex + CodeRabbit review on PR #1285 (STRK-147). The core companion-vault feature shipped complete + tested (7 ACs green), but the re-review identified three genuine failure/cancel/retry edge cases across the multiple pull paths. None cause data loss — the merge is a UUID-filtered append-only union, so the worst case is delayed propagation or merging history for already-owned items. Deferred from STRK-147 (whose ACs did not specify transient-failure or cancel-with-concurrent-changes behavior).
>
> **Edges to harden (from issue):**
> 1. **Poll-shortcut merges before a concurrent DiffModal cancel** (`cloud-sync.js` ~2545, `_pollCompanionItemPriceHistory`): when a remote sync has item/settings changes AND a companion change, the poll path merges companion history (and records its hash) before `handleRemoteChange()` shows the review modal, so Cancel does not prevent the history merge. (The vault-first path was gated on Apply in PR #1285; the poll path was not.) `acceptedUuids` is still the local inventory, so no orphan import — but Cancel should still cancel.
> 2. **Companion download failure skips retry** (`cloud-sync.js` ~2953): when `_pullItemPriceHistoryVault` returns `{hash:null}` on a transient download/decrypt failure (non-throwing), the caller treats it as non-failed and records the remote `syncId`; the next poll exits at the `lastPull.syncId === remoteMeta.syncId` check before retrying the companion. Treat a null-hash download failure as failed (keep `lastPull` stale) like the write-failure path does.
> 3. **Post-apply `lastPull` advances before the strict history write** (`cloud-sync.js` ~4037 / 4834–4850): in vault-first/manifest-first paths the inventory apply records `lastPull` before the companion `writeItemPriceHistoryStrict()`; if that write throws, `lastPull.syncId` is already advanced (without `itemPriceHistoryHash`), so the same-syncId poll shortcut blocks the intended AC-7 retry. Defer the `lastPull` advance until the companion write succeeds, or restore prior pull metadata on this failure path.
>
> **Acceptance (from issue):** cancel-with-companion does not merge/record; transient download failure leaves `lastPull` stale to retry; failed post-apply write does not advance `lastPull.syncId`; E2E coverage per edge.

## Overview

STRK-224 hardens three independent failure/cancel/retry edges in the item-price-history companion-vault sync path (`js/cloud-sync.js`), all deferred from STRK-147. Each edge is a variant of the same anti-pattern: a sync watermark (`lastPull.syncId` / `itemPriceHistoryHash`) recorded *before* the corresponding data is certain to have landed — so a cancel, a transient download failure, or a thrown post-apply write leaves the watermark falsely advanced, and the `lastPull.syncId === remoteMeta.syncId` poll shortcut then blocks the retry that would heal it. None cause data loss today (the merge is a UUID-filtered, append-only, idempotent union over already-owned items); the cost is delayed propagation and a cancel that doesn't fully cancel. This sketch makes each watermark advance contingent on its data actually landing, and adds one Playwright E2E per edge.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a multi-device StakTrakr user, I want cancelling a sync review (DiffModal) that also carries item-price-history changes to leave my local history and sync watermark untouched, so that **Cancel reliably means "apply nothing."**
- **US-2:** As a user on a flaky connection, I want a transient companion download/decrypt failure to be treated as a failure that retries on the next poll, so that my price history eventually propagates instead of being silently skipped forever.
- **US-3:** As a user, I want a failed post-apply companion write to leave the sync watermark stale, so that the next poll retries the unmerged companion instead of falsely declaring the sync complete.

## Acceptance Criteria

> EARS normative statements. `<system>` = the cloud-sync subsystem (`js/cloud-sync.js`). Each line is individually testable and becomes a TDD Cohort-B assertion.

### Edge 1 — Cancel-with-companion (maps to US-1)

- **AC-1 (event-driven):** **WHEN** a poll detects a remote sync carrying **both** an item-price-history companion change **and** an inventory/settings change that triggers the DiffModal, the `<system>` **SHALL** defer the companion merge to the modal's Apply path rather than silently merging it in the poll shortcut.
- **AC-2 (unwanted):** **IF** the user **cancels** that DiffModal, **THEN** the `<system>` **SHALL NOT** merge the remote item-price-history into local storage **and SHALL NOT** advance `lastPull.itemPriceHistoryHash` (or `lastPull.syncId`) for that companion.
- **AC-3 (state-driven — non-regression):** **WHILE** a remote sync carries **only** an item-price-history companion change (no inventory/settings change, so no DiffModal is shown), the `<system>` **SHALL** continue to merge it silently in the poll shortcut and record its hash (preserving the STRK-147 D-11 silent-companion fast path).

### Edge 2 — Null-hash download failure retries (maps to US-2)

- **AC-4 (unwanted):** **IF** a companion item-price-history pull returns `{hash:null}` from a transient (non-throwing) download/decrypt failure, **THEN** the `<system>` **SHALL** treat the pull as failed and leave `lastPull` stale — advancing neither `lastPull.syncId` nor `lastPull.itemPriceHistoryHash`.
- **AC-5 (ubiquitous — scope):** The `<system>` **SHALL** apply this null-hash-is-failure handling at **every** companion-pull call site that can record `lastPull` — the poll-shortcut path (`_pollCompanionItemPriceHistory`, ~2545/2692), the issue-cited caller (~2953), **and** the vault-first / manifest-first apply paths.
- **AC-6 (event-driven — retry):** **WHEN** a subsequent poll runs after a null-hash failure, the `<system>` **SHALL** re-attempt the companion pull (the stale `lastPull.syncId` must not trip the same-syncId shortcut into skipping it).

### Edge 3 — Post-apply write-throw retries (maps to US-3)

- **AC-7 (unwanted):** **IF** the post-apply companion `writeItemPriceHistoryStrict()` throws, **THEN** the `<system>` **SHALL NOT** advance `lastPull.syncId` past the unmerged companion — deferring the `lastPull` advance until the companion write succeeds, or restoring the prior pull metadata on the failure path.
- **AC-8 (event-driven — retry):** **WHEN** a subsequent poll runs after a failed post-apply companion write, the `<system>` **SHALL** retry the pull (the same-syncId shortcut must not block the intended AC-7 retry).

### Cross-cutting — Test coverage

- **AC-9 (ubiquitous):** The `<system>` **SHALL** have Playwright E2E coverage for each of the three edges: (a) cancel of a DiffModal carrying a concurrent companion change, (b) null-hash download failure followed by a successful retry poll, (c) post-apply companion write-throw followed by a successful retry poll.

## Non-Goals

- **No retry backoff/cap or new scheduling** — "next poll retries" reuses the existing poll cadence; this sketch adds no timer, backoff, or attempt counter.
- **No change to the merge algorithm** — the UUID-filtered, append-only, idempotent `mergeItemPriceHistories` union is preserved as-is; only *when* the watermark advances changes.
- **No image/attachment companion changes** — verified during requirements grilling: the poll shortcut pre-merges **only** item-price-history; images/attachments are pulled inside `pullWithPreview` (already gated on Apply by STRK-225), so they have no pre-modal poll-merge bug. Out of scope, not a silent omission.
- **No DiffModal UI change** — the cancel path is exercised, but the modal's markup/behavior is untouched (no UI Contract).
- **Not STRK-223** — explicit-clear tombstone propagation is a separate deferred-from-STRK-147 issue; not addressed here.

## Open Questions

_Resolved during grilling — none block discovery._

- [x] Edge-2 fix scope → **all companion-pull call sites** (user decision, 2026-06-20).
- [x] Edge-1 "Cancel cancels" semantics → **no merge AND no hash record** (defer merge to Apply; preserve companion-only silent fast path) (user decision, 2026-06-20).

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch-discovery STRK-224`.
