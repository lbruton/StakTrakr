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

// ---------------------------------------------------------------------------
// STRK-427: one shape model for items and Custom Collections.
//
// The functions below are pure. The renderers (table, cards, view modal) read them through
// `resolveImageFrameSpec` and `resolveImageFrame` (P2, approach D-17).
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
 * @param {*} rawShape - Numista shape text, possibly absent or whitespace-only (absent)
 * @returns {boolean} True for a present, non-round shape
 */
function imageFrameIsNonRoundShape(rawShape) {
  const trimmedShape = String(rawShape || "").trim();
  if (!trimmedShape) return false;
  const rawText = trimmedShape.toLowerCase();
  const category =
    typeof window !== "undefined" && typeof window.classifyShape === "function"
      ? window.classifyShape(trimmedShape)
      : typeof classifyShape === "function"
        ? classifyShape(trimmedShape)
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
 * The frame one renderer draws for one side of an item: the shared reader's shape, that side's
 * orientation, and the legacy round/rect binary the existing classes still key off (P2, D-17).
 * One item has one shape; only the orientation differs per side (AC-8.4).
 * @param {Object|null|undefined} item
 * @param {"obverse"|"reverse"} [side="obverse"]
 * @returns {{shape: "round"|"bar"|"note"|"slab", orientation: "portrait"|"landscape"|"", frame: "round"|"rect"}}
 *   `orientation` is "" for a shape that never rotates.
 */
function resolveImageFrameSpec(item, side = "obverse") {
  const framing = readImageFraming(item);
  const orientation =
    (side === "reverse" ? framing.reverseOrientation : framing.obverseOrientation) || "";
  return {
    shape: framing.shape,
    orientation,
    frame: framing.shape === "round" ? "round" : "rect",
  };
}

/**
 * Resolve the effective round/rect frame for one item side. A thin wrapper over the shared
 * reader (P2): every non-round shape is `rect`, so the `bar-shape`, `table-thumb-rect` and
 * `view-shape-rect` hooks keep working beside the new `data-shape` attributes (D-17, D-18).
 * @param {Object|null|undefined} item
 * @param {"obverse"|"reverse"} [side="obverse"]
 * @returns {"round"|"rect"}
 */
function resolveImageFrame(item, side = "obverse") {
  return resolveImageFrameSpec(item, side).frame;
}

/**
 * The attribute fragment the HTML-string renderers (table thumbs, cards) put on a frame
 * wrapper: `data-shape`, plus `data-orientation` only for a shape that rotates. Both values
 * come from fixed enums, so the fragment is safe to concatenate into markup.
 * @param {Object|null|undefined} item
 * @param {"obverse"|"reverse"} [side="obverse"]
 * @returns {string} Leading-space attribute text, e.g. ` data-shape="bar" data-orientation="portrait"`
 */
function imageFrameAttrHtml(item, side = "obverse") {
  const spec = resolveImageFrameSpec(item, side);
  return ` data-shape="${spec.shape}"${spec.orientation ? ` data-orientation="${spec.orientation}"` : ""}`;
}

// Mirrors the `:root` --frame-* tokens in css/styles.css; the live token wins when readable.
const IMAGE_FRAME_RATIO_FALLBACK = {
  round: 1,
  slab: 0.68,
  "bar:portrait": 0.6,
  "bar:landscape": 1.6,
  "note:portrait": 1 / 2.05,
  "note:landscape": 2.05,
};
const IMAGE_FRAME_RATIO_TOKENS = {
  slab: "--frame-slab",
  "bar:portrait": "--frame-bar-portrait",
  "bar:landscape": "--frame-bar-landscape",
  "note:portrait": "--frame-note-portrait",
  "note:landscape": "--frame-note-landscape",
};

/**
 * The width/height ratio of a frame, read from the shared CSS tokens (so the renderers and the
 * generated placeholder SVG cannot drift from the stylesheet), with the token values as the
 * fallback when no stylesheet is present.
 * @param {string} shape - "round" | "bar" | "note" | "slab"
 * @param {string} [orientation] - "portrait" | "landscape" (Bar and Note only)
 * @returns {number} Width divided by height; 1 for an unknown shape
 */
function imageFrameRatio(shape, orientation) {
  const key = shape === "bar" || shape === "note" ? `${shape}:${orientation}` : shape;
  const fallback = IMAGE_FRAME_RATIO_FALLBACK[key];
  if (!fallback) return 1;
  const token = IMAGE_FRAME_RATIO_TOKENS[key];
  if (token && typeof document !== "undefined" && document.documentElement) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    const fraction = /^calc\(\s*([\d.]+)\s*\/\s*([\d.]+)\s*\)$/.exec(raw);
    const live = fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(raw);
    if (Number.isFinite(live) && live > 0) return live;
  }
  return fallback;
}

const IMAGE_FRAME_THUMB_HEIGHT = 28;
const IMAGE_FRAME_THUMB_HEIGHT_PORTRAIT = 36;
const IMAGE_FRAME_THUMB_MIN_WIDTH = 16;
const IMAGE_FRAME_THUMB_MAX_WIDTH = 40;

/**
 * The table thumbnail's height for a frame (STRK-436): 36px for a portrait Bar or Note, so its
 * area matches a round coin's, 28px for every other frame. Mirrors the stylesheet's
 * `--table-thumb-h` / `--table-thumb-h-portrait` tokens.
 * @param {string} shape
 * @param {string} [orientation]
 * @returns {number} Height in CSS pixels
 */
function imageFrameThumbHeight(shape, orientation) {
  const portrait = (shape === "bar" || shape === "note") && orientation === "portrait";
  return portrait ? IMAGE_FRAME_THUMB_HEIGHT_PORTRAIT : IMAGE_FRAME_THUMB_HEIGHT;
}

/**
 * The table thumbnail's width for a frame: ratio-derived from the given height (28px when
 * omitted), clamped to 16..40px (the approved P2 table-thumb clamp). The stylesheet applies the
 * same clamp to `.table-thumb`.
 * @param {string} shape
 * @param {string} [orientation]
 * @param {number} [height] - Thumb height in CSS pixels (default 28)
 * @returns {number} Width in CSS pixels
 */
function imageFrameThumbWidth(shape, orientation, height = IMAGE_FRAME_THUMB_HEIGHT) {
  const width = Math.round(height * imageFrameRatio(shape, orientation));
  return Math.min(IMAGE_FRAME_THUMB_MAX_WIDTH, Math.max(IMAGE_FRAME_THUMB_MIN_WIDTH, width));
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

// ---- Import / export helpers (STRK-427, D-13, D-14) ------------------------------------

const IMAGE_FRAMING_STORED_KEYS = [
  "imageShape",
  "obverseImageOrientation",
  "reverseImageOrientation",
  "obverseImageFrame",
  "reverseImageFrame",
];
// Appended after the last item column and before "Collections" in both CSV header lists.
const IMAGE_FRAMING_CSV_HEADERS = [
  "Image Shape",
  "Obverse Image Orientation",
  "Reverse Image Orientation",
];

/**
 * The frame fields an item actually carries, for JSON and ZIP export. Absent keys are omitted,
 * and `""` and the legacy `auto` value are never written (Tradeoff 8), so a sparse item exports
 * no frame keys and a restored legacy item cannot look migrated.
 * @param {Object|null|undefined} item
 * @returns {Object} Only the present, non-empty frame fields
 */
function imageFramingFields(item) {
  const record = item || {};
  const fields = {};
  IMAGE_FRAMING_STORED_KEYS.forEach((key) => {
    const value = record[key];
    if (typeof value === "string" && value !== "" && value !== "auto") fields[key] = value;
  });
  return fields;
}

/**
 * The three new CSV cells for an item, in IMAGE_FRAMING_CSV_HEADERS order.
 * @param {Object|null|undefined} item
 * @returns {string[]} Image Shape, Obverse Image Orientation, Reverse Image Orientation
 */
function imageFramingCsvCells(item) {
  const record = item || {};
  return [
    normalizeImageShape(record.imageShape) || "",
    normalizeImageOrientation(record.obverseImageOrientation) || "",
    normalizeImageOrientation(record.reverseImageOrientation) || "",
  ];
}

/**
 * Read the frame fields from an imported record (JSON item or CSV row, any header casing) into
 * a sparse object. Enum values are validated, so an invalid value reads as absent (I-10); the
 * legacy frames keep only `circle` and `rectangle` (AC-8.7).
 * @param {Object} source - Raw record keyed by camelCase field or CSV header
 * @returns {Object} Only the valid frame fields
 */
function readImportedImageFraming(source) {
  const row = source || {};
  const pick = (...names) => {
    for (const name of names) {
      const value = row[name];
      if (value != null && String(value).trim() !== "") return String(value).trim().toLowerCase();
    }
    return "";
  };
  const out = {};
  const shape = normalizeImageShape(pick("imageShape", "Image Shape"));
  if (shape) out.imageShape = shape;
  const obverse = normalizeImageOrientation(
    pick("obverseImageOrientation", "Obverse Image Orientation")
  );
  if (obverse) out.obverseImageOrientation = obverse;
  const reverse = normalizeImageOrientation(
    pick("reverseImageOrientation", "Reverse Image Orientation")
  );
  if (reverse) out.reverseImageOrientation = reverse;
  [
    ["obverseImageFrame", "Obverse Frame"],
    ["reverseImageFrame", "Reverse Frame"],
  ].forEach(([key, header]) => {
    const legacy = normalizeImageFrame(pick(key, header));
    if (legacy !== "auto") out[key] = legacy;
  });
  return out;
}

if (typeof window !== "undefined") {
  window.IMAGE_FRAMING_CSV_HEADERS = IMAGE_FRAMING_CSV_HEADERS;
  window.imageFramingFields = imageFramingFields;
  window.imageFramingCsvCells = imageFramingCsvCells;
  window.readImportedImageFraming = readImportedImageFraming;
  window.normalizeImageFrame = normalizeImageFrame;
  window.cycleFrame = cycleFrame;
  window.resolveImageFrame = resolveImageFrame;
  window.resolveImageFrameSpec = resolveImageFrameSpec;
  window.imageFrameAttrHtml = imageFrameAttrHtml;
  window.imageFrameRatio = imageFrameRatio;
  window.imageFrameThumbWidth = imageFrameThumbWidth;
  window.imageFrameThumbHeight = imageFrameThumbHeight;
  window.normalizeImageShape = normalizeImageShape;
  window.normalizeImageOrientation = normalizeImageOrientation;
  window.defaultImageOrientation = defaultImageOrientation;
  window.deriveImageShape = deriveImageShape;
  window.readImageFraming = readImageFraming;
  window.writeImageFraming = writeImageFraming;
}
