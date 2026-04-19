---
name: pr-ready
description: Pre-PR readiness checklist for StakTrakr. Verifies version bump, sw.js and index.html registrations for new JS files, DocVault update status, and Codacy findings before pushing.
allowed-tools: Bash, Read, Grep, Glob, mcp__codacy__codacy_get_repository_with_analysis, mcp__codacy__codacy_list_repository_issues
---

# PR Ready — StakTrakr Pre-Push Checklist

Run all checks below in order. Output a single markdown table at the end with PASS / WARN / FAIL per check. Stop and flag blockers clearly — do not silently skip a check.

---

## Check 1: Version Bump

Compare the version in `js/constants.js` against the latest git tag.

```bash
# Get latest tag
git -C /Volumes/DATA/GitHub/StakTrakr describe --tags --abbrev=0

# Get version from constants.js
grep 'const APP_VERSION' /Volumes/DATA/GitHub/StakTrakr/js/constants.js
```

- **PASS**: constants.js version is higher than latest tag
- **FAIL**: versions are equal (version was not bumped since last tag)
- **WARN**: tag version is somehow higher (unexpected — flag it)

---

## Check 2: SW + index.html Registration for New JS Files

Find all `.js` files added since the last git tag. For each, verify it appears in both `sw.js` CORE_ASSETS and `index.html` as a `<script>` tag.

```bash
# Files changed since last tag (new JS files only)
git -C /Volumes/DATA/GitHub/StakTrakr diff --name-only --diff-filter=A $(git -C /Volumes/DATA/GitHub/StakTrakr describe --tags --abbrev=0) HEAD -- 'js/*.js'
```

For each new `js/FILENAME.js`:

1. Check `sw.js` for `'js/FILENAME.js'` in CORE_ASSETS
2. Check `index.html` for `src="js/FILENAME.js"`

- **PASS**: All new JS files appear in both locations (or no new JS files)
- **FAIL**: Any new file missing from `sw.js` OR `index.html` — name which file and which location

---

## Check 3: Duplicate Function Definitions

If `js/events.js` or `js/api.js` were changed since the last tag, check for function names defined in both files.

```bash
# Get function names from events.js
grep -o 'function [a-zA-Z_][a-zA-Z0-9_]*' /Volumes/DATA/GitHub/StakTrakr/js/events.js | sort

# Get function names from api.js
grep -o 'function [a-zA-Z_][a-zA-Z0-9_]*' /Volumes/DATA/GitHub/StakTrakr/js/api.js | sort
```

- **PASS**: No duplicate function names between the two files (or neither was changed)
- **WARN**: Neither file changed — skip
- **FAIL**: One or more function names appear in both files — list them

---

## Check 4: DocVault Status

Check whether any changed source files have a corresponding DocVault page with a stale `updated` timestamp. Look for pages whose `sourceFiles` frontmatter lists a file modified since the last tag.

```bash
# Files changed since last tag (all types)
git -C /Volumes/DATA/GitHub/StakTrakr diff --name-only $(git -C /Volumes/DATA/GitHub/StakTrakr describe --tags --abbrev=0) HEAD
```

Then grep DocVault pages for any of these file names in their `sourceFiles` frontmatter:

```bash
grep -rl "CHANGED_FILENAME" /Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/ 2>/dev/null
```

- **PASS**: No DocVault pages reference changed files, or all referencing pages have been updated (run `/vault-update` if unsure)
- **WARN**: Matching DocVault pages found — remind user to run `/vault-update` before pushing
- **SKIP**: If DocVault is not accessible, note it and move on

---

## Check 5: Codacy Quality Gate

Fetch open critical/error-level issues from Codacy for the StakTrakr repository.

Use `mcp__codacy__codacy_list_repository_issues` with provider `gh`, remoteOrganizationName `lbruton`, repositoryName `StakTrakr`. Filter for severity `Error` or `Critical`.

- **PASS**: No open critical/error issues
- **WARN**: Issues exist but are pre-existing (not in files changed since last tag)
- **FAIL**: Critical issues exist in files changed since last tag — list them with file:line

---

## Final Output

Output this table, filling in each row:

```markdown
| Check                           | Status         | Detail                                                                 |
| ------------------------------- | -------------- | ---------------------------------------------------------------------- |
| 1. Version bump                 | PASS/FAIL/WARN | e.g. "3.33.93 → 3.33.94" or "still at v3.33.94 — bump needed"          |
| 2. SW + index.html registration | PASS/FAIL      | e.g. "js/new-feature.js missing from sw.js"                            |
| 3. Duplicate functions          | PASS/FAIL/WARN | e.g. "No duplicates" or "loadMarketData in both events.js and api.js"  |
| 4. DocVault                     | PASS/WARN/SKIP | e.g. "market-data.md references js/market-data.js — run /vault-update" |
| 5. Codacy                       | PASS/WARN/FAIL | e.g. "2 critical issues in js/api.js:L45"                              |
```

If any check is FAIL: output **"NOT READY TO PUSH — fix blockers above."**
If all checks are PASS or WARN: output **"READY TO PUSH — review warnings if any."**
