# StakTrakr v3.33 — Market Prices, Cloud Sync, Realized Gains, and 200+ Patches Since v3.30

Hey r/Silverbugs, r/Gold, r/Coins, r/staktrakr —

It's been a minute since the last big post (v3.30.02), and a *lot* has happened. This is the largest update cycle StakTrakr has ever shipped — over 200 patches across 4 minor releases — so grab a coffee and let me walk you through what's new.

**If you're new here:** [StakTrakr](https://www.staktrakr.com) is a free, open-source, privacy-first precious metals portfolio tracker. No account, no email, no data collection. Your entire inventory lives in your browser. It works offline, runs from a ZIP file, and every feature is free.

---

## The Big One: Market Prices Module (v3.33.87)

This is the headline feature of the v3.33 cycle. StakTrakr now tracks real-time retail prices from major bullion dealers and shows you who has the best price on the coins you care about.

**Best Price Ticker** — A scrolling ticker strip below the spot price cards showing the cheapest vendor per coin with premium percentages and direct buy links. One glance tells you where the deals are.

**Vendor Prices Table** — Full comparison matrix with tabs for Gold, Silver, Platinum, Palladium, and Goldbacks. Every vendor shows their current price, premium over spot, and a clickable link straight to their product page. This is the "who should I buy from right now?" view.

**Market Detail Modal** — Click any coin and get a TradingView-powered chart showing 7-day spot history with per-vendor price lines overlaid. See how each dealer's pricing moves relative to spot.

**Market List View** — Full-width cards with inline 7-day trend charts, color-coded vendor chips with medal rankings for best prices, and computed median/low/average stats. Filter by metal with pill buttons, toggle intraday trends, sort by name/metal/price/trend.

All of this is powered by the StakTrakr API — free, keyless, no signup required. The API scrapes major dealers hourly and publishes a self-describing manifest, so new coins appear automatically without app updates.

![StakTrakr Dashboard — Spot Prices, Ticker, Portfolio Summary](screenshots/01-hero-overview.png)

![Vendor Price Matrix — Side-by-side dealer comparison](screenshots/04-vendor-prices.png)

![Market Ticker — Best prices scrolling across the top](screenshots/03-market-ticker.png)

---

## Cloud Sync — Complete Overhaul (v3.33.00–v3.33.42)

Cloud sync went from "experimental" to "production-ready" across about 40 patches. This was a deep rework of the entire sync pipeline.

**DiffModal** — When remote changes arrive, you now see a full visual diff with item cards (bordered layout, metal-colored image placeholders, async image loading) and settings cards (grouped into 7 categories with human-readable labels). You can click individual fields to cherry-pick what to keep — local, remote, or a mix.

**Bi-directional sync** — The sync engine now correctly handles both push and pull with conflict detection. Pre-push remote checks prevent silent overwrites. Manifest-first polling detects changes without downloading the full vault.

**Settings sync** — Expanded from 8 to 44 synced keys. Your theme, chip configuration, API credentials, header button layout, feature toggles, and Numista/PCGS settings all sync across devices now.

**Image vault** — Photos sync across devices as an encrypted vault. Deletion propagates correctly — delete all photos locally and the remote vault gets cleaned up too.

**Safety improvements** — Cloud-side backup-before-overwrite on every push, configurable backup history depth (3/5/10/20), separate manual vs. sync backup management, multi-tab leader election via BroadcastChannel, empty-vault push guards, and encrypted sync metadata.

**Multi-account** — Switch Dropbox accounts with forced re-authentication. Connected account email displayed in settings.

---

## Realized Gains & Losses (v3.33.17)

You can now mark items as **Sold, Traded, Lost, Gifted, or Returned** via a disposition workflow. StakTrakr calculates the realized gain/loss based on your disposition amount vs. purchase cost.

Disposed items show color-coded badges in table and card views, appear with reduced opacity and strikethrough styling, and are hidden by default with a three-state filter (Hide / Show All / Disposed Only). The View Item modal shows full disposition history and a "Restore to Inventory" button. Portfolio summary cards show disposed item count and realized G/L per metal. CSV export includes all disposition fields.

---

## Market Page Redesign (v3.33.06)

Before the Market Data Module landed, the market page got a ground-up redesign:

- Full-width responsive card layout (CSS Grid, desktop/tablet/mobile breakpoints)
- Inline 7-day trend charts per card with spike detection and dashed interpolation for gaps
- Vendor price chips with brand-colored labels and medal rankings
- Card expand/collapse with chart interaction
- Metal filter pill buttons
- Manifest-driven coin discovery — API can add products without frontend changes
- Goldback vendor chips with goldback.com reference pricing and staleness indicators

---

## Numista Search Overhaul (v3.33.01)

- **Per-field origin tracking** — every field now records whether it came from Numista, PCGS, CSV import, or manual entry
- **Two-tier re-sync picker** — when re-syncing, you see diff hints and smart pre-check defaults based on field origin
- **Independent tag blacklist** — managed separately from chip grouping in Settings
- **Auto-apply Numista tags** — global toggle with per-action override
- **Image URL auto-population** — N# search now fills obverse/reverse image URLs and auto-detects metal type from composition data

---

## Data Portability & Import/Export (v3.33.24, v3.33.44)

- DiffModal preview for ZIP restore and vault restore — see what's changing before committing
- Export origin metadata — cross-domain import warnings when importing from a different instance
- Post-import summary banners showing add/update/skip counts
- Storage Location and Tags columns added to CSV export; tags added to JSON export
- Files of any size now accepted for import (removed the old 2MB cap)

---

## Summary Bar Upgrade (v3.33.39)

Item count and total weight (troy ounces) now display in the portfolio summary bar alongside Buy/Melt/Market/G/L. When filters are active, you see filtered/total format (e.g., "172/189 items").

---

## Clone Mode Redesign (v3.33.16)

Clone button now activates clone mode directly on the edit modal with field-level checkboxes — no more separate clone modal. New "Save & Clone Another" button for creating multiple clones in one session.

---

## Security & Stability

- XSS fix in settings pattern rule display
- OAuth CSRF protection on localStorage relay path
- Console output sanitized — no more cryptographic metadata in production logs
- Price bounds guard on the retail poller — rejects prices >+50% or <-30% of spot melt value
- Smart service worker recovery — detects stale cache errors and auto-reloads instead of showing scary error dialogs
- Network-first navigation prevents stale HTML after deploys

---

## Infrastructure (Behind the Scenes)

- **v2 API** — complete REST API redesign with self-describing manifest, carry-forward pricing, OHLCA computation, and goldback endpoints
- **Self-hosted sqld** — migrated from Turso Cloud to self-hosted libSQL with nightly DR backups
- **Cloudflare bypass** — Byparr sidecar for Cloudflare-blocked vendors
- **Thin publisher** — Fly.io footprint reduced to 1 CPU / 1 GB
- **Modularized codebase** — inventory.js split from 4,504 to 1,744 lines across 4 focused modules; shared chart utility library eliminated 11 duplicate Chart.js patterns
- **Rebrand** — new S-stack monogram icon replaces old ST text

---

## Everything Else

Some smaller things that add up:

- About modal migrated into Settings as the landing tab
- Weight units: kg and lb with automatic troy ounce conversion
- Mobile long-press (600ms) for inline spot price entry
- Chip max count setting to prevent overflow on small screens
- Dateless items sort as "infinitely old" instead of pinned to bottom
- Goldback G½ slug resolution
- NGC cert lookup extracts numeric grade correctly
- Fractional troy ounce weights display as "0.25 oz" instead of auto-converting to grams
- Reorderable header buttons (including Cloud Sync)
- Environment badges (BETA / PREVIEW / LOCAL) on non-production domains

---

## What's Next

v3.34.0 will bring a settings redesign. Beyond that: Google Drive / OneDrive / pCloud sync, and continued market data expansion.

---

## Try It

**Live:** [www.staktrakr.com](https://www.staktrakr.com)
**Source:** [github.com/lbruton/StakTrakr](https://github.com/lbruton/StakTrakr)
**Reddit:** [r/staktrakr](https://www.reddit.com/r/staktrakr/)
**Sponsor:** [github.com/sponsors/lbruton](https://github.com/sponsors/lbruton) — keeps the free API running

Big thanks to the r/Silverbugs community and everyone who's been beta testing since the early days. Your bug reports, feature requests, and patience with the cloud sync saga have made this release what it is. Stack on.
