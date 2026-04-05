# Technology Stack

## Project Type
Single-page web application — vanilla JavaScript with zero build step. Runs directly from `index.html` on `file://` protocol, local HTTP server, or static hosting (GitHub Pages). No framework, no transpilation, no bundling.

## Core Technologies

### Primary Language(s)
- **Language**: JavaScript (ES6+), HTML5, CSS3
- **Runtime**: Browser-native (no Node.js runtime required for production)
- **Language-specific tools**: ESLint for linting; no compiler or transpiler

### Key Dependencies/Libraries
All vendored locally in `vendor/` with CDN SRI fallback:

- **Chart.js 3.9.1 + DataLabels 2.2.0**: Portfolio allocation charts, spot price history visualization
- **jsPDF 2.5.1 + AutoTable 3.5.25**: PDF export with formatted tables for portfolio reports
- **PapaParse 5.4.1**: CSV parsing for data import/export
- **JSZip 3.10.1**: ZIP compression for encrypted cloud sync backups
- **Forge 0.10.0**: AES encryption for vault password protection and cloud sync encryption

### Application Architecture
Event-driven single-page application with imperative DOM manipulation:

- **State**: Global state container in `state.js` — inventory, filters, UI preferences held in memory
- **Rendering**: Direct DOM updates via vanilla JS; no virtual DOM, no reactivity framework
- **Events**: Centralized event listeners in `events.js`; UI actions trigger state mutations then re-renders
- **Initialization**: Sequential startup in `init.js` — load data, fetch spot prices, render inventory
- **Change detection**: `diff-engine.js` compares local vs cloud state for sync conflict resolution

### Data Storage
- **Primary storage**: `localStorage` via `saveData(key, value)` / `loadData(key)` utilities in `js/utils.js`
- **Storage key registry**: All keys must be declared in `ALLOWED_STORAGE_KEYS` in `js/constants.js`
- **Cloud sync**: AES-encrypted ZIP archive (JSZip + Forge) uploaded/downloaded to user-controlled cloud storage
- **Image cache**: IndexedDB-backed image storage API exposed as `window.imageCache` in `js/image-cache.js`
- **Data formats**: JSON throughout (localStorage values, API responses, import/export)

### External Integrations
- **Spot Price APIs**: Multi-provider with failover chain — StakTrakr API (primary, self-hosted on Fly.io), Metals.dev, Metal Price API, custom user endpoint
- **Retail Price API**: StakTrakr API aggregated dealer prices at `api.staktrakr.com/data/api/manifest.json`
- **Goldback Spot**: Dedicated feed at `api.staktrakr.com/data/api/goldback-spot.json`
- **Numista API**: Coin catalog lookup for identification and metadata enrichment
- **PCGS API**: Grading service lookup for certified coin data
- **Protocols**: HTTP/HTTPS REST (JSON responses)
- **Authentication**: API keys for third-party providers (stored in Infisical vault, not in frontend code)

### Monitoring & Dashboard Technologies
- **Dashboard Framework**: Vanilla JS — no framework
- **Real-time Communication**: Polling-based spot price refresh (configurable interval)
- **Visualization Libraries**: Chart.js 3.9.1 for line/doughnut/bar charts
- **State Management**: localStorage as source of truth; in-memory `state.js` for runtime

## Development Environment

### Build & Development Tools
- **Build System**: None — zero build step by design
- **Package Management**: npm (dev dependencies only — ESLint, Playwright)
- **Development workflow**: Open `index.html` in browser; edit JS/CSS files; refresh. No hot reload, no dev server required.

### Code Quality Tools
- **Static Analysis**: ESLint 9.21.0 with custom rules; Codacy automated PR quality gates
- **Formatting**: ESLint-enforced style (no Prettier)
- **Documentation**: JSDoc comments; in-repo wiki under `wiki/`

### Testing Strategy
- **Methodology**: TDD — write failing tests BEFORE implementation code. All new behavior gets a regression test first.
- **Unit/Integration**: No unit test framework (vanilla JS SPA) — natural language E2E runbook tests are the primary test layer.
- **Browser/E2E**: `tests/runbook/*.md` — 84 NL E2E tests across 8 sections, executed via `/bb-test` through Browserbase/Stagehand against PR preview URLs. TDD enforced: write test blocks BEFORE code.
- **Cloud verification**: Browserbase executes all E2E tests against Cloudflare preview deployments. Cloud sync/OAuth tested manually at `beta.staktrakr.com`.

### Version Control & Collaboration
- **VCS**: Git (GitHub)
- **Branching Strategy**: `dev` (active development) → `main` (releases only). Feature work on `patch/VERSION` worktree branches that PR into `dev`. Never push directly to `dev` or `main` — both are branch-protected with Codacy quality gates.
- **Code Review Process**: Draft PRs with Codacy checks; Cloudflare preview deployments for QA; `/pr-resolve` skill for review thread resolution

## Deployment & Distribution
- **Target Platform(s)**: Any modern web browser (Chrome, Firefox, Safari, Edge). Desktop and mobile.
- **Distribution Method**: GitHub Pages static hosting at `staktrakr.com`; also distributable as a folder (works from `file://`)
- **Installation Requirements**: None — open in browser. PWA installable via browser "Add to Home Screen"
- **Update Mechanism**: Service Worker cache invalidation on version bump; `versionCheck.js` detects new versions and prompts user

## Technical Requirements & Constraints

### Performance Requirements
- Sub-second render for inventories up to 1,000 items
- Spot price fetch and portfolio recalculation under 2 seconds
- Service Worker install/activate under 3 seconds on first load

### Compatibility Requirements
- **Platform Support**: All modern browsers (ES6+ required). `file://` protocol support via `file-protocol-fix.js` polyfill
- **Dependency Versions**: Vendor libraries pinned (bundled in `vendor/`); no runtime dependency resolution
- **Standards Compliance**: PWA (Web App Manifest + Service Worker); Web Crypto API for encryption fallback

### Security & Compliance
- **Security Requirements**: `sanitizeHtml()` on all user-controlled innerHTML; `safeGetElement()` for DOM access; AES encryption for cloud sync and vault
- **No telemetry**: Zero external analytics, no tracking pixels, no third-party scripts except explicit API calls
- **Threat Model**: localStorage data accessible to same-origin scripts; cloud sync encrypted at rest; API keys never stored in frontend

### Scalability & Reliability
- **Expected Load**: Single-user application; no concurrent access concerns
- **Availability Requirements**: Offline-capable via Service Worker; no server uptime dependency for core functionality
- **Growth Projections**: localStorage limit (~5-10MB) is the primary constraint; image cache uses LRU eviction to stay within bounds

## Technical Decisions & Rationale

### Decision Log
1. **Vanilla JS over React/Vue**: Eliminates build tooling, reduces complexity, enables `file://` distribution. Trade-off: larger individual files, manual DOM management.
2. **localStorage over IndexedDB**: Simpler API, synchronous access, sufficient for inventory data. Trade-off: ~5MB limit, no structured queries.
3. **Vendored libraries over npm/CDN-only**: Ensures offline and `file://` operation. CDN fallback with SRI hashes provides redundancy without requiring network.
4. **Service Worker caching**: Enables PWA installation and offline use. Cache name auto-stamped by pre-commit hook to force updates on version bumps.
5. **Multi-provider spot price failover**: Avoids single point of failure for price data. Primary (StakTrakr API on Fly.io) with automatic cascade to third-party providers.

## Known Limitations

- **File size**: Several core JS files exceed 100KB (`inventory.js` 164KB, `events.js` 110KB, `api.js` 108KB) — candidates for future modularization
- **localStorage cap**: ~5-10MB browser limit constrains total data + image cache size
- **No concurrent editing**: Single-browser assumption; cloud sync handles cross-device but not simultaneous edits
- **Script load order**: 67 `<script>` tags with strict dependency ordering — adding new files requires updating both `index.html` and `sw.js` CORE_ASSETS
- **Version propagation**: Version number lives in 7 files — automated by `/release` skill but fragile if done manually
