---
library-version: 6f84ff770f80
---
# Prose-core rules

Writing rules for every code project. They apply to comments, docstrings, docs, UI copy, commit messages, PR
bodies and Plane text. The project's `.context/voice.md` sets the audience, the register and the dials. Its
`.context/GLOSSARY.md` sets the terms. A voice file may tighten these rules and name exemptions; it does not
relax them otherwise.

## Sentences

- Write one topic per sentence. An instruction has at most 20 words, a description at most 25.
- Use active voice and present tense. Write instructions as commands.
- Use simple words with one meaning. Use one term for one concept: the glossary term, where one exists.
- Keep the articles. Do not drop "the" and "a" to save space.
- Do not use idioms. Do not use contractions in docs and UI copy.

## Emphasis and rhetoric

- Do not use em-dash asides. Use a full stop, a colon or parentheses.
- Do not use bold, italics or capitals for stress in human-facing prose: docs, READMEs, comments, docstrings
  and UI copy.
- **Exception:** agent instruction files (CLAUDE.md, AGENTS.md, rules, skills) may bold the leading keyword of
  a rule. Use at most one bold span per bullet.
- Do not write punchlines ("this is not X, it is Y"), rhetorical questions or a closing summary of the text
  above.
- End on the constraint, not on a conclusion about it.

## State, not change

- Write the current state. Do not write "used to", "no longer", "now" (as in "since the last change") or bug
  stories.
- History goes in the commit message. In the repo, only a changelog holds history.
- Do not put issue IDs in comments, docstrings or current-state docs. Write the constraint that the ID points
  at. IDs go in commit messages, PR bodies, Plane, spec folders and report frontmatter.
- Do not state measurements from a run: timings, sizes, speedups, counts. Values the code depends on (limits,
  timeouts, constants) are allowed.

## Comments and docstrings

- Comment only what the code cannot express: a constraint, an ordering requirement, a reason that is not
  obvious. Do not narrate the next line.
- An inline comment has 1 to 2 lines. A docstring has 1 to 4 lines. A public API may add parameter docs in the
  project's docstring format.
- Say it once. The constraint lives at the function that enforces it. Other places refer to that function by
  name.
- Do not write `NOTE:`, `IMPORTANT:` or `CRITICAL:` prefixes. State the constraint.
- Do not write notes to a person: no task lists, "make sure", or justification of a change to a reviewer.
  Open work goes in a Plane issue. Open questions go in the PR description.

## UI copy

- Write instructions as commands: "Select one day.", not "Please select exactly 1 day".
- Do not use emoji, exclamation marks or "successfully". State the result: "Shift added."
- Do not ask "Are you sure?". Name the action and its effect: "Delete the API credentials? You cannot undo
  this."
- An error says what failed and what to do next. "Please try again." alone is not enough.
- A button label names the action ("Delete shift"), not "OK".

## Words to avoid

| Avoid | Use |
| --- | --- |
| utilize, leverage | use |
| facilitate | help, let |
| in order to | to |
| prior to | before |
| a number of | some, or the number |
| seamless, seamlessly | delete |
| robust | name the property (retries, validates input) |
| comprehensive, enterprise-grade, cutting-edge, powerful | delete, or state what it does |
| simply, just, easily | delete |
| very, really, basically | delete |
| successfully | delete |
| currently | delete; the text is current by default |
| note that, it is important to | state the rule |

## Commits, PRs and Plane

- Follow the repo's commit convention. The subject states what changed. The body says why and holds the
  history.
- PR bodies and Plane descriptions follow the sentence rules. Prefer short lists to paragraphs with asides.

## Vale

A repo with `.vale.ini` lints some of these rules with Vale. CI reports the alerts as warnings.

- **Before committing docs,** run `vale <files>` on the files you changed. Fix the alerts on lines you wrote.
- Leave alerts on lines you did not touch. Clean them up only when the task asks for it.
- The `vale-staged` hook (Claude Code and Codex) reports alerts on the lines a commit adds. Fix them in a
  follow-up commit before you push.
- An alert you judge wrong stays in the text. Say so in the PR description; do not edit the style in the repo.

## Exempt text

- Changelogs, which hold history by design.
- Generated reports whose purpose is to carry measurements.
- Quoted text, messages from other systems and code identifiers.

## Per-project voice

`.context/voice.md` is short. It names:

- the audience and the register;
- the comment budget and the docstring format;
- the README length and tone;
- UI copy rules beyond the ones above;
- exemptions specific to the project.

Link it from the repo's `CLAUDE.md`. Design tools that keep their own context file point at `voice.md`; they do
not copy it.
