---
name: runbook-mapper
description: "Maps changed StakTrakr file paths to relevant runbook test sections. Call after implementation with a list of changed files to get targeted bb-test section commands. Returns section numbers, descriptions, and the exact /bb-test invocation to run."
tools: ["Read", "Glob", "Grep"]
model: haiku
---

You receive a list of changed file paths (relative to project root). Map them to the relevant runbook test sections and output the minimum set of `/bb-test` commands needed to cover the changes.

## File → Section Mapping Table

| File pattern                                                                                                                                                                                                                                                              | Section(s)     | Reason                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------- |
| `js/constants.js`, `js/init.js`, `js/versionCheck.js`, `js/about.js`, `index.html`, `sw.js`                                                                                                                                                                               | 01             | Page load, version display, startup          |
| `js/inventory.js`, `js/inventory-table.js`, `js/card-view.js`, `js/bulkEdit.js`, `js/sorting.js`, `js/filters.js`, `js/pagination.js`, `js/search.js`, `js/tags.js`, `js/clone-picker.js`, `js/viewModal.js`, `js/detailsModal.js`, `js/dialogs.js`, `js/autocomplete.js` | 02             | CRUD — add/edit/delete/search/filter         |
| `js/cloud-storage.js`, `js/cloud-sync.js`, `js/vault.js`, `js/inventory-backup.js`                                                                                                                                                                                        | 03             | Backup & restore, encrypted vault            |
| `js/inventory-import.js`, `js/diff-engine.js`, `js/diff-modal.js`                                                                                                                                                                                                         | 04             | Import/export, merge diff viewer             |
| `js/market-data.js`, `js/market-charts.js`, `js/retail.js`, `js/retail-view-modal.js`, `js/catalog-api.js`, `js/catalog-manager.js`, `js/catalog-providers.js`, `js/priceHistory.js`, `js/numista-lookup.js`, `js/numista-modal.js`, `js/pcgs-api.js`                     | 05             | Market panel, retail prices, Goldback card   |
| `js/theme.js`, `js/settings.js`, `js/settings-listeners.js`, `js/state.js`, `css/`                                                                                                                                                                                        | 06             | UI/UX, theme, responsive layout, currency    |
| `js/debug-log.js`, `js/debugModal.js`, `js/changeLog.js`                                                                                                                                                                                                                  | 07             | Activity log (requires Section 02 run first) |
| `js/spot.js`, `js/spotLookup.js`, `js/api.js`, `js/api-health.js`                                                                                                                                                                                                         | 08             | Spot prices, freshness, melt values          |
| `js/events.js`, `js/utils.js`, `js/field-meta.js`, `js/types.js`                                                                                                                                                                                                          | 01, 02, 05, 08 | Core utilities — run broad set               |
| `js/seed-data.js`, `js/seed-images.js`, `data/`                                                                                                                                                                                                                           | 01             | Seed inventory count on page load            |
| `js/chart-utils.js`, `js/charts.js`                                                                                                                                                                                                                                       | 05, 08         | Charts appear in Market and Spot sections    |

## Output Format

1. List which sections were matched and why (one line each)
2. Note any section dependencies (e.g. Section 07 requires Section 02 to run first)
3. Output the exact command(s) to run, using this format:

```
/bb-test sections=01,02
```

If all or most sections match, recommend a full suite run:

```
/bb-test
```

## Edge Cases

- If only `css/` or `js/theme.js` changed: sections 06 only, note that visual tests may need manual viewport verification
- If `sw.js` changed: always include section 01 (cache invalidation affects page load)
- If `js/events.js` or `js/api.js` changed: flag the duplicate-definition risk and recommend checking both files before testing
- If no JS/HTML/CSS files changed (e.g. only docs, hooks, devops): output "No runbook sections needed — no frontend files changed"
