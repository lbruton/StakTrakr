// Node's lcov reporter credits js/ files evaluated through the unit harness.
// A child test loads js/constants.js whole and one function sliced out of
// js/api.js, then the lcov must name both files and record the slice's branch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

/** 1-based line of the first occurrence of `needle` at or after `from`. */
const lineOf = (src, needle, from = 0) => {
  const at = src.indexOf(needle, from);
  assert.notEqual(at, -1, `could not locate ${needle}`);
  return src.slice(0, at).split("\n").length;
};

test("unit lcov credits js/ files loaded whole and by slice", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "strk-unit-lcov-"));
  try {
    const child = path.join(dir, "child.test.mjs");
    const lcovPath = path.join(dir, "lcov.info");
    writeFileSync(child, CHILD_TEST);
    // Without this the child reports to the outer runner and writes no lcov.
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    const run = spawnSync(
      process.execPath,
      [
        "--test",
        "--experimental-test-coverage",
        "--test-reporter=lcov",
        `--test-reporter-destination=${lcovPath}`,
        child,
      ],
      { cwd: ROOT, env, encoding: "utf-8" }
    );
    assert.equal(run.status, 0, `child test failed:\n${run.stdout}\n${run.stderr}`);
    const lcov = readFileSync(lcovPath, "utf-8");

    assert.ok(lcovSection(lcov, "js/constants.js"), "lcov has an SF entry for js/constants.js");

    const api = lcovSection(lcov, "js/api.js");
    assert.ok(api, "lcov has an SF entry for js/api.js");
    const src = readFileSync(API_PATH, "utf-8");
    const fnStart = src.indexOf("const _staktrakrBackfillHoursBack = ");
    const startLine = lineOf(src, "const _staktrakrBackfillHoursBack = ");
    const endLine = lineOf(src, "\n};", fnStart) + 1;
    const guardLine = lineOf(src, 'if (e.source !== "api-hourly") return;', fnStart);

    const hits = new Map(
      [...api.matchAll(/^DA:(\d+),(\d+)/gm)].map(([, line, count]) => [Number(line), Number(count)])
    );
    assert.ok(hits.get(guardLine) > 0, `guard line ${guardLine} is hit`);
    assert.ok(hits.get(guardLine + 1) > 0, `line ${guardLine + 1} past the guard is hit`);

    const takenInSlice = [...api.matchAll(/^BRDA:(\d+),[^,]*,[^,]*,(\d+)$/gm)].filter(
      ([, line, taken]) => Number(line) >= startLine && Number(line) <= endLine && Number(taken) > 0
    );
    assert.ok(takenInSlice.length > 0, `a branch between lines ${startLine} and ${endLine} is hit`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
