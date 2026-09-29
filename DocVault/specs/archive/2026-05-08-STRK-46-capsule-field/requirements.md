---
sketch: "STRK-46-capsule-field"
phase: requirements
created: 2026-05-08
---

# STRK-46 — Requirements

> **Source Issue:** [STRK-46](https://plane.lbruton.cc/lbruton/browse/STRK-46/)
> **Title:** Structured Capsule field + capsule notes
>
> Collectors who keep coins in capsules need to track which capsule fits each coin (Air-Tite X-38-Ring, H-32-DF, etc). Today this lives in Notes or Tags as free-form, which doesn't filter or group cleanly. Users frequently encounter wrong dimensions on Numista/dealer sites and have learned to keep their own measurements + capsule mappings. Source: Reddit ISO-Lost-Marbles Q10/Q11.

## Overview

Add two new fields — **Capsule** (short structured string) and **Capsule Notes** (free-text) — to StakTrakr's item data model. Position them in the Catalog Data section of the Edit/Create modals near Diameter/Thickness, grouping with physical-fit metadata. Supplement the plain input with a diameter-based capsule suggestion and autocomplete from a small static Air-Tite size lookup table plus the user's own previously-entered capsule values.

## User Stories

- **US-1:** As a collector who stores coins in capsules, I want a dedicated Capsule field on each item, so that I can record the exact capsule code (e.g. `X-38-Ring`) in a structured, searchable way instead of burying it in Notes.
- **US-2:** As a collector adding a new item, I want the app to suggest the nearest Air-Tite capsule size based on the coin's diameter, so that I have a starting point rather than guessing or looking it up elsewhere.
- **US-3:** As a collector with many capsule entries, I want autocomplete that draws from standard Air-Tite sizes AND my own previously-entered capsule values, so that I can quickly reuse known-good capsule codes.
- **US-4:** As a collector with edge-case capsule situations, I want a free-text Capsule Notes field, so that I can record workarounds like "Guardhouse 38mm — Air-Tite doesn't make this size" without polluting the structured field.

## Acceptance Criteria

### AC-1 — Capsule field persists and displays (maps to US-1)

- **Given** a user edits an existing item
- **When** they enter a value in the Capsule field and save
- **Then** the value persists in localStorage, appears in the View modal's Catalog Data section, and survives page reload

### AC-2 — Capsule field on Create (maps to US-1)

- **Given** a user creates a new item via the Add modal
- **When** they enter a Capsule value during creation
- **Then** the value is saved with the new item and visible immediately in the View modal

### AC-3 — Diameter-based suggestion (maps to US-2)

- **Given** an item has a Diameter value (from Numista import or manual entry)
- **When** the user opens the Edit or Create modal
- **Then** a suggestion appears near the Capsule field showing the nearest Air-Tite size and model code (e.g. "Suggested: A-32 (32mm)")
- **And** if the user changes the Diameter field, the suggestion updates dynamically

### AC-4 — Autocomplete from Air-Tite sizes (maps to US-3)

- **Given** the user focuses the Capsule input field
- **When** they begin typing
- **Then** an autocomplete dropdown offers matches from the static Air-Tite size table (e.g. typing "38" shows "A-38", "X-38-Ring", "H-38")

### AC-5 — Autocomplete from user history (maps to US-3)

- **Given** the user has previously saved capsule values on other items (e.g. "X-38-Ring", "Guardhouse 38mm")
- **When** they begin typing in the Capsule field on any item
- **Then** previously-used values appear in the autocomplete alongside the Air-Tite suggestions

### AC-6 — Capsule Notes field (maps to US-4)

- **Given** a user edits an item
- **When** they enter text in the Capsule Notes field and save
- **Then** the note persists and displays alongside the Capsule value in the View modal

### AC-7 — Layout integrity

- **Given** the Capsule and Capsule Notes fields are added to the Edit and Create modals
- **When** the modal is displayed on desktop and mobile viewports
- **Then** the existing layout of surrounding fields (Diameter, Thickness, Weight, etc.) is not disrupted

### AC-8 — Searchable and filterable

- **Given** items have Capsule field values
- **When** the user uses StakTrakr's search functionality
- **Then** Capsule values are included in the search index and items can be found by capsule code

## Non-Goals

- **Not building a full coin→capsule mapping database** — we provide diameter→capsule-mm suggestions and a static Air-Tite model list, not a per-coin-type lookup.
- **Not supporting Lighthouse/Leuchtturm capsule naming** — Air-Tite is the dominant US brand. Leuchtturm sizes are just mm values and will match the diameter suggestion naturally. Users can type any value they want.
- **Not adding capsule data to the inventory table columns** — the field lives in the Edit/Create/View modals only. Table column integration is a separate concern.
- **Not syncing capsule data via Numista import** — Numista doesn't carry capsule sizing. This is user-entered data only.
- **Not adding capsule fields to CSV import/export** — that's incremental and can be a follow-up.

## Open Questions

_All resolved during pre-sketch discussion:_

- [x] Pre-load a capsule dataset or let users populate? → **Hybrid:** small static Air-Tite mm-size table for autocomplete + diameter-based suggestion + user history. No full coin→capsule mapping.
- [x] Which capsule brands to support? → **Air-Tite model codes as the static list.** Field accepts any text, so Lighthouse/Guardhouse/generic mm values work fine.
- [x] Where in the UI? → **Catalog Data section** of Edit/Create modals, near Diameter/Thickness (per issue description).

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions resolved. Then advance: `/sketch discovery STRK-46`.
