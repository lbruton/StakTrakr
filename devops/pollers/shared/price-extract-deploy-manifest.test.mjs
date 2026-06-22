#!/usr/bin/env node
/**
 * TDD deploy packaging contract tests for STRK-32.
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

const expectedRuntimeModules = [
  "price-extract-shared.js",
  "price-extract-provider-config.js",
  "price-extract-vendors.js",
  "price-extract-vendor-legacy.js",
  "price-extract-vendor-goldback.js",
  "price-extract-vendor-apmex.js",
  "webscale-cookies.js",
];

const readRepoFile = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const parseSharedFiles = (scriptText) => {
  const match = scriptText.match(/SHARED_FILES=\(\s*([\s\S]*?)\s*\)/);
  assert.ok(match, "sync-from-fly.sh should define SHARED_FILES");

  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/\s+#.*$/, ""))
    .map((line) => line.replace(/^["']|["']$/g, ""));
};

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

test("home sync manifest explicitly lists every new STRK-32 runtime module", () => {
  const syncScript = readRepoFile("devops/pollers/home-poller/sync-from-fly.sh");
  const sharedFiles = parseSharedFiles(syncScript);
  const missing = expectedRuntimeModules.filter((moduleName) => !sharedFiles.includes(moduleName));

  assert.deepEqual(missing, [], `SHARED_FILES missing: ${missing.join(", ")}`);
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
