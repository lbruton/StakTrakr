---
name: bb-test
description: Browserbase runbook test runner for StakTrakr — reads tests/runbook/*.md section files and executes them via Stagehand against the PR preview URL. Supports targeted sections, tag filtering, and dry-run mode.
allowed-tools: Bash, Read, mcp__browserbase__browserbase_session_create, mcp__browserbase__browserbase_session_close, mcp__browserbase__browserbase_stagehand_navigate, mcp__browserbase__browserbase_stagehand_act, mcp__browserbase__browserbase_stagehand_extract, mcp__browserbase__browserbase_stagehand_observe, mcp__browserbase__browserbase_screenshot, mcp__infisical__get-secret
---

# Browserbase Runbook Test Runner — StakTrakr

> ## REQUIRES EXPLICIT USER APPROVAL BEFORE RUNNING
>
> **Browserbase uses paid cloud credits.** This skill must NOT be invoked unless the user has explicitly requested it in this session (e.g., "run bb-test", "run the Browserbase test", "run section 02").
>
> **Use manual verification for 1-3 tests** — Chrome DevTools or Claude browser extension against the preview URL costs $0.
> Reserve `/bb-test` for:
> - Full pre-release QA suite runs
> - Comprehensive patch verification (entire affected section)
> - Session recording needed for the run record
> - Automated Linear issue filing
>
> If in doubt, ask before running.

---

## Manual Execution (No Browserbase Required)

The runbook files (`tests/runbook/*.md`) are plain Markdown — any agent or human can read them and execute the steps manually without spending Browserbase credits.

**For 1-3 tests or quick targeted verification**, execute steps using:

- **Chrome DevTools** — open DevTools in the browser at the preview URL, follow the `act`/`extract` steps by hand or use the Console for assertions
- **Claude in Chrome extension** — use the Claude browser plugin to execute Stagehand-style natural language instructions against any open tab pointed at the preview URL

This approach costs $0 and is appropriate when:
- Only 1-3 tests are relevant to a change
- A quick visual check is sufficient
- You want to verify a single step without a full Browserbase session

Reserve `/bb-test` (Browserbase) for:
- Full section runs (10+ tests)
- Pre-release QA that needs a session recording
- Automated Linear issue filing
- Cases where the full execution pipeline (act + extract + screenshot + Linear) is needed

---

## Arguments

`$ARGUMENTS` can be:
- *(blank)* — full suite (all sections 01-08 in order)
- `sections=02,05` — run only sections 02 and 05 (comma-separated section numbers)
- `section=03-backup-restore` — single section by filename prefix
- `tags=crud` — all tests tagged `crud` across all sections
- `pr=NNN` — explicit PR number for preview URL discovery
- `dry-run` — all checks execute normally, no Linear issue filing

Multiple arguments can be combined: `sections=02,05 dry-run`, `tags=crud pr=701`.

Parse and store before Phase 0:
- `SECTIONS_FILTER` — list of section numbers (e.g. `["02", "05"]`), or empty for all
- `TAG_FILTER` — tag string (e.g. `"crud"`), or empty
- `PR_NUMBER` — integer, or empty
- `DRY_RUN` — boolean

---

## Phase 0: Pre-Run Setup

### Step 1: Resolve which sections to run

Determine the set of runbook section files to read based on parsed arguments:

- No args → sections 01, 02, 03, 04, 05, 06, 07, 08 (all, in order)
- `sections=NN,NN` → only those numbered files (e.g. `sections=02,05` → read `02-crud.md` and `05-market.md`)
- `section=NN-name` → only that single file (e.g. `section=03-backup-restore` → read `03-backup-restore.md`)
- `tags=xyz` → all 8 sections will be read, but only tests where the Tags line includes `xyz` will run

Record `SECTION_FILES` — the ordered list of section filenames to read.

### Step 2: Get PR preview URL

Resolve `PREVIEW_URL` using the following sequence:

1. If `pr=NNN` was provided, use that PR number directly.
2. If no PR number, run:
   ```bash
   gh pr view --json number --jq '.number'
   ```
   If this returns a number, use it as the PR number. If it returns an error or empty, proceed to step 3.
3. Once a PR number is known, run:
   ```bash
   gh pr checks NNN --json name,state,targetUrl | python3 -c "import sys,json; checks=json.load(sys.stdin); [print(c['targetUrl']) for c in checks if 'pages.dev' in c.get('targetUrl','')]"
   ```
   Capture the Cloudflare Pages URL (contains `pages.dev`).
4. If the Cloudflare Pages check is not yet green, poll up to 3 times with 30-second waits between attempts.
5. After 3 failed attempts with no URL: **STOP** and prompt the user:
   > "No PR preview URL found after 3 attempts. Please provide the preview URL or a PR number to continue."
6. **NEVER default to `staktrakr.pages.dev` without explicit user override.** If the user provides a URL directly, use that as `PREVIEW_URL`.

### Step 3: Create Browserbase session

```
mcp__browserbase__browserbase_session_create
```

Record:
- `SESSION_ID` from the response
- `SESSION_DASHBOARD_URL` — the Browserbase dashboard URL for viewing the session recording

If session creation fails, abort immediately with:
> "Browserbase session failed to create — check the BROWSERBASE_API_KEY in Infisical (`/secrets` → StakTrakrApi → dev)."

### Step 4: Execute 00-setup.md

Read `tests/runbook/00-setup.md` using the Read tool, then execute each step in the setup section:

1. Navigate to the preview URL:
   ```
   mcp__browserbase__browserbase_stagehand_navigate → PREVIEW_URL/index.html
   ```
2. Dismiss startup modals:
   ```
   mcp__browserbase__browserbase_stagehand_act: "Click the I Understand or Accept button if a modal is visible"
   ```
   If no modal appears, continue — this is not an error.
3. Dismiss any other startup modals that may appear.
4. Take baseline screenshot:
   ```
   mcp__browserbase__browserbase_screenshot → "00-baseline"
   ```
5. Record run metadata:
   - `BASE_URL` = PREVIEW_URL
   - Start time (YYYY-MM-DD HH:MM UTC)
   - `SESSION_ID` and `SESSION_DASHBOARD_URL`
   - Arguments used

---

## Phase 1: Execute Sections

For each file in `SECTION_FILES`, execute the following sequence:

### 1. Read the section file

Use the Read tool to read the section file from `tests/runbook/{filename}`. Example:
```
Read: tests/runbook/02-crud.md
```

### 2. Parse all test blocks

Scan the file for test blocks matching this structure:
```
### Test N.M — {Test Name}
_Added: ..._
**Preconditions:** ...
**Steps:**
- act: "..."
- extract: "..." → expect: ...
- screenshot: "..."
**Pass criteria:** ...
**Tags:** ...
**Section:** ...
```

Extract for each test block:
- `testId` — the `N.M` identifier (e.g. `2.7`)
- `testName` — the name after the `—`
- `preconditions` — the Preconditions text
- `steps` — ordered list of step objects: `{ type: "act"|"extract"|"screenshot", instruction: string, expect?: string, label?: string }`
- `passCriteria` — the Pass criteria text
- `tags` — comma-separated tag list
- `section` — the Section value

### 3. Apply tag filter (if TAG_FILTER is set)

If `TAG_FILTER` is non-empty, skip any test where the `tags` field does not include the filter value.

Log skipped tests: `Skipping Test N.M — {name} (tag filter: {TAG_FILTER} not matched)`

### 4. Execute each test

For each test that passes the tag filter:

**a. Log the start:**
```
Running Test N.M — {testName}...
```

**b. Execute each step in order:**

- **`act:` step** — call `mcp__browserbase__browserbase_stagehand_act` with the quoted instruction text.
  - **10-MINUTE TIMEOUT PER STEP**: If the act call does not return within 10 minutes, skip this step, record step status as `timeout`, log a warning (`TIMEOUT: act step in Test N.M — {name}`), and continue to the next step. Do not abort the test or section.

- **`extract:` step** — call `mcp__browserbase__browserbase_stagehand_extract` with the assertion text. Compare the returned result to the `→ expect:` value.
  - If the result matches the expected value: step passes.
  - If the result does not match: record the step as `fail`. Take a failure screenshot labeled `{NN}-FAIL-{section-short}-{testId}` (e.g., `02-FAIL-crud-2.3`).
  - **10-MINUTE TIMEOUT PER STEP**: Same timeout rule applies.
  - **Qualitative expect evaluation:** Many `→ expect:` values are qualitative rather than exact. Use these rules:
    - `non-zero dollar amount` — pass if the returned value is a dollar amount greater than $0.00 (e.g., "$34.50" passes, "$0.00" fails)
    - `non-empty version string` — pass if any version-like string (e.g., "v3.33.25", "3.33") or non-blank text is present
    - `8` / `N` (exact count) — pass only if the count matches exactly
    - `true` — pass if the element/condition is present and visible
    - `false` — pass if the element/condition is absent or not visible
    - `≥1` or `at least one` — pass if one or more matches are present
    - `contains X` — pass if X appears anywhere in the returned text
    - `no error` — pass if no error message, alert, or JavaScript console error is visible
    - `light theme active` / `dark theme active` — use visual judgment: background color shift is the primary indicator
    - `original values unchanged` — compare the extracted values to the values noted before the action was performed

- **`screenshot:` step** — call `mcp__browserbase__browserbase_screenshot` with the label text from the step.

**c. Determine test status from step results:**
- All steps pass → `pass`
- All steps pass but one or more produce marginal/approximate matches → `warn`
- One or more steps fail → `fail`
- Test was skipped by tag filter → `skip`
- One or more steps timed out and remaining steps passed → `warn`
- Critical steps timed out → `timeout`

**d. Record RunResult:**
```
RunResult {
  testId:     "2.7"
  testName:   "Upload obverse image"
  section:    "02-crud"
  status:     "pass" | "warn" | "fail" | "skip" | "timeout"
  notes:      "observed: ..., expected: ..."
  screenshot: "02-FAIL-crud-2.7" | null
}
```

**e. Failures are non-blocking** — a failed test does not stop the section. Continue to the next test immediately.

---

## Phase 2: Results Table

After all sections have run, print the full per-test results table:

```
Results
=======
| Test | Name                          | Section          | Status | Notes                    |
|------|-------------------------------|------------------|--------|--------------------------|
| 1.1  | Page loads at preview URL     | 01-page-load     | pass   | title = StakTrakr        |
| 1.2  | What's New popup appears      | 01-page-load     | pass   |                          |
| 2.1  | Add item — Silver Coin        | 02-crud          | fail   | count: 8, expected: 9    |
| ...  | ...                           | ...              | ...    | ...                      |
```

**Overall result** (print after the table):
- All pass (and skip, timeout where no timeout led to a critical failure) → `PASS`
- Any warn, no fail → `PASS WITH WARNINGS`
- Any fail → `FAIL`

Print: `Browserbase session recording: SESSION_DASHBOARD_URL`

---

## Phase 3: Known Bugs Registry

Before filing any Linear issues, check each `fail` or `warn` result against the known active bugs table. **Do NOT file a new Linear issue for a known active bug.** Reference it in the run record only.

### Currently Known Active Bugs

| Bug ID | Description | Notes |
|--------|-------------|-------|
| BUG-001 | Search returns 0 results intermittently | Intermittent — not always triggered |
| BUG-002 | Autocomplete ghost text persists after modal close | Not always triggered |

### Resolved Bugs (do not re-file)

| Bug ID | Description | Resolved In |
|--------|-------------|-------------|
| BUG-006 | Delete executed immediately with no confirmation dialog | v3.31.5 — replaced with `showBulkConfirm` DOM modal |
| STAK-205 | Edit Item — item disappears after edit flow | Automation artifact — use table view (D) for edits; cards have no direct edit button |
| STAK-206 | Card view items-per-page constraint never applied | Fixed in dev — `pagination.js` row vs item unit mismatch corrected |

For each `fail` or `warn` result:
- If it matches a known active bug → mark "known — skipping Linear issue". Note which bug ID.
- If it matches a resolved bug → mark "REGRESSION — filing as new issue" and proceed to Phase 4.
- If it is new → proceed to Phase 4.

---

## Phase 4: Linear Issue Filing

**Skip this phase entirely if `DRY_RUN` is true.** Instead, print what WOULD be filed (title, priority, description preview) and continue to Phase 5.

For each new failure (not in the known active bugs list):

Fetch the Linear API key from Infisical:
```
mcp__infisical__get-secret(secretName: "LINEAR_API_KEY", environmentSlug: "dev", projectId: "319a1db5-207d-49d0-a61d-3f3e6b440ded")
```

Then create the issue via GraphQL:

```bash
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(cat <<GRAPHQL
{"query": "mutation { issueCreate(input: { teamId: \"f876864d-ff80-4231-ae6c-a8e5cb69aca4\", title: \"BUG: [{Section} Test {N.M} — {testName}] — {brief description}\", priority: 2, description: \"## Bug Report — Runbook Run {DATE}\\n\\n**Test:** {Section} Test {N.M} — {testName}\\n**Status:** Fail / Warn\\n**Section:** {section filename}\\n**Environment:** {PREVIEW_URL} (PR preview)\\n**Session Recording:** {SESSION_DASHBOARD_URL}\\n\\n## Observed Behavior\\n\\n{actual extract values}\\n\\n## Expected Behavior\\n\\n{expected value}\\n\\n## Reproduction Steps\\n\\n1. Navigate to {PREVIEW_URL}/index.html\\n2. Run /bb-test section={NN}\\n3. {steps}\\n\\n---\\n_Surfaced via /bb-test skill. Test ID: {N.M}._\" }) { issue { id identifier url } }"}
GRAPHQL
)"
```

- **priority:** `2` (High) for fail, `3` (Normal) for warn
- Record each filed issue's `identifier` and `url` in `NEW_ISSUES` for use in Phase 5.

---

## Phase 5: Run Record Issue

**Skip this phase entirely if `DRY_RUN` is true.**

Create the run record issue via GraphQL (same pattern as Phase 4, with these values):
- **team:** `f876864d-ff80-4231-ae6c-a8e5cb69aca4`
- **title:** `QA: Runbook Run — {DATE formatted as "Mar 01, 2026"} {RESULT}`
- **priority:** `4` (Low)
- **description:**

```markdown
## Runbook Run — {DATE}

**Overall Result:** {OVERALL_RESULT}
**Run Method:** /bb-test skill via Claude Code (Browserbase Stagehand automation)
**Environment:** {PREVIEW_URL}
**Session Recording:** {SESSION_DASHBOARD_URL}
**Arguments:** {ARGUMENTS or "full suite (no args)"}
**Sections Run:** {comma-separated list}

---

## Results

| Test | Name | Section | Status | Notes |
|------|------|---------|--------|-------|
{results table rows}

---

## Summary

| Status | Count |
|--------|-------|
| Pass | N |
| Warn | N |
| Fail | N |
| Skip | N |
| Timeout | N |

---

## New Issues Filed

{List new Linear issues with ID, title, and URL — or "None — all findings matched known active bugs or no failures occurred"}

## Known Issues Observed (not re-filed)

{List known bug IDs triggered this run — or "None"}

## Known Issues Not Triggered This Run

{List known bug IDs that did NOT appear — or "None"}

---
_Logged by Claude via /bb-test skill. Run covered: {list of sections with test counts}._
```

After creating the run record issue, update it to Done via GraphQL:

```bash
# Get the Done state ID, then update
curl -s -X POST https://api.linear.app/graphql \
  -H "Authorization: $LINEAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "mutation { issueUpdate(id: \"<ISSUE_UUID>\", input: { stateId: \"<DONE_STATE_ID>\" }) { issue { identifier state { name } } } }"}'
```

---

## Phase 6: Cleanup

Close the Browserbase session:
```
mcp__browserbase__browserbase_session_close → SESSION_ID
```

Print final summary:

```
BB Test complete!
=================
Environment:       {PREVIEW_URL}
Session Recording: {SESSION_DASHBOARD_URL}
Arguments:         {ARGUMENTS or "full suite"}

Overall: {OVERALL_RESULT}

Run Record: {RUN_RECORD_ISSUE_ID} → Done
  {run record URL}

New bugs filed:
  {STAK-XXX — title (or "None")}

Known bugs observed (not re-filed):
  {BUG-XXX — description (or "None")}
```

---

## Dry Run Mode

If `DRY_RUN` is true:
- Execute all checks normally via Browserbase (session is still created, steps still run)
- Print the full results table
- Print what Linear issues WOULD be created (title, priority, description preview)
- Do NOT call Linear GraphQL mutations (no issue creation or state updates)
- End with: `Dry run complete — no Linear issues created.`

---

## Maintaining the Known Bugs Registry

When a bug is resolved and the fix is shipped, move it from the Known Active Bugs table to the Resolved Bugs table. Include the version it was resolved in. This ensures future runs correctly flag regressions rather than silently skipping re-filed known issues.

When a new persistent bug is confirmed across multiple runs, add it to the Known Active Bugs table with a BUG-NNN identifier and a description. This prevents duplicate Linear issues from being filed on every subsequent run.
