---
name: StakTrakr
description: Precious metals portfolio tracker. Track your stack.
colors:
  primary: "oklch(0.72 0.16 75)"
  primary-hover: "oklch(0.64 0.18 75)"
  secondary: "oklch(0.5 0.01 85)"
  success: "oklch(0.64 0.17 155)"
  info: "oklch(0.72 0.12 220)"
  warning: "oklch(0.72 0.16 80)"
  danger: "oklch(0.58 0.22 25)"
  success-text: "oklch(0.72 0.16 155)"
  warning-text: "oklch(0.78 0.15 80)"
  danger-text: "oklch(0.72 0.17 25)"
  gunmetal-base: "oklch(0.18 0.008 85)"
  gunmetal-raised: "oklch(0.22 0.008 85)"
  gunmetal-high: "oklch(0.28 0.007 85)"
  card: "oklch(0.22 0.01 85)"
  border: "oklch(0.32 0.008 85)"
  border-hover: "oklch(0.4 0.01 85)"
  text-primary: "oklch(0.95 0.005 85)"
  text-secondary: "oklch(0.8 0.008 85)"
  text-muted: "oklch(0.65 0.012 85)"
  text-inverse: "oklch(0.98 0 0)"
  metal-silver: "oklch(0.851 0.011 248.8)"
  metal-gold: "oklch(0.811 0.157 79)"
  metal-platinum: "oklch(0.961 0.003 264.5)"
  metal-palladium: "oklch(0.794 0.119 305.9)"
  metal-copper: "oklch(0.75 0.11 55)"
  light-primary: "oklch(0.623 0.188 259.8)"
  light-primary-hover: "oklch(0.546 0.215 262.9)"
  light-secondary: "oklch(0.663 0.03 267.4)"
  light-success: "oklch(0.596 0.127 163.2)"
  light-info: "oklch(0.685 0.148 237.3)"
  light-warning: "oklch(0.666 0.157 58.3)"
  light-danger: "oklch(0.577 0.215 27.3)"
  light-success-text: "oklch(0.48 0.11 163)"
  light-warning-text: "oklch(0.49 0.13 55)"
  light-danger-text: "oklch(0.5 0.19 27)"
  light-bg: "oklch(0.929 0.013 255.5)"
  light-bg-raised: "oklch(0.96 0.008 253.9)"
  light-bg-high: "oklch(0.869 0.02 252.9)"
  light-card: "oklch(0.984 0.003 247.9)"
  light-surface-alt: "oklch(1 0 0)"
  light-border: "oklch(0.711 0.035 256.8)"
  light-border-hover: "oklch(0.554 0.041 257.4)"
  light-text: "oklch(0.252 0.021 251.6)"
  light-text-muted: "oklch(0.376 0.031 246.9)"
  light-metal-silver: "oklch(0.509 0.022 262.9)"
  light-metal-gold: "oklch(0.507 0.134 48.2)"
  light-metal-platinum: "oklch(0.446 0.026 256.8)"
  light-metal-palladium: "oklch(0.495 0.22 293)"
  light-metal-copper: "oklch(0.52 0.115 50)"
  brand-gold: "#d4a017"
  brand-silver: "#e2e8f0"
  brand-navy: "#0f1729"
typography:
  display:
    fontFamily: "Instrument Serif, Georgia, Times New Roman, serif"
    fontSize: "1.875rem"
    fontWeight: 400
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Instrument Serif, Georgia, Times New Roman, serif"
    fontSize: "1.25rem"
    fontWeight: 400
  body:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Geist, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
  data:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Cascadia Code, Menlo, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "20px"
  pill: "999px"
spacing:
  xs: "0.2rem"
  sm: "0.4rem"
  md: "0.5rem"
  base: "0.75rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1.5rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.md}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.md}"
  input:
    backgroundColor: "{colors.gunmetal-base}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0.75rem"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
  spot-card:
    backgroundColor: "{colors.gunmetal-base}"
    rounded: "{rounded.lg}"
  filter-chip:
    rounded: "{rounded.pill}"
    padding: "{spacing.sm}"
  modal:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "{spacing.xl}"
---

<!-- The DESIGN.md format requires the bold North Star line and the "Do:" / "Don't:" headings. -->
<!-- markdownlint-disable MD026 MD036 -->

# Design System: StakTrakr

Product context (users, positioning, constraints) lives in `PRODUCT.md`. This file is the visual system.
On any conflict, `css/styles.css` wins and this file is corrected.

## Overview

**Creative North Star: "The Assay Office"**

StakTrakr is where physical metal gets weighed, tested and recorded. Every surface behaves like an
assayer's instrument: it shows the measurement, the reference value and the difference, and it does not
decorate them. Screens are dense on purpose. The serious stacker reads many numbers at once and compares
them, so tables, tickers and spot cards carry the page.

The material is warm gunmetal lit by gold. Neutrals in the dark theme sit at hue 85 with very low chroma,
so greys read as metal rather than as blue screen. The five metal colours and the eleven vendor hues are
identification marks, not decoration. Gold is the one accent that carries brand, and it is rationed.

Components are machined and exact: tight radii, crisp 1px borders, flat surfaces separated by tonal steps,
and tabular numerals wherever numbers line up. Depth is reserved for layers that sit above the page:
modals, popovers and menus.

**Key Characteristics:**

- Dense, scan-first layouts: tables, ticker, spot cards and ledgers are primary surfaces.
- Warm gunmetal neutrals with a gold primary in the dark theme.
- Metal and vendor colours are fixed identification systems.
- Instrument-like controls: flat, bordered, small radii, numerals aligned.
- Four themes (dark, light, slate, sepia) with one identity.

## Colors

The palette is warm metal neutrals plus functional colour: one gold accent, five metal identifiers,
eleven vendor identifiers, and gain, loss and status signals.

The frontmatter records the dark theme, which new components are authored against first, and the light
theme under `light-*` keys, which is the first-load default and the theme the detector renders. Each
theme redefines the same tokens in `css/styles.css`: `:root` (light), then the `[data-theme="dark"]`,
`[data-theme="slate"]` and `[data-theme="sepia"]` blocks.

- Light: cool slate-grey surfaces with a blue primary.
- Dark: warm gunmetal surfaces with a gold primary.
- Slate: the Tailwind Slate hex palette with a blue primary, kept as the original dark look.
- Sepia: parchment and linen surfaces with a copper-brown primary.

### Primary

- **Assay Gold** (`primary`): buttons, links, active states and the focus ring in the dark theme. It also
  colours `h1`. Hover deepens it (`primary-hover`).

### Secondary

- **Gunmetal Grey** (`secondary`): neutral and secondary buttons, the weight column accent.

### Tertiary

- **Signal set** (`success`, `info`, `warning`, `danger`): fills, borders and icons for gain, retail,
  caution and loss or destructive actions. Status words use the `*-text` variants, which every theme sets
  at 4.5:1 or more on the secondary background.

### Neutral

- **Gunmetal Base** (`gunmetal-base`): page background and input fields.
- **Gunmetal Raised** (`gunmetal-raised`) and **Card** (`card`): elevated surfaces and cards.
- **Gunmetal High** (`gunmetal-high`): tertiary surfaces, dropdowns, hover rows.
- **Machined Edge** (`border`, `border-hover`): 1px dividers and control borders.
- **Bright Metal** (`text-primary`), **Brushed** (`text-secondary`), **Patina** (`text-muted`): the text
  ramp. Muted text is for metadata, never for known vendor names.

### Metal and vendor identification

- **Metals** (`metal-silver`, `metal-gold`, `metal-platinum`, `metal-palladium`, `metal-copper`): badges,
  chart series and card accents. Each theme tunes them for contrast against its own background.
- **Vendors**: the `--vendor-*` tokens in `css/styles.css`. Each vendor keeps one hue in every theme (APMEX
  blue, JM Bullion amber, SD Bullion emerald, Monument violet, Hero Bullion red, BullionX pink, Summit
  cyan, Goldback deep gold, Provident lime, Gainesville orange, MintBuilder indigo). The shade changes per
  theme so labels reach 4.5:1.
- **Brand** (`brand-gold`, `brand-silver`, `brand-navy`): the wordmark and logo only. These do not shift
  with the theme.

### Named Rules

**The Fixed Identity Rule.** A metal or vendor never changes hue between views or themes. Users learn the
mapping, so a remap is a regression.

**The Rationed Gold Rule.** Gold is the brand accent. It marks the primary action, the active state and
the wordmark. It does not fill large areas or decorate headings beyond `h1`.

**The Function First Rule.** Every colour on screen identifies a metal or vendor, signals gain, loss or
status, or marks the primary action. Colour with no job is removed.

## Typography

**Display Font:** Instrument Serif (with Georgia, Times New Roman)
**Body Font:** Geist (with -apple-system, Segoe UI, Roboto)
**Label/Mono Font:** Geist Mono (with ui-monospace, SF Mono, Menlo)

**Character:** An engraved serif for titles, like the lettering on a mint certificate, over a precise
geometric sans for the working interface. Numbers use the mono face so columns align.

All three faces are self-hosted in `fonts/` with `font-display: swap`. Sizes use the `--font-size-*`
tokens; there are no fluid type sizes in product UI.

### Hierarchy

- **Display** (400, 1.875rem, tracking -0.025em): `h1`, coloured with the primary token.
- **Headline** (400, 1.25rem): `h2` and `.section-title`, including modal headers.
- **Body** (400, 0.8125rem, line-height 1.6): default component text. Inputs and selects step up to 1rem.
- **Label** (500, 0.875rem): form labels and emphasised body text. Badges and metadata use 0.6875rem to
  0.75rem.
- **Data** (Geist Mono, tabular numerals): prices, weights, quantities and gain/loss.

### Named Rules

**The Regular Serif Rule.** Instrument Serif ships at weight 400 only. Never set it bold or synthesise a
bold.

**The Aligned Figures Rule.** Any column or stack of numbers uses the mono face or tabular numerals, so
digits line up for comparison.

## Layout

The app is one page with tabbed views: the inventory table and cards, Market, Collections and Settings,
plus modals for Item detail and editing. Containers fill the width on desktop. Wide tables scroll inside
their own container, never the page.

Spacing follows the `--spacing-*` scale (0.2rem, 0.4rem, 0.5rem, 0.75rem, 1.25rem, 1.5rem). Standard
padding is 0.75rem. Cards and modals pad at 1.5rem.

The main breakpoints are 768px (tablet and phone landscape), 640px and 480px (phones) and 1350px (wide
desktop). The code holds other one-off values; new work uses 480px, 768px, 1024px and 1350px. Below
768px, cards stack in one column and controls keep a 44px touch target.

A control whose visible box is smaller than 44px gets a centred `::after` hit area of at least 44px,
and neighbouring controls sit far enough apart that the hit areas do not overlap. Values never end in an
ellipsis: a price, total or label wraps or moves to its own line. Below 768px, Dashboard text is at least
12px, set with `max()` so a larger user font size still applies.

### Named Rules

**The Density Rule.** Show the data. A surface does not trade visible information for whitespace or hide
it behind an extra click.

## Elevation & Depth

The page is flat and tonal: background, raised surface and high surface are separated by lightness steps
and 1px borders. Shadows mark layers that sit above the page.

### Shadow Vocabulary

- **Resting** (`--shadow-sm`): spot cards and small raised controls.
- **Lifted** (`--shadow`): button hover and popovers.
- **Overlay** (`--shadow-lg` and the modal stack in `css/styles.css`): modals and menus.

Each theme sets its own shadow opacity in `css/styles.css`.

### Named Rules

**The Flat Page Rule.** Surfaces on the page are flat at rest. A shadow appears only for a layer above the
page or as a hover response.

**The No Glass Rule.** The frosted-glass treatment (`backdrop-filter` blur on `.modal`, `.modal-content`
and the image badge overlay) is debt, not identity. New work does not add glass. Surface passes may remove
it.

## Motion

Shared control feedback uses `--transition-timing`: `0.2s cubic-bezier(0.4, 0, 0.2, 1)`.
`--transition` is a complete list for background colour, text colour, border colour, shadow, opacity and
transform. Use the timing token after an explicit property name; use the complete token on its own.
Layout properties are excluded. Reduced motion forces transition duration and delay to zero, preserving
immediate state and theme feedback.

Continuous motion stops on request. The best-price ticker holds still under hover or focus and has a pause
button. Under reduced motion it shows one scrollable row, and the spot sparklines draw without animation.

## Shapes

Corners are tight and consistent: 4px for small elements, 8px for buttons, inputs and chips, 12px for
cards and modals, 20px for large containers, and full pills for filter chips and segmented toggles.
Borders are 1px on surfaces and 2px on form fields.

## Components

### Buttons

- **Shape:** gently squared corners (8px), minimum height 2.75rem.
- **Primary:** primary fill with inverse text, 0.75rem by 1.5rem padding, weight 500.
- **Variants:** danger, success, info and secondary swap the fill token. Filter toggles use the pill
  shape.
- **Hover / Focus:** the fill deepens to the hover token with a 1px lift and the lifted shadow. The light
  sweep on hover (`.btn::before`) is debt and is not added to new buttons.

### Chips

- **Style:** pill-shaped filter chips for metal, type and tag filters. Metal chips use the metal tokens.
- **State:** the active chip takes the primary fill or the active outline token.

### Cards / Containers

- **Corner Style:** 12px.
- **Background:** card token on a gunmetal page.
- **Shadow Strategy:** flat or resting shadow; see Elevation & Depth.
- **Border:** 1px border token.
- **Internal Padding:** 1.5rem.

### Inputs / Fields

- **Style:** 2px border token, 8px radius, page background, 0.75rem padding.
- **Focus:** the border shifts to the primary token with a soft ring.
- **Error / Disabled:** status uses the danger tokens; disabled controls dim with muted text.

### Navigation

- **Style:** a header bar with the compact wordmark and tab buttons for the main views. The active tab
  takes the primary token. On mobile the controls wrap and keep 44px targets.

### Spot Cards and Ticker

The signature component. Each metal has a card with its spot price, change and a sparkline in its own row
below the change line, so no text sits on the chart. The price is in the primary text colour with an arrow
glyph; only the change line carries gain and loss, in the `*-text` tokens. The ticker repeats the figures
in one line with neutral prices and status-coloured premiums. Both use the data face and the metal colours.
The ticker's edge fades hold the frame colour solid for their first 16px, so no chip text shows within 8px
of the border, even when the strip is held still.

### Your Stack

"Your stack" is one card below the spot cards and above the ticker: the stack figures on top, a 1px rule,
then the totals ledger. It is a flat frame on the secondary background with no accent border and one
Instrument Serif title. The ledger has no heading of its own; a visually hidden caption names it.

Five figures in the data face read in this order, on screen and in the page: the lead value, the other
value, Gain on cost, Cost basis and Realized. Retail value leads by default; a 26px round swap button in
the lead's label (44px hit area) swaps it with Melt value, and the choice is saved. The lead sits at 2.5rem
with today's change under it ("today at spot" under the retail lead). The other four share the rest of
the row at 1.25rem, each with a line of context: the Items priced at spot, or retail's premium over melt;
the gain percentage at the lead's basis; the average cost per ounce; and the realized percentage on the
cost of the Items that left the stack. Only the change, gain, premium and realized carry the `*-text`
status colours. Realized hides with the Show Realized setting, and the other figures widen to fill the row.

A "Weight held" column to the right, behind a 1px rule, lists each held metal in Metal Order: the ledger's
metal mark, the name, the ounces and the 12-month pace ("+0.083 oz/mo" or "No buys"). Below the figures, a
line reads the last 12 months: the amount added, the acquisitions and the market change. Below 768px the
lead takes the full width, the other four fill two columns, and the activity line and the weights list
(under a rule) follow. With no Items the card shows "No Items yet." and Add Item, and the ledger hides.

The spot price section draws no panel of its own: each spot card carries the frame.

The header, spot cards, ticker, Your stack card and footer share the secondary background, so the
Dashboard reads as one set of frames one step off the page. The ratio chips on the spot cards take an
opaque fill one step lighter than the card: the card token in light and sepia, the tertiary token in dark
and slate.

### Totals Ledger

The totals are one table inside the Your stack card, with no shadow and no nested cards. Its outer columns
align with the figures above. Each metal the user holds has a row, in Metal Order; All Metals is the
footer, set off by a 2px rule and bold figures. Columns are Items, Weight, Avg cost/oz, Paid, Melt, Retail, Gain and Realized. Figures
use the data face with tabular numerals, right-aligned, so decimals line up down each column. Gain is the
bold column and the only one in the `*-text` status colours. Each metal name carries its colour dot. A
click anywhere on a row, All Metals included, opens the details modal; the row shows a pointer and the
tertiary surface on hover. The metal name is the row's only keyboard stop. The table ends on the All Metals
row, with no footnote. Below 768px each metal is a two-line block: name, melt and gain, then Items, ounces
and the amount paid.

The approved end state of the Dashboard is `playground/STRK-485-dashboard-end-state.html`.

## Do's and Don'ts

### Do:

- **Do** author new components against the dark theme first, then check light, slate and sepia.
- **Do** use `var(--token)` for every colour, size, radius and space. Raw colour literals in `js/` fail
  lint.
- **Do** set prices, weights and quantities in the data face with aligned figures.
- **Do** keep text at 4.5:1 or more in all four themes, using the `*-text` tokens for status words.
- **Do** keep 44px touch targets below 768px.

### Don't:

- **Don't** add glass blur, neon glows, gradient text or purple-to-blue gradients (crypto and Web3
  anti-reference).
- **Don't** use oversized rounded cards or airy startup-dashboard spacing (generic fintech
  anti-reference).
- **Don't** fall back to a bare grid of numbers with no metal colour, hierarchy or brand (spreadsheet
  anti-reference).
- **Don't** remap a metal or vendor to a different hue.
- **Don't** use colour as the only signal of state; pair it with a label or icon.
- **Don't** add a fifth theme or reference a contrast theme; there are four.
