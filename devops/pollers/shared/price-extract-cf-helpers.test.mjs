#!/usr/bin/env node
// Fixture tests for cf-clearance Byparr HTML helpers — run with:
//   node devops/pollers/shared/price-extract-cf-helpers.test.mjs
//
// Covers the two helpers added for the cf-clearance reliability fix
// (2026-04-24): looksLikeChallengePage() and extractJsonLdScriptsFromHtml().
// These are not exported, so we duplicate them here — keep in sync with
// price-extract.js.

function looksLikeChallengePage(html) {
  if (!html) return true;
  if (html.length < 5000) return true;
  const head = html.slice(0, 4096);
  if (/<title>\s*(Just a moment|Attention Required|Access denied|Please Wait)/i.test(head))
    return true;
  if (/cf-browser-verification|cf-challenge-running|__cf_chl_jschl_tk__/i.test(head)) return true;
  return false;
}

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

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  PASS ", name);
    passed++;
  } catch (err) {
    console.log("  FAIL ", name, "-", err.message);
    failed++;
  }
}
function eq(actual, expected, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e} got ${a}`);
}

const padding = "x".repeat(6000);
const realProductHead = `<html><head><title>1 oz Gold Eagle | Bullion Exchanges</title></head><body>${padding}</body></html>`;

console.log("--- looksLikeChallengePage ---");

test("null / empty → challenge", () => {
  eq(looksLikeChallengePage(null), true);
  eq(looksLikeChallengePage(""), true);
});

test("short body (<5KB) → challenge", () => {
  eq(looksLikeChallengePage("<html><body>short</body></html>"), true);
});

test("'Just a moment' title → challenge", () => {
  const html = `<html><head><title>Just a moment...</title></head><body>${padding}</body></html>`;
  eq(looksLikeChallengePage(html), true);
});

test("'Attention Required' title → challenge", () => {
  const html = `<html><head><title>Attention Required! | Cloudflare</title></head><body>${padding}</body></html>`;
  eq(looksLikeChallengePage(html), true);
});

test("'Access denied' title → challenge", () => {
  const html = `<html><head><title>Access denied</title></head><body>${padding}</body></html>`;
  eq(looksLikeChallengePage(html), true);
});

test("cf-browser-verification marker in head → challenge", () => {
  const html = `<html><head><title>Loading</title><script>cf-browser-verification</script></head><body>${padding}</body></html>`;
  eq(looksLikeChallengePage(html), true);
});

test("real product page → not challenge", () => {
  eq(looksLikeChallengePage(realProductHead), false);
});

test("real product page with 'cloudflare' in body → not challenge", () => {
  const html = `<html><head><title>1 oz Silver Round</title></head><body>${padding}<footer>Powered by Cloudflare</footer></body></html>`;
  eq(looksLikeChallengePage(html), false);
});

console.log("\n--- extractJsonLdScriptsFromHtml ---");

test("empty / null html → []", () => {
  eq(extractJsonLdScriptsFromHtml(""), []);
  eq(extractJsonLdScriptsFromHtml(null), []);
});

test("no JSON-LD → []", () => {
  eq(extractJsonLdScriptsFromHtml("<html><body>hello</body></html>"), []);
});

test("single JSON-LD script extracted", () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Product","offers":{"price":"100"}}</script></head></html>`;
  const out = extractJsonLdScriptsFromHtml(html);
  eq(out.length, 1);
  const parsed = JSON.parse(out[0]);
  eq(parsed["@type"], "Product");
});

test("multiple JSON-LD scripts extracted in order", () => {
  const html = `<script type="application/ld+json">{"a":1}</script><div>x</div><script type='application/ld+json'>{"b":2}</script>`;
  const out = extractJsonLdScriptsFromHtml(html);
  eq(out.length, 2);
  eq(JSON.parse(out[0]), { a: 1 });
  eq(JSON.parse(out[1]), { b: 2 });
});

test("mixed attributes on script tag still matched", () => {
  const html = `<script id="meta" type="application/ld+json" data-foo="bar">{"c":3}</script>`;
  const out = extractJsonLdScriptsFromHtml(html);
  eq(out.length, 1);
  eq(JSON.parse(out[0]), { c: 3 });
});

test("non-JSON-LD script tags ignored", () => {
  const html = `<script>var x=1;</script><script type="text/javascript">y=2</script><script type="application/ld+json">{"d":4}</script>`;
  const out = extractJsonLdScriptsFromHtml(html);
  eq(out.length, 1);
  eq(JSON.parse(out[0]), { d: 4 });
});

test("empty JSON-LD body is skipped", () => {
  const html = `<script type="application/ld+json">  </script><script type="application/ld+json">{"e":5}</script>`;
  const out = extractJsonLdScriptsFromHtml(html);
  eq(out.length, 1);
});

test("body preserves raw text (JSON array root)", () => {
  const html = `<script type="application/ld+json">[{"@type":"Product","offers":{"price":"50"}}]</script>`;
  const out = extractJsonLdScriptsFromHtml(html);
  const parsed = JSON.parse(out[0]);
  eq(Array.isArray(parsed), true);
  eq(parsed[0]["@type"], "Product");
});

test("whitespace around type attribute still matches", () => {
  const html = `<script type = "application/ld+json">{"f":6}</script>`;
  const out = extractJsonLdScriptsFromHtml(html);
  eq(out.length, 1);
  eq(JSON.parse(out[0]), { f: 6 });
});

test("mixed whitespace and single quotes still matches", () => {
  const html = `<script  type\t=  'application/ld+json' >{"g":7}</script>`;
  const out = extractJsonLdScriptsFromHtml(html);
  eq(out.length, 1);
  eq(JSON.parse(out[0]), { g: 7 });
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
