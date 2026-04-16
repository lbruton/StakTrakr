// PCGS API — Cert Verification & Coin Lookup
// =============================================================================
// Provides one-click PCGS cert verification and PCGS# lookup via the PCGS
// Public API. Requires a bearer token configured in Settings > API > PCGS.

// ---------------------------------------------------------------------------
// PCGS Response Cache (STAK-222)
// ---------------------------------------------------------------------------

const PCGS_CACHE_TTL_DAYS = 30;

/**
 * Loads a cached PCGS API response by cache key.
 * Keys: "cert-{certNumber}" for cert lookups, "pcgs-{pcgsNumber}" for CoinFacts.
 * Returns null if not found or older than 30 days.
 * @param {string} cacheKey
 * @returns {Object|null}
 */
const loadPcgsCache = (cacheKey) => {
  try {
    const cache = loadDataSync(PCGS_RESPONSE_CACHE_KEY, {});
    const entry = cache[cacheKey];
    if (!entry) return null;
    const ageMs = Date.now() - new Date(entry.fetchedAt).getTime();
    if (ageMs > entry.ttlDays * 24 * 60 * 60 * 1000) return null;
    return entry.data;
  } catch (e) {
    debugLog("[pcgs-cache] Load error: " + e.message, "warn");
    return null;
  }
};

/**
 * Saves a raw PCGS API response to the 30-day cache.
 * @param {string} cacheKey
 * @param {Object} data
 */
const savePcgsCache = (cacheKey, data) => {
  try {
    const cache = loadDataSync(PCGS_RESPONSE_CACHE_KEY, {});
    cache[cacheKey] = { data, fetchedAt: new Date().toISOString(), ttlDays: PCGS_CACHE_TTL_DAYS };
    saveDataSync(PCGS_RESPONSE_CACHE_KEY, cache);
  } catch (e) {
    debugLog("[pcgs-cache] Save error: " + e.message, "warn");
  }
};

/**
 * Clears the entire PCGS response cache.
 * @returns {number} Count of entries cleared
 */
const clearPcgsCache = () => {
  try {
    const cache = loadDataSync(PCGS_RESPONSE_CACHE_KEY, {});
    const count = Object.keys(cache).length;
    saveDataSync(PCGS_RESPONSE_CACHE_KEY, {});
    return count;
  } catch (e) {
    debugLog("[pcgs-cache] Clear error: " + e.message, "warn");
    return 0;
  }
};

/**
 * Returns count of valid (non-expired) entries in the PCGS cache.
 * @returns {number}
 */
const getPcgsCacheCount = () => {
  try {
    const cache = loadDataSync(PCGS_RESPONSE_CACHE_KEY, {});
    const now = Date.now();
    return Object.values(cache).filter((entry) => {
      const ageMs = now - new Date(entry.fetchedAt).getTime();
      return ageMs <= entry.ttlDays * 24 * 60 * 60 * 1000;
    }).length;
  } catch (e) {
    return 0;
  }
};

/**
 * Shared pre-flight checks for all PCGS API calls.
 * @returns {Object|null} Error result if checks fail, null if OK
 */
const pcgsPreflightCheck = () => {
  if (window.location.protocol === "file:") {
    return { verified: false, error: "PCGS API requires HTTPS. Unavailable on file:// protocol." };
  }
  if (typeof catalogConfig === "undefined" || !catalogConfig.isPcgsEnabled()) {
    return {
      verified: false,
      error: "PCGS API not configured. Add your bearer token in Settings > API > PCGS.",
    };
  }
  if (!catalogConfig.canMakePcgsRequest()) {
    return {
      verified: false,
      error: "PCGS daily rate limit reached (1,000 requests/day). Try again tomorrow.",
    };
  }
  return null;
};

/**
 * Shared fetch wrapper for PCGS API calls.
 * @param {string} url - Full API URL
 * @param {string|null} [cacheKey] - Optional cache key (e.g. "cert-12345", "pcgs-786060")
 * @returns {Promise<Object>} Parsed JSON or error result
 */
const pcgsFetch = async (url, cacheKey = null) => {
  // STAK-222: Check response cache first
  if (cacheKey) {
    const cached = loadPcgsCache(cacheKey);
    if (cached) {
      debugLog(`[pcgs-cache] Cache hit: ${cacheKey}`, "info");
      return cached;
    }
  }

  const config = catalogConfig.getPcgsConfig();
  catalogConfig.incrementPcgsUsage();
  if (typeof renderPcgsUsageBar === "function") renderPcgsUsageBar();

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `bearer ${config.bearerToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      return { _error: true, verified: false, error: "Invalid or expired PCGS bearer token." };
    }
    if (response.status === 404) {
      return { _error: true, verified: false, error: "Not found in PCGS database." };
    }
    return { _error: true, verified: false, error: `PCGS API error: HTTP ${response.status}` };
  }

  const data = await response.json();

  // STAK-222: Cache the successful response
  if (cacheKey && !data._error) {
    savePcgsCache(cacheKey, data);
  }

  return data;
};

/**
 * Parse a PCGS API coin detail response into a standardized result object.
 * @param {Object} data - Raw PCGS API response
 * @returns {Object} Parsed coin details
 */
const parsePcgsResponse = (data) => {
  if (!data || (!data.PCGSNo && !data.CertNo)) {
    return { verified: false, error: "Coin not found in PCGS database." };
  }

  const gradeNum = data.Grade || "";
  const pcgsNo = String(data.PCGSNo || "");
  const coinFactsUrl = pcgsNo
    ? `https://www.pcgs.com/coinfacts/coin/detail/${pcgsNo}/${gradeNum}`
    : "";

  return {
    verified: true,
    pcgsNumber: pcgsNo,
    grade: data.GradeString || `${data.GradePrefix || ""}${gradeNum}`,
    population: data.Pop || 0,
    popHigher: data.PopHigher || 0,
    priceGuide: data.PriceGuideValue || 0,
    coinFactsUrl,
    name: data.Name || "",
    year: String(data.Year || ""),
    designation: data.Designation || "",
    denomination: data.Denomination || "",
    mintMark: data.MintMark || "",
    certNumber: String(data.CertNo || ""),
    images: Array.isArray(data.Images)
      ? data.Images.map((img) => ({
          thumbnail: img.Thumbnail || "",
          fullsize: img.Fullsize || "",
        }))
      : [],
  };
};

/**
 * Verify a PCGS certification number via the PCGS Public API.
 *
 * @param {string} certNumber - PCGS certification number to verify
 * @returns {Promise<Object>} Verification result with coin details
 */
const verifyPcgsCert = async (certNumber) => {
  const check = pcgsPreflightCheck();
  if (check) return check;

  const startTime = Date.now();
  try {
    const url = `https://api.pcgs.com/publicapi/coindetail/GetCoinFactsByCertNo/${encodeURIComponent(certNumber)}`;
    const data = await pcgsFetch(url, `cert-${certNumber}`);
    if (data._error) {
      if (typeof recordCatalogHistory === "function") {
        recordCatalogHistory({
          action: "pcgs_verify",
          query: certNumber,
          result: "fail",
          itemCount: 0,
          provider: "PCGS",
          duration: Date.now() - startTime,
          error: data.error,
        });
      }
      return data;
    }
    const parsed = parsePcgsResponse(data);
    if (typeof recordCatalogHistory === "function") {
      recordCatalogHistory({
        action: "pcgs_verify",
        query: certNumber,
        result: parsed.verified ? "success" : "fail",
        itemCount: parsed.verified ? 1 : 0,
        provider: "PCGS",
        duration: Date.now() - startTime,
        error: parsed.verified ? null : parsed.error,
      });
    }
    return parsed;
  } catch (error) {
    if (typeof recordCatalogHistory === "function") {
      recordCatalogHistory({
        action: "pcgs_verify",
        query: certNumber,
        result: "fail",
        itemCount: 0,
        provider: "PCGS",
        duration: Date.now() - startTime,
        error: error.message,
      });
    }
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      return { verified: false, error: "Network error — check your internet connection." };
    }
    return { verified: false, error: error.message || "Unknown error during PCGS verification." };
  }
};

/**
 * Look up a coin by PCGS catalog number via the PCGS Public API.
 *
 * @param {string} pcgsNumber - PCGS catalog number (e.g. "786060")
 * @param {string} [gradeNumber] - Optional grade number for specific grade lookup
 * @returns {Promise<Object>} Lookup result with coin details
 */
const lookupPcgsByNumber = async (pcgsNumber, gradeNumber) => {
  const check = pcgsPreflightCheck();
  if (check) return check;

  const startTime = Date.now();
  try {
    const grade = gradeNumber || "0";
    const url = `https://api.pcgs.com/publicapi/coindetail/GetCoinFactsByPCGSNo/${encodeURIComponent(pcgsNumber)}/${encodeURIComponent(grade)}`;
    const data = await pcgsFetch(url, `pcgs-${pcgsNumber}`);
    if (data._error) {
      if (typeof recordCatalogHistory === "function") {
        recordCatalogHistory({
          action: "pcgs_lookup",
          query: pcgsNumber,
          result: "fail",
          itemCount: 0,
          provider: "PCGS",
          duration: Date.now() - startTime,
          error: data.error,
        });
      }
      return data;
    }
    const parsed = parsePcgsResponse(data);
    if (typeof recordCatalogHistory === "function") {
      recordCatalogHistory({
        action: "pcgs_lookup",
        query: pcgsNumber,
        result: parsed.verified ? "success" : "fail",
        itemCount: parsed.verified ? 1 : 0,
        provider: "PCGS",
        duration: Date.now() - startTime,
        error: parsed.verified ? null : parsed.error,
      });
    }
    return parsed;
  } catch (error) {
    if (typeof recordCatalogHistory === "function") {
      recordCatalogHistory({
        action: "pcgs_lookup",
        query: pcgsNumber,
        result: "fail",
        itemCount: 0,
        provider: "PCGS",
        duration: Date.now() - startTime,
        error: error.message,
      });
    }
    if (error.name === "TypeError" && error.message.includes("fetch")) {
      return { verified: false, error: "Network error — check your internet connection." };
    }
    return { verified: false, error: error.message || "Unknown error during PCGS lookup." };
  }
};

/**
 * Smart PCGS lookup — tries Cert# first, then PCGS#.
 * Reads values from the item form fields.
 *
 * @returns {Promise<Object>} Lookup result with coin details
 */
const lookupPcgsFromForm = async () => {
  const certEl = document.getElementById("itemCertNumber");
  const pcgsEl = document.getElementById("itemPcgsNumber");
  const certNumber = (certEl?.value || "").trim();
  const pcgsNumber = (pcgsEl?.value || "").trim();

  if (!certNumber && !pcgsNumber) {
    return { verified: false, error: "Enter a PCGS Cert# or PCGS# to look up." };
  }

  // Try cert number first (more specific), then PCGS catalog number
  if (certNumber) {
    const result = await verifyPcgsCert(certNumber);
    if (result.verified) return result;
    // If cert lookup fails and we also have a PCGS#, try that
    if (pcgsNumber) {
      const fallback = await lookupPcgsByNumber(pcgsNumber);
      if (fallback.verified) return fallback;
    }
    return result; // Return the cert error
  }

  return lookupPcgsByNumber(pcgsNumber);
};

// =============================================================================
// PCGS Field Picker Modal — UI for selective field filling
// =============================================================================

/** Escape HTML for safe injection into innerHTML */
const escapeHtmlPcgs = (str) =>
  String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Render the selected item preview card with images + metadata.
 * @param {Object} result - Parsed PCGS response
 * @returns {string} HTML string
 */
const renderPcgsSelectedItem = (result) => {
  const placeholder = `<div class="numista-img-placeholder">🛡️</div>`;
  let imagesHtml = "";
  if (result.images && result.images.length > 0) {
    // Show up to 2 images (obverse/reverse)
    imagesHtml = result.images
      .slice(0, 2)
      .map((img) => {
        const src = img.thumbnail || img.fullsize;
        return src ? `<img src="${escapeHtmlPcgs(src)}" alt="PCGS image" loading="lazy">` : "";
      })
      .filter(Boolean)
      .join("");
  }
  if (!imagesHtml) imagesHtml = placeholder;

  const meta = [
    result.year,
    result.denomination,
    result.designation,
    result.mintMark ? `Mint: ${result.mintMark}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const idLink = result.coinFactsUrl
    ? `<a href="${escapeHtmlPcgs(result.coinFactsUrl)}" target="_blank" rel="noopener noreferrer">PCGS #${escapeHtmlPcgs(result.pcgsNumber)}</a>`
    : `PCGS #${escapeHtmlPcgs(result.pcgsNumber)}`;

  return `<div class="numista-result-images">${imagesHtml}</div>
    <div class="numista-result-info">
      <div class="numista-result-name">${escapeHtmlPcgs(result.name)}</div>
      <div class="numista-result-meta">${escapeHtmlPcgs(meta)}</div>
      <div class="numista-result-id">${idLink}</div>
    </div>`;
};

/**
 * Render field checkboxes with editable inputs for the PCGS result.
 * Each row: [checkbox] [label] [editable text input] [optional current hint]
 * @param {Object} result - Parsed PCGS response
 */
const renderPcgsFieldCheckboxes = (result) => {
  const container = document.getElementById("pcgsFieldCheckboxes");
  if (!container) return;

  // Normalize grade: PCGS returns "MS70", our dropdown uses "MS-70"
  const gradeStr = (result.grade || "")
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/^([A-Z]+)(\d)/, "$1-$2");
  const gradeEl = document.getElementById("itemGrade");
  let gradeValid = false;
  if (gradeEl && gradeStr) {
    gradeValid = Array.from(gradeEl.options).some(
      (o) => o.value === gradeStr || o.value === result.grade
    );
  }

  const fields = [
    {
      key: "name",
      label: "Name",
      value: result.name || "",
      available: !!result.name,
      defaultOn: true,
    },
    {
      key: "year",
      label: "Year",
      value: result.year || "",
      available: !!result.year,
      defaultOn: true,
    },
    {
      key: "grade",
      label: "Grade",
      value: gradeStr || result.grade || "",
      available: gradeValid,
      defaultOn: gradeValid,
      warn: result.grade && !gradeValid ? `"${result.grade}" — not in grade options` : "",
    },
    { key: "authority", label: "Authority", value: "PCGS", available: true, defaultOn: true },
    {
      key: "pcgsNumber",
      label: "PCGS #",
      value: result.pcgsNumber || "",
      available: !!result.pcgsNumber,
      defaultOn: true,
    },
    {
      key: "certNumber",
      label: "Cert #",
      value: result.certNumber || "",
      available: !!result.certNumber,
      defaultOn: true,
    },
    {
      key: "retailPrice",
      label: "Retail Price",
      value: result.priceGuide > 0 ? String(result.priceGuide) : "",
      available: result.priceGuide > 0,
      defaultOn: result.priceGuide > 0,
    },
  ];

  // Keep the heading, rebuild field rows
  const heading = container.querySelector(".numista-fields-heading");
  container.innerHTML = "";
  if (heading) {
    container.appendChild(heading);
  } else {
    const h = document.createElement("div");
    h.className = "numista-fields-heading";
    h.textContent = "Fields to fill:";
    container.appendChild(h);
  }

  // Current form values for "Current:" hints
  const currentFormValues = {
    name:
      (
        (typeof elements !== "undefined" && elements.itemName) ||
        document.getElementById("itemName")
      )?.value?.trim() || "",
    year:
      (
        (typeof elements !== "undefined" && elements.itemYear) ||
        document.getElementById("itemYear")
      )?.value?.trim() || "",
    grade:
      (
        (typeof elements !== "undefined" && elements.itemGrade) ||
        document.getElementById("itemGrade")
      )?.value || "",
    authority:
      (
        (typeof elements !== "undefined" && elements.itemGradingAuthority) ||
        document.getElementById("itemGradingAuthority")
      )?.value || "",
    pcgsNumber:
      (
        (typeof elements !== "undefined" && elements.itemPcgsNumber) ||
        document.getElementById("itemPcgsNumber")
      )?.value?.trim() || "",
    certNumber:
      (
        (typeof elements !== "undefined" && elements.itemCertNumber) ||
        document.getElementById("itemCertNumber")
      )?.value?.trim() || "",
    retailPrice:
      (
        (typeof elements !== "undefined" && elements.itemMarketValue) ||
        document.getElementById("itemMarketValue")
      )?.value?.trim() || "",
  };

  fields.forEach((f) => {
    // Checkbox — grid column 1
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = "pcgsField";
    cb.value = f.key;
    cb.checked = f.available && !!f.value && f.defaultOn;
    if (!f.value) cb.disabled = true;

    // Label — grid column 2
    const label = document.createElement("span");
    label.className = "numista-field-label";
    label.textContent = f.label + ":";

    // Editable text input — grid column 3
    const input = document.createElement("input");
    input.type = "text";
    input.className = "numista-field-input";
    input.name = "pcgsFieldValue_" + f.key;
    input.value = f.value;
    input.placeholder = f.available ? "" : "N/A";
    if (!f.available && !f.value) input.disabled = true;

    // Toggle input enabled/disabled when checkbox changes
    cb.addEventListener("change", () => {
      input.disabled = !cb.checked;
    });
    if (!cb.checked) input.disabled = true;

    container.appendChild(cb);
    container.appendChild(label);
    container.appendChild(input);

    // "Current:" hint showing existing form value
    const currentVal = currentFormValues[f.key];
    if (currentVal) {
      const hint = document.createElement("div");
      hint.className = "numista-field-current";
      hint.textContent = `Current: ${currentVal}`;
      hint.title = currentVal;
      container.appendChild(hint);
    }

    // Warning text spanning all columns
    if (f.warn) {
      const warn = document.createElement("div");
      warn.className = "numista-field-warn";
      warn.textContent = f.warn;
      container.appendChild(warn);
    }
  });
};

/**
 * Apply checked fields from the PCGS picker to the item form.
 * Reads values from the pcgsFieldValue_* text inputs (user may have edited them).
 */
const fillFormFromPcgsResult = () => {
  const container = document.getElementById("pcgsFieldCheckboxes");
  if (!container) return;

  const checkboxes = container.querySelectorAll('input[name="pcgsField"]');

  checkboxes.forEach((cb) => {
    if (!cb.checked) return;
    const input = container.querySelector(`input[name="pcgsFieldValue_${cb.value}"]`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;

    switch (cb.value) {
      case "name": {
        const el =
          (typeof elements !== "undefined" && elements.itemName) ||
          document.getElementById("itemName");
        if (el) el.value = val;
        break;
      }
      case "year": {
        const el =
          (typeof elements !== "undefined" && elements.itemYear) ||
          document.getElementById("itemYear");
        if (el) el.value = val;
        break;
      }
      case "grade": {
        const el =
          (typeof elements !== "undefined" && elements.itemGrade) ||
          document.getElementById("itemGrade");
        if (el) {
          const options = Array.from(el.options);
          const match = options.find(
            (o) => o.value === val || o.value === val.toUpperCase().replace(/\s+/g, "-")
          );
          if (match) el.value = match.value;
        }
        break;
      }
      case "authority": {
        const el =
          (typeof elements !== "undefined" && elements.itemGradingAuthority) ||
          document.getElementById("itemGradingAuthority");
        if (el) el.value = val;
        break;
      }
      case "pcgsNumber": {
        const el =
          (typeof elements !== "undefined" && elements.itemPcgsNumber) ||
          document.getElementById("itemPcgsNumber");
        if (el) el.value = val;
        break;
      }
      case "certNumber": {
        const el =
          (typeof elements !== "undefined" && elements.itemCertNumber) ||
          document.getElementById("itemCertNumber");
        if (el) el.value = val;
        break;
      }
      case "retailPrice": {
        const el =
          (typeof elements !== "undefined" && elements.itemMarketValue) ||
          document.getElementById("itemMarketValue");
        const num = parseFloat(val);
        if (el && !isNaN(num) && num > 0) el.value = num;
        break;
      }
    }
  });
};

/**
 * Open the PCGS field picker modal with the given lookup result.
 * @param {Object} result - Parsed PCGS response
 */
const showPcgsFieldPicker = (result) => {
  const modal = document.getElementById("pcgsFieldPickerModal");
  const title = document.getElementById("pcgsFieldPickerTitle");
  const preview = document.getElementById("pcgsSelectedItem");

  if (!modal) return;

  if (title) title.textContent = "PCGS Item Found";
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
  if (preview) preview.innerHTML = renderPcgsSelectedItem(result);
  renderPcgsFieldCheckboxes(result);

  modal.style.display = "flex";
};

/** Close the PCGS field picker modal. */
const closePcgsFieldPicker = () => {
  const modal = document.getElementById("pcgsFieldPickerModal");
  if (modal) modal.style.display = "none";
};

// =============================================================================
// PCGS Field Picker Modal — event wiring (runs on DOMContentLoaded)
// =============================================================================
document.addEventListener("DOMContentLoaded", function () {
  const pcgsPickerModal = document.getElementById("pcgsFieldPickerModal");
  const pcgsPickerCloseBtn = document.getElementById("pcgsFieldPickerCloseBtn");
  const pcgsFillCancelBtn = document.getElementById("pcgsFillCancelBtn");
  const pcgsFillBtn = document.getElementById("pcgsFillBtn");

  // Close button
  if (pcgsPickerCloseBtn) {
    pcgsPickerCloseBtn.addEventListener("click", closePcgsFieldPicker);
  }

  // Cancel button
  if (pcgsFillCancelBtn) {
    pcgsFillCancelBtn.addEventListener("click", closePcgsFieldPicker);
  }

  // Fill Fields button
  if (pcgsFillBtn) {
    pcgsFillBtn.addEventListener("click", function () {
      fillFormFromPcgsResult();
      closePcgsFieldPicker();
    });
  }

  // Background click dismiss
  if (pcgsPickerModal) {
    pcgsPickerModal.addEventListener("click", function (e) {
      if (e.target === pcgsPickerModal) {
        closePcgsFieldPicker();
      }
    });
  }

  // ESC key handler
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      const modal = document.getElementById("pcgsFieldPickerModal");
      if (modal && modal.style.display !== "none") {
        e.stopImmediatePropagation();
        closePcgsFieldPicker();
      }
    }
  });
});

// Expose globally
if (typeof window !== "undefined") {
  window.verifyPcgsCert = verifyPcgsCert;
  window.lookupPcgsByNumber = lookupPcgsByNumber;
  window.lookupPcgsFromForm = lookupPcgsFromForm;
  window.showPcgsFieldPicker = showPcgsFieldPicker;
  window.closePcgsFieldPicker = closePcgsFieldPicker;
  // STAK-222: PCGS response cache
  window.loadPcgsCache = loadPcgsCache;
  window.savePcgsCache = savePcgsCache;
  window.clearPcgsCache = clearPcgsCache;
  window.getPcgsCacheCount = getPcgsCacheCount;
}
