"use strict";

/**
 * Normalize a stored per-side image frame value.
 * @param {*} value
 * @returns {"auto"|"circle"|"rectangle"}
 */
function normalizeImageFrame(value) {
  return value === "circle" || value === "rectangle" ? value : "auto";
}

/**
 * Return the next frame override value for the add/edit modal toggle.
 * @param {*} value
 * @returns {"auto"|"circle"|"rectangle"}
 */
function cycleFrame(value) {
  const current = normalizeImageFrame(value);
  if (current === "auto") return "circle";
  if (current === "circle") return "rectangle";
  return "auto";
}

/**
 * Resolve the effective image frame for one item side.
 * @param {Object|null|undefined} item
 * @param {"obverse"|"reverse"} [side="obverse"]
 * @returns {"round"|"rect"}
 */
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
  const shape =
    typeof window !== "undefined" && typeof window.classifyShape === "function"
      ? window.classifyShape(rawShape)
      : typeof classifyShape === "function"
        ? classifyShape(rawShape)
        : rawShapeText.startsWith("round") || rawShapeText.startsWith("circular")
          ? "round"
          : rawShapeText;
  return shape && shape !== "round" ? "rect" : "round";
}

// ---------------------------------------------------------------------------
// STRK-427: one shape model for items and Custom Collections.
//
// The functions below are pure. `resolveImageFrame` above is deliberately unchanged in P1, so
// renderers keep reading the legacy round/rect binary until P2 moves them onto this reader.
// ---------------------------------------------------------------------------

const IMAGE_FRAME_SHAPES = ["round", "bar", "note", "slab"];
const IMAGE_FRAME_ORIENTATIONS = ["portrait", "landscape"];
const IMAGE_FRAME_NOTE_TYPES = ["note", "aurum", "goldback", "silverback"];

/**
 * Normalize a stored image shape.
 * @param {*} value
 * @returns {"round"|"bar"|"note"|"slab"|null} The shape, or null when absent or invalid
 */
function normalizeImageShape(value) {
  return IMAGE_FRAME_SHAPES.includes(value) ? value : null;
}

/**
 * Normalize a stored per-side image orientation.
 * @param {*} value
 * @returns {"portrait"|"landscape"|null} The orientation, or null when absent or invalid
 */
function normalizeImageOrientation(value) {
  return IMAGE_FRAME_ORIENTATIONS.includes(value) ? value : null;
}

/**
 * The orientation a newly chosen shape starts with. Only Bar and Note rotate.
 * @param {*} shape
 * @returns {"portrait"|"landscape"|null} Bar portrait, Note landscape, null for any other shape
 */
function defaultImageOrientation(shape) {
  if (shape === "bar") return "portrait";
  if (shape === "note") return "landscape";
  return null;
}

/**
 * Whether a raw Numista shape describes something other than a round piece.
 * @param {*} rawShape - Numista shape text, possibly absent
 * @returns {boolean} True for a present, non-round shape
 */
function imageFrameIsNonRoundShape(rawShape) {
  const rawText = String(rawShape || "").toLowerCase();
  const category =
    typeof window !== "undefined" && typeof window.classifyShape === "function"
      ? window.classifyShape(rawShape)
      : typeof classifyShape === "function"
        ? classifyShape(rawShape)
        : rawText.startsWith("round") || rawText.startsWith("circular")
          ? "round"
          : rawText;
  return Boolean(category) && category !== "round";
}

/**
 * The one resolver from item signals to a frame shape (AC-4.1, AC-4.2). Grading wins, then
 * Type, then a non-round Numista shape for a Coin, else Round.
 * @param {{type?: string, gradingAuthority?: string, numistaShape?: string}} [signals]
 * @returns {"round"|"bar"|"note"|"slab"} The derived shape
 */
function deriveImageShape(signals) {
  const input = signals || {};
  if (String(input.gradingAuthority || "").trim()) return "slab";
  const type = String(input.type || "")
    .trim()
    .toLowerCase();
  if (type === "bar" || type === "set") return "bar";
  if (IMAGE_FRAME_NOTE_TYPES.includes(type)) return "note";
  if (type === "coin" && imageFrameIsNonRoundShape(input.numistaShape)) return "bar";
  return "round";
}

/**
 * Resolve an item's shape and per-side orientation: a valid new field, else the legacy
 * obverse frame mapped through the derived shape, else the derived shape (AC-8.1, AC-8.2,
 * AC-8.4). A legacy `rectangle` on an item that derives Round reads as Bar (D-3). The record
 * is never mutated; a stale orientation under a non-rotating shape is ignored, not removed.
 * @param {Object|null|undefined} item
 * @returns {{shape: string, obverseOrientation: string|null, reverseOrientation: string|null}}
 */
function readImageFraming(item) {
  const record = item || {};
  const derived = deriveImageShape({
    type: record.type,
    gradingAuthority: record.gradingAuthority,
    numistaShape: record.numistaData?.shape,
  });
  let shape = normalizeImageShape(record.imageShape);
  if (!shape) {
    const legacy = normalizeImageFrame(record.obverseImageFrame);
    if (legacy === "circle") shape = "round";
    else if (legacy === "rectangle") shape = derived === "round" ? "bar" : derived;
    else shape = derived;
  }
  const fallback = defaultImageOrientation(shape);
  const orientationOf = (value) => (fallback ? normalizeImageOrientation(value) || fallback : null);
  return {
    shape,
    obverseOrientation: orientationOf(record.obverseImageOrientation),
    reverseOrientation: orientationOf(record.reverseImageOrientation),
  };
}

/**
 * Turn the editor's final state into the sparse item fields to store (D-2, D-4). A shape that
 * equals the one the final signals derive, and an orientation that equals its shape's default,
 * are never stored. An explicit shape also writes the legacy `*ImageFrame` projection
 * (Round → circle, anything else → rectangle) so older builds still render a round or
 * rectangular frame. Every key this feature owns lands in exactly one of `set` and `remove`.
 * @param {{shape?: string, obverseOrientation?: string, reverseOrientation?: string}} state
 * @param {{type?: string, gradingAuthority?: string, numistaShape?: string}} [signals]
 * @returns {{set: Object, remove: string[]}} Fields to write and keys to delete
 */
function writeImageFraming(state, signals) {
  const final = state || {};
  const derived = deriveImageShape(signals);
  const shape = normalizeImageShape(final.shape) || derived;
  const set = {};
  const remove = [];
  if (shape !== derived) {
    const legacy = shape === "round" ? "circle" : "rectangle";
    set.imageShape = shape;
    set.obverseImageFrame = legacy;
    set.reverseImageFrame = legacy;
  } else {
    remove.push("imageShape", "obverseImageFrame", "reverseImageFrame");
  }
  const fallback = defaultImageOrientation(shape);
  [
    ["obverseOrientation", "obverseImageOrientation"],
    ["reverseOrientation", "reverseImageOrientation"],
  ].forEach(([stateKey, storedKey]) => {
    const value = normalizeImageOrientation(final[stateKey]);
    if (fallback && value && value !== fallback) set[storedKey] = value;
    else remove.push(storedKey);
  });
  return { set, remove };
}

if (typeof window !== "undefined") {
  window.normalizeImageFrame = normalizeImageFrame;
  window.cycleFrame = cycleFrame;
  window.resolveImageFrame = resolveImageFrame;
  window.normalizeImageShape = normalizeImageShape;
  window.normalizeImageOrientation = normalizeImageOrientation;
  window.defaultImageOrientation = defaultImageOrientation;
  window.deriveImageShape = deriveImageShape;
  window.readImageFraming = readImageFraming;
  window.writeImageFraming = writeImageFraming;
}
