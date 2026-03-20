## What's New

- **Numista Metadata Fix (v3.33.72)**: Numista metadata fields (KM Reference, country, etc.) can now be cleared and saved as empty &mdash; previously clearing a field would restore the old value on save (STAK-487).
- **Codebase Modularization (v3.33.71)**: Shared chart utility library eliminates 11 duplicate Chart.js patterns. Inventory split: 4,504 &rarr; 1,744 lines across 4 focused modules. Convention sweep: 53 getElementById, 5 localStorage, 23 var fixes (STAK-484).
- **Intraday Trends &amp; Reliability (v3.33.70)**: Intraday trend toggle on Market Prices cards. Aggregation fixes stop data loss from UNIQUE constraint and carry forward vendor prices across 30-min windows. CF bypass hardened with Byparr-first phase and shm_size fix (STAK-464, STAK-474, STAK-475, STAK-476, STAK-477).
- **Storage &amp; Sync Hygiene (v3.33.69)**: Fixed disposed filter preference resetting on every page reload. Version upgrades no longer trigger phantom cloud sync diff popups &mdash; settings-only key diffs from new versions are auto-merged silently (STAK-470).
- **Catalog Data Fix (v3.33.68)**: Fixed a bug where Catalog Data fields (diameter, thickness, country, etc.) were silently discarded on save for items without a Numista number (STAK-469).

## Development Roadmap

### Next Up

- **Settings Redesign (STAK-436&ndash;447)**: 12-issue suite covering Appearance, Filters, and API settings tabs
- **Market Page Phase 3**: Inventory-to-market linking with auto-update retail prices
- **Cloud Backup Conflict Detection (STAK-150)**: Smarter conflict resolution using item count direction, not just timestamps
