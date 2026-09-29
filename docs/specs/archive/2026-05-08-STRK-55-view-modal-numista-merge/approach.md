---
sketch: "STRK-55-view-modal-numista-merge"
phase: approach
created: 2026-05-08
---

# STRK-55 — Approach

_Architecture only — code lives in tasks.md._

## High-Level Architecture

The fix is a localized refactor of `loadViewNumistaData()` in `js/viewModal.js`. The function currently sets a single `meta` variable from `imageCache.getMetadata(catalogId)` then renders all Catalog Data fields from `meta.*`. We change the read path to a two-layer merge identical in spirit to the proven pattern in `js/inventory.js:1222-1254` (Edit modal): item-saved values win; the cache is a fallback.

Concretely, we compute `merged = mergeNumistaSources(item.numistaData, cacheMeta)`, where `mergeNumistaSources` is a small helper (private to viewModal.js) that:
1. **Defensively strips non-meaningful empty values from a copy of `itemData`** (treats `""`, `null`, `undefined` as absent for string fields; preserves `false` and `0` only for keys where they're meaningful — `commemorative`, `rarityIndex`).
2. **Spreads cache as the base, overrides with the stripped item values** so item wins for any key it actually carries.
3. **Reconciles two known shape mismatches:** preserves both `merged.kmRef` (string from item) and `merged.kmReferences` (array from cache), and both `merged.mintage` (string from item) and `merged.mintageByYear` (array from cache). The render call sites enforce explicit precedence — flat-string wins when present, array shape wins when not.

The renderer reads from `merged` only — no other source branching.

> CODEX: The "non-empty item values" phrase is doing important work. A literal `{ ...cacheMeta, ...item.numistaData }` does not itself enforce non-empty overrides; it is safe only because `events.js:1361-1364` strips empty values today. If that invariant changes to support intentional blanking, the failure mode flips from "cache fallback works" to "blank item values suppress cache values in View." If import/restore supplies raw empty strings, the same failure can happen immediately.
> → **RESOLVED:** the helper now performs its own defensive stripping (step 1 above) — no longer dependent on the modal save-path invariant or any one write-path. Future-coupling concern (intentional-blanking) is logged in Risk Notes and called out in the inline code comment at the helper.

Two visible-rendering additions ride along: obverse and reverse descriptions become full-width detail rows in the Catalog Data section (mirroring the existing edge-description pattern at `viewModal.js:1137-1143`). Image-tooltip behavior remains additive. Two new keys are added to `NUMISTA_VIEW_FIELD_DEFAULTS` (`obverse`, `reverse`) so users can toggle the new rows in Settings → Item Detail Modal, with corresponding `data-nf` markup additions in `js/catalog-manager.js`.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Helper performs **defensive empty-value stripping** on item input, then spread-merges `{ ...cacheMeta, ...strippedItem }` | Modal save path strips empties today, but `inventory-import.js` and `clone-picker.js` can deposit non-stripped values. Defensive stripping makes the helper robust against any write path. Mirrors `inventory.js` Layer-1/Layer-2 pattern but with belt-and-suspenders. | A future change to `parseNumistaDataFields` that preserves intentional blanks will need parallel updates to this helper (documented in inline comment). |
| D-2 | Helper preserves both shape siblings (`kmRef`+`kmReferences`, `mintage`+`mintageByYear`); render call sites enforce explicit flat-first precedence | Single canonical merged object; precedence lives at the visible render row, where reviewers can see and audit it. Renderer pattern: `if (merged.mintage) renderFlat(); else if (merged.mintageByYear?.length) renderArray();`. | Two precedence branches at call sites instead of one in the helper. Acceptable — the call sites are 5-10 lines each and explicit branching is easier to read than implicit field-derivation in the helper. |
| D-3 | Render `obverseDesc` / `reverseDesc` as visible full-width rows AND keep image tooltips | AC-2 is explicitly additive. Tooltips serve different ergonomics (image-anchored quick read). | Two slightly redundant places to update if the source string changes — but both read from the same `merged` value, so they stay in sync. |
| D-4 | Add `obverse` / `reverse` keys to `NUMISTA_VIEW_FIELD_DEFAULTS`, plumb through Settings UI | Existing toggles cover all other fields; consistency demands these two get toggles too. Spread-merge in `getNumistaViewFieldConfig` is forward-compatible with old localStorage. | Settings UI surface area grows by 2 rows. |
| D-5 | Drive image-frame `view-shape-rect` class from `merged.shape`, not `meta.shape` | Per-item shape edit must flip the frame too. | None meaningful — it's a one-token change. |
| D-6 | **Foreground render: item-over-cache, immediate. Background: allow cache TTL refresh as today, but don't perturb already-rendered modal.** | Partial item metadata (one key set, rest absent) needs cache to stay fresh for the un-customized fields. Suppressing refresh entirely would let cache rot indefinitely. Splitting foreground/background keeps the user's saved values authoritative on screen while letting cache freshness work normally for the next open. Per Codex C-8. | Slight complexity: refresh callback must not overwrite already-rendered DOM. Implementation: keep the existing TTL-gated refresh; just don't re-render after it lands while the modal is open. (Cache refresh updates IndexedDB; next View open reads the fresh cache.) |
| D-7 | Helper lives module-private inside `viewModal.js`, not in a shared utility file | Single caller; not yet worth a shared module. Edit modal already has its own equivalent inline in `inventory.js`. | Some duplication of the kmRef/mintage reduction logic between the two files. Acceptable; consolidation can be a follow-up if a third caller appears. |
| D-8 | No changes to `image-cache.js`, `events.js` save path, or `catalog-api.js` | Single-pass scope discipline. The cache and item stores remain independent; only the read merge changes. | None — narrower diff is easier to review. |
| D-9 | **Soften the cache-empty short-circuit** at `viewModal.js:1074` (current: `if (!meta) return;`). New gate: `if (!meta && !hasMeaningfulItemData(item.numistaData)) return;` | Current code bails before merge can use item-only data. After STRK-51 + import/restore, items can have populated `item.numistaData` without a populated cache (e.g., legacy item migrated forward, imported item whose Numista N# isn't in the local cache yet). Without this fix, cache-empty + item-populated renders nothing. Per v4-Pro V-7a. | Adds one helper `hasMeaningfulItemData(d)` (returns true if any defensively-stripped key is present). Tiny addition; no behavior regression for existing cache-populated items. |
| D-10 | Defensive empty-stripping uses an explicit `MEANINGFUL_FALSY_KEYS` Set (`new Set(["commemorative", "rarityIndex"])`) rather than inline switch/if cascade | Per v4-Pro V-4a. Codacy is likely to flag a multi-key conditional as cyclomatic complexity. A Set-driven check (`MEANINGFUL_FALSY_KEYS.has(k) || (v !== "" && v !== null && v !== undefined)`) is short, declarative, and easy to extend if future fields need preserving. | Adds one module-level `const`; trivial. |

> CODEX: D-2 is architecturally fine if the renderer truly reads `merged.kmRef` and `merged.mintage` first, while preserving `merged.kmReferences`/`merged.mintageByYear` for cache-only fallback. I would not branch everywhere by raw source shape; that scatters precedence rules. The call site still needs one explicit branch per display row, though: flat item `mintage` should win over array mintage, and flat item `kmRef` should win over array references.
> → **RESOLVED:** D-2 updated to mandate flat-first precedence at the call site. Helper preserves both siblings; renderer's Mintage row checks `merged.mintage` first, falls back to `merged.mintageByYear`. Same for KM Reference / References row.

> CODEX: I disagree with D-6 as a user-facing default. `item.numistaData` can be partial, cloned, imported, or restored; suppressing TTL refresh when it has any key can leave the cache stale for all non-overridden fields. A safer split is: always render from item-over-cache immediately, but allow stale cache refresh in the background and only update the cache, never the rendered item-priority values for the already-open modal. That avoids UI churn while keeping fallback data fresh for the next open.
> → **RESOLVED:** D-6 reworked exactly as suggested. Foreground render is item-over-cache, immediate. Cache TTL refresh continues to run; the refresh callback updates IndexedDB only and does not re-render the open modal. Next View open reads the fresh cache.

## File Map

### New
- `tests/playwright/view-modal-numista-merge.spec.js` — Playwright spec covering AC-1, AC-2, AC-3, AC-4, AC-6, AC-7. Validates item-priority merge, visible obverse/reverse rows, per-item divergence on shared catalogId, post-edit freshness, kmRef shape reconciliation, legacy cache-only fallback. Uses StakTrakr's existing fixture pattern (`tests/fixtures/`).

### Modified
- `js/viewModal.js` — refactor `loadViewNumistaData()`:
  - Add private `mergeNumistaSources(itemData, cacheMeta)` helper with **defensive empty-value stripping** (D-1) and shape-sibling preservation (D-2).
  - Replace `meta.*` reads with `merged.*` reads.
  - Add explicit flat-first precedence at the Mintage and KM Reference call sites (D-2).
  - Add visible obverse/reverse full-width rows (mirroring edge pattern).
  - Drive `view-shape-rect` class from `merged.shape`.
  - Cache TTL refresh remains as today, but the refresh callback updates IndexedDB only — it does NOT re-render the open modal (D-6).

> CODEX: If D-6 stays, this file-map bullet should at least specify "skip blocking/API refresh for the current render" rather than "skip cache refresh" broadly. Otherwise implementers may delete the only passive freshness path for cache-backed fields on partially customized items.
> → **RESOLVED:** D-6 reworked. Cache refresh path stays intact; bullet language updated above to clarify the refresh callback is non-rendering.
- `js/constants.js` — add `obverse: true` and `reverse: true` to `NUMISTA_VIEW_FIELD_DEFAULTS` (`constants.js:1326-1344`).
- `js/catalog-manager.js` — add two `data-nf="obverse"` and `data-nf="reverse"` toggle rows in the Numista field-visibility settings list (matching surrounding markup at `catalog-manager.js:382-470`).

### Deleted
- _none_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. The existing `numistaViewFields` localStorage entry merges new keys via `{ ...DEFAULTS, ...saved }` (`constants.js:1355`); old user configs continue to work without rewrite.

## Tradeoffs Surfaced for Review

- **D-2 (call-site precedence):** the helper preserves both flat and array shape siblings; the renderer's Mintage row branches `if (merged.mintage) flat; else if (merged.mintageByYear?.length) array;`. Same for KM Reference / References row. Two precedence branches at call sites — explicit and reviewable.

> CODEX: Preserving siblings is good, but "existing mintage-by-year render path keeps working" conflicts with "item mintage wins" unless the renderer is changed. With both fields present, the current render code will choose `mintageByYear` and never display `merged.mintage`. This needs a documented precedence rule in the helper contract or a call-site branch for the Mintage row.
> → **RESOLVED:** call-site branch added. Tradeoff text updated above.
- **D-7 (no shared utility):** by not extracting `mergeNumistaSources` to a shared module, we ship faster but accept a small duplication if a third caller appears. Acceptable for now; promote to `js/numista-utils.js` later if needed.
- **D-3 (additive descriptions):** if the user later decides full-width visible rows make tooltips redundant, removing tooltips is one config flip. Building it additive now preserves the option without committing to either direction.

## Out of Scope (follow-up issues)

- **STRK-52** — "Numista re-sync: tags already on item are locked checked, can't be removed." Already filed; separate bug in the import flow. Not touched here.
- **Cache invalidation on item edit** — saving an item via Edit modal does not touch IndexedDB cache. With the merge fix, this becomes invisible to users (item wins on read). If we ever want to back-propagate item edits to cache (e.g. to seed other items sharing the same `catalogId`), file as a follow-up.
- **Promote `mergeNumistaSources` to a shared `js/numista-utils.js`** — file if a third caller appears (e.g. a future bulk-edit Numista preview).
- **Per-year mintage in View modal** — currently truncated to 5 entries with " ..." ellipsis. Out of scope; cosmetic.

## V4-PRO Shipping-Risk Review (2026-05-08)

> **Lens:** pragmatic shipping risk and reviewer ergonomics. Does not re-litigate architecture. Read alongside requirements.md, discovery.md, tasks.md (separate V4-PRO blocks in each).

### 1. Diff size & reviewability

Estimated diff across 4 files: **400–600 lines**.

| File | Est. Δ | Notes |
|------|--------|-------|
| `js/viewModal.js` | +70 net (add helper ~40 L, replace `meta.`→`merged.` ~25 L, obv/rev rows ~15 L, flat-first branches ~10 L, delete tags-row ~8 L, image-frame 1 token) | Core of the change. The helper mirrors the proven `populateNumistaDataFields` Layer-1/Layer-2 pattern in `inventory.js:1222‑1254` exactly, so a reviewer familiar with that function can follow it without running locally. The defensive-stripping conditional (which keys allow `false`/`0`) is the single most review-intensive block — consider an inline table comment listing the two exemptions. |
| `js/constants.js` | +2 | Two `true` entries — trivial. |
| `js/catalog-manager.js` | +2 | Two array entries — trivial. |
| `tests/playwright/view-modal-numista-merge.spec.js` | ~350–500 (new) | 10 test cases with fixture setup. The real review burden lives here — IndexedDB seeding, localStorage interleaving, toggle-off path are likely to produce the most review comments. |

**Reviewability verdict:** the viewModal.js change is self-contained and mirrors an existing pattern. Reviewers DO NOT need to run locally if they trust that `populateNumistaDataFields` works (it does — in production since STRK-51). The test spec is where confusion concentrates.

> V4-PRO: The call-site flat-first precedence branches (Mintage row + References row) are the only net-new logic pattern that has no precedent in the codebase. Consider extracting them as two tiny inline helpers (`_renderMintageRow(merged, cfg, grid)` / `_renderReferencesRow(merged, cfg, grid)`) so reviewers get a clean "this function reads merged and renders" contract instead of having to trace branches inside the existing render block.

### 2. Rollback story

**Clean.** The change is fully additive and isolated to the View render read path:

- `loadViewNumistaData()` is the single function touched. A revert drop-in restores every line to its pre-STRK-55 state.
- No schema changes, no migration, no cache-write changes.
- The two new `NUMISTA_VIEW_FIELD_DEFAULTS` keys (`obverse`, `reverse`) would survive a code revert in existing localStorage if a user toggled them, but the old code never reads those keys — they're inert. No cleanup needed.
- The only non-revertable artifact: if STRK-55 ships and users start seeing their per-item edits in View, reverting would regress that experience. That's a UX rollback cost, not a data-loss risk.

**Rollback verdict:** a single revert PR cleanly undoes everything. No cross-cutting localStorage default-staleness issue.

> V4-PRO: The one hedging scenario worth noting: if a user edits their Settings between STRK-55 deploy and a revert, the localStorage `numistaViewFields` object would contain `{ obverse: false, reverse: true, ... }`. After revert, `getNumistaViewFieldConfig` would still spread those keys into the returned config (they're harmless). But if a FUTURE feature adds code that reads `cfg.obverse` or `cfg.reverse` in the old renderer, that stale localStorage could cause unexpected toggles. Document this in the inline comment at `NUMISTA_VIEW_FIELD_DEFAULTS` so future readers know these keys are "present but inert post-revert."

### 3. CHANGELOG / release notes framing

The proposed PR title: `fix(STRK-55): View modal merges item.numistaData over cache + visible obverse/reverse + tags dedupe`

**Problem:** `item.numistaData` and "cache" are internal implementation terms. A user reading the in-app What's New (e.g., `js/about.js:142`) sees: `<strong>v3.34.xx &ndash; STRK-55: View modal merges item.numistaData over cache …</strong>: …` — this is meaningless to a non-technical stacker.

**Suggested user-facing title:** `STRK-55: View modal now shows your saved edits, not just Numista's database`

**Suggested What's New entry:**
```
<li><strong>v3.34.xx &ndash; STRK-55: View modal respects per-item edits</strong>: The item detail (View) modal now shows YOUR saved Numista customizations — composition, rarity, descriptions, mintage, KM reference — instead of the shared Numista catalog snapshot. Two items with the same Numista ID can now display different values. Obverse and reverse descriptions are now visible as full-width text rows (in addition to image tooltips). Duplicate tags in Catalog Data have been removed (they already appear in the Tags chip section below).</li>
```

This maps to the existing What's New format at `js/about.js:142‑149` and matches the tone of STRK-51 (line 142: "User-edited fields appear unchecked … so re-syncs never silently overwrite custom values").

> V4-PRO: The PR title `fix(...)` scoping prefix is correct for team consumption, but the What's New entry should NOT use the PR title verbatim. CLOSE-6 should ship with a PR body that includes the user-facing What's New text so `/release patch` can consume it directly. The implementer should supply this text to whichever agent runs CLOSE-4.

### 4. CI / lint footprint

**Pre-commit hooks that WILL fire:**

| Hook | Trigger | Effect |
|------|---------|--------|
| `stamp-sw-cache` | ANY `js/` file change | Auto-stamps `sw.js` CACHE_NAME. `sw.js` will appear in the commit even if not manually staged. |
| `check-release-sync` | Change to `js/constants.js` (any line) | Fires because we edit `constants.js`. **Will pass** if APP_VERSION is unchanged (Sprint A). **Will fail** and require version bump if Sprint A and CLOSE-4 are committed together without `/release`. |
| `gitleaks` | Always | Should pass — no secrets in these files. |
| `check-signing-key` | Always | User-managed — no action needed. |
| `lint-staged` | Always | Will format staged JS files with prettier — benign but may produce whitespace-only diffs in the commit. |

**Codacy / Copilot false-positive risks:**

- **`mergeNumistaSources` complexity:** the defensive-stripping conditional with key-specific exemptions (`commemorative`, `rarityIndex`) may trigger a "cyclomatic complexity" or "cognitive complexity" warning. **Mitigation:** keep the helper flat — use a `MEANINGFUL_FALSY_KEYS` Set for the exemption check.
- **`cfg.obverse !== false` guard:** could trigger a "use strict equality" or "negated condition" Codacy rule. **Mitigation:** match the existing pattern — every other field uses `cfg.X !== false` (per `viewModal.js:1095‑1134`), so this is stylistically consistent. Codacy's pattern should not flag new instances of an existing convention.
- **Pre-existing `no-undef` noise:** StakTrakr uses script-tag globals — Codacy CLI whole-repo scans will surface hundreds of pre-existing `no-undef` findings. **Per `CLAUDE.md` Known Reviewer False Positives section: verify findings on changed lines only.**
- **Gemini duplicates:** Gemini reviewer may produce duplicate threads with `"line": null` — auto-resolve per known false-positive pattern.

> V4-PRO: The `stamp-sw-cache` hook is the practical pain point. Sprint A implementers who commit JS files will get `sw.js` auto-stamped into their commit. An implementer who only commits A.1 (constants) will see `sw.js` appear unexpectedly. Document this in a Cohort A sidebar note so multi-model dispatch agents don't each fight over `sw.js` during parallel commits — let the last merges/rebases settle it.

### 5. `/release patch` interaction (CLOSE-4)

**No conflict.** The `/release patch` skill touches these 6 files:

| File | STRK-55 sprint A touches? | Conflict? |
|------|--------------------------|-----------|
| `js/constants.js` | YES (NUMISTA_VIEW_FIELD_DEFAULTS, ~line 1326) | **Same file, different lines.** `/release` edits APP_VERSION (~line 3) and one constant. Git merge will handle trivially. |
| `package.json` | No | No conflict. |
| `package-lock.json` | No | No conflict. |
| `version.json` | No | No conflict. |
| `js/about.js` | No | No conflict — UNLESS the implementer pre-writes the What's New entry in Sprint A (should not — let `/release` prepend it). |
| `CHANGELOG.md` | No | No conflict. |
| `sw.js` | Auto-stamped by hook | Hook restamps after version bump — expected. |

**Key gotcha:** if Sprint A implementers hand-edit `js/about.js` to add a What's New entry, and then `/release patch` tries to prepend another entry, the result is duplicated or out-of-order. Let `/release` handle the What's New prepend. Sprint A should provide the user-facing summary text in a comment on the PR or in CLOSE-4's task note, but NOT touch `js/about.js` directly.

> V4-PRO: CLOSE-4 should run AFTER Sprint A is committed and passed all hooks. If an implementer runs `/release patch` inside the same worktree BEFORE Sprint A is committed, the version bump will conflict with uncommitted changes to `js/constants.js`. Standard ordering works: Sprint A commit → CLOSE-4 `/release patch` commit → push → PR.

### 6. Implementation effort estimate

**The sketch claims 30–90 minutes. That is realistic for the JS changes (A.1 + A.2 + A.3) but NOT for the full task list including B.1 and CLOSE-1..CLOSE-8.**

| Phase | Realistic estimate | Notes |
|-------|-------------------|-------|
| A.1 (constants) | 5 min | 2 lines. |
| A.2 (catalog-manager) | 5 min | 2 array entries. |
| A.3 (viewModal refactor) | 45–75 min | Helper + merge + branches + rows + dedupe + image-frame. |
| B.1 (Playwright spec) | **2–4 hours** | 10 test cases, each requires: seed inventory item with specific `numistaData` shape, seed IndexedDB cache, open View modal, assert rendered content. Test cases 8 (partial metadata + TTL) and 9 (defensive stripping) require IndexedDB manipulation before/after — no existing fixture does this. Test case 10 (toggle-off) crosses Settings UI → View modal, adding page-navigation complexity. |
| CLOSE-1..CLOSE-8 | 1–2 hours | Includes `/release patch`, lint, test suite run, PR creation, PR review resolution. |

**Total realistic effort: 4–8 hours**, not 30–90 minutes. The time window was likely scoped for the JS-only sprint (A.1–A.3), which is 55–85 minutes — within range.

**Slippage sources (ranked by risk):**
1. **B.1 test 8 (partial metadata + TTL refresh):** verifying that background cache refresh occurs without re-rendering requires either a spy on `imageCache.cacheMetadata` or querying IndexedDB `cachedAt` before/after waiting TTL duration. StakTrakr's `VIEW_METADATA_TTL` is a module constant — if it's > 5 seconds, the test must set a shorter TTL or mock it. This is the riskiest single test case.
2. **B.1 test 10 (toggle-off):** Settings UI interaction + View modal render assertion requires the `data-nf` toggles to be present (A.2) AND the `getNumistaViewFieldConfig` defaults to include the keys (A.1). The Cohort A Integration Assumption addresses this, but if A.1 or A.2 code is wrong, this test catches it late — AFTER all three A tasks are merged.
3. **A.3 helper defensive stripping:** the per-key exemptions for `commemorative` (boolean) and `rarityIndex` (0) are subtle. If implemented wrong, tests 1, 8, and 9 will fail — but debugging WHICH key-exemption logic failed can eat time.
4. **stamp-sw-cache auto-commit noise:** multi-model dispatch agents committing A.1/A.2/A.3 in parallel will each have `sw.js` auto-added by the hook. Reconverging commits into one coherent PR history requires rebase/squash discipline.

> V4-PRO: Strongly recommend splitting B.1 into two sub-tasks: B.1a (tests 1–7: core merge behavior, ~90 min) and B.1b (tests 8–10: TTL refresh, defensive stripping, toggle-off — the high-risk tests, ~90+ min). If B.1b blocks, the PR can ship with B.1a to get the core fix out while the edge-case tests bake.

---

## Risk Notes

- **Risk:** Helper-side defensive stripping is the same limitation as the modal save path — a user cannot intentionally blank out a cache-backed value via the View merge path (because empty item values are stripped before merge). **Accepted behavior:** a user clearing a field in the Edit modal causes the field to drop out of `item.numistaData` (modal save strips), and the View modal then shows the cache value. This is parity with Edit modal display today; the user's experience is "I cleared the field, now I see the original Numista value." If we ever want intentional-clear semantics (sentinel values that explicitly hide cache), this requires changes to BOTH the save path AND this helper — they must move in lockstep. Inline comment at the helper documents this dependency.

> CODEX: The failure mode listed here is backwards for the proposed spread order. With today's strip behavior, cleared fields are absent and cache values resurface. If the invariant changes to preserve explicit blanks, `{ ...cache, ...item }` would instead hide cache values with blank item values. Both behaviors may be defensible, but the risk note should name the exact behavior being accepted.
> → **RESOLVED:** risk note rewritten above to name the exact accepted behavior (Edit-clear shows cache value) and the future-coupling requirement (intentional-clear semantics need lockstep changes to save + helper).
- **Risk:** Settings toggle additions in `catalog-manager.js` could break existing toggle-list rendering if the markup pattern is structurally different than I expect. **Mitigation:** read the surrounding code in detail during implementation and copy the exact `data-nf` row pattern; do not invent new structure.
- **Risk:** A user with a stale localStorage `numistaViewFields` from a prior session will get `obverse: undefined` / `reverse: undefined` from saved-only reads. **Mitigation:** `getNumistaViewFieldConfig` already does `{ ...NUMISTA_VIEW_FIELD_DEFAULTS, ...saved }`, so the new defaults apply transparently. Verify no other reader reads raw localStorage directly.
- **Risk:** STRK-51 is freshly merged (v3.34.49) and may have downstream behaviors I haven't accounted for. **Mitigation:** discovery already mapped the save path (`events.js:1304-1366`); spot-check `fieldMeta` (which `events.js:1472, 1616` reference) is unaffected by this change — we don't read it in viewModal.

> V4-PRO: **Missing edge-case: cache-empty + item-has-numistaData.** The current early-return guard (`if (!meta) return;` at line 1074) bails out when both cache and API are unavailable. With the merge helper, if `cacheMeta` is null but the item has `numistaData`, we should still render from item data alone (`{ ...(meta || {}), ...strippedItem }`). This requires softening the early-return guard. A user who clears their browser cache but has per-item edits would otherwise see a blank Catalog Data section — a regression. The helper's spread of `null` as base produces `{}`, which is safe, but the guard must change from `if (!meta) return;` to something like `if (!meta && !hasMeaningfulItemData) return;`. Verify this with a test case: item has `numistaData.composition` but cache is empty.

> V4-PRO: **`commemorative` boolean edge-case in renderer.** Currently the commemorative row renders only when BOTH `meta.commemorative` AND `meta.commemorativeDesc` are truthy (line 1169). If a user's `item.numistaData` has `{ commemorative: true, commemorativeDesc: "" }`, the helper preserves `false` as meaningful for commemorative — but the render gate still needs `commemorativeDesc` to be truthy. This is fine for the merge path (cache provides the description), but if the item is the SOLE data source (cache empty), the commemorative row won't render even though the user marked it. Not a blocker — this is parity with Edit modal behavior — but worth noting so the test spec doesn't assert commemorative visibility from item data alone without a description string.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-55`.
