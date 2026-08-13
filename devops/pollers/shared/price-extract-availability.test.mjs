#!/usr/bin/env node
/**
 * Fixture tests for STAK-566 — Hero Bullion JSON-LD availability OOS detection.
 * Run with:
 *   node devops/pollers/shared/price-extract-availability.test.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function extractJsonLdScriptsFromHtml(html) {
  if (!html) return [];
  const scripts = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const body = match[1].trim();
    if (body) scripts.push(body);
  }
  return scripts;
}

function extractJsonLdAvailability(jsonLdScripts) {
  if (!jsonLdScripts || jsonLdScripts.length === 0) return null;

  function checkProduct(item) {
    const typeVal = item["@type"];
    const types = Array.isArray(typeVal) ? typeVal : [typeVal];
    if (!types.includes("Product")) return null;
    const offers = item.offers;
    if (!offers) return null;
    const offerList = Array.isArray(offers) ? offers : [offers];
    for (const offer of offerList) {
      const av = offer.availability;
      if (!av) continue;
      const m = String(av).match(/([A-Za-z]+)$/);
      if (m) return m[1].toLowerCase();
    }
    return null;
  }

  for (const script of jsonLdScripts) {
    try {
      const data = JSON.parse(script);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const nodes = Array.isArray(item["@graph"]) ? item["@graph"] : [item];
        for (const node of nodes) {
          const av = checkProduct(node);
          if (av) return av;
        }
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

const JSONLD_OOS_VALUES = new Set(["outofstock", "soldout", "discontinued"]);
const OOS_PATTERN = /^\s*unavailable\s*$/im;

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}
function loadFixture(name) {
  return readFileSync(join(__dirname, "fixtures", name), "utf8");
}

test("Hero Koala (sold out) — JSON-LD availability=OutOfStock", () => {
  const html = loadFixture("hero-koala-oos-jsonld.txt");
  const scripts = extractJsonLdScriptsFromHtml(html);
  assert.ok(scripts.length > 0, "expected at least one JSON-LD script");
  const av = extractJsonLdAvailability(scripts);
  assert.equal(av, "outofstock");
  assert.ok(JSONLD_OOS_VALUES.has(av));
});

test("Hero ASE (in stock) — JSON-LD availability=InStock", () => {
  const html = loadFixture("hero-ase-instock-jsonld.txt");
  const scripts = extractJsonLdScriptsFromHtml(html);
  assert.ok(scripts.length > 0);
  const av = extractJsonLdAvailability(scripts);
  assert.equal(av, "instock");
  assert.equal(JSONLD_OOS_VALUES.has(av), false);
});

test("availability missing — returns null", () => {
  const av = extractJsonLdAvailability([
    JSON.stringify({ "@type": "Product", offers: { price: "10" } }),
  ]);
  assert.equal(av, null);
});

test("non-Product JSON-LD — returns null", () => {
  const av = extractJsonLdAvailability([JSON.stringify({ "@type": "Organization", name: "Hero" })]);
  assert.equal(av, null);
});

test("@graph wrapper with mixed types — finds Product offer", () => {
  const av = extractJsonLdAvailability([
    JSON.stringify({
      "@graph": [
        { "@type": "Place", name: "HQ" },
        {
          "@type": "Product",
          offers: { availability: "https://schema.org/OutOfStock", price: "1" },
        },
      ],
    }),
  ]);
  assert.equal(av, "outofstock");
});

test("OOS pattern catches bare 'Unavailable' on its own line", () => {
  const md = "## Title\n\nUnavailable\n\nNotify me";
  assert.ok(OOS_PATTERN.test(md));
});

test("OOS pattern does NOT match 'Unavailable' embedded in prose", () => {
  const md = "Currently unavailable for international shipping.";
  assert.equal(OOS_PATTERN.test(md), false);
});

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL ${name}\n    ${e.message}`);
    failed++;
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
