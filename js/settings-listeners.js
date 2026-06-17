/**
 * Settings modal listener binders (STAK-135)
 *
 * Keeps listener wiring split by concern while preserving existing behavior.
 */

let _patternMode = "keywords";

/**
 * Helper to safely get an element by ID, returning null if not found.
 *
 * @param {string} id - The DOM element ID
 * @returns {HTMLElement|null} The element or null
 */
const getExistingElement = (id) => {
  const el = safeGetElement(id);
  return el && el.id ? el : null;
};

/**
 * Binds listeners for settings modal navigation (sidebar, provider tabs, log tabs).
 */
const bindSettingsNavigationListeners = () => {
  // Sidebar navigation.
  document.querySelectorAll(".settings-nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      switchSettingsSection(item.dataset.section);
    });
  });

  // Log sub-tabs.
  document.querySelectorAll("[data-log-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      switchLogTab(tab.dataset.logTab);
    });
  });
};

/**
 * Binds listeners for appearance settings (theme, display currency, timezone, header toggles).
 */
const bindAppearanceAndHeaderListeners = () => {
  // Theme picker buttons.
  document.querySelectorAll(".theme-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme;
      if (typeof setTheme === "function") {
        setTheme(theme);
      }
      if (typeof updateThemeButton === "function") {
        updateThemeButton();
      }
      document.querySelectorAll(".theme-option").forEach((b) => {
        b.classList.toggle("active", b.dataset.theme === theme);
      });
    });
  });

  // Display currency (STACK-50).
  const currencySelect = getExistingElement("settingsDisplayCurrency");
  if (currencySelect) {
    currencySelect.addEventListener("change", () => {
      saveDisplayCurrency(currencySelect.value);
    });
  }

  // Display timezone (STACK-63).
  const tzSelect = getExistingElement("settingsTimezone");
  if (tzSelect) {
    tzSelect.addEventListener("change", () => {
      localStorage.setItem(TIMEZONE_KEY, tzSelect.value);
      window.location.reload();
    });
  }

  // settingsHeaderCurrencyBtn still exists in the Currency settings panel
  wireStorageToggle("settingsHeaderCurrencyBtn", "headerCurrencyBtnVisible", {
    defaultVal: false,
    onApply: () => applyHeaderToggleVisibility(),
  });

  wireStorageToggle("settingsHeaderShowText_hdr", HEADER_BTN_SHOW_TEXT_KEY, {
    defaultVal: true,
    onApply: () => applyHeaderToggleVisibility(),
  });

  // Spot ratio chips visibility (STRK-161)
  wireStorageToggle("showSpotRatiosToggle", SPOT_RATIOS_KEY, {
    defaultVal: true,
    onApply: () => {
      if (typeof renderRatioChips === "function") renderRatioChips();
    },
  });

  // Trend cycle header button.
  const headerTrendBtn = safeGetElement("headerTrendBtn");
  if (headerTrendBtn) {
    headerTrendBtn.addEventListener("click", () => {
      if (typeof window.cycleSpotTrend === "function") window.cycleSpotTrend();
    });
  }

  // Sync all spot prices header button — single call, not per-metal loop (STRK-93).
  const headerSyncBtn = safeGetElement("headerSyncBtn");
  if (headerSyncBtn) {
    headerSyncBtn.addEventListener("click", () => {
      if (typeof window.syncSpotPricesFromApi === "function") {
        window.syncSpotPricesFromApi(true);
      } else {
        appAlert(
          "API sync functionality requires Metals API configuration. Please configure an API provider first."
        );
      }
    });
  }

  // Theme cycle header button (STACK-54).
  if (elements.headerThemeBtn) {
    elements.headerThemeBtn.addEventListener("click", () => {
      if (typeof toggleTheme === "function") toggleTheme();
      if (typeof updateThemeButton === "function") updateThemeButton();
      const currentTheme = localStorage.getItem(THEME_KEY) || "light";
      document.querySelectorAll(".theme-option").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.theme === currentTheme);
      });
    });
  }

  // Currency picker header button (STACK-54).
  if (elements.headerCurrencyBtn) {
    elements.headerCurrencyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCurrencyDropdown();
    });
  }

  // Market button - trigger market refresh (STAK-545).
  const headerMarketBtn = safeGetElement("headerMarketBtn");
  if (headerMarketBtn) {
    headerMarketBtn.addEventListener("click", () => {
      if (typeof window.syncRetailPrices === "function") window.syncRetailPrices();
    });
  }

  // Vault header button — opens Settings → System (backup/restore) (STAK-314).
  const headerVaultBtn = safeGetElement("headerVaultBtn");
  if (headerVaultBtn) {
    headerVaultBtn.addEventListener("click", () => {
      if (typeof showSettingsModal === "function") showSettingsModal("system");
    });
  }

  // Restore header button — opens Settings → System (backup/restore) (STAK-314).
  const headerRestoreBtn = safeGetElement("headerRestoreBtn");
  if (headerRestoreBtn) {
    headerRestoreBtn.addEventListener("click", () => {
      if (typeof showSettingsModal === "function") showSettingsModal("system");
    });
  }

  const ippSelect = getExistingElement("settingsItemsPerPage");
  if (ippSelect) {
    ippSelect.addEventListener("change", () => {
      const ippVal = ippSelect.value;
      itemsPerPage = ippVal === "all" ? Infinity : parseInt(ippVal, 10);
      try {
        localStorage.setItem(ITEMS_PER_PAGE_KEY, ippVal);
      } catch (e) {
        /* ignore */
      }
      if (elements.itemsPerPage) elements.itemsPerPage.value = ippVal;
      renderTable();
    });
  }

  const spotCompareSetting = getExistingElement("settingsSpotCompareMode");
  if (spotCompareSetting) {
    spotCompareSetting.addEventListener("change", () => {
      try {
        localStorage.setItem(SPOT_COMPARE_MODE_KEY, spotCompareSetting.value);
      } catch (e) {
        /* ignore */
      }
      if (typeof updateAllSparklines === "function") updateAllSparklines();
    });
  }
};

/**
 * Binds listeners for filter settings and Numista integration options.
 */
const bindFilterAndNumistaListeners = () => {
  const chipMinSetting = getExistingElement("settingsChipMinCount");
  if (chipMinSetting) {
    chipMinSetting.addEventListener("change", () => {
      const val = chipMinSetting.value;
      localStorage.setItem("chipMinCount", val);
      const chipMinInline = getExistingElement("chipMinCount");
      if (chipMinInline) chipMinInline.value = val;
      if (typeof renderActiveFilters === "function") renderActiveFilters();
      if (typeof scheduleSyncPush === "function") scheduleSyncPush();
    });
  }

  const chipMaxSetting = getExistingElement("settingsChipMaxCount");
  if (chipMaxSetting) {
    chipMaxSetting.addEventListener("change", () => {
      const val = chipMaxSetting.value;
      localStorage.setItem("chipMaxCount", val);
      const chipMaxInline = getExistingElement("chipMaxCount");
      if (chipMaxInline) chipMaxInline.value = val;
      if (typeof renderActiveFilters === "function") renderActiveFilters();
      if (typeof scheduleSyncPush === "function") scheduleSyncPush();
    });
  }

  wireFeatureFlagToggle("settingsGroupNameChips", "GROUPED_NAME_CHIPS", {
    syncId: "groupNameChips",
    onApply: () => {
      if (typeof renderActiveFilters === "function") renderActiveFilters();
    },
  });

  wireFeatureFlagToggle("settingsDynamicChips", "DYNAMIC_NAME_CHIPS", {
    onApply: () => {
      if (typeof renderActiveFilters === "function") renderActiveFilters();
    },
  });

  wireFeatureFlagToggle("settingsChipQtyBadge", "CHIP_QTY_BADGE", {
    onApply: () => {
      if (typeof renderActiveFilters === "function") renderActiveFilters();
    },
  });

  wireFeatureFlagToggle("settingsFuzzyAutocomplete", "FUZZY_AUTOCOMPLETE", {
    onApply: (isEnabled) => {
      if (isEnabled && typeof initializeAutocomplete === "function")
        initializeAutocomplete(inventory);
    },
  });

  const numistaViewContainer = getExistingElement("numistaViewFieldToggles");
  if (numistaViewContainer) {
    const nfConfig =
      typeof getNumistaViewFieldConfig === "function" ? getNumistaViewFieldConfig() : {};
    numistaViewContainer.querySelectorAll("input[data-nf]").forEach((cb) => {
      const field = cb.dataset.nf;
      if (nfConfig[field] !== undefined) cb.checked = nfConfig[field];
    });
    numistaViewContainer.addEventListener("change", () => {
      const config = {};
      numistaViewContainer.querySelectorAll("input[data-nf]").forEach((cb) => {
        config[cb.dataset.nf] = cb.checked;
      });
      if (typeof saveNumistaViewFieldConfig === "function") saveNumistaViewFieldConfig(config);
    });
  }

  const addNumistaRuleBtn = getExistingElement("addNumistaRuleBtn");
  if (addNumistaRuleBtn) {
    addNumistaRuleBtn.addEventListener("click", () => {
      const patternInput = getExistingElement("numistaRulePatternInput");
      const replacementInput = getExistingElement("numistaRuleReplacementInput");
      const idInput = getExistingElement("numistaRuleIdInput");
      if (!patternInput || !replacementInput) return;

      const pattern = patternInput.value.trim();
      const replacement = replacementInput.value.trim();
      const numistaId = idInput ? idInput.value.trim() : "";

      if (!pattern || !replacement) {
        appAlert("Pattern and Numista query are required.");
        return;
      }

      if (!window.NumistaLookup) return;
      const result = NumistaLookup.addRule(pattern, replacement, numistaId || null);
      if (!result.success) {
        appAlert(result.error);
        return;
      }

      patternInput.value = "";
      replacementInput.value = "";
      if (idInput) idInput.value = "";
      renderCustomRuleTable();
    });
  }

  wireChipSortToggle("settingsChipSortOrder", "chipSortOrder");
  if (typeof window.setupChipGroupingEvents === "function") {
    window.setupChipGroupingEvents();
  }
};

/**
 * Binds listeners for bulk sync modal control buttons (start / cancel / clear).
 * Renamed from bindNumistaBulkSyncListeners as part of STAK-443 — the button
 * IDs now live inside the #bulkSyncModal body but the binding logic is
 * unchanged.
 */
const bindBulkSyncModalListeners = () => {
  const nsStartBtn = getExistingElement("numistaSyncStartBtn");
  if (nsStartBtn) {
    nsStartBtn.addEventListener("click", () => {
      if (typeof startBulkSync === "function") startBulkSync();
    });
  }

  const nsCancelBtn = getExistingElement("numistaSyncCancelBtn");
  if (nsCancelBtn) {
    nsCancelBtn.addEventListener("click", () => {
      if (window.BulkImageCache) BulkImageCache.abort();
      nsCancelBtn.style.display = "none";
    });
  }

  const nsClearBtn = getExistingElement("numistaSyncClearBtn");
  if (nsClearBtn) {
    nsClearBtn.addEventListener("click", () => {
      if (typeof clearAllCachedData === "function") clearAllCachedData();
    });
  }
};

/**
 * Binds listeners for the settings modal shell (close button, background click).
 */
const bindSettingsModalShellListeners = () => {
  const closeBtn = getExistingElement("settingsCloseBtn");
  if (closeBtn) {
    closeBtn.addEventListener("click", hideSettingsModal);
  }

  const modal = getExistingElement("settingsModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) hideSettingsModal();
    });
  }

  // Provider priority dropdowns (STACK-90).
  setupProviderPriority();
};

/**
 * Binds listeners for Goldback pricing source switching, conditional inputs,
 * and history modal actions within the merged Currency tab.
 */
const bindGoldbackPricingSourceListener = () => {
  const sourceGroup = getExistingElement("settingsGoldbackSource");
  const gbModifierInput = getExistingElement("goldbackEstimateModifierInput");
  const manualRateInput = getExistingElement("goldbackManualRateInput");

  const applyManualRate = () => {
    if (goldbackPricingSource !== "manual") return;
    if (!manualRateInput || typeof GOLDBACK_DENOMINATIONS === "undefined") return;

    const displayRate = parseFloat(manualRateInput.value);
    if (isNaN(displayRate) || displayRate <= 0) return;

    const fxRate = typeof getExchangeRate === "function" ? getExchangeRate() : 1;
    const usdRate = fxRate !== 1 ? displayRate / fxRate : displayRate;
    const now = Date.now();

    GOLDBACK_DENOMINATIONS.forEach((denomination) => {
      const weight = Number(denomination.weight);
      const key = String(denomination.weight);
      const price = Math.round(usdRate * weight * 100) / 100;
      goldbackPrices[key] = { price, updatedAt: now, source: "manual" };
    });

    if (typeof saveGoldbackPrices === "function") saveGoldbackPrices();
    if (typeof recordGoldbackPrices === "function") recordGoldbackPrices();
    if (typeof recordAllItemPriceSnapshots === "function") recordAllItemPriceSnapshots();
    if (typeof syncGoldbackSettingsUI === "function") syncGoldbackSettingsUI();
    if (typeof renderTable === "function") renderTable();
  };

  const debouncedManualRateApply =
    typeof debounce === "function" ? debounce(applyManualRate, 300) : applyManualRate;

  if (sourceGroup) {
    sourceGroup.addEventListener("click", async (e) => {
      const btn = e.target.closest(".gb-source-btn");
      if (!btn) return;

      const nextSource = btn.dataset.val;
      if (nextSource !== "manual" && typeof debouncedManualRateApply.cancel === "function") {
        debouncedManualRateApply.cancel();
      }
      if (typeof saveGoldbackPricingSource === "function") {
        saveGoldbackPricingSource(nextSource);
      }

      try {
        if (nextSource === "api" && typeof fetchGoldbackApiPrices === "function") {
          const result = await fetchGoldbackApiPrices({ expectedSource: nextSource });
          if (goldbackPricingSource !== nextSource) return;
          if (!result.ok) console.warn("Goldback API fetch failed:", result.error);
        } else if (nextSource === "spot" && typeof onGoldSpotPriceChanged === "function") {
          onGoldSpotPriceChanged();
          if (goldbackPricingSource !== nextSource) return;
        }
      } catch (error) {
        console.warn("Goldback pricing source change failed:", error);
      }

      if (typeof syncGoldbackSettingsUI === "function") syncGoldbackSettingsUI();
      if (typeof renderTable === "function") renderTable();

      if (typeof renderRatioChips === "function") renderRatioChips();
    });
  }

  if (gbModifierInput) {
    gbModifierInput.addEventListener("change", () => {
      const val = parseFloat(gbModifierInput.value);
      if (isNaN(val) || val <= 0) {
        gbModifierInput.value = goldbackEstimateModifier.toFixed(2);
        return;
      }

      if (typeof saveGoldbackEstimateModifier === "function") saveGoldbackEstimateModifier(val);
      if (goldbackPricingSource === "spot" && typeof onGoldSpotPriceChanged === "function") {
        onGoldSpotPriceChanged();
      }
      if (typeof recordAllItemPriceSnapshots === "function") recordAllItemPriceSnapshots();
      if (typeof syncGoldbackSettingsUI === "function") syncGoldbackSettingsUI();
      if (typeof renderTable === "function") renderTable();
    });
  }

  if (manualRateInput) {
    manualRateInput.addEventListener("input", () => {
      if (goldbackPricingSource !== "manual") return;
      debouncedManualRateApply();
    });

    manualRateInput.addEventListener("change", () => {
      if (goldbackPricingSource !== "manual") return;
      if (typeof debouncedManualRateApply.flush === "function") {
        debouncedManualRateApply.flush();
      } else {
        applyManualRate();
      }
    });
  }

  const gbHistoryBtn = getExistingElement("goldbackHistoryBtn");
  if (gbHistoryBtn) {
    gbHistoryBtn.addEventListener("click", () => {
      if (typeof showGoldbackHistoryModal === "function") showGoldbackHistoryModal();
    });
  }

  const gbHistoryCloseBtn = getExistingElement("goldbackHistoryCloseBtn");
  if (gbHistoryCloseBtn) {
    gbHistoryCloseBtn.addEventListener("click", () => {
      if (typeof hideGoldbackHistoryModal === "function") hideGoldbackHistoryModal();
    });
  }

  const gbHistoryModal = getExistingElement("goldbackHistoryModal");
  if (gbHistoryModal) {
    gbHistoryModal.addEventListener("click", (e) => {
      if (e.target === gbHistoryModal) {
        if (typeof hideGoldbackHistoryModal === "function") hideGoldbackHistoryModal();
      }
    });
  }

  const gbExportBtn = getExistingElement("exportGoldbackHistoryBtn");
  if (gbExportBtn) {
    gbExportBtn.addEventListener("click", () => {
      if (typeof exportGoldbackHistory === "function") exportGoldbackHistory();
    });
  }
};

/**
 * Builds the regex source for a custom image pattern rule from raw user input.
 * Keyword mode splits on commas/semicolons and escapes each term into an
 * alternation; regex mode uses the input verbatim. Returns an error message
 * when the input is empty, has no usable keywords, or is an invalid RegExp.
 * @param {string} rawPattern - Trimmed user input from the pattern field.
 * @param {string} mode - Active pattern mode, "keywords" or "regex".
 * @returns {{ pattern: string }|{ error: string }}
 */
const _compilePatternRuleRegex = (rawPattern, mode) => {
  if (!rawPattern) return { error: "Pattern is required." };

  let pattern = rawPattern;
  if (mode === "keywords") {
    const terms = rawPattern
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (terms.length === 0) return { error: "Enter at least one keyword." };
    pattern = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  }

  try {
    new RegExp(pattern, "i");
  } catch (e) {
    return { error: "Invalid pattern: " + e.message };
  }
  return { pattern };
};

/**
 * Resolves the obverse/reverse file inputs of a pattern rule into processed
 * image blobs. Uses the global imageProcessor when present, otherwise passes
 * the raw File through. Returns an error message if processing throws.
 * @param {HTMLInputElement|null} obverseInput - Obverse image file input.
 * @param {HTMLInputElement|null} reverseInput - Reverse image file input.
 * @returns {Promise<{ obverseBlob: (Blob|null), reverseBlob: (Blob|null) }|{ error: string }>}
 */
const _processPatternRuleImages = async (obverseInput, reverseInput) => {
  const processor = typeof imageProcessor !== "undefined" ? imageProcessor : null;
  const toBlob = async (input) => {
    const file = input?.files?.[0];
    if (!file) return null;
    if (!processor) return file;
    const result = await processor.processFile(file);
    return result?.blob || null;
  };

  try {
    return {
      obverseBlob: await toBlob(obverseInput),
      reverseBlob: await toBlob(reverseInput),
    };
  } catch (err) {
    console.error("Image processing failed:", err);
    return { error: "Failed to process image: " + err.message };
  }
};

/**
 * Clears the pattern rule form inputs, filename labels, and previews, then
 * collapses the form back to the "+ New Rule" affordance. Called after a
 * successful rule add.
 * @returns {void}
 */
const _resetPatternRuleForm = () => {
  const setText = (id, text) => {
    const el = getExistingElement(id);
    if (el) el.textContent = text;
  };
  const setValue = (id, value) => {
    const el = getExistingElement(id);
    if (el) el.value = value;
  };
  const clearPreview = (id) => {
    const el = getExistingElement(id);
    if (el) {
      el.src = "";
      el.parentElement.style.display = "none";
    }
  };

  setValue("patternRulePattern", "");
  setValue("patternRuleObverse", "");
  setValue("patternRuleReverse", "");
  setText("patternRuleObverseName", "");
  setText("patternRuleReverseName", "");
  clearPreview("patternRuleObversePreview");
  clearPreview("patternRuleReversePreview");

  const formContainer = getExistingElement("patternRuleFormContainer");
  const toggleBtn = getExistingElement("newPatternRuleBtn");
  if (formContainer) formContainer.style.display = "none";
  if (toggleBtn) {
    toggleBtn.textContent = "+ New Rule";
    toggleBtn.classList.remove("img-btn-remove");
    toggleBtn.classList.add("img-btn-upload");
  }
};

/**
 * Binds listeners for pattern rule mode switching and creation.
 */
const bindPatternRuleModeListeners = () => {
  const patternModeKeywords = getExistingElement("patternModeKeywords");
  const patternModeRegex = getExistingElement("patternModeRegex");
  const patternInput = getExistingElement("patternRulePattern");
  const patternTip = getExistingElement("patternRuleTip");

  if (patternModeKeywords && patternModeRegex) {
    patternModeKeywords.addEventListener("click", () => {
      _patternMode = "keywords";
      patternModeKeywords.classList.add("active");
      patternModeRegex.classList.remove("active");
      if (patternInput) patternInput.placeholder = "e.g. morgan, peace, walking liberty";
      if (patternTip)
        patternTip.textContent =
          "Separate keywords with commas or semicolons. Matches item names containing any keyword.";
    });
    patternModeRegex.addEventListener("click", () => {
      _patternMode = "regex";
      patternModeRegex.classList.add("active");
      patternModeKeywords.classList.remove("active");
      if (patternInput) patternInput.placeholder = "e.g. \\bmorgan\\b|\\bpeace\\b";
      if (patternTip)
        patternTip.textContent =
          "Case-insensitive regex. Use \\b for word boundaries, | for OR, .* for wildcards.";
    });
  }

  if (patternInput && typeof attachAutocomplete === "function") {
    attachAutocomplete(patternInput, "names");
  }

  // Camera capture buttons — bridge capture input → main file input via DataTransfer
  [
    ["patternRuleObverseCamera", "patternRuleObverseCapture", "patternRuleObverse"],
    ["patternRuleReverseCamera", "patternRuleReverseCapture", "patternRuleReverse"],
  ].forEach(([btnId, captureId, mainId]) => {
    const btn = getExistingElement(btnId);
    const captureInput = getExistingElement(captureId);
    const mainInput = getExistingElement(mainId);
    if (btn && captureInput && mainInput) {
      btn.addEventListener("click", () => captureInput.click());
      captureInput.addEventListener("change", () => {
        if (!captureInput.files?.length) return;
        const dt = new DataTransfer();
        dt.items.add(captureInput.files[0]);
        mainInput.files = dt.files;
        mainInput.dispatchEvent(new Event("change"));
      });
    }
  });

  // Styled upload buttons — trigger hidden file inputs (STAK-439)
  [
    [
      "patternRuleObverseUploadBtn",
      "patternRuleObverse",
      "patternRuleObverseName",
      "patternRuleObversePreview",
    ],
    [
      "patternRuleReverseUploadBtn",
      "patternRuleReverse",
      "patternRuleReverseName",
      "patternRuleReversePreview",
    ],
  ].forEach(([btnId, inputId, nameId, previewId]) => {
    const btn = getExistingElement(btnId);
    const input = getExistingElement(inputId);
    const nameEl = getExistingElement(nameId);
    if (btn && input) {
      btn.addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        if (nameEl) nameEl.textContent = input.files?.[0]?.name || "";
        const previewEl = getExistingElement(previewId);
        if (previewEl && input.files?.[0]) {
          if (previewEl.src && previewEl.src.startsWith("blob:"))
            URL.revokeObjectURL(previewEl.src);
          previewEl.src = URL.createObjectURL(input.files[0]);
          previewEl.parentElement.style.display = "";
        } else if (previewEl) {
          previewEl.src = "";
          previewEl.parentElement.style.display = "none";
        }
      });
    }
  });

  // Swap obverse/reverse for pattern rule form (STAK-439)
  const patternSwapBtn = getExistingElement("patternRuleSwapBtn");
  if (patternSwapBtn) {
    patternSwapBtn.addEventListener("click", () => {
      const obvInput = getExistingElement("patternRuleObverse");
      const revInput = getExistingElement("patternRuleReverse");
      const obvNameEl = getExistingElement("patternRuleObverseName");
      const revNameEl = getExistingElement("patternRuleReverseName");
      const obvCapture = getExistingElement("patternRuleObverseCapture");
      const revCapture = getExistingElement("patternRuleReverseCapture");

      // Swap file inputs via DataTransfer
      if (obvInput && revInput) {
        const obvHasFile = obvInput.files && obvInput.files.length > 0;
        const revHasFile = revInput.files && revInput.files.length > 0;

        if (obvHasFile && revHasFile) {
          const dtObv = new DataTransfer();
          const dtRev = new DataTransfer();
          dtObv.items.add(obvInput.files[0]);
          dtRev.items.add(revInput.files[0]);
          obvInput.files = dtRev.files;
          revInput.files = dtObv.files;
        } else if (obvHasFile) {
          const dt = new DataTransfer();
          dt.items.add(obvInput.files[0]);
          revInput.files = dt.files;
          obvInput.value = "";
        } else if (revHasFile) {
          const dt = new DataTransfer();
          dt.items.add(revInput.files[0]);
          obvInput.files = dt.files;
          revInput.value = "";
        }
      }

      // Swap filename labels
      if (obvNameEl && revNameEl) {
        const tmpText = obvNameEl.textContent;
        obvNameEl.textContent = revNameEl.textContent;
        revNameEl.textContent = tmpText;
      }

      // Swap preview images
      const obvPreview = getExistingElement("patternRuleObversePreview");
      const revPreview = getExistingElement("patternRuleReversePreview");
      if (obvPreview && revPreview) {
        const tmpSrc = obvPreview.src;
        const tmpDisplay = obvPreview.parentElement.style.display;
        obvPreview.src = revPreview.src;
        obvPreview.parentElement.style.display = revPreview.parentElement.style.display;
        revPreview.src = tmpSrc;
        revPreview.parentElement.style.display = tmpDisplay;
      }

      // Swap camera capture inputs via DataTransfer
      if (obvCapture && revCapture) {
        const obvCapHasFile = obvCapture.files && obvCapture.files.length > 0;
        const revCapHasFile = revCapture.files && revCapture.files.length > 0;

        if (obvCapHasFile && revCapHasFile) {
          const dtObv = new DataTransfer();
          const dtRev = new DataTransfer();
          dtObv.items.add(obvCapture.files[0]);
          dtRev.items.add(revCapture.files[0]);
          obvCapture.files = dtRev.files;
          revCapture.files = dtObv.files;
        } else if (obvCapHasFile) {
          const dt = new DataTransfer();
          dt.items.add(obvCapture.files[0]);
          revCapture.files = dt.files;
          obvCapture.value = "";
        } else if (revCapHasFile) {
          const dt = new DataTransfer();
          dt.items.add(revCapture.files[0]);
          obvCapture.files = dt.files;
          revCapture.value = "";
        }
      }
    });
  }

  const addPatternRuleBtn = getExistingElement("addPatternRuleBtn");
  if (addPatternRuleBtn) {
    addPatternRuleBtn.addEventListener("click", async () => {
      const obverseInput = getExistingElement("patternRuleObverse");
      const reverseInput = getExistingElement("patternRuleReverse");

      const rawPattern = patternInput?.value?.trim();
      const replacement = rawPattern || "";

      const compiled = _compilePatternRuleRegex(rawPattern, _patternMode);
      if (compiled.error) {
        appAlert(compiled.error);
        return;
      }
      const { pattern } = compiled;

      if (!obverseInput?.files?.[0] && !reverseInput?.files?.[0]) {
        appAlert("Please select at least one image (obverse or reverse).");
        return;
      }

      const images = await _processPatternRuleImages(obverseInput, reverseInput);
      if (images.error) {
        appAlert(images.error);
        return;
      }

      const ruleId = "custom-img-" + Date.now();
      const addResult = NumistaLookup.addRule(pattern, replacement, null, ruleId);
      if (!addResult.success) {
        appAlert(addResult.error || "Failed to add rule.");
        return;
      }

      if ((images.obverseBlob || images.reverseBlob) && window.imageCache?.isAvailable()) {
        await imageCache.cachePatternImage(ruleId, images.obverseBlob, images.reverseBlob);
      }

      // Auto-collapse + reset form after successful add (STAK-439)
      _resetPatternRuleForm();
      renderCustomPatternRules();
      renderImageStorageStats();
    });
  }

  // Collapse/expand toggle for pattern rule form (STAK-439)
  const newRuleBtn = getExistingElement("newPatternRuleBtn");
  const formContainer = getExistingElement("patternRuleFormContainer");
  if (newRuleBtn && formContainer) {
    newRuleBtn.addEventListener("click", () => {
      const isOpen = formContainer.style.display !== "none";
      formContainer.style.display = isOpen ? "none" : "";
      newRuleBtn.textContent = isOpen ? "+ New Rule" : "✕ Cancel";
      if (isOpen) {
        newRuleBtn.classList.remove("img-btn-remove");
        newRuleBtn.classList.add("img-btn-upload");
      } else {
        newRuleBtn.classList.remove("img-btn-upload");
        newRuleBtn.classList.add("img-btn-remove");
      }
    });
  }
};

/**
 * Binds listeners for card style and table image toggles.
 */
const bindCardAndTableImageListeners = () => {
  // Card style toggle (A/B/C/D chip buttons in Appearance > Inventory)
  const cardStyleToggleEl = getExistingElement("settingsCardStyleToggle");
  if (cardStyleToggleEl) {
    const savedStyle = localStorage.getItem(CARD_STYLE_KEY) || "D";
    cardStyleToggleEl.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.style === savedStyle);
    });
    cardStyleToggleEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-style]");
      if (!btn) return;
      const val = btn.dataset.style;
      localStorage.setItem(CARD_STYLE_KEY, val);
      cardStyleToggleEl
        .querySelectorAll(".chip-sort-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      // Sync live sort bar toggle
      const liveSortToggle = document.getElementById("cardStyleToggle");
      if (liveSortToggle) {
        liveSortToggle
          .querySelectorAll("[data-style]")
          .forEach((b) => b.classList.toggle("active", b.dataset.style === val));
      }
      if (typeof renderTable === "function") renderTable();
    });
  }

  // Default sort column
  const defaultSortColEl = getExistingElement("settingsDefaultSortColumn");
  if (defaultSortColEl) {
    const savedCol = localStorage.getItem(DEFAULT_SORT_COL_KEY);
    if (savedCol !== null) defaultSortColEl.value = savedCol;
    defaultSortColEl.addEventListener("change", () => {
      const val = parseInt(defaultSortColEl.value, 10);
      localStorage.setItem(DEFAULT_SORT_COL_KEY, String(val));
      sortColumn = val;
      if (val === SORT_COL_LAST_MODIFIED && sortDirection === "asc") {
        applyDefaultSortDir("desc");
      }
      if (typeof updateCardSortBar === "function") updateCardSortBar();
      if (typeof renderTable === "function") renderTable();
    });
  }

  // Default sort direction
  function applyDefaultSortDir(dir) {
    const btn = getExistingElement("settingsDefaultSortDir");
    if (btn) {
      btn.dataset.dir = dir;
      btn.setAttribute(
        "aria-label",
        dir === "asc" ? "Sort ascending — click to reverse" : "Sort descending — click to reverse"
      );
    }
    localStorage.setItem(DEFAULT_SORT_DIR_KEY, dir);
    sortDirection = dir;
  }

  const defaultSortDirEl = getExistingElement("settingsDefaultSortDir");
  if (defaultSortDirEl) {
    const savedDir = localStorage.getItem(DEFAULT_SORT_DIR_KEY) || "asc";
    applyDefaultSortDir(savedDir);
    defaultSortDirEl.addEventListener("click", () => {
      const newDir = defaultSortDirEl.dataset.dir === "asc" ? "desc" : "asc";
      applyDefaultSortDir(newDir);
      if (typeof updateCardSortBar === "function") updateCardSortBar();
      if (typeof renderTable === "function") renderTable();
    });
  }

  wireStorageToggle("settingsDesktopCardView", DESKTOP_CARD_VIEW_KEY, {
    defaultVal: false,
    onApply: (isEnabled) => {
      document.body.classList.toggle("force-card-view", isEnabled);
      if (typeof renderTable === "function") renderTable();
    },
  });

  wireStorageToggle("tableImagesToggle", "tableImagesEnabled", {
    defaultVal: true,
    onApply: () => {
      if (typeof renderTable === "function") renderTable();
    },
  });

  const sidesEl = getExistingElement("tableImageSidesToggle");
  if (sidesEl) {
    const curSides = localStorage.getItem("tableImageSides") || "both";
    sidesEl.querySelectorAll(".chip-sort-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.val === curSides);
    });
    sidesEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".chip-sort-btn");
      if (!btn) return;
      localStorage.setItem("tableImageSides", btn.dataset.val);
      sidesEl
        .querySelectorAll(".chip-sort-btn")
        .forEach((b) => b.classList.toggle("active", b === btn));
      if (typeof renderTable === "function") renderTable();
    });
  }
};

/**
 * Aggregates all image-related settings listeners.
 */
const bindImageSettingsListeners = () => {
  bindPatternRuleModeListeners();
  bindCardAndTableImageListeners();
};

/**
 * Render the backup list for a cloud provider.
 */
const renderCloudBackupList = (provider, backups) => {
  const listEl = safeGetElement("cloudBackupList_" + provider);
  if (!(listEl instanceof HTMLElement)) return;

  listEl.style.display = "";

  // Single flat list — manual + sync merged, sorted newest first
  var html = "";
  if (!backups || backups.length === 0) {
    html += '<div class="cloud-backup-empty">No backups found</div>';
  } else {
    html += backups
      .map(function (b) {
        var d = new Date(b.server_modified);
        var dateStr =
          d.toLocaleDateString([], { month: "short", day: "numeric" }) +
          " " +
          d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        var sizeStr =
          b.size < 1024
            ? b.size + " B"
            : b.size < 1048576
              ? (b.size / 1024).toFixed(0) + " KB"
              : (b.size / 1048576).toFixed(1) + " MB";
        var isManual = b.name.indexOf(MANUAL_BACKUP_PREFIX) === 0;
        var typeLabel = isManual ? "Manual" : "Sync";
        var safeProvider = sanitizeHtml(provider);
        var safeFilename = sanitizeHtml(b.name);
        return (
          '<div class="cloud-backup-row">' +
          '<button class="cloud-backup-entry" data-provider="' +
          safeProvider +
          '" data-filename="' +
          safeFilename +
          '" data-size="' +
          b.size +
          '">' +
          '<span class="cloud-backup-type" style="min-width:3rem">' +
          typeLabel +
          "</span>" +
          '<span class="cloud-backup-name" title="' +
          safeFilename +
          '">' +
          sanitizeHtml(dateStr) +
          "</span>" +
          '<span class="cloud-backup-size">' +
          sanitizeHtml(sizeStr) +
          "</span>" +
          "</button>" +
          '<button class="cloud-backup-delete-btn" data-provider="' +
          safeProvider +
          '" data-filename="' +
          safeFilename +
          '" title="Delete this backup from cloud storage" aria-label="Delete ' +
          safeFilename +
          '">' +
          "&times;" +
          "</button>" +
          "</div>"
        );
      })
      .join("");
  }

  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  listEl.innerHTML = html;
};

/**
 * Wires cloud storage connect/disconnect/backup/restore buttons.
 */
const bindCloudCacheListeners = () => {
  // Session-only password cache — no toggle needed, auto-caches on first use
  // Idle timeout select removed with cloud-session-cache fieldset redesign
};

/**
 * Run an async action while showing a loading state on a button.
 * Saves innerHTML, disables the button, runs the action, then restores.
 * @param {HTMLElement} btn
 * @param {string} label - loading text to show (e.g. 'Uploading…')
 * @param {Function} action - async function to execute
 * @param {string} errorPrefix - prefix for alert on failure
 * @param {Function} [finallyFn] - optional cleanup in finally block
 */
const _cloudBtnAction = async (btn, label, action, errorPrefix, finallyFn) => {
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
  try {
    await action(btn);
  } catch (err) {
    appAlert(errorPrefix + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
    if (finallyFn) {
      try {
        await finallyFn();
      } catch (_) {
        /* ignore */
      }
    }
  }
};

/**
 * Perform a cached-password cloud backup (encrypt + upload, no vault modal).
 */
const _cloudBackupWithCachedPw = (provider, password, btn) =>
  _cloudBtnAction(
    btn,
    "Encrypting\u2026",
    async (b) => {
      var fileBytes = await vaultEncryptToBytes(password);
      b.textContent = "Uploading\u2026";
      await cloudUploadVault(provider, fileBytes);
      if (typeof showCloudToast === "function") showCloudToast("Backup complete.");
      if (typeof showKrakenToastIfFirst === "function") showKrakenToastIfFirst();
    },
    "Backup failed: "
  );

/**
 * Perform a cached-password cloud restore (decrypt + restore, no vault modal).
 */
const _cloudRestoreWithCachedPw = async (provider, password, fileBytes) => {
  try {
    if (typeof vaultRestoreWithPreview === "function") {
      await vaultRestoreWithPreview(fileBytes, password);
      // DiffModal now showing (or fallback applied if unavailable)
    } else {
      await vaultDecryptAndRestore(fileBytes, password);
      if (typeof showCloudToast === "function") showCloudToast("Restore complete. Reloading\u2026");
      setTimeout(function () {
        location.reload();
      }, 1200);
    }
  } catch (err) {
    appAlert("Decryption failed. Opening password prompt.");
    openVaultModal("cloud-import", {
      provider: provider,
      fileBytes: fileBytes,
    });
  }
};

/**
 * Fetches the backup count for a cloud provider and updates the badge element.
 * Fire-and-forget — errors are silently caught and the badge shows a dash.
 *
 * @param {string} provider - Cloud provider key (e.g. 'dropbox')
 */
const cloudUpdateBackupCount = async (provider) => {
  const el = safeGetElement("cloudBackupCount_" + provider);
  if (!(el instanceof HTMLElement)) return;
  try {
    const backups = await cloudListBackups(provider);
    const count = Array.isArray(backups) ? backups.length : 0;
    el.textContent = count + " backup" + (count !== 1 ? "s" : "");
  } catch {
    el.textContent = "\u2014";
  }
};

const bindCloudStorageListeners = () => {
  var panel =
    document.getElementById("inventoryCloudSection") ||
    document.getElementById("settingsPanel_cloud");
  if (!panel) return;

  // Backup history depth selector
  var historySelect = safeGetElement("cloudBackupHistoryDepth");
  if (historySelect) {
    historySelect.addEventListener("change", function () {
      saveData(CLOUD_BACKUP_HISTORY_KEY, historySelect.value);
    });
  }

  bindCloudCacheListeners();

  var _cloudBtnHandler = async function (e) {
    var btn = e.target.closest("button");
    if (!btn) return;
    var provider = btn.dataset.provider;
    if (!provider) return;

    if (btn.classList.contains("cloud-connect-btn")) {
      if (typeof cloudAuthStart === "function") cloudAuthStart(provider);
    } else if (btn.classList.contains("cloud-disconnect-btn")) {
      if (typeof cloudDisconnect === "function") cloudDisconnect(provider);
    } else if (btn.classList.contains("cloud-switch-account-btn")) {
      if (typeof cloudDisconnect === "function") cloudDisconnect(provider);
      if (typeof cloudAuthStart === "function") cloudAuthStart(provider, { forceReauth: true });
    } else if (btn.classList.contains("cloud-backup-btn")) {
      await _cloudBtnAction(
        btn,
        "Checking\u2026",
        async () => {
          var conflict = await cloudCheckConflict(provider);
          if (conflict.conflict) {
            var remoteDate = new Date(conflict.remote.timestamp);
            var remoteItems = Number(conflict.remote.itemCount) || 0;
            var localItems = (conflict.local && Number(conflict.local.itemCount)) || 0;
            var remoteInfo =
              remoteDate.toLocaleDateString() +
              " " +
              remoteDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            var localInfo = localItems.toLocaleString() + " items";
            var remoteLine =
              "Remote: " + remoteItems.toLocaleString() + " items (" + remoteInfo + ")";
            var localLine = "Local: " + localInfo;
            const conflictMsg =
              conflict.reason === "remote_newer"
                ? "A more recent remote backup exists."
                : "An existing remote backup was found.";
            const shouldOverwrite = await appConfirm(
              conflictMsg +
                "\n\n" +
                remoteLine +
                "\n" +
                localLine +
                "\n\n" +
                "Do you want to overwrite the remote backup with current local data?",
              "Cloud Backup Conflict"
            );
            if (!shouldOverwrite) {
              return;
            }
          }
          openVaultModal("cloud-export", { provider: provider, isManualBackup: true });
        },
        "Conflict check failed: "
      );
    } else if (btn.classList.contains("cloud-restore-btn")) {
      var listEl = document.getElementById("cloudBackupList_" + provider);
      if (listEl && listEl.style.display !== "none" && listEl.innerHTML) {
        listEl.style.display = "none";
        listEl.innerHTML = "";
        return;
      }
      await _cloudBtnAction(
        btn,
        "Loading\u2026",
        async () => {
          var backups = await cloudListBackups(provider);
          renderCloudBackupList(provider, backups);
        },
        "Failed to list backups: "
      );
    } else if (btn.classList.contains("cloud-backup-entry")) {
      var filename = btn.dataset.filename;
      var size = parseInt(btn.dataset.size, 10) || 0;
      var sizeStr =
        size < 1024
          ? size + " B"
          : size < 1048576
            ? (size / 1024).toFixed(0) + " KB"
            : (size / 1048576).toFixed(1) + " MB";
      const restoreConfirmed = await appConfirm(
        `Restore "${filename}" (${sizeStr})?\n\nThis will overwrite all local data.`,
        "Cloud Restore"
      );
      if (!restoreConfirmed) return;
      await _cloudBtnAction(
        btn,
        "Downloading\u2026",
        async () => {
          var fileBytes = await cloudDownloadVaultByName(provider, filename);
          var savedPw =
            typeof cloudGetCachedPassword === "function" ? cloudGetCachedPassword(provider) : null;
          if (savedPw) {
            await _cloudRestoreWithCachedPw(provider, savedPw, fileBytes);
            return;
          }
          openVaultModal("cloud-import", {
            provider: provider,
            fileBytes: fileBytes,
            filename: filename,
            size: size,
          });
        },
        "Download failed: ",
        async () => {
          var parentList = btn.closest(".cloud-backup-list");
          if (parentList) {
            var refreshed = await cloudListBackups(provider);
            renderCloudBackupList(provider, refreshed);
          }
        }
      );
    } else if (btn.classList.contains("cloud-backup-delete-btn")) {
      var delFilename = btn.dataset.filename;
      if (
        !(await showBulkConfirm(
          'Delete "' + delFilename + '" from cloud storage?\n\nThis cannot be undone.'
        ))
      )
        return;
      await _cloudBtnAction(
        btn,
        "\u2026",
        async () => {
          await cloudDeleteBackup(provider, delFilename);
          if (typeof showCloudToast === "function")
            showCloudToast('"' + delFilename + '" deleted.');
        },
        "Delete failed: ",
        async () => {
          var parentList = btn.closest(".cloud-backup-list");
          if (parentList) {
            var refreshed = await cloudListBackups(provider);
            renderCloudBackupList(provider, refreshed);
          }
        }
      );
    }
  };

  panel.addEventListener("click", _cloudBtnHandler);

  // Advanced modal is rendered at body level (outside settingsPanel_cloud), so it needs its own listener.
  var advancedModal = document.getElementById("cloudSyncAdvancedModal");
  if (advancedModal) advancedModal.addEventListener("click", _cloudBtnHandler);

  // Sync attachments toggle (STRK-45) — persists to syncAttachments localStorage key.
  // Default is true when the key is absent (opt-out model).
  var syncAttachToggle = document.getElementById("syncAttachmentsToggle");
  if (syncAttachToggle) {
    var storedVal = loadDataSync("syncAttachments", null);
    syncAttachToggle.checked = storedVal !== "false" && storedVal !== false;
    syncAttachToggle.addEventListener("change", function () {
      saveDataSync("syncAttachments", this.checked);
    });
  }
};

/**
 * Wires up Market Prices section listeners.
 * Handles coin selector change and timeframe button clicks.
 */
const bindRetailMarketListeners = () => {
  // Sync Now button
  const syncBtn = getExistingElement("retailSyncBtn");
  if (syncBtn) {
    syncBtn.addEventListener("click", () => {
      if (typeof syncRetailPrices === "function") syncRetailPrices();
    });
  }

  // History coin selector — re-render table when selection changes
  const slugSelect = getExistingElement("retailHistorySlugSelect");
  if (slugSelect) {
    slugSelect.addEventListener("change", () => {
      if (typeof renderRetailHistoryTable === "function") renderRetailHistoryTable();
    });
  }

  // Timeframe buttons — delegated on the logPanel_market container
  const logPanelMarket = getExistingElement("logPanel_market");
  if (logPanelMarket) {
    logPanelMarket.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-retail-timeframe]");
      if (!btn) return;
      logPanelMarket.querySelectorAll("[data-retail-timeframe]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      if (typeof renderRetailHistoryTable === "function") renderRetailHistoryTable();
    });
  }
};

/**
 * Wires up Storage section listeners (Refresh button, tiny-key toggle).
 */
const bindStorageListeners = () => {
  // Refresh button
  const refreshBtn = document.getElementById("storageRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      if (typeof renderStorageSection === "function") renderStorageSection();
    });
  }

  // Top-level tiny-key toggle
  const topToggle = document.getElementById("storageToggleTiny");
  if (topToggle) {
    topToggle.addEventListener("click", () => {
      if (typeof _handleStorageTinyToggle === "function") _handleStorageTinyToggle();
    });
  }
};

/**
 * Binds clear buttons for Numista and PCGS response caches (STAK-222).
 */
const bindApiCacheListeners = () => {
  const clearNumistaBtn = safeGetElement("clearNumistaCacheBtn");
  if (clearNumistaBtn) {
    clearNumistaBtn.addEventListener("click", async () => {
      const count = typeof clearNumistaCache === "function" ? clearNumistaCache() : 0;
      // Also clear IndexedDB sync metadata so next sync re-fetches rather than skipping
      // (bulk sync skip check uses imageCache.getMetadata(), not the localStorage response cache)
      if (window.imageCache && window.BulkImageCache) {
        const eligible = BulkImageCache.buildEligibleList();
        await Promise.all(eligible.map(({ catalogId }) => imageCache.deleteMetadata(catalogId)));
      }
      if (typeof appAlert === "function") appAlert(`Cleared ${count} Numista cached lookups.`);
      if (typeof renderNumistaSyncUI === "function") renderNumistaSyncUI();
    });
  }

  const clearPcgsBtn = safeGetElement("clearPcgsCacheBtn");
  if (clearPcgsBtn) {
    clearPcgsBtn.addEventListener("click", () => {
      const count = typeof clearPcgsCache === "function" ? clearPcgsCache() : 0;
      if (typeof appAlert === "function") appAlert(`Cleared ${count} PCGS cached lookups.`);
      const countEl = safeGetElement("pcgsResponseCacheCount");
      if (countEl) countEl.textContent = "0";
    });
  }
};

/**
 * Wires up Market Filter Matrix listeners (STAK-515).
 * Delegated change handler on the matrix table + metal pill filtering.
 */
const bindMarketFilterListeners = () => {
  const table = safeGetElement("marketFilterMatrix");
  if (table) {
    table.addEventListener("change", (e) => {
      const cb = e.target;
      if (cb.type !== "checkbox" || cb.disabled) return;

      const slug = cb.getAttribute("data-slug");
      const vendor = cb.getAttribute("data-vendor");
      const rowToggle = cb.getAttribute("data-row-toggle");
      const colToggle = cb.getAttribute("data-col-toggle");

      const filter = typeof _loadMarketFilter === "function" ? _loadMarketFilter() : {};
      const allSlugs = typeof getActiveRetailSlugs === "function" ? getActiveRetailSlugs() : [];
      const vendorSource =
        typeof _manifestVendorMeta !== "undefined" && _manifestVendorMeta
          ? _manifestVendorMeta
          : typeof RETAIL_VENDOR_NAMES !== "undefined"
            ? RETAIL_VENDOR_NAMES
            : {};
      const vendorIds = Object.keys(vendorSource);

      // Determine active metal pill — scope column/master toggles to visible rows only
      const activePill = document.querySelector(
        "#marketFilterMetalPills .market-filter-pill.active"
      );
      const activeMetal = activePill ? activePill.getAttribute("data-metal") : "all";
      const slugs =
        activeMetal === "all"
          ? allSlugs
          : allSlugs.filter((s) => {
              const m =
                typeof getRetailCoinMeta === "function"
                  ? getRetailCoinMeta(s)
                  : { metal: "unknown" };
              return (m.metal || "").toLowerCase() === activeMetal;
            });

      // Helper: get effective vendor list for a slug (all vendors if no price data yet)
      const _effectiveVendors = (s) => {
        const available =
          typeof _getAvailableVendorsForSlug === "function" ? _getAvailableVendorsForSlug(s) : [];
        return available.length > 0 ? available : vendorIds;
      };

      if (slug && vendor) {
        // Individual cell toggle
        if (!filter[slug]) filter[slug] = {};
        if (cb.checked) {
          delete filter[slug][vendor];
          if (Object.keys(filter[slug]).length === 0) delete filter[slug];
        } else {
          filter[slug][vendor] = false;
        }
      } else if (rowToggle) {
        // Row toggle — set all vendors for this slug
        const effective = _effectiveVendors(rowToggle);
        if (!cb.checked) {
          if (!filter[rowToggle]) filter[rowToggle] = {};
          effective.forEach((vid) => {
            filter[rowToggle][vid] = false;
          });
        } else {
          delete filter[rowToggle];
        }
      } else if (colToggle) {
        // Column toggle — set this vendor for all slugs
        slugs.forEach((s) => {
          const effective = _effectiveVendors(s);
          if (effective.indexOf(colToggle) === -1) return;
          if (!cb.checked) {
            if (!filter[s]) filter[s] = {};
            filter[s][colToggle] = false;
          } else {
            if (filter[s]) {
              delete filter[s][colToggle];
              if (Object.keys(filter[s]).length === 0) delete filter[s];
            }
          }
        });
      } else if (cb.classList.contains("mfm-master-toggle")) {
        // Master toggle — toggle everything
        slugs.forEach((s) => {
          const effective = _effectiveVendors(s);
          if (!cb.checked) {
            if (!filter[s]) filter[s] = {};
            effective.forEach((vid) => {
              filter[s][vid] = false;
            });
          } else {
            delete filter[s];
          }
        });
      }

      if (typeof _saveMarketFilter === "function") _saveMarketFilter(filter);
      if (typeof _invalidateMarketFilterCache === "function") _invalidateMarketFilterCache();
      if (typeof renderMarketFilterMatrix === "function") renderMarketFilterMatrix();
      if (typeof renderBestPriceTicker === "function") renderBestPriceTicker();
      if (typeof renderVendorPrices === "function") renderVendorPrices();
    });
  }

  // Metal pill filtering
  const pillContainer = safeGetElement("marketFilterMetalPills");
  if (pillContainer) {
    pillContainer.addEventListener("click", (e) => {
      const pill = e.target.closest("[data-metal]");
      if (!pill) return;

      const metal = pill.getAttribute("data-metal");

      // Update active pill
      pillContainer.querySelectorAll("[data-metal]").forEach((p) => {
        const isActive = p === pill;
        p.classList.toggle("active", isActive);
        p.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      // Re-render matrix with pill-scoped toggle states
      if (typeof renderMarketFilterMatrix === "function") {
        renderMarketFilterMatrix();
        return;
      }

      // Fallback: manual row filtering if render not available
      const tbody = safeGetElement("marketFilterMatrixBody");
      if (!tbody) return;

      const rows = tbody.querySelectorAll("tr");
      let visibleCount = 0;
      rows.forEach((row) => {
        if (row.classList.contains("mfm-all-row")) {
          row.style.display = "";
          return;
        }
        const rowMetal = row.getAttribute("data-metal");
        if (metal === "all" || rowMetal === metal) {
          row.style.display = "";
          visibleCount++;
        } else {
          row.style.display = "none";
        }
      });

      // Update status line with filtered count
      const statusEl = safeGetElement("marketFilterStatus");
      if (statusEl && metal !== "all") {
        const current = statusEl.textContent;
        const match = current.match(/·(.+)$/);
        const vendorPart = match ? " \u00b7" + match[1] : "";
        statusEl.textContent = "Showing " + visibleCount + " products" + vendorPart;
      } else if (statusEl && typeof renderMarketFilterMatrix === "function") {
        // Re-render to get accurate global count
        renderMarketFilterMatrix();
        // Re-apply pill active state after re-render
        if (pillContainer) {
          pillContainer.querySelectorAll("[data-metal]").forEach((p) => {
            p.classList.toggle("active", p.getAttribute("data-metal") === metal);
            p.setAttribute(
              "aria-pressed",
              p.getAttribute("data-metal") === metal ? "true" : "false"
            );
          });
        }
      }
    });
  }
};

// ---------------------------------------------------------------------------
// STAK-443 — Spot/Catalog/Bulk Sync event wiring (Task 11)
// ---------------------------------------------------------------------------

const SPOT_PROVIDER_CONFIRM_LABELS = {
  STAKTRAKR: "StakTrakr",
  METALS_DEV: "Metals.dev",
  METALS_API: "Metals-API",
  METAL_PRICE_API: "MetalPriceAPI",
  GOLD_API: "Gold API",
  CUSTOM: "Custom",
  MANUAL: "Manual",
};

const getSpotProviderConfirmLabel = (value) =>
  SPOT_PROVIDER_CONFIRM_LABELS[value] || value || "the selected provider";

const getActiveSpotProviderValue = (host) => {
  const activePill = host.querySelector(".gb-source-btn.active[data-val]");
  if (activePill?.dataset?.val) return activePill.dataset.val;
  if (typeof loadDataSync === "function") {
    const stored = loadDataSync(SPOT_PRICING_SOURCE_KEY, "STAKTRAKR");
    if (typeof stored === "string" && stored) return stored;
  }
  return "STAKTRAKR";
};

const confirmSpotProviderSwitch = async (value) => {
  if (typeof window.appConfirm !== "function") return false;
  const label = getSpotProviderConfirmLabel(value);
  return window.appConfirm(
    `Switch to ${label} as the spot price provider?\n\n` +
      "This changes the spot prices used by charts, ticker, and portfolio values throughout StakTrakr.",
    "Switch Spot Provider"
  );
};

/**
 * Delegated click handler on `#apiSection_spot` for `.gb-source-btn[data-val]`
 * pill clicks. Switching to a different spot provider first asks for
 * confirmation; confirmed switches call `window.switchSpotProvider`, which
 * persists the selection and updates UI. Uses event delegation so re-renders
 * don't break the binding. REQ-3, STAK-571.
 */
const wireSpotPillRadio = () => {
  const host = safeGetElement("apiSection_spot");
  if (!host || host.__stakSpotPillBound) return;
  host.__stakSpotPillBound = true;
  host.addEventListener("click", async (e) => {
    const pill = e.target.closest(".gb-source-btn[data-val]");
    if (!pill || !host.contains(pill)) return;
    const value = pill.dataset.val;
    const current = getActiveSpotProviderValue(host);
    if (value === current || host.__stakSpotConfirmPending) return;

    host.__stakSpotConfirmPending = true;
    let confirmed = false;
    try {
      confirmed = await confirmSpotProviderSwitch(value);
    } finally {
      host.__stakSpotConfirmPending = false;
    }

    if (!confirmed) return;
    if (typeof window.switchSpotProvider === "function") {
      window.switchSpotProvider(value);
    }
  });
};

/**
 * Delegated click handler on `#apiSection_spot` for action buttons inside
 * `.spot-accordion-panel` elements. Dispatches by button class:
 *   - `.js-toggle-password` flips the sibling input between password/text.
 *   - `.js-save` persists the API key from the panel's input (or the 4
 *     numeric inputs for the Manual panel).
 *   - `.js-save-test` saves then calls `window.syncSpotProvider()`.
 *   - `.js-history` opens `window.showApiHistoryModal()` when available.
 *   - `.js-clear-key` clears the stored API key for the panel's provider.
 *   - `.js-pull-history` triggers history fetch (delegates to syncSpotProvider).
 *   - `.js-reset` (Manual panel) clears the 4 numeric inputs + per-metal keys.
 * Never logs the key value itself. REQ-4.6, REQ-5.
 */
const wireSpotProviderActions = () => {
  const host = safeGetElement("apiSection_spot");
  if (!host || host.__stakSpotActionsBound) return;
  host.__stakSpotActionsBound = true;

  host.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const panel = btn.closest(".spot-accordion-panel");
    if (!panel) return;
    const provider = panel.dataset.val;

    if (btn.classList.contains("js-toggle-password")) {
      const input = panel.querySelector(".js-api-key-input");
      if (!input) return;
      const isHidden = input.type === "password";
      input.type = isHidden ? "text" : "password";
      const showing = input.type === "text";
      btn.setAttribute("aria-label", showing ? "Hide API key" : "Show API key");
      const textNode = Array.from(btn.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = showing ? " Hide" : " Show";
      return;
    }

    if (btn.classList.contains("js-save") || btn.classList.contains("js-save-test")) {
      if (provider === "MANUAL") {
        const inputs = panel.querySelectorAll("input.js-manual-spot[data-metal]");
        const prices = {};
        inputs.forEach((input) => {
          if (!input.value.trim()) return;
          const parsed = parseFloat(input.value);
          const metal = input.dataset.metal;
          if (!metal) return;
          if (Number.isFinite(parsed)) prices[metal] = parsed;
        });
        saveDataSync("metalSpotPrices", prices);
        // Mirror to per-metal keys consumed by spot.js readers.
        const perMetalMap = {
          gold: "spotGold",
          silver: "spotSilver",
          platinum: "spotPlatinum",
          palladium: "spotPalladium",
        };
        Object.entries(perMetalMap).forEach(([metal, key]) => {
          if (Object.prototype.hasOwnProperty.call(prices, metal)) {
            try {
              localStorage.setItem(key, String(prices[metal]));
            } catch (_err) {
              /* quota errors surfaced elsewhere */
            }
          } else {
            // Metal cleared by user — remove stale per-metal key so spot readers
            // don't serve the previous value (STAK-443 CodeRabbit finding).
            try {
              localStorage.removeItem(key);
            } catch (_err) {
              /* ignore storage errors */
            }
          }
        });
      } else {
        const keyInput = panel.querySelector(".js-api-key-input");
        if (
          keyInput &&
          typeof loadApiConfig === "function" &&
          typeof saveApiConfig === "function"
        ) {
          try {
            const cfg = loadApiConfig();
            cfg.keys = cfg.keys || {};
            cfg.keys[provider] = (keyInput.value || "").trim();
            saveApiConfig(cfg);
          } catch (_err) {
            debugLog("Failed to save spot provider key (value redacted)");
          }
        }
      }
      if (btn.classList.contains("js-save-test")) {
        if (typeof window.syncSpotProvider === "function") {
          try {
            window.syncSpotProvider({ showProgress: true, forceSync: true });
          } catch (_err) {
            debugLog("syncSpotProvider threw (value redacted)");
          }
        }
      }
      return;
    }

    if (btn.classList.contains("js-history")) {
      if (typeof window.showApiHistoryModal === "function") {
        try {
          window.showApiHistoryModal(provider);
        } catch (_err) {
          debugLog("showApiHistoryModal threw (value redacted)");
        }
      }
      return;
    }

    if (btn.classList.contains("js-pull-history")) {
      // Pull triggers a forced history fetch for the active provider, mirroring
      // the syncSpotProvider path used by js-save-test (STAK-443 CodeRabbit fix).
      if (typeof window.syncSpotProvider === "function") {
        try {
          window.syncSpotProvider({ showProgress: true, forceSync: true });
        } catch (_err) {
          debugLog("syncSpotProvider (js-pull-history) threw (value redacted)");
        }
      }
      return;
    }

    if (btn.classList.contains("js-flush-cache")) {
      if (typeof window.syncSpotProvider === "function") {
        try {
          window.syncSpotProvider({ showProgress: true, forceSync: true });
        } catch (_err) {
          debugLog("syncSpotProvider (flush-cache) threw (value redacted)");
        }
      }
      return;
    }

    if (btn.classList.contains("js-clear-key")) {
      if (typeof loadApiConfig === "function" && typeof saveApiConfig === "function") {
        try {
          const cfg = loadApiConfig();
          cfg.keys = cfg.keys || {};
          cfg.keys[provider] = "";
          saveApiConfig(cfg);
        } catch (_err) {
          debugLog("Failed to clear spot provider key (value redacted)");
        }
      }
      const keyInput = panel.querySelector(".js-api-key-input");
      if (keyInput) keyInput.value = "";
      return;
    }

    if (btn.classList.contains("js-reset") && provider === "MANUAL") {
      panel.querySelectorAll("input.js-manual-spot").forEach((input) => {
        input.value = "";
      });
      saveDataSync("metalSpotPrices", {});
      ["spotGold", "spotSilver", "spotPlatinum", "spotPalladium"].forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch (_err) {
          /* ignore */
        }
      });
      return;
    }
  });
};

/**
 * Delegated click handler on `#apiSection_catalog` for `.catalog-expand-btn` /
 * `.js-catalog-configure` clicks. Toggles the sibling `.catalog-row-expand`
 * display, flips `aria-expanded`, and toggles the row's `.open` class so the
 * chevron rotates. REQ-6.6.
 */
const wireCatalogConfigureChevrons = () => {
  const host = safeGetElement("apiSection_catalog");
  if (!host || host.__stakCatalogChevronBound) return;
  host.__stakCatalogChevronBound = true;

  host.addEventListener("click", (e) => {
    const btn = e.target.closest(".catalog-expand-btn, .js-catalog-configure");
    if (!btn || !host.contains(btn)) return;
    const row = btn.closest(".catalog-row");
    if (!row) return;
    const expand = row.querySelector(".catalog-row-expand");
    if (!expand) return;
    const isOpen = expand.style.display !== "none";
    expand.style.display = isOpen ? "none" : "";
    btn.setAttribute("aria-expanded", isOpen ? "false" : "true");
    row.classList.toggle("open", !isOpen);
  });
};

const reinitializeCatalogProviders = () => {
  if (
    typeof window.catalogAPI !== "undefined" &&
    typeof window.catalogAPI.initializeProviders === "function"
  ) {
    window.catalogAPI.initializeProviders();
  }
};

const saveCatalogProviderConfig = (provider, value) => {
  if (typeof window.catalogConfig === "undefined") return false;
  if (provider === "numista") {
    window.catalogConfig.setNumistaConfig(value);
    reinitializeCatalogProviders();
    return true;
  }
  if (provider === "pcgs") {
    window.catalogConfig.setPcgsConfig(value);
    reinitializeCatalogProviders();
    return true;
  }
  return false;
};

const refreshNumistaUsageBar = (row) => {
  if (typeof window.renderNumistaUsageBar !== "function") return;
  const usageContainer = row ? row.querySelector("#numistaUsageBar") : null;
  if (!usageContainer) {
    const expand = row ? row.querySelector(".catalog-row-expand") : null;
    if (expand) {
      const existing = expand.querySelector(".usage-bar, .api-usage-label");
      if (existing) existing.remove();
      const bar = document.createElement("div");
      bar.id = "numistaUsageBar";
      const actions = expand.querySelector(".catalog-expand-actions");
      expand.insertBefore(bar, actions || null);
    }
  }
  setTimeout(() => window.renderNumistaUsageBar(), 0);
};

const markCatalogInputDirty = (input) => {
  const row = input.closest(".catalog-row");
  input.dataset.dirty = "true";
  if (row) row.classList.add("is-dirty");
};

const handleCatalogSave = (btn) => {
  const row = btn.closest(".catalog-row");
  const provider = btn.dataset.provider || (row ? row.dataset.provider : "");
  const input = row ? row.querySelector(".js-api-key-input") : null;
  if (!input) return;
  if (input.dataset.masked === "true" && input.value === CATALOG_KEY_MASK) return;

  const value = (input.value || "").trim();
  saveCatalogProviderConfig(provider, value);
  if (typeof showAppAlert === "function") {
    showAppAlert("API key saved.", "success");
  }
  if (value) {
    input.value = CATALOG_KEY_MASK;
    input.dataset.masked = "true";
    input.type = "password";
  } else {
    input.dataset.masked = "false";
  }
  delete input.dataset.dirty;
  if (row) row.classList.remove("is-dirty");
  if (provider === "numista") refreshNumistaUsageBar(row);
};

const handleCatalogTest = async (btn) => {
  const row = btn.closest(".catalog-row");
  const provider = btn.dataset.provider || (row ? row.dataset.provider : "");
  const input = row ? row.querySelector(".js-api-key-input") : null;
  const hasStoredKey = !!(input && input.dataset.masked === "true");
  const value = input ? (input.value || "").trim() : "";

  if (!value && !hasStoredKey) {
    showAppAlert(
      provider === "pcgs" ? "Enter a PCGS bearer token first." : "Enter a Numista API key first.",
      "warning"
    );
    return;
  }
  if (value && !hasStoredKey) {
    saveCatalogProviderConfig(provider, value);
  }

  if (window.catalogConfig) window.catalogConfig.load();

  if (provider === "numista" && typeof window.testNumistaAPI === "function") {
    try {
      const result = await window.testNumistaAPI();
      showAppAlert(
        result ? "Numista API test successful." : "Numista API test failed — check your key.",
        result ? "success" : "error"
      );
    } catch (err) {
      showAppAlert("Numista API test failed.", "error");
    }
  } else if (
    provider === "pcgs" &&
    typeof window.catalogConfig !== "undefined" &&
    typeof window.catalogConfig.testPcgsKey === "function"
  ) {
    const result = await window.catalogConfig.testPcgsKey();
    showAppAlert(result.message, result.success ? "success" : "error");
  }
};

const handleCatalogTogglePassword = (btn) => {
  const expand = btn.closest(".catalog-row-expand");
  if (!expand) return;
  const input = expand.querySelector(".js-api-key-input");
  if (!input) return;
  const isVisible = input.type === "text";

  if (input.dataset.masked === "true" && input.dataset.dirty !== "true" && window.catalogConfig) {
    const row = expand.closest(".catalog-row");
    const provider = row ? row.dataset.provider : "";
    if (isVisible) {
      input.value = CATALOG_KEY_MASK;
    } else {
      window.catalogConfig.load();
      if (provider === "numista") {
        const cfg = window.catalogConfig.getNumistaConfig();
        input.value = cfg.apiKey || "";
      } else if (provider === "pcgs") {
        const cfg = window.catalogConfig.getPcgsConfig();
        input.value = cfg.bearerToken || "";
      }
    }
  }

  input.type = isVisible ? "password" : "text";
  btn.setAttribute("aria-label", isVisible ? "Show API key" : "Hide API key");
};

/**
 * Delegated click handler on `#apiSection_catalog` for Test, Catalog History,
 * and key-save actions. Uses `window.catalogConfig` (CatalogConfig instance)
 * for key persistence and `window.testNumistaAPI` / `window.showCatalogHistoryModal`
 * for feature actions.
 */
const wireCatalogActions = () => {
  const host = safeGetElement("apiSection_catalog");
  if (!host || host.__stakCatalogActionsBound) return;
  host.__stakCatalogActionsBound = true;

  host.addEventListener("click", async (e) => {
    const btn = e.target.closest(
      ".js-catalog-save, .js-catalog-test, .js-catalog-history, .js-toggle-password, .js-open-bulk-sync"
    );
    if (!btn || !host.contains(btn)) return;

    if (btn.classList.contains("js-catalog-save")) {
      handleCatalogSave(btn);
      return;
    }

    if (btn.classList.contains("js-catalog-test")) {
      await handleCatalogTest(btn);
      return;
    }

    if (btn.classList.contains("js-catalog-history")) {
      if (typeof window.showCatalogHistoryModal === "function") {
        window.showCatalogHistoryModal();
      }
      return;
    }

    if (btn.classList.contains("js-toggle-password")) {
      handleCatalogTogglePassword(btn);
      return;
    }
  });

  host.addEventListener("input", (e) => {
    const input = e.target.closest(".js-api-key-input");
    if (!input || !host.contains(input)) return;
    if (input.dataset.masked === "true") {
      if (input.value === CATALOG_KEY_MASK) input.value = "";
      input.dataset.masked = "false";
      delete input.dataset.clearOnInput;
    }
    markCatalogInputDirty(input);
  });

  host.addEventListener("focusin", (e) => {
    const input = e.target.closest(".js-api-key-input");
    if (!input || !host.contains(input)) return;
    if (input.dataset.masked === "true") {
      input.dataset.clearOnInput = "true";
      requestAnimationFrame(() => {
        if (document.activeElement === input) {
          input.select();
        }
      });
    }
  });
};

/**
 * Wires the Bulk Sync modal lifecycle:
 *   - Delegated click on `.js-open-bulk-sync` buttons (within the Settings
 *     modal) opens the modal for the provider from `data-provider`.
 *   - Document-level Escape keydown closes the modal when visible.
 *   - Backdrop click on `#bulkSyncModal` (but not `.modal-content`) closes it.
 *   - `.modal-close` inside the modal closes it.
 *   - `.bulk-tab` clicks switch the active tab via `window.switchBulkSyncTab`.
 * Document-level listeners are intentional (modal is a floating overlay) and
 * idempotency-guarded so repeat calls do not stack listeners. REQ-7.
 */
const wireBulkSyncModal = () => {
  const settingsModal = safeGetElement("settingsModal");
  if (settingsModal && !settingsModal.__stakBulkOpenBound) {
    settingsModal.__stakBulkOpenBound = true;
    settingsModal.addEventListener("click", (e) => {
      const trigger = e.target.closest(".js-open-bulk-sync");
      if (!trigger || !settingsModal.contains(trigger)) return;
      const provider =
        trigger.dataset.provider ||
        (trigger.closest("[data-provider]") || {}).dataset?.provider ||
        "";
      if (typeof window.openBulkSyncModal === "function" && provider) {
        window.openBulkSyncModal(provider);
      }
    });
  }

  const bulkModal = safeGetElement("bulkSyncModal");
  if (bulkModal && !bulkModal.__stakBulkModalBound) {
    bulkModal.__stakBulkModalBound = true;

    // Backdrop click (direct modal element, not its content) closes modal.
    bulkModal.addEventListener("click", (e) => {
      if (e.target === bulkModal && typeof window.closeBulkSyncModal === "function") {
        window.closeBulkSyncModal();
      }
    });

    // Delegated click inside the modal: handle close button + tab switching.
    bulkModal.addEventListener("click", (e) => {
      const closeBtn = e.target.closest(".modal-close");
      if (closeBtn && bulkModal.contains(closeBtn)) {
        if (typeof window.closeBulkSyncModal === "function") {
          window.closeBulkSyncModal();
        }
        return;
      }
      const tab = e.target.closest(".bulk-tab");
      if (tab && bulkModal.contains(tab) && typeof window.switchBulkSyncTab === "function") {
        const tabId = tab.dataset.tab;
        if (tabId) window.switchBulkSyncTab(tabId);
      }
    });
  }

  // Document-level Escape handler — bound once for the lifetime of the page.
  // Safe because it short-circuits when the modal is hidden.
  if (!document.__stakBulkEscapeBound) {
    document.__stakBulkEscapeBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const modal = safeGetElement("bulkSyncModal");
      if (!modal || modal.style.display === "none") return;
      if (typeof window.closeBulkSyncModal === "function") {
        window.closeBulkSyncModal();
      }
    });
  }
};

/**
 * Wires up all Settings modal event listeners.
 * Called once during initialization.
 */
const setupSettingsEventListeners = () => {
  bindSettingsNavigationListeners();
  bindAppearanceAndHeaderListeners();
  bindFilterAndNumistaListeners();
  bindBulkSyncModalListeners();
  bindSettingsModalShellListeners();
  wireSpotPillRadio();
  wireSpotProviderActions();
  wireCatalogConfigureChevrons();
  wireCatalogActions();
  wireBulkSyncModal();
  bindGoldbackPricingSourceListener();
  bindImageSettingsListeners();
  bindCloudStorageListeners();
  bindStorageListeners();
  bindRetailMarketListeners();
  bindApiCacheListeners();
  bindMarketFilterListeners();
};

if (typeof window !== "undefined") {
  window.setupSettingsEventListeners = setupSettingsEventListeners;
  window.cloudUpdateBackupCount = cloudUpdateBackupCount;
}
