# Product

<!-- impeccable:product-schema 1 -->

Prose rules for docs, comments and UI copy live in `.context/voice.md`. Domain terms (Item, Collection,
Slot, spot, retail, premium) follow `.context/GLOSSARY.md`.

## Platform

web

## Users

The primary user is the serious stacker: a hands-on holder of physical precious metals who tracks cost
basis, premiums, spot and retail value, and Collections in detail. Design decisions favour this user when
audiences pull apart.

Casual stackers who check what their stack is worth, and preppers who hold metal as a store of value, are
served by good defaults on the same surfaces. They do not get separate simplified views.

Users handle physical objects (coins, bars, rounds, notes, Goldbacks). Most use the app at home on a
desktop. Mobile use matters and every surface works at phone width.

## Product Purpose

StakTrakr tracks a physical precious metals inventory: what each Item is, what it cost, and what it is
worth at spot and at dealer retail. It also tracks progress through Collections. Success means the user
sees the state of their stack at a glance and can drill into any Item without leaving the page.

## Positioning

- Local-first with no account. Inventory lives in the browser. There is no account, email or server-side
  storage. Encrypted Dropbox backup is opt-in.
- Live dealer prices. Retail prices from many dealers, spot history and premiums sit next to the user's
  own holdings.
- Collections. Date-run and custom checklists with Slots, artwork and retail-aware gain/loss.
- Zero install and offline. One HTML page runs on `file://` and HTTP, with self-hosted fonts and no build
  step or CDN.

## Operating Context

- Main views: the inventory table and card views, the spot cards and ticker, the Market tab with dealer
  prices, the Collections hub, Album and Ledger, the Item detail modal with charts, and Settings.
- Typical sessions: adding a purchase, checking the stack value after a spot move, comparing dealer
  premiums, filling a Collection Slot, and exporting or restoring a backup.
- Data shown is real money: prices, weights, gain/loss and cost basis. Numbers are read and compared, so
  alignment and tabular figures matter.

## Capabilities and Constraints

- Vanilla JavaScript with script-tag globals, one HTML page, no framework and no build step.
- Runs on `file://` and HTTP. Fonts are self-hosted in `fonts/`. No CDN requests and no framework CSS.
- All styling lives in `css/styles.css` as custom properties. Four themes set by `[data-theme]` on
  `<html>`: `dark`, `light`, `slate`, `sepia`. Dark is primary and new components are authored against it
  first. There is no contrast theme.
- Metals: silver, gold, platinum, palladium and copper, plus Goldbacks.
- Storage is browser `localStorage` and IndexedDB. Cloud backup is AES-GCM encrypted before upload.
- Runtime changes to `css/`, `index.html` and `js/` follow the repo gates in `.context/git-topology.md` and
  `.context/testing.md`.

## Brand Commitments

- Name: `StakTrakr` in prose. The wordmark splits `STAK` and `TRAKR`; rules live in DESIGN.md.
- Logo assets: `images/icon-logo.svg`, `images/banner-logo.svg`, `images/banner-logo-compact.svg`.
- Taglines: "Track Your Stack" and "Precious Metals Portfolio Tracker".
- Personality: sharp, capable, empowering. A pro trading terminal and a precision instrument, not a toy.
  Users are in command of their data, not guided through a simplified flow.
- Anti-references:
  - Not generic fintech: no Robinhood or Mint look, no oversized rounded cards, no startup dashboard
    clichés.
  - Not crypto or Web3: no neon, no dark mode with glow, no futuristic styling, no gradient text.
  - Not a spreadsheet clone: tables are a primary display, but the app has its own visual identity.

## Evidence on Hand

- Screenshots from demo data: `npm run screenshots` writes the about and README set
  (`devops/screenshots/`).
- Marketing page: `about.html`. Release notes: the What's New entries in `js/about.js` and
  `docs/announcements/`.
- There are no testimonials, user counts or press quotes. Do not invent them.

## Product Principles

1. Information density over simplicity. Users want to see their data, not navigate to it. Do not hide
   information behind clicks.
2. Metallic, not digital. The product echoes physical metal: weight, lustre, solidity. It avoids the flat,
   pastel, airy look of modern SaaS.
3. Precision tool, not consumer app. Show real numbers and functional controls. No hand-holding onboarding
   and no reduced views.
4. Colour carries function. Colour identifies metals and vendors and signals gain, loss and status. Accents
   are earned, not decorative.
5. Four themes, one identity. Dark, light, slate and sepia each feel like StakTrakr, not like a generic
   theme toggle.

## Accessibility & Inclusion

- Text meets WCAG AA contrast (4.5:1) in all four themes, including status words and vendor labels.
- Interactive controls have a 44px minimum touch target on mobile.
- Colour is never the only indicator of state: labels and icons go with colour cues.
