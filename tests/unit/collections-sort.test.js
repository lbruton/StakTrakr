import { test } from "node:test";
import assert from "node:assert/strict";
globalThis.window = {};
await import("../../js/collections-sort.js");
const {
  sortRows,
  hubKey,
  nextSort,
  normalizeHubPreferences,
  orderEntries,
  sortHubEntries,
  commitHubPreferences,
  moveVisibleId,
} = globalThis.window.collectionsSort;
const ids = (rows) => rows.map((row) => row.id);

test("numeric keys keep zero known and unknown values last in both directions", () => {
  const rows = [null, 100, 0, 9, undefined, NaN, Infinity, "9"].map((value, id) => ({ id, value }));
  assert.deepEqual(ids(sortRows(rows, (row) => row.value, "asc")), [2, 3, 1, 0, 4, 5, 6, 7]);
  assert.deepEqual(ids(sortRows(rows, (row) => row.value, "desc")), [1, 3, 2, 0, 4, 5, 6, 7]);
});
test("ties retain definition order in both directions and input is untouched", () => {
  const rows = Object.freeze([
    { id: "a", value: 9 },
    { id: "b", value: 100 },
    { id: "c", value: 9 },
  ]);
  assert.deepEqual(ids(sortRows(rows, (row) => row.value, "desc")), ["b", "a", "c"]);
  assert.deepEqual(ids(sortRows(rows, (row) => row.value, "asc")), ["a", "c", "b"]);
  assert.deepEqual(ids(rows), ["a", "b", "c"]);
});
test("Progress uses exact ratios while Owned uses counts", () => {
  const rows = [
    { id: "a", progress: { owned: 1, total: 2 } },
    { id: "b", progress: { owned: 2, total: 4 } },
    { id: "c", progress: { owned: 49, total: 99 } },
  ];
  assert.deepEqual(ids(sortRows(rows, (row) => hubKey(row, "progress"), "asc")), ["c", "a", "b"]);
  assert.deepEqual(ids(sortRows(rows, (row) => hubKey(row, "owned"), "desc")), ["c", "b", "a"]);
  assert.equal(hubKey({ progress: { owned: 0, total: 0 } }, "progress"), null);
});
test("text sorting is case insensitive and natural, with stable ties", () => {
  const rows = ["Set 10", "set 2", "Set 2", ""].map((name, id) => ({ name, id }));
  assert.deepEqual(ids(sortRows(rows, (row) => hubKey(row, "name"), "asc", "text")), [1, 2, 0, 3]);
});
test("G/L and Best price remain independent nullable numeric keys", () => {
  const rows = [
    { id: "owned", gl: -9, best: null },
    { id: "missing", gl: null, best: 100 },
    { id: "free", gl: 0, best: null },
    { id: "unknown", gl: null, best: null },
  ];
  assert.deepEqual(ids(sortRows(rows, (row) => row.gl, "desc")), [
    "free",
    "owned",
    "missing",
    "unknown",
  ]);
  assert.deepEqual(ids(sortRows(rows, (row) => row.best, "asc")), [
    "missing",
    "owned",
    "free",
    "unknown",
  ]);
});
test("new columns start ascending and the active column toggles", () => {
  assert.deepEqual(nextSort(null, "owned"), { key: "owned", direction: "asc" });
  assert.deepEqual(nextSort({ key: "owned", direction: "asc" }, "owned"), {
    key: "owned",
    direction: "desc",
  });
  assert.deepEqual(nextSort({ key: "owned", direction: "desc" }, "name"), {
    key: "name",
    direction: "asc",
  });
});

test("hub preferences validate sort choices, directions, and unique string ids", () => {
  assert.deepEqual(
    normalizeHubPreferences({
      order: ["ase-type2", "", 4, "ase-type2", "maple"],
      sortKey: "unknown",
      direction: "sideways",
    }),
    { order: ["ase-type2", "maple"], sortKey: "my-order", direction: "asc" }
  );
  assert.deepEqual(normalizeHubPreferences({ order: ["maple"], sortKey: "percent-complete" }), {
    order: ["maple"],
    sortKey: "percent-complete",
    direction: "desc",
  });
  assert.deepEqual(normalizeHubPreferences(null), {
    order: [],
    sortKey: "my-order",
    direction: "asc",
  });
});

test("saved order ignores removed ids and appends new entries in fallback order", () => {
  const entries = ["type1", "type2", "custom-oldest", "custom-newest"].map((id) => ({ id }));
  assert.deepEqual(ids(orderEntries(entries, ["removed", "custom-oldest", "type2"])), [
    "custom-oldest",
    "type2",
    "type1",
    "custom-newest",
  ]);
});

test("preset ties retain My order and missing run dates, updates, and values stay last", () => {
  const entries = [
    {
      id: "custom",
      name: "Set 2",
      template: null,
      collection: { lastModified: "2026-02-01T00:00:00.000Z" },
      ledgerMelt: 0,
      progress: { owned: 0, total: 0, missing: 0 },
      costToComplete: null,
    },
    {
      id: "template-later",
      name: "Set 2",
      template: { run: { start: 2024 } },
      collection: { lastModified: "2026-03-01T00:00:00.000Z" },
      ledgerMelt: 12,
      progress: { owned: 1, total: 2, missing: 1 },
      costToComplete: 24,
    },
    {
      id: "template-earlier",
      name: "Set 10",
      template: { run: { start: 2022 } },
      collection: { lastModified: "" },
      ledgerMelt: null,
      progress: { owned: 0, total: 1, missing: 1 },
      costToComplete: null,
    },
  ];
  const myOrder = ["custom", "template-later", "template-earlier"];
  assert.deepEqual(
    ids(sortHubEntries(entries, { order: myOrder, sortKey: "name", direction: "asc" })),
    ["custom", "template-later", "template-earlier"]
  );
  assert.deepEqual(
    ids(sortHubEntries(entries, { order: myOrder, sortKey: "run-start", direction: "desc" })),
    ["template-later", "template-earlier", "custom"]
  );
  assert.deepEqual(
    ids(
      sortHubEntries(entries, { order: myOrder, sortKey: "recently-updated", direction: "desc" })
    ),
    ["template-later", "custom", "template-earlier"]
  );
  assert.deepEqual(
    ids(sortHubEntries(entries, { order: myOrder, sortKey: "value-melt", direction: "desc" })),
    ["template-later", "custom", "template-earlier"]
  );
  assert.deepEqual(
    ids(sortHubEntries(entries, { order: myOrder, sortKey: "recently-updated", direction: "asc" })),
    ["custom", "template-later", "template-earlier"]
  );
  assert.deepEqual(
    ids(sortHubEntries(entries, { order: myOrder, sortKey: "value-melt", direction: "asc" })),
    ["custom", "template-later", "template-earlier"]
  );
  assert.deepEqual(
    ids(sortHubEntries(entries, { order: myOrder, sortKey: "to-complete", direction: "desc" })),
    ["template-later", "custom", "template-earlier"]
  );
});

test("recently updated compares timestamp instants, not their text (PR 1517 review)", () => {
  // Restored or synced records keep whatever lastModified string they carried, so an offset
  // stamp can meet a UTC one: 07:00+02:00 (05:00Z) is EARLIER than 06:00Z but sorts later as text.
  const entries = [
    { id: "offset-earlier", collection: { lastModified: "2026-06-03T07:00:00+02:00" } },
    { id: "utc-later", collection: { lastModified: "2026-06-03T06:00:00Z" } },
    { id: "unparseable", collection: { lastModified: "not a date" } },
  ];
  const order = entries.map((entry) => entry.id);
  assert.deepEqual(
    ids(sortHubEntries(entries, { order, sortKey: "recently-updated", direction: "desc" })),
    ["utc-later", "offset-earlier", "unparseable"]
  );
  assert.deepEqual(
    ids(sortHubEntries(entries, { order, sortKey: "recently-updated", direction: "asc" })),
    ["offset-earlier", "utc-later", "unparseable"]
  );
});

test("arrangement reorders visible entries without moving hidden entries", () => {
  assert.deepEqual(moveVisibleId(["hidden", "a", "b", "c"], ["a", "b", "c"], "c", "a"), [
    "hidden",
    "c",
    "a",
    "b",
  ]);
  assert.deepEqual(moveVisibleId(["a", "b"], ["a", "b"], "a", "a"), ["a", "b"]);
});

test("preference persistence reports write failures without accepting the new value", () => {
  const current = { order: ["a"], sortKey: "name", direction: "asc" };
  const next = { order: ["b", "a"], sortKey: "my-order", direction: "asc" };
  const error = new Error("quota");
  const failed = commitHubPreferences(current, next, () => {
    throw error;
  });
  assert.deepEqual(failed, { ok: false, preferences: current, error });
  assert.deepEqual(
    commitHubPreferences(current, next, () => {}),
    {
      ok: true,
      preferences: next,
      error: null,
    }
  );
});
