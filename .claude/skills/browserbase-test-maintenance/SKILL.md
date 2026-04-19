---
name: browserbase-test-maintenance
description: Add new tests to the StakTrakr runbook after implementing a spec. Guides agents to identify the correct section, write test blocks in the standard format, append to tests/runbook/*.md, and verify by running the affected sections.
trigger: After completing feature implementation, bug fixes, or Phase 5 of any spec
allowed-tools: Read, Write, Edit, Bash, mcp__browserbase__browserbase_session_create, mcp__browserbase__browserbase_stagehand_act, mcp__browserbase__browserbase_stagehand_extract, mcp__browserbase__browserbase_screenshot, mcp__browserbase__browserbase_session_close
---

# Browserbase Test Maintenance Skill

## When to Use This Skill

Automatically trigger after:

- Implementing a new feature (especially UI features)
- Fixing a user-facing bug
- Adding new Settings tabs, modals, or form interactions
- Phase 5 of any spec-workflow spec (mandatory gate)
- User explicitly requests adding Browserbase tests

---

## IMPORTANT — Test Files Have Moved

> ## Tests Are No Longer in TypeScript Files
>
> **DO NOT** add new test steps to `tests/browserbase/*.ts` — those files are LEGACY/ARCHIVED.
>
> **All new tests go into `tests/runbook/*.md` section files.**
>
> The runbook is committed to the repo and grows with every shipped spec.

If you find yourself looking at `tests/browserbase/test-basic-ui-flow.ts` or `tests/browserbase/test-goldback-flow.ts`, stop. Do not add to those files. Open the relevant file in `tests/runbook/` instead.

---

## Step 1 — Review Implementation Logs

Read the spec's implementation logs from `.spec-workflow/specs/{specName}/Implementation Logs/` before writing any test blocks.

Understand:

- What user-facing features changed
- Which UI components were added or modified
- What user journeys are now different
- Which JavaScript files were touched (maps to UI areas)

For example: if `js/market.js` was modified, affected sections include `05-market.md`. If `js/backup.js` was touched, look at `03-backup-restore.md` and `04-import-export.md`.

---

## Step 2 — Identify Affected Sections

Map implementation changes to runbook section files in `tests/runbook/`:

| Changed Area                                                        | Runbook Section File   |
| ------------------------------------------------------------------- | ---------------------- |
| Page load, initial render, API backfill, What's New modal           | `01-page-load.md`      |
| Add/Edit/Delete items, search, filter chips, card views, melt value | `02-crud.md`           |
| Backup, restore, export/import ZIP/JSON/CSV, encrypted vault        | `03-backup-restore.md` |
| CSV import, eBay import, merge diff viewer, PDF export              | `04-import-export.md`  |
| Market panel, price history, market search, tabs, source badges     | `05-market.md`         |
| Responsive layout, themes, currency switcher, settings modal        | `06-ui-ux.md`          |
| Activity log panel, log entries                                     | `07-activity-log.md`   |
| Spot price cards, stale indicators, melt values, Goldback price     | `08-spot-prices.md`    |

If the new feature does not fit any existing section: create a new section file following the `NN-feature-name.md` naming convention with the next available number (e.g., `09-numista.md`). Give it a section header matching the pattern used in existing files.

---

## Step 3 — Write Test Blocks

Use the EXACT standard format. All 7 fields are required. Missing any field will cause the `/bb-test` skill to skip or misparse the test block.

```md
### Test N.M — {Test Name}

_Added: v{VERSION} ({STAK-XXX})_
**Preconditions:** {what must be true before this test runs}
**Steps:**

- act: "{atomic natural language Stagehand instruction}"
- extract: "{what to assert}" → expect: {expected value or condition}
- screenshot: "{NN}-{section-short}-{description}"
  **Pass criteria:** {plain English statement of what constitutes a pass}
  **Tags:** {comma-separated tags}
  **Section:** {NN-section-name}
```

### Field rules

**`_Added:` line** — MUST include the current patch version AND the Linear issue that shipped this feature. Example: `_Added: v3.33.25 (STAK-396)_`. Never leave either value blank.

**`act:` steps** — each step is ONE atomic interaction: a click, a type, a select, or a scroll. Never compound multiple actions in a single `act:`. Wrong: `act: "add a Silver Coin item"`. Right: three separate steps — click Add Item, select Silver, type the name.

**`extract:` steps** — every `extract:` MUST include `→ expect:` with an expected value or condition. Accepted forms: exact value (`9`), boolean (`true`, `false`), qualitative (`non-zero`, `contains "v3.33"`, `visible`). Never write an `extract:` without `→ expect:`.

**`screenshot:` labels** — follow the format `{NN}-{section-short}-{description}`. Examples: `02-crud-add-silver`, `06-ui-ux-dark-theme`, `03-backup-export-csv`. Do not use the `FAIL` prefix — that is reserved for auto-generated failure screenshots from `/bb-test`.

**Test numbering** — open the target section file and find the highest existing test number. Increment by 1. If the last test in `02-crud.md` is `2.20`, your first new test is `2.21`. Never reuse a retired test number.

**Preconditions** — if prior state is required (e.g., "an item must have been added in Test 2.1"), document it explicitly in `**Preconditions:**`. Do not assume the reader knows. Reference prior tests by ID when applicable.

---

## Step 4 — Append to Section File

Append the new test block(s) to the BOTTOM of the relevant section file.

Rules:

- Do NOT renumber existing tests
- Do NOT modify existing test blocks in any way
- Append after the last existing test block (after its `**Section:**` line)
- Use the Edit tool with `old_string` equal to the last line of the file to ensure a clean append

---

## Step 5 — Verify by Running

After appending new tests, verify them against the PR preview URL.

1. Note the section number (e.g., `02` for CRUD, `05` for Market)
2. The `/bb-test` skill auto-discovers the PR preview URL from `gh pr checks` — no need to pass the URL manually. It polls up to 3 times if the Cloudflare Pages build is still in progress.
3. Run the affected section: `/bb-test sections=NN` against the PR preview URL
4. If a step fails: refine the natural language instruction — add location context ("in the header", "in the modal", "in the settings panel") or rephrase to use visible UI text
5. If Stagehand stalls longer than 10 minutes: the skill auto-skips that step — rephrase the instruction to be more specific and retry
6. For smaller changes (1-3 tests): consider manual verification using Chrome DevTools or the Claude browser extension instead of a full Browserbase session — this costs $0

The `/bb-test` skill reads the runbook files at runtime. No rebuild, no compilation needed before running.

---

## Step 6 — Document in PR

Add a note in the PR body so reviewers know what test coverage was added:

```
Added X Browserbase runbook tests to tests/runbook/NN-section.md (Tests N.X through N.Y)
```

Example: `Added 2 Browserbase runbook tests to tests/runbook/02-crud.md (Tests 2.21 through 2.22)`

---

## Good Test Patterns

### Pattern 1 — Modal Open → Interact → Close

```md
- act: "click the [button] to open the modal"
- act: "click the [Tab] tab in the modal"
- act: "type '[value]' into the [field] field"
- act: "click the Close button"
- extract: "modal is no longer visible" → expect: false
```

### Pattern 2 — Form Fill → Submit → Verify

```md
- act: "click the Add Item button"
- act: "select [Metal] from the metal dropdown"
- act: "type '[name]' into the Name field"
- act: "type '[weight]' into the Weight field"
- act: "click the Save or Add to Inventory button"
- extract: "count of inventory item cards" → expect: [N+1]
- screenshot: "{NN}-{section-short}-add-[item]"
```

### Pattern 3 — State Verify → Action → Re-Verify

```md
- extract: "count of inventory item cards" → expect: [N]
- act: "click the delete button on [item name]"
- act: "click the Confirm button in the confirmation dialog"
- extract: "count of inventory item cards" → expect: [N-1]
- screenshot: "{NN}-{section-short}-delete-confirm"
```

### Stagehand instruction tips

- Be specific about the element: "the Settings gear button" not "Settings"
- Reference location when ambiguous: "in the header", "in the modal", "in the sidebar", "at the bottom of the panel"
- Use visible text, not internal IDs: what the user sees on screen
- If a step stalls: add more context about the element's location or rephrase using the button's label text exactly as shown

---

## When NOT to Add Tests

Skip runbook tests for:

- CSS-only changes (color, spacing, font size)
- Backend-only changes with no UI surface
- Minor copy edits (tooltip text, label changes)
- Performance optimizations with no UX change
- Pure refactoring with identical UI output

Add tests for:

- New modal or dialog
- New Settings tab or section
- New multi-field form interaction
- New filter, search, or sort capability
- Multi-step user workflow
- Critical bug fix in a user journey

---

## Quick Reference — Feature Type to Section

| Feature Type                | Section File                                    | Suggested Tags           |
| --------------------------- | ----------------------------------------------- | ------------------------ |
| New item type or form field | `02-crud.md`                                    | crud, add, [metal]       |
| New export format           | `03-backup-restore.md` or `04-import-export.md` | export, [format]         |
| New import source           | `04-import-export.md`                           | import, [source]         |
| New market data source      | `05-market.md`                                  | market, [source]         |
| New theme                   | `06-ui-ux.md`                                   | ui, theme, [name]        |
| New log event               | `07-activity-log.md`                            | activity-log, [action]   |
| New spot price source       | `08-spot-prices.md`                             | spot-prices, [source]    |
| New page-load behavior      | `01-page-load.md`                               | page-load, [feature]     |
| New Settings tab            | `06-ui-ux.md`                                   | ui, settings, [tab-name] |
| New filter chip             | `02-crud.md`                                    | crud, filter, [type]     |
| New card view               | `02-crud.md`                                    | crud, ui, views          |

---

## Maintenance Checklist

After adding tests, verify all of the following before marking the Phase 5 task complete:

- [ ] Test blocks use the exact 7-field format (Test name, Added, Preconditions, Steps, Pass criteria, Tags, Section)
- [ ] `_Added:` line includes the current patch version and the Linear issue
- [ ] `act:` steps are atomic — one interaction each, not compound actions
- [ ] `extract:` steps each include a `→ expect:` clause
- [ ] Screenshot labels follow `{NN}-{section-short}-{description}` format
- [ ] New blocks are appended to the bottom of the section file — no existing blocks modified
- [ ] Affected section verified by running `/bb-test sections=NN`
- [ ] PR body updated with the test coverage note (Tests N.X through N.Y)
