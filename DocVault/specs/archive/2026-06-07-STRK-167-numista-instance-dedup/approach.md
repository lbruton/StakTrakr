---
sketch: "STRK-167-numista-instance-dedup"
phase: approach
created: 2026-06-07
---

# STRK-167 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

> **Reconciled 2026-06-07** (QWEN + GEMINI + CODEX review). Two data-safety corrections landed: the `_possibleDuplicate` flag must NOT live on the persisted Item (D-4), and the `name|date` enrichment fallback must be forbidden for numista-bearing rows after an instance-key miss (D-7). Stamp-point, bucket semantics, caller enumeration, and badge contrast were all tightened. Raw review text under `## Review Archive`.

## High-Level Architecture

The change spans three thin layers, each isolated from the next:

1. **Identity layer** (`js/diff-engine.js`, `js/changeLog.js`). One authoritative `DiffEngine.computeItemKey` whose instance tier becomes `numistaId|year|grade|certNumber` (year = `item.year`; grade/cert trimmed + lowercased, empty→`""`). The `changeLog.js` mirror stops being a hand-kept copy and **delegates** to `DiffEngine.computeItemKey` at call-time (guarded fallback), permanently killing the drift that caused this bug. `enrichItemIdentities` uses the same instance-key helper and its lookup map is restructured to hold **multiple local items per numista key** (buckets, FIFO match-then-consume).

2. **Import layer** (`js/inventory-import.js`). `importNumistaCsv` stops letting a pre-stamped `uuid`/`serial` mask the instance tier, runs a **within-CSV collapse pre-pass** (group by the bare instance key, sum `qty`) _before_ any identity stamping, then **re-routes to the existing `showImportDiffReview`** exactly as `importCsv` does. The `replaceInventory` closure and the STRK-165 onboarding-replace dialog are deleted; the programmatic `override→runReplace` path stays. Possible-duplicate detection is computed **here** (it has `inventory`) and passed to the modal as a **sidecar** (never attached to the item).

3. **Reconciliation-UI layer** (`js/diff-modal.js` + the `#diffReviewModal` `<style>` block in `index.html`). The qty field gains a 3-way control (Keep / Replace / Add-to-existing); selection and the summed value are handled in the modal's existing selection plumbing so the shared `DiffEngine.applySelectedChanges` is untouched. Added rows render an advisory possible-duplicate badge from the sidecar flag. All of this was prototyped against the live modal in the base-href harness (see UI Contract).

The data-layer changes (layers 1–2) are unit-testable in isolation; the UI layer (3) is Playwright + visual. That split is the TDD seam for the tasks phase.

## Key Decisions

| #       | Decision                                                                                                                                                                                                                                                                                                                                                                                                    | Rationale                                                                                                                                                                                                                                                                                                                                                                                 | Tradeoff                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1** | **Consolidate identity to one `DiffEngine.computeItemKey`; `changeLog.js` delegates to it at call-time** (guarded `window.DiffEngine` fallback to a minimal inline copy).                                                                                                                                                                                                                                   | STRK-167 exists _because_ three copies drifted. Delegation removes the mirror as a maintenance burden permanently.                                                                                                                                                                                                                                                                        | A runtime coupling: `changeLog.js` loads _before_ `diff-engine.js` (index.html :8549 vs :8550), so delegation must be **call-time** (safe — all calls fire post-load) with an inline fallback kept only as a safety net. Not zero-duplication, but the fallback is no longer the primary.                                                                                                          |
| **D-2** | **Key the instance tier as `numistaId\|year\|grade\|certNumber`** (year=`item.year`; grade/cert trim+lowercase, empty→`""`).                                                                                                                                                                                                                                                                                | Captures physical-instance identity; year prevents distinct issue years collapsing (the old key carried year only via volatile `name`).                                                                                                                                                                                                                                                   | A coarser key than name+date in one respect: two ungraded same-N#+year rows are deliberately _merged_ (that's AC-6, intended), so any real-world case where same-N#+year must stay separate is unsupported (none known).                                                                                                                                                                           |
| **D-3** | **Collapse on the bare instance key, then stamp identity at a pinned point: `collapse → enrichItemIdentities → stamp uuid/serial on still-unmatched incoming → compareItems`.** Do NOT rely on `saveInventory`/`loadInventory` to backfill.                                                                                                                                                                 | Fixes both short-circuits (fresh uuid _and_ fresh serial). The pinned stamp point guarantees accepted **add** Items are never saved keyless: matched rows get a backfilled UUID from enrich; genuinely-new rows get a fresh uuid+serial _before_ compare/apply.                                                                                                                           | `saveInventory` writes the array as-is ([inventory.js:184](js/inventory.js:184)) and `loadInventory` only stamps missing serials on a _later_ reload ([inventory.js:351-364](js/inventory.js:351)), so "late" cannot mean "at save." Requires inserting an explicit enrich+stamp step in the Numista path before `showImportDiffReview`'s own enrich/compare (idempotent — re-enrich is harmless). |
| **D-4** | **Possible-duplicate flag travels as a SIDECAR** (a Set/map keyed by instance-key or item reference) passed to `DiffModal.show`; `_renderOrphanCards` stays `(type, items)` and looks the flag up.                                                                                                                                                                                                          | `applySelectedChanges` appends added Items **whole** ([diff-engine.js:744-746](js/diff-engine.js:744)) and `_postImportCleanup` saves them, and `sanitizeObjectFields` preserves unknown non-string props ([utils.js:1107-1135](js/utils.js:1107)) — so a `_possibleDuplicate` _property_ would persist. A sidecar never touches the item.                                                | The modal needs one extra `options` field; the lookup must key on something stable (instance-key) so it survives the render.                                                                                                                                                                                                                                                                       |
| **D-5** | **Compute SUM at selection-build time** (`_buildSelectedChanges`), not in `applySelectedChanges`.                                                                                                                                                                                                                                                                                                           | Keeps the shared apply patch (`updated[field]=value`) untouched — no blast radius into cloud sync.                                                                                                                                                                                                                                                                                        | qty "sum" semantics live in the modal layer, slightly splitting qty logic between engine (compare) and modal (resolve).                                                                                                                                                                                                                                                                            |
| **D-6** | **Default qty selection = Replace** (existing `_fieldSelections` default `"remote"`).                                                                                                                                                                                                                                                                                                                       | Numista "Quantity owned" is authoritative → re-import is idempotent, no doubling.                                                                                                                                                                                                                                                                                                         | A user who wants to accumulate must pick "Add to existing" per row (acceptable; bulk "Keep All Remote" still maps to Replace).                                                                                                                                                                                                                                                                     |
| **D-7** | **Restructure `enrichItemIdentities` numista lookup into FIFO buckets (array per key, shift-to-consume, preserving the `usedUUIDs` invariant); AND forbid the `name\|date` fallback for numista-bearing incoming rows after an instance-key miss.**                                                                                                                                                         | Two-part data-safety fix: (a) last-write-wins `Map.set` silently drops UUIDs when >1 local item shares a key (OQ-6); (b) the `name\|date` fallback ([diff-engine.js:413-417](js/diff-engine.js:413)) can reattach a **graded** local UUID to an **ungraded** incoming row sharing name/date, turning an AC-11 advisory _add_ into a destructive _modified match_ that clobbers cert data. | Numista-bearing incoming rows lose the `name\|date` enrichment tier (intentional — they must match on instance identity or be treated as a genuine add). Non-numista items keep the full ladder. Bucket exhaustion → incoming row remains un-enriched (becomes an add), never silently reattached.                                                                                                 |
| **D-8** | **Accept the global key change; the cloud-sync blast radius is the `vault.js` restore path.** `matchItems` is called only by `compareItems`, whose only two callers are `showImportDiffReview` ([inventory-import.js:105](js/inventory-import.js:105), import) and the cloud-sync restore ([vault.js:603](js/vault.js:603)). Both run `enrichItemIdentities` first, so UUID backfill precedes key matching. | One identity rule everywhere; the instance tier only fires for items lacking _both_ uuid and serial (incoming CSV rows; cloud-restore items missing UUIDs). Local inventory always has a serial (`loadInventory`).                                                                                                                                                                        | Requires a graded/ungraded **round-trip regression** on the `vault.js` restore path as the safety net rather than a code change.                                                                                                                                                                                                                                                                   |

## File Map

### New

- `tests/unit/diff-engine-instance-key.test.js` — unit coverage for `computeItemKey` instance tier + normalization + the changeLog/diff-engine equivalence (AC-1, AC-2, AC-3, AC-4), the within-CSV collapse helper (AC-6), and the enrich bucket/no-fallback behavior (D-7).

### Modified

- `js/diff-engine.js` — `computeItemKey` instance tier → `numistaId|year|grade|certNumber` (normalized); extract a small `_instanceKey(item)` helper reused by `computeItemKey` + `enrichItemIdentities`; restructure `enrichItemIdentities` numista lookup into FIFO buckets + forbid `name|date` fallback for numista-bearing rows (D-7).
- `js/changeLog.js` — `computeItemKey` delegates to `DiffEngine.computeItemKey` (guarded fallback); removes the serial-guard divergence (OQ-7 falls out of delegation).
- `js/inventory-import.js` — `importNumistaCsv`: within-CSV collapse pre-pass on the bare instance key (AC-6); pinned `enrich → stamp-unmatched → compare` sequence (D-3); re-route to `showImportDiffReview` (AC-7/AC-9); delete `replaceInventory` closure + STRK-165 dialog (AC-12), keep `override→runReplace` (AC-13). `showImportDiffReview`: compute possible-duplicate sidecar against `inventory` and pass to `DiffModal.show` (AC-11, D-4).
- `js/diff-modal.js` — `_renderModifiedSection`: qty 3-way control (AC-10); `_onModifiedClick`: `sum` selection state + `aria-checked` sync; **keydown Space/Enter→click** on `[role=radio]` (a11y); `_buildSelectedChanges`: `sum` → `localVal+remoteVal` (D-5); `_renderOrphanCards`: render the possible-duplicate badge from the sidecar (AC-11).
- `index.html` — add `.dm-qty-opt` / `.dm-qty-options` / `.dm-dup-flag` / `.sr-only` rules to the existing `#diffReviewModal` `<style>` block (the dm- styles' home).
- `tests/playwright/core/numista-import-onboarding.spec.js` — rewrite all 4 STRK-165 replace-gate cases for the merge path (AC-7/9/12/13).
- `tests/playwright/coverage-map.csv` — update the Numista import coverage entry (line ~75).

### Deleted

- None as files. (Removed _code_: the `replaceInventory` closure and the STRK-165 onboarding-replace dialog inside `importNumistaCsv`.)

## Data / Schema Changes

None — no persisted-data shape change, no migration. The instance key is computed at runtime. The possible-duplicate flag is a **sidecar** (never written to an item or to storage — D-4). Existing items' `grade`/`certNumber`/`year` fields already exist.

## Tradeoffs Surfaced for Review

- **D-1 (changeLog delegation) is the boldest call.** The conservative alternative is "keep two copies but make them byte-identical." Delegation is better long-term (kills drift) but introduces a call-time dependency. If a reviewer prefers the conservative path, it's a one-line swap in the tasks plan. _(Reviews accepted delegation; no objection raised.)_
- **D-3 reorders the importer.** The pinned `enrich → stamp-unmatched → compare` sequence is the safe fix; reviewers should sanity-check that no later code in `importNumistaCsv` reads `item.serial`/`item.uuid` before that point. _(CODEX confirmed save-as-is + late load-stamp; sequence pinned accordingly.)_
- **D-7 forbids `name|date` fallback for numista rows.** This is a deliberate behavior change to close the graded→ungraded mis-enrichment hole; the tasks phase must add a test proving an instance-key miss becomes an add (with the AC-11 flag), not a modified match.

## UI Contract

**This sketch has a UI surface (the import diff-review modal). The mockup is the binding visual/interaction spec.**

### Mockup Artifacts

| Artifact                                                     | Path                                                                                          | What it defines                                                                                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base-href harness (runs the **real** app + real `DiffModal`) | `playground/STRK-167-numista-merge/index.html`                                                | Live render of both controls across all 4 themes + 320px; control panel for theme/reopen                                                                                                                     |
| Editable `diff-modal.js` override (the prototype)            | `playground/STRK-167-numista-merge/diff-modal.js`                                             | The render/select/apply code for both controls — its `diff` vs `js/diff-modal.js` is the Cohort-C starting point (note: the prototype attaches the dup flag inline; the impl must switch to the D-4 sidecar) |
| Screenshots                                                  | `playground/STRK-167-numista-merge/shot-{dark,ac10-light,ac10-slate,ac11-sepia,ac10-320}.png` | Verified states (see below)                                                                                                                                                                                  |

### Named States / Screens

| State                          | Description                                                                                                                 | Mockup reference                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Modified row — qty differs     | 3-way control: **Keep** (local) · **Replace** (remote, **default/selected**) · **Add to existing** (`local + remote = sum`) | `shot-ac10-light.png`                  |
| Modified row — non-qty field   | Existing 2-cell local→remote picker, **unchanged** (price row shown beside qty for contrast)                                | `shot-ac10-light.png`                  |
| Added row — possible duplicate | Amber advisory badge "⚠ Possible duplicate of a graded item" under the item name                                            | `shot-dark.png`, `shot-ac11-sepia.png` |
| Added row — normal             | No badge (e.g. the new Krugerrand)                                                                                          | `shot-dark.png`                        |
| Narrow viewport (320px)        | 3-way control stays single-row, verb/number stacked per cell, no truncation                                                 | `shot-ac10-320.png`                    |

### Component / Token Requirements

- Classes: `.dm-field-diff-qty`, `.dm-qty-options` (`role="radiogroup"`), `.dm-qty-opt` (`role="radio"`, variants `.local` / `.remote` / `.sum`), `.dm-qty-verb`, `.dm-qty-num`; `.dm-dup-flag`, `.dm-dup-icon`, `.dm-dup-text`, `.sr-only`.
- **Dup badge color (WCAG AA — pinned, not "verify"):** `--warning` as a solid background **fails AA** on small text in light/sepia (~1.4:1 per `.context/implementation-gotchas.md:26-30`). Use the StakTrakr alert pattern: `background: color-mix(in srgb, var(--warning) 15%, var(--bg-secondary)); color: var(--warning-text, var(--warning));`. `--warning-text` (darker amber) is defined in **light + sepia** (`css/styles.css:57, 474`) and the `var(--warning-text, var(--warning))` fallback covers **dark + slate** (bright amber on a dark low-opacity bg passes). Sum-verb accent uses `--info`. Selected state reuses the existing `.dm-field-value.selected` styling. **No hardcoded hex** — drop the mockup's `var(--x, #fallback)` fallbacks (tokens exist in all four themes: `--info`/`--warning` light :53-56, dark :220-223, slate :349-352, sepia :470-474).
- Touch target ≥ 44px per qty option (mockup measured 49px).

### Interaction Contract

- **Default qty selection = Replace** (remote). One of the three is always selected.
- Selecting an option updates `.selected` **and** `aria-checked` together (mockup fix verified). "Keep All Local"/"Keep All Remote" map to Keep/Replace; there is **no** bulk "Add".
- **Keyboard activation (in-scope a11y):** `div[role=radio][tabindex=0]` does NOT fire click on Space/Enter. Add a keydown listener on the modified-list container that, when the target is `[role=radio]`, intercepts Space/Enter and calls `.click()`. Without this the 3-way control is keyboard-inaccessible.
- "Add to existing" emits the **summed** value as the modify record's `value`; the shared `applySelectedChanges` is not modified.
- The dup badge is **advisory only** — it never blocks import, never auto-merges; the user still chooses Import/Skip on that row.
- **320px: keep the single-row 3-cell layout — do NOT switch to a `<select>`** (GEMINI suggested it; the live harness showed no truncation, so the suggestion is superseded by evidence).
- a11y: the badge carries an `.sr-only` full-sentence description; the qty group is a labeled `radiogroup`.

## Out of Scope (follow-up issues)

- Full arrow-key **roving-tabindex** navigation within the qty radiogroup (basic Space/Enter activation is now in-scope; arrow-key roving is a polish follow-up — file under StakTrakr).
- A user-facing "merge vs replace entire inventory" setting (override stays programmatic — non-goal).
- Extending the possible-duplicate heuristic to near-duplicates beyond graded-vs-ungraded (non-goal).

## Risk Notes

- **`name|date` enrich fallback (data-safety)** → mitigation: D-7 forbids it for numista-bearing rows; add a test proving an instance-key miss becomes an add, not a modified match.
- **`_possibleDuplicate` persistence** → mitigation: D-4 sidecar; add a test asserting no `_possibleDuplicate` key on any saved item after apply.
- **Cross-cutting key change** → mitigation: D-8 names the two `matchItems` callers; graded/ungraded `vault.js` restore round-trip regression.
- **changeLog load-order** (loads before diff-engine) → mitigation: delegation is call-time + guarded fallback (D-1).
- **Importer stamp point** → mitigation: D-3 pins `enrich → stamp-unmatched → compare`; verify no in-function reader of `serial`/`uuid` before that step.
- **Badge contrast** → mitigation: A6 token recipe pinned (no raw `--warning` background text).

---

> **Phase complete?** Architecture clear, decisions logged with rationale + tradeoff, file map complete, UI Contract bound to the mockup, reviews reconciled. Then advance: `/sketch-tasks STRK-167`.

## Review Archive — approach (2026-06-07)

### Resolution Summary

- **Accepted (7):** D-1 line-ref fix (QWEN); D-3 pinned stamp point `collapse→enrich→stamp-unmatched→compare` (QWEN+CODEX); D-4 sidecar instead of item property (CODEX); D-7 FIFO buckets + forbid `name|date` fallback for numista rows (QWEN+CODEX, data-safety); D-8 enumerate the two `matchItems` callers (QWEN); badge WCAG color recipe `color-mix(--warning 15%, --bg-secondary)` + `--warning-text` fg (QWEN+GEMINI); keyboard Space/Enter activation for the qty radios (GEMINI). All integrated above.
- **Resolved with user input (0).**
- **Rejected (0).**
- Reviewer "unverified assumptions" (importCsv reference pattern, playground diff delta, external Numista export variants) carried forward as tasks-phase verification notes; no approach change needed.

### QWEN Review (2026-06-07)

#### Verified

All code/file claims in the approach were checked against live `dev` (2026-06-07):

- `diff-engine.js:325-343` `computeItemKey` ladder: `uuid → serial → numistaId|name|date → name|date` ✅
- `diff-engine.js:359-422` `enrichItemIdentities` — Map-based lookup, last-write-wins on `uuidByNumista` ✅
- `diff-engine.js:439-468` `matchItems` — called only from `compareItems` (:496) ✅
- `diff-engine.js:488-496` `compareItems` calls `matchItems` ✅
- `changeLog.js:24-30` standalone `const computeItemKey` mirror ✅
- `changeLog.js:27` serial predicate `if (item.serial)` (truthy) vs `diff-engine.js:332` explicit guard ✅
- `inventory-import.js:871-872` fresh serial + uuid stamping ✅
- `inventory-import.js:927-953` `replaceInventory` closure ✅
- `inventory-import.js:105` `compareItems` call in `showImportDiffReview` ✅
- `vault.js:596-603` cloud-sync restore calls `enrichItemIdentities` then `compareItems` ✅
- `diff-modal.js:1540` `_renderOrphanCards(type, items)` signature confirmed ✅
- `diff-modal.js:2762-2821` `_buildSelectedChanges` emit shape ✅
- `index.html:8549-8550` script load order: `changeLog.js` before `diff-engine.js` ✅ (but approach cites wrong lines — see D-1 inline)
- `css/styles.css` — `--info` and `--warning` defined in all four themes (light :53-56, dark :220-223, slate :349-352, sepia :470-474) ✅
- `css/styles.css` — `--warning-text` defined in light (:57) and sepia (:474) but **not** in dark or slate ✅ (relevant to the WCAG finding)
- `playground/STRK-167-numista-merge/` — all cited mockup files present (index.html, diff-modal.js, 6 screenshots) ✅
- `index.html` inline `<style>` — confirmed as the home for all `dm-*` and `#diffReviewModal` styles (not in `css/styles.css`) ✅

#### Top concerns

1. **D-8 `matchItems` callers not enumerated.** The approach commits to "enumerate `matchItems` callers" as the cloud-sync blast-radius mitigation but doesn't list them. There are exactly two: `showImportDiffReview` (inventory-import.js:105) and `vault.js:603` (cloud-sync restore). Both go through `enrichItemIdentities` first, so the UUID-backfill tier runs before key matching — which means the practical impact of the tertiary-key change is limited to items that lack both uuid and serial (incoming CSV rows, cloud-restore items missing UUIDs). The approach should name these callers so the tasks phase knows the verification scope.

2. **D-3 within-CSV collapse placement is ambiguous.** "Before any identity stamping" doesn't specify whether the collapse is a post-parse pass on the `imported[]` array (after all rows are built but before the diff) or an inline dedup during row construction. The current code stamps serial/uuid inside the row loop (`:871-872`) and passes them to `sanitizeImportedItem` (`:898-899`). Restructuring requires either (a) deferring stamping until after collapse or (b) stamping, collapsing, then stripping. The tasks phase will need an explicit answer.

3. **D-7 bucket consumption model underspecified.** "Array per key, match-then-consume" doesn't state how the existing `usedUUIDs` Set interacts with buckets. When multiple incoming items match the same numista-key bucket, each should consume a distinct local UUID (FIFO shift?). When the bucket is exhausted, does the incoming item fall through to the name+date tier, or remain un-enriched? The current last-write-wins Map silently drops UUIDs; the fix must be explicit about the replacement semantics.

4. **`--warning` WCAG AA failure on badge text.** The approach says "verify per `.context/implementation-gotchas.md`" but the gotcha is a **known failure** (1.4:1 contrast on small text in light/sepia), not an open question. The dup badge (`.dm-dup-flag`) will render text on a `--warning` background. If the text is small, it needs `--warning-text` (darker amber, defined in light+sepia) or equivalent. Note: `--warning-text` is **not** defined in dark or slate themes — the approach should specify a fallback or confirm the badge text is large enough (≥ 18.66px bold) to pass WCAG AA with raw `--warning`.

#### Unverified assumptions

- **Numista CSV row semantics.** I did not verify externally whether Numista exports can contain same-N# different-year rows. The approach's D-2 key includes year, so this is handled correctly if it occurs — but the within-CSV collapse (D-3/AC-6) groups by the full instance key including year, so same-N# different-year rows would correctly remain separate. No action needed.
- **`importCsv` reference pattern for late serial/uuid.** The approach leans on `importCsv` as the reference for how identity fields are assigned late. I did not trace `importCsv`'s exact serial/uuid assignment path to confirm it matches the proposed reorder. The tasks phase should verify this when implementing D-3.
- **Playground mockup `diff-modal.js` diff vs live.** The approach says the playground's `diff-modal.js` is the "Cohort-C starting point." I confirmed the file exists but did not diff it against `js/diff-modal.js` to measure the delta. The tasks phase should start from the playground version as stated.

### GEMINI Review (2026-06-07)

#### Verified

I have reviewed the technical approach document for `STRK-167` against the codebase, global guidelines, and the playground mockup. The layout of the 3-way reconciliation options and the duplicate badge in the playground mockup files were verified:

- Verified that the playground files `playground/STRK-167-numista-merge/diff-modal.js` and `index.html` contain the markup for `.dm-qty-options` with `role="radiogroup"` and `[role="radio"]` elements, and `.dm-dup-flag` with screen-reader friendly text.
- Verified that `--warning` and `--info` color tokens are defined across all four themes in `css/styles.css`, but `--warning-text` is only present in `light` and `sepia`.
- Verified the event delegation listeners on `listEl` for clicking modified items in `playground/STRK-167-numista-merge/diff-modal.js:3088` (`listEl.addEventListener("click", _onModifiedClick)`).

#### Top concerns (UI/UX & A11y)

1. **Accessibility Contrast Compliance (D-4):**
   The duplicate badge (`.dm-dup-flag`) needs to pass WCAG AA contrast (~4.5:1). A solid `--warning` background fails this standard for small text on light backgrounds.
   - **Recommendation:** Use a low-opacity mixture `background: color-mix(in srgb, var(--warning) 15%, var(--bg-secondary));` and set the foreground to `color: var(--warning-text, var(--warning));`. This leverages StakTrakr's built-in themes automatically, providing dark-amber text on light themes and high-contrast yellow/orange text on dark themes.

2. **Keyboard Accessibility for Radio Selections (D-5):**
   The custom `.dm-qty-opt` elements have `role="radio"` and `tabindex="0"`, but they are native `div`s. Browser focus will land on them, but pressing Space or Enter will not trigger a click.
   - **Recommendation:** We must add a keydown event delegation listener to `listEl` that checks if the active element has `role="radio"` and triggers `.click()` on Space or Enter. This ensures the 3-way quantity control is accessible to screen readers and keyboard-only collectors.

3. **Default Selection Idempotency (D-6):**
   Confirming "Replace" (remote) as the default selection is a solid choice. It matches typical user intent when importing an onboarding file and prevents bulk imports from doubling inventory.

#### Unverified assumptions

- I did not verify whether the 3-way row layout behaves perfectly on actual physical iOS devices of different dimensions; however, the playground's viewport simulation at 320px indicates that wrapping and stacking occur without truncation.

### CODEX Review (2026-06-07)

#### Verified

- Read `requirements.md`, `discovery.md`, and this `approach.md`, plus `DocVault/sketch/conventions.md`, `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, and `.context/sketch-conventions.md`.
- Checked identity and matching surfaces: `js/diff-engine.js:325-343`, `:359-422`, `:439-468`, `:488-496`, `:744-746`; `js/changeLog.js:24-30`, `:191-210`.
- Checked import/apply/save sequencing: `js/inventory-import.js:86-157`, `:212-222`, `:362-466`, `:871-900`, `:927-1008`, `:1383-1420`; `js/inventory.js:169-185`, `:351-364`; `js/utils.js:1107-1135`, `:1512-1584`.
- Checked UI mount points and mockup references: `js/diff-modal.js:1540-1668`, `:1683-1916`, `:2325-2341`, `:2762-2821`; `playground/STRK-167-numista-merge/diff-modal.js` qty/duplicate markup references; `tests/playwright/coverage-map.csv:75`.

#### Top concerns

1. **Accepted add Items still need stable identity before save.** The approach's "late" serial/UUID assignment leans on `saveInventory()`/`loadInventory()`, but save writes the current array as-is and load stamps only after a later reload. Tasks should pin the exact safe stamping point: after collapse + identity enrichment, before compare/apply for still-unmatched incoming Items.
2. **The possible-duplicate flag must not live on the persisted Item.** `applySelectedChanges()` appends added Items whole, so `_possibleDuplicate` will persist unless the implementation uses a sidecar view model/map or strips it before save.
3. **Numista instance-key misses must not fall through to `name|date` enrichment.** A name/date fallback can reattach an ungraded incoming row to a graded local Item, turning the AC-11 advisory add into a destructive modified match.

#### Unverified assumptions

- I did not run the app or test suites; this was a review-only source/document pass.
- I did not verify real Numista export variants externally. The concerns above are grounded in the current parser, identity ladder, and acceptance criteria.
