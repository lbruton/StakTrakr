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

## Release announcements

A release announcement tells users what changed in a ship to `main`. Write it to
`docs/announcements/vX.Y.Z.md`. It is the source for the Reddit post on r/staktrakr and the summary at the
top of the GitHub Release. `CHANGELOG.md` keeps the developer detail.

Vale lints these files with the Prose and Announce styles. A draft with an alert is not ready to post.

### Reader

- Write to a stacker who last opened the app a month ago. Say what they can see or do, not how the code
  does it.
- Pick the 3 to 5 changes a user notices most. Group them by theme, not by patch. The full notes link
  covers the rest.

### Shape

The file has these parts in this order, and nothing else:

1. A title line: `# StakTrakr vX.Y.Z: <the main change in plain words>`, 80 characters or fewer.
2. One sentence that says what the release is about.
3. A list of 3 to 5 bullets. Each bullet holds one change in 20 words or fewer.
4. One line of links: the GitHub Release, the app and the subreddit.
5. One to three screenshots from the current build, each with a one-line caption that says what it shows.

The title, the sentence and the bullets stay under 150 words together.

### Rules

- Name what the user sees: screens, buttons, fields and metals, with the terms in `.context/GLOSSARY.md`.
- Do not name code: no function, file, class, test or setting key names, and no backtick code spans.
- Do not use issue IDs. The version number appears in the title only.
- Do not state internal measurements such as complexity, test counts or bundle sizes. A number the user
  sees in the app is fine.
- A fix states what works: "Duplicated items keep their Numista data." Do not tell the bug story.
- Do not open with a greeting or close with a sign-off, a question or a request for feedback.
- Do not use emoji, exclamation marks or questions.
- Do not sell. Avoid `excited to`, `thrilled`, `we've been hard at work`, `dive in`, `game-changer`,
  `level up`, `elevate`, `supercharge`, `packed with`, `whether you're`, `say goodbye to` and `stay tuned`.
  `.vale/styles/Announce/` holds the full list.

### Example

```markdown
# StakTrakr v3.37.0: one image editor for items and collections

This release brings items and Custom Collections onto the same image editor and fixes duplicate items.

- Items and collections share one image editor. Click a frame to upload a photo.
- Collection photos fit whole inside their frame without cropping.
- Collections show the retail value of the coins you own.
- Duplicated items keep their Numista data and the catalog fields you changed.

[Release notes](https://github.com/lbruton/StakTrakr/releases/tag/v3.37.0) · [Open StakTrakr](https://www.staktrakr.com) · [r/staktrakr](https://www.reddit.com/r/staktrakr/)

![The shared image editor in the Edit collection modal](images/v3.37.0-image-editor.png)
```

## Exemptions

- `CHANGELOG.md` and the What's New entries in `js/about.js` hold history by design.
- Release announcements name the version in the title line.
- Spec folders under `docs/specs/` carry issue IDs in their names and frontmatter.
- Agent instruction files (`CLAUDE.md`, `AGENTS.md`, rules, skills) may bold the leading keyword of a rule.
