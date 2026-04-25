---
name: ui-mockup
description: Use when designing a new multi-element UI component (card grid, modal, panel, dashboard) where layout or visual hierarchy is uncertain, or when a plan references a "visually bare" component needing a design pass. Default mockup skill for spec workflow and /gsd sessions.
---

# UI Mockup — Playground Prototyping

Two gates before any production code is written:

1. **Playground** — interactive proof of concept in Bootstrap/vanilla JS (does this look and feel right?)
2. **Implementation** — integrate approved design into the codebase

Never skip to implementation until the user has approved the playground prototype.

For visual concept exploration with Google Stitch before building a playground, use `/ui-mockup-stitch` instead.

## Workflow

### Step 1 — Gather design context from the codebase

Before building the playground, read the relevant existing code to understand:

- Current CSS variables and theme values (`--primary`, `--bg-secondary`, `--text-muted`, etc.)
- Existing component patterns that the new component should match
- Data shape and realistic sample values
- All states the component needs: populated, loading skeleton, empty/no-data, error

### Step 2 — Build the playground prototype

Invoke the `playground` skill to build an interactive prototype.

The playground must use StakTrakr's actual tech stack:

- Bootstrap 5 classes and utility system
- CSS custom properties matching `--primary`, `--bg-secondary`, `--text-muted`, etc.
- `data-theme` attribute for theme switching (light/dark/sepia)
- Pill-shaped buttons (`border-radius: 999px`), 8px card radius, glassmorphic borders
- Realistic sample data (not lorem ipsum — use coin/metal names, prices, vendor names)

The playground should be interactive enough to validate the UX:

- All button clicks should respond (even if just a toast or state toggle)
- Hover and focus states visible
- All data states: populated, loading skeleton, empty/no-data, error

### Step 3 — Review with user

Present the playground output to the user:

> "Here's the interactive prototype. Try clicking around — does this feel right before I write the implementation plan?"

Iterate on the playground until the user approves.

### Step 4 — Extract the design spec

From the approved playground, document:

- Exact color values, spacing, border-radius decisions
- Component hierarchy and data layout
- Interaction states (hover, loading, empty)
- CSS delta: what changes from the current app baseline

### Step 5 — Hand off to implementation

Only after explicit user approval of the playground, proceed with:

- Playground file path (or inline CSS/HTML excerpts) as the implementation baseline
- Extracted CSS delta from Step 4
- Note: "Playground approved — proceed to implementation"

---

## Common Mistakes

| Mistake                                         | Fix                                                  |
| ----------------------------------------------- | ---------------------------------------------------- |
| Skipping theme context in the playground        | Always include light + dark mode CSS variables       |
| Forgetting empty/loading states                 | Build all data states into the playground            |
| Jumping to implementation without user approval | Wait for explicit sign-off on the playground         |
| Using lorem ipsum data                          | Use realistic coin/metal names, prices, vendor names |
