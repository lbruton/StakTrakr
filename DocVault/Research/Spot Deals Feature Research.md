---
type: research
project: StakTrakr
status: draft
source: web-research
tags:
  - spot-deals
  - feature-planning
  - market-view
---
# Spot Deals Feature Research

> **Status:** DRAFT — Feature concept and competitive analysis
> **Date:** 2026-05-23
> **Context:** New tab in market block to surface at-spot and below-spot deals from tracked vendors. Ad-free alternative to findbullionprices.com.

## Feature Vision

A **Spot Deals** tab in the market matrix view that aggregates:
1. **New customer at-spot promotions** — one-time deals from each vendor (silver/gold at spot price for first-time buyers)
2. **Daily lowest-premium items** — products closest to spot across all vendors (rotating inventory/sale items)
3. **Below-spot alerts** — junk silver or clearance items occasionally priced below melt value

### Why This Matters
- findbullionprices.com proves demand — they track 30+ dealers with hourly updates
- Their site is loaded with ads and affiliate tracking
- StakTrakr is free, open-source, community-built — we can offer the same value cleanly
- Users already visit our market view to compare prices — spot deals are a natural extension

---

## Competitive Analysis: findbullionprices.com

### What They Do Well
- Real-time price comparison across 30+ dealers
- Dedicated pages for at-spot deals (silver + gold), closest-to-spot by category
- Premium-over-spot calculation per product (dollar amount and percentage)
- Weekly updates on deal availability
- Blog content explaining how to combine at-spot deals across dealers to build a starter portfolio

### What We Can Do Better
- **No ads** — their pages are cluttered with display ads and affiliate trackers
- **Integrated with our existing market view** — users don't need a separate site
- **Real-time spot price from our own feed** — we already track spot prices for gold, silver, platinum (and soon palladium)
- **Smarter premium calculations** — we already have `weight_oz` per coin, enabling accurate $/oz-over-spot even for fractional items like Peace Dollars (0.7734 oz)
- **Open source transparency** — users can see exactly how premiums are calculated

### What They Do That We Should Study Further
- They claim "AI indexing and search features" for deal discovery
- They track 30+ dealers vs our 7 (but our 7 are the top-tier ones)
- They have gold-at-spot deals pages too, not just silver

---

## Vendor Deal Pages — Scrapable Surfaces

### APMEX (apmex.com)
| Page | URL | Type | Notes |
|------|-----|------|-------|
| New customer at-spot | `/new-customer-at-spot-offer` | First-time only | Select silver at spot, limit per customer |
| Silver bar at spot | `/product/295995/1-oz-silver-bar-apmex-at-spot` | Product page | 1 oz bar, no premium, limit 2 |
| Silver round at spot | `/product/150810/1-oz-silver-round-apmex-at-spot-new-customer-offer` | Product page | 1 oz round, limit 5 |
| Vault Deals | `/deals` | Rotating sale | Discounted bullion, changes weekly |

### SD Bullion (sdbullion.com)
| Page | URL | Type | Notes |
|------|-----|------|-------|
| Silver at spot (landing) | `/silver-at-spot-price` | Landing page | New customer offer overview |
| Buy silver at spot | `/buy-silver-at-spot` | Product page | 5 oz silver at spot, one per household |
| Weekly deals | `/deals` | Rotating sale | Gold, silver, platinum, palladium on sale |

### JM Bullion (jmbullion.com)
| Page | URL | Type | Notes |
|------|-----|------|-------|
| Buying guide | `/investing-guide/pricing-payments/buy-gold-silver-spot-price/` | Guide page | Mentions at-spot offers for new customers |
| On sale | `/on-sale/` | Rotating sale | Markdown items, "At Spot Deal - Limit 20!" visible |

### Monument Metals (monumentmetals.com)
| Page | URL | Type | Notes |
|------|-----|------|-------|
| 5 rounds at spot | `/5-silver-rounds-at-spot.html` | Product page | Starter pack, 5 rounds |
| 10 rounds at spot | `/10-silver-rounds-at-spot.html` | Product page | Starter pack, 10 rounds |

### Hero Bullion (herobullion.com)
| Page | URL | Type | Notes |
|------|-----|------|-------|
| At spot (or below) | `/deals/gold-silver-at-spot/` | Deal page | May show "back in stock" notification |
| Deals hub | `/deals/` | Rotating | Low-premium picks, sale items |

### Bullion Exchanges (bullionexchanges.com)
| Page | URL | Type | Notes |
|------|-----|------|-------|
| Silver at spot | `/silver-at-spot` | Deal page | Dedicated at-spot listings |
| Silver below spot | `/gold-silver-below-spot/silver-below-spot` | Deal page | Below-melt items |
| Gold & silver below spot | `/gold-silver-below-spot` | Hub page | Combined below-spot hub |

### Summit Metals (summitmetals.com)
| Page | URL | Type | Notes |
|------|-----|------|-------|
| Starter packs | `/collections/summit-starter-packs` | Collection page | Silver at spot for new customers |

---

## Deal Categories

### 1. New Customer At-Spot Promos
These are one-time loss-leader offers to attract new customers. Most dealers have them.

| Dealer | Product | Quantity | Restrictions |
|--------|---------|----------|--------------|
| APMEX | 1 oz silver bar or round | Limit 2-5 | New customer, one per household |
| SD Bullion | 5 oz silver (rounds or bars) | 5 oz | New customer, one per household, silver OR gold not both |
| JM Bullion | Varies | Limit 20 | New customer |
| Monument Metals | 5 or 10 silver rounds | 5-10 rounds | New customer |
| Hero Bullion | Silver rounds starter pack | Varies | New customer, may be out of stock |
| Bullion Exchanges | Varies | Varies | Dedicated at-spot page |
| Summit Metals | Starter pack | Varies | New customer |

### 2. Rotating Sale / Low-Premium Items
These change weekly or when inventory needs clearing.

| Dealer | URL | Update Frequency |
|--------|-----|-----------------|
| APMEX | `/deals` | Weekly |
| SD Bullion | `/deals` | Weekly |
| JM Bullion | `/on-sale/` | Weekly |
| Hero Bullion | `/deals/` | Ongoing |
| Bullion Exchanges | `/gold-silver-below-spot` | Ongoing |

### 3. Below-Spot / Below-Melt Opportunities
Primarily junk silver (90% pre-1965 US coins) when market conditions favor it.

| Dealer | URL |
|--------|-----|
| Bullion Exchanges | `/gold-silver-below-spot/silver-below-spot` |

---

## Technical Approach (Preliminary)

### Data Model
```
spot_deals table:
  id            INTEGER PRIMARY KEY
  vendor_id     TEXT NOT NULL
  deal_type     TEXT NOT NULL  -- 'at_spot', 'below_spot', 'low_premium', 'new_customer'
  product_name  TEXT NOT NULL
  product_url   TEXT NOT NULL
  metal         TEXT           -- gold, silver, platinum, palladium
  weight_oz     REAL
  price         REAL           -- current listed price (null if dynamic)
  premium_pct   REAL           -- calculated premium over spot (null = at spot)
  restrictions  TEXT           -- "new customer only", "limit 5", etc.
  in_stock      INTEGER        -- 1 = in stock, 0 = out of stock
  last_checked  TEXT           -- ISO timestamp
  first_seen    TEXT           -- when deal was first detected
  expired       INTEGER DEFAULT 0
```

### Scraping Strategy
Two scrape tiers:

1. **Static pages** (at-spot promos) — these rarely change. Scrape daily or on-demand. Just need to detect in-stock vs out-of-stock.
2. **Dynamic pages** (deals/on-sale) — these rotate weekly. Scrape 1-2x daily. Need to extract product name, price, and calculate premium over current spot.

### Frontend Display
- New tab in market matrix view: **"Spot Deals"**
- Card or table layout showing:
  - Vendor logo/name
  - Product name
  - Deal type badge (AT SPOT / BELOW SPOT / LOW PREMIUM)
  - Price (or "At Spot Price")
  - Premium over spot (calculated live)
  - Restrictions (new customer, limit, etc.)
  - In-stock indicator
  - Direct link to vendor page

### Open Architecture Questions
- [ ] Should deals scraping be part of the existing capture.js pipeline or a separate script?
- [ ] Should we use Firecrawl extraction (structured data from HTML) or Playwright screenshot + vision (like current retail pipeline)?
- [ ] How to handle JS-heavy dealer pages (Monument Metals requires JS for everything)
- [ ] Refresh frequency: daily for promos, 2x daily for rotating deals?
- [ ] Do we store historical deal data for trend analysis?

---

## Implementation Phases

### Phase 1: Static Deal Registry (manual curation)
- Hardcode the known at-spot promo URLs into a JSON config
- Scrape each daily for in-stock/out-of-stock status only
- Display as a simple card view in a new market tab
- Low engineering effort, immediate user value

### Phase 2: Dynamic Deal Scraping
- Build extraction rules for each vendor's deals/on-sale page
- Parse product names, prices, calculate premiums vs live spot
- Store in sqld for historical tracking
- Sort by premium (lowest first)

### Phase 3: Smart Aggregation
- Combine at-spot promos + low-premium items into a unified feed
- Add "below melt" detection for junk silver
- Premium trend tracking (is this a good day to buy?)
- Optional: alert/notification when new deals appear

---

## Open Questions
- [ ] Should this feature have its own Plane issue, or is it part of a larger market-view enhancement?
- [ ] Do we want to track deal URLs for the new vendors (DefyTheGrid) too?
- [ ] Legal/ethical: are there any concerns with linking to competitor deals pages? (Probably not — findbullionprices does it openly with affiliate links; we'd just be linking with no affiliate tracking)
- [ ] Should the deals tab show ALL vendors or only ones with active deals?
- [ ] How do we handle the "new customer only" restriction in the UI? Badge? Tooltip?
- [ ] Should we calculate "total portfolio at spot" like findbullionprices does (combine all new-customer deals across vendors)?

---

## References
- findbullionprices.com — primary competitive reference
  - Silver at spot deals: `findbullionprices.com/buy-silver-at-spot-deals.php`
  - Gold at spot deals: `findbullionprices.com/buy-gold-at-spot-price-deals.php`
  - Closest to spot: `findbullionprices.com/closest-to-spot/?category=silver`
  - Blog guide: `findbullionprices.com/blog/precious-metals-101-buy-the-spot-price-deals/`
- Barchart article on findbullionprices AI indexing approach
