# 00 — Pre-Run Setup

**This is not a test section.** It runs before all test sections in every `/bb-test` invocation.

The setup section establishes a Browserbase session, navigates to the PR preview URL, dismisses startup modals, and records the baseline state that all subsequent test sections depend on.

---

## Purpose

- Resolve the correct PR preview URL (never default to `staktrakr.pages.dev`)
- Create a Browserbase session and record SESSION_ID
- Land on a clean, modal-free inventory view at the preview URL
- Capture a baseline screenshot for the session recording
- Record the BASE_URL and start time for use throughout the run

---

## Storage Note

**Storage is NOT cleared during setup.**

The seed data for all runbook runs is the pre-existing 8 inventory items that reside in the preview deployment's localStorage (scoped to `staktrakr.pages.dev`). These 8 items are the baseline inventory count referenced in tests across all sections (e.g., "extract item count → expect: 8").

Individual test sections that add, edit, or delete items are responsible for cleaning up after themselves. Sections do not share mutable state across section boundaries.

> **Warning:** Never target `staktrakr.pages.dev` directly unless the user has explicitly overridden this restriction. Always use the PR preview URL resolved from `gh pr checks`.

---

## Setup Steps

### Step 1 — Get PR preview URL

Run the following command to extract the Cloudflare Pages preview URL from the PR's check statuses:

```bash
gh pr checks <PR_NUMBER> --json name,state,targetUrl \
  | python3 -c "import sys,json; checks=json.load(sys.stdin); [print(c['targetUrl']) for c in checks if 'pages.dev' in c.get('targetUrl','')]"
```

If no PR number is available:
- Attempt to detect the current branch's open PR: `gh pr view --json number`
- If a PR is found, use that number with the command above
- Poll up to 3 times at 30-second intervals if the Cloudflare Pages check is not yet green
- If still no URL after 3 attempts: **stop and prompt the user**

> Prompt: "No PR preview URL found. Provide a preview URL or PR number to continue."

Record the resolved URL as `BASE_URL` for use in all subsequent navigation steps.

### Step 2 — Create Browserbase session

Call `browserbase_session_create` to open a new Browserbase session.

Record:
- `SESSION_ID` — the session identifier returned by the tool
- Browserbase dashboard URL for the session recording
- Start time (wall clock, UTC)

If session creation fails, abort the run immediately with:
> "Browserbase session failed to create — check API key in Infisical."

Do not attempt to proceed without a valid session.

### Step 3 — Navigate to preview URL

Navigate to the application:

```
stagehand_navigate → {BASE_URL}/index.html
```

Wait for the page to finish loading before proceeding. The navigation is complete when the inventory view or a startup modal is visible.

### Step 4 — Dismiss the What's New / acknowledgment modal

If a What's New popup, release notes modal, or acknowledgment dialog is visible on page load:

- act: "Click the I Understand or Accept button if a modal is visible"

If no modal appears, continue to the next step without error — modal presence depends on session state.

### Step 5 — Dismiss any other startup modals

Check for and dismiss any additional modals that may appear on first load (e.g., cookie notices, update prompts, welcome dialogs):

- act: "Close or dismiss any remaining popup or modal if one is visible"

The inventory view should now be fully accessible with no overlapping dialogs.

### Step 6 — Take baseline screenshot

Capture the state of the page after modal dismissal:

- screenshot: `00-baseline`

This screenshot serves as the visual starting point for the session recording. It should show the inventory grid with 8 seed items and no visible modals.

### Step 7 — Record session metadata

Record the following for use throughout the run:

| Variable | Value |
|----------|-------|
| `SESSION_ID` | Returned from `browserbase_session_create` |
| `BASE_URL` | PR preview URL resolved in Step 1 |
| `START_TIME` | Wall clock time at session creation (UTC) |
| `SEED_COUNT` | Expected inventory count at baseline: **8** |

---

## Post-Setup State

After setup completes successfully:

- A Browserbase session is active
- The browser is at `{BASE_URL}/index.html`
- No startup modals are visible
- The inventory grid shows 8 seed items
- A baseline screenshot (`00-baseline`) is captured
- `SESSION_ID`, `BASE_URL`, and `START_TIME` are recorded

The test runner proceeds to execute the first requested section.

---

## Setup Failure Handling

| Failure | Action |
|---------|--------|
| No PR preview URL after 3 polls | Stop. Prompt user for URL. |
| Browserbase session creation fails | Abort run. Print error. Do not continue. |
| Navigation to `{BASE_URL}/index.html` fails | Abort run. Verify preview URL is correct. |
| Modal dismissal has no effect after 2 attempts | Log warning, continue — modal may not be present |
| Baseline screenshot fails | Log warning, continue — non-blocking |
