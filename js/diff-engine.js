/**
 * diff-engine.js — Pure-data diff/merge module for StakTrakr sync (STAK-186)
 *
 * Zero DOM dependencies. No document, no window event listeners, no safeGetElement.
 * All functions are pure data transformations.
 *
 * Item key strategy mirrors inventory.js dedup logic:
 *   Primary:  item.serial (numeric internal serial — exact match)
 *   Fallback: `${item.numistaId}|${item.name}|${item.date}` composite key
 *
 * Fields compared in item diff cover all sync-relevant InventoryItem fields.
 * Both DIFF_FIELDS and changeLog.js logItemChanges() must stay in sync —
 * see STAK-493 for the bug caused by an incomplete list.
 * Note: runtime-only fields in types.js (uuid, serial) are excluded because
 * they are identity keys, not diffable data.
 */

/* eslint-disable no-unused-vars */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Fields compared during item-level diffing.
 * Must cover ALL user-editable fields on InventoryItem (js/types.js).
 * When adding a new field to the item schema, add it here too — otherwise
 * cloud sync will silently drop it on matched items (STAK-493).
 */
const DIFF_FIELDS = [
  // Core identity & physical
  'name',
  'metal',
  'composition',
  'weight',
  'weightUnit',
  'purity',
  'qty',
  'type',
  'date',
  'year',
  // Financials
  'price',
  'purchasePrice',
  'retailPrice',
  'marketValue',
  'purchaseLocation',
  'spotPriceAtPurchase',
  'premiumPerOz',
  'totalPremium',
  // Storage & notes
  'storageLocation',
  'notes',
  // Grading & certification
  'grade',
  'gradingAuthority',
  'certNumber',
  'serialNumber',
  'pcgsNumber',
  'pcgsVerified',
  // Catalog & collection
  'numistaId',
  'collectable',
  'ignorePatternImages',
  'currency',
  // Images (STAK-493: these were missing, causing silent data loss during sync)
  'obverseImageUrl',
  'reverseImageUrl',
  'obverseSharedImageId',
  'reverseSharedImageId',
  // Disposition
  'disposition',
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when two values are considered equal for diff purposes.
 * Uses strict equality after normalising undefined/null to null so that
 * a missing field and an explicit null are treated identically.
 *
 * @param {*} a
 * @param {*} b
 * @returns {boolean}
 */
function _valuesEqual(a, b) {
  const norm = (v) => (v === undefined ? null : v);
  a = norm(a); b = norm(b);
  if (a === b) return true;
  if (a === null || b === null) return false;
  // Deep compare for objects (e.g. disposition) — recursive stable stringify
  if (typeof a === 'object' && typeof b === 'object') {
    return _stableStringify(a) === _stableStringify(b);
  }
  return false;
}

/**
 * Recursively stable JSON stringify — sorts object keys at every depth.
 * Arrays preserve element order; only plain-object keys are sorted.
 * @param {*} val
 * @returns {string}
 */
function _stableStringify(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val !== 'object') return JSON.stringify(val);
  if (Array.isArray(val)) return '[' + val.map(_stableStringify).join(',') + ']';
  var keys = Object.keys(val).sort();
  return '{' + keys.map(function(k) { return JSON.stringify(k) + ':' + _stableStringify(val[k]); }).join(',') + '}';
}

/**
 * Settings-specific deep equality that handles type mismatches common in
 * localStorage (string "true" vs boolean true, string "3" vs number 3)
 * and parsed vs unparsed JSON objects.
 */
function _settingsValuesEqual(a, b) {
  const norm = (v) => (v === undefined ? null : v);
  a = norm(a); b = norm(b);
  if (a === b) return true;
  if (a === null || b === null) return false;
  // Deep compare for objects/arrays — sorted-key stringify for key-order independence
  // Arrays are order-sensitive (e.g. headerBtnOrder), so preserve their element order.
  // Only sort keys for plain objects to normalize key insertion order differences.
  if (typeof a === 'object' && typeof b === 'object') {
    const sortedStringify = (v) =>
      Array.isArray(v) ? JSON.stringify(v) : JSON.stringify(v, Object.keys(v).sort());
    return sortedStringify(a) === sortedStringify(b);
  }
  // Type coercion for primitive mismatches only: "true"/true, "3"/3
  if (typeof a !== typeof b) {
    const aType = typeof a;
    const bType = typeof b;
    if ((aType === 'string' || aType === 'number' || aType === 'boolean') &&
        (bType === 'string' || bType === 'number' || bType === 'boolean')) {
      return String(a) === String(b);
    }
    return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DiffEngine = {

  // -------------------------------------------------------------------------
  // computeItemKey
  // -------------------------------------------------------------------------

  /**
   * Derives a stable string key for an item.
   *   – Primary:  item.uuid   (stable across export/import — STAK-380)
   *   – Secondary: item.serial (numeric, legacy items without uuid)
   *   – Tertiary: `${numistaId}|${name}|${date}` when numistaId is present
   *   – Last resort: `name|date` for items without any identifier
   *
   * STAK-187 changeLog.js extension MUST use this same function so that keys
   * remain consistent across modules.
   *
   * @param {object} item
   * @returns {string}
   */
  computeItemKey(item) {
    if (item == null) return '';

    // Primary: UUID (stable across export/import)
    if (item.uuid) return String(item.uuid);

    // Secondary: numeric serial assigned by loadInventory()
    if (item.serial != null && item.serial !== '') {
      return String(item.serial);
    }

    // Tertiary: numistaId composite key
    if (item.numistaId) {
      return `${item.numistaId}|${item.name || ''}|${item.date || ''}`;
    }

    // Last resort: name + date
    return `${item.name || ''}|${item.date || ''}`;
  },

  // -------------------------------------------------------------------------
  // matchItems
  // -------------------------------------------------------------------------

  /**
   * Pairs local and remote items by their computed key.
   *
   * Items that exist in both lists land in `matched`.
   * Items only in the local list land in `localOnly`.
   * Items only in the remote list land in `remoteOnly`.
   *
   * @param {object[]} localItems
   * @param {object[]} remoteItems
   * @returns {{ matched: Array<{local:object, remote:object}>, localOnly: object[], remoteOnly: object[] }}
   */
  matchItems(localItems, remoteItems) {
    const local = Array.isArray(localItems) ? localItems : [];
    const remote = Array.isArray(remoteItems) ? remoteItems : [];

    // Build remote lookup keyed by computeItemKey
    const remoteMap = new Map();
    for (const item of remote) {
      const key = DiffEngine.computeItemKey(item);
      remoteMap.set(key, item);
    }

    const matched = [];
    const localOnly = [];
    const seenRemoteKeys = new Set();

    for (const localItem of local) {
      const key = DiffEngine.computeItemKey(localItem);
      if (remoteMap.has(key)) {
        matched.push({ local: localItem, remote: remoteMap.get(key) });
        seenRemoteKeys.add(key);
      } else {
        localOnly.push(localItem);
      }
    }

    const remoteOnly = remote.filter(
      (item) => !seenRemoteKeys.has(DiffEngine.computeItemKey(item))
    );

    return { matched, localOnly, remoteOnly };
  },

  // -------------------------------------------------------------------------
  // compareItems
  // -------------------------------------------------------------------------

  /**
   * Compares two flat arrays of inventory items and classifies each item as
   * added, modified, deleted, or unchanged relative to the remote snapshot.
   *
   * "added"    — present in remote but not in local  (remote adds)
   * "deleted"  — present in local but not in remote  (remote deletes)
   * "modified" — present in both but one or more DIFF_FIELDS differ
   * "unchanged"— present in both with identical DIFF_FIELDS values
   *
   * @param {object[]} localItems
   * @param {object[]} remoteItems
   * @returns {{ added: object[], modified: Array<{item:object, changes:Array<{field:string,localVal:*,remoteVal:*}>}>, deleted: object[], unchanged: object[] }}
   */
  compareItems(localItems, remoteItems) {
    const result = {
      added: [],
      modified: [],
      deleted: [],
      unchanged: [],
    };

    const { matched, localOnly, remoteOnly } = DiffEngine.matchItems(localItems, remoteItems);

    // Items in remote but not local → added from remote perspective
    result.added = remoteOnly.slice();

    // Items in local but not remote → deleted from remote perspective
    result.deleted = localOnly.slice();

    // Items in both — check field-level diff
    for (const { local, remote } of matched) {
      const changes = [];

      for (const field of DIFF_FIELDS) {
        if (!_valuesEqual(local[field], remote[field])) {
          changes.push({
            field,
            localVal: local[field] !== undefined ? local[field] : null,
            remoteVal: remote[field] !== undefined ? remote[field] : null,
          });
        }
      }

      if (changes.length > 0) {
        result.modified.push({ item: remote, changes });
      } else {
        result.unchanged.push(local);
      }
    }

    return result;
  },

  // -------------------------------------------------------------------------
  // compareSettings
  // -------------------------------------------------------------------------

  /**
   * Compares two flat settings objects (key→value maps) and returns which
   * keys have changed and which are identical.
   *
   * @param {object} localSettings
   * @param {object} remoteSettings
   * @returns {{ changed: Array<{key:string, localVal:*, remoteVal:*}>, unchanged: Array<{key:string, val:*}> }}
   */
  compareSettings(localSettings, remoteSettings) {
    const local = localSettings != null && typeof localSettings === 'object' ? localSettings : {};
    const remote = remoteSettings != null && typeof remoteSettings === 'object' ? remoteSettings : {};

    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    const changed = [];
    const unchanged = [];

    for (const key of allKeys) {
      const localVal = local[key] !== undefined ? local[key] : null;
      const remoteVal = remote[key] !== undefined ? remote[key] : null;

      if (!_settingsValuesEqual(localVal, remoteVal)) {
        changed.push({ key, localVal, remoteVal });
      } else {
        unchanged.push({ key, val: localVal });
      }
    }

    return { changed, unchanged };
  },

  // -------------------------------------------------------------------------
  // detectConflicts
  // -------------------------------------------------------------------------

  /**
   * Given two sets of changes (each an array of {itemKey, field, localVal, remoteVal}),
   * identifies fields touched by both sides (conflicts) vs fields touched by only
   * one side (clean — safe to auto-apply).
   *
   * A conflict occurs when the same itemKey+field pair appears in both
   * localChanges and remoteChanges with differing values.
   *
   * @param {Array<{itemKey:string, field:string, localVal:*, remoteVal:*}>} localChanges
   * @param {Array<{itemKey:string, field:string, localVal:*, remoteVal:*}>} remoteChanges
   * @returns {{ conflicts: Array<{itemKey:string, field:string, localVal:*, remoteVal:*}>, clean: Array<{itemKey:string, field:string, localVal:*, remoteVal:*}> }}
   */
  detectConflicts(localChanges, remoteChanges) {
    const local = Array.isArray(localChanges) ? localChanges : [];
    const remote = Array.isArray(remoteChanges) ? remoteChanges : [];

    // Build lookup: "itemKey|field" → change entry for remote side
    const remoteIndex = new Map();
    for (const change of remote) {
      const key = `${change.itemKey}|${change.field}`;
      remoteIndex.set(key, change);
    }

    const conflicts = [];
    const clean = [];
    const conflictedKeys = new Set();

    for (const localChange of local) {
      const lookupKey = `${localChange.itemKey}|${localChange.field}`;
      if (remoteIndex.has(lookupKey)) {
        const remoteChange = remoteIndex.get(lookupKey);
        // Only a conflict if the resolved values differ
        if (!_valuesEqual(localChange.remoteVal, remoteChange.remoteVal)) {
          conflicts.push({
            itemKey: localChange.itemKey,
            field: localChange.field,
            localVal: localChange.remoteVal,   // local's view of the new value
            remoteVal: remoteChange.remoteVal, // remote's view of the new value
          });
          conflictedKeys.add(lookupKey);
        } else {
          // Both sides agree on the new value — clean
          clean.push(remoteChange);
          conflictedKeys.add(lookupKey);
        }
      } else {
        clean.push(localChange);
      }
    }

    // Remote-only changes (not touched locally) are always clean
    for (const remoteChange of remote) {
      const lookupKey = `${remoteChange.itemKey}|${remoteChange.field}`;
      if (!conflictedKeys.has(lookupKey)) {
        clean.push(remoteChange);
      }
    }

    return { conflicts, clean };
  },

  // -------------------------------------------------------------------------
  // applySelectedChanges
  // -------------------------------------------------------------------------

  /**
   * Applies a list of accepted changes to a local inventory array and returns
   * the updated inventory (non-destructive — returns a new array).
   *
   * Each change in `selectedChanges` is one of:
   *   { type: 'add',    item: object }         — append item
   *   { type: 'delete', itemKey: string }       — remove item by key
   *   { type: 'modify', itemKey: string, field: string, value: * } — patch field
   *
   * @param {object[]} inventory
   * @param {Array<{type:string, item?:object, itemKey?:string, field?:string, value?:*}>} selectedChanges
   * @returns {object[]}
   */
  applySelectedChanges(inventory, selectedChanges) {
    if (!Array.isArray(inventory)) return [];
    if (!Array.isArray(selectedChanges) || selectedChanges.length === 0) {
      return inventory.slice();
    }

    // Work on a shallow copy; items are replaced by reference on modify
    let result = inventory.slice();

    // Partition changes by type for efficient application
    const toAdd = [];
    const toDelete = new Set();
    const toModify = []; // [{itemKey, field, value}]

    for (const change of selectedChanges) {
      switch (change.type) {
        case 'add':
          if (change.item != null) toAdd.push(change.item);
          break;
        case 'delete':
          if (change.itemKey != null) toDelete.add(String(change.itemKey));
          break;
        case 'modify':
          if (change.itemKey != null && change.field != null) {
            toModify.push(change);
          }
          break;
        default:
          // Unknown change type — skip silently
          break;
      }
    }

    // Apply deletes and modifications in a single pass
    result = result
      .filter((item) => !toDelete.has(DiffEngine.computeItemKey(item)))
      .map((item) => {
        const key = DiffEngine.computeItemKey(item);
        const patches = toModify.filter((c) => String(c.itemKey) === key);
        if (patches.length === 0) return item;

        // Clone item and apply patches
        const updated = Object.assign({}, item);
        for (const patch of patches) {
          updated[patch.field] = patch.value;
        }
        return updated;
      });

    // Append additions
    for (const newItem of toAdd) {
      result.push(newItem);
    }

    return result;
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

window.DiffEngine = DiffEngine;
