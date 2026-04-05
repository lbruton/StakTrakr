# Project Structure

## Directory Organization

```
StakTrakr/
├── index.html              # Single-page application entry point (4,900+ lines)
├── sw.js                   # Service Worker — offline caching, auto-stamped CACHE_NAME
├── manifest.json           # PWA manifest (installable app)
├── version.json            # Current version metadata
├── package.json            # Dev dependencies only (ESLint, Playwright)
├── js/                     # Application JavaScript (66 files)
│   ├── constants.js        # Global config: version, API providers, currencies, storage keys
│   ├── state.js            # In-memory state container
│   ├── utils.js            # Core utilities: saveData/loadData, safeGetElement, sanitizeHtml
│   ├── dialogs.js          # Generic dialog/modal helpers
│   ├── events.js           # All DOM event listeners and handlers
│   ├── inventory.js        # Item CRUD, calculations, rendering (largest file)
│   ├── api.js              # Spot/retail price fetching, provider abstraction
│   ├── settings.js         # Settings UI and persistence
│   ├── init.js             # Startup sequence (always loads last)
│   └── ... (48 more)       # Modular feature files (see load order below)
├── css/
│   └── styles.css          # All styling in one file (264 KB)
├── vendor/                 # Bundled third-party libraries (CDN fallback)
│   ├── chart.min.js        # Chart.js 3.9.1
│   ├── chartjs-plugin-datalabels.min.js
│   ├── forge.min.js        # Forge 0.10.0
│   ├── jspdf.umd.min.js    # jsPDF 2.5.1
│   ├── jspdf.plugin.autotable.min.js
│   ├── jszip.min.js        # JSZip 3.10.1
│   └── papaparse.min.js    # PapaParse 5.4.1
├── images/                 # Static image assets (icons, logos)
├── about/                  # About page content (announcements, changelog source)
├── data/                   # API data feeds (hourly spot, manifests, goldback)
│   └── spot-history-bundle.js  # Seed spot prices (loaded as script)
├── tests/                  # Playwright E2E specs (16 test files)
├── devops/                 # Infrastructure: CGC Docker, version lock, git hooks, CI/CD
│   ├── cgc/                # Code Graph Context Docker setup
│   ├── hooks/              # Git pre-commit hooks (cache stamp, version check)
│   └── version.lock        # Mutex for concurrent patch versioning
├── docs/                   # Documentation: JSDoc HTML output, plans, runbooks
├── deprecated/             # Archived legacy code
├── .spec-workflow/         # Spec workflow plugin (specs, steering docs, approvals)
├── .claude/                # Claude Code config (skills, worktrees, plans)
├── .github/                # GitHub Actions workflows, Copilot instructions
└── .codacy.yml             # Code quality gate configuration
```

## Naming Conventions

### Files
- **JS modules**: `kebab-case.js` (e.g., `cloud-sync.js`, `card-view.js`, `api-health.js`)
- **Single-word modules**: `lowercase.js` (e.g., `utils.js`, `state.js`, `init.js`)
- **Vendor libraries**: Original upstream names (e.g., `chart.min.js`, `forge.min.js`)
- **Tests**: `kebab-case.spec.js` (e.g., `cloud-sync.spec.js`, `crud.spec.js`)

### Code
- **Functions/Methods**: `camelCase` (e.g., `saveData()`, `loadData()`, `safeGetElement()`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `ALLOWED_STORAGE_KEYS`, `API_PROVIDERS`, `VERSION`)
- **Variables**: `camelCase` (e.g., `currentSpot`, `inventoryItems`, `filterState`)
- **DOM IDs**: `kebab-case` in HTML (e.g., `spot-price-display`, `inventory-table`)
- **CSS classes**: `kebab-case` (e.g., `.card-view-item`, `.spot-badge`)

## Script Load Order (Critical)

All 66 JS files load via `<script defer>` in strict dependency order in `index.html`. This order **must** be maintained — reordering breaks the app.

```
Phase 1 — Synchronous (before DOM):
  file-protocol-fix.js          # localStorage polyfill for file:// protocol

Phase 2 — Vendor libraries (deferred):
  papaparse.min.js, jspdf.umd.min.js, jspdf.plugin.autotable.min.js,
  chart.min.js, chartjs-plugin-datalabels.min.js, jszip.min.js, forge.min.js

Phase 3 — Inline scripts:
  CDN fallback loader            # Checks vendor load, falls back to CDNJS with SRI
  Theme flash prevention         # Applies dark mode before paint

Phase 4 — Application (deferred, strict order):
  debug-log.js                   # Debug logging utility
  constants.js                   # Config, API providers, storage keys, version
  state.js                       # Global state container
  utils.js                       # Core utilities (saveData, loadData, sanitizeHtml)
  dialogs.js                     # Modal/dialog helpers
  image-processor.js             # Image format conversion
  image-cache.js                 # Image localStorage cache
  bulk-image-cache.js            # Bulk image download
  image-cache-modal.js           # Cache management UI
  fuzzy-search.js                # Fuzzy matching algorithm
  autocomplete.js                # Autocomplete widget
  numista-lookup.js              # Numista API client
  seed-images.js                 # Seed product images
  versionCheck.js                # Version update detection
  changeLog.js                   # Changelog display
  diff-engine.js                 # Change detection for sync
  charts.js                      # Chart.js wrapper
  theme.js                       # Dark/light mode toggle
  search.js                      # Global item search
  chip-grouping.js               # Tag/chip rendering
  tags.js                        # Item tagging system
  filters.js                     # Multi-criteria filtering
  sorting.js                     # Item sort logic
  pagination.js                  # Result pagination
  detailsModal.js                # Item metadata modal
  viewModal.js                   # Item detail modal
  debugModal.js                  # Debug info modal
  numista-modal.js               # Numista lookup modal
  spot.js                        # Spot price history & alerts
  data/spot-history-bundle.js    # Seed spot price data
  seed-data.js                   # Seed inventory data
  priceHistory.js                # Price trend charts
  spotLookup.js                  # Spot price lookup UI
  goldback.js                    # Goldback-specific pricing
  retail.js                      # Retail price integration
  retail-view-modal.js           # Retail modal UI
  api.js                         # API orchestration (spot/retail fetching)
  catalog-api.js                 # Numista/PCGS catalog API
  pcgs-api.js                    # PCGS grading integration
  catalog-providers.js           # Catalog provider abstraction
  catalog-manager.js             # Catalog data management
  inventory.js                   # Core CRUD, calculations, rendering
  card-view.js                   # Card display layout
  vault.js                       # Encrypted vault
  cloud-storage.js               # Cloud sync abstraction
  cloud-sync.js                  # Cloud data sync logic
  about.js                       # About page
  api-health.js                  # API freshness checks
  faq.js                         # FAQ content
  customMapping.js               # Custom field mapping
  settings.js                    # Settings UI
  settings-listeners.js          # Settings event handlers
  bulkEdit.js                    # Batch item editing
  events.js                      # All DOM event listeners (must be near-last)
  test-loader.js                 # Test framework loader
  init.js                        # Startup sequence (always last)
```

**Rule**: When adding a new JS file, it must be added to **both** `index.html` (in correct dependency position) **and** `sw.js` CORE_ASSETS array.

## Code Structure Patterns

### Mandatory Safety Patterns
```javascript
// DOM access — ALWAYS use safeGetElement, never raw getElementById
const el = safeGetElement('my-element-id');

// innerHTML — ALWAYS sanitize user content
el.innerHTML = sanitizeHtml(userProvidedContent);

// Storage — ALWAYS use saveData/loadData from utils.js
saveData('myKey', myValue);
const data = loadData('myKey');

// Storage keys — MUST be registered in constants.js
// ALLOWED_STORAGE_KEYS in js/constants.js
```

### Module Organization Pattern
Each JS file follows a consistent structure:
```
1. 'use strict' (if present)
2. Constants / config specific to this module
3. DOM element references (via safeGetElement)
4. Core functions (public API)
5. Helper/private functions
6. Event listener setup (if any)
7. Exports to window/global scope (implicit — no ES modules)
```

### State Flow
```
User action → events.js handler → state.js mutation → render function → DOM update
                                → saveData() → localStorage persistence
```

### Import Pattern
No ES modules — all scripts share the global scope via `window`. Dependencies are resolved by script load order in `index.html`. Functions are accessed directly by name (e.g., `saveData()`, `safeGetElement()`, `renderInventory()`).

## Module Boundaries

| Layer | Files | Depends On |
|-------|-------|------------|
| **Constants** | `constants.js` | Nothing |
| **State** | `state.js` | `constants.js` |
| **Utilities** | `utils.js`, `dialogs.js`, `debug-log.js` | `constants.js`, `state.js` |
| **Data/Cache** | `image-cache.js`, `diff-engine.js`, `seed-data.js` | Utilities |
| **Search/Filter** | `fuzzy-search.js`, `search.js`, `filters.js`, `sorting.js`, `pagination.js` | Utilities, State |
| **UI Components** | `viewModal.js`, `detailsModal.js`, `card-view.js`, `chip-grouping.js` | Utilities, State |
| **API** | `api.js`, `spot.js`, `retail.js`, `catalog-api.js`, `goldback.js` | Constants, Utilities |
| **Domain** | `inventory.js`, `vault.js`, `cloud-sync.js`, `bulkEdit.js` | All above layers |
| **Orchestration** | `events.js`, `settings.js` | All above layers |
| **Bootstrap** | `init.js` | Everything (runs startup sequence) |

## Code Size Guidelines

- **Target file size**: Under 50 KB per file (aspiration — several core files exceed this)
- **Current large files**: `inventory.js` (164 KB), `events.js` (110 KB), `api.js` (108 KB), `utils.js` (97 KB), `settings.js` (89 KB) — these are candidates for future decomposition
- **Function size**: Aim for under 50 lines; complex render functions may exceed this
- **Nesting depth**: Maximum 4 levels of indentation

## Documentation Standards
- JSDoc comments on public functions (auto-generated HTML in `docs/api/`)
- Inline comments only where logic is non-obvious
- No README files per module — project-level CLAUDE.md and DocVault serve as documentation
