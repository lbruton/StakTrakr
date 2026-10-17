# STRK-389 — Slot control research and follow-up

## Interaction choice

Use native buttons for Move up, Move down, and Add Slot after. No drag-and-drop or dependency is needed. Keep the actual row node, its image chooser and carried Slot id when moving. Explicitly restore focus after insertBefore; if the activated arrow becomes disabled at a boundary, focus the moved Slot label. Announce the label and new position through a polite status region. Insert a blank row after the chosen row and focus its label. Refresh boundary states and accessible names after insertion, removal, movement, and label edits.

Prototype: `playground/STRK-389-slot-controls.html`. A is recommended: adjacent arrows, separate insert action, wrapping action line on mobile. The contact sheet is for choosing control placement; the complete editor will be reviewed through the draft PR Cloudflare preview before merge.

## Sources

- Context7 `/mdn/content`: Node.insertBefore moves an existing node; Element.moveBefore additionally preserves browser-managed state, but the established insertBefore API with explicit focus restoration is sufficient here.
- [MDN insertBefore](https://developer.mozilla.org/en-US/docs/Web/API/Node/insertBefore)
- [WAI rearrangeable listbox example](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/examples/listbox-rearrangeable/): preserve focus on the moved item and provide position feedback. Apply those principles to form rows without introducing listbox roles.
- [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum): 24px minimum, with exceptions; prototype uses 36px desktop and 44px mobile arrow targets.

## Integrity and verification

Reserve all carried Slot ids before minting new ids; a duplicate-label insertion must never take an existing Slot id. Save DOM order to definition.slots. Verify primary Items, Spares, existing artwork, and pending image selections remain with their Slot after reordering. Verify Album/Ledger order, reverse view, save/reopen/reload, Cancel/close, new/cloned Collections, keyboard use, mobile width, and all four themes.

## Instruction drift to correct with the PR

- User confirms project DocVault is retired: project documentation is `.context/` and `docs/`; shared knowledge remains in Devops/DocVault. Correct active instructions pointing at project DocVault/Overview.md; preserve historical migration metadata.
- Shared start-patch skill still references a legacy mem0 tool and agent_id filtering. Use dynamically discovered hosted search with user_id and metadata.project.
- Shared ui-mockup skill incorrectly prescribes Bootstrap and only three themes. Use actual project components and four themes, and permit branch-preview review when explicitly selected by the user.
- Shared release skill version calculation ignores expired version high-water marks; project git-topology guidance is authoritative.

Shared skill corrections belong in their authored configuration repository; include project-local corrections in STRK-389 and link any separate shared-config PR. Do not edit vendor plugin caches.
