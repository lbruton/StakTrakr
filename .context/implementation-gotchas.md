# Implementation Gotchas — StakTrakr

Situational foot-guns in specific modules. Read when touching the named file or feature.

## `applyBulkEdit()` — nested field paths and shallow copy

- **Flat assignment hazard:** `applyBulkEdit()` uses `item[fieldId] = value`. Any field at a nested path (e.g., `item.numistaData.shape`) silently writes to a nonexistent top-level key. Fields at nested paths require an explicit `BULK_FIELD_STORAGE_MAP` entry (precedent: STRK-91).
- **Shallow copy hazard:** `Object.assign({}, item)` before mutation means `oldItem.numistaData === item.numistaData`. Mutating a nested field silently mutates `oldItem` too, making change-log before/after diffs invisible. Deep-copy the nested object before mutation.
- **`BULK_COLUMN_PRIORITY`** has **30 entries** — grep rather than trusting prior docs (reviewers have guessed 22, 28, and 32 in separate sessions).

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
- **Never parse `oklch(...)` numbers as RGB.** `getComputedStyle` returns these tokens verbatim as `oklch(...)` strings, and treating the three components as RGB yields silently wrong ratios — during STRK-291 that mistake reported all four themes as failing, including ones that were fine. Resolve to sRGB by painting the colour into a 1×1 canvas and reading the pixel back; working implementation is `__resolveRgb` in `tests/playwright/core/strk-189-spot-freshness.spec.js`.

## `_isMarketItemEnabled` guard — apply on both tab paths

In `_renderVendorTable()`, apply the `_isMarketItemEnabled` filter on **both** the All-tab code path and the per-metal-tab `else` branch.
Missing it on the `else` branch causes disabled vendors to appear as column headers.

## Goldback lookup predicates

`isGoldbackLookup` (target+unit check) and `isGoldbackRetailLookup` (unit-only check) have different semantics and are easy to confuse. Use the correct predicate for the context — retail lookup uses unit-only.

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
