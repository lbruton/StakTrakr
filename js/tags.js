// ITEM TAGS MODULE (STAK-126)
// =============================================================================
// Per-item tagging system: Numista tags (read-only, synced from API) and
// custom user tags (editable). Tags are stored separately from inventory
// items, keyed by UUID, in localStorage under ITEM_TAGS_KEY.
//
// Data shape in localStorage:
//   { "uuid-abc": ["Bullion", "Commemorative"], "uuid-def": ["Proof"] }
// =============================================================================

/**
 * Load item tags from localStorage into the global `itemTags` object.
 */
const loadItemTags = () => {
  try {
    var loaded = loadDataSync(ITEM_TAGS_KEY, {});
    // STAK-421: Repair cascading JSON.stringify corruption — if the stored
    // value was stringified multiple times, loadDataSync returns a string
    // instead of an object. Unwind parse layers until we get an object.
    var repairs = 0;
    while (typeof loaded === "string" && repairs < 20) {
      try {
        loaded = JSON.parse(loaded);
        repairs++;
      } catch (_) {
        break;
      }
    }
    if (repairs > 0) {
      console.warn("[Tags] Repaired", repairs, "layers of stringify corruption");
    }
    itemTags =
      typeof loaded === "object" && loaded !== null && !Array.isArray(loaded) ? loaded : {};
    // Persist the repaired value so the corruption doesn't recur on next sync
    if (repairs > 0) saveItemTags();
  } catch (e) {
    console.error("Failed to load item tags:", e);
    itemTags = {};
  }
};

/**
 * Save the global `itemTags` object to localStorage.
 */
const saveItemTags = () => {
  try {
    // STAK-421: Guard against saving corrupted non-object value — this is the
    // entry point for the cascading stringify corruption (string gets re-stringified).
    if (typeof itemTags !== "object" || itemTags === null || Array.isArray(itemTags)) {
      console.warn("[Tags] saveItemTags blocked — itemTags is not an object:", typeof itemTags);
      itemTags = {};
    }
    saveDataSync(ITEM_TAGS_KEY, itemTags);
    if (typeof scheduleSyncPush === "function") scheduleSyncPush();
  } catch (e) {
    console.error("Failed to save item tags:", e);
  }
};

/**
 * Load per-item tag modification timestamps.
 * @returns {Object<string, number>} Timestamp map keyed by item UUID
 */
const loadTagTimestamps = () => {
  const key =
    typeof ITEM_TAGS_LAST_MODIFIED_KEY !== "undefined"
      ? ITEM_TAGS_LAST_MODIFIED_KEY
      : "itemTagsLastModified";
  const loaded = loadDataSync(key, {});
  return typeof loaded === "object" && loaded !== null && !Array.isArray(loaded) ? loaded : {};
};

/**
 * Save per-item tag modification timestamps without scheduling a sync push.
 * @param {Object<string, number>} map - Timestamp map keyed by item UUID
 */
const saveTagTimestampsDirect = (map) => {
  const key =
    typeof ITEM_TAGS_LAST_MODIFIED_KEY !== "undefined"
      ? ITEM_TAGS_LAST_MODIFIED_KEY
      : "itemTagsLastModified";
  const safeMap = typeof map === "object" && map !== null && !Array.isArray(map) ? map : {};
  try {
    saveDataSync(key, safeMap);
  } catch (e) {
    const isQuota = e?.name === "QuotaExceededError" || e?.code === 22;
    if (typeof showToast === "function")
      showToast(isQuota ? "Tag save failed — storage full" : "Tag save failed");
    console.warn("[Tags] saveDataSync error:", e);
  }
};

/**
 * Stamp tag modification timestamps for one or more item UUIDs.
 * @param {string|string[]} uuids - Item UUID or UUID array
 */
const stampTagTimestamp = (uuids) => {
  const list = Array.isArray(uuids) ? uuids : [uuids];
  const filtered = list.filter((uuid) => typeof uuid === "string" && uuid.trim().length > 0);
  if (filtered.length === 0) return;

  const timestamps = loadTagTimestamps();
  const now = Date.now();
  filtered.forEach((uuid) => {
    timestamps[uuid] = now;
  });
  saveTagTimestampsDirect(timestamps);
};

/**
 * Helper to find an inventory item by UUID for cache invalidation.
 * @param {string} uuid - The item UUID
 * @returns {Object|null} The inventory item or null
 */
const findItemByUuid = (uuid) => {
  if (typeof inventory !== "undefined" && Array.isArray(inventory)) {
    return inventory.find((i) => i.uuid === uuid) || null;
  }
  return null;
};

/**
 * Get all tags for an item.
 * @param {string} uuid - Item UUID
 * @returns {string[]} Array of tag strings (never null)
 */
const getItemTags = (uuid) => {
  if (!uuid || !itemTags[uuid]) return [];
  return [...itemTags[uuid]];
};

/**
 * Add a tag to an item. Prevents duplicates and enforces limits.
 * @param {string} uuid - Item UUID
 * @param {string} tag - Tag name
 * @param {boolean} [persist=true] - Whether to stamp and save to localStorage immediately.
 *   Callers using persist=false must stamp after their batch and before saveItemTags().
 * @returns {boolean} True if tag was added
 */
const addItemTag = (uuid, tag, persist = true) => {
  if (!uuid || !tag) return false;

  const trimmed = tag.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) return false;

  if (!itemTags[uuid]) itemTags[uuid] = [];

  // Prevent duplicates (case-insensitive check)
  const lowerTrimmed = trimmed.toLowerCase();
  if (itemTags[uuid].some((t) => t.toLowerCase() === lowerTrimmed)) return false;

  // Enforce max tags per item
  if (itemTags[uuid].length >= MAX_TAGS_PER_ITEM) return false;

  itemTags[uuid].push(trimmed);

  if (persist) {
    stampTagTimestamp([uuid]);
    clearRemovedTag(uuid, trimmed);
    saveItemTags();
  }

  if (typeof window.invalidateSearchCache === "function") {
    const item = findItemByUuid(uuid);
    if (item) window.invalidateSearchCache(item);
  }

  return true;
};

/**
 * Remove a tag from an item.
 * @param {string} uuid - Item UUID
 * @param {string} tag - Tag name
 * @returns {boolean} True if tag was removed
 */
const removeItemTag = (uuid, tag) => {
  if (!uuid || !itemTags[uuid]) return false;

  const idx = itemTags[uuid].findIndex((t) => t === tag);
  if (idx === -1) return false;

  itemTags[uuid].splice(idx, 1);
  addRemovedTag(uuid, tag);
  stampTagTimestamp([uuid]);

  // Clean up empty arrays
  if (itemTags[uuid].length === 0) {
    delete itemTags[uuid];
  }

  saveItemTags();

  if (typeof window.invalidateSearchCache === "function") {
    const item = findItemByUuid(uuid);
    if (item) window.invalidateSearchCache(item);
  }

  return true;
};

/**
 * Delete all tags for an item (called on item deletion).
 * @param {string} uuid - Item UUID
 */
const deleteItemTags = (uuid) => {
  if (!uuid) return;
  let changed = false;
  const removedTagsBeforeDelete = loadRemovedTags(uuid);
  if (itemTags[uuid]) {
    delete itemTags[uuid];
    changed = true;
  }
  clearAllRemovedTags(uuid);
  if (changed || removedTagsBeforeDelete.length > 0) {
    stampTagTimestamp([uuid]);
    saveItemTags();
  }

  if (typeof window.invalidateSearchCache === "function") {
    const item = findItemByUuid(uuid);
    if (item) window.invalidateSearchCache(item);
  }
};

/**
 * Get a sorted list of all unique tags across the entire inventory.
 * @returns {string[]} Sorted array of unique tag strings
 */
const getAllUniqueTags = () => {
  const tagSet = new Set();
  for (const tags of Object.values(itemTags)) {
    tags.forEach((t) => tagSet.add(t));
  }
  return Array.from(tagSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
};

/**
 * Rename a tag across all items.
 * @param {string} oldName - Current tag name
 * @param {string} newName - New tag name
 * @returns {number} Number of items affected
 */
const renameTag = (oldName, newName) => {
  if (!oldName || !newName) return 0;
  const trimmed = newName.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) return 0;

  let affected = 0;
  const affectedUuids = [];
  for (const [uuid, tags] of Object.entries(itemTags)) {
    const idx = tags.indexOf(oldName);
    if (idx !== -1) {
      // Avoid creating a duplicate
      const lowerNew = trimmed.toLowerCase();
      if (tags.some((t, i) => i !== idx && t.toLowerCase() === lowerNew)) {
        // Already has the new tag name — just remove the old one
        tags.splice(idx, 1);
      } else {
        tags[idx] = trimmed;
      }
      affected++;
      affectedUuids.push(uuid);
      if (tags.length === 0) delete itemTags[uuid];
    }
  }
  if (affected > 0) {
    stampTagTimestamp(affectedUuids);
    saveItemTags();
    if (typeof window.resetSearchCache === "function") {
      window.resetSearchCache();
    }
  }
  return affected;
};

/**
 * Delete a tag from all items.
 * @param {string} tag - Tag name to remove globally
 * @returns {number} Number of items affected
 */
const deleteTagGlobal = (tag) => {
  if (!tag) return 0;
  let affected = 0;
  const affectedUuids = [];
  for (const [uuid, tags] of Object.entries(itemTags)) {
    const idx = tags.indexOf(tag);
    if (idx !== -1) {
      tags.splice(idx, 1);
      affected++;
      affectedUuids.push(uuid);
      if (tags.length === 0) delete itemTags[uuid];
    }
  }
  if (affected > 0) {
    stampTagTimestamp(affectedUuids);
    // Record removals so respectEdits sync won't re-add
    const raw = loadDataSync("itemRemovedTags", {});
    const map = Object.assign(Object.create(null), raw);
    const capitalized = String(tag).charAt(0).toUpperCase() + String(tag).slice(1);
    for (const uuid of affectedUuids) {
      if (!Array.isArray(map[uuid])) map[uuid] = [];
      if (!map[uuid].some((t) => t.toLowerCase() === capitalized.toLowerCase())) {
        map[uuid].push(capitalized);
      }
    }
    saveDataSync("itemRemovedTags", map);
    saveItemTags();
    if (typeof window.resetSearchCache === "function") {
      window.resetSearchCache();
    }
  }
  return affected;
};

// =============================================================================
// TAG BLACKLIST — independent from chip-grouping.js blacklist
// =============================================================================

/**
 * Load the tag blacklist from localStorage.
 * @returns {string[]} Array of blacklisted tag names
 */
const loadTagBlacklist = () => {
  try {
    const list = loadDataSync("tagBlacklist", []);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error("Failed to load tag blacklist:", e);
    return [];
  }
};

/**
 * Save the tag blacklist to localStorage.
 * @param {string[]} list - Array of blacklisted tag names
 */
const saveTagBlacklist = (list) => {
  saveDataSync("tagBlacklist", list);
};

/**
 * Check if a tag is blacklisted (case-insensitive).
 * @param {string} tag - Tag name to check
 * @returns {boolean} True if blacklisted
 */
const isTagBlacklisted = (tag) => {
  if (!tag) return false;
  const lower = tag.toLowerCase();
  return loadTagBlacklist().some((t) => t.toLowerCase() === lower);
};

/**
 * Add a tag to the blacklist.
 * @param {string} tag - Tag name to blacklist
 * @returns {boolean} True if added (false if already present)
 */
const addToTagBlacklist = (tag) => {
  if (!tag) return false;
  const trimmed = tag.trim();
  if (!trimmed) return false;
  const list = loadTagBlacklist();
  if (list.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return false;
  list.push(trimmed);
  saveTagBlacklist(list);
  return true;
};

/**
 * Remove a tag from the blacklist.
 * @param {string} tag - Tag name to remove
 * @returns {boolean} True if removed
 */
const removeFromTagBlacklist = (tag) => {
  if (!tag) return false;
  const lower = tag.toLowerCase();
  const list = loadTagBlacklist();
  const idx = list.findIndex((t) => t.toLowerCase() === lower);
  if (idx === -1) return false;
  list.splice(idx, 1);
  saveTagBlacklist(list);
  return true;
};

// ---------------------------------------------------------------------------
// Tag Removal Tracking (STAK-556)
// ---------------------------------------------------------------------------

const loadRemovedTags = (uuid) => {
  if (!uuid) return [];
  const raw = loadDataSync("itemRemovedTags", {});
  const map = Object.assign(Object.create(null), raw);
  return Array.isArray(map[uuid]) ? map[uuid] : [];
};

const addRemovedTag = (uuid, tag) => {
  if (!uuid || !tag) return;
  const raw = loadDataSync("itemRemovedTags", {});
  const map = Object.assign(Object.create(null), raw);
  if (!Array.isArray(map[uuid])) map[uuid] = [];
  const capitalized = String(tag).charAt(0).toUpperCase() + String(tag).slice(1);
  // Case-insensitive dedup
  if (map[uuid].some((t) => t.toLowerCase() === capitalized.toLowerCase())) return;
  map[uuid].push(capitalized);
  saveDataSync("itemRemovedTags", map);
};

const clearRemovedTag = (uuid, tag) => {
  if (!uuid || !tag) return;
  const raw = loadDataSync("itemRemovedTags", {});
  const map = Object.assign(Object.create(null), raw);
  if (!Array.isArray(map[uuid])) return;
  const idx = map[uuid].findIndex((t) => t.toLowerCase() === String(tag).toLowerCase());
  if (idx === -1) return;
  map[uuid].splice(idx, 1);
  if (map[uuid].length === 0) delete map[uuid];
  saveDataSync("itemRemovedTags", map);
};

const clearAllRemovedTags = (uuid) => {
  if (!uuid) return;
  const raw = loadDataSync("itemRemovedTags", {});
  const map = Object.assign(Object.create(null), raw);
  if (!(uuid in map)) return;
  delete map[uuid];
  saveDataSync("itemRemovedTags", map);
};

// =============================================================================

const applyNumistaTags = (
  uuid,
  numistaTags,
  persist = true,
  force = false,
  respectEdits = false
) => {
  if (!uuid || !Array.isArray(numistaTags) || numistaTags.length === 0)
    return { added: 0, skippedEdits: [] };

  // Check global auto-apply setting (skip when force=true, e.g. from re-sync picker)
  if (!force) {
    const autoApply = loadDataSync("numista_tags_auto", true);
    if (!autoApply) return { added: 0, skippedEdits: [] };
  }

  const removedSet = respectEdits
    ? new Set(loadRemovedTags(uuid).map((r) => r.toLowerCase()))
    : null;

  let added = 0;
  const skippedEdits = [];
  for (const raw of numistaTags) {
    const tag = String(raw).trim();
    if (!tag) continue;
    const capitalized = tag.charAt(0).toUpperCase() + tag.slice(1);

    if (isTagBlacklisted(capitalized)) continue;

    if (removedSet && removedSet.has(capitalized.toLowerCase())) {
      skippedEdits.push(capitalized);
      continue;
    }

    if (addItemTag(uuid, capitalized, false)) {
      added++;
    }
  }
  if (persist && added > 0) {
    stampTagTimestamp([uuid]);
    // Batch-clear removal tracking for re-imported tags
    const raw = loadDataSync("itemRemovedTags", {});
    const map = Object.assign(Object.create(null), raw);
    if (Array.isArray(map[uuid]) && map[uuid].length > 0) {
      const currentTags = new Set(getItemTags(uuid).map((t) => t.toLowerCase()));
      map[uuid] = map[uuid].filter((r) => !currentTags.has(r.toLowerCase()));
      if (map[uuid].length === 0) delete map[uuid];
      saveDataSync("itemRemovedTags", map);
    }
    saveItemTags();
  }

  return { added, skippedEdits };
};

/**
 * Build the tag display section for the view modal.
 * Returns a DOM fragment with item tags.
 * @param {string} uuid - Item UUID
 * @param {string[]} numistaTags - Numista API tags (may be empty)
 * @param {Function} [onChanged] - Callback when tags change (for re-render)
 * @returns {HTMLElement} Tag section element
 */
const buildTagSection = (uuid, numistaTags, onChanged) => {
  // Always show section so user can add tags
  const section = document.createElement("div");
  section.className = "view-detail-section";
  section.id = "viewTagsSection";

  const heading = document.createElement("div");
  heading.className = "view-section-title";
  heading.textContent = "Tags";
  section.appendChild(heading);

  const container = document.createElement("div");
  container.className = "view-tags-container";

  // Render existing tags
  const renderTags = () => {
    container.textContent = "";
    const currentTags = getItemTags(uuid);

    currentTags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      chip.title = `Tag: ${tag} (click × to remove)`;

      // STAK-344: All tags are removable — User First, Numista Second.
      // Once Numista writes a tag it becomes the user's property.
      const removeBtn = document.createElement("span");
      removeBtn.className = "tag-chip-remove";
      removeBtn.textContent = "\u00d7";
      removeBtn.setAttribute("role", "button");
      removeBtn.setAttribute("tabindex", "0");
      removeBtn.setAttribute("aria-label", `Remove tag ${tag}`);
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeItemTag(uuid, tag);
        renderTags();
        if (typeof onChanged === "function") onChanged();
      };
      removeBtn.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          removeBtn.onclick(e);
        }
      };
      chip.appendChild(removeBtn);

      container.appendChild(chip);
    });

    // Add tag button
    const addBtn = document.createElement("button");
    addBtn.className = "tag-add-btn";
    addBtn.type = "button";
    addBtn.textContent = "+ Tag";
    addBtn.title = "Add a tag";
    addBtn.onclick = () => {
      showTagInput(container, uuid, renderTags, onChanged);
    };
    container.appendChild(addBtn);
  };

  renderTags();
  section.appendChild(container);
  return section;
};

/**
 * Show an inline input for adding a new tag.
 * @param {HTMLElement} container - Parent container
 * @param {string} uuid - Item UUID
 * @param {Function} renderTags - Re-render callback
 * @param {Function} [onChanged] - External change callback
 */
const showTagInput = (container, uuid, renderTags, onChanged) => {
  // Remove existing input if any
  const existing = container.querySelector(".tag-input-wrapper");
  if (existing) existing.remove();

  const wrapper = document.createElement("span");
  wrapper.className = "tag-input-wrapper";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "tag-input";
  input.placeholder = "New tag...";
  input.maxLength = MAX_TAG_LENGTH;
  input.setAttribute("aria-label", "Enter tag name");

  // Autocomplete dropdown
  const dropdown = document.createElement("div");
  dropdown.className = "tag-autocomplete-dropdown";
  dropdown.style.display = "none";

  const allTags = getAllUniqueTags().filter((t) =>
    typeof window.isBlacklisted === "function" ? !window.isBlacklisted(t) : true
  );

  const updateDropdown = () => {
    const val = input.value.trim().toLowerCase();
    dropdown.textContent = "";
    if (val.length === 0) {
      dropdown.style.display = "none";
      return;
    }
    const currentItemTags = getItemTags(uuid).map((t) => t.toLowerCase());
    const matches = allTags
      .filter((t) => t.toLowerCase().includes(val) && !currentItemTags.includes(t.toLowerCase()))
      .slice(0, 8);

    if (matches.length === 0) {
      dropdown.style.display = "none";
      return;
    }

    matches.forEach((tag) => {
      const opt = document.createElement("div");
      opt.className = "tag-autocomplete-option";
      opt.textContent = tag;
      opt.onmousedown = (e) => {
        e.preventDefault();
        addItemTag(uuid, tag);
        renderTags();
        if (typeof onChanged === "function") onChanged();
      };
      dropdown.appendChild(opt);
    });
    dropdown.style.display = "";
  };

  input.addEventListener("input", updateDropdown);

  const commitTag = () => {
    const val = input.value.trim();
    if (val) {
      let addedTags = false;
      parseTagInput(val).forEach((t) => {
        if (addItemTag(uuid, t, false)) addedTags = true;
      });
      if (addedTags && typeof stampTagTimestamp === "function") stampTagTimestamp([uuid]);
      if (typeof saveItemTags === "function") saveItemTags();
    }
    renderTags();
    if (typeof onChanged === "function") onChanged();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTag();
    } else if (e.key === "Escape") {
      renderTags();
    }
  });

  input.addEventListener("blur", () => {
    // Short delay to allow dropdown click to fire
    setTimeout(() => {
      commitTag();
    }, 150);
  });

  wrapper.appendChild(input);
  wrapper.appendChild(dropdown);

  // Insert before the add button
  const addBtn = container.querySelector(".tag-add-btn");
  if (addBtn) {
    container.insertBefore(wrapper, addBtn);
    addBtn.style.display = "none";
  } else {
    container.appendChild(wrapper);
  }

  input.focus();
};

// Expose globally
window.loadItemTags = loadItemTags;
window.saveItemTags = saveItemTags;
window.loadTagTimestamps = loadTagTimestamps;
window.saveTagTimestampsDirect = saveTagTimestampsDirect;
window.stampTagTimestamp = stampTagTimestamp;
window.getItemTags = getItemTags;
window.addItemTag = addItemTag;
window.removeItemTag = removeItemTag;
window.deleteItemTags = deleteItemTags;
window.getAllUniqueTags = getAllUniqueTags;
window.renameTag = renameTag;
window.deleteTagGlobal = deleteTagGlobal;
window.applyNumistaTags = applyNumistaTags;
window.loadTagBlacklist = loadTagBlacklist;
window.saveTagBlacklist = saveTagBlacklist;
window.isTagBlacklisted = isTagBlacklisted;
window.addToTagBlacklist = addToTagBlacklist;
window.removeFromTagBlacklist = removeFromTagBlacklist;
window.loadRemovedTags = loadRemovedTags;
window.addRemovedTag = addRemovedTag;
window.clearRemovedTag = clearRemovedTag;
window.clearAllRemovedTags = clearAllRemovedTags;
window.buildTagSection = buildTagSection;

// =============================================================================
