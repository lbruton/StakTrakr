# Reddit announcement — r/staktrakr (primary) + crossposts

## Title

**StakTrakr v3.34.85 released — first full public release since April, 111 issues fixed**

## Body

It's been about 4 weeks since the last GitHub release (v3.34.38, April 30) and a lot has shipped to dev/beta in that time. v3.34.85 wraps it all up into one public release. Highlights:

### Pricing & market data

- New spot provider: **gold-api.com** for higher-frequency updates
- Header Spot button no longer fires 4 redundant API calls
- **SD Bullion + Bullion Exchanges retail scrape fixed** — both vendors started publishing bulk-tier prices as the primary `offer.price` in their JSON-LD, which made the dashboard look like silver was $75 and gold was $4,500 across the board. Now correctly lands on the 1-unit Check/Wire price
- 90-day Market History "All" view fills in per-vendor data for the full window
- Goldback retail charts fixed; ticker now shows G1-rate-based premium % with three-tier color coding

### Goldback

- **¼ Goldback (Idaho)** added — first fractional denomination
- Premium % tiers (low <2%, mid 2–5%, high ≥5%) color-coded across ticker, vendor matrix, and detail modal

### Catalog & UX

- **Numista tag preview** now works on first Fill Fields for new items
- **Per-side image override** — set obverse and reverse independently
- **Structured Capsule field** with dedicated notes
- Numista re-sync preserves tag membership
- Search now includes Numista catalog data (country, denomination, descriptions)
- Item Detail modal shows per-oz / per-coin premium as labeled numbers

### Workflow

- **Direct Print button** for inventory
- **Partial-stack disposition** — sell or trade part of a lot with a quantity selector
- Optional payment-method dropdown on purchases
- Disposition section position is configurable in Item Detail Appearance settings
- Storage Location and Year added to sort options

### Mobile

- **Bulk editor finally usable on phones** — sticky identity columns, 44px tap targets, full field parity
- Modal action buttons safe-area aware on notched devices
- Chart viewport scaling fixed on small screens

### Reliability

- **Manifest-first cloud sync now preserves item field edits** (was silently dropping them in some merge paths)
- ZIP and CSV exports carry frame and DIFF_FIELDS data needed for cross-device recovery
- Service worker cache recovery from corrupted state

### Quality of life

- New **metallic dark theme** on an oklch token system
- CSS polish pass (typography, spacing, focus rings)
- 47-patch Playwright suite stabilization

### Release hygiene

- README slimmed from 373 to 172 lines — easier to scan
- Six dev-only files (agent configs, lint configs, pre-commit hooks) no longer ship in the download zip

---

**Download:** https://github.com/lbruton/StakTrakr/releases/tag/v3.34.85
**Hosted:** https://www.staktrakr.com
**Beta:** https://beta.staktrakr.com
**Source:** https://github.com/lbruton/StakTrakr (MIT)

Still 100% client-side, zero data collection, zero accounts. Optional Dropbox cloud sync is zero-knowledge encrypted (AES-256-GCM + PBKDF2). Runs on `file://` from a single HTML file — fork it, host it yourself, or just open it in a browser.

Big thanks to everyone who filed issues and tested betas. Most of these fixes came from your reports. Keep them coming.

Happy Memorial Day weekend, and happy stacking 🥈🥇

---

## Posting

- **Target:** r/staktrakr (own sub, no crossposts this round)
- Title and body above are ready to paste — adjust freely
