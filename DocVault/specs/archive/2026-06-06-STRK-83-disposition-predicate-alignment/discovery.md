---
sketch: "STRK-83-disposition-predicate-alignment"
phase: discovery
created: 2026-06-05
---

# STRK-83 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

> **Research method:** narrow surface area — the structural + semantic sweep was already run during this sketch's triage (3 Explore agents over claude-context + CGC + Grep verification), so no separate Workflow fan-out was needed. Findings below are verified against live code on 2026-06-05. Prior-decisions angle run via mem0.

## Existing Code

_All 23 disposition-check sites + the two predicates, the filter, tests, and the doc. Verified `file:line` 2026-06-05._

### The two predicates (the inconsistency)

| Path                      | Role                                                                                                                      | Notes                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `js/constants.js:518`     | `isDisposed(item)` — `return !!item?.disposition;`                                                                        | **Loose** truthy check; the chokepoint 17 callers share. Exposed as global `window.isDisposed` (`js/constants.js:2038`). |
| `js/viewModal.js:862-868` | `_buildDispositionSection()` guard — 4-part (`== null` / `!== "object"` / `Array.isArray` / `Object.keys().length === 0`) | **Tight**; rejects `{}`. The behavior the fix standardizes on.                                                           |

### `isDisposed()` callers (17) — all fixed at once by tightening the chokepoint

| Path                                      | Usage                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `js/card-view.js:669,672,692,696,713,719` | Card A/B/C: `disposed-card` class + name badge reading `item.disposition.type`                  |
| `js/inventory-table.js:605,616,638,813`   | Row `disposed-row` class, name+badge, action-button label, **`updateSummary()` disposed tally** |
| `js/events.js:4958`                       | Smart-search result badge                                                                       |
| `js/filters.js:972`                       | Disposed filter **show-only** mode predicate                                                    |
| `js/inventory.js:856`                     | `disposeItem()` guard — prevent re-disposing                                                    |
| `js/inventory.js:1171,1192,1196`          | `restoreInPlace()` / `undoDisposition()` guards                                                 |
| `js/viewModal.js:1668`                    | Restore button visibility                                                                       |

### Direct `item.disposition` truthiness checks (6) — the migration targets

| Path                      | Predicate                                                       | Decision?                            | Action                                                                  |
| ------------------------- | --------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `js/filters.js:968`       | `!item.disposition` (disposed filter **hide/active** mode)      | disposed/active                      | **Migrate → `!isDisposed(item)`** (lockstep-critical — see Constraints) |
| `js/inventory.js:876`     | `!disposedItem?.disposition` (`removeTradeLinkReference` guard) | disposed/active                      | Migrate → `!isDisposed(disposedItem)`                                   |
| `js/inventory.js:912`     | `!disposedItem?.disposition` (`linkTradeItems` guard, compound) | disposed/active                      | Migrate → `!isDisposed(disposedItem)`                                   |
| `js/inventory.js:982`     | `!disposedItem?.disposition` (`updateTradeLinks` guard)         | disposed/active                      | Migrate → `!isDisposed(disposedItem)`                                   |
| `js/viewModal.js:1139`    | `!inv.disposition` (trade autocomplete exclusion)               | disposed/active                      | Migrate → `!isDisposed(inv)`                                            |
| `js/viewModal.js:769,795` | `source.disposition \|\| {}` (trade provenance fallback)        | **no-data fallback, NOT a decision** | **EXEMPT — leave unchanged** (Non-Goal)                                 |

### The disposed filter (lockstep epicenter)

| Path                    | Role                                                               | Notes                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/filters.js:966-974` | `filterInventoryAdvanced()` three-state disposed filter (STAK-388) | `hide` (line 968, direct) / `show-only` (line 972, `isDisposed`) / `show-all` (no filter). The asymmetry is why a one-sided tighten makes `{}` Items vanish. |

### Tests (behavior already partly pinned)

| Path                                                                                                    | Role                                                                      | Notes                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `tests/playwright/core/disposition.spec.js:56`                                                          | `EMPTY_DISPOSITION_ITEM` fixture (`disposition: {}`)                      | Reusable for new assertions.                                     |
| `tests/playwright/core/disposition.spec.js:615-635`                                                     | "active and empty-disposition items do not render a Disposition section"  | Stays green — the fix aligns with it.                            |
| `tests/playwright/core/disposition.spec.js:661-827`                                                     | Trade-linking suite (8 sub-tests)                                         | Guards the trade-link call-site migrations.                      |
| `tests/playwright/archive/issue-ac-matrices/strk-117-disposition-section-config.spec.js:52-58, 272-283` | `EMPTY_DISPOSITION_ITEM` + AC-6 "empty disposition renders zero sections" | Archived AC matrix; stays green.                                 |
| `tests/unit/cloud-sync-convergence-audit.test.js:93-107`                                                | disposition key-order hashing                                             | Confirms disposition flows through sync as a unit; not affected. |

### Documentation

| Path                                                             | Role                                                        | Notes                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `DocVault/Projects/StakTrakr/Foundation/architecture.md:361-363` | "Predicate inconsistency (track STRK-73 follow-up)" warning | AC-6 of this sketch removes/replaces it. |

## Prior Decisions

_mem0 query: `"isDisposed disposition predicate empty object STRK-73 STRK-44 partial-stack disposed filter inconsistency"` (2026-06-05)._

- **2026-05-16 (STRK-73)** — "User tightened `_buildDispositionSection()` to reject empty-object dispositions, addressing AC-6" and "filed follow-up STRK-83 to align `isDisposed()` and `filters.js` empty-object predicate logic" (mem0 `6f1c5101`, `120c25fb`). **STRK-83 is the direct, intended follow-up to STRK-73** — provenance confirmed.
- **2026-05-07 (STRK-44)** — split-clone uses `structuredClone` + `disposition.splitFromUuid` to clone disposition objects (mem0 `03314648`). Relevant to the trade-link/split guards being migrated; the split clone always gets a fully-shaped disposition (verified at `js/inventory.js:1321-1335`).
- **2026-05-07 (retro warning) — STALE, flagged:** memories claim "CSV import never reconstructs disposition fields" (mem0 `1b1f5ae1`) and "pre-existing data loss across all disposition fields" (mem0 `c5125e8e`). **Live code (2026-06-05) differs:** `js/inventory-import.js:404-435` _does_ reconstruct a disposition object when `dispositionType` is truthy — but still only builds a full object or leaves the field `undefined`, never `{}`. The retro memories predate that import code; recorded here per "verify recalled memories against live code."
- **No prior decision** exists on whether to consolidate predicates vs add a helper — that decision is made in this sketch (consolidate on `isDisposed()`).

## External References

- _None._ Vanilla JS, no libraries involved; the change is a local predicate + call-site refactor.

## Constraints

- **Script-tag globals / load order.** `isDisposed` is a global (`window.isDisposed = isDisposed`, `js/constants.js:2038`). `constants.js` loads before `viewModal.js`, `filters.js`, `inventory.js`, `card-view.js`, `inventory-table.js`, `events.js`. All call sites invoke `isDisposed()` at **runtime** (inside functions), so the global is defined by the time they run — including `_buildDispositionSection()` consuming `isDisposed()`. No top-level/parse-time usage, so no `safeGetElement`-style ordering trap.
- **Lockstep (load-bearing).** `js/filters.js:968` (`hide` mode, direct `!item.disposition`) and `:972` (`show-only`, `isDisposed`) must adopt the same semantics together. Tightening `isDisposed()` while leaving line 968 direct makes an empty-disposition Item hidden in _both_ views (the vanishing-Item bug → AC-3 regression guard).
- **Behavior-preserving for real data.** Every real Disposition is a fully-shaped object (8-9 keys); migrating the trade-link guards and filter to `isDisposed()` changes outcomes _only_ for the corruption-only `{}`/malformed edge case.
- **Tests are the spec.** Existing empty-disposition → zero-section tests must stay green (the fix aligns with them, doesn't fight them). New tests added must be RED before the code change.
- **Platform.** Single HTML page, `file://` + HTTP, zero build, four themes — no tooling/dependency surface to consider.

## Open Questions

_None block `approach.md`._ The two potential blockers were resolved during research: (a) load order is safe for `_buildDispositionSection()` → `isDisposed()` (constants.js loads first; runtime calls only); (b) no `isDisposed()` caller depends on `{}` being truthy for real data (all real dispositions are populated). Scope (consolidate, not helper) and the lockstep requirement are settled.

## Discovery Summary

The work lands almost entirely in four runtime files — `js/constants.js` (tighten the one predicate), `js/viewModal.js` (renderer consumes `isDisposed()` + migrate the autocomplete check), `js/filters.js` (migrate the hide-mode check — the lockstep linchpin), and `js/inventory.js` (migrate three trade-link guards) — plus tests and one DocVault doc. The tricky part is not the code (it's small and behavior-preserving for real data) but **getting the call-site migration complete and simultaneous** so the disposed filter stays symmetric; the easy part is that existing `EMPTY_DISPOSITION_ITEM` fixtures and empty-section tests already exist to build the regression coverage on.

---

> **Phase complete?** Existing code mapped (23 sites + tests + doc). Prior decisions surfaced (STRK-73 provenance; stale CSV memory flagged). Open questions resolved. Next: `/sketch-review STRK-83 discovery [AGENT]` (optional) → `/sketch-reconcile STRK-83 discovery` → `/sketch-approach STRK-83`.
