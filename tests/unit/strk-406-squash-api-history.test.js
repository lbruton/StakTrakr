// Unit tests for the monthly api-branch history squash (STRK-406).
//
// lbruton/StakTrakrApi grows ~0.85 GB/month because the Fly publisher commits
// every 15-minute export to the `api` branch. GitHub Pages serves only the tip
// tree, so replacing the whole history with one orphan commit that carries the
// SAME tree is invisible to consumers and lets GitHub reclaim the old objects.
//
// `squash-api-history.sh` does that squash. The riskiest failure is a push that
// succeeds while the local ref still points at the old chain: the next publish
// would see HEAD != origin/api and force-push the old history back over the
// squash. These tests therefore pin the local-ref sync as well as the remote.
//
// Run: npm run test:unit
//
// The tests drive the real bash script against throwaway bare repos on disk
// (a depth-1 clone as REPO_DIR, mirroring the Fly publisher). Nothing touches
// the network or the real StakTrakrApi remote.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SQUASH_SCRIPT = join(
  REPO_ROOT,
  "devops",
  "pollers",
  "remote-poller",
  "squash-api-history.sh"
);
const BRANCH = "api";

let workDir;
let remoteDir; // bare "GitHub" remote
let seedDir; // a full clone used to author history and to advance the remote
let repoDir; // the depth-1 export repo the script runs against
let markerFile;

/**
 * Run git in a directory and return trimmed stdout.
 *
 * @param {string} cwd Directory to run in.
 * @param {...string} args git arguments.
 * @returns {string} Trimmed stdout.
 */
function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/**
 * Commit a file in the given clone and push it (force) to the remote's api branch.
 *
 * @param {string} cwd Clone to commit in.
 * @param {string} name File name to write.
 * @param {string} body File contents.
 */
function publish(cwd, name, body) {
  writeFileSync(join(cwd, name), body);
  git(cwd, "add", name);
  git(cwd, "commit", "-q", "-m", `publish ${name}`);
  git(cwd, "push", "-q", "--force", remoteDir, `HEAD:${BRANCH}`);
}

/**
 * Run squash-api-history.sh against the fixture repo.
 *
 * @param {Object<string, string>} [extraEnv] Environment overrides.
 * @returns {{status: number, out: string}} Exit status and combined output.
 */
function runSquash(extraEnv = {}) {
  const res = spawnSync("bash", [SQUASH_SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: workDir,
      REPO_DIR: repoDir,
      REMOTE: remoteDir,
      PUBLISH_BRANCH: BRANCH,
      MARKER_FILE: markerFile,
      ...extraEnv,
    },
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

/** @returns {string} The api tip SHA on the remote. */
function remoteTip() {
  return git(remoteDir, "rev-parse", `refs/heads/${BRANCH}`);
}

/** @returns {string} Number of commits reachable from the remote api tip. */
function remoteCommitCount() {
  return git(remoteDir, "rev-list", "--count", `refs/heads/${BRANCH}`);
}

describe("STRK-406 squash-api-history.sh", () => {
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "strk406-"));
    remoteDir = join(workDir, "remote.git");
    seedDir = join(workDir, "seed");
    repoDir = join(workDir, "export");
    markerFile = join(workDir, "squash-month");

    git(workDir, "init", "-q", "--bare", "-b", BRANCH, remoteDir);
    git(workDir, "init", "-q", "-b", BRANCH, seedDir);
    git(seedDir, "config", "user.name", "test");
    git(seedDir, "config", "user.email", "test@example.com");
    publish(seedDir, "data-1.json", "one\n");
    publish(seedDir, "data-2.json", "two\n");
    publish(seedDir, "data-3.json", "three\n");

    // The export repo on Fly is a depth-1 clone of the api tip.
    git(workDir, "clone", "-q", "--depth", "1", "--branch", BRANCH, `file://${remoteDir}`, repoDir);
    git(repoDir, "config", "user.name", "test");
    git(repoDir, "config", "user.email", "test@example.com");
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("replaces history with one root commit that has the identical tree", () => {
    const treeBefore = git(remoteDir, "rev-parse", `refs/heads/${BRANCH}^{tree}`);
    assert.equal(remoteCommitCount(), "3");

    const { status } = runSquash();

    assert.equal(status, 0);
    assert.equal(remoteCommitCount(), "1", "remote api should be a single root commit");
    assert.equal(git(remoteDir, "rev-parse", `refs/heads/${BRANCH}^{tree}`), treeBefore);
  });

  it("moves the local api ref and HEAD onto the squash commit", () => {
    const headBefore = git(repoDir, "rev-parse", "HEAD");

    runSquash();

    assert.notEqual(remoteTip(), headBefore, "squash must produce a new commit");
    assert.equal(git(repoDir, "rev-parse", "HEAD"), remoteTip());
    assert.equal(git(repoDir, "rev-parse", `refs/heads/${BRANCH}`), remoteTip());
    assert.equal(git(repoDir, "status", "--porcelain"), "", "work tree must be untouched");
  });

  it("lets the next publish fast-forward on top of the squash commit", () => {
    runSquash();
    const squashTip = remoteTip();

    publish(repoDir, "data-4.json", "four\n");

    assert.equal(remoteCommitCount(), "2");
    assert.equal(git(remoteDir, "rev-parse", `refs/heads/${BRANCH}~1`), squashTip);
  });

  it("records the month and skips a second run in the same month", () => {
    runSquash();
    assert.match(readFileSync(markerFile, "utf8").trim(), /^\d{4}-\d{2}$/);

    publish(repoDir, "data-4.json", "four\n");
    const tipBefore = remoteTip();
    const { status, out } = runSquash();

    assert.equal(status, 0);
    assert.equal(remoteTip(), tipBefore, "second run in the same month must not rewrite history");
    assert.match(out, /already squashed/i);
  });

  it("FORCE_SQUASH=1 overrides the month marker", () => {
    runSquash();
    publish(repoDir, "data-4.json", "four\n");
    assert.equal(remoteCommitCount(), "2");

    const { status } = runSquash({ FORCE_SQUASH: "1" });

    assert.equal(status, 0);
    assert.equal(remoteCommitCount(), "1");
  });

  it("warns, exits 0 and changes nothing when the push lease fails", () => {
    // Advance the remote behind the export repo's back so the lease mismatches.
    publish(seedDir, "data-concurrent.json", "x\n");
    const remoteBefore = remoteTip();
    const localBefore = git(repoDir, "rev-parse", "HEAD");

    const { status, out } = runSquash();

    assert.equal(status, 0, "a failed squash must not fail the cleanup/publish");
    assert.match(out, /WARN/);
    assert.equal(remoteTip(), remoteBefore, "remote must not be rewritten");
    assert.equal(git(repoDir, "rev-parse", "HEAD"), localBefore, "local ref must be unchanged");
    assert.equal(existsSync(markerFile), false, "marker must not be written so it retries");
  });

  it("logs git's push error so a rejected squash is diagnosable (STRK-406 first run: GH013)", () => {
    publish(seedDir, "data-concurrent.json", "x\n");

    const { out } = runSquash();

    assert.match(out, /WARN.*squash push/i);
    assert.match(out, /failed to push some refs/, "git's own error must reach the log");
  });

  it("redacts GITHUB_TOKEN from the logged push error", () => {
    publish(seedDir, "data-concurrent.json", "x\n");
    // The token is a substring of the remote path, which git echoes in its error.
    const { out } = runSquash({ GITHUB_TOKEN: "remote.git" });

    assert.match(out, /failed to push some refs/);
    assert.doesNotMatch(out, /remote\.git/, "token must never appear in the log");
    assert.match(out, /\*\*\*/);
  });

  it("redacts URL credentials supplied through REMOTE even when GITHUB_TOKEN is unset", () => {
    // Nothing listens on port 1, so git fails to connect and echoes the URL.
    const { out } = runSquash({ REMOTE: "https://s3cr3tuser@127.0.0.1:1/x.git", GITHUB_TOKEN: "" });

    assert.match(out, /WARN.*squash push/i);
    assert.doesNotMatch(out, /s3cr3tuser/, "REMOTE credentials must never appear in the log");
  });

  it("skips with a warning when there is no GITHUB_TOKEN and no REMOTE override", () => {
    const tipBefore = remoteTip();

    const { status, out } = runSquash({ REMOTE: "", GITHUB_TOKEN: "" });

    assert.equal(status, 0);
    assert.match(out, /WARN.*GITHUB_TOKEN/);
    assert.equal(remoteTip(), tipBefore);
    assert.equal(existsSync(markerFile), false);
  });
});
