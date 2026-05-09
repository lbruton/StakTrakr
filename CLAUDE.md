# StakTrakr

Precious metals inventory tracker. Single HTML page, vanilla JS, localStorage persistence. Works on `file://` and HTTP. Zero build step, zero install.

## Commands

```bash
npm test              # Playwright E2E tests (requires Browserbase)
npm run test:offline  # Playwright tests, skip network-dependent
npm run lint          # ESLint
npm run format        # Prettier (js/, css/ only — not data/ or vendor/)
npm run format:check  # Prettier dry run
```

---

## Documentation

Foundation docs: `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/`

**Keep these in sync with code changes.** Run `/vault-drift` after any architectural or infra work.

| Doc               | Full Path                                                                          | What's there                                                                 |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Infrastructure    | `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/infrastructure.md`    | Deploy topology, Fly.io, home poller, secrets, CI/CD, health thresholds      |
| Architecture      | `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/architecture.md`      | System design, frontend/API/data model, sqld schema                          |
| Coding Standards  | `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/coding-standards.md`  | DOM patterns, localStorage, service worker, release workflow, testing        |
| Design Philosophy | `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/design-philosophy.md` | Brand, colors, typography, component patterns                                |
| Reusable Patterns | `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/reusable-patterns.md` | Vendor normalization, providers.json, retail modal, chart abstractions       |
| Data Pipelines    | `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/data-pipelines.md`    | Spot / retail / goldback / image pipelines — cron, thresholds, failure modes |
| Cloud Sync        | `/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Foundation/cloud-sync.md`        | Dropbox OAuth, AES-256-GCM, atomic rollback, backup/restore                  |

Tier 2 — 11 deep-dive reference docs at `DocVault/Projects/StakTrakr/Foundation/Deep Dives/`. Linked from Foundation summaries and `Overview.md`.

Tier 3 — Source code wins on conflicts. Authoritative cron/config files: `devops/pollers/home-poller/docker-entrypoint.sh`, `devops/pollers/remote-poller/fly.toml`.

---

## Issue Tracking

Prefix: `STRK-`. Issues tracked in Plane: <https://plane.lbruton.cc/lbruton/projects/026dbe54-fe52-4a9f-9f1b-7edcb9bbdceb/>.

Pre-migration DocVault issues (STAK-) are archived at `DocVault/Archive/Issues-Pre-Plane/StakTrakr/`. New issues are created via `/issue` (which dispatches on `.specflow/config.json` `issue_backend`) or directly via `mcp__plane__create_issue`.

---

## Git Topology

- **Branch model:** `feature/* → dev → main`. All commits go through worktree branch → PR → dev. Both `dev` and `main` are protected — no direct pushes.
- **Version format:** `MAJOR.MINOR.PATCH` in `js/constants.js` (code comment calls these `BRANCH.RELEASE.PATCH`). Use `/release` to bump — edits 6 files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`) + `sw.js` is stamped automatically by the `stamp-sw-cache` pre-commit hook. Project-level recipe lives in `.claude/skills/release/SKILL.md`.
- **`/release` is the only valid version-bump path.** `/spec`'s shipping tasks (10–12) say "version bump" — that means _invoke `/release patch`_, not hand-edit version files. A spec PR that bumps `package.json` but forgets `about.js` What's New, manifest, or `version.json` will still pass the `check-release-sync` hook but ship incomplete. If the spec workflow appears to do its own bump, treat that as a bug — invoke `/release`.
- **Version lock:** `devops/version.lock` is gitignored — local coordination only.
- **Worktrees:** `.worktrees/<issue>-<slug>/` (issue-named, via `/start-patch`) or `.worktrees/patch-<version>/` (version-named, via `/release`). Both conventions are in use; pick whichever the entry skill creates and stick with it for the lifetime of the branch. Before creating: `git fetch origin dev` to sync remote dev (works from any worktree — no branch checkout needed). Then: `git worktree add .worktrees/<name>/ -b <branch-name> origin/dev`. After: `cp CLAUDE.md .worktrees/<name>/CLAUDE.md` then `npm install --no-audit --no-fund`.
- **Squash merge only** — rebase merge is blocked (GitHub can't sign rebase commits). Use squash merge or local merge with SSH signing.
- **`stamp-sw-cache` hook** — auto-stages `sw.js` when JS/CSS/image files are committed. No need to add it manually.
- **`data/` and `vendor/` excluded from prettier** — lint-staged formats `js/` and `css/` only. Avoid manually formatting excluded paths.
- **Update spot bundle before the `dev → main` ship PR** — run `/update-spot-bundle` (queries sqld and rebuilds `data/spot-history-bundle.js` with current data). Patch PRs to `dev` do not need it; only the ship PR does.
- **Pushing fixes to an open PR** — commit from the existing PR worktree (`.worktrees/<branch>`), not a new branch.

---

## MCP Notes

- StakTrakrApi config → `mcp__github__*` (Fly.io `fly.toml` lives there during transition)
- All `cloud-sync.js` patches require `/codex:rescue` peer review before merge.
- Codex handoff prompts use `$spec` not `/spec`.
- **Plane UUIDs are session-volatile.** Always re-fetch via `mcp__plane__get_issue_using_readable_identifier` and `mcp__plane__list_states` rather than copying UUIDs from prior session summaries, mem0, or compaction blocks.

---

## Skills

| Skill                             | Use When                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `/coding-standards`               | Before writing any JS — DOM patterns, globals, script loading order, localStorage, cloud sync, Playwright testing |
| `/api-infrastructure`             | Any feed, poller, API, or data-path work. Loads DocVault update list, health check, Fly.io deploy procedure       |
| `/repo-boundaries`                | Cross-repo work, deploy questions, or when Fly.io / StakTrakrApi / home poller appears in context                 |
| `/update-spot-bundle`             | Query sqld and rebuild `data/spot-history-bundle.js` with current spot data — run before every release PR         |
| `/staktrakr-ship`                 | Ship `dev → main` — only on explicit "ready to ship" from user                                                    |
| `/sw-cache`                       | Service worker cache version updates                                                                              |
| `/retail-poller`                  | Retail pipeline — scraping, confidence scores, providers.json, data pipeline                                      |
| `/retail-provider-fix`            | Diagnose/fix scraping failures for individual dealers                                                             |
| `/deploy-verify`                  | Post-deploy health checks for Portainer (home) and Fly.io (cloud)                                                 |
| `/faq`                            | Add, edit, or remove in-app FAQ entries                                                                           |
| `/finishing-a-development-branch` | Implementation complete — guides merge/PR/cleanup decision                                                        |
| `/pr-ready`                       | Pre-PR checklist — version bump, sw.js, DocVault status, Codacy                                                   |
| `/release`                        | Version bump — edits 6 files + trims What's New to 8 entries. Project override of global `/release`               |
| `/start-patch`                    | Pick a Plane issue, claim version lock, create worktree                                                           |
| `/ui-mockup`                      | New multi-element UI — Playground prototype before production code                                                |

**Skill authoring rules (when creating a new skill):**

- Filename must be `SKILL.md` exactly — `.gitignore` only tracks `!.claude/skills/*/SKILL.md`. Other `.md` names are silently gitignored. **Exception:** If a genuinely different structure is required, stop and ask the user to confirm, update `.gitignore` to allow the new pattern, and include that change in the same PR so the deviation is reviewed and tracked.
- All `SKILL.md` files need YAML frontmatter (pattern: see `.claude/skills/sw-cache/SKILL.md`):

  ```yaml
  ---
  name: <slug>
  description: <one line>
  ---
  ```

---

## Always-Load Context

### Dual Config Store — CRITICAL

Two separate localStorage stores. Confusing them causes silent data loss.

| Store             | localStorage key     | Manages                                              | Read via                                               | Write via                                              |
| ----------------- | -------------------- | ---------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Spot providers    | `metalApiConfig`     | METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM keys | `loadApiConfig()`                                      | `saveApiConfig()`                                      |
| Catalog providers | `catalog_api_config` | Numista apiKey, PCGS bearerToken                     | `catalogConfig.getNumistaConfig()` / `getPcgsConfig()` | `catalogConfig.setNumistaConfig()` / `setPcgsConfig()` |

Always read catalog keys via `catalogConfig.getNumistaConfig()` / `getPcgsConfig()` — calling `loadApiConfig().keys["numista"]` reads the wrong store and returns `undefined` (root cause of STAK-573).

- `saveData()` wraps in `JSON.stringify` — always read back through `loadData()` / `loadDataSync()`. Raw `localStorage.getItem()` returns the stringified payload and silently breaks downstream consumers.
- After saving a catalog key, call `catalogAPI.initializeProviders()` to refresh stale provider instances.

### Pre-commit hooks — `check-release-sync` is a subset

The `check-release-sync` hook validates `constants.js` ↔ `package.json` ↔ `package-lock.json` ↔ `version.json` ↔ `CHANGELOG.md` are in sync. It does **NOT** check `js/about.js` What's New, `manifest.json`, README badges, or `sw.js` cache version. **Passing the hook is necessary but not sufficient** — `/release` is the only path that touches all release-bearing files. A green hook on a hand-rolled version bump means nothing.

### Script load order — `safeGetElement` unavailable in `events.js` top-level

`init.js` (defines `safeGetElement`) loads AFTER `events.js` (both `defer`). Top-level code in `events.js` that calls `safeGetElement` throws a silent ReferenceError. Use `document.getElementById` for event wiring that runs at parse time. The factory closures (e.g., `createLotEachToggle`) are fine — they call `safeGetElement` at runtime, after all scripts have loaded.

### Playwright dialog testing — `showAppConfirm` is NOT `window.confirm`

`showAppConfirm` (js/dialogs.js) is a custom DOM modal (`#appDialogModal`), not native `window.confirm`. `page.on("dialog", ...)` does NOT intercept it. Tests must: (1) fire-and-forget the async function via `page.evaluate`, (2) `waitForSelector("#appDialogModal", { state: "visible" })`, (3) click `#appDialogOk` or `#appDialogCancel`. Same for `showAppAlert` and `showAppPrompt`.

### `state.js` variable exposure — `let` needs `Object.defineProperty`

Variables declared with `let` in `state.js` are NOT on `window`. `inventory` and `changeLog` have explicit `Object.defineProperty` getter/setters. Any new state variable that tests or other modules need via `window.X` must follow the same pattern.

### Pre-PR scan gotchas

- **Codacy CLI fresh-worktree fallthrough** — in a fresh worktree before any commits, `git diff $BASE...HEAD` is empty; `codacy-cli` falls back to whole-repo scan and surfaces hundreds of pre-existing browser-global `no-undef` findings (the project uses script-tag globals the auto-config doesn't recognize). Commit at least once before scanning, or scan only changed files explicitly. **Verify findings on changed lines only**; pre-existing `no-undef` is noise.

### Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional defensive coding.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit, Gemini, and Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** — auto-generated refactor PRs. Triage individually.
- **`gb-*` CSS classes** — goldback-scoped. Don't copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **Retail OOS detection is content-driven** — `detectStockStatus` in `firecrawl-extract.js` regex-matches the rendered markdown, which **includes ShopperApproved review blocks**. Customer-review text containing "out of stock", "unavailable", "page not found", etc. produces systematic false-OOS for entire vendors. When investigating sudden vendor-wide OOS, scrape the rendered page and check whether the trigger text lies _after_ the pricing table — if so, extend `MARKDOWN_CUTOFF_PATTERNS` to truncate before the review block (regex must be plural-tolerant: `Reviews?`).

### TDD Test Integrity — RED FLAG

NEVER modify a TDD test to make it pass. Tests are written first to define correct behavior — they are the spec. If a test fails:

1. **Investigate the implementation code** — the test is telling you the code is wrong. Fix the code.
2. **If the test itself is flawed** (wrong assertion, incorrect understanding of requirements) — this means the spec's requirements or design were wrong. STOP implementation. Restart the spec from Phase 1 (Requirements). Do not patch the test and continue.
3. **Never weaken, skip, or rewrite a test to get a green result.** That defeats the entire purpose of TDD — you are no longer testing behavior, you are testing your ability to make tests pass.
4. **Do not disable, suppress, or coach the user around the hookify `block-tdd-test-modification` hook to land a test edit.** The hook firing is a signal to halt and re-spec, not a permission gate to toggle off. If the test was authored in the same PR with wrong expectations, reclassify the underlying issue as a spec error and restart Phase 1 — never silently toggle the hook off, edit, and toggle back on.

A passing test suite built on modified tests is worse than a failing one — it gives false confidence while masking real bugs.

---

## Pre-flight (StakTrakr-specific)

- **Before any feed/poller/API/data-path diagnosis OR any retail/spot/feed disconnect between data source and frontend** (poller logs OK but UI wrong, vendor showing systematic anomaly, prices missing for one provider) → invoke `/api-infrastructure` and `/retail-poller` first. They cover the full poll → dashboard → publish → frontend path. Skipping causes wrong-layer fixes.
- **Before speculating on infra failure mode** → read the matching Foundation doc. `infrastructure.md` lists known gotchas at specific line numbers (e.g. line 265 documents the recurring Tailscale subnet-route loss). Skim it before dispatching debugger agents.
- **Before claiming what env/secret is set on Fly.io or home poller** → look it up via `mcp__infisical__get-secret` (project `stak-trakr-94m4`, env `dev`). I deploy and manage Fly.io for the user; Infisical is the canonical source, not assumption or stale memory.
- **Before the `dev → main` ship PR** → run `/update-spot-bundle` (requires Tailscale + `SQLD_URL=http://192.168.1.81:8080`). Skippable for patch PRs to `dev`.
- **Before `dev → main`** → use `/staktrakr-ship` only on explicit "ready to ship" from user.
- **Before citing any cron schedule** → grep `devops/pollers/home-poller/docker-entrypoint.sh` for the authoritative value.

---

## Design Context

### Users

StakTrakr serves a broad spectrum of precious metals holders — from casual stackers checking what their collection is worth, to serious investors tracking cost basis and portfolio allocation, to preppers holding physical metals as a store of value. Usage context is primarily at home on desktop, though mobile access matters.

### Brand Personality

**Sharp. Capable. Empowering.** Like a pro trading terminal — dense information, full control, respect for the user's intelligence. The interface should feel like a precision instrument, not a toy.

### Aesthetic Direction

- Dashboard layout with card-based and table-based views, plus ticker displays
- Silver/gold metallic brand identity rooted in physical properties of precious metals
- Three themes: light (slate/blue-gray), dark (deep navy), sepia — each must feel like StakTrakr

### Anti-References

- **NOT generic fintech** — no Robinhood/Mint aesthetic, no oversized cards with rounded everything
- **NOT crypto/Web3** — no neon, no glow effects, no "futuristic" styling
- **NOT a spreadsheet clone** — needs real visual identity beyond tables

### Design Principles

1. **Information density over simplicity** — Users want to see their data, not navigate to it
2. **Metallic, not digital** — Design language echoes physical metals: weight, luster, solidity
3. **Precision tool, not consumer app** — Respect the user's intelligence with dense data and functional controls
4. **Grounded color, not performative** — Color serves function (metal ID, gain/loss, status), not decoration
5. **Three themes, one identity** — Light, dark, and sepia each feel like StakTrakr, not a generic toggle
