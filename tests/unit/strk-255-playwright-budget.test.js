// Unit tests for the Playwright vendor time budget (STRK-255).
//
// The 2026-07-19 freeze was not a navigation timeout — `page.goto` was already
// bounded at 15s and it fired correctly, logging "… — falling back". The run
// then wedged in the `finally` block awaiting `browser.close()`, which has no
// timeout of its own. These tests pin the two guarantees that prevent a repeat:
// a whole vendor attempt cannot outlive its budget, and browser teardown always
// returns, escalating to SIGKILL when a graceful close hangs.
//
// Run: npm run test:unit

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  withDeadline,
  closeBrowserSafely,
  resolveVendorBudgetMs,
  resolveCloseTimeoutMs,
  DEADLINE_EXCEEDED,
  DEFAULT_VENDOR_BUDGET_MS,
  DEFAULT_CLOSE_TIMEOUT_MS,
} from "../../devops/pollers/shared/playwright-budget.js";

/**
 * Build a promise that never settles, standing in for a wedged browser call.
 *
 * @returns {Promise<never>} A forever-pending promise.
 */
function neverSettles() {
  return new Promise(() => {});
}

/**
 * Sleep for a given duration.
 *
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>} Resolves after the delay.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("STRK-255 withDeadline", () => {
  it("passes through a value that arrives in time", async () => {
    const result = await withDeadline(Promise.resolve("ok"), 1000);
    assert.equal(result, "ok");
  });

  it("resolves to the sentinel instead of hanging forever", async () => {
    const result = await withDeadline(neverSettles(), 25);
    assert.equal(result, DEADLINE_EXCEEDED);
  });

  it("resolves to the sentinel rather than rejecting, so the run continues", async () => {
    // A blown budget must not abort the poll — the remaining vendors still
    // need to be scraped. This is why the helper resolves rather than throws.
    const result = await withDeadline(
      delay(50).then(() => "late"),
      10
    );
    assert.equal(result, DEADLINE_EXCEEDED);
  });

  it("swallows a rejection that lands after the deadline", async () => {
    const leaked = [];
    const onUnhandled = (err) => leaked.push(err);
    process.on("unhandledRejection", onUnhandled);

    try {
      const slowFailure = delay(20).then(() => {
        throw new Error("late boom");
      });
      const result = await withDeadline(slowFailure, 5);
      assert.equal(result, DEADLINE_EXCEEDED);
      await delay(60);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    // Node's default policy for an unhandled rejection is to terminate. A
    // browser call that rejects after we stopped waiting must not kill the run.
    assert.deepEqual(leaked, []);
  });

  it("propagates a rejection that arrives before the deadline", async () => {
    await assert.rejects(() => withDeadline(Promise.reject(new Error("boom")), 1000), /boom/);
  });
});

describe("STRK-255 closeBrowserSafely", () => {
  it("reports a clean close", async () => {
    const browser = { close: async () => {} };
    assert.equal(await closeBrowserSafely(browser), "closed");
  });

  it("tolerates a null browser", async () => {
    assert.equal(await closeBrowserSafely(null), "closed");
  });

  it("kills the browser process when close() hangs", async () => {
    const signals = [];
    const browser = {
      close: () => neverSettles(),
      process: () => ({
        kill: (sig) => signals.push(sig),
      }),
    };

    const logs = [];
    const outcome = await closeBrowserSafely(browser, {
      timeoutMs: 20,
      log: (m) => logs.push(m),
    });

    // This is the exact 2026-07-19 wedge: close() never returns.
    assert.equal(outcome, "killed");
    assert.deepEqual(signals, ["SIGKILL"]);
    assert.match(logs.join("\n"), /killing browser process/);
  });

  it("returns rather than throwing when close() rejects", async () => {
    const browser = {
      close: async () => {
        throw new Error("already closed");
      },
    };
    assert.equal(await closeBrowserSafely(browser), "failed");
  });

  it("returns rather than throwing when close() throws synchronously", async () => {
    const browser = {
      close: () => {
        throw new Error("sync boom");
      },
    };
    assert.equal(await closeBrowserSafely(browser), "failed");
  });

  it("does not hang when close() wedges and no process handle exists", async () => {
    // browserless/CDP-connected browsers expose no local process to kill.
    const browser = { close: () => neverSettles() };
    assert.equal(await closeBrowserSafely(browser, { timeoutMs: 20 }), "failed");
  });
});

describe("STRK-255 budget resolution", () => {
  it("falls back to defaults when unset", () => {
    assert.equal(resolveVendorBudgetMs({}), DEFAULT_VENDOR_BUDGET_MS);
    assert.equal(resolveCloseTimeoutMs({}), DEFAULT_CLOSE_TIMEOUT_MS);
  });

  it("honours valid overrides", () => {
    assert.equal(resolveVendorBudgetMs({ PLAYWRIGHT_VENDOR_BUDGET_MS: "45000" }), 45000);
    assert.equal(resolveCloseTimeoutMs({ PLAYWRIGHT_CLOSE_TIMEOUT_MS: "3000" }), 3000);
  });

  it("ignores junk and non-positive overrides", () => {
    // A typo'd env var must not silently disable the budget.
    assert.equal(
      resolveVendorBudgetMs({ PLAYWRIGHT_VENDOR_BUDGET_MS: "abc" }),
      DEFAULT_VENDOR_BUDGET_MS
    );
    assert.equal(
      resolveVendorBudgetMs({ PLAYWRIGHT_VENDOR_BUDGET_MS: "0" }),
      DEFAULT_VENDOR_BUDGET_MS
    );
    assert.equal(
      resolveVendorBudgetMs({ PLAYWRIGHT_VENDOR_BUDGET_MS: "-1" }),
      DEFAULT_VENDOR_BUDGET_MS
    );
  });
});
