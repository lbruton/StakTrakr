---
name: firecrawl-infra
description: Use when managing the local Firecrawl Docker stack — starting, stopping, troubleshooting containers, checking health, updating images, or understanding how Firecrawl fits into the scraping infrastructure. Also use when deciding whether to use self-hosted vs cloud Firecrawl.
---

# Firecrawl Infrastructure

Local self-hosted Firecrawl stack for development and script testing. Mirrors the production setup in StakTrakrApi so scripts can be validated locally before deploying to Fly.io or the home-poller container on the Portainer VM.

---

## Two Firecrawl Paths

| Path                                    | Backend        | Endpoint                    | Credits       | Use When                                                             |
| --------------------------------------- | -------------- | --------------------------- | ------------- | -------------------------------------------------------------------- |
| **Self-hosted** (`firecrawl-local` MCP) | Docker on Mac  | `http://localhost:3002`     | Unlimited     | Script testing, retail poller dev, bulk scraping, provider debugging |
| **Cloud** (`firecrawl` CLI plugin)      | Firecrawl SaaS | `https://api.firecrawl.dev` | Pay-as-you-go | Quick web searches, doc lookups, one-off scrapes                     |

**Default to self-hosted** for any repeated or automated scraping. Cloud is for ad-hoc research only.

---

## Docker Stack

Location: `devops/firecrawl-docker/`

### Services (6 containers)

| Container              | Image                                         | Role                              | Port |
| ---------------------- | --------------------------------------------- | --------------------------------- | ---- |
| `firecrawl-api`        | `ghcr.io/firecrawl/firecrawl:latest`          | HTTP API server                   | 3002 |
| `firecrawl-worker`     | `ghcr.io/firecrawl/firecrawl:latest`          | Async crawl/extract worker        | -    |
| `firecrawl-playwright` | `ghcr.io/firecrawl/playwright-service:latest` | Headless browser for JS rendering | -    |
| `firecrawl-redis`      | `redis:alpine`                                | Job queue + rate limiting         | -    |
| `firecrawl-rabbitmq`   | `rabbitmq:3-management`                       | NuQ message queue                 | -    |
| `firecrawl-postgres`   | Custom (`nuq-postgres/`)                      | NuQ persistence (pg_cron enabled) | -    |

### Start / Stop / Restart

```bash
# Start
cd devops/firecrawl-docker && docker compose up -d

# Stop (preserves volumes)
cd devops/firecrawl-docker && docker compose down

# Full reset (removes volumes — loses queue state)
cd devops/firecrawl-docker && docker compose down -v

# Restart just the API (after config changes)
docker restart firecrawl-api

# Pull latest images
cd devops/firecrawl-docker && docker compose pull && docker compose up -d
```

### Health Check

```bash
# API responding?
curl -s http://localhost:3002/ | python3 -c "import json,sys; print(json.load(sys.stdin))"

# All containers running?
docker ps --filter "name=firecrawl" --format "table {{.Names}}\t{{.Status}}"

# Test a scrape
curl -s -X POST http://localhost:3002/v1/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fc-local-dev" \
  -d '{"url": "https://example.com"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('OK' if d.get('success') else 'FAIL')"
```

### Known Startup Race Condition

On cold start, the API container may fail with `Port 3002 did not become available within 60000ms`. This happens because NuQ workers grab the port before the HTTP server starts. The `restart: unless-stopped` policy auto-recovers within ~60 seconds. On warm restarts (Redis/Postgres already healthy), it starts cleanly.

---

## Configuration

### .env (devops/firecrawl-docker/.env)

| Variable                | Required | Purpose                                          |
| ----------------------- | -------- | ------------------------------------------------ |
| `PORT`                  | Yes      | API port (3002)                                  |
| `HOST`                  | Yes      | Bind address (0.0.0.0)                           |
| `USE_DB_AUTHENTICATION` | Yes      | Must be `false` for local dev                    |
| `BULL_AUTH_KEY`         | No       | Protects Bull queue admin UI                     |
| `OPENAI_API_KEY`        | No       | Needed for /extract API and JSON format scraping |
| `GEMINI_API_KEY`        | No       | Vision-based extraction                          |

### MCP Server Config (~/.claude/.mcp.json)

```json
"firecrawl-local": {
  "command": "npx",
  "args": ["-y", "firecrawl-mcp"],
  "env": {
    "FIRECRAWL_API_URL": "http://localhost:3002",
    "FIRECRAWL_API_KEY": "fc-local-dev"
  }
}
```

The `fc-local-dev` key is arbitrary — auth is disabled locally (`USE_DB_AUTHENTICATION=false`).

---

## Relationship to Production

```
LOCAL (this stack)              PRODUCTION
devops/firecrawl-docker/   -->  StakTrakrApi/devops/firecrawl-docker/
  docker-compose.yml              docker-compose.yml (+ retail-poller service)
  .env                            .env (+ production keys)
  nuq-postgres/                   nuq-postgres/ (identical)
```

**Key differences from production:**

- No `retail-poller` service (that's StakTrakrApi's concern)
- No volume mount to `staktrakr-data` worktree
- Auth disabled (`USE_DB_AUTHENTICATION=false`)
- Same images, same ports, same internal networking

**Testing workflow:** Write/modify scraping scripts locally against `localhost:3002`, validate results, then deploy the same scripts to Fly.io or portainer where they hit the production Firecrawl instance.

---

## Troubleshooting

### API returns connection refused

```bash
docker logs firecrawl-api --tail 30 2>&1 | grep -E "error|fatal|listen"
```

Usually the startup race — wait 60s or `docker restart firecrawl-api`.

### Scrape returns empty content

1. Check playwright-service is running: `docker ps --filter name=firecrawl-playwright`
2. Check the page needs JS rendering — add `waitFor: 5000` to the scrape request
3. Check API logs for errors: `docker logs firecrawl-api --tail 50`

### Worker not processing async jobs

```bash
# Check worker logs
docker logs firecrawl-worker --tail 30

# Check RabbitMQ management UI
docker logs firecrawl-rabbitmq --tail 10

# Restart worker
docker restart firecrawl-worker
```

### Redis connection errors

```bash
docker exec firecrawl-redis redis-cli ping
# Should return PONG
```

### Full stack reset

```bash
cd devops/firecrawl-docker && docker compose down -v && docker compose up -d
```

This nukes all queued jobs and Postgres data — safe for local dev.

---

## Dispatching the Scraper Subagent

For actual scraping tasks, dispatch the `firecrawl-scraper` subagent rather than scraping in the main context. The subagent has full knowledge of the MCP tools and returns distilled results.

```
Agent(subagent_type="firecrawl-scraper", prompt="Scrape https://example.com/pricing and extract the plan names and prices as a markdown table")
```

See `~/.claude/agents/firecrawl-scraper.md` for the subagent definition.
