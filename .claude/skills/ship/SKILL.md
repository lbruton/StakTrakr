---
name: ship
description: Ship dev to main — collect version tags as changelog source, create the dev→main PR, mark it ready, resolve threads, create GitHub Release. ONLY run when user explicitly says "ready to ship", "release", or "merge to main" in this session. Never runs automatically.
allowed-tools: Bash, Read, Task
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

## Step 2.5: Seed Data Sync (MANDATORY)

Before creating the ship PR, ensure seed data is fresh:

```bash
bash .claude/skills/seed-sync/fetch-live.sh
```

This pulls the latest spot-history entries from `api.staktrakr.com` and merges
them into local `data/spot-history-*.json` files. If new entries are found,
stage and commit them to dev before proceeding.

## Step 3: Fetch DocVault issue titles

For each `STAK-###` reference found across tag names and commit messages,
read the issue file from DocVault to get the current title and status:

```bash
ISSUE_DIR="/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Issues"
# For each STAK-### found:
cat "$ISSUE_DIR/STAK-###.md"
# Extract: id, title, status from YAML frontmatter
```

This ensures the PR description uses accurate titles, not just commit messages.

## Step 3.5: Audit announcements & about.js (MANDATORY)

The `/release patch` skill updates `docs/announcements.md` and `js/about.js`
per-patch, but over a long release cycle (many patches) the entries drift and
accumulate stale content. Before creating the ship PR, audit and rewrite both
files to reflect the **full release** being shipped.

### announcements.md

1. Read `docs/announcements.md`
2. Rewrite `## What's New` with **3–5 entries** covering the most significant
   changes in this release (grouped by theme, not per-patch). Use the version
   tags from Step 2 as source material. Format:
   ```markdown
   - **vX.X.X &ndash; Title**: Summary sentence. Additional detail sentence (STAK-XX).

### Sync check

After updating both files, verify the entries match in count and content.
Flag any drift before proceeding.

### Commit the update

```bash
git add docs/announcements.md js/about.js
git commit -m "docs: update announcements and about.js for vLATEST release"
git push origin dev
```

> **Why here?** Individual patches update announcements incrementally, but the
> ship step is the last chance to ensure the "What's New" modal shows a coherent
> release summary — not a stale list from 30 patches ago.

## Step 4: Create the `dev → main` PR

Build a comprehensive title from the version tags:
```
vLATEST — [primary change] + [secondary] + [tertiary if notable]
```

```bash
gh pr create --base main --head dev --label "codacy-review" \
  --title "vLATEST_VERSION — [comprehensive title]" \
  --body "$(cat <<'EOF'
## Summary

[One bullet per version tag — user-readable description, not raw commit message]
[Group related patches under a shared heading if applicable]

## Version Tags Shipped

- vX.X.X — [title]
- vX.X.X — [title]
[list all tags from Step 2]

## Issues (DocVault)

- STAK-XX: [title] ([status])
[list all STAK references from Step 3]

## QA Notes

[Anything the reviewer should test or verify before approving]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Step 5: Mark ready + resolve review threads

```bash
PR_NUMBER=$(gh pr list --base main --head dev --state open --json number --jq '.[0].number')
gh pr ready "$PR_NUMBER"
```

Then run `/pr-resolve` to clear all open Codacy and Copilot review threads
before the PR goes to final review.

## Step 6: Update DocVault issues

Mark all referenced STAK-### issues as **done** — they ship with this merge.

For each issue file in DocVault:

```bash
ISSUE_DIR="/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/Issues"
# Update YAML frontmatter: status: done, completed: "YYYY-MM-DD"
```

Update each issue's frontmatter:
- `status: done`
- `completed: "YYYY-MM-DD"` (today's date)

Commit the DocVault changes separately (DocVault commits go direct to main).

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

```
Ship complete!

Version:  vLATEST
PR:       #XX merged
Release:  https://github.com/lbruton/StakTrakr/releases/tag/vLATEST
Issues:   STAK-XX → Done (DocVault)
```
