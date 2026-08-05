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
    console.warn(`Cannot attach ${event} listener: element not found (${description})`);
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
      console.error(`All event attachment methods failed for ${description}:`, fallbackError);
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
// LOT/EACH TOGGLE FACTORY
// =============================================================================

const createLotEachToggle = (config) => {
  const { toggleId, priceInputId, qtyInputId, eachPlaceholder, lotPlaceholder, roundDisplay } =
    config;
  let mode = "each";
  let userInteracted = false;
  /** @STRK-88 Cache the exact LOT price the user typed, keyed to qty, so LOT→EACH→LOT
   *  can restore the original value without floating-point round-trip drift. */
  let _lotExactPrice = null; // {price: number, qty: number} | null
  /** @STRK-242 Optional qty-source override. When installed (cu by-denomination entry),
   *  qty reads resolve to the coin count instead of #itemQty, which cu forces to 1.
   *  Default null → readQty() reads the DOM qty input exactly as before (byte-identical). */
  let _qtyOverride = null;

  const getButtons = () => {
    const toggle = safeGetElement(toggleId);
    if (!toggle) return [];
    return Array.from(toggle.children).filter((child) => child.dataset?.mode);
  };

  /** @STRK-242 Single qty-source seam — the only place qty is read for conversion/visibility. */
  const readQty = () => (_qtyOverride ? _qtyOverride() : Number(safeGetElement(qtyInputId)?.value));

  const maybeConvert = (nextMode) => {
    const priceEl = safeGetElement(priceInputId);
    if (!priceEl || nextMode === mode) return;

    const rawPrice = priceEl.value.trim();
    const price = Number(rawPrice);
    const qty = readQty();

    if (rawPrice === "" || !Number.isFinite(price) || price <= 0) return;
    if (!Number.isFinite(qty) || qty <= 1) return;

    let convertedPrice;
    if (nextMode === "each") {
      // LOT → EACH: cache the exact lot price before rounding (STRK-88).
      // If a seed already exists for this qty and the displayed price is just the
      // rounded form of the seeded exact total (e.g. from duplicateItem seeding),
      // preserve the exact seeded value rather than replacing it with the rounded
      // display value — otherwise the first toggle discards the precision we seeded.
      const seededForQty = _lotExactPrice !== null && _lotExactPrice.qty === qty;
      const displayedMatchesSeed =
        seededForQty &&
        (() => {
          const rounded =
            typeof roundDisplay === "function"
              ? roundDisplay(_lotExactPrice.price)
              : Number(_lotExactPrice.price.toFixed(6));
          return Math.abs(price - rounded) < 1e-9;
        })();
      if (!displayedMatchesSeed) {
        _lotExactPrice = { price, qty };
      }
      // else: keep the existing seeded exact value — T15 fix
      convertedPrice = price / qty;
    } else {
      // EACH → LOT: restore exact lot price only if qty matches AND user hasn't
      // edited the EACH value since the last LOT→EACH conversion (STRK-88).
      // Without this guard, toggling back after a manual EACH edit would restore
      // the stale cached total instead of computing from the new per-unit price.
      const cacheValid =
        _lotExactPrice !== null &&
        _lotExactPrice.qty === qty &&
        (() => {
          const cachedEach = _lotExactPrice.price / qty;
          const roundedCachedEach =
            typeof roundDisplay === "function"
              ? roundDisplay(cachedEach)
              : Number(cachedEach.toFixed(6));
          return Math.abs(price - roundedCachedEach) < 1e-9;
        })();
      if (cacheValid) {
        convertedPrice = _lotExactPrice.price;
      } else {
        convertedPrice = price * qty;
        _lotExactPrice = null;
      }
    }
    if (!Number.isFinite(convertedPrice) || convertedPrice <= 0) return;

    // Use provided roundDisplay callback (STRK-88 purchase toggle), or fall back to
    // toFixed(6) for disposeAmountToggle which preserves its existing higher-precision behavior.
    // Use .toFixed(digits) to preserve trailing zeros (e.g. 1700.00, not 1700).
    const displayValue =
      typeof roundDisplay === "function"
        ? (() => {
            const rounded = roundDisplay(convertedPrice);
            const digits =
              typeof getCurrencyFractionDigits === "function" ? getCurrencyFractionDigits() : 2;
            return rounded.toFixed(digits);
          })()
        : Number(convertedPrice.toFixed(6)).toString();

    priceEl.value = displayValue;
    priceEl.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const updatePlaceholder = () => {
    const priceEl = safeGetElement(priceInputId);
    if (!priceEl) return;
    priceEl.placeholder = mode === "lot" ? lotPlaceholder : eachPlaceholder;
  };

  const setMode = (nextModeArg, options = {}) => {
    const nextMode = nextModeArg === "lot" ? "lot" : "each";
    const { convertInput = true } = options;

    if (convertInput) {
      maybeConvert(nextMode);
    }

    mode = nextMode;

    getButtons().forEach((button) => {
      const isActive = button.dataset.mode === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    updatePlaceholder();
  };

  const getMode = () => mode;
  const wasInteracted = () => userInteracted;
  const markInteracted = () => {
    userInteracted = true;
  };
  const resetInteracted = () => {
    userInteracted = false;
    // STRK-88: clear exact-lot cache on modal reset/close so stale LOT prices
    // don't bleed across sessions or between add→edit modal openings.
    _lotExactPrice = null;
    // @STRK-242 Intentionally does NOT clear _qtyOverride. The in-restore resetInteracted()
    // (restorePurchasePriceToggle) must not wipe an active denom override; clearing it is a
    // dedicated path (clearQtySource), called explicitly from resetPurchasePriceToggle.
  };

  /** @STRK-242 Install a qty-source override (cu by-denomination → coin count). */
  const setQtySource = (fn) => {
    _qtyOverride = typeof fn === "function" ? fn : null;
  };
  /** @STRK-242 Remove the qty-source override → qty reads fall back to the DOM input. */
  const clearQtySource = () => {
    _qtyOverride = null;
  };

  // Toggle is only meaningful when qty > 1; at qty <= 1 Lot/Each are equivalent
  // so the segmented control is hidden and mode is forced to Each.
  const updateVisibility = () => {
    const toggle = safeGetElement(toggleId);
    if (!toggle) return;

    const qty = readQty();
    const showToggle = Number.isFinite(qty) && qty > 1;

    toggle.classList.toggle("is-hidden", !showToggle);

    if (!showToggle && mode === "lot" && _qtyOverride === null) {
      // STRK-88: for a normal (non-cu) toggle, qty ≤ 1 makes LOT meaningless — revert to
      // EACH and invalidate the exact-lot cache.
      // STRK-242: when a cu qty-override is installed, the by-denomination LOT intent must
      // SURVIVE a transient count ≤ 1 (e.g. mid-typing or a count cleared then re-entered),
      // so we skip the self-revert here. The override is cleared explicitly on type exit /
      // face switch, never via this gate — that keeps a restored EACH item from being
      // flipped to LOT by a later count edit.
      _lotExactPrice = null;
      setMode("each", { convertInput: false });
    }
    updatePlaceholder();
  };

  /**
   * Seeds the exact-lot price cache so callers like editItem can prime the cache
   * when restoring a saved LOT item. This allows the user to toggle EACH→LOT
   * and recover the original unrounded lot total without drift (STRK-88).
   * @param {number} lotPrice - The exact lot total (in display currency)
   * @param {number} qty      - Quantity the lot price corresponds to
   */
  const seedLotCache = (lotPrice, qty) => {
    if (Number.isFinite(lotPrice) && lotPrice > 0 && Number.isFinite(qty) && qty > 1) {
      _lotExactPrice = { price: lotPrice, qty };
    }
  };

  const getExactLotPrice = (displayedLotPrice, qty) => {
    if (_lotExactPrice === null || _lotExactPrice.qty !== qty) return null;
    if (!Number.isFinite(displayedLotPrice) || displayedLotPrice <= 0) return null;
    const round =
      typeof roundDisplay === "function"
        ? roundDisplay
        : (value) => Number(Number(value).toFixed(6));
    return round(_lotExactPrice.price) === round(displayedLotPrice) ? _lotExactPrice.price : null;
  };

  return {
    setMode,
    getMode,
    updateVisibility,
    updatePlaceholder,
    wasInteracted,
    markInteracted,
    resetInteracted,
    setQtySource,
    clearQtySource,
    seedLotCache,
    getExactLotPrice,
  };
};

const purchasePriceToggle = createLotEachToggle({
  toggleId: "purchasePriceModeToggle",
  priceInputId: "itemPrice",
  qtyInputId: "itemQty",
  eachPlaceholder: "Each",
  lotPlaceholder: "Lot total",
  // STRK-88: round display values to active currency precision for purchase prices
  roundDisplay: typeof roundToPricePrecision === "function" ? roundToPricePrecision : null,
});

const resetPurchasePriceToggle = () => {
  purchasePriceToggle.setMode("each", { convertInput: false });
  // @STRK-242 Clear any cu denom qty override BEFORE recomputing visibility, so the reset
  // reads #itemQty (forced to 1 for cu) and correctly hides the toggle.
  purchasePriceToggle.clearQtySource();
  purchasePriceToggle.updateVisibility();
  purchasePriceToggle.resetInteracted();
};

window.resetPurchasePriceToggle = resetPurchasePriceToggle;

// Seeds the lot-price cache for a given lotTotal / qty pair (STRK-88).
// Called by inventory.js editItem after it writes the LOT total to #itemPrice
// so the user can toggle EACH→LOT and recover the exact typed amount.
window.purchasePriceSeedLotCache = (lotPrice, qty) => {
  purchasePriceToggle.seedLotCache(lotPrice, qty);
};

window.purchasePriceGetExactLotPrice = (displayedLotPrice, qty) =>
  purchasePriceToggle.getExactLotPrice(displayedLotPrice, qty);

// Sets toggle to storedMode, defaulting legacy records with no mode to Each.
// Returns true if lot mode is active after visibility resolution (caller may need to adjust price field).
window.restorePurchasePriceToggle = (storedMode, qty) => {
  purchasePriceToggle.setMode(storedMode === "lot" ? "lot" : "each", { convertInput: false });
  purchasePriceToggle.updateVisibility();
  purchasePriceToggle.resetInteracted();
  return purchasePriceToggle.getMode() === "lot" && qty > 1;
};

const disposeAmountToggle = createLotEachToggle({
  toggleId: "removeItemAmountModeToggle",
  priceInputId: "dispositionAmount",
  qtyInputId: "removeItemQty",
  eachPlaceholder: "Each",
  lotPlaceholder: "Lot total",
});

window.disposeAmountToggle = disposeAmountToggle;

// =============================================================================
// STRK-44: Restore-choice modal — Promise-based picker
// =============================================================================

const showRestoreChoice = ({ clone, original, mergedQty }) =>
  new Promise((resolve) => {
    const modal = safeGetElement("restoreChoiceModal");
    const message = safeGetElement("restoreChoiceMessage");
    if (!modal || !message) {
      resolve("cancel");
      return;
    }

    message.textContent =
      `Merge: original goes from ${original.qty} → ${mergedQty}. ` +
      `Separate: ${original.qty} + ${clone.qty} as two rows.`;

    openModalById("restoreChoiceModal");

    const mergeBtn = modal.querySelector('[data-action="merge"]');
    if (mergeBtn) mergeBtn.focus();

    const cleanup = () => {
      closeModalById("restoreChoiceModal");
      document.removeEventListener("keydown", escHandler);
    };

    const escHandler = (e) => {
      if (e.key === "Escape") {
        cleanup();
        resolve("cancel");
      }
    };
    document.addEventListener("keydown", escHandler);

    modal.addEventListener(
      "click",
      (e) => {
        if (e.target === modal) {
          cleanup();
          resolve("cancel");
        }
      },
      { once: true }
    );

    modal.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener(
        "click",
        () => {
          const action = btn.dataset.action;
          cleanup();
          resolve(action);
        },
        { once: true }
      );
    });
  });

window.showRestoreChoice = showRestoreChoice;

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

/** @type {"auto"|"circle"|"rectangle"} Pending obverse frame override */
let _pendingObverseFrame = "auto";
/** @type {"auto"|"circle"|"rectangle"} Pending reverse frame override */
let _pendingReverseFrame = "auto";
/** @type {number} Obverse URL preview generation token */
let _urlPreviewGenObv = 0;
/** @type {number} Reverse URL preview generation token */
let _urlPreviewGenRev = 0;
const _urlPreviewTimers = { obverse: null, reverse: null };

/** @type {{id:number, file:File}[]} Queued attachment entries — written to IDB on item commit (STRK-45, STRK-65) */
let _pendingAttachments = [];
let _pendingAttachmentNextId = 0;

/**
 * Process a user-selected image file and show preview for a specific side.
 * @param {File} file
 * @param {'obverse'|'reverse'} [side='obverse']
 */
const processUploadedImage = async (file, side = "obverse") => {
  if (!file || typeof imageProcessor === "undefined") return;

  const result = await imageProcessor.processFile(file, {
    maxDim: typeof IMAGE_MAX_DIM !== "undefined" ? IMAGE_MAX_DIM : 600,
    maxBytes: typeof IMAGE_MAX_BYTES !== "undefined" ? IMAGE_MAX_BYTES : 512000,
  });

  if (!result?.blob) {
    debugLog(`Image processing failed for ${side}`);
    return;
  }

  const suffix = side === "reverse" ? "Rev" : "Obv";

  if (side === "reverse") {
    _pendingReverseBlob = result.blob;
    if (_pendingReversePreviewUrl) URL.revokeObjectURL(_pendingReversePreviewUrl);
    _pendingReversePreviewUrl = imageProcessor.createPreview(result.blob);
  } else {
    _pendingObverseBlob = result.blob;
    if (_pendingObversePreviewUrl) URL.revokeObjectURL(_pendingObversePreviewUrl);
    _pendingObversePreviewUrl = imageProcessor.createPreview(result.blob);
  }

  const previewUrl = side === "reverse" ? _pendingReversePreviewUrl : _pendingObversePreviewUrl;

  // Show preview in the appropriate side's elements
  const previewContainer = document.getElementById("itemImagePreview" + suffix);
  const previewImg = document.getElementById("itemImagePreviewImg" + suffix);
  const sizeInfo = document.getElementById("itemImageSizeInfo" + suffix);
  const removeBtn = document.getElementById("itemImageRemoveBtn" + suffix);

  if (previewImg && previewUrl) {
    previewImg.src = previewUrl;
    if (previewContainer) previewContainer.style.display = "block";
  }
  if (sizeInfo) {
    const origKB = (result.originalSize / 1024).toFixed(0);
    const compKB = (result.compressedSize / 1024).toFixed(0);
    sizeInfo.textContent = `${origKB} KB → ${compKB} KB (${result.format.split("/")[1]})`;
  }
  if (removeBtn) removeBtn.style.display = "";
  updateSwapButtonVisibility();
};

/** Show/hide swap button based on whether both image sides have previews (STAK-341) */
const updateSwapButtonVisibility = () => {
  const wrapper = document.getElementById("swapImagesBtnWrapper");
  if (!wrapper) return;
  const obvPreview = document.getElementById("itemImagePreviewObv");
  const revPreview = document.getElementById("itemImagePreviewRev");
  const isVisible = (el) => el && !el.classList.contains("d-none") && el.style.display !== "none";
  const bothVisible = isVisible(obvPreview) && isVisible(revPreview);
  wrapper.classList.toggle("d-none", !bothVisible);
};

const _frameSuffix = (side) => (side === "reverse" ? "Rev" : "Obv");
const _getPendingFrame = (side) =>
  side === "reverse" ? _pendingReverseFrame : _pendingObverseFrame;
const _setPendingFrame = (side, value) => {
  const normalized =
    typeof normalizeImageFrame === "function" ? normalizeImageFrame(value) : value || "auto";
  if (side === "reverse") {
    _pendingReverseFrame = normalized;
  } else {
    _pendingObverseFrame = normalized;
  }
};

const _frameToggleLabel = (state) => {
  if (state === "circle") return "Image frame: circle. Press to set rectangle.";
  if (state === "rectangle") return "Image frame: rectangle. Press to reset to auto.";
  return "Image frame: auto (default). Press to set circle.";
};

const _renderFrameToggle = (side = "obverse") => {
  const suffix = _frameSuffix(side);
  const button = document.getElementById("frameToggle" + suffix);
  if (!button) return;
  const state = _getPendingFrame(side);
  const glyph = state === "circle" ? "\u25cb" : state === "rectangle" ? "\u25ad" : "A";
  button.dataset.frameState = state;
  button.setAttribute(
    "aria-pressed",
    state === "rectangle" || state === "circle" ? "true" : "false"
  );
  button.setAttribute("aria-label", _frameToggleLabel(state));
  const label = button.querySelector("span") || button;
  label.textContent = glyph;
};

const renderFrameToggles = () => {
  _renderFrameToggle("obverse");
  _renderFrameToggle("reverse");
};

const setPendingImageFrames = (obverse = "auto", reverse = "auto") => {
  _setPendingFrame("obverse", obverse);
  _setPendingFrame("reverse", reverse);
  renderFrameToggles();
};

const _setUrlPreviewGeneration = (side) => {
  if (side === "reverse") return ++_urlPreviewGenRev;
  return ++_urlPreviewGenObv;
};

const _getUrlPreviewGeneration = (side) =>
  side === "reverse" ? _urlPreviewGenRev : _urlPreviewGenObv;

const _normalizeHttpImageUrl = (value = "") => {
  const trimmed = value.trim();
  if (!/^https?:\/\/.+\..+/i.test(trimmed)) return "";
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : "";
  } catch {
    return "";
  }
};

const previewImageUrlForSide = (side = "obverse", url = "") => {
  const suffix = _frameSuffix(side);
  const preview = document.getElementById("itemImagePreview" + suffix);
  const img = document.getElementById("itemImagePreviewImg" + suffix);
  const removeBtn = document.getElementById("itemImageRemoveBtn" + suffix);
  const sizeInfo = document.getElementById("itemImageSizeInfo" + suffix);
  const imageUrl = _normalizeHttpImageUrl(url || "");
  const gen = _setUrlPreviewGeneration(side);

  if (!preview || !img) return;

  if (!imageUrl) {
    preview.style.display = "none";
    img.removeAttribute("src");
    if (removeBtn) removeBtn.style.display = "none";
    if (sizeInfo) sizeInfo.textContent = "";
    updateSwapButtonVisibility();
    return;
  }

  img.onload = () => {
    if (gen !== _getUrlPreviewGeneration(side)) return;
    preview.style.display = "block";
    if (removeBtn) removeBtn.style.display = "";
    if (sizeInfo) sizeInfo.textContent = "";
    updateSwapButtonVisibility();
  };
  img.onerror = () => {
    if (gen !== _getUrlPreviewGeneration(side)) return;
    preview.style.display = "none";
    img.removeAttribute("src");
    if (removeBtn) removeBtn.style.display = "none";
    if (sizeInfo) sizeInfo.textContent = "Couldn't load image - check the URL";
    updateSwapButtonVisibility();
  };
  img.src = imageUrl;
  preview.style.display = "block";
  if (removeBtn) removeBtn.style.display = "";
  if (sizeInfo) sizeInfo.textContent = "";
  updateSwapButtonVisibility();
};

const scheduleUrlPreview = (side = "obverse") => {
  const field = side === "reverse" ? elements.itemReverseImageUrl : elements.itemObverseImageUrl;
  if (!field) return;
  if (_urlPreviewTimers[side]) clearTimeout(_urlPreviewTimers[side]);
  _urlPreviewTimers[side] = setTimeout(() => {
    previewImageUrlForSide(side, field.value);
  }, 300);
};

/**
 * Track an externally-created preview object URL so it gets revoked
 * when clearUploadState() runs (prevents memory leaks in editItem preview).
 * @param {string} url - Object URL to track
 * @param {'obverse'|'reverse'} [side='obverse']
 */
const setEditPreviewUrl = (url, side = "obverse") => {
  if (side === "reverse") {
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
  _pendingObverseFrame = "auto";
  _pendingReverseFrame = "auto";
  _urlPreviewGenObv++;
  _urlPreviewGenRev++;
  if (_urlPreviewTimers.obverse) clearTimeout(_urlPreviewTimers.obverse);
  if (_urlPreviewTimers.reverse) clearTimeout(_urlPreviewTimers.reverse);
  _urlPreviewTimers.obverse = null;
  _urlPreviewTimers.reverse = null;

  if (_pendingObversePreviewUrl) {
    URL.revokeObjectURL(_pendingObversePreviewUrl);
    _pendingObversePreviewUrl = null;
  }
  if (_pendingReversePreviewUrl) {
    URL.revokeObjectURL(_pendingReversePreviewUrl);
    _pendingReversePreviewUrl = null;
  }

  // Clear obverse side UI
  const previewObv = document.getElementById("itemImagePreviewObv");
  const imgObv = document.getElementById("itemImagePreviewImgObv");
  const sizeObv = document.getElementById("itemImageSizeInfoObv");
  const removeObv = document.getElementById("itemImageRemoveBtnObv");
  const fileObv = document.getElementById("itemImageFileObv");

  if (previewObv) previewObv.style.display = "none";
  if (imgObv) imgObv.src = "";
  if (sizeObv) sizeObv.textContent = "";
  if (removeObv) removeObv.style.display = "none";
  if (fileObv) fileObv.value = "";

  // Clear reverse side UI
  const previewRev = document.getElementById("itemImagePreviewRev");
  const imgRev = document.getElementById("itemImagePreviewImgRev");
  const sizeRev = document.getElementById("itemImageSizeInfoRev");
  const removeRev = document.getElementById("itemImageRemoveBtnRev");
  const fileRev = document.getElementById("itemImageFileRev");

  if (previewRev) previewRev.style.display = "none";
  if (imgRev) imgRev.src = "";
  if (sizeRev) sizeRev.textContent = "";
  if (removeRev) removeRev.style.display = "none";
  if (fileRev) fileRev.value = "";

  // Hide swap button (STAK-341)
  const swapWrapper = document.getElementById("swapImagesBtnWrapper");
  if (swapWrapper) swapWrapper.classList.add("d-none");
  renderFrameToggles();

  // Reset pattern toggle state
  const patternToggle = document.getElementById("imagePatternToggle");
  const patternKeywordsGroup = document.getElementById("imagePatternKeywordsGroup");
  const patternKeywords = document.getElementById("imagePatternKeywords");
  if (patternToggle) patternToggle.checked = false;
  if (patternKeywordsGroup) patternKeywordsGroup.style.display = "none";
  if (patternKeywords) patternKeywords.value = "";
};

/**
 * Validate and queue an attachment file for IDB write on next item commit (STRK-45).
 * Accepted types: PDF, PNG, JPEG. Called by drop/browse handlers and attachment-ui.js.
 * @param {File} file
 */
const queueAttachmentFile = (file) => {
  if (!file) return;
  const ALLOWED = ["application/pdf", "image/png", "image/jpeg"];
  if (!ALLOWED.includes(file.type)) {
    if (typeof showToast === "function")
      showToast(`Unsupported file type: ${file.type || file.name}`);
    return;
  }
  _pendingAttachments.push({ id: _pendingAttachmentNextId++, file });
  if (typeof renderQueuedAttachments === "function") renderQueuedAttachments(_pendingAttachments);
};

/** Clear the pending attachment queue and reset the queued-files UI (STRK-45). */
const clearAttachmentQueue = () => {
  _pendingAttachments = [];
  if (typeof renderQueuedAttachments === "function") renderQueuedAttachments([]);
};

/** Remove a single entry from the queue by its stable id (STRK-65). */
const dequeueAttachment = (entryId) => {
  const idx = _pendingAttachments.findIndex((e) => e.id === entryId);
  if (idx !== -1) _pendingAttachments.splice(idx, 1);
  if (typeof renderQueuedAttachments === "function") renderQueuedAttachments(_pendingAttachments);
};

/**
 * Update Numista API status dot in item modal action bar (STAK-173).
 * Reads catalogConfig.isNumistaEnabled() to set connected/disconnected state.
 * Also updates the parent search button's `title` so the hint is visible
 * before the user clicks (STAK-576 ISSUE-005).
 */
const updateNumistaModalDot = () => {
  const connected =
    typeof catalogConfig !== "undefined" &&
    catalogConfig.isNumistaEnabled &&
    catalogConfig.isNumistaEnabled();
  const NOT_CONFIGURED_TITLE = "Numista API not configured — click to configure";
  document.querySelectorAll(".numista-modal-status-dot").forEach((dot) => {
    dot.classList.toggle("connected", !!connected);
    dot.classList.toggle("disconnected", !connected);
    dot.title = connected ? "Numista API: connected" : NOT_CONFIGURED_TITLE;
    const btn = dot.closest("button");
    if (btn) {
      if (!connected) {
        if (!("originalTitle" in btn.dataset)) {
          btn.dataset.originalTitle = btn.getAttribute("title") || "";
        }
        btn.setAttribute("title", NOT_CONFIGURED_TITLE);
      } else if ("originalTitle" in btn.dataset) {
        btn.setAttribute("title", btn.dataset.originalTitle);
        delete btn.dataset.originalTitle;
      }
    }
  });
};

/**
 * Gate Numista search entry points on an active API key (STAK-576 ISSUE-005).
 * Returns true when a search can proceed. Otherwise shows a themed confirm
 * dialog offering to jump straight to Settings → API and returns false.
 */
const ensureNumistaConfiguredOrPrompt = async () => {
  const configured =
    typeof catalogConfig !== "undefined" &&
    catalogConfig.isNumistaEnabled &&
    catalogConfig.isNumistaEnabled();
  if (configured) return true;
  let openSettings = false;
  if (typeof appConfirm === "function") {
    openSettings = await appConfirm(
      "Numista API key isn't configured. Catalog search needs a free Numista key. Open Settings → API to add one now?",
      "Numista API not configured"
    );
  } else if (typeof appAlert === "function") {
    appAlert(
      "Numista API key isn't configured. Open Settings → API to add a free Numista key.",
      "Numista API not configured"
    );
  }
  if (openSettings && typeof showSettingsModal === "function") {
    showSettingsModal("api");
  }
  return false;
};

/**
 * Request persistent storage the first time a user uploads an image.
 * Stores the browser's response under STORAGE_PERSIST_GRANTED_KEY so the
 * prompt fires at most once per device.
 */
const _requestStoragePersistOnce = async () => {
  if (localStorage.getItem(STORAGE_PERSIST_GRANTED_KEY) !== null) return; // already asked
  if (!navigator?.storage?.persist) {
    localStorage.setItem(STORAGE_PERSIST_GRANTED_KEY, "false");
    return;
  }
  try {
    const granted = await navigator.storage.persist();
    localStorage.setItem(STORAGE_PERSIST_GRANTED_KEY, granted ? "true" : "false");
  } catch {
    localStorage.setItem(STORAGE_PERSIST_GRANTED_KEY, "false");
  }
};

/**
 * Save the pending upload blob(s) to IndexedDB for the given item UUID.
 * @param {string} uuid
 * @returns {Promise<boolean>}
 */
const saveUserImageForItem = async (uuid) => {
  if (!uuid || !window.imageCache?.isAvailable()) {
    debugLog("saveUserImageForItem: invalid uuid or cache unavailable");
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
    debugLog("saveUserImageForItem: no changes to save");
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
    } catch {
      /* ignore */
    }
  }

  const saved = await window.imageCache.cacheUserImageWithFeedback(uuid, obvBlob, revBlob);
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
      debugLog(`Failed to handle partial deletion: ${err}`, "warn");
    }
  }
};

/**
 * Sets up import button(s) and file-input for a single import format.
 * All imports route through the DiffModal for review — no silent override.
 * @param {HTMLElement|null} overrideBtn - Primary "Import" button element
 * @param {HTMLElement|null} mergeBtn - Legacy "Merge" button element (pending removal)
 * @param {HTMLElement|null} fileInput - Hidden file input element
 * @param {Function} importFn - Import function (file, override) => void
 * @param {string} formatName - Human label (e.g. "CSV", "JSON", "Numista CSV")
 */
const setupFormatImport = (overrideBtn, mergeBtn, fileInput, importFn, formatName) => {
  if (overrideBtn && fileInput) {
    safeAttachListener(
      overrideBtn,
      "click",
      () => {
        fileInput.click();
      },
      `${formatName} import button`
    );
  }

  if (mergeBtn && fileInput) {
    safeAttachListener(
      mergeBtn,
      "click",
      () => {
        fileInput.click();
      },
      `${formatName} merge button`
    );
  }

  optionalListener(
    fileInput,
    "change",
    function (e) {
      if (e.target.files.length > 0) {
        const file = e.target.files[0];
        importFn(file, false);
      }
      this.value = "";
    },
    `${formatName} import`
  );
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
    let headerTextSpan = header.querySelector(".header-text");
    if (!headerTextSpan) {
      // Create new header-text span
      headerTextSpan = document.createElement("span");
      headerTextSpan.className = "header-text";
    }

    // Check if the span is empty or needs text
    if (!headerTextSpan.textContent.trim()) {
      // Find the text content (excluding SVG and existing elements)
      const textNodes = Array.from(header.childNodes).filter(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
      );

      if (textNodes.length > 0) {
        // Move text content into the span
        headerTextSpan.textContent = textNodes.map((node) => node.textContent.trim()).join(" ");

        // Remove original text nodes
        textNodes.forEach((node) => node.remove());

        // Insert the span after the SVG icon (if present) if it's not already in the DOM
        if (!header.contains(headerTextSpan)) {
          const svg = header.querySelector("svg");
          if (svg) {
            svg.insertAdjacentElement("afterend", headerTextSpan);
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
        startWidth = parseInt(document.defaultView.getComputedStyle(header).width, 10);

        e.preventDefault();
        e.stopPropagation();

        // Prevent header click event from firing
        header.style.pointerEvents = "none";
        setTimeout(() => {
          header.style.pointerEvents = "auto";
        }, 100);
      },
      "Column resize handle"
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
    "Document mousemove for resizing"
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
    "Document mouseup for resizing"
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
    "Document selectstart for resizing"
  );
};

// RESPONSIVE TABLE HANDLING
// =============================================================================

/**
 * Updates column visibility based on current viewport width
 */
const updateColumnVisibility = () => {
  const width = window.innerWidth;
  const isTouch = window.matchMedia("(pointer: coarse)").matches;
  const desktopCardView = localStorage.getItem(DESKTOP_CARD_VIEW_KEY) === "true";
  const forceCards = desktopCardView || (isTouch && width > 1350 && width <= 1600);

  document.body.classList.toggle("force-card-view", forceCards);

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
  const _imgOn =
    localStorage.getItem("tableImagesEnabled") !== "false" &&
    typeof featureFlags !== "undefined" &&
    featureFlags.isEnabled("COIN_IMAGES");
  if (!_imgOn) hidden.add("image");

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
    "Window resize for column visibility"
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
  const chipMinCountEl = document.getElementById("chipMinCount");
  if (chipMinCountEl) {
    safeAttachListener(
      chipMinCountEl,
      "change",
      (e) => {
        const minCount = parseInt(e.target.value, 10);
        localStorage.setItem("chipMinCount", minCount.toString());
        // Sync settings modal control
        const settingsChipMin = document.getElementById("settingsChipMinCount");
        if (settingsChipMin) settingsChipMin.value = minCount.toString();
        if (typeof renderActiveFilters === "function") {
          renderActiveFilters();
        }
        if (typeof scheduleSyncPush === "function") scheduleSyncPush();
      },
      "Chip minimum count dropdown"
    );
  }

  // Chip maximum count dropdown (inline)
  const chipMaxCountEl = safeGetElement("chipMaxCount");
  if (chipMaxCountEl) {
    safeAttachListener(
      chipMaxCountEl,
      "change",
      (e) => {
        const maxCount = parseInt(e.target.value, 10);
        localStorage.setItem("chipMaxCount", maxCount.toString());
        const settingsChipMax = safeGetElement("settingsChipMaxCount");
        if (settingsChipMax) settingsChipMax.value = maxCount.toString();
        if (typeof renderActiveFilters === "function") renderActiveFilters();
        if (typeof scheduleSyncPush === "function") scheduleSyncPush();
      },
      "Chip max count select"
    );
  }

  // Grouped name chips toggle (inline) — uses global helper from settings.js
  const groupNameChipsEl = document.getElementById("groupNameChips");
  if (groupNameChipsEl && window.featureFlags) {
    // Set initial state from feature flag
    const initVal = window.featureFlags.isEnabled("GROUPED_NAME_CHIPS") ? "yes" : "no";
    groupNameChipsEl.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === initVal);
    });
  }
  if (typeof wireFeatureFlagToggle === "function") {
    wireFeatureFlagToggle("groupNameChips", "GROUPED_NAME_CHIPS", {
      syncId: "settingsGroupNameChips",
      onApply: () => {
        if (typeof renderActiveFilters === "function") renderActiveFilters();
      },
    });
  }

  // Chip sort order inline toggle — uses global helper from settings.js
  const chipSortEl = document.getElementById("chipSortOrder");
  if (chipSortEl) {
    // Restore saved value on setup (migrate 'default' → 'alpha')
    const savedSort = localStorage.getItem("chipSortOrder");
    const activeSort = savedSort === "count" ? "count" : "alpha";
    chipSortEl.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sort === activeSort);
    });
  }
  if (typeof wireChipSortToggle === "function") {
    wireChipSortToggle("chipSortOrder", "settingsChipSortOrder");
  }

  // Disposed filter three-state toggle (STAK-388, STAK-470)
  // Migration shim: pre-v3.33.69 stored raw strings ("hide"/"show"/"only") via
  // localStorage.setItem. loadDataSync JSON.parse fails on these, silently
  // resetting to default. Detect raw strings and re-encode via saveDataSync.
  const _rawDisposed = localStorage.getItem("disposedFilterMode");
  let savedDisposedMode = "hide";
  if (_rawDisposed === "hide" || _rawDisposed === "show" || _rawDisposed === "only") {
    savedDisposedMode = _rawDisposed;
    if (typeof saveDataSync === "function") saveDataSync("disposedFilterMode", _rawDisposed);
  } else if (typeof loadDataSync === "function") {
    savedDisposedMode = loadDataSync("disposedFilterMode", "hide") || "hide";
  }
  document.querySelectorAll("#disposedFilterGroup .chip-sort-btn").forEach(function (b) {
    b.classList.toggle("active", b.dataset.disposedMode === savedDisposedMode);
  });
  const dfg = safeGetElement("disposedFilterGroup");
  dfg.addEventListener("click", function (e) {
    const btn = e.target.closest(".chip-sort-btn");
    if (!btn) return;
    document.querySelectorAll("#disposedFilterGroup .chip-sort-btn").forEach(function (b) {
      b.classList.remove("active");
    });
    btn.classList.add("active");
    if (typeof saveDataSync === "function")
      saveDataSync("disposedFilterMode", btn.dataset.disposedMode);
    if (typeof renderTable === "function") renderTable();
    if (typeof renderActiveFilters === "function") renderActiveFilters();
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
    safeAttachListener(elements.appLogo, "click", () => window.location.reload(), "App Logo");
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
      "Settings Button"
    );
  }

  // Cloud Sync header button retired (STRK-287). Unlike the other retirements
  // this listener was dual-action: syncNow() when resolveHeaderCloudAction()
  // reported green/ready, else showSettingsModal("cloud"). Both destinations
  // survive in Settings › Cloud — #cloudSyncNowBtn runs the manual sync, and
  // the panel itself is the setup entry point — so no capability moved, only
  // the shortcut went away.
  //
  // The "close popover on outside click" mousedown handler went with it. It
  // only ever guarded #cloudSyncHeaderPopover, which was already unreachable
  // (see the _openCloudSyncPopover note below).

  // About button retired (STRK-289) — its handler was only
  // showSettingsModal("about"), and About is the default settings panel, so
  // opening Settings already lands there.

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
        `Totals title (${title.dataset.metal})`
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
      "Close details modal"
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
        `Table header ${index}`
      );
    });
  } else {
    console.error("Inventory table not found for sorting setup!");
  }

  // GOLDBACK DENOMINATION PICKER TOGGLE (STACK-45)
  // Swaps weight text input ↔ denomination select when unit changes to/from 'gb'.
  // Auto-fills hidden weight value from the selected denomination.
  const showEl = (el, visible) => {
    if (el) el.style.display = visible ? "" : "none";
  };
  /**
   * Toggles the visible input between weight and goldback denomination.
   * Auto-fills hidden weight value from the selected denomination when in 'gb' mode.
   */
  window.toggleGbDenomPicker = () => {
    const isGb = elements.itemWeightUnit?.value === "gb";
    const isSb = elements.itemWeightUnit?.value === "sb";
    const denomSelect = elements.itemGbDenom;
    const weightInput = elements.itemWeight;
    const weightLabel = document.getElementById("itemWeightLabel");

    showEl(denomSelect, isGb);
    showEl(weightInput, !isGb);
    if (isGb && weightInput && denomSelect) weightInput.value = denomSelect.value;
    if (weightLabel) {
      weightLabel.textContent = isGb ? "DENOMINATION" : isSb ? "Silverback Units" : "Weight";
      weightLabel.setAttribute("for", isGb ? "itemGbDenom" : "itemWeight");
    }
  };

  /**
   * Constitutional / junk-silver group toggle (STRK-235). When the unit is `cu`, hides
   * the entire standard Purity/Quantity/Weight/Unit row and reveals the constitutional
   * control group (denomination↔face); otherwise restores the standard row. Runs after
   * toggleGbDenomPicker in handleTypeChange so it owns the row visibility for the `cu`
   * case. Refreshes the live silver preview when shown.
   * @returns {void}
   */
  window.toggleConstitutionalGroup = () => {
    const isCu = elements.itemWeightUnit?.value === "cu";
    // STRK-235: the entire standard Purity/Qty/Weight/Unit row is REPLACED wholesale
    // by the constitutional card (per the approved prototype) — not hidden cell-by-cell.
    // gb/sb keep the standard row (toggleGbDenomPicker swaps weight↔denom within it).
    showEl(document.getElementById("standardMeasureRow"), !isCu);
    showEl(document.getElementById("item-constitutional-group"), isCu);
    if (isCu && typeof window.constitutionalUpdatePreview === "function") {
      window.constitutionalUpdatePreview();
    }
  };
};

// FORM SUBMIT HELPERS (STACK-61)
// =============================================================================

/**
 * Parses weight from form input, handling Goldback denominations,
 * fractions, and gram-to-troy-oz conversion.
 * @param {string} weightRaw - Raw weight input value
 * @param {string} weightUnit - Unit: 'oz', 'g', 'kg', 'lb', 'gb', or 'sb'
 * @param {boolean} isEditing - Whether in edit mode
 * @param {Object} existingItem - Existing item (edit mode)
 * @returns {number} Weight in troy ounces (or denomination value for gb)
 */
const parseWeight = (weightRaw, weightUnit, isEditing, existingItem) => {
  if (isEditing && weightRaw === "") {
    return typeof existingItem.weight !== "undefined" ? existingItem.weight : 0;
  }
  let weight = parseFraction(weightRaw);
  if (weightUnit === "g") {
    weight = gramsToOzt(weight);
  } else if (weightUnit === "mg") {
    weight = mgToOzt(weight); // STRK-319
  } else if (weightUnit === "kg") {
    weight = kgToOzt(weight);
  } else if (weightUnit === "lb") {
    weight = lbToOzt(weight);
  }
  // gb/sb: weight stays as raw denomination value (conversion happens in computeMeltValue)
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
  if (isEditing && rawValue === "") {
    return typeof existingValue !== "undefined" ? existingValue : 0;
  }
  let entered = rawValue === "" ? 0 : parseFloat(rawValue);
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
  if (puritySelect && puritySelect.value === "custom") {
    return elements.itemPurity ? parseFloat(elements.itemPurity.value) || 1.0 : 1.0;
  }
  if (puritySelect) {
    return parseFloat(puritySelect.value) || 1.0;
  }
  return isEditing ? existingItem.purity || 1.0 : 1.0;
};

/**
 * STRK-235: Reads the constitutional/junk-silver entry controls and returns the
 * stored item shape (inputs only — never derived ounces). Denomination mode stores
 * the variant id + per-coin face in `weight` + coin count in `qty`; face mode stores
 * the total face value in `weight`, qty 1, and the "con-90-subsidiary" sentinel.
 * @returns {{mode:string, variant:string, weight:number, qty:number}}
 */
const parseConstitutionalFields = () => {
  const mode =
    typeof window.constitutionalGetEntryMode === "function"
      ? window.constitutionalGetEntryMode()
      : "denom";
  if (mode === "face") {
    const faceEl = safeGetElement("item-constitutional-face");
    const face = faceEl ? parseFloat(faceEl.value) : NaN;
    return {
      mode: "face",
      variant: "con-90-subsidiary",
      weight: Number.isFinite(face) && face >= 0 ? parseFloat(face.toFixed(6)) : 0,
      qty: 1,
    };
  }
  const variantEl = safeGetElement("item-constitutional-variant");
  const variantId = variantEl?.value || "";
  const variant =
    typeof CONSTITUTIONAL_VARIANTS !== "undefined"
      ? CONSTITUTIONAL_VARIANTS.find((v) => v.id === variantId)
      : null;
  const countEl = safeGetElement("item-constitutional-count");
  const count = countEl ? parseInt(countEl.value, 10) : NaN;
  return {
    mode: "denom",
    variant: variantId,
    weight: variant ? variant.facePerCoin : 0,
    qty: Number.isFinite(count) && count > 0 ? count : 0,
  };
};

/**
 * STRK-242: resolves the per-unit price string from the entered price for LOT-mode
 * purchases. Extracted from parseItemFormFields to keep that function under the Codacy
 * Lizard ccn gate. Behavior:
 *   - EACH mode or empty input → unchanged.
 *   - Non-cu LOT → divide the entered lot total by #itemQty (existing STRK-88 behavior).
 *   - cu by-DENOMINATION LOT → divide by the coin count (cu.qty), keyed to the STRK-88
 *     exact-lot cache on cu.qty so an uneven division round-trips without drift (AC-3/AC-4).
 *   - cu by-FACE-value → never divide; a face entry is a lot of one (AC-6, re-scoped
 *     STRK-235 guard). (Face also forces the toggle to EACH, so this is belt-and-suspenders.)
 * @param {string} priceInput - raw entered price string
 * @param {number} parsedQty  - #itemQty (pinned to 1 for cu items)
 * @param {{mode:string, qty:number}|null} cu - parsed constitutional fields, or null
 * @returns {string} the per-unit (or unchanged) price string
 */
const resolveLotEachPriceInput = (priceInput, parsedQty, cu) => {
  if (purchasePriceToggle.getMode() !== "lot" || priceInput === "") return priceInput;
  if (cu && cu.mode === "face") return priceInput; // AC-6: face never divides
  const divisorQty = cu ? cu.qty : parsedQty; // AC-3: cu divides by coin count, not #itemQty
  if (!(divisorQty > 0)) return cu ? priceInput : "0";
  const rawInput = parseFloat(priceInput) || 0;
  const exactLotPrice =
    typeof purchasePriceToggle.getExactLotPrice === "function"
      ? purchasePriceToggle.getExactLotPrice(rawInput, divisorQty)
      : null;
  const lotPrice = exactLotPrice ?? rawInput;
  return String(lotPrice / divisorQty);
};

/**
 * Reads all form fields and returns a parsed fields object.
 * @param {boolean} isEditing - Whether in edit mode
 * @param {Object} existingItem - Existing item (edit mode)
 * @returns {Object} Parsed field values
 */
const parseItemFormFields = (isEditing, existingItem) => {
  // STAK-580: capture raw select values BEFORE getCompositionFirstWords/parseNumistaMetal
  // coerce empty Metal -> "Alloy", which would otherwise pass the truthy `!f.metal` gate.
  const rawMetal = elements.itemMetal.value;
  const rawType = elements.itemType.value;
  const composition = getCompositionFirstWords(elements.itemMetal.value);
  const metal = parseNumistaMetal(composition);
  const fxRate = typeof getExchangeRate === "function" ? getExchangeRate() : 1;

  const nameInput = elements.itemName.value.trim();
  const qtyInput = elements.itemQty.value.trim();
  const parsedQty = qtyInput === "" ? (isEditing ? existingItem.qty || 1 : 1) : Number(qtyInput);
  let priceInput = elements.itemPrice.value.trim();

  // STRK-235/242: constitutional items derive weight/qty/variant from the dedicated
  // control card (the raw weight/qty inputs are hidden). Parse cu BEFORE the price
  // division so a by-denomination lot total divides by the coin count (cu.qty), not the
  // stale #itemQty (pinned to 1 for cu); face value is a lot of one and never divides.
  const isCuUnit = elements.itemWeightUnit?.value === "cu";
  const cu = isCuUnit ? parseConstitutionalFields() : null;
  priceInput = resolveLotEachPriceInput(priceInput, parsedQty, cu);

  const weightUnit = elements.itemWeightUnit.value;
  const weightRaw =
    weightUnit === "gb" && elements.itemGbDenom
      ? elements.itemGbDenom.value
      : elements.itemWeight.value;
  // cu (constitutional fields) was parsed above, before the price division (STRK-242).

  const marketValueInput = elements.itemMarketValue ? elements.itemMarketValue.value.trim() : "";
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
    // STAK-580: surfaced for validateItemFields so empty selects are caught
    // before parseNumistaMetal's "Alloy" coercion masks them as truthy.
    _rawMetal: rawMetal,
    _rawType: rawType,
    _rawQty: qtyInput,
    _isEditing: isEditing,
    name: isEditing ? nameInput || existingItem.name || "" : nameInput,
    qty: cu ? cu.qty : parsedQty,
    type: elements.itemType.value || (isEditing ? existingItem.type : ""),
    weight: cu ? cu.weight : parseWeight(weightRaw, weightUnit, isEditing, existingItem),
    weightUnit,
    // STRK-235: present only for constitutional ("cu") items.
    constitutionalEntryMode: cu ? cu.mode : undefined,
    constitutionalVariant: cu ? cu.variant : undefined,
    price: parsePriceToUSD(priceInput, fxRate, isEditing, existingItem.price),
    paymentMethod: elements.itemPaymentMethod?.value?.trim() ?? "",
    purchaseLocation: elements.purchaseLocation.value.trim(),
    storageLocation: elements.storageLocation.value.trim(),
    serialNumber: elements.itemSerialNumber?.value?.trim() ?? "",
    notes: elements.itemNotes.value.trim(),
    capsule: elements.itemCapsule?.value?.trim() ?? "",
    capsuleNotes: elements.itemCapsuleNotes?.value?.trim() ?? "",
    date: elements.itemDateNABtn?.classList.contains("active")
      ? ""
      : elements.itemDate.value || (isEditing ? existingItem.date || "" : todayStr()),
    // STRK-242 (D-5/AC-7): cu items derive pricingType from the FINAL toggle/entry-mode
    // state and persist it UNCONDITIONALLY — a programmatic denom→LOT default (set by the
    // handler, not a user click) must survive edit-save, so it cannot be gated on
    // wasInteracted(). Non-cu items keep the existing interaction-gated logic: new items
    // capture toggle state; edited items preserve stored pricingType unless the user
    // interacted with the toggle this session (legacy absence → lot-total chart).
    pricingType: cu
      ? purchasePriceToggle.getMode()
      : !isEditing
        ? purchasePriceToggle.getMode()
        : purchasePriceToggle.wasInteracted()
          ? purchasePriceToggle.getMode()
          : existingItem.pricingType,
    catalog: elements.itemCatalog ? elements.itemCatalog.value.trim() : "",
    year: elements.itemYear?.value?.trim() ?? "",
    grade: elements.itemGrade?.value?.trim() ?? "",
    gradingAuthority: elements.itemGradingAuthority?.value?.trim() ?? "",
    certNumber: elements.itemCertNumber?.value?.trim() ?? "",
    pcgsNumber: elements.itemPcgsNumber?.value?.trim() ?? "",
    marketValue,
    // STRK-245: a cu item derives its valuation from the variant, not purity — never
    // persist a "custom" form value onto it (meaningless, and it would resurface if the
    // item is later converted back to a normal type). This is where the constitutional
    // purity reset actually lands, so backing out before saving keeps the original value.
    purity:
      cu && elements.itemPuritySelect?.value === "custom"
        ? 0.999
        : parsePurity(isEditing, existingItem),
    currency: displayCurrency,
    obverseImageFrame: _pendingObverseFrame,
    reverseImageFrame: _pendingReverseFrame,
    obverseImageUrl: elements.itemObverseImageUrl?.value?.trim() ?? "",
    reverseImageUrl: elements.itemReverseImageUrl?.value?.trim() ?? "",
    ignorePatternImages: document.getElementById("itemIgnorePatternImages")?.checked || false,
    // Numista metadata — stored per-item, seeded by API, user edits override
    // Pass catalog so parseNumistaDataFields can wipe metadata when N# is cleared (STAK-309)
    numistaData: parseNumistaDataFields(
      isEditing,
      existingItem,
      elements.itemCatalog ? elements.itemCatalog.value.trim() : ""
    ),
  };
};

/**
 * Read Numista Data form fields into a flat object.
 * Only stores non-empty values to keep items lean.
 * @param {boolean} isEditing
 * @param {Object} existingItem
 * @returns {Object} Numista data fields with source tracking
 */
const parseNumistaDataFields = (isEditing, existingItem, catalog = "") => {
  const prev = isEditing && existingItem?.numistaData ? existingItem.numistaData : {};

  // STAK-487: Respect intentional clearing — if the form element exists, trust its
  // value (even empty string). Only fall back to previous data when the element is
  // absent from the DOM. Previous || fallback treated '' as falsy, making it
  // impossible for users to clear metadata fields.
  const getOrPrev = (id, prevVal) => {
    const el = safeGetElement(id);
    return el ? el.value.trim() : (prevVal ?? "");
  };

  const fields = {
    country: getOrPrev("numistaCountry", prev.country),
    denomination: getOrPrev("numistaDenomination", prev.denomination),
    composition: getOrPrev("numistaComposition", prev.composition),
    shape: getOrPrev("numistaShape", prev.shape),
    diameter: getOrPrev("numistaDiameter", prev.diameter),
    thickness: getOrPrev("numistaThickness", prev.thickness),
    length: getOrPrev("numistaLength", prev.length),
    width: getOrPrev("numistaWidth", prev.width),
    orientation: getOrPrev("numistaOrientation", prev.orientation),
    technique: getOrPrev("numistaTechnique", prev.technique),
    mintage: getOrPrev("numistaMintage", prev.mintage),
    rarityIndex: getOrPrev("numistaRarity", prev.rarityIndex),
    kmRef: getOrPrev("numistaKmRef", prev.kmRef),
    commemorative: (() => {
      const el = safeGetElement("numistaCommemorative");
      return el ? el.checked : (prev.commemorative ?? false);
    })(),
    commemorativeDesc: getOrPrev("numistaCommemorativeDesc", prev.commemorativeDesc),
    obverseDesc: getOrPrev("numistaObverseDesc", prev.obverseDesc),
    reverseDesc: getOrPrev("numistaReverseDesc", prev.reverseDesc),
    edgeDesc: getOrPrev("numistaEdgeDesc", prev.edgeDesc),
  };

  // Track data source: 'user' if any field was manually changed from the API value,
  // 'api' if purely from cache, or preserve existing source
  fields.source = prev.source || "api";
  fields.updatedAt = Date.now();

  // Strip empty fields to keep storage lean
  const result = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== "" && v !== false && v !== 0) result[k] = v;
  }
  return result;
};

/**
 * Validates mandatory item fields.
 * @param {Object} f - Parsed fields from parseItemFormFields()
 * @returns {string|null} Error message or null if valid
 */
const validateItemFields = (f) => {
  // STAK-580: explicit check on raw select values for the Add path. The downstream
  // `!f.metal` gate is bypassed by parseNumistaMetal coercing "" -> "Alloy"; the
  // raw check closes that hole and also covers `requestSubmit()` flows that skip
  // HTML5 native validation. Edit path stays permissive — editItem populates the
  // selects from existing data so this should never trigger there.
  if (!f._isEditing && (!f._rawMetal || !f._rawType)) {
    return "Please select a Metal and Type before saving.";
  }
  if (purchasePriceToggle.getMode() === "lot") {
    const rawQty = f._rawQty?.trim() ?? "";
    const lotQty = rawQty === "" ? NaN : Number(rawQty);
    if (rawQty === "" || isNaN(lotQty) || !Number.isInteger(lotQty) || lotQty <= 0) {
      return "Lot mode requires a quantity of at least 1.";
    }
  }
  if (
    !f.name ||
    !f.type ||
    !f.metal ||
    isNaN(f.weight) ||
    f.weight <= 0 ||
    isNaN(f.qty) ||
    f.qty < 1 ||
    !Number.isInteger(f.qty)
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
const buildItemFields = (f) => {
  const fields = {
    metal: f.metal,
    composition: f.composition,
    name: f.name,
    qty: f.qty,
    type: f.type,
    weight: f.weight,
    weightUnit: f.weightUnit,
    price: f.price,
    marketValue: f.marketValue,
    date: f.date,
    paymentMethod: f.paymentMethod,
    purchaseLocation: f.purchaseLocation,
    storageLocation: f.storageLocation,
    serialNumber: f.serialNumber,
    notes: f.notes,
    capsule: f.capsule,
    capsuleNotes: f.capsuleNotes,
    year: f.year,
    grade: f.grade,
    gradingAuthority: f.gradingAuthority,
    certNumber: f.certNumber,
    pcgsNumber: f.pcgsNumber,
    purity: f.purity,
  };

  if (f.pricingType !== undefined) {
    fields.pricingType = f.pricingType;
  }
  // STRK-235: persist constitutional entry mode + variant for cu items.
  if (f.weightUnit === "cu") {
    fields.constitutionalEntryMode = f.constitutionalEntryMode || "denom";
    fields.constitutionalVariant = f.constitutionalVariant || "con-90-subsidiary";
  }
  if (f.obverseImageFrame && f.obverseImageFrame !== "auto") {
    fields.obverseImageFrame = f.obverseImageFrame;
  }
  if (f.reverseImageFrame && f.reverseImageFrame !== "auto") {
    fields.reverseImageFrame = f.reverseImageFrame;
  }

  return fields;
};

/**
 * STRK-244: True if any price/valuation-relevant field differs between two item
 * snapshots — the gate for recording a single-edit price-history point. Beyond the
 * legacy marketValue/price/weight/qty/metal/purity set it samples `weightUnit` and
 * the constitutional metadata (constitutionalVariant/constitutionalEntryMode): a
 * junk-silver denomination swap (e.g. con-90-half→con-40-half — identical facePerCoin,
 * so `weight` is unchanged) or a Type→cu/gb/sb coercion changes the derived melt
 * without touching any legacy field, and would otherwise leave the value chart stale.
 * Keep this set in sync with recordBulkPriceHistory's priceFields (js/bulkEdit.js) —
 * both are STRK-244 valuation-change detection sites.
 * @param {Object} oldItem - Pre-edit item snapshot.
 * @param {Object} newItem - Post-edit item.
 * @returns {boolean} True when a valuation-relevant field changed.
 */
const valuationFieldChanged = (oldItem, newItem) => {
  const fields = [
    "marketValue",
    "price",
    "weight",
    "qty",
    "metal",
    "purity",
    "weightUnit",
    "constitutionalVariant",
    "constitutionalEntryMode",
  ];
  return fields.some((field) => oldItem?.[field] !== newItem?.[field]);
};

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
      debugLog(
        `commitItemToInventory: N# changed from ${oldItem.numistaId} to ${f.catalog}, clearing old cache`
      );
      imageCache
        .deleteImages(oldItem.numistaId)
        .catch((err) =>
          debugLog(
            `commitItemToInventory: Failed to clear old Numista images: ${err.message}`,
            "warn"
          )
        );
      imageCache
        .deleteMetadata(oldItem.numistaId)
        .catch((err) =>
          debugLog(
            `commitItemToInventory: Failed to clear old Numista metadata: ${err.message}`,
            "warn"
          )
        );
    }

    inventory[editIdx] = {
      ...oldItem,
      ...buildItemFields(f),
      numistaId: f.catalog,
      numistaData: f.numistaData,
      fieldMeta: oldItem.fieldMeta || f.numistaData?.fieldMeta || undefined,
      currency: f.currency,
      lastModified: new Date().toISOString(),
      // STAK-308: Use nullish coalescing — empty string is intentional (user cleared URL)
      obverseImageUrl:
        f.obverseImageUrl !== ""
          ? f.obverseImageUrl || window.selectedNumistaResult?.imageUrl || ""
          : "",
      reverseImageUrl:
        f.reverseImageUrl !== ""
          ? f.reverseImageUrl || window.selectedNumistaResult?.reverseImageUrl || ""
          : "",
      obverseSharedImageId: oldItem.obverseSharedImageId || null,
      reverseSharedImageId: oldItem.reverseSharedImageId || null,
      ignorePatternImages: f.ignorePatternImages || false,
    };
    if (f.obverseImageFrame === "auto") delete inventory[editIdx].obverseImageFrame;
    if (f.reverseImageFrame === "auto") delete inventory[editIdx].reverseImageFrame;
    if (!f.paymentMethod) delete inventory[editIdx].paymentMethod;

    // Track user-modified fields by comparing old vs new values
    if (typeof window.markUserModified === "function") {
      const cur = inventory[editIdx];
      const trackedFields = [
        "metal",
        "composition",
        "name",
        "qty",
        "type",
        "weight",
        "weightUnit",
        "constitutionalVariant",
        "constitutionalEntryMode",
        "price",
        "marketValue",
        "date",
        "paymentMethod",
        "purchaseLocation",
        "storageLocation",
        "serialNumber",
        "notes",
        "capsule",
        "capsuleNotes",
        "year",
        "grade",
        "gradingAuthority",
        "certNumber",
        "pcgsNumber",
        "purity",
        "country",
        "denomination",
        "shape",
        "diameter",
        "thickness",
        "length",
        "width",
        "orientation",
        "description",
        "technique",
      ];
      for (const field of trackedFields) {
        if (oldItem[field] !== cur[field]) {
          window.markUserModified(cur, field);
        }
      }
      // Track user-edited Numista Data tab fields (STRK-51)
      const numistaTrackedFields = [
        "country",
        "denomination",
        "composition",
        "shape",
        "diameter",
        "length",
        "width",
        "thickness",
        "orientation",
        "technique",
        "mintage",
        "rarityIndex",
        "kmRef",
        "commemorative",
        "commemorativeDesc",
        "obverseDesc",
        "reverseDesc",
        "edgeDesc",
      ];
      const oldNumista = oldItem.numistaData || {};
      const newNumista = cur.numistaData || {};
      for (const field of numistaTrackedFields) {
        if (oldNumista[field] !== newNumista[field]) {
          window.markUserModified(cur, field);
        }
      }
    }

    addCompositionOption(f.composition);
    if (typeof registerCapsule === "function") registerCapsule(f.capsule);

    try {
      // STAK-302: always sync the mapping — pass '' when N# is cleared so
      // setCatalogId deletes the stale serial entry and prevents repopulation on reload
      if (window.catalogManager) {
        catalogManager.setCatalogId(serial, inventory[editIdx].numistaId || "");
      }
    } catch (catErr) {
      console.warn("Failed to update catalog mapping:", catErr);
    }

    // Apply spot lookup override if user selected a historical spot (STACK-49)
    const lookupSpotEdit = elements.itemSpotPrice ? parseFloat(elements.itemSpotPrice.value) : NaN;
    if (!isNaN(lookupSpotEdit) && lookupSpotEdit > 0) {
      inventory[editIdx].spotPriceAtPurchase = lookupSpotEdit;
    }

    saveInventory();

    // Record price data point if price-related fields changed (STACK-43)
    if (typeof recordSingleItemPrice === "function") {
      const cur = inventory[editIdx];
      // STRK-244: gate on the full valuation field set (incl. weightUnit + the
      // constitutional metadata) so denomination/variant swaps and Type→cu/gb/sb
      // coercions — which leave the legacy fields untouched — still record a point.
      if (valuationFieldChanged(oldItem, cur)) recordSingleItemPrice(cur, "edit");
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
    const spotPriceAtPurchase =
      !isNaN(lookupSpot) && lookupSpot > 0 ? lookupSpot : (spotPrices[metalKey] ?? 0);
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
      lastModified: new Date().toISOString(),
      obverseImageUrl:
        f.obverseImageUrl !== ""
          ? f.obverseImageUrl || window.selectedNumistaResult?.imageUrl || ""
          : "",
      reverseImageUrl:
        f.reverseImageUrl !== ""
          ? f.reverseImageUrl || window.selectedNumistaResult?.reverseImageUrl || ""
          : "",
      obverseSharedImageId: null,
      reverseSharedImageId: null,
      ignorePatternImages: f.ignorePatternImages || false,
    });
    if (!f.paymentMethod) delete inventory[inventory.length - 1].paymentMethod;

    typeof registerName === "function" && registerName(f.name);
    if (typeof registerCapsule === "function") registerCapsule(f.capsule);
    addCompositionOption(f.composition);

    if (window.catalogManager && f.catalog) {
      catalogManager.setCatalogId(serial, f.catalog);
    }

    if (typeof clearInventoryRecovery === "function") clearInventoryRecovery();
    if (typeof debugLog === "function") debugLog("inventoryRecovery: cleared by addItem");
    saveInventory();

    // Log the add action to the changelog (BUG-004)
    const addedItem = inventory[inventory.length - 1];
    const addSummary = [
      addedItem.metal,
      addedItem.type,
      addedItem.name,
      typeof formatWeight === "function"
        ? formatWeight(addedItem.weight, addedItem.weightUnit)
        : addedItem.weight + " oz",
      typeof formatCurrency === "function"
        ? formatCurrency(addedItem.price)
        : "$" + Number(addedItem.price).toFixed(2),
    ]
      .filter(Boolean)
      .join(" · ");
    logChange(addedItem.name, "Added", "", addSummary, inventory.length - 1);

    // STRK-84: consume pending picker snapshot to apply tags for new Add Item
    const snap = window.pendingNumistaPickerSnapshot;
    if (snap && typeof applyNumistaTags === "function") {
      const newUuid = addedItem.uuid;
      if (snap.resultId === f.catalog) {
        if (snap.checked.length > 0) {
          applyNumistaTags(newUuid, snap.checked, true, true);
        }
        if (snap.removed.length > 0 && typeof addRemovedTag === "function") {
          snap.removed.forEach((tag) => addRemovedTag(newUuid, tag));
        }
      }
      window.pendingNumistaPickerSnapshot = null;
    }

    const pendingTags = getPendingAddItemTags();
    if (
      pendingTags.length > 0 &&
      addedItem.uuid &&
      typeof addItemTag === "function" &&
      typeof saveItemTags === "function"
    ) {
      let addedTags = false;
      pendingTags.forEach((tag) => {
        if (addItemTag(addedItem.uuid, tag, false)) addedTags = true;
      });
      if (addedTags && typeof stampTagTimestamp === "function") {
        stampTagTimestamp([addedItem.uuid]);
      }
      saveItemTags();
      window.pendingAddItemTags = [];
    }

    // Record initial price data point (STACK-43)
    if (typeof recordSingleItemPrice === "function") {
      recordSingleItemPrice(addedItem, "add");
    }

    renderTable();

    // Success toast (UX-002)
    if (typeof showToast === "function") {
      showToast("\u2713 " + addedItem.name + " added to inventory");
    }
  }
  const committed = isEditing ? inventory[editIdx] : inventory[inventory.length - 1];
  window.__lastCommittedItemUuid = committed?.uuid;
  if (!isEditing && window.__tradeAddNewPending && committed?.uuid) {
    window.addPendingTradeLinkUuid?.(committed.uuid);
    window.__tradeAddNewPending = false;
    const itemModal = document.getElementById("itemModal");
    if (itemModal) itemModal.style.zIndex = "";
  }
  if (!isEditing && window.__tradeEditAddNewPending && committed?.uuid) {
    const editUuids = window.__tradeEditUuids;
    if (Array.isArray(editUuids) && !editUuids.includes(committed.uuid)) {
      editUuids.push(committed.uuid);
    }
    if (typeof window.__tradeEditRenderChips === "function") {
      window.__tradeEditRenderChips();
    }
    window.__tradeEditAddNewPending = false;
    window.__tradeEditSourceItem = null;
    window.__tradeEditUuids = null;
    window.__tradeEditRenderChips = null;
    const itemModal = document.getElementById("itemModal");
    if (itemModal) itemModal.style.zIndex = "";
  }
};

/**
 * Builds a Numista search query, optionally rewriting via NumistaLookup patterns.
 * @param {string} nameVal - Item name input value
 * @param {string} metalVal - Metal composition value (currently unused; kept for API compatibility)
 * @returns {{ query: string, numistaId: string|null, matched: boolean }}
 */
const buildNumistaSearchQuery = (nameVal, metalVal) => {
  const combined = nameVal;

  // Try pattern-based lookup if available
  if (window.NumistaLookup) {
    const match = NumistaLookup.matchQuery(combined);
    if (match) {
      return { query: match.replacement, numistaId: match.numistaId, matched: true };
    }
  }

  // Fallback: original behavior (raw query)
  return { query: combined, numistaId: null, matched: false };
};

/**
 * Rebuilds denomination select options for the given type.
 * @param {string} [typeValue=""]
 */
const updateDenomLabels = (typeValue = "") => {
  const denomSelect = document.getElementById("itemGbDenom");
  if (!denomSelect || typeof GOLDBACK_DENOMINATIONS === "undefined") return;

  const isSilverback = typeValue === "Silverback";
  const goldbackUnitOption = document.querySelector('#itemWeightUnit option[value="gb"]');
  const silverbackUnitOption = document.querySelector('#itemWeightUnit option[value="sb"]');
  if (goldbackUnitOption) goldbackUnitOption.textContent = "goldback";
  if (silverbackUnitOption) silverbackUnitOption.textContent = "silverback";

  if (isSilverback) {
    denomSelect.style.display = "none";
    return;
  }

  while (denomSelect.firstChild) denomSelect.removeChild(denomSelect.firstChild);
  GOLDBACK_DENOMINATIONS.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = String(d.weight);
    opt.textContent = d.label;
    if (d.weight === 1) opt.selected = true;
    denomSelect.appendChild(opt);
  });
};

// STRK-235 — Constitutional / junk silver entry-mode + live preview wiring.
// Module-scoped current entry mode ("denom" | "face"); read by parseConstitutionalFields.
let _constitutionalEntryMode = "face";

/**
 * Builds a transient constitutional item from the current modal inputs, for the
 * live silver-content preview only (not persisted).
 * @returns {Object} A weightUnit "cu" item shape.
 */
const constitutionalReadFormItem = () => {
  if (_constitutionalEntryMode === "face") {
    const faceEl = safeGetElement("item-constitutional-face");
    const face = faceEl ? parseFloat(faceEl.value) : NaN;
    return {
      weightUnit: "cu",
      constitutionalEntryMode: "face",
      constitutionalVariant: "con-90-subsidiary",
      weight: Number.isFinite(face) && face > 0 ? face : 0,
      qty: 1,
    };
  }
  const variantEl = safeGetElement("item-constitutional-variant");
  const countEl = safeGetElement("item-constitutional-count");
  const count = countEl ? parseInt(countEl.value, 10) : NaN;
  return {
    weightUnit: "cu",
    constitutionalEntryMode: "denom",
    constitutionalVariant: variantEl?.value || "",
    weight: 0,
    qty: Number.isFinite(count) && count > 0 ? count : 0,
  };
};

/**
 * Refreshes the "≈ X ozt silver · melt $Y" preview from current inputs + live spot.
 */
const constitutionalUpdatePreview = () => {
  const preview = document.getElementById("constitutional-silver-preview");
  if (!preview) return;
  const item = constitutionalReadFormItem();
  const oz = typeof getConstitutionalSilverOz === "function" ? getConstitutionalSilverOz(item) : 0;
  const spot = typeof spotPrices !== "undefined" && spotPrices ? Number(spotPrices.silver) || 0 : 0;
  const melt = oz * spot;
  const ozEl = preview.querySelector(".oz");
  const meltEl = preview.querySelector(".melt");
  const noteEl = preview.querySelector("#ccg-basis-note");
  if (ozEl) ozEl.textContent = `${oz.toFixed(4)} ozt`;
  if (meltEl) {
    meltEl.textContent =
      typeof formatCurrency === "function" ? formatCurrency(melt) : `$${melt.toFixed(2)}`;
  }
  if (noteEl) {
    const isFresh =
      typeof getConstitutionalWearFactor === "function" && getConstitutionalWearFactor() === 1;
    noteEl.textContent = isFresh ? "· fresh (mint spec) basis" : "· worn basis";
  }
};
window.constitutionalUpdatePreview = constitutionalUpdatePreview;

/**
 * Sets the constitutional entry mode, swaps the visible field group, updates the
 * toggle's active button, and refreshes the preview.
 * @param {string} mode - "denom" | "face"
 */
const constitutionalSetEntryMode = (mode) => {
  _constitutionalEntryMode = mode === "face" ? "face" : "denom";
  const toggle = document.getElementById("constitutional-entry-mode-toggle");
  if (toggle) {
    Array.from(toggle.children)
      .filter((c) => c.dataset?.mode)
      .forEach((btn) => {
        const active = btn.dataset.mode === _constitutionalEntryMode;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
  }
  const denomFields = document.getElementById("ccg-denom-fields");
  const faceFields = document.getElementById("ccg-face-fields");
  if (denomFields) denomFields.style.display = _constitutionalEntryMode === "denom" ? "" : "none";
  if (faceFields) faceFields.style.display = _constitutionalEntryMode === "face" ? "" : "none";

  // STRK-242: recompute the purchase-price lot/each toggle ONCE here — the single
  // denom↔face chokepoint (STRK-247 compute-once post-dispatch). By-denomination is a
  // lot of `cu.qty` coins, so install a qty override that reads the coin count and
  // default the toggle to LOT; by-face-value is a lot of one, so clear the override and
  // force EACH. Visibility falls out of updateVisibility's qty>1 gate (reads the override).
  // The LOT default is gated on !wasInteracted() so a user's explicit EACH choice survives
  // a live re-resolve; the edit-restore path sets the stored mode AFTER this runs.
  if (typeof purchasePriceToggle !== "undefined") {
    if (_constitutionalEntryMode === "denom") {
      purchasePriceToggle.setQtySource(
        () => Number(safeGetElement("item-constitutional-count")?.value) || 0
      );
      if (!purchasePriceToggle.wasInteracted()) {
        purchasePriceToggle.setMode("lot", { convertInput: false });
      }
    } else {
      purchasePriceToggle.clearQtySource();
      purchasePriceToggle.setMode("each", { convertInput: false });
    }
    purchasePriceToggle.updateVisibility();
  }

  constitutionalUpdatePreview();
};
window.constitutionalSetEntryMode = constitutionalSetEntryMode;
/** @returns {string} The active constitutional entry mode ('denom' | 'face'). */
window.constitutionalGetEntryMode = () => _constitutionalEntryMode;

/**
 * One-time wiring for the constitutional controls: populates the variant select,
 * binds the entry-mode toggle buttons, and keeps the preview live on input.
 */
const setupConstitutionalControls = () => {
  const variantSelect = document.getElementById("item-constitutional-variant");
  if (
    variantSelect &&
    typeof CONSTITUTIONAL_VARIANTS !== "undefined" &&
    variantSelect.options.length === 0
  ) {
    CONSTITUTIONAL_VARIANTS.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.label;
      if (v.id === "con-90-quarter") opt.selected = true;
      variantSelect.appendChild(opt);
    });
  }
  const toggle = document.getElementById("constitutional-entry-mode-toggle");
  if (toggle) {
    Array.from(toggle.children)
      .filter((c) => c.dataset?.mode)
      .forEach((btn) => {
        safeAttachListener(
          btn,
          "click",
          () => constitutionalSetEntryMode(btn.dataset.mode),
          `Constitutional entry mode ${btn.dataset.mode}`
        );
      });
  }
  ["item-constitutional-variant", "item-constitutional-count", "item-constitutional-face"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) {
        safeAttachListener(
          el,
          "input",
          constitutionalUpdatePreview,
          `Constitutional preview ${id}`
        );
        safeAttachListener(
          el,
          "change",
          constitutionalUpdatePreview,
          `Constitutional preview ${id} change`
        );
      }
    }
  );
  // STRK-242: keep ONLY the purchase-toggle's qty>1 visibility gate live as the coin count
  // changes in denomination mode (the override reads #item-constitutional-count). The mode
  // is deliberately NOT changed here — the LOT default is set once by constitutionalSetEntryMode
  // and persists across count edits (updateVisibility skips its self-revert while a cu override
  // is installed), so tweaking the count never flips a restored EACH item to LOT. Typing the
  // count does not re-dispatch the entry mode, hence this narrow extra call site.
  const countEl = document.getElementById("item-constitutional-count");
  if (countEl) {
    safeAttachListener(
      countEl,
      "input",
      () => {
        if (typeof purchasePriceToggle !== "undefined") purchasePriceToggle.updateVisibility();
      },
      "Constitutional count → purchase-toggle visibility"
    );
  }
  constitutionalSetEntryMode(_constitutionalEntryMode);
};
window.setupConstitutionalControls = setupConstitutionalControls;

/**
 * Handles type-driven denomination/weight UI state changes.
 */
const handleTypeChange = () => {
  const selectedType = elements.itemType?.value || "";
  const unitSelect = elements.itemWeightUnit;
  if (!(unitSelect instanceof HTMLElement)) return;

  const unitGroup = unitSelect.closest(".form-group") || unitSelect.parentElement;
  const isGoldbackType = selectedType === "Goldback";
  const isSilverbackType = selectedType === "Silverback";
  const isConstitutionalType = selectedType === "Constitutional";

  // STRK-235: reset the metal lock on every type change; only the Constitutional
  // forced-metal branches (gb/sb/constitutional) re-show the "auto" pill. Other types
  // are unchanged. The select is not disabled (a later type change must re-pick metal).
  const metalEl = elements.itemMetal;
  if (metalEl instanceof HTMLElement) metalEl.disabled = false;
  const metalLockPill = document.getElementById("metalLock");
  if (metalLockPill) metalLockPill.style.display = "none";

  // STRK-242: clear any stale cu by-denomination qty override on EVERY type change so it
  // can't bleed into a non-constitutional item (readQty would otherwise keep reading the
  // hidden #item-constitutional-count). The Constitutional branch re-installs it via the
  // constitutionalSetEntryMode chokepoint when the entry mode resolves to denomination;
  // editItem/duplicateItem likewise re-install it after this runs.
  if (typeof purchasePriceToggle !== "undefined") {
    purchasePriceToggle.clearQtySource();
  }

  if (isGoldbackType || isSilverbackType) {
    unitSelect.value = isGoldbackType ? "gb" : "sb";
    if (unitGroup) unitGroup.classList.add("hidden");
    const metalSelect = elements.itemMetal;
    if (metalSelect instanceof HTMLElement) {
      const targetMetal = isGoldbackType ? "Gold" : "Silver";
      const hasMetalOption = Array.from(metalSelect.options || []).some(
        (option) => option.value === targetMetal
      );
      if (hasMetalOption) metalSelect.value = targetMetal;
    }
    // STRK-235: Goldback/Silverback also force their metal — show the "auto" pill so
    // the lock is consistent with Constitutional.
    if (metalLockPill) metalLockPill.style.display = "";
    updateDenomLabels(selectedType);
    const puritySelect = document.getElementById("itemPuritySelect");
    if (puritySelect && puritySelect.value !== "custom") {
      puritySelect.value = "0.999";
    }
  } else if (isConstitutionalType) {
    // STRK-235: constitutional / junk silver — force + LOCK Silver and switch to the
    // "cu" unit. The whole standard Purity/Qty/Weight/Unit row is hidden and replaced
    // by the dedicated control card (toggleConstitutionalGroup). Valuation ignores
    // purity (ASW is already pure silver).
    unitSelect.value = "cu";
    const metalSelect = elements.itemMetal;
    if (metalSelect instanceof HTMLElement) {
      const hasSilver = Array.from(metalSelect.options || []).some((o) => o.value === "Silver");
      if (hasSilver) metalSelect.value = "Silver";
    }
    if (metalLockPill) metalLockPill.style.display = "";
    // STRK-247: #purityCustomWrapper visibility is recomputed once after the branch
    // dispatch (below) for ALL types — constitutional hides it there since purity is
    // derived from the variant (90/40/35). The select/input values are left untouched so
    // backing out of Constitutional before saving never loses a custom (or preset) purity;
    // the actual cu purity reset lands at save time (parseItemFormFields), only when the
    // FINAL saved type is Constitutional (STRK-245, Codex review).
    // STRK-235: cu items own their coin count in the constitutional card; #itemQty stays
    // pinned to 1 so a stale qty > 1 can't drive a spurious lot÷qty division on save, and
    // so face mode (override cleared) hides the toggle via the qty>1 gate.
    const qtyEl = document.getElementById("itemQty");
    if (qtyEl instanceof HTMLElement) {
      qtyEl.value = "1";
    }
    // STRK-242 (D-3): handleTypeChange manages reversible visibility only and routes the
    // purchase-toggle recompute through the constitutionalSetEntryMode chokepoint
    // (STRK-244/245: no inline toggle/value mutation here). Reset toggle interaction first
    // so a subsequent denom switch can apply the LOT default; a fresh add defaults to
    // FACE-value mode (toggle hidden, EACH), and editItem restores the stored mode after.
    if (typeof purchasePriceToggle !== "undefined") {
      purchasePriceToggle.resetInteracted();
    }
    if (typeof window.constitutionalSetEntryMode === "function") {
      window.constitutionalSetEntryMode("face");
    }
  } else {
    if (unitSelect.value === "gb" || unitSelect.value === "sb" || unitSelect.value === "cu") {
      unitSelect.value = "oz";
    }
    if (unitGroup) unitGroup.classList.remove("hidden");
  }

  // STRK-247: centralize #purityCustomWrapper visibility across ALL type branches.
  // The per-branch restores (STRK-245) missed the custom → Constitutional → gb/sb path:
  // the gb/sb branch preserves a "custom" select but never re-showed the wrapper, leaving
  // it stuck hidden while parsePurity() silently persisted the stale input value. Recompute
  // once here — visible only when purity is still "custom" AND the type is not
  // Constitutional (constitutional derives purity from its variant). This EXTENDS the
  // init.js purity-select listener's rule (which keys on the select value alone) with the
  // Constitutional override, and stops the omission from recurring per-branch.
  // VISIBILITY only: select/input values are left untouched so a round-trip never loses a
  // custom purity; the cu reset lands at save time (parseItemFormFields).
  const purityWrapper = safeGetElement("purityCustomWrapper");
  const puritySelect = safeGetElement("itemPuritySelect");
  if (purityWrapper instanceof HTMLElement && puritySelect instanceof HTMLSelectElement) {
    purityWrapper.style.display =
      puritySelect.value === "custom" && !isConstitutionalType ? "" : "none";
  }

  if (typeof toggleGbDenomPicker === "function") {
    toggleGbDenomPicker();
  }
  if (typeof window.toggleConstitutionalGroup === "function") {
    window.toggleConstitutionalGroup();
  }
};

/**
 * Filters type dropdown options based on selected metal.
 * @param {string} metalValue
 */
const filterTypesByMetal = (metalValue) => {
  const typeSelect = safeGetElement("itemType");
  if (!(typeSelect instanceof HTMLElement)) return;

  // STRK-138 (Req 1): the Add/Edit form does NOT hide any Type option based on
  // metal — Goldback/Silverback stay always selectable. The "no nonsensical
  // metal×type combination" guarantee (Req 5) is enforced below by RESET, not by
  // hiding. (Bulk edit + inline table edit still hide via TYPE_METAL_FILTER.)

  // STAK-580 (re-expressed for Type-drives-Metal): enforce "no nonsensical
  // combo" by RESET, not by hiding. If a Goldback/Silverback Type is active and
  // the user changes Metal to an incompatible value, clear Type back to the
  // placeholder and rebuild dependent UI.
  const currentType = typeSelect.value;
  const incompatible =
    (currentType === "Goldback" && metalValue !== "Gold") ||
    (currentType === "Silverback" && metalValue !== "Silver") ||
    (currentType === "Constitutional" && metalValue !== "Silver");
  if (incompatible) {
    typeSelect.value = "";
    handleTypeChange();
  }
};

const getPendingAddItemTags = () => {
  if (!Array.isArray(window.pendingAddItemTags)) window.pendingAddItemTags = [];
  return window.pendingAddItemTags;
};

const renderPendingAddItemTags = () => {
  const itemTagsChips = safeGetElement("itemModalTagsChips");
  if (!itemTagsChips || typeof itemTagsChips.appendChild !== "function") return;

  const tags = getPendingAddItemTags();
  itemTagsChips.textContent = "";

  if (tags.length === 0) {
    itemTagsChips.innerHTML = '<span class="tag-empty-hint">No tags</span>';
    return;
  }

  tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.textContent = tag;
    chip.title = `Tag: ${tag} (click × to remove)`;

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "tag-chip-remove";
    rm.textContent = "\u00d7";
    rm.setAttribute("aria-label", `Remove tag ${tag}`);
    rm.onclick = (e) => {
      e.stopPropagation();
      window.pendingAddItemTags = getPendingAddItemTags().filter((existing) => existing !== tag);
      renderPendingAddItemTags();
    };

    chip.appendChild(rm);
    itemTagsChips.appendChild(chip);
  });
};

const addPendingAddItemTags = (rawValue) => {
  const parsed =
    typeof parseTagInput === "function"
      ? parseTagInput(rawValue)
      : String(rawValue || "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean);
  const tags = getPendingAddItemTags();
  const maxTags = typeof MAX_TAGS_PER_ITEM === "number" ? MAX_TAGS_PER_ITEM : 20;
  const maxLength = typeof MAX_TAG_LENGTH === "number" ? MAX_TAG_LENGTH : 50;

  parsed.forEach((tag) => {
    const trimmed = String(tag || "").trim();
    if (trimmed.length === 0 || trimmed.length > maxLength || tags.length >= maxTags) return;
    if (tags.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return;
    tags.push(trimmed);
  });
};

const wirePendingAddItemTags = () => {
  window.pendingAddItemTags = [];
  renderPendingAddItemTags();

  const addHandler = () => {
    const val = elements.newTagInput?.value.trim() || "";
    if (!val) return;
    addPendingAddItemTags(val);
    if (elements.newTagInput) elements.newTagInput.value = "";
    renderPendingAddItemTags();
  };

  if (elements.addTagBtn) elements.addTagBtn.onclick = addHandler;
  if (elements.newTagInput) {
    elements.newTagInput.value = "";
    elements.newTagInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addHandler();
      }
    };
  }
  window._renderEditTags = renderPendingAddItemTags;
};

window.updateDenomLabels = updateDenomLabels;
window.handleTypeChange = handleTypeChange;
window.filterTypesByMetal = filterTypesByMetal;
// STAK-580: exposed so Playwright can exercise the validator without going through DOM submit.
window.validateItemFields = validateItemFields;

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
        if (window._cloneMode && typeof clearUncheckedCloneFields === "function") {
          clearUncheckedCloneFields();
        }

        const fields = parseItemFormFields(isEditing, existingItem);
        const error = validateItemFields(fields);
        if (error) {
          appAlert(error);
          return;
        }

        // Capture index before commit — commitItemToInventory nulls editingIndex
        const savedEditIdx = editingIndex;
        commitItemToInventory(fields, isEditing, editingIndex);

        // Clone mode handling — intercept post-commit flow (STAK-375)
        if (window._cloneMode) {
          const newItem = inventory[inventory.length - 1];
          // Copy tags from source to new clone (if tags checkbox is checked)
          if (
            typeof getItemTags === "function" &&
            typeof addItemTag === "function" &&
            typeof saveItemTags === "function" &&
            window._cloneSourceItem?.uuid
          ) {
            const sourceTags = getItemTags(window._cloneSourceItem.uuid) || [];
            if (
              Array.isArray(sourceTags) &&
              sourceTags.length > 0 &&
              typeof isCloneFieldChecked === "function" &&
              isCloneFieldChecked("tags")
            ) {
              let addedTags = false;
              sourceTags.forEach((tag) => {
                if (addItemTag(newItem.uuid, tag, false)) addedTags = true;
              });
              if (addedTags && typeof stampTagTimestamp === "function") {
                stampTagTimestamp([newItem.uuid]);
              }
              saveItemTags();
            }
          }

          window._cloneSessionCount++;
          window._cloneDirty = true;
          if (typeof updateCloneCounter === "function") updateCloneCounter();

          // Clear spot lookup hidden field
          if (elements.itemSpotPrice) elements.itemSpotPrice.value = "";

          if (window._cloneSaveAndClose) {
            window._cloneSaveAndClose = true; // Reset default for next session
            if (typeof exitCloneMode === "function") exitCloneMode(true); // silent — don't re-open edit
            // Fall through to normal close logic below
          } else {
            // Save & Clone Another — reset unchecked fields, stay open
            window._cloneSaveAndClose = true; // Reset default for Enter-key safety
            if (typeof resetUncheckedCloneFields === "function") resetUncheckedCloneFields();
            return; // Don't close modal, don't reset form
          }
        }

        // Save user-uploaded image if pending (STACK-32)
        // Pattern toggle: promote images to a pattern rule instead of (or in addition to) per-item save
        let patternRuleSaved = false;
        const patternToggle = document.getElementById("imagePatternToggle");
        const savedItem = isEditing ? inventory[savedEditIdx] : inventory[inventory.length - 1];
        if (patternToggle?.checked) {
          try {
            const rawKeywords = (
              document.getElementById("imagePatternKeywords")?.value || ""
            ).trim();
            if (rawKeywords) {
              // Resolve blobs: prefer pending upload, fall back to already-saved per-item IDB record
              let obvBlob = _pendingObverseBlob;
              let revBlob = _pendingReverseBlob;
              // Fill in missing sides from existing per-item IDB record
              if ((!obvBlob || !revBlob) && savedItem?.uuid && window.imageCache?.isAvailable()) {
                const existing = await window.imageCache
                  .getUserImage(savedItem.uuid)
                  .catch(() => null);
                if (existing) {
                  if (!obvBlob) obvBlob = existing.obverse || null;
                  if (!revBlob) revBlob = existing.reverse || null;
                }
              }

              if (obvBlob || revBlob) {
                // Convert keywords to regex: "morgan, peace" → "morgan|peace"
                const terms = rawKeywords
                  .split(/[,;]/)
                  .map((t) => t.trim())
                  .filter((t) => t.length > 0);
                const pattern = terms
                  .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                  .join("|");
                // Pre-generate ruleId and pass as seedImageId — the image lookup
                // chain resolves via rule.seedImageId, not rule.id
                const ruleId = "custom-img-" + Date.now();
                const result = NumistaLookup.addRule(pattern, rawKeywords, null, ruleId);
                if (result?.success && window.imageCache?.isAvailable()) {
                  await window.imageCache.cachePatternImage(ruleId, obvBlob, revBlob);
                  debugLog(
                    `Pattern rule created: ${result.id} (images: ${ruleId}) for "${rawKeywords}"`
                  );
                  // Move: delete the per-item userImages record so it no longer appears in Per-Item section
                  if (savedItem?.uuid) {
                    await window.imageCache.deleteUserImage(savedItem.uuid).catch(() => {});
                  }
                } else {
                  debugLog(`Failed to create pattern rule: ${result?.error}`, "warn");
                }
              } else {
                debugLog("Pattern toggle checked but no images available to promote", "warn");
              }
              clearUploadState();
              patternRuleSaved = true;
              renderTable();
            }
          } catch (err) {
            console.warn("Failed to create pattern rule from modal:", err);
            clearUploadState();
            patternRuleSaved = true; // prevent double-save on error
          }
        }
        if (
          !patternRuleSaved &&
          (_pendingObverseBlob ||
            _pendingReverseBlob ||
            _deleteObverseOnSave ||
            _deleteReverseOnSave)
        ) {
          // Per-item save: save blobs against the item's UUID
          if (savedItem?.uuid) {
            try {
              const saved = await saveUserImageForItem(savedItem.uuid);
              if (!saved) {
                debugLog("Image save returned false — image may not have been stored");
              } else {
                // Re-render so thumbnails reflect the newly saved image
                renderTable();
              }
            } catch (err) {
              console.warn("Failed to save user image:", err);
            }
          }
        } else if (!patternRuleSaved) {
          clearUploadState();
        }

        // Write queued attachments to IDB (STRK-45)
        // commitItemToInventory() has already run, so savedItem.uuid is stable
        if (window._cloneMode) {
          // Clone starts with no attachments
          clearAttachmentQueue();
          if (savedItem) savedItem.attachments = [];
          saveInventory();
        } else if (
          _pendingAttachments.length > 0 &&
          savedItem?.uuid &&
          window.attachmentManager?.isAvailable()
        ) {
          const queue = [..._pendingAttachments];
          clearAttachmentQueue();
          if (!Array.isArray(savedItem.attachments)) savedItem.attachments = [];
          for (const entry of queue) {
            const file = entry.file;
            const uuid = typeof generateUUID === "function" ? generateUUID() : crypto.randomUUID();
            const record = {
              attachmentUuid: uuid,
              itemUuid: savedItem.uuid,
              fileName: file.name,
              type: file.type,
              size: file.size,
              uploadedAt: new Date().toISOString(),
              blob: file,
            };
            const ok = await attachmentManager.addAttachment(record);
            if (!ok) {
              if (typeof showToast === "function")
                showToast(`Attachment "${file.name}" could not be stored`, "warning");
              continue;
            }
            savedItem.attachments.push({
              attachmentUuid: uuid,
              fileName: file.name,
              type: file.type,
              size: file.size,
              uploadedAt: record.uploadedAt,
            });
          }
          saveInventory();
        } else if (_pendingAttachments.length > 0) {
          if (typeof showToast === "function")
            showToast("Attachments could not be saved — storage is unavailable", "error");
          clearAttachmentQueue();
        } else {
          clearAttachmentQueue();
        }

        // Clear spot lookup hidden field after commit (STACK-49)
        if (elements.itemSpotPrice) elements.itemSpotPrice.value = "";

        if (!isEditing) {
          this.reset();
          elements.itemWeightUnit.value = "oz";
          elements.itemDate.value = todayStr();
        }

        // Close modal
        try {
          if (typeof closeModalById === "function") {
            closeModalById("itemModal");
          } else if (elements.itemModal) {
            elements.itemModal.style.display = "none";
            document.body.style.overflow = "";
          }
        } catch (closeErr) {
          console.warn("Failed to close item modal:", closeErr);
        }

        // Update filter chips after inventory mutation
        if (typeof renderActiveFilters === "function") {
          renderActiveFilters();
        }
      },
      "Unified item form"
    );
  } else {
    console.error("Main inventory form not found!");
  }

  const purchasePriceModeToggle = safeGetElement("purchasePriceModeToggle");
  if (purchasePriceModeToggle) {
    Array.from(purchasePriceModeToggle.children)
      .filter((child) => child.dataset?.mode)
      .forEach((button) => {
        safeAttachListener(
          button,
          "click",
          () => {
            purchasePriceToggle.setMode(button.dataset.mode);
            purchasePriceToggle.markInteracted();
          },
          `Purchase price ${button.dataset.mode} toggle`
        );
      });
  }

  optionalListener(
    elements.itemQty,
    "input",
    () => purchasePriceToggle.updateVisibility(),
    "Purchase price toggle visibility"
  );
  resetPurchasePriceToggle();

  // UNDO CHANGE BUTTON
  if (elements.undoChangeBtn) {
    safeAttachListener(
      elements.undoChangeBtn,
      "click",
      (e) => {
        if (e && typeof e.preventDefault === "function") e.preventDefault();
        if (editingChangeLogIndex !== null) {
          toggleChange(editingChangeLogIndex);
          try {
            if (typeof closeModalById === "function") closeModalById("itemModal");
          } catch (undoErr) {}
          editingIndex = null;
          editingChangeLogIndex = null;
          renderChangeLog();
        }
      },
      "Undo change button"
    );
  }

  // ITEM MODAL CLOSE / CANCEL BUTTONS
  const closeItemModal = (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (e && typeof e.stopPropagation === "function") e.stopPropagation();
    clearAttachmentQueue();
    // In clone mode, "Back" returns to edit mode instead of closing (STAK-375)
    if (window._cloneMode && typeof exitCloneMode === "function") {
      exitCloneMode();
      return;
    }
    clearUploadState();
    // Dismiss any open autocomplete dropdowns (BUG-002/003)
    if (typeof dismissAllAutocompletes === "function") dismissAllAutocompletes();
    try {
      if (typeof closeModalById === "function") closeModalById("itemModal");
    } catch (closeErr) {}
    if (window.__tradeAddNewPending || window.__tradeEditAddNewPending) {
      if (window.__tradeEditAddNewPending) {
        window.__tradeEditSourceItem = null;
        window.__tradeEditUuids = null;
        window.__tradeEditRenderChips = null;
      }
      window.__tradeAddNewPending = false;
      window.__tradeEditAddNewPending = false;
      const modal = safeGetElement("itemModal");
      if (modal instanceof HTMLElement) modal.style.zIndex = "";
    }
    editingIndex = null;
    editingChangeLogIndex = null;
  };

  optionalListener(elements.cancelItemBtn, "click", closeItemModal, "Cancel item button");
  optionalListener(elements.itemCloseBtn, "click", closeItemModal, "Item modal close button");

  // RETAIL PRICE HISTORY LINK — opens per-item price history modal (STAK-109)
  const retailHistoryLink = document.getElementById("retailPriceHistoryLink");
  if (retailHistoryLink) {
    retailHistoryLink.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (editingIndex === null) return;
      const item = inventory[editingIndex];
      if (!item || !item.uuid) return;
      if (typeof openItemPriceHistoryModal === "function") {
        openItemPriceHistoryModal(item.uuid, item.name || "Unnamed");
      }
    });
  }

  // ITEM PRICE HISTORY MODAL — close & filter handlers (STAK-109)
  const itemPriceHistoryModal = document.getElementById("itemPriceHistoryModal");
  const itemPriceHistoryCloseBtn = document.getElementById("itemPriceHistoryCloseBtn");
  const itemPriceHistoryFilter = document.getElementById("itemPriceHistoryFilter");
  const itemPriceHistoryClearFilterBtn = document.getElementById("itemPriceHistoryClearFilterBtn");

  if (itemPriceHistoryCloseBtn) {
    itemPriceHistoryCloseBtn.addEventListener("click", () => {
      if (itemPriceHistoryModal) itemPriceHistoryModal.style.display = "none";
    });
  }
  if (itemPriceHistoryModal) {
    itemPriceHistoryModal.addEventListener("click", (e) => {
      if (e.target === itemPriceHistoryModal) {
        itemPriceHistoryModal.style.display = "none";
      }
    });
  }
  if (itemPriceHistoryFilter) {
    itemPriceHistoryFilter.addEventListener("input", () => {
      if (typeof window._setItemPriceModalFilter === "function") {
        window._setItemPriceModalFilter(itemPriceHistoryFilter.value);
      }
    });
  }
  if (itemPriceHistoryClearFilterBtn) {
    itemPriceHistoryClearFilterBtn.addEventListener("click", () => {
      if (itemPriceHistoryFilter) itemPriceHistoryFilter.value = "";
      if (typeof window._setItemPriceModalFilter === "function") {
        window._setItemPriceModalFilter("");
      }
    });
  }

  // IMAGE URL FIELDS — show URL buttons + refresh when COIN_IMAGES enabled
  if (featureFlags.isEnabled("COIN_IMAGES")) {
    // Show URL toggle buttons and refresh button inline
    ["Obv", "Rev"].forEach((suffix) => {
      const urlBtn = document.getElementById("itemImageUrlBtn" + suffix);
      const urlInput = document.getElementById("itemImageUrlInput" + suffix);
      if (urlBtn) {
        urlBtn.style.display = "";
        urlBtn.addEventListener("click", () => {
          if (urlInput) {
            const isHidden = urlInput.style.display === "none";
            urlInput.style.display = isHidden ? "" : "none";
            urlBtn.classList.toggle("active", isHidden);
          }
        });
      }
    });
  }

  // IMAGE UPLOAD BUTTONS — Obverse + Reverse (STACK-32/33)
  const imageUploadGroup = document.getElementById("imageUploadGroup");

  if (imageUploadGroup && featureFlags.isEnabled("COIN_IMAGES")) {
    imageUploadGroup.style.display = "";

    const isSecure = location.protocol === "https:" || location.hostname === "localhost";
    const isMobile = /Mobi|Android/i.test(navigator.userAgent);

    // Wire each side: Obv and Rev
    ["Obv", "Rev"].forEach((suffix) => {
      const side = suffix === "Rev" ? "reverse" : "obverse";
      const fileInput = document.getElementById("itemImageFile" + suffix);
      const uploadBtn = document.getElementById("itemImageUploadBtn" + suffix);
      const cameraBtn = document.getElementById("itemImageCameraBtn" + suffix);
      const removeBtn = document.getElementById("itemImageRemoveBtn" + suffix);
      const frameBtn = document.getElementById("frameToggle" + suffix);
      const urlField =
        side === "reverse" ? elements.itemReverseImageUrl : elements.itemObverseImageUrl;

      if (frameBtn) {
        frameBtn.addEventListener("click", () => {
          _setPendingFrame(
            side,
            typeof cycleFrame === "function" ? cycleFrame(_getPendingFrame(side)) : "auto"
          );
          _renderFrameToggle(side);
        });
      }

      if (urlField) {
        urlField.addEventListener("input", () => scheduleUrlPreview(side));
      }

      if (isMobile && isSecure && cameraBtn && fileInput) {
        cameraBtn.style.display = "";
        cameraBtn.addEventListener("click", () => {
          fileInput.setAttribute("capture", "environment");
          fileInput.click();
        });
      }

      if (uploadBtn && fileInput) {
        uploadBtn.addEventListener("click", () => {
          fileInput.removeAttribute("capture");
          fileInput.click();
        });
      }

      if (fileInput) {
        fileInput.addEventListener("change", async () => {
          const file = fileInput.files?.[0];
          if (file) await processUploadedImage(file, side);
        });
      }

      if (removeBtn) {
        removeBtn.addEventListener("click", async () => {
          // Clear just this side
          if (side === "reverse") {
            _pendingReverseBlob = null;
            _deleteReverseOnSave = true;
            _pendingReverseFrame = "auto";
            if (_pendingReversePreviewUrl) {
              URL.revokeObjectURL(_pendingReversePreviewUrl);
              _pendingReversePreviewUrl = null;
            }
          } else {
            _pendingObverseBlob = null;
            _deleteObverseOnSave = true;
            _pendingObverseFrame = "auto";
            if (_pendingObversePreviewUrl) {
              URL.revokeObjectURL(_pendingObversePreviewUrl);
              _pendingObversePreviewUrl = null;
            }
          }
          const preview = document.getElementById("itemImagePreview" + suffix);
          const img = document.getElementById("itemImagePreviewImg" + suffix);
          const sizeInfo = document.getElementById("itemImageSizeInfo" + suffix);
          if (preview) preview.style.display = "none";
          if (img) img.src = "";
          if (sizeInfo) sizeInfo.textContent = "";
          if (removeBtn) removeBtn.style.display = "none";
          if (fileInput) fileInput.value = "";
          // STAK-308: Clear URL field so deleted CDN URL doesn't persist on save
          const urlField =
            side === "reverse" ? elements.itemReverseImageUrl : elements.itemObverseImageUrl;
          if (urlField) urlField.value = "";
          // STAK-332: Flag item to ignore pattern rule images after explicit removal
          const ignorePatternCheckbox = document.getElementById("itemIgnorePatternImages");
          if (ignorePatternCheckbox) ignorePatternCheckbox.checked = true;
          _renderFrameToggle(side);
          updateSwapButtonVisibility();

          // STAK-244: Also clear Numista image cache if user is removing a catalog-synced image
          const catalogId = elements.itemCatalog?.value?.trim() || "";
          if (catalogId && window.imageCache?.isAvailable()) {
            debugLog(`Remove button: clearing Numista cache for ${catalogId}`);
            try {
              await imageCache.deleteImages(catalogId);
              await imageCache.deleteMetadata(catalogId);
            } catch (err) {
              debugLog(`Failed to clear Numista image cache on remove: ${err.message}`, "warn");
            }
          }
        });
      }
    });

    // PATTERN TOGGLE — "Apply to all matching items" checkbox
    const patternToggleGroup = document.getElementById("imagePatternToggleGroup");
    const patternToggleCheckbox = document.getElementById("imagePatternToggle");
    const patternKeywordsGroup = document.getElementById("imagePatternKeywordsGroup");
    const patternKeywordsInput = document.getElementById("imagePatternKeywords");

    if (patternToggleGroup) {
      patternToggleGroup.style.display = "";
    }
    if (patternToggleCheckbox) {
      patternToggleCheckbox.addEventListener("change", () => {
        if (patternKeywordsGroup) {
          patternKeywordsGroup.style.display = patternToggleCheckbox.checked ? "" : "none";
        }
        if (patternToggleCheckbox.checked && patternKeywordsInput) {
          const itemName = document.getElementById("itemName")?.value?.trim() || "";
          if (itemName && !patternKeywordsInput.value.trim()) {
            patternKeywordsInput.value = itemName;
          }
        }
      });
    }
  }

  // SWAP OBVERSE/REVERSE BUTTON (STAK-341)
  const swapBtn = safeGetElement("swapImagesBtn");
  if (swapBtn) {
    swapBtn.addEventListener("click", async () => {
      // Hydrate each missing side from IndexedDB before swap (PR #551 review)
      // Must hydrate per-side (not gated on both null) to handle mixed
      // upload+swap: user uploads one side, then swaps before saving.
      const uuid = editingIndex !== null ? inventory[editingIndex]?.uuid : null;
      if (
        uuid &&
        (!_pendingObverseBlob || !_pendingReverseBlob) &&
        window.imageCache?.isAvailable()
      ) {
        try {
          const rec = await imageCache.getUserImage(uuid);
          if (!_pendingObverseBlob && rec?.obverse) _pendingObverseBlob = rec.obverse;
          if (!_pendingReverseBlob && rec?.reverse) _pendingReverseBlob = rec.reverse;
        } catch {
          /* ignore — blobs stay null */
        }
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

      // Swap frame override state with the images it describes
      const tmpFrame = _pendingObverseFrame;
      _pendingObverseFrame = _pendingReverseFrame;
      _pendingReverseFrame = tmpFrame;

      // Swap visible preview images
      const imgObv = document.getElementById("itemImagePreviewImgObv");
      const imgRev = document.getElementById("itemImagePreviewImgRev");
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
      const sizeObv = document.getElementById("itemImageSizeInfoObv");
      const sizeRev = document.getElementById("itemImageSizeInfoRev");
      if (sizeObv && sizeRev) {
        const tmpText = sizeObv.textContent;
        sizeObv.textContent = sizeRev.textContent;
        sizeRev.textContent = tmpText;
      }

      // Clear file inputs to avoid filename mismatch (PR #551 review)
      const fileObv = document.getElementById("itemImageFileObv");
      const fileRev = document.getElementById("itemImageFileRev");
      if (fileObv) fileObv.value = "";
      if (fileRev) fileRev.value = "";
      renderFrameToggles();
    });
  }

  // SEARCH NUMISTA BUTTON — lookup by N# or search by name
  if (elements.searchNumistaBtn) {
    safeAttachListener(
      elements.searchNumistaBtn,
      "click",
      async () => {
        // Gate on configured key first — otherwise the empty-field check below
        // can short-circuit with a misleading "Enter a Name..." error when the
        // real blocker is a missing API key (STAK-576 ISSUE-005).
        if (!(await ensureNumistaConfiguredOrPrompt())) return;

        const catalogVal = elements.itemCatalog?.value.trim() || "";
        const nameVal = elements.itemName?.value.trim() || "";

        if (!catalogVal && !nameVal) {
          appAlert("Enter a Name or Catalog N# to search.");
          return;
        }

        if (!catalogAPI || !catalogAPI.activeProvider) {
          // Key is present but the provider failed to initialize — rare.
          // Nudge the user back to Settings without claiming the key is missing.
          if (typeof appConfirm === "function") {
            const open = await appConfirm(
              "Numista catalog provider failed to initialize. Open Settings → API to re-test the key?",
              "Numista API"
            );
            if (open && typeof showSettingsModal === "function") showSettingsModal("api");
          } else {
            appAlert("Numista catalog provider failed to initialize. Check Settings → API.");
          }
          return;
        }

        const btn = elements.searchNumistaBtn;
        if (typeof setButtonLoading === "function") {
          setButtonLoading(btn, true, "Searching...");
        } else {
          // Fallback if util not loaded
          btn.dataset.originalHtml = btn.innerHTML;
          btn.textContent = "Searching...";
          btn.disabled = true;
        }

        // Type → Numista category mapping for smarter search results
        const TYPE_TO_NUMISTA_CATEGORY = {
          Coin: "coin",
          Bar: "exonumia",
          Round: "exonumia",
          Note: "banknote",
        };

        try {
          if (catalogVal) {
            const result = await catalogAPI.lookupItem(catalogVal);
            showNumistaResults(result ? [result] : [], true, catalogVal);
          } else {
            const typeVal = elements.itemType?.value || "";
            const searchFilters = { limit: 20 };
            const numistaCategory = TYPE_TO_NUMISTA_CATEGORY[typeVal];
            if (numistaCategory) searchFilters.category = numistaCategory;

            const searchResult = buildNumistaSearchQuery(nameVal, "");

            if (searchResult.matched) {
              // Pattern matched — build raw query for fallback results
              const rawQuery = nameVal;

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
          console.error("Numista search error:", error);
          appAlert("Search failed: " + error.message);
        } finally {
          setButtonLoading(btn, false);
        }
      },
      "Search Numista button"
    );
  }

  // LOOKUP PCGS BUTTON — verify by Cert# or look up by PCGS#
  if (elements.lookupPcgsBtn) {
    safeAttachListener(
      elements.lookupPcgsBtn,
      "click",
      async () => {
        if (typeof lookupPcgsFromForm !== "function") {
          appAlert("PCGS lookup is not available.");
          return;
        }

        const btn = elements.lookupPcgsBtn;
        if (typeof setButtonLoading === "function") {
          setButtonLoading(btn, true, "Looking up...");
        } else {
          btn.dataset.originalHtml = btn.innerHTML;
          btn.textContent = "Looking up...";
          btn.disabled = true;
        }

        try {
          const result = await lookupPcgsFromForm();

          if (!result.verified) {
            appAlert(result.error || "PCGS lookup failed.");
            return;
          }

          // Show field picker modal instead of auto-filling
          if (typeof showPcgsFieldPicker === "function") {
            showPcgsFieldPicker(result);
          } else {
            appAlert("PCGS field picker not available.");
          }
        } catch (error) {
          console.error("PCGS lookup error:", error);
          appAlert("PCGS lookup failed: " + error.message);
        } finally {
          setButtonLoading(btn, false);
        }
      },
      "Lookup PCGS button"
    );
  }

  // SPOT LOOKUP BUTTON — search historical spot prices by date (STACK-49)
  if (elements.spotLookupBtn) {
    safeAttachListener(
      elements.spotLookupBtn,
      "click",
      () => {
        if (typeof openSpotLookupModal === "function") openSpotLookupModal("purchase");
      },
      "Spot lookup button"
    );
  }

  if (elements.retailSpotLookupBtn) {
    safeAttachListener(
      elements.retailSpotLookupBtn,
      "click",
      () => {
        if (typeof openSpotLookupModal === "function") openSpotLookupModal("retail");
      },
      "Retail spot lookup button"
    );
  }

  // DATE FIELD — enable/disable spot lookup button based on date value (STACK-49)
  if (elements.itemDate) {
    const updateSpotBtnState = () => {
      if (typeof syncSpotLookupButtons === "function") {
        syncSpotLookupButtons(!!elements.itemDate.value);
      }
    };
    safeAttachListener(elements.itemDate, "change", updateSpotBtnState, "Date field for spot btn");
    safeAttachListener(
      elements.itemDate,
      "input",
      updateSpotBtnState,
      "Date field input for spot btn"
    );
  }

  // METAL CHANGE — clear stale spot lookup value (STACK-49)
  if (elements.itemMetal) {
    safeAttachListener(
      elements.itemMetal,
      "change",
      () => {
        if (elements.itemSpotPrice) elements.itemSpotPrice.value = "";
        filterTypesByMetal(elements.itemMetal.value);
      },
      "Metal change clears spot lookup and filters type options"
    );
  }

  if (elements.itemType) {
    safeAttachListener(
      elements.itemType,
      "change",
      () => {
        const itemMetal = elements.itemMetal;
        const metalBefore = itemMetal instanceof HTMLElement ? itemMetal.value : null;
        handleTypeChange();
        // STRK-138: handleTypeChange may programmatically drive Metal (e.g.
        // Type=Goldback -> Metal=Gold), which does NOT fire the metal-change
        // listener that clears a stale spot lookup (STACK-49). Mirror that
        // behavior here, but only when the Type change actually moved Metal.
        const metalAfter = itemMetal instanceof HTMLElement ? itemMetal.value : null;
        if (metalAfter !== metalBefore && elements.itemSpotPrice instanceof HTMLElement) {
          elements.itemSpotPrice.value = "";
        }
      },
      "Type change updates denomination picker"
    );
  }

  // STRK-235: wire the constitutional / junk-silver entry controls (variant select,
  // entry-mode toggle, live preview). Safe no-op if the markup is absent.
  if (typeof setupConstitutionalControls === "function") {
    setupConstitutionalControls();
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
      "Numista name search button"
    );
  }

  // CLONE ITEM BUTTON — enter clone mode on the edit modal (STAK-375)
  if (elements.cloneItemBtn) {
    safeAttachListener(
      elements.cloneItemBtn,
      "click",
      () => {
        if (
          typeof editingIndex === "number" &&
          editingIndex >= 0 &&
          typeof enterCloneMode === "function"
        ) {
          enterCloneMode(editingIndex);
        }
      },
      "Clone item button"
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
      "Save & clone another button"
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
        if (
          typeof editingIndex === "number" &&
          editingIndex >= 0 &&
          typeof showViewModal === "function"
        ) {
          if (typeof closeModalById === "function") closeModalById("itemModal");
          else {
            const modal = document.getElementById("itemModal");
            if (modal) modal.style.display = "none";
            document.body.style.overflow = "";
          }
          showViewModal(editingIndex);
        }
      },
      "View item from edit button"
    );
  }

  // SHAPE DROPDOWN — toggle dimension fields (STAK-528)
  const toggleDimensionFields = (shapeValue) => {
    const category = window.classifyShape ? window.classifyShape(shapeValue) : "round";
    const diamWrap = safeGetElement("numistaDiameterWrap");
    const lenWrap = safeGetElement("numistaLengthWrap");
    const widWrap = safeGetElement("numistaWidthWrap");
    if (category === "rectangular" || category === "square") {
      if (diamWrap) diamWrap.style.display = "none";
      if (lenWrap) lenWrap.style.display = "";
      if (widWrap) widWrap.style.display = "";
      // Copy diameter to length on transition — parse LxW strings first
      const diamEl = safeGetElement("numistaDiameter");
      const lenEl = safeGetElement("numistaLength");
      const widEl = safeGetElement("numistaWidth");
      if (diamEl && diamEl.value && lenEl && !lenEl.value) {
        if (window.parseDimensions && /[xX\u00D7]/.test(diamEl.value)) {
          const parsed = window.parseDimensions(diamEl.value, shapeValue);
          if (parsed.length > 0) lenEl.value = parsed.length;
          if (parsed.width > 0 && widEl) widEl.value = parsed.width;
        } else {
          lenEl.value = diamEl.value;
        }
      }
      // Clear stale diameter since we're in rectangular mode
      if (diamEl) diamEl.value = "";
    } else {
      if (diamWrap) diamWrap.style.display = "";
      if (lenWrap) lenWrap.style.display = "none";
      if (widWrap) widWrap.style.display = "none";
      // Clear stale length/width since we're in round mode
      const lenEl = safeGetElement("numistaLength");
      const widEl = safeGetElement("numistaWidth");
      if (lenEl) lenEl.value = "";
      if (widEl) widEl.value = "";
    }
  };

  const shapeSelect = safeGetElement("numistaShape");
  if (shapeSelect) {
    safeAttachListener(
      shapeSelect,
      "change",
      () => {
        toggleDimensionFields(shapeSelect.value);
        if (typeof updateCapsuleSuggestion === "function") {
          updateCapsuleSuggestion(safeGetElement("numistaDiameter")?.value || "");
        }
      },
      "Shape dropdown dimension toggle"
    );
  }

  // Expose for programmatic use (Numista fill, migration)
  window.toggleDimensionFields = toggleDimensionFields;

  // COMMEMORATIVE CHECKBOX — toggle description field (STAK-173)
  const numistaCommemorative = document.getElementById("numistaCommemorative");
  const numistaCommemorativeDescWrap = document.getElementById("numistaCommemorativeDescWrap");
  if (numistaCommemorative && numistaCommemorativeDescWrap) {
    safeAttachListener(
      numistaCommemorative,
      "change",
      () => {
        numistaCommemorativeDescWrap.style.display = numistaCommemorative.checked ? "" : "none";
      },
      "Commemorative checkbox toggle"
    );
  }

  // DATE N/A TOGGLE BUTTON (STAK-375)
  if (elements.itemDateNABtn && elements.itemDate) {
    safeAttachListener(
      elements.itemDateNABtn,
      "click",
      () => {
        const isActive = elements.itemDateNABtn.classList.toggle("active");
        elements.itemDateNABtn.setAttribute("aria-pressed", isActive);
        elements.itemDate.disabled = isActive;
        if (isActive) {
          elements.itemDate.value = "";
        }
        if (typeof syncSpotLookupButtons === "function") {
          syncSpotLookupButtons(!!elements.itemDate.value);
        }
      },
      "Date N/A toggle button"
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
  optionalListener(
    elements.saveNotesBtn,
    "click",
    () => {
      if (notesIndex === null) return;
      const text = elements.notesTextarea ? elements.notesTextarea.value.trim() : "";

      const oldItem = { ...inventory[notesIndex] };
      inventory[notesIndex].notes = text;
      if (typeof window.invalidateSearchCache === "function") {
        window.invalidateSearchCache(inventory[notesIndex]);
      }
      saveInventory();
      renderTable();
      logItemChanges(oldItem, inventory[notesIndex]);
      dismissNotesModal();
    },
    "Save notes button"
  );

  optionalListener(elements.cancelNotesBtn, "click", dismissNotesModal, "Cancel notes button");
  optionalListener(elements.notesCloseBtn, "click", dismissNotesModal, "Notes modal close button");
  optionalListener(
    document.getElementById("notesViewCloseBtn"),
    "click",
    () => {
      if (typeof closeModalById === "function") closeModalById("notesViewModal");
    },
    "Notes view modal close button"
  );

  optionalListener(
    document.getElementById("goldbackExchangeRateLink"),
    "click",
    (e) => {
      e.preventDefault();
      const popup = window.open(
        "https://www.goldback.com/exchange-rates/",
        "goldback_rates",
        "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
      );
      if (popup) popup.opener = null;
    },
    "Goldback exchange rates link"
  );

  optionalListener(
    document.getElementById("spotLookupCloseBtn"),
    "click",
    () => {
      if (typeof closeSpotLookupModal === "function") closeSpotLookupModal();
    },
    "Spot lookup modal close button"
  );

  optionalListener(
    elements.debugCloseBtn,
    "click",
    () => {
      if (typeof hideDebugModal === "function") hideDebugModal();
    },
    "Debug modal close button"
  );

  // Bulk Edit modal open/close
  optionalListener(
    elements.bulkEditBtn,
    "click",
    () => {
      if (typeof openBulkEdit === "function") openBulkEdit();
    },
    "Bulk edit open button"
  );
  optionalListener(
    elements.bulkEditCloseBtn,
    "click",
    () => {
      if (typeof closeBulkEdit === "function") closeBulkEdit();
    },
    "Bulk edit close button"
  );

  optionalListener(
    elements.changeLogBtn,
    "click",
    (e) => {
      e.preventDefault();
      if (typeof showSettingsModal === "function") showSettingsModal("changelog");
    },
    "Change log button"
  );

  // Settings panel clear buttons (STACK-44)
  optionalListener(
    elements.settingsChangeLogClearBtn,
    "click",
    () => {
      if (typeof clearChangeLog === "function") clearChangeLog();
    },
    "Settings change log clear button"
  );
  optionalListener(
    elements.settingsSpotHistoryClearBtn,
    "click",
    () => {
      if (typeof clearSpotHistory === "function") clearSpotHistory();
    },
    "Settings spot history clear button"
  );
  optionalListener(
    elements.settingsCatalogHistoryClearBtn,
    "click",
    () => {
      if (typeof clearCatalogHistory === "function") clearCatalogHistory();
    },
    "Settings catalog history clear button"
  );
  optionalListener(
    elements.settingsPriceHistoryClearBtn,
    "click",
    () => {
      if (typeof clearItemPriceHistory === "function") clearItemPriceHistory();
    },
    "Settings price history clear button"
  );
  optionalListener(
    elements.settingsCloudActivityClearBtn,
    "click",
    () => {
      if (typeof clearCloudActivityLog === "function") clearCloudActivityLog();
    },
    "Settings cloud activity clear button"
  );

  // Price History filter input (STACK-44)
  optionalListener(
    elements.priceHistoryFilterInput,
    "input",
    () => {
      if (typeof filterItemPriceHistoryTable === "function") filterItemPriceHistoryTable();
    },
    "Price history filter input"
  );

  optionalListener(
    elements.backupReminder,
    "click",
    (e) => {
      e.preventDefault();
      if (typeof showSettingsModal === "function") showSettingsModal("system");
    },
    "Backup reminder link"
  );

  optionalListener(
    elements.storageReportLink,
    "click",
    (e) => {
      e.preventDefault();
      if (typeof showSettingsModal === "function") showSettingsModal("storage");
    },
    "Storage report link"
  );

  optionalListener(
    elements.changeLogCloseBtn,
    "click",
    () => {
      if (elements.changeLogModal) {
        if (window.closeModalById) closeModalById("changeLogModal");
        else {
          elements.changeLogModal.style.display = "none";
          document.body.style.overflow = "";
        }
      }
    },
    "Change log close button"
  );

  optionalListener(
    elements.changeLogClearBtn,
    "click",
    () => {
      if (typeof clearChangeLog === "function") clearChangeLog();
    },
    "Change log clear button"
  );
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
          // Call through `window.` (STRK-284), matching what the retired header
          // Spot Sync button did. The bare identifier resolves to api.js's
          // top-level `const`, a separate binding from the `window` property —
          // so the two controls were not actually interchangeable, and anything
          // that swaps `window.syncSpotPricesFromApi` (test spies, future
          // instrumentation) silently missed this path. This icon is now the
          // ONLY manual sync affordance, so it has to carry the same contract.
          if (typeof window.syncSpotPricesFromApi === "function") {
            window.syncSpotPricesFromApi(true);
          } else {
            appAlert(
              "API sync functionality requires Metals API configuration. Please configure an API provider first."
            );
          }
        },
        `Sync spot price for ${metalName}`
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
        `Trend range for ${metalName}`
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
    true
  );

  // Long-press handler for mobile inline spot price editing (STAK-285)
  // Mirrors shift+click behavior: hold 600ms on spot price to open manual input
  let _spotLongPressTimer = null;
  let _spotLongPressFired = false;

  document.addEventListener(
    "touchstart",
    (e) => {
      const valueEl = e.target.closest(".spot-card-value");
      if (!valueEl) return;
      // Clear any existing timer to prevent orphaned timeouts on rapid re-touch
      if (_spotLongPressTimer) {
        clearTimeout(_spotLongPressTimer);
        _spotLongPressTimer = null;
      }
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
    },
    { passive: false }
  );

  // Suppress context menu during long-press (preventDefault inside setTimeout is stale)
  document.addEventListener("contextmenu", (e) => {
    if (_spotLongPressFired || _spotLongPressTimer) {
      e.preventDefault();
    }
  });

  document.addEventListener(
    "touchend",
    (e) => {
      if (_spotLongPressTimer) {
        clearTimeout(_spotLongPressTimer);
        _spotLongPressTimer = null;
      }
      // Suppress the click/tap that follows a successful long-press
      if (_spotLongPressFired) {
        e.preventDefault();
        _spotLongPressFired = false;
      }
    },
    { passive: false }
  );

  document.addEventListener(
    "touchmove",
    () => {
      if (_spotLongPressTimer) {
        clearTimeout(_spotLongPressTimer);
        _spotLongPressTimer = null;
      }
    },
    { passive: true }
  );

  // Cancel long-press when browser cancels the gesture (e.g., incoming call, scroll takeover)
  document.addEventListener(
    "touchcancel",
    () => {
      if (_spotLongPressTimer) {
        clearTimeout(_spotLongPressTimer);
        _spotLongPressTimer = null;
      }
    },
    { passive: true }
  );
};

/**
 * Sets up vault backup/restore listeners and password strength UI.
 */
const setupVaultListeners = () => {
  const vaultCloseBtn = document.getElementById("vaultCloseBtn");
  const vaultActionBtn = document.getElementById("vaultActionBtn");
  const vaultCancelBtn = document.getElementById("vaultCancelBtn");
  const vaultPasswordToggle = document.getElementById("vaultPasswordToggle");
  const vaultConfirmToggle = document.getElementById("vaultConfirmToggle");

  optionalListener(
    elements.vaultExportBtn,
    "click",
    () => {
      openVaultModal("export");
    },
    "Vault export button"
  );

  optionalListener(
    elements.vaultImportBtn,
    "click",
    () => {
      if (elements.vaultImportFile) elements.vaultImportFile.click();
    },
    "Vault import button"
  );

  optionalListener(
    elements.vaultImportFile,
    "change",
    function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) {
        openVaultModal("import", file);
        e.target.value = "";
      }
    },
    "Vault import file input"
  );

  optionalListener(
    vaultCloseBtn,
    "click",
    () => {
      if (typeof closeVaultModal === "function") closeVaultModal();
    },
    "Vault modal close button"
  );

  optionalListener(
    vaultActionBtn,
    "click",
    () => {
      if (typeof handleVaultAction === "function") handleVaultAction();
    },
    "Vault modal action button"
  );

  optionalListener(
    vaultCancelBtn,
    "click",
    () => {
      if (typeof closeVaultModal === "function") closeVaultModal();
    },
    "Vault modal cancel button"
  );

  optionalListener(
    vaultPasswordToggle,
    "click",
    () => {
      if (typeof toggleVaultPasswordVisibility === "function") {
        toggleVaultPasswordVisibility("vaultPassword", vaultPasswordToggle);
      }
    },
    "Vault password toggle"
  );

  optionalListener(
    vaultConfirmToggle,
    "click",
    () => {
      if (typeof toggleVaultPasswordVisibility === "function") {
        toggleVaultPasswordVisibility("vaultConfirmPassword", vaultConfirmToggle);
      }
    },
    "Vault confirm password toggle"
  );

  // Vault modal live password events
  const pw = document.getElementById("vaultPassword");
  const cpw = document.getElementById("vaultConfirmPassword");
  optionalListener(
    pw,
    "input",
    () => {
      updateStrengthBar(pw.value);
      if (cpw) updateMatchIndicator(pw.value, cpw.value);
    },
    "Vault password input"
  );
  optionalListener(
    cpw,
    "input",
    () => {
      if (pw) updateMatchIndicator(pw.value, cpw.value);
    },
    "Vault confirm password input"
  );

  // Image vault companion file picker (import mode only)
  const vaultImageImportFile = document.getElementById("vaultImageImportFile");
  optionalListener(
    vaultImageImportFile,
    "change",
    function (e) {
      const imgFile = e.target.files && e.target.files[0];
      if (!imgFile) return;
      const imgFileInfoEl = safeGetElement("vaultImageFileInfo");
      const imgPickerRowEl = safeGetElement("vaultImagePickerRow");
      const imgFileNameEl = safeGetElement("vaultImageFileName");
      const imgFileSizeEl = safeGetElement("vaultImageFileSize");
      if (imgFileNameEl) imgFileNameEl.textContent = imgFile.name;
      if (imgFileSizeEl && typeof formatFileSize === "function") {
        imgFileSizeEl.textContent = formatFileSize(imgFile.size);
      }
      if (imgFileInfoEl) imgFileInfoEl.style.display = "";
      if (imgPickerRowEl) imgPickerRowEl.style.display = "none";
      const imgReader = new FileReader();
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
    },
    "Vault image import file input"
  );

  // Attachment vault companion file picker (import mode only)
  const vaultAttachmentImportFile = document.getElementById("vaultAttachmentImportFile");
  optionalListener(
    vaultAttachmentImportFile,
    "change",
    function (e) {
      const attachFile = e.target.files && e.target.files[0];
      if (!attachFile) return;
      const attachFileInfoEl = safeGetElement("vaultAttachmentFileInfo");
      const attachPickerRowEl = safeGetElement("vaultAttachmentPickerRow");
      const attachFileNameEl = safeGetElement("vaultAttachmentFileName");
      const attachFileSizeEl = safeGetElement("vaultAttachmentFileSize");
      if (attachFileNameEl) attachFileNameEl.textContent = attachFile.name;
      if (attachFileSizeEl && typeof formatFileSize === "function") {
        attachFileSizeEl.textContent = formatFileSize(attachFile.size);
      }
      if (attachFileInfoEl) attachFileInfoEl.style.display = "";
      if (attachPickerRowEl) attachPickerRowEl.style.display = "none";
      const attachReader = new FileReader();
      attachReader.onload = function (ev) {
        if (typeof setVaultPendingAttachmentFile === "function") {
          setVaultPendingAttachmentFile(new Uint8Array(ev.target.result));
        }
      };
      attachReader.onerror = function () {
        debugLog("[Vault] Failed to read attachment file", "error");
        if (attachFileInfoEl) attachFileInfoEl.style.display = "none";
        if (attachPickerRowEl) attachPickerRowEl.style.display = "";
      };
      attachReader.readAsArrayBuffer(attachFile);
      e.target.value = "";
    },
    "Vault attachment import file input"
  );
};

/**
 * Sets up data-destructive action listeners (remove data, boating accident).
 */
const setupDataManagementListeners = () => {
  optionalListener(
    elements.removeInventoryDataBtn,
    "click",
    async () => {
      const confirmed =
        typeof showAppConfirm === "function"
          ? await showAppConfirm(
              "Remove all inventory items? This cannot be undone.",
              "Data Management"
            )
          : false;
      if (confirmed) {
        localStorage.removeItem(LS_KEY);
        // STACK-62: Clear stale autocomplete cache so it rebuilds from fresh inventory
        if (typeof clearLookupCache === "function") clearLookupCache();
        await loadInventory();
        renderTable();
        renderActiveFilters();
        if (typeof showAppAlert === "function")
          await showAppAlert("Inventory data cleared.", "Data Management");
      }
    },
    "Remove inventory data button"
  );

  optionalListener(
    elements.boatingAccidentBtn,
    "click",
    async () => {
      const confirmed =
        typeof showAppConfirm === "function"
          ? await showAppConfirm(
              "Did you really lose it all in a boating accident? This will wipe all local data.",
              "Data Management"
            )
          : false;
      if (confirmed) {
        // Nuclear wipe: clear every allowed localStorage key
        ALLOWED_STORAGE_KEYS.forEach((key) => {
          localStorage.removeItem(key);
        });
        sessionStorage.clear();

        // Clear IndexedDB image cache
        if (window.imageCache && typeof imageCache.clearAll === "function") {
          imageCache.clearAll().catch(() => {});
        }

        // Reset in-memory log/history arrays
        if (typeof changeLog !== "undefined") changeLog = [];
        if (typeof catalogHistory !== "undefined") catalogHistory = [];
        if (typeof spotHistory !== "undefined") spotHistory = [];

        // Disconnect cloud providers (UI reset)
        if (typeof syncCloudUI === "function") syncCloudUI();

        await loadInventory();
        renderTable();
        renderActiveFilters();
        loadSpotHistory();
        fetchSpotPrice();
        // Backfill 24h of hourly data after wipe — runs unconditionally since apiConfig
        // is cleared at this point and fetchSpotPrice won't trigger the internal backfill.
        // fetchStaktrakrHourlyRange's existingKeys dedup prevents double-inserts if
        // fetchSpotPrice does happen to succeed with a configured provider.
        if (typeof backfillStaktrakrHourly === "function") {
          backfillStaktrakrHourly()
            .then(() => {
              if (typeof updateAllSparklines === "function") updateAllSparklines();
            })
            .catch((err) => {
              console.warn("[StakTrakr] Post-reset backfill failed:", err);
            });
        }

        apiConfig = { provider: "", keys: {} };
        apiCache = null;
        updateSyncButtonStates();

        if (typeof showAppAlert === "function")
          await showAppAlert(
            "All data has been erased. Hope your scuba gear is ready!",
            "Data Management"
          );
      }
    },
    "Boating accident button"
  );

  optionalListener(
    elements.forceRefreshBtn,
    "click",
    async () => {
      if (!navigator.onLine) {
        if (typeof showAppAlert === "function")
          await showAppAlert(
            "Clear Cache & Reload requires an internet connection. Your cached app is still available.",
            "Clear Cache & Reload"
          );
        return;
      }
      const confirmed =
        typeof showAppConfirm === "function"
          ? await showAppConfirm(
              "This will clear the cached files and reload the app with the latest version. Your inventory data will not be affected.",
              "Clear Cache & Reload"
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
    },
    "Force refresh button"
  );
};

/**
 * Sets up import/export event listeners (CSV, JSON, Numista, PDF, Vault, etc.)
 */
const setupImportExportListeners = () => {
  debugLog("Setting up import/export listeners...");

  // Import pairs: Import button / File-input for each format (Merge buttons removed — all imports route through DiffModal)
  setupFormatImport(elements.importCsvOverride, null, elements.importCsvFile, importCsv, "CSV");
  setupFormatImport(elements.importJsonOverride, null, elements.importJsonFile, importJson, "JSON");
  setupFormatImport(
    document.getElementById("importNumistaBtn"),
    null,
    elements.numistaImportFile,
    importNumistaCsv,
    "Numista CSV"
  );

  // Export buttons
  optionalListener(elements.exportCsvBtn, "click", exportCsv, "CSV export");
  optionalListener(elements.exportJsonBtn, "click", exportJson, "JSON export");
  optionalListener(elements.exportPdfBtn, "click", exportPdf, "PDF export");
  optionalListener(elements.printBtn, "click", printInventory, "Print inventory");
  optionalListener(
    document.getElementById("exportZipBtn"),
    "click",
    () => {
      if (typeof createBackupZip === "function") createBackupZip();
    },
    "ZIP export"
  );

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
  optionalListener(
    elements.cloudSyncBtn,
    "click",
    () => {
      if (elements.cloudSyncModal) {
        if (window.openModalById) openModalById("cloudSyncModal");
        else elements.cloudSyncModal.style.display = "flex";
      }
    },
    "Cloud Sync button"
  );
  const cloudSyncCloseBtn = document.getElementById("cloudSyncCloseBtn");
  if (cloudSyncCloseBtn && elements.cloudSyncModal) {
    safeAttachListener(
      cloudSyncCloseBtn,
      "click",
      () => {
        if (window.closeModalById) closeModalById("cloudSyncModal");
        else elements.cloudSyncModal.style.display = "none";
      },
      "Cloud Sync close"
    );
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
          itemsPerPage = ippVal === "all" ? Infinity : parseInt(ippVal, 10);
          // Persist setting
          try {
            localStorage.setItem(ITEMS_PER_PAGE_KEY, ippVal);
          } catch (e) {
            /* ignore */
          }
          // Sync settings modal control
          const settingsIpp = document.getElementById("settingsItemsPerPage");
          if (settingsIpp) settingsIpp.value = ippVal;
          renderTable();
        },
        "Visible rows select"
      );
    }

    debugLog("✓ Visible-rows listener setup complete");
  } catch (error) {
    console.error("❌ Error setting up visible-rows listener:", error);
  }

  // Back to top floating button
  const backToTopBtn = document.getElementById("backToTopBtn");
  if (backToTopBtn) {
    if (!window._backToTopInitialized) {
      window.addEventListener(
        "scroll",
        () => {
          backToTopBtn.classList.toggle("visible", window.scrollY > 300);
        },
        { passive: true }
      );
      backToTopBtn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
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
    const bulkToggleAll = document.getElementById("bulkToggleAll");
    if (bulkToggleAll) {
      safeAttachListener(
        bulkToggleAll,
        "click",
        function () {
          if (typeof window.toggleAllItemsEdit === "function") {
            window.toggleAllItemsEdit();
          }
        },
        "Bulk toggle all edit mode"
      );
    }

    // Bulk save all changes
    const bulkSaveAll = document.getElementById("bulkSaveAll");
    if (bulkSaveAll) {
      safeAttachListener(
        bulkSaveAll,
        "click",
        function () {
          if (typeof window.saveAllEdits === "function") {
            window.saveAllEdits();
          }
        },
        "Bulk save all changes"
      );
    }

    // Bulk cancel all changes
    const bulkCancelAll = document.getElementById("bulkCancelAll");
    if (bulkCancelAll) {
      safeAttachListener(
        bulkCancelAll,
        "click",
        function () {
          if (typeof window.cancelAllEdits === "function") {
            window.cancelAllEdits();
          }
        },
        "Bulk cancel all changes"
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
        searchQuery = this.value.replace(/[<>]/g, "").trim();
        renderTable();
      }, 300);
      safeAttachListener(elements.searchInput, "input", handleSearchInput, "Search input");
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
        "Type filter select"
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
        "Metal filter select"
      );
    }

    if (elements.clearBtn) {
      safeAttachListener(elements.clearBtn, "click", clearAllFilters, "Clear search button");
    }

    if (elements.newItemBtn) {
      safeAttachListener(
        elements.newItemBtn,
        "click",
        () => {
          // STRK-84: defensive clear of stale picker snapshot
          window.pendingNumistaPickerSnapshot = null;
          // Clear editing state (ensures add mode)
          editingIndex = null;
          editingChangeLogIndex = null;
          // Reset form and set defaults
          if (elements.inventoryForm) {
            elements.inventoryForm.reset();
            elements.itemWeightUnit.value = "oz";
            elements.itemDate.value = todayStr();
            resetPurchasePriceToggle();
            if (typeof updateCapsuleSuggestion === "function") updateCapsuleSuggestion("");
          }
          // STAK-580: form.reset() honors `selected` on the placeholder, but be
          // explicit so this stays correct if the HTML ever changes.
          if (elements.itemMetal) elements.itemMetal.value = "";
          if (elements.itemType) elements.itemType.value = "";
          if (elements.itemSerial) elements.itemSerial.value = "";
          if (elements.itemCatalog) elements.itemCatalog.value = "";
          wirePendingAddItemTags();
          // Reset spot lookup state (STACK-49)
          if (typeof syncSpotLookupButtons === "function") {
            syncSpotLookupButtons(!!elements.itemDate.value);
          }
          // Set modal to add mode
          if (elements.itemModalTitle) elements.itemModalTitle.textContent = "Add Inventory Item";
          if (elements.itemModalSubmit) elements.itemModalSubmit.textContent = "Add to Inventory";
          if (elements.undoChangeBtn) elements.undoChangeBtn.style.display = "none";
          // Reset purity to default (form.reset already sets select to first option)
          const purityCustom = elements.purityCustomWrapper;
          if (purityCustom) purityCustom.style.display = "none";
          if (elements.itemPurity) elements.itemPurity.value = "";
          // Reset gb denomination picker (STACK-45)
          if (typeof toggleGbDenomPicker === "function") toggleGbDenomPicker();
          if (elements.itemMetal && typeof filterTypesByMetal === "function") {
            filterTypesByMetal(elements.itemMetal.value);
          }
          if (typeof handleTypeChange === "function") handleTypeChange();
          // Hide PCGS verified icon in add mode
          const certVerifiedIcon = document.getElementById("certVerifiedIcon");
          if (certVerifiedIcon) certVerifiedIcon.style.display = "none";
          // Hide price history link in add mode (STAK-109)
          const addRetailHistoryLink = document.getElementById("retailPriceHistoryLink");
          if (addRetailHistoryLink) addRetailHistoryLink.style.display = "none";
          // Update currency symbols in modal (STACK-50)
          if (typeof updateModalCurrencyUI === "function") updateModalCurrencyUI();
          // Clear image upload state for fresh add (STACK-32)
          if (typeof clearUploadState === "function") clearUploadState();
          // Hide inline URL inputs in add mode
          ["Obv", "Rev"].forEach((s) => {
            const urlInput = document.getElementById("itemImageUrlInput" + s);
            if (urlInput) urlInput.style.display = "none";
          });
          // Update Numista API status dot (STAK-173)
          if (typeof updateNumistaModalDot === "function") updateNumistaModalDot();
          // Hide clone/view/remove buttons in add mode (STAK-173, STAK-576 ISSUE-006)
          if (elements.cloneItemBtn) elements.cloneItemBtn.style.display = "none";
          if (elements.viewItemFromEditBtn) elements.viewItemFromEditBtn.style.display = "none";
          const deleteFromEditBtnAddReset = safeGetElement("deleteFromEditBtn");
          if (deleteFromEditBtnAddReset) deleteFromEditBtnAddReset.style.display = "none";
          // Reset date N/A toggle button
          if (elements.itemDateNABtn) {
            elements.itemDateNABtn.classList.remove("active");
            elements.itemDateNABtn.setAttribute("aria-pressed", "false");
          }
          if (elements.itemDate) elements.itemDate.disabled = false;
          // STRK-301: apply remembered/default section disclosure to the reset form
          if (typeof prepareFormSections === "function") prepareFormSections();
          // Open modal
          if (elements.itemModal) {
            if (window.openModalById) openModalById("itemModal");
            else elements.itemModal.style.display = "flex";
          }
        },
        "New item button"
      );
    }

    // Chip minimum count control
    const chipMinCountEl = document.getElementById("chipMinCount");
    if (chipMinCountEl) {
      safeAttachListener(
        chipMinCountEl,
        "change",
        function () {
          localStorage.setItem("chipMinCount", this.value);
          if (typeof renderActiveFilters === "function") {
            renderActiveFilters();
          }
          if (typeof scheduleSyncPush === "function") scheduleSyncPush();
        },
        "Chip minimum count select"
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
    btn.classList.remove("dark", "light", "sepia", "slate");
    btn.classList.add(savedTheme);
  });

  // Update settings modal theme picker active state
  document.querySelectorAll(".theme-option").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === savedTheme);
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
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
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
          if (e.target === infoModal && typeof hideProviderInfo === "function") {
            hideProviderInfo();
          }
        },
        "Provider info modal background"
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
        "Provider info close"
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
        "API save button"
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
        "API sync button"
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
        "API clear key button"
      );
    });

    const quotaClose = document.getElementById("apiQuotaCloseBtn");
    if (quotaClose && elements.apiQuotaModal) {
      safeAttachListener(
        quotaClose,
        "click",
        () => (elements.apiQuotaModal.style.display = "none"),
        "API quota close"
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
            if (!cfg.usage[qp]) cfg.usage[qp] = { quota: val, used: 0 };
            cfg.usage[qp].quota = val;
            saveApiConfig(cfg);
            elements.apiQuotaModal.style.display = "none";
            updateProviderHistoryTables();
          }
        },
        "API quota save"
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
            if (await appConfirm(warnMessage, "Flush API Cache")) {
              clearApiCache();
            }
          }
        },
        "Flush cache button"
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
        "API history button"
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
        "Catalog history button"
      );
    }

    const syncAllBtn = document.getElementById("syncAllBtn");
    if (syncAllBtn) {
      safeAttachListener(
        syncAllBtn,
        "click",
        async () => {
          if (typeof syncProviderChain === "function") {
            const { updatedCount, anySucceeded, results } = await syncProviderChain({
              showProgress: true,
              forceSync: true,
            });
            if (typeof showToast === "function") {
              if (updatedCount > 0) {
                const providerName = Object.entries(results).find(([_, s]) => s === "ok")?.[0];
                const label = providerName
                  ? API_PROVIDERS[providerName]?.name || providerName
                  : "API";
                showToast(`\u2713 Synced ${updatedCount} prices from ${label}`);
              } else if (!anySucceeded) {
                showToast("Spot sync failed \u2014 check API settings");
              }
            }
          }
        },
        "Sync all providers button"
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
        "API history modal background"
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
        "API history close button"
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
        "Catalog history modal background"
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
        "Catalog history close button"
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
          } else if (quotaModal && quotaModal.style.display === "flex") {
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
      "ESC key modal close"
    );

    debugLog("✓ API events setup complete");
  } catch (error) {
    console.error("❌ Error setting up API events:", error);
  }
};

// =============================================================================

// _openCloudSyncPopover() removed (STRK-287). It rendered an inline "Vault
// Password" popover under the header cloud button, but it had ZERO callers —
// nothing in the app could ever open it, so the whole flow was unreachable.
// It went out with the header button rather than being left as an orphan the
// next retirement would have to re-prove is dead. Passphrase entry lives in
// #cloudSyncPasswordModal (js/cloud-sync.js), which is unaffected.

function handleAdvancedSavePassword() {
  const input = safeGetElement("cloudAdvancedNewPassword");
  const errorEl = safeGetElement("cloudAdvancedPasswordError");
  if (!input) return;
  const pw = input.value;
  if (!pw || pw.length < 8) {
    if (errorEl) {
      errorEl.textContent = "Password must be at least 8 characters.";
      errorEl.style.display = "";
    }
    return;
  }
  if (errorEl) errorEl.style.display = "none";
  input.value = "";
  if (typeof changeVaultPassword === "function") {
    changeVaultPassword(pw)
      .then(function (ok) {
        if (!ok && errorEl) {
          errorEl.textContent = "Failed to update password.";
          errorEl.style.display = "";
        }
      })
      .catch(function (err) {
        if (errorEl) {
          errorEl.textContent = "An error occurred — try again.";
          errorEl.style.display = "";
        }
        if (typeof debugLog === "function") debugLog("[Cloud] changeVaultPassword threw:", err);
      });
  }
}
window.handleAdvancedSavePassword = handleAdvancedSavePassword;
window.buildNumistaSearchQuery = buildNumistaSearchQuery;
// Expose the Numista dot refresher + config gate for Playwright tests
// (STAK-576 ISSUE-005). Both already run internally on modal open and
// catalog-config save paths — these exports just make them observable
// from `page.evaluate()`.
window.updateNumistaModalDot = updateNumistaModalDot;
window.ensureNumistaConfiguredOrPrompt = ensureNumistaConfiguredOrPrompt;

// =============================================================================
// Remove Item modal event listeners (STAK-72)
// =============================================================================

// Checkbox toggles disposition fields + footer buttons
const removeItemDisposeCheck = document.getElementById("removeItemDisposeCheck");
if (removeItemDisposeCheck) {
  removeItemDisposeCheck.addEventListener("change", () => {
    const checked = removeItemDisposeCheck.checked;
    const fields = document.getElementById("removeItemDisposeFields");
    const deleteBtn = document.getElementById("removeItemDeleteBtn");
    const disposeBtn = document.getElementById("removeItemDisposeBtn");
    const title = document.getElementById("removeItemModalTitle");
    if (fields) fields.style.display = checked ? "" : "none";
    if (deleteBtn) deleteBtn.style.display = checked ? "none" : "";
    if (disposeBtn) disposeBtn.style.display = checked ? "" : "none";
    if (title) title.textContent = checked ? "Dispose Item" : "Remove Item";
  });
}

// Delete button (plain delete, no disposition)
const removeItemDeleteBtn = document.getElementById("removeItemDeleteBtn");
if (removeItemDeleteBtn) {
  removeItemDeleteBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof confirmRemoveItem === "function") confirmRemoveItem();
  });
}

// Dispose button (disposition flow)
const removeItemDisposeBtn = document.getElementById("removeItemDisposeBtn");
if (removeItemDisposeBtn) {
  removeItemDisposeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (typeof confirmRemoveItem === "function") confirmRemoveItem();
  });
}

// Disposition type changes show/hide amount field
let _pendingTradeLinkUuids = [];

const tradeEls = () => ({
  section: document.getElementById("tradeLinkSection"),
  search: document.getElementById("tradeItemSearch"),
  suggestions: document.getElementById("tradeItemSuggestions"),
  linked: document.getElementById("tradeLinkedItems"),
  summary: document.getElementById("tradeValueSummary"),
});

const getTradeDate = () => {
  const val = document.getElementById("dispositionDate")?.value;
  return val || new Date().toLocaleDateString("en-CA");
};

// nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
const renderPendingTradeLinks = () => {
  const { linked, summary } = tradeEls();
  if (!linked) return;
  let total = 0;
  // developer-controlled HTML — all values pass through sanitizeHtml()
  linked.innerHTML = _pendingTradeLinkUuids // duplication-ok
    .map((uuid) => {
      const item = typeof findItemByUuid === "function" ? findItemByUuid(uuid) : null;
      if (!item) return "";
      const value =
        typeof computeTradeValue === "function" ? computeTradeValue(item, getTradeDate()) : null;
      const meltValue = value?.meltValue || 0;
      total += meltValue;
      const name = sanitizeHtml(item.name || "Unnamed item");
      return `<span class="trade-linked-chip" data-uuid="${sanitizeHtml(uuid)}">${name}<button type="button" class="chip-remove" data-remove-trade-uuid="${sanitizeHtml(uuid)}">&times;</button></span>`;
    })
    .join("");
  if (summary) summary.textContent = total > 0 ? formatCurrency(total) : "";
  const dispositionAmount = document.getElementById("dispositionAmount");
  if (dispositionAmount && total > 0 && !dispositionAmount.value) {
    dispositionAmount.value = total.toFixed(2);
  }
};

window.getPendingTradeLinkUuids = () => [..._pendingTradeLinkUuids];
window.addPendingTradeLinkUuid = (uuid) => {
  if (uuid && !_pendingTradeLinkUuids.includes(uuid)) _pendingTradeLinkUuids.push(uuid);
  renderPendingTradeLinks();
};
window.resetPendingTradeLinks = () => {
  _pendingTradeLinkUuids = [];
  const { search, suggestions } = tradeEls();
  if (search) search.value = "";
  if (suggestions) suggestions.innerHTML = "";
  renderPendingTradeLinks();
};

const updateTradeSectionVisibility = () => {
  const { section } = tradeEls();
  if (section) section.style.display = dispositionTypeSelect?.value === "traded" ? "" : "none";
};

const dispositionTypeSelect = document.getElementById("dispositionType");
if (dispositionTypeSelect) {
  dispositionTypeSelect.addEventListener("change", () => {
    const typeInfo = DISPOSITION_TYPES[dispositionTypeSelect.value];
    const amountGroup = document.getElementById("dispositionAmountGroup");
    if (amountGroup) amountGroup.style.display = typeInfo?.requiresAmount ? "" : "none";
    const amountInput = document.getElementById("dispositionAmount");
    if (!typeInfo || !typeInfo.requiresAmount) {
      if (amountInput) amountInput.value = "";
    }
    if (amountInput) {
      const placeholders = { traded: "Trade value", sold: "Sale amount" };
      amountInput.placeholder = placeholders[dispositionTypeSelect.value] || "Amount";
    }
    updateTradeSectionVisibility();
  });
}

const dispositionDateInput = document.getElementById("dispositionDate");
if (dispositionDateInput) {
  dispositionDateInput.addEventListener("change", () => {
    if (_pendingTradeLinkUuids.length > 0) renderPendingTradeLinks();
  });
}

const tradeSearch = document.getElementById("tradeItemSearch");
if (tradeSearch) {
  tradeSearch.addEventListener("input", () => {
    const { suggestions } = tradeEls();
    if (!suggestions) return;
    const searchIcon = tradeSearch.parentElement?.querySelector(".trade-search-icon");
    const query = tradeSearch.value.trim().toLowerCase();
    if (!query) {
      suggestions.innerHTML = "";
      if (searchIcon) searchIcon.style.display = "";
      return;
    }
    const removeIdx = parseInt(document.getElementById("removeItemIdx")?.value, 10);
    const sourceUuid = inventory[removeIdx]?.uuid;
    const matches = inventory
      .filter((item, idx) => idx !== removeIdx && (!sourceUuid || item.uuid !== sourceUuid))
      .filter((item) => (item.name || "").toLowerCase().includes(query))
      .slice(0, 8);
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    suggestions.innerHTML = matches // developer-controlled HTML — sanitizeHtml on all values
      .map((item) => {
        const metaParts = [sanitizeHtml(item.metal || "")];
        if (item.year) metaParts.push(sanitizeHtml(String(item.year)));
        if (item.grade) metaParts.push(sanitizeHtml(String(item.grade)));
        metaParts.push("Qty " + (Number(item.qty) || 1));
        const meta = metaParts.filter(Boolean).join(" · ");
        const badge = isDisposed(item)
          ? ` <span class="disposition-badge disposition-badge--${sanitizeHtml(item.disposition.type)}">${sanitizeHtml(DISPOSITION_TYPES[item.disposition.type]?.label || item.disposition.type)}</span>`
          : "";
        return `<div class="trade-item-suggestion" role="option" tabindex="0" data-trade-uuid="${sanitizeHtml(item.uuid)}"><span class="result-name">${sanitizeHtml(item.name || "Unnamed item")}</span><span class="result-meta">${meta}${badge}</span></div>`;
      })
      .join("");
    if (searchIcon) searchIcon.style.display = suggestions.innerHTML ? "none" : "";
  });
}

document.addEventListener("click", (event) => {
  const option = event.target.closest("[data-trade-uuid]");
  if (option) {
    window.addPendingTradeLinkUuid(option.dataset.tradeUuid);
    const { search, suggestions } = tradeEls();
    if (search) search.value = "";
    if (suggestions) suggestions.innerHTML = "";
    const searchIcon = search?.parentElement?.querySelector(".trade-search-icon");
    if (searchIcon) searchIcon.style.display = "";
  }
  const remove = event.target.closest("[data-remove-trade-uuid]");
  if (remove) {
    _pendingTradeLinkUuids = _pendingTradeLinkUuids.filter(
      (uuid) => uuid !== remove.dataset.removeTradeUuid
    );
    renderPendingTradeLinks();
  }
});

const tradeSuggestionsEl = document.getElementById("tradeItemSuggestions");
if (tradeSuggestionsEl) {
  tradeSuggestionsEl.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const option = event.target.closest("[data-trade-uuid]");
    if (!option) return;
    event.preventDefault();
    window.addPendingTradeLinkUuid(option.dataset.tradeUuid);
    const { search, suggestions } = tradeEls();
    if (search) search.value = "";
    if (suggestions) suggestions.innerHTML = "";
    const searchIcon = search?.parentElement?.querySelector(".trade-search-icon");
    if (searchIcon) searchIcon.style.display = "";
  });
}

const tradeAddNewItemBtn = document.getElementById("tradeAddNewItemBtn");
if (tradeAddNewItemBtn) {
  tradeAddNewItemBtn.addEventListener("click", () => {
    window.__tradeAddNewPending = true;
    const itemModal = document.getElementById("itemModal");
    if (itemModal) itemModal.style.zIndex = "10001";
    document.getElementById("newItemBtn")?.click();
  });
}

// Delete/dispose from edit modal — close edit modal, open remove item modal
const deleteFromEditBtn = document.getElementById("deleteFromEditBtn");
if (deleteFromEditBtn) {
  deleteFromEditBtn.addEventListener("click", () => {
    const idx = typeof editingIndex !== "undefined" ? editingIndex : null;
    if (idx === null || idx === undefined) return;
    closeModalById("itemModal");
    if (typeof openRemoveItemModal === "function") openRemoveItemModal(idx, false);
  });
}

// Activity Log link inside remove-item modal
const removeItemOpenLog = document.getElementById("removeItemOpenLog");
if (removeItemOpenLog) {
  removeItemOpenLog.addEventListener("click", (e) => {
    e.preventDefault();
    closeModalById("removeItemModal");
    if (typeof openModalById === "function") openModalById("changeLogModal");
  });
}

// Dispose modal Lot/Each toggle button wiring
// Uses document.getElementById because safeGetElement (init.js) loads after events.js
const removeItemAmountModeToggle = document.getElementById("removeItemAmountModeToggle");
if (removeItemAmountModeToggle) {
  Array.from(removeItemAmountModeToggle.children)
    .filter((child) => child.dataset?.mode)
    .forEach((button) => {
      button.addEventListener("click", () => {
        disposeAmountToggle.setMode(button.dataset.mode, { convertInput: true });
      });
    });
}

// Dispose qty input updates toggle visibility and placeholder
const removeItemQtyInput = document.getElementById("removeItemQty");
if (removeItemQtyInput) {
  removeItemQtyInput.addEventListener("input", () => {
    disposeAmountToggle.updateVisibility();
    disposeAmountToggle.updatePlaceholder();
  });
}

// STRK-44: Restore-choice modal — wire X button to click the Cancel action button
const restoreChoiceModalEl = document.getElementById("restoreChoiceModal");
if (restoreChoiceModalEl) {
  const restoreCloseBtn = restoreChoiceModalEl.querySelector(".modal-close");
  if (restoreCloseBtn) {
    restoreCloseBtn.addEventListener("click", () => {
      const cancelBtn = restoreChoiceModalEl.querySelector('[data-action="cancel"]');
      if (cancelBtn) cancelBtn.click();
    });
  }
}

// =============================================================================
// Appearance > Layout — show/hide realized G/L row (STAK-72/STAK-436)
// =============================================================================

const settingsShowRealizedToggle = document.getElementById("settingsShowRealizedToggle");
const storedShowRealized = loadDataSync(SHOW_REALIZED_KEY, "true");
const showRealizedOnLoad = storedShowRealized !== "false";
applyRealizedVisibility(showRealizedOnLoad);

if (settingsShowRealizedToggle) {
  window.syncChipToggle("settingsShowRealizedToggle", showRealizedOnLoad);

  settingsShowRealizedToggle.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-sort-btn");
    if (!btn) return;
    if (btn.classList.contains("active")) return;

    const show = btn.dataset.val === "yes";
    window.syncChipToggle("settingsShowRealizedToggle", show);
    saveData(SHOW_REALIZED_KEY, show ? "true" : "false");
    applyRealizedVisibility(show);
  });
}

// =============================================================================
// Attachment drop zone + browse button event wiring (STRK-45)
// =============================================================================

const attachmentDropZone =
  typeof safeGetElement === "function"
    ? safeGetElement("attachmentDropZone")
    : document.getElementById("attachmentDropZone");
const attachmentFileInput =
  typeof safeGetElement === "function"
    ? safeGetElement("attachmentFileInput")
    : document.getElementById("attachmentFileInput");
const attachmentBrowseBtn =
  typeof safeGetElement === "function"
    ? safeGetElement("attachmentBrowseBtn")
    : document.getElementById("attachmentBrowseBtn");

if (attachmentDropZone) {
  attachmentDropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    attachmentDropZone.classList.add("drag-over");
  });
  attachmentDropZone.addEventListener("dragleave", () => {
    attachmentDropZone.classList.remove("drag-over");
  });
  attachmentDropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    attachmentDropZone.classList.remove("drag-over");
    Array.from(e.dataTransfer.files).forEach(queueAttachmentFile);
  });
}

if (attachmentFileInput) {
  attachmentFileInput.addEventListener("change", (e) => {
    Array.from(e.target.files).forEach(queueAttachmentFile);
    e.target.value = "";
  });
}

if (attachmentBrowseBtn && attachmentFileInput) {
  attachmentBrowseBtn.addEventListener("click", () => attachmentFileInput.click());
}

window.queueAttachmentFile = queueAttachmentFile;
window.clearAttachmentQueue = clearAttachmentQueue;
window.dequeueAttachment = dequeueAttachment;

// =============================================================================

// Early cleanup of stray localStorage entries before application initialization
document.addEventListener("DOMContentLoaded", cleanupStorage);
