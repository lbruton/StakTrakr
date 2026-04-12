## What's New

- **STAK-532: Playwright-first testing (v3.33.97)**: Playwright (`@playwright/test`) is now the primary local TDD layer. 33 tests across runbook sections 01-page-load and 02-crud. Run offline with `npm test`. Browserbase/Stagehand retained for live-site and cloud-only flows.
- **STAK-521: Quarantine unresolved slugs (v3.33.96)**: Closed a latent three-plane asymmetry in the market filter — unresolved slugs are now quarantined symmetrically from matrix, cards, and ticker at the upstream chokepoint.
- **Cloud Sync Atomic Rollback (v3.33.95)**: `_applyAndFinalize()` now rolls back atomically on settings write failure — inventory restored, `lastPull` not advanced, success toast suppressed (STAK-526)
- **Catalog API Key Sync Fix (v3.33.94)**: Numista API key and PCGS bearer token now sync across devices. Catalog key conflicts appear in merge diff modal (STAK-533)
- **Shape-Aware Dimensions (v3.33.93)**: Bars and ingots now show Length/Width instead of Diameter. Shape dropdown drives conditional fields. Numista API maps size by shape. Existing "LxW" diameter strings auto-migrate on edit (STAK-528)
- **V1 API Cleanup + Market Log Fix (v3.33.92)**: Removed all dead v1 API code (~486 lines). Market log tab now shows dynamic vendor columns from the v2 manifest instead of blank hardcoded columns (STAK-509)
