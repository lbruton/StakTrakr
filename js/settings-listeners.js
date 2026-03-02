/**
 * Settings modal listener binders (STAK-135)
 *
 * Keeps listener wiring split by concern while preserving existing behavior.
 */

let _patternMode = 'keywords';

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
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      switchSettingsSection(item.dataset.section);
    });
  });

  // Provider tabs.
  document.querySelectorAll('.settings-provider-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchProviderTab(tab.dataset.provider);
    });
  });

  // Log sub-tabs.
  document.querySelectorAll('[data-log-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      switchLogTab(tab.dataset.logTab);
    });
  });
};

/**
 * Binds listeners for appearance settings (theme, display currency, timezone, header toggles).
 */
const bindAppearanceAndHeaderListeners = () => {
  // Theme picker buttons.
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
      if (e.shiftKey && btn.dataset.theme === 'sepia') {
        document.documentElement.setAttribute('data-theme', 'hello-kitty');
        saveDataSync(THEME_KEY, 'hello-kitty');
        document.querySelectorAll('.theme-option').forEach((b) => b.classList.remove('active'));
        if (typeof renderTable === 'function') renderTable();
        if (typeof updateAllSparklines === 'function') updateAllSparklines();
        return;
      }
      const theme = btn.dataset.theme;
      if (typeof setTheme === 'function') {
        setTheme(theme);
      }
      if (typeof updateThemeButton === 'function') {
        updateThemeButton();
      }
      document.querySelectorAll('.theme-option').forEach((b) => {
        b.classList.toggle('active', b.dataset.theme === theme);
      });
    });
  });

  // Display currency (STACK-50).
  const currencySelect = getExistingElement('settingsDisplayCurrency');
  if (currencySelect) {
    currencySelect.addEventListener('change', () => {
      saveDisplayCurrency(currencySelect.value);
      if (typeof renderTable === 'function') renderTable();
      if (typeof updateSummary === 'function') updateSummary();
      if (typeof updateAllSparklines === 'function') updateAllSparklines();
      if (typeof syncGoldbackSettingsUI === 'function') syncGoldbackSettingsUI();
    });
  }

  // Display timezone (STACK-63).
  const tzSelect = getExistingElement('settingsTimezone');
  if (tzSelect) {
    tzSelect.addEventListener('change', () => {
      localStorage.setItem(TIMEZONE_KEY, tzSelect.value);
      window.location.reload();
    });
  }

  // settingsHeaderCurrencyBtn still exists in the Currency settings panel
  wireStorageToggle('settingsHeaderCurrencyBtn', 'headerCurrencyBtnVisible', {
    defaultVal: false,
    onApply: () => applyHeaderToggleVisibility(),
  });

  wireStorageToggle('settingsHeaderShowText_hdr', HEADER_BTN_SHOW_TEXT_KEY, {
    defaultVal: true,
    onApply: () => applyHeaderToggleVisibility(),
  });

  // Trend cycle header button.
  const headerTrendBtn = safeGetElement('headerTrendBtn');
  if (headerTrendBtn) {
    headerTrendBtn.addEventListener('click', () => {
      if (typeof window.cycleSpotTrend === 'function') window.cycleSpotTrend();
    });
  }

  // Sync all spot prices header button.
  const headerSyncBtn = safeGetElement('headerSyncBtn');
  if (headerSyncBtn) {
    headerSyncBtn.addEventListener('click', () => {
      ['Silver', 'Gold', 'Platinum', 'Palladium'].forEach(m => {
        const btn = document.getElementById(`syncIcon${m}`);
        if (btn && !btn.disabled) btn.click();
      });
    });
  }

  // Theme cycle header button (STACK-54).
  if (elements.headerThemeBtn) {
    elements.headerThemeBtn.addEventListener('click', () => {
      if (typeof toggleTheme === 'function') toggleTheme();
      if (typeof updateThemeButton === 'function') updateThemeButton();
      const currentTheme = localStorage.getItem(THEME_KEY) || 'light';
      document.querySelectorAll('.theme-option').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.theme === currentTheme);
      });
    });
  }

  // Currency picker header button (STACK-54).
  if (elements.headerCurrencyBtn) {
    elements.headerCurrencyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCurrencyDropdown();
    });
  }

  // Market button - open Settings → Market tab.
  const headerMarketBtn = safeGetElement('headerMarketBtn');
  if (headerMarketBtn) {
    headerMarketBtn.addEventListener('click', () => {
      if (typeof showSettingsModal === 'function') {
        showSettingsModal('market');
      }
    });
  }

  // Vault header button — opens Settings → System (backup/restore) (STAK-314).
  const headerVaultBtn = safeGetElement('headerVaultBtn');
  if (headerVaultBtn) {
    headerVaultBtn.addEventListener('click', () => {
      if (typeof showSettingsModal === 'function') showSettingsModal('system');
    });
  }

  // Restore header button — opens Settings → System (backup/restore) (STAK-314).
  const headerRestoreBtn = safeGetElement('headerRestoreBtn');
  if (headerRestoreBtn) {
    headerRestoreBtn.addEventListener('click', () => {
      if (typeof showSettingsModal === 'function') showSettingsModal('system');
    });
  }

  const ippSelect = getExistingElement('settingsItemsPerPage');
  if (ippSelect) {
    ippSelect.addEventListener('change', () => {
      const ippVal = ippSelect.value;
      itemsPerPage = ippVal === 'all' ? Infinity : parseInt(ippVal, 10);
      try { localStorage.setItem(ITEMS_PER_PAGE_KEY, ippVal); } catch (e) { /* ignore */ }
      if (elements.itemsPerPage) elements.itemsPerPage.value = ippVal;
      renderTable();
    });
  }

  const spotCompareSetting = getExistingElement('settingsSpotCompareMode');
  if (spotCompareSetting) {
    spotCompareSetting.addEventListener('change', () => {
      try { localStorage.setItem(SPOT_COMPARE_MODE_KEY, spotCompareSetting.value); } catch (e) { /* ignore */ }
      if (typeof updateAllSparklines === 'function') updateAllSparklines();
    });
  }

};

/**
 * Binds listeners for filter settings and Numista integration options.
 */
const bindFilterAndNumistaListeners = () => {
  const chipMinSetting = getExistingElement('settingsChipMinCount');
  if (chipMinSetting) {
    chipMinSetting.addEventListener('change', () => {
      const val = chipMinSetting.value;
      localStorage.setItem('chipMinCount', val);
      const chipMinInline = getExistingElement('chipMinCount');
      if (chipMinInline) chipMinInline.value = val;
      if (typeof renderActiveFilters === 'function') renderActiveFilters();
      if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
    });
  }

  const chipMaxSetting = getExistingElement('settingsChipMaxCount');
  if (chipMaxSetting) {
    chipMaxSetting.addEventListener('change', () => {
      const val = chipMaxSetting.value;
      localStorage.setItem('chipMaxCount', val);
      const chipMaxInline = getExistingElement('chipMaxCount');
      if (chipMaxInline) chipMaxInline.value = val;
      if (typeof renderActiveFilters === 'function') renderActiveFilters();
      if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
    });
  }

  wireFeatureFlagToggle('settingsGroupNameChips', 'GROUPED_NAME_CHIPS', {
    syncId: 'groupNameChips',
    onApply: () => { if (typeof renderActiveFilters === 'function') renderActiveFilters(); },
  });

  wireFeatureFlagToggle('settingsDynamicChips', 'DYNAMIC_NAME_CHIPS', {
    onApply: () => { if (typeof renderActiveFilters === 'function') renderActiveFilters(); },
  });

  wireFeatureFlagToggle('settingsChipQtyBadge', 'CHIP_QTY_BADGE', {
    onApply: () => { if (typeof renderActiveFilters === 'function') renderActiveFilters(); },
  });

  wireFeatureFlagToggle('settingsFuzzyAutocomplete', 'FUZZY_AUTOCOMPLETE', {
    onApply: (isEnabled) => {
      if (isEnabled && typeof initializeAutocomplete === 'function') initializeAutocomplete(inventory);
    },
  });

  wireFeatureFlagToggle('settingsNumistaLookup', 'NUMISTA_SEARCH_LOOKUP');

  const numistaViewContainer = getExistingElement('numistaViewFieldToggles');
  if (numistaViewContainer) {
    const nfConfig = typeof getNumistaViewFieldConfig === 'function' ? getNumistaViewFieldConfig() : {};
    numistaViewContainer.querySelectorAll('input[data-nf]').forEach((cb) => {
      const field = cb.dataset.nf;
      if (nfConfig[field] !== undefined) cb.checked = nfConfig[field];
    });
    numistaViewContainer.addEventListener('change', () => {
      const config = {};
      numistaViewContainer.querySelectorAll('input[data-nf]').forEach((cb) => {
        config[cb.dataset.nf] = cb.checked;
      });
      if (typeof saveNumistaViewFieldConfig === 'function') saveNumistaViewFieldConfig(config);
    });
  }

  const addNumistaRuleBtn = getExistingElement('addNumistaRuleBtn');
  if (addNumistaRuleBtn) {
    addNumistaRuleBtn.addEventListener('click', () => {
      const patternInput = getExistingElement('numistaRulePatternInput');
      const replacementInput = getExistingElement('numistaRuleReplacementInput');
      const idInput = getExistingElement('numistaRuleIdInput');
      if (!patternInput || !replacementInput) return;

      const pattern = patternInput.value.trim();
      const replacement = replacementInput.value.trim();
      const numistaId = idInput ? idInput.value.trim() : '';

      if (!pattern || !replacement) {
        appAlert('Pattern and Numista query are required.');
        return;
      }

      if (!window.NumistaLookup) return;
      const result = NumistaLookup.addRule(pattern, replacement, numistaId || null);
      if (!result.success) {
        appAlert(result.error);
        return;
      }

      patternInput.value = '';
      replacementInput.value = '';
      if (idInput) idInput.value = '';
      renderCustomRuleTable();
    });
  }

  wireChipSortToggle('settingsChipSortOrder', 'chipSortOrder');
  if (typeof window.setupChipGroupingEvents === 'function') {
    window.setupChipGroupingEvents();
  }
};

/**
 * Binds listeners for Numista bulk sync operations.
 */
const bindNumistaBulkSyncListeners = () => {
  const nsStartBtn = getExistingElement('numistaSyncStartBtn');
  if (nsStartBtn) {
    nsStartBtn.addEventListener('click', () => {
      if (typeof startBulkSync === 'function') startBulkSync();
    });
  }

  const nsCancelBtn = getExistingElement('numistaSyncCancelBtn');
  if (nsCancelBtn) {
    nsCancelBtn.addEventListener('click', () => {
      if (window.BulkImageCache) BulkImageCache.abort();
      nsCancelBtn.style.display = 'none';
    });
  }

  const nsClearBtn = getExistingElement('numistaSyncClearBtn');
  if (nsClearBtn) {
    nsClearBtn.addEventListener('click', () => {
      if (typeof clearAllCachedData === 'function') clearAllCachedData();
    });
  }
};

/**
 * Binds listeners for the settings modal shell (close button, background click).
 */
const bindSettingsModalShellListeners = () => {
  const closeBtn = getExistingElement('settingsCloseBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', hideSettingsModal);
  }

  const modal = getExistingElement('settingsModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideSettingsModal();
    });
  }

  // Provider priority dropdowns (STACK-90).
  setupProviderPriority();
};

/**
 * Binds listeners for Goldback feature toggles and estimation settings.
 */
const bindGoldbackToggleListeners = () => {
  const gbToggle = getExistingElement('settingsGoldbackEnabled');
  if (gbToggle) {
    gbToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-sort-btn');
      if (!btn) return;
      const isEnabled = btn.dataset.val === 'on';
      if (typeof saveGoldbackEnabled === 'function') saveGoldbackEnabled(isEnabled);
      gbToggle.querySelectorAll('.chip-sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
      if (typeof renderTable === 'function') renderTable();
    });
  }

  const gbEstToggle = getExistingElement('settingsGoldbackEstimateEnabled');
  if (gbEstToggle) {
    gbEstToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-sort-btn');
      if (!btn) return;
      const isEnabled = btn.dataset.val === 'on';
      if (typeof saveGoldbackEstimateEnabled === 'function') saveGoldbackEstimateEnabled(isEnabled);
      gbEstToggle.querySelectorAll('.chip-sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
      if (isEnabled && typeof onGoldSpotPriceChanged === 'function') onGoldSpotPriceChanged();
      if (typeof syncGoldbackSettingsUI === 'function') syncGoldbackSettingsUI();
      if (typeof renderTable === 'function') renderTable();
    });
  }

  const gbEstRefreshBtn = getExistingElement('goldbackEstimateRefreshBtn');
  if (gbEstRefreshBtn) {
    gbEstRefreshBtn.addEventListener('click', async () => {
      if (typeof fetchGoldbackApiPrices !== 'function') return;
      const origText = gbEstRefreshBtn.textContent;
      gbEstRefreshBtn.textContent = 'Fetching...';
      gbEstRefreshBtn.disabled = true;
      try {
        const result = await fetchGoldbackApiPrices();
        if (!result.ok) console.warn('Goldback API fetch failed:', result.error);
      } catch (err) {
        console.warn('Goldback API fetch error:', err);
      } finally {
        gbEstRefreshBtn.textContent = origText;
        gbEstRefreshBtn.disabled = false;
      }
    });
  }

  const gbModifierInput = getExistingElement('goldbackEstimateModifierInput');
  if (gbModifierInput) {
    gbModifierInput.addEventListener('change', () => {
      const val = parseFloat(gbModifierInput.value);
      if (isNaN(val) || val <= 0) {
        gbModifierInput.value = goldbackEstimateModifier.toFixed(2);
        return;
      }
      if (typeof saveGoldbackEstimateModifier === 'function') saveGoldbackEstimateModifier(val);
      if (goldbackEstimateEnabled && typeof onGoldSpotPriceChanged === 'function') onGoldSpotPriceChanged();
      if (typeof recordAllItemPriceSnapshots === 'function') recordAllItemPriceSnapshots();
      if (typeof syncGoldbackSettingsUI === 'function') syncGoldbackSettingsUI();
      if (typeof renderTable === 'function') renderTable();
    });
  }
};

/**
 * Binds listeners for Goldback price entry and history actions.
 */
const bindGoldbackActionListeners = () => {
  const gbSaveBtn = getExistingElement('goldbackSavePricesBtn');
  if (gbSaveBtn) {
    gbSaveBtn.addEventListener('click', () => {
      const tbody = getExistingElement('goldbackPriceTableBody');
      if (!tbody) return;
      const now = Date.now();
      const fxRate = (typeof getExchangeRate === 'function') ? getExchangeRate() : 1;
      tbody.querySelectorAll('tr[data-denom]').forEach((row) => {
        const denom = row.dataset.denom;
        const input = row.querySelector('input[type="number"]');
        if (!input) return;
        const displayVal = parseFloat(input.value);
        if (!isNaN(displayVal) && displayVal > 0) {
          const usdVal = fxRate !== 1 ? displayVal / fxRate : displayVal;
          goldbackPrices[denom] = { price: usdVal, updatedAt: now };
        }
      });
      if (typeof saveGoldbackPrices === 'function') saveGoldbackPrices();
      if (typeof recordGoldbackPrices === 'function') recordGoldbackPrices();
      if (typeof recordAllItemPriceSnapshots === 'function') recordAllItemPriceSnapshots();
      if (typeof syncGoldbackSettingsUI === 'function') syncGoldbackSettingsUI();
      if (typeof renderTable === 'function') renderTable();
    });
  }

  const gbQuickFillBtn = getExistingElement('goldbackQuickFillBtn');
  if (gbQuickFillBtn) {
    gbQuickFillBtn.addEventListener('click', () => {
      const input = getExistingElement('goldbackQuickFillInput');
      if (!input) return;
      const rate = parseFloat(input.value);
      if (isNaN(rate) || rate <= 0) {
        appAlert('Enter a valid 1 Goldback rate.');
        return;
      }
      const tbody = getExistingElement('goldbackPriceTableBody');
      if (!tbody || typeof GOLDBACK_DENOMINATIONS === 'undefined') return;
      tbody.querySelectorAll('tr[data-denom]').forEach((row) => {
        const denom = parseFloat(row.dataset.denom);
        const priceInput = row.querySelector('input[type="number"]');
        if (priceInput) {
          priceInput.value = (Math.round(rate * denom * 100) / 100).toFixed(2);
        }
      });
    });
  }

  const gbHistoryBtn = getExistingElement('goldbackHistoryBtn');
  if (gbHistoryBtn) {
    gbHistoryBtn.addEventListener('click', () => {
      if (typeof showGoldbackHistoryModal === 'function') showGoldbackHistoryModal();
    });
  }

  const gbHistoryCloseBtn = getExistingElement('goldbackHistoryCloseBtn');
  if (gbHistoryCloseBtn) {
    gbHistoryCloseBtn.addEventListener('click', () => {
      if (typeof hideGoldbackHistoryModal === 'function') hideGoldbackHistoryModal();
    });
  }

  const gbHistoryModal = getExistingElement('goldbackHistoryModal');
  if (gbHistoryModal) {
    gbHistoryModal.addEventListener('click', (e) => {
      if (e.target === gbHistoryModal) {
        if (typeof hideGoldbackHistoryModal === 'function') hideGoldbackHistoryModal();
      }
    });
  }

  const gbExportBtn = getExistingElement('exportGoldbackHistoryBtn');
  if (gbExportBtn) {
    gbExportBtn.addEventListener('click', () => {
      if (typeof exportGoldbackHistory === 'function') exportGoldbackHistory();
    });
  }
};

/**
 * Binds listeners for image sync and cache clearing operations.
 */
const bindImageSyncListeners = () => {
  const clearImagesBtn = getExistingElement('clearAllImagesBtn');
  if (clearImagesBtn) {
    clearImagesBtn.addEventListener('click', async () => {
      const confirmed = await appConfirm(
        'Clear all cached images, pattern rules, user uploads, AND image URLs from inventory items?',
        'Image Data',
      );
      if (!confirmed) return;
      if (window.imageCache?.isAvailable()) await imageCache.clearAll();
      let cleared = 0;
      for (const item of inventory) {
        if (item.obverseImageUrl || item.reverseImageUrl) {
          item.obverseImageUrl = '';
          item.reverseImageUrl = '';
          cleared++;
        }
      }
      if (cleared > 0 && typeof saveInventory === 'function') saveInventory();
      populateImagesSection();
      if (typeof renderTable === 'function') renderTable();
      appAlert(`Cleared all image data. ${cleared} item URL(s) reset.`);
    });
  }

  const purgeNumistaUrlsBtn = getExistingElement('purgeNumistaUrlsBtn');
  if (purgeNumistaUrlsBtn) {
    purgeNumistaUrlsBtn.addEventListener('click', async () => {
      const confirmed = await appConfirm(
        'Remove all Numista CDN image URLs from inventory items?\nUser-uploaded images and pattern rule images are NOT affected.',
        'Purge Numista URLs',
      );
      if (!confirmed) return;
      const isNumistaUrl = (url) => url && /numista\.com/i.test(url);
      let purged = 0;
      for (const item of inventory) {
        let changed = false;
        if (isNumistaUrl(item.obverseImageUrl)) { item.obverseImageUrl = ''; changed = true; }
        if (isNumistaUrl(item.reverseImageUrl)) { item.reverseImageUrl = ''; changed = true; }
        if (changed) purged++;
      }
      if (purged > 0 && typeof saveInventory === 'function') saveInventory();
      if (typeof renderTable === 'function') renderTable();
      appAlert(`Purged Numista CDN URLs from ${purged} item(s).`);
    });
  }

  const syncImageUrlsBtn = getExistingElement('syncImageUrlsBtn');
  if (syncImageUrlsBtn) {
    syncImageUrlsBtn.addEventListener('click', async () => {
      const config = typeof catalogConfig !== 'undefined' ? catalogConfig.getNumistaConfig() : null;
      if (!config?.apiKey) {
        appAlert('Numista API key not configured.');
        return;
      }
      const eligible = inventory.filter(i => i.numistaId);
      if (!eligible.length) {
        appAlert('No items with Numista IDs found.');
        return;
      }
      const shouldSync = await appConfirm(
        `Sync image URLs for ${eligible.length} items from Numista API?\nThis bypasses cache and uses your API quota.`,
        'Sync Image URLs',
      );
      if (!shouldSync) {
        return;
      }

      syncImageUrlsBtn.disabled = true;
      syncImageUrlsBtn.textContent = 'Syncing…';
      let synced = 0;
      let failed = 0;
      let skipped = 0;
      const seen = new Set();
      const urlByCatId = new Map();
      try {
        for (const item of eligible) {
          const catId = item.numistaId;
          if (seen.has(catId)) {
            const donor = urlByCatId.get(catId);
            if (donor) {
              item.obverseImageUrl = donor.obverseImageUrl;
              item.reverseImageUrl = donor.reverseImageUrl;
              synced++;
            } else {
              skipped++;
            }
            continue;
          }
          seen.add(catId);
          try {
            const url = `https://api.numista.com/v3/types/${catId}?lang=en`;
            const resp = await fetch(url, {
              headers: { 'Numista-API-Key': config.apiKey, 'Content-Type': 'application/json' },
              cache: 'no-cache',
            });
            if (!resp.ok) {
              failed++;
              continue;
            }
            const data = await resp.json();
            const obv = data.obverse_thumbnail || data.obverse?.thumbnail || '';
            const rev = data.reverse_thumbnail || data.reverse?.thumbnail || '';
            urlByCatId.set(catId, { obverseImageUrl: obv, reverseImageUrl: rev });
            for (const inv of eligible) {
              if (inv.numistaId === catId) {
                inv.obverseImageUrl = obv;
                inv.reverseImageUrl = rev;
              }
            }
            synced++;
            await new Promise((resolve) => setTimeout(resolve, 200));
          } catch {
            failed++;
          }
        }
        if (typeof saveInventory === 'function') saveInventory();
        populateImagesSection();
        appAlert(`Image URL sync complete.\n${synced} synced, ${failed} failed, ${skipped} skipped (dupes).`);
      } finally {
        syncImageUrlsBtn.disabled = false;
        syncImageUrlsBtn.textContent = 'Sync Image URLs from Numista';
      }
    });
  }
};

/**
 * Binds listeners for pattern rule mode switching and creation.
 */
const bindPatternRuleModeListeners = () => {
  const patternModeKeywords = getExistingElement('patternModeKeywords');
  const patternModeRegex = getExistingElement('patternModeRegex');
  const patternInput = getExistingElement('patternRulePattern');
  const patternTip = getExistingElement('patternRuleTip');

  if (patternModeKeywords && patternModeRegex) {
    patternModeKeywords.addEventListener('click', () => {
      _patternMode = 'keywords';
      patternModeKeywords.classList.add('active');
      patternModeRegex.classList.remove('active');
      if (patternInput) patternInput.placeholder = 'e.g. morgan, peace, walking liberty';
      if (patternTip) patternTip.textContent = 'Separate keywords with commas or semicolons. Matches item names containing any keyword.';
    });
    patternModeRegex.addEventListener('click', () => {
      _patternMode = 'regex';
      patternModeRegex.classList.add('active');
      patternModeKeywords.classList.remove('active');
      if (patternInput) patternInput.placeholder = 'e.g. \\bmorgan\\b|\\bpeace\\b';
      if (patternTip) patternTip.textContent = 'Case-insensitive regex. Use \\b for word boundaries, | for OR, .* for wildcards.';
    });
  }

  if (patternInput && typeof attachAutocomplete === 'function') {
    attachAutocomplete(patternInput, 'names');
  }

  // Camera capture buttons — bridge capture input → main file input via DataTransfer
  [['patternRuleObverseCamera', 'patternRuleObverseCapture', 'patternRuleObverse'],
   ['patternRuleReverseCamera', 'patternRuleReverseCapture', 'patternRuleReverse']].forEach(([btnId, captureId, mainId]) => {
    const btn = getExistingElement(btnId);
    const captureInput = getExistingElement(captureId);
    const mainInput = getExistingElement(mainId);
    if (btn && captureInput && mainInput) {
      btn.addEventListener('click', () => captureInput.click());
      captureInput.addEventListener('change', () => {
        if (!captureInput.files?.length) return;
        const dt = new DataTransfer();
        dt.items.add(captureInput.files[0]);
        mainInput.files = dt.files;
        mainInput.dispatchEvent(new Event('change'));
      });
    }
  });

  const addPatternRuleBtn = getExistingElement('addPatternRuleBtn');
  if (addPatternRuleBtn) {
    addPatternRuleBtn.addEventListener('click', async () => {
      const obverseInput = getExistingElement('patternRuleObverse');
      const reverseInput = getExistingElement('patternRuleReverse');

      const rawPattern = patternInput?.value?.trim();
      const replacement = rawPattern || '';

      if (!rawPattern) {
        appAlert('Pattern is required.');
        return;
      }

      let pattern = rawPattern;
      if (_patternMode === 'keywords') {
        const terms = rawPattern.split(/[,;]/).map(t => t.trim()).filter(t => t.length > 0);
        if (terms.length === 0) {
          appAlert('Enter at least one keyword.');
          return;
        }
        pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      }

      try {
        new RegExp(pattern, 'i');
      } catch (e) {
        appAlert('Invalid pattern: ' + e.message);
        return;
      }

      if (!obverseInput?.files?.[0] && !reverseInput?.files?.[0]) {
        appAlert('Please select at least one image (obverse or reverse).');
        return;
      }

      let obverseBlob = null;
      let reverseBlob = null;
      const processor = typeof imageProcessor !== 'undefined' ? imageProcessor : null;

      try {
        if (obverseInput?.files?.[0]) {
          if (processor) {
            const result = await processor.processFile(obverseInput.files[0]);
            obverseBlob = result?.blob || null;
          } else {
            obverseBlob = obverseInput.files[0];
          }
        }

        if (reverseInput?.files?.[0]) {
          if (processor) {
            const result = await processor.processFile(reverseInput.files[0]);
            reverseBlob = result?.blob || null;
          } else {
            reverseBlob = reverseInput.files[0];
          }
        }
      } catch (err) {
        console.error('Image processing failed:', err);
        appAlert('Failed to process image: ' + err.message);
        return;
      }

      const ruleId = 'custom-img-' + Date.now();
      const addResult = NumistaLookup.addRule(pattern, replacement, null, ruleId);
      if (!addResult.success) {
        appAlert(addResult.error || 'Failed to add rule.');
        return;
      }

      if ((obverseBlob || reverseBlob) && window.imageCache?.isAvailable()) {
        await imageCache.cachePatternImage(ruleId, obverseBlob, reverseBlob);
      }

      if (patternInput) patternInput.value = '';
      if (obverseInput) obverseInput.value = '';
      if (reverseInput) reverseInput.value = '';

      renderCustomPatternRules();
      renderImageStorageStats();
    });
  }
};

/**
 * Binds listeners for card style and table image toggles.
 */
const bindCardAndTableImageListeners = () => {
  // Card style toggle (A/B/C/D chip buttons in Appearance > Inventory)
  const cardStyleToggleEl = getExistingElement('settingsCardStyleToggle');
  if (cardStyleToggleEl) {
    const savedStyle = localStorage.getItem(CARD_STYLE_KEY) || 'D';
    cardStyleToggleEl.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.style === savedStyle);
    });
    cardStyleToggleEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-style]');
      if (!btn) return;
      const val = btn.dataset.style;
      localStorage.setItem(CARD_STYLE_KEY, val);
      cardStyleToggleEl.querySelectorAll('.chip-sort-btn').forEach(b => b.classList.toggle('active', b === btn));
      // Sync live sort bar toggle
      const liveSortToggle = document.getElementById('cardStyleToggle');
      if (liveSortToggle) {
        liveSortToggle.querySelectorAll('[data-style]').forEach(b => b.classList.toggle('active', b.dataset.style === val));
      }
      if (typeof renderTable === 'function') renderTable();
    });
  }

  // Default sort column
  const defaultSortColEl = getExistingElement('settingsDefaultSortColumn');
  if (defaultSortColEl) {
    const savedCol = localStorage.getItem(DEFAULT_SORT_COL_KEY);
    if (savedCol !== null) defaultSortColEl.value = savedCol;
    defaultSortColEl.addEventListener('change', () => {
      const val = parseInt(defaultSortColEl.value, 10);
      localStorage.setItem(DEFAULT_SORT_COL_KEY, String(val));
      sortColumn = val;
      if (typeof updateCardSortBar === 'function') updateCardSortBar();
      if (typeof renderTable === 'function') renderTable();
    });
  }

  // Default sort direction
  const defaultSortDirEl = getExistingElement('settingsDefaultSortDir');
  if (defaultSortDirEl) {
    const savedDir = localStorage.getItem(DEFAULT_SORT_DIR_KEY) || 'asc';
    defaultSortDirEl.querySelectorAll('.chip-sort-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === savedDir);
    });
    defaultSortDirEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-val]');
      if (!btn) return;
      const val = btn.dataset.val;
      localStorage.setItem(DEFAULT_SORT_DIR_KEY, val);
      sortDirection = val;
      defaultSortDirEl.querySelectorAll('.chip-sort-btn').forEach(b => b.classList.toggle('active', b === btn));
      if (typeof updateCardSortBar === 'function') updateCardSortBar();
      if (typeof renderTable === 'function') renderTable();
    });
  }

  wireStorageToggle('settingsDesktopCardView', DESKTOP_CARD_VIEW_KEY, {
    defaultVal: false,
    onApply: (isEnabled) => {
      document.body.classList.toggle('force-card-view', isEnabled);
      if (typeof renderTable === 'function') renderTable();
    },
  });

  wireStorageToggle('tableImagesToggle', 'tableImagesEnabled', {
    defaultVal: true,
    onApply: () => { if (typeof renderTable === 'function') renderTable(); },
  });

  const sidesEl = getExistingElement('tableImageSidesToggle');
  if (sidesEl) {
    const curSides = localStorage.getItem('tableImageSides') || 'both';
    sidesEl.querySelectorAll('.chip-sort-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.val === curSides);
    });
    sidesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-sort-btn');
      if (!btn) return;
      localStorage.setItem('tableImageSides', btn.dataset.val);
      sidesEl.querySelectorAll('.chip-sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
      if (typeof renderTable === 'function') renderTable();
    });
  }


};

// ---------------------------------------------------------------------------
// Image Export/Import helpers
// ---------------------------------------------------------------------------

/**
 * Builds a ZIP archive of all exported images.
 * @returns {Promise<JSZip>} The generated ZIP object.
 */
const buildImageExportZip = async () => {
  const zip = new JSZip();

  // 1. User images
  const userImages = await imageCache.exportAllUserImages();
  for (const rec of userImages) {
    if (rec.obverse) zip.file(`user/${rec.uuid}_obverse.webp`, rec.obverse);
    if (rec.reverse) zip.file(`user/${rec.uuid}_reverse.webp`, rec.reverse);
  }

  // 2. Pattern images + rules
  const patternImages = await imageCache.exportAllPatternImages();
  for (const rec of patternImages) {
    if (rec.obverse) zip.file(`pattern/${rec.ruleId}_obverse.webp`, rec.obverse);
    if (rec.reverse) zip.file(`pattern/${rec.ruleId}_reverse.webp`, rec.reverse);
  }
  const customRules = NumistaLookup.listCustomRules();
  zip.file('pattern_rules.json', JSON.stringify(customRules, null, 2));

  // (CDN coinImages export removed — STAK-339 image pipeline simplification)

  return zip;
};

// (_restoreCdnFolderFromZip removed — STAK-339 image pipeline simplification)

/**
 * Binds listeners for image import/export buttons.
 */
const bindImageImportExportListeners = () => {
  const exportBtn = getExistingElement('exportAllImagesBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      if (!window.imageCache?.isAvailable()) {
        appAlert('IndexedDB unavailable.');
        return;
      }
      if (typeof JSZip === 'undefined') {
        appAlert('JSZip not loaded.');
        return;
      }

      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting\u2026';

      try {
        const zip = await buildImageExportZip();

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'staktrakr-images.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('Image export failed:', err);
        appAlert('Export failed: ' + err.message);
      } finally {
        exportBtn.textContent = 'Export All Images';
        exportBtn.disabled = false;
      }
    });
  }

  const importBtn = getExistingElement('importImagesBtn');
  const importFile = getExistingElement('importImagesFile');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (typeof JSZip === 'undefined') {
        appAlert('JSZip not loaded.');
        return;
      }
      if (!window.imageCache?.isAvailable()) {
        appAlert('IndexedDB unavailable.');
        return;
      }

      importBtn.textContent = 'Importing...';
      importBtn.disabled = true;

      try {
        const zip = await JSZip.loadAsync(file);

        const rulesFile = zip.file('pattern_rules.json');
        if (rulesFile) {
          const rulesJson = await rulesFile.async('string');
          const rules = JSON.parse(rulesJson);
          const existingPatterns = new Set(NumistaLookup.listCustomRules().map(r => r.pattern));
          for (const rule of rules) {
            if (!rule.pattern || existingPatterns.has(rule.pattern)) continue;
            NumistaLookup.addRule(rule.pattern, rule.replacement || '', rule.numistaId || null, rule.seedImageId || null);
            existingPatterns.add(rule.pattern);
          }
        }

        const patternFiles = zip.folder('pattern');
        if (patternFiles) {
          const patternMap = new Map();
          patternFiles.forEach((relativePath, zipEntry) => {
            const match = relativePath.match(/^(.+)_(obverse|reverse)\.webp$/);
            if (match) {
              const [, ruleId, side] = match;
              if (!patternMap.has(ruleId)) patternMap.set(ruleId, {});
              patternMap.get(ruleId)[side] = zipEntry;
            }
          });
          for (const [ruleId, sides] of patternMap) {
            const obverse = sides.obverse ? await sides.obverse.async('blob') : null;
            const reverse = sides.reverse ? await sides.reverse.async('blob') : null;
            await imageCache.cachePatternImage(ruleId, obverse, reverse);
          }
        }

        const userFolder = zip.folder('user');
        if (userFolder) {
          const userMap = new Map();
          userFolder.forEach((relativePath, zipEntry) => {
            const match = relativePath.match(/^(.+)_(obverse|reverse)\.webp$/);
            if (match) {
              const [, uuid, side] = match;
              if (!userMap.has(uuid)) userMap.set(uuid, {});
              userMap.get(uuid)[side] = zipEntry;
            }
          });
          for (const [uuid, sides] of userMap) {
            const obverse = sides.obverse ? await sides.obverse.async('blob') : null;
            const reverse = sides.reverse ? await sides.reverse.async('blob') : null;
            if (obverse) await imageCache.cacheUserImage(uuid, obverse, reverse);
          }
        }

        populateImagesSection();
      } catch (err) {
        console.error('Image import failed:', err);
        appAlert('Import failed: ' + err.message);
      } finally {
        importBtn.textContent = 'Import Images';
        importBtn.disabled = false;
        importFile.value = '';
      }
    });
  }


};

/**
 * Aggregates all image-related settings listeners.
 */
const bindImageSettingsListeners = () => {
  bindImageSyncListeners();
  bindPatternRuleModeListeners();
  bindCardAndTableImageListeners();
  bindImageImportExportListeners();
};

/**
 * Render the backup list for a cloud provider.
 */
const renderCloudBackupList = (provider, backups) => {
  const listEl = document.getElementById('cloudBackupList_' + provider);
  if (!listEl) return;

  if (!backups || backups.length === 0) {
    listEl.style.display = '';
    listEl.innerHTML = '<div class="cloud-backup-empty">No backups found</div>';
    return;
  }

  listEl.style.display = '';
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  listEl.innerHTML = backups.map(function (b) {
    const d = new Date(b.server_modified);
    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const sizeStr = b.size < 1024 ? b.size + ' B' :
      b.size < 1048576 ? (b.size / 1024).toFixed(0) + ' KB' :
        (b.size / 1048576).toFixed(1) + ' MB';
    const label = b.name.includes(VAULT_IMAGE_FILE_SUFFIX) ? 'Image backup' : 'Inventory backup';
    const safeProvider = sanitizeHtml(provider);
    const safeFilename = sanitizeHtml(b.name);
    return '<div class="cloud-backup-row">' +
      '<button class="cloud-backup-entry" data-provider="' + safeProvider +
        '" data-filename="' + safeFilename + '" data-size="' + b.size + '">' +
        '<span class="cloud-backup-name" title="' + safeFilename + '">' + sanitizeHtml(dateStr) + '</span>' +
        '<span class="cloud-backup-size">' + sanitizeHtml(sizeStr) + '</span>' +
        '<span class="cloud-backup-type">' + label + '</span>' +
      '</button>' +
      '<button class="cloud-backup-delete-btn" data-provider="' + safeProvider +
        '" data-filename="' + safeFilename + '" title="Delete this backup from Dropbox" aria-label="Delete ' + safeFilename + '">' +
        '&times;' +
      '</button>' +
    '</div>';
  }).join('');
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
    if (finallyFn) { try { await finallyFn(); } catch (_) { /* ignore */ } }
  }
};

/**
 * Perform a cached-password cloud backup (encrypt + upload, no vault modal).
 */
const _cloudBackupWithCachedPw = (provider, password, btn) =>
  _cloudBtnAction(btn, 'Encrypting\u2026', async (b) => {
    var fileBytes = await vaultEncryptToBytes(password);
    b.textContent = 'Uploading\u2026';
    await cloudUploadVault(provider, fileBytes);
    if (typeof showCloudToast === 'function') showCloudToast('Backup complete.');
    if (typeof showKrakenToastIfFirst === 'function') showKrakenToastIfFirst();
  }, 'Backup failed: ');

/**
 * Perform a cached-password cloud restore (decrypt + restore, no vault modal).
 */
const _cloudRestoreWithCachedPw = async (provider, password, fileBytes) => {
  try {
    if (typeof vaultRestoreWithPreview === 'function') {
      await vaultRestoreWithPreview(fileBytes, password);
      // DiffModal now showing (or fallback applied if unavailable)
    } else {
      await vaultDecryptAndRestore(fileBytes, password);
      if (typeof showCloudToast === 'function') showCloudToast('Restore complete. Reloading\u2026');
      setTimeout(function () { location.reload(); }, 1200);
    }
  } catch (err) {
    appAlert('Decryption failed. Opening password prompt.');
    openVaultModal('cloud-import', {
      provider: provider,
      fileBytes: fileBytes,
    });
  }
};

const bindCloudStorageListeners = () => {
  var panel = document.getElementById('inventoryCloudSection') || document.getElementById('settingsPanel_cloud');
  if (!panel) return;

  // Backup history depth selector
  var historySelect = safeGetElement('cloudBackupHistoryDepth');
  if (historySelect) {
    historySelect.addEventListener('change', function () {
      saveData(CLOUD_BACKUP_HISTORY_KEY, historySelect.value);
    });
  }

  bindCloudCacheListeners();

  var _cloudBtnHandler = async function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var provider = btn.dataset.provider;
    if (!provider) return;

    if (btn.classList.contains('cloud-connect-btn')) {
      if (typeof cloudAuthStart === 'function') cloudAuthStart(provider);

    } else if (btn.classList.contains('cloud-disconnect-btn')) {
      if (typeof cloudDisconnect === 'function') cloudDisconnect(provider);

    } else if (btn.classList.contains('cloud-backup-btn')) {
      await _cloudBtnAction(btn, 'Checking\u2026', async () => {
        var conflict = await cloudCheckConflict(provider);
        if (conflict.conflict) {
          var remoteDate = new Date(conflict.remote.timestamp);
          var remoteItems = Number(conflict.remote.itemCount) || 0;
          var localItems = conflict.local && Number(conflict.local.itemCount) || 0;
          var remoteInfo = remoteDate.toLocaleDateString() + ' ' +
            remoteDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          var localInfo = localItems.toLocaleString() + ' items';
          var remoteLine = 'Remote: ' + remoteItems.toLocaleString() + ' items (' + remoteInfo + ')';
          var localLine = 'Local: ' + localInfo;
          const shouldOverwrite = await appConfirm(
            'A newer remote backup exists.\n\n' +
            remoteLine + '\n' +
            localLine + '\n\n' +
            'Do you want to overwrite the remote backup with current local data?',
            'Cloud Backup Conflict',
          );
          if (!shouldOverwrite) {
            return;
          }
        }
        // Prefer session cache (hot path), fall back to localStorage so Backup
        // works after a page reload without re-prompting when password is already stored.
        var cachedPw = typeof cloudGetCachedPassword === 'function' ? cloudGetCachedPassword(provider) : null;
        if (!cachedPw) cachedPw = localStorage.getItem('cloud_vault_password') || null;
        if (cachedPw) {
          await _cloudBackupWithCachedPw(provider, cachedPw, btn);
          return;
        }
        openVaultModal('cloud-export', { provider: provider });
        if (typeof showKrakenToastIfFirst === 'function') showKrakenToastIfFirst();
      }, 'Conflict check failed: ');

    } else if (btn.classList.contains('cloud-restore-btn')) {
      var listEl = document.getElementById('cloudBackupList_' + provider);
      if (listEl && listEl.style.display !== 'none' && listEl.innerHTML) {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
        return;
      }
      await _cloudBtnAction(btn, 'Loading\u2026', async () => {
        var backups = await cloudListBackups(provider);
        renderCloudBackupList(provider, backups);
      }, 'Failed to list backups: ');

    } else if (btn.classList.contains('cloud-backup-entry')) {
      var filename = btn.dataset.filename;
      var size = parseInt(btn.dataset.size, 10) || 0;
      var sizeStr = size < 1024 ? size + ' B' : size < 1048576 ? (size / 1024).toFixed(0) + ' KB' : (size / 1048576).toFixed(1) + ' MB';
      const restoreConfirmed = await appConfirm(
        `Restore "${filename}" (${sizeStr})?\n\nThis will overwrite all local data.`,
        'Cloud Restore',
      );
      if (!restoreConfirmed) return;
      await _cloudBtnAction(btn, 'Downloading\u2026', async () => {
        var fileBytes = await cloudDownloadVaultByName(provider, filename);
        var savedPw = typeof cloudGetCachedPassword === 'function' ? cloudGetCachedPassword(provider) : null;
        if (savedPw) {
          await _cloudRestoreWithCachedPw(provider, savedPw, fileBytes);
          return;
        }
        openVaultModal('cloud-import', {
          provider: provider,
          fileBytes: fileBytes,
          filename: filename,
          size: size,
        });
      }, 'Download failed: ', async () => {
        var parentList = btn.closest('.cloud-backup-list');
        if (parentList) {
          var refreshed = await cloudListBackups(provider);
          renderCloudBackupList(provider, refreshed);
        }
      });

    } else if (btn.classList.contains('cloud-backup-delete-btn')) {
      var delFilename = btn.dataset.filename;
      if (!await showBulkConfirm('Delete "' + delFilename + '" from cloud storage?\n\nThis cannot be undone.')) return;
      await _cloudBtnAction(btn, '\u2026', async () => {
        await cloudDeleteBackup(provider, delFilename);
        if (typeof showCloudToast === 'function') showCloudToast('"' + delFilename + '" deleted.');
      }, 'Delete failed: ', async () => {
        var parentList = btn.closest('.cloud-backup-list');
        if (parentList) {
          var refreshed = await cloudListBackups(provider);
          renderCloudBackupList(provider, refreshed);
        }
      });
    }
  };

  panel.addEventListener('click', _cloudBtnHandler);

  // Advanced modal is rendered at body level (outside settingsPanel_cloud), so it needs its own listener.
  var advancedModal = document.getElementById('cloudSyncAdvancedModal');
  if (advancedModal) advancedModal.addEventListener('click', _cloudBtnHandler);
};

/**
 * Wires up Market Prices section listeners.
 * Handles coin selector change, timeframe button clicks,
 * History card buttons, and View card buttons.
 */
const bindRetailMarketListeners = () => {
  // Sync Now button
  const syncBtn = getExistingElement('retailSyncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      if (typeof syncRetailPrices === 'function') syncRetailPrices();
    });
  }

  // History coin selector — re-render table when selection changes
  const slugSelect = getExistingElement('retailHistorySlugSelect');
  if (slugSelect) {
    slugSelect.addEventListener('change', () => {
      if (typeof renderRetailHistoryTable === 'function') renderRetailHistoryTable();
    });
  }

  // Timeframe buttons — delegated on the logPanel_market container
  const logPanelMarket = getExistingElement('logPanel_market');
  if (logPanelMarket) {
    logPanelMarket.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-retail-timeframe]');
      if (!btn) return;
      logPanelMarket.querySelectorAll('[data-retail-timeframe]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      if (typeof renderRetailHistoryTable === 'function') renderRetailHistoryTable();
    });
  }

  // History and View card buttons — delegated on retailCardsGrid
  const cardsGrid = getExistingElement('retailCardsGrid');
  if (cardsGrid) {
    cardsGrid.addEventListener('click', (e) => {
      // "History" button — switch to Activity Log market tab and set coin selector
      const histBtn = e.target.closest('[data-retail-history-slug]');
      if (histBtn) {
        const slug = histBtn.dataset.retailHistorySlug;
        const select = getExistingElement('retailHistorySlugSelect');
        if (select) {
          select.value = slug;
        }
        if (typeof switchSettingsSection === 'function') switchSettingsSection('changelog');
        const marketTab = document.querySelector('[data-log-tab="market"]');
        if (marketTab && typeof switchLogTab === 'function') switchLogTab('market');
        return;
      }

      // "View" button — open per-coin detail modal
      const viewBtn = e.target.closest('[data-retail-view-slug]');
      if (viewBtn) {
        const slug = viewBtn.dataset.retailViewSlug;
        if (typeof openRetailViewModal === 'function') openRetailViewModal(slug);
      }
    });
  }
};

/**
 * Wires up Storage section listeners (Refresh button, tiny-key toggle).
 */
const bindStorageListeners = () => {
  // Refresh button
  const refreshBtn = document.getElementById('storageRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (typeof renderStorageSection === 'function') renderStorageSection();
    });
  }

  // Top-level tiny-key toggle
  const topToggle = document.getElementById('storageToggleTiny');
  if (topToggle) {
    topToggle.addEventListener('click', () => {
      if (typeof _handleStorageTinyToggle === 'function') _handleStorageTinyToggle();
    });
  }
};

/**
 * Binds clear buttons for Numista and PCGS response caches (STAK-222).
 */
const bindApiCacheListeners = () => {
  const clearNumistaBtn = safeGetElement('clearNumistaCacheBtn');
  if (clearNumistaBtn) {
    clearNumistaBtn.addEventListener('click', async () => {
      const count = typeof clearNumistaCache === 'function' ? clearNumistaCache() : 0;
      // Also clear IndexedDB sync metadata so next sync re-fetches rather than skipping
      // (bulk sync skip check uses imageCache.getMetadata(), not the localStorage response cache)
      if (window.imageCache && window.BulkImageCache) {
        const eligible = BulkImageCache.buildEligibleList();
        await Promise.all(eligible.map(({ catalogId }) => imageCache.deleteMetadata(catalogId)));
      }
      if (typeof appAlert === 'function') appAlert(`Cleared ${count} Numista cached lookups.`);
      if (typeof renderNumistaSyncUI === 'function') renderNumistaSyncUI();
    });
  }

  const clearPcgsBtn = safeGetElement('clearPcgsCacheBtn');
  if (clearPcgsBtn) {
    clearPcgsBtn.addEventListener('click', () => {
      const count = typeof clearPcgsCache === 'function' ? clearPcgsCache() : 0;
      if (typeof appAlert === 'function') appAlert(`Cleared ${count} PCGS cached lookups.`);
      const countEl = safeGetElement('pcgsResponseCacheCount');
      if (countEl) countEl.textContent = '0';
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
  bindNumistaBulkSyncListeners();
  bindSettingsModalShellListeners();
  bindGoldbackToggleListeners();
  bindGoldbackActionListeners();
  bindImageSettingsListeners();
  bindCloudStorageListeners();
  bindStorageListeners();
  bindRetailMarketListeners();
  bindApiCacheListeners();
};

if (typeof window !== 'undefined') {
  window.setupSettingsEventListeners = setupSettingsEventListeners;
}
