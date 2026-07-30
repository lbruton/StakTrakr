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

"use strict";

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
  "name",
  "metal",
  "composition",
  "weight",
  "weightUnit",
  // Constitutional (junk silver) — STRK-235
  "constitutionalVariant",
  "constitutionalEntryMode",
  "purity",
  "qty",
  "type",
  "date",
  "year",
  // Financials
  "price",
  // STRK-242: pricingType (lot/each) is load-bearing for cu denom edit-restore; a
  // lot↔each change must be diffable on import-merge (D-6). Keep in sync with changeLog.js.
  "pricingType",
  "purchasePrice",
  "retailPrice",
  "marketValue",
  "purchaseLocation",
  "spotPriceAtPurchase",
  "premiumPerOz",
  "totalPremium",
  // Storage & notes
  "storageLocation",
  "notes",
  // Grading & certification
  "grade",
  "gradingAuthority",
  "certNumber",
  "serialNumber",
  "pcgsNumber",
  "pcgsVerified",
  // Catalog & collection
  "numistaId",
  "collectable",
  "ignorePatternImages",
  "currency",
  // Images (STAK-493: these were missing, causing silent data loss during sync)
  "obverseImageUrl",
  "reverseImageUrl",
  "obverseImageFrame",
  "reverseImageFrame",
  "obverseSharedImageId",
  "reverseSharedImageId",
  "tradedFromUuid",
  // Disposition
  "disposition",
  // Metadata
  "lastModified",
  // Bulk-editor fields (STRK-91 C.3 — capsule/notes, payment, nested objects)
  "capsule",
  "capsuleNotes",
  "paymentMethod",
  "numistaData",
  "fieldMeta",
  // Attachments — array field; compareItems emits ONE coarse record per item so
  // detectConflicts (which keys on itemKey|field) sees at most one entry per item.
  // Per-entry diffing is handled by _diffAttachments / renderAttachmentDiffRow.
  "attachments",
];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * STRK-158: Fields whose values are date-time INSTANTS and must compare by epoch,
 * not by raw string. lastModified is stored in two ISO serializations of the same
 * instant (compact "20260603T061930904Z" vs extended "2026-06-03T06:19:30.904Z"),
 * so a raw === reports a phantom conflict the user can never clear.
 */
const INSTANT_FIELDS = new Set(["lastModified"]);

/**
 * STRK-158: Parse an ISO instant to epoch milliseconds, accepting both the compact
 * form (YYYYMMDDTHHmmssSSSZ, with optional millis) actually stored by some writers
 * and the extended form Date.parse handles natively. Returns null when the value
 * is not a parseable instant (so callers fall back to raw comparison).
 * @param {*} val
 * @returns {number|null}
 */
function _parseInstant(val) {
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val !== "string") return null;
  let s = val.trim();
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z?$/.exec(s);
  if (compact) {
    s =
      `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}` +
      (compact[7] ? `.${compact[7]}` : "") +
      "Z";
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/**
 * Returns true when two values are considered equal for diff purposes.
 * Uses strict equality after normalising undefined, null, and empty strings
 * to null so that a missing field, an explicit null, and an empty string
 * are all treated identically. For INSTANT_FIELDS (e.g. lastModified) it compares
 * by epoch ms so two serializations of the same instant are equal (STRK-158).
 *
 * @param {*} a
 * @param {*} b
 * @param {string} [field] - the field name being compared (enables instant-aware compare)
 * @returns {boolean}
 */
function _valuesEqual(a, b, field) {
  const norm = (v) => (v === undefined || v === "" ? null : v);
  a = norm(a);
  b = norm(b);
  if (a === b) return true;
  if (a === null || b === null) return false;
  // STRK-158: instant-aware compare for date-time fields. Same instant, different
  // ISO serialization (compact vs extended) must not be a phantom conflict.
  if (field && INSTANT_FIELDS.has(field) && typeof a !== "object" && typeof b !== "object") {
    const ta = _parseInstant(a);
    const tb = _parseInstant(b);
    if (ta !== null && tb !== null) return ta === tb;
  }
  // Deep compare for objects (e.g. disposition) — recursive stable stringify
  if (typeof a === "object" && typeof b === "object") {
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
  if (val === null || val === undefined) return "null";
  if (typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) return "[" + val.map(_stableStringify).join(",") + "]";
  var keys = Object.keys(val).sort();
  return (
    "{" +
    keys
      .map(function (k) {
        return JSON.stringify(k) + ":" + _stableStringify(val[k]);
      })
      .join(",") +
    "}"
  );
}

/**
 * Top-level fields dropped before settings equality checks, per settings key.
 * These are per-device bookkeeping stored in the same synced blob as real
 * settings — a tick on one device must not read as a user-visible change.
 * STRK-313: catalog_api_config counters. STRK-315: metalApiConfig usageMonth
 * (the period stamp that zeroes the spot counters on month rollover).
 */
const VOLATILE_SETTING_FIELDS = {
  catalog_api_config: ["numistaUsage", "pcgsUsage"],
  metalApiConfig: ["usageMonth"],
};

/**
 * STRK-315: Drop the volatile `used` counter from each provider entry of a
 * metalApiConfig `usage` map while KEEPING `quota`, which is a real
 * user-editable setting (Settings › API quota modal). Unlike the catalog
 * counters — whole objects STRK-313 could drop outright — usage[p] mixes
 * volatile and durable fields, so the strip has to be nested.
 * @param {*} usage the `usage` map, or any non-object value
 * @returns {*} copy with per-provider `used` removed (input untouched)
 */
function _stripSpotUsedCounters(usage) {
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) return usage;
  const out = {};
  for (const prov of Object.keys(usage)) {
    const entry = usage[prov];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      out[prov] = entry;
      continue;
    }
    const kept = {};
    for (const field of Object.keys(entry)) {
      if (field === "used") continue;
      kept[field] = entry[field];
    }
    out[prov] = kept;
  }
  return out;
}

/**
 * STRK-313/STRK-315: Key-aware normalization applied before settings equality
 * checks. Both catalog_api_config and metalApiConfig carry volatile per-device
 * usage counters alongside the credentials — strip them so a counter tick on
 * one device doesn't flag the whole setting as changed in sync/restore
 * previews. Accepts both raw localStorage strings (cloud-sync pull path) and
 * parsed objects (vault restore path); an unparseable string is returned
 * untouched so behavior degrades to the previous raw comparison.
 * duplication-ok: diff-engine is dependency-free by design — the cloud-sync
 * twin of this volatile-field strip cannot be shared from here.
 * @param {string} key settings key
 * @param {*} val raw string or parsed value
 * @returns {*} normalized value for comparison only
 */
function _normalizeSettingForCompare(key, val) {
  const drop = VOLATILE_SETTING_FIELDS[key];
  if (!drop || val === null || val === undefined) return val;
  let parsed = val;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (_e) {
      return val;
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return val;
  const out = {};
  for (const field of Object.keys(parsed)) {
    if (drop.includes(field)) continue;
    out[field] = parsed[field];
  }
  // Nested strip: only metalApiConfig has volatile fields below the top level.
  if (key === "metalApiConfig" && "usage" in parsed) {
    out.usage = _stripSpotUsedCounters(parsed.usage);
  }
  return out;
}

/**
 * Settings-specific deep equality that handles type mismatches common in
 * localStorage (string "true" vs boolean true, string "3" vs number 3)
 * and parsed vs unparsed JSON objects.
 */
function _settingsValuesEqual(a, b) {
  const norm = (v) => (v === undefined ? null : v);
  a = norm(a);
  b = norm(b);
  if (a === b) return true;
  if (a === null || b === null) return false;
  // Deep compare for objects/arrays — recursive sorted-key stringify for
  // key-order independence at every depth. Arrays are order-sensitive (e.g.
  // headerBtnOrder), so element order is preserved.
  // STRK-313: the previous JSON.stringify(v, Object.keys(v).sort()) form used
  // the top-level key list as a replacer WHITELIST, which silently dropped any
  // nested key not also present at the top level — nested-only differences
  // (e.g. catalog_api_config numista.apiKey) compared as equal.
  if (typeof a === "object" && typeof b === "object") {
    return _stableStringify(a) === _stableStringify(b);
  }
  // Type coercion for primitive mismatches only: "true"/true, "3"/3
  if (typeof a !== typeof b) {
    const aType = typeof a;
    const bType = typeof b;
    if (
      (aType === "string" || aType === "number" || aType === "boolean") &&
      (bType === "string" || bType === "number" || bType === "boolean")
    ) {
      return String(a) === String(b);
    }
    return false;
  }
  return false;
}

/**
 * Computes per-entry diffs between two attachments arrays.
 * Detects replacements (same fileName, different UUID), pure removals,
 * and pure additions. Returns a flat array of change records.
 *
 * @param {object[]} localArr
 * @param {object[]} remoteArr
 * @returns {Array<{action:"add"|"remove"|"replace", attachmentUuid:string, oldAttachmentUuid?:string, localVal:object|null, remoteVal:object|null}>}
 */
function _diffAttachments(localArr, remoteArr) {
  const local = Array.isArray(localArr) ? localArr : [];
  const remote = Array.isArray(remoteArr) ? remoteArr : [];
  const result = [];

  // Build lookup maps by UUID
  const localMap = new Map(local.filter((a) => a.attachmentUuid).map((a) => [a.attachmentUuid, a]));
  const remoteMap = new Map(
    remote.filter((a) => a.attachmentUuid).map((a) => [a.attachmentUuid, a])
  );

  // Build local index by fileName for replacement detection
  const localByFileName = new Map();
  for (const a of local) {
    if (!a.attachmentUuid || !a.fileName) continue;
    if (!localByFileName.has(a.fileName)) localByFileName.set(a.fileName, []);
    localByFileName.get(a.fileName).push(a);
  }

  const consumedLocal = new Set();
  const consumedRemote = new Set();

  // Pass 1: replacements — same fileName, different UUID, unambiguous match (STRK-65)
  const remoteByFileName = new Map();
  for (const a of remote) {
    if (!a.attachmentUuid || !a.fileName) continue;
    if (!remoteByFileName.has(a.fileName)) remoteByFileName.set(a.fileName, []);
    remoteByFileName.get(a.fileName).push(a);
  }
  for (const rem of remote) {
    if (!rem.attachmentUuid || consumedRemote.has(rem.attachmentUuid)) continue;
    if (localMap.has(rem.attachmentUuid)) continue;
    const localCandidates = (localByFileName.get(rem.fileName) || []).filter(
      (c) => !consumedLocal.has(c.attachmentUuid) && c.attachmentUuid !== rem.attachmentUuid
    );
    const remoteSameName = (remoteByFileName.get(rem.fileName) || []).filter(
      (c) => !consumedRemote.has(c.attachmentUuid)
    );
    if (localCandidates.length === 1 && remoteSameName.length === 1) {
      const loc = localCandidates[0];
      result.push({
        action: "replace",
        attachmentUuid: rem.attachmentUuid,
        oldAttachmentUuid: loc.attachmentUuid,
        localVal: loc,
        remoteVal: rem,
      });
      consumedLocal.add(loc.attachmentUuid);
      consumedRemote.add(rem.attachmentUuid);
    }
  }

  // Pass 2: removals — in local, not in remote, not consumed
  for (const loc of local) {
    if (!loc.attachmentUuid || consumedLocal.has(loc.attachmentUuid)) continue;
    if (!remoteMap.has(loc.attachmentUuid)) {
      result.push({
        action: "remove",
        attachmentUuid: loc.attachmentUuid,
        localVal: loc,
        remoteVal: null,
      });
    }
  }

  // Pass 3: additions — in remote, not in local, not consumed
  for (const rem of remote) {
    if (!rem.attachmentUuid || consumedRemote.has(rem.attachmentUuid)) continue;
    if (!localMap.has(rem.attachmentUuid)) {
      result.push({
        action: "add",
        attachmentUuid: rem.attachmentUuid,
        localVal: null,
        remoteVal: rem,
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const DiffEngine = {
  // -------------------------------------------------------------------------
  // _instanceKey
  // -------------------------------------------------------------------------

  /**
   * Instance-aware catalog key (STRK-167): `numistaId|year|grade|certNumber`.
   * A numistaId identifies a catalog TYPE; grade + certNumber distinguish the
   * physical INSTANCE, and year keeps distinct issue years separate. numistaId is
   * trimmed (sanitizeObjectFields preserves surrounding spaces, so `" 12345 "` and
   * `"12345"` must key the same); grade/cert are trimmed + lowercased; missing
   * segments collapse to "". Shared by computeItemKey (tertiary tier) and
   * enrichItemIdentities so the three historical key copies can never drift again.
   *
   * @param {object} item
   * @returns {string}
   */
  _instanceKey(item) {
    const norm = (v) =>
      String(v == null ? "" : v)
        .trim()
        .toLowerCase();
    const nid = String(item.numistaId == null ? "" : item.numistaId).trim();
    const year = String(item.year == null ? "" : item.year).trim();
    return `${nid}|${year}|${norm(item.grade)}|${norm(item.certNumber)}`;
  },

  // -------------------------------------------------------------------------
  // computeItemKey
  // -------------------------------------------------------------------------

  /**
   * Derives a stable string key for an item.
   *   – Primary:  item.uuid   (stable across export/import — STAK-380)
   *   – Secondary: item.serial (numeric, legacy items without uuid)
   *   – Tertiary: instance key `numistaId|year|grade|certNumber` (STRK-167)
   *   – Last resort: `name|date` for items without any identifier
   *
   * STAK-187 changeLog.js extension MUST use this same function so that keys
   * remain consistent across modules.
   *
   * @param {object} item
   * @returns {string}
   */
  computeItemKey(item) {
    if (item == null) return "";

    // Primary: UUID (stable across export/import)
    if (item.uuid) return String(item.uuid);

    // Secondary: numeric serial assigned by loadInventory()
    if (item.serial != null && item.serial !== "") {
      return String(item.serial);
    }

    // Tertiary: instance-aware numistaId key (STRK-167)
    if (item.numistaId) {
      return DiffEngine._instanceKey(item);
    }

    // Last resort: name + date
    return `${item.name || ""}|${item.date || ""}`;
  },

  // -------------------------------------------------------------------------
  // collapseByInstanceKey
  // -------------------------------------------------------------------------

  /**
   * Collapses rows that share an instance key (STRK-167 AC-6), summing qty.
   * Used by the Numista importer to merge the repeated N# rows the export emits
   * for identical ungraded copies BEFORE identity stamping. Distinct years or
   * grades produce distinct keys and stay separate. The returned array is always
   * new and the input rows are never mutated: numistaId rows are shallow-cloned
   * before their qty is summed, while rows without a numistaId pass through by
   * reference (no instance key to group on).
   *
   * @param {object[]} rows
   * @returns {object[]}
   */
  collapseByInstanceKey(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const byKey = new Map();
    const out = [];
    for (const row of list) {
      if (!row || !row.numistaId) {
        out.push(row);
        continue;
      }
      const key = DiffEngine._instanceKey(row);
      const existing = byKey.get(key);
      if (existing) {
        const a = Number(existing.qty) || 0;
        const b = Number(row.qty) || 0;
        existing.qty = a + b;
      } else {
        const clone = { ...row };
        byKey.set(key, clone);
        out.push(clone);
      }
    }
    return out;
  },

  // -------------------------------------------------------------------------
  // enrichItemIdentities
  // -------------------------------------------------------------------------

  /**
   * Copies local UUIDs onto incoming items that lack one, matching by serial
   * (primary), numistaId+date (secondary), or name+date (tertiary). Mirrors
   * the tier priority of computeItemKey(). Bridges the identity gap when vault
   * backups or CSV exports lack the UUID assigned by loadInventory().
   *
   * @param {object[]} localItems  — items with UUIDs (from in-memory inventory)
   * @param {object[]} incomingItems — items potentially missing UUIDs (from backup/import)
   * @returns {number} count of items enriched
   */
  enrichItemIdentities(localItems, incomingItems) {
    const local = Array.isArray(localItems) ? localItems : [];
    const incoming = Array.isArray(incomingItems) ? incomingItems : [];

    const uuidBySerial = new Map();
    // STRK-167 (D-7): numista lookup is a FIFO BUCKET per instance key — multiple
    // local items can share a key (e.g. two ungraded copies), and a last-write-wins
    // Map would silently drop all but one UUID. Each incoming match shifts one UUID.
    const uuidsByInstance = new Map();
    const uuidByNameDate = new Map();

    for (let i = 0; i < local.length; i++) {
      const item = local[i];
      if (!item || !item.uuid) continue;
      if (item.serial != null && item.serial !== "") {
        uuidBySerial.set(String(item.serial), item.uuid);
      }
      if (item.numistaId) {
        const ik = DiffEngine._instanceKey(item);
        const bucket = uuidsByInstance.get(ik);
        if (bucket) bucket.push(item.uuid);
        else uuidsByInstance.set(ik, [item.uuid]);
      }
      const nameKey = (item.name || "") + "|" + (item.date || "");
      if (!uuidByNameDate.has(nameKey)) {
        uuidByNameDate.set(nameKey, item.uuid);
      }
    }

    let enriched = 0;
    const usedUUIDs = new Set();
    for (let j = 0; j < incoming.length; j++) {
      const inc = incoming[j];
      if (inc.uuid) continue;

      if (inc.serial != null && inc.serial !== "") {
        const bySerial = uuidBySerial.get(String(inc.serial));
        if (bySerial && !usedUUIDs.has(bySerial)) {
          inc.uuid = bySerial;
          usedUUIDs.add(bySerial);
          enriched++;
          continue;
        }
      }

      // STRK-167 (D-7): numista-bearing rows match ONLY on the instance key, by
      // consuming a UUID from the FIFO bucket. They must NOT fall through to the
      // name|date tier — a graded local UUID reattached to an ungraded incoming
      // row would turn an advisory add into a destructive modified match.
      if (inc.numistaId) {
        const bucket = uuidsByInstance.get(DiffEngine._instanceKey(inc));
        while (bucket && bucket.length) {
          const candidate = bucket.shift();
          if (!usedUUIDs.has(candidate)) {
            inc.uuid = candidate;
            usedUUIDs.add(candidate);
            enriched++;
            break;
          }
        }
        continue;
      }

      const byNameDate = uuidByNameDate.get((inc.name || "") + "|" + (inc.date || ""));
      if (byNameDate && !usedUUIDs.has(byNameDate)) {
        inc.uuid = byNameDate;
        usedUUIDs.add(byNameDate);
        enriched++;
      }
    }

    return enriched;
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
        if (field === "attachments") {
          // STRK-158: reconcile the count pill with the rendered per-entry rows.
          // _valuesEqual on the raw arrays is order-sensitive (_stableStringify),
          // so a pure reorder of the same UUIDs falsely counted as "1 field changed"
          // while _diffAttachments (UUID/fileName-keyed, order-independent) rendered
          // zero rows. Use _diffAttachments as the source of truth: no per-entry
          // diff -> not a changed field.
          const attDiff = _diffAttachments(local.attachments, remote.attachments);
          if (attDiff.length > 0) {
            changes.push({
              field,
              localVal: local.attachments !== undefined ? local.attachments : null,
              remoteVal: remote.attachments !== undefined ? remote.attachments : null,
            });
          }
          continue;
        }
        if (!_valuesEqual(local[field], remote[field], field)) {
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
    const local = localSettings != null && typeof localSettings === "object" ? localSettings : {};
    const remote =
      remoteSettings != null && typeof remoteSettings === "object" ? remoteSettings : {};

    const allKeys = new Set([...Object.keys(local), ...Object.keys(remote)]);
    const changed = [];
    const unchanged = [];

    for (const key of allKeys) {
      const localVal = local[key] !== undefined ? local[key] : null;
      const remoteVal = remote[key] !== undefined ? remote[key] : null;

      // STRK-313: equality is checked on key-aware normalized values (volatile
      // usage counters stripped) — the changed/unchanged entries still carry
      // the ORIGINAL values so apply paths write the full blob.
      if (
        !_settingsValuesEqual(
          _normalizeSettingForCompare(key, localVal),
          _normalizeSettingForCompare(key, remoteVal)
        )
      ) {
        changed.push({ key, localVal, remoteVal });
      } else {
        // STRK-315: unchanged entries carry localVal/remoteVal in the SAME
        // shape as changed entries. The renderer reads mEntry.localVal for
        // both lists, so the old {key, val} shape made every matched row
        // render as undefined — "not set" for masked keys, "—" for the rest.
        // `val` is retained for back-compat with any older caller.
        unchanged.push({ key, val: localVal, localVal, remoteVal });
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
        // Only a conflict if the resolved values differ (STRK-158: instant-aware
        // for lastModified so an ISO-serialization variant isn't a phantom conflict)
        if (!_valuesEqual(localChange.remoteVal, remoteChange.remoteVal, localChange.field)) {
          conflicts.push({
            itemKey: localChange.itemKey,
            field: localChange.field,
            localVal: localChange.remoteVal, // local's view of the new value
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
   *   { type: 'add',          item: object }         — append item
   *   { type: 'delete',       itemKey: string }       — remove item by key
   *   { type: 'modify',       itemKey: string, field: string, value: * } — patch field
   *   { type: 'attach-entry', itemKey: string, action: 'add'|'remove'|'replace',
   *     attachmentUuid: string, oldAttachmentUuid?: string, value: object|null } — per-attachment patch
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
    const toAttachEntry = []; // [{itemKey, action, attachmentUuid, oldAttachmentUuid, value}]

    for (const change of selectedChanges) {
      switch (change.type) {
        case "add":
          if (change.item != null) toAdd.push(change.item);
          break;
        case "delete":
          if (change.itemKey != null) toDelete.add(String(change.itemKey));
          break;
        case "modify":
          if (change.itemKey != null && change.field != null) {
            toModify.push(change);
          }
          break;
        case "attach-entry":
          if (change.itemKey != null && change.attachmentUuid != null) {
            toAttachEntry.push(change);
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
        const attachPatches = toAttachEntry.filter((c) => String(c.itemKey) === key);
        if (patches.length === 0 && attachPatches.length === 0) return item;

        // Clone item and apply scalar patches
        const updated = Object.assign({}, item);
        for (const patch of patches) {
          updated[patch.field] = patch.value;
        }

        // Apply per-attachment patches
        if (attachPatches.length > 0) {
          let atts = Array.isArray(updated.attachments) ? updated.attachments.slice() : [];
          for (const ap of attachPatches) {
            if (ap.action === "add") {
              if (!atts.some((a) => a.attachmentUuid === ap.attachmentUuid)) {
                atts.push(ap.value);
              }
            } else if (ap.action === "remove") {
              atts = atts.filter((a) => a.attachmentUuid !== ap.attachmentUuid);
            } else if (ap.action === "replace") {
              const idx = atts.findIndex((a) => a.attachmentUuid === ap.oldAttachmentUuid);
              if (idx !== -1) {
                atts.splice(idx, 1, ap.value);
              } else if (!atts.some((a) => a.attachmentUuid === ap.attachmentUuid)) {
                atts.push(ap.value);
              }
            }
          }
          updated.attachments = atts;
        }

        return updated;
      });

    // Append additions
    for (const newItem of toAdd) {
      result.push(newItem);
    }

    return result;
  },

  // -------------------------------------------------------------------------
  // diffAttachments
  // -------------------------------------------------------------------------

  diffAttachments: _diffAttachments,
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

window.DiffEngine = DiffEngine;
