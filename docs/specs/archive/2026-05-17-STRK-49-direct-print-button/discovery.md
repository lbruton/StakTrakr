---
sketch: STRK-49-direct-print-button
phase: discovery
created: '2026-05-14'
revised: '2026-05-17'
---
# STRK-49 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase. Reconciled `requirements.md` plus Lonnie's callout notes settle one key product boundary: the Print action is a global full-inventory print/export-style action. Active main-page filters, sort state, and view mode do not carry into this button; any selective print workflow belongs to a future selection modal._

> **Note:** This file was originally drafted on 2026-05-14 against the pre-reconcile requirements that hard-coded a `@media print` stylesheet mechanism. After the 2026-05-16 reconcile lifted mechanism choice into Open Questions, this file was rewritten to investigate **both** mechanism paths neutrally. The 2026-05-17 rerun incorporates Lonnie's callouts that filter/sort/view-state propagation is out of scope. The original draft is preserved at the bottom under "Pre-Reconcile Draft (Superseded)" for audit.

## Existing Code — Inventory of Touched Surfaces

### Settings > Inventory panel (HTML, single-file `index.html`)

| Path | Role | Notes |
|------|------|-------|
| `index.html:3400-3417` | Settings nav | Nav button `data-section="system"`, visible text "Inventory". Confirms reviewer rename: "Data tab" is dead wording; the live UI is **Settings > Inventory**. |
| `index.html:4623-4624` | Inventory panel header | `<div id="settingsPanel_system">` containing `<h3>Inventory</h3>`. Anchor for AC-6 regression and AC-1/AC-2/AC-5 placement. |
| `index.html:4663-4668` | `bulkEditBtn` | Inline style `padding: 0.4rem 0.9rem` — confirmed larger horizontally than card buttons. Out of scope per reconciled AC-2 (explicit non-goal). |
| `index.html:4730-4795` | **Import card** | 2-col grid (`grid-template-columns: repeat(2, 1fr)`): `importCsvOverride` + `importJsonOverride` (both `btn warning`, inline `font-size: 0.82rem; padding: 0.4rem 0.6rem; min-height: 0`), plus hidden `#importCsvFile` / `#importJsonFile` inputs and `#importProgress`. The natural insertion point for the relocated Restore ZIP control. |
| `index.html:4796-4914` | **Export card** | 2-col grid: `exportCsvBtn`, `exportJsonBtn`, `exportPdfBtn`, `exportZipBtn` (all `btn info`, 0.6rem padding, `aria-describedby="export*Desc"` + matching `<span class="sr-only">` siblings). After `exportZipDesc`, a full-width `importZipBtn` (`btn warning`, `grid-column: span 2`) and the hidden `#importZipFile` input both live in this card today. |
| `index.html:4897-4909` | Misplaced ZIP restore controls | Button `#importZipBtn` (lines 4897-4908) + hidden `<input accept=".zip" hidden id="importZipFile">` (line 4909) — both must move together (reconciled AC-5). |
| `index.html:5025-5038` | Data Reset fieldset | `<div class="settings-fieldset">` containing two buttons in `<div class="settings-btn-row">`: `#removeInventoryDataBtn` (`btn warning`, "Remove Inventory") and `#boatingAccidentBtn` (`btn danger`, "Wipe All Data"). Neither has the 0.6rem inline sizing styles used by card buttons — target of reconciled AC-6. |

### Existing button conventions (siblings of the new Print button)

The four existing Export buttons all follow this exact pattern:

```html
<button class="btn info" id="exportPdfBtn" aria-describedby="exportPdfDesc"
        title="Inventory items only — printable report"
        style="font-size: 0.82rem; padding: 0.4rem 0.6rem; min-height: 0; width: 100%">
  Export PDF
</button>
<span id="exportPdfDesc" class="sr-only">Inventory items only — printable report</span>
```

Pattern observations:
- `aria-describedby` ID matches a sibling `<span class="sr-only">` immediately after the button.
- All four use the same inline sizing.
- All four use `class="btn info"` (blue). Reconciled AC-2 specifies `btn success` (teal-green) for the new Print button to distinguish it.

### JavaScript wiring

| Path | Role | Notes |
|------|------|-------|
| `js/inventory.js:2036-2183` | `exportPdf()` — the existing jsPDF renderer | Builds a jsPDF (landscape, autoTable, 20 columns, font 7, theme striped, blue header), appends portfolio summary text, ends with `doc.save(filename)`. Line 2047 calls `sortInventoryByDateNewestFirst()` with the default arg, which is the unfiltered global `inventory`. That is aligned with Lonnie's callout that Print should behave like full-dataset CSV/JSON/PDF exports, not like a filtered main-page snapshot. |
| `js/utils.js:1210-1229` | `sortInventoryByDateNewestFirst(data = inventory)` | Signature accepts an explicit data argument — the unfiltered-default is only the call site choice in `exportPdf()`, not a hard constraint of the sort fn. |
| `js/search.js:13-30` | `filterInventory()` | Public global (`window.filterInventory = filterInventory` at line 594). Delegates to `filterInventoryAdvanced()` if present (`js/filters.js:898`), else legacy. Used by both renderers below — the source of truth for "what the user is currently looking at." |
| `js/inventory-table.js:372-409` | Table-render filter/sort pipeline | `const filteredInventory = typeof filterInventory === "function" ? filterInventory() : inventory;` then `sortInventory(filteredInventory)` (which honors active column sort, distinct from `sortInventoryByDateNewestFirst`). Then branches: if `isCardViewActive()` returns true (style A/B/C), it shows `#cardViewGrid` and hides `.portal-scroll`; else it shows the table. |
| `js/card-view.js:8-17` | `getCardStyle()` + `isCardViewActive()` | `getCardStyle()` returns `localStorage[CARD_STYLE_KEY] || "D"`. `isCardViewActive()` returns `style !== "D"` — so D = table mode, A/B/C = card mode. Card vs table is a **runtime** flag derived from localStorage, not a CSS-only toggle — relevant to whether `@media print` alone could expose the table. |
| `js/events.js:3681-3684` | Export button listeners | `optionalListener(elements.exportPdfBtn, "click", exportPdf, "PDF export")` — pattern the new Print button will follow. |
| `js/events.js:3694-3706` | Restore ZIP listener | Reads `document.getElementById("importZipBtn")` AND `document.getElementById("importZipFile")` directly (not via `elements.*`). Wiring is **purely ID-based** — moving both elements within the DOM is safe as long as both IDs are preserved together (this is the reason CODEX@68 flagged co-location). |
| `js/init.js:281-299` | `elements.*` binding | `elements.exportPdfBtn = safeGetElement("exportPdfBtn")`, `elements.removeInventoryDataBtn`, `elements.boatingAccidentBtn`. New Print button needs a parallel `elements.printBtn = safeGetElement("printBtn")` (or chosen ID) here. |
| `js/state.js` | `elements` global | Created and exposed as a global object that init.js populates and events.js reads. No code change needed beyond the new init slot. |

### Other call sites of `sortInventoryByDateNewestFirst()` (relevant to full-dataset export behavior)

`grep -n sortInventoryByDateNewestFirst js/*.js`:

- `js/inventory.js:1967` (`exportJson`) — exports unfiltered.
- `js/inventory.js:2047` (`exportPdf`) — exports unfiltered.
- `js/inventory-backup.js:166`, `js/inventory-import.js:978`, `js/inventory-import.js:1090` — backup/import flows where unfiltered is correct.

So the unfiltered-by-default behavior is intentional for **backup/export-style** outputs. Lonnie's callouts answer the product question: Print belongs in this full-dataset family for STRK-49. Any filtered/sorted/selected print variant is deferred to a future popup modal that appears after the Print click.

### Test surface (current Playwright coverage of this region)

| Path | Asserts |
|------|---------|
| `tests/playwright/settings-data-reset.spec.js:82-103` | `#settingsPanel_system` contains `#removeInventoryDataBtn` and `#boatingAccidentBtn`; the `#settingsPanel_storage` panel does NOT. Already aligned with reconciled AC-6's `#settingsPanel_system` anchor — no rename needed. |

No existing test covers `exportPdfBtn` click or any `window.print()` invocation. STAK CLAUDE.md gotcha to flag for approach: app modals (`showAppConfirm` etc.) are custom DOM, not native `confirm()` — but this is irrelevant here because the print path opens a **browser** dialog, not an app modal. The dialog is OS-owned and not observable from Playwright; that is the entire reason CODEX@40 raised the observability question (now Q2).

## Prior Art — Print Mechanisms Already in This Codebase

| Path | What it does | Relevance |
|------|--------------|-----------|
| `js/utils.js:1816-1846` | Generates a stand-alone Storage Report HTML page (separate document) and includes `<button onclick="window.print()" class="print-btn">🖨️ Print Report</button>` plus an `@media print` block at `js/utils.js:2818-2846`. | This is the **only** existing `window.print()` invocation in the app. It works because the report is a fresh HTML document with its own DOM — the `@media print` block doesn't have to fight existing layout. The main app DOM has no such block in `css/styles.css`. |
| `vendor/jspdf.umd.min.js:109` | `jsPDF.API.autoPrint = function(opts) {...}` | Confirms `autoPrint()` ships with the bundled jsPDF 2.5.1. Variants: `non-conform` (default — adds `/OpenAction` PDF catalog entry that triggers print on open) and `javascript` (adds `print({})` JS action). Approach phase needs to test browser support for both variants. |
| `vendor/jspdf.plugin.autotable.min.js` | autoTable plugin 3.5.25 | Already loaded; this is what `exportPdf()` uses for the 20-column table. |
| `index.html:63-93` | jsPDF load contract | Local `vendor/jspdf.umd.min.js` (defer) + CDN fallback via a check on `window.jspdf.jsPDF.API.autoTable`. Print path can rely on `window.jspdf.jsPDF` being available the same way `exportPdf()` already does (`js/inventory.js:2037-2043`). |
| `css/styles.css` | App stylesheet | No app-level `@media print` or `@page` rule exists. CODEX@61 (now archived) verified this. Any CSS-print mechanism creates a NEW contract here. |

## Mechanism Investigation — Two Paths for Q1

Discovery doesn't pick a winner; it surfaces what each path costs and breaks.

### Path A — jsPDF reuse (user-preferred per reconciled requirements)

What it would entail at a fact level:

- Factor `exportPdf()` so the renderer is callable in two modes: download (current `doc.save(...)`) vs print (`doc.autoPrint()` then deliver the blob to a viewer that can print). Today the rendering is one monolithic function (`js/inventory.js:2036-2183`); the data-shape work (the 20-column row map, totals, sort) is fused with `doc.save()` at the tail.
- Preserve the full-dataset export contract: keep the row source equivalent to `sortInventoryByDateNewestFirst()`'s default unfiltered global. Approach should not introduce `filterInventory()` into STRK-49's print path unless the requirements change again.
- Choose a delivery method for the print-ready PDF:
  - `doc.autoPrint(); window.open(doc.output('bloburl'))` — opens a new tab/window, native viewer auto-triggers print.
  - `doc.autoPrint(); const url = doc.output('bloburl'); const iframe = document.createElement('iframe'); iframe.src = url; ...` — hidden iframe; browser print dialog opens in current tab.
  - Each has popup-blocker / sandbox / `file://` implications that approach must verify.

What this path makes irrelevant:
- Q3 (card-view re-render). jsPDF can read directly from the inventory data pipeline instead of `#cardViewGrid` or `.portal-scroll`. The active view style has no effect on the printed output.
- "Hide app chrome" (reconciled AC-3). The browser's PDF viewer renders only the PDF — nav, sidebar, modals, footer are simply absent from the document, no CSS needed.
- "Landscape + repeating headers" (reconciled AC-4). `exportPdf()` already creates a landscape jsPDF (`new jsPDF("landscape")` at line 2044) with autoTable, which natively repeats `head` on every page.

What this path keeps live:
- AC-1 observability (Q2): the test must stub the print invocation on the generated PDF, not `window.print`.
- Browser support for `autoPrint()`: cross-browser behavior of `/OpenAction Print` in Chrome / Firefox / Safari / Edge needs verification — historically Chrome respects it, Firefox shows the PDF but does not auto-trigger print without user action, and Safari behavior has shifted across versions.

### Path B — `@media print` CSS stylesheet

What it would entail at a fact level:

- Author a new `@media print` block in `css/styles.css` (no precedent in the file today). Must hide: nav, sidebar, filters, charts, modals, footer (reconciled AC-3), the Settings modal backdrop itself (since the user must have the modal open to click Print — GEMINI hidden-modal assumption), and any toolbars.
- Add an `@page { size: landscape; }` rule (reconciled AC-4). Per the archived GEMINI assumption: browser support for `@page size` varies — Chrome and Safari honor it as a default, Firefox often defaults to the user's last print orientation choice.
- Produce a full-inventory printout that is independent of the current main-page view. The card-view DOM is `#cardViewGrid` (a `flex` container), the table DOM is `.portal-scroll` containing `#inventoryTable`. They are mutually exclusive at runtime (`js/inventory-table.js:381-409`). A pure stylesheet that prints the currently visible DOM would conflict with Lonnie's callout because it would inherit view/filter state. If CSS print is still considered, it needs a generated full-inventory print surface or an explicit pre-print render step; simply revealing `.portal-scroll` is not enough:
  - Force a synchronous table re-render before `window.print()` (which requires `renderTable()` to run with `isCardViewActive()` bypassed — there is no current API for this), or
  - Override the inline `display: none` on `.portal-scroll` AND the inline `display: flex` on `#cardViewGrid` via `!important` CSS rules in `@media print` — but the actual `<tbody>` rows are only populated when the table-mode branch of `renderTable()` ran most recently, so card-view users may print an empty or stale `<tbody>` even with the CSS override. This is the substance of GEMINI@52 / CODEX@54.
- Handle the popup case: when the Settings modal is open, `body.modal-open` (or similar) toggles styles that the print stylesheet must override.
- Trigger via `window.print()` — directly observable in Playwright by stubbing `window.print` (CODEX@40's original suggestion).

What this path keeps live:
- All of Q3 (card-view re-render) and the modal-backdrop edge case (GEMINI hidden-modal assumption), plus a stronger risk that a DOM stylesheet accidentally prints current filtered/sorted state even though STRK-49 now excludes that behavior.
- Multi-page header repetition via `thead { display: table-header-group }` — supported across Chromium, Firefox, Safari; the GEMINI assumption to verify is whether visual styling (borders, background fill on header cells) renders consistently when the header repeats.
- Header / footer rendering: browsers add their own header / footer (URL, date, page numbers) by default. Suppressing those typically requires user toggle in the print dialog; `@page { margin }` only controls white space.

### Path C — Hybrid (not requested but worth flagging for approach)

Open a hidden iframe pointed at a stripped-down, full-inventory render that has its own minimal HTML/CSS, then call the iframe's `contentWindow.print()`. This is a third path; mention it only so approach phase doesn't think there are only two options. Not investigated further here.

## Q2 — Playwright Observability Options

Mechanism choice (Q1) determines what stubs are available:

| Mechanism | Observable hook | Test sketch |
|-----------|-----------------|-------------|
| Path A: jsPDF + new tab | `window.open` | `await page.exposeBinding('windowOpenSpy', () => …)` + `page.evaluate(() => { const orig = window.open; window.open = (url, ...rest) => { window.__lastOpenUrl = url; }; })` then assert `__lastOpenUrl` starts with `blob:`. |
| Path A: jsPDF + hidden iframe | `HTMLIFrameElement.prototype.contentWindow.print` or `jsPDF.prototype.autoPrint` | Stub `autoPrint` on the constructor's API table before clicking. |
| Path B: `window.print()` | `window.print` | `await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });` then assert `__printed === 1` after click. CODEX@40's original suggestion. |

All three are mechanical. None of them assert the dialog actually appeared — that remains a manual smoke check.

## Prior Decisions (mem0 / sessionflow)

- 2026-05-17 — Lonnie's callout notes supersede the earlier AC-7 thread: Print is a global full-inventory action, similar to full CSV/JSON backups/exports. Filtering/sorting/selection controls are deferred to a future modal after the Print click.
- 2026-05-16 — Reconcile pass on `requirements.md` deferred mechanism choice to discovery (here), lifted "always print table view" from a hard requirement to a Q3 dependency, and dropped two assumed CSS contracts (`@media print` in `css/styles.css`, `@page` rule) from acceptance criteria. User's preference is jsPDF reuse.
- 2026-05-14 — Initial pre-sketch planning session locked in three scoped UI deltas: Print button placement (Export card, `btn success`, full-width), Restore ZIP relocation (Import card), Data Reset sizing (match 0.6rem card buttons).
- No prior mem0 entries reference STRK-49.

## External References

- jsPDF `autoPrint()` documentation: <https://artskydj.github.io/jsPDF/docs/jsPDF.html#autoPrint> — variants and PDF action mechanics.
- MDN `Window.print()`: <https://developer.mozilla.org/en-US/docs/Web/API/Window/print> — synchronous in most browsers, blocks until user dismisses dialog.
- MDN `@media print`: <https://developer.mozilla.org/en-US/docs/Web/CSS/@media>
- MDN `@page`: <https://developer.mozilla.org/en-US/docs/Web/CSS/@page> — `size: landscape` browser support notes.
- W3C CSS Paged Media: <https://www.w3.org/TR/css-page-3/> — `thead { display: table-header-group }` cross-browser status.
- jsPDF GitHub issue #1538 (Firefox autoPrint): historically the highest-quality cross-browser tracking issue for the `non-conform` variant.

## Constraints (Mechanism-Neutral)

- **Single-file convention.** All HTML lives in `index.html`. CSS goes in `css/styles.css`. No build step. New JS goes in an existing module file — typically `js/inventory.js` (for the print invocation, paralleling `exportPdf()`) or a small new file pulled in via `<script defer>` in `index.html`. No new dependencies.
- **`file://` parity.** The app runs on both `file://` and HTTP. Path A's `window.open(blob:)` flow has subtle differences on `file://` (some browsers block popups more aggressively). Path B's `window.print()` works identically on both protocols.
- **Script load order.** Per CLAUDE.md, `init.js` defines `safeGetElement` and loads AFTER `events.js` (both `defer`). Top-level code in `events.js` that calls `safeGetElement` throws ReferenceError; event wiring inside `optionalListener` (or any function called at init time) is fine. New Print button wiring must follow the `optionalListener` pattern, NOT live in module top-level.
- **ID-based wiring is the contract for ZIP relocation.** `js/events.js:3694-3706` reads `getElementById("importZipBtn")` and `getElementById("importZipFile")` directly. The relocation is a pure HTML move with no JS or `elements.*` change; both IDs must survive.
- **`elements.*` slot for new button.** Per `js/init.js:281-299` pattern, the new Print button needs a corresponding `elements.printBtn = safeGetElement("...")` line for `events.js` to wire it. ID choice is the obvious open detail — `printBtn` is the natural extension of `exportPdfBtn` / `exportZipBtn`.
- **Modal close before print (Path B specific).** If Path B wins, the Settings modal is open when the user clicks Print. The handler must dismiss the modal before triggering `window.print()` (or the print stylesheet must hide the modal). For Path A, this is moot — the PDF is opened externally and the modal is irrelevant to the printed output.
- **Codacy CLI mutation gotcha** (project-specific). Per CLAUDE.md, `.codacy/cli.sh analyze` rewrites `.codacy/codacy.yaml` — approach phase needs to plan for the revert step in CLOSE-2 either way.
- **`stamp-sw-cache` pre-commit hook** (project-specific). Per CLAUDE.md, JS/CSS commits auto-stage `sw.js`. New CSS / JS in this sketch will trigger that — not a blocker, just a fact.

## Open Questions Forwarded to Approach

The reconciled requirements left three open questions. Discovery surfaces facts; approach decides. Updated framing with discovery findings:

- **Q1 — Mechanism (jsPDF reuse vs. `@media print` stylesheet).** User preference is jsPDF reuse. Discovery confirms jsPDF 2.5.1 + `autoPrint()` ship in the bundled `vendor/jspdf.umd.min.js`. Lonnie's callout makes full-dataset output a fixed constraint, not a mechanism-dependent open question. **Outstanding for approach:**
  1. Pick Path A (jsPDF reuse), Path B (CSS print), or Path C (hybrid iframe).
  2. If Path A: pick a delivery sub-mechanism (`window.open(bloburl)` new tab vs. hidden iframe).
  3. If Path A: verify `autoPrint()` `non-conform` variant fires correctly in Firefox (historical wrinkle).
  4. If Path A: decide whether `exportPdf()` (download path) is refactored to share the renderer with print, or whether print is a parallel function that copies the row/column logic.
- **Q2 — Playwright observability for AC-1.** Resolution follows Q1 — see the table in "Q2 — Playwright Observability Options" above. **Outstanding for approach:** pick the exact stub strategy once Q1 lands.
- **Q3 — Card-view rendering behavior.** **Dissolves under Path A.** If Q1 lands on Path B, Q3 re-activates in a narrower form: approach must ensure the CSS/DOM path prints a full-inventory surface instead of the current card/table/filter state.
- **Q4 — RESOLVED by callout — filter/sort propagation.** Do not propagate active main-page filter/sort state for STRK-49. Keep Print aligned with full-dataset export behavior. Future selective print behavior belongs to a popup modal after the Print click and should be a follow-up issue/spec, not hidden work in this sketch.
- **Q5 — NEW, surfaced by discovery — `aria-describedby` text content for the Print button.** Reconciled AC-1's example text says "Direct browser print of current inventory view", but the callout means "current view" is now misleading. **Outstanding for approach:** choose copy that says full inventory, e.g. "Direct browser print of your full inventory", before tasks.md.

## Discovery Summary

The work spans three layers but is concentrated in `index.html` + 2-3 JS files + (conditionally) `css/styles.css`. The relocation (AC-5) and Data Reset sizing (AC-6) are pure HTML edits with verified zero-risk wiring impact. The new Print button (AC-1, AC-2) follows a well-established export-button pattern with `aria-describedby` sibling spans. Lonnie's callout resolves the earlier filter/sort ambiguity: STRK-49 prints the full inventory, matching the export/backup family, and selective print is future modal work. The substantive open work is now Q1: mechanism choice and, if jsPDF reuse wins, the PDF delivery method that best triggers browser print. Q2 and Q3 derive cleanly from Q1's answer. No new dependencies are needed; jsPDF + `autoPrint()` is already bundled.

---

> **Phase complete?** Existing code mapped with verified line numbers. Mechanism paths investigated without picking a winner. Open questions forwarded with concrete sub-decisions. Then advance: `/sketch review STRK-49 discovery`, then `/sketch reconcile STRK-49 discovery`, then `/sketch approach STRK-49`.

---

## Pre-Reconcile Draft (Superseded)

_The following is the original 2026-05-14 discovery draft, written before the 2026-05-16 reconcile lifted mechanism choice into Open Questions. Preserved verbatim for audit; do not act on its mechanism-specific claims. The active discovery is above._

### Existing Code

| Path | Role | Notes |
|------|------|-------|
| `index.html:4769–4783` | Import card button grid | 2-col grid with Import CSV + Import JSON (`btn warning`). Restore ZIP goes here. |
| `index.html:4825–4910` | Export card button grid | 2-col grid: Export CSV, JSON, PDF, ZIP (`btn info`) + full-width Restore ZIP (`btn warning`, `grid-column: span 2`). Restore ZIP moves out; Print button takes its slot. |
| `index.html:4897–4909` | Restore ZIP button + hidden file input | `#importZipBtn` button + `#importZipFile` input — both must move together to the Import card. |
| `index.html:5025–5038` | Data Reset fieldset | `#removeInventoryDataBtn` (`btn warning`) and `#boatingAccidentBtn` (`btn danger`) — missing the inline sizing styles used by card buttons. |
| `js/events.js:3695–3703` | Restore ZIP event wiring | `getElementById("importZipBtn")` click → triggers `importZipFile.click()`. Change handler calls restore logic. Wiring is ID-based, so moving the HTML doesn't break it. |
| `js/events.js:3684` | Export PDF event wiring | `optionalListener(elements.exportPdfBtn, "click", exportPdf)` — pattern to follow for Print button. |
| `js/events.js:3542,3567` | Data Reset event wiring | `elements.removeInventoryDataBtn` and `elements.boatingAccidentBtn` — no changes needed to JS wiring, only HTML styling. |
| `js/inventory.js:2036–2098` | `exportPdf()` | jsPDF-based PDF export with landscape, autoTable, column headers. Print feature does NOT reuse this — it uses `window.print()` with CSS instead. But the column list here documents what users expect to see in printed output. |
| `js/utils.js:1845` | Existing `window.print()` usage | Storage report page has a print button and `@media print` block (lines 2818–2846). Prior art for print-hide patterns in the codebase. |
| `css/styles.css:1441–1472` | Button variant classes | `.btn.success` (teal-green, `--success`), `.btn.info` (blue), `.btn.warning` (orange), `.btn.danger` (red). All exist; Print will use `success`. |
| `css/styles.css:51–58` | Color token definitions | `--success: oklch(0.596 0.127 163.2)` — muted teal-green. Distinct from `--info: oklch(0.685 0.148 237.3)` blue. Good visual separation. |
| `js/state.js:108` | `elements.exportPdfBtn` | State slot for PDF button reference. Print button needs a similar slot. |
| `js/init.js:292` | `safeGetElement("exportPdfBtn")` | Init pattern for button refs. Print button follows this. Note: `safeGetElement` is only available at runtime (not top-level in `events.js`). |

### Prior Decisions

- 2026-05-16 — Layout decisions made in pre-sketch planning session with user: Restore ZIP → Import card, Print button full-width in Export card using `btn success`, Data Reset buttons get consistent sizing. Colors stay as-is.
- The existing `@media print` block in `utils.js:2818` is scoped to the storage report page (an injected HTML page), not the main app. A new `@media print` block targeting the main app DOM is needed in `css/styles.css`.

### External References

- [MDN @media print](https://developer.mozilla.org/en-US/docs/Web/CSS/@media) — standard approach, wide browser support
- [MDN @page](https://developer.mozilla.org/en-US/docs/Web/CSS/@page) — `size: landscape` for default orientation
- `thead { display: table-header-group }` — repeating table headers across pages is CSS2, universally supported

### Constraints

- **No build step:** CSS goes in `css/styles.css`, not a separate print stylesheet file (single-file convention). The `@media print` block at the bottom of the file is idiomatic.
- **`file://` compatibility:** `window.print()` works on `file://` — no server required.
- **Script load order:** Print button event wiring in `events.js` must use `document.getElementById` (not `safeGetElement`) at top-level, OR wire via `optionalListener` which runs at init time after all scripts load.
- **ID-based wiring:** Restore ZIP's `importZipBtn` / `importZipFile` event listeners use `getElementById` — moving the HTML elements doesn't break the wiring as long as IDs are preserved.
- **Settings modal must close before print:** The modal covers the inventory view. Print handler must close the settings modal, then call `window.print()` (possibly with a brief delay to let the DOM settle).
- **View-dependent output:** The user sees either card view or table view. Print should show whichever view is currently active, not force a switch.

### Open Questions

_None — resolved during planning session._ (Note 2026-05-16: this claim was wrong — the reconcile pass surfaced three open questions Q1/Q2/Q3, plus discovery surfaced Q4/Q5.)

### Discovery Summary

The Print button is a lightweight feature: a new `btn success` in the Export card, a `@media print` block in `css/styles.css` to hide app chrome, and `window.print()`. The Restore ZIP relocation is a pure HTML move (IDs preserved = wiring intact). Data Reset styling is a 2-line HTML change. The existing `exportPdf` path (jsPDF) is irrelevant — Print uses the browser's native rendering. The one subtle bit is closing the settings modal before printing so the inventory is visible.

_(End of superseded draft. See top of file for active discovery.)_
