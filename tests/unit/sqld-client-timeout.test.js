// Unit tests for the sqld client request timeout (STRK-402).
//
// Part of the Fly publisher OOM postmortem fix: `createSqldClient()` had no
// request timeout, so an unreachable/unresponsive sqld host could hang a
// caller indefinitely instead of failing fast. `createTimeoutFetch()` wraps
// the HTTP client's `fetch` with `AbortSignal.timeout()` so a stalled request
// rejects within SQLD_TIMEOUT_MS (default 20000ms) instead of hanging.
//
// Imports from sqld-timeout-fetch.js, NOT sqld-client.js: the latter's
// top-level `@libsql/client` import is declared only in
// devops/pollers/shared/package.json, not the repo root, so a root-only
// `npm install` (what `npm run test:unit` runs against) never installs it.
// A static import of sqld-client.js here would break that command on a
// clean checkout.
//
// Run: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createTimeoutFetch,
  resolveSqldTimeoutMs,
  DEFAULT_SQLD_TIMEOUT_MS,
} from "../../devops/pollers/shared/sqld-timeout-fetch.js";

/** A fetch stub that never resolves on its own — only settles if aborted. */
function neverRespondingFetch(_input, init = {}) {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      reject(new DOMException("The operation was aborted.", "AbortError"));
    });
  });
}

describe("createTimeoutFetch", () => {
  it("rejects a request to an unresponsive host within the configured timeout", async () => {
    const timeoutFetch = createTimeoutFetch(30, neverRespondingFetch);
    const start = Date.now();

    // Assert the rejection is actually the abort firing, not the fetch
    // implementation throwing early for an unrelated reason (a missing
    // AbortSignal.timeout, a bad fetchImpl, etc.) — those would also reject
    // quickly and could otherwise pass this test for the wrong reason.
    await assert.rejects(() => timeoutFetch("http://sqld.invalid/", {}), { name: "AbortError" });

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `expected a fast rejection, took ${elapsed}ms`);
  });

  it("does not override a caller-supplied AbortSignal", async () => {
    const controller = new AbortController();
    let receivedSignal;
    const spyFetch = (_input, init) => {
      receivedSignal = init.signal;
      return Promise.resolve("ok");
    };

    const timeoutFetch = createTimeoutFetch(30, spyFetch);
    await timeoutFetch("http://sqld.invalid/", { signal: controller.signal });

    assert.equal(receivedSignal, controller.signal);
  });

  it("passes through a fast, successful response untouched", async () => {
    const okFetch = async () => "ok-response";
    const timeoutFetch = createTimeoutFetch(1000, okFetch);

    const result = await timeoutFetch("http://sqld.invalid/", {});
    assert.equal(result, "ok-response");
  });

  it("tolerates a null init, matching how native fetch treats a missing one", async () => {
    const okFetch = async () => "ok-response";
    const timeoutFetch = createTimeoutFetch(1000, okFetch);

    const result = await timeoutFetch("http://sqld.invalid/", null);
    assert.equal(result, "ok-response");
  });

  it("exports a sane default timeout", () => {
    assert.equal(typeof DEFAULT_SQLD_TIMEOUT_MS, "number");
    assert.ok(DEFAULT_SQLD_TIMEOUT_MS > 0);
  });

  it("still applies the timeout to a Request's own signal instead of dropping it", async () => {
    // @libsql/client's HTTP transport calls the custom `fetch` with a Request
    // object as `input`. If that Request carries its own signal and init.signal
    // is absent, the caller's cancellation must still work AND the timeout must
    // still apply — neither one should silently win over the other.
    const requestController = new AbortController();
    const request = new Request("http://sqld.invalid/", { signal: requestController.signal });

    const timeoutFetch = createTimeoutFetch(30, neverRespondingFetch);
    const pending = assert.rejects(() => timeoutFetch(request), { name: "AbortError" });

    // The timeout (30ms) fires before we ever abort the request's own
    // controller — proves the timeout signal is still wired in.
    await pending;
  });

  it("aborts immediately when the Request's own signal fires, without waiting for the timeout", async () => {
    const requestController = new AbortController();
    const request = new Request("http://sqld.invalid/", { signal: requestController.signal });

    const timeoutFetch = createTimeoutFetch(10_000, neverRespondingFetch);
    const start = Date.now();
    const pending = assert.rejects(() => timeoutFetch(request), { name: "AbortError" });

    requestController.abort();
    await pending;

    const elapsed = Date.now() - start;
    assert.ok(
      elapsed < 500,
      `expected the Request's own abort to win immediately, took ${elapsed}ms`
    );
  });
});

describe("resolveSqldTimeoutMs", () => {
  it("returns the default when unset or empty", () => {
    assert.equal(resolveSqldTimeoutMs(undefined), DEFAULT_SQLD_TIMEOUT_MS);
    assert.equal(resolveSqldTimeoutMs(""), DEFAULT_SQLD_TIMEOUT_MS);
  });

  it("returns the parsed value for a valid positive integer", () => {
    assert.equal(resolveSqldTimeoutMs("5000"), 5000);
  });

  it("accepts the maximum delay AbortSignal.timeout() itself supports", () => {
    assert.equal(resolveSqldTimeoutMs("4294967295"), 4294967295);
  });

  for (const bad of ["-1", "1.5", "0", "not-a-number", "NaN", "4294967296"]) {
    it(`rejects an invalid value ("${bad}") instead of silently breaking every request`, () => {
      assert.throws(() => resolveSqldTimeoutMs(bad), /SQLD_TIMEOUT_MS must be a positive integer/);
    });
  }
});
