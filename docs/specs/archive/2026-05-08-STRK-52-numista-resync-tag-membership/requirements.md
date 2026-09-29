---
sketch: "STRK-52-numista-resync-tag-membership"
phase: requirements
created: 2026-05-08
---

# STRK-52 — Requirements

> **Source Issue:** [STRK-52](https://plane.lbruton.cc/lbruton/browse/STRK-52/)
> **Title:** Numista re-sync: tags already on item are locked checked, can't be removed
>
> **Summary:** The Numista import modal currently renders tags already on the item as checked and disabled, preventing the user from opting out during re-sync. Product direction: catalog field checkboxes preserve saved item values when unchecked; tag checkboxes control membership only for tags Numista proposes in the current sync result. Manual-only tags not present in the Numista result stay untouched. Matching manual and Numista tags are treated as one logical tag with no duplicate and no per-tag source/provenance model. Existing on-item tags require a deliberate per-tag uncheck to remove and record in `itemRemovedTags`; bulk uncheck should not mass-remove existing tags. Removal/on-item detection must be case-insensitive, so manual `tree` and Numista `Tree` behave as the same tag.

## Overview

This sketch fixes the Numista re-sync tag picker so users can opt out of tags that are already on an item without changing the existing preserve-on-unchecked behavior for catalog fields. Today, existing tags appear checked but disabled, which makes the modal feel like Numista is forcing tags back onto the item. The desired behavior is simpler: catalog field checkboxes decide whether to overwrite saved field values, while tag checkboxes decide membership only for the tags Numista is proposing in the current result.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a collector re-syncing Numista data, I want tags already on my item to be visible but still removable, so that I can reject Numista tags that are wrong or no longer useful.
- **US-2:** As a collector with manual tags, I want my manual-only tags left alone during Numista re-sync, so that syncing catalog data does not unexpectedly clean up my personal organization.
- **US-3:** As a collector who manually added a tag that Numista also proposes, I want that matching tag treated as one existing item tag, so that I do not get duplicates or confusing source labels.
- **US-4:** As a collector editing catalog fields, I want unchecked field rows to keep my saved values, so that tag-membership changes do not make scalar field sync feel destructive.
- **US-5:** As a collector using bulk tag controls, I want "Uncheck all" to avoid mass-removing existing item tags, so that a convenience control cannot accidentally wipe my tags.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 (maps to US-1)
- **Given** an item already has a tag that is also present in the selected Numista result
- **When** the user opens the Numista import/re-sync modal
- **Then** that tag is shown as checked, enabled, and visibly marked as already on the item

### AC-2 (maps to US-1)
- **Given** an existing on-item Numista candidate is shown checked in the picker
- **When** the user leaves it checked and clicks Fill Fields
- **Then** the tag remains on the item and no removed-tag opt-out is recorded for that tag

### AC-3 (maps to US-1)
- **Given** an existing on-item Numista candidate is shown checked in the picker
- **When** the user directly unchecks that tag and clicks Fill Fields
- **Then** the tag is removed from the item and future Numista syncs remember the user's opt-out by showing it unchecked with the removed hint

### AC-4 (maps to US-2)
- **Given** an item has a manual tag that is not present in the selected Numista result
- **When** the user opens the Numista import/re-sync modal and clicks Fill Fields
- **Then** the manual-only tag is not shown in the Numista tag picker and remains on the item afterward

### AC-5 (maps to US-3)
- **Given** an item has a manually added tag whose text matches a tag in the selected Numista result
- **When** the user opens the Numista import/re-sync modal
- **Then** the matching tag appears once as a checked on-item tag, not as duplicate manual and Numista tags

### AC-6 (maps to US-3)
- **Given** an item stores a manual tag with different casing than the Numista candidate, such as `tree` vs `Tree`
- **When** the user unchecks that matching candidate and clicks Fill Fields
- **Then** the stored tag is removed case-insensitively and future Numista syncs treat that logical tag as opted out

### AC-7 (maps to US-1, US-3)
- **Given** a tag was previously removed from a Numista sync and appears unchecked with the removed hint
- **When** the user checks it and clicks Fill Fields
- **Then** the tag is re-added and the removed-tag opt-out is cleared

### AC-8 (maps to US-4)
- **Given** one or more catalog field rows are unchecked in the same Numista import/re-sync modal
- **When** the user clicks Fill Fields
- **Then** those unchecked catalog fields keep the item's saved values exactly as they did before this tag fix

### AC-9 (maps to US-5)
- **Given** the modal contains tags already on the item plus new or previously removed Numista candidate tags
- **When** the user clicks Uncheck all
- **Then** existing on-item tags remain checked unless the user directly unchecks them one by one

### AC-10 (maps to US-5)
- **Given** the modal contains blacklisted, removed, new, and existing on-item Numista candidate tags
- **When** the user uses Check all or Uncheck all
- **Then** the bulk controls preserve the existing protected states for blacklisted tags and do not create accidental removal of on-item tags

## Non-Goals

_Explicit list of things this sketch does NOT do. Each entry should make a future reader confident the omission was intentional._

- Not adding per-tag source/provenance metadata such as user-created vs Numista-created. Matching tag text is treated as one logical item tag.
- Not showing manual-only tags in the Numista picker when Numista does not propose them in the current result.
- Not changing how catalog/scalar field rows preserve saved item values when unchecked.
- Not changing the global auto-apply, blacklist, or removed-tag concepts beyond what is required for existing on-item tag opt-out.
- Not changing bulk metadata sync outside the user-facing picker behavior unless discovery finds this modal shares the same bug path.
- Not redesigning the full Numista import modal layout. Any chip/pill styling should support clarity for existing tags without turning this into a broader modal redesign.

## Open Questions

_Anything that blocks the next phase. Empty by the time discovery starts._

- None.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-52`.
