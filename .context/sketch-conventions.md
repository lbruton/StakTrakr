# Sketch — StakTrakr Project Conventions

Per-project overrides for the `/sketch-*` family. Pairs with the universal mechanics in `DocVault/sketch/conventions.md`. Read this during `/sketch new`, the `/sketch-tasks` phase (Cohort 0 + closing tasks), and the `/sketch run | workflow | dispatch` execution verbs.

> Most detail already lives in **`.context/git-topology.md`** — this file points there rather than duplicating it, so the two never drift.

## Worktree & branch

- **StakTrakr requires `patch/<version>` branches via `/start-patch`** — NOT the generic `sketch/{ISSUE-ID}-{slug}` convention. If a generated `tasks.md` uses the sketch-style name, override it.
- **Exception — no-bump campaigns:** a multi-PR refactor/cleanup campaign that ships its intermediate PRs **unbumped** (one closing `/release patch` bumps once for the whole campaign) does **not** use `patch/<version>` per cohort — `/start-patch` claims a version lock per branch, which is incoherent when 19 cohorts share one bump. Such cohort PRs use descriptive **`chore/<issue>-<file>`** (or `refactor/<issue>-<file>`) branches off `origin/dev`. `patch/<version>` via `/start-patch` applies **only** to the single closing `/release` PR. Precedent: STRK-169 (split PRs on `feature/strk-169-*` / `refactor/strk-176-*`); see STRK-170.
- Worktree path: `.worktrees/<issue>-<slug>/` (`/start-patch`) or `.worktrees/patch-<version>/` (`/release`).
- Cohort 0 setup invokes **`/start-patch`**, not `using-git-worktrees` — except in a no-bump campaign, where Cohort 0 only enables tooling and each cohort creates its own `chore/<issue>-<file>` worktree.
- Full rules: `.context/git-topology.md` §Worktrees, §Merge Strategy, §Sketch & Spec Branch Overrides.

## Version & release

- **`/release patch` is the only valid version-bump path** — never hand-edit release artifacts.
- **Run `/update-spot-bundle` before every version-bump PR** (dev or main). The script writes to the main checkout; copy the bundle into the worktree afterward (see `git-topology.md` §Spot Bundle).
- Version-lock high-water mark: derive the next version from `max(all version.lock entries incl. expired, APP_VERSION on origin/dev)`.

## Standard Closing Tasks roster

StakTrakr uses the full Standard Closing Tasks block from `DocVault/sketch/templates/tasks-template.md`, with these project bindings — reproduce skill names **verbatim**:

| Task                       | Skill (verbatim)                                                                 |
| -------------------------- | -------------------------------------------------------------------------------- |
| Full test suite            | `npm test` (core Playwright PR gate)                                             |
| Security/quality scan      | `codacy-analysis analyze --diff` (Gen-3 Codacy CLI)                              |
| Version bump               | `/release patch` — preceded by `/update-spot-bundle` if the PR bumps the version |
| Vault update + close issue | `/vault-update` + mark issue Done in Plane                                       |
| Resolve PR threads         | `/pr-resolve`                                                                    |
| Archive sketch             | `/sketch archive {ISSUE-ID}`                                                     |

None of these are optional drops. If one genuinely doesn't apply, mark it `N/A — <one-line reason>` (audible skips beat silent skips).

## `dispatch` (external-terminal handoff) note

- StakTrakr closing tasks have no model-routing ambiguity and no parallel hazard → dispatch them as a **single batched prompt**.
- All dispatched prompts MUST name the absolute worktree path; subagents/sessions inherit `cwd` and will write to the main checkout otherwise (the load-bearing split-diff safety rule).

## Project doc pointers

- `.context/testing.md` — Playwright tier policy; `AGENTS.md` — repo-wide agent rules.
- `.context/coding-standards.md` — JS style, module boundaries, DOM/storage patterns.
- `.context/implementation-gotchas.md`, `.context/review-and-ci.md`, `.context/GLOSSARY.md` — read before touching the areas they name.
