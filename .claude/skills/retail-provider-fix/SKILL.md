---
name: retail-provider-fix
description: Use when retail prices are failing for a vendor — wrong prices, fractional_weight warnings, all-zeros for a provider, page-loaded-no-price errors, or after suspecting a dealer changed their site structure. Covers live Firecrawl diagnostics, interpreting extraction failures, and updating price-extract.js and providers.json.
---

# Retail Provider Fix

Diagnose and fix scraping failures for individual dealers in the StakTrakr retail pipeline.
All code lives in `StakTrakrApi/devops/fly-poller/`. All URL config is in `providers.json` on the `api` branch.

---

## Step 1 — Live Firecrawl Diagnostic

Run directly inside the Fly.io container against the self-hosted Firecrawl at `localhost:3002`:

```bash
# Substitute URL from providers.json for the failing vendor/coin
fly ssh console -a staktrakr -C "curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{\"url\":\"PROVIDER_URL_HERE\",\"formats\":[\"markdown\"],\"waitFor\":6000,\"onlyMainContent\":false}' \
  | python3 -c \"import sys,json; d=json.load(sys.stdin); \
    md=d.get('data',{}).get('markdown',''); \
    w=d.get('data',{}).get('warning',''); \
    print('WARNING:',w); print('LEN:',len(md)); print(md[:5000])\""
```

For home poller on the Portainer VM, use the Portainer REST API to exec into the container or check logs — see `home-infrastructure` skill.

---

## Step 2 — Interpret the Output

| Symptom                                 | Meaning                                                    | Fix category                                                      |
| --------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `warning: waitFor not supported`        | Self-hosted Firecrawl ignores `waitFor` — JS never renders | Force Playwright path (see §4)                                    |
| Markdown contains only `"Loading..."`   | Product table is JS-rendered, not in static HTML           | Force Playwright path                                             |
| Redirected to homepage URL in metadata  | Bot detection — page is blocked                            | Playwright + residential proxy (see §5)                           |
| Spot prices appear before product price | `MARKDOWN_HEADER_SKIP_PATTERNS` not matching               | Update header skip regex (see §3)                                 |
| `fractional_weight — 1/4 oz`            | Scraper found a fractional nav price before product price  | Update `MARKDOWN_CUTOFF_PATTERNS` or force Playwright             |
| `page loaded, no price`                 | Page renders but extraction regex doesn't match            | Update `extractPrice` logic for that provider                     |
| `out_of_stock — PRE-ORDER`              | Correct; item actually on pre-order                        | No fix needed unless provider is in `PREORDER_TOLERANT_PROVIDERS` |

---

## Step 3 — Config Map in `price-extract.js`

All extraction config is in `StakTrakrApi/devops/fly-poller/price-extract.js`.

| Config                          | Line ~ | What it does                                                                                   |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| `SLOW_PROVIDERS`                | 474    | Adds `waitFor:6000` to Firecrawl AND `waitForTimeout(8000)` in Playwright fallback             |
| `MARKDOWN_HEADER_SKIP_PATTERNS` | 157    | Regex matching the site header/nav — cuts everything BEFORE the match                          |
| `MARKDOWN_CUTOFF_PATTERNS`      | 132    | Array of regexes — cuts everything AFTER the first match (removes related products, carousels) |
| `PREORDER_TOLERANT_PROVIDERS`   | 134    | Providers where "Pre-Order" text should NOT count as OOS                                       |
| `USES_AS_LOW_AS`                | 117    | Providers that use "As Low As" as their primary price indicator (currently empty)              |
| `FBP_DEALER_NAME_MAP`           | 196    | Maps FindBullionPrices dealer display names → provider IDs                                     |
| `onlyMainContent`               | 485    | Firecrawl flag — set `false` for JMBullion to avoid missing the price table                    |

**URL changes go in `providers.json` on the `api` branch** — NOT in price-extract.js.
Both pollers auto-sync providers.json before every run via `curl ... /api/data/retail/providers.json`.

---

## Step 4 — Self-Hosted Firecrawl `waitFor` Not Supported

**This is the current state** (confirmed Feb 2026): The self-hosted Firecrawl container does not support the `waitFor` parameter. It returns the static/pre-render HTML immediately.

**Consequence**: All JS-heavy SPAs (JMBullion, BullionExchanges, Monument Metals) get unrendered HTML from Firecrawl. Monument Metals and HeroBullion recover via the Playwright fallback. JMBullion does NOT recover because `fractional_weight` detection fires on the pre-render content and exits without triggering Playwright.

**Fix options** (in order of preference):

1. **Upgrade Firecrawl** to a version that supports `waitFor` — check `ghcr.io/firecrawl/firecrawl:latest` changelog
2. **Force Playwright path for specific providers** — add them to a `PLAYWRIGHT_ONLY_PROVIDERS` set that skips Firecrawl entirely
3. **Treat `fractional_weight` as Playwright trigger** — same as `price === null` in the fallback condition

---

## Step 5 — Bot Detection (BullionExchanges Pattern)

When Firecrawl returns a redirect to the site's homepage with only a banner image, bot detection is active.

**Diagnosis**: `url` in response metadata differs from `sourceURL`. e.g., `sourceURL` = product page, `url` = `bullionexchanges.com`.

**Current status**: BullionExchanges redirects ALL headless browser requests to homepage.

**Fix options**:

- Playwright with residential proxy chain (`HOME_PROXY_URL_2` → Webshare) — verify tinyproxy `ConnectPort` allows 443
- Add browser stealth headers: real user-agent, `Accept-Language`, `Sec-Fetch-*` headers
- If Tailscale exit node is active, ALL traffic routes via home residential IP — verify `tailscale status` in container before debugging further

---

## Step 6 — Test Single Vendor (Dry Run)

From inside the container or home LXC:

```bash
# Fly.io — SSH in then run
fly ssh console -a staktrakr
cd /app
DATA_DIR=/data/staktrakr-api-export/data \
FIRECRAWL_BASE_URL=http://localhost:3002 \
PLAYWRIGHT_LAUNCH=1 \
COINS=ase PROVIDERS=jmbullion \
DRY_RUN=1 node price-extract.js

# Filter to multiple vendors
COINS=ase,age PROVIDERS=jmbullion,bullionexchanges DRY_RUN=1 node price-extract.js
```

A successful result shows `✓ jmbullion: $XXX.XX (playwright)` or `✓ jmbullion: $XXX.XX (firecrawl)`.

---

## Step 7 — Deploy the Fix

After verifying the fix in dry-run:

```bash
# Fly.io — redeploy container (required for price-extract.js changes)
cd /Volumes/DATA/GitHub/StakTrakrApi/devops/fly-poller
fly deploy -a staktrakr

# Home LXC — no deploy needed; run-home.sh reads price-extract.js directly
# Just commit + pull on the home server:
# git pull origin main && (restart cron if needed)

# providers.json URL changes — push to api branch
git checkout api
# edit data/retail/providers.json
git add data/retail/providers.json && git commit -m "fix(providers): update VENDOR urls"
git push origin api
# Both pollers pick this up automatically on next run (no redeploy needed)
```

---

## Common Provider Failure Patterns

### JMBullion — `fractional_weight`

**Cause**: Firecrawl's `waitFor` not supported → product table renders as "Loading..." → no price → but header skip exposes fractional nav links or spot prices that trigger false `fractional_weight` detection.
**Fix**: Force Playwright path; verify `MARKDOWN_HEADER_SKIP_PATTERNS.jmbullion` still matches the header timestamp format.

### BullionExchanges — `page loaded, no price`

**Cause**: Bot detection redirects to homepage; Firecrawl gets one-line banner. Playwright fallback also redirected.
**Fix**: Check tinyproxy HTTPS CONNECT config; use Playwright with stealth headers.

### Monument Metals — `out_of_stock — PRE-ORDER`

**Cause**: Coin legitimately on pre-order (common for new-year coins Jan–Mar).
**Fix**: Update providers.json URL to a different in-stock coin, OR wait for inventory to arrive.

### SDB — wrong price from "Add on Items" carousel

**Cause**: `sdbullion` was in `USES_AS_LOW_AS`; carousel prices bled through.
**Fix (applied 2026-02-20)**: `sdbullion` removed from `USES_AS_LOW_AS`; `MARKDOWN_CUTOFF_PATTERNS.sdbullion` added.

---

## Firecrawl Engine Capabilities (Self-Hosted)

The self-hosted container uses Firecrawl's `basic` engine (not `playwright`). Capabilities:

| Feature                | Supported                                  |
| ---------------------- | ------------------------------------------ |
| Static HTML fetch      | ✅                                         |
| `waitFor` (JS wait)    | ❌ (silently ignored, warning in response) |
| `onlyMainContent`      | ✅                                         |
| `formats: markdown`    | ✅                                         |
| Proxy (`PROXY_SERVER`) | ✅ via playwright-service                  |
| `BLOCK_MEDIA`          | ✅ via playwright-service env              |

To check current Firecrawl version in container:

```bash
fly ssh console -a staktrakr -C "node -e \"const p=require('/opt/firecrawl/package.json'); console.log(p.version)\""
```
