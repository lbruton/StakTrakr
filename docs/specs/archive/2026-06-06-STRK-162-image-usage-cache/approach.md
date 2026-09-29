---
sketch: "STRK-162-image-usage-cache"
phase: approach
created: 2026-06-06
---

# STRK-162 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Add one nullable numeric field to the `ImageCache` instance (the `js/image-cache.js:966` singleton) that holds the total bytes in the `userImages` store. `null` is the **cold** sentinel ("unknown — recompute on next need"); a number is the **warm** value. A small private accessor returns the warm value, lazily computing it once via the existing `_userImagesBytes()` scan when cold. The single existing read site — the quota pre-flight inside `cacheUserImageResult` ([js/image-cache.js:533](../../../../../StakTrakr/js/image-cache.js)) — is switched from calling `_userImagesBytes()` directly to calling the cached accessor.

Coherency is maintained by an **asymmetric** rule, which is the heart of the design:

- **Increment** the field by the signed `delta` **only on the `cacheUserImageResult` success branch** (the one place that already knows the exact byte delta — `delta` at line 532, `used` at line 533, post-write total `used + delta`). This is what keeps the cache warm across the hot save path so AC-1 holds.
- **Invalidate** (set the field back to `null`) on the other three mutation paths — `deleteUserImage`, `clearAll`, `importUserImageRecord` — which do **not** all know the exact delta. The next read recomputes from a fresh scan.

The warn-after-save path (`cacheUserImageWithFeedback`, line 588) needs **no change**: it already reuses the `usageBytes` returned by `cacheUserImageResult`, so the pressure-band toasts stay correct for free. Net surface: one field, one tiny accessor, one read swap, one assignment on the success branch, and three one-line invalidations — all within `js/image-cache.js`.

**AC-4 semantics (pinned per review):** "unchanged" means **no `delta` is applied** on a non-write — it does *not* mean the field must remain `null`. The cached accessor runs *before* both non-write exits (the pre-flight block at 541 and the `_put`-failure exit at 554), so a call that starts **cold** will legitimately warm the field to the freshly-scanned `used` — which is the correct current total, since no write occurred. Only the `used + delta` increment is gated on `ok === true`. Therefore tasks/tests MUST NOT assert `cache === null` after a blocked or failed save, and MUST NOT route failure paths around the accessor; the assertion that satisfies AC-4 is "the total did not move by `delta`," not "the field stayed cold."

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| **D-1** | Represent the cache as a **nullable number** (`null` = cold, number = warm) on the instance. | Two clean states; lazy recompute is a single `=== null` check. | `0` (empty store) and "cold" must be distinguished by `=== null`, **never** a falsy check — `if (!cache)` would treat a legitimately-empty `0` total as cold and force needless rescans. This is the single biggest correctness trap; pinned in Risk Notes. |
| **D-2** | Place the **increment in `cacheUserImageResult`'s success branch** (not in the `cacheUserImage`/`cacheUserImageWithFeedback` wrappers). | Both wrappers funnel through `cacheUserImageResult` (verified in discovery), so one site covers every write caller. | The increment line sits next to the return-object construction; it must be gated on the actual put result (`ok === true`), not reached on the pre-flight block (541) or `_put` failure (554). **Per review:** the cached accessor still runs before those non-write exits, so a cold-start non-write call warms the field to the scanned `used` — that is allowed and correct (no `delta` applied). See the "AC-4 semantics" note above. |
| **D-3** | **Invalidate (null), don't incrementally adjust,** on `deleteUserImage` / `clearAll` / `importUserImageRecord`. | Conservative + provably correct: `deleteUserImage` doesn't fetch the record's size, `clearAll` zeroes multiple stores, `importUserImageRecord` may overwrite an existing uuid — none cheaply yields an exact delta. Recompute can't drift. | The first read after any of these pays one O(N) scan. Acceptable: these are far rarer than saves, and the alternative (compute exact deltas in each) adds reads, code, and drift surface. |
| **D-4** | **Invalidate inline** (`this.<field> = null`) at each of the three sites, rather than extracting an invalidation helper. | Smallest possible diff; three identical one-line assignments won't trip Codacy's duplication detector (it keys on blocks, not single lines). | Slightly less self-documenting than a named `_invalidate…()` method; mitigated by a short comment at each site. (A helper is the fallback if review prefers it.) |
| **D-5** | Put the new coherency coverage in a **dedicated new core spec**, leaving `tests/playwright/core/strk-146-image-quota-warning.spec.js` untouched as the AC-6 regression anchor. | Keeps the STRK-146 contract spec pristine (clean regression signal) and groups STRK-162's cache assertions in one place; consistent with `strk-146`/`numista-image-sync` each standing as their own active core spec (coverage-map rows 73–74). | One more spec file; the two specs share setup patterns (minor duplication, acceptable). **Per review:** a new Playwright file requires a matching `tests/playwright/coverage-map.csv` row (AGENTS.md:58) — now reflected in the File Map. |
| **D-6** | Make the scan **observable for tests** by keeping `_userImagesBytes()` as the sole scan function and routing all reads through the cached accessor. | Gives the tests a single deterministic seam — count calls to `_userImagesBytes` (or `_iterate`) via an in-browser wrapper to prove "scan happened / didn't" (AC-1/AC-2). | Tests reach into a `_`-prefixed internal; that coupling is intentional and documented (the behavior under test *is* the internal call pattern). |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New
- `tests/playwright/core/strk-162-image-usage-cache.spec.js` — coherency coverage for AC-1 (warm cache skips scan), AC-2 (lazy compute-once), AC-3 (signed-delta increment incl. shrink), AC-4 (no change on block/failure), AC-5 (delete-then-save / clearAll / import invalidation). _(Exact test breakdown is the tasks phase's job; this entry reserves the file.)_

### Modified
- `js/image-cache.js` — five touch points, all small:
  1. **Constructor** (`:18`) — add the nullable usage field, initialised to `null`, with a doc comment.
  2. **New private accessor** (near `_userImagesBytes`, `:493`) — lazy: if field `=== null`, set it via `await this._userImagesBytes()`; return the field.
  3. **Read swap** (`:533`) — `used` reads the cached accessor instead of `_userImagesBytes()` directly.
  4. **Success-branch increment** (within `:544–563`) — on `ok === true`, set field to `used + delta`.
  5. **Three invalidations** — `clearAll` (`:237`), `deleteUserImage` (`:629`), `importUserImageRecord` (`:650`): set field to `null`.
- `tests/playwright/coverage-map.csv` — add one `active` row for the new spec (`tests/playwright/core/strk-162-image-usage-cache.spec.js`, domain `image-storage`, risk `P1 core user workflow`, with a STRK-162 rationale). Required by [AGENTS.md:58](../../../../../StakTrakr/AGENTS.md) for any PR touching Playwright tests.

### Deleted
- _none._

## Data / Schema Changes

None — the cache is an **in-memory field on the singleton**. No IndexedDB schema change, no object-store version bump, no persisted data. A page reload starts the field cold (`null`) and it recomputes lazily on first need; the store remains the single source of truth.

## Tradeoffs Surfaced for Review

- **D-3 (recompute-on-invalidate)**: the first read after a delete/clear/import pays one full scan. Chosen over per-path incremental adjustment because correctness-first beats a clever delete-time delta that would need an extra record fetch and re-introduce the very drift this issue exists to remove. If profiling ever shows the post-delete scan matters (it shouldn't — deletes are rare vs saves), an incremental delete path is a future refinement.
- **D-4 (inline vs helper)**: leaning inline for the minimal diff. Flagging in case a reviewer prefers a named helper for intent.

## UI Contract

**N/A — no UI surface.** This is a backend performance optimization on the `ImageCache` singleton. No new views, modals, components, or layout. The only user-visible behavior in scope is the **existing** STRK-146 quota toasts, which AC-6 requires to remain byte-for-byte unchanged — they are a *regression guard*, not a UI deliverable. No mockups, playgrounds, or screenshots are referenced by requirements or discovery.

## Out of Scope (follow-up issues)

- **Caching `coinImages` / `patternImages` / `coinMetadata` totals.** `getStorageUsage()` (the all-store Settings display scan) stays O(N); only the per-save `userImages` pre-flight is optimized. File under StakTrakr only if that display ever becomes a hot path.
- **Serializing concurrent in-flight saves.** Interleaving semantics are unchanged from today; no locking added. Revisit only if a concurrency bug is actually observed.
- **Persisting the usage total across reloads.** Intentionally in-memory; the store is authoritative and a cold recompute on boot is cheap and correct.

## Risk Notes

- **Risk: falsy cold-check** (`if (!cache)` treating an empty-store `0` as cold) → **mitigation:** strict `=== null` everywhere; never a truthiness test. (D-1.)
- **Risk: incrementing on a non-write** (pre-flight block or `_put` failure) → **mitigation:** gate the increment on `ok === true` only. (D-2 / AC-4.)
- **Risk: Codacy DELTA complexity gate** on `image-cache.js` → **mitigation:** keep the diff minimal (one field + one tiny accessor + a few one-liners). ⚠ Admin-merge is **no longer** an escape hatch (Protect Dev ruleset, verified 2026-06-06), so small-and-clean is the only path.
- **Risk: a future direct `userImages` writer** bypassing the cache → **mitigation:** discovery confirmed none exist today; the new spec's invalidation tests will fail loudly if a path is later added without an invalidation call.

## Review Archive — approach (2026-06-06)

_Reviewer marks preserved verbatim. Resolutions applied in the sections above._

> CODEX: AC-4 says a pre-flight block or `_put` failure leaves the cached usage total unchanged, but this design necessarily calls the cached accessor before both exits. If the field is cold at call start, a non-write call will still warm it to the scanned `used` value even though it must not apply `delta`. The approach should pin that semantic explicitly ("no increment/delta on non-write; cold-to-warm scan is allowed") so tasks do not add a brittle `null`-must-remain-`null` assertion or route failure paths around the accessor.

> CODEX: Adding a new Playwright file also requires updating `tests/playwright/coverage-map.csv` per repo rules; the current File Map only reserves the new spec and `js/image-cache.js`, so tasks generated from this approach would miss that required delta. Since the existing `tests/playwright/core/strk-146-image-quota-warning.spec.js` is already the active `image-storage` core suite, the approach should either add `coverage-map.csv` to Modified and justify the separate STRK-162 file, or fold the coherency checks into the existing image-storage suite while preserving AC-6's regression signal.

### Resolution Summary
- **Accepted (2):** CODEX-1 — AC-4 cold→warm semantic pinned in High-Level Architecture + the D-2 tradeoff cell. CODEX-2a — `tests/playwright/coverage-map.csv` added to File Map → Modified.
- **Resolved with your input (1):** CODEX-2b — chose a **dedicated STRK-162 spec** (D-5 retained); coverage-map.csv gains one `image-storage` `active` row.
- **Rejected (0).** Both findings verified true against the live repo ([AGENTS.md:54](../../../../../StakTrakr/AGENTS.md) / [AGENTS.md:58](../../../../../StakTrakr/AGENTS.md); coverage-map.csv row 73 = `strk-146` `image-storage` `active`).

---

> **Phase complete?** Architecture clear, decisions logged with rationale + tradeoff, file map complete. Next: `/sketch-review STRK-162 approach [AGENT]` → `/sketch-reconcile STRK-162 approach` → `/sketch-tasks STRK-162`.

## CODEX Review (2026-06-07)

### Verified

- Read `DocVault/sketch/conventions.md`, StakTrakr `AGENTS.md`, `.context/GLOSSARY.md`, `.context/git-topology.md`, `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, and `.context/sketch-conventions.md`.
- Checked the cumulative sketch artifacts: `requirements.md`, `discovery.md`, and this `approach.md`. No prior unreconciled reviewer comments were present in the active STRK-162 phase files.
- Verified live `js/image-cache.js` anchors: constructor state (`:18-31`), `clearAll()` (`:237-248`), legacy-safe `_recordSize()` (`:483-486`), `_userImagesBytes()` scan (`:493-503`), `cacheUserImageResult()` read/delta/success branches (`:516-563`), wrappers (`:573-588` and `:587-610`), `deleteUserImage()` (`:629-632`), `importUserImageRecord()` (`:650-653`), and singleton exposure (`:966-968`).
- Re-ran the caller/direct-store census with `rg`: external writes still funnel through `cacheUserImage*`, `deleteUserImage`, `clearAll`, or `importUserImageRecord`; the only non-`ImageCache` direct `userImages` store access found was the read-only `count()` path in `js/vault.js:1434-1439`.
- Checked current test structure: `npm test` maps to `npm run test:core` (`package.json:14-15`), `tests/playwright/core/strk-146-image-quota-warning.spec.js` already drives `window.imageCache` directly, and `tests/playwright/coverage-map.csv` has an active `image-storage` row for STRK-146.

### Top concerns

- AC-4/non-write cache semantics need one sentence of approach-level precision: a cold cache may legitimately warm during a pre-flight block or `_put` failure because `used` must be read before those exits; the invariant should be "no `delta` applied unless `ok === true`."
- The File Map misses `tests/playwright/coverage-map.csv` if D-5 keeps the new core spec, and D-5 should justify why STRK-162 needs a separate core file instead of joining the existing image-storage suite.

### Unverified assumptions

- I did not verify live Plane/PR metadata for STRK-162 or PR #1218; the review is grounded in the local sketch text and live repository state.
- I did not run Playwright because this phase is review-only and no implementation/test code was changed.
