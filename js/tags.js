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
    itemTags = loadDataSync(ITEM_TAGS_KEY, {});
  } catch (e) {
    console.error('Failed to load item tags:', e);
    itemTags = {};
  }
};

/**
 * Save the global `itemTags` object to localStorage.
 */
const saveItemTags = () => {
  try {
    saveDataSync(ITEM_TAGS_KEY, itemTags);
    if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
  } catch (e) {
    console.error('Failed to save item tags:', e);
  }
};

/**
 * Helper to find an inventory item by UUID for cache invalidation.
 * @param {string} uuid - The item UUID
 * @returns {Object|null} The inventory item or null
 */
const findItemByUuid = (uuid) => {
  if (typeof inventory !== 'undefined' && Array.isArray(inventory)) {
    return inventory.find(i => i.uuid === uuid) || null;
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
 * @param {boolean} [persist=true] - Whether to save to localStorage immediately
 * @returns {boolean} True if tag was added
 */
const addItemTag = (uuid, tag, persist = true) => {
  if (!uuid || !tag) return false;

  const trimmed = tag.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TAG_LENGTH) return false;

  if (!itemTags[uuid]) itemTags[uuid] = [];

  // Prevent duplicates (case-insensitive check)
  const lowerTrimmed = trimmed.toLowerCase();
  if (itemTags[uuid].some(t => t.toLowerCase() === lowerTrimmed)) return false;

  // Enforce max tags per item
  if (itemTags[uuid].length >= MAX_TAGS_PER_ITEM) return false;

  itemTags[uuid].push(trimmed);

  if (persist) saveItemTags();

  if (typeof window.invalidateSearchCache === 'function') {
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

  const idx = itemTags[uuid].findIndex(t => t === tag);
  if (idx === -1) return false;

  itemTags[uuid].splice(idx, 1);

  // Clean up empty arrays
  if (itemTags[uuid].length === 0) {
    delete itemTags[uuid];
  }

  saveItemTags();

  if (typeof window.invalidateSearchCache === 'function') {
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
  if (!uuid || !itemTags[uuid]) return;
  delete itemTags[uuid];
  saveItemTags();

  if (typeof window.invalidateSearchCache === 'function') {
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
    tags.forEach(t => tagSet.add(t));
  }
  return Array.from(tagSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
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
      if (tags.length === 0) delete itemTags[uuid];
    }
  }
  if (affected > 0) {
    saveItemTags();
    if (typeof window.resetSearchCache === 'function') {
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
  for (const [uuid, tags] of Object.entries(itemTags)) {
    const idx = tags.indexOf(tag);
    if (idx !== -1) {
      tags.splice(idx, 1);
      affected++;
      if (tags.length === 0) delete itemTags[uuid];
    }
  }
  if (affected > 0) {
    saveItemTags();
    if (typeof window.resetSearchCache === 'function') {
      window.resetSearchCache();
    }
  }
  return affected;
};

/**
 * Apply Numista tags to an item from an API result.
 * Capitalizes the first letter of each tag. Skips duplicates.
 * @param {string} uuid - Item UUID
 * @param {string[]} numistaTags - Array of tag strings from Numista API
 * @param {boolean} [persist=true] - Whether to call saveItemTags() after applying.
 *   Pass false when calling in a loop; caller is responsible for a single saveItemTags() after.
 * @returns {number} Number of tags added
 */
const applyNumistaTags = (uuid, numistaTags, persist = true) => {
  if (!uuid || !Array.isArray(numistaTags) || numistaTags.length === 0) return 0;
  let added = 0;
  for (const raw of numistaTags) {
    const tag = String(raw).trim();
    if (!tag) continue;
    // Capitalize first letter
    const capitalized = tag.charAt(0).toUpperCase() + tag.slice(1);
    if (addItemTag(uuid, capitalized, false)) {
      added++;
    }
  }
  if (persist && added > 0) saveItemTags();

  if (added > 0 && typeof window.invalidateSearchCache === 'function') {
    const item = findItemByUuid(uuid);
    if (item) window.invalidateSearchCache(item);
  }

  return added;
};

/**
 * Build the tag display section for the view modal.
 * Returns a DOM fragment with Numista tags (read-only) and custom tags (editable).
 * @param {string} uuid - Item UUID
 * @param {string[]} numistaTags - Numista API tags (may be empty)
 * @param {Function} [onChanged] - Callback when tags change (for re-render)
 * @returns {HTMLElement|null} Tag section element, or null if no tags and no add capability
 */
const buildTagSection = (uuid, numistaTags, onChanged) => {
  const existingTags = getItemTags(uuid);
  const hasNumista = Array.isArray(numistaTags) && numistaTags.length > 0;

  // Always show section so user can add custom tags
  const section = document.createElement('div');
  section.className = 'view-detail-section';
  section.id = 'viewTagsSection';

  const heading = document.createElement('div');
  heading.className = 'view-section-title';
  heading.textContent = 'Tags';
  section.appendChild(heading);

  const container = document.createElement('div');
  container.className = 'view-tags-container';

  // Render existing tags
  const renderTags = () => {
    container.textContent = '';
    const currentTags = getItemTags(uuid);

    // Build a set of Numista tag names (lowercased) for visual distinction
    const numistaSet = new Set((numistaTags || []).map(t => String(t).trim().toLowerCase()));

    currentTags.forEach(tag => {
      const chip = document.createElement('span');
      const isNumista = numistaSet.has(tag.toLowerCase());
      chip.className = isNumista ? 'tag-chip tag-chip-numista' : 'tag-chip tag-chip-custom';
      chip.textContent = tag;
      chip.title = isNumista ? `Numista tag: ${tag}` : `Custom tag: ${tag} (click × to remove)`;

      if (!isNumista) {
        const removeBtn = document.createElement('span');
        removeBtn.className = 'tag-chip-remove';
        removeBtn.textContent = '\u00d7';
        removeBtn.setAttribute('role', 'button');
        removeBtn.setAttribute('tabindex', '0');
        removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          removeItemTag(uuid, tag);
          renderTags();
          if (typeof onChanged === 'function') onChanged();
        };
        removeBtn.onkeydown = (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            removeBtn.onclick(e);
          }
        };
        chip.appendChild(removeBtn);
      }

      container.appendChild(chip);
    });

    // Add tag button
    const addBtn = document.createElement('button');
    addBtn.className = 'tag-add-btn';
    addBtn.type = 'button';
    addBtn.textContent = '+ Tag';
    addBtn.title = 'Add a custom tag';
    addBtn.onclick = () => {
      showTagInput(container, uuid, numistaTags, renderTags, onChanged);
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
 * @param {string[]} numistaTags - Numista tags for autocomplete
 * @param {Function} renderTags - Re-render callback
 * @param {Function} [onChanged] - External change callback
 */
const showTagInput = (container, uuid, numistaTags, renderTags, onChanged) => {
  // Remove existing input if any
  const existing = container.querySelector('.tag-input-wrapper');
  if (existing) existing.remove();

  const wrapper = document.createElement('span');
  wrapper.className = 'tag-input-wrapper';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-input';
  input.placeholder = 'New tag...';
  input.maxLength = MAX_TAG_LENGTH;
  input.setAttribute('aria-label', 'Enter tag name');

  // Autocomplete dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'tag-autocomplete-dropdown';
  dropdown.style.display = 'none';

  const allTags = getAllUniqueTags();

  const updateDropdown = () => {
    const val = input.value.trim().toLowerCase();
    dropdown.textContent = '';
    if (val.length === 0) {
      dropdown.style.display = 'none';
      return;
    }
    const currentItemTags = getItemTags(uuid).map(t => t.toLowerCase());
    const matches = allTags.filter(t =>
      t.toLowerCase().includes(val) && !currentItemTags.includes(t.toLowerCase())
    ).slice(0, 8);

    if (matches.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    matches.forEach(tag => {
      const opt = document.createElement('div');
      opt.className = 'tag-autocomplete-option';
      opt.textContent = tag;
      opt.onmousedown = (e) => {
        e.preventDefault();
        addItemTag(uuid, tag);
        renderTags();
        if (typeof onChanged === 'function') onChanged();
      };
      dropdown.appendChild(opt);
    });
    dropdown.style.display = '';
  };

  input.addEventListener('input', updateDropdown);

  const commitTag = () => {
    const val = input.value.trim();
    if (val) {
      addItemTag(uuid, val);
    }
    renderTags();
    if (typeof onChanged === 'function') onChanged();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTag();
    } else if (e.key === 'Escape') {
      renderTags();
    }
  });

  input.addEventListener('blur', () => {
    // Short delay to allow dropdown click to fire
    setTimeout(() => {
      commitTag();
    }, 150);
  });

  wrapper.appendChild(input);
  wrapper.appendChild(dropdown);

  // Insert before the add button
  const addBtn = container.querySelector('.tag-add-btn');
  if (addBtn) {
    container.insertBefore(wrapper, addBtn);
    addBtn.style.display = 'none';
  } else {
    container.appendChild(wrapper);
  }

  input.focus();
};

// Expose globally
window.loadItemTags = loadItemTags;
window.saveItemTags = saveItemTags;
window.getItemTags = getItemTags;
window.addItemTag = addItemTag;
window.removeItemTag = removeItemTag;
window.deleteItemTags = deleteItemTags;
window.getAllUniqueTags = getAllUniqueTags;
window.renameTag = renameTag;
window.deleteTagGlobal = deleteTagGlobal;
window.applyNumistaTags = applyNumistaTags;
window.buildTagSection = buildTagSection;

// =============================================================================
