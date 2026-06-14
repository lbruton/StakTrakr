// DIFF MODAL · SETTINGS DIFF RENDERERS (STRK-181)
// =============================================================================
// Stateless settings-diff rendering for DiffModal: the per-type value renderers
// (chip-strip / toggle-map / slug-chips / kv-pills / count-summary), their
// dispatcher (_renderSettingRow), the settings value formatter, and the metal
// color helpers. Extracted from js/diff-modal.js to keep each file under the
// Codacy Lizard file-nloc gate. Pure code motion — no behavior change. Every
// function is stateless: args in → HTML string out. The selection state the
// renderers read (_fieldSelections, _conflictResolutions) is passed in by
// diff-modal.js at each call site and is never mutated here. Self-contained:
// private _esc / _titleCase / _parseSetting copies and a private
// SETTINGS_VALUE_TYPE copy for the dispatcher, with no dependency on
// diff-modal.js's IIFE-private scope. MUST load BEFORE js/diff-modal.js.
//
// NOTE: _esc / _titleCase are deliberately defined LAST (mirroring diff-modal.js).
// Lizard's lexer mis-tokenizes _esc's /"/g regex and desyncs forward function
// detection, so keeping it trailing preserves correct per-function NLOC counts.
// =============================================================================

/* global sanitizeHtml, __decompressIfNeeded */

(function () {
  "use strict";

  // ── Value-type dispatch table (mirrors diff-modal.js) ──
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

  // ── Human labels for slug-chip settings ──
  var SLUG_LABELS = {
    // Seed rule coin slugs — from RETAIL_COIN_META keys
    ase: "American Silver Eagle",
    "maple-silver": "Silver Maple Leaf",
    "britannia-silver": "Silver Britannia",
    "krugerrand-silver": "Silver Krugerrand",
    "kangaroo-silver": "Silver Kangaroo",
    "koala-silver": "Silver Koala",
    "kookaburra-silver": "Silver Kookaburra",
    "generic-silver-round": "Generic Silver Round",
    "generic-silver-bar-10oz": "Generic 10oz Silver Bar",
    age: "American Gold Eagle",
    buffalo: "American Gold Buffalo",
    "maple-gold": "Gold Maple Leaf",
    "krugerrand-gold": "Gold Krugerrand",
    ape: "American Platinum Eagle",
    "goldback-oklahoma-g1": "G1 Oklahoma Goldback",
    // Header button slugs
    themeBtn: "Theme",
    cloudSyncBtn: "Cloud Sync",
    settingsBtn: "Settings",
    aboutBtn: "About",
    backupBtn: "Backup",
    importBtn: "Import",
    addItemBtn: "Add Item",
    sortBtn: "Sort",
    filterBtn: "Filter",
    searchBtn: "Search",
    marketBtn: "Market",
    vaultBtn: "Vault",
    trendBtn: "Trend",
    restoreBtn: "Restore",
    currencyBtn: "Currency",
    // Provider slugs
    STAKTRAKR: "StakTrakr",
    METALS_DEV: "Metals.dev",
    GOLDAPI: "GoldAPI",
  };

  // ── Metal color lookup tables ──
  var _metalRgb = {
    gold: "255,215,0",
    silver: "192,192,192",
    platinum: "229,228,226",
    palladium: "206,208,206",
  };
  var _metalCssVar = {
    gold: "var(--gold)",
    silver: "var(--silver)",
    platinum: "var(--platinum)",
    palladium: "var(--palladium)",
  };

  // ── JSON parse helper — cloud-sync vault passes settings as raw JSON strings ──
  // Also handles CMP1-compressed localStorage values (loadDataSync decompresses,
  // but raw localStorage.getItem() and vault payloads may not).
  /** Parse a setting value that may arrive as a (possibly compressed) JSON string */
  function _parseSetting(val) {
    if (typeof val !== "string") return val;
    if (typeof __decompressIfNeeded === "function") val = __decompressIfNeeded(val);
    try {
      return JSON.parse(val);
    } catch (e) {
      return val;
    }
  }

  // ── Settings sub-renderers (STAK-455) ──

  // Shared output scaffold for all settings sub-renderers.
  // matchedSection: pre-built HTML string (caller wraps it; may include its own overflow expand).
  // overflowCount: number → "Show N more…"; null → "Show more…"
  /** Wrap matched/local/remote HTML into the two-column settings-diff scaffold */
  function _buildDiffSides(
    key,
    matchedSection,
    localHtml,
    remoteHtml,
    overflowLocal,
    overflowRemote,
    overflowCount
  ) {
    var html = matchedSection || "";
    html += '<div class="dm-setting-sides">';
    html +=
      '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--primary)">Local</div><div class="dm-setting-expanded">' +
      localHtml;
    if (overflowLocal) {
      var lLabel = overflowCount != null ? "Show " + overflowCount + " more…" : "Show more…";
      html +=
        '<span class="dm-show-more" data-expand="' + _esc(key) + '-local">' + lLabel + "</span>";
      html +=
        '<div class="dm-expandable" id="expand-' +
        _esc(key) +
        '-local">' +
        overflowLocal +
        "</div>";
    }
    html += "</div></div>";
    html += '<div class="dm-setting-arrow">→</div>';
    html +=
      '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--info)">Remote</div><div class="dm-setting-expanded">' +
      remoteHtml;
    if (overflowRemote) {
      var rLabel = overflowCount != null ? "Show " + overflowCount + " more…" : "Show more…";
      html +=
        '<span class="dm-show-more" data-expand="' + _esc(key) + '-remote">' + rLabel + "</span>";
      html +=
        '<div class="dm-expandable" id="expand-' +
        _esc(key) +
        '-remote">' +
        overflowRemote +
        "</div>";
    }
    html += "</div></div>";
    html += "</div>";
    return html;
  }

  /**
   * Build one local/remote diff chip span. Shared by the chip-strip and
   * toggle-map renderers to keep their per-element markup identical.
   * @param {string} side "local" or "remote"
   * @param {boolean} enabled whether this side's value is on
   * @param {boolean} selected whether this side is the current field selection
   * @returns {string} chip HTML (trailing space included)
   */
  function _renderDiffChip(fieldKey, label, side, enabled, selected) {
    var icon = enabled ? "✓" : "✗";
    var cls =
      "dm-chip-" +
      side +
      " " +
      (enabled ? "dm-chip-enabled" : "dm-chip-disabled") +
      (selected ? " dm-selected" : "");
    return (
      '<span class="' +
      cls +
      '" data-field="' +
      _esc(fieldKey) +
      '" data-side="' +
      side +
      '">' +
      icon +
      " " +
      _esc(label) +
      "</span> "
    );
  }

  /**
   * Build one matched (both-sides-equal) chip span. Shared by the chip-strip
   * and toggle-map renderers.
   * @returns {string} chip HTML (trailing space included)
   */
  function _renderMatchedChip(label, enabled) {
    var icon = enabled ? "✓" : "✗";
    return '<span class="dm-chip-matched">' + icon + " " + _esc(label) + "</span> ";
  }

  /** Resolve a chip-strip element's identity key (id → label → index fallback). */
  function _chipKey(item, idx) {
    return item.id || item.label || idx;
  }

  /**
   * Render an enabled/ordered chip-strip setting (e.g. section layout) as a diff.
   * @param {Object} fieldSelections per-element local/remote picks (read-only, for highlight)
   */
  function _renderChipStrip(key, localArr, remoteArr, fieldSelections) {
    // Guard: if either side is still a string after parsing, bail to inline renderer
    if (!Array.isArray(localArr) && !Array.isArray(remoteArr)) return null;
    if (!Array.isArray(localArr)) localArr = [];
    if (!Array.isArray(remoteArr)) remoteArr = [];
    var localById = {};
    var remoteById = {};
    var i, id;
    for (i = 0; i < localArr.length; i++) {
      id = _chipKey(localArr[i], i);
      localById[id] = localArr[i];
    }
    for (i = 0; i < remoteArr.length; i++) {
      id = _chipKey(remoteArr[i], i);
      remoteById[id] = remoteArr[i];
    }
    var allIds = {};
    for (id in localById) allIds[id] = true;
    for (id in remoteById) allIds[id] = true;

    var matchedHtml = "";
    var localHtml = "";
    var remoteHtml = "";
    var diffCount = 0;
    var overflowLocal = "";
    var overflowRemote = "";

    for (id in allIds) {
      var loc = localById[id];
      var rem = remoteById[id];
      var chipLabel = loc ? loc.label || id : rem ? rem.label || id : id;
      var fieldKey = "setting-" + key + "-" + id;
      var selSide = fieldSelections[fieldKey] || "";

      if (loc && rem && loc.enabled === rem.enabled) {
        matchedHtml += _renderMatchedChip(String(chipLabel), loc.enabled);
      } else {
        diffCount++;
        var localChip = loc
          ? _renderDiffChip(fieldKey, String(chipLabel), "local", loc.enabled, selSide === "local")
          : "";
        var remoteChip = rem
          ? _renderDiffChip(
              fieldKey,
              String(chipLabel),
              "remote",
              rem.enabled,
              selSide === "remote"
            )
          : "";
        if (diffCount <= 15) {
          localHtml += localChip;
          remoteHtml += remoteChip;
        } else {
          overflowLocal += localChip;
          overflowRemote += remoteChip;
        }
      }
    }

    var matchedSection = matchedHtml
      ? '<div class="dm-setting-expanded">' + matchedHtml + "</div>"
      : "";
    return _buildDiffSides(
      key,
      matchedSection,
      localHtml,
      remoteHtml,
      overflowLocal,
      overflowRemote,
      diffCount - 15
    );
  }

  /**
   * Render a boolean toggle-map setting (e.g. Numista view fields) as a diff.
   * @param {Object} fieldSelections per-element local/remote picks (read-only, for highlight)
   */
  function _renderToggleMap(key, localObj, remoteObj, fieldSelections) {
    if (
      (typeof localObj !== "object" || localObj === null) &&
      (typeof remoteObj !== "object" || remoteObj === null)
    )
      return null;
    if (typeof localObj !== "object" || localObj === null) localObj = {};
    if (typeof remoteObj !== "object" || remoteObj === null) remoteObj = {};
    var allKeys = {};
    var k;
    for (k in localObj) allKeys[k] = true;
    for (k in remoteObj) allKeys[k] = true;

    var matchedHtml = "";
    var localHtml = "";
    var remoteHtml = "";
    var diffCount = 0;
    var overflowLocal = "";
    var overflowRemote = "";

    for (k in allKeys) {
      var lv = localObj.hasOwnProperty(k) ? localObj[k] : undefined;
      var rv = remoteObj.hasOwnProperty(k) ? remoteObj[k] : undefined;
      var fieldKey = "setting-" + key + "-" + k;
      var selSide = fieldSelections[fieldKey] || "";
      var humanLabel = _titleCase(k);

      if (lv !== undefined && rv !== undefined && lv === rv) {
        matchedHtml += _renderMatchedChip(humanLabel, lv);
      } else {
        diffCount++;
        var localChip =
          lv !== undefined
            ? _renderDiffChip(fieldKey, humanLabel, "local", lv, selSide === "local")
            : "";
        var remoteChip =
          rv !== undefined
            ? _renderDiffChip(fieldKey, humanLabel, "remote", rv, selSide === "remote")
            : "";
        if (diffCount <= 15) {
          localHtml += localChip;
          remoteHtml += remoteChip;
        } else {
          overflowLocal += localChip;
          overflowRemote += remoteChip;
        }
      }
    }

    var matchedSection = matchedHtml
      ? '<div class="dm-setting-expanded">' + matchedHtml + "</div>"
      : "";
    return _buildDiffSides(
      key,
      matchedSection,
      localHtml,
      remoteHtml,
      overflowLocal,
      overflowRemote,
      diffCount - 15
    );
  }

  /**
   * Render a slug-list setting (e.g. button order, blacklists) as labeled chips.
   * @param {Object} fieldSelections per-element local/remote picks (read-only, for highlight)
   */
  function _renderSlugChips(key, localArr, remoteArr, fieldSelections) {
    if (!Array.isArray(localArr) && !Array.isArray(remoteArr)) return null;
    if (!Array.isArray(localArr)) localArr = [];
    if (!Array.isArray(remoteArr)) remoteArr = [];
    var localSet = {};
    var remoteSet = {};
    var i;
    for (i = 0; i < localArr.length; i++) localSet[localArr[i]] = true;
    for (i = 0; i < remoteArr.length; i++) remoteSet[remoteArr[i]] = true;

    var matchedHtml = "";
    var localHtml = "";
    var remoteHtml = "";
    var totalChips = 0;
    var matchedOverflowCount = 0;
    var overflowLocal = "";
    var overflowRemote = "";
    var overflowMatched = "";

    var allSlugs = {};
    for (i = 0; i < localArr.length; i++) allSlugs[localArr[i]] = true;
    for (i = 0; i < remoteArr.length; i++) allSlugs[remoteArr[i]] = true;

    for (var slug in allSlugs) {
      var inLocal = localSet[slug];
      var inRemote = remoteSet[slug];
      var humanLabel = SLUG_LABELS[slug] || _titleCase(slug);
      totalChips++;

      if (inLocal && inRemote) {
        var mChip = '<span class="dm-chip-matched">' + _esc(humanLabel) + "</span> ";
        if (totalChips <= 15) {
          matchedHtml += mChip;
        } else {
          overflowMatched += mChip;
          matchedOverflowCount++;
        }
      } else {
        var fieldKey = "setting-" + key + "-" + slug;
        var selSide = fieldSelections[fieldKey] || "";
        if (inLocal) {
          var lCls = "dm-chip-local dm-chip-enabled" + (selSide === "local" ? " dm-selected" : "");
          var lChip =
            '<span class="' +
            lCls +
            '" data-field="' +
            _esc(fieldKey) +
            '" data-side="local">' +
            _esc(humanLabel) +
            "</span> ";
          if (totalChips <= 15) {
            localHtml += lChip;
          } else {
            overflowLocal += lChip;
          }
        }
        if (inRemote) {
          var rCls =
            "dm-chip-remote dm-chip-enabled" + (selSide === "remote" ? " dm-selected" : "");
          var rChip =
            '<span class="' +
            rCls +
            '" data-field="' +
            _esc(fieldKey) +
            '" data-side="remote">' +
            _esc(humanLabel) +
            "</span> ";
          if (totalChips <= 15) {
            remoteHtml += rChip;
          } else {
            overflowRemote += rChip;
          }
        }
      }
    }

    var matchedSection = "";
    if (matchedHtml || overflowMatched) {
      matchedSection = '<div class="dm-setting-expanded">' + matchedHtml;
      if (overflowMatched) {
        matchedSection +=
          '<span class="dm-show-more" data-expand="' +
          _esc(key) +
          '-matched">Show ' +
          matchedOverflowCount +
          " more…</span>";
        matchedSection +=
          '<div class="dm-expandable" id="expand-' +
          _esc(key) +
          '-matched">' +
          overflowMatched +
          "</div>";
      }
      matchedSection += "</div>";
    }
    return _buildDiffSides(
      key,
      matchedSection,
      localHtml,
      remoteHtml,
      overflowLocal,
      overflowRemote,
      null
    );
  }

  /**
   * Render an object setting as key/value pills (e.g. provider priority).
   * @param {Object} fieldSelections per-element local/remote picks (read-only, for highlight)
   */
  function _renderKvPills(key, localObj, remoteObj, fieldSelections) {
    if (
      (typeof localObj !== "object" || localObj === null) &&
      (typeof remoteObj !== "object" || remoteObj === null)
    )
      return null;
    if (typeof localObj !== "object" || localObj === null) localObj = {};
    if (typeof remoteObj !== "object" || remoteObj === null) remoteObj = {};
    var allKeys = {};
    var k;
    for (k in localObj) allKeys[k] = true;
    for (k in remoteObj) allKeys[k] = true;

    var matchedHtml = "";
    var localHtml = "";
    var remoteHtml = "";
    var diffCount = 0;
    var overflowLocal = "";
    var overflowRemote = "";

    for (k in allKeys) {
      var lv = localObj.hasOwnProperty(k) ? localObj[k] : undefined;
      var rv = remoteObj.hasOwnProperty(k) ? remoteObj[k] : undefined;
      var fieldKey = "setting-" + key + "-" + k;
      var selSide = fieldSelections[fieldKey] || "";
      var humanKey = _titleCase(k);

      if (lv !== undefined && rv !== undefined && lv === rv) {
        matchedHtml +=
          '<span class="dm-kv-pill matched">' +
          _esc(humanKey) +
          ": " +
          _esc(String(lv)) +
          "</span> ";
      } else {
        diffCount++;
        var localPill = "";
        var remotePill = "";
        if (lv !== undefined) {
          var lCls = "dm-kv-pill local" + (selSide === "local" ? " dm-selected" : "");
          localPill =
            '<span class="' +
            lCls +
            '" data-field="' +
            _esc(fieldKey) +
            '" data-side="local">' +
            _esc(humanKey) +
            ": " +
            _esc(String(lv)) +
            "</span> ";
        }
        if (rv !== undefined) {
          var rCls = "dm-kv-pill remote" + (selSide === "remote" ? " dm-selected" : "");
          remotePill =
            '<span class="' +
            rCls +
            '" data-field="' +
            _esc(fieldKey) +
            '" data-side="remote">' +
            _esc(humanKey) +
            ": " +
            _esc(String(rv)) +
            "</span> ";
        }
        if (diffCount <= 15) {
          localHtml += localPill;
          remoteHtml += remotePill;
        } else {
          overflowLocal += localPill;
          overflowRemote += remotePill;
        }
      }
    }

    var matchedSection = matchedHtml
      ? '<div class="dm-setting-expanded">' + matchedHtml + "</div>"
      : "";
    return _buildDiffSides(
      key,
      matchedSection,
      localHtml,
      remoteHtml,
      overflowLocal,
      overflowRemote,
      diffCount - 15
    );
  }

  /**
   * Render a whole-setting count summary with Keep Local / Use Remote buttons.
   * @param {Object} conflictResolutions whole-setting local/remote picks (read-only, for highlight)
   */
  function _renderCountSummary(key, localVal, remoteVal, conflictResolutions) {
    var resKey = "setting-" + key;
    var selected = conflictResolutions[resKey] || "";
    var localCount = 0;
    var remoteCount = 0;
    if (Array.isArray(localVal)) localCount = localVal.length;
    else if (localVal && typeof localVal === "object") localCount = Object.keys(localVal).length;
    else if (localVal !== null && localVal !== undefined) localCount = 1;
    if (Array.isArray(remoteVal)) remoteCount = remoteVal.length;
    else if (remoteVal && typeof remoteVal === "object")
      remoteCount = Object.keys(remoteVal).length;
    else if (remoteVal !== null && remoteVal !== undefined) remoteCount = 1;

    var localBtnCls = "dm-count-btn" + (selected === "local" ? " active" : "");
    var remoteBtnCls = "dm-count-btn" + (selected === "remote" ? " active" : "");

    var html = '<div class="dm-count-summary">';
    html += '<span class="dm-count-badge">' + _esc(String(localCount)) + " local</span>";
    html += '<span class="dm-count-badge">' + _esc(String(remoteCount)) + " remote</span>";
    html +=
      '<span class="' +
      localBtnCls +
      '" data-setting-resolution="' +
      _esc(resKey) +
      '" data-side="local">Keep Local</span>';
    html +=
      '<span class="' +
      remoteBtnCls +
      '" data-setting-resolution="' +
      _esc(resKey) +
      '" data-side="remote">Use Remote</span>';
    html += "</div>";
    return html;
  }

  /**
   * Dispatch a single changed setting to its typed renderer.
   * @param {Object} fieldSelections per-element picks threaded to the chip/pill renderers
   * @param {Object} conflictResolutions whole-setting picks threaded to the count renderer
   * @returns {string|null} rich-renderer HTML, or null when the type has no rich renderer
   */
  function _renderSettingRow(key, localVal, remoteVal, fieldSelections, conflictResolutions) {
    fieldSelections = fieldSelections || {};
    conflictResolutions = conflictResolutions || {};
    var type = SETTINGS_VALUE_TYPE[key];
    if (!type) return null;
    // Cloud-sync vault passes settings as JSON strings — parse before rendering
    localVal = _parseSetting(localVal);
    remoteVal = _parseSetting(remoteVal);
    // Each renderer has its own type guards and returns null if inputs are wrong
    switch (type) {
      case "chip-strip":
        return _renderChipStrip(key, localVal, remoteVal, fieldSelections);
      case "toggle-map":
        return _renderToggleMap(key, localVal, remoteVal, fieldSelections);
      case "slug-chips":
        return _renderSlugChips(key, localVal, remoteVal, fieldSelections);
      case "kv-pills":
        return _renderKvPills(key, localVal, remoteVal, fieldSelections);
      case "count-summary":
        return _renderCountSummary(key, localVal, remoteVal, conflictResolutions);
      default:
        return null;
    }
  }

  /** Format a setting value for compact single-line display in the diff modal */
  function _formatSettingValue(key, value) {
    if (key === "metalApiConfig" || key === "catalog_api_config")
      return value ? "••• configured" : "not set";
    value = _parseSetting(value);
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (value === "true") return "On";
    if (value === "false") return "Off";
    if (Array.isArray(value)) {
      var label = value.length + " items";
      if (value.length > 0 && typeof value[0] === "string") {
        var preview = value.slice(0, 2).join(", ");
        if (value.length > 2) preview += ", …";
        label += " (" + _esc(preview) + ")";
      }
      return label;
    }
    if (typeof value === "object") return Object.keys(value).length + " entries";
    return _esc(String(value));
  }

  /** Resolve a metal name to its theme CSS color variable */
  function _metalColor(metal) {
    var key = (metal || "").toLowerCase();
    return _metalCssVar[key] || "var(--text-muted)";
  }

  /** Build a subtle metal-tinted background gradient for item thumbnails */
  function _metalBgGradient(metal) {
    var key = (metal || "").toLowerCase();
    var rgb = _metalRgb[key] || "128,128,128";
    return "linear-gradient(135deg, rgba(" + rgb + ",0.15), rgba(" + rgb + ",0.05))";
  }

  /** Convert a camelCase / snake / kebab key into a human Title Case label */
  function _titleCase(key) {
    return key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
  }

  // Defined LAST: Lizard mis-tokenizes the /"/g regex and desyncs forward
  // function detection, so a trailing position keeps sibling NLOC counts correct.
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

  window.DiffModalSettings = {
    renderSettingRow: _renderSettingRow,
    formatSettingValue: _formatSettingValue,
    metalColor: _metalColor,
    metalBgGradient: _metalBgGradient,
  };
})();
