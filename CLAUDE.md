# CLAUDE.md

---

## Project at a Glance

**StakTrakr** — precious metals inventory tracker. Single HTML page, vanilla JS, localStorage persistence.
Works on `file://` and HTTP. Runtime artifact: zero build step, zero install. See `coding-standards` skill for patterns.

**Version format**: `BRANCH.RELEASE.PATCH` in `js/constants.js`. Use `/release` skill to bump (touches 7 files).

## Dual Config Store — CRITICAL

Two separate localStorage config stores exist. Confusing them causes silent data loss.

| Store                 | localStorage key     | Manages                                              | Read via                                               | Write via                                              |
| --------------------- | -------------------- | ---------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| **Spot providers**    | `metalApiConfig`     | METALS_DEV, METALS_API, METAL_PRICE_API, CUSTOM keys | `loadApiConfig()`                                      | `saveApiConfig()`                                      |
| **Catalog providers** | `catalog_api_config` | Numista apiKey, PCGS bearerToken                     | `catalogConfig.getNumistaConfig()` / `getPcgsConfig()` | `catalogConfig.setNumistaConfig()` / `setPcgsConfig()` |

**Never use `loadApiConfig().keys["numista"]`** — it reads from the wrong store and returns `undefined`. Root cause of STAK-573 data loss bug.

- `saveData()` wraps values in `JSON.stringify` — never use raw `localStorage.getItem()` to read `saveData`-written keys. Use `loadData()` or `loadDataSync()`.
- After saving a catalog key, call `catalogAPI.initializeProviders()` to refresh stale provider instances.

## Cloud Sync Patterns

- **Atomic rollback**: Settings write loops must snapshot `localStorage.getItem()` before each `setItem`, restore on failure (not `removeItem`). Dual arrays: `_appliedKeys` (compensate), `_failedKeys` (log).
- **Codex peer review**: All `cloud-sync.js` patches require `/codex:rescue` review before merge.
- **`ALLOWED_STORAGE_KEYS` guard**: `typeof ALLOWED_STORAGE_KEYS !== 'undefined'` is defensive coding — the constant IS defined at `constants.js:871`. Automated reviewer flags on this are false positives.

## Data Feed Gotchas

> **Before diagnosing any feed/poller/API/data-path issue:** invoke `/api-infrastructure` first — it loads the mandatory DocVault update list (`API Reference.md`, `Remote Poller.md`), the Fly.io two-phase manual-deploy procedure, and `stale_after` conventions. Skipping this routing is the most common way sessions ship wrong-layer fixes.

- **Goldback scrapes DAILY at 16:05 UTC** (cron `05 16 * * *` in `devops/pollers/home-poller/docker-entrypoint.sh`), NOT hourly. `goldback-scraper.js` has no in-script skip-guard — the daily cron is the dedup.
- **Api Health** — `api-health.js` reads v2 envelope `generated_at` (rewritten each publish cycle by `api-export.js`), not `scraped_at`. For a daily feed, `scraped_at` can legitimately be ~24h old while the badge stays green.
- **Poller cron source of truth: `devops/pollers/home-poller/docker-entrypoint.sh`** — grep this file before citing any cron schedule.
- **For any "frontend data is wrong" bug** — `curl` the exact URL the frontend constructs BEFORE analyzing parse/schema logic. A 404 beats any schema analysis, and stale `localStorage` on your dev browser can mask fresh-browser regressions for months.
- **API base** is `data/v2/` (set in `js/constants.js:527`).

## Known Automated Reviewer False Positives

- `ALLOWED_STORAGE_KEYS` "fail-open" / "undefined guard" — constant exists at `constants.js:871`, guard is defensive pattern
- CodeRabbit re-review duplicates — after pushing fixes, CodeRabbit re-reviews and regenerates threads on the same file/line. Auto-resolve duplicates without user approval.
- CodeRabbit "simplify code" PRs — auto-generated refactor PRs from CodeRabbit's code simplifier mode. Triage individually.
- `gb-*` CSS classes are **goldback-scoped** — do not copy them to other settings panels without renaming to neutral prefixes (`source-group`, `source-btn`, `input-shell`).

## Documentation

**Tier 1 — Foundation docs** (start here). Seven canonical pages at `DocVault/Projects/StakTrakr/Foundation/`:

| File                   | When to read                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| `infrastructure.md`    | Deploy topology, Fly.io, home poller, secrets, CI/CD, health thresholds      |
| `architecture.md`      | System design, frontend/API/data model, sqld schema                          |
| `coding-standards.md`  | DOM patterns, localStorage, service worker, release workflow, testing        |
| `design-philosophy.md` | Brand, colors, typography, component patterns                                |
| `reusable-patterns.md` | Vendor normalization, providers.json, retail modal, chart abstractions       |
| `data-pipelines.md`    | Spot / retail / goldback / image pipelines — cron, thresholds, failure modes |
| `cloud-sync.md`        | Dropbox OAuth, AES-256-GCM, atomic rollback, backup/restore                  |

**Tier 2 — Deep dives.** Individual topic docs at `DocVault/Projects/StakTrakr/` (31 pages). Use these when the foundation doc links out for detail. Full list: `_Index.md`.

**Tier 3 — Source code.** When a foundation doc disagrees with source code, the code wins. Always verify infra/cron claims against `devops/pollers/home-poller/docker-entrypoint.sh` and `devops/pollers/remote-poller/fly.toml` — these are authoritative.

Run `/vault-drift` periodically to check foundation doc claims against code truth.

## Playwright Testing (vanilla JS, no bundler)

- **Expose internal functions for testing** — module-scope functions aren't accessible via `page.evaluate()`. Add `window.X = X` to the exports block at the bottom of the relevant `js/*.js` file.
- **Inject manifest state via localStorage** — `_manifestSlugs` / `_manifestCoinMeta` hydrate from `retailManifestSlugs` / `retailManifestCoinMeta` localStorage keys during init. Use `page.addInitScript` to set them before page load.
- **Patching `window.X` after load does NOT intercept module-scope calls** — use localStorage injection instead to control internal state.

## Release Workflow Gotchas

- **`devops/version.lock` is gitignored** — local coordination only, stays gitignored. Update the `version` field in place; the file will not appear in `git status`.
- **`/seed-sync`** — skill at `.claude/skills/seed-sync/` rebuilds `data/spot-history-bundle.js` before a release PR.
- **`dev` branch is also protected** — requires PRs, same as `main`. All commits must go through a worktree branch → PR → dev. Direct `git push origin dev` will be rejected.
- **New worktrees need CLAUDE.md copied** — `check-claude-md` pre-commit hook fails if `CLAUDE.md` is absent. Always run `cp CLAUDE.md .worktrees/<name>/CLAUDE.md` after `git worktree add`.
- **`stamp-sw-cache` auto-stages `sw.js`** — the pre-commit hook modifies and stages `sw.js` when JS/CSS/image files are committed. No need to manually add it; it will appear in the commit automatically.
- **Rebase merge blocked by signed commits** — GitHub can't sign rebase merge commits. Use **squash merge** or merge locally with SSH signing. If the merge button shows "Rebase merges cannot be automatically signed," switch merge method in the dropdown.
- **Worktrees need `npm install`** — prettier/lint-staged pre-commit hook requires `node_modules/`. Run `npm install --no-audit --no-fund` after creating a worktree, or the commit hook fails with ENOENT.
- **`data/` and `vendor/` excluded from prettier** — `.prettierignore` excludes `data/`, `vendor/`, `node_modules/`, `*.min.js/css`. JS/CSS in `js/` and `css/` ARE formatted on commit via lint-staged. Avoid manual formatting of excluded paths.
- **Seed-sync every version** — `/seed-sync` must run for every new version on both dev and main. No exceptions.
- **Pushing fixes to an open PR** — `cd` into the existing worktree and commit there. Do not create a new worktree for mid-review fixes.
- **Codex CLI uses `$` prefix** — handoff prompts for Codex use `$spec` not `/spec`.
