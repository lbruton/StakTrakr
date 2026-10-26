---
title: "StakTrakr: Design Philosophy"
project: StakTrakr
audience: agent
canonical: .context/design-philosophy.md
updated: "2026-10-25"
---

# StakTrakr: Design Philosophy

This page routes design work to the files that hold it. It restates none of their content.

| Need                                                   | File                                                   |
| ------------------------------------------------------ | ------------------------------------------------------ |
| Users, positioning, brand personality, anti-references | `PRODUCT.md`                                           |
| Tokens, type, layout, shapes, components, do and don't | `DESIGN.md`                                            |
| Generated token metadata and live-panel components     | `.impeccable/design.json` (written by Impeccable)      |
| Per-surface decisions (mode, layout, states)           | `.impeccable/surfaces/<surface>.md`                    |
| Critique and audit reports                             | `.impeccable/critique/`                                |
| Code-level CSS and modal rules                         | `.context/coding-standards.md` ("CSS & Design System") |
| Prose rules for UI copy                                | `.context/voice.md`                                    |
| Rendered component demo against the live stylesheet    | `.context/style.html` (demo, not an authority)         |

On any conflict, `css/styles.css` wins. Fix the doc.

## Working with Impeccable

Impeccable (`/impeccable`) is the design tool for this repo. It loads `PRODUCT.md` and `DESIGN.md`
itself.

- Before a surface changes, run `/impeccable critique <surface>` and `/impeccable audit <surface>`.
  Turn the findings into scoped Plane issues.
- Run `/impeccable shape <surface>` for structural work. For a UI spec, link the surface brief from the
  UI Contract in `approach.md`.
- Run `/impeccable polish <surface>` before the PR.
- The detector hook reports findings after edits to UI files. A finding in untouched legacy CSS does not
  require a fix in the same PR.
- Changes to `css/`, `index.html` and `js/` still follow `.context/git-topology.md` and
  `.context/testing.md`, with browser checks in all four themes.
- Update the vendored skill only with `npx impeccable update` in a chore PR.
