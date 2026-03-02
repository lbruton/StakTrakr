/**
 * Change log tracking and rendering
 * Tracks all cell changes in the inventory table
 */

/**
 * Computes a stable composite key for an inventory item.
 * Mirrors DiffEngine.computeItemKey() — uuid → serial → numistaId|name|date → name|date.
 * @param {Object} item - Inventory item object
 * @returns {string} Stable item key
 */
const computeItemKey = (item) => {
  if (!item) return '';
  if (item.uuid) return String(item.uuid);
  if (item.serial) return String(item.serial);
  if (item.numistaId) return `${item.numistaId}|${item.name || ''}|${item.date || ''}`;
  return `${item.name || ''}|${item.date || ''}`;
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
  saveDataSync('changeLog', changeLog);
};

/**
 * Compares two item objects and logs any differences.
 * Adds scope, itemKey, and type fields to each entry (additive — existing entries
 * without these fields continue to render correctly in the UI).
 * Signature is unchanged: (oldItem, newItem).
 * @param {Object|null} oldItem - Original item values (null for additions)
 * @param {Object|null} newItem - Updated item values (null for deletions)
 */
const logItemChanges = (oldItem, newItem) => {
  const fields = [
    'date',
    'type',
    'metal',
    'name',
    'qty',
    'weight',
    'price',
    'marketValue',
    'purchaseLocation',
    'notes',
  ];

  const refItem = newItem || oldItem;
  const itemKey = computeItemKey(refItem);
  const scope = 'inventory';
  const type = oldItem === null ? 'item-add'
    : newItem === null ? 'item-delete'
    : 'item-edit';

  // For add/delete, only one side exists — skip per-field diff and record a single entry
  if (type === 'item-add' || type === 'item-delete') {
    const item = refItem;
    const idx = inventory.indexOf(item);
    changeLog.push({
      timestamp: Date.now(),
      itemName: item.name || '',
      field: type === 'item-add' ? 'Added' : 'Deleted',
      oldValue: type === 'item-delete' ? JSON.stringify(item) : null,
      newValue: type === 'item-add' ? JSON.stringify(item) : null,
      idx,
      undone: false,
      scope,
      itemKey,
      type,
    });
    saveDataSync('changeLog', changeLog);
    return;
  }

  fields.forEach((field) => {
    if (oldItem[field] !== newItem[field]) {
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
  saveDataSync('changeLog', changeLog);
};

/**
 * Renders the change log table with all entries
 */
const renderChangeLog = () => {
  const rows = [...changeLog]
    .slice()
    .reverse()
    .map((entry, i) => {
      const globalIndex = changeLog.length - 1 - i;
      const actionLabel = entry.undone ? 'Redo' : 'Undo';

      // Friendly display for price history deletions (STAK-109)
      let displayField = sanitizeHtml(entry.field);
      let displayOld = sanitizeHtml(String(entry.oldValue));
      let displayNew = sanitizeHtml(String(entry.newValue));

      // Format raw JSON snapshots into human-readable summaries (UX-001)
      if ((entry.field === 'Deleted' || entry.field === 'Added') && entry.oldValue) {
        try {
          const snap = typeof entry.oldValue === 'string' ? JSON.parse(entry.oldValue) : entry.oldValue;
          if (snap && typeof snap === 'object' && snap.name) {
            const fmtFn = typeof formatCurrency === 'function' ? formatCurrency : (v) => '$' + Number(v).toFixed(2);
            const parts = [snap.metal, snap.type, snap.name];
            if (snap.weight) parts.push(typeof formatWeight === 'function' ? formatWeight(snap.weight, snap.weightUnit) : snap.weight + ' oz');
            if (snap.price) parts.push(fmtFn(snap.price));
            displayOld = sanitizeHtml(parts.filter(Boolean).join(' \u00B7 '));
          }
        } catch { /* keep original */ }
      }
      let rowClick = `onclick="editFromChangeLog(${entry.idx}, ${globalIndex})"`;
      if (entry.field === 'priceHistoryDelete') {
        displayField = 'Price Entry Deleted';
        try {
          const d = JSON.parse(entry.oldValue);
          const fmtFn = typeof formatCurrency === 'function' ? formatCurrency : (v) => '$' + Number(v).toFixed(2);
          displayOld = `Retail: ${sanitizeHtml(fmtFn(d.entry.retail))}`;
        } catch { displayOld = '(price entry)'; }
        displayNew = entry.undone ? 'Restored' : 'Deleted';
        rowClick = ''; // No item to navigate to
      }

      return `
      <tr ${rowClick}>
        <td title="${formatTimestamp(entry.timestamp)}">${formatTimestamp(entry.timestamp)}</td>
        <td title="${sanitizeHtml(entry.itemName)}">${sanitizeHtml(entry.itemName)}</td>
        <td title="${displayField}">${displayField}</td>
        <td title="${displayOld}">${displayOld}</td>
        <td title="${displayNew}">${displayNew}</td>
        <td class="action-cell"><button class="btn action-btn" style="margin:1px;" onclick="event.stopPropagation(); toggleChange(${globalIndex})">${actionLabel}</button></td>
      </tr>`;
    });

  const html = rows.join('');

  // Populate both the modal table and the settings panel table
  const modalBody = document.querySelector('#changeLogTable tbody');
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  if (modalBody) modalBody.innerHTML = html;
  const settingsBody = document.querySelector('#settingsChangeLogTable tbody');
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  if (settingsBody) settingsBody.innerHTML = html;
};

/**
 * Toggles a logged change between undone and redone states
 * @param {number} logIdx - Index of change entry in changeLog array
 */
const toggleChange = (logIdx) => {
  const entry = changeLog[logIdx];
  if (!entry) return;

  // Price history delete — undo restores the entry, redo re-deletes it (STAK-109)
  if (entry.field === 'priceHistoryDelete') {
    const deleted = JSON.parse(entry.oldValue);
    if (entry.undone) {
      // Redo: re-delete the entry
      if (itemPriceHistory[deleted.uuid]) {
        itemPriceHistory[deleted.uuid] = itemPriceHistory[deleted.uuid]
          .filter(e => e.ts !== deleted.entry.ts);
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
    if (typeof saveItemPriceHistory === 'function') saveItemPriceHistory();
    if (typeof renderItemPriceHistoryTable === 'function') renderItemPriceHistoryTable();
    if (typeof renderItemPriceHistoryModalTable === 'function') renderItemPriceHistoryModalTable();
    renderChangeLog();
    saveDataSync('changeLog', changeLog);
    return;
  }

  if (entry.field === 'Deleted') {
    if (entry.undone) {
      const removed = inventory.splice(entry.idx, 1)[0];
      if (removed && removed.serial) {
        delete catalogMap[removed.serial];
      }
      entry.undone = false;
    } else {
      const restored = JSON.parse(entry.oldValue || '{}');
      inventory.splice(entry.idx, 0, restored);
      if (restored.serial) {
        catalogMap[restored.serial] = restored.numistaId || "";
      }
      entry.undone = true;
    }
  // Disposition undo/redo (STAK-388)
  } else if (entry.field === 'Disposed') {
    const item = inventory[entry.idx];
    if (!item) return;
    if (entry.undone) {
      // Redo: re-apply the disposition from newValue
      try {
        item.disposition = JSON.parse(entry.newValue);
      } catch (e) { return; }
      saveInventory();
      entry.undone = false;
      if (typeof showToast === 'function') showToast(sanitizeHtml(item.name) + ' re-disposed.');
    } else {
      // Undo: clear the disposition
      item.disposition = null;
      saveInventory();
      entry.undone = true;
      if (typeof showToast === 'function') showToast(sanitizeHtml(item.name) + ' restored to active inventory.');
    }
    renderTable();
    if (typeof renderActiveFilters === 'function') renderActiveFilters();
    if (typeof updateSummary === 'function') updateSummary();
    renderChangeLog();
    saveDataSync('changeLog', changeLog);
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
    if (typeof window.invalidateSearchCache === 'function') {
      window.invalidateSearchCache(item);
    }
  }
  saveInventory();
  renderTable();
  renderChangeLog();
  saveDataSync('changeLog', changeLog);
};

/**
 * Clears all change log entries after confirmation
 */
const clearChangeLog = async () => {
  const confirmed = typeof showAppConfirm === 'function'
    ? await showAppConfirm('Clear change log?', 'Activity Log')
    : false;
  if (!confirmed) return;
  changeLog = [];
  saveDataSync('changeLog', changeLog);
  renderChangeLog();
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
      if (entry.type === 'sync-marker') return false;
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
  changeLog.push({ type: 'sync-marker', syncId, timestamp });
  saveDataSync('changeLog', changeLog);
};

window.computeItemKey = computeItemKey;
window.logChange = logChange;
window.logItemChanges = logItemChanges;
window.renderChangeLog = renderChangeLog;
window.toggleChange = toggleChange;
window.clearChangeLog = clearChangeLog;
window.getManifestEntries = getManifestEntries;
window.markSynced = markSynced;
window.editFromChangeLog = (idx, logIdx) => {
  const modal = document.getElementById('changeLogModal');
  if (modal) {
    modal.style.display = 'none';
  }
  document.body.style.overflow = '';
  editItem(idx, logIdx);
};
