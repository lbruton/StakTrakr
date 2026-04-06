# Design System: StakTrakr

## 1. Visual Theme & Atmosphere

StakTrakr is a precious metals inventory tracker built as a single-page vanilla JavaScript application with zero build step. The design system is a Slate-gray light mode paired with an inky Navy dark mode — both rooted in Tailwind's Slate palette but mapped through a comprehensive CSS custom property layer that enables four distinct themes: Light, Dark, Sepia, and Hello Kitty.

The visual identity is "financial dashboard meets coin collector's cabinet." Cards and sections float on an elevated surface system (`--bg-primary` → `--bg-elev-1` → `--bg-card`), each layer one step lighter/brighter than its parent, creating a subtle depth stack without relying on heavy shadows. The shadows that *do* exist are small and functional (`--shadow-sm` through `--shadow-lg`), never decorative — this is an app for people who care about 0.01oz weight precision, not ambient gradients.

The standout visual treatment is the glass-morphism modal system. Modals render with `backdrop-filter: blur(12px)` overlays and translucent card backgrounds (`rgba(248, 250, 252, 0.95)` in light mode, `rgba(30, 41, 59, 0.95)` in dark), topped with a single-pixel primary-colored gradient line across the header. This blur-glass technique recurs across settings, item details, and changelog modals, giving the app a premium feel despite being entirely client-side.

Metal-specific accent colors (Gold `#a04808`, Silver `#5f6673`, Platinum `#4b5563`, Palladium `#6d35d0`) appear throughout — in spot price cards, filter chips, and card borders. These are carefully tuned per-theme for WCAG AA contrast compliance. In dark mode, Gold becomes the warm `#fbbf24` and Silver brightens to `#d1d5db`, ensuring legibility against the navy backgrounds.

**Key Characteristics:**
- Four themes via `data-theme` attribute: `light`, `dark`, `sepia`, `hello-kitty`
- Slate palette foundation (Tailwind Slate 50–900) with semantic token aliases
- No CSS framework — single `css/styles.css` file (~300KB, 13K+ lines)
- Inter system font stack (no CDN dependency — graceful fallback)
- Glass-morphism modals with `backdrop-filter: blur(12px)`
- Sparkline canvases layered behind spot price cards (absolute positioning, `opacity: 0.35`)
- Shields.io-style footer badges (flat-square aesthetic)
- File-protocol compatible — works on `file://` without a server
- `cubic-bezier(0.4, 0, 0.2, 1)` easing on all transitions (Material Design curve)

## 2. Color Palette & Roles

### Primary & Semantic Colors

| Name | Light | Dark | Use |
|------|-------|------|-----|
| **Primary** | `#3b82f6` | `#3b82f6` | Buttons, links, focus rings, spot price values |
| **Primary Hover** | `#2563eb` | `#2563eb` | Button hover, link hover |
| **Secondary** | `#8b93a6` | `#6b7280` | Secondary buttons, muted actions |
| **Success** | `#059669` | `#10b981` | Positive gain, add confirmations |
| **Info** | `#0ea5e9` | `#38bdf8` | Informational badges, tag chips |
| **Warning** | `#d97706` | `#f59e0b` | Caution states, premium badges |
| **Danger** | `#dc2626` | `#ef4444` | Delete actions, loss indicators, alerts |

### Background Surfaces

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--bg-primary` / `--bg` | `#e2e8f0` (Slate 200) | `#0f172a` | Page background |
| `--bg-secondary` / `--bg-elev-1` | `#eef2f7` (Slate 100/200) | `#1e293b` | Elevated surfaces, card groups |
| `--bg-tertiary` / `--bg-elev-2` | `#cbd5e1` (Slate 300) | `#334155` | Tertiary surfaces, chip backgrounds |
| `--bg-card` / `--surface` | `#f8fafc` (Slate 50) | `#1e293b` | Card backgrounds |
| `--surface-alt` | `#ffffff` | — | Brightest surface (white) |

### Text

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--text-primary` / `--text` | `#1b232c` | `#f8fafc` | Primary body text |
| `--text-secondary` / `--text-muted` | `#344351` | `#cbd5e1` | Secondary text, labels |
| `--text-muted` (dark only) | — | `#94a3b8` | Timestamps, captions |
| `--chip-text` | `#1b232c` | `#f8fafc` | Filter chip text |

### Borders & Shadows

| Token | Light | Dark |
|-------|-------|------|
| `--border` | `#94a3b8` (Slate 400) | `#334155` |
| `--border-hover` | `#64748b` (Slate 500) | `#475569` |
| `--shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.1)` | `0 1px 2px 0 rgb(0 0 0 / 0.3)` |
| `--shadow` | `0 4px 6px -1px rgb(0 0 0 / 0.15), 0 2px 4px -2px rgb(0 0 0 / 0.1)` | same with `/0.3` |
| `--shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.15), 0 4px 6px -4px rgb(0 0 0 / 0.1)` | same with `/0.3` |

### Metal-Specific Colors

| Metal | Light | Dark | Use |
|-------|-------|------|-----|
| **Gold** | `#a04808` | `#fbbf24` | Gold-type items, spot card accents |
| **Silver** | `#5f6673` | `#d1d5db` | Silver-type items |
| **Platinum** | `#4b5563` | `#f3f4f6` | Platinum-type items |
| **Palladium** | `#6d35d0` | `#d8b4fe` | Palladium-type items |

### Inventory Type Badge Colors

| Type | Background | Text |
|------|-----------|------|
| Coin | `#b85f00` (light) / `#b45309` (dark) | `#ffffff` |
| Round | `#5a6170` / `#9ca3af` | `#f8fafc` / `#1e293b` |
| Bar | `#946d00` / `#fde047` | `#ffffff` / `#1e293b` |
| Note | `#047857` | `#f8fafc` / `#ffffff` |
| Set | `#8B5CF6` / `#a78bfa` | `#ffffff` / `#1e293b` |
| Other | `#6d35d0` / `#8b5cf6` | `#f8fafc` / `#ffffff` |

### Sepia Theme

Warm parchment palette for antique coin aesthetic:
- **Background**: `#ede5d0` (parchment), `#e4dbc4` (aged linen), `#d6ccb3` (warm stone)
- **Card**: `#f5f0e3` (light cream)
- **Text**: `#3a3019` (dark sepia), `#524730`, `#706652`
- **Primary**: `#b35c1f` (burnt sienna)
- **Border**: `#c4b89e` (warm tan)

### Hello Kitty Theme

Vivid pink/purple on dark purple base:
- **Primary**: `#f472b6` (hot pink), hover `#ec4899`
- **Background**: `#1a0428` (very dark purple), `#2d0a4e`, `#3d1166`
- **Text**: `#fce7f3` (light pink), `#f9a8d4`, `#f472b6`
- **Border**: `#6d28d9` (vivid violet)
- **Gold**: `#fbbf24`, **Silver**: `#e879f9`, **Palladium**: `#c084fc`

### Spot Price Change Indicators

| Class | Color | Use |
|-------|-------|-----|
| `.spot-up` / `.spot-change-up` | `var(--success)` | Price increased |
| `.spot-down` / `.spot-change-down` | `var(--danger)` | Price decreased |
| `.spot-unchanged` | `var(--warning)` | No change |
| `.cv-gain` | `var(--success)` | Portfolio gain |
| `.cv-loss` | `var(--danger)` | Portfolio loss |

## 3. Typography Rules

### Font Families

- **Primary**: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **Monospace**: `'SF Mono', 'Fira Code', monospace` (version strings); `'Courier New', monospace` (data values); `monospace` (general code)
- **Badge**: `'Verdana', 'DejaVu Sans', sans-serif` (shields.io-style footer badges only)

No Google Fonts CDN — Inter is expected as a system font, with full sans-serif fallback. This ensures `file://` protocol compatibility.

### Hierarchy

| Role | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|--------|-------------|----------------|-------|
| Page Title (h1) | `1.875rem` (30px) | 700 | — | `-0.025em` | Primary color, single use |
| Section Title (h2) | `1.25rem` (20px) | 600 | — | — | Text-primary color |
| About Description | `1.125rem` (18px) | — | 1.7 | — | Text-secondary, centered |
| Card Item Name | `0.88rem` (14px) | 600 | 1.3 | `-0.01em` | Tight leading for card density |
| Body / Input | `1rem` (16px) | — | 1.6 (html) | — | Base font size |
| Label | `0.875rem` (14px) | 500 | — | — | Form labels, button text |
| Button | `0.875rem` (14px) | 500 | — | — | Inline-flex centered |
| Spot Card Label | `0.75rem` (12px) | 500 | — | `0.05em` | Uppercase, text-muted |
| Spot Card Value | `1.5rem` (24px) | 700 | — | — | Primary color, monospace feel |
| Filter Chip | `0.75rem` (12px) | 500 | 1.0 | — | Compact, pill-style |
| Card Chip (cv-chip) | `0.65rem` (10.4px) | 600 | — | `0.01em` | Smallest text, type badges |
| Timestamp | `0.7rem` (11.2px) | 400 | 1.2 | — | Muted, tertiary info |
| Footer Meta | `0.78rem` (12.5px) | — | 1.6 | — | Secondary text |
| Shield Badge | `11px` | — | `20px` | — | Verdana, fixed height 20px |
| Env Badge | `0.55rem` (8.8px) | 700 | 1.4 | `0.08em` | Uppercase, tiny |
| Version String | `12px` | — | — | — | SF Mono/monospace |
| Btn Small | `0.8rem` (12.8px) | — | — | — | Compact buttons |

### Principles

- **Weight restraint**: Most text is 400–500. Weight 600 appears on headings and chip labels. Weight 700 is reserved for h1, spot price values, and env badges — always the most important number on screen.
- **Negative tracking on headings**: h1 uses `-0.025em`, card names use `-0.01em`. This tightening is subtle but prevents the Inter font from feeling too airy at larger sizes.
- **Uppercase as hierarchy signal**: Spot card labels, env badges, type chips, and filter chip grouping headers all use `text-transform: uppercase` with widened letter-spacing. This is the "instrument panel" voice — technical, precise, categorical.
- **No font imports**: Inter is a system font dependency. The fallback stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`) covers 95%+ of devices with visually similar metrics.

## 4. Component Stylings

### Buttons (`.btn`)

**Primary (default)**
- Background: `var(--primary)` (`#3b82f6`)
- Text: `#f8fafc`
- Padding: `0.75rem 1.5rem`
- Radius: `var(--radius)` (`8px`)
- Min-height: `2.75rem`
- Font: `0.875rem`, weight 500
- Transition: `all 0.2s cubic-bezier(0.4, 0, 0.2, 1)`
- Hover: `var(--primary-hover)`, `translateY(-1px)`, `box-shadow: var(--shadow)`
- Active: `translateY(0)`
- Shimmer: `::before` pseudo-element with `linear-gradient(90deg, transparent, rgba(248, 250, 252, 0.2), transparent)` slides left→right on hover

**Variants** — same structure, different `background`:
| Variant | Background | Hover | Text |
|---------|-----------|-------|------|
| `.danger` | `var(--danger)` | `var(--danger-hover)` | `#f8fafc` |
| `.success` | `var(--success)` | `var(--success-hover)` | `#f8fafc` |
| `.info` | `var(--info)` | `var(--info-hover)` | `#f8fafc` |
| `.secondary` | `var(--secondary)` | `var(--secondary-hover)` | `#f8fafc` |
| `.warning` | `var(--warning)` | `var(--warning-hover)` | `var(--text-primary)` |
| `.premium` | `var(--warning)` | `#b45309` | `var(--text-primary)` |
| `.filters` | `#eab308` | `#ca8a04` | `var(--text-primary)` |

**Small Button** (`.btn-sm`): `padding: 0.25rem 0.6rem`, `font-size: 0.8rem`

### Sections

- Background: `var(--bg-card)`
- Padding: `var(--spacing-xl)` (`1.5rem`)
- Radius: `var(--radius-lg)` (`12px`)
- Border: `1px solid var(--border)`
- Shadow: `var(--shadow)`
- Hover: `box-shadow: var(--shadow-lg)`

### Spot Price Cards (`.spot-card`)

- Background: `var(--bg-primary)`
- Radius: `var(--radius-lg)` (`12px`)
- Border: `1px solid var(--border)`
- Shadow: `var(--shadow-sm)`
- Sparkline canvas: absolute positioned, `opacity: 0.35`, behind content
- Grid: `1fr 1fr` (2×2) → `repeat(4, 1fr)` at 960px
- Value: `1.5rem`, weight 700, `var(--primary)` color
- Label: `0.75rem`, uppercase, `letter-spacing: 0.05em`
- Timestamp: `0.7rem`, `var(--text-muted)`

### Modals (`.modal`)

**Overlay**
- Background: `rgba(0, 0, 0, 0.7)`
- Backdrop filter: `blur(12px)`
- Animation: `modalFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)`
- Z-index: `9999`

**Content (`.modal-content`)**
- Light: `background: rgba(248, 250, 252, 0.95)`, `backdrop-filter: blur(16px)`
- Dark: `background: rgba(30, 41, 59, 0.95)`, border `rgba(148, 163, 184, 0.2)`
- Sepia: `background: rgba(232, 220, 197, 0.95)`
- Radius: `var(--radius-lg)` (`12px`)
- Max-width: `1200px`
- Max-height: `90vh`, overflow-y auto
- Shadow: `0 25px 50px -12px rgba(0, 0, 0, 0.25)` + inset highlights
- `::before` top gradient line: `linear-gradient(90deg, transparent, var(--primary), transparent)`, `opacity: 0.6`
- Animation: `modalSlideIn 0.3s`

**Close button (`.modal-close`)**: `40px × 40px`, no background, `1.5rem` font size, `var(--text-secondary)`

### Filter Chips (`.filter-chip`)

- Padding: `0.25rem 0.5rem`
- Radius: `var(--radius)` (`8px`)
- Font: `0.75rem`, weight 500, Inter stack
- Height: `1.5rem`
- Shadow: `var(--shadow-sm)`
- Hover: `opacity: 0.9`, `translateY(-1px)`, shadow upgrade
- Active state: `outline: 2px solid var(--chip-active-outline)`, `outline-offset: 1px`
- Search state: `outline` with `var(--chip-search-outline)` (green)
- Excluded: `outline: 1px dashed rgba(0, 0, 0, 0.35)`

### Card View Chips (`.cv-chip`)

- Padding: `0.1rem 0.45rem`
- Radius: `999px` (full pill)
- Font: `0.65rem`, weight 600
- Variants: `.cv-chip-year`, `.cv-chip-grade` (primary bg), `.cv-chip-qty`, `.cv-chip-weight`, `.cv-chip-tags` (info bg), `.cv-chip-type` (inventory type colors)

### Inventory Card View (`.card-view-grid`)

- Flex-wrap layout, `gap: 0.65rem`
- Max-width: `1400px`, centered
- Responsive: 1-col → 2-col at `640px` → 3-col at `1100px`
- Item name: `0.88rem`, weight 600, truncatable
- Coin images: `border-radius: 50%` (round coins) or `var(--radius)` (bars)
- No-image placeholder: radial gradient with metal-tinted glass orb effect

### Tables

- Width: `100%`, `border-collapse: collapse`
- Background: `var(--bg-primary)`
- Radius: `var(--radius)` (`8px`)
- Shadow: `var(--shadow)`
- Table section wrapper: `2px solid var(--border)` border, `var(--radius)` radius
- Scrollable: `.portal-scroll` with `max-height: 70vh`, custom scrollbar (`var(--primary)` thumb)
- Inventory table: `border-collapse: separate`, `border-spacing: 0` (required for sticky headers)

### Form Inputs

- Padding: `0.75rem`
- Border: `2px solid var(--border)`
- Radius: `var(--radius)` (`8px`)
- Background: `var(--bg-primary)`
- Focus: `border-color: var(--primary)`, `box-shadow: 0 0 0 3px rgb(59 130 246 / 0.1)`

### Shield Badges (`.shield-badge`)

Shields.io flat-square style, two-part badges:
- Height: `20px`, radius `3px`
- Font: Verdana `11px`
- Label: `background: #555`, `color: #fff`, `padding: 0 6px`
- Value colors (WCAG AA compliant):
  - `--brightgreen`: `#4c1` (dark text `#1a1a1a`)
  - `--green`: `#97ca00` (dark text)
  - `--yellow`: `#dfb317` (dark text)
  - `--orange`: `#fe7d37` (dark text)
  - `--red`: `#e05d44` (white text)
  - `--blue`: `#0969da` (white text)
  - `--grey`: `#9f9f9f` (dark text)

### Disposition Badges (`.disposition-badge`)

Inline pills with translucent tinted backgrounds:
- Font: `0.7rem`, weight 600, uppercase
- Padding: `2px 8px`, radius `10px`
- Sold: `hsla(142, 60%, 45%, 0.18)` bg, green text
- Traded: `hsla(210, 70%, 50%, 0.18)` bg, blue text
- Lost: `hsla(0, 70%, 50%, 0.18)` bg, red text
- Gifted: `hsla(270, 60%, 55%, 0.18)` bg, purple text
- Returned: `hsla(30, 80%, 50%, 0.18)` bg, orange text
- Dark mode: lighter text values for contrast

### Alerts (`.about-alert`)

- Light: `background: linear-gradient(135deg, #fef2f2, #fff1f2)`, border `#fecaca`, left accent `4px solid var(--danger)`
- Dark: `background: linear-gradient(135deg, #2d1b1b, #1f1717)`, border `#991b1b`
- Radius: `var(--radius)` (`8px`)
- Padding: `var(--spacing-lg)` (`1.25rem`)
- Content: 2-column layout (`column-count: 2`)

### Environment Badges (`.env-badge`)

- Position: absolute, bottom-left of logo
- Font: `0.55rem`, weight 700, uppercase, `letter-spacing: 0.08em`
- Padding: `1px 6px`, radius `8px`
- Beta: `var(--warning)` bg, dark text
- Preview: `var(--info)` bg, dark text
- Local: `var(--text-muted)` bg, white text

## 5. Layout Principles

### Spacing Scale

| Token | Value | Use |
|-------|-------|-----|
| `--spacing-xs` | `0.2rem` (3.2px) | Chip gaps, tight padding |
| `--spacing-sm` | `0.4rem` (6.4px) | Inner component spacing |
| `--spacing` | `0.75rem` (12px) | Standard spacing, body padding |
| `--spacing-lg` | `1.25rem` (20px) | Section internal padding, large gaps |
| `--spacing-xl` | `1.5rem` (24px) | Section padding, container gaps |

### Grid Structure

- **Body**: `max-width: 1600px`, centered, `margin: var(--spacing-lg) auto`
- **Container**: CSS Grid, `gap: var(--spacing-xl)`
- **Grid-2**: `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))`
- **Spot cards**: 2-col → 4-col at `960px`
- **Card view**: flex-wrap, 1-col → 2-col at `640px` → 3-col at `1100px`
- **Form grids**: named layouts (`grid-purity-row: 2fr 1fr 1fr auto`, `grid-name-year: 3fr 2fr`, `grid-grade: 1fr 1fr 1.5fr`)

### Border Radius Scale

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | `4px` | Range selects, sync icons, inline inputs |
| `--radius` | `8px` | Buttons, inputs, filter chips, tables |
| `--radius-lg` | `12px` | Sections, cards, modals, header |
| `999px` | Full pill | Card view chips (`.cv-chip`) |
| `9999px` | Full pill | (Reserved, not currently used) |
| `50%` | Circle | Coin images, storage dots |
| `3px` | Micro | Shield badges |

### Whitespace Philosophy

StakTrakr uses compact spacing — this is a data-dense financial tracker, not a marketing site. The spacing scale tops out at `1.5rem`, and most components use `0.75rem` or less internally. Vertical rhythm is maintained by consistent `gap` values on grid containers rather than individual margins. Section hover shadow upgrades (`--shadow` → `--shadow-lg`) provide depth hierarchy without consuming whitespace.

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| **0 — Page** | `var(--bg-primary)`, no shadow | Page background |
| **1 — Surface** | `var(--bg-secondary)` / `var(--bg-elev-1)`, `var(--shadow-sm)` | Spot card containers, header |
| **2 — Card** | `var(--bg-card)`, `1px solid var(--border)`, `var(--shadow)` | Sections, cards |
| **2+ — Card Hover** | Same bg, `var(--shadow-lg)` | Section:hover state |
| **3 — Table Chrome** | `var(--bg-primary)`, `2px solid var(--border)` | Table section wrapper |
| **4 — Overlay** | `rgba(0, 0, 0, 0.7)`, `backdrop-filter: blur(12px)` | Modal backdrop |
| **5 — Modal** | Translucent bg, `blur(16px)`, `25px 50px` shadow, `::before` gradient line | Modal content |
| **6 — Sticky** | `var(--bg-card)`, `z-index: 100` | Sticky table headers, header buttons |
| **∞ — System** | `z-index: 9999` | Modal overlay, back-to-top button |

### Depth Philosophy

Depth is communicated through three mechanisms: **border weight** (1px default, 2px for prominent containers), **shadow escalation** (sm → default → lg on hover), and **backdrop blur** (modals only). The system avoids colored shadows or drop-shadow filters. The glass-morphism modal is the only place translucency creates depth — everywhere else, surfaces are opaque.

## 7. Do's and Don'ts

### Do's

1. **Do use CSS custom properties for all colors** — never hardcode hex values in component styles. Use `var(--primary)`, `var(--bg-card)`, etc.
2. **Do use the elevation system** — `--bg-primary` → `--bg-secondary` → `--bg-card` creates visual hierarchy. Nest lighter surfaces inside darker ones.
3. **Do include hover states on interactive elements** — buttons get `translateY(-1px)` + shadow upgrade, chips get `translateY(-1px)` + opacity change. This micro-animation is the app's tactile signature.
4. **Do use `var(--radius)` (8px) for standard components** and `var(--radius-lg)` (12px) for containers. This two-tier system is consistent throughout.
5. **Do add the shimmer `::before` pseudo-element** on primary buttons — the sweeping gradient on hover is a StakTrakr signature.
6. **Do use the metal accent colors** (`--gold`, `--silver`, `--platinum`, `--palladium`) when displaying metal-specific data. These are tuned per-theme for contrast.
7. **Do respect the compact spacing** — this is a data-dense app. `0.75rem` is the workhorse spacing value. Don't add large whitespace gaps.
8. **Do use `backdrop-filter: blur()` only on modals** — it's the premium treatment reserved for overlay contexts.
9. **Do use `text-transform: uppercase` with widened `letter-spacing`** for categorical labels (spot card labels, type badges, env badges).
10. **Do test all four themes** when adding new components — Light, Dark, Sepia, and Hello Kitty all need to work.

### Don'ts

1. **Don't use pure black (`#000`) or pure white (`#fff`) as backgrounds** — the darkest background is `#0f172a` (dark) / `#1a0428` (hello-kitty). The lightest card is `#f8fafc`. Pure values break the tonal harmony.
2. **Don't add decorative gradients** to non-modal components — the only gradients in the system are the modal `::before` line, the alert background, and the no-image placeholder orb.
3. **Don't use `box-shadow` for primary visual hierarchy** — borders and surface color differences do that job. Shadows are accents, not structure.
4. **Don't skip the `transition: var(--transition)` on interactive elements** — the `0.2s cubic-bezier(0.4, 0, 0.2, 1)` easing is applied globally. Abrupt state changes feel broken in this system.
5. **Don't use font weights above 700** — the heaviest weight is 700, used only for h1 and spot price values. Most text is 400–500.
6. **Don't add new font families** — Inter + system sans-serif + monospace is the complete stack. Additional fonts increase load time and break `file://` compatibility.
7. **Don't use `z-index` values between 100 and 9999** — the system uses 0 (default), 1–2 (sparkline layers), 100 (sticky headers/buttons), and 9999 (modals). No intermediate layers.
8. **Don't make sections wider than `1600px`** — that's the body max-width. Card view grid caps at `1400px`.
9. **Don't use colored outlines except for chip active states** — `outline` is reserved for filter chip selection rings (`--chip-active-outline`, `--chip-search-outline`).
10. **Don't forget `min-width: 0`** on grid children — without it, long text content blows out grid cells on narrow viewports.

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| **Mobile** | < 480px | Sort bar stacks, single-column cards, compact spacing |
| **Small Tablet** | 580px | Header actions switch from 2-col grid to flex row |
| **Tablet** | 600px | About alert content goes 2-column |
| **Medium** | 640px | Card view goes 2-column |
| **Tablet Landscape** | 768px | Various modal/component breakpoints |
| **Desktop** | 960px | Spot cards go 4-column |
| **Wide** | 1100px | Card view goes 3-column |
| **Large** | 1200px–1350px | Table and market list width adjustments |
| **Body Max** | 1600px | Body max-width cap |

### Touch Targets

- Buttons: `min-height: 2.75rem` (44px) — meets iOS/Android guidelines
- Modal close: `40px × 40px`
- Filter chips: `height: 1.5rem` (24px) — below target, compensated by spacing/padding
- Sync icons: `22px × 22px` — compact but touch-accessible via padding

### Collapsing Strategy

- **Header**: 2-col button grid → flex row at 580px
- **Spot cards**: 2×2 grid → 4-column at 960px (never 1-column — metals always shown in pairs)
- **Card view**: 1-col → 2-col → 3-col (flex-basis percentage calculation)
- **Tables**: horizontal scroll via `.portal-scroll` — never collapse columns
- **Modals**: full-width at narrow viewports, centered with padding at wider
- **Sort bar**: stacks controls center-aligned at 480px
- **Alert content**: drops from 2-column to 1-column below 600px

## 9. Agent Prompt Guide

### Quick Color Reference

```
--primary:       #3b82f6 (blue — buttons, links, focus)
--bg-primary:    #e2e8f0 light / #0f172a dark (page bg)
--bg-card:       #f8fafc light / #1e293b dark (card bg)
--text-primary:  #1b232c light / #f8fafc dark
--border:        #94a3b8 light / #334155 dark
--success:       #059669 light / #10b981 dark (gains, positive)
--danger:        #dc2626 light / #ef4444 dark (losses, delete)
--radius:        8px (buttons, inputs)
--radius-lg:     12px (sections, cards, modals)
```

### Example Component Prompts

**"Build a new card component"**
```css
background: var(--bg-card);
padding: var(--spacing-xl); /* 1.5rem */
border-radius: var(--radius-lg); /* 12px */
border: 1px solid var(--border);
box-shadow: var(--shadow);
transition: var(--transition);
/* hover: box-shadow: var(--shadow-lg) */
```

**"Add a button"**
```css
display: inline-flex; align-items: center; justify-content: center;
gap: 0.5rem; padding: 0.75rem 1.5rem;
background: var(--primary); color: #f8fafc;
border: none; border-radius: var(--radius); /* 8px */
font-size: 0.875rem; font-weight: 500;
min-height: 2.75rem;
transition: var(--transition);
/* hover: background: var(--primary-hover); transform: translateY(-1px); box-shadow: var(--shadow) */
```

**"Create a status badge"**
```css
display: inline-flex; align-items: center;
padding: 0.1rem 0.45rem; border-radius: 999px;
font-size: 0.65rem; font-weight: 600;
letter-spacing: 0.01em; white-space: nowrap;
/* use --type-*-bg and --type-*-text for inventory types */
/* use disposition-badge pattern with hsla() for status indicators */
```

**"Add a form input"**
```css
width: 100%; padding: 0.75rem;
border: 2px solid var(--border); border-radius: var(--radius);
background: var(--bg-primary); color: var(--text-primary);
font-family: inherit; font-size: 1rem;
transition: var(--transition);
/* focus: border-color: var(--primary); box-shadow: 0 0 0 3px rgb(59 130 246 / 0.1) */
```

**"Build a modal"**
```css
/* Overlay */
position: fixed; inset: 0;
background: rgba(0, 0, 0, 0.7);
backdrop-filter: blur(12px);
z-index: 9999;
/* Content */
background: rgba(248, 250, 252, 0.95); /* dark: rgba(30, 41, 59, 0.95) */
backdrop-filter: blur(16px);
border-radius: var(--radius-lg);
padding: var(--spacing-xl);
max-width: 1200px; max-height: 90vh;
box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
/* ::before gradient line at top */
```

### Iteration Guide — Maintaining Consistency

1. **Always use CSS custom properties** — no hardcoded colors. If a new color is needed, define it in `:root` and all four theme blocks.
2. **Match the radius tier** — `8px` for interactive elements, `12px` for containers. Never use arbitrary radius values.
3. **Include the transition** — `var(--transition)` on anything interactive. The cubic-bezier easing is the app's movement signature.
4. **Test dark mode** — if you only see one theme, you've only done half the work. Token-based colors handle most cases, but translucent values (`rgba`, `hsla`) need per-theme tuning.
5. **Respect the elevation stack** — page → surface → card → overlay → modal. Don't create new layers between these.
6. **Keep it compact** — StakTrakr packs maximum data into minimum space. If your component has more than `1.5rem` of padding, it's probably too spacious.
7. **Use semantic tokens** — `var(--success)` not `#059669`, `var(--bg-card)` not `#f8fafc`. This ensures theme switching works automatically.
