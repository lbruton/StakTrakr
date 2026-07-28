/**
 * DiffModal — Reusable change-review modal for StakTrakr (STAK-184)
 *
 * Displays categorized item diffs (added/modified/deleted) with per-item
 * checkboxes, optional conflict resolution, optional settings diff, and
 * Select All / Deselect All controls. Works for three callers:
 *   1. Cloud sync pull (manifest-first or vault-first)
 *   2. CSV import
 *   3. JSON import
 *
 * Dependencies: utils.js (sanitizeHtml, safeGetElement, openModalById, closeModalById)
 * Optional:    DiffEngine.computeItemKey() for key derivation
 *
 * @module diff-modal
 */

/* global safeGetElement, sanitizeHtml, openModalById, closeModalById, DiffEngine */

(function () {
  "use strict";

  // ── Constants ──
  var MODAL_ID = "diffReviewModal";

  // ── Settings categories for grouped display ──
  var SETTINGS_CATEGORIES = {
    Appearance: {
      icon: "\uD83C\uDFA8",
      keys: [
        "appTheme",
        "cardViewStyle",
        "desktopCardView",
        "defaultSortColumn",
        "defaultSortDir",
        "settingsItemsPerPage",
        "appTimeZone",
        "showRealizedGainLoss",
        "layoutSectionConfig",
        "viewModalSectionConfig",
      ],
    },
    "Header Buttons": {
      icon: "\uD83D\uDD18",
      // headerMarketBtnVisible dropped (STRK-290): it left SYNC_SCOPE_KEYS with
      // the button, so it can never appear in a diff again. headerBtnOrder stays
      // — it is a synced array and older vaults still carry retired ids inside it.
      keys: ["headerThemeBtnVisible", "headerBtnShowText", "headerBtnOrder"],
    },
    "Filters & Chips": {
      icon: "\uD83C\uDFF7\uFE0F",
      keys: [
        "metalOrderConfig",
        "inlineChipConfig",
        "filterChipCategoryConfig",
        "chipMinCount",
        "chipMaxCount",
        "chipCustomGroups",
        "chipBlacklist",
        "chipSortOrder",
        "tagBlacklist",
      ],
    },
    Images: {
      icon: "\uD83D\uDDBC\uFE0F",
      keys: ["tableImagesEnabled", "tableImageSides"],
    },
    Currency: {
      icon: "\uD83D\uDCB1",
      keys: ["displayCurrency"],
    },
    "Goldback & Providers": {
      icon: "\uD83E\uDE99",
      keys: [
        "goldback-enabled",
        "goldback-estimate-enabled",
        "goldback-estimate-modifier",
        "apiProviderOrder",
        "providerPriority",
      ],
    },
    "API & Numista": {
      icon: "\uD83D\uDCDA",
      keys: [
        "metalApiConfig",
        "catalog_api_config",
        "numista_tags_auto",
        "numistaLookupRules",
        "numistaViewFields",
      ],
    },
  };

  var SETTINGS_LABELS = {
    displayCurrency: "Display Currency",
    appTheme: "Theme",
    cardViewStyle: "Card View Style",
    desktopCardView: "Desktop Card View",
    defaultSortColumn: "Default Sort Column",
    defaultSortDir: "Default Sort Direction",
    showRealizedGainLoss: "Show Realized Gain/Loss",
    metalOrderConfig: "Metal Order",
    settingsItemsPerPage: "Items Per Page",
    appTimeZone: "Time Zone",
    inlineChipConfig: "Inline Chips",
    filterChipCategoryConfig: "Filter Chip Categories",
    viewModalSectionConfig: "View Modal Sections",
    chipMinCount: "Chip Min Count",
    chipMaxCount: "Chip Max Count",
    chipCustomGroups: "Custom Chip Groups",
    chipBlacklist: "Hidden Chips",
    chipSortOrder: "Filter Sort (alpha/count)",
    layoutSectionConfig: "Section Layout",
    tableImagesEnabled: "Table Images",
    tableImageSides: "Table Image Sides",
    tagBlacklist: "Hidden Tags",
    headerThemeBtnVisible: "Theme Button",
    headerBtnShowText: "Button Labels",
    headerBtnOrder: "Button Order",
    "goldback-enabled": "Goldback Enabled",
    "goldback-estimate-enabled": "Goldback Estimates",
    "goldback-estimate-modifier": "Estimate Modifier",
    apiProviderOrder: "Provider Order",
    providerPriority: "Provider Ranking",
    numista_tags_auto: "Auto-Tag on Lookup",
    numistaLookupRules: "Lookup Rules",
    numistaViewFields: "View Fields",
    metalApiConfig: "API Keys",
    catalog_api_config: "Catalog API Keys",
  };

  var SETTINGS_VALUE_TYPE = {
    layoutSectionConfig: "chip-strip",
    inlineChipConfig: "chip-strip",
    filterChipCategoryConfig: "chip-strip",
    viewModalSectionConfig: "chip-strip",
    chipCustomGroups: "count-summary",
    numistaViewFields: "toggle-map",
    headerBtnOrder: "slug-chips",
    apiProviderOrder: "slug-chips",
    chipBlacklist: "slug-chips",
    tagBlacklist: "slug-chips",
    providerPriority: "kv-pills",
    numistaLookupRules: "count-summary",
    metalOrderConfig: "chip-strip",
  };

  // ── JSON parse helper — cloud-sync vault passes settings as raw JSON strings ──
  // Also handles CMP1-compressed localStorage values (loadDataSync decompresses,
  // but raw localStorage.getItem() and vault payloads may not).
  function _parseSetting(val) {
    if (typeof val !== "string") return val;
    if (typeof __decompressIfNeeded === "function") val = __decompressIfNeeded(val);
    try {
      return JSON.parse(val);
    } catch (e) {
      return val;
    }
  }

  // ── Internal state ──
  var _options = null;
  var _checkedItems = {}; // { 'added-0': true, 'modified-2': false, ... }
  var _conflictResolutions = {}; // { 'c0': 'local'|'remote', ... }
  var _collapsedCategories = {}; // { added: true, ... }
  var _expandedSettingsCategories = {}; // { 'Appearance': true, ... }
  var _selectAllState = 0; // 0=none, 1=added+modified, 2=all

  // Card-based state (STAK-454)
  var _orphanActions = {}; // { 'added-0': 'import'|'skip', 'deleted-1': 'keep'|'remove' }
  var _fieldSelections = {}; // { 'conflict-0-purchasePrice': 'local'|'remote' }
  var _resolvedConflicts = {}; // { 0: true, 1: true }
  var _blobUrls = []; // Tracked blob URLs for revocation on re-render/close

  // ── Helpers ──
  // NOTE: _esc / _titleCase (the regex-bearing escape helpers) are defined LAST in
  // this IIFE, just before the public export. Their regex literals (notably /"/g)
  // mis-tokenize Lizard's JS lexer and desync forward function detection for
  // everything after them, so they must sit at the file end. See [[lizard-esc-regex-desync]].

  /** Derive a display key for an item */
  function _itemKey(item) {
    if (typeof DiffEngine !== "undefined" && DiffEngine.computeItemKey) {
      return DiffEngine.computeItemKey(item);
    }
    return String(item.serial || item.name || "");
  }

  /** Count currently checked items */
  function _checkedCount() {
    var count = 0;
    for (var k in _checkedItems) {
      if (_checkedItems.hasOwnProperty(k) && _checkedItems[k]) count++;
    }
    return count;
  }

  /**
   * Compute the projected inventory count after applying selected changes.
   * Formula: localCount + selectedAdded - selectedDeleted
   * (modified items do not change net count)
   */
  function _computeProjectedCount() {
    if (!_options) return 0;
    const localCount = _options.localCount != null ? _options.localCount : 0;
    const diff = _options.diff || {};
    const added = diff.added || [];
    const deleted = diff.deleted || [];
    let selectedAdded = 0;
    let selectedDeleted = 0;
    for (let a = 0; a < added.length; a++) {
      if (_checkedItems["added-" + a] !== false) selectedAdded++;
    }
    for (let d = 0; d < deleted.length; d++) {
      if (_checkedItems["deleted-" + d] !== false) selectedDeleted++;
    }
    return localCount + selectedAdded - selectedDeleted;
  }

  /**
   * Update the count row and warning div in the modal header.
   * Only renders when backupCount and localCount are both provided.
   * Also calls onSelectionChange if provided.
   */
  function _updateCountRow() {
    if (!_options) return;
    const backupCount = _options.backupCount;
    const localCount = _options.localCount;
    const countRowEl = safeGetElement("diffReviewCountRow");
    const warningEl = safeGetElement("diffReviewCountWarning");

    if (backupCount != null && localCount != null) {
      const projectedCount = _computeProjectedCount();

      if (countRowEl) {
        countRowEl.innerHTML =
          "Backup: <strong>" +
          backupCount +
          "</strong> items" +
          " &nbsp;|&nbsp; Current: <strong>" +
          localCount +
          "</strong> items" +
          " &nbsp;|&nbsp; After import: <strong>" +
          projectedCount +
          "</strong>";
        countRowEl.style.display = "";
      }

      if (warningEl) {
        const missing = backupCount - projectedCount;
        if (missing > 0) {
          warningEl.textContent =
            missing +
            " item" +
            (missing > 1 ? "s" : "") +
            " from the backup will not be imported (e.g., skipped due to validation errors, not selected, or already present locally).";
          warningEl.style.display = "";
        } else {
          warningEl.textContent = "";
          warningEl.style.display = "none";
        }
      }

      // Fire onSelectionChange callback if provided
      if (typeof _options.onSelectionChange === "function") {
        const selected = _buildSelectedChanges();
        _options.onSelectionChange(selected, projectedCount);
      }
    } else {
      if (countRowEl) countRowEl.style.display = "none";
      if (warningEl) warningEl.style.display = "none";
    }
  }

  /** Get the header title based on source type */
  function _getTitle(source) {
    if (!source) return "Review Changes";
    switch (source.type) {
      case "sync":
        return "Review Sync Changes";
      case "csv":
        return "Review CSV Import";
      case "json":
        return "Review JSON Import";
      default:
        return "Review Changes";
    }
  }

  /** Get source icon HTML entity */
  function _getSourceIcon(source) {
    if (!source) return "";
    switch (source.type) {
      case "sync":
        return "&#9729; "; // cloud
      case "csv":
        return "&#128196; "; // page
      case "json":
        return "&#128230; "; // package
      default:
        return "";
    }
  }

  // ── Rendering ──

  function _renderSummaryDashboard(container, diff, conflicts) {
    if (!container) return;
    var matched = (diff.unchanged || []).length;
    var syncConflicts = ((conflicts && conflicts.conflicts) || []).length;
    var modifiedCount = (diff.modified || []).length;
    // Show whichever is relevant: true sync conflicts, or modified items for imports
    var conflictCount = syncConflicts > 0 ? syncConflicts : modifiedCount;
    var remoteOnly = (diff.added || []).length;
    var localOnly = (diff.deleted || []).length;

    var cards = [
      {
        count: matched,
        label: "Matched",
        target: "diffSectionModified",
        color: "",
        style: "opacity:0.5",
      },
      {
        count: conflictCount,
        label: "Conflicts",
        target: "diffSectionModified",
        color: conflictCount > 0 ? "color:var(--warning)" : "",
        style: "",
      },
      {
        count: remoteOnly,
        label: "Remote Only",
        target: "diffSectionOrphans",
        color: "",
        style: "",
      },
      { count: localOnly, label: "Local Only", target: "diffSectionOrphans", color: "", style: "" },
    ];

    var cardStyle =
      "flex:1;min-width:120px;border-radius:8px;padding:0.6rem;background:var(--bg-tertiary,transparent);cursor:pointer;text-align:center";
    var html = '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:0.75rem 0">';
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var numStyle = "font-size:1.4rem;font-weight:700";
      if (card.style) numStyle += ";" + card.style;
      if (card.color) numStyle += ";" + card.color;
      html += '<div data-scroll-target="' + _esc(card.target) + '" style="' + cardStyle + '">';
      html += '<div style="' + numStyle + '">' + card.count + "</div>";
      html += '<div style="font-size:0.7rem;opacity:0.6">' + _esc(card.label) + "</div>";
      html += "</div>";
    }
    html += "</div>";

    container.innerHTML = html;
    container.onclick = function (e) {
      var target = e.target.closest("[data-scroll-target]");
      if (target) {
        var el = safeGetElement(target.getAttribute("data-scroll-target"));
        if (el instanceof HTMLElement) el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
  }

  function _renderSettingsCards(container, settingsDiff) {
    if (!container) return;
    var changed = settingsDiff && settingsDiff.changed ? settingsDiff.changed : [];
    var matched =
      settingsDiff && (settingsDiff.unchanged || settingsDiff.matched)
        ? settingsDiff.unchanged || settingsDiff.matched
        : [];
    if (changed.length === 0 && matched.length === 0) {
      container.innerHTML = "";
      container.style.display = "none";
      return;
    }

    // Build category lookup for each entry
    var catNames = Object.keys(SETTINGS_CATEGORIES);
    function _findCategory(key) {
      for (var ci = 0; ci < catNames.length; ci++) {
        var cat = SETTINGS_CATEGORIES[catNames[ci]];
        for (var ki = 0; ki < cat.keys.length; ki++) {
          if (cat.keys[ki] === key) return catNames[ci];
        }
      }
      return "Other";
    }

    // Group changed and matched by category
    var changedByCat = {};
    var matchedByCat = {};
    var i;
    for (i = 0; i < changed.length; i++) {
      var cCat = _findCategory(changed[i].key);
      if (!changedByCat[cCat]) changedByCat[cCat] = [];
      changedByCat[cCat].push(changed[i]);
    }
    for (i = 0; i < matched.length; i++) {
      var mCat = _findCategory(matched[i].key);
      if (!matchedByCat[mCat]) matchedByCat[mCat] = [];
      matchedByCat[mCat].push(matched[i]);
    }

    // Collect only categories that have actual diffs (skip matched-only categories)
    var orderedCats = [];
    for (var cn = 0; cn < catNames.length; cn++) {
      if (changedByCat[catNames[cn]] && changedByCat[catNames[cn]].length > 0)
        orderedCats.push(catNames[cn]);
    }
    if (changedByCat["Other"] && changedByCat["Other"].length > 0) orderedCats.push("Other");

    // Count total changed settings and how many are resolved
    var totalChanged = changed.length;
    var resolvedCount = 0;
    for (i = 0; i < changed.length; i++) {
      if (_conflictResolutions["setting-" + changed[i].key]) resolvedCount++;
    }

    // Visual separator between Items and Settings sections
    var collapsed = _collapsedCategories.settings;
    var html =
      '<div style="margin:1.2rem 0 0.8rem;border-top:2px solid var(--border);padding-top:0.6rem">';
    html +=
      '<div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.4rem">User Configuration</div>';
    html += "</div>";

    // Section wrapper (matches item card section structure)
    html += '<div class="dm-section-wrapper" data-section="settings">';

    // Section header with collapse toggle + bulk actions
    html += '<div class="dm-section-header">';
    html += '<div class="dm-section-title">';
    html +=
      '<span class="dm-collapse-toggle' +
      (collapsed ? " collapsed" : "") +
      '" data-cat-toggle="settings">' +
      (collapsed ? "&#9654;" : "&#9660;") +
      "</span>";
    html += "<span>\u2699\uFE0F</span> Settings";
    html +=
      '<span class="dm-chip">' +
      totalChanged +
      " diff" +
      (totalChanged !== 1 ? "s" : "") +
      "</span>";
    html += "</div>";
    html += '<div class="dm-section-actions">';
    html +=
      '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-settings-bulk="local">Keep All Local</button>';
    html +=
      '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-settings-bulk="remote">Keep All Remote</button>';
    html += "</div>";
    html += "</div>";

    // Settings summary bubble — count how many go to local vs remote
    if (totalChanged > 0) {
      var localCount = 0;
      var remoteCount = 0;
      for (i = 0; i < changed.length; i++) {
        var res = _conflictResolutions["setting-" + changed[i].key];
        if (res === "local") localCount++;
        else remoteCount++;
      }
      html +=
        '<div style="background:var(--bg-secondary);border-radius:8px;padding:0.5rem 0.75rem;margin:0.4rem 0">';
      html +=
        '<div style="display:flex;justify-content:space-between;align-items:center;font-size:0.78rem">';
      html += "<span>Using <strong>remote</strong> for <strong>" + remoteCount + "</strong>";
      if (localCount > 0)
        html += ", <strong>local</strong> for <strong>" + localCount + "</strong>";
      html += " of " + totalChanged + " settings</span>";
      html +=
        '<span style="font-size:0.7rem;color:var(--text-muted)">Click values to switch</span>';
      html += "</div>";
      html += "</div>";
    }

    // Section body (collapsible)
    html += '<div class="dm-section-body' + (collapsed ? " collapsed" : "") + '">';

    var renderedCount = 0;

    for (var oci = 0; oci < orderedCats.length; oci++) {
      var catKey = orderedCats[oci];
      var catChanged = changedByCat[catKey] || [];
      var catMatched = matchedByCat[catKey] || [];
      if (catChanged.length === 0) continue;

      var catDef = SETTINGS_CATEGORIES[catKey];
      var catIcon = catDef ? catDef.icon : "\u2699\uFE0F";

      // Category card (bordered, matches dm-card style)
      html += '<div class="dm-card" style="margin-bottom:0.75rem;padding:0.75rem">';

      // Card header with category name + diff badge
      html +=
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">';
      html += '<div style="display:flex;align-items:center;gap:0.4rem">';
      html +=
        '<span style="font-weight:600;font-size:0.85rem">' +
        catIcon +
        " " +
        _esc(catKey) +
        "</span>";
      if (catChanged.length > 0) {
        html +=
          '<span class="dm-pill dm-pill-warning">' +
          catChanged.length +
          " diff" +
          (catChanged.length !== 1 ? "s" : "") +
          "</span>";
      }
      html += "</div>";
      // Per-category bulk actions
      if (catChanged.length > 0) {
        html += '<div style="display:flex;gap:0.3rem">';
        html +=
          '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-cat-bulk="' +
          _esc(catKey) +
          '" data-side="local" style="font-size:0.68rem;padding:0.15rem 0.4rem">Keep Local</button>';
        html +=
          '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-cat-bulk="' +
          _esc(catKey) +
          '" data-side="remote" style="font-size:0.68rem;padding:0.15rem 0.4rem">Use Remote</button>';
        html += "</div>";
      }
      html += "</div>";

      // Changed setting rows
      for (var ci2 = 0; ci2 < catChanged.length; ci2++) {
        var entry = catChanged[ci2];
        var label = SETTINGS_LABELS[entry.key] || _titleCase(entry.key);

        // Try rich renderer first
        var expandedHtml = window.DiffModalSettings.renderSettingRow(
          entry.key,
          entry.localVal,
          entry.remoteVal,
          _fieldSelections,
          _conflictResolutions
        );
        if (expandedHtml !== null) {
          html += '<div style="padding:0.4rem 0;border-top:1px solid var(--border)">';
          html +=
            '<div style="font-size:0.78rem;font-weight:500;margin-bottom:0.3rem">' +
            _esc(label) +
            "</div>";
          html += expandedHtml;
          html += "</div>";
          continue;
        }

        // Fallback: inline click-to-pick buttons (uses dm-field-diff grid like item cards)
        var resKey = "setting-" + entry.key;
        var selected = _conflictResolutions[resKey] || "";
        var localSel = selected === "local" ? " selected" : "";
        var remoteSel = selected === "remote" ? " selected" : "";

        html +=
          '<div class="dm-field-diff" style="border-top:1px solid var(--border);padding:0.4rem 0">';
        html += '<div class="dm-field-label">' + _esc(label) + "</div>";
        html +=
          '<div class="dm-field-value local' +
          localSel +
          '" data-setting-resolution="' +
          _esc(resKey) +
          '" data-side="local" style="cursor:pointer" title="' +
          _esc(window.DiffModalSettings.formatSettingValue(entry.key, entry.localVal)) +
          '">' +
          window.DiffModalSettings.formatSettingValue(entry.key, entry.localVal) +
          "</div>";
        html += '<div class="dm-field-arrow">&#10231;</div>';
        html +=
          '<div class="dm-field-value remote' +
          remoteSel +
          '" data-setting-resolution="' +
          _esc(resKey) +
          '" data-side="remote" style="cursor:pointer" title="' +
          _esc(window.DiffModalSettings.formatSettingValue(entry.key, entry.remoteVal)) +
          '">' +
          window.DiffModalSettings.formatSettingValue(entry.key, entry.remoteVal) +
          "</div>";
        html += "</div>";
      }

      // Matched settings section (collapsed by default)
      if (catMatched.length > 0) {
        var isExpanded = _expandedSettingsCategories[catKey] || false;
        html +=
          '<div data-toggle-matched="' +
          _esc(catKey) +
          '" style="font-size:0.73rem;cursor:pointer;color:var(--primary);margin-top:0.4rem;padding-top:0.3rem;border-top:1px solid var(--border)">';
        html +=
          (isExpanded ? "\u25BC Hide" : "\u25B6 Show") +
          " " +
          catMatched.length +
          " matched setting" +
          (catMatched.length !== 1 ? "s" : "");
        html += "</div>";

        if (isExpanded) {
          for (var mi = 0; mi < catMatched.length; mi++) {
            var mEntry = catMatched[mi];
            var mLabel = SETTINGS_LABELS[mEntry.key] || _titleCase(mEntry.key);
            html +=
              '<div style="display:flex;align-items:center;gap:0.4rem;padding:0.2rem 0;opacity:0.45;font-size:0.78rem">';
            html += "<span>\u2713</span>";
            html += '<span style="min-width:120px">' + _esc(mLabel) + "</span>";
            html +=
              "<span>" +
              window.DiffModalSettings.formatSettingValue(mEntry.key, mEntry.localVal) +
              "</span>";
            html += "</div>";
          }
        }
      }

      html += "</div>"; // .dm-card
      renderedCount++;
    }

    html += "</div></div>"; // .dm-section-body, .dm-section-wrapper

    container.innerHTML = html;
    container.style.display = renderedCount > 0 ? "" : "none";

    // Event delegation
    container.onclick = function (e) {
      // Per-element chip/pill clicks
      var fieldBtn = e.target.closest("[data-field]");
      if (fieldBtn) {
        var field = fieldBtn.getAttribute("data-field");
        var side = fieldBtn.getAttribute("data-side");
        if (_fieldSelections[field] === side) {
          delete _fieldSelections[field];
        } else {
          _fieldSelections[field] = side;
        }
        _renderSettingsCards(container, settingsDiff);
        return;
      }
      // Show-more expander
      var showMore = e.target.closest(".dm-show-more");
      if (showMore) {
        var expandKey = showMore.getAttribute("data-expand");
        var expandEl = safeGetElement("expand-" + expandKey);
        if (expandEl) {
          expandEl.classList.add("expanded");
          showMore.style.display = "none";
        }
        return;
      }
      // Inline setting resolution (click-to-pick local/remote)
      var btn = e.target.closest("[data-setting-resolution]");
      if (btn) {
        var key = btn.getAttribute("data-setting-resolution");
        var rSide = btn.getAttribute("data-side");
        _conflictResolutions[key] = rSide;
        _renderSettingsCards(container, settingsDiff);
        return;
      }
      // Matched toggle
      var toggle = e.target.closest("[data-toggle-matched]");
      if (toggle) {
        var cat = toggle.getAttribute("data-toggle-matched");
        _expandedSettingsCategories[cat] = !_expandedSettingsCategories[cat];
        _renderSettingsCards(container, settingsDiff);
        return;
      }
      // Section collapse toggle
      var catToggle = e.target.closest('[data-cat-toggle="settings"]');
      if (catToggle) {
        _collapsedCategories.settings = !_collapsedCategories.settings;
        _renderSettingsCards(container, settingsDiff);
        return;
      }
      // Settings bulk "Keep All Local" / "Keep All Remote"
      var bulkBtn = e.target.closest("[data-settings-bulk]");
      if (bulkBtn) {
        var bulkSide = bulkBtn.getAttribute("data-settings-bulk");
        for (var bi = 0; bi < changed.length; bi++) {
          _conflictResolutions["setting-" + changed[bi].key] = bulkSide;
        }
        _renderSettingsCards(container, settingsDiff);
        return;
      }
      // Per-category bulk
      var catBulk = e.target.closest("[data-cat-bulk]");
      if (catBulk) {
        var bulkCat = catBulk.getAttribute("data-cat-bulk");
        var bulkCatSide = catBulk.getAttribute("data-side");
        var catEntries = changedByCat[bulkCat] || [];
        for (var cbi = 0; cbi < catEntries.length; cbi++) {
          _conflictResolutions["setting-" + catEntries[cbi].key] = bulkCatSide;
        }
        _renderSettingsCards(container, settingsDiff);
        return;
      }
    };
  }

  // ── Card-based renderers (STAK-454 — matches playground/diffmodal-item-cards.html) ──

  /** Shared card header: dual OBV/REV thumbnails + item identity. Used by orphan and conflict cards. */
  function _renderCardHeader(item, uuid) {
    var grad = window.DiffModalSettings.metalBgGradient(item.metal);
    var mColor = window.DiffModalSettings.metalColor(item.metal);
    var html = "";
    // Dual OBV/REV thumbnails
    html += '<div class="dm-item-thumb-pair">';
    html +=
      '<div class="dm-item-thumb" style="background:' +
      grad +
      '"' +
      (uuid ? ' data-uuid="' + _esc(uuid) + '" data-side="obverse"' : "") +
      '><span style="color:' +
      mColor +
      ';font-size:0.55rem">OBV</span></div>';
    html +=
      '<div class="dm-item-thumb" style="background:' +
      grad +
      '"' +
      (uuid ? ' data-uuid="' + _esc(uuid) + '" data-side="reverse"' : "") +
      '><span style="color:' +
      mColor +
      ';font-size:0.55rem">REV</span></div>';
    html += "</div>";
    return html;
  }

  /** Render Added or Deleted items as orphan cards. Returns HTML string. */
  function _renderOrphanCards(type, items) {
    if (!items || items.length === 0) return "";
    var collapsed = _collapsedCategories[type];
    var isAdded = type === "added";
    var sectionColor = isAdded ? "var(--info)" : "var(--danger)";
    var sectionIcon = isAdded ? "&#8595;" : "&#8593;";
    var sectionLabel = isAdded ? "Added / Remote Only" : "Deleted / Local Only";

    var html =
      '<div class="dm-section-wrapper" data-section="' + type + '" style="margin-top:1rem">';

    // Section header
    html += '<div class="dm-section-header">';
    html += '<div class="dm-section-title">';
    html +=
      '<span class="dm-collapse-toggle' +
      (collapsed ? " collapsed" : "") +
      '" data-cat-toggle="' +
      type +
      '">' +
      (collapsed ? "&#9654;" : "&#9660;") +
      "</span>";
    html += '<span style="color:' + sectionColor + '">' + sectionIcon + "</span> " + sectionLabel;
    html +=
      '<span class="dm-chip">' +
      items.length +
      " item" +
      (items.length !== 1 ? "s" : "") +
      "</span>";
    html += "</div>";
    html += '<div class="dm-section-actions">';
    if (isAdded) {
      html +=
        '<button class="dm-btn dm-btn-sm dm-btn-primary" data-bulk-action="import" data-bulk-section="added">Import All</button>';
      html +=
        '<button class="dm-btn dm-btn-sm dm-btn-muted" data-bulk-action="skip" data-bulk-section="added">Skip All</button>';
    } else {
      html +=
        '<button class="dm-btn dm-btn-sm dm-btn-gain" data-bulk-action="keep" data-bulk-section="deleted">Keep All</button>';
      html +=
        '<button class="dm-btn dm-btn-sm dm-btn-muted" data-bulk-action="remove" data-bulk-section="deleted">Remove All</button>';
    }
    html += "</div>";
    html += "</div>";

    // Section body
    html += '<div class="dm-section-body' + (collapsed ? " collapsed" : "") + '">';
    var showAll = _collapsedCategories["_showAll_" + type];
    var limit = !showAll && items.length > 30 ? 30 : items.length;
    for (var i = 0; i < limit; i++) {
      var item = items[i];
      var key = type + "-" + i;
      var action = _orphanActions[key] || (isAdded ? "import" : "keep");
      var isSkipped = (isAdded && action === "skip") || (!isAdded && action === "remove");
      var mColor = window.DiffModalSettings.metalColor(item.metal);
      var uuid = item.uuid || "";

      html +=
        '<div class="dm-card dm-orphan-card' +
        (isSkipped ? " skipped" : "") +
        '" data-action="' +
        action +
        '" data-idx="' +
        i +
        '" data-type="' +
        type +
        '">';
      html += _renderCardHeader(item, uuid);
      // Item identity
      html += '<div class="dm-item-identity">';
      html +=
        '<div class="dm-item-name" style="color:' +
        mColor +
        '">' +
        _esc(item.name || "Unnamed item") +
        "</div>";
      html += '<div class="dm-item-meta">';
      html += '<span style="color:' + mColor + '">' + _esc(item.metal || "") + "</span>";
      if (item.weight != null)
        html +=
          "<span>&#8226;</span><span>" +
          _esc(String(item.weight)) +
          " " +
          _esc(item.weightUnit || "oz") +
          "</span>";
      if (item.qty != null)
        html += "<span>&#8226;</span><span>Qty: " + _esc(String(item.qty)) + "</span>";
      html += "</div></div>";
      // STRK-167 (AC-11): advisory possible-duplicate badge for an added row whose
      // key is in the showImportDiffReview sidecar (an ungraded import sharing
      // numistaId+year with an existing graded item). Advisory only — never blocks
      // import; the flag lives in _options.possibleDuplicates, never on the item (D-4).
      if (
        isAdded &&
        _options &&
        _options.possibleDuplicates &&
        typeof DiffEngine !== "undefined" &&
        _options.possibleDuplicates.has(DiffEngine.computeItemKey(item))
      ) {
        html +=
          '<div class="dm-dup-flag" role="note" title="You already have a graded copy of this coin/year. Importing this ungraded row will create a separate item. Skip it if it is the same physical coin.">' +
          '<span class="dm-dup-icon" aria-hidden="true">&#9888;</span>' +
          '<span class="dm-dup-text">Possible duplicate of a graded item</span>' +
          '<span class="sr-only">Possible duplicate: an existing graded item shares this catalog number and year.</span>' +
          "</div>";
      }
      // Action buttons — active action gets prominent color, inactive gets muted
      html += '<div class="dm-orphan-actions">';
      if (isAdded) {
        var importActive = action === "import";
        html +=
          '<button class="dm-btn dm-btn-sm ' +
          (importActive ? "dm-btn-primary" : "dm-btn-muted") +
          ' dm-action-btn" data-set-action="import" data-idx="' +
          i +
          '" data-type="' +
          type +
          '">&#8595; Import</button>';
        html +=
          '<button class="dm-btn dm-btn-sm ' +
          (!importActive ? "dm-btn-loss" : "dm-btn-muted") +
          ' dm-skip-btn" data-set-action="skip" data-idx="' +
          i +
          '" data-type="' +
          type +
          '">Skip</button>';
      } else {
        var keepActive = action === "keep";
        html +=
          '<button class="dm-btn dm-btn-sm ' +
          (keepActive ? "dm-btn-gain" : "dm-btn-muted") +
          ' dm-keep-btn" data-set-action="keep" data-idx="' +
          i +
          '" data-type="' +
          type +
          '">Keep</button>';
        html +=
          '<button class="dm-btn dm-btn-sm ' +
          (!keepActive ? "dm-btn-loss" : "dm-btn-muted") +
          ' dm-remove-btn" data-set-action="remove" data-idx="' +
          i +
          '" data-type="' +
          type +
          '">Remove</button>';
      }
      html += "</div>";
      html += "</div>";
    }
    if (!showAll && items.length > 30) {
      html +=
        '<div class="dm-show-more" data-show-more="' +
        type +
        '" style="text-align:center;padding:0.5rem;font-size:0.78rem;cursor:pointer;color:var(--primary)">Show ' +
        (items.length - 30) +
        " more...</div>";
    }
    html += "</div></div>";
    return html;
  }

  /** Render Modified items as conflict cards with click-to-pick field values. Returns HTML string. */
  function _renderModifiedSection(modifiedItems) {
    if (!modifiedItems || modifiedItems.length === 0) return "";

    var collapsed = _collapsedCategories.modified;
    var html = '<div class="dm-section-wrapper" data-section="modified" style="margin-top:1rem">';

    // Section header
    html += '<div class="dm-section-header">';
    html += '<div class="dm-section-title">';
    html +=
      '<span class="dm-collapse-toggle' +
      (collapsed ? " collapsed" : "") +
      '" data-cat-toggle="modified">' +
      (collapsed ? "&#9654;" : "&#9660;") +
      "</span>";
    html += '<span style="color:var(--warning)">&#9888;</span> Modified / Conflicts';
    html +=
      '<span class="dm-chip">' +
      modifiedItems.length +
      " item" +
      (modifiedItems.length !== 1 ? "s" : "") +
      "</span>";
    html += "</div>";
    html += '<div class="dm-section-actions">';
    html +=
      '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-global-action="keep-all-local">Keep All Local</button>';
    html +=
      '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-global-action="keep-all-remote">Keep All Remote</button>';
    html += "</div>";
    html += "</div>";

    // Resolve progress
    var resolvedCount = 0;
    for (var rc = 0; rc < modifiedItems.length; rc++) {
      if (_resolvedConflicts[rc]) resolvedCount++;
    }
    var remaining = modifiedItems.length - resolvedCount;
    var pct =
      modifiedItems.length > 0 ? Math.round((resolvedCount / modifiedItems.length) * 100) : 0;

    html += '<div class="dm-resolve-status">';
    html +=
      '<span class="dm-status-text">Resolved <strong>' +
      resolvedCount +
      "</strong> of <strong>" +
      modifiedItems.length +
      "</strong> conflicts</span>";
    if (remaining === 0 && modifiedItems.length > 0) {
      html += '<span class="dm-pill dm-pill-gain">All resolved &#10003;</span>';
    } else {
      html += '<span class="dm-pill dm-pill-warning">' + remaining + " remaining</span>";
    }
    html += "</div>";
    html +=
      '<div class="dm-progress-bar"><div class="dm-progress-fill" style="width:' +
      pct +
      '%"></div></div>';

    // Section body
    html += '<div class="dm-section-body' + (collapsed ? " collapsed" : "") + '">';

    for (var i = 0; i < modifiedItems.length; i++) {
      var mod = modifiedItems[i];
      var item = mod.item;
      var changes = mod.changes || [];
      var mColor = window.DiffModalSettings.metalColor(item.metal);
      var uuid = item.uuid || "";
      // Manifest stubs lack uuid/metal — resolve from local inventory by itemKey
      if (
        !uuid &&
        item.itemKey &&
        typeof inventory !== "undefined" &&
        Array.isArray(inventory) &&
        typeof DiffEngine !== "undefined" &&
        DiffEngine.computeItemKey
      ) {
        for (var ri = 0; ri < inventory.length; ri++) {
          if (DiffEngine.computeItemKey(inventory[ri]) === item.itemKey) {
            uuid = inventory[ri].uuid || "";
            if (!item.metal) mColor = window.DiffModalSettings.metalColor(inventory[ri].metal);
            break;
          }
        }
      }
      var isResolved = _resolvedConflicts[i];
      var itemKey = _itemKey(item);

      html +=
        '<div class="dm-card dm-conflict-card' +
        (isResolved ? " resolved" : "") +
        '" id="dm-conflict-' +
        i +
        '">';

      // Card header
      html +=
        '<div class="dm-conflict-card-header" data-toggle-conflict="' +
        i +
        '" style="cursor:pointer">';
      html += _renderCardHeader(item, uuid);
      // Identity
      html += '<div class="dm-item-identity">';
      html += '<div class="dm-item-name">' + _esc(item.name || "Unnamed item") + "</div>";
      html += '<div class="dm-item-meta">';
      html += '<span style="color:' + mColor + '">' + _esc(item.metal || "") + "</span>";
      if (item.weight != null)
        html +=
          "<span>&#8226;</span><span>" +
          _esc(String(item.weight)) +
          " " +
          _esc(item.weightUnit || "oz") +
          "</span>";
      html +=
        '<span>&#8226;</span><span class="dm-chip" style="font-size:0.65rem">ID: ' +
        _esc(itemKey).substring(0, 16) +
        "</span>";
      html += "</div></div>";
      // Field count pill
      if (isResolved) {
        html += '<span class="dm-pill dm-pill-gain">&#10003; Resolved</span>';
      } else {
        html +=
          '<span class="dm-pill dm-pill-warning">' +
          changes.length +
          " field" +
          (changes.length !== 1 ? "s" : "") +
          " changed</span>";
      }
      html += "</div>";

      // Conflict details (field rows)
      var detailsCollapsed = isResolved;
      html +=
        '<div class="dm-conflict-details' +
        (detailsCollapsed ? " collapsed" : "") +
        '" id="dm-conflict-details-' +
        i +
        '">';
      for (var c = 0; c < changes.length; c++) {
        var ch = changes[c];

        // Attachments: expand to per-entry rows instead of rendering the raw array
        if (
          ch.field === "attachments" &&
          window.DiffEngine &&
          typeof DiffEngine.diffAttachments === "function"
        ) {
          var attDiffs = DiffEngine.diffAttachments(ch.localVal, ch.remoteVal);
          for (var ad = 0; ad < attDiffs.length; ad++) {
            var attEntry = attDiffs[ad];
            var attUuid = attEntry.attachmentUuid;
            var attFKey = "conflict-" + i + "-attachments:" + attUuid;
            var attSel = _fieldSelections[attFKey] || "remote";
            var attLocalSel = attSel === "local" ? " selected" : "";
            var attRemoteSel = attSel === "remote" ? " selected" : "";
            var attLocalDisplay = attEntry.localVal ? _esc(attEntry.localVal.fileName) : "\u2014";
            var attRemoteDisplay = attEntry.remoteVal
              ? _esc(attEntry.remoteVal.fileName)
              : "\u2014";
            var attLabel =
              attEntry.action === "add"
                ? "Attachment (added)"
                : attEntry.action === "remove"
                  ? "Attachment (removed)"
                  : "Attachment (replaced)";
            html += '<div class="dm-field-diff">';
            html += '<div class="dm-field-label">' + _esc(attLabel) + "</div>";
            html +=
              '<div class="dm-field-value local' +
              attLocalSel +
              '" data-field="attachments:' +
              _esc(attUuid) +
              '" data-card="' +
              i +
              '" title="' +
              attLocalDisplay +
              '">' +
              attLocalDisplay +
              "</div>";
            html += '<div class="dm-field-arrow">&#10231;</div>';
            html +=
              '<div class="dm-field-value remote' +
              attRemoteSel +
              '" data-field="attachments:' +
              _esc(attUuid) +
              '" data-card="' +
              i +
              '" title="' +
              attRemoteDisplay +
              '">' +
              attRemoteDisplay +
              "</div>";
            html += "</div>";
          }
          continue;
        }

        var fKey = "conflict-" + i + "-" + ch.field;
        var sel = _fieldSelections[fKey] || "remote";
        var localSelected = sel === "local" ? " selected" : "";
        var remoteSelected = sel === "remote" ? " selected" : "";
        var localDisplay =
          ch.localVal != null && ch.localVal !== "" ? String(ch.localVal) : "\u2014";
        var remoteDisplay =
          ch.remoteVal != null && ch.remoteVal !== "" ? String(ch.remoteVal) : "\u2014";

        // \u2500\u2500 STRK-167 (AC-10): 3-way quantity reconciliation (Keep / Replace / Add) \u2500\u2500
        // Numista's "Quantity owned" is authoritative, so REPLACE is the default, but
        // the user can opt to ADD the imported count to the existing one. The qty field
        // renders a radiogroup; every other field keeps the 2-cell picker below.
        if (ch.field === "qty") {
          var sumSelected = sel === "sum" ? " selected" : "";
          var sumVal = (Number(ch.localVal) || 0) + (Number(ch.remoteVal) || 0);
          html += '<div class="dm-field-diff dm-field-diff-qty">';
          html += '<div class="dm-field-label">Quantity</div>';
          html +=
            '<div class="dm-qty-options" role="radiogroup" aria-label="How to reconcile quantity">';
          html +=
            '<div class="dm-field-value dm-qty-opt local' +
            localSelected +
            '" role="radio" aria-checked="' +
            (sel === "local") +
            '" tabindex="0" data-field="qty" data-card="' +
            i +
            '" title="Keep your existing quantity (' +
            _esc(localDisplay) +
            ')"><span class="dm-qty-verb">Keep</span><span class="dm-qty-num">' +
            _esc(localDisplay) +
            "</span></div>";
          html +=
            '<div class="dm-field-value dm-qty-opt remote' +
            remoteSelected +
            '" role="radio" aria-checked="' +
            (sel === "remote") +
            '" tabindex="0" data-field="qty" data-card="' +
            i +
            '" title="Replace with the imported quantity (' +
            _esc(remoteDisplay) +
            ')"><span class="dm-qty-verb">Replace</span><span class="dm-qty-num">' +
            _esc(remoteDisplay) +
            "</span></div>";
          html +=
            '<div class="dm-field-value dm-qty-opt sum' +
            sumSelected +
            '" role="radio" aria-checked="' +
            (sel === "sum") +
            '" tabindex="0" data-field="qty" data-card="' +
            i +
            '" title="Add the imported quantity to your existing one (' +
            _esc(localDisplay) +
            " + " +
            _esc(remoteDisplay) +
            " = " +
            sumVal +
            ')"><span class="dm-qty-verb">Add to existing</span><span class="dm-qty-num">' +
            _esc(localDisplay) +
            " + " +
            _esc(remoteDisplay) +
            " = " +
            sumVal +
            "</span></div>";
          html += "</div>"; // .dm-qty-options
          html += "</div>"; // .dm-field-diff-qty
          continue;
        }

        html += '<div class="dm-field-diff">';
        html += '<div class="dm-field-label">' + _esc(ch.field) + "</div>";
        html +=
          '<div class="dm-field-value local' +
          localSelected +
          '" data-field="' +
          _esc(ch.field) +
          '" data-card="' +
          i +
          '" title="' +
          _esc(localDisplay) +
          '">' +
          _esc(localDisplay) +
          "</div>";
        html += '<div class="dm-field-arrow">&#10231;</div>';
        html +=
          '<div class="dm-field-value remote' +
          remoteSelected +
          '" data-field="' +
          _esc(ch.field) +
          '" data-card="' +
          i +
          '" title="' +
          _esc(remoteDisplay) +
          '">' +
          _esc(remoteDisplay) +
          "</div>";
        html += "</div>";
      }
      // Card actions
      html += '<div class="dm-card-actions">';
      html +=
        '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-card-action="keep-local" data-card="' +
        i +
        '">Keep All Local</button>';
      html +=
        '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-card-action="keep-remote" data-card="' +
        i +
        '">Keep All Remote</button>';
      html +=
        '<button class="dm-btn dm-btn-sm dm-btn-primary" data-card-action="resolve" data-card="' +
        i +
        '">&#10003; Confirm</button>';
      html += "</div>";
      html += "</div>"; // .dm-conflict-details

      html += "</div>"; // .dm-conflict-card
    }

    html += "</div></div>";
    return html;
  }

  /** Load images asynchronously using resolveImageUrlForItem (same as main app) */
  function _loadItemImages() {
    try {
      // Revoke previous blob URLs to prevent memory leaks
      for (var bi = 0; bi < _blobUrls.length; bi++) {
        try {
          URL.revokeObjectURL(_blobUrls[bi]);
        } catch (e) {
          /* ignore */
        }
      }
      _blobUrls = [];

      var modal = safeGetElement(MODAL_ID);
      if (!modal || typeof imageCache === "undefined" || !imageCache.resolveImageUrlForItem) return;

      // Build UUID → item lookup from current diff data
      var itemByUuid = {};
      var diff = _options ? _options.diff || {} : {};
      var allItems = (diff.added || []).concat(diff.deleted || []);
      for (var mi = 0; mi < (diff.modified || []).length; mi++) {
        var modEntry = (diff.modified || [])[mi];
        var modItem = modEntry.item;
        if (modItem && modItem.uuid) {
          // For modified items, the item is the LOCAL version which may lack
          // image URLs on the pulling device. Check the diff changes for
          // remote image URLs and merge them so thumbnails can resolve.
          var mergedItem = modItem;
          var modChanges = modEntry.changes || [];
          for (var mci = 0; mci < modChanges.length; mci++) {
            var ch = modChanges[mci];
            if (
              (ch.field === "obverseImageUrl" || ch.field === "reverseImageUrl") &&
              ch.remoteVal &&
              !modItem[ch.field]
            ) {
              // Lazy-clone on first image URL merge to avoid mutating diff data
              if (mergedItem === modItem) {
                mergedItem = {};
                for (var mk in modItem) {
                  if (modItem.hasOwnProperty(mk)) mergedItem[mk] = modItem[mk];
                }
              }
              mergedItem[ch.field] = ch.remoteVal;
            }
          }
          itemByUuid[mergedItem.uuid] = mergedItem;
        } else if (modItem && modItem.itemKey) {
          // Manifest stub — resolve from local inventory by itemKey
          if (
            typeof inventory !== "undefined" &&
            Array.isArray(inventory) &&
            typeof DiffEngine !== "undefined" &&
            DiffEngine.computeItemKey
          ) {
            for (var ri = 0; ri < inventory.length; ri++) {
              if (
                DiffEngine.computeItemKey(inventory[ri]) === modItem.itemKey &&
                inventory[ri].uuid
              ) {
                var resolved = inventory[ri];
                // Merge remote image URLs from changes if local item lacks them
                var resolvedMerged = resolved;
                var rmChanges = modEntry.changes || [];
                for (var rci = 0; rci < rmChanges.length; rci++) {
                  var rch = rmChanges[rci];
                  if (
                    (rch.field === "obverseImageUrl" || rch.field === "reverseImageUrl") &&
                    rch.remoteVal &&
                    !resolved[rch.field]
                  ) {
                    if (resolvedMerged === resolved) {
                      resolvedMerged = {};
                      for (var rk in resolved) {
                        if (resolved.hasOwnProperty(rk)) resolvedMerged[rk] = resolved[rk];
                      }
                    }
                    resolvedMerged[rch.field] = rch.remoteVal;
                  }
                }
                itemByUuid[resolvedMerged.uuid] = resolvedMerged;
                break;
              }
            }
          }
        } else {
          allItems.push(modItem);
        }
      }
      for (var ai = 0; ai < allItems.length; ai++) {
        if (allItems[ai] && allItems[ai].uuid) {
          itemByUuid[allItems[ai].uuid] = allItems[ai];
        }
      }

      var thumbs = modal.querySelectorAll("[data-uuid]");
      for (var t = 0; t < thumbs.length; t++) {
        (function (el) {
          var uuid = el.dataset.uuid;
          var side = el.dataset.side || "obverse";
          if (!uuid) return;
          var item = itemByUuid[uuid];
          if (!item) return;
          try {
            imageCache
              .resolveImageUrlForItem(item, side)
              .then(function (url) {
                var imgUrl = url;
                if (!imgUrl) {
                  // Fallback: CDN URL from item properties (same as main app tier 2)
                  var urlKey = side === "reverse" ? "reverseImageUrl" : "obverseImageUrl";
                  var cdnUrl = item[urlKey];
                  if (cdnUrl && /^https?:\/\/[^\s"'<>]+$/i.test(cdnUrl)) {
                    imgUrl = cdnUrl;
                  }
                }
                if (imgUrl) {
                  if (imgUrl.indexOf("blob:") === 0) _blobUrls.push(imgUrl);
                  var img = document.createElement("img");
                  img.src = imgUrl;
                  img.alt = side;
                  img.style.cssText =
                    "width:100%;height:100%;object-fit:cover;border-radius:var(--radius,8px)";
                  el.textContent = "";
                  el.appendChild(img);
                }
              })
              .catch(function () {
                /* silent fallback to OBV/REV text */
              });
          } catch (e) {
            /* imageCache not available */
          }
        })(thumbs[t]);
      }
    } catch (e) {
      /* silent */
    }
  }

  function _updateApplyButton() {
    var applyBtn = safeGetElement("diffReviewApplyBtn");
    if (!applyBtn) return;
    var count = _checkedCount();
    var hasSelectableItems = Object.keys(_checkedItems).length > 0;
    var hasSettings =
      _options &&
      _options.settingsDiff &&
      _options.settingsDiff.changed &&
      _options.settingsDiff.changed.length > 0;
    applyBtn.textContent = count > 0 ? "Apply (" + count + ")" : "Apply";
    applyBtn.disabled = hasSelectableItems && count === 0 && !hasSettings;
    applyBtn.style.opacity = hasSelectableItems && count === 0 && !hasSettings ? "0.4" : "";
  }

  function _render() {
    if (!_options) return;

    var titleEl = safeGetElement("diffReviewTitle");
    var sourceEl = safeGetElement("diffReviewSource");

    var diff = _options.diff || {};
    var added = diff.added || [];
    var modified = diff.modified || [];
    var deleted = diff.deleted || [];
    var conflicts = _options.conflicts;
    var meta = _options.meta;
    var source = _options.source || {};

    // Title
    if (titleEl) titleEl.textContent = _getTitle(source);

    // Source badge + meta
    if (sourceEl) {
      var sourceHtml =
        '<div style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.78rem;font-weight:500;padding:0.2rem 0.55rem;border-radius:6px;background:color-mix(in srgb, var(--primary) 12%, transparent);color:var(--primary)">';
      sourceHtml += _getSourceIcon(source) + _esc(source.label || "");
      sourceHtml += "</div>";

      // Meta row (sync only)
      if (meta && source.type === "sync") {
        sourceHtml +=
          '<div class="cloud-sync-update-meta" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:0.5rem;margin-top:0.6rem;padding:0.5rem 0.65rem;border-radius:8px;background:var(--bg-secondary);font-size:0.8rem">';
        sourceHtml += _metaCell(
          "Remote Items",
          meta.itemCount != null ? String(meta.itemCount) : "\u2014"
        );
        if (typeof inventory !== "undefined") {
          const localItemCount =
            typeof cloudSafeItemCount === "function"
              ? cloudSafeItemCount()
              : Array.isArray(inventory)
                ? inventory.length
                : 0;
          sourceHtml += _metaCell(
            "Local Items",
            localItemCount != null ? String(localItemCount) : "—"
          );
        }
        sourceHtml += _metaCell(
          "Device",
          meta.deviceId ? meta.deviceId.slice(0, 8) + "\u2026" : "unknown"
        );
        sourceHtml += _metaCell("Version", meta.appVersion ? "v" + meta.appVersion : "\u2014");
        sourceHtml += "</div>";
      }

      sourceEl.innerHTML = sourceHtml;
    }

    // Count row (backup import flow only)
    _updateCountRow();

    // Summary dashboard (replaces old summary chips)
    _renderSummaryDashboard(safeGetElement("diffSummaryDashboard"), diff, conflicts);

    // Legacy progress tracker and conflict cards — suppressed.
    // The card-based Modified section has its own progress bar and click-to-pick UX.
    var progressEl = safeGetElement("diffProgressTracker");
    if (progressEl) progressEl.style.display = "none";
    var conflictEl = safeGetElement("diffSectionConflicts");
    if (conflictEl) conflictEl.style.display = "none";

    // Orphan cards (Added + Deleted) — render into #diffSectionOrphans
    var orphanEl = safeGetElement("diffSectionOrphans");
    if (orphanEl) {
      var orphanHtml = "";
      if (added.length > 0) orphanHtml += _renderOrphanCards("added", added);
      if (deleted.length > 0) orphanHtml += _renderOrphanCards("deleted", deleted);
      orphanEl.innerHTML = orphanHtml;
      orphanEl.style.display = orphanHtml ? "" : "none";
    }

    // Modified conflict cards — render into #diffSectionModified
    var modifiedEl = safeGetElement("diffSectionModified");
    if (modifiedEl) {
      var modHtml = "";
      if (modified.length > 0) {
        modHtml = _renderModifiedSection(modified);
      } else {
        var totalChanges = added.length + deleted.length;
        if (totalChanges === 0) {
          modHtml =
            '<div style="padding:2rem;text-align:center;opacity:0.45;font-size:0.85rem">No item changes detected</div>';
        }
      }
      modifiedEl.innerHTML = modHtml;
    }

    // Async image loading
    _loadItemImages();

    // Settings cards (replaces old settings <details>)
    _renderSettingsCards(safeGetElement("diffReviewSettings"), _options.settingsDiff);

    // Apply button
    _updateApplyButton();
  }

  /** Render a meta cell for the source info row */
  function _metaCell(label, value) {
    return (
      '<div style="display:flex;flex-direction:column;gap:0.1rem">' +
      '<span style="font-size:0.65rem;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em">' +
      _esc(label) +
      "</span>" +
      '<strong style="font-weight:600">' +
      _esc(value) +
      "</strong>" +
      "</div>"
    );
  }

  // _renderCategory() has been replaced by _renderOrphanCards() and _renderModifiedSection() (STAK-454)

  // ── Event delegation (STAK-454 — card-based interactions) ──

  /** Swap a button's style class based on active state */
  function _swapBtnClass(btn, actionName, isActive) {
    btn.classList.remove(
      "dm-btn-primary",
      "dm-btn-gain",
      "dm-btn-loss",
      "dm-btn-muted",
      "dm-btn-secondary"
    );
    if (!isActive) {
      btn.classList.add("dm-btn-muted");
      return;
    }
    // Active: positive actions get their accent color, negative actions get loss
    if (actionName === "import") btn.classList.add("dm-btn-primary");
    else if (actionName === "keep") btn.classList.add("dm-btn-gain");
    else btn.classList.add("dm-btn-loss"); // skip, remove
  }

  /** Update both action buttons on an orphan card to reflect the current action */
  function _updateOrphanBtnStyles(card, action) {
    var btns = card.querySelectorAll("[data-set-action]");
    for (var bi = 0; bi < btns.length; bi++) {
      var btnAction = btns[bi].dataset.setAction;
      _swapBtnClass(btns[bi], btnAction, btnAction === action);
    }
  }

  /** Handle clicks on orphan cards (Added/Deleted) */
  function _onOrphanClick(e) {
    var target = e.target;

    // Orphan card action button (Import/Skip/Keep/Remove)
    var actionBtn = target.closest("[data-set-action]");
    if (actionBtn) {
      e.stopPropagation();
      var action = actionBtn.dataset.setAction;
      var idx = parseInt(actionBtn.dataset.idx, 10);
      var type = actionBtn.dataset.type;
      var key = type + "-" + idx;
      _orphanActions[key] = action;
      // Also sync _checkedItems for backward compat
      if (type === "added") _checkedItems[key] = action !== "skip";
      if (type === "deleted") _checkedItems[key] = action === "remove";
      // Toggle visual state on card and buttons
      var card = actionBtn.closest(".dm-orphan-card");
      if (card) {
        var isSkipped = action === "skip" || action === "remove";
        card.classList.toggle("skipped", isSkipped);
        card.dataset.action = action;
        _updateOrphanBtnStyles(card, action);
      }
      _updateApplyCount();
      return;
    }

    // Bulk action buttons (Import All, Skip All, Keep All, Remove All)
    var bulkBtn = target.closest("[data-bulk-action]");
    if (bulkBtn) {
      var bulkAction = bulkBtn.dataset.bulkAction;
      var bulkSection = bulkBtn.dataset.bulkSection;
      var cards = e.currentTarget.querySelectorAll(
        '.dm-orphan-card[data-type="' + bulkSection + '"]'
      );
      for (var bi = 0; bi < cards.length; bi++) {
        var bCard = cards[bi];
        var bIdx = parseInt(bCard.dataset.idx, 10);
        var bKey = bulkSection + "-" + bIdx;
        _orphanActions[bKey] = bulkAction;
        if (bulkSection === "added") _checkedItems[bKey] = bulkAction !== "skip";
        if (bulkSection === "deleted") _checkedItems[bKey] = bulkAction === "remove";
        var bSkipped = bulkAction === "skip" || bulkAction === "remove";
        bCard.classList.toggle("skipped", bSkipped);
        bCard.dataset.action = bulkAction;
        _updateOrphanBtnStyles(bCard, bulkAction);
      }
      // Update bulk button styles in section header
      var sectionWrapper = bulkBtn.closest(".dm-section-wrapper");
      if (sectionWrapper) {
        var bulkBtns = sectionWrapper.querySelectorAll("[data-bulk-action]");
        for (var bbi = 0; bbi < bulkBtns.length; bbi++) {
          var bb = bulkBtns[bbi];
          var isActive = bb.dataset.bulkAction === bulkAction;
          _swapBtnClass(bb, bb.dataset.bulkAction, isActive);
        }
      }
      _updateApplyCount();
      return;
    }

    // Section collapse toggle
    var catToggle = target.closest("[data-cat-toggle]");
    if (catToggle) {
      var cat = catToggle.dataset.catToggle;
      _collapsedCategories[cat] = !_collapsedCategories[cat];
      _render();
      return;
    }

    // Show more button
    var showMore = target.closest("[data-show-more]");
    if (showMore) {
      var smType = showMore.dataset.showMore;
      // Remove the limit and re-render (set a flag to show all)
      _collapsedCategories["_showAll_" + smType] = true;
      _render();
      return;
    }
  }

  /** Handle clicks on modified/conflict cards — dispatch to the matched control. */
  function _onModifiedClick(e) {
    var target = e.target;

    // Field value click (click to pick local or remote)
    var fieldVal = target.closest(".dm-field-value");
    if (fieldVal && fieldVal.dataset.field && fieldVal.dataset.card != null) {
      _handleFieldValuePick(fieldVal);
      return;
    }

    // Per-card action buttons (Keep All Local, Keep All Remote, Confirm)
    var cardAction = target.closest("[data-card-action]");
    if (cardAction) {
      _handleCardAction(cardAction, e);
      return;
    }

    // Global Keep All Local / Keep All Remote
    var globalAction = target.closest("[data-global-action]");
    if (globalAction) {
      _handleGlobalAction(globalAction, e);
      return;
    }

    // Conflict card header click — toggle expand/collapse
    var conflictToggle = target.closest("[data-toggle-conflict]");
    if (conflictToggle) {
      var tIdx = parseInt(conflictToggle.dataset.toggleConflict, 10);
      var tDetails = e.currentTarget.querySelector("#dm-conflict-details-" + tIdx);
      if (tDetails) tDetails.classList.toggle("collapsed");
      return;
    }

    // Section collapse toggle
    var catToggle = target.closest("[data-cat-toggle]");
    if (catToggle) {
      var cat = catToggle.dataset.catToggle;
      _collapsedCategories[cat] = !_collapsedCategories[cat];
      _render();
      return;
    }
  }

  /**
   * Field-value pick: record the chosen side (local / sum / remote) and sync the
   * selected/aria-checked visual state across the row's siblings.
   * @param {HTMLElement} fieldVal - the clicked .dm-field-value cell
   */
  function _handleFieldValuePick(fieldVal) {
    var field = fieldVal.dataset.field;
    var cardIdx = parseInt(fieldVal.dataset.card, 10);
    var fKey = "conflict-" + cardIdx + "-" + field;
    // STRK-167 (AC-10): qty rows add a third "sum" choice alongside local/remote.
    var side = fieldVal.classList.contains("local")
      ? "local"
      : fieldVal.classList.contains("sum")
        ? "sum"
        : "remote";
    _fieldSelections[fKey] = side;
    // Update visual: remove selected from siblings, add to clicked.
    var row = fieldVal.closest(".dm-field-diff");
    if (row) {
      var siblings = row.querySelectorAll(".dm-field-value");
      for (var si = 0; si < siblings.length; si++) {
        siblings[si].classList.remove("selected");
        // STRK-167 (AC-10) a11y: keep aria-checked in sync on radio-style qty cells.
        if (siblings[si].getAttribute("role") === "radio") {
          siblings[si].setAttribute("aria-checked", "false");
        }
      }
    }
    fieldVal.classList.add("selected");
    if (fieldVal.getAttribute("role") === "radio") {
      fieldVal.setAttribute("aria-checked", "true");
    }
    _updateApplyCount();
  }

  /**
   * Per-card action button: Keep All Local / Keep All Remote bulk-picks one side,
   * Confirm validates and resolves the card.
   * @param {HTMLElement} cardAction - the clicked [data-card-action] button
   * @param {Event} e - the delegated click event (currentTarget = card container)
   */
  function _handleCardAction(cardAction, e) {
    var action = cardAction.dataset.cardAction;
    var ci = parseInt(cardAction.dataset.card, 10);
    var card = e.currentTarget.querySelector("#dm-conflict-" + ci);
    if (!card) return;

    if (action === "keep-local" || action === "keep-remote") {
      _applyCardSide(card, ci, action === "keep-local" ? "local" : "remote");
      _updateApplyCount();
      return;
    }

    if (action === "resolve") {
      _resolveConflictCard(card, ci);
    }
  }

  /**
   * Bulk-pick one side for every field in a conflict card, syncing selected state
   * and the per-field _fieldSelections.
   * @param {HTMLElement} card - the conflict card element
   * @param {number} ci - the card index
   * @param {string} pickSide - "local" or "remote"
   */
  function _applyCardSide(card, ci, pickSide) {
    var fieldVals = card.querySelectorAll(".dm-field-value." + pickSide);
    for (var fvi = 0; fvi < fieldVals.length; fvi++) {
      var fv = fieldVals[fvi];
      var fRow = fv.closest(".dm-field-diff");
      if (fRow) {
        var fSiblings = fRow.querySelectorAll(".dm-field-value");
        for (var fsi = 0; fsi < fSiblings.length; fsi++)
          fSiblings[fsi].classList.remove("selected");
      }
      fv.classList.add("selected");
      if (fv.dataset.field) {
        _fieldSelections["conflict-" + ci + "-" + fv.dataset.field] = pickSide;
      }
    }
  }

  /**
   * Confirm a conflict card: flash any unresolved fields and bail, else mark the
   * card resolved, collapse it, and refresh the progress + apply count.
   * @param {HTMLElement} card - the conflict card element
   * @param {number} ci - the card index
   */
  function _resolveConflictCard(card, ci) {
    // Validate all fields have a selection
    var fieldDiffs = card.querySelectorAll(".dm-field-diff");
    var allResolved = true;
    for (var fd = 0; fd < fieldDiffs.length; fd++) {
      if (!fieldDiffs[fd].querySelector(".dm-field-value.selected")) {
        allResolved = false;
        // Flash unresolved field
        fieldDiffs[fd].style.background =
          `color-mix(in srgb, ${getThemeColor("danger")} 10%, transparent)`;
        (function (el) {
          setTimeout(function () {
            el.style.background = "";
          }, 600);
        })(fieldDiffs[fd]);
      }
    }
    if (!allResolved) return;

    // Mark resolved
    _resolvedConflicts[ci] = true;
    card.classList.add("resolved");
    var pill = card.querySelector(".dm-conflict-card-header .dm-pill");
    if (pill) {
      pill.className = "dm-pill dm-pill-gain";
      pill.innerHTML = "&#10003; Resolved";
    }
    // Collapse the details
    var details = card.querySelector(".dm-conflict-details");
    if (details) details.classList.add("collapsed");

    // Update progress
    _updateModifiedProgress();
    _updateApplyCount();
  }

  /**
   * Global Keep All Local / Keep All Remote: pick one side across every conflict
   * field in the modal, syncing selected state and _fieldSelections.
   * @param {HTMLElement} globalAction - the clicked [data-global-action] button
   * @param {Event} e - the delegated click event (currentTarget = card container)
   */
  function _handleGlobalAction(globalAction, e) {
    var gAction = globalAction.dataset.globalAction;
    var gSide = gAction === "keep-all-local" ? "local" : "remote";
    var allFieldVals = e.currentTarget.querySelectorAll(".dm-field-value." + gSide);
    for (var gfi = 0; gfi < allFieldVals.length; gfi++) {
      var gfv = allFieldVals[gfi];
      var gRow = gfv.closest(".dm-field-diff");
      if (gRow) {
        var gSiblings = gRow.querySelectorAll(".dm-field-value");
        for (var gsi = 0; gsi < gSiblings.length; gsi++)
          gSiblings[gsi].classList.remove("selected");
      }
      gfv.classList.add("selected");
      if (gfv.dataset.field && gfv.dataset.card != null) {
        _fieldSelections["conflict-" + gfv.dataset.card + "-" + gfv.dataset.field] = gSide;
      }
    }
    _updateApplyCount();
  }

  /**
   * STRK-167 (AC-10) a11y: activate a focused qty radio on Space/Enter. Native
   * div[role=radio] elements do not synthesize a click for these keys, so without
   * this the 3-way quantity control cannot be operated by keyboard or screen reader.
   */
  function _onModifiedKeydown(e) {
    if (e.key !== " " && e.key !== "Enter" && e.key !== "Spacebar") return;
    var target = e.target;
    if (!target || typeof target.getAttribute !== "function") return;
    if (target.getAttribute("role") !== "radio") return;
    e.preventDefault();
    target.click();
  }

  /** Update the modified section's progress bar and status text */
  function _updateModifiedProgress() {
    var diff = _options ? _options.diff || {} : {};
    var modified = diff.modified || [];
    if (modified.length === 0) return;
    var resolved = 0;
    for (var i = 0; i < modified.length; i++) {
      if (_resolvedConflicts[i]) resolved++;
    }
    var remaining = modified.length - resolved;
    var pct = Math.round((resolved / modified.length) * 100);

    // Update progress bar
    var bar = safeGetElement("diffSectionModified");
    if (bar) {
      var fill = bar.querySelector(".dm-progress-fill");
      if (fill) fill.style.width = pct + "%";
      var statusText = bar.querySelector(".dm-status-text");
      if (statusText)
        statusText.innerHTML =
          "Resolved <strong>" +
          resolved +
          "</strong> of <strong>" +
          modified.length +
          "</strong> conflicts";
      var pillEl = bar.querySelector(".dm-resolve-status .dm-pill");
      if (pillEl) {
        if (remaining === 0) {
          pillEl.className = "dm-pill dm-pill-gain";
          pillEl.innerHTML = "All resolved &#10003;";
        } else {
          pillEl.className = "dm-pill dm-pill-warning";
          pillEl.textContent = remaining + " remaining";
        }
      }
    }
  }

  /** Count selected items for the Apply button (card-based state) */
  function _cardBasedCount() {
    var count = 0;
    var diff = _options ? _options.diff || {} : {};
    var added = diff.added || [];
    var modified = diff.modified || [];
    var deleted = diff.deleted || [];

    for (var a = 0; a < added.length; a++) {
      if (_orphanActions["added-" + a] !== "skip") count++;
    }
    for (var m = 0; m < modified.length; m++) {
      count++; // modified items always included (user picks field winners)
    }
    for (var d = 0; d < deleted.length; d++) {
      if (_orphanActions["deleted-" + d] === "remove") count++;
    }
    return count;
  }

  /** Update just the Apply button count without full re-render */
  function _updateApplyCount() {
    var applyBtn = safeGetElement("diffReviewApplyBtn");
    if (applyBtn) {
      var hasCardState =
        Object.keys(_orphanActions).length > 0 || Object.keys(_fieldSelections).length > 0;
      var count = hasCardState ? _cardBasedCount() : _checkedCount();
      var hasSettings =
        _options &&
        _options.settingsDiff &&
        _options.settingsDiff.changed &&
        _options.settingsDiff.changed.length > 0;
      applyBtn.textContent = count > 0 ? "Apply (" + count + ")" : "Apply";
      applyBtn.disabled = count === 0 && !hasSettings;
      applyBtn.style.opacity = count === 0 && !hasSettings ? "0.4" : "";
    }
    _updateCountRow();
  }

  // ── Select All / Deselect All ──

  /**
   * Apply an orphan action + checkbox state to every added item.
   * @param {object} diff - active diff ({ added, modified, deleted })
   * @param {string} action - orphan action ("import" or "skip")
   * @param {boolean} checked - checkbox state mirrored into _checkedItems
   */
  function _setAddedItems(diff, action, checked) {
    var added = diff.added || [];
    for (var i = 0; i < added.length; i++) {
      _orphanActions["added-" + i] = action;
      _checkedItems["added-" + i] = checked;
    }
  }

  /**
   * Apply an orphan action + checkbox state to every deleted item.
   * @param {object} diff - active diff
   * @param {string} action - orphan action ("keep" or "remove")
   * @param {boolean} checked - checkbox state mirrored into _checkedItems
   */
  function _setDeletedItems(diff, action, checked) {
    var deleted = diff.deleted || [];
    for (var k = 0; k < deleted.length; k++) {
      _orphanActions["deleted-" + k] = action;
      _checkedItems["deleted-" + k] = checked;
    }
  }

  /**
   * Set every modified item's per-field selections to one side, optionally marking
   * the item's checkbox. Used by Select All (remote) and Deselect All (local).
   * @param {object} diff - active diff
   * @param {string} side - "local" or "remote"
   * @param {boolean} markChecked - when true, also set _checkedItems["modified-j"]=true
   */
  function _setModifiedFields(diff, side, markChecked) {
    var modified = diff.modified || [];
    for (var j = 0; j < modified.length; j++) {
      if (markChecked) _checkedItems["modified-" + j] = true;
      var mod = modified[j];
      if (mod && mod.changes) {
        for (var c = 0; c < mod.changes.length; c++) {
          _fieldSelections["conflict-" + j + "-" + mod.changes[c].field] = side;
        }
      }
    }
  }

  /** Clear every currently-tracked item checkbox (set all _checkedItems false). */
  function _clearCheckedItems() {
    for (var k in _checkedItems) {
      if (_checkedItems.hasOwnProperty(k)) _checkedItems[k] = false;
    }
  }

  /** Select every importable change: import added, remote-win modified, remove deleted. */
  function _selectAll() {
    var diff = _options.diff || {};
    _setAddedItems(diff, "import", true);
    _setModifiedFields(diff, "remote", true);
    _setDeletedItems(diff, "remove", true);
    _render();
  }

  /** Deselect everything: skip added, keep deleted, reset modified fields to local. */
  function _deselectAll() {
    var diff = _options.diff || {};
    _setAddedItems(diff, "skip", false);
    _clearCheckedItems();
    _setDeletedItems(diff, "keep", false);
    _setModifiedFields(diff, "local", false);
    _render();
  }

  /**
   * Cycle the backup-import "Select All" control through its three states:
   *   1 = import added + remote-win modified (deleted left untouched/kept),
   *   2 = additionally mark deleted for removal,
   *   0 = deselect everything (added skipped, modified reset to local).
   */
  function _toggleSelectAll() {
    var diff = _options ? _options.diff || {} : {};
    _selectAllState = (_selectAllState + 1) % 3;
    if (_selectAllState === 1) {
      _setAddedItems(diff, "import", true);
      _setModifiedFields(diff, "remote", true);
      _setDeletedItems(diff, "keep", false);
    } else if (_selectAllState === 2) {
      _setDeletedItems(diff, "remove", true);
    } else {
      _setAddedItems(diff, "skip", false);
      _clearCheckedItems();
      _setDeletedItems(diff, "keep", false);
      _setModifiedFields(diff, "local", false);
    }
    var toggleBtn = safeGetElement("diffReviewSelectAllToggle");
    if (toggleBtn) {
      var labels = ["Select All", "Add Deleted", "Deselect All"];
      toggleBtn.textContent = labels[_selectAllState];
    }
    _render();
  }

  // ── Apply / Cancel ──

  /**
   * Reconstruct a merged setting value from per-element _fieldSelections.
   * Returns merged value, or null on type mismatch (caller falls back to whole-setting).
   */
  function _mergeSettingElements(type, key, localVal, remoteVal) {
    var prefix = "setting-" + key + "-";
    if (type === "chip-strip") return _mergeChipStrip(prefix, localVal, remoteVal);
    if (type === "toggle-map" || type === "kv-pills") {
      return _mergeKeyedObject(prefix, localVal, remoteVal);
    }
    if (type === "slug-chips") return _mergeSlugChips(prefix, localVal, remoteVal);
    return null; // unknown type — fallback
  }

  /**
   * Merge a chip-strip array setting by element id. Remote order is the base
   * (default wins); a local element substitutes where the user picked "local", and
   * local-only elements append at the end unless explicitly deselected.
   * @param {string} prefix - _fieldSelections key prefix ("setting-<key>-")
   * @param {*} localVal - local value (array of {id,label,enabled,...})
   * @param {*} remoteVal - remote value
   * @returns {Array|null} merged array, or null when neither side is an array
   */
  function _mergeChipStrip(prefix, localVal, remoteVal) {
    if (!Array.isArray(localVal) && !Array.isArray(remoteVal)) return null;
    var lArr = Array.isArray(localVal) ? localVal : [];
    var rArr = Array.isArray(remoteVal) ? remoteVal : [];
    var lById = {};
    var i, id;
    for (i = 0; i < lArr.length; i++) {
      id = lArr[i].id || lArr[i].label || i;
      lById[id] = lArr[i];
    }
    // Preserve original array order — use remote array as base order (default wins),
    // then append any local-only items at the end
    var merged = [];
    var seen = {};
    // First pass: iterate remote array in order
    for (i = 0; i < rArr.length; i++) {
      id = rArr[i].id || rArr[i].label || i;
      var sel = _fieldSelections[prefix + id];
      if (sel === "local" && lById[id]) {
        merged.push(lById[id]);
      } else {
        merged.push(rArr[i]); // default: remote wins
      }
      seen[id] = true;
    }
    // Second pass: append local-only items (preserving local order)
    for (i = 0; i < lArr.length; i++) {
      id = lArr[i].id || lArr[i].label || i;
      if (!seen[id]) {
        var lSel = _fieldSelections[prefix + id];
        if (lSel === "local" || !lSel) {
          merged.push(lArr[i]); // local-only, user picked local or no selection
        }
      }
    }
    return merged;
  }

  /**
   * Merge an object-shaped setting (toggle-map / kv-pills) key by key. Each key
   * resolves to its picked side, defaulting to remote when present, else local.
   * @param {string} prefix - _fieldSelections key prefix ("setting-<key>-")
   * @param {*} localVal - local value (object)
   * @param {*} remoteVal - remote value (object)
   * @returns {object|null} merged object, or null when neither side is an object
   */
  function _mergeKeyedObject(prefix, localVal, remoteVal) {
    if (
      (typeof localVal !== "object" || localVal === null) &&
      (typeof remoteVal !== "object" || remoteVal === null)
    )
      return null;
    var lObj = typeof localVal === "object" && localVal !== null ? localVal : {};
    var rObj = typeof remoteVal === "object" && remoteVal !== null ? remoteVal : {};
    var result = {};
    var allKeys = {};
    var k;
    for (k in lObj) allKeys[k] = true;
    for (k in rObj) allKeys[k] = true;
    for (k in allKeys) {
      var kSel = _fieldSelections[prefix + k];
      if (kSel === "local" && lObj.hasOwnProperty(k)) {
        result[k] = lObj[k];
      } else if (kSel === "remote" && rObj.hasOwnProperty(k)) {
        result[k] = rObj[k];
      } else if (rObj.hasOwnProperty(k)) {
        result[k] = rObj[k]; // default: remote
      } else if (lObj.hasOwnProperty(k)) {
        result[k] = lObj[k]; // only in local
      }
    }
    return result;
  }

  /**
   * Merge a slug-chips string-array setting as an order-preserving set. Remote
   * order leads; common slugs always survive; remote-only and local-only slugs are
   * included per the user's per-slug pick (default remote-keep, local opt-in).
   * @param {string} prefix - _fieldSelections key prefix ("setting-<key>-")
   * @param {*} localVal - local value (string array)
   * @param {*} remoteVal - remote value (string array)
   * @returns {Array|null} merged slug array, or null when neither side is an array
   */
  function _mergeSlugChips(prefix, localVal, remoteVal) {
    if (!Array.isArray(localVal) && !Array.isArray(remoteVal)) return null;
    var lSet = {};
    var lList = Array.isArray(localVal) ? localVal : [];
    var rList = Array.isArray(remoteVal) ? remoteVal : [];
    var i;
    for (i = 0; i < lList.length; i++) lSet[lList[i]] = true;
    var mergedArr = [];
    var slugSeen = {};
    // First pass: iterate remote array in order (default wins)
    for (i = 0; i < rList.length; i++) {
      var rSlug = rList[i];
      slugSeen[rSlug] = true;
      if (lSet[rSlug]) {
        mergedArr.push(rSlug); // common — always include
      } else {
        var rSlugSel = _fieldSelections[prefix + rSlug];
        if (rSlugSel === "remote" || !rSlugSel) {
          mergedArr.push(rSlug); // remote-only, user picked remote or default
        }
      }
    }
    // Second pass: append local-only items (preserving local order)
    for (i = 0; i < lList.length; i++) {
      var lSlug = lList[i];
      if (!slugSeen[lSlug]) {
        var lSlugSel = _fieldSelections[prefix + lSlug];
        if (lSlugSel === "local") {
          mergedArr.push(lSlug); // local-only, user picked local
        }
      }
    }
    return mergedArr;
  }

  function _buildSelectedChanges() {
    var diff = _options.diff || {};
    var result = [];
    var hasCardState =
      Object.keys(_orphanActions).length > 0 || Object.keys(_fieldSelections).length > 0;
    _collectAddedChanges(diff, hasCardState, result);
    _collectModifiedChanges(diff, hasCardState, result);
    _collectDeletedChanges(diff, hasCardState, result);
    _collectConflictChanges(result);
    _collectSettingsChanges(result);
    return result;
  }

  /**
   * Append {type:"add"} records for added orphans the user kept. With card state,
   * inclusion follows the orphan action (≠ "skip"); legacy mode uses the checkbox.
   * @param {object} diff - active diff
   * @param {boolean} hasCardState - whether card-based selections are present
   * @param {Array} result - accumulator pushed into
   */
  function _collectAddedChanges(diff, hasCardState, result) {
    var added = diff.added || [];
    for (var a = 0; a < added.length; a++) {
      var includeAdded = hasCardState
        ? _orphanActions["added-" + a] !== "skip"
        : _checkedItems["added-" + a] !== false;
      if (includeAdded) {
        result.push({ type: "add", item: added[a] });
      }
    }
  }

  /**
   * Append modify / attach-entry records for each modified item, routing to the
   * card-based per-field picker or the legacy all-remote fallback.
   * @param {object} diff - active diff
   * @param {boolean} hasCardState - whether card-based selections are present
   * @param {Array} result - accumulator pushed into
   */
  function _collectModifiedChanges(diff, hasCardState, result) {
    var modified = diff.modified || [];
    for (var m = 0; m < modified.length; m++) {
      var mod = modified[m];
      var mKey = _itemKey(mod.item);
      if (hasCardState) {
        _emitCardModified(m, mod, mKey, result);
      } else if (_checkedItems["modified-" + m] !== false) {
        _emitLegacyModified(mod, mKey, result);
      }
    }
  }

  /** True when a change is an attachments diff handled per-entry via DiffEngine. */
  function _isAttachmentChange(ch) {
    return (
      ch.field === "attachments" &&
      window.DiffEngine &&
      typeof DiffEngine.diffAttachments === "function"
    );
  }

  /**
   * Card-based: emit the per-field winner (local / remote / sum) for one modified
   * item; attachments fan out to per-entry records.
   * @param {number} m - modified-item index (conflict key)
   * @param {object} mod - the modified diff entry ({ item, changes })
   * @param {string} mKey - item key for the emitted records
   * @param {Array} result - accumulator pushed into
   */
  function _emitCardModified(m, mod, mKey, result) {
    for (var c = 0; c < mod.changes.length; c++) {
      var ch = mod.changes[c];
      // Attachments: emit per-entry records keyed by UUID
      if (_isAttachmentChange(ch)) {
        _emitCardAttachments(m, ch, mKey, result);
        continue;
      }
      var fSel = _fieldSelections["conflict-" + m + "-" + ch.field] || "remote";
      // STRK-167 (AC-10, D-5): "sum" computes the merged quantity HERE so the
      // shared DiffEngine.applySelectedChanges patch (updated[field]=value) is
      // untouched — no blast radius into cloud sync.
      var fVal;
      if (fSel === "local") {
        fVal = ch.localVal;
      } else if (fSel === "sum") {
        fVal = (Number(ch.localVal) || 0) + (Number(ch.remoteVal) || 0);
      } else {
        fVal = ch.remoteVal;
      }
      result.push({
        type: "modify",
        itemKey: mKey,
        field: ch.field,
        value: fVal,
      });
    }
  }

  /**
   * Card-based: emit accepted (remote-side) attachment-entry records for one
   * attachments change; "local" picks leave the item's state unchanged.
   * @param {number} m - modified-item index (conflict key)
   * @param {object} ch - the attachments change ({ localVal, remoteVal })
   * @param {string} mKey - item key for the emitted records
   * @param {Array} result - accumulator pushed into
   */
  function _emitCardAttachments(m, ch, mKey, result) {
    var attDiffsC = DiffEngine.diffAttachments(ch.localVal, ch.remoteVal);
    for (var ace = 0; ace < attDiffsC.length; ace++) {
      var entryC = attDiffsC[ace];
      var entryKeyC = "conflict-" + m + "-attachments:" + entryC.attachmentUuid;
      var entrySelC = _fieldSelections[entryKeyC] || "remote";
      if (entrySelC === "remote") {
        // Accept remote side: add/remove/replace as computed
        result.push({
          type: "attach-entry",
          itemKey: mKey,
          action: entryC.action,
          attachmentUuid: entryC.attachmentUuid,
          oldAttachmentUuid: entryC.oldAttachmentUuid || null,
          value: entryC.remoteVal,
        });
      }
      // entrySel === "local" → no record; local keeps its state unchanged
    }
  }

  /**
   * Legacy fallback: emit all-remote field winners for one checked modified item;
   * attachments emit every entry on the remote side.
   * @param {object} mod - the modified diff entry ({ item, changes })
   * @param {string} mKey - item key for the emitted records
   * @param {Array} result - accumulator pushed into
   */
  function _emitLegacyModified(mod, mKey, result) {
    for (var c2 = 0; c2 < mod.changes.length; c2++) {
      var ch2 = mod.changes[c2];
      // Attachments: emit per-entry records (all remote)
      if (_isAttachmentChange(ch2)) {
        _emitLegacyAttachments(ch2, mKey, result);
        continue;
      }
      result.push({
        type: "modify",
        itemKey: mKey,
        field: ch2.field,
        value: ch2.remoteVal,
      });
    }
  }

  /**
   * Legacy fallback: emit every attachment entry (remote side) for one change.
   * @param {object} ch2 - the attachments change ({ localVal, remoteVal })
   * @param {string} mKey - item key for the emitted records
   * @param {Array} result - accumulator pushed into
   */
  function _emitLegacyAttachments(ch2, mKey, result) {
    var attDiffsL = DiffEngine.diffAttachments(ch2.localVal, ch2.remoteVal);
    for (var ale = 0; ale < attDiffsL.length; ale++) {
      var entryL = attDiffsL[ale];
      result.push({
        type: "attach-entry",
        itemKey: mKey,
        action: entryL.action,
        attachmentUuid: entryL.attachmentUuid,
        oldAttachmentUuid: entryL.oldAttachmentUuid || null,
        value: entryL.remoteVal,
      });
    }
  }

  /**
   * Append {type:"delete"} records for deleted orphans the user removed. With card
   * state, inclusion follows the orphan action ("remove"); legacy uses the checkbox.
   * @param {object} diff - active diff
   * @param {boolean} hasCardState - whether card-based selections are present
   * @param {Array} result - accumulator pushed into
   */
  function _collectDeletedChanges(diff, hasCardState, result) {
    var deleted = diff.deleted || [];
    for (var d = 0; d < deleted.length; d++) {
      var includeDeleted = hasCardState
        ? _orphanActions["deleted-" + d] === "remove"
        : _checkedItems["deleted-" + d] !== false;
      if (includeDeleted) {
        result.push({ type: "delete", itemKey: _itemKey(deleted[d]) });
      }
    }
  }

  /**
   * Append modify records for the sync conflicts section (separate from modified
   * cards); each conflict defaults to the remote side unless resolved to local.
   * @param {Array} result - accumulator pushed into
   */
  function _collectConflictChanges(result) {
    var conflictsArr = (_options.conflicts && _options.conflicts.conflicts) || [];
    for (var ci = 0; ci < conflictsArr.length; ci++) {
      var conf = conflictsArr[ci];
      var resKey = "c" + ci + "-" + conf.field;
      var side = _conflictResolutions[resKey] || "remote";
      var itemKey = conf.itemKey || conf.itemName || "";
      result.push({
        type: "modify",
        itemKey: itemKey,
        field: conf.field,
        value: side === "local" ? conf.localVal : conf.remoteVal,
      });
    }
  }

  /**
   * Append {type:"setting"} records: a per-element merge for rich renderer types
   * when the user made element picks, else a whole-setting local/remote resolution.
   * @param {Array} result - accumulator pushed into
   */
  function _collectSettingsChanges(result) {
    var settingsDiff = _options.settingsDiff || {};
    var changedSettings = settingsDiff.changed || [];
    for (var s = 0; s < changedSettings.length; s++) {
      var setting = changedSettings[s];
      var sType = SETTINGS_VALUE_TYPE[setting.key];
      var sPrefix = "setting-" + setting.key + "-";

      // Per-element merge only for rich types with actual element picks
      // (count-summary is whole-setting only).
      if (sType && sType !== "count-summary" && _hasElementPicks(sPrefix)) {
        var mergedVal = _mergeSettingElements(
          sType,
          setting.key,
          _parseSetting(setting.localVal),
          _parseSetting(setting.remoteVal)
        );
        if (mergedVal !== null) {
          result.push({ type: "setting", key: setting.key, value: mergedVal });
          continue;
        }
      }

      // Fallback: whole-setting pick via _conflictResolutions (default remote)
      var resolution = _conflictResolutions["setting-" + setting.key];
      var value = resolution === "local" ? setting.localVal : setting.remoteVal;
      result.push({ type: "setting", key: setting.key, value: value });
    }
  }

  /** True when any _fieldSelections key targets this setting's per-element prefix. */
  function _hasElementPicks(sPrefix) {
    for (var fk in _fieldSelections) {
      if (_fieldSelections.hasOwnProperty(fk) && fk.indexOf(sPrefix) === 0) {
        return true;
      }
    }
    return false;
  }

  function _onApply() {
    var selected = _buildSelectedChanges();
    // STAK-402: When _checkedItems is empty (empty diff — no selectable items were shown),
    // pass null instead of [] to signal "accept all / full overwrite". Callers that
    // check `selectedChanges &&` treat null as "no selective picks, do full restore".
    // This differs from the intentional "deselect all" case where _checkedItems has
    // entries but they are all false (then selected is [] and apply-nothing is correct).
    if (Object.keys(_checkedItems).length === 0) selected = null;
    // Capture callback before close() — close() nullifies _options
    var callback = _options && _options.onApply;
    DiffModal.close();
    if (typeof callback === "function") {
      callback(selected);
    }
  }

  function _onCancel() {
    // Capture callback before close() — close() nullifies _options
    var callback = _options && _options.onCancel;
    DiffModal.close();
    if (typeof callback === "function") {
      callback();
    }
  }

  // ── Wire buttons (called once per show) ──

  function _wireEvents() {
    var listEl = safeGetElement("diffSectionModified");
    var selectAllBtn = safeGetElement("diffReviewSelectAll");
    var deselectAllBtn = safeGetElement("diffReviewDeselectAll");
    var selectAllToggleBtn = safeGetElement("diffReviewSelectAllToggle");
    var applyBtn = safeGetElement("diffReviewApplyBtn");
    var cancelBtn = safeGetElement("diffReviewCancelBtn");
    var dismissX = safeGetElement("diffReviewDismissX");

    // Determine whether we're in backup-count mode
    var hasBackupCount = _options && _options.backupCount != null;

    // Event delegation on card containers
    var orphanEl = safeGetElement("diffSectionOrphans");
    if (orphanEl) {
      orphanEl.removeEventListener("click", _onOrphanClick);
      orphanEl.addEventListener("click", _onOrphanClick);
    }
    if (listEl) {
      listEl.removeEventListener("click", _onModifiedClick);
      listEl.addEventListener("click", _onModifiedClick);
      // STRK-167 (AC-10) a11y: div[role=radio] does not fire click on Space/Enter,
      // so the 3-way qty control is keyboard-inaccessible without this. Delegate a
      // keydown that activates the focused radio.
      listEl.removeEventListener("keydown", _onModifiedKeydown);
      listEl.addEventListener("keydown", _onModifiedKeydown);
    }

    // Pill buttons
    var btnStyle =
      "display:inline-flex;align-items:center;gap:0.3rem;border-radius:999px;font-size:0.73rem;font-weight:500;cursor:pointer;transition:all 0.15s;";

    if (selectAllBtn) {
      if (hasBackupCount) {
        selectAllBtn.style.display = "none";
      } else {
        selectAllBtn.style.display = "";
        selectAllBtn.onclick = _selectAll;
        selectAllBtn.setAttribute(
          "style",
          btnStyle +
            "padding:0.3rem 0.7rem;background:none;border:1.5px solid var(--border);color:var(--text-muted)"
        );
      }
    }
    if (deselectAllBtn) {
      if (hasBackupCount) {
        deselectAllBtn.style.display = "none";
      } else {
        deselectAllBtn.style.display = "";
        deselectAllBtn.onclick = _deselectAll;
        deselectAllBtn.setAttribute(
          "style",
          btnStyle +
            "padding:0.3rem 0.7rem;background:none;border:1.5px solid var(--border);color:var(--text-muted)"
        );
      }
    }

    // Select All toggle button — only shown when backupCount is provided
    if (selectAllToggleBtn) {
      if (hasBackupCount) {
        selectAllToggleBtn.textContent = ["Select All", "Add Deleted", "Deselect All"][
          _selectAllState
        ];
        selectAllToggleBtn.onclick = _toggleSelectAll;
        selectAllToggleBtn.setAttribute(
          "style",
          btnStyle +
            "padding:0.3rem 0.7rem;background:none;border:1.5px solid var(--border);color:var(--text-muted)"
        );
        selectAllToggleBtn.style.display = "";
      } else {
        selectAllToggleBtn.style.display = "none";
        selectAllToggleBtn.onclick = null;
      }
    }

    if (cancelBtn) {
      cancelBtn.onclick = _onCancel;
      cancelBtn.setAttribute(
        "style",
        btnStyle +
          "padding:0.45rem 1rem;font-size:0.8rem;background:none;border:1.5px solid var(--border);color:var(--text-muted)"
      );
    }
    if (applyBtn) {
      applyBtn.onclick = _onApply;
      applyBtn.setAttribute(
        "style",
        btnStyle +
          "padding:0.45rem 1.2rem;font-size:0.8rem;font-weight:600;background:var(--warning);color:var(--text-inverse);border:1.5px solid var(--warning)"
      );
    }
    if (dismissX) {
      dismissX.onclick = _onCancel;
    }
  }

  // ── Regex-bearing escape helpers — defined LAST (see top-of-file note, [[lizard-esc-regex-desync]]) ──

  /** Title-case a setting key for display (humanizes camelCase / kebab / snake). */
  function _titleCase(key) {
    return key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
  }

  /** Safe HTML escape — falls back to inline if sanitizeHtml not loaded */
  function _esc(text) {
    if (typeof sanitizeHtml === "function") return sanitizeHtml(text);
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Public API ──

  var DiffModal = {
    /**
     * Show the diff review modal.
     * @param {object} options
     * @param {object} options.source - { type: 'sync'|'csv'|'json', label: string }
     * @param {object} options.diff - DiffEngine.compareItems() result
     * @param {object} [options.settingsDiff] - DiffEngine.compareSettings() result
     * @param {object} [options.conflicts] - DiffEngine.detectConflicts() result
     * @param {object} [options.meta] - { deviceId, timestamp, itemCount, appVersion }
     * @param {function} options.onApply - Called with array of selected changes
     * @param {function} options.onCancel - Called when user cancels
     * @param {number} [options.backupCount] - Total items in backup file; enables count header and Select All toggle
     * @param {number} [options.localCount] - Current local inventory count; required alongside backupCount for projected count
     * @param {function} [options.onSelectionChange] - Fires on every checkbox toggle with (selectedChanges, projectedCount)
     */
    show: function (options) {
      _options = options || {};

      // Reset internal state
      _checkedItems = {};
      _conflictResolutions = {};
      _collapsedCategories = { settings: true };
      _expandedSettingsCategories = {};
      _selectAllState = 0;
      _orphanActions = {};
      _fieldSelections = {};
      _resolvedConflicts = {};

      // Default all items to checked (legacy compat) + initialize card-based state
      var diff = _options.diff || {};
      for (var a = 0; a < (diff.added || []).length; a++) {
        _checkedItems["added-" + a] = true;
        _orphanActions["added-" + a] = "import";
      }
      for (var m = 0; m < (diff.modified || []).length; m++) {
        _checkedItems["modified-" + m] = true;
        // Initialize per-field selections to 'remote' (default: accept incoming)
        var mod = (diff.modified || [])[m];
        if (mod && mod.changes) {
          for (var fc = 0; fc < mod.changes.length; fc++) {
            _fieldSelections["conflict-" + m + "-" + mod.changes[fc].field] = "remote";
          }
        }
      }
      for (var d = 0; d < (diff.deleted || []).length; d++) {
        _checkedItems["deleted-" + d] = false;
        _orphanActions["deleted-" + d] = "keep";
      }

      // Default conflict resolutions to 'remote' (per-field keys)
      if (_options.conflicts && _options.conflicts.conflicts) {
        for (var ci = 0; ci < _options.conflicts.conflicts.length; ci++) {
          var conflict = _options.conflicts.conflicts[ci];
          _conflictResolutions["c" + ci + "-" + conflict.field] = null;
        }
      }

      // Default settings resolutions to 'remote'
      if (_options.settingsDiff && _options.settingsDiff.changed) {
        for (var si = 0; si < _options.settingsDiff.changed.length; si++) {
          _conflictResolutions["setting-" + _options.settingsDiff.changed[si].key] = "remote";
        }
      }

      // Render content
      _render();

      // Wire event handlers
      _wireEvents();

      // Open modal
      if (typeof openModalById === "function") {
        openModalById(MODAL_ID);
      } else {
        var modal = safeGetElement(MODAL_ID);
        if (modal) modal.style.display = "flex";
      }
    },

    /**
     * Close the modal programmatically.
     */
    close: function () {
      // Revoke tracked blob URLs to prevent memory leaks
      for (var bi = 0; bi < _blobUrls.length; bi++) {
        try {
          URL.revokeObjectURL(_blobUrls[bi]);
        } catch (e) {
          /* ignore */
        }
      }
      _blobUrls = [];
      if (typeof closeModalById === "function") {
        closeModalById(MODAL_ID);
      } else {
        var modal = safeGetElement(MODAL_ID);
        if (modal) modal.style.display = "none";
      }
      _options = null;
    },
  };

  // Export globally
  if (typeof window !== "undefined") {
    window.DiffModal = DiffModal;
  }
})();
