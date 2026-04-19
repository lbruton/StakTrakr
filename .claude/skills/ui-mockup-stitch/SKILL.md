---
name: ui-mockup-stitch
description: Manual Google Stitch design workflow — Claude crafts the prompt and design brief, user pastes it into stitch.withgoogle.com, pastes back the result. Use when exploring a visually new component, layout direction, or redesign before committing to code. Triggers on "stitch", "stitch mockup", "stitch design", "visual concept", "design in stitch".
---

# UI Mockup — Google Stitch (Copy-Paste Workflow)

Visual concept exploration using Google Stitch. Claude writes the prompt, you paste it into [stitch.withgoogle.com](https://stitch.withgoogle.com), iterate there, and paste back the result.

No MCP, no API — just high-quality prompts and your browser.

## When to Use This vs `/ui-mockup`

| Use this (`/ui-mockup-stitch`)                            | Use `/ui-mockup`                           |
| --------------------------------------------------------- | ------------------------------------------ |
| Building something visually new with no codebase analogue | Iterating on an existing component pattern |
| Exploring multiple layout directions before writing code  | Quick prototype during a spec or `/gsd`    |
| Major redesign of an existing page section                | Minor layout or styling adjustment         |
| You want visual options to compare before committing      | You already know what it should look like  |

## Workflow

### Step 1 — Understand what needs to be designed

Ask the user:

- What component/page/section are we designing?
- Is this a redesign of something existing, or entirely new?
- Are there reference screenshots or existing components to match?
- What data will this display? (specific fields, counts, states)

### Step 2 — Read codebase design context

Before writing the Stitch prompt, gather real values from the codebase:

- **CSS variables**: Read `css/` files for `--primary`, `--bg-secondary`, `--text-muted`, `--card-bg`, etc.
- **Theme states**: light/dark/sepia values for the relevant variables
- **Existing patterns**: Read analogous components for spacing, border-radius, shadow patterns
- **Data shape**: Read JS files to understand the actual data fields, types, and realistic sample values

### Step 3 — Craft the Stitch prompt

Build a comprehensive prompt structured as a **Design Brief**. This is the core deliverable of this skill.

**Template:**

```markdown
# [Component Name] — Design Brief for Google Stitch

## App Context

StakTrakr is a precious metals inventory tracker. Single-page PWA with a 4-state
theme system (light/dark/sepia/system). Design language: glassmorphic transparent
overlays, pill-shaped buttons (border-radius: 999px), CSS variable theming,
8px border-radius on cards, subtle 1px borders.

## Design System Values

- Primary: #3b82f6
- Card background (dark): rgba(255,255,255,0.03)
- Card border (dark): rgba(255,255,255,0.1)
- Card background (light): #f8fafc
- Card border (light): #cbd5e1
- Text primary (dark): #f1f5f9
- Text muted: var(--text-muted)
- Button style: pill-shaped, border-radius: 999px
- Card radius: 8px
- Font stack: system-ui, -apple-system, sans-serif

[Add any component-specific CSS values read from the codebase]

## Component to Design

[Detailed description of what to generate]

## Data Elements

[Every field, badge, stat, label, and interactive element this component displays]

## States Required

- **Populated**: [describe with sample data]
- **Loading**: skeleton shimmer placeholders
- **Empty/No data**: [describe empty state message and CTA]
- **Error**: [describe error state]

## Interactions

- [Hover effects]
- [Click targets and what they do]
- [Expand/collapse behavior]
- [Scroll behavior if applicable]

## Layout Constraints

- [Width: full-width, fixed, responsive breakpoints]
- [Position: within a tab, modal, sidebar, main content]
- [Adjacent components it must harmonize with]

## Generate For

- Dark mode (primary view)
- Light mode variant
```

### Step 4 — Present the prompt to the user

Output the complete prompt in a fenced code block and tell the user:

> **Stitch prompt ready.** Copy the block above and paste it into [stitch.withgoogle.com](https://stitch.withgoogle.com).
>
> After Stitch generates the screen:
>
> 1. Generate a few variants if you want options
> 2. Screenshot or export the one(s) you like
> 3. Paste the screenshot back here and tell me what you liked or want changed
>
> I'll use your approved direction to build the playground prototype.

### Step 5 — Receive and process Stitch output

When the user pastes back a screenshot or describes what Stitch generated:

1. **Analyze the visual** — identify layout, spacing, color choices, component structure
2. **Map to implementation** — note which CSS variables, Bootstrap classes, and existing patterns can achieve this
3. **Call out gaps** — if Stitch generated something that conflicts with the existing design system, flag it
4. **Ask for approval** — confirm which elements to keep, modify, or reject

### Step 6 — Iterate or hand off

**If more iteration needed:** Craft a refined Stitch prompt incorporating the user's feedback. Present it for another paste cycle.

**If approved:** Hand off to `/ui-mockup` (playground step) or directly to implementation:

- Pass the approved visual direction as the spec
- Include specific CSS values, spacing, and layout decisions from the Stitch output
- Reference the screenshot for any ambiguous visual details

---

## Prompt Crafting Tips

| Do                                                 | Don't                                   |
| -------------------------------------------------- | --------------------------------------- |
| Include exact CSS values from the codebase         | Use generic "dark theme" descriptions   |
| Describe every data element with realistic samples | Use placeholder text like "Lorem ipsum" |
| Specify all states (loading, empty, error)         | Only describe the happy path            |
| Name adjacent components for harmony               | Design in isolation                     |
| Request dark mode as primary, light as variant     | Forget to specify which theme           |
| Describe interactions explicitly (hover, click)    | Assume Stitch will infer interactivity  |

## Common Mistakes

| Mistake                                                   | Fix                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| Vague prompt ("make a card for metals")                   | Include data fields, states, dimensions, theme values         |
| Skipping codebase context read                            | Always read CSS variables and existing patterns first         |
| Designing for one theme only                              | Always request dark + light variants                          |
| Accepting Stitch output that conflicts with design system | Flag conflicts and iterate or adjust during implementation    |
| Going straight from Stitch to production code             | Build a playground prototype first for interactive validation |
