---
sketch: "STRK-75-market-all-tab"
phase: discovery
created: 2026-05-13
---

# STRK-75 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path                          | Role                                                                           | Notes                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/market-data.js:1172-1316` | Builds vendor price section, tab bar, active-tab persistence, table footer     | Primary touch point                                                                                                                                                                                                                                                                                     |
| `js/market-data.js:1266-1274` | Defines available metal tab order: Gold, Silver, Platinum, Palladium, Goldback | Tab list construction lives here                                                                                                                                                                                                                                                                        |
| `js/market-data.js:1276-1281` | Reads `vendorPricesActiveTab` from localStorage with fallback `xag`            | Fallback must change to `all`                                                                                                                                                                                                                                                                           |
| `js/market-data.js:878-1170`  | Renders a single-metal table — rows filtered by `isoCode === metalCode`        | Needs a "scope = all" code path. **Core risk:** `spotPrice` at line 1033 uses the function-level `metalCode` — All-mode must carry each row's ISO metal through premium calculation or gold/silver/platinum premiums silently break. Goldback still uses `_goldbackG1Rate` fallback at lines 1122-1125. |

| `js/market-data.js:981-983` | Builds vendor column set from selected rows | All tab needs union of vendors across all groups |
| `js/retail.js:256-278` | Active slug and metadata helpers, including manifest/hardcoded/Goldback fallback | Reuse for grouping logic. **Parity gap:** tab-availability scan at `js/market-data.js:1247-1254` falls back to `{ metal: "unknown" }` while row rendering at lines 896-900 uses `window.getRetailCoinMeta()`. Tab detection and row rendering must use the same metadata fallback or Goldback/parser-only slugs can be classified differently between the tab list and the table body. |

| `index.html:1814-1817` | Mounts `#vendorPricesSectionEl` / `#vendorPricesContainer` | No expected changes |
| `css/styles.css:14665-14740` | Tab and table styling | Likely no changes needed for one additional tab |
| `tests/playwright/market-sorting.spec.js` | Covers vendor column sorting and row sorting | Add All-tab coverage here |
| `tests/playwright/retail/stak-582-market-survivors.spec.js:461-476` | Asserts vendor table renders; expects active tab to be Silver | Needs update to expect `all` as default |

## Prior Decisions

- 2026-05-13 — Active-tab persistence decision: preserve valid saved `vendorPricesActiveTab`; default only missing/invalid/unavailable values to `all`. Do not force-reset returning users. (Source: STRK-75 issue body, persistence decision section.)
- 2026-05-13 — Goldback-last ordering: Goldback rows remain last in the All tab by priority design; premium computed against G1 rate as today. (Source: STRK-75 issue acceptance criteria.)
- _No prior mem0 or SpecFlow spec found for "market vendor prices all tab" — first time touching this surface._

## External References

- _None needed — all patterns are internal to StakTrakr._

## Constraints

- Constraint 1: `file://` + HTTP dual-mode — no ES module imports, no build step. All changes must be vanilla JS in existing `<script defer>` tags.
- Constraint 2: `vendorPricesActiveTab` localStorage key is already in use; must be backward-compatible (preserve existing valid values, treat unrecognised values as invalid).
- Constraint 3: The `all` scope value must be added to the valid-tab allowlist so the persistence logic treats it as a real tab choice.
- Constraint 4: Goldback premium computation must still work when Goldback rows are embedded inside the All-tab render — the G1 rate reference cannot be metal-scoped away.
- Constraint 5: Vendor column set in All-tab mode must be the union of enabled vendors across all row groups — not just the first metal's vendors.
- Constraint 6: Market filter settings (disabled slug/vendor combos) must apply in the All tab exactly as they do per-metal.
- Constraint 7: Per-row metal context for premium math — the All-scope render path must resolve each row's ISO metal individually for `_getSpotPrice()`, not reuse the function-level `metalCode`. This is the highest-risk implementation constraint.
- Constraint 8: Metadata fallback parity — tab-availability detection (line 1247-1254) and row rendering (line 896-900) must use the same fallback path to avoid counting slugs differently.
- Constraint 9 _(general project constraint, not STRK-75-specific):_ `safeGetElement` is unavailable at top-level in `events.js` (load-order constraint). Any new event wiring at parse time must use `document.getElementById`. Current tab click wiring is local to `js/market-data.js:1283-1299` and unaffected.

## Open Questions

_None — requirements and persistence decision are fully specified._

## Discovery Summary

The entire implementation is concentrated in `js/market-data.js`, specifically the tab-construction block (lines 1266-1281) and the table-render function (lines 878-1170). The main challenge is the table render: it currently assumes exactly one `metalCode` filter, so the "scope = all" path must either refactor the render function to accept an array of metals or iterate per-group and concatenate. Each row must carry its own ISO metal for correct premium math. Vendor column union logic (line 981-983) needs a matching change. Two Playwright specs need updates (`market-sorting.spec.js` for new All-tab cases; `stak-582-market-survivors.spec.js` to update the default-tab assertion). Fixture data must expand beyond silver-only to include at least gold and Goldback rows, with a mocked `/goldback/latest.json` route for G1 rate. CSS and HTML are expected no-touch.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-75`.

## Review Archive — discovery (2026-05-13)

_Reconciled by /sketch reconcile on 2026-05-13. Original reviewer marks preserved below for audit._

### Codex

**Verified Against Live Code**

- `js/market-data.js:878-1170` is the primary render path and is currently single-metal.
- `js/market-data.js:1247-1254` uses manifest coin metadata only for tab availability, while `js/market-data.js:896-903` falls back through `window.getRetailCoinMeta()` during row rendering.
- `js/retail.js:270-278` provides the desired metadata fallback helper.
- `js/market-data.js:1033` computes premium from the selected function argument, and `js/market-data.js:1122-1125` handles the Goldback G1 fallback.
- `tests/playwright/market-sorting.spec.js:37-78` is silver-only; `tests/playwright/retail/stak-582-market-survivors.spec.js:461-476` currently checks the main-page table default.

**Top Issues Raised**

1. Discovery needs to identify per-row metal context as a core implementation constraint, not just "scope = all" filtering.
2. Metadata fallback parity is missed: tab/group detection and row rendering currently use different fallback paths.
3. The test plan needs explicit multi-metal and Goldback/G1 fixture support before the later phases can claim AC-5/AC-8 coverage.

**Unverified Assumptions**

- No CSS changes are needed after prepending a sixth tab in narrow/mobile widths.
- Existing market-filter settings tests are enough if STRK-75 adds only All-tab assertions elsewhere.
- The implementation can stay entirely in `js/market-data.js` without extracting helper functions for testability.

### Resolution Summary

- Accepted: 3
- Rejected: 1 (Constraint 7 relevance — kept but deprioritized as general project constraint)
- Resolved with your input: 0
