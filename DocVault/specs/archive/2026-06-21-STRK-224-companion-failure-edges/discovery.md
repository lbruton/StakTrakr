---
sketch: "STRK-224-companion-failure-edges"
phase: discovery
created: 2026-06-20
---

# STRK-224 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

> **Anchor note (read first):** the issue cites line numbers in the wrong (pre-STRK-225) coordinate space, and STRK-225 (#1306) added ~120 lines around line 4824, shifting the apply paths down. All line numbers below were **re-anchored by function name against `dev` HEAD (`0dd17e70`)** via `git grep` / Read. Trust the function names; the cited offsets (~2545, ~2953, ~4037, ~4834-4850) have drifted. Tooling note for the next phase: raw `grep` over the working-tree `js/cloud-sync.js` silently returned nothing in this session — use `git grep` or the Read tool, not bare `grep`, on that file.

## Existing Code

_Files and modules already in the project that this work will touch or build on._

### Production — all three edges live in `js/cloud-sync.js`

| Path | Role | Notes |
|------|------|-------|
| [`js/cloud-sync.js:2534`](../../../../../StakTrakr/js/cloud-sync.js) | **The poll same-syncId shortcut** | `if (lastPull && lastPull.syncId === remoteMeta.syncId) return;` — the gate every false watermark advance weaponizes into a skipped retry. Central to edges 2 & 3. |
| `js/cloud-sync.js:2545` | Poll → companion call | `_pollCompanionItemPriceHistory()` runs **before** the inv/settings hash shortcut (2556-2614) **and before** `handleRemoteChange()` (2649). **Edge 1 root.** |
| `js/cloud-sync.js:2585-2601` | Poll silent fast-path | inv+settings match → records `lastPull{syncId, …, itemPriceHistoryHash}` (2599-2600) and returns with **no DiffModal**. The STRK-147 D-11 path that **AC-3 must preserve.** |
| `js/cloud-sync.js:2649` | Poll → DiffModal | `await handleRemoteChange(remoteMeta)` — only reached when inv/settings differ. The companion was already merged at 2545; Cancel here can't undo it. **Edge 1.** |
| `js/cloud-sync.js:2673` | `_pollCompanionItemPriceHistory()` | Merges + records hash **immediately** (2696-2698). Signals `failed:true` **only on a thrown** error (catch 2700); a non-throwing `{hash:null}` returns `failed:false`. **Edge 1 (merges pre-modal) + Edge 2 (null-hash slips through).** |
| `js/cloud-sync.js:2905` | `_pullItemPriceHistoryVault()` | The shared pull/merge/write primitive. Returns default `{hash:null, skipped:false}` on **transient download failure** (`!resp.ok`, 2947-2953) and **decrypt error** (catch 2957-2964); the **write rethrows** (2967-2981). **Edge 2 + Edge 3 source.** |
| `js/cloud-sync.js:3829` | `_deferredVaultRestore()` | Manifest-first deferred apply. Companion pull at **4026**, hash record guarded by `if (_dvIph.hash)` (4033-4037). **Edge 3 (manifest-first).** `_applyAndFinalize()` is called at `:3956` with `remoteMeta`; it records `syncSetLastPull(remoteMeta)` at `:3598`, so `syncId` advances before the companion write at `:4026` — confirmed. Note `_previewPullMeta` is set later but is **not** what `_applyAndFinalize()` records in this path. |
| `js/cloud-sync.js:4085` | `pullWithPreview()` | Vault-first path. `_vfApplied` gate (~4824 / def at 4085); post-apply companion pull at **4917** inside `if (_vfApplied)`, hash record guarded `if (_vfIph.hash)` (4924-4930). **Edge 3 (vault-first).** `showRestorePreviewModal.onApply` calls `_applyAndFinalize(newInv, …, remoteMeta, …)` at `:3738`, which records `syncId` at `:3598`. Only after the modal promise resolves `_vfApplied=true` (`:4824`) do the post-apply companion pulls run (`:4917`) — same ordering gap as manifest-first. |
| `js/cloud-sync.js:3118-3125` | `pullSyncVault()` pull-meta | `pullMeta = {syncId, timestamp, rev}` → `syncSetLastPull(pullMeta)` commits **`syncId` independently of any companion write**. The structural shape behind edge 3: syncId advances in the inventory-apply, the companion write throws later. |

> **Adjacent poll branch (carry to approach):** the current pre-merge at `:2545` also runs ahead of the STAK-414 local-newer branch at `js/cloud-sync.js:2616-2635`, which returns after `scheduleSyncPush()` and never calls `handleRemoteChange()`. Today this means a "local newer" poll cycle still accepts remote companion history. If the approach only reasons about "silent fast-path vs DiffModal," it can still merge/record remote companion history during a poll cycle that declined the remote inventory/settings state. The approach must decide whether that local-newer cycle keeps accepting remote companion history or rolls it back. (CODEX + KIMI.)

**`_pullItemPriceHistoryVault` call sites (AC-5 = "every call site"):** five total —
1. `2685` poll helper (`_pollCompanionItemPriceHistory`, `"poll-shortcut"`)
2. `4026` deferred restore (`"manifest-path"`) — `if (_dvIph.hash)` guards hash, **not** syncId
3. silent-pull path `4230` (`if (_spIph.hash)` guarded)
4. vault-first silent path `4787` (`if (_vfSpIph.hash)` guarded)
5. `4917` vault-first post-apply (`"vault-first"`, inside `if (_vfApplied)`)

AC-5's "every call site" scope reaches the silent-pull paths (`4230`, `4787`) too: they already order `syncSetLastPull` after the companion pull, but they must still consume the new failure signal so a transient failure there does not record a partial `lastPull`. (KIMI.)

### Pure helpers — **out of scope** (no merge-algo change, per Non-Goals)

| Path | Role | Notes |
|------|------|-------|
| `js/priceHistory.js` "CLOUD-SYNC COMPANION MERGE (STRK-147)" block | `mergeItemPriceHistories`, `canonicalizeItemPriceHistory`, `collectAndHashItemPriceHistory`, `writeItemPriceHistoryStrict` | UUID-filtered, append-only, idempotent union. Loaded by the unit test via slice-and-eval. STRK-224 changes *when watermarks advance*, never these. |

### Tests (AC-9 — three new E2E)

| Path | Role | Notes |
|------|------|-------|
| [`tests/playwright/core/item-price-history-cloud.spec.js`](../../../../../StakTrakr/tests/playwright/core/item-price-history-cloud.spec.js) | STRK-147 E2E (7 tests) | **Home for the three new edge tests.** Existing `"quota/write failure leaves lastPull stale"` (517-550) already does `window.writeItemPriceHistoryStrict = () => { throw }` + `pollForRemoteChanges()` — the template for edges 2 & 3 retry tests. Drives via `window.pollForRemoteChanges()` / `window.pullWithPreview()`. (Line 517 covers the **poll** write-failure path; AC-9(c) still requires a new post-apply write-failure test.) |
| `tests/playwright/core/attachments-cloud.spec.js` | STRK-225 E2E | The **vault-first cancel** pattern (DiffModal cancel must not advance the companion watermark) — the template for edge-1's cancel test. |
| `tests/playwright/helpers/vault-fixtures.js` | Shared crypto helper | `encryptVaultPayload(page, payload, syncKey)` — extracted PR #1307. Use for any companion-vault fixture. |
| `tests/unit/cloud-sync-item-price-history-merge.test.js` | Pure-merge unit tests | Slice-and-eval over `js/priceHistory.js`. Confirms helper homes; untouched by this work. |
| `tests/playwright/coverage-map.csv:93` | Coverage inventory | Active `item-price-sync` row. **Adding test cases requires updating this row** (AGENTS.md; broader than CLAUDE.md "new spec"). |

### Doc-rot found (incidental, not in scope)

- `item-price-history-cloud.spec.js:4-8` header still claims _"RED (TDD) cohort … NOT yet wired into js/cloud-sync.js … MUST FAIL"_. STRK-147 Cohort C shipped (v3.35.26); the wiring exists and these tests pass. The header is stale. Flag for the maintainer; not a STRK-224 deliverable.
- `_pullItemPriceHistoryVault()` production JSDoc still describes the STRK-147 retry/TDD assumptions that STRK-224 supersedes (the non-throwing `{hash:null}` failure is exactly what those assumptions missed). Worth carrying into implementation cleanup if the touched lines move; not a STRK-224 deliverable. (CODEX + KIMI.)

## Prior Decisions

_From session-oracle sweep of mem0 + sessionflow (StakTrakr, 2026-06-17 → 06-20). Query strings recorded._

- **2026-06-17 — STRK-147 D-11 poll fast-path.** Companion-only remote changes must bypass the inv/settings early-return and merge silently; implemented as the extracted `_pollCompanionItemPriceHistory()`. **This is exactly what AC-3 protects** — the cancel fix for edge 1 must not break the silent path. (mem0; sessionflow `019ed6b1` turn 142 Codex; `agent-a491796794578febb`)
- **2026-06-17 — STRK-147 D-7 partial-failure / C.4 retry.** "A failed write leaves `lastPull` stale → retry next poll. No separate edit needed." The throwing-write design was deemed sufficient at STRK-147 — STRK-224 is the discovery that it **wasn't sufficient for the non-throwing `{hash:null}` path** (edge 2) nor for the syncId-before-write ordering (edge 3). (sessionflow `e4ac945d` turn 2025895)
- **2026-06-17 — STRK-147 D-6 `acceptedUuids` boundary.** Merge stays pure; each path supplies its accepted UUIDs (silent → `_currentInventoryUuids()`; vault-first → post-apply UUIDs; manifest-first → DiffEngine `newInv`). Edges must not disturb this — they change watermark timing only. (sessionflow `agent-a491796794578febb` turn 0; `e4ac945d` turn 710609)
- **2026-06-20 — STRK-225 `_vfApplied` gate pattern (the template for edge 1).** "Each companion-vault block records its sync hash after the restore-preview modal regardless of apply or cancel. STRK-147 gated the item-price-history block on `_vfApplied`; STRK-225 gated image + attachment similarly." STRK-225 fixed the **vault-first** path; **STRK-224 edge 1 is the same bug class in the POLL path**, which STRK-225 did not touch. (mem0 `ee551d58`, `9a7927a7`; session `20f2b994` turn 389409)
- **2026-06-20 — maintainer preference: fold same-class sibling bugs.** lbruton prefers folding a sibling bug of the same class living in the same code path into the current PR (STRK-225 folded attachment into an image-scoped issue) — surface it and let him make the scope call. Relevant: the five `_pullItemPriceHistoryVault` call sites are siblings; AC-5 already scopes "every call site." (mem0 `32b887c0`)
- **2026-06-20 — vault-fixtures helper extracted (#1307, `4aec686d`).** `encryptVaultPayload(page, payload, syncKey)` is the canonical companion-vault E2E crypto helper; per-spec `SYNC_KEY` passed as an arg. (sessionflow `45bc2524`)
- **STRK-223 is a separate deferred issue** (explicit-clear tombstone propagation). Confirmed no overlap with STRK-224. Non-Goal already records this. (mem0 `51245632`)

Queries used: `STRK-147 companion vault item-price-history silent companion fast path D-11`; `STRK-225 vault-first image attachment apply gated vfApplied watermark cancel`; `lastPull syncId itemPriceHistoryHash watermark retry-on-next-poll poll shortcut`; `vault-fixtures Playwright cancel DiffModal companion vault E2E`; `STRK-223 tombstone explicit-clear deferred separate issue`.

## External References

- None. This is internal control-flow hardening in one file — no new libraries, RFCs, or third-party patterns. The "prior art" is entirely in-repo (STRK-147 D-7/D-11, STRK-225 `_vfApplied`).

## Constraints

_Things the implementation must respect._

- **Preserve the D-11 silent fast-path (AC-3).** A companion-**only** remote change (no inv/settings diff → no DiffModal) must still merge silently and record its hash at 2585-2601. The edge-1 fix can only defer the merge when a DiffModal **will** be shown — but at line 2545 the code does not yet know that (the inv/settings hash check is at 2556-2614, *after* the current companion call). Reordering is implied; approach owns it.
- **STAK-470 manifest auto-merge has no companion call of its own.** The version-upgrade settings-only auto-merge branch (`js/cloud-sync.js:4289-4480`) pulls image + attachment vaults but never calls `_pullItemPriceHistoryVault()` — today it relies entirely on the poll pre-merge at `:2545`. If the Edge-1 fix moves or removes that pre-merge, this accepted/no-modal path needs an explicit companion-handling decision, or settings-only version-upgrade merges will silently drop remote price history. (CODEX + KIMI.)
- **No merge-algorithm change (Non-Goal).** `mergeItemPriceHistories` and the strict write stay as-is; only watermark timing changes.
- **`{hash:null}` is ambiguous in the current return shape.** `_pullItemPriceHistoryVault` returns the default `{hash:null, skipped:false}` for **both** genuine transient failures (download `2947-2953`, decrypt `2957-2964`) **and** the benign "no remote vault / missing deps" precondition miss (`2906-2914`). Legit "nothing changed" sets `skipped:true` **with a non-null hash** (hash-match `2919-2924`; 404 `2939-2945`). So a caller **cannot** treat `hash===null` as failure uniformly without misfiring on the benign precondition miss — and `skipped` does **not** rescue it either: the precondition-miss no-op shares the exact `{hash:null, skipped:false}` shape with transient failure (verified at `2906-2914`), so a `hash===null && skipped===false` discriminator would misfire on the benign case. The fix needs an explicit failure signal (e.g. a `failed`/`error` flag on `result`), mirroring the `failed` flag `_pollCompanionItemPriceHistory` already returns.
- **The `if (hash)` guards advance the hash, not the syncId.** Sites 2-5 guard `itemPriceHistoryHash` correctly, but the inventory-apply `syncSetLastPull({syncId,…})` (e.g. 3118-3125) commits `syncId` independently and earlier — so a later companion throw still leaves `syncId` advanced (edge 3). In the deferred + vault-first apply paths the syncId is committed inside `_applyAndFinalize` (`syncSetLastPull(meta)` at `:3598`, recording the **passed `remoteMeta`** — not `_previewPullMeta`). The fix must defer the syncId advance until the companion write succeeds, or restore prior pull metadata on the failure path. **Caveat:** `_applyAndFinalize` is shared by `showRestorePreviewModal.onApply` (`:3738`), the manifest selective path (`:3956`), and the auto-accept path (`:4249`), and carries its own settings/tag-write rollback — any change to its syncId timing must not regress that. (KIMI.)
- **Custom DOM modal testing.** DiffModal/`showRestorePreviewModal` are custom `#appDialogModal` / `#restorePreviewModal` modals — `page.on("dialog")` does **not** intercept. Use the established `waitForSelector("#appDialogModal") → #appDialogOk/#appDialogCancel` (or stub `showRestorePreviewModal` to resolve `false`) pattern, already in both specs.
- **Coverage-map row** (`coverage-map.csv:93`) must be updated when the three AC-9 cases are added (AGENTS.md).
- **Project process:** runtime code → Plane issue + worktree + PR to `dev`; `chore/`-style or `patch/<version>` branch per `.context/sketch-conventions.md`; `npm test` is the local-only gate (no CI Playwright); Codacy + CodeQL are the required checks.

## Open Questions

_Nothing blocks `approach.md`._ The design open questions were resolved during requirements grilling (Edge-1 = defer-merge + no-hash-record; Edge-2 = all five call sites). The remaining choices are **approach-phase design decisions, not unknowns needing the user**:

- **(approach) Edge-1 mechanism:** how to defer the poll companion merge until the inv/settings outcome is known while preserving the silent fast-path — reorder the companion call after the hash check, or pass a "modal-will-show" flag, or route companion into the Apply path. The reorder must also decide the other **no-modal** branches the pre-merge currently runs ahead of: the STAK-414 local-newer branch (`:2616-2635`, returns after `scheduleSyncPush()` without reaching `handleRemoteChange()` — today it still accepts remote companion history) and the STAK-470 settings-only auto-merge (`:4289-4480`, no companion call of its own). Each needs an explicit accept-or-rollback call. (No blocker — code regions fully mapped. CODEX + KIMI.)
- **(approach) Edge-2 signal:** add an explicit `failed`/`error` flag to `_pullItemPriceHistoryVault`'s `result` vs. another distinguisher of transient-failure-vs-benign-noop, and how each of the five call sites consumes it — including the silent-pull paths (`:4230`, `:4787`), which already order `syncSetLastPull` after the pull but still must not record a partial `lastPull` on a transient failure (AC-5 = "every call site"). (KIMI.)
- **(approach) Edge-3 timing:** defer the syncId-advancing `syncSetLastPull` until after the companion write in the deferred + vault-first paths, vs. snapshot-and-restore prior pull metadata on a companion throw — applied as a **single** strategy across both paths (both route through `_applyAndFinalize`'s `:3598` record), without regressing that function's own settings/tag-write rollback. (KIMI.)

## Discovery Summary

All three edges land in **`js/cloud-sync.js`** (the issue's `~line` citations have drifted; re-anchored above). Edge 1 lives in the poll path: `_pollCompanionItemPriceHistory` (2673) merges and records the companion hash at 2545 — **before** `handleRemoteChange` (2649) shows the DiffModal — so Cancel can't undo it, while the D-11 silent fast-path (2585-2601) must stay intact (the tricky bit: the merge currently runs before the code knows whether a modal will appear, and ahead of the STAK-414 local-newer and STAK-470 auto-merge no-modal branches too). Edge 2 is a return-shape gap: `_pullItemPriceHistoryVault` (2905) returns an ambiguous `{hash:null, skipped:false}` for both transient failures and the benign precondition-miss no-op, so the non-throwing failure slips past as `failed:false` and the syncId advances, tripping the 2534 shortcut — and `skipped` alone cannot disambiguate, so an explicit failure flag is required. Edge 3 is a timing gap across the deferred (3829/4026) and vault-first (4085/4917) apply paths: `syncId` is committed in the inventory apply (`_applyAndFinalize` at `:3598`) before the companion write that can throw. The pure merge helpers (in `js/priceHistory.js`) and the merge algorithm are untouched. The three AC-9 E2E tests slot into the existing `item-price-history-cloud.spec.js`, reusing its `writeItemPriceHistoryStrict`-throw and cancel-modal scaffolding plus `vault-fixtures.js`; the coverage-map row needs an update.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch-approach STRK-224`.

## Review Archive — discovery (2026-06-20)

### Resolution Summary

Reconciled via `/sketch-reconcile STRK-224 discovery` (2026-06-20). **5 accepted, 1 rejected, 0 resolved with user input.** All code-existence claims verified against `dev` HEAD `0dd17e70`.

- **Accepted (folded into Existing Code / Constraints / Open Questions / Doc-rot above):**
  - STAK-414 local-newer branch (`:2616-2635`) named as an Edge-1 no-modal decision — consensus (CODEX, KIMI).
  - STAK-470 settings-only auto-merge (`:4289-4480`) has no companion call of its own — added as a Constraint + Edge-1 decision — consensus (CODEX, KIMI).
  - AC-5 "every call site" reaches the silent-pull paths (`:4230`, `:4787`); they must consume the new failure signal — single-source (KIMI).
  - Edge-3 shared-finalizer caveat: `_applyAndFinalize` records `remoteMeta` at `:3598` and is shared by `onApply`/selective/auto-accept; deferral must not regress its rollback — single-source (KIMI).
  - Doc-rot: stale `_pullItemPriceHistoryVault` JSDoc added alongside the already-noted stale spec header — consensus (CODEX, KIMI).
- **Rejected:**
  - KIMI's proposed `hash===null && skipped===false` failure discriminator. **Factually wrong** (verified at `js/cloud-sync.js:2906-2914`): the benign precondition-miss no-op returns the default `{hash:null, skipped:false}` — the *same* shape as transient failure — so the discriminator misfires on the benign case. KIMI's review text also mis-stated this path as returning `skipped:true`. The body constraint's original conclusion (an explicit `failed`/`error` flag is required) stands and was reinforced with this rebuttal.
- The reviewers' **Verified** and **Unverified assumptions** lists are retained verbatim below as the audit record (no body change).

### CODEX Review (2026-06-20)

#### Verified

- Read the STRK-224 requirements and discovery artifacts plus `DocVault/sketch/conventions.md`, repo `AGENTS.md`, `.context/GLOSSARY.md`, `.context/sketch-conventions.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, and `.context/review-and-ci.md`.
- Verified current repo state is `dev` at `0dd17e70`, matching the discovery anchor note.
- Verified the poll shortcut and Edge 1 ordering in `js/cloud-sync.js:2534-2649`: `_pollCompanionItemPriceHistory()` runs before inventory/settings hash handling, before the STAK-414 local-newer branch, and before `handleRemoteChange()`.
- Verified `_pollCompanionItemPriceHistory()` and `_pullItemPriceHistoryVault()` behavior at `js/cloud-sync.js:2673-2717` and `2905-2990`: thrown writes produce `failed:true`, but non-throwing download/decrypt failures return `{ hash: null, skipped: false }`.
- Verified all five current `_pullItemPriceHistoryVault()` call sites: `2685`, `4026`, `4230`, `4787`, and `4917`.
- Verified Edge 3 ordering in `js/cloud-sync.js:3441-3600`, `3956-4037`, and `4804-4929`: `_applyAndFinalize()` records pull metadata before the later item-price-history write in manifest-first and vault-first apply flows.
- Verified test surfaces in `tests/playwright/core/item-price-history-cloud.spec.js`, `tests/playwright/core/attachments-cloud.spec.js`, `tests/playwright/helpers/vault-fixtures.js`, and `tests/playwright/coverage-map.csv:93`.
- Verified prior STRK-147/STRK-225 commits exist in local history, including PR merge commits `c9e8e6d9` (STRK-147), `220aea68` (STRK-225), and helper extraction `0dd17e70` / `4aec686d`.

#### Top concerns

1. Edge 1 discovery should account for the STAK-414 local-newer branch (`js/cloud-sync.js:2616-2635`), not only the DiffModal branch. A reordering that still merges companion history before the local-newer return would preserve the current "remote companion accepted while remote inventory/settings declined" behavior.
2. Edge 1 discovery should name the STAK-470 manifest auto-merge path (`js/cloud-sync.js:4300-4480`). It currently relies on the poll pre-merge for item-price-history; if the approach removes that pre-merge, this accepted/no-modal path needs an explicit decision.
3. Minor doc hygiene: the production JSDoc around `_pullItemPriceHistoryVault()` and the `item-price-history-cloud.spec.js` header still describe retry/TDD assumptions that are now stale or conditional. Not a blocking discovery defect, but worth carrying into implementation cleanup if the touched lines move.

#### Unverified assumptions

- I did not run the Playwright suite; this was a static phase review against live source and test files.
- I did not re-fetch the Plane issue body; I treated `requirements.md` plus the current session recall as the issue contract for this review pass.

### KIMI Review (2026-06-20)

#### Verified

- Re-read `requirements.md` and the full `discovery.md` artifact.
- Verified the poll path ordering in `js/cloud-sync.js:2534-2649`: `_pollCompanionItemPriceHistory()` at `:2545` runs before the inv/settings hash check (`:2556-2614`), the STAK-414 local-newer branch (`:2616-2635`), and `handleRemoteChange()` (`:2649`).
- Verified `_pollCompanionItemPriceHistory()` behavior at `:2673-2718`: merges and records hash immediately (`:2692-2698`); only thrown write failures set `failed:true` (`:2700-2715`); non-throwing `{hash:null}` returns `failed:false`.
- Verified `_pullItemPriceHistoryVault()` return shape at `:2905-2998`: returns `{hash:null, skipped:false}` on transient HTTP failure (`:2947-2953`) and decrypt failure (`:2957-2964`); returns `{hash:null, skipped:true}` on benign precondition miss (`:2907-2914`) and 404 (`:2939-2945`); rethrows only on write failure (`:2967-2981`).
- Verified all five call sites at `:2685`, `:4026`, `:4230`, `:4787`, and `:4917`.
- Verified Edge 3 timing in `_applyAndFinalize()` at `:3445-3601`: it records `syncSetLastPull(meta)` at `:3598` using the passed `remoteMeta` argument, before any manifest-first/vault-first companion pull at `:4026` or `:4917`.
- Verified the STAK-470 auto-merge branch at `:4296-4480` has no item-price-history companion call of its own; it depends on the poll pre-merge.
- Verified `tests/playwright/core/item-price-history-cloud.spec.js` line 517 already covers the **poll** write-failure path, but AC-9(c) requires a new post-apply write-failure test.
- Verified the stale RED/TDD header in `item-price-history-cloud.spec.js:4-8` and the active `coverage-map.csv:93` row.

#### Top concerns

1. **Edge 1 approach must account for three no-modal branches, not just the silent fast-path.** The poll pre-merge currently runs before the inv/settings hash shortcut (`:2585-2601`), the STAK-414 local-newer branch (`:2616-2635`), and the DiffModal path. Reordering it after the hash shortcut preserves AC-3, but the local-newer branch and the STAK-470 auto-merge branch still need an explicit decision: do they accept remote companion history or not?
2. **Edge 2 failure signal must not break benign skips.** The fix should treat `hash===null && skipped===false` as failure, while leaving `skipped===true` (404 / precondition miss) as benign. AC-5 scopes "every call site"; the silent-pull paths (`:4230`, `:4787`) order `syncSetLastPull` correctly but still need to consume the new signal so a transient failure does not record a partial `lastPull`.
3. **Edge 3 needs a single recovery strategy across both manifest-first and vault-first.** `_applyAndFinalize()` records `syncId` at `:3598` before the companion write in both paths. Deferring the `syncSetLastPull` call until after the companion write is cleaner, but note that `_applyAndFinalize()` is also called from `showRestorePreviewModal.onApply` (`:3738`) and the manifest-first selective path (`:3956`) — any change must not regress the rollback logic for settings/tag write failures inside `_applyAndFinalize` itself.

#### Unverified assumptions

- I did not run the Playwright suite; this was a static phase review against live source and test files.
- I assumed the STRK-224 Plane issue body matches `requirements.md`; I did not re-fetch it.
- I assumed `_applyAndFinalize()` is not called from any other path that intentionally relies on `syncId` being recorded before a later companion-style side effect; I only checked the manifest-first and vault-first callers shown in discovery.
