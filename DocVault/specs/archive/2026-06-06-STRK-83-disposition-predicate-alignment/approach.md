---
sketch: "STRK-83-disposition-predicate-alignment"
phase: approach
created: 2026-06-05
---

# STRK-83 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The fix collapses two divergent disposition predicates into **one source of truth**. Today `isDisposed()` (`js/constants.js:518`) answers "is this Item disposed?" with a loose truthy check, while `_buildDispositionSection()` (`js/viewModal.js:862-868`) answers the same question with a tight 4-part guard that rejects empty/malformed objects. The architecture change is: tighten `isDisposed()` to the strict semantics, then make every disposition disposed/active decision — including the renderer's own guard — **call `isDisposed()`** instead of re-deriving the answer. After the change there is exactly one place that decides what "disposed" means; the renderer, the disposed filter, the inventory summary, row/card styling, the trade-link guards, and the trade autocomplete all inherit it.

Because 17 of the 23 sites already route through `isDisposed()`, the bulk of the behavioral correction happens by editing one function. The remaining work is migrating the **6 direct `item.disposition` truthiness checks**: 5 are genuine disposed/active decisions that move to `isDisposed()` (the lockstep-critical `filters.js:968` hide-mode predicate, three trade-link guards in `inventory.js`, and the trade autocomplete in `viewModal.js:1139`), and 2 are defensive `source.disposition || {}` provenance fallbacks that are left untouched. No new modules, no data model change, no schema — this is a localized predicate consolidation across four runtime files plus tests and one doc.

The only ordering subtlety is the new renderer→predicate dependency: `_buildDispositionSection()` will call the global `isDisposed`. This is safe because `constants.js` loads before `viewModal.js` and the call happens at runtime (inside the function), not at parse time — so the `safeGetElement`-style top-level-ReferenceError trap does not apply.

## Key Decisions

| #       | Decision                                                                                                                                                         | Rationale                                                                                                                                                                   | Tradeoff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-1** | Consolidate on `isDisposed()` as the single predicate; do **not** add `hasValidDisposition()`.                                                                   | 17/23 sites already chokepoint through `isDisposed()`, so one edit fixes them with zero call-site churn, and a single predicate cannot drift again. (User-confirmed scope.) | `isDisposed()`'s contract subtly shifts from "has a truthy disposition" to "has a _valid_ disposition". Any future caller must know the stricter meaning — mitigated: no real data changes behavior, and the name still reads true.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **D-2** | `_buildDispositionSection()` **consumes** `isDisposed()` (`if (!isDisposed(item)) return null;`) instead of keeping its own 4-part guard.                        | Removes the duplicated rule that is the literal root cause of the STRK-73 drift.                                                                                            | Adds a runtime dependency from the renderer onto the `constants.js` global — acceptable; load order verified, `isDisposed` is already a global used app-wide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **D-3** | Strict semantics = "non-null, non-array `object` with ≥1 own enumerable key" (mirror the existing tight guard). Do **not** require a specific field like `type`. | Exactly matches the existing guard + existing tests; "≥1 key" is the minimal definition of "a disposition record exists" and stays within the issue's _empty-object_ scope. | A garbage object with one junk key (e.g. `{foo:1}`) still counts as disposed. Accepted — even rarer than `{}`, and requiring `type`/`date` could wrongly reject partially-populated real records (e.g. a "lost" disposition with no recipient). Flagged as a follow-up.                                                                                                                                                                                                                                                                                                                                                                                                 |
| **D-4** | Migrate the direct disposed/active checks to `isDisposed()`; **exempt** the 2 `source.disposition \|\| {}` provenance fallbacks.                                 | Full-consistency scope + lockstep safety (`filters.js:968` must move with `:972`); the fallbacks are no-data defaults, not disposed/active decisions.                       | Wider diff into `inventory.js` trade-link guards + `viewModal.js` autocomplete; requires the trade-linking Playwright suite to stay green. **Refined post-review (Codacy MEDIUM, PR #1214):** the 3 `inventory.js` trade-link guards (876/912/982) were reverted to `!disposedItem?.disposition` — they are **data-mutation/cleanup** guards (precondition: "is there a disposition object to operate on?"), not display predicates, and must run on a malformed `{}` to clear orphaned back-refs. So `isDisposed()` governs **display/filter/selection** (`filters.js:968`, `viewModal.js` renderer + autocomplete, 17 callers); mutation guards keep object-presence. |
| **D-5** | No stored-data normalization — make predicates robust to `{}`, don't rewrite records.                                                                            | `{}` is corruption-only and produced by no write path; a migration is risk with no real upside.                                                                             | A persisted `{}` disposition stays in storage (now rendered/behaving correctly as not-disposed); the corrupt field itself isn't scrubbed. Invisible to the user.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## File Map

_The contract `tasks.md` cross-checks against. All paths relative to repo root._

### New

- `tests/unit/disposition-predicate.test.js` — Node unit assertions for `isDisposed()` across `{}`, `null`, `undefined`, non-object, array, and populated object (AC-1). _Tasks phase: if an existing `tests/unit/*` file already owns `constants.js` helper coverage, extend that instead of creating this file._

### Modified

- `js/constants.js` — tighten `isDisposed()` to the D-3 strict semantics (AC-1). _Update the JSDoc above it to describe the empty/array/non-object rejection._
- `js/viewModal.js` — (a) `_buildDispositionSection()` guard → `if (!isDisposed(item)) return null;` (AC-4); (b) trade autocomplete `!inv.disposition` → `!isDisposed(inv)` at line ~1139 (AC-5). Leave `source.disposition || {}` at ~769/795 unchanged.
- `js/filters.js` — hide-mode predicate `!item.disposition` → `!isDisposed(item)` at line ~968 (AC-3, AC-5). (`:972` already uses `isDisposed`.)
- `js/inventory.js` — trade-link guards at ~876/912/982 `!disposedItem?.disposition` → `!isDisposed(disposedItem)` (AC-5).
- `tests/playwright/core/disposition.spec.js` — add empty-disposition assertions reusing `EMPTY_DISPOSITION_ITEM`: filter symmetry (hide includes / show-only excludes — AC-3) and cross-surface not-disposed (no badge, no disposed styling, not in disposed totals — AC-2). Keep the existing zero-section test green (AC-4).
- `DocVault/Projects/StakTrakr/Foundation/architecture.md` — remove the predicate-inconsistency warning at ~361-363; replace with a one-liner that `isDisposed()` is the single source of truth for disposition validity (AC-6). _Via `/vault-update` at closeout._
- Version-bearing files — handled by `/release patch` at closeout (not hand-enumerated here; the release skill owns the file set).

### Deleted

- None.

## Data / Schema Changes

None — no schema, migration, or persisted-data changes (see D-5).

## Tradeoffs Surfaced for Review

- **D-3 boundary:** we fix the _empty-object_ case only, not "missing required fields." A `{type:undefined}`-style partial would still read as disposed. If reviewers want the stricter "must have `type`" semantics, that's a deliberate behavioral expansion beyond STRK-83 — flag it now or accept the empty-object boundary.
- **D-4 blast radius:** migrating the trade-link guards touches `inventory.js` trade logic. Behavior is identical for all real dispositions; the only changed outcome is for corruption-only `{}`. Reviewers who prefer a minimal diff could argue for migrating _only_ `filters.js:968` (the lockstep-critical one) and leaving the trade guards — but that re-opens the "23 sites disagree" gap the issue exists to close. We chose full consistency per user scope.

## UI Contract

**N/A — no UI surface.** No new or changed visual components, layouts, mockups, playgrounds, or design tokens. The change's user-visible side effects for empty-disposition Items — absence of the "disposed" badge, absence of disposed row/card styling, absence of the disposition detail section, and correct active/disposed filter placement — are existing UI behaviors verified **behaviorally** via Playwright assertions in the tasks' test cohort, not against a visual-fidelity mockup. (Therefore CLOSE-3 visual-verification-against-mockup does not apply; per-AC test citations suffice.)

## Out of Scope (follow-up issues)

- **Stricter disposition validity** (require `type`/`date`, not just ≥1 key) — file under StakTrakr only if partially-populated real records are confirmed invalid. (D-3.)
- **One-time `{}`-disposition data scrub** on load — file only if empty dispositions are observed in real user data. (D-5.)

## Risk Notes

- **Risk:** migrating trade-link guards subtly changes trade-linking → **mitigation:** the trade-linking Playwright suite (`disposition.spec.js:661-827`) must stay green; guards only change for `{}`/malformed, which cannot carry `tradedForUuids`.
- **Risk:** an `isDisposed()` caller outside the enumerated 23 relies on loose semantics → **mitigation:** discovery enumerated callers via claude-context + CGC + grep; `npm test` + the new unit test catch regressions.
- **Risk:** renderer consumes `isDisposed` before it's defined → **mitigation:** load order verified (constants.js before viewModal.js; runtime-only call). Already covered in discovery Constraints.

---

> **Phase complete?** Architecture clear, 5 decisions logged with rationale + tradeoff, file map complete, UI Contract resolved (N/A). Next: `/sketch-review STRK-83 approach [AGENT]` (optional) → `/sketch-reconcile STRK-83 approach` → `/sketch-tasks STRK-83`.
