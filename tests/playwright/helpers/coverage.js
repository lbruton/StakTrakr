/**
 * Per-test V8 JS coverage for the Playwright suites.
 *
 * With `COVERAGE=1`, `app-test.js` collects coverage on every app page and writes
 * one raw record per test under `coverage/raw/`. `devops/testing/coverage-merge.mjs`
 * turns the records into lcov, the test map and the block file.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_SCRIPT_PATH = /^\/js\/[^/]+\.js$/;

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const RAW_COVERAGE_DIR = path.join(REPO_ROOT, "coverage", "raw");

/**
 * True only when the run asked for coverage.
 * @param {Record<string, string | undefined>} [env] - Environment to read.
 * @returns {boolean}
 */
export function isCoverageEnabled(env = process.env) {
  return env.COVERAGE === "1";
}

/**
 * Keeps the entries for top-level `js/` scripts served from the app origin.
 * Entries stay whole: zero-count ranges mark the code inside them that never ran.
 * @param {Array<{url: string}>} entries - V8 entries from `stopJSCoverage()`.
 * @param {string} origin - App base URL.
 * @returns {Array<{url: string}>}
 */
export function appCoverageEntries(entries, origin) {
  const appOrigin = new URL(origin).origin;
  return entries.filter((entry) => {
    if (!URL.canParse(entry.url)) return false;
    const url = new URL(entry.url);
    return url.origin === appOrigin && APP_SCRIPT_PATH.test(url.pathname);
  });
}

/**
 * Builds the raw record for one test.
 * @param {{file: string, line: number, titlePath: string[]}} testInfo - Playwright TestInfo.
 * @param {string} root - Repository root; the spec path is stored relative to it.
 * @param {object[]} entries - Filtered V8 entries.
 * @returns {{test: {file: string, line: number, title: string}, entries: object[]}}
 */
export function rawRecordFor(testInfo, root, entries) {
  return {
    test: {
      file: path.relative(root, testInfo.file).split(path.sep).join("/"),
      line: testInfo.line,
      title: testInfo.titlePath.slice(1).join(" › "),
    },
    entries,
  };
}

/**
 * Writes one record to its own file, so parallel workers never share a file.
 * @param {string} dir - Output directory, created when missing.
 * @param {object} record - Record from `rawRecordFor`.
 * @returns {string} Path of the written file.
 */
export function writeRawRecord(dir, record) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(record));
  return file;
}
