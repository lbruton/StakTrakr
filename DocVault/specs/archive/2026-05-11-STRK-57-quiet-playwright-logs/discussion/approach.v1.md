---
sketch: "STRK-57-quiet-playwright-logs"
phase: approach
created: 2026-05-11
---

# STRK-57 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Replace the `webServer` command in `playwright.config.js` with an inline Python one-liner that subclasses `SimpleHTTPRequestHandler` and overrides `log_message` to a no-op. All access log lines (`"GET /path HTTP/1.1" 200 -`) are suppressed while the server's startup message (`Serving HTTP on :: port 3000`) is preserved (it's emitted by `TCPServer.server_bind`, not through `log_message`). No wrapper file, no shell pipes, no new dependencies — pure stdlib Python, one config line change.
> CODEX: This is the main architectural smell in the sketch. The repo currently has a plain `command: "python3 -m http.server 3000"` and Playwright already exposes `stderr`/`stdout` controls on `webServer`, so the one-liner is only justified if the human explicitly prefers preserving some classes of HTTP logs. If the goal is simply "make the test output quiet," this design looks heavier and more fragile than the documented config surface.

The one-liner uses Python's `-c` flag with a semicolon-chained import and class definition, then calls `http.server.test()` with the quiet handler. This keeps the fix entirely within `playwright.config.js` — no new files to maintain or forget about.
> GEMINI: Strong recommendation: Use a wrapper script (e.g., `devops/quiet-server.py`). It avoids the double-escaping hell of Python-in-JS-in-Shell and allows for cleaner selective logging (e.g., filtering for 200s while keeping 404s/500s) which would resolve the AC-2 contradiction.
> KIMI: Architectural smell: a ~180-character Python one-liner with a class definition embedded in a JS string literal is fragile. Shell-escaping layers (JS string → shell → Python `-c`) multiply the risk of subtle quote/escape bugs that pass syntax checks but fail at runtime. A 10-line wrapper script in `devops/` or `tests/` would be more maintainable and still satisfy the zero-build constraint.
> CLAUDE: **The entire one-liner approach is unnecessary.** Empirical test confirms: `http.server.test()` prints the startup message to **stdout** (via `print()`), while `log_message()` writes access logs to **stderr**. They are separate streams. Adding `stderr: "ignore"` to the Playwright `webServer` config block suppresses all access log noise while the startup message on stdout remains visible. This is a one-property change to `playwright.config.js` — no Python subclass, no escaping, no wrapper script. It eliminates decisions D-1, D-2, and D-3 entirely, and resolves the AC-2 contradiction (404 log lines are suppressed, but 404 test failures still surface via Playwright assertions). The approach also misattributes the startup message to `TCPServer.server_bind()` — it's actually `http.server.test()` that calls `print()` after bind succeeds (KIMI also noted this at line 67).

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Inline Python one-liner, not a separate wrapper script | One-file change, no new file to maintain, discoverable at the point of config | Command string is long (~180 chars). Acceptable tradeoff for zero-file-count change.
> CODEX: I’d push harder on feasibility here. The real tradeoff is not just length; it is three-layer escaping and the fact that the task acceptance later proposes validating the raw Python snippet instead of the JS config value that Playwright actually executes. That makes this approach easier to "prove" incorrectly.
> GEMINI: The "zero-file-count" benefit is outweighed by the fragility of the one-liner. StakTrakr already has a `devops/` directory; another small utility script there is idiomatic for this project. |
> KIMI: The tradeoff understates the escaping risk. The "~180 chars" refers to the raw Python; inside a JS double-quoted string, quotes and backslashes must be escaped, making the actual config value longer and harder to verify by eye. This is a maintainability concern even for a "single-file" change.
| D-2 | Override `log_message` to no-op, not selective (200-only) filtering | Error status logs (404, 500) are redundant — missing assets cause test failures anyway | Loses visibility into server-side errors during tests, but those errors manifest as test failures regardless
> GEMINI: If we use a wrapper, we can easily keep 404s. Total suppression is a regression in debuggability. |
| D-3 | Keep `stderr` config at default (`"pipe"`), no explicit `stderr` key | Don't mix concerns — the Python-level fix covers all cases while preserving true error output (bind failures, Python stack traces) | If Playwright changes default behavior, logs could return; mitigated by the Python-level fix |
> KIMI: This decision assumes the Python one-liner is the only source of stderr. If the one-liner crashes mid-run, the error goes to stderr and is visible. Good. But it also means any future developer debugging server issues must understand the Python no-op override to know why logs are missing. Acceptable, but adds cognitive load.
> CLAUDE: D-3's rationale ("preserving true error output — bind failures, Python stack traces") overstates the benefit. Bind failures that prevent the server from starting are caught by Playwright's health-check timeout regardless of stderr piping. If the `stderr: "ignore"` approach is adopted, D-3 becomes moot — stderr is explicitly suppressed, and all useful diagnostics come from stdout (startup message) and Playwright's own timeout reporting.
| D-4 | Do not change `reuseExistingServer` or `workers` config | This is a log suppression change, not a test architecture change | N/A |
> CODEX: Keeping `reuseExistingServer` unchanged is reasonable, but the approach should record the consequence: local runs with an existing port-3000 server will not exercise the new behavior. Without that note, verification steps later over-promise what a developer should observe.

## File Map

_Every file this sketch will create, modify, or delete. Tasks.md will reference these paths._

### New
- _(none)_

### Modified
- `playwright.config.js:16` — replace `command:` string with Python one-liner that uses a quiet handler

### Deleted
- _(none)_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes.

## Tradeoffs Surfaced for Review

- The one-liner is long and unfamiliar at first glance, but it's self-contained and zero-file-count. A comment above the `webServer` block can explain what it does and why.
- Suppressing ALL `log_message` output (including error-level) means we lose server-side error visibility. In practice, the Python http.server error messages are either "code 404, message File not found" (already visible as a test failure) or internal errors that would crash the server, which `stderr: "pipe"` would surface anyway.

## Out of Scope (follow-up issues)

- _none_

## Risk Notes

- Risk: Python one-liner syntax error causes server to fail to start → mitigation: test manually before committing (`python3 -c "..."` in terminal)
- Risk: Future Python version changes `http.server` internals → mitigation: the `SimpleHTTPRequestHandler` + `log_message` override pattern has been stable since Python 3.0; risk is low
> CODEX: Missing verification risk: the startup banner is environment-dependent (`::`, `0.0.0.0`, etc.), so tasks that assert the literal `Serving HTTP on :: port 3000` string are brittle. The safer contract is "startup output remains visible" rather than a specific host token.
> GEMINI: Also consider the `reuseExistingServer` risk mentioned in discovery. If the developer has a server on 3000, this fix is invisible.
> KIMI: Missing risk: the startup message "Serving HTTP on :: port 3000" is IPv6-specific. On systems where Python binds to `0.0.0.0`, the message reads "Serving HTTP on 0.0.0.0 port 3000". AC-2 in requirements.md assumes a specific string that may not appear on all platforms (e.g., some Linux containers, CI runners).

> KIMI: Missing risk: local developers with an existing server on port 3000 (from `npm start` or a prior test run) will never see the fix because `reuseExistingServer` skips starting the quiet server. The sketch should document this as a known limitation or add a pre-flight "kill existing server" step.

> KIMI: Minor inaccuracy: the startup message is emitted by `http.server.test()`, not `TCPServer.server_bind()`. The `test()` function prints the message after `server_bind()` succeeds. Not functionally important, but worth correcting for accuracy.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-57`.
