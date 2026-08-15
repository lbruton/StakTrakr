// SPOT LOOKUP — Historical Spot Price Lookup for Add/Edit Form (STACK-49)
// =============================================================================

/**
 * Symbol mapping for API requests (metal name → ISO 4217 precious metal code)
 */
const METAL_SYMBOLS = {
  Silver: "XAG",
  Gold: "XAU",
  Platinum: "XPT",
  Palladium: "XPD",
  Copper: "XCU", // STRK-305
};

let _spotLookupTargetField = "purchase";

const _spotLookupModalRefs = {
  title: null,
  body: null,
};

const getSpotLookupModalRef = (key, id) => {
  const cached = _spotLookupModalRefs[key];
  if (cached?.isConnected) return cached;

  const element = typeof safeGetElement === "function" ? safeGetElement(id) : null;
  _spotLookupModalRefs[key] = element?.nodeType === 1 ? element : null;
  return _spotLookupModalRefs[key];
};

const isGoldbackLookup = () => elements.itemWeightUnit?.value === "gb";

const getGoldbackLookupDenomination = () => {
  return parseFloat(
    elements.itemGbDenom?.value ||
      elements.itemWeight?.value ||
      (elements.itemWeightUnit?.value === "gb" ? 1 : 0)
  );
};

/**
 * Syncs spot lookup button state and optionally clears the hidden selected spot value.
 *
 * @param {boolean} hasDate - Whether the item currently has a purchase date
 * @param {{ clearSelectedSpot?: boolean }} [options]
 */
const syncSpotLookupButtons = (hasDate, options = {}) => {
  const { clearSelectedSpot = true } = options;

  if (elements.spotLookupBtn) {
    elements.spotLookupBtn.disabled = !hasDate;
  }
  if (elements.retailSpotLookupBtn) {
    elements.retailSpotLookupBtn.disabled = !hasDate;
  }
  if (clearSelectedSpot && elements.itemSpotPrice) {
    elements.itemSpotPrice.value = "";
  }
};

/**
 * Converts a selected spot price to the display-currency value for the current item.
 * Goldback-denominated items reuse the existing per-unit estimate logic.
 *
 * @param {number} spotPrice - USD spot price
 * @returns {string} Display-currency value formatted to 2 decimals
 */
const getSpotLookupDisplayValue = (spotPrice, timestamp = "") => {
  const fxRate = typeof getExchangeRate === "function" ? getExchangeRate() : 1;

  let priceUSD = spotPrice;
  if (elements.itemWeightUnit?.value === "gb") {
    const denom = getGoldbackLookupDenomination() || 1;
    const historyPrice =
      timestamp && typeof getGoldbackHistoryPrice === "function"
        ? getGoldbackHistoryPrice(denom, timestamp)
        : null;

    if (historyPrice) {
      priceUSD = historyPrice;
    } else if (typeof getGoldbackDenominationPrice === "function") {
      priceUSD = getGoldbackDenominationPrice(denom) || priceUSD;
    } else if (typeof computeGoldbackEstimatedRate === "function") {
      priceUSD = computeGoldbackEstimatedRate(spotPrice) * denom;
    }
  }

  return (priceUSD * fxRate).toFixed(2);
};

/**
 * Briefly highlights an input that was populated from a spot lookup selection.
 *
 * @param {HTMLElement|null|undefined} input
 */
const flashSpotLookupTarget = (input) => {
  if (!input) return;
  input.style.transition = "background-color 0.3s";
  input.style.backgroundColor = "var(--accent, #fbbf24)";
  setTimeout(() => {
    input.style.backgroundColor = "";
  }, 800);
};

/**
 * Searches local spot history for prices near a given date for a specific metal.
 * Uses progressive widening: exact → ±1d → ±3d → ±7d.
 *
 * @param {string} metalName - Metal name ('Silver', 'Gold', 'Platinum', 'Palladium')
 * @param {string} dateStr - Target date in YYYY-MM-DD format
 * @returns {Array<Object>} Matching entries with `dayOffset` appended, sorted by proximity
 */
const searchSpotByDate = (metalName, dateStr) => {
  if (!metalName || !dateStr || !Array.isArray(spotHistory)) return [];

  const targetDate = new Date(dateStr + "T00:00:00");
  if (isNaN(targetDate.getTime())) return [];

  // Filter to matching metal
  const metalEntries = spotHistory.filter((e) => e.metal === metalName);
  if (metalEntries.length === 0) return [];

  // Compute day offset for each entry
  const withOffset = metalEntries.map((entry) => {
    const entryDate = new Date(entry.timestamp);
    const diffMs = entryDate.getTime() - targetDate.getTime();
    const dayOffset = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return { ...entry, dayOffset };
  });

  // Progressive widening: try exact, then ±1, ±3, ±7
  const windows = [0, 1, 3, 7];
  let results = [];
  for (const window of windows) {
    results = withOffset.filter((e) => Math.abs(e.dayOffset) <= window);
    if (results.length > 0) break;
  }

  // Sort by proximity (absolute offset), then by newest timestamp
  results.sort((a, b) => {
    const proxDiff = Math.abs(a.dayOffset) - Math.abs(b.dayOffset);
    if (proxDiff !== 0) return proxDiff;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  // Deduplicate by day (keep latest entry per calendar day)
  const byDay = new Map();
  results.forEach((entry) => {
    const day = entry.timestamp.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, entry);
    }
  });

  return [...byDay.values()];
};

/**
 * Checks whether an API lookup is possible for a given date and returns availability info.
 *
 * @param {string} dateStr - Target date in YYYY-MM-DD format
 * @returns {{ available: boolean, provider: string, providerName: string, withinLimit: boolean, maxDays: number }}
 */
const getApiAvailability = (dateStr) => {
  const result = {
    available: false,
    provider: "",
    providerName: "",
    withinLimit: false,
    maxDays: 0,
  };

  const config = typeof loadApiConfig === "function" ? loadApiConfig() : null;
  if (!config) return result;

  // Find a suitable provider: prefer active, then fall back to any with a key + batch support
  let provider = "";
  if (
    config.provider &&
    config.keys[config.provider] &&
    API_PROVIDERS[config.provider]?.batchSupported
  ) {
    provider = config.provider;
  } else {
    for (const p of Object.keys(API_PROVIDERS)) {
      if (config.keys[p] && API_PROVIDERS[p]?.batchSupported) {
        provider = p;
        break;
      }
    }
  }

  if (!provider) return result;

  const providerConfig = API_PROVIDERS[provider];
  result.available = true;
  result.provider = provider;
  result.providerName = providerConfig.name;
  result.maxDays = providerConfig.maxHistoryDays || 30;

  // Check if date is within provider's history limit
  const targetDate = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - targetDate.getTime()) / (1000 * 60 * 60 * 24));
  result.withinLimit = diffDays <= result.maxDays;

  return result;
};

/**
 * Fetches spot price from the API for a specific date and metal.
 * Records fetched entries into local spotHistory for future lookups.
 *
 * @param {string} metalName - Metal name ('Silver', 'Gold', etc.)
 * @param {string} dateStr - Target date in YYYY-MM-DD format
 * @returns {Promise<Array>} Fetched entries with dayOffset
 */
const fetchSpotForDate = async (metalName, dateStr) => {
  const config = typeof loadApiConfig === "function" ? loadApiConfig() : null;
  if (!config) throw new Error("No API configuration found.");

  const avail = getApiAvailability(dateStr);
  if (!avail.available) throw new Error("No API provider with batch support is configured.");
  if (!avail.withinLimit)
    throw new Error(`Date is beyond ${avail.providerName}'s ${avail.maxDays}-day limit.`);

  const provider = avail.provider;
  const providerConfig = API_PROVIDERS[provider];
  const apiKey = config.keys[provider];
  if (!apiKey) throw new Error("No API key configured for " + avail.providerName);

  const metalSymbol = METAL_SYMBOLS[metalName];
  if (!metalSymbol) throw new Error("Unknown metal: " + metalName);

  // Build URL from provider's batch endpoint template
  let url = providerConfig.baseUrl + providerConfig.batchEndpoint;
  url = url.replace("{API_KEY}", apiKey);
  url = url.replace("{START_DATE}", dateStr);
  url = url.replace("{END_DATE}", dateStr);
  url = url.replace("{SYMBOLS}", metalSymbol);
  url = url.replace("{CURRENCIES}", metalSymbol);

  // Metals.dev needs special header
  const headers = {};
  if (provider === "METALS_DEV") {
    headers["Accept"] = "application/json";
  }

  // Safe: URL constructed from hardcoded API_PROVIDERS config (baseUrl + batchEndpoint + templated dates/metals)
  const response = await fetch(url, { method: "GET", headers, mode: "cors" });
  if (!response.ok) throw new Error(`API request failed: HTTP ${response.status}`);

  const data = await response.json();

  // Increment usage counter
  if (config.usage && config.usage[provider]) {
    config.usage[provider].used++;
    if (typeof saveApiConfig === "function") saveApiConfig(config);
  }

  // Parse response using provider's batch parser
  const parsed = providerConfig.parseBatchResponse(data) || {};
  const history = parsed.history || {};
  const current = parsed.current || {};

  // Collect entries for the requested metal
  const fetched = [];
  const metalKey = metalName.toLowerCase();

  // Process history entries
  if (history[metalKey] && Array.isArray(history[metalKey])) {
    history[metalKey].forEach((entry) => {
      const price = entry.price;
      if (typeof price === "number" && price > 0) {
        const ts = entry.timestamp || dateStr + " 00:00:00";
        if (typeof recordSpot === "function") {
          recordSpot(price, "api", metalName, avail.providerName, ts);
        }
        fetched.push({
          spot: price,
          metal: metalName,
          source: "api",
          provider: avail.providerName,
          timestamp: ts,
          dayOffset: 0,
        });
      }
    });
  }

  // Process current prices if no history entries
  if (fetched.length === 0 && current[metalKey]) {
    const price = current[metalKey];
    if (typeof price === "number" && price > 0) {
      const ts = dateStr + " 00:00:00";
      if (typeof recordSpot === "function") {
        recordSpot(price, "api", metalName, avail.providerName, ts);
      }
      fetched.push({
        spot: price,
        metal: metalName,
        source: "api",
        provider: avail.providerName,
        timestamp: ts,
        dayOffset: 0,
      });
    }
  }

  return fetched;
};

/**
 * Searches historical year files for prices near a given date for a specific metal.
 * Uses the same progressive widening as searchSpotByDate: exact → ±1d → ±3d → ±7d.
 * Requires fetchYearFile() from spot.js (STACK-69).
 *
 * @param {string} metalName - Metal name ('Silver', 'Gold', 'Platinum', 'Palladium')
 * @param {string} dateStr - Target date in YYYY-MM-DD format
 * @returns {Promise<Array<Object>>} Matching entries with `dayOffset` appended, sorted by proximity
 */
const searchHistoricalByDate = async (metalName, dateStr) => {
  if (typeof fetchYearFile !== "function") return [];

  const targetDate = new Date(dateStr + "T00:00:00");
  if (isNaN(targetDate.getTime())) return [];

  // Fetch target year + adjacent years (±7d window can cross year boundary)
  const year = targetDate.getFullYear();
  const yearsToFetch = [year - 1, year, year + 1].filter((y) => y >= 1968);
  const yearArrays = await Promise.all(yearsToFetch.map(fetchYearFile));
  const allEntries = yearArrays.flat().filter((e) => e.metal === metalName);

  if (allEntries.length === 0) return [];

  // Compute day offset for each entry
  const withOffset = allEntries.map((entry) => {
    const entryDate = new Date(entry.timestamp);
    const diffMs = entryDate.getTime() - targetDate.getTime();
    const dayOffset = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return { ...entry, dayOffset };
  });

  // Progressive widening: try exact, then ±1, ±3, ±7
  const windows = [0, 1, 3, 7];
  let results = [];
  for (const window of windows) {
    results = withOffset.filter((e) => Math.abs(e.dayOffset) <= window);
    if (results.length > 0) break;
  }

  // Sort by proximity (absolute offset), then by newest timestamp
  results.sort((a, b) => {
    const proxDiff = Math.abs(a.dayOffset) - Math.abs(b.dayOffset);
    if (proxDiff !== 0) return proxDiff;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  // Deduplicate by day (keep latest entry per calendar day)
  const byDay = new Map();
  results.forEach((entry) => {
    const day = entry.timestamp.slice(0, 10);
    if (!byDay.has(day)) {
      byDay.set(day, entry);
    }
  });

  return [...byDay.values()];
};

/**
 * Opens the spot lookup modal, searching local history and historical seed data
 * for the date and metal currently selected in the add/edit form.
 */
const openSpotLookupModal = async (targetField = "purchase") => {
  _spotLookupTargetField = targetField === "retail" ? "retail" : "purchase";
  const isRetailTarget = _spotLookupTargetField === "retail";
  const isGb = isGoldbackLookup();

  // Retail snapshots use today's date; purchase lookups use the entered purchase date.
  const dateVal = isRetailTarget
    ? new Date().toLocaleDateString("en-CA")
    : (elements.itemDate?.value ?? "");

  if (!dateVal) {
    appAlert("Please select a purchase date first.");
    return;
  }

  // Derive metal name from composition (same logic as parseItemFormFields).
  // Skipped for goldback lookups since the goldback branch doesn't use metalName.
  const metalVal = elements.itemMetal ? elements.itemMetal.value : "";
  const composition =
    typeof getCompositionFirstWords === "function" ? getCompositionFirstWords(metalVal) : metalVal;
  const metalName =
    typeof parseNumistaMetal === "function" ? parseNumistaMetal(composition) : composition;

  if (!isGb && (!metalName || metalName === "Alloy")) {
    appAlert("Please select a supported metal (Silver, Gold, Platinum, Palladium, or Copper).");
    return;
  }

  if (isGb) {
    const denom = getGoldbackLookupDenomination() || 1;
    let goldbackResults =
      typeof searchGoldbackHistoryByDate === "function"
        ? searchGoldbackHistoryByDate(denom, dateVal)
        : [];

    if (
      goldbackResults.length === 0 &&
      window.goldbackPricingSource === "api" &&
      typeof fetchGoldbackApiPrices === "function"
    ) {
      await fetchGoldbackApiPrices({ expectedSource: "api" });
      goldbackResults =
        typeof searchGoldbackHistoryByDate === "function"
          ? searchGoldbackHistoryByDate(denom, dateVal)
          : [];
    }

    const titleEl = getSpotLookupModalRef("title", "spotLookupTitle");
    if (titleEl) {
      titleEl.textContent = `Goldback Lookup — ${denom} Goldback on ${dateVal}`;
    }

    const bodyEl = getSpotLookupModalRef("body", "spotLookupBody");
    if (!bodyEl) return;

    if (goldbackResults.length > 0) {
      renderSpotLookupResults(
        bodyEl,
        goldbackResults.map((entry) => ({
          ...entry,
          spot: entry.price,
          lookupPrice: entry.price,
        }))
      );
    } else {
      renderGoldbackLookupEmpty(bodyEl, denom, dateVal);
    }

    if (typeof openModalById === "function") {
      openModalById("spotLookupModal");
    }
    return;
  }

  // Search local spotHistory first (≤180 days)
  let results = searchSpotByDate(metalName, dateVal);

  // Fallback: search historical year files (STACK-69)
  if (results.length === 0) {
    results = await searchHistoricalByDate(metalName, dateVal);
  }

  // Update modal title
  const titleEl = getSpotLookupModalRef("title", "spotLookupTitle");
  if (titleEl) {
    titleEl.textContent = `Spot Lookup — ${metalName} on ${dateVal}`;
  }

  // Render results into modal body
  const bodyEl = getSpotLookupModalRef("body", "spotLookupBody");
  if (!bodyEl) return;

  if (results.length > 0) {
    renderSpotLookupResults(bodyEl, results);
  } else {
    renderSpotLookupEmpty(bodyEl, metalName, dateVal);
  }

  // Open the modal
  if (typeof openModalById === "function") {
    openModalById("spotLookupModal");
  }
};

/**
 * Renders spot lookup results into the modal body.
 * @param {HTMLElement} container - The modal body element
 * @param {Array} results - Search results with dayOffset
 */
const renderSpotLookupResults = (container, results) => {
  const formatPrice =
    typeof formatCurrency === "function" ? formatCurrency : (v) => "$" + Number(v).toFixed(2);
  const isGb = isGoldbackLookup();
  const priceHeading = isGb ? "Goldback Price" : "Spot Price";

  let html = '<table class="spot-lookup-table"><thead><tr>';
  html += `<th>Date/Time</th><th>${priceHeading}</th><th>Source</th><th></th>`;
  html += "</tr></thead><tbody>";

  results.forEach((entry) => {
    const ts = entry.timestamp ? formatTimestamp(entry.timestamp) : "";
    const lookupPrice =
      typeof entry.lookupPrice === "number" && entry.lookupPrice > 0 ? entry.lookupPrice : null;
    const price = formatPrice(lookupPrice || entry.spot);
    const source = entry.source === "seed" ? "Seed" : entry.provider || entry.source || "";

    html += "<tr>";
    html += `<td>${ts}</td>`;
    html += `<td><strong>${price}</strong></td>`;
    html += `<td>${escapeHtml(source)}</td>`;
    html +=
      `<td><button class="btn spot-lookup-use-btn" type="button" ` +
      `data-spot="${escapeHtml(entry.spot)}" data-retail="${escapeHtml(lookupPrice || "")}" data-ts="${escapeHtml(entry.timestamp || "")}">Use</button></td>`;
    html += "</tr>";
  });

  html += "</tbody></table>";

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  container.innerHTML = html;

  // Attach "Use" button handlers via event delegation
  container.querySelectorAll(".spot-lookup-use-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const spotPrice = parseFloat(btn.dataset.spot);
      const retailPrice = parseFloat(btn.dataset.retail);
      const timestamp = btn.dataset.ts || "";
      useSpotPrice(spotPrice, timestamp, retailPrice);
    });
  });
};

const renderGoldbackLookupEmpty = (container, denom, dateStr) => {
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  container.innerHTML =
    '<div class="spot-lookup-empty">' +
    `<p>No Goldback price history found for ${escapeHtml(String(denom))} Goldback on ${escapeHtml(dateStr)}.</p>` +
    '<p class="spot-lookup-hint">Goldback API history is used for Goldback retail lookup. If it is unavailable, the saved manual retail value can still be entered directly.</p>' +
    "</div>";
};

/**
 * Renders the empty state when no local history matches.
 * Shows "Fetch from API" button if a provider is available.
 * @param {HTMLElement} container - The modal body element
 * @param {string} metalName - Metal name
 * @param {string} dateStr - Target date
 */
const renderSpotLookupEmpty = (container, metalName, dateStr) => {
  const avail = getApiAvailability(dateStr);

  let html = '<div class="spot-lookup-empty">';
  html += "<p>No spot price history found for this date.</p>";
  html += '<p class="spot-lookup-hint">Local history retains up to 180 days of price records.</p>';

  if (avail.available) {
    if (avail.withinLimit) {
      html +=
        `<button class="btn secondary spot-lookup-fetch-btn" type="button" ` +
        `data-metal="${escapeHtml(metalName)}" data-date="${escapeHtml(dateStr)}">`;
      html += `Fetch from ${escapeHtml(avail.providerName)}</button>`;
    } else {
      html += `<p class="spot-lookup-hint">Date is beyond ${escapeHtml(avail.providerName)}'s ${escapeHtml(avail.maxDays)}-day history limit.</p>`;
    }
  } else {
    html +=
      '<p class="spot-lookup-hint">Configure an API key in Settings to fetch historical prices.</p>';
  }

  html += "</div>";

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  container.innerHTML = html;

  // Attach fetch handler if button exists
  const fetchBtn = container.querySelector(".spot-lookup-fetch-btn");
  if (fetchBtn) {
    fetchBtn.addEventListener("click", async () => {
      const metal = fetchBtn.dataset.metal;
      const date = fetchBtn.dataset.date;

      fetchBtn.textContent = "Fetching...";
      fetchBtn.disabled = true;

      try {
        const fetched = await fetchSpotForDate(metal, date);
        if (fetched.length > 0) {
          // Re-render with results
          renderSpotLookupResults(container, fetched);
        } else {
          fetchBtn.textContent = "No data returned";
          fetchBtn.disabled = true;
        }
      } catch (err) {
        console.error("Spot lookup API error:", err);
        // Show inline error
        const errEl = document.createElement("p");
        errEl.className = "spot-lookup-hint";
        errEl.style.color = "var(--danger, #dc3545)";
        errEl.textContent = err.message || "Failed to fetch spot price.";
        container.appendChild(errEl);
        fetchBtn.textContent = "Retry";
        fetchBtn.disabled = false;
      }
    });
  }
};

/**
 * Uses a selected spot price from the lookup modal.
 * Sets the hidden itemSpotPrice field and closes the modal.
 *
 * @param {number} spotPrice - The selected spot price
 * @param {string} timestamp - Timestamp of the selected entry (for reference)
 */
const useSpotPrice = (spotPrice, timestamp, retailLookupPrice = NaN) => {
  const fxRate = typeof getExchangeRate === "function" ? getExchangeRate() : 1;
  const displayPrice =
    _spotLookupTargetField === "retail" &&
    typeof retailLookupPrice === "number" &&
    retailLookupPrice > 0
      ? (retailLookupPrice * fxRate).toFixed(2)
      : getSpotLookupDisplayValue(spotPrice, timestamp);

  if (_spotLookupTargetField === "retail") {
    if (elements.itemMarketValue) {
      elements.itemMarketValue.value = displayPrice;
      flashSpotLookupTarget(elements.itemMarketValue);
    }
  } else {
    // Store in hidden field for spotPriceAtPurchase (melt value calculation)
    if (elements.itemSpotPrice) {
      elements.itemSpotPrice.value = spotPrice;
    }

    if (elements.itemPrice) {
      elements.itemPrice.value = displayPrice;
      if (typeof window.resetPurchasePriceToggle === "function") {
        window.resetPurchasePriceToggle();
      }
      flashSpotLookupTarget(elements.itemPrice);
    }
  }

  closeSpotLookupModal();
};

/**
 * Closes the spot lookup modal.
 */
const closeSpotLookupModal = () => {
  if (typeof closeModalById === "function") {
    closeModalById("spotLookupModal");
  }
};

// Global exports
window.openSpotLookupModal = openSpotLookupModal;
window.closeSpotLookupModal = closeSpotLookupModal;
window.searchSpotByDate = searchSpotByDate;
window.fetchSpotForDate = fetchSpotForDate;
window.syncSpotLookupButtons = syncSpotLookupButtons;
