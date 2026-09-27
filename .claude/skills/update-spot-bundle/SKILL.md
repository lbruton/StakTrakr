---
name: update-spot-bundle
description: Fill the sqld→year JSON→bundle gap and rebuild spot-history-bundle.js with current data.
---

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

1. Queries sqld for one `AVG(spot)` per (metal, UTC day) over every **complete** UTC day (today is excluded), aggregated and rounded in SQL
2. Merges into each `data/spot-history-{year}.json`: fills missing days, corrects earlier `source: "sqld"` entries, never overwrites a `source: "seed"` entry; sorted by date, then metal
3. Rebuilds `data/spot-history-bundle.js` from all year JSON files

Both the bundle (offline use) and the year JSON files (`fetchYearFile()` in HTTP mode) stay current.

**Shared rule (STRK-403):** the Fly publisher writes the public API copy of the year file with the identical rule (`devops/pollers/shared/spot-year-history.js`). Change one, change both. Before STRK-403 this script appended only days after the latest file date — including the day in progress, never revisited — so every release froze a partial-day average.

## Verification

After running, output should show:

- `sqld returned N day×metal averages` and either `Updated data/spot-history-YYYY.json (+N new, M corrected)` or `unchanged`
- `Coverage: 1968 → <today>`
- Bundle size 750 KB+

Then stage: `git add data/spot-history-bundle.js data/spot-history-*.json`
