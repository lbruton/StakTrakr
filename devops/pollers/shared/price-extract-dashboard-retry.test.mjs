#!/usr/bin/env node
/**
 * TDD dashboard single-Vendor retry contract tests for STRK-32.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-dashboard-retry.test.mjs
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const isolatedRetryEnv = () => ({
  PATH: process.env.PATH || "",
  HOME: process.env.HOME || "",
  FIRECRAWL_API_KEY: "",
  FIRECRAWL_BASE_URL: "https://api.firecrawl.dev",
  PLAYWRIGHT_LAUNCH: "0",
  DRY_RUN: "1",
  SQLD_URL: "",
  SQLD_AUTH_TOKEN: "",
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
});

const runRetryProbe = () => {
  const moduleUrl = new URL("./price-extract.js", import.meta.url).href;
  const script = `
    const importSideEffects = [];
    console.log = (...args) => importSideEffects.push({ type: "console.log", text: args.join(" ") });
    console.warn = (...args) => importSideEffects.push({ type: "console.warn", text: args.join(" ") });
    console.error = (...args) => importSideEffects.push({ type: "console.error", text: args.join(" ") });
    process.exit = (code) => {
      importSideEffects.push({ type: "process.exit", code });
      throw new Error("process.exit(" + code + ") during dashboard retry import");
    };
    const mod = await import(${JSON.stringify(moduleUrl)});
    if (typeof mod.extractPrice !== "function") {
      throw new Error("dashboard-compatible extractPrice export is missing");
    }
    if (typeof mod.scrapeSingleVendor !== "function") {
      throw new Error("scrapeSingleVendor export is missing");
    }

    let fullPollerCalls = 0;
    const scrapeCalls = [];
    const result = await mod.extractPrice(
      "https://example.test/apmex/silver-eagle",
      "american-eagle-silver-1oz",
      "apmex",
      { id: "apmex", url: "https://example.test/apmex/silver-eagle", enabled: true },
      {
        coin: { metal: "silver", weight_oz: 1, name: "American Silver Eagle" },
        env: Object.freeze({}),
        writeSnapshot: false,
        runFullPoller: async () => {
          fullPollerCalls++;
          throw new Error("runFullPoller should not be called by single-Vendor retry");
        },
        scrapeVendor: async (context) => {
          scrapeCalls.push({
            coinSlug: context.coinSlug,
            providerId: context.provider?.id,
            url: context.url
          });
          return {
            price: 77.12,
            inStock: true,
            source: "test-double",
            ok: true,
            error: null,
            url: context.url
          };
        },
        log: () => {},
        warn: () => {}
      }
    );

    process.stdout.write(JSON.stringify({ importSideEffects, fullPollerCalls, scrapeCalls, result }) + "\\n");
  `;

  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: __dirname,
    env: isolatedRetryEnv(),
    encoding: "utf8",
    timeout: 3_000,
  });
};

test("dashboard-compatible extractPrice scrapes exactly one injected target", () => {
  const result = runRetryProbe();
  assert.equal(
    result.status,
    0,
    [
      `retry probe exited with status ${result.status}`,
      "expected importable exports plus injected scrapeVendor/options support",
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join("\n")
  );

  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.deepEqual(lines.length, 1, `retry probe should print exactly one JSON summary line`);
  const summary = JSON.parse(lines[0]);
  assert.deepEqual(
    summary.importSideEffects,
    [],
    "dashboard retry import must not log, call process.exit, or run the full poller"
  );
  assert.equal(summary.fullPollerCalls, 0, "single-Vendor retry must not call runFullPoller");
  assert.equal(summary.scrapeCalls.length, 1, "single-Vendor retry should scrape exactly once");
  assert.deepEqual(summary.scrapeCalls[0], {
    coinSlug: "american-eagle-silver-1oz",
    providerId: "apmex",
    url: "https://example.test/apmex/silver-eagle",
  });
  assert.deepEqual(summary.result, {
    price: 77.12,
    inStock: true,
    source: "test-double",
    ok: true,
    error: null,
    url: "https://example.test/apmex/silver-eagle",
  });
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
