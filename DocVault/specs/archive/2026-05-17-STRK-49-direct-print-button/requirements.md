# STRK-49 — Requirements

> **Source Issue:** [STRK-49](https://plane.lbruton.cc/lbruton/browse/STRK-49/)
> **Title:** Direct Print button (browser print of inventory)
>
> **Problem:** Today users can Export PDF and then print from the PDF viewer. Excel users coming from a spreadsheet workflow expect a one-click **Print** action that opens the browser's native print dialog directly.
>
> **Proposed:** Add a **Print** button next to Export PDF in the Settings/Backup menu. Behavior:
>
> - Apply a print-friendly stylesheet (`@media print`): hide chrome, navigation, filters, and chart components; preserve list/table view.
> - Default to landscape orientation, repeating headers per page.
> - Trigger `window.print()`.
>
> Cheap reuse path: most of the layout work is already done for Export PDF — could share the underlying renderer or piggyback on the same DOM with a print-only stylesheet.
>
> **Source:** Reddit ISO-Lost-Marbles, Q19 — `DocVault/Inbox/Reddit User Feedback - StakTrakr.md`.

## Overview

Add a one-click **Print** button to the Settings > Inventory tab (`#settingsPanel_system`) that opens the browser's native print dialog with a print-optimized view of the inventory. Bundle two UI-hygiene fixes discovered during layout planning: relocate the misplaced "Restore ZIP Backup" button from the Export card to the Import card, and normalize Data Reset button sizing to match the rest of the modal.

## User Stories

- **US-1:** As an inventory owner, I want a single Print button that opens my browser's print dialog, so that I can print my inventory without the extra step of exporting a PDF first.
- **US-2:** As a user managing backups, I want the Restore ZIP Backup button in the Import card (not Export), so that import/restore actions are grouped logically.
- **US-3:** As a user, I want the Data Reset buttons to look consistent with the other card buttons, so that the Settings modal feels polished.

## Acceptance Criteria

### AC-1 — Print button exists and triggers print (maps to US-1)

- **Given** the Settings modal is open on the Settings > Inventory tab
- **When** the user clicks the "Print" button in the Export card
- **Then** the browser's native print dialog opens
- **And** the Print button has an `aria-describedby` attribute pointing to a hidden description span (e.g. `printDesc` → "Direct browser print of current inventory view") for parity with the other export buttons (CSV/JSON/PDF/ZIP)

### AC-2 — Print button styling (maps to US-1)

- **Given** the Settings modal is open on the Settings > Inventory tab
- **When** the user views the Export card
- **Then** the Print button uses `btn success` (teal-green), spans the full width of the 2-column grid (`grid-column: span 2`), and matches the inline sizing of the existing 0.6rem-padded export buttons (`font-size: 0.82rem; padding: 0.4rem 0.6rem; min-height: 0`). The Bulk Editor button (`bulkEditBtn`, `0.9rem` padding) is explicitly out of scope and retains its existing emphasis.

### AC-3 — Print stylesheet hides app chrome (maps to US-1)

- **Given** the print dialog is triggered
- **When** the browser renders the print preview
- **Then** navigation, sidebar, filters, charts, modals (including the Settings modal itself), and footer are hidden; only the inventory list/table view and a minimal header are visible

### AC-4 — Print uses landscape with repeating table headers (maps to US-1)

- **Given** the print dialog is triggered
- **When** the browser renders the print preview
- **Then** the printed output is in landscape orientation and table column headers repeat on every page

### AC-5 — Restore ZIP relocated to Import card (maps to US-2)

- **Given** the Settings modal is open on the Settings > Inventory tab
- **When** the user views the Import card
- **Then** "Restore ZIP Backup" appears below the Import CSV / Import JSON buttons as a full-width button, and is no longer present in the Export card. The hidden `#importZipFile` input is relocated together with `#importZipBtn` so the existing listener contract in `js/events.js:3694-3699` (which depends on both IDs) remains intact.

### AC-6 — Data Reset buttons match card button sizing (maps to US-3)

- **Given** the Settings modal is open on the Settings > Inventory tab (`#settingsPanel_system`)
- **When** the user views the Data Reset section
- **Then** "Remove Inventory" and "Wipe All Data" buttons use the same inline sizing styles as the other 0.6rem-padded card buttons (`font-size: 0.82rem; padding: 0.4rem 0.6rem; min-height: 0`) while retaining their existing colors (warning orange and danger red). Any new regression assertion is anchored to `#settingsPanel_system` (consistent with `tests/playwright/settings-data-reset.spec.js:82-103`), not the older Storage/Data-tab wording.

### ~~AC-7 — Print output reflects active filter and sort state (maps to US-1)~~

- ~~**Given** the user has applied a filter and/or sort to the inventory~~
- ~~**When** the user clicks Print~~
- ~~**Then** the printed output shows the same filtered/sorted inventory currently visible on screen, not the full unfiltered dataset~~

> Lonnie: AC-7 was not in scope per the original issue, the print button is a global print, any filtering needs to be done via a selection modal after the print button is pressed, this feature is not a dependent of any of the main page search/filter views. This is an independent function.  
> Likewise a full backup of CSV/JSON is expected to be the full dataset, not a filtered view.

## Non-Goals

- Not building a custom print layout engine — reusing the browser's native print pipeline (specific mechanism — `@media print` stylesheet, jsPDF reuse, or other — is a discovery decision).
- Not adding print preview within the app — the browser's native print dialog serves this purpose.
- Not changing Export PDF behavior or its underlying renderer surface — Print is a separate user-facing action even if it ends up sharing the renderer internally.
- Not redesigning the Settings modal layout beyond the scoped changes above.
- Not normalizing `bulkEditBtn` padding — its 0.9rem emphasis is intentional.

## Open Questions

- **Q1 — Print mechanism (for discovery):** Evaluate reusing `exportPdf()`'s jsPDF renderer (`js/inventory.js:2036-2182`) and invoking browser print on the resulting PDF document, vs. authoring a new app-level `@media print` stylesheet in `css/styles.css`. User preference is the jsPDF-reuse path because it sidesteps the card-view-vs-table-view rendering ambiguity (`js/inventory-table.js:381-409`, `js/card-view.js:8-16`) and inherits the existing landscape/repeating-header layout. Discovery must verify: feasibility of `jsPDF.autoPrint()` + blob-URL print flow across supported browsers, accuracy of filter/sort propagation from the live UI into the jsPDF builder, and whether any new CSS contract is needed at all.
- **Q2 — Playwright observability (for discovery, depends on Q1):** Define the mechanical acceptance check for AC-1. If jsPDF-reuse wins, the test stubs the print trigger on the generated PDF window/iframe; if a CSS print stylesheet is used, the test stubs `window.print()` directly. The user-visible promise in AC-1 remains "browser print dialog opens."
- **Q3 — Card-view rendering behavior (for discovery, likely resolved by Q1):** Today, Card Views A/B/C hide `.portal-scroll` and show `#cardViewGrid`; only style D is table mode. If Q1 lands on jsPDF reuse, the DOM view-state is irrelevant and Q3 dissolves. If Q1 lands on a CSS print stylesheet, discovery must specify whether print forces a table re-render or prints whichever view is active.

> Lonnie: Again, the state of the main page rendering has no load bearing on the output of this button, the behavior is as expected from any other backup method, a full printout of the inventory. Any filtering or sorting options will be deferred to a future popup modal that triggers on click of the print button.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions are scoped to discovery, not blocking. Next: `/sketch review STRK-49 discovery` _after_ `/sketch discovery STRK-49`.

## Review Archive — requirements (2026-05-16)

_Reconciled by `/sketch reconcile` on 2026-05-16. Original reviewer marks preserved verbatim below for audit. Inline `> CODEX:` / `> GEMINI:` blocks from the body have been moved into the per-agent subsections under "Inline Marks" so the body of this file represents the post-reconciliation requirements._

### Codex

**Top-level review section (verbatim):**

#### Verified

- The Settings surface is currently named Inventory, reached by `data-section="system"`, with panel `#settingsPanel_system`: `index.html:3400-3417`, `index.html:4622-4624`, `js/settings.js:46-56`.
- The current Export card contains CSV/JSON/PDF/ZIP export buttons plus the misplaced ZIP restore button/input: `index.html:4825-4910`.
- Import CSV/JSON live in the Import card immediately before the Export card: `index.html:4730-4785`.
- Existing import/export event wiring uses `elements.exportPdfBtn` for PDF and `document.getElementById("importZipBtn")` plus `#importZipFile` for ZIP restore: `js/events.js:3681-3699`, `js/init.js:281-292`.
- `exportPdf()` is a jsPDF landscape export path, separate from browser `window.print()`: `js/inventory.js:2036-2182`.
- The only existing `window.print()` / `@media print` path found is the generated storage report HTML, not the main app inventory view: `js/utils.js:1816-1846`, `js/utils.js:2818-2825`.
- Card/table rendering is stateful: card styles A/B/C hide `.portal-scroll`, while style D is table mode: `js/card-view.js:8-16`, `js/inventory-table.js:381-409`.
- Data Reset button location is already covered by regression tests against `#settingsPanel_system`: `tests/playwright/settings-data-reset.spec.js:82-103`.

#### Top concerns

1. The "Data tab" wording is stale relative to the live Settings > Inventory UI and will make requirements/tests ambiguous.
2. The print-output ACs do not define whether print forces table mode or respects active card view, even though the live app can hide the table in card modes.
3. AC-5 should relocate the ZIP file input with the button, because the listener contract needs both IDs even though only the button is visible.

#### Unverified assumptions

- Assumes the product decision is to always print the table/list view, not card styles A/B/C.
- Assumes browser print orientation via `@page { size: landscape; }` is acceptable even though browser support and user print settings can override it.
- Assumes a stubbed `window.print()` Playwright check plus manual print-preview check is sufficient for AC-1/AC-3/AC-4.
- Assumes the two UI-hygiene fixes are intentionally in scope for STRK-49 rather than follow-up cleanup.

**Inline Marks (verbatim, with original location context):**

- **At Overview (was line 23):**

  > CODEX: Live UI names this surface Settings > Inventory, not Settings Data. The nav button is `data-section="system"` with visible text "Inventory" in `index.html:3400-3417`, and the panel is `#settingsPanel_system` with `<h3>Inventory</h3>` in `index.html:4622-4624`. Please either rename the requirement wording to "Settings > Inventory" or explicitly require a tab rename, otherwise implementers/tests may chase a nonexistent Data tab.

- **At AC-1 (was line 40):**

  > CODEX: The intent is sound, but "native print dialog opens" is not directly observable in Playwright. Make the mechanical acceptance check "clicking the button calls `window.print()` once" and keep the human/manual check for the browser dialog. Existing export listeners are bound in `js/events.js:3681-3684`; a new print button likely needs the same binding pattern plus a test that stubs `window.print`.

- **At AC-3 (was line 54):**

  > CODEX: Please decide whether print always forces table mode or prints the user's active view. Today A/B/C card views hide `.portal-scroll` and show `#cardViewGrid` (`js/inventory-table.js:381-387`), while table mode is only style `D` (`js/card-view.js:8-16`). If this AC means "always print the table," the print stylesheet must explicitly hide `#cardViewGrid`/sort controls and override the inline-hidden `.portal-scroll`/`#inventoryTable` state, or card-view users may not get the promised table/list output.

- **At AC-4 (was line 61):**

  > CODEX: AC-4 should also require the main app stylesheet to own this, because the only existing `@media print` is inside the generated storage report HTML in `js/utils.js:2818-2825`; `css/styles.css` currently has no app-level `@media print` or `@page` rule. That makes this a new CSS contract, not reuse of an existing app print stylesheet.

- **At AC-5 (was line 68):**

  > CODEX: Include the hidden `#importZipFile` input in this relocation contract. The current Export card contains both `#importZipBtn` and `#importZipFile` in `index.html:4897-4909`, and the listener depends on both IDs in `js/events.js:3694-3699`. Moving only the visible button would satisfy the wording but leave the import control split across cards.

- **At AC-6 (was line 75):**
  > CODEX: Existing regression tests already assert these danger buttons live in `#settingsPanel_system`, not Storage (`tests/playwright/settings-data-reset.spec.js:82-103`). Tie any new sizing test to Settings > Inventory / `#settingsPanel_system` so STRK-49 does not accidentally revive the older Storage/Data-tab wording.

### Gemini

**Top-level review section (verbatim):**

#### Verified

- The \"Inventory\" header and panel ID match `CODEX` verification: `index.html:4623-4624`.
- `bulkEditBtn` uses `0.9rem` padding: `index.html:4679`.
- Export buttons use `0.6rem` padding: `index.html:4851`, `index.html:4867`, etc.
- `importZipBtn` and `importZipFile` are in the Export card: `index.html:4897-4910`.
- `removeInventoryDataBtn` and `boatingAccidentBtn` do not have inline sizing styles: `index.html:5040`, `index.html:5043`.
- `isCardViewActive()` logic correctly switches between card grid and portal scroll: `js/inventory-table.js:381-409`.

#### Top concerns

1. **Rendering Sync for Card View:** If the user is in Card View (Style A/B/C), the table DOM (`.portal-scroll`) is typically hidden and its contents might not be rendered or updated by the virtual scroller/renderer. The requirements should specify if the print action needs to force a full table re-render if the user is currently in a card view, otherwise the printed output will be empty or stale.
2. **Accessibility Consistency:** The existing export buttons (CSV, JSON, PDF, ZIP) all use `aria-describedby` for screen reader descriptions. The Print button AC should include this for consistency and accessibility parity.
3. **Filtered/Sorted State Clarity:** Clarify if \"inventory list/table view\" in AC-3 should follow the active filter/sort state. Most users expect \"Print\" to reflect the current on-screen state (filtered/sorted), not the entire unfiltered database.

#### Unverified assumptions

- Assumes `0.6rem` padding is the target for normalization even though `bulkEditBtn` uses `0.9rem`.
- Assumes that \"hiding app chrome\" includes hiding the \"Settings\" modal itself if it's open (which it must be to click the button), otherwise the modal backdrop might obscure the print output.
- Assumes the browser's native print behavior for `thead { display: table-header-group }` is sufficient for multi-page headers across all supported browsers without a custom header/footer renderer.

**Inline Marks (verbatim, with original location context):**

- **At Overview (was line 21):**

  > GEMINI: Existing buttons in this panel have inconsistent horizontal padding: `bulkEditBtn` uses `0.9rem` (`index.html:4679`), while the Export card buttons use `0.6rem` (`index.html:4851, 4867, etc.`). AC-2 and AC-6 specify `0.6rem`. Should we normalize _all_ Inventory settings buttons to one value, or is the larger padding for the primary action (Bulk Editor) intentional?

- **At AC-1 (was line 38):**

  > GEMINI: For accessibility and consistency with other export buttons, the Print button should include an `aria-describedby` attribute (e.g., `aria-describedby="printDesc"`) pointing to a hidden description span (e.g., "Direct browser print of current inventory view").

- **At AC-3 (was line 52):**

  > GEMINI: Supporting CODEX's point: `js/inventory-table.js:381-387` skips table rendering entirely when a card view is active. If print _must_ be the table/list view, the requirement should explicitly state that the print action triggers a full table re-render if the user is currently in a card view (Style A/B/C), otherwise the printed output will be empty or stale.

- **At AC-6 area (was line 77):**
  > GEMINI: Clarify if "inventory list/table view" in AC-3 should follow the active filter/sort state. Most users expect "Print" to reflect the current on-screen state (filtered/sorted), not the entire unfiltered database.

### Resolution Summary

- **Accepted at requirements level:** 6 — "Data tab" rename, `aria-describedby`, `#importZipFile` co-location with `#importZipBtn`, `#settingsPanel_system` anchoring for AC-6, `bulkEditBtn` left at 0.9rem (explicit non-goal), new AC-7 for filter/sort behavior.
- **Rejected:** 0.
- **Deferred to discovery (mechanism-coupled, not a requirements concern):** 5 — CODEX@40 (Playwright observability), CODEX@54 + GEMINI@52 (card-view re-render), CODEX@61 (new `@media print` contract in `css/styles.css`), GEMINI's hidden-Settings-modal assumption, GEMINI's `@page`/`thead` browser-support assumption. These are now folded into Open Questions Q1–Q3 for discovery to resolve.
- **Resolved with user's input this session:** 3 — print mechanism preference (jsPDF reuse, captured in Q1), card-view behavior (dissolves under Q1), bulkEditBtn scoping (leave at 0.9rem).
- **Phase-discipline correction logged:** initial reconcile draft baked the jsPDF-reuse mechanism directly into the ACs. User flagged that mechanism belongs in discovery; revised plan keeps ACs mechanism-neutral and parks the preference as an Open Question.
