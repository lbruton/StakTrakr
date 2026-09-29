---
sketch: STRK-49-direct-print-button
phase: approach
created: "2026-05-14"
revised: "2026-05-17"
---

# STRK-49 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

> **Revision note:** This file was rewritten on 2026-05-17 to align with the reconciled requirements (mechanism-neutral ACs, full-dataset print scope per Lonnie's callouts) and the updated discovery (jsPDF reuse as user-preferred path). The previous draft hard-coded a `@media print` CSS approach that predated the reconcile.

## High-Level Architecture

The Print feature reuses the existing jsPDF + autoTable rendering pipeline (`js/inventory.js:2036-2183`) to produce a landscape PDF of the full inventory, then opens it in a new browser tab with `autoPrint()` enabled so the browser's native print dialog fires automatically in supported browsers. This is **Path A (jsPDF reuse)** from discovery — the user-preferred mechanism that sidesteps card-view/table-view DOM ambiguity, inherits the existing 21-column landscape layout with repeating headers, and produces a full-dataset output aligned with CSV/JSON/ZIP export behavior.

**Browser support note:** `autoPrint()` writes a `/OpenAction Print` entry to the PDF catalog. Chrome, Edge, and Safari respect it and trigger the native print dialog. Firefox opens the PDF but does not auto-trigger print — the user sees the correct output and must manually Ctrl+P. This is an accepted v1 limitation (see Tradeoff #1). A follow-up issue will explore Firefox/other-browser fallback mechanisms.

The implementation adds a thin `printInventory()` function that calls a shared renderer (factored out of `exportPdf()`) in "print mode" — `doc.autoPrint()` + `window.open(doc.output("bloburl"))` instead of `doc.save(filename)`. A new `btn success` button in the Export card wires to this function via `optionalListener`. The Settings modal does NOT need to close before printing because the PDF opens in a separate tab — the modal is irrelevant to the printed output.

Two UI-hygiene fixes ship alongside: Restore ZIP relocation (pure HTML move, zero JS impact) and Data Reset button sizing (inline style addition).

## Key Decisions

| #   | Decision                                                                                   | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Tradeoff                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **jsPDF reuse with `autoPrint()` + `window.open(bloburl)`** — not `@media print` CSS       | Reuses the proven 21-column layout, works identically regardless of card/table view state, produces full-dataset output without fighting DOM filter/sort state, no new CSS contract needed. User-preferred per reconciled requirements Q1. "PDF viewer auto-print" is the accepted interpretation of AC-1's print-dialog promise — browsers that support `/OpenAction Print` get the dialog automatically; Firefox users see the PDF and print manually (accepted v1 limitation). | Less "native" than `window.print()` — opens a new tab with the PDF viewer rather than printing the current page. Acceptable: the PDF viewer provides a richer preview than most browser print dialogs. Firefox degrades to manual Ctrl+P (see Tradeoff #1).                                                                                                                                                                                                            |
| D-2 | **New tab (`window.open`) rather than hidden iframe**                                      | Popup is visible, user can dismiss/interact naturally, avoids iframe sandboxing edge cases on `file://`, and the tab shows the PDF preview as a bonus.                                                                                                                                                                                                                                                                                                                            | Popup blockers may suppress the `window.open` if the call isn't in a direct click handler's synchronous stack. Mitigation: the entire path from button click to `window.open` is synchronous (no async/await between), so browsers classify it as user-initiated. Additionally, the implementation checks the return value — `const popup = window.open(url, "_blank"); if (!popup) { appAlert(...) }` — matching the established pattern in `viewModal.js:1570-1579`. |
| D-3 | **Factor a shared renderer, don't duplicate `exportPdf()`**                                | The 21-column row map, totals calculation, title, and autoTable config (80+ lines) should not be copied. A shared `_buildInventoryPdf()` returns the `doc` object; `exportPdf()` calls `doc.save()`; `printInventory()` calls `doc.autoPrint()` + `window.open()`.                                                                                                                                                                                                                | Refactoring the existing function introduces a small regression risk — mitigated by adding a focused PDF export/print Playwright regression test + a manual PDF export verification after the refactor.                                                                                                                                                                                                                                                                |
| D-4 | **No modal close needed before print**                                                     | Under jsPDF reuse, the PDF renders in a new tab. The Settings modal being open is irrelevant to the printed output (unlike the `@media print` path where the modal would overlay the print content).                                                                                                                                                                                                                                                                              | None — strictly simpler than the CSS path.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D-5 | **`btn success` (teal-green), full-width span in Export card grid**                        | Visually distinct from `btn info` (blue) export/download buttons. Semantic: green = "view/produce" vs blue = "save file to disk". `grid-column: span 2` fills the row vacated by ZIP restore's removal.                                                                                                                                                                                                                                                                           | Adds a second color to the Export card, but the semantic distinction (download vs. immediate action) is clear.                                                                                                                                                                                                                                                                                                                                                         |
| D-6 | **`aria-describedby="printDesc"` with text "Direct browser print of your full inventory"** | Follows the exact sibling-span pattern of the other four export buttons. Text avoids "current view" language per Lonnie's callout — it's always the full inventory.                                                                                                                                                                                                                                                                                                               | None.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D-7 | **Playwright test stubs `window.open` (not `window.print`)**                               | Under Path A, the observable hook is `window.open` being called with a `blob:` URL. The browser's print dialog is triggered by the PDF's `/OpenAction` — not testable from Playwright. Stub `window.open`, assert it received a blob URL.                                                                                                                                                                                                                                         | The test doesn't prove the print dialog fires — that's a manual smoke check on each supported browser (Chrome, Edge, Safari auto-print; Firefox manual Ctrl+P). Acceptable: same observability limit as PDF export today.                                                                                                                                                                                                                                              |

## File Map

### New

- `tests/playwright/settings-print-button.spec.js` — Print button presence, `window.open` stub fires with blob URL, Restore ZIP relocation, Data Reset sizing, PDF export regression (`doc.save` spy)

### Modified

- `index.html` — (1) Move `#importZipBtn` + `#importZipFile` from Export card to Import card (AC-5), (2) Add Print button with `aria-describedby` span in Export card (AC-1, AC-2), (3) Add inline sizing styles to `#removeInventoryDataBtn` and `#boatingAccidentBtn` (AC-6)
- `js/inventory.js` — (1) Extract shared `_buildInventoryPdf()` from `exportPdf()`, (2) Add `printInventory()` that calls `_buildInventoryPdf()` then `doc.autoPrint()` + `window.open(doc.output("bloburl"))`
- `js/state.js` — Add `printBtn: null` to the Export elements block (alongside `exportCsvBtn`, `exportJsonBtn`, `exportPdfBtn`)
- `js/events.js` — Add `optionalListener(elements.printBtn, "click", printInventory, "Print inventory")` alongside the existing export listeners
- `js/init.js` — Add `elements.printBtn = safeGetElement("printBtn")` in the elements initialization block

### Deleted

- _None_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes.

## Tradeoffs Surfaced for Review

1. **Firefox `autoPrint()` behavior.** The `non-conform` variant (which adds `/OpenAction Print` to the PDF catalog) is the jsPDF default. Chrome, Edge, and Safari respect it; Firefox historically opens the PDF but does not auto-trigger print — the user sees the PDF and must manually Ctrl+P. This is a known jsPDF issue (#1538). Options:
   - Accept the Firefox limitation — the user still sees the correct output and can print manually. This is the v1 recommendation.
   - Alternatively, use the `javascript` variant (`doc.autoPrint({variant: "javascript"})`) which injects a JS print action — but Firefox blocks JS in PDF viewers since FF 88+.
   - A future enhancement could detect Firefox and fall back to `iframe.contentWindow.print()` on the blob URL, but that's scope creep for STRK-49. **A follow-up issue will be filed for Firefox/other-browser fallback exploration.**

   **Accepted v1 limitation:** Firefox's no-auto-print behavior is compatible with the softened AC-1 wording ("triggers print dialog in supported browsers; opens PDF preview in Firefox"). Tasks must carry a browser-support note documenting this so it does not look like an unqualified pass.

2. **Popup blocker risk.** The `window.open(bloburl)` call is synchronous in the click handler's stack, so browsers classify it as user-initiated and exempt it from popup blocking. If a future refactor introduces an `await` between the click and `window.open`, the popup will be blocked. The implementation must keep the path synchronous — this is a constraint to document in code (brief inline comment on the `window.open` line).

3. **`_buildInventoryPdf()` refactor scope.** The shared renderer is extracted from the existing `exportPdf()` body. The refactor touches a working function — existing test coverage (if any) and a manual PDF export check after the refactor are the safety net. Discovery found no Playwright test for `exportPdfBtn` click today, so the manual check is important.

## Out of Scope (follow-up issues)

- **Filtered/sorted/selected print** — Lonnie's callout defers this to a future popup modal that triggers on Print click. Separate issue when needed.
- **Custom print header with logo/date** — the jsPDF output already includes a title line (`doc.text("StakTrakr Inventory...", ...)` at `inventory.js:2052`); a branded header/footer is a future enhancement.
- **Print-specific column selection** — letting users choose which of the 21 columns appear in print output. Separate feature.
- **Firefox/other-browser auto-print fallback** — follow-up issue to explore browser detection + `iframe.contentWindow.print()` fallback for browsers that don't honor PDF `/OpenAction Print`. Filed as accepted v1 limitation.
- **`@media print` fallback for main page** — if a future feature needs to print the current visible page (not a PDF export), that's when a CSS print stylesheet enters the codebase.

## Risk Notes

- Risk: Popup blocker suppresses `window.open` on `file://` protocol in some browsers (Safari is strictest) -> mitigation: test on `file://` during implementation. If blocked, `window.open()` returns `null` (it does not throw). The implementation uses `const popup = window.open(url, "_blank"); if (!popup) { appAlert("Your browser blocked the print window — allow popups for this page"); }` — matching the established pattern in `viewModal.js:1570-1579`.
- Risk: Refactoring `exportPdf()` into shared `_buildInventoryPdf()` introduces subtle regression in PDF export -> mitigation: after the refactor, manually verify that Export PDF still produces the same output. The refactor is purely structural (extract function, return `doc` instead of calling `doc.save()`).
- Risk: `autoPrint()` adds a `/OpenAction` entry to the PDF that persists if the user saves the PDF from the print tab -> mitigation: acceptable. The saved PDF will attempt to auto-print on next open, which matches user intent (it's a print-oriented document). If this is undesirable, the `bloburl` is ephemeral and not saveable in most browsers anyway.

---

> **Phase complete?** Architecture is clear (jsPDF reuse, new-tab delivery, shared renderer). Decisions logged with rationale and tradeoffs. File map is complete with per-file change descriptions. Firefox limitation and popup-blocker risk surfaced for user review. Next: `/sketch review STRK-49 approach`, then `/sketch tasks STRK-49`.

## Review Archive — approach (2026-05-16)

_Reconciled by /sketch reconcile on 2026-05-16. Original reviewer marks preserved below for audit._

### Codex

**Verified:**

- `approach.md` had no existing unreconciled `CODEX` review blocks before this pass.
- Existing PDF export is a monolithic `exportPdf()` that checks `window.jspdf.jsPDF`, creates `new jsPDF("landscape")`, maps full inventory data, runs `doc.autoTable()`, writes summary totals, and calls `doc.save()`: `js/inventory.js:2036-2183`.
- The PDF table currently has 21 row/header columns, not 20: `js/inventory.js:2075-2097`, `js/inventory.js:2103-2125`.
- The jsPDF/autotable assets are loaded in `index.html:63-93`, and script order loads `inventory.js` before `events.js` before `init.js`: `index.html:8504-8525`.
- Export listeners use `optionalListener(elements.exportPdfBtn, "click", exportPdf, "PDF export")`: `js/events.js:3681-3684`; `init.js` fills export button refs at `js/init.js:290-292`; `state.js` declares those export refs at `js/state.js:105-108`.
- ZIP restore relocation is ID-safe if both nodes move together: the HTML currently places `#importZipBtn` and `#importZipFile` in the Export card at `index.html:4897-4909`, while events read both IDs directly at `js/events.js:3694-3706`.
- Data Reset sizing gap is real: `#removeInventoryDataBtn` and `#boatingAccidentBtn` currently have no inline card-button sizing at `index.html:5031-5038`; existing regression coverage only asserts location at `tests/playwright/settings-data-reset.spec.js:82-103`.
- Bundled jsPDF exposes `autoPrint()`; its default implementation writes a named Print action and catalog `/OpenAction` in `vendor/jspdf.umd.min.js` around the "jsPDF Autoprint Plugin" block.

**Top concerns:**

1. AC-1 still says the browser print dialog opens, but the chosen new-tab PDF path can degrade to "PDF tab opened, user must press print" in Firefox. That may be acceptable, but it needs to be an explicit accepted limitation rather than an implied pass.
2. The File Map omits `js/state.js` even though the new `elements.printBtn` slot follows an established `state.js` -> `init.js` -> `events.js` cached-DOM pattern.
3. Popup-blocker mitigation needs a concrete null-return check for `window.open()`, not just synchrony and `try/catch`. Otherwise the stated user-facing alert may not fire.

**Unverified assumptions:**

- Assumes the product owner accepts PDF-viewer auto-print as satisfying "browser native print dialog" even when the current page itself does not call `window.print()`.
- Assumes Firefox's "open PDF but do not auto-print" behavior is acceptable for STRK-49 v1.
- Assumes no supported browser requires the hidden-iframe variant to meet the one-click print expectation.
- Assumes tasks will add or define a focused PDF export regression, since I did not find an existing one to run after the renderer refactor.
- Assumes a blob URL opened in a new tab does not need explicit lifecycle cleanup for this workflow.
- Assumes adding `elements.printBtn` dynamically without a `state.js` declaration would work, but the project convention still favors declaring it.
- Assumes manual smoke checks on HTTP and `file://` are available before the PR is treated as ready.

### Resolution Summary

- Accepted: 5 (21-column count fix, state.js File Map addition, null-return popup check, new PDF regression test language, D-7 manual smoke note)
- Rejected: 1 (blob URL lifecycle cleanup — ephemeral blob URLs GC'd on tab close; not load-bearing)
- Resolved with user input: 2 (AC-1 Firefox degradation → soften wording + follow-up issue; state.js → add to File Map)
