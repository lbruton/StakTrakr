---
sketch: "STRK-83-disposition-predicate-alignment"
phase: requirements
created: 2026-06-05
---

# STRK-83 — Requirements

> **Source Issue:** [STRK-83](https://plane.lbruton.cc/lbruton/browse/STRK-83/)
> **Title:** Align `isDisposed()` and direct disposition checks for empty-object payloads
>
> STRK-73 introduced a tighter empty-object guard in `_buildDispositionSection()` (`js/viewModal.js`):
> `if (!item.disposition || Object.keys(item.disposition).length === 0) return null;`
>
> However, `isDisposed()` in `js/constants.js` still uses the simpler truthy check: `return !!item.disposition;`
>
> This means an Item with `disposition: {}` is treated differently by different parts of the codebase:
>
> - **Section renderer:** does not render the Disposition section (correct)
> - **`isDisposed()` / `filters.js`:** considers the Item disposed (inconsistent)
>
> **Scope (from issue):** Audit all call sites of `isDisposed()` and direct `item.disposition` truthiness checks across `js/constants.js`, `js/filters.js`, `js/inventory.js`, and any other files that branch on `item.disposition`. Decide whether to (1) tighten `isDisposed()` itself to reject empty objects, OR (2) add a separate `hasValidDisposition(item)` predicate and migrate call sites. Whichever approach is chosen, update `architecture.md` in DocVault to remove the predicate-inconsistency warning added in STRK-73.
>
> **Context (from issue):** Deliberately deferred from STRK-73 (approach D-4) due to 19+ call sites for `isDisposed()`. The local guard in `_buildDispositionSection()` is a minimal fix for AC-6; this issue tracks the global cleanup.

> **Triage seed (verified 2026-06-05, this sketch):** Issue is NOT stale — all claims hold. `isDisposed()` is still `return !!item?.disposition;` (`js/constants.js:518`); `_buildDispositionSection()` guard is now 4-part (`js/viewModal.js:862-868`); the architecture.md warning still exists (`Foundation/architecture.md:361-363`); `hasValidDisposition()` was never added. **23 call sites** total (17 `isDisposed()` callers + 6 direct truthiness checks). Severity is **latent**: `disposition: {}` is not produced by any write path (dispose/undo/CSV/sync/split) — only reachable via data corruption — and the symptom is cosmetic + a filter discrepancy, **not a crash** (`({}).type` is `undefined`). **Lockstep constraint:** the disposed filter is asymmetric — _hide_ mode uses a direct `!item.disposition` check (`js/filters.js:968`) while _show-only_ uses `isDisposed()` (`js/filters.js:972`); tightening `isDisposed()` alone would make an empty-disposition Item vanish from BOTH views, so the direct checks must migrate in lockstep.
>
> **Decisions confirmed by user (2026-06-05):** Tier = **/sketch**. Scope = **full consistency** — consolidate on `isDisposed()` as the single predicate and migrate all direct disposition-truthiness checks to it (NOT the separate `hasValidDisposition()` helper from issue option 2).

## Overview

Align every disposition check in the app so that an **Item** whose **Disposition** is empty or malformed (`{}`, `null`, `undefined`, a non-object, or an array) is treated **consistently as not disposed** — no "disposed" badge or row styling, no disposition detail section, present in the active view, absent from the disposed view, and uncounted in disposed summary totals. The durable fix makes `isDisposed()` the **single source of truth**: the disposed/active filter, the inventory summary, row/card rendering, the disposition section renderer, the trade-link guards, and the trade autocomplete all route their "is this Item disposed?" decision through `isDisposed()` instead of duplicating raw `item.disposition` truthiness. This matches the domain definition — a Disposition tracks realized value and date, so an empty object is not a Disposition — and removes the split-brain documented as tech-debt in `architecture.md` since STRK-73.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a stacker viewing my inventory, I want an Item with no real Disposition record to appear consistently as an active Item (no disposed badge, no disposition section, present in the active view), so that a corrupted or empty disposition never produces a half-disposed "ghost" Item.
- **US-2:** As a developer maintaining StakTrakr, I want one canonical `isDisposed()` predicate that every disposition check routes through, so that the renderer, filters, summary totals, and trade-link guards can never again disagree about whether an Item is disposed.
- **US-3:** As a user toggling the disposed filter, I want an empty-disposition Item to always appear in exactly one of the active/disposed views (never neither), so that no Item silently vanishes from all views.

## Acceptance Criteria

> EARS syntax. Each line is individually testable and becomes a TDD Cohort B assertion downstream.

### AC-1 — canonical predicate (maps to US-2)

- The `isDisposed(item)` predicate **SHALL** return `true` only when `item.disposition` is a non-null, non-array `object` with at least one own enumerable key, and **SHALL** return `false` for `undefined`, `null`, a non-object, an array, or an empty object `{}`.

### AC-2 — consistent treatment across surfaces (maps to US-1)

- **IF** an Item's `disposition` is an empty object (`{}`), **THEN** the system **SHALL** treat the Item as not disposed in every disposition-dependent surface: the disposed/active filter, the inventory summary totals (disposed count / realized value), row and card "disposed" styling, the "disposed" inline badge, and the view-modal disposition detail section.

### AC-3 — no vanishing Items / filter symmetry (maps to US-3)

- **WHEN** the disposed filter is in "hide" (active) mode, the system **SHALL** include an Item whose `disposition` is an empty object.
- **WHEN** the disposed filter is in "show-only" mode, the system **SHALL** exclude that same Item.

### AC-4 — renderer consumes the canonical predicate (maps to US-1, US-2)

- **WHILE** an Item is not disposed per `isDisposed()`, the view modal **SHALL** render zero disposition sections for that Item (the section-renderer guard derives from `isDisposed()` rather than duplicating its own empty-object check).

### AC-5 — single source of truth (maps to US-2)

- The system **SHALL** route all disposition disposed/active decisions through `isDisposed()` — specifically the disposed-filter predicates (`js/filters.js`), the trade-link guards (`js/inventory.js`), the trade-autocomplete exclusion (`js/viewModal.js`), and the section-renderer guard (`js/viewModal.js`) — and **SHALL NOT** retain direct `item.disposition` truthiness branches for those decisions, **WHERE** the defensive `source.disposition || {}` provenance fallbacks are exempt (they are no-data fallbacks, not disposed/active decisions).

### AC-6 — documentation alignment

- The system documentation **SHALL** remove the STRK-73 predicate-inconsistency warning from `DocVault/Projects/StakTrakr/Foundation/architecture.md` (replacing it with a note that `isDisposed()` is the single source of truth for disposition validity).

## Non-Goals

_Explicit list of things this sketch does NOT do._

- **No separate `hasValidDisposition()` helper** — per the confirmed full-consistency scope, the fix consolidates on `isDisposed()` rather than introducing a second named predicate (issue option 2 is explicitly not taken).
- **No stored-data migration / normalization** — the fix makes predicates robust to `{}`; it does NOT rewrite existing localStorage/`.stvault` records to delete empty dispositions. `{}` is corruption-only and produced by no code path, so a migration is unwarranted.
- **No change to the `source.disposition || {}` provenance fallbacks** (`js/viewModal.js:769,795`) — these are defensive no-data fallbacks, not disposed/active decisions.
- **No change to disposition write paths** — `disposeItem`/`confirmRemoveItem`, partial-stack split, CSV import, and undo/restore already produce fully-shaped objects or clear to `null`; they are out of scope.
- **No new disposition features** and **no change to realized gain/loss math.**

## Open Questions

_None — resolved by the triage seed and the user's confirmed tier/scope decisions._

---

> **Phase complete?** Acceptance criteria are concrete and verifiable; open questions empty. Next: `/sketch-review STRK-83 requirements [AGENT]` (optional peer review) → `/sketch-reconcile STRK-83 requirements` → `/sketch-discovery STRK-83`.
