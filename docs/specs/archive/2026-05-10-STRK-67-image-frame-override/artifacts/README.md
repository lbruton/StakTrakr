---
sketch: "STRK-67-image-frame-override"
phase: artifacts
created: 2026-05-10
---

# STRK-67 — Artifacts

Supporting materials referenced from the four phase docs. Not part of the phase boundary discipline — these can be added or revised at any time as long as they don't contradict an already-accepted phase artifact.

## Convention (sketch-skill extension)

Specflow has `artifacts/` as a sibling folder to its phase docs. The sketch skill hadn't formalized this; this folder is a working precedent. Pattern:

- **Location:** `DocVault/Projects/{project}/sketches/{ID}-{slug}/artifacts/`
- **Contents:** mockups, prototypes, screenshots, design exports, sample data, anything binary or HTML that doesn't fit cleanly into a markdown phase doc.
- **Linkage:** phase docs reference artifacts via relative path (`artifacts/<file>`). Tasks may use `Leverage: artifacts/<file>` lines.
- **Lifecycle:** travels with the sketch into `archive/` on `/sketch archive {ID}` — durable record of how the design got picked, not just the final answer.

If this convention proves out across a few more sketches, it should be promoted into the sketch skill template (add `artifacts/README.md` scaffold to `DocVault/sketch/templates/`, mention it in the phase prompts).

## Files

| File | Purpose | Referenced by |
|------|---------|---------------|
| `frame-toggle-mockups.html` | Interactive comparison of 4 corner-toggle UI variants for the per-side `obverseImageFrame` / `reverseImageFrame` override (AC-7). Self-contained single-file HTML — open directly in any browser; no build step. Click each variant's toggle to cycle through `auto / circle / rectangle` states and watch the slab image's clipping change end-to-end. **Outcome:** Variant A (single-glyph cycle button) selected — see commentary in `requirements.md` Open Questions. | `requirements.md` Open Questions (decision artifact). |
| `variant-a-in-modal.html` | Faithful reproduction of the production Add/Edit Inventory Item modal (mirroring `index.html:1858–1960` and `css/styles.css:3192–3329`, `9715–9744`) with Variant A's toggle integrated into both image preview slots. Includes a scenario switcher to demonstrate AC-8 (toggle hidden when slot is empty), live readout of the `obverseImageFrame` / `reverseImageFrame` field state, and the auto-resolution rule firing in real time. Use this to evaluate sizing, contrast, and placement against the real modal context — not a colored-box mockup. | `requirements.md` Open Questions (final UI fidelity check); will become a Constraint in `discovery.md`. |

## How to use

1. Open `frame-toggle-mockups.html` in a browser (double-click, or `open frame-toggle-mockups.html` from this folder).
2. Click the toggle on each of the four variant cards. Note which feels right at rest, on focus, and after interacting.
3. Cross-reference the trade-off recap table at the bottom — it mirrors the four open questions in the variant grid.
4. Pick a winner. Note it as a comment in the requirements.md Open Questions section and strike the question mark.
5. Then run `/sketch discovery STRK-67`. The chosen variant becomes a constraint that discovery and approach must respect.

## What this artifact is NOT

- Not a final design spec. Implementation may refine spacing, exact glyphs, hover/focus rings, and accessibility details during the approach phase.
- Not the production UI's CSS. Colors are inlined here for portability; the real implementation will reuse StakTrakr's existing theme tokens (`var(--bg-primary)`, `var(--accent-gold)`, etc., from `css/themes.css`).
- Not a full accessibility audit. Tab order, ARIA, keyboard semantics, and reduced-motion handling are flagged in the mockup's "Open questions for the picker" panel and will be resolved in approach/tasks.
