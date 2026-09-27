// Unit tests for the sqld client request timeout (STRK-402).
//
// Part of the Fly publisher OOM postmortem fix: `createSqldClient()` had no
// request timeout, so an unreachable/unresponsive sqld host could hang a
// caller indefinitely instead of failing fast. `createTimeoutFetch()` wraps
// the HTTP client's `fetch` with `AbortSignal.timeout()` so a stalled request
// rejects within SQLD_TIMEOUT_MS (default 20000ms) instead of hanging.
//
// Run: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createTimeoutFetch,
  DEFAULT_SQLD_TIMEOUT_MS,
} from "../../devops/pollers/shared/sqld-client.js";

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

    await assert.rejects(() => timeoutFetch("http://sqld.invalid/", {}));

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

  it("exports a sane default timeout", () => {
    assert.equal(typeof DEFAULT_SQLD_TIMEOUT_MS, "number");
    assert.ok(DEFAULT_SQLD_TIMEOUT_MS > 0);
  });
});
