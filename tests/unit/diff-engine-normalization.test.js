// Unit tests for DiffEngine normalization (STRK-158, parent STRK-154).
//
// Problem A — lastModified format: _valuesEqual compared scalars with raw ===.
// lastModified is stored in two ISO serializations of the SAME instant — compact
// "20260603T061930904Z" vs extended "2026-06-03T06:19:30.904Z" — so it reported a
// phantom conflict in the Review Sync Changes modal that no resolution cleared.
//
// Problem B — attachments "1 field changed" with an empty body: _valuesEqual flagged
// the attachments array as changed via order-sensitive _stableStringify, but
// _diffAttachments (UUID/fileName-keyed, order-independent) returned zero per-entry
// rows. The pill showed >=1 change while the body rendered nothing.
//
// These tests drive the PUBLIC DiffEngine.compareItems (the acceptance surface).
// diff-engine.js is pure data with `window.DiffEngine = DiffEngine`, so the whole
// file is evaluated with a mock window — no slicing needed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../js/diff-engine.js", import.meta.url), "utf-8");
const win = {};
new Function("window", src)(win);
const DiffEngine = win.DiffEngine;
assert.ok(
  DiffEngine && typeof DiffEngine.compareItems === "function",
  "DiffEngine.compareItems must load"
);

const base = { uuid: "item-1", name: "Silver Eagle", metal: "Silver" };

describe("STRK-158 Problem A — lastModified instant-awareness", () => {
  test("compact vs extended ISO of the SAME instant is NOT a conflict", () => {
    const res = DiffEngine.compareItems(
      [{ ...base, lastModified: "20260603T061930904Z" }],
      [{ ...base, lastModified: "2026-06-03T06:19:30.904Z" }]
    );
    assert.equal(res.modified.length, 0, "same instant must not be reported as modified");
    assert.equal(res.unchanged.length, 1);
  });

  test("compact vs extended ISO without milliseconds also compares equal", () => {
    const res = DiffEngine.compareItems(
      [{ ...base, lastModified: "20260603T061930Z" }],
      [{ ...base, lastModified: "2026-06-03T06:19:30Z" }]
    );
    assert.equal(res.modified.length, 0);
  });

  test("a genuinely different timestamp IS still a conflict", () => {
    const res = DiffEngine.compareItems(
      [{ ...base, lastModified: "2026-06-03T06:19:30.904Z" }],
      [{ ...base, lastModified: "2026-06-03T07:00:00.000Z" }]
    );
    assert.equal(res.modified.length, 1, "different instants must still be reported");
    assert.ok(
      res.modified[0].changes.some((c) => c.field === "lastModified"),
      "lastModified must be the changed field"
    );
  });
});

describe("STRK-158 Problem B — attachments phantom conflict", () => {
  const a1 = { attachmentUuid: "att-1", fileName: "receipt.pdf" };
  const a2 = { attachmentUuid: "att-2", fileName: "cert.pdf" };

  test("reordered attachments (same UUIDs) are NOT reported as a conflict", () => {
    const res = DiffEngine.compareItems(
      [{ ...base, attachments: [a1, a2] }],
      [{ ...base, attachments: [a2, a1] }]
    );
    assert.equal(res.modified.length, 0, "a pure reorder must not count as a change");
    assert.equal(res.unchanged.length, 1);
  });

  test("a genuine attachment addition IS reported", () => {
    const res = DiffEngine.compareItems(
      [{ ...base, attachments: [a1] }],
      [{ ...base, attachments: [a1, a2] }]
    );
    assert.equal(res.modified.length, 1);
    assert.ok(
      res.modified[0].changes.some((c) => c.field === "attachments"),
      "attachments must be flagged on a real add"
    );
  });

  test("a genuine attachment removal IS reported", () => {
    const res = DiffEngine.compareItems(
      [{ ...base, attachments: [a1, a2] }],
      [{ ...base, attachments: [a1] }]
    );
    assert.equal(res.modified.length, 1);
    assert.ok(res.modified[0].changes.some((c) => c.field === "attachments"));
  });

  test("identical attachments in identical order are unchanged", () => {
    const res = DiffEngine.compareItems(
      [{ ...base, attachments: [a1, a2] }],
      [{ ...base, attachments: [a1, a2] }]
    );
    assert.equal(res.modified.length, 0);
    assert.equal(res.unchanged.length, 1);
  });
});
