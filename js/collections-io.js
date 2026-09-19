// COLLECTIONS IO (STRK-371, epic STRK-254)
// =============================================================================
// How Collections leave and re-enter the app outside the ZIP / .stvault backups.
// Membership lives on the Collection, never on the Item, so no item-shaped export
// carries it for free:
//
//   Standalone file — the whole state, full fidelity (definitions, empty Custom
//                     Collections, tombstones). Import goes through the commutative
//                     collectionsStore.mergeIn, so it adds back and never clobbers.
//   JSON envelope   — exportJson embeds the same state; importJson hands it back here.
//   CSV column      — a CSV row can only describe an Item, so the "Collections" column
//                     holds that Item's memberships as "collectionId:slotId" pairs
//                     ("…:spare" for a spare), semicolon-joined like Tags. It is ADDITIVE
//                     (a blank cell never unlinks) and cannot recreate a Custom Collection's
//                     definition — the standalone file, JSON and ZIP are the full paths.
//
// MUST load after collections-store.js. Image stamps travel in every full-state export;
// image files travel in ZIP and photo-inclusive encrypted vault backups.
// =============================================================================

(() => {
  "use strict";

  /** Marks a standalone export so an inventory JSON picked by mistake is refused. */
  const FILE_KIND = "staktrakr-collections";
  const PAIR_SEPARATOR = ";";
  const PART_SEPARATOR = ":";
  const SPARE_MARK = "spare";

  /**
   * The Collections store (window.collectionsStore).
   * @returns {Object} Store API
   */
  const store = () => window.collectionsStore;

  /**
   * True when the state holds at least one Collection (live or tombstoned).
   * @param {Object} state - Collections state
   * @returns {boolean} Whether there is anything worth exporting
   */
  const hasCollections = (state) =>
    Boolean(state && state.collections && Object.keys(state.collections).length > 0);

  /**
   * The Collections state for embedding in another export, or null when empty.
   * @returns {Object|null} Collections state
   */
  const exportState = () => {
    const state = store().getState();
    return hasCollections(state) ? state : null;
  };

  /**
   * The standalone export payload.
   * @returns {{kind: string, version: string, exportDate: string, state: Object}} Payload
   */
  const buildPayload = () => ({
    kind: FILE_KIND,
    version: typeof APP_VERSION !== "undefined" ? APP_VERSION : "",
    exportDate: new Date().toISOString(),
    state: store().getState(),
  });

  /**
   * Downloads the standalone Collections file.
   * @returns {void}
   */
  const exportFile = () => {
    const stamp = new Date().toLocaleDateString("en-CA").replace(/-/g, "");
    const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `staktrakr_collections_${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  /**
   * Merges a Collections state that arrived inside another import.
   * @param {*} state - Raw Collections state (normalized by the merge)
   * @returns {{ok: boolean, changed: boolean, reason?: string}} Merge result
   */
  const mergeState = (state) =>
    state && typeof state === "object" ? store().mergeIn(state) : { ok: true, changed: false };

  /**
   * Imports a standalone Collections file.
   * @param {File} file - File picked by the user
   * @returns {Promise<{ok: boolean, changed: boolean, reason?: string}>} Result
   */
  const importFile = async (file) => {
    let payload = null;
    try {
      payload = JSON.parse(await file.text());
    } catch (error) {
      debugLog("collectionsIO.importFile: parse error", error);
      return { ok: false, changed: false, reason: "invalid-json" };
    }
    if (!payload || payload.kind !== FILE_KIND || !payload.state) {
      return { ok: false, changed: false, reason: "not-collections-file" };
    }
    return mergeState(payload.state);
  };

  /**
   * True when an id can be written into a cell without colliding with the separators.
   * @param {string} id - Collection or slot id
   * @returns {boolean} Whether the id is safe to encode
   */
  const encodable = (id) =>
    typeof id === "string" &&
    id.length > 0 &&
    !id.includes(PAIR_SEPARATOR) &&
    !id.includes(PART_SEPARATOR);

  /**
   * The CSV "Collections" cell for one Item.
   * @param {string} uuid - Item UUID
   * @returns {string} Semicolon-joined "collectionId:slotId[:spare]" pairs
   */
  const membershipCell = (uuid) => {
    if (!uuid || !store()) return "";
    return store()
      .memberships(uuid)
      .filter((entry) => encodable(entry.collectionId) && encodable(entry.slotId))
      .map((entry) =>
        [entry.collectionId, entry.slotId]
          .concat(entry.role === "spare" ? [SPARE_MARK] : [])
          .join(PART_SEPARATOR)
      )
      .join(`${PAIR_SEPARATOR} `);
  };

  /**
   * Parses a CSV "Collections" cell.
   * @param {string} cell - Raw cell text
   * @returns {{collectionId: string, slotId: string, asSpare: boolean}[]} Memberships
   */
  const parseMembershipCell = (cell) =>
    String(cell || "")
      .split(PAIR_SEPARATOR)
      .map((pair) => pair.split(PART_SEPARATOR).map((part) => part.trim()))
      .filter((parts) => parts.length >= 2 && parts[0] && parts[1])
      .map((parts) => ({
        collectionId: parts[0],
        slotId: parts[1],
        asSpare: parts[2] === SPARE_MARK,
      }));

  /**
   * Links one Item into one slot. A primary that finds its slot taken becomes a spare
   * rather than being dropped, and an Item already elsewhere in the Collection moves.
   * @param {string} uuid - Item UUID
   * @param {{collectionId: string, slotId: string, asSpare: boolean}} entry - Membership
   * @returns {boolean} Whether a link was written
   */
  /**
   * Applies parsed memberships to Items whose UUIDs are final. Primaries go first so a
   * spare never claims the primary seat of the row that owns it.
   * @param {{uuid: string, entries: Object[]}[]} rows - Item UUID plus parsed memberships
   * @returns {number} How many links were written
   */
  const applyMemberships = (rows) => {
    if (!store() || !Array.isArray(rows)) return 0;
    const flat = [];
    for (const row of rows) {
      if (!row || !row.uuid || !Array.isArray(row.entries)) continue;
      for (const entry of row.entries) flat.push({ uuid: row.uuid, entry });
    }
    const ordered = flat
      .filter((pending) => !pending.entry.asSpare)
      .concat(flat.filter((pending) => pending.entry.asSpare));
    const result = store().linkMemberships(ordered);
    if (!result.ok) throw new Error("Collections could not be saved (storage may be full)");
    return result.count;
  };

  /**
   * Settings → Import Collections: merge the picked file and tell the user what happened.
   * @param {File} file - File picked by the user
   * @returns {Promise<void>} When the import has been reported
   */
  const importFromPicker = async (file) => {
    const result = await importFile(file);
    if (typeof showToast !== "function") return;
    if (result.ok) {
      showToast(result.changed ? "Collections imported" : "Collections already up to date");
    } else if (result.reason === "save-failed") {
      showToast("Collections import failed — storage is full", "error");
    } else {
      showToast("That file is not a StakTrakr Collections export", "error");
    }
  };

  window.collectionsIO = Object.freeze({
    FILE_KIND,
    exportState,
    buildPayload,
    exportFile,
    importFile,
    importFromPicker,
    mergeState,
    membershipCell,
    parseMembershipCell,
    applyMemberships,
  });
})();
