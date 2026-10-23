// Unit tests for the shared image-frame rules in js/image-frame.js (STRK-427, task B.1).
//
// These tests ENCODE the contract for the pure layer the shared editor and every host sit on
// (approach.md D-1..D-5, requirements AC-4.x / AC-7.x / AC-8.x). They are written BEFORE the
// implementation (TDD red phase) and must fail until task C.1 adds the functions:
//
//   deriveImageShape(signals)          the ONE type -> shape resolver (AC-4.1, AC-4.2)
//   defaultImageOrientation(shape)     Bar portrait, Note landscape, else null (AC-4.8)
//   normalizeImageShape(value)         enum or null; "", "auto", unknown, wrong case -> null
//   normalizeImageOrientation(value)   same for portrait | landscape
//   readImageFraming(item)             shape + per-side orientation: new field, else legacy,
//                                      else derived (AC-8.1, AC-8.2, AC-8.4, D-3)
//   writeImageFraming(state, signals)  sparse { set, remove } plus the legacy projection (D-2, D-4)
//
// Harness: js/image-frame.js is a script-tag-global module (assigns to window). Mirroring
// collections-core.test.js, the file is evaluated with a mock `window`.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evalSource } from "./helpers/source-extract.js";

/** Evaluate image-frame.js against a fresh mock window and return that window. */
function loadFrame() {
  const surface = {};
  evalSource("js/image-frame.js", { params: { window: surface } });
  return surface;
}

const api = loadFrame();

/** The five item keys this feature owns (three new, two legacy). */
const FRAME_KEYS = [
  "imageShape",
  "obverseImageOrientation",
  "reverseImageOrientation",
  "obverseImageFrame",
  "reverseImageFrame",
];

describe("deriveImageShape — the one resolver (AC-4.1, AC-4.2)", () => {
  // [description, signals, expected]. Grading beats Type; Type beats Numista; Numista is Coin-only.
  const cases = [
    ["a grading authority wins over every Type", { type: "Bar", gradingAuthority: "PCGS" }, "slab"],
    ["a grading authority makes a Coin a Slab", { type: "Coin", gradingAuthority: "NGC" }, "slab"],
    [
      "a whitespace-only grading authority is not graded",
      { type: "Coin", gradingAuthority: "  " },
      "round",
    ],
    ["Bar is a Bar", { type: "Bar" }, "bar"],
    ["Set is a Bar", { type: "Set" }, "bar"],
    ["Note is a Note", { type: "Note" }, "note"],
    ["Aurum is a Note", { type: "Aurum" }, "note"],
    ["Goldback is a Note", { type: "Goldback" }, "note"],
    ["Silverback is a Note", { type: "Silverback" }, "note"],
    ["Type matching ignores case", { type: "goldback" }, "note"],
    ["a plain Coin is Round", { type: "Coin" }, "round"],
    [
      "a Coin with a round Numista shape is Round",
      { type: "Coin", numistaShape: "Round" },
      "round",
    ],
    [
      "a Coin with a non-round Numista shape is a Bar",
      { type: "Coin", numistaShape: "Rectangular" },
      "bar",
    ],
    [
      "a Coin with a whitespace-only Numista shape is Round (absent, not non-round)",
      { type: "Coin", numistaShape: "   " },
      "round",
    ],
    [
      "a Round-type with a non-round Numista shape stays Round (Coin only, D-18)",
      { type: "Round", numistaShape: "Rectangular" },
      "round",
    ],
    [
      "a Bar with a round Numista shape is still a Bar",
      { type: "Bar", numistaShape: "Round" },
      "bar",
    ],
    [
      "a Goldback with a non-round Numista shape follows its Type",
      { type: "Goldback", numistaShape: "Square" },
      "note",
    ],
    [
      "weightUnit gb alone no longer forces a frame (D-18)",
      { type: "Coin", weightUnit: "gb" },
      "round",
    ],
    ["an empty signal object is Round", {}, "round"],
    ["no argument is Round", undefined, "round"],
  ];

  for (const [description, signals, expected] of cases) {
    test(description, () => {
      assert.equal(api.deriveImageShape(signals), expected);
    });
  }
});

describe("orientation defaults and enum normalizers (AC-4.8, I-9, I-10)", () => {
  test("Bar defaults to portrait and Note to landscape", () => {
    assert.equal(api.defaultImageOrientation("bar"), "portrait");
    assert.equal(api.defaultImageOrientation("note"), "landscape");
  });

  test("Round and Slab never rotate, so they have no default orientation", () => {
    assert.equal(api.defaultImageOrientation("round"), null);
    assert.equal(api.defaultImageOrientation("slab"), null);
    assert.equal(api.defaultImageOrientation("banana"), null);
  });

  test("normalizeImageShape accepts the four shapes and nothing else", () => {
    for (const shape of ["round", "bar", "note", "slab"]) {
      assert.equal(api.normalizeImageShape(shape), shape);
    }
    for (const bad of [
      "",
      "auto",
      "Round",
      "SLAB",
      "circle",
      "rectangle",
      "banana",
      null,
      undefined,
      3,
    ]) {
      assert.equal(api.normalizeImageShape(bad), null, `${JSON.stringify(bad)} reads as absent`);
    }
  });

  test("normalizeImageOrientation accepts portrait and landscape and nothing else", () => {
    for (const orientation of ["portrait", "landscape"]) {
      assert.equal(api.normalizeImageOrientation(orientation), orientation);
    }
    for (const bad of ["", "auto", "Portrait", "LANDSCAPE", "square", null, undefined, 0]) {
      assert.equal(
        api.normalizeImageOrientation(bad),
        null,
        `${JSON.stringify(bad)} reads as absent`
      );
    }
  });
});

describe("readImageFraming — reader precedence (AC-8.1, AC-8.2, AC-8.4, D-3)", () => {
  const read = (item) => api.readImageFraming(item);

  test("an item with no frame fields follows the derived shape and default orientation", () => {
    assert.deepEqual(read({ type: "Bar" }), {
      shape: "bar",
      obverseOrientation: "portrait",
      reverseOrientation: "portrait",
    });
    assert.deepEqual(read({ type: "Goldback" }), {
      shape: "note",
      obverseOrientation: "landscape",
      reverseOrientation: "landscape",
    });
    assert.deepEqual(read({ type: "Coin" }), {
      shape: "round",
      obverseOrientation: null,
      reverseOrientation: null,
    });
  });

  test("a stored imageShape wins over the derived shape and over a legacy frame", () => {
    assert.equal(read({ type: "Coin", imageShape: "note" }).shape, "note");
    assert.equal(
      read({ type: "Coin", imageShape: "slab", obverseImageFrame: "circle" }).shape,
      "slab",
      "the new field wins when both are present (AC-8.2)"
    );
  });

  test("a legacy circle reads as Round, whatever the Type", () => {
    assert.equal(read({ type: "Bar", obverseImageFrame: "circle" }).shape, "round");
  });

  test("a legacy rectangle reads as the shape the item derives", () => {
    assert.equal(read({ type: "Bar", obverseImageFrame: "rectangle" }).shape, "bar");
    assert.equal(read({ type: "Goldback", obverseImageFrame: "rectangle" }).shape, "note");
    assert.equal(
      read({ type: "Coin", gradingAuthority: "PCGS", obverseImageFrame: "rectangle" }).shape,
      "slab"
    );
  });

  test("a legacy rectangle on a plain round Coin reads as Bar, not Round (D-3)", () => {
    assert.equal(read({ type: "Coin", obverseImageFrame: "rectangle" }).shape, "bar");
  });

  test("only the obverse legacy frame counts; the reverse value is ignored (AC-8.4)", () => {
    assert.equal(
      read({ type: "Coin", obverseImageFrame: "circle", reverseImageFrame: "rectangle" }).shape,
      "round"
    );
    assert.equal(
      read({ type: "Coin", obverseImageFrame: "rectangle", reverseImageFrame: "circle" }).shape,
      "bar"
    );
  });

  test("auto, empty and unknown legacy values read as absent", () => {
    for (const legacy of ["auto", "", "triangle", null]) {
      assert.equal(read({ type: "Bar", obverseImageFrame: legacy }).shape, "bar");
    }
  });

  test("an invalid new imageShape falls back to the legacy value, then to derived", () => {
    assert.equal(
      read({ type: "Coin", imageShape: "banana", obverseImageFrame: "rectangle" }).shape,
      "bar"
    );
    assert.equal(read({ type: "Bar", imageShape: "banana" }).shape, "bar");
  });

  test("stored orientations win, per side, over the shape default", () => {
    const framing = read({
      type: "Bar",
      obverseImageOrientation: "landscape",
      reverseImageOrientation: "portrait",
    });
    assert.equal(framing.obverseOrientation, "landscape");
    assert.equal(framing.reverseOrientation, "portrait");
  });

  test("an absent side orientation falls back to the shape default for that side only", () => {
    const framing = read({ type: "Note", obverseImageOrientation: "portrait" });
    assert.equal(framing.obverseOrientation, "portrait");
    assert.equal(framing.reverseOrientation, "landscape");
  });

  test("a stale orientation is ignored under a non-rotating shape and not deleted (I-7)", () => {
    const item = { type: "Coin", imageShape: "round", obverseImageOrientation: "landscape" };
    const before = JSON.stringify(item);
    assert.equal(read(item).obverseOrientation, null);
    assert.equal(JSON.stringify(item), before, "the reader never mutates the record");
    const back = read({ ...item, imageShape: "bar" });
    assert.equal(back.obverseOrientation, "landscape", "it applies again under a rotating shape");
  });

  test("invalid orientation values read as absent (I-10)", () => {
    const framing = read({
      type: "Bar",
      obverseImageOrientation: "sideways",
      reverseImageOrientation: "auto",
    });
    assert.equal(framing.obverseOrientation, "portrait");
    assert.equal(framing.reverseOrientation, "portrait");
  });

  test("a null or missing record reads as the Round default", () => {
    assert.equal(read(null).shape, "round");
    assert.equal(read(undefined).shape, "round");
  });
});

describe("writeImageFraming — sparse writer and legacy projection (D-2, D-4, AC-7.1, AC-7.3)", () => {
  /** Write for a final state; orientation fields default to the shape's own default. */
  const write = (shape, signals, orientations = {}) =>
    api.writeImageFraming(
      {
        shape,
        obverseOrientation: orientations.obverse ?? api.defaultImageOrientation(shape),
        reverseOrientation: orientations.reverse ?? api.defaultImageOrientation(shape),
      },
      signals
    );

  test("the derived shape at default orientation writes nothing and removes all five keys", () => {
    const result = write("bar", { type: "Bar" });
    assert.deepEqual(result.set, {});
    assert.deepEqual([...result.remove].sort(), [...FRAME_KEYS].sort());
  });

  test("a non-derived shape stores imageShape and projects the legacy pair (AC-7.3)", () => {
    const slab = write("slab", { type: "Coin" });
    assert.equal(slab.set.imageShape, "slab");
    assert.equal(slab.set.obverseImageFrame, "rectangle");
    assert.equal(slab.set.reverseImageFrame, "rectangle");

    const note = write("note", { type: "Coin" });
    assert.equal(note.set.imageShape, "note");
    assert.equal(note.set.obverseImageFrame, "rectangle");
  });

  test("Round chosen on a rectangular Type projects circle", () => {
    const result = write("round", { type: "Bar" });
    assert.equal(result.set.imageShape, "round");
    assert.equal(result.set.obverseImageFrame, "circle");
    assert.equal(result.set.reverseImageFrame, "circle");
  });

  test("an orientation that differs from the default is stored; the default is not", () => {
    const landscapeBar = write("bar", { type: "Bar" }, { obverse: "landscape" });
    assert.equal(landscapeBar.set.obverseImageOrientation, "landscape");
    assert.equal("reverseImageOrientation" in landscapeBar.set, false);
    assert.ok(landscapeBar.remove.includes("reverseImageOrientation"));

    const portraitNote = write("note", { type: "Goldback" }, { reverse: "portrait" });
    assert.equal(portraitNote.set.reverseImageOrientation, "portrait");
    assert.equal("obverseImageOrientation" in portraitNote.set, false);
  });

  test("a mixed pair stores only the side that deviates", () => {
    const result = write("bar", { type: "Bar" }, { obverse: "portrait", reverse: "landscape" });
    assert.equal("obverseImageOrientation" in result.set, false);
    assert.equal(result.set.reverseImageOrientation, "landscape");
  });

  test("non-rotating shapes strip both orientation keys", () => {
    for (const shape of ["round", "slab"]) {
      const result = write(shape, { type: "Bar" });
      assert.equal("obverseImageOrientation" in result.set, false);
      assert.equal("reverseImageOrientation" in result.set, false);
      assert.ok(result.remove.includes("obverseImageOrientation"));
      assert.ok(result.remove.includes("reverseImageOrientation"));
    }
  });

  test("signal-only change: a stored note on a Coin that became Goldback stores nothing (D-4)", () => {
    // The editor still shows Note, but Note is now the derived shape for Goldback, so it is sparse.
    const result = write("note", { type: "Goldback" });
    assert.equal("imageShape" in result.set, false);
    assert.ok(result.remove.includes("imageShape"));
    assert.ok(result.remove.includes("obverseImageFrame"));
    assert.ok(result.remove.includes("reverseImageFrame"));
  });

  test("a grade makes Slab the derived shape, so Slab is sparse for a graded item", () => {
    const result = write("slab", { type: "Coin", gradingAuthority: "PCGS" });
    assert.deepEqual(result.set, {});
  });

  test("set and remove are disjoint and together cover exactly the five keys", () => {
    const states = [
      write("bar", { type: "Bar" }),
      write("slab", { type: "Coin" }),
      write("bar", { type: "Bar" }, { obverse: "landscape", reverse: "landscape" }),
      write("round", { type: "Goldback" }),
    ];
    for (const result of states) {
      const setKeys = Object.keys(result.set);
      for (const key of setKeys)
        assert.equal(result.remove.includes(key), false, `${key} is both set and removed`);
      assert.deepEqual([...setKeys, ...result.remove].sort(), [...FRAME_KEYS].sort());
    }
  });

  test("the writer never emits auto or empty values (I-9)", () => {
    const result = write("slab", { type: "Coin" }, { obverse: "landscape" });
    for (const value of Object.values(result.set)) {
      assert.notEqual(value, "auto");
      assert.notEqual(value, "");
    }
  });
});

describe("enum values survive the item sanitizer (risk note: sanitizeObjectFields)", () => {
  // sanitizeObjectFields strips non-alphanumerics from every string field. All enum values are
  // single lowercase words, so they must pass through untouched. Load the REAL helper.
  const mod = { exports: {} };
  evalSource("js/utils.js", { params: { window: {}, module: mod } });
  const { sanitizeObjectFields } = mod.exports;

  test("js/utils.js exports sanitizeObjectFields", () => {
    assert.equal(typeof sanitizeObjectFields, "function");
  });

  test("every shape, orientation and legacy frame value is unchanged by sanitizing", () => {
    for (const shape of ["round", "bar", "note", "slab"]) {
      for (const orientation of ["portrait", "landscape"]) {
        const input = {
          imageShape: shape,
          obverseImageOrientation: orientation,
          reverseImageOrientation: orientation,
          obverseImageFrame: shape === "round" ? "circle" : "rectangle",
          reverseImageFrame: shape === "round" ? "circle" : "rectangle",
        };
        assert.deepEqual(sanitizeObjectFields(input), input);
      }
    }
  });
});

describe("resolveImageFrame is a thin wrapper over the shared reader (P2: AC-9.1, AC-9.3, D-17, D-18)", () => {
  const resolve = (item, side) => api.resolveImageFrame(item, side);

  describe("it delegates to readImageFraming, so every non-round shape is rect (D-17)", () => {
    test("a stored Bar, Note or Slab is rect, a stored Round is round, whatever the Type", () => {
      for (const shape of ["bar", "note", "slab"]) {
        assert.equal(resolve({ type: "Coin", imageShape: shape }), "rect", shape);
      }
      assert.equal(resolve({ type: "Coin", imageShape: "round" }), "round");
      // A stored Round beats a Type that derives Bar (the old Type switch ignored the new field).
      assert.equal(resolve({ type: "Bar", imageShape: "round" }), "round");
      assert.equal(resolve({ type: "Note", imageShape: "round" }), "round");
    });

    test("a stored shape wins over a legacy frame (AC-8.2)", () => {
      assert.equal(
        resolve({ type: "Coin", imageShape: "round", obverseImageFrame: "rectangle" }),
        "round"
      );
      assert.equal(
        resolve({ type: "Coin", imageShape: "bar", obverseImageFrame: "circle" }),
        "rect"
      );
    });

    test("a legacy frame still resolves when no new field is stored", () => {
      assert.equal(resolve({ type: "Coin", obverseImageFrame: "rectangle" }), "rect");
      assert.equal(resolve({ type: "Bar", obverseImageFrame: "circle" }), "round");
    });

    test("one item has one frame: the side argument no longer picks a different binary (AC-8.4)", () => {
      const mixed = { type: "Coin", obverseImageFrame: "circle", reverseImageFrame: "rectangle" };
      assert.equal(resolve(mixed, "obverse"), "round");
      assert.equal(resolve(mixed, "reverse"), "round");
    });

    test("a missing or empty record reads as round", () => {
      assert.equal(resolve(null), "round");
      assert.equal(resolve(undefined, "reverse"), "round");
      assert.equal(resolve({}), "round");
    });
  });

  describe("the two accepted resolver differences (D-18)", () => {
    test("a non-Coin Type with a non-round Numista shape follows its Type", () => {
      assert.equal(resolve({ type: "Round", numistaData: { shape: "Rectangular" } }), "round");
      assert.equal(resolve({ type: "Medallion", numistaData: { shape: "Square" } }), "round");
      // The Coin rule is unchanged.
      assert.equal(resolve({ type: "Coin", numistaData: { shape: "Rectangular" } }), "rect");
    });

    test("weightUnit gb or sb alone no longer forces rect", () => {
      assert.equal(resolve({ type: "Coin", weightUnit: "gb" }), "round");
      assert.equal(resolve({ type: "Coin", weightUnit: "sb" }), "round");
      // Goldback and Silverback are Types, so the Type rule still frames real items.
      assert.equal(resolve({ type: "Goldback", weightUnit: "gb" }), "rect");
      assert.equal(resolve({ type: "Silverback", weightUnit: "sb" }), "rect");
    });
  });

  describe("resolveImageFrameSpec gives the renderers one shape and one orientation per side (D-17)", () => {
    const spec = (item, side) => api.resolveImageFrameSpec(item, side);

    test("a legacy rectangle on a plain Coin is a portrait Bar frame (AC-9.3)", () => {
      assert.deepEqual(spec({ type: "Coin", obverseImageFrame: "rectangle" }), {
        shape: "bar",
        orientation: "portrait",
        frame: "rect",
      });
    });

    test("orientation is per side, defaulting to the shape's own", () => {
      const item = { type: "Coin", imageShape: "note", reverseImageOrientation: "portrait" };
      assert.deepEqual(spec(item, "obverse"), {
        shape: "note",
        orientation: "landscape",
        frame: "rect",
      });
      assert.deepEqual(spec(item, "reverse"), {
        shape: "note",
        orientation: "portrait",
        frame: "rect",
      });
    });

    test("Round and Slab have no orientation, and a stale one is ignored", () => {
      assert.deepEqual(spec({ type: "Coin" }), { shape: "round", orientation: "", frame: "round" });
      assert.deepEqual(
        spec({ type: "Coin", gradingAuthority: "PCGS", obverseImageOrientation: "landscape" }),
        {
          shape: "slab",
          orientation: "",
          frame: "rect",
        }
      );
    });

    test("a missing record is a Round frame, and the side argument defaults to obverse", () => {
      assert.deepEqual(spec(null), { shape: "round", orientation: "", frame: "round" });
      assert.deepEqual(spec(undefined, "reverse"), {
        shape: "round",
        orientation: "",
        frame: "round",
      });
    });
  });

  describe("renderer helpers: attribute fragment, token ratio and thumb width", () => {
    test("imageFrameAttrHtml writes data-shape, and data-orientation only for Bar and Note", () => {
      assert.equal(api.imageFrameAttrHtml({ type: "Coin" }), ' data-shape="round"');
      assert.equal(
        api.imageFrameAttrHtml({ type: "Bar" }, "obverse"),
        ' data-shape="bar" data-orientation="portrait"'
      );
      assert.equal(
        api.imageFrameAttrHtml(
          { type: "Coin", imageShape: "note", reverseImageOrientation: "portrait" },
          "reverse"
        ),
        ' data-shape="note" data-orientation="portrait"'
      );
      assert.equal(
        api.imageFrameAttrHtml({ type: "Coin", gradingAuthority: "PCGS" }),
        ' data-shape="slab"'
      );
    });

    test("imageFrameRatio returns the token ratio for each shape and orientation", () => {
      assert.equal(api.imageFrameRatio("round", ""), 1);
      assert.equal(api.imageFrameRatio("slab", ""), 0.68);
      assert.equal(api.imageFrameRatio("bar", "portrait"), 0.6);
      assert.equal(api.imageFrameRatio("bar", "landscape"), 1.6);
      assert.equal(api.imageFrameRatio("note", "landscape"), 2.05);
      assert.ok(Math.abs(api.imageFrameRatio("note", "portrait") - 1 / 2.05) < 1e-9);
      assert.equal(api.imageFrameRatio("nonsense", "portrait"), 1);
    });

    test("imageFrameThumbWidth is ratio-derived at 28px tall and clamped to 16..40px", () => {
      assert.equal(api.imageFrameThumbWidth("round", ""), 28);
      assert.equal(api.imageFrameThumbWidth("bar", "portrait"), 17);
      assert.equal(api.imageFrameThumbWidth("slab", ""), 19);
      assert.equal(api.imageFrameThumbWidth("bar", "landscape"), 40);
      assert.equal(api.imageFrameThumbWidth("note", "landscape"), 40);
      assert.equal(api.imageFrameThumbWidth("note", "portrait"), 16);
    });

    test("STRK-436: imageFrameThumbHeight is 36px for portrait Bar/Note, 28px otherwise", () => {
      assert.equal(api.imageFrameThumbHeight("bar", "portrait"), 36);
      assert.equal(api.imageFrameThumbHeight("note", "portrait"), 36);
      assert.equal(api.imageFrameThumbHeight("round", ""), 28);
      assert.equal(api.imageFrameThumbHeight("slab", ""), 28);
      assert.equal(api.imageFrameThumbHeight("bar", "landscape"), 28);
      assert.equal(api.imageFrameThumbHeight("note", "landscape"), 28);
    });

    test("STRK-436: imageFrameThumbWidth derives from a given height, same clamp", () => {
      assert.equal(api.imageFrameThumbWidth("bar", "portrait", 36), 22);
      assert.equal(api.imageFrameThumbWidth("note", "portrait", 36), 18);
      assert.equal(api.imageFrameThumbWidth("note", "landscape", 28), 40);
    });
  });

  describe("grading first changes the shape name, not the round/rect binary", () => {
    test("a graded item is rect whichever Type it has, until the user picks Round", () => {
      assert.equal(resolve({ type: "Coin", gradingAuthority: "PCGS" }), "rect");
      assert.equal(resolve({ type: "Bar", gradingAuthority: "NGC" }), "rect");
      assert.equal(
        resolve({ type: "Coin", gradingAuthority: "PCGS", imageShape: "round" }),
        "round"
      );
    });
  });
});
