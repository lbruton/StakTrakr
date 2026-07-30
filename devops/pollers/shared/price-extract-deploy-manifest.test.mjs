#!/usr/bin/env node
/**
 * TDD deploy packaging contract tests for STRK-32.
 *
 * Asserts the poller Dockerfiles package shared modules by wildcard, so any new
 * shared/*.js ships without a per-file manifest. The companion SHARED_FILES
 * assertion was retired with sync-from-fly.sh in STRK-312.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-deploy-manifest.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const readRepoFile = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

test("poller Dockerfiles package flat shared JavaScript modules with COPY shared/*.js ./", () => {
  const dockerfiles = [
    "devops/pollers/home-poller/Dockerfile",
    "devops/pollers/remote-poller/Dockerfile",
    "devops/pollers/remote-poller/Dockerfile.full",
  ];

  for (const dockerfile of dockerfiles) {
    const text = readRepoFile(dockerfile);
    assert.match(
      text,
      /^\s*COPY\s+shared\/\*\.js\s+\.\//m,
      `${dockerfile} should copy all flat shared JavaScript modules`
    );
  }
});

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
