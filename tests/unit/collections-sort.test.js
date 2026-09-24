import { test } from "node:test";
import assert from "node:assert/strict";
globalThis.window = {};
await import("../../js/collections-sort.js");
const { sortRows, hubKey, nextSort } = globalThis.window.collectionsSort;
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
