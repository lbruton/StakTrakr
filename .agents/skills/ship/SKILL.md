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

## Step 1.5: Ancestry pre-flight (MANDATORY — prevents ship conflicts)

**This is the gate that stops the recurring "ship from hell."** A `dev → main`
merge is clean when the histories share a **recent merge-base** (the last
ship's commit). A prior **squash** merge of `dev → main` severs that: the squash
lands an orphan commit on `main` that shares no history with `dev`, freezing
`merge-base` at an ancient commit. Every later ship then has to three-way-merge
months of divergence → the `sw.js` (and eventually whole-tree) conflicts.

> **Do NOT test `git merge-base --is-ancestor origin/main origin/dev`.** That
> asks "can dev fast-forward onto main," which is the wrong question — after a
> healthy merge-commit ship, main carries the merge commit dev lacks, so it is
> _never_ a strict ancestor of dev even though the merge is perfectly clean.
> The ground-truth signal is the **merge-tree conflict probe** below.

Check the merge **before** building the PR:

```bash
git fetch origin
MB=$(git merge-base origin/main origin/dev)
# Run the probe ONCE. `--write-tree` exits 0=clean, 1=conflicts, >1=error.
# Redirect stdout only (NOT 2>&1) so a real git failure — e.g. a Git older than
# 2.38 without `merge-tree --write-tree` — surfaces on stderr instead of being
# misreported as a merge conflict.
CONFLICTS=$(git merge-tree --write-tree --name-only origin/main origin/dev); RC=$?
if [ "$RC" -eq 0 ]; then
  echo "✅ CLEAN — dev→main merges with no conflicts (merge-base=$MB)."
elif [ "$RC" -eq 1 ]; then
  echo "⚠️ CONFLICTS — dev→main does not merge cleanly. Conflicting files:"
  printf '%s\n' "$CONFLICTS" | sed '1d'
  echo "merge-base=$MB — see the heal-vs-resolve guidance below."
else
  echo "❌ merge-tree errored (RC=$RC). Check git is 2.38+ before proceeding."
fi
```

**Heal vs. resolve — pick by signature.** Use the `-s ours` heal **only** for the
**squash-severance signature**: an _ancient_ merge-base plus many add/add
conflicts (notably `sw.js` + archived spec files). For **ordinary** content
conflicts (a recent merge-base, a few genuinely overlapping files), resolve them
normally — **do NOT** run `-s ours`, which takes `main`'s tree wholesale and
would silently discard dev's changes to the conflicting files.

When the signature matches, heal with a zero-content `-s ours` merge (records the
shared ancestry without changing `main`'s tree), landed via a chore PR to `main`
merged with `--merge`, then re-run this check:

```bash
git worktree add .worktrees/heal-ancestry -b chore/heal-dev-main-ancestry origin/main
cd .worktrees/heal-ancestry
git merge -s ours origin/dev --no-edit \
  -m "chore: restore dev↔main shared ancestry (-s ours, zero content change)"
git diff origin/main --stat   # MUST be empty
git push -u origin chore/heal-dev-main-ancestry
gh pr create --base main --head chore/heal-dev-main-ancestry \
  --title "chore: restore dev↔main shared ancestry" \
  --body "Zero-content -s ours merge. Re-links the histories a prior squash severed so dev→main ships cleanly. **Merge with --merge, never squash.**"
# After checks pass:
gh pr merge <PR#> --merge   # NEVER --squash (squash re-severs the ancestry)
```

> **Why this happens / current guard:** A squash `dev→main` lands an orphan
> commit that severs ancestry. As of 2026-06-03, squash merge is **disabled
> repo-wide** and the dev ruleset pins `allowed_merge_methods: ["merge"]`, so a
> squash-ship is now blocked at the source (the model is merge-commits
> everywhere). This pre-flight + the Step 6.6 post-merge gate remain as
> defense-in-depth and to detect a pre-existing severance from older squash-ships.

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

> **Note:** StakTrakr creates version tags **post-merge** (the `/release` flow
> tags `main` after the ship lands), so this list is often empty mid-ship. When
> it is, build the PR summary from the version-bump commit titles in
> `git log --oneline main..origin/dev` and the CHANGELOG instead.

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

> **Already satisfied?** If this ship bumped the version via `/release` in the
> same session, the bundle was refreshed in that release PR and already lives on
> `dev` — re-running here is a no-op. Verify with the bundle header date.

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
>
> **Already satisfied?** If `/release` ran this session, the What's New was
> rewritten in that release PR — confirm it covers the full release and skip.

## Step 4: Create the `dev → main` PR

Build a comprehensive title from the version tags:

```text
vLATEST — [primary change] + [secondary] + [tertiary if notable]
```

**Merge strategy: merge commit (NOT squash).** Squash-merging to main severs
the common ancestor between dev and main, causing massive conflicts on the next
ship. The Protect Main ruleset allows merge commits for this reason.

Use `mcp__github__create_pull_request` (owner: `lbruton`, repo: `StakTrakr`) with:

- `base`: `main`
- `head`: `dev`
- `title`: `vLATEST_VERSION — [comprehensive title]`
- `body`: full PR description with Summary, Version Tags Shipped, Issues, QA Notes sections
- `draft`: `false`

Include `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.

Note the returned PR number for Step 5.

> **Why merge commit?** Feature→dev PRs use squash (clean dev history). But
> dev→main must use a merge commit to preserve ancestry. Without it, the next
> ship can't find a merge base and every touched file shows as a conflict.
> This was the root cause of the v3.34/v3.35 ship conflicts.

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

## Step 6.5: Merge the PR (merge commit, NOT squash) — CRITICAL

Once all checks pass and threads are resolved:

```bash
gh pr merge PR_NUMBER --merge --subject "vLATEST — [title]"
```

**Use `--merge`, never `--squash` or `--rebase`.** This preserves the common
ancestor between dev and main so future ships merge cleanly. A squash here is
the single mistake that has broken every ship for months — it re-severs the
ancestry the whole flow depends on.

**If `gh pr merge` is blocked by a required check** (e.g. Codacy complexity gate
tripping on cumulative release complexity — a known false-positive for batched
ships), do the merge **yourself via the skill**, do not hand it to a manual UI
click where the Squash button is one mis-tap away:

```bash
# With explicit user consent to bypass the gate (admin merge), STILL --merge:
gh pr merge PR_NUMBER --admin --merge --subject "vLATEST — [title]"
```

> **NEVER tell the user to "just merge it in the UI" without specifying the
> method.** If a human must click, the instruction is exactly: open the
> "Merge pull request" dropdown → choose **"Create a merge commit"** →
> **never "Squash and merge."** Then run Step 6.6 to confirm it stuck.

## Step 6.6: Post-merge ancestry verification (MANDATORY — catches a squash slip)

Immediately after the merge, verify the ancestry actually held. If a squash
slipped through (manual UI, wrong flag), catch it **now** — this session —
instead of discovering it at the next ship.

```bash
git fetch origin
if [ "$(git merge-base origin/main origin/dev)" = "$(git rev-parse origin/dev)" ]; then
  echo "✅ ANCESTRY INTACT — dev is fully an ancestor of main. Next ship will be clean."
else
  echo "🚨 SQUASH SLIPPED — ancestry severed by this merge. Heal immediately:"
  echo "   the merge was NOT a merge commit. Run the Step 1.5 -s ours heal now."
fi
# Sanity: main's tip should be a merge commit (2 parents) for a real ship.
git show --no-patch --format='%h parents: %p' origin/main
```

If it reports SQUASH SLIPPED, run the Step 1.5 `-s ours` heal before doing
anything else. Do not proceed to the release with a severed ancestry.

## Step 7: After the PR merges to main — GitHub Release (MANDATORY)

**Do not skip this.** The GitHub Release is what users and `version.json`'s
`releaseUrl` resolve to. Without it, the Releases page shows a stale version.

```bash
git fetch origin main

# Latest version string from the CHANGELOG (tags are created post-release)
LATEST="v$(grep -m1 -oE '## \[3\.[0-9]+\.[0-9]+\]' "$(git rev-parse --show-toplevel)/CHANGELOG.md" | grep -oE '3\.[0-9]+\.[0-9]+')"

# Extract ONLY this version's CHANGELOG section (bounded — avoids the 125k body limit).
# awk (not sed range + $d) so the last line isn't truncated when this version is
# the final section in the file (no subsequent "## [" header to bound the range).
NOTES=$(awk -v ver="${LATEST#v}" '
  $0 ~ "^## \\[" ver "\\]" {grab=1; next}
  grab && /^## \[/ {exit}
  grab {print}
' "$(git rev-parse --show-toplevel)/CHANGELOG.md")

gh release create "$LATEST" \
  --target main \
  --title "$LATEST — [title from CHANGELOG]" \
  --latest \
  --notes "$NOTES"

# Verify
gh release list --limit 3
# Confirm new version shows as Latest
```

> **Body-too-long guard:** GitHub rejects release notes over 125,000 chars. The
> `sed '/^## [ver]/,/^## [/p'` range extracts a single version section; an
> unbounded `awk '/ver/,/---/'` can swallow the whole changelog and 422.

## Step 8: Confirm

```text
Ship complete!

Version:   vLATEST
PR:        #XX merged (merge commit — ancestry verified ✅)
Release:   https://github.com/lbruton/StakTrakr/releases/tag/vLATEST
Issues:    STRK-XX → Done (Plane)
```
