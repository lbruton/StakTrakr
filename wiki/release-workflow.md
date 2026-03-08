---
title: Release Workflow
category: frontend
owner: staktrakr
lastUpdated: v3.33.59
date: 2026-03-07
sourceFiles:
  - .claude/skills/release/SKILL.md
  - .claude/skills/ship/SKILL.md
  - devops/version.lock
  - js/constants.js
relatedPages:
  - service-worker.md
  - architecture-overview.md
---
# Release Workflow

> **Last updated:** v3.33.44 — 2026-03-03
> **Source files:** `.claude/skills/release/SKILL.md`, `.claude/skills/ship/SKILL.md`, `devops/version.lock`, `js/constants.js`

## Overview

StakTrakr uses a structured patch versioning workflow. Every meaningful change — bug fix, UX tweak, or feature addition — gets its own version bump, its own isolated worktree, and its own PR to `dev`. This keeps the commit graph clean and gives every release a trail of breadcrumb tags that can be reconstructed into a precise changelog at ship time.

The two commands that drive this workflow are:

- **`/release patch`** — claims the next version number, creates a worktree, bumps 7 files, commits, and opens a draft PR to `dev`. This is the everyday dev command.
- **`/ship`** — triggered explicitly when the user says "ready to ship". Collects version tags on `dev` as the changelog source, creates the `dev → main` PR, marks it ready, resolves review threads, and creates the GitHub Release post-merge. Never runs automatically.

---

## Key Rules

- **One meaningful change = one patch tag = one worktree.** Never batch unrelated changes under a single version bump. Each patch tag is a breadcrumb for changelog reconstruction.
- **Always sync before starting.** `git fetch origin && git pull origin dev` is a hard gate before every `/release patch` run. A worktree created from a stale HEAD produces PRs that conflict with or silently drop remote commits.
- **Never push directly to `dev` or `main`.** Both branches are protected with Codacy quality gates. All changes must go through PRs.
- **Claim the version lock before any code.** The version number is the first thing decided during a patch, not the last. No code without a worktree, no worktree without a lock claim.
- **Every patch needs a Linear issue.** The issue ID goes in the commit message (`STAK-XX`), PR body, and version lock claim. No cowboy coding.
- **`/ship` is always explicit.** The `dev → main` PR is only created when the user says "ready to ship", "release", or "merge to main" in the current session. It never fires automatically.
- **GitHub Release is mandatory post-merge.** After every `dev → main` merge, create the GitHub Release (`gh release create`). Without it, `version.json`'s `releaseUrl` points to a stale release and the "Latest" badge is wrong.

---

## Version Format

Defined in `js/constants.js` as `APP_VERSION`:

```
BRANCH.RELEASE.PATCH
  3  .  33  .  44
```

| Component | Meaning | When it changes |
|-----------|---------|-----------------|
| `BRANCH` | Major branch number | Rarely — only for major platform shifts |
| `RELEASE` | Release batch number | When shipping a batch to `main` via `/release release` |
| `PATCH` | Patch counter | After every meaningful committed change via `/release patch` |

The current version is always the authoritative value in `js/constants.js`:

```javascript
const APP_VERSION = "3.33.44";
```

---

## Version Lock (`devops/version.lock`)

The lock file prevents two concurrent agents from claiming the same version number. It uses a **claims array** model — multiple agents can hold concurrent claims on different version numbers at the same time.

**Lock file format** (gitignored — edit directly, never commit):

```json
{
  "claims": [
    {
      "version": "3.33.26",
      "claimed_by": "claude / STAK-400 feature name",
      "issue": "STAK-400",
      "claimed_at": "2026-03-02T10:00:00Z",
      "expires_at": "2026-03-02T10:30:00Z"
    }
  ]
}
```

**Claim lifecycle:**

1. Read `devops/version.lock` and prune expired entries (`expires_at` < now)
2. Find the highest `version` among active claims (or fall back to `APP_VERSION` from `js/constants.js` if no active claims)
3. Increment the PATCH component by 1 — this is your claimed version
4. Append your entry to the `claims` array and write the file
5. Create the worktree immediately — the version is now reserved for you
6. After PR merges and cleanup is done, remove your claim entry from the array. If the array is empty, delete the file.

**TTL:** 30 minutes per claim. Expired claims are pruned on each read — version gaps from expired unclaimed patches are acceptable.

---

## Worktrees (`.claude/worktrees/`)

Each patch gets an isolated filesystem via `git worktree`. All file edits, version bumps, and commits happen inside the worktree — never in the main repo working directory on `dev`.

```bash
# Created automatically by /release patch after the lock is written
git worktree add .claude/worktrees/patch-3.33.26 -b patch/3.33.26
```

Worktrees live at `.claude/worktrees/patch-VERSION/` and are gitignored. After the PR merges to `dev`, the worktree is removed and the branch is deleted.

---

## Files Touched by a Version Bump

Every `/release patch` run updates version information across these 7 files:

| # | File | What changes | How |
|---|------|--------------|-----|
| 1 | `js/constants.js` | `APP_VERSION` string | Manual (release skill) |
| 2 | `sw.js` | `CACHE_NAME` with new version + build timestamp | Automatic — `devops/hooks/stamp-sw-cache.sh` pre-commit hook |
| 3 | `CHANGELOG.md` | New version section with title and bullets | Manual (release skill) |
| 4 | `docs/announcements.md` | Prepend one-line entry to What's New; trim to 3–5 entries | Manual (release skill) |
| 5 | `js/about.js` | `getEmbeddedWhatsNew()` and `getEmbeddedRoadmap()` — `file://` fallback | Manual (release skill) — must mirror `announcements.md` exactly |
| 6 | `version.json` | `version` + `releaseDate` fields | Manual (release skill) |
| 7 | `data/spot-history-*.json` | New seed entries from the poller (staged conditionally) | Staged if the poller has written new entries since last release |

**Critical sync requirement:** `docs/announcements.md` (file 4) and `js/about.js` (file 5) must always contain the same What's New entries in the same order. HTTP users read announcements via `fetch()`; `file://` users fall back to the embedded `getEmbeddedWhatsNew()` in `about.js`. If they drift, users on different protocols see different content.

`sw.js` CACHE_NAME (file 2) is handled automatically by the pre-commit hook — do not edit it manually during releases. However, do verify that `sw.js` CORE_ASSETS includes any new `.js` files added since the last release.

---

## Patch Workflow — `/release patch`

### Phase 0: Remote Sync Gate (hard gate — no exceptions)

```bash
git fetch origin
git rev-list HEAD..origin/dev --count
```

If the count is greater than 0: **STOP.** Local `dev` is behind `origin/dev`. Pull first, then restart.

```bash
git pull origin dev
```

A worktree created from a stale HEAD branches from the wrong base, causing the PR to silently drop remote commits or generate a misleading diff.

### Phase 0a: Version Lock Claim

```bash
cat devops/version.lock 2>/dev/null || echo "UNLOCKED"
```

1. Parse the `claims` array. Remove expired entries (`expires_at` < now). Write back if anything was pruned.
2. Find the highest `version` among remaining active claims. If none, read `APP_VERSION` from `js/constants.js`.
3. Increment PATCH by 1 — this is your version.
4. Append your claim entry (with a 30-minute TTL) and write the file.
5. Create the worktree immediately:

```bash
git worktree add .claude/worktrees/patch-VERSION -b patch/VERSION
```

**All subsequent file edits, version bumps, and commits happen inside the worktree.**

### Phase 1: Gather Context

1. `git log --oneline main..dev` — list commits on `dev` not yet on `main`
2. Check Linear for In Progress or recently Done issues linked to those commits
3. Read `js/constants.js` (current version), `CHANGELOG.md` (format), `docs/announcements.md` (format)
4. Present a release plan for user confirmation before writing any files

### Phase 2: Version Bump (5 manual files + 1 auto)

Inside the worktree, update the 6 version files (7 if seed data is staged):

- `js/constants.js` — update `APP_VERSION`
- `CHANGELOG.md` — insert new version section
- `docs/announcements.md` — prepend one-line entry; trim to 3–5 entries; trim roadmap to 3–4 items
- `js/about.js` — replace `getEmbeddedWhatsNew()` and `getEmbeddedRoadmap()` to mirror `announcements.md`
- `version.json` — update `version` and `releaseDate`
- `sw.js` — automatically updated by the pre-commit hook on commit (do not edit manually)

### Phase 3: Verify

1. Grep for the new version string in all 5 manual files
2. Confirm `announcements.md` has 3–5 What's New entries and 3–4 roadmap items
3. Confirm `js/about.js` mirrors `announcements.md` exactly — flag any drift
4. Confirm `version.json` has today's date
5. Run `.gitattributes` release ZIP audit to confirm no dev files sneak into the release archive

### Phase 4: Commit

```bash
git add js/constants.js sw.js CHANGELOG.md docs/announcements.md js/about.js version.json data/spot-history-*.json
git commit -m "vNEW_VERSION — TITLE"
```

Commit message format: `vNEW_VERSION — TITLE` (em dash `—`, not hyphen `-`). Include `STAK-XX` references:

```
v3.33.26 — STAK-400: Inventory filter persistence
```

After a successful commit, the `wiki-update` skill is dispatched as a background task to update any affected wiki pages. Do not wait for it — proceed to Phase 5 immediately.

### Phase 5: Push + Draft PR to `dev`

```bash
git push origin patch/VERSION
gh pr create --base dev --head patch/VERSION --draft --label "codacy-review" \
  --title "vNEW_VERSION — brief description" \
  --body "..."
```

The PR always targets `dev`, never `main`. Cloudflare Pages generates a preview URL for every PR branch — QA the preview before merging.

### Post-Merge Cleanup

After the PR is reviewed and merged to `dev`:

```bash
# Tag the merge commit on dev — this is the breadcrumb for changelog reconstruction
git fetch origin dev
git tag vNEW_VERSION origin/dev
git push origin vNEW_VERSION

# Remove the worktree and branches
git worktree remove .claude/worktrees/patch-VERSION --force
git branch -d patch/VERSION
git push origin --delete patch/VERSION

# Release the version lock — remove only your claim entry (by version match)
# Leave other active claims intact. If no claims remain, delete the file.
```

The tag lands on `dev`, not `main`. It is a git tag (visible in the Tags tab), not a GitHub Release. The GitHub Release is created after the `dev → main` merge in Phase 5 of `/ship`.

---

## Ship Workflow — `/ship`

Run only when the user explicitly says "ready to ship", "release", or "merge to main". This creates a PR targeting `main` — an irreversible public action.

### Step 1: Sync + Audit

```bash
git fetch origin
git log --oneline main..origin/dev
```

If the output is empty, there is nothing to ship. Stop.

### Step 2: Collect Version Tags as Changelog Source

Version tags on `dev` (breadcrumbs from each merged patch) are more reliable than raw commit messages for building the PR summary:

```bash
# Tags reachable from dev but not yet merged to main
git tag --sort=-version:refname | while read tag; do
  if git merge-base --is-ancestor "$tag" origin/main 2>/dev/null; then
    :  # already on main, skip
  elif git merge-base --is-ancestor "$tag" origin/dev 2>/dev/null; then
    echo "$tag"
  fi
done
```

For each tag, get its commit message title:

```bash
git log --format="%s" "$tag"^.."$tag" | head -1
```

### Step 3: Fetch Linear Issue Titles

For each `STAK-###` reference found in tag names and commit messages, call `mcp__claude_ai_Linear__get_issue` to get the current title and URL. This ensures the PR description is accurate, not just copy-pasted from commit messages.

### Step 4: Create the `dev → main` PR

```bash
gh pr create --base main --head dev --label "codacy-review" \
  --title "vLATEST_VERSION — [primary change] + [secondary] + [tertiary if notable]" \
  --body "..."
```

The PR body includes: Summary (one bullet per version tag), Version Tags Shipped (full list), Linear Issues (with URLs), QA Notes.

### Step 5: Mark Ready + Resolve Threads

```bash
gh pr ready [PR_NUMBER]
```

Then run `/pr-resolve` to clear all open Codacy and Copilot review threads before the PR goes to final review.

### Step 6: Update Linear Issues

Mark all referenced `STAK-###` issues as **Done** — they ship with this merge.

### Step 7: GitHub Release (mandatory post-merge)

After the PR merges to `main`:

```bash
git fetch origin main
gh release create vLATEST_VERSION \
  --target main \
  --title "vLATEST_VERSION — TITLE" \
  --latest \
  --notes "..."
```

Verify: `gh release list --limit 3` — confirm the new version shows as `Latest`.

Without this step, the GitHub Releases page is stale and `version.json`'s `releaseUrl` (which points to `/releases/latest`) resolves to the wrong version.

---

## When to Run `/release patch` vs `/ship`

| Situation | Command |
|-----------|---------|
| Finished a bug fix, UX tweak, or feature addition | `/release patch` |
| Starting a new isolated piece of work | `/release patch` (claims a new version lock, creates a new worktree) |
| Bumping the RELEASE number for a major batch | `/release release` |
| Previewing what a bump would do without writing files | `/release dry-run` |
| `dev` is QA-complete and ready to go to `main` | `/ship` (only when user explicitly says so) |
| After `dev → main` merges | Create GitHub Release immediately (part of `/ship` Step 7) |

---

## Common Mistakes

| Mistake | Consequence | Correct behavior |
|---------|-------------|-----------------|
| Skipping the remote sync gate | Worktree created from stale HEAD; PR silently drops remote commits | Always `git pull origin dev` before `/release patch` |
| Batching multiple features under one patch | Version history ambiguous; changelog harder to reconstruct | One meaningful change = one patch tag |
| Pushing directly to `dev` or `main` | Blocked by branch protection and Codacy gate | Always use a PR from a `patch/` branch |
| Creating a `dev → main` PR automatically | Ships unreviewed code | Phase 4.5 (`/ship`) only runs on explicit user request |
| Skipping Phase 5 (GitHub Release) | `version.json` `releaseUrl` resolves to stale release; "Latest" badge is wrong | Always `gh release create` after `dev → main` merge |
| Editing `announcements.md` without updating `about.js` | HTTP users and `file://` users see different What's New content | Keep both files in sync at all times |
| Manually editing `sw.js` CACHE_NAME | May conflict with or be overwritten by the pre-commit hook | Let `devops/hooks/stamp-sw-cache.sh` handle it automatically |
| Forgetting to remove your claim from `version.lock` | Next agent sees a stale claim and computes an unnecessary version gap | Remove your claim entry after cleanup; delete file only when empty |
| Starting work without a Linear issue | No traceability; violates the worktree gate | Create a Linear issue first — its ID goes in the claim, commit, and PR |

---

## Related Pages

- [Service Worker](service-worker.md) — `sw.js` CACHE_NAME auto-stamp, CORE_ASSETS maintenance
- [Architecture Overview](architecture-overview.md) — file load order, `index.html` script block, `js/constants.js` role
