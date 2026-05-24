---
name: ship
description: Ship dev→main — PR, resolve threads, GitHub Release. Only on explicit user "ready to ship".
allowed-tools: Bash, Read, Task, mcp__github__create_pull_request, mcp__github__list_pull_requests, mcp__github__get_pull_request_status, mcp__plane__get_issue_using_readable_identifier, mcp__plane__list_states, mcp__plane__update_issue
---

# Ship — StakTrakr (`dev → main`)

**Hard gate:** Only run when the user has explicitly said "ready to ship",
"release", or "merge to main" in the current session. This creates a PR
targeting `main` — an irreversible public action.

## Step 1: Sync gate

```bash
git fetch origin
git log --oneline main..origin/dev
```

If output is empty — nothing to ship. Stop.

Confirm with user before proceeding if anything looks unexpected.

## Step 2: Collect version tags on dev since last main merge

Version tags on `dev` are the breadcrumb trail of every patch. They are more
reliable than commit messages for building the PR summary.

```bash
# All tags reachable from dev but NOT from main
git tag --sort=-version:refname | while read tag; do
  if git merge-base --is-ancestor "$tag" origin/main 2>/dev/null; then
    : # already on main, skip
  elif git merge-base --is-ancestor "$tag" origin/dev 2>/dev/null; then
    echo "$tag"
  fi
done
```

For each tag found, get its commit message title:

```bash
git log --format="%s" "$tag"^.."$tag" | head -1
```

## Step 2.5: Spot bundle refresh (MANDATORY)

Before creating the ship PR, rebuild the spot-history bundle from sqld so the
deployed app ships with current data:

```bash
# Invokes /update-spot-bundle — queries sqld, regenerates data/spot-history-bundle.js
# Requires Tailscale + SQLD_URL=http://192.168.1.81:8080
```

Run `/update-spot-bundle` (skill). If new data is bundled, the change must land
on `dev` via worktree + PR before proceeding (see Step 3.5). Direct pushes to
`dev` are blocked by branch protection.

## Step 3: Fetch Plane issue titles

For each `STRK-###` reference found across tag names and commit messages, fetch
the issue from Plane to get the current title and status:

```text
mcp__plane__get_issue_using_readable_identifier  identifier: "STRK-###"
```

This ensures the PR description uses accurate titles, not just commit messages.

> **Pre-migration note:** legacy `STAK-###` references in old commit messages
> point to `DocVault/Archive/Issues-Pre-Plane/StakTrakr/STAK-###.md`. Resolve
> those by file read; new work uses `STRK-###` only.

## Step 3.5: About-page What's New audit (MANDATORY)

The release announcements live **only** in `js/about.js` `getEmbeddedWhatsNew()`
(per STAK-513 — `docs/announcements.md` was retired). `/release patch` updates
this per-patch, but over a long release cycle entries drift and accumulate
stale content. Before creating the ship PR, audit and rewrite the entries to
reflect the full release being shipped.

1. Read `js/about.js` `getEmbeddedWhatsNew()`.
2. Rewrite with **3–5 entries** covering the most significant changes in this
   release (grouped by theme, not per-patch). Use the version tags from Step 2
   as source material. Format:

   ```text
   - **vX.X.X — Title**: Summary sentence. Additional detail sentence (STRK-XX).
   ```

### Commit the update via worktree + PR

`dev` is protected. Do **NOT** push directly. Land the about.js audit through a
chore PR:

```bash
git fetch origin dev
git worktree add .worktrees/ship-prep-vLATEST/ -b chore/ship-prep-vLATEST origin/dev
cd .worktrees/ship-prep-vLATEST/
# Edit js/about.js
git add js/about.js
git commit -m "chore: refresh about.js What's New for vLATEST release"
git push -u origin chore/ship-prep-vLATEST
gh pr create --base dev --title "chore: refresh about.js for vLATEST ship" --body "..."
# Wait for merge to dev, then proceed to Step 4
```

> **Why here?** Individual patches update announcements incrementally, but the
> ship step is the last chance to ensure the "What's New" modal shows a coherent
> release summary — not a stale list from 30 patches ago.

## Step 4: Create the `dev → main` PR

Build a comprehensive title from the version tags:

```text
vLATEST — [primary change] + [secondary] + [tertiary if notable]
```

Use `mcp__github__create_pull_request` (owner: `lbruton`, repo: `StakTrakr`) with:

- `base`: `main`
- `head`: `dev`
- `title`: `vLATEST_VERSION — [comprehensive title]`
- `body`: full PR description with Summary, Version Tags Shipped, Issues, QA Notes sections
- `draft`: `false`

Include `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

Note the returned PR number for Step 5.

## Step 5: Mark ready + resolve review threads

Use `mcp__github__list_pull_requests` (base: `main`, head: `dev`, state: `open`) to confirm the PR number if not captured from Step 4.

Then mark draft → ready (no MCP equivalent — use `gh` CLI):

```bash
gh pr ready PR_NUMBER
```

Then run `/pr-resolve` to clear all open Codacy and Copilot review threads
before the PR goes to final review.

## Step 6: Mark Plane issues Done

Mark all referenced `STRK-###` issues as **Done** in Plane — they ship with this merge.

For each issue:

```text
# Resolve the Done state UUID once (UUIDs are session-volatile — do not cache)
mcp__plane__list_states  project_id: "026dbe54-fe52-4a9f-9f1b-7edcb9bbdceb"
# → find the state where group == "completed" and name == "Done"

# For each STRK-### shipping in this release:
mcp__plane__update_issue  identifier: "STRK-###"  state: "<Done UUID>"
```

> **Legacy:** if any `STAK-###` references appear in commit messages, those are
> pre-migration archives — no status update needed. Plane is the only live
> tracker.

## Step 7: After the PR merges to main — GitHub Release (MANDATORY)

**Do not skip this.** The GitHub Release is what users and `version.json`'s
`releaseUrl` resolve to. Without it, the Releases page shows a stale version.

```bash
git fetch origin main

# Get the latest version from main
LATEST=$(git tag --merged origin/main --sort=-version:refname | grep '^v3\.' | head -1)

# Get changelog section for this version
NOTES=$(awk "/## \[${LATEST#v}\]/,/^---$/" "$(git rev-parse --show-toplevel)/CHANGELOG.md" | head -20)

gh release create "$LATEST" \
  --target main \
  --title "$LATEST — [title from CHANGELOG]" \
  --latest \
  --notes "$NOTES"

# Verify
gh release list --limit 3
# Confirm new version shows as Latest
```

## Step 8: Confirm

```text
Ship complete!

Version:  vLATEST
PR:       #XX merged
Release:  https://github.com/lbruton/StakTrakr/releases/tag/vLATEST
Issues:   STRK-XX → Done (Plane)
```
