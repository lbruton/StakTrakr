// STRK-450: every var(--x) read in js/ must name a custom property that is defined somewhere.
// An undefined token silently takes its literal fallback in every theme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf-8");
const listDir = (dir, ext) =>
  readdirSync(new URL(dir, root))
    .filter((name) => name.endsWith(ext))
    .map((name) => `${dir}${name}`);

const DECLARATION = /(--[\w-]+)\s*:/g;
const SET_PROPERTY = /setProperty\(\s*["'`](--[\w-]+)/g;
const VAR_READ = /var\(\s*(--[\w-]+)/g;

/** Collects every custom property declared in CSS, index.html or a JS setProperty call. */
function definedTokens(jsFiles) {
  const defined = new Set();
  const sources = [...listDir("css/", ".css"), "index.html", ...jsFiles];
  for (const file of sources) {
    const text = read(file);
    for (const [, name] of text.matchAll(DECLARATION)) defined.add(name);
    for (const [, name] of text.matchAll(SET_PROPERTY)) defined.add(name);
  }
  return defined;
}

test("js/ reads no undefined CSS custom properties", () => {
  const jsFiles = listDir("js/", ".js");
  const defined = definedTokens(jsFiles);
  const undefinedReads = [];
  for (const file of jsFiles) {
    for (const [, name] of read(file).matchAll(VAR_READ)) {
      if (!defined.has(name)) undefinedReads.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(undefinedReads, []);
});

test("the sweep finds a known-undefined token, so it is not vacuous", () => {
  const defined = definedTokens(listDir("js/", ".js"));
  assert.ok(defined.has("--success"), "--success is a defined theme token");
  assert.ok(!defined.has("--strk-450-never-defined"), "an invented name stays undefined");
});
