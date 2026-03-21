## What's New

- **Cloud Sync Field Fix (v3.33.75)**: Cloud sync now compares all item fields during merge &mdash; previously image URLs, numistaId, grading, disposition, and 15+ other fields were silently dropped on matched items. Manifest add path also fixed (STAK-493).
- **Graceful SW Update (v3.33.74)**: Network-first navigation prevents stale HTML after deploys. Smart error recovery auto-reloads on cache miss instead of showing scary error dialogs. Cloud sync guard prevents data corruption during transitions (STAK-485).
- **Image URL Consistency (v3.33.73)**: Stored URLs are now the single source of truth for images everywhere &mdash; view modal no longer fetches from Numista API independently. Fill Fields now overwrites existing image URLs when checkbox is checked (STAK-488, STAK-489).
- **Numista Metadata Fix (v3.33.72)**: Numista metadata fields (KM Reference, country, etc.) can now be cleared and saved as empty &mdash; previously clearing a field would restore the old value on save (STAK-487).

## Development Roadmap

### Next Up

- **Settings Redesign (STAK-436&ndash;447)**: 12-issue suite covering Appearance, Filters, and API settings tabs
- **Market Page Phase 3**: Inventory-to-market linking with auto-update retail prices
- **Cloud Backup Conflict Detection (STAK-150)**: Smarter conflict resolution using item count direction, not just timestamps
