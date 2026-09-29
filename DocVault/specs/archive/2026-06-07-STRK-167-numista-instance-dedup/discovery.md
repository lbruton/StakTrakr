---
sketch: "STRK-167-numista-instance-dedup"
phase: discovery
created: 2026-06-07
---

# STRK-167 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

> All `path:line` pointers below were verified against current `dev` (2026-06-07). Where a research agent's recalled claim disagreed with live code, the live code wins and is noted.
>
> **Reconciled 2026-06-07** (QWEN + CODEX + GEMINI review). Two review findings reshaped the design: (1) a fresh **serial** short-circuits matching just like the UUID, and (2) **year** must be part of the Item Identity Key. The target instance key is therefore **`numistaId|year|grade|certNumber`** (year = `item.year`/issuedYear; grade/cert trimmed + lowercased, empty→`""`). Raw review text is preserved under `## Review Archive`.

## Existing Code

### Identity key — the 3 sites that must change in lockstep (AC-1, AC-2)

| Path                    | Role                                                                                                                                                                                                                                                                                                                         | Current tertiary tier                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `js/diff-engine.js:325` | `DiffEngine.computeItemKey(item)` — authoritative. Ladder: `uuid → serial → numistaId\|name\|date → name\|date`.                                                                                                                                                                                                             | `numistaId\|name\|date` ([:337-339](js/diff-engine.js:337)) |
| `js/changeLog.js:24`    | Hand-kept **mirror** of computeItemKey. JSDoc at `:18-20` says "Mirrors DiffEngine.computeItemKey()"; constraint comment at `diff-engine.js:319` says "STAK-187 changeLog.js extension MUST use this same function."                                                                                                         | `numistaId\|name\|date` ([:28](js/changeLog.js:28))         |
| `js/diff-engine.js:359` | `enrichItemIdentities(local, incoming)` — independently re-implements the same ladder to backfill UUIDs. **Verified**: its numista tier DOES include name (`numistaId\|name\|date`) at [:374-376](js/diff-engine.js:374) and [:402-404](js/diff-engine.js:402) — no pre-existing discrepancy (contra one stale agent claim). | `numistaId\|name\|date`                                     |

All three currently agree on `numistaId|name|date`; STRK-167 moves all three **in lockstep** to **`numistaId|year|grade|certNumber`** (year = `item.year`/issuedYear; grade/cert trimmed + lowercased, empty→`""`). The old key captured year only incidentally via `name`; the new key captures it explicitly so distinct issue years never collapse (see OQ-1, OQ-8).

**Two pre-existing discrepancies to resolve while all three sites are open** (reviewer-confirmed):

- **Serial predicate divergence (QWEN).** `changeLog.js:27` uses `if (item.serial)` (truthy — skips serial `0`), while `diff-engine.js:332` uses `if (item.serial != null && item.serial !== "")` (explicit — accepts serial `0`). Tertiary tier is identical, so not a blocker, but normalize the serial guard during the 3-site change (see OQ-7).
- **`enrichItemIdentities` Map collision (QWEN).** `uuidByNumista` is built as a `Map` at [:367-383](js/diff-engine.js:367) — when two local items share the same numista key, only the last item's UUID survives `Map.set`. The key-format change alone does not fix this; the Map-building loop itself needs restructuring to handle multiple local items per numista key (see OQ-6).

### Numista importer (the surface that re-routes to merge)

| Path                              | Role                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/inventory-import.js:710`      | `importNumistaCsv(file, override=false)`                                                               | Parses rows, builds items, then **only** calls `replaceInventory()` today. No merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `js/inventory-import.js:871-872`  | `const serial = getNextSerial();` / `const uuid = generateUUID();`                                     | **Root cause — TWO identity short-circuits, not one.** Both a fresh `serial` ([:871](js/inventory-import.js:871)) and a fresh `uuid` ([:872](js/inventory-import.js:872)) are stamped on every row and passed into the item ([:898-899](js/inventory-import.js:898)). `computeItemKey` returns `uuid` first, then `serial` ([diff-engine.js:331-334](js/diff-engine.js:331)), so the numista tier never fires. **Stripping only the UUID is insufficient** (CODEX) — the fresh serial still short-circuits AC-6 within-CSV collapse and AC-9 empty-inventory merge. Approach must defer/strip BOTH (or compute dedup keys from the bare instance tier) — see OQ-1. |
| `js/inventory-import.js:761`      | `name = \`${title} ${year}\``                                                                          | Appends year to name → API vs CSV names diverge (why `name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | date` was volatile). |
| `js/inventory-import.js:893`      | `year: issuedYear` (parsed at [:760-762](js/inventory-import.js:760))                                  | The issue **year** is already parsed and stored separately on the item — available as the key's `year` component. (Distinct from `item.date`, which is the _acquisition_ date.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `js/inventory-import.js:894-896`  | `grade: ""`, `gradingAuthority: ""`, `certNumber: ""`                                                  | Numista CSV rows are **always ungraded** — Numista exports carry no grading. This asymmetry is load-bearing: ungraded rows of the same N#+year key to `numistaId\|year\|\|` and collapse; existing graded inventory keys distinctly and stays separate.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `js/inventory-import.js:927-953`  | `replaceInventory()` closure                                                                           | Destructive replace. **To be removed** — its post-steps (registerName, catalogManager.syncInventory, clearInventoryRecovery, saveInventory, renderTable, renderActiveFilters, updateStorageStats) are all already performed by `_postImportCleanup` inside the merge path. (Timing note: `replaceInventory` `await`s `saveInventory()` at [:940](js/inventory-import.js:940); `_postImportCleanup` does not `await` it at [:70](js/inventory-import.js:70) — pre-existing, shared by importCsv/importJson, not a defect, but note for post-import sequencing.)                                                                                                     |
| `js/inventory-import.js:958-960`  | `if (override) runReplace()`                                                                           | **Keep** — programmatic replace path (AC-13).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `js/inventory-import.js:963-1008` | STRK-165 interim onboarding-replace dialog (empty-inventory confirm + non-empty `showAppActionDialog`) | **To be removed** (AC-12).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `js/inventory-import.js:942-947`  | `scheduleSyncPush.cancel()` (STAK-421)                                                                 | Specific to the replace path; the merge path WANTS the debounced push to fire. Keep only in the override/replace branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Merge path reference — already built, already used by importCsv / importJson

| Path                            | Role                                                                                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/inventory-import.js:86`     | `showImportDiffReview(parsedItems, sourceInfo, options, onComplete)`                                                             | The merge engine. Internally: `enrichItemIdentities(inventory, parsedItems)` ([:103](js/inventory-import.js:103)) → `DiffEngine.compareItems(inventory, parsedItems)` ([:105](js/inventory-import.js:105)) → opens `DiffModal.show()` → on apply, `DiffEngine.applySelectedChanges` ([:157](js/inventory-import.js:157)) → `_postImportCleanup` ([:212](js/inventory-import.js:212)). |
| `js/inventory-import.js:647`    | `importCsv` calls it: `showImportDiffReview(imported, {type:"csv", label:file.name}, {validationResult, pendingTagsByUuid}, cb)` | **The reference call to mirror for Numista.**                                                                                                                                                                                                                                                                                                                                         |
| `js/inventory-import.js:1603`   | `importJson` calls it (adds `settingsDiff`, `exportMeta` to options)                                                             | Settings diff is JSON-only; Numista won't need it.                                                                                                                                                                                                                                                                                                                                    |
| `js/inventory-import.js:~60-73` | `_postImportCleanup`                                                                                                             | Does registerName + `catalogManager.syncInventory` + clearInventoryRecovery + saveInventory + renderTable + renderActiveFilters + updateStorageStats.                                                                                                                                                                                                                                 |

### Diff modal — where the two new UI affordances mount

| Path                         | Role                                                                                                                                                                                   | Notes                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/diff-engine.js:488`      | `compareItems` returns `{ added:[item], modified:[{item, changes:[{field, localVal, remoteVal}]}], deleted:[item], unchanged:[item] }` ([shape JSDoc :486](js/diff-engine.js:486))     | `modified[].item` is the **remote/incoming** version; `changes[]` has one entry per differing field.                                                                                                                                                                                                                                                            |
| `js/diff-engine.js:38`       | `qty` is in `DIFF_FIELDS`                                                                                                                                                              | **Key fact for AC-10:** a qty difference already surfaces as a normal field-level change.                                                                                                                                                                                                                                                                       |
| `js/diff-modal.js:1683`      | `_renderModifiedSection` (function start; `.dm-field-diff` rows with clickable `.dm-field-value.local`/`.remote` cells begin at [:1848](js/diff-modal.js:1848), inner loop ~1848-1916) | **The modal already supports per-field replace(remote)-vs-keep(local).** AC-10 only adds a **third option — SUM — for the qty field.** Use the full function scope (1683-~1920) when planning the mount, since card-level setup precedes the loop.                                                                                                              |
| `js/diff-modal.js:2325-2341` | `_onModifiedClick` → stores pick in `_fieldSelections["conflict-"+cardIdx+"-"+field]` ("local"\|"remote")                                                                              | AC-10 adds a "sum" selection state here.                                                                                                                                                                                                                                                                                                                        |
| `js/diff-modal.js:2762-2821` | `_buildSelectedChanges` emits `{type:"modify", itemKey, field, value}` where value = chosen local/remote                                                                               | **AC-10 SUM computes `value = localVal + remoteVal` here** — so `applySelectedChanges` ([diff-engine.js:715-716](js/diff-engine.js:715), `updated[field]=value`) stays unchanged.                                                                                                                                                                               |
| `js/diff-modal.js:1540`      | `_renderOrphanCards("added", items)` — function def; card loop [:1589-1668](js/diff-modal.js:1589) (`.dm-item-name` :1614, `.dm-item-meta` :1616)                                      | **AC-11 "possible duplicate" badge** mounts here. **Contract caveat (QWEN):** the signature is `(type, items)` with no inventory param — detection requires either (a) pre-computing the flag on each `added` item before passing in, or (b) adding an inventory/lookup param (which changes the contract shared by the "added" and "deleted" paths). See OQ-4. |

## Prior Decisions

_Queried mem0 + sessionflow (via session-oracle). Query strings recorded._

- **2026-06-06 — Why STRK-165 shipped replace-only.** numistaId identifies a catalog _type_, not a physical instance; a user can hold a raw + a graded copy of the same N#/year; Numista exports each instance as its own row (53 repeated N# observed). Proper key = `numistaId + grade + cert#`, sum qty only for identical ungraded copies. The proper fix was deliberately deferred to STRK-167. _(sessionflow session=d61289c1 turns 960812/962833; query "STRK-165 Numista import onboarding safety gate replace dedup")_
- **2026-06-06 — Original trigger.** User hit mass duplication reconciling a Numista import (187 items + 378-row CSV → 554 rows), restored a backup, proposed the wipe-and-replace gate. _(sessionflow session=d61289c1 turn 6641)_
- **2026-06-06 — Handoff.** PR #1223 merged (`59bb0f69`), STRK-165 → Done, STRK-167 filed as the proper-fix ticket. _(sessionflow session=d61289c1 turn 2963904)_
- **3-site lockstep is a long-standing constraint.** changeLog.js JSDoc + the STAK-187 comment require the mirror to match; no exception was ever made. _(sessionflow, changeLog.js reads 2026-05-23)_
- **Cloud-sync blast radius is NEW to STRK-167.** No STRK-154..159 convergence decision locked the tertiary key format; those addressed `DIFF_FIELDS` completeness (STAK-493), apply ordering, and manifest cutoff. Changing the tertiary tier is unprecedented and must be reasoned about in approach. _(sessionflow session=de884c9b turn 5012; query "computeItemKey numistaId grade certNumber instance identity")_
- **mem0 wrap (2026-06-07):** "User's subsequent planned work is STRK-167, adding Numista instance-aware deduplication using numistaId, grade, and cert#." _(mem0 id=eea92af4-4a03-4c59-a50a-37ed4149b945)_

## External References

- None — no new libraries, RFCs, or platform APIs. The work reuses existing in-repo machinery (DiffEngine, DiffModal, showImportDiffReview). PapaParse (already vendored) continues to parse the CSV.

## Constraints

- **3-site identity lockstep** — `computeItemKey` (diff-engine), its `changeLog.js` mirror, and `enrichItemIdentities` must change together or changelog/UUID-drift recovery diverges from sync matching. Normalize the serial-predicate divergence (OQ-7) and restructure the enrich Map loop (OQ-6) in the same pass.
- **Dedup/collapse must key on the bare instance tier, not `computeItemKey`** — because fresh import rows carry a unique `serial` AND `uuid` that short-circuit the ladder. Either strip both before dedup or compute the collapse key directly as `numistaId|year|grade|cert` (OQ-1).
- **`DIFF_FIELDS` already includes `grade`, `certNumber`, `qty`** ([diff-engine.js:38,54-56](js/diff-engine.js:38)) — change-detection for those fields already works; do NOT remove them.
- **Numista CSV rows are always ungraded** — do not invent grade/cert sourcing; the design relies on `grade=""`/`cert=""` for CSV rows.
- **`applySelectedChanges` is shared** by all import/sync paths — prefer computing the SUM value at selection-build time over changing the apply patch semantics.
- **Approach must enumerate `matchItems` callers** ([diff-engine.js:439](js/diff-engine.js:439)) to bound the cloud-sync blast radius of the tertiary-key change (QWEN unverified-assumption; not traced in discovery).
- **Post-import save timing** — the merge path's `saveInventory()` is fire-and-forget (not awaited); note when sequencing anything after the merge.
- **Test harness:** unit tests are `node --test tests/unit/*.test.js`, loading JS-with-globals via `readFileSync` + `new Function("window", src)(win)` (see `tests/unit/diff-engine-normalization.test.js:21-24`). No Jest/Vitest.
- **Date formatting / locale** and other StakTrakr gotchas per `.context/implementation-gotchas.md` still apply.

## Existing Tests (what to add / what breaks)

| Path                                                      | Status under STRK-167                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/diff-engine-normalization.test.js`            | Unaffected (timestamp/attachment normalization). **No existing unit test for `computeItemKey` / `enrichItemIdentities`** → new unit file needed (instance-key behavior, AC-1/3/4/6).                                                                                                           |
| `tests/playwright/core/numista-import-onboarding.spec.js` | **All 4 cases encode the STRK-165 replace gate and WILL break** — "confirming REPLACES" (`:79-93`), "cancelling leaves untouched" (`:95-108`), "empty inventory setup confirm" (`:110-126`), "override replaces no-confirm" (`:128-141`). Must be rewritten for the merge path (AC-7/9/12/13). |
| `tests/playwright/core/import-export.spec.js`             | Diff-engine round-trip tests (`:278-398`) unaffected — they mock `DiffModal.show()` and assert diff correctness. Good pattern to reuse for the new merge + UI tests (AC-8/10/11).                                                                                                              |
| `tests/playwright/coverage-map.csv:75`                    | Existing Numista coverage entry — update when the onboarding spec is rewritten.                                                                                                                                                                                                                |
| `tests/fixtures/seed-inventory.js`                        | Reusable seed (8 items). **No Numista CSV fixture** — `numista-import-onboarding.spec.js` builds CSV inline (`:44-47`); new tests can do the same or add a fixture.                                                                                                                            |

## Open Questions

_All are **approach-phase decisions**, not discovery blockers — none changes an AC (the year decision was resolved in reconcile and is reflected in the key above + the pending AC-1 amendment). Carried to `/sketch-approach` (and `/ui-mockup` for the two UI controls)._

- **OQ-1 (AC-6 placement + serial/uuid)** — Within-CSV collapse (sum qty for repeated instance keys) must run on the **bare instance tier `numistaId|year|grade|cert`**, computed **before** serial/uuid stamping (or with both stripped), so the diff sees one row per instance. Approach confirms placement (in `importNumistaCsv` vs inside `showImportDiffReview`) and whether import-time serial/uuid are deferred or stripped.
- **OQ-2 (AC-10 control)** — The modal already offers local/remote per field; SUM is a new third state on the qty field row. Approach + `/ui-mockup` decide the exact control (third clickable cell vs segmented control vs `<select>`) and default (recommendation: **replace**, i.e. remote). **UI requirements (GEMINI):** a third clickable cell risks crowding narrow viewports — ensure a ≥44×44px touch target; label SUM explicitly ("Add to existing" vs "Replace"); verify the row layout at 320px (no truncation/awkward wrap).
- **OQ-3 (AC-10 apply)** — Compute the summed value in `_buildSelectedChanges` (`value = localVal + remoteVal`) so `applySelectedChanges` is untouched. Approach confirms.
- **OQ-4 (AC-11 detection + badge)** — "possible duplicate" needs inventory access; likely computed in `showImportDiffReview` (it has `inventory`) and attached to the added entries, then rendered in `_renderOrphanCards`. **Contract caveat (QWEN):** `_renderOrphanCards(type, items)` has no inventory param → either pre-compute the flag or change the shared contract. **A11y (GEMINI):** badge must be announced to screen readers (`aria-label` / `span.sr-only`) and hold WCAG contrast across all four themes (`light`, `dark`, `slate`, `sepia`). Approach + `/ui-mockup` decide where detection lives and the badge's visual home.
- **OQ-5 (override + cleanup)** — Keep `override→runReplace` and its `scheduleSyncPush.cancel`; ensure the merge path does NOT cancel the push. Approach confirms the branch structure.
- **OQ-6 (enrich Map restructuring)** — `enrichItemIdentities`' `uuidByNumista` Map is last-write-wins per key; restructure the Map-building loop to handle multiple local items per numista key (not just swap the key format). Approach specifies the structure (e.g. Map→array buckets).
- **OQ-7 (serial-predicate normalization)** — Decide whether to align `changeLog.js`'s truthy `if(item.serial)` with diff-engine's explicit guard while both sites are open (handles serial `0`). Low-risk consistency fix.
- **OQ-8 (year source confirmation)** — Confirm the key's `year` component reads `item.year`/issuedYear (the issue year), not `item.date` (acquisition date) or the volatile `name`. Approach pins the exact field and its normalization.

## Discovery Summary

The work lands almost entirely in three files: `js/diff-engine.js` + `js/changeLog.js` (the 3-site instance-key change to `numistaId|year|grade|cert`, plus normalizing the serial guard and restructuring the enrich Map — still surgical, but slightly larger than a one-line key swap) and `js/inventory-import.js` (delete `replaceInventory` + the STRK-165 dialog; re-point `importNumistaCsv` at the existing `showImportDiffReview` exactly as `importCsv` does; add a within-CSV collapse pre-pass that keys on the bare instance tier and runs before serial/uuid stamping). The two UI affordances are **additive to an already-capable diff modal** — the modal already does per-field replace-vs-keep, so AC-10 only adds a SUM option to the qty row, and AC-11 adds a computed badge to add rows (with the `_renderOrphanCards` contract + a11y caveats noted). Peer review surfaced two silent-data-loss traps the issue and the original STRK-165 analysis both missed — the fresh **serial** short-circuit and the dropped **year** — both now folded into the constraints and the key definition. The one item still demanding care is the **global blast radius** of the tertiary-key change (new to STRK-167, no prior lock); approach must enumerate `matchItems` callers, even though the tier rarely fires for local (serial-bearing) items.

---

> **Phase complete?** Existing code mapped with verified `path:line`. Prior decisions surfaced with sources. Reviews reconciled. Open questions are scoped as approach decisions (none blocks drafting). Then advance: `/sketch-approach STRK-167`.

## Review Archive — discovery (2026-06-07)

### Resolution Summary

- **Accepted (10):** fresh-serial short-circuit (CODEX); serial-predicate divergence (QWEN); enrich Map collision (QWEN); `_renderOrphanCards` no-inventory contract (QWEN); line-range precision for `_renderModifiedSection`/`_renderOrphanCards` (QWEN); `saveInventory` await-timing note (QWEN); `matchItems` caller enumeration (QWEN); AC-10 control ergonomics/touch targets (GEMINI); AC-11 badge a11y + WCAG-4-theme contrast (GEMINI); `/ui-mockup` discoverability + 320px layout (GEMINI). All integrated into Existing Code / Constraints / Open Questions above.
- **Resolved with user input (1):** **year in key** → instance tier is `numistaId|year|grade|certNumber`. Pending follow-up: amend requirements AC-1 (and AC-3/AC-4 phrasing).
- **Rejected (0).**

### QWEN Review (2026-06-07)

#### Verified

All `path:line` claims in the discovery were checked against live `dev` (2026-06-07):

- `diff-engine.js:325-343` `computeItemKey` ladder: `uuid → serial → numistaId|name|date → name|date` ✅
- `diff-engine.js:374-376, 402-404` `enrichItemIdentities` numista tier uses `numistaId|name|date` ✅
- `changeLog.js:24-30` mirror matches the same ladder ✅
- `inventory-import.js:710` `importNumistaCsv(file, override=false)` ✅
- `inventory-import.js:872` `const uuid = generateUUID()` pre-stamp root cause ✅
- `inventory-import.js:761` name construction `${title} ${year}` ✅
- `inventory-import.js:894-896` grade/cert empty on CSV rows ✅
- `inventory-import.js:927-953` `replaceInventory` closure ✅
- `inventory-import.js:958-960` override path ✅
- `inventory-import.js:963-1008` STRK-165 interim dialog ✅
- `inventory-import.js:86` `showImportDiffReview` entry point ✅
- `inventory-import.js:103,105,157,212` enrich → compare → apply → cleanup chain ✅
- `inventory-import.js:647` `importCsv` reference call ✅
- `inventory-import.js:1603` `importJson` reference call ✅
- `diff-engine.js:38,54-56` `qty`, `grade`, `certNumber` in `DIFF_FIELDS` ✅
- `diff-engine.js:488` `compareItems` return shape ✅
- `diff-engine.js:715-716` `applySelectedChanges` scalar patch ✅
- `diff-modal.js:1683` `_renderModifiedSection` function definition (cited range 1821-1916 is inner loop) ✅
- `diff-modal.js:2325-2341` `_onModifiedClick` field selection ✅
- `diff-modal.js:2762-2821` `_buildSelectedChanges` emit shape ✅
- `diff-modal.js:1540` `_renderOrphanCards` function definition (cited range 1589-1668 is card loop) ✅
- `numista-import-onboarding.spec.js:79-141` all 4 STRK-165 tests at cited lines ✅

#### Top concerns

1. **`changeLog.js` serial predicate divergence (minor, pre-existing).** `changeLog.js:27` uses `if (item.serial)` (truthy — skips serial `0`), while `diff-engine.js:332` uses `if (item.serial != null && item.serial !== "")` (explicit — accepts serial `0`). The tertiary tier is identical, so this is not a STRK-167 blocker. But the approach should note it as a known discrepancy within the "3-site lockstep" and decide whether to normalize the serial guard while both sites are open.

2. **`enrichItemIdentities` Map collision under the old key.** `uuidByNumista` is built as a `Map` at `:367-383`. When two local items share the same `numistaId|name|date` (e.g. a raw and a graded coin both with empty grade/cert under the old key), only the last local item's UUID survives `Map.set`. The discovery notes the key format change but doesn't flag that the Map-building loop itself needs restructuring (not just the key format) to handle multiple local items per numista key. Approach must address this.

3. **`_renderOrphanCards` function contract for AC-11.** The function signature `(type, items)` takes no inventory parameter. AC-11's "possible duplicate" detection will require either (a) pre-computing the flag on each `added` item before passing to `_renderOrphanCards`, or (b) adding an inventory-or-lookup param. The approach should confirm which, since (b) changes the function contract used by both "added" and "deleted" paths.

#### Unverified assumptions

- **Cloud-sync `matchItems` blast radius.** The discovery summary correctly flags this as requiring approach-phase reasoning. I did not trace all callers of `matchItems` (diff-engine.js:439) to enumerate which cloud-sync paths use it directly vs. through `enrichItemIdentities`. The approach phase should do this enumeration.
- **`_postImportCleanup` `saveInventory()` not awaited.** The merge path calls `saveInventory()` without `await` at `:70`, while `replaceInventory` awaits it at `:940`. This is pre-existing behavior shared by `importCsv`/`importJson`, so not a defect — but the approach should note the timing difference when reasoning about post-import sequencing.

### CODEX Review (2026-06-07)

#### Verified

- Read `requirements.md` and this `discovery.md` for STRK-167, plus StakTrakr glossary/context rules and sketch conventions.
- Checked the live identity surfaces: `js/diff-engine.js:325-342` (`computeItemKey`), `js/changeLog.js:24-30` (mirror), `js/diff-engine.js:363-418` (`enrichItemIdentities`), and `js/diff-engine.js:439-468` (`matchItems`).
- Checked the Numista import path: `js/inventory-import.js:745-900` (row parsing/name/year/serial/uuid/item construction), `:926-1008` (STRK-165 replace gate), and `:86-157`/`:212-222` (`showImportDiffReview` apply + cleanup).
- Checked the diff modal mount points cited for AC-10/AC-11: `js/diff-modal.js:1540-1668`, `:1683-1916`, `:2325-2341`, and `:2762-2821`.
- Checked the current Numista Playwright coverage entry in `tests/playwright/coverage-map.csv:75` and the STRK-165 onboarding tests at `tests/playwright/core/numista-import-onboarding.spec.js:79-141`.

#### Top concerns

1. **Import-time serials are another identity short-circuit.** Discovery correctly calls out the fresh UUID at `js/inventory-import.js:872`, but the same row is also assigned a fresh `serial` at `:871` and passed into the item at `:898`. Since `computeItemKey()` returns serial before the Numista tier, removing only UUIDs does not guarantee AC-6 duplicate collapse or AC-9 empty-inventory merge will use `numistaId|grade|certNumber`.

2. **Within-CSV collapse lacks a year guard/validation.** Requirements and discovery both treat `year` as meaningful for possible-duplicate detection, and live parsing stores it separately. The discovery currently describes ungraded rows as collapsing to `numistaId||`; approach needs to verify whether same-N# different-year rows can exist and, if they can, avoid summing distinct issued years.

#### Unverified assumptions

- I did not verify real Numista export semantics externally; the year concern is grounded in the requirements text plus live parser behavior and should be resolved before approach locks the grouping key.
- I did not run the Playwright or unit suites; this was a review-only source/document pass.

### GEMINI Review (2026-06-07)

#### Verified

- UI affordance mount points (`_renderModifiedSection`, `_renderOrphanCards`) are correctly identified for AC-10 and AC-11.

#### Top concerns (UI/UX)

1. **AC-10 Control Ergonomics & Touch Targets (OQ-2):** Adding a third clickable cell ("SUM") to the `.dm-field-diff` row risks overcrowding on narrow mobile viewports. A segmented control or a native `<select>` drop-down might provide a more reliable 44x44px minimum touch target for iOS users.
2. **AC-11 Badge Accessibility (OQ-4):** The "possible duplicate" badge must be clearly announced to screen readers (e.g., via `aria-label` or visually hidden text `span.sr-only`). It also needs to maintain WCAG-compliant contrast across all four StakTrakr themes (`light`, `dark`, `slate`, `sepia`).

#### Recommendations for `/ui-mockup`

- **Discoverability:** Ensure the "SUM" option explicitly communicates what it does (e.g., "Add to existing" vs. "Replace").
- **Layout:** Evaluate the row layout for AC-10 on a 320px width viewport to ensure the third state doesn't cause text truncation or awkward wrapping.
