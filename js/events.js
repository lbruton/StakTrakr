/**
 * EVENTS MODULE - FIXED VERSION
 *
 * Handles all DOM event listeners with proper null checking and error handling.
 * Includes file protocol compatibility fixes and fallback event attachment methods.
 */

// EVENT UTILITIES
// =============================================================================

/**
 * Safely attaches event listener with fallback methods
 * @param {HTMLElement|Window|Document} element - Element to attach listener to
 * @param {string} event - Event type
 * @param {Function} handler - Event handler function
 * @param {string} [description=""] - Description for logging
 * @returns {boolean} Success status
 */
const safeAttachListener = (element, event, handler, description = "") => {
  if (!element) {
    console.warn(
      `Cannot attach ${event} listener: element not found (${description})`,
    );
    return false;
  }

  try {
    // Method 1: Standard addEventListener
    element.addEventListener(event, handler);
    return true;
  } catch (error) {
    console.warn(`Standard addEventListener failed for ${description}:`, error);

    try {
      // Method 2: Legacy event handler
      element["on" + event] = handler;
      debugLog(`✓ Fallback event handler attached: ${description}`);
      return true;
    } catch (fallbackError) {
      console.error(
        `All event attachment methods failed for ${description}:`,
        fallbackError,
      );
      return false;
    }
  }
};

/**
 * Attaches a listener only if the element exists; silent no-op otherwise.
 * Avoids console.warn spam for intentionally optional UI elements.
 * @param {HTMLElement|null} el - Element (may be null)
 * @param {string} event - Event type
 * @param {Function} handler - Event handler
 * @param {string} label - Description for logging
 */
const optionalListener = (el, event, handler, label) => {
  if (el) safeAttachListener(el, event, handler, label);
};

// =============================================================================
// IMAGE UPLOAD STATE (STACK-32) — Dual obverse/reverse support
// =============================================================================

/** @type {Blob|null} Pending obverse upload blob — saved on item commit */
let _pendingObverseBlob = null;
/** @type {Blob|null} Pending reverse upload blob — saved on item commit */
let _pendingReverseBlob = null;

/** @type {string|null} Preview object URL for obverse — revoked on modal close */
let _pendingObversePreviewUrl = null;
/** @type {string|null} Preview object URL for reverse — revoked on modal close */
let _pendingReversePreviewUrl = null;

/** @type {boolean} User clicked Remove on obverse — delete on save */
let _deleteObverseOnSave = false;
/** @type {boolean} User clicked Remove on reverse — delete on save */
let _deleteReverseOnSave = false;

/**
 * Process a user-selected image file and show preview for a specific side.
 * @param {File} file
 * @param {'obverse'|'reverse'} [side='obverse']
 */
const processUploadedImage = async (file, side = 'obverse') => {
  if (!file || typeof imageProcessor === 'undefined') return;

  const result = await imageProcessor.processFile(file, {
    maxDim: typeof IMAGE_MAX_DIM !== 'undefined' ? IMAGE_MAX_DIM : 600,
    maxBytes: typeof IMAGE_MAX_BYTES !== 'undefined' ? IMAGE_MAX_BYTES : 512000,
  });

  if (!result?.blob) {
    debugLog(`Image processing failed for ${side}`);
    return;
  }

  const suffix = side === 'reverse' ? 'Rev' : 'Obv';

  if (side === 'reverse') {
    _pendingReverseBlob = result.blob;
    if (_pendingReversePreviewUrl) URL.revokeObjectURL(_pendingReversePreviewUrl);
    _pendingReversePreviewUrl = imageProcessor.createPreview(result.blob);
  } else {
    _pendingObverseBlob = result.blob;
    if (_pendingObversePreviewUrl) URL.revokeObjectURL(_pendingObversePreviewUrl);
    _pendingObversePreviewUrl = imageProcessor.createPreview(result.blob);
  }

  const previewUrl = side === 'reverse' ? _pendingReversePreviewUrl : _pendingObversePreviewUrl;

  // Show preview in the appropriate side's elements
  const previewContainer = document.getElementById('itemImagePreview' + suffix);
  const previewImg = document.getElementById('itemImagePreviewImg' + suffix);
  const sizeInfo = document.getElementById('itemImageSizeInfo' + suffix);
  const removeBtn = document.getElementById('itemImageRemoveBtn' + suffix);

  if (previewImg && previewUrl) {
    previewImg.src = previewUrl;
    if (previewContainer) previewContainer.style.display = 'block';
  }
  if (sizeInfo) {
    const origKB = (result.originalSize / 1024).toFixed(0);
    const compKB = (result.compressedSize / 1024).toFixed(0);
    sizeInfo.textContent = `${origKB} KB → ${compKB} KB (${result.format.split('/')[1]})`;
  }
  if (removeBtn) removeBtn.style.display = '';
  updateSwapButtonVisibility();
};

/** Show/hide swap button based on whether both image sides have previews (STAK-341) */
const updateSwapButtonVisibility = () => {
  const wrapper = document.getElementById('swapImagesBtnWrapper');
  if (!wrapper) return;
  const obvPreview = document.getElementById('itemImagePreviewObv');
  const revPreview = document.getElementById('itemImagePreviewRev');
  const isVisible = (el) => el && !el.classList.contains('d-none') && el.style.display !== 'none';
  const bothVisible = isVisible(obvPreview) && isVisible(revPreview);
  wrapper.classList.toggle('d-none', !bothVisible);
};

/**
 * Track an externally-created preview object URL so it gets revoked
 * when clearUploadState() runs (prevents memory leaks in editItem preview).
 * @param {string} url - Object URL to track
 * @param {'obverse'|'reverse'} [side='obverse']
 */
const setEditPreviewUrl = (url, side = 'obverse') => {
  if (side === 'reverse') {
    if (_pendingReversePreviewUrl) URL.revokeObjectURL(_pendingReversePreviewUrl);
    _pendingReversePreviewUrl = url;
  } else {
    if (_pendingObversePreviewUrl) URL.revokeObjectURL(_pendingObversePreviewUrl);
    _pendingObversePreviewUrl = url;
  }
};

/**
 * Clear the pending upload state and previews for both sides.
 */
const clearUploadState = () => {
  _pendingObverseBlob = null;
  _pendingReverseBlob = null;
  _deleteObverseOnSave = false;
  _deleteReverseOnSave = false;

  if (_pendingObversePreviewUrl) {
    URL.revokeObjectURL(_pendingObversePreviewUrl);
    _pendingObversePreviewUrl = null;
  }
  if (_pendingReversePreviewUrl) {
    URL.revokeObjectURL(_pendingReversePreviewUrl);
    _pendingReversePreviewUrl = null;
  }

  // Clear obverse side UI
  const previewObv = document.getElementById('itemImagePreviewObv');
  const imgObv = document.getElementById('itemImagePreviewImgObv');
  const sizeObv = document.getElementById('itemImageSizeInfoObv');
  const removeObv = document.getElementById('itemImageRemoveBtnObv');
  const fileObv = document.getElementById('itemImageFileObv');

  if (previewObv) previewObv.style.display = 'none';
  if (imgObv) imgObv.src = '';
  if (sizeObv) sizeObv.textContent = '';
  if (removeObv) removeObv.style.display = 'none';
  if (fileObv) fileObv.value = '';

  // Clear reverse side UI
  const previewRev = document.getElementById('itemImagePreviewRev');
  const imgRev = document.getElementById('itemImagePreviewImgRev');
  const sizeRev = document.getElementById('itemImageSizeInfoRev');
  const removeRev = document.getElementById('itemImageRemoveBtnRev');
  const fileRev = document.getElementById('itemImageFileRev');

  if (previewRev) previewRev.style.display = 'none';
  if (imgRev) imgRev.src = '';
  if (sizeRev) sizeRev.textContent = '';
  if (removeRev) removeRev.style.display = 'none';
  if (fileRev) fileRev.value = '';

  // Hide swap button (STAK-341)
  const swapWrapper = document.getElementById('swapImagesBtnWrapper');
  if (swapWrapper) swapWrapper.classList.add('d-none');

  // Reset pattern toggle state
  const patternToggle = document.getElementById('imagePatternToggle');
  const patternKeywordsGroup = document.getElementById('imagePatternKeywordsGroup');
  const patternKeywords = document.getElementById('imagePatternKeywords');
  if (patternToggle) patternToggle.checked = false;
  if (patternKeywordsGroup) patternKeywordsGroup.style.display = 'none';
  if (patternKeywords) patternKeywords.value = '';
};

/**
 * Update Numista API status dot in item modal action bar (STAK-173).
 * Reads catalogConfig.isNumistaEnabled() to set connected/disconnected state.
 */
const updateNumistaModalDot = () => {
  const dot = document.getElementById('numistaModalStatusDot');
  if (!dot) return;
  const connected = typeof catalogConfig !== 'undefined'
    && catalogConfig.isNumistaEnabled && catalogConfig.isNumistaEnabled();
  dot.classList.toggle('connected', !!connected);
  dot.classList.toggle('disconnected', !connected);
  dot.title = connected ? 'Numista API: connected' : 'Numista API: disconnected';
};

/**
 * Request persistent storage the first time a user uploads an image.
 * Stores the browser's response under STORAGE_PERSIST_GRANTED_KEY so the
 * prompt fires at most once per device.
 */
const _requestStoragePersistOnce = async () => {
  if (localStorage.getItem(STORAGE_PERSIST_GRANTED_KEY) !== null) return; // already asked
  if (!navigator?.storage?.persist) {
    localStorage.setItem(STORAGE_PERSIST_GRANTED_KEY, 'false');
    return;
  }
  try {
    const granted = await navigator.storage.persist();
    localStorage.setItem(STORAGE_PERSIST_GRANTED_KEY, granted ? 'true' : 'false');
  } catch {
    localStorage.setItem(STORAGE_PERSIST_GRANTED_KEY, 'false');
  }
};

/**
 * Save the pending upload blob(s) to IndexedDB for the given item UUID.
 * @param {string} uuid
 * @returns {Promise<boolean>}
 */
const saveUserImageForItem = async (uuid) => {
  if (!uuid || !window.imageCache?.isAvailable()) {
    debugLog('saveUserImageForItem: invalid uuid or cache unavailable');
    return false;
  }

  // Priority 1: Handle deletions first
  const hasDeleteIntent = _deleteObverseOnSave || _deleteReverseOnSave;
  const hasNewImages = _pendingObverseBlob || _pendingReverseBlob;

  if (hasDeleteIntent && !hasNewImages) {
    // Pure deletion case: user removed images without uploading new ones
    await handleImageDeletion(uuid);
    clearUploadState();
    return true;
  }

  if (!hasNewImages) {
    // No changes at all
    debugLog('saveUserImageForItem: no changes to save');
    clearUploadState();
    return false;
  }

  _requestStoragePersistOnce(); // fire-and-forget — no await needed
  // Priority 2: New uploads - merge with existing or replace deleted sides
  debugLog(`saveUserImageForItem: saving images for ${uuid}`);

  let obvBlob = _pendingObverseBlob;
  let revBlob = _pendingReverseBlob;

  // Merge with existing images if only one side uploaded
  if (!obvBlob || !revBlob) {
    try {
      const existing = await window.imageCache.getUserImage(uuid);
      if (existing) {
        // Only merge if not marked for deletion
        if (!obvBlob && existing.obverse && !_deleteObverseOnSave) {
          obvBlob = existing.obverse;
        }
        if (!revBlob && existing.reverse && !_deleteReverseOnSave) {
          revBlob = existing.reverse;
        }
      }
    } catch { /* ignore */ }
  }

  const saved = await window.imageCache.cacheUserImage(uuid, obvBlob, revBlob);
  debugLog(`saveUserImageForItem: saved=${saved}`);
  clearUploadState();
  return saved;
};

/**
 * Handle image deletion based on deletion flags.
 * Supports partial deletion (one side only) or full deletion (both sides).
 * @param {string} uuid - Item UUID
 * @returns {Promise<void>}
 */
const handleImageDeletion = async (uuid) => {
  if (!uuid || !window.imageCache?.isAvailable()) return;

  const deleteBoth = _deleteObverseOnSave && _deleteReverseOnSave;
  const deleteNeither = !_deleteObverseOnSave && !_deleteReverseOnSave;

  if (deleteNeither) return;

  if (deleteBoth) {
    // Delete entire record
    debugLog(`handleImageDeletion: deleting both sides for ${uuid}`);
    await window.imageCache.deleteUserImage(uuid);
  } else {
    // Partial deletion: keep one side, delete the other
    debugLog(`handleImageDeletion: partial deletion for ${uuid}`);

    try {
      const existing = await window.imageCache.getUserImage(uuid);
      if (!existing) return; // Nothing to delete

      // Nullify the deleted side, keep the other
      const newObverse = _deleteObverseOnSave ? null : existing.obverse;
      const newReverse = _deleteReverseOnSave ? null : existing.reverse;

      // If both would be null, delete entire record
      if (!newObverse && !newReverse) {
        await window.imageCache.deleteUserImage(uuid);
      } else {
        // Save updated record with one side nullified
        await window.imageCache.cacheUserImage(uuid, newObverse, newReverse);
      }
    } catch (err) {
      debugLog(`Failed to handle partial deletion: ${err}`, 'warn');
    }
  }
};

/**
 * Sets up the override/merge/file-input triad for a single import format.
 * @param {HTMLElement|null} overrideBtn - "Override" button element
 * @param {HTMLElement|null} mergeBtn - "Merge" button element
 * @param {HTMLElement|null} fileInput - Hidden file input element
 * @param {Function} importFn - Import function (file, isOverride) => void
 * @param {string} formatName - Human label (e.g. "CSV", "JSON", "Numista CSV")
 */
const setupFormatImport = (overrideBtn, mergeBtn, fileInput, importFn, formatName) => {
  let isOverride = false;

  if (overrideBtn && fileInput) {
    safeAttachListener(overrideBtn, "click", async () => {
      const confirmed = await appConfirm(
        `Importing ${formatName} will overwrite all existing data. To combine data, choose Merge instead. Press OK to continue.`,
        `${formatName} Import`,
      );
      if (confirmed) {
        isOverride = true;
        fileInput.click();
      }
    }, `${formatName} override button`);
  }

  if (mergeBtn && fileInput) {
    safeAttachListener(mergeBtn, "click", () => {
      isOverride = false;
      fileInput.click();
    }, `${formatName} merge button`);
  }

  optionalListener(fileInput, "change", function (e) {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!checkFileSize(file)) {
        appAlert("File exceeds 2MB limit. Enable cloud backup for larger uploads.");
      } else {
        importFn(file, isOverride);
      }
    }
    this.value = "";
  }, `${formatName} import`);
};

/**
 * Implements dynamic column resizing for the inventory table
 */
const setupColumnResizing = () => {
  const table = document.getElementById("inventoryTable");
  if (!table) {
    console.warn("Inventory table not found for column resizing");
    return;
  }

  // Clear any existing resize handles
  const existingHandles = table.querySelectorAll(".resize-handle");
  existingHandles.forEach((handle) => handle.remove());

  let isResizing = false;
  let currentColumn = null;
  let startX = 0;
  let startWidth = 0;

  // Add resize handles to table headers
  const headers = table.querySelectorAll("th");
  headers.forEach((header, index) => {
    // Ensure header text is wrapped in .header-text span
    let headerTextSpan = header.querySelector('.header-text');
    if (!headerTextSpan) {
      // Create new header-text span
      headerTextSpan = document.createElement('span');
      headerTextSpan.className = 'header-text';
    }

    // Check if the span is empty or needs text
    if (!headerTextSpan.textContent.trim()) {
      // Find the text content (excluding SVG and existing elements)
      const textNodes = Array.from(header.childNodes).filter(node =>
        node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      );

      if (textNodes.length > 0) {
        // Move text content into the span
        headerTextSpan.textContent = textNodes.map(node => node.textContent.trim()).join(' ');

        // Remove original text nodes
        textNodes.forEach(node => node.remove());

        // Insert the span after the SVG icon (if present) if it's not already in the DOM
        if (!header.contains(headerTextSpan)) {
          const svg = header.querySelector('svg');
          if (svg) {
            svg.insertAdjacentElement('afterend', headerTextSpan);
          } else {
            header.insertBefore(headerTextSpan, header.firstChild);
          }
        }
      }
    }

    // Skip adding resize handle to the Actions column (last column)
    if (index >= headers.length - 1) return;

    const resizeHandle = document.createElement("div");
    resizeHandle.className = "resize-handle";

    /* position:sticky (set via CSS on #inventoryTable thead th) already
       provides a containing block for the absolutely-positioned resize
       handle — no inline position:relative needed. */
    header.appendChild(resizeHandle);

    safeAttachListener(
      resizeHandle,
      "mousedown",
      (e) => {
        isResizing = true;
        currentColumn = header;
        startX = e.clientX;
        startWidth = parseInt(
          document.defaultView.getComputedStyle(header).width,
          10,
        );

        e.preventDefault();
        e.stopPropagation();

        // Prevent header click event from firing
        header.style.pointerEvents = "none";
        setTimeout(() => {
          header.style.pointerEvents = "auto";
        }, 100);
      },
      "Column resize handle",
    );
  });

  // Handle mouse move for resizing
  safeAttachListener(
    document,
    "mousemove",
    (e) => {
      if (!isResizing || !currentColumn) return;

      const width = startWidth + e.clientX - startX;
      const minWidth = 40;
      const maxWidth = 300;

      if (width >= minWidth && width <= maxWidth) {
        currentColumn.style.width = width + "px";
      }
    },
    "Document mousemove for resizing",
  );

  // Handle mouse up to stop resizing
  safeAttachListener(
    document,
    "mouseup",
    () => {
      if (isResizing) {
        isResizing = false;
        currentColumn = null;
      }
    },
    "Document mouseup for resizing",
  );

  // Prevent text selection during resize
  safeAttachListener(
    document,
    "selectstart",
    (e) => {
      if (isResizing) {
        e.preventDefault();
      }
    },
    "Document selectstart for resizing",
  );
};

// RESPONSIVE TABLE HANDLING
// =============================================================================

/**
 * Updates column visibility based on current viewport width
 */
const updateColumnVisibility = () => {
  const width = window.innerWidth;
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  const desktopCardView = localStorage.getItem(DESKTOP_CARD_VIEW_KEY) === 'true';
  const forceCards = desktopCardView || (isTouch && width > 1350 && width <= 1600);

  document.body.classList.toggle('force-card-view', forceCards);

  // Card view handles all column visibility via CSS at ≤1350px (STACK-70)
  // or via .force-card-view for large touch tablets (STACK-70)
  if (width <= 1350 || forceCards) return;
  const hidden = new Set();

  const breakpoints = [
    { width: 1400, hide: ["notes"] },
    { width: 1200, hide: ["notes"] },
    { width: 992, hide: ["notes", "premium"] },
    { width: 768, hide: ["notes", "premium", "spot"] },
    {
      width: 640,
      hide: ["notes", "premium", "spot", "weight"],
    },
    {
      width: 576,
      hide: [
        "notes",
        "premium",
        "spot",
        "weight",
        "purchaseLocation",
        "storageLocation",
        "numista",
        "type",
        "metal",
        "actions",
      ],
    },
  ];

  breakpoints.forEach((bp) => {
    if (width < bp.width) bp.hide.forEach((c) => hidden.add(c));
  });

  // Hide image column when table thumbnails are off or COIN_IMAGES disabled
  const _imgOn = localStorage.getItem('tableImagesEnabled') !== 'false'
    && typeof featureFlags !== 'undefined' && featureFlags.isEnabled('COIN_IMAGES');
  if (!_imgOn) hidden.add('image');

  const allColumns = [
    "date",
    "type",
    "metal",
    "image",
    "qty",
    "name",
    "weight",
    "purchasePrice",
    "spot",
    "premium",
    "purchaseLocation",
    "storageLocation",
    "numista",
    "notes",
    "actions",
  ];

  allColumns.forEach((col) => {
    document.querySelectorAll(`[data-column="${col}"]`).forEach((el) => {
      el.classList.toggle("hidden", hidden.has(col));
    });
  });
};

/**
 * Sets up responsive column visibility handling
 */
const setupResponsiveColumns = () => {
  updateColumnVisibility();
  safeAttachListener(
    window,
    "resize",
    updateColumnVisibility,
    "Window resize for column visibility",
  );
};

// SUB-FUNCTIONS FOR EVENT LISTENER SETUP
// =============================================================================

/**
 * Sets up search input and chip-related listeners
 */
const setupSearchAndChipListeners = () => {
  // Search Input
  if (elements.searchInput) {
    const debouncedSearch = debounce(() => {
      searchQuery = elements.searchInput.value.replace(/[<>]/g, "").trim();
      renderTable();
      if (typeof renderActiveFilters === "function") {
        renderActiveFilters();
      }
    }, 300);
    safeAttachListener(elements.searchInput, "input", debouncedSearch, "Search Input");
  }

  // Chip minimum count dropdown (inline)
  const chipMinCountEl = document.getElementById('chipMinCount');
  if (chipMinCountEl) {
    safeAttachListener(
      chipMinCountEl,
      'change',
      (e) => {
        const minCount = parseInt(e.target.value, 10);
        localStorage.setItem('chipMinCount', minCount.toString());
        // Sync settings modal control
        const settingsChipMin = document.getElementById('settingsChipMinCount');
        if (settingsChipMin) settingsChipMin.value = minCount.toString();
        if (typeof renderActiveFilters === 'function') {
          renderActiveFilters();
        }
        if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
      },
      'Chip minimum count dropdown'
    );
  }

  // Grouped name chips toggle (inline) — uses global helper from settings.js
  const groupNameChipsEl = document.getElementById('groupNameChips');
  if (groupNameChipsEl && window.featureFlags) {
    // Set initial state from feature flag
    const initVal = window.featureFlags.isEnabled('GROUPED_NAME_CHIPS') ? 'yes' : 'no';
    groupNameChipsEl.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === initVal);
    });
  }
  if (typeof wireFeatureFlagToggle === 'function') {
    wireFeatureFlagToggle('groupNameChips', 'GROUPED_NAME_CHIPS', {
      syncId: 'settingsGroupNameChips',
      onApply: () => { if (typeof renderActiveFilters === 'function') renderActiveFilters(); },
    });
  }

  // Chip sort order inline toggle — uses global helper from settings.js
  const chipSortEl = document.getElementById('chipSortOrder');
  if (chipSortEl) {
    // Restore saved value on setup (migrate 'default' → 'alpha')
    const savedSort = localStorage.getItem('chipSortOrder');
    const activeSort = (savedSort === 'count') ? 'count' : 'alpha';
    chipSortEl.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.sort === activeSort);
    });
  }
  if (typeof wireChipSortToggle === 'function') {
    wireChipSortToggle('chipSortOrder', 'settingsChipSortOrder');
  }

  // Disposed filter three-state toggle (STAK-388)
  var savedDisposedMode = loadData('disposedFilterMode') || 'hide';
  document.querySelectorAll('#disposedFilterGroup .chip-sort-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.disposedMode === savedDisposedMode);
  });
  document.getElementById('disposedFilterGroup') && document.getElementById('disposedFilterGroup').addEventListener('click', function(e) {
    var btn = e.target.closest('.chip-sort-btn');
    if (!btn) return;
    document.querySelectorAll('#disposedFilterGroup .chip-sort-btn').forEach(function(b) {
      b.classList.remove('active');
    });
    btn.classList.add('active');
    saveData('disposedFilterMode', btn.dataset.disposedMode);
    if (typeof filterInventory === 'function') filterInventory();
    if (typeof renderActiveFilters === 'function') renderActiveFilters();
  });
};

/**
 * Sets up header button listeners (logo, settings, about, details)
 */
const setupHeaderButtonListeners = () => {
  // CRITICAL HEADER BUTTONS
  debugLog("Setting up header buttons...");

  // App Logo
  if (elements.appLogo) {
    safeAttachListener(
      elements.appLogo,
      "click",
      () => window.location.reload(),
      "App Logo",
    );
  }

  // Settings Button
  if (elements.settingsBtn) {
    safeAttachListener(
      elements.settingsBtn,
      "click",
      (e) => {
        e.preventDefault();
        debugLog("Settings button clicked");
        if (typeof showSettingsModal === "function") {
          showSettingsModal();
        }
      },
      "Settings Button",
    );
  }

  // Cloud sync header icon button (STAK-264)
  var headerCloudSyncBtn = safeGetElement('headerCloudSyncBtn');
  if (headerCloudSyncBtn) {
    safeAttachListener(headerCloudSyncBtn, 'click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var state = headerCloudSyncBtn.dataset.syncState;
      if (state === 'orange') {
        // Needs password setup — open inline popover
        if (typeof _openCloudSyncPopover === 'function') _openCloudSyncPopover();
      } else if (state === 'green') {
        var lp = typeof syncGetLastPush === 'function' ? syncGetLastPush() : null;
        var msg = lp && lp.timestamp
          ? 'Cloud sync active \u2014 last synced ' + (typeof _syncRelativeTime === 'function' ? _syncRelativeTime(lp.timestamp) : '')
          : 'Cloud sync active';
        if (typeof showCloudToast === 'function') showCloudToast(msg, 2500);
      } else {
        if (typeof showSettingsModal === 'function') showSettingsModal('system');
      }
    }, 'Cloud Sync Header Button');
  }

  // Close popover on outside click
  document.addEventListener('mousedown', function (e) {
    var wrapper = safeGetElement('headerCloudSyncWrapper');
    var popover = safeGetElement('cloudSyncHeaderPopover');
    if (popover && popover.style.display !== 'none') {
      if (wrapper && !wrapper.contains(e.target)) {
        popover.style.display = 'none';
        // Clear handlers so stale state doesn't persist on next open
        var inputEl = safeGetElement('cloudSyncPopoverInput');
        var unlockEl = safeGetElement('cloudSyncPopoverUnlockBtn');
        var cancelEl = safeGetElement('cloudSyncPopoverCancelBtn');
        if (inputEl) inputEl.onkeydown = null;
        if (unlockEl) unlockEl.onclick = null;
        if (cancelEl) cancelEl.onclick = null;
      }
    }
  });

  // About Button
  if (elements.aboutBtn) {
    safeAttachListener(
      elements.aboutBtn,
      "click",
      (e) => {
        e.preventDefault();
        if (typeof showAboutModal === "function") {
          showAboutModal();
        }
      },
      "About Button",
    );
  }


  // Details modal triggers
  if (elements.totalTitles && elements.totalTitles.length) {
    elements.totalTitles.forEach((title) => {
      safeAttachListener(
        title,
        "click",
        () => {
          const metal = title.dataset.metal;
          if (typeof showDetailsModal === "function") {
            showDetailsModal(metal);
          }
        },
        `Totals title (${title.dataset.metal})`,
      );
    });
  }

  if (elements.detailsCloseBtn) {
    safeAttachListener(
      elements.detailsCloseBtn,
      "click",
      () => {
        if (typeof closeDetailsModal === "function") {
          closeDetailsModal();
        }
      },
      "Close details modal",
    );
  }
};

/**
 * Sets up table header sorting and Goldback denomination picker
 */
const setupTableSortListeners = () => {
  // TABLE HEADER SORTING
  debugLog("Setting up table sorting...");
  const inventoryTable = document.getElementById("inventoryTable");
  if (inventoryTable) {
    const headers = inventoryTable.querySelectorAll("th");
    headers.forEach((header, index) => {
      // Skip the Actions column (last column)
      if (index >= headers.length - 1) {
        return;
      }

      header.style.cursor = "pointer";

      safeAttachListener(
        header,
        "click",
        (e) => {
          if (e.shiftKey) return;
          // Toggle sort direction if same column, otherwise set to new column with asc
          if (sortColumn === index) {
            sortDirection = sortDirection === "asc" ? "desc" : "asc";
          } else {
            sortColumn = index;
            sortDirection = "asc";
          }

          renderTable();
        },
        `Table header ${index}`,
      );
    });
  } else {
    console.error("Inventory table not found for sorting setup!");
  }

  // GOLDBACK DENOMINATION PICKER TOGGLE (STACK-45)
  // Swaps weight text input ↔ denomination select when unit changes to/from 'gb'.
  // Auto-fills hidden weight value from the selected denomination.
  const showEl = (el, visible) => { if (el) el.style.display = visible ? '' : 'none'; };
  /**
   * Toggles the visible input between weight and goldback denomination.
   * Auto-fills hidden weight value from the selected denomination when in 'gb' mode.
   */
  window.toggleGbDenomPicker = () => {
    const isGb = elements.itemWeightUnit?.value === 'gb';
    const denomSelect = elements.itemGbDenom;
    const weightInput = elements.itemWeight;
    const weightLabel = document.getElementById('itemWeightLabel');

    showEl(denomSelect, isGb);
    showEl(weightInput, !isGb);
    if (isGb && weightInput && denomSelect) weightInput.value = denomSelect.value;
    if (weightLabel) weightLabel.textContent = isGb ? 'Denomination' : 'Weight';
  };
};

// FORM SUBMIT HELPERS (STACK-61)
// =============================================================================

/**
 * Parses weight from form input, handling Goldback denominations,
 * fractions, and gram-to-troy-oz conversion.
 * @param {string} weightRaw - Raw weight input value
 * @param {string} weightUnit - Unit: 'oz', 'g', 'kg', 'lb', or 'gb'
 * @param {boolean} isEditing - Whether in edit mode
 * @param {Object} existingItem - Existing item (edit mode)
 * @returns {number} Weight in troy ounces (or denomination value for gb)
 */
const parseWeight = (weightRaw, weightUnit, isEditing, existingItem) => {
  if (isEditing && weightRaw === '') {
    return typeof existingItem.weight !== 'undefined' ? existingItem.weight : 0;
  }
  let weight = parseFraction(weightRaw);
  if (weightUnit === 'g') {
    weight = gramsToOzt(weight);
  } else if (weightUnit === 'kg') {
    weight = kgToOzt(weight);
  } else if (weightUnit === 'lb') {
    weight = lbToOzt(weight);
  }
  // gb: weight stays as raw denomination value (conversion happens in computeMeltValue)
  return isNaN(weight) ? 0 : parseFloat(weight.toFixed(6));
};

/**
 * Converts a user-entered price from display currency to USD.
 * @param {string} rawValue - Raw price input value
 * @param {number} fxRate - Exchange rate (display currency per 1 USD)
 * @param {boolean} isEditing - Whether in edit mode
 * @param {number} existingValue - Existing price (edit mode)
 * @returns {number} Price in USD
 */
const parsePriceToUSD = (rawValue, fxRate, isEditing, existingValue) => {
  if (isEditing && rawValue === '') {
    return typeof existingValue !== 'undefined' ? existingValue : 0;
  }
  let entered = rawValue === '' ? 0 : parseFloat(rawValue);
  entered = isNaN(entered) || entered < 0 ? 0 : entered;
  return fxRate !== 1 ? entered / fxRate : entered;
};

/**
 * Reads purity from the select/custom input pair.
 * @param {boolean} isEditing - Whether in edit mode
 * @param {Object} existingItem - Existing item (edit mode)
 * @returns {number} Purity value (0–1)
 */
const parsePurity = (isEditing, existingItem) => {
  const puritySelect = elements.itemPuritySelect;
  if (puritySelect && puritySelect.value === 'custom') {
    return elements.itemPurity ? (parseFloat(elements.itemPurity.value) || 1.0) : 1.0;
  }
  if (puritySelect) {
    return parseFloat(puritySelect.value) || 1.0;
  }
  return isEditing ? (existingItem.purity || 1.0) : 1.0;
};

/**
 * Reads all form fields and returns a parsed fields object.
 * @param {boolean} isEditing - Whether in edit mode
 * @param {Object} existingItem - Existing item (edit mode)
 * @returns {Object} Parsed field values
 */
const parseItemFormFields = (isEditing, existingItem) => {
  const composition = getCompositionFirstWords(elements.itemMetal.value);
  const metal = parseNumistaMetal(composition);
  const fxRate = (typeof getExchangeRate === 'function') ? getExchangeRate() : 1;

  const nameInput = elements.itemName.value.trim();
  const qtyInput = elements.itemQty.value.trim();

  const weightUnit = elements.itemWeightUnit.value;
  const weightRaw = (weightUnit === 'gb' && elements.itemGbDenom)
    ? elements.itemGbDenom.value
    : elements.itemWeight.value;

  const marketValueInput = elements.itemMarketValue ? elements.itemMarketValue.value.trim() : '';
  let marketValue;
  if (marketValueInput && !isNaN(parseFloat(marketValueInput))) {
    const enteredMv = parseFloat(marketValueInput);
    marketValue = fxRate !== 1 ? enteredMv / fxRate : enteredMv;
  } else {
    marketValue = 0;
  }

  return {
    metal,
    composition,
    name: isEditing ? (nameInput || existingItem.name || '') : nameInput,
    qty: qtyInput === '' ? (isEditing ? (existingItem.qty || 1) : 1) : parseInt(qtyInput, 10),
    type: elements.itemType.value || (isEditing ? existingItem.type : ''),
    weight: parseWeight(weightRaw, weightUnit, isEditing, existingItem),
    weightUnit,
    price: parsePriceToUSD(elements.itemPrice.value.trim(), fxRate, isEditing, existingItem.price),
    purchaseLocation: elements.purchaseLocation.value.trim(),
    storageLocation: elements.storageLocation.value.trim(),
    serialNumber: elements.itemSerialNumber?.value?.trim() ?? '',
    notes: elements.itemNotes.value.trim(),
    date: elements.itemDateNABtn?.classList.contains('active') ? '' : (elements.itemDate.value || (isEditing ? (existingItem.date || '') : todayStr())),
    catalog: elements.itemCatalog ? elements.itemCatalog.value.trim() : '',
    year: elements.itemYear?.value?.trim() ?? '',
    grade: elements.itemGrade?.value?.trim() ?? '',
    gradingAuthority: elements.itemGradingAuthority?.value?.trim() ?? '',
    certNumber: elements.itemCertNumber?.value?.trim() ?? '',
    pcgsNumber: elements.itemPcgsNumber?.value?.trim() ?? '',
    marketValue,
    purity: parsePurity(isEditing, existingItem),
    currency: displayCurrency,
    obverseImageUrl: elements.itemObverseImageUrl?.value?.trim() ?? '',
    reverseImageUrl: elements.itemReverseImageUrl?.value?.trim() ?? '',
    ignorePatternImages: document.getElementById('itemIgnorePatternImages')?.checked || false,
    // Numista metadata — stored per-item, seeded by API, user edits override
    // Pass catalog so parseNumistaDataFields can wipe metadata when N# is cleared (STAK-309)
    numistaData: parseNumistaDataFields(isEditing, existingItem, elements.itemCatalog ? elements.itemCatalog.value.trim() : ''),
  };
};

/**
 * Read Numista Data form fields into a flat object.
 * Only stores non-empty values to keep items lean.
 * @param {boolean} isEditing
 * @param {Object} existingItem
 * @returns {Object} Numista data fields with source tracking
 */
const parseNumistaDataFields = (isEditing, existingItem, catalog = '') => {
  // When N# is being cleared while editing, wipe all Numista metadata (STAK-309)
  if (isEditing && !catalog) return {};

  const get = (id) => (document.getElementById(id)?.value?.trim() ?? '');
  const prev = (isEditing && existingItem?.numistaData) ? existingItem.numistaData : {};

  const fields = {
    country: get('numistaCountry') || prev.country || '',
    denomination: get('numistaDenomination') || prev.denomination || '',
    composition: get('numistaComposition') || prev.composition || '',
    shape: get('numistaShape') || prev.shape || '',
    diameter: get('numistaDiameter') || prev.diameter || '',
    thickness: get('numistaThickness') || prev.thickness || '',
    orientation: get('numistaOrientation') || prev.orientation || '',
    technique: get('numistaTechnique') || prev.technique || '',
    mintage: get('numistaMintage') || prev.mintage || '',
    rarityIndex: get('numistaRarity') || prev.rarityIndex || '',
    kmRef: get('numistaKmRef') || prev.kmRef || '',
    commemorative: document.getElementById('numistaCommemorative')?.checked || false,
    commemorativeDesc: get('numistaCommemorativeDesc') || prev.commemorativeDesc || '',
    obverseDesc: get('numistaObverseDesc') || prev.obverseDesc || '',
    reverseDesc: get('numistaReverseDesc') || prev.reverseDesc || '',
    edgeDesc: get('numistaEdgeDesc') || prev.edgeDesc || '',
  };

  // Track data source: 'user' if any field was manually changed from the API value,
  // 'api' if purely from cache, or preserve existing source
  fields.source = prev.source || 'api';
  fields.updatedAt = Date.now();

  // Strip empty fields to keep storage lean
  const result = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== '' && v !== false && v !== 0) result[k] = v;
  }
  return result;
};

/**
 * Validates mandatory item fields.
 * @param {Object} f - Parsed fields from parseItemFormFields()
 * @returns {string|null} Error message or null if valid
 */
const validateItemFields = (f) => {
  if (
    !f.name || !f.type || !f.metal ||
    isNaN(f.weight) || f.weight <= 0 ||
    isNaN(f.qty) || f.qty < 1 || !Number.isInteger(f.qty)
  ) {
    return "Please enter valid values for Name, Type, Metal, Weight, and Quantity.";
  }
  return null;
};

/**
 * Builds the common field object shared by both add and edit paths.
 * @param {Object} f - Parsed fields from parseItemFormFields()
 * @returns {Object} Common item fields
 */
const buildItemFields = (f) => ({
  metal: f.metal, composition: f.composition, name: f.name, qty: f.qty,
  type: f.type, weight: f.weight, weightUnit: f.weightUnit, price: f.price,
  marketValue: f.marketValue, date: f.date, purchaseLocation: f.purchaseLocation,
  storageLocation: f.storageLocation, serialNumber: f.serialNumber, notes: f.notes,
  year: f.year, grade: f.grade, gradingAuthority: f.gradingAuthority,
  certNumber: f.certNumber, pcgsNumber: f.pcgsNumber, purity: f.purity,
});

/**
 * Commits a parsed item to inventory (add or edit mode).
 * @param {Object} f - Parsed fields from parseItemFormFields()
 * @param {boolean} isEditing - Whether in edit mode
 * @param {number|null} editIdx - Index being edited (null for add)
 */
const commitItemToInventory = (f, isEditing, editIdx) => {
  if (isEditing) {
    const oldItem = { ...inventory[editIdx] };
    const serial = oldItem.serial;

    // STAK-244: Clear stale Numista image cache when N# changes
    const numistaIdChanged = oldItem.numistaId && oldItem.numistaId !== f.catalog;
    if (numistaIdChanged && window.imageCache?.isAvailable()) {
      debugLog(`commitItemToInventory: N# changed from ${oldItem.numistaId} to ${f.catalog}, clearing old cache`);
      imageCache.deleteImages(oldItem.numistaId).catch(err => debugLog(`commitItemToInventory: Failed to clear old Numista images: ${err.message}`, 'warn'));
      imageCache.deleteMetadata(oldItem.numistaId).catch(err => debugLog(`commitItemToInventory: Failed to clear old Numista metadata: ${err.message}`, 'warn'));
    }

    inventory[editIdx] = {
      ...oldItem,
      ...buildItemFields(f),
      numistaId: f.catalog,
      numistaData: f.numistaData,
      fieldMeta: oldItem.fieldMeta || f.numistaData?.fieldMeta || undefined,
      currency: f.currency,
      // STAK-308: Use nullish coalescing — empty string is intentional (user cleared URL)
      obverseImageUrl: f.obverseImageUrl !== '' ? (f.obverseImageUrl || window.selectedNumistaResult?.imageUrl || '') : '',
      reverseImageUrl: f.reverseImageUrl !== '' ? (f.reverseImageUrl || window.selectedNumistaResult?.reverseImageUrl || '') : '',
      obverseSharedImageId: oldItem.obverseSharedImageId || null,
      reverseSharedImageId: oldItem.reverseSharedImageId || null,
      ignorePatternImages: f.ignorePatternImages || false,
    };

    // Track user-modified fields by comparing old vs new values
    if (typeof window.markUserModified === 'function') {
      const cur = inventory[editIdx];
      const trackedFields = ['metal', 'composition', 'name', 'qty', 'type', 'weight',
        'weightUnit', 'price', 'marketValue', 'date', 'purchaseLocation',
        'storageLocation', 'serialNumber', 'notes', 'year', 'grade',
        'gradingAuthority', 'certNumber', 'pcgsNumber', 'purity',
        'country', 'denomination', 'shape', 'diameter', 'thickness',
        'orientation', 'description', 'technique'];
      for (const field of trackedFields) {
        if (oldItem[field] !== cur[field]) {
          window.markUserModified(cur, field);
        }
      }
    }

    addCompositionOption(f.composition);

    try {
      // STAK-302: always sync the mapping — pass '' when N# is cleared so
      // setCatalogId deletes the stale serial entry and prevents repopulation on reload
      if (window.catalogManager) {
        catalogManager.setCatalogId(serial, inventory[editIdx].numistaId || '');
      }
    } catch (catErr) {
      console.warn('Failed to update catalog mapping:', catErr);
    }

    // Apply spot lookup override if user selected a historical spot (STACK-49)
    const lookupSpotEdit = elements.itemSpotPrice ? parseFloat(elements.itemSpotPrice.value) : NaN;
    if (!isNaN(lookupSpotEdit) && lookupSpotEdit > 0) {
      inventory[editIdx].spotPriceAtPurchase = lookupSpotEdit;
    }

    saveInventory();

    // Record price data point if price-related fields changed (STACK-43)
    if (typeof recordSingleItemPrice === 'function') {
      const cur = inventory[editIdx];
      const priceChanged = oldItem.marketValue !== cur.marketValue
        || oldItem.price !== cur.price || oldItem.weight !== cur.weight
        || oldItem.qty !== cur.qty || oldItem.metal !== cur.metal
        || oldItem.purity !== cur.purity;
      if (priceChanged) recordSingleItemPrice(cur, 'edit');
    }

    renderTable();
    renderActiveFilters();
    logItemChanges(oldItem, inventory[editIdx]);

    editingIndex = null;
    editingChangeLogIndex = null;
  } else {
    const metalKey = f.metal.toLowerCase();
    // Prefer spot price from lookup modal, fall back to current spot (STACK-49)
    const lookupSpot = elements.itemSpotPrice ? parseFloat(elements.itemSpotPrice.value) : NaN;
    const spotPriceAtPurchase = !isNaN(lookupSpot) && lookupSpot > 0
      ? lookupSpot
      : (spotPrices[metalKey] ?? 0);
    const serial = getNextSerial();

    inventory.push({
      ...buildItemFields(f),
      pcgsVerified: false,
      spotPriceAtPurchase,
      premiumPerOz: 0,
      totalPremium: 0,
      serial,
      uuid: generateUUID(),
      numistaId: f.catalog,
      numistaData: f.numistaData,
      fieldMeta: window.selectedNumistaResult?.fieldMeta || f.numistaData?.fieldMeta || undefined,
      currency: f.currency,
      obverseImageUrl: f.obverseImageUrl !== '' ? (f.obverseImageUrl || window.selectedNumistaResult?.imageUrl || '') : '',
      reverseImageUrl: f.reverseImageUrl !== '' ? (f.reverseImageUrl || window.selectedNumistaResult?.reverseImageUrl || '') : '',
      obverseSharedImageId: null,
      reverseSharedImageId: null,
      ignorePatternImages: f.ignorePatternImages || false,
    });

    typeof registerName === "function" && registerName(f.name);
    addCompositionOption(f.composition);

    if (window.catalogManager && f.catalog) {
      catalogManager.setCatalogId(serial, f.catalog);
    }

    saveInventory();

    // Log the add action to the changelog (BUG-004)
    const addedItem = inventory[inventory.length - 1];
    const addSummary = [addedItem.metal, addedItem.type, addedItem.name,
      typeof formatWeight === 'function' ? formatWeight(addedItem.weight, addedItem.weightUnit) : addedItem.weight + ' oz',
      typeof formatCurrency === 'function' ? formatCurrency(addedItem.price) : '$' + Number(addedItem.price).toFixed(2)
    ].filter(Boolean).join(' · ');
    logChange(addedItem.name, 'Added', '', addSummary, inventory.length - 1);

    // STAK-126: Auto-apply Numista tags from the lookup result
    if (window.selectedNumistaResult?.tags && typeof applyNumistaTags === 'function') {
      const newUuid = addedItem.uuid;
      applyNumistaTags(newUuid, window.selectedNumistaResult.tags);
    }

    // Record initial price data point (STACK-43)
    if (typeof recordSingleItemPrice === 'function') {
      recordSingleItemPrice(addedItem, 'add');
    }

    renderTable();

    // Success toast (UX-002)
    if (typeof showToast === 'function') {
      showToast('\u2713 ' + addedItem.name + ' added to inventory');
    }
  }
};

/**
 * Builds a Numista search query, optionally rewriting via NumistaLookup patterns.
 * @param {string} nameVal - Item name input value
 * @param {string} metalVal - Metal composition value
 * @returns {{ query: string, numistaId: string|null, matched: boolean }}
 */
const buildNumistaSearchQuery = (nameVal, metalVal) => {
  const combined = (metalVal && !nameVal.toLowerCase().includes(metalVal.toLowerCase()))
    ? `${metalVal} ${nameVal}` : nameVal;

  // Try pattern-based lookup if feature is enabled
  if (window.NumistaLookup && window.featureFlags && featureFlags.isEnabled('NUMISTA_SEARCH_LOOKUP')) {
    const match = NumistaLookup.matchQuery(combined);
    if (match) {
      return { query: match.replacement, numistaId: match.numistaId, matched: true };
    }
  }

  // Fallback: original behavior (raw query)
  return { query: combined, numistaId: null, matched: false };
};

/**
 * Sets up item form submission and related button listeners
 */
const setupItemFormListeners = () => {
  // UNIFIED FORM SUBMISSION (Add + Edit via single #itemModal)
  debugLog("Setting up unified item form...");
  if (elements.inventoryForm) {
    safeAttachListener(
      elements.inventoryForm,
      "submit",
      async function (e) {
        e.preventDefault();

        const isEditing = editingIndex !== null;
        const existingItem = isEditing ? { ...inventory[editingIndex] } : {};

        // Clone mode: clear unchecked fields BEFORE parsing so they aren't saved
        if (window._cloneMode && typeof clearUncheckedCloneFields === 'function') {
          clearUncheckedCloneFields();
        }

        const fields = parseItemFormFields(isEditing, existingItem);
        const error = validateItemFields(fields);
        if (error) { appAlert(error); return; }

        // Capture index before commit — commitItemToInventory nulls editingIndex
        const savedEditIdx = editingIndex;
        commitItemToInventory(fields, isEditing, editingIndex);

        // Clone mode handling — intercept post-commit flow (STAK-375)
        if (window._cloneMode) {
          const newItem = inventory[inventory.length - 1];
          // Copy tags from source to new clone (if tags checkbox is checked)
          if (typeof getItemTags === 'function' && typeof addItemTag === 'function' && typeof saveItemTags === 'function' && window._cloneSourceItem?.uuid) {
            const sourceTags = getItemTags(window._cloneSourceItem.uuid) || [];
            if (Array.isArray(sourceTags) && sourceTags.length > 0 && typeof isCloneFieldChecked === 'function' && isCloneFieldChecked('tags')) {
              sourceTags.forEach(tag => addItemTag(newItem.uuid, tag, false));
              saveItemTags();
            }
          }

          window._cloneSessionCount++;
          window._cloneDirty = true;
          if (typeof updateCloneCounter === 'function') updateCloneCounter();

          // Clear spot lookup hidden field
          if (elements.itemSpotPrice) elements.itemSpotPrice.value = '';

          if (window._cloneSaveAndClose) {
            window._cloneSaveAndClose = true; // Reset default for next session
            if (typeof exitCloneMode === 'function') exitCloneMode(true); // silent — don't re-open edit
            // Fall through to normal close logic below
          } else {
            // Save & Clone Another — reset unchecked fields, stay open
            window._cloneSaveAndClose = true; // Reset default for Enter-key safety
            if (typeof resetUncheckedCloneFields === 'function') resetUncheckedCloneFields();
            return; // Don't close modal, don't reset form
          }
        }

        // Save user-uploaded image if pending (STACK-32)
        // Pattern toggle: promote images to a pattern rule instead of (or in addition to) per-item save
        let patternRuleSaved = false;
        const patternToggle = document.getElementById('imagePatternToggle');
        const savedItem = isEditing ? inventory[savedEditIdx] : inventory[inventory.length - 1];
        if (patternToggle?.checked) {
          try {
            const rawKeywords = (document.getElementById('imagePatternKeywords')?.value || '').trim();
            if (rawKeywords) {
              // Resolve blobs: prefer pending upload, fall back to already-saved per-item IDB record
              let obvBlob = _pendingObverseBlob;
              let revBlob = _pendingReverseBlob;
              // Fill in missing sides from existing per-item IDB record
              if ((!obvBlob || !revBlob) && savedItem?.uuid && window.imageCache?.isAvailable()) {
                const existing = await window.imageCache.getUserImage(savedItem.uuid).catch(() => null);
                if (existing) {
                  if (!obvBlob) obvBlob = existing.obverse || null;
                  if (!revBlob) revBlob = existing.reverse || null;
                }
              }

              if (obvBlob || revBlob) {
                // Convert keywords to regex: "morgan, peace" → "morgan|peace"
                const terms = rawKeywords.split(/[,;]/).map(t => t.trim()).filter(t => t.length > 0);
                const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
                // Pre-generate ruleId and pass as seedImageId — the image lookup
                // chain resolves via rule.seedImageId, not rule.id
                const ruleId = 'custom-img-' + Date.now();
                const result = NumistaLookup.addRule(pattern, rawKeywords, null, ruleId);
                if (result?.success && window.imageCache?.isAvailable()) {
                  await window.imageCache.cachePatternImage(ruleId, obvBlob, revBlob);
                  debugLog(`Pattern rule created: ${result.id} (images: ${ruleId}) for "${rawKeywords}"`);
                  // Move: delete the per-item userImages record so it no longer appears in Per-Item section
                  if (savedItem?.uuid) {
                    await window.imageCache.deleteUserImage(savedItem.uuid).catch(() => {});
                  }
                } else {
                  debugLog(`Failed to create pattern rule: ${result?.error}`, 'warn');
                }
              } else {
                debugLog('Pattern toggle checked but no images available to promote', 'warn');
              }
              clearUploadState();
              patternRuleSaved = true;
              renderTable();
            }
          } catch (err) {
            console.warn('Failed to create pattern rule from modal:', err);
            clearUploadState();
            patternRuleSaved = true; // prevent double-save on error
          }
        }
        if (!patternRuleSaved && (_pendingObverseBlob || _pendingReverseBlob || _deleteObverseOnSave || _deleteReverseOnSave)) {
          // Per-item save: save blobs against the item's UUID
          if (savedItem?.uuid) {
            try {
              const saved = await saveUserImageForItem(savedItem.uuid);
              if (!saved) {
                debugLog('Image save returned false — image may not have been stored');
              } else {
                // Re-render so thumbnails reflect the newly saved image
                renderTable();
              }
            } catch (err) {
              console.warn('Failed to save user image:', err);
            }
          }
        } else if (!patternRuleSaved) {
          clearUploadState();
        }

        // Clear spot lookup hidden field after commit (STACK-49)
        if (elements.itemSpotPrice) elements.itemSpotPrice.value = '';

        if (!isEditing) {
          this.reset();
          elements.itemWeightUnit.value = "oz";
          elements.itemDate.value = todayStr();
        }

        // Close modal
        try {
          if (typeof closeModalById === 'function') {
            closeModalById('itemModal');
          } else if (elements.itemModal) {
            elements.itemModal.style.display = 'none';
            document.body.style.overflow = '';
          }
        } catch (closeErr) {
          console.warn('Failed to close item modal:', closeErr);
        }

        // Update filter chips after inventory mutation
        if (typeof renderActiveFilters === 'function') {
          renderActiveFilters();
        }
      },
      "Unified item form",
    );
  } else {
    console.error("Main inventory form not found!");
  }

  // UNDO CHANGE BUTTON
  if (elements.undoChangeBtn) {
    safeAttachListener(
      elements.undoChangeBtn,
      "click",
      (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (editingChangeLogIndex !== null) {
          toggleChange(editingChangeLogIndex);
          try { if (typeof closeModalById === 'function') closeModalById('itemModal'); } catch(undoErr) {}
          editingIndex = null;
          editingChangeLogIndex = null;
          renderChangeLog();
        }
      },
      "Undo change button",
    );
  }

  // ITEM MODAL CLOSE / CANCEL BUTTONS
  const closeItemModal = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    // In clone mode, "Back" returns to edit mode instead of closing (STAK-375)
    if (window._cloneMode && typeof exitCloneMode === 'function') {
      exitCloneMode();
      return;
    }
    // Dismiss any open autocomplete dropdowns (BUG-002/003)
    if (typeof dismissAllAutocompletes === 'function') dismissAllAutocompletes();
    try { if (typeof closeModalById === 'function') closeModalById('itemModal'); } catch(closeErr) {}
    editingIndex = null;
    editingChangeLogIndex = null;
  };

  optionalListener(elements.cancelItemBtn, "click", closeItemModal, "Cancel item button");
  optionalListener(elements.itemCloseBtn, "click", closeItemModal, "Item modal close button");

  // RETAIL PRICE HISTORY LINK — opens per-item price history modal (STAK-109)
  const retailHistoryLink = document.getElementById('retailPriceHistoryLink');
  if (retailHistoryLink) {
    retailHistoryLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editingIndex === null) return;
      const item = inventory[editingIndex];
      if (!item || !item.uuid) return;
      if (typeof openItemPriceHistoryModal === 'function') {
        openItemPriceHistoryModal(item.uuid, item.name || 'Unnamed');
      }
    });
  }

  // ITEM PRICE HISTORY MODAL — close & filter handlers (STAK-109)
  const itemPriceHistoryModal = document.getElementById('itemPriceHistoryModal');
  const itemPriceHistoryCloseBtn = document.getElementById('itemPriceHistoryCloseBtn');
  const itemPriceHistoryFilter = document.getElementById('itemPriceHistoryFilter');
  const itemPriceHistoryClearFilterBtn = document.getElementById('itemPriceHistoryClearFilterBtn');

  if (itemPriceHistoryCloseBtn) {
    itemPriceHistoryCloseBtn.addEventListener('click', () => {
      if (itemPriceHistoryModal) itemPriceHistoryModal.style.display = 'none';
    });
  }
  if (itemPriceHistoryModal) {
    itemPriceHistoryModal.addEventListener('click', (e) => {
      if (e.target === itemPriceHistoryModal) {
        itemPriceHistoryModal.style.display = 'none';
      }
    });
  }
  if (itemPriceHistoryFilter) {
    itemPriceHistoryFilter.addEventListener('input', () => {
      if (typeof window._setItemPriceModalFilter === 'function') {
        window._setItemPriceModalFilter(itemPriceHistoryFilter.value);
      }
    });
  }
  if (itemPriceHistoryClearFilterBtn) {
    itemPriceHistoryClearFilterBtn.addEventListener('click', () => {
      if (itemPriceHistoryFilter) itemPriceHistoryFilter.value = '';
      if (typeof window._setItemPriceModalFilter === 'function') {
        window._setItemPriceModalFilter('');
      }
    });
  }

  // IMAGE URL FIELDS — show URL buttons + refresh when COIN_IMAGES enabled
  if (featureFlags.isEnabled('COIN_IMAGES')) {
    // Show URL toggle buttons and refresh button inline
    ['Obv', 'Rev'].forEach(suffix => {
      const urlBtn = document.getElementById('itemImageUrlBtn' + suffix);
      const urlInput = document.getElementById('itemImageUrlInput' + suffix);
      if (urlBtn) {
        urlBtn.style.display = '';
        urlBtn.addEventListener('click', () => {
          if (urlInput) {
            const isHidden = urlInput.style.display === 'none';
            urlInput.style.display = isHidden ? '' : 'none';
            urlBtn.classList.toggle('active', isHidden);
          }
        });
      }
    });
  }

  // IMAGE UPLOAD BUTTONS — Obverse + Reverse (STACK-32/33)
  const imageUploadGroup = document.getElementById('imageUploadGroup');

  if (imageUploadGroup && featureFlags.isEnabled('COIN_IMAGES')) {
    imageUploadGroup.style.display = '';

    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);

    // Wire each side: Obv and Rev
    ['Obv', 'Rev'].forEach(suffix => {
      const side = suffix === 'Rev' ? 'reverse' : 'obverse';
      const fileInput = document.getElementById('itemImageFile' + suffix);
      const uploadBtn = document.getElementById('itemImageUploadBtn' + suffix);
      const cameraBtn = document.getElementById('itemImageCameraBtn' + suffix);
      const removeBtn = document.getElementById('itemImageRemoveBtn' + suffix);

      if (isMobile && isSecure && cameraBtn && fileInput) {
        cameraBtn.style.display = '';
        cameraBtn.addEventListener('click', () => {
          fileInput.setAttribute('capture', 'environment');
          fileInput.click();
        });
      }

      if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', () => {
          fileInput.removeAttribute('capture');
          fileInput.click();
        });
      }

      if (fileInput) {
        fileInput.addEventListener('change', async () => {
          const file = fileInput.files?.[0];
          if (file) await processUploadedImage(file, side);
        });
      }

      if (removeBtn) {
        removeBtn.addEventListener('click', async () => {
          // Clear just this side
          if (side === 'reverse') {
            _pendingReverseBlob = null;
            _deleteReverseOnSave = true;
            if (_pendingReversePreviewUrl) { URL.revokeObjectURL(_pendingReversePreviewUrl); _pendingReversePreviewUrl = null; }
          } else {
            _pendingObverseBlob = null;
            _deleteObverseOnSave = true;
            if (_pendingObversePreviewUrl) { URL.revokeObjectURL(_pendingObversePreviewUrl); _pendingObversePreviewUrl = null; }
          }
          const preview = document.getElementById('itemImagePreview' + suffix);
          const img = document.getElementById('itemImagePreviewImg' + suffix);
          const sizeInfo = document.getElementById('itemImageSizeInfo' + suffix);
          if (preview) preview.style.display = 'none';
          if (img) img.src = '';
          if (sizeInfo) sizeInfo.textContent = '';
          if (removeBtn) removeBtn.style.display = 'none';
          if (fileInput) fileInput.value = '';
          // STAK-308: Clear URL field so deleted CDN URL doesn't persist on save
          const urlField = side === 'reverse' ? elements.itemReverseImageUrl : elements.itemObverseImageUrl;
          if (urlField) urlField.value = '';
          // STAK-332: Flag item to ignore pattern rule images after explicit removal
          const ignorePatternCheckbox = document.getElementById('itemIgnorePatternImages');
          if (ignorePatternCheckbox) ignorePatternCheckbox.checked = true;
          updateSwapButtonVisibility();

          // STAK-244: Also clear Numista image cache if user is removing a catalog-synced image
          const catalogId = elements.itemCatalog?.value?.trim() || '';
          if (catalogId && window.imageCache?.isAvailable()) {
            debugLog(`Remove button: clearing Numista cache for ${catalogId}`);
            try {
              await imageCache.deleteImages(catalogId);
              await imageCache.deleteMetadata(catalogId);
            } catch (err) {
              debugLog(`Failed to clear Numista image cache on remove: ${err.message}`, 'warn');
            }
          }
        });
      }
    });

    // PATTERN TOGGLE — "Apply to all matching items" checkbox
    const patternToggleGroup = document.getElementById('imagePatternToggleGroup');
    const patternToggleCheckbox = document.getElementById('imagePatternToggle');
    const patternKeywordsGroup = document.getElementById('imagePatternKeywordsGroup');
    const patternKeywordsInput = document.getElementById('imagePatternKeywords');

    if (patternToggleGroup) {
      patternToggleGroup.style.display = '';
    }
    if (patternToggleCheckbox) {
      patternToggleCheckbox.addEventListener('change', () => {
        if (patternKeywordsGroup) {
          patternKeywordsGroup.style.display = patternToggleCheckbox.checked ? '' : 'none';
        }
        if (patternToggleCheckbox.checked && patternKeywordsInput) {
          const itemName = document.getElementById('itemName')?.value?.trim() || '';
          if (itemName && !patternKeywordsInput.value.trim()) {
            patternKeywordsInput.value = itemName;
          }
        }
      });
    }
  }

  // SWAP OBVERSE/REVERSE BUTTON (STAK-341)
  const swapBtn = safeGetElement('swapImagesBtn');
  if (swapBtn) {
    swapBtn.addEventListener('click', async () => {
      // Hydrate each missing side from IndexedDB before swap (PR #551 review)
      // Must hydrate per-side (not gated on both null) to handle mixed
      // upload+swap: user uploads one side, then swaps before saving.
      const uuid = editingIndex !== null ? inventory[editingIndex]?.uuid : null;
      if (uuid && (!_pendingObverseBlob || !_pendingReverseBlob) && window.imageCache?.isAvailable()) {
        try {
          const rec = await imageCache.getUserImage(uuid);
          if (!_pendingObverseBlob && rec?.obverse) _pendingObverseBlob = rec.obverse;
          if (!_pendingReverseBlob && rec?.reverse) _pendingReverseBlob = rec.reverse;
        } catch { /* ignore — blobs stay null */ }
      }

      // Swap pending blobs
      const tmpBlob = _pendingObverseBlob;
      _pendingObverseBlob = _pendingReverseBlob;
      _pendingReverseBlob = tmpBlob;

      // Swap preview URLs
      const tmpUrl = _pendingObversePreviewUrl;
      _pendingObversePreviewUrl = _pendingReversePreviewUrl;
      _pendingReversePreviewUrl = tmpUrl;

      // Swap delete flags
      const tmpDel = _deleteObverseOnSave;
      _deleteObverseOnSave = _deleteReverseOnSave;
      _deleteReverseOnSave = tmpDel;

      // Swap visible preview images
      const imgObv = document.getElementById('itemImagePreviewImgObv');
      const imgRev = document.getElementById('itemImagePreviewImgRev');
      if (imgObv && imgRev) {
        const tmpSrc = imgObv.src;
        imgObv.src = imgRev.src;
        imgRev.src = tmpSrc;
      }

      // Swap URL fields
      const urlObv = elements.itemObverseImageUrl;
      const urlRev = elements.itemReverseImageUrl;
      if (urlObv && urlRev) {
        const tmpVal = urlObv.value;
        urlObv.value = urlRev.value;
        urlRev.value = tmpVal;
      }

      // Swap size info text
      const sizeObv = document.getElementById('itemImageSizeInfoObv');
      const sizeRev = document.getElementById('itemImageSizeInfoRev');
      if (sizeObv && sizeRev) {
        const tmpText = sizeObv.textContent;
        sizeObv.textContent = sizeRev.textContent;
        sizeRev.textContent = tmpText;
      }

      // Clear file inputs to avoid filename mismatch (PR #551 review)
      const fileObv = document.getElementById('itemImageFileObv');
      const fileRev = document.getElementById('itemImageFileRev');
      if (fileObv) fileObv.value = '';
      if (fileRev) fileRev.value = '';
    });
  }

  // SEARCH NUMISTA BUTTON — lookup by N# or search by name
  if (elements.searchNumistaBtn) {
    safeAttachListener(
      elements.searchNumistaBtn,
      "click",
      async () => {
        const catalogVal = elements.itemCatalog?.value.trim() || '';
        const nameVal = elements.itemName?.value.trim() || '';

        if (!catalogVal && !nameVal) {
          appAlert('Enter a Name or Catalog N# to search.');
          return;
        }

        if (!catalogAPI || !catalogAPI.activeProvider) {
          appAlert('Configure Numista API key in Settings first.');
          return;
        }

        const btn = elements.searchNumistaBtn;
        if (typeof setButtonLoading === 'function') {
          setButtonLoading(btn, true, 'Searching...');
        } else {
          // Fallback if util not loaded
          btn.dataset.originalHtml = btn.innerHTML;
          btn.textContent = 'Searching...';
          btn.disabled = true;
        }

        // Type → Numista category mapping for smarter search results
        const TYPE_TO_NUMISTA_CATEGORY = {
          'Coin': 'coin',
          'Bar': 'exonumia',
          'Round': 'exonumia',
          'Note': 'banknote',
        };

        try {
          if (catalogVal) {
            const result = await catalogAPI.lookupItem(catalogVal);
            showNumistaResults(result ? [result] : [], true, catalogVal);
          } else {
            const typeVal = elements.itemType?.value || '';
            const metalVal = elements.itemMetal?.value || '';

            const searchFilters = { limit: 20 };
            const numistaCategory = TYPE_TO_NUMISTA_CATEGORY[typeVal];
            if (numistaCategory) searchFilters.category = numistaCategory;

            const searchResult = buildNumistaSearchQuery(nameVal, metalVal);

            if (searchResult.matched) {
              // Pattern matched — build raw query for fallback results
              const rawQuery = (metalVal && !nameVal.toLowerCase().includes(metalVal.toLowerCase()))
                ? `${metalVal} ${nameVal}` : nameVal;

              // Fire all requests in parallel: direct N# + rewritten + raw fallback
              const promises = [
                searchResult.numistaId
                  ? catalogAPI.lookupItem(searchResult.numistaId).catch(() => null)
                  : Promise.resolve(null),
                catalogAPI.searchItems(searchResult.query, searchFilters),
                catalogAPI.searchItems(rawQuery, searchFilters),
              ];
              const [directResult, rewrittenResults, rawResults] = await Promise.all(promises);

              // Layer results: pinned direct → rewritten → raw fallback (deduped)
              const seen = new Set();
              const merged = [];
              const addUnique = (item) => {
                if (item && item.catalogId && !seen.has(item.catalogId)) {
                  seen.add(item.catalogId);
                  merged.push(item);
                }
              };
              if (directResult) addUnique(directResult);
              for (const r of rewrittenResults) addUnique(r);
              for (const r of rawResults) addUnique(r);

              showNumistaResults(merged, false, searchResult.query);
            } else {
              const results = await catalogAPI.searchItems(searchResult.query, searchFilters);
              showNumistaResults(results, false, searchResult.query);
            }
          }
        } catch (error) {
          console.error('Numista search error:', error);
          appAlert('Search failed: ' + error.message);
        } finally {
          setButtonLoading(btn, false);
        }
      },
      "Search Numista button",
    );
  }

  // LOOKUP PCGS BUTTON — verify by Cert# or look up by PCGS#
  if (elements.lookupPcgsBtn) {
    safeAttachListener(
      elements.lookupPcgsBtn,
      "click",
      async () => {
        if (typeof lookupPcgsFromForm !== 'function') {
          appAlert('PCGS lookup is not available.');
          return;
        }

        const btn = elements.lookupPcgsBtn;
        if (typeof setButtonLoading === 'function') {
          setButtonLoading(btn, true, 'Looking up...');
        } else {
          btn.dataset.originalHtml = btn.innerHTML;
          btn.textContent = 'Looking up...';
          btn.disabled = true;
        }

        try {
          const result = await lookupPcgsFromForm();

          if (!result.verified) {
            appAlert(result.error || 'PCGS lookup failed.');
            return;
          }

          // Show field picker modal instead of auto-filling
          if (typeof showPcgsFieldPicker === 'function') {
            showPcgsFieldPicker(result);
          } else {
            appAlert('PCGS field picker not available.');
          }
        } catch (error) {
          console.error('PCGS lookup error:', error);
          appAlert('PCGS lookup failed: ' + error.message);
        } finally {
          setButtonLoading(btn, false);
        }
      },
      "Lookup PCGS button",
    );
  }

  // SPOT LOOKUP BUTTON — search historical spot prices by date (STACK-49)
  if (elements.spotLookupBtn) {
    safeAttachListener(
      elements.spotLookupBtn,
      "click",
      () => {
        if (typeof openSpotLookupModal === 'function') openSpotLookupModal();
      },
      "Spot lookup button",
    );
  }

  // DATE FIELD — enable/disable spot lookup button based on date value (STACK-49)
  if (elements.itemDate) {
    const updateSpotBtnState = () => {
      if (elements.spotLookupBtn) {
        elements.spotLookupBtn.disabled = !elements.itemDate.value;
      }
      if (elements.itemSpotPrice) elements.itemSpotPrice.value = '';
    };
    safeAttachListener(elements.itemDate, "change", updateSpotBtnState, "Date field for spot btn");
    safeAttachListener(elements.itemDate, "input", updateSpotBtnState, "Date field input for spot btn");
  }

  // METAL CHANGE — clear stale spot lookup value (STACK-49)
  if (elements.itemMetal) {
    safeAttachListener(
      elements.itemMetal,
      "change",
      () => {
        if (elements.itemSpotPrice) elements.itemSpotPrice.value = '';
      },
      "Metal change clears spot lookup",
    );
  }

  // NUMISTA NAME SEARCH — triggers same logic as N# search but forces name-based
  if (elements.searchNumistaNameBtn) {
    safeAttachListener(
      elements.searchNumistaNameBtn,
      "click",
      () => {
        // Delegate to the main Numista search button click
        if (elements.searchNumistaBtn) elements.searchNumistaBtn.click();
      },
      "Numista name search button",
    );
  }

  // CLONE ITEM BUTTON — enter clone mode on the edit modal (STAK-375)
  if (elements.cloneItemBtn) {
    safeAttachListener(
      elements.cloneItemBtn,
      "click",
      () => {
        if (typeof editingIndex === 'number' && editingIndex >= 0 && typeof enterCloneMode === 'function') {
          enterCloneMode(editingIndex);
        }
      },
      "Clone item button",
    );
  }

  // SAVE & CLONE ANOTHER BUTTON — submit form, stay in clone mode (STAK-375)
  if (elements.cloneItemSaveAnotherBtn) {
    safeAttachListener(
      elements.cloneItemSaveAnotherBtn,
      "click",
      () => {
        window._cloneSaveAndClose = false;
        if (elements.inventoryForm) elements.inventoryForm.requestSubmit();
      },
      "Save & clone another button",
    );
  }

  // SAVE & CLOSE IN CLONE MODE — _cloneSaveAndClose defaults to true, so
  // Enter-key and submit-button clicks both route to Save & Close.
  // Only the "Save & Clone Another" button sets it to false before requestSubmit().

  // VIEW ITEM BUTTON — open view modal from edit mode (STAK-173)
  if (elements.viewItemFromEditBtn) {
    safeAttachListener(
      elements.viewItemFromEditBtn,
      "click",
      () => {
        if (typeof editingIndex === 'number' && editingIndex >= 0 && typeof showViewModal === 'function') {
          if (typeof closeModalById === 'function') closeModalById('itemModal');
          else {
            const modal = document.getElementById('itemModal');
            if (modal) modal.style.display = 'none';
            document.body.style.overflow = '';
          }
          showViewModal(editingIndex);
        }
      },
      "View item from edit button",
    );
  }

  // COMMEMORATIVE CHECKBOX — toggle description field (STAK-173)
  const numistaCommemorative = document.getElementById('numistaCommemorative');
  const numistaCommemorativeDescWrap = document.getElementById('numistaCommemorativeDescWrap');
  if (numistaCommemorative && numistaCommemorativeDescWrap) {
    safeAttachListener(
      numistaCommemorative,
      "change",
      () => {
        numistaCommemorativeDescWrap.style.display = numistaCommemorative.checked ? '' : 'none';
      },
      "Commemorative checkbox toggle",
    );
  }

  // DATE N/A TOGGLE BUTTON (STAK-375)
  if (elements.itemDateNABtn && elements.itemDate) {
    safeAttachListener(
      elements.itemDateNABtn,
      "click",
      () => {
        const isActive = elements.itemDateNABtn.classList.toggle('active');
        elements.itemDateNABtn.setAttribute('aria-pressed', isActive);
        elements.itemDate.disabled = isActive;
        if (isActive) {
          elements.itemDate.value = "";
        }
      },
      "Date N/A toggle button",
    );
  }

  if (elements.estimateRetailFromSpot) {
    safeAttachListener(
      elements.estimateRetailFromSpot,
      "change",
      () => {
        if (elements.retailSpotModifier) {
          elements.retailSpotModifier.disabled = !elements.estimateRetailFromSpot.checked;
        }
      },
      "Estimate retail checkbox",
    );
  }
};

/** Closes the notes modal and resets the notes index. */
const dismissNotesModal = () => {
  if (elements.notesModal) elements.notesModal.style.display = "none";
  notesIndex = null;
};

/**
 * Sets up notes modal, debug modal, bulk edit, changelog, and settings clear button listeners
 */
const setupNoteAndModalListeners = () => {
  // NOTES MODAL BUTTONS
  optionalListener(elements.saveNotesBtn, "click", () => {
    if (notesIndex === null) return;
    const text = elements.notesTextarea ? elements.notesTextarea.value.trim() : "";

    const oldItem = { ...inventory[notesIndex] };
    inventory[notesIndex].notes = text;
    if (typeof window.invalidateSearchCache === 'function') {
      window.invalidateSearchCache(inventory[notesIndex]);
    }
    saveInventory();
    renderTable();
    logItemChanges(oldItem, inventory[notesIndex]);
    dismissNotesModal();
  }, "Save notes button");

  optionalListener(elements.cancelNotesBtn, "click", dismissNotesModal, "Cancel notes button");
  optionalListener(elements.notesCloseBtn, "click", dismissNotesModal, "Notes modal close button");
  optionalListener(document.getElementById('notesViewCloseBtn'), "click", () => {
    if (typeof closeModalById === 'function') closeModalById('notesViewModal');
  }, "Notes view modal close button");

  optionalListener(document.getElementById('goldbackExchangeRateLink'), "click", (e) => {
    e.preventDefault();
    window.open(
      'https://www.goldback.com/exchange-rates/',
      'goldback_rates',
      'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no',
    );
  }, "Goldback exchange rates link");

  optionalListener(document.getElementById('spotLookupCloseBtn'), "click", () => {
    if (typeof closeSpotLookupModal === 'function') closeSpotLookupModal();
  }, "Spot lookup modal close button");

  optionalListener(elements.debugCloseBtn, "click",
    () => { if (typeof hideDebugModal === "function") hideDebugModal(); },
    "Debug modal close button");

  // Bulk Edit modal open/close
  optionalListener(elements.bulkEditBtn, "click",
    () => { if (typeof openBulkEdit === "function") openBulkEdit(); },
    "Bulk edit open button");
  optionalListener(elements.bulkEditCloseBtn, "click",
    () => { if (typeof closeBulkEdit === "function") closeBulkEdit(); },
    "Bulk edit close button");

  optionalListener(elements.changeLogBtn, "click", (e) => {
    e.preventDefault();
    if (typeof showSettingsModal === "function") showSettingsModal("changelog");
  }, "Change log button");

  // Settings panel clear buttons (STACK-44)
  optionalListener(elements.settingsChangeLogClearBtn, "click",
    () => { if (typeof clearChangeLog === "function") clearChangeLog(); },
    "Settings change log clear button");
  optionalListener(elements.settingsSpotHistoryClearBtn, "click",
    () => { if (typeof clearSpotHistory === "function") clearSpotHistory(); },
    "Settings spot history clear button");
  optionalListener(elements.settingsCatalogHistoryClearBtn, "click",
    () => { if (typeof clearCatalogHistory === "function") clearCatalogHistory(); },
    "Settings catalog history clear button");
  optionalListener(elements.settingsPriceHistoryClearBtn, "click",
    () => { if (typeof clearItemPriceHistory === "function") clearItemPriceHistory(); },
    "Settings price history clear button");
  optionalListener(elements.settingsCloudActivityClearBtn, "click",
    () => { if (typeof clearCloudActivityLog === "function") clearCloudActivityLog(); },
    "Settings cloud activity clear button");

  // Price History filter input (STACK-44)
  optionalListener(elements.priceHistoryFilterInput, "input",
    () => { if (typeof filterItemPriceHistoryTable === "function") filterItemPriceHistoryTable(); },
    "Price history filter input");

  optionalListener(elements.backupReminder, "click", (e) => {
    e.preventDefault();
    if (typeof showSettingsModal === "function") showSettingsModal('system');
  }, "Backup reminder link");

  optionalListener(elements.storageReportLink, "click", (e) => {
    e.preventDefault();
    if (typeof showSettingsModal === "function") showSettingsModal("storage");
  }, "Storage report link");

  optionalListener(elements.changeLogCloseBtn, "click", () => {
    if (elements.changeLogModal) {
      if (window.closeModalById) closeModalById('changeLogModal');
      else {
        elements.changeLogModal.style.display = "none";
        document.body.style.overflow = "";
      }
    }
  }, "Change log close button");

  optionalListener(elements.changeLogClearBtn, "click",
    () => { if (typeof clearChangeLog === "function") clearChangeLog(); },
    "Change log clear button");

};

/**
 * Sets up spot price sync icons, range dropdowns, and inline editing
 */
const setupSpotPriceListeners = () => {
  // SPOT PRICE EVENT LISTENERS — Sparkline card redesign
  debugLog("Setting up spot price listeners...");
  Object.values(METALS).forEach((metalConfig) => {
    const metalKey = metalConfig.key;
    const metalName = metalConfig.name;

    // Sync icon button
    const syncIcon = document.getElementById(`syncIcon${metalName}`);
    if (syncIcon) {
      safeAttachListener(
        syncIcon,
        "click",
        () => {
          debugLog(`Sync icon clicked for ${metalName}`);
          if (typeof syncSpotPricesFromApi === "function") {
            syncSpotPricesFromApi(true);
          } else {
            appAlert(
              "API sync functionality requires Metals API configuration. Please configure an API provider first.",
            );
          }
        },
        `Sync spot price for ${metalName}`,
      );
    }

    // Range dropdown change → re-render sparkline + save preference
    const rangeSelect = document.getElementById(`spotRange${metalName}`);
    if (rangeSelect) {
      // Restore saved preference
      const saved = typeof loadTrendRanges === "function" ? loadTrendRanges() : {};
      if (saved[metalKey]) {
        rangeSelect.value = String(saved[metalKey]);
      }

      safeAttachListener(
        rangeSelect,
        "change",
        () => {
          const days = parseInt(rangeSelect.value, 10);
          if (typeof saveTrendRange === "function") saveTrendRange(metalKey, days);
          if (typeof updateSparkline === "function") updateSparkline(metalKey);
        },
        `Trend range for ${metalName}`,
      );
    }
  });

  // Shift+click capture handler for inline spot price editing
  document.addEventListener(
    "click",
    (e) => {
      if (!e.shiftKey) return;
      const valueEl = e.target.closest(".spot-card-value");
      if (!valueEl) return;

      e.preventDefault();
      e.stopPropagation();

      const card = valueEl.closest(".spot-card");
      if (!card || !card.dataset.metal) return;

      if (typeof startSpotInlineEdit === "function") {
        startSpotInlineEdit(valueEl, card.dataset.metal);
      }
    },
    true,
  );

  // Long-press handler for mobile inline spot price editing (STAK-285)
  // Mirrors shift+click behavior: hold 600ms on spot price to open manual input
  let _spotLongPressTimer = null;
  let _spotLongPressFired = false;

  document.addEventListener("touchstart", (e) => {
    const valueEl = e.target.closest(".spot-card-value");
    if (!valueEl) return;
    // Clear any existing timer to prevent orphaned timeouts on rapid re-touch
    if (_spotLongPressTimer) { clearTimeout(_spotLongPressTimer); _spotLongPressTimer = null; }
    _spotLongPressFired = false;
    _spotLongPressTimer = setTimeout(() => {
      _spotLongPressFired = true;
      _spotLongPressTimer = null;
      const card = valueEl.closest(".spot-card");
      if (!card || !card.dataset.metal) return;
      if (typeof startSpotInlineEdit === "function") {
        startSpotInlineEdit(valueEl, card.dataset.metal);
      }
    }, 600);
  }, { passive: false });

  // Suppress context menu during long-press (preventDefault inside setTimeout is stale)
  document.addEventListener("contextmenu", (e) => {
    if (_spotLongPressFired || _spotLongPressTimer) {
      e.preventDefault();
    }
  });

  document.addEventListener("touchend", (e) => {
    if (_spotLongPressTimer) {
      clearTimeout(_spotLongPressTimer);
      _spotLongPressTimer = null;
    }
    // Suppress the click/tap that follows a successful long-press
    if (_spotLongPressFired) {
      e.preventDefault();
      _spotLongPressFired = false;
    }
  }, { passive: false });

  document.addEventListener("touchmove", () => {
    if (_spotLongPressTimer) {
      clearTimeout(_spotLongPressTimer);
      _spotLongPressTimer = null;
    }
  }, { passive: true });

  // Cancel long-press when browser cancels the gesture (e.g., incoming call, scroll takeover)
  document.addEventListener("touchcancel", () => {
    if (_spotLongPressTimer) {
      clearTimeout(_spotLongPressTimer);
      _spotLongPressTimer = null;
    }
  }, { passive: true });

};

/**
 * Sets up vault backup/restore listeners and password strength UI.
 */
const setupVaultListeners = () => {
  const vaultCloseBtn = document.getElementById('vaultCloseBtn');
  const vaultActionBtn = document.getElementById('vaultActionBtn');
  const vaultCancelBtn = document.getElementById('vaultCancelBtn');
  const vaultPasswordToggle = document.getElementById('vaultPasswordToggle');
  const vaultConfirmToggle = document.getElementById('vaultConfirmToggle');

  optionalListener(elements.vaultExportBtn, "click",
    () => { openVaultModal("export"); },
    "Vault export button");

  optionalListener(elements.vaultImportBtn, "click",
    () => { if (elements.vaultImportFile) elements.vaultImportFile.click(); },
    "Vault import button");

  optionalListener(elements.vaultImportFile, "change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) {
      openVaultModal("import", file);
      e.target.value = "";
    }
  }, "Vault import file input");

  optionalListener(vaultCloseBtn, "click", () => {
    if (typeof closeVaultModal === 'function') closeVaultModal();
  }, "Vault modal close button");

  optionalListener(vaultActionBtn, "click", () => {
    if (typeof handleVaultAction === 'function') handleVaultAction();
  }, "Vault modal action button");

  optionalListener(vaultCancelBtn, "click", () => {
    if (typeof closeVaultModal === 'function') closeVaultModal();
  }, "Vault modal cancel button");

  optionalListener(vaultPasswordToggle, "click", () => {
    if (typeof toggleVaultPasswordVisibility === 'function') {
      toggleVaultPasswordVisibility('vaultPassword', vaultPasswordToggle);
    }
  }, "Vault password toggle");

  optionalListener(vaultConfirmToggle, "click", () => {
    if (typeof toggleVaultPasswordVisibility === 'function') {
      toggleVaultPasswordVisibility('vaultConfirmPassword', vaultConfirmToggle);
    }
  }, "Vault confirm password toggle");

  // Vault modal live password events
  const pw = document.getElementById("vaultPassword");
  const cpw = document.getElementById("vaultConfirmPassword");
  optionalListener(pw, "input", () => {
    updateStrengthBar(pw.value);
    if (cpw) updateMatchIndicator(pw.value, cpw.value);
  }, "Vault password input");
  optionalListener(cpw, "input", () => {
    if (pw) updateMatchIndicator(pw.value, cpw.value);
  }, "Vault confirm password input");

  // Image vault companion file picker (import mode only)
  const vaultImageImportFile = document.getElementById("vaultImageImportFile");
  optionalListener(vaultImageImportFile, "change", function (e) {
    var imgFile = e.target.files && e.target.files[0];
    if (!imgFile) return;
    var imgFileInfoEl = document.getElementById("vaultImageFileInfo");
    var imgPickerRowEl = document.getElementById("vaultImagePickerRow");
    var imgFileNameEl = document.getElementById("vaultImageFileName");
    var imgFileSizeEl = document.getElementById("vaultImageFileSize");
    if (imgFileNameEl) imgFileNameEl.textContent = imgFile.name;
    if (imgFileSizeEl && typeof formatFileSize === "function") {
      imgFileSizeEl.textContent = formatFileSize(imgFile.size);
    }
    if (imgFileInfoEl) imgFileInfoEl.style.display = "";
    if (imgPickerRowEl) imgPickerRowEl.style.display = "none";
    var imgReader = new FileReader();
    imgReader.onload = function (ev) {
      if (typeof setVaultPendingImageFile === "function") {
        setVaultPendingImageFile(new Uint8Array(ev.target.result));
      }
    };
    imgReader.onerror = function () {
      debugLog("[Vault] Failed to read image file", "error");
      // Reset picker UI so user can try again
      if (imgFileInfoEl) imgFileInfoEl.style.display = "none";
      if (imgPickerRowEl) imgPickerRowEl.style.display = "";
    };
    imgReader.readAsArrayBuffer(imgFile);
    e.target.value = "";
  }, "Vault image import file input");
};

/**
 * Sets up data-destructive action listeners (remove data, boating accident).
 */
const setupDataManagementListeners = () => {
  optionalListener(elements.removeInventoryDataBtn, "click", async () => {
    const confirmed = typeof showAppConfirm === "function"
      ? await showAppConfirm("Remove all inventory items? This cannot be undone.", "Data Management")
      : false;
    if (confirmed) {
      localStorage.removeItem(LS_KEY);
      // STACK-62: Clear stale autocomplete cache so it rebuilds from fresh inventory
      if (typeof clearLookupCache === 'function') clearLookupCache();
      await loadInventory();
      renderTable();
      renderActiveFilters();
      if (typeof showAppAlert === "function") await showAppAlert("Inventory data cleared.", "Data Management");
    }
  }, "Remove inventory data button");

  optionalListener(elements.boatingAccidentBtn, "click", async () => {
    const confirmed = typeof showAppConfirm === "function"
      ? await showAppConfirm("Did you really lose it all in a boating accident? This will wipe all local data.", "Data Management")
      : false;
    if (confirmed) {
      // Nuclear wipe: clear every allowed localStorage key
      ALLOWED_STORAGE_KEYS.forEach((key) => {
        localStorage.removeItem(key);
      });
      sessionStorage.clear();

      // Clear IndexedDB image cache
      if (window.imageCache && typeof imageCache.clearAll === 'function') {
        imageCache.clearAll().catch(() => {});
      }

      // Reset in-memory log/history arrays
      if (typeof changeLog !== 'undefined') changeLog = [];
      if (typeof catalogHistory !== 'undefined') catalogHistory = [];
      if (typeof spotHistory !== 'undefined') spotHistory = [];

      // Disconnect cloud providers (UI reset)
      if (typeof syncCloudUI === 'function') syncCloudUI();

      await loadInventory();
      renderTable();
      renderActiveFilters();
      loadSpotHistory();
      fetchSpotPrice();
      // Backfill 24h of hourly data after wipe — runs unconditionally since apiConfig
      // is cleared at this point and fetchSpotPrice won't trigger the internal backfill.
      // fetchStaktrakrHourlyRange's existingKeys dedup prevents double-inserts if
      // fetchSpotPrice does happen to succeed with a configured provider.
      if (typeof backfillStaktrakrHourly === 'function') {
        backfillStaktrakrHourly()
          .then(() => { if (typeof updateAllSparklines === 'function') updateAllSparklines(); })
          .catch((err) => { console.warn('[StakTrakr] Post-reset backfill failed:', err); });
      }

      apiConfig = { provider: "", keys: {} };
      apiCache = null;
      updateSyncButtonStates();

      if (typeof showAppAlert === "function") await showAppAlert("All data has been erased. Hope your scuba gear is ready!", "Data Management");
    }
  }, "Boating accident button");

  optionalListener(elements.forceRefreshBtn, "click", async () => {
    if (!navigator.onLine) {
      if (typeof showAppAlert === "function") await showAppAlert("Force Refresh requires an internet connection. Your cached app is still available.", "Force Refresh");
      return;
    }
    const confirmed = typeof showAppConfirm === "function"
      ? await showAppConfirm(
          "This will reload the app and fetch the latest version from the network. Your inventory data will not be affected.",
          "Force Refresh"
        )
      : false;
    if (!confirmed) return;
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (err) {
      console.warn("[ForceRefresh] SW unregister failed:", err);
    }
    window.location.reload();
  }, "Force refresh button");
};

/**
 * Sets up import/export event listeners (CSV, JSON, Numista, PDF, Vault, etc.)
 */
const setupImportExportListeners = () => {
  debugLog("Setting up import/export listeners...");

  // Import triads: Override / Merge / File-input for each format
  setupFormatImport(elements.importCsvOverride, elements.importCsvMerge, elements.importCsvFile, importCsv, "CSV");
  setupFormatImport(elements.importJsonOverride, elements.importJsonMerge, elements.importJsonFile, importJson, "JSON");
  setupFormatImport(
    document.getElementById("importNumistaBtn"),
    document.getElementById("mergeNumistaBtn"),
    elements.numistaImportFile, importNumistaCsv, "Numista CSV"
  );

  // Export buttons
  optionalListener(elements.exportCsvBtn, "click", exportCsv, "CSV export");
  optionalListener(elements.exportJsonBtn, "click", exportJson, "JSON export");
  optionalListener(elements.exportPdfBtn, "click", exportPdf, "PDF export");
  optionalListener(document.getElementById("exportZipBtn"), "click", () => {
    if (typeof createBackupZip === "function") createBackupZip();
  }, "ZIP export");

  // ZIP import
  const importZipBtn = document.getElementById("importZipBtn");
  const importZipFile = document.getElementById("importZipFile");
  if (importZipBtn && importZipFile) {
    importZipBtn.addEventListener("click", () => importZipFile.click());
    importZipFile.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file && typeof restoreBackupZip === "function") {
        restoreBackupZip(file);
        importZipFile.value = "";
      }
    });
  }

  // Cloud Sync modal
  optionalListener(elements.cloudSyncBtn, "click", () => {
    if (elements.cloudSyncModal) {
      if (window.openModalById) openModalById('cloudSyncModal');
      else elements.cloudSyncModal.style.display = "flex";
    }
  }, "Cloud Sync button");
  const cloudSyncCloseBtn = document.getElementById("cloudSyncCloseBtn");
  if (cloudSyncCloseBtn && elements.cloudSyncModal) {
    safeAttachListener(cloudSyncCloseBtn, "click", () => {
      if (window.closeModalById) closeModalById('cloudSyncModal');
      else elements.cloudSyncModal.style.display = "none";
    }, "Cloud Sync close");
  }

  setupVaultListeners();
  setupDataManagementListeners();
};

// MAIN EVENT LISTENERS SETUP
// =============================================================================

/**
 * Sets up all primary event listeners for the application
 */
const setupEventListeners = () => {
  console.log(`Setting up event listeners (v${APP_VERSION})...`);

  try {
    setupSearchAndChipListeners();
    setupResponsiveColumns();
    setupHeaderButtonListeners();
    setupTableSortListeners();
    setupItemFormListeners();
    setupNoteAndModalListeners();
    setupSpotPriceListeners();
    setupImportExportListeners();

    // API MODAL EVENT LISTENERS
    debugLog("Setting up API modal listeners...");
    setupApiEvents();

    // ABOUT MODAL EVENT LISTENERS
    debugLog("Setting up about modal listeners...");
    if (typeof setupAboutModalEvents === "function") {
      setupAboutModalEvents();
    }

    debugLog("✓ All event listeners setup complete");
  } catch (error) {
    console.error("❌ Error setting up event listeners:", error);
    throw error;
  }
};

/**
 * Sets up visible-rows (portal view) event listener
 */
const setupPagination = () => {
  debugLog("Setting up visible-rows listener...");

  try {
    if (elements.itemsPerPage) {
      safeAttachListener(
        elements.itemsPerPage,
        "change",
        function () {
          const ippVal = this.value;
          itemsPerPage = ippVal === 'all' ? Infinity : parseInt(ippVal, 10);
          // Persist setting
          try { localStorage.setItem(ITEMS_PER_PAGE_KEY, ippVal); } catch (e) { /* ignore */ }
          // Sync settings modal control
          const settingsIpp = document.getElementById('settingsItemsPerPage');
          if (settingsIpp) settingsIpp.value = ippVal;
          renderTable();
        },
        "Visible rows select",
      );
    }

    debugLog("✓ Visible-rows listener setup complete");
  } catch (error) {
    console.error("❌ Error setting up visible-rows listener:", error);
  }

  // Back to top floating button
  const backToTopBtn = document.getElementById('backToTopBtn');
  if (backToTopBtn) {
    if (!window._backToTopInitialized) {
      window.addEventListener('scroll', () => {
        backToTopBtn.classList.toggle('visible', window.scrollY > 300);
      }, { passive: true });
      backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      window._backToTopInitialized = true;
    }
  }
};

/**
 * Sets up bulk edit control panel event listeners
 */
const setupBulkEditControls = () => {
  debugLog("Setting up bulk edit control listeners...");

  try {
    // Bulk toggle all edit mode
    const bulkToggleAll = document.getElementById('bulkToggleAll');
    if (bulkToggleAll) {
      safeAttachListener(
        bulkToggleAll,
        "click",
        function () {
          if (typeof window.toggleAllItemsEdit === 'function') {
            window.toggleAllItemsEdit();
          }
        },
        "Bulk toggle all edit mode",
      );
    }

    // Bulk save all changes
    const bulkSaveAll = document.getElementById('bulkSaveAll');
    if (bulkSaveAll) {
      safeAttachListener(
        bulkSaveAll,
        "click",
        function () {
          if (typeof window.saveAllEdits === 'function') {
            window.saveAllEdits();
          }
        },
        "Bulk save all changes",
      );
    }

    // Bulk cancel all changes
    const bulkCancelAll = document.getElementById('bulkCancelAll');
    if (bulkCancelAll) {
      safeAttachListener(
        bulkCancelAll,
        "click",
        function () {
          if (typeof window.cancelAllEdits === 'function') {
            window.cancelAllEdits();
          }
        },
        "Bulk cancel all changes",
      );
    }

    debugLog("✓ Bulk edit control listeners setup complete");
  } catch (error) {
    console.error("❌ Error setting up bulk edit control listeners:", error);
  }
};

/**
 * Sets up search event listeners
 */
const setupSearch = () => {
  debugLog("Setting up search listeners...");

  try {
    if (elements.searchInput) {
      const handleSearchInput = debounce(function () {
        searchQuery = this.value.replace(/[<>]/g, '').trim();
        renderTable();
      }, 300);
      safeAttachListener(
        elements.searchInput,
        "input",
        handleSearchInput,
        "Search input",
      );
    }

    if (elements.typeFilter) {
      safeAttachListener(
        elements.typeFilter,
        "change",
        function () {
          const value = this.value;
          if (value) {
            activeFilters.type = { values: [value], exclude: false };
          } else {
            delete activeFilters.type;
          }
          searchQuery = "";
          if (elements.searchInput) elements.searchInput.value = "";
          renderTable();
          renderActiveFilters();
        },
        "Type filter select",
      );
    }

    if (elements.metalFilter) {
      safeAttachListener(
        elements.metalFilter,
        "change",
        function () {
          const value = this.value;
          if (value) {
            activeFilters.metal = { values: [value], exclude: false };
          } else {
            delete activeFilters.metal;
          }
          searchQuery = "";
          if (elements.searchInput) elements.searchInput.value = "";
          renderTable();
          renderActiveFilters();
        },
        "Metal filter select",
      );
    }

    if (elements.clearBtn) {
      safeAttachListener(
        elements.clearBtn,
        "click",
        clearAllFilters,
        "Clear search button",
      );
    }

    if (elements.newItemBtn) {
      safeAttachListener(
        elements.newItemBtn,
        "click",
        () => {
          // Clear editing state (ensures add mode)
          editingIndex = null;
          editingChangeLogIndex = null;
          // Reset form and set defaults
          if (elements.inventoryForm) {
            elements.inventoryForm.reset();
            elements.itemWeightUnit.value = "oz";
            elements.itemDate.value = todayStr();
          }
          if (elements.itemSerial) elements.itemSerial.value = '';
          // Reset spot lookup state (STACK-49)
          if (elements.itemSpotPrice) elements.itemSpotPrice.value = '';
          if (elements.spotLookupBtn) elements.spotLookupBtn.disabled = !elements.itemDate.value;
          // Set modal to add mode
          if (elements.itemModalTitle) elements.itemModalTitle.textContent = "Add Inventory Item";
          if (elements.itemModalSubmit) elements.itemModalSubmit.textContent = "Add to Inventory";
          if (elements.undoChangeBtn) elements.undoChangeBtn.style.display = "none";
          // Reset purity to default (form.reset already sets select to first option)
          const purityCustom = elements.purityCustomWrapper;
          if (purityCustom) purityCustom.style.display = 'none';
          if (elements.itemPurity) elements.itemPurity.value = '';
          // Reset gb denomination picker (STACK-45)
          if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
          // Hide PCGS verified icon in add mode
          const certVerifiedIcon = document.getElementById('certVerifiedIcon');
          if (certVerifiedIcon) certVerifiedIcon.style.display = 'none';
          // Hide price history link in add mode (STAK-109)
          const addRetailHistoryLink = document.getElementById('retailPriceHistoryLink');
          if (addRetailHistoryLink) addRetailHistoryLink.style.display = 'none';
          // Update currency symbols in modal (STACK-50)
          if (typeof updateModalCurrencyUI === 'function') updateModalCurrencyUI();
          // Clear image upload state for fresh add (STACK-32)
          if (typeof clearUploadState === 'function') clearUploadState();
          // Hide inline URL inputs in add mode
          ['Obv', 'Rev'].forEach(s => {
            const urlInput = document.getElementById('itemImageUrlInput' + s);
            if (urlInput) urlInput.style.display = 'none';
          });
          // Update Numista API status dot (STAK-173)
          if (typeof updateNumistaModalDot === 'function') updateNumistaModalDot();
          // Hide clone/view buttons in add mode (STAK-173)
          if (elements.cloneItemBtn) elements.cloneItemBtn.style.display = 'none';
          if (elements.viewItemFromEditBtn) elements.viewItemFromEditBtn.style.display = 'none';
          // Reset date N/A toggle button
          if (elements.itemDateNABtn) { elements.itemDateNABtn.classList.remove('active'); elements.itemDateNABtn.setAttribute('aria-pressed', 'false'); }
          if (elements.itemDate) elements.itemDate.disabled = false;
          // Reset estimate retail checkbox
          if (elements.estimateRetailFromSpot) elements.estimateRetailFromSpot.checked = false;
          if (elements.retailSpotModifier) { elements.retailSpotModifier.value = ''; elements.retailSpotModifier.disabled = true; }
          // Open modal
          if (elements.itemModal) {
            if (window.openModalById) openModalById('itemModal');
            else elements.itemModal.style.display = "flex";
          }
        },
        "New item button",
      );
    }

    // Chip minimum count control
    const chipMinCountEl = document.getElementById('chipMinCount');
    if (chipMinCountEl) {
      safeAttachListener(
        chipMinCountEl,
        "change",
        function() {
          localStorage.setItem('chipMinCount', this.value);
          if (typeof renderActiveFilters === "function") {
            renderActiveFilters();
          }
          if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
        },
        "Chip minimum count select",
      );
    }

    debugLog("✓ Search listeners setup complete");
  } catch (error) {
    console.error("❌ Error setting up search listeners:", error);
  }
};

/**
 * Sets up theme toggle event listeners
 */
const updateThemeButton = () => {
  const savedTheme = localStorage.getItem(THEME_KEY) || "light";

  // Apply theme classes to all theme buttons (header buttons)
  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.remove("dark", "light", "sepia");
    btn.classList.add(savedTheme);
  });

  // Update settings modal theme picker active state
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === savedTheme);
  });
};

window.updateThemeButton = updateThemeButton;

/**
 * Sets up the theme toggle logic and listeners.
 * Initializes the theme based on saved preference or system settings.
 */
const setupThemeToggle = () => {
  debugLog("Setting up theme toggle...");

  try {
    // Initialize theme with system preference detection
    if (typeof initTheme === "function") {
      initTheme();
    } else {
      const savedTheme = localStorage.getItem(THEME_KEY) || "system";
      setTheme(savedTheme);
    }

    updateThemeButton();

    // Set up system theme change listener
    if (typeof setupSystemThemeListener === "function") {
      setupSystemThemeListener();
    }

    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          // Update button if no explicit theme is set
          if (!localStorage.getItem(THEME_KEY)) {
            updateThemeButton();
          }
        });
    }

    // Theme is now controlled from the Settings modal theme picker
    debugLog("✓ Theme toggle setup complete");
  } catch (error) {
    console.error("❌ Error setting up theme toggle:", error);
  }
};

/**
 * Sets up API-related event listeners
 */
const setupApiEvents = () => {
  debugLog("Setting up API events...");

  try {
    let quotaProvider = null;
    const infoModal = document.getElementById("apiInfoModal");
    const infoCloseBtn = document.getElementById("apiInfoCloseBtn");

    if (infoModal) {
      safeAttachListener(
        infoModal,
        "click",
        (e) => {
          if (
            e.target === infoModal &&
            typeof hideProviderInfo === "function"
          ) {
            hideProviderInfo();
          }
        },
        "Provider info modal background",
      );
    }

    if (infoCloseBtn) {
      safeAttachListener(
        infoCloseBtn,
        "click",
        () => {
          if (typeof hideProviderInfo === "function") {
            hideProviderInfo();
          }
        },
        "Provider info close",
      );
    }

    document.querySelectorAll(".api-save-btn").forEach((btn) => {
      const provider = btn.getAttribute("data-provider");
      safeAttachListener(
        btn,
        "click",
        () => {
          if (typeof handleProviderSave === "function") {
            handleProviderSave(provider);
          }
        },
        "API save button",
      );
    });

    document.querySelectorAll(".api-sync-btn").forEach((btn) => {
      const provider = btn.getAttribute("data-provider");
      safeAttachListener(
        btn,
        "click",
        () => {
          if (typeof handleProviderSync === "function") {
            handleProviderSync(provider);
          }
        },
        "API sync button",
      );
    });

    document.querySelectorAll(".api-clear-btn").forEach((btn) => {
      const provider = btn.getAttribute("data-provider");
      safeAttachListener(
        btn,
        "click",
        () => {
          if (typeof clearApiKey === "function") {
            clearApiKey(provider);
          }
        },
        "API clear key button",
      );
    });

    const quotaClose = document.getElementById("apiQuotaCloseBtn");
    if (quotaClose && elements.apiQuotaModal) {
      safeAttachListener(
        quotaClose,
        "click",
        () => (elements.apiQuotaModal.style.display = "none"),
        "API quota close",
      );
    }
    const quotaSave = document.getElementById("apiQuotaSaveBtn");
    if (quotaSave && elements.apiQuotaModal) {
      safeAttachListener(
        quotaSave,
        "click",
        () => {
          const input = document.getElementById("apiQuotaInput");
          const val = parseInt(input.value, 10);
          const qp = elements.apiQuotaModal.dataset.quotaProvider || quotaProvider;
          if (!isNaN(val) && qp) {
            const cfg = loadApiConfig();
            if (!cfg.usage[qp])
              cfg.usage[qp] = { quota: val, used: 0 };
            cfg.usage[qp].quota = val;
            saveApiConfig(cfg);
            elements.apiQuotaModal.style.display = "none";
            updateProviderHistoryTables();
          }
        },
        "API quota save",
      );
    }
    const flushCacheBtn = document.getElementById("flushCacheBtn");
    if (flushCacheBtn) {
      safeAttachListener(
        flushCacheBtn,
        "click",
        async () => {
          if (typeof clearApiCache === "function") {
            const warnMessage =
              "This will delete the API cache and history. Click OK to continue or Cancel to keep it.";
            if (await appConfirm(warnMessage, 'Flush API Cache')) {
              clearApiCache();
            }
          }
        },
        "Flush cache button",
      );
    }

    const historyBtn = document.getElementById("apiHistoryBtn");
    if (historyBtn) {
      safeAttachListener(
        historyBtn,
        "click",
        () => {
          if (typeof showApiHistoryModal === "function") {
            showApiHistoryModal();
          }
        },
        "API history button",
      );
    }

    const catalogHistoryBtn = document.getElementById("catalogHistoryBtn");
    if (catalogHistoryBtn) {
      safeAttachListener(
        catalogHistoryBtn,
        "click",
        () => {
          if (typeof showCatalogHistoryModal === "function") {
            showCatalogHistoryModal();
          }
        },
        "Catalog history button",
      );
    }

    const syncAllBtn = document.getElementById("syncAllBtn");
    if (syncAllBtn) {
      safeAttachListener(
        syncAllBtn,
        "click",
        async () => {
          if (typeof syncProviderChain === "function") {
            const { updatedCount, anySucceeded, results } = await syncProviderChain({ showProgress: true, forceSync: true });
            if (typeof showToast === "function") {
              if (updatedCount > 0) {
                const providerName = Object.entries(results).find(([_, s]) => s === "ok")?.[0];
                const label = providerName ? (API_PROVIDERS[providerName]?.name || providerName) : "API";
                showToast(`\u2713 Synced ${updatedCount} prices from ${label}`);
              } else if (!anySucceeded) {
                showToast("Spot sync failed \u2014 check API settings");
              }
            }
          }
        },
        "Sync all providers button",
      );
    }

    const historyModal = document.getElementById("apiHistoryModal");
    const historyCloseBtn = document.getElementById("apiHistoryCloseBtn");
    if (historyModal) {
      safeAttachListener(
        historyModal,
        "click",
        (e) => {
          if (e.target === historyModal && typeof hideApiHistoryModal === "function") {
            hideApiHistoryModal();
          }
        },
        "API history modal background",
      );
    }
    if (historyCloseBtn) {
      safeAttachListener(
        historyCloseBtn,
        "click",
        () => {
          if (typeof hideApiHistoryModal === "function") {
            hideApiHistoryModal();
          }
        },
        "API history close button",
      );
    }
    const catalogHistoryModal = document.getElementById("catalogHistoryModal");
    const catalogHistoryCloseBtn = document.getElementById("catalogHistoryCloseBtn");
    if (catalogHistoryModal) {
      safeAttachListener(
        catalogHistoryModal,
        "click",
        (e) => {
          if (e.target === catalogHistoryModal && typeof hideCatalogHistoryModal === "function") {
            hideCatalogHistoryModal();
          }
        },
        "Catalog history modal background",
      );
    }
    if (catalogHistoryCloseBtn) {
      safeAttachListener(
        catalogHistoryCloseBtn,
        "click",
        () => {
          if (typeof hideCatalogHistoryModal === "function") {
            hideCatalogHistoryModal();
          }
        },
        "Catalog history close button",
      );
    }

    // ESC key to close modals (sub-modals first, then settings, then others)
    safeAttachListener(
      document,
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          const infoModal = document.getElementById("apiInfoModal");
          const historyModal = document.getElementById("apiHistoryModal");
          const catalogHistModal = document.getElementById("catalogHistoryModal");
          const quotaModal = document.getElementById("apiQuotaModal");
          const bulkEditModal = document.getElementById("bulkEditModal");
          const settingsModal = document.getElementById("settingsModal");
          const itemModal = document.getElementById("itemModal");
          const notesModal = document.getElementById("notesModal");
          const detailsModal = document.getElementById("detailsModal");
          const changeLogModal = document.getElementById("changeLogModal");
          // Close sub-modals (stacking overlays) before settings modal
          if (
            infoModal &&
            infoModal.style.display === "flex" &&
            typeof hideProviderInfo === "function"
          ) {
            hideProviderInfo();
          } else if (
            historyModal &&
            historyModal.style.display === "flex" &&
            typeof hideApiHistoryModal === "function"
          ) {
            hideApiHistoryModal();
          } else if (
            catalogHistModal &&
            catalogHistModal.style.display === "flex" &&
            typeof hideCatalogHistoryModal === "function"
          ) {
            hideCatalogHistoryModal();
          } else if (
            quotaModal &&
            quotaModal.style.display === "flex"
          ) {
            quotaModal.style.display = "none";
          } else if (
            bulkEditModal &&
            bulkEditModal.style.display !== "none" &&
            typeof closeBulkEdit === "function"
          ) {
            closeBulkEdit();
          } else if (
            settingsModal &&
            settingsModal.style.display === "flex" &&
            typeof hideSettingsModal === "function"
          ) {
            hideSettingsModal();
          } else if (
            document.getElementById("spotLookupModal")?.style.display === "flex" &&
            typeof closeSpotLookupModal === "function"
          ) {
            closeSpotLookupModal();
          } else if (itemModal && itemModal.style.display === "flex") {
            itemModal.style.display = "none";
            document.body.style.overflow = "";
            editingIndex = null;
            editingChangeLogIndex = null;
          } else if (notesModal && notesModal.style.display === "flex") {
            notesModal.style.display = "none";
            notesIndex = null;
          } else if (changeLogModal && changeLogModal.style.display === "flex") {
            changeLogModal.style.display = "none";
            document.body.style.overflow = "";
          } else if (
            detailsModal &&
            detailsModal.style.display === "flex" &&
            typeof closeDetailsModal === "function"
          ) {
            closeDetailsModal();
          }
        }
      },
      "ESC key modal close",
    );

    debugLog("✓ API events setup complete");
  } catch (error) {
    console.error("❌ Error setting up API events:", error);
  }
};

// =============================================================================

/** Open the inline Secure-mode password popover below the header cloud button. */
function _openCloudSyncPopover() {
  var popover = safeGetElement('cloudSyncHeaderPopover');
  var input = safeGetElement('cloudSyncPopoverInput');
  var unlockBtn = safeGetElement('cloudSyncPopoverUnlockBtn');
  var cancelBtn = safeGetElement('cloudSyncPopoverCancelBtn');
  var errorEl = safeGetElement('cloudSyncPopoverError');
  if (!popover) return;

  if (input) input.value = '';
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  popover.style.display = '';
  if (input) setTimeout(function () { input.focus(); }, 50);

  function cleanup() {
    popover.style.display = 'none';
    if (unlockBtn) unlockBtn.onclick = null;
    if (cancelBtn) cancelBtn.onclick = null;
    if (input) input.onkeydown = null;
  }

  function onUnlock() {
    var pw = input ? input.value : '';
    if (!pw || pw.length < 8) {
      if (errorEl) {
        errorEl.textContent = 'Password must be at least 8 characters.';
        errorEl.style.display = '';
      }
      return;
    }
    cleanup();
    try { localStorage.setItem('cloud_vault_password', pw); } catch (_) {}
    if (typeof cloudCachePassword === 'function') cloudCachePassword('dropbox', pw);
    if (typeof updateCloudSyncHeaderBtn === 'function') updateCloudSyncHeaderBtn();
    setTimeout(function () { if (typeof pushSyncVault === 'function') pushSyncVault(); }, 100);
  }

  if (unlockBtn) unlockBtn.onclick = onUnlock;
  if (cancelBtn) cancelBtn.onclick = cleanup;
  if (input) {
    input.onkeydown = function (e) {
      if (e.key === 'Enter') onUnlock();
      if (e.key === 'Escape') cleanup();
    };
  }
}

function handleAdvancedSavePassword() {
  var input = safeGetElement('cloudAdvancedNewPassword');
  var errorEl = safeGetElement('cloudAdvancedPasswordError');
  if (!input) return;
  var pw = input.value;
  if (!pw || pw.length < 8) {
    if (errorEl) { errorEl.textContent = 'Password must be at least 8 characters.'; errorEl.style.display = ''; }
    return;
  }
  if (errorEl) errorEl.style.display = 'none';
  input.value = '';
  if (typeof changeVaultPassword === 'function') {
    changeVaultPassword(pw).then(function (ok) {
      if (!ok && errorEl) { errorEl.textContent = 'Failed to update password.'; errorEl.style.display = ''; }
    }).catch(function (err) {
      if (errorEl) { errorEl.textContent = 'An error occurred — try again.'; errorEl.style.display = ''; }
      if (typeof debugLog === 'function') debugLog('[Cloud] changeVaultPassword threw:', err);
    });
  }
}
window.handleAdvancedSavePassword = handleAdvancedSavePassword;

// =============================================================================
// Remove Item modal event listeners (STAK-72)
// =============================================================================

// Checkbox toggles disposition fields + footer buttons
const removeItemDisposeCheck = document.getElementById('removeItemDisposeCheck');
if (removeItemDisposeCheck) {
  removeItemDisposeCheck.addEventListener('change', () => {
    const checked = removeItemDisposeCheck.checked;
    const fields = document.getElementById('removeItemDisposeFields');
    const deleteBtn = document.getElementById('removeItemDeleteBtn');
    const disposeBtn = document.getElementById('removeItemDisposeBtn');
    if (fields) fields.style.display = checked ? '' : 'none';
    if (deleteBtn) deleteBtn.style.display = checked ? 'none' : '';
    if (disposeBtn) disposeBtn.style.display = checked ? '' : 'none';
  });
}

// Delete button (plain delete, no disposition)
const removeItemDeleteBtn = document.getElementById('removeItemDeleteBtn');
if (removeItemDeleteBtn) {
  removeItemDeleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof confirmRemoveItem === 'function') confirmRemoveItem();
  });
}

// Dispose button (disposition flow)
const removeItemDisposeBtn = document.getElementById('removeItemDisposeBtn');
if (removeItemDisposeBtn) {
  removeItemDisposeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (typeof confirmRemoveItem === 'function') confirmRemoveItem();
  });
}

// Disposition type changes show/hide amount field
const dispositionTypeSelect = document.getElementById('dispositionType');
if (dispositionTypeSelect) {
  dispositionTypeSelect.addEventListener('change', () => {
    const typeInfo = DISPOSITION_TYPES[dispositionTypeSelect.value];
    const amountGroup = document.getElementById('dispositionAmountGroup');
    if (amountGroup) amountGroup.style.display = typeInfo?.requiresAmount ? '' : 'none';
    if (!typeInfo || !typeInfo.requiresAmount) {
      const amountInput = document.getElementById('dispositionAmount');
      if (amountInput) amountInput.value = '';
    }
  });
}

// Delete/dispose from edit modal — close edit modal, open remove item modal
const deleteFromEditBtn = document.getElementById('deleteFromEditBtn');
if (deleteFromEditBtn) {
  deleteFromEditBtn.addEventListener('click', () => {
    const idx = typeof editingIndex !== 'undefined' ? editingIndex : null;
    if (idx === null || idx === undefined) return;
    closeModalById('itemModal');
    if (typeof openRemoveItemModal === 'function') openRemoveItemModal(idx, false);
  });
}

// Activity Log link inside remove-item modal
const removeItemOpenLog = document.getElementById('removeItemOpenLog');
if (removeItemOpenLog) {
  removeItemOpenLog.addEventListener('click', (e) => {
    e.preventDefault();
    closeModalById('removeItemModal');
    if (typeof openModalById === 'function') openModalById('changeLogModal');
  });
}

// =============================================================================
// Summary Totals — show/hide realized G/L row (STAK-72)
// =============================================================================

const settingsShowRealized = document.getElementById('settingsShowRealized');
if (settingsShowRealized) {
  // Initialize from stored preference (default: true — show realized)
  const stored = loadDataSync(SHOW_REALIZED_KEY, 'true');
  const showRealized = stored !== 'false';
  settingsShowRealized.checked = showRealized;
  applyRealizedVisibility(showRealized);

  settingsShowRealized.addEventListener('change', () => {
    const show = settingsShowRealized.checked;
    saveData(SHOW_REALIZED_KEY, show ? 'true' : 'false');
    applyRealizedVisibility(show);
  });
}

// =============================================================================

// Early cleanup of stray localStorage entries before application initialization
document.addEventListener('DOMContentLoaded', cleanupStorage);
