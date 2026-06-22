#!/usr/bin/env node
/**
 * TDD import contract tests for STRK-32.
 *
 * Run with:
 *   node devops/pollers/shared/price-extract-imports.test.mjs
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const isolatedImportEnv = () => ({
  PATH: process.env.PATH || "",
  HOME: process.env.HOME || "",
  FIRECRAWL_API_KEY: "",
  FIRECRAWL_BASE_URL: "https://api.firecrawl.dev",
  PLAYWRIGHT_LAUNCH: "0",
  DRY_RUN: "1",
  COINS: "__strk_32_import_probe__",
  SQLD_URL: "",
  SQLD_AUTH_TOKEN: "",
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
});

const runModuleImportProbe = () => {
  const moduleUrl = new URL("./price-extract.js", import.meta.url).href;
  const script = `
    const importSideEffects = [];
    console.log = (...args) => importSideEffects.push({ type: "console.log", text: args.join(" ") });
    console.warn = (...args) => importSideEffects.push({ type: "console.warn", text: args.join(" ") });
    console.error = (...args) => importSideEffects.push({ type: "console.error", text: args.join(" ") });
    process.exit = (code) => {
      importSideEffects.push({ type: "process.exit", code });
      throw new Error("process.exit(" + code + ") during price-extract.js import");
    };
    const mod = await import(${JSON.stringify(moduleUrl)});
    process.stdout.write(JSON.stringify({
      importSideEffects,
      runFullPoller: typeof mod.runFullPoller,
      scrapeSingleVendor: typeof mod.scrapeSingleVendor,
      extractPrice: typeof mod.extractPrice
    }) + "\\n");
  `;

  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: __dirname,
    env: isolatedImportEnv(),
    encoding: "utf8",
    timeout: 3_000,
  });
};

test("price-extract.js imports without running the full poller and exposes orchestrator APIs", () => {
  const result = runModuleImportProbe();
  assert.equal(
    result.status,
    0,
    [
      `import probe exited with status ${result.status}`,
      "expected a side-effect-free import that does not require Firecrawl, sqld, or Playwright",
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join("\n")
  );

  const lines = result.stdout.trim().split("\n").filter(Boolean);
  assert.deepEqual(lines.length, 1, `import probe should print exactly one JSON summary line`);
  const exports = JSON.parse(lines[0]);
  assert.deepEqual(
    exports.importSideEffects,
    [],
    "importing price-extract.js must not log, call process.exit, or run the full poller"
  );
  assert.equal(exports.runFullPoller, "function");
  assert.equal(exports.scrapeSingleVendor, "function");
  assert.equal(exports.extractPrice, "function");
});

test("price-extract-shared.js exports parser, OOS, HTML, and JSON-LD helpers", async () => {
  const shared = await import(new URL("./price-extract-shared.js", import.meta.url));
  const expectedHelpers = [
    "extractMarkdownPrice",
    "preprocessMarkdown",
    "detectStockStatus",
    "extractJsonLdPrice",
    "extractJsonLdAvailability",
    "extractJsonLdScriptsFromHtml",
    "htmlToPlainText",
    "looksLikeChallengePage",
  ];

  for (const helperName of expectedHelpers) {
    assert.equal(typeof shared[helperName], "function", `${helperName} should be exported`);
  }
});

test("shared helpers provide representative parser, OOS, HTML, and JSON-LD behavior", async () => {
  const shared = await import(new URL("./price-extract-shared.js", import.meta.url));

  const plainText = shared.htmlToPlainText(
    "<header>Spot Silver $51.23</header><main><h1>Silver Eagle</h1><p>$77.82</p></main>"
  );
  assert.ok(plainText.includes("Silver Eagle"));
  assert.ok(plainText.includes("$77.82"));
  assert.ok(!plainText.includes("$51.23"), "htmlToPlainText should strip header chrome");

  assert.deepEqual(
    shared.extractJsonLdScriptsFromHtml(
      '<script type="application/ld+json">{"@type":"Product","offers":{"price":"77.82"}}</script>'
    ),
    ['{"@type":"Product","offers":{"price":"77.82"}}']
  );

  assert.equal(
    shared.extractJsonLdAvailability([
      JSON.stringify({
        "@type": "Product",
        offers: { availability: "https://schema.org/OutOfStock" },
      }),
    ]),
    "outofstock"
  );

  assert.equal(
    shared.extractJsonLdPrice(
      [
        JSON.stringify({
          "@type": "Product",
          offers: { price: "77.82" },
        }),
      ],
      "silver",
      1,
      "apmex"
    ),
    77.82
  );

  assert.deepEqual(
    shared.detectStockStatus("This product is out of stock.", 1, "apmex"),
    { inStock: false, reason: "out_of_stock", detectedText: "out of stock" }
  );

  const parsed = shared.extractMarkdownPrice(
    "| Qty | (e)Check/Wire | Card |\n| --- | ---: | ---: |\n| 1+ | $77.82 | $80.93 |",
    "silver",
    1,
    "apmex"
  );
  assert.deepEqual(parsed, { price: 77.82, matchedBy: "tableFirstRow" });

  assert.equal(
    shared.looksLikeChallengePage("<html><head><title>Just a moment...</title></head></html>"),
    true
  );
});

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
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
