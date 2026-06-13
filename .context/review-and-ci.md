# Review & CI Context — StakTrakr

PR review, Codacy, agentlint, and known false positives.
Loaded on demand during `/pr-resolve`, Codacy local scans (`codacy-analysis`), `/pr-ready`, and code review workflows.

## Review routing (2026-06-13)

Post-Copilot→CodeRabbit migration. Which bot reviews, when, and how:

| Reviewer       | Trigger                                 | Notes                                                                                                                                                                                                                                                         |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeRabbit** | **Automatic** on every PR to `dev`      | Primary reviewer. `.coderabbit.yaml`: `auto_review.base_branches: [dev]`, `request_changes_workflow: true`. Throttles past ~4–8 reviews/hr → 5–10 min lag. A `CHANGES_REQUESTED` clears only on a clean re-review (a `COMMENTED` re-review does not flip it). |
| **Codacy AI**  | On-demand via the `codacy-review` label | Security layer. CodeRabbit auto-applies the label (`auto_apply_labels: true`) — **do not add it by hand.** Steer recurring AI false positives via the root `review.md` (the AI Reviewer has no reply-learning system).                                        |
| **Copilot**    | On-demand                               | No longer automatic.                                                                                                                                                                                                                                          |

### 75% docstring-coverage pre-merge gate (the invisible blocker)

CodeRabbit enforces a 75% docstring-coverage **pre-merge check** (org-level via `inheritance: true`, not in the repo yaml). New or modified JS **and shell** functions need docstrings — JSDoc, or a `#` comment line directly above a shell function — or the PR sticks at `reviewDecision: CHANGES_REQUESTED` / `mergeStateStatus: BLOCKED` **with every GitHub status check green and 0 unresolved threads.** The failing check appears **only** in CodeRabbit's "Pre-merge checks" issue-comment panel — invisible to `statusCheckRollup`, the legacy status API, and the `reviewThreads` GraphQL query.

When a PR is `CHANGES_REQUESTED` but threads == 0 and checks are green → fetch the latest `coderabbitai[bot]` issue comment and read its "Pre-merge checks" panel for `❌ Error` rows. Write docstrings pre-emptively on new functions. (This cost three round-trips on PR #1255 before it was spotted.)

## Pre-PR scan — Codacy local analysis (Gen-3)

Run the local scan with the official Codacy analysis CLI (installed machine-wide via
`npm i -g @codacy/analysis-cli`; no per-project bootstrap):

- Scan changed files: `codacy-analysis analyze --diff --output-format sarif --output codacy-findings.sarif`
- Config: `.codacy/codacy.config.json` — a 1:1 mirror of the Codacy Cloud dashboard,
  regenerated with `codacy-analysis init --remote gh lbruton StakTrakr`.
- `analyze` does **not** mutate the config file (verified), so there is no churn to revert.

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
- Do not add the `codacy-review` label by hand — CodeRabbit auto-applies it (`auto_apply_labels: true`), and the label is what triggers Codacy's AI security review. Adding it manually is redundant and can fire a premature or duplicate Codacy review cycle. (See "Review routing" above.)

## Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit/Gemini/Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** — auto-generated refactor PRs. Triage individually.
- **CodeRabbit StakTrakr issue prefix** — see global CLAUDE.md "Conventions" rule on post-migration prefix flags; pre-classify as false positive.
- **Copilot `no-undef` on browser globals** — project uses script-tag globals across vanilla JS files with no bundler. The phrasing "vanilla JS global scope, no module bundler" is sufficient context in PR replies; do not include a file count (it changes).
- **`gb-*` CSS classes** — goldback-scoped. Do not copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **CodeRabbit reviews dev-targeting PRs** — `.coderabbit.yaml` `auto_review.base_branches: [dev]` makes every dev PR auto-reviewed (this reversed the old "default branch only" behavior). Expect the 5–10 min throttle lag before the review posts; do not assume "no review is coming." (See "Review routing" above.)
- **Retail out-of-stock detection is content-driven** — `detectStockStatus` in `firecrawl-extract.js` regex-matches rendered markdown.
  - Rendered markdown **includes ShopperApproved review blocks**.
  - Customer-review text containing "out of stock", "unavailable", or "page not found" produces systematic false out-of-stock results for entire vendors.
  - Investigation: scrape page, check if trigger text lies after the pricing table. If so, extend `MARKDOWN_CUTOFF_PATTERNS`. Use a plural-tolerant regex, such as `Reviews?`.
