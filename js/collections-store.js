// COLLECTIONS STORE (STRK-368, epic STRK-254)
// =============================================================================
// Storage + inventory seam for the Collections module. js/collections-core.js is
// pure; this file is the only place that touches localStorage, the live
// `inventory` global, and the Series Template bundle. The UI layer talks to
// window.collectionsStore and never to storage directly.
//
// Every mutator runs the core operation, persists only when something actually
// changed, then announces it with a "collections:changed" DOM event so open
// views can re-render without the store knowing who is listening.
//
// MUST load after collections-core.js. data/collections-bundle.js may load in
// any position — it is read lazily, never at parse time.
// =============================================================================

(() => {
  "use strict";

  /** DOM event fired on `document` after the persisted state changes. */
  const CHANGED_EVENT = "collections:changed";

  /** In-memory state; hydrated lazily so load order never matters. */
  let collectionState = null;

  /**
   * The pure core namespace (window.collectionsCore).
   * @returns {Object} Core API
   */
  const core = () => window.collectionsCore;

  /**
   * The live inventory array, or an empty array before boot.
   * @returns {Object[]} Inventory items
   */
  const items = () =>
    typeof inventory !== "undefined" && Array.isArray(inventory) ? inventory : [];

  /**
   * Reads the persisted state into memory.
   * @returns {Object} Normalized Collections state
   */
  const load = () => {
    // Explicit null default: loadDataSync defaults to [] and swallows parse errors.
    const raw =
      typeof loadDataSync === "function" ? loadDataSync(COLLECTION_STATE_KEY, null) : null;
    collectionState = core().normalizeState(raw);
    return collectionState;
  };

  /**
   * The in-memory state, hydrating on first use.
   * @returns {Object} Collections state
   */
  const getState = () => collectionState || load();

  /**
   * Persists the in-memory state and notifies listeners.
   * @returns {boolean} False when the write failed (e.g. quota)
   */
  const save = () => {
    try {
      saveDataSync(COLLECTION_STATE_KEY, getState());
    } catch (error) {
      console.error("[collections] Failed to save collection state:", error);
      return false;
    }
    // Sync seam: once COLLECTION_STATE_KEY joins SYNC_SCOPE_KEYS (with the 4-part cloud-sync
    // contract + collectionsCore.mergeStates), scheduleSyncPush() belongs here.
    document.dispatchEvent(new CustomEvent(CHANGED_EVENT));
    return true;
  };

  /**
   * Runs a core mutation and persists when it reports a change.
   * @param {Object} result - Result object returned by a core mutator
   * @returns {Object} The same result, with ok:false when the save failed
   */
  const commit = (result) => {
    if (result && result.changed && !save())
      return Object.assign({}, result, { ok: false, reason: "save-failed" });
    return result;
  };

  // ---------------------------------------------------------------------------
  // Series Templates
  // ---------------------------------------------------------------------------

  /**
   * All Series Templates from the script-tag bundle, as a null-prototype map.
   * @returns {Object} slug → template
   */
  const getTemplates = () => {
    const bundle = window.__COLLECTIONS_BUNDLE;
    const source =
      bundle && bundle.templates && typeof bundle.templates === "object" ? bundle.templates : {};
    return Object.assign(Object.create(null), source);
  };

  /**
   * One Series Template by slug.
   * @param {string} slug - Template slug
   * @returns {Object|null} Template, or null
   */
  const getTemplate = (slug) => getTemplates()[slug] || null;

  /**
   * The Series Template behind a collection, if it has one.
   * @param {Object} collection - Collection record
   * @returns {Object|null} Template, or null for custom collections
   */
  const templateFor = (collection) =>
    collection && collection.kind === "template" ? getTemplate(collection.templateSlug) : null;

  // ---------------------------------------------------------------------------
  // Inventory predicates
  // ---------------------------------------------------------------------------

  /**
   * Finds an inventory item by UUID.
   * @param {string} uuid - Item UUID
   * @returns {Object|null} Item, or null
   */
  const findItem = (uuid) => items().find((item) => item && item.uuid === uuid) || null;

  /**
   * True when the item exists and is not disposed. Disposed items are always excluded
   * from Collections (no toggle), but stay linked so undoing a disposition restores them.
   * @param {string} uuid - Item UUID
   * @returns {boolean} Whether the item counts toward a slot
   */
  const isActiveUuid = (uuid) => {
    const item = findItem(uuid);
    if (!item) return false;
    return typeof isDisposed === "function" ? !isDisposed(item) : true;
  };

  /**
   * Active (non-disposed) inventory items — the only items the slot picker offers.
   * @returns {Object[]} Active items
   */
  const activeItems = () => items().filter((item) => item && item.uuid && isActiveUuid(item.uuid));

  /**
   * Makes sure an item's UUID is durable before a link depends on it. loadInventory()
   * back-fills a missing uuid IN MEMORY ONLY, so a legacy item that has never been through
   * a saveInventory() gets a different UUID on every boot — a link to it would dangle on
   * reload and the boot sweep would then prune it. Persists the inventory only when the
   * stored copy really lacks this UUID, so the common case adds no write and no sync push.
   * @param {string} uuid - Item UUID about to be linked
   * @returns {void}
   */
  const ensureIdentityPersisted = (uuid) => {
    if (typeof loadDataSync !== "function" || typeof saveInventory !== "function") return;
    const stored = loadDataSync(LS_KEY, []);
    const durable = Array.isArray(stored) && stored.some((item) => item && item.uuid === uuid);
    if (!durable) void saveInventory();
  };

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /**
   * Slot definitions for a collection (custom definition, else its template's slots).
   * @param {Object} collection - Collection record
   * @returns {Object[]} Slot definitions
   */
  const slotDefs = (collection) => core().slotDefsFor(collection, templateFor(collection));

  /**
   * Completion progress for a collection, counting only active items.
   * @param {Object} collection - Collection record
   * @returns {{owned: number, total: number, missing: number, pct: number}} Progress
   */
  const progress = (collection) =>
    core().collectionProgress(collection, slotDefs(collection), isActiveUuid);

  /**
   * Effective contents of one slot (disposed / missing items filtered out).
   * @param {Object} collection - Collection record
   * @param {string} slotId - Slot id
   * @returns {{primary: string|null, spares: string[]}} Effective slot
   */
  const resolveSlot = (collection, slotId) =>
    core().resolveSlot(collection.slots[slotId], isActiveUuid);

  /**
   * Every live collection slot an item occupies.
   * @param {string} uuid - Item UUID
   * @returns {{collectionId: string, slotId: string, role: string}[]} Memberships
   */
  const memberships = (uuid) => core().findMemberships(getState(), uuid);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /**
   * Links an item to a slot. A template-backed collection is created on first use, so
   * "starting" a date run is just linking its first item.
   * @param {string} collectionId - Collection id (a template slug for prebuilt runs)
   * @param {string} slotId - Slot id
   * @param {string} uuid - Item UUID
   * @param {{asSpare?: boolean, replace?: boolean, move?: boolean}} [opts] - Link options
   * @returns {{ok: boolean, changed: boolean, reason?: string}} Result
   */
  const link = (collectionId, slotId, uuid, opts) => {
    const state = getState();
    const existing = state.collections[collectionId];
    let started = false;
    if (!existing || existing.deletedAt) {
      if (!getTemplate(collectionId)) return { ok: false, changed: false, reason: "no-collection" };
      core().ensureCollection(state, {
        id: collectionId,
        kind: "template",
        templateSlug: collectionId,
      });
      started = true;
    }
    const result = core().linkItem(state, collectionId, slotId, uuid, opts);
    if (result.changed) ensureIdentityPersisted(uuid);
    // Starting the collection mutated state even if the link itself was refused.
    if ((result.changed || started) && !save())
      return Object.assign({}, result, { ok: false, reason: "save-failed" });
    return result;
  };

  /**
   * Unlinks an item from a slot. The item stays in the inventory.
   * @param {string} collectionId - Collection id
   * @param {string} slotId - Slot id
   * @param {string} uuid - Item UUID
   * @returns {{ok: boolean, changed: boolean, promoted?: string|null, reason?: string}} Result
   */
  const unlink = (collectionId, slotId, uuid) =>
    commit(core().unlinkItem(getState(), collectionId, slotId, uuid));

  /**
   * Promotes a spare to primary.
   * @param {string} collectionId - Collection id
   * @param {string} slotId - Slot id
   * @param {string} uuid - UUID of the spare
   * @returns {{ok: boolean, changed: boolean, reason?: string}} Result
   */
  const promote = (collectionId, slotId, uuid) =>
    commit(core().promoteSpare(getState(), collectionId, slotId, uuid));

  /**
   * Creates a custom collection with a globally unique id (unique across devices, so
   * two installs can never mint colliding ids ahead of a future sync merge).
   * @param {{name: string, metal?: string, description?: string, clonedFrom?: string, slots: Object[]}} spec - Spec
   * @returns {{ok: boolean, reason?: string, collection?: Object}} Result
   */
  const createCustom = (spec) => {
    const suffix = typeof generateUUID === "function" ? generateUUID() : String(Date.now());
    const result = core().createCustomCollection(
      getState(),
      Object.assign({}, spec, { id: `custom-${suffix}` })
    );
    if (result.ok && !save()) return { ok: false, reason: "save-failed" };
    return result;
  };

  /**
   * Replaces a custom collection's name and slot list.
   * @param {string} collectionId - Collection id
   * @param {{name: string, slots: Object[], metal?: string, description?: string}} spec - New definition
   * @returns {{ok: boolean, changed?: boolean, reason?: string}} Result
   */
  const updateCustom = (collectionId, spec) =>
    commit(core().updateCustomDefinition(getState(), collectionId, spec));

  /**
   * Removes (soft-deletes) a collection. Items are never touched.
   * @param {string} collectionId - Collection id
   * @returns {{ok: boolean, changed: boolean, reason?: string}} Result
   */
  const remove = (collectionId) => commit(core().removeCollection(getState(), collectionId));

  /**
   * Drops every link to an item — called when the Item is hard-deleted.
   * @param {string} uuid - Item UUID
   * @returns {{changed: boolean, removed: Object[]}} Slots that were touched
   */
  const pruneItem = (uuid) => commit(core().pruneItem(getState(), uuid));

  /**
   * Boot-time sweep of links to items that no longer exist (bulk delete and import
   * paths do not run the per-item delete hook). Refuses to run against an inventory it
   * cannot trust: an empty inventory or an active recovery hold would otherwise read as
   * "every item is gone" and wipe every link.
   * @returns {{changed: boolean, removed: number, skipped?: string}} Sweep outcome
   */
  const sweep = () => {
    if (typeof isInventoryRecoveryActive === "function" && isInventoryRecoveryActive()) {
      return { changed: false, removed: 0, skipped: "recovery-active" };
    }
    const known = new Set(
      items()
        .map((item) => item && item.uuid)
        .filter(Boolean)
    );
    if (!known.size) return { changed: false, removed: 0, skipped: "empty-inventory" };
    return commit(core().sweepDanglingLinks(getState(), known));
  };

  /**
   * Merges another Collections state (a ZIP backup today; a remote device once the sync
   * contract lands) into local state. Uses the commutative core merge, so newer local
   * links are never clobbered by an older snapshot — a restore adds back what was lost.
   * @param {*} incoming - Raw state from a backup or another device (normalized by the merge)
   * @returns {{ok: boolean, changed: boolean, reason?: string}} Result
   */
  const mergeIn = (incoming) => {
    const before = JSON.stringify(getState());
    const merged = core().mergeStates(getState(), incoming);
    if (JSON.stringify(merged) === before) return { ok: true, changed: false };
    collectionState = merged;
    return save()
      ? { ok: true, changed: true }
      : { ok: false, changed: false, reason: "save-failed" };
  };

  // ---------------------------------------------------------------------------
  // Add new item from a slot
  //
  // A slot's "+ Add new item" opens the REAL Add Item modal prefilled, and the item
  // auto-links when it is saved. The pending request lives privately here (no window
  // flags): js/events.js hands the committed UUID to resolvePendingNewItem(), and a
  // MutationObserver drops the request the moment #itemModal closes by ANY path —
  // Cancel, the X, Escape or a backdrop click. Without that, an abandoned request
  // would silently link the next unrelated item the user adds.
  // ---------------------------------------------------------------------------

  /** Slot awaiting a new item from the Add Item modal; null when idle. */
  let pendingNewItem = null;

  /** Observer watching #itemModal for the close that ends a pending request. */
  let pendingObserver = null;

  /**
   * Whether a slot is currently waiting for the Add Item modal.
   * @returns {boolean} True while a request is pending
   */
  const hasPendingNewItem = () => pendingNewItem !== null;

  /**
   * Drops the pending request without linking anything.
   * @returns {void}
   */
  const cancelPendingNewItem = () => {
    pendingNewItem = null;
    if (pendingObserver) pendingObserver.disconnect();
    pendingObserver = null;
  };

  /**
   * Links the freshly committed item to the slot that asked for it.
   * Called from commitItemToInventory (js/events.js) for NEW items only.
   * @param {string} uuid - UUID of the item that was just added
   * @returns {{ok: boolean, changed: boolean, reason?: string}|null} Link result, or null when idle
   */
  const resolvePendingNewItem = (uuid) => {
    if (!pendingNewItem || !uuid) return null;
    const request = pendingNewItem;
    cancelPendingNewItem();
    return link(request.collectionId, request.slotId, uuid, { asSpare: request.asSpare });
  };

  /**
   * Add Item form values for a slot: the Series Template's defaults, or the custom
   * collection's metal plus the slot's own label and year.
   * @param {string} collectionId - Collection id (a template slug works before it is started)
   * @param {string} slotId - Slot id
   * @returns {Object|null} Prefill values, or null when the slot does not exist
   */
  const prefillFor = (collectionId, slotId) => {
    const collection = getState().collections[collectionId] || null;
    const template = collection ? templateFor(collection) : getTemplate(collectionId);
    const defs = collection ? slotDefs(collection) : (template && template.slots) || [];
    const slot = defs.find((def) => def.id === slotId);
    if (!slot) return null;
    const year = slot.year == null ? "" : String(slot.year);
    if (!template) {
      const definition = (collection && collection.definition) || {};
      return { name: slot.label || "", metal: definition.metal || "", year };
    }
    const defaults = template.itemDefaults || {};
    return {
      name: slot.itemName || String(defaults.name || template.name).replace("{year}", year),
      metal: defaults.metal || template.metal,
      type: defaults.type || template.itemType,
      weight: defaults.weight == null ? template.weight : defaults.weight,
      weightUnit: defaults.weightUnit || template.weightUnit,
      purity: defaults.purity == null ? template.purity : defaults.purity,
      numistaId: defaults.numistaId || "",
      year,
    };
  };

  /** Weight units whose form entry is a denomination picker rather than a plain number. */
  const DENOMINATION_UNITS = ["gb", "sb", "cu"];

  /**
   * Prefills weight + unit. Plain units are written as the bare number a user would
   * type in add mode. Denomination units (Goldback, Silverback, constitutional) carry
   * picker state that only the form's own populate logic knows how to restore.
   * @param {{weight?: number, weightUnit?: string}} prefill - Values from prefillFor
   * @returns {void}
   */
  const applyWeightPrefill = (prefill) => {
    if (!prefill.weight) return;
    const unit = prefill.weightUnit || "oz";
    if (DENOMINATION_UNITS.includes(unit)) {
      if (typeof _editPopulateWeightFields === "function") {
        _editPopulateWeightFields({ weight: prefill.weight, weightUnit: unit });
      }
      return;
    }
    safeGetElement("itemWeight").value = String(prefill.weight);
    safeGetElement("itemWeightUnit").value = unit;
  };

  /**
   * Writes prefill values into the open Add Item form, in the order the form expects:
   * metal → filter types → type → type-dependent fields → the rest.
   * @param {Object} prefill - Values from prefillFor
   * @returns {void}
   */
  const applyPrefill = (prefill) => {
    const setValue = (id, value) => {
      if (value == null || value === "") return;
      safeGetElement(id).value = String(value);
    };
    setValue("itemMetal", prefill.metal);
    if (typeof filterTypesByMetal === "function") filterTypesByMetal(prefill.metal || "");
    setValue("itemType", prefill.type);
    if (typeof handleTypeChange === "function") handleTypeChange();
    setValue("itemName", prefill.name);
    setValue("itemYear", prefill.year);
    setValue("itemCatalog", prefill.numistaId);
    applyWeightPrefill(prefill);
    if (prefill.purity && typeof _editPopulatePurityField === "function") {
      _editPopulatePurityField({ purity: prefill.purity });
    }
    if (typeof prepareFormSections === "function") prepareFormSections();
  };

  /**
   * Drops the pending request as soon as #itemModal is hidden. No deferral is needed:
   * observer callbacks are microtasks, so they run only after the current call stack
   * unwinds — and a successful save resolves the request (disconnecting this observer)
   * in the same synchronous stack that closes the modal.
   * @returns {void}
   */
  const watchItemModalClose = () => {
    const modal = document.getElementById("itemModal");
    if (!modal || typeof MutationObserver !== "function") return;
    pendingObserver = new MutationObserver(() => {
      if (modal.style.display === "none") cancelPendingNewItem();
    });
    pendingObserver.observe(modal, { attributes: true, attributeFilter: ["style"] });
  };

  /**
   * Opens the Add Item modal prefilled for a slot; the saved item links automatically.
   * @param {string} collectionId - Collection id
   * @param {string} slotId - Slot id
   * @param {{asSpare?: boolean}} [opts] - asSpare: link the new item as a spare
   * @returns {{ok: boolean, reason?: string}} Result
   */
  const requestNewItem = (collectionId, slotId, opts) => {
    const prefill = prefillFor(collectionId, slotId);
    if (!prefill) return { ok: false, reason: "no-slot" };
    const opener = document.getElementById("newItemBtn");
    if (!opener) return { ok: false, reason: "no-form" };
    cancelPendingNewItem();
    // The button's own handler resets the form, applies add-mode defaults and opens the modal.
    opener.click();
    applyPrefill(prefill);
    pendingNewItem = { collectionId, slotId, asSpare: Boolean(opts && opts.asSpare) };
    watchItemModalClose();
    return { ok: true };
  };

  // ---------------------------------------------------------------------------
  // Global exposure
  // ---------------------------------------------------------------------------
  window.collectionsStore = Object.freeze({
    CHANGED_EVENT,
    load,
    getState,
    save,
    getTemplates,
    getTemplate,
    templateFor,
    findItem,
    isActiveUuid,
    activeItems,
    slotDefs,
    progress,
    resolveSlot,
    memberships,
    link,
    unlink,
    promote,
    createCustom,
    updateCustom,
    remove,
    pruneItem,
    sweep,
    mergeIn,
    requestNewItem,
    hasPendingNewItem,
    resolvePendingNewItem,
    cancelPendingNewItem,
  });
})();
