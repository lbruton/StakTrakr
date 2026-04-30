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

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

window.initFieldMeta = initFieldMeta;
window.markUserModified = markUserModified;
