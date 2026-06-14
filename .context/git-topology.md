# Git Topology — StakTrakr

Detailed branch, worktree, merge, and release workflow rules.
Loaded on demand by `/release`, `/start-patch`, `/finishing-a-development-branch`, `/pr-cleanup`.

## Version & Release

- Version format: `major.minor.patch` in `js/constants.js` (code comment: `branch.release.patch`).
- `/release` bumps 6 files: `js/constants.js`, `package.json`, `package-lock.json`, `version.json`, `js/about.js`, and `CHANGELOG.md`.
- `sw.js` is auto-stamped by the `stamp-sw-cache` pre-commit hook. Don't add manually.
- **`/release` is the only valid version-bump path.**
- When `/spec` shipping tasks 10-12 say "version bump", invoke `/release patch`; do not hand-edit release artifacts.
- A spec PR that bumps `package.json` but forgets `manifest.json` data, README badges, or the `sw.js` cache can still pass `check-release-sync` and ship incomplete. (The hook _does_ catch a mismatched `version.json` and a missing `about.js` What's New current-version entry, and enforces the 5-entry What's New cap — STRK-194.)
- If spec workflow appears to do its own bump, treat it as a workflow bug and invoke `/release`.
- Release recipe: `.claude/skills/release/SKILL.md`.
- Version lock: `devops/version.lock` is gitignored (local coordination only).
- **Version lock high-water mark** → derive the next version from `max(all entries in version.lock including expired, APP_VERSION on origin/dev)`.
- Prune expired entries from the lock file but treat their version numbers as consumed.

## Worktrees

- Worktree naming: `.worktrees/<issue>-<slug>/` (via `/start-patch`) or `.worktrees/patch-<version>/` (via `/release`).
- Pick what the entry skill creates and keep it for the branch lifetime.
- Create with `git fetch origin dev && git worktree add .worktrees/<name>/ -b <branch> origin/dev`.
- After creation, run `cp CLAUDE.md .worktrees/<name>/`.
- Then run `npm install --no-audit --no-fund`.
- Pushing fixes to an open PR → commit from existing PR worktree, not a new branch.
- **`EnterWorktree` caveat (harness tool):** its default base-ref `fresh` branches from `origin/main` (the GitHub default branch), **not** `origin/dev`. A `dev`-targeted PR from such a branch inherits an ancient merge-base, so GitHub's three-dot diff balloons into thousands of lines of false "scope creep" (Copilot/Codacy flag it as unrelated tickets).
  - Preferred: create on the correct base, then enter by path — `git fetch origin dev && git worktree add .claude/worktrees/<branch> -b <branch> origin/dev`, then call `EnterWorktree` with `path: ".claude/worktrees/<branch>"`.
  - Fallback: right after `EnterWorktree` with `name:` and **before any edits**, run `git fetch origin && git reset --hard origin/dev`.
  - Always verify before opening the PR: `git merge-base origin/dev HEAD` must equal `git rev-parse origin/dev`.

## Merge Strategy

- **feature→dev:** squash merge (one commit per feature, clean dev history).
- **dev→main (ship):** merge commit via `gh pr merge --merge`. Preserves common ancestry so the next ship finds a clean merge base.
- Decline requests to squash to `main`; squash severs ancestry and causes full-tree conflicts on the next ship.
- **Squash-slip recovery** — if a past `dev→main` squash froze the merge base (symptom: a `dev→main` PR conflicts on `sw.js` or balloons to a whole-tree diff): heal with a **zero-content** `git merge -s ours origin/dev` onto `main`, landed via a chore PR merged with `--merge`. It records the shared ancestry without changing `main`'s tree. Verify that `git merge-base origin/main origin/dev` equals `git rev-parse origin/dev`. `/ship` Steps 1.5 (pre-flight) and 6.6 (post-merge) automate this detect-and-heal.
- **Enforcement (2026-06-03)** — squash merge is **disabled repo-wide** and the `dev` ruleset pins `allowed_merge_methods: ["merge"]`, so a squash-ship is blocked at the source (the model is merge-commits everywhere). The `/ship` ancestry gates remain as defense-in-depth and to detect a pre-existing severance from older squash-ships.
- **Rebase merge:** prohibited for protected branches. GitHub cannot sign rebase-created commits, which violates the `required_signatures` ruleset on both `dev` and `main`.
- Alternative: local merge with SSH signing.

## Spot Bundle

- **Run `/update-spot-bundle` before every version-bump PR** whether it targets `dev` or `main`.
- The command queries sqld and rebuilds `data/spot-history-bundle.js`.
- Copilot's reminder is correct, not a false positive.
- **Worktree note:** the script writes to the **main checkout**, not the active worktree.
- After running it, copy the bundle into the worktree from the worktree root: `cp ../../data/spot-history-bundle.js data/ && cp ../../data/spot-history-bundle-*.js data/`.

## Sketch & Spec Branch Overrides

- **Sketch branch naming** → `/sketch dispatch` (external-terminal handoff; formerly `orchestrate`) generates sketch-style branch names by default, but StakTrakr requires `patch/<version>` via `/start-patch`.
- Override generated tasks.md if it uses the sketch convention.
- **`/sketch dispatch` closing tasks** → hand off as a single batched prompt.
- Closing tasks have no model-routing ambiguity and no parallel hazard.

## Stale Branch Detection

- **Stale dev-targeting branches** → `/pr-cleanup` only detects `[gone]` refs, which requires the upstream branch to have been deleted.
- Squash-merged branches targeting `dev` do not appear as `[gone]` because the local branch tracks `origin/dev`, not its merged ref.
- `git branch -vv | grep ': gone]'` will not find those branches.
- Cross-check by branch name instead.
- List merged PR heads with `gh pr list --state merged --base dev --json headRefName --jq '.[].headRefName' | grep '^patch/'`.
- Compare that set against local `.worktrees/patch-*/` names.
- Compare it against `git for-each-ref --format='%(refname:short)' refs/heads/patch/`.
- **PR branch staleness check** → before opening a PR, run `git merge-base` for the branch and compare it to `origin/dev`.
- A large changed-file count (50+) signals the branch may have been created from stale local `dev` rather than fetched `origin/dev`.
