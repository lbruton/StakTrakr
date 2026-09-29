---
sketch: "STRK-75-market-all-tab"
phase: approach
created: 2026-05-13
---

# STRK-75 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

The change is self-contained to `js/market-data.js`. The tab-bar builder prepends an `all` entry to the tab list and updates the fallback from `xag` to `all`. The table render function gains an "all-scope" code path that, when `scopeCode === 'all'`, iterates all enabled metal groups in priority order (Gold → Silver → Platinum → Palladium → Goldback) and renders each group's rows in sequence. Vendor column construction switches from a single-metal row set to the union of rows across all groups.

**Row-shape requirement:** Current rows carry `{ slug, meta }` only (line 915) and premium math uses the function-level `metalCode` (line 1033). The All-scope row set must carry each row's ISO code so `_getSpotPrice(rowMetalCode)` resolves per-row — gold/silver/platinum/palladium use their own spot price, while Goldback falls back to `_goldbackG1Rate`.

Persistence logic gets a minimal update: `all` is added to the valid-tab allowlist, and the stored-value validation checks whether the saved value is in the new full list (which includes `all`). Invalid or missing values fall back to `all`. No existing stored values are erased.

Test coverage targets the two existing Playwright specs. `stak-582-market-survivors.spec.js` gets its default-tab assertion updated from `xag`/Silver to `all`. `market-sorting.spec.js` gets focused All-tab cases for group ordering, vendor column union, and fallback behaviour.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Extend `_renderVendorTable(scopeCode)` in place to accept `'all'` alongside metal ISO codes | Least surface area; per-metal tabs continue to call the same function unchanged | Renders the function slightly more complex; acceptable given the localized change |
| D-2 | Valid-tab list includes `'all'` as the first entry | Cleanest fallback: one place defines what is valid; no parallel allowlist | Tab ordering is implicit in the list; reorder the list to change order |
| D-3 | Vendor column union = all vendors from all All-tab rows, deduped, sorted alphabetically | Consistent with the issue AC-9 requirement; mirrors per-metal column logic | Column set is wider than any single metal — some columns will have blanks for metals that don't carry that vendor |
| D-4 | Group row separator: rely on visual grouping (consecutive rows by type) without CSS dividers | Matches current table aesthetics; no HTML structure changes needed | Groups are implicit, not labeled — may need a follow-up for group headers if UX feedback asks for them |
| D-5 | Unify metadata fallback: use `getRetailCoinMeta()` for both tab/group eligibility AND row rendering | Currently tab detection (line 1247-1254) falls back to `{ metal: "unknown" }` while row rendering (line 896-900) uses `window.getRetailCoinMeta()`. This parity gap can cause slugs to be classified differently between the tab list and the table body. Unifying fixes both. | No tradeoff — eliminates a latent bug |

## File Map

### New
- _none_

### Modified
- `js/market-data.js` — tab-bar builder (prepend `all`), fallback constant (`xag` → `all`), valid-tab allowlist (`all` added), render function (all-scope branch), vendor column union logic
- `tests/playwright/retail/stak-582-market-survivors.spec.js` — update default-tab assertion (Silver → All); add All-tab presence assertion
- `tests/playwright/market-sorting.spec.js` — add test cases: All-tab default, group ordering, invalid-saved-tab fallback, vendor column union, market-filter hiding, per-row premium math, Goldback G1 premium

### Deleted
- _none_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes. `vendorPricesActiveTab` key is unchanged; only the valid value set and default expand to include `'all'`.

## Tradeoffs Surfaced for Review

- **D-3 (wide vendor columns):** The All-tab vendor column set spans all metals, so any vendor exclusive to one metal creates empty cells in other metals' rows. This is the natural consequence of a union matrix and consistent with how e.g. a gold-only vendor appears on the Silver tab today (absent). Worth confirming the user finds sparse cells acceptable, or alternatively whether vendor columns should be scoped to the visible rows' metals only.
- **D-4 (no group headers):** Rows group by type in order but with no visual label separating groups. A follow-up could add lightweight divider rows or group header rows. Tracked as a potential follow-up issue, not in scope here.

## Out of Scope (follow-up issues)

- Group header rows in the All tab (visual label between Gold / Silver / etc. row blocks) — file as STRK follow-up if UX feedback requests it
- Palladium tab conditional presence — already handled by the existing metal-filter logic; no new work needed

## Risk Notes

- Risk: **Per-row spot price resolution.** `_getSpotPrice(metalCode)` at line 1033 uses the function-level argument. In All-mode, each row must resolve its own metal's spot price — otherwise gold/silver/platinum premiums are silently wrong. Goldback uses `_goldbackG1Rate` (fetched in `initMarketData()` at lines 1385-1401, consumed at lines 1122-1125) and is independent of metalCode. → Mitigation: All-scope row objects carry their ISO code; premium loop calls `_getSpotPrice(row.isoCode)` per row.

- Risk: `stak-582-market-survivors.spec.js` assertion change (Silver → All) may interact with other assertions in that file that set `vendorPricesActiveTab` explicitly. → Mitigation: read the full spec before editing; only change the assertion that tests the no-stored-value default.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-75`.

## Review Archive — approach (2026-05-13)

_Reconciled by /sketch reconcile on 2026-05-13. Original reviewer marks preserved below for audit._

### Codex

**Verified Against Live Code**

- `js/market-data.js:893-917` builds the current row set as slug/meta entries filtered by one ISO code.
- `js/market-data.js:1031-1034` computes row values using `detail`, `weightOz`, and one function-level `metalCode`.
- `js/market-data.js:1247-1254` and `js/market-data.js:896-900` use different metadata fallback behavior.
- `js/market-data.js:1385-1401` fetches `_goldbackG1Rate`; no `getGoldbackRate()` symbol exists.
- `tasks.md` later names `tasks.md` itself as a modified artifact for a verification stamp.

**Top Issues Raised**

1. The architecture needs a per-row metal/ISO field in All mode to avoid incorrect spot premium math.
2. D-5 is too narrow; metadata fallback must be consistent for tab eligibility, grouping, and row rendering.
3. The file map conflicts with `tasks.md`'s later verification-stamp edit unless that edit is explicitly classified outside implementation scope.

**Unverified Assumptions**

- Sparse All-mode vendor columns are acceptable without visual group labels or column scoping.
- The added All tab will fit existing `.vendor-prices-tabs` styling without mobile overflow regressions.
- `market-sorting.spec.js` is the right home for all new behavior tests rather than a dedicated STRK-75 spec.

### Resolution Summary
- Accepted: 4
- Rejected: 1 (tasks.md file-map inclusion — tasks.md is a sketch control-plane artifact, not implementation scope)
- Resolved with your input: 1 (test home — market-sorting.spec.js confirmed)
