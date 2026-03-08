---
name: release
description: Release workflow — version bump, changelog, announcements, commit, and PR.
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
---

# Release — StakTrakr

End-to-end release workflow: bump version across 7 files (5 manual edits + sw.js auto-stamped by pre-commit hook + seed data), commit to the patch branch, and open a draft PR to dev. The `dev → main` PR is created separately at Phase 4.5 only when you explicitly say you're ready to ship.

## When to Run

**`patch` is the default dev workflow** — run it after every meaningful committed change (bug fix, UX tweak, feature addition). Each patch tag is a breadcrumb for the final changelog. Rule: **one meaningful change = one patch tag, one git tag**.

**`release`** is for bumping the RELEASE number when shipping a major batch to main via PR.

## Arguments

$ARGUMENTS can be:
- `release` — bump RELEASE number (3.23.01 → 3.24.00)
- `patch` — bump PATCH number (3.23.01 → 3.23.02) — use after every meaningful commit on dev
- `dry-run` — preview all changes without writing

If no argument provided, ask the user whether this is a `release` or `patch`.

## Phase 0: Gather Context

### Step 0: Remote Sync Gate (REQUIRED BEFORE LOCK CHECK)

Before claiming a version lock or creating a worktree, ensure local `dev` matches `origin/dev`.
A worktree created from a stale HEAD will produce PRs that conflict with or silently drop
remote commits.

```bash
git fetch origin
BEHIND=$(git rev-list HEAD..origin/dev --count)
```

**If `BEHIND` is 0:** Continue to Step 0a. ✅

**If `BEHIND` > 0:** HARD STOP. Do not proceed.

```
⛔ Local dev is N commits behind origin/dev.

Incoming commits:
[git log --oneline HEAD..origin/dev]

Run: git pull origin dev
Then re-run /release patch.
```

Pull first, then restart from Step 0.

```bash
git pull origin dev
```

> **Why here and not later?** The worktree branches from current HEAD. If HEAD is stale,
> every file diff in the PR will be relative to the wrong base. Pull first — worktree second.

### Step 0a: Version Lock Claim (REQUIRED FIRST)

The lock file uses a **claims array** — multiple agents can hold concurrent claims on
different version numbers. Follow these steps in order:

**1. Read and prune expired claims:**

```bash
cat devops/version.lock 2>/dev/null || echo "UNLOCKED"
```

Parse the `claims` array (or treat as `[]` if absent/empty). Remove any entries where
`expires_at` < now. Write the pruned file back if anything was removed.

**2. Compute your version:**

- Find the highest `version` value in the remaining active claims
- If no active claims exist, read `APP_VERSION` from `js/constants.js`
- Increment the PATCH component by 1 → this is **your version**

Example: active claims hold `3.32.29` → your version is `3.32.30`.  
No active claims, `APP_VERSION` is `3.32.28` → your version is `3.32.29`.

**3. Append your claim and write the file:**

```json
{
  "claims": [
    {
      "version": "3.32.29",
      "claimed_by": "claude / STAK-XXX brief description",
      "issue": "STAK-XXX",
      "claimed_at": "2026-XX-XXTXX:XX:XXZ",
      "expires_at": "<claimed_at + 30 minutes>"
    }
  ]
}
```

Write the full `claims` array (existing active claims + your new entry) to `devops/version.lock`.

Use the `version` from your claim as the target for all subsequent steps — do not re-derive it from `APP_VERSION` later.

**4. Create the worktree + branch immediately:**

```bash
git worktree add .worktrees/patch-VERSION -b patch/VERSION
```

Example: `git worktree add .worktrees/patch-3.32.29 -b patch/3.32.29`

**5. Write a session lock file** to prevent other sessions from using this worktree concurrently:

```bash
cat > .worktrees/patch-VERSION/.worktree.lock <<LOCK
{
  "session_id": "$(date +%s)-$$",
  "claimed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "branch": "patch/VERSION",
  "task": "STAK-XXX brief description"
}
LOCK
```

Before entering any existing worktree, check for a lock file. If `.worktree.lock` exists and `claimed_at` is less than 2 hours old, **STOP** — another session may be active. Ask the user before proceeding.

**All subsequent work (file edits, version bumps, commits) happens inside the worktree directory.**
If you are running as an interactive Claude Code session, inform the user:

```
Worktree created at: .worktrees/patch-VERSION/
Branch: patch/VERSION

All work for this release will happen in that worktree.
After merging to dev, run cleanup:
  rm -f .worktrees/patch-VERSION/.worktree.lock
  git worktree remove .worktrees/patch-VERSION --force
  git branch -d patch/VERSION
  Remove your claim entry from devops/version.lock (leave other active claims intact)
```

See `devops/version-lock-protocol.md` for full protocol details.

### Step 0 (prerequisite): Seed Data Sync

Before gathering release context, run the `/seed-sync` workflow to check for unstaged seed data from the Docker poller. The poller writes to `data/spot-history-*.json` continuously, but these changes are invisible in normal development — they only show up in `git status` if you look for them. Stage any new seed data now so it's included in the release commit.

### Step 1: Determine what's being released

1. `git log --oneline main..dev` — list all commits on dev that aren't on main yet
2. `git diff --stat main..dev` — summary of files changed
3. (Optional — requires Linear MCP) Check Linear for any **In Progress** or recently **Done** issues on the StakTrakr team (ID: `f876864d-ff80-4231-ae6c-a8e5cb69aca4`) that relate to commits on dev

### Step 2: Read current state

Read these files in parallel:
- `js/constants.js` — extract current `APP_VERSION`
- `CHANGELOG.md` — first 5 lines after `## [Unreleased]` to see format
- `docs/announcements.md` — first 3 lines to see format

### Step 3: Present the release plan

Ask the user to confirm or adjust:

```
Release Plan
============
Current version: 3.XX.YY
New version:     3.XX.YY (based on [release/patch] bump)

Commits since main:
- [commit list]

Proposed title: [inferred from commits/Linear issues]

Proposed changelog bullets:
- **Label**: Description (STAK-XX)
- ...

Proceed? [Adjust title / Adjust bullets / Go]
```

Wait for user confirmation before writing any files.

## Phase 1: Version Bump (5 manual files + sw.js auto + seed)

Update each file directly using the patterns below. There is no external script — this skill is the single source of truth for version bumps.

### File 1: `js/constants.js` — APP_VERSION

Find and replace the version string:
```javascript
const APP_VERSION = "3.XX.YY";  // ← old
const APP_VERSION = "3.XX.YY";  // ← new
```

### File 2: `sw.js` — CACHE_NAME (automatic)

**This is now handled automatically by the pre-commit hook** (`devops/hooks/stamp-sw-cache.sh`). When the commit is created, the hook detects that `js/constants.js` (with the new `APP_VERSION`) is staged, reads the version, generates a build timestamp, and writes:

```javascript
const CACHE_NAME = 'staktrakr-vNEW_VERSION-bTIMESTAMP';
```

You do NOT need to manually edit `sw.js` CACHE_NAME during releases. The hook handles it.

**Do verify** that `sw.js` CORE_ASSETS is up to date (any new `.js` files added since last release must be listed). Check by comparing `<script>` tags in `index.html` against the CORE_ASSETS array in `sw.js`.

### File 3: `CHANGELOG.md` — New version section

Insert a new section **before** the first `## [x.y.z]` heading (after `## [Unreleased]` and its `---`):

```markdown
## [NEW_VERSION] - YYYY-MM-DD

### Added — TITLE

- **Label**: Description (STAK-XX)
- **Label**: Description
...

---

```

Format rules:
- Date is today's date in ISO format (YYYY-MM-DD)
- Section heading is `### Added — TITLE` (use the release title)
- Bullets use `**Label**: Description` format. Labels are typically `Added`, `Changed`, `Fixed`
- Each bullet is a single line (no wrapping)
- STAK-XX references go at the end of the bullet in parentheses

### Files 4 & 6: `docs/announcements.md` + `js/about.js` — MUST STAY IN SYNC

These two files serve the same content to different environments:
- **`docs/announcements.md`** → parsed via `fetch()` on HTTP servers (About modal + version splash)
- **`js/about.js`** → `getEmbeddedWhatsNew()` and `getEmbeddedRoadmap()` are the **`file://` fallback** when fetch fails

**CRITICAL: Both must contain the same entries in the same order.** If they drift, HTTP users see one thing and `file://` users see another.

#### announcements.md

**Step 1: Prepend** a single line after `## What's New\n\n`:

```markdown
- **TITLE (vNEW_VERSION)**: Summary sentence combining all bullets. Summary sentence for next group
```

Format rules:
- One line per release, no matter how many bullets
- Bullets are condensed into period-separated sentences

**Step 2: Trim stale entries.** After prepending, enforce these limits:

- **What's New**: Keep only the **3–5 most recent** entries (lines between `## What's New` and `## Development Roadmap`). Delete older entries beyond 5.
- **Development Roadmap**: Keep only the **3–4 most relevant** items. Remove completed items (anything shipped in this release or earlier). If the roadmap has grown beyond 4 items, trim the lowest-priority entries and note which were removed in the release plan output.

Read `ROADMAP.md` (and Linear backlog if MCP is available) to determine which roadmap items are still relevant vs. completed.

#### about.js — `getEmbeddedWhatsNew()`

**Must mirror `announcements.md` What's New exactly.** After updating announcements.md:

1. **Replace** the entire contents of `getEmbeddedWhatsNew()` (between `return \`` and the closing `\`;`) with HTML `<li>` versions of the same 3–5 entries from announcements.md
2. Each entry format: `<li><strong>vVERSION &ndash; TITLE</strong>: Summary sentence</li>`
3. HTML-escape special characters: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `—` → `&mdash;`, `–` → `&ndash;`
4. **Delete all older entries** — the function should only contain 3–5 `<li>` items matching announcements.md

#### about.js — `getEmbeddedRoadmap()`

**Must mirror `announcements.md` Development Roadmap exactly.** Replace the entire contents with HTML `<li>` versions of the same 3–4 roadmap items.

### File 5: `version.json` — Remote version check endpoint

Update the version and release date at the project root:

```json
{
  "version": "NEW_VERSION",
  "releaseDate": "YYYY-MM-DD",
  "releaseUrl": "https://github.com/lbruton/StakTrakr/releases/latest"
}
```

Format rules:
- `version` matches `APP_VERSION` exactly (no `v` prefix)
- `releaseDate` is today's date in ISO format
- `releaseUrl` always points to `/releases/latest` (GitHub redirects to the correct tag)

## Phase 2: Verify

Run the equivalent of `/verify full`:
1. Confirm all 7 files were updated — 5 manual edits + sw.js (auto-stamped) + seed data (grep for the new version string in each)
2. Check that the `CHANGELOG.md` section is well-formed
3. Check that `announcements.md` has 3–5 What's New entries and 3–4 Roadmap items (no stale bloat)
4. **Sync check**: Verify `getEmbeddedWhatsNew()` in `about.js` contains the same entries as `announcements.md` What's New, and `getEmbeddedRoadmap()` matches the Roadmap section. Flag any drift.
5. Check that `version.json` has the correct version and today's date
6. Check for updated seed data: `git diff --stat data/` — if the Docker poller has been running, these files will have new entries. Confirm they'll be included in the commit.
7. `git diff --stat` — confirm version files + seed data files changed (6 version files + any updated spot-history-*.json)

### Release ZIP audit (`.gitattributes`)

8. **Verify `.gitattributes` export-ignore rules are current.** The release ZIP must contain ONLY runtime files (HTML, JS, CSS, vendor libs, images, manifest, README). Run:
   ```bash
   git archive --format=zip HEAD -o /tmp/staktrakr-release-check.zip && unzip -l /tmp/staktrakr-release-check.zip | tail -5
   ```
   - Confirm NO dev files appear: no `tests/`, `docs/`, `about/`, `.agents/`, `.claude/`, `devops/`, `functions/`, config files, raw `data/spot-history-*.json` source JSONs
   - Confirm ALL runtime files ARE present: `index.html`, `js/*`, `css/*`, `vendor/*`, `images/*`, `data/spot-history-bundle.js`
   - If any new tracked files or directories were added since last release, add `export-ignore` rules to `.gitattributes`
   - Expected file count: ~75-85 files

Report any issues before proceeding.

## Phase 3: Commit

Stage and commit **to the patch branch** (all work lives in the `patch/VERSION` worktree — NOT on `dev` directly):

```bash
git add js/constants.js sw.js CHANGELOG.md docs/announcements.md js/about.js version.json data/spot-history-*.json
git commit -m "vNEW_VERSION — TITLE"
```

Commit message format: `vNEW_VERSION — TITLE`
- Use em dash (`—`), not hyphen
- Include STAK-XX references if applicable: `v3.24.00 — STAK-55: Feature name`
- Match the pattern from existing commits: `v3.23.01 — STAK-52: Goldback real-time estimation, Settings reorganization`

If there are other uncommitted changes beyond the 5 version files, ask the user whether to include them in this commit or leave them staged separately.

**After a successful commit, run wiki update (BLOCKING — must complete before PR):**

Invoke the `wiki-update` skill (Skill tool). It identifies which wiki pages were
affected by this patch and updates in-repo `wiki/`. **This is a blocking step.**
Wiki changes MUST be committed to the patch branch BEFORE proceeding to Phase 4.
Do NOT push or create a PR until wiki updates are committed.

If wiki-update produces changes, commit them on the same patch branch:
```bash
git add wiki/
git commit -m "docs: update wiki pages for vVERSION"
```

If wiki-update finds no affected pages, it exits with a no-op message — proceed to Phase 4.

**After wiki is committed, push the patch branch and open a PR to dev** (Phase 4 covers this).
**After the PR is merged to dev — tag the patch commit on dev and run worktree cleanup:**

```bash
# Tag the patch on dev (the merge commit SHA) — breadcrumb for changelog reconstruction
git fetch origin dev
git tag vNEW_VERSION origin/dev
git push origin vNEW_VERSION

# Remove the worktree
rm -f .worktrees/patch-VERSION/.worktree.lock
git worktree remove .worktrees/patch-VERSION --force

# Delete the local branch
git branch -d patch/VERSION

# Delete the remote branch
git push origin --delete patch/VERSION

# Release the version lock — remove only your own claim entry by version match
# Leave other active claims intact. If no other claims remain, the file may be deleted.
# devops/version.lock is gitignored — safe to edit directly.
```

> **Note:** This tag lands on `dev`, NOT `main`. A git tag is NOT a GitHub Release — it only appears in the Tags tab. The actual GitHub Release (`gh release create`) is created in Phase 5 after the `dev → main` merge. Do not skip Phase 5.

## Phase 4: Push & Draft PR

> **⚠️ PR target reminder:** `patch/VERSION` → **`dev`** (QA preview). `dev` → `main` only via Phase 4.5, only when user says ready. Never create a patch PR targeting main.

### Pre-flight check (HARD GATE)

Before pushing, verify the branch is complete:

```bash
# 1. Wiki must be committed — no orphaned wiki changes
git diff --name-only wiki/ | grep -c . && echo "FAIL: uncommitted wiki changes" || echo "OK: wiki clean"

# 2. All version files present in commit history
git log --oneline --name-only HEAD~3..HEAD | grep -E '(wiki/|js/constants|CHANGELOG)' || echo "WARNING: check commit contents"
```

If uncommitted wiki changes exist, commit them before pushing. **Do NOT create a PR with pending wiki updates.**

### Step 1: Push and create PR

1. Push the patch branch:
   ```bash
   git push origin patch/VERSION
   ```

2. **Create the `patch/VERSION → dev` draft PR** (this is the QA/preview PR — Cloudflare will generate a preview URL):
   ```bash
   gh pr create --base dev --head patch/VERSION --draft --label "codacy-review" \
     --title "vNEW_VERSION — [brief description]" \
     --body "$(cat <<'EOF'
   > **Draft — QA preview.** Merge to `dev` after QA passes. Do NOT target main.

   ## Changes

   - [bullet points for this commit/batch]

   ## Linear Issues

   - [STAK-XX: title — link] (if applicable)

   🤖 Generated with [Claude Code](https://claude.com/claude-code)
   EOF
   )"
   ```

3. (Optional — requires Linear MCP) If Linear issues are referenced, update status to **In Progress** (not Done — that happens at merge time).

### Step 2: PR Resolution & Scan Monitoring (MANDATORY)

After the PR is created, **do not walk away**. Complete these steps:

1. **Wait for CI/Codacy scans** to start (usually 30-60 seconds after push)
2. **Run `/pr-resolve`** to monitor and resolve review threads as they appear
3. **Check scan results**: `gh pr checks <PR_NUMBER>` — wait for all checks to complete
4. **Address any Codacy/Copilot findings** — fix issues, push follow-up commits, re-run `/pr-resolve`
5. **Confirm the PR is clean** — all checks passing, no unresolved threads

The PR should be ready for the user to merge with a single click. Do not leave unresolved threads or failing checks for the user to clean up.

> **The PR is not "done" until it's clean.** A draft PR with failing scans and unresolved threads is incomplete work.

> **No `dev → main` PR here.** The patch branch PRs to `dev` only. The `dev → main` PR is created at Phase 4.5, using version tags on `dev` as the changelog source. Do not create or touch any PR targeting `main` during Phase 4.

## Phase 4.5: Create `dev → main` PR and Ship (Run only when user says "release", "ready to ship", or "merge to main")

This phase is triggered when `dev` is QA-complete and you want to ship to main. It collects the version tags on `dev` as the changelog source, creates the PR, and prepares it for final review.

**Hard gate:** Do NOT run this unless the user has explicitly said they are ready to release in the current session.

### Step 1: Audit the branch

Run both in parallel:

```bash
git fetch origin
git log --oneline main..origin/dev
git tag --merged origin/dev --sort=-version:refname | grep '^v3\.' | head -20
```

The tag list gives you every patch breadcrumb on `dev` that hasn't shipped to main yet. These are your changelog source — more reliable than commit messages alone.

### Step 2: Fetch Linear issue titles

For each STAK-### found across commits and tag names, call `get_issue` (Linear MCP) to get the current title and status. This ensures the PR description is accurate, not just copy-pasted from commit messages.

### Step 3: Create the `dev → main` PR

The PR title should reflect the **full contents of the branch**:

```
vLATEST_VERSION — [primary feature/fix] + [secondary] + [tertiary if notable]
```

```bash
gh pr create --base main --head dev --label "codacy-review" \
  --title "vLATEST_VERSION — [comprehensive title]" \
  --body "$(cat <<'EOF'
## Summary

- [bullet per feature/fix, grouped logically by version tag]
- [user-readable descriptions — not raw commit messages]

## Version Tags Included

- vX.X.X — [title]
- vX.X.X — [title]
- ...

## Linear Issues

- STAK-XX: [title] — [url]
- STAK-XX: [title] — [url]

## QA Notes

- [anything the reviewer should test or verify]

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 3.5: Audit announcements & about.js (MANDATORY before creating PR)

Over a long release cycle, `docs/announcements.md` and `js/about.js` accumulate
stale per-patch entries. Before creating the ship PR, rewrite both to reflect
the **full release**:

1. Rewrite `## What's New` in `docs/announcements.md` with **3–5 entries**
   covering the most significant changes (grouped by theme, not per-patch)
2. Update `## Development Roadmap` — remove completed items, keep 3–4 forward
3. Mirror the same entries in `js/about.js` `getEmbeddedWhatsNew()` and
   `getEmbeddedRoadmap()` (these are the `file://` fallback)
4. Commit and push to dev before creating the ship PR

See the `/ship` skill Step 3.5 for full format details.

### Step 4: Mark ready and resolve

```bash
gh pr ready [number]
```

Then run `/pr-resolve` to clear all open Codacy and Copilot review threads before the PR goes to final review.

### Step 5: Update Linear issues

Mark all referenced STAK-### issues as **Done** (they ship with this merge).

### Step 6: After the PR merges to main — run Phase 5 immediately

**MANDATORY.** Do not consider the release complete until Phase 5 is done. The GitHub Release is the public-facing artifact — the "Latest" badge on GitHub, the release notes users read, and what `version.json`'s `releaseUrl` resolves to. Without it, the GH Releases page is stale.

## Phase 5: GitHub Release & Tag (Post-Merge Only — MANDATORY)

**CRITICAL: Only run this after the PR has been merged to main.** The release tag must target main so `version.json`'s `releaseUrl` resolves correctly. This phase is REQUIRED for every `dev → main` merge — without it the GitHub Releases page shows a stale version and the "Latest" badge is wrong.

```bash
git fetch origin main
gh release create vNEW_VERSION \
  --target main \
  --title "vNEW_VERSION — TITLE" \
  --latest \
  --notes "$(cat <<'EOF'
## TITLE

- [changelog bullets from Phase 1, verbatim]
EOF
)"
```

### Release notes format

- Use the changelog section heading as the `## TITLE`
- Copy changelog bullets verbatim (they're already formatted correctly)
- Do NOT include file update lists or Linear references — those belong in the PR body, not the release

### Verify

```bash
gh release list --limit 3
```
Confirm the new version shows as `Latest`.

## Phase 6: Confirm

```
Release complete!

Version:  vNEW_VERSION
Commit:   [hash] [message]
PR:       #XX merged — [url]
Release:  https://github.com/lbruton/StakTrakr/releases/tag/vNEW_VERSION
Linear:   STAK-XX → Done
```

## Dry Run Mode

If the argument is `dry-run`:
- Complete Phase 0 (gather context, present plan)
- Show exactly what would be written to each file (diffs or excerpts)
- Show the `gh release create` command that would be run
- Do NOT write any files, commit, push, create PR, or create release
- End with: `Dry run complete — no files modified.`
