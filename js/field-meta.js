/**
 * field-meta.js — Pure-data fieldMeta CRUD module for StakTrakr
 *
 * Tracks per-field origin (numista, pcgs, csv-import, manual) and whether
 * the user has manually modified each field since the last API sync.
 *
 * Zero DOM dependencies. No document, no window event listeners, no safeGetElement.
 * All functions are pure data transformations.
 *
 * Related: catalog-api.js normalizeItemData() (field names),
 *          diff-engine.js (pure-data module pattern reference).
 */

"use strict";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Field tier definitions for the re-sync picker modal.
 * Tier 1: always visible. Tier 2: behind "Show more fields" toggle.
 */
const FIELD_TIERS = {
  tier1: ["name", "numistaId", "year", "type", "weight", "tags"],
  tier2: [
    "country",
    "denomination",
    "composition",
    "shape",
    "diameter",
    "thickness",
    "metal",
    "orientation",
    "description",
    "grade",
    "mintage",
    "technique",
    "commemorative",
  ],
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a fieldMeta object from normalized API data.
 * Each non-empty field in normalizedData gets an entry with
 * { source, userModified: false }.
 *
 * @param {object} normalizedData - Output of normalizeItemData()
 * @param {string} source - Origin identifier ('numista', 'pcgs', 'csv-import', 'manual')
 * @returns {object} fieldMeta map: { fieldName: { source, userModified } }
 */
function initFieldMeta(normalizedData, source) {
  if (normalizedData == null || typeof normalizedData !== "object") return {};

  const src = source || "manual";
  const meta = {};

  for (const key of Object.keys(normalizedData)) {
    // Skip internal/metadata fields that are not user-facing inventory fields
    if (key === "fieldMeta" || key === "provider" || key === "lastUpdated") continue;

    const val = normalizedData[key];

    // Non-empty check: skip null, undefined, empty string, 0, false, empty arrays
    if (val === null || val === undefined || val === "" || val === false) continue;
    if (typeof val === "number" && val === 0) continue;
    if (Array.isArray(val) && val.length === 0) continue;

    meta[key] = { source: src, userModified: false };
  }

  return meta;
}

/**
 * Returns the fieldMeta entry for a specific field on an item.
 * If the item has no fieldMeta or the field has no entry, returns
 * a legacy fallback indicating manual/user-modified data.
 *
 * @param {object} item - Inventory item
 * @param {string} fieldName - Field to look up
 * @returns {{ source: string, userModified: boolean }}
 */
function getFieldMeta(item, fieldName) {
  if (
    item != null &&
    item.fieldMeta != null &&
    typeof item.fieldMeta === "object" &&
    item.fieldMeta[fieldName] != null
  ) {
    return item.fieldMeta[fieldName];
  }

  // Legacy fallback — treat as manually entered and user-modified
  return { source: "manual", userModified: true };
}

/**
 * Marks a field as user-modified on an item. Creates the fieldMeta
 * object and/or field entry if absent.
 *
 * @param {object} item - Inventory item (mutated in place)
 * @param {string} fieldName - Field to mark
 */
function markUserModified(item, fieldName) {
  if (item == null || !fieldName) return;

  if (item.fieldMeta == null || typeof item.fieldMeta !== "object") {
    item.fieldMeta = {};
  }

  if (item.fieldMeta[fieldName] != null) {
    item.fieldMeta[fieldName].userModified = true;
  } else {
    item.fieldMeta[fieldName] = { source: "manual", userModified: true };
  }
}

/**
 * Applies checked fields from the re-sync picker to an item.
 * For each field where selections[fieldName] is true, copies the value
 * from normalizedData to item and resets that field's meta to
 * { source, userModified: false }.
 *
 * @param {object} item - Inventory item (mutated in place)
 * @param {object} selections - Map of { fieldName: boolean } from picker
 * @param {object} normalizedData - Normalized API data to apply from
 * @param {string} [source='numista'] - Source identifier for fieldMeta
 */
function applyPickerSelections(item, selections, normalizedData, source) {
  if (item == null || selections == null || normalizedData == null) return;

  const src = source || "numista";

  if (item.fieldMeta == null || typeof item.fieldMeta !== "object") {
    item.fieldMeta = {};
  }

  for (const fieldName of Object.keys(selections)) {
    if (!selections[fieldName]) continue; // unchecked — skip

    // Apply the value from normalized data
    if (fieldName in normalizedData) {
      const val = normalizedData[fieldName];
      item[fieldName] = Array.isArray(val) ? [...val] : val;
      item.fieldMeta[fieldName] = { source: src, userModified: false };
    }
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

window.FIELD_TIERS = FIELD_TIERS;
window.initFieldMeta = initFieldMeta;
window.getFieldMeta = getFieldMeta;
window.markUserModified = markUserModified;
window.applyPickerSelections = applyPickerSelections;
