// STRK-450: every var(--x) read in js/ must name a custom property that is defined somewhere.
// An undefined token silently takes its literal fallback in every theme.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

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

test("js/ and css/ read no undefined CSS custom properties", () => {
  const jsFiles = listDir("js/", ".js");
  const defined = definedTokens(jsFiles);
  const undefinedReads = [];
  for (const file of [...jsFiles, ...listDir("css/", ".css")]) {
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

// The ESLint colour guard in eslint.config.cjs, checked case by case: [code, reports].
const GUARD_CASES = [
  ['el.style.color = "#123456";', 1],
  ['el.style.color = "Orange";', 1],
  ['x = "var(--x, Green)";', 1],
  ['x = "LAB(50% 40 59)";', 1],
  ['x = "color(srgb 1 0 0)";', 1],
  ['x = "hwb(0 0% 0%)";', 1],
  ['x = "oklab(0.5 0.1 0.1)";', 1],
  ['x = "#ABCDEF";', 1],
  ['x = "#abcd";', 1],
  ['x = "#11223344";', 1],
  ['el.style.background = "linear-gradient(red, blue)";', 1],
  ["el.style.color = `red`;", 1],
  ["el.style.background = `linear-gradient(${a}, Navy)`;", 1],
  ['x = "linear-gradient(#fff, red)";', 1],
  ["x = '<span style=\"color:red\">';", 1],
  ['x = `<td style="border: 1px solid Navy">`;', 1],
  ['el.style.cssText = "display:block;background-color: white";', 1],
  ["x = '<b style=\"color: var(--x, red)\">';", 1],
  ["x = '<i style=\"caret-color: purple\">';", 1],
  ['el.style.border = "1px solid red";', 1],
  ['el.style.outline = "2px dotted navy";', 1],
  ['el.style.boxShadow = "0 0 2px blue";', 1],
  ["el.style.borderLeft = `3px solid ${a} green`;", 1],
  ['el.style.caretColor = "orange";', 1],
  ['el.style.textDecorationColor = "red";', 1],
  ['el.style.borderInlineStartColor = "Teal";', 1],
  ["x = '<b style=\"background: url(/a.svg) red\">';", 1],
  ['el.style.color = failed ? "red" : "green";', 2],
  ['el.style.borderColor = "solid " + "navy";', 1],
  ['el.style.setProperty("color", "red");', 1],
  ['el.style.setProperty("background-color", failed ? "white" : "black");', 2],
  ['el.style.setProperty("--accent-color", `navy`);', 1],
  ['el.style.background = "none"; el.style.outline = "none"; el.style.borderRadius = "4px";', 0],
  ['x = "var(--layout-mode, auto)"; x = "var(--gold)"; x = "var(--type-gold-bg)";', 0],
  [
    "x = '<b style=\"color:var(--gold)\">'; x = '<b style=\"background:none;color:var(--text-muted)\">';",
    0,
  ],
  ['x = "#12345"; x = "#1234567"; getContrastColor(x); x = "&#128196;";', 0],
  ['x = "color-mix(in oklch, var(--a), var(--b))"; x = "contrast-color(red)";', 0],
  ["x = '<b style=\"background: url(/icons/red/status.svg) no-repeat\">';", 0],
  ['el.style.cssText = "background-image: url(/img/gold-bar.png)";', 0],
  ['el.style.background = "url(/icons/red/x.svg)"; el.style.filter = "url(#fade)";', 0],
  ["x = 'url(\"data:image/svg+xml,<svg fill=rgb(1 2 3)>\")';", 0],
  ['el.style.backgroundImage = "url(\\"data:image/svg+xml,<svg fill=\'hsl(1 2% 3%)\'/>\\")";', 0],
  ["x = \"url(\\\"data:image/svg+xml,<g transform='translate(1 2)' fill='rgb(1 2 3)'/>\\\")\";", 0],
  ['el.style.color = failed ? "var(--danger)" : "var(--success)";', 0],
  [
    'el.style.setProperty("width", "red"); el.style.setProperty("color", "var(--text-primary)");',
    0,
  ],
  ['x = "Red alert: the color is wrong"; y = "red";', 0],
];

/** Counts the colour-guard reports ESLint gives for code linted as the given repo file. */
async function guardReports(eslint, code, file) {
  const [result] = await eslint.lintText(code, { filePath: fileURLToPath(new URL(file, root)) });
  return result.messages.filter((m) => m.ruleId === "staktrakr/no-colour-literal").length;
}

test("the ESLint colour guard reports colour literals in js/ and nothing else", async () => {
  const eslint = new ESLint({ cwd: fileURLToPath(root) });
  const wrong = [];
  for (const [code, expected] of GUARD_CASES) {
    const reports = await guardReports(eslint, code, "js/colour-guard-fixture.js");
    if (reports !== expected) wrong.push(`${code} → ${reports}, expected ${expected}`);
  }
  assert.deepEqual(wrong, []);
  assert.equal(
    await guardReports(eslint, 'x = "#123456";', "js/theme.js"),
    0,
    "theme.js is the token bridge"
  );
});

test("js/ holds no colour literal and the guard fails the lint", async () => {
  const eslint = new ESLint({
    cwd: fileURLToPath(root),
    ruleFilter: ({ ruleId }) => ruleId === "staktrakr/no-colour-literal",
  });
  const results = await eslint.lintFiles(["js/**/*.js"]);
  const hits = results.flatMap((r) =>
    r.messages
      .filter((m) => m.ruleId === "staktrakr/no-colour-literal")
      .map((m) => `${r.filePath.split("/js/").pop()}:${m.line}`)
  );
  assert.deepEqual(hits, []);
  const config = await eslint.calculateConfigForFile(fileURLToPath(new URL("js/app.js", root)));
  const [severity] = [config.rules["staktrakr/no-colour-literal"]].flat();
  assert.equal(severity, 2, "the colour guard is an error");
});

test("the sweep finds a known-undefined token, so it is not vacuous", () => {
  const defined = definedTokens(listDir("js/", ".js"));
  assert.ok(defined.has("--success"), "--success is a defined theme token");
  assert.ok(!defined.has("--strk-450-never-defined"), "an invented name stays undefined");
});
