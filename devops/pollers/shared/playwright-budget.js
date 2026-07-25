// Hard time budgets for the Playwright fallback path (STRK-255).
//
// `page.goto({ timeout })` bounds navigation only. Everything else in a vendor
// attempt — `chromium.launch()`, `page.evaluate()`, and above all
// `browser.close()` — is unbounded. On 2026-07-19 a jmbullion navigation timed
// out, the error was caught and logged ("… — falling back"), and the run then
// wedged in the `finally` awaiting `browser.close()`. The scrape never returned,
// the run lock was never released, and retail data froze for ~3.5h.
//
// These helpers put a ceiling on a whole vendor attempt and guarantee browser
// teardown terminates, escalating to a process kill when the graceful close
// itself hangs.

import { execFileSync } from "node:child_process";

/** Default ceiling for one vendor's Playwright attempt, in milliseconds. */
export const DEFAULT_VENDOR_BUDGET_MS = 90_000;

/** Default ceiling for a graceful `browser.close()`, in milliseconds. */
export const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;

/** Sentinel resolved by {@link withDeadline} when the budget is exhausted. */
export const DEADLINE_EXCEEDED = Symbol("deadline-exceeded");

/**
 * Race a promise against a deadline without leaving a dangling timer.
 *
 * Resolves to {@link DEADLINE_EXCEEDED} rather than rejecting, so callers can
 * treat a blown budget as "this vendor produced nothing" and continue to the
 * next one instead of aborting the run.
 *
 * The losing promise is not cancelled — JavaScript cannot cancel a pending
 * promise — so a rejection arriving after the deadline is swallowed here to
 * avoid an unhandled rejection taking down the process.
 *
 * @param {Promise<T>} promise - Work to bound.
 * @param {number} ms - Budget in milliseconds.
 * @returns {Promise<T | typeof DEADLINE_EXCEEDED>} Result, or the sentinel.
 * @template T
 */
export function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE_EXCEEDED), ms);
    // Do not hold the event loop open purely for this timer.
    if (typeof timer.unref === "function") timer.unref();
  });

  return Promise.race([promise, deadline]).finally(() => {
    clearTimeout(timer);
    // The loser may still settle later; a late rejection with no handler would
    // terminate the process under Node's default unhandledRejection policy.
    // Optional call so a non-promise argument cannot throw here.
    promise?.catch?.(() => {});
  });
}

/**
 * List the direct child pids of a process.
 *
 * Used to identify the browser Chromium spawns, because Playwright's `Browser`
 * gives no handle on it (see {@link closeBrowserSafely}).
 *
 * @param {number} [parentPid] - Parent to inspect; defaults to this process.
 * @returns {number[]} Child pids, or an empty array if they cannot be listed.
 */
export function listChildPids(parentPid = process.pid) {
  try {
    return execFileSync("pgrep", ["-P", String(parentPid)], { encoding: "utf8" })
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    // No children, or pgrep unavailable. Either way there is nothing to kill.
    return [];
  }
}

/**
 * Close a Playwright browser, guaranteeing the call returns.
 *
 * A graceful `close()` is attempted first. If it does not settle within
 * `timeoutMs` the browser is killed outright — leaking a Chromium process is
 * strictly better than wedging the poller forever.
 *
 * Killing is deliberately two-pronged. Playwright exposes `process()` on
 * `BrowserServer` and `ElectronApplication` only — **not** on the `Browser`
 * returned by `chromium.launch()` — so for the poller's launch-based path that
 * accessor is always absent and `fallbackPids` is what actually does the work.
 * The caller records the pids Chromium spawned under, because once this Node
 * process exits they are reparented to init and no longer reachable from the
 * run-lock watchdog's process-tree walk.
 *
 * @param {{close: Function, process?: Function}} browser - Playwright browser.
 * @param {object} [opts] - Options.
 * @param {number} [opts.timeoutMs] - Graceful close budget.
 * @param {(msg: string) => void} [opts.log] - Logger for the escalation path.
 * @param {number[]} [opts.fallbackPids] - Pids to SIGKILL when close() hangs.
 * @returns {Promise<"closed"|"killed"|"failed">} How teardown resolved.
 */
export async function closeBrowserSafely(browser, opts = {}) {
  const { timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS, log = () => {}, fallbackPids = [] } = opts;
  if (!browser) return "closed";

  let closePromise;
  try {
    // close() may legitimately return undefined, so normalize before chaining.
    closePromise = Promise.resolve(browser.close());
  } catch {
    // A synchronous throw from close() still leaves the process to reap.
    closePromise = Promise.reject(new Error("close threw synchronously"));
  }

  const outcome = await withDeadline(
    closePromise.then(
      () => "closed",
      () => "failed"
    ),
    timeoutMs
  );

  if (outcome !== DEADLINE_EXCEEDED) return outcome;

  log(`  (playwright) browser.close() exceeded ${timeoutMs}ms — killing browser process`);

  // BrowserServer / ElectronApplication path.
  try {
    const proc = typeof browser.process === "function" ? browser.process() : null;
    if (proc && typeof proc.kill === "function") {
      proc.kill("SIGKILL");
      return "killed";
    }
  } catch {
    /* fall through to the pid path */
  }

  // chromium.launch() path: no process handle exists, so kill the recorded pids.
  let killed = 0;
  for (const pid of fallbackPids) {
    try {
      process.kill(pid, "SIGKILL");
      killed += 1;
    } catch {
      // Already gone — nothing to do.
    }
  }
  if (killed > 0) {
    log(`  (playwright) SIGKILLed ${killed} orphaned browser process(es)`);
    return "killed";
  }
  return "failed";
}

/**
 * Resolve the per-vendor Playwright budget from the environment.
 *
 * @param {Record<string, string|undefined>} [env] - Environment to read.
 * @returns {number} Budget in milliseconds.
 */
export function resolveVendorBudgetMs(env = process.env) {
  const raw = Number(env.PLAYWRIGHT_VENDOR_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VENDOR_BUDGET_MS;
}

/**
 * Resolve the graceful browser-close budget from the environment.
 *
 * @param {Record<string, string|undefined>} [env] - Environment to read.
 * @returns {number} Budget in milliseconds.
 */
export function resolveCloseTimeoutMs(env = process.env) {
  const raw = Number(env.PLAYWRIGHT_CLOSE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLOSE_TIMEOUT_MS;
}
