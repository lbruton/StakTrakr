// Unit tests for STRK-167 — Numista instance-aware de-duplication.
//
// A numistaId identifies a catalog TYPE, not a physical INSTANCE. The fix keys
// the tertiary identity tier on `numistaId|year|grade|certNumber` (normalized)
// so distinct graded instances stay separate while identical ungraded copies
// collapse. Three sites must agree on the key (DiffEngine, changeLog), and the
// enrichment must consume UUIDs FIFO without the unsafe name|date fallback for
// numista-bearing rows.
//
// These tests drive the PUBLIC surface and are RED until Cohort C lands:
//   - AC-1/3/4 : DiffEngine.computeItemKey instance tier + normalization
//   - AC-2     : changeLog.computeItemKey === DiffEngine.computeItemKey
//   - AC-6     : DiffEngine.collapseByInstanceKey sums qty per instance
//   - D-7      : enrichItemIdentities FIFO buckets + no name|date fallback

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// diff-engine.js is pure data with `window.DiffEngine = DiffEngine`.
const diffSrc = readFileSync(new URL("../../js/diff-engine.js", import.meta.url), "utf-8");
const win = {};
new Function("window", diffSrc)(win);
const DiffEngine = win.DiffEngine;
assert.ok(
  DiffEngine && typeof DiffEngine.computeItemKey === "function",
  "DiffEngine.computeItemKey must load"
);

// changeLog.js exposes `window.computeItemKey` (:933). Load it into the SAME
// window so its call-time delegation resolves window.DiffEngine.
const clSrc = readFileSync(new URL("../../js/changeLog.js", import.meta.url), "utf-8");
new Function("window", clSrc)(win);
const changeLogComputeItemKey = win.computeItemKey;
assert.ok(
  typeof changeLogComputeItemKey === "function",
  "changeLog computeItemKey must load on window"
);

// An instance-tier item: no uuid, no serial, has numistaId. Only such items
// reach the tertiary key tier.
const instance = (over = {}) => ({
  numistaId: "12345",
  year: 2024,
  grade: "MS70",
  certNumber: "ABC123",
  name: "American Silver Eagle",
  date: "2024-01-01",
  ...over,
});

describe("AC-1 — instance key = numistaId|year|grade|certNumber (normalized)", () => {
  test("graded item key is the 4-part composite, grade/cert lowercased", () => {
    assert.equal(DiffEngine.computeItemKey(instance()), "12345|2024|ms70|abc123");
  });

  test("grade/cert are trimmed before lowercasing", () => {
    assert.equal(
      DiffEngine.computeItemKey(instance({ grade: "  Ms70 ", certNumber: " ABC123 " })),
      "12345|2024|ms70|abc123"
    );
  });

  test("ungraded item collapses grade+cert to empty segments", () => {
    assert.equal(
      DiffEngine.computeItemKey(instance({ grade: "", certNumber: "" })),
      "12345|2024||"
    );
  });

  test("missing year yields an empty year segment", () => {
    assert.equal(
      DiffEngine.computeItemKey(instance({ year: undefined, grade: "", certNumber: "" })),
      "12345|||"
    );
  });
});

describe("AC-2 — changeLog and DiffEngine produce identical keys (3-site equivalence)", () => {
  for (const [label, item] of [
    ["graded instance", instance()],
    ["ungraded instance", instance({ grade: "", certNumber: "" })],
    ["uuid item", { uuid: "u-1", name: "x" }],
    ["serial item", { serial: 7, name: "x" }],
    ["bare name/date", { name: "Mystery", date: "2020-02-02" }],
  ]) {
    test(`${label} → same key from both sites`, () => {
      assert.equal(
        changeLogComputeItemKey(item),
        DiffEngine.computeItemKey(item),
        "changeLog must delegate to DiffEngine.computeItemKey"
      );
    });
  }
});

describe("AC-3 — same ungraded instance from API vs CSV → identical keys", () => {
  test("differing name and acquisition date do not change the key", () => {
    const api = instance({
      grade: "",
      certNumber: "",
      name: "American Silver Eagle",
      date: "2024-03-15",
    });
    const csv = instance({
      grade: "",
      certNumber: "",
      name: "American Silver Eagle 2024",
      date: "2024-09-01",
    });
    assert.equal(DiffEngine.computeItemKey(api), DiffEngine.computeItemKey(csv));
  });
});

describe("AC-4 — differing year OR grade OR certNumber → different keys", () => {
  const baseKey = DiffEngine.computeItemKey(instance());
  test("different year → different key", () => {
    assert.notEqual(DiffEngine.computeItemKey(instance({ year: 2023 })), baseKey);
  });
  test("different grade → different key", () => {
    assert.notEqual(DiffEngine.computeItemKey(instance({ grade: "MS69" })), baseKey);
  });
  test("different certNumber → different key", () => {
    assert.notEqual(DiffEngine.computeItemKey(instance({ certNumber: "ZZZ999" })), baseKey);
  });
});

describe("AC-6 — collapseByInstanceKey sums qty per instance, keeps distinct separate", () => {
  test("two identical ungraded rows collapse to one with summed qty", () => {
    const rows = [
      instance({ grade: "", certNumber: "", qty: 2 }),
      instance({ grade: "", certNumber: "", qty: 3 }),
    ];
    const out = DiffEngine.collapseByInstanceKey(rows);
    assert.equal(out.length, 1, "same instance key collapses to one row");
    assert.equal(out[0].qty, 5, "qty is summed");
  });

  test("distinct years stay separate", () => {
    const rows = [
      instance({ grade: "", certNumber: "", year: 2024, qty: 1 }),
      instance({ grade: "", certNumber: "", year: 2023, qty: 1 }),
    ];
    assert.equal(DiffEngine.collapseByInstanceKey(rows).length, 2);
  });

  test("distinct grades stay separate (graded vs ungraded)", () => {
    const rows = [
      instance({ grade: "MS70", certNumber: "C1", qty: 1 }),
      instance({ grade: "", certNumber: "", qty: 1 }),
    ];
    assert.equal(DiffEngine.collapseByInstanceKey(rows).length, 2);
  });
});

describe("D-7 — enrichItemIdentities FIFO buckets + no name|date fallback for numista rows", () => {
  test("two incoming ungraded rows each consume a distinct local UUID (FIFO)", () => {
    const local = [
      {
        uuid: "u1",
        numistaId: "9",
        year: 2024,
        grade: "",
        certNumber: "",
        name: "Eagle",
        date: "2024-01-01",
      },
      {
        uuid: "u2",
        numistaId: "9",
        year: 2024,
        grade: "",
        certNumber: "",
        name: "Eagle",
        date: "2024-02-02",
      },
    ];
    const incoming = [
      {
        numistaId: "9",
        year: 2024,
        grade: "",
        certNumber: "",
        name: "Eagle CSV",
        date: "2024-09-09",
      },
      {
        numistaId: "9",
        year: 2024,
        grade: "",
        certNumber: "",
        name: "Eagle CSV",
        date: "2024-10-10",
      },
    ];
    DiffEngine.enrichItemIdentities(local, incoming);
    const got = incoming.map((r) => r.uuid).sort();
    assert.deepEqual(got, ["u1", "u2"], "each incoming row consumes a distinct UUID, no reuse");
  });

  test("numista-bearing instance-key miss is NOT enriched via name|date (stays an add)", () => {
    const local = [
      {
        uuid: "g1",
        numistaId: "5",
        year: 2024,
        grade: "ms70",
        certNumber: "c1",
        name: "Eagle",
        date: "2024-01-01",
      },
    ];
    const incoming = [
      // Same name+date as the graded local, but ungraded → different instance key.
      { numistaId: "5", year: 2024, grade: "", certNumber: "", name: "Eagle", date: "2024-01-01" },
    ];
    DiffEngine.enrichItemIdentities(local, incoming);
    assert.equal(
      incoming[0].uuid,
      undefined,
      "an ungraded numista row must not steal a graded UUID via the name|date fallback"
    );
  });
});
