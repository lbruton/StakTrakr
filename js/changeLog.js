/**
 * Change log tracking and rendering
 * Tracks all cell changes in the inventory table
 */

/**
 * Optional fields added by STRK-44 partial-stack disposition.
 * Existing entries without these fields continue to work unchanged.
 *
 * @typedef {Object} ChangeLogTransactionFields
 * @property {string} [transactionId]    - ISO timestamp shared by paired split+dispose entries
 * @property {string} [transactionLabel] - Human-readable label for grouped display
 * @property {Object} [stackSplit]       - Reverse payload for the stack-split entry
 * @property {Object} [splitDisposed]    - Reverse payload for the disposed-clone entry
 * @property {string} [itemKey]          - Stable item key (uuid or fallback) for UUID-drift recovery
 */

/**
 * Computes a stable composite key for an inventory item.
 *
 * STRK-167: delegates to DiffEngine.computeItemKey (the single authoritative key)
 * at CALL TIME — changeLog.js loads before diff-engine.js, so a load-time reference
 * would be undefined, but every caller fires post-load. The inline fallback mirrors
 * the current ladder (uuid → serial → instance key → name|date) only for the rare
 * case DiffEngine is absent (e.g. an isolated unit harness). Keeping the key in one
 * place is what closes the three-copy drift that caused STRK-167.
 * @param {Object} item - Inventory item object
 * @returns {string} Stable item key
 */
const _fallbackItemKey = (item) => {
  // duplication-ok: intentional safety net that mirrors DiffEngine's authoritative
  // ladder ONLY when window.DiffEngine is absent (e.g. an isolated unit harness).
  // computeItemKey delegates to DiffEngine at runtime; this never fires in the app.
  if (!item) return "";
  if (item.uuid) return String(item.uuid);
  if (item.serial != null && item.serial !== "") return String(item.serial);
  if (item.numistaId) {
    const norm = (v) =>
      String(v == null ? "" : v)
        .trim()
        .toLowerCase();
    const nid = String(item.numistaId == null ? "" : item.numistaId).trim();
    const year = String(item.year == null ? "" : item.year).trim();
    return `${nid}|${year}|${norm(item.grade)}|${norm(item.certNumber)}`;
  }
  return `${item.name || ""}|${item.date || ""}`;
};

const computeItemKey = (item) => {
  if (typeof window !== "undefined" && window.DiffEngine && window.DiffEngine.computeItemKey) {
    return window.DiffEngine.computeItemKey(item);
  }
  return _fallbackItemKey(item);
};

/**
 * Records a change to the change log and persists it
 * @param {string} itemName - Name of the inventory item
 * @param {string} field - Field that was changed
 * @param {any} oldValue - Previous value
 * @param {any} newValue - New value
 * @param {number} idx - Index of item in inventory array
 */
const logChange = (itemName, field, oldValue, newValue, idx) => {
  changeLog.push({
    timestamp: Date.now(),
    itemName,
    field,
    oldValue,
    newValue,
    idx,
    undone: false,
  });
  saveDataSync("changeLog", changeLog);
};

const tryPersistChangeLog = () => {
  try {
    saveDataSync("changeLog", changeLog, { quietQuotaToast: true });
    return true;
  } catch (e) {
    console.error("tryPersistChangeLog failed", e);
    return false;
  }
};

const pushTransactionEntries = (splitEntry, disposedEntry) => {
  changeLog.push(splitEntry);
  changeLog.push(disposedEntry);
};
window.pushTransactionEntries = pushTransactionEntries;

function neutralizeSupersededChangelog(selectedChanges, cutoffTimestamp) {
  if (!Array.isArray(selectedChanges) || selectedChanges.length === 0) return 0;
  const acceptedKeys = new Set();
  selectedChanges.forEach((change) => {
    if (!change) return;
    if (change.itemKey) {
      acceptedKeys.add(String(change.itemKey));
      return;
    }
    if (change.item) {
      const itemKey = computeItemKey(change.item);
      if (itemKey) acceptedKeys.add(String(itemKey));
    }
  });
  if (acceptedKeys.size === 0) return 0;

  const cutoff = Number.isFinite(Number(cutoffTimestamp)) ? Number(cutoffTimestamp) : Date.now();
  let neutralizedCount = 0;
  changeLog.forEach((entry) => {
    if (!entry?.itemKey) return;
    if (!acceptedKeys.has(String(entry.itemKey))) return;
    if (Number(entry.timestamp) > cutoff) return;
    if (entry.neutralized) return;
    entry.neutralized = true;
    neutralizedCount++;
  });

  if (neutralizedCount > 0) {
    try {
      saveDataSync("changeLog", changeLog);
    } catch (e) {
      console.warn("[ChangeLog] Failed to persist neutralized sync entries", e);
    }
  }
  return neutralizedCount;
}
window.neutralizeSupersededChangelog = neutralizeSupersededChangelog;

/**
 * Compares two item objects and logs any differences.
 * Adds scope, itemKey, and type fields to each entry (additive — existing entries
 * without these fields continue to render correctly in the UI).
 * Signature is unchanged: (oldItem, newItem).
 * @param {Object|null} oldItem - Original item values (null for additions)
 * @param {Object|null} newItem - Updated item values (null for deletions)
 */
const logItemChanges = (oldItem, newItem) => {
  // Must match DIFF_FIELDS in diff-engine.js — if a field is compared during
  // sync, it must also be tracked here so manifests capture the change (STAK-493).
  const fields = [
    "name",
    "metal",
    "composition",
    "weight",
    "weightUnit",
    "purity",
    "qty",
    "type",
    "date",
    "year",
    "price",
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
  ];

  // Deep-equality check for object-typed fields. Snapshot wrappers (STRK-91 C.2)
  // deep-copy nested objects, so `!==` would log unchanged nested objects as
  // changed because the references differ.
  //
  // Key-sorted serialization prevents false positives when object property
  // insertion order differs between the old and new snapshots (STRK-91 C.3).
  const _stableStringify = (v) => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(_stableStringify).join(",") + "]";
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + _stableStringify(v[k]))
        .join(",") +
      "}"
    );
  };
  const OBJECT_FIELDS = new Set(["numistaData", "fieldMeta", "disposition"]);
  const fieldChanged = (field, a, b) => {
    if (OBJECT_FIELDS.has(field)) {
      return _stableStringify(a) !== _stableStringify(b);
    }
    return a !== b;
  };

  const refItem = newItem || oldItem;
  const itemKey = computeItemKey(refItem);
  const scope = "inventory";
  const type = oldItem === null ? "item-add" : newItem === null ? "item-delete" : "item-edit";

  // For add/delete, only one side exists — skip per-field diff and record a single entry
  if (type === "item-add" || type === "item-delete") {
    const item = refItem;
    const idx = inventory.indexOf(item);
    changeLog.push({
      timestamp: Date.now(),
      itemName: item.name || "",
      field: type === "item-add" ? "Added" : "Deleted",
      oldValue: type === "item-delete" ? JSON.stringify(item) : null,
      newValue: type === "item-add" ? JSON.stringify(item) : null,
      idx,
      undone: false,
      scope,
      itemKey,
      type,
    });
    saveDataSync("changeLog", changeLog);
    return;
  }

  fields.forEach((field) => {
    if (fieldChanged(field, oldItem[field], newItem[field])) {
      const idx = inventory.indexOf(newItem);
      changeLog.push({
        timestamp: Date.now(),
        itemName: newItem.name,
        field,
        oldValue: oldItem[field],
        newValue: newItem[field],
        idx,
        undone: false,
        scope,
        itemKey,
        type,
      });
    }
  });
  saveDataSync("changeLog", changeLog);
};

/**
 * Renders the change log table with all entries
 */
const renderChangeLog = () => {
  const reversedLog = [...changeLog].reverse();

  // Map each entry object to its index in the original changeLog array
  const entryGlobalIndex = new Map();
  reversedLog.forEach((entry, i) => {
    entryGlobalIndex.set(entry, changeLog.length - 1 - i);
  });

  // Group paired transaction entries by transactionId (STRK-44 partial-stack disposition).
  // A group has exactly two entries sharing the same transactionId.
  const txFirstSeen = new Map(); // transactionId -> first entry in reversed order
  const txGroups = new Map(); // transactionId -> [entry, entry]
  reversedLog.forEach((entry) => {
    if (!entry.transactionId) return;
    if (!txGroups.has(entry.transactionId)) {
      txGroups.set(entry.transactionId, []);
      txFirstSeen.set(entry.transactionId, entry);
    }
    txGroups.get(entry.transactionId).push(entry);
  });

  // Renders a single entry as a plain (non-grouped) <tr> string.
  // Used for the settings panel compact view and all legacy/standard entries in the modal.
  const renderFlatRow = (entry, globalIndex) => {
    const actionLabel = entry.undone ? "Redo" : "Undo";
    const actionCell = entry.neutralized
      ? '<span class="synced-badge" title="Resolved by sync">Synced</span>'
      : `<button class="btn action-btn" style="margin:1px;" onclick="event.stopPropagation(); toggleChange(${globalIndex})">${actionLabel}</button>`;

    // --- STRK-44: "Restored (merged)" single-row rendering ---
    if (entry.field === "Restored (merged)") {
      const ts = formatTimestamp(entry.timestamp);
      const itemNameSafe = sanitizeHtml(entry.itemName);
      let mergeSummary = "";
      try {
        const oldVal =
          typeof entry.oldValue === "object" ? entry.oldValue : JSON.parse(entry.oldValue);
        const newVal =
          typeof entry.newValue === "object" ? entry.newValue : JSON.parse(entry.newValue);
        mergeSummary = sanitizeHtml(`${oldVal.qty} units merged \u2192 ${newVal.mergedQty} total`);
      } catch {
        mergeSummary = sanitizeHtml(String(entry.newValue ?? ""));
      }
      return `
      <tr>
        <td title="${ts}">${ts}</td>
        <td title="${itemNameSafe}">${itemNameSafe}</td>
        <td title="Restored &amp; merged">Restored &amp; merged</td>
        <td title="${mergeSummary}">${mergeSummary}</td>
        <td></td>
        <td class="action-cell"><button class="btn action-btn" style="margin:1px;" disabled title="Undo via the paired &quot;Undo Both&quot; button">N/A</button></td>
      </tr>`;
    }

    // Attachment add/remove/replace — no undo/redo via the change log UI
    if (entry.type === "attachment-change") {
      const ts = formatTimestamp(entry.timestamp);
      const itemNameSafe = sanitizeHtml(entry.itemName);
      const displayField = sanitizeHtml(entry.field);
      const displayOld = entry.oldValue != null ? sanitizeHtml(String(entry.oldValue)) : "";
      const displayNew = entry.newValue != null ? sanitizeHtml(String(entry.newValue)) : "";
      return `
      <tr>
        <td title="${ts}">${ts}</td>
        <td title="${itemNameSafe}">${itemNameSafe}</td>
        <td title="${displayField}">${displayField}</td>
        <td title="${displayOld}">${displayOld}</td>
        <td title="${displayNew}">${displayNew}</td>
        <td class="action-cell"><button class="btn action-btn" style="margin:1px;" disabled title="Attachment changes cannot be undone">N/A</button></td>
      </tr>`;
    }

    // Friendly display for price history deletions (STAK-109)
    let displayField = sanitizeHtml(entry.field);
    let displayOld = sanitizeHtml(String(entry.oldValue));
    let displayNew = sanitizeHtml(String(entry.newValue));

    // Format raw JSON snapshots into human-readable summaries (UX-001)
    if ((entry.field === "Deleted" || entry.field === "Added") && entry.oldValue) {
      try {
        const snap =
          typeof entry.oldValue === "string" ? JSON.parse(entry.oldValue) : entry.oldValue;
        if (snap && typeof snap === "object" && snap.name) {
          const fmtFn =
            typeof formatCurrency === "function"
              ? formatCurrency
              : (v) => "$" + Number(v).toFixed(2);
          const parts = [snap.metal, snap.type, snap.name];
          if (snap.weight)
            parts.push(
              typeof formatWeight === "function"
                ? formatWeight(snap.weight, snap.weightUnit)
                : snap.weight + " oz"
            );
          if (snap.price) parts.push(fmtFn(snap.price));
          displayOld = sanitizeHtml(parts.filter(Boolean).join(" \u00B7 "));
        }
      } catch {
        /* keep original */
      }
    }
    let rowClick = `onclick="editFromChangeLog(${entry.idx}, ${globalIndex})"`;
    if (entry.field === "priceHistoryDelete") {
      displayField = "Price Entry Deleted";
      try {
        const d = JSON.parse(entry.oldValue);
        const fmtFn =
          typeof formatCurrency === "function" ? formatCurrency : (v) => "$" + Number(v).toFixed(2);
        displayOld = `Retail: ${sanitizeHtml(fmtFn(d.entry.retail))}`;
      } catch {
        displayOld = "(price entry)";
      }
      displayNew = entry.undone ? "Restored" : "Deleted";
      rowClick = ""; // No item to navigate to
    }

    return `
      <tr ${rowClick}>
        <td title="${formatTimestamp(entry.timestamp)}">${formatTimestamp(entry.timestamp)}</td>
        <td title="${sanitizeHtml(entry.itemName)}">${sanitizeHtml(entry.itemName)}</td>
        <td title="${displayField}">${displayField}</td>
        <td title="${displayOld}">${displayOld}</td>
        <td title="${displayNew}">${displayNew}</td>
        <td class="action-cell">${actionCell}</td>
      </tr>`;
  };

  // Modal table: grouped rendering for paired transaction entries (STRK-44).
  // The settings panel table receives plain (ungrouped) rows so that the
  // [role='group'] element appears exactly once in the DOM per transaction.
  const modalRows = reversedLog.map((entry) => {
    const globalIndex = entryGlobalIndex.get(entry);

    // --- STRK-44: grouped-row rendering for paired transaction entries ---
    if (entry.transactionId && txGroups.get(entry.transactionId)?.length === 2) {
      const isFirst = txFirstSeen.get(entry.transactionId) === entry;
      if (!isFirst) {
        // Second entry in the pair \u2014 already rendered inside the first's group block
        return "";
      }

      const group = txGroups.get(entry.transactionId);
      // The "Undo Both" button MUST target the Disposed entry's globalIndex because
      // toggleChange only routes to confirmCascadeUndo via the field === "Disposed" branch.
      // Targeting the Stack split entry falls through to the default branch and corrupts the item.
      const disposedEntry = group.find((e) => e.field === "Disposed") || group[1];
      const disposedGlobalIndex = entryGlobalIndex.get(disposedEntry);
      const label = sanitizeHtml(entry.transactionLabel || entry.field);
      const ts = formatTimestamp(entry.timestamp);
      const itemNameSafe = sanitizeHtml(entry.itemName);
      const allUndone = group.every((e) => e.undone);

      const undoBtn = allUndone
        ? `<span class="text-muted">Undone</span>`
        : `<button class="btn action-btn" style="margin:1px;" onclick="event.stopPropagation(); toggleChange(${disposedGlobalIndex})" title="Undo both">Undo Both</button>`;

      const subRows = group
        .map((sub) => {
          let subField = sanitizeHtml(sub.field);
          let subOld = sanitizeHtml(String(sub.oldValue ?? ""));
          let subNew = sanitizeHtml(String(sub.newValue ?? ""));
          if (sub.field === "Disposed" && sub.newValue) {
            try {
              const snap =
                typeof sub.newValue === "string" ? JSON.parse(sub.newValue) : sub.newValue;
              if (snap && snap.type) subNew = sanitizeHtml(snap.type);
            } catch {
              /* keep raw */
            }
          }
          return `<tr class="changelog-tx-sub-row">
            <td>${sanitizeHtml(formatTimestamp(sub.timestamp))}</td>
            <td>${sanitizeHtml(sub.itemName)}</td>
            <td>${subField}</td>
            <td>${subOld}</td>
            <td>${subNew}</td>
          </tr>`;
        })
        .join("");

      return `
      <tr class="changelog-tx-group-header" role="group" aria-label="Partial-stack disposition transaction" aria-expanded="false" onclick="(function(hdr){ hdr.classList.toggle('expanded'); var sub = hdr.nextElementSibling; if(sub) sub.style.display = hdr.classList.contains('expanded') ? '' : 'none'; hdr.setAttribute('aria-expanded', hdr.classList.contains('expanded')); })(this)">
        <td title="${ts}">${ts}</td>
        <td title="${itemNameSafe}">${itemNameSafe}</td>
        <td colspan="3" class="changelog-tx-label" title="${label}">
          <span class="changelog-tx-caret">\u25B6</span>
          <span class="changelog-tx-summary">${label}</span>
        </td>
        <td class="action-cell">${undoBtn}</td>
      </tr>
      <tr class="changelog-tx-subrows" style="display:none">
        <td colspan="6" style="padding:0">
          <table class="changelog-tx-subtable w-100">
            <tbody>${subRows}</tbody>
          </table>
        </td>
      </tr>`;
    }

    return renderFlatRow(entry, globalIndex);
  });

  // Settings panel: plain rows only (no grouping UI, no [role=group] elements)
  const settingsRows = reversedLog.map((entry) =>
    renderFlatRow(entry, entryGlobalIndex.get(entry))
  );

  const modalHtml = modalRows.join("");
  const settingsHtml = settingsRows.join("");

  // Populate the modal table (grouped view) and settings panel table (flat view)
  const modalBody = document.querySelector("#changeLogTable tbody");
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  if (modalBody) modalBody.innerHTML = modalHtml;
  const settingsBody = document.querySelector("#settingsChangeLogTable tbody");
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  if (settingsBody) settingsBody.innerHTML = settingsHtml;
};

const applyLegacyDispositionUndo = (entry) => {
  const realIdx = entry.itemKey
    ? inventory.findIndex((i) => computeItemKey(i) === entry.itemKey)
    : entry.idx;
  if (realIdx === -1 || realIdx >= inventory.length) return;
  const item = inventory[realIdx];
  if (!item) return;
  if (entry.undone) {
    // Redo: re-apply the disposition from newValue
    try {
      item.disposition = JSON.parse(entry.newValue);
    } catch (e) {
      return;
    }
    // Re-establish tradedFromUuid back-references on received items
    const redoUuids = item.disposition?.tradedForUuids;
    if (Array.isArray(redoUuids)) {
      redoUuids.forEach((uuid) => {
        const received = inventory.find((i) => i.uuid === uuid);
        if (received) received.tradedFromUuid = item.uuid;
      });
    }
    saveInventory();
    entry.undone = false;
    if (typeof showToast === "function") showToast(sanitizeHtml(item.name) + " re-disposed.");
  } else {
    // Undo: clean up trade link back-references before clearing disposition
    const linkedUuids = item.disposition?.tradedForUuids;
    if (Array.isArray(linkedUuids)) {
      linkedUuids.forEach((uuid) => {
        const received = inventory.find((i) => i.uuid === uuid);
        if (received?.tradedFromUuid === item.uuid) delete received.tradedFromUuid;
      });
    }
    item.disposition = null;
    saveInventory();
    entry.undone = true;
    if (typeof showToast === "function")
      showToast(sanitizeHtml(item.name) + " restored to active inventory.");
  }
  renderTable();
  if (typeof renderActiveFilters === "function") renderActiveFilters();
  if (typeof updateSummary === "function") updateSummary();
  renderChangeLog();
  saveDataSync("changeLog", changeLog);
};
window.applyLegacyDispositionUndo = applyLegacyDispositionUndo;

/**
 * Toggles a logged change between undone and redone states
 * @param {number} logIdx - Index of change entry in changeLog array
 */
const toggleChange = async (logIdx) => {
  const entry = changeLog[logIdx];
  if (!entry) return;
  if (entry.neutralized) return;

  // Cascade undo/redo — any transactionId routes here regardless of field (STAK-388)
  if (entry.transactionId) {
    if (typeof confirmCascadeUndo === "function") {
      await confirmCascadeUndo(entry.transactionId, entry);
    }
    return;
  }

  // Attachment changes — no undo supported; prevent fall-through to scalar assignment
  if (entry.type === "attachment-change") return;

  // Cascade undo/redo — any transactionId routes here regardless of field (STAK-388)
  if (entry.transactionId) {
    if (typeof confirmCascadeUndo === "function") {
      await confirmCascadeUndo(entry.transactionId, entry);
    }
    return;
  }

  // Attachment changes — no undo supported; prevent fall-through to scalar assignment
  if (entry.type === "attachment-change") return;

  // Price history delete — undo restores the entry, redo re-deletes it (STAK-109)
  if (entry.field === "priceHistoryDelete") {
    const deleted = JSON.parse(entry.oldValue);
    if (entry.undone) {
      // Redo: re-delete the entry
      if (itemPriceHistory[deleted.uuid]) {
        itemPriceHistory[deleted.uuid] = itemPriceHistory[deleted.uuid].filter(
          (e) => e.ts !== deleted.entry.ts
        );
        if (itemPriceHistory[deleted.uuid].length === 0) {
          delete itemPriceHistory[deleted.uuid];
        }
      }
      entry.undone = false;
    } else {
      // Undo: restore the deleted entry
      if (!itemPriceHistory[deleted.uuid]) itemPriceHistory[deleted.uuid] = [];
      itemPriceHistory[deleted.uuid].push(deleted.entry);
      itemPriceHistory[deleted.uuid].sort((a, b) => a.ts - b.ts);
      entry.undone = true;
    }
    if (typeof saveItemPriceHistory === "function") saveItemPriceHistory();
    if (typeof renderItemPriceHistoryTable === "function") renderItemPriceHistoryTable();
    if (typeof renderItemPriceHistoryModalTable === "function") renderItemPriceHistoryModalTable();
    renderChangeLog();
    saveDataSync("changeLog", changeLog);
    return;
  }

  if (entry.field === "tradeLink") {
    const applyTradeSnapshot = (snapshot) => {
      if (!snapshot || !snapshot.disposedUuid || !snapshot.receivedUuid) return;
      const disposed = inventory.find((i) => i.uuid === snapshot.disposedUuid);
      const received = inventory.find((i) => i.uuid === snapshot.receivedUuid);
      if (disposed?.disposition) {
        if (Array.isArray(snapshot.tradedForUuids) && snapshot.tradedForUuids.length > 0) {
          disposed.disposition.tradedForUuids = [...snapshot.tradedForUuids];
        } else {
          delete disposed.disposition.tradedForUuids;
        }
        if (snapshot.tradeValue) {
          disposed.disposition.tradeValues = {
            ...(disposed.disposition.tradeValues || {}),
            [snapshot.receivedUuid]: snapshot.tradeValue,
          };
        } else if (disposed.disposition.tradeValues) {
          delete disposed.disposition.tradeValues[snapshot.receivedUuid];
          if (Object.keys(disposed.disposition.tradeValues).length === 0) {
            delete disposed.disposition.tradeValues;
          }
        }
      }
      if (received) {
        if (snapshot.tradedFromUuid) received.tradedFromUuid = snapshot.tradedFromUuid;
        else delete received.tradedFromUuid;
      }
    };
    let oldSnapshot, newSnapshot;
    try {
      oldSnapshot = entry.oldValue ? JSON.parse(entry.oldValue) : null;
      newSnapshot = entry.newValue ? JSON.parse(entry.newValue) : null;
    } catch {
      if (typeof showToast === "function") showToast("Undo failed — corrupt trade snapshot.");
      return;
    }
    try {
      if (entry.undone) {
        applyTradeSnapshot(newSnapshot);
        entry.undone = false;
      } else {
        applyTradeSnapshot(oldSnapshot);
        entry.undone = true;
      }
    } catch (e) {
      console.warn("[ChangeLog] applyTradeSnapshot failed:", e);
      if (typeof showToast === "function") showToast("Trade undo failed — invalid snapshot.");
      return;
    }
    saveInventory();
    renderTable();
    renderChangeLog();
    saveDataSync("changeLog", changeLog);
    return;
  }

  if (entry.field === "Deleted") {
    if (entry.undone) {
      const realIdx = entry.itemKey
        ? inventory.findIndex((i) => computeItemKey(i) === entry.itemKey)
        : entry.idx;
      if (realIdx === -1 || realIdx >= inventory.length) return;
      const removed = inventory.splice(realIdx, 1)[0];
      if (removed.serial) {
        delete catalogMap[removed.serial];
      }
      entry.undone = false;
    } else {
      if (entry.oldValue == null) {
        if (typeof showToast === "function") showToast("Redo failed — snapshot missing.");
        return;
      }
      let restored;
      try {
        restored = JSON.parse(entry.oldValue);
      } catch {
        if (typeof showToast === "function") showToast("Redo failed — corrupt snapshot.");
        return;
      }
      inventory.splice(entry.idx, 0, restored);
      if (restored.serial) {
        catalogMap[restored.serial] = restored.numistaId || "";
      }
      entry.undone = true;
    }
    saveInventory();
    renderTable();
    if (typeof renderActiveFilters === "function") renderActiveFilters();
    if (typeof updateSummary === "function") updateSummary();
    if (typeof window.invalidateSearchCache === "function") window.invalidateSearchCache(null);
    renderChangeLog();
    saveDataSync("changeLog", changeLog);
    return;
  } else if (entry.field === "Added") {
    if (entry.undone) {
      // Redo: re-add the item
      if (entry.newValue == null) {
        if (typeof showToast === "function") showToast("Redo failed — snapshot missing.");
        return;
      }
      let restored;
      try {
        restored = JSON.parse(entry.newValue);
      } catch {
        if (typeof showToast === "function") showToast("Redo failed — corrupt snapshot.");
        return;
      }
      inventory.splice(entry.idx, 0, restored);
      if (restored.serial) {
        catalogMap[restored.serial] = restored.numistaId || "";
      }
      entry.undone = false;
    } else {
      // Undo: remove the item — snapshot it into newValue for redo
      const realIdx = entry.itemKey
        ? inventory.findIndex((i) => computeItemKey(i) === entry.itemKey)
        : entry.idx;
      if (realIdx === -1 || realIdx >= inventory.length) return;
      const removed = inventory.splice(realIdx, 1)[0];
      entry.newValue = JSON.stringify(removed);
      if (removed.serial) {
        delete catalogMap[removed.serial];
      }
      entry.undone = true;
    }
    saveInventory();
    renderTable();
    if (typeof renderActiveFilters === "function") renderActiveFilters();
    if (typeof updateSummary === "function") updateSummary();
    if (typeof window.invalidateSearchCache === "function") window.invalidateSearchCache(null);
    renderChangeLog();
    saveDataSync("changeLog", changeLog);
    return;
    // Disposition undo/redo (STAK-388)
  } else if (entry.field === "Disposed") {
    applyLegacyDispositionUndo(entry);
    return;
  } else {
    const item = inventory[entry.idx];
    if (!item) return;
    if (entry.undone) {
      item[entry.field] = entry.newValue;
      entry.undone = false;
    } else {
      item[entry.field] = entry.oldValue;
      entry.undone = true;
    }
    if (item.serial) {
      catalogMap[item.serial] = item.numistaId || "";
    }
    if (typeof window.invalidateSearchCache === "function") {
      window.invalidateSearchCache(item);
    }
  }
  saveInventory();
  renderTable();
  renderChangeLog();
  saveDataSync("changeLog", changeLog);
};

// Re-entrancy guard — prevents double-fire when user clicks "Undo Both" twice rapidly
const _activeCascadeUndos = new Set();

const confirmCascadeUndo = async (transactionId, triggerEntry) => {
  if (_activeCascadeUndos.has(transactionId))
    return { ok: false, applied: "none", reason: "already_in_flight" };
  _activeCascadeUndos.add(transactionId);
  try {
    const paired = changeLog.filter((e) => e.transactionId === transactionId && !e.undone);

    if (paired.length !== 2) {
      if (triggerEntry) applyLegacyDispositionUndo(triggerEntry);
      return { ok: false, applied: "none", reason: "no_paired_entries" };
    }

    const splitEntry = paired.find((e) => e.field === "Stack split");
    const disposedEntry = paired.find((e) => e.field === "Disposed");
    if (!splitEntry || !disposedEntry || !splitEntry.stackSplit) {
      if (triggerEntry) applyLegacyDispositionUndo(triggerEntry);
      return { ok: false, applied: "none", reason: "missing_entry_type" };
    }

    const { originalUuid, cloneUuid, originalQtyBefore, originalQtyAfter, disposedQty } =
      splitEntry.stackSplit;

    const cloneIdx = inventory.findIndex((item) => item.uuid === cloneUuid);
    const originalIdx = inventory.findIndex((item) => item.uuid === originalUuid);

    // Four drift invariants — any failure downgrades to single-entry undo
    const drifted =
      cloneIdx === -1 ||
      originalIdx === -1 ||
      inventory[originalIdx].qty !== originalQtyAfter ||
      inventory[cloneIdx].disposition?.splitFromUuid !== originalUuid ||
      inventory[cloneIdx].disposition?.disposedAt !== transactionId;

    if (drifted) {
      const proceed =
        typeof showAppConfirm === "function"
          ? await showAppConfirm(
              "Original record has been edited since this split — only this disposition entry can be undone. Continue with single-entry undo?",
              "Cascade undo unavailable"
            )
          : false;
      if (proceed) {
        const fallbackEntry = triggerEntry || paired.find((e) => e.field === "Disposed");
        if (fallbackEntry) {
          applyLegacyDispositionUndo(fallbackEntry);
          return { ok: true, applied: "single-entry" };
        }
      }
      return { ok: true, applied: "none", reason: "user_cancelled" };
    }

    const confirmed =
      typeof showAppConfirm === "function"
        ? await showAppConfirm(
            "Undoing this entry will reverse both the stack split and the disposition. Continue?",
            "Cascade undo"
          )
        : false;
    if (!confirmed) return { ok: true, applied: "none", reason: "user_cancelled" };

    // Two-phase commit — snapshot before any mutation
    const inventorySnapshot = structuredClone(inventory);
    const changeLogSnapshot = structuredClone(changeLog);

    const originalName = inventory[originalIdx].name;
    inventory[originalIdx].qty += disposedQty;
    // Adjust originalIdx if clone was before it in the array
    const adjustedOriginalIdx = cloneIdx < originalIdx ? originalIdx - 1 : originalIdx;
    inventory.splice(cloneIdx, 1);
    splitEntry.undone = true;
    disposedEntry.undone = true;

    if (!tryPersistInventory()) {
      inventory.length = 0;
      inventorySnapshot.forEach((i) => inventory.push(i));
      changeLog.length = 0;
      changeLogSnapshot.forEach((e) => changeLog.push(e));
      if (typeof showToast === "function")
        showToast("Couldn't undo — storage failed. Try again.", "error");
      return { ok: false, applied: "none", reason: "storage_failed_inventory" };
    }

    if (!tryPersistChangeLog()) {
      inventory.length = 0;
      inventorySnapshot.forEach((i) => inventory.push(i));
      changeLog.length = 0;
      changeLogSnapshot.forEach((e) => changeLog.push(e));
      const revertOk = tryPersistInventory();
      if (!revertOk) {
        if (typeof showToast === "function") {
          showToast(
            "Critical: storage failure left state inconsistent. Reload to recover.",
            "error"
          );
        }
        return { ok: false, applied: "none", reason: "storage_failed_both" };
      }
      return { ok: false, applied: "none", reason: "storage_failed_changelog" };
    }

    // Non-blocking image cleanup
    try {
      if (window.imageCache && typeof window.imageCache.deleteUserImage === "function") {
        window.imageCache.deleteUserImage(cloneUuid).catch(() => {});
      }
    } catch (e) {
      if (typeof debugLog === "function") debugLog("confirmCascadeUndo: image cleanup failed", e);
    }

    renderTable();
    if (typeof renderActiveFilters === "function") renderActiveFilters();
    if (typeof updateSummary === "function") updateSummary();
    if (typeof window.invalidateSearchCache === "function") window.invalidateSearchCache(null);
    renderChangeLog();

    if (typeof showToast === "function") {
      showToast(
        sanitizeHtml(originalName ?? "Item") +
          " stack split reversed — restored to " +
          (inventory[adjustedOriginalIdx]?.qty ?? originalQtyBefore)
      );
    }

    return { ok: true, applied: "cascade" };
  } finally {
    _activeCascadeUndos.delete(transactionId);
  }
};
window.confirmCascadeUndo = confirmCascadeUndo;

/**
 * Clears all change log entries after confirmation
 */
const clearChangeLog = async () => {
  const confirmed =
    typeof showAppConfirm === "function"
      ? await showAppConfirm("Clear change log?", "Activity Log")
      : false;
  if (!confirmed) return;
  changeLog = [];
  saveDataSync("changeLog", changeLog);
  renderChangeLog();
};

/**
 * Logs a single attachment add/remove/replace event to the change log.
 * Attachments are arrays so logItemChanges can't diff them per-entry — this function
 * emits one entry per operation keyed by attachmentUuid.
 * @param {Object} item - Inventory item that owns the attachment
 * @param {"add"|"remove"|"replace"} action
 * @param {Object} attachRecord - New attachment record (for add/replace)
 * @param {Object|null} oldRecord - Previous attachment record (replace only)
 */
const logAttachmentChange = (item, action, attachRecord, oldRecord = null) => {
  const fieldLabels = {
    add: "Attachment added",
    remove: "Attachment removed",
    replace: "Attachment replaced",
  };
  const field = fieldLabels[action] || "Attachment changed";
  const idx = inventory.indexOf(item);
  changeLog.push({
    timestamp: Date.now(),
    itemName: item.name || "",
    field,
    oldValue: action === "add" ? null : (oldRecord?.fileName ?? attachRecord?.fileName ?? null),
    newValue: action === "remove" ? null : (attachRecord?.fileName ?? null),
    attachmentUuid: attachRecord?.attachmentUuid ?? oldRecord?.attachmentUuid ?? null,
    idx,
    undone: false,
    scope: "inventory",
    itemKey: computeItemKey(item),
    type: "attachment-change",
  });
  saveDataSync("changeLog", changeLog);
};

/**
 * Returns change log entries at or after the given timestamp, shaped for sync manifests.
 * Sentinel entries (type === 'sync-marker') are excluded from manifest output.
 * @param {number|null|undefined} sinceTimestamp - Unix ms lower bound (inclusive). Pass null/undefined for all entries.
 * @returns {Array<{timestamp, scope, itemKey, type, field, itemName, oldValue, newValue}>}
 */
const getManifestEntries = (sinceTimestamp) => {
  return changeLog
    .filter((entry) => {
      if (entry.neutralized) return false;
      if (entry.type === "sync-marker") return false;
      if (sinceTimestamp == null) return true;
      return entry.timestamp >= sinceTimestamp;
    })
    .map((entry) => ({
      timestamp: entry.timestamp,
      scope: entry.scope,
      itemKey: entry.itemKey,
      type: entry.type,
      field: entry.field,
      itemName: entry.itemName,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
    }));
};

/**
 * Appends a sync-marker sentinel to the change log and persists it.
 * Used by cloud-sync to record the last successful sync boundary.
 * @param {string} syncId - Unique sync session identifier
 * @param {number} timestamp - Unix ms timestamp of the sync
 */
const markSynced = (syncId, timestamp) => {
  changeLog.push({ type: "sync-marker", syncId, timestamp });
  saveDataSync("changeLog", changeLog);
};

window.computeItemKey = computeItemKey;
window.logChange = logChange;
window.tryPersistChangeLog = tryPersistChangeLog;
window.logItemChanges = logItemChanges;
window.logAttachmentChange = logAttachmentChange;
window.renderChangeLog = renderChangeLog;
window.toggleChange = toggleChange;
window.clearChangeLog = clearChangeLog;
window.getManifestEntries = getManifestEntries;
window.markSynced = markSynced;
window.editFromChangeLog = (idx, logIdx) => {
  const modal = document.getElementById("changeLogModal");
  if (modal) {
    modal.style.display = "none";
  }
  document.body.style.overflow = "";
  editItem(idx, logIdx);
};
