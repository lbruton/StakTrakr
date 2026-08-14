#!/usr/bin/env node
/**
 * STRK-32 runFullPoller reliability tests.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-run-full-poller.test.mjs
 */

import assert from "node:assert/strict";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const runFailureIsolationProbe = () => {
  const moduleUrl = new URL("./price-extract.js", import.meta.url).href;
  const script = `
    const mod = await import(${JSON.stringify(moduleUrl)});
    let exitCode = null;
    process.exit = (code) => {
      exitCode = code;
      throw new Error("process.exit(" + code + ")");
    };
    const calls = [];
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(" "));
    await mod.runFullPoller({
      providersJson: {
        coins: {
          "test-coin": {
            metal: "silver",
            weight_oz: 1,
            providers: [
              { id: "throwing-vendor", enabled: true, url: "https://example.test/throw" },
              { id: "passing-vendor", enabled: true, url: "https://example.test/pass" }
            ]
          }
        }
      },
      dbHelpers: {
        openSqldDb: async () => null,
        writeSnapshot: async () => {},
        windowFloor: () => "2026-06-05T00:00:00.000Z",
        startRunLog: async () => null,
        finishRunLog: async () => {},
        recordFailure: async () => {},
        readSpotCurrent: async () => []
      },
      scrapeVendor: async (context) => {
        calls.push(context.provider.id);
        if (context.provider.id === "throwing-vendor") {
          throw new Error("synthetic vendor failure");
        }
        return {
          coinSlug: context.coinSlug,
          coin: context.coin,
          providerId: context.provider.id,
          url: context.url,
          price: 77.12,
          source: "test-double",
          inStock: true,
          ok: true,
          error: null
        };
      },
      jitter: async () => {}
    });
    process.stdout.write(JSON.stringify({ calls, warnings, exitCode }) + "\\n");
  `;

  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: __dirname,
    env: {
      ...process.env,
      COINS: "",
      DATA_DIR: __dirname,
      DRY_RUN: "1",
      FIRECRAWL_API_KEY: "",
      FIRECRAWL_BASE_URL: "http://localhost:3002",
      PLAYWRIGHT_LAUNCH: "1",
    },
    encoding: "utf8",
    timeout: 5_000,
  });
};

test("runFullPoller records a thrown Vendor scrape as one failed target and continues", () => {
  const result = runFailureIsolationProbe();
  assert.equal(
    result.status,
    0,
    [
      `runFullPoller probe exited with status ${result.status}`,
      "expected a thrown Vendor scrape to be converted into a failed result while the next target continues",
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join("\n")
  );

  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const summary = JSON.parse(lines.at(-1));
  assert.deepEqual(
    summary.calls.sort(),
    ["passing-vendor", "throwing-vendor"],
    "full poller should continue to the passing target after one Vendor throws"
  );
  assert.equal(
    summary.exitCode,
    null,
    "full poller should not call process.exit when at least one target succeeds"
  );
  assert.ok(
    summary.warnings.some((line) => line.includes("synthetic vendor failure")),
    "full poller should warn with the Vendor failure reason"
  );
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
