---
name: repo-boundaries
description: Use when doing any cross-repo work, deploying, or when unsure which repo owns a piece of code. Maps exactly which code belongs in which repo and what each agent is allowed to do. Also use when the words fly deploy, StakTrakrApi, home poller, Portainer, or Docker stack appear in context.
---

# Repo Boundaries

## Repo Ownership Map

| Repo                                                           | Owns                                                                                                                                                                    | Does NOT own                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `lbruton/StakTrakr`                                            | Frontend HTML/JS/CSS, `.claude/` skills, CLAUDE.md, smoke tests, **ALL poller code** (`devops/pollers/`), home-poller Docker configs, tinyproxy/tailscale compose files | Fly.io fly.toml (transitioning), GHA data workflows   |
| `lbruton/StakTrakrApi`                                         | Fly.io fly.toml (legacy, transitioning to StakTrakr), `api` branch data publishing, GHA workflows                                                                       | Frontend code, poller scripts (migrated to StakTrakr) |
| DocVault (`/Volumes/DATA/GitHub/DocVault/Projects/StakTrakr/`) | **Single source of truth** for all project documentation — architecture, patterns, operations, runbooks                                                                 | Code, config, scripts                                 |

> **`stakscrapr` is retired.** Home VM config was previously in a separate repo. All poller code now lives in `StakTrakr/devops/pollers/`.

---

## StakTrakr devops/pollers/ Folder Map

| Folder                                        | Contains                                                                                                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `devops/pollers/shared/`                      | Shared scraper core (both pollers): price-extract.js, capture.js, db.js, turso-client.js, provider-db.js, merge-prices.js, api-export.js, spot-extract.js, goldback-scraper.js, export-providers-json.js, package.json, spot-poller/poller.py |
| `devops/pollers/home-poller/`                 | Home container: Dockerfile, dashboard.js, metrics-exporter.js, run-home.sh, run-fbp.sh, check-flyio.sh, supervisord.conf, docker-entrypoint.sh                                                                                                |
| `devops/pollers/remote-poller/`               | Fly.io container (future migration): Dockerfile, fly.toml, supervisord.conf, docker-entrypoint.sh                                                                                                                                             |
| `devops/pollers/docker-compose.home.yml`      | Home poller stack (Portainer)                                                                                                                                                                                                                 |
| `devops/pollers/docker-compose.tailscale.yml` | Tailscale sidecar stack (Portainer)                                                                                                                                                                                                           |
| `devops/pollers/docker-compose.tinyproxy.yml` | Tinyproxy stack (Portainer)                                                                                                                                                                                                                   |
| `devops/firecrawl-docker/`                    | Self-hosted Firecrawl stack (Portainer)                                                                                                                                                                                                       |

---

## Deploy Rules — Read Before ANY Deploy

| Action                                  | Allowed from                                                                                                  | Forbidden from                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Home poller redeploy                    | Portainer API (`PUT /api/stacks/7/git/redeploy?endpointId=3`)                                                 | Direct file editing on VM, SSH, docker CLI on VM   |
| Tailscale/tinyproxy redeploy            | Portainer API (stacks 8/5)                                                                                    | Direct docker run on VM, SSH                       |
| Firecrawl redeploy                      | Portainer API (stack 4)                                                                                       | Direct docker run on VM, SSH                       |
| `fly deploy` (Fly.io container)         | `StakTrakr/devops/pollers/` on this Mac only (run from `pollers/` dir with `--config remote-poller/fly.toml`) | StakTrakrApi repo (legacy), home VM, anywhere else |
| `git push` to `api` branch (data files) | Fly.io container `run-publish.sh` only — via force-push                                                       | Local Mac, home VM, any GHA, manually              |
| `providers.json` URL fix                | Direct push to `api` branch in `StakTrakrApi`                                                                 | Any other method                                   |

> **NEVER edit files directly on the home VM.** All code deploys from git via Portainer. Changes made via `docker exec` are lost on next redeploy.
> **NEVER run `fly deploy` from the StakTrakrApi repo.** The only valid `fly deploy` path: `cd StakTrakr/devops/pollers && fly deploy --config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile`

---

## Home VM (192.168.1.81) — Docker/Portainer Architecture

> **Access:** Portainer REST API — see `home-infrastructure` skill for full reference (IP, API key, endpoints).

Four Docker stacks on the `staktrakr-net` bridge network, managed by Portainer:

| Stack              | Container                 | Purpose                                           | Ports            |
| ------------------ | ------------------------- | ------------------------------------------------- | ---------------- |
| home-poller (ID 7) | `staktrakr-home-poller`   | Retail/spot/goldback pollers, dashboard, metrics  | 3010, 3011, 9100 |
| firecrawl (ID 4)   | `firecrawl-api` + workers | Web scraping engine                               | 3002             |
| tinyproxy (ID 5)   | `tinyproxy-staktrakr`     | HTTP proxy for Fly.io residential IP routing      | 8888             |
| tailscale (ID 8)   | `tailscale-staktrakr`     | Tailscale network namespace (tinyproxy shares it) | —                |

**Portainer UI:** `https://192.168.1.81:9443` (HTTPS only)
**Docker:** snap-installed. Volume mountpoint: `/var/snap/docker/common/var-lib-docker/volumes/`

---

## Fly.io Container — Current State (Thin Publisher, STAK-478)

**`StakTrakr/devops/pollers/remote-poller/fly.toml`** is the authoritative fly.toml.

- 1024MB RAM, 1 shared CPU, region iad
- Retail and goldback scraping disabled (`RETAIL_ENABLED=0`, `GOLDBACK_ENABLED=0`) — handled by home poller
- Active crons: spot (`0,30`), publish (`8,23,38,53`), provider export (`*/5`)
- Firecrawl/Playwright/Redis/RabbitMQ/PostgreSQL still in image but idle
- Publishes data to `api` branch via `run-publish.sh` (sole Git writer)

---

## Dual-Poller sqld Write-Through

Both pollers write to the same sqld database (`price_snapshots` table). Only Fly.io publishes to GitHub.

| Poller           | POLLER_ID | Writes to | Publishes to Git                                    |
| ---------------- | --------- | --------- | --------------------------------------------------- |
| Fly.io container | `api`     | sqld      | Yes — `run-publish.sh` force-pushes to `api` branch |
| Home container   | `home`    | sqld      | No — never touches git                              |

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
1. Edit files in StakTrakr/devops/pollers/ (shared/ or remote-poller/)
2. Commit and push to dev (or merge PR)
3. cd StakTrakr/devops/pollers
4. fly deploy --config remote-poller/fly.toml --dockerfile remote-poller/Dockerfile
```

> **Migration complete (2026-03-07):** All code now in `StakTrakr/devops/pollers/`. No longer deploy from StakTrakrApi.

**providers.json URL changes** skip deploy entirely — pollers read from Turso on each run.
