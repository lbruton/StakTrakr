---
type: research
project: StakTrakr
status: draft
source: web-research
tags:
  - retail-scraper
  - providers
  - expansion
---
# New Items and Vendors Research

> **Status:** DRAFT — URLs need manual verification before backend integration
> **Date:** 2026-05-23
> **Context:** Post-release beta expansion. Add items to scraper backend first, hydrate API for ~2 weeks, then surface in beta UI.

## Current Scraper Landscape

### Tracked Items (11)
| Slug | Name | Metal | Weight (oz) |
|------|------|-------|-------------|
| ase | American Silver Eagle | Silver | 1.0 |
| age | American Gold Eagle | Gold | 1.0 |
| ape | American Platinum Eagle | Platinum | 1.0 |
| buffalo | Gold Buffalo | Gold | 1.0 |
| maple-silver | Silver Maple Leaf | Silver | 1.0 |
| maple-gold | Gold Maple Leaf | Gold | 1.0 |
| britannia-silver | Silver Britannia | Silver | 1.0 |
| krugerrand-silver | Silver Krugerrand | Silver | 1.0 |
| krugerrand-gold | Gold Krugerrand | Gold | 1.0 |
| generic-silver-round | Generic Silver Round | Silver | 1.0 |
| generic-silver-bar-10oz | Generic 10oz Silver Bar | Silver | 10.0 |

### Current Vendors (7)
apmex, sdbullion, jmbullion, monumentmetals, herobullion, bullionexchanges, summitmetals

---

## New Item 1: Peace Silver Dollar

- **Proposed slug:** `peace-dollar`
- **Metal:** Silver
- **Weight:** 0.7734 oz (90% silver, 26.73g total weight)
- **Notes:** Pre-1935 US coinage. Weight is NOT 1.0 oz — `weight_oz: 0.7734` in `provider_coins`. Random year / generic listing preferred over specific dates.

### Vendor URLs

| Vendor | URL | Status | Notes |
|--------|-----|--------|-------|
| APMEX | `https://www.apmex.com/product/170/1922-1925-peace-silver-dollar-bu-random-year` | NEEDS VERIFY | Random year, BU |
| SD Bullion | `https://sdbullion.com/peace-silver-dollar-coins-vg` | NEEDS VERIFY | VG condition |
| JM Bullion | `https://www.jmbullion.com/silver/silver-coins/silver-dollars/peace-dollars/` | NEEDS VERIFY | Category page — may need specific product URL |
| Monument Metals | `https://monumentmetals.com/pre1933-coins/peace-silver-dollars/peace-silver-dollar-raw.html` | NEEDS VERIFY | Raw/uncertified |
| Hero Bullion | `https://www.herobullion.com/peace-silver-dollar-coin-cull/` | NEEDS VERIFY | Cull condition |
| Bullion Exchanges | `https://bullionexchanges.com/buy-silver/junk-silver/peace-dollar` | NEEDS VERIFY | Category page — may need specific product URL |
| Summit Metals | NOT FOUND | — | No Peace Dollar product page found |

### Peace Dollar Notes
- Condition varies widely across dealers (BU vs VG vs Cull vs Raw) — prices won't be directly comparable without accounting for condition
- JM Bullion and Bullion Exchanges returned category pages, not individual product pages — may need manual navigation to find the generic listing
- Peace Dollars are "junk silver" / pre-1935 — different market dynamic than modern bullion

---

## New Item 2: 1 oz Silver Mexican Libertad

- **Proposed slug:** `libertad-silver`
- **Metal:** Silver
- **Weight:** 1.0 oz (.999 fine)
- **Notes:** Minted by Casa de Moneda de México. Random year preferred. Known for limited mintages and higher premiums than comparable sovereign coins.

### Vendor URLs

| Vendor | URL | Status | Notes |
|--------|-----|--------|-------|
| APMEX | `https://www.apmex.com/category/23976/1-oz-mexican-silver-libertad-coins-bu-proof` | NEEDS VERIFY | Category page — need random year product URL |
| SD Bullion | `https://sdbullion.com/2024-1-oz-mexican-silver-libertad-coin` | NEEDS VERIFY | 2024 specific year — check for random year listing |
| JM Bullion | `https://www.jmbullion.com/mexican-silver-libertad/` | NEEDS VERIFY | Random year, BU |
| Monument Metals | `https://monumentmetals.com/1-oz-mexican-silver-libertad-coin-rand.html` | NEEDS VERIFY | Random year |
| Hero Bullion | `https://www.herobullion.com/silver/silver-coins/mexican-silver-libertads/1-oz-mexican-silver-libertad-coins/` | NEEDS VERIFY | Category page — need specific product URL |
| Bullion Exchanges | `https://bullionexchanges.com/2024-1-oz-mexican-silver-libertad-coin-bu` | NEEDS VERIFY | 2024 specific year |
| Summit Metals | `https://summitmetals.com/products/1-oz-mexican-silver-libertad` | NEEDS VERIFY | Random year, BU |

### Libertad Notes
- All 7 dealers carry this product — excellent coverage
- Some dealers list by specific year (SD Bullion, Bullion Exchanges use 2024), others by random year — prefer random year URLs for stable long-term scraping
- APMEX and Hero Bullion returned category pages — need manual drill-down

---

## New Item 3: 1 oz Canadian Palladium Maple Leaf

- **Proposed slug:** `maple-palladium`
- **Metal:** Palladium
- **Weight:** 1.0 oz (.9995 fine)
- **Notes:** Royal Canadian Mint. First palladium item in StakTrakr. Completes the RCM Maple family (silver, gold, palladium). IRA-eligible. Limited mintage history (2005-2007, 2009, 2015+).

### Vendor URLs

| Vendor | URL | Status | Notes |
|--------|-----|--------|-------|
| APMEX | `https://www.apmex.com/product/32457/canada-1-oz-palladium-maple-leaf-bu-random-year` | NEEDS VERIFY | Random year, BU |
| SD Bullion | `https://sdbullion.com/1-oz-canadian-palladium-maple-leaf-coin-random-year` | NEEDS VERIFY | Random year |
| JM Bullion | `https://www.jmbullion.com/1-oz-canadian-palladium-maple-leaf/` | NEEDS VERIFY | Random year |
| Hero Bullion | `https://www.herobullion.com/palladium/` | NEEDS VERIFY | Category page only — need specific product URL |
| Bullion Exchanges | `https://bullionexchanges.com/1-oz-palladium-canadian-maple-leaf-random-year` | NEEDS VERIFY | Random year |
| Monument Metals | `https://monumentmetals.com/palladium/govt-minted-palladium-coins.html` | NEEDS VERIFY | Category page — need specific maple leaf URL |
| Summit Metals | NOT FOUND | — | Blog articles only, no palladium product pages |

### Palladium Notes
- 5 of 7 dealers have direct product pages; Hero Bullion and Monument Metals have category pages only
- Summit Metals does not appear to sell palladium products
- Palladium spot price is tracked in our spot data already — this adds retail premium tracking
- `capture.js` COINS env var will need `maple-palladium` added; palladium is NOT currently in the scrape loop

---

## New Vendor Research

### DefyTheGrid (defythegrid.com)

- **Domain:** defythegrid.com (confirmed)
- **Product catalog:** Gold (coins, bars, Aurum notes), Silver (coins, rounds, bars, Aurum notes), Platinum, Copper
- **Positioning:** Claims "lowest priced" bullion — positions as a competitive bullion dealer
- **International shipping:** Yes, with favorable rates
- **Assessment:** PROMISING — appears to be a competitive bullion dealer with standard product categories
- **Concerns:**
  - Smaller/newer dealer — verify reliability and pricing competitiveness
  - Need to check specific product pages for ASE, AGE, Maple Leaf, etc.
  - Unknown anti-bot posture (Cloudflare, etc.)
  - Need to verify prices are displayed without heavy JS rendering
- **Action needed:** Manual visit to verify product URLs for our tracked items, check pricing competitiveness, assess scrape-friendliness

### GovMint (govmint.com)

- **Domain:** govmint.com (confirmed)
- **Product catalog:** US Mint coins (Silver Eagles, Gold Eagles, etc.), world coins
- **Positioning:** Numismatic/collector dealer, NOT a competitive bullion dealer
- **Assessment:** NOT RECOMMENDED for price comparison scraper
- **Why:**
  - 2026 BU Silver Eagle listed at $95.95 — roughly 2-3x typical bullion dealer pricing
  - Focus on graded coins (PCGS MS70, NGC, First Strikes, special labels)
  - "Risk-free 30-day return policy excludes bullion-flagged items"
  - Premium pricing reflects numismatic/collector value, not bullion market premiums
  - Including GovMint would skew premium calculations and confuse users comparing competitive bullion prices
- **Verdict:** Skip — their pricing model is fundamentally different from our other vendors

---

## Implementation Plan

### Phase 1: Backend Integration (post-release, ~late May 2026)
1. Lonnie verifies all "NEEDS VERIFY" URLs manually
2. Fix category page URLs → find specific product pages
3. Add coins to `provider_coins` via `upsertCoin()`:
   - `peace-dollar` (weight_oz: 0.7734, metal: silver)
   - `libertad-silver` (weight_oz: 1.0, metal: silver)
   - `maple-palladium` (weight_oz: 1.0, metal: palladium)
4. Add verified vendor URLs via `upsertVendor()`
5. Update `capture.js` COINS env var to include new slugs
6. Deploy updated poller config
7. Monitor scrape results for ~2 weeks

### Phase 2: DefyTheGrid Evaluation (parallel with Phase 1)
1. Manual site evaluation — pricing, UX, scrape-friendliness
2. If suitable: collect product URLs for all 11+ items
3. Add as new vendor_id: `defythegrid`
4. Test scraping with existing capture pipeline

### Phase 3: Beta UI (~ mid-June 2026)
1. After 2 weeks of clean data hydration
2. Add new items to beta build market view
3. Add DefyTheGrid vendor column (if approved)
4. User testing before promoting to production

---

## Open Questions
- [ ] Peace Dollar condition variance — should we track BU, VG, or Cull? Different conditions = different price points
- [ ] Libertad year-specific vs random year — random year URLs are more stable for long-term scraping
- [ ] Should we add a 1 oz Gold Libertad as well while we're at it?
- [ ] DefyTheGrid — is it worth a deep dive, or wait until after the current items land?
- [ ] Any other popular items missing? (e.g., Philharmonic, Britannia Gold, Kangaroo/Kookaburra)
