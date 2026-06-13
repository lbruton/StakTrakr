# Copilot Instructions -- StakTrakr

Custom review instructions for GitHub Copilot PR reviews.

## Project Context

StakTrakr is a single-page vanilla JavaScript app (no framework, no build step). It runs on both `file://` protocol and HTTP servers. The runtime artifact is `index.html` plus JS/CSS assets -- no bundler, no transpiler. 63 JS files plus 7 vendor libs and 1 data bundle (71 external scripts total) load in strict dependency order via `<script defer>` tags.

For full codebase context, see `AGENTS.md` in the repository root.

## Critical Patterns to Enforce

### 1. DOM Access -- Always use `safeGetElement()`

Direct `document.getElementById()` calls are **not allowed**. The codebase uses `safeGetElement(id)` (defined in `js/init.js:30`) which returns a dummy element on null to prevent reference errors.

```js
// BAD -- flag this
const el = document.getElementById("myElement");

// GOOD
const el = safeGetElement("myElement");
```

**Exception**: Code inside `about.js`, `init.js`, and event setup functions that run once at startup may use `document.getElementById()` for elements that are guaranteed to exist.

### 2. localStorage -- Whitelist Required

All localStorage keys **must** be registered in `ALLOWED_STORAGE_KEYS` in `js/constants.js`. Direct `localStorage.setItem()` with an unlisted key will be silently blocked by the security layer (`cleanupStorage()` in `utils.js` removes unknown keys). Flag any new `localStorage.setItem()` or `localStorage.getItem()` call that uses a key not in the whitelist.

Prefer `saveData()`/`loadData()` (async) or `saveDataSync()`/`loadDataSync()` from `js/utils.js` for application data.

### 3. Script Loading Order & Global Scope Architecture

Scripts load via `<script>` tags in `index.html` in strict dependency order. `file-protocol-fix.js` loads first (no `defer`), `init.js` loads last. If a PR adds a new script file, verify it's placed correctly in `index.html`.

**CRITICAL: Do not flag "undefined" globals** -- this is a vanilla JS app with global scope across 63 JS files (71 scripts total). The following globals are defined in other files and are intentionally available throughout the app:

**From `js/state.js`:**

- `inventory` (array) -- main inventory data
- `spotPrices` (object) -- current metal prices
- `displayCurrency`, `exchangeRate`, `currencySymbol` -- currency settings
- `elements` (object) -- cached DOM references
- `itemTags` (object) -- per-item tag data

**From `js/debug-log.js`:**

- `debugLog(message, level)` -- debug logging utility

**From `js/constants.js`:**

- `API_PROVIDERS`, `METALS`, `ALLOWED_STORAGE_KEYS` -- configuration objects
- `APP_VERSION`, `LS_KEY`, `SPOT_HISTORY_KEY` -- constants
- `GOLDBACK_DENOMINATIONS`, `GB_TO_OZT`, `FALLBACK_EXCHANGE_RATES` -- Goldback/currency constants
- `FILTER_CHIP_CATEGORY_DEFAULTS`, `INLINE_CHIP_DEFAULTS` -- UI config
- `IMAGE_MAX_DIM`, `IMAGE_QUALITY`, `IMAGE_MAX_BYTES` -- image processor defaults

**From `js/utils.js`:**

- `saveData()`, `loadData()` -- async storage
- `saveDataSync()`, `loadDataSync()` -- sync storage
- `sanitizeHtml(str)` -- XSS prevention
- `formatCurrency(num)`, `formatWeight(num)`, `computeMeltValue(item, spot)` -- formatting/computation
- `cleanupStorage()` -- localStorage whitelist enforcement

**From `js/image-cache.js`:**

- `imageCache` (object) -- IndexedDB image storage API
- Always accessed via `window.imageCache` for consistency with availability checks

**From `js/image-processor.js`:**

- `imageProcessor` (object) -- image resize/compress utility

**From `js/chart-utils.js`:**

- `createSparkline(canvas, data, opts)` -- shared sparkline chart builder
- `buildVendorDatasets(vendors, entries)` -- Chart.js vendor dataset factory
- `createTimeSeriesChart(canvas, datasets, opts)` -- time series chart builder
- `replaceChart(chartRef, canvas, config)` -- safe chart replacement (destroys old, creates new)
- `chartPriceTooltip(context)` -- currency-formatted tooltip callback
- `chartDollarTicks(value)` -- currency-formatted Y-axis tick callback

**From `js/filters.js`:**

- `renderActiveFilters()` -- filter chip rendering
- `activeFilters` (object) -- active filter state

**From `js/changeLog.js`:**

- `logChange(name, action, oldVal, newVal, idx)` -- change tracking

**From `js/diff-engine.js`:**

- `DiffEngine` (object) -- pure-data diff/merge singleton for cloud sync
  - `DiffEngine.computeItemKey(item)` -- derives stable dedup key
  - `DiffEngine.matchItems(local, remote)` -- pairs items by key
  - `DiffEngine.compareItems(local, remote)` -- classifies added/modified/deleted/unchanged
  - `DiffEngine.compareSettings(local, remote)` -- flat key→value diff
  - `DiffEngine.detectConflicts(localChanges, remoteChanges)` -- identifies field conflicts
  - `DiffEngine.applySelectedChanges(inventory, changes)` -- non-destructive apply

**From `js/api-health.js`:**

- `fetchApiHealth()` -- async, fetches retail poller manifest, returns `{generatedAt, ageMinutes, coins, isStale}`
- `updateHealthBadges(health)` -- updates badge elements (`apiHealthBadge`, `apiHealthBadgeAbout`)
- `showApiHealthModal()`, `hideApiHealthModal()` -- modal open/close
- `initApiHealth()` -- init function (called on DOMContentLoaded)

**From `js/spot.js`:**

- `spotHistory` (array) -- spot price history entries
- `recordSpot()`, `saveSpotHistory()`, `loadSpotHistory()`, `purgeSpotHistory()` -- spot persistence
- `updateLastTimestamps()` -- last sync/cache timestamp tracking
- `updateSparkline()`, `updateAllSparklines()`, `getSpotHistoryForMetal()` -- sparkline rendering
- `updateSpotCardColor()` -- card color indicators

**From `js/api.js`:**

- `syncSpotPricesFromApi()`, `syncProviderChain()` -- API sync engine
- `loadApiConfig()`, `saveApiConfig()` -- API configuration persistence
- `providerRequiresKey()`, `loadProviderPriorities()` -- provider utilities
- `DEFAULT_API_QUOTA` -- default quota constant

**From `js/events.js`:**

- `onGoldSpotPriceChanged()`, `recordAllItemPriceSnapshots()` -- event callbacks
- `updateStorageStats()` -- storage statistics

**From `js/goldback.js`:**

- `goldbackPrices`, `goldbackPriceHistory`, `goldbackEnabled`, `goldbackEstimateEnabled`, `goldbackEstimateModifier` -- Goldback state
- `computeGoldbackEstimatedRate()`, `saveGoldbackPrices()`, `isGoldbackPricingActive()` -- Goldback functions

**From `js/retail.js`:**

- `retailPrices`, `retailPriceHistory` -- retail market price snapshot and history (let variables, accessible as bare identifiers in later scripts)
- `syncRetailPrices()`, `renderRetailCards()`, `renderRetailHistoryTable()` -- sync and render functions
- `loadRetailPrices()`, `saveRetailPrices()`, `loadRetailPriceHistory()`, `saveRetailPriceHistory()` -- persistence
- `getRetailHistoryForSlug(slug)` -- history accessor

**From `js/retail-view-modal.js`:**

- `openRetailViewModal(slug)`, `closeRetailViewModal()` -- per-coin detail modal
- `retailTrimTo24h(windows)` -- 24h time filter for intraday chart data (window bridge)

**From `js/priceHistory.js`:**

- `itemPriceHistory` -- per-item price history data
- `recordAllItemPriceSnapshots()`, `clearItemPriceHistory()` -- price history functions

**From `js/spotLookup.js`:**

- `fetchSpotPrices()` -- multi-provider spot price fetcher

**From other modules:**

- `createBackupZip()`, `restoreBackupZip()`, `generateBackupHtml()` -- inventory-backup.js
- `importCsv()`, `importJson()`, `exportCsv()`, `exportNumistaCsv()`, `showImportDiffReview()` -- inventory-import.js
- `renderTable()`, `updateSummary()`, `hideEmptyColumns()`, `recalcItem()`, `persistInventoryAndRefresh()`, `METAL_COLORS`, `METAL_TEXT_COLORS`, `getTypeColor()`, `getColor()` -- inventory-table.js
- `saveInventory()`, `loadInventory()` -- inventory.js
- `catalogManager`, `catalogAPI` -- catalog-\*.js
- `NumistaLookup` -- numista-lookup.js
- `pcgsVerifyCert()`, `pcgsLookupCoin()` -- pcgs-api.js
- `currentMonthKey()` -- utils.js
- `openBulkEdit()`, `closeBulkEdit()` -- bulkEdit.js
- `showSettingsModal()` -- settings.js
- `openVaultModal()` -- vault.js
  **From `js/tags.js`:**

- `loadItemTags()`, `saveItemTags()` -- tag persistence
- `getItemTags(uuid)`, `addItemTag(uuid, tag)`, `removeItemTag(uuid, tag)` -- tag CRUD
- `getAllUniqueTags()`, `renameTag()`, `deleteTagGlobal()` -- bulk tag ops
- `buildTagSection(uuid, numistaTags, onChanged)` -- tag UI component

**From `js/cloud-storage.js`:**

- `cloudAuthStart(provider)`, `cloudIsConnected(provider)`, `cloudDisconnect(provider)` -- OAuth flow
- `cloudGetStoredToken(provider)`, `cloudStoreToken(provider, data)`, `cloudClearToken(provider)` -- token management
- `recordCloudActivity(entry)`, `renderCloudActivityTable()` -- activity logging
- `cloudCheckOAuthRelay()` -- OAuth callback handler

**From `js/settings-listeners.js`:**

- `setupSettingsEventListeners()` -- master settings listener setup
- `bindCloudStorageListeners()`, `bindCloudCacheListeners()` -- cloud UI handlers
- `buildImageExportZip()`, `blobToWebP()` -- image export helpers

**From `js/seed-images.js`:**

- `loadSeedImages()` -- first-run seed image loader

- Plus many others across 63 JS files (71 scripts total)

**IMPORTANT: Do NOT flag any variable as "not defined" in PR reviews.** This is a vanilla JS app with global scope across 63 JS files (71 scripts total). The `no-undef` ESLint rule is intentionally OFF. Every "X is not defined" comment is a false positive. If you are uncertain whether a variable exists, check the other script files before flagging -- it will be defined in another file loaded earlier in the script order.

### 4. Service Worker -- respondWith() Must Always Resolve to a Response

Every `event.respondWith()` call **must** guarantee a `Response` object. This is the #1 cause of PWA crashes:

- `.catch()` only handles **rejections**, not `undefined` from cache misses
- `caches.match()` resolves to `undefined` on a miss -- this is not a rejection
- Use `.then((r) => r || fallback)` to guard against `undefined`, not `.catch()`
- Every promise chain passed to `respondWith()` must end with a guaranteed `Response`

```js
// BAD -- undefined cache miss skips .catch(), respondWith gets undefined
event.respondWith(caches.match(req).catch(() => new Response("fallback")));

// GOOD -- .then() catches both undefined and rejection paths
event.respondWith(
  caches
    .match(req)
    .then((r) => r || fetch(req))
    .then((r) => r || new Response("fallback"))
);
```

### 5. Version Sync -- 7 Files Must Match

When any version-related file changes, verify all 7 are in sync:

| File                       | Field                           |
| -------------------------- | ------------------------------- |
| `js/constants.js`          | `APP_VERSION`                   |
| `package.json`             | `"version"` field               |
| `sw.js`                    | `CACHE_NAME` (includes version) |
| `CHANGELOG.md`             | Latest `## [x.y.z]` heading     |
| `js/about.js`              | `getEmbeddedWhatsNew()` version |
| `version.json`             | `"version"` field               |
| `data/spot-history-*.json` | Seed data should be refreshed   |

If only some files are updated, flag the missing ones.

**Version Lock**: Multiple AI agents work concurrently on this repo. A `devops/version.lock`
file (gitignored) is used as a mutual-exclusion token. If you see an orphaned lock file in a
diff, that is a bug -- it should never be committed.

### 6. XSS Prevention

All user-supplied strings rendered into the DOM must go through `sanitizeHtml()` from `js/utils.js`. Flag any direct `innerHTML` assignment with unsanitized input. Existing `// nosemgrep:` comments indicate reviewed exceptions -- do not flag those.

### 7. CACHE_NAME and APP_VERSION Drift

If `sw.js` CACHE_NAME does not match the version in `js/constants.js`, the service worker will serve stale assets. This causes the What's New splash to re-trigger on every page load. Always flag CACHE_NAME/APP_VERSION mismatches.

### 8. What's New Entry Rotation -- Intentional Limit

`js/about.js` (`getEmbeddedWhatsNew()`) is the **sole source of truth** for What's New content. `docs/announcements.md` was deprecated per STAK-513 and no longer exists -- do not flag it as missing or out of sync. Entries in `getEmbeddedWhatsNew()` are **intentionally capped at 5**. When a new release is added, the oldest entry is rotated out. Do not flag removed older entries as missing -- this is by design.


### 9. Seed Data Files -- Auto-Generated, Must Be Included

Files matching `data/spot-history-*.json` are generated by an external Docker poller that runs continuously. Do not flag formatting, line count changes, or large diffs in these files -- they are machine-generated price data.

**Important**: If a PR modifies version files (`js/constants.js`, `sw.js`, `version.json`, `CHANGELOG.md`) but does **not** include any changes to `data/spot-history-*.json`, leave a reminder comment: "No spot price seed data included -- did you run `/seed-sync` before committing? The Docker poller may have new price data that should ship with this release." This is a soft reminder, not a blocking issue.

### 10. Encrypted Vault Backup

`js/vault.js` implements AES-GCM encrypted backup (.stvault files). Security-sensitive code:

- Never weaken the PBKDF2 iteration count
- Never store passwords or derived keys in localStorage
- Never bypass the password confirmation step on export
- Flag any changes that reduce encryption strength

## ESLint Rules

The project uses `.eslintrc.json` with these settings. Copilot should enforce the same standards:

**Environment**: `browser: true`, `es2020`, `ecmaVersion: 2020`

**Key rules to enforce** (aligned with Codacy's analysis):

| Rule                          | Severity | Rationale                                                                                                                                                                                          |
| ----------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-var`                      | error    | Always use `const` or `let` -- `var` is banned                                                                                                                                                     |
| `eqeqeq`                      | error    | Always use `===` / `!==` -- never `==` / `!=`                                                                                                                                                      |
| `no-implicit-globals`         | warn     | All declarations should be `const`/`let` or inside functions                                                                                                                                       |
| `no-unused-vars`              | warn     | Flag unused variables (ignore params prefixed with `_`, variables from destructured returns like `{ labels, data }` where only `data` is used, and variables marked as legacy aliases in comments) |
| `no-redeclare`                | error    | No re-declaring variables in the same scope                                                                                                                                                        |
| `no-shadow`                   | warn     | Avoid variable shadowing in nested scopes                                                                                                                                                          |
| `no-use-before-define`        | warn     | Functions/variables should be defined before use                                                                                                                                                   |
| `no-eval`                     | error    | Never use `eval()` or `Function()` constructor                                                                                                                                                     |
| `no-implied-eval`             | error    | No `setTimeout`/`setInterval` with string arguments                                                                                                                                                |
| `no-new-wrappers`             | error    | No `new String()`, `new Number()`, `new Boolean()`                                                                                                                                                 |
| `no-throw-literal`            | error    | Only throw `Error` objects                                                                                                                                                                         |
| `no-self-compare`             | error    | No comparing a variable to itself                                                                                                                                                                  |
| `no-template-curly-in-string` | warn     | Catches `"${x}"` that should be `` `${x}` ``                                                                                                                                                       |
| `prefer-const`                | warn     | Use `const` when variable is never reassigned                                                                                                                                                      |
| `no-loop-func`                | warn     | No function declarations inside loops                                                                                                                                                              |
| `no-param-reassign`           | warn     | Avoid reassigning function parameters                                                                                                                                                              |

**`no-undef` is intentionally OFF** -- the app uses global scope extensively across script files (no module bundler). Functions and constants from one file are used in another via the shared global scope.

**Code style conventions** (not in `.eslintrc.json` but enforced project-wide):

- 2-space indentation, no tabs
- Semicolons always required
- Trailing commas in multi-line arrays/objects (ES2017+)
- 120-character soft line limit
- `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for constants
- Arrow functions preferred for callbacks: `arr.map((x) => x.id)`
- Template literals preferred over string concatenation

## PMD Rules (ECMAScript)

The project uses `ruleset.xml` at the project root. PMD analyzes JavaScript for error-prone patterns.

**Active ruleset**: All `category/ecmascript/errorprone.xml` rules **except**:

| Excluded Rule               | Reason                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `InnaccurateNumericLiteral` | Values like `42.00`, `3400.00`, `0.0005` are exactly representable in IEEE 754 -- false positives for a financial app |
| `AvoidTrailingComma`        | Trailing commas are standard ES2017+ and used throughout per coding standards                                         |

**Key PMD rules that ARE active** -- flag violations of these:

| Rule                  | What it catches                                                 |
| --------------------- | --------------------------------------------------------------- |
| `EqualComparison`     | Using `==` instead of `===`                                     |
| `UnreachableCode`     | Code after `return`, `throw`, `break`, `continue`               |
| `ConsistentReturn`    | Functions that sometimes return a value and sometimes don't     |
| `AssignmentInOperand` | Assignments inside `if`/`while` conditions (usually a typo)     |
| `ScopeError`          | Variables used outside their declared scope                     |
| `GlobalVariable`      | Implicit global variable creation (missing `const`/`let`/`var`) |

## Documentation Policy

DocVault (`/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/`) is the single source of truth for all architecture, operational runbooks, and pattern documentation.
New documentation goes in DocVault (or `docs/plans/` for planning artifacts).

After any commit that changes behavior, update the relevant DocVault page directly.

---

## Known False Positives — Do Not Flag

These patterns fire regularly on this codebase but are false positives given StakTrakr's architecture. Before flagging any of these, re-read the reasoning. If the reasoning no longer applies (e.g., server-side code has been added), escalate.

### CodeQL: `js/clear-text-storage-of-sensitive-data`

**Pattern:** CodeQL flags any `localStorage.setItem()` call that writes an object containing field names like `apiKey`, `access_token`, or `refresh_token`.

**Why it's a false positive here:** StakTrakr is a single-user personal finance app. There are no server secrets. The credentials flagged (Numista API key, Dropbox OAuth token) are entered by the user for their own use and stored on their own device in their own browser. The Numista API key is additionally base64-encoded before storage. The threat model is XSS reading localStorage — not server-side secret leakage. Do not flag unless server-side credential handling is introduced.

### GitHub Advanced Security / CodeQL: `js/incomplete-multi-character-sanitization`

**Pattern:** Flags sanitization regexes as insufficient (e.g., `/<script>/gi`).

**Check first:** If the regex already uses the full safe form — `/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi` — the finding is stale/resolved. Verify the actual pattern before flagging.

### GitHub Advanced Security: Format string injection in `console.log`/`console.error`

**Pattern:** Flags `console.error(templateLiteral, err)` as a "format string depends on user-provided value."

**Why it's a false positive here:** Node.js `console.error` does not perform `%s`/`%d` printf-style substitution when the first argument is a string. Template literals that interpolate user values produce a plain string argument — there is no injection surface. Only flag if user input is passed as the _first positional argument to a function that does perform format substitution_ (e.g., `sprintf`, `util.format`).

### Copilot: `document.getElementById` in `about.js` and `init.js`

**Pattern:** Flags raw `document.getElementById()` calls as violating the `safeGetElement()` convention.

**Why it's acceptable:** Startup code in `about.js` and `init.js` runs once before the app is fully initialized and operates on elements guaranteed to exist at DOM-ready. The `safeGetElement()` convention applies to all other files. See Section 1 above.

### Copilot: "undefined variable" in any JS file

Already covered in Section 3. Do not re-flag here.

---

## Review Focus Areas

- **Error handling in async code**: Promise chains should have `.catch()` handlers, especially in service worker code and API calls
- **New localStorage keys**: Must be added to `ALLOWED_STORAGE_KEYS` before use
- **CSS changes**: The app supports four themes (light, dark, sepia, system). Verify color values use CSS custom properties (`var(--...)`) rather than hardcoded colors
- **Mobile responsiveness**: The app uses a card view below 1350px breakpoint. Check that new UI elements are responsive
- **Image system changes**: `image-cache.js` uses IndexedDB -- verify CORS strategy and fallback paths are maintained
- **Goldback pricing**: Changes to `goldback.js` or `computeMeltValue()` in `utils.js` affect financial calculations -- verify math is correct
