# v3.34.85 — Memorial Day release

First public release since **v3.34.38** (April 30). 24 days of bug fixes, polish, and new features across **111 issues** and 47 patch versions. Highlights below — full details in [CHANGELOG.md](https://github.com/lbruton/StakTrakr/blob/main/CHANGELOG.md).

## 📱 Mobile parity

- **Bulk editor on phones** — sticky identity columns and 44px tap targets; nested-path fields (Shape, Capsule, Capsule Notes) now bulk-edit correctly (STRK-91)
- **Modal action buttons** — safe-area aware on iOS notch / pill devices (STAK-578)
- **Chart viewport scaling** — charts now resize correctly on small screens (STRK-42)

## 💰 Better spot pricing

- **gold-api.com** — added as a first-class provider for higher-frequency spot updates (STRK-89)
- **Header Spot button** — fires one all-metals sync instead of four redundant per-metal calls (STRK-93)
- **Service-worker routing** — explicit `api.staktrakr.com` routing fixes cache-vs-network races (STRK-79)

## 🏪 Retail accuracy

- **SD Bullion + Bullion Exchanges scrape fix** — both vendors recently published the deepest "As Low As" price as `offer.price` in JSON-LD, causing the dashboard to show bulk-tier values instead of the 1-unit Check/Wire price. Now correctly lands on 1-unit pricing or reports nothing (STRK-99)
- **90-day Market History "All" view** — now carries per-vendor breakdown for the full window; departed vendors retained via union merge (STRK-92)
- **Per-vendor goldback retail charts** — daily charts fixed (STRK-69)

## 🪙 Goldback

- **¼ Goldback (Idaho, g0.25)** — new fractional denomination added (STRK-66)
- **Ticker premium %** — now shows G1-rate-based premium for Goldback items; three-tier color coding (low <2%, mid 2–5%, high ≥5%) shared across ticker, vendor matrix, and detail modal (STRK-85)
- **Goldback purchase-price lookup** — fixed; orphan offset column removed (STRK-77)

## 📚 Catalog UX (Numista + PCGS)

- **Numista tag preview chips** — now appear on first Fill Fields for new items (STRK-84)
- **Add Item reset hardening** — Numista state no longer cross-contaminates between adds (STRK-87)
- **Per-side image override** — set obverse and reverse independently (STRK-67)
- **Structured Capsule field** — dedicated field with notes; no more cramming into "Notes" (STRK-46)
- **Numista re-sync** — tag membership preserved across re-syncs (STRK-52)
- **Search includes catalog data** — country, denomination, descriptions now searchable (STRK-86)
- **Expanded Numista import modal** — more fields visible during import (STRK-51)
- **Item Detail modal** — per-oz / per-coin premium labeled (STRK-48)
- **Add Item tag controls** — fixed for new items via pending-tag buffer (STRK-96)

## 🔧 Workflow

- **Direct Print button** — print inventory without an intermediate view (STRK-49)
- **Partial-stack disposition** — constrained quantity selector; sell/trade part of a lot (STRK-44, STRK-53)
- **Optional payment method** dropdown on purchase entry (STRK-50)
- **Disposition section position** — configurable in Item Detail Appearance settings (STRK-73)
- **Lost-disposition realized loss** — now computed correctly (STRK-54)
- **Lot ⇄ Each purchase toggle** — round-trip correct rounding (STRK-88, STRK-4)
- **Storage Location & Year** added to sort options (STRK-47)
- **7-day chart window** — minimum 7d shown for same-day purchases (STRK-76)

## 🎨 Polish

- **Metallic dark theme** — new theme built on an oklch token system (STRK-25)
- **CSS polish pass** — typography, spacing, focus rings (STRK-27)
- **Side-stripe removal** — cleaner card edges (STRK-26)
- **Vendor matrix "All" tab** — added as default for at-a-glance scanning (STRK-75)
- **Rectangular item images** — auto-size in card/table views (STRK-38)

## 🔒 Reliability & sync

- **Manifest-first sync** — now preserves item field edits; ZIP + CSV exports carry frame and DIFF_FIELDS for cross-device recovery (STRK-101)
- **Service worker cache recovery** — graceful recovery from corrupted SW state (STRK-56)
- **Inline chip config** — saves through `saveData` wrapper for compression and quota handling (STRK-74)
- **Header Spot 4× sync** — fixed (see Pricing) (STRK-93)

## 🧪 Quality

- **Playwright suite stabilized** — three categories of pre-existing flakies fixed: goldback-type, lot-each-purchase-price, numista-picker-tags (STRK-96)
- **Test mock audit** — consolidation pass to reduce API rate-limit flakies (STRK-78)
- **Codacy CLI per-tool exclusions** — pre-PR scans are now noise-free (STRK-81)

## 🧹 Release hygiene

- **README consolidated** — 373 → 172 lines, 12 feature subsections grouped into 6 themes (STRK-105)
- **Zip-leak fix** — six dev/agent files (`.impeccable.md`, `.cgcignore`, `.markdownlintignore`, `.pre-commit-config.yaml`, `.npmrc`, `preview.html`) no longer ship in the download zip (STRK-105)
- **Supply-chain hardening** — npm `min-release-age=3`, Dependabot cooldown (#1111)

---

## Download

- **[ZIP download](https://github.com/lbruton/StakTrakr/archive/refs/tags/v3.34.85.zip)** — extract, open `index.html`, runs anywhere
- **[Hosted app](https://www.staktrakr.com)** — same code, no install
- **[Beta](https://beta.staktrakr.com)** — latest `dev` for early adopters

## Privacy

Still 100% client-side, zero data collection, MIT licensed. Optional Dropbox cloud sync is zero-knowledge (AES-256-GCM + PBKDF2). See the [Privacy Policy](https://www.staktrakr.com/privacy.html).

---

_Thanks to everyone who filed issues and tested betas — this release was driven entirely by user feedback. Happy stacking._
