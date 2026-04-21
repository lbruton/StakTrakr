<p align="center">
  <img src="images/banner-logo-compact.svg" alt="StakTrakr" height="64">
</p>

<p align="center">
  Track your precious metals stack. Your way.
</p>

<p align="center">
  <a href="https://github.com/lbruton/StakTrakr/blob/main/LICENSE"><img src="https://img.shields.io/github/license/lbruton/StakTrakr?style=flat-square" alt="MIT License"></a>
  <a href="https://app.codacy.com/gh/lbruton/StakTrakr/dashboard"><img src="https://app.codacy.com/project/badge/Grade/b8d30126676546cb958fa6a7e0174da8" alt="Codacy Badge"></a>
  <a href="https://github.com/lbruton/StakTrakr/issues"><img src="https://img.shields.io/github/issues/lbruton/StakTrakr?style=flat-square" alt="GitHub Issues"></a>
  <a href="https://www.reddit.com/r/staktrakr/"><img src="https://img.shields.io/reddit/subreddit-subscribers/staktrakr?style=flat-square&label=community" alt="Reddit Community"></a>
  <a href="https://github.com/sponsors/lbruton"><img src="https://img.shields.io/badge/sponsor-%E2%99%A1-ea4aaa?style=flat-square" alt="Sponsor"></a>
</p>

<p align="center">
  <a href="https://www.staktrakr.com"><strong>Launch App</strong></a> &bull;
  <a href="https://beta.staktrakr.com">Beta</a> &bull;
  <a href="https://lbruton.github.io/StakTrakr/about.html">About</a> &bull;
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

A powerful, privacy-first portfolio tracker for Silver, Gold, Platinum, Palladium, and Goldbacks. Runs entirely in your browser — your stack, your data, your rules.

![StakTrakr Dashboard](screenshots/01-hero-overview.png)

## Market Prices & Item View

| Vendor Price Matrix                                | Item View Modal                                  |
| -------------------------------------------------- | ------------------------------------------------ |
| ![Vendor Prices](screenshots/04-vendor-prices.png) | ![Item View](screenshots/06-item-view-modal.png) |

## Settings

| About                                                | Appearance                                                     | Inventory                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| ![Settings About](screenshots/07-settings-about.png) | ![Settings Appearance](screenshots/08-settings-appearance.png) | ![Settings Inventory](screenshots/09-settings-inventory.png) |

---

## Why StakTrakr?

Most precious metals apps want your email, store your data on their servers, or lock features behind a paywall. StakTrakr is different:

- **100% client-side** — all data lives in your browser. The full source is available to anyone; it even runs on `file://` from a single HTML file
- **Zero data collection** — no account, no email, no profile. Nothing leaves your device unless you explicitly cloud-backup
- **Works offline** — once loaded, the app works without internet (spot prices require connectivity)
- **Portable** — download the ZIP, open `index.html`, and it runs anywhere, forever
- **Open source** — MIT licensed, fork it, hack it, make it yours
- **Free, always** — every feature is free. Optional [sponsorships](https://github.com/sponsors/lbruton) support the free API infrastructure

---

## Features

### Live Spot Prices

Real-time prices from multiple API providers with automatic failover:

- **Free, keyless provider** — `api.staktrakr.com` delivers hourly spot prices out of the box; no API key needed to get started
- **Sparkline charts** — interactive mini price charts with 7d / 30d / 60d / 90d range selector
- **Percentage change** — see how each metal has moved over your selected timeframe
- **Provider priority** — configure up to 5 API providers (Metals.dev, MetalPriceAPI, GoldAPI, and more) with configurable sync priority
- **Seed data included** — years of historical prices (1968–present) baked in; sparklines work from day one
- **Health indicators** — color-coded status dots show API sync freshness at a glance

### Market Prices & Vendor Comparison

Real-time retail market prices from major bullion dealers, powered by the StakTrakr API:

- **Best Price Ticker** — scrolling ticker strip below spot cards showing the cheapest vendor per coin with premium percentages and direct buy links
- **Vendor Prices Table** — full comparison matrix across Gold, Silver, Platinum, Palladium, and Goldback tabs with per-vendor prices, premium badges, and clickable buy links to vendor product pages
- **Market Detail Modal** — click any coin to view TradingView Lightweight Charts 7-day spot history overlaid with per-vendor price comparison lines
- **Market List View** — full-width card layout with inline 7-day trend charts, vendor price chips with brand-colored labels, medal rankings for best prices, and computed MED/LOW/AVG stats
- **Metal filter pills** — filter market cards by metal type with color-coded pill buttons
- **Intraday trends** — toggle between current price and hourly percentage change on market cards
- **Manifest-driven** — the API can add new coins without any frontend code changes
- **Goldback support** — denomination-aware pricing for all Goldback variants (G½ through G50) across multiple state series with goldback.com reference pricing
- **Configurable layout** — Vendor Prices and Best Price Ticker sections are toggleable and reorderable in Settings > Layout

### Portfolio Tracking

Full per-item tracking with a rich data model:

- **Purchase Price / Melt Value / Retail Price** with computed Gain/Loss per item and portfolio-wide
- **Realized Gains/Losses** — mark items as Sold, Traded, Lost, Gifted, or Returned via disposition workflow with realized gain/loss calculation, color-coded badges, and full transaction history
- **Goldback support** — denomination-aware pricing (½, 1, 5, 10, 25, 50) with real-time estimation and manual rate management
- **Weight units** — troy ounces, kilograms, and pounds with automatic conversion
- **Year, Grade, Grading Authority, Cert #** — full numismatic metadata
- **PCGS catalog numbers** with inline chips and one-click CoinFacts lookup
- **PCGS / NGC cert verification** — verify grading directly from the inventory table
- **Serial numbers** for bars and notes, **Notes** per item with indicator badges
- **Item photos** — upload your own photos or pull CDN images from Numista; obverse and reverse supported
- **Per-item price history** — track retail price over time with inline chart and delete controls
- **Storage Location** tracking per item

### Portfolio Summary

- **Summary bar** — Buy / Melt / Market / G/L displayed at the top, with item count and total weight in troy ounces (shows filtered/total when filters active)
- **Disposed item totals** — realized gain/loss per metal shown alongside active portfolio stats

### Four Card Styles + Table View

- **Style A — Sparkline Header**: live price chart in the card header
- **Style B — Full-Bleed Overlay**: image-dominant with overlay text
- **Style C — Split Card**: image left, data right
- **Style D — Accessible Table**: horizontal-scroll layout optimized for readability
- **Table view** with multi-column sorting, per-item thumbnails, and inline chip badges
- Toggle between card and table with a single header button

### Smart Filter Chips

A filtering system that adapts to your collection:

- **Auto-generated chips** — Metal, Type, Name, Year, Grade, Numista ID, Source, and Storage Location chips appear automatically
- **Smart name grouping** — "American Silver Eagle" consolidates into one chip with count badge
- **Save Search as Chip** — bookmark a multi-term comma-separated search as a persistent custom filter chip
- **Custom grouping rules** — define your own chip labels matching multiple name variants
- **Dynamic chips** — auto-extract text from parentheses and quotes in item names
- **Chip blacklist** — right-click any chip to hide it
- **Chip max count** — configurable cap on displayed chips to prevent overflow on small screens
- **10 configurable categories** — enable/disable, reorder, and sort (A-Z or by count)

### Item Tags

- **Numista tags** — synced automatically from the Numista API (Bullion, Proof, Commemorative, etc.) with configurable auto-apply toggle
- **Custom tags** — add your own tags per item with autocomplete from existing tags
- **Independent tag blacklist** — separate from chip grouping, managed in Settings
- **Tag management** — rename and delete tags globally across all items
- **Filter integration** — tags show as filter chips and are searchable

### Numista & PCGS Integration

- **Numista search** — look up any coin, get catalog numbers, images, and metadata
- **Bulk sync** — sync metadata and CDN image URLs for your entire inventory in one operation with progress log
- **Custom pattern rules** — regex-based rules that auto-match Numista catalog IDs to your item names
- **Per-field origin tracking** — tracks whether each field came from Numista, PCGS, CSV import, or manual entry
- **Two-tier re-sync picker** — diff hints and smart pre-check defaults based on field origin when re-syncing items
- **PCGS lookup** — search by PCGS number, populate form fields from catalog data
- **Cert verification** — grade badge on PCGS/NGC graded items links directly to the grading service
- **Inline chips** — N#, PCGS#, Grade, Year, Serial, Storage, and Notes badges in the Name column (configurable)

### Item View Modal

Click any item for a full-detail view:

- **Price history chart** — melt value derived from spot history since purchase, retail line, 1Y/5Y/10Y/Purchased range pills, and a custom date range picker
- **Certification badge** — authority-color-coded (PCGS gold, NGC blue, etc.) with one-click cert verification
- **Valuation section** — purchase price, melt value, retail, gain/loss with purchase date shown
- **Numista metadata** — type, composition, weight, series, and description from the Numista API
- **Tags** — view and manage item tags inline
- **Disposition history** — full transaction details for disposed items with "Restore to Inventory" option

### Cloud Sync

Encrypt your inventory and sync it across devices:

- **Dropbox** — connect via OAuth PKCE, encrypted `.stvault` files (AES-256-GCM)
- **Bi-directional sync** — automatic polling with conflict detection and resolution
- **DiffModal** — visual item-level and settings-level diff review before applying remote changes, with click-to-pick field selection for granular merge control
- **Item cards** — bordered card layout with metal-colored image placeholders and async image loading in the sync review
- **Settings sync** — 44 sync-scoped keys covering all user preferences, feature toggles, API credentials, and header button config
- **Image vault** — encrypted photo sync across devices with automatic push/pull
- **Backup safety** — cloud-side backup-before-overwrite, configurable backup history depth (3/5/10/20), separate manual and sync backup management
- **Multi-account** — switch Dropbox accounts with forced re-authentication
- **Multi-tab guard** — BroadcastChannel leader election prevents concurrent sync from multiple tabs
- **Zero-knowledge** — the cloud provider receives only ciphertext; your plaintext never leaves your device
- **Coming soon** — Google Drive, OneDrive, pCloud, Box (same encryption, all client-side)

### Import / Export / Backup

- **CSV import** — intelligent field mapping, regex-based custom rules, merge/override modes with DiffModal preview
- **CSV / JSON / PDF export** — all fields including numismatic metadata, image URLs, Storage Location, and Tags
- **ZIP backup** — full application state (inventory, settings, API keys, price history, image URLs) with DiffModal preview on restore
- **Encrypted vault** — AES-256-GCM `.stvault` files with PBKDF2 key derivation and password strength meter
- **Spot history import/export** — export price history as CSV, import on another device
- **Export origin tracking** — cross-domain import warnings when importing from a different instance
- **Post-import summary** — banner showing added, updated, and skipped item counts

### Bulk Edit

Full-screen bulk operations in Settings > Inventory:

- Select multiple items with a searchable checkbox table
- Edit 16 fields at once with enable/disable toggles per field
- Copy or delete items in bulk
- Numista Lookup populates bulk fields from catalog data

### Clone Mode

- **Inline clone** — clone button activates clone mode on the edit modal with field-level checkboxes
- **Save & Clone Another** — create multiple clones in one session without closing the modal

### Settings

Everything in one place with sidebar navigation:

| Tab            | What's Here                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------- |
| **About**      | Version info, API status badge, What's New, roadmap, badges, changelog link                         |
| **Appearance** | Theme (Light / Dark / Sepia / System), header button visibility and reorder, layout section toggles |
| **Inventory**  | Card styles (A/B/C/D), default sort, visible rows, import/export/backup controls, bulk edit         |
| **Chips**      | Category toggles, sort order, grouping rules, blacklist, max count                                  |
| **API**        | Multi-provider configuration with priority order, Numista and PCGS tabs, usage tracking             |
| **Cloud**      | Dropbox connection, cloud backup/restore, activity log, sync history, multi-account management      |
| **System**     | Timezone, storage dashboard, reset                                                                  |
| **Log**        | Full change log with undo/redo                                                                      |
| **FAQ**        | Privacy, backup, security, and limitations — built into the app                                     |

### More

- **PWA support** — install to your home screen / desktop, works offline
- **Multi-currency** — 17 currencies with live exchange rates (Open Exchange Rates)
- **Fuzzy search** — across all fields including Year, Grade, Cert #, and Numista ID
- **Shift+click / long-press inline editing** — click any editable cell to edit in place (mobile long-press supported)
- **Change log** — tracks every edit with full undo/redo
- **Storage dashboard** — see localStorage (blue) and IndexedDB (green) usage side by side
- **Timezone-aware** — all timestamps display in your configured timezone; stored data stays UTC
- **Three-state disposed filter** — Hide / Show All / Disposed Only with persistent selection
- **Environment badges** — BETA / PREVIEW / LOCAL indicators on non-production domains

---

## Getting Started

### Option 1 — Just open it

Download a release ZIP, extract, and open `index.html` in any modern browser. No server required.

### Option 2 — Local HTTP server

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### Option 3 — Live site

Visit [www.staktrakr.com](https://www.staktrakr.com) — same app, hosted on Cloudflare Pages.

### First launch

StakTrakr comes pre-loaded with **sample inventory items** and **years of spot price history** so you can explore every feature immediately. Sample items are clearly labeled — edit or delete them whenever you're ready.

Live spot prices and market prices work out of the box via the free `api.staktrakr.com` provider. For higher-frequency spot updates, add a free API key from [Metals.dev](https://metals.dev) or another supported provider in Settings > API.

### Optional API Keys

StakTrakr works fully out of the box, but two optional integrations enhance the experience:

- **Numista API** — free key from [numista.com](https://en.numista.com/api/) enables coin catalog search, automatic image population, and metadata sync. Dramatically enriches your inventory with composition, weight, series, and catalog images.
- **PCGS API** — free key from [pcgs.com](https://www.pcgs.com/coinfacts) enables PCGS number lookup and cert verification for graded coins.

Both are optional and configured in Settings > API.

---

## Data & Privacy

- **No server-side component** — the developer has no technical means to access your data
- **No cookies, no tracking SDKs, no advertising** — the app uses only localStorage and IndexedDB for your own data
- **Cloudflare Web Analytics** runs on the hosted site (staktrakr.com) — aggregated, anonymous page-view counts only; no cookies, no individual fingerprinting. Cloudflare may set a temporary infrastructure cookie (e.g. `__cf_bm`) for bot protection — safe to block. Not present when running locally
- **Cloud backup is zero-knowledge** — AES-256-GCM + PBKDF2-SHA256 (100,000 iterations) via the Web Crypto API; the cloud provider receives only ciphertext
- **localStorage caveat** — browser storage can be cleared. Export ZIP or vault backups regularly, especially on iOS Safari

Full details in the [Privacy Policy](https://www.staktrakr.com/privacy.html) and the FAQ tab in Settings.

---

## Tech Stack

| Layer            | Technology                                                                      |
| ---------------- | ------------------------------------------------------------------------------- |
| Runtime          | Pure client-side JavaScript (no framework, no build step)                       |
| Storage          | Browser localStorage + IndexedDB                                                |
| Encryption       | Web Crypto API — AES-256-GCM via PBKDF2                                         |
| Styling          | Vanilla CSS with CSS custom properties, responsive breakpoints                  |
| Charts           | Chart.js 3.9.1 + TradingView Lightweight Charts                                 |
| CSV              | PapaParse 5.4.1                                                                 |
| PDF              | jsPDF 2.5.1 + AutoTable 3.5.25                                                  |
| Backup           | JSZip 3.10.1                                                                    |
| Hosting          | Cloudflare Pages                                                                |
| Spot API         | api.staktrakr.com (free, keyless) + Metals.dev, MetalPriceAPI, GoldAPI, others  |
| Market API       | api.staktrakr.com v2 (free, keyless) — retail prices from major bullion dealers |
| Catalog          | Numista API, PCGS CoinFacts                                                     |
| Exchange Rates   | Open Exchange Rates                                                             |
| Security tooling | Codacy (A+), CodeQL, Semgrep, PMD, ESLint                                       |

---

## Project Structure

```
index.html                  Main application (single page)
css/styles.css              Complete styling (CSS custom properties, four themes)
js/                         70+ JavaScript modules — strict load order via index.html
  constants.js                Global config, API providers, storage keys, app version
  state.js                    Application state (inventory, spotPrices, DOM refs)
  utils.js                    Formatting, validation, storage helpers, sanitizeHtml
  inventory.js                Core CRUD and table orchestration
  inventory-table.js          Table rendering engine
  inventory-backup.js         ZIP/vault backup and restore
  inventory-import.js         CSV/JSON import with DiffModal integration
  events.js                   Event handlers and UI interactions
  init.js                     Application initialization (loads last)
  spot.js                     Spot price history, sparklines, card indicators
  api.js                      Multi-provider pricing API integration
  market-data.js              Market data module — ticker, vendor table, detail modal
  market-charts.js            TradingView Lightweight Charts integration
  retail.js                   Market list view — card layout, trend charts, vendor chips
  filters.js                  Smart filter chips (10 categories)
  chip-grouping.js            Custom chip grouping rules engine
  tags.js                     Per-item tagging system (Numista + custom tags)
  card-view.js                Card view engine — styles A, B, C, D
  sorting.js                  Multi-column table sorting
  charts.js                   Chart.js spot price visualization
  chart-utils.js              Shared chart utility library
  image-processor.js          Image resize/compress (WebP/JPEG adaptive)
  image-cache.js              IndexedDB image cache (coin photos + CDN images)
  bulk-image-cache.js         Batch Numista metadata and image URL sync
  catalog-api.js              Numista API client
  catalog-manager.js          Catalog orchestration
  pcgs-api.js                 PCGS CoinFacts + cert verification
  numista-lookup.js           Pattern-based Numista lookup rules engine
  vault.js                    AES-256-GCM encrypted backup (.stvault)
  cloud-storage.js            Dropbox OAuth PKCE, encrypted cloud backup/restore
  cloud-sync.js               Bi-directional sync engine
  diff-engine.js              Item and settings diff computation
  diff-modal.js               Visual diff review with click-to-pick merge
  viewModal.js                Full item view modal — charts, tags, cert badge
  bulkEdit.js                 Bulk item operations
  settings.js                 Unified settings modal with sidebar navigation
  settings-listeners.js       Settings event binders
  priceHistory.js             Per-item retail price history tracking
  spotLookup.js               Multi-provider spot price fetching orchestrator
  goldback.js                 Goldback denomination pricing
  about.js                    About tab, What's New, embedded FAQ fallback
  versionCheck.js             Version change detection, What's New splash
  customMapping.js            Regex-based CSV field mapping engine
  field-meta.js               Per-field origin tracking
  ...and more
data/
  spot-history-bundle.js      Bundled historical spot prices (loaded via <script>)
  spot-history-YYYY.json      Per-year spot price JSON (1968–2026)
sw.js                         Service worker — offline caching, PWA support
version.json                  Remote version check endpoint
```

---

## Contributing

Bug reports and pull requests are welcome. Please open an [issue](https://github.com/lbruton/StakTrakr/issues) first to discuss significant changes.

The app must remain a **zero-install, single-page, vanilla JS** application — no build step, no framework, works on `file://` protocol. Development tooling (tests, linters, build scripts) lives in `devops/` and is fine.

## License

MIT License. See [LICENSE](LICENSE) for details.

---

## Community

- Reddit: [r/staktrakr](https://www.reddit.com/r/staktrakr/)
- Issues: [GitHub Issues](https://github.com/lbruton/StakTrakr/issues)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/lbruton)
