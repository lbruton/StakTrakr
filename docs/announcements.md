## What's New

- **Shape-Aware Dimensions (v3.33.93)**: Bars and ingots now show Length/Width instead of Diameter. Shape dropdown drives conditional fields. Numista API maps size by shape. Existing "LxW" diameter strings auto-migrate on edit (STAK-528)
- **V1 API Cleanup + Market Log Fix (v3.33.92)**: Removed all dead v1 API code (~486 lines). Market log tab now shows dynamic vendor columns from the v2 manifest instead of blank hardcoded columns (STAK-509)
- **Cloud Sync Fixes (v3.33.91)**: API keys no longer destroyed as [object Object] when synced. StorageLocation sync loop fixed — blank values persist correctly (STAK-519)
- **StakTrakr API Settings Fix (v3.33.90)**: Cache settings no longer revert to 24h. StakTrakr panel simplified to enabled toggle + auto-refresh. Tab moved to first position as primary free provider (STAK-518)
- **Market Filter Matrix (v3.33.89)**: Settings > Market redesigned with checkbox filter matrix. Enable/disable items and vendors per metal category. Ticker and vendor prices table respect filter settings (STAK-515)
