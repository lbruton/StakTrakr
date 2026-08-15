#!/usr/bin/env python3
"""
Update spot history bundle from sqld gap + year JSON files.

Flow:
  1. Scan data/spot-history-{year}.json files to find the most recent date.
  2. Query sqld for all spot prices AFTER that date (fills the gap).
  3. Append new rows to the appropriate year JSON file(s).
  4. Rebuild data/spot-history-bundle.js from all year JSON files.

This keeps the year JSON files current (used by fetchYearFile() in HTTP mode)
and the bundle current (used for offline / file:// protocol).

Usage (from project root):
    SQLD_URL=http://192.168.1.81:8080 python3 .claude/skills/update-spot-bundle/update-spot-bundle.py

Env vars:
    SQLD_URL          Required. sqld HTTP endpoint (e.g. http://192.168.1.81:8080)
    SQLD_AUTH_TOKEN   Optional. Bearer token — local sqld runs without auth.
"""

import datetime
import json
import os
import pathlib
import sys
import urllib.request
import urllib.error
from collections import defaultdict

PROJECT_ROOT = str(pathlib.Path(__file__).resolve().parents[3])
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
OUTPUT_FILE = os.path.join(DATA_DIR, "spot-history-bundle.js")

START_YEAR = 1968

METAL_DISPLAY = {
    "gold": "Gold",
    "silver": "Silver",
    "platinum": "Platinum",
    "palladium": "Palladium",
}
METAL_LOWER = {v: k for k, v in METAL_DISPLAY.items()}

# Metals allowed into the shipped bundle.
#
# STRK-303: this is NOT the same set the poller tracks. Copper rows now land in
# sqld, but the bundle is precached by the service worker and loaded straight
# into the frontend's historical cache — and the frontend ingest path has no
# metal whitelist of its own. Without this gate the first version-bump PR after
# copper started polling would have shipped copper history to every user with
# no UI to show it and nobody intending it.
#
# METAL_DISPLAY alone was never a gate: the sqld query below has no metal
# filter, and both call sites fall back to passing unknown metals through
# (one raw, one .capitalize()'d).
#
# REMOVE THIS GATE IN STRK-304 (Phase 1b), whose job is to seed copper history
# into the bundle. Until then it is deliberate, not a bug.
BUNDLE_METALS = frozenset(METAL_DISPLAY.values())


# ── sqld helpers ──────────────────────────────────────────────────────────────

def sqld_query(url, token, sql, args=None):
    """Execute a SQL query via sqld Hrana v2 HTTP API. Returns list of row dicts."""
    endpoint = url.rstrip("/") + "/v2/pipeline"
    stmt = {"sql": sql.strip(), "want_rows": True}
    if args:
        stmt["args"] = [{"type": "text", "value": str(a)} for a in args]

    payload = {
        "requests": [
            {"type": "execute", "stmt": stmt},
            {"type": "close"},
        ]
    }
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode(),
        headers=headers,
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
    except urllib.error.URLError as e:
        print(f"\nERROR: Could not reach sqld at {endpoint}")
        print(f"  {e}")
        print("\nIs Tailscale connected? Is SQLD_URL set correctly?")
        sys.exit(1)

    try:
        execute_result = result["results"][0]["response"]["result"]
    except (KeyError, IndexError, TypeError) as e:
        print(f"\nERROR: Unexpected sqld response: {e}")
        print(json.dumps(result, indent=2)[:500])
        sys.exit(1)

    cols = [c["name"] for c in execute_result["cols"]]
    rows = []
    for raw_row in execute_result["rows"]:
        row = {}
        for i, col in enumerate(cols):
            val = raw_row[i]
            row[col] = val.get("value") if isinstance(val, dict) else val
        rows.append(row)
    return rows


# ── year JSON helpers ─────────────────────────────────────────────────────────

def load_year_file(year):
    """Load a year JSON file. Returns list of entry dicts (may be empty)."""
    path = os.path.join(DATA_DIR, f"spot-history-{year}.json")
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def save_year_file(year, entries):
    """Write a year JSON file, pretty-printed for readable diffs."""
    path = os.path.join(DATA_DIR, f"spot-history-{year}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)
        f.write("\n")


def find_latest_json_date():
    """
    Scan all year JSON files and return the latest timestamp string found.
    Returns "1968-01-01" if no files exist.
    """
    latest = "1968-01-01"
    current_year = datetime.date.today().year
    for year in range(START_YEAR, current_year + 1):
        entries = load_year_file(year)
        for e in entries:
            ts = str(e.get("timestamp", ""))[:10]  # "YYYY-MM-DD"
            if ts > latest:
                latest = ts
    return latest


# ── bundle builder ────────────────────────────────────────────────────────────

def build_bundle_from_json_files():
    """
    Read all year JSON files and produce the compact bundle structure.
    Returns (bundle_dict, total_entry_count).
    """
    bundle = {}
    total = 0
    current_year = datetime.date.today().year

    for year in range(START_YEAR, current_year + 1):
        entries = load_year_file(year)
        if not entries:
            continue

        year_data = defaultdict(list)
        for e in entries:
            metal_raw = str(e.get("metal", ""))
            metal = METAL_DISPLAY.get(metal_raw.lower(), metal_raw)
            ts = str(e.get("timestamp", ""))
            spot = e.get("spot")
            if not (metal and ts and spot is not None):
                continue
            if metal not in BUNDLE_METALS:
                continue  # STRK-303 copper hold-back — see BUNDLE_METALS
            mm_dd = ts[5:10]  # "MM-DD" from "YYYY-MM-DD HH:MM:SS"
            year_data[metal].append([mm_dd, round(float(spot), 2)])
            total += 1

        if year_data:
            bundle[str(year)] = dict(year_data)

    return bundle, total


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    sqld_url = os.environ.get("SQLD_URL", "").strip()
    if not sqld_url:
        print("ERROR: SQLD_URL is not set.")
        print()
        print("Run with:")
        print("  SQLD_URL=http://192.168.1.81:8080 python3 .claude/skills/update-spot-bundle/update-spot-bundle.py")
        sys.exit(1)

    sqld_token = os.environ.get("SQLD_AUTH_TOKEN", "").strip()

    # ── Step 1: find gap start ────────────────────────────────────────────────
    latest_json_date = find_latest_json_date()
    print(f"Latest date in year JSON files: {latest_json_date}")

    # ── Step 2: query sqld for gap data ──────────────────────────────────────
    print(f"Querying sqld at {sqld_url} for data after {latest_json_date} ...")

    sql = """
        SELECT
            metal,
            DATE(timestamp_floor) AS day,
            ROUND(AVG(spot), 2)   AS spot
        FROM spot_prices
        WHERE DATE(timestamp_floor) > ?
        GROUP BY metal, day
        ORDER BY day, metal
    """
    gap_rows = sqld_query(sqld_url, sqld_token, sql, args=[latest_json_date])

    if not gap_rows:
        print("  No new data in sqld since last JSON update.")
    else:
        print(f"  Found {len(gap_rows)} new day×metal entries from sqld.")

        # ── Step 3: append new rows to year JSON files ────────────────────────
        new_by_year = defaultdict(list)
        for row in gap_rows:
            day = str(row["day"])           # "YYYY-MM-DD"
            metal_raw = str(row["metal"])   # "gold" etc.
            metal = METAL_DISPLAY.get(metal_raw.lower(), metal_raw.capitalize())
            if metal not in BUNDLE_METALS:
                continue  # STRK-303 copper hold-back — see BUNDLE_METALS
            spot = row["spot"]
            try:
                price = round(float(spot), 2)
            except (TypeError, ValueError):
                continue
            year = day[:4]
            new_by_year[year].append({
                "spot": price,
                "metal": metal,
                "source": "sqld",
                "timestamp": f"{day} 12:00:00",
            })

        for year, new_entries in sorted(new_by_year.items()):
            existing = load_year_file(int(year))
            combined = existing + new_entries
            save_year_file(int(year), combined)
            print(f"  Updated data/spot-history-{year}.json (+{len(new_entries)} entries)")

    # ── Step 4: rebuild bundle from all year JSON files ───────────────────────
    print("Rebuilding bundle from year JSON files ...")
    bundle, total_entries = build_bundle_from_json_files()

    if not bundle:
        print("ERROR: No data found in year JSON files. Nothing to bundle.")
        sys.exit(1)

    all_years = sorted(bundle.keys())
    min_year = all_years[0]

    # Find the actual max date across all entries in the latest year
    max_date = latest_json_date
    if gap_rows:
        max_date = max(str(r["day"]) for r in gap_rows)

    js_data = json.dumps(bundle, separators=(",", ":"))
    js_content = (
        "// Auto-generated by .claude/skills/update-spot-bundle/update-spot-bundle.py — do not edit\n"
        f"// {min_year} to {max_date}  ({total_entries:,} entries, {len(bundle)} years)\n"
        f"window._loadSpotSeedBundle({js_data});\n"
    )

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)

    file_size = os.path.getsize(OUTPUT_FILE)
    print(f"\nWritten {OUTPUT_FILE}")
    print(f"  {total_entries:,} entries · {len(bundle)} years · {file_size:,} bytes ({file_size // 1024} KB)")
    print(f"  Coverage: {min_year} → {max_date}")
    if gap_rows:
        print(f"  New entries added from sqld: {len(gap_rows)}")
    print()
    print("Next: git add data/spot-history-bundle.js data/spot-history-*.json")


if __name__ == "__main__":
    main()
