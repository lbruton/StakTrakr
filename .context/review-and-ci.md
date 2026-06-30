# Review & CI Context — StakTrakr

PR review, Codacy, agentlint, and known false positives.
Loaded on demand during `/pr-resolve`, Codacy local scans (`codacy-analysis`), `/pr-ready`, and code review workflows.

## Review routing (updated 2026-06-14 — tag-gated)

AI reviewers are **opt-in per PR via labels** to conserve review credits — none auto-review an untagged PR. Add labels at PR creation for review-worthy PRs (runtime patches, version bumps); omit them on trivial chores (docs/config). The required status checks (`Codacy Static Code Analysis`, CodeQL) run regardless of labels.

| Reviewer       | Trigger                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeRabbit** | On-demand via the `coderabbit-review` label | Was automatic on every `dev` PR; tag-gated as of 2026-06-14 (the auto-review was burning credits). Auto re-review is **paused after the first review** (incremental disabled) — follow-up commits don't trigger a fresh review; re-trigger manually. `request_changes_workflow: true` → a `CHANGES_REQUESTED` clears only on a clean re-review (a `COMMENTED` re-review does not flip it). ~4–8 reviews/hr throttle → 5–10 min lag. |
| **Codacy AI**  | On-demand via the `codacy-review` label     | Security layer. Add the label explicitly at PR creation — for untagged PRs, CodeRabbit's auto-apply of `codacy-review` no longer fires (it runs only when `coderabbit-review` triggered CodeRabbit). The AI Reviewer has no reply-learning system, so recurring false positives must be re-triaged each time — see the "Known Reviewer False Positives" section below.                                                              |
| **Copilot**    | On-demand                                   | Not automatic. Label-based triggering is the planned direction but is not yet wired up.                                                                                                                                                                                                                                                                                                                                             |

**Add both `coderabbit-review` and `codacy-review` at PR creation** for any PR you want reviewed; the `/release` and PR-creation flows should apply both.

### 75% docstring-coverage pre-merge gate (the invisible blocker)

CodeRabbit enforces a 75% docstring-coverage **pre-merge check** (org-level via `inheritance: true`, not in the repo yaml). New or modified JS **and shell** functions need docstrings — JSDoc, or a `#` comment line directly above a shell function — or the PR sticks at `reviewDecision: CHANGES_REQUESTED` / `mergeStateStatus: BLOCKED` **with every GitHub status check green and 0 unresolved threads.** The failing check appears **only** in CodeRabbit's "Pre-merge checks" issue-comment panel — invisible to `statusCheckRollup`, the legacy status API, and the `reviewThreads` GraphQL query.

When a PR is `CHANGES_REQUESTED` but threads == 0 and checks are green → fetch the latest `coderabbitai[bot]` issue comment and read its "Pre-merge checks" panel for `❌ Error` rows. Write docstrings pre-emptively on new functions. (This cost three round-trips on PR #1255 before it was spotted.)

### Async bot reviewers land after checks go green

Copilot and Codacy AI post review threads 1–3 min _after_ required checks pass — often after the merge window opens. Before merging: confirm required checks are green, pause ~2–3 min, then re-query review threads. Treat a `null` result or `errors` array from a `gh api graphql` query as a failure (a malformed query can silently return `null`); an empty `nodes` array is the valid "no active threads" state — confirm the response is a valid list before merging.

## Pre-PR scan — Codacy local analysis (Gen-3)

Run the local scan with the official Codacy analysis CLI (installed machine-wide via
`npm i -g @codacy/analysis-cli`; no per-project bootstrap):

- Scan changed files: `codacy-analysis analyze --diff --output-format sarif --output codacy-findings.sarif`
- Config: `.codacy/codacy.config.json` — a near-1:1 mirror of the Codacy Cloud dashboard,
  regenerated with `codacy-analysis init --remote gh lbruton StakTrakr`. The two
  `localConfigurationFile` entries (ESLint9, markdownlint) are deliberately kept
  **repo-relative** (`eslint.config.cjs`, `.markdownlint.json`) — `analyze` resolves them
  against the project root, so the tracked file is portable across the main checkout and
  every worktree.
- `analyze` does **not** mutate the config file (verified), so there is no churn to revert.
- **Do NOT run `init --remote` in a worktree.** The tracked, repo-relative config is the
  working copy and resolves correctly in any checkout, so re-init buys nothing and actively
  harms: `init` overwrites from cloud regardless of git tracking and re-bakes absolute
  `/Volumes/...` paths that then break in worktrees. Refresh **only** when the cloud
  "StakTrakr" standard actually changes, and do it **in the main checkout** — run
  `codacy-analysis init --remote gh lbruton StakTrakr`, then re-relativize the two paths and
  commit:
  `sed -i '' 's#"/Volumes/DATA/GitHub/StakTrakr/\(\.markdownlint\.json\|eslint\.config\.cjs\)"#"\1"#g' .codacy/codacy.config.json`
- **Cloud state is authoritative via the Cloud CLI, not the dashboard UI.** Before
  claiming a Codacy tool toggle or pattern suppression is done, confirm it with the
  Codacy Cloud CLI (`/codacy-skills:codacy-cloud-cli`) — the dashboard UI and backend
  can diverge, and a UI-only check has been wrong repeatedly in a single session. The
  Codacy MCP server is retired; use the `codacy-skills` plugin CLIs (`codacy-cloud-cli`
  for cloud state, `codacy-analysis-cli` for local scans).

## Dual ESLint config — `.eslintrc.json` is read by Codacy and CodeRabbit

The repo carries two ESLint configs: `eslint.config.cjs` (flat — used by local `npm run lint`) and `.eslintrc.json` (legacy — read server-side by Codacy's ESLint **and** by CodeRabbit's sandbox, which resolves the legacy eslintrc over the flat config). With a flat config present, ESLint 9 ignores the legacy file locally.

- The `no-restricted-globals` ban on native `alert`/`confirm`/`prompt` (use `showAppAlert`/`showAppConfirm`/`showAppPrompt`) lives **only** in `.eslintrc.json`, so a native `confirm()` passes `npm run lint` but Codacy flags it.
- The legacy config defaults `sourceType` to `script`, so an `overrides` block sets `sourceType: module` for `tests/**/*.js`. Without it, CodeRabbit fails to parse ES-module Playwright/unit specs (`'import' and 'export' may appear only with 'sourceType: module'`) on every PR that touches a spec. `npm run lint` never globs `tests/playwright/**`, so it can't catch this.
- Before deleting `.eslintrc.json` or bumping to ESLint 10 (Dependabot PR #1228 is deferred pending Codacy support), migrate the `no-restricted-globals` rule into `eslint.config.cjs`.

Project-specific noise: the app uses script-tag globals. Local ESLint uses the repo's
`eslint.config.cjs` (which disables `no-undef`), while the dashboard's managed ESLint
patterns may still flag browser globals — so local and dashboard ESLint can differ on
`no-undef`. Treat pre-existing browser-global findings as noise; verify findings on
changed lines only. Global `Action Gates` covers the fresh-worktree empty-diff issue.

## Codacy Agentlint

Codacy runs agentlint policies on instruction files (CLAUDE.md, AGENTS.md, skill files). These policies are modeled on real-world failure patterns and their intent is worth honoring:

- **Local linting gate:** After modifying any instruction file, run `npx agentlinter --local` before committing.
- Instruction files include CLAUDE.md, AGENTS.md, and skill `SKILL.md` files.
- Aim for a perfect score.
- Accept deductions only when the flagged pattern is intentional and project-specific.
- Document accepted deductions inline or in this section.
- When agentlint flags a pattern, evaluate whether the underlying concern is valid for this project.
- If it is valid, adjust the instructions to address the concern.
- Do not weaken project-specific instructions to satisfy a generic policy.
- Our instructions encode hard-won lessons; agentlint policies encode general best practices.
- When they conflict, project instructions win; note the tension.
- Do not reflexively dismiss every finding as a false positive.
- If a policy catches a genuine gap, fix it.
- Add `coderabbit-review` and `codacy-review` at PR creation for review-worthy PRs — the labels are what trigger CodeRabbit and Codacy's AI security review respectively. Untagged PRs get no AI review (by design, to conserve credits; required Codacy Static + CodeQL still run). CodeRabbit's auto-apply of `codacy-review` only fires once CodeRabbit itself runs (i.e. when `coderabbit-review` is present), so add both explicitly rather than relying on it. (See "Review routing" above.)

## Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit/Gemini/Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** — auto-generated refactor PRs. Triage individually.
- **CodeRabbit StakTrakr issue prefix** — see global CLAUDE.md "Conventions" rule on post-migration prefix flags; pre-classify as false positive.
- **Copilot `no-undef` on browser globals** — project uses script-tag globals across vanilla JS files with no bundler. The phrasing "vanilla JS global scope, no module bundler" is sufficient context in PR replies; do not include a file count (it changes).
- **`gb-*` CSS classes** — goldback-scoped. Do not copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **CodeRabbit is tag-gated, not automatic (2026-06-14)** — CodeRabbit reviews only a PR carrying the `coderabbit-review` label; an untagged PR gets **no** CodeRabbit review, and that is expected, not a misconfiguration. (This reversed the earlier "auto-review every `dev` PR" behavior, which was burning review credits.) Add `coderabbit-review` (+ `codacy-review`) when you want the AI pass. (See "Review routing" above.)
- **Retail out-of-stock detection is content-driven** — `detectStockStatus` in `firecrawl-extract.js` regex-matches rendered markdown.
  - Rendered markdown **includes ShopperApproved review blocks**.
  - Customer-review text containing "out of stock", "unavailable", or "page not found" produces systematic false out-of-stock results for entire vendors.
  - Investigation: scrape page, check if trigger text lies after the pricing table. If so, extend `MARKDOWN_CUTOFF_PATTERNS`. Use a plural-tolerant regex, such as `Reviews?`.
