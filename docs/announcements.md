## What's New

- **STAK-551: Fix filter chip predicate logic (v3.34.06)**: Scalar fields (metal, type, name, location) now use OR within-field — Silver+Gold shows both. Tags keep AND. Expansion chips (customGroup, dynamicName, groupedName) expand at predicate time. Chip threshold honored when filters active.
- **STAK-546: Restore AND semantics to filter chip predicate (v3.34.05)**: Selecting multiple filter chips now intersects matches (AND) instead of unioning them (OR), matching documented behavior and expected UX.
- **STAK-549: Fix Cloud Sync Header Button Silent Failure (v3.34.04)**: Header cloud sync button no longer shows a false "Synced" toast when vault password is not cached. Password prompt appears correctly; cancel shows an error toast instead of false success.
- **STAK-544: Header Cloud Button Sync or Open Settings (v3.34.03)**: The header cloud button now triggers a manual sync for configured users or opens Settings → Cloud for setup users. Replaced the previous dead-end "autosync disabled" toast behavior.
- **STAK-545: Market Button Triggers Refresh (v3.34.02)**: The header Market button now triggers a market data refresh instead of opening Settings. A gear icon added to the Market dashboard block provides direct access to Market settings.
