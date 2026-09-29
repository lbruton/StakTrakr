---
sketch: "STRK-51-numista-import-modal-fields"
phase: requirements
created: 2026-05-07
---

# STRK-51 — Requirements

> **Source Issue:** [STRK-51](https://plane.lbruton.cc/lbruton/browse/STRK-51/)
> **Title:** Numista import modal: add ALL importable fields (diameter, thickness, mintage, etc.)
>
> The Numista import-confirmation modal ("Numista Item Found → Fields to fill") only shows 8 fields (Name, Catalog N#, Year, Type, Weight, Obverse Image, Reverse Image, Metal). Numista provides many more fields that StakTrakr stores — Diameter, Thickness, Mintage, Fineness, Composition, Shape, Orientation, Technique, Rarity Index, KM Reference, Country, Denomination, Commemorative flag, and descriptions — but these are not in the modal at all. Consequence: user-modified values are silently overwritten on re-sync because they never appear in the dialog and `userModified` tracking cannot protect fields that aren't shown.

## Overview

Expand the Numista import-confirmation modal to display **all** Numista-provided fields that StakTrakr already stores, so users can opt out of overwriting any stored field they've manually edited. The expanded field set includes the current 8 modal fields plus physical details, catalog/reference details, classification details, and Obverse/Reverse/Edge descriptions when Numista provides candidate values. Add scrolling to the modal body so the expanded field list remains usable on smaller screens. The PCGS import path should be checked during discovery for the same field-list gap, but PCGS implementation changes are out of scope unless discovery shows the same fix is trivially shared.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a StakTrakr user who manually corrects coin metadata (e.g. diameter to fit a capsule), I want every Numista-backed stored field I've edited to appear in the re-sync confirmation dialog, so that my corrections are not silently lost.
- **US-2:** As a StakTrakr user importing a coin for the first time, I want all available Numista-backed stored fields to be shown and defaulted to checked, so that I get the fullest possible metadata without extra steps.
- **US-3:** As a StakTrakr user on a laptop or smaller screen, I want the import modal to scroll when it becomes tall, so that I can still reach the Confirm/Cancel buttons.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 (maps to US-1)
- **Given** a coin whose diameter has been manually set to a custom value (e.g. 50mm)
- **When** the user triggers a Numista re-sync
- **Then** the import modal shows a "Diameter" row with the current 50mm value visible, the checkbox is **unchecked** by default (preserving the user's edit), and an "edited" badge is shown

### AC-2 (maps to US-1)
- **Given** a coin with user-modified thickness, mintage, fineness, composition, shape, orientation, technique, rarity index, KM reference, country, denomination, commemorative flag, Obverse description, Reverse description, or Edge description fields
- **When** the user triggers a Numista re-sync
- **Then** each field with a Numista candidate value appears in the modal with the current local value visible, the checkbox unchecked by default, and the edited badge shown

### AC-3 (maps to US-2)
- **Given** a first-time Numista import (no prior values exist)
- **When** the import modal opens
- **Then** all available Numista-backed stored fields with candidate values are listed and default to **checked**, and the user can uncheck any they don't want

### AC-4 (maps to US-3)
- **Given** the expanded import modal with 15+ field rows
- **When** the modal renders on a viewport shorter than the modal content
- **Then** the modal body scrolls independently; the header and action buttons remain fixed/sticky and always visible

### AC-5 (regression guard)
- **Given** the existing 8-field behavior (Name, Catalog N#, Year, Type, Weight, Obverse Image, Reverse Image, Metal)
- **When** any import (initial or re-sync) occurs
- **Then** those 8 fields continue to render, check/uncheck, and badge exactly as they do today

### AC-6 (missing value guard)
- **Given** Numista does not provide a candidate value for a stored field
- **When** the import modal opens
- **Then** that missing candidate does not overwrite the existing local value, and the modal does not present it as a checked overwrite option

## Non-Goals

- Not adding new fields to the StakTrakr data model — this sketch only surfaces fields that already exist in storage
- Not changing the Numista API integration or fetch logic — only the presentation layer in the import modal
- Not redesigning the modal UI beyond adding scroll and more rows
- Not implementing a general "field preferences" or "remember my choices" feature for import dialogs
- Not modifying the PCGS import modal beyond evaluating whether the same gap exists and whether a shared field-list helper would naturally cover it (if it does not, a follow-up issue may be filed)

## Open Questions

None for requirements. Discovery should verify the canonical field metadata source, the current modal scroll structure, and whether the PCGS path shares the same field-list gap.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-51`.
