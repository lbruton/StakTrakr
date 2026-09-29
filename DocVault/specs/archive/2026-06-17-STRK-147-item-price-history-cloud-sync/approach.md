---
sketch: "STRK-147-item-price-history-cloud-sync"
phase: approach
created: 2026-06-17
---

# STRK-147 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Add a **dedicated item-price-history companion vault** to Cloud Sync, modeled on the existing
image vault (always-on, not the opt-out attachment vault). Item-price-history stays in
localStorage with its retention cap; on push it is canonicalized, hashed, encrypted, and
uploaded to a new Dropbox `.stvault` path, and a `{hash, uuidCount, entryCount}` pointer is
attached to the existing sync metadata payload (`metaPayload`) alongside `imageVault` /
`attachmentVault`. The full history JSON never enters the change-detection manifest.

On pull, the companion vault is fetched **only when its remote metadata hash differs** from
the local last-pull hash (`lastPull.itemPriceHistoryHash`), then merged into local history
via a pure, commutative **fingerprint-union merge**. This hash comparison must be wired into
**four** entry points — the **poll hash-shortcut** (which records a pull and returns early
when inventory + settings hashes match, before `pullWithPreview()` runs — `cloud-sync.js:2474-2483`),
**silent-pull** (no item/settings drift), **manifest-first** (deferred-vault), and
**vault-first** (post-DiffModal) — so a remote change that touches *only* the companion hash
is still detected and merged. Remote history is filtered to UUIDs present in the **accepted
inventory boundary** so a rejected remote Item never imports orphan history. The generic
LWW settings path (`compareSettings` / `_applyAndFinalize`) is deliberately bypassed.

The merge itself reuses the tested tag-merge convergence model (`_mergeTagData`): logical
(decompressed/parsed/sorted) compare+hash, commutative on ties, idempotent (only changes
state when content actually changes). A new pure helper in `priceHistory.js` owns the merge
so it is unit-testable in isolation (slice-and-eval, like `cloud-sync-tag-merge.test.js`).

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| **D-1** | **Companion vault, NOT a `SYNC_SCOPE_KEYS` entry.** | Enables union merge + keeps the manifest lightweight; LWW would drop entries and bloat the manifest. | More code (push + 4 pull entry points + partial-failure) and one extra Dropbox file vs. a one-line array add. |
| **D-2** | **New pure `mergeItemPriceHistories(local, remote, acceptedUuids)` with full-entry fingerprint dedupe; leave ZIP's `mergeItemPriceHistory()` (ts-only) UNCHANGED this sketch.** | Cross-device must preserve same-`ts` distinct snapshots (AC-3); honoring the non-goal "don't change manual-restore behavior" means not retrofitting the ZIP helper now. | Two merge helpers with overlapping intent (short-term duplication). Unifying them is a filed follow-up (see Out of Scope). |
| **D-3** | **Always-on, modeled on the image vault** (not the attachment vault's `syncAttachments` opt-out). | Product decision 2026-06-17: no separate toggle. | Users with very large histories can't opt out of the extra payload; mitigated by existing CMP2 compression + 365d/1000 retention. |
| **D-4** | **New path `SYNC_ITEM_PRICE_HISTORY_PATH = "/StakTrakr/sync/staktrakr-item-price-history.stvault"` + `itemPriceHistoryVault: {hash, uuidCount, entryCount}` on `metaPayload`.** | Parity with `SYNC_IMAGES_PATH` / `imageVault`. | One more remote file + metadata field to maintain. |
| **D-5** | **Debounced push trigger inside `saveItemPriceHistory()`**, guarded on Cloud Sync availability (call `scheduleSyncPush()` if defined). | AC-4: history-only saves currently never push. | Slightly more frequent pushes when recording prices; the existing debounce absorbs bursts. |
| **D-6** | **Merge takes an `acceptedUuids` set; each apply path supplies the right boundary.** Vault-first → post-apply inventory UUIDs; **manifest-first deferred → the `newInv` that `_deferredVaultRestore()` computes via `DiffEngine.applySelectedChanges()` before `_applyAndFinalize()` (`cloud-sync.js:3560-3561`)**; silent-pull → current local inventory UUIDs. | AC-6 orphan prevention, while keeping the merge a pure, testable function. Pre-apply local UUIDs would drop history for *accepted* remote Items; all-remote UUIDs would import history for *rejected* Items — only the per-path accepted boundary is correct. | Merge signature carries an inventory-boundary param; each caller must compute the correct set. |
| **D-7** | **Companion-history merge writes through a throwing/reporting write path — NOT the existing `saveItemPriceHistory()`, which swallows `saveDataSync()` errors (`priceHistory.js:51-58`) and would mask a quota failure.** On a write failure, do NOT advance `lastPull`, record partial/error state, log — mirror the settings-write-failure path. | AC-7 retry safety: callers can only keep `lastPull` stale on failure if the write actually surfaces the error. | Adds a throwing write variant (or a changed save contract) plus a partial-pull state branch per pull path. |
| **D-8** | **`collectAndHashItemPriceHistory()` canonicalizes before hashing** (decompress → parse → drop malformed UUID entries → sort UUIDs → **sort entries by a full-fingerprint comparator: `ts`, then `itemName`, `retail`, `spot`, `melt`** → stable-stringify → hash). The merged output array uses the same comparator. | AC-2/AC-3/AC-9: a `ts`-only sort leaves equal-`ts` distinct entries in input order, so `merge(A,B)` and `merge(B,A)` diverge in array/hash order — non-commutative. The full-fingerprint tie-breaker restores determinism. | Canonicalization cost on each push (bounded by retention cap). |
| **D-9** | **`vaultEncryptItemPriceHistory()` / `vaultDecryptItemPriceHistory()` in `vault.js`**, mirroring the image/attachment vault encrypt/decrypt helpers (same AES-256-GCM). | Consistent placement + reuse of the vault crypto layer. | Two more small helpers in `vault.js`. |
| **D-10** | **Backward/forward compatible via additive optional metadata.** Clients predating the field ignore `itemPriceHistoryVault`; a new client pulling a remote that lacks it simply skips the companion pull (history stays local). | No migration, no version gate; old/new clients coexist. | A mixed-version fleet won't cross-sync history until all clients update — acceptable for a low-priority feature. |
| **D-11** | **Poll hash-shortcut must compare the companion hash before recording the pull.** Store `lastPull.itemPriceHistoryHash`; in the poll fast-path (`cloud-sync.js:2474-2483`), when inventory + settings hashes match, compare `remoteMeta.itemPriceHistoryVault?.hash` against the stored hash — if it differs, route into the silent companion merge **before** `syncSetLastPull()` instead of short-returning. | AC-5: without this, a remote that changes *only* item-price-history is silently marked pulled and never merged, because the shortcut returns before `pullWithPreview()`. | The poll fast-path gains a companion-hash branch (one more condition + a silent-merge call). |

## File Map

### New
- `tests/unit/cloud-sync-item-price-history-merge.test.js` — pure-merge unit tests (commutativity incl. full-fingerprint tie order, exact-dup collapse, same-`ts` distinct preservation, retention-after-merge, compressed-vs-plain hash equality), modeled on `cloud-sync-tag-merge.test.js`.
- `tests/playwright/core/item-price-history-cloud.spec.js` — E2E cloud-sync spec (two-device union, idempotent re-sync, history-only push trigger, **poll-shortcut companion-hash detection**, silent metadata-only merge, rejected-Item orphan boundary, quota-failure leaves `lastPull` stale), modeled on `attachments-cloud.spec.js`.

### Modified
- `js/constants.js` — add `SYNC_ITEM_PRICE_HISTORY_PATH`; **keep** `ALLOWED_STORAGE_KEYS` / `SYNC_SCOPE_KEYS` / `HISTORY_IDB_KEYS` boundaries exactly as-is.
- `js/priceHistory.js` — add pure `mergeItemPriceHistories(local, remote, acceptedUuids)`, `canonicalizeItemPriceHistory()` (full-fingerprint comparator), `collectAndHashItemPriceHistory()`, and a **throwing/reporting write path** for companion merges (D-7); modify `saveItemPriceHistory()` to schedule a debounced push when sync is available.
- `js/cloud-sync.js` — push: collect/hash/compare/encrypt/upload companion vault + attach `itemPriceHistoryVault` to `metaPayload` (mirror image-vault push ~1895-2009, preservation ~1954-1965); **poll hash-shortcut companion-hash branch (~2474-2483, D-11)**; pull: add companion fetch+merge to silent-pull (~3803-3869), manifest-first deferred-vault (`newInv` boundary ~3560-3619), and vault-first (~4437-4491) with hash-diff gating; partial-failure `lastPull` handling (~377-407). Keep companion data OUT of the manifest (~1293-1316).
- `js/vault.js` — add `vaultEncryptItemPriceHistory()` / `vaultDecryptItemPriceHistory()` mirroring the image/attachment vault crypto helpers.
- `tests/playwright/coverage-map.csv` — add a row for the new E2E spec (`domain: item-price-sync`, `risk_class: P0 money-data loss`, `decision: active`).

### Deleted
- _none._

## Data / Schema Changes

- **New remote artifact:** `/StakTrakr/sync/staktrakr-item-price-history.stvault` (AES-256-GCM, same crypto as other vaults).
- **New metadata field:** `metaPayload.itemPriceHistoryVault = { hash, uuidCount, entryCount }` — additive, optional. No localStorage shape change (item-price-history JSON shape is unchanged). No migration: absence of the field on a remote = skip companion pull.
- **New last-pull state field:** `lastPull.itemPriceHistoryHash` (in `cloud_sync_last_pull`) — the local record of the last-merged companion hash, used by the poll shortcut and all pull paths to gate the companion fetch (D-11).

## Tradeoffs Surfaced for Review

- **D-2 (two merge helpers):** we accept short-term duplication to honor the manual-restore non-goal. If a reviewer prefers, the alternative is to unify now by having ZIP delegate to the fingerprint merge — but that changes ZIP-restore dedupe semantics (same-`ts` distinct entries would survive where they previously collapsed). Flagging for the review seam.
- **D-10 (mixed-version fleet):** history won't cross-sync until all of a user's devices update. Acceptable given low priority and additive design; called out so it isn't a surprise.

## UI Contract

**N/A — no UI surface.** Sync is always-on (no toggle), merges run silently in the companion-vault pull paths (no diff modal for history), and there is no new view, modal, setting, or status indicator. All acceptance criteria are verifiable via unit + Playwright behavior assertions, not visual QA.

## Out of Scope (follow-up issues)

- **Unify the ZIP `mergeItemPriceHistory()` (ts-only) with the new fingerprint merge** so manual restore also preserves same-`ts` distinct entries — file under StakTrakr (deferred from D-2; needs its own restore-behavior test).
- **Optional user toggle / payload budget** for very large histories, if always-on payload size becomes a problem in practice (deferred from D-3).

## Risk Notes

- **Risk:** silent-pull path has no inventory diff, so the orphan-boundary `acceptedUuids` must default to current local inventory UUIDs (not an empty set, which would drop all history). → **Mitigation:** explicit acceptedUuids derivation per pull path (D-6), covered by an E2E assertion.
- **Risk:** poll hash-shortcut returns before any pull path runs (D-11). → **Mitigation:** companion-hash branch in the shortcut, covered by a dedicated E2E assertion (only item-price-history changed remotely).
- **Risk:** ZIP↔cloud merge divergence on same-`ts` distinct entries (D-2). → **Mitigation:** documented follow-up; ZIP is a manual, infrequent path.
- **Risk:** companion push fires on every price record. → **Mitigation:** debounced `scheduleSyncPush`; retention cap bounds payload.
- **Risk:** `itemName` differences across devices inflate fingerprints. → **Mitigation:** history is append-only snapshots — existing entries keep their recorded `itemName`; treating differing `itemName` as a distinct entry is correct, not a bug.

---

## Review Archive — approach (2026-06-17)

_Codex review marks, verbatim. All four accepted and integrated into the decisions above._

> **CODEX (on High-Level Architecture / AC-5):** AC-5 also needs an explicit `pollForRemoteChanges()` hook before the inventory/settings hash shortcut records the pull. In live `js/cloud-sync.js`, matching `inventoryHash` + `settingsHash` writes `cloud_sync_last_pull` and returns at lines 2474-2483, before `pullWithPreview()` and its silent-pull companion handling can run. A remote update that changes only `itemPriceHistoryVault.hash` would therefore be marked pulled without downloading or merging history unless the poll shortcut compares the companion hash against a stored `lastPull.itemPriceHistoryHash` and routes to the silent merge before `syncSetLastPull()`.

> **CODEX (on D-6):** This boundary needs to name the manifest-first deferred-vault path too. `_deferredVaultRestore()` computes `newInv` from the selected DiffModal changes before `_applyAndFinalize()` (`js/cloud-sync.js:3560-3612`); that `newInv` is the accepted inventory boundary for history. Using pre-apply local UUIDs would drop history for accepted remote Items, while using all remote vault UUIDs would import history for rejected Items.

> **CODEX (on D-7):** Wrapping the current `saveItemPriceHistory()` will not detect the failure AC-7 cares about. Live `js/priceHistory.js:51-57` catches `saveDataSync()` errors and only logs them, so a quota failure would look successful to `cloud-sync.js`. The approach needs either a throwing/reporting write path for companion-history merges or a changed `saveItemPriceHistory()` contract before callers can keep `lastPull` stale on failure.

> **CODEX (on D-8):** Sorting entries only by numeric `ts` is not deterministic enough for AC-2/AC-3/AC-9. The existing ZIP helper's `a.ts - b.ts` sort and timestamp-only dedupe (`js/priceHistory.js:231-257`) is the unsafe precedent here: equal-`ts` distinct entries preserve input order, so `merge(A,B)` and `merge(B,A)` can produce different array/hash order. Canonicalization and merged output need a tie-breaker based on the full entry fingerprint (`ts`, `itemName`, `retail`, `spot`, `melt`).

### Resolution Summary

- **Accepted:** 4 — #1 (AC-5 poll shortcut) → new **D-11** + architecture rewrite + `lastPull.itemPriceHistoryHash` schema; #2 (orphan boundary) → **D-6** now names the manifest-first `_deferredVaultRestore` `newInv` boundary; #3 (failure detection) → **D-7** now mandates a throwing/reporting write path instead of the swallow-and-log `saveItemPriceHistory()`; #4 (sort determinism) → **D-8** now uses a full-fingerprint comparator for canonicalization and merged output.
- **Rejected:** 0.
- **Resolved with your input:** 0 (all findings verified accurate against live code: `cloud-sync.js:2474-2483`, `cloud-sync.js:3560-3561`, `priceHistory.js:51-58`).

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch-tasks STRK-147`.
