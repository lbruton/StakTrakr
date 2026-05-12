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
- **Run `/update-spot-bundle` before EVERY version-bump PR** (whether targeting `dev` or `main`). Queries sqld and rebuilds `data/spot-history-bundle.js`. Copilot's reminder is correct — not a false positive.
- Pushing fixes to an open PR → commit from existing PR worktree, not a new branch.

## MCP Notes

- StakTrakrApi config (Fly.io `fly.toml`) lives there during transition — use `mcp__github__*`.
- All `cloud-sync.js` patches require `/codex:rescue` peer review before merge.
- Codex handoff prompts use `$spec` not `/spec`.
- StakTrakr-specific code-search hint: the project uses script-tag globals, so when claude-context returns thin results for a global, fall back to CGC structural query before Grep.

## Skills

| Skill                             | Use When                                                            |
| --------------------------------- | ------------------------------------------------------------------- |
| `/api-infrastructure`             | Feed / poller / API / data-path work                                |
| `/repo-boundaries`                | Cross-repo, Fly.io / StakTrakrApi / home poller                     |
| `/update-spot-bundle`             | Rebuild `data/spot-history-bundle.js` — run before every release PR |
| `/staktrakr-ship`                 | Ship `dev → main` (only on explicit "ready to ship")                |
| `/sw-cache`                       | Service worker cache version updates                                |
| `/retail-poller`                  | Retail pipeline — scraping, confidence, providers.json              |
| `/retail-provider-fix`            | Diagnose scraping failures for individual dealers                   |
| `/deploy-verify`                  | Post-deploy health (Portainer home + Fly.io cloud)                  |
| `/faq`                            | In-app FAQ entries                                                  |
| `/finishing-a-development-branch` | Implementation complete — merge/PR/cleanup                          |
| `/pr-ready`                       | Pre-PR checklist                                                    |
| `/release`                        | Version bump (project override of global `/release`)                |
| `/start-patch`                    | Pick Plane issue, claim version lock, create worktree               |
| `/ui-mockup`                      | New multi-element UI — Playground prototype first                   |

**Skill authoring:** filename MUST be `SKILL.md` — `.gitignore` only tracks `!.claude/skills/*/SKILL.md`. Other `.md` names silently gitignored. If a genuinely different structure is needed, stop and ask + update `.gitignore` in the same PR. YAML frontmatter required (pattern: `.claude/skills/sw-cache/SKILL.md`).

## Always-Load Context

### Dual Config Store — CRITICAL

Two separate localStorage stores. Confusing them = silent data loss.

| Store             | Key                  | Manages                                         | Read                                                   | Write                                                  |
| ----------------- | -------------------- | ----------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Spot providers    | `metalApiConfig`     | METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM | `loadApiConfig()`                                      | `saveApiConfig()`                                      |
| Catalog providers | `catalog_api_config` | Numista apiKey, PCGS bearerToken                | `catalogConfig.getNumistaConfig()` / `getPcgsConfig()` | `catalogConfig.setNumistaConfig()` / `setPcgsConfig()` |

Reading catalog keys via `loadApiConfig().keys["numista"]` returns `undefined` (wrong store — root cause of STAK-573). `saveData()` wraps in `JSON.stringify` — always read via `loadData()` / `loadDataSync()`. After saving a catalog key, call `catalogAPI.initializeProviders()` to refresh stale provider instances.

### `check-release-sync` hook is a SUBSET

Validates `constants.js ↔ package.json ↔ package-lock.json ↔ version.json ↔ CHANGELOG.md`. Does NOT check `js/about.js` What's New, `manifest.json`, README badges, or `sw.js` cache. **Hook green ≠ release complete.** `/release` is the only path that touches all release-bearing files.

### Script load order — `safeGetElement` unavailable in `events.js` top-level

`init.js` (defines `safeGetElement`) loads AFTER `events.js` (both `defer`). Top-level code in `events.js` that calls `safeGetElement` throws a silent ReferenceError. Use `document.getElementById` for event wiring that runs at parse time. Factory closures (e.g., `createLotEachToggle`) are fine — they call `safeGetElement` at runtime.

### Playwright dialog testing — `showAppConfirm` is NOT `window.confirm`

`showAppConfirm` (`js/dialogs.js`) is a custom DOM modal (`#appDialogModal`), not native `window.confirm`. `page.on("dialog", ...)` does NOT intercept it. Tests must: (1) fire-and-forget the async fn via `page.evaluate`, (2) `waitForSelector("#appDialogModal", {state:"visible"})`, (3) click `#appDialogOk` or `#appDialogCancel`. Same for `showAppAlert` and `showAppPrompt`.

### `state.js` variable exposure — `let` needs `Object.defineProperty`

Variables declared with `let` in `state.js` are NOT on `window`. `inventory` and `changeLog` have explicit `Object.defineProperty` getter/setters. Any new state variable that tests or other modules need via `window.X` must follow the same pattern.

### Pre-PR scan — Codacy CLI project-specific noise

Project uses script-tag globals the auto-config doesn't recognize. Pre-existing browser-global `no-undef` findings are noise. Verify findings on changed lines only. (Global `Action Gates` covers the fresh-worktree empty-diff issue.)

### Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit/Gemini/Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** — auto-generated refactor PRs. Triage individually.
- **`gb-*` CSS classes** — goldback-scoped. Don't copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **Retail OOS detection is content-driven** — `detectStockStatus` in `firecrawl-extract.js` regex-matches rendered markdown which **includes ShopperApproved review blocks**. Customer-review text containing "out of stock", "unavailable", "page not found" produces systematic false-OOS for entire vendors. Investigation: scrape page, check if trigger text lies AFTER pricing table — if so extend `MARKDOWN_CUTOFF_PATTERNS` (regex must be plural-tolerant: `Reviews?`).

## Pre-flight (StakTrakr-specific)

- **Before writing any JS** → read `Foundation/coding-standards.md` (DocVault). Authoritative source for code style, DOM rules, storage patterns, error handling, API integration, library standards, CSS design system, and anti-patterns.
- **Before any feed/poller/API/data-path diagnosis** (poller logs OK but UI wrong, vendor anomaly, prices missing) → invoke `/api-infrastructure` and `/retail-poller` first. Skipping causes wrong-layer fixes.
- **Before speculating on infra failure mode** → read matching Foundation doc. `infrastructure.md` documents recurring gotchas at specific line numbers (e.g. line 265 = recurring Tailscale subnet-route loss).
- **Before claiming what env/secret is set on Fly.io or home poller** → `mcp__infisical__get-secret` (project `stak-trakr-94m4`, env `dev`). Infisical is canonical, not assumption or stale memory.
- **Before any version-bump PR** → `/update-spot-bundle` (requires Tailscale + `SQLD_URL=http://192.168.1.81:8080`).
- **Before `dev → main`** → `/staktrakr-ship`, only on explicit user "ready to ship".
- **Before citing any cron schedule** → grep `devops/pollers/home-poller/docker-entrypoint.sh` for the authoritative value.

## Design Context

Users span casual stackers → serious investors → preppers. Primary context: home desktop, mobile matters. Brand voice: **sharp, capable, empowering** — pro trading terminal, not toy. Full design system + brand identity + three-theme rules + anti-references (NOT generic fintech, NOT crypto/Web3, NOT spreadsheet clone) in [[Foundation/design-philosophy]].
