# StakTrakr — Domain Glossary

Precious metals portfolio tracker (vanilla JS PWA).

## Inventory & Items

**Item**:
A single inventory record representing one or more identical pieces of precious metal or currency. Identified by a UUID.
_Avoid_: lot, stack, piece, entry

**Serial**:
An auto-incrementing integer assigned to each Item for human-readable ordering.
_Avoid_: ID, index, sequence number

**Inline Chip**:
A compact metadata badge rendered inside inventory table cells showing key item attributes at a glance.
_Avoid_: tag chip, badge, pill

**Filter Chip**:
A clickable category toggle in the toolbar that narrows the inventory view by metal, type, or custom group.
_Avoid_: filter button, category filter

**Tag**:
A user-defined label attached to one or more Items for flexible categorization. Stored separately from the Item record in a UUID-keyed map.
_Avoid_: label, category

## Disposition & Lifecycle

**Disposition**:
The record of how an Item left active inventory — sold, traded, lost, or gifted. Tracks realized value and date.
_Avoid_: disposal, removal, exit

**Trade Link**:
A bidirectional reference between a disposed-traded Item and the Item(s) received in exchange. Uses `tradedForUuids`.
_Avoid_: trade reference, swap link

**Partial-Stack Disposition**:
Disposing of fewer than all units in a multi-quantity Item, splitting the original record into disposed and remaining portions.
_Avoid_: partial sale, split, partial disposal

**Change Log**:
A persistent, undoable history of every field-level modification to any Item. Stored in localStorage as a compressed array.
_Avoid_: audit log, edit history, activity log

## Market Data & Pricing

**Spot Price**:
The current per-troy-ounce market price for a precious metal (gold, silver, platinum, palladium), sourced from a configured Spot Provider.
_Avoid_: market price, live price, melt value

**Spot Provider**:
An external API source for spot prices. One of: STAKTRAKR, METALS*DEV, METALS_API, METAL_PRICE_API, GOLD_API, CUSTOM, or MANUAL. Configured in the `metalApiConfig` store.
\_Avoid*: API source, price feed, data source

**Premium**:
The per-ounce price difference between what was paid for an Item and the spot price at time of purchase. Calculated as `(price / weight) - spotPrice`.
_Avoid_: markup, over-spot, spread

**Spot Bundle**:
Pre-built yearly JSON files (`data/spot-history-{year}.json`) that seed the Spot History on first load without requiring API calls.
_Avoid_: seed data, history bundle, bootstrap data

**Spot History**:
A time-series of hourly and daily spot prices stored in localStorage under `metalSpotHistory`. Used for charts and historical valuation.
_Avoid_: price history, historical prices

**Vendor**:
A retail dealer whose real-time coin/bar pricing is tracked by the retail pipeline. Identified by a slug.
_Avoid_: dealer, retailer, shop, seller

**Retail View**:
The modal showing live dealer prices, intraday charts, and 30-day history for a specific bullion product across multiple Vendors.
_Avoid_: market view, dealer view, price comparison

## Goldback

**Goldback**:
A voluntary local currency note containing a measured amount of gold in a polymer bill. Priced by denomination (1, 5, 10, 25, 50) rather than by troy ounce.
_Avoid_: gold note, gold bill

**Goldback Estimate**:
A calculated fair-market value for a Goldback denomination derived from the gold spot price, the Goldback-to-gold-gram rate (G1 rate), and an optional modifier.
_Avoid_: estimated price, calculated price

## Catalog & Enrichment

**Catalog Provider**:
An external numismatic database (Numista or PCGS) used to enrich Items with mintage data, images, composition, and grading. Configured in the `catalog_api_config` store.
_Avoid_: data provider, lookup service, enrichment API

**Numista Data**:
The nested object on an Item (`item.numistaData`) containing fields pulled from the Numista catalog — year range, composition, shape, images, and catalog ID.
_Avoid_: catalog data, coin data, enrichment data

## Cloud & Storage

**Cloud Sync**:
The Dropbox-backed system that encrypts (AES-GCM), uploads, and restores complete inventory snapshots. Supports atomic rollback on restore failure.
_Avoid_: backup, Dropbox sync, cloud backup

**Dual Config Store**:
The architecture where spot provider keys live in `metalApiConfig` (via `loadApiConfig`/`saveApiConfig`) and catalog provider keys live in `catalog_api_config` (via `catalogConfig`). Confusing the two stores causes silent data loss.
_Avoid_: config store, API config

## App Infrastructure

**Feature Flag**:
A runtime toggle (`FeatureFlags` class) that gates experimental or beta functionality. Persisted in localStorage, overridable via URL parameters.
_Avoid_: feature toggle, experiment, beta flag

## Relationships

- An **Item** has zero or one **Disposition**. A Disposition makes the Item inactive.
- A **Disposition** of type "traded" may have one or more **Trade Links** to other Items.
- A **Partial-Stack Disposition** splits one **Item** into two: disposed and remaining.
- Each **Item** has zero or more **Tags**. Tags are stored in a separate UUID-keyed map.
- A **Spot Provider** feeds **Spot Prices** into the system. Only one provider is active at a time.
- A **Catalog Provider** enriches an **Item** with **Numista Data** (or PCGS data).
- The **Dual Config Store** separates **Spot Provider** credentials from **Catalog Provider** credentials.
- The **Change Log** records every field-level mutation on every **Item**.

## Flagged Ambiguities

- "vendor" vs "dealer" vs "retailer" — resolved: use **Vendor** in code and UI. "Dealer" acceptable in user-facing prose.
- "item" vs "lot" vs "stack" — resolved: use **Item** for the data record. "Stack" is colloquial for a user's collection; never use as a code term for a single record.
- "disposal" vs "disposition" — resolved: use **Disposition**. "Disposal" implies waste; disposition tracks realized value.
- `metalApiConfig` vs `catalog_api_config` — resolved: these are the **Dual Config Store**. Always use the correct accessor pair.
