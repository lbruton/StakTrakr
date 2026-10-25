# Review & CI Context — StakTrakr

PR review, Codacy, agentlint, and known false positives.
Loaded on demand during `/pr-resolve`, Codacy local scans (`codacy-analysis`), `/pr-ready`, and code review workflows.

## Review routing (verified 2026-08-13 — split behavior)

Routing differs per reviewer. Do not generalize from one bot to the others.

- **CodeRabbit is label-triggered.** Add the `coderabbit-review` label to a PR to request a
  review. The label rule lives in the CodeRabbit UI. A PR without the label is skipped. It
  still **flags and approves** that PR, and its required `CodeRabbit` check reports
  **pass**. A skipped PR therefore looks reviewed. On a branch with many
  pushes CodeRabbit pauses its reviews ("Reviews paused"); comment `@coderabbitai resume`
  to restart them. Patch and ship PRs get the label; chores skip it.
- **Codacy AI runs as part of the Codacy static-analysis stage.** This is a change on
  Codacy's side (observed 2026-08-13), not a config change here. The AI review now arrives
  bundled with the required check rather than as a separate opt-in pass.
- **Copilot is automatic, at "Balanced" review effort** (verified 2026-10-03: every review
  body on #1535–#1546 reads `Review effort: Balanced`; it was "lite" on 2026-08-13). The
  effort level is printed in each review's overview, so read it there rather than trusting
  this line. Copilot also loads the repo's `code-review` agent skill
  (`.github/skills/code-review/SKILL.md`): see "Copilot review inputs" below.
- **Codex is on "on PR"** (changed from automatic, 2026-10-19). It reviews once when a PR is
  opened or marked ready for review, and again only when someone comments `@codex review`.
  Pushes do not trigger a fresh review. Under the old setting each push could open a new
  thread: lbruton/StakTrakr#1607 ran eight rounds on a docs-only PR.

### Where each gate is configured — none of it is in this repo

This is the durable part. Current **behavior** drifts whenever a vendor ships a change; the
**control surface** is stable, so check the surface rather than trusting a remembered state.

| Reviewer       | Gate mechanism               | Configured in                                                                |
| -------------- | ---------------------------- | ---------------------------------------------------------------------------- |
| **CodeRabbit** | `coderabbit-review` label    | CodeRabbit plan + Repository/Organization **UI**: **not** `.coderabbit.yaml` |
| **Codacy AI**  | bundled into the check stage | Codacy product behavior + dashboard settings                                 |
| **Copilot**    | review effort (**Balanced**) | GitHub repo settings → Copilot → Code review → Review effort level           |
| **Codex**      | review trigger: **on PR**    | Codex cloud settings (`chatgpt.com/codex`)                                   |

A repo-only audit sees none of these and will conclude every bot is ungated. That inference
is what produced the false correction described below.

> **`.coderabbit.yaml` alone will mislead you.** It sets
> `reviews.auto_review.base_branches: [dev]` with `drafts: true` and contains **no label
> filter**. The `coderabbit-review` label requirement lives in CodeRabbit's plan and Repository/Organization **UI** config,
> which the yaml does not show. The bot's own skip notice names the sources:
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

| Reviewer       | Trigger                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CodeRabbit** | **Label-triggered**: `coderabbit-review`       | Adding the label triggers a full review; a PR without it is skipped. After several reviewed commits on a busy branch, CodeRabbit pauses ("Reviews paused"): comment `@coderabbitai resume` to restart automatic reviews, or `@coderabbitai review` for one pass. A `@coderabbitai review` comment fails with "Head commit changed" if a push lands before it runs. `request_changes_workflow: true` → a `CHANGES_REQUESTED` clears only on a clean re-review (a `COMMENTED` re-review does not flip it). ~4–8 reviews/hr throttle → 5–10 min lag. |
| **Codacy AI**  | Automatic: runs with the static-analysis stage | Security layer, now bundled into the Codacy check rather than opt-in (Codacy-side change, observed 2026-08-13). Posts on untagged PRs (#1436, #1437, #1440, #1445). No reply-learning system, so recurring false positives must be re-triaged each time: see "Known Reviewer False Positives" below.                                                                                                                                                                                                                                              |
| **Copilot**    | Automatic: effort: **Balanced**                | `copilot-pull-request-reviewer` posts on every recent PR, including unlabeled #1440/#1444/#1445. It does not post on drafts, so it lands after CodeRabbit's draft-stage pass. Its check run can sit `in_progress` for minutes and will hold `mergeStateStatus` at `BLOCKED` until it completes.                                                                                                                                                                                                                                                   |
| **Codex**      | **On PR**: once at open/ready; `@codex review` | `chatgpt-codex-connector`. One review per PR (since 2026-10-19). Follow-up pushes are not re-reviewed unless someone comments `@codex review`, so ask for a second pass only after a substantial fix. Its one review can land minutes after the checks go green, and `dev` requires thread resolution, so re-query threads before calling a PR ready. It tends to catch nonexistent-identifier and stale-contract claims the others miss (it caught both the `isGoldbackRetailLookup` and `TURSO_*`-environment errors).                          |

### Copilot review inputs

Copilot code review reads its customization from the PR's **head branch**. A change to
any of these takes effect on the PR that makes it:

| Input                                 | Role                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `.github/copilot-instructions.md`     | Repo-wide rules, the globals list, known false positives                |
| `AGENTS.md`, `CLAUDE.md`              | Read as standing repo context (this is how it finds `.context/`)        |
| `.github/skills/code-review/SKILL.md` | Review procedure: path → `.context/` doc routing, cross-file invariants |

The skill directory is named `code-review` on purpose: GitHub's docs say a review-focused
directory name is what makes code review select a skill. It has no `.claude/` or `.agents/`
twin: it is Copilot-only, and the twin rule covers the workflow skills. No MCP servers are
configured for Copilot beyond GitHub's defaults (GitHub + Playwright); Plane is not wired in.

### Required checks differ by branch

| Branch | Required status checks                                                                | Other enforced rules                                                                                                          |
| ------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `dev`  | `Codacy Static Code Analysis` (56611), **`Tests` and `Vale`** (GitHub Actions, 15368) | thread resolution required, **0 approvals required**, `allowed_merge_methods: ["merge"]`, signed commits, no bypass actors    |
| `main` | `Codacy Static Code Analysis`, `CodeRabbit` (347564), **`Tests` and `Vale`**          | plus a **CodeQL `code_scanning` rule** (`alerts_threshold: errors`, `security_alerts_threshold: critical`), thread resolution |

`Tests` is the report job of `.github/workflows/tests.yml`. On a PR it runs the
`test:changed` selection; `.context/testing.md` describes the selection and the `dev` push run.
The report job also needs the `Lint` job, which runs `npm run lint` and `npm run format:check`
on every PR and every `dev` push. A lint or format failure fails `Tests`.

`Vale` is the job in `.github/workflows/vale.yml`. It runs on every PR, so the required check
always reports. A PR that changes no `README.md`, `.context/**/*.md` or Vale config file passes
without running Vale. Otherwise the check fails on any Prose alert on a line the PR adds;
existing alerts never fail it. A second, informational check named `vale` (reviewdog) carries
the annotations.

A `dev → main` ship PR adds every line changed since the last release, so its `Vale` check can
fail on alerts that no single `dev` PR reported. Before you open the ship PR, run Vale on the
changed docs. Keep the alerts on lines that `git diff -U0 origin/main...origin/dev` adds, and
fix them in a chore PR to `dev`. Vale does not end a sentence at a period that follows a code
span at the end of a line. It then reports the long sentence where the earlier sentence starts.

**CodeQL is not a required status check on `dev`.** On `main` it is enforced as a
code-scanning rule rather than a status check. That distinction is why a `dev` PR can
merge while CodeQL is still running. It also explains why a `dev → main` ship PR blocks on CodeRabbit
even though `dev` PRs never do.

**Merges block on unresolved threads, not on approvals.** Both branches set
`required_review_thread_resolution: true` with `required_approving_review_count: 0`. A PR
with every check green and zero approvals merges fine; a single unresolved bot thread
blocks it indefinitely. This is what makes `/pr-resolve` load-bearing.

### `.coderabbit.yaml` pre-steers reviews

The config carries five `path_instructions` blocks that shape every review before it
happens. Two of them pre-empt entries in "Known Reviewer False Positives" below:

- `js/**`: declares the `ALLOWED_STORAGE_KEYS` `typeof` guard **not** a bug, and states the
  `sw.js` + `index.html` dual-registration rule.
- `devops/pollers/home-poller/docker-entrypoint.sh`: declares it the **authoritative**
  source for poller cron schedules; if any doc disagrees, the entrypoint wins.

Check this file before triaging a reviewer finding as novel: it may already be handled.

### Local pre-commit gates (7 hooks)

`.pre-commit-config.yaml` runs seven hooks; two are hard gates that will fail a commit and
are easy to hit unexpectedly:

| Hook                 | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| `gitleaks` (v8.18.4) | secret scanning: blocks the commit on a hit                              |
| `check-signing-key`  | verifies the signing key is loaded (signed commits are ruleset-required) |
| `stamp-sw-cache`     | stamps the service-worker cache on staged asset changes                  |
| `check-release-sync` | release-artifact version sync (a **subset**: see `git-topology.md`)      |
| `check-claude-md`    | verifies CLAUDE.md exists (it is tracked; restore with `git restore`)    |
| `lint-staged`        | prettier on staged files, then ESLint on staged files in the lint scope  |
| `lint-markdown`      | markdownlint on staged Markdown                                          |

**Order matters: prettier runs before markdownlint.** Reversed (as it was until
2026-08-13), markdownlint validated the pre-prettier content while prettier's rewrites
landed unlinted. A commit could pass and still leave the file failing the _next_ lint.
The concrete symptom was emphasis style: prettier normalizes `*text*` to `_text_`. MD049
defaulted to "consistent" and resolved to asterisk in some files. The two ping-ponged
across commits. `MD049` is now pinned to `underscore` (matching prettier's output) and
`MD050` to `asterisk`, so the two tools agree by construction rather than by ordering luck.

**Markdown lint coverage:** `npm run lint:md:all` globs `**/*.md`, which **does not traverse
dot-directories**. Thus, `.context/`, `.agents/`, and `.claude/` were historically unlinted by
the repo gate and only caught by the staged pre-commit hook. All three are now globbed
explicitly. Machine-local files (`.claude/**/*.local.*`) are excluded via
`.markdownlintignore`, mirroring the matching `.gitignore` rule. The markdownlint tool globs
the filesystem rather than git. It would otherwise judge files the repo deliberately ignores.

`.github/` stays excluded: issue templates render **into** an issue body rather than standing
as documents, so MD041 does not apply to them.

> When adding a directory to this gate, check `git ls-files` first. Lint findings on
> untracked or ignored files are noise by construction — filtering by tracked-ness before
> judging the findings is what turned an apparent "needs MD041/MD032 exceptions" verdict on
> `.claude/` into two one-line heading fixes and zero exceptions.

### 75% docstring-coverage pre-merge gate (the invisible blocker)

CodeRabbit enforces a 75% docstring-coverage **pre-merge check** (org-level via `inheritance: true`, not in the repo yaml). New or modified JS **and shell** functions need docstrings (JSDoc, or a `#` comment line directly above a shell function). Otherwise, the PR sticks at `reviewDecision: CHANGES_REQUESTED` / `mergeStateStatus: BLOCKED` **with every GitHub status check green and 0 unresolved threads.** The failing check appears **only** in CodeRabbit's "Pre-merge checks" issue-comment panel: invisible to `statusCheckRollup`, the legacy status API, and the `reviewThreads` GraphQL query.

When a PR is `CHANGES_REQUESTED` but threads == 0 and checks are green → fetch the latest `coderabbitai[bot]` issue comment and read its "Pre-merge checks" panel for `❌ Error` rows. Write docstrings pre-emptively on new functions. (This cost three round-trips on PR #1255 before it was spotted.)

### Async bot reviewers land after checks go green

Copilot and Codacy AI post review threads 1–3 min **after** required checks pass: often after the merge window opens. Before merging: confirm required checks are green, pause ~2–3 min, then re-query review threads. Treat a `null` result or `errors` array from a `gh api graphql` query as a failure (a malformed query can silently return `null`). An empty `nodes` array is the valid "no active threads" state. Confirm the response is a valid list before merging.

## Pre-PR scan — Codacy local analysis (Gen-3)

Run the local scan with the **`codacy-analysis`** command (npm package `@codacy/analysis-cli`),
which is **already installed machine-wide**: there is no per-project bootstrap and no
per-task reinstall. NOTE: `codacy-analysis-cli` is the **skill** name, **not** a command or npm
package (it is also the name of the deprecated Gen-1 tool). Never run `codacy-analysis-cli` as
a command, and do not `npm install`/`npx` the CLI per scan. Verify presence with
`command -v codacy-analysis`; only run `npm i -g @codacy/analysis-cli` if that check fails.

- Scan changed files: `codacy-analysis analyze --diff --output-format sarif --output codacy-findings.sarif`
- Config: `.codacy/codacy.config.json`: a near-1:1 mirror of the Codacy Cloud dashboard,
  regenerated with `codacy-analysis init --remote gh lbruton StakTrakr`. The two
  `localConfigurationFile` entries (ESLint9, markdownlint) are deliberately kept
  **repo-relative** (`eslint.config.cjs`, `.markdownlint.json`). The `analyze` command resolves them
  against the project root. The tracked file is portable across the main checkout and
  every worktree.
- `analyze` does **not** mutate the config file (verified), so there is no churn to revert.
- **Do NOT run `init --remote` in a worktree.** The tracked, repo-relative config is the
  working copy and resolves correctly in any checkout. Re-init buys nothing and actively
  harms. The `init` command overwrites from cloud regardless of git tracking and re-bakes absolute
  `/Volumes/...` paths that then break in worktrees. Refresh **only** when the cloud
  "StakTrakr" standard actually changes, and do it **in the main checkout**. Run
  `codacy-analysis init --remote gh lbruton StakTrakr`, then re-relativize the two paths and
  commit (path-agnostic, runs on macOS and Linux):
  `perl -i -pe 's#("localConfigurationFile":\s*")[^"]*/(\.markdownlint\.json|eslint\.config\.cjs)"#$1$2"#g' .codacy/codacy.config.json`
- **Cloud state is authoritative via the `codacy` command (the Codacy Cloud CLI), not the
  dashboard UI.** Before claiming a Codacy tool toggle or pattern suppression is done, confirm
  it by running the `codacy` command. It is invoked through the `codacy-cloud-cli` skill (Skill
  tool). The dashboard UI and backend can diverge. A UI-only check has been wrong
  repeatedly in a single session. The
  Codacy MCP server is retired; use the `codacy-skills` plugin **skills**: the
  `codacy-cloud-cli` skill (which drives the `codacy` command) for cloud state. Use the
  `codacy-analysis-cli` skill (which drives the `codacy-analysis` command) for local scans.
  These are skill names invoked via the Skill tool, not shell commands.

## ESLint: one config for local, CI and Codacy

`eslint.config.cjs` is the only ESLint config. `npm run lint` (`eslint .`), lint-staged, the
Tests check and Codacy ESLint9 all read it. Codacy's "Use configuration file" toggle for
ESLint9 is on, so the dashboard pattern list does not apply.

- **Rule changes:** edit `eslint.config.cjs`, never the Codacy dashboard patterns.
- **Ignores:** the config's ignore list mirrors `exclude_paths` in `.codacy.yml`. Change both together.
- **Errors fail the Tests check.** `eslint-plugin-security` rules are warnings: they show in
  local output and on the Codacy dashboard but do not block a merge. The `js/` colour guard
  (`staktrakr/no-colour-literal`, a local rule in `devops/eslint/`) is an error; its cases
  live in `tests/unit/js-theme-tokens.test.js`.
- **One-off exceptions:** use `// eslint-disable-next-line <rule> -- <reason>`, which local
  ESLint and Codacy both honor. A dashboard "ignore" on a single issue stays in Codacy only.
- **Script-tag globals:** `no-undef` is off for `js/`, `sw*.js`, `data/` and the tests,
  and `no-unused-vars` checks locals only there. Every other file is an ES module with
  `no-undef` on.
- ESLint 10 waits on Codacy support: Codacy's ESLint9 runs 9.39.5, the same version as the repo.

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
- Add the `coderabbit-review` label when you want a full CodeRabbit review. It is the one reviewer that skips unlabelled PRs. Codacy AI and Copilot run automatically, so budget for their threads on every PR including docs-only chores. Codex reviews once when the PR is opened or marked ready; after a substantial fix, comment `@codex review` if you want a second pass. (See "Review routing" above.)

## Known Reviewer False Positives

- **`ALLOWED_STORAGE_KEYS` "undefined guard"**: constant exists at `constants.js`; the `typeof` guard is intentional.
- **Automated re-review duplicates**: after pushing fixes, CodeRabbit/Gemini/Copilot regenerate threads on the same file/line. Gemini duplicates have `"line": null` in the API (reliable stale signal). Auto-resolve without user approval.
- **CodeRabbit "simplify code" PRs**: auto-generated refactor PRs. Triage individually.
- **CodeRabbit StakTrakr issue prefix**: see global CLAUDE.md "Conventions" rule on post-migration prefix flags; pre-classify as false positive.
- **Copilot `no-undef` on browser globals**: project uses script-tag globals across vanilla JS files with no bundler. The phrasing "vanilla JS global scope, no module bundler" is sufficient context in PR replies; do not include a file count (it changes).
- **`gb-*` CSS classes**: goldback-scoped. Do not copy to other panels; rename to neutral prefixes (`source-group`, `source-btn`, `input-shell`).
- **CodeRabbit is label-triggered, not automatic**: a PR without the `coderabbit-review` label gets **no full CodeRabbit review**, and that is expected, not a misconfiguration. It may still emit flags, an empty `APPROVED` review and a passing check. Neither the reviewers list nor the check is a reliable signal. Check the review body. Add the label when you want the full pass. (See "Review routing" above.)
- **Codacy AI / Copilot threads on any PR are expected**: both are automatic, unlike CodeRabbit. Budget for their threads on every PR, including docs-only chores.
- **Codex reviews once per PR**: on open or ready-for-review, with no re-review on later pushes (the setting has been "on PR" since 2026-10-19). A quiet Codex after a fix push is expected; comment `@codex review` only when the fix warrants a second look. Its comments block `dev` merges like any other thread, so resolve them, but don't wait on a review it was never asked for.
- **Retail out-of-stock detection is content-driven**: `detectStockStatus` in `firecrawl-extract.js` regex-matches rendered markdown.
  - Rendered markdown **includes ShopperApproved review blocks**.
  - Customer-review text containing "out of stock", "unavailable", or "page not found" produces systematic false out-of-stock results for entire vendors.
  - Investigation: scrape page, check if trigger text lies after the pricing table. If so, extend `MARKDOWN_CUTOFF_PATTERNS`. Use a plural-tolerant regex, such as `Reviews?`.
