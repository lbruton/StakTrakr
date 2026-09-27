#!/usr/bin/env node
/**
 * sqld request-timeout `fetch` wrapper (STRK-402).
 *
 * Split out of `sqld-client.js` so this pure logic has zero dependency on
 * `@libsql/client` — that package is declared only in
 * `devops/pollers/shared/package.json`, not the repo root, so a root-only
 * `npm install` never installs it. `tests/unit/` runs against the root
 * install, so any test file that statically imports `sqld-client.js` drags
 * that missing dependency in and breaks `npm run test:unit` on a clean
 * checkout. Importing from this module instead keeps that command
 * self-contained.
 */

/** Default request timeout (ms) when `SQLD_TIMEOUT_MS` is unset. */
export const DEFAULT_SQLD_TIMEOUT_MS = 20000;

/**
 * Wrap a `fetch` implementation so a request aborts after `timeoutMs` instead
 * of hanging forever (an unreachable sqld host previously had no ceiling, so
 * a stalled request blocked its caller indefinitely).
 *
 * A caller-supplied `init.signal` is left untouched. A `Request` passed as
 * `input` that carries its own `signal` (and no `init.signal`) has that
 * signal combined with the timeout via `AbortSignal.any`, so the request
 * still respects both the caller's cancellation and the timeout ceiling.
 *
 * @param {number} timeoutMs
 * @param {typeof fetch} [fetchImpl] - Injectable for tests; defaults to global `fetch`.
 * @returns {typeof fetch}
 */
export function createTimeoutFetch(timeoutMs, fetchImpl = globalThis.fetch) {
  return (input, init = {}) => {
    if (init.signal) return fetchImpl(input, init);

    const requestSignal = input instanceof Request ? input.signal : null;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = requestSignal ? AbortSignal.any([requestSignal, timeoutSignal]) : timeoutSignal;

    return fetchImpl(input, { ...init, signal });
  };
}

/**
 * Parse and validate a `SQLD_TIMEOUT_MS` env value.
 *
 * `AbortSignal.timeout()` throws synchronously for a negative, non-integer,
 * or NaN delay — that would surface as every sqld request failing before
 * `fetch` is even called. Validate once, at client-creation time, so a
 * misconfigured env var fails loudly and immediately instead of quietly
 * breaking every subsequent query.
 *
 * @param {string | undefined} raw - `process.env.SQLD_TIMEOUT_MS`.
 * @returns {number}
 * @throws {Error} If `raw` is set but is not a positive integer.
 */
export function resolveSqldTimeoutMs(raw) {
  if (raw == null || raw === "") return DEFAULT_SQLD_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`SQLD_TIMEOUT_MS must be a positive integer, got "${raw}"`);
  }
  return parsed;
}
