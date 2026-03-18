## What's New

- **Codebase Modularization (v3.33.71)**: Shared chart utility library eliminates 11 duplicate Chart.js patterns. Inventory split: 4,504 &rarr; 1,744 lines across 4 focused modules. Convention sweep: 53 getElementById, 5 localStorage, 23 var fixes (STAK-484).
- **Intraday Trends &amp; Reliability (v3.33.70)**: Intraday trend toggle on Market Prices cards. Aggregation fixes stop data loss from UNIQUE constraint and carry forward vendor prices across 30-min windows. CF bypass hardened with Byparr-first phase and shm_size fix (STAK-464, STAK-474, STAK-475, STAK-476, STAK-477).
- **Storage &amp; Sync Hygiene (v3.33.69)**: Fixed disposed filter preference resetting on every page reload. Version upgrades no longer trigger phantom cloud sync diff popups &mdash; settings-only key diffs from new versions are auto-merged silently (STAK-470).
- **Catalog Data Fix (v3.33.68)**: Fixed a bug where Catalog Data fields (diameter, thickness, country, etc.) were silently discarded on save for items without a Numista number (STAK-469).
- **Retail Price Accuracy (v3.33.67)**: Fixed Provident Metals picking up spot ticker instead of product price; fixed Hero Bullion returning bulk &ldquo;As Low As&rdquo; price instead of 1-unit table price; Gainesville Coins no longer wastes 15s on a Playwright timeout per coin (STAK-467).
- **Retail Price Reliability (v3.33.61&ndash;v3.33.66)**: Improved scraping success rate for Bullion Exchanges and JM Bullion &mdash; Cloudflare-blocked requests now fall back to a Byparr (Camoufox) cookie-based bypass (STAK-462).

## Development Roadmap

### Next Up

- **Settings Redesign (STAK-436&ndash;447)**: 12-issue suite covering Appearance, Filters, and API settings tabs
- **Market Page Phase 3**: Inventory-to-market linking with auto-update retail prices
- **Cloud Backup Conflict Detection (STAK-150)**: Smarter conflict resolution using item count direction, not just timestamps
