# Shared Poller Code

Shared JS modules used by **both** the Home Poller and Fly.io Remote Poller.

## Current Architecture (STAK-478)

**"Shared" does NOT mean both pollers run every file.** The current split:

| File | Home Poller | Fly.io (Thin Publisher) |
|------|:-----------:|:----------------------:|
| `price-extract.js` | Yes (retail scraping) | **No** (retail disabled) |
| `goldback-scraper.js` | Yes | **No** (reads from sqld) |
| `cf-clearance.js` | Yes (Byparr sidecar) | **No** |
| `spot-extract.js` | Yes | Yes |
| `api-export.js` | Yes (local export) | Yes (publish to GitHub Pages) |
| `db.js` | Yes | Yes |
| `provider-db.js` | Yes | Yes |
| `export-providers-json.js` | Yes | Yes |
| `serve.js` | No | Yes (health endpoint) |

**Deployment implications:**
- Changes to `price-extract.js` or `goldback-scraper.js` only need a **Home Poller redeploy** (Portainer stack 7).
- Changes to `api-export.js`, `db.js`, or `spot-extract.js` need **both** Home Poller redeploy AND `fly deploy`.
- See DocVault: [[Home Poller]] and [[Remote Poller]] for deploy commands.
