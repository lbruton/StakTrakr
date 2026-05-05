# Spot Price Poller

Automated seed data pipeline for StakTrakr. Fetches daily precious metal spot prices (Gold, Silver, Platinum, Palladium) from [MetalPriceAPI](https://metalpriceapi.com) and writes them to `data/spot-history-{year}.json`.

## How It Works

- **On startup**: Backfills any gap between the last seed data entry and yesterday
- **Every hour**: Polls for today's prices and appends if not already present
- **Output**: Writes directly to the repo's `data/` folder via Docker volume mount

The poller runs in Docker and writes to disk. You commit the updated seed files manually (or let the `/release` workflow handle it).

## Setup

1. Get a free API key from [metalpriceapi.com](https://metalpriceapi.com)
2. Copy the example env file and add your key:

   ```bash
   cp .env.example .env
   # Edit .env and replace your_api_key_here with your actual key
   ```

## Running

From the `devops/spot-poller/` directory:

```bash
# Start the poller (runs in background)
docker compose up -d

# Check status
docker ps --filter "name=stacktrakr-seed-poller"

# View logs
docker logs stacktrakr-seed-poller --tail 20

# Stop
docker compose down
```

Or from the project root:

```bash
docker compose -f devops/spot-poller/docker-compose.yml up -d
```

## One-Shot Backfill

To manually backfill a date range without running the Docker poller:

```bash
# Install dependencies
pip install -r requirements.txt

# Auto-detect gap and fill to today
python3 update-seed-data.py

# Preview without writing
python3 update-seed-data.py --dry-run

# Specific date range
python3 update-seed-data.py --start-date 2026-01-15 --end-date 2026-02-01
```

## Seed Data Format

Each entry in `spot-history-{year}.json`:

```json
{
  "spot": 2898.55,
  "metal": "Gold",
  "source": "seed",
  "provider": "MetalPriceAPI",
  "timestamp": "2026-02-15 12:00:00"
}
```

Prices are in USD per troy ounce. The API returns rates as "units of metal per 1 USD" which are inverted to get $/oz.
