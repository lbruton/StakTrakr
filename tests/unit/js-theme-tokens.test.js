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

// A quoted hex or a colour function call in JS is a colour no theme block can reach.
const COLOUR_LITERAL = /["'`]#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/;
const COLOUR_TOKEN_ONLY_FILES = ["js/viewModal.js", "js/diff-modal-settings.js"];

/** Returns "file:line: text" for each code line (comments skipped) holding a colour literal. */
function colourLiterals(file) {
  return read(file)
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\/?\*)/.test(line) && COLOUR_LITERAL.test(line))
    .map(({ line, n }) => `${file}:${n}: ${line.trim()}`);
}

test("metal-tinted surfaces take every colour from theme tokens", () => {
  assert.deepEqual(COLOUR_TOKEN_ONLY_FILES.flatMap(colourLiterals), []);
});

test("the colour-literal sweep matches hex and colour functions, not prose", () => {
  for (const hit of ['x = "#1e293b";', "`rgba(${rgb},0.15)`", "oklch(0.5 0.1 50)"]) {
    assert.ok(COLOUR_LITERAL.test(hit), `${hit} is a colour literal`);
  }
  for (const miss of ["review on PR #1494", 'getThemeColorRGB("text-primary")', "var(--gold)"]) {
    assert.ok(!COLOUR_LITERAL.test(miss), `${miss} is not a colour literal`);
  }
});

test("the sweep finds a known-undefined token, so it is not vacuous", () => {
  const defined = definedTokens(listDir("js/", ".js"));
  assert.ok(defined.has("--success"), "--success is a defined theme token");
  assert.ok(!defined.has("--strk-450-never-defined"), "an invented name stays undefined");
});
