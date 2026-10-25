// Tree guard: a test run may write only to ignored temp output. Every case runs in a
// throwaway git repository under the OS temp directory.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkTree, snapshotTree, strayWrites } from "../../devops/testing/tree-guard.mjs";

const GUARD = fileURLToPath(new URL("../../devops/testing/tree-guard.mjs", import.meta.url));

let repo;

const git = (...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.email=guard@example.test",
      "-c",
      "user.name=guard",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repo, encoding: "utf8" }
  );

const write = (rel, body) => {
  mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  writeFileSync(path.join(repo, rel), body);
};

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "strk-tree-guard-"));
  git("init", "-q");
  write(".gitignore", "test-results/\n");
  write("playground/shot.png", "v1");
  write("js/app.js", "app");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("strayWrites", () => {
  test("a run that writes nothing reports nothing", () => {
    const before = snapshotTree(repo);
    assert.deepEqual(strayWrites(before, snapshotTree(repo)), []);
  });

  test("rewriting a tracked file is a stray write", () => {
    const before = snapshotTree(repo);
    write("playground/shot.png", "v2");
    assert.deepEqual(strayWrites(before, snapshotTree(repo)), ["playground/shot.png"]);
  });

  test("a new untracked file is a stray write, in any directory", () => {
    const before = snapshotTree(repo);
    write("tests/output/new.png", "x");
    write("notes.txt", "x");
    assert.deepEqual(strayWrites(before, snapshotTree(repo)), [
      "notes.txt",
      "tests/output/new.png",
    ]);
  });

  test("ignored temp output is not a stray write", () => {
    const before = snapshotTree(repo);
    write("test-results/shot.png", "x");
    assert.deepEqual(strayWrites(before, snapshotTree(repo)), []);
  });

  test("deleting a tracked file is a stray write", () => {
    const before = snapshotTree(repo);
    unlinkSync(path.join(repo, "js/app.js"));
    assert.deepEqual(strayWrites(before, snapshotTree(repo)), ["js/app.js"]);
  });

  test("an edit made before the run is not reported unless the run changes it", () => {
    write("js/app.js", "work in progress");
    const before = snapshotTree(repo);
    assert.deepEqual(strayWrites(before, snapshotTree(repo)), []);
    write("js/app.js", "overwritten by a test");
    assert.deepEqual(strayWrites(before, snapshotTree(repo)), ["js/app.js"]);
  });

  test("restoring a file edited before the run is a stray write", () => {
    write("js/app.js", "work in progress");
    const before = snapshotTree(repo);
    git("checkout", "--", "js/app.js");
    assert.deepEqual(strayWrites(before, snapshotTree(repo)), ["js/app.js"]);
  });
});

describe("checkTree", () => {
  test("returns null for a clean run and a message naming each stray path otherwise", () => {
    const before = snapshotTree(repo);
    assert.equal(checkTree(before, repo), null);
    write("playground/shot.png", "v2");
    const message = checkTree(before, repo);
    assert.match(message, /playground\/shot\.png/);
    assert.match(message, /testInfo\.outputPath|os\.tmpdir/);
  });

  test("outside a git work tree the snapshot is null and the check is skipped", () => {
    const plain = mkdtempSync(path.join(tmpdir(), "strk-tree-guard-plain-"));
    try {
      assert.equal(snapshotTree(plain), null);
      assert.equal(checkTree(null, plain), null);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("node --test global setup", () => {
  const run = (body) => {
    write("probe.test.mjs", `import { test } from "node:test";\n${body}\n`);
    git("add", "probe.test.mjs");
    git("commit", "-q", "-m", "probe");
    // Without this the child reports to the outer runner.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    return spawnSync(
      process.execPath,
      ["--test", `--test-global-setup=${GUARD}`, "probe.test.mjs"],
      { cwd: repo, env, encoding: "utf8" }
    );
  };

  test("a test that writes a tracked file fails the run and names the file", () => {
    const res = run(
      'import { writeFileSync } from "node:fs";\ntest("w", () => writeFileSync("playground/shot.png", "v2"));'
    );
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /playground\/shot\.png/);
  });

  test("a test that writes only ignored output passes", () => {
    const res = run(
      'import { mkdirSync, writeFileSync } from "node:fs";\ntest("w", () => { mkdirSync("test-results", { recursive: true }); writeFileSync("test-results/a.png", "x"); });'
    );
    assert.equal(res.status, 0, res.stdout + res.stderr);
  });
});
