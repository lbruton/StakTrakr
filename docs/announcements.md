## What's New

- **Price Bounds Guard (v3.33.81)**: Retail poller now rejects implausible vendor prices at write time &mdash; prices &gt;+50% or &lt;-30% of spot-based melt value are flagged as failed. Per-vendor exemptions for legitimate outliers (STAK-496).
- **Chart Accuracy Fix (v3.33.80)**: 7-day trend chart and trend badge now use live prices for today's data point instead of a running daily average &mdash; no more confusing divergence from market card on volatile days (STAK-483).
- **Cloud Sync Image Fix (v3.33.79)**: Pushing from a device without photos no longer erases the image vault reference. Inventory hash now detects field-level changes (image URLs, numistaId). Image vault activity now visible in Activity Log (STAK-497).
- **Retail Scraper + OOS Pipeline (v3.33.78)**: JM Bullion no longer grabs volume discount prices. Soft 404 detection for React SPAs. OOS vendors shown dimmed with strikethrough on retail cards (STAK-475, STAK-495).
- **Numista Search Fix (v3.33.77)**: Numista search now strips operator characters from queries &mdash; items with official names containing hyphens and parentheses no longer timeout or return empty results (STAK-494).

## Development Roadmap

### Next Up

- **Settings Redesign (STAK-436&ndash;447)**: 12-issue suite covering Appearance, Filters, and API settings tabs
- **Market Page Phase 3**: Inventory-to-market linking with auto-update retail prices
- **Cloud Backup Conflict Detection (STAK-150)**: Smarter conflict resolution using item count direction, not just timestamps
