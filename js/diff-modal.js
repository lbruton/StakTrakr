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

  // ── Internal state ──
  var _options = null;
  var _checkedItems = {};      // { 'added-0': true, 'modified-2': false, ... }
  var _conflictResolutions = {}; // { 'c0': 'local'|'remote', ... }
  var _collapsedCategories = {}; // { added: true, ... }
  var _expandedModified = {};    // { 0: true, 1: false, ... }
  var _selectAllToggle = false;  // true = currently "all selected" (button shows "Deselect All")

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
    var localCount = _options.localCount != null ? _options.localCount : 0;
    var diff = _options.diff || {};
    var added = diff.added || [];
    var deleted = diff.deleted || [];
    var selectedAdded = 0;
    var selectedDeleted = 0;
    for (var a = 0; a < added.length; a++) {
      if (_checkedItems['added-' + a] !== false) selectedAdded++;
    }
    for (var d = 0; d < deleted.length; d++) {
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
    var backupCount = _options.backupCount;
    var localCount = _options.localCount;
    var countRowEl = safeGetElement('diffReviewCountRow');
    var warningEl = safeGetElement('diffReviewCountWarning');

    if (backupCount != null && localCount != null) {
      var projectedCount = _computeProjectedCount();

      if (countRowEl) {
        countRowEl.innerHTML = 'Backup: <strong>' + backupCount + '</strong> items'
          + ' &nbsp;|&nbsp; Current: <strong>' + localCount + '</strong> items'
          + ' &nbsp;|&nbsp; After import: <strong>' + projectedCount + '</strong>';
        countRowEl.style.display = '';
      }

      if (warningEl) {
        var missing = backupCount - projectedCount;
        if (missing > 0) {
          warningEl.textContent = missing + ' item' + (missing > 1 ? 's' : '') + ' from the backup will not be imported because they were not selected.';
          warningEl.style.display = '';
        } else {
          warningEl.textContent = '';
          warningEl.style.display = 'none';
        }
      }

      // Fire onSelectionChange callback if provided
      if (typeof _options.onSelectionChange === 'function') {
        var selected = _buildSelectedChanges();
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

  function _render() {
    if (!_options) return;

    var titleEl = safeGetElement('diffReviewTitle');
    var sourceEl = safeGetElement('diffReviewSource');
    var summaryEl = safeGetElement('diffReviewSummary');
    var conflictsEl = safeGetElement('diffReviewConflicts');
    var listEl = safeGetElement('diffReviewList');
    var settingsEl = safeGetElement('diffReviewSettings');
    var applyBtn = safeGetElement('diffReviewApplyBtn');

    var diff = _options.diff || {};
    var added = diff.added || [];
    var modified = diff.modified || [];
    var deleted = diff.deleted || [];
    var unchanged = diff.unchanged || [];
    var settingsDiff = _options.settingsDiff;
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

    // Summary chips
    if (summaryEl) {
      var chips = [];
      if (added.length > 0) chips.push('<span style="display:inline-flex;align-items:center;gap:0.2rem;padding:0.2rem 0.5rem;border-radius:20px;font-size:0.73rem;font-weight:600;background:rgba(5,150,105,0.12);color:var(--success,#059669)">+' + added.length + ' added</span>');
      if (modified.length > 0) chips.push('<span style="display:inline-flex;align-items:center;gap:0.2rem;padding:0.2rem 0.5rem;border-radius:20px;font-size:0.73rem;font-weight:600;background:rgba(217,119,6,0.12);color:var(--warning,#d97706)">&#9998; ' + modified.length + ' modified</span>');
      if (deleted.length > 0) chips.push('<span style="display:inline-flex;align-items:center;gap:0.2rem;padding:0.2rem 0.5rem;border-radius:20px;font-size:0.73rem;font-weight:600;background:rgba(220,38,38,0.12);color:var(--danger,#dc2626)">&minus;' + deleted.length + ' deleted</span>');
      if (unchanged.length > 0) chips.push('<span style="display:inline-flex;align-items:center;gap:0.2rem;padding:0.2rem 0.5rem;border-radius:20px;font-size:0.73rem;font-weight:600;background:rgba(107,114,128,0.1);color:#6b7280">' + unchanged.length + ' unchanged</span>');
      if (settingsDiff && settingsDiff.changed && settingsDiff.changed.length > 0) {
        chips.push('<span style="display:inline-flex;align-items:center;gap:0.2rem;padding:0.2rem 0.5rem;border-radius:20px;font-size:0.73rem;font-weight:600;background:rgba(59,130,246,0.1);color:var(--primary,#3b82f6)">' + settingsDiff.changed.length + ' setting' + (settingsDiff.changed.length > 1 ? 's' : '') + '</span>');
      }
      summaryEl.innerHTML = chips.length > 0
        ? '<div style="display:flex;flex-wrap:wrap;gap:0.35rem">' + chips.join('') + '</div>'
        : 'No changes detected';
    }

    // Conflicts section
    if (conflictsEl) {
      if (conflicts && conflicts.conflicts && conflicts.conflicts.length > 0) {
        var cHtml = '<div style="border-radius:8px;padding:0.75rem;background:rgba(217,119,6,0.08);border:1px solid rgba(217,119,6,0.2)">';
        cHtml += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:0.5rem;color:var(--warning,#d97706)">&#9888; ' + conflicts.conflicts.length + ' conflict' + (conflicts.conflicts.length > 1 ? 's' : '') + ' detected</div>';
        for (var ci = 0; ci < conflicts.conflicts.length; ci++) {
          var cf = conflicts.conflicts[ci];
          var res = _conflictResolutions['c' + ci] || 'remote';
          cHtml += '<div style="padding:0.5rem;border-radius:6px;margin-bottom:0.35rem;font-size:0.8rem;background:rgba(0,0,0,0.06)">';
          cHtml += '<div style="font-weight:600">' + _esc(cf.itemName || cf.itemKey || 'Item') + '</div>';
          cHtml += '<div style="font-size:0.73rem;opacity:0.6;margin-bottom:0.35rem">' + _esc(cf.field) + '</div>';
          cHtml += '<div style="display:flex;gap:0.75rem">';
          cHtml += '<label style="display:flex;align-items:center;gap:0.3rem;cursor:pointer;font-size:0.8rem"><input type="radio" name="diffConflict' + ci + '" value="local" ' + (res === 'local' ? 'checked' : '') + ' data-conflict="' + ci + '" style="width:16px;height:16px;padding:0;border:none;accent-color:var(--primary,#3b82f6)"> Local: <strong>' + _esc(String(cf.localVal != null ? cf.localVal : '\u2014')) + '</strong></label>';
          cHtml += '<label style="display:flex;align-items:center;gap:0.3rem;cursor:pointer;font-size:0.8rem"><input type="radio" name="diffConflict' + ci + '" value="remote" ' + (res === 'remote' ? 'checked' : '') + ' data-conflict="' + ci + '" style="width:16px;height:16px;padding:0;border:none;accent-color:var(--primary,#3b82f6)"> Remote: <strong>' + _esc(String(cf.remoteVal != null ? cf.remoteVal : '\u2014')) + '</strong></label>';
          cHtml += '</div></div>';
        }
        cHtml += '</div>';
        conflictsEl.innerHTML = cHtml;
        conflictsEl.style.display = '';
      } else {
        conflictsEl.innerHTML = '';
        conflictsEl.style.display = 'none';
      }
    }

    // Change list
    if (listEl) {
      var totalChanges = added.length + modified.length + deleted.length;
      var lHtml = '';

      if (totalChanges === 0) {
        lHtml = '<div style="padding:2rem;text-align:center;opacity:0.45;font-size:0.85rem">No item changes detected</div>';
      } else {
        // Added
        if (added.length > 0) lHtml += _renderCategory('added', 'Added', '+', added);
        // Modified
        if (modified.length > 0) lHtml += _renderCategory('modified', 'Modified', '&#9998;', modified);
        // Deleted
        if (deleted.length > 0) lHtml += _renderCategory('deleted', 'Deleted', '&minus;', deleted);
      }

      listEl.innerHTML = lHtml;
    }

    // Settings diff
    if (settingsEl) {
      if (settingsDiff && settingsDiff.changed && settingsDiff.changed.length > 0) {
        var sHtml = '<details style="margin-top:0.25rem" open>';
        sHtml += '<summary style="cursor:pointer;font-weight:600;font-size:0.8rem;padding:0.4rem 0;user-select:none">';
        sHtml += settingsDiff.changed.length + ' setting change' + (settingsDiff.changed.length > 1 ? 's' : '') + '</summary>';
        sHtml += '<div style="padding:0.4rem 0 0.25rem 0;font-size:0.8rem">';
        for (var si = 0; si < settingsDiff.changed.length; si++) {
          var sc = settingsDiff.changed[si];
          sHtml += '<div style="padding:0.2rem 0;display:flex;gap:0.3rem;align-items:baseline">';
          sHtml += '<span style="opacity:0.5;min-width:80px">' + _esc(sc.key) + '</span>';
          sHtml += '<span style="text-decoration:line-through;opacity:0.45">' + _esc(String(sc.localVal != null ? sc.localVal : '\u2014')) + '</span>';
          sHtml += '<span style="opacity:0.35;font-size:0.7rem">&rarr;</span>';
          sHtml += '<span style="font-weight:500;color:var(--warning,#d97706)">' + _esc(String(sc.remoteVal != null ? sc.remoteVal : '\u2014')) + '</span>';
          sHtml += '</div>';
        }
        sHtml += '</div></details>';
        settingsEl.innerHTML = sHtml;
        settingsEl.style.display = '';
      } else {
        settingsEl.innerHTML = '';
        settingsEl.style.display = 'none';
      }
    }

    // Apply button count
    if (applyBtn) {
      var count = _checkedCount();
      applyBtn.textContent = count > 0 ? 'Apply (' + count + ')' : 'Apply';
      applyBtn.disabled = count === 0;
      applyBtn.style.opacity = count === 0 ? '0.4' : '';
    }

    // Count row (backup import flow only)
    _updateCountRow();
  }

  /** Render a meta cell for the source info row */
  function _metaCell(label, value) {
    return '<div style="display:flex;flex-direction:column;gap:0.1rem">'
      + '<span style="font-size:0.65rem;opacity:0.5;text-transform:uppercase;letter-spacing:0.05em">' + _esc(label) + '</span>'
      + '<strong style="font-weight:600">' + _esc(value) + '</strong>'
      + '</div>';
  }

  /** Color configs per category */
  var _catColors = {
    added:   { bg: 'rgba(5,150,105,0.12)', color: 'var(--success,#059669)' },
    modified:{ bg: 'rgba(217,119,6,0.12)',  color: 'var(--warning,#d97706)' },
    deleted: { bg: 'rgba(220,38,38,0.12)',  color: 'var(--danger,#dc2626)' }
  };

  /** Render a category group (added/modified/deleted) */
  function _renderCategory(type, label, icon, items) {
    var collapsed = _collapsedCategories[type];
    var cc = _catColors[type];
    var html = '<div data-cat="' + type + '" style="' + (collapsed ? '' : '') + '">';

    // Header
    html += '<div class="diff-cat-header" data-cat-toggle="' + type + '" style="display:flex;align-items:center;gap:0.4rem;padding:0.5rem 0.65rem;cursor:pointer;user-select:none;font-size:0.8rem;font-weight:600">';
    html += '<span style="font-size:0.6rem;opacity:0.4;transition:transform 0.2s;' + (collapsed ? 'transform:rotate(-90deg)' : '') + '">&#9660;</span>';
    html += '<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;font-size:0.7rem;font-weight:700;background:' + cc.bg + ';color:' + cc.color + '">' + icon + '</span>';
    html += '<span>' + label + '</span>';
    html += '<span style="font-weight:400;opacity:0.5;font-size:0.73rem">(' + items.length + ')</span>';
    html += '</div>';

    // Items
    html += '<div class="diff-cat-items" style="' + (collapsed ? 'display:none' : '') + '">';
    for (var i = 0; i < items.length; i++) {
      var key = type + '-' + i;
      var checked = _checkedItems[key] !== false; // default true
      var item = type === 'modified' ? items[i].item : items[i];
      var name = _esc(item.name || 'Unnamed item');

      html += '<div style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.45rem 0.65rem;font-size:0.85rem">';
      html += '<input type="checkbox" data-check="' + key + '" ' + (checked ? 'checked' : '') + ' style="width:16px;height:16px;min-width:16px;padding:0;border:none;accent-color:var(--primary,#3b82f6);margin-top:2px;flex-shrink:0;cursor:pointer">';
      html += '<div style="flex-shrink:0;width:20px;height:20px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;margin-top:1px;background:' + cc.bg + ';color:' + cc.color + '">' + icon + '</div>';

      html += '<div style="flex:1;min-width:0">';

      if (type === 'modified') {
        var mod = items[i];
        var expanded = _expandedModified[i];
        html += '<div class="diff-mod-toggle" data-mod-idx="' + i + '" style="cursor:pointer">';
        html += '<div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + ' <span style="font-size:0.65rem;opacity:0.35">' + (expanded ? '&#9650;' : '&#9660;') + '</span></div>';
        html += '<div style="font-size:0.73rem;opacity:0.5;margin-top:0.1rem">' + mod.changes.length + ' field' + (mod.changes.length > 1 ? 's' : '') + ' changed</div>';
        if (expanded) {
          html += '<div style="margin-top:0.35rem;padding-left:0.25rem;font-size:0.78rem">';
          for (var c = 0; c < mod.changes.length; c++) {
            var ch = mod.changes[c];
            html += '<div style="padding:0.15rem 0;display:flex;gap:0.3rem;align-items:baseline">';
            html += '<span style="opacity:0.5;min-width:80px">' + _esc(ch.field) + '</span>';
            html += '<span style="text-decoration:line-through;opacity:0.45">' + _esc(String(ch.localVal != null ? ch.localVal : '\u2014')) + '</span>';
            html += '<span style="opacity:0.35;font-size:0.7rem">&rarr;</span>';
            html += '<span style="font-weight:500;color:var(--warning,#d97706)">' + _esc(String(ch.remoteVal != null ? ch.remoteVal : '\u2014')) + '</span>';
            html += '</div>';
          }
          html += '</div>';
        }
        html += '</div>';
      } else {
        html += '<div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + '</div>';
        // Detail line
        var detail = [];
        if (item.metal) detail.push(_esc(item.metal));
        if (item.weight != null) detail.push(item.weight + (item.weightUnit || 'oz'));
        if (item.qty != null) detail.push('\u00d7 ' + item.qty);
        if (detail.length > 0) {
          html += '<div style="font-size:0.73rem;opacity:0.5;margin-top:0.1rem">' + detail.join(' \u00b7 ') + '</div>';
        }
      }

      html += '</div></div>';
    }
    html += '</div></div>';
    return html;
  }

  // ── Event delegation ──

  function _onListClick(e) {
    var target = e.target;

    // Checkbox toggle
    if (target.type === 'checkbox' && target.dataset.check) {
      _checkedItems[target.dataset.check] = target.checked;
      _updateApplyCount();
      return;
    }

    // Category collapse toggle
    var catToggle = target.closest('[data-cat-toggle]');
    if (catToggle) {
      var cat = catToggle.dataset.catToggle;
      _collapsedCategories[cat] = !_collapsedCategories[cat];
      _render();
      return;
    }

    // Modified row expand toggle
    var modToggle = target.closest('.diff-mod-toggle');
    if (modToggle) {
      var idx = parseInt(modToggle.dataset.modIdx, 10);
      _expandedModified[idx] = !_expandedModified[idx];
      _render();
      return;
    }
  }

  function _onConflictsChange(e) {
    if (e.target.type === 'radio' && e.target.dataset.conflict != null) {
      _conflictResolutions['c' + e.target.dataset.conflict] = e.target.value;
    }
  }

  /** Update just the Apply button count without full re-render */
  function _updateApplyCount() {
    var applyBtn = safeGetElement('diffReviewApplyBtn');
    if (applyBtn) {
      var count = _checkedCount();
      applyBtn.textContent = count > 0 ? 'Apply (' + count + ')' : 'Apply';
      applyBtn.disabled = count === 0;
      applyBtn.style.opacity = count === 0 ? '0.4' : '';
    }
    _updateCountRow();
  }

  // ── Select All / Deselect All ──

  function _selectAll() {
    var diff = _options.diff || {};
    for (var i = 0; i < (diff.added || []).length; i++) _checkedItems['added-' + i] = true;
    for (var j = 0; j < (diff.modified || []).length; j++) _checkedItems['modified-' + j] = true;
    for (var k = 0; k < (diff.deleted || []).length; k++) _checkedItems['deleted-' + k] = true;
    _render(); // _render calls _updateCountRow internally
  }

  function _deselectAll() {
    for (var key in _checkedItems) {
      if (_checkedItems.hasOwnProperty(key)) _checkedItems[key] = false;
    }
    _render(); // _render calls _updateCountRow internally
  }

  /**
   * Toggle "Select All / Deselect All" for the backup import flow.
   * First call selects all added + modified; label changes to "Deselect All".
   * Second call deselects all; label goes back to "Select All".
   */
  function _toggleSelectAll() {
    _selectAllToggle = !_selectAllToggle;
    var diff = _options ? _options.diff || {} : {};
    if (_selectAllToggle) {
      // Select all added and modified (spec: added + modified only for backup flow)
      for (var i = 0; i < (diff.added || []).length; i++) _checkedItems['added-' + i] = true;
      for (var j = 0; j < (diff.modified || []).length; j++) _checkedItems['modified-' + j] = true;
    } else {
      // Deselect all
      for (var key in _checkedItems) {
        if (_checkedItems.hasOwnProperty(key)) _checkedItems[key] = false;
      }
    }
    // Update toggle button label
    var toggleBtn = safeGetElement('diffReviewSelectAllToggle');
    if (toggleBtn) {
      toggleBtn.textContent = _selectAllToggle ? 'Deselect All' : 'Select All';
    }
    _render(); // _render calls _updateCountRow internally
  }

  // ── Apply / Cancel ──

  function _buildSelectedChanges() {
    var diff = _options.diff || {};
    var result = [];
    var added = diff.added || [];
    var modified = diff.modified || [];
    var deleted = diff.deleted || [];

    // Added items
    for (var a = 0; a < added.length; a++) {
      if (_checkedItems['added-' + a] !== false) {
        result.push({ type: 'add', item: added[a] });
      }
    }

    // Modified items — one entry per changed field
    for (var m = 0; m < modified.length; m++) {
      if (_checkedItems['modified-' + m] !== false) {
        var mod = modified[m];
        var key = _itemKey(mod.item);
        for (var c = 0; c < mod.changes.length; c++) {
          var ch = mod.changes[c];
          result.push({
            type: 'modify',
            itemKey: key,
            field: ch.field,
            value: ch.remoteVal
          });
        }
      }
    }

    // Deleted items
    for (var d = 0; d < deleted.length; d++) {
      if (_checkedItems['deleted-' + d] !== false) {
        result.push({ type: 'delete', itemKey: _itemKey(deleted[d]) });
      }
    }

    return result;
  }

  function _onApply() {
    var selected = _buildSelectedChanges();
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
    var listEl = safeGetElement('diffReviewList');
    var conflictsEl = safeGetElement('diffReviewConflicts');
    var selectAllBtn = safeGetElement('diffReviewSelectAll');
    var deselectAllBtn = safeGetElement('diffReviewDeselectAll');
    var selectAllToggleBtn = safeGetElement('diffReviewSelectAllToggle');
    var applyBtn = safeGetElement('diffReviewApplyBtn');
    var cancelBtn = safeGetElement('diffReviewCancelBtn');
    var dismissX = safeGetElement('diffReviewDismissX');

    // Determine whether we're in backup-count mode
    var hasBackupCount = _options && _options.backupCount != null;

    // Event delegation on list
    if (listEl) {
      listEl.removeEventListener('click', _onListClick);
      listEl.addEventListener('click', _onListClick);
    }

    // Conflict radio delegation
    if (conflictsEl) {
      conflictsEl.removeEventListener('change', _onConflictsChange);
      conflictsEl.addEventListener('change', _onConflictsChange);
    }

    // Pill buttons
    var btnStyle = 'display:inline-flex;align-items:center;gap:0.3rem;border-radius:999px;font-size:0.73rem;font-weight:500;cursor:pointer;transition:all 0.15s;';

    if (selectAllBtn) {
      selectAllBtn.onclick = _selectAll;
      selectAllBtn.setAttribute('style', btnStyle + 'padding:0.3rem 0.7rem;background:none;border:1.5px solid var(--border,#cbd5e1);color:var(--text-muted,#64748b)');
    }
    if (deselectAllBtn) {
      deselectAllBtn.onclick = _deselectAll;
      deselectAllBtn.setAttribute('style', btnStyle + 'padding:0.3rem 0.7rem;background:none;border:1.5px solid var(--border,#cbd5e1);color:var(--text-muted,#64748b)');
    }

    // Select All toggle button — only shown when backupCount is provided
    if (selectAllToggleBtn) {
      if (hasBackupCount) {
        selectAllToggleBtn.textContent = _selectAllToggle ? 'Deselect All' : 'Select All';
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
      _selectAllToggle = false;

      // Default all items to checked
      var diff = _options.diff || {};
      for (var a = 0; a < (diff.added || []).length; a++) _checkedItems['added-' + a] = true;
      for (var m = 0; m < (diff.modified || []).length; m++) _checkedItems['modified-' + m] = true;
      for (var d = 0; d < (diff.deleted || []).length; d++) _checkedItems['deleted-' + d] = true;

      // Default conflict resolutions to 'remote'
      if (_options.conflicts && _options.conflicts.conflicts) {
        for (var ci = 0; ci < _options.conflicts.conflicts.length; ci++) {
          _conflictResolutions['c' + ci] = 'remote';
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
