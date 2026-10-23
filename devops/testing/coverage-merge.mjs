#!/usr/bin/env node
/**
 * Merges the per-test raw coverage records written by tests/playwright/helpers/coverage.js
 * into lcov for the js/ files, the test map (tests to executed functions) and the block
 * file (tests to covered V8 ranges) for the redundancy report.
 *
 * Usage: node devops/testing/coverage-merge.mjs [--no-map]
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CoverageReport } from "monocart-coverage-reports";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_FILE = /(?:^|\/)(js\/[^/?#]+\.js)$/;

/**
 * Repo-relative js/ path for a served script URL.
 * @param {string} url - Script URL from a V8 entry.
 * @returns {string}
 */
function appFileOf(url) {
  const match = new URL(url).pathname.match(APP_FILE);
  if (!match) throw new Error(`not a js/ script: ${url}`);
  return match[1];
}

/** Offset-to-line lookup for one source text (1-based lines). */
function lineIndex(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Reads the raw records, filling each entry's source from the record or the repository.
 * @param {string} rawDir - Directory of raw record files.
 * @param {string} root - Repository root for entries without `source`.
 * @returns {{records: object[], sources: Map<string, {source: string, lineOf: Function}>}}
 */
function loadRecords(rawDir, root) {
  const sources = new Map();
  const sourceFor = (file, inline) => {
    if (!sources.has(file)) {
      const source = inline ?? readFileSync(path.join(root, file), "utf-8");
      sources.set(file, { source, lineOf: lineIndex(source) });
    }
    return sources.get(file);
  };
  const records = readdirSync(rawDir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(path.join(rawDir, name), "utf-8")))
    .map((record) => ({
      test: record.test,
      entries: record.entries.map((entry) => {
        const file = appFileOf(entry.url);
        return {
          file,
          url: entry.url,
          functions: entry.functions,
          ...sourceFor(file, entry.source),
        };
      }),
    }));
  return { records, sources };
}

/**
 * Functions a test entered, without the script's own top-level function.
 * @param {object[]} entries - Loaded entries of one record.
 * @returns {Array<{file: string, name: string, startLine: number, endLine: number}>}
 */
function executedFunctions(entries) {
  const found = new Map();
  for (const { file, functions, source, lineOf } of entries) {
    for (const fn of functions) {
      const [{ startOffset, endOffset, count }] = fn.ranges;
      if (count === 0 || (startOffset === 0 && endOffset >= source.length)) continue;
      found.set(`${file}:${startOffset}`, {
        file,
        name: fn.functionName || "(anonymous)",
        startLine: lineOf(startOffset),
        endLine: lineOf(Math.max(startOffset, endOffset - 1)),
      });
    }
  }
  return [...found.values()].sort((a, b) =>
    a.file === b.file ? a.startLine - b.startLine : a.file.localeCompare(b.file)
  );
}

/**
 * Line ranges of every function in each file, run or not, without the top-level
 * function. Lets test selection tell a function no test runs from top-level code.
 * @param {object[]} records - Loaded records.
 * @returns {Record<string, Array<[number, number]>>}
 */
function functionRanges(records) {
  const byFile = new Map();
  for (const { entries } of records) {
    for (const { file, functions, source, lineOf } of entries) {
      if (!byFile.has(file)) byFile.set(file, new Map());
      const ranges = byFile.get(file);
      for (const fn of functions) {
        const [{ startOffset, endOffset }] = fn.ranges;
        if (startOffset === 0 && endOffset >= source.length) continue;
        ranges.set(startOffset, [
          lineOf(startOffset),
          lineOf(Math.max(startOffset, endOffset - 1)),
        ]);
      }
    }
  }
  return Object.fromEntries(
    [...byFile]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, ranges]) => [
        file,
        [...ranges.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      ])
  );
}

/**
 * Sorted range boundaries per js/ file across every test. They cut each file into the
 * same segments for every test, so block keys compare as plain strings.
 * @param {Array<[string, {entries: object[]}]>} tests - Tests from byTest.
 * @returns {Map<string, number[]>}
 */
function segmentBounds(tests) {
  const byFile = new Map();
  for (const [, { entries }] of tests) {
    for (const { file, functions } of entries) {
      if (!byFile.has(file)) byFile.set(file, new Set());
      const bounds = byFile.get(file);
      for (const fn of functions) {
        for (const range of fn.ranges) bounds.add(range.startOffset).add(range.endOffset);
      }
    }
  }
  return new Map([...byFile].map(([file, bounds]) => [file, [...bounds].sort((a, b) => a - b)]));
}

/**
 * Indexes of the segments whose innermost enclosing range ran. V8 omits a block whose
 * count equals its parent's, so only the innermost range tells a taken branch apart.
 * @param {object[]} functions - V8 functions of one entry.
 * @param {number[]} bounds - Segment boundaries of the entry's file.
 * @returns {number[]}
 */
function coveredSegments(functions, bounds) {
  const ranges = functions
    .flatMap((fn) => fn.ranges)
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const covered = [];
  const open = [];
  let next = 0;
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    while (open.length && open.at(-1).endOffset <= start) open.pop();
    while (next < ranges.length && ranges[next].startOffset <= start) {
      const range = ranges[next++];
      if (range.endOffset > start) open.push(range);
    }
    if (open.at(-1)?.count > 0) covered.push(i);
  }
  return covered;
}

/**
 * Covered segments of one test as `file:start-end` keys.
 * @param {object[]} entries - Loaded entries of one record.
 * @param {Map<string, number[]>} boundsByFile - Segment boundaries from segmentBounds.
 * @returns {string[]}
 */
function coveredBlocks(entries, boundsByFile) {
  const blocks = new Set();
  for (const { file, functions } of entries) {
    const bounds = boundsByFile.get(file);
    for (const i of coveredSegments(functions, bounds)) {
      blocks.add(`${file}:${bounds[i]}-${bounds[i + 1]}`);
    }
  }
  return [...blocks].sort();
}

/**
 * Groups records by test location; a retried test writes more than one record.
 * @param {object[]} records - Loaded records.
 * @returns {Map<string, {title: string, entries: object[]}>}
 */
function byTest(records) {
  const tests = new Map();
  for (const { test, entries } of records) {
    const id = `${test.file}:${test.line}`;
    if (!tests.has(id)) tests.set(id, { title: test.title, entries: [] });
    tests.get(id).entries.push(...entries);
  }
  return tests;
}

/**
 * Writes lcov for every js/ file the records touched.
 * @param {object[]} records - Loaded records.
 * @param {string} outDir - Output directory for lcov.info.
 * @returns {Promise<string>} lcov path.
 */
async function writeLcov(records, outDir) {
  const report = new CoverageReport({
    name: "StakTrakr core coverage",
    outputDir: outDir,
    reports: [["lcovonly", { file: "lcov.info" }]],
    sourcePath: (filePath) => filePath.match(APP_FILE)?.[1] ?? filePath,
    cleanCache: true,
    logging: "error",
  });
  for (const { entries } of records) {
    await report.add(
      entries.map(({ url, source, functions }) => ({ type: "js", url, source, functions }))
    );
  }
  await report.generate();
  return path.join(outDir, "lcov.info");
}

/**
 * Merges raw records into lcov, the test map and the block file.
 * @param {object} options
 * @param {string} options.rawDir - Raw record directory.
 * @param {string} options.outDir - Directory for lcov.info.
 * @param {string} options.mapDir - Directory for test-map.json and test-blocks.json.
 * @param {string} options.sha - Commit the records were built from.
 * @param {string} [options.root] - Repository root for sources missing from records.
 * @param {boolean} [options.map] - Also write the test map and block file.
 * @returns {Promise<{lcov: string, map?: string, blocks?: string}>}
 */
export async function mergeCoverage({ rawDir, outDir, mapDir, sha, root = REPO_ROOT, map = true }) {
  const { records } = loadRecords(rawDir, root);
  mkdirSync(outDir, { recursive: true });
  const lcov = await writeLcov(records, outDir);
  if (!map) return { lcov };

  const tests = [...byTest(records)];
  const mapPath = path.join(mapDir, "test-map.json");
  const blocksPath = path.join(mapDir, "test-blocks.json");
  mkdirSync(mapDir, { recursive: true });
  writeFileSync(
    mapPath,
    JSON.stringify({
      sha,
      files: functionRanges(records),
      tests: tests.map(([id, { title, entries }]) => ({
        id,
        title,
        functions: executedFunctions(entries),
      })),
    })
  );
  const boundsByFile = segmentBounds(tests);
  writeFileSync(
    blocksPath,
    JSON.stringify({
      sha,
      tests: tests.map(([id, { entries }]) => ({
        id,
        blocks: coveredBlocks(entries, boundsByFile),
      })),
    })
  );
  return { lcov, map: mapPath, blocks: blocksPath };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
  }).trim();
  const out = await mergeCoverage({
    rawDir: path.join(REPO_ROOT, "coverage", "raw"),
    outDir: path.join(REPO_ROOT, "coverage"),
    mapDir: path.join(REPO_ROOT, ".cache"),
    sha,
    map: !process.argv.includes("--no-map"),
  });
  for (const file of Object.values(out)) console.log(`wrote ${path.relative(REPO_ROOT, file)}`);
  rmSync(path.join(REPO_ROOT, "coverage", ".cache"), { recursive: true, force: true });
}
