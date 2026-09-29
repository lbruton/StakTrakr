---
sketch: "STRK-71-table-chip-settings"
phase: discovery
created: 2026-05-12
---

# STRK-71 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

The inline-chip infrastructure is fully built and wired. The **runtime app change** is confined to `js/constants.js` and `js/inventory-table.js`; the **test surface** is broader (see test entries below — the entire AC-1..AC-6 integration coverage is greenfield).

| Path | Role | Notes |
|------|------|-------|
| `js/constants.js:1096-1106` | `INLINE_CHIP_DEFAULTS` — 9-entry array `[{ id, label, enabled }]` | **The only write target in constants.js.** Add one `attachment` entry here; everything downstream picks it up automatically. |
| `js/constants.js:1113-1134` | `getInlineChipConfig()` — loads from localStorage, merges with defaults | Lines 1119-1127: merge is **forward-additive AND backward-filtering**. New defaults not in saved config are appended at the end (free upgrade path; no migration code needed). Saved ids not present in current defaults are silently dropped (line 1121: `saved.filter((c) => INLINE_CHIP_DEFAULTS.some((d) => d.id === c.id))`). Benign for STRK-71 (additive only) but relevant context for future chip removals. |
| `js/constants.js:1140-1147` | `saveInlineChipConfig(config)` — persists via `localStorage.setItem` (not `saveData()` wrapper) | Confirmed divergence from issue notes; see Constraints. Also calls `scheduleSyncPush()` if available. |
| `js/constants.js:848,937` | `ALLOWED_STORAGE_KEYS` — `"inlineChipConfig"` already registered at both locations | No change needed here. |
| `js/constants.js:1913-1916` | Window exposure of chip API | No change needed. |
| `js/inventory-table.js:404` | `chipConfig = getInlineChipConfig()` — loaded once per `renderTable()` call | Config is fresh each render; no stale-config risk. |
| `js/inventory-table.js:552-562` | `chipMap` — maps 9 chip ids to HTML strings | **Primary write target.** Need to add `attachment: attachChip` entry here. |
| `js/inventory-table.js:563-566` | `orderedChips` — filters `chipConfig` by `enabled && chipMap[c.id]`, joins HTML | No change needed; adding `attachment` to `chipMap` is sufficient. |
| `js/inventory-table.js:567-577` | `attachChip` construction — calls `renderAttachmentBadge(item, { variant: "table" })`, sets `onclick` string attribute, extracts `.outerHTML` | Currently declared after `chipMap`. To use `attachChip` as a value in `chipMap`, the construction block must move above the `chipMap` declaration. This is a reordering, not new logic. Alternative shapes exist — see "Implementation Alternatives Considered" below. |
| `js/inventory-table.js:603` | Name cell template: `${disposition-badge}${orderedChips}${attachChip}` | The disposition badge (system status indicator, AC-3 confirms it stays put) renders **before** chips. The surgical edit is to collapse `${attachChip}` into `orderedChips` so the post-STRK-71 template reads `${disposition-badge}${orderedChips}`. Not "drop the suffix" — the disposition badge prefix is unchanged. |
| `js/attachment-ui.js:262-281` | `renderAttachmentBadge(item, { variant: "table", onClick? })` — returns `HTMLElement\|null` | Returns `null` when no attachments; the existing `if (item.attachments?.length > 0)` guard in the `attachChip` block handles this. CSS class for table variant: `attach-count-chip`. The `onClick` option (lines 259, 266, 272-278) uses `addEventListener` and is **explicitly unusable here**: `inventory-table.js` builds row HTML as a string and extracts `.outerHTML`, which strips event listeners from detached elements. The existing string `onclick` attribute path at `:571-575` is doing real work; approach must not "simplify" by switching to the callback API. |
| `js/settings.js:2025-2033` | `renderInlineChipConfigTable()` — delegates to `_renderSectionConfigTable` | `onApply: renderTable`, `getConfig: getInlineChipConfig`, `saveConfig: saveInlineChipConfig`. No change needed; new default appears automatically. |
| `js/settings.js:2560-2647` | `_renderSectionConfigTable(opts)` — generic toggle+reorder UI helper | Renders checkbox + up/down arrows per entry. `locked` flag skips reorder arrows. No change needed. |
| `index.html:4181-4188` | "Inline Name Chips" panel — `#inlineChipConfigContainer` inside Settings > Appearance > Layout | No HTML change needed. After STRK-71, this panel will display one new row labeled "Attachments" — see Constraints #8. |
| `js/card-view.js:627-631` | Card-view attachment chip — own inline SVG, class `cv-chip cv-chip-attach` | Does NOT call `getInlineChipConfig()`. Card views are fully independent of this change. AC-7 trivially satisfied. |
| `js/inventory-backup.js:81,421-422` | Backup includes `inlineChipConfig` via raw `localStorage.getItem` | No change needed; new entry serializes transparently. |
| `js/inventory-import.js:189,1472` | Import restores `inlineChipConfig` | No change needed. |
| `js/diff-modal.js:63,114,151` | Diff modal includes `inlineChipConfig`; label "Inline Chips"; renderer "chip-strip" | No change needed. Renderer is shape-agnostic over chip-array length. |
| `tests/fixtures/settings-diff-test.json:73` | `inlineChipConfig` fixture — orphan documentation | **Not a test asset.** `rg "settings-diff-test"` returns zero references across the repo. The fixture is already drifted from current defaults (missing `tags` entry that exists in `INLINE_CHIP_DEFAULTS`), proving no test asserts equality against it. Updating it for STRK-71 is courtesy, not a hard requirement. See Constraints #7. |
| `tests/playwright/03-settings/03-appearance.spec.js:120-131` | Tests `#inlineChipConfigContainer` exists and is visible inside the Layout fieldset | Will continue to pass; no structural change to the panel. |
| `tests/playwright/attachments/ui.spec.js:6-57` | Three unit-style tests of `renderAttachmentBadge()` — null path, count rendering | All default `variant: "card"`. Does **not** exercise `variant: "table"`, the table row click path, or chip-config toggling. STRK-71 cannot extend these tests; it must add a new integration spec. |
| `tests/playwright/attachments/` | `manager.spec.js`, `ui.spec.js`, `diff-modal.spec.js` — STRK-45 attachment tests | Independent scope; verify they still pass after `inventory-table.js` is edited (attachment badge `onclick` path changes). |

## Prior Decisions

- **2026-05-09 — STRK-45 shipped per-item attachments** (`renderAttachmentBadge`, `attachment-manager.js`, `attachment-ui.js`). The table attachment chip (`attach-count-chip`) was wired outside `chipMap` as a deliberate punt — the settings plumbing for it was explicitly deferred to STRK-71.
- **2026-05-12 — STRK-71 requirements reconciled** — four open questions resolved: (a) `attachment` defaults to `enabled: true`; (b) default position is rightmost (appended last in INLINE_CHIP_DEFAULTS); (c) card-view chip parity uses a separate storage key; (d) `saveData()` wrapper refactor is out of scope for STRK-71.

## External References

No new libraries or external patterns needed. The toggle+reorder UX is already implemented by `_renderSectionConfigTable` (`js/settings.js:2560-2647`). The attachment badge rendering is already implemented by `renderAttachmentBadge`. CSS for `.inline-chip-move` exists at `css/styles.css:3541-3565`; table attachment chip styling at `css/styles.css:15151-15164`.

## Implementation Alternatives Considered

Discovery does not pick the shape — that is approach's job — but the following alternatives exist and approach should explicitly weigh them rather than default to the block-move:

1. **Block reorder** — move the `attachChip` construction block from `inventory-table.js:567-577` to before `chipMap` so it can be referenced as a value. Smallest diff but moves an attachment-specific block away from the attachment-specific code.
2. **Lazy `chipMap` value / function** — add `attachment: attachChip` to `chipMap` as a lazily-evaluated entry (or a small inline factory) so `attachChip` can stay near the rest of the attachment-specific code.
3. **Extracted helper** — pull `attachChip` construction into a small named helper (e.g., `buildTableAttachmentChip(item)`) called from both the `chipMap` declaration and any future card-view parity work.

Trade-off summary belongs in `approach.md`.

## Constraints

1. **`saveInlineChipConfig` uses raw `localStorage.setItem`**, not `saveData()`. Do not refactor this within STRK-71 — a follow-up issue **should** own that wrapper alignment (no follow-up issue is currently filed; filing it is out of scope for this sketch but should not be forgotten). The new `attachment` entry rides on the same raw path as the existing 9 entries.
2. **Card views must remain unaffected.** `card-view.js:627-631` uses its own hardcoded attachment chip and never calls `getInlineChipConfig()`. Do not change that code path.
3. **`inlineChipConfig` is the sole storage key.** The attachment entry belongs in the existing key, not a new one. The sibling card-view chip parity issue will use a different key when it ships.
4. **`INLINE_CHIP_DEFAULTS` order determines default display order.** The `attachment` entry must be appended last (index 9) to preserve the current rightmost rendering for fresh installs and upgraded users.
5. **`attachChip` must be available before `chipMap`** (regardless of which shape from "Implementation Alternatives Considered" approach picks). The simplest realization is reordering the construction block; lazy/helper shapes satisfy the same constraint differently.
6. **`getInlineChipConfig()` merge logic is forward-additive AND backward-filtering.** Users with saved config get `attachment` appended at the end automatically (lines 1123-1127). No explicit migration or version-check needed for STRK-71. The backward-filtering behavior (line 1121) is benign here but worth knowing for future chip removals.
7. **Test fixture update is an optional courtesy.** `tests/fixtures/settings-diff-test.json:73` is orphan documentation — `rg "settings-diff-test"` returns zero references across the repo, and the fixture is already drifted from current defaults (missing `tags`). Updating it for STRK-71 will not prevent any test failure because no test consumes it. Update it for cleanliness if convenient; do not allocate task budget against a phantom failing test.
8. **The "Inline Name Chips" Settings panel gains one new togglable row labeled "Attachments".** Chip rendering output is unchanged for default users (attachment chip still appears in the rightmost position with `enabled: true`), but the Settings UI itself shows a visible new row that did not exist before. This is a deliberate consequence of moving the chip into the configurable pipeline, not an accidental side effect.

## Open Questions

_All open questions resolved in requirements.md. None remaining._

## Discovery Summary

STRK-71 is a narrow, well-bounded runtime change: add one entry to `INLINE_CHIP_DEFAULTS` in `js/constants.js`, ensure `attachChip` is available before `chipMap` in `js/inventory-table.js` (via block-move, lazy value, or extracted helper — approach decides), add `attachment: attachChip` to `chipMap`, and collapse the trailing `${attachChip}` in the Name cell template at `:603` so the surviving template reads `${disposition-badge}${orderedChips}`. All settings UI, persistence, backup/import/diff, and cloud-sync plumbing already handles the `inlineChipConfig` key — no changes needed there. The Settings panel will gain one new togglable row labeled "Attachments" as a deliberate UX delta. The `renderAttachmentBadge(..., { onClick })` callback API exists but is unusable here because of the `.outerHTML` string-render path that strips event listeners.

The **test surface is greenfield**: no existing Playwright spec exercises `inlineChipConfig` toggle or reorder behavior. `tests/playwright/03-settings/03-appearance.spec.js:120-131` verifies only that the container is visible; `tests/playwright/attachments/ui.spec.js:6-57` covers unit-level `renderAttachmentBadge` behavior in the default `variant: "card"` shape but not the table variant, the table row click path, or chip-config integration. AC-1..AC-7 will need a new integration spec that seeds at least one item with `attachments`, renders the table, toggles `attachment` via the Settings panel at `#inlineChipConfigContainer`, and asserts `.attach-count-chip` presence/absence and ordering in the Name cell.

---

> **Phase complete.** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch review STRK-71 discovery`, then `/sketch approach STRK-71`.

## Review Archive — discovery (2026-05-12)

_Reconciled by /sketch reconcile on 2026-05-12. Original reviewer marks preserved below for audit._

### Codex

#### What I verified

- `INLINE_CHIP_DEFAULTS`, `getInlineChipConfig()`, and `saveInlineChipConfig()` exist at `js/constants.js:1096-1147`; the key is exposed on `window` at `js/constants.js:1913-1916`.
- `inlineChipConfig` is already in sync/allowed storage at `js/constants.js:848` and `js/constants.js:937`.
- Table render loads chip config once per render at `js/inventory-table.js:403-405`; nine chips flow through `chipMap` / `orderedChips` at `js/inventory-table.js:552-566`; the attachment chip is currently built separately at `js/inventory-table.js:567-577` and appended after ordered chips at `js/inventory-table.js:603`.
- `renderAttachmentBadge(item, { variant: "table" })` returns `.attach-count-chip` or `null` at `js/attachment-ui.js:262-281`; the style exists at `css/styles.css:15151-15164`.
- Settings UI is already wired through `renderInlineChipConfigTable()` at `js/settings.js:2025-2033`, `_renderSectionConfigTable()` at `js/settings.js:2560-2647`, and the Appearance > Layout > Inline Name Chips container at `index.html:3366-3385` and `index.html:4127-4188`.
- Card views render attachment chips independently in `_cardChipsHTML()` at `js/card-view.js:627-631` and do not reference `getInlineChipConfig()` in the live repo.
- Backup/import/diff surfaces already include `inlineChipConfig`: `js/inventory-backup.js:81`, `js/inventory-backup.js:421-422`, `js/inventory-import.js:176-190`, `js/inventory-import.js:1466-1473`, `js/diff-modal.js:59-65`, and `js/diff-modal.js:149-153`.
- Existing adjacent tests cover settings container presence at `tests/playwright/03-settings/03-appearance.spec.js:120-135` and basic attachment badge behavior at `tests/playwright/attachments/ui.spec.js:6-57`.

#### Top 3 issues raised

1. **The fixture failure claim is not verified.** `tests/fixtures/settings-diff-test.json:73` is stale, but I found no test that references `settings-diff-test.json`; the discovery should not claim a diff-modal test will fail unless the consuming test is identified or added.
2. **The implementation shape is too singular for discovery.** Moving `attachChip` above `chipMap` is a reasonable approach, but discovery should name alternatives before approach, especially a lazy `chipMap` value/function or a small helper that returns the table attachment chip HTML.
3. **Adjacent test prior art is under-specified.** The broad `tests/playwright/attachments/` reference misses the targeted existing `renderAttachmentBadge()` tests, and the planned tests should explicitly include AC-7/card isolation and the table-variant click path.

#### CODEX — Unverified Assumptions

- The stale `tests/fixtures/settings-diff-test.json` fixture is actively consumed by a test or release check. I could not verify that from the repo; it appears unreferenced by current Playwright tests.
- The correct implementation is block reordering rather than a helper or lazy chip-map entry. The current block move is plausible, but alternatives should be weighed in approach.
- The existing string-based row renderer will remain in scope. If approach chooses DOM assembly instead of string rows, the attachment badge `onClick` option becomes viable, but that would be broader than this sketch currently implies.
- Cloud-sync behavior is sufficiently covered by `SYNC_SCOPE_KEYS` and the existing restore-preview paths. I verified the key inclusion, but did not run a live sync/restore flow.
- The acceptance-test plan only needs Playwright coverage. Direct unit-style browser checks for `getInlineChipConfig()` merge behavior may be cheaper and less brittle than driving every case through the Settings UI.

### Opus

#### What I verified

- Every file/line citation in the Existing Code table against the live repo (`js/constants.js:1096-1147`, `js/constants.js:848,937,1913-1916`; `js/inventory-table.js:404,552-577,603`; `js/attachment-ui.js:262-281`; `js/settings.js:2025-2033,2560-2647`; `js/card-view.js:627-631`; `index.html:4181-4188`). All lines match.
- `INLINE_CHIP_DEFAULTS` is a 9-entry array; `pcgs/serial/storage/notes/purity/tags` all default `enabled: false` (so AC-6 default-preserving behavior depends on the new `attachment` entry being `enabled: true`, as requirements resolved).
- `renderAttachmentBadge` at `js/attachment-ui.js:262-281` exposes a real `{ variant, onClick }` API. The onClick path is implemented (`addEventListener("click", ...)` at `:274`), making Codex's "why not use `onClick`?" question concrete and worth answering in the discovery.
- The merge logic at `js/constants.js:1119-1127` is forward-additive **and** silently filters out unknown saved ids (`:1121`). Documented above.
- The Name cell template at `inventory-table.js:603` is `${disposition-badge}${orderedChips}${attachChip}`, not just `${orderedChips}${attachChip}`. The disposition badge renders **before** chips and is the only system-status element in that strip.
- `rg "settings-diff-test"` returns zero references across the entire repo. The fixture is orphan documentation; the `tags`-entry omission proves the orphan status independently of STRK-71.
- No existing Playwright spec exercises `inlineChipConfig` toggle/reorder behavior. `tests/playwright/03-settings/03-appearance.spec.js:120-131` verifies only that the container is visible. The entire STRK-71 AC-1..AC-6 test surface is greenfield.
- `attach-count-chip` is rendered in exactly one place in JS (`js/attachment-ui.js:267`) and consumed in exactly one place (`js/inventory-table.js:569`). CSS at `css/styles.css:15152`.

#### Top 3 issues I raised

1. **Constraint #7 ("fixture update is mandatory") is false as written.** No test references `tests/fixtures/settings-diff-test.json`; the existing `tags`-omission drift proves no asserting consumer exists. Downgrading this to "optional courtesy" prevents tasks.md from scheduling verification work against a phantom test.
2. **The Name cell template description omits the disposition badge.** Line 603 is `${disposition-badge}${orderedChips}${attachChip}`, not just `${orderedChips}${attachChip}`. Discovery should map the full template so approach edits `:603` surgically (collapsing only `${attachChip}` into `orderedChips` while leaving the disposition badge in place — already implied by AC-3 but not stated in Existing Code).
3. **The `renderAttachmentBadge(..., { onClick })` alternative is not explicitly named and ruled out.** Codex flagged this; I'm reinforcing it. The option exists (`js/attachment-ui.js:259,266,272-278`) and a reviewer will ask why we're not using it. The discovery should explicitly state: "`onClick` is unusable here because `inventory-table.js` serializes rows via `.outerHTML`, which detaches event listeners." Without this paragraph, approach will either re-derive the answer or pick the wrong path.

#### OPUS — Unverified Assumptions

1. **The fixture orphan is intentional, not a regression.** The fixture exists but no test loads it. Possibly it was wired to a test that was deleted, or possibly it is intended as a manual QA artifact. Discovery treats it as test data without confirming which.
2. **STRK-71 ships without a follow-up issue for `saveData()` wrapper alignment.** Constraint #1 says "a follow-up issue owns that wrapper alignment" but neither requirements.md nor discovery.md cites the issue ID. If no follow-up issue has been filed, the wrapper drift quietly persists indefinitely.
3. **Approach will pick block-move over lazy chip-map value.** Codex named a viable alternative (lazy `chipMap` entry / extracted helper) but the discovery still narrates the block-move shape as if it were the only option. Approach may default to block-move without weighing the alternative.
4. **The new `attachment` chip's `enabled: true` default will not surprise users who currently see no settings UI for it.** Today the chip is unconditional; after STRK-71 it appears in the Inline Name Chips panel as a togglable row. The visual diff is real (one new row in Settings), even though chip rendering is unchanged. No acceptance criterion describes this Settings-panel delta.
5. **`scheduleSyncPush()` at `js/constants.js:1143` correctly propagates the new entry through cloud sync.** Codex verified the sync-scope key inclusion but did not run a live sync; I did not either. The `inlineChipConfig` field is in `SYNC_SCOPE_KEYS` so the new shape will be serialized, but downstream consumers (e.g., remote vault diff at `js/diff-modal.js:151` which labels the value "chip-strip") should handle the 10-entry shape unchanged — assumed, not verified.
6. **The `.attach-count-chip` CSS at `css/styles.css:15151-15164` styles the badge correctly when it sits inside `orderedChips` rather than as a trailing string.** The class is independent of DOM position so this should hold, but the discovery does not call out the visual-parity check.

### Gemini

#### What I verified
- Verified via direct codebase inspection that `getInlineChipConfig` and `saveInlineChipConfig` in `js/constants.js:1096-1147` handle the defaults and local storage precisely as described, including the silent filtering of unknown saved IDs in the merge logic.
- Verified that the Name cell template at `js/inventory-table.js:603` is `${disposition-badge}${orderedChips}${attachChip}`. The disposition badge is part of this block.
- Verified that `renderAttachmentBadge` in `js/attachment-ui.js:259-281` accepts an `onClick` option and uses `addEventListener`, which confirms it cannot be used with `.outerHTML`.
- Verified that `settings-diff-test.json` is not referenced anywhere in the repository, making it an orphan fixture.

#### Top 3 issues I raised
1. **Fixture Constraint is Invalid:** Constraint #7 is verifiably false. No test loads `settings-diff-test.json`, so failing to update it will not break any diff-modal test. It should be downgraded to optional.
2. **Name Cell Template Complexity:** The string template at line 603 is more complex than just appending `attachChip`. It conditionally prefixes the `disposition-badge`. The approach must handle this carefully.
3. **`onClick` API Unusability Must Be Explicit:** The `renderAttachmentBadge` `onClick` API is real but unusable here due to string serialization. This must be explicitly documented so the approach phase doesn't try to use it.

#### GEMINI — Unverified Assumptions
1. **String Serialization Requirement:** Assumes the table will continue to use string-based HTML serialization (`.outerHTML` and string interpolation) instead of DOM construction, preventing the use of standard event listeners for the attachment badge.
2. **Cloud Sync Compatibility:** Assumes that syncing a 10-entry array where previously there were 9 won't break any downstream consumers of the `inlineChipConfig` data, as the exact sync payload processing wasn't exhaustively traced.
3. **Card View Complete Independence:** Assumes the sibling card-view parity issue will definitely use a different storage key and won't inadvertently break if it attempts to read `inlineChipConfig` in the future.

### Resolution Summary

- **Accepted: 10**
  1. Constraint #7 downgraded from "mandatory" to "optional courtesy" (consensus)
  2. Name cell template description updated to include `${disposition-badge}` prefix; edit reframed as "collapse `${attachChip}` into `orderedChips`" (Opus, Gemini)
  3. `renderAttachmentBadge(..., { onClick })` alternative explicitly named and ruled out due to `.outerHTML` listener-stripping (consensus)
  4. "Entirely in two files" softened to "runtime app change" — test surface broader (Codex)
  5. Merge logic noted as forward-additive AND backward-filtering (Opus)
  6. Discovery Summary now states AC-1..AC-6 test surface is greenfield (Opus, Codex)
  7. `tests/playwright/attachments/ui.spec.js:6-57` added as specific prior-art pointer (Codex, Opus)
  8. Fixture row reframed as orphan documentation (consensus)
  9. Constraint #1 follow-up framing softened — no follow-up issue currently filed (Opus)
  10. New "Implementation Alternatives Considered" subsection added with block-move / lazy-value / helper shapes (Codex)
- **Rejected: 2**
  1. Card-view storage-key concern (Gemini) — already covered by Constraint #3
  2. Test strategy choice (unit vs Playwright, Codex unverified assumption) — belongs to approach/tasks, not discovery
- **Resolved with your input: 0** — no interactive Q&A this round per the no-stopping directive. Two judgment items resolved by the reconciler: (a) Settings-panel UX delta added as new Constraint #8 (codebase observation, not a new AC); (b) `saveData()` follow-up issue framing softened only, not filed from reconcile.
