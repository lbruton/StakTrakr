---
sketch: "STRK-74-align-inline-chip-config-save-data"
phase: discovery
created: 2026-05-22
---

# STRK-74 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

_Files and modules already in the project that this work will touch or build on. Include paths and a one-line note on each._

### Primary targets (will be modified)

| Path | Role | Notes |
|------|------|-------|
| `js/constants.js:1136-1157` | `getInlineChipConfig()` | Reads via raw `localStorage.getItem("inlineChipConfig")` + `JSON.parse()`. Merge-with-defaults logic at lines 1142–1151 appends missing `INLINE_CHIP_DEFAULTS` entries to preserved user order. |
| `js/constants.js:1163-1170` | `saveInlineChipConfig(config)` | Writes via raw `localStorage.setItem("inlineChipConfig", JSON.stringify(config))`. Calls `scheduleSyncPush()` afterward. Wrapped in try/catch that swallows to `console.warn`. |

### Storage wrappers (will be called, not modified)

| Path | Role | Notes |
|------|------|-------|
| `js/utils.js:1160-1186` | `saveData(key, data, options)` | **Async.** Applies `__compressIfNeeded`, catches `QuotaExceededError` with toast. Does NOT call `scheduleSyncPush`. Sets `cloud_sync_local_modified` only for `metalInventory` key. |
| `js/utils.js:1207-1227` | `saveDataSync(key, data, options)` | **Synchronous.** Same `__compressIfNeeded` path but **re-throws** after toasting on `QuotaExceededError`. |
| `js/utils.js:1228-1237` | `loadDataSync(key, defaultValue)` | **Synchronous.** Applies `__decompressIfNeeded`. Returns `defaultValue` on missing key or parse error. |
| `js/utils.js:3229-3237` | `__compressIfNeeded(str)` | Only compresses strings ≥ 4096 chars via LZString. Adds `CMP1:` prefix. |
| `js/utils.js:3238-3249` | `__decompressIfNeeded(stored)` | No-op for non-`CMP1:` strings. Safe for existing plain JSON values. |

### Sibling config savers (same raw pattern — context, not targets)

| Path | Role | Notes |
|------|------|-------|
| `js/constants.js:1227-1234` | `saveFilterChipCategoryConfig(config)` | Raw `setItem` + `scheduleSyncPush()`. Same pattern as `saveInlineChipConfig`. |
| `js/constants.js:1308-1314` | `_saveSectionConfig(key, config)` | Generic raw `setItem`. Used by layout, view-modal, and market-history configs. No `scheduleSyncPush`. |

### Backup / restore / cloud sync paths (read-only for this sketch)

| Path | Role | Notes |
|------|------|-------|
| `js/inventory-backup.js:82` | Backup export | Reads `inlineChipConfig` via raw `localStorage.getItem`. Returns the raw stored string into the backup JSON object. Once normal writes move through `saveDataSync`, this export path becomes the only documented bypass of the wrapper for this structured JSON key. The exported format contract is "stored-string JSON" — approach must define how future compression is prevented or handled. |
| `js/inventory-backup.js:425-426` | Backup import prep | Passes `settingsObj.inlineChipConfig` into `remoteSettings` for DiffEngine comparison. |
| `js/inventory-backup.js:500-506` | DiffEngine comparison | Reads local values via `loadDataSync(key, null)` for comparison against `remoteSettings`. |
| `js/inventory-import.js:179-197` | Restore write-back | `inlineChipConfig` is in the `_rawKeys` Set (line 189) — restore writes via `localStorage.setItem(key, String(val))`, bypassing `saveDataSync`. |
| `js/inventory-import.js:1497` | Sync settings fallback list | `inlineChipConfig` in the hardcoded fallback when `SYNC_SCOPE_KEYS` is unavailable. Read via `loadDataSync` at line 1504. |
| `js/diff-modal.js:63` | DiffModal settings groups | `inlineChipConfig` listed under "Filters & Chips" category for the settings diff UI. |

### Constants / config lists

| Path | Role | Notes |
|------|------|-------|
| `js/constants.js:870` | `SYNC_SCOPE_KEYS` | `inlineChipConfig` is sync-scoped — eligible for cloud sync push/pull. |
| `js/constants.js:959` | `ALLOWED_STORAGE_KEYS` | `inlineChipConfig` is allowlisted — survives `cleanUnknownKeys()`. |
| `js/constants.js:1118-1129` | `INLINE_CHIP_DEFAULTS` | 10 entries including `attachment`. Determines merge-with-defaults shape. |

### Callers

| Path | Role | Notes |
|------|------|-------|
| `js/settings.js:2065-2073` | `renderInlineChipConfigTable()` | Passes `saveInlineChipConfig` as `opts.saveConfig` to `_renderSectionConfigTable`. |
| `js/settings.js:2641` | Toggle checkbox handler | Calls `opts.saveConfig(cfg)` (= `saveInlineChipConfig`) without `await`. Fire-and-forget. |
| `js/settings.js:2671` | Reorder button handler | Same fire-and-forget call to `opts.saveConfig(cfg)`. |
| `js/inventory-table.js:416` | Table row rendering | Calls `getInlineChipConfig()` to determine which inline chips to render per row. In the blast radius if read behavior changes (error return shape, timing). |
| `tests/playwright/03-settings/04-inline-chip-attachment.spec.js:127,155,321` | Playwright test helpers | Call `window.saveInlineChipConfig(config)` directly via `page.evaluate()` — not through `_renderSectionConfigTable`. Fire-and-forget without `await`. If `saveInlineChipConfig` becomes async, the unawaited promise may resolve after subsequent page interactions, creating test flake risk. |
| `js/constants.js:1939-1941` | Window globals | `getInlineChipConfig`, `saveInlineChipConfig`, `INLINE_CHIP_DEFAULTS` exposed on `window`. |

### Test coverage

| Path | Role | Notes |
|------|------|-------|
| `tests/playwright/03-settings/04-inline-chip-attachment.spec.js` | Primary test file (346 lines) | Tests inline chip UI, attachment chip merge behavior, enable/disable, reorder, card-view independence. |
| `tests/playwright/03-settings/04-inline-chip-attachment.spec.js:289` | Test seed | Seeds state via raw `localStorage.setItem("inlineChipConfig", JSON.stringify(cfg))`. Safe because `loadDataSync` transparently handles uncompressed JSON strings. Approach should decide whether to update seeds to `saveDataSync` for architectural consistency or document why raw seeding is acceptable. |
| `tests/playwright/03-settings/03-appearance.spec.js:121-131` | Appearance test | Verifies `#inlineChipConfigContainer` is visible in layout fieldset. No state seeding. |
| `tests/fixtures/settings-diff-test.json:73` | Test fixture | Contains a serialized `inlineChipConfig` JSON string (8 chips, ~450 bytes). Used by DiffEngine tests. |

## Prior Decisions

_Search mem0 and recent sessions for related decisions._

- 2026-05-22 — STRK-71 (inline chip attachment feature) shipped. During implementation, the raw `setItem` pattern was observed but deferred to a follow-up issue (this one, STRK-74). The `saveData`/`loadDataSync` wrappers were available at that time but not adopted for this key.
- The `saveData`/`saveDataSync`/`loadDataSync` compression wrappers were introduced as part of the storage middleware initiative. They apply LZString compression for values ≥ 4096 chars and handle quota errors gracefully. The `inlineChipConfig` value (~450 bytes for 10 chips) doesn't hit the compression threshold today, but the architectural consistency is the point.
- No prior sessions or mem0 memories found discussing `inlineChipConfig` storage alignment specifically.

## External References

_Libraries, RFCs, design docs, third-party patterns worth borrowing from._

- `DocVault/Projects/StakTrakr/Foundation/coding-standards.md` — defines `saveData`/`loadDataSync` as the project-standard storage wrappers. The raw `setItem` pattern is legacy.
- No external libraries or RFCs are relevant. This is a purely internal consistency change within StakTrakr's storage abstraction layer.

## Constraints

_Things the implementation must respect: existing APIs, performance budgets, browser support, data shapes._

- **C-1: Fire-and-forget callers (all paths).** `_renderSectionConfigTable` calls `opts.saveConfig(cfg)` without `await` (settings.js lines 2641, 2671). Playwright tests at `04-inline-chip-attachment.spec.js:127,155,321` call `window.saveInlineChipConfig(config)` directly via `page.evaluate()`, also fire-and-forget. If `saveInlineChipConfig` becomes async (wrapping `saveData`), settings.js callers are fine — the promise silently resolves. But Playwright test callers would not `await` the save, potentially racing with subsequent page interactions (test flake risk). Using `saveDataSync` preserves the synchronous contract for all callers.
- **C-2: Error swallowing must be preserved.** Current `saveInlineChipConfig` catches all errors to `console.warn`. A thrown `QuotaExceededError` from `saveDataSync` (which re-throws after toasting) would propagate uncaught into `_renderSectionConfigTable`'s checkbox/button handlers — breaking the settings UI. `saveData` (async) catches and toasts without throwing. This is a key design decision for the approach phase.
- **C-3: `scheduleSyncPush()` must remain explicit.** Neither `saveData` nor `saveDataSync` calls `scheduleSyncPush`. The current explicit call after save must be preserved.
- **C-4: Read/write compression coupling.** If write goes through `saveDataSync`/`saveData` (which applies `__compressIfNeeded`), the read MUST go through `loadDataSync` (which applies `__decompressIfNeeded`). A raw `getItem` + `JSON.parse` would fail on compressed data. This is architectural — even though compression doesn't trigger for today's 10-entry value (< 4096 chars), the coupling must be correct.
- **C-5: Merge-with-defaults must compose on top of `loadDataSync`.** `loadDataSync` returns the raw parsed value (or `defaultValue`). The existing merge logic (filter to known IDs + append missing defaults) must be layered on top, not duplicated or lost. The `loadDataSync` default value parameter must be `INLINE_CHIP_DEFAULTS.map((d) => ({ ...d }))` (the full defaults array), not `[]` (which is `loadDataSync`'s parameter default at `utils.js:1228`). Approach must get this right — using the wrong default would change error-recovery behavior.
- **C-6: Backup export format contract.** `inventory-backup.js:82` reads via `localStorage.getItem("inlineChipConfig")` and puts the raw string into the backup JSON. The exported format contract is "stored-string JSON" — the backup always contains the raw localStorage string. Today this is plain JSON (value < 4096 chars, no compression). If the value ever crosses the 4096-char threshold, the export path would emit a `CMP1:` blob unless approach defines a no-compression contract or normalizes the export. The coding standard (`coding-standards.md:296-302`) warns that raw reads of compressed wrapper data are unusable without decompression. Approach must explicitly define whether compression is permanently prevented for this key or whether the export path needs a decompression wrapper.
- **C-7: Restore write-back — `_rawKeys` is a permanent fixture.** `inventory-import.js:189` classifies `inlineChipConfig` as a `_rawKeys` member and restores via `localStorage.setItem(key, String(val))`, bypassing `saveDataSync`. This classification is an intentional permanent design fixture, not stale cruft. If `_rawKeys` classification is ever removed without updating the export path, the restore flow would write raw uncompressed data while normal writes produce compressed data — creating a format mismatch. `loadDataSync` handles both formats, but the churn and asymmetry signal architectural drift.
- **C-8: Test seed uses raw `setItem`.** `04-inline-chip-attachment.spec.js:289` seeds via `localStorage.setItem("inlineChipConfig", JSON.stringify(cfg))`. Since `loadDataSync` handles non-compressed strings (passes through `__decompressIfNeeded` unchanged), this seed remains valid. The approach phase should decide whether to update seeds to `saveDataSync` for architectural consistency or document why raw seeding is acceptable.
- **C-9: Window globals.** Both functions are exposed on `window` (constants.js:1939-1941). Tests and other modules may call them via `window.saveInlineChipConfig` / `window.getInlineChipConfig`. The function signatures must not change incompatibly.
- **C-10: DiffEngine type mismatch (pre-existing).** `DiffEngine._settingsValuesEqual` (diff-engine.js:139) returns `false` when comparing a parsed array (local, via `loadDataSync`) against a raw JSON string (remote, via backup import). This causes backup imports to always flag `inlineChipConfig` as changed. This bug is pre-existing — it exists regardless of whether `saveInlineChipConfig` uses raw `setItem` or `saveDataSync`. This sketch must not make it worse but need not fix it. The approach phase should note this as out-of-scope.
- **C-11: Script load order.** `constants.js` (index.html:8484) loads before `utils.js` (index.html:8487), both `defer`. Wrapper calls (`loadDataSync`/`saveDataSync`) must stay inside functions invoked after page load, not in top-level `constants.js` initialization. Current code is safe — both `getInlineChipConfig` and `saveInlineChipConfig` are function bodies, not top-level calls — but approach must not introduce any top-level wrapper invocation.

## Open Questions

_Things that need answering before approach.md can be written. If non-empty, stop here and resolve with the user._

None. The requirements phase and reconciliation resolved all blocking questions. The key design decision (async `saveData` vs sync `saveDataSync`) is deferred to the approach phase as intended.

## Discovery Summary

The change touches two functions in `js/constants.js` — `saveInlineChipConfig` (8 lines) and `getInlineChipConfig` (22 lines). Both currently use raw `localStorage` calls and need to migrate to the project-standard storage wrappers. The key constraints the approach phase must resolve:

- **Synchronous caller contract:** Settings handlers (fire-and-forget) and Playwright tests (direct `window.saveInlineChipConfig` calls without `await`) all depend on synchronous behavior. Using async `saveData` introduces test flake risk; using sync `saveDataSync` preserves the contract but re-throws quota errors that callers don't catch.
- **Error handling:** Current code swallows all errors to `console.warn`. `saveDataSync` re-throws `QuotaExceededError` after toasting. The approach must decide how to preserve the swallowing behavior.
- **Explicit `scheduleSyncPush`:** Neither wrapper calls it — the explicit call must remain.
- **`loadDataSync` default value:** Must be `INLINE_CHIP_DEFAULTS.map((d) => ({ ...d }))`, not `[]`.
- **Backup/export format contract:** Export reads raw `getItem`; restore writes raw `setItem` via `_rawKeys`. Both are permanent fixtures. Compression doesn't trigger for today's 10-entry value (< 4096 chars), but this is a current-state observation, not a durable invariant. Approach must define the contract.
- **Script load order:** `constants.js` loads before `utils.js` — wrapper calls must stay inside function bodies.
- **DiffEngine type mismatch:** Pre-existing array-vs-string comparison bug. Out of scope but must not worsen.

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-74`.

## Review Archive — discovery (2026-05-22)

_Reconciled by /sketch reconcile on 2026-05-22. Original reviewer marks preserved below for audit._

### Gemini

#### Inline Marks

1. (Storage wrappers table) Callers of `saveInlineChipConfig` (specifically `_renderSectionConfigTable`'s handlers in `settings.js`) are synchronous fire-and-forget and do not wrap the save call in a try/catch. Thus, if `saveInlineChipConfig` shifts to using `saveDataSync`, it must explicitly catch and handle `QuotaExceededError` to preserve the current error-swallowing behavior and avoid uncaught exceptions breaking the settings page UI.

2. (DiffEngine comparison row) Storing `inlineChipConfig` as a raw string key in `_rawKeys` during import restore is technically correct since it is stringified JSON in localStorage. However, `DiffEngine.compareSettings` compares `localSettings` (loaded via `loadDataSync` which JSON-parses it into an array) against `remoteSettings` (loaded from backup `settings.json` which yields a raw string). This type mismatch causes `DiffEngine.compareSettings` to always report `inlineChipConfig` as changed during backup imports. The approach phase should address this type discrepancy.

3. (Test seed row) Seeding with raw `setItem` is safe because `loadDataSync` transparently handles uncompressed JSON strings. However, updating the test seeds to use standard storage wrappers where possible will ensure architectural consistency.

#### Review Section

**Verified**
I have verified the following code paths and details in the active codebase:
- `js/constants.js` lines 1136-1170: Checked functions `getInlineChipConfig` and `saveInlineChipConfig`. The merge-with-defaults logic correctly layers on top.
- `js/utils.js` lines 1160-1237 and 3229-3249: Confirmed wrapper behaviors (`saveData`, `saveDataSync`, `loadDataSync`) and the threshold logic for compression/decompression.
- `js/inventory-import.js` lines 179-197 and 1497: Verified write-back behavior and the fallback list.
- `js/inventory-backup.js` lines 82, 425-426, and 500-506: Verified the backup export and diff-engine comparison setup.
- `tests/playwright/03-settings/04-inline-chip-attachment.spec.js` line 289: Confirmed seeding mechanism works correctly with raw strings.

**Top Concerns**
1. **Error Propagation & UI Crashing**: Caller handlers in `js/settings.js` do not handle exceptions when calling `saveInlineChipConfig`. Since `saveDataSync` propagates `QuotaExceededError` upwards, wrapping the synchronous write inside `saveInlineChipConfig` with an explicit try/catch block is required to prevent settings UI crashes.
2. **Type Mismatch in DiffEngine**: `DiffEngine.compareSettings` compares local parsed settings (which are arrays for `inlineChipConfig`) against remote imported settings (which are stored as raw JSON strings in `settings.json` and restored via `_rawKeys`). This creates a type mismatch (Array vs String), causing backup imports to always flag `inlineChipConfig` as changed.
3. **Consistency of Backup/Restore**: While `inlineChipConfig` is technically a JSON array, the restore flow in `inventory-import.js` writes it back using raw `localStorage.setItem` because it is listed in `_rawKeys`. The approach phase should document this design or align it.

**Unverified Assumptions**
- **Playwright Test Runner Quota Behavior**: We assume that browser-based quota exceptions will not be randomly triggered during standard settings integration tests.
- **Decompression Fallback Robustness**: We assume that no edge cases in older backups contain values that could throw parsing errors during `loadDataSync` decompression checks.

### OpenCode

#### Inline Marks

1. (Callers table) **Missing caller.** `js/inventory-table.js:416` calls `getInlineChipConfig()` to determine which inline chips to render per row. The discovery caller table should include this path — if the read changes behavior (error return shape, timing), table rendering is in the blast radius.

2. (Callers table) **Missing callers.** Playwright tests call `window.saveInlineChipConfig(config)` directly at lines 127, 155, and 321 of `04-inline-chip-attachment.spec.js`. These are sync fire-and-forget calls that bypass `_renderSectionConfigTable`. If `saveInlineChipConfig` becomes `async` (wrapping `saveData`), these test calls would not `await` their save, potentially racing with subsequent page interactions. Using `saveDataSync` avoids this. The approach phase should note this constraint explicitly.

3. (C-1) C-1 is correct for settings.js callers but incomplete. The Playwright tests at `04-inline-chip-attachment.spec.js:127,155,321` call `window.saveInlineChipConfig(config)` directly — not through `_renderSectionConfigTable`. These are also fire-and-forget but run inside `page.evaluate()` blocks. If `saveInlineChipConfig` becomes `async`, the unawaited promise will silently resolve (same as C-1 says), but the test may read stale state before the save lands in localStorage. This is a test flake risk that C-1 doesn't capture. Using `saveDataSync` removes this class of risk entirely.

4. (C-7) Calling this "functionally harmless" undersells the risk. If inlineChipConfig ever exceeds 4096 chars (e.g., `INLINE_CHIP_DEFAULTS` grows, or labels get longer), the normal code path writes compressed data via `saveDataSync` (CMP1: prefix), but the restore path writes raw uncompressed `setItem`. After a restore, the on-disk value would be uncompressed raw JSON. Reading via `loadDataSync` still works — it handles both formats. But the next time `saveInlineChipConfig` fires, it would compress again. Churn is harmless but noisy. The real danger is if someone removes `inlineChipConfig` from `_rawKeys` and starts restoring via `saveDataSync` without updating the export path (which reads raw `getItem` and would stuff the raw CMP1: blob into the backup JSON, bypassing decompression). Approach should note that `_rawKeys` classification of `inlineChipConfig` is intentionally a permanent fixture, not just "stale."

#### Review Section

**Verified**
Verified the following claims in the active codebase at `/Volumes/DATA/GitHub/StakTrakr`:

- **`js/constants.js:1136-1170`** — `getInlineChipConfig` and `saveInlineChipConfig` use raw `localStorage.getItem`/`setItem`. Merge-with-defaults logic (lines 1142-1151) confirmed. Error swallows via `console.warn`. `scheduleSyncPush` called after save.
- **`js/utils.js:1160-1237`** — `saveData` (async, catches and toasts quota errors, does NOT re-throw, does NOT call `scheduleSyncPush`), `saveDataSync` (sync, toasts quota errors AND re-throws), `loadDataSync` (sync, handles compressed and uncompressed, returns `defaultValue` on error/missing).
- **`js/utils.js:3229-3249`** — `__compressIfNeeded` threshold is 4096 chars, using LZString + `CMP1:` prefix. `__decompressIfNeeded` is a no-op for non-`CMP1:` strings. Both confirmed.
- **`js/inventory-backup.js:82`** — export reads via raw `localStorage.getItem("inlineChipConfig")`, confirmed.
- **`js/inventory-backup.js:425-426,493-506`** — import prep passes raw string into `remoteSettings`. `loadDataSync` reads local for `compareSettings`. Confirmed.
- **`js/inventory-import.js:179-197`** — `inlineChipConfig` in `_rawKeys` Set (line 189). Restore writes via raw `localStorage.setItem`. Confirmed.
- **`js/inventory-import.js:1490-1514`** — sync fallback list includes `inlineChipConfig` (line 1497), reads via `loadDataSync` at line 1504. Confirmed.
- **`js/settings.js:2065-2073,2635-2674`** — `_renderSectionConfigTable` handlers call `opts.saveConfig(cfg)` without `await` at lines 2641 and 2671. Confirmed.
- **`js/inventory-table.js:414-416`** — calls `getInlineChipConfig()` for row rendering. **Not listed in the discovery's callers table** (see inline comment above).
- **`tests/playwright/03-settings/04-inline-chip-attachment.spec.js:127,155,321`** — Playwright tests call `window.saveInlineChipConfig(config)` directly (not through `_renderSectionConfigTable`). **Not listed in the discovery's callers table** (see inline comment above).
- **`js/diff-engine.js:139-164`** — `_settingsValuesEqual` handles type coercion for primitives (string/number/boolean), but compares array-vs-string via `typeof` gate that returns `false` (arrays are `"object"`, not a primitive). Confirms Gemini's type-mismatch concern in DiffEngine.
- **`js/constants.js:870,959,1118-1129,1201-1234,1308-1314,1930-1941`** — all constants, sibling savers, and window globals confirmed at claimed locations.
- **`js/diff-modal.js:59-64`** — `inlineChipConfig` under "Filters & Chips" category. Confirmed.
- **`tests/fixtures/settings-diff-test.json:73`** — stores `inlineChipConfig` as a raw JSON string. Confirmed.

**Top Concerns**
1. **Missing callers in discovery.** Two significant call sites are absent from the Callers table: `inventory-table.js:416` (reads `getInlineChipConfig` during table row rendering — in the blast radius if read behavior changes) and Playwright tests at lines 127/155/321 (call `window.saveInlineChipConfig` directly — this is the constraint that should tip the design toward `saveDataSync` over async `saveData`). C-1 only addresses settings.js handlers; approach.md must also account for both of these paths.

2. **C-7 "never compressed" is a time bomb.** The discovery correctly notes that compression won't trigger today (< 4096 chars), but treats this as near-axiomatic. Ten chip types with user labels and future additions (or the sibling `filterChipCategoryConfig` with 13 entries that WILL be targeted in a parallel issue) could push past 4096 chars. The `_rawKeys` classification of `inlineChipConfig` in `inventory-import.js` must stay permanent — it's a design fixture, not stale cruft. If it's ever removed without updating the export path, the restore flow would write raw uncompressed data over compressed data, creating a format mismatch under future compression conditions.

3. **DiffEngine type mismatch is pre-existing, not caused by this sketch.** Gemini's concern #2 is valid — `_settingsValuesEqual` returns `false` when comparing a parsed array (local, via `loadDataSync`) against a raw JSON string (remote, via backup import). However, this bug exists regardless of whether `saveInlineChipConfig` uses raw `setItem` or `saveDataSync`. The discovery should distinguish between bugs this sketch might fix vs. bugs this sketch must not make worse. The approach phase should neither claim to fix this nor accidentally make it worse by introducing a new write format.

**Unverified Assumptions**
- **Compression threshold as permanent invariant.** The assumption that `inlineChipConfig` will never exceed 4096 chars rests on today's 10-entry `INLINE_CHIP_DEFAULTS` array. If future versions add more inline chip types, or if user-customizable labels become longer, the stored JSON string could cross the threshold. The discovery treats "compression won't trigger" as an absolute truth rather than a constraint that needs monitoring.
- **`scheduleSyncPush` global availability.** The current code guards with `typeof scheduleSyncPush === "function"` (line 1166), which is good. But the discovery asserts the explicit `scheduleSyncPush` call "must remain explicit" (C-3) without checking whether the wrapper path introduces a scenario where `scheduleSyncPush` becomes unavailable (e.g., if script load order changes in a future refactor). Not actionable now, but worth noting.
- **`loadDataSync` default value mismatch.** The current `getInlineChipConfig` returns `INLINE_CHIP_DEFAULTS.map(...)` on any error (parse failure, missing key, etc.). If switched to `loadDataSync("inlineChipConfig", defaultValue)`, the default value is passed through directly. The approach phase must ensure `INLINE_CHIP_DEFAULTS.map((d) => ({ ...d }))` is the default, not `[]` (which is `loadDataSync`'s parameter default at `utils.js:1228`). The merge-with-defaults logic at C-5 would then layer on top. This is a detail the approach phase must get right.
- **Raw backup export remains safe after write path change.** The backup export at `inventory-backup.js:82` reads via `localStorage.getItem("inlineChipConfig")`. As long as the value stays under 4096 chars, this returns plain JSON (no `CMP1:` prefix) regardless of whether it was written raw or through `saveDataSync`. Verified — but the assumption that this will always hold needs explicit acknowledgment in approach.md.

### Codex

#### Inline Marks

1. (Backup export row) Verified at `js/inventory-backup.js:82`, but this is more than a passive read-only path: once normal writes move through `saveDataSync`, this export path becomes the only documented bypass of the wrapper for this structured JSON key. The coding standard at `DocVault/Projects/StakTrakr/Foundation/coding-standards.md:296-302` says compressed wrapper data read through raw `getItem()` is a `CMP1:` blob, so discovery should treat backup export format as a first-class compatibility surface rather than relying only on today's short payload size.

2. (C-6) This constraint should not be phrased as only a size invariant. The project storage rule says structured JSON should use wrappers (`coding-standards.md:224-233`) and the compression section warns that raw reads of compressed wrapper data are unusable without decompression (`coding-standards.md:296-302`). If approach keeps backup export raw, it should explicitly define the exported `inlineChipConfig` contract as "stored-string JSON" and explain how future compression is prevented or handled.

3. (Open Questions) Good to defer the async-vs-sync decision, but the discovery needs to carry one more resolved constraint into approach: `constants.js` is loaded before `utils.js` (`index.html:8484-8487`; coding standards `Script Load Order` at lines 437-439). Calling `loadDataSync`/`saveDataSync` inside `getInlineChipConfig`/`saveInlineChipConfig` is fine after page load, but approach should avoid any top-level wrapper call in `constants.js`.

4. (Discovery Summary) This summary slips into approach and contradicts the prior sentence that the async `saveData` vs sync `saveDataSync` decision is deferred. It should summarize the discovered constraints instead: synchronous callers/tests, `saveDataSync` throw behavior, explicit `scheduleSyncPush`, `loadDataSync` default-value caveat, and the backup/export raw-format risk. Also, "compression never triggers" is only true for today's 10-entry value, not a durable invariant.

#### Review Section

**Verified**
- `js/constants.js:1118-1170` confirms `INLINE_CHIP_DEFAULTS`, raw `getInlineChipConfig()`, raw `saveInlineChipConfig()`, merge-with-defaults behavior, `console.warn` swallowing, and explicit `scheduleSyncPush()`.
- `js/utils.js:1160-1237` and `js/utils.js:3228-3249` confirm `saveData` catches, `saveDataSync` re-throws, `loadDataSync` defaults to `[]`, and wrapper compression uses the `CMP1:` prefix at 4096 chars.
- `DocVault/Projects/StakTrakr/Foundation/coding-standards.md:224-233`, `:296-302`, and `:437-439` confirm the storage-wrapper rule, raw compressed-read hazard, and script-load-order constraint.
- `js/inventory-backup.js:82,425-426,500-506`, `js/inventory-import.js:179-197,1491-1512`, and `js/diff-engine.js:139-164` confirm the backup/export raw string path, restore `_rawKeys` behavior, sync fallback list, and array-vs-string diff mismatch.
- `js/settings.js:2065-2073,2636-2673`, `js/inventory-table.js:415-416`, and `tests/playwright/03-settings/04-inline-chip-attachment.spec.js:123-128,153-156,288-290,317-321` confirm the synchronous settings/test callers and table render read path.

**Top concerns**
1. The backup export path is a compatibility surface, not just read-only context. If normal writes can ever produce `CMP1:` values, `inventory-backup.js:82` exports the raw compressed blob unless approach defines a no-compression contract or normalizes backup export.
2. The discovery summary prematurely says both functions switch to `saveDataSync`/`loadDataSync` while also deferring the async-vs-sync decision. That should be converted back into evidence and constraints before approach starts.
3. The approach needs to account for script order: `constants.js` loads before `utils.js`, so wrapper calls must stay inside functions invoked after page load, not move into top-level constants initialization.

**Unverified Assumptions**
- `inlineChipConfig` will remain below the 4096-character compression threshold for all future chip sets.
- Backup `settings.json` intentionally stores `inlineChipConfig` as a raw JSON string forever, rather than as a parsed array or wrapper-normalized value.
- The approach will preserve `saveInlineChipConfig` as a synchronous API because settings handlers and Playwright helpers currently call it without awaiting.
- No startup path calls `getInlineChipConfig()` before `js/utils.js` has loaded.

### Resolution Summary
- Accepted: 11
- Rejected: 3 (scheduleSyncPush guard already exists — not actionable; Playwright quota unrealistic for ~450 bytes; loadDataSync already handles decompression fallback gracefully)
- Resolved with your input: 0
