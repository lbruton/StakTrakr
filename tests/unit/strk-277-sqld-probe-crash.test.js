// Unit tests for the sqld reachability probe (STRK-277).
//
// Regression coverage for a production crash on 2026-07-25T02:58:10Z: the
// probe's failure-path cleanup called `.catch()` on the return value of
// `@libsql/client`'s `close()`, which is synchronous and returns `void`. The
// resulting TypeError was thrown *inside* the catch block, escaped the async
// request handler, and terminated the Node process on every probe while sqld
// was unreachable — the exact condition the probe exists to report.
//
// Run: npm run test:unit
//
// The probe module takes an injected client factory, so these tests need no
// @libsql/client install and have no side effects (no server is bound).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  probeSqldReachable,
  closeQuietly,
  resetSqldClientCache,
} from "../../devops/pollers/shared/sqld-probe.js";

/**
 * Build a fake libSQL client.
 *
 * @param {object} opts
 * @param {() => unknown} [opts.execute] - Stub for `execute()`.
 * @param {() => unknown} [opts.close] - Stub for `close()`.
 * @returns {{execute: Function, close: Function, closeCalls: number}}
 */
function fakeClient({ execute, close } = {}) {
  const client = {
    closeCalls: 0,
    execute: execute || (async () => ({ rows: [{ ok: 1 }] })),
    close:
      close ||
      function () {
        // Mirrors the real client: synchronous, returns undefined.
        return undefined;
      },
  };
  const originalClose = client.close;
  client.close = function (...args) {
    client.closeCalls += 1;
    return originalClose.apply(this, args);
  };
  return client;
}

beforeEach(() => {
  resetSqldClientCache();
});

describe("closeQuietly", () => {
  it("does not throw when close() returns undefined (the STRK-277 crash)", () => {
    const client = fakeClient({ close: () => undefined });
    assert.doesNotThrow(() => closeQuietly(client));
    assert.equal(client.closeCalls, 1);
  });

  it("does not throw when close() throws synchronously", () => {
    const client = fakeClient({
      close: () => {
        throw new Error("socket already destroyed");
      },
    });
    assert.doesNotThrow(() => closeQuietly(client));
  });

  it("swallows a rejected promise from close() without an unhandled rejection", async () => {
    const client = fakeClient({ close: () => Promise.reject(new Error("close failed")) });
    assert.doesNotThrow(() => closeQuietly(client));
    // Give the microtask queue a turn; an unhandled rejection would surface here.
    await new Promise((resolve) => setImmediate(resolve));
  });

  it("tolerates null and undefined clients", () => {
    assert.doesNotThrow(() => closeQuietly(null));
    assert.doesNotThrow(() => closeQuietly(undefined));
  });
});

describe("probeSqldReachable", () => {
  it("reports ok on a successful SELECT 1", async () => {
    const client = fakeClient();
    const result = await probeSqldReachable(() => client);

    assert.equal(result.ok, true);
    assert.equal(typeof result.latency_ms, "number");
    assert.match(result.checked_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(client.closeCalls, 0, "a healthy client must stay cached");
  });

  it("resolves to ok:false instead of throwing when sqld is unreachable", async () => {
    // The exact production shape: execute() rejects, close() returns void.
    const client = fakeClient({
      execute: async () => {
        throw new Error("connect ECONNREFUSED 192.168.1.81:8080");
      },
      close: () => undefined,
    });

    const result = await probeSqldReachable(() => client);

    assert.equal(result.ok, false);
    assert.equal(result.error_class, "connection_refused");
    assert.equal(client.closeCalls, 1, "the stale client must be closed");
  });

  it("drops the cached client after a failure so the next probe reconnects", async () => {
    const failing = fakeClient({
      execute: async () => {
        throw new Error("connect ECONNREFUSED 192.168.1.81:8080");
      },
    });
    const healthy = fakeClient();

    const clients = [failing, healthy];
    const factory = () => clients.shift();

    const first = await probeSqldReachable(factory);
    assert.equal(first.ok, false);

    const second = await probeSqldReachable(factory);
    assert.equal(second.ok, true, "a fresh client must be built after a failure");
  });

  it("survives a client whose close() also throws during cleanup", async () => {
    const client = fakeClient({
      execute: async () => {
        throw new Error("EHOSTUNREACH 192.168.1.81");
      },
      close: () => {
        throw new Error("close blew up too");
      },
    });

    const result = await probeSqldReachable(() => client);
    assert.equal(result.ok, false);
    assert.equal(result.error_class, "host_unreachable");
  });

  it("returns ok:false when the client factory itself throws", async () => {
    const result = await probeSqldReachable(() => {
      throw new Error("SQLD_URL must be set");
    });
    assert.equal(result.ok, false);
    assert.equal(result.error_class, "query_error");
  });

  for (const [message, expected] of [
    ["sqld probe timeout", "timeout"],
    ["connect ECONNREFUSED 192.168.1.81:8080", "connection_refused"],
    ["EHOSTUNREACH 192.168.1.81", "host_unreachable"],
    ["ENETUNREACH", "host_unreachable"],
    ["getaddrinfo ENOTFOUND sqld.internal", "dns_error"],
    ["SQLITE_ERROR: no such table", "query_error"],
  ]) {
    it(`classifies "${message}" as ${expected}`, async () => {
      const client = fakeClient({
        execute: async () => {
          throw new Error(message);
        },
      });
      const result = await probeSqldReachable(() => client);
      assert.equal(result.ok, false);
      assert.equal(result.error_class, expected);
    });
  }
});
