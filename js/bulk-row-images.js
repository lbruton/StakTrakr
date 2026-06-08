// BULK-EDIT ROW IMAGES (STRK-169)
// =============================================================================
// Image-thumbnail loading and the inline photo-management popover for the Bulk
// Edit table. Extracted verbatim from js/bulkEdit.js to keep each file under the
// Codacy per-file NLOC gate (Lizard file-nloc < 1500). Pure code motion — no
// behavior change. MUST load AFTER js/bulkEdit.js: these helpers read the
// _bulkBlobUrls Set that bulkEdit.js owns (revoked on modal close) and run only
// at render time via bulkEdit.js (buildBulkItemRow / renderBulkTableBody), so
// every cross-file reference resolves at call time.
// =============================================================================

/**
 * Reads tableImageSides setting and returns which sides to display.
 * @returns {{ showObv: boolean, showRev: boolean }}
 */
const _getBulkImageSides = () => {
  const sides = localStorage.getItem("tableImageSides") || "both";
  return {
    showObv: sides === "both" || sides === "obverse",
    showRev: sides === "both" || sides === "reverse",
  };
};

/**
 * Resolves IDB images for one item and injects <img> elements into its
 * IMG cell, replacing the placeholder. Respects tableImageSides setting.
 * Blob URLs are tracked in _bulkBlobUrls for cleanup on modal close.
 *
 * @param {HTMLTableRowElement} tr
 * @param {Object} item
 */
const _loadBulkRowImages = async (tr, item) => {
  const imgTd = tr.querySelector(".bulk-img-cell");
  if (!imgTd) return;

  // IDB unavailable (e.g. file:// protocol) — fall back to URL strings only
  if (!window.imageCache?.isAvailable()) {
    const { showObv, showRev } = _getBulkImageSides();
    imgTd.innerHTML = "";
    if (showObv && item.obverseImageUrl) {
      const img = document.createElement("img");
      img.src = item.obverseImageUrl;
      img.alt = "";
      img.className = "bulk-img-thumb";
      img.dataset.side = "obverse";
      img.onerror = () => {
        img.style.display = "none";
      };
      imgTd.appendChild(img);
    }
    if (showRev && item.reverseImageUrl) {
      const img = document.createElement("img");
      img.src = item.reverseImageUrl;
      img.alt = "";
      img.className = "bulk-img-thumb";
      img.dataset.side = "reverse";
      img.onerror = () => {
        img.style.display = "none";
      };
      imgTd.appendChild(img);
    }
    if (!imgTd.querySelector("img")) imgTd.innerHTML = '<span class="bulk-img-placeholder"></span>';
    return;
  }

  const { showObv, showRev } = _getBulkImageSides();

  // Per-side cascade: user upload → pattern → CDN URL (each side independent)
  if (!tr.isConnected) return;

  const _getUrl = async (side) => {
    const url = await imageCache.resolveImageUrlForItem(item, side);
    if (url) {
      _bulkBlobUrls.add(url);
      return url;
    }
    // Fall back to CDN URL strings on item
    return side === "obverse" ? item.obverseImageUrl || null : item.reverseImageUrl || null;
  };

  const obvUrl = showObv ? await _getUrl("obverse") : null;
  const revUrl = showRev ? await _getUrl("reverse") : null;

  // Build replacement content
  imgTd.innerHTML = "";

  const _makeImg = (url, side) => {
    const img = document.createElement("img");
    img.alt = "";
    img.className = "bulk-img-thumb";
    img.dataset.side = side;
    if (url) {
      img.src = url;
      img.onerror = () => {
        img.style.display = "none";
      };
    } else {
      img.style.display = "none";
    }
    return img;
  };

  const _makePh = () => {
    const ph = document.createElement("span");
    ph.className = "bulk-img-placeholder";
    return ph;
  };

  const hasAny = obvUrl || revUrl;

  if (showObv) imgTd.appendChild(obvUrl ? _makeImg(obvUrl, "obverse") : _makePh());
  if (showRev) imgTd.appendChild(revUrl ? _makeImg(revUrl, "reverse") : _makePh());

  if (!hasAny) {
    // Nothing resolved — ensure at least one placeholder is visible
    if (!imgTd.querySelector(".bulk-img-placeholder")) imgTd.appendChild(_makePh());
  }
};

/**
 * Opens a small inline image-management popover anchored to the IMG cell.
 * Lets the user upload obverse/reverse photos or remove existing ones for
 * a single item. Saves directly to imageCache and refreshes that row.
 *
 * @param {HTMLTableDataCellElement} imgTd
 * @param {Object} item
 */
const _openBulkImagePopover = (imgTd, item) => {
  // Remove any existing popover first
  const existing = document.getElementById("bulkImagePopover");
  if (existing) {
    existing.remove();
    // If clicking the same cell again, just close
    if (existing.dataset.forSerial === String(item.serial)) return;
  }

  const { showObv, showRev } = _getBulkImageSides();

  const pop = document.createElement("div");
  pop.id = "bulkImagePopover";
  pop.className = "bulk-img-popover";
  pop.dataset.forSerial = String(item.serial);

  const _sideHtml = (key, label) => `
    <div class="bulk-img-popover-side">
      <span class="bulk-img-popover-label">${label}</span>
      <div class="bulk-img-popover-preview" id="bulkPop${key}Preview"></div>
      <div class="bulk-img-popover-actions">
        <input type="file" id="bulkPop${key}File" accept="image/jpeg,image/png,image/webp" style="display:none" />
        <button class="btn btn-sm" id="bulkPop${key}Upload" type="button">Upload</button>
        <button class="btn btn-sm btn-danger" id="bulkPop${key}Remove" type="button" style="display:none">Remove</button>
      </div>
    </div>`;

  pop.innerHTML = `
    <div class="bulk-img-popover-header">
      <span class="bulk-img-popover-title">Photos</span>
      <button class="bulk-img-popover-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="bulk-img-popover-sides">
      ${showObv ? _sideHtml("Obv", "Obverse") : ""}
      ${showRev ? _sideHtml("Rev", "Reverse") : ""}
    </div>
  `;

  // Position below the cell
  document.body.appendChild(pop);
  const rect = imgTd.getBoundingClientRect();
  const popW = 260;
  // position: fixed — coords are viewport-relative, no scroll offset needed
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  let top = rect.bottom + 4;
  // Flip above cell if popover would overflow viewport bottom
  if (top + 280 > window.innerHeight) top = rect.top - 284;
  pop.style.top = Math.max(4, top) + "px";
  pop.style.left = Math.max(4, left) + "px";

  // --- Close ---
  const closePopover = () => pop.remove();
  pop.querySelector(".bulk-img-popover-close").addEventListener("click", closePopover);
  const _outsideClick = (e) => {
    if (!pop.contains(e.target) && e.target !== imgTd) {
      closePopover();
      document.removeEventListener("click", _outsideClick, true);
    }
  };
  setTimeout(() => document.addEventListener("click", _outsideClick, true), 10);

  // --- Load existing images into previews ---
  const _loadPreview = async (previewEl, removeBtn, side) => {
    let url = null;
    let source = null;

    if (window.imageCache?.isAvailable()) {
      // Try user image first for this specific side
      const userUrl = item.uuid ? await imageCache.getUserImageUrl(item.uuid, side) : null;
      if (userUrl) {
        url = userUrl;
        source = "user";
      } else {
        // Try pattern image for this side
        url = await imageCache.resolveImageUrlForItem(item, side);
        source = url ? "pattern" : null;
      }
    }

    if (!url) {
      url = side === "obverse" ? item.obverseImageUrl || null : item.reverseImageUrl || null;
    }
    if (!url && imgTd) {
      const rowThumb = imgTd.querySelector(`img.bulk-img-thumb[data-side="${side}"]`);
      if (rowThumb && rowThumb.src) {
        url = rowThumb.src;
      }
    }

    if (url) {
      _bulkBlobUrls.add(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = side;
      img.className = "bulk-img-popover-img";
      img.onerror = () => {
        img.style.display = "none";
      };
      previewEl.innerHTML = "";
      previewEl.appendChild(img);

      // "Remove" only applies to user-uploaded images stored in userImages.
      removeBtn.style.display = source === "user" ? "" : "none";
    } else {
      previewEl.innerHTML = '<span class="thumb-popover-empty">No image</span>';
      removeBtn.style.display = "none";
    }
  };

  const obvPreview = pop.querySelector("#bulkPopObvPreview");
  const revPreview = pop.querySelector("#bulkPopRevPreview");
  const obvRemove = pop.querySelector("#bulkPopObvRemove");
  const revRemove = pop.querySelector("#bulkPopRevRemove");

  if (showObv) _loadPreview(obvPreview, obvRemove, "obverse");
  if (showRev) _loadPreview(revPreview, revRemove, "reverse");

  // --- Upload handlers ---
  const _handleUpload = async (file, side) => {
    if (!file || typeof imageProcessor === "undefined") return;
    const result = await imageProcessor.processFile(file, {
      maxDim: typeof IMAGE_MAX_DIM !== "undefined" ? IMAGE_MAX_DIM : 600,
      maxBytes: typeof IMAGE_MAX_BYTES !== "undefined" ? IMAGE_MAX_BYTES : 512000,
    });
    if (!result?.blob) return;

    // Merge with existing (keep the other side if present)
    let obvBlob = side === "obverse" ? result.blob : null;
    let revBlob = side === "reverse" ? result.blob : null;
    try {
      const existing = await imageCache.getUserImage(item.uuid);
      if (existing) {
        if (!obvBlob && existing.obverse) obvBlob = existing.obverse;
        if (!revBlob && existing.reverse) revBlob = existing.reverse;
      }
    } catch (e) {
      /* ignore */
    }

    if (!obvBlob && revBlob) {
      obvBlob = revBlob;
      revBlob = null;
    }

    await imageCache.cacheUserImageWithFeedback(item.uuid, obvBlob, revBlob);

    // Refresh the preview in the popover
    const previewEl = side === "obverse" ? obvPreview : revPreview;
    const removeBtn = side === "obverse" ? obvRemove : revRemove;
    const previewUrl = URL.createObjectURL(result.blob);
    _bulkBlobUrls.add(previewUrl);
    previewEl.innerHTML = `<img src="${previewUrl}" alt="${side}" class="bulk-img-popover-img" />`;
    removeBtn.style.display = "";

    // Refresh the row thumbnail
    const tr = imgTd.closest("tr");
    if (tr) _loadBulkRowImages(tr, item);
  };

  const _wireUpload = (btnId, fileId, side) => {
    const btn = pop.querySelector("#" + btnId);
    const file = pop.querySelector("#" + fileId);
    if (!btn || !file) return;
    btn.addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      if (file.files[0]) _handleUpload(file.files[0], side);
    });
  };

  if (showObv) _wireUpload("bulkPopObvUpload", "bulkPopObvFile", "obverse");
  if (showRev) _wireUpload("bulkPopRevUpload", "bulkPopRevFile", "reverse");

  // --- Remove handlers ---
  const _handleRemove = async (side) => {
    if (!window.imageCache?.isAvailable()) return;
    const existing = await imageCache.getUserImage(item.uuid);
    if (!existing) return;

    const keepObv = side === "reverse" ? existing.obverse : null;
    const keepRev = side === "obverse" ? existing.reverse : null;

    if (!keepObv && !keepRev) {
      await imageCache.deleteUserImage(item.uuid);
    } else {
      await imageCache.cacheUserImage(item.uuid, keepObv, keepRev);
    }

    const previewEl = side === "obverse" ? obvPreview : revPreview;
    const removeBtn = side === "obverse" ? obvRemove : revRemove;
    previewEl.innerHTML = '<span class="thumb-popover-empty">No image</span>';
    removeBtn.style.display = "none";

    const tr = imgTd.closest("tr");
    if (tr) _loadBulkRowImages(tr, item);
  };

  if (obvRemove) obvRemove.addEventListener("click", () => _handleRemove("obverse"));
  if (revRemove) revRemove.addEventListener("click", () => _handleRemove("reverse"));
};
