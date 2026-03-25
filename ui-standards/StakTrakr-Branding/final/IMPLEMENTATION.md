# StakTrakr Brand Assets — Implementation Guide

## Selected Concept: G — Centered Stack

The S-stack monogram: 5 horizontal bars forming an "S" shape, with silver bars at varying opacity and a wide gold center bar. No shield. Dark navy rounded-square background.

## Asset Inventory

| File | Use | Size |
|------|-----|------|
| `icon-logo.svg` | PWA icon, favicon, app stores | 512x512 squircle |
| `icon-bare.svg` | Transparent — for compositing on any background | 512x512, no bg |
| `banner-logo.svg` | About page, splash screen, social cards | 512x512 squircle |
| `banner-logo-compact.svg` | Header bar, navbar horizontal lockup | 400x80 |

## PWA Manifest Integration

Replace existing icons in `manifest.json`:

```json
{
  "icons": [
    { "src": "img/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "img/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "img/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Generate PNGs from `icon-logo.svg` at 192px and 512px. For maskable, add extra padding (safe zone is inner 80%).

## Favicon

Generate from `icon-logo.svg`:
- `favicon.ico` — 16x16 + 32x32 multi-size
- `apple-touch-icon.png` — 180x180

## Wordmark Rules

- **Full**: `STAKTRAKR` — "STAK" in `#e2e8f0` (white) + "TRAKR" in `#d4a017` (gold)
- **Weight**: 700 (bold) for headers, 300 (light) for About page
- **Letter-spacing**: 3-4px
- **Font**: System stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`)
- **Case**: ALL CAPS for logo, Title Case (`StakTrakr`) for body text references

## Color Reference

| Token | Hex | Usage |
|-------|-----|-------|
| Gold Primary | `#d4a017` | Wordmark accent, gold center bar, brand highlight |
| Gold Light | `#fbbf24` | Gradient highlights, hover states |
| Silver | `#94a3b8` | Monogram bars, secondary text |
| Silver Light | `#cbd5e1` | Gradient highlights on bars |
| Dark Navy | `#0f1729` | Icon background, dark theme base |
| Navy Surface | `#1a2744` | Gradient end, card backgrounds |
| Blue Accent | `#60a5fa` | Interactive elements, links (NOT brand — UI only) |
| Text Primary | `#f8fafc` | White text on dark backgrounds |

## Tagline

**Primary**: "Track Your Stack"
**Descriptive**: "Precious Metals Portfolio Tracker"
**Extended**: "A free, open-source precious metals portfolio tracker"
