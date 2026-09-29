---
sketch: "STRK-88-fp-price-artifact"
phase: discovery
created: 2026-05-19
---

# STRK-88 — Discovery

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| [js/events.js](file:///Volumes/DATA/GitHub/StakTrakr/js/events.js#L60-L180) | `createLotEachToggle` | Handles UI toggle state and value conversion. Contains `toFixed(6)` truncation causing drift. |
| [js/events.js](file:///Volumes/DATA/GitHub/StakTrakr/js/events.js#L1443-L1446) | `parseItemFormFields` | Divides lot price by quantity on save using `toFixed(6)` precision loss. |
| [js/inventory.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory.js#L1491-L1502) | `editItem` (field populate) | Sets price input using `displayPrice` assignment prior to toggle restore. |
| [js/inventory.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory.js#L1732-L1742) | `editItem` (restore toggle) | Multiplies unit price by quantity using `toFixed(6)` during toggle restore for LOT mode. |
| [js/inventory.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory.js#L1820-L1933) | `duplicateItem` | In scope. Assigns source `item.price` directly into `#itemPrice` before resetting the purchase-price toggle (`js/inventory.js:1874-1884`, `js/inventory.js:1931-1933`) — a drifted source item duplicates the drift into the new form. |
| [js/utils.js](file:///Volumes/DATA/GitHub/StakTrakr/js/utils.js#L599-L624) | `formatCurrency` | Display-time formatting via `Intl.NumberFormat`; returns a decorated currency string. The only adjacent helper is `getCurrencySymbol` (`js/utils.js:653-675`). **No existing helper returns the active currency's fraction-digit count for raw numeric input values** — this is a missing primitive the approach phase must locate or introduce. |
| [js/inventory-import.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js#L1021) | `exportNumistaCsv` | Hardcodes `.toFixed(2)`. Inconsistent with the currency-aware constraint below and with peer exporters that use `formatCurrency`. |
| [js/inventory-import.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory-import.js#L1117) | `buildCsvContent` | Formats `purchasePrice` via `formatCurrency`. |
| [js/inventory.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory.js#L2084-L2087) | PDF export | Uses `formatCurrency` for `purchasePrice` — currency-aware. |
| [js/inventory.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory.js#L1969-L1980), [js/inventory-backup.js](file:///Volumes/DATA/GitHub/StakTrakr/js/inventory-backup.js#L22-L36) | JSON / ZIP backup | Preserves raw `item.price` values. Required for exact round-trip. |

## Prior Decisions

- **2026-04-27** — Shipped the STRK-4 "Lot⇄Each" toggle for Purchase Price on 2026-04-27 (patch/3.34.34) via PR #1037 targeting the dev environment; all CI checks passed and the PR was mergeable.

## External References

- [Intl.NumberFormat (MDN)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat) — Explains the standard API for determining fraction digits and currency formatting.

## Constraints

- **No schema changes**: We must not alter the localStorage representation or standard layout of inventory items. `item.price` continues to hold a float in USD.
- **Zero-build pipeline**: The project runs as vanilla JS in the browser directly; no build step or package dependencies (like decimal.js) are allowed for core functionality.
- **Data-integrity versus display separation**: JSON and encrypted backups must maintain exact stored float values for precision, while visible UI inputs, CSV/PDF exports, and table cells must round to the active currency's standard precision.
- **Currency-awareness**: The precision must be queried dynamically based on the active currency `displayCurrency` using `Intl.NumberFormat` instead of hardcoding 2 decimal places.
- **Export-format mismatch (discovered)**: User-facing exports already disagree on precision policy. Numista CSV hardcodes `.toFixed(2)` (`js/inventory-import.js:1021`); general CSV and PDF use `formatCurrency` (`js/inventory-import.js:1117`, `js/inventory.js:2084-2087`); JSON and encrypted/ZIP backups preserve raw `item.price` (`js/inventory.js:1969-1980`, `js/inventory-backup.js:22-36`). Approach must decide whether STRK-88 normalizes the Numista path to currency-aware or scopes that out.

## Open Questions

1. **Toggle source-of-truth mechanism.** Where should the unrounded exact price live so toggle round-trips preserve precision? Candidates to weigh in approach: custom `dataset` attribute on `#itemPrice`, closure state inside `createLotEachToggle`, a form-scoped `WeakMap`/module cache, or a normalized parse/round helper that recomputes from quantity. Each has different lifecycle semantics (form reset, duplicate, edit, dispose).
2. **Fraction-digit primitive location.** No existing helper returns the active currency's fraction-digit count for raw numeric input values — `formatCurrency` returns a decorated string. Approach must locate or introduce one (likely a new export in `js/utils.js` near `getCurrencySymbol`) so input rounding can stay numeric.

## Discovery Summary

This work spans three boundaries: item-form input/toggle logic (`js/events.js`), the edit/duplicate loading flow (`js/inventory.js`), and the export formatters (`js/inventory-import.js`, plus PDF in `js/inventory.js`). Two design choices remain open and belong in approach:

1. **How to retain the exact unrounded price** across toggle/edit/duplicate transitions without altering the persisted `item.price` schema. Several mechanisms are plausible (input `dataset`, closure state, module-scoped `WeakMap`, parse/round helper); each has tradeoffs around DOM coupling, form reset behavior, and testability.
2. **Whether the existing export-format mismatch is part of STRK-88's scope.** The Numista CSV path hardcodes 2 decimals while the rest of the user-visible export surface is currency-aware or raw — keeping Numista as-is would leave a visible inconsistency for non-2-decimal currencies; normalizing it expands the change set into the Numista importer's expectations.

JSON/ZIP backups intentionally retain raw `item.price` to preserve exact round-trips; that constraint is non-negotiable per AC-1 in requirements.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-88`.

## Review Archive — discovery (2026-05-19)

_Reconciled by /sketch reconcile on 2026-05-19. Original reviewer marks preserved below for audit._

### Codex

#### Verified

- Confirmed `createLotEachToggle` converts the visible price input with `convertedPrice.toFixed(6)` and dispatches `input` (`js/events.js:83-87`).
- Confirmed save-time LOT price conversion divides by quantity with `.toFixed(6)` before persisting per-unit price (`js/events.js:1443-1445`).
- Confirmed edit load can expose raw drift in EACH mode through the `displayPrice` assignment and in LOT mode through `(perUnit * item.qty).toFixed(6)` (`js/inventory.js:1492-1502`, `js/inventory.js:1732-1740`).
- Confirmed duplicate mode also writes `item.price` directly into `#itemPrice` before resetting the toggle (`js/inventory.js:1874-1884`, `js/inventory.js:1931-1933`).
- Confirmed `formatCurrency` uses `Intl.NumberFormat`, but returns a formatted string; no existing helper surfaced that returns currency fraction digits for raw numeric inputs (`js/utils.js:599-624`, `js/utils.js:653-675`).
- Confirmed user-facing export paths differ: Numista CSV hardcodes two decimals, general CSV/PDF use `formatCurrency`, and JSON/ZIP backups preserve raw `item.price` (`js/inventory-import.js:1021`, `js/inventory-import.js:1117`, `js/inventory.js:2084-2087`, `js/inventory.js:1969-1980`, `js/inventory-backup.js:22-36`).
- Confirmed existing lot/each Playwright coverage exercises exact 100/2 conversion and input-event emission, but not the 1700/30 repeating-decimal regression (`tests/playwright/inventory/lot-each-purchase-price.spec.js:436-479`).

#### Top concerns

1. Discovery misses duplicate-mode `#itemPrice` as a user-visible drift surface even though the file map names `duplicateItem`.
2. Currency-aware input rounding needs a real fraction-digit primitive; `formatCurrency` is not directly reusable for raw input values because it returns a decorated string.
3. The discovery summary prematurely selects `dataset` and calls export/UI rounding straightforward before weighing alternatives and the current export-format mismatch.

#### Unverified assumptions

- Duplicate-mode price cleanup is either intentionally in scope or intentionally out of scope.
- A transient exact-value cache can preserve the AC-1 source-of-truth contract without adding persisted schema fields.
- Active-currency fraction digits should govern raw form input values, not just formatted display text.
- Numista CSV should move from fixed two-decimal output to active-currency fraction digits, despite Numista import expectations potentially being USD-like.
- JSON and encrypted/ZIP backups are allowed to retain raw `item.price` values even when UI, CSV, and PDF surfaces present rounded values.
- The approach will compare at least dataset state, closure/module state, and a shared parse/round helper before choosing the toggle source-of-truth design.

### Resolution Summary

- Accepted: 5 (duplicate-mode in scope; missing fraction-digit primitive; export-format mismatch as a discovered constraint; replaced "None" Open Questions with the two approach-shaping questions; rewrote Discovery Summary to surface alternatives rather than pre-select `dataset`).
- Rejected: 0.
- Resolved with your input: 1 (duplicate-mode scope → in scope, per session "no clarifying questions" directive and requirements' goal of covering all visible `#itemPrice` paths).
- Unverified assumptions left as open questions for approach to resolve: toggle source-of-truth mechanism and fraction-digit primitive location are now Open Questions 1 and 2. The Numista CSV scope decision is captured in the Discovery Summary's second open design choice.
- 2026-05-20 Gemini reconcile: Accepted archive cleanup only; rejected additional content edits because duplicate mode, missing fraction-digit primitive, and Numista CSV consistency were already represented in the active discovery.

### Gemini Inline Marks (2026-05-20)

**On `createLotEachToggle`:**

> GEMINI: Verified. Line 86 in `js/events.js` performs `Number(convertedPrice.toFixed(6)).toString()` within `createLotEachToggle`.

**On `parseItemFormFields`:**

> GEMINI: Verified. Line 1445 in `js/events.js` performs `(rawInput / parsedQty).toFixed(6)` when compiling values for save.

**On `editItem` field populate:**

> GEMINI: Verified. Line 1495 in `js/inventory.js` populates `displayPrice` using `.toFixed(2)` if `fxRate !== 1`, or raw `item.price` (which holds the unrounded float) if `fxRate === 1`, before writing to `#itemPrice`.

**On `editItem` restore toggle:**

> GEMINI: Verified. Lines 1738-1740 in `js/inventory.js` perform `priceEl.value = String(parseFloat((perUnit * item.qty).toFixed(6)))` inside the toggle restore block.

**On `duplicateItem`:**

> GEMINI: Verified. Lines 1876-1877 in `js/inventory.js` handle duplicate price mapping identically to `editItem`, and `duplicateItem` is in scope.

**On `formatCurrency`:**

> GEMINI: Verified. Checked `js/utils.js` lines 599-624 and 653-675. There is no helper returning standard fraction digits, only formatted currency strings.

**On `exportNumistaCsv`:**

> GEMINI: Verified. Line 1021 in `js/inventory-import.js` uses `Number(purchasePrice).toFixed(2)` instead of dynamic formatting.

**On JSON / ZIP backup:**

> GEMINI: Verified. `js/inventory.js` line 1979 and `js/inventory-backup.js` line 35 preserve raw `item.price` unrounded, confirming data-integrity separation.

### Gemini Review (2026-05-20)

### Verified
- Checked codebase paths and line numbers:
  - Verified `js/events.js:86` in `createLotEachToggle` uses `convertedPrice.toFixed(6)` truncation when converting between lot/each.
  - Verified `js/events.js:1445` in `parseItemFormFields` divides lot price by quantity on save using `toFixed(6)` precision loss.
  - Verified `js/inventory.js:1495` sets price input using raw float or `.toFixed(2)` display price prior to toggle restore.
  - Verified `js/inventory.js:1739` in `editItem` multiplies unit price by quantity using `toFixed(6)` during toggle restore for LOT mode.
  - Verified `js/inventory.js:1877` in `duplicateItem` handles duplicated prices in the same manner as `editItem`, carrying over the raw drift.
  - Verified `js/utils.js:599-624` and `653-675` contain `formatCurrency` and `getCurrencySymbol`, but no dynamic helper exists to get the active currency's fraction-digit count.
  - Verified `js/inventory-import.js:1021` in `exportNumistaCsv` hardcodes `.toFixed(2)` for buying price.
  - Verified `js/inventory-import.js:1117` in `buildCsvContent` and `js/inventory.js:2084-2087` in PDF export use `formatCurrency(purchasePrice)` and are currency-aware.
  - Verified `js/inventory.js:1979` in JSON export and `js/inventory-backup.js:35` in ZIP backup preserve raw `item.price` values unrounded.
  - Verified `tests/playwright/inventory/lot-each-purchase-price.spec.js:436-479` exists and contains lot/each toggle tests (15, 16, 17) verifying basic exact value conversions and event emission, but not repeating-decimal floating point drift.

### Top concerns
1. **Unrounded unit values in duplicate mode**: Just like edit mode, `duplicateItem` in `js/inventory.js` populates the form field using `dupDisplayPrice`. If the source item price has drift, it gets cloned into the new item unless the input is rounded on population.
2. **Missing fraction-digit count primitive**: An input rounding helper will need standard numeric fraction digits for the active currency. `js/utils.js` has no such helper today, meaning we must introduce one.
3. **Numista CSV Export consistency**: Numista export uses hardcoded `.toFixed(2)`, whereas standard CSV/PDF exports use `formatCurrency`. The approach must determine if Numista export should be updated to standard dynamic precision or kept as-is to meet external Numista import expectations.

### Unverified assumptions
1. We assume that currency fraction digits (typically 2 for USD/GBP/EUR, but 0 for JPY or custom values for Goldbacks) should govern the `#itemPrice` input field directly.
2. We assume that the Numista CSV export structure can support currency-aware dynamic decimal formatting without failing external validation rules on the Numista site.
3. We assume a non-persisted exact-value cache mechanism is sufficient to pass the AC-1/AC-2 round-trip toggle contract.
