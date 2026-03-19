---
name: repo-boundaries
description: Use when doing any cross-repo work, deploying, or when unsure which repo owns a piece of code. Maps exactly which code belongs in which repo and what each agent is allowed to do. Also use when the words fly deploy, StakTrakrApi, home poller, Portainer, or Docker stack appear in context.
---

# Repo Boundaries

## Repo Ownership Map

| Repo | Owns | Does NOT own |
|------|------|--------------|
| `lbruton/StakTrakr` | Frontend HTML/JS/CSS, `.claude/` skills, CLAUDE.md, smoke tests, **ALL poller code** (`devops/pollers/`), home-poller Docker configs, tinyproxy/tailscale compose files | Fly.io fly.toml (transitioning), GHA data workflows |
| `lbruton/StakTrakrApi` | Fly.io fly.toml (legacy, transitioning to StakTrakr), `api` branch data publishing, GHA workflows | Frontend code, poller scripts (migrated to StakTrakr) |
| `StakTrakr/wiki/` (in-repo) | **Single source of truth** for all project documentation — architecture, patterns, operations, runbooks. Lookup: `mcp__claude-context__search_code` with `path: /Volumes/DATA/GitHub/StakTrakr/wiki` | Code, config, scripts |

> **`stakscrapr` is retired.** Home VM config was previously in a separate repo. All poller code now lives in `StakTrakr/devops/pollers/`.

---

## StakTrakr devops/pollers/ Folder Map

| Folder | Contains |
|--------|---------|
| `devops/pollers/shared/` | Shared scraper core (both pollers): price-extract.js, capture.js, db.js, turso-client.js, provider-db.js, merge-prices.js, api-export.js, spot-extract.js, goldback-scraper.js, export-providers-json.js, package.json, spot-poller/poller.py |
| `devops/pollers/home-poller/` | Home container: Dockerfile, dashboard.js, metrics-exporter.js, run-home.sh, run-fbp.sh, check-flyio.sh, supervisord.conf, docker-entrypoint.sh |
| `devops/pollers/remote-poller/` | Fly.io container (future migration): Dockerfile, fly.toml, supervisord.conf, docker-entrypoint.sh |
| `devops/pollers/docker-compose.home.yml` | Home poller stack (Portainer) |
| `devops/pollers/docker-compose.tailscale.yml` | Tailscale sidecar stack (Portainer) |
| `devops/pollers/docker-compose.tinyproxy.yml` | Tinyproxy stack (Portainer) |
| `devops/firecrawl-docker/` | Self-hosted Firecrawl stack (Portainer) |

---

## Deploy Rules — Read Before ANY Deploy

| Action | Allowed from | Forbidden from |
|--------|-------------|----------------|
| Home poller redeploy | Portainer API (`PUT /api/stacks/7/git/redeploy?endpointId=3`) | Direct file editing on VM, SSH, docker CLI on VM |
| Tailscale/tinyproxy redeploy | Portainer API (stacks 8/5) | Direct docker run on VM, SSH |
| Firecrawl redeploy | Portainer API (stack 4) | Direct docker run on VM, SSH |
| `fly deploy` (Fly.io container) | `StakTrakrApi/devops/fly-poller/` on this Mac only | StakTrakr repo, home VM, anywhere else |
| `git push` to `api` branch (data files) | Fly.io container `run-publish.sh` only — via force-push | Local Mac, home VM, any GHA, manually |
| `providers.json` URL fix | Direct push to `api` branch in `StakTrakrApi` | Any other method |

> **NEVER edit files directly on the home VM.** All code deploys from git via Portainer. Changes made via `docker exec` are lost on next redeploy.
> **NEVER run `fly deploy` from the StakTrakr repo.** The only valid `fly deploy` path: `cd /path/to/StakTrakrApi/devops/fly-poller && fly deploy`

---

## Home VM (192.168.1.81) — Docker/Portainer Architecture

> **Access:** Portainer REST API — see `home-infrastructure` skill for full reference (IP, API key, endpoints).

Four Docker stacks on the `staktrakr-net` bridge network, managed by Portainer:

| Stack | Container | Purpose | Ports |
|-------|-----------|---------|-------|
| home-poller (ID 7) | `staktrakr-home-poller` | Retail/spot/goldback pollers, dashboard, metrics | 3010, 3011, 9100 |
| firecrawl (ID 4) | `firecrawl-api` + workers | Web scraping engine | 3002 |
| tinyproxy (ID 5) | `tinyproxy-staktrakr` | HTTP proxy for Fly.io residential IP routing | 8888 |
| tailscale (ID 8) | `tailscale-staktrakr` | Tailscale network namespace (tinyproxy shares it) | — |

**Portainer UI:** `https://192.168.1.81:9443` (HTTPS only)
**Docker:** snap-installed. Volume mountpoint: `/var/snap/docker/common/var-lib-docker/volumes/`

---

## Fly.io Container — Current State

**`StakTrakrApi/devops/fly-poller/fly.toml`** is the authoritative fly.toml (transitioning to `StakTrakr/devops/pollers/remote-poller/`).

- 4096MB RAM, 4 shared CPUs, region dfw
- Supervisord runs: redis, rabbitmq, postgres, playwright-service, firecrawl-api, firecrawl-worker, firecrawl-extract-worker, cron, http-server
- Publishes data to `api` branch via `run-publish.sh`

---

## Dual-Poller sqld Write-Through

Both pollers write to the same sqld database (`price_snapshots` table). Only Fly.io publishes to GitHub.

| Poller | POLLER_ID | Writes to | Publishes to Git |
|--------|-----------|-----------|-----------------|
| Fly.io container | `api` | sqld | Yes — `run-publish.sh` force-pushes to `api` branch |
| Home container | `home` | sqld | No — never touches git |

`readLatestPerVendor(db, coinSlug, lookbackHours=2)` — most recent row per vendor within 2h wins at publish time.

---

## Change Gate: Home Poller Change

```
1. Edit files in StakTrakr/devops/pollers/ (shared/ or home-poller/)
2. Commit and push to branch
3. Redeploy via Portainer API (see sync-poller skill)
4. Verify container health via SSH
```

## Change Gate: Fly.io Container Change

```
1. Edit shared files in StakTrakr/devops/pollers/shared/
   (or Fly-specific files in StakTrakrApi/devops/fly-poller/ until migration complete)
2. For shared files: copy to StakTrakrApi/devops/fly-poller/ (temporary — until remote-poller migration)
3. Open PR to StakTrakrApi main
4. Review + merge
5. cd StakTrakrApi/devops/fly-poller && fly deploy
```

**providers.json URL changes** skip steps 2-5 entirely — push directly to `api` branch.
