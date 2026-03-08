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

/* eslint-disable no-var */
/* global safeGetElement, sanitizeHtml, openModalById, closeModalById, DiffEngine */

(function () {
  'use strict';

  // ── Constants ──
  var MODAL_ID = 'diffReviewModal';

  // ── Settings categories for grouped display ──
  var SETTINGS_CATEGORIES = {
    'Display & Appearance': {
      icon: '\uD83C\uDFA8',
      keys: ['displayCurrency','appTheme','cardViewStyle','desktopCardView','defaultSortColumn','defaultSortDir','showRealizedGainLoss','metalOrderConfig','settingsItemsPerPage','appTimeZone']
    },
    'Chips & Filters': {
      icon: '\uD83C\uDFF7\uFE0F',
      keys: ['inlineChipConfig','filterChipCategoryConfig','viewModalSectionConfig','chipMinCount','chipMaxCount','chipCustomGroups','chipBlacklist','chipSortOrder']
    },
    'Layout': {
      icon: '\uD83D\uDCD0',
      keys: ['layoutSectionConfig','tableImagesEnabled','tableImageSides']
    },
    'Tags': {
      icon: '\uD83D\uDD16',
      keys: ['tagBlacklist']
    },
    'Header Buttons': {
      icon: '\uD83D\uDD18',
      keys: ['headerThemeBtnVisible','headerCurrencyBtnVisible','headerTrendBtnVisible','headerSyncBtnVisible','headerMarketBtnVisible','headerVaultBtnVisible','headerRestoreBtnVisible','headerCloudSyncBtnVisible','headerBtnShowText','headerBtnOrder','headerAboutBtnVisible']
    },
    'Goldback & Providers': {
      icon: '\uD83E\uDE99',
      keys: ['goldback-enabled','goldback-estimate-enabled','goldback-estimate-modifier','enabledSeedRules','apiProviderOrder','providerPriority']
    },
    'Numista': {
      icon: '\uD83D\uDCDA',
      keys: ['numista_tags_auto','numistaLookupRules','numistaViewFields']
    }
  };

  var SETTINGS_LABELS = {
    'displayCurrency': 'Display Currency',
    'appTheme': 'Theme',
    'cardViewStyle': 'Card View Style',
    'desktopCardView': 'Desktop Card View',
    'defaultSortColumn': 'Default Sort Column',
    'defaultSortDir': 'Default Sort Direction',
    'showRealizedGainLoss': 'Show Realized Gain/Loss',
    'metalOrderConfig': 'Metal Order',
    'settingsItemsPerPage': 'Items Per Page',
    'appTimeZone': 'Time Zone',
    'inlineChipConfig': 'Inline Chips',
    'filterChipCategoryConfig': 'Filter Chip Categories',
    'viewModalSectionConfig': 'View Modal Sections',
    'chipMinCount': 'Chip Min Count',
    'chipMaxCount': 'Chip Max Count',
    'chipCustomGroups': 'Custom Chip Groups',
    'chipBlacklist': 'Hidden Chips',
    'chipSortOrder': 'Chip Sort Order',
    'layoutSectionConfig': 'Section Layout',
    'tableImagesEnabled': 'Table Images',
    'tableImageSides': 'Table Image Sides',
    'tagBlacklist': 'Hidden Tags',
    'headerThemeBtnVisible': 'Theme Button',
    'headerCurrencyBtnVisible': 'Currency Button',
    'headerTrendBtnVisible': 'Trend Button',
    'headerSyncBtnVisible': 'Sync Button',
    'headerMarketBtnVisible': 'Market Button',
    'headerVaultBtnVisible': 'Vault Button',
    'headerRestoreBtnVisible': 'Restore Button',
    'headerCloudSyncBtnVisible': 'Cloud Sync Button',
    'headerBtnShowText': 'Button Labels',
    'headerBtnOrder': 'Button Order',
    'headerAboutBtnVisible': 'About Button',
    'goldback-enabled': 'Goldback Enabled',
    'goldback-estimate-enabled': 'Goldback Estimates',
    'goldback-estimate-modifier': 'Estimate Modifier',
    'enabledSeedRules': 'Seed Rules',
    'apiProviderOrder': 'Provider Order',
    'providerPriority': 'Provider Priority',
    'numista_tags_auto': 'Auto-Tag on Lookup',
    'numistaLookupRules': 'Lookup Rules',
    'numistaViewFields': 'View Fields',
    'metalApiConfig': 'API Keys'
  };

  var SETTINGS_VALUE_TYPE = {
    inlineChipConfig: 'chip-strip',
    filterChipCategoryConfig: 'chip-strip',
    viewModalSectionConfig: 'chip-strip',
    chipCustomGroups: 'chip-strip',
    numistaViewFields: 'toggle-map',
    enabledSeedRules: 'slug-chips',
    headerBtnOrder: 'slug-chips',
    chipBlacklist: 'slug-chips',
    tagBlacklist: 'slug-chips',
    providerPriority: 'kv-pills',
    numistaLookupRules: 'count-summary',
    metalOrderConfig: 'count-summary'
  };

  var SLUG_LABELS = {
    // Seed rule coin slugs — from RETAIL_COIN_META keys
    'ase': 'American Silver Eagle',
    'maple-silver': 'Silver Maple Leaf',
    'britannia-silver': 'Silver Britannia',
    'krugerrand-silver': 'Silver Krugerrand',
    'kangaroo-silver': 'Silver Kangaroo',
    'koala-silver': 'Silver Koala',
    'kookaburra-silver': 'Silver Kookaburra',
    'generic-silver-round': 'Generic Silver Round',
    'generic-silver-bar-10oz': 'Generic 10oz Silver Bar',
    'age': 'American Gold Eagle',
    'buffalo': 'American Gold Buffalo',
    'maple-gold': 'Gold Maple Leaf',
    'krugerrand-gold': 'Gold Krugerrand',
    'ape': 'American Platinum Eagle',
    'goldback-oklahoma-g1': 'G1 Oklahoma Goldback',
    // Header button slugs
    'themeBtn': 'Theme',
    'cloudSyncBtn': 'Cloud Sync',
    'settingsBtn': 'Settings',
    'aboutBtn': 'About',
    'backupBtn': 'Backup',
    'importBtn': 'Import',
    'addItemBtn': 'Add Item',
    'sortBtn': 'Sort',
    'filterBtn': 'Filter',
    'searchBtn': 'Search',
    'marketBtn': 'Market',
    'vaultBtn': 'Vault',
    'trendBtn': 'Trend',
    'restoreBtn': 'Restore',
    'currencyBtn': 'Currency'
  };

  // ── Settings sub-renderers (STAK-455) ──

  function _renderChipStrip(key, localArr, remoteArr) {
    var localById = {};
    var remoteById = {};
    var i, id;
    for (i = 0; i < localArr.length; i++) {
      id = localArr[i].id || localArr[i].label || i;
      localById[id] = localArr[i];
    }
    for (i = 0; i < remoteArr.length; i++) {
      id = remoteArr[i].id || remoteArr[i].label || i;
      remoteById[id] = remoteArr[i];
    }
    var allIds = {};
    for (id in localById) allIds[id] = true;
    for (id in remoteById) allIds[id] = true;

    var matchedHtml = '';
    var localHtml = '';
    var remoteHtml = '';
    var diffCount = 0;
    var overflowLocal = '';
    var overflowRemote = '';

    for (id in allIds) {
      var loc = localById[id];
      var rem = remoteById[id];
      var chipLabel = (loc ? (loc.label || id) : (rem ? (rem.label || id) : id));
      var fieldKey = 'setting-' + key + '-' + id;
      var selSide = _fieldSelections[fieldKey] || '';

      if (loc && rem && loc.enabled === rem.enabled) {
        var icon = loc.enabled ? '\u2713' : '\u2717';
        matchedHtml += '<span class="dm-chip-matched">' + icon + ' ' + _esc(String(chipLabel)) + '</span> ';
      } else {
        diffCount++;
        var localChip = '';
        var remoteChip = '';
        if (loc) {
          var lIcon = loc.enabled ? '\u2713' : '\u2717';
          var lCls = 'dm-chip-local ' + (loc.enabled ? 'dm-chip-enabled' : 'dm-chip-disabled') + (selSide === 'local' ? ' dm-selected' : '');
          localChip = '<span class="' + lCls + '" data-field="' + _esc(fieldKey) + '" data-side="local">' + lIcon + ' ' + _esc(String(chipLabel)) + '</span> ';
        }
        if (rem) {
          var rIcon = rem.enabled ? '\u2713' : '\u2717';
          var rCls = 'dm-chip-remote ' + (rem.enabled ? 'dm-chip-enabled' : 'dm-chip-disabled') + (selSide === 'remote' ? ' dm-selected' : '');
          remoteChip = '<span class="' + rCls + '" data-field="' + _esc(fieldKey) + '" data-side="remote">' + rIcon + ' ' + _esc(String(chipLabel)) + '</span> ';
        }
        if (diffCount <= 15) {
          localHtml += localChip;
          remoteHtml += remoteChip;
        } else {
          overflowLocal += localChip;
          overflowRemote += remoteChip;
        }
      }
    }

    var html = '';
    if (matchedHtml) html += '<div class="dm-setting-expanded">' + matchedHtml + '</div>';
    html += '<div class="dm-setting-sides">';
    html += '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--primary,#6366f1)">Local</div><div class="dm-setting-expanded">' + localHtml;
    if (overflowLocal) {
      html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-local">Show ' + (diffCount - 15) + ' more\u2026</span>';
      html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-local">' + overflowLocal + '</div>';
    }
    html += '</div></div>';
    html += '<div class="dm-setting-arrow">\u2192</div>';
    html += '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--info,#3b82f6)">Remote</div><div class="dm-setting-expanded">' + remoteHtml;
    if (overflowRemote) {
      html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-remote">Show ' + (diffCount - 15) + ' more\u2026</span>';
      html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-remote">' + overflowRemote + '</div>';
    }
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  function _renderToggleMap(key, localObj, remoteObj) {
    var allKeys = {};
    var k;
    for (k in localObj) allKeys[k] = true;
    for (k in remoteObj) allKeys[k] = true;

    var matchedHtml = '';
    var localHtml = '';
    var remoteHtml = '';
    var diffCount = 0;
    var overflowLocal = '';
    var overflowRemote = '';

    for (k in allKeys) {
      var lv = localObj.hasOwnProperty(k) ? localObj[k] : undefined;
      var rv = remoteObj.hasOwnProperty(k) ? remoteObj[k] : undefined;
      var fieldKey = 'setting-' + key + '-' + k;
      var selSide = _fieldSelections[fieldKey] || '';
      var humanLabel = _titleCase(k);

      if (lv !== undefined && rv !== undefined && lv === rv) {
        var mIcon = lv ? '\u2713' : '\u2717';
        matchedHtml += '<span class="dm-chip-matched">' + mIcon + ' ' + _esc(humanLabel) + '</span> ';
      } else {
        diffCount++;
        var localChip = '';
        var remoteChip = '';
        if (lv !== undefined) {
          var lIcon = lv ? '\u2713' : '\u2717';
          var lCls = 'dm-chip-local ' + (lv ? 'dm-chip-enabled' : 'dm-chip-disabled') + (selSide === 'local' ? ' dm-selected' : '');
          localChip = '<span class="' + lCls + '" data-field="' + _esc(fieldKey) + '" data-side="local">' + lIcon + ' ' + _esc(humanLabel) + '</span> ';
        }
        if (rv !== undefined) {
          var rIcon = rv ? '\u2713' : '\u2717';
          var rCls = 'dm-chip-remote ' + (rv ? 'dm-chip-enabled' : 'dm-chip-disabled') + (selSide === 'remote' ? ' dm-selected' : '');
          remoteChip = '<span class="' + rCls + '" data-field="' + _esc(fieldKey) + '" data-side="remote">' + rIcon + ' ' + _esc(humanLabel) + '</span> ';
        }
        if (diffCount <= 15) {
          localHtml += localChip;
          remoteHtml += remoteChip;
        } else {
          overflowLocal += localChip;
          overflowRemote += remoteChip;
        }
      }
    }

    var html = '';
    if (matchedHtml) html += '<div class="dm-setting-expanded">' + matchedHtml + '</div>';
    html += '<div class="dm-setting-sides">';
    html += '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--primary,#6366f1)">Local</div><div class="dm-setting-expanded">' + localHtml;
    if (overflowLocal) {
      html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-local">Show ' + (diffCount - 15) + ' more\u2026</span>';
      html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-local">' + overflowLocal + '</div>';
    }
    html += '</div></div>';
    html += '<div class="dm-setting-arrow">\u2192</div>';
    html += '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--info,#3b82f6)">Remote</div><div class="dm-setting-expanded">' + remoteHtml;
    if (overflowRemote) {
      html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-remote">Show ' + (diffCount - 15) + ' more\u2026</span>';
      html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-remote">' + overflowRemote + '</div>';
    }
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  function _renderSlugChips(key, localArr, remoteArr) {
    var localSet = {};
    var remoteSet = {};
    var i;
    for (i = 0; i < localArr.length; i++) localSet[localArr[i]] = true;
    for (i = 0; i < remoteArr.length; i++) remoteSet[remoteArr[i]] = true;

    var matchedHtml = '';
    var localHtml = '';
    var remoteHtml = '';
    var totalChips = 0;
    var overflowLocal = '';
    var overflowRemote = '';
    var overflowMatched = '';

    var allSlugs = {};
    for (i = 0; i < localArr.length; i++) allSlugs[localArr[i]] = true;
    for (i = 0; i < remoteArr.length; i++) allSlugs[remoteArr[i]] = true;

    for (var slug in allSlugs) {
      var inLocal = localSet[slug];
      var inRemote = remoteSet[slug];
      var humanLabel = SLUG_LABELS[slug] || _titleCase(slug);
      totalChips++;

      if (inLocal && inRemote) {
        var mChip = '<span class="dm-chip-matched">' + _esc(humanLabel) + '</span> ';
        if (totalChips <= 15) {
          matchedHtml += mChip;
        } else {
          overflowMatched += mChip;
        }
      } else {
        var fieldKey = 'setting-' + key + '-' + slug;
        var selSide = _fieldSelections[fieldKey] || '';
        if (inLocal) {
          var lCls = 'dm-chip-local dm-chip-enabled' + (selSide === 'local' ? ' dm-selected' : '');
          var lChip = '<span class="' + lCls + '" data-field="' + _esc(fieldKey) + '" data-side="local">' + _esc(humanLabel) + '</span> ';
          if (totalChips <= 15) {
            localHtml += lChip;
          } else {
            overflowLocal += lChip;
          }
        }
        if (inRemote) {
          var rCls = 'dm-chip-remote dm-chip-enabled' + (selSide === 'remote' ? ' dm-selected' : '');
          var rChip = '<span class="' + rCls + '" data-field="' + _esc(fieldKey) + '" data-side="remote">' + _esc(humanLabel) + '</span> ';
          if (totalChips <= 15) {
            remoteHtml += rChip;
          } else {
            overflowRemote += rChip;
          }
        }
      }
    }

    var html = '';
    if (matchedHtml || overflowMatched) {
      html += '<div class="dm-setting-expanded">' + matchedHtml;
      if (overflowMatched) {
        html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-matched">Show ' + (totalChips - 15) + ' more\u2026</span>';
        html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-matched">' + overflowMatched + '</div>';
      }
      html += '</div>';
    }
    html += '<div class="dm-setting-sides">';
    html += '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--primary,#6366f1)">Local</div><div class="dm-setting-expanded">' + localHtml;
    if (overflowLocal) {
      html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-local">Show more\u2026</span>';
      html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-local">' + overflowLocal + '</div>';
    }
    html += '</div></div>';
    html += '<div class="dm-setting-arrow">\u2192</div>';
    html += '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--info,#3b82f6)">Remote</div><div class="dm-setting-expanded">' + remoteHtml;
    if (overflowRemote) {
      html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-remote">Show more\u2026</span>';
      html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-remote">' + overflowRemote + '</div>';
    }
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  function _renderKvPills(key, localObj, remoteObj) {
    var allKeys = {};
    var k;
    for (k in localObj) allKeys[k] = true;
    for (k in remoteObj) allKeys[k] = true;

    var matchedHtml = '';
    var localHtml = '';
    var remoteHtml = '';
    var diffCount = 0;
    var overflowLocal = '';
    var overflowRemote = '';

    for (k in allKeys) {
      var lv = localObj.hasOwnProperty(k) ? localObj[k] : undefined;
      var rv = remoteObj.hasOwnProperty(k) ? remoteObj[k] : undefined;
      var fieldKey = 'setting-' + key + '-' + k;
      var selSide = _fieldSelections[fieldKey] || '';
      var humanKey = _titleCase(k);

      if (lv !== undefined && rv !== undefined && lv === rv) {
        matchedHtml += '<span class="dm-kv-pill matched">' + _esc(humanKey) + ': ' + _esc(String(lv)) + '</span> ';
      } else {
        diffCount++;
        var localPill = '';
        var remotePill = '';
        if (lv !== undefined) {
          var lCls = 'dm-kv-pill local' + (selSide === 'local' ? ' dm-selected' : '');
          localPill = '<span class="' + lCls + '" data-field="' + _esc(fieldKey) + '" data-side="local">' + _esc(humanKey) + ': ' + _esc(String(lv)) + '</span> ';
        }
        if (rv !== undefined) {
          var rCls = 'dm-kv-pill remote' + (selSide === 'remote' ? ' dm-selected' : '');
          remotePill = '<span class="' + rCls + '" data-field="' + _esc(fieldKey) + '" data-side="remote">' + _esc(humanKey) + ': ' + _esc(String(rv)) + '</span> ';
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

    var html = '';
    if (matchedHtml) html += '<div class="dm-setting-expanded">' + matchedHtml + '</div>';
    html += '<div class="dm-setting-sides">';
    html += '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--primary,#6366f1)">Local</div><div class="dm-setting-expanded">' + localHtml;
    if (overflowLocal) {
      html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-local">Show ' + (diffCount - 15) + ' more\u2026</span>';
      html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-local">' + overflowLocal + '</div>';
    }
    html += '</div></div>';
    html += '<div class="dm-setting-arrow">\u2192</div>';
    html += '<div class="dm-setting-side"><div class="dm-setting-side-label" style="color:var(--info,#3b82f6)">Remote</div><div class="dm-setting-expanded">' + remoteHtml;
    if (overflowRemote) {
      html += '<span class="dm-show-more" data-expand="' + _esc(key) + '-remote">Show ' + (diffCount - 15) + ' more\u2026</span>';
      html += '<div class="dm-expandable" id="expand-' + _esc(key) + '-remote">' + overflowRemote + '</div>';
    }
    html += '</div></div>';
    html += '</div>';
    return html;
  }

  function _renderCountSummary(key, localVal, remoteVal) {
    var resKey = 'setting-' + key;
    var selected = _conflictResolutions[resKey] || '';
    var localCount = 0;
    var remoteCount = 0;
    if (Array.isArray(localVal)) localCount = localVal.length;
    else if (localVal && typeof localVal === 'object') localCount = Object.keys(localVal).length;
    else if (localVal !== null && localVal !== undefined) localCount = 1;
    if (Array.isArray(remoteVal)) remoteCount = remoteVal.length;
    else if (remoteVal && typeof remoteVal === 'object') remoteCount = Object.keys(remoteVal).length;
    else if (remoteVal !== null && remoteVal !== undefined) remoteCount = 1;

    var localBtnCls = 'dm-count-btn' + (selected === 'local' ? ' active' : '');
    var remoteBtnCls = 'dm-count-btn' + (selected === 'remote' ? ' active' : '');

    var html = '<div class="dm-count-summary">';
    html += '<span class="dm-count-badge">' + _esc(String(localCount)) + ' local</span>';
    html += '<span class="dm-count-badge">' + _esc(String(remoteCount)) + ' remote</span>';
    html += '<span class="' + localBtnCls + '" data-setting-resolution="' + _esc(resKey) + '" data-side="local">Keep Local</span>';
    html += '<span class="' + remoteBtnCls + '" data-setting-resolution="' + _esc(resKey) + '" data-side="remote">Use Remote</span>';
    html += '</div>';
    return html;
  }

  function _renderSettingRow(key, localVal, remoteVal) {
    var type = SETTINGS_VALUE_TYPE[key];
    if (!type) return null;
    if (type === 'chip-strip' && !Array.isArray(localVal) && !Array.isArray(remoteVal)) return null;
    if (type === 'toggle-map' && (typeof localVal !== 'object' || localVal === null) && (typeof remoteVal !== 'object' || remoteVal === null)) return null;
    if (type === 'slug-chips' && !Array.isArray(localVal) && !Array.isArray(remoteVal)) return null;
    if (type === 'kv-pills' && (typeof localVal !== 'object' || localVal === null) && (typeof remoteVal !== 'object' || remoteVal === null)) return null;
    switch (type) {
      case 'chip-strip': return _renderChipStrip(key, localVal || [], remoteVal || []);
      case 'toggle-map': return _renderToggleMap(key, localVal || {}, remoteVal || {});
      case 'slug-chips': return _renderSlugChips(key, localVal || [], remoteVal || []);
      case 'kv-pills': return _renderKvPills(key, localVal || {}, remoteVal || {});
      case 'count-summary': return _renderCountSummary(key, localVal, remoteVal);
      default: return null;
    }
  }

  function _groupByItem(conflictsArray) {
    var grouped = {};
    if (!conflictsArray || !conflictsArray.length) return grouped;
    for (var i = 0; i < conflictsArray.length; i++) {
      var c = conflictsArray[i];
      var name = c.itemName || c.itemKey || '';
      if (!grouped[name]) grouped[name] = [];
      grouped[name].push({ field: c.field, localVal: c.localVal, remoteVal: c.remoteVal, idx: i });
    }
    return grouped;
  }

  function _formatSettingValue(key, value) {
    if (key === 'metalApiConfig') return value ? '\u2022\u2022\u2022 configured' : 'not set';
    if (value === null || value === undefined) return '\u2014';
    if (typeof value === 'boolean') return value ? 'On' : 'Off';
    if (Array.isArray(value)) {
      var label = value.length + ' items';
      if (value.length > 0 && typeof value[0] === 'string') {
        var preview = value.slice(0, 2).join(', ');
        if (value.length > 2) preview += ', \u2026';
        label += ' (' + _esc(preview) + ')';
      }
      return label;
    }
    if (typeof value === 'object') return Object.keys(value).length + ' entries';
    return _esc(String(value));
  }

  // ── Metal helpers ──

  var _metalRgb = {
    gold: '255,215,0', silver: '192,192,192',
    platinum: '229,228,226', palladium: '206,208,206'
  };
  var _metalCssVar = {
    gold: 'var(--gold)', silver: 'var(--silver)',
    platinum: 'var(--platinum)', palladium: 'var(--palladium)'
  };

  function _metalColor(metal) {
    var key = (metal || '').toLowerCase();
    return _metalCssVar[key] || 'var(--text-muted,#6b7094)';
  }

  function _metalBgGradient(metal) {
    var key = (metal || '').toLowerCase();
    var rgb = _metalRgb[key] || '128,128,128';
    return 'linear-gradient(135deg, rgba(' + rgb + ',0.15), rgba(' + rgb + ',0.05))';
  }

  // ── Internal state ──
  var _options = null;
  var _checkedItems = {};      // { 'added-0': true, 'modified-2': false, ... }
  var _conflictResolutions = {}; // { 'c0': 'local'|'remote', ... }
  var _collapsedCategories = {}; // { added: true, ... }
  var _expandedModified = {};    // { 0: true, 1: false, ... }
  var _expandedSettingsCategories = {}; // { 'Display & Appearance': true, ... }
  var _selectAllState = 0;  // 0=none, 1=added+modified, 2=all

  // Card-based state (STAK-454)
  var _orphanActions = {};       // { 'added-0': 'import'|'skip', 'deleted-1': 'keep'|'remove' }
  var _fieldSelections = {};     // { 'conflict-0-purchasePrice': 'local'|'remote' }
  var _resolvedConflicts = {};   // { 0: true, 1: true }
  var _blobUrls = [];            // Tracked blob URLs for revocation on re-render/close

  // ── Helpers ──

  /** Safe HTML escape — falls back to inline if sanitizeHtml not loaded */
  function _esc(text) {
    if (typeof sanitizeHtml === 'function') return sanitizeHtml(text);
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _titleCase(key) {
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, function(c) { return c.toUpperCase(); });
  }

  /** Derive a display key for an item */
  function _itemKey(item) {
    if (typeof DiffEngine !== 'undefined' && DiffEngine.computeItemKey) {
      return DiffEngine.computeItemKey(item);
    }
    return String(item.serial || item.name || '');
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
      if (_checkedItems['added-' + a] !== false) selectedAdded++;
    }
    for (let d = 0; d < deleted.length; d++) {
      if (_checkedItems['deleted-' + d] !== false) selectedDeleted++;
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
    const countRowEl = safeGetElement('diffReviewCountRow');
    const warningEl = safeGetElement('diffReviewCountWarning');

    if (backupCount != null && localCount != null) {
      const projectedCount = _computeProjectedCount();

      if (countRowEl) {
        countRowEl.innerHTML = 'Backup: <strong>' + backupCount + '</strong> items'
          + ' &nbsp;|&nbsp; Current: <strong>' + localCount + '</strong> items'
          + ' &nbsp;|&nbsp; After import: <strong>' + projectedCount + '</strong>';
        countRowEl.style.display = '';
      }

      if (warningEl) {
        const missing = backupCount - projectedCount;
        if (missing > 0) {
          warningEl.textContent = missing + ' item' + (missing > 1 ? 's' : '') + ' from the backup will not be imported (e.g., skipped due to validation errors, not selected, or already present locally).';
          warningEl.style.display = '';
        } else {
          warningEl.textContent = '';
          warningEl.style.display = 'none';
        }
      }

      // Fire onSelectionChange callback if provided
      if (typeof _options.onSelectionChange === 'function') {
        const selected = _buildSelectedChanges();
        _options.onSelectionChange(selected, projectedCount);
      }
    } else {
      if (countRowEl) countRowEl.style.display = 'none';
      if (warningEl) warningEl.style.display = 'none';
    }
  }

  /** Get the header title based on source type */
  function _getTitle(source) {
    if (!source) return 'Review Changes';
    switch (source.type) {
      case 'sync': return 'Review Sync Changes';
      case 'csv':  return 'Review CSV Import';
      case 'json': return 'Review JSON Import';
      default:     return 'Review Changes';
    }
  }

  /** Get source icon HTML entity */
  function _getSourceIcon(source) {
    if (!source) return '';
    switch (source.type) {
      case 'sync': return '&#9729; ';  // cloud
      case 'csv':  return '&#128196; '; // page
      case 'json': return '&#128230; '; // package
      default:     return '';
    }
  }

  // ── Rendering ──

  function _renderSummaryDashboard(container, diff, conflicts) {
    if (!container) return;
    var matched = (diff.unchanged || []).length;
    var syncConflicts = (conflicts && conflicts.conflicts || []).length;
    var modifiedCount = (diff.modified || []).length;
    // Show whichever is relevant: true sync conflicts, or modified items for imports
    var conflictCount = syncConflicts > 0 ? syncConflicts : modifiedCount;
    var remoteOnly = (diff.added || []).length;
    var localOnly = (diff.deleted || []).length;

    var cards = [
      { count: matched, label: 'Matched', target: 'diffSectionModified', color: '', style: 'opacity:0.5' },
      { count: conflictCount, label: 'Conflicts', target: syncConflicts > 0 ? 'diffSectionConflicts' : 'diffSectionModified', color: conflictCount > 0 ? 'color:#d97706' : '', style: '' },
      { count: remoteOnly, label: 'Remote Only', target: 'diffSectionOrphans', color: '', style: '' },
      { count: localOnly, label: 'Local Only', target: 'diffSectionOrphans', color: '', style: '' }
    ];

    var cardStyle = 'flex:1;min-width:120px;border-radius:8px;padding:0.6rem;border:1px solid var(--border-color,#ddd);cursor:pointer;text-align:center';
    var html = '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin:0.75rem 0">';
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var numStyle = 'font-size:1.4rem;font-weight:700';
      if (card.style) numStyle += ';' + card.style;
      if (card.color) numStyle += ';' + card.color;
      html += '<div data-scroll-target="' + _esc(card.target) + '" style="' + cardStyle + '">';
      html += '<div style="' + numStyle + '">' + card.count + '</div>';
      html += '<div style="font-size:0.7rem;opacity:0.6">' + _esc(card.label) + '</div>';
      html += '</div>';
    }
    html += '</div>';

    container.innerHTML = html;
    container.onclick = function(e) {
      var target = e.target.closest('[data-scroll-target]');
      if (target) {
        var el = safeGetElement(target.getAttribute('data-scroll-target'));
        if (el instanceof HTMLElement) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
  }

  function _renderProgressTracker(container, conflicts, source) {
    if (!container) return;
    if (!source || source.type !== 'sync') {
      container.style.display = 'none';
      return;
    }

    var total = 0;
    var resolved = 0;
    for (var key in _conflictResolutions) {
      if (_conflictResolutions.hasOwnProperty(key) && key.charAt(0) === 'c' && key.indexOf('setting-') !== 0) {
        total++;
        if (_conflictResolutions[key]) resolved++;
      }
    }

    var pct = total > 0 ? Math.round((resolved / total) * 100) : 100;
    var html = '<div style="height:6px;border-radius:3px;background:var(--border-color,#ddd);margin:0.5rem 0">';
    html += '<div style="height:100%;border-radius:3px;background:#22c55e;width:' + pct + '%;transition:width 0.3s"></div>';
    html += '</div>';
    html += '<div id="diffProgressText" style="font-size:0.75rem;opacity:0.6">' + resolved + ' of ' + total + ' conflicts resolved';
    if (pct === 100 && total > 0) html += ' &#9989;';
    html += '</div>';

    container.innerHTML = html;
    container.style.display = '';
  }

  function _updateProgress() {
    var container = safeGetElement('diffProgressTracker');
    if (!container) return;

    var total = 0;
    var resolved = 0;
    for (var key in _conflictResolutions) {
      if (_conflictResolutions.hasOwnProperty(key) && key.charAt(0) === 'c' && key.indexOf('setting-') !== 0) {
        total++;
        if (_conflictResolutions[key]) resolved++;
      }
    }

    var pct = total > 0 ? Math.round((resolved / total) * 100) : 100;
    var bar = container.querySelector('div > div');
    if (bar) bar.style.width = pct + '%';

    var textDiv = safeGetElement('diffProgressText');
    if (!(textDiv instanceof HTMLElement)) textDiv = null;
    if (textDiv) {
      var txt = resolved + ' of ' + total + ' conflicts resolved';
      if (pct === 100 && total > 0) txt += ' \u2705';
      textDiv.textContent = txt;
    }
  }

  function _renderConflictCards(container, conflicts) {
    if (!container) return;
    if (!conflicts || !conflicts.conflicts || conflicts.conflicts.length === 0) {
      container.style.display = 'none';
      return;
    }

    var grouped = _groupByItem(conflicts.conflicts);
    var html = '';

    for (var itemName in grouped) {
      if (!grouped.hasOwnProperty(itemName)) continue;
      var fields = grouped[itemName];

      html += '<div data-conflict-card="' + _esc(itemName) + '" style="border-radius:8px;border:1px solid var(--border-color,#ddd);padding:0.75rem;margin-bottom:0.75rem">';

      // Card header
      html += '<div>';
      html += '<span style="font-weight:600;font-size:0.85rem">' + _esc(itemName) + '</span>';
      html += '<span style="display:inline-block;background:rgba(217,119,6,0.1);color:#d97706;border-radius:12px;padding:0.1rem 0.5rem;font-size:0.7rem;margin-left:0.5rem">' + fields.length + ' field' + (fields.length !== 1 ? 's' : '') + '</span>';
      html += '</div>';

      // Field rows
      for (var f = 0; f < fields.length; f++) {
        var conflict = fields[f];
        var resKey = 'c' + conflict.idx + '-' + conflict.field;
        var selected = _conflictResolutions[resKey] || '';
        var localStyle = 'padding:0.25rem 0.6rem;border-radius:4px;cursor:pointer;font-size:0.8rem;';
        var remoteStyle = 'padding:0.25rem 0.6rem;border-radius:4px;cursor:pointer;font-size:0.8rem;';

        if (selected === 'local') {
          localStyle += 'border:1px solid #22c55e;background:rgba(34,197,94,0.08)';
          remoteStyle += 'border:1px solid transparent';
        } else if (selected === 'remote') {
          localStyle += 'border:1px solid transparent';
          remoteStyle += 'border:1px solid #22c55e;background:rgba(34,197,94,0.08)';
        } else {
          localStyle += 'border:1px solid transparent';
          remoteStyle += 'border:1px solid transparent';
        }

        var localDisplay = _esc(String(conflict.localVal != null ? conflict.localVal : '\u2014'));
        var remoteDisplay = _esc(String(conflict.remoteVal != null ? conflict.remoteVal : '\u2014'));

        html += '<div style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0">';
        html += '<span style="min-width:100px;font-size:0.78rem;opacity:0.6">' + _esc(conflict.field) + '</span>';
        html += '<span data-resolution="' + _esc(resKey) + '" data-side="local" style="' + localStyle + '">' + localDisplay + '</span>';
        html += '<span style="opacity:0.3;font-size:0.7rem">\u21C4</span>';
        html += '<span data-resolution="' + _esc(resKey) + '" data-side="remote" style="' + remoteStyle + '">' + remoteDisplay + '</span>';
        html += '</div>';
      }

      html += '</div>';
    }

    container.innerHTML = html;

    container.onclick = function(e) {
      var btn = e.target.closest('[data-resolution]');
      if (!btn) return;
      var key = btn.getAttribute('data-resolution');
      var side = btn.getAttribute('data-side');
      _conflictResolutions[key] = side;
      _renderConflictCards(container, conflicts);
      if (typeof _updateProgress === 'function') _updateProgress();
    };

    container.style.display = '';
  }

  function _renderSettingsCards(container, settingsDiff) {
    if (!container) return;
    var changed = (settingsDiff && settingsDiff.changed) ? settingsDiff.changed : [];
    var matched = (settingsDiff && (settingsDiff.unchanged || settingsDiff.matched)) ? (settingsDiff.unchanged || settingsDiff.matched) : [];
    if (changed.length === 0 && matched.length === 0) {
      container.innerHTML = '';
      container.style.display = 'none';
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
      return 'Other';
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

    // Collect all categories that have entries
    var allCats = {};
    var catKey;
    for (catKey in changedByCat) {
      if (changedByCat.hasOwnProperty(catKey)) allCats[catKey] = true;
    }
    for (catKey in matchedByCat) {
      if (matchedByCat.hasOwnProperty(catKey)) allCats[catKey] = true;
    }

    var html = '';
    var renderedCount = 0;

    for (catKey in allCats) {
      if (!allCats.hasOwnProperty(catKey)) continue;
      var catChanged = changedByCat[catKey] || [];
      var catMatched = matchedByCat[catKey] || [];
      if (catChanged.length === 0 && catMatched.length === 0) continue;

      var catDef = SETTINGS_CATEGORIES[catKey];
      var catIcon = catDef ? catDef.icon : '\u2699\uFE0F';

      html += '<div style="border-radius:8px;border:1px solid var(--border-color,#ddd);padding:0.75rem;margin-bottom:0.75rem">';

      // Card header
      html += '<div style="display:flex;align-items:center">';
      html += '<span style="font-weight:600;font-size:0.85rem">' + catIcon + ' ' + _esc(catKey) + '</span>';
      if (catChanged.length > 0) {
        html += '<span style="display:inline-block;background:rgba(217,119,6,0.1);color:#d97706;border-radius:12px;padding:0.1rem 0.5rem;font-size:0.7rem;margin-left:0.5rem">' + catChanged.length + ' diff' + (catChanged.length !== 1 ? 's' : '') + '</span>';
      }
      html += '</div>';

      // Changed setting rows
      for (var ci2 = 0; ci2 < catChanged.length; ci2++) {
        var entry = catChanged[ci2];
        var label = SETTINGS_LABELS[entry.key] || _titleCase(entry.key);

        // Try rich renderer first
        var expandedHtml = _renderSettingRow(entry.key, entry.localVal, entry.remoteVal);
        if (expandedHtml !== null) {
          html += '<div style="padding:0.3rem 0">';
          html += '<div style="font-size:0.78rem;opacity:0.6;margin-bottom:0.3rem">' + _esc(label) + '</div>';
          html += expandedHtml;
          html += '</div>';
          continue;
        }

        // Fallback: simple inline buttons
        var resKey = 'setting-' + entry.key;
        var selected = _conflictResolutions[resKey] || '';
        var localBtnStyle = 'padding:0.25rem 0.6rem;border-radius:4px;cursor:pointer;font-size:0.8rem;';
        var remoteBtnStyle = 'padding:0.25rem 0.6rem;border-radius:4px;cursor:pointer;font-size:0.8rem;';

        if (selected === 'local') {
          localBtnStyle += 'border:1px solid #22c55e;background:rgba(34,197,94,0.08)';
          remoteBtnStyle += 'border:1px solid transparent';
        } else if (selected === 'remote') {
          localBtnStyle += 'border:1px solid transparent';
          remoteBtnStyle += 'border:1px solid #22c55e;background:rgba(34,197,94,0.08)';
        } else {
          localBtnStyle += 'border:1px solid transparent';
          remoteBtnStyle += 'border:1px solid transparent';
        }

        html += '<div style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0">';
        html += '<span style="min-width:120px;font-size:0.78rem;opacity:0.6">' + _esc(label) + '</span>';
        html += '<span data-setting-resolution="' + _esc(resKey) + '" data-side="local" style="' + localBtnStyle + '">' + _formatSettingValue(entry.key, entry.localVal) + '</span>';
        html += '<span style="opacity:0.3;font-size:0.7rem">\u21C4</span>';
        html += '<span data-setting-resolution="' + _esc(resKey) + '" data-side="remote" style="' + remoteBtnStyle + '">' + _formatSettingValue(entry.key, entry.remoteVal) + '</span>';
        html += '</div>';
      }

      // Matched settings section (collapsed by default)
      if (catMatched.length > 0) {
        var isExpanded = _expandedSettingsCategories[catKey] || false;
        html += '<div data-toggle-matched="' + _esc(catKey) + '" style="font-size:0.73rem;cursor:pointer;color:var(--primary,#3b82f6);margin-top:0.3rem">';
        html += (isExpanded ? 'Hide' : 'Show') + ' ' + catMatched.length + ' matched';
        html += '</div>';

        if (isExpanded) {
          for (var mi = 0; mi < catMatched.length; mi++) {
            var mEntry = catMatched[mi];
            var mLabel = SETTINGS_LABELS[mEntry.key] || _titleCase(mEntry.key);
            html += '<div style="display:flex;align-items:center;gap:0.4rem;padding:0.2rem 0;opacity:0.6">';
            html += '<span style="font-size:0.78rem">\u2713</span>';
            html += '<span style="min-width:120px;font-size:0.78rem">' + _esc(mLabel) + '</span>';
            html += '<span style="font-size:0.78rem">both: ' + _formatSettingValue(mEntry.key, mEntry.localVal) + '</span>';
            html += '</div>';
          }
        }
      }

      html += '</div>';
      renderedCount++;
    }

    container.innerHTML = html;
    container.style.display = renderedCount > 0 ? '' : 'none';

    // Event delegation
    container.onclick = function(e) {
      var fieldBtn = e.target.closest('[data-field]');
      if (fieldBtn) {
        var field = fieldBtn.getAttribute('data-field');
        var side = fieldBtn.getAttribute('data-side');
        if (_fieldSelections[field] === side) {
          delete _fieldSelections[field];
        } else {
          _fieldSelections[field] = side;
        }
        _renderSettingsCards(container, settingsDiff);
        return;
      }
      var showMore = e.target.closest('.dm-show-more');
      if (showMore) {
        var expandKey = showMore.getAttribute('data-expand');
        var expandEl = document.getElementById('expand-' + expandKey);
        if (expandEl) {
          expandEl.classList.add('expanded');
          showMore.style.display = 'none';
        }
        return;
      }
      var btn = e.target.closest('[data-setting-resolution]');
      if (btn) {
        var key = btn.getAttribute('data-setting-resolution');
        var rSide = btn.getAttribute('data-side');
        _conflictResolutions[key] = rSide;
        _renderSettingsCards(container, settingsDiff);
        return;
      }
      var toggle = e.target.closest('[data-toggle-matched]');
      if (toggle) {
        var cat = toggle.getAttribute('data-toggle-matched');
        _expandedSettingsCategories[cat] = !_expandedSettingsCategories[cat];
        _renderSettingsCards(container, settingsDiff);
      }
    };
  }

  // ── Card-based renderers (STAK-454 — matches playground/diffmodal-item-cards.html) ──

  /** Shared card header: dual OBV/REV thumbnails + item identity. Used by orphan and conflict cards. */
  function _renderCardHeader(item, uuid) {
    var grad = _metalBgGradient(item.metal);
    var mColor = _metalColor(item.metal);
    var html = '';
    // Dual OBV/REV thumbnails
    html += '<div class="dm-item-thumb-pair">';
    html += '<div class="dm-item-thumb" style="background:' + grad + '"' + (uuid ? ' data-uuid="' + _esc(uuid) + '" data-side="obverse"' : '') + '><span style="color:' + mColor + ';font-size:0.55rem">OBV</span></div>';
    html += '<div class="dm-item-thumb" style="background:' + grad + '"' + (uuid ? ' data-uuid="' + _esc(uuid) + '" data-side="reverse"' : '') + '><span style="color:' + mColor + ';font-size:0.55rem">REV</span></div>';
    html += '</div>';
    return html;
  }

  /** Render Added or Deleted items as orphan cards. Returns HTML string. */
  function _renderOrphanCards(type, items) {
    if (!items || items.length === 0) return '';
    var collapsed = _collapsedCategories[type];
    var isAdded = (type === 'added');
    var sectionColor = isAdded ? 'var(--info,#3b82f6)' : 'var(--loss,#ef4444)';
    var sectionIcon = isAdded ? '&#8595;' : '&#8593;';
    var sectionLabel = isAdded ? 'Added / Remote Only' : 'Deleted / Local Only';

    var html = '<div class="dm-section-wrapper" data-section="' + type + '" style="margin-top:1rem">';

    // Section header
    html += '<div class="dm-section-header">';
    html += '<div class="dm-section-title">';
    html += '<span class="dm-collapse-toggle' + (collapsed ? ' collapsed' : '') + '" data-cat-toggle="' + type + '">' + (collapsed ? '&#9654;' : '&#9660;') + '</span>';
    html += '<span style="color:' + sectionColor + '">' + sectionIcon + '</span> ' + sectionLabel;
    html += '<span class="dm-chip">' + items.length + ' item' + (items.length !== 1 ? 's' : '') + '</span>';
    html += '</div>';
    html += '<div class="dm-section-actions">';
    if (isAdded) {
      html += '<button class="dm-btn dm-btn-sm dm-btn-primary" data-bulk-action="import" data-bulk-section="added">Import All</button>';
      html += '<button class="dm-btn dm-btn-sm dm-btn-muted" data-bulk-action="skip" data-bulk-section="added">Skip All</button>';
    } else {
      html += '<button class="dm-btn dm-btn-sm dm-btn-gain" data-bulk-action="keep" data-bulk-section="deleted">Keep All</button>';
      html += '<button class="dm-btn dm-btn-sm dm-btn-muted" data-bulk-action="remove" data-bulk-section="deleted">Remove All</button>';
    }
    html += '</div>';
    html += '</div>';

    // Section body
    html += '<div class="dm-section-body' + (collapsed ? ' collapsed' : '') + '">';
    var showAll = _collapsedCategories['_showAll_' + type];
    var limit = (!showAll && items.length > 30) ? 30 : items.length;
    for (var i = 0; i < limit; i++) {
      var item = items[i];
      var key = type + '-' + i;
      var action = _orphanActions[key] || (isAdded ? 'import' : 'keep');
      var isSkipped = (isAdded && action === 'skip') || (!isAdded && action === 'remove');
      var mColor = _metalColor(item.metal);
      var uuid = item.uuid || '';

      html += '<div class="dm-card dm-orphan-card' + (isSkipped ? ' skipped' : '') + '" data-action="' + action + '" data-idx="' + i + '" data-type="' + type + '">';
      html += _renderCardHeader(item, uuid);
      // Item identity
      html += '<div class="dm-item-identity">';
      html += '<div class="dm-item-name" style="color:' + mColor + '">' + _esc(item.name || 'Unnamed item') + '</div>';
      html += '<div class="dm-item-meta">';
      html += '<span style="color:' + mColor + '">' + _esc(item.metal || '') + '</span>';
      if (item.weight != null) html += '<span>&#8226;</span><span>' + _esc(String(item.weight)) + ' ' + _esc(item.weightUnit || 'oz') + '</span>';
      if (item.qty != null) html += '<span>&#8226;</span><span>Qty: ' + _esc(String(item.qty)) + '</span>';
      html += '</div></div>';
      // Action buttons — active action gets prominent color, inactive gets muted
      html += '<div class="dm-orphan-actions">';
      if (isAdded) {
        var importActive = (action === 'import');
        html += '<button class="dm-btn dm-btn-sm ' + (importActive ? 'dm-btn-primary' : 'dm-btn-muted') + ' dm-action-btn" data-set-action="import" data-idx="' + i + '" data-type="' + type + '">&#8595; Import</button>';
        html += '<button class="dm-btn dm-btn-sm ' + (!importActive ? 'dm-btn-loss' : 'dm-btn-muted') + ' dm-skip-btn" data-set-action="skip" data-idx="' + i + '" data-type="' + type + '">Skip</button>';
      } else {
        var keepActive = (action === 'keep');
        html += '<button class="dm-btn dm-btn-sm ' + (keepActive ? 'dm-btn-gain' : 'dm-btn-muted') + ' dm-keep-btn" data-set-action="keep" data-idx="' + i + '" data-type="' + type + '">Keep</button>';
        html += '<button class="dm-btn dm-btn-sm ' + (!keepActive ? 'dm-btn-loss' : 'dm-btn-muted') + ' dm-remove-btn" data-set-action="remove" data-idx="' + i + '" data-type="' + type + '">Remove</button>';
      }
      html += '</div>';
      html += '</div>';
    }
    if (!showAll && items.length > 30) {
      html += '<div class="dm-show-more" data-show-more="' + type + '" style="text-align:center;padding:0.5rem;font-size:0.78rem;cursor:pointer;color:var(--primary,#6366f1)">Show ' + (items.length - 30) + ' more...</div>';
    }
    html += '</div></div>';
    return html;
  }

  /** Render Modified items as conflict cards with click-to-pick field values. Returns HTML string. */
  function _renderModifiedSection(modifiedItems) {
    if (!modifiedItems || modifiedItems.length === 0) return '';

    var collapsed = _collapsedCategories.modified;
    var html = '<div class="dm-section-wrapper" data-section="modified" style="margin-top:1rem">';

    // Section header
    html += '<div class="dm-section-header">';
    html += '<div class="dm-section-title">';
    html += '<span class="dm-collapse-toggle' + (collapsed ? ' collapsed' : '') + '" data-cat-toggle="modified">' + (collapsed ? '&#9654;' : '&#9660;') + '</span>';
    html += '<span style="color:var(--warning,#d97706)">&#9888;</span> Modified / Conflicts';
    html += '<span class="dm-chip">' + modifiedItems.length + ' item' + (modifiedItems.length !== 1 ? 's' : '') + '</span>';
    html += '</div>';
    html += '<div class="dm-section-actions">';
    html += '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-global-action="keep-all-local">Keep All Local</button>';
    html += '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-global-action="keep-all-remote">Keep All Remote</button>';
    html += '</div>';
    html += '</div>';

    // Resolve progress
    var resolvedCount = 0;
    for (var rc = 0; rc < modifiedItems.length; rc++) {
      if (_resolvedConflicts[rc]) resolvedCount++;
    }
    var remaining = modifiedItems.length - resolvedCount;
    var pct = modifiedItems.length > 0 ? Math.round((resolvedCount / modifiedItems.length) * 100) : 0;

    html += '<div class="dm-resolve-status">';
    html += '<span class="dm-status-text">Resolved <strong>' + resolvedCount + '</strong> of <strong>' + modifiedItems.length + '</strong> conflicts</span>';
    if (remaining === 0 && modifiedItems.length > 0) {
      html += '<span class="dm-pill dm-pill-gain">All resolved &#10003;</span>';
    } else {
      html += '<span class="dm-pill dm-pill-warning">' + remaining + ' remaining</span>';
    }
    html += '</div>';
    html += '<div class="dm-progress-bar"><div class="dm-progress-fill" style="width:' + pct + '%"></div></div>';

    // Section body
    html += '<div class="dm-section-body' + (collapsed ? ' collapsed' : '') + '">';

    for (var i = 0; i < modifiedItems.length; i++) {
      var mod = modifiedItems[i];
      var item = mod.item;
      var changes = mod.changes || [];
      var mColor = _metalColor(item.metal);
      var uuid = item.uuid || '';
      var isResolved = _resolvedConflicts[i];
      var itemKey = _itemKey(item);

      html += '<div class="dm-card dm-conflict-card' + (isResolved ? ' resolved' : '') + '" id="dm-conflict-' + i + '">';

      // Card header
      html += '<div class="dm-conflict-card-header" data-toggle-conflict="' + i + '" style="cursor:pointer">';
      html += _renderCardHeader(item, uuid);
      // Identity
      html += '<div class="dm-item-identity">';
      html += '<div class="dm-item-name">' + _esc(item.name || 'Unnamed item') + '</div>';
      html += '<div class="dm-item-meta">';
      html += '<span style="color:' + mColor + '">' + _esc(item.metal || '') + '</span>';
      if (item.weight != null) html += '<span>&#8226;</span><span>' + _esc(String(item.weight)) + ' ' + _esc(item.weightUnit || 'oz') + '</span>';
      html += '<span>&#8226;</span><span class="dm-chip" style="font-size:0.65rem">ID: ' + _esc(itemKey).substring(0, 16) + '</span>';
      html += '</div></div>';
      // Field count pill
      if (isResolved) {
        html += '<span class="dm-pill dm-pill-gain">&#10003; Resolved</span>';
      } else {
        html += '<span class="dm-pill dm-pill-warning">' + changes.length + ' field' + (changes.length !== 1 ? 's' : '') + ' changed</span>';
      }
      html += '</div>';

      // Conflict details (field rows)
      var detailsCollapsed = isResolved;
      html += '<div class="dm-conflict-details' + (detailsCollapsed ? ' collapsed' : '') + '" id="dm-conflict-details-' + i + '">';
      for (var c = 0; c < changes.length; c++) {
        var ch = changes[c];
        var fKey = 'conflict-' + i + '-' + ch.field;
        var sel = _fieldSelections[fKey] || 'remote';
        var localSelected = sel === 'local' ? ' selected' : '';
        var remoteSelected = sel === 'remote' ? ' selected' : '';

        html += '<div class="dm-field-diff">';
        html += '<div class="dm-field-label">' + _esc(ch.field) + '</div>';
        var localDisplay = (ch.localVal != null && ch.localVal !== '') ? String(ch.localVal) : '\u2014';
        var remoteDisplay = (ch.remoteVal != null && ch.remoteVal !== '') ? String(ch.remoteVal) : '\u2014';
        html += '<div class="dm-field-value local' + localSelected + '" data-field="' + _esc(ch.field) + '" data-card="' + i + '" title="' + _esc(localDisplay) + '">' + _esc(localDisplay) + '</div>';
        html += '<div class="dm-field-arrow">&#10231;</div>';
        html += '<div class="dm-field-value remote' + remoteSelected + '" data-field="' + _esc(ch.field) + '" data-card="' + i + '" title="' + _esc(remoteDisplay) + '">' + _esc(remoteDisplay) + '</div>';
        html += '</div>';
      }
      // Card actions
      html += '<div class="dm-card-actions">';
      html += '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-card-action="keep-local" data-card="' + i + '">Keep All Local</button>';
      html += '<button class="dm-btn dm-btn-sm dm-btn-secondary" data-card-action="keep-remote" data-card="' + i + '">Keep All Remote</button>';
      html += '<button class="dm-btn dm-btn-sm dm-btn-primary" data-card-action="resolve" data-card="' + i + '">&#10003; Confirm</button>';
      html += '</div>';
      html += '</div>'; // .dm-conflict-details

      html += '</div>'; // .dm-conflict-card
    }

    html += '</div></div>';
    return html;
  }

  /** Load images asynchronously using resolveImageUrlForItem (same as main app) */
  function _loadItemImages() {
    try {
      // Revoke previous blob URLs to prevent memory leaks
      for (var bi = 0; bi < _blobUrls.length; bi++) {
        try { URL.revokeObjectURL(_blobUrls[bi]); } catch(e) { /* ignore */ }
      }
      _blobUrls = [];

      var modal = safeGetElement(MODAL_ID);
      if (!modal || typeof imageCache === 'undefined' || !imageCache.resolveImageUrlForItem) return;

      // Build UUID → item lookup from current diff data
      var itemByUuid = {};
      var diff = _options ? _options.diff || {} : {};
      var allItems = (diff.added || []).concat(diff.deleted || []);
      for (var mi = 0; mi < (diff.modified || []).length; mi++) {
        allItems.push((diff.modified || [])[mi].item);
      }
      for (var ai = 0; ai < allItems.length; ai++) {
        if (allItems[ai] && allItems[ai].uuid) {
          itemByUuid[allItems[ai].uuid] = allItems[ai];
        }
      }

      var thumbs = modal.querySelectorAll('[data-uuid]');
      for (var t = 0; t < thumbs.length; t++) {
        (function(el) {
          var uuid = el.dataset.uuid;
          var side = el.dataset.side || 'obverse';
          if (!uuid) return;
          var item = itemByUuid[uuid];
          if (!item) return;
          try {
            imageCache.resolveImageUrlForItem(item, side).then(function(url) {
              var imgUrl = url;
              if (!imgUrl) {
                // Fallback: CDN URL from item properties (same as main app tier 2)
                var urlKey = side === 'reverse' ? 'reverseImageUrl' : 'obverseImageUrl';
                var cdnUrl = item[urlKey];
                if (cdnUrl && /^https?:\/\/[^\s"'<>]+$/i.test(cdnUrl)) {
                  imgUrl = cdnUrl;
                }
              }
              if (imgUrl) {
                if (imgUrl.indexOf('blob:') === 0) _blobUrls.push(imgUrl);
                var img = document.createElement('img');
                img.src = imgUrl;
                img.alt = side;
                img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:var(--radius,8px)';
                el.textContent = '';
                el.appendChild(img);
              }
            }).catch(function() { /* silent fallback to OBV/REV text */ });
          } catch(e) { /* imageCache not available */ }
        })(thumbs[t]);
      }
    } catch(e) { /* silent */ }
  }

  function _updateApplyButton() {
    var applyBtn = safeGetElement('diffReviewApplyBtn');
    if (!applyBtn) return;
    var count = _checkedCount();
    var hasSelectableItems = Object.keys(_checkedItems).length > 0;
    var hasSettings = _options && _options.settingsDiff && _options.settingsDiff.changed && _options.settingsDiff.changed.length > 0;
    applyBtn.textContent = count > 0 ? 'Apply (' + count + ')' : 'Apply';
    applyBtn.disabled = hasSelectableItems && count === 0 && !hasSettings;
    applyBtn.style.opacity = (hasSelectableItems && count === 0 && !hasSettings) ? '0.4' : '';
  }

  function _render() {
    if (!_options) return;

    var titleEl = safeGetElement('diffReviewTitle');
    var sourceEl = safeGetElement('diffReviewSource');

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
      var sourceHtml = '<div style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.78rem;font-weight:500;padding:0.2rem 0.55rem;border-radius:6px;background:rgba(59,130,246,0.12);color:var(--primary,#3b82f6)">';
      sourceHtml += _getSourceIcon(source) + _esc(source.label || '');
      sourceHtml += '</div>';

      // Meta row (sync only)
      if (meta && source.type === 'sync') {
        sourceHtml += '<div class="cloud-sync-update-meta" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:0.5rem;margin-top:0.6rem;padding:0.5rem 0.65rem;border-radius:8px;background:var(--bg-secondary,var(--bg-elev-1,#f1f5f9));font-size:0.8rem">';
        sourceHtml += _metaCell('Remote Items', meta.itemCount != null ? String(meta.itemCount) : '\u2014');
        if (typeof inventory !== 'undefined') {
          sourceHtml += _metaCell('Local Items', String(inventory.length));
        }
        sourceHtml += _metaCell('Device', meta.deviceId ? meta.deviceId.slice(0, 8) + '\u2026' : 'unknown');
        sourceHtml += _metaCell('Version', meta.appVersion ? 'v' + meta.appVersion : '\u2014');
        sourceHtml += '</div>';
      }

      sourceEl.innerHTML = sourceHtml;
    }

    // Count row (backup import flow only)
    _updateCountRow();

    // Summary dashboard (replaces old summary chips)
    _renderSummaryDashboard(safeGetElement('diffSummaryDashboard'), diff, conflicts);

    // Progress tracker (sync only)
    _renderProgressTracker(safeGetElement('diffProgressTracker'), conflicts, source);

    // Conflict cards (replaces old inline conflict rendering)
    _renderConflictCards(safeGetElement('diffSectionConflicts'), conflicts);

    // Orphan cards (Added + Deleted) — render into #diffSectionOrphans
    var orphanEl = safeGetElement('diffSectionOrphans');
    if (orphanEl) {
      var orphanHtml = '';
      if (added.length > 0) orphanHtml += _renderOrphanCards('added', added);
      if (deleted.length > 0) orphanHtml += _renderOrphanCards('deleted', deleted);
      orphanEl.innerHTML = orphanHtml;
      orphanEl.style.display = orphanHtml ? '' : 'none';
    }

    // Modified conflict cards — render into #diffSectionModified
    var modifiedEl = safeGetElement('diffSectionModified');
    if (modifiedEl) {
      var modHtml = '';
      if (modified.length > 0) {
        modHtml = _renderModifiedSection(modified);
      } else {
        var totalChanges = added.length + deleted.length;
        if (totalChanges === 0) {
          modHtml = '<div style="padding:2rem;text-align:center;opacity:0.45;font-size:0.85rem">No item changes detected</div>';
        }
      }
      modifiedEl.innerHTML = modHtml;
    }

    // Async image loading
    _loadItemImages();

    // Settings cards (replaces old settings <details>)
    _renderSettingsCards(safeGetElement('diffReviewSettings'), _options.settingsDiff);

    // Apply button
    _updateApplyButton();
  }

  /** Render a meta cell for the source info row */
  function _metaCell(label, value) {
    return '<div style="display:flex;flex-direction:column;gap:0.1rem">'
      + '<span style="font-size:0.65rem;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em">' + _esc(label) + '</span>'
      + '<strong style="font-weight:600">' + _esc(value) + '</strong>'
      + '</div>';
  }

  // _renderCategory() has been replaced by _renderOrphanCards() and _renderModifiedSection() (STAK-454)

  // ── Event delegation (STAK-454 — card-based interactions) ──

  /** Swap a button's style class based on active state and section type */
  function _swapBtnClass(btn, sectionType, actionName, isActive) {
    btn.classList.remove('dm-btn-primary', 'dm-btn-gain', 'dm-btn-loss', 'dm-btn-muted', 'dm-btn-secondary');
    if (!isActive) {
      btn.classList.add('dm-btn-muted');
      return;
    }
    // Active: positive actions get their accent color, negative actions get loss
    if (actionName === 'import') btn.classList.add('dm-btn-primary');
    else if (actionName === 'keep') btn.classList.add('dm-btn-gain');
    else btn.classList.add('dm-btn-loss'); // skip, remove
  }

  /** Update both action buttons on an orphan card to reflect the current action */
  function _updateOrphanBtnStyles(card, type, action) {
    var btns = card.querySelectorAll('[data-set-action]');
    for (var bi = 0; bi < btns.length; bi++) {
      var btnAction = btns[bi].dataset.setAction;
      _swapBtnClass(btns[bi], type, btnAction, btnAction === action);
    }
  }

  /** Handle clicks on orphan cards (Added/Deleted) */
  function _onOrphanClick(e) {
    var target = e.target;

    // Orphan card action button (Import/Skip/Keep/Remove)
    var actionBtn = target.closest('[data-set-action]');
    if (actionBtn) {
      e.stopPropagation();
      var action = actionBtn.dataset.setAction;
      var idx = parseInt(actionBtn.dataset.idx, 10);
      var type = actionBtn.dataset.type;
      var key = type + '-' + idx;
      _orphanActions[key] = action;
      // Also sync _checkedItems for backward compat
      if (type === 'added') _checkedItems[key] = (action !== 'skip');
      if (type === 'deleted') _checkedItems[key] = (action === 'remove');
      // Toggle visual state on card and buttons
      var card = actionBtn.closest('.dm-orphan-card');
      if (card) {
        var isSkipped = (action === 'skip' || action === 'remove');
        card.classList.toggle('skipped', isSkipped);
        card.dataset.action = action;
        _updateOrphanBtnStyles(card, type, action);
      }
      _updateApplyCount();
      return;
    }

    // Bulk action buttons (Import All, Skip All, Keep All, Remove All)
    var bulkBtn = target.closest('[data-bulk-action]');
    if (bulkBtn) {
      var bulkAction = bulkBtn.dataset.bulkAction;
      var bulkSection = bulkBtn.dataset.bulkSection;
      var cards = e.currentTarget.querySelectorAll('.dm-orphan-card[data-type="' + bulkSection + '"]');
      for (var bi = 0; bi < cards.length; bi++) {
        var bCard = cards[bi];
        var bIdx = parseInt(bCard.dataset.idx, 10);
        var bKey = bulkSection + '-' + bIdx;
        _orphanActions[bKey] = bulkAction;
        if (bulkSection === 'added') _checkedItems[bKey] = (bulkAction !== 'skip');
        if (bulkSection === 'deleted') _checkedItems[bKey] = (bulkAction === 'remove');
        var bSkipped = (bulkAction === 'skip' || bulkAction === 'remove');
        bCard.classList.toggle('skipped', bSkipped);
        bCard.dataset.action = bulkAction;
        _updateOrphanBtnStyles(bCard, bulkSection, bulkAction);
      }
      // Update bulk button styles in section header
      var sectionWrapper = bulkBtn.closest('.dm-section-wrapper');
      if (sectionWrapper) {
        var bulkBtns = sectionWrapper.querySelectorAll('[data-bulk-action]');
        for (var bbi = 0; bbi < bulkBtns.length; bbi++) {
          var bb = bulkBtns[bbi];
          var isActive = (bb.dataset.bulkAction === bulkAction);
          _swapBtnClass(bb, bulkSection, bb.dataset.bulkAction, isActive);
        }
      }
      _updateApplyCount();
      return;
    }

    // Section collapse toggle
    var catToggle = target.closest('[data-cat-toggle]');
    if (catToggle) {
      var cat = catToggle.dataset.catToggle;
      _collapsedCategories[cat] = !_collapsedCategories[cat];
      _render();
      return;
    }

    // Show more button
    var showMore = target.closest('[data-show-more]');
    if (showMore) {
      var smType = showMore.dataset.showMore;
      // Remove the limit and re-render (set a flag to show all)
      _collapsedCategories['_showAll_' + smType] = true;
      _render();
      return;
    }
  }

  /** Handle clicks on modified/conflict cards */
  function _onModifiedClick(e) {
    var target = e.target;

    // Field value click (click to pick local or remote)
    var fieldVal = target.closest('.dm-field-value');
    if (fieldVal && fieldVal.dataset.field && fieldVal.dataset.card != null) {
      var field = fieldVal.dataset.field;
      var cardIdx = parseInt(fieldVal.dataset.card, 10);
      var fKey = 'conflict-' + cardIdx + '-' + field;
      var side = fieldVal.classList.contains('local') ? 'local' : 'remote';
      _fieldSelections[fKey] = side;
      // Update visual: remove selected from sibling, add to clicked
      var row = fieldVal.closest('.dm-field-diff');
      if (row) {
        var siblings = row.querySelectorAll('.dm-field-value');
        for (var si = 0; si < siblings.length; si++) siblings[si].classList.remove('selected');
      }
      fieldVal.classList.add('selected');
      _updateApplyCount();
      return;
    }

    // Per-card action buttons (Keep All Local, Keep All Remote, Confirm)
    var cardAction = target.closest('[data-card-action]');
    if (cardAction) {
      var action = cardAction.dataset.cardAction;
      var ci = parseInt(cardAction.dataset.card, 10);
      var card = e.currentTarget.querySelector('#dm-conflict-' + ci);
      if (!card) return;

      if (action === 'keep-local' || action === 'keep-remote') {
        var pickSide = action === 'keep-local' ? 'local' : 'remote';
        var fieldVals = card.querySelectorAll('.dm-field-value.' + pickSide);
        for (var fvi = 0; fvi < fieldVals.length; fvi++) {
          var fv = fieldVals[fvi];
          var fRow = fv.closest('.dm-field-diff');
          if (fRow) {
            var fSiblings = fRow.querySelectorAll('.dm-field-value');
            for (var fsi = 0; fsi < fSiblings.length; fsi++) fSiblings[fsi].classList.remove('selected');
          }
          fv.classList.add('selected');
          if (fv.dataset.field) {
            _fieldSelections['conflict-' + ci + '-' + fv.dataset.field] = pickSide;
          }
        }
        _updateApplyCount();
        return;
      }

      if (action === 'resolve') {
        // Validate all fields have a selection
        var fieldDiffs = card.querySelectorAll('.dm-field-diff');
        var allResolved = true;
        for (var fd = 0; fd < fieldDiffs.length; fd++) {
          if (!fieldDiffs[fd].querySelector('.dm-field-value.selected')) {
            allResolved = false;
            // Flash unresolved field
            fieldDiffs[fd].style.background = 'rgba(239,68,68,0.1)';
            (function(el) {
              setTimeout(function() { el.style.background = ''; }, 600);
            })(fieldDiffs[fd]);
          }
        }
        if (!allResolved) return;

        // Mark resolved
        _resolvedConflicts[ci] = true;
        card.classList.add('resolved');
        var pill = card.querySelector('.dm-conflict-card-header .dm-pill');
        if (pill) {
          pill.className = 'dm-pill dm-pill-gain';
          pill.innerHTML = '&#10003; Resolved';
        }
        // Collapse the details
        var details = card.querySelector('.dm-conflict-details');
        if (details) details.classList.add('collapsed');

        // Update progress
        _updateModifiedProgress();
        _updateApplyCount();
        return;
      }
      return;
    }

    // Global Keep All Local / Keep All Remote
    var globalAction = target.closest('[data-global-action]');
    if (globalAction) {
      var gAction = globalAction.dataset.globalAction;
      var gSide = gAction === 'keep-all-local' ? 'local' : 'remote';
      var allFieldVals = e.currentTarget.querySelectorAll('.dm-field-value.' + gSide);
      for (var gfi = 0; gfi < allFieldVals.length; gfi++) {
        var gfv = allFieldVals[gfi];
        var gRow = gfv.closest('.dm-field-diff');
        if (gRow) {
          var gSiblings = gRow.querySelectorAll('.dm-field-value');
          for (var gsi = 0; gsi < gSiblings.length; gsi++) gSiblings[gsi].classList.remove('selected');
        }
        gfv.classList.add('selected');
        if (gfv.dataset.field && gfv.dataset.card != null) {
          _fieldSelections['conflict-' + gfv.dataset.card + '-' + gfv.dataset.field] = gSide;
        }
      }
      _updateApplyCount();
      return;
    }

    // Conflict card header click — toggle expand/collapse
    var conflictToggle = target.closest('[data-toggle-conflict]');
    if (conflictToggle) {
      var tIdx = parseInt(conflictToggle.dataset.toggleConflict, 10);
      var tDetails = e.currentTarget.querySelector('#dm-conflict-details-' + tIdx);
      if (tDetails) tDetails.classList.toggle('collapsed');
      return;
    }

    // Section collapse toggle
    var catToggle = target.closest('[data-cat-toggle]');
    if (catToggle) {
      var cat = catToggle.dataset.catToggle;
      _collapsedCategories[cat] = !_collapsedCategories[cat];
      _render();
      return;
    }
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
    var bar = safeGetElement('diffSectionModified');
    if (bar) {
      var fill = bar.querySelector('.dm-progress-fill');
      if (fill) fill.style.width = pct + '%';
      var statusText = bar.querySelector('.dm-status-text');
      if (statusText) statusText.innerHTML = 'Resolved <strong>' + resolved + '</strong> of <strong>' + modified.length + '</strong> conflicts';
      var pillEl = bar.querySelector('.dm-resolve-status .dm-pill');
      if (pillEl) {
        if (remaining === 0) {
          pillEl.className = 'dm-pill dm-pill-gain';
          pillEl.innerHTML = 'All resolved &#10003;';
        } else {
          pillEl.className = 'dm-pill dm-pill-warning';
          pillEl.textContent = remaining + ' remaining';
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
      if (_orphanActions['added-' + a] !== 'skip') count++;
    }
    for (var m = 0; m < modified.length; m++) {
      count++; // modified items always included (user picks field winners)
    }
    for (var d = 0; d < deleted.length; d++) {
      if (_orphanActions['deleted-' + d] === 'remove') count++;
    }
    return count;
  }

  /** Update just the Apply button count without full re-render */
  function _updateApplyCount() {
    var applyBtn = safeGetElement('diffReviewApplyBtn');
    if (applyBtn) {
      var hasCardState = Object.keys(_orphanActions).length > 0 || Object.keys(_fieldSelections).length > 0;
      var count = hasCardState ? _cardBasedCount() : _checkedCount();
      var hasSettings = _options && _options.settingsDiff && _options.settingsDiff.changed && _options.settingsDiff.changed.length > 0;
      applyBtn.textContent = count > 0 ? 'Apply (' + count + ')' : 'Apply';
      applyBtn.disabled = count === 0 && !hasSettings;
      applyBtn.style.opacity = (count === 0 && !hasSettings) ? '0.4' : '';
    }
    _updateCountRow();
  }

  // ── Select All / Deselect All ──

  function _selectAll() {
    var diff = _options.diff || {};
    // Card-based: set all orphan actions to include
    for (var i = 0; i < (diff.added || []).length; i++) {
      _orphanActions['added-' + i] = 'import';
      _checkedItems['added-' + i] = true;
    }
    for (var j = 0; j < (diff.modified || []).length; j++) {
      _checkedItems['modified-' + j] = true;
      // Select all remote for each modified field
      var mod = (diff.modified || [])[j];
      if (mod && mod.changes) {
        for (var c = 0; c < mod.changes.length; c++) {
          _fieldSelections['conflict-' + j + '-' + mod.changes[c].field] = 'remote';
        }
      }
    }
    for (var k = 0; k < (diff.deleted || []).length; k++) {
      _orphanActions['deleted-' + k] = 'remove';
      _checkedItems['deleted-' + k] = true;
    }
    _render();
  }

  function _deselectAll() {
    var diff = _options.diff || {};
    for (var i = 0; i < (diff.added || []).length; i++) {
      _orphanActions['added-' + i] = 'skip';
      _checkedItems['added-' + i] = false;
    }
    for (var k in _checkedItems) {
      if (_checkedItems.hasOwnProperty(k)) _checkedItems[k] = false;
    }
    for (var d = 0; d < (diff.deleted || []).length; d++) {
      _orphanActions['deleted-' + d] = 'keep';
    }
    // Reset modified field selections to local (deselect = keep local values)
    for (var m = 0; m < (diff.modified || []).length; m++) {
      var mod = (diff.modified || [])[m];
      if (mod && mod.changes) {
        for (var c = 0; c < mod.changes.length; c++) {
          _fieldSelections['conflict-' + m + '-' + mod.changes[c].field] = 'local';
        }
      }
    }
    _render();
  }

  /**
   * Toggle "Select All / Deselect All" for the backup import flow.
   */
  function _toggleSelectAll() {
    var diff = _options ? _options.diff || {} : {};
    _selectAllState = (_selectAllState + 1) % 3;
    if (_selectAllState === 1) {
      // First press: import all added, keep deleted untouched
      for (var i = 0; i < (diff.added || []).length; i++) {
        _orphanActions['added-' + i] = 'import';
        _checkedItems['added-' + i] = true;
      }
      for (var j = 0; j < (diff.modified || []).length; j++) {
        _checkedItems['modified-' + j] = true;
        var mod1 = (diff.modified || [])[j];
        if (mod1 && mod1.changes) {
          for (var c1 = 0; c1 < mod1.changes.length; c1++) {
            _fieldSelections['conflict-' + j + '-' + mod1.changes[c1].field] = 'remote';
          }
        }
      }
      for (var k = 0; k < (diff.deleted || []).length; k++) {
        _orphanActions['deleted-' + k] = 'keep';
        _checkedItems['deleted-' + k] = false;
      }
    } else if (_selectAllState === 2) {
      // Second press: also mark deleted for removal
      for (var k2 = 0; k2 < (diff.deleted || []).length; k2++) {
        _orphanActions['deleted-' + k2] = 'remove';
        _checkedItems['deleted-' + k2] = true;
      }
    } else {
      // Third press: deselect all
      for (var a = 0; a < (diff.added || []).length; a++) {
        _orphanActions['added-' + a] = 'skip';
        _checkedItems['added-' + a] = false;
      }
      for (var key in _checkedItems) {
        if (_checkedItems.hasOwnProperty(key)) _checkedItems[key] = false;
      }
      for (var d = 0; d < (diff.deleted || []).length; d++) {
        _orphanActions['deleted-' + d] = 'keep';
      }
      // Reset field selections to local
      for (var m3 = 0; m3 < (diff.modified || []).length; m3++) {
        var mod3 = (diff.modified || [])[m3];
        if (mod3 && mod3.changes) {
          for (var c3 = 0; c3 < mod3.changes.length; c3++) {
            _fieldSelections['conflict-' + m3 + '-' + mod3.changes[c3].field] = 'local';
          }
        }
      }
    }
    var toggleBtn = safeGetElement('diffReviewSelectAllToggle');
    if (toggleBtn) {
      var labels = ['Select All', 'Add Deleted', 'Deselect All'];
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
    var prefix = 'setting-' + key + '-';

    if (type === 'chip-strip') {
      // Array of {id, label, enabled, ...} — merge by id
      if (!Array.isArray(localVal) && !Array.isArray(remoteVal)) return null;
      var lArr = Array.isArray(localVal) ? localVal : [];
      var rArr = Array.isArray(remoteVal) ? remoteVal : [];
      var lById = {};
      var rById = {};
      var i, id;
      for (i = 0; i < lArr.length; i++) {
        id = lArr[i].id || lArr[i].label || i;
        lById[id] = lArr[i];
      }
      for (i = 0; i < rArr.length; i++) {
        id = rArr[i].id || rArr[i].label || i;
        rById[id] = rArr[i];
      }
      // Start with remote as base (default), apply local picks
      var merged = [];
      // Process all ids from both sides
      var allIds = {};
      for (id in lById) allIds[id] = true;
      for (id in rById) allIds[id] = true;
      for (id in allIds) {
        var sel = _fieldSelections[prefix + id];
        if (sel === 'local' && lById[id]) {
          merged.push(lById[id]);
        } else if (sel === 'remote' && rById[id]) {
          merged.push(rById[id]);
        } else if (rById[id]) {
          merged.push(rById[id]); // default: remote wins
        } else if (lById[id]) {
          merged.push(lById[id]); // only in local, no selection
        }
      }
      return merged;
    }

    if (type === 'toggle-map' || type === 'kv-pills') {
      // Object merge — key by key
      if ((typeof localVal !== 'object' || localVal === null) &&
          (typeof remoteVal !== 'object' || remoteVal === null)) return null;
      var lObj = (typeof localVal === 'object' && localVal !== null) ? localVal : {};
      var rObj = (typeof remoteVal === 'object' && remoteVal !== null) ? remoteVal : {};
      var result = {};
      var allKeys = {};
      var k;
      for (k in lObj) allKeys[k] = true;
      for (k in rObj) allKeys[k] = true;
      for (k in allKeys) {
        var kSel = _fieldSelections[prefix + k];
        if (kSel === 'local' && lObj.hasOwnProperty(k)) {
          result[k] = lObj[k];
        } else if (kSel === 'remote' && rObj.hasOwnProperty(k)) {
          result[k] = rObj[k];
        } else if (rObj.hasOwnProperty(k)) {
          result[k] = rObj[k]; // default: remote
        } else if (lObj.hasOwnProperty(k)) {
          result[k] = lObj[k]; // only in local
        }
      }
      return result;
    }

    if (type === 'slug-chips') {
      // String array — set merge
      if (!Array.isArray(localVal) && !Array.isArray(remoteVal)) return null;
      var lSet = {};
      var rSet = {};
      var lList = Array.isArray(localVal) ? localVal : [];
      var rList = Array.isArray(remoteVal) ? remoteVal : [];
      for (i = 0; i < lList.length; i++) lSet[lList[i]] = true;
      for (i = 0; i < rList.length; i++) rSet[rList[i]] = true;
      var mergedArr = [];
      // Common items always included
      var allSlugs = {};
      for (i = 0; i < lList.length; i++) allSlugs[lList[i]] = true;
      for (i = 0; i < rList.length; i++) allSlugs[rList[i]] = true;
      for (var slug in allSlugs) {
        var inL = !!lSet[slug];
        var inR = !!rSet[slug];
        if (inL && inR) {
          mergedArr.push(slug); // common — always include
        } else {
          var slugSel = _fieldSelections[prefix + slug];
          if (inL && slugSel === 'local') {
            mergedArr.push(slug); // local-only, user picked local
          } else if (inR && (slugSel === 'remote' || !slugSel)) {
            mergedArr.push(slug); // remote-only, user picked remote or default
          }
          // else: local-only with no selection or remote pick → exclude
          // or: remote-only with local pick → exclude
        }
      }
      return mergedArr;
    }

    return null; // unknown type — fallback
  }

  function _buildSelectedChanges() {
    var diff = _options.diff || {};
    var result = [];
    var added = diff.added || [];
    var modified = diff.modified || [];
    var deleted = diff.deleted || [];
    var hasCardState = Object.keys(_orphanActions).length > 0 || Object.keys(_fieldSelections).length > 0;

    // Added items — card state or legacy fallback
    for (var a = 0; a < added.length; a++) {
      var includeAdded = hasCardState
        ? (_orphanActions['added-' + a] !== 'skip')
        : (_checkedItems['added-' + a] !== false);
      if (includeAdded) {
        result.push({ type: 'add', item: added[a] });
      }
    }

    // Modified items — per-field selection via _fieldSelections
    for (var m = 0; m < modified.length; m++) {
      var mod = modified[m];
      var mKey = _itemKey(mod.item);
      if (hasCardState) {
        // Card-based: always emit all fields, user picks local vs remote per field
        for (var c = 0; c < mod.changes.length; c++) {
          var ch = mod.changes[c];
          var fSel = _fieldSelections['conflict-' + m + '-' + ch.field] || 'remote';
          result.push({
            type: 'modify',
            itemKey: mKey,
            field: ch.field,
            value: fSel === 'local' ? ch.localVal : ch.remoteVal
          });
        }
      } else {
        // Legacy fallback: emit all fields if item is checked
        if (_checkedItems['modified-' + m] !== false) {
          for (var c2 = 0; c2 < mod.changes.length; c2++) {
            var ch2 = mod.changes[c2];
            result.push({
              type: 'modify',
              itemKey: mKey,
              field: ch2.field,
              value: ch2.remoteVal
            });
          }
        }
      }
    }

    // Deleted items — card state or legacy fallback
    for (var d = 0; d < deleted.length; d++) {
      var includeDeleted = hasCardState
        ? (_orphanActions['deleted-' + d] === 'remove')
        : (_checkedItems['deleted-' + d] !== false);
      if (includeDeleted) {
        result.push({ type: 'delete', itemKey: _itemKey(deleted[d]) });
      }
    }

    // Item conflict resolutions (sync-specific conflicts section — separate from modified cards)
    var conflictsArr = (_options.conflicts && _options.conflicts.conflicts) || [];
    for (var ci = 0; ci < conflictsArr.length; ci++) {
      var conf = conflictsArr[ci];
      var resKey = 'c' + ci + '-' + conf.field;
      var side = _conflictResolutions[resKey] || 'remote';
      var itemKey = conf.itemKey || conf.itemName || '';
      result.push({
        type: 'modify',
        itemKey: itemKey,
        field: conf.field,
        value: (side === 'local') ? conf.localVal : conf.remoteVal
      });
    }

    // Settings changes — per-element merge for rich renderer types, whole-setting for others
    var settingsDiff = _options.settingsDiff || {};
    var changedSettings = settingsDiff.changed || [];
    for (var s = 0; s < changedSettings.length; s++) {
      var setting = changedSettings[s];
      var sType = SETTINGS_VALUE_TYPE[setting.key];
      var sPrefix = 'setting-' + setting.key + '-';

      // Check for per-element selections (skip count-summary — whole-setting only)
      var hasElementPicks = false;
      if (sType && sType !== 'count-summary') {
        for (var fk in _fieldSelections) {
          if (_fieldSelections.hasOwnProperty(fk) && fk.indexOf(sPrefix) === 0) {
            hasElementPicks = true;
            break;
          }
        }
      }

      if (hasElementPicks) {
        var mergedVal = _mergeSettingElements(sType, setting.key, setting.localVal, setting.remoteVal);
        if (mergedVal !== null) {
          result.push({ type: 'setting', key: setting.key, value: mergedVal });
          continue;
        }
      }

      // Fallback: whole-setting pick via _conflictResolutions (default remote)
      var resolution = _conflictResolutions['setting-' + setting.key];
      var value = (resolution === 'local') ? setting.localVal : setting.remoteVal;
      result.push({ type: 'setting', key: setting.key, value: value });
    }

    return result;
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
    if (typeof callback === 'function') {
      callback(selected);
    }
  }

  function _onCancel() {
    // Capture callback before close() — close() nullifies _options
    var callback = _options && _options.onCancel;
    DiffModal.close();
    if (typeof callback === 'function') {
      callback();
    }
  }

  // ── Wire buttons (called once per show) ──

  function _wireEvents() {
    var listEl = safeGetElement('diffSectionModified');
    var selectAllBtn = safeGetElement('diffReviewSelectAll');
    var deselectAllBtn = safeGetElement('diffReviewDeselectAll');
    var selectAllToggleBtn = safeGetElement('diffReviewSelectAllToggle');
    var applyBtn = safeGetElement('diffReviewApplyBtn');
    var cancelBtn = safeGetElement('diffReviewCancelBtn');
    var dismissX = safeGetElement('diffReviewDismissX');

    // Determine whether we're in backup-count mode
    var hasBackupCount = _options && _options.backupCount != null;

    // Event delegation on card containers
    var orphanEl = safeGetElement('diffSectionOrphans');
    if (orphanEl) {
      orphanEl.removeEventListener('click', _onOrphanClick);
      orphanEl.addEventListener('click', _onOrphanClick);
    }
    if (listEl) {
      listEl.removeEventListener('click', _onModifiedClick);
      listEl.addEventListener('click', _onModifiedClick);
    }

    // Pill buttons
    var btnStyle = 'display:inline-flex;align-items:center;gap:0.3rem;border-radius:999px;font-size:0.73rem;font-weight:500;cursor:pointer;transition:all 0.15s;';

    if (selectAllBtn) {
      if (hasBackupCount) {
        selectAllBtn.style.display = 'none';
      } else {
        selectAllBtn.style.display = '';
        selectAllBtn.onclick = _selectAll;
        selectAllBtn.setAttribute('style', btnStyle + 'padding:0.3rem 0.7rem;background:none;border:1.5px solid var(--border,#cbd5e1);color:var(--text-muted,#64748b)');
      }
    }
    if (deselectAllBtn) {
      if (hasBackupCount) {
        deselectAllBtn.style.display = 'none';
      } else {
        deselectAllBtn.style.display = '';
        deselectAllBtn.onclick = _deselectAll;
        deselectAllBtn.setAttribute('style', btnStyle + 'padding:0.3rem 0.7rem;background:none;border:1.5px solid var(--border,#cbd5e1);color:var(--text-muted,#64748b)');
      }
    }

    // Select All toggle button — only shown when backupCount is provided
    if (selectAllToggleBtn) {
      if (hasBackupCount) {
        selectAllToggleBtn.textContent = ['Select All', 'Add Deleted', 'Deselect All'][_selectAllState];
        selectAllToggleBtn.onclick = _toggleSelectAll;
        selectAllToggleBtn.setAttribute('style', btnStyle + 'padding:0.3rem 0.7rem;background:none;border:1.5px solid var(--border,#cbd5e1);color:var(--text-muted,#64748b)');
        selectAllToggleBtn.style.display = '';
      } else {
        selectAllToggleBtn.style.display = 'none';
        selectAllToggleBtn.onclick = null;
      }
    }

    if (cancelBtn) {
      cancelBtn.onclick = _onCancel;
      cancelBtn.setAttribute('style', btnStyle + 'padding:0.45rem 1rem;font-size:0.8rem;background:none;border:1.5px solid var(--border,#cbd5e1);color:var(--text-muted,#64748b)');
    }
    if (applyBtn) {
      applyBtn.onclick = _onApply;
      applyBtn.setAttribute('style', btnStyle + 'padding:0.45rem 1.2rem;font-size:0.8rem;font-weight:600;background:#d97706;color:#fff;border:1.5px solid #d97706');
    }
    if (dismissX) {
      dismissX.onclick = _onCancel;
    }
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
      _collapsedCategories = {};
      _expandedModified = {};
      _expandedSettingsCategories = {};
      _selectAllState = 0;
      _orphanActions = {};
      _fieldSelections = {};
      _resolvedConflicts = {};

      // Default all items to checked (legacy compat) + initialize card-based state
      var diff = _options.diff || {};
      for (var a = 0; a < (diff.added || []).length; a++) {
        _checkedItems['added-' + a] = true;
        _orphanActions['added-' + a] = 'import';
      }
      for (var m = 0; m < (diff.modified || []).length; m++) {
        _checkedItems['modified-' + m] = true;
        // Initialize per-field selections to 'remote' (default: accept incoming)
        var mod = (diff.modified || [])[m];
        if (mod && mod.changes) {
          for (var fc = 0; fc < mod.changes.length; fc++) {
            _fieldSelections['conflict-' + m + '-' + mod.changes[fc].field] = 'remote';
          }
        }
      }
      for (var d = 0; d < (diff.deleted || []).length; d++) {
        _checkedItems['deleted-' + d] = false;
        _orphanActions['deleted-' + d] = 'keep';
      }

      // Default conflict resolutions to 'remote' (per-field keys)
      if (_options.conflicts && _options.conflicts.conflicts) {
        for (var ci = 0; ci < _options.conflicts.conflicts.length; ci++) {
          var conflict = _options.conflicts.conflicts[ci];
          _conflictResolutions['c' + ci + '-' + conflict.field] = null;
        }
      }

      // Default settings resolutions to 'remote'
      if (_options.settingsDiff && _options.settingsDiff.changed) {
        for (var si = 0; si < _options.settingsDiff.changed.length; si++) {
          _conflictResolutions['setting-' + _options.settingsDiff.changed[si].key] = 'remote';
        }
      }

      // Render content
      _render();

      // Wire event handlers
      _wireEvents();

      // Open modal
      if (typeof openModalById === 'function') {
        openModalById(MODAL_ID);
      } else {
        var modal = safeGetElement(MODAL_ID);
        if (modal) modal.style.display = 'flex';
      }
    },

    /**
     * Close the modal programmatically.
     */
    close: function () {
      // Revoke tracked blob URLs to prevent memory leaks
      for (var bi = 0; bi < _blobUrls.length; bi++) {
        try { URL.revokeObjectURL(_blobUrls[bi]); } catch(e) { /* ignore */ }
      }
      _blobUrls = [];
      if (typeof closeModalById === 'function') {
        closeModalById(MODAL_ID);
      } else {
        var modal = safeGetElement(MODAL_ID);
        if (modal) modal.style.display = 'none';
      }
      _options = null;
    }
  };

  // Export globally
  if (typeof window !== 'undefined') {
    window.DiffModal = DiffModal;
  }

})();
