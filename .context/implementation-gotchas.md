---
title: "StakTrakr — Implementation Gotchas"
project: StakTrakr
audience: agent
canonical: .context/implementation-gotchas.md
updated: "2026-08-13"
---

# Implementation Gotchas — StakTrakr

Situational foot-guns in specific modules and runtime patterns. Read when touching the
named file or feature. CLAUDE.md carries a one-line index of these; this file is the
authority — do not duplicate the detail back into CLAUDE.md or AGENTS.md.

> **Maintenance note.** Entries here describe _bugs_, so they go stale when the bug gets
> fixed — a gotcha describing an already-solved hazard sends an agent to "fix" correct
> code. Prefer "grep it" over hard-coded counts and line numbers, and when a hazard is
> structurally solved, rewrite the entry as a contract to preserve rather than deleting the
> history.

## Dual Config Store — CRITICAL

Two separate localStorage stores. Confusing them = silent data loss.

| Store             | Key                  | Manages                                                       | Read                                                   | Write                                                  |
| ----------------- | -------------------- | ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Spot providers    | `metalApiConfig`     | METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM               | `loadApiConfig()`                                      | `saveApiConfig()`                                      |
| Catalog providers | `catalog_api_config` | Numista apiKey, Professional Coin Grading Service bearerToken | `catalogConfig.getNumistaConfig()` / `getPcgsConfig()` | `catalogConfig.setNumistaConfig()` / `setPcgsConfig()` |

Reading catalog keys via `loadApiConfig().keys["numista"]` returns `undefined`; that is the
wrong store and the root cause of STRK-573.
`saveData()` wraps in `JSON.stringify`. Read saved data via `loadData()` / `loadDataSync()`.
After saving a catalog key, call `catalogAPI.initializeProviders()` to refresh stale
provider instances.

## `check-release-sync` hook is a SUBSET

Validates `constants.js ↔ package.json ↔ version.json ↔ CHANGELOG.md`, plus the
`js/about.js` What's New block — it asserts the current-version `<li>` entry is present
**and** enforces the 5-entry cap (STRK-194, #1262).
Does not check `manifest.json`, README badges, or `sw.js` cache.
**Hook green ≠ release complete.** `/release` is the only path that touches all
release-bearing files.

## Script load order — `safeGetElement` unavailable in `events.js` top-level

`init.js` defines `safeGetElement` and loads after `events.js`; both scripts use `defer`.
Top-level code in `events.js` that calls `safeGetElement` throws a silent ReferenceError.
Use `document.getElementById` for event wiring that runs at parse time.
Factory closures such as `createLotEachToggle` are fine because they call `safeGetElement`
at runtime.
Related: `safeGetElement` returns a partial dummy when the element is missing — shimmed
members no-op silently; only `instanceof HTMLElement` discriminates a real element.

## Playwright dialog testing — `showAppConfirm` is not `window.confirm`

`showAppConfirm` (`js/dialogs.js`) is a custom Document Object Model modal
(`#appDialogModal`), not native `window.confirm`. `page.on("dialog", ...)` does not
intercept it.
Tests start the async function via `page.evaluate` without awaiting it first, then call
`waitForSelector("#appDialogModal", {state:"visible"})`, then click `#appDialogOk` or
`#appDialogCancel`. Use the same pattern for `showAppAlert` and `showAppPrompt`.

## `state.js` variable exposure — `let` needs `Object.defineProperty`

Variables declared with `let` in `state.js` are not on `window`.
`inventory` and `changeLog` have explicit `Object.defineProperty` getter/setters.
Any new state variable that tests or other modules need via `window.X` should follow the
same pattern.
Related: all `js/` files share ONE global scope, and redeclaring a top-level binding across
two files behaves differently by keyword. `const`/`let`/`class` throw a **parse-time
SyntaxError that silently kills the second script**. `var` is legal — the later script
silently overwrites the earlier value, with no error at all and a symptom far from the
cause. Prefix new sync-related globals `SYNC_` (precedent: `SYNC_SCOPE_KEYS`,
`SYNC_BACKUP_PREFIX`).

## Date formatting — Canadian English locale

Use `toLocaleDateString('en-CA')` (Canadian English) to produce **local, user-facing**
dates in year-month-day format (form defaults, filenames, display).
Do not use `toISOString().slice(0, 10)` for those; it returns a UTC date and shifts a day
for users in negative UTC offsets.
**Inverse case — UTC-keyed data values** (publisher feed business days, chart time keys):
keep the UTC calendar date. Derive it from the feed row's ISO timestamp field
(`row.t.split("T")[0]`) or `toLocaleDateString('en-CA', { timeZone: 'UTC' })`.
Local `en-CA` on a UTC-stamped key shifts a day for users in positive UTC offsets.
Do not mix frames (local `new Date(y, m, d)` construction followed by `toISOString()`
formatting) unless the conversion is deliberate and commented at the call site.

## Theme count — four themes, not three

StakTrakr has **four** CSS themes: `light`, `dark`, `slate`, `sepia`. There is no
`contrast` theme. AI reviewers frequently hallucinate "three themes" or a "contrast"
theme — both are wrong.

## `applyBulkEdit()` — contracts to preserve

Both historical hazards below are **already solved** in `js/bulkEdit.js`. They are recorded
as contracts to avoid regressing, not as live bugs to fix.

- **Nested paths** route through `BULK_FIELD_STORAGE_MAP` via `applyBulkFieldToItem()` (grep
  either name in `js/bulkEdit.js`). A new bulk-editable field at a nested path (e.g.
  `item.numistaData.shape`) still needs its own map entry — without one, a flat
  `item[fieldId] = value` write lands on a bogus top-level key (precedent: STRK-91).
- **Change-log snapshots** use `structuredClone` for `oldItem.numistaData` and
  `oldItem.fieldMeta` (grep `structuredClone` in `js/bulkEdit.js`). A plain
  `Object.assign({}, item)` is shallow — mutating a nested object would also mutate
  `oldItem`, making before/after diffs come out empty.
- **`BULK_COLUMN_PRIORITY` length: grep it, never quote it.** This entry previously
  hard-coded "30 entries" while listing 32 among its examples of wrong guesses — and 32 was
  the correct answer. Counts in docs invert into misinformation.

## `loadDataSync` behaviors

- **Swallows parse errors** — returns the default value on parse/decompression error instead of throwing.
- Outer `try/catch` around `loadDataSync` will not fire for parse failures.
- `console.warn` in a catch block is dead code in this scenario.
- **Default is `[]`, not `null`** — `[]` is truthy. When the caller checks `if (!storedValue)` before merging defaults, pass `null` explicitly: `loadDataSync("key", null)`. The default `[]` silently skips the merge.
- **`saveDataSync` re-throws** — unlike raw `localStorage.setItem`, it re-throws on quota errors. Fire-and-forget callers need a `try/catch` wrapper when migrating from raw storage calls.

## CSS sticky columns — required setup

Tables using `position: sticky` on `th`/`td` require `border-collapse: separate; border-spacing: 0`.
The default `collapse` disables sticky behavior.
For sticky-left + sticky-top intersections, use a three-tier z-index: corner cells = `z-index: 3`, sticky column body cells = `z-index: 1`, data cells = auto.
Missing the corner tier causes data cells to paint over the frozen header corner during diagonal scroll.

## `--warning` color — accessibility fail on small text in light/sepia

`--warning` (oklch L≈0.666) on `--bg-secondary` produces ≈1.4:1 contrast in light (L≈0.96) and sepia (L≈0.892) themes.
That fails WCAG level AA for small text.
Use a darker custom amber (≈`oklch(0.55 0.15 60)`) for ticker or `font-size-xs` contexts in these themes.

## `--success` color — non-text contrast fail on sepia icons

Sibling of the `--warning` gotcha above, at a different WCAG bar.
Sepia `--success` (`oklch(0.603 0.117 130.4)`) on the sepia spot-card surface (`oklch(0.892 0.032 89.1)`) measures **2.72:1** — under the WCAG 1.4.11 Non-text Contrast bar of **3:1** for icons and graphical objects.
STRK-291 fixed it in `css/styles.css` with a same-hue, lower-lightness override: `[data-theme="sepia"] .spot-sync-icon--fresh { color: oklch(0.52 0.13 130.4) }`, measured at 3.83:1.
Light `--success` measures 3.35:1 — passing, but with little margin. Dark and slate are 5.6–5.8:1 and fine.

Two method notes, both of which cost real debugging time in STRK-291:

- **Judge icon strokes and borders at 3:1, not 4.5:1.** Non-text Contrast (1.4.11) governs icons and graphical objects; the 4.5:1 small-text bar implied by the `--warning` entry above does not apply to them.
- **Never parse `oklch(...)` numbers as RGB.** `getComputedStyle` returns these tokens verbatim as `oklch(...)` strings, and treating the three components as RGB yields silently wrong ratios — during STRK-291 that mistake reported all four themes as failing, including ones that were fine. Resolve to sRGB by painting the color into a 1×1 canvas and reading the pixel back; working implementation is `__resolveRgb` in `tests/playwright/core/strk-189-spot-freshness.spec.js`.

## `_isMarketItemEnabled` guard — RESOLVED, do not re-add

Historically the filter had to be applied on both the All-tab path and the per-metal `else`
branch of `_renderVendorTable()`, and missing the `else` branch surfaced disabled vendors as
column headers.

**This is no longer a hazard.** `_renderVendorTable` now delegates to
`_collectVendorTableRows` (grep both in `js/market-data.js`), where the `_isMarketItemEnabled`
guard sits **above** the `isAllScope` branch rather than inside either arm of it — so it
cannot be missed. Adding a second guard in a branch is a redundant duplicate, not a fix.

## `// duplication-ok` hook escape hatch

The duplication-checker hook respects `// duplication-ok` inline comments. Use this when intentional shadowing or deliberate repetition would otherwise trigger the hook.

## Closing task ordering in sketch workflow

Follow this sequence:

1. Version bump
2. Spot bundle update
3. `gh pr create`
4. Post-merge archive
5. Mark Plane issue as Done

**Warning:** Mark Plane issues Done only after the PR merges.
Plane closure tasks (close task number) follow `/sketch archive` after merging.

**DocVault git add discipline:** When committing sketch archives, stage with surgical precision:

- Stage by exact file paths: `git add specs/STRK-74/requirements.md ...`
- Do not use broad staging: `git add specs/` or `git add .`
- Broad staging picks up in-progress sketches as unintended additions.
