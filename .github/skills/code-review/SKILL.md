---
name: code-review
description: Review a StakTrakr pull request. Use on every pull request review in this repository. Routes each changed path to the canonical `.context/` doc that governs it, lists the cross-file invariants a diff-only review misses, and lists the findings that are known false positives here.
---

# StakTrakr Code Review

StakTrakr is a zero-build, vanilla JavaScript single-page app. Scripts loaded by the same HTML
page share one global scope through `<script>` tags; the main app's page is `index.html`. The
canonical rules live in `.context/`; on any conflict between a doc and source code, the code is
truth and the doc is the defect.

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
- **New script file.** A script loaded by the main app must be in both `sw.js` `CORE_ASSETS` and
  the `index.html` load order, after every script whose globals it uses at parse time. A
  page-specific script (such as `js/ratios-page.js`) is registered in the page that loads it and
  still belongs in `sw.js`. A file not loaded at runtime (such as `js/types.js`) needs neither.
- **New top-level declaration in `js/`.** When two scripts loaded by the same HTML page declare
  the same top-level name, a second `const`, `let`, or `class` stops the later script from
  loading, and a second `var` silently overwrites the earlier value. Search for the name among
  the scripts that page loads. Names in files not loaded at runtime do not collide. See
  `.context/implementation-gotchas.md`.
- **New storage key.** It must be listed in `ALLOWED_STORAGE_KEYS` in `js/constants.js`.
- **Config stores.** Spot configuration (`metalApiConfig`) and catalog configuration
  (`catalog_api_config`) are separate stores. Code that reads one and writes the other loses data.
- **Sync changes.** Any change to compare, merge, or hash logic must keep the convergence
  invariant in `.context/cloud-sync-convergence.md`.
- **Date frames.** User-facing dates use the local `en-CA` frame; feed-keyed values use UTC.
  Flag code that mixes the two, or that uses `toISOString().slice(0, 10)` for a local user-facing
  day. Taking the UTC day from a feed row's own ISO timestamp is correct.
- **Rendered user input.** User-supplied strings interpolated into an HTML-parsing sink
  (`innerHTML`, `insertAdjacentHTML`, HTML template literals) go through `sanitizeHtml()`. Do not
  sanitize `textContent` or `value` assignments (entities would show literally) or static markup.
- **Dialogs.** Native `alert`, `confirm`, and `prompt` are banned; use `showAppAlert`,
  `showAppConfirm`, and `showAppPrompt`. The one exception is the `window.alert` fallback in
  `js/init.js` that reports a boot failure when the custom dialog is unavailable.
- **Themes.** There are four: `light`, `dark`, `slate`, `sepia`. Colors come from CSS custom
  properties. A color that works in one theme must be checked in the other three.
- **Tests.** A TDD test written for the change under review and then loosened to make the
  implementation pass is a defect. For an existing test updated with an intentional behavior
  change, check the new assertion against the changed requirement instead of flagging the edit.
  A change to the Playwright test inventory needs `tests/playwright/coverage-map.csv` updated.
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
- `document.getElementById()` followed by an `if` guard in one of three cases: an existence check
  that needs a real `null`, an early-init function in `js/about.js`, or top-level wiring in
  `js/events.js` (`safeGetElement` is not defined yet in the last two). Any other direct lookup,
  including in `js/init.js`, should use `safeGetElement()`; see `.context/coding-standards.md`.
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
