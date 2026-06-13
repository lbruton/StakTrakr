---
name: release
description: StakTrakr-specific Phase 1 version bump — edits 6 files, trims What's New, delegates sw.js to pre-commit hook.
---

# StakTrakr Release — Phase 1 Override

Project-level override for the global `/release` skill. This file defines **Phase 1 (version bump)** and **Phase 2 (verification)** for StakTrakr. All other phases (lock, worktree, PR, GitHub Release, cleanup) are handled by the global skill.

## Phase 1: Version Bump — 6 Files

The global skill provides `NEW_VERSION` (e.g. `3.34.47`) and the confirmed changelog bullets from Phase 0.4. Edit these 6 files in order:

### 1. `js/constants.js` (line ~287)

Replace the `APP_VERSION` string literal:

```javascript
const APP_VERSION = "NEW_VERSION";
```

### 2. `package.json` (line 4)

Update the root `version` field:

```json
"version": "NEW_VERSION",
```

### 3. `package-lock.json`

Update two fields only — the root-level `"version"` field and the `packages[""].version` field (the self-reference entry). Every other `"version"` field is a dependency. Do NOT touch dependency versions.

### 4. `version.json`

Update both fields:

```json
{
  "version": "NEW_VERSION",
  "releaseDate": "YYYY-MM-DD",
  "releaseUrl": "https://github.com/lbruton/StakTrakr/releases/latest"
}
```

### 5. `CHANGELOG.md`

Insert a new section between `## [Unreleased]` and the `---` separator above the previous version:

```markdown
## [NEW_VERSION] - YYYY-MM-DD

### Changed — ISSUE-ID: Title

- **Label**: Description (ISSUE-ID)

---
```

Use the confirmed changelog bullets from Phase 0.4. Match the existing format: `### Changed —` with em dash, issue reference in parentheses on each bullet.

### 6. `js/about.js` — What's New (PREPEND + TRIM)

Edit `getEmbeddedWhatsNew()` (starts at line ~140):

**Prepend** a new `<li>` entry at the top of the return template:

```html
<li>
  <strong>vNEW_VERSION &ndash; ISSUE-ID: Title</strong>: Detailed 2-3 sentence summary of the change
  &mdash; what changed, why a user cares, and any visible behavior difference (ISSUE-ID).
</li>
```

Format rules:

- Use `&ndash;` (en dash entity), not `—` or `–`
- Wrap version + title in `<strong>` tags
- End with issue reference in parentheses
- 2-3 sentences per entry is the target — the 5-entry cap exists so each block can carry
  real detail (changed from the earlier 8 short entries, 2026-06)

**Trim** the list to keep the **5 most recent entries**. Remove the oldest `<li>` elements from the bottom of the list until only 5 remain.

### Handled Automatically — DO NOT EDIT

**`sw.js`** — The `stamp-sw-cache` pre-commit hook reads `APP_VERSION` from `constants.js` at commit time and stamps `CACHE_NAME` automatically. Do NOT manually edit `sw.js` during a release. The hook produces: `staktrakr-v{APP_VERSION}-b{EPOCH}`.

## Phase 2: Verification

After all edits, run these checks:

Substitute the actual old and new version strings in all grep commands below.

```bash
# 1. Version string appears in all 6 edited files
grep -l "NEW_VERSION" js/constants.js package.json package-lock.json version.json CHANGELOG.md js/about.js

# 2. Exactly 6 files listed (if fewer, one was missed)

# 3. What's New entry count is exactly 5 (versioned entries only)
grep -c '<li><strong>v' js/about.js  # Should be 5

# 4. No stale version in edited files
grep -n "OLD_VERSION" js/constants.js package.json version.json
# Should return nothing

# 5. Diff check — confirm expected files changed
git diff --stat
```

If any check fails, fix before committing.

## Phase 3: Post-Commit

No additional post-commit steps. The global skill handles PR creation and resolution.
