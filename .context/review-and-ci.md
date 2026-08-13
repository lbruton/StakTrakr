# Review & CI Context — StakTrakr

PR review, Codacy, agentlint, and known false positives.
Loaded on demand during `/pr-resolve`, Codacy local scans (`codacy-analysis`), `/pr-ready`, and code review workflows.

## Review routing (verified 2026-08-13 — split behavior)

Routing differs per reviewer. Do not generalize from one bot to the others.

- **CodeRabbit is label-gated.** It reviews only a PR carrying the `coderabbit-review`
  label. Untagged, it still **flags and approves** but omits the full review — so it appears
  to have participated when it has not. That is expected, not a misconfiguration.
- **Codacy AI runs as part of the Codacy static-analysis stage.** This is a change on
  Codacy's side (observed 2026-08-13), not a config change here — the AI review now arrives
  bundled with the required check rather than as a separate opt-in pass.
- **Copilot is automatic, in "lite" mode.** Lite is a GitHub-side structure change; observed
  cadence is roughly unchanged, but review depth is bounded by the mode.
- **Codex is on "dynamic"** — it may or may not weigh in on any given PR. **A missing Codex
  review means nothing.** Do not treat its silence as a signal either way.

### Where each gate is configured — none of it is in this repo

This is the durable part. Current **behavior** drifts whenever a vendor ships a change; the
**control surface** is stable, so check the surface rather than trusting a remembered state.

| Reviewer       | Gate mechanism               | Configured in                                                          |
| -------------- | ---------------------------- | ---------------------------------------------------------------------- |
| **CodeRabbit** | label (`coderabbit-review`)  | CodeRabbit Repository/Organization **UI** — **not** `.coderabbit.yaml` |
| **Codacy AI**  | bundled into the check stage | Codacy product behavior + dashboard settings                           |
| **Copilot**    | mode setting (**lite**)      | GitHub repo/org Copilot settings                                       |
| **Codex**      | dynamic policy               | Codex cloud settings (`chatgpt.com/codex`)                             |

A repo-only audit sees none of these and will conclude every bot is ungated. That inference
is what produced the false correction described below.

> **`.coderabbit.yaml` alone will mislead you.** It sets
> `reviews.auto_review.base_branches: [dev]` with `drafts: true` and contains **no label
> filter** — but the label requirement is layered in CodeRabbit's Repository/Organization
> **UI** config, which the yaml does not show. The bot's own skip notice names the sources:
> "Repository YAML (base), Repository UI (inherited), Organization UI (inherited)".
>
> **A `coderabbitai` entry in the reviewers list is NOT evidence of a review.** When
> CodeRabbit skips, it still posts an **empty `APPROVED` review** alongside its "Review
> skipped" comment — so `gh pr view --json reviews` lists `coderabbitai` on PRs it never
> reviewed. Distinguish by the review **body**: a real review has one, a skip is empty.
>
> ```bash
> gh api repos/lbruton/StakTrakr/pulls/<N>/reviews \
>   --jq '.[] | select(.user.login=="coderabbitai[bot]") | "\(.state): \(.body[0:80])"'
> ```
>
> This exact inference error produced a false "CodeRabbit is not label-gated" correction in
> the 2026-08-13 drift audit — its evidence was three empty approvals.

| Reviewer       | Trigger                                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeRabbit** | **Label-gated** — requires `coderabbit-review`  | Gate is set in the CodeRabbit UI/org config, not `.coderabbit.yaml`. Add the label at PR creation for review-worthy PRs. Auto re-review is **paused after the first review** (incremental disabled) — follow-up commits don't trigger a fresh review; re-trigger manually. `request_changes_workflow: true` → a `CHANGES_REQUESTED` clears only on a clean re-review (a `COMMENTED` re-review does not flip it). ~4–8 reviews/hr throttle → 5–10 min lag. |
| **Codacy AI**  | Automatic — runs with the static-analysis stage | Security layer, now bundled into the Codacy check rather than opt-in (Codacy-side change, observed 2026-08-13). Posts on untagged PRs (#1436, #1437, #1440, #1445). No reply-learning system, so recurring false positives must be re-triaged each time — see "Known Reviewer False Positives" below.                                                                                                                                                     |
| **Copilot**    | Automatic — mode: **lite**                      | `copilot-pull-request-reviewer` posts on every recent PR, including unlabeled #1440/#1444/#1445. "Lite" is a GitHub-side structure change; cadence looks unchanged but depth is bounded by the mode. Its check run can sit `in_progress` for minutes and will hold `mergeStateStatus` at `BLOCKED` until it completes.                                                                                                                                    |
| **Codex**      | **Dynamic** — may or may not run                | `chatgpt-codex-connector`. Configured on a dynamic policy, so participation is not guaranteed on any given PR — **its absence is not a signal.** When it does run it tends to catch nonexistent-identifier and stale-contract claims the others miss (it caught both the `isGoldbackRetailLookup` and `TURSO_*`-environment errors).                                                                                                                      |

### Required checks differ by branch

| Branch | Required status checks                                      | Other enforced rules                                                                                                          |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `dev`  | **`Codacy Static Code Analysis` only** (integration 56611)  | thread resolution required, **0 approvals required**, `allowed_merge_methods: ["merge"]`, signed commits, no bypass actors    |
| `main` | `Codacy Static Code Analysis` **and `CodeRabbit`** (347564) | plus a **CodeQL `code_scanning` rule** (`alerts_threshold: errors`, `security_alerts_threshold: critical`), thread resolution |

**CodeQL is not a required status check on `dev`.** On `main` it is enforced as a
code-scanning rule rather than a status check — that distinction is why a `dev` PR can
merge while CodeQL is still running, and why a `dev → main` ship PR blocks on CodeRabbit
even though `dev` PRs never do.

**Merges block on unresolved threads, not on approvals.** Both branches set
`required_review_thread_resolution: true` with `required_approving_review_count: 0`. A PR
with every check green and zero approvals merges fine; a single unresolved bot thread
blocks it indefinitely. This is what makes `/pr-resolve` load-bearing.

### `.coderabbit.yaml` pre-steers reviews

The config carries five `path_instructions` blocks that shape every review before it
happens. Two of them pre-empt entries in "Known Reviewer False Positives" below:

- `js/**` — declares the `ALLOWED_STORAGE_KEYS` `typeof` guard **not** a bug, and states the
  `sw.js` + `index.html` dual-registration rule.
- `devops/pollers/home-poller/docker-entrypoint.sh` — declares it the **authoritative**
  source for poller cron schedules; if any doc disagrees, the entrypoint wins.

Check this file before triaging a reviewer finding as novel — it may already be handled.

### Local pre-commit gates (7 hooks)

`.pre-commit-config.yaml` runs seven hooks; two are hard gates that will fail a commit and
are easy to hit unexpectedly:

| Hook                 | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| `gitleaks` (v8.18.4) | secret scanning — blocks the commit on a hit                             |
| `check-signing-key`  | verifies the signing key is loaded (signed commits are ruleset-required) |
| `stamp-sw-cache`     | stamps the service-worker cache on staged asset changes                  |
| `check-release-sync` | release-artifact version sync (a **subset** — see `git-topology.md`)     |
| `check-claude-md`    | verifies CLAUDE.md exists (it is tracked; restore with `git restore`)    |
| `lint-staged`        | prettier on staged files                                                 |
| `lint-markdown`      | markdownlint on staged Markdown                                          |

**Order matters: prettier runs before markdownlint.** Reversed (as it was until
2026-08-13), markdownlint validated the pre-prettier content while prettier's rewrites
landed unlinted — so a commit could pass and still leave the file failing the _next_ lint.
The concrete symptom was emphasis style: prettier normalizes `*text*` to `_text_`, MD049
defaulted to "consistent" and resolved to asterisk in some files, and the two ping-ponged
across commits. `MD049` is now pinned to `underscore` (matching prettier's output) and
`MD050` to `asterisk`, so the two tools agree by construction rather than by ordering luck.

**Markdown lint coverage:** `npm run lint:md:all` globs `**/*.md`, which **does not traverse
dot-directories** — so `.context/`, `.agents/`, and `.claude/` were historically unlinted by
the repo gate and only caught by the staged pre-commit hook. All three are now globbed
explicitly. Machine-local files (`.claude/**/*.local.*`) are excluded via
`.markdownlintignore`, mirroring the matching `.gitignore` rule, because markdownlint globs
the filesystem rather than git and would otherwise judge files the repo deliberately ignores.

`.github/` stays excluded: issue templates render **into** an issue body rather than standing
as documents, so MD041 does not apply to them.

> When adding a directory to this gate, check `git ls-files` first. Lint findings on
> untracked or ignored files are noise by construction — filtering by tracked-ness before
> judging the findings is what turned an apparent "needs MD041/MD032 exceptions" verdict on
> `.claude/` into two one-line heading fixes and zero exceptions.

### 75% docstring-coverage pre-merge gate (the invisible blocker)

CodeRabbit enforces a 75% docstring-coverage **pre-merge check** (org-level via `inheritance: true`, not in the repo yaml). New or modified JS **and shell** functions need docstrings — JSDoc, or a `#` comment line directly above a shell function — or the PR sticks at `reviewDecision: CHANGES_REQUESTED` / `mergeStateStatus: BLOCKED` **with every GitHub status check green and 0 unresolved threads.** The failing check appears **only** in CodeRabbit's "Pre-merge checks" issue-comment panel — invisible to `statusCheckRollup`, the legacy status API, and the `reviewThreads` GraphQL query.

When a PR is `CHANGES_REQUESTED` but threads == 0 and checks are green → fetch the latest `coderabbitai[bot]` issue comment and read its "Pre-merge checks" panel for `❌ Error` rows. Write docstrings pre-emptively on new functions. (This cost three round-trips on PR #1255 before it was spotted.)

### Async bot reviewers land after checks go green

Copilot and Codacy AI post review threads 1–3 min **after** required checks pass — often after the merge window opens. Before merging: confirm required checks are green, pause ~2–3 min, then re-query review threads. Treat a `null` result or `errors` array from a `gh api graphql` query as a failure (a malformed query can silently return `null`); an empty `nodes` array is the valid "no active threads" state — confirm the response is a valid list before merging.

## Pre-PR scan — Codacy local analysis (Gen-3)

Run the local scan with the **`codacy-analysis`** command (npm package `@codacy/analysis-cli`),
which is **already installed machine-wide** — there is no per-project bootstrap and no
per-task reinstall. NOTE: `codacy-analysis-cli` is the **skill** name, **not** a command or npm
package (it is also the name of the deprecated Gen-1 tool) — never run `codacy-analysis-cli` as
a command, and do not `npm install`/`npx` the CLI per scan. Verify presence with
`command -v codacy-analysis`; only run `npm i -g @codacy/analysis-cli` if that check fails.

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
  commit (path-agnostic, runs on macOS and Linux):
  `perl -i -pe 's#("localConfigurationFile":\s*")[^"]*/(\.markdownlint\.json|eslint\.config\.cjs)"#$1$2"#g' .codacy/codacy.config.json`
- **Cloud state is authoritative via the `codacy` command (the Codacy Cloud CLI), not the
  dashboard UI.** Before claiming a Codacy tool toggle or pattern suppression is done, confirm
  it by running the `codacy` command — invoked through the `codacy-cloud-cli` skill (Skill
  tool) — because the dashboard UI and backend can diverge, and a UI-only check has been wrong
  repeatedly in a single session. The
  Codacy MCP server is retired; use the `codacy-skills` plugin **skills** — the
  `codacy-cloud-cli` skill (which drives the `codacy` command) for cloud state, and the
  `codacy-analysis-cli` skill (which drives the `codacy-analysis` command) for local scans.
  These are skill names invoked via the Skill tool, not shell commands.

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
- Add `coderabbit-review` at PR creation when you want a full CodeRabbit review — it is the one label-gated reviewer. Codacy AI and Copilot run automatically, so budget for their threads on every PR including docs-only chores. Codex is **dynamic** and may not run at all; do not wait on it. (See "Review routing" above.)

## Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"** — constant exists at `constants.js`; the `typeof` guard is intentional.
- **Automated re-review duplicates** — after pushing fixes, CodeRabbit/Gemini/Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs** — auto-generated refactor PRs. Triage individually.
- **CodeRabbit StakTrakr issue prefix** — see global CLAUDE.md "Conventions" rule on post-migration prefix flags; pre-classify as false positive.
- **Copilot `no-undef` on browser globals** — project uses script-tag globals across vanilla JS files with no bundler. The phrasing "vanilla JS global scope, no module bundler" is sufficient context in PR replies; do not include a file count (it changes).
- **`gb-*` CSS classes** — goldback-scoped. Do not copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **CodeRabbit is label-gated, not automatic** — an untagged PR gets **no full CodeRabbit review**, and that is expected, not a misconfiguration. It may still emit flags and an empty `APPROVED` review, so the reviewers list is not a reliable signal — check the review body. Add `coderabbit-review` when you want the full pass. (See "Review routing" above.)
- **Codacy AI / Copilot threads on an untagged PR are expected** — both are automatic, unlike CodeRabbit. Budget for their threads on every PR, including docs-only chores.
- **A missing Codex review is expected too** — Codex is on a dynamic policy, so its silence carries no information. Do not investigate it and do not wait on it before merging.
- **Retail out-of-stock detection is content-driven** — `detectStockStatus` in `firecrawl-extract.js` regex-matches rendered markdown.
  - Rendered markdown **includes ShopperApproved review blocks**.
  - Customer-review text containing "out of stock", "unavailable", or "page not found" produces systematic false out-of-stock results for entire vendors.
  - Investigation: scrape page, check if trigger text lies after the pricing table. If so, extend `MARKDOWN_CUTOFF_PATTERNS`. Use a plural-tolerant regex, such as `Reviews?`.
