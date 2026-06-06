# Review & CI Context — StakTrakr

PR review, Codacy, agentlint, and known false positives.
Loaded on demand during `/pr-resolve`, Codacy local scans (`codacy-analysis`), `/pr-ready`, and code review workflows.

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

Codacy runs agentlint policies on instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, skill files). These policies are modeled on real-world failure patterns and their intent is worth honoring:

- **Local linting gate:** After modifying any instruction file, run `npx agentlinter --local` before committing.
- Instruction files include CLAUDE.md, AGENTS.md, GEMINI.md, and skill `SKILL.md` files.
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
- Do not add the `codacy-review` label to PRs.
- The `codacy-review` label triggers review-loop feedback cycles with agentlint.

## Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit/Gemini/Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** — auto-generated refactor PRs. Triage individually.
- **CodeRabbit StakTrakr issue prefix** — see global CLAUDE.md "Conventions" rule on post-migration prefix flags; pre-classify as false positive.
- **Copilot `no-undef` on browser globals** — project uses script-tag globals across vanilla JS files with no bundler. The phrasing "vanilla JS global scope, no module bundler" is sufficient context in PR replies; do not include a file count (it changes).
- **`gb-*` CSS classes** — goldback-scoped. Do not copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **CodeRabbit skips dev-targeting PRs** — configured for the default branch only. Do not wait for a review that will not arrive; check `gh pr view` to confirm no review is pending.
- **Retail out-of-stock detection is content-driven** — `detectStockStatus` in `firecrawl-extract.js` regex-matches rendered markdown.
  - Rendered markdown **includes ShopperApproved review blocks**.
  - Customer-review text containing "out of stock", "unavailable", or "page not found" produces systematic false out-of-stock results for entire vendors.
  - Investigation: scrape page, check if trigger text lies after the pricing table. If so, extend `MARKDOWN_CUTOFF_PATTERNS`. Use a plural-tolerant regex, such as `Reviews?`.
