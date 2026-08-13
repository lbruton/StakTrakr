---
title: "Vendor Quirks"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/vendor-quirks.md
migration_source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Vendor Quirks.md" # historical provenance; migrated 2026-08-12
updated: "2026-04-25"
---

# Vendor Quirks

Frontend-specific behaviors, display adaptations, and data normalization rules for each retail price vendor. This page documents how `js/retail.js`, `js/market-data.js`, and `js/retail-view-modal.js` handle the output produced by the StakTrakr pollers — it is **not** a scraping runbook. For scraping-side quirks, inspect `devops/pollers/` in this repository.

---

## Overview

Retail price data flows from `api.staktrakr.com/data/v2/` to the frontend through the v2 manifest and per-slug `latest.json` / `history-30d.json` envelopes. `js/market-data.js` renders the vendor comparison matrix; `retail-view-modal.js` renders the per-coin detail modal. Each vendor has a fixed display name, brand color, and homepage URL hardcoded in `js/retail.js`. Per-slug product page URLs are loaded from `providers.json` and overlay the homepage fallbacks.

Vendor identity in the frontend is always a short string key: `apmex`, `monumentmetals`, `sdbullion`, `jmbullion`, `herobullion`, `bullionexchanges`, `summitmetals`, `goldback`.

---

## Key Rules

1. **Retail prices honor display currency on active surfaces.** Retail source data remains USD, but active ticker, vendor grid, market detail, retail history, and Goldback settings surfaces format through the app's display-currency helpers. Non-USD vendor grids show a convenience-conversion footer because US-based vendors may still checkout in USD.

2. **Vendor display info resolves in priority order: manifest `_vendor_meta` → hardcoded `RETAIL_VENDOR_NAMES`/`RETAIL_VENDOR_COLORS`/`RETAIL_VENDOR_URLS`.** `getVendorDisplay(vendorId)` uses this chain. If a vendor appears in the poller output but not in the hardcoded maps, the vendor key is used as the label and the color falls back to `#6c757d` (gray).

3. **Product page URLs prefer `providers.json` over vendor homepages.** Matrix cells and retail-modal legend links use this resolution: `retailProviders[slug][vendorId]` → `RETAIL_VENDOR_URLS[vendorId]`. The `providers.json` file is fetched once per sync and cached in `localStorage` under `RETAIL_PROVIDERS_KEY`.

4. **OOS is a matrix and modal state, not a card-list sort rule.** `market-data.js` renders an `OOS` marker in the vendor comparison cell; `retail-view-modal.js` preserves OOS vendors in the legend when they have last-known data.

5. **Goldback has a separate local price cache.** `getGoldbackVendorPrice(slug)` reads `goldbackPrices`, not the retail vendor map.

---

## Vendor Behavior Table

| Vendor             | Display Name | Brand Color                | Frontend-Specific Notes                                                                    |
| ------------------ | ------------ | -------------------------- | ------------------------------------------------------------------------------------------ |
| `apmex`            | APMEX        | `#60a5fa` (bright blue)    | Most reliable; no known frontend display anomalies                                         |
| `jmbullion`        | JM           | `#fbbf24` (bright amber)   | History chart shows gaps when `inStock: false` on a day entry (`spanGaps: false`)          |
| `sdbullion`        | SDB          | `#34d399` (bright emerald) | No known frontend quirks                                                                   |
| `monumentmetals`   | Monument     | `#c4b5fd` (bright violet)  | No known frontend quirks                                                                   |
| `herobullion`      | Hero         | `#f87171` (red)            | Occasional legitimate OOS on `ape` (American Platinum Eagle)                               |
| `bullionexchanges` | BullionX     | `#f472b6` (bright pink)    | Legitimate OOS has occurred on `ape`; OOS state persisted in `retailAvailability`          |
| `summitmetals`     | Summit       | `#22d3ee` (bright cyan)    | No known frontend quirks                                                                   |
| `goldback`         | Goldback     | `#d4a017` (deep gold)      | Separate pipeline; injected separately from vendor map; staleness shown as `(stale)` label |

---

## OOS (Out-of-Stock) Detection — Frontend Side

OOS detection happens in the poller. The frontend reads and persists the OOS state.

**Data flow:**

1. `latest.json` for each slug contains `availability_by_site: { "apmex": true, "sdbullion": false, ... }`.
2. `syncRetailPrices()` merges this into `retailAvailability[slug]` and persists it via `saveRetailAvailability()` in `localStorage`.
3. Separately, `last_known_price_by_site` and `last_available_date_by_site` from `latest.json` are stored in `retailLastKnownPrices[slug]` and `retailLastAvailableDates[slug]`.

**Frontend OOS rendering:**

- In the **vendor comparison matrix** (`_buildVendorPriceCell` in `market-data.js`): an OOS vendor renders an `OOS` marker rather than a live price.
- In **retail view modal** (`_buildVendorLegend`): OOS vendors are rendered at 50% opacity. The price element uses `<del>` for the last known price plus a red `OOS` badge. The item title attribute carries the last available date.
- In the **daily history chart** (`openRetailViewModal`): when a history entry has `vendors[vendorId].inStock === false`, `null` is returned for that day's data point. `spanGaps: false` is set, so Chart.js renders a gap in the line (not an interpolated bridge).

**Persistence caveat:** `retailAvailability` is merged with `Object.assign` on each sync. Once a vendor is marked OOS in `localStorage`, it stays OOS until the next sync where `availability_by_site` explicitly sets it back to `true`. If the poller omits a vendor from `availability_by_site` entirely, the prior stored state persists.

---

## Price Parsing Edge Cases

These are frontend display-layer concerns, not scraping issues.

### Goldback Price Staleness

The Goldback vendor price is sourced via `getGoldbackVendorPrice(slug)`, which reads from the `goldback-spot.json` feed (a separate pipeline). If that feed is older than ~25 hours, `isStale: true` is returned. The frontend appends `(stale)` to the price display text and reduces opacity to 0.6 on the card row.

### Intraday Data: Forward-Fill for Chart Gaps

When a vendor is not polled in a given window (e.g., poller skipped or vendor was OOS for one window), the frontend applies **forward-fill** via `_forwardFillVendors()` in `retail-view-modal.js`. This carries the most recent seen price forward into gap windows. Forward-filled values are marked `_carriedVendors` on the window object. In the intraday table, carried values display as `~$XX.XX` in italic gray. In the intraday chart tooltip, carried values display with a `~` prefix.

**Multi-hop carry logic (STAK-498):** Chart lines distinguish between single-hop and multi-hop carries. A vendor carried from the immediately preceding window (single-hop — just one missed poll) renders as a **solid** line. Only carries where the previous window _also_ carried that vendor (2+ consecutive hours missing, multi-hop) render as **dotted** lines. This prevents most vendor lines from appearing dotted during normal polling gaps. Vendors with zero real (non-carried) prices across all bucketed windows are excluded from the chart entirely via the `qualifiedVendors` filter.

### Anomaly Detection — Intraday Spikes

The frontend applies a two-pass spike filter to intraday (15-min) data before chart/table rendering:

**Pass 1 — Temporal spike detection:** For each vendor at window `t`, if the neighbors (`t-1`, `t+1`) are within +/-5% of each other (stable neighborhood) but the current price deviates by more than 5% from their average, the point is treated as a scrape spike. The anomalous value is nulled for the chart (Chart.js gaps over it via `spanGaps: true`) but preserved in `_anomalyOriginals` for the table, where it displays with strikethrough and 45% opacity.

**Pass 2 — Cross-vendor median consensus:** For each window with 3+ vendors, any vendor deviating more than 40% from the median across that window is nulled. Catches multi-window vendor drift and extreme outliers.

Daily history is rendered from API aggregates. The retired card-list trend pipeline did not survive the card-list removal; do not add client-side interpolation to recreate it.

Threshold constants:

- `RETAIL_SPIKE_NEIGHBOR_TOLERANCE` — default `0.05` (5%)
- `RETAIL_ANOMALY_THRESHOLD` — default `0.40` (40%)

### History Chart: OOS Creates Gaps, Not Carries

In the daily history chart (`openRetailViewModal`), when a vendor entry has `inStock: false`, the chart dataset returns `null` for that day. `spanGaps: false` is used so Chart.js renders an actual gap in the line, not an interpolated bridge. This is the correct behavior — carried values would misrepresent availability.

The intraday chart uses `spanGaps: true` because short polling gaps are expected and bridging is preferred visually.

### Sync Log Time Formatting

The retail sync log table's Time column uses timezone-aware formatting via `TIMEZONE_KEY` from `localStorage`, matching the `_fmtIntradayTime` pattern used in `retail-view-modal.js`. If the stored timezone is invalid, it falls back to the browser's default locale formatting. This ensures consistent time display across the sync log and the retail view modal's intraday table.

### Price Field Shape Differences by Context

| Context                  | Field              | Source                                               |
| ------------------------ | ------------------ | ---------------------------------------------------- |
| Live price (card row)    | `vendorData.price` | `latest.json` → `priceData.vendors[id].price`        |
| History chart (daily)    | `vendorData.avg`   | `history-30d.json` → `entry.vendors[id].avg`         |
| Vendor comparison matrix | `vendorData.price` | Latest per-vendor value rendered by `market-data.js` |

Do not mix `.price` and `.avg` — they represent different aggregation windows.

### STRK-99: SDB + BE JSON-LD `offer.price` is the deepest bulk tier (2026-05-23)

SDB and Bullion Exchanges publish their Product `offer.price` as the deepest "As Low As" bulk-tier value (e.g. SDB silver maple `offer.price = "78.23"` is the 50+ tier, not the 1-unit $79.23 price). Neither vendor includes a tier-aware `priceSpecification` array with `eligibleQuantity.minValue === 1` and `appliesToPaymentMethod` set to wire/ACH. Believed to be an SEO / Google Shopping template change.

The retail poller's `extractJsonLdPrice()` enforces an `UNTRUSTED_OFFER_PRICE_VENDORS = new Set(["sdbullion", "bullionexchanges"])` denylist that skips the bare `offer.price` fallback for these two vendors. The zero-price OOS sentinel (STAK-475 P1) and a future tiered `priceSpecification` block are still honored.

Verified live 2026-05-23 via Playwright with real Chromium UA against `https://sdbullion.com/canadian-silver-maple-leaf-coin-random-year`.

### STRK-99 hotfix: BE Byparr returns the React shell (2026-05-23)

When `cf-clearance` Phase 2 fetches a Bullion Exchanges product page, Byparr returns the **un-hydrated React shell HTML** — the pricing grid is JavaScript-rendered AFTER Byparr's render window closes. The only `$XX.XX` values surviving in the resulting plain text are:

1. The spot ticker in `<header>` (silver `$75.92`, gold `$4,520.00`, etc.)
2. "As low as: $X" entries in the "Related Products" sidebar (different product)

Two mitigations in the poller:

- `htmlToPlainText()` drops `<nav>`, `<header>`, `<footer>` blocks the same way it drops `<script>`/`<style>` (`CHROME_OR_RAWTEXT_TAGS` set). A partial-name guard ensures `<nav-bar>`-style custom elements are not mis-identified as `<nav>` (Gemini PR #1148 review catch).
- For `UNTRUSTED_OFFER_PRICE_VENDORS`, `extractPrice()` uses pipe-table → tier-anchored prose only. `firstInRangePriceProse` is **not reachable** for these vendors, so spot tickers and sidebar prices can never poison the dashboard. Returns null when neither matcher hits — the dashboard records NULL (safe-OOS) rather than a wrong value.

### STRK-99 hotfix: SDB renders qty as `1 - 49` with whitespace around the dash

The tier-anchored extractor's regex MUST accept both `1-49` and `1 - 49`. The v1 regex required no spaces and silently skipped the first qty row, recording the bulk-tier `50+ $78.23` instead of the 1-unit `$79.23`. Production regex: `/\b(?:\d{1,3}\s*-\s*\d{1,5}|\d{1,3}\+)\s+\$\s*([\d,]+\.\d{2})/g` — the `\d{1,3}` low-side cap also excludes year ranges like `2024 - 2025` from false-matching.

---

## Vendor URL Resolution

Two-tier URL resolution is used everywhere a vendor is linked (grid card, list card chip, retail view modal legend):

```text
retailProviders[slug][vendorId]   // specific product page from providers.json
  || RETAIL_VENDOR_URLS[vendorId] // vendor homepage fallback
```

`providers.json` is fetched at the start of each sync. If the fetch fails or returns an error status, the frontend logs a warning and falls back silently to homepage URLs for all links. No user-visible error is shown for a providers fetch failure.

Vendor links always open in a named popup window (`retail_vendor_${vendorId}`) sized 1250x800. If the popup is blocked, `window.open(url, "_blank")` is used as fallback.

---

## Goldback Slug Parsing

Goldback slugs beyond the hardcoded `goldback-oklahoma-g1` entry are dynamically resolved by `_parseGoldbackSlug(slug)` in `js/retail.js`. The function parses the pattern `goldback-{state}-{denomination}` and looks up the weight from `GOLDBACK_WEIGHTS`.

Supported denominations: `g0.5` / `ghalf`, `g1`, `g2`, `g5`, `g10`, `g25`, `g50`.

If a goldback slug appears in the manifest that does not match this pattern, `getRetailCoinMeta()` returns a default object with `weight: 0` and `metal: "unknown"`, which causes the card to render without a metal badge and `0 troy oz` as the weight label.

---

## Common Mistakes

**Checking the wrong OOS state.** `retailAvailability[slug][vendorId] === false` means OOS. The default for a vendor not present in the map is treated as in-stock (`isAvailable = availability[key] !== false`). Do not use `=== true` to check in-stock status — a missing key is also in-stock.

**Assuming vendor price is always a number.** `vendorData.price` can be `null` (vendor polled but no price found) or `undefined` (vendor not present in this slug's vendor map). Always null-check before rendering.

**Editing `RETAIL_VENDOR_NAMES` without checking `RETAIL_VENDOR_COLORS` and `RETAIL_VENDOR_URLS`.** All three maps are keyed by the same vendor ID strings and must stay in sync. Adding a new vendor key to one but not the others results in undefined color (gray fallback) or missing homepage link.

**Expecting `retail.js` functions in `retail-view-modal.js`.** The modal file references `RETAIL_VENDOR_NAMES`, `RETAIL_VENDOR_COLORS`, `RETAIL_VENDOR_URLS`, `retailPrices`, `retailAvailability`, `retailLastKnownPrices`, `retailLastAvailableDates`, `retailIntradayData`, `retailPriceHistory`, and `retailProviders` as globals from `retail.js`. Script load order in `index.html` must place `retail.js` before `retail-view-modal.js`.

**Forgetting intraday cap.** `saveRetailIntradayData()` caps `windows_24h` to the last 96 entries per slug (24h of hourly data) before saving to `localStorage`. Any code that reads `retailIntradayData[slug].windows_24h` and expects more than 96 entries will be disappointed.

---

## Poller-Side: Vendor API Structures

This section documents how each vendor's website is structured for scraping purposes — tech stack, available APIs, authentication requirements, and known bot-detection characteristics. Scraping-side poller code lives in `devops/pollers/` in the StakTrakr repo.

### SD Bullion

- **Stack:** Magento 2 (traditional SSR)
- **Pricing API:** Unauthenticated REST endpoint at `/rest/V1/nfusions/cache/pricing` — returns the full catalog (~6,003 SKUs) with tiered pricing, cash/bitcoin/credit-card price breakdowns. Powered by nFusion Solutions pricing engine.
- **No bot detection on this endpoint.** Direct HTTP request works without cookies or session.
- **Note:** SD Bullion product pages redirect to `monumentmetals.com` (merger/acquisition — the two brands share a catalog).

### Bullion Exchanges

- **Stack:** Magento 2 PWA
- **Pricing API:** Full GraphQL API at `/graphql` with tiered wire/crypto/PayPal price breakdowns.
  - `route(url: "slug")` → returns product ID
  - `LivePrices(ids: [ID])` → returns tier pricing
- **Bot detection:** Cloudflare-gated. CF challenge blocks Docker headless Chromium. The block is **fingerprinting-based, not IP-based** — the same residential IP works from a Mac browser but fails from Docker. FlareSolverr or `curl_cffi` with exported `cf_clearance` cookies is required (see CF Bypass section below).

### Monument Metals

- **Stack:** Magento 2 + ScandiPWA (React PWA)
- **Pricing API:** GraphQL at `/graphql`, but **session-gated** — returns HTTP 403 without valid cookies from a prior page load.
  - `metalPrices` query → spot prices
  - `getProductDetailForProductPage` query → product pricing with tier breakdown
- **Fallback:** JSON-LD structured data (`schema.org/Product`) is present in SSR HTML with price and availability. Useful as a scrape-only fallback when the GraphQL session cannot be established.
- **Relationship with SD Bullion:** Monument Metals and SD Bullion share a catalog; SD Bullion product URLs redirect here.

### JM Bullion

- **Stack:** Next.js App Router with RSC streaming
- **Spot API:** `contentapi-managed.jmbullion.com/api/spot/summary` — unauthenticated, returns current spot prices.
- **Product pricing:** No dedicated product price API. Prices must be extracted from HTML scraping only.

### APMEX

- **Stack:** Traditional SSR
- **Pricing API:** No dedicated product price API endpoint.
- **Structured data:** JSON-LD (`schema.org/Product`) is embedded in product page HTML with `price` and `availability` fields. This is the primary extraction path.

### Hero Bullion

- **Stack:** WooCommerce
- **Pricing API:** WooCommerce REST API exists at `/wp-json/wc/v3/products` but returns **HTTP 401** (authentication required). No unauthenticated access.
- **Scraping approach:** HTML scraping or WooCommerce public storefront endpoints required.

---

## Cloudflare Bypass Strategy

Several vendors (primarily Bullion Exchanges, potentially others) sit behind Cloudflare's bot management. The following strategy applies when direct HTTP or headless Chrome is blocked.

### Current Tool: Byparr

- Drop-in replacement for FlareSolverr with the same HTTP API.
- Firefox-based (different browser fingerprint — useful if Chromium-based fingerprinting is specifically targeted).
- Integrated via `cf-clearance.js` in `devops/pollers/shared/`.

### Historical (deprecated): FlareSolverr nodriver fork

- **Image:** `21hsmw/flaresolverr:nodriver`
- **Interface:** HTTP API on port `8191`
- **Usage:** Send a POST request to `/v1` with `{"cmd": "request.get", "url": "..."}` — FlareSolverr solves the CF challenge and returns response body + cookies.
- **Cookie export:** The `cf_clearance` cookie can be extracted from the response and reused for subsequent requests to the same domain without triggering another challenge.
- **Status:** No longer integrated in current code. Byparr replaced it as the active CF bypass tool.

### cf_clearance Cookie Binding

`cf_clearance` cookies are bound to a **triple: IP address + User-Agent string + TLS fingerprint**. All three must match between the FlareSolverr session that solved the challenge and the subsequent requests reusing the cookie. Mismatches result in an immediate new CF challenge.

- Use `curl_cffi` (not Python `requests` or `httpx`) for HTTP calls that reuse `cf_clearance` cookies. `curl_cffi` uses `curl`'s TLS stack, which produces a browser-compatible TLS fingerprint. Standard Python HTTP libraries use a Python-native TLS stack that does not match browser fingerprints and will fail CF re-validation.
- Rotate cookies proactively — `cf_clearance` has a finite TTL and will eventually expire, requiring a new FlareSolverr solve pass.

> **Warning:** `cf_clearance` cookies solved from the home VM's residential IP will not work if requests are subsequently routed through a different IP (VPN, proxy, Cloud - Fly.io container). The solve and the requests must come from the same egress IP.

---

## Related

- Retail Pipeline — end-to-end data pipeline from poller to frontend
- Providers Config — `providers.json` schema and per-slug product URL mapping
- Goldback Pipeline — separate goldback pricing pipeline
