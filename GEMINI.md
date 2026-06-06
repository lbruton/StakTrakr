# StakTrakr — Gemini Instructions

Precious metals inventory tracker. Single HTML page, vanilla JS, localStorage persistence. Zero build step.

These are the Gemini-specific instructions for the StakTrakr project. They inherit from `~/.gemini/GEMINI.md` and StakTrakr's `AGENTS.md` / `CLAUDE.md`.

## Your Primary Roles in StakTrakr

1. **UI/UX & Mockups:** StakTrakr has a very specific brand personality ("Sharp. Capable. Empowering. Precision tool, not generic fintech"). Ensure all UI designs, mockups, and reviews adhere to the four themes (light, dark, slate, sepia) and prioritize information density over simplicity.
2. **Playwright Testing:** You are responsible for reviewing, troubleshooting, and occasionally writing Playwright E2E tests (`npm test`, `npm run test:offline`).
3. **SpecFlow Reviews:** When reviewing sketch artifacts (`DocVault/Projects/StakTrakr/sketches/`), focus on user-facing constraints, cross-view consistency, and accessibility.

## Commands

No application build step is required.

- `python3 -m http.server 8000` — local server
- `npm test` — Playwright E2E tests (requires Browserbase)
- `npm run test:offline` — Playwright tests, skip network-dependent
- `npm run lint` — ESLint

## Documentation & Knowledge Base

Foundation docs: `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/`

Access DocVault documentation primarily using the **`mcpvault-docvault`** MCP server tools (such as `read_note` or `search_notes` with `ServerName: "mcpvault-docvault"`) or via direct file reads.

Before discussing architecture, infra, or UI design, read the corresponding Foundation doc (e.g., `design-philosophy.md` for UI). Run the `vault-drift` skill after architectural changes to ensure DocVault is in sync.

## Dual Config Store — CRITICAL

StakTrakr uses two separate localStorage stores. **Confusing them causes silent data loss.**

| Store             | Key                  | Manages                                         | Read                                                   | Write                                                  |
| ----------------- | -------------------- | ----------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Spot providers    | `metalApiConfig`     | METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM | `loadApiConfig()`                                      | `saveApiConfig()`                                      |
| Catalog providers | `catalog_api_config` | Numista apiKey, PCGS bearerToken                | `catalogConfig.getNumistaConfig()` / `getPcgsConfig()` | `catalogConfig.setNumistaConfig()` / `setPcgsConfig()` |

Reading catalog keys via `loadApiConfig().keys["numista"]` returns `undefined` (wrong store — root cause of STRK-573). `saveData()` wraps in `JSON.stringify` — always read via `loadData()` / `loadDataSync()`. After saving a catalog key, call `catalogAPI.initializeProviders()` to refresh stale provider instances.

## Testing Guardrails (TDD)

**RED FLAG: NEVER modify a TDD test to make it pass.**
Tests define correct behavior. If a test fails, the implementation is wrong. If the test itself is flawed, the spec was wrong — STOP implementation and restart the spec from Phase 1. Do not coach around the `block-tdd-test-modification` hook.

## Release & Git Workflow

- **Branch model:** `feature/* → dev → main`. Runtime code changes go through worktree branch → PR → dev. Config/tooling (instruction files, `.claude/`, `.gitignore`, skill files, devops config) may commit directly to `dev`.
- **Worktrees:** Required for runtime code changes. Config/tooling edits may bypass the worktree requirement.
- **Version Lock:** Claim a version in `devops/version.lock` before starting work.
- **Pre-commit Hooks:** `check-release-sync` ensures `constants.js` and other version files match. `stamp-sw-cache` updates `sw.js` automatically.

If you are asked to review a PR or a set of changes before a release, verify that the 5 core version files ([constants.js](file:///Volumes/DATA/GitHub/StakTrakr/js/constants.js), [package.json](file:///Volumes/DATA/GitHub/StakTrakr/package.json), [version.json](file:///Volumes/DATA/GitHub/StakTrakr/version.json), [CHANGELOG.md](file:///Volumes/DATA/GitHub/StakTrakr/CHANGELOG.md), [js/about.js](file:///Volumes/DATA/GitHub/StakTrakr/js/about.js)) have been updated in sync.

## SessionFlow — Cross-Harness History Search

SessionFlow provides semantic search over conversation history across all agents and harnesses (`claude_code_cli`, `codex`, `opencode`, `antigravity_desktop`, `antigravity_cli`).

- **Search All Sessions:** Use `search_all_sessions` to search globally.
  - Useful for finding past PR audits, research summaries, or system setups.
  - Can be filtered by `provider` (e.g. `codex`, `claude_code_cli`), `git_branch`, or `project_root` (use `*` for cross-repo results).
- **Search Current Session:** Use `search_session` to query the current session history (results are boosted by recency). Pass `session_id` using the current session environment.
- **Retrieve Context:** After finding a match, use `get_turns` with the `session_id` and `turn_index` to fetch preceding/succeeding turns (defaults to 2 turns surrounding the hit) to understand the context of a decision.

## Skills — StakTrakr Quick Reference

Skills are invoked via natural language in Antigravity 2.0 (see global `GEMINI.md` for the full progressive disclosure model). Below are the most common StakTrakr workflows and how to trigger them:

| Workflow          | How to invoke                                | What it does                                              |
| ----------------- | -------------------------------------------- | --------------------------------------------------------- |
| **Sketch**        | "sketch requirements for STRK-88"            | Middle-tier spec: 4 phased markdown artifacts in DocVault |
| **Sketch review** | "review the requirements phase for STRK-88"  | Peer review of a sketch phase                             |
| **Discover**      | "discover STRK-88" / "research this issue"   | Phase 1 structured brainstorm, produces Discovery Brief   |
| **Release**       | "release patch" / "run the release workflow" | Version lock → worktree → bump → commit → PR              |
| **Retro**         | "run a retro" / "session retrospective"      | End-of-session prescriptive lessons → mem0                |
| **Health check**  | "health check" / "project health"            | Code quality + security + instruction file scan           |
| **Dogfood**       | "dogfood the app" / "QA StakTrakr"           | Exploratory testing with screenshots and repro steps      |
| **Vault drift**   | "check for vault drift"                      | Detect DocVault ↔ source code divergence                  |

**Phase-by-phase sketch invocation** (most common multi-step workflow):

1. "sketch new STRK-88 fp-price-artifact" → scaffold
2. "sketch requirements for STRK-88" → phase 1
3. "review requirements for STRK-88" → peer review
4. "sketch discovery for STRK-88" → phase 2
5. ... continue through approach → tasks → apply

**Tip:** For multi-step skills, always name the skill and the subcommand explicitly. The agent needs both to route correctly.

## Codacy Agentlint

Codacy runs agentlint policies on instruction files. These policies are modeled on real-world failure patterns and their intent is worth honoring:

- When agentlint flags a pattern, evaluate whether the underlying concern is valid for this project. If it is, adjust the instructions to address the concern.
- Do not weaken project-specific instructions to satisfy a generic policy. Our instructions encode hard-won lessons; agentlint policies encode general best practices. When they conflict, project instructions win — but note the tension.
- Do not reflexively dismiss every finding as a false positive. If a policy catches a genuine gap, fix it.

## Always-Load Context & StakTrakr Guidelines

### `check-release-sync` hook is a SUBSET

Validates [constants.js](file:///Volumes/DATA/GitHub/StakTrakr/js/constants.js) ↔ [package.json](file:///Volumes/DATA/GitHub/StakTrakr/package.json) ↔ package-lock.json ↔ [version.json](file:///Volumes/DATA/GitHub/StakTrakr/version.json) ↔ [CHANGELOG.md](file:///Volumes/DATA/GitHub/StakTrakr/CHANGELOG.md). Does NOT check [js/about.js](file:///Volumes/DATA/GitHub/StakTrakr/js/about.js) What's New, manifest.json, README badges, or [sw.js](file:///Volumes/DATA/GitHub/StakTrakr/sw.js) cache. **Hook green ≠ release complete.** `/release` is the only path that touches all release-bearing files.

### Script load order — `safeGetElement` unavailable in `events.js` top-level

[init.js](file:///Volumes/DATA/GitHub/StakTrakr/js/init.js) (defines `safeGetElement`) loads AFTER [events.js](file:///Volumes/DATA/GitHub/StakTrakr/js/events.js) (both `defer`). Top-level code in [events.js](file:///Volumes/DATA/GitHub/StakTrakr/js/events.js) that calls `safeGetElement` throws a silent ReferenceError. Use `document.getElementById` for event wiring that runs at parse time. Factory closures (e.g., `createLotEachToggle`) are fine — they call `safeGetElement` at runtime.

### Playwright dialog testing — `showAppConfirm` is NOT `window.confirm`

`showAppConfirm` ([js/dialogs.js](file:///Volumes/DATA/GitHub/StakTrakr/js/dialogs.js)) is a custom DOM modal (`#appDialogModal`), not native `window.confirm`. `page.on("dialog", ...)` does NOT intercept it. Tests must: (1) fire-and-forget the async fn via `page.evaluate`, (2) `waitForSelector("#appDialogModal", {state:"visible"})`, (3) click `#appDialogOk` or `#appDialogCancel`. Same for `showAppAlert` and `showAppPrompt`.

### `state.js` variable exposure — `let` needs `Object.defineProperty`

Variables declared with `let` in [state.js](file:///Volumes/DATA/GitHub/StakTrakr/js/state.js) are NOT on `window`. `inventory` and `changeLog` have explicit `Object.defineProperty` getter/setters. Any new state variable that tests or other modules need via `window.X` must follow the same pattern.

### Worktree Edit discipline

Before calling `Edit`/`Write` inside a worktree session → verify `EnterWorktree` has been invoked for that path. If the Edit tool is blocked, the root cause is missing `EnterWorktree` registration — call it first. Never fall back to Python/subprocess file writes as a workaround.

### Date formatting — `toLocaleDateString('en-CA')`

Use `toLocaleDateString('en-CA')` to produce `YYYY-MM-DD` local dates. Do NOT use `toISOString().slice(0, 10)` — it returns a UTC date and causes off-by-one errors for users in negative UTC offsets.

### Goldback lookup predicates

`isGoldbackLookup` (target+unit check) and `isGoldbackRetailLookup` (unit-only check) have different semantics and are easy to confuse. Use the correct predicate for the context — retail lookup uses unit-only.

### Theme count — four themes, not three

StakTrakr has **four** CSS themes: `light`, `dark`, `slate`, `sepia`. There is no `contrast` theme. AI reviewers frequently hallucinate "three themes" or a "contrast" theme — both are wrong. Any sketch/approach doc referencing three themes or a `contrast` theme is inaccurate.

### `applyBulkEdit()` — nested field paths and shallow copy

- **Flat assignment hazard:** `applyBulkEdit()` uses `item[fieldId] = value`. Any field at a nested path (e.g., `item.numistaData.shape`) silently writes to a nonexistent top-level key. Fields at nested paths require an explicit `BULK_FIELD_STORAGE_MAP` entry (precedent: STRK-91).
- **Shallow copy hazard:** `Object.assign({}, item)` before mutation means `oldItem.numistaData === item.numistaData`. Mutating a nested field silently mutates `oldItem` too, making change-log before/after diffs invisible. Deep-copy the nested object before mutation.
- **`BULK_COLUMN_PRIORITY`** has **30 entries** — grep rather than trusting prior docs.

### `loadDataSync` behaviors

- **Swallows parse errors** — returns the default value on parse/decompression error instead of throwing. Outer `try/catch` around `loadDataSync` will never fire for parse failures; `console.warn` in a catch block is dead code in this scenario.
- **Default is `[]`, not `null`** — `[]` is truthy. When the caller checks `if (!storedValue)` before merging defaults, pass `null` explicitly: `loadDataSync("key", null)`. The default `[]` silently skips the merge.
- **`saveDataSync` re-throws** — unlike raw `localStorage.setItem`, it re-throws on quota errors. Fire-and-forget callers need a `try/catch` wrapper when migrating from raw storage calls.

### CSS sticky columns — required setup

Tables using `position: sticky` on `th`/`td` require `border-collapse: separate; border-spacing: 0` (the default `collapse` disables sticky). For sticky-left + sticky-top intersections, use a three-tier z-index: corner cells = `z-index: 3`, sticky column body cells = `z-index: 1`, data cells = auto. Missing the corner tier causes data cells to paint over the frozen header corner during diagonal scroll.

### `--warning` color — WCAG fail on small text in light/sepia

`--warning` (oklch L≈0.666) on `--bg-secondary` produces ~1.4:1 contrast in light (L≈0.96) and sepia (L≈0.892) themes — fails WCAG AA for small text. Use a darker custom amber (~`oklch(0.55 0.15 60)`) for ticker or `font-size-xs` contexts in these themes.

### `_isMarketItemEnabled` guard — apply on both tab paths

In `_renderVendorTable()`, the `_isMarketItemEnabled` filter must be applied on **both** the All-tab code path and the per-metal-tab `else` branch. Missing it on the `else` branch causes disabled vendors to appear as column headers.

### `// duplication-ok` hook escape hatch

The duplication-checker hook respects `// duplication-ok` inline comments. Use this when intentional shadowing or deliberate repetition would otherwise trigger the hook.

### Closing task ordering in sketch workflow

Follow this sequence:

1. Version bump
2. Spot bundle update
3. `gh pr create`
4. Post-merge archive
5. Mark Plane issue as Done

**Warning:** Never mark Plane issues Done before the PR merges. Plane closure tasks (CLOSE-N, where N is the task number) must follow `/sketch archive` after merging.

**DocVault git add discipline:** When committing sketch archives, stage with surgical precision:

- Stage by exact file paths: `git add specs/STRK-74/requirements.md ...`
- Never use broad staging: `git add specs/` or `git add .`
- Broad staging picks up in-progress sketches as unintended additions.

### Pre-PR scan — Codacy local analysis (Gen-3)

Run `codacy-analysis analyze --diff` (official CLI, installed machine-wide via `npm i -g @codacy/analysis-cli`; no per-project bootstrap). Config is `.codacy/codacy.config.json`, a 1:1 mirror of the Codacy Cloud dashboard regenerated with `codacy-analysis init --remote gh lbruton StakTrakr`. `analyze` does not mutate the config — there is no churn to revert.

Project-specific noise: the app uses script-tag globals. Local ESLint uses the repo's `eslint.config.cjs` (which disables `no-undef`), while the dashboard's managed ESLint patterns may still flag browser globals — so local and dashboard ESLint can differ on `no-undef`. Treat pre-existing browser-global findings as noise; verify findings on changed lines only.

### Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit/Gemini/Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API. Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** / **CodeRabbit `STRK-*` issue prefix** / **Copilot `no-undef` on browser globals**.
- **`gb-*` CSS classes** — goldback-scoped. Don't copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **Retail OOS detection is content-driven** — `detectStockStatus` in [firecrawl-extract.js](file:///Volumes/DATA/GitHub/StakTrakr/devops/pollers/home-poller/firecrawl-extract.js) regex-matches rendered markdown which includes review blocks. Reviews containing "out of stock" produce systematic false-OOS.

## Pre-flight (StakTrakr-specific)

- **Before writing any JS** → read `Foundation/coding-standards.md` in DocVault. Authoritative source for code style, DOM rules, storage patterns, error handling, API integration, library standards, CSS design system, and anti-patterns.
- **Before any feed/poller/API/data-path diagnosis** → invoke `/api-infrastructure` and `/retail-poller` first.
- **Before speculating on infra failure mode** → read matching Foundation doc. `infrastructure.md` documents recurring gotchas (e.g. line 265 = recurring Tailscale subnet-route loss).
- **Before claiming what env/secret is set on Fly.io or home poller** → call `infisical/get-secret` (project `stak-trakr-94m4`, env `dev`). Infisical is canonical, not assumption.
- **Before any version-bump PR**:
  - Run `/update-spot-bundle`.
  - Ensure Tailscale is active and `SQLD_URL=http://192.168.1.81:8080` is set.
  - In `/sketch orchestrate`: Run in the same closing-task cohort as the version bump (CLOSE-4).
  - Stage and commit before executing `gh pr create`.
- **Version lock high-water mark** → the next version must be `max(all entries in version.lock including expired, APP_VERSION on origin/dev)`. Never derive the next version from stale local `APP_VERSION` alone.
- **Before `dev → main`** → invoke `/ship`, only on explicit user "ready to ship".
- **Before citing any cron schedule** → grep [devops/pollers/home-poller/docker-entrypoint.sh](file:///Volumes/DATA/GitHub/StakTrakr/devops/pollers/home-poller/docker-entrypoint.sh) for the authoritative value.

## MCP Server Usage Rules

- **Web search: Brave (default) vs Perplexity (paid, restricted)**
  - **Brave Search** — monthly plan, use for all general web searches, fact-checking, URL lookups, and ad-hoc queries.
  - **Perplexity** — pay-per-query API, restrict to:
    1. `/discover` research phases (deep investigation before spec work)
    2. Explicit user request ("use perplexity", "research this deeply")
  - Never use Perplexity for routine lookups that Brave can handle. Tool ladder: `perplexity_search` → `perplexity_ask` → `perplexity_reason` → `perplexity_research`. Pass `strip_thinking: true` on `perplexity_research`/`perplexity_reason` to save context tokens.
- Access StakTrakrApi config (`fly.toml`) using GitHub repository file retrieval tools.
- All `cloud-sync.js` patches require `/sketch-review` peer review before merge.
- StakTrakr uses script-tag globals, so when semantic codebase search returns thin results, fall back to CGC structural query before Grep.
- When requesting SpecFlow approvals, `filePath` must be relative to the specflow workflow root (e.g., `specs/STRK-89-foo/requirements.md`), NOT relative to the project root with `../DocVault/...` traversal. The dashboard endpoint rejects paths containing `..`.
