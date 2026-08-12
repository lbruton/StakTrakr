---
title: "Secret Keys"
project: StakTrakr
audience: agent
canonical: .context/deep-dives/secret-keys.md
source: "DocVault/Projects/StakTrakr/Foundation/Deep Dives/Secret Keys.md" # migrated 2026-08-12
updated: "2026-03-22"
---

# Secret Keys

> This page lists WHERE secrets live, not their values. Never commit secret values.

---

## Secret Stores

| Store                                                              | Used by                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Fly.io secrets** (`fly secrets`)                                 | Fly.io container — all runtime secrets                                         |
| **Infisical** (`stak-trakr-94m4`, env: `dev`)                      | Local development, agent contexts                                              |
| **Home Docker `.env`** (via `docker-compose.home.yml` / Portainer) | Home poller — Docker/Portainer-based deployment, env vars injected via compose |

---

## Fly.io Secrets

Set with `fly secrets set KEY=VALUE --app staktrakr`.

| Secret                | Purpose                                           | Notes                                                  |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `GITHUB_TOKEN`        | Push to `api` branch from `run-publish.sh`        | Needs `contents: write` on `StakTrakrApi`              |
| `TURSO_DATABASE_URL`  | sqld (self-hosted libSQL)                         | `http://192.168.1.81:8080` (via Tailscale from Fly.io) |
| `TURSO_AUTH_TOKEN`    | sqld auth (unused — kept for client compat)       | Can be empty or any value                              |
| `GEMINI_API_KEY`      | Vision pipeline (Gemini API)                      | Google AI Studio                                       |
| `VISION_ENABLED`      | Vision pipeline gate (`1` = on, absent/`0` = off) | `fly secrets set VISION_ENABLED=1` to enable           |
| `METAL_PRICE_API_KEY` | Spot price API                                    | MetalPriceAPI dashboard                                |

### Historical / Full-Image Secrets

These secrets were used by the full retail-scraping Fly.io image and are no longer part of the active slim remote runtime:

| Secret                | Purpose                                                            | Notes                                        |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| `WEBSHARE_PROXY_USER` | Webshare credentials for Playwright fallback / `run-retry.sh`      | Webshare dashboard                           |
| `WEBSHARE_PROXY_PASS` | Webshare credentials for Playwright fallback / `run-retry.sh`      | Webshare dashboard                           |
| `HOME_PROXY_URL_2`    | Playwright service proxy input (home residential IP via Tailscale) | Was set in `fly.toml` env or as Fly secret   |
| `CRON_SCHEDULE`       | Override retail poller cron frequency                              | Was used by `run-local.sh` in the full image |

> **Note:** `run-local.sh` is not part of the active slim remote runtime. `VISION_ENABLED` defaulting off in `run-local.sh` only applied to the full-image deployment.

---

## Infisical (Local Dev)

- **Project:** StakTrakr
- **Project ID:** `319a1db5-207d-49d0-a61d-3f3e6b440ded`
- **Slug:** `stak-trakr-94m4`
- **Environment:** `dev` (production env is empty — all secrets in `dev`)

Contains all secrets mirrored from Cloud - Fly.io plus additional dev-only keys. Access via MCP (`mcp__infisical__*`) or `infisical` CLI.

---

## Home Docker Environment

The home poller runs as a Docker container managed via Portainer, with environment variables defined in `docker-compose.home.yml`. The previous `/opt/poller/.env` path is no longer the active deployment method. Key variables:

```text
TURSO_DATABASE_URL=http://staktrakr-sqld:8080
TURSO_AUTH_TOKEN=
POLLER_ID=home
DATA_DIR=/opt/poller/data

# Nightly DR sync to Turso Cloud free tier
SQLD_URL=http://staktrakr-sqld:8080
TURSO_BACKUP_URL=libsql://staktrakrapi-lbruton.aws-us-east-2.turso.io
TURSO_BACKUP_TOKEN=<turso-cloud-token>
```

Environment variables are configured via `docker-compose.home.yml` and managed through ../../../KnowledgeBase/Infrastructure/Portainer.

---

## Rotating Secrets

### GitHub Token

1. Generate new PAT at github.com → Settings → Developer settings
2. Required scope: `contents: write` on `lbruton/StakTrakrApi`
3. `fly secrets set GITHUB_TOKEN=<new-token> --app staktrakr`
4. Update Infisical dev env

### Turso Auth Token (DR backup only)

Turso Cloud is now a DR backup target only. The `TURSO_BACKUP_TOKEN` is used by the nightly `turso-backup-sync.js` job on the home poller.

1. Turso dashboard → Database → `staktrakrapi` → Create token
2. Update home LXC `.env` (`TURSO_BACKUP_TOKEN`)
3. Update Infisical dev env

### MetalPriceAPI Key

1. MetalPriceAPI dashboard → API Keys
2. `fly secrets set METAL_PRICE_API_KEY=<new-key> --app staktrakr`
3. Update Infisical dev env

### Webshare Proxy (historical — not used by slim image)

1. Webshare dashboard → Proxy users
2. `fly secrets set WEBSHARE_PROXY_USER=<user> WEBSHARE_PROXY_PASS=<pass> --app staktrakr`
3. Update Infisical dev env

### Gemini API Key

1. Google AI Studio → API Keys
2. `fly secrets set GEMINI_API_KEY=<new-key> --app staktrakr`
3. Update Infisical dev env

---

## Verifying Secrets Are Set

```bash
# List Fly secrets (names only, not values)
fly secrets list --app staktrakr

# Verify a specific secret is accessible inside container
fly ssh console --app staktrakr -C "printenv TURSO_DATABASE_URL"
```

---

## Related

- Remote Poller — environment variables and their purposes
- Cloud - Fly.io — Fly.io secret management commands
- ../../../KnowledgeBase/Infrastructure/Portainer — home VM where LXC `.env` is configured
- Architecture — which components use which secrets
