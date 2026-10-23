// Per-test coverage: the Playwright helper that filters and writes one raw V8
// record per test, and the merge script that turns those records into lcov, the
// test map and the block file.
//
// Raw records keep whole js/ entries, zero-count functions included: V8 marks
// code that never ran with zero-count ranges nested in a covered parent range,
// so dropping them would credit every uncalled function to the top-level script.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appCoverageEntries,
  isCoverageEnabled,
  rawRecordFor,
  writeRawRecord,
} from "../playwright/helpers/coverage.js";
import { mergeCoverage } from "../../devops/testing/coverage-merge.mjs";

const ORIGIN = "http://localhost:8123";
const ROOT = "/repo";
const SHA = "0123456789abcdef0123456789abcdef01234567";

// Line numbers below are 1-based lines of DEMO_SOURCE.
const DEMO_SOURCE = [
  "function used(x) {",
  "  return x + 1;",
  "}",
  "function other(x) {",
  "  return x * 2;",
  "}",
  "function unused() {",
  "  return 0;",
  "}",
  "used(1);",
  "",
].join("\n");

const fnRange = (name, count) => {
  const start = DEMO_SOURCE.indexOf(`function ${name}(`);
  const end = DEMO_SOURCE.indexOf("\n}", start) + 2;
  return {
    functionName: name,
    isBlockCoverage: true,
    ranges: [{ startOffset: start, endOffset: end, count }],
  };
};

const demoEntry = (calls) => ({
  url: `${ORIGIN}/js/demo.js`,
  scriptId: "1",
  source: DEMO_SOURCE,
  functions: [
    {
      functionName: "",
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: DEMO_SOURCE.length, count: 1 }],
    },
    fnRange("used", calls.used || 0),
    fnRange("other", calls.other || 0),
    fnRange("unused", 0),
  ],
});

const testInfo = (file, line, ...titles) => ({
  file: path.join(ROOT, file),
  line,
  titlePath: [path.basename(file), ...titles],
});

const RECORD_A = rawRecordFor(
  testInfo("tests/playwright/core/demo.spec.js", 12, "demo", "calls used"),
  ROOT,
  [demoEntry({ used: 1 })]
);
const RECORD_B = rawRecordFor(
  testInfo("tests/playwright/core/demo.spec.js", 30, "demo", "calls both"),
  ROOT,
  [demoEntry({ used: 2, other: 1 })]
);

/** Writes both records, merges them and returns the three outputs as text. */
async function mergeFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "strk-coverage-"));
  try {
    const rawDir = path.join(dir, "raw");
    writeRawRecord(rawDir, RECORD_A);
    writeRawRecord(rawDir, RECORD_B);
    const out = await mergeCoverage({
      rawDir,
      outDir: path.join(dir, "coverage"),
      mapDir: path.join(dir, ".cache"),
      sha: SHA,
    });
    return {
      lcov: readFileSync(out.lcov, "utf-8"),
      map: JSON.parse(readFileSync(out.map, "utf-8")),
      blocks: JSON.parse(readFileSync(out.blocks, "utf-8")),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lcovHits = (lcov, file) => {
  const section = lcov.split("end_of_record").find((part) => part.includes(`SF:${file}\n`));
  assert.ok(section, `lcov has no SF:${file} section`);
  return new Map(
    [...section.matchAll(/^DA:(\d+),(\d+)/gm)].map(([, line, count]) => [
      Number(line),
      Number(count),
    ])
  );
};

describe("coverage helpers", () => {
  test("collection is off unless COVERAGE is 1", () => {
    assert.equal(isCoverageEnabled({}), false);
    assert.equal(isCoverageEnabled({ COVERAGE: "" }), false);
    assert.equal(isCoverageEnabled({ COVERAGE: "0" }), false);
    assert.equal(isCoverageEnabled({ COVERAGE: "1" }), true);
  });

  test("keeps only top-level js/ files served from the app origin", () => {
    const entry = (url) => ({ url, scriptId: url, source: "", functions: [] });
    const kept = appCoverageEntries(
      [
        entry(`${ORIGIN}/js/demo.js`),
        entry(`${ORIGIN}/js/demo.js?v=3`),
        entry(`${ORIGIN}/sw.js`),
        entry(`${ORIGIN}/vendor/chart.umd.js`),
        entry(`${ORIGIN}/js/vendor/nested.js`),
        entry("https://cdn.jsdelivr.net/js/demo.js"),
        entry(""),
      ],
      ORIGIN
    );
    assert.deepEqual(
      kept.map((e) => e.url),
      [`${ORIGIN}/js/demo.js`, `${ORIGIN}/js/demo.js?v=3`]
    );
  });

  test("keeps zero-count functions so uncalled code stays uncovered", () => {
    const [kept] = appCoverageEntries([demoEntry({ used: 1 })], ORIGIN);
    assert.deepEqual(
      kept.functions.map((f) => [f.functionName, f.ranges[0].count]),
      [
        ["", 1],
        ["used", 1],
        ["other", 0],
        ["unused", 0],
      ]
    );
  });

  test("a raw record names the test by repo-relative file, line and title", () => {
    assert.deepEqual(RECORD_A.test, {
      file: "tests/playwright/core/demo.spec.js",
      line: 12,
      title: "demo › calls used",
    });
    assert.equal(RECORD_A.entries.length, 1);
  });

  test("each record is written to its own file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "strk-coverage-"));
    try {
      writeRawRecord(dir, RECORD_A);
      writeRawRecord(dir, RECORD_B);
      writeRawRecord(dir, RECORD_B);
      assert.equal(readdirSync(dir).filter((name) => name.endsWith(".json")).length, 3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("coverage merge", () => {
  test("lcov names js/ files repo-relative and counts hits across tests", async () => {
    const { lcov } = await mergeFixture();
    const hits = lcovHits(lcov, "js/demo.js");
    assert.ok(hits.get(2) > 0, "line 2 (used) is hit");
    assert.ok(hits.get(5) > 0, "line 5 (other) is hit");
    assert.equal(hits.get(8), 0, "line 8 (unused) is not hit");
    assert.doesNotMatch(lcov, /^SF:(?!js\/).*/m, "every SF line is a js/ path");
  });

  test("the test map lists each test's location and executed functions", async () => {
    const { map } = await mergeFixture();
    assert.equal(map.sha, SHA);
    const byId = Object.fromEntries(map.tests.map((t) => [t.id, t]));
    assert.deepEqual(Object.keys(byId).sort(), [
      "tests/playwright/core/demo.spec.js:12",
      "tests/playwright/core/demo.spec.js:30",
    ]);
    assert.equal(byId["tests/playwright/core/demo.spec.js:12"].title, "demo › calls used");
    assert.deepEqual(byId["tests/playwright/core/demo.spec.js:12"].functions, [
      { file: "js/demo.js", name: "used", startLine: 1, endLine: 3 },
    ]);
    assert.deepEqual(byId["tests/playwright/core/demo.spec.js:30"].functions, [
      { file: "js/demo.js", name: "used", startLine: 1, endLine: 3 },
      { file: "js/demo.js", name: "other", startLine: 4, endLine: 6 },
    ]);
  });

  test("the block file lists covered ranges per test", async () => {
    const { blocks } = await mergeFixture();
    assert.equal(blocks.sha, SHA);
    const byId = Object.fromEntries(blocks.tests.map((t) => [t.id, new Set(t.blocks)]));
    const a = byId["tests/playwright/core/demo.spec.js:12"];
    const b = byId["tests/playwright/core/demo.spec.js:30"];
    assert.ok(a.size > 0, "test A has covered blocks");
    assert.ok(
      [...a].every((block) => b.has(block)),
      "A's blocks are a subset of B's"
    );
    assert.ok(b.size > a.size, "B covers a block A does not");
    assert.ok(
      [...b].every((block) => block.startsWith("js/demo.js:")),
      "blocks are keyed by file"
    );
  });
});
