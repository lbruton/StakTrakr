// Test selection for `npm run test:changed`: which core and unit tests a change can
// affect, judged from the test map (functions each core test ran) and the paths each
// unit test reads. Everything here runs on inline fixtures; no git and no browser.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildUnitIndex,
  parseDiff,
  renderPlan,
  selectTests,
  staleWarning,
  toPlanJson,
} from "../../devops/testing/test-changed.mjs";

// `files` lists every function's line range per file, run or not; `tests` lists only the
// functions each test ran. js/demo.js lines 40-50 hold a function no test runs.
const MAP = {
  sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  files: {
    "js/demo.js": [
      [5, 12],
      [20, 28],
      [40, 50],
    ],
    "js/other.js": [[1, 9]],
    // A module wrapper (lines 1-100) with one inner function (lines 10-20).
    "js/wrapped.js": [
      [1, 100],
      [10, 20],
    ],
  },
  tests: [
    {
      id: "tests/playwright/core/wrap.spec.js:5",
      title: "wrap › boots and calls inner",
      functions: [
        { file: "js/wrapped.js", name: "", startLine: 1, endLine: 100 },
        { file: "js/wrapped.js", name: "inner", startLine: 10, endLine: 20 },
      ],
    },
    {
      id: "tests/playwright/core/wrap.spec.js:9",
      title: "wrap › boots only",
      functions: [{ file: "js/wrapped.js", name: "", startLine: 1, endLine: 100 }],
    },
    {
      id: "tests/playwright/core/alpha.spec.js:10",
      title: "alpha › uses foo",
      functions: [{ file: "js/demo.js", name: "foo", startLine: 5, endLine: 12 }],
    },
    {
      id: "tests/playwright/core/alpha.spec.js:30",
      title: "alpha › uses bar",
      functions: [{ file: "js/demo.js", name: "bar", startLine: 20, endLine: 28 }],
    },
    {
      id: "tests/playwright/core/beta.spec.js:7",
      title: "beta › uses foo and baz",
      functions: [
        { file: "js/demo.js", name: "foo", startLine: 5, endLine: 12 },
        { file: "js/other.js", name: "baz", startLine: 1, endLine: 9 },
      ],
    },
  ],
};

const UNIT_INDEX = buildUnitIndex({
  "tests/unit/demo.test.js": [
    'import { evalSource } from "./helpers/source-extract.js";',
    'evalSource("js/demo.js", { params: {} });',
  ].join("\n"),
  "tests/unit/codec.test.js": 'import { loadStorageCodec } from "./helpers/storage-codec.js";',
  "tests/unit/helpers/storage-codec.js": 'evalSource("js/utils-storage.js", {});',
  "tests/unit/helpers/source-extract.js": "export const evalSource = () => {};",
  "tests/unit/merge.test.js":
    'import { mergeCoverage } from "../../devops/testing/coverage-merge.mjs";',
});

const select = (changes, map = MAP) => selectTests({ map, changes, unitIndex: UNIT_INDEX });
const locations = (selection) => selection.core.map((entry) => entry.location).sort();
const unitFiles = (selection) => selection.unit.map((entry) => entry.file).sort();

describe("parseDiff", () => {
  test("reads old-side changed lines, and the insertion point for pure additions", () => {
    const diff = [
      "diff --git a/js/demo.js b/js/demo.js",
      "--- a/js/demo.js",
      "+++ b/js/demo.js",
      "@@ -7,2 +7,3 @@ function foo() {",
      "@@ -24,0 +26,4 @@ function bar() {",
      "diff --git a/docs/note.md b/docs/note.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/docs/note.md",
      "@@ -0,0 +1,3 @@",
    ].join("\n");
    assert.deepEqual(parseDiff(diff), [
      { file: "js/demo.js", lines: [7, 8, 24, 25] },
      { file: "docs/note.md", lines: [] },
    ]);
  });

  test("keeps a deleted file under its old path", () => {
    const diff = [
      "diff --git a/js/old.js b/js/old.js",
      "deleted file mode 100644",
      "--- a/js/old.js",
      "+++ /dev/null",
      "@@ -1,10 +0,0 @@",
    ].join("\n");
    assert.deepEqual(parseDiff(diff), [{ file: "js/old.js", lines: [], deleted: true }]);
  });
});

describe("selectTests", () => {
  test("a changed line inside a mapped function selects exactly the tests that ran it (AC-13)", () => {
    const selection = select([{ file: "js/demo.js", lines: [21] }]);
    assert.equal(selection.full, false);
    assert.deepEqual(locations(selection), ["tests/playwright/core/alpha.spec.js:30"]);
  });

  test("a function shared by two specs selects both (AC-13)", () => {
    assert.deepEqual(locations(select([{ file: "js/demo.js", lines: [6] }])), [
      "tests/playwright/core/alpha.spec.js:10",
      "tests/playwright/core/beta.spec.js:7",
    ]);
  });

  test("a changed spec file selects that whole file (AC-14)", () => {
    const selection = select([{ file: "tests/playwright/core/beta.spec.js", lines: [40] }]);
    assert.deepEqual(locations(selection), ["tests/playwright/core/beta.spec.js"]);
  });

  test("a changed js/ file selects the unit tests that read it (AC-15)", () => {
    assert.deepEqual(unitFiles(select([{ file: "js/demo.js", lines: [6] }])), [
      "tests/unit/demo.test.js",
    ]);
  });

  test("a path a unit test reads through its helper selects that unit test (AC-15)", () => {
    const selection = select([{ file: "js/utils-storage.js", lines: [3] }]);
    assert.deepEqual(unitFiles(selection), ["tests/unit/codec.test.js"]);
  });

  test("a changed unit test or unit helper selects the unit tests that use it (AC-15)", () => {
    assert.deepEqual(unitFiles(select([{ file: "tests/unit/merge.test.js", lines: [1] }])), [
      "tests/unit/merge.test.js",
    ]);
    assert.deepEqual(
      unitFiles(select([{ file: "tests/unit/helpers/source-extract.js", lines: [1] }])),
      ["tests/unit/demo.test.js"]
    );
    assert.deepEqual(
      unitFiles(select([{ file: "devops/testing/coverage-merge.mjs", lines: [2] }])),
      ["tests/unit/merge.test.js"]
    );
  });

  test("a deleted script selects the full suite; a deleted spec selects nothing to run", () => {
    const script = select([{ file: "js/demo.js", lines: [], deleted: true }]);
    assert.equal(script.full, true);
    assert.ok(script.reasons.some((reason) => reason.file === "js/demo.js"));
    const spec = select([{ file: "tests/playwright/core/beta.spec.js", lines: [], deleted: true }]);
    assert.equal(spec.full, false);
    assert.deepEqual(spec.core, []);
  });

  test("a selected test in a spec with a serial group runs the whole spec", () => {
    const selection = selectTests({
      map: MAP,
      changes: [{ file: "js/demo.js", lines: [21] }],
      unitIndex: UNIT_INDEX,
      serialSpecs: new Set(["tests/playwright/core/alpha.spec.js"]),
    });
    assert.deepEqual(locations(selection), ["tests/playwright/core/alpha.spec.js"]);
  });

  test("a changed line selects by its innermost function, not the wrapper around it", () => {
    assert.deepEqual(locations(select([{ file: "js/wrapped.js", lines: [15] }])), [
      "tests/playwright/core/wrap.spec.js:5",
    ]);
    assert.deepEqual(locations(select([{ file: "js/wrapped.js", lines: [50] }])), [
      "tests/playwright/core/wrap.spec.js:5",
      "tests/playwright/core/wrap.spec.js:9",
    ]);
  });

  test("a changed line in a function no core test runs selects no core test", () => {
    const selection = select([{ file: "js/demo.js", lines: [45] }]);
    assert.equal(selection.full, false);
    assert.deepEqual(selection.core, []);
    assert.deepEqual(unitFiles(selection), ["tests/unit/demo.test.js"]);
  });

  test("a changed line outside every mapped function selects the full core suite (AC-16)", () => {
    const selection = select([{ file: "js/demo.js", lines: [2] }]);
    assert.equal(selection.full, true);
    assert.ok(selection.reasons.some((reason) => reason.file === "js/demo.js"));
  });

  test("shared files with no map entry select the full core suite and name the file (AC-16)", () => {
    for (const file of [
      "index.html",
      "css/styles.css",
      "tests/playwright/helpers/app-test.js",
      "playwright.config.js",
      "js/not-in-map.js",
      ".github/workflows/tests.yml",
    ]) {
      const selection = select([{ file, lines: [1] }]);
      assert.equal(selection.full, true, `${file} selects the full suite`);
      assert.ok(
        selection.reasons.some((reason) => reason.file === file),
        `${file} is named`
      );
    }
  });

  test("docs and config paths select nothing", () => {
    const selection = select(
      [
        "README.md",
        "docs/specs/STRK-419-test-suite-loop/tasks.md",
        ".context/testing.md",
        ".claude/rules/code-core.md",
        ".agents/skills/start/SKILL.md",
        ".github/skills/code-review/SKILL.md",
        "playground/images/STRK-444/390-dark-builder.png",
      ].map((file) => ({ file, lines: [1] }))
    );
    assert.equal(selection.full, false);
    assert.deepEqual(selection.core, []);
    assert.deepEqual(selection.unit, []);
  });

  test("a missing map selects the full suite and names the command that builds one (AC-17)", () => {
    const selection = select([{ file: "js/demo.js", lines: [21] }], null);
    assert.equal(selection.full, true);
    assert.match(renderPlan(selection), /npm run test:map/);
  });

  test("an untracked file is judged by its path (AC-12)", () => {
    const selection = select([{ file: "tests/playwright/core/gamma.spec.js", lines: [] }]);
    assert.deepEqual(locations(selection), ["tests/playwright/core/gamma.spec.js"]);
  });
});

describe("plan output", () => {
  test("the plan lists each selected test with the changed file that selected it (AC-19)", () => {
    const text = renderPlan(select([{ file: "js/demo.js", lines: [6] }]));
    assert.match(text, /tests\/playwright\/core\/alpha\.spec\.js:10.*js\/demo\.js/);
    assert.match(text, /tests\/playwright\/core\/beta\.spec\.js:7.*js\/demo\.js/);
    assert.match(text, /tests\/unit\/demo\.test\.js.*js\/demo\.js/);
  });

  test("the plan serializes to JSON for CI", () => {
    const plan = toPlanJson(select([{ file: "js/demo.js", lines: [21] }]));
    assert.deepEqual(plan, {
      full: false,
      core: ["tests/playwright/core/alpha.spec.js:30"],
      unit: ["tests/unit/demo.test.js"],
      reasons: [],
    });
    assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  });

  test("a map built off the merge base's history yields a stale warning (AC-18)", () => {
    const isAncestor = (a, b) => a === "old" && b === "base";
    assert.equal(staleWarning({ mapSha: "old", mergeBase: "base", isAncestor }), null);
    assert.match(staleWarning({ mapSha: "other", mergeBase: "base", isAncestor }), /stale/i);
  });
});
