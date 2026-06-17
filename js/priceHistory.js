// ITEM PRICE HISTORY (STACK-43)
// =============================================================================
// Silent per-item price history recording.
// Mirrors the spotHistory pattern in spot.js: save/load/record/purge with dedup.
// Data structure: { "uuid": [{ ts, itemName, retail, spot, melt }, ...], ... }
// =============================================================================

/**
 * Applies the silent item-price retention cap to a history object (STRK-141, R6).
 * Pure helper — operates on the passed object in place and returns it:
 *   (a) drops entries older than ITEM_PRICE_HISTORY_MAX_DAYS (reuses
 *       purgeItemPriceHistory's age-cutoff logic), and
 *   (b) for any item whose entry array exceeds ITEM_PRICE_HISTORY_MAX_ENTRIES,
 *       keeps only the newest ITEM_PRICE_HISTORY_MAX_ENTRIES (drops oldest).
 *
 * No UI control, setting, or toggle is exposed — the cap is silent (R6.3).
 *
 * @param {Object} history - Item price history object keyed by UUID
 * @returns {Object} The same history object, with retention applied
 */
const applyItemPriceRetention = (history) => {
  if (!history || typeof history !== "object" || Array.isArray(history)) return history;

  const cutoff = Date.now() - ITEM_PRICE_HISTORY_MAX_DAYS * 24 * 60 * 60 * 1000;

  for (const uuid of Object.keys(history)) {
    let entries = Array.isArray(history[uuid]) ? history[uuid] : [];

    // (a) Age cutoff — drop entries older than the retention window.
    entries = entries.filter((e) => e && e.ts >= cutoff);

    // (b) Per-item backstop — keep only the newest N entries (drop oldest).
    if (entries.length > ITEM_PRICE_HISTORY_MAX_ENTRIES) {
      entries = entries.slice(entries.length - ITEM_PRICE_HISTORY_MAX_ENTRIES);
    }

    if (entries.length === 0) {
      delete history[uuid];
    } else {
      history[uuid] = entries;
    }
  }

  return history;
};

/**
 * Saves item price history to localStorage.
 * Enforces the silent retention cap (STRK-141) before every write.
 */
const saveItemPriceHistory = () => {
  try {
    applyItemPriceRetention(itemPriceHistory);
    saveDataSync(ITEM_PRICE_HISTORY_KEY, itemPriceHistory);
  } catch (error) {
    console.error("Error saving item price history:", error);
  }
};

/**
 * Loads item price history from localStorage into the global state variable.
 */
const loadItemPriceHistory = () => {
  try {
    const data = loadDataSync(ITEM_PRICE_HISTORY_KEY, {});
    itemPriceHistory = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch (error) {
    console.error("Error loading item price history:", error);
    itemPriceHistory = {};
  }
};

/**
 * Removes item price history entries older than the specified number of days.
 * Not called automatically — available for future settings UI.
 *
 * @param {number} days - Number of days to retain (default: 365)
 */
const purgeItemPriceHistory = (days = 365) => {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let changed = false;

  for (const uuid of Object.keys(itemPriceHistory)) {
    const before = itemPriceHistory[uuid].length;
    itemPriceHistory[uuid] = itemPriceHistory[uuid].filter((e) => e.ts >= cutoff);
    if (itemPriceHistory[uuid].length === 0) {
      delete itemPriceHistory[uuid];
      changed = true;
    } else if (itemPriceHistory[uuid].length !== before) {
      changed = true;
    }
  }

  if (changed) saveItemPriceHistory();
};

/**
 * Safely reads a snapshot item name from a history entry.
 * Supports both `itemName` (current) and legacy/alternate `name`.
 *
 * @param {Object} entry - Item price history entry
 * @returns {string} Trimmed snapshot name or empty string
 */
const getSnapshotItemName = (entry) => {
  if (!entry || typeof entry !== "object") return "";

  if (typeof entry.itemName === "string" && entry.itemName.trim()) {
    return entry.itemName.trim();
  }
  if (typeof entry.name === "string" && entry.name.trim()) {
    return entry.name.trim();
  }
  return "";
};

/**
 * Records a single price data point for an inventory item.
 * Applies deduplication rules:
 *   - add/edit/bulk: skip exact duplicates only (same retail + spot + melt)
 *   - spot-sync: 24h throttle if retail unchanged; beyond 24h, require >1% delta
 *
 * Does NOT save to localStorage — caller must batch saves.
 *
 * @param {Object} item - Inventory item (must have uuid, metal, weight, qty, purity, marketValue)
 * @param {string} trigger - Recording trigger: 'add' | 'edit' | 'bulk' | 'spot-sync'
 * @returns {boolean} True if a data point was recorded
 */
const recordItemPrice = (item, trigger = "spot-sync") => {
  if (!item || !item.uuid) return false;

  const uuid = item.uuid;
  const itemName = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "Unnamed";
  const metalKey = (item.metal || "Silver").toLowerCase();
  const spot = spotPrices[metalKey] || 0;
  const melt = parseFloat(computeMeltValue(item, spot).toFixed(2));

  // Retail hierarchy: max(Goldback denomination price, manual marketValue), then 0.
  // Must match the lookup used by table renderer, CSV/PDF export, and details modal.
  const gbDenomPrice =
    typeof getGoldbackRetailPrice === "function" ? getGoldbackRetailPrice(item) : null;
  const rawMarket = item.marketValue && item.marketValue > 0 ? parseFloat(item.marketValue) : 0;
  const retail = gbDenomPrice
    ? parseFloat(Math.max(gbDenomPrice, rawMarket).toFixed(2))
    : rawMarket;
  const now = Date.now();

  // Initialize array for this UUID if needed
  if (!itemPriceHistory[uuid]) {
    itemPriceHistory[uuid] = [];
  }

  const entries = itemPriceHistory[uuid];
  const last = entries.length > 0 ? entries[entries.length - 1] : null;

  // Dedup for spot-sync trigger (aggressive throttling)
  if (last && trigger === "spot-sync") {
    const timeSinceLast = now - last.ts;
    const within24h = timeSinceLast < 24 * 60 * 60 * 1000;
    const retailUnchanged = last.retail === retail;

    if (retailUnchanged) {
      // Hard 24h throttle: never record more than once per 24h if retail unchanged
      if (within24h) return false;

      // Beyond 24h: only record if spot or melt changed meaningfully (> 1%)
      const meltDelta = last.melt > 0 ? Math.abs(melt - last.melt) / last.melt : 0;
      const spotDelta = last.spot > 0 ? Math.abs(spot - last.spot) / last.spot : 0;
      if (meltDelta <= 0.01 && spotDelta <= 0.01) return false;
    }
    // If retail changed, always record (falls through)
  }

  // Dedup for add/edit/bulk: skip exact duplicates only
  if (last && trigger !== "spot-sync") {
    if (last.retail === retail && last.spot === spot && Math.abs(last.melt - melt) < 0.005) {
      return false;
    }
  }

  entries.push({
    ts: now,
    itemName: itemName,
    retail: retail,
    spot: spot,
    melt: melt,
  });

  return true;
};

/**
 * Records a price data point for a single item and saves immediately.
 * Used after item add, edit, or inline edit.
 *
 * @param {Object} item - Inventory item
 * @param {string} trigger - 'add' | 'edit' | 'bulk'
 */
const recordSingleItemPrice = (item, trigger = "edit") => {
  if (recordItemPrice(item, trigger)) {
    saveItemPriceHistory();
  }
};

/**
 * Snapshots all inventory items after a spot price change.
 * Applies spot-sync dedup rules (24h throttle, 1% delta).
 * Called after API sync, manual spot update, or spot reset.
 */
const recordAllItemPriceSnapshots = () => {
  if (!inventory || inventory.length === 0) return;

  let anyRecorded = false;
  for (const item of inventory) {
    if (recordItemPrice(item, "spot-sync")) {
      anyRecorded = true;
    }
  }

  if (anyRecorded) {
    saveItemPriceHistory();
  }
};

/**
 * Merges imported item price history with existing data.
 * Union by UUID + timestamp — deduplicates, sorts ascending.
 * Used during ZIP restore (unlike spot history which does full replace).
 *
 * @param {Object} importedHistory - Object keyed by UUID with arrays of entries
 */
const mergeItemPriceHistory = (importedHistory) => {
  if (!importedHistory || typeof importedHistory !== "object") return;

  for (const [uuid, entries] of Object.entries(importedHistory)) {
    if (!Array.isArray(entries)) continue;

    if (!itemPriceHistory[uuid]) {
      // New UUID — copy as-is
      itemPriceHistory[uuid] = entries;
    } else {
      // Merge: combine, deduplicate by timestamp, sort ascending
      const combined = [...itemPriceHistory[uuid], ...entries];
      const seen = new Set();
      const deduped = [];
      for (const entry of combined) {
        if (!seen.has(entry.ts)) {
          seen.add(entry.ts);
          deduped.push(entry);
        }
      }
      deduped.sort((a, b) => a.ts - b.ts);
      itemPriceHistory[uuid] = deduped;
    }
  }

  saveItemPriceHistory();
};

/**
 * Removes history for UUIDs not present in the current inventory.
 * Not called automatically — available for storage optimization.
 *
 * @returns {number} Number of orphaned UUIDs removed
 */
const cleanOrphanedItemPriceHistory = () => {
  const activeUuids = new Set(inventory.map((i) => i.uuid).filter(Boolean));
  let removed = 0;

  for (const uuid of Object.keys(itemPriceHistory)) {
    if (!activeUuids.has(uuid)) {
      delete itemPriceHistory[uuid];
      removed++;
    }
  }

  if (removed > 0) saveItemPriceHistory();
  return removed;
};

// =============================================================================
// ITEM PRICE HISTORY — CLOUD-SYNC COMPANION MERGE (STRK-147)
// =============================================================================
// Pure, deterministic helpers for the dedicated item-price-history companion
// vault. These mirror the convergence model of the tag merge (_mergeTagData):
// a logical (decompressed/parsed/sorted) compare+hash that is commutative on
// ties and idempotent. They are intentionally separate from the ts-only ZIP
// `mergeItemPriceHistory()` above, which is left UNCHANGED this sketch (D-2).
// =============================================================================

/** Canonical UUID v4-ish shape: 8-4-4-4-12 lowercase hex (no embedded quotes). */
const _ITEM_PRICE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tests whether a key is a well-formed history UUID.
 * Malformed keys are dropped during canonicalization so they never poison the hash.
 *
 * @param {*} uuid - Candidate UUID key
 * @returns {boolean} True if the key matches the canonical UUID shape
 */
const _isValidItemPriceUuid = (uuid) => typeof uuid === "string" && _ITEM_PRICE_UUID_RE.test(uuid);

/**
 * Coerces a single history entry to a normalized numeric/string shape.
 * Snapshot name reuses getSnapshotItemName (supports legacy `name`).
 *
 * @param {Object} entry - Raw history entry
 * @returns {{ts:number,itemName:string,retail:number,spot:number,melt:number}|null}
 *          Normalized entry, or null when the entry has no usable timestamp.
 */
const _normalizeItemPriceEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null;
  const ts = Number(entry.ts);
  if (!Number.isFinite(ts)) return null;
  return {
    ts: ts,
    itemName: getSnapshotItemName(entry),
    retail: Number(entry.retail) || 0,
    spot: Number(entry.spot) || 0,
    melt: Number(entry.melt) || 0,
  };
};

/**
 * Stable full-entry fingerprint used as both the dedupe key and the comparator
 * tie-breaker. Order: ts, itemName, retail, spot, melt (D-8). Two snapshots that
 * share a ts but differ in any field are distinct and BOTH survive (AC-3).
 *
 * @param {Object} entry - Normalized history entry
 * @returns {string} Deterministic fingerprint string
 */
const _itemPriceEntryFingerprint = (entry) =>
  [entry.ts, entry.itemName, entry.retail, entry.spot, entry.melt].join(" ");

/**
 * Full-fingerprint comparator: sorts by ts, then itemName, retail, spot, melt.
 * A pure ts comparator leaves equal-ts distinct entries in input order, making
 * merge(A,B) and merge(B,A) diverge — this restores total determinism (D-8).
 *
 * @param {Object} a - Normalized history entry
 * @param {Object} b - Normalized history entry
 * @returns {number} Negative, zero, or positive per standard comparator contract
 */
const _compareItemPriceEntries = (a, b) => {
  if (a.ts !== b.ts) return a.ts - b.ts;
  if (a.itemName !== b.itemName) return a.itemName < b.itemName ? -1 : 1;
  if (a.retail !== b.retail) return a.retail - b.retail;
  if (a.spot !== b.spot) return a.spot - b.spot;
  if (a.melt !== b.melt) return a.melt - b.melt;
  return 0;
};

/**
 * Decompresses (CMP-aware) and parses an item-price-history input into an object.
 * Accepts a plain object, a JSON string, or a CMP-compressed string, so the same
 * logical content yields an equal canonical form regardless of input form (D-8).
 *
 * @param {Object|string} input - History object or its (possibly compressed) JSON
 * @returns {Object} Parsed history object keyed by UUID (empty object on failure)
 */
const _parseItemPriceHistoryInput = (input) => {
  if (input && typeof input === "object" && !Array.isArray(input)) return input;
  if (typeof input !== "string" || !input) return {};
  let str = input;
  if (typeof __decompressIfNeeded === "function") {
    try {
      str = __decompressIfNeeded(input);
    } catch (_e) {
      str = input;
    }
  }
  try {
    const parsed = JSON.parse(str);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_e) {
    return {};
  }
};

/**
 * Produces a canonical, deterministic item-price-history object (D-8):
 *   decompress/parse → drop malformed-UUID keys → drop unusable entries →
 *   sort UUID keys → sort each entry array by the full-fingerprint comparator.
 * Equal logical content (compressed or plain) canonicalizes identically, so its
 * stable-stringification and hash are input-form-independent.
 *
 * @param {Object|string} history - History object or its (possibly compressed) JSON
 * @returns {Object} A new canonical history object (input is not mutated)
 */
const canonicalizeItemPriceHistory = (history) => {
  const parsed = _parseItemPriceHistoryInput(history);
  const canonical = {};

  const uuids = Object.keys(parsed).filter(_isValidItemPriceUuid).sort();

  for (const uuid of uuids) {
    const raw = Array.isArray(parsed[uuid]) ? parsed[uuid] : [];
    const entries = raw.map(_normalizeItemPriceEntry).filter(Boolean);
    entries.sort(_compareItemPriceEntries);
    if (entries.length > 0) canonical[uuid] = entries;
  }

  return canonical;
};

/**
 * Stable-stringifies a canonical history object. Keys are already sorted and
 * entry arrays already comparator-ordered, so JSON.stringify over the canonical
 * shape is itself deterministic.
 *
 * @param {Object} canonical - Output of canonicalizeItemPriceHistory
 * @returns {string} Deterministic JSON string
 */
const _stringifyCanonicalItemPriceHistory = (canonical) => JSON.stringify(canonical);

/**
 * Commutative, idempotent fingerprint-union merge of two item-price histories
 * (D-2, D-6). UUID-keyed union; remote is filtered to `acceptedUuids` so a
 * rejected remote Item never imports orphan history (AC-6). Entries dedupe by
 * the FULL-ENTRY fingerprint (not ts alone), so equal-ts distinct snapshots are
 * preserved (AC-3) while exact duplicates collapse. Retention is applied AFTER
 * the union so the merged result honors the silent cap (STRK-141). The output is
 * canonical, guaranteeing merge(A,B) deep-equals merge(B,A) (commutative,
 * including tie order) and merge(X,X) === canonical X (idempotent), per AC-10.
 *
 * @param {Object|string} local - Local history (object or compressed/plain JSON)
 * @param {Object|string} remote - Remote history (object or compressed/plain JSON)
 * @param {Set<string>|Array<string>} [acceptedUuids] - UUID boundary for remote
 *        entries; when omitted/null, remote is NOT filtered (all UUIDs accepted)
 * @returns {Object} A new canonical, retention-capped merged history object
 */
const mergeItemPriceHistories = (local, remote, acceptedUuids) => {
  const localCanon = canonicalizeItemPriceHistory(local);
  const remoteCanon = canonicalizeItemPriceHistory(remote);

  const accept =
    acceptedUuids == null
      ? null
      : acceptedUuids instanceof Set
        ? acceptedUuids
        : new Set(acceptedUuids);

  const merged = {};

  // Seed with local entries (local is the trusted side — never boundary-filtered).
  for (const uuid of Object.keys(localCanon)) {
    merged[uuid] = localCanon[uuid].slice();
  }

  // Union in remote entries, filtered to the accepted inventory boundary.
  for (const uuid of Object.keys(remoteCanon)) {
    if (accept && !accept.has(uuid)) continue;
    if (!merged[uuid]) merged[uuid] = [];
    merged[uuid].push(...remoteCanon[uuid]);
  }

  // Dedupe each UUID's entries by full-entry fingerprint.
  for (const uuid of Object.keys(merged)) {
    const seen = new Set();
    const deduped = [];
    for (const entry of merged[uuid]) {
      const fp = _itemPriceEntryFingerprint(entry);
      if (seen.has(fp)) continue;
      seen.add(fp);
      deduped.push(entry);
    }
    merged[uuid] = deduped;
  }

  // Apply retention AFTER the union (post-merge), then re-canonicalize so the
  // result is order-deterministic regardless of which side contributed an entry.
  if (typeof applyItemPriceRetention === "function") applyItemPriceRetention(merged);

  return canonicalizeItemPriceHistory(merged);
};

/**
 * Collects the in-memory item-price-history, canonicalizes it, and hashes the
 * canonical content (D-8, AC-9). Because the hash is computed over the canonical
 * form, a compressed input and a plain input with identical logical content
 * yield the same hash — the change-detection pointer is input-form-independent.
 *
 * @returns {{payload:string,hash:string,uuidCount:number,entryCount:number}}
 *          Canonical JSON payload, its hash, and UUID/entry counts.
 */
const collectAndHashItemPriceHistory = () => {
  const source =
    typeof itemPriceHistory !== "undefined" && itemPriceHistory ? itemPriceHistory : {};
  const canonical = canonicalizeItemPriceHistory(source);
  const payload = _stringifyCanonicalItemPriceHistory(canonical);
  const hash = typeof simpleHash === "function" ? simpleHash(payload) : payload;

  const uuidCount = Object.keys(canonical).length;
  let entryCount = 0;
  for (const uuid of Object.keys(canonical)) entryCount += canonical[uuid].length;

  return { payload: payload, hash: hash, uuidCount: uuidCount, entryCount: entryCount };
};

/**
 * Throwing/reporting write path for companion-history merges (D-7, enables AC-7).
 * Unlike saveItemPriceHistory(), which swallows and logs saveDataSync() errors
 * (priceHistory.js:51-58) and would mask a quota failure, this RETHROWS so the
 * cloud-sync caller can detect the failure and keep `lastPull` stale for retry.
 * Retention is applied before the write to match the normal save contract.
 *
 * @param {Object} [history] - History object to persist (defaults to the global)
 * @returns {Object} The history object that was written
 * @throws Rethrows any saveDataSync error (e.g. quota exceeded)
 */
const writeItemPriceHistoryStrict = (history) => {
  const target =
    history && typeof history === "object" && !Array.isArray(history)
      ? history
      : typeof itemPriceHistory !== "undefined"
        ? itemPriceHistory
        : {};
  if (typeof applyItemPriceRetention === "function") applyItemPriceRetention(target);
  saveDataSync(ITEM_PRICE_HISTORY_KEY, target);
  return target;
};

// =============================================================================
// ITEM PRICE HISTORY — SETTINGS LOG TABLE
// =============================================================================

/** @type {string} Filter text for the settings price history table */
let priceHistoryFilterText = "";
/** @type {string} Sort column for settings price history table */
let settingsPriceSortColumn = "";
/** @type {boolean} Sort ascending for settings price history table */
let settingsPriceSortAsc = true;

/** Column keys for the price history table, matching <th> order. */
const PRICE_HISTORY_COLS = ["ts", "name", "retail", "spot", "melt"];

/**
 * Flattens, filters, and sorts item price history into renderable rows.
 * @param {string} [filterUuid] - If provided, only return rows for this UUID
 * @returns {Array<Object>} Sorted row objects (includes uuid for delete support)
 */
const preparePriceHistoryRows = (filterUuid) => {
  loadItemPriceHistory();

  const rows = [];
  const uuids = filterUuid
    ? [[filterUuid, itemPriceHistory[filterUuid] || []]]
    : Object.entries(itemPriceHistory);
  for (const [uuid, entries] of uuids) {
    const item = inventory.find((i) => i.uuid === uuid);
    const liveName =
      item && typeof item.name === "string" && item.name.trim() ? item.name.trim() : "";
    for (const e of entries) {
      const snapshotName = getSnapshotItemName(e);
      const name = item
        ? liveName || snapshotName || "Unnamed"
        : snapshotName
          ? `${snapshotName} (deleted)`
          : `(deleted: ${uuid.slice(0, 8)})`;
      rows.push({ ts: e.ts, name, uuid, retail: e.retail, spot: e.spot, melt: e.melt });
    }
  }

  let data = rows;
  if (priceHistoryFilterText) {
    const f = priceHistoryFilterText.toLowerCase();
    data = data.filter((r) => r.name.toLowerCase().includes(f));
  }

  if (settingsPriceSortColumn) {
    data.sort((a, b) => {
      const valA = a[settingsPriceSortColumn];
      const valB = b[settingsPriceSortColumn];
      if (valA < valB) return settingsPriceSortAsc ? -1 : 1;
      if (valA > valB) return settingsPriceSortAsc ? 1 : -1;
      return 0;
    });
  } else {
    data.sort((a, b) => b.ts - a.ts);
  }

  return data;
};

/**
 * Attaches click-to-sort handlers to price history table headers.
 * @param {HTMLTableElement} table
 */
const attachPriceHistorySortHeaders = (table) => {
  table.querySelectorAll("th").forEach((th) => {
    const idx = Array.from(th.parentNode.children).indexOf(th);
    const col = PRICE_HISTORY_COLS[idx];
    if (!col) return; // Skip non-data columns (e.g. Actions)
    th.style.cursor = "pointer";
    th.onclick = () => {
      if (settingsPriceSortColumn === col) {
        settingsPriceSortAsc = !settingsPriceSortAsc;
      } else {
        settingsPriceSortColumn = col;
        settingsPriceSortAsc = true;
      }
      renderItemPriceHistoryTable();
    };
  });
};

/**
 * Renders the item price history table in the Settings > Activity Log > Price History sub-tab.
 */
const renderItemPriceHistoryTable = () => {
  const table = document.getElementById("settingsPriceHistoryTable");
  if (!table) return;

  const data = preparePriceHistoryRows();
  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  if (data.length === 0) {
    const msg = priceHistoryFilterText
      ? "No items match the current filter."
      : "No item price history recorded yet.";
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    tbody.innerHTML = `<tr class="settings-log-empty"><td colspan="6">${msg}</td></tr>`;
    return;
  }

  const fmt = (v) =>
    typeof formatCurrency === "function" ? formatCurrency(v) : `$${Number(v).toFixed(2)}`;
  const htmlRows = data.map((r) => {
    const ts =
      typeof formatTimestamp === "function"
        ? formatTimestamp(r.ts)
        : new Date(r.ts).toLocaleString();
    const deleteBtn = `<button class="price-history-delete-btn" title="Delete entry" onclick="event.stopPropagation(); deleteItemPriceEntry('${escapeHtml(r.uuid)}', ${r.ts})">&times;</button>`;
    return `<tr><td>${ts}</td><td>${escapeHtml(r.name)}</td><td>${fmt(r.retail)}</td><td>${fmt(r.spot)}</td><td>${fmt(r.melt)}</td><td class="action-cell">${deleteBtn}</td></tr>`;
  });

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  tbody.innerHTML = htmlRows.join("");
  attachPriceHistorySortHeaders(table);
};

/**
 * Reads the filter input value and re-renders the price history table.
 */
const filterItemPriceHistoryTable = () => {
  const input = document.getElementById("priceHistoryFilterInput");
  priceHistoryFilterText = input ? input.value : "";
  renderItemPriceHistoryTable();
};

/**
 * Clears all item price history after user confirmation.
 */
const clearItemPriceHistory = async () => {
  const confirmed =
    typeof showAppConfirm === "function"
      ? await showAppConfirm(
          "Clear all item price history? This cannot be undone.",
          "Price History"
        )
      : false;
  if (!confirmed) return;
  itemPriceHistory = {};
  saveItemPriceHistory();
  const panel = document.getElementById("logPanel_pricehistory");
  if (panel) delete panel.dataset.rendered;
  renderItemPriceHistoryTable();
};

// =============================================================================
// ITEM PRICE HISTORY — PER-ITEM MODAL (STAK-109)
// =============================================================================

/** @type {string} UUID of the item currently displayed in the per-item modal */
let _itemPriceModalUuid = "";
/** @type {string} Filter text for the per-item modal table */
let _itemPriceModalFilterText = "";

/**
 * Opens the per-item price history modal for a specific inventory item.
 * @param {string} uuid - Item UUID
 * @param {string} itemName - Item name for the modal title
 */
const openItemPriceHistoryModal = (uuid, itemName) => {
  _itemPriceModalUuid = uuid;
  _itemPriceModalFilterText = "";

  const titleEl = document.getElementById("itemPriceHistoryTitle");
  if (titleEl) titleEl.textContent = `Price History — ${itemName}`;

  const filterInput = document.getElementById("itemPriceHistoryFilter");
  if (filterInput) filterInput.value = "";

  renderItemPriceHistoryModalTable();

  const modal = document.getElementById("itemPriceHistoryModal");
  if (modal) modal.style.display = "flex";
};

/**
 * Renders the per-item price history modal table.
 * Shows entries only for _itemPriceModalUuid, newest first.
 */
const renderItemPriceHistoryModalTable = () => {
  const table = document.getElementById("itemPriceHistoryTable");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  const data = preparePriceHistoryRows(_itemPriceModalUuid);

  // Apply modal-specific filter
  let filtered = data;
  if (_itemPriceModalFilterText) {
    const f = _itemPriceModalFilterText.toLowerCase();
    filtered = data.filter((r) => {
      const ts =
        typeof formatTimestamp === "function"
          ? formatTimestamp(r.ts)
          : new Date(r.ts).toLocaleString();
      const fmt = (v) =>
        typeof formatCurrency === "function" ? formatCurrency(v) : `$${Number(v).toFixed(2)}`;
      return (
        ts.toLowerCase().includes(f) ||
        fmt(r.retail).includes(f) ||
        fmt(r.spot).includes(f) ||
        fmt(r.melt).includes(f)
      );
    });
  }

  if (filtered.length === 0) {
    const msg = _itemPriceModalFilterText
      ? "No entries match the filter."
      : "No price history for this item.";
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    tbody.innerHTML = `<tr class="settings-log-empty"><td colspan="5">${msg}</td></tr>`;
    return;
  }

  const fmt = (v) =>
    typeof formatCurrency === "function" ? formatCurrency(v) : `$${Number(v).toFixed(2)}`;
  const htmlRows = filtered.map((r) => {
    const ts =
      typeof formatTimestamp === "function"
        ? formatTimestamp(r.ts)
        : new Date(r.ts).toLocaleString();
    const deleteBtn = `<button class="price-history-delete-btn" title="Delete entry" onclick="event.stopPropagation(); deleteItemPriceEntry('${escapeHtml(r.uuid)}', ${r.ts})">&times;</button>`;
    return `<tr><td>${ts}</td><td>${fmt(r.retail)}</td><td>${fmt(r.spot)}</td><td>${fmt(r.melt)}</td><td class="action-cell">${deleteBtn}</td></tr>`;
  });

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  tbody.innerHTML = htmlRows.join("");
};

/**
 * Deletes a single price history entry by UUID and timestamp.
 * Logs the deletion to the change log for undo/redo support.
 * @param {string} uuid - Item UUID
 * @param {number} timestamp - Entry timestamp to delete
 */
const deleteItemPriceEntry = (uuid, timestamp) => {
  if (!itemPriceHistory[uuid]) return;

  const idx = itemPriceHistory[uuid].findIndex((e) => e.ts === timestamp);
  if (idx === -1) return;

  const deletedEntry = itemPriceHistory[uuid][idx];
  itemPriceHistory[uuid].splice(idx, 1);

  // Clean up empty arrays
  if (itemPriceHistory[uuid].length === 0) {
    delete itemPriceHistory[uuid];
  }

  saveItemPriceHistory();

  // Log to change log for undo support
  const item = inventory.find((i) => i.uuid === uuid);
  const snapshotName = getSnapshotItemName(deletedEntry);
  const liveName =
    item && typeof item.name === "string" && item.name.trim() ? item.name.trim() : "";
  const itemName = item
    ? liveName || snapshotName || "Unnamed"
    : snapshotName
      ? `${snapshotName} (deleted)`
      : `(deleted: ${uuid.slice(0, 8)})`;
  if (typeof logChange === "function") {
    logChange(
      itemName,
      "priceHistoryDelete",
      JSON.stringify({ uuid, entry: deletedEntry }),
      null,
      -1
    );
    if (typeof renderChangeLog === "function") renderChangeLog();
  }

  // Re-render both tables
  renderItemPriceHistoryModalTable();
  renderItemPriceHistoryTable();
};

// Ensure global availability
window.applyItemPriceRetention = applyItemPriceRetention;
window.canonicalizeItemPriceHistory = canonicalizeItemPriceHistory;
window.mergeItemPriceHistories = mergeItemPriceHistories;
window.collectAndHashItemPriceHistory = collectAndHashItemPriceHistory;
window.writeItemPriceHistoryStrict = writeItemPriceHistoryStrict;
window.renderItemPriceHistoryTable = renderItemPriceHistoryTable;
window.filterItemPriceHistoryTable = filterItemPriceHistoryTable;
window.clearItemPriceHistory = clearItemPriceHistory;
window.openItemPriceHistoryModal = openItemPriceHistoryModal;
window.renderItemPriceHistoryModalTable = renderItemPriceHistoryModalTable;
window.deleteItemPriceEntry = deleteItemPriceEntry;
window._setItemPriceModalFilter = (val) => {
  _itemPriceModalFilterText = val;
  renderItemPriceHistoryModalTable();
};
