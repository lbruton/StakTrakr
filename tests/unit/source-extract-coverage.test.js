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

    const branches = [...api.matchAll(/^BRDA:(\d+),[^,]*,[^,]*,(\d+)$/gm)].map(
      ([, line, taken]) => [Number(line), Number(taken)]
    );
    const inSlice = (line) => line >= startLine && line <= endLine;
    assert.ok(
      branches.some(([line, taken]) => inSlice(line) && taken > 0),
      `a branch between lines ${startLine} and ${endLine} is hit`
    );
    assert.deepEqual(
      branches.filter(([line]) => !inSlice(line)),
      [],
      "the harness's unreached tail after the slice is not a branch"
    );
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
  "function d(x) {",
  "  if (x) {",
  "    return 1;",
  "  }",
  "  return 2;",
  "}",
  "if (globalThis.neverSet) {",
  "  d(0);",
  "}",
  "",
].join("\n");

const at = (text) => DEMO_SOURCE.indexOf(text);
const range = (startOffset, endOffset, count) => ({ startOffset, endOffset, count });
const D_END = at("\n}\nif") + 2;
const D_IF_START = at("{\n    return 1;");
const D_IF_END = at("  }\n  return 2;") + 3;
const TOP_IF = range(at("{\n  d(0);"), at("d(0);\n}") + 7, 0);

const fnRange = (name, count, inner = []) => {
  const start = at(`function ${name}(`);
  return {
    functionName: name,
    isBlockCoverage: true,
    ranges: [
      range(start, name === "d" ? D_END : DEMO_SOURCE.indexOf("\n}", start) + 2, count),
      ...inner,
    ],
  };
};

/**
 * One process's raw V8 coverage file: the harness top level plus the named counts.
 * `d` runs once; `dBlock` is the only inner range V8 emits for it, the path not taken.
 */
const rawFile = (url, counts, { topEnd = DEMO_SOURCE.length, dBlock } = {}) => ({
  result: [
    { scriptId: "1", url: "node:internal/main", functions: [] },
    {
      scriptId: "2",
      url,
      functions: [
        { functionName: "", isBlockCoverage: true, ranges: [range(0, topEnd, 1), TOP_IF] },
        ...Object.entries(counts).map(([name, count]) => fnRange(name, count)),
        fnRange("d", 1, [dBlock]),
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
    // The first process calls d(true), the second d(false).
    writeFileSync(
      path.join(root, "raw", "coverage-1.json"),
      JSON.stringify(
        rawFile(demoPath, { a: 3, b: 0, c: 0 }, { dBlock: range(D_IF_END, D_END - 1, 0) })
      )
    );
    writeFileSync(
      path.join(root, "raw", "coverage-2.json"),
      JSON.stringify(
        rawFile(
          pathToFileURL(demoPath).href,
          { a: 0, b: 1, c: 0 },
          { topEnd: DEMO_SOURCE.length + 40, dBlock: range(D_IF_START, D_IF_END, 0) }
        )
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
    assert.equal(hits.get(13), 1, "d's if body ran in the first process");
    assert.equal(hits.get(15), 1, "d's fall-through ran in the second process");

    const branches = Object.fromEntries(
      [...lcov.matchAll(/^BRDA:(\d+),[^,]*,[^,]*,(\d+)$/gm)].map(([, line, taken]) => [
        line,
        Number(taken),
      ])
    );
    assert.deepEqual(
      branches,
      { 12: 1, 14: 1, 17: 0 },
      "each path of d ran in one process; the top-level if body never ran"
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
