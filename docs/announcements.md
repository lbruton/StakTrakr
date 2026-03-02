## What's New

- **Backup Integrity Audit (v3.33.24)**: exportOrigin metadata added to all export formats. Pre-import validation, DiffModal count header with Select All, and post-import summary banner. Fixes CSV round-trip breakage from comment header, const reassignment crash, and import target detection bug (STAK-374).
- **Storage Error Modal Suppressed for Intraday Cache (v3.33.22)**: saveRetailIntradayData() failures now log a console warning instead of showing a user-visible Storage Error modal — transient 24h sparkline cache is non-critical
- **Disposed Items: Restore &amp; View (v3.33.21)**: Three-state disposed filter (Hide/Show All/Disposed Only). Changelog undo now correctly reverses dispositions. "Restore to Inventory" button added to view modal for disposed items
- **Market Panel Bug Fixes (v3.33.20)**: API-driven item names via getRetailCoinMeta() as source of truth. Grid/list sync status shows "just now" after sync, time-ago when lingering, error state on API failure. Activity log dropdown dynamically populated from API manifest
- **DiffMerge Integration (v3.33.19)**: Selective apply for cloud sync pull and encrypted vault restore. DiffModal preview replaces full overwrite — users choose which changes to accept. Shared _applyAndFinalize helper consolidates post-apply sequence
- **Diff/Merge Architecture Foundation (v3.33.18)**: Manifest path constants, pruning threshold storage key, diffReviewModal HTML scaffold, and diff-modal.js script registration for the reusable change-review UI
- **Realized Gains/Losses (v3.33.17)**: Disposition workflow to mark items as Sold, Traded, Lost, Gifted, or Returned. Calculates realized gain/loss, adds disposition badges, filter toggle, portfolio summary breakdown, and CSV export columns

## Development Roadmap

### Next Up

- **Market Page Phase 3**: Inventory-to-market linking with auto-update retail prices
- **Cloud Backup Conflict Detection (STAK-150)**: Smarter conflict resolution using item count direction, not just timestamps
- **Accessible Table Mode (STAK-144)**: Style D with horizontal scroll, long-press to edit, 300% zoom support
