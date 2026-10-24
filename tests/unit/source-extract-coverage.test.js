// Unit coverage: devops/testing/run-unit.mjs merges the raw V8 coverage of every test
// process into lcov. The merge must credit js/ files evaluated through the unit
// harness, whole or by slice, and keep the union of slices that different processes
// evaluate from one file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeUnitCoverage } from "../../devops/testing/run-unit.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const HELPER_URL = pathToFileURL(path.join(ROOT, "tests/unit/helpers/source-extract.js")).href;
const API_PATH = path.join(ROOT, "js/api.js");

const CHILD_TEST = `
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { evalConstantsWindow, extractConstFn } from ${JSON.stringify(HELPER_URL)};

test("loads constants and runs a sliced function", () => {
  const { METALS } = evalConstantsWindow();
  const src = readFileSync(${JSON.stringify(API_PATH)}, "utf-8");
  const hoursBackFor = extractConstFn(src, "_staktrakrBackfillHoursBack", { METALS }, { file: "js/api.js" });
  hoursBackFor(
    [
      { source: "seed", metal: "Gold", timestamp: "2026-08-16 11:00:00" },
      { source: "api-hourly", metal: "Gold", timestamp: "2026-08-16 11:00:00" },
    ],
    Date.UTC(2026, 7, 16, 12, 0, 0)
  );
});
`;

/** Returns the lcov section for the first SF path that ends with `suffix`. */
const lcovSection = (lcov, suffix) =>
  lcov.split("end_of_record").find((part) => {
    const sf = part.match(/^SF:(.*)$/m);
    return sf && (sf[1] === suffix || sf[1].endsWith(`/${suffix}`));
  });

/** Line hit counts of one lcov section. */
const lineHits = (section) =>
  new Map(
    [...section.matchAll(/^DA:(\d+),(\d+)/gm)].map(([, line, count]) => [
      Number(line),
      Number(count),
    ])
  );

/** 1-based line of the first occurrence of `needle` at or after `from`. */
const lineOf = (src, needle, from = 0) => {
  const at = src.indexOf(needle, from);
  assert.notEqual(at, -1, `could not locate ${needle}`);
  return src.slice(0, at).split("\n").length;
};

test("unit lcov credits js/ files loaded whole and by slice", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "strk-unit-lcov-"));
  try {
    const child = path.join(dir, "child.test.mjs");
    const rawDir = path.join(dir, "raw");
    const lcovPath = path.join(dir, "lcov.info");
    writeFileSync(child, CHILD_TEST);
    // Without this the child reports to the outer runner.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const run = spawnSync(process.execPath, ["--test", child], {
      cwd: ROOT,
      env: { ...env, NODE_V8_COVERAGE: rawDir },
      encoding: "utf-8",
    });
    assert.equal(run.status, 0, `child test failed:\n${run.stdout}\n${run.stderr}`);
    await mergeUnitCoverage({ rawDir, outFile: lcovPath });
    const lcov = readFileSync(lcovPath, "utf-8");

    assert.ok(lcovSection(lcov, "js/constants.js"), "lcov has an SF entry for js/constants.js");

    const api = lcovSection(lcov, "js/api.js");
    assert.ok(api, "lcov has an SF entry for js/api.js");
    const src = readFileSync(API_PATH, "utf-8");
    const fnStart = src.indexOf("const _staktrakrBackfillHoursBack = ");
    const startLine = lineOf(src, "const _staktrakrBackfillHoursBack = ");
    const endLine = lineOf(src, "\n};", fnStart) + 1;
    const guardLine = lineOf(src, 'if (e.source !== "api-hourly") return;', fnStart);

    const hits = lineHits(api);
    assert.ok(hits.get(guardLine) > 0, `guard line ${guardLine} is hit`);
    assert.ok(hits.get(guardLine + 1) > 0, `line ${guardLine + 1} past the guard is hit`);
    const outside = [...hits].filter(
      ([line, count]) => count > 0 && (line < startLine || line > endLine)
    );
    assert.deepEqual(outside, [], "no line outside the slice is hit");

    const takenInSlice = [...api.matchAll(/^BRDA:(\d+),[^,]*,[^,]*,(\d+)$/gm)].filter(
      ([, line, taken]) => Number(line) >= startLine && Number(line) <= endLine && Number(taken) > 0
    );
    assert.ok(takenInSlice.length > 0, `a branch between lines ${startLine} and ${endLine} is hit`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Line numbers below are 1-based lines of DEMO_SOURCE.
const DEMO_SOURCE = [
  "function a() {",
  "  return 1;",
  "}",
  "function b() {",
  "  return 2;",
  "}",
  "function c() {",
  "  return 3;",
  "}",
  "// A comment is not a code line.",
  "",
].join("\n");

const fnRange = (name, count) => {
  const start = DEMO_SOURCE.indexOf(`function ${name}(`);
  return {
    functionName: name,
    isBlockCoverage: true,
    ranges: [{ startOffset: start, endOffset: DEMO_SOURCE.indexOf("\n}", start) + 2, count }],
  };
};

/** One process's raw V8 coverage file: the harness top level plus the named counts. */
const rawFile = (url, counts, topEnd = DEMO_SOURCE.length) => ({
  result: [
    { scriptId: "1", url: "node:internal/main", functions: [] },
    {
      scriptId: "2",
      url,
      functions: [
        {
          functionName: "",
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: topEnd, count: 1 }],
        },
        ...Object.entries(counts).map(([name, count]) => fnRange(name, count)),
      ],
    },
  ],
});

test("unit lcov keeps the union of slices run in different processes", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "strk-unit-merge-"));
  try {
    mkdirSync(path.join(root, "js"));
    mkdirSync(path.join(root, "raw"));
    const demoPath = path.join(root, "js", "demo.js");
    writeFileSync(demoPath, DEMO_SOURCE);
    // The harness compiles slices under a plain path; a module carries a file URL.
    // The second process's top level runs past the end of the file, as a suffix does.
    writeFileSync(
      path.join(root, "raw", "coverage-1.json"),
      JSON.stringify(rawFile(demoPath, { a: 3, b: 0, c: 0 }))
    );
    writeFileSync(
      path.join(root, "raw", "coverage-2.json"),
      JSON.stringify(
        rawFile(pathToFileURL(demoPath).href, { a: 0, b: 1, c: 0 }, DEMO_SOURCE.length + 40)
      )
    );
    const outFile = path.join(root, "out", "unit-lcov.info");
    await mergeUnitCoverage({ rawDir: path.join(root, "raw"), outFile, root });
    const lcov = readFileSync(outFile, "utf-8");

    assert.deepEqual(
      [...lcov.matchAll(/^SF:(.*)$/gm)].map(([, file]) => file),
      ["js/demo.js"]
    );
    const hits = lineHits(lcovSection(lcov, "js/demo.js"));
    assert.equal(hits.get(2), 1, "the first process's slice is hit, its count written as 1");
    assert.equal(hits.get(5), 1, "the second process's slice is hit");
    assert.equal(hits.get(8), 0, "a function neither process ran is not hit");
    assert.equal(hits.has(10), false, "the comment line under the run top level is not listed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
