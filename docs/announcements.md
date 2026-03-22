## What's New

- **What's New Modal Fix (v3.33.86)**: What's New popup no longer flashes old content before showing current announcements on page load (STAK-500).
- **Market Price Fixes (v3.33.84)**: JM Bullion now uses column-aware eCheck/Wire parser first, preventing inflated Card/PayPal prices. Goldback-g1 baseline no longer appears as a ghost card in market view (STAK-498).
- **Intraday Chart Fix (v3.33.83)**: Charts now show exactly 24 hourly data points instead of multi-day spans with excessive dotted lines. Dotted lines only for 2+ hour gaps. OOS vendors excluded from chart datasets. API uses time-based 24h cutoff (STAK-498).
- **Grid View Cleanup (v3.33.82)**: Removed ~260 lines of dead grid/card view code from retail.js, eliminated the MARKET_LIST_VIEW feature flag, and cleaned up orphaned CSS. List view is now unconditional (STAK-473).
- **Price Bounds Guard (v3.33.81)**: Retail poller now rejects implausible vendor prices at write time &mdash; prices &gt;+50% or &lt;-30% of spot-based melt value are flagged as failed. Per-vendor exemptions for legitimate outliers (STAK-496).

## Development Roadmap

### Next Up

- **Settings Redesign (STAK-436&ndash;447)**: 12-issue suite covering Appearance, Filters, and API settings tabs
- **Market Page Phase 3**: Inventory-to-market linking with auto-update retail prices
- **Cloud Backup Conflict Detection (STAK-150)**: Smarter conflict resolution using item count direction, not just timestamps
