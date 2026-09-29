---
sketch: "STRK-57-quiet-playwright-logs"
phase: requirements
created: 2026-05-11
---

# STRK-57 — Requirements

> **Source Issue:** [STRK-57](https://plane.lbruton.cc/lbruton/browse/STRK-57/)
>
> **Title:** Quiet Playwright web server asset logging
>
> **Description:** Follow-up from STRK-54 verification: full Playwright runs are hard to scan because the local test web server logs every static asset request. Suggested cleanup after STRK-54 ships and before starting the next issue: use a quieter local server wrapper or redirect/suppress access logs in the Playwright webServer command while preserving useful startup/failure output. Context: this is test harness noise, not a STRK-54 product behavior change.

## Overview

Suppress per-request access logging from the local test web server during Playwright runs so that test output is scannable and real failures are immediately visible. This is test-harness-only noise — the `python3 -m http.server` command in `playwright.config.js` logs every static asset `GET` to stderr, interleaving noise with meaningful Playwright output. The fix is confined to the `webServer` command or a thin wrapper; no test behavior changes.

## User Stories

> Format: **As a** [role], **I want** [capability], **so that** [outcome].

- **US-1:** As a developer running Playwright tests, I want static-asset access logs suppressed during test runs, so that test output is scannable and real test failures are easy to spot.
- **US-2:** As a developer debugging a test failure, I want the web server to still log startup confirmation and error messages, so that I can diagnose server-start issues and 404s without re-enabling noisy request logging.

## Acceptance Criteria

> Format: Given/When/Then. Each AC must be verifiable from code or tests after implementation.

### AC-1 — Request log suppression (maps to US-1)
- **Given** a Playwright test run is executing via `npm test` or `npx playwright test`
- **When** the Playwright `webServer` process starts `python3 -m http.server 3000`
- **Then** HTTP access log lines (e.g., `127.0.0.1 - - [11/May/2026 ...] "GET /css/styles.css HTTP/1.1" 200`) do NOT appear in the test output
- **Additionally**, the server still binds to port 3000 and serves static files correctly

### AC-2 — Startup and error output preserved (maps to US-2)
- **Given** the `webServer` command is starting or processing a request for a missing file
- **When** the server binds to the port (success startup) or the server returns a 404
- **Then** startup confirmation line(s) are still visible in the output (e.g., the Python default "Serving HTTP on …" line)
- **Additionally**, 404 responses to the test process are not suppressed (missing assets that tests depend on still fail visibly)
> CODEX: This AC is the main contradiction in the sketch. If approach.md keeps the proposed no-op `log_message` override, the HTTP 404 log line is suppressed too, so this requirement needs to be narrowed to "test failures remain visible" rather than "server 404 output remains visible." If the human wants 404 logs preserved, the approach needs to change instead.
> KIMI: **CRITICAL CONTRADICTION:** AC-2 explicitly requires that 404s "are not suppressed," but `approach.md` Decision D-2 chooses a no-op `log_message` override that suppresses **all** access logs including 404s. The approach rationale ("404s are redundant") directly conflicts with this acceptance criterion. Either AC-2 must be revised, or the approach must use selective filtering (e.g., only suppress 200s).
> GEMINI: I agree with KIMI. If the goal is truly to suppress "access logging" while keeping "errors" visible as per US-2, a total suppression of `log_message` is too blunt. However, if we accept that 404s are caught by the tests anyway, AC-2 should be updated to reflect that only "startup/failure output" (like port binding errors) is preserved, explicitly excluding HTTP-level 404 logs.
> CLAUDE: KIMI/Gemini are right about the contradiction. If the `stderr: "ignore"` approach is adopted (see open questions comment below), this tension becomes explicit and acceptable: all stderr — including 404 log lines — is suppressed, but the startup message (stdout) and test-level failures (Playwright assertions) remain. AC-2's "Additionally, 404 responses … still fail visibly" should be reworded to clarify that 404 *test failures* are still visible (via Playwright assertions), even though the server's stderr 404 *log lines* are suppressed.

### AC-3 — No regressions in test suite
- **Given** the `webServer` command has been modified to suppress access logs
- **When** the full Playwright test suite is run
- **Then** all existing tests pass with zero new failures

## Non-Goals

_Explicit list of things this sketch does NOT do. Each entry should make a future reader confident the omission was intentional._

- Not modifying any test file or test behavior — this is a harness-only change
- Not changing the production server, deployment config, or runtime code
- Not suppressing Playwright's own debug output or reporter output
- Not adding a real build step or Node-based dev server — keep the zero-build guarantee
- Not changing `reuseExistingServer` or worker configuration
> CODEX: This non-goal is fine, but it creates an important limitation: locally, an already-running server on port 3000 bypasses the fix entirely because Playwright will reuse it. I’d call that limitation out explicitly here or in discovery so we do not treat "still noisy on my machine" as a regression later.
> KIMI: Architectural note: preserving `reuseExistingServer` means local developers with an existing server on port 3000 will silently bypass the fix entirely. This should be called out as an intentional limitation so future readers don't file "still noisy" bugs.

## Open Questions

_Anything that blocks the next phase. Empty by the time discovery starts._

- [ ] What suppression mechanism is cleanest — Python `-q` flag, stderr filter wrapper, or `--cgi` trick?
- [ ] Does suppressing stderr wholesale lose Playwright's own error output, or is stderr from the webServer separate?
- [ ] Are there existing stderr suppressors or wrapper scripts in the devops/ directory we can reuse?
> CODEX: These are not really open anymore. Playwright documents `stderr: "ignore"` and `stdout: "ignore"` separately for `webServer`, and the current config does not use either. That means the next phase should choose between two concrete paths: a config-only `stderr` change with zero escaping risk, or a wrapper/one-liner when preserving selected HTTP log classes actually matters.
> CLAUDE: **Empirical finding renders these questions moot.** `python3 http.server.test()` prints the startup message to **stdout** via `print()`, while `log_message()` writes access logs to **stderr**. They are separate streams. Adding `stderr: "ignore"` to the Playwright `webServer` config block is a one-property fix that suppresses access logs while preserving the startup message — no Python one-liner, no subclass, no escaping. The discovery and approach phases were built on a false conflation of these two streams.
> KIMI: Edge case missing: the sketch assumes `python3` is on PATH. On Windows (or some CI images) the executable may be `python` instead. The current config already uses `python3`, so this isn't a new regression, but a sketch touching this command should note the platform assumption.
> GEMINI: While `python3` is the current standard in the project, if we are moving to a more complex one-liner, we should consider if a cross-platform wrapper (e.g., a small Node.js script since we already have Node) would be more robust than complex Python string escaping.

---

> **Phase complete?** Acceptance criteria are concrete and verifiable. Open questions list is empty. Then advance: `/sketch discovery STRK-57`.
