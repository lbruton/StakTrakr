---
sketch: "STRK-224-companion-failure-edges"
phase: approach
created: 2026-06-20
---

# STRK-224 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

All three edges live in `js/cloud-sync.js` and share one principle: **a sync watermark (`lastPull.syncId` / `lastPull.itemPriceHistoryHash`) must not advance until the companion data it represents has actually landed.** The merge algorithm (`js/priceHistory.js`) and the persisted `lastPull` shape are untouched; only *when* and *whether* the watermark advances changes. No new files, no new scheduling, no UI.

**Edge 1 (cancel-with-companion)** is fixed by *removing a redundancy*, not adding code. The poll loop currently calls `_pollCompanionItemPriceHistory()` (`~2545`) **unconditionally**, before it knows whether the cycle will end silently or open the DiffModal. But the DiffModal route (`handleRemoteChange → pullWithPreview`, `:2780`) **already** has an apply-gated companion pull at `:4917` inside `if (_vfApplied)` — STRK-225 built that gate. So the pre-merge is redundant for the modal case and harmful (it merges + records the hash before the user can Cancel). The fix reorders the poll so the companion pre-merge runs **only on the no-modal exits** (the silent fast-path and the STAK-414 local-newer push branch); when the cycle routes to `handleRemoteChange`, the pre-merge is skipped and `pullWithPreview`'s existing `_vfApplied` gate merges on Apply / skips on Cancel.

**Edge 2 (null-hash download failure)** and **Edge 3 (post-apply write throw)** are the two failure modes of `_pullItemPriceHistoryVault` (`:2905`). Edge 2 is the *non-throwing* path: a transient download/decrypt failure returns `{hash:null, skipped:false}` — byte-identical to the benign "no remote vault / missing deps" no-op — so callers can't tell failure from a benign skip. We add an explicit `failed` flag to the result, set only on the two transient-failure returns, and have every call site decline to advance the watermark when it's set. Edge 3 is the *throwing* path: the strict write rethrows (correct), but in the deferred/vault-first apply paths `_applyAndFinalize` has **already** recorded `syncId` at `:3598` before the companion write runs — so the throw leaves `syncId` falsely advanced. We snapshot `lastPull` before the apply and restore it if the companion pull fails or throws, so the next poll re-attempts instead of short-circuiting on the same-syncId shortcut.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | **Edge 1:** gate the poll companion pre-merge to the *no-modal* poll exits (silent fast-path + STAK-414 local-newer); for the DiffModal route, drop the pre-merge and rely on `pullWithPreview`'s existing STRK-225 `_vfApplied`-gated companion pull (`:4917`) to merge on Apply / skip on Cancel | Reuses the apply-gate STRK-225 already shipped — **no new apply-path merge code**; Cancel now genuinely cancels (AC-2) while a companion-only change stays silent (AC-3) | Couples poll Edge-1 correctness to `pullWithPreview`'s companion behavior; requires reordering the hot poll loop so the silent/local-newer/modal routing decision precedes the companion call |
| D-2 | **Edge 2:** add an explicit `failed:boolean` to `_pullItemPriceHistoryVault`'s `result`, set `true` **only** on the transient download (`!resp.ok`, `:2947-2953`) and decrypt-catch (`:2957-2964`) returns; benign precondition-miss/hash-match/404 stay `failed:false` | Disambiguates the overloaded `{hash:null, skipped:false}` shape that transient failure and the missing-deps no-op **share** (so `skipped` alone can't distinguish them); mirrors the `failed` flag `_pollCompanionItemPriceHistory` already returns | Wider blast radius — every call site must consume it; AC-5 mandates this anyway |
| D-3 | **Edge 3:** snapshot `lastPull` **before** `_applyAndFinalize` advances `syncId` (`:3598`) and restore it if the companion pull returns `failed` or its write throws — with **per-path snapshot points**: manifest-first captures before `_applyAndFinalize` (`:3956`), companion at `:4026`; vault-first captures **inside `showRestorePreviewModal.onApply` before `_applyAndFinalize` (`:3738`)** and carries the saved value via closure to the post-apply companion block (`:4917`) — **not** snapshotted at `:4917`, which is already after the `:3598` advance | Localized to the companion try/catch — leaves `_applyAndFinalize`'s shared settings/tag rollback and its four callers (`:3738`, `:3956`, `:4249`) untouched (KIMI caveat); pinning the vault-first capture pre-apply avoids a too-late snapshot (CODEX) | Compensating restore is less elegant than never-advancing; the vault-first capture must live in the `onApply` closure (a snapshot near `:4917` is a defect); a retry re-pulls inventory and **may re-show the DiffModal** for already-applied inventory (idempotent; explicitly accepted by the issue) |
| D-4 | **Keep** the companion pre-merge on the STAK-414 local-newer branch (a no-modal exit) | `_pollCompanionItemPriceHistory` records **only** `itemPriceHistoryHash`, never `syncId` (`:2696-2698`), and the merge is idempotent/append-only over owned UUIDs — no false watermark advance, no Edge-1 exposure; avoids regressing today's behavior | Resolves the discovery open question in favor of status-quo: local-newer cycles still eagerly accept remote companion history |
| D-5 | **Edge 1 fallout:** add a companion pull (with `failed` handling, accepted-UUIDs = current inventory) to the STAK-470 settings-only auto-merge branch (`:4289-4480`) — **and** apply Edge-3 discipline to this branch too: it records `syncSetLastPull` at `:4368` **before** its companion work (`:4397-4472`), so either defer that record until after the new IPH pull succeeds, or snapshot/restore the full prior `lastPull` for the branch | After D-1 removes the poll pre-merge ahead of the `handleRemoteChange`/`pullWithPreview` route, this **no-modal auto-merge** would otherwise drop remote companion history on version-upgrade settings merges (CODEX + KIMI regression); without the rollback it would recreate Edge 3 on this branch (CODEX) | Introduces a sixth companion call site to maintain; must mirror the silent path's accepted-UUIDs boundary to avoid orphan import, and carries its own watermark-rollback like the other apply sites |

> **Silent-pull call sites (`:4230`, `:4787`) — simpler than the apply sites:** they already order `syncSetLastPull` *after* the companion pull, so Edge-2/AC-5 compliance is just guarding that existing record on `!failed`. No snapshot-restore needed (their `syncId` hasn't advanced yet). They are NOT Edge-3 sites.

## File Map

_Every file this sketch will create, modify, or delete. tasks.md will reference these paths._

### New
- _None._ The three AC-9 E2E tests are added to the existing spec (below), not new files; the fix is in-place control-flow hardening in one production file.

### Modified
- `js/cloud-sync.js` — seven touch points:
  - **`pollForRemoteChanges` (`~2534-2660`)** — reorder so the companion pre-merge runs only on no-modal exits: invoke `_pollCompanionItemPriceHistory` inside the silent fast-path (before recording `_pollPullMeta`, `~2585-2600`) and the STAK-414 local-newer branch (before `scheduleSyncPush`, `~2616-2635`); **remove** the unconditional pre-merge ahead of `handleRemoteChange`. **(D-1, D-4 — Edge 1, AC-1/AC-3)**
  - **`_pollCompanionItemPriceHistory` (`~2673`)** — propagate `_pullItemPriceHistoryVault`'s new `failed`: when the inner pull reports `failed`, return `{hash, failed:true}` so the poll bails without recording `syncId`. **(D-2 — Edge 2, AC-4/AC-6 on the poll path)**
  - **`_pullItemPriceHistoryVault` (`~2905`)** — add `result.failed`, set `true` on the two transient-failure returns; refresh the stale retry-assumption JSDoc. **(D-2 — Edge 2, AC-4)**
  - **Deferred apply companion site (`~4026`)** — snapshot `lastPull` before `_applyAndFinalize` (`:3956`); restore on `failed`/throw. **(D-3 — Edge 3, AC-7/AC-8 manifest-first)**
  - **Vault-first post-apply companion site (`~4917`)** — capture the snapshot **inside `showRestorePreviewModal.onApply` before `_applyAndFinalize` (`:3738`)** and carry it via closure to the `_vfApplied`-gated pull at `:4917`; restore on `failed`/throw. Do **not** snapshot at `:4917` — `syncId` advanced at `:3598` already. **(D-3 — Edge 3, AC-7/AC-8 vault-first)**
  - **Silent-pull companion sites (`~4230`, `~4787`)** — guard the existing post-pull `syncSetLastPull` on `!failed`. **(D-2 — Edge 2, AC-5 "every call site")**
  - **STAK-470 auto-merge branch (`~4289-4480`)** — add a companion pull with `failed` handling and accepted-UUIDs = current inventory; **and** prevent a new Edge 3 here — the branch records `syncSetLastPull` at `:4368` before its companion work, so defer that record until after the IPH pull succeeds or snapshot/restore the prior `lastPull` for the branch. **(D-5 — Edge 1 regression guard + Edge 3 on this branch)**
- `tests/playwright/core/item-price-history-cloud.spec.js` — add E2E for AC-9: (a) cancel of a DiffModal carrying a concurrent companion change leaves history + watermark untouched; (b) null-hash download failure → successful retry poll; (c) post-apply companion write-throw → successful retry poll, **bound to both post-apply paths as two targeted cases** — manifest-first (`_applyAndFinalize` `:3956`, companion `:4026`) and vault-first (`onApply` `:3738`, companion `:4917`) — since the approach changes them through separate code locations and one generic test would leave the other path unverified (CODEX). Reuses the existing `writeItemPriceHistoryStrict`-throw scaffold (line ~517) and the cancel-modal pattern from `attachments-cloud.spec.js`, plus `vault-fixtures.js` `encryptVaultPayload`.
- `tests/playwright/coverage-map.csv` — update the active `item-price-sync` row (`:93`) to reflect all added cases (a, b, c-manifest-first, c-vault-first) (AGENTS.md requirement).

### Deleted
- _None._

## Data / Schema Changes

- `_pullItemPriceHistoryVault`'s **return contract** gains a `failed:boolean` field (default `false`). In-memory only — not persisted, not on the sync metadata payload.
- The persisted `lastPull` shape (`{syncId, timestamp, rev, itemPriceHistoryHash}`) and the `itemPriceHistoryVault` pointer contract are **unchanged**.
- No migration, no backfill.

## Tradeoffs Surfaced for Review

- **D-3 recovery strategy (snapshot-restore vs. defer-out-of-`_applyAndFinalize`).** I chose snapshot-and-restore at the two apply sites to avoid disturbing `_applyAndFinalize`'s shared rollback and its four callers. The alternative — moving the `syncSetLastPull(meta)` call out of `_applyAndFinalize` so each caller records `syncId` only after its companion write — is conceptually cleaner (never advances prematurely) but touches the shared finalizer contract and every caller, with higher regression risk to the existing settings/tag-write rollback. Flagging in case you'd rather take the cleaner-but-broader route.
- **D-3 retry re-shows the DiffModal.** Because the inventory apply is *not* rolled back (only the watermark is), the retry poll re-pulls and may re-present the DiffModal for already-applied inventory. The issue's acceptance text explicitly permits "defer the advance OR restore prior metadata," and the DiffEngine is idempotent, so this is accepted — but it's a visible behavior worth your sign-off.
- **D-4 local-newer behavior.** Confirming the status-quo: a device whose local inventory is persistently newer keeps eagerly accepting remote companion history on each poll. No change, but it's the answer to the discovery open question.

## UI Contract

N/A — no UI surface. Per the requirements Non-Goals, the DiffModal's markup and behavior are untouched; Edge 1's cancel path is *exercised* by AC-9(a) but uses the existing `#restorePreviewModal` / `#appDialogModal` custom-modal test pattern (`page.on("dialog")` does not intercept these — see `.context`/CLAUDE.md). No new views, tokens, or components.

## Out of Scope (follow-up issues)

- **STRK-223** — explicit-clear tombstone propagation (separate deferred-from-STRK-147 issue). No overlap; not addressed here.
- **Persistent-local-newer propagation latency** — if D-4's status-quo (local-newer devices only ever *accept* remote companion lazily) ever proves to starve propagation in practice, revisit. Pre-existing behavior, not introduced by this sketch; file under StakTrakr only if observed.

## Risk Notes

- Risk: reordering the hot `pollForRemoteChanges` loop (D-1) could subtly alter the silent fast-path timing or the `_pollPullMeta` hash carry → mitigation: AC-3 is an explicit non-regression test; keep the silent-path record logic byte-for-byte aside from *where* the companion call sits.
- Risk: `pollForRemoteChanges` is already large; the reorder + STAK-470 companion add (D-5) may push its cyclomatic complexity over the Codacy per-function gate (STRK-169 lesson — relocating/adding into a hot function trips a *new* finding) → mitigation: if the gate trips, extract the routing decision into a small helper rather than weakening the threshold.
- Risk: the new STAK-470 companion call (D-5) using the wrong accepted-UUIDs boundary would import orphan history → mitigation: mirror the silent path's `_currentInventoryUuids()` exactly (D-6 boundary from STRK-147).
- Risk: snapshot-restore (D-3) must restore the **full** prior `lastPull`, not just `syncId`, or a partial restore re-introduces an inconsistent watermark → mitigation: capture and restore the whole object; assert in AC-9(c).
- Risk: the **vault-first** snapshot is easy to place too late — `_applyAndFinalize` advances `syncId` at `:3598` inside `onApply` (`:3738`), so a snapshot at the `:4917` companion block is already after the advance → mitigation: capture inside `onApply` before `_applyAndFinalize` and carry it via closure to `:4917`; the AC-9(c) vault-first case must fail if the snapshot is taken post-apply.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch-tasks STRK-224`.

## Review Archive — approach (2026-06-20)

### Resolution Summary

Reconciled via `/sketch-reconcile STRK-224 approach` (2026-06-20). **3 accepted, 0 rejected, 0 resolved with user input.** Single reviewer (CODEX); all code-existence claims verified against `dev` HEAD `0dd17e70`.

- **Accepted (folded into Key Decisions / File Map / Risk Notes above):**
  - D-3 vault-first snapshot placement pinned to inside `onApply` before `_applyAndFinalize` (`:3738`), carried via closure to `:4917` — a snapshot at `:4917` is already after the `:3598` advance.
  - D-5 STAK-470 branch given its own Edge-3 rollback: it records `syncSetLastPull` at `:4368` before companion work, so defer that record or snapshot/restore the prior `lastPull`.
  - AC-9(c) split into two targeted post-apply write-throw E2Es (manifest-first `:4026`, vault-first `:4917`) so neither path is left unverified; coverage-map reflects both.
- **Rejected:** none.
- The reviewer's **Verified** and **Unverified assumptions** lists are retained verbatim below as the audit record.

### CODEX Review (2026-06-20)

#### Verified

- Read `DocVault/sketch/conventions.md`, the STRK-224 `requirements.md`, `discovery.md`, and `approach.md`, plus StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, `.context/sketch-conventions.md`, and `Projects/StakTrakr/Foundation/coding-standards.md`.
- Verified repo `dev` at `0dd17e70`, matching the discovery anchor.
- Verified poll ordering and Edge 1 surfaces in `js/cloud-sync.js:2534-2649` and `_pollCompanionItemPriceHistory()` at `:2673-2717`.
- Verified `_pullItemPriceHistoryVault()` return/write behavior at `js/cloud-sync.js:2905-2998` and the current five call sites at `:2685`, `:4026`, `:4230`, `:4787`, and `:4917`.
- Verified `_applyAndFinalize()` records pull metadata at `js/cloud-sync.js:3598`; vault-first `showRestorePreviewModal.onApply` calls it at `:3738`, while the later vault-first companion pull runs at `:4917`.
- Verified STAK-470 auto-merge currently records `syncId` before companion pulls at `js/cloud-sync.js:4368-4472`.
- Verified test surfaces in `tests/playwright/core/item-price-history-cloud.spec.js`, `tests/playwright/core/attachments-cloud.spec.js`, `tests/playwright/helpers/vault-fixtures.js`, and `tests/playwright/coverage-map.csv:93`.

#### Top concerns

1. D-3's vault-first snapshot placement is too loose: snapshotting near the `:4917` companion block is already after `_applyAndFinalize()` advanced `lastPull.syncId`.
2. D-5 adds an item-price-history companion pull to the STAK-470 auto-merge branch without saying how to prevent the branch's earlier `syncSetLastPull` from recreating the same false-watermark retry block.
3. AC-9(c) should cover both manifest-first and vault-first post-apply write-failure paths, because the approach changes them through separate code locations.

#### Unverified assumptions

- I did not run Playwright; this was a static phase review against live source and test files.
- I did not re-fetch the Plane issue body; I treated `requirements.md` as the current issue contract.
