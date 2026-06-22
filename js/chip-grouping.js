/**
 * @fileoverview Chip grouping helpers for dynamic and custom filter chips.
 * Provides global CRUD and matching helpers consumed by filtering UI modules.
 */

// CHIP GROUPING MODULE
// =============================================================================
// Custom grouping rules, chip blacklist, and dynamic chip extraction.
// Loads before filters.js; exposes functions on window.*.

(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  let _customGroups = [];
  let _blacklistArr = [];
  let _blacklistSet = new Set();

  // Known grade strings to exclude from dynamic chip extraction
  const GRADE_PATTERN =
    /^(BU|MS[-\s]?\d{1,2}|PF[-\s]?\d{1,2}|PR[-\s]?\d{1,2}|AG|G[-\s]?\d{1,2}|VG[-\s]?\d{1,2}|F[-\s]?\d{1,2}|VF[-\s]?\d{1,2}|EF[-\s]?\d{1,2}|AU[-\s]?\d{1,2}|UNC)$/i;

  // ---------------------------------------------------------------------------
  // Custom Grouping Rules CRUD
  // ---------------------------------------------------------------------------

  /** Load custom groups from localStorage */
  const loadCustomGroups = () => {
    _customGroups = loadDataSync("chipCustomGroups", []);
    return _customGroups;
  };

  /** Save custom groups to localStorage */
  const saveCustomGroups = () => {
    saveDataSync("chipCustomGroups", _customGroups);
  };

  /**
   * Add a custom grouping rule.
   * @param {string} label - Display label for the chip
   * @param {string} patternsStr - Comma or semicolon separated match patterns
   * @returns {Object|null} The new rule, or null if validation fails
   */
  const addCustomGroup = (label, patternsStr) => {
    if (!label || !label.trim()) return null;
    if (!patternsStr || !patternsStr.trim()) return null;

    const patterns = patternsStr
      .split(/[,;]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (patterns.length === 0) return null;

    const group = {
      id: "cg_" + Date.now(),
      label: label.trim(),
      patterns,
      enabled: true,
    };

    _customGroups.push(group);
    saveCustomGroups();
    return group;
  };

  /** Remove a custom group by ID */
  const removeCustomGroup = (id) => {
    _customGroups = _customGroups.filter((g) => g.id !== id);
    saveCustomGroups();
  };

  /**
   * Update a custom grouping rule's label and/or patterns.
   * @param {string} id - Group ID
   * @param {string} label - New display label
   * @param {string} patternsStr - New comma/semicolon separated patterns
   * @returns {Object|null} The updated group, or null if validation fails
   */
  const updateCustomGroup = (id, label, patternsStr) => {
    if (!label || !label.trim()) return null;
    if (!patternsStr || !patternsStr.trim()) return null;

    const patterns = patternsStr
      .split(/[,;]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (patterns.length === 0) return null;

    const group = _customGroups.find((g) => g.id === id);
    if (!group) return null;

    group.label = label.trim();
    group.patterns = patterns;
    saveCustomGroups();
    return group;
  };

  /** Toggle a custom group's enabled state */
  const toggleCustomGroup = (id) => {
    const group = _customGroups.find((g) => g.id === id);
    if (group) {
      group.enabled = !group.enabled;
      saveCustomGroups();
    }
  };

  // ---------------------------------------------------------------------------
  // Chip Blacklist CRUD
  // ---------------------------------------------------------------------------

  const _rebuildBlacklistSet = () => {
    _blacklistSet = new Set(_blacklistArr.map((n) => n.toLowerCase()));
  };

  /** Load blacklist from localStorage */
  const loadChipBlacklist = () => {
    _blacklistArr = loadDataSync("chipBlacklist", []);
    _rebuildBlacklistSet();
    return _blacklistArr;
  };

  /** Save blacklist to localStorage */
  const saveChipBlacklist = () => {
    saveDataSync("chipBlacklist", _blacklistArr);
    _rebuildBlacklistSet();
  };

  /** Add a name to the blacklist (case-insensitive dedup) */
  const addToBlacklist = (name) => {
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (_blacklistSet.has(trimmed.toLowerCase())) return; // already present
    _blacklistArr.push(trimmed);
    saveChipBlacklist();
  };

  /** Remove a name from the blacklist */
  const removeFromBlacklist = (name) => {
    const lower = name.toLowerCase();
    _blacklistArr = _blacklistArr.filter((n) => n.toLowerCase() !== lower);
    saveChipBlacklist();
  };

  /** Fast blacklist membership check */
  const isBlacklisted = (name) => {
    if (!name) return false;
    return _blacklistSet.has(name.toLowerCase());
  };

  // ---------------------------------------------------------------------------
  // Dynamic Chip Extraction
  // ---------------------------------------------------------------------------

  /**
   * Extract text from parentheses and quoted strings in item names.
   * Returns { extractedText: count } for texts appearing in 2+ items.
   * Skips grade strings and text shorter than 3 characters.
   *
   * @param {Array<Object>} inventory - Inventory items
   * @returns {Object} Map of extracted text → count
   */
  const extractDynamicChips = (inventory) => {
    const counts = {};

    inventory.forEach((item) => {
      const name = (item.name || "").trim();
      if (!name) return;

      const seen = new Set(); // avoid counting same text twice per item
      // Extract text inside parentheses (text) then double quotes "text".
      _collectBracketedText(name, CHIP_PAREN_PATTERN, seen, counts);
      _collectBracketedText(name, CHIP_QUOTE_PATTERN, seen, counts);
    });

    return counts;
  };

  // ---------------------------------------------------------------------------
  // Custom Group Counting
  // ---------------------------------------------------------------------------

  /**
   * Count items matching each enabled custom group.
   * @param {Array<Object>} inventory
   * @returns {Object} { groupId: { label, count } }
   */
  const countCustomGroups = (inventory) => {
    const results = {};
    _customGroups.forEach((group) => {
      if (!group.enabled) return;
      let count = 0;
      inventory.forEach((item) => {
        const itemName = (item.name || "").toLowerCase();
        if (
          group.patterns.some((p) => {
            try {
              // nosemgrep: javascript.dos.rule-non-literal-regexp
              return new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(
                itemName
              );
            } catch (e) {
              return itemName.includes(p.toLowerCase());
            }
          })
        ) {
          count++;
        }
      });
      if (count > 0) {
        results[group.id] = { label: group.label, count };
      }
    });
    return results;
  };

  /**
   * Check if an item matches any enabled custom group whose label matches the
   * search term.  Used by both filterInventory() and filterInventoryAdvanced()
   * so that searching "black flag" surfaces items tagged under a custom group
   * labelled "Black Flag".
   *
   * @param {Object} item        - Inventory item (needs .name)
   * @param {string} searchTerm  - Lowercase, trimmed search phrase
   * @returns {boolean}
   */
  const itemMatchesCustomGroupLabel = (item, searchTerm) => {
    if (!searchTerm || !_customGroups.length) return false;
    const itemName = (item.name || "").toLowerCase();

    return _customGroups.some((group) => {
      if (!group.enabled) return false;
      // Check if the search term matches the group label
      if (!group.label.toLowerCase().includes(searchTerm)) return false;
      // Check if the item matches any pattern in that group
      return group.patterns.some((p) => {
        try {
          return new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(
            itemName
          );
        } catch (e) {
          return itemName.includes(p.toLowerCase());
        }
      });
    });
  };

  // ---------------------------------------------------------------------------
  // Settings Panel Rendering
  // ---------------------------------------------------------------------------

  /**
   * Populate the blacklist dropdown with all current name chips + dynamic chips
   * from the live inventory, respecting chipMinCount and excluding already-blacklisted.
   */
  const populateBlacklistDropdown = () => {
    const select = document.getElementById("blacklistInput");
    if (!select) return;

    // Preserve current selection if any
    const prev = select.value;

    // Clear existing options
    select.innerHTML = '<option value="">Select a chip to suppress\u2026</option>';

    // Get inventory (let-declared global — not on window, but accessible via lexical scope)
    const inv = typeof inventory !== "undefined" ? inventory : [];
    if (!inv || inv.length === 0) return;

    // Get chipMinCount threshold
    const chipMinCountEl = document.getElementById("chipMinCount");
    let minCount = 2;
    if (chipMinCountEl && chipMinCountEl.value) {
      minCount = parseInt(chipMinCountEl.value, 10);
    } else {
      minCount = parseInt(localStorage.getItem("chipMinCount") || "3", 10);
    }

    const candidates = {}; // name → count

    // Collect grouped name chips (same logic as generateCategorySummary)
    if (window.featureFlags && window.featureFlags.isEnabled("GROUPED_NAME_CHIPS")) {
      inv.forEach((item) => {
        const itemName = (item.name || "").trim();
        if (!itemName) return;
        let baseName = itemName;
        if (window.autocomplete && typeof window.autocomplete.normalizeItemName === "function") {
          baseName = window.autocomplete.normalizeItemName(itemName);
        }
        candidates[baseName] = (candidates[baseName] || 0) + 1;
      });
    }

    // Collect dynamic chips
    if (window.featureFlags && window.featureFlags.isEnabled("DYNAMIC_NAME_CHIPS")) {
      const dynamicCounts = extractDynamicChips(inv);
      for (const [text, count] of Object.entries(dynamicCounts)) {
        if (!candidates[text]) {
          candidates[text] = count;
        }
      }
    }

    // Build sorted list: meets minCount, not already blacklisted
    const customLabelsLower = new Set(
      _customGroups.filter((g) => g.enabled).map((g) => g.label.toLowerCase())
    );
    const options = Object.entries(candidates)
      .filter(
        ([name, count]) =>
          count >= minCount &&
          !_blacklistSet.has(name.toLowerCase()) &&
          !customLabelsLower.has(name.toLowerCase())
      )
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (options.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No available chips to blacklist";
      opt.disabled = true;
      select.appendChild(opt);
      return;
    }

    // Add name chip group
    const nameGroup = document.createElement("optgroup");
    nameGroup.label = "Name Chips";
    let hasNames = false;

    const dynamicGroup = document.createElement("optgroup");
    dynamicGroup.label = "Dynamic Chips";
    let hasDynamic = false;

    // Separate name chips from dynamic chips
    const dynamicKeys = new Set();
    if (window.featureFlags && window.featureFlags.isEnabled("DYNAMIC_NAME_CHIPS")) {
      const dynamicCounts = extractDynamicChips(inv);
      for (const key of Object.keys(dynamicCounts)) {
        dynamicKeys.add(key);
      }
    }

    options.forEach(([name, count]) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = `${name} (${count})`;

      if (dynamicKeys.has(name)) {
        dynamicGroup.appendChild(opt);
        hasDynamic = true;
      } else {
        nameGroup.appendChild(opt);
        hasNames = true;
      }
    });

    if (hasNames) select.appendChild(nameGroup);
    if (hasDynamic) select.appendChild(dynamicGroup);

    // Restore previous selection if still valid
    if (prev && select.querySelector(`option[value="${CSS.escape(prev)}"]`)) {
      select.value = prev;
    }
  };

  /** Render the blacklist table inside #blacklistTableContainer */
  const renderBlacklistTable = () => {
    const container = document.getElementById("blacklistTableContainer");
    if (!container) return;

    if (_blacklistArr.length === 0) {
      container.innerHTML = '<div class="chip-grouping-empty">No blacklisted chips</div>';
      return;
    }

    let html =
      '<table class="chip-grouping-table"><thead><tr><th>Chip Name</th><th></th></tr></thead><tbody>';
    _blacklistArr.forEach((name) => {
      html += `<tr>
        <td>${escapeHtml(name)}</td>
        <td><button class="chip-grouping-delete" data-blacklist-name="${_escAttr(name)}" title="Remove from blacklist">&times;</button></td>
      </tr>`;
    });
    html += "</tbody></table>";
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    container.innerHTML = html;

    // Wire delete buttons
    container.querySelectorAll(".chip-grouping-delete[data-blacklist-name]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeFromBlacklist(btn.dataset.blacklistName);
        renderBlacklistTable();
        populateBlacklistDropdown(); // refresh dropdown to show restored chip
        if (typeof renderActiveFilters === "function") renderActiveFilters();
      });
    });
  };

  /** Render the custom group table inside #customGroupTableContainer */
  const renderCustomGroupTable = (editingId) => {
    const container = document.getElementById("customGroupTableContainer");
    if (!container) return;

    if (_customGroups.length === 0) {
      container.innerHTML = '<div class="chip-grouping-empty">No custom grouping rules</div>';
      return;
    }

    let html =
      '<table class="chip-grouping-table"><thead><tr><th>Label</th><th>Patterns</th><th>On</th><th></th></tr></thead><tbody>';
    _customGroups.forEach((group) => {
      const checked = group.enabled ? "checked" : "";
      const isEditing = editingId === group.id;

      if (isEditing) {
        html += `<tr data-editing="${_escAttr(group.id)}">
          <td><input type="text" class="chip-grouping-edit-input" data-edit-label="${_escAttr(group.id)}" value="${_escAttr(group.label)}"></td>
          <td><input type="text" class="chip-grouping-edit-input chip-grouping-edit-wide" data-edit-patterns="${_escAttr(group.id)}" value="${_escAttr(group.patterns.join(", "))}"></td>
          <td><input type="checkbox" ${checked} data-toggle-group="${_escAttr(group.id)}" title="Toggle rule"></td>
          <td class="chip-grouping-actions">
            <button class="chip-grouping-save" data-save-group="${_escAttr(group.id)}" title="Save changes">&#10003;</button>
            <button class="chip-grouping-cancel" data-cancel-group="${_escAttr(group.id)}" title="Cancel editing">&times;</button>
          </td>
        </tr>`;
      } else {
        html += `<tr>
          <td>${escapeHtml(group.label)}</td>
          <td class="chip-grouping-patterns">${escapeHtml(group.patterns.join(", "))}</td>
          <td><input type="checkbox" ${checked} data-toggle-group="${_escAttr(group.id)}" title="Toggle rule"></td>
          <td class="chip-grouping-actions">
            <button class="chip-grouping-edit" data-edit-group="${_escAttr(group.id)}" title="Edit rule">&#9998;</button>
            <button class="chip-grouping-delete" data-delete-group="${_escAttr(group.id)}" title="Delete rule">&times;</button>
          </td>
        </tr>`;
      }
    });
    html += "</tbody></table>";
    container.innerHTML = html;

    // Wire toggle checkboxes
    container.querySelectorAll("input[data-toggle-group]").forEach((cb) => {
      cb.addEventListener("change", () => {
        toggleCustomGroup(cb.dataset.toggleGroup);
        if (typeof renderActiveFilters === "function") renderActiveFilters();
      });
    });

    // Wire edit buttons
    container.querySelectorAll(".chip-grouping-edit[data-edit-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        renderCustomGroupTable(btn.dataset.editGroup);
      });
    });

    // Wire save buttons
    container.querySelectorAll(".chip-grouping-save[data-save-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.saveGroup;
        const labelInput = container.querySelector(`input[data-edit-label="${CSS.escape(id)}"]`);
        const patternsInput = container.querySelector(
          `input[data-edit-patterns="${CSS.escape(id)}"]`
        );
        if (labelInput && patternsInput) {
          const result = updateCustomGroup(id, labelInput.value, patternsInput.value);
          if (result) {
            renderCustomGroupTable();
            if (typeof renderActiveFilters === "function") renderActiveFilters();
          }
        }
      });
    });

    // Wire cancel buttons
    container.querySelectorAll(".chip-grouping-cancel[data-cancel-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        renderCustomGroupTable();
      });
    });

    // Wire Enter key on edit inputs to save, Escape to cancel
    container.querySelectorAll("input[data-edit-patterns]").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        const id = input.dataset.editPatterns;
        if (e.key === "Enter") {
          e.preventDefault();
          const saveBtn = container.querySelector(
            `.chip-grouping-save[data-save-group="${CSS.escape(id)}"]`
          );
          if (saveBtn) saveBtn.click();
        } else if (e.key === "Escape") {
          e.preventDefault();
          renderCustomGroupTable();
        }
      });
    });
    container.querySelectorAll("input[data-edit-label]").forEach((input) => {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const id = input.dataset.editLabel;
          const patternsInput = container.querySelector(
            `input[data-edit-patterns="${CSS.escape(id)}"]`
          );
          if (patternsInput) patternsInput.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          renderCustomGroupTable();
        }
      });
    });

    // Focus the label input if we're in edit mode
    if (editingId) {
      const labelInput = container.querySelector(
        `input[data-edit-label="${CSS.escape(editingId)}"]`
      );
      if (labelInput) labelInput.focus();
    }

    // Wire delete buttons
    container.querySelectorAll(".chip-grouping-delete[data-delete-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        removeCustomGroup(btn.dataset.deleteGroup);
        renderCustomGroupTable();
        if (typeof renderActiveFilters === "function") renderActiveFilters();
      });
    });
  };

  // ---------------------------------------------------------------------------
  // Context Menu (right-click on name/dynamic chips)
  // ---------------------------------------------------------------------------

  let _contextMenuEl = null;

  /** Show a context menu to blacklist a chip name */
  const showChipContextMenu = (x, y, chipName) => {
    _hideContextMenu();

    const menu = document.createElement("div");
    menu.className = "chip-context-menu";
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    const item = document.createElement("div");
    item.className = "chip-context-menu-item";
    item.textContent = "Add to blacklist";
    item.addEventListener("click", () => {
      addToBlacklist(chipName);
      _hideContextMenu();
      if (typeof renderActiveFilters === "function") renderActiveFilters();
      // Also update settings table and dropdown if open
      renderBlacklistTable();
      populateBlacklistDropdown();
    });
    menu.appendChild(item);

    document.body.appendChild(menu);
    _contextMenuEl = menu;

    // Adjust position if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = window.innerWidth - rect.width - 8 + "px";
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = window.innerHeight - rect.height - 8 + "px";
    }

    // Close on click-away or Escape
    setTimeout(() => {
      document.addEventListener("click", _hideContextMenu, { once: true });
      document.addEventListener("keydown", _onContextMenuKey);
    }, 0);
  };

  const _hideContextMenu = () => {
    if (_contextMenuEl && _contextMenuEl.parentNode) {
      _contextMenuEl.parentNode.removeChild(_contextMenuEl);
    }
    _contextMenuEl = null;
    document.removeEventListener("click", _hideContextMenu);
    document.removeEventListener("keydown", _onContextMenuKey);
  };

  const _onContextMenuKey = (e) => {
    if (e.key === "Escape") {
      _hideContextMenu();
    }
  };

  // ---------------------------------------------------------------------------
  // Shift+Click Blacklist Confirmation
  // ---------------------------------------------------------------------------

  let _confirmEl = null;

  /**
   * Show a lightweight floating confirmation to blacklist a chip.
   * Triggered by shift+click on name/dynamic chips.
   */
  const showBlacklistConfirm = (x, y, chipName) => {
    _hideBlacklistConfirm();

    const popup = document.createElement("div");
    popup.className = "chip-context-menu";
    popup.style.left = x + "px";
    popup.style.top = y + "px";

    const msg = document.createElement("div");
    msg.className = "chip-confirm-message";
    msg.textContent = `Ignore "${chipName}"?`;
    popup.appendChild(msg);

    const btnRow = document.createElement("div");
    btnRow.className = "chip-confirm-buttons";

    const yesBtn = document.createElement("button");
    yesBtn.className = "chip-confirm-yes";
    yesBtn.textContent = "Ignore";
    yesBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      addToBlacklist(chipName);
      _hideBlacklistConfirm();
      if (typeof renderActiveFilters === "function") renderActiveFilters();
      renderBlacklistTable();
      populateBlacklistDropdown();
    });

    const noBtn = document.createElement("button");
    noBtn.className = "chip-confirm-no";
    noBtn.textContent = "Cancel";
    noBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _hideBlacklistConfirm();
    });

    btnRow.appendChild(yesBtn);
    btnRow.appendChild(noBtn);
    popup.appendChild(btnRow);

    document.body.appendChild(popup);
    _confirmEl = popup;

    // Adjust position if off-screen
    const rect = popup.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      popup.style.left = window.innerWidth - rect.width - 8 + "px";
    }
    if (rect.bottom > window.innerHeight) {
      popup.style.top = window.innerHeight - rect.height - 8 + "px";
    }

    // Close on click-away or Escape
    setTimeout(() => {
      document.addEventListener("click", _hideBlacklistConfirm, { once: true });
      document.addEventListener("keydown", _onConfirmKey);
    }, 0);
  };

  const _hideBlacklistConfirm = () => {
    if (_confirmEl && _confirmEl.parentNode) {
      _confirmEl.parentNode.removeChild(_confirmEl);
    }
    _confirmEl = null;
    document.removeEventListener("click", _hideBlacklistConfirm);
    document.removeEventListener("keydown", _onConfirmKey);
  };

  const _onConfirmKey = (e) => {
    if (e.key === "Escape") {
      _hideBlacklistConfirm();
    }
  };

  // ---------------------------------------------------------------------------
  // Settings Event Wiring
  // ---------------------------------------------------------------------------

  /** Wire event listeners for the Grouping settings panel */
  const setupChipGroupingEvents = () => {
    // Add to blacklist (from dropdown)
    const addBlacklistBtn = document.getElementById("addBlacklistBtn");
    const blacklistInput = document.getElementById("blacklistInput");
    if (addBlacklistBtn && blacklistInput) {
      const doAddBlacklist = () => {
        const val = blacklistInput.value;
        if (val) {
          addToBlacklist(val);
          renderBlacklistTable();
          populateBlacklistDropdown(); // refresh dropdown to remove the just-added item
          if (typeof renderActiveFilters === "function") renderActiveFilters();
        }
      };
      addBlacklistBtn.addEventListener("click", doAddBlacklist);
      // Also allow double-click on select to add immediately
      blacklistInput.addEventListener("change", () => {
        // Auto-add when a selection is made — no extra click needed
        doAddBlacklist();
      });
    }

    // Add custom group
    const addGroupBtn = document.getElementById("addCustomGroupBtn");
    const groupLabelInput = document.getElementById("customGroupLabelInput");
    const groupPatternsInput = document.getElementById("customGroupPatternsInput");
    if (addGroupBtn && groupLabelInput && groupPatternsInput) {
      const doAddGroup = () => {
        const label = groupLabelInput.value.trim();
        const patterns = groupPatternsInput.value.trim();
        if (label && patterns) {
          const result = addCustomGroup(label, patterns);
          if (result) {
            groupLabelInput.value = "";
            groupPatternsInput.value = "";
            renderCustomGroupTable();
            if (typeof renderActiveFilters === "function") renderActiveFilters();
          }
        }
      };
      addGroupBtn.addEventListener("click", doAddGroup);
      groupPatternsInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          doAddGroup();
        }
      });
      groupLabelInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          groupPatternsInput.focus();
        }
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const _escAttr = (str) => {
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };

  // ---------------------------------------------------------------------------
  // Dynamic-chip text extraction (regex helpers — kept LAST: the quote pattern
  // embeds a double-quote, which desyncs Lizard's tokenizer; keeping it at the
  // file end confines the desync to the file boundary).
  // ---------------------------------------------------------------------------

  // Matches text inside parentheses: (text)
  const CHIP_PAREN_PATTERN = /\(([^)]+)\)/g;
  // Matches text inside double quotes: "text"
  const CHIP_QUOTE_PATTERN = /"([^"]+)"/g;

  /**
   * Collect bracketed/quoted substrings from a single item name into a counts
   * map, applying the dynamic-chip filters (length >= 3, not a grade string,
   * per-item case-insensitive dedup via the shared `seen` set).
   *
   * @param {string} name - Trimmed item name to scan
   * @param {RegExp} pattern - Global regex whose group 1 wraps the chip text
   *   (the literal match's first and last chars are stripped to get the text)
   * @param {Set<string>} seen - Lowercased texts already counted for this item
   * @param {Object<string, number>} counts - Accumulator map (mutated in place)
   * @returns {void}
   */
  const _collectBracketedText = (name, pattern, seen, counts) => {
    const matches = name.match(pattern);
    if (!matches) return;
    matches.forEach((m) => {
      const text = m.slice(1, -1).trim();
      if (text.length >= 3 && !GRADE_PATTERN.test(text) && !seen.has(text.toLowerCase())) {
        seen.add(text.toLowerCase());
        counts[text] = (counts[text] || 0) + 1;
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  // Load persisted data on script load
  loadCustomGroups();
  loadChipBlacklist();

  // ---------------------------------------------------------------------------
  // Expose to window
  // ---------------------------------------------------------------------------
  window.loadCustomGroups = loadCustomGroups;
  window.saveCustomGroups = saveCustomGroups;
  window.addCustomGroup = addCustomGroup;
  window.removeCustomGroup = removeCustomGroup;
  window.updateCustomGroup = updateCustomGroup;
  window.toggleCustomGroup = toggleCustomGroup;
  window.loadChipBlacklist = loadChipBlacklist;
  window.saveChipBlacklist = saveChipBlacklist;
  window.addToBlacklist = addToBlacklist;
  window.removeFromBlacklist = removeFromBlacklist;
  window.isBlacklisted = isBlacklisted;
  window.extractDynamicChips = extractDynamicChips;
  window.countCustomGroups = countCustomGroups;
  window.itemMatchesCustomGroupLabel = itemMatchesCustomGroupLabel;
  window.populateBlacklistDropdown = populateBlacklistDropdown;
  window.renderBlacklistTable = renderBlacklistTable;
  window.renderCustomGroupTable = renderCustomGroupTable;
  window.showChipContextMenu = showChipContextMenu;
  window.showBlacklistConfirm = showBlacklistConfirm;
  window.setupChipGroupingEvents = setupChipGroupingEvents;
})();
