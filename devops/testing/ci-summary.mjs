#!/usr/bin/env node
/**
 * Writes the Tests job summary: core counts, flaky tests and the workflow wall time.
 *
 * Usage: node devops/testing/ci-summary.mjs <playwright-json-report> [run-started-at]
 * Prints Markdown to stdout; the workflow appends it to $GITHUB_STEP_SUMMARY.
 */

import { readFileSync } from "node:fs";

/**
 * Collects every test result from a Playwright JSON report.
 * @param {object} report - Parsed JSON report.
 * @returns {Array<{title: string, file: string, line: number, status: string}>}
 */
function collectTests(report) {
  const tests = [];
  const walk = (suite, titles) => {
    const path = suite.title ? [...titles, suite.title] : titles;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        tests.push({
          title: [...path.slice(1), spec.title].join(" › "),
          file: spec.file,
          line: spec.line,
          status: test.status,
        });
      }
    }
    for (const child of suite.suites || []) walk(child, path);
  };
  for (const suite of report.suites || []) walk(suite, []);
  return tests;
}

const [reportPath, startedAt] = process.argv.slice(2);
const tests = collectTests(JSON.parse(readFileSync(reportPath, "utf-8")));
const count = (status) => tests.filter((t) => t.status === status).length;
const flaky = tests.filter((t) => t.status === "flaky");

const lines = [
  "## Tests",
  "",
  "| Core tests | Passed | Failed | Flaky | Skipped |",
  "| --- | --- | --- | --- | --- |",
  `| ${tests.length} | ${count("expected")} | ${count("unexpected")} | ${flaky.length} | ${count("skipped")} |`,
  "",
];
if (startedAt) {
  const minutes = (Date.now() - Date.parse(startedAt)) / 60000;
  lines.push(`Wall time from workflow start: ${minutes.toFixed(1)} min.`, "");
}
if (flaky.length) {
  lines.push("### Flaky tests (passed on retry)", "");
  for (const t of flaky) lines.push(`- \`tests/playwright/${t.file}:${t.line}\` ${t.title}`);
  lines.push("");
}
console.log(lines.join("\n"));
