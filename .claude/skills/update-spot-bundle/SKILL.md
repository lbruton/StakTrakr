# Update Spot Bundle

Fills the gap between the committed year JSON files and today's sqld data, then rebuilds `data/spot-history-bundle.js` — the offline fallback for `file://` protocol where the app can't reach the API.

**Replaces:** `seed-sync` (retired — was repackaging stale static JSON files, never fetched live data)

---

## When to Run

- Before every release PR (gate in CLAUDE.md Pre-flight)
- Any time you want to pull fresh spot history into the bundle

## Prerequisites

`SQLD_URL` must be set and Tailscale must be connected:

```bash
export SQLD_URL=http://192.168.1.81:8080
# SQLD_AUTH_TOKEN is optional — local sqld runs without auth
```

## Execution

```bash
SQLD_URL=http://192.168.1.81:8080 python3 .claude/skills/update-spot-bundle/update-spot-bundle.py
```

Run from the **project root** (script resolves paths relative to itself).

## What It Does

1. Scans `data/spot-history-{year}.json` files to find the most recent date
2. Queries sqld for all spot prices **after** that date (fills the gap)
3. Appends new rows to the current year's JSON file (`source: "sqld"`)
4. Rebuilds `data/spot-history-bundle.js` from all year JSON files

Both the bundle (offline use) and the year JSON files (`fetchYearFile()` in HTTP mode) stay current.

## Verification

After running, output should show:

- `Found N new day×metal entries from sqld`
- `Coverage: 1968 → <today>`
- Bundle size 750 KB+

Then stage: `git add data/spot-history-bundle.js data/spot-history-*.json`
