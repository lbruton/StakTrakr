---
sketch: "STRK-74-align-inline-chip-config-save-data"
phase: approach
created: 2026-05-22
---

# STRK-74 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

This change is a two-function surgical edit in `js/constants.js`. The write path (`saveInlineChipConfig`) switches from raw `localStorage.setItem` + `JSON.stringify` to `saveDataSync`, preserving the existing try/catch error-swallowing behavior and the explicit `scheduleSyncPush()` call. The read path (`getInlineChipConfig`) switches from raw `localStorage.getItem` + `JSON.parse` to `loadDataSync`, preserving the merge-with-defaults logic that layers on top.

Both functions remain synchronous. `saveDataSync` (not async `saveData`) is chosen because all callers — settings UI handlers in `_renderSectionConfigTable` and Playwright test helpers calling `window.saveInlineChipConfig()` via `page.evaluate()` — are fire-and-forget without `await`. An async wrapper would silently resolve in production but create test flake risk: the unawaited promise might resolve after subsequent page interactions, leaving stale state visible to assertions. The synchronous contract eliminates this class of race.

No other files change behavior. Cloud sync manifest/vault comparison paths (`cloud-sync.js`, `vault.js`) are read-only for this sketch — they continue operating on the raw localStorage string, which remains plain JSON because the value (~450 bytes for 10 chips) never hits the 4096-char compression threshold. Backup restore preview is the known exception: it reads local settings via `loadDataSync` (parsed) while remote settings arrive as raw JSON strings from the backup file, creating a type mismatch in `DiffEngine.compareSettings` — this pre-existing bug is documented in Out of Scope below.

## Key Decisions

| #   | Decision                                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                        | Tradeoff                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Use `saveDataSync` (synchronous), not `saveData` (async)                                              | Preserves synchronous caller contract for settings handlers (`settings.js:2641,2671`) and Playwright test helpers (`04-inline-chip-attachment.spec.js:127,155,321`). Eliminates async test flake risk.                                                                                                                                           | `saveDataSync` re-throws `QuotaExceededError` after toasting — callers don't catch. Mitigated by D-2.                                                                                                                                                                                  |
| D-2 | Wrap `saveDataSync` call in try/catch inside `saveInlineChipConfig`, swallow errors to `console.warn` | Preserves existing error-swallowing behavior. Callers in `_renderSectionConfigTable` have no try/catch — an unhandled throw would break the settings UI. The `saveDataSync` toast still fires (user sees the quota warning), but the re-throw is caught here.                                                                                    | Double-logged on quota error: `console.error` from `saveDataSync` + `console.warn` from our catch. Acceptable for a near-impossible edge case (~450 bytes).                                                                                                                            |
| D-3 | Use `loadDataSync("inlineChipConfig", null)` with `null` default                                      | `loadDataSync`'s parameter default is `[]` (empty array), which is truthy and would bypass the defaults fallback. Passing `null` explicitly means missing/corrupt keys return `null`, and the merge-with-defaults guard (`if (saved && Array.isArray(saved))`) falls through to `INLINE_CHIP_DEFAULTS.map(...)`.                                 | Requires an explicit `null` argument on every call site — but there's only one call site.                                                                                                                                                                                              |
| D-4 | Keep `scheduleSyncPush()` as an explicit post-save call                                               | Neither `saveData` nor `saveDataSync` calls `scheduleSyncPush`. The current explicit call with `typeof` guard is correct and must remain.                                                                                                                                                                                                        | None — this is the existing pattern.                                                                                                                                                                                                                                                   |
| D-5 | Leave Playwright test seeds using raw `localStorage.setItem`                                          | `loadDataSync` transparently handles uncompressed JSON via `__decompressIfNeeded` (no-op for non-`CMP1:` strings). Updating seeds to `saveDataSync` would be architectural consistency sugar with no functional benefit and would add a dependency on `utils.js` loading before test seed evaluation.                                            | Slight inconsistency between test seeding and production write path. Documented, not harmful.                                                                                                                                                                                          |
| D-6 | Leave backup/restore/cloud-sync paths unchanged                                                       | Export (`inventory-backup.js:82`) reads raw `getItem`. Import (`inventory-import.js:189`) writes raw `setItem` via `_rawKeys`. Both are current design fixtures. The value never crosses 4096 chars, so the raw string is always plain JSON. `loadDataSync` handles both compressed and uncompressed formats on read, making the asymmetry safe. | If `INLINE_CHIP_DEFAULTS` ever grows with enough entries or long enough labels to push the serialized JSON past 4096 characters, compression would trigger and backup export would need a decompression wrapper. This is a future concern, not a current one — flagged as a risk note. |

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New

- None.

### Modified

- `js/constants.js` — modify `saveInlineChipConfig` (~8 lines) and `getInlineChipConfig` (~22 lines) to use `saveDataSync`/`loadDataSync` wrappers instead of raw `localStorage` calls. Function signatures, window globals, and external behavior are unchanged.

### Deleted

- None.

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. The localStorage key name (`inlineChipConfig`), value shape (JSON array of `{id, label, enabled}` objects), and allowlist/sync-scope membership are all unchanged. Existing stored values are read transparently by `loadDataSync` because `__decompressIfNeeded` is a no-op for non-`CMP1:` strings.

## Tradeoffs Surfaced for Review

- **D-2 double-logging on quota error:** On the near-impossible path where `localStorage.setItem` throws `QuotaExceededError` for a ~450-byte value, the error will be logged twice: `console.error` from `saveDataSync` internals and `console.warn` from `saveInlineChipConfig`'s catch. The user also sees a toast from `saveDataSync`. This is acceptable noise for a defensive edge case — the alternative (suppressing `saveDataSync`'s internal logging via `quietQuotaToast: true`) would hide the toast, which is worse.
- **D-5 test seed inconsistency:** Playwright tests seed `inlineChipConfig` via raw `localStorage.setItem` while production writes via `saveDataSync`. This is architecturally asymmetric but functionally safe. The trade is explicit: consistency in test seeding vs. a dependency on `utils.js` script load order during test setup.
- **Read-path diagnostic loss:** The current `getInlineChipConfig` logs `console.warn("Failed to load inline chip config:", e)` on parse errors. Switching to `loadDataSync` silently returns the default value without logging. The implementation should preserve a `console.warn` in the wrapper's catch block to maintain parse-error diagnostic parity.

## Out of Scope (follow-up issues)

- **DiffEngine type mismatch (pre-existing):** `DiffEngine._settingsValuesEqual` returns `false` when comparing a parsed array (local, via `loadDataSync`) against a raw JSON string (remote, via backup import), causing backup imports to always flag `inlineChipConfig` as changed. This bug is pre-existing — it exists regardless of this sketch. This sketch must not worsen it (and doesn't — the stored format is unchanged).
- **Sibling config savers:** `saveFilterChipCategoryConfig` (`constants.js:1227-1234`) and `_saveSectionConfig` (`constants.js:1308-1314`) use the same raw `setItem` pattern. Aligning them is a separate effort — this sketch targets only `inlineChipConfig`.
- **Backup export decompression wrapper:** If `inlineChipConfig` ever crosses 4096 chars, `inventory-backup.js:82` would export a `CMP1:` blob. A decompression wrapper on the export path would be needed at that point. Not today's problem — flagged as a risk note.

## Risk Notes

- **Risk:** `constants.js` loads before `utils.js` (both `defer`). If `getInlineChipConfig` or `saveInlineChipConfig` are ever called at top-level parse time in `constants.js`, `loadDataSync`/`saveDataSync` would be undefined. **Mitigation:** Both functions are declared as `const` function expressions, not top-level calls. They execute at runtime (after page load), when `utils.js` is available. The approach introduces no new top-level invocations. Existing test and production call sites are all runtime. The tasks phase should include a grep pre-check for any top-level `getInlineChipConfig()`/`saveInlineChipConfig()` calls in files loaded before `utils.js` (e.g. `field-meta.js`, `state.js`) to keep this mechanically guarded.
- **Risk:** Future growth of `INLINE_CHIP_DEFAULTS` with enough entries or long labels could push the stored JSON over 4096 chars, triggering compression. Backup export (raw `getItem`) would then return a `CMP1:` blob. **Mitigation:** This requires a 5x growth in chip count — highly unlikely in the near term. The `_rawKeys` classification in `inventory-import.js:189` is a permanent fixture that keeps the restore path raw-safe. If this ever materializes, the fix is a one-line decompression call in the export path.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-74`.

## Review Archive — approach (2026-05-22)

_Reconciled by /sketch reconcile on 2026-05-22. Original reviewer marks preserved below for audit._

### Codex

**Verified**

- Confirmed `inlineChipConfig` is already in both sync scope and allowed storage keys (`js/constants.js:870`, `js/constants.js:959`).
- Confirmed current inline chip load/save functions are the only targeted raw `localStorage` writers/readers in this sketch (`js/constants.js:1136`, `js/constants.js:1163`), while sibling raw savers exist out of scope (`js/constants.js:1227`, `js/constants.js:1308`).
- Confirmed `saveDataSync` compresses and rethrows on failure (`js/utils.js:1207`), `loadDataSync` decompresses and returns the supplied default on missing/corrupt data (`js/utils.js:1228`), and compression starts at 4096 chars (`js/utils.js:3229`).
- Confirmed Settings and test call sites treat `saveInlineChipConfig()` synchronously (`js/settings.js:2636`, `js/settings.js:2664`, `tests/playwright/03-settings/04-inline-chip-attachment.spec.js:123`, `tests/playwright/03-settings/04-inline-chip-attachment.spec.js:317`).
- Confirmed cloud/vault settings snapshots use raw localStorage strings (`js/vault.js:339`, `js/cloud-sync.js:1110`, `js/cloud-sync.js:3273`, `js/cloud-sync.js:3731`), while backup restore preview still compares parsed local settings against raw backup settings (`js/inventory-backup.js:500`, `js/inventory-backup.js:425`).

**Top concerns**

1. The statement that all DiffEngine comparison paths continue operating on raw localStorage strings is inaccurate for backup restore preview; keep the out-of-scope mismatch note, but narrow the architecture claim.
2. The load-order mitigation should become a task-phase grep/pre-check for pre-`utils.js` call sites, because `constants.js` really does load before `utils.js` and the new wrapper references are only safe at call time.
3. The compression-risk wording is directionally correct but too numerically confident: current config is 512 chars and the code threshold is 4096 chars, so entry count depends on label/id length rather than a stable "~50 entries" rule.

**Unverified assumptions**

- Assumes no third-party/user console/plugin code calls `window.getInlineChipConfig()` between `constants.js` and `utils.js` execution; I verified repo call sites, not arbitrary external callers.
- Assumes preserving the old read-path warning is not required; `loadDataSync` returns the default on parse failure without the existing `console.warn("Failed to load inline chip config:", e)` behavior.
- Assumes `_rawKeys` should remain a long-term backup import fixture; the code currently does that, but I did not find a product-level decision that makes it permanent.
- Assumes the only acceptance target is unchanged persisted format, not cleanup of the pre-existing backup DiffEngine false-positive.

### Gemini

**Verified**

- Confirmed that settings UI handlers and Playwright tests execute synchronously and fire-and-forget, making `saveDataSync` the correct choice over async `saveData`.
- Verified that `loadDataSync` is the appropriate read wrapper to handle decompression transparently if the payload size ever grows.
- Verified that `inlineChipConfig` is correctly registered in sync scopes and allowed storage keys lists.

**Top concerns**

1. **Console Warning Suppression:** Switching to `loadDataSync` will suppress the console warning `Failed to load inline chip config` on parsing errors (since `loadDataSync` swallows parsing exceptions and returns the default value). While not a blocker, we should note this diagnostic loss.
2. **Settings UI Crash Guard (D-2):** Confirming that `saveInlineChipConfig` must catch and log any exception from `saveDataSync` to protect the settings panel UI from crashing on storage write limits.

**UX/UI & Accessibility Review**

- The refactoring is purely backend/data layer and does not modify the settings panel UI layout or behavior. No impact on themes (light/dark/sepia) or screen readers.

### Resolution Summary

- Accepted: 4 (narrowed DiffEngine claim, softened _rawKeys/threshold wording, added grep pre-check note, noted diagnostic loss)
- Rejected: 3 (external callers — same pre/post constraint; _rawKeys longevity — product direction not approach scope; acceptance scope — already in Out of Scope)
- Resolved with your input: 0
