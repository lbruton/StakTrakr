---
paths:
  - "js/**/*.js"
---

# JavaScript Invariants — StakTrakr

Foot-guns in `js/`. Most fail **silently** — no exception, no red test — which is why they
are injected at the point of edit rather than left to review. Two throw loudly and are
marked as such. Full detail: `.context/coding-standards.md`,
`.context/implementation-gotchas.md`.

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

Script-tag globals — no modules, no imports. Redeclaring a top-level binding across two
files behaves differently by keyword, and both outcomes are bad:

- `const` / `let` / `class` — **SyntaxError at parse time that silently kills the second
  script.** Nothing else on the page reports it.
- `var` — legal. The later script silently overwrites the earlier value, so there is no
  error at all and the symptom surfaces far from the cause.

Prefix new sync-related globals `SYNC_` (precedent: `SYNC_SCOPE_KEYS`,
`SYNC_BACKUP_PREFIX` in `js/constants.js`).

Corollary: to find every reference to a global, Grep the identifier. There is no import
graph, so semantic search under-reports call sites.

## `safeGetElement` returns a partial dummy, not null

A missing element yields a shim whose members no-op silently, so `if (!el)` never fires.
Discriminate a real element with `instanceof HTMLElement` or `nodeType === 1` — the
codebase uses both (`js/spotLookup.js:26`).

`init.js` defines it and loads **after** `events.js` (both `defer`). Top-level code in
`events.js` calling `safeGetElement` **throws a ReferenceError** — loud, but it kills the
rest of the script. Use `document.getElementById` for parse-time wiring. Factory closures
are fine; they resolve at runtime.

## `loadDataSync` — swallowed errors, truthy defaults

- Parse/decompression errors return the default instead of throwing. An outer `try/catch`
  will not fire, and `console.warn` in that catch is dead code.
- The default is `[]`, not `null` — and `[]` is truthy, so `if (!stored)` merge guards
  silently skip. Pass `null` explicitly when the caller tests truthiness.
- `saveDataSync` **re-throws** on quota errors, unlike raw `localStorage.setItem`.
  Fire-and-forget callers migrating from raw storage need a `try/catch`.

## Persisted keys: `ALLOWED_STORAGE_KEYS` always, `SYNC_SCOPE_KEYS` conditionally

Any new persisted key must be added to `ALLOWED_STORAGE_KEYS`.

`SYNC_SCOPE_KEYS` (`js/constants.js`) is **not** automatic — it covers inventory data plus
preferences meaningful _across devices_. Its contract explicitly excludes OAuth tokens,
transient caches, server-sourced data, and device-local state. Adding a cache or a
server-sourced value there is a bug, not an omission.

When a key is deliberately device-local, say so in a comment at the declaration
(precedent: `FORM_SECTION_STATE_KEY`, STRK-301).

## A new `js/` file registers in TWO places

`index.html` **and** `CORE_ASSETS` in `sw.js`. Missing the `sw.js` half fails only offline,
only after a cache cycle — invisible in every local test run. Keep `CORE_ASSETS` in the
same order as the `<script>` tags for auditability.

**Intentional exception:** `js/test-loader.js` is never added to `CORE_ASSETS` — it is a
dev-only harness, gated on `hostname === "localhost"`. Do not precache dev-only scripts.

## Date frames — never mix silently

- User-facing local dates → `toLocaleDateString('en-CA')`.
- Feed-keyed / UTC values → derive from the ISO field (`row.t.split("T")[0]`) or pass
  `{ timeZone: 'UTC' }`.
- `toISOString().slice(0, 10)` on a locally-constructed date shifts a day for users at
  negative UTC offsets; local `en-CA` on a UTC-stamped key shifts the other way.

Crossing frames is allowed only when deliberate and commented at the call site.

## `applyBulkEdit()` — preserve the current contracts

Both historical hazards are already solved in `js/bulkEdit.js`. Do not regress them:

- **Nested paths** route through `BULK_FIELD_STORAGE_MAP` via `applyBulkFieldToItem()`.
  A new bulk-editable field at a nested path (e.g. `item.numistaData.shape`) needs its own
  map entry; without one, a flat write lands on a bogus top-level key (precedent: STRK-91).
- **Change-log snapshots** use `structuredClone` for `oldItem.numistaData` and
  `oldItem.fieldMeta`. A plain `Object.assign({}, item)` is shallow — mutating a nested
  object would also mutate `oldItem` and the before/after diff would come out empty.
- Grep `BULK_COLUMN_PRIORITY` for its length rather than trusting docs — reviewers have
  guessed wrong in three separate sessions.

## `_isMarketItemEnabled` — apply on both tab paths

In `_renderVendorTable()`, apply the filter on **both** the All-tab path and the per-metal
`else` branch, or disabled vendors surface as column headers.
