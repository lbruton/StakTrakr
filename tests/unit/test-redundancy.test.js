// Redundancy report for `npm run test:redundancy`: per spec file, the blocks only one
// test covers and the tests whose blocks are a subset of another test's. Everything
// here runs on an inline block file; no browser and no coverage run.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  analyzeRedundancy,
  renderMarkdown,
  writeReport,
} from "../../devops/testing/test-redundancy.mjs";

const SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ALPHA = "tests/playwright/core/alpha.spec.js";
const BETA = "tests/playwright/core/beta.spec.js";
const A = `${ALPHA}:5`;
const B = `${ALPHA}:12`;
const C = `${ALPHA}:20`;
const D = `${BETA}:3`;

// In alpha, A covers s1-s3, B covers s1-s2 (a subset of A) and C covers s1 and s4.
// Beta's D also covers s4, so C's s4 is unique within alpha but not across the suite.
const BLOCKS = {
  sha: SHA,
  tests: [
    { id: A, blocks: ["js/demo.js:0-10", "js/demo.js:10-20", "js/demo.js:20-30"] },
    { id: B, blocks: ["js/demo.js:0-10", "js/demo.js:10-20"] },
    { id: C, blocks: ["js/demo.js:0-10", "js/other.js:0-40"] },
    { id: D, blocks: ["js/other.js:0-40"] },
  ],
};
const TITLES = { [A]: "alpha › full", [B]: "alpha › partial", [C]: "alpha › other path" };

const testsOf = (report, spec) =>
  Object.fromEntries(report.specs.find((s) => s.file === spec).tests.map((t) => [t.id, t]));

describe("redundancy analysis", () => {
  test("groups tests by spec file and counts each test's unique blocks", () => {
    const report = analyzeRedundancy(BLOCKS, TITLES);
    assert.equal(report.sha, SHA);
    assert.deepEqual(report.specs.map((s) => s.file).sort(), [ALPHA, BETA]);
    const alpha = testsOf(report, ALPHA);
    assert.equal(alpha[A].unique, 1, "A alone covers s3");
    assert.equal(alpha[B].unique, 0, "B covers nothing A or C misses");
    assert.equal(alpha[C].unique, 1, "C alone in alpha covers s4");
    assert.equal(alpha[A].title, "alpha › full");
  });

  test("counts suite-wide unique blocks across spec files", () => {
    const report = analyzeRedundancy(BLOCKS, TITLES);
    assert.equal(testsOf(report, ALPHA)[C].suiteUnique, 0, "beta's D also covers s4");
    assert.equal(testsOf(report, ALPHA)[A].suiteUnique, 1);
  });

  test("names the tests whose blocks are a subset of another test's in the same spec", () => {
    const report = analyzeRedundancy(BLOCKS, TITLES);
    const alpha = testsOf(report, ALPHA);
    assert.deepEqual(alpha[B].subsetOf, [A]);
    assert.deepEqual(alpha[A].subsetOf, []);
    assert.deepEqual(alpha[C].subsetOf, []);
    assert.deepEqual(testsOf(report, BETA)[D].subsetOf, [], "subsets stay within one spec");
  });

  test("ranks candidates with zero-unique tests first", () => {
    const { candidates } = analyzeRedundancy(BLOCKS, TITLES);
    assert.equal(candidates.length, 4);
    assert.equal(candidates[0].id, B);
    assert.deepEqual(candidates[0].subsetOf, [A]);
    const uniques = candidates.map((c) => c.unique);
    assert.deepEqual(
      uniques,
      [...uniques].sort((x, y) => x - y),
      "candidates are ordered by unique blocks"
    );
  });
});

describe("redundancy report output", () => {
  test("the Markdown states that equal coverage does not prove equal assertions", () => {
    const md = renderMarkdown(analyzeRedundancy(BLOCKS, TITLES));
    assert.match(md, /equal coverage does not prove equal assertions/i);
    assert.match(md, new RegExp(`${B}.*${A}`), "the subset pair is listed");
    assert.match(md, /alpha › partial/);
  });

  test("writes valid JSON and Markdown from the block file and the test map", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "strk-redundancy-"));
    try {
      const blocksPath = path.join(dir, "test-blocks.json");
      const mapPath = path.join(dir, "test-map.json");
      writeFileSync(blocksPath, JSON.stringify(BLOCKS));
      writeFileSync(
        mapPath,
        JSON.stringify({
          sha: SHA,
          tests: Object.entries(TITLES).map(([id, title]) => ({ id, title, functions: [] })),
        })
      );
      const out = writeReport({ blocksPath, mapPath, outDir: path.join(dir, "coverage") });
      const json = JSON.parse(readFileSync(out.json, "utf-8"));
      assert.equal(json.sha, SHA);
      assert.equal(json.candidates[0].id, B);
      assert.equal(json.candidates[0].title, "alpha › partial");
      assert.match(readFileSync(out.md, "utf-8"), /equal assertions/i);
      assert.equal(path.basename(out.json), "redundancy.json");
      assert.equal(path.basename(out.md), "redundancy.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
