## What's New

- **Retail Scraper + OOS Pipeline (v3.33.78)**: JM Bullion no longer grabs volume discount prices. Soft 404 detection for React SPAs. OOS vendors shown dimmed with strikethrough on retail cards. Intraday charts now render dashed lines for carried/stale prices (STAK-475, STAK-495).
- **Numista Search Fix (v3.33.77)**: Numista search now strips operator characters from queries &mdash; items with official names containing hyphens and parentheses no longer timeout or return empty results (STAK-494).
- **Image Popover Fix (v3.33.76)**: Image thumbnail popovers now open correctly in table and card view. Previously clicking a thumbnail crashed silently due to a dummy DOM element missing `.remove()` (STAK-492).
- **Cloud Sync Field Fix (v3.33.75)**: Cloud sync now compares all item fields during merge &mdash; previously image URLs, numistaId, grading, disposition, and 15+ other fields were silently dropped on matched items. Manifest add path also fixed (STAK-493).
- **Graceful SW Update (v3.33.74)**: Network-first navigation prevents stale HTML after deploys. Smart error recovery auto-reloads on cache miss instead of showing scary error dialogs. Cloud sync guard prevents data corruption during transitions (STAK-485).

## Development Roadmap

### Next Up

- **Settings Redesign (STAK-436&ndash;447)**: 12-issue suite covering Appearance, Filters, and API settings tabs
- **Market Page Phase 3**: Inventory-to-market linking with auto-update retail prices
- **Cloud Backup Conflict Detection (STAK-150)**: Smarter conflict resolution using item count direction, not just timestamps
