---
title: "Playwright Suite Rationalization"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/playwright-suite-rationalization.md
source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Playwright Suite Rationalization.md" # migrated 2026-08-12
updated: "2026-05-21"
---

# Playwright Suite Rationalization

## Executive Summary

StakTrakr's Playwright suite has become a product-history archive as much as a regression suite. On 2026-05-21, `npx playwright test --list` reported **703 tests across 61 files**. The Playwright config currently runs one Chromium project with `fullyParallel: false` and `workers` defaulting to `1`, so every duplicated browser startup, every old acceptance-criterion test, and every static-content assertion directly contributes to the roughly 20-minute full-suite runtime.

The recommended direction is not "delete most tests." The better move is to reshape the suite into a smaller risk-based baseline:

- **~100 always-run Playwright tests** focused on user-facing critical journeys, money/math correctness, persistence, import/export, cloud/backup safety, and high-risk integrations.
- **A smaller unit/component layer** for pure math, formatting, config, validators, service-worker routing, parser/conversion helpers, and schema-ish checks that do not need a browser.
- **Archived or manual-run historical specs** for one-time design assertions, old issue acceptance matrices, static marketing page copy, and visual micro-details.
- **A governance rule for new features:** add to an existing domain spec or shared fixture first; create a new spec file only when the product domain is genuinely new.

This document is a roadmap for the cleanup, not an implementation diff.

## Current Snapshot

Observed from `/Volumes/DATA/GitHub/StakTrakr` on 2026-05-21:

| Signal           | Current state                         |
| ---------------- | ------------------------------------- |
| Playwright tests | 703                                   |
| Playwright files | 61                                    |
| App test config  | `playwright.config.js`                |
| Browser projects | Chromium only                         |
| Parallelism      | `fullyParallel: false`                |
| Workers          | `PW_WORKERS` or `1`                   |
| Service workers  | blocked globally, opt-in where needed |
| Unit tests       | `tests/unit/sw-router.test.js` only   |
| Runbook docs     | `tests/runbook/`                      |

Largest test-count concentrations:

| File                                                           | Tests | Initial triage                                                                                              |
| -------------------------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------- |
| `tests/playwright/config-validation.spec.js`                   |    94 | Move most to Node/unit or hook checks; this does not need a browser runner.                                 |
| `tests/playwright/inventory/partial-stack-disposition.spec.js` |    67 | Collapse into a focused disposition workflow suite plus unit tests for transaction math.                    |
| `tests/playwright/about-page.spec.js`                          |    45 | Keep 1-3 smoke tests; move content/link exhaustiveness to lightweight HTML checks or manual release review. |
| `tests/playwright/numista-picker-tags.spec.js`                 |    32 | Keep critical Add/Edit picker journeys; move tag merge/dedupe permutations lower.                           |
| `tests/playwright/inventory/lot-each-purchase-price.spec.js`   |    28 | Keep as a high-value money/math suite, but consolidate repeated setup and neighboring cases.                |
| `tests/playwright/stak-443-api-tab.spec.js`                    |    21 | Preserve provider/source behavior; prune old redesign assertions.                                           |
| `tests/playwright/02-crud/crud.spec.js`                        |    21 | Keep core add/edit/delete/search/card/table journey, reduce one-test-per-metal repetition.                  |
| `tests/playwright/view-modal-valuation.spec.js`                |    19 | Keep valuation/math; split pure math into unit-level helpers where possible.                                |
| `tests/playwright/view-modal-chart-scaling.spec.js`            |    18 | Keep a few chart-boundary browser tests; move date-window calculations to unit tests.                       |

There is also heavy helper duplication: many specs define their own `seedData`, `gotoApp`, and `makeItem` variants even though shared helpers already exist under `tests/playwright/helpers/`.

## Why This Happened

This is a normal failure mode for a one-person product with a strong spec workflow:

1. Each feature or sketch adds acceptance-criterion tests.
2. Those tests remain forever, even after the feature becomes ordinary product behavior.
3. The suite starts encoding implementation and design history instead of current user risk.
4. Full regression becomes expensive enough that agents and humans avoid running it.
5. The suite still grows because each new feature feels safer with its own local test stack.

The current suite has obvious examples: issue-prefixed files such as `stak-443-api-tab.spec.js`, `stak-573-api-tab-qa.spec.js`, `stak-580-required-metal-type.spec.js`, and `strk-89-gold-api.spec.js` are useful while a feature is landing, but they should be reconciled into durable domain suites after merge.

## Testing Principles

Use these as the durable policy:

- **Test product risk, not issue history.** Once an issue ships, fold its lasting behavior into a domain suite.
- **Keep browser tests for browser risk.** Browser tests should prove real flows, rendering, storage boundaries, modals, IndexedDB, downloads/uploads, route mocking, and event integration.
- **Move pure logic out of Playwright.** Currency fraction digits, lot/each math, premiums, provider config validation, URL classifiers, data migrations, backup manifest shape, and date windows should run in Node-level tests when possible.
- **Use one journey to cover many nearby assertions.** Prefer one realistic Add Item flow that checks storage, table row, view modal, and valuation over six separate tests that each reload the app.
- **Keep money and inventory math explicit.** Do not over-consolidate tests that protect decimals, rounding, lot/item totals, premiums, realized disposition, or import/export fidelity.
- **Prefer user-visible locators and assertions.** This aligns with Playwright's official guidance to test user-visible behavior and avoid implementation details: [Playwright best practices](https://playwright.dev/docs/best-practices).
- **Treat historical regression tests as candidates, not sacred objects.** A fixed bug deserves one durable regression if the risk remains; it does not always deserve its original full acceptance matrix forever.

## Proposed Target Shape

Target: about **100 always-run Playwright tests**, plus fast unit coverage.

| Layer               | Command                 | Target size | Purpose                                                                                                                         |
| ------------------- | ----------------------- | ----------: | ------------------------------------------------------------------------------------------------------------------------------- |
| Smoke               | `npm run test:smoke`    |       10-15 | App boots, nav works, modal opens, no console/page errors, critical panels visible.                                             |
| Core Playwright     | `npm run test:core`     |       70-90 | Critical user journeys and browser integration. This becomes the default PR gate.                                               |
| Extended Playwright | `npm run test:extended` |     100-180 | Slower integrations: service worker, cloud sync, attachment ZIP, provider edge cases, mobile layout, historical high-risk bugs. |
| Unit/logic          | `npm run test:unit`     |     100+ ok | Fast math, schema, config, conversion, helper, routing, and parser checks.                                                      |
| Manual dogfood      | runbook-guided          |         N/A | Exploratory UX pass before releases or large UI changes.                                                                        |
| Archive             | no default command      |         N/A | Old issue/spec acceptance files retained for reference until deleted confidently.                                               |

The end state should make `npm test` mean the **core PR gate**, not "every historical thing we have ever asserted."

## Proposed Directory Structure

```text
tests/
  playwright/
    core/
      smoke.spec.js
      inventory-crud.spec.js
      inventory-math.spec.js
      disposition.spec.js
      valuation.spec.js
      import-export.spec.js
      settings.spec.js
      market-retail.spec.js
      numista-catalog.spec.js
      attachments-cloud.spec.js
      mobile-and-layout.spec.js
    extended/
      service-worker.spec.js
      chart-boundaries.spec.js
      cloud-conflicts.spec.js
      attachment-zip.spec.js
      provider-edge-cases.spec.js
      visual-layout-regressions.spec.js
    archive/
      issue-ac-matrices/
  unit/
    money.test.js
    valuation.test.js
    disposition.test.js
    config-validation.test.js
    backup-manifest.test.js
    provider-routing.test.js
    sw-router.test.js
  fixtures/
    inventory.js
    market.js
    catalog.js
  helpers/
    app.js
    storage.js
    assertions.js
```

The exact folder names can vary, but the important change is conceptual: **domain suites own product behavior; issue files are temporary.**

## Recommended Core Playwright Baseline

This is a first-pass allocation for a roughly 100-test suite.

| Domain                      | Target tests | Keep proving                                                                                                                                 |
| --------------------------- | -----------: | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke and shell             |            8 | Boot, no page errors, nav/menu, settings open, modal open, app version visible, spot cards render with mocked data.                          |
| Inventory CRUD              |           10 | Add, edit, delete confirmation, search/filter, card/table switch, image add/remove, item count, persisted reload.                            |
| Money and lot/item math     |           14 | Lot/each toggle, `1700 / 30` rounding, stored source precision, quantity totals, melt value, premium, gain/loss, display-currency precision. |
| Disposition/realized stack  |           12 | Partial sale, full sale, undo, cascade undo, transaction log, inventory count, realized toggle, storage-failure rollback.                    |
| View modal valuation/charts |            8 | Valuation cells, missing spot behavior, chart bounds, Goldback denomination behavior, purchased range edge.                                  |
| Import/export/backup/vault  |           10 | CSV round-trip, Numista CSV currency, vault duplicate prevention, STVAULT shape, attachments manifest, backup restore conflict basics.       |
| Settings and API providers  |           10 | Currency, spot provider selection, manual source, catalog key mask/dirty behavior, cloud tab, reset behavior.                                |
| Numista/catalog             |            8 | Search configured/unconfigured, Add Fill Fields tags, Edit Fill Fields tags, opt-out, cache merge, no unwanted resync.                       |
| Retail/market               |            8 | Slug resolution, currency switch, market sorting, stale/survivor rendering, retail modal opens with mocked provider data.                    |
| Attachments/cloud           |            6 | Add/delete attachment, manager UI, cloud sync key, diff coarse change, sync toggle.                                                          |
| Layout/mobile/accessibility |            6 | Mobile modal safe area, table/card image frame, theme tokens, required selects, print button.                                                |

This lands around 100 tests without pretending the app is simple.

## High-Value Tests To Protect

Do not casually delete these classes of checks:

- Lot/each purchase price behavior, especially repeating decimals and visible-vs-stored precision.
- Currency fraction digits and display-currency rounding.
- Premium, melt, market value, gain/loss, and disposition realized/unrealized math.
- Quantity and partial-disposition inventory math.
- Import/export round trips, especially fields that preserve financial data.
- Backup/vault duplicate prevention and conflict detection.
- Cloud sync storage keys and destructive overwrite paths.
- Catalog fill-field flows where user data can be silently overwritten.
- Retail/provider data rendering where stale or out-of-stock signals affect buying decisions.

These are the places where a wrong green check can cost real money or real data.

## Prime Consolidation Candidates

### `config-validation.spec.js`

This file has 94 Playwright tests but mostly reads local config files. Move it to `tests/unit/config-validation.test.js` or fold it into lint/pre-commit checks. Keep at most one Playwright smoke if the config affects a browser-visible surface.

### `about-page.spec.js`

This file has 45 tests against a mostly static marketing/about page. Keep a smoke test for title, primary CTA, and no broken major section. Move exhaustive copy/link assertions to a lightweight HTML parser test or manual release checklist.

### `partial-stack-disposition.spec.js`

This is important but too large. Keep browser journeys for the most realistic flows. Extract pure calculations and transaction transformations to testable functions and cover them in Node tests. A good target is 12 browser tests plus richer unit coverage.

### Issue-Prefixed UI Redesign Specs

Files like `stak-443-api-tab.spec.js`, `stak-573-api-tab-qa.spec.js`, `stak-439-images-tab-redesign.spec.js`, `stak-437-search-tab-removal.spec.js`, `stak-580-required-metal-type.spec.js`, and `strk-89-gold-api.spec.js` should be reconciled into domain files after the feature ships:

- API/settings behavior goes to `settings.spec.js`.
- Images go to `inventory-crud.spec.js` or `mobile-and-layout.spec.js`.
- Required field validation goes to `inventory-crud.spec.js`.
- Provider additions become parameterized cases in `settings.spec.js` and unit provider-config tests.

### Repeated `seedData` and `gotoApp`

Many files reimplement seed/navigation helpers. Create one shared `tests/playwright/helpers/app.js` with:

- `seedInventory(page, options)`
- `gotoApp(page, { allowEmpty = false, waitForInventory = true })`
- `ackWhatsNew(page)` or a localStorage init helper
- `makeItem(overrides)`
- `mockRates(page, rates)`
- `expectNoPageErrors(page)`

Then make new tests consume shared helpers by default.

## Dogfood Program

The cleanup should be guided by a dogfood pass, not just a spreadsheet of test counts. Recommended cadence:

1. Run the current app locally with representative seed data.
2. Walk the product like a collector: add bullion, add coins, add Goldbacks, edit quantities, dispose partial stacks, import/export, switch currencies, view valuation, inspect retail market data, backup/restore.
3. Record user-facing workflows that feel critical or fragile.
4. Map those workflows to the proposed core suite.
5. Any old test that does not support a dogfood workflow, money/data safety, or a known fragile integration becomes an archive/delete candidate.

Suggested dogfood checklist:

- Add item manually with all required fields.
- Add item from Numista and verify tags, images, composition, year, grade/reference fields.
- Edit and duplicate an item without stale modal state.
- Toggle lot/each purchase price and verify visible two-decimal currency while preserving correct totals.
- Change quantity and verify total cost, melt value, premium, and gain/loss.
- Dispose part of a stack and undo it.
- Export CSV, reimport, and compare financial fields.
- Export STVAULT with attachments and restore into a clean state.
- Switch display currency and verify decimal places and converted totals.
- Open market/retail views and verify stale/out-of-stock presentation.
- Use mobile viewport for modal-heavy flows.

## New Feature Test Policy

Add this to the project testing guidance after cleanup:

1. **Every feature starts by finding its domain suite.** If it affects purchase math, add to `inventory-math.spec.js`; if it affects catalog behavior, add to `numista-catalog.spec.js`; if it affects provider settings, add to `settings.spec.js`.
2. **New files require a reason.** A feature gets a new Playwright file only when it introduces a new product domain or a materially different browser fixture.
3. **One issue may add temporary AC tests.** Those tests must be reconciled before the PR is marked ready or in a follow-up cleanup issue before the next release.
4. **Prefer parameterization over copy/paste.** One test can cover multiple metals, currencies, providers, or viewport cases when the behavior contract is identical.
5. **Do not test static content line-by-line in Playwright.** Use one smoke plus lightweight parsing where static pages matter.
6. **Move non-browser assertions to unit tests.** If a test never needs `page`, it should not live in the Playwright default gate.
7. **Each PR states which suite changed.** PR body should include: "Tests added to existing domain suite" or "New test file justified because..."

## Runner and Command Changes

After the suite is reshaped, update scripts:

```json
{
  "test": "npm run test:core",
  "test:core": "npx playwright test tests/playwright/core",
  "test:extended": "npx playwright test tests/playwright/extended",
  "test:legacy": "npx playwright test tests/playwright/archive",
  "test:unit": "node --test tests/unit/**/*.test.js",
  "test:all": "npm run test:unit && npx playwright test"
}
```

Consider setting `workers` above 1 after isolation is cleaned up. Playwright's docs recommend isolation and note that tests run in parallel workers and can be sharded for faster CI runs: [Isolation](https://playwright.dev/docs/browser-contexts), [Parallelism](https://playwright.dev/docs/test-parallel), and [Sharding](https://playwright.dev/docs/test-sharding). Because StakTrakr currently has duplicated localStorage setup and some serial assumptions, parallelism should come after the helper cleanup, not before.

## Migration Plan

### Phase 1: Inventory and Label

- Generate a machine-readable test inventory from `npx playwright test --list`.
- Add columns: file, test name, domain, risk class, browser-needed, keep/move/archive/delete, replacement target.
- Mark tests with risk classes:
  - `P0 money/data loss`
  - `P1 core user workflow`
  - `P2 integration/edge`
  - `P3 static/design/history`
- Do not delete yet.

### Phase 2: Create Shared Helpers

- Consolidate `seedData`, `makeItem`, `gotoApp`, route mocks, and no-page-error checks.
- Make helpers support empty inventory explicitly.
- Standardize acking What's New and disabling unrelated startup noise.
- Prove 3-5 representative specs can use the helper without behavior changes.

### Phase 3: Extract Unit Coverage

- Start with `config-validation.spec.js`.
- Extract pure valuation, disposition, currency precision, provider-routing, backup-manifest, and service-worker routing logic where feasible.
- Keep browser tests only for the real integration boundary.

### Phase 4: Build Core Domain Suites

- Create the proposed `tests/playwright/core/` files.
- Move or rewrite the best existing assertions into these files.
- Keep old files temporarily under `archive/issue-ac-matrices/`.
- Make `npm run test:core` the daily PR gate once it proves stable.

### Phase 5: Archive and Delete

- For each old issue-prefixed spec, either:
  - map its durable behavior into a domain suite,
  - move it to extended/manual,
  - or delete it with a note in the cleanup PR.
- Keep one audit document listing deleted files and why.

### Phase 6: Update Workflow Docs

- Update Coding Standards Testing section.
- Update `AGENTS.md` test guidance if needed.
- Add a spec/task template clause: "reuse existing domain suite unless a new product domain exists."

## Definition of Done

The cleanup is done when:

- `npm test` completes in under 5 minutes locally on a normal run.
- The default Playwright gate is close to 100 tests.
- Money/math/data-loss surfaces retain explicit coverage.
- `npm run test:all` still exists for pre-release confidence.
- New features have a documented destination suite.
- Old issue-prefixed specs are either archived, deleted, or merged into domain suites.
- The runbook dogfood checklist maps to the core suite.

## Open Questions

- Should the default PR gate be `test:core` only, or `test:unit + test:core`?
- Should `extended` run nightly, before release, or only on demand?
- Should old issue-prefixed specs be moved to `archive/` for one release before deletion?
- How aggressive should we be about extracting app logic into importable modules in a zero-build script-tag app?
- Do we want a Plane issue specifically for "test suite rationalization" so cleanup can be tracked through the normal StakTrakr workflow?

## Related

- Coding Standards
- Data Model
- Cloud Sync
- Retail Modal
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Playwright Parallelism](https://playwright.dev/docs/test-parallel)
- [Playwright Sharding](https://playwright.dev/docs/test-sharding)
