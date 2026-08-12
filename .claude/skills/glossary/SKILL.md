---
name: glossary
description: Domain glossary management for .context/GLOSSARY.md. Use when the user says /glossary, glossary harvest, glossary seed, glossary list, glossary search, update glossary, domain terms, canonical terms, aliases to avoid, naming ambiguity, or ubiquitous language.
user-invocable: true
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

# Glossary

Manage the project's shared vocabulary in `.context/GLOSSARY.md`. Use shell
search and direct file edits only; do not rely on MCP-only tooling for this
workflow.

## Modes

| Argument        | Mode    | Result                                                                                                                               |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| none            | harvest | Scan the current conversation for domain terms, cross-reference the glossary, propose additions, then apply only after confirmation. |
| `seed`          | seed    | Scan the codebase and docs for initial vocabulary, then propose 15-25 terms grouped by cluster.                                      |
| `list`          | list    | Read and display the glossary in a clean format with a term count.                                                                   |
| `search {term}` | search  | Find terms by canonical name, avoided alias, or partial definition match.                                                            |

## Always Start Here

1. Read `.context/GLOSSARY.md` if present.
2. Preserve the existing file structure and term format.
3. Treat existing canonical terms and `_Avoid_` aliases as binding unless the
   user explicitly asks to revise them.
4. For harvest and seed, propose changes first and wait for explicit
   confirmation before editing `.context/GLOSSARY.md`.

Term entry format:

```markdown
**Term Name**:
Definition sentence.
_Avoid_: alias1, alias2
```

Definitions should be one or two sentences, explain what the term is, and stay
specific to this project domain.

## Harvest Mode

Default when the user provides no arguments.

Process:

1. Scan the current conversation for project-specific nouns, feature names, data
   concepts, UI surfaces, user corrections, aliases, and ambiguous terms.
2. Compare each candidate with `.context/GLOSSARY.md`.
3. Skip candidates that are already defined and used consistently.
4. Flag candidates that conflict with an existing term or avoided alias.
5. Present proposed updates in a table:

```markdown
| Term             | Definition               | Avoid                | Action |
| ---------------- | ------------------------ | -------------------- | ------ |
| **Example Term** | One sentence definition. | old name, vague name | Add    |
```

Rules:

- Prefer 3-8 high-signal proposals over a long noisy list.
- If there are fewer than 3 real domain candidates, say so instead of padding.
- Do not include generic implementation vocabulary unless it has a
  StakTrakr-specific meaning.
- After confirmation, add new terms under the closest existing heading and add
  ambiguity notes only when they resolve a real naming conflict.

## Seed Mode

Use for new or thin glossaries, or when the user asks for vocabulary discovery.

Scan likely vocabulary sources with targeted shell commands:

```bash
rg -n "<h[1-6]|<button|aria-label|title=|placeholder=|summary>|legend>|label" index.html preview.html about.html
rg -n "function [A-Za-z0-9_]+|const [A-Z0-9_]+|let [A-Za-z0-9_]+|var [A-Za-z0-9_]+" js
rg -n "class=|id=|data-|localStorage|saveData|loadData|catalog|spot|inventory|trade|tag|vendor|goldback" index.html js css data docs .context
```

Also read high-value project docs when they exist:

- `README.md`
- `.context/GLOSSARY.md`
- `.context/coding-standards.md`
- `.context/design-philosophy.md`

Group proposals by natural clusters such as Inventory & Items, Disposition &
Lifecycle, Market Data & Pricing, Catalog & Enrichment, Cloud & Storage, UI, or
Infrastructure.

Rules:

- Propose 15-25 terms maximum.
- Prioritize vocabulary that appears in multiple surfaces or is used
  inconsistently.
- Include `_Avoid_` aliases when the codebase or docs already show competing
  names.
- Do not overwrite an existing seeded glossary without showing the delta first.

## List Mode

Read `.context/GLOSSARY.md` and render a concise summary:

```markdown
## StakTrakr Domain Glossary

### Group Heading

- **Term Name** - Definition sentence. Avoid: alias1, alias2.

N terms across M groups.
```

Count only entries matching `**Term Name**:` as terms. Exclude the Relationships
and Flagged Ambiguities bullets from the term count.

If the file is missing or has no terms, say that and suggest `/glossary seed`.

## Search Mode

Search argument is everything after `search`.

Match order:

1. Exact canonical term match, case-insensitive.
2. `_Avoid_` alias match, case-insensitive.
3. Partial match in canonical term, alias, definition, group heading, or
   ambiguity note.

Useful commands:

```bash
rg -n -i "search term|_Avoid_:.*search term|definition words" .context/GLOSSARY.md
```

Output each match with:

- canonical term
- definition
- avoid aliases, if any
- group heading
- why it matched, when the match was through an alias or ambiguity note

If the query matches an avoided alias, lead with the canonical term:

```markdown
Use **Disposition**. "disposal" is listed as an avoided alias.
```

If there is no match, say that plainly and offer harvest or seed as the next
step.

## Editing Rules

- Preserve headings, Relationships, and Flagged Ambiguities unless the requested
  change directly affects them.
- Insert new terms alphabetically only when the current group is already
  alphabetized; otherwise preserve the existing conceptual order.
- Keep aliases lowercase unless they are proper nouns, API names, or exact UI
  labels.
- Use project terminology from existing entries. For example, prefer Item,
  Disposition, Spot Provider, Catalog Provider, Vendor, Retail View, and Cloud
  Sync when those concepts apply.
- After edits, run:

```bash
rg -n "^\*\*.+\*\*:" .context/GLOSSARY.md
npx agentlinter --local
```
