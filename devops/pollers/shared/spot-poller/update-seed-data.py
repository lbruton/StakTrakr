#!/usr/bin/env python3
"""
StakTrakr Seed Data Updater
=============================
Backfills gaps in data/spot-history-{YEAR}.json using MetalPriceAPI's /timeframe endpoint.
One-shot script — run manually, then commit when ready.

Usage:
    python3 update-seed-data.py                    # Auto-detect gap, fill to today
    python3 update-seed-data.py --dry-run           # Preview without writing
    python3 update-seed-data.py --start-date 2026-01-15 --end-date 2026-02-01
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

API_BASE_URL = "https://api.metalpriceapi.com/v1"
TIMEFRAME_ENDPOINT = "/timeframe"
LATEST_ENDPOINT = "/latest"
# MetalPriceAPI returns rates as "units of metal per 1 USD" — we invert to get $/oz.
# Insertion order is the emit order: copper stays LAST so pre-copper consumers keep
# their historical ordering (mirrors METAL_ORDER in shared/spot-metals.js, STRK-303).
# XCU history floor is 2013-07-23 — earlier dates simply return no XCU key.
SYMBOL_TO_METAL = {
    "XAU": "Gold",
    "XAG": "Silver",
    "XPT": "Platinum",
    "XPD": "Palladium",
    "XCU": "Copper",
}

CURRENCIES = ",".join(SYMBOL_TO_METAL)

# Sub-dollar prices keep extra decimals so copper (~$0.41/ozt) doesn't lose ~1%
# to 2dp quantization — mirrors roundPrice() in shared/spot-metals.js (STRK-303).
SUB_DOLLAR_THRESHOLD = 1
DECIMALS_STANDARD = 2
DECIMALS_SUB_DOLLAR = 4

MAX_DAYS_PER_REQUEST = 365

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def load_config():
    """Load API key from environment or devops/.env file."""
    # Check environment first (Docker injects via env_file)
    api_key = os.getenv("METAL_PRICE_API_KEY")
    if not api_key or api_key == "your_api_key_here":
        # Fall back to .env file (local dev usage)
        env_path = Path(__file__).parent / ".env"
        if not env_path.exists():
            print(f"Error: METAL_PRICE_API_KEY not in environment and {env_path} not found.")
            print("Copy .env.example to .env and add your API key.")
            sys.exit(1)
        load_dotenv(env_path)
        api_key = os.getenv("METAL_PRICE_API_KEY")
    if not api_key or api_key == "your_api_key_here":
        print("Error: METAL_PRICE_API_KEY not set in .env (or still placeholder).")
        sys.exit(1)
    return api_key


def resolve_data_dir():
    """Resolve the data/ directory relative to project root or DATA_DIR env var."""
    env_dir = os.getenv("DATA_DIR")
    if env_dir:
        return Path(env_dir)
    # __file__ is devops/pollers/shared/spot-poller/update-seed-data.py, so the
    # repo root is four levels up. parents[2] survived the pre-shared layout and
    # silently pointed at devops/pollers/data/ (nonexistent) after the move.
    data_dir = Path(__file__).resolve().parents[3] / "data"
    if not data_dir.is_dir():
        print(f"Error: resolved data dir {data_dir} does not exist. Set DATA_DIR.")
        sys.exit(1)
    return data_dir

# ---------------------------------------------------------------------------
# Year-file I/O
# ---------------------------------------------------------------------------

def load_year_file(data_dir, year):
    """Load a spot-history-{year}.json file, returning a list (empty if missing)."""
    path = Path(data_dir) / f"spot-history-{year}.json"
    if not path.exists():
        return []
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_year_file(data_dir, year, entries):
    """Write entries to spot-history-{year}.json with compact formatting."""
    path = Path(data_dir) / f"spot-history-{year}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, separators=(", ", ": "))


def save_hourly_file(data_dir, entries, date_obj, hour_str, overwrite=False):
    """
    Write hourly price snapshot to data/hourly/YYYY/MM/DD/HH.json.

    Returns True if written, False if file already exists and overwrite=False.
    Pass overwrite=True to always update (used by live pollers for 15-min freshness).
    """
    hourly_dir = (
        Path(data_dir) / "hourly"
        / str(date_obj.year)
        / f"{date_obj.month:02d}"
        / f"{date_obj.day:02d}"
    )
    hourly_dir.mkdir(parents=True, exist_ok=True)
    path = hourly_dir / f"{hour_str}.json"
    if path.exists() and not overwrite:
        return False
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)
    return True


def save_15min_file(data_dir, entries, date_obj, hour_str, minute_str):
    # No overwrite param — each 15-min slot is a permanent point-in-time snapshot.
    # Unlike hourly files, they are never refreshed by a later poller run.
    """
    Write 15-min price snapshot to data/15min/YYYY/MM/DD/HHMM.json.

    HHMM = zero-padded hour + minute (e.g. "0705", "0720", "0735", "0750").
    hour_str and minute_str must each be zero-padded to two digits (e.g. "07", "05").
    Files are immutable — each poll produces its own permanent snapshot.
    Returns True if written, False if file already exists (idempotent per-poll).
    """
    min_dir = (
        Path(data_dir) / "15min"
        / str(date_obj.year)
        / f"{date_obj.month:02d}"
        / f"{date_obj.day:02d}"
    )
    min_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{hour_str}{minute_str}.json"
    path = min_dir / filename
    if path.exists():
        return False
    with open(path, "w", encoding="utf-8") as f:
        json.dump(entries, f, indent=2)
    return True

# ---------------------------------------------------------------------------
# Gap detection
# ---------------------------------------------------------------------------

def find_latest_date(data_dir):
    """Scan all spot-history-*.json files and return the most recent date as a date object."""
    data_path = Path(data_dir)
    latest = None
    for filepath in sorted(data_path.glob("spot-history-*.json")):
        entries = json.load(open(filepath, "r", encoding="utf-8"))
        for entry in entries:
            ts = entry.get("timestamp", "")
            try:
                dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").date()
                if latest is None or dt > latest:
                    latest = dt
            except ValueError:
                continue
    return latest

# ---------------------------------------------------------------------------
# API interaction
# ---------------------------------------------------------------------------

def fetch_timeframe(api_key, start_date, end_date, currencies=CURRENCIES):
    """
    Call MetalPriceAPI /timeframe endpoint.
    Returns the raw JSON response dict or raises on error.
    Dates are date objects or 'YYYY-MM-DD' strings.
    """
    url = f"{API_BASE_URL}{TIMEFRAME_ENDPOINT}"
    params = {
        "api_key": api_key,
        "start_date": str(start_date),
        "end_date": str(end_date),
        "base": "USD",
        "currencies": currencies,
    }
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success", False):
        error_info = data.get("error", {})
        msg = error_info.get("info", error_info.get("message", "Unknown API error"))
        raise RuntimeError(f"API error: {msg}")
    return data


def fetch_latest(api_key):
    """
    Call MetalPriceAPI /latest endpoint.
    Returns the raw JSON response dict or raises on error.
    """
    url = f"{API_BASE_URL}{LATEST_ENDPOINT}"
    params = {
        "api_key": api_key,
        "base": "USD",
        "currencies": CURRENCIES,
    }
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success", False):
        error_info = data.get("error", {})
        msg = error_info.get("info", error_info.get("message", "Unknown API error"))
        raise RuntimeError(f"API error: {msg}")
    return data

# ---------------------------------------------------------------------------
# Data transformation
# ---------------------------------------------------------------------------

def round_price(price):
    """Round a $/oz price for storage — 4dp below $1 (copper), 2dp otherwise."""
    decimals = DECIMALS_SUB_DOLLAR if price < SUB_DOLLAR_THRESHOLD else DECIMALS_STANDARD
    return round(price, decimals)


def invert_rates(rates_dict):
    """
    Convert API rates (units of metal per 1 USD) to $/oz.
    Input:  {"XAU": 0.000345, "XAG": 0.012, ...}
    Output: {"XAU": 2898.55, "XAG": 83.33, ...}
    """
    return {symbol: round_price(1.0 / rate) for symbol, rate in rates_dict.items() if rate}


def transform_to_seed_format(rates_by_date):
    """
    Convert API timeframe rates into seed-data entries.

    Input format (from /timeframe):
        {"2026-02-12": {"XAU": 0.000345, ...}, "2026-02-13": {...}}

    Output: list of seed entries sorted by timestamp then metal.
    """
    entries = []
    for date_str, symbols in sorted(rates_by_date.items()):
        inverted = invert_rates(symbols)
        for symbol in SYMBOL_TO_METAL:
            if symbol not in inverted:
                continue
            metal = SYMBOL_TO_METAL[symbol]
            entries.append({
                "spot": inverted[symbol],
                "metal": metal,
                "source": "seed",
                "provider": "StakTrakr",
                "timestamp": f"{date_str} 12:00:00",
            })
    return entries


def transform_latest_to_seed(rates, date_str):
    """
    Convert a /latest response's rates into seed entries for a single date.

    Input: {"XAU": 0.000345, "XAG": 0.012, ...}, "2026-02-13"
    Output: list of seed entries, one per metal present in the response
    """
    inverted = invert_rates(rates)
    entries = []
    for symbol in SYMBOL_TO_METAL:
        if symbol not in inverted:
            continue
        metal = SYMBOL_TO_METAL[symbol]
        entries.append({
            "spot": inverted[symbol],
            "metal": metal,
            "source": "seed",
            "provider": "StakTrakr",
            "timestamp": f"{date_str} 12:00:00",
        })
    return entries

# ---------------------------------------------------------------------------
# Merge logic
# ---------------------------------------------------------------------------

def merge_into_year_files(data_dir, new_entries, dry_run=False, overwrite=False):
    """
    Merge new entries into the appropriate year files.
    Deduplicates by (timestamp, metal). Returns a dict of {year: count_added}.

    If overwrite=True, existing entries with the same (timestamp, metal) key
    are replaced with the new values (used for noon seed updates).
    """
    # Group new entries by year
    by_year = {}
    for entry in new_entries:
        year = entry["timestamp"][:4]
        by_year.setdefault(year, []).append(entry)

    results = {}
    for year, entries in sorted(by_year.items()):
        existing = load_year_file(data_dir, year)

        if overwrite:
            # Build lookup of new entries by key
            new_keys = {(e["timestamp"], e["metal"]): e for e in entries}
            # Replace matching entries, keep non-matching ones
            merged = [new_keys.pop((e["timestamp"], e["metal"]), e) for e in existing]
            # Append any new entries that weren't replacements
            remaining = list(new_keys.values())
            merged.extend(remaining)
            count = len(entries)
        else:
            # Build a set of existing (timestamp, metal) keys for dedup
            existing_keys = {(e["timestamp"], e["metal"]) for e in existing}
            # Filter to only truly new entries
            to_add = [e for e in entries if (e["timestamp"], e["metal"]) not in existing_keys]
            if not to_add:
                results[year] = 0
                continue
            merged = existing + to_add
            count = len(to_add)

        # Sort by timestamp, then by metal name for consistent ordering
        merged.sort(key=lambda e: (e["timestamp"], e["metal"]))

        if not dry_run:
            save_year_file(data_dir, year, merged)

        results[year] = count

    return results

# ---------------------------------------------------------------------------
# CLI and main
# ---------------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Backfill StakTrakr seed price data from MetalPriceAPI."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be added without writing files.",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        default=None,
        help="Override start date (YYYY-MM-DD). Default: day after latest seed data.",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default=None,
        help="Override end date (YYYY-MM-DD). Default: today.",
    )
    parser.add_argument(
        "--currencies",
        type=str,
        default=CURRENCIES,
        help=(
            "Comma-separated API symbols to fetch (default: all). Use a single "
            "symbol (e.g. XCU) for one-metal backfills so dedup-merge cannot add "
            "new dates for metals whose history is already frozen."
        ),
    )
    return parser.parse_args()


def main():
    args = parse_args()
    api_key = load_config()
    data_dir = resolve_data_dir()

    print("Seed Data Updater")
    print("=================")

    # Determine date range
    if args.start_date:
        start = datetime.strptime(args.start_date, "%Y-%m-%d").date()
    else:
        latest = find_latest_date(data_dir)
        if latest is None:
            print("Error: No existing seed data found. Use --start-date to specify.")
            sys.exit(1)
        start = latest + timedelta(days=1)
        print(f"Latest data: {latest}")

    end = (
        datetime.strptime(args.end_date, "%Y-%m-%d").date()
        if args.end_date
        else datetime.now().date()
    )

    if start > end:
        print("Already up to date.")
        sys.exit(0)

    days = (end - start).days + 1
    print(f"Fetching: {start} → {end} ({days} day{'s' if days != 1 else ''})")
    if args.dry_run:
        print("(dry run — no files will be modified)")
    print()

    # Fetch in chunks of MAX_DAYS_PER_REQUEST
    all_entries = []
    chunk_start = start
    while chunk_start <= end:
        chunk_end = min(chunk_start + timedelta(days=MAX_DAYS_PER_REQUEST - 1), end)
        print(f"API request: {chunk_start} to {chunk_end} ... ", end="", flush=True)
        try:
            data = fetch_timeframe(api_key, chunk_start, chunk_end, args.currencies)
        except Exception as e:
            print(f"FAILED")
            print(f"  Error: {e}")
            sys.exit(1)

        rates = data.get("rates", {})
        days_returned = len(rates)
        print(f"OK ({days_returned} day{'s' if days_returned != 1 else ''} returned)")

        entries = transform_to_seed_format(rates)
        all_entries.extend(entries)
        chunk_start = chunk_end + timedelta(days=1)

    if not all_entries:
        print("\nNo data returned from API (weekend/holiday gap?).")
        sys.exit(0)

    # Merge into year files
    print()
    results = merge_into_year_files(data_dir, all_entries, dry_run=args.dry_run)

    print("Updated files:" if not args.dry_run else "Would update files:")
    for year, count in sorted(results.items()):
        if count > 0:
            print(f"  spot-history-{year}.json: +{count} entries")
        else:
            print(f"  spot-history-{year}.json: no new entries (already present)")

    total = sum(results.values())
    print(f"\nDone. {total} entries {'added' if not args.dry_run else 'would be added'}.")


if __name__ == "__main__":
    main()
