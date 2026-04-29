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

Tier 2 — 31 deep-dive docs at `DocVault/Projects/StakTrakr/`. Full list: `_Index.md`.

Tier 3 — Source code wins on conflicts. Authoritative cron/config files: `devops/pollers/home-poller/docker-entrypoint.sh`, `devops/pollers/remote-poller/fly.toml`.

---

## Issue Tracking

Prefix: `STRK-`. Issues tracked in Plane: <https://plane.lbruton.cc/lbruton/projects/026dbe54-fe52-4a9f-9f1b-7edcb9bbdceb/>.

Pre-migration DocVault issues (STAK-) are archived at `DocVault/Archive/Issues-Pre-Plane/StakTrakr/`. New issues are created via `/issue` (which dispatches on `.specflow/config.json` `issue_backend`) or directly via `mcp__plane__create_issue`.

---

## Git Topology

- **Branch model:** `feature/* → dev → main`. All commits go through worktree branch → PR → dev. Both `dev` and `main` are protected — no direct pushes.
- **Version format:** `MAJOR.MINOR.PATCH` in `js/constants.js` (code comment calls these `BRANCH.RELEASE.PATCH`). Use `/release` to bump (touches 7 files).
- **Version lock:** `devops/version.lock` is gitignored — local coordination only.
- **Worktrees:** `.worktrees/<issue>-<slug>/`. Before creating: `git fetch origin dev` to sync remote dev (works from any worktree — no branch checkout needed). Then: `git worktree add .worktrees/<issue>-<slug>/ -b <branch-name> origin/dev`. After: `cp CLAUDE.md .worktrees/<issue>-<slug>/CLAUDE.md` then `npm install --no-audit --no-fund`.
- **Squash merge only** — rebase merge is blocked (GitHub can't sign rebase commits). Use squash merge or local merge with SSH signing.
- **`stamp-sw-cache` hook** — auto-stages `sw.js` when JS/CSS/image files are committed. No need to add it manually.
- **`data/` and `vendor/` excluded from prettier** — lint-staged formats `js/` and `css/` only. Avoid manually formatting excluded paths.
- **Update spot bundle before release** — always run `/update-spot-bundle` before opening a release PR (queries sqld and rebuilds `data/spot-history-bundle.js` with current data).
- **Pushing fixes to an open PR** — commit from the existing PR worktree (`.worktrees/<branch>`), not a new branch.

---

## MCP Notes

- StakTrakrApi config → `mcp__github__*` (Fly.io `fly.toml` lives there during transition)
- All `cloud-sync.js` patches require `/codex:rescue` peer review before merge.
- Codex handoff prompts use `$spec` not `/spec`.

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
| `/start-patch`                    | Pick a DocVault issue, claim version lock, create worktree                                                        |
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

### Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional defensive coding.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit, Gemini, and Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** — auto-generated refactor PRs. Triage individually.
- **`gb-*` CSS classes** — goldback-scoped. Don't copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).

---

## Pre-flight (StakTrakr-specific)

- **Before any feed/poller/API/data-path diagnosis** → invoke `/api-infrastructure` first. Skipping causes wrong-layer fixes.
- **Before speculating on infra failure mode** → read the matching Foundation doc. `infrastructure.md` lists known gotchas at specific line numbers (e.g. line 265 documents the recurring Tailscale subnet-route loss). Skim it before dispatching debugger agents.
- **Before claiming what env/secret is set on Fly.io or home poller** → look it up via `mcp__infisical__get-secret` (project `stak-trakr-94m4`, env `dev`). I deploy and manage Fly.io for the user; Infisical is the canonical source, not assumption or stale memory.
- **Before any release PR** → run `/update-spot-bundle` (requires Tailscale + `SQLD_URL=http://192.168.1.81:8080`).
- **Before `dev → main`** → use `/staktrakr-ship` only on explicit "ready to ship" from user.
- **Before citing any cron schedule** → grep `devops/pollers/home-poller/docker-entrypoint.sh` for the authoritative value.
