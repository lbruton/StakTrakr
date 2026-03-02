# StakTrakr Browserbase Test Runbook

## What This Is

The `tests/runbook/` directory is the living E2E test specification for StakTrakr. It replaces the monolithic 18-check `/bb-test` script and the legacy `tests/browserbase/*.ts` TypeScript test files.

Each file in this directory is a **runbook section** — a plain Markdown file covering one feature area. The `/bb-test` skill reads these files at runtime and executes each step via Browserbase/Stagehand MCP tools against the PR preview URL. No build step. No compilation. No imports.

The runbook grows with the product: every shipped spec (Phase 5) appends new test blocks to the relevant section file. The `_Added:` traceability line on each test block identifies which patch and Linear issue introduced it.

---

## Legacy Notice

> **`tests/browserbase/*.ts` files are LEGACY and ARCHIVED.**
> Do NOT add new tests to those TypeScript files.
> All new tests go into `tests/runbook/*.md` section files only.

---

## How to Run Tests

### Full suite (all sections, all tests)

```
/bb-test
```

Runs all 8 sections in order (01 through 08) against the PR preview URL.

### Targeted sections by number

```
/bb-test sections=02,05
```

Runs only the CRUD section (`02-crud.md`) and the Market section (`05-market.md`).

### Single section by filename

```
/bb-test section=03-backup-restore
```

Runs only the Backup & Restore section.

### Tag-filtered run (all sections, matching tests only)

```
/bb-test tags=crud
```

Reads all section files, runs only tests whose `**Tags:**` field includes `crud`.

### Additional arguments

| Argument | Effect |
|----------|--------|
| `pr=NNN` | Use PR number NNN to discover the Cloudflare Pages preview URL |
| `dry-run` | Run all checks but do not file Linear issues |
| `sections=02,05` | Comma-separated section numbers to run |
| `section=03-backup-restore` | Single section by filename prefix |
| `tags=crud` | Run only tests with this tag (across all sections) |

### Getting the PR preview URL

The `/bb-test` skill discovers the Cloudflare Pages preview URL automatically using:

```bash
gh pr checks <PR_NUMBER> --json name,state,targetUrl \
  | python3 -c "import sys,json; checks=json.load(sys.stdin); [print(c['targetUrl']) for c in checks if 'pages.dev' in c.get('targetUrl','')]"
```

If no PR number is provided, the skill attempts to detect the current branch's open PR. If no URL can be resolved after 3 polling attempts, the skill stops and prompts you to provide a preview URL manually.

The skill **never defaults to `staktrakr.pages.dev`** without explicit user override.

### Manual execution (no Browserbase required)

For quick targeted verification — especially when only 1-3 tests are affected — you can execute runbook steps manually without a Browserbase session:

- **Chrome DevTools**: Open DevTools in the browser and follow the `act`/`extract` steps by hand or via the Console.
- **Claude in Chrome extension**: Use the Claude browser plugin to execute Stagehand-style natural language instructions against any open tab (the preview URL).

This costs $0 (no Browserbase credits) and is appropriate when:
- Only 1-3 tests are affected by a change
- A quick visual check is sufficient
- You want to verify a single step without a full session

Reserve `/bb-test` (Browserbase) for full pre-release runs, comprehensive patch verification across an entire section, session recordings, and automated Linear issue filing.

---

## Section Files

| File | Area | Tests |
|------|------|-------|
| [00-setup.md](./00-setup.md) | Pre-run setup (not a test section) | — |
| [01-page-load.md](./01-page-load.md) | Page load, What's New, spot/market backfill | 11 |
| [02-crud.md](./02-crud.md) | Add, Edit, Delete, Search, Filter, Views | 20 |
| [03-backup-restore.md](./03-backup-restore.md) | Backup, Restore, Export ZIP/CSV/JSON, Vault | 12 |
| [04-import-export.md](./04-import-export.md) | CSV/eBay import, Diff merge, PDF export | 9 |
| [05-market.md](./05-market.md) | Market panel, price history, metal tabs | 10 |
| [06-ui-ux.md](./06-ui-ux.md) | Responsive layout, themes, currency, settings | 11 |
| [07-activity-log.md](./07-activity-log.md) | Activity log panel, persistence | 5 |
| [08-spot-prices.md](./08-spot-prices.md) | Spot cards, stale indicators, melt values | 6 |

**Total baseline tests: 84**

---

## Test Block Format

Every test block in every section file uses this exact format. All 7 fields are required.

```md
### Test N.M — {Test Name}
_Added: v{VERSION} ({STAK-XXX})_
**Preconditions:** {what must be true before this test runs}
**Steps:**
- act: "{natural language Stagehand instruction}"
- extract: "{what to assert}" → expect: {expected value or condition}
- screenshot: "{NN}-{section-short}-{description}"
**Pass criteria:** {plain English statement of what constitutes a pass}
**Tags:** {comma-separated tags, e.g. crud, add, silver}
**Section:** {section number and name, e.g. 02-crud}
```

### Field definitions

| Field | Description |
|-------|-------------|
| `Test N.M` | Section number (N) and test number within section (M). Example: `2.7` = section 2, test 7. |
| `_Added:_` | Traceability: patch version and Linear issue that introduced this test. Example: `_Added: v3.33.01 (STAK-396)_` |
| `**Preconditions:**` | State that must be true before this test runs. Reference prior tests by ID if this test depends on their state (e.g., "Test 2.1 has run and added BB-SILVER-COIN"). |
| `**Steps:**` | Ordered list of step directives. See step types below. |
| `**Pass criteria:**` | Plain English statement of what constitutes a pass for this test as a whole. |
| `**Tags:**` | Comma-separated tags used for filtering. Use feature area and action type (e.g., `crud, add, silver`). |
| `**Section:**` | The section this test belongs to (e.g., `02-crud`). Must match the file it lives in. |

---

## Step Types

There are three valid step type prefixes. Each step is one line starting with `- `.

### `act:`

One atomic interaction with the page. Stagehand executes this as a natural language browser action.

```md
- act: "click the Add Item button"
- act: "select 'Silver' from the Metal dropdown"
- act: "type 'BB-SILVER-COIN' into the Name field"
```

Rules:
- One interaction per `act:` step (click, type, select, scroll — not "add an item and verify it saved")
- Use specific selectors in natural language: "the Add Item button", "in the header", "in the modal"
- Do not combine actions in a single `act:` step

### `extract:`

An assertion step. Stagehand extracts information from the page and the result is compared to the `→ expect:` clause.

```md
- extract: "count the number of inventory item cards" → expect: 9
- extract: "is the What's New modal visible" → expect: true
- extract: "text of the version badge in the header" → expect: contains "v3.33"
```

Rules:
- Every `extract:` step **must** include `→ expect:` with an expected value or condition
- Expected values can be exact (`9`, `true`) or qualitative (`non-zero`, `contains "v3.33"`, `visible`)
- On failure, `/bb-test` takes an automatic failure screenshot and continues (non-blocking)

### `screenshot:`

Captures a screenshot labeled for the session recording. Labels follow the format `{NN}-{section-short}-{description}`.

```md
- screenshot: "02-crud-add-silver"
- screenshot: "06-ui-ux-dark-theme"
- screenshot: "00-baseline"
```

Label format rules:
- `{NN}` — two-digit section number (e.g., `02`)
- `{section-short}` — abbreviated section name (e.g., `crud`, `market`, `ui-ux`, `spot-prices`)
- `{description}` — kebab-case descriptor of what is being captured (e.g., `add-silver`, `delete-confirm`)
- Failure screenshots are auto-labeled by the skill as `{NN}-FAIL-{section}-{testId}` — do not use the `FAIL` prefix in manual screenshot steps

---

## How to Add New Tests

When implementing a spec (Phase 5), add new test blocks to the relevant section file. Do not create new files unless the feature area has no existing section.

### Step-by-step

1. **Identify the section.** Match the changed feature area to the section table above. If no section fits, create a new one with the next sequential number (e.g., `09-new-feature.md`).

2. **Find the last test number.** Open the target section file and note the highest test ID (e.g., if the last test is `2.20`, your first new test is `2.21`).

3. **Write the test block.** Use the exact 7-field format above.
   - `_Added:` line must include the current patch version and Linear issue (e.g., `_Added: v3.34.02 (STAK-420)_`)
   - Each `act:` must be one atomic interaction
   - Each `extract:` must have `→ expect:`
   - Screenshot labels must follow the `{NN}-{section-short}-{description}` format

4. **Append to the section file.** Add the new block(s) at the bottom of the section. Do not renumber or modify existing blocks.

5. **Verify.** Run `/bb-test sections=NN` against the PR preview URL to confirm the new steps execute without errors.

6. **Note in the PR body.** Include a line like: "Added 2 Browserbase runbook tests to 02-crud.md (Tests 2.21, 2.22)"

### Example new test block

```md
### Test 2.21 — Add item — Copper Round
_Added: v3.34.02 (STAK-420)_
**Preconditions:** 00-setup has run. Inventory shows 8 seed items.
**Steps:**
- act: "click the Add Item button"
- act: "select 'Copper' from the Metal dropdown"
- act: "select 'Round' from the Type dropdown"
- act: "type 'BB-COPPER-ROUND' into the Name field"
- act: "type '1' into the Weight field"
- act: "type '5' into the Purchase Price field"
- act: "click the Save or Submit button"
- extract: "count the number of inventory item cards" → expect: 9
- screenshot: "02-crud-add-copper"
**Pass criteria:** Item count increases to 9. BB-COPPER-ROUND is visible in the inventory.
**Tags:** crud, add, copper
**Section:** 02-crud
```

---

## Test Numbering Reference

Section numbers are fixed. Test numbers within a section are sequential and never reused (even if a test is retired, its number is retired with it).

| Section | Number prefix | File |
|---------|--------------|------|
| Page Load | 1.x | 01-page-load.md |
| CRUD | 2.x | 02-crud.md |
| Backup & Restore | 3.x | 03-backup-restore.md |
| Import & Export | 4.x | 04-import-export.md |
| Market | 5.x | 05-market.md |
| UI/UX | 6.x | 06-ui-ux.md |
| Activity Log | 7.x | 07-activity-log.md |
| Spot Prices | 8.x | 08-spot-prices.md |

---

## Common Tag Vocabulary

Use these tags consistently so tag-filtered runs work predictably:

| Tag | Used for |
|-----|----------|
| `crud` | Any add/edit/delete/view operation on inventory items |
| `add` | Adding a new item |
| `edit` | Editing an existing item |
| `delete` | Deleting an item |
| `search` | Search input behavior |
| `filter` | Filter chip behavior |
| `images` | Image upload, remove, pattern match |
| `backup` | Backup and restore operations |
| `export` | CSV/JSON/ZIP/PDF export |
| `import` | CSV/eBay import, diff merge |
| `vault` | Encrypted vault export/import |
| `market` | Market panel and price data |
| `spot-prices` | Spot price cards and stale indicators |
| `activity-log` | Activity log panel |
| `ui` | Layout, responsive, theming |
| `theme` | Theme switching |
| `settings` | Settings modal |
| `currency` | Currency switcher |
| `stale` | Stale data indicators |
| `responsive` | Viewport-specific layout tests |
| `gold`, `silver`, `platinum`, `palladium`, `goldback` | Metal-specific tests |
