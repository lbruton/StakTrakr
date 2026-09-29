---
sketch: "STRK-78-playwright-mock-audit"
phase: approach
created: 2026-05-15
reconciled: 2026-05-15
---

# STRK-78 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Build a Playwright-only mock layer under `tests/playwright/helpers/mocks/`. The layer owns two things: deterministic response fixtures for the StakTrakr v2 API / exchange-rate / chart-CDN startup surface, and route installers that must be registered before any `page.goto("/")` or `page.goto("/index.html")` call. Normal specs will import a local extended `test` fixture instead of importing directly from `@playwright/test`; the fixture installs the default cold-start mocks and a deny-list audit hook on the built-in `page` fixture before each test runs.

The same mock module will also export `installStakTrakrNetworkMocks(page, options)` for exceptional suites that create pages manually, especially `tests/playwright/02-crud/crud.spec.js`, whose `browser.newPage()` / `sharedPage.goto()` pattern bypasses the normal Playwright `page` fixture. This keeps the fixture path ergonomic for most files while still covering shared-page or manually-created-page suites. Existing specs that already need custom route behavior keep their per-spec overrides, but those overrides must register after the shared installer. Overrides should normally `fulfill()` or `abort()` outright; use `route.fallback()` only when the spec intentionally delegates back to the shared default handler.

Request auditing uses a route catch-all as the lowest-precedence handler, not a passive `page.on("request")` listener. The installer registers the audit catch-all first, then default endpoint fulfillers, then specs register their scenario overrides last. With Playwright's newest-matching-route precedence, that gives the intended chain: per-spec overrides -> shared default mocks -> audit failure for unexpected external requests. Specs that intentionally deny all traffic use `installStakTrakrNetworkMocks(page, { mode: "deny-all" })` or a suite-local deny-all route and opt out of the normal external-request audit, so their failure-path assertions do not look like leaked network calls.

Consolidation happens after the mock layer is in place and proven by the audit hook. The implementation should consolidate only mechanically redundant coverage with clean boundaries: page-load `@network` tests become normal mocked tests, duplicate inline response blobs move into the fixture library, and overlapping Numista / view-modal / cloud-sync tests are reduced only when they assert the same user-visible behavior and failure mode. Market/retail tests stay separate unless the coverage map proves the assertions are duplicates; incidental "market" text in settings or inventory tests is not enough to merge them.

## Key Decisions

| #   | Decision                                                                                                                                  | Rationale                                                                                                                                                                                                          | Tradeoff                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D-1 | Use a hybrid extended fixture plus exported installer functions                                                                           | The extended `test` fixture enforces setup order for ordinary `page` tests, while exported installers cover manual pages like `02-crud` that a fixture cannot see                                                  | More moving parts than helper-only, but avoids a blind spot in the current suite                                                                       |
| D-2 | Keep mocks under `tests/playwright/helpers/mocks/`, not app code                                                                          | The app remains a zero-build vanilla JS app; network mocks are test infrastructure only                                                                                                                            | Specs must migrate imports from `@playwright/test` to the helper fixture                                                                               |
| D-3 | Register route handlers in audit -> defaults -> per-spec order                                                                            | Playwright processes the newest matching route first; registering the audit catch-all first keeps it lowest precedence, defaults next catch normal startup traffic, and later per-spec overrides win intentionally | Authors must be disciplined when adding new `page.route()` calls                                                                                       |
| D-4 | Treat the deny-list audit as a route catch-all installed by the fixture, with an explicit deny-all mode                                   | AC-1 should fail the exact test that leaks an external request, including future specs added after this sketch, while preserving no-network failure-path specs                                                     | Route ordering is a contract the helper must encode and tests must respect                                                                             |
| D-5 | Remove the four `@network` tags once page-load tests are mocked; keep `npm run test:offline` for now                                      | This is the only way `npm test` and `npm run test:offline` can report identical skipped counts while preserving the transition command                                                                             | The script becomes redundant until a future cleanup deletes it                                                                                         |
| D-6 | Defer MSW and the `fullyParallel` flip                                                                                                    | Requirements explicitly defer both; this sketch creates the deterministic mocked baseline and follow-up issues for parallel risks                                                                                  | Wall-clock improvement lands in a later PR                                                                                                             |
| D-7 | Consolidate by coverage map and failure-mode boundaries, not by file-name cluster alone                                                   | Reduces redundant tests without hiding distinct regression signals behind one broad spec                                                                                                                           | Smaller test-count reduction than an aggressive merge                                                                                                  |
| D-8 | Scope "market data" consolidation to files whose primary `test.describe` topic is a market control and which assert the same failure mode | Gives AC-4's manual coverage map a concrete predicate instead of ad-hoc implementation-time judgment                                                                                                               | Incidental market text in settings, inventory, or retail specs remains outside the consolidation set unless the coverage map proves identical behavior |

## File Map

Every file below is either directly created/modified or belongs to the generated migration set. Tasks.md should use the audit command to refresh the live list before implementation, but this is the current scope map for the approach.

### New

- `tests/playwright/helpers/mocks/fixtures.js` — canonical fixture values for v2 manifest, retail latest/history/intraday, goldback latest, exchange rates, chart-CDN stub, and reusable image bytes where applicable.
- `tests/playwright/helpers/mocks/routes.js` — `installStakTrakrNetworkMocks(page, options)`, endpoint-family installers, deny-list matching, and helper utilities for v2 envelope fulfillment / 404 / 503 fallback behavior.
- `tests/playwright/helpers/mocks/extended-test.js` — re-exported `{ test, expect }` wrapper that extends Playwright's `page` fixture and installs the default mock/audit layer before each normal page test.
- `tests/playwright/helpers/mocks/audit.js` — allow/deny-list policy and request-audit helpers shared by the fixture and any explicit audit task.

### Modified

- `tests/playwright/01-page-load/page-load.spec.js` — import the shared test fixture, remove the four `@network` tags after the tests are mocked, and use representative fixture data instead of production APIs.
- `tests/playwright/02-crud/crud.spec.js` — manually call `installStakTrakrNetworkMocks(sharedPage)` before `sharedPage.goto("/index.html")` because this suite creates its own page in `beforeAll`.
- `tests/playwright/03-settings/03-appearance.spec.js` — migrate to the shared fixture/import path if it navigates to the app shell.
- `tests/playwright/03-settings/04-inline-chip-attachment.spec.js` — migrate to the shared fixture/import path if it navigates to the app shell.
- `tests/playwright/03-settings/04-market-controls.spec.js` — migrate to shared mocks; preserve market-control assertions and add per-slug fixture overrides only where the test needs non-default data.
- `tests/playwright/03-settings/catalog-api-key.spec.js` — audit action paths with configured catalog keys; keep `window.testNumistaAPI` / settings-only assertions offline-safe and add provider-route mocks only for tests that genuinely invoke provider fetches.
- `tests/playwright/03-settings/market-filter-cache-invalidation.spec.js` — migrate to shared mocks with per-slug market fixture overrides.
- `tests/playwright/03-settings/settings-cloud-tab.spec.js` — migrate to shared mocks; keep `window.syncNow` stubs and do not add a cloud-provider route family unless the audit finds a real Dropbox/Box/pCloud request.
- `tests/playwright/attachments/backup-zip.spec.js` — migrate to shared mocks if app-shell navigation is present; no cloud-provider route unless a real upload/download action path is exercised.
- `tests/playwright/attachments/cloud-sync.spec.js` — migrate to shared mocks and complete the cloud-token audit before deciding whether cloud-provider routes are needed.
- `tests/playwright/attachments/diff-modal.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/attachments/followup-hardening.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/attachments/manager.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/attachments/storage-diagnostics.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/attachments/ui.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/attachments/vault-stvault.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/capsule-field.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/changelog-redesign.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/cloud-sync-header-button.spec.js` — migrate to shared mocks; preserve `window.pushSyncVault` stub behavior.
- `tests/playwright/filter-chip-and-logic.spec.js` — migrate to shared mocks with any needed market fixture overrides.
- `tests/playwright/font-loading.spec.js` — migrate to shared mocks if app-shell navigation is present; keep font-specific assertions intact.
- `tests/playwright/goldback-type.spec.js` — migrate to shared mocks and reuse goldback fixture data.
- `tests/playwright/image-frame-override.spec.js` — replace inline image-route fixture data with shared helpers where equivalent.
- `tests/playwright/inventory/lot-each-purchase-price.spec.js` — replace inline exchange-rate route with shared exchange-rate fixture.
- `tests/playwright/inventory/partial-stack-disposition.spec.js` — replace inline exchange-rate route with shared exchange-rate fixture.
- `tests/playwright/inventory/seed-guard.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/inventory/virtual-sort-options.spec.js` — replace inline exchange-rate route with shared exchange-rate fixture.
- `tests/playwright/market-sorting.spec.js` — replace inline v2 primary/fallback response blobs with shared v2 helpers while preserving its custom slug order.
- `tests/playwright/mobile-modal-safe-area.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/modal-layout.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/numista-not-configured.spec.js` — migrate to shared mocks; consolidation candidate with the other Numista specs only for duplicate UI/setup assertions.
- `tests/playwright/numista-picker-tags.spec.js` — migrate to shared mocks; keep picker/tag behavior distinct unless the coverage map proves duplication.
- `tests/playwright/numista-search.spec.js` — audit provider action paths; add provider mocks only if the test invokes real Numista/PCGS fetches.
- `tests/playwright/payment-method.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/realized-toggle.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/rect-image-card-table.spec.js` — replace inline image-route fixture data with shared helpers where equivalent.
- `tests/playwright/retail/currency-switch.spec.js` — replace inline CDN/v2 route handlers with shared helpers and keep currency-specific fixture overrides.
- `tests/playwright/retail/slug-resolution.spec.js` — preserve the manifest-abort failure path as a per-spec override registered after defaults.
- `tests/playwright/retail/stak-582-market-survivors.spec.js` — replace inline CDN/v2 route handlers with shared helpers and keep survivor-specific fixture overrides.
- `tests/playwright/settings-currency.spec.js` — migrate to shared mocks and exchange-rate fixture data.
- `tests/playwright/settings-data-reset.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/silverback.spec.js` — migrate to shared mocks and market fixture data.
- `tests/playwright/stak-437-search-tab-removal.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/stak-439-images-tab-redesign.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/stak-443-api-tab.spec.js` — preserve explicit no-network failure-path tests; replace duplicate helper data only where it does not change the failure-mode assertion.
- `tests/playwright/stak-573-api-tab-qa.spec.js` — preserve explicit no-network failure-path tests; replace duplicate helper data only where it does not change the failure-mode assertion.
- `tests/playwright/stak-580-required-metal-type.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/tags.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/theme-tokens.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/typography.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/vault-roundtrip.spec.js` — migrate to shared mocks if app-shell navigation is present.
- `tests/playwright/view-modal-chart-scaling.spec.js` — replace inline exchange-rate route with shared helper while preserving chart-scaling expectations.
- `tests/playwright/view-modal-no-auto-resync.spec.js` — migrate to shared mocks; complete the cloud-token audit before deciding whether cloud-provider routes are needed.
- `tests/playwright/view-modal-numista-merge.spec.js` — migrate to shared mocks and catalog fixture helpers where equivalent.

### Unchanged / Verified Safe

- `tests/playwright/about-page.spec.js` — no endpoint mocking required; it navigates to `about.html`, which has no script tags and only external anchor `href`s.
- `tests/playwright/config-validation.spec.js` — no endpoint mocking required; it is a Node-side filesystem/config validation suite with no browser page navigation.

### Deleted

- None planned. Tests may be merged or trimmed during consolidation, but tasks must record each removed test's one-line coverage rationale before deleting any assertion.

## Pre-implementation Validation

Before tasks commit the mock surface or migration list, run these checks and carry the results into tasks.md:

- Static external-fetch scan: `rg -n 'fetch\\(|XMLHttpRequest' js/ index.html` and cross-check every external URL family against the route installers or explicit out-of-scope/action-path notes.
- Manual-page guard: `rg -n 'browser\\.newPage|context\\.newPage' tests/playwright --glob '*.spec.js'` and ensure every match calls `installStakTrakrNetworkMocks(page, options)` before the first navigation.
- App-shell migration inventory: enumerate spec files that navigate any page-like object to `/`, `/index.html`, or an app-shell URL so conditional File Map entries are resolved before implementation begins.
- Catalog/cloud action-path audit: grep configured credential seeds and sync calls (`catalog_api_config`, `setNumistaConfig`, `setPcgsConfig`, `cloud_token`, `syncNow`, `pushSyncVault`) and add provider-specific mocks only for proven user-action paths.
- Test-count baseline: use Playwright's native list output as the authoritative baseline instead of grep-only `test(` counts.

## Data / Schema Changes

None — no app schema, migration, persisted user data, or production API contract changes.

Test fixture data is new, but it lives under `tests/playwright/helpers/mocks/` and must obey these contracts:

- v2 API responses use `{ v: 2, generated_at, data }`.
- `generated_at` is produced by a fixture factory helper at call time or from an explicitly documented freshness helper, so timestamp freshness is encoded in code rather than prose.
- Retail fixture shapes cover `manifest.json`, `retail/{slug}/latest.json`, `retail/{slug}/history-30d.json`, `retail/{slug}/intraday.json`, and `goldback/latest.json`.
- Exchange-rate fixtures include at least USD and the currencies currently asserted by currency specs.
- Local `data/spot-history-*.json` / `data/spot-history-bundle.js` requests remain local-server requests and are not mocked as external calls.

## Tradeoffs Surfaced for Review

- **Fixture-first migration vs helper calls in every spec.** The fixture import change is broad but makes future tests safer by default. Helper-only would touch fewer imports but would keep the current foot-gun: a new spec can call `page.goto()` before installing mocks.
- **Strict deny-list audit vs softer logging.** Failing on unexpected external requests may expose hidden action-paths during implementation. That is desirable for AC-1, but it means the first migration pass may be noisy until catalog/cloud/image flows are explicitly classified.
- **Conservative consolidation.** The approach prefers smaller, reviewable reductions over a headline percentage. This protects failure-mode readability, especially in retail fallback, API-tab no-network, cloud-sync, and catalog-provider tests.
- **Keeping `test:offline`.** The command becomes equivalent to `npm test` once `@network` tags are removed. Keeping it avoids a tooling surprise during this sketch; deleting it later is a cleanup issue.

## Out of Scope (follow-up issues)

- Future issue: flip `fullyParallel: true` and set a higher default worker count after this mocked baseline has 10 clean serial runs.
- Future issue: remediate any localStorage/test-order coupling discovered by the parallel-readiness audit.
- Future issue: address file-descriptor or Chromium process pressure if a parallel dry run exposes resource exhaustion.
- Future issue: evaluate MSW or a Node-level mock server only if `page.route()` helpers become too hard to maintain.
- Future issue: delete or redefine `npm run test:offline` once the team is comfortable that `npm test` is fully offline-safe.

## Risk Notes

- Risk: `browser.newPage()` suites bypass the extended `page` fixture → mitigation: tasks must scan for `browser.newPage`, `context.newPage`, and shared-page variables, then call `installStakTrakrNetworkMocks(page)` before the first navigation.
- Risk: route order silently changes behavior → mitigation: shared installer registers the audit catch-all first, default fulfillers second, and per-spec overrides last; per-spec overrides use `route.fallback()` only when they intentionally delegate.
- Risk: future manual-page suites bypass both the fixture and current `02-crud` installer path → mitigation: closing tasks include a grep guard for `browser.newPage|context.newPage` and fail if any match lacks an explicit installer call before navigation.
- Risk: cloud or catalog tests seed credentials and trigger provider fetches after user actions → mitigation: run the Q5/Q7 greps from discovery before implementation, then add provider-specific mocks only for proven action paths.
- Risk: fixture data is shape-correct but semantically stale → mitigation: centralize fixture factories and validate v2 envelope / currency shape in helper-level tests or a small Playwright smoke.
- Risk: consolidation hides distinct failures → mitigation: require a manual coverage map and one-line rationale for every removed test before deletion.
- Risk: strict request auditing flags harmless local-server assets → mitigation: allow `http://localhost:3000/**`, `data:` URLs, `blob:` URLs, and documented local repo assets; deny external `https:` hosts unless explicitly mocked or justified.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch review STRK-78 approach`, then `/sketch tasks STRK-78`.

## Review Archive — approach (2026-05-15)

_Reconciled by `/sketch reconcile` on 2026-05-15. Original reviewer marks preserved below for audit._

### Opus

#### Inline marks

> OPUS: D-4 leaves the **implementation shape of the audit hook unresolved** — discovery Q3 named two candidates (`page.on('request')` listener vs `page.route('**/*', failHandler)` catch-all) and approach.md needs to pick one before tasks. The two have very different ordering hazards: a `page.route('**/*')` catch-all registered as part of the fixture must be registered BEFORE the default fulfill handlers (so per-spec overrides → default fulfills → audit, in that LIFO precedence). If the audit catch-all is registered last instead, it shadows the default fulfills for v2/exchange/CDN endpoints and every navigation fails. A `page.on('request')` listener avoids route precedence entirely (it's a passive observer that flags after the fact) but loses stack traces. Pick one, document the registration order, and codify it in `routes.js`. This is the single highest-leverage detail still open.

> OPUS: D-4 also collides with the two existing **deny-all** specs (`stak-573-api-tab-qa.spec.js:161`, `stak-443-api-tab.spec.js:922` per discovery). Those register `page.route('**/*', route => route.abort())` to test the no-network code path. Under the fixture, those routes register AFTER the audit catch-all and would shadow it — fine, no false-positive audit fail. But if the audit is implemented via `page.on('request')` instead, every aborted request still fires the listener and the listener would flag the entire test as "leaked external requests" even though nothing actually escaped the browser. Approach.md must explicitly carve out a `mode: "deny-all"` option (or equivalent) on the fixture/installer so these two specs can opt out of the audit.

> OPUS: Discovery Q4 asked approach.md to **declare a concrete scoping rule** for the "market data" cluster (the only consolidation cluster without clean boundaries — Numista/view-modal/cloud-sync are already verified clean). D-7 softens this to "evaluate per-test." That's defensible but it punts the actual decision into implementation, where a single PR author makes ad-hoc merge calls with no recorded rule. Recommend: pre-declare a one-sentence rule here (candidate from discovery Q4: "files whose primary `test.describe` topic is a market control — filter/sort/chip — and which assert the same failure mode") and let tasks.md apply it. Without this, AC-4's "manual coverage map" gate has no anchor.

> OPUS: Discovery Q7 also asked the approach phase to **validate cold-start fan-out exhaustiveness via a static scan** (`rg -n 'fetch\(|XMLHttpRequest' js/ index.html`) rather than treating the 4-endpoint deny set as a prose claim. The approach doesn't include this scan as a planned step. Recommend adding it explicitly under a new "Pre-implementation Validation" subsection, or as a Risk Note mitigation, so tasks.md inherits it as a verifiable step rather than a discovery assumption.

> OPUS: Verified — `tests/playwright/02-crud/crud.spec.js:53` is the **only** spec file in the entire suite that calls `browser.newPage()` (`rg 'browser\.newPage|context\.newPage' tests/playwright --include='*.spec.js'` returns one match). No spec uses `context.newPage()`. So the dual-path design (extended-fixture + exported installer) is exhaustive today, but tasks.md should encode a lint/grep guard in the closing tasks to fail-fast if a future spec introduces a third manual-page-creation pattern that bypasses both paths. Without a guard, this is a re-emergent class of bug.

> OPUS: Both files are correctly classified as "no mocking needed" per discovery, but the **Modified** section listing them adds noise — they're listed only as "may migrate" / "leave alone unless lint says otherwise." Recommend moving them to a separate "Unchanged (verified safe)" subsection so the Modified count tracks the real migration workload (≈55 files) and reviewers don't have to scan ambiguous "may/may-not" entries.

#### OPUS Review (2026-05-15)

### Verified

- `tests/playwright/helpers/` contains only `seed.js`, `test-obverse.png`, `test-reverse.png` — confirms the proposed `helpers/mocks/` directory and its four files (`fixtures.js`, `routes.js`, `test.js`, `audit.js`) are all greenfield.
- `tests/playwright/02-crud/crud.spec.js:53` is the **only** spec in the suite that calls `browser.newPage()` (`rg 'browser\.newPage|context\.newPage' tests/playwright --include='*.spec.js'` → single match). The dual-path design (fixture + exported installer) is exhaustive against today's tree.
- The 56-spec file inventory in approach.md's File Map cross-checks against `find tests/playwright -name '*.spec.js'` — every modified entry maps to a real file, no phantom paths.
- D-3's claim that Playwright resolves routes "newest matching route first" with `route.fallback()` for delegation is consistent with current Playwright docs (verified via discovery's external references).
- D-6's MSW deferral is consistent with requirements' explicit non-goal and discovery's note that `serviceWorkers: "block"` (`playwright.config.js:11`) kills MSW's browser-worker mode regardless.
- The fixture `test.extend({ page })` pattern wraps the per-test `page` object at fixture creation time, BEFORE any `beforeEach` runs — so spec-level `page.route()` calls register after the fixture's defaults, giving the LIFO precedence the approach assumes. Correct architecturally.

### Top concerns

1. **D-4 audit hook implementation is underspecified.** Discovery Q3 listed two candidates (`page.on('request')` listener vs `page.route('**/*', ...)` catch-all) with materially different ordering hazards. Approach.md must pick one and document the registration order, or the rollout will hit silent shadowing bugs the first time a per-spec override misses an endpoint family. The deny-all specs (`stak-573`, `stak-443`) further need an explicit opt-out mode on the fixture/installer regardless of which implementation is chosen. **Highest-leverage open detail.**

2. **D-7 declines to declare the "market data" consolidation scoping rule.** Discovery Q4 specifically asked approach.md to anchor this rule so tasks.md and the AC-4 manual coverage map have a concrete predicate to apply. Without it, consolidation becomes a series of ad-hoc judgment calls in the implementation PR with no recorded rationale — the exact failure mode the consolidation workstream is supposed to avoid.

3. **Discovery Q7 cold-start exhaustiveness scan is not in the plan.** The 4-endpoint deny set is plausible but should be code-derived (`rg 'fetch\(|XMLHttpRequest' js/ index.html` cross-referenced with the discovery surface table) as a pre-implementation step, not assumed from discovery prose. As written, the deny set is a frozen claim that future commits can silently invalidate.

### Unverified assumptions

1. **`test.extend({ page })` composes cleanly with the existing 12 mocked files' per-test `page.route()` calls.** Mechanically yes (LIFO precedence), but approach.md doesn't specify whether those files migrate to the new fixture or keep their `@playwright/test` import. The Modified list includes them (e.g., `market-sorting.spec.js`, `retail/currency-switch.spec.js`) — but the per-spec language is "replace inline blobs with shared helpers" rather than "migrate to fixture." Whether they keep `@playwright/test` or move to the helper fixture is left ambiguous.

2. **A `helpers/mocks/test.js` filename doesn't trip lint/IDE confusion** with the Playwright `test` global. Minor, but a different filename (e.g., `fixture.js` or `extended-test.js`) would prevent the file from looking like a spec.

3. **All Modified-list entries currently navigate to `/index.html` or `/`.** Many entries say "migrate to shared mocks if app-shell navigation is present" — that conditional is unresolved and should be pre-classified before tasks.md, not left to the implementer to discover per-file. Discovery's call for a repeatable enumeration script addresses this; approach.md should commit to running it as a pre-task step.

4. **Existing deny-all specs (`stak-573`, `stak-443`) won't break under the fixture.** The approach assumes their `**/*` abort registered after fixture defaults wins by LIFO — true for route precedence. But the audit hook interaction is unhandled (see Concern 1).

5. **`route.fallback()` semantics are required for any default→override delegation.** D-3 mentions it in passing. The approach doesn't enumerate which per-spec overrides actually need `fallback()` vs straightforward `fulfill()` — likely none today, but worth pre-deciding so per-spec authors know the convention.

6. **Fixture freshness contract (Constraints, discovery) gets encoded in `fixtures.js` factories.** Approach.md mentions the contract in "Data / Schema Changes" but doesn't say WHERE in the code the contract lives. If it's prose in fixtures.js, it'll rot. Recommend a factory helper that produces `generated_at` at call time (e.g. `new Date().toISOString()`) so fixtures are auto-fresh.

### Resolution Summary

- Accepted: 10
- Rejected: 0
- Resolved with your input: 0
