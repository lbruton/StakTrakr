---
title: "StakTrakr — Coding Standards"
project: StakTrakr
audience: agent
canonical: .context/coding-standards.md
source: "DocVault/Projects/StakTrakr/Foundation/coding-standards.md" # migrated 2026-08-12
updated: "2026-06-28"
---

# StakTrakr — Coding Standards

Single-page working reference. Covers code style, module boundaries, DOM rules, storage patterns, error handling, API integration, library-specific standards, CSS design system, service worker, release process, testing, and security. Use this before touching any `.js` file, `sw.js`, `constants.js`, or running `/release patch`.

---

## Code Style

### Formatting

- **2-space indentation** (no tabs)
- **Semicolons always** — every statement ends with `;`
- **Trailing commas** in multi-line arrays and objects
- **120-character soft line limit** — break long lines at logical points

### Quotes

- **Double quotes** for string values in configuration objects and data (`"silver"`, `"USD"`)
- **Single quotes** for DOM selectors, localStorage keys, and template fragments (`'changeLog'`, `'hidden.bs.modal'`)
- **Template literals** for string interpolation and multi-line strings — always prefer over concatenation

### Variable declarations

```js
// const-first — use for everything that isn't reassigned
const API_CACHE_DURATION = 24 * 60 * 60 * 1000;

// let — only when the value changes
let editingIndex = null;

// NEVER use var — it leaks scope and hoists unpredictably
```

### Naming conventions

| Kind                  | Convention                    | Examples                                       |
| --------------------- | ----------------------------- | ---------------------------------------------- |
| Variables & functions | `camelCase`                   | `sortColumn`, `editingIndex`, `formatCurrency` |
| Constants             | `UPPER_SNAKE_CASE`            | `APP_VERSION`, `LS_KEY`, `DEFAULT_CURRENCY`    |
| Classes               | `PascalCase`                  | `FeatureFlags`                                 |
| Files                 | `kebab-case`                  | `file-protocol-fix.js`, `debug-log.js`         |
| CSS classes           | `kebab-case`                  | `filter-text`, `na-value`, `spot-card`         |
| DOM IDs               | `camelCase`                   | `spotSilver`, `itemModal`, `inventoryTable`    |
| localStorage keys     | `camelCase` or `dot.notation` | `metalInventory`, `staktrakr.catalog.cache`    |

### Functions

- **Arrow functions** for callbacks, inline handlers, and short helpers
- **`function` declarations** for hoisted functions that need to be called before definition (rare — prefer `const`)
- **Verb-noun naming**: `saveData`, `loadData`, `formatCurrency`, `handleError`, `renderTable`
- **Boolean-returning functions**: prefix with `is`, `has`, `can`, `should` (e.g., `isFeatureEnabled`)

### Comparison

- **Strict equality only**: `===` and `!==`. Never use `==` or `!=`
- **Nullish checks**: prefer `value == null` (the one exception — catches both `null` and `undefined`) or optional chaining (`data?.rates?.price`)

---

## Module Boundaries

Each `.js` file owns a specific domain. Don't put DOM event handlers in `utils.js`, formatting helpers in `events.js`, or state declarations outside `state.js`.

| File           | Responsibility                                            |
| -------------- | --------------------------------------------------------- |
| `constants.js` | Configuration, API providers, storage keys, feature flags |
| `state.js`     | All mutable application state, cached DOM references      |
| `utils.js`     | Formatting, validation, storage helpers, error handling   |
| `events.js`    | Event binding, modal submit handlers, UI interactions     |
| `inventory.js` | CRUD operations, table rendering, CSV/PDF/ZIP export      |
| `api.js`       | External pricing API calls with provider fallback         |
| `init.js`      | Application bootstrap (runs last)                         |

### Global scope discipline

Since everything is global (no bundler, no ES modules), follow these rules to avoid collisions:

- **Constants**: define with `const` at file top, expose via `window.X = X` block at file bottom
- **State variables**: declare only in `state.js` with `let`
- **Helper functions**: define with `const fn = () => {}` in their owning module
- **No generic names**: avoid `data`, `result`, `temp`, `value` at file scope — prefix with domain context (e.g., `apiCache`, `spotHistory`)

---

## DOM Manipulation

### Rule 1 — Use `safeGetElement` for all ID lookups

`safeGetElement(id, required?)` is defined in `js/init.js` at line 42. It never returns `null` — missing elements get a no-op dummy object, preventing TypeError crashes in the init chain.

```js
// Signature
function safeGetElement(id, required = false)
// Returns: real HTMLElement, or createDummyElement() — never null
```

| Parameter  | Type      | Default | Effect                                    |
| ---------- | --------- | ------- | ----------------------------------------- |
| `id`       | `string`  | —       | HTML element ID                           |
| `required` | `boolean` | `false` | Emits `console.warn` if element not found |

```js
// Required element — warns in DevTools if absent
elements.inventoryForm = safeGetElement("inventoryForm", true);

// Optional element — silently no-ops if absent
elements.itemGbDenom = safeGetElement("itemGbDenom");
```

**Exception — existence checks:** When code must distinguish "exists" from "absent" (e.g., toggling a popover off, or refusing to mount a component that is already in the DOM), use `document.getElementById()` + `if` guard. The dummy object is always truthy, which broke the STAK-492 popover toggle and would have prevented the STRK-13 inventory recovery banner from ever mounting (`if (safeGetElement("inventoryRecoveryBanner"))` would have evaluated truthy on the very first call).

```js
// Correct pattern for existence check
const popover = document.getElementById("thumbPopover");
if (popover) popover.remove();

// Correct pattern for "mount once" check (STRK-13 — js/inventory.js:54)
const existing = document.getElementById("inventoryRecoveryBanner");
if (existing) return; // already mounted; do not re-insert
```

**Recovery-state guard for empty-state UI:** Any new inventory view that renders an empty-state placeholder must check `isInventoryRecoveryActive()` before showing mutation actions (Add Item button, etc.). When the recovery banner is up, the placeholder must defer to the banner — otherwise a single click on Add Item silently clears `inventoryRecoveryActive` and defeats the recovery hold before the user can read the warning. Reference: `js/inventory-table.js:656-658` (table view) and `js/card-view.js:776-782` (card view) — both check the flag and skip the empty-state row when true.

**Exception — `about.js` early-init:** `about.js` loads before `init.js`, so `safeGetElement` does not exist at top-level execution time. Early-init functions (ack modal: `showAckModal`, `hideAckModal`, `setupAckModalEvents`) must use raw `document.getElementById()` + `if` guard. Late-call functions in `about.js` that only run after `init.js` completes (About tab, popup) may use `safeGetElement`.

**Lookup style reference:**

| Context                                                                 | Style                              | Reason                                                               |
| ----------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| All `.js` files (general)                                               | `safeGetElement()`                 | Default — prevents null crashes                                      |
| DOM existence check                                                     | `document.getElementById()` + `if` | Needs real `null` when absent                                        |
| `about.js` early-init functions                                         | `document.getElementById()` + `if` | `safeGetElement` not yet defined                                     |
| `about.js` late-call functions                                          | `safeGetElement()`                 | `init.js` has run                                                    |
| Established modules (`card-view.js`, `events.js`, `inventory.js`, etc.) | Mix — legacy direct calls exist    | New code in these files should use `safeGetElement()` for ID lookups |

---

### Rule 2 — Always sanitize user content before setting inner HTML

`sanitizeHtml(str)` is defined in `js/utils.js` at line 401. It HTML-encodes `&`, `<`, `>`, `"`, `'` — making any string safe for interpolation into an HTML template literal.

```js
// Signature (utils.js:401 — const sanitizeHtml)
const sanitizeHtml = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};
```

**Use `sanitizeHtml` for:** any string that originated from user input — item names, notes, imported CSV fields, catalog lookups, custom labels.

**Do NOT use `sanitizeHtml` for:** developer-written static HTML strings. Wrapping a static template literal double-encodes it and produces visible `&lt;span&gt;` garbage in the UI.

Correct pattern — user content:

```js
// Always pass user-supplied text through sanitizeHtml before innerHTML assignment
row.innerHTML = `<td>${sanitizeHtml(item.name)}</td>`;
```

Correct pattern — static developer markup:

```js
// Static markup written by the developer needs no sanitizing
el.innerHTML = `<span class="badge">Active</span>`;
```

**`escapeHtml` vs `sanitizeHtml`:** Both produce identical output for non-empty strings. Difference: `escapeHtml` (defined `js/utils.js` line 19) uses `str ?? ''` and always coerces; `sanitizeHtml` returns `""` on any falsy value. `escapeHtml` is used internally for button-loading states. Prefer `sanitizeHtml` in new application code.

```js
// escapeHtml signature (utils.js:19)
const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
```

---

### Rule 3 — Use `safeAttachListener` for optional elements

`safeAttachListener(element, event, handler, description?)` is defined in `js/events.js`. It skips silently when `element` is falsy — no crashes on optional UI elements.

```js
// For truly optional elements: one-liner guard
optionalListener(fileInput, "change", handleChange, "CSV file input");
```

---

### Rule 4 — Reuse chip segmented controls for small binary or mode toggles

For compact in-form mode switches, prefer the existing `.chip-sort-toggle` container and `.chip-sort-btn` buttons before adding new CSS. Keep state UI-local unless the selected mode is part of the persisted data contract.

Reference: STRK-4 reused this pattern for the Add/Edit Item modal Purchase Price Lot/Each control while preserving `item.price` as per-unit stored data.

**N-chip quantity variant (STRK-53):** When a chip group represents a 1..N quantity range (not a binary toggle), use `.chip-sort-toggle--quantity` modifier. Thresholds: `DISPOSE_QTY_CHIP_MAX = 8` — render chips when N ≤ 8, fall back to a native `<select>` for larger ranges. Chips use roving tabindex (ArrowLeft/Right/Up/Down, Home, End) with `aria-pressed` and `aria-disabled` for the qty=1 pre-selected state. Write values through a hidden `<input>` via `writeDisposeQty(n)` which dispatches a bubbling `input` event to preserve downstream handler wiring. Reference: `js/inventory.js` — `renderDisposeQtyChips` / `renderDisposeQtySelect`.

---

### Security — innerHTML policy

All innerHTML assignments that interpolate user-supplied values must sanitize the value first via `sanitizeHtml`. The `// nosemgrep: no-direct-inner-html` annotation exists only to suppress static analysis false positives on assignments that have already been sanitized — do not add it as a bypass.

---

## localStorage / Storage Patterns

### Rule — No raw `localStorage` calls for structured data

All reads and writes of structured JSON app data must go through the wrapper functions. Direct `localStorage.setItem` / `getItem` is permitted only for intentional scalar string cases (cloud sync cursor, idle timeout keys) and specialized low-level helpers.

| Wrapper                           | Async | Re-throws on error     | Use when                         |
| --------------------------------- | ----- | ---------------------- | -------------------------------- |
| `saveData(key, data)`             | Yes   | No (logs only)         | Default — all new async code     |
| `loadData(key, defaultValue)`     | Yes   | No (returns default)   | Default — all new async code     |
| `saveDataSync(key, data)`         | No    | Yes                    | `beforeunload`, early-init paths |
| `loadDataSync(key, defaultValue)` | No    | No (swallows silently) | Early-init, sync-only contexts   |

**Default value caveat:** Both `loadData` and `loadDataSync` default `defaultValue` to `[]`. For keys holding objects, booleans, or strings, always pass an explicit default:

```js
// Risky — returns [] when key is absent, not null
const theme = await loadData(THEME_KEY);

// Correct — explicit default
const theme = await loadData(THEME_KEY, "light");
```

### ALLOWED_STORAGE_KEYS guard

`cleanupStorage()` runs at `DOMContentLoaded` and deletes every `localStorage` key not listed in `ALLOWED_STORAGE_KEYS` (defined in `js/constants.js` at line 949). A key written before it is added to the allowlist survives the current session but is wiped on the next startup.

The `typeof ALLOWED_STORAGE_KEYS !== 'undefined'` guard seen in `cloud-sync.js` is intentional defensive coding — the constant IS defined at `constants.js:949`. Automated reviewer flags on this pattern are false positives.

**STAK-443 additions:** `spotPricingSource` (single-select spot price source) and `metalSpotPrices` (manual-mode unified spot object) are registered in ALLOWED_STORAGE_KEYS as of v3.34.24.

**STRK-13 additions:** `inventorySeedApplied` (ISO timestamp sentinel proving the seed has run) and `staktrakr.bootDiagnostics` (bounded 10-entry ring buffer for boot classifications) are registered in ALLOWED_STORAGE_KEYS as of v3.34.35. See architecture#Boot Dispatch — Inventory Seed Guard (STRK-13) for the dispatch flow.

### `inventoryRecoveryActive` — write gate for damaged-key boots (STRK-13)

When `classifyBootState()` returns `damaged-key` or `parse-error`, `js/init.js` sets the `inventoryRecoveryActive` flag and `saveInventory()` early-returns until an explicit user action clears it. Auto-sync paths (cloud-sync poll/pull) also reach the same gated `saveInventory()`, so a corrupt `metalInventory` cannot be silently overwritten with `[]` from any code path.

**When adding a new user-mutation entry point that calls `saveInventory()`** (new import format, new restore path, new direct-edit flow), call `clearInventoryRecovery()` first — otherwise the user's deliberate add/import will be suppressed by the recovery gate. Existing call sites: `js/events.js:1496` (addItem), `js/inventory-import.js:62/502/839/1342` (CSV/JSON/Numista paths), `js/vault.js:688` (cloud + .stvault restore).

### How to add a new storage key

1. Define a named constant in `js/constants.js`:

   ```js
   const MY_NEW_SETTING_KEY = "myNewSetting";
   ```

2. Add it to `ALLOWED_STORAGE_KEYS` in the same file with a comment:

   ```js
   MY_NEW_SETTING_KEY, // string: description of what this stores
   ```

3. Expose the constant in the `window` assignment block at the bottom of `constants.js`:

   ```js
   window.MY_NEW_SETTING_KEY = MY_NEW_SETTING_KEY;
   ```

4. Use the wrappers in feature code:

   ```js
   await saveData(MY_NEW_SETTING_KEY, value);
   const value = await loadData(MY_NEW_SETTING_KEY, "default");
   ```

Never hardcode the key string in two files — define it once as a constant, reference the constant everywhere. Key name drift causes silent allowlist mismatches.

### Cloud sync integration

Keys that should sync across devices must be in both `ALLOWED_STORAGE_KEYS` AND `SYNC_SCOPE_KEYS` (defined in `js/constants.js`). After writing sync-scoped data, call `scheduleSyncPush()`:

```js
if (typeof scheduleSyncPush === "function") scheduleSyncPush();
```

The `typeof` guard is required — `cloud-sync.js` may not be loaded in all environments.

### Compression internals

Values longer than 4,096 characters are compressed with real lz-string (`compressToUTF16`, vendored at `vendor/lz-string.min.js`) on write and decompressed on read — transparent through the wrappers. Current writes use the **`CMP2:`** prefix; **`CMP1:`** is a legacy read-only prefix (the pre-v3.35.1 identity-stub era, where the body was stored _uncompressed_ — it is sliced, never decompressed, since lz-string would return garbage on never-compressed bytes). `__decompressIfNeeded` handles both. Bypassing the wrappers breaks decompression silently — a compressed value read via `localStorage.getItem()` returns a `CMP2:...` (or legacy `CMP1:...`) string, not usable JSON. Two STRK-140 safeguards: `__migrateCompressionV2` (one-time boot migration that re-encodes legacy `CMP1:` keys to `CMP2:`) and `__wouldClobberCompressed` (fail-closed write guard that refuses to overwrite a `CMP2:` key when no real engine is loaded).

### Rule — Decompress before parsing raw `localStorage`

When code intentionally bypasses `loadData` / `loadDataSync` to inspect the raw shape of a key (boot classification, recovery checks, diagnostic dumps), it MUST run `__decompressIfNeeded(raw)` before `JSON.parse(raw)`. The wrapper is a no-op for short payloads and strips the `CMP2:`/`CMP1:` prefix on compressed ones.

```js
// Correct — handles both compressed and uncompressed payloads
const raw = localStorage.getItem("metalInventory");
if (raw) {
  const decompressed = typeof __decompressIfNeeded === "function" ? __decompressIfNeeded(raw) : raw;
  const parsed = JSON.parse(decompressed); // safe for both shapes
}
```

```js
// WRONG — JSON.parse throws SyntaxError on any inventory ≥4096 chars
const raw = localStorage.getItem("metalInventory");
const parsed = JSON.parse(raw); // "CMP2:[...]" is not valid JSON
```

This pattern was missed in the initial STRK-13 implementation and caught in Codex peer review — without the decompress step, every returning user with a large inventory would have been misclassified as `parse-error` and shown the recovery banner. Reference: `js/seed-data.js:8324-8334`.

### Cloud-sync convergence — compare/merge/hash on logical content (STRK-154)

Every cloud-sync **compare**, **merge**, and **hash** must operate on **normalized logical content**, never raw serialization — and every **merge** must be **commutative / convergent on ties**. Violating either freezes two devices in a permanent "Review Sync Changes" loop that no resolution (Keep Local / Keep Remote / Ignore) ever clears.

1. **Logical, not raw.** Decompress (`__decompressIfNeeded`) and canonicalize (sorted object keys, order-preserved arrays, scalar-as-JSON normalized to its logical value) before comparing or hashing. Identical logical content must compare/hash equal regardless of `CMP2:`-compressed-vs-plain, scalar-as-JSON-vs-raw, object key-order, or date-time serialization variant. `computeSettingsHash` and `computeInventoryHash` already do this; any new hash must too.
2. **Commutative merge.** `merge(A, B)` must equal `merge(B, A)`, **including on a timestamp tie** — a last-write-wins no-op on a tie is non-commutative and is exactly what froze the live loop. Resolve ties by a deterministic union (see `_unionTags` / `_mergeTagData`), and bump the modification timestamp only when content actually changes, so the merge stays idempotent once both sides agree.

The fixes are **self-healing**: diverged installs reconcile on the next sync with no user action. The only exception is data that cannot round-trip — `[object Object]` coercion corruption (an object written without `JSON.stringify`) — which a one-time idempotent boot-repair (`syncBootRepairCorruptSettings`) clears. Detect that corruption by an **exact** match of the whole value against the artifact, **never** a substring: free-text scope keys (`itemTags`, `tagBlacklist`, `chipCustomGroups`) can legitimately hold a user value named `[object Object]` inside valid JSON, and a substring match would wipe the entire store.

When adding a `SYNC_SCOPE_KEYS` entry: object/array configs must always be `JSON.stringify`-written (never let an object reach `localStorage.setItem` un-stringified); a per-item map merged across devices needs a commutative tie-union (not raw LWW); a date-time field compared in the item diff must be added to `INSTANT_FIELDS` in `js/diff-engine.js`. The full per-surface matrix and the commutativity / logical-equality tests live in `.context/cloud-sync-convergence.md` and `tests/unit/cloud-sync-*.test.js`.

### Migration pattern — renaming a key

```js
const oldValue = await loadData("oldKeyName", null);
if (oldValue !== null) {
  await saveData(NEW_KEY, oldValue);
  localStorage.removeItem("oldKeyName"); // direct remove is OK for cleanup
}
```

Add a one-time migration flag (prefix: `migration_`) and keep `oldKeyName` in `ALLOWED_STORAGE_KEYS` until the next release.

### IndexedDB-backed stores — the singleton class pattern (STRK-141)

When a dataset outgrows the localStorage ceiling (~5 MB), back it with IndexedDB instead. There are three such stores — `imageCache` (`js/image-cache.js`), `attachmentManager` (`js/attachment-manager.js`), and `historyStore` (`js/history-store.js`) — and a new one **must mirror this pattern**:

- A plain class file exposing a `window.<name>` singleton tail (`const x = new X(); window.x = x;`) — no ES modules.
- The shared lifecycle: `_ensureDb()` stale-reconnect probe, `_initQuota()` non-blocking quota estimate via `navigator.storage.estimate()`, an `onclose` recovery handler, `async init() → boolean`, and a synchronous `isAvailable()` gate.
- Quota-safe writes: the `put`/write path **catches** `QuotaExceededError` / `NS_ERROR_DOM_INDEXEDDB_QUOTA_ERR` and returns `false` — it never throws.
- Loaded via `<script defer>` in dependency order (after its `_ensureDb` peers, before its consumers) **and** added to `sw.js` `CORE_ASSETS`.
- An IndexedDB store is **not** a localStorage key, so it is **not** in `ALLOWED_STORAGE_KEYS` (matching `imageCache` / `attachmentManager`).

`historyStore` owns the `StakTrakrHistory` DB (single `histories` object store keyed by logical name; see architecture#IndexedDB Stores). It holds spot (`metalSpotHistory`) and retail (`v2RetailHistory`) history as uncompressed JSON blobs. Its `migrate()` runs a one-time, idempotent localStorage→IDB migration (flag `migration_idb_history_v1`) that decompresses Phase-1 `CMP2:` payloads and deletes the legacy localStorage copies **only after** a confirmed IDB write — never destroy the source before the destination is durable.

### Boot-hydration-before-render — keep render reads synchronous

The render/chart paths must stay **synchronous**. The rule: an in-memory global (`spotHistory` array, `retailPriceHistory` object) is the runtime source of truth that all readers consult; storage is async at exactly two well-defined moments, never in the render path.

1. **Boot hydration (awaited):** `js/init.js` awaits `historyStore.init()` → `migrate()` → `loadSpotHistory()` → retail load **before** the first render (slots in after `attachmentManager.init()`). This is why charts never flash blank-then-populate.
2. **Persistence (sync facade + fire-and-forget put):** a save updates the in-memory global **synchronously first**, then schedules the IDB write without awaiting it (`void historyStore.put(...)`). Sync callers need no `await` — the global they and the renderers read is already current; the IDB write completes in the background and falls back to `saveDataSync` on failure.

This bounds the sync→async blast radius to the boot sequence and the save/load wrappers — the dozens of synchronous readers are untouched. When wiring a new IDB-backed history, follow the same seam: hydrate in the awaited boot block, expose a sync save facade. Parse-time boot work that depends on the store (e.g. `migrateHourlySource`) must be **moved into the awaited boot sequence**, not left at script-parse time where the store isn't ready yet.

---

## Service Worker

### Rule — Never edit `CACHE_NAME` by hand

`CACHE_NAME` in `sw.js` is written exclusively by the pre-commit hook `devops/hooks/stamp-sw-cache.sh`. Manual edits are overwritten on the next qualifying commit.

**Format:**

```text
staktrakr-v{APP_VERSION}-b{EPOCH}
// Example: staktrakr-v3.33.87-b1713180000
```

The hook fires on any staged change under: `css/`, `js/`, `index.html`, `data/`, `images/`, `manifest.json`, `sw.js`.

**Install the hook after a fresh clone:**

```bash
ln -sf ../../devops/hooks/stamp-sw-cache.sh .git/hooks/pre-commit
```

### CORE_ASSETS — keeping in sync

When adding a new JS file: update **both** `index.html` (script tag) and `CORE_ASSETS` in `sw.js`. Missing either causes a stale-serve bug that disappears on hard refresh but breaks offline mode.

```js
// CORE_ASSETS entry format
"./js/your-new-file.js"; // app files
"./vendor/your-lib.min.js"; // vendor files — add to bottom of CORE_ASSETS
```

Keep `CORE_ASSETS` entries in the same order as `<script>` tags in `index.html` for auditability.

**Intentional exclusion:** `js/test-loader.js` is never added to `CORE_ASSETS` — it is a dev-only test harness.

### Cache strategies

| Request type                                              | Strategy                                                                      | Notes                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CORE_ASSETS`                                             | Cache-first (pre-cached on install)                                           | Offline core                                                                                                                   |
| External API hosts (`metalpriceapi.com`, etc.)            | Network-first                                                                 | Must return live data                                                                                                          |
| CDN libraries (`cdnjs`, `jsdelivr`, `unpkg`)              | Stale-while-revalidate                                                        | Speed + freshness                                                                                                              |
| StakTrakr API (`api.staktrakr.com`, `api2.staktrakr.com`) | Classified — realtime families **network-first**, others cache-first-with-TTL | Per-family via `sw-router.js`; the three realtime price families flip network-first as of STRK-249 (v3.35.61); see table below |
| Spot-history seed data (`/data/spot-history-YYYY.json`)   | Classified cache-first-with-TTL                                               | Same classified path as API (STRK-79)                                                                                          |
| Local JS/CSS (`*.js`, `*.css`)                            | Network-first                                                                 | Always fresh when online                                                                                                       |
| Navigation (`navigate` mode)                              | Network-first                                                                 | Changed in v3.33.74 (STAK-485) — prevents stale HTML after restructured script tags                                            |
| OAuth callbacks                                           | Bypassed entirely                                                             | Auth flow must hit network                                                                                                     |

### Classified caching — `sw-router.js` (STRK-79)

`sw.js` delegates endpoint classification to `sw-router.js` (loaded via `importScripts`). For every request to `api.staktrakr.com`, `api2.staktrakr.com`, or the local `/data/spot-history-*` paths, `classifyEndpoint(url, selfOrigin)` returns a family descriptor `{ family, floor, hasEnvelope }` or `null` (falls through to stale-while-revalidate).

**FAMILY_TABLE** — first match wins, iterated in order:

| Family                 | Path pattern                                                                   | `floor` (TTL)   | `hasEnvelope` |
| ---------------------- | ------------------------------------------------------------------------------ | --------------- | ------------- |
| `manifest`             | `/v2/manifest.json`                                                            | 1800 s (30 min) | yes           |
| `spot-latest`          | `/v2/spot/latest.json`                                                         | 1200 s (20 min) | yes           |
| `spot-history-daily`   | `/v2/spot/{metal}/YYYY/MM/DD.json`                                             | 3600 s (1 h)    | yes           |
| `goldback-latest`      | `/v2/goldback/latest.json`                                                     | 7200 s (2 h)    | yes           |
| `goldback-intraday`    | `/v2/goldback/intraday.json`                                                   | 7200 s (2 h)    | yes           |
| `retail-latest`        | `/v2/retail/{slug}/latest.json`                                                | 1800 s (30 min) | yes           |
| `retail-intraday`      | `/v2/retail/{slug}/intraday.json`                                              | 1200 s (20 min) | yes           |
| `retail-history-short` | `/v2/retail/{slug}/history-7d.json`                                            | 3600 s (1 h)    | yes           |
| `retail-history-long`  | `/v2/retail/{slug}/history-{30d\|90d}.json`                                    | 86400 s (24 h)  | yes           |
| `providers`            | `/v2/providers.json`                                                           | 86400 s (24 h)  | yes           |
| `annual-spot-history`  | `/data/spot-history-YYYY.json` (local) or `/spot-history-YYYY.json` (API root) | 86400 s (24 h)  | no            |

**Network-first families:** four families carry a `networkFirst: true` descriptor flag in `FAMILY_TABLE` — the three realtime price families `spot-latest`, `goldback-latest`, and `retail-latest` (STRK-249, v3.35.61), **plus `providers`** (STRK-264, which carries its own rationale comment in `sw-router.js`). The flag propagates through `classifyEndpoint`'s descriptor. `classifiedFetch` branches on it: while online they **skip the cache-hit shortcut** and fetch network-first (`lastStrategy="network"`), serving the cached copy **only** on a network error (`lastStrategy="network-fallback"`). Their `floor` values above still bound the **offline-fallback** freshness, not an online cache-hit. The other (non-realtime) families keep cache-first-with-TTL. This reverses STRK-190's blanket cache-first for the realtime price families, restoring STRK-79's network-first intent for live pricing — the cache is retained purely as an offline fallback. (Companion app-level change: the `market-data.js` goldback-G1 and retail-detail fetches now fail over api1→api2 via `_marketV2Fetch` with a strict freshness gate capped at 2 h, so a stale SW-cached api1 `200` cannot short-circuit failover to api2.)

**Goldback intraday family (STRK-248, v3.35.62):** the `goldback-intraday` family above (exact-match `/v2/goldback/intraday.json`) is **cache-first-with-TTL**, not networkFirst — it mirrors `retail-intraday` in strategy but **not** in floor: its floor is **7200 s**, and `sw-router.js:56` carries a source comment noting the deliberate divergence from `retail-intraday`'s 1200. The response envelope also carries `stale_after: 7200`, which wins via the precedence rule below. The same release dropped the `goldback-latest` floor from 90000 s (25 h) to 7200 s (2 h), aligning the SW offline-fallback budget with the endpoint's new 2 h `stale_after`; `goldback-latest` stays networkFirst.

**Effective TTL precedence:** `envelope.stale_after ?? family.floor`

When `hasEnvelope: true`, the response body carries `generated_at` and `stale_after` fields. `fetchAndCacheClassified` parses these and writes them as `x-generated-at` / `x-stale-after` synthetic headers on the cached Response. `matchWithAgeCheck` uses the envelope value when present; `family.floor` is the fallback when the envelope field is absent.

**Age-gate header hierarchy** (used by `matchWithAgeCheck`):

```text
x-generated-at present?  → age = now/1000 - generated_at  (authoritative: publisher mint time)
    ↓ no
x-cached-at present?      → age = (now - cached_at) / 1000 (SW-side write time)
    ↓ no
Legacy entry (no headers) → treat as stale → force one cold network hit
```

**Strategy flow** (logged in `lastStrategy` for test instrumentation):

- Cache entry fresh (`age < ttl`) → `"cache-hit"` (serve from cache, no network call)
- Cache miss or stale → `"network"` (fetch, synthesize + write freshness headers, return)
- Network error (offline/timeout) + stale entry exists → `"network-fallback"` (serve stale)
- Network error + no cache entry → `Response.error()`
- **Network-first families** (`spot-latest`/`goldback-latest`/`retail-latest` from STRK-249, plus `providers` from STRK-264 — four in total): `classifiedFetch` skips the cache-hit check entirely — online → `"network"`, network error → `"network-fallback"` (cached copy). These families are **never** `"cache-hit"` while online.

**Unit tests:** `tests/unit/sw-router.test.js` covers every family in `FAMILY_TABLE` plus negative cases. Run: `npm run test:unit`. (Grep `FAMILY_TABLE` for the family count and read the test output for the test count — both have drifted from hard-coded values here before.)

**Integration tests:** `tests/playwright/extended/service-worker.spec.js` — SC-1–3 cover `annual-spot-history` (cache-first, unchanged); SC-4–9 cover the realtime families' network-first behavior (online → `network`, offline → `network-fallback`), rescoped/added by STRK-249. Run: `npm run test:extended`.

### DEV_MODE

`sw.js` has a compile-time bypass at the top:

```js
const DEV_MODE = false; // set true during dev — bypasses all caching
```

**Never commit `DEV_MODE = true`.** Reset it to `false` before every commit.

---

## Script Load Order

StakTrakr has no bundler. Script tags in `index.html` define execution order, and that order matters. `js/constants.js` loads first and defines all global constants and keys. `js/utils.js` loads early and defines `escapeHtml`, `saveData`, `loadData`, etc. `js/init.js` loads near the end and defines `safeGetElement` at line 42.

**Consequence:** Any code in files that execute before `js/init.js` cannot call `safeGetElement`. This is the root cause of the `about.js` exception described in the DOM section above.

**New file checklist:**

1. Add a `<script src="./js/your-file.js">` tag in `index.html` at the correct load-order position
2. Add `'./js/your-file.js'` to `CORE_ASSETS` in `sw.js` at the matching position
3. The pre-commit hook will auto-update `CACHE_NAME` on the next commit

---

## Release Process

### Version format

`BRANCH.RELEASE.PATCH` — defined as `APP_VERSION` in `js/constants.js`.

```text
3.33.87
│  │  └─ PATCH — incremented on every meaningful change via /release patch
│  └──── RELEASE — incremented when shipping a batch to main via /release release
└─────── BRANCH — rarely changes; major platform shifts only
```

Current version is always authoritative in `js/constants.js`. Check `devops/version.lock` for any in-flight claims before starting new work.

### 8 files touched by every version bump

| #   | File                       | What changes                       | How                                         |
| --- | -------------------------- | ---------------------------------- | ------------------------------------------- |
| 1   | `js/constants.js`          | `APP_VERSION` string               | Manual                                      |
| 2   | `sw.js`                    | `CACHE_NAME`                       | Auto — pre-commit hook                      |
| 3   | `CHANGELOG.md`             | New version section                | Manual                                      |
| 4   | `js/about.js`              | `getEmbeddedWhatsNew()`            | Manual                                      |
| 5   | `version.json`             | `version` + `releaseDate`          | Manual                                      |
| 6   | `package.json`             | `version` field                    | Manual                                      |
| 7   | `package-lock.json`        | `version` + `packages[""].version` | With `package.json` (not hook-validated)    |
| 8   | `data/spot-history-*.json` | New seed entries                   | Staged conditionally if poller has new data |

**Pre-commit enforcement:** `devops/hooks/check-release-sync.sh` fails the commit if `APP_VERSION` disagrees across files 1, 3, 5, 6, and 4 (`getEmbeddedWhatsNew` version entry).

**STAK-513:** `docs/announcements.md` is deprecated. `js/about.js` embedded functions are the single source of truth for What's New content.

### Version lock (`devops/version.lock`)

The lock prevents two concurrent agents from claiming the same version number. It is gitignored — edit directly, never commit.

```json
{
  "claims": [
    {
      "version": "3.33.87",
      "claimed_by": "claude / STAK-XXX description",
      "issue": "STAK-XXX",
      "claimed_at": "2026-04-15T10:00:00Z",
      "expires_at": "2026-04-15T10:30:00Z"
    }
  ]
}
```

Claim lifecycle: prune expired entries → find highest claimed version (fall back to `APP_VERSION` if none) → increment PATCH → append your claim → create worktree → work → remove your claim on cleanup.

### Worktree conventions

Every patch gets an isolated worktree. No edits happen in the main `dev` working directory.

```bash
# Created by /release patch after the lock is written
git worktree add .worktrees/patch-3.33.88 -b patch/3.33.88
```

Worktrees live at `.worktrees/patch-VERSION/` (gitignored). Remove after PR merges to `dev`.

### Commit message format

```text
vNEW_VERSION — STAK-XXX: Brief description
```

Em dash (`—`), not hyphen. Include the Linear issue ID. Example:

```text
v3.33.88 — STAK-400: Inventory filter persistence
```

### PR targets

- All patch PRs → `dev` (never `main` directly)
- `dev → main` only via `/ship`, triggered explicitly by the user

### Post-merge

After PR merges to `dev`: tag the merge commit, push the tag, remove the worktree, delete the branch, release the version lock claim.

After `dev → main` merge: create the GitHub Release immediately (`gh release create`) — without it, `version.json`'s `releaseUrl` resolves to a stale release.

### `/release patch` gate — hard gate, no exceptions

Before every `/release patch` run:

```bash
git fetch origin
git rev-list HEAD..origin/dev --count  # must be 0 before proceeding
git pull origin dev                    # if count > 0
```

A worktree created from a stale HEAD silently drops remote commits.

---

## Testing

StakTrakr uses a four-tier test architecture. Each tier has a budget, a purpose, and a maintenance policy. **The default PR gate is `npm run test:core` — not the full suite.** See .context/deep-dives/playwright-suite-rationalization.md for the full rationale.

### Tier model

| Tier                               | Location                              |    Budget | What belongs here                                                                                  |
| ---------------------------------- | ------------------------------------- | --------: | -------------------------------------------------------------------------------------------------- |
| **Smoke**                          | `tests/playwright/core/smoke.spec.js` |      8–15 | Boot, nav, modal open, no page errors, key panels visible                                          |
| **Core (PR gate)**                 | `tests/playwright/core/`              |     70–90 | User journeys, money/math, persistence, import/export, integrations                                |
| **Extended (nightly/pre-release)** | `tests/playwright/extended/`          |   100–180 | Service worker, cloud sync, attachment ZIP, provider edge cases, mobile, historical high-risk bugs |
| **Unit**                           | `tests/unit/`                         | unbounded | Pure logic: math, formatters, validators, schema, conversion, parsers, sw-router                   |
| **Archive**                        | `tests/playwright/archive/`           | reference | Old issue-prefixed acceptance matrices. Does not run by default.                                   |

**Hard budget rule:** if a tier exceeds its upper bound, the next test added requires a corresponding test removed or moved. No exceptions.

### New-feature destination policy

Before writing a new test, follow this decision tree:

1. **Does this need a browser?** If no → `tests/unit/` only.
2. **Is there an existing domain suite for this behavior?** (`inventory-crud`, `inventory-math`, `disposition`, `valuation`, `settings`, `numista-catalog`, `retail-market`, `attachments-cloud`, `mobile-and-layout`) — if yes → add cases there.
3. **Is the behavior a genuinely new product domain?** Only then → new spec file in `core/` or `extended/`.

**Forbidden:** creating an issue-prefixed spec file (`strk-NNN-*.spec.js`) for a feature that fits an existing domain suite. Temporary AC-matrix files during implementation are allowed but **must be reconciled into a domain suite before the PR merges**.

### File-naming rules

- Domain suite names are **purpose-named**, never issue-named: `inventory-math.spec.js`, not `strk-89-gold-api.spec.js`.
- A new file requires a one-line justification in the PR body: either "new product domain: X" or "split required because: Y".
- Files matching `^(stak|strk)-\d+-` are presumed archive candidates. Closing reviewer must confirm none added without justification.

### Mocking policy — zero external requests in default runs

All Playwright specs must hit zero external hosts. The shared mock layer lives at `tests/playwright/helpers/mocks/`:

| File               | What it provides                                                                   |
| ------------------ | ---------------------------------------------------------------------------------- |
| `extended-test.js` | Re-exported `{ test, expect }` — import this, **not** `@playwright/test`           |
| `routes.js`        | `installStakTrakrNetworkMocks(page, options)` for `browser.newPage()` suites       |
| `fixtures.js`      | Canonical v2 envelope response shapes (manifest, spot, retail, goldback, exchange) |
| `audit.js`         | Deny-list catch-all that fails any test leaking external requests                  |

**Required pattern (default):**

```js
import { test, expect } from "../helpers/mocks/extended-test.js";
// External mocks + audit installed automatically before each test
```

**Manual-page pattern** (only for `browser.newPage()` suites like `02-crud/crud.spec.js`):

```js
import { installStakTrakrNetworkMocks } from "../helpers/mocks/routes.js";
await installStakTrakrNetworkMocks(sharedPage);
await sharedPage.goto("/index.html");
```

**Deny-all mode** (for tests that intentionally prove no-network failure paths):

```js
await installStakTrakrNetworkMocks(page, { mode: "deny-all" });
```

Per-spec `page.route()` overrides register **after** the shared installer and win by LIFO precedence. Reference: STRK-78 sketch archive.

### Test maintenance protocol

Every PR that touches `tests/playwright/` must do exactly one of:

- **Add** a test to an existing domain suite (no file count change)
- **Move** a test between tiers (smoke ↔ core ↔ extended ↔ archive)
- **Delete** a test with a one-line rationale in the PR body
- **Create a new file** with the required justification line in the PR body

The release PR's closing tasks include a "test inventory delta" line: `+N -M tests, +X -Y files` matched against the budget.

### Deprecation workflow — two-step archive

A test becomes deprecation-eligible when **any** of these is true:

1. Its issue has been closed/merged for more than two releases AND the behavior is covered elsewhere
2. It asserts static content unrelated to user risk (about-page copy, footer year, version string)
3. It exists only because of an old AC matrix and duplicates a domain-suite assertion
4. It is flaky **and** the underlying behavior has no real-money/data-loss impact (move to `extended/` or delete)

Deprecation steps:

1. Verify durable assertions are covered in the appropriate domain suite (grep + manual coverage map).
2. Move the file to `tests/playwright/archive/issue-ac-matrices/` in **one PR** (no other changes).
3. After one release with no regressions traced to the archived assertions, delete in a second PR.

**Never delete in one step.** The archive tier is the rollback path.

### Test commands

```bash
npm test                    # → test:core (default PR gate)
npm run test:core           # tests/playwright/core/
npm run test:extended       # tests/playwright/extended/
npm run test:unit           # tests/unit/
npm run test:all            # unit + core + extended (pre-release)
npm run test:offline        # legacy; removed after @network tags retire
```

### Pre-existing flaky categories — do not fix in unrelated work

The hard 10-min suite timeout applies. These categories are flagged in CLAUDE.md and require their own session, not opportunistic fixes inside another PR:

- `goldback-type`
- `lot-each-purchase-price`
- `numista-picker-tags`

### Exposing internal functions for testing

Module-scope functions are not accessible via `page.evaluate()`. Expose them in the `window` assignment block at the bottom of the owning `js/*.js` file:

```js
// At the bottom of js/myModule.js — inside the window assignment block
window.myInternalFn = myInternalFn;
```

For `let`-declared state variables that tests need via `window.X`, follow `state.js`'s `Object.defineProperty` getter/setter pattern — `let` variables are not on `window` by default. Reference: `inventory` and `changeLog` in `js/state.js`.

### Injecting state via localStorage

Patching `window.X` after page load does NOT intercept module-scope reads. For initial state, use `page.addInitScript`:

```js
await page.addInitScript(() => {
  localStorage.setItem('retailManifestSlugs', JSON.stringify([...]));
});
```

Reference: `_manifestSlugs` / `_manifestCoinMeta` hydrate from `retailManifestSlugs` / `retailManifestCoinMeta` during init.

### Custom dialog testing — `showAppConfirm` is NOT `window.confirm`

`showAppConfirm`, `showAppAlert`, `showAppPrompt` are custom DOM modals (`#appDialogModal`), **not** native `window.confirm`. `page.on("dialog", ...)` does not intercept them. Pattern:

1. Fire-and-forget the async function via `page.evaluate`
2. `await page.waitForSelector("#appDialogModal", { state: "visible" })`
3. Click `#appDialogOk` or `#appDialogCancel`

### Browserbase — live-site flows

For end-to-end flows against the live site, use Browserbase. API keys for third-party providers (Numista, PCGS, etc.) must be fetched from Infisical before running — never skip a test because "no API key is configured"; check Infisical first.

---

## Commit Signing

All commits must be signed. Unsigned commits are rejected by branch protection. This is enforced repo-wide following INC-001. Do not use `--no-verify`, `--no-gpg-sign`, or `-c commit.gpgsign=false` unless the user explicitly requests it.

SSH signing is the configured method. If a commit fails signature validation, verify the SSH key is loaded (`ssh-add -l`) before attempting workarounds.

---

## Error Handling

### Storage and API operations

Wrap all `localStorage` and `fetch` calls in `try/catch`:

```js
try {
  const data = await loadData(LS_KEY, []);
  // ... use data
} catch (error) {
  console.error("[inventory] Failed to load data:", error);
  inventory = [];
}
```

### User-facing errors

Use `handleError(error, context)` from `utils.js` for errors that need user notification:

```js
handleError(error, "CSV import");
```

### Console logging

Use contextual prefixes for all console output:

```js
console.error("[api] Fetch failed for silver:", error);
console.warn("[inventory] Missing weight field, defaulting to 1oz");
console.log("[spot] Cache hit for gold, age: 2h");
```

### Debug logging

Use `debugLog()` for development tracing that should be silent in production:

```js
debugLog("Rendering table with", inventory.length, "items");
// Only outputs when DEBUG === true (set via DEV_MODE or ?debug URL param)
```

### Fallback defaults

Always provide sensible defaults rather than crashing:

```js
const price = parseFloat(item.price) || 0;
const weight = item.weight || 1;
```

**Never** swallow errors silently — `catch (e) {}` with no logging or fallback is always wrong.

---

## API Integration

### Provider fallback chain

The pricing API uses a ranked provider list. If the primary fails, the system falls through to backups:

```js
for (const provider of orderedProviders) {
  try {
    const result = await fetchFromProvider(provider);
    if (result) return result;
  } catch (error) {
    console.warn(`[api] ${provider.name} failed, trying next:`, error.message);
  }
}
```

### Caching

API responses are cached with TTL per provider (default: 24 hours). Always check the cache before making a network request. Cache keys and timestamps are stored in localStorage via the standard wrappers.

### Error recovery

API errors must be:

1. **Logged** with provider name and context
2. **Recovered** via fallback provider or cached data
3. **Never silent** — if all providers fail, notify the user

### Async style

Use `async/await` for all asynchronous operations. Never use `.then()` chains:

```js
// Correct
const response = await fetch(url);
const data = await response.json();

// Wrong — don't mix callback style
fetch(url)
  .then((res) => res.json())
  .then((data) => {
    /* ... */
  });
```

---

## Library-Specific Standards

### Chart.js

- **Destroy before reuse**: call `.destroy()` on an existing chart instance before creating a new one on the same canvas — failing to destroy causes memory leaks and ghost overlays
- **Disable animations** on programmatic updates (when the user didn't trigger the render)
- **Store instances** in the `chartInstances` or `sparklineInstances` objects in `state.js`
- **`getThemeColorRGB(token)`** — always use this for Chart.js dataset colors, never `getThemeColor()`. Chart.js cannot parse `oklch()` or `color-mix()` strings and renders invisible/black. `getThemeColorRGB` resolves the token to `rgb(...)` via a 1×1 canvas bridge (`resolveColor()`).

```js
if (chartInstances.typeChart) {
  chartInstances.typeChart.destroy();
}
chartInstances.typeChart = new Chart(canvas, config);
```

### Bootstrap 5

> **Current state (verified 2026-08-13).** StakTrakr was built on this foundation and has
> since evolved off it. The **Bootstrap JS library is not loaded** — no `vendor/bootstrap*`,
> no CDN tag in `index.html`, zero `data-bs-*` attributes, and no `bootstrap` global. What
> survives is a handful of vestigial class names (`form-control` ×5, `input-group` ×3,
> `btn-primary` ×2, `form-select` ×2), now styled by `css/styles.css`.
>
> The guidance below is therefore **historical**: the JS API calls cannot run today. For
> modals, use `openModalById()` / `closeModalById()` and the `.modal-close` selector — see
> §Modal System in `.context/reusable-patterns.md`. This section is retained deliberately
> rather than deleted, because the CSS lineage still explains much of the markup.

- **`getOrCreateInstance()`** instead of `new bootstrap.Modal()` — prevents duplicate instance errors
- **Dispose after `hidden.bs.*` event** when modals are dynamically created
- **Never mix jQuery and Bootstrap 5** — the app uses vanilla Bootstrap only
- **Use `data-bs-*` attributes** for declarative behavior, JavaScript API for programmatic control

### PapaParse (CSV)

- **Always check `results.errors`** after parsing — PapaParse can return partial data with errors
- **Use `skipEmptyLines: 'greedy'`** to handle trailing newlines and whitespace-only rows
- **Two-tier validation**: PapaParse structural errors first, then business logic validation on each row

### jsPDF + AutoTable

- **Use AutoTable for all tabular exports** — never manually position text for table layouts
- **Optimize images before embedding** — large base64 images bloat PDF size
- **Set page orientation** based on column count (portrait for narrow tables, landscape for wide)

### JSZip

- **`generateAsync({type: "blob"})`** for browser downloads — never use synchronous generation
- **Use `file()` method** for adding entries, not direct property assignment

---

## CSS & Design System

### Living reference

Open `ui-standards/style.html` in a browser to see all components rendered with CSS variable labels. It references the same `css/styles.css` the app uses and is the single source of truth for visual patterns.

### Token usage (mandatory)

**Never hardcode colors, spacing, or border-radius.** Always use CSS custom properties:

```css
/* Correct */
color: var(--text-primary);
background: var(--bg-card);
border-radius: var(--radius);
padding: var(--spacing);

/* Wrong — hardcoded values bypass theming */
color: #1b232c;
background: #ffffff;
border-radius: 8px;
padding: 0.75rem;
```

### Toggle standard

**Always use `.chip-sort-toggle`** for boolean On/Off settings. Never use iOS-style switches or raw checkboxes for settings toggles:

```html
<div class="chip-sort-toggle" id="myToggle">
  <button type="button" class="chip-sort-btn" data-val="yes">On</button>
  <button type="button" class="chip-sort-btn" data-val="no">Off</button>
</div>
```

Wire with `wireStorageToggle(elementId, storageKey, opts)` for raw localStorage keys, or `wireFeatureFlagToggle(elementId, flagName, opts)` for feature flags.

**Exception**: Checkbox lists where many items appear in a compact list (e.g., Numista view field toggles) may use `.settings-checkbox-label` with raw checkboxes.

### Button variants

All buttons use the `.btn` base class with an optional modifier:

| Class            | Purpose                | Background token |
| ---------------- | ---------------------- | ---------------- |
| `.btn`           | Primary action         | `--primary`      |
| `.btn.secondary` | Secondary / cancel     | `--secondary`    |
| `.btn.success`   | Positive confirmation  | `--success`      |
| `.btn.danger`    | Destructive action     | `--danger`       |
| `.btn.warning`   | Caution                | `--warning`      |
| `.btn.info`      | Informational          | `--info`         |
| `.btn.premium`   | Premium / paid feature | `--warning`      |
| `.btn.btn-sm`    | Small variant          | (same as parent) |

### Settings group pattern

Related settings wrap in a `.settings-fieldset` card with a `.settings-fieldset-title` header:

```html
<div class="settings-fieldset">
  <div class="settings-fieldset-title">Group Name</div>
  <div class="settings-group">
    <div class="settings-group-label">Setting label</div>
    <p class="settings-subtext">Help text.</p>
    <!-- toggle or input here -->
  </div>
</div>
```

### Modal structure

Standard modal pattern — glass-morphism shell with gradient top accent:

```html
<div class="modal-overlay" id="myModal">
  <div class="modal-content">
    <div
      style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border);"
    >
      <h2>Title</h2>
      <button class="btn btn-sm secondary" id="myCloseBtn">&times;</button>
    </div>
    <div>...</div>
    <div
      style="display:flex; justify-content:flex-end; gap:0.5rem; padding-top:0.75rem; border-top:1px solid var(--border);"
    >
      <button class="btn secondary btn-sm">Cancel</button>
      <button class="btn btn-sm">Save</button>
    </div>
  </div>
</div>
```

### Theme compatibility

All new CSS **must** work across light, dark, slate, and sepia themes. Use semantic tokens (`--text-primary`, `--bg-card`, etc.) which automatically adapt per theme. Test all four themes when adding new UI.

### Key CSS custom properties

| Category    | Tokens                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Colors      | `--primary`, `--secondary`, `--success`, `--info`, `--warning`, `--danger` + `-hover` variants |
| Backgrounds | `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-card`                                 |
| Text        | `--text-primary`, `--text-secondary`                                                           |
| Metals      | `--silver`, `--gold`, `--platinum`, `--palladium`                                              |
| Types       | `--type-{coin,round,bar,note,set,other}-{bg,text}`                                             |
| Borders     | `--border`, `--border-hover`                                                                   |
| Shadows     | `--shadow-sm`, `--shadow`, `--shadow-lg`                                                       |
| Spacing     | `--spacing-xs`, `--spacing-sm`, `--spacing`, `--spacing-lg`, `--spacing-xl`                    |
| Radius      | `--radius` (8px), `--radius-lg` (12px)                                                         |
| Transition  | `--transition`                                                                                 |

---

## Common Mistakes Quick Reference

| Mistake                                                  | Consequence                                                                                                                  | Fix                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `document.getElementById()` in app code                  | Crashes on `null.textContent`                                                                                                | Use `safeGetElement()`                                                                                                 |
| `safeGetElement()` for existence check                   | Dummy is truthy — toggle logic breaks                                                                                        | Use `document.getElementById()` + `if`                                                                                 |
| `safeGetElement()` in `about.js` early-init              | `ReferenceError` — not yet defined                                                                                           | Use `document.getElementById()` + `if`                                                                                 |
| Unsanitized user content in innerHTML assignment         | XSS via crafted item name                                                                                                    | Wrap user strings in `sanitizeHtml()` first                                                                            |
| `sanitizeHtml()` on static developer HTML                | Double-encodes intentional markup                                                                                            | Do not sanitize static strings                                                                                         |
| `localStorage.setItem()` for JSON data                   | Bypasses compression; key wiped by `cleanupStorage`                                                                          | Use `saveData` / `saveDataSync`                                                                                        |
| `localStorage.getItem()` on compressed key               | Returns corrupt `CMP2:...` string                                                                                            | Use `loadData` / `loadDataSync`                                                                                        |
| New key not in `ALLOWED_STORAGE_KEYS`                    | Silently deleted on next startup                                                                                             | Add to allowlist before first write                                                                                    |
| `loadData(key)` without explicit default for non-array   | Returns `[]` instead of correct type                                                                                         | Always pass explicit `defaultValue`                                                                                    |
| Editing `CACHE_NAME` manually                            | Pre-commit hook overwrites it                                                                                                | Do not touch — hook owns this line                                                                                     |
| New JS file in `index.html` but not `CORE_ASSETS`        | Missing offline; stale-serve bug                                                                                             | Add to both, in matching order                                                                                         |
| Editing code in main `dev` directory                     | Bypasses worktree isolation                                                                                                  | Always work inside `.worktrees/patch-VERSION/`                                                                         |
| Skipping remote sync gate before `/release patch`        | Stale worktree base; drops remote commits                                                                                    | `git pull origin dev` first                                                                                            |
| `dev → main` PR without explicit user request            | Ships unreviewed code                                                                                                        | Only via `/ship`, on explicit "ready to ship"                                                                          |
| Missing GitHub Release post-merge                        | `version.json` `releaseUrl` resolves to stale release                                                                        | `gh release create` immediately after merge                                                                            |
| `getThemeColor()` for Chart.js datasets                  | Chart.js cannot parse oklch or `color-mix()` strings — renders invisible/black                                               | Use `getThemeColorRGB(token)` which resolves to `rgb(...)` via a 1x1 canvas bridge (`resolveColor()`)                  |
| `structuredClone` without regenerating `uuid` + `serial` | Clone shares identity with original — diff/sync engine produces duplicate-key errors; Activity Log undo targets wrong record | After clone: `clone.uuid = generateUUID(); clone.serial = getNextSerial();` — both fields are mandatory                |
| Async confirm handler without in-flight guard            | Double-click fires handler twice — inventory mutates twice, Activity Log gets duplicate entries                              | Wrap with `let _inFlight = false` + `try/finally` reset; for shared resources use `new Set()` keyed by `transactionId` |
| `var x = ...`                                            | Leaks scope, hoists unpredictably                                                                                            | `const x = ...` or `let x = ...`                                                                                       |
| `==` or `!=` (non-null checks)                           | Type coercion produces surprising results                                                                                    | `===` / `!==` everywhere; use `== null` only for nullish checks                                                        |
| `.then().catch()` chains                                 | Hard to read; error handling gaps                                                                                            | `async/await` with `try/catch`                                                                                         |
| `element.className = "..."`                              | Overwrites all existing classes                                                                                              | `element.classList.add/remove/toggle()`                                                                                |
| `new bootstrap.Modal(el)`                                | Duplicate instance errors on re-open                                                                                         | `bootstrap.Modal.getOrCreateInstance(el)`                                                                              |
| Nested ternaries (3+ levels)                             | Unreadable, error-prone                                                                                                      | `if/else` or extract a named helper                                                                                    |
| Magic numbers in logic                                   | Context-free, breaks on next change                                                                                          | Named constant in `constants.js`                                                                                       |
| `catch (e) {}` with no logging                           | Silent failure, impossible to debug                                                                                          | Log with `[module]` prefix + apply fallback                                                                            |
| DOM query inside a loop                                  | Repeated layout thrash                                                                                                       | Cache element reference before the loop                                                                                |
| Hardcoded localStorage key string                        | Key drift → allowlist mismatch → data loss                                                                                   | Named constant from `constants.js`                                                                                     |

---

## Related

- .context/deep-dives/dom-patterns.md— full API reference with all edge cases
- Storage Patterns (deprecated DocVault page) — full key registry and migration patterns
- Service Worker (deprecated DocVault page) — CORE_ASSETS list, cache strategy table, hook internals
- Release Workflow (deprecated DocVault page) — full `/release patch` and `/ship` procedures
- Frontend Overview (deprecated DocVault page) — overall JS architecture and file load order
