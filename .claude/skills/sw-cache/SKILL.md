---
name: sw-cache
description: Service worker cache management — CACHE_NAME format, pre-commit hook, stale cache prevention.
---

# Service Worker Cache

Rules and automation for the service worker (`sw.js`) cache versioning system. Prevents stale asset issues caused by the SW serving old CSS/JS from its pre-cache.

## Project Detection

Read `.claude/project.json` to get the cache prefix for this project:

```bash
cat .claude/project.json 2>/dev/null || echo '{}'
```

Use `cachePrefix` from the result (e.g., `staktrakr`). If not present, default to the lowercase repo name.

## CACHE_NAME Format

```
{CACHE_PREFIX}-v{APP_VERSION}-b{EPOCH}
```

- **CACHE_PREFIX**: from `.claude/project.json` `.cachePrefix` field
- **APP_VERSION**: from `js/constants.js` (e.g., `3.30.08`)
- **EPOCH**: Unix timestamp in seconds at commit time (e.g., `1739836800`)
- **Full example**: `staktrakr-v3.30.08-b1739836800`

The version prefix groups caches by release. The build timestamp ensures every commit that touches cached assets gets a unique cache name, forcing the SW to evict stale assets on its next `activate` event.

## Pre-Commit Hook (Automatic)

A pre-commit hook at `devops/hooks/stamp-sw-cache.sh` automatically updates `CACHE_NAME` in `sw.js` whenever any cached asset is staged for commit.

### What it does

1. Checks if any file matching CORE_ASSETS patterns is staged (`css/`, `js/`, `index.html`, `data/`, `images/`, `manifest.json`, `sw.js`)
2. If yes: reads `APP_VERSION` from `constants.js`, generates a Unix timestamp, and writes the new `CACHE_NAME`
3. Re-stages `sw.js` so the updated cache name is included in the commit
4. If no cached assets are staged, the hook exits silently (no-op)

### Installation

```bash
ln -sf ../../devops/hooks/stamp-sw-cache.sh .git/hooks/pre-commit
```

This symlink is not tracked by git. New clones or CI environments need to run this command.

### Manual override

```bash
git commit --no-verify -m "message"
```

## CORE_ASSETS List

When adding a new `.js` file to the project:

1. Add its `<script>` tag to `index.html` in the correct dependency order
2. Add it to the `CORE_ASSETS` array in `sw.js` (same order as `index.html`)
3. The pre-commit hook will auto-bump `CACHE_NAME` on the next commit

If a script is in `index.html` but not in CORE_ASSETS, the SW won't pre-cache it and users may see stale-cache glitches on first load.

## Interaction with /release

- `/release` still bumps `APP_VERSION` in `constants.js`
- `/release` no longer needs to manually edit `CACHE_NAME` in `sw.js` — the pre-commit hook handles it automatically
- The release commit will have a cache name like `{CACHE_PREFIX}-v{NEW_VERSION}-b{TIMESTAMP}`

**However**: the `/release` skill should still verify that `sw.js` CORE_ASSETS is up to date as a sanity check.

## Troubleshooting

### "CSS looks broken on first load but hard refresh fixes it"

Causes:

1. **CACHE_NAME wasn't bumped** — hook not installed, or commit didn't include cached assets
2. **New file missing from CORE_ASSETS** — SW doesn't know to pre-cache it

Fix: ensure the hook is installed, add missing files to CORE_ASSETS, commit again.

### "Hook didn't run"

```bash
ls -la .git/hooks/pre-commit
# Should show: -> ../../devops/hooks/stamp-sw-cache.sh
```

If missing, re-install:

```bash
ln -sf ../../devops/hooks/stamp-sw-cache.sh .git/hooks/pre-commit
```

### Verifying the stamp worked

```bash
grep CACHE_NAME sw.js
# const CACHE_NAME = '{CACHE_PREFIX}-v3.30.08-b1739836800';
```

The `-b` suffix should be a recent Unix timestamp (within seconds of the commit).
