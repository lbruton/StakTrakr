---
name: seed-sync
description: Rebuild spot-history seed bundle from year files. Run before every release PR to ensure packaged seed data is current.
allowed-tools: Bash, Read, Glob
---

# Seed Sync — Spot History Bundle Builder

Rebuilds `data/spot-history-bundle.js` from `data/spot-history-{year}.json` files so charts work on `file://` protocol where fetch is blocked.

## When to Run

- Before every release PR (Gate 7 in global CLAUDE.md)
- After updating any `data/spot-history-*.json` file
- User explicitly invokes `/seed-sync`

## Execution

Run from project root:

```bash
python3 .claude/skills/seed-sync/build-seed-bundle.py
```

## Verification

After running, confirm:

1. `data/spot-history-bundle.js` was regenerated (check output for entry count + file size)
2. The bundle is not empty (should be several hundred KB)
3. Stage the updated bundle: `git add data/spot-history-bundle.js`

## Notes

- The script reads all `data/spot-history-{year}.json` files (1968–current year)
- Output is a single `<script>`-loadable JS file that pre-populates `historicalDataCache`
- The `stamp-sw-cache` pre-commit hook will auto-stage `sw.js` if the bundle changed
