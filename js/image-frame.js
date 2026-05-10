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

if (typeof window !== "undefined") {
  window.normalizeImageFrame = normalizeImageFrame;
  window.cycleFrame = cycleFrame;
  window.resolveImageFrame = resolveImageFrame;
}
