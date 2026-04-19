---
name: coding-standards
description: StakTrakr coding standards — vanilla JavaScript, single-page app, no build step, localStorage persistence.
---

# StakTrakr Coding Standards

Coding standards for a **pure client-side precious metals inventory tracker**. Single HTML page (`index.html`), vanilla JavaScript, localStorage persistence, no backend, no build step. Must work on both `file://` protocol and HTTP servers.

---

## 1. Architecture & Project Structure

### Single-page, no-build design

All JavaScript loads via `<script>` tags in `index.html`. There are no ES modules, no bundler, no transpilation. Every top-level `const`, `let`, `function`, and `class` declaration is a **global**. Treat the global namespace as the module system.

### Script loading order (mandatory)

Scripts load in strict dependency order defined in `index.html`. `file-protocol-fix.js` loads first (no `defer`), `init.js` loads last. Breaking this order causes `ReferenceError` on undefined globals.

When adding a new script file:

1. Identify which existing globals it depends on
2. Place the `<script>` tag **after** all dependencies in `index.html`
3. If the new file defines globals others need, place it **before** those consumers

### Module boundaries

Each `.js` file owns a specific domain. Respect boundaries:

| File           | Responsibility                                            |
| -------------- | --------------------------------------------------------- |
| `constants.js` | Configuration, API providers, storage keys, feature flags |
| `state.js`     | All mutable application state, cached DOM references      |
| `utils.js`     | Formatting, validation, storage helpers, error handling   |
| `events.js`    | Event binding, modal submit handlers, UI interactions     |
| `inventory.js` | CRUD operations, table rendering, CSV/PDF/ZIP export      |
| `api.js`       | External pricing API calls with provider fallback         |
| `init.js`      | Application bootstrap (runs last)                         |

Don't put DOM event handlers in `utils.js`. Don't put formatting helpers in `events.js`. Don't put state declarations outside `state.js`.

### Global scope discipline

Since everything is global, follow these rules to avoid collisions:

- **Constants**: define with `const` at file top, expose via `window.X = X` block at file bottom
- **State variables**: declare only in `state.js` with `let`
- **Helper functions**: define with `const fn = () => {}` in their owning module
- **No generic names**: avoid `data`, `result`, `temp`, `value` at file scope. Prefix with domain context (e.g., `apiCache`, `spotHistory`)

---

## 2. Code Style

### Formatting

- **2-space indentation** (no tabs)
- **Semicolons always** — every statement ends with `;`
- **Trailing commas** in multi-line arrays and objects
- **120-character soft line limit** — break long lines at logical points

### Quotes

The codebase uses mixed quote styles. The convention:

- **Double quotes** for string values in configuration objects and data (`"silver"`, `"USD"`)
- **Single quotes** for DOM selectors, localStorage keys, and template fragments (`'changeLog'`, `'hidden.bs.modal'`)
- **Template literals** for string interpolation and multi-line strings — always prefer over concatenation

### Variable declarations

```javascript
// const-first — use for everything that isn't reassigned
const API_CACHE_DURATION = 24 * 60 * 60 * 1000;
const formatCurrency = (value) => `$${value.toFixed(2)}`;

// let — only when the value changes
let editingIndex = null;
let sortDirection = "desc";

// NEVER use var — it leaks scope and hoists unpredictably
```

### Naming conventions

| Kind                  | Convention                    | Examples                                       |
| --------------------- | ----------------------------- | ---------------------------------------------- |
| Variables & functions | `camelCase`                   | `sortColumn`, `editingIndex`, `formatCurrency` |
| Constants             | `UPPER_SNAKE_CASE`            | `APP_VERSION`, `LS_KEY`, `DEFAULT_CURRENCY`    |
| Classes               | `PascalCase`                  | `FeatureFlags`                                 |
| Files                 | `kebab-case`                  | `file-protocol-fix.js`, `debug-log.js`         |
| CSS classes           | `kebab-case`                  | `filter-text`, `na-value`, `spot-card`         |
| DOM IDs               | `camelCase`                   | `spotSilver`, `itemModal`, `inventoryTable`    |
| localStorage keys     | `camelCase` or `dot.notation` | `metalInventory`, `staktrakr.catalog.cache`    |

### Functions

- **Arrow functions** for callbacks, inline handlers, and short helpers
- **`function` declarations** for hoisted functions that need to be called before definition (rare — prefer `const`)
- **Verb-noun naming**: `saveData`, `loadData`, `formatCurrency`, `handleError`, `renderTable`
- **Boolean-returning functions**: prefix with `is`, `has`, `can`, `should` (e.g., `isFeatureEnabled`)

### Comparison

- **Strict equality only**: `===` and `!==`. Never use `==` or `!=`
- **Nullish checks**: prefer `value == null` (the one exception to strict equality — catches both `null` and `undefined`) or optional chaining (`data?.rates?.price`)

---

## 3. DOM Interaction

### Element access

Always use `safeGetElement(id)` instead of raw `document.getElementById()`. It prevents null reference errors and provides optional warning logging:

```javascript
// CORRECT
const el = safeGetElement("inventoryTable");

// WRONG — crashes if element doesn't exist
const el = document.getElementById("inventoryTable");
```

### Cached DOM references

Frequently accessed elements are cached in the `elements` object in `state.js`. Use these cached references instead of repeated lookups:

```javascript
// CORRECT — use cached reference
elements.inventoryTable.innerHTML = "";

// WRONG — redundant DOM query
document.getElementById("inventoryTable").innerHTML = "";
```

When adding a new persistent UI element, add its reference to the `elements` object in `state.js` and initialize it during `initializeElements()` in `init.js`.

### Event binding

Use `safeAttachListener()` from `events.js` for all event binding. It handles null elements, provides fallback binding methods, and logs failures:

```javascript
safeAttachListener(elements.searchInput, "input", handleSearch, "search input");
```

### Content injection

| Method                               | When to use                                                  |
| ------------------------------------ | ------------------------------------------------------------ |
| `textContent`                        | Default for all text. Safe, no XSS risk                      |
| `innerHTML` with `escapeAttribute()` | When HTML structure is needed AND content includes user data |
| `innerHTML` with static HTML         | Only for trusted, hardcoded markup with no user content      |
| `classList.add/remove/toggle`        | All class manipulation — never string-manipulate `className` |

```javascript
// CORRECT — safe text injection
el.textContent = item.name;

// CORRECT — escaped user content in HTML
el.innerHTML = `<span title="${escapeAttribute(item.notes)}">${escapeAttribute(item.name)}</span>`;

// WRONG — XSS vulnerability
el.innerHTML = `<span>${item.name}</span>`;
```

---

## 4. State & Data Flow

### Application state

All mutable state lives in `state.js` as top-level `let` declarations:

```javascript
let inventory = []; // Main data
let spotPrices = { silver: 0, gold: 0, platinum: 0, palladium: 0 };
let editingIndex = null; // UI state
```

Never declare mutable state in other files. If a new module needs persistent state, add the variable to `state.js`.

### Data persistence

Use the async storage helpers from `utils.js`:

```javascript
// PREFERRED — async with compression
await saveData(LS_KEY, inventory);
const data = await loadData(LS_KEY, []);

// LEGACY — sync versions (use only when async isn't possible)
saveDataSync(LS_KEY, inventory);
const data = loadDataSync(LS_KEY, []);
```

**Never** use `localStorage.getItem()` / `localStorage.setItem()` directly for application data. The helpers handle JSON serialization, compression, and error recovery.

**Exception — scalar string preferences:** Plain string scalar values that are NOT JSON objects or arrays (e.g., a timeout value in minutes like `'15'`, a boolean string like `'true'`) may use `localStorage.getItem/setItem` directly with a named constant key. `loadData()`/`saveData()` are async and add JSON.stringify wrapping — wrong for values that are already simple strings. Use `localStorage.getItem(NAMED_KEY_CONSTANT)` directly and add a `// nosemgrep` comment to suppress Codacy false positives:

```javascript
// nosemgrep: javascript.browser.security.insecure-document-method.insecure-document-method
const stored = localStorage.getItem(CLOUD_VAULT_IDLE_TIMEOUT_KEY);

// Example of setting a scalar string preference
const timeoutMinutes = "15";
localStorage.setItem(CLOUD_VAULT_IDLE_TIMEOUT_KEY, timeoutMinutes);
```

Named constant must still be registered in `ALLOWED_STORAGE_KEYS` in `constants.js`.

### localStorage key whitelist

Every localStorage key **must** be registered in `ALLOWED_STORAGE_KEYS` in `constants.js` before use. The security cleanup routine (`cleanupStorage` in `js/utils.js`) deletes any key not in this list. Forgetting to register a key means data loss on next cleanup.

### Mutation cycle

The standard data flow is: **mutate state → save to storage → re-render UI**

```javascript
// Example: delete an item
inventory.splice(index, 1);
await saveData(LS_KEY, inventory);
renderTable();
```

Never re-render without saving first (stale UI on reload). Never save without re-rendering (stale UI until reload).

---

## 5. Error Handling

### Storage and API operations

Wrap all `localStorage` and `fetch` calls in `try/catch`:

```javascript
try {
  const data = await loadData(LS_KEY, []);
  // ... use data
} catch (error) {
  console.error("[inventory] Failed to load data:", error);
  // Fall back to empty state
  inventory = [];
}
```

### User-facing errors

Use `handleError(error, context)` from `utils.js` for errors that need user notification:

```javascript
handleError(error, "CSV import");
// Currently shows alert() — will migrate to toast notifications
```

**Note**: The codebase currently uses `alert()` for error display. New code should still use `handleError()` to centralize the migration path to toast notifications.

### Console logging

Use contextual prefixes for all console output:

```javascript
console.error("[api] Fetch failed for silver:", error);
console.warn("[inventory] Missing weight field, defaulting to 1oz");
console.log("[spot] Cache hit for gold, age: 2h");
```

### Debug logging

Use `debugLog()` for development tracing that should be silent in production:

```javascript
debugLog("Rendering table with", inventory.length, "items");
// Only outputs when DEBUG === true (set via DEV_MODE or ?debug URL param)
```

### Fallback defaults

Always provide sensible defaults rather than crashing:

```javascript
const price = parseFloat(item.price) || 0;
const weight = item.weight || 1;
const name = item.name || "Unknown Item";
```

---

## 6. Security

### Storage key whitelist

All keys in `ALLOWED_STORAGE_KEYS` before first use. The security cleanup routine runs on app init and will delete unregistered keys.

### HTML escaping

Use `escapeAttribute()` (defined in `inventory.js`) on **all** user-provided content injected into HTML:

```javascript
// Name, notes, locations, serial numbers — anything the user typed
const safe = escapeAttribute(item.name);
```

Prefer `textContent` over `innerHTML` wherever HTML structure isn't required. When building HTML strings with user content, every interpolated value must be escaped.

### Import sanitization

All CSV and JSON imports pass through `sanitizeImportedItem()` from `utils.js`. This function:

- Strips unexpected fields
- Validates and coerces types
- Applies default values for missing fields
- Prevents injection via crafted import files

### Input validation

Validate at form boundaries (the add/edit modal submit handler). Internal functions may trust their inputs since data has already been sanitized on entry.

---

## 7. API Integration

### Provider fallback chain

The pricing API uses a ranked provider list. If the primary fails, the system falls through to backups:

```javascript
// Pattern: try providers in order, return first success
for (const provider of orderedProviders) {
  try {
    const result = await fetchFromProvider(provider);
    if (result) return result;
  } catch (error) {
    console.warn(`[api] ${provider.name} failed, trying next:`, error.message);
  }
}
```

### Caching

API responses are cached with TTL per provider (default: 24 hours). Always check cache before making a network request. Cache keys and timestamps are stored in localStorage.

### Error recovery

API errors must be:

1. **Logged** with provider name and context
2. **Recovered** via fallback provider or cached data
3. **Never silent** — if all providers fail, notify the user

### Async style

Use `async/await` for all asynchronous operations. Never use `.then()` chains:

```javascript
// CORRECT
const response = await fetch(url);
const data = await response.json();

// WRONG — don't mix callback style
fetch(url).then(res => res.json()).then(data => { ... });
```

---

## 8. Library-Specific Standards

### Chart.js

- **Destroy before reuse**: call `.destroy()` on existing chart instance before creating a new one on the same canvas. Failing to destroy causes memory leaks and ghost overlays
- **Disable animations** on programmatic updates (when the user didn't trigger the render)
- **Store instances** in the `chartInstances` or `sparklineInstances` objects in `state.js`

```javascript
if (chartInstances.typeChart) {
  chartInstances.typeChart.destroy();
}
chartInstances.typeChart = new Chart(canvas, config);
```

### Bootstrap 5

- **`getOrCreateInstance()`** instead of `new bootstrap.Modal()` — prevents duplicate instance errors
- **Dispose after `hidden.bs.*` event** when modals are dynamically created
- **Never mix jQuery and Bootstrap 5** — the app uses vanilla Bootstrap only
- **Use `data-bs-*` attributes** for declarative behavior, JavaScript API for programmatic control

### PapaParse (CSV)

- **Always check `results.errors`** after parsing — PapaParse can return partial data with errors
- **Use `skipEmptyLines: 'greedy'`** to handle trailing newlines and whitespace-only rows
- **Two-tier validation**: PapaParse structural errors first, then business logic validation on each row

### jsPDF + AutoTable

- **Use AutoTable for all tabular exports** — never manually position text for table layouts
- **Optimize images before embedding** — large base64 images bloat PDF size
- **Set page orientation** based on column count (portrait for narrow tables, landscape for wide)

### JSZip

- **`generateAsync({type: "blob"})`** for browser downloads — never use synchronous generation
- **Use `file()` method** for adding entries, not direct property assignment

---

## 9. Anti-Patterns

Things to actively avoid and fix when encountered during refactoring:

### Never do these

| Anti-pattern                          | Do this instead                                     |
| ------------------------------------- | --------------------------------------------------- |
| `var x = ...`                         | `const x = ...` or `let x = ...`                    |
| `==` or `!=`                          | `===` or `!==` (except `== null` for nullish check) |
| `localStorage.getItem()` for app data | `loadData()` / `loadDataSync()`                     |
| `localStorage.setItem()` for app data | `saveData()` / `saveDataSync()`                     |
| `document.getElementById()`           | `safeGetElement()`                                  |
| `innerHTML = userContent`             | `textContent = userContent` or `escapeAttribute()`  |
| `.then().catch()` chains              | `async/await` with `try/catch`                      |
| `element.className = "..."`           | `element.classList.add/remove/toggle()`             |
| `new bootstrap.Modal(el)`             | `bootstrap.Modal.getOrCreateInstance(el)`           |

### Avoid these patterns

- **Nested ternaries deeper than 2 levels** — use `if/else` or extract a helper function
- **Magic numbers** — define in `constants.js` with a descriptive name
- **Mixed sync/async storage** in the same function — pick one style per function
- **Silent error swallowing** — `catch (e) {}` with no logging or fallback
- **DOM queries in loops** — cache the element reference before the loop
- **String concatenation for HTML** without escaping — always use `escapeAttribute()` on user content
- **Hardcoded localStorage key strings** — use the named constants from `constants.js`

---

## 10. CSS & Design System

### Living reference

Open `style.html` in a browser to see all components rendered with CSS variable labels. This file references the same `css/styles.css` the app uses — it is the single source of truth for visual patterns.

### Token usage (mandatory)

**Never hardcode colors, spacing, or border-radius.** Always use CSS custom properties:

```css
/* CORRECT */
color: var(--text-primary);
background: var(--bg-card);
border-radius: var(--radius);
padding: var(--spacing);

/* WRONG — hardcoded values bypass theming */
color: #1b232c;
background: #ffffff;
border-radius: 8px;
padding: 0.75rem;
```

### Toggle standard

**Always use `.chip-sort-toggle`** for boolean On/Off settings. Never use iOS-style switches or raw checkboxes for settings toggles:

```html
<div class="chip-sort-toggle" id="myToggle">
  <button type="button" class="chip-sort-btn" data-val="yes">On</button>
  <button type="button" class="chip-sort-btn" data-val="no">Off</button>
</div>
```

Wire with `wireStorageToggle(elementId, storageKey, opts)` for raw localStorage keys, or `wireFeatureFlagToggle(elementId, flagName, opts)` for feature flags.

**Exception**: Checkbox lists (e.g., Numista view field toggles) where many items appear in a compact list may use `.settings-checkbox-label` with raw checkboxes.

### Button variants

All buttons use the `.btn` base class with optional modifier:

| Class            | Purpose                | Background token |
| ---------------- | ---------------------- | ---------------- |
| `.btn`           | Primary action         | `--primary`      |
| `.btn.secondary` | Secondary / cancel     | `--secondary`    |
| `.btn.success`   | Positive confirmation  | `--success`      |
| `.btn.danger`    | Destructive action     | `--danger`       |
| `.btn.warning`   | Caution                | `--warning`      |
| `.btn.info`      | Informational          | `--info`         |
| `.btn.premium`   | Premium / paid feature | `--warning`      |
| `.btn.btn-sm`    | Small variant          | (same as parent) |

### Settings group pattern

Related settings wrap in a `.settings-fieldset` card with a `.settings-fieldset-title` header:

```html
<div class="settings-fieldset">
  <div class="settings-fieldset-title">Group Name</div>
  <div class="settings-group">
    <div class="settings-group-label">Setting label</div>
    <p class="settings-subtext">Help text.</p>
    <!-- toggle or input here -->
  </div>
</div>
```

### Modal structure

Standard modal pattern — glass-morphism shell with gradient top accent:

```html
<div class="modal-overlay" id="myModal">
  <div class="modal-content">
    <!-- Header -->
    <div
      style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; padding-bottom:0.75rem; border-bottom:1px solid var(--border);"
    >
      <h2>Title</h2>
      <button class="btn btn-sm secondary" id="myCloseBtn">&times;</button>
    </div>
    <!-- Body -->
    <div>...</div>
    <!-- Footer -->
    <div
      style="display:flex; justify-content:flex-end; gap:0.5rem; padding-top:0.75rem; border-top:1px solid var(--border);"
    >
      <button class="btn secondary btn-sm">Cancel</button>
      <button class="btn btn-sm">Save</button>
    </div>
  </div>
</div>
```

### Theme compatibility

All new CSS **must** work across light, dark, and sepia themes. Use semantic tokens (`--text-primary`, `--bg-card`, etc.) which automatically adapt per theme. Test all three themes when adding new UI.

### Key CSS custom properties

| Category    | Tokens                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------- |
| Colors      | `--primary`, `--secondary`, `--success`, `--info`, `--warning`, `--danger` + `-hover` variants |
| Backgrounds | `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-card`                                 |
| Text        | `--text-primary`, `--text-secondary`                                                           |
| Metals      | `--silver`, `--gold`, `--platinum`, `--palladium`                                              |
| Types       | `--type-{coin,round,bar,note,set,other}-{bg,text}`                                             |
| Borders     | `--border`, `--border-hover`                                                                   |
| Shadows     | `--shadow-sm`, `--shadow`, `--shadow-lg`                                                       |
| Spacing     | `--spacing-xs`, `--spacing-sm`, `--spacing`, `--spacing-lg`, `--spacing-xl`                    |
| Radius      | `--radius` (8px), `--radius-lg` (12px)                                                         |
| Transition  | `--transition`                                                                                 |
