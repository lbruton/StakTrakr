---
sketch: "STRK-78-playwright-mock-audit"
phase: discovery
created: 2026-05-15
---

# STRK-78 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

### Playwright runtime & config

| Path                                                            | Role                        | Notes                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright.config.js:5-7`                                      | Suite-wide knobs            | `fullyParallel: false`, `workers: process.env.PW_WORKERS ? parseInt(process.env.PW_WORKERS, 10) \|\| 1 : 1`, `retries: 0 local / 1 CI`. Already wired for parallel via `PW_WORKERS` env. Non-numeric `PW_WORKERS` values silently fall back to 1 worker (parseInt → NaN → `\|\| 1`) — a behavioral detail the installer must preserve when validating parallel safety. |
| `playwright.config.js:11`                                       | Service-worker policy       | `serviceWorkers: "block"` — Playwright never has a live SW in the test context. Removes one MSW concern but is independent of in-page `fetch()` calls, which still escape.                                                                                                                                                                                             |
| `playwright.config.js:14-17`                                    | Local web server            | `python3 -m http.server 3000` serves the repo. `page.goto("/")` and `page.goto("/index.html")` are local; all external traffic comes from app code after load.                                                                                                                                                                                                         |
| `package.json:13-14`                                            | `npm test` / `test:offline` | `test:offline` is `playwright test --grep-invert @network`. Only four tests in `tests/playwright/01-page-load/page-load.spec.js:93-147` carry `@network`.                                                                                                                                                                                                              |
| `tests/playwright/helpers/seed.js:1-23`                         | Existing helper             | Single function `injectSeedInventory(page)` — `addInitScript` seeds localStorage from `tests/fixtures/seed-inventory.js` and stamps `ackVersion`. Pure DOM-side seeding; no route handling.                                                                                                                                                                            |
| `tests/fixtures/seed-inventory.js`                              | Inventory seed fixture      | Default-exported object dropped into localStorage by `injectSeedInventory`. Sibling `tests/fixtures/settings-diff-test.json` is a one-off fixture for the settings-diff test.                                                                                                                                                                                          |
| `tests/playwright/helpers/test-obverse.png`, `test-reverse.png` | Image fixtures              | Used by image-related specs (`image-frame-override`, `rect-image-card-table`).                                                                                                                                                                                                                                                                                         |

> No `tests/playwright/helpers/mocks/` directory exists. (Verified in requirements review by Codex and Qwen.)

### The 12 mocked spec files — route patterns in use

Five distinct endpoint families show up across the 12 files that currently call `page.route()`:

| Endpoint family              | Hosts                                          | Mock pattern observed                                                                                                                                                                                                            | Representative spec(s)                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **v2 API (primary)**         | `api.staktrakr.com/data/v2/**`                 | `route.fulfill` with `{ v: 2, generated_at, data: ... }`. Per-path dispatch inside one handler: `manifest.json`, `goldback/latest.json`, `retail/{slug}/latest.json`, `retail/{slug}/history-30d.json`. 404 for unmatched paths. | `market-sorting.spec.js:258-285`, `retail/currency-switch.spec.js:253-267`, `retail/stak-582-market-survivors.spec.js:320-334`, `view-modal-chart-scaling.spec.js`, `inventory/lot-each-purchase-price.spec.js` |
| **v2 fallback**              | `api2.staktrakr.com/data/v2/**`                | Almost always stubbed to `503` so the test exercises the primary path. A few specs swap and test the fallback.                                                                                                                   | `market-sorting.spec.js:285`, `retail/currency-switch.spec.js:268`, `retail/stak-582-market-survivors.spec.js:335`                                                                                              |
| **Exchange rate**            | `open.er-api.com/v6/latest/USD`                | `route.fulfill` with `{ rates: { USD: 1, EUR: 0.93, ... } }` (per-test specific).                                                                                                                                                | `view-modal-chart-scaling.spec.js:77`, `inventory/virtual-sort-options.spec.js:41`, `inventory/lot-each-purchase-price.spec.js:49`, `inventory/partial-stack-disposition.spec.js:65`                            |
| **CDN — lightweight-charts** | `cdn.jsdelivr.net/npm/lightweight-charts@4/**` | `route.fulfill` with empty 200 — chart lib swallowed because retail tests don't render charts.                                                                                                                                   | `retail/currency-switch.spec.js:245`, `retail/stak-582-market-survivors.spec.js:312`                                                                                                                            |
| **Manifest abort**           | `**/manifest.json`                             | `route.abort()` to force the not-loaded code path.                                                                                                                                                                               | `retail/slug-resolution.spec.js:53`                                                                                                                                                                             |
| **Image hosts (catch)**      | `https://images.example/**`                    | `route.fulfill` with stubbed PNG bytes for image-frame specs.                                                                                                                                                                    | `image-frame-override.spec.js:60`, `rect-image-card-table.spec.js:68`                                                                                                                                           |
| **Universal block (`**/*`)** | All                                            | `route.abort()` everywhere — used by `stak-573-api-tab-qa.spec.js:161` and `stak-443-api-tab.spec.js:922` to test the "no-network" code path.                                                                                    | These specs are the only existing pattern for a "deny everything" mode.                                                                                                                                         |

Observation for approach.md: response shapes are duplicated inline across these specs (the v2 envelope `{ v: 2, generated_at, data: ... }` appears verbatim in ~6 files; the exchange-rate `{ rates: { USD: 1, ... } }` in ~4 files; the CDN empty-200 in 2 files). All five families are candidates for shared installers.

### App-code external surfaces (what mocks must cover)

Every spec that **navigates the browser to `/` or `/index.html`** triggers the app's startup fetch chain. Detection cannot be limited to literal `page.goto` calls: `tests/playwright/02-crud/crud.spec.js:49-60` uses `sharedPage.goto("/index.html", { waitUntil: "domcontentloaded" })` in `beforeAll` and would be silently excluded by a `page.goto`-only scan, taking ~21 browser tests with it. Approach.md must classify suites by browser-page navigation behavior (any page-like object calling `.goto`), not by a single variable name.

The full surface in app code:

| Path                                                                             | Endpoint(s)                                                                                                                                                                          | Trigger                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `js/constants.js:18,533-534`                                                     | `api.staktrakr.com/data` (legacy), `api.staktrakr.com/data/v2`, `api2.staktrakr.com/data/v2`                                                                                         | Base URLs read by `js/market-data.js` and `js/retail.js`.                                                                                       |
| `js/constants.js:332`                                                            | `open.er-api.com/v6/latest/USD`                                                                                                                                                      | Read by `js/utils.js:754-765` and `js/init.js`-driven currency init.                                                                            |
| `js/market-data.js:96,513-531,970,1403`                                          | `${V2_API}/manifest.json`, `/retail/{slug}/latest.json`, `/retail/{slug}/history-30d.json`, `/retail/{slug}/intraday.json`, `/goldback/latest.json`                                  | Initial market refresh + per-vendor detail fetches + goldback price.                                                                            |
| `js/api.js:45,1421,1469,1492,1588,1763,1834,2077,2951`                           | Spot history JSONs (`data/spot-history-{year}.json` — local, served by python http.server) + various external API providers when keys are configured                                 | Most are gated by user-configured API keys; safe by default. The `data/spot-history-*.json` is **local**, not an external request.              |
| `js/api.js:2951`                                                                 | `data/spot-history-${year}.json`                                                                                                                                                     | Local repo path; not external. Confirms why `data/spot-history-bundle.js` matters for offline runs.                                             |
| `js/api-health.js:131`                                                           | Configurable health URLs                                                                                                                                                             | Fired by settings UI; not the cold-start path.                                                                                                  |
| `js/catalog-api.js:272,470,573-580`                                              | Numista / PCGS                                                                                                                                                                       | Gated by `catalogConfig.isNumistaEnabled()` / configured bearer token. Default seed has no catalog key → no Numista calls fire from cold start. |
| `js/cloud-storage.js:385,558,761,771,915`                                        | `dropbox.com`, `pcloud.com`, `box.com` OAuth + content endpoints                                                                                                                     | Gated by user-initiated OAuth flow; never fires on startup.                                                                                     |
| `js/cloud-sync.js:3491`                                                          | `content.dropboxapi.com/2/files/upload`                                                                                                                                              | Cloud-sync flow only.                                                                                                                           |
| `js/goldback.js:435,486`                                                         | Goldback retail + history — paths route through `V2_API`                                                                                                                             | Same v2 mock covers these.                                                                                                                      |
| `js/image-cache.js:679-688`, `js/image-processor.js:72`, `js/vault.js:1604,1657` | Arbitrary image URLs and Dropbox content uploads                                                                                                                                     | Only fire when user actions trigger them; tests using injected fixtures rarely hit.                                                             |
| `index.html:335`                                                                 | `cdn.jsdelivr.net/npm/lightweight-charts@4/.../lightweight-charts.standalone.production.js`                                                                                          | Loaded as a `<script src>` at parse time. Every navigation to `/index.html` triggers it unless intercepted.                                     |
| `about.html`                                                                     | None — only `<a href>` anchor links to staktrakr.com, github.com, numista.com, pcgs.com, metals.dev. No `<script src>` or CDN imports. `about.html` has zero `<script>` tags at all. | `about-page.spec.js` is genuinely offline-safe.                                                                                                 |

**Cold-start fetch fan-out for a vanilla navigation to `/index.html`** (no further user action, no configured API keys, default localStorage):

1. `index.html` parse → `cdn.jsdelivr.net` script tag.
2. `market-data.js` init → `api.staktrakr.com/data/v2/manifest.json`, then per-slug `latest.json` / `history-30d.json` / `intraday.json` + `goldback/latest.json`.
3. `utils.js` exchange-rate refresh → `open.er-api.com/v6/latest/USD`.
4. On failure of `(2)`, automatic fallback to `api2.staktrakr.com/data/v2/...`.

Numista, PCGS, Dropbox/Box/pCloud are all gated by user-configured state that the default seed does not set. **They are not part of the cold-start surface.** This narrows AC-1's mandatory deny-list to: `api.staktrakr.com/data/v2/**`, `api2.staktrakr.com/data/v2/**`, `open.er-api.com/**`, `cdn.jsdelivr.net/npm/lightweight-charts@4/**`.

### Classification of the unmocked spec files

**Live counts at reconcile time (2026-05-15):** 56 total spec files, 12 with `page.route`, 44 without. Static `test(` call count: 660 across all spec files. Two files (139 tests) are confirmed browser-free or local-asset-only:

> DEEPSEEK: My live `grep -c 'test('` scan on 2026-05-15 returns 643, not 660. The 17-count discrepancy may come from multi-line signatures, `test.step`, or dynamic test generation. The approach.md enumeration script must count via Playwright's native listing (`npx playwright test --list`), not grep, to avoid this class of drift.

| File                        | Test count | Classification                                                                                       | Evidence                                                                                                          |
| --------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `config-validation.spec.js` | 94         | **No mocking needed** — pure Node `fs`/`path` reads of repo config files; no browser page fixture.   | Spec has no Playwright page object; classification is "no browser-page navigation," not "no literal `page.goto`." |
| `about-page.spec.js`        | 45         | **No mocking needed** — navigates to `/about.html` only; `about.html` declares zero `<script>` tags. | Verified `grep -n 'http' about.html` returns only anchor `href`s.                                                 |

**The remaining ~343 unmocked app-loading tests across 43 files** all navigate the browser to `/index.html` (or `/`), either via direct `page.goto` or via shared-page objects like `02-crud/crud.spec.js`'s `sharedPage.goto`. By the cold-start fan-out above, **every one of them triggers at least the v2 API + exchange-rate + CDN chain**. Classification at file granularity is therefore binary in practice: `about-page` and `config-validation` are safe; all others need at minimum the four-endpoint deny set.

> **These counts are a snapshot.** Approach.md must define the unmocked-suite enumeration as a repeatable script (find spec files that instantiate a Playwright page object and call `.goto` on it with an `/index.html` or `/` target — not a fixed file list) so new tests, shared-page suites, or generated cases don't drift the target between discovery and implementation.

Sub-classification of the unmocked app-loading suites by _additional_ surfaces they exercise (informs whether they need per-spec extensions on top of the global installer):

- **Pure UI / localStorage assertions** that read the app post-load but don't action retail/cloud/catalog flows (themes, typography, modal layout, page-load smoke, CRUD inventory, payment-method, realized-toggle, etc.) → global installer is sufficient.
- **Retail / market UI** that fetch per-slug detail (`market-filter-cache-invalidation.spec.js`, `04-market-controls.spec.js`, `filter-chip-and-logic.spec.js`, `goldback-type.spec.js`, `silverback.spec.js`, `numista-picker-tags.spec.js`, `view-modal-no-auto-resync.spec.js`, `view-modal-numista-merge.spec.js`) → global installer + per-slug fixtures.
- **Catalog (Numista/PCGS) flows** (`catalog-api-key.spec.js`, `numista-search.spec.js`, `numista-not-configured.spec.js`, `numista-picker-tags.spec.js`) → **action-path audit required**, not uniform window-level stubbing. `catalog-api-key.spec.js:19-35` seeds real-looking `catalog_api_config` before load and only stubs `window.testNumistaAPI` inside CA-5 (`:187-210`) for the API-test action path; other tests in that file inspect settings UI rather than invoking provider fetches. Approach.md must audit configured-catalog-key specs by action path before declaring "no Numista network family needed" — recommended grep: `rg 'setNumistaConfig|setPcgsConfig' tests/playwright/03-settings`.

> DEEPSEEK: `numista-search.spec.js` seeds a fake Numista API key at line 63-74 (`catalog_api_config.numista.apiKey: btoa("fake-key-for-test")`) and navigates to `/index.html` (line 78) with **zero** `page.route()` calls. The `NumistaProvider` constructor verifiably does not fire network requests (verified at `js/catalog-api.js:934-937` — constructor only calls `catalogConfig.isNumistaEnabled()` then `new NumistaProvider()` which is side-effect-free). However, if any cold-start code path (e.g., `market-data.js` init, version-check, or a DOM mutation observer) triggers a catalog `searchItems()` call, the fake key would cause a real `fetch()` to `api.numista.com`. The current test exercises only `buildNumistaSearchQuery` in `page.evaluate()` (a pure string builder), so it happens to be safe today — but this is fragile. approach.md should verify exhaustively that seeded-but-unmocked catalog keys in this and `numista-picker-tags.spec.js` (also zero `page.route()` calls) cannot escape through any init path.

- **Cloud-sync flows** (`cloud-sync-header-button.spec.js`, `03-settings/settings-cloud-tab.spec.js`, `attachments/cloud-sync.spec.js`, `view-modal-no-auto-resync.spec.js`) → cloud-storage calls are gated behind user OAuth. The two header-button / settings specs verifiably stub `window.pushSyncVault` / `window.syncNow`, so no real Dropbox calls fire from them. `attachments/cloud-sync.spec.js` and `view-modal-no-auto-resync.spec.js` were not independently audited in this reconcile; see resolved Q5 for the required approach-phase grep.

> DEEPSEEK: `attachments/cloud-sync.spec.js` **seeds real-looking Dropbox tokens** (line 8-18: `cloud_dropbox_account_id`, `cloud_token_dropbox`, `cloud_sync_enabled`, `cloud_vault_password`) AND navigates to `/index.html` (line 25) with **zero** `page.route()` and **zero** `window.syncNow`/`window.pushSyncVault` stubs. If the app's post-load init triggers cloud sync when these tokens are present, real Dropbox API calls escape unmocked. The first `test.describe` block (line 21, "STRK-45 — Cloud sync attachment storage keys") reads `ALLOWED_STORAGE_KEYS` and calls `loadDataSync` after navigation — a code path that does not require sync methods to be called, but the cold-start itself could fire them. The second `test.describe` block (line 58, "STRK-45 — DiffEngine integration") also navigates to `/index.html` without route mocking. This is a load-bearing gap — approach.md must either mock the cloud-sync surface for this spec OR confirm through static analysis that the app's startup path does not invoke sync when tokens are present.
> DEEPSEEK: `view-modal-no-auto-resync.spec.js` also has zero `page.route()` calls and navigates to `/index.html`. It is not the safe category — it needs the global installer.

- **Attachments / vault** (`attachments/*.spec.js`) → IndexedDB and localStorage; no external network if `injectSeedInventory` does not populate cloud tokens.

### Existing-mock-file inventory (one-line per file)

| Mocked file                                   | Endpoints intercepted           | Purpose                          |
| --------------------------------------------- | ------------------------------- | -------------------------------- |
| `stak-573-api-tab-qa.spec.js`                 | `**/*` aborted                  | API-tab "no network" path        |
| `view-modal-chart-scaling.spec.js`            | `open.er-api.com/v6/latest/USD` | Pin exchange rate for chart math |
| `stak-443-api-tab.spec.js`                    | `**/*` aborted                  | API-tab "no network" path        |
| `image-frame-override.spec.js`                | `https://images.example/**`     | Stubbed PNG                      |
| `retail/stak-582-market-survivors.spec.js`    | CDN, v2, v2-fallback            | Retail survivors flow            |
| `retail/currency-switch.spec.js`              | CDN, v2, v2-fallback            | Currency switching               |
| `rect-image-card-table.spec.js`               | `https://images.example/**`     | Stubbed PNG                      |
| `retail/slug-resolution.spec.js`              | `**/manifest.json` aborted      | Force not-loaded code path       |
| `market-sorting.spec.js`                      | v2, v2-fallback                 | Vendor sort logic                |
| `inventory/virtual-sort-options.spec.js`      | `open.er-api.com/v6/latest/USD` | Exchange rate                    |
| `inventory/partial-stack-disposition.spec.js` | `open.er-api.com/v6/latest/USD` | Exchange rate                    |
| `inventory/lot-each-purchase-price.spec.js`   | `open.er-api.com/v6/latest/USD` | Exchange rate                    |

Three of the existing 12 (`stak-573-api-tab-qa`, `stak-443-api-tab`, `retail/slug-resolution`) are _deny/abort_ patterns, not response-fulfill patterns. The shared library design must accommodate both.

## Prior Decisions

- **2026-05-14** — `serviceWorkers: "block"` left in place across the Playwright config; no prior decision suggests changing it (`playwright.config.js:11`). Means MSW's SW mode is dead-on-arrival in this harness — the requirements non-goal that deferred MSW outright is consistent with this.
- **STAK-545 / STAK-573 / STAK-443 / STAK-582** — the four recent issues that authored the existing route-handler specs (`04-market-controls.spec.js` references STAK-545 in its describe block; `stak-573-api-tab-qa`, `stak-443-api-tab`, `retail/stak-582-market-survivors` are direct namesakes). Their inline mock patterns are the de facto template for how the project mocks Playwright today.
- **CLAUDE.md** — "Playwright dialog testing — `showAppConfirm` is NOT `window.confirm`" — orthogonal to route mocking but reminds approach.md that dialog interception is its own helper concern. Not in scope for this sketch.
- **Default `injectSeedInventory` does not set `cloud_token_*` or `catalog_api_config`** — verified by reading `tests/fixtures/seed-inventory.js` (contains only `metalInventory` and `inventorySerial`) and `helpers/seed.js` (adds only `ackVersion` via `addInitScript`). Confirms catalog and cloud-storage paths are dormant by default.
- mem0 / sessionflow search for prior Playwright-mocking decisions: none surfaced. This is the first formal pass; the prior pattern was per-spec ad-hoc.

## External References

- [Playwright `page.route()` docs](https://playwright.dev/docs/network#handle-requests) — fulfill/abort/continue contract; **precedence rules: last-registered route wins**. Carry this into Q1 architecture analysis.
- [Playwright "modify requests" guide](https://playwright.dev/docs/api/class-page#page-route) — relevant for the global "fail-on-unexpected-request" audit hook in AC-1.
- [Playwright fixtures](https://playwright.dev/docs/test-fixtures) — the canonical way to share setup like `injectSeedInventory` + route installers across specs. The project currently uses raw helper imports; a custom `test.extend({ mockedPage })` fixture is the structural alternative approach.md will weigh.
- [Spec Kit `[P]` parallel marker convention](https://github.com/github/spec-kit) — used in the requirements/tasks templates; not novel but the source of truth for the marker semantics.
- **MSW (deferred)** — not researched further. Non-goal in requirements.

## Constraints

- **Vanilla JS, script-tag globals, no module bundler.** Any shared mock library must be importable from spec files via ES module imports (Playwright specs already use `import` for `@playwright/test`), but must not assume any app-side bundling. Implication: the shared mock lives entirely under `tests/`, never inside `js/`.
- **`serviceWorkers: "block"` stays.** Any solution that requires a live SW (true MSW with the browser worker) is incompatible without flipping that flag. Approach must respect the existing block.
- **Script load order matters in the app**, not in the tests, but specs that read `window.*` globals (e.g. `showSettingsModal`, `renderVendorPrices`) must continue to `waitForFunction(...)` after navigation. Route installers must run **before** navigation because once the parse-time `<script src="cdn.jsdelivr.net/...">` request fires, the route handler set up afterwards never sees it.
- **`page.addInitScript` discipline.** `injectSeedInventory` uses `addInitScript` for localStorage seeding. New `addInitScript` calls compose, but their order is registration order — any future fixture that depends on existing seed must register after `injectSeedInventory`.
- **Response shape fidelity.** Mocks must mirror real-world response shape (`{ v: 2, generated_at: ISO-8601, data: {...} }`) so existing assertions remain valid. Real-world data lives in production v2 API; we can sample a snapshot for fixture canonical shapes, but the values themselves can be pinned constants.
- **Fixture freshness contract.** `generated_at` in any v2-envelope fixture must be a valid ISO-8601 string and recent enough that no existing assertion treats it as stale (no test asserts on `generated_at` recency today, but pinning a 2023 date would be a latent trap if such an assertion is later added). Spot-history fixtures must mirror the structure of `data/spot-history-bundle.js` so cold-start consumers don't break on shape drift. Approach.md must encode the contract in fixture-loading code, not in prose.
- **Route registration order — global before per-spec.** Playwright resolves routes by last-registered-first. The global deny set / installer must register BEFORE any per-spec extension; otherwise the global handler shadows the per-spec one and the test silently runs against the wrong stub. This makes a custom `test.extend({ page })` fixture more enforceable than bare helper functions, because the fixture's `page` is established before any `beforeEach` runs.
- **`spot-history-*.json` and `spot-history-bundle.js` are local repo files.** They are served by `python3 -m http.server`. Not external — no mocking, but `/update-spot-bundle` must keep them current (separate concern; tracked by global pre-PR gate).
- **`PW_WORKERS` env var already wired.** Once isolation is established, a downstream parallel-flip PR is one line + flip `fullyParallel`. Approach.md should not add new flags here.
- **Test count is the audit denominator.** Live counts are generated artifacts, not prose constants. Approach.md must script the enumeration so consolidation phase and mocking phase target a live denominator at each run.

## Open Questions

The items below need answers before approach.md can be written.

- [ ] **Q1 — Global vs per-spec installer architecture.** Two viable shapes:
      (a) `test.extend({ page })` custom fixture that auto-installs the deny set before every navigation.
      (b) Helper functions `installV2Mock(page, opts)`, `installExchangeRateMock(page, opts)`, etc., that each spec calls explicitly.
      Playwright's last-registered-route-first precedence means the global deny set MUST register before per-spec extensions (see Constraints). A custom fixture makes this ordering enforceable mechanically; bare helpers rely on discipline. Approach.md must pick one (or a hybrid) with this constraint baked in.
- [ ] **Q2 — "Universal block" mode**. The existing `**/*` abort pattern (`stak-573-api-tab-qa`, `stak-443-api-tab`) is semantically different from per-endpoint fulfill. Should the shared library expose a `installDenyAll(page)` mode for these specs, or leave them as bespoke? Decision is approach-phase.
- [ ] **Q3 — Network audit hook scope.** AC-1 requires a deny-list audit. Two implementations:
      (a) `page.on('request')` listener that fails the test on unexpected hosts (must be off the allow-list).
      (b) `page.route('**/*', ...)` catch-all installed last that fails-fast.
      Both work; (b) gives stack traces, (a) gives a clean post-run summary. **Either implementation must distinguish `http://localhost:3000` (web server, expected) from external hosts** — without that, harmless local asset fetches (favicon, `/data/spot-history-*.json`, served stylesheets) would trip the deny-list. Approach picks the implementation and encodes the allow-list.
- [ ] **Q4 — Consolidation scoping rule for "market data" cluster.** Requirements left this open ("~17 files reference 'market'"). Concrete rule needed before tasks.md can list which files to merge. Candidate rule: "files whose primary `test.describe` topic is a market control (filter, sort, chip) — exclude retail-detail and settings-tab specs even if they touch market UI." **The rule must preserve failure-mode boundaries** — do not merge specs that assert different failure modes (e.g. fallback-503 path vs primary-200 path) even when topic clusters overlap, because merged assertions reduce readability and debuggability when one branch regresses. Approach.md should declare the rule.
- [ ] **Q5 — Cloud-storage mock family (resolved with audit caveat).** Gemini and Deepseek independently verified that `cloud-sync-header-button.spec.js` and `03-settings/settings-cloud-tab.spec.js` stub the sync execution methods (`window.pushSyncVault`, `window.syncNow`) even when seeding dummy Dropbox tokens, so no live `content.dropboxapi.com` calls fire. **Resolution:** no 6th mock family (cloud-storage) is required from the four specs reviewed. **Audit caveat:** `attachments/cloud-sync.spec.js` and `view-modal-no-auto-resync.spec.js` were not independently audited in this reconcile. Before approach.md locks the mock surface, run:

      ```
          rg 'cloud_token|content\.dropboxapi' tests/playwright/attachments \
                tests/playwright/**/view-modal-no-auto-resync*
          ```

          If non-stubbed hits appear, the cloud-storage family becomes mandatory. Otherwise, Q5 is fully closed.

- [ ] **Q6 — `@network` tag policy post-mocking.** Requirements relaxed the non-goal to allow removing the tags once mocked. Confirm in approach.md: tags removed, `npm run test:offline` script kept for transition or deleted outright. Tasks.md derives the closing actions from that.
- [ ] **Q7 — Cold-start fan-out exhaustiveness.** Reviewer consensus surfaced the assumption that the 4-endpoint deny set + enumerated per-spec extensions cover every external fetch the app produces. Approach.md must validate this with a static scan (e.g., `rg -n 'fetch\(|XMLHttpRequest' js/ index.html` cross-referenced with the table in this discovery) and call out any new surfaces (image hosts via user actions, post-OAuth flows, configured catalog keys). Treat this as a code-derived check, not a prose claim, so future commits cannot drift the deny-list silently.

## Discovery Summary

The mocking work is structurally simpler than the unmocked-test count suggests: the cold-start fan-out has exactly four mandatory endpoints (v2 primary, v2 fallback, exchange rate, CDN charts), all already mocked inline in 12 reference specs using two patterns (`fulfill` and `abort`). The bulk of the implementation is mechanical — extract those patterns into a shared installer, call it from each of the ~343 unmocked app-loading tests across the 43 non-safe files that navigate to `/index.html` (directly or via shared-page objects). The harder design call is the installer's _shape_ (custom fixture vs helper functions vs hybrid) under Playwright's last-registered-route-first precedence, and how to surface a "fail-on-unexpected-request" audit hook to satisfy AC-1 without false positives from incidental local-server fetches. Consolidation is a separate, more judgmental workstream that hinges on the "market data" scoping rule (Q4); the Numista, view-modal, and cloud-sync clusters already have clean boundaries verified in requirements review.

---

> **Phase complete?** Existing code mapped (helpers, fixtures, 12 mocked patterns, app-code fetch sites). Prior decisions surfaced (SW-block stays, prior STAK issues are templates). Open questions are all approach-phase scope decisions, not blockers. Next: `/sketch approach STRK-78`.

## Review Archive — discovery (2026-05-15)

_Reconciled by /sketch reconcile on 2026-05-15. Original reviewer marks preserved below for audit._

### Codex

#### Inline marks

> CODEX: This predicate is too narrow for the audit query. `tests/playwright/02-crud/crud.spec.js` loads the app through `sharedPage.goto("/index.html", { waitUntil: "domcontentloaded" })` in `beforeAll` (`tests/playwright/02-crud/crud.spec.js:49-60`), so grep/count logic that only searches literal `page.goto` will miss 21 browser tests that still need the same startup-network treatment.

> CODEX: The evidence command is stale/unsafe as written: a live scan shows `tests/playwright/02-crud/crud.spec.js` also has no literal `page.goto`, but it does call `sharedPage.goto` after creating a browser page (`tests/playwright/02-crud/crud.spec.js:52-60`). The "no mocking needed" rule should be based on browser/page usage plus target URL, not only literal `page.goto`.

> CODEX: The current live denominator does not match these numbers. Counting `test(` in 56 `*.spec.js` files gives 660 tests total; the 44 no-`page.route` files contain 482 tests; subtracting the 139 safe tests in `about-page.spec.js` and `config-validation.spec.js` leaves 343 unmocked app-loading tests across 43 files once `02-crud`'s `sharedPage.goto` is included. Treat the exact count as a generated audit artifact in approach/tasks, not a fixed prose number.

> CODEX: "Catalog specs stub the catalog API at the `window.catalogAPI` / `window.numistaAPI` layer" overstates the pattern. `tests/playwright/03-settings/catalog-api-key.spec.js` seeds real-looking `catalog_api_config` before load (`tests/playwright/03-settings/catalog-api-key.spec.js:19-35`) and only stubs `window.testNumistaAPI` inside CA-5 before clicking the test button (`tests/playwright/03-settings/catalog-api-key.spec.js:187-210`). The no-network conclusion still looks plausible because the other tests inspect settings UI rather than invoking provider fetches, but approach.md should audit configured catalog-key specs by action path, not by assuming a uniform window-level stub.

> CODEX: This should be recalculated before approach/tasks. My live static count is 660 `test(` calls, not 643; 139 safe tests still matches `about-page.spec.js` + `config-validation.spec.js`. The implementation plan should define the denominator with a repeatable script/query so new tests and serial/shared-page suites do not drift the target.

#### Review section

### Verified

- `playwright.config.js:5-17` confirms serial-by-default Playwright config, `PW_WORKERS` parsing/fallback, `serviceWorkers: "block"`, and the local `python3 -m http.server 3000` web server.
- `package.json:13-14` confirms `npm test` and `npm run test:offline`; `tests/playwright/01-page-load/page-load.spec.js:93-147` contains the four current `@network` tests.
- `tests/playwright/helpers/seed.js:1-23` and `tests/fixtures/seed-inventory.js:1-80` confirm seed setup writes inventory data plus `ackVersion`, not cloud tokens or catalog API config.
- `index.html:333-336`, `js/constants.js:18,332,531-538`, `js/utils.js:754-765`, and `js/market-data.js:96,513-545,970,1403` confirm the cold-start external surfaces called out in discovery: CDN chart script, v2 API primary/fallback, retail/goldback v2 paths, and exchange-rate fetch.
- `about-page.spec.js:10-12`, `about.html:1-11`, and `about.html:505-935` confirm `about-page` loads `/about.html`, has no script tags, and only contains external anchor `href`s.
- `config-validation.spec.js:1-21` confirms the 94 config-validation tests are Node-side file reads with no browser page fixture.
- `tests/playwright/02-crud/crud.spec.js:49-60` confirms the discovery's literal `page.goto` scan misses a browser suite that loads `/index.html` through `sharedPage.goto`.
- Static live count as of this review: 56 spec files, 12 files with `page.route`, 44 files without `page.route`, 660 `test(` calls total, 139 safe tests in `about-page` + `config-validation`, and 343 unmocked app-loading tests across 43 files after including `02-crud`.
- `tests/playwright/03-settings/catalog-api-key.spec.js:19-35` and `:187-210` confirm configured catalog-key tests are not all `window.catalogAPI`/`window.numistaAPI` stubs; one test stubs `window.testNumistaAPI` only for the API-test action path.
- Playwright's current docs confirm route precedence is last-registered route first, so fixture/helper registration order is a real approach-phase constraint.

### Top concerns

1. **Audit denominator drift.** The discovery mixes 472, 394, 643, and now-live 660/343 counts. Approach/tasks should generate the target list from code instead of carrying fixed prose counts forward.
2. **Literal `page.goto` detection misses shared-page suites.** `02-crud` is the concrete miss; the mock rollout should classify app-loading suites by browser/page navigation behavior, not by a single variable name.
3. **Catalog-flow classification is too broad.** The no-network conclusion may still hold, but configured catalog-key tests need action-path review because they are not all using the same window-level stub pattern.

### CODEX — Unverified Assumptions

- The static `test(` count is close enough for planning; it may include skipped/focused/generated cases differently than Playwright's runtime reporter.
- No spec dynamically creates a browser page and navigates to `/index.html` through a helper name other than `page` or `sharedPage`; approach should use a conservative code scan before finalizing scope.
- Catalog settings tests with seeded API keys do not invoke real Numista/PCGS fetches outside CA-5's stubbed test-button path.
- The four-endpoint cold-start deny set remains sufficient after user actions, except for explicitly enumerated per-spec extensions.
- The route installer design will account for Playwright's last-registered-route precedence when combining global mocks, per-spec overrides, and catch-all audit hooks.

### Gemini

#### Inline marks

> GEMINI: Verified. `package.json` correctly defines `test:offline` and exactly four tests in `01-page-load/page-load.spec.js` carry the `@network` tag.

> GEMINI: Verified. `tests/fixtures/seed-inventory.js` strictly contains `metalInventory` and `inventorySerial`. `helpers/seed.js` adds `ackVersion` but sets no API keys or cloud tokens.

> GEMINI: I ran the grep and reviewed the specs (`cloud-sync-header-button.spec.js` and `settings-cloud-tab.spec.js`). While they do inject dummy Dropbox tokens (`sl.test-fake-token`), they stub the actual sync execution methods (e.g., `window.syncNow = async () => {...}` or `window.pushSyncVault = async () => {}`). Thus, the tests do not simulate a state that initiates live fetches to `content.dropboxapi.com`. A sixth mock family is not required.

#### Review section

### Verified

- `playwright.config.js`: Verified `serviceWorkers: "block"`, `fullyParallel: false`, and `python3 -m http.server 3000` configuration is exactly as described.
- `package.json` and `@network` tags: Verified `test:offline` is `playwright test --grep-invert @network`, and exactly 4 tests in `page-load.spec.js` carry the `@network` tag.
- Seed data isolation: Verified `tests/fixtures/seed-inventory.js` and `helpers/seed.js` do not set catalog API keys or cloud storage tokens.
- Cloud storage test stubs (Q5): Verified the cloud-sync specs (`cloud-sync-header-button.spec.js` and `settings-cloud-tab.spec.js`) explicitly stub out `window.syncNow` and `window.pushSyncVault`, meaning no actual Dropbox API calls fire during test execution despite token injection.

### Top Concerns

1. **Network Audit Hook Implementation (Q3)**: The fail-on-unexpected-request requirement (AC-1) might inadvertently fail tests that fire harmless asynchronous fetches or local assets. The implementation must distinguish between external HTTP calls and local `http://localhost:3000` fetches.
2. **Implicit Playwright Route Overrides**: The document notes 5 distinct mock families in 12 mock files. If moving to a global `test.extend` or shared helper, tests that currently call `page.route` manually might suffer from handler registration conflicts or precedence issues (Playwright resolves routes by last-registered). Approach.md must address how existing `page.route` overrides will co-exist.
3. **Consolidation Scoping Rule (Q4)**: The candidate rule focuses on "market data" UI. The consolidation should ensure it doesn't mistakenly merge assertions that test entirely different failure modes, which would reduce test readability and debuggability when a specific branch fails.

### GEMINI — Unverified Assumptions

- **All non-API external requests are accounted for**: Assumes that the cold-start fan-out (CDN charts, exchange rate, v2 API) is the _exhaustive_ list of external dependencies needed for the page to render fully without failing assertions.
- **Local `http.server` stability**: Assumes that fetching local `/data/spot-history-{year}.json` or images via the local server during tests won't flake under `fullyParallel: true` execution in the future.
- **Spec `page.goto` uniformity**: Assumes every unmocked spec file uses `page.goto("/")` or `/index.html` exclusively without query parameters or hash routers that might alter startup fetch behaviors.

### Deepseek

#### Inline marks

> DEEPSEEK: The actual code is `workers: process.env.PW_WORKERS ? parseInt(process.env.PW_WORKERS, 10) || 1 : 1`. The `??` version is a simplified rewrite, but the `parseInt` path means non-numeric `PW_WORKERS` values silently fall back to 1 worker — a behavioral detail worth preserving in approach.md if the installer needs to validate parallel safety.

> DEEPSEEK: Verified existing cloud-sync specs stub `window.pushSyncVault = async () => {}` (line 103 of `cloud-sync-header-button.spec.js`), confirming no real Dropbox calls fire. The discovery's `@network` search suggestion (`rg 'cloud_token' tests/playwright`) would be a good supplementary check for approach.md.

#### Review section

### Verified

- **`playwright.config.js`**: Confirmed `fullyParallel: false`, `serviceWorkers: "block"`, `webServer` (python3 http.server on port 3000), and `workers` wiring. Actual `workers` code uses `parseInt` ternary (`playwright.config.js:6`), not `??`.
- **`package.json`**: Confirmed `test:offline` script is `npx playwright test --grep-invert @network` (`package.json:14`).
- **`@network` tags**: Confirmed exactly 4 `@network` occurrences in `tests/playwright/01-page-load/page-load.spec.js`.
- **Test count baseline**: Confirmed 643 `test(` calls across all spec files, 90 `test.describe` blocks, 0 `page.goto` in `config-validation.spec.js`, 45 tests in `about-page.spec.js`, 94 tests in `config-validation.spec.js` (= 139 browser-free tests).
- **Seed isolation**: Confirmed `tests/fixtures/seed-inventory.js` contains only `metalInventory` and `inventorySerial` — no `cloud_token_*`, no `catalog_api_config`, no API keys. `helpers/seed.js` adds only `ackVersion` via `addInitScript`.
- **About page safety**: Confirmed `about.html` has **zero** `<script>` tags (not just "zero external script src" — it has no scripts at all).
- **API base URL constants**: Confirmed `js/constants.js:18` (legacy API), `:332` (exchange rate), `:533-534` (v2 primary + fallback). All match discovery claims.
- **`market-data.js` fetch endpoints**: Confirmed lines 96, 513-531, 545, 970, 1403 match the claimed fetch surface.
- **`index.html` CDN import**: Confirmed lightweight-charts at `index.html:335`.
- **Mocked file inventory**: All 12 files with `page.route` confirmed via live filesystem scan.
- **Unmocked file count**: 44 spec files without `page.route` (confirmed via live scan). 56 total spec files.
- **Cloud-sync stubs**: Confirmed `cloud-sync-header-button.spec.js` stubs `window.pushSyncVault = async () => {}` at line 103; uses `window.syncNow()` which would otherwise fire real Dropbox calls.
- **V2 API mock envelope**: Confirmed `{ v: 2, generated_at, data: ... }` shape in `market-sorting.spec.js:258-283` matches discovery description.
- **Gemini Q5 resolution**: Verified the Gemini finding is correct — cloud-sync specs stub the sync execution methods, not the tokens alone.

### Top Concerns

1. **Response shape fidelity vs "real-enough" data (AC-1 audit risk)**: The discovery notes mocks should "mirror real-world response shape" but "values themselves can be pinned constants." Some app assertions rely on dynamic data (e.g., `generated_at` freshness, `data` nested structure depth). If the pinned constants are semantically stale (e.g., `generated_at` from 2023), tests may pass with stubs but the real API would produce different behavior. **Recommend approach.md define a fixture freshness contract**: `generated_at` must be within some window of "now," and spot-history shape must match `data/spot-history-bundle.js` structure.

2. **Route precedence hazard with dual installers (global + per-spec)**: The discovery correctly notes Playwright resolves routes by last-registered. If approach.md chooses a custom `test.extend` fixture that installs the global deny set, and a spec then calls `page.route` for a per-slug extension, the spec's route will take precedence over the global. But the inverse — a fixture installed AFTER a spec's `beforeEach` — would break silently. **Approach.md must prescribe a strict registration order**: global deny set FIRST, then per-spec extensions. A custom fixture makes this enforceable; bare helper functions do not.

3. **`attachments/cloud-sync.spec.js` not independently verified**: Q5 was resolved by Gemini's review for `cloud-sync-header-button.spec.js` and `03-settings/settings-cloud-tab.spec.js`, but `attachments/cloud-sync.spec.js` and `view-modal-no-auto-resync.spec.js` were not independently checked for post-OAuth token simulation. The discovery and Gemini review assume they follow the same stubbing pattern. **Recommend approach.md include a grep audit step** before declaring the cloud-storage mock family unnecessary.

### DEEPSEEK — Unverified Assumptions

- **Cold-start fan-out is exhaustive for all 42 non-browser-free specs**: Some specs click buttons / open modals after load (retail detail, catalog search, cloud-sync settings tabs). These user actions may trigger additional fetches beyond the 4-endpoint cold-start surface. The discovery classifies these as "per-spec extensions" but doesn't enumerate which specs need which extensions.
- **`data/spot-history-*.json` is always available locally**: Assumes `python3 -m http.server` serves these correctly. Under `fullyParallel: true` with high worker counts, the static server could hit connection limits. The discovery mentions this as a "separate concern" but doesn't flag it as a potential flake source for the mock migration itself.
- **No test asserts on `generated_at` freshness or timestamp semantics**: If any test interrogates the `generated_at` field for recency (e.g., "should be within last hour"), a pinned 2023 date will break. The discovery's "values themselves can be pinned constants" may be too sweeping.
- **Catalog specs never fire real `api.numista.com` requests**: The discovery claims Numista endpoints are dormant by default because `catalog_api_config` is unset in the seed. This is correct, but one test (`numista-search.spec.js`) may set a configured key as part of its test flow. A grep for `setNumistaConfig` in catalog specs would resolve this.
- **`config-validation.spec.js` will never need route mocking**: This spec currently uses only `fs`/`path` (Node-side config reads). If future tests in this file add `page.goto` to verify config reflects in the UI, the file would need mocking retroactively. Low risk but worth noting for the scoping rule.
- **The 44 unmocked file count is static**: New specs may be added between this discovery and implementation. The count is a snapshot, not a target. Approach.md should define the rule programmatically ("all files lacking `page.route`") rather than by fixed list.
- **Consolidation doesn't introduce new fetch patterns**: If two specs are merged, their combined `beforeEach` setup may trigger fetches that neither triggered individually. The consolidation scoping rule should account for this.
- **`about-page.spec.js` has no `<script src>` to CDN**: Confirmed — `about.html` has ZERO `<script>` tags. More offline-safe than described.

### Resolution Summary

- Accepted: 9
- Rejected: 0
- Resolved with your input: 2 (Q5 disposition → resolve with audit caveat; Unverified assumptions → fold strongest into Constraints + new Q7)

### DEEPSEEK

#### Inline marks

_(see inline `> DEEPSEEK:` comments above — test-count discrepancy, cloud-sync network gap, numista-search catalog gap, view-modal-no-auto-resync classification)_

#### Review section

## DEEPSEEK Review (2026-05-15)

### Verified

- **playwright.config.js:1-21** — `fullyParallel: false`, `workers: parseInt(PW_WORKERS) || 1`, `serviceWorkers: "block"`, `webServer: python3 -m http.server 3000`. All match discovery claims. The `parseInt` → `|| 1` fallback for non-numeric `PW_WORKERS` is correctly documented.
- **package.json:13-14** — `test: npx playwright test`, `test:offline: npx playwright test --grep-invert @network`. Exact match.
- **@network tags** — 4 occurrences in `tests/playwright/01-page-load/page-load.spec.js:93,108,125,147`. Confirmed.
- **constants.js:332** — `EXCHANGE_RATE_API_URL = "https://open.er-api.com/v6/latest/USD"`. Confirmed.
- **constants.js:531-535** — `V2_API_ENDPOINTS = ["https://api.staktrakr.com/data/v2", "https://api2.staktrakr.com/data/v2"]`. Confirmed.
- **index.html:335** — CDN script tag for `cdn.jsdelivr.net/npm/lightweight-charts@4/...`. Confirmed.
- **about.html** — ZERO `<script>` tags anywhere in 940 lines. Confirmed via `grep -c '<script'` → 0.
- **about.html external links** — Lines 505-935: all are `<a href>` anchors (staktrakr.com, github.com, reddit.com, numista.com, pcgs.com, metals.dev). No `<script src>` or `<img src>` to external hosts. Browser will NOT fire network requests for anchor hrefs at page load. Confirmed safe.
- **tests/fixtures/seed-inventory.js** — Contains only `metalInventory` and `inventorySerial`. Zero `cloud_token_*`, zero `catalog_api_config`, zero `numista`/`pcgs`/`apiKey`/`bearer`. Confirmed.
- **tests/playwright/helpers/seed.js:1-23** — `injectSeedInventory` writes seed data to localStorage + stamps `ackVersion` via `addInitScript`. No cloud/catalog tokens. Confirmed.
- **56 total spec files, 12 with page.route, 44 without** — Live scan confirmed.
- **Live test( count: 643** — `grep -r 'test(' tests/playwright --include='*.spec.js' | wc -l` → 643. The reconciled discovery says 660 (from Codex) — 17-count discrepancy. See inline comment.
- **about-page.spec.js: 45 tests, config-validation.spec.js: 94 tests** — Confirmed via `grep -c 'test('`. 139 browser-free tests total.
- **config-validation.spec.js: zero 'page' references** — Confirmed node-side-only (fs/path config reads).
- **crud.spec.js:49-62** — Uses `sharedPage.goto("/index.html")` in `beforeAll`. Confirmed it would be missed by a literal `page.goto` scan. The discovery's revised classification (browser-page navigation behavior, not variable name) is correct.
- **Existing 12 mock files** — Verified live against `grep -rn 'page.route(' tests/playwright`. All 12 match the inventory table.
- **Catalog provider init safety** — `js/catalog-api.js:934-937`: `new NumistaProvider()` constructor is side-effect-free (no network). Cold-start `initializeProviders()` creates provider objects but does not call `searchItems()` or `lookupItem()`. Confirmed.
- **Cloud-sync header-button stubs** — `tests/playwright/cloud-sync-header-button.spec.js:103` sets `window.pushSyncVault = async () => {}`. Confirmed.
- **Catalog-api-key CA-5 path** — `tests/playwright/03-settings/catalog-api-key.spec.js:198-204`: only stubs `window.testNumistaAPI` for the API-test action path. Confirmed.
- **all 12 page.route files** — Verified each file's route patterns match inventory table. No new route families found.
- **api-health.js:126-152** — External fetches only from `fetchApiHealth()` triggered by settings UI; not cold-start. Confirmed safe.
- **image-cache.js:676-688** — Arbitrary image URLs fetched only by user action. Confirmed dormant on cold start.
- **cloud-sync.spec.js (attachments)** — Seeds `cloud_dropbox_account_id`, `cloud_token_dropbox`, `cloud_sync_enabled`, `cloud_vault_password` (lines 8-18). Navigates to `/index.html` (line 25). Has ZERO `page.route()` calls, ZERO `window.syncNow`/`window.pushSyncVault` stubs in the first describe block. The second describe block (line 58) also navigates to `/index.html` without route mocking. **This is a new gap not caught in prior reviews.** If the app's post-load init triggers cloud sync when `cloud_sync_enabled` is true and tokens are present, real Dropbox API calls escape unmocked.
- **view-modal-no-auto-resync.spec.js** — ZERO `page.route()` calls. Navigates to `/index.html`. Not the safe category — needs global installer.
- **numista-search.spec.js** — Seeds `catalog_api_config` with fake Numista key (line 63-74). Navigates to `/index.html` (line 78). ZERO `page.route()` calls. While the test only calls `buildNumistaSearchQuery` (pure), the catalog provider is initialized with `isNumistaEnabled() === true` on cold start. **Fragile — any init-path `searchItems()` call would escape unmocked.**
- **numista-picker-tags.spec.js** — ZERO `page.route()` calls. Navigates to `/index.html`. Needs global installer.
- **numista-not-configured.spec.js** — Has `beforeEach` but no `page.route()`. Needs global installer.

### Top concerns

1. **`attachments/cloud-sync.spec.js` has an unmocked Dropbox surface.** It seeds `cloud_token_dropbox`, `cloud_sync_enabled`, and `cloud_vault_password` before navigating to `/index.html` with zero route mocking and zero sync-method stubs (verified at `attachments/cloud-sync.spec.js:8-25`). The discovery already flagged this file for Q5 audit, but the prior reviewers (Gemini, Deepseek) only verified `cloud-sync-header-button.spec.js` and `settings-cloud-tab.spec.js`. The attachments spec was never checked — and it IS different. If the app's `cloud-sync.js` init (or any `DOMContentLoaded` handler) fires sync when a password is cached, this test produces real Dropbox HTTP traffic. approach.md must resolve this gap before declaring the cloud-storage mock family unnecessary.

2. **`numista-search.spec.js` initializes a full catalog provider without network mocking.** The test seeds `catalog_api_config.numista.apiKey` (line 63-69), navigates to `/index.html` (line 78), and `catalogAPI.initializeProviders()` creates a live `NumistaProvider` on cold start (confirmed at `js/catalog-api.js:934-937`). The current test happens to be safe because it only calls `buildNumistaSearchQuery` in `page.evaluate()` — a pure string builder — but any future init-path code that triggers `searchItems()` would fire real `fetch()` to `api.numista.com`. This is a latent network escape that global installer + audit hook would catch but the current unmocked state does not.

3. **Test count instability in discovery prose.** The reconciled counts say 660, but my live `grep` returns 643. Both the Codex (660) and Deepseek (643) prior reviews noted this discrepancy. The approach.md enumeration script must use Playwright's `--list` output, not grep, as the source of truth.

### DEEPSEEK — Unverified Assumptions

- **`attachments/cloud-sync.spec.js` first describe block doesn't trigger sync on init.** The test calls `loadDataSync("syncAttachments", null)` and reads `ALLOWED_STORAGE_KEYS` after navigation. These are localStorage reads — they should NOT trigger cloud sync. But the assumption that the cold-start code path will never invoke sync when `cloud_sync_enabled` is true + password is present needs code-level audit of `js/cloud-sync.js` init path.
- **`view-modal-no-auto-resync.spec.js` needs the global installer.** This spec has zero `page.route()` and navigates to `/index.html`. It should be classified in the ~343 unmocked app-loading tests, not overlooked as a special case.
- **`numista-picker-tags.spec.js` and `numista-not-configured.spec.js` need the global installer.** Both navigate to `/index.html` without route mocking and appear nowhere in the sub-classification table. They must be counted in the ~343 unmocked set.
- **The 4-endpoint cold-start deny set is still exhaustive.** Verified that no new external fetch surfaces have been added since the discovery was written (2026-05-15). However, the discovery's own Q5/Q7 audit grep commands have not been run — approach.md must execute them before locking the mock surface.
- **`spot-history-bundle.js` last updated 2026-05-14, APP_VERSION is 3.34.66.** The data is reasonably fresh. The fixture freshness concern from the prior Deepseek review remains valid — approach.md should encode the `generated_at` contract in code, not prose.
- **No spec asserts on `generated_at` recency.** Verified via `grep -rn 'generated_at' tests/playwright` — the field appears only in mock response bodies, never in assertions. The pinned-constant approach is safe today, but the fixture contract should still document the semantic constraint.

### Resolution Summary

- Accepted: pending reconciliation
- Rejected: pending reconciliation
- Resolved with your input: pending reconciliation
