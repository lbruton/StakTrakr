// Unit tests for the retail poller stuck-run watchdog (STRK-255).
//
// Regression coverage for a silent 3.5h retail-data freeze on 2026-07-19: the
// home poller's hourly run hung mid-scrape inside the Playwright fallback
// (jmbullion, Webscale interstitial). The lockfile guard in run-home.sh was a
// bare `touch` with no PID and no age, so every subsequent tick printed
// "Previous run still active, skipping" and no-opped. Nothing could tell a
// genuinely-running poll from a wedged one, and nothing could reclaim the lock
// — it was only cleared when the container restarted hours later.
//
// The fix is a shared `acquire_run_lock` helper that records `PID EPOCH`,
// detects both dead holders (crash / OOM-kill, where the EXIT trap never ran)
// and live-but-overrunning holders, kills the stale process tree, and proceeds.
//
// Run: npm run test:unit
//
// These tests drive the real bash helper via a temp lockfile and short-lived
// `sleep` processes. Nothing touches /tmp/retail-poller.lock or the poller.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOCK_HELPER = join(REPO_ROOT, "devops", "pollers", "shared", "run-lock.sh");

/** Seconds a held lock may live before the watchdog reclaims it, in tests. */
const SHORT_MAX_AGE = 2;

let workDir;

/**
 * Run `acquire_run_lock` in a fresh bash process against a given lockfile.
 *
 * The helper is sourced rather than executed so the caller keeps the EXIT trap
 * semantics the real run scripts rely on.
 *
 * @param {string} lockfile - Path to the lockfile under test.
 * @param {number} maxAge - Max age in seconds before a live holder is killed.
 * @param {string} [body] - Extra bash to run after a successful acquire.
 * @returns {{status: number, stdout: string}} Exit status and combined output.
 */
function runAcquire(lockfile, maxAge, body = "") {
  const script = `
    set -e
    # Shorten the SIGTERM grace so the kill path does not dominate suite time.
    # The grace duration itself is not under test.
    export RUN_LOCK_KILL_GRACE_SECONDS=1
    . "${LOCK_HELPER}"
    if acquire_run_lock "${lockfile}" ${maxAge}; then
      echo "ACQUIRED"
      ${body}
    else
      echo "SKIPPED"
      exit 0
    fi
  `;
  try {
    const stdout = execFileSync("bash", ["-c", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: `${err.stdout ?? ""}${err.stderr ?? ""}`,
    };
  }
}

/**
 * Spawn a long-running process to stand in for a wedged poll.
 *
 * The ChildProcess handle is deliberately retained so Node reaps the process
 * when it dies. An unreaped child lingers as a zombie, and a zombie PID still
 * answers `kill -0` — which would make the helper read a dead holder as alive.
 *
 * @param {number} seconds - How long the stand-in should live.
 * @returns {import("node:child_process").ChildProcess} The spawned process.
 */
function spawnStandIn(seconds) {
  return spawn("sleep", [String(seconds)], { stdio: "ignore" });
}

/**
 * Report whether a PID is alive and not a zombie.
 *
 * @param {number} pid - Process id to check.
 * @returns {boolean} True when the process exists in a non-zombie state.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    return stat.length > 0 && !stat.startsWith("Z");
  } catch {
    return false;
  }
}

/**
 * Resolve once a spawned child has fully exited and been reaped by Node.
 *
 * @param {import("node:child_process").ChildProcess} child - Process to await.
 * @param {number} timeoutMs - Maximum wait in milliseconds.
 * @returns {Promise<boolean>} True when the child exited before the deadline.
 */
function waitForExit(child, timeoutMs = 15000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

describe("STRK-255 retail poller run lock", () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "strk255-"));
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("acquires a free lock and records PID and start epoch", () => {
    const lockfile = join(workDir, "poller.lock");
    const res = runAcquire(lockfile, 60, `cat "${lockfile}"`);

    assert.equal(res.status, 0);
    assert.match(res.stdout, /ACQUIRED/);
    // Lockfile contents must be "<pid> <epoch>" so a later tick can both probe
    // liveness and compute age. A bare touch() is what caused STRK-255.
    assert.match(res.stdout, /^\d+ \d{10}$/m);
  });

  it("releases the lock on normal exit", () => {
    const lockfile = join(workDir, "poller.lock");
    runAcquire(lockfile, 60);
    assert.equal(existsSync(lockfile), false);
  });

  it("releases the lock when the run fails under set -e", () => {
    const lockfile = join(workDir, "poller.lock");
    const res = runAcquire(lockfile, 60, "false");

    assert.notEqual(res.status, 0);
    // The trap must be armed at acquire time, not after later setup steps —
    // run-local.sh armed it ~17 lines late, leaking the lock on early failure.
    assert.equal(existsSync(lockfile), false);
  });

  it("skips when a live holder is still within its budget", async () => {
    const lockfile = join(workDir, "poller.lock");
    const holder = spawnStandIn(30);
    writeFileSync(lockfile, `${holder.pid} ${Math.floor(Date.now() / 1000)}\n`);

    const res = runAcquire(lockfile, 600);

    assert.match(res.stdout, /Previous run still active, skipping/);
    assert.doesNotMatch(res.stdout, /ACQUIRED/);
    assert.equal(isAlive(holder.pid), true, "a healthy run must not be killed");
    // The skipping shell must not delete the live holder's lock on its way out.
    assert.equal(existsSync(lockfile), true);

    holder.kill("SIGKILL");
    await waitForExit(holder);
  });

  it("reclaims a lock whose holder is dead (crash or OOM-kill)", async () => {
    const lockfile = join(workDir, "poller.lock");
    const holder = spawnStandIn(30);
    const deadPid = holder.pid;
    holder.kill("SIGKILL");
    // Await the exit event, not just the signal: until Node reaps the child it
    // stays a zombie, and a zombie PID still answers `kill -0`.
    assert.equal(await waitForExit(holder), true);

    writeFileSync(lockfile, `${deadPid} ${Math.floor(Date.now() / 1000)}\n`);
    const res = runAcquire(lockfile, 600);

    // This is the OOM / SIGKILL case: the EXIT trap never ran, so the lock
    // outlived its owner. Age alone would not catch it.
    assert.match(res.stdout, /ACQUIRED/);
    assert.match(res.stdout, /WATCHDOG:/);
    assert.match(res.stdout, /stale/i);
  });

  it("kills a live holder that has overrun its budget and proceeds", async () => {
    const lockfile = join(workDir, "poller.lock");
    const holder = spawnStandIn(60);
    const stuckPid = holder.pid;
    const staleEpoch = Math.floor(Date.now() / 1000) - SHORT_MAX_AGE * 10;
    writeFileSync(lockfile, `${stuckPid} ${staleEpoch}\n`);

    const res = runAcquire(lockfile, SHORT_MAX_AGE);

    assert.match(res.stdout, /ACQUIRED/, "the current tick must proceed");
    assert.match(res.stdout, /WATCHDOG:/);
    assert.equal(
      await waitForExit(holder),
      true,
      "the wedged process tree must actually be killed, not just unlocked"
    );
    assert.equal(isAlive(stuckPid), false);
  });

  it("reclaims a malformed or truncated lockfile", () => {
    const lockfile = join(workDir, "poller.lock");
    writeFileSync(lockfile, "");

    const res = runAcquire(lockfile, 600);

    // A bare `touch`-era lockfile has no PID at all; it must not wedge the
    // poller forever after an upgrade.
    assert.match(res.stdout, /ACQUIRED/);
    assert.match(res.stdout, /WATCHDOG:/);
  });

  it("SIGKILLs a descendant that ignores SIGTERM after its parent dies", async () => {
    const lockfile = join(workDir, "poller.lock");
    const pidFile = join(workDir, "grandchild.pid");

    // Holder shell -> child shell -> grandchild that traps SIGTERM, standing in
    // for a Chromium that does not die politely. The holder exits on the first
    // TERM, reparenting the grandchild to init; escalation must still reach it,
    // which only works if the tree was captured before signalling.
    const holder = spawn(
      "bash",
      ["-c", `bash -c 'trap "" TERM; echo $$ > "${pidFile}"; sleep 120' & sleep 120`],
      { stdio: "ignore" }
    );
    // Give the grandchild time to register its pid.
    execFileSync("sleep", ["0.5"]);
    const grandchildPid = Number(readFileSync(pidFile, "utf8").trim());
    assert.ok(grandchildPid > 0);
    assert.equal(isAlive(grandchildPid), true);

    const staleEpoch = Math.floor(Date.now() / 1000) - 100;
    writeFileSync(lockfile, `${holder.pid} ${staleEpoch}\n`);

    const res = runAcquire(lockfile, SHORT_MAX_AGE);

    assert.match(res.stdout, /ACQUIRED/);
    assert.match(res.stdout, /survived SIGTERM/);
    assert.equal(isAlive(grandchildPid), false, "TERM-ignoring descendant must be SIGKILLed");

    await waitForExit(holder);
  });

  it("lets exactly one of many concurrent acquirers win", () => {
    const lockfile = join(workDir, "poller.lock");
    const CONTENDERS = 12;

    // Publishing the lock must be atomic *with its contents*. A `noclobber`
    // redirect creates the file before the PID is written, so a competing tick
    // could read an empty owner, judge the live lock malformed, delete it, and
    // run concurrently. Hard-linking a pre-filled temp file closes that window.
    const script = `
      for i in $(seq 1 ${CONTENDERS}); do
        (
          . "${LOCK_HELPER}"
          if acquire_run_lock "${lockfile}" 600; then
            echo WON
            sleep 0.3
          fi
        ) &
      done
      wait
    `;
    const stdout = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    const wins = stdout.split("\n").filter((l) => l.trim() === "WON").length;

    assert.equal(wins, 1, `expected exactly one winner, got ${wins}`);
  });

  it("never exposes a lockfile without an owner record", () => {
    const lockfile = join(workDir, "poller.lock");
    // Poll the lock while a run holds it; it must never be observed empty.
    const script = `
      . "${LOCK_HELPER}"
      acquire_run_lock "${lockfile}" 600 >/dev/null
      for i in $(seq 1 40); do
        if [ -f "${lockfile}" ] && [ ! -s "${lockfile}" ]; then echo EMPTY_SEEN; fi
        sleep 0.01
      done
      echo DONE
    `;
    const stdout = execFileSync("bash", ["-c", script], { encoding: "utf8" });

    assert.doesNotMatch(stdout, /EMPTY_SEEN/);
    assert.match(stdout, /DONE/);
  });

  it("falls back to the default budget instead of aborting on a junk budget", () => {
    const lockfile = join(workDir, "poller.lock");
    const holder = spawnStandIn(30);
    writeFileSync(lockfile, `${holder.pid} ${Math.floor(Date.now() / 1000)}\n`);

    // `[ "$age" -lt "abc" ]` emits "integer expression expected" and returns
    // non-zero, which under `set -e` would kill the whole tick.
    const res = runAcquire(lockfile, "abc");

    assert.equal(res.status, 0, "a junk budget must not abort the run");
    assert.match(res.stdout, /non-numeric run budget/);
    assert.match(res.stdout, /Previous run still active, skipping/);

    holder.kill("SIGKILL");
  });

  it("can enumerate children without pgrep", () => {
    // procps is absent from some poller images; the helper must not silently
    // degrade to a parent-only kill there.
    const helper = readFileSync(LOCK_HELPER, "utf8");
    assert.match(helper, /command -v pgrep/);
    assert.match(helper, /ps -eo pid=,ppid=/);
  });

  it("captures the process tree before signalling, not after", () => {
    // Once the holding shell dies its children are reparented to init and can
    // no longer be found by walking down from the holder.
    const helper = readFileSync(LOCK_HELPER, "utf8");
    const collectAt = helper.indexOf('_run_lock_collect_tree "$holder_pid"');
    const signalAt = helper.indexOf("_run_lock_signal_pids TERM");
    assert.ok(collectAt > 0 && signalAt > 0);
    assert.ok(collectAt < signalAt, "tree must be captured before the first signal");
  });
});
