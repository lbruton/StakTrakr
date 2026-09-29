---
sketch: "STRK-57-quiet-playwright-logs"
phase: approach
created: 2026-05-11
revised: 2026-05-11
supersedes: discussion/approach.v1.md
---

# STRK-57 — Approach

_How we'll build it. **Don't write code or tests** — the tasks phase produces the work plan._

## High-Level Architecture

Add `stderr: "ignore"` to the `webServer` config block in `playwright.config.js`. That single property tells Playwright to drop the child process's stderr stream instead of forwarding it to the test reporter — which is the only place `[WebServer]` access log lines come from. The `command` string stays exactly as it is today (`python3 -m http.server 3000`). No Python subclassing, no inline `-c` one-liner, no wrapper script, no shell escaping.

The discovery phase empirically verified that Python's `http.server` writes its startup banner to stdout and its access logs to stderr as **independent streams**, so suppressing stderr removes the noise without altering anything else about the server. Playwright's default behavior is already to ignore the child's stdout (verified in `node_modules/playwright/lib/plugins/webServerPlugin.js:126`), so no `stdout` key is needed.

Server-failure signal is preserved by a different mechanism: if `python3 -m http.server` fails to bind, no HTTP traffic responds on `http://localhost:3000`, and Playwright's `url` health check times out and reports the failure through the test reporter. We rely on Playwright's existing health-check path rather than on stderr forwarding for that signal.

## Key Decisions

| # | Decision | Rationale | Tradeoff |
|---|----------|-----------|----------|
| D-1 | Use Playwright's `webServer.stderr: "ignore"` option, not a Python wrapper or one-liner | Documented Playwright config surface (1.43+; installed local toolchain reports 1.59.1 and the lockfile records 1.58.2, both sufficient). One property, no escaping, no new files. Empirical: the only source of noise is stderr; the only stream the user currently sees from the child is stderr. | None material — see D-3 for the only meaningful loss. |
| D-2 | Leave `command:` exactly as `"python3 -m http.server 3000"` | The Python invocation isn't the problem and doesn't need to change. Changing it would expand the surface for breakage on different Python versions, platforms, or shell quoting. | None — keeps the diff minimal and the original behavior identical for anyone running the command outside Playwright. |
| D-3 | Accept loss of Python's stderr 404 / error-message lines | Missing assets cause Playwright test failures (function-not-found-on-window, assertion failures, etc.) that surface the problem at a more actionable layer than a raw stderr line. Server crashes that take down the process surface via Playwright's `url` health-check timeout. | A developer staring at Playwright output won't see a literal `code 404, message File not found` for a missing asset; they'll see the test failure that depends on it. Acceptable — the test failure is the higher-signal artifact. |
| D-4 | Do not change `reuseExistingServer`, `workers`, `command`, or anything else in the `webServer` block | This is a log suppression change, not a test architecture change. | Local devs with a stale server bound to :3000 still see the old noise (Playwright reuses the running server unchanged). Documented as a Non-Goal in requirements.md. |

## File Map

### New
- _(none)_

### Modified
- `playwright.config.js:15-19` — add `stderr: "ignore",` as a new property inside the `webServer` object

### Deleted
- _(none)_

## Data / Schema Changes

None — no schema, migration, or persisted-data changes.

## Tradeoffs Surfaced for Review

- **Loss of stderr 404 visibility.** Accepted: tests catch the failure at a more useful layer. (D-3.)
- **`reuseExistingServer` bypass.** When a developer already has a server on :3000 in local dev, Playwright reuses it and the fix has no effect. Out of scope for this sketch (requirements.md Non-Goals); a developer seeing residual noise should `lsof -i :3000` and kill the stray server. Adding a kill-stale-server preflight is a separate change with its own usability tradeoffs (e.g., killing a server the developer intentionally launched). Defer.

## Out of Scope (follow-up issues)

- _(none today — `reuseExistingServer` preflight is mentioned in non-goals; can be filed as a follow-up if local dev pain becomes recurring)_

## Risk Notes

- **Risk:** Playwright changes `webServer.stderr` semantics in a future major version. **Mitigation:** option is documented and stable since 1.43; behavior is "drop the stream," which is mechanically simple and unlikely to drift. No Playwright upgrade is needed for this sketch.
- **Risk:** A future change adds `stdout: "pipe"` to the `webServer` block (e.g., to debug something) and accidentally re-introduces noise from Python startup banners or new tooling. **Mitigation:** the suppression is named (`stderr: "ignore"`) and discoverable next to the `command:` string; a reviewer reading the diff in a future PR would see the intent.

---

> **Phase complete?** Architecture clear, decisions logged with rationale, file map complete. Then advance: `/sketch tasks STRK-57`.
