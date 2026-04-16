## What's New

- **STAK-549: Fix Cloud Sync Header Button Silent Failure (v3.34.04)**: Header cloud sync button no longer shows a false "Synced" toast when vault password is not cached. Password prompt appears correctly; cancel shows an error toast instead of false success.
- **STAK-544: Header Cloud Button Sync or Open Settings (v3.34.03)**: The header cloud button now triggers a manual sync for configured users or opens Settings → Cloud for setup users. Replaced the previous dead-end "autosync disabled" toast behavior.
- **STAK-545: Market Button Triggers Refresh (v3.34.02)**: The header Market button now triggers a market data refresh instead of opening Settings. A gear icon added to the Market dashboard block provides direct access to Market settings.
- **STAK-445: Move FAQ below LOG (v3.34.01)**: Reordered the Settings modal sidebar so Log appears immediately before FAQ. FAQ content, Activity Log content, and settings panel behavior remain unchanged.
- **STAK-444: Cloud Tab Settings Panel (v3.34.00)**: Dropbox and Cloud Sync Beta cards moved from System tab to a dedicated Cloud tab. The Cloud nav button now opens cloud sync configuration instead of falling back to About.
- **STAK-538: Remove First-Run Modal (v3.33.99)**: First-run acknowledgment modal removed -- users now see the app immediately. The Info tab and What's New popup already cover disclaimers and version announcements.
- **STAK-529: Sort Direction Toggle (v3.33.98)**: Asc/Desc toggle added to Settings > Appearance next to Default Sort Column dropdown. Uses existing chip-sort-toggle pattern. Persists to localStorage via DEFAULT_SORT_DIR_KEY.
- **STAK-532: Playwright-first testing (v3.33.97)**: Playwright (`@playwright/test`) is now the primary local TDD layer. 18 active tests across runbook sections 01-page-load and 02-crud (plus 15 stubs for future coverage). Run offline with `npm run test:offline`. Browserbase/Stagehand retained for live-site and cloud-only flows.
