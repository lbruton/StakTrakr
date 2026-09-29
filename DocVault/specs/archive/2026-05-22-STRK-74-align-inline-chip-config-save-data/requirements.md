---
sketch: "STRK-74-align-inline-chip-config-save-data"
phase: requirements
created: 2026-05-22
---

# STRK-74 — Requirements

> **Source Issue:** [STRK-74](https://plane.lbruton.cc/lbruton/browse/STRK-74/)
> **Title:** Align saveInlineChipConfig to use saveData wrapper instead of raw localStorage.setItem
>
> During STRK-71 implementation, `saveInlineChipConfig` in `js/constants.js` was observed writing directly with `localStorage.setItem("inlineChipConfig", JSON.stringify(config))` instead of the project-standard `saveData()` wrapper. Other config-save paths still use raw `setItem` plus `scheduleSyncPush`, but aligning this path with `saveData("inlineChipConfig", config)` improves consistency and keeps future storage middleware covering the inline chip config save path.
>
> **Issue Acceptance Criteria:** replace the raw inline chip config write with `saveData("inlineChipConfig", config)`, verify the `getInlineChipConfig` read path uses `loadData` or document why raw read/merge behavior is acceptable, and keep the STRK-71 Playwright acceptance tests passing.

## Overview

This sketch aligns the inline chip configuration storage path with StakTrakr's standard
structured-data storage wrappers. `inlineChipConfig` is a JSON app preference, is already
allowlisted for cleanup and cloud sync, and should be written through `saveData()` so the
path benefits from the same compression, quota handling, and future storage middleware as
the rest of the app. The change should preserve the existing inline chip behavior from
STRK-71, including saved order, enabled/disabled flags, attachment-chip merge behavior, and
cloud sync push scheduling.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a StakTrakr user, I want my inline chip display preferences to save and
  reload exactly as they do today, so that changing the storage helper does not disturb my
  table layout. _(The save call is fire-and-forget — callers do not `await` it, so an
  `async` wrapper is acceptable. The current error-swallowing behavior must be preserved:
  a save failure must not throw into the settings UI.)_
- **US-2:** As a user with cloud sync enabled, I want inline chip preference changes to
  continue triggering a sync push, so that the setting remains portable across devices.
  Backup export/restore and cloud sync pull must also continue to round-trip correctly.
- **US-3:** As a maintainer, I want `inlineChipConfig` reads and writes to use the
  project-standard structured-data wrappers, so that compression, quota handling, and future
  storage middleware cover this preference consistently.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 (maps to US-1)

- **Given** `saveInlineChipConfig(config)` receives an inline chip config array
- **When** it persists the preference
- **Then** it writes `inlineChipConfig` through `saveData("inlineChipConfig", config)` instead
  of directly calling `localStorage.setItem("inlineChipConfig", JSON.stringify(config))`

### AC-2 (maps to US-2)

- **Given** `scheduleSyncPush` is available in the runtime
- **When** `saveInlineChipConfig(config)` successfully saves the preference through the
  wrapper path
- **Then** it still invokes `scheduleSyncPush()` so the sync-scoped `inlineChipConfig` key
  remains eligible for cloud propagation

### AC-3 (maps to US-3)

- **Given** `getInlineChipConfig()` reads `inlineChipConfig`
- **When** the implementation phase evaluates the read path
- **Then** it reads through `loadDataSync("inlineChipConfig", null)` — this is the only
  acceptable read path because the write path applies `__compressIfNeeded`, and only
  `loadDataSync` applies `__decompressIfNeeded` to handle both compressed and uncompressed
  stored values

### AC-4 (maps to US-1, US-3)

- **Given** an existing saved inline chip config omits a newer default chip such as
  `attachment`
- **When** `getInlineChipConfig()` loads the saved config
- **Then** it preserves the saved user order for known chips and appends missing defaults
  with their default enabled state. _(Note: `loadDataSync` returns the raw parsed value
  without merging — the existing merge-with-defaults logic must be composed on top of the
  `loadDataSync` result.)_

### AC-5 (maps to US-1)

- **Given** the STRK-71 inline chip Playwright coverage for appearance settings and
  attachment chip behavior
- **When** the storage helper alignment is implemented
- **Then** those tests continue to pass without weakening their assertions. _(Design-phase
  decision: test seeds currently use raw `localStorage.setItem` — the approach phase should
  decide whether to update seeds to use `saveDataSync` for consistency or document why raw
  seeding remains acceptable.)_

### AC-6 (maps to US-2)

- **Given** an `inlineChipConfig` value saved through the new `saveData`/`saveDataSync` path
- **When** the value is exported via backup (`inventory-backup.js:82`, raw `getItem`),
  restored via DiffModal (`inventory-import.js:189-193`, raw `setItem`), or round-tripped
  through cloud sync export (`cloud-sync.js:1112`, raw `getItem`) and pull
  (`_applyAndFinalize` at `cloud-sync.js:2692`, raw `setItem`)
- **Then** all three paths continue to produce correct, readable values — no `CMP1:` opaque
  strings in backup files, no parse failures on restore, no silent fallback to defaults.
  _(This is safe today because the value is < 4096 chars and compression never triggers.
  This AC verifies the invariant holds after the change, not that other paths are modified.)_

## Non-Goals

_Explicit list of things this sketch does NOT do. Each entry should make a future reader confident the omission was intentional._

- Not redesigning the inline chip settings UI — this is a storage-path cleanup only.
- Not changing the shape, order semantics, or default values of `INLINE_CHIP_DEFAULTS` beyond
  preserving the existing merge behavior.
- Not changing the cloud sync key scope for `inlineChipConfig`; it is already in
  `SYNC_SCOPE_KEYS`.
- Not refactoring unrelated config-save helpers such as filter chip category config, layout
  section config, or modal section config. _(Note: `_saveSectionConfig`, `saveFilterChipCategoryConfig`,
  and others use the same raw `setItem` pattern — `saveInlineChipConfig` is not the only outlier.
  The approach phase should acknowledge this broader pattern.)_
- Not introducing a migration for existing `inlineChipConfig` values; wrapper reads must
  continue handling already-saved JSON values. _(`__decompressIfNeeded` is a no-op for
  non-`CMP1:` strings — existing plain JSON values pass through unchanged.)_

## Open Questions

_Anything that blocks the next phase. Empty by the time discovery starts._

- None.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-74`.

---

## Review Archive — requirements (2026-05-22)

_Reconciled by /sketch reconcile on 2026-05-22. Original reviewer marks preserved below for audit._

### DeepSeek

#### Verified

- **`saveInlineChipConfig` uses raw `setItem`**: Confirmed at `js/constants.js:1163-1170`. Write is `localStorage.setItem("inlineChipConfig", JSON.stringify(config))` + `scheduleSyncPush()`.
- **`getInlineChipConfig` uses raw `getItem`**: Confirmed at `js/constants.js:1136-1157`. Read is `localStorage.getItem("inlineChipConfig")` + `JSON.parse()`.
- **`saveData` is `async`**: Confirmed at `js/utils.js:1160-1186`. Applies `__compressIfNeeded` (line 1163), handles `QuotaExceededError` with toast (line 1171-1185).
- **`loadDataSync` is synchronous**: Confirmed at `js/utils.js:1228-1237`. Handles both compressed and uncompressed data via `__decompressIfNeeded` (line 1232).
- **`__decompressIfNeeded` handles uncompressed data**: Confirmed at `js/utils.js:3238-3249`. Only decompresses when `CMP1:` prefix present — safe for existing stored values. No migration needed.
- **`inlineChipConfig` in `SYNC_SCOPE_KEYS`**: Confirmed at `js/constants.js:870`.
- **`inlineChipConfig` in `ALLOWED_STORAGE_KEYS`**: Confirmed at `js/constants.js:959`.
- **`INLINE_CHIP_DEFAULTS` includes `attachment`**: Confirmed at `js/constants.js:1118-1129`. Merge logic preserves user order + appends missing defaults (`js/constants.js:1144-1150`).
- **Callers don't `await`**: `_renderSectionConfigTable` at `js/settings.js:2641:2671` calls `opts.saveConfig(cfg)` without `await`.
- **Playwright test coverage exists**: `tests/playwright/03-settings/04-inline-chip-attachment.spec.js` (346 lines) + `tests/playwright/03-settings/03-appearance.spec.js` test 3.9 (line 120-123).
- **Sibling config savers use same raw pattern**: `_saveSectionConfig` at `js/constants.js:1308-1314` (used by layout/view-modal configs), `saveFilterChipCategoryConfig` at `js/constants.js:1220-1232`.

#### Top concerns

1. **`saveData` async vs. callers not awaiting** — The requirements are silent on whether the new `saveInlineChipConfig` should be `async` (using `saveData()`) or sync (using `saveDataSync()`). `_renderSectionConfigTable` callers fire-and-forget, so either works, but the design phase should decide explicitly. Using `saveDataSync()` would keep the function signature synchronous and avoid the `async` footgun — but `saveDataSync` doesn't set `cloud_sync_local_modified` the way `saveData` does (the current code doesn't do that either, so no regression).

2. **Read/write coupling is under-specified in AC-3** — If write uses `saveData()` (compression), read MUST use `loadDataSync()` (decompression). AC-3's "or otherwise avoids" phrasing allows an interpretation where the read path stays raw. That's a silent data-corruption scenario. See inline comment on AC-3.

3. **Merge-after-load layering** — Switching `getInlineChipConfig` to `loadDataSync` means the merge-with-defaults logic (currently at `js/constants.js:1140-1151`) must be composed on top of the raw `loadDataSync` result. This is straightforward but not called out explicitly. See inline comment on AC-4.

#### Unverified assumptions

- **Assumption: `saveData(null, config)` will be called with key `"inlineChipConfig"`** — The requirements say `saveData("inlineChipConfig", config)` but don't confirm the second argument is the config array (not a wrapped object). The current `saveInlineChipConfig(config)` receives the array directly. This is consistent with `saveData`'s signature, but worth verifying on implementation.
- **Assumption: `saveData` does not call `scheduleSyncPush` internally** — Confirmed by source: `saveData` only sets `cloud_sync_local_modified` for inventory keys. The explicit `scheduleSyncPush()` call in AC-2 is correct.
- **Assumption: No other code writes `inlineChipConfig` via raw `setItem`** — Verified by grep: only `saveInlineChipConfig` writes this key. Backup/restore (`inventory-backup.js:82:425`) and settings-diff fixtures (`settings-diff-test.json:73`) reference it but don't write to localStorage directly.
- **Assumption: `loadDataSync("inlineChipConfig", null)` with `null` default is equivalent to current `null`-guard behavior** — Needs verification: `getInlineChipConfig` currently returns `INLINE_CHIP_DEFAULTS` when `raw` is falsy (line 1139). `loadDataSync("inlineChipConfig", null)` returns `null` for missing keys but the default-value is never an empty-array, so the caller would still need to check for `null` and fall back to defaults.
- **Assumption: The `inlineChipConfig` values stored are always < 4096 bytes** — `__compressIfNeeded` only compresses strings ≥ 4096 chars (`js/utils.js:3231`). The fixture at `tests/fixtures/settings-diff-test.json:73` shows a ~450 byte value (8 chips). With 10 chips it's still well under 4KB, so this key won't trigger compression. The sketch still benefits from quota handling and consistency, but the "compression" benefit specifically won't materialize for this key.

### Claude

#### Verified

- **`saveInlineChipConfig` uses raw `setItem`**: Confirmed at `js/constants.js:1163-1170`. Direct `localStorage.setItem("inlineChipConfig", JSON.stringify(config))` + `scheduleSyncPush()`.
- **`getInlineChipConfig` uses raw `getItem`**: Confirmed at `js/constants.js:1136-1157`. `localStorage.getItem("inlineChipConfig")` + `JSON.parse()` + merge-with-defaults logic.
- **`saveData` is `async`, applies compression**: Confirmed at `js/utils.js:1160-1186`. Calls `__compressIfNeeded` (line 1163), handles `QuotaExceededError` with toast.
- **`saveDataSync` is synchronous, also applies compression**: Confirmed at `js/utils.js:1207-1227`. Same `__compressIfNeeded` call but **throws** on `QuotaExceededError` instead of toasting. Neither `saveData` nor `saveDataSync` calls `scheduleSyncPush`.
- **`loadDataSync` is synchronous with decompression**: Confirmed at `js/utils.js:1228-1237`. Handles `CMP1:` prefix via `__decompressIfNeeded`.
- **Compression threshold is 4096 chars**: Confirmed at `js/utils.js:3231`. `inlineChipConfig` (10 chips, ~450 bytes) will never trigger compression.
- **`inlineChipConfig` in `SYNC_SCOPE_KEYS`**: Confirmed at `js/constants.js:870`.
- **`inlineChipConfig` in `ALLOWED_STORAGE_KEYS`**: Confirmed at `js/constants.js:959`.
- **`INLINE_CHIP_DEFAULTS` has 10 entries including `attachment`**: Confirmed at `js/constants.js:1118-1129`.
- **Callers fire-and-forget**: `_renderSectionConfigTable` calls `opts.saveConfig(cfg)` at `js/settings.js:2641` and `js/settings.js:2671` without `await`.
- **Backup export reads raw**: `inventory-backup.js:82` uses `localStorage.getItem("inlineChipConfig")` — gets the raw stored string, no decompression.
- **Backup restore flows through DiffEngine**: `inventory-backup.js:426` puts the raw value into `remoteSettings`, which is compared via `DiffEngine.compareSettings` (line 506) against local values read via `loadDataSync` (line 503).
- **Sibling config savers use same raw pattern**: `_saveSectionConfig` at `js/constants.js:1308-1314` (layout/view-modal), `saveFilterChipCategoryConfig` at `js/constants.js:1220-1232` — both raw `setItem` without `scheduleSyncPush`.
- **Playwright test seeds raw data**: `04-inline-chip-attachment.spec.js:289` uses `localStorage.setItem("inlineChipConfig", JSON.stringify(cfg))` to seed test state.

#### Top concerns

1. **Backup/restore format coupling not addressed** — The backup export path (`inventory-backup.js:82`) reads `inlineChipConfig` via raw `localStorage.getItem()`. The restore comparison path (`inventory-backup.js:503`) reads local values via `loadDataSync()` (which decompresses). If a future change lowers the compression threshold below this key's size, backup files would contain `CMP1:` strings that `DiffEngine` can't meaningfully compare. While this won't happen today (value < 4096 chars), the requirements should either (a) add an AC requiring backup round-trip correctness, or (b) explicitly note in non-goals that backup format coupling is out of scope.

2. **`saveDataSync` throws on quota error — behavior change from current code** — The current `saveInlineChipConfig` catches and warns on errors (line 1164-1169). If the design phase picks `saveDataSync` (the synchronous wrapper), note that `saveDataSync` **throws** on `QuotaExceededError` after toasting (`js/utils.js:1225`). The current code swallows the error with `console.warn`. The callers in `_renderSectionConfigTable` have no try/catch around `opts.saveConfig(cfg)` (`settings.js:2641, 2671`). An unhandled throw would break the UI interaction. The requirements should state whether the error-swallowing behavior must be preserved (it should — a save failure shouldn't break the settings panel).

3. **DEEPSEEK's AC-3 concern is correct and under-acknowledged** — The "or otherwise avoids" phrasing in AC-3 is genuinely dangerous. If write uses `saveData()`/`saveDataSync()` (both apply `__compressIfNeeded`), the read MUST use `loadDataSync()` (which applies `__decompressIfNeeded`). A raw `getItem + JSON.parse` would fail silently on compressed data (returning `null` from `JSON.parse` of a `CMP1:` string), causing the merge logic to fall back to defaults — wiping the user's saved chip order. Even though compression won't trigger today, the coupling is architectural and should be stated as a hard constraint, not a preference.

#### Unverified assumptions

- **Assumption: `saveInlineChipConfig` is the only write path for this key** — Verified by grep: only `saveInlineChipConfig` in `js/constants.js:1165` writes this key to localStorage directly. Backup restore writes through `DiffEngine` → `DiffModal` accept flow, which applies selected settings (the exact write-back mechanism delegates to the modal's accept callback — not through `saveInlineChipConfig`). This means there are **two** write paths for this key: the settings UI and the backup restore. The backup restore path should also use `saveData`/`saveDataSync` after this change, or document why it doesn't.
- **Assumption: `_renderSectionConfigTable` is the only caller of `saveInlineChipConfig`** — Verified: `renderInlineChipConfigTable` at `settings.js:2065-2073` passes `saveInlineChipConfig` as `opts.saveConfig`, and the generic helper calls it at lines 2641 and 2671. No other callers found via grep.
- **Assumption: The `try/catch` in `saveInlineChipConfig` is defensive-only and never fires in practice** — Plausible but not verified. `localStorage.setItem` can throw `QuotaExceededError` or `SecurityError` (private browsing). The current catch swallows to `console.warn`. If migrating to `saveData`/`saveDataSync`, the error handling behavior changes (see Top Concern #2).
- **Assumption: Cloud sync import path also handles this key correctly** — The requirements mention cloud sync push (`scheduleSyncPush`) but don't address the sync pull path. When cloud sync pulls new settings, how is `inlineChipConfig` written back? If it bypasses `saveData`, the same format coupling issue applies.

### Resolution Summary

- Accepted: 8
- Rejected: 0
- Resolved with your input: 1 (backup/sync write paths → added AC-6 for round-trip correctness)
