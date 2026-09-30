#!/usr/bin/env python3
"""
Update spot history year JSON files from sqld, then rebuild the bundle.

Flow:
  1. Query sqld for one AVG(spot) per (metal, UTC day) over every COMPLETE
     UTC day (the day in progress is excluded), aggregated and rounded in SQL.
  2. Merge into each data/spot-history-{year}.json: sqld fills missing
     (date, metal) keys and replaces its own earlier "sqld" entries; a "seed"
     entry is never overwritten. Entries are sorted by date, then metal.
  3. Rebuild data/spot-history-bundle.js from all year JSON files.

This keeps the year JSON files current (used by fetchYearFile() in HTTP mode)
and the bundle current (used for offline / file:// protocol).

SHARED RULE (STRK-403): devops/pollers/shared/spot-year-history.js applies the
identical rule to the public API copy of the year file. Change one, change both.
Before STRK-403 this script appended only days AFTER the latest file date,
including the day in progress, and never revisited it — every release froze a
partial-day average (68 of them by 2026-09-26) and a 2026-02-27..03-08 hole.

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
    "copper": "Copper",
}
METAL_LOWER = {v: k for k, v in METAL_DISPLAY.items()}

# Metals allowed into the shipped bundle.
#
# STRK-303 held copper OUT of the bundle until its history was seeded; STRK-304
# seeded 1968→present copper history into the year files, so copper now ships.
# The gate itself stays: the sqld query below has no metal filter and both call
# sites pass unknown metals through, so an unexpected sixth metal appearing in
# sqld would otherwise reach every user's cache unreviewed.
BUNDLE_METALS = frozenset(METAL_DISPLAY.values())

# Sub-dollar prices keep 4 decimals so copper (~$0.41/ozt) doesn't lose ~1% to
# 2dp quantization — mirrors roundPrice() in shared/spot-metals.js (STRK-303).
SUB_DOLLAR_THRESHOLD = 1
DECIMALS_STANDARD = 2
DECIMALS_SUB_DOLLAR = 4


def round_price(price):
    """Round a $/oz price for storage — 4dp below $1 (copper), 2dp otherwise."""
    decimals = DECIMALS_SUB_DOLLAR if price < SUB_DOLLAR_THRESHOLD else DECIMALS_STANDARD
    return round(price, decimals)


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
    """
    Write a year JSON file in the compact single-line format.

    Matches save_year_file() in shared/spot-poller/update-seed-data.py — the two
    writers touched the same files with different formats until STRK-304, which
    made every append rewrite the whole file as a giant diff. Compact is the
    repo-dominant format (55/59 files pre-unification); these files are
    machine-verified, not review-read.
    """
    path = os.path.join(DATA_DIR, f"spot-history-{year}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, separators=(", ", ": "))


def entry_key(entry):
    """(date, metal) identity of a year-file entry."""
    return (str(entry.get("timestamp", ""))[:10], entry.get("metal"))


def merge_year_entries(existing, fresh):
    """
    Merge fresh sqld entries over an existing year file (mirrors
    mergeYearEntries() in devops/pollers/shared/spot-year-history.js).

    A fresh entry fills a missing (date, metal) key or replaces an earlier
    source "sqld" entry (a frozen partial day). It never replaces a source
    "seed" entry: sqld's first days held as little as 1 sample/day, and the
    seed values are the better record. Output is sorted by date, then metal.
    """
    by_key = {entry_key(e): e for e in existing}
    for e in fresh:
        key = entry_key(e)
        if by_key.get(key, {}).get("source") == "seed":
            continue
        by_key[key] = e
    return sorted(by_key.values(), key=lambda e: (str(e.get("timestamp", ""))[:10], str(e.get("metal"))))


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
                continue  # unexpected-metal gate — see BUNDLE_METALS
            mm_dd = ts[5:10]  # "MM-DD" from "YYYY-MM-DD HH:MM:SS"
            year_data[metal].append([mm_dd, round_price(float(spot))])
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

    # ── Step 1: query sqld for every complete UTC day ─────────────────────────
    # The window ends at the start of today (UTC): the day in progress is
    # never written, so a partial average can never be frozen into a file.
    # Rounded in SQL so this script and spot-year-history.js read the identical
    # number (Python round() is half-even, JS Math.round is half-up).
    today_start = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT00:00:00Z")
    print(f"Querying sqld at {sqld_url} for complete UTC days before {today_start[:10]} ...")

    sql = """
        SELECT
            metal,
            DATE(timestamp_floor) AS day,
            CASE
                WHEN AVG(spot) < 1 THEN ROUND(AVG(spot), 4)
                ELSE ROUND(AVG(spot), 2)
            END AS spot
        FROM spot_prices
        WHERE timestamp_floor < ?
        GROUP BY metal, day
        ORDER BY day, metal
    """
    day_rows = sqld_query(sqld_url, sqld_token, sql, args=[today_start])
    print(f"  sqld returned {len(day_rows)} day×metal averages.")

    # ── Step 2: merge into year JSON files ────────────────────────────────────
    fresh_by_year = defaultdict(list)
    for row in day_rows:
        day = str(row["day"])           # "YYYY-MM-DD"
        metal_raw = str(row["metal"])   # "gold" etc.
        metal = METAL_DISPLAY.get(metal_raw.lower(), metal_raw.capitalize())
        if metal not in BUNDLE_METALS:
            continue  # unexpected-metal gate — see BUNDLE_METALS
        try:
            price = round_price(float(row["spot"]))
        except (TypeError, ValueError):
            continue
        fresh_by_year[int(day[:4])].append({
            "spot": price,
            "metal": metal,
            "source": "sqld",
            "timestamp": f"{day} 12:00:00",
        })

    for year, fresh in sorted(fresh_by_year.items()):
        existing = load_year_file(year)
        merged = merge_year_entries(existing, fresh)
        if merged == existing:
            print(f"  data/spot-history-{year}.json unchanged")
            continue
        before = {entry_key(e): e for e in existing}
        added = sum(1 for e in merged if entry_key(e) not in before)
        replaced = sum(1 for e in merged if entry_key(e) in before and before[entry_key(e)] != e)
        save_year_file(year, merged)
        print(f"  Updated data/spot-history-{year}.json (+{added} new, {replaced} corrected)")

    # ── Step 3: rebuild bundle from all year JSON files ───────────────────────
    print("Rebuilding bundle from year JSON files ...")
    bundle, total_entries = build_bundle_from_json_files()

    if not bundle:
        print("ERROR: No data found in year JSON files. Nothing to bundle.")
        sys.exit(1)

    all_years = sorted(bundle.keys())
    min_year = all_years[0]

    # Actual max date across all entries in the latest year
    max_date = max(entry_key(e)[0] for e in load_year_file(int(all_years[-1])))

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
    print()
    print("Next: git add data/spot-history-bundle.js data/spot-history-*.json")


if __name__ == "__main__":
    main()
