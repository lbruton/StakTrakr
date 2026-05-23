# StakTrakr

Precious metals inventory tracker. Single HTML page, vanilla JS, localStorage. Runs on `file://` and HTTP. Zero build, zero install.

## Commands

```bash
npm test              # Playwright E2E (local Chromium)
npm run test:offline  # Skip @network-tagged
npm run lint          # ESLint
npm run format        # Prettier (js/ + css/ only — not data/, vendor/)
npm run format:check
```

Pre-existing flaky test categories: `goldback-type`, `lot-each-purchase-price`, `numista-picker-tags` — skip per the 10-min hard-timeout rule; do not fix unrelated failures.

## Documentation

Foundation docs at `DocVault/Projects/StakTrakr/Foundation/`. Run `/vault-drift` after architectural/infra work.

| Doc                    | What's there                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infrastructure.md`    | Deploy topology, Fly.io, home poller, secrets, CI/CD, health thresholds                                                                                                      |
| `architecture.md`      | System design, frontend/API/data model, sqld schema                                                                                                                          |
| `coding-standards.md`  | Code style, module boundaries, DOM rules, storage patterns, error handling, API integration, library standards, CSS design system, service worker, release workflow, testing |
| `design-philosophy.md` | Brand, colors, typography, component patterns, themes, anti-references                                                                                                       |
| `reusable-patterns.md` | Vendor normalization, providers.json, retail modal, chart abstractions                                                                                                       |
| `data-pipelines.md`    | Spot / retail / goldback / image pipelines — cron, thresholds, failure modes                                                                                                 |
| `cloud-sync.md`        | Dropbox OAuth, AES-256-GCM, atomic rollback, backup/restore                                                                                                                  |

Tier 2: 11 deep-dive docs at `Foundation/Deep Dives/`. Authoritative cron/config: `devops/pollers/home-poller/docker-entrypoint.sh`, `devops/pollers/remote-poller/fly.toml`.

## Issue Tracking

Prefix `STRK`. Plane: `https://plane.lbruton.cc/lbruton/projects/026dbe54-fe52-4a9f-9f1b-7edcb9bbdceb/`. Pre-migration `STAK-*` archived at `DocVault/Archive/Issues-Pre-Plane/StakTrakr/`. Create via `/issue` or `mcp__plane__create_issue`.

## Git Topology

- Branch model: `feature/* → dev → main`. All commits via worktree → PR → dev. Both `dev` and `main` protected — no direct pushes.
- Version format: `MAJOR.MINOR.PATCH` in `js/constants.js` (code comment: `BRANCH.RELEASE.PATCH`). `/release` bumps 6 files (`js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, `CHANGELOG.md`); `sw.js` auto-stamped by `stamp-sw-cache` pre-commit hook. Recipe: `.claude/skills/release/SKILL.md`.
- **`/release` is the ONLY valid version-bump path.** `/spec`'s shipping tasks 10–12 say "version bump" → that means _invoke `/release patch`_, not hand-edit. A spec PR that bumps `package.json` but forgets `about.js` What's New / manifest / `version.json` will still pass `check-release-sync` and ship incomplete. If spec workflow appears to do its own bump → it's a bug, invoke `/release`.
- Version lock: `devops/version.lock` is gitignored (local coordination only).
- Worktree naming: `.worktrees/<issue>-<slug>/` (via `/start-patch`) or `.worktrees/patch-<version>/` (via `/release`). Pick what the entry skill creates and keep it for the branch lifetime. Create: `git fetch origin dev && git worktree add .worktrees/<name>/ -b <branch> origin/dev`. After: `cp CLAUDE.md .worktrees/<name>/` then `npm install --no-audit --no-fund`.
- Squash merge only — rebase merge blocked (GitHub can't sign rebase commits). Use squash or local merge with SSH signing.
- `stamp-sw-cache` hook auto-stages `sw.js` when JS/CSS/image files commit. Don't add manually.
- **Run `/update-spot-bundle` before EVERY version-bump PR** (whether targeting `dev` or `main`). Queries sqld and rebuilds `data/spot-history-bundle.js`. Copilot's reminder is correct — not a false positive. **Worktree note:** the script writes to the **main checkout**, not the active worktree — after running, copy to the worktree: `cp ../../data/spot-history-bundle.js data/ && cp ../../data/spot-history-bundle-*.js data/` (run from worktree root).
- Pushing fixes to an open PR → commit from existing PR worktree, not a new branch.
- **Sketch branch naming** → `/sketch orchestrate` generates `sketch/{ISSUE-ID}-{slug}` branch names by default, but StakTrakr requires `patch/VERSION` via `/start-patch`. Override generated tasks.md if it uses the sketch convention.
- **`/sketch orchestrate` closing tasks** → always dispatch as a single batched prompt, not one-at-a-time. Closing tasks have no model-routing ambiguity and benefit from no parallel hazard.
- **Stale dev-targeting branches** → `/pr-cleanup` only detects `[gone]` refs, which requires the upstream branch to have been deleted. Squash-merged branches targeting `dev` never appear as `[gone]` (the local branch tracks `origin/dev`, not its merged ref) — so `git branch -vv | grep ': gone]'` will NOT find them. Cross-check instead by branch name: list merged PR heads with `gh pr list --state merged --base dev --json headRefName --jq '.[].headRefName' | grep '^patch/'` and compare that set against local `.worktrees/patch-*/` names plus `git for-each-ref --format='%(refname:short)' refs/heads/patch/`.
- **PR branch staleness check** → before opening a PR, run `git merge-base HEAD origin/dev` and compare to `git rev-parse origin/dev`. A large changed-file count (50+) is a signal the branch was created from stale local `dev` rather than fetched `origin/dev`.

## MCP Notes

- **Web search: Brave (default) vs Perplexity (paid, restricted)**
  - **Brave Search** (`mcp__brave-search__*`) — monthly plan, use for all general web searches, fact-checking, URL lookups, and ad-hoc queries.
  - **Perplexity** (`mcp__perplexity__*`) — pay-per-query API, restrict to:
    1. `/discover` research phases (deep investigation before spec work)
    2. Explicit user request ("use perplexity", "research this deeply")
  - Never use Perplexity for routine lookups that Brave can handle. Tool ladder by cost: `perplexity_search` (ranked results) → `perplexity_ask` (quick AI answer) → `perplexity_reason` (chain-of-thought) → `perplexity_research` (deep multi-source, 30s+).
  - Pass `strip_thinking: true` on `perplexity_research`/`perplexity_reason` to save context tokens.
- StakTrakrApi config (Fly.io `fly.toml`) lives in the StakTrakrApi repo — use `mcp__github__*` to access it.
- All `cloud-sync.js` patches require `/sketch-review` (Opus or equivalent) peer review before merge. (`/codex:rescue` is DISABLED — see global CLAUDE.md Peer Review.)
- StakTrakr-specific code-search hint: the project uses script-tag globals, so when claude-context returns thin results for a global, fall back to CGC structural query before Grep.
- When calling `mcp__specflow__approvals` with `action: "request"`, `filePath` must be relative to the specflow workflow root (e.g., `specs/STRK-89-foo/requirements.md`), NOT relative to the project root with `../DocVault/...` traversal. The dashboard content endpoint rejects paths containing `..`.

## Skills

| Skill                             | Use When                                                            |
| --------------------------------- | ------------------------------------------------------------------- |
| `/api-infrastructure`             | Feed / poller / API / data-path work                                |
| `/update-spot-bundle`             | Rebuild `data/spot-history-bundle.js` — run before every release PR |
| `/staktrakr-ship`                 | Ship `dev → main` (only on explicit "ready to ship")                |
| `/retail-poller`                  | Retail pipeline — scraping, confidence, providers.json              |
| `/retail-provider-fix`            | Diagnose scraping failures for individual dealers                   |
| `/deploy-verify`                  | Post-deploy health (Portainer home + Fly.io cloud)                  |
| `/faq`                            | In-app FAQ entries                                                  |
| `/finishing-a-development-branch` | Implementation complete — merge/PR/cleanup                          |
| `/pr-ready`                       | Pre-PR checklist                                                    |
| `/release`                        | Version bump (project override of global `/release`)                |
| `/start-patch`                    | Pick Plane issue, claim version lock, create worktree               |
| `/ui-mockup`                      | New multi-element UI — Playground prototype first                   |

**Skill authoring:** filename MUST be `SKILL.md` — `.gitignore` only tracks `!.claude/skills/*/SKILL.md`. Other `.md` names silently gitignored. If a genuinely different structure is needed, stop and ask + update `.gitignore` in the same PR. YAML frontmatter required (pattern: `.claude/skills/release/SKILL.md`).

## Always-Load Context

### Dual Config Store — CRITICAL

Two separate localStorage stores. Confusing them = silent data loss.

| Store             | Key                  | Manages                                         | Read                                                   | Write                                                  |
| ----------------- | -------------------- | ----------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Spot providers    | `metalApiConfig`     | METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM | `loadApiConfig()`                                      | `saveApiConfig()`                                      |
| Catalog providers | `catalog_api_config` | Numista apiKey, PCGS bearerToken                | `catalogConfig.getNumistaConfig()` / `getPcgsConfig()` | `catalogConfig.setNumistaConfig()` / `setPcgsConfig()` |

Reading catalog keys via `loadApiConfig().keys["numista"]` returns `undefined` (wrong store — root cause of STRK-573). `saveData()` wraps in `JSON.stringify` — always read via `loadData()` / `loadDataSync()`. After saving a catalog key, call `catalogAPI.initializeProviders()` to refresh stale provider instances.

### `check-release-sync` hook is a SUBSET

Validates `constants.js ↔ package.json ↔ package-lock.json ↔ version.json ↔ CHANGELOG.md`. Does NOT check `js/about.js` What's New, `manifest.json`, README badges, or `sw.js` cache. **Hook green ≠ release complete.** `/release` is the only path that touches all release-bearing files.

### Script load order — `safeGetElement` unavailable in `events.js` top-level

`init.js` (defines `safeGetElement`) loads AFTER `events.js` (both `defer`). Top-level code in `events.js` that calls `safeGetElement` throws a silent ReferenceError. Use `document.getElementById` for event wiring that runs at parse time. Factory closures (e.g., `createLotEachToggle`) are fine — they call `safeGetElement` at runtime.

### Playwright dialog testing — `showAppConfirm` is NOT `window.confirm`

`showAppConfirm` (`js/dialogs.js`) is a custom DOM modal (`#appDialogModal`), not native `window.confirm`. `page.on("dialog", ...)` does NOT intercept it. Tests must: (1) fire-and-forget the async fn via `page.evaluate`, (2) `waitForSelector("#appDialogModal", {state:"visible"})`, (3) click `#appDialogOk` or `#appDialogCancel`. Same for `showAppAlert` and `showAppPrompt`.

### `state.js` variable exposure — `let` needs `Object.defineProperty`

Variables declared with `let` in `state.js` are NOT on `window`. `inventory` and `changeLog` have explicit `Object.defineProperty` getter/setters. Any new state variable that tests or other modules need via `window.X` must follow the same pattern.

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
- **`BULK_COLUMN_PRIORITY`** has **30 entries** — grep rather than trusting prior docs (reviewers have guessed 22, 28, and 32 in separate sessions).

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

### Pre-PR scan — Codacy CLI project-specific noise

Project uses script-tag globals the auto-config doesn't recognize. Pre-existing browser-global `no-undef` findings are noise. Verify findings on changed lines only. (Global `Action Gates` covers the fresh-worktree empty-diff issue.)

### Codacy CLI mutates `.codacy/codacy.yaml`

`/codacy-cli` (or any `.codacy/cli.sh analyze` invocation) rewrites `.codacy/codacy.yaml` — adds `pmd@`, `python@`, `java@` tool stanzas and bumps `eslint@` to latest. This breaks the `config-validation.spec.js` Cypress (CY) assertions CY-2, CY-7, and CY-8 every time. **After any CLOSE-2 codacy scan, run `git diff .codacy/codacy.yaml` and revert tool additions before commit.** The mutation is a CLI side effect, not a real config change. Valid scan invocation: `codacy analyze --tool eslint --format sarif` — `--directory` is not a valid flag.

### Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit/Gemini/Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** — auto-generated refactor PRs. Triage individually.
- **CodeRabbit `STRK-*` issue prefix** — see global CLAUDE.md "Conventions" rule on post-migration prefix flags; pre-classify as false positive.
- **Copilot `no-undef` on browser globals** — project uses script-tag globals across vanilla JS files with no bundler. The phrasing "vanilla JS global scope, no module bundler" is sufficient context in PR replies; do not include a file count (it changes).
- **`gb-*` CSS classes** — goldback-scoped. Don't copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **CodeRabbit skips dev-targeting PRs** — configured for the default branch only. Don't wait for a review that won't arrive; check `gh pr view` to confirm no review is pending.
- **Retail OOS detection is content-driven** — `detectStockStatus` in `firecrawl-extract.js` regex-matches rendered markdown which **includes ShopperApproved review blocks**. Customer-review text containing "out of stock", "unavailable", "page not found" produces systematic false-OOS for entire vendors. Investigation: scrape page, check if trigger text lies AFTER pricing table — if so extend `MARKDOWN_CUTOFF_PATTERNS` (regex must be plural-tolerant: `Reviews?`).

## Pre-flight (StakTrakr-specific)

- **Before writing any JS** → read `Foundation/coding-standards.md` (DocVault). Authoritative source for code style, DOM rules, storage patterns, error handling, API integration, library standards, CSS design system, and anti-patterns.
- **Before any feed/poller/API/data-path diagnosis** (poller logs OK but UI wrong, vendor anomaly, prices missing) → invoke `/api-infrastructure` and `/retail-poller` first. Skipping causes wrong-layer fixes.
- **Before speculating on infra failure mode** → read matching Foundation doc. `infrastructure.md` documents recurring gotchas at specific line numbers (e.g. line 265 = recurring Tailscale subnet-route loss).
- **Before claiming what env/secret is set on Fly.io or home poller** → `mcp__infisical__get-secret` (project `stak-trakr-94m4`, env `dev`). Infisical MCP is disabled by default for security — enable with `/mcp` if not active. Infisical is canonical, not assumption or stale memory.
- **Before any version-bump PR**:
  - Run `/update-spot-bundle`.
  - Ensure Tailscale is active and `SQLD_URL=http://192.168.1.81:8080` is set.
  - In `/sketch orchestrate`: Run in the same closing-task cohort as the version bump (CLOSE-4).
  - Stage and commit before executing `gh pr create`.
- **Version lock high-water mark** → the next version must be `max(all entries in version.lock including expired, APP_VERSION on origin/dev)`. Never derive the next version from stale local `APP_VERSION` alone. Prune expired entries from the lock file but treat their version numbers as consumed.
- **Before `dev → main`** → `/staktrakr-ship`, only on explicit user "ready to ship".
- **Before citing any cron schedule** → grep `devops/pollers/home-poller/docker-entrypoint.sh` for the authoritative value.

## Design Context

Users span casual stackers → serious investors → preppers. Primary context: home desktop, mobile matters. Brand voice: **sharp, capable, empowering** — pro trading terminal, not toy. Full design system + brand identity + four-theme rules (light, dark, slate, sepia) + anti-references (NOT generic fintech, NOT crypto/Web3, NOT spreadsheet clone) in `DocVault/Projects/StakTrakr/Foundation/design-philosophy.md`.
