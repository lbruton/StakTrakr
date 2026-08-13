---
paths:
  - "js/**/*.js"
---

# JavaScript Invariants — StakTrakr

Silent-failure foot-guns in `js/`. Every entry here fails **quietly** — no exception, no
red test — which is why they are injected at the point of edit rather than left to review.
Full detail: `.context/coding-standards.md`, `.context/implementation-gotchas.md`.

## Dual config store — CRITICAL, silent data loss

Two unrelated localStorage stores. Confusing them was the STRK-573 root cause.

| Store                             | Key                  | Read / Write                                              |
| --------------------------------- | -------------------- | --------------------------------------------------------- |
| Spot providers                    | `metalApiConfig`     | `loadApiConfig()` / `saveApiConfig()`                     |
| Catalog providers (Numista, PCGS) | `catalog_api_config` | `catalogConfig.getNumistaConfig()` / `setNumistaConfig()` |

`loadApiConfig().keys["numista"]` returns `undefined` — wrong store, no error raised.
After saving a catalog key, call `catalogAPI.initializeProviders()` or provider instances
stay stale.

## All `js/` files share ONE global scope

Script-tag globals — no modules, no imports. A duplicate top-level `const`/`var` across two
files is a **SyntaxError that silently kills the second script**. Prefix new sync-related
globals `SYNC_` / `_sync`.

Corollary: to find every reference to a global, Grep the identifier. There is no import
graph, so semantic search under-reports call sites.

## `safeGetElement` returns a partial dummy, not null

A missing element yields a shim whose members no-op silently, so `if (!el)` never fires.
Only `instanceof HTMLElement` discriminates a real element.

`init.js` defines it and loads **after** `events.js` (both `defer`). Top-level code in
`events.js` calling `safeGetElement` throws a silent ReferenceError — use
`document.getElementById` for parse-time wiring. Factory closures are fine; they resolve at
runtime.

## `loadDataSync` — swallowed errors, truthy defaults

- Parse/decompression errors return the default instead of throwing. An outer `try/catch`
  will not fire, and `console.warn` in that catch is dead code.
- The default is `[]`, not `null` — and `[]` is truthy, so `if (!stored)` merge guards
  silently skip. Pass `null` explicitly when the caller tests truthiness.
- `saveDataSync` **re-throws** on quota errors, unlike raw `localStorage.setItem`.
  Fire-and-forget callers migrating from raw storage need a `try/catch`.

## A new persisted key registers in TWO places

`ALLOWED_STORAGE_KEYS` **and** `SYNC_SCOPE_KEYS` (`js/constants.js`). Registering one
without the other yields a key that either fails restore or never syncs — both silent.
Device-local keys are deliberately excluded from `SYNC_SCOPE_KEYS`; note that in a comment
at the declaration (precedent: `FORM_SECTION_STATE_KEY`, STRK-301).

## A new `js/` file registers in TWO places

`index.html` **and** `CORE_ASSETS` in `sw.js`. Missing the `sw.js` half fails only offline,
only after a cache cycle — invisible in every local test run.

## Date frames — never mix silently

- User-facing local dates → `toLocaleDateString('en-CA')`.
- Feed-keyed / UTC values → derive from the ISO field (`row.t.split("T")[0]`) or pass
  `{ timeZone: 'UTC' }`.
- `toISOString().slice(0, 10)` on a locally-constructed date shifts a day for users at
  negative UTC offsets; local `en-CA` on a UTC-stamped key shifts the other way.

Crossing frames is allowed only when deliberate and commented at the call site.

## `applyBulkEdit()` — flat assignment, shallow copy

- Assignment is flat (`item[fieldId] = value`). A nested path such as
  `item.numistaData.shape` silently writes a bogus top-level key unless it has a
  `BULK_FIELD_STORAGE_MAP` entry (precedent: STRK-91).
- `Object.assign({}, item)` is shallow, so mutating a nested object mutates `oldItem` too
  and change-log before/after diffs come out empty. Deep-copy before mutating.
- Grep `BULK_COLUMN_PRIORITY` for its length rather than trusting docs — reviewers have
  guessed wrong in three separate sessions.

## Two smaller ones

- `_isMarketItemEnabled` must be applied on **both** the All-tab path and the per-metal
  `else` branch of `_renderVendorTable()`, or disabled vendors surface as column headers.
- `isGoldbackLookup` (target + unit) and `isGoldbackRetailLookup` (unit only) are different
  predicates. Retail lookup uses unit-only.
