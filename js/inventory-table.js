/* inventory-table.js -- Table rendering, summary, and formatting extracted from inventory.js (STAK-484) */

(function () {
  "use strict";

  const WEIGHT_UNIT_TOOLTIPS = {
    oz: "Troy ounces (ozt)",
    g: "Grams (g)",
    kg: "Kilograms (kg)",
    lb: "Pounds (lb)",
    gb: "Goldback denomination",
    sb: "Silverback denomination",
  };

  let _thumbBlobUrls = [];

  window.addEventListener("beforeunload", () => {
    for (const url of _thumbBlobUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  });

  // Expose tracker so inventory.js popover can register blob URLs for revocation
  window._trackThumbBlobUrl = (url) => {
    if (url) _thumbBlobUrls.push(url);
  };

  // ---------------------------------------------------------------------------
  // Color constants and dynamic color maps
  // ---------------------------------------------------------------------------

  const METAL_COLORS = {
    Silver: "var(--silver)",
    Gold: "var(--gold)",
    Platinum: "var(--platinum)",
    Palladium: "var(--palladium)",
  };

  const METAL_TEXT_COLORS = {
    Silver: () =>
      getContrastColor(
        getComputedStyle(document.documentElement).getPropertyValue("--silver").trim()
      ),
    Gold: () =>
      getContrastColor(
        getComputedStyle(document.documentElement).getPropertyValue("--gold").trim()
      ),
    Platinum: () =>
      getContrastColor(
        getComputedStyle(document.documentElement).getPropertyValue("--platinum").trim()
      ),
    Palladium: () =>
      getContrastColor(
        getComputedStyle(document.documentElement).getPropertyValue("--palladium").trim()
      ),
  };

  const typeColors = {
    Coin: "var(--type-coin-bg)",
    Round: "var(--type-round-bg)",
    Bar: "var(--type-bar-bg)",
    Note: "var(--type-note-bg)",
    Aurum: "var(--type-aurum-bg)",
    Goldback: "var(--type-goldback-bg)",
    Silverback: "var(--type-silverback-bg)",
    Set: "var(--type-set-bg)",
    Other: "var(--type-other-bg)",
  };
  const purchaseLocationColors = {};
  const storageLocationColors = {};
  const nameColors = {};
  const dateColors = {};

  const getColor = (map, key) => {
    if (!(key in map)) {
      let hash = 0;
      for (let i = 0; i < key.length; i++) {
        const char = key.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
      }
      map[key] = Math.abs(hash) % 360;
    }
    const isDark = ["dark", "slate"].includes(document.documentElement.getAttribute("data-theme"));
    const lightness = isDark ? 65 : 35;
    return `hsl(${map[key]}, 70%, ${lightness}%)`;
  };

  const escapeAttribute = escapeHtml;

  const filterLink = (field, value, color, displayValue = value, title, allowHtml = false) => {
    const handler = `applyColumnFilter('${field}', ${JSON.stringify(value)})`;
    const escaped = escapeAttribute(handler);
    const displayStr = String(displayValue);
    const safe = allowHtml ? displayStr : sanitizeHtml(displayStr);
    const titleStr = title ? String(title) : `Filter by ${displayStr}`;
    const safeTitle = sanitizeHtml(titleStr);
    const isNA =
      displayStr === "N/A" ||
      displayStr === "Numista Import" ||
      displayStr === "Unknown" ||
      displayStr === "—";
    const classNames = `filter-text${isNA ? " na-value" : ""}`;
    const styleAttr = isNA ? "" : ` style="color: ${color};"`;
    return `<span class="${classNames}"${styleAttr} onclick="${escaped}" tabindex="0" role="button" onkeydown="if(event.key==='Enter'||event.key===' ')${escaped}" title="${safeTitle}">${safe}</span>`;
  };

  const getTypeColor = (type) => typeColors[type] || "var(--type-other-bg)";
  const getPurchaseLocationColor = (loc) => getColor(purchaseLocationColors, loc);
  const getStorageLocationColor = (loc) =>
    loc === "Unknown" || loc === "—" || !loc
      ? "var(--text-muted)"
      : getColor(storageLocationColors, loc);

  window._openPurchaseLink = (href, e) => {
    if (e) e.stopPropagation();
    const popup = window.open(
      href,
      "_blank",
      "width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no"
    );
    if (popup) {
      popup.opener = null;
    } else {
      const fallback = window.open(href, "_blank", "noopener,noreferrer");
      if (fallback) fallback.opener = null;
    }
  };

  const formatPurchaseLocation = (loc) => {
    let value = loc || "—";

    if (value === "Numista Import" || value === "Unknown") {
      value = "—";
    }

    const urlPattern = /^(https?:\/\/)?[\w.-]+\.[A-Za-z]{2,}(\S*)?$/;
    const isUrl = urlPattern.test(value);

    let displayValue = value;
    if (isUrl) {
      displayValue = value
        .replace(/^(https?:\/\/)?(www\.)?/i, "")
        .replace(/\.(com|net|org|co|io|us|uk|ca|au|de|fr|shop|store)\/?.*$/i, "");
    }

    const truncated =
      displayValue.length > 18 ? displayValue.substring(0, 18) + "\u2026" : displayValue;
    const color = getPurchaseLocationColor(value);
    const filterSpan = filterLink(
      "purchaseLocation",
      value,
      color,
      truncated,
      value !== truncated ? value : undefined
    );

    if (isUrl) {
      let href = value;
      if (!/^https?:\/\//i.test(href)) {
        href = `https://${href}`;
      }
      const safeHref = escapeAttribute(href);
      return `<a href="#" data-href="${safeHref}" onclick="_openPurchaseLink(this.dataset.href, event); return false;" class="purchase-link" title="${safeHref}">
      <svg class="purchase-link-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width: 12px; height: 12px; fill: currentColor; margin-right: 4px;" aria-hidden="true">
        <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z"/>
      </svg>
    </a>${filterSpan}`;
    }
    return filterSpan;
  };

  const formatStorageLocation = (loc) => {
    let value = loc || "—";

    if (value === "Numista Import" || value === "Unknown") {
      value = "—";
    }

    const truncated = value.length > 25 ? value.substring(0, 25) + "\u2026" : value;
    const color = getStorageLocationColor(value);
    return filterLink(
      "storageLocation",
      value,
      color,
      truncated,
      value !== truncated ? value : undefined
    );
  };

  const recalcItem = (item) => {
    // No-op: premium calculations removed in portfolio redesign
  };

  const persistInventoryAndRefresh = () => {
    saveInventory();
    renderTable();
  };

  const updateItemCount = () => {};

  // ---------------------------------------------------------------------------
  // hideEmptyColumns
  // ---------------------------------------------------------------------------

  const hideEmptyColumns = () => {
    if (typeof document === "undefined") return;
    const headers = document.querySelectorAll("#inventoryTable thead th[data-column]");
    headers.forEach((header) => {
      const col = header.getAttribute("data-column");
      const cells = document.querySelectorAll(`#inventoryTable tbody [data-column="${col}"]`);
      const allEmpty =
        cells.length > 0 &&
        Array.from(cells).every((cell) => {
          if (
            cell.querySelector &&
            (cell.querySelector("svg") ||
              cell.querySelector("button") ||
              cell.querySelector(".action-icon") ||
              cell.querySelector("img"))
          ) {
            return false;
          }
          return cell.textContent.trim() === "";
        });

      document.querySelectorAll(`#inventoryTable [data-column="${col}"]`).forEach((el) => {
        el.classList.toggle("hidden-empty", allEmpty);
      });
    });
  };

  // ---------------------------------------------------------------------------
  // Thumbnail helpers (lazy-loading table thumbnails)
  // ---------------------------------------------------------------------------

  let _thumbObserver = null;

  const _thumbPlaceholders = {};

  function _getThumbPlaceholder(metal, type, shape) {
    const resolvedShape = shape || "round";
    const key = (metal || "Silver") + ":" + (type || "Coin") + ":" + resolvedShape;
    if (_thumbPlaceholders[key]) return _thumbPlaceholders[key];

    const silver = getThemeColor("silver");
    const gold = getThemeColor("gold");
    const platinum = getThemeColor("platinum");
    const palladium = getThemeColor("palladium");
    const colors = {
      Silver: { fill: silver, stroke: silver, text: silver },
      Gold: { fill: gold, stroke: gold, text: gold },
      Platinum: { fill: platinum, stroke: platinum, text: platinum },
      Palladium: { fill: palladium, stroke: palladium, text: palladium },
    };
    const c = colors[metal] || colors.Silver;

    const isBar = /bar|ingot/i.test(type || "") || resolvedShape === "rect";
    const icon = isBar
      ? `<rect x="11" y="7" width="10" height="18" rx="1.5" fill="none" stroke="${c.text}" stroke-width="1.5" opacity="0.5"/><line x1="13" y1="12" x2="19" y2="12" stroke="${c.text}" stroke-width="0.8" opacity="0.4"/><line x1="13" y1="15" x2="19" y2="15" stroke="${c.text}" stroke-width="0.8" opacity="0.4"/><line x1="13" y1="18" x2="19" y2="18" stroke="${c.text}" stroke-width="0.8" opacity="0.4"/>`
      : `<circle cx="16" cy="16" r="8" fill="none" stroke="${c.text}" stroke-width="1.2" opacity="0.45"/><circle cx="16" cy="16" r="5" fill="none" stroke="${c.text}" stroke-width="0.8" opacity="0.3" stroke-dasharray="2 2"/>`;

    const outerShape =
      resolvedShape === "rect"
        ? `<rect x="1" y="1" width="30" height="30" rx="8" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5" opacity="0.25"/>`
        : `<circle cx="16" cy="16" r="15" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1" opacity="0.25"/>`;

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    ${outerShape}
    ${icon}
  </svg>`;

    const encoded = svg.replace(/#/g, "%23");
    const uri = "data:image/svg+xml," + encoded;
    _thumbPlaceholders[key] = uri;
    return uri;
  }

  async function _enhanceTableThumbnails() {
    if (!featureFlags.isEnabled("COIN_IMAGES") || !window.imageCache?.isAvailable()) return;

    if (localStorage.getItem("tableImagesEnabled") === "false") return;

    if (_thumbObserver) _thumbObserver.disconnect();

    _thumbObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          _thumbObserver.unobserve(entry.target);
          _loadThumbImage(entry.target);
        }
      },
      { rootMargin: "200px 0px" }
    );

    document.querySelectorAll("#inventoryTable .table-thumb").forEach((img) => {
      _thumbObserver.observe(img);
    });
  }

  async function _loadThumbImage(img) {
    try {
      const item = {
        uuid: img.dataset.itemUuid || "",
        numistaId: img.dataset.catalogId || "",
        name: img.dataset.itemName || "",
        metal: img.dataset.itemMetal || "",
        type: img.dataset.itemType || "",
      };

      const side = img.dataset.side || "obverse";

      const row = img.closest("tr");
      const idx = row?.dataset?.idx;
      let cdnUrl = "";
      let invItem;
      if (idx !== undefined) {
        invItem = inventory[parseInt(idx, 10)];
        if (invItem) {
          const urlKey = side === "reverse" ? "reverseImageUrl" : "obverseImageUrl";
          cdnUrl =
            invItem[urlKey] && /^https?:\/\/.+\..+/i.test(invItem[urlKey]) ? invItem[urlKey] : "";
        }
      }
      const resolvedShape =
        typeof resolveImageFrame === "function" && resolveImageFrame(invItem, side) === "rect"
          ? "rect"
          : "round";

      const blobUrl = await imageCache.resolveImageUrlForItem(item, side);
      if (blobUrl) {
        _thumbBlobUrls.push(blobUrl);
        img.onerror = () => {
          img.onerror = null;
          if (cdnUrl) {
            img.src = cdnUrl;
          } else {
            img.src = _getThumbPlaceholder(item.metal, item.type, resolvedShape);
            img.classList.add("table-thumb-placeholder");
          }
        };
        img.src = blobUrl;
        img.style.visibility = "";
        return;
      }

      if (cdnUrl) {
        img.src = cdnUrl;
        img.style.visibility = "";
        return;
      }

      img.src = _getThumbPlaceholder(item.metal, item.type, resolvedShape);
      img.style.visibility = "";
      img.classList.add("table-thumb-placeholder");
    } catch {
      /* ignore -- IDB unavailable or entry missing */
    }
  }

  // ---------------------------------------------------------------------------
  // renderTable
  // ---------------------------------------------------------------------------

  const renderTable = () => {
    return monitorPerformance(() => {
      const filteredInventory =
        typeof filterInventory === "function" ? filterInventory() : inventory;
      updateItemCount(filteredInventory.length, inventory.length);
      const sortedInventory = sortInventory(filteredInventory);
      debugLog("renderTable start", sortedInventory.length, "items");

      // STAK-131: Card sort bar + card view rendering branch
      const cardSortBar = safeGetElement("cardSortBar");
      const footerSelect = document.querySelector(".table-footer-controls select");
      if (typeof isCardViewActive === "function" && isCardViewActive()) {
        const cardGrid = safeGetElement("cardViewGrid");
        const portalScroll = document.querySelector(".portal-scroll");
        if (cardGrid) {
          cardGrid.style.display = "flex";
          if (portalScroll) portalScroll.style.display = "none";
          if (cardSortBar) cardSortBar.style.display = "flex";
          if (footerSelect) footerSelect.style.display = "";
          if (typeof initCardSortBar === "function") initCardSortBar();
          if (typeof updateCardSortBar === "function") updateCardSortBar();

          const itemIndexMap = getItemIndexMap();
          renderCardView(sortedInventory, cardGrid, itemIndexMap);
          bindCardClickHandler(cardGrid);

          requestAnimationFrame(() => updatePortalHeight());
          updateSummary();
          return;
        }
      }

      const cardGridEl = safeGetElement("cardViewGrid");
      const portalScrollEl = document.querySelector(".portal-scroll");
      if (cardGridEl) {
        cardGridEl.style.display = "none";
        cardGridEl.style.maxHeight = "";
        cardGridEl.style.overflowY = "";
      }
      if (portalScrollEl) portalScrollEl.style.display = "";
      if (cardSortBar) cardSortBar.style.display = "flex";
      if (footerSelect) footerSelect.style.display = "";
      if (typeof initCardSortBar === "function") initCardSortBar();
      if (typeof updateCardSortBar === "function") updateCardSortBar();

      const rows = [];
      const chipConfig = typeof getInlineChipConfig === "function" ? getInlineChipConfig() : [];

      const itemIndexMap = getItemIndexMap();

      const _tableImagesOnSetting = localStorage.getItem("tableImagesEnabled") !== "false";
      const _tableImageSidesSetting = localStorage.getItem("tableImageSides") || "both";
      const hasImageFrameResolver = typeof resolveImageFrame === "function";

      for (let i = 0; i < sortedInventory.length; i++) {
        const item = sortedInventory[i];
        const originalIdx = itemIndexMap.get(item);
        debugLog("renderTable row", i, item.name);

        const currentSpot = spotPrices[item.metal.toLowerCase()] || 0;
        const valuation =
          typeof computeItemValuation === "function"
            ? computeItemValuation(item, currentSpot)
            : null;
        const purchaseTotal = valuation
          ? valuation.purchaseTotal
          : (parseFloat(item.price) || 0) * (Number(item.qty) || 0);
        const meltValue = valuation ? valuation.meltValue : computeMeltValue(item, currentSpot);
        const gbDenomPrice = valuation ? valuation.gbDenomPrice : null;
        const isManualRetail = valuation ? valuation.isManualRetail : false;
        const retailTotal = valuation ? valuation.retailTotal : meltValue;
        const gainLoss = valuation ? valuation.gainLoss : null;
        const hasRetailSignal = valuation ? valuation.hasRetailSignal : currentSpot > 0;

        const numistaId =
          item.numistaId ||
          (typeof catalogManager !== "undefined" && catalogManager.getCatalogId
            ? catalogManager.getCatalogId(item.serial)
            : null);

        const gradeTag = item.grade
          ? (() => {
              const authority = item.gradingAuthority || "";
              const certNum = item.certNumber || "";
              const isClickable = !!certNum;
              let tooltip;
              if (authority === "PCGS" && certNum && item.pcgsVerified) {
                tooltip = `${authority} Cert #${certNum} \u2014 Verified`;
              } else if (authority && certNum) {
                tooltip = `${authority} Cert #${certNum} \u2014 Click to verify`;
              } else if (authority) {
                tooltip = `Graded by ${authority}: ${item.grade}`;
              } else {
                tooltip = `Grade: ${item.grade}`;
              }
              const showPcgsVerify =
                authority === "PCGS" &&
                certNum &&
                typeof catalogConfig !== "undefined" &&
                catalogConfig.isPcgsEnabled();
              const verifyIcon = showPcgsVerify
                ? `<span class="pcgs-verify-btn${item.pcgsVerified ? " pcgs-verified" : ""}" data-cert-number="${escapeAttribute(certNum)}" title="${item.pcgsVerified ? "Verified \u2014 Click to re-verify" : "Verify cert via PCGS API"}"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>`
                : "";
              const attrs = [
                authority ? `data-authority="${escapeAttribute(authority)}"` : "",
                isClickable ? 'data-clickable="true"' : "",
                certNum ? `data-cert-number="${escapeAttribute(certNum)}"` : "",
                `data-grade="${escapeAttribute(item.grade || "")}"`,
                isClickable ? 'tabindex="0" role="button"' : "",
              ]
                .filter(Boolean)
                .join(" ");
              return `<span class="grade-tag" ${attrs} title="${escapeAttribute(tooltip)}">${sanitizeHtml(item.grade)}${verifyIcon}</span>`;
            })()
          : "";

        const numistaTag = numistaId
          ? `<span class="numista-tag" data-numista-id="${escapeAttribute(String(numistaId))}"
                 data-coin-name="${escapeAttribute(item.name)}"
                 title="N#${escapeAttribute(String(numistaId))} — View on Numista"
                 tabindex="0" role="button">N#${sanitizeHtml(String(numistaId))}</span>`
          : "";

        const pcgsTag = item.pcgsNumber
          ? `<span class="pcgs-tag" data-pcgs-number="${escapeAttribute(String(item.pcgsNumber))}"
                 data-grade="${escapeAttribute(item.grade || "")}"
                 title="PCGS #${escapeAttribute(String(item.pcgsNumber))} — View on PCGS CoinFacts"
                 tabindex="0" role="button">PCGS#${sanitizeHtml(String(item.pcgsNumber))}</span>`
          : "";

        const yearTag = item.year
          ? `<span class="year-tag" title="Filter by year: ${escapeAttribute(String(item.year))}"
                 onclick="applyColumnFilter('year', ${JSON.stringify(String(item.year))})"
                 tabindex="0" role="button" style="cursor:pointer;">${sanitizeHtml(String(item.year))}</span>`
          : "";

        const serialTag = item.serialNumber
          ? `<span class="serial-tag" title="S/N: ${escapeAttribute(item.serialNumber)}">${sanitizeHtml(item.serialNumber)}</span>`
          : "";

        const storageTag =
          item.storageLocation && item.storageLocation !== "Unknown"
            ? `<span class="storage-tag" title="${escapeAttribute(item.storageLocation)}">${sanitizeHtml(item.storageLocation)}</span>`
            : "";

        const notesIndicator = item.notes
          ? `<span class="notes-indicator" title="Click to view notes \u00b7 Shift+click to edit"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/></svg></span>`
          : "";

        const purityVal = parseFloat(item.purity);
        const purityTag =
          !isNaN(purityVal) && purityVal > 0 && purityVal < 1.0
            ? `<span class="purity-tag" title="Purity: ${purityVal}" onclick="applyColumnFilter('purity', ${JSON.stringify(String(purityVal))})" tabindex="0" role="button" style="cursor:pointer;">${purityVal}</span>`
            : "";

        const _thumbShapeClass = (side) =>
          hasImageFrameResolver && resolveImageFrame(item, side) === "rect"
            ? " table-thumb-rect"
            : "";
        const _validUrl = (u) => u && /^https?:\/\/.+\..+/i.test(u);
        const obvUrl = _validUrl(item.obverseImageUrl) ? item.obverseImageUrl : "";
        const revUrl = _validUrl(item.reverseImageUrl) ? item.reverseImageUrl : "";
        const obvSrcAttr = obvUrl ? ` src="${escapeAttribute(obvUrl)}"` : "";
        const revSrcAttr = revUrl ? ` src="${escapeAttribute(revUrl)}"` : "";
        const _sharedThumbAttrs = `data-catalog-id="${escapeAttribute(item.numistaId || "")}"
                 data-item-uuid="${escapeAttribute(item.uuid || "")}"
                 data-item-name="${escapeAttribute(item.name || "")}"
                 data-item-metal="${escapeAttribute(item.metal || "")}"
                 data-item-type="${escapeAttribute(item.type || "")}"`;
        const _showObv =
          _tableImageSidesSetting === "both" || _tableImageSidesSetting === "obverse";
        const _showRev =
          _tableImageSidesSetting === "both" || _tableImageSidesSetting === "reverse";
        const thumbHtml =
          _tableImagesOnSetting && featureFlags.isEnabled("COIN_IMAGES")
            ? (_showObv
                ? `<img class="table-thumb${_thumbShapeClass("obverse")}"${obvSrcAttr}
                 ${_sharedThumbAttrs} data-side="obverse"
                 alt="" loading="lazy" />`
                : "") +
              (_showRev
                ? `<img class="table-thumb${_thumbShapeClass("reverse")}"${revSrcAttr}
                 ${_sharedThumbAttrs} data-side="reverse"
                 alt="" loading="lazy" />`
                : "")
            : "";

        // STAK-126: Inline tags chip (show first 2 tags, ellipsis if more)
        const _inlineTags = typeof getItemTags === "function" ? getItemTags(item.uuid) : [];
        const tagsChip =
          _inlineTags.length > 0
            ? `<span class="tags-inline-chip" title="${escapeAttribute(_inlineTags.join(", "))}">${sanitizeHtml(_inlineTags.slice(0, 2).join(", "))}${_inlineTags.length > 2 ? "\u2026" : ""}</span>`
            : "";

        let attachChipHtml = "";
        if (item.attachments?.length > 0 && typeof renderAttachmentBadge === "function") {
          const badgeEl = renderAttachmentBadge(item, { variant: "table" });
          if (badgeEl) {
            badgeEl.setAttribute(
              "onclick",
              `typeof showViewModal === "function" && showViewModal(${originalIdx});event.stopPropagation()`
            );
            attachChipHtml = badgeEl.outerHTML;
          }
        }
        const chipMap = {
          grade: gradeTag,
          numista: numistaTag,
          pcgs: pcgsTag,
          year: yearTag,
          serial: serialTag,
          storage: storageTag,
          notes: notesIndicator,
          purity: purityTag,
          tags: tagsChip,
          attachment: attachChipHtml,
        };
        const orderedChips = chipConfig
          .filter((c) => c.enabled && chipMap[c.id])
          .map((c) => chipMap[c.id])
          .join("");

        const meltDisplay = currentSpot > 0 ? formatCurrency(meltValue) : "—";
        const retailDisplay = hasRetailSignal ? formatCurrency(retailTotal) : "—";
        const gainLossDisplay =
          gainLoss !== null && hasRetailSignal ? formatCurrency(Math.abs(gainLoss)) : "—";
        const gainLossColor =
          gainLoss > 0
            ? "var(--success, #4caf50)"
            : gainLoss < 0
              ? "var(--danger, #f44336)"
              : "var(--text-primary)";
        const gainLossPrefix = gainLoss > 0 ? "+" : gainLoss < 0 ? "-" : "";

        rows.push(`
      <tr data-idx="${originalIdx}"${isDisposed(item) ? ' class="disposed-row"' : ""}>
  <td class="shrink" data-column="date" data-label="Date">${filterLink("date", item.date, "var(--text-primary)", item.date ? formatDisplayDate(item.date) : "—")}</td>
      <td class="shrink" data-column="metal" data-label="Metal" data-metal="${escapeAttribute(item.composition || item.metal || "")}">${filterLink("metal", item.composition || item.metal || "Silver", METAL_COLORS[item.metal] || "var(--primary)", getDisplayComposition(item.composition || item.metal || "Silver"))}</td>
      <td class="shrink" data-column="type" data-label="Type">${filterLink("type", item.type, getTypeColor(item.type))}</td>
      <td class="shrink" data-column="image" data-label="Image" style="text-align: center;">${thumbHtml}</td>
      <td class="expand" data-column="name" data-label="" style="text-align: left;">
        <div class="name-cell-content">
        ${
          featureFlags.isEnabled("COIN_IMAGES")
            ? `<span class="filter-text" style="color: var(--text-primary); cursor: pointer;" onclick="showViewModal(${originalIdx})" tabindex="0" role="button" onkeydown="if(event.key==='Enter'||event.key===' ')showViewModal(${originalIdx})" title="View ${escapeAttribute(item.name)}">${sanitizeHtml(item.name)}</span>`
            : filterLink("name", item.name, "var(--text-primary)", undefined, item.name)
        }${isDisposed(item) ? `<span class="disposition-badge disposition-badge--${item.disposition.type}">${DISPOSITION_TYPES[item.disposition.type]?.label || item.disposition.type}</span>` : ""}${orderedChips}
        </div>
      </td>
      <td class="shrink" data-column="qty" data-label="Qty">${filterLink("qty", item.qty, "var(--text-primary)")}</td>
      <td class="shrink" data-column="weight" data-label="Weight">${filterLink("weight", item.weight, "var(--text-primary)", formatWeight(item.weight, item.weightUnit), WEIGHT_UNIT_TOOLTIPS[item.weightUnit] || "Troy ounces (ozt)")}</td>
      <td class="shrink" data-column="purchasePrice" data-label="Purchase" title="Purchase Total (${displayCurrency}) - Click to search eBay active listings" style="color: var(--text-primary);">
        <a href="#" class="ebay-buy-link ebay-price-link" data-search="${escapeAttribute(item.metal + (item.year ? " " + item.year : "") + " " + item.name)}" title="Search eBay active listings for ${escapeAttribute(item.metal)} ${escapeAttribute(item.name)}">
          ${formatCurrency(purchaseTotal)} <svg class="ebay-search-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </a>
      </td>
      <td class="shrink" data-column="meltValue" data-label="Melt" title="Melt Value (${displayCurrency})" style="color: var(--text-primary);">${meltDisplay}</td>
      <td class="shrink ${gbDenomPrice || isManualRetail ? "retail-confirmed" : "retail-estimated"}" data-column="retailPrice" data-label="Retail" title="${isManualRetail ? "Manual retail price (confirmed)" : gbDenomPrice ? "Goldback denomination price" : "Estimated — defaults to melt value"} - Click to search eBay sold listings">
        <a href="#" class="ebay-sold-link ebay-price-link" data-search="${escapeAttribute(item.metal + (item.year ? " " + item.year : "") + " " + item.name)}" title="Search eBay sold listings for ${escapeAttribute(item.metal)} ${escapeAttribute(item.name)}">
          ${retailDisplay} <svg class="ebay-search-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </a>
      </td>
      <td class="shrink ${!isManualRetail && gainLoss !== null ? "gainloss-estimated" : ""}" data-column="gainLoss" data-label="Gain/Loss" title="${isManualRetail ? "Gain/Loss (confirmed retail)" : "Gain/Loss (estimated — based on melt value)"}" style="color: ${gainLossColor}; font-weight: ${gainLoss !== null && gainLoss !== 0 && isManualRetail ? "600" : "normal"};">${gainLoss !== null && gainLossDisplay !== "—" ? gainLossPrefix + gainLossDisplay : "—"}</td>
      <td class="shrink" data-column="purchaseLocation" data-label="Source">
        ${formatPurchaseLocation(item.purchaseLocation)}
      </td>
      <td class="icon-col actions-cell" data-column="actions" data-label=""><div class="actions-row">
  ${
    isDisposed(item)
      ? `
        <button class="icon-btn action-icon" role="button" tabindex="0" onclick="undoDisposition(${originalIdx})" aria-label="Undo disposition" title="Undo disposition">
          <svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
        </button>
        <button class="icon-btn action-icon danger" role="button" tabindex="0" onclick="deleteItem(${originalIdx})" aria-label="Delete item" title="Delete item">
          <svg class="icon-svg delete-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 1h4v2H3V4h4l1-1z"/></svg>
        </button>
  `
      : `
        <button class="icon-btn action-icon edit-icon" role="button" tabindex="0" onclick="editItem(${originalIdx})" aria-label="Edit ${sanitizeHtml(item.name)}" title="Edit item">
          <svg class="icon-svg edit-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>
        </button>
        <button class="icon-btn action-icon" role="button" tabindex="0" onclick="cloneItem(${originalIdx})" aria-label="Clone ${sanitizeHtml(item.name)}" title="Clone item">
          <svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
        </button>
        <button class="icon-btn action-icon danger" role="button" tabindex="0" onclick="deleteItem(${originalIdx})" aria-label="Delete item" title="Delete item">
          <svg class="icon-svg delete-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 1h4v2H3V4h4l1-1z"/></svg>
        </button>
  `
  }
      </div></td>
      </tr>
      `);
      }

      const tbody = elements.inventoryTable || document.querySelector("#inventoryTable tbody");
      if (!tbody) {
        debugLog("Could not find table tbody element");
        return;
      }

      for (const url of _thumbBlobUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
      _thumbBlobUrls = [];

      // STRK-13: When inventory recovery is active, the banner takes over the
      // empty-state messaging. Skip the "Your stack is empty / Add Item" placeholder
      // so a panicked user can't click Add Item and defeat the recovery hold.
      const recoveryActive =
        typeof isInventoryRecoveryActive === "function" && isInventoryRecoveryActive();
      if (sortedInventory.length === 0 && !recoveryActive) {
        const isFiltered = inventory.length > 0;
        const message = isFiltered ? "No matching items found." : "Your stack is empty.";
        const subtext = isFiltered
          ? "Try adjusting your search or filters."
          : "Add your first item to start tracking your portfolio.";
        const action = isFiltered
          ? `<button class="btn warning btn-sm" onclick="clearAllFilters()">Clear Filters</button>`
          : `<button class="btn success btn-sm" onclick="safeGetElement('newItemBtn').click()">Add Item</button>`;

        const emptyHtml = `
        <tr class="empty-state-row">
          <td colspan="100%">
            <div class="empty-state">
              <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                ${
                  isFiltered
                    ? '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>'
                    : '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>'
                }
              </svg>
              <h3>${message}</h3>
              <p>${subtext}</p>
              ${action}
            </div>
          </td>
        </tr>
      `;
        rows.push(emptyHtml);
      }

      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      tbody.innerHTML = rows.join("");

      _enhanceTableThumbnails();

      if (!tbody._imgCellBound) {
        tbody._imgCellBound = true;
        tbody.addEventListener("click", (e) => {
          if (!featureFlags.isEnabled("COIN_IMAGES")) return;
          const cell = e.target.closest('td[data-column="image"]');
          if (!cell) return;
          e.stopPropagation();
          const row = cell.closest("tr[data-idx]");
          if (!row) return;
          const idx = parseInt(row.dataset.idx, 10);
          if (isNaN(idx)) return;
          const item = inventory[idx];
          if (!item) return;
          _openThumbPopover(cell, item);
        });
      }

      if (!tbody._cardTapBound) {
        tbody._cardTapBound = true;
        tbody.addEventListener("click", (e) => {
          if (window.innerWidth > 768) return;
          if (
            e.target.closest(
              'button, a, input, select, textarea, .icon-btn, .filter-text, [role="button"], .year-tag, .purity-tag, td[data-column="image"]'
            )
          )
            return;
          const row = e.target.closest("tr[data-idx]");
          if (row) {
            const idx = Number(row.dataset.idx);
            if (featureFlags.isEnabled("COIN_IMAGES") && typeof showViewModal === "function") {
              showViewModal(idx);
            } else {
              editItem(idx);
            }
          }
        });
      }

      hideEmptyColumns();

      debugLog("renderTable complete");

      const headers = document.querySelectorAll("#inventoryTable th");
      headers.forEach((header) => {
        const indicator = header.querySelector(".sort-indicator");
        if (indicator) header.removeChild(indicator);
      });

      if (sortColumn !== null && sortColumn < headers.length) {
        const header = headers[sortColumn];
        const indicator = document.createElement("span");
        indicator.className = "sort-indicator";
        indicator.textContent = sortDirection === "asc" ? "\u2191" : "\u2193";
        header.appendChild(indicator);
      }

      updatePortalHeight();
      updateSummary();

      setupColumnResizing();
      updateColumnVisibility();
    }, "renderTable");
  };

  // ---------------------------------------------------------------------------
  // updateSummary
  // ---------------------------------------------------------------------------

  const updateSummary = () => {
    const metalTotals = {};
    const metalNameMap = {};

    Object.values(METALS).forEach((metalConfig) => {
      metalTotals[metalConfig.key] = {
        totalItems: 0,
        totalWeight: 0,
        totalMeltValue: 0,
        totalPurchased: 0,
        totalRetailValue: 0,
        totalGainLoss: 0,
        disposedItems: 0,
        realizedGainLoss: 0,
        totalDisposedCost: 0,
      };
      metalNameMap[metalConfig.name] = metalConfig.key;
    });

    for (const item of inventory) {
      const metalKey = metalNameMap[item.metal];
      if (metalKey && metalTotals[metalKey]) {
        const totals = metalTotals[metalKey];

        if (isDisposed(item)) {
          const qty = Number(item.qty) || 0;
          totals.disposedItems += qty;
          totals.realizedGainLoss += item.disposition?.realizedGainLoss || 0;
          totals.totalDisposedCost += (parseFloat(item.price) || 0) * (Number(item.qty) || 0);
          continue;
        }

        const qty = Number(item.qty) || 0;
        const weight = parseFloat(item.weight) || 0;
        const price = parseFloat(item.price) || 0;

        totals.totalItems += qty;
        const weightOz =
          item.weightUnit === "gb"
            ? weight * GB_TO_OZT
            : item.weightUnit === "sb"
              ? weight * (typeof SB_TO_OZT !== "undefined" ? SB_TO_OZT : GB_TO_OZT)
              : weight;
        const itemWeight = qty * weightOz;
        totals.totalWeight += itemWeight;

        const currentSpot = spotPrices[metalKey] || 0;
        const valuation =
          typeof computeItemValuation === "function"
            ? computeItemValuation(item, currentSpot)
            : null;
        const purity = parseFloat(item.purity) || 1.0;
        const meltValue = valuation ? valuation.meltValue : currentSpot * itemWeight * purity;
        totals.totalMeltValue += meltValue;

        const purchaseTotal = valuation ? valuation.purchaseTotal : qty * price;
        totals.totalPurchased += purchaseTotal;

        const retailTotal = valuation ? valuation.retailTotal : meltValue;
        totals.totalRetailValue += retailTotal;

        totals.totalGainLoss += retailTotal - purchaseTotal;
      }
    }

    Object.values(METALS).forEach((metalConfig) => {
      const totals = metalTotals[metalConfig.key];
      const metalKey = metalConfig.key;
      const els = elements.totals[metalKey];

      if (els.items) els.items.textContent = totals.totalItems;
      if (els.weight) els.weight.textContent = totals.totalWeight.toFixed(2);
      if (els.value) els.value.textContent = formatCurrency(totals.totalMeltValue || 0);
      if (els.purchased) els.purchased.textContent = formatCurrency(totals.totalPurchased || 0);
      if (els.retailValue)
        els.retailValue.textContent = formatCurrency(totals.totalRetailValue || 0);
      if (els.lossProfit) {
        const gl = totals.totalGainLoss || 0;
        const gainLossPct = totals.totalPurchased > 0 ? (gl / totals.totalPurchased) * 100 : 0;
        // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
        els.lossProfit.innerHTML = formatLossProfit(gl, gainLossPct);
        const glLabel =
          els.lossProfit.parentElement &&
          els.lossProfit.parentElement.querySelector(".total-label");
        if (glLabel) {
          glLabel.textContent = gl > 0 ? "Gain:" : gl < 0 ? "Loss:" : "Gain/Loss:";
          glLabel.style.color = gl > 0 ? "var(--success)" : gl < 0 ? "var(--danger)" : "";
          glLabel.style.fontWeight = gl !== 0 ? "600" : "";
        }
      }
      if (els.avgCostPerOz) {
        const avgCost = totals.totalWeight > 0 ? totals.totalPurchased / totals.totalWeight : 0;
        els.avgCostPerOz.textContent = formatCurrency(avgCost);
      }

      // Realized G/L -- always visible on every card (STAK-72)
      const realizedGlEl = safeGetElement(`realizedGainLoss${metalConfig.name}`);
      if (realizedGlEl) {
        const rgl = totals.realizedGainLoss || 0;
        const rglPct = totals.totalDisposedCost > 0 ? (rgl / totals.totalDisposedCost) * 100 : 0;
        // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
        realizedGlEl.innerHTML = rgl === 0 ? "$0.00" : formatLossProfit(rgl, rglPct);
      }
    });

    const allTotals = {
      totalItems: 0,
      totalWeight: 0,
      totalMeltValue: 0,
      totalPurchased: 0,
      totalRetailValue: 0,
      totalGainLoss: 0,
      disposedItems: 0,
      realizedGainLoss: 0,
      totalDisposedCost: 0,
    };

    Object.values(metalTotals).forEach((totals) => {
      allTotals.totalItems += totals.totalItems;
      allTotals.totalWeight += totals.totalWeight;
      allTotals.totalMeltValue += totals.totalMeltValue;
      allTotals.totalPurchased += totals.totalPurchased;
      allTotals.totalRetailValue += totals.totalRetailValue;
      allTotals.totalGainLoss += totals.totalGainLoss;
      allTotals.disposedItems += totals.disposedItems;
      allTotals.realizedGainLoss += totals.realizedGainLoss;
      allTotals.totalDisposedCost += totals.totalDisposedCost;
    });

    if (elements.totals.all && elements.totals.all.items) {
      elements.totals.all.items.textContent = allTotals.totalItems;
      if (elements.totals.all.weight)
        elements.totals.all.weight.textContent = allTotals.totalWeight.toFixed(2);
      if (elements.totals.all.value)
        elements.totals.all.value.textContent = formatCurrency(allTotals.totalMeltValue || 0);
      if (elements.totals.all.purchased)
        elements.totals.all.purchased.textContent = formatCurrency(allTotals.totalPurchased || 0);
      if (elements.totals.all.retailValue)
        elements.totals.all.retailValue.textContent = formatCurrency(
          allTotals.totalRetailValue || 0
        );
      if (elements.totals.all.lossProfit) {
        const allGl = allTotals.totalGainLoss || 0;
        const allGainLossPct =
          allTotals.totalPurchased > 0 ? (allGl / allTotals.totalPurchased) * 100 : 0;
        // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
        elements.totals.all.lossProfit.innerHTML = formatLossProfit(allGl, allGainLossPct);
        const allGlLabel =
          elements.totals.all.lossProfit.parentElement &&
          elements.totals.all.lossProfit.parentElement.querySelector(".total-label");
        if (allGlLabel) {
          allGlLabel.textContent = allGl > 0 ? "Gain:" : allGl < 0 ? "Loss:" : "Gain/Loss:";
          allGlLabel.style.color = allGl > 0 ? "var(--success)" : allGl < 0 ? "var(--danger)" : "";
          allGlLabel.style.fontWeight = allGl !== 0 ? "600" : "";
        }
      }
      if (elements.totals.all.avgCostPerOz) {
        const avgCost =
          allTotals.totalWeight > 0 ? allTotals.totalPurchased / allTotals.totalWeight : 0;
        elements.totals.all.avgCostPerOz.textContent = formatCurrency(avgCost);
      }
    }

    // Realized G/L -- always visible on "All" card (STAK-72)
    const allRealizedGl = safeGetElement("realizedGainLossAll");
    if (allRealizedGl) {
      const rgl = allTotals.realizedGainLoss || 0;
      const rglPct =
        allTotals.totalDisposedCost > 0 ? (rgl / allTotals.totalDisposedCost) * 100 : 0;
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
      allRealizedGl.innerHTML = rgl === 0 ? "$0.00" : formatLossProfit(rgl, rglPct);
    }

    const showRealized = loadDataSync(SHOW_REALIZED_KEY, "true") !== "false";
    applyRealizedVisibility(showRealized);
  };

  if (typeof window !== "undefined") {
    window.addEventListener("currencychange", () => {
      try {
        if (typeof renderTable === "function") {
          renderTable();
        } else if (typeof updateSummary === "function") {
          updateSummary();
        }
      } catch (e) {
        if (typeof debugLog === "function") {
          debugLog("[inventory-table] currencychange refresh failed: " + e.message, "warn");
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Export public API via window.*
  // ---------------------------------------------------------------------------

  window.METAL_COLORS = METAL_COLORS;
  window.METAL_TEXT_COLORS = METAL_TEXT_COLORS;
  window.renderTable = renderTable;
  window.updateSummary = updateSummary;
  window.hideEmptyColumns = hideEmptyColumns;
  window.filterLink = filterLink;
  window.getTypeColor = getTypeColor;
  window.getPurchaseLocationColor = getPurchaseLocationColor;
  window.getStorageLocationColor = getStorageLocationColor;
  window.formatPurchaseLocation = formatPurchaseLocation;
  window.formatStorageLocation = formatStorageLocation;
  window.recalcItem = recalcItem;
  window.escapeAttribute = escapeAttribute;
  window.persistInventoryAndRefresh = persistInventoryAndRefresh;
  window.updateItemCount = updateItemCount;
  window.getColor = getColor;
  window.nameColors = nameColors;
  window.dateColors = dateColors;
  window.typeColors = typeColors;
  window.purchaseLocationColors = purchaseLocationColors;
  window.storageLocationColors = storageLocationColors;
})();
