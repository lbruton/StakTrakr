---
type: research
project: StakTrakr
status: active
source: session-research
created: '2026-05-21'
tags:
  - testing
  - playwright
  - technical-debt
  - roadmap
---

# Test Suite Consolidation Roadmap

## The Problem

StakTrakr's Playwright E2E suite has grown to **715 test cases across 61 spec files**, taking ~20 minutes to run. The suite was built incrementally — each spec and sketch added its own regression tests — resulting in duplication, orphaned issue-specific files, and no shared structure. Every full suite run burns time and tokens.

**Goal:** Consolidate to ~100 focused tests organized by functional area, with a structure that absorbs new feature tests instead of piling on.

---

## Current Landscape

### By the Numbers

| Metric | Value |
|--------|-------|
| Spec files | 61 |
| Total `test()` calls | 715 |
| `test.describe()` blocks | 100 |
| `page.goto()` calls (cold navigations) | 132 |
| Workers | 1 (serialized) |
| Non-browser tests (filesystem only) | 1 file (config-validation, 94 tests) |
| Issue-named files (ticket-coupled) | 7 files |

### Top 10 Heaviest Files

| File | Tests | Category |
|------|-------|----------|
| `config-validation.spec.js` | 94 | Config file assertions (no browser) |
| `partial-stack-disposition.spec.js` | 67 | Inventory math |
| `about-page.spec.js` | 45 | Marketing page content |
| `numista-picker-tags.spec.js` | 32 | Catalog integration |
| `lot-each-purchase-price.spec.js` | 28 | Inventory math |
| `crud.spec.js` | 21 | Core CRUD |
| `view-modal-valuation.spec.js` | 20 | Valuation display |
| `stak-443-api-tab.spec.js` | 20 | API settings |
| `stak-573-api-tab-qa.spec.js` | 19 | API settings (QA follow-up) |
| `view-modal-chart-scaling.spec.js` | 18 | Chart display |

These 10 files alone hold **364 tests (51% of the suite)**.

### Functional Area Breakdown

| Area | Files | Est. Tests | Notes |
|------|-------|------------|-------|
| Settings & Config | 10 | ~160 | Includes 94 non-browser config-validation tests |
| Attachments / Cloud Sync | 8 | ~55 | backup, vault, diff, cloud sync, diagnostics |
| Inventory Math | 4 | ~104 | Disposition, lot/each, seed guard, sort |
| View Modal | 4 | ~54 | Valuation, chart, Numista merge, resync |
| Retail / Market | 3 | ~10 | Currency, slugs, survivors |
| Numista / Catalog | 3 | ~40 | Picker, search, not-configured |
| Core (page load, CRUD) | 2 | ~33 | Foundational |
| About Page | 1 | ~45 | Marketing content validation |
| Issue-specific one-offs | 7 | ~70 | Ticket-named files with no home |
| Everything else | 19 | ~144 | Tags, theme, typography, capsule, etc. |

---

## Identified Waste Categories

### 1. Config-Validation (94 tests) — Move to Linter or Pre-commit

These tests validate static files (`.prettierrc`, `.codacy/codacy.yaml`, `CHANGELOG.md` structure) without a browser. They assert things like "printWidth is 100" and "pmd is NOT present." This is linter/hook work, not E2E testing.

**Recommendation:** Delete entirely. These invariants are enforced by the config files themselves, pre-commit hooks, and Codacy. If any are genuinely load-bearing, move to a lightweight Node script in a `pretest` npm hook.

**Savings: ~94 tests**

### 2. About Page Content Tests (45 tests) — Snapshot or Delete

Tests like "hero tagline is correct", "exactly 4 pillars are rendered", "View Source button links to GitHub." These are content snapshot tests disguised as E2E. They break on any copy change and test nothing a user would call a "bug."

**Recommendation:** Keep 2-3 smoke tests (page loads, primary CTA works, key sections render). Delete the rest. If content regression matters, use a visual snapshot tool, not 45 individual assertions.

**Savings: ~42 tests**

### 3. Issue-Coupled Files (7 files, ~70 tests) — Merge Into Functional Homes

Files like `stak-437-search-tab-removal.spec.js` and `stak-580-required-metal-type.spec.js` test features that now live permanently in the app. The issue number in the filename signals "this was a one-time regression check" but the tests stay forever.

**Recommendation:** Merge surviving assertions into the functional-area file that owns that feature. Delete the issue-named file. Specifically:

| Issue File | Merge Into |
|-----------|------------|
| `stak-437-search-tab-removal` | `settings.spec.js` (new consolidated) |
| `stak-439-images-tab-redesign` | `view-modal.spec.js` (new consolidated) |
| `stak-443-api-tab` | `api-settings.spec.js` (new consolidated) |
| `stak-573-api-tab-qa` | `api-settings.spec.js` (same — significant overlap with 443) |
| `stak-580-required-metal-type` | `crud.spec.js` or `add-item.spec.js` |
| `stak-582-market-survivors` | `market.spec.js` (new consolidated) |
| `strk-89-gold-api` | `api-settings.spec.js` |

**Savings: ~30 tests (after deduplication with functional homes)**

### 4. Overlapping API Tab Tests (39 tests across 2 files) — Deduplicate

`stak-443-api-tab.spec.js` (20 tests) and `stak-573-api-tab-qa.spec.js` (19 tests) both test the same Settings > API tab. The second file was a QA follow-up that re-covers much of what the first already asserts (Bulk Sync modal structure, catalog save buttons, panel layout).

**Recommendation:** Consolidate into a single `api-settings.spec.js` with ~12-15 focused tests covering: provider selection, key masking, catalog config persistence, and manual spot mode.

**Savings: ~25 tests**

### 5. Granular UI Assertion Tests — Consolidate Into Flows

Many spec files test individual UI atoms in isolation:
- `font-loading.spec.js` (6) — "Geist is loaded"
- `typography.spec.js` (5) — "heading uses correct font-weight"
- `theme-tokens.spec.js` (8) — "CSS custom property --brand-primary exists"
- `mobile-modal-safe-area.spec.js` (8) — "modal has safe-area inset"
- `modal-layout.spec.js` (6) — "modal width is 600px"
- `image-frame-override.spec.js` (3) — "image card has border-radius"
- `capsule-field.spec.js` (3) — "capsule badge visible"
- `rect-image-card-table.spec.js` (11) — "card layout in table view"

**Recommendation:** Fold surviving assertions into a single `ui-foundations.spec.js` (~8-10 tests) that validates themes load, modals open at correct size, and responsive layout works. Delete pure CSS-property assertions — they're visual regression territory, not E2E.

**Savings: ~40 tests**

---

## Proposed Target Structure

A **domain-organized, flat-ish structure** where each file owns a functional area. New feature tests go into the existing file for their area, not a new file.

```
tests/playwright/
  core/
    page-load.spec.js          — App boots, localStorage hydrates, no console errors
    crud.spec.js                — Add/edit/delete items (all metal types), required fields
    inventory-math.spec.js      — Lot/each, partial disposition, split clones, G/L calc
    search-and-filter.spec.js   — Filter chips, AND logic, tab filtering, search

  market/
    spot-prices.spec.js         — Provider switching, manual mode, price display
    retail-prices.spec.js       — Vendor matrix, currency, OOS detection
    market-sorting.spec.js      — Sort by price, premium, vendor name

  settings/
    api-settings.spec.js        — Spot providers, catalog keys, advanced modal
    appearance.spec.js          — Theme toggle, currency format, disposition config
    cloud-sync.spec.js          — Backup/restore, vault round-trip, diff modal
    data-management.spec.js     — Reset, seed guard, storage diagnostics

  catalog/
    numista.spec.js             — Search, picker, tag merge, not-configured state

  ui/
    ui-foundations.spec.js      — Modals, responsive, theme tokens, typography
    view-modal.spec.js          — Valuation, chart scaling, Numista merge, resync

  smoke/
    golden-path.spec.js         — Single flow: load → add item → view → market → settings
```

### Target Test Budget

| Area | File Count | Test Budget | What It Covers |
|------|-----------|-------------|----------------|
| Core | 4 | ~30 | CRUD, math, filters — the stuff that MUST work |
| Market | 3 | ~15 | Prices display correctly, providers switch |
| Settings | 4 | ~20 | Config persists, cloud sync round-trips |
| Catalog | 1 | ~8 | Numista integration works end-to-end |
| UI | 2 | ~12 | Modals, themes, view modal |
| Smoke | 1 | ~5 | Golden path + regression guards |
| **Total** | **15 files** | **~90 tests** | |

---

## What to Prioritize Keeping

### Must Keep (High Value)

1. **All math tests** — lot/each calculations, partial disposition G/L, purchase price rounding, decimal places. These catch real money bugs. Consolidate into fewer tests but keep every formula assertion.
2. **CRUD golden path** — add item for each metal type, edit, delete. This is the app's reason to exist.
3. **Cloud sync round-trip** — backup → restore → diff. Data loss is catastrophic.
4. **Provider switching** — spot source changes persist and display correctly.
5. **Filter logic** — AND/OR chip behavior, since this is daily-use UX.

### Can Aggressively Cut (Low Value)

1. **Static content assertions** — "tagline says X", "exactly 4 pillars", button label text
2. **CSS property checks** — border-radius values, font-weight numbers, custom property existence
3. **Config file validation** — belongs in linting, not E2E
4. **Duplicate coverage** — two files testing the same API tab
5. **Defensive "not present" tests** — "pmd is NOT in codacy.yaml", "semgrep is NOT present"

### Gray Area (Consolidate, Don't Delete)

1. **Attachment UI tests** — keep backup/restore flow, cut individual button checks
2. **Numista picker details** — keep search → select → save flow, cut individual chip assertions
3. **Changelog/about page** — keep "page renders" smoke, cut content validation

---

## Execution Strategy

### Phase 1: Quick Wins (Kill ~140 tests, no new code)

1. Delete `config-validation.spec.js` (94 tests) — move 2-3 load-bearing checks to a pretest script if needed
2. Gut `about-page.spec.js` to 3 smoke tests (cut ~42 tests)
3. Total effort: ~1 hour

### Phase 2: Merge & Deduplicate (~100 tests consolidated)

1. Create the target directory structure
2. Merge issue-named files into functional homes, deduplicating as you go
3. Merge `stak-443` + `stak-573` into `api-settings.spec.js`
4. Merge UI atom files into `ui-foundations.spec.js`
5. Total effort: ~3-4 hours

### Phase 3: Rewrite Heavyweights (~200 tests become ~40)

1. `partial-stack-disposition.spec.js` (67 → ~15) — keep every math formula, cut setup/UI scaffolding assertions
2. `numista-picker-tags.spec.js` (32 → ~8) — keep flow, cut per-chip assertions
3. `lot-each-purchase-price.spec.js` (28 → ~10) — keep rounding/decimal assertions, merge redundant scenarios
4. Total effort: ~4-5 hours

### Phase 4: Add Structure for Future Tests

1. Add a `README.md` in `tests/playwright/` documenting the area-ownership model
2. Add a CLAUDE.md rule: "New tests go in the existing area file, never a new issue-named file"
3. Consider adding Playwright `test.describe.serial()` for flows that share setup to reduce `page.goto()` calls (currently 132)
4. Evaluate bumping workers from 1 → 2 for parallel execution

---

## Structural Rules Going Forward

To prevent re-accumulation, adopt these conventions:

### 1. One File Per Functional Area

Every test belongs to exactly one area file. If you're adding a test for "add item validates metal type," it goes in `crud.spec.js`, not `strk-999-metal-type-validation.spec.js`.

### 2. No Issue Numbers in Filenames

Issue context belongs in the test name or a comment, not the filename. Files named after tickets never get cleaned up.

### 3. Test Budget Per Area

Each area has a soft budget. If `crud.spec.js` is at 30 tests and you need to add 3 more, first look for 3 that can be merged or removed. The goal is a stable count, not monotonic growth.

### 4. Flow Tests Over Atom Tests

Prefer one test that exercises a complete flow (open modal → fill form → save → verify persistence) over five tests that each check one field. Flow tests catch more real bugs per test-minute.

### 5. Math Tests Are Sacred

Never consolidate away a math assertion. Decimal places, rounding, lot-vs-each, G/L formulas — these are the tests that catch money bugs. They can be reorganized but never reduced in coverage.

### 6. No CSS-Property E2E Tests

If you need to assert that a button has `border-radius: 999px`, that's a visual regression test (Playwright screenshot comparison or Storybook), not an E2E test. E2E tests assert behavior, not styling.

---

## Estimated Impact

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Test files | 61 | ~15 | -75% |
| Test cases | 715 | ~90-100 | -86% |
| `page.goto()` calls | 132 | ~20-25 | -82% |
| Estimated runtime | ~20 min | ~4-5 min | -75% |
| New feature test overhead | New file + new tests | Add to existing file | Structural |

---

## Open Questions

1. **Visual regression** — Should we add Playwright screenshot comparison for the CSS/theme tests we're deleting? Lightweight alternative to atom assertions.
2. **Parallel workers** — Can we safely bump from 1 → 2 workers? localStorage isolation would need verification.
3. **Test tagging** — Should we tag tests as `@smoke`, `@math`, `@integration` so we can run subsets? e.g., `npm run test:smoke` for quick CI, `npm test` for full suite.
4. **Pretest hooks** — Should the config-validation checks (codacy.yaml, prettierrc) move to a pretest npm script, or are they truly unnecessary?
