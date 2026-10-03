---
name: code-review
description: Review a StakTrakr pull request. Use on every pull request review in this repository. Routes each changed path to the canonical `.context/` doc that governs it, lists the cross-file invariants a diff-only review misses, and lists the findings that are known false positives here.
---

# StakTrakr Code Review

StakTrakr is a zero-build, vanilla JavaScript single-page app. Every file in `js/` shares one
global scope through `<script>` tags in `index.html`. The canonical rules live in `.context/`;
on any conflict between a doc and source code, the code is truth and the doc is the defect.

## 1. Read the governing doc before judging a changed path

| Changed path                                    | Read first                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------- |
| `js/**`, `sw.js`, `index.html`                  | `.context/coding-standards.md`, `.context/implementation-gotchas.md`      |
| `css/**`, modal or view rendering               | `.context/design-philosophy.md`                                           |
| Cloud sync, vault, backup, diff or merge code   | `.context/cloud-sync.md`, `.context/cloud-sync-convergence.md`            |
| Spot, retail, goldback, image pipelines         | `.context/data-pipelines.md`, `.context/reusable-patterns.md`             |
| `devops/**`, pollers, Fly.io, Cloudflare        | `.context/infrastructure.md`, the matching file in `.context/deep-dives/` |
| `tests/**`                                      | `.context/testing.md`                                                     |
| Version files, `CHANGELOG.md`, `js/about.js`    | `.context/git-topology.md`                                                |
| `docs/specs/**`                                 | `.context/spec-conventions.md`                                            |
| `.context/**`, `CLAUDE.md`, `AGENTS.md`, skills | The source file the changed statement describes                           |

## 2. Cross-file invariants

A diff shows what changed, not what should have changed with it. Check each of these against
the whole repository, not only the changed lines.

- **Doc drift.** A behavior change needs its `.context/` doc updated in the same pull request.
  When a `.context/` statement changes, search for the same claim restated in other `.context/`
  files, `CLAUDE.md`, `AGENTS.md`, and skill files, and report the copies left stale.
- **Skill twins.** Every `.claude/skills/<name>/SKILL.md` has a twin at
  `.agents/skills/<name>/SKILL.md`. A change to one without the identical change to the other
  is a defect.
- **New script file.** It must be registered in both `sw.js` `CORE_ASSETS` and the `index.html`
  script load order, placed after every script whose globals it uses at parse time.
- **New top-level declaration in `js/`.** A second top-level `const` or `let` with a name that
  already exists in another `js/` file stops the later script from loading. Search for the name.
- **New storage key.** It must be listed in `ALLOWED_STORAGE_KEYS` in `js/constants.js`.
- **Config stores.** Spot configuration (`metalApiConfig`) and catalog configuration
  (`catalog_api_config`) are separate stores. Code that reads one and writes the other loses data.
- **Sync changes.** Any change to compare, merge, or hash logic must keep the convergence
  invariant in `.context/cloud-sync-convergence.md`.
- **Date frames.** User-facing dates use the local `en-CA` frame; feed-keyed values use UTC.
  Flag code that mixes the two or slices an ISO string to get a day.
- **Rendered user input.** Strings rendered into the DOM go through `sanitizeHtml()`.
- **Dialogs.** Native `alert`, `confirm`, and `prompt` are banned; use `showAppAlert`,
  `showAppConfirm`, and `showAppPrompt`.
- **Themes.** There are four: `light`, `dark`, `slate`, `sepia`. Colors come from CSS custom
  properties. A color that works in one theme must be checked in the other three.
- **Tests.** A test edited in the same pull request as the implementation it covers, in a way
  that loosens an assertion, is a defect: tests are the specification. A change to the
  Playwright test inventory needs `tests/playwright/coverage-map.csv` updated.
- **Version bump.** `js/constants.js`, `package.json`, `package-lock.json`, `version.json`,
  `sw.js` `CACHE_NAME`, `CHANGELOG.md`, and the `js/about.js` What's New entry must agree, and
  the spot bundle should be refreshed (`/update-spot-bundle`). `devops/version.lock` must never
  be committed.
- **Cron schedules.** `devops/pollers/home-poller/docker-entrypoint.sh` and
  `devops/pollers/remote-poller/fly.toml` are authoritative. A doc that disagrees is the defect.
- **Release notes and user-facing claims.** Check each claim in `CHANGELOG.md` and `js/about.js`
  against what the code in the pull request guarantees, including for users on an older cached
  build.

## 3. Do not report these

- Any "X is not defined" finding in `js/`. Globals come from other script files; `no-undef` is off.
- The `typeof ALLOWED_STORAGE_KEYS !== 'undefined'` guard. It is intentional.
- A missing `contrast` theme. It does not exist.
- `document.getElementById()` in `js/about.js`, `js/init.js`, or top-level `js/events.js` wiring.
  `safeGetElement` is not yet available at parse time there.
- Size, formatting, or churn in `data/spot-history-*` files. They are machine-generated.
- Older entries removed from `getEmbeddedWhatsNew()` in `js/about.js`. The cap is five entries.
- A missing `docs/announcements.md`, or a missing version field in `manifest.json`.
- Formatting and lint style. Prettier, ESLint, and Codacy already gate those.
- `localStorage` storage of the user's own API keys or OAuth tokens. There is no server; see
  "Known False Positives" in `.github/copilot-instructions.md`.

## 4. Reporting

- Cite evidence as `path:line` for every claim about code outside the diff.
- Report one comment per root cause. When the same defect appears in several files (skill
  twins, a claim restated in three docs), post a single comment that names every location.
  Unresolved review threads block merges in this repository, so duplicate threads cost time.
- Say what is wrong and what the correct state is. Do not post praise, summaries of the change,
  or speculative "consider" suggestions with no concrete defect behind them.
