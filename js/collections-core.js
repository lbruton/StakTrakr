// COLLECTIONS CORE (STRK-368, epic STRK-254)
// =============================================================================
// Pure, DOM-free data layer for the Collections module: a checklist/album layer
// over the inventory. No storage, no DOM, no other app globals — every function
// takes the state it works on, so the whole file runs unchanged in the browser
// and in the Node unit harness (tests/unit/collections-core.test.js).
//
// STATE SHAPE (persisted under COLLECTION_STATE_KEY by js/collections-store.js)
//   { schema, collections: { <collectionId> → collection } }
//   collection = { id, kind: "template"|"custom", templateSlug, name, createdAt,
//                  metaModified, lastModified, deletedAt, clonedFrom, definition,
//                  slots: { <slotId> → { primary, spares[], modified } },
//                  artwork: { cover|slot:<slotId> → { present, modified } } }
//
// DESIGN RULES
//   - Links live on the Collection, never on the Item: zero new item fields, so no
//     enumeration blast radius (DIFF_FIELDS, changeLog, inventory hash — STRK-235).
//   - Every map keyed by a runtime string is null-prototype. Slot ids in custom
//     collections are user-authored, and "constructor" is a legal label.
//   - An emptied slot becomes a TOMBSTONE ({ primary: null }) and a removed
//     collection keeps a deletedAt stamp. A missing key cannot say "unlinked",
//     so without tombstones an unlink could never beat an older link in a merge.
//   - metaModified (rename / definition / delete) is tracked apart from
//     lastModified (any activity) so a rename is not lost to later slot activity
//     on another device.
//   - mergeStates is commutative and idempotent, including on timestamp ties
//     (STRK-154 convergence invariant — see .context/cloud-sync-convergence.md).
// =============================================================================

(() => {
  "use strict";

  /** Persisted schema version; normalizeState is the migration seam. */
  const SCHEMA_VERSION = 1;

  /** A slot holds one primary plus up to this many ADDITIONAL spare items. */
  const MAX_SLOT_SPARES = 3;

  /** Longest slot id slugifySlotId will emit before the de-dupe suffix. */
  const MAX_SLOT_ID_LENGTH = 64;

  /** Relative tolerance when comparing an item's weight to a template's. */
  const WEIGHT_TOLERANCE = 0.002;

  const SCORE_NAME = 60;
  const SCORE_ABBREVIATION = 40;
  const SCORE_KEYWORD_PHRASE = 30;
  const SCORE_KEYWORD = 20;
  const SCORE_YEAR = 25;
  const SCORE_VARIANT = 15;

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  /**
   * True for a non-empty string — the only legal shape for an id or uuid.
   * @param {*} value - Candidate id
   * @returns {boolean} Whether the value is a usable id
   */
  const isId = (value) => typeof value === "string" && value.length > 0;

  /**
   * True for a plain (non-array, non-null) object.
   * @param {*} value - Candidate object
   * @returns {boolean} Whether the value is a plain object
   */
  const isPlainObject = (value) =>
    value != null && typeof value === "object" && !Array.isArray(value);

  /**
   * Coerces a value to a trimmed string ("" for null/undefined).
   * @param {*} value - Value to coerce
   * @returns {string} Trimmed string
   */
  const text = (value) => String(value == null ? "" : value).trim();

  /**
   * Resolves the timestamp for a mutation: the injected `now` (tests, merges) or the clock.
   * @param {{now?: string}} [opts] - Options carrying an optional ISO timestamp
   * @returns {string} ISO-8601 timestamp
   */
  const nowIso = (opts) => (opts && isId(opts.now) ? opts.now : new Date().toISOString());

  /**
   * Returns the later of two ISO timestamps (same-format ISO strings order lexically).
   * @param {string} a - First timestamp (may be empty)
   * @param {string} b - Second timestamp (may be empty)
   * @returns {string} The later timestamp
   */
  const laterOf = (a, b) => ((a || "") >= (b || "") ? a || "" : b || "");

  /**
   * Next modification stamp for a record. Strictly monotonic per record: if the clock
   * reads at or before the previous stamp (same-millisecond write, clock stepped back),
   * advance one millisecond past it so a newer local write never ties its own past.
   * @param {string} previous - The record's current stamp (may be empty)
   * @param {string} now - Candidate timestamp
   * @returns {string} A stamp strictly later than `previous`
   */
  const nextStamp = (previous, now) => {
    if (!previous || now > previous) return now;
    const parsed = Date.parse(previous);
    return Number.isFinite(parsed) ? new Date(parsed + 1).toISOString() : now;
  };

  /**
   * Deterministic JSON: object keys sorted, array order preserved. Used only to break
   * timestamp ties symmetrically during a merge.
   * @param {*} value - Value to serialize
   * @returns {string} Canonical JSON string
   */
  const stableStringify = (value) => {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (isPlainObject(value)) {
      const body = Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
      return `{${body.join(",")}}`;
    }
    return JSON.stringify(value === undefined ? null : value);
  };

  /**
   * Escapes a string for literal use inside a RegExp.
   * @param {string} value - Raw text
   * @returns {string} Regex-safe text
   */
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /**
   * True when `phrase` occurs in `haystack` as a whole token (not inside a longer
   * alphanumeric run). Spaces in the phrase match any run of whitespace, so "type 2"
   * also matches "type2". Avoids lookbehind, which older Safari cannot parse.
   * @param {string} haystack - Lower-cased text to search
   * @param {string} phrase - Lower-cased token or phrase
   * @returns {boolean} Whether the phrase appears as a whole token
   */
  const hasToken = (haystack, phrase) => {
    const body = escapeRegex(text(phrase).toLowerCase()).replace(/\s+/g, "\\s*");
    if (!body) return false;
    return new RegExp(`(^|[^a-z0-9])${body}($|[^a-z0-9])`).test(haystack);
  };

  // ---------------------------------------------------------------------------
  // State construction + normalization
  // ---------------------------------------------------------------------------

  /**
   * Creates an empty Collections state.
   * @returns {{schema: number, collections: Object}} Fresh state
   */
  const createEmptyState = () => ({ schema: SCHEMA_VERSION, collections: Object.create(null) });

  /**
   * Single constructor for a collection record, so records built by ensureCollection,
   * createCustomCollection, normalizeState and mergeStates always share one shape.
   * @param {Object} fields - Collection fields
   * @returns {Object} Collection record with a null-prototype slots map
   */
  const makeCollection = (fields) => ({
    id: fields.id,
    kind: fields.kind === "custom" ? "custom" : "template",
    templateSlug: fields.templateSlug == null ? null : fields.templateSlug,
    name: fields.name || "",
    createdAt: fields.createdAt || "",
    metaModified: fields.metaModified || "",
    lastModified: fields.lastModified || "",
    deletedAt: fields.deletedAt == null ? null : fields.deletedAt,
    clonedFrom: fields.clonedFrom == null ? null : fields.clonedFrom,
    definition: fields.definition == null ? null : fields.definition,
    slots: fields.slots || Object.create(null),
    artwork: fields.artwork || Object.create(null),
  });

  /**
   * Normalizes one persisted slot link. Enforces the slot invariants: string ids only,
   * no duplicates, the primary never repeated as a spare, spares capped, and a slot
   * with spares but no primary promotes its first spare.
   * @param {*} raw - Persisted link
   * @returns {{primary: string|null, spares: string[], modified: string}|null} Clean link, or null
   */
  const normalizeLink = (raw) => {
    if (!isPlainObject(raw)) return null;
    let primary = isId(raw.primary) ? raw.primary : null;
    const seen = new Set(primary ? [primary] : []);
    const spares = [];
    (Array.isArray(raw.spares) ? raw.spares : []).forEach((uuid) => {
      if (!isId(uuid) || seen.has(uuid)) return;
      seen.add(uuid);
      spares.push(uuid);
    });
    if (!primary && spares.length) primary = spares.shift();
    return {
      primary,
      spares: spares.slice(0, MAX_SLOT_SPARES),
      modified: isId(raw.modified) ? raw.modified : "",
    };
  };

  /**
   * Normalizes a custom collection's definition (metal, description, side, slot list).
   * @param {*} raw - Persisted definition
   * @returns {{metal: string, description: string, side: string, slots: Object[]}} Clean definition
   */
  const normalizeDefinition = (raw) => {
    const source = isPlainObject(raw) ? raw : {};
    const seen = new Set();
    const slots = [];
    (Array.isArray(source.slots) ? source.slots : []).forEach((slot) => {
      if (!isPlainObject(slot) || !isId(slot.id) || seen.has(slot.id)) return;
      seen.add(slot.id);
      slots.push({
        id: slot.id,
        label: text(slot.label),
        year: text(slot.year),
        note: text(slot.note),
      });
    });
    return {
      metal: text(source.metal),
      description: text(source.description),
      side: source.side === "reverse" ? "reverse" : "obverse",
      slots,
    };
  };

  /**
   * Normalizes one persisted collection. A record whose stored id disagrees with its
   * map key is rejected rather than repaired — it signals corrupt or hand-edited data.
   * @param {string} key - Map key the record was stored under
   * @param {*} raw - Persisted collection
   * @returns {Object|null} Clean collection, or null to drop it
   */
  const normalizeCollection = (key, raw) => {
    if (!isPlainObject(raw) || raw.id !== key) return null;
    const kind = raw.kind === "custom" ? "custom" : "template";
    const slots = Object.create(null);
    const rawSlots = isPlainObject(raw.slots) ? raw.slots : {};
    Object.keys(rawSlots).forEach((slotId) => {
      const link = normalizeLink(rawSlots[slotId]);
      if (link) slots[slotId] = link;
    });
    const artwork = Object.create(null);
    const rawArtwork = isPlainObject(raw.artwork) ? raw.artwork : {};
    Object.keys(rawArtwork).forEach((artworkKey) => {
      const entry = rawArtwork[artworkKey];
      if (isPlainObject(entry) && isId(entry.modified)) {
        artwork[artworkKey] = {
          present: entry.present === true,
          modified: entry.modified,
          digest: isId(entry.digest) ? entry.digest : "",
        };
      }
    });
    const createdAt = isId(raw.createdAt) ? raw.createdAt : "";
    const lastModified = isId(raw.lastModified) ? raw.lastModified : createdAt;
    const templateFallback = kind === "template" ? key : null;
    return makeCollection({
      id: key,
      kind,
      templateSlug: isId(raw.templateSlug) ? raw.templateSlug : templateFallback,
      name: text(raw.name),
      createdAt,
      metaModified: isId(raw.metaModified) ? raw.metaModified : lastModified,
      lastModified,
      deletedAt: isId(raw.deletedAt) ? raw.deletedAt : null,
      clonedFrom: isId(raw.clonedFrom) ? raw.clonedFrom : null,
      definition:
        kind === "custom" && raw.definition != null ? normalizeDefinition(raw.definition) : null,
      slots,
      artwork,
    });
  };

  /** Stamps an artwork upload or removal; a removal remains as a merge tombstone. */
  const setArtwork = (state, collectionId, slotId, present, opts) => {
    const collection = liveCollection(state, collectionId);
    if (!collection) return { ok: false, changed: false, reason: "no-collection" };
    const key = slotId == null ? "cover" : `slot:${slotId}`;
    const previous = collection.artwork[key];
    const modified = nextStamp(previous ? previous.modified : "", nowIso(opts));
    collection.artwork[key] = {
      present: present === true,
      modified,
      digest: present && isId(opts && opts.digest) ? opts.digest : "",
    };
    collection.lastModified = laterOf(collection.lastModified, modified);
    return { ok: true, changed: true };
  };

  /** Whether a Collection image record is current under merged artwork stamps. */
  const isCurrentArtwork = (state, ruleId, cachedAt, digest) => {
    if (!isId(ruleId) || !ruleId.startsWith("collection--")) return true;
    for (const collectionId of Object.keys((state && state.collections) || {})) {
      const prefix = `collection--${collectionId}`;
      if (ruleId !== prefix && !ruleId.startsWith(`${prefix}--`)) continue;
      const collection = state.collections[collectionId];
      if (collection.deletedAt) return false;
      const key = ruleId === prefix ? "cover" : `slot:${ruleId.slice(prefix.length + 2)}`;
      const entry = collection.artwork[key];
      if (!entry) return true; // pre-stamp beta images
      if (!entry.present) return false;
      const stamp = typeof cachedAt === "number" ? cachedAt : Date.parse(cachedAt);
      if (!Number.isFinite(stamp) || new Date(stamp).toISOString() < entry.modified) return false;
      // Equal-time uploads can differ across devices. The stamp's content token
      // selects one image in either merge order; older unstamped art remains valid.
      return !entry.digest || entry.digest === digest;
    }
    return false; // orphaned Custom Collection artwork
  };

  /**
   * Rehydrates persisted JSON (or anything else) into a well-formed state with
   * null-prototype maps. Never throws and never mutates its input.
   * @param {*} raw - Value read from storage, a vault, or a remote device
   * @returns {{schema: number, collections: Object}} Clean state
   */
  const normalizeState = (raw) => {
    const state = createEmptyState();
    if (!isPlainObject(raw) || !isPlainObject(raw.collections)) return state;
    Object.keys(raw.collections).forEach((key) => {
      const collection = normalizeCollection(key, raw.collections[key]);
      if (collection) state.collections[key] = collection;
    });
    return state;
  };

  // ---------------------------------------------------------------------------
  // Collection lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Returns a collection only if it exists and is not deleted.
   * @param {Object} state - Collections state
   * @param {string} collectionId - Collection id
   * @returns {Object|null} Live collection, or null
   */
  const liveCollection = (state, collectionId) => {
    const collection =
      isId(collectionId) && state && state.collections ? state.collections[collectionId] : null;
    return collection && !collection.deletedAt ? collection : null;
  };

  /**
   * Lists live (non-deleted) collections, oldest first.
   * @param {Object} state - Collections state
   * @returns {Object[]} Live collections
   */
  const listCollections = (state) =>
    Object.keys((state && state.collections) || {})
      .map((id) => state.collections[id])
      .filter((collection) => collection && !collection.deletedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  /**
   * Returns the collection with this id, creating it if absent and reviving it if it
   * was deleted. Idempotent for a live collection.
   * @param {Object} state - Collections state
   * @param {{id: string, kind?: string, templateSlug?: string, name?: string, now?: string}} spec - Collection spec
   * @returns {Object|null} The live collection, or null for an invalid id
   */
  const ensureCollection = (state, spec) => {
    if (!spec || !isId(spec.id)) return null;
    const now = nowIso(spec);
    const existing = state.collections[spec.id];
    if (existing && !existing.deletedAt) return existing;
    if (existing) {
      existing.deletedAt = null;
      existing.metaModified = nextStamp(existing.metaModified, now);
      existing.lastModified = laterOf(existing.lastModified, existing.metaModified);
      return existing;
    }
    const kind = spec.kind === "custom" ? "custom" : "template";
    const created = makeCollection({
      id: spec.id,
      kind,
      templateSlug: kind === "template" ? spec.templateSlug || spec.id : null,
      name: text(spec.name),
      createdAt: now,
      metaModified: now,
      lastModified: now,
    });
    state.collections[spec.id] = created;
    return created;
  };

  /**
   * Soft-deletes a collection (tombstone kept so the deletion can win a merge).
   * @param {Object} state - Collections state
   * @param {string} collectionId - Collection id
   * @param {{now?: string}} [opts] - Options
   * @returns {{ok: boolean, changed: boolean, reason?: string}} Result
   */
  const removeCollection = (state, collectionId, opts) => {
    const collection = liveCollection(state, collectionId);
    if (!collection) return { ok: false, changed: false, reason: "no-collection" };
    collection.metaModified = nextStamp(collection.metaModified, nowIso(opts));
    collection.deletedAt = collection.metaModified;
    collection.lastModified = laterOf(collection.lastModified, collection.metaModified);
    return { ok: true, changed: true };
  };

  /**
   * Builds a storage-safe, human-meaningful slot id from a label. Ids must survive
   * export → import across browsers, so they are semantic, never random.
   * @param {string} label - Slot label (e.g. "1881-CC")
   * @param {Iterable<string>} takenIds - Ids already used in this collection
   * @returns {string} Unique slot id (e.g. "1881-cc", "1881-cc-2")
   */
  const slugifySlotId = (label, takenIds) => {
    const base =
      text(label)
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_SLOT_ID_LENGTH)
        .replace(/-+$/g, "") || "slot";
    const taken = new Set(takenIds || []);
    if (!taken.has(base)) return base;
    let suffix = 2;
    while (taken.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  };

  /**
   * Builds definition slots from user input, keeping any id that already exists in
   * `keepIds` (so a rename keeps its links) and minting ids for the rest.
   * @param {Object[]} inputSlots - Raw slot inputs: { id?, label, year?, note? }
   * @param {Set<string>} keepIds - Ids that may be carried over unchanged
   * @returns {Object[]} Definition slots: { id, label, year, note }
   */
  const buildDefinitionSlots = (inputSlots, keepIds) => {
    const taken = new Set();
    return inputSlots.filter(isPlainObject).map((input) => {
      const carried = isId(input.id) && keepIds.has(input.id) && !taken.has(input.id);
      const id = carried ? input.id : slugifySlotId(input.label, taken);
      taken.add(id);
      return { id, label: text(input.label), year: text(input.year), note: text(input.note) };
    });
  };

  /**
   * Validates the name + slot inputs shared by create and update.
   * @param {{name?: string, slots?: Object[]}} spec - Custom collection spec
   * @returns {string|null} Failure reason, or null when valid
   */
  const customSpecError = (spec) => {
    if (!text(spec && spec.name)) return "invalid-name";
    if (!spec || !Array.isArray(spec.slots) || !spec.slots.filter(isPlainObject).length)
      return "no-slots";
    return null;
  };

  /**
   * Creates a custom collection (blank checklist or a clone of a template).
   * @param {Object} state - Collections state
   * @param {{id: string, name: string, metal?: string, description?: string, clonedFrom?: string,
   *   slots: Object[], now?: string}} spec - Custom collection spec
   * @returns {{ok: boolean, reason?: string, collection?: Object}} Result
   */
  const createCustomCollection = (state, spec) => {
    const error = customSpecError(spec);
    if (error) return { ok: false, reason: error };
    if (!isId(spec.id)) return { ok: false, reason: "invalid" };
    if (state.collections[spec.id]) return { ok: false, reason: "exists" };
    const now = nowIso(spec);
    const collection = makeCollection({
      id: spec.id,
      kind: "custom",
      templateSlug: null,
      name: text(spec.name),
      createdAt: now,
      metaModified: now,
      lastModified: now,
      clonedFrom: isId(spec.clonedFrom) ? spec.clonedFrom : null,
      definition: {
        metal: text(spec.metal),
        description: text(spec.description),
        side: spec.side === "reverse" ? "reverse" : "obverse",
        slots: buildDefinitionSlots(spec.slots, new Set()),
      },
    });
    state.collections[spec.id] = collection;
    return { ok: true, collection };
  };

  /**
   * Replaces a custom collection's name and slot list. Slots that keep their id keep
   * their links; links in slots that were removed are tombstoned.
   * @param {Object} state - Collections state
   * @param {string} collectionId - Collection id
   * @param {{name: string, slots: Object[], metal?: string, description?: string, side?: string, now?: string}} spec - New definition
   * @returns {{ok: boolean, changed?: boolean, reason?: string}} Result
   */
  const updateCustomDefinition = (state, collectionId, spec) => {
    const collection = liveCollection(state, collectionId);
    if (!collection) return { ok: false, reason: "no-collection" };
    if (collection.kind !== "custom") return { ok: false, reason: "not-custom" };
    const error = customSpecError(spec);
    if (error) return { ok: false, reason: error };

    const previous = collection.definition || {
      metal: "",
      description: "",
      side: "obverse",
      slots: [],
    };
    const slots = buildDefinitionSlots(spec.slots, new Set(previous.slots.map((slot) => slot.id)));
    const stamp = nextStamp(collection.metaModified, nowIso(spec));
    const kept = new Set(slots.map((slot) => slot.id));
    Object.keys(collection.slots).forEach((slotId) => {
      const link = collection.slots[slotId];
      if (kept.has(slotId) || !link.primary) return;
      collection.slots[slotId] = {
        primary: null,
        spares: [],
        modified: nextStamp(link.modified, stamp),
      };
    });
    previous.slots.forEach((slot) => {
      if (!kept.has(slot.id)) setArtwork(state, collectionId, slot.id, false, { now: stamp });
    });
    collection.name = text(spec.name);
    collection.definition = {
      metal: spec.metal == null ? previous.metal : text(spec.metal),
      description: spec.description == null ? previous.description : text(spec.description),
      side:
        spec.side == null
          ? previous.side || "obverse"
          : spec.side === "reverse"
            ? "reverse"
            : "obverse",
      slots,
    };
    collection.metaModified = stamp;
    collection.lastModified = laterOf(collection.lastModified, stamp);
    return { ok: true, changed: true };
  };

  /**
   * Slot definitions for a collection: its own definition when custom, otherwise the
   * Series Template's slots.
   * @param {Object} collection - Collection record
   * @param {{slots?: Object[]}|null} template - Series Template, if any
   * @returns {Object[]} Slot definitions (each has at least an `id`)
   */
  const slotDefsFor = (collection, template) => {
    if (collection && collection.kind === "custom" && collection.definition)
      return collection.definition.slots;
    return template && Array.isArray(template.slots) ? template.slots : [];
  };

  // ---------------------------------------------------------------------------
  // Linking
  // ---------------------------------------------------------------------------

  /**
   * Finds the slot an item occupies within one collection.
   * @param {Object} collection - Collection record
   * @param {string} uuid - Item UUID
   * @returns {{slotId: string, role: "primary"|"spare"}|null} Location, or null
   */
  const locateUuid = (collection, uuid) => {
    const slotIds = Object.keys(collection.slots);
    for (let i = 0; i < slotIds.length; i += 1) {
      const link = collection.slots[slotIds[i]];
      if (link.primary === uuid) return { slotId: slotIds[i], role: "primary" };
      if (link.spares.includes(uuid)) return { slotId: slotIds[i], role: "spare" };
    }
    return null;
  };

  /**
   * Removes an item from a slot, promoting the first spare when the primary leaves.
   * @param {Object} collection - Collection record
   * @param {string} slotId - Slot id
   * @param {string} uuid - Item UUID
   * @param {string} now - Timestamp for the mutation
   * @returns {{removed: boolean, promoted: string|null}} What happened
   */
  const removeFromSlot = (collection, slotId, uuid, now) => {
    const link = collection.slots[slotId];
    if (!link) return { removed: false, promoted: null };
    let promoted = null;
    if (link.primary === uuid) {
      promoted = link.spares.length ? link.spares.shift() : null;
      link.primary = promoted;
    } else if (link.spares.includes(uuid)) {
      link.spares = link.spares.filter((spare) => spare !== uuid);
    } else {
      return { removed: false, promoted: null };
    }
    link.modified = nextStamp(link.modified, now);
    collection.lastModified = laterOf(collection.lastModified, link.modified);
    return { removed: true, promoted };
  };

  /**
   * Decides how an item would enter a target slot, without mutating anything.
   * @param {Object|undefined} link - Current link in the target slot
   * @param {{asSpare?: boolean, replace?: boolean}} opts - Link options
   * @returns {"primary"|"spare"|"replace"|"occupied"|"spares-full"} Planned action
   */
  const planEntry = (link, opts) => {
    if (!link || !link.primary) return "primary";
    if (opts.asSpare) return link.spares.length >= MAX_SLOT_SPARES ? "spares-full" : "spare";
    return opts.replace ? "replace" : "occupied";
  };

  /**
   * Links an item to a slot. An item fills at most one slot per collection.
   * @param {Object} state - Collections state
   * @param {string} collectionId - Collection id
   * @param {string} slotId - Slot id
   * @param {string} uuid - Item UUID
   * @param {{asSpare?: boolean, replace?: boolean, move?: boolean, now?: string}} [options] - asSpare: add as a
   *   spare (fills the primary when the slot is empty); replace: swap out the current primary; move: relocate an
   *   item that already sits in another slot of this collection
   * @returns {{ok: boolean, changed: boolean, reason?: string, slotId?: string}} Result
   */
  const linkItem = (state, collectionId, slotId, uuid, options) => {
    const opts = options || {};
    const fail = (reason, extra) => Object.assign({ ok: false, changed: false, reason }, extra);
    if (!isId(slotId) || !isId(uuid)) return fail("invalid");
    const collection = liveCollection(state, collectionId);
    if (!collection) return fail("no-collection");

    const current = locateUuid(collection, uuid);
    if (current && current.slotId === slotId) {
      return current.role === "primary" || opts.asSpare
        ? { ok: true, changed: false }
        : fail("already-linked", { slotId });
    }
    if (current && !opts.move) return fail("already-linked", { slotId: current.slotId });

    const action = planEntry(collection.slots[slotId], opts);
    if (action === "occupied" || action === "spares-full") return fail(action);

    const now = nowIso(opts);
    if (current) removeFromSlot(collection, current.slotId, uuid, now);
    const link = collection.slots[slotId] || { primary: null, spares: [], modified: "" };
    if (action === "spare") link.spares.push(uuid);
    else link.primary = uuid;
    link.modified = nextStamp(link.modified, now);
    collection.slots[slotId] = link;
    collection.lastModified = laterOf(collection.lastModified, link.modified);
    return { ok: true, changed: true };
  };

  /**
   * Unlinks an item from a slot. The item itself is untouched.
   * @param {Object} state - Collections state
   * @param {string} collectionId - Collection id
   * @param {string} slotId - Slot id
   * @param {string} uuid - Item UUID
   * @param {{now?: string}} [opts] - Options
   * @returns {{ok: boolean, changed: boolean, promoted?: string|null, reason?: string}} Result
   */
  const unlinkItem = (state, collectionId, slotId, uuid, opts) => {
    const collection = liveCollection(state, collectionId);
    if (!collection) return { ok: false, changed: false, reason: "no-collection" };
    const outcome = removeFromSlot(collection, slotId, uuid, nowIso(opts));
    if (!outcome.removed) return { ok: false, changed: false, reason: "not-linked" };
    return { ok: true, changed: true, promoted: outcome.promoted };
  };

  /**
   * Promotes a spare to primary; the old primary becomes the first spare.
   * @param {Object} state - Collections state
   * @param {string} collectionId - Collection id
   * @param {string} slotId - Slot id
   * @param {string} uuid - UUID of the spare to promote
   * @param {{now?: string}} [opts] - Options
   * @returns {{ok: boolean, changed: boolean, reason?: string}} Result
   */
  const promoteSpare = (state, collectionId, slotId, uuid, opts) => {
    const collection = liveCollection(state, collectionId);
    if (!collection) return { ok: false, changed: false, reason: "no-collection" };
    const link = collection.slots[slotId];
    if (link && link.primary === uuid) return { ok: true, changed: false };
    if (!link || !link.spares.includes(uuid))
      return { ok: false, changed: false, reason: "not-linked" };
    link.spares = [link.primary, ...link.spares.filter((spare) => spare !== uuid)].filter(isId);
    link.primary = uuid;
    link.modified = nextStamp(link.modified, nowIso(opts));
    collection.lastModified = laterOf(collection.lastModified, link.modified);
    return { ok: true, changed: true };
  };

  /**
   * Removes an item from every collection — call when an Item is hard-deleted.
   * @param {Object} state - Collections state
   * @param {string} uuid - Item UUID
   * @param {{now?: string}} [opts] - Options
   * @returns {{changed: boolean, removed: {collectionId: string, slotId: string}[]}} Slots that were touched
   */
  const pruneItem = (state, uuid, opts) => {
    const removed = [];
    if (!isId(uuid)) return { changed: false, removed };
    const now = nowIso(opts);
    Object.keys(state.collections).forEach((collectionId) => {
      const collection = state.collections[collectionId];
      const found = locateUuid(collection, uuid);
      if (found && removeFromSlot(collection, found.slotId, uuid, now).removed) {
        removed.push({ collectionId, slotId: found.slotId });
      }
    });
    return { changed: removed.length > 0, removed };
  };

  /**
   * Drops links to items that no longer exist. DESTRUCTIVE: callers must only pass a
   * fully loaded inventory's UUIDs — never an empty or recovery-mode inventory.
   * @param {Object} state - Collections state
   * @param {Set<string>} knownUuids - UUIDs of every item that still exists
   * @param {{now?: string}} [opts] - Options
   * @returns {{changed: boolean, removed: number}} Count of dropped links
   */
  const sweepDanglingLinks = (state, knownUuids, opts) => {
    if (!knownUuids || typeof knownUuids.has !== "function") return { changed: false, removed: 0 };
    const now = nowIso(opts);
    let removed = 0;
    Object.keys(state.collections).forEach((collectionId) => {
      const collection = state.collections[collectionId];
      Object.keys(collection.slots).forEach((slotId) => {
        const link = collection.slots[slotId];
        [link.primary, ...link.spares].filter(isId).forEach((uuid) => {
          if (!knownUuids.has(uuid) && removeFromSlot(collection, slotId, uuid, now).removed)
            removed += 1;
        });
      });
    });
    return { changed: removed > 0, removed };
  };

  // ---------------------------------------------------------------------------
  // Derived views
  // ---------------------------------------------------------------------------

  /**
   * The EFFECTIVE contents of a slot. Disposed (or unknown) items stay linked in
   * storage so undoing a disposition restores the slot, but they never count: the
   * first active item is the effective primary.
   * @param {Object|undefined} link - Stored slot link
   * @param {(uuid: string) => boolean} [isActive] - Predicate for "item exists and is not disposed"
   * @returns {{primary: string|null, spares: string[]}} Effective slot contents
   */
  const resolveSlot = (link, isActive) => {
    if (!link) return { primary: null, spares: [] };
    const accept = typeof isActive === "function" ? isActive : () => true;
    const active = [link.primary, ...link.spares].filter((uuid) => isId(uuid) && accept(uuid));
    return { primary: active.length ? active[0] : null, spares: active.slice(1) };
  };

  /**
   * Completion progress of a collection against its slot definitions.
   * @param {Object} collection - Collection record
   * @param {{id: string}[]} slotDefs - Slot definitions
   * @param {(uuid: string) => boolean} [isActive] - Active-item predicate
   * @returns {{owned: number, total: number, missing: number, pct: number}} Progress
   */
  const collectionProgress = (collection, slotDefs, isActive) => {
    const defs = Array.isArray(slotDefs) ? slotDefs : [];
    const owned = defs.filter(
      (def) => resolveSlot(collection.slots[def.id], isActive).primary
    ).length;
    const total = defs.length;
    return {
      owned,
      total,
      missing: total - owned,
      pct: total ? Math.round((owned / total) * 100) : 0,
    };
  };

  /**
   * Every live slot an item occupies — drives the item view's Collections section.
   * @param {Object} state - Collections state
   * @param {string} uuid - Item UUID
   * @returns {{collectionId: string, slotId: string, role: "primary"|"spare"}[]} Memberships
   */
  const findMemberships = (state, uuid) => {
    if (!isId(uuid)) return [];
    return listCollections(state).reduce((found, collection) => {
      const location = locateUuid(collection, uuid);
      if (location)
        found.push({ collectionId: collection.id, slotId: location.slotId, role: location.role });
      return found;
    }, []);
  };

  // ---------------------------------------------------------------------------
  // Suggestions — name matching only ever SUGGESTS; links are always explicit
  // ---------------------------------------------------------------------------

  /**
   * An item's per-unit weight in troy ounces, for comparison with a template (STRK-398).
   *
   * `item.weight` is already stored in troy oz for every metric/troy display unit — `weightUnit`
   * only picks how it is shown (parseWeight converts on save). The exceptions live in the
   * canonical window.getUnitOztWeight (js/utils.js, STRK-316): Goldback/Silverback store the
   * denomination. Never re-derive the conversion here — a local copy of it was this bug.
   * @param {Object} item - Inventory item
   * @returns {number|null} Per-unit troy oz, or null when the item has no comparable coin weight
   */
  const itemTroyOz = (item) => {
    // Constitutional weight is variant-derived and qty-folded (STRK-235) — never one coin.
    if (text(item.weightUnit).toLowerCase() === "cu") return null;
    // Fail closed: without the canonical helper no unit is trusted as raw ounces.
    if (typeof window.getUnitOztWeight !== "function") return null;
    const ounces = Number(window.getUnitOztWeight(item));
    return Number.isFinite(ounces) && ounces > 0 ? ounces : null;
  };

  /**
   * The item's year of issue: the explicit field, else a 4-digit year found in its name.
   * @param {Object} item - Inventory item
   * @returns {string} Year, or "" when unknown
   */
  const itemYear = (item) => {
    const explicit = text(item.year);
    if (explicit) return explicit;
    const found = /(?:^|\D)((?:1[5-9]|20)\d{2})(?:\D|$)/.exec(text(item.name));
    return found ? found[1] : "";
  };

  /**
   * Scores how well an item's name matches a collection profile.
   * @param {string} lowerName - Lower-cased raw item name
   * @param {string} normalized - Lower-cased normalized item name
   * @param {{names?: string[], abbreviations?: string[], keywords?: string[]}} match - Profile match lists
   * @returns {{score: number, reason: string}|null} Best name match, or null
   */
  const scoreName = (lowerName, normalized, match) => {
    const lists = match || {};
    const lower = (list) =>
      (Array.isArray(list) ? list : []).map((entry) => text(entry).toLowerCase()).filter(Boolean);
    if (lower(lists.names).some((name) => normalized === name || lowerName.includes(name))) {
      return { score: SCORE_NAME, reason: "name" };
    }
    if (lower(lists.abbreviations).some((abbr) => hasToken(lowerName, abbr))) {
      return { score: SCORE_ABBREVIATION, reason: "abbreviation" };
    }
    const keyword = lower(lists.keywords)
      .sort((a, b) => b.length - a.length)
      .find((entry) => lowerName.includes(entry));
    if (!keyword) return null;
    return {
      score: keyword.includes(" ") ? SCORE_KEYWORD_PHRASE : SCORE_KEYWORD,
      reason: "keyword",
    };
  };

  /**
   * True when the item's physical profile (metal, weight) fits the collection.
   * @param {Object} item - Inventory item
   * @param {{metal?: string, weight?: number}} profile - Collection profile
   * @returns {boolean} Whether the item could belong to this collection
   */
  const fitsProfile = (item, profile) => {
    if (profile.metal && text(item.metal).toLowerCase() !== text(profile.metal).toLowerCase())
      return false;
    const target = Number(profile.weight);
    if (!Number.isFinite(target) || target <= 0) return true;
    const ounces = itemTroyOz(item);
    return ounces != null && Math.abs(ounces - target) <= target * WEIGHT_TOLERANCE;
  };

  /**
   * Scores one item against one slot.
   * @param {Object} profile - Collection profile (metal, weight, match lists)
   * @param {{year?: number|string, hints?: {prefer?: string[], reject?: string[]}}} slot - Slot definition
   * @param {Object} item - Inventory item
   * @param {(name: string) => string} normalizeName - Item-name normalizer
   * @returns {{item: Object, score: number, reasons: string[]}|null} Suggestion, or null
   */
  const scoreItem = (profile, slot, item, normalizeName) => {
    if (!fitsProfile(item, profile)) return null;
    const wantsYear = slot.year != null && text(slot.year) !== "";
    if (wantsYear && itemYear(item) !== text(slot.year)) return null;

    const lowerName = text(item.name).toLowerCase();
    const hints = slot.hints || {};
    if ((hints.reject || []).some((phrase) => hasToken(lowerName, phrase))) return null;
    const named = scoreName(lowerName, text(normalizeName(item.name)).toLowerCase(), profile.match);
    if (!named) return null;

    const reasons = [named.reason];
    let score = named.score;
    if (wantsYear) {
      score += SCORE_YEAR;
      reasons.push("year");
    }
    if ((hints.prefer || []).some((phrase) => hasToken(lowerName, phrase))) {
      score += SCORE_VARIANT;
      reasons.push("variant");
    }
    return { item, score, reasons };
  };

  /**
   * Ranks inventory items as candidates for a slot. Callers pass ACTIVE items only —
   * disposed items are never offered.
   * @param {Object} profile - Collection profile: { metal, weight, weightUnit, match }
   * @param {Object} slot - Slot definition: { id, year?, hints? }
   * @param {Object[]} items - Active inventory items
   * @param {{normalizeName?: Function, excludeUuids?: Set<string>}} [options] - normalizeName: the app's
   *   normalizeItemName; excludeUuids: items already linked in this collection
   * @returns {{item: Object, score: number, reasons: string[]}[]} Suggestions, best first
   */
  const suggestItemsForSlot = (profile, slot, items, options) => {
    const opts = options || {};
    const normalizeName = typeof opts.normalizeName === "function" ? opts.normalizeName : text;
    const excluded =
      opts.excludeUuids && typeof opts.excludeUuids.has === "function"
        ? opts.excludeUuids
        : new Set();
    return (Array.isArray(items) ? items : [])
      .filter((item) => item && isId(item.uuid) && !excluded.has(item.uuid))
      .map((item) => scoreItem(profile || {}, slot || {}, item, normalizeName))
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.score - a.score ||
          text(a.item.name).localeCompare(text(b.item.name)) ||
          a.item.uuid.localeCompare(b.item.uuid)
      );
  };

  // ---------------------------------------------------------------------------
  // Merge — commutative + idempotent (STRK-154)
  // ---------------------------------------------------------------------------

  /**
   * Picks between two versions of a record: the later stamp wins; on a tie the
   * canonically greater serialization wins, so the choice is identical in both orders.
   * @param {Object} a - First version
   * @param {Object} b - Second version
   * @param {string} stampA - First version's stamp
   * @param {string} stampB - Second version's stamp
   * @param {(record: Object) => *} project - Extracts the content compared on a tie
   * @returns {Object} The winning version
   */
  const pickWinner = (a, b, stampA, stampB, project) => {
    if (stampA !== stampB) return stampA > stampB ? a : b;
    return stableStringify(project(a)) >= stableStringify(project(b)) ? a : b;
  };

  /**
   * The metadata of a collection — everything except its slots and lastModified.
   * @param {Object} collection - Collection record
   * @returns {Object} Metadata projection
   */
  const metaOf = (collection) => ({
    id: collection.id,
    kind: collection.kind,
    templateSlug: collection.templateSlug,
    name: collection.name,
    createdAt: collection.createdAt,
    metaModified: collection.metaModified,
    deletedAt: collection.deletedAt,
    clonedFrom: collection.clonedFrom,
    definition: collection.definition,
  });

  /**
   * Merges two versions of one collection: metadata by metaModified, slots one by one.
   * @param {Object} a - First version (already normalized)
   * @param {Object} b - Second version (already normalized)
   * @returns {Object} Merged collection
   */
  const mergeCollection = (a, b) => {
    const meta = metaOf(pickWinner(a, b, a.metaModified, b.metaModified, metaOf));
    const slots = Object.create(null);
    new Set([...Object.keys(a.slots), ...Object.keys(b.slots)]).forEach((slotId) => {
      const left = a.slots[slotId];
      const right = b.slots[slotId];
      const winner =
        left && right
          ? pickWinner(left, right, left.modified, right.modified, (link) => link)
          : left || right;
      slots[slotId] = {
        primary: winner.primary,
        spares: winner.spares.slice(),
        modified: winner.modified,
      };
    });
    const artwork = Object.create(null);
    new Set([...Object.keys(a.artwork), ...Object.keys(b.artwork)]).forEach((key) => {
      const left = a.artwork[key];
      const right = b.artwork[key];
      const winner =
        left && right
          ? pickWinner(left, right, left.modified, right.modified, (entry) => ({
              // At an identical timestamp a removal wins regardless of merge order.
              removed: !entry.present,
              digest: entry.digest || "",
            }))
          : left || right;
      artwork[key] = {
        present: winner.present,
        modified: winner.modified,
        digest: winner.digest || "",
      };
    });
    return makeCollection(
      Object.assign({}, meta, {
        lastModified: laterOf(a.lastModified, b.lastModified),
        slots,
        artwork,
      })
    );
  };

  /**
   * Merges two Collections states (e.g. local + remote during cloud sync). Pure:
   * neither input is mutated. mergeStates(a, b) equals mergeStates(b, a), and merging
   * a state with itself — or re-merging a result — changes nothing.
   * @param {*} a - One state (any shape; normalized first)
   * @param {*} b - The other state
   * @returns {{schema: number, collections: Object}} Merged state
   */
  const mergeStates = (a, b) => {
    const left = normalizeState(a);
    const right = normalizeState(b);
    const merged = createEmptyState();
    new Set([...Object.keys(left.collections), ...Object.keys(right.collections)]).forEach((id) => {
      const one = left.collections[id];
      const two = right.collections[id];
      merged.collections[id] = one && two ? mergeCollection(one, two) : one || two;
    });
    return merged;
  };

  // ---------------------------------------------------------------------------
  // Global exposure (script-tag global; the store + UI layers read this namespace)
  // ---------------------------------------------------------------------------
  window.collectionsCore = Object.freeze({
    SCHEMA_VERSION,
    MAX_SLOT_SPARES,
    createEmptyState,
    normalizeState,
    ensureCollection,
    removeCollection,
    setArtwork,
    isCurrentArtwork,
    listCollections,
    slugifySlotId,
    createCustomCollection,
    updateCustomDefinition,
    slotDefsFor,
    linkItem,
    unlinkItem,
    promoteSpare,
    pruneItem,
    sweepDanglingLinks,
    resolveSlot,
    collectionProgress,
    findMemberships,
    itemYear,
    suggestItemsForSlot,
    mergeStates,
  });
})();
