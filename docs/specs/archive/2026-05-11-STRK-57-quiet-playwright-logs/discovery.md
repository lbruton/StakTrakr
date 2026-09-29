---
sketch: "STRK-57-quiet-playwright-logs"
phase: discovery
created: 2026-05-11
revised: 2026-05-11
supersedes: discussion/discovery.v1.md
---

# STRK-57 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| `playwright.config.js:15-19` | Playwright `webServer` config block | Current command: `python3 -m http.server 3000`. No `stderr` or `stdout` key configured. `reuseExistingServer: !process.env.CI` (CI starts fresh; local reuses any server already bound to :3000). |
| `playwright.config.js:16` | webServer command string | The command itself is unremarkable; the noise comes from Playwright's default stderr handling combined with Python's default access logging. |
| `node_modules/playwright/lib/plugins/webServerPlugin.js:126,130` | Playwright's webServer stdio handling | Verified in the installed `@playwright/test@1.59.1` binary (`npx playwright --version` and `npm ls @playwright/test playwright` on 2026-05-11): stdout is surfaced **only** when `stdout === "pipe"` is explicitly set (default: hidden); stderr is surfaced when `stderr === "pipe"` OR when `!_options.stderr` (default: surfaced). This is the root mechanism producing `[WebServer]` lines in test output. |
| `package.json`, `package-lock.json`, `node_modules/@playwright/test/package.json` | Playwright version source check | `package.json` allows `@playwright/test` `^1.51.0`; `package-lock.json` currently records `1.58.2`; installed `node_modules` currently reports `1.59.1`. No Playwright upgrade is needed for this sketch because `webServer.stderr` exists in 1.43+ and is supported by both versions. |
| `python3 -m http.server` | stdlib HTTP server | Startup banner (`"Serving HTTP on … port 3000 …"`) is written to **stdout** via `print()` in `http.server.test()`. Access logs (200, 404, etc.) are written to **stderr** via `BaseHTTPRequestHandler.log_message()`. The two streams are independent. |
| `AGENTS.md:19`, `GEMINI.md:16`, `README.md:239` | Dev server docs | Document `python3 -m http.server 8000` for local dev (port 8000, different from test port 3000). Same command pattern but unrelated to test-harness noise. |

## Empirical findings (this session)

Verified by running `python3 -u -m http.server <PORT> --bind 127.0.0.1` with split redirection (`>stdout 2>stderr`) and inspecting the files:

- Startup line `"Serving HTTP on 127.0.0.1 port 8766 (http://127.0.0.1:8766/) ..."` appears in **stdout** only.
- Access log lines (`127.0.0.1 - - [...] "GET / HTTP/1.1" 200 -`) appear in **stderr** only.
- 404 lines (both the `code 404, message File not found` annotation and the `"GET /missing HTTP/1.1" 404 -` access line) appear in **stderr** only.
- A single 12-test spec file (`tests/playwright/01-page-load/page-load.spec.js`) produces 35+ `[WebServer]` lines in Playwright's surfaced output; the current suite list contains 599 tests in 53 files and produces hundreds of access-log lines before this change.

This empirically confirms that suppressing stderr alone — without touching Python's log_message behavior — removes the noise without affecting the startup banner's stream.

## Prior Decisions

- _None found — first time touching this test harness surface in mem0 or recent session history._

## External References

- [Python `http.server` — `BaseHTTPRequestHandler.log_message()`](https://docs.python.org/3/library/http.server.html#http.server.BaseHTTPRequestHandler.log_message) — writes access logs to `sys.stderr`. Overridable in a subclass.
- [Playwright `webServer` config](https://playwright.dev/docs/test-webserver) — documents `stderr` and `stdout` options accepting `"pipe"` or `"ignore"` (added in Playwright 1.43; the installed local toolchain reports 1.59.1, while the lockfile records 1.58.2).
- [Playwright `reuseExistingServer`](https://playwright.dev/docs/test-webserver#reuse-existing-server) — when `true`, Playwright assumes a server is already running and does not start one; any `webServer.stderr` config is therefore inert in that mode.

## Constraints

- Preserve the zero-build guarantee — no `express`, no `http-server` package, no npm-installed dev server
- No Python dependencies outside stdlib
- Must not alter any test file or test behavior
- Must work on both macOS (local dev) and Linux (CI)
- Python 3.x required (`python3` command — current project assumption, not introduced here)
- Must not require new wrapper scripts or new files in `devops/` for a single-property config change

## Discovery Summary

The noise has a single root cause: Playwright's default `stderr: "pipe"` behavior surfaces every line `python3 -m http.server` writes to stderr, which includes one access-log entry per static asset request. The Python startup banner and Python access logs travel on **separate streams** (stdout vs stderr) — empirically confirmed in this session by running the server with split redirection. This means the noise can be eliminated by configuring Playwright's stderr handling alone, with no Python-level subclassing, no wrapper script, no shell escaping, and no change to test behavior. The fix surface is one property in one file (`playwright.config.js`).

One known limitation lives outside the chosen mechanism: when `reuseExistingServer` is true (local dev, not CI) and a server is already on port 3000, Playwright reuses it and any config change here has no effect. Documented in requirements.md Non-Goals as an intentional out-of-scope item.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced. Open questions resolved. Then advance: `/sketch approach STRK-57`.
