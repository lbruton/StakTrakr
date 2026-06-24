// DETAILS MODAL FUNCTIONS WITH PIE CHART INTEGRATION
// =============================================================================

/** @type {string} Current pie chart metric — purchase | melt | retail | gainLoss */
let detailsChartMetric = "purchase";

/** @type {ResizeObserver|null} Active ResizeObserver for chart resize handling */
let detailsResizeObserver = null;

/**
 * Calculates breakdown data for specified metal by type and location
 * RENAMED from calculateBreakdownData to avoid 403 errors
 *
 * @param {string} metal - Metal type to calculate ('Silver', 'Gold', 'Platinum', or 'Palladium')
 * @returns {Object} Breakdown data organized by type and location
 */
const getBreakdownData = (metal) => {
  const metalItems = inventory.filter((item) => item.metal === metal);
  const currentSpot = spotPrices[metal.toLowerCase()] || 0;

  const typeBreakdown = {};
  const locationBreakdown = {};

  const initBucket = () => ({
    count: 0,
    weight: 0,
    purchase: 0,
    melt: 0,
    retail: 0,
    gainLoss: 0,
  });

  metalItems.forEach((item) => {
    const qty = Number(item.qty) || 1;
    const weight = parseFloat(item.weight) || 0;
    const weightOz =
      item.weightUnit === "gb"
        ? weight * GB_TO_OZT
        : item.weightUnit === "sb"
          ? weight * (typeof SB_TO_OZT !== "undefined" ? SB_TO_OZT : GB_TO_OZT)
          : weight;
    // STRK-235: constitutional silver oz is derived (variant table + wear) and already
    // includes the coin count, so it must NOT be multiplied by qty again.
    const itemWeight =
      item.weightUnit === "cu" && typeof getConstitutionalSilverOz === "function"
        ? getConstitutionalSilverOz(item)
        : qty * weightOz;
    const valuation =
      typeof computeItemValuation === "function" ? computeItemValuation(item, currentSpot) : null;
    const purchasePrice = parseFloat(item.price) || 0;
    const purchaseTotal = valuation ? valuation.purchaseTotal : qty * purchasePrice;
    const purity = parseFloat(item.purity) || 1.0;
    const meltValue = valuation ? valuation.meltValue : itemWeight * currentSpot * purity;
    const manualMarket = parseFloat(item.marketValue) || 0;
    const retailTotal = valuation
      ? valuation.retailTotal
      : manualMarket > 0
        ? qty * manualMarket
        : meltValue;
    const gainLoss = valuation?.gainLoss ?? retailTotal - purchaseTotal;

    // Type breakdown
    if (!typeBreakdown[item.type]) typeBreakdown[item.type] = initBucket();
    typeBreakdown[item.type].count += qty;
    typeBreakdown[item.type].weight += itemWeight;
    typeBreakdown[item.type].purchase += purchaseTotal;
    typeBreakdown[item.type].melt += meltValue;
    typeBreakdown[item.type].retail += retailTotal;
    typeBreakdown[item.type].gainLoss += gainLoss;

    // Location breakdown
    const loc = item.purchaseLocation || "Unknown";
    if (!locationBreakdown[loc]) locationBreakdown[loc] = initBucket();
    locationBreakdown[loc].count += qty;
    locationBreakdown[loc].weight += itemWeight;
    locationBreakdown[loc].purchase += purchaseTotal;
    locationBreakdown[loc].melt += meltValue;
    locationBreakdown[loc].retail += retailTotal;
    locationBreakdown[loc].gainLoss += gainLoss;
  });

  return { typeBreakdown, locationBreakdown };
};

/**
 * Calculates breakdown data across all metals — by metal and by location
 * Used when clicking the "All Metals" summary card
 *
 * @returns {Object} Breakdown data organized by metal and location
 */
const getAllMetalsBreakdownData = () => {
  const metalBreakdown = {};
  const locationBreakdown = {};

  const initBucket = () => ({
    count: 0,
    weight: 0,
    purchase: 0,
    melt: 0,
    retail: 0,
    gainLoss: 0,
  });

  inventory.forEach((item) => {
    const qty = Number(item.qty) || 1;
    const weight = parseFloat(item.weight) || 0;
    const weightOz =
      item.weightUnit === "gb"
        ? weight * GB_TO_OZT
        : item.weightUnit === "sb"
          ? weight * (typeof SB_TO_OZT !== "undefined" ? SB_TO_OZT : GB_TO_OZT)
          : weight;
    // STRK-235: constitutional silver oz is derived (variant table + wear) and already
    // includes the coin count, so it must NOT be multiplied by qty again.
    const itemWeight =
      item.weightUnit === "cu" && typeof getConstitutionalSilverOz === "function"
        ? getConstitutionalSilverOz(item)
        : qty * weightOz;
    const purchasePrice = parseFloat(item.price) || 0;
    const purchaseTotal = qty * purchasePrice;
    const currentSpot = spotPrices[item.metal.toLowerCase()] || 0;
    const valuation =
      typeof computeItemValuation === "function" ? computeItemValuation(item, currentSpot) : null;
    const purity = parseFloat(item.purity) || 1.0;
    const meltValue = valuation ? valuation.meltValue : itemWeight * currentSpot * purity;
    const manualMarket = parseFloat(item.marketValue) || 0;
    const retailTotal = valuation
      ? valuation.retailTotal
      : manualMarket > 0
        ? qty * manualMarket
        : meltValue;
    const gainLoss = valuation?.gainLoss ?? retailTotal - purchaseTotal;

    // Metal breakdown
    const metal = item.metal || "Unknown";
    if (!metalBreakdown[metal]) metalBreakdown[metal] = initBucket();
    metalBreakdown[metal].count += qty;
    metalBreakdown[metal].weight += itemWeight;
    metalBreakdown[metal].purchase += purchaseTotal;
    metalBreakdown[metal].melt += meltValue;
    metalBreakdown[metal].retail += retailTotal;
    metalBreakdown[metal].gainLoss += gainLoss;

    // Location breakdown
    const loc = item.purchaseLocation || "Unknown";
    if (!locationBreakdown[loc]) locationBreakdown[loc] = initBucket();
    locationBreakdown[loc].count += qty;
    locationBreakdown[loc].weight += itemWeight;
    locationBreakdown[loc].purchase += purchaseTotal;
    locationBreakdown[loc].melt += meltValue;
    locationBreakdown[loc].retail += retailTotal;
    locationBreakdown[loc].gainLoss += gainLoss;
  });

  return { metalBreakdown, locationBreakdown };
};

/**
 * Creates breakdown DOM elements for display
 * CHANGED from renderBreakdownHTML to use DOM methods instead of innerHTML
 *
 * @param {Object} breakdown - Breakdown data object
 * @returns {DocumentFragment} DOM fragment containing the breakdown elements
 */
const createBreakdownElements = (breakdown, colorMap = {}) => {
  const container = document.createDocumentFragment();

  if (Object.keys(breakdown).length === 0) {
    const item = document.createElement("div");
    item.className = "breakdown-item";
    const label = document.createElement("span");
    label.className = "breakdown-label";
    label.textContent = "No data available";
    item.appendChild(label);
    container.appendChild(item);
    return container;
  }

  // Sort by purchase value descending
  const sortedEntries = Object.entries(breakdown).sort((a, b) => b[1].purchase - a[1].purchase);

  sortedEntries.forEach(([key, data]) => {
    const item = document.createElement("div");
    item.className = "breakdown-item";

    // Header row: name + count/weight
    const header = document.createElement("div");
    header.className = "breakdown-header";

    // Color dot matching pie chart segment
    if (colorMap[key]) {
      const dot = document.createElement("span");
      dot.className = "breakdown-color-dot";
      dot.style.backgroundColor = colorMap[key];
      header.appendChild(dot);
    }

    const label = document.createElement("span");
    label.className = "breakdown-label";
    label.textContent = key;

    const meta = document.createElement("span");
    meta.className = "breakdown-meta";
    meta.textContent = `${data.count} items \u00B7 ${data.weight.toFixed(2)} oz`;

    header.appendChild(label);
    header.appendChild(meta);

    // 2x2 financial grid
    const grid = document.createElement("div");
    grid.className = "breakdown-grid";

    const cells = [
      { label: "Purchase", value: formatCurrency(data.purchase), cls: "breakdown-purchase" },
      { label: "Melt", value: formatCurrency(data.melt), cls: "breakdown-melt" },
      { label: "Retail", value: formatCurrency(data.retail), cls: "breakdown-retail" },
      {
        label: "Gain/Loss",
        value: formatCurrency(Math.abs(data.gainLoss)),
        cls: data.gainLoss >= 0 ? "breakdown-gain" : "breakdown-loss",
      },
    ];

    cells.forEach((cell) => {
      const el = document.createElement("div");
      el.className = `breakdown-cell ${cell.cls}`;
      const lbl = document.createElement("span");
      lbl.className = "breakdown-cell-label";
      lbl.textContent = cell.label;
      const val = document.createElement("span");
      val.className = "breakdown-cell-value";
      val.textContent =
        cell.label === "Gain/Loss"
          ? (data.gainLoss > 0 ? "+" : data.gainLoss < 0 ? "-" : "") + cell.value
          : cell.value;
      el.appendChild(lbl);
      el.appendChild(val);
      grid.appendChild(el);
    });

    item.appendChild(header);
    item.appendChild(grid);
    container.appendChild(item);
  });

  return container;
};

/**
 * Shows the details modal for specified metal with pie charts
 *
 * @param {string} metal - Metal type to show details for
 */
const showDetailsModal = (metal) => {
  const isAll = metal === "All";
  const typePanelTitle = document.getElementById("typePanelTitle");
  const locationPanelTitle = document.getElementById("locationPanelTitle");

  // Update modal title and panel labels
  elements.detailsModalTitle.textContent = isAll
    ? "All Metals — Portfolio Breakdown"
    : `${metal} Detailed Breakdown`;
  if (typePanelTitle)
    typePanelTitle.textContent = isAll ? "Breakdown by Metal" : "Breakdown by Type";
  if (locationPanelTitle) locationPanelTitle.textContent = "Breakdown by Purchase Location";

  // Clear existing content
  elements.typeBreakdown.textContent = "";
  elements.locationBreakdown.textContent = "";

  // Destroy existing charts
  destroyCharts();

  // Reset metric to default for each modal open
  detailsChartMetric = "purchase";

  // Get breakdown data — different shape for "All" vs single metal
  let leftBreakdown, rightBreakdown;
  if (isAll) {
    const allData = getAllMetalsBreakdownData();
    leftBreakdown = allData.metalBreakdown;
    rightBreakdown = allData.locationBreakdown;
  } else {
    const metalData = getBreakdownData(metal);
    leftBreakdown = metalData.typeBreakdown;
    rightBreakdown = metalData.locationBreakdown;
  }

  // Charts hidden via CSS on mobile — skip creation entirely (STACK-70)
  const isMobile = window.innerWidth <= 768;

  // Helper: render charts with current metric
  const renderCharts = () => {
    if (isMobile) return;
    destroyCharts();
    if (Object.keys(leftBreakdown).length > 0) {
      chartInstances.typeChart = createPieChart(
        elements.typeChart,
        leftBreakdown,
        isAll ? "Metal Breakdown" : "Type Breakdown",
        detailsChartMetric
      );
    }
    if (Object.keys(rightBreakdown).length > 0) {
      chartInstances.locationChart = createPieChart(
        elements.locationChart,
        rightBreakdown,
        "Location Breakdown",
        detailsChartMetric
      );
    }
  };

  // Create metric toggle bar before the charts grid
  const detailsGrid = elements.detailsModal.querySelector(".details-grid");
  let existingToggle = elements.detailsModal.querySelector(".chart-metric-toggle");
  if (existingToggle) existingToggle.remove();

  if (!isMobile) {
    const toggleBar = document.createElement("div");
    toggleBar.className = "chart-metric-toggle";
    const metrics = [
      { key: "purchase", label: "Purchase" },
      { key: "melt", label: "Melt" },
      { key: "retail", label: "Retail" },
      { key: "gainLoss", label: "Gain/Loss" },
    ];
    metrics.forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "chart-metric-btn" + (m.key === detailsChartMetric ? " active" : "");
      btn.textContent = m.label;
      btn.type = "button";
      btn.addEventListener("click", () => {
        detailsChartMetric = m.key;
        toggleBar
          .querySelectorAll(".chart-metric-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderCharts();
      });
      toggleBar.appendChild(btn);
    });

    if (detailsGrid) {
      detailsGrid.parentNode.insertBefore(toggleBar, detailsGrid);
    }
  }

  // Initial chart render (no-op on mobile)
  renderCharts();

  // Build color maps matching pie chart segment order (by insertion order)
  const buildColorMap = (breakdown) => {
    const keys = Object.keys(breakdown);
    const colors = (window.generateColors || generateColors)(keys.length);
    const map = {};
    keys.forEach((key, i) => {
      map[key] = colors[i];
    });
    return map;
  };
  const leftColorMap = buildColorMap(leftBreakdown);
  const rightColorMap = buildColorMap(rightBreakdown);

  // Append DOM elements for detailed breakdown (with color-keyed headers)
  elements.typeBreakdown.appendChild(createBreakdownElements(leftBreakdown, leftColorMap));
  elements.locationBreakdown.appendChild(createBreakdownElements(rightBreakdown, rightColorMap));

  // Show modal
  if (window.openModalById) openModalById("detailsModal");
  else {
    elements.detailsModal.style.display = "flex";
    document.body.style.overflow = "hidden";
  }

  // Scroll modal body to top on open
  const modalBody = elements.detailsModal.querySelector(".modal-body");
  if (modalBody) modalBody.scrollTop = 0;

  // Clean up any existing resize observer before creating a new one
  if (detailsResizeObserver) {
    detailsResizeObserver.disconnect();
    detailsResizeObserver = null;
  }

  // Add chart resize handling (skip on mobile where charts are hidden)
  if (!isMobile) {
    detailsResizeObserver = new ResizeObserver(() => {
      Object.values(chartInstances).forEach((chart) => {
        if (chart) chart.resize();
      });
    });
    detailsResizeObserver.observe(elements.detailsModal);
  }
};

/**
 * Closes the details modal and cleans up charts
 */
const closeDetailsModal = () => {
  if (detailsResizeObserver) {
    detailsResizeObserver.disconnect();
    detailsResizeObserver = null;
  }
  if (window.closeModalById) closeModalById("detailsModal");
  else {
    elements.detailsModal.style.display = "none";
    try {
      document.body.style.overflow = "";
    } catch (e) {}
  }
  destroyCharts();
};

// =============================================================================

// Expose details modal functions globally for inline handlers
window.showDetailsModal = showDetailsModal;
window.closeDetailsModal = closeDetailsModal;
