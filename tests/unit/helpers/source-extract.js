// Shared harness for unit-testing module-scope helpers in script-tag-global
// js/ files (no exports, no import graph). Two utilities:
//
// - evalConstantsWindow(): evaluates js/constants.js against a mock window and
//   returns it (METALS, API_PROVIDERS, ... as properties).
// - extractConstFn(src, name, injected): extracts a `const <name> = (...) => {...};`
//   arrow-function declaration from source text by substring markers (start
//   marker → first column-0 "};") and evaluates it. Marker-based extraction is
//   insensitive to internal formatting (review precedent: PR #1465); it fails
//   loudly when the declaration moves or is renamed. `injected` names/values
//   become in-scope identifiers for the evaluated function (e.g. METALS).
//
// The new Function() usage evals repo-local source only — same trust domain as
// running the app itself.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export const evalConstantsWindow = () => {
  const constSrc = readFileSync(new URL("../../../js/constants.js", import.meta.url), "utf-8");
  const win = {
    location: { search: "", protocol: "https:" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  new Function("window", constSrc)(win);
  return win;
};

export const extractConstFn = (src, name, injected = {}) => {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  assert.notEqual(start, -1, `could not locate ${marker} in source`);
  const end = src.indexOf("\n};", start);
  assert.notEqual(end, -1, `could not locate the end of ${name}`);
  const expr = src.slice(start + marker.length, end + "\n}".length);
  const names = Object.keys(injected);
  return new Function(...names, `return ${expr};`)(...names.map((n) => injected[n]));
};
