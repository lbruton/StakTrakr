---
sketch: "STRK-57-quiet-playwright-logs"
phase: discovery
created: 2026-05-11
---

# STRK-57 — Discovery

_Research the existing system and prior art. **Don't propose solutions** — that's the next phase._

## Existing Code

| Path | Role | Notes |
|------|------|-------|
| `playwright.config.js:15-19` | Playwright webServer config | `command: "python3 -m http.server 3000"` — the source of the noise. Port 3000, `reuseExistingServer: !process.env.CI`. In CI (`process.env.CI`), Playwright starts the server fresh; locally, it reuses any server already on port 3000. |
| `playwright.config.js:16` | webServer command string | No `stderr` key configured — uses Playwright default `"pipe"`. **Live test shows `"pipe"` does NOT suppress stderr** — `[WebServer]` access log lines are interleaved with test output throughout the ENTIRE run, not just during startup. |
| `python3 -m http.server` | Built-in Python HTTP server | No `-q` or `--quiet` flag (confirmed via `python3 -m http.server --help`). Access logging comes from `BaseHTTPRequestHandler.log_message()` writing to `sys.stderr`. Format: `127.0.0.1 - - [timestamp] "GET /path HTTP/1.1" 200 -`. |
| `AGENTS.md:19`, `GEMINI.md:16`, `README.md:239` | Dev server docs | All document `python3 -m http.server 8000` as the local dev server. Not the cause of test noise (tests use port 3000), but same command pattern. |
> CODEX: One more repo-grounded constraint to surface here: because `reuseExistingServer` is already enabled locally, this sketch only improves runs where Playwright actually starts the server. That means the local-dev value is partial by design unless the sketch also documents the precondition that port 3000 must be free.
> KIMI: Missing edge case: when `reuseExistingServer: true` (local dev, not CI), Playwright will NOT start the new quiet server if port 3000 is already occupied by a previous dev server or test run. The noise reduction is silently bypassed unless the developer manually kills the existing server first. This undermines the local-dev goal and should be surfaced.
> GEMINI: The bypass risk for local developers is significant. If port 3000 is occupied, Playwright reuses it without starting our "quiet" server, leaving the user with the same noise they had before. We should consider adding a "kill-port" check or recommending developers kill existing servers in the README/AGENTS.md.

## Prior Decisions

_Search mem0 and recent sessions for related decisions. Quote the relevant memory or commit, with date._

- _none found — first time touching this test harness surface._

## External References

- [Python `http.server` — BaseHTTPRequestHandler.log_message()](https://docs.python.org/3/library/http.server.html#http.server.BaseHTTPRequestHandler.log_message) — the method that writes access log lines to `sys.stderr`. Overridable in a subclass.
- [Playwright `webServer` config — `stderr` option](https://playwright.dev/docs/test-webserver) — `"pipe"` (default) pipes stderr from the process and shows it only if the server fails to respond to the `url` health check. `"ignore"` silences it entirely.
> CLAUDE: **Pivotal error.** `"ignore"` silences *stderr* entirely — it does NOT silence stdout. The Python `http.server.test()` startup message (`"Serving HTTP on :: port 3000"`) is emitted via `print()` to **stdout**, while `log_message()` writes access logs to **stderr**. Verified empirically: `python3 -c "..." > stdout.txt 2> stderr.txt` shows the startup message in stdout and access logs in stderr. This means `stderr: "ignore"` achieves the stated goal (suppress access logs, preserve startup message) as a one-property config change — no Python subclass needed. The entire approach is built on the false premise that startup and access logs share the same stream.
- [Playwright `webServer` — `reuseExistingServer`](https://playwright.dev/docs/test-webserver#reuse-existing-server) — when `true`, Playwright does not start the server; it assumes one is already running on the configured `url`.

## Constraints

- Must preserve the zero-build guarantee — no npm server, no `express`, no `http-server` package
- Must not add Python dependencies outside stdlib
- Must preserve server startup confirmation and error output (404s, bind failures, port-in-use errors)
- Must not change test behavior — all existing Playwright tests must continue to pass
- Must work on both macOS (local dev) and Linux (CI)
- Python 3.x required (`python3` command)
- Must work with `reuseExistingServer` mode — the fix should apply when Playwright starts the server
> CODEX: I’d split this constraint in two. "Preserve startup/bind-failure visibility" is well-supported by the current tooling, but "preserve 404 output" is not compatible with the one-liner path currently described in approach.md. Keeping both under one bullet hides the actual decision the human still needs to make.
> KIMI: Missing constraint: shell quoting / escaping within the JS config string. An inline Python one-liner containing quotes, backslashes, and semicolons will need careful escaping inside a JS double-quoted string. This is a real feasibility risk not captured in constraints.
> GEMINI: The escaping risk is high. Python one-liners inside JS strings are notoriously hard to debug. A wrapper script in `devops/` would simplify the config and make the logic more readable.

## Open Questions

_Things that need answering before approach.md can be written. If non-empty, stop here and resolve with the user._

- [x] **Where exactly is the noise coming from?** **RESOLVED.** Live test run confirmed: `stderr: "pipe"` (the default) does NOT suppress server access logs. The `[WebServer]` lines appear interleaved with test output for EVERY static asset request throughout the entire run — 35+ lines for just one page load. The Python `http.server` writes every `GET` to stderr via `log_message()`, and Playwright surfaces all stderr with a `[WebServer]` prefix.
- [x] **What noise level does the current setup actually produce?** **RESOLVED.** 35+ `[WebServer]` lines for a single 12-test spec file. For the full 278-test suite, this balloons to hundreds of noise lines. Each line has format: `[WebServer] ::1 - - [timestamp] "GET /path HTTP/1.1" 200 -`.
- [x] **Are 404s important to see?** **RESOLVED.** All observed lines are `200` responses. A 404 on a critical JS file would cause a test failure anyway (function-not-found-on-window), making the 404 log redundant. The startup confirmation (`Serving HTTP on :: port 3000`) however IS useful. Decision: suppress all access log lines (200 + 404 alike), preserve only the non-request stderr output (startup message, bind errors, stack traces).
> CODEX: This "resolved" decision is doing approach work. Discovery has enough evidence to say 404s were not observed in the sampled run and that missing assets are likely to fail loudly at the test layer, but deciding that 404 logs are therefore expendable is still a product/debuggability tradeoff and belongs in approach.md.
> CLAUDE: **Misclassification of the startup message.** The resolution says "preserve only the non-request stderr output (startup message, bind errors, stack traces)" — but the startup message is NOT stderr output. It goes to stdout via `print()` in `http.server.test()`. Bind errors that crash the server also produce stderr tracebacks, but those would cause Playwright's health-check to timeout and report the failure regardless. The practical distinction: suppressing all stderr (via Playwright `stderr: "ignore"`) loses nothing useful — startup message is on stdout, and server crashes are caught by health-check timeout.

## Discovery Summary

Live test run confirmed the noise is real and pervasive. A 12-test spec file produced 35+ `[WebServer]` access log lines; the full 278-test suite generates hundreds. The noise comes from Python's `BaseHTTPRequestHandler.log_message()` writing every `GET` to stderr, which Playwright surfaces with `[WebServer]` prefix throughout the entire run. Playwright's `stderr: "pipe"` default does NOT suppress this — it only suppresses stderr if the server fails health-check startup, but routes it to the terminal otherwise. All observed log lines are `200` responses. 404s would be redundant since missing assets cause test failures anyway. The fix is confined to one file (`playwright.config.js`): either the `command:` string or an added `stderr:` config. Zero impact on product code or tests.
> KIMI: The summary pre-commits to two options ("either the `command:` string or an added `stderr:` config"), but the approach phase later chooses the Python one-liner and never formally rejects the `stderr:` route. Not a bug, but the summary should not present undecided options as if both are viable when the approach phase narrows to one.
> GEMINI: Agreed. We should pick one path in the approach rather than leaving both as "either/or" in the discovery summary if the decision is already leaning one way.

---

> **Phase complete?** Existing code mapped. Prior decisions surfaced.
> GEMINI: The bypass risk for local developers is significant. If port 3000 is occupied, Playwright reuses it without starting our "quiet" server, leaving the user with the same noise they had before. We should consider adding a "kill-port" check or recommending developers kill existing servers in the README/AGENTS.md. Open questions resolved. Then advance: `/sketch approach STRK-57`.
