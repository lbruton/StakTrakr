---
spec: "{{ISSUE-ID}}-{{SLUG}}"
phase: approach
created: {{DATE}}
---

# {{ISSUE-ID}} — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

_1–3 paragraphs describing the shape of the solution. Where the new code lives, what it talks to, what changes flow through it._

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | _e.g. Use existing FooClient instead of new HTTP layer_ | Less code, consistent retry behavior | Coupled to FooClient's auth scheme |
| D-2 | … | … | … |

## File Map

_Every file this spec will create, modify, or delete. Tasks.md will reference these paths._

### New
- `path/to/new-file.ts` — purpose
- `tests/new-file.test.ts` — coverage for above

### Modified
- `path/to/existing.ts` — what changes (1 line)
- `config/whatever.json` — add field X

### Deleted
- `path/to/deprecated.ts` — replaced by new-file.ts

## Data / Schema Changes

_If any. Otherwise: "None — no schema, migration, or persisted-data changes."_

- Field X added to Type Y — backfill not needed because …
- _none_

## Tradeoffs Surfaced for Review

_Decisions worth flagging to the user before tasks.md commits to them. Skip if there are none._

- We're choosing simplicity over generality on D-1; if pattern repeats elsewhere, this becomes a refactor target.
- …

## UI Contract

_If this spec involves UI work (new views, modals, interactive components, layout changes), fill in this section. If the spec is purely backend/data/config, write "N/A — no UI surface" and move on._

_The UI Contract is the **binding specification** for design fidelity. Tasks and tests must trace back to this section, not to prose in the ACs alone. An implementer who follows the tasks but ignores this contract has not completed the work._

### Mockup Artifacts

_List every mockup, prototype, or playground file that defines the visual/interaction contract. These are required reading for anyone implementing or reviewing this spec._

| Artifact | Path / URL | What it defines |
|----------|-----------|-----------------|
| _e.g. Trade linking playground_ | `playground/{{ISSUE-ID}}-trade-linking.html` | _All states: empty, search, selected, linked, inline edit_ |
| … | … | … |

### Named States / Screens

_Enumerate every distinct visual state the UI must support. Each state becomes a verification target at closeout._

| State | Description | Mockup reference |
|-------|-------------|-----------------|
| _e.g. Empty state_ | _No linked items, CTA button visible_ | _Playground: initial load_ |
| _e.g. Search active_ | _Item picker open, filter input focused_ | _Playground: after clicking "Link Item"_ |
| … | … | … |

### Component / Token Requirements

_Exact CSS classes, design tokens, component names, icon identifiers that the implementation MUST use. Generic or improvised styling is a defect if this section specifies the contract._

- _e.g. `.chip-pill` for linked item badges (not generic `.badge`)_
- _e.g. `--color-accent-gold` for highlight, not hardcoded hex_
- _e.g. `lucide:link` icon for the link action button_

### Interaction Contract

_Key interaction behaviors that must be preserved exactly as mocked. These go beyond "Given/When/Then" — they pin the HOW, not just the WHAT._

- _e.g. Inline edit remains inside the view modal — no separate edit page_
- _e.g. Amount auto-fill updates the existing field, does not append a second input_
- _e.g. Clicking a linked item name navigates to that item's detail view_

## Out of Scope (follow-up issues)

_Things that came up but don't belong in this spec. File these as separate issues; link them here._

- Future issue: _description_ (file under {{PROJECT}})
- _none_

## Risk Notes

_Specs don't carry full risk registers. Just call out anything that might bite during implementation._

- Risk: _description_ → mitigation: _action_
- _none_

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/spec-tasks {{ISSUE-ID}}`.
