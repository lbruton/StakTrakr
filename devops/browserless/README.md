# Browserless — Self-Hosted Headless Chrome

Browserless provides a self-hosted headless Chromium instance for running scripted Playwright tests locally. It exposes a WebSocket endpoint that Playwright connects to instead of launching a local browser process.

## Backend split

| Backend                      | Used for                               | Config                        |
| ---------------------------- | -------------------------------------- | ----------------------------- |
| `browserless` (this service) | Scripted Playwright specs              | `BROWSER_BACKEND=browserless` |
| Browserbase (cloud)          | Natural-language Stagehand / MCP flows | `BROWSER_BACKEND=browserbase` |

## Start the service

```sh
cp .env.example .env
docker compose up -d
```

## Verify

The WebSocket endpoint for Playwright (v2 API):

```
ws://localhost:3000/chromium/playwright?token=local_dev_token
```

Confirm the service started:

```sh
docker logs staktrakr-browserless --tail 5
```

## Running tests

Against the Cloudflare Pages dev deployment:

```sh
BROWSER_BACKEND=browserless TEST_URL=https://dev.stacktrackr.pages.dev npm run test:smoke
```

Against a local dev server — use `host.docker.internal` (not `127.0.0.1`) so the
browser running inside Docker can reach the host machine:

```sh
npx http-server . -p 8765 --silent &
BROWSER_BACKEND=browserless TEST_URL=http://host.docker.internal:8765 npm run test:smoke
```

## Stop the service

```sh
docker compose down
```

## Configuration

| Variable            | Default           | Description                                        |
| ------------------- | ----------------- | -------------------------------------------------- |
| `BROWSERLESS_TOKEN` | `local_dev_token` | Auth token required in Playwright `wsEndpoint` URL |
| `CONCURRENT`        | `5`               | Max simultaneous browser sessions                  |
| `QUEUED`            | `10`              | Max queued sessions before rejection               |
| `TIMEOUT`           | `120000`          | Session timeout in milliseconds                    |
