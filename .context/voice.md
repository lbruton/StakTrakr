# Voice

StakTrakr applies the shared prose-core rule (`.claude/rules/prose-core.md`). This file sets the project
dials. Where the two differ, this file is stricter.

## Audience and register

- Readers are precious metals holders on a consumer app: casual stackers, investors and preppers. The
  maintainer and coding agents read the code and `.context/`.
- The register comes from the brand in `.impeccable.md`: sharp, capable, empowering. Write like a precision
  tool. State facts and numbers. Do not hand-hold, sell or cheer.

## Dials

- Em-dashes and stress: strictest. Use no em-dash asides and no bold, italics or capitals for stress in
  docs, comments, docstrings or UI copy.
- History and IDs: strictest. Comments, docstrings and `.context/` state the current constraint. Issue IDs,
  version numbers and change narratives go in commit messages, PR bodies and Plane.
- New and touched comments follow these rules. Untouched legacy comments are not rewritten in bulk.

## Comments and docstrings

- Write JSDoc on exported and top-level functions that other modules call. Keep it to 1 to 4 lines, plus
  `@param` and `@returns` where the types are not obvious.
- Do not write JSDoc on test callbacks or private helpers whose name says what they do.
- An inline comment states a constraint or an ordering requirement in 1 to 2 lines.

## README

- The README stays under 1,500 words. It keeps its sections: intro, features, getting started, privacy,
  tech stack, contributing.
- The README describes the current app. Release notes live in `CHANGELOG.md` and the in-app What's New.
- Bold marks only table row labels. Feature paragraphs use plain text.

## UI copy

- Toasts and alerts are short statements. Join two clauses with a full stop or a colon, not an em-dash:
  "Spot sync failed. Check the API settings."
- Name metals and units the way the app shows them: Gold, Silver, Platinum, Palladium, troy oz.
- Use the terms in `.context/GLOSSARY.md`.

## Exemptions

- `CHANGELOG.md` and the What's New entries in `js/about.js` hold history by design.
- Spec folders under `docs/specs/` carry issue IDs in their names and frontmatter.
- Agent instruction files (`CLAUDE.md`, `AGENTS.md`, rules, skills) may bold the leading keyword of a rule.
