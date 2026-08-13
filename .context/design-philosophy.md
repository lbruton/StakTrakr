---
title: "StakTrakr — Design Philosophy"
project: StakTrakr
audience: agent
canonical: .context/design-philosophy.md
source: "DocVault/Projects/StakTrakr/Foundation/design-philosophy.md" # migrated 2026-08-12
updated: "2026-06-16"
---

# StakTrakr — Design Philosophy

Design system and brand identity reference for StakTrakr. Source of truth for all UI and redesign work. See `ui-standards/style.html` for live component demos.

---

## Brand Identity

### Name and Wordmark

`STAKTRAKR` rendered in two-tone split:

- **STAK** — `#e2e8f0` (near-white)
- **TRAKR** — `#d4a017` (deep gold brand accent)
- Weight: 700 bold in header contexts; 300 light on the About page
- Letter-spacing: 3–4px
- Body/prose references use Title Case: `StakTrakr`

### Logo — Centered S-Stack (Concept G)

Five horizontal bars forming an "S" shape. Silver bars at varying opacity with a wide gold center bar. Dark navy rounded-square background (`#0f1729`). No shield.

| Asset          | File                            | Use                              |
| -------------- | ------------------------------- | -------------------------------- |
| Icon (with bg) | `final/icon-logo.svg`           | PWA, favicon, app stores         |
| Icon (bare)    | `final/icon-bare.svg`           | Compositing on any background    |
| Full lockup    | `final/banner-logo.svg`         | About page, splash, social cards |
| Horizontal     | `final/banner-logo-compact.svg` | Header bar, navbar               |

Brand assets live at `/Users/lbruton/CoWork/StakTrakr-Branding/final/`.

### Tagline

- **Primary:** "Track Your Stack"
- **Descriptive:** "Precious Metals Portfolio Tracker"
- **Tone:** Casual, community-driven — not corporate fintech

---

## Theme System

Four themes via `[data-theme]` attribute on `<html>`. Dark is primary; light, slate, and sepia are secondary. The theme toggle cycles: **dark → light → slate → sepia**.

| Theme | `data-theme` | Maturity              | Palette                                                                                                                |
| ----- | ------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Dark  | `dark`       | Primary, fully styled | oklch color space with warm gunmetal tinting; ~161 `color-mix()` expressions across all themes for hover/active states |
| Light | `light`      | Fully styled          | oklch color space                                                                                                      |
| Slate | `slate`      | Fully styled          | Original Tailwind Slate hex palette (pre-STRK-25 dark theme)                                                           |
| Sepia | `sepia`      | Fully styled          | oklch color space                                                                                                      |

All new components must be authored against the dark theme first.

---

## Color System

**Rule:** Always use CSS custom properties (`var(--token)`) over hardcoded hex values. Hardcoded values still exist in `.btn.filters` and retail badge/trend styles — these are tech debt, not patterns to follow.

> **Note:** The dark, light, and sepia themes now use oklch tokens (not hex). The hex values in the tables below are the Slate theme's Tailwind Slate palette — they remain accurate for the `[data-theme="slate"]` theme and serve as a reference for the token names and semantic roles used across all themes.

### Semantic Colors (Slate Theme — reference hex)

| Token             | Hex       | Usage                                |
| ----------------- | --------- | ------------------------------------ |
| `--primary`       | `#3b82f6` | Buttons, links, active states        |
| `--primary-hover` | `#2563eb` | Button hover state                   |
| `--success`       | `#10b981` | Positive values, in-stock indicators |
| `--warning`       | `#f59e0b` | Caution states, disclaimers          |
| `--danger`        | `#ef4444` | Destructive actions, negative values |
| `--info`          | `#38bdf8` | Informational badges                 |

### Background Tokens (Slate Theme — reference hex)

| Token            | Hex       | Usage                        |
| ---------------- | --------- | ---------------------------- |
| `--bg-primary`   | `#0f172a` | Page background              |
| `--bg-secondary` | `#1e293b` | Elevated surfaces, cards     |
| `--bg-tertiary`  | `#334155` | Tertiary surfaces, dropdowns |
| `--bg-card`      | `#1e293b` | Card backgrounds             |

### Text Tokens (Slate Theme — reference hex)

| Token              | Hex       | Usage                            |
| ------------------ | --------- | -------------------------------- |
| `--text-primary`   | `#f8fafc` | Headings, primary content        |
| `--text-secondary` | `#cbd5e1` | Labels, descriptions             |
| `--text-muted`     | `#94a3b8` | Hints, disabled states, metadata |

### Metal Colors (Slate Theme — reference hex)

| Token         | Hex       | Usage                      |
| ------------- | --------- | -------------------------- |
| `--silver`    | `#d1d5db` | Silver badge background    |
| `--gold`      | `#fbbf24` | Gold badge background      |
| `--platinum`  | `#f3f4f6` | Platinum badge background  |
| `--palladium` | `#d8b4fe` | Palladium badge background |

### Brand Colors (Theme-Invariant)

These do not shift across themes.

| Name         | Hex       | Usage                                           |
| ------------ | --------- | ----------------------------------------------- |
| Gold Primary | `#d4a017` | Brand accent, wordmark "TRAKR", Goldback vendor |
| Gold Light   | `#fbbf24` | Gradient highlights                             |
| Silver       | `#94a3b8` | Monogram bars, secondary elements               |
| Dark Navy    | `#0f1729` | Logo background                                 |
| Blue Accent  | `#60a5fa` | Chart highlights (UI, not brand identity)       |

### Vendor Chart Colors

Each vendor has a fixed color used consistently across all chart contexts (retail cards, intraday charts, history charts, trend charts). Never remap a vendor to a different color — users develop visual associations.

| Vendor       | Hex       | Name           |
| ------------ | --------- | -------------- |
| APMEX        | `#60a5fa` | Bright blue    |
| JM Bullion   | `#fbbf24` | Bright amber   |
| SD Bullion   | `#34d399` | Bright emerald |
| Monument     | `#c4b5fd` | Bright violet  |
| Hero Bullion | `#f87171` | Red            |
| BullionX     | `#f472b6` | Bright pink    |
| Summit       | `#22d3ee` | Bright cyan    |
| Goldback     | `#d4a017` | Deep gold      |
| Provident    | `#a3e635` | Lime green     |
| Gainesville  | `#fb923c` | Orange         |

Colors were brightened in v3.33.06 for contrast on dark backgrounds.

---

## Typography

Font family: Inter / system-ui stack. All sizes in `rem`. Monospace for prices and data.

| Element            | Size     | Weight | Notes                   |
| ------------------ | -------- | ------ | ----------------------- |
| h1                 | 1.5rem   | 700    | —                       |
| h2                 | 1.25rem  | 700    | —                       |
| h3                 | 1rem     | 600    | —                       |
| Body               | 0.875rem | 400    | —                       |
| Settings subtext   | 0.9rem   | 400    | `var(--text-secondary)` |
| Prices / monospace | 0.85rem  | 400    | `SF Mono, Fira Code`    |
| Small labels       | 0.75rem  | 600    | `var(--text-secondary)` |

---

## Spacing and Layout

### Spacing Tokens

| Token          | Value   | Usage                      |
| -------------- | ------- | -------------------------- |
| `--spacing-xs` | 0.2rem  | Tight gaps                 |
| `--spacing-sm` | 0.4rem  | Chip padding, compact gaps |
| `--spacing`    | 0.75rem | Standard padding/margin    |
| `--spacing-lg` | 1.25rem | Section padding            |
| `--spacing-xl` | 1.5rem  | Card padding, large gaps   |

### Border Radius Tokens

| Token         | Value | Usage                  |
| ------------- | ----- | ---------------------- |
| `--radius`    | 8px   | Buttons, inputs, cards |
| `--radius-lg` | 12px  | Modals, large cards    |

### Breakpoints

Not yet standardized in the codebase (59 `@media` rules spanning 15 distinct breakpoint values currently in `css/styles.css`). Recommended canonical set for all new work:

| Name      | Value  | Target                   |
| --------- | ------ | ------------------------ |
| `--bp-sm` | 480px  | Small phone              |
| `--bp-md` | 768px  | Tablet / landscape phone |
| `--bp-lg` | 1024px | Desktop                  |
| `--bp-xl` | 1350px | Wide desktop             |

All settings redesign work (STAK-432–447) uses mobile-first ordering against this set.

---

## Component Patterns

### Buttons

| Class                           | Style                 | Usage              |
| ------------------------------- | --------------------- | ------------------ |
| `.btn`                          | Blue fill, white text | Primary action     |
| `.btn.success`                  | Green fill            | Confirm / positive |
| `.btn.warning`                  | Amber fill            | Caution action     |
| `.btn.danger`                   | Red fill              | Destructive action |
| `.btn.secondary`                | Filled with border    | Secondary/neutral  |
| `.btn` + `border-radius: 999px` | Pill shape            | Filter toggles     |

The glass/transparent button treatment exists only in narrow modal-footer overrides, not on the base class. Do not apply it broadly.

### Cards

Standard card construction:

```css
background: var(--bg-card);
border: 1px solid var(--border);
border-radius: var(--radius-lg);
padding: var(--spacing-xl);
```

Market list cards expand/collapse per coin. Cards always stack vertically on mobile.

### Modals

- Close selector is `.modal-close` — **not** `.close-btn`, and **not** `[data-bs-dismiss]`. The Bootstrap JS library is not loaded in this project (verified 2026-08-13: zero `data-bs-*` attributes in `index.html` and `js/`), so a `data-bs-dismiss` handle is inert.
- FIFO dialog queue managed via `showDialog()` / `presentDialog()` in `js/dialogs.js`
- All modal open/close goes through `openModalById()` / `closeModalById()`
- Settings sections use config objects: `{ id, title, icon, contentBuilder }`
- Chart.js instances inside modals **must** be destroyed on close — skipping this leaks canvas contexts and causes "Canvas is already in use" on the next open

### Toggles

Standard HTML `<input type="checkbox">` with custom switch styling. Minimum 44px touch target for mobile compliance.

### Metal Filter Pills

Chip-style filter buttons for metal type (`all`, `silver`, `gold`, `goldback`, `platinum`, `palladium`). Pill variant (`.btn` + `border-radius: 999px`). Active state uses `--primary` fill.

---

## Accessibility Baseline

- Minimum 44px touch targets for all interactive controls on mobile
- Color is not the sole indicator of state — labels and icons accompany color cues
- Vendor colors were brightened in v3.33.06 specifically for contrast on dark backgrounds
- `--text-muted` (`#94a3b8`) is used for non-essential metadata only — not for primary labels

---

## Design System Demo

Interactive reference: `ui-standards/style.html` (references `../css/styles.css` for live token resolution).

Covers: color swatches, typography scale, spacing demos, button states, form inputs, toggles and chips, cards, tables, modal headers, collapsible sections, image uploads, badges and indicators, and a migration checklist.

---

## Settings Redesign (STAK-432–447)

12 open issues. Key decisions:

- **About page** moves into Settings as landing tab; "What's New" thin popup stays
- **Mobile-first** — all cards stack vertically, 44px touch targets, no horizontal scroll
- **Execution order:** Style Guide → About/What's New → API tab (STAK-443) → remaining tabs

### API Tab Sectioned Card Layout (STAK-443, v3.34.24)

Replaced 1075-line monolithic API settings panel with three sectioned `.settings-fieldset` cards following the established section pattern:

1. **Market Prices** — beacon endpoint (read-only, no controls)
2. **Spot Price Source** — 6-option pill-radio single-select (STAKTRAKR, METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM, MANUAL)
3. **Catalog** — Numista + PCGS configuration rows, with "Bulk Sync & Advanced" modal for detailed settings

All action buttons use pill shape (`.btn` + `border-radius: 999px`); History buttons use violet `.btn-history` variant. The modal replaces inline Numista bulk-sync, reducing Settings page scrolling and cognitive load.

---

## Related

- Style Guide (deprecated DocVault page) — living source file (this doc was derived from it)
- Frontend Overview (deprecated DocVault page)
- .context/deep-dives/dom-patterns.md
- Brand assets: `/Users/lbruton/CoWork/StakTrakr-Branding/final/`
- Demo: `ui-standards/style.html`
