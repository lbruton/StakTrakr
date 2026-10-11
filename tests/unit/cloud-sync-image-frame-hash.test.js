// STRK-427 (task B.3) — cross-version compatibility matrix, hash gate and sync registration.
//
// Written BEFORE the implementation (TDD red phase). It executes the "Cross-version matrix"
// of docs/specs/STRK-427-unified-image-framing/approach.md row by row, expected losses
// included, so the AC-5.3 / AC-8.3 guarantee is checked by code rather than prose:
//
//   N = a build with this feature   (the live sources, loaded at test time)
//   O = the build before it, v3.36.45 (functions PINNED below as literals)
//
// O is pinned as literals captured from commit 9f72107e (the tree this spec was cut from).
// Comments are elided; the code is verbatim. Do not "update" these literals when the live
// sources change: they exist precisely so that O stays O.
//
// Two classes of case, recorded in the PR notes at task B.9:
//   - New-behavior cases fail until C.1 / C.2 / C.7 (the N reader, writer and hash segment).
//   - Compatibility pins (H-1, H-4, H-5, E-2, C-1 O side, D-12) assert behavior that is true
//     today and must stay true, so they may already pass.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf-8");
const cloudSyncSrc = read("js/cloud-sync.js");

// ---------------------------------------------------------------------------------------
// O — pinned old-build behavior (v3.36.45)
// ---------------------------------------------------------------------------------------

/**
 * O: js/image-frame.js (resolveImageFrame, cycleFrame, normalizeImageFrame). The classifyShape
 * lookup is collapsed to its no-classifier fallback, which is the only branch a unit run reaches.
 */
const O_IMAGE_FRAME_SRC = `
function normalizeImageFrame(value) {
  return value === "circle" || value === "rectangle" ? value : "auto";
}
function cycleFrame(value) {
  const current = normalizeImageFrame(value);
  if (current === "auto") return "circle";
  if (current === "circle") return "rectangle";
  return "auto";
}
function resolveImageFrame(item, side = "obverse") {
  const record = item || {};
  const frameKey = side === "reverse" ? "reverseImageFrame" : "obverseImageFrame";
  const override = normalizeImageFrame(record[frameKey]);
  if (override === "circle") return "round";
  if (override === "rectangle") return "rect";
  const itemType = String(record.type || "").toLowerCase();
  const weightUnit = String(record.weightUnit || "").toLowerCase();
  if (
    itemType === "bar" ||
    itemType === "note" ||
    itemType === "aurum" ||
    itemType === "set" ||
    weightUnit === "gb" ||
    weightUnit === "sb"
  ) {
    return "rect";
  }
  if (String(record.gradingAuthority || "").trim()) {
    return "rect";
  }
  const rawShape = record.numistaData?.shape;
  const rawShapeText = String(rawShape || "").toLowerCase();
  const shape = rawShapeText.startsWith("round") || rawShapeText.startsWith("circular") ? "round" : rawShapeText;
  return shape && shape !== "round" ? "rect" : "round";
}
return { normalizeImageFrame, cycleFrame, resolveImageFrame };
`;

/** O: computeInventoryHash from js/cloud-sync.js verbatim (comments elided). */
const O_HASH_SRC = `
async function computeInventoryHash(items) {
  try {
    if (!crypto || !crypto.subtle || !crypto.subtle.digest) return null;
    var arr = Array.isArray(items) ? items : [];
    var keys = [];
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var itemKey = typeof DiffEngine !== "undefined" ? DiffEngine.computeItemKey(item) : String(i);
      var contentSample =
        (item.obverseImageUrl || "") +
        "|" +
        (item.reverseImageUrl || "") +
        "|" +
        (item.numistaId || "") +
        "|" +
        (item.grade || "") +
        "|" +
        (item.tradedFromUuid || "") +
        "|" +
        (item.disposition ? _stableCanonicalString(item.disposition) : "") +
        (item.constitutionalVariant || item.constitutionalEntryMode
          ? "|" +
            (item.constitutionalVariant || "") +
            "|" +
            (item.constitutionalEntryMode || "") +
            "|" +
            (item.pricingType || "")
          : "");
      keys.push(itemKey + "::" + contentSample);
    }
    keys.sort();
    var joined = keys.join("|");
    var encoded = new TextEncoder().encode(joined);
    var hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    return sha256BufferToHex(hashBuffer);
  } catch (e) {
    debugLog("[CloudSync] computeInventoryHash failed:", e.message);
    return null;
  }
}
`;

/** O: DIFF_FIELDS from js/diff-engine.js. compareItems iterates exactly this list. */
const O_DIFF_FIELDS = [
  "name",
  "metal",
  "composition",
  "weight",
  "weightUnit",
  "constitutionalVariant",
  "constitutionalEntryMode",
  "purity",
  "qty",
  "type",
  "date",
  "year",
  "price",
  "pricingType",
  "purchasePrice",
  "retailPrice",
  "marketValue",
  "purchaseLocation",
  "spotPriceAtPurchase",
  "premiumPerOz",
  "totalPremium",
  "storageLocation",
  "notes",
  "grade",
  "gradingAuthority",
  "certNumber",
  "serialNumber",
  "pcgsNumber",
  "pcgsVerified",
  "numistaId",
  "collectable",
  "ignorePatternImages",
  "currency",
  "obverseImageUrl",
  "reverseImageUrl",
  "obverseImageFrame",
  "reverseImageFrame",
  "obverseSharedImageId",
  "reverseSharedImageId",
  "tradedFromUuid",
  "disposition",
  "lastModified",
  "capsule",
  "capsuleNotes",
  "paymentMethod",
  "numistaData",
  "fieldMeta",
  "attachments",
];

/** O: the item keys inventory-import.js JSON import hands to sanitizeImportedItem. */
const O_JSON_IMPORT_KEYS = [
  "metal",
  "composition",
  "name",
  "qty",
  "type",
  "weight",
  "weightUnit",
  "price",
  "marketValue",
  "date",
  "paymentMethod",
  "purchaseLocation",
  "storageLocation",
  "notes",
  "capsule",
  "capsuleNotes",
  "spotPriceAtPurchase",
  "premiumPerOz",
  "totalPremium",
  "numistaId",
  "year",
  "grade",
  "gradingAuthority",
  "certNumber",
  "serialNumber",
  "pcgsNumber",
  "pcgsVerified",
  "purity",
  "serial",
  "uuid",
  "obverseImageUrl",
  "reverseImageUrl",
  "constitutionalVariant",
  "constitutionalEntryMode",
  "pricingType",
  "numistaData",
  "fieldMeta",
];

/** O: _readCsvIdentityFields from inventory-import.js (serial counter stubbed). */
const oReadCsvIdentityFields = (row) => ({
  serialNumber: row["Serial Number"] || row["serialNumber"] || "",
  serial: row["Serial"] || row["serial"] || "next-serial",
  uuid: row["UUID"] || row["uuid"] || "",
  obverseImageUrl: row["Obverse Image URL"] || row["obverseImageUrl"] || "",
  reverseImageUrl: row["Reverse Image URL"] || row["reverseImageUrl"] || "",
});

/** O: the keys normalizeDefinition (js/collections-core.js) copies onto a definition. */
const O_DEFINITION_KEYS = [
  "metal",
  "variant",
  "subtitle",
  "issuer",
  "weight",
  "weightUnit",
  "itemType",
  "purity",
  "specs",
  "imageShape",
  "imageOrientation",
  "about",
  "side",
  "showItemImages",
  "slots",
];

// ---------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------

const FIVE_KEYS = [
  "imageShape",
  "obverseImageOrientation",
  "reverseImageOrientation",
  "obverseImageFrame",
  "reverseImageFrame",
];

const deps = {
  DiffEngine: { computeItemKey: (item) => item.uuid || "" },
  stable: (o) => JSON.stringify(o),
  hex: (buf) =>
    Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
};

/** Build a hash function from function source text, with the same stubs the STRK-241 test uses. */
function buildHash(fnSrc) {
  return new Function(
    "crypto",
    "TextEncoder",
    "DiffEngine",
    "_stableCanonicalString",
    "sha256BufferToHex",
    "debugLog",
    `${fnSrc}\nreturn computeInventoryHash;`
  )(webcrypto, TextEncoder, deps.DiffEngine, deps.stable, deps.hex, () => {});
}

/** The live (N) hash, sliced from js/cloud-sync.js the way the STRK-241 test does. */
function liveHash() {
  const start = cloudSyncSrc.indexOf("async function computeInventoryHash(items) {");
  assert.notEqual(start, -1, "could not locate computeInventoryHash in js/cloud-sync.js");
  return buildHash(cloudSyncSrc.slice(start, cloudSyncSrc.indexOf("\n}", start) + 2));
}

const nHash = liveHash();
const oHash = buildHash(O_HASH_SRC);
const O = new Function(O_IMAGE_FRAME_SRC)();

const nFrame = {};
new Function("window", read("js/image-frame.js"))(nFrame);

const diffWin = {};
new Function("window", read("js/diff-engine.js"))(diffWin);
const { DiffEngine } = diffWin;

const coreWin = { getUnitOztWeight: () => 1 };
new Function("window", read("js/image-frame.js"))(coreWin);
new Function("window", read("js/collections-core.js"))(coreWin);
const core = coreWin.collectionsCore;

/** Apply a writer result to a record: set its keys, delete its remove list. */
const applyWrite = (record, { set, remove }) => {
  const next = { ...record, ...set };
  for (const key of remove) delete next[key];
  return next;
};

/** The fields O would diff for a local/remote pair: N's changes narrowed to O's own list. */
const oFieldDiff = (local, remote) =>
  DiffEngine.compareItems([local], [remote]).modified.flatMap((m) =>
    m.changes.filter((c) => O_DIFF_FIELDS.includes(c.field))
  );

const base = { uuid: "u-1", name: "Silver Eagle", metal: "Silver", type: "Coin" };

// ---------------------------------------------------------------------------------------
// Items I-1 … I-10
// ---------------------------------------------------------------------------------------

describe("STRK-427 matrix — items (I-1 … I-10)", () => {
  /** N writes the final state for a record; returns the stored record. */
  const nSave = (record, shape, orientations = {}) =>
    applyWrite(
      record,
      nFrame.writeImageFraming(
        {
          shape,
          obverseOrientation: orientations.obverse ?? nFrame.defaultImageOrientation(shape),
          reverseOrientation: orientations.reverse ?? nFrame.defaultImageOrientation(shape),
        },
        { type: record.type, gradingAuthority: record.gradingAuthority }
      )
    );

  test("I-1: N saves an explicit shape; O renders round/rect from the legacy projection and keeps the new keys", () => {
    const stored = nSave(base, "slab");
    assert.equal(stored.imageShape, "slab", "N stored the explicit shape");
    assert.equal(O.resolveImageFrame(stored), "rect", "O reads the legacy rectangle projection");
    const round = nSave({ ...base, type: "Bar" }, "round");
    assert.equal(O.resolveImageFrame(round), "round", "O reads the legacy circle projection");
    assert.equal(round.imageShape, "round", "the new key stays in the record O holds");
  });

  test("I-2: N saves a sparse default; the legacy keys are gone and O derives its own frame", () => {
    const stored = nSave(
      { ...base, obverseImageFrame: "rectangle", reverseImageFrame: "rectangle" },
      "round"
    );
    for (const key of FIVE_KEYS) assert.equal(key in stored, false, `${key} was deleted`);
    assert.equal(O.resolveImageFrame(stored), O.resolveImageFrame(base));
  });

  test("I-3: O edits Type on a migrated item; the new fields survive and N does not move the frame", () => {
    const migrated = nSave(base, "note");
    const oEdited = { ...migrated, type: "Goldback" }; // the edit path spreads ...oldItem
    assert.equal(oEdited.imageShape, "note");
    assert.equal(nFrame.readImageFraming(oEdited).shape, "note");
    const oRetyped = { ...migrated, type: "Bar" };
    assert.equal(
      nFrame.readImageFraming(oRetyped).shape,
      "note",
      "O's Type change does not move the frame"
    );
  });

  test("I-4: O cycles the frame toggle on a migrated item; N ignores the legacy value (accepted loss)", () => {
    const migrated = nSave(base, "note"); // legacy projection is "rectangle"
    const oCycled = { ...migrated, obverseImageFrame: O.cycleFrame(migrated.obverseImageFrame) };
    assert.notEqual(
      oCycled.obverseImageFrame,
      migrated.obverseImageFrame,
      "O did change the legacy value"
    );
    assert.equal(nFrame.readImageFraming(oCycled).shape, "note", "the new field still wins");
  });

  test("I-5: O edits grade or catalog on a sparse item; N re-derives from the new signals", () => {
    const sparse = { ...base };
    assert.equal(nFrame.readImageFraming(sparse).shape, "round");
    assert.equal(nFrame.readImageFraming({ ...sparse, gradingAuthority: "PCGS" }).shape, "slab");
    assert.equal(
      nFrame.readImageFraming({ ...sparse, numistaData: { shape: "Rectangular" } }).shape,
      "bar"
    );
  });

  test("I-6: O edits Type on an unmigrated legacy-rect item; N maps rectangle through the new Type", () => {
    const legacy = { ...base, obverseImageFrame: "rectangle", reverseImageFrame: "rectangle" };
    const oRetyped = (type) => ({ ...legacy, type });
    assert.equal(oRetyped("Bar").obverseImageFrame, "rectangle", "O leaves the legacy value alone");
    assert.equal(nFrame.readImageFraming(oRetyped("Bar")).shape, "bar");
    assert.equal(nFrame.readImageFraming(oRetyped("Goldback")).shape, "note");
    assert.equal(
      nFrame.readImageFraming(oRetyped("Coin")).shape,
      "bar",
      "Round falls back to Bar (D-3)"
    );
  });

  test("I-7: a stale orientation is ignored under a non-rotating shape and applies again later", () => {
    const stored = { ...base, type: "Bar", obverseImageOrientation: "landscape" };
    assert.equal(nFrame.readImageFraming(stored).obverseOrientation, "landscape");
    const oRetyped = { ...stored, type: "Coin" }; // O changes Type to a round Type
    assert.equal(
      nFrame.readImageFraming(oRetyped).obverseOrientation,
      null,
      "ignored, not deleted"
    );
    assert.equal(oRetyped.obverseImageOrientation, "landscape", "the value is still stored");
    assert.equal(
      nFrame.readImageFraming({ ...oRetyped, type: "Bar" }).obverseOrientation,
      "landscape"
    );
  });

  test("I-8: legacy mixed sides read as the obverse mapping", () => {
    const mixed = { ...base, obverseImageFrame: "circle", reverseImageFrame: "rectangle" };
    assert.equal(nFrame.readImageFraming(mixed).shape, "round");
    assert.equal(
      nFrame.readImageFraming({
        ...mixed,
        obverseImageFrame: "rectangle",
        reverseImageFrame: "circle",
      }).shape,
      "bar"
    );
  });

  test("I-9 and I-10: missing, empty, auto and invalid values read as absent; N never writes them", () => {
    for (const bad of [undefined, "", "auto", "banana"]) {
      const framing = nFrame.readImageFraming({
        ...base,
        type: "Bar",
        imageShape: bad,
        obverseImageOrientation: bad,
        reverseImageOrientation: bad,
      });
      assert.equal(framing.shape, "bar");
      assert.equal(framing.obverseOrientation, "portrait");
    }
    const written = nFrame.writeImageFraming(
      { shape: "bar", obverseOrientation: "portrait", reverseOrientation: "portrait" },
      { type: "Bar" }
    );
    assert.deepEqual(written.set, {});
  });
});

// ---------------------------------------------------------------------------------------
// Sync, hash and diff H-1 … H-5
// ---------------------------------------------------------------------------------------

describe("STRK-427 matrix — sync, hash and diff (H-1 … H-5)", () => {
  const withFields = { ...base, imageShape: "note", obverseImageOrientation: "portrait" };

  test("H-1: absent and empty new fields hash the same and produce no diff on N", async () => {
    const empty = {
      ...base,
      imageShape: "",
      obverseImageOrientation: "",
      reverseImageOrientation: "",
    };
    assert.equal(await nHash([base]), await nHash([empty]));
    assert.equal(DiffEngine.compareItems([base], [empty]).modified.length, 0);
  });

  test("H-2: a different shape or orientation changes the hash and yields a field-level diff on N", async () => {
    assert.notEqual(await nHash([base]), await nHash([{ ...base, imageShape: "slab" }]));
    assert.notEqual(
      await nHash([{ ...base, imageShape: "bar" }]),
      await nHash([{ ...base, imageShape: "bar", obverseImageOrientation: "landscape" }])
    );
    const shape = DiffEngine.compareItems([base], [{ ...base, imageShape: "slab" }]);
    assert.deepEqual(
      shape.modified.flatMap((m) => m.changes.map((c) => c.field)),
      ["imageShape"]
    );
    const side = DiffEngine.compareItems(
      [base],
      [{ ...base, reverseImageOrientation: "landscape" }]
    );
    assert.deepEqual(
      side.modified.flatMap((m) => m.changes.map((c) => c.field)),
      ["reverseImageOrientation"]
    );
  });

  test("H-3: an inventory carrying the fields hashes differently on O, whose field diff is empty (accepted)", async () => {
    assert.notEqual(
      await oHash([withFields]),
      await nHash([withFields]),
      "O lacks the new segment"
    );
    assert.equal(
      DiffEngine.compareItems([base], [withFields]).modified.length,
      1,
      "N sees the change"
    );
    assert.deepEqual(oFieldDiff(base, withFields), [], "O's own DIFF_FIELDS see nothing");
    for (const key of ["imageShape", "obverseImageOrientation", "reverseImageOrientation"]) {
      assert.equal(O_DIFF_FIELDS.includes(key), false, `${key} is not in O's list`);
    }
  });

  test("H-4: an inventory with none of the new fields hashes byte-identically on O and N", async () => {
    const inventory = [
      base,
      { uuid: "u-2", name: "Bar", type: "Bar", obverseImageUrl: "https://example.test/o.png" },
      { uuid: "u-3", type: "Coin", obverseImageFrame: "circle", reverseImageFrame: "rectangle" },
      { uuid: "u-4", weightUnit: "cu", constitutionalVariant: "con-90-half", pricingType: "lot" },
    ];
    assert.equal(await nHash(inventory), await oHash(inventory));
  });

  test("D-12: the legacy frame fields stay out of the hash", async () => {
    assert.equal(
      await nHash([{ ...base, obverseImageFrame: "circle", reverseImageFrame: "rectangle" }]),
      await nHash([base])
    );
  });

  test("the new segment is tagged so it cannot be confused with the STRK-241/242 block", async () => {
    const constitutional = { uuid: "u-5", constitutionalVariant: "slab" };
    const framed = { uuid: "u-5", imageShape: "slab" };
    assert.notEqual(await nHash([constitutional]), await nHash([framed]));
  });

  test("H-5: O does not apply new-field changes from a modify, and an add keeps the whole record", () => {
    // O generates its changes from its own list, so there is nothing to apply for the new fields.
    assert.deepEqual(oFieldDiff(base, { ...withFields, name: base.name }), []);
    const applied = DiffEngine.applySelectedChanges([], [{ type: "add", item: withFields }]);
    assert.equal(applied.length, 1);
    for (const key of ["imageShape", "obverseImageOrientation"]) {
      assert.equal(applied[0][key], withFields[key], `an add keeps ${key}`);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Import / export E-2 and Collections C-1
// ---------------------------------------------------------------------------------------

describe("STRK-427 matrix — import/export and Custom Collections", () => {
  test("E-2: an N export read by O's JSON and CSV readers loses the new keys and the frames", () => {
    const exported = {
      ...base,
      imageShape: "slab",
      obverseImageOrientation: "landscape",
      reverseImageOrientation: "portrait",
      obverseImageFrame: "rectangle",
      reverseImageFrame: "rectangle",
    };
    const jsonImported = Object.fromEntries(
      O_JSON_IMPORT_KEYS.filter((key) => key in exported).map((key) => [key, exported[key]])
    );
    for (const key of FIVE_KEYS)
      assert.equal(key in jsonImported, false, `O's JSON import drops ${key}`);

    const csvRow = {
      "Obverse Image URL": "https://example.test/o.png",
      "Obverse Frame": "rectangle",
      "Reverse Frame": "rectangle",
      "Image Shape": "slab",
      "Obverse Image Orientation": "landscape",
      "Reverse Image Orientation": "portrait",
    };
    const csvRead = oReadCsvIdentityFields(csvRow);
    assert.deepEqual(Object.keys(csvRead).sort(), [
      "obverseImageUrl",
      "reverseImageUrl",
      "serial",
      "serialNumber",
      "uuid",
    ]);
  });

  test("E-2: a ZIP restore keeps the whole record on an add", () => {
    const record = { ...base, imageShape: "slab", obverseImageFrame: "rectangle" };
    const [kept] = DiffEngine.applySelectedChanges([], [{ type: "add", item: record }]);
    assert.equal(kept.imageShape, "slab");
    assert.equal(kept.obverseImageFrame, "rectangle");
  });

  test("C-1: O's normalizeDefinition drops reverseImageOrientation and the reverse falls back to the obverse", () => {
    const written = {
      itemType: "Bar",
      imageShape: "bar",
      imageOrientation: "portrait",
      reverseImageOrientation: "landscape",
      slots: [],
    };
    const oLoaded = Object.fromEntries(
      Object.entries(written).filter(([key]) => O_DEFINITION_KEYS.includes(key))
    );
    assert.equal("reverseImageOrientation" in oLoaded, false, "O drops the key on load");
    assert.equal(
      core.reverseImageOrientationFor("bar", oLoaded),
      "portrait",
      "N falls back to the obverse"
    );
  });
});

// ---------------------------------------------------------------------------------------
// Registration (AC-8.6)
// ---------------------------------------------------------------------------------------

describe("STRK-427 registration at the enumeration sites (AC-8.6)", () => {
  test("the three fields are in the changeLog.js field array next to the legacy frames", () => {
    const changeLogSrc = read("js/changeLog.js");
    const at = changeLogSrc.indexOf('"obverseImageFrame"');
    assert.notEqual(at, -1, "could not locate the frame fields in js/changeLog.js");
    const block = changeLogSrc.slice(
      changeLogSrc.lastIndexOf("[", at),
      changeLogSrc.indexOf("];", at)
    );
    for (const key of ["imageShape", "obverseImageOrientation", "reverseImageOrientation"]) {
      assert.ok(block.includes(`"${key}"`), `${key} is tracked by the change log`);
    }
  });

  test("the legacy frames are still diffed (nothing regressed)", () => {
    const changes = DiffEngine.compareItems(
      [base],
      [{ ...base, obverseImageFrame: "circle" }]
    ).modified;
    assert.deepEqual(
      changes.flatMap((m) => m.changes.map((c) => c.field)),
      ["obverseImageFrame"]
    );
  });
});
