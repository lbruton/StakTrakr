# GEMINI.md - StakTrakr Context

> Global workflow rules (push safety, version checkout gate, PR lifecycle, code search tiers) are in `~/.claude/CLAUDE.md` for Claude Code. Gemini should follow the same principles documented here.

This file provides foundational mandates and project-specific context for Gemini CLI interactions within the StakTrakr repository.

## Project Overview

**StakTrakr** is a privacy-first, client-side precious metals portfolio tracker for Silver, Gold, Platinum, Palladium, and Goldbacks.

- **Architecture:** Vanilla JavaScript Single-Page Application (SPA).
- **No-Build Design:** No bundlers, transpilers, or frameworks (React/Vue/etc.). It runs directly from `index.html` and supports both `http://` and `file://` protocols.
- **Data & Privacy:** 100% client-side. Data is stored in browser `localStorage` and `IndexedDB`. Optional encrypted cloud backups (Dropbox) use the Web Crypto API (AES-256-GCM).
- **Core Technologies:**
  - **Charts:** Chart.js 3.9.1
  - **CSV Processing:** PapaParse 5.4.1
  - **PDF Generation:** jsPDF 2.5.1 + AutoTable 3.5.25
  - **Backup/ZIP:** JSZip 3.10.1
  - **Icons/Favicon:** SVG and PNG assets in `images/`.

## Building and Running

### Key Commands

- **Running Locally:**
  - Open `index.html` directly in a browser (supports `file://`).
  - Or use a simple HTTP server: `python3 -m http.server 8000`.
- **Linting:**
  - `npm run lint` (runs `eslint js/*.js sw.js`).
- **Testing (single model — runbook NL tests):**
  - `tests/runbook/*.md` — 84 NL E2E tests across 8 sections, run via `/bb-test` (Browserbase/Stagehand) against PR preview URLs. No Playwright, no browserless, no scripted specs.
  - TDD: write runbook test blocks BEFORE implementing code, verify with `/bb-test sections=NN`.
  - Cloud sync/OAuth cannot be tested via Browserbase — test manually at `beta.staktrakr.com`.

### Deployment

- Hosted on Cloudflare Pages (automatic on push to `main`).
- Versioning is tracked in `version.json` and `js/constants.js`.

## Development Conventions

### Core Mandates (Non-Negotiable)

1. **Script Order:** Preserve the exact script dependency order in `index.html`. New scripts must be placed appropriately before `js/init.js`.
2. **Global Scope:** Scripts share a global scope. Do not use ES Modules (`import`/`export`) at runtime.
3. **DOM Access:** Use `safeGetElement(id)` (defined in `js/init.js`) for all DOM access, except for elements guaranteed to exist during the very early startup phase in `init.js` or `about.js`.
4. **Data Persistence:** Use `saveData()` and `loadData()` helpers. All new storage keys **must** be registered in `ALLOWED_STORAGE_KEYS` in `js/constants.js`.
5. **Security:** Always sanitize user-provided strings before DOM injection. Prefer `textContent` over `innerHTML`. Never use `eval()` or `new Function()`.
6. **State Management:** Centralize shared application state in the `state` object within `js/state.js`.
7. **No Frameworks:** Do not introduce React, Vue, TailwindCSS, or any other library that requires a build step or changes the "vanilla" nature of the app.

### Coding Style

- **Indentation:** 2 spaces.
- **Semicolons:** Required.
- **Variables:** Use `const` and `let` only; never `var`.
- **Equality:** Use strict equality (`===` and `!==`).
- **CSS:** Use Vanilla CSS with CSS Custom Properties (variables) for theming (Light, Dark, Sepia, System).
- **Modularization:** Keep functions small, named, and cohesive to their domain file (e.g., spot logic in `js/spot.js`).

### Data Flow Pattern

1. Mutate in-memory `state`.
2. Persist using storage helpers (`saveData`).
3. Re-render the affected UI components.

## Project Structure

- `index.html`: The single entry point.
- `js/`: 67 JavaScript files loaded in strict dependency order via `index.html`.
  - `constants.js`: Global configuration and storage keys.
  - `state.js`: Centralized application state.
  - `utils.js`: Formatting, validation, and storage helpers.
  - `init.js`: Application initialization (loaded last).
- `css/styles.css`: All application styling.
- `vendor/`: Minified third-party libraries.
- `data/`: Bundled historical spot price data.
- `devops/`: Build scripts, hooks, Docker poller, mockups.
- `.agents/skills/`: Specialized agent instructions (Codex).

## API Infrastructure

### Vendor API Landscape

Six vendors scraped for retail prices. Three run Magento 2 with structured APIs:

| Vendor | Platform | API | Auth | Status |
|---|---|---|---|---|
| SD Bullion | Magento 2 | REST `/rest/V1/nfusions/cache/pricing` | None | Open — full catalog, tiered pricing |
| Bullion Exchanges | Magento 2 PWA | GraphQL `/graphql` | CF-gated | Needs cf_clearance cookie |
| Monument Metals | Magento 2 + ScandiPWA | GraphQL `/graphql` | Session-gated | Returns 403 without cookies |
| APMEX | Traditional SSR | JSON-LD in HTML | None | Structured data in page source |
| JM Bullion | Next.js App Router | None (spot only) | N/A | HTML scraping only |
| Hero Bullion | WooCommerce | REST API | 401 | Auth required, HTML scraping |

Note: SD Bullion product pages now redirect to monumentmetals.com (merger/acquisition). Both sites run Magento 2 but with different frontends.

CF bypass strategy: FlareSolverr nodriver fork (`21hsmw/flaresolverr:nodriver`) for cookie harvesting, Byparr as fallback. Cookies are IP+UA+TLS bound.

## MCP Server Usage

Gemini has access to the following MCP servers. Use them as described.

### Agent MCP Parity (as of 2026-02-22)

All agents run on the same Mac and share the same Docker/IP stack.

| Server | Claude | Gemini | Codex | Notes |
|---|---|---|---|---|
| `mem0` | ✅ | ✅ | ✅ | Sole memory backend |
| `sequential-thinking` | ✅ | ✅ | ✅ | Structured reasoning |
| `brave-search` | ✅ | ✅ | ✅ | Web search |
| `claude-context` | ✅ | ✅ | ✅ | Semantic code search (Milvus) |
| `context7` | ✅ | ✅ | ✅ | Library documentation |
| `firecrawl-local` | ✅ | ✅ | ✅ | Self-hosted scraping (port 3002) |
| `linear` | ✅ | ✅ | ✅ | Issue tracking |
| `codacy` | ✅ | ✅ | ✅ | Code quality analysis |
| `chrome-devtools` | ✅ | — | ✅ | Gemini omits — use Playwright instead |
| `playwright` | ✅ | ✅ | ✅ | Browser automation / test authoring |
| `browserbase` | ✅ | ✅ | ✅ | Cloud NL tests (paid, use sparingly) |
| `code-graph-context` | ✅ | ✅ | ✅ | Structural graph (Docker required) |
| `infisical` | ✅ | ✅ | ✅ | Self-hosted secrets manager |

### mem0 (Primary Memory Backend)

Sole memory backend for all agents. Automatically saves conversational context, preferences, and decisions across sessions.

**When to use:** Recall what was discussed in previous sessions, save preferences, store session insights, handoffs, decisions.

**Entity scoping:**

| Scope | Parameter | Contains |
|-------|-----------|----------|
| Project-specific | `agent_id: "staktrakr"` | Decisions, patterns, architecture, bugs for one project |
| Cross-project | `user_id: "lbruton"` (default) | Workflow prefs, infra, tool configs shared across all projects |

Agent IDs: `staktrakr`, `staktrakr-api`, `staktrakr-wiki`, `hextrackr`, `hellokittyfriends`, `whoseonfirst`, `playground`

**Search rule:** Always run **two searches in parallel** — one with `agent_id` filter for the current project, one without (cross-project `user_id` scope). Merge and deduplicate results.

**Tools available:**

- `search_memories` — Find relevant memories by keyword or concept
- `add_memory` — Explicitly save an insight, preference, decision, or handoff
- `get_memories` — List all stored memories
- `get_memory` — Retrieve a specific memory by ID
- `delete_memory` — Remove a specific memory

**Save format:**

```javascript
// Project-specific
mcp__mem0__add_memory({
  text: "StakTrakr <type>: <what, why, how to apply — self-contained>",
  agent_id: "staktrakr",
  metadata: {
    category: "<frontend|backend|infra|security|workflow>",
    type: "<insight|decision|session|handoff>"
  }
})

// Cross-project
mcp__mem0__add_memory({
  text: "<what to remember>",
  user_id: "lbruton",
  metadata: {
    category: "<workflow|infra>",
    type: "<decision|preference|fact>"
  }
})
```

**Secrets policy:** Never store raw secrets in mem0 without explicit user approval. Prefer references (env var name, Infisical label) — not raw values.

### Linear (Project Management)

Issue tracking and project management for StakTrakr.

**Key IDs:**

- StakTrakr team: `f876864d-ff80-4231-ae6c-a8e5cb69aca4` — feature issues, bugs, sprints
- Developers team: `38d57c9f-388c-41ec-9cd2-259a21a5df1c` — cross-agent handoffs, notes, logs
- StakTrakr project (in Developers): `c4bc2838-4783-487d-bfb5-89f052c681c8`
- Documentation project: `6b7588f2-49f2-44cc-ab97-43ca5bf9e392`

**Rules:**

- Reference issues as `STAK-###` in commit messages and documentation
- Update issue status as work progresses (`Todo` -> `In Progress` -> `Done`)
- Post handoff comments using the standard template (see Handoff section)
- **Never put secrets in Linear** — use Infisical label references only
- When creating issues, set appropriate priority (1=Urgent, 2=High, 3=Normal, 4=Low)

**Agent delegation labels:** Issues may carry labels like `Codex`, `Sonnet`, `Opus` indicating which AI agent should handle them. Gemini-delegated work should use a `Gemini` label.

### Brave Search (Web Search)

Use for looking up external documentation, API references, library versions, or any web research needed during tasks.

### Claude-Context (Semantic Code Search)

AST-indexed semantic search over the StakTrakr codebase.

- `search_code` — Natural language queries against indexed code
- `get_indexing_status` — Check if index is fresh
- `index_codebase` — Re-index if stale (path: `/Volumes/DATA/GitHub/StakTrakr`)

Use this before manual file searches — it finds relevant code faster than grep for conceptual queries.

### Firecrawl Local (Web Scraping — Free)

Self-hosted Firecrawl instance running at `devops/firecrawl-docker/` on port 3002. Use for
scraping, crawling, and web search without consuming cloud credits.

**When to use:** Any scraping/crawling task, researching external docs, fetching competitor prices.

**Tools available:**
- `scrape` — Extract clean markdown from a single URL
- `map` — Discover all URLs on a site (essential for finding specific pages)
- `crawl` — Crawl an entire site asynchronously
- `search` — Web search with optional content extraction
- `extract` — Structured data extraction (requires `OPENAI_API_KEY` in Docker env)

**Not available in self-hosted mode:** `/agent` endpoint (cloud only).

**Requires:** `cd devops/firecrawl-docker && docker compose up -d` before use.

### Browserbase (Cloud Browser Automation)

Cloud-based browser infrastructure used for high-fidelity web scraping and automated visual regression testing.

**When to use:** Use for complex retail scraping (e.g., `devops/retail-poller/capture.js`) or when local Chromium is insufficient.

**Usage Details:**
- **Cost:** Real-world cost applies. **Requires explicit user approval** before initiating new sessions.
- **Backend:** Switched via `BROWSER_MODE=browserbase`.
- **Requirements:** `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` environment variables.
- **Integration:** Used via Stagehand NL automation for `tests/runbook/*.md` test suite.

### Context7 (Library Documentation)

Fetches up-to-date documentation and code examples for libraries used by StakTrakr.

Useful libraries to query: Chart.js, Bootstrap 5, jsPDF, PapaParse, JSZip, Web Crypto API.

- `resolve-library-id` — Find the Context7 ID for a library
- `query-docs` — Fetch documentation by topic

### Codacy (Code Quality)

Code quality analysis against the StakTrakr repository. Use during PR reviews and before marking
any PR ready to merge.

**Tools available:**
- `codacy_get_file_issues` — Issues on a specific file
- `codacy_list_pull_request_issues` — All issues on a PR
- `codacy_get_repository_with_analysis` — Repo-level quality summary
- `codacy_get_pull_request_git_diff` — PR diff with analysis context
- `codacy_list_repository_tools` — Active quality tools

**When to use:** After writing or reviewing code, before handing off to Claude for merge.

### Playwright (Browser Automation)

Playwright MCP for browser automation. **Note:** Playwright scripted specs have been retired in
favor of `tests/runbook/*.md` NL tests via Browserbase/Stagehand. The Playwright MCP is still
available for ad-hoc browser automation but is no longer used for the test suite.

**When to use:** Ad-hoc browser automation tasks, not testing (use `/bb-test` for tests).

### Code Graph Context (Structural Code Analysis)

AST-level structural analysis of the StakTrakr codebase via the `cgc-server` Docker container.
Complements `claude-context` (semantic) with precise structural queries.

**When to use:** Finding all callers of a function, tracing call chains, detecting dead code,
measuring complexity, understanding import graphs.

**Tools available:**
- Callers / callees of any function
- Call chain tracing end-to-end
- Dead code detection
- Complexity scoring
- Import/dependency graph

**Requires:** `cgc-server` Docker container running locally.

### Sequential Thinking

Structured reasoning tool for complex multi-step analysis.

Use when planning architecture, evaluating trade-offs, or breaking down complex problems before implementation.

## Documentation (Wiki)

StakTrakr maintains an in-repo wiki at `wiki/` (served via Docsify) — single source of truth for the codebase architecture and patterns. Reference it before making architectural changes or when researching how a subsystem works.

### Frontend pages (maintained by Claude Code / StakTrakr agents)

| Page | Topic |
|------|-------|
| `wiki/frontend-overview.md` | File structure, 67-script load order, service worker, PWA |
| `wiki/data-model.md` | Portfolio model, storage keys, coin/entry schema |
| `wiki/storage-patterns.md` | saveData/loadData wrappers, sync variants, key validation |
| `wiki/dom-patterns.md` | safeGetElement, sanitizeHtml, event delegation |
| `wiki/sync-cloud.md` | Cloud backup/restore, vault encryption, sync flow |
| `wiki/retail-modal.md` | Coin detail modal, vendor legend, OOS detection, price carry-forward |
| `wiki/api-consumption.md` | Spot feed, market price feed, goldback feed, health checks |
| `wiki/release-workflow.md` | Patch cycle, version bump, worktree pattern, ship to main |
| `wiki/service-worker.md` | CORE_ASSETS, cache strategy, pre-commit stamp hook |

### Infrastructure pages (maintained by StakTrakrApi agents)

Architecture, data pipelines, Fly.io, pollers, and secrets — see `wiki/README.md` for full index.

### Accessing pages

Pages live at `wiki/*.md` in this repo. Read them directly with file tools or search with `claude-context`.

## Documentation Policy

The `wiki/` subfolder is the single source of truth for all
architecture, operational runbooks, and pattern documentation.
New documentation goes in `wiki/` (or `docs/plans/` for planning artifacts).

After any commit that changes behavior, update the relevant wiki page directly.
Use `claude-context` to search the wiki: index path includes `wiki/` within the StakTrakr repo.

```
mcp__claude-context__search_code
  query: "your question about how something works"
  path: /Volumes/DATA/GitHub/StakTrakr
```

---

## Cross-Agent Handoff Protocol

StakTrakr uses a multi-agent development workflow. Four agents collaborate:

| Agent | Role | Instruction File |
|-------|------|-----------------|
| Human (lbruton) | Product owner, final approver | — |
| Claude (Opus 4.6) | Primary dev agent, architecture, features, releases | `CLAUDE.md` |
| Codex | Code review, refactoring, JSDoc, targeted fixes | `AGENTS.md` |
| Gemini | Documentation, code review, JSDoc coverage, research | `GEMINI.md` |

### Handoff procedure

When completing work or passing context to another agent:

1. **Save to mem0** — Call `mcp__mem0__add_memory` with `type: handoff` and Linear issue ID in the text
2. **Post to Linear** — Comment on the related issue, or create an issue in the Developers team
3. **Include all fields:** scope, validation, next steps, owner, risks, memory reference

### Handoff comment template

```text
Agent handoff update:
- Agent: gemini
- Status: <blocked|in-progress|ready-for-review|done>
- Scope: <what changed>
- Validation: <what was run/verified>
- Next: <explicit next step + owner>
- Links: <Linear issue/PR links>
- Memory: <mem0 topic keyword for recall>
- Risks: <known risks/assumptions>
```

## Version Lock + Worktree Protocol (Multi-Agent Safety)

Multiple AI agents (Claude, Gemini, Codex, Jules) work concurrently on the same local repo.
The **version lock** prevents two agents claiming the same version number. The **worktree**
gives each agent an isolated filesystem so concurrent edits don't conflict.

Full protocol: `devops/version-lock-protocol.md`. Summary:

### Lock file: `devops/version.lock`

Uses a **claims array** — multiple agents can hold concurrent claims on different versions.

```json
{
  "claims": [
    {
      "version": "3.32.09",
      "claimed_by": "gemini / STAK-XX",
      "issue": "STAK-XX",
      "claimed_at": "2026-02-22T19:00:00Z",
      "expires_at": "2026-02-22T19:30:00Z"
    }
  ]
}
```

Both `devops/version.lock` and `.claude/worktrees/` are **gitignored** — neither should ever
appear in a commit diff. If you see them in a diff, that is a bug.

### Protocol

1. **Read:** Parse `devops/version.lock` and the `claims` array (treat as empty if absent).
2. **Prune:** Remove any entries where `expires_at` < now. Write back if anything was removed.
3. **Compute version:** Find highest `version` in remaining active claims. If none, read `APP_VERSION` from `js/constants.js`. Increment PATCH by 1.
4. **Claim:** Append your entry to the array and write the full `claims` array back to `devops/version.lock`.
5. **Create worktree + branch:**
   `git worktree add .claude/worktrees/patch-VERSION -b patch/VERSION`
6. **Do all work in the worktree** — file edits, version bump, commit.
7. **Push + open draft PR** `patch/VERSION → dev`. Cloudflare generates a preview URL.
8. **QA preview → merge to dev.**
9. **Cleanup after merge:**
   `git worktree remove .claude/worktrees/patch-VERSION --force`
   `git branch -d patch/VERSION`
   Remove **only your claim entry** from `devops/version.lock` (leave other active claims intact).

The locked version is the **anchor** — all Linear notes, changelog entries, and mem0 handoffs
reference it.

**Never push directly to `main`** — Cloudflare auto-deploys to staktrakr.com on every push.

## Quality Gates

- **Codacy A+ rating** required on all PRs — check before submitting
- **ESLint** must pass: `npm run lint`
- **No new `var` declarations** — `const`/`let` only
- **No `innerHTML` with user data** — use `textContent` or `sanitizeHtml()`
- JSDoc blocks required on all new/modified functions

---

*Last Updated: 2026-02-23*
