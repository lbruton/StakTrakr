#!/usr/bin/env node
/**
 * sqld reachability probe (STRK-7, hardened in STRK-277).
 *
 * Runs `SELECT 1` against sqld via the same libSQL client the publisher uses,
 * so the Fly.io node can detect a broken Tailscale route to home sqld even
 * while Fly.io itself is healthy.
 *
 * Lives in its own module so it can be unit-tested without importing
 * `serve.js`, which binds port 8080 at module scope.
 */

const SQLD_PROBE_TIMEOUT_MS = 5000;

let sqldClient = null;

/**
 * Close a libSQL client without ever throwing.
 *
 * `@libsql/client`'s `close()` is **synchronous** and returns `void`, so the
 * previous `client?.close().catch(...)` threw a TypeError on every call. That
 * throw happened inside the probe's catch block, escaped the async request
 * handler, and killed the process (STRK-277). Cleanup is best-effort and must
 * never propagate: tolerate both the void and promise-returning shapes.
 *
 * @param {{close?: () => unknown} | null | undefined} client - Client to close, if any.
 * @returns {void}
 */
export function closeQuietly(client) {
  try {
    const result = client?.close();
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(() => {});
    }
  } catch {
    // A failed close must never mask the probe's result.
  }
}

/**
 * Drop the cached sqld client.
 *
 * Exported as a test seam so each case starts from a known state; also used
 * internally to force a fresh connection after a failure.
 *
 * @returns {void}
 */
export function resetSqldClientCache() {
  sqldClient = null;
}

/**
 * Classify a probe error message into a stable, machine-readable bucket.
 *
 * @param {string} message - The error message to classify.
 * @returns {"timeout"|"connection_refused"|"host_unreachable"|"dns_error"|"query_error"}
 */
function classifyError(message) {
  if (message.includes("timeout")) return "timeout";
  if (message.includes("ECONNREFUSED")) return "connection_refused";
  if (message.includes("EHOSTUNREACH") || message.includes("ENETUNREACH"))
    return "host_unreachable";
  if (message.includes("ENOTFOUND")) return "dns_error";
  return "query_error";
}

/**
 * Probe whether sqld is reachable by running `SELECT 1`.
 *
 * Always resolves — never rejects. A failure is reported in the returned
 * object so the caller can serve HTTP 200 with `ok: false`, which is what
 * distinguishes "Fly.io is up but sqld is unreachable" from "Fly.io is down".
 *
 * @param {(() => object)} [clientFactory] - Optional client factory; defaults to
 *   lazily importing `createSqldClient` from `./sqld-client.js`. Injectable for tests.
 * @returns {Promise<{ok: boolean, latency_ms: number, checked_at: string, error_class?: string}>}
 */
export async function probeSqldReachable(clientFactory) {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  let timeoutId;
  try {
    if (!sqldClient) {
      const factory = clientFactory || (await import("./sqld-client.js")).createSqldClient;
      sqldClient = factory();
    }

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("sqld probe timeout")), SQLD_PROBE_TIMEOUT_MS);
    });

    await Promise.race([sqldClient.execute("SELECT 1 AS ok"), timeoutPromise]);
    return { ok: true, latency_ms: Date.now() - startedAt, checked_at: checkedAt };
  } catch (err) {
    // Drop the cached client so the next probe attempts a fresh connection,
    // recovering from a stuck pool after a Tailscale-route flap.
    const clientToClose = sqldClient;
    sqldClient = null;
    closeQuietly(clientToClose);

    return {
      ok: false,
      error_class: classifyError(String(err?.message || err)),
      latency_ms: Date.now() - startedAt,
      checked_at: checkedAt,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
