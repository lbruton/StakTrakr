---
title: "DOM Patterns"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/dom-patterns.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/DOM Patterns.md" # historical provenance; migrated 2026-08-12
updated: "2026-05-08"
---

# DOM Patterns

## Overview

StakTrakr enforces two strict DOM safety rules that apply to all application code:

1. Element lookups must go through `safeGetElement()`. Raw `document.getElementById()` is only acceptable in the designated boot files (`about.js`) where `safeGetElement` is not yet defined, and in a small number of legacy pre-init paths.
2. All user-controlled content written to `innerHTML` must pass through `sanitizeHtml()` first to prevent XSS.

These rules exist because the app runs on `file://` (no server-side sanitization), handles user-entered text that is later rendered as HTML, and initializes a large number of DOM elements at startup. Violations are a recurring source of both runtime null-reference crashes and security bugs.

---

## Key Rules

- **Use `safeGetElement(id)`** for all DOM lookups in application code.
- **Never use raw `document.getElementById()`** in application code outside the designated exceptions below.
- **Always call `sanitizeHtml(str)` before assigning user-supplied text to `innerHTML`.**
- Never assign an unescaped user string directly to `innerHTML`, even for fields that appear "display-only."
- `escapeHtml()` is a lower-level utility in `js/utils.js` used for specific button-loading contexts — prefer `sanitizeHtml()` for general user content.

---

## API Reference

### `safeGetElement(id, required?)` — defined in `js/init.js` (line 31)

```js
function safeGetElement(id, required = false) {
  const element = document.getElementById(id);
  if (!element && required) {
    console.warn(`Required element '${id}' not found in DOM`);
  }
  return element || createDummyElement();
}
```

**Parameters:**

| Parameter  | Type      | Default | Description                                                     |
| ---------- | --------- | ------- | --------------------------------------------------------------- |
| `id`       | `string`  | —       | The HTML element ID to look up                                  |
| `required` | `boolean` | `false` | If `true`, emits a `console.warn` when the element is not found |

**Return value:** The real `HTMLElement` if found; otherwise a `createDummyElement()` object — never `null`.

**What the dummy element provides:** A plain object with no-op stubs for all commonly accessed DOM properties and methods. This means callers never receive `null` and never need to null-check before property access:

```js
// createDummyElement() returns:
{
  textContent: "",
  innerHTML: "",
  style: {},
  value: "",
  checked: false,
  disabled: false,
  dataset: {},
  classList: { add: () => {}, remove: () => {}, toggle: () => false, contains: () => false },
  addEventListener: () => {},
  removeEventListener: () => {},
  remove: () => {},
  focus: () => {},
  click: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
}
```

**Why this matters:** Raw `document.getElementById()` returns `null` when an element is absent. Any subsequent property access on `null` — e.g., `el.textContent = x` — throws a TypeError and can crash the entire initialization chain. `safeGetElement` eliminates that failure mode by guaranteeing a non-null return value with a safe no-op interface.

**When NOT to use `safeGetElement`:** For DOM **existence checks** — code that needs to distinguish "element exists" from "element absent" — use `document.getElementById()` directly. Because `safeGetElement` never returns `null`, an `if (el)` guard always passes, which caused the STAK-492 popover crash. Example: `_openThumbPopover` in `inventory.js` checks whether a popover already exists to toggle it off.

**Using the `required` flag:** Pass `required = true` for elements that are critical to a feature. This emits a visible `console.warn` in DevTools during development without throwing an error:

```js
// Required element — warns if missing so developers notice during dev
elements.inventoryForm = safeGetElement("inventoryForm", true);

// Optional element — silently returns dummy if missing
elements.itemGbDenom = safeGetElement("itemGbDenom");
```

---

### `sanitizeHtml(str)` — defined in `js/utils.js` (line 734)

```js
const sanitizeHtml = (text) => {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};
```

**What it does:** HTML-encodes the five characters that are meaningful inside HTML (`&`, `<`, `>`, `"`, `'`). The result is safe to interpolate directly into an `innerHTML` assignment or template literal — it renders as visible text, never as markup or script.

**When to use it:** Any time the string originated from user input — item names, notes, imported CSV fields, custom labels, catalog lookups, etc.

**Edge case:** Returns `""` for falsy values (`null`, `undefined`, `0`, empty string). Callers that need to distinguish between empty string and missing data should check before calling.

---

### `escapeHtml(str)` — defined in `js/utils.js` (line 16)

```js
const escapeHtml = (str) =>
  String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
```

**Difference from `sanitizeHtml`:** `escapeHtml` uses `str ?? ''` (nullish coalescing) and always coerces, while `sanitizeHtml` returns `""` on any falsy value. They produce the same output for non-empty strings. `escapeHtml` is used internally for button loading states (e.g., `setButtonLoading`) and is exposed on `window` for external use. Prefer `sanitizeHtml` in new application code.

---

### `safeAttachListener(element, event, handler, description?)` — defined in `js/events.js`

```js
const safeAttachListener = (element, event, handler, description = "") => {
  if (!element) {
    console.warn(`Cannot attach ${event} listener: element not found (${description})`);
    return false;
  }
  try {
    element.addEventListener(event, handler);
    return true;
  } catch (error) {
    console.warn(`Standard addEventListener failed for ${description}:`, error);
    // ...
  }
};
```

**When to use it:** Whenever attaching a listener to an element that might not exist in every render context. Avoids crashing when optional UI elements are absent.

**Companion — `optionalListener(el, event, handler, label)`:** A one-liner guard that calls `safeAttachListener` only if `el` is truthy. Use for truly optional elements where the listener is a no-op when the element is absent:

```js
optionalListener(fileInput, "change", handleChange, "CSV file input");
```

---

## Startup Exception

`safeGetElement` is defined at **`js/init.js` line 31**. The script load order in `index.html` means `js/about.js` is executed before `init.js`, so `safeGetElement` does not yet exist when `about.js` runs its top-level code.

**`about.js` has two lookup patterns** depending on when the function is called:

1. **Early-init functions** (Ack modal: `showAckModal`, `hideAckModal`, `setupAckModalEvents`) use raw `document.getElementById()` with `if` guards — these are called during or immediately after script load, before `safeGetElement` exists.

2. **Late-call functions** (About tab + popup: `populateAboutTab`, `setupAboutCollapsibleCards`, `showWhatsNewPopup`, `hideWhatsNewPopup`, `setupWhatsNewPopupEvents`) use `safeGetElement()` — these are only called after `init.js` has run (triggered by Settings tab activation or DOMContentLoaded hooks), so `safeGetElement` is available.

```js
// EXPECTED — early-init function in about.js (runs before safeGetElement exists)
const ackModal = document.getElementById("ackModal");
if (ackModal) { ... }

// EXPECTED — late-call function in about.js (called after init.js defines safeGetElement)
const populateAboutTab = () => {
  const versionEl = safeGetElement("aboutVersion");
  // safeGetElement is available because this runs after init.js
};
```

Code inside `init.js` itself CAN use `safeGetElement` after line 31, and all element lookups in the `initializeApp()` function do so.

### Service Worker Update Defense (STAK-485, STRK-56)

`init.js` includes two defense mechanisms for graceful service worker updates:

**`controllerchange` listener** — registered at the top of `init.js`, _before_ `DOMContentLoaded`. When a new service worker takes control mid-session, the page auto-reloads. A `document._swReloading` flag prevents double-reload. The listener is guarded by `navigator.serviceWorker.controller` being truthy, so first-visit SW registration does not trigger a reload.

**Smart error recovery** — the `initializeApp()` catch block detects known stale-cache errors (`ReferenceError` messages for missing asset globals such as `loadApiConfig` or `loadApiCache`). On first detection:

1. Sets `window._initFailed = true` (consumed by cloud-sync guard — see Cloud Sync)
2. Sets `sessionStorage.setItem('sw-recovery-attempted', '1')` to prevent reload loops
3. Shows a dark-themed "Updating to new version..." overlay
4. Reloads after 800ms

If the same known asset-global failure persists after the first reload, `init.js` sets `sw-recovery-nuked=1`, unregisters registered service workers, deletes `staktrakr-*` caches, and reloads only after those promises settle. The standard fallthrough modal now uses `appActionDialog` with a **Reset App** primary action that runs the same unregister/cache-delete sequence on demand. On successful init, both recovery flags are cleared.

**Summary of where each lookup style is appropriate:**

| File / Context                                                                                                  | Lookup style                                             | Reason                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `js/about.js` (early-init: ack modal)                                                                           | `document.getElementById()` + `if` guard                 | Runs before `safeGetElement` is defined                                                                                                                                        |
| `js/about.js` (late-call: About tab, popup)                                                                     | `safeGetElement()`                                       | Called after `init.js` defines it                                                                                                                                              |
| `js/init.js` (after line 31)                                                                                    | `safeGetElement()`                                       | `safeGetElement` is available                                                                                                                                                  |
| All other JS files                                                                                              | `safeGetElement()` (preferred)                           | Default pattern for new code                                                                                                                                                   |
| DOM existence checks (e.g., popover toggle-off)                                                                 | `document.getElementById()` + `if` guard                 | Need real `null` when absent — dummy is always truthy (STAK-492)                                                                                                               |
| Established modules (`card-view.js`, `events.js`, `inventory.js`, `image-cache-modal.js`, `inventory-table.js`) | `document.getElementById()` / `document.querySelector()` | Direct `document.getElementById()` and `document.querySelector()` calls still appear in several established modules. New code should prefer `safeGetElement()` for ID lookups. |

---

## Market Data DOM Elements (STAK-504)

The market data module (`js/market-data.js`) introduces six new DOM elements, all looked up via `safeGetElement()`:

| Element ID              | Type        | Purpose                                                                                                                                                                                                                                      |
| ----------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bestPriceTickerEl`     | `<div>`     | Best Price Ticker ribbon — horizontal scrolling lowest-per-coin prices                                                                                                                                                                       |
| `vendorPricesSectionEl` | `<section>` | Vendor Prices comparison table container                                                                                                                                                                                                     |
| `vendorPricesContainer` | `<div>`     | Inner container for the tabbed vendor price tables                                                                                                                                                                                           |
| `marketDetailModal`     | `<div>`     | Full-screen overlay for per-coin detail charts                                                                                                                                                                                               |
| `marketDetailContent`   | `<div>`     | Content area inside the market detail modal                                                                                                                                                                                                  |
| `marketDetailCloseBtn`  | `<button>`  | Close button for the market detail modal                                                                                                                                                                                                     |
| `marketSettingsBtn`     | `<button>`  | Gear icon in the Market block (vendor prices section) — opens the Market Settings panel. Added in STAK-545 alongside the header Market button behavior change (header button now triggers `syncRetailPrices()` instead of opening Settings). |

These elements are defined in `index.html` and are part of the `layoutSectionConfig` system (`bestPriceTicker` section). The ticker is inserted in the main page flow; the modal is a top-level overlay with `hidden` attribute toggled by JS.

### Market Filter Matrix Settings Panel (STAK-515)

The `settingsPanel_market` panel in `index.html` was gutted and replaced with a **Market Filter Matrix** — a checkbox grid where rows are product slugs and columns are vendors. The panel is rendered dynamically by `renderMarketFilterMatrix()` in `js/settings.js` and wired by `bindMarketFilterListeners()` in `js/settings-listeners.js`. Metal filter tabs (Gold / Silver / Platinum / Palladium / Goldback) control which rows are visible in the matrix. The Sync Now button and last-sync timestamp are retained. CSS styles are scoped under `.market-filter-matrix` in `css/styles.css`.

---

## Common Mistakes

### Mistake 1 — Raw `getElementById` in application code

```js
// WRONG — returns null if element is missing, crashes on property access
const el = document.getElementById("spotPrice");
el.textContent = price;
```

```js
// RIGHT — returns a dummy element if missing, no crash
const el = safeGetElement("spotPrice");
el.textContent = price;
```

### Mistake 2 — `innerHTML` with unsanitized user content

```js
// WRONG — XSS: a crafted item name like <script>alert(1)</script> executes
row.innerHTML = `<td>${item.name}</td>`;
```

```js
// RIGHT — encoded, renders as visible text only
row.innerHTML = `<td>${sanitizeHtml(item.name)}</td>`;
```

### Mistake 3 — Using `safeGetElement` in `about.js` early-init functions

`safeGetElement` is not available when `about.js` first runs. Calling it in top-level code or early-init functions (ack modal) produces a `ReferenceError`. However, late-call functions (About tab, popup) that are only invoked after `init.js` runs CAN safely use `safeGetElement`.

```js
// WRONG — top-level or early-init function in about.js
const el = safeGetElement("ackModal"); // ReferenceError!
```

```js
// RIGHT — early-init function: use raw getElementById
const el = document.getElementById('ackModal');
if (el) { ... }
```

```js
// ALSO RIGHT — late-call function (only invoked after init.js):
const populateAboutTab = () => {
  const el = safeGetElement("aboutVersion"); // safe — init.js has run
};
```

### Mistake 4 — Skipping sanitization for "non-dangerous" fields

User notes, item names, and imported text fields can all contain angle brackets or quotes. Sanitize regardless of expected content.

```js
// WRONG — item notes are user input; even "safe-looking" strings can contain angle brackets
modal.innerHTML = `<p>${item.notes}</p>`;
```

```js
// RIGHT — sanitize regardless of expected content
modal.innerHTML = `<p>${sanitizeHtml(item.notes)}</p>`;
```

### Mistake 5 — Sanitizing developer-controlled template strings

`sanitizeHtml` is for **user-supplied content only**. Do not wrap static developer-written HTML strings — that double-encodes intentional markup and produces visible `&lt;span&gt;` strings in the UI.

```js
// WRONG — sanitizing a static layout string; produces &lt;span&gt; in the DOM
el.innerHTML = sanitizeHtml(`<span class="badge">Active</span>`);
```

```js
// RIGHT — static markup from the developer does not need sanitizing
el.innerHTML = `<span class="badge">Active</span>`;
```

### Mistake 6 — Attaching a listener to a potentially-null element directly

```js
// WRONG — crashes if optionalBtn is null
optionalBtn.addEventListener("click", handler);
```

```js
// RIGHT — silently skips if element is absent
optionalListener(optionalBtn, "click", handler, "optional button");
```

---

## Related

- Frontend Overview — overall JS architecture and file load order
- Storage Patterns — `saveData()` / `loadData()` and `ALLOWED_STORAGE_KEYS`
