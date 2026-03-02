// INVENTORY FUNCTIONS

/** Weight unit → tooltip label mapping (hoisted to avoid per-row allocation in renderTable) */
const WEIGHT_UNIT_TOOLTIPS = { oz: 'Troy ounces (ozt)', g: 'Grams (g)', kg: 'Kilograms (kg)', lb: 'Pounds (lb)', gb: 'Goldback denomination' };

/** Blob URLs created by _enhanceTableThumbnails — revoked on each re-render */
let _thumbBlobUrls = [];

/**
 * Cached map of inventory items to their original indices.
 * Optimized for O(1) lookup during rendering to avoid O(N) indexOf calls.
 * @type {Map<Object, number>|null}
 */
let _cachedItemIndexMap = null;

/**
 * Invalidates the cached item index map.
 * Should be called whenever the inventory array is mutated (add/remove/reorder).
 */
const invalidateItemIndexMap = () => {
  _cachedItemIndexMap = null;
};

/**
 * Retrieves or builds the cached item index map.
 * @returns {Map<Object, number>} Map of item objects to their indices
 */
const getItemIndexMap = () => {
  if (_cachedItemIndexMap) return _cachedItemIndexMap;

  _cachedItemIndexMap = new Map();
  // Build map: key = item object reference, value = index in main inventory array
  for (let j = 0; j < inventory.length; j++) {
    _cachedItemIndexMap.set(inventory[j], j);
  }
  return _cachedItemIndexMap;
};

window.addEventListener('beforeunload', () => {
  for (const url of _thumbBlobUrls) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
});
/**
 * Creates a comprehensive backup ZIP file containing all application data
 * 
 * This function generates a complete backup archive including:
 * - Current inventory data in JSON format
 * - All export formats (CSV, HTML)
 * - Application settings and configuration
 * - Spot price history
 * - README file explaining backup contents
 * 
 * The backup is packaged as a ZIP file for easy storage and portability.
 * All data is exported in multiple formats to ensure compatibility and
 * provide redundancy for data recovery scenarios.
 * 
 * @returns {void} Downloads a ZIP file containing complete backup
 * 
 * @example
 * // Called to generate a complete backup archive
 * await createBackupZip();
 */
const createBackupZip = async () => {
  try {
    // Show loading indicator
    const backupBtn = document.getElementById('backupAllBtn');
    const originalText = backupBtn ? backupBtn.textContent : '';
    if (backupBtn) {
      backupBtn.textContent = 'Creating Backup...';
      backupBtn.disabled = true;
    }

    // Create new JSZip instance
    const zip = new JSZip();
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const timeFormatted = typeof formatTimestamp === 'function' ? formatTimestamp(new Date()) : new Date().toLocaleString();

    // 1. Add main inventory data (JSON)
    const inventoryData = {
      version: APP_VERSION,
      exportDate: new Date().toISOString(),
      inventory: inventory.map(item => ({
        metal: item.metal,
        composition: item.composition,
        name: item.name,
        qty: item.qty,
        type: item.type,
        weight: item.weight,
        weightUnit: item.weightUnit || 'oz',
        purity: item.purity || 1.0,
        price: item.price,
        date: item.date,
        purchaseLocation: item.purchaseLocation,
        storageLocation: item.storageLocation,
        notes: item.notes,
        spotPriceAtPurchase: item.spotPriceAtPurchase,
        premiumPerOz: item.premiumPerOz,
        totalPremium: item.totalPremium,
        marketValue: item.marketValue || 0,
        numistaId: item.numistaId,
        year: item.year || '',
        grade: item.grade || '',
        gradingAuthority: item.gradingAuthority || '',
        certNumber: item.certNumber || '',
        serialNumber: item.serialNumber || '',
        pcgsNumber: item.pcgsNumber || '',
        pcgsVerified: item.pcgsVerified || false,
        serial: item.serial,
        uuid: item.uuid,
        obverseImageUrl: item.obverseImageUrl || '',
        reverseImageUrl: item.reverseImageUrl || '',
        obverseSharedImageId: item.obverseSharedImageId || null,
        reverseSharedImageId: item.reverseSharedImageId || null
      }))
    };
    zip.file('inventory_data.json', JSON.stringify(inventoryData, null, 2));

    // 2. Add current spot prices, settings, and catalog mappings
    const settings = {
      version: APP_VERSION,
      exportDate: new Date().toISOString(),
      exportOrigin: (typeof window !== 'undefined' && window.location) ? window.location.origin : '',
      spotPrices: spotPrices,
      theme: localStorage.getItem(THEME_KEY) || 'light',
      itemsPerPage: itemsPerPage,
      searchQuery: searchQuery,
      sortColumn: sortColumn,
      sortDirection: sortDirection,
      // Add catalog mappings to settings for backup
      catalogMappings: catalogManager.exportMappings(),
      // Chip grouping settings (v3.16.00+)
      chipCustomGroups: loadDataSync('chipCustomGroups', []),
      chipBlacklist: loadDataSync('chipBlacklist', []),
      chipMinCount: localStorage.getItem('chipMinCount'),
      chipMaxCount: localStorage.getItem('chipMaxCount'),
      featureFlags: localStorage.getItem(FEATURE_FLAGS_KEY),
      // Inline chip config (v3.17.00+)
      inlineChipConfig: localStorage.getItem('inlineChipConfig'),
      // Goldback denomination pricing (STACK-45)
      goldbackPrices: goldbackPrices,
      goldbackPriceHistory: goldbackPriceHistory,
      goldbackEnabled: goldbackEnabled,
      goldbackEstimateEnabled: goldbackEstimateEnabled,
      goldbackEstimateModifier: goldbackEstimateModifier,
      tableImageSides: localStorage.getItem('tableImageSides') || 'both',
      tableImagesEnabled: localStorage.getItem('tableImagesEnabled') !== 'false'
    };
    zip.file('settings.json', JSON.stringify(settings, null, 2));

    // 3. Add spot price history
    const spotHistoryData = {
      version: APP_VERSION,
      exportDate: new Date().toISOString(),
      history: spotHistory
    };
    zip.file('spot_price_history.json', JSON.stringify(spotHistoryData, null, 2));

    // 3a-retail. Add retail market prices (STAK-217)
    const retailPricesData = loadDataSync(RETAIL_PRICES_KEY) || null;
    const retailHistoryData = loadDataSync(RETAIL_PRICE_HISTORY_KEY) || {};
    if (retailPricesData) {
      zip.file('retail_prices.json', JSON.stringify(retailPricesData, null, 2));
    }
    if (Object.keys(retailHistoryData).length > 0) {
      zip.file('retail_price_history.json', JSON.stringify(retailHistoryData, null, 2));
    }

    // 3b. Add per-item price history (STACK-43)
    const itemPriceHistoryData = {
      version: APP_VERSION,
      exportDate: new Date().toISOString(),
      history: itemPriceHistory
    };
    zip.file('item_price_history.json', JSON.stringify(itemPriceHistoryData, null, 2));

    // 3c. Add item tags (STAK-126)
    if (typeof itemTags !== 'undefined' && Object.keys(itemTags).length > 0) {
      const itemTagsData = {
        version: APP_VERSION,
        exportDate: new Date().toISOString(),
        tags: itemTags
      };
      zip.file('item_tags.json', JSON.stringify(itemTagsData, null, 2));
    }

    // 4. Generate and add CSV export (portfolio format)
    const csvHeaders = [
      "Date", "Metal", "Type", "Name", "Qty", "Weight(oz)", "Weight Unit", "Purity",
      "Purchase Price", "Melt Value", "Retail Price", "Gain/Loss",
      "Purchase Location", "N#", "PCGS #", "Serial Number", "Tags", "Notes"
    ];
    const sortedInventory = sortInventoryByDateNewestFirst();
    const csvRows = [];
    for (const item of sortedInventory) {
      const currentSpot = spotPrices[item.metal.toLowerCase()] || 0;
      const valuation = (typeof computeItemValuation === 'function')
        ? computeItemValuation(item, currentSpot)
        : null;
      const purchasePrice = valuation ? valuation.purchasePrice : (typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0);
      const meltValue = valuation ? valuation.meltValue : computeMeltValue(item, currentSpot);
      const gainLoss = valuation ? valuation.gainLoss : null;

      csvRows.push([
        item.date,
        item.metal || 'Silver',
        item.type,
        item.name,
        item.qty,
        parseFloat(item.weight).toFixed(4),
        item.weightUnit || 'oz',
        parseFloat(item.purity) || 1.0,
        formatCurrency(purchasePrice),
        currentSpot > 0 ? formatCurrency(meltValue) : '—',
        formatCurrency(item.marketValue || 0),
        gainLoss !== null ? formatCurrency(gainLoss) : '—',
        item.purchaseLocation,
        item.numistaId || '',
        item.pcgsNumber || '',
        item.serialNumber || '',
        typeof getItemTags === 'function' ? getItemTags(item.uuid).join('; ') : '',
        item.notes || ''
      ]);
    }
    const csvContent = Papa.unparse([csvHeaders, ...csvRows]);
    zip.file('inventory_export.csv', csvContent);

    // 5. Generate and add HTML export (simplified version)
    const htmlContent = generateBackupHtml(sortedInventory, timeFormatted);
    zip.file('inventory_report.html', htmlContent);

    // 7. Add README file
    const readmeContent = generateReadmeContent(timeFormatted);
    zip.file('README.txt', readmeContent);

    // 8. Add sample data for reference
    if (inventory.length > 0) {
      const sampleData = inventory.slice(0, Math.min(5, inventory.length)).map(item => ({
        metal: item.metal,
        name: item.name,
        qty: item.qty,
        type: item.type,
        weight: item.weight,
        weightUnit: item.weightUnit || 'oz',
        purity: item.purity || 1.0,
        price: item.price,
        date: item.date,
        purchaseLocation: item.purchaseLocation,
        storageLocation: item.storageLocation,
        notes: item.notes,
        numistaId: item.numistaId,
        serialNumber: item.serialNumber || '',
        marketValue: item.marketValue || 0,
        serial: item.serial
      }));
      zip.file('sample_data.json', JSON.stringify(sampleData, null, 2));
    }

    // 9. Add cached coin metadata (STACK-88)
    if (window.imageCache?.isAvailable()) {
      const allMeta = await imageCache.exportAllMetadata();
      if (allMeta.length > 0) {
        zip.file('image_metadata.json', JSON.stringify({
          version: APP_VERSION,
          exportDate: new Date().toISOString(),
          count: allMeta.length,
          metadata: allMeta
        }, null, 2));
      }

      // User-uploaded photos (keyed by item UUID) — STAK-225
      const allUserImages = await imageCache.exportAllUserImages();
      if (allUserImages.length > 0) {
        const userImgFolder = zip.folder('user_images');
        const userImageManifest = { version: APP_VERSION, exportDate: new Date().toISOString(), entries: [] };
        for (const rec of allUserImages) {
          if (rec.obverse) userImgFolder.file(`${rec.uuid}_obverse.jpg`, rec.obverse);
          if (rec.reverse) userImgFolder.file(`${rec.uuid}_reverse.jpg`, rec.reverse);
          const item = typeof inventory !== 'undefined' ? inventory.find(i => i.uuid === rec.uuid) : null;
          userImageManifest.entries.push({
            uuid: rec.uuid,
            itemName: item?.name || '',
            hasObverse: !!rec.obverse,
            hasReverse: !!rec.reverse,
            obverseFile: rec.obverse ? `user_images/${rec.uuid}_obverse.jpg` : null,
            reverseFile: rec.reverse ? `user_images/${rec.uuid}_reverse.jpg` : null,
            cachedAt: rec.cachedAt || null,
            size: rec.size || 0,
          });
        }
        zip.file('user_image_manifest.json', JSON.stringify(userImageManifest, null, 2));
      }

      // Custom pattern rule images (keyed by rule ID) — STAK-225
      const allPatternImages = await imageCache.exportAllPatternImages();
      if (allPatternImages.length > 0) {
        const patternImgFolder = zip.folder('pattern_images');
        for (const rec of allPatternImages) {
          if (rec.obverse) patternImgFolder.file(`${rec.ruleId}_obverse.jpg`, rec.obverse);
          if (rec.reverse) patternImgFolder.file(`${rec.ruleId}_reverse.jpg`, rec.reverse);
        }
      }
    }

    // Generate and download the ZIP file
    const zipBlob = await zip.generateAsync({ type: 'blob', streamFiles: true });
    const url = URL.createObjectURL(zipBlob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `precious_metals_backup_${timestamp}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Restore button state
    if (backupBtn) {
      backupBtn.textContent = originalText;
      backupBtn.disabled = false;
    }
    
    appAlert('Backup created successfully!');
  } catch (error) {
    console.error('Backup creation failed:', error);
    appAlert('Backup creation failed: ' + error.message);
    
    // Restore button state on error
    const backupBtn = document.getElementById('backupAllBtn');
    if (backupBtn) {
      backupBtn.textContent = 'Backup All Data';
      backupBtn.disabled = false;
    }
  }
};

/**
 * Restores application data from a backup ZIP file
 *
 * @param {File} file - ZIP file created by createBackupZip
 */
const restoreBackupZip = async (file) => {
  try {
    const zip = await JSZip.loadAsync(file);

    const inventoryStr = await zip.file("inventory_data.json")?.async("string");
    if (inventoryStr) {
      const invObj = JSON.parse(inventoryStr);
      localStorage.setItem(LS_KEY, JSON.stringify(invObj.inventory || []));
    }

    const settingsStr = await zip.file("settings.json")?.async("string");
    if (settingsStr) {
      const settingsObj = JSON.parse(settingsStr);
      if (settingsObj.spotPrices) {
        Object.entries(settingsObj.spotPrices).forEach(([metal, price]) => {
          const metalConfig = METALS[metal.toUpperCase()];
          if (metalConfig) {
            localStorage.setItem(
              metalConfig.localStorageKey,
              JSON.stringify(price),
            );
          }
        });
      }
      if (settingsObj.theme) {
        localStorage.setItem(THEME_KEY, settingsObj.theme);
      }
      
      // Handle catalog mappings if present in backup
      if (settingsObj.catalogMappings) {
        // Use catalog manager to import mappings
        catalogManager.importMappings(settingsObj.catalogMappings, false);
      }

      // Restore chip grouping settings (v3.16.00+)
      if (Array.isArray(settingsObj.chipCustomGroups)) {
        saveDataSync('chipCustomGroups', settingsObj.chipCustomGroups);
      }
      if (Array.isArray(settingsObj.chipBlacklist)) {
        saveDataSync('chipBlacklist', settingsObj.chipBlacklist);
      }
      if (settingsObj.chipMinCount != null) {
        localStorage.setItem('chipMinCount', settingsObj.chipMinCount);
      }
      if (settingsObj.chipMaxCount != null) {
        localStorage.setItem('chipMaxCount', settingsObj.chipMaxCount);
      }
      if (settingsObj.featureFlags != null) {
        localStorage.setItem(FEATURE_FLAGS_KEY, settingsObj.featureFlags);
      }
      // Restore inline chip config (v3.17.00+)
      if (settingsObj.inlineChipConfig != null) {
        localStorage.setItem('inlineChipConfig', settingsObj.inlineChipConfig);
      }
      // Restore Goldback denomination pricing (STACK-45)
      if (settingsObj.goldbackPrices != null) {
        saveDataSync(GOLDBACK_PRICES_KEY, settingsObj.goldbackPrices);
        goldbackPrices = settingsObj.goldbackPrices;
      }
      if (settingsObj.goldbackPriceHistory != null) {
        saveDataSync(GOLDBACK_PRICE_HISTORY_KEY, settingsObj.goldbackPriceHistory);
        goldbackPriceHistory = settingsObj.goldbackPriceHistory;
      }
      if (settingsObj.goldbackEnabled != null) {
        saveDataSync(GOLDBACK_ENABLED_KEY, settingsObj.goldbackEnabled === true);
        goldbackEnabled = settingsObj.goldbackEnabled === true;
      }
      if (settingsObj.goldbackEstimateEnabled != null) {
        saveDataSync(GOLDBACK_ESTIMATE_ENABLED_KEY, settingsObj.goldbackEstimateEnabled === true);
        goldbackEstimateEnabled = settingsObj.goldbackEstimateEnabled === true;
      }
      if (settingsObj.goldbackEstimateModifier != null) {
        const mod = parseFloat(settingsObj.goldbackEstimateModifier);
        if (!isNaN(mod) && mod > 0) {
          saveDataSync(GB_ESTIMATE_MODIFIER_KEY, mod);
          goldbackEstimateModifier = mod;
        }
      }
      // Restore display settings (backed up but previously not restored)
      if (settingsObj.itemsPerPage != null) {
        const ippRestore = settingsObj.itemsPerPage;
        localStorage.setItem(ITEMS_PER_PAGE_KEY, String(ippRestore));
        itemsPerPage = ippRestore === 'all' || ippRestore === Infinity ? Infinity : Number(ippRestore);
      }
      if (settingsObj.sortColumn != null) {
        sortColumn = settingsObj.sortColumn;
      }
      if (settingsObj.sortDirection != null) {
        sortDirection = settingsObj.sortDirection;
      }
      if (settingsObj.tableImageSides != null) {
        localStorage.setItem('tableImageSides', settingsObj.tableImageSides);
      }
      if (settingsObj.tableImagesEnabled != null) {
        localStorage.setItem('tableImagesEnabled', String(settingsObj.tableImagesEnabled));
      }
    }

    const historyStr = await zip
      .file("spot_price_history.json")
      ?.async("string");
    if (historyStr) {
      const histObj = JSON.parse(historyStr);
      localStorage.setItem(
        SPOT_HISTORY_KEY,
        JSON.stringify(histObj.history || []),
      );
    }

    await loadInventory();
    renderTable();
    renderActiveFilters();
    loadSpotHistory();

    // Restore per-item price history with merge (STACK-43)
    const itemHistoryStr = await zip.file("item_price_history.json")?.async("string");
    if (itemHistoryStr) {
      const itemHistObj = JSON.parse(itemHistoryStr);
      if (typeof mergeItemPriceHistory === 'function') {
        mergeItemPriceHistory(itemHistObj.history || {});
      }
    } else if (typeof loadItemPriceHistory === 'function') {
      loadItemPriceHistory();
    }

    // Restore item tags (STAK-126)
    const itemTagsStr = await zip.file("item_tags.json")?.async("string");
    let restoredTags = null;
    if (itemTagsStr) {
      try {
        const itemTagsObj = JSON.parse(itemTagsStr);
        if (itemTagsObj.tags && typeof itemTagsObj.tags === 'object' && !Array.isArray(itemTagsObj.tags)) {
          restoredTags = itemTagsObj.tags;
        }
      } catch (e) {
        debugWarn('restoreBackupZip: item_tags.json parse error', e);
      }
    }
    itemTags = restoredTags || {};
    if (typeof saveItemTags === 'function') saveItemTags();

    // Restore retail market prices
    const retailPricesStr = await zip.file("retail_prices.json")?.async("string");
    if (retailPricesStr) {
      try {
        const retailPricesRestored = JSON.parse(retailPricesStr);
        saveDataSync(RETAIL_PRICES_KEY, retailPricesRestored);
        if (typeof loadRetailPrices === 'function') loadRetailPrices();
      } catch (e) {
        debugWarn('restoreBackupZip: retail_prices.json parse error', e);
      }
    }
    const retailHistoryStr = await zip.file("retail_price_history.json")?.async("string");
    if (retailHistoryStr) {
      try {
        const retailHistoryRestored = JSON.parse(retailHistoryStr);
        if (!Array.isArray(retailHistoryRestored) && typeof retailHistoryRestored === 'object') {
          saveDataSync(RETAIL_PRICE_HISTORY_KEY, retailHistoryRestored);
          if (typeof loadRetailPriceHistory === 'function') loadRetailPriceHistory();
        }
      } catch (e) {
        debugWarn('restoreBackupZip: retail_price_history.json parse error', e);
      }
    }

    // Restore cached coin images (STACK-88)
    if (window.imageCache?.isAvailable()) {
      const imgFolder = zip.folder('images');
      const imgEntries = [];
      if (imgFolder) {
        imgFolder.forEach((path, file) => { imgEntries.push({ path, file }); });
      }

      if (imgEntries.length > 0) {
        // Legacy coinImages from old backups are skipped — no longer importing to dead store
        debugLog('ZIP restore: skipping legacy coinImages folder (store deprecated)');
      }

      // Restore metadata
      const metaStr = await zip.file('image_metadata.json')?.async('string');
      if (metaStr) {
        const metaObj = JSON.parse(metaStr);
        if (Array.isArray(metaObj.metadata)) {
          for (const rec of metaObj.metadata) {
            await imageCache.importMetadataRecord(rec);
          }
        }
      }

      // Restore user-uploaded photos (STAK-225 / STAK-226)
      const userImgFolder = zip.folder('user_images');
      if (userImgFolder) {
        // STAK-226: use manifest when present for reliable UUID→file mapping
        const manifestFile = zip.file('user_image_manifest.json');
        if (manifestFile) {
          const manifestData = JSON.parse(await manifestFile.async('string'));
          for (const entry of (manifestData.entries || [])) {
            const obverseFile = entry.obverseFile ? zip.file(entry.obverseFile) : null;
            const reverseFile = entry.reverseFile ? zip.file(entry.reverseFile) : null;
            const obverse = obverseFile ? await obverseFile.async('blob') : null;
            const reverse = reverseFile ? await reverseFile.async('blob') : null;
            await imageCache.importUserImageRecord({
              uuid: entry.uuid,
              obverse,
              reverse,
              cachedAt: entry.cachedAt || Date.now(),
              size: entry.size || (obverse?.size || 0) + (reverse?.size || 0),
            });
          }
        } else {
          // Fallback: filename parsing for ZIPs created before STAK-226
          const userEntries = [];
          userImgFolder.forEach((path, file) => userEntries.push({ path, file }));
          const userImageMap = new Map();
          for (const { path, file } of userEntries) {
            const m = path.match(/^(.+)_(obverse|reverse)\.jpg$/);
            if (!m) continue;
            if (!userImageMap.has(m[1])) userImageMap.set(m[1], {});
            userImageMap.get(m[1])[m[2]] = await file.async('blob');
          }
          for (const [uuid, sides] of userImageMap) {
            await imageCache.importUserImageRecord({
              uuid,
              obverse: sides.obverse || null,
              reverse: sides.reverse || null,
              cachedAt: Date.now(),
              size: (sides.obverse?.size || 0) + (sides.reverse?.size || 0),
            });
          }
        }
      }

      // Restore custom pattern rule images (STAK-225)
      const patternImgFolder = zip.folder('pattern_images');
      if (patternImgFolder) {
        const patternEntries = [];
        patternImgFolder.forEach((path, file) => patternEntries.push({ path, file }));
        const patternImageMap = new Map();
        for (const { path, file } of patternEntries) {
          const m = path.match(/^(.+)_(obverse|reverse)\.jpg$/);
          if (!m) continue;
          if (!patternImageMap.has(m[1])) patternImageMap.set(m[1], {});
          patternImageMap.get(m[1])[m[2]] = await file.async('blob');
        }
        for (const [ruleId, sides] of patternImageMap) {
          await imageCache.importPatternImageRecord({
            ruleId,
            obverse: sides.obverse || null,
            reverse: sides.reverse || null,
            cachedAt: Date.now(),
            size: (sides.obverse?.size || 0) + (sides.reverse?.size || 0),
          });
        }
      }
    }

    fetchSpotPrice();
    await appAlert("Data imported successfully. The page will now reload.");
    location.reload();
  } catch (err) {
    console.error("Restore failed", err);
    appAlert("Restore failed: " + err.message);
  }
};

window.restoreBackupZip = restoreBackupZip;

/**
 * Generates HTML content for backup export
 * 
 * @param {Array} sortedInventory - Sorted inventory data
 * @param {string} timeFormatted - Formatted timestamp
 * @returns {string} HTML content
 */
const generateBackupHtml = (sortedInventory, timeFormatted) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StakTrakr Backup</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    h1 { color: #2563eb; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #f2f2f2; }
    .backup-info { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <h1>StakTrakr Backup</h1>
  <div class="backup-info">
    <strong>Backup Created:</strong> ${timeFormatted}<br>
    <strong>Application Version:</strong> ${APP_VERSION}<br>
    <strong>Total Items:</strong> ${sortedInventory.length}<br>
    <strong>Archive Contents:</strong> Complete inventory data, settings, and spot price history
  </div>
  <table>
    <thead>
      <tr>
        <th>Composition</th><th>Name</th><th>Qty</th><th>Type</th><th>Weight</th>
        <th>Purchase Price</th><th>Purchase Location</th><th>Storage Location</th>
        <th>Notes</th><th>Date</th>
      </tr>
    </thead>
    <tbody>
      ${sortedInventory.map(item => `
        <tr>
          <td>${getCompositionFirstWords(item.composition || item.metal)}</td>
          <td>${item.name}</td>
          <td>${item.qty}</td>
          <td>${item.type}</td>
          <td>${formatWeight(item.weight, item.weightUnit)}</td>
          <td>${formatCurrency(item.price)}</td>
          <td>${item.purchaseLocation}</td>
          <td>${item.storageLocation || ''}</td>
          <td>${item.notes || ''}</td>
          <td>${item.date}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>
</body>
</html>`;
};

/**
 * Generates README content for backup archive
 * 
 * @param {string} timeFormatted - Formatted timestamp
 * @returns {string} README content
 */
const generateReadmeContent = (timeFormatted) => {
  return `PRECIOUS METALS INVENTORY TOOL - BACKUP ARCHIVE
===============================================

Backup Created: ${timeFormatted}
Application Version: ${APP_VERSION}
Total Items: ${inventory.length}

FILE CONTENTS:
--------------

1. inventory_data.json
   - Complete inventory data in JSON format
   - Includes all item details, notes, and metadata
   - Primary data file for restoration

2. settings.json
   - Application configuration and preferences
   - Current spot prices and user settings
   - UI state (pagination, search, sorting)

3. spot_price_history.json
   - Historical spot price data and tracking
   - API sync records and manual overrides
   - Price trend information

4. inventory_export.csv
   - Spreadsheet-compatible export
   - Human-readable format for external use

5. inventory_report.html
   - Self-contained web page report
   - No external dependencies required
   - Print-friendly format

6. sample_data.json (if applicable)
   - Sample of inventory items for reference
   - Useful for testing import functionality
   - Demonstrates data structure

7. README.txt (this file)
   - Backup contents explanation
   - Restoration instructions

8. images/ (if coin images are cached)
   - Cached coin images as JPEG files
   - Named {catalogId}_obverse.jpg / {catalogId}_reverse.jpg
   - Automatically restored when importing backup

9. image_metadata.json (if coin images are cached)
   - Enriched Numista metadata for cached coins
   - Restored alongside images for offline viewing

10. user_image_manifest.json (if user-uploaded photos exist)
   - Links each photo to its item UUID and name
   - Used by the importer for reliable restore; human-readable
   - Falls back to filename parsing for ZIPs without this file

RESTORATION INSTRUCTIONS:
------------------------

1. For complete restoration:
   - Import inventory_data.json using the application's JSON import feature
   - Manually configure spot prices from settings.json if needed

2. For partial restoration:
   - Use inventory_export.csv for spreadsheet applications
   - View inventory_report.html in any web browser

3. For data analysis:
   - All files contain the same core data in different formats
   - Choose the format best suited for your analysis tools

SUPPORT:
--------

For questions about this backup or the StakTrakr application:
- Check the application documentation
- Verify file integrity before restoration
- Test imports with sample data first

This backup contains your complete precious metals inventory as of ${timeFormatted}.
Store this archive in a secure location for data protection.

--- End of README ---`;
};

// =============================================================================

// Note: catalogMap is now managed by catalogManager class
// No need for the global catalogMap variable anymore

const getNextSerial = () => {
  const next = (parseInt(localStorage.getItem(SERIAL_KEY) || '0', 10) + 1);
  localStorage.setItem(SERIAL_KEY, next);
  return next;
};
window.getNextSerial = getNextSerial;

/**
 * Saves current inventory to localStorage
 */
const saveInventory = async () => {
  // Invalidate cached index map as inventory has likely changed
  invalidateItemIndexMap();

  await saveData(LS_KEY, inventory);
  // CatalogManager handles its own saving, no need to explicitly save catalogMap
  // STACK-62: Invalidate autocomplete cache so lookup table rebuilds with current inventory
  if (typeof clearLookupCache === 'function') clearLookupCache();
  // STAK-149: Trigger debounced cloud auto-sync push (no-op if sync disabled or not connected)
  if (typeof scheduleSyncPush === 'function') scheduleSyncPush();
};

/**
 * Removes non-alphanumeric characters from inventory records.
 *
 * @returns {void}
 */
const sanitizeTablesOnLoad = () => {
  inventory = inventory.map(item => sanitizeObjectFields(item));
  invalidateItemIndexMap();
};

/**
 * Loads inventory from localStorage with comprehensive data migration
 * 
 * This function handles backwards compatibility by:
 * - Loading existing inventory data from localStorage
 * - Migrating legacy records that may be missing newer fields
 * - Calculating premiums for older records that lack this data
 * - Ensuring all records have required fields with sensible defaults
 * - Preserving existing user data while adding new functionality
 * 
 * @returns {void} Updates the global inventory array with migrated data
 * @throws {Error} Logs errors to console if localStorage access fails
 */
const loadInventory = async () => {
  try {
    const data = await loadData(LS_KEY, []);
    
    // Ensure data is an array
    if (!Array.isArray(data)) {
      console.warn('Inventory data is not an array, resetting to empty array');
      inventory = [];
      invalidateItemIndexMap();
      return;
    }

    // Migrate legacy data to include new fields
    inventory = data.map(item => {
    let normalized;
    // Handle legacy data that might not have all fields
    if (item.premiumPerOz === undefined) {
      // For legacy items, calculate premium if possible
      const metalConfig = Object.values(METALS).find(m => m.name === item.metal) || METALS.SILVER;
      const spotPrice = spotPrices[metalConfig.key];

      const premiumPerOz = spotPrice > 0 ? (item.price / item.weight) - spotPrice : 0;
      const totalPremium = premiumPerOz * item.qty * item.weight;

      normalized = {
        ...item,
        type: normalizeType(item.type),
        purchaseLocation: item.purchaseLocation || "",
        storageLocation: item.storageLocation || "Unknown",
        notes: item.notes || "",
        marketValue: item.marketValue || 0,
        year: item.year || item.issuedYear || "",
        grade: item.grade || '',
        gradingAuthority: item.gradingAuthority || '',
        certNumber: item.certNumber || '',
        pcgsNumber: item.pcgsNumber || '',
        pcgsVerified: item.pcgsVerified || false,
        spotPriceAtPurchase: spotPrice,
        premiumPerOz,
        totalPremium,
        composition: item.composition || item.metal || "",
        purity: parseFloat(item.purity) || 1.0
      };
    } else {
      // Ensure all items have required properties
      normalized = {
        ...item,
        type: normalizeType(item.type),
        purchaseLocation: item.purchaseLocation || "",
        storageLocation: item.storageLocation || "Unknown",
        notes: item.notes || "",
        marketValue: item.marketValue || 0,
        year: item.year || item.issuedYear || "",
        grade: item.grade || '',
        gradingAuthority: item.gradingAuthority || '',
        certNumber: item.certNumber || '',
        pcgsNumber: item.pcgsNumber || '',
        pcgsVerified: item.pcgsVerified || false,
        composition: item.composition || item.metal || "",
        purity: parseFloat(item.purity) || 1.0
      };
    }
    return sanitizeImportedItem(normalized);
  });

  let serialCounter = parseInt(localStorage.getItem(SERIAL_KEY) || '0', 10);
  
  // Process each inventory item: assign serials and sync with catalog manager
  inventory.forEach(item => {
    // Assign serial numbers to items that don't have them
    if (!item.serial) {
      serialCounter += 1;
      item.serial = serialCounter;
    }

    // Assign UUIDs to items that don't have them (migration for existing data)
    if (!item.uuid) {
      item.uuid = generateUUID();
    }

    // Use CatalogManager to synchronize numistaId
    catalogManager.syncItem(item);
  });
  
  // Save updated serial counter
  localStorage.setItem(SERIAL_KEY, serialCounter);
  
  // Clean up any orphaned catalog mappings
  if (typeof catalogManager.cleanupOrphans === 'function') {
    const removed = catalogManager.cleanupOrphans(inventory);
    if (removed > 0 && DEBUG) {
      console.log(`Removed ${removed} orphaned catalog mappings`);
    }
  }

  // Invalidate cache after loading fresh data
  invalidateItemIndexMap();
  } catch (error) {
    console.error('Error loading inventory:', error);
    inventory = [];
    invalidateItemIndexMap();
  }
};

/**
 * Renders the main inventory table with all current display settings
 * 
 * This is the primary display function that:
 * - Applies current search filters to inventory data
 * - Sorts data according to user-selected column and direction
 * - Implements pagination to show only current page items
 * - Generates HTML table rows with interactive elements
 * - Updates sort indicators in column headers
 * - Refreshes pagination controls and summary totals
 * - Re-establishes column resizing functionality
 * 
 * Called whenever inventory data changes or display settings update
 * 
 * @returns {void} Updates DOM elements with fresh inventory display
 */
const METAL_COLORS = {
  Silver: 'var(--silver)',
  Gold: 'var(--gold)',
  Platinum: 'var(--platinum)',
  Palladium: 'var(--palladium)'
};

const METAL_TEXT_COLORS = {
  Silver: () => getContrastColor(getComputedStyle(document.documentElement).getPropertyValue('--silver').trim()),
  Gold: () => getContrastColor(getComputedStyle(document.documentElement).getPropertyValue('--gold').trim()),
  Platinum: () => getContrastColor(getComputedStyle(document.documentElement).getPropertyValue('--platinum').trim()),
  Palladium: () => getContrastColor(getComputedStyle(document.documentElement).getPropertyValue('--palladium').trim())
};

const typeColors = {
  Coin: 'var(--type-coin-bg)',
  Round: 'var(--type-round-bg)',
  Bar: 'var(--type-bar-bg)',
  Note: 'var(--type-note-bg)',
  Set: 'var(--type-set-bg)',
  Other: 'var(--type-other-bg)'
};
const purchaseLocationColors = {};
const storageLocationColors = {};
const nameColors = {};
const dateColors = {};

const getColor = (map, key) => {
  if (!(key in map)) {
    // Use a simple hash function based on the key itself to ensure consistent colors
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    map[key] = Math.abs(hash) % 360; // Use hash for hue distribution
  }
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const lightness = isDark ? 65 : 35;
  return `hsl(${map[key]}, 70%, ${lightness}%)`;
};

/**
 * Escapes special characters for safe inclusion in HTML attributes
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for attribute usage
 */
const escapeAttribute = (text) =>
  text
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const filterLink = (field, value, color, displayValue = value, title, allowHtml = false) => {
  const handler = `applyColumnFilter('${field}', ${JSON.stringify(value)})`;
  // Escape characters for safe inline handler usage
  const escaped = escapeAttribute(handler);
  const displayStr = String(displayValue);
  const safe = allowHtml ? displayStr : sanitizeHtml(displayStr);
  const titleStr = title ? String(title) : `Filter by ${displayStr}`;
  const safeTitle = sanitizeHtml(titleStr);
  const isNA = displayStr === 'N/A' || displayStr === 'Numista Import' || displayStr === 'Unknown' || displayStr === '—';
  const classNames = `filter-text${isNA ? ' na-value' : ''}`;
  const styleAttr = isNA ? '' : ` style="color: ${color};"`;
  return `<span class="${classNames}"${styleAttr} onclick="${escaped}" tabindex="0" role="button" onkeydown="if(event.key==='Enter'||event.key===' ')${escaped}" title="${safeTitle}">${safe}</span>`;
};

const getTypeColor = type => typeColors[type] || 'var(--type-other-bg)';
const getPurchaseLocationColor = loc => getColor(purchaseLocationColors, loc);
const getStorageLocationColor = loc =>
  (loc === 'Unknown' || loc === '—') ? 'var(--text-muted)' : getColor(storageLocationColors, loc);

/**
 * Formats Purchase Location for table display, wrapping URLs in hyperlinks
 * while preserving filter behavior.
 *
 * @param {string} loc - Purchase location value
 * @returns {string} HTML string for table cell
 */
const formatPurchaseLocation = (loc) => {
  let value = loc || '—';

  // Convert "Numista Import" and "Unknown" to "—"
  if (value === 'Numista Import' || value === 'Unknown') {
    value = '—';
  }

  const urlPattern = /^(https?:\/\/)?[\w.-]+\.[A-Za-z]{2,}(\S*)?$/;
  const isUrl = urlPattern.test(value);

  // Strip domain suffix for display only (keep full value for filter + href)
  let displayValue = value;
  if (isUrl) {
    displayValue = value
      .replace(/^(https?:\/\/)?(www\.)?/i, '')
      .replace(/\.(com|net|org|co|io|us|uk|ca|au|de|fr|shop|store)\/?.*$/i, '');
  }

  const truncated = displayValue.length > 18 ? displayValue.substring(0, 18) + '…' : displayValue;
  const color = getPurchaseLocationColor(value);
  const filterSpan = filterLink('purchaseLocation', value, color, truncated, value !== truncated ? value : undefined);

  if (isUrl) {
    let href = value;
    if (!/^https?:\/\//i.test(href)) {
      href = `https://${href}`;
    }
    const safeHref = escapeAttribute(href);
    return `<a href="#" onclick="event.stopPropagation(); window.open('${safeHref}', '_blank', 'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no'); return false;" class="purchase-link" title="${safeHref}">
      <svg class="purchase-link-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style="width: 12px; height: 12px; fill: currentColor; margin-right: 4px;" aria-hidden="true">
        <path d="M14,3V5H17.59L7.76,14.83L9.17,16.24L19,6.41V10H21V3M19,19H5V5H12V3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V12H19V19Z"/>
      </svg>
    </a>${filterSpan}`;
  }
  return filterSpan;
};
window.formatPurchaseLocation = formatPurchaseLocation;

/**
 * Formats Storage Location for table display with truncation
 * @param {string} loc - Storage location value
 * @returns {string} HTML string for table cell
 */
const formatStorageLocation = (loc) => {
  let value = loc || '—';
  
  // Convert "Numista Import" and "Unknown" to "—"
  if (value === 'Numista Import' || value === 'Unknown') {
    value = '—';
  }
  
  // Truncate at 25 characters
  const truncated = value.length > 25 ? value.substring(0, 25) + '…' : value;
  const color = getStorageLocationColor(value);
  return filterLink('storageLocation', value, color, truncated, value !== truncated ? value : undefined);
};

/**
 * Recalculates premium values for an inventory item
 * Legacy premiums are no longer displayed — this is now a no-op stub
 * kept to prevent runtime errors from stale references.
 * @param {Object} item - Inventory item (unused)
 */
const recalcItem = (item) => {
  // No-op: premium calculations removed in portfolio redesign
};

/**
 * Saves inventory and refreshes table display
 */
const persistInventoryAndRefresh = () => {
  saveInventory();
  renderTable();
};

/**
 * Updates the displayed inventory item count based on active filters
 *
 * @param {number} filteredCount - Items matching current filters
 * @param {number} totalCount - Total items in inventory
 */
const updateItemCount = (filteredCount, totalCount) => {
  if (!elements.itemCount) return;
  elements.itemCount.textContent =
    filteredCount === totalCount
      ? `${totalCount} items`
      : `${filteredCount} of ${totalCount} items`;
};

/**
 * Enhanced validation for inline edits with comprehensive field support
 * @param {string} field - Field being edited
 * @param {string} value - Proposed value
 * @returns {boolean} Whether value is valid
 */
const validateFieldValue = (field, value) => {
  const trimmedValue = typeof value === 'string' ? value.trim() : String(value).trim();
  
  switch (field) {
    case 'qty':
      const qty = parseInt(value, 10);
      return /^\d+$/.test(value) && qty > 0 && qty <= 999999;
      
    case 'weight':
      const weight = parseFloat(value);
      return !isNaN(weight) && weight > 0 && weight <= 999999;
      
    case 'price':
    case 'marketValue':
      const price = parseFloat(value);
      return !isNaN(price) && price >= 0 && price <= 999999999;
      
    case 'name':
      return trimmedValue.length > 0 && trimmedValue.length <= 200;
      
    case 'purchaseLocation':
    case 'storageLocation':
      return trimmedValue.length <= 100; // Allow empty for optional fields
      
    case 'notes':
      return trimmedValue.length <= 1000; // Allow long notes but with limit
      
    case 'date':
      if (!trimmedValue) return false;
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(trimmedValue)) return false;
      const date = new Date(trimmedValue);
      const today = new Date();
      const minDate = new Date('1900-01-01');
      return date >= minDate && date <= today;
      
    case 'type':
      const validTypes = ['Coin', 'Bar', 'Round', 'Note', 'Aurum', 'Set', 'Other'];
      return validTypes.includes(trimmedValue);
      
    case 'metal':
      const validMetals = ['Silver', 'Gold', 'Platinum', 'Palladium'];
      return validMetals.includes(trimmedValue);
      
    default:
      return true;
  }
};

/**
 * Enhanced inline editing for table cells with support for multiple field types
 * @param {number} idx - Index of item to edit
 * @param {string} field - Field name to update
 * @param {HTMLElement} element - The td cell or a child element within it
 */
const startCellEdit = (idx, field, element) => {
  const td = element.tagName === 'TD' ? element : element.closest('td');
  const item = inventory[idx];
  const current = item[field] ?? '';
  const originalContent = td.innerHTML;
  
  // Close any other open editors (fix for closing all editors issue)
  const allOpenEditors = document.querySelectorAll('td.editing');
  allOpenEditors.forEach(editor => {
    if (editor !== td) {
      const cancelBtn = editor.querySelector('.cancel-inline');
      if (cancelBtn) cancelBtn.click();
    }
  });
  
  td.classList.add('editing');
  
  let input;
  
  // Create appropriate input type based on field
  if (['type', 'metal'].includes(field)) {
    input = document.createElement('select');
    input.className = 'inline-select';
    
    if (field === 'type') {
      const types = ['Coin', 'Bar', 'Round', 'Note', 'Aurum', 'Set', 'Other'];
      types.forEach(type => {
        const option = document.createElement('option');
        option.value = type;
        option.textContent = type;
        if (type === current) option.selected = true;
        input.appendChild(option);
      });
    } else if (field === 'metal') {
      const metals = ['Silver', 'Gold', 'Platinum', 'Palladium', 'Alloy/Other'];
      metals.forEach(metal => {
        const option = document.createElement('option');
        option.value = metal;
        option.textContent = metal;
        if (metal === current) option.selected = true;
        input.appendChild(option);
      });
    }
  } else {
    input = document.createElement('input');
    input.className = 'inline-input';
    
    if (field === 'qty') {
      input.type = 'number';
      input.step = '1';
      input.min = '1';
    } else if (['weight', 'price', 'marketValue'].includes(field)) {
      input.type = 'number';
      input.step = '0.01';
      input.min = '0';
    } else if (field === 'date') {
      input.type = 'date';
    } else {
      input.type = 'text';
    }
    
    // Set input value based on field type
    if (field === 'weight' && item.weightUnit === 'kg') {
      input.value = oztToKg(current).toFixed(4);
      input.dataset.unit = 'kg';
    } else if (field === 'weight' && item.weightUnit === 'lb') {
      input.value = oztToLb(current).toFixed(4);
      input.dataset.unit = 'lb';
    } else if (field === 'weight' && (item.weightUnit === 'g' || item.weight < 1)) {
      input.value = oztToGrams(current).toFixed(2);
      input.dataset.unit = 'g';
    } else if (['weight', 'price', 'marketValue'].includes(field)) {
      input.value = parseFloat(current || 0).toFixed(2);
      if (field === 'weight') input.dataset.unit = 'oz';
    } else {
      input.value = current;
    }
  }
  
  td.innerHTML = '';
  td.appendChild(input);

  const cancelEdit = () => {
    td.classList.remove('editing');
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    td.innerHTML = originalContent;
  };

  const saveEdit = () => {
    const value = input.value;
    if (!validateFieldValue(field, value)) {
      appAlert(`Invalid value for ${field}`);
      cancelEdit();
      return;
    }

    let finalValue;
    if (field === 'qty') {
      finalValue = parseInt(value, 10);
    } else if (['weight', 'price', 'marketValue'].includes(field)) {
      finalValue = parseFloat(value);
      if (field === 'weight' && input.dataset.unit === 'g') {
        finalValue = gramsToOzt(finalValue);
      } else if (field === 'weight' && input.dataset.unit === 'kg') {
        finalValue = kgToOzt(finalValue);
      } else if (field === 'weight' && input.dataset.unit === 'lb') {
        finalValue = lbToOzt(finalValue);
      }
    } else {
      finalValue = value.trim();
    }

    // Store the old value for change logging
    const oldValue = item[field];
    item[field] = finalValue;

    // Log the change
    if (typeof logChange === 'function') {
      logChange(item.name || `Item ${idx + 1}`, field, oldValue, finalValue, idx);
    }

    saveInventory();

    // Record price data point for inline edits on price-related fields (STACK-43)
    if (typeof recordSingleItemPrice === 'function' &&
        ['price', 'marketValue', 'weight', 'qty'].includes(field)) {
      recordSingleItemPrice(item, 'edit');
    }

    renderTable();
  };

  // Keyboard-only: Enter saves, Escape cancels
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });

  // Cancel on blur (clicking away from the input)
  input.addEventListener('blur', () => {
    cancelEdit();
  });

  input.focus();
  if (input.select) input.select();
};

window.startCellEdit = startCellEdit;



/**
 * Hides table columns that contain no data after filtering.
 */
const hideEmptyColumns = () => {
  if (typeof document === 'undefined') return;
  const headers = document.querySelectorAll('#inventoryTable thead th[data-column]');
  headers.forEach(header => {
    const col = header.getAttribute('data-column');
    const cells = document.querySelectorAll(`#inventoryTable tbody [data-column="${col}"]`);
    const allEmpty = cells.length > 0 && Array.from(cells).every(cell => {
      // If the cell contains interactive or icon elements, consider it non-empty
      if (cell.querySelector && (cell.querySelector('svg') || cell.querySelector('button') || cell.querySelector('.action-icon') || cell.querySelector('img'))) {
        return false;
      }
      return cell.textContent.trim() === '';
    });

    document.querySelectorAll(`#inventoryTable [data-column="${col}"]`).forEach(el => {
      el.classList.toggle('hidden-empty', allEmpty);
    });
  });
};

/** IntersectionObserver instance for lazy-loading table thumbnails */
let _thumbObserver = null;

// Metal-colored SVG placeholder cache (one per metal+type combo)
const _thumbPlaceholders = {};

/**
 * Generate an inline SVG data URI for a metal-themed placeholder thumbnail.
 * Uses the metal's brand color and an icon based on item type (coin vs bar).
 * @param {string} metal - Metal name (Silver, Gold, Platinum, Palladium)
 * @param {string} type - Item type (Coin, Bar, Round, etc.)
 * @returns {string} data:image/svg+xml URI
 */
function _getThumbPlaceholder(metal, type) {
  const key = (metal || 'Silver') + ':' + (type || 'Coin');
  if (_thumbPlaceholders[key]) return _thumbPlaceholders[key];

  // Metal color palette (matches CSS custom properties)
  const colors = {
    Silver:    { fill: '#a8b5c4', stroke: '#8a9bb0', text: '#6b7d91' },
    Gold:      { fill: '#d4a74a', stroke: '#b8912e', text: '#9a7a24' },
    Platinum:  { fill: '#b8c5d6', stroke: '#95a8bd', text: '#7b8fa5' },
    Palladium: { fill: '#c2b8a3', stroke: '#a89e8a', text: '#8e846f' },
  };
  const c = colors[metal] || colors.Silver;

  // Icon path: coin (circle) for most types, rectangle for bars
  const isBar = /bar|ingot/i.test(type || '');
  const icon = isBar
    ? `<rect x="11" y="7" width="10" height="18" rx="1.5" fill="none" stroke="${c.text}" stroke-width="1.5" opacity="0.5"/><line x1="13" y1="12" x2="19" y2="12" stroke="${c.text}" stroke-width="0.8" opacity="0.4"/><line x1="13" y1="15" x2="19" y2="15" stroke="${c.text}" stroke-width="0.8" opacity="0.4"/><line x1="13" y1="18" x2="19" y2="18" stroke="${c.text}" stroke-width="0.8" opacity="0.4"/>`
    : `<circle cx="16" cy="16" r="8" fill="none" stroke="${c.text}" stroke-width="1.2" opacity="0.45"/><circle cx="16" cy="16" r="5" fill="none" stroke="${c.text}" stroke-width="0.8" opacity="0.3" stroke-dasharray="2 2"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1" opacity="0.25"/>
    ${icon}
  </svg>`;

  const uri = 'data:image/svg+xml,' + encodeURIComponent(svg);
  _thumbPlaceholders[key] = uri;
  return uri;
}

/**
 * Upgrades table thumbnail src attributes from IDB blob URLs using
 * IntersectionObserver for viewport-based lazy loading.
 * Pre-loads 200px before viewport for smooth scrolling.
 */
async function _enhanceTableThumbnails() {
  if (!featureFlags.isEnabled('COIN_IMAGES') || !window.imageCache?.isAvailable()) return;

  // Respect table images toggle (default ON)
  if (localStorage.getItem('tableImagesEnabled') === 'false') return;

  // Disconnect previous observer to avoid observing stale nodes
  if (_thumbObserver) _thumbObserver.disconnect();

  _thumbObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      _thumbObserver.unobserve(entry.target);
      _loadThumbImage(entry.target);
    }
  }, { rootMargin: '200px 0px' });

  document.querySelectorAll('#inventoryTable .table-thumb').forEach(img => {
    _thumbObserver.observe(img);
  });
}

/**
 * Resolve and set blob URL for a single table thumbnail image.
 * Checks IDB cache (user uploads → pattern images → Numista cache).
 * Falls back to a metal-colored SVG placeholder when no image is available.
 * @param {HTMLImageElement} img - Table thumbnail element with data attributes
 */
async function _loadThumbImage(img) {
  try {
    const item = {
      uuid: img.dataset.itemUuid || '',
      numistaId: img.dataset.catalogId || '',
      name: img.dataset.itemName || '',
      metal: img.dataset.itemMetal || '',
      type: img.dataset.itemType || '',
    };

    const side = img.dataset.side || 'obverse';

    // Resolve CDN URL from inventory item
    const row = img.closest('tr');
    const idx = row?.dataset?.idx;
    let cdnUrl = '';
    if (idx !== undefined) {
      const invItem = inventory[parseInt(idx, 10)];
      if (invItem) {
        const urlKey = side === 'reverse' ? 'reverseImageUrl' : 'obverseImageUrl';
        cdnUrl = (invItem[urlKey] && /^https?:\/\/.+\..+/i.test(invItem[urlKey])) ? invItem[urlKey] : '';
      }
    }

    const blobUrl = await imageCache.resolveImageUrlForItem(item, side);
    if (blobUrl) {
      _thumbBlobUrls.push(blobUrl);
      img.onerror = () => {
        img.onerror = null;
        // Stale/revoked blob — fall through to CDN URL or placeholder
        if (cdnUrl) {
          img.src = cdnUrl;
        } else {
          img.src = _getThumbPlaceholder(item.metal, item.type);
          img.classList.add('table-thumb-placeholder');
        }
      };
      img.src = blobUrl;
      img.style.visibility = '';
      return;
    }

    // Fallback: CDN URL
    if (cdnUrl) {
      img.src = cdnUrl;
      img.style.visibility = '';
      return;
    }

    // No cached image, no CDN URL — show metal-themed placeholder
    img.src = _getThumbPlaceholder(item.metal, item.type);
    img.style.visibility = '';
    img.classList.add('table-thumb-placeholder');
  } catch { /* ignore — IDB unavailable or entry missing */ }
}

const renderTable = () => {
  return monitorPerformance(() => {
    // Ensure filterInventory is available (search.js may still be loading)
    const filteredInventory = typeof filterInventory === 'function' ? filterInventory() : inventory;
    updateItemCount(filteredInventory.length, inventory.length);
    const sortedInventory = sortInventory(filteredInventory);
    debugLog('renderTable start', sortedInventory.length, 'items');

    // STAK-131: Card sort bar + card view rendering branch
    const cardSortBar = document.getElementById('cardSortBar');
    const footerSelect = document.querySelector('.table-footer-controls select');
    if (typeof isCardViewActive === 'function' && isCardViewActive()) {
      const cardGrid = safeGetElement('cardViewGrid');
      const portalScroll = document.querySelector('.portal-scroll');
      if (cardGrid) {
        cardGrid.style.display = 'flex';
        if (portalScroll) portalScroll.style.display = 'none';
        // Show card sort bar and keep pagination dropdown visible
        if (cardSortBar) cardSortBar.style.display = 'flex';
        if (footerSelect) footerSelect.style.display = '';
        if (typeof initCardSortBar === 'function') initCardSortBar();
        if (typeof updateCardSortBar === 'function') updateCardSortBar();

        // Optimization: Pass cached index map for O(1) index lookups in card view
        const itemIndexMap = getItemIndexMap();
        renderCardView(sortedInventory, cardGrid, itemIndexMap);
        bindCardClickHandler(cardGrid);

        // Defer portal height calc to next frame so cards have their layout
        requestAnimationFrame(() => updatePortalHeight());
        updateSummary();
        return;
      }
    }

    // Ensure table is visible when not in card view
    const cardGridEl = safeGetElement('cardViewGrid');
    const portalScrollEl = document.querySelector('.portal-scroll');
    if (cardGridEl) {
      cardGridEl.style.display = 'none';
      cardGridEl.style.maxHeight = '';
      cardGridEl.style.overflowY = '';
    }
    if (portalScrollEl) portalScrollEl.style.display = '';
    // Hide card sort bar and show pagination dropdown
    if (cardSortBar) cardSortBar.style.display = 'none';
    if (footerSelect) footerSelect.style.display = '';

    const rows = [];
    const chipConfig = typeof getInlineChipConfig === 'function' ? getInlineChipConfig() : [];

    // Optimization: Use cached map for O(1) index lookup instead of O(N) indexOf in the loop
    const itemIndexMap = getItemIndexMap();

    // Optimization: Hoist localStorage reads out of the render loop (up to 5,000x fewer reads per render)
    const _tableImagesOnSetting = localStorage.getItem('tableImagesEnabled') !== 'false';
    const _tableImageSidesSetting = localStorage.getItem('tableImageSides') || 'both';

    for (let i = 0; i < sortedInventory.length; i++) {
      const item = sortedInventory[i];
      const originalIdx = itemIndexMap.get(item);
      debugLog('renderTable row', i, item.name);

      // Portfolio computed values (all financial columns are qty-adjusted totals)
      const currentSpot = spotPrices[item.metal.toLowerCase()] || 0;
      const valuation = (typeof computeItemValuation === 'function')
        ? computeItemValuation(item, currentSpot)
        : null;
      const purchasePrice = valuation ? valuation.purchasePrice : (typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0);
      const meltValue = valuation ? valuation.meltValue : computeMeltValue(item, currentSpot);
      const gbDenomPrice = valuation ? valuation.gbDenomPrice : null;
      const isManualRetail = valuation ? valuation.isManualRetail : false;
      const retailTotal = valuation ? valuation.retailTotal : meltValue;
      const gainLoss = valuation ? valuation.gainLoss : null;
      const hasRetailSignal = valuation ? valuation.hasRetailSignal : (currentSpot > 0);

      // Resolve Numista catalog ID for inline tag
      const numistaId = item.numistaId || (typeof catalogManager !== 'undefined'
        && catalogManager.getCatalogId ? catalogManager.getCatalogId(item.serial) : null);

      // Build inline chip HTML strings for config-driven rendering
      const gradeTag = item.grade ? (() => {
        const authority = item.gradingAuthority || '';
        const certNum = item.certNumber || '';
        const isClickable = !!certNum;
        let tooltip;
        if (authority === 'PCGS' && certNum && item.pcgsVerified) {
          tooltip = `${authority} Cert #${certNum} \u2014 Verified`;
        } else if (authority && certNum) {
          tooltip = `${authority} Cert #${certNum} \u2014 Click to verify`;
        } else if (authority) {
          tooltip = `Graded by ${authority}: ${item.grade}`;
        } else {
          tooltip = `Grade: ${item.grade}`;
        }
        // Show PCGS verify icon when: authority=PCGS + has cert# + PCGS API configured
        const showPcgsVerify = authority === 'PCGS' && certNum
          && typeof catalogConfig !== 'undefined' && catalogConfig.isPcgsEnabled();
        const verifyIcon = showPcgsVerify
          ? `<span class="pcgs-verify-btn${item.pcgsVerified ? ' pcgs-verified' : ''}" data-cert-number="${escapeAttribute(certNum)}" title="${item.pcgsVerified ? 'Verified \u2014 Click to re-verify' : 'Verify cert via PCGS API'}"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>`
          : '';
        const attrs = [
          authority ? `data-authority="${escapeAttribute(authority)}"` : '',
          isClickable ? 'data-clickable="true"' : '',
          certNum ? `data-cert-number="${escapeAttribute(certNum)}"` : '',
          `data-grade="${escapeAttribute(item.grade || '')}"`,
          isClickable ? 'tabindex="0" role="button"' : '',
        ].filter(Boolean).join(' ');
        return `<span class="grade-tag" ${attrs} title="${escapeAttribute(tooltip)}">${sanitizeHtml(item.grade)}${verifyIcon}</span>`;
      })() : '';

      const numistaTag = numistaId
        ? `<span class="numista-tag" data-numista-id="${escapeAttribute(String(numistaId))}"
               data-coin-name="${escapeAttribute(item.name)}"
               title="N#${escapeAttribute(String(numistaId))} — View on Numista"
               tabindex="0" role="button">N#${sanitizeHtml(String(numistaId))}</span>`
        : '';

      const pcgsTag = item.pcgsNumber
        ? `<span class="pcgs-tag" data-pcgs-number="${escapeAttribute(String(item.pcgsNumber))}"
               data-grade="${escapeAttribute(item.grade || '')}"
               title="PCGS #${escapeAttribute(String(item.pcgsNumber))} — View on PCGS CoinFacts"
               tabindex="0" role="button">PCGS#${sanitizeHtml(String(item.pcgsNumber))}</span>`
        : '';

      const yearTag = item.year
        ? `<span class="year-tag" title="Filter by year: ${escapeAttribute(String(item.year))}"
               onclick="applyColumnFilter('year', ${JSON.stringify(String(item.year))})"
               tabindex="0" role="button" style="cursor:pointer;">${sanitizeHtml(String(item.year))}</span>`
        : '';

      const serialTag = item.serialNumber
        ? `<span class="serial-tag" title="S/N: ${escapeAttribute(item.serialNumber)}">${sanitizeHtml(item.serialNumber)}</span>`
        : '';

      const storageTag = item.storageLocation && item.storageLocation !== 'Unknown'
        ? `<span class="storage-tag" title="${escapeAttribute(item.storageLocation)}">${sanitizeHtml(item.storageLocation)}</span>`
        : '';

      const notesIndicator = item.notes
        ? `<span class="notes-indicator" title="Click to view notes · Shift+click to edit"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM6 20V4h5v7h7v9H6z"/></svg></span>`
        : '';

      const purityVal = parseFloat(item.purity);
      const purityTag = (!isNaN(purityVal) && purityVal > 0 && purityVal < 1.0)
        ? `<span class="purity-tag" title="Purity: ${purityVal}" onclick="applyColumnFilter('purity', ${JSON.stringify(String(purityVal))})" tabindex="0" role="button" style="cursor:pointer;">${purityVal}</span>`
        : '';

      // Table thumbnail — obverse + reverse preview in name cell
      // Omit src attribute entirely when no URL (avoids browser requesting page URL for src="")
      // Hidden when tableImagesEnabled toggle is off
      const _thumbType = (item.type || '').toLowerCase();
      const _isRectThumb = _thumbType === 'bar' || _thumbType === 'note' || _thumbType === 'aurum'
        || _thumbType === 'set' || item.weightUnit === 'gb';
      const _thumbShapeClass = _isRectThumb ? ' table-thumb-rect' : '';
      const _validUrl = (u) => u && /^https?:\/\/.+\..+/i.test(u);
      const obvUrl = _validUrl(item.obverseImageUrl) ? item.obverseImageUrl : '';
      const revUrl = _validUrl(item.reverseImageUrl) ? item.reverseImageUrl : '';
      const obvSrcAttr = obvUrl ? ` src="${escapeAttribute(obvUrl)}"` : '';
      const revSrcAttr = revUrl ? ` src="${escapeAttribute(revUrl)}"` : '';
      const _sharedThumbAttrs = `data-catalog-id="${escapeAttribute(item.numistaId || '')}"
               data-item-uuid="${escapeAttribute(item.uuid || '')}"
               data-item-name="${escapeAttribute(item.name || '')}"
               data-item-metal="${escapeAttribute(item.metal || '')}"
               data-item-type="${escapeAttribute(item.type || '')}"`;
      const _showObv = _tableImageSidesSetting === 'both' || _tableImageSidesSetting === 'obverse';
      const _showRev = _tableImageSidesSetting === 'both' || _tableImageSidesSetting === 'reverse';
      const thumbHtml = _tableImagesOnSetting && featureFlags.isEnabled('COIN_IMAGES')
        ? (_showObv ? `<img class="table-thumb${_thumbShapeClass}"${obvSrcAttr}
               ${_sharedThumbAttrs} data-side="obverse"
               alt="" loading="lazy" />` : '')
        + (_showRev ? `<img class="table-thumb${_thumbShapeClass}"${revSrcAttr}
               ${_sharedThumbAttrs} data-side="reverse"
               alt="" loading="lazy" />` : '')
        : '';

      // STAK-126: Inline tags chip (show first 2 tags, ellipsis if more)
      const _inlineTags = typeof getItemTags === 'function' ? getItemTags(item.uuid) : [];
      const tagsChip = _inlineTags.length > 0
        ? `<span class="tags-inline-chip" title="${escapeAttribute(_inlineTags.join(', '))}">${sanitizeHtml(_inlineTags.slice(0, 2).join(', '))}${_inlineTags.length > 2 ? '\u2026' : ''}</span>`
        : '';

      // Config-driven chip ordering
      const chipMap = { grade: gradeTag, numista: numistaTag, pcgs: pcgsTag, year: yearTag, serial: serialTag, storage: storageTag, notes: notesIndicator, purity: purityTag, tags: tagsChip };
      const orderedChips = chipConfig.filter(c => c.enabled && chipMap[c.id]).map(c => chipMap[c.id]).join('');

      // Format computed displays
      const meltDisplay = currentSpot > 0 ? formatCurrency(meltValue) : '—';
      const retailDisplay = hasRetailSignal ? formatCurrency(retailTotal) : '—';
      const gainLossDisplay = gainLoss !== null && hasRetailSignal ? formatCurrency(Math.abs(gainLoss)) : '—';
      const gainLossColor = gainLoss > 0 ? 'var(--success, #4caf50)' : gainLoss < 0 ? 'var(--danger, #f44336)' : 'var(--text-primary)';
      const gainLossPrefix = gainLoss > 0 ? '+' : gainLoss < 0 ? '-' : '';

  rows.push(`
      <tr data-idx="${originalIdx}"${isDisposed(item) ? ' class="disposed-row"' : ''}>
  <td class="shrink" data-column="date" data-label="Date">${filterLink('date', item.date, 'var(--text-primary)', item.date ? formatDisplayDate(item.date) : '—')}</td>
      <td class="shrink" data-column="metal" data-label="Metal" data-metal="${escapeAttribute(item.composition || item.metal || '')}">${filterLink('metal', item.composition || item.metal || 'Silver', METAL_COLORS[item.metal] || 'var(--primary)', getDisplayComposition(item.composition || item.metal || 'Silver'))}</td>
      <td class="shrink" data-column="type" data-label="Type">${filterLink('type', item.type, getTypeColor(item.type))}</td>
      <td class="shrink" data-column="image" data-label="Image" style="text-align: center;">${thumbHtml}</td>
      <td class="expand" data-column="name" data-label="" style="text-align: left;">
        <div class="name-cell-content">
        ${featureFlags.isEnabled('COIN_IMAGES')
          ? `<span class="filter-text" style="color: var(--text-primary); cursor: pointer;" onclick="showViewModal(${originalIdx})" tabindex="0" role="button" onkeydown="if(event.key==='Enter'||event.key===' ')showViewModal(${originalIdx})" title="View ${escapeAttribute(item.name)}">${sanitizeHtml(item.name)}</span>`
          : filterLink('name', item.name, 'var(--text-primary)', undefined, item.name)}${isDisposed(item) ? `<span class="disposition-badge disposition-badge--${item.disposition.type}">${DISPOSITION_TYPES[item.disposition.type]?.label || item.disposition.type}</span>` : ''}${orderedChips}
        </div>
      </td>
      <td class="shrink" data-column="qty" data-label="Qty">${filterLink('qty', item.qty, 'var(--text-primary)')}</td>
      <td class="shrink" data-column="weight" data-label="Weight">${filterLink('weight', item.weight, 'var(--text-primary)', formatWeight(item.weight, item.weightUnit), WEIGHT_UNIT_TOOLTIPS[item.weightUnit] || 'Troy ounces (ozt)')}</td>
      <td class="shrink" data-column="purchasePrice" data-label="Purchase" title="Purchase Price (${displayCurrency}) - Click to search eBay active listings" style="color: var(--text-primary);">
        <a href="#" class="ebay-buy-link ebay-price-link" data-search="${escapeAttribute(item.metal + (item.year ? ' ' + item.year : '') + ' ' + item.name)}" title="Search eBay active listings for ${escapeAttribute(item.metal)} ${escapeAttribute(item.name)}">
          ${formatCurrency(purchasePrice)} <svg class="ebay-search-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </a>
      </td>
      <td class="shrink" data-column="meltValue" data-label="Melt" title="Melt Value (${displayCurrency})" style="color: var(--text-primary);">${meltDisplay}</td>
      <td class="shrink ${gbDenomPrice ? 'retail-confirmed' : isManualRetail ? 'retail-confirmed' : 'retail-estimated'}" data-column="retailPrice" data-label="Retail" title="${gbDenomPrice ? 'Goldback denomination price' : isManualRetail ? 'Manual retail price (confirmed)' : 'Estimated — defaults to melt value'} - Click to search eBay sold listings">
        <a href="#" class="ebay-sold-link ebay-price-link" data-search="${escapeAttribute(item.metal + (item.year ? ' ' + item.year : '') + ' ' + item.name)}" title="Search eBay sold listings for ${escapeAttribute(item.metal)} ${escapeAttribute(item.name)}">
          ${retailDisplay} <svg class="ebay-search-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><line x1="15" y1="15" x2="21" y2="21" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </a>
      </td>
      <td class="shrink ${!isManualRetail && gainLoss !== null ? 'gainloss-estimated' : ''}" data-column="gainLoss" data-label="Gain/Loss" title="${isManualRetail ? 'Gain/Loss (confirmed retail)' : 'Gain/Loss (estimated — based on melt value)'}" style="color: ${gainLossColor}; font-weight: ${gainLoss !== null && gainLoss !== 0 && isManualRetail ? '600' : 'normal'};">${gainLoss !== null && gainLossDisplay !== '—' ? gainLossPrefix + gainLossDisplay : '—'}</td>
      <td class="shrink" data-column="purchaseLocation" data-label="Source">
        ${formatPurchaseLocation(item.purchaseLocation)}
      </td>
      <td class="icon-col actions-cell" data-column="actions" data-label=""><div class="actions-row">
  ${isDisposed(item) ? `
        <button class="icon-btn action-icon" role="button" tabindex="0" onclick="undoDisposition(${originalIdx})" aria-label="Undo disposition" title="Undo disposition">
          <svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>
        </button>
        <button class="icon-btn action-icon danger" role="button" tabindex="0" onclick="deleteItem(${originalIdx})" aria-label="Delete item" title="Delete item">
          <svg class="icon-svg delete-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 1h4v2H3V4h4l1-1z"/></svg>
        </button>
  ` : `
        <button class="icon-btn action-icon edit-icon" role="button" tabindex="0" onclick="editItem(${originalIdx})" aria-label="Edit ${sanitizeHtml(item.name)}" title="Edit item">
          <svg class="icon-svg edit-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.22,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.22,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z"/></svg>
        </button>
        <button class="icon-btn action-icon" role="button" tabindex="0" onclick="cloneItem(${originalIdx})" aria-label="Clone ${sanitizeHtml(item.name)}" title="Clone item">
          <svg class="icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>
        </button>
        <button class="icon-btn action-icon danger" role="button" tabindex="0" onclick="deleteItem(${originalIdx})" aria-label="Delete item" title="Delete item">
          <svg class="icon-svg delete-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7zm3-4h6l1 1h4v2H3V4h4l1-1z"/></svg>
        </button>
  `}
      </div></td>
      </tr>
      `);
    }

    // Find tbody element directly if cached version fails
    const tbody = elements.inventoryTable || document.querySelector('#inventoryTable tbody');
    if (!tbody) {
      console.error('Could not find table tbody element');
      return;
    }

    // Revoke previous thumbnail blob URLs to prevent memory leaks
    for (const url of _thumbBlobUrls) {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
    _thumbBlobUrls = [];

    // Handle empty state: no items or no search results
    if (sortedInventory.length === 0) {
      const isFiltered = inventory.length > 0;
      const message = isFiltered ? "No matching items found." : "Your stack is empty.";
      const subtext = isFiltered ? "Try adjusting your search or filters." : "Add your first item to start tracking your portfolio.";
      // Use onclick handler that calls global functions exposed on window
      const action = isFiltered
        ? `<button class="btn warning btn-sm" onclick="clearAllFilters()">Clear Filters</button>`
        : `<button class="btn success btn-sm" onclick="safeGetElement('newItemBtn').click()">Add Item</button>`;

      const emptyHtml = `
        <tr class="empty-state-row">
          <td colspan="100%">
            <div class="empty-state">
              <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                ${isFiltered
                  ? '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>' // Search icon
                  : '<rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>' // Stack icon
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
    tbody.innerHTML = rows.join('');

    // Upgrade table thumbnails from CDN URLs to IDB blob URLs (fire-and-forget)
    _enhanceTableThumbnails();

    // Image-cell click: open the thumb popover for upload/view
    if (!tbody._imgCellBound) {
      tbody._imgCellBound = true;
      tbody.addEventListener('click', (e) => {
        if (!featureFlags.isEnabled('COIN_IMAGES')) return;
        const cell = e.target.closest('td[data-column="image"]');
        if (!cell) return;
        e.stopPropagation();
        const row = cell.closest('tr[data-idx]');
        if (!row) return;
        const idx = parseInt(row.dataset.idx, 10);
        if (isNaN(idx)) return;
        const item = inventory[idx];
        if (!item) return;
        _openThumbPopover(cell, item);
      });
    }

    // Card-view tap: delegate click on tbody rows (≤768px only)
    // Opens view modal if COIN_IMAGES enabled, otherwise edit modal
    if (!tbody._cardTapBound) {
      tbody._cardTapBound = true;
      tbody.addEventListener('click', (e) => {
        if (window.innerWidth > 768) return;
        // Don't intercept clicks on buttons, links, or interactive elements
        if (e.target.closest('button, a, input, select, textarea, .icon-btn, .filter-text, [role="button"], .year-tag, .purity-tag, td[data-column="image"]')) return;
        const row = e.target.closest('tr[data-idx]');
        if (row) {
          const idx = Number(row.dataset.idx);
          if (featureFlags.isEnabled('COIN_IMAGES') && typeof showViewModal === 'function') {
            showViewModal(idx);
          } else {
            editItem(idx);
          }
        }
      });
    }

    hideEmptyColumns();

    debugLog('renderTable complete');

    // Update sort indicators
    const headers = document.querySelectorAll('#inventoryTable th');
    headers.forEach(header => {
      const indicator = header.querySelector('.sort-indicator');
      if (indicator) header.removeChild(indicator);
    });

    if (sortColumn !== null && sortColumn < headers.length) {
      const header = headers[sortColumn];
      const indicator = document.createElement('span');
      indicator.className = 'sort-indicator';
      indicator.textContent = sortDirection === 'asc' ? '↑' : '↓';
      header.appendChild(indicator);
    }

    updatePortalHeight();
    updateSummary();
    
    // Re-setup column resizing and responsive visibility after table re-render
    setupColumnResizing();
    updateColumnVisibility();
  }, 'renderTable');
};

/**
 * Calculates and updates all financial summary displays across the application
 */
const updateSummary = () => {
  // Initialize accumulators for each metal
  const metalTotals = {};
  // Create quick lookup map: metal name -> metal key
  const metalNameMap = {};

  Object.values(METALS).forEach(metalConfig => {
    metalTotals[metalConfig.key] = {
      totalItems: 0,
      totalWeight: 0,
      totalMeltValue: 0,
      totalPurchased: 0,
      totalRetailValue: 0,
      totalGainLoss: 0,
      disposedItems: 0,
      realizedGainLoss: 0,
      totalDisposedCost: 0
    };
    metalNameMap[metalConfig.name] = metalConfig.key;
  });

  // Single pass optimization: O(N) instead of O(N*M)
  for (const item of inventory) {
    const metalKey = metalNameMap[item.metal];
    // Skip items with unknown metal types
    if (metalKey && metalTotals[metalKey]) {
      const totals = metalTotals[metalKey];

      // Skip disposed items from active totals, accumulate realized G/L (STAK-72)
      if (isDisposed(item)) {
        const qty = Number(item.qty) || 0;
        totals.disposedItems += qty;
        totals.realizedGainLoss += (item.disposition?.realizedGainLoss || 0);
        totals.totalDisposedCost += (parseFloat(item.price) || 0) * (Number(item.qty) || 0);
        continue;
      }

      const qty = Number(item.qty) || 0;
      const weight = parseFloat(item.weight) || 0;
      const price = parseFloat(item.price) || 0;

      totals.totalItems += qty;
      // Convert gb denomination to troy oz for weight totals
      const weightOz = (item.weightUnit === 'gb') ? weight * GB_TO_OZT : weight;
      const itemWeight = qty * weightOz;
      totals.totalWeight += itemWeight;

      // Use metalKey directly for spot price lookup (optimization)
      const currentSpot = spotPrices[metalKey] || 0;
      const valuation = (typeof computeItemValuation === 'function')
        ? computeItemValuation(item, currentSpot)
        : null;
      const purity = parseFloat(item.purity) || 1.0;
      const meltValue = valuation ? valuation.meltValue : (currentSpot * itemWeight * purity);
      totals.totalMeltValue += meltValue;

      // Purchase price total (price already converted)
      const purchaseTotal = valuation ? valuation.purchaseTotal : (qty * price);
      totals.totalPurchased += purchaseTotal;

      // Retail total: (1) gb denomination price, (2) manual marketValue, (3) melt
      const retailTotal = valuation ? valuation.retailTotal : meltValue;
      totals.totalRetailValue += retailTotal;

      // Gain/loss: retail minus purchase (both in USD; converted at display time)
      totals.totalGainLoss += retailTotal - purchaseTotal;
    }
  }

  // Update DOM elements
  Object.values(METALS).forEach(metalConfig => {
    const totals = metalTotals[metalConfig.key];
    const metalKey = metalConfig.key;
    const els = elements.totals[metalKey];

    if (els.items) els.items.textContent = totals.totalItems;
    if (els.weight) els.weight.textContent = totals.totalWeight.toFixed(2);
    if (els.value) els.value.textContent = formatCurrency(totals.totalMeltValue || 0);
    if (els.purchased) els.purchased.textContent = formatCurrency(totals.totalPurchased || 0);
    if (els.retailValue) els.retailValue.textContent = formatCurrency(totals.totalRetailValue || 0);
    if (els.lossProfit) {
      const gl = totals.totalGainLoss || 0;
      const gainLossPct = totals.totalPurchased > 0 ? (gl / totals.totalPurchased) * 100 : 0;
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      els.lossProfit.innerHTML = formatLossProfit(gl, gainLossPct);
      // Dynamic label: "Gain:" green, "Loss:" red, "Gain/Loss:" neutral (STACK-50)
      const glLabel = els.lossProfit.parentElement && els.lossProfit.parentElement.querySelector('.total-label');
      if (glLabel) {
        glLabel.textContent = gl > 0 ? 'Gain:' : gl < 0 ? 'Loss:' : 'Gain/Loss:';
        glLabel.style.color = gl > 0 ? 'var(--success)' : gl < 0 ? 'var(--danger)' : '';
        glLabel.style.fontWeight = gl !== 0 ? '600' : '';
      }
    }
    if (els.avgCostPerOz) {
      const avgCost = totals.totalWeight > 0 ? totals.totalPurchased / totals.totalWeight : 0;
      els.avgCostPerOz.textContent = formatCurrency(avgCost);
    }

    // Realized G/L — always visible on every card (STAK-72)
    const realizedGlEl = document.getElementById(`realizedGainLoss${metalConfig.name}`);
    if (realizedGlEl) {
      const rgl = totals.realizedGainLoss || 0;
      const rglPct = totals.totalDisposedCost > 0 ? (rgl / totals.totalDisposedCost) * 100 : 0;
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
      realizedGlEl.innerHTML = rgl === 0 ? '$0.00' : formatLossProfit(rgl, rglPct);
    }
  });

  // Calculate combined totals for all metals
  const allTotals = {
    totalItems: 0,
    totalWeight: 0,
    totalMeltValue: 0,
    totalPurchased: 0,
    totalRetailValue: 0,
    totalGainLoss: 0,
    disposedItems: 0,
    realizedGainLoss: 0,
    totalDisposedCost: 0
  };

  Object.values(metalTotals).forEach(totals => {
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

  // Update "All" totals display if elements exist
  if (elements.totals.all && elements.totals.all.items) {
    elements.totals.all.items.textContent = allTotals.totalItems;
    if (elements.totals.all.weight) elements.totals.all.weight.textContent = allTotals.totalWeight.toFixed(2);
    if (elements.totals.all.value) elements.totals.all.value.textContent = formatCurrency(allTotals.totalMeltValue || 0);
    if (elements.totals.all.purchased) elements.totals.all.purchased.textContent = formatCurrency(allTotals.totalPurchased || 0);
    if (elements.totals.all.retailValue) elements.totals.all.retailValue.textContent = formatCurrency(allTotals.totalRetailValue || 0);
    if (elements.totals.all.lossProfit) {
      const allGl = allTotals.totalGainLoss || 0;
      const allGainLossPct = allTotals.totalPurchased > 0 ? (allGl / allTotals.totalPurchased) * 100 : 0;
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      elements.totals.all.lossProfit.innerHTML = formatLossProfit(allGl, allGainLossPct);
      const allGlLabel = elements.totals.all.lossProfit.parentElement && elements.totals.all.lossProfit.parentElement.querySelector('.total-label');
      if (allGlLabel) {
        allGlLabel.textContent = allGl > 0 ? 'Gain:' : allGl < 0 ? 'Loss:' : 'Gain/Loss:';
        allGlLabel.style.color = allGl > 0 ? 'var(--success)' : allGl < 0 ? 'var(--danger)' : '';
        allGlLabel.style.fontWeight = allGl !== 0 ? '600' : '';
      }
    }
    if (elements.totals.all.avgCostPerOz) {
      const avgCost = allTotals.totalWeight > 0 ? allTotals.totalPurchased / allTotals.totalWeight : 0;
      elements.totals.all.avgCostPerOz.textContent = formatCurrency(avgCost);
    }
  }

  // Realized G/L — always visible on "All" card (STAK-72)
  const allRealizedGl = document.getElementById('realizedGainLossAll');
  if (allRealizedGl) {
    const rgl = allTotals.realizedGainLoss || 0;
    const rglPct = allTotals.totalDisposedCost > 0 ? (rgl / allTotals.totalDisposedCost) * 100 : 0;
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
    allRealizedGl.innerHTML = rgl === 0 ? '$0.00' : formatLossProfit(rgl, rglPct);
  }

  // Respect show/hide realized setting (STAK-72)
  const showRealized = loadDataSync(SHOW_REALIZED_KEY, 'true') !== 'false';
  applyRealizedVisibility(showRealized);
};

/**
 * Opens the combined Remove Item modal (STAK-72).
 * Handles both delete and dispose flows via checkbox toggle.
 *
 * @param {number} idx - Index of item to remove
 * @param {boolean} [preDispose=false] - Pre-check the dispose checkbox
 */
const openRemoveItemModal = (idx, preDispose = false) => {
  const item = inventory[idx];
  if (!item) return;

  const idxInput = document.getElementById('removeItemIdx');
  if (idxInput) idxInput.value = idx;

  const nameEl = document.getElementById('removeItemName');
  if (nameEl) nameEl.textContent = item.name || 'Unnamed item';

  const checkbox = document.getElementById('removeItemDisposeCheck');
  const fieldsWrap = document.getElementById('removeItemDisposeFields');
  const deleteBtn = document.getElementById('removeItemDeleteBtn');
  const disposeBtn = document.getElementById('removeItemDisposeBtn');

  // Reset disposition fields
  const typeSelect = document.getElementById('dispositionType');
  if (typeSelect) typeSelect.value = 'sold';
  const dateInput = document.getElementById('dispositionDate');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
  const amountInput = document.getElementById('dispositionAmount');
  if (amountInput) amountInput.value = '';
  const recipientInput = document.getElementById('dispositionRecipient');
  if (recipientInput) recipientInput.value = '';
  const notesInput = document.getElementById('dispositionNotes');
  if (notesInput) notesInput.value = '';
  const amountGroup = document.getElementById('dispositionAmountGroup');
  if (amountGroup) amountGroup.style.display = '';

  // Set checkbox state and toggle fields/buttons
  if (checkbox) checkbox.checked = preDispose;
  if (fieldsWrap) fieldsWrap.style.display = preDispose ? '' : 'none';
  if (deleteBtn) deleteBtn.style.display = preDispose ? 'none' : '';
  if (disposeBtn) disposeBtn.style.display = preDispose ? '' : 'none';

  openModalById('removeItemModal');
};

const deleteItem = (idx) => {
  openRemoveItemModal(idx, false);
};

const disposeItem = (idx) => {
  const item = inventory[idx];
  if (!item || isDisposed(item)) return;
  openRemoveItemModal(idx, true);
};

/**
 * Confirms removal from the combined Remove Item modal (STAK-72).
 * Reads checkbox state to decide between plain delete and disposition.
 */
const confirmRemoveItem = () => {
  const idxInput = document.getElementById('removeItemIdx');
  const idx = parseInt(idxInput?.value, 10);
  if (isNaN(idx) || !inventory[idx]) return;

  const item = inventory[idx];
  const checkbox = document.getElementById('removeItemDisposeCheck');
  const isDispose = checkbox?.checked;

  if (isDispose) {
    // Disposition flow — validate fields
    const type = document.getElementById('dispositionType')?.value;
    const date = document.getElementById('dispositionDate')?.value;
    const amount = parseFloat(document.getElementById('dispositionAmount')?.value) || 0;
    const recipient = document.getElementById('dispositionRecipient')?.value?.trim() || '';
    const notes = document.getElementById('dispositionNotes')?.value?.trim() || '';

    if (!type || !DISPOSITION_TYPES[type]) {
      showToast('Please select a disposition type.');
      return;
    }
    if (DISPOSITION_TYPES[type].requiresAmount && amount <= 0) {
      showToast('Please enter a sale/trade/refund amount.');
      return;
    }
    if (!date) {
      showToast('Please enter a disposition date.');
      return;
    }

    const purchaseTotal = (parseFloat(item.price) || 0) * (Number(item.qty) || 1);
    const realizedGainLoss = amount - purchaseTotal;

    const disposition = {
      type, date, amount,
      currency: (typeof displayCurrency !== 'undefined' ? displayCurrency : 'USD'),
      recipient, notes,
      realizedGainLoss,
      disposedAt: new Date().toISOString()
    };

    inventory[idx].disposition = disposition;
    saveInventory();
    closeModalById('removeItemModal');
    logChange(item.name, 'Disposed', '', JSON.stringify(disposition), idx);
    showToast(`${item.name} marked as ${DISPOSITION_TYPES[type].label.toLowerCase()}.`);
  } else {
    // Plain delete flow
    inventory.splice(idx, 1);
    saveInventory();
    closeModalById('removeItemModal');
    logChange(item.name, 'Deleted', JSON.stringify(item), '', idx);

    // Clean up user images from IndexedDB (STAK-120)
    if (item?.uuid && window.imageCache?.isAvailable()) {
      window.imageCache.deleteUserImage(item.uuid).catch(err => {
        debugLog(`Failed to delete user images for deleted item: ${err}`);
      });
    }

    // Clean up item tags (STAK-126)
    if (item?.uuid && typeof deleteItemTags === 'function') {
      deleteItemTags(item.uuid);
    }
  }

  renderTable();
  renderActiveFilters();
  updateSummary();
};

/**
 * Restores a disposed item back to active inventory after
 * user confirmation (STAK-72).
 *
 * @param {number} idx - Index of item to restore
 */
const undoDisposition = async (idx) => {
  const item = inventory[idx];
  if (!item || !isDisposed(item)) return;
  const confirmed = typeof showAppConfirm === 'function'
    ? await showAppConfirm(`Restore "${item.name}" to active inventory?`, 'Undo Disposition')
    : false;
  if (confirmed) {
    const oldDisposition = JSON.stringify(item.disposition);
    inventory[idx].disposition = null;
    saveInventory();
    logChange(item.name, 'Disposition Undone', oldDisposition, '', idx);
    showToast(`${item.name} restored to active inventory.`);
    renderTable();
    renderActiveFilters();
    updateSummary();
  }
};

/**
 * Opens modal to view and edit an item's notes
 *
 * @param {number} idx - Index of item whose notes to view/edit
 */
const showNotes = (idx) => {
  notesIndex = idx;
  const item = inventory[idx];
  
  // Add fallbacks and better error handling
  const textareaElement = elements.notesTextarea || document.getElementById('notesTextarea');
  const modalElement = elements.notesModal || document.getElementById('notesModal');
  
  if (textareaElement) {
    textareaElement.value = item.notes || '';
  } else {
    console.error('Notes textarea element not found');
  }
  
  if (modalElement) {
  if (window.openModalById) openModalById('notesModal');
  else modalElement.style.display = 'flex';
  } else {
    console.error('Notes modal element not found');
  }
  
  if (textareaElement && textareaElement.focus) {
    textareaElement.focus();
  }
};


/**
 * Populate Numista Data form fields.
 * Priority: item.numistaData (user/saved) > IndexedDB cache (API) > empty.
 * When called from a fresh Numista search, itemData is null and cache is used.
 *
 * @param {string} catalogId - Numista catalog ID (N#)
 * @param {Object} [itemData] - Stored numistaData from the inventory item
 */
const populateNumistaDataFields = (catalogId, itemData) => {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };

  // Field mapping: formId → { itemKey, cacheKey }
  const fieldMap = [
    { id: 'numistaCountry',       itemKey: 'country',       cacheKey: 'country' },
    { id: 'numistaDenomination',   itemKey: 'denomination',  cacheKey: 'denomination' },
    { id: 'numistaComposition',    itemKey: 'composition',   cacheKey: 'composition' },
    { id: 'numistaShape',          itemKey: 'shape',         cacheKey: 'shape' },
    { id: 'numistaDiameter',       itemKey: 'diameter',      cacheKey: 'diameter' },
    { id: 'numistaThickness',      itemKey: 'thickness',     cacheKey: 'thickness' },
    { id: 'numistaOrientation',    itemKey: 'orientation',   cacheKey: 'orientation' },
    { id: 'numistaTechnique',      itemKey: 'technique',     cacheKey: 'technique' },
    { id: 'numistaMintage',        itemKey: 'mintage',       cacheKey: null },
    { id: 'numistaRarity',         itemKey: 'rarityIndex',   cacheKey: 'rarityIndex' },
    { id: 'numistaKmRef',          itemKey: 'kmRef',         cacheKey: null },
    { id: 'numistaObverseDesc',    itemKey: 'obverseDesc',   cacheKey: 'obverseDesc' },
    { id: 'numistaReverseDesc',    itemKey: 'reverseDesc',   cacheKey: 'reverseDesc' },
    { id: 'numistaEdgeDesc',       itemKey: 'edgeDesc',      cacheKey: 'edgeDesc' },
  ];

  // Clear all fields
  fieldMap.forEach(f => set(f.id, ''));
  const commCb = document.getElementById('numistaCommemorative');
  if (commCb) commCb.checked = false;
  const commDescWrap = document.getElementById('numistaCommemorativeDescWrap');
  if (commDescWrap) commDescWrap.style.display = 'none';
  const commDesc = document.getElementById('numistaCommemorativeDesc');
  if (commDesc) commDesc.value = '';

  /**
   * Apply a data source to the form fields.
   * Only fills fields that are still empty (preserves higher-rank data).
   */
  const applySource = (getData) => {
    fieldMap.forEach(f => {
      const el = document.getElementById(f.id);
      if (el && !el.value) {
        const val = getData(f);
        if (val) el.value = val;
      }
    });
    // Commemorative
    if (commCb && !commCb.checked) {
      const isComm = getData({ itemKey: 'commemorative', cacheKey: 'commemorative' });
      if (isComm) {
        commCb.checked = true;
        if (commDescWrap) commDescWrap.style.display = '';
        const desc = getData({ itemKey: 'commemorativeDesc', cacheKey: 'commemorativeDesc' });
        if (commDesc && desc) commDesc.value = desc;
      }
    }
  };

  // Layer 1 (highest rank): Item's stored numistaData (user edits persist here)
  if (itemData && Object.keys(itemData).length > 0) {
    applySource(f => itemData[f.itemKey] || '');
  }

  // Layer 2 (fallback): IndexedDB cache from API
  if (catalogId && window.imageCache?.isAvailable()) {
    imageCache.getMetadata(catalogId).then(meta => {
      if (!meta) return;
      applySource(f => {
        if (!f.cacheKey) {
          // Special handling for computed fields
          if (f.itemKey === 'mintage' && meta.mintageByYear?.length > 0) {
            const first = meta.mintageByYear[0];
            return typeof first.mintage === 'number' ? first.mintage.toLocaleString() : first.mintage;
          }
          if (f.itemKey === 'kmRef' && meta.kmReferences?.length > 0) {
            return meta.kmReferences.map(r =>
              typeof r === 'object' ? `${r.catalogue || 'KM'}# ${r.number || ''}` : r
            ).join(', ');
          }
          return '';
        }
        return meta[f.cacheKey] || '';
      });
    }).catch(() => {});
  }
};

/**
 * Prepares and displays edit modal for specified inventory item
 *
 * @param {number} idx - Index of item to edit
 */
const editItem = (idx, logIdx = null) => {
  editingIndex = idx;
  editingChangeLogIndex = logIdx;
  const item = inventory[idx];

  // Set modal to edit mode
  if (elements.itemModalTitle) elements.itemModalTitle.textContent = "Edit Inventory Item";
  if (elements.itemModalSubmit) elements.itemModalSubmit.textContent = "Save Changes";

  // Populate unified form fields
  elements.itemMetal.value = item.composition || item.metal;
  elements.itemName.value = item.name;
  elements.itemQty.value = item.qty;
  elements.itemType.value = item.type;

  // Weight: use real <select> instead of dataset.unit (BUG FIX)
  if (item.weightUnit === 'gb') {
    const denomSelect = elements.itemGbDenom || document.getElementById('itemGbDenom');
    elements.itemWeight.value = parseFloat(item.weight);
    elements.itemWeightUnit.value = 'gb';
    if (denomSelect) denomSelect.value = String(parseFloat(item.weight));
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  } else if (item.weightUnit === 'kg') {
    elements.itemWeight.value = parseFloat(oztToKg(item.weight).toFixed(4));
    elements.itemWeightUnit.value = 'kg';
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  } else if (item.weightUnit === 'lb') {
    elements.itemWeight.value = parseFloat(oztToLb(item.weight).toFixed(4));
    elements.itemWeightUnit.value = 'lb';
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  } else if (item.weightUnit === 'g' || item.weight < 1) {
    const grams = oztToGrams(item.weight);
    elements.itemWeight.value = parseFloat(grams.toFixed(4));
    elements.itemWeightUnit.value = 'g';
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  } else {
    elements.itemWeight.value = parseFloat(item.weight).toFixed(2);
    elements.itemWeightUnit.value = 'oz';
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  }

  // Convert stored USD values to display currency for the form (STACK-50)
  const fxRate = (typeof getExchangeRate === 'function') ? getExchangeRate() : 1;
  const displayPrice = item.price > 0 ? (fxRate !== 1 ? (item.price * fxRate).toFixed(2) : item.price) : '';
  const displayMv = item.marketValue > 0 ? (fxRate !== 1 ? (item.marketValue * fxRate).toFixed(2) : item.marketValue) : '';
  elements.itemPrice.value = displayPrice;
  if (elements.itemMarketValue) elements.itemMarketValue.value = displayMv;
  elements.purchaseLocation.value = item.purchaseLocation || '';
  elements.storageLocation.value = item.storageLocation && item.storageLocation !== 'Unknown' ? item.storageLocation : '';
  if (elements.itemSerialNumber) elements.itemSerialNumber.value = item.serialNumber || '';
  if (elements.itemNotes) elements.itemNotes.value = item.notes || '';
  elements.itemDate.value = item.date || '';
  // Set date N/A button state based on whether item has a date
  if (elements.itemDateNABtn) {
    const noDate = !item.date;
    elements.itemDateNABtn.classList.toggle('active', noDate);
    elements.itemDateNABtn.setAttribute('aria-pressed', noDate);
    elements.itemDate.disabled = noDate;
  }
  // Reset spot lookup state for edit mode (STACK-49)
  if (elements.itemSpotPrice) elements.itemSpotPrice.value = '';
  if (elements.spotLookupBtn) elements.spotLookupBtn.disabled = !item.date;
  if (elements.itemCatalog) elements.itemCatalog.value = item.numistaId || '';
  if (elements.itemYear) elements.itemYear.value = item.year || item.issuedYear || '';
  if (elements.itemGrade) elements.itemGrade.value = item.grade || '';
  if (elements.itemGradingAuthority) elements.itemGradingAuthority.value = item.gradingAuthority || '';
  if (elements.itemCertNumber) elements.itemCertNumber.value = item.certNumber || '';
  if (elements.itemPcgsNumber) elements.itemPcgsNumber.value = item.pcgsNumber || '';
  if (elements.itemObverseImageUrl) elements.itemObverseImageUrl.value = item.obverseImageUrl || '';
  if (elements.itemReverseImageUrl) elements.itemReverseImageUrl.value = item.reverseImageUrl || '';
  // STAK-332: Populate ignorePatternImages checkbox from item data
  const ignorePatternEl = document.getElementById('itemIgnorePatternImages');
  if (ignorePatternEl) ignorePatternEl.checked = !!item.ignorePatternImages;
  if (elements.itemSerial) elements.itemSerial.value = item.serial;

  // Pre-fill purity: match a preset or show custom input
  const purityVal = parseFloat(item.purity) || 1.0;
  const puritySelect = elements.itemPuritySelect || document.getElementById('itemPuritySelect');
  const purityCustom = elements.purityCustomWrapper || document.getElementById('purityCustomWrapper');
  const purityInput = elements.itemPurity || document.getElementById('itemPurity');
  if (puritySelect) {
    const presetOption = Array.from(puritySelect.options).find(o => o.value !== 'custom' && parseFloat(o.value) === purityVal);
    if (presetOption) {
      puritySelect.value = presetOption.value;
      if (purityCustom) purityCustom.style.display = 'none';
      if (purityInput) purityInput.value = '';
    } else {
      puritySelect.value = 'custom';
      if (purityCustom) purityCustom.style.display = '';
      if (purityInput) purityInput.value = purityVal;
    }
  }

  // Show/hide PCGS verified icon next to Cert# label
  const certVerifiedIcon = document.getElementById('certVerifiedIcon');
  if (certVerifiedIcon) certVerifiedIcon.style.display = item.pcgsVerified ? 'inline-flex' : 'none';

  // Show price history link in edit mode (STAK-109)
  const retailHistoryLink = document.getElementById('retailPriceHistoryLink');
  if (retailHistoryLink) retailHistoryLink.style.display = 'inline';

  // Show/hide Undo button based on changelog context
  if (elements.undoChangeBtn) {
    elements.undoChangeBtn.style.display =
      logIdx !== null ? "inline-block" : "none";
  }

  // Update currency symbols in modal (STACK-50)
  if (typeof updateModalCurrencyUI === 'function') updateModalCurrencyUI();

  // Preload user images (obverse + reverse) into upload previews (STACK-32)
  if (typeof clearUploadState === 'function') clearUploadState();

  /**
   * Show a preview thumbnail for a given side.
   * Works for both blob object-URLs and remote image URLs.
   * @param {string} url - Image source URL
   * @param {'Obv'|'Rev'} suffix - DOM element suffix
   * @param {'obverse'|'reverse'} side - Side name for setEditPreviewUrl
   */
  const showPreview = (url, suffix, side) => {
    const previewContainer = document.getElementById('itemImagePreview' + suffix);
    const previewImg = document.getElementById('itemImagePreviewImg' + suffix);
    const removeBtn = document.getElementById('itemImageRemoveBtn' + suffix);
    if (previewImg) previewImg.src = url;
    if (previewContainer) previewContainer.style.display = 'block';
    if (removeBtn) removeBtn.style.display = '';
    if (typeof setEditPreviewUrl === 'function') setEditPreviewUrl(url, side);
  };

  /** Fall back to image URL fields when no user-uploaded blob exists */
  const showUrlPreviewFallback = (loadedSides) => {
    if (!loadedSides.obverse && item.obverseImageUrl) {
      showPreview(item.obverseImageUrl, 'Obv', 'obverse');
    }
    if (!loadedSides.reverse && item.reverseImageUrl) {
      showPreview(item.reverseImageUrl, 'Rev', 'reverse');
    }
  };

  if (item.uuid && window.imageCache?.isAvailable()) {
    imageCache.getUserImage(item.uuid).then(async rec => {
      const loaded = { obverse: false, reverse: false };
      if (rec?.obverse) {
        try {
          showPreview(URL.createObjectURL(rec.obverse), 'Obv', 'obverse');
          loaded.obverse = true;
        } catch { /* ignore */ }
      }
      if (rec?.reverse) {
        try {
          showPreview(URL.createObjectURL(rec.reverse), 'Rev', 'reverse');
          loaded.reverse = true;
        } catch { /* ignore */ }
      }
      // Fall back to URL fields
      showUrlPreviewFallback(loaded);
      // If still missing sides, try pattern image resolution
      if (!loaded.obverse || !loaded.reverse) {
        const itemMeta = { uuid: item.uuid, numistaId: item.numistaId || '', name: item.name || '', metal: item.metal || '', type: item.type || '', ignorePatternImages: !!item.ignorePatternImages };
        if (!loaded.obverse) {
          const obvUrl = await imageCache.resolveImageUrlForItem(itemMeta, 'obverse').catch(() => null);
          if (obvUrl && !item.obverseImageUrl) showPreview(obvUrl, 'Obv', 'obverse');
        }
        if (!loaded.reverse) {
          const revUrl = await imageCache.resolveImageUrlForItem(itemMeta, 'reverse').catch(() => null);
          if (revUrl && !item.reverseImageUrl) showPreview(revUrl, 'Rev', 'reverse');
        }
      }
    }).catch(() => {
      showUrlPreviewFallback({ obverse: false, reverse: false });
    }).finally(() => {
      if (typeof updateSwapButtonVisibility === 'function') updateSwapButtonVisibility();
    });
  } else {
    // No IndexedDB — go straight to URL fallback
    showUrlPreviewFallback({ obverse: false, reverse: false });
    if (typeof updateSwapButtonVisibility === 'function') updateSwapButtonVisibility();
  }

  // Update Numista API status dot (STAK-173)
  if (typeof updateNumistaModalDot === 'function') updateNumistaModalDot();
  // Show URL inputs if item has URL values (STAK-173)
  ['Obv', 'Rev'].forEach(suffix => {
    const urlInputWrap = document.getElementById('itemImageUrlInput' + suffix);
    const urlField = suffix === 'Obv' ? elements.itemObverseImageUrl : elements.itemReverseImageUrl;
    if (urlInputWrap && urlField && urlField.value) urlInputWrap.style.display = '';
    else if (urlInputWrap) urlInputWrap.style.display = 'none';
  });

  // Show clone/view/remove buttons in edit mode (STAK-173, STAK-72)
  if (elements.cloneItemBtn) elements.cloneItemBtn.style.display = '';
  if (elements.viewItemFromEditBtn) elements.viewItemFromEditBtn.style.display = '';
  const deleteFromEditBtn = document.getElementById('deleteFromEditBtn');
  if (deleteFromEditBtn) deleteFromEditBtn.style.display = '';

  // Populate Numista Data fields: item data first, API cache as fallback (STAK-173)
  populateNumistaDataFields(item.numistaId || item.catalog || '', item.numistaData);

  // STAK-343: Populate tags in edit modal
  if (item.uuid && typeof getItemTags === 'function') {
    const itemTagsList = getItemTags(item.uuid);
    const numistaChips = document.getElementById('numistaTagsChips');
    const customChips = document.getElementById('customTagsChips');

    // Determine which tags came from Numista (check cached metadata)
    let numistaTagSet = new Set();
    const catalogId = item.numistaId || item.catalog || '';
    if (catalogId && typeof catalogAPI !== 'undefined' && catalogAPI._metaCache) {
      const cached = catalogAPI._metaCache[catalogId];
      if (cached && cached.tags) {
        numistaTagSet = new Set(cached.tags.map(t => String(t).trim().toLowerCase()));
      }
    }

    const renderEditTags = () => {
      const tags = getItemTags(item.uuid);
      const numistaTags = [];
      const customTags = [];
      tags.forEach(t => {
        if (numistaTagSet.has(t.toLowerCase())) numistaTags.push(t);
        else customTags.push(t);
      });

      if (numistaChips) {
        numistaChips.textContent = '';
        if (numistaTags.length === 0) {
          numistaChips.innerHTML = '<span class="tag-empty-hint">No Numista tags</span>';
        } else {
          numistaTags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip tag-chip-numista';
            chip.textContent = tag;
            chip.title = `Numista tag: ${tag} (click × to remove)`;
            const rm = document.createElement('span');
            rm.className = 'tag-chip-remove';
            rm.textContent = '\u00d7';
            rm.setAttribute('role', 'button');
            rm.setAttribute('tabindex', '0');
            rm.setAttribute('aria-label', `Remove tag ${tag}`);
            rm.onclick = (e) => { e.stopPropagation(); removeItemTag(item.uuid, tag); renderEditTags(); };
            chip.appendChild(rm);
            numistaChips.appendChild(chip);
          });
        }
      }

      if (customChips) {
        customChips.textContent = '';
        if (customTags.length === 0) {
          customChips.innerHTML = '<span class="tag-empty-hint">No custom tags</span>';
        } else {
          customTags.forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip tag-chip-custom';
            chip.textContent = tag;
            chip.title = `Custom tag: ${tag} (click × to remove)`;
            const rm = document.createElement('span');
            rm.className = 'tag-chip-remove';
            rm.textContent = '\u00d7';
            rm.setAttribute('role', 'button');
            rm.setAttribute('tabindex', '0');
            rm.setAttribute('aria-label', `Remove tag ${tag}`);
            rm.onclick = (e) => { e.stopPropagation(); removeItemTag(item.uuid, tag); renderEditTags(); };
            chip.appendChild(rm);
            customChips.appendChild(chip);
          });
        }
      }
    };

    renderEditTags();

    // Wire up the add-tag button
    if (elements.addTagBtn && elements.newTagInput) {
      const addHandler = () => {
        const val = elements.newTagInput.value.trim();
        if (val && typeof addItemTag === 'function') {
          addItemTag(item.uuid, val);
          elements.newTagInput.value = '';
          renderEditTags();
        }
      };
      elements.addTagBtn.onclick = addHandler;
      elements.newTagInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addHandler(); } };
    }

    // Tags section is always visible (non-collapsible)
  }

  // Open unified modal
  if (window.openModalById) openModalById('itemModal');
  else if (elements.itemModal) elements.itemModal.style.display = 'flex';
};

/**
 * Opens the edit modal in clone mode for a given inventory item.
 * Called from the table row copy button. (STAK-375)
 *
 * @param {number} idx - Index of item to clone
 */
const cloneItem = (idx) => {
  editItem(idx);
  if (typeof enterCloneMode === 'function') enterCloneMode(idx);
};

/**
 * Duplicates an inventory item by opening the add modal pre-filled with
 * the source item's fields. Date preserves the original purchase date, qty resets to 1.
 *
 * @param {number} idx - Index of item to duplicate
 */
const duplicateItem = (idx) => {
  const item = inventory[idx];

  // Stay in add mode — editingIndex remains null so submit creates a new record
  editingIndex = null;
  editingChangeLogIndex = null;

  // Set modal to add mode with "Duplicate" title
  if (elements.itemModalTitle) elements.itemModalTitle.textContent = "Duplicate Inventory Item";
  if (elements.itemModalSubmit) elements.itemModalSubmit.textContent = "Add to Inventory";
  if (elements.undoChangeBtn) elements.undoChangeBtn.style.display = "none";

  // Pre-fill from source item
  elements.itemMetal.value = item.composition || item.metal;
  elements.itemName.value = item.name;
  elements.itemQty.value = 1; // Reset qty to 1
  elements.itemType.value = item.type;

  // Weight: same conversion logic as editItem
  if (item.weightUnit === 'gb') {
    const denomSelect = elements.itemGbDenom || document.getElementById('itemGbDenom');
    elements.itemWeight.value = parseFloat(item.weight);
    elements.itemWeightUnit.value = 'gb';
    if (denomSelect) denomSelect.value = String(parseFloat(item.weight));
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  } else if (item.weightUnit === 'kg') {
    elements.itemWeight.value = parseFloat(oztToKg(item.weight).toFixed(4));
    elements.itemWeightUnit.value = 'kg';
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  } else if (item.weightUnit === 'lb') {
    elements.itemWeight.value = parseFloat(oztToLb(item.weight).toFixed(4));
    elements.itemWeightUnit.value = 'lb';
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  } else if (item.weightUnit === 'g' || item.weight < 1) {
    const grams = oztToGrams(item.weight);
    elements.itemWeight.value = parseFloat(grams.toFixed(4));
    elements.itemWeightUnit.value = 'g';
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  } else {
    elements.itemWeight.value = parseFloat(item.weight).toFixed(2);
    elements.itemWeightUnit.value = 'oz';
    if (typeof toggleGbDenomPicker === 'function') toggleGbDenomPicker();
  }

  // Convert stored USD values to display currency for the form (STACK-50)
  const dupFxRate = (typeof getExchangeRate === 'function') ? getExchangeRate() : 1;
  const dupDisplayPrice = item.price > 0 ? (dupFxRate !== 1 ? (item.price * dupFxRate).toFixed(2) : item.price) : '';
  const dupDisplayMv = item.marketValue > 0 ? (dupFxRate !== 1 ? (item.marketValue * dupFxRate).toFixed(2) : item.marketValue) : '';
  elements.itemPrice.value = dupDisplayPrice;
  if (elements.itemMarketValue) elements.itemMarketValue.value = dupDisplayMv;
  elements.purchaseLocation.value = item.purchaseLocation || '';
  elements.storageLocation.value = item.storageLocation && item.storageLocation !== 'Unknown' ? item.storageLocation : '';
  if (elements.itemSerialNumber) elements.itemSerialNumber.value = item.serialNumber || '';
  if (elements.itemNotes) elements.itemNotes.value = item.notes || '';
  elements.itemDate.value = item.date || todayStr();
  if (elements.itemCatalog) elements.itemCatalog.value = item.numistaId || '';
  if (elements.itemYear) elements.itemYear.value = item.year || item.issuedYear || '';
  if (elements.itemGrade) elements.itemGrade.value = item.grade || '';
  if (elements.itemGradingAuthority) elements.itemGradingAuthority.value = item.gradingAuthority || '';
  if (elements.itemCertNumber) elements.itemCertNumber.value = item.certNumber || '';
  if (elements.itemPcgsNumber) elements.itemPcgsNumber.value = item.pcgsNumber || '';
  if (elements.itemSerial) elements.itemSerial.value = ''; // Serial should be unique per item

  // Pre-fill purity (same logic as editItem)
  const dupPurity = parseFloat(item.purity) || 1.0;
  const dupPuritySelect = elements.itemPuritySelect || document.getElementById('itemPuritySelect');
  const dupPurityCustom = elements.purityCustomWrapper || document.getElementById('purityCustomWrapper');
  const dupPurityInput = elements.itemPurity || document.getElementById('itemPurity');
  if (dupPuritySelect) {
    const presetOpt = Array.from(dupPuritySelect.options).find(o => o.value !== 'custom' && parseFloat(o.value) === dupPurity);
    if (presetOpt) {
      dupPuritySelect.value = presetOpt.value;
      if (dupPurityCustom) dupPurityCustom.style.display = 'none';
      if (dupPurityInput) dupPurityInput.value = '';
    } else {
      dupPuritySelect.value = 'custom';
      if (dupPurityCustom) dupPurityCustom.style.display = '';
      if (dupPurityInput) dupPurityInput.value = dupPurity;
    }
  }

  // Hide PCGS verified icon — duplicate is a new unverified item
  const certVerifiedIcon = document.getElementById('certVerifiedIcon');
  if (certVerifiedIcon) certVerifiedIcon.style.display = 'none';

  // Update currency symbols in modal (STACK-50)
  if (typeof updateModalCurrencyUI === 'function') updateModalCurrencyUI();

  // Open unified modal
  if (window.openModalById) openModalById('itemModal');
  else if (elements.itemModal) elements.itemModal.style.display = 'flex';
};

/**
 * Toggles price display between purchase price and market value
 * 
 * @param {number} idx - Index of item to toggle price view for
 */
/**
 * Legacy function kept for compatibility - no longer used  
 * Market value now has its own dedicated column
 */
const toggleGlobalPriceView = () => {
  // Function kept for compatibility but no longer used
  console.warn('toggleGlobalPriceView is deprecated - using separate columns now');
};

// =============================================================================
// IMPORT/EXPORT FUNCTIONS
// =============================================================================

// Import progress utilities
const startImportProgress = (total) => {
  if (!elements.importProgress || !elements.importProgressText) return;
  elements.importProgress.max = total;
  elements.importProgress.value = 0;
  elements.importProgress.style.display = 'block';
  elements.importProgressText.style.display = 'block';
  elements.importProgressText.textContent = `0 / ${total} items imported`;
};

const updateImportProgress = (processed, imported, total) => {
  if (!elements.importProgress || !elements.importProgressText) return;
  elements.importProgress.value = processed;
  elements.importProgressText.textContent = `${imported} / ${total} items imported`;
};

const endImportProgress = () => {
  if (!elements.importProgress || !elements.importProgressText) return;
  elements.importProgress.style.display = 'none';
  elements.importProgressText.style.display = 'none';
};

/**
 * Post-import cleanup — registers names, syncs catalog, saves, and re-renders.
 * @param {Array} newItems - Items that were added during import
 * @param {Map|null} pendingTagsByUuid - Optional map of uuid -> tag[] for deferred tag application
 */
const _postImportCleanup = (newItems, pendingTagsByUuid) => {
  // Apply deferred tags if needed
  if (pendingTagsByUuid && typeof addItemTag === 'function') {
    for (const item of newItems) {
      const tags = pendingTagsByUuid.get(item.uuid);
      if (tags && tags.length) {
        tags.forEach(tag => addItemTag(item.uuid, tag, false));
      }
    }
    if (typeof saveItemTags === 'function') saveItemTags();
  }

  // Register names
  for (const item of newItems) {
    if (typeof registerName === 'function') registerName(item.name);
  }

  // Catalog sync, save, render
  if (typeof catalogManager !== 'undefined' && catalogManager.syncInventory) {
    inventory = catalogManager.syncInventory(inventory);
  }
  saveInventory();
  renderTable();
  if (typeof renderActiveFilters === 'function') renderActiveFilters();
  if (typeof updateStorageStats === 'function') updateStorageStats();
};

/**
 * Shared import review helper — DiffEngine + DiffModal pattern.
 * Used by importCsv, importJson, and importNumistaCsv to deduplicate
 * the diff-review workflow.
 *
 * @param {Array} parsedItems - Parsed items to import
 * @param {object} sourceInfo - { type: 'csv'|'json', label: string }
 * @param {object} [options] - Optional: { settingsDiff, pendingTagsByUuid }
 * @param {function} onComplete - Called after apply with summary { added, modified, deleted }
 */
const showImportDiffReview = (parsedItems, sourceInfo, options, onComplete) => {
  options = options || {};

  // Guard: if DiffEngine or DiffModal unavailable, fall back to concat-all
  if (typeof DiffEngine === 'undefined' || typeof DiffModal === 'undefined') {
    debugLog('showImportDiffReview fallback', 'DiffEngine/DiffModal unavailable');
    inventory = inventory.concat(parsedItems);
    _postImportCleanup(parsedItems, options.pendingTagsByUuid);
    if (typeof showImportSummaryBanner === 'function') {
      showImportSummaryBanner({ added: parsedItems.length, modified: 0, deleted: 0, skipped: 0, skippedReasons: [] });
    }
    if (onComplete) onComplete({ added: parsedItems.length, modified: 0, deleted: 0 });
    return;
  }

  // STAK-380: Backward-compat for CSVs without UUID column.
  // Local items have UUIDs (assigned by loadInventory), but old exports don't.
  // Enrich imported items: copy local UUID when serials match, so DiffEngine
  // can match them by the same key tier.
  const localUuidBySerial = new Map();
  for (const item of inventory) {
    if (item.serial && item.uuid) localUuidBySerial.set(String(item.serial), item.uuid);
  }
  for (const item of parsedItems) {
    if (!item.uuid && item.serial) {
      const localUuid = localUuidBySerial.get(String(item.serial));
      if (localUuid) item.uuid = localUuid;
    }
  }

  const diffResult = DiffEngine.compareItems(inventory, parsedItems);

  // Build settings diff if provided via options (JSON imports only)
  const settingsDiff = options.settingsDiff || null;

  // No changes? Inform user
  const totalChanges = diffResult.added.length + diffResult.modified.length + diffResult.deleted.length;
  if (totalChanges === 0 && !settingsDiff) {
    if (typeof showToast === 'function') showToast('No changes detected \u2014 inventory is up to date');
    return;
  }

  // Compute count header values for DiffModal (STAK-374)
  const _backupCount = parsedItems.length + (options.validationResult ? (options.validationResult.skippedCount || 0) : 0);
  const _localCount = (typeof inventory !== 'undefined' && Array.isArray(inventory)) ? inventory.length : 0;

  // Cross-domain origin warning (STAK-374): warn when importing from a different domain
  const _parsedOrigin = options.exportMeta && options.exportMeta.exportOrigin ? options.exportMeta.exportOrigin : null;
  const _currentOrigin = (typeof window !== 'undefined' && window.location) ? window.location.origin : null;
  if (_parsedOrigin && _currentOrigin && _parsedOrigin !== _currentOrigin && typeof showToast === 'function') {
    const _safeFrom = typeof sanitizeHtml === 'function' ? sanitizeHtml(_parsedOrigin) : _parsedOrigin;
    showToast('\u26A0 This backup is from a different domain (' + _safeFrom + '). Check item counts carefully.');
  }

  DiffModal.show({
    source: sourceInfo,
    diff: diffResult,
    settingsDiff: settingsDiff,
    backupCount: _backupCount,
    localCount: _localCount,
    onApply: function(selectedChanges) {
      if (!selectedChanges || selectedChanges.length === 0) return;

      inventory = DiffEngine.applySelectedChanges(inventory, selectedChanges);

      // Apply tags for added items if pendingTagsByUuid provided
      if (options.pendingTagsByUuid && typeof addItemTag === 'function') {
        const addedItems = selectedChanges.filter(function(c) { return c.type === 'add'; });
        for (const change of addedItems) {
          if (change.item) {
            const tags = options.pendingTagsByUuid.get(change.item.uuid);
            if (tags && tags.length) {
              tags.forEach(function(tag) { addItemTag(change.item.uuid, tag, false); });
            }
          }
        }
        if (typeof saveItemTags === 'function') saveItemTags();
      }

      // Apply settings changes if present
      if (settingsDiff && settingsDiff.changed && settingsDiff.changed.length > 0) {
        for (const sc of settingsDiff.changed) {
          saveDataSync(sc.key, sc.remoteVal);
        }
      }

      _postImportCleanup(
        selectedChanges.filter(function(c) { return c.type === 'add'; }).map(function(c) { return c.item; }).filter(Boolean),
        null  // tags already handled above
      );

      // Toast summary
      const addCount = selectedChanges.filter(function(c) { return c.type === 'add'; }).length;
      const modCount = selectedChanges.filter(function(c) { return c.type === 'modify'; }).length;
      const delCount = selectedChanges.filter(function(c) { return c.type === 'delete'; }).length;
      const parts = [];
      if (addCount > 0) parts.push(addCount + ' added');
      if (modCount > 0) parts.push(modCount + ' updated');
      if (delCount > 0) parts.push(delCount + ' removed');
      if (typeof showToast === 'function') {
        showToast('Import complete: ' + (parts.length > 0 ? parts.join(', ') : 'no changes applied'));
      }

      // Post-import summary banner (STAK-374)
      if (typeof showImportSummaryBanner === 'function') {
        var _skippedReasons = [];
        if (options.validationResult && options.validationResult.invalid) {
          _skippedReasons = options.validationResult.invalid.slice(0, 5).map(function(i) { return i.reasons[0]; });
        }
        showImportSummaryBanner({
          added: selectedChanges.filter(function(c) { return c.type === 'add'; }).length,
          modified: selectedChanges.filter(function(c) { return c.type === 'modify'; }).length,
          deleted: selectedChanges.filter(function(c) { return c.type === 'delete'; }).length,
          skipped: options.validationResult ? (options.validationResult.skippedCount || 0) : 0,
          skippedReasons: _skippedReasons
        });
      }

      if (onComplete) onComplete({ added: addCount, modified: modCount, deleted: delCount });

      if (localStorage.getItem('staktrakr.debug') && typeof window.showDebugModal === 'function') {
        showDebugModal();
      }
    },
    onCancel: function() {
      debugLog('Import cancelled by user');
    }
  });
};

/**
 * Imports inventory data from CSV file with comprehensive validation and error handling
 *
 * @param {File} file - CSV file selected by user through file input
 * @param {boolean} [override=false] - Replace existing inventory instead of merging
 */
const importCsv = (file, override = false) => {
  if (typeof Papa === 'undefined') {
    appAlert('CSV library (PapaParse) failed to load. Please check your internet connection and reload the page.');
    return;
  }
  try {
    debugLog('importCsv start', file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      comments: '#',
      complete: function(results) {
        let imported = [];
        const totalRows = results.data.length;
        startImportProgress(totalRows);
        let processed = 0;
        let importedCount = 0;

        const supportedMetals = ['Silver', 'Gold', 'Platinum', 'Palladium'];
        const skippedNonPM = [];

        for (const row of results.data) {
          processed++;
          debugLog('importCsv row', processed, JSON.stringify(row));
          const compositionRaw = row['Composition'] || row['Metal'] || 'Silver';
          const composition = getCompositionFirstWords(compositionRaw);
          const metal = parseNumistaMetal(composition);

          // Skip non-precious-metal items
          if (!supportedMetals.includes(metal)) {
            const rowName = row['Name'] || row['name'] || `Row ${processed}`;
            skippedNonPM.push(`${rowName} (${compositionRaw})`);
            updateImportProgress(processed, importedCount, totalRows);
            continue;
          }

          const name = row['Name'] || row['name'];
          const qty = row['Qty'] || row['qty'] || 1;
          const type = normalizeType(row['Type'] || row['type']);
          const weight = row['Weight(oz)'] || row['weight'];
          const weightUnit = row['Weight Unit'] || row['weightUnit'] || 'oz';
          const priceStr = row['Purchase Price'] || row['price'];
          let price = typeof priceStr === 'string'
            ? parseFloat(priceStr.replace(/[^\d.-]+/g, ''))
            : parseFloat(priceStr);
          if (price < 0) price = 0;
          const purchaseLocation = row['Purchase Location'] || '';
          const storageLocation = row['Storage Location'] || '';
          const notes = row['Notes'] || '';
          const year = row['Year'] || row['year'] || row['issuedYear'] || '';
          const grade = row['Grade'] || row['grade'] || '';
          const gradingAuthority = row['Grading Authority'] || row['gradingAuthority'] || row['Authority'] || '';
          const certNumber = (row['Cert #'] || row['certNumber'] || row['Cert Number'] || '').toString();
          const date = parseDate(row['Date']);

          // Parse retail price from CSV (backward-compatible with legacy columns)
          const retailStr = row['Retail Price'] || row['Market Value'] || row['marketValue'] || '0';
          const marketValue = typeof retailStr === 'string'
            ? parseFloat(retailStr.replace(/[^\d.-]+/g, '')) || 0
            : parseFloat(retailStr) || 0;

          let spotPriceAtPurchase;
          if (row['Spot Price ($/oz)']) {
            const spotStr = row['Spot Price ($/oz)'].toString();
            spotPriceAtPurchase = parseFloat(spotStr.replace(/[^0-9.-]+/g, ''));
          } else if (row['spotPriceAtPurchase']) {
            spotPriceAtPurchase = parseFloat(row['spotPriceAtPurchase']);
          } else {
            spotPriceAtPurchase = 0;
          }

          const premiumPerOz = 0;
          const totalPremium = 0;

          const numistaRaw = (row['N#'] || row['Numista #'] || row['numistaId'] || '').toString();
          const numistaMatch = numistaRaw.match(/\d+/);
          const numistaId = numistaMatch ? numistaMatch[0] : '';
          const pcgsNumber = (row['PCGS #'] || row['PCGS Number'] || row['pcgsNumber'] || '').toString().trim();
          const purityRaw = row['Purity'] || row['Fineness'] || row['purity'] || '';
          const purity = parseFloat(purityRaw) || 1.0;
          const serialNumber = row['Serial Number'] || row['serialNumber'] || '';
          const serial = row['Serial'] || row['serial'] || getNextSerial();
          const uuid = row['UUID'] || row['uuid'] || '';
          const csvTags = (row['Tags'] || row['tags'] || '').trim();
          const obverseImageUrl = row['Obverse Image URL'] || row['obverseImageUrl'] || '';
          const reverseImageUrl = row['Reverse Image URL'] || row['reverseImageUrl'] || '';

          addCompositionOption(composition);

          const item = sanitizeImportedItem({
            metal,
            composition,
            name,
            qty,
            type,
            weight,
            weightUnit,
            price,
            marketValue,
            date,
            purchaseLocation,
            storageLocation,
            notes,
            year,
            grade,
            gradingAuthority,
            certNumber,
            pcgsNumber,
            purity,
            spotPriceAtPurchase,
            premiumPerOz,
            totalPremium,
            numistaId,
            serialNumber,
            serial,
            uuid,
            obverseImageUrl,
            reverseImageUrl
          });

          imported.push(item);

          // STAK-126: Import tags from CSV
          if (csvTags && typeof addItemTag === 'function') {
            csvTags.split(';').map(t => t.trim()).filter(Boolean).forEach(tag => {
              addItemTag(item.uuid, tag, false);
            });
          }

          importedCount++;
          updateImportProgress(processed, importedCount, totalRows);
        }

        // STAK-126: Persist any imported tags
        if (typeof saveItemTags === 'function') saveItemTags();

        endImportProgress();

        // Report skipped non-precious-metal items
        if (skippedNonPM.length > 0) {
          if (typeof showAppAlert === 'function') {
            showAppAlert(
              `${skippedNonPM.length} item(s) skipped: no precious metal content\n\n${skippedNonPM.join('\n')}`,
              'CSV Import',
            );
          }
        }

        if (imported.length === 0) {
          if (typeof showAppAlert === 'function') showAppAlert('No items to import.', 'CSV Import');
          return;
        }

        // Pre-validation — surface skipped items before DiffModal opens
        var _validationResult = null;
        if (typeof buildImportValidationResult === 'function') {
          _validationResult = buildImportValidationResult(imported, skippedNonPM);
          if (_validationResult.valid.length === 0) {
            var _firstReason = _validationResult.invalid.length > 0 ? _validationResult.invalid[0].reasons[0] : 'Unknown error';
            if (typeof showToast === 'function') showToast('No items could be imported: ' + _firstReason);
            return;
          }
          if (_validationResult.skippedCount > 0) {
            if (typeof showToast === 'function') showToast(_validationResult.skippedCount + ' item(s) could not be imported and were skipped.');
          }
          imported = _validationResult.valid;
        }

        // --- Override path: skip DiffEngine, import all items directly ---
        if (override) {
          inventory = imported;

          // Synchronize all items with catalog manager
          if (typeof catalogManager !== 'undefined' && catalogManager.syncInventory) {
            inventory = catalogManager.syncInventory(inventory);
          }

          for (const item of imported) {
            if (typeof registerName === 'function') {
              registerName(item.name);
            }
          }

          saveInventory();
          renderTable();
          if (typeof renderActiveFilters === 'function') {
            renderActiveFilters();
          }
          if (typeof updateStorageStats === 'function') {
            updateStorageStats();
          }
          debugLog('importCsv override complete', imported.length, 'items replaced');
          if (localStorage.getItem('staktrakr.debug') && typeof window.showDebugModal === 'function') {
            showDebugModal();
          }
          return;
        }

        // --- Merge path: use shared DiffEngine + DiffModal helper ---
        showImportDiffReview(imported, { type: 'csv', label: file.name }, {
          validationResult: _validationResult,
        }, function(summary) {
          debugLog('importCsv DiffEngine complete', summary.added, 'added', summary.modified, 'modified', summary.deleted, 'deleted');
        });
      },
      error: function(error) {
        endImportProgress();
        handleError(error, 'CSV import');
      }
    });
  } catch (error) {
    endImportProgress();
    handleError(error, 'CSV import initialization');
  }
};

/**
 * Imports inventory data from a Numista CSV export
 *
 * @param {File} file - CSV file from Numista
 * @param {boolean} [override=false] - Replace existing inventory instead of merging
 */
const importNumistaCsv = (file, override = false) => {
  if (typeof Papa === 'undefined') {
    appAlert('CSV library (PapaParse) failed to load. Please check your internet connection and reload the page.');
    return;
  }
  try {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const csvText = e.target.result;
        const results = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          comments: '#',
          transformHeader: (h) => h.trim(), // Handle Numista headers with trailing spaces
        });
        const rawTable = results.data;
        const imported = [];
        const supportedMetals = ['Silver', 'Gold', 'Platinum', 'Palladium'];
        const skippedNonPM = [];
        const totalRows = rawTable.length;
        startImportProgress(totalRows);
        let processed = 0;
        let importedCount = 0;

        const getValue = (row, keys) => {
          for (const key of keys) {
            const foundKey = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
            if (foundKey) return row[foundKey];
          }
          return "";
        };

        for (const row of rawTable) {
          processed++;

          const numistaRaw = (getValue(row, ['N# number', 'N# number (with link)', 'Numista #', 'Numista number', 'Numista id']) || '').toString();
          const numistaMatch = numistaRaw.match(/\d+/);
          const numistaId = numistaMatch ? numistaMatch[0] : '';
          const title = (getValue(row, ['Title', 'Name']) || '').trim();
          const year = (getValue(row, ['Year', 'Date']) || '').trim();
          const name = year.length >= 4 ? `${title} ${year}`.trim() : title;
          const issuedYear = year.length >= 4 ? year : '';
          const compositionRaw = getValue(row, ['Composition', 'Metal']) || '';
          const composition = getCompositionFirstWords(compositionRaw);

          addCompositionOption(composition);

          let metal = parseNumistaMetal(composition);

          // Skip non-precious-metal items (Paper, Alloy, Copper, Nickel, etc.)
          if (!supportedMetals.includes(metal)) {
            skippedNonPM.push(`${name || `Row ${processed}`} (${compositionRaw || 'unknown'})`);
            updateImportProgress(processed, importedCount, totalRows);
            continue;
          }

          const qty = parseInt(getValue(row, ['Quantity', 'Qty', 'Quantity owned']) || 1, 10);

          let type = normalizeType(mapNumistaType(getValue(row, ['Type']) || ''));

          const weightCols = Object.keys(row).filter(k => { const key = k.toLowerCase(); return key.includes('weight') || key.includes('mass'); });
          let weightGrams = 0;
          for (const col of weightCols) {
            const val = parseFloat(String(row[col]).replace(/[^0-9.]/g, ''));
            if (!isNaN(val)) weightGrams = Math.max(weightGrams, val);
          }
          const weight = parseFloat(gramsToOzt(weightGrams).toFixed(6));

          const priceKey = Object.keys(row).find(k => /^(buying price|purchase price|price paid)/i.test(k));
          const estimateKey = Object.keys(row).find(k => /^estimate/i.test(k));
          const parsePriceField = (key) => {
            const rawVal = String(row[key] ?? '').trim();
            const valueCurrency = detectCurrency(rawVal);
            const headerCurrencyMatch = key.match(/\(([^)]+)\)/);
            const headerCurrency = headerCurrencyMatch ? headerCurrencyMatch[1] : displayCurrency;
            const currency = valueCurrency || headerCurrency;
            const amount = parseFloat(rawVal.replace(/[^0-9.\-]/g, ''));
            return isNaN(amount) ? 0 : convertToUsd(amount, currency);
          };
          
          let purchasePrice = 0;
          let marketValue = 0;
          
          // Set purchase price from buying price
          if (priceKey) {
            purchasePrice = parsePriceField(priceKey);
          }
          
          // Set market value from estimate price
          if (estimateKey) {
            marketValue = parsePriceField(estimateKey);
          }
          
          // If no market value but we have buying price, use buying price for both
          if (marketValue === 0 && purchasePrice > 0) {
            marketValue = purchasePrice;
          }
          
          // If no purchase price but we have estimate, use estimate for both
          if (purchasePrice === 0 && marketValue > 0) {
            purchasePrice = marketValue;
          }

          const purchaseLocRaw = getValue(row, ['Acquisition place', 'Acquired from', 'Purchase place']);
          const purchaseLocation = purchaseLocRaw && purchaseLocRaw.trim() ? purchaseLocRaw.trim() : '—';
          const storageLocRaw = getValue(row, ['Storage location', 'Stored at', 'Storage place']);
          const storageLocation = storageLocRaw && storageLocRaw.trim() ? storageLocRaw.trim() : '—';

          const dateStrRaw = getValue(row, ['Acquisition date', 'Date acquired', 'Date']);
          const dateStr = dateStrRaw && dateStrRaw.trim() ? dateStrRaw.trim() : '—';
          const date = parseDate(dateStr);

          const baseNote = (getValue(row, ['Note', 'Notes']) || '').trim();
          const privateComment = (getValue(row, ['Private comment']) || '').trim();
          const publicComment = (getValue(row, ['Public comment']) || '').trim();
          const otherComment = (getValue(row, ['Comment']) || '').trim();
          const noteParts = [];
          if (baseNote) noteParts.push(baseNote);
          if (privateComment) noteParts.push(`Private Comment: ${privateComment}`);
          if (publicComment) noteParts.push(`Public Comment: ${publicComment}`);
          if (otherComment) noteParts.push(`Comment: ${otherComment}`);
          const notes = noteParts.join('\n');

          const markdownLines = Object.entries(row)
            .filter(([, v]) => v && String(v).trim())
            .map(([k, v]) => `- **${k.trim()}**: ${String(v).trim()}`);
          const markdownNote = markdownLines.length
            ? `### Numista Import Data\n${markdownLines.join('\n')}`
            : '';
          const finalNotes = markdownNote
            ? notes ? `${notes}\n\n${markdownNote}` : markdownNote
            : notes;

          const spotPriceAtPurchase = 0;
          const premiumPerOz = 0;
          const totalPremium = 0;
          const serial = getNextSerial();
          const uuid = generateUUID();

          const item = sanitizeImportedItem({
            metal,
            composition,
            name,
            qty,
            type,
            weight,
            price: purchasePrice,
            purchasePrice,
            marketValue,
            date,
            purchaseLocation,
            storageLocation,
            notes: finalNotes,
            spotPriceAtPurchase,
            premiumPerOz,
            totalPremium,
            numistaId,
            year: issuedYear,
            grade: '',
            gradingAuthority: '',
            certNumber: '',
            pcgsNumber: '',
            serial,
            uuid
          });

          imported.push(item);
          importedCount++;
          updateImportProgress(processed, importedCount, totalRows);
        }

        endImportProgress();

        // Report skipped non-precious-metal items
        if (skippedNonPM.length > 0) {
          if (typeof showAppAlert === 'function') {
            showAppAlert(
              `${skippedNonPM.length} item(s) skipped: no precious metal content\n\n${skippedNonPM.join('\n')}`,
              'Numista Import',
            );
          }
        }

        if (imported.length === 0) {
          if (typeof showAppAlert === 'function') showAppAlert('No items to import.', 'Numista Import');
          return;
        }

        // --- Override path: skip DiffEngine, import all items directly ---
        if (override) {
          inventory = imported;

          for (const item of imported) {
            if (typeof registerName === 'function') registerName(item.name);
          }

          if (typeof catalogManager !== 'undefined' && catalogManager.syncInventory) {
            inventory = catalogManager.syncInventory(inventory);
          }
          saveInventory();
          renderTable();
          if (typeof renderActiveFilters === 'function') renderActiveFilters();
          if (typeof updateStorageStats === 'function') updateStorageStats();
          debugLog('importNumistaCsv override complete', imported.length, 'items replaced');
          return;
        }

        // --- Merge path: use shared DiffEngine + DiffModal helper ---
        showImportDiffReview(imported, { type: 'csv', label: file.name }, {}, function(summary) {
          debugLog('importNumistaCsv DiffEngine complete', summary.added, 'added', summary.modified, 'modified', summary.deleted, 'deleted');
        });
      } catch (error) {
        endImportProgress();
        handleError(error, 'Numista CSV import');
      }
    };
    reader.onerror = (error) => {
      endImportProgress();
      handleError(error, 'Numista CSV import');
    };
    reader.readAsText(file);
  } catch (error) {
    endImportProgress();
    handleError(error, 'Numista CSV import initialization');
  }
};

/**
 * Exports inventory using Numista-compatible column layout
 */
const exportNumistaCsv = () => {
  const timestamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const headers = [
    "N# number",
    "Title",
    "Year",
    "Metal",
    "Quantity",
    "Type",
    "Weight (g)",
    `Buying price (${displayCurrency})`,
    "Acquisition place",
    "Storage location",
    "Acquisition date",
    "Note",
    "Private comment",
    "Public comment",
    "Comment",
  ];

  const sortedInventory = sortInventoryByDateNewestFirst();
  const rows = [];

  for (const item of sortedInventory) {
    const year = item.year || item.issuedYear || '';
    let title = item.name || '';
    if (year) {
      const yearRegex = new RegExp(`\\s*${String(year).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      title = title.replace(yearRegex, '').trim();
    }

    const weightGrams = parseFloat(item.weight)
      ? parseFloat(item.weight) * 31.1034768
      : 0;
    const purchasePrice = item.purchasePrice ?? item.price;

    let baseNote = '';
    let privateComment = '';
    let publicComment = '';
    let otherComment = '';
    if (item.notes) {
      const lines = String(item.notes).split(/\n/);
      for (const line of lines) {
        if (/^\s*Private Comment:/i.test(line)) {
          privateComment = line.replace(/^\s*Private Comment:\s*/i, '').trim();
        } else if (/^\s*Public Comment:/i.test(line)) {
          publicComment = line.replace(/^\s*Public Comment:\s*/i, '').trim();
        } else if (/^\s*Comment:/i.test(line)) {
          otherComment = line.replace(/^\s*Comment:\s*/i, '').trim();
        } else {
          baseNote = baseNote ? `${baseNote}\n${line}` : line;
        }
      }
    }

    rows.push([
      item.numistaId || '',
      title,
      year,
      item.metal || '',
      item.qty || '',
      item.type || '',
      weightGrams ? weightGrams.toFixed(2) : '',
      purchasePrice != null ? Number(purchasePrice).toFixed(2) : '',
      item.purchaseLocation || '',
      item.storageLocation || '',
      item.date || '',
      baseNote,
      privateComment,
      publicComment,
      otherComment,
    ]);
  }

  const csv = Papa.unparse([headers, ...rows]);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `numista_export_${timestamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Exports current inventory to CSV format
 */
const exportCsv = () => {
  if (typeof Papa === 'undefined') {
    appAlert('CSV library (PapaParse) failed to load. Please check your internet connection and reload the page.');
    return;
  }
  debugLog('exportCsv start', inventory.length, 'items');
  const timestamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const headers = [
    "Date","Metal","Type","Name","Year","Qty","Weight(oz)","Weight Unit","Purity",
    "Purchase Price","Melt Value","Retail Price","Gain/Loss",
    "Purchase Location","N#","PCGS #","Grade","Grading Authority","Cert #","Serial Number","Notes","UUID",
    "Obverse Image URL","Reverse Image URL",
    "Disposition Type","Disposition Date","Disposition Amount","Realized Gain/Loss"
  ];

  const sortedInventory = sortInventoryByDateNewestFirst();
  const rows = [];

  for (const i of sortedInventory) {
    const currentSpot = spotPrices[i.metal.toLowerCase()] || 0;
    const valuation = (typeof computeItemValuation === 'function')
      ? computeItemValuation(i, currentSpot)
      : null;
    const purchasePrice = valuation ? valuation.purchasePrice : (typeof i.price === 'number' ? i.price : parseFloat(i.price) || 0);
    const meltValue = valuation ? valuation.meltValue : computeMeltValue(i, currentSpot);
    const gainLoss = valuation ? valuation.gainLoss : null;

    rows.push([
      i.date,
      i.metal || 'Silver',
      i.type,
      i.name,
      i.year || '',
      i.qty,
      parseFloat(i.weight).toFixed(4),
      i.weightUnit || 'oz',
      parseFloat(i.purity) || 1.0,
      formatCurrency(purchasePrice),
      currentSpot > 0 ? formatCurrency(meltValue) : '—',
      formatCurrency(i.marketValue || 0),
      gainLoss !== null ? formatCurrency(gainLoss) : '—',
      i.purchaseLocation,
      i.numistaId || '',
      i.pcgsNumber || '',
      i.grade || '',
      i.gradingAuthority || '',
      i.certNumber || '',
      i.serialNumber || '',
      i.notes || '',
      i.uuid || '',
      i.obverseImageUrl || '',
      i.reverseImageUrl || '',
      i.disposition ? (DISPOSITION_TYPES[i.disposition.type]?.label || i.disposition.type) : '',
      i.disposition?.date || '',
      i.disposition ? (i.disposition.amount || 0) : '',
      i.disposition ? (i.disposition.realizedGainLoss || 0) : ''
    ]);
  }

  var _csvOrigin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
  var _originComment = '# exportOrigin: ' + _csvOrigin + '\n';
  const csv = _originComment + Papa.unparse([headers, ...rows]);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `metal_inventory_${timestamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  debugLog('exportCsv complete');
};

/**
 * Imports inventory data from JSON file
 *
 * @param {File} file - JSON file to import
 * @param {boolean} [override=false] - Replace existing inventory instead of merging
 */
const importJson = (file, override = false) => {
  const reader = new FileReader();
  debugLog('importJson start', file.name);

  reader.onload = function(e) {
    try {
      const rawParsed = JSON.parse(e.target.result);

      // Support both plain array and { items: [], settings: {}, exportMeta: {} } object formats
      let data;
      let parsedSettings = null;
      let parsedMeta = null;
      if (Array.isArray(rawParsed)) {
        data = rawParsed;
      } else if (rawParsed && typeof rawParsed === 'object' && Array.isArray(rawParsed.items)) {
        data = rawParsed.items;
        parsedSettings = rawParsed.settings || null;
        parsedMeta = rawParsed.exportMeta || null;
      } else {
        if (typeof showAppAlert === 'function') {
          showAppAlert('Invalid JSON format. Expected an array of inventory items or { items: [], settings: {} }.', 'JSON Import');
        }
        return;
      }

      // Process each item
      let imported = [];
      const skippedDetails = [];
      const skippedNonPM = [];
      const supportedMetals = ['Silver', 'Gold', 'Platinum', 'Palladium'];
      const totalItems = data.length;
      startImportProgress(totalItems);
      let processed = 0;
      let importedCount = 0;

      const pendingTagsByUuid = new Map();

      for (const [index, raw] of data.entries()) {
        processed++;
        debugLog('importJson item', index + 1, JSON.stringify(raw));

        const compositionRaw = raw.composition || raw.metal || 'Silver';
        const composition = getCompositionFirstWords(compositionRaw);
        const metal = parseNumistaMetal(composition);

        // Skip non-precious-metal items
        if (!supportedMetals.includes(metal)) {
          const itemName = raw.name || `Item ${index + 1}`;
          skippedNonPM.push(`${itemName} (${compositionRaw})`);
          updateImportProgress(processed, importedCount, totalItems);
          continue;
        }

        const name = raw.name || '';
        const qty = parseInt(raw.qty ?? raw.quantity ?? 1, 10);
        const type = normalizeType(raw.type || raw.itemType || 'Other');
        const weight = parseFloat(raw.weight ?? raw.weightOz ?? 0);
        const weightUnit = raw.weightUnit || raw['Weight Unit'] || 'oz';
        const purity = parseFloat(raw.purity ?? raw['Purity'] ?? raw['Fineness'] ?? 1.0) || 1.0;
        const priceStr = raw.price ?? raw.purchasePrice ?? 0;
        let price = typeof priceStr === 'string'
          ? parseFloat(priceStr.replace(/[^\d.-]+/g, ''))
          : parseFloat(priceStr);
        if (price < 0) price = 0;
        const purchaseLocation = raw.purchaseLocation || '';
        const storageLocation = raw.storageLocation || 'Unknown';
        const notes = raw.notes || '';
        const year = (raw.year || raw.issuedYear || '').toString().trim();
        const grade = (raw.grade || '').toString().trim();
        const gradingAuthority = (raw.gradingAuthority || raw.authority || '').toString().trim();
        const certNumber = (raw.certNumber || '').toString().trim();
        const pcgsNumber = (raw.pcgsNumber || raw['PCGS #'] || raw['PCGS Number'] || '').toString().trim();
        const pcgsVerified = raw.pcgsVerified || false;
        const serialNumber = (raw.serialNumber || raw['Serial Number'] || '').toString().trim();
        const date = parseDate(raw.date);

        // Parse marketValue (retail price), backward-compatible with legacy fields
        const marketValue = parseFloat(raw.marketValue ?? raw.retailPrice ?? 0) || 0;

        // Legacy field support for backward compatibility
        let spotPriceAtPurchase;
        if (raw.spotPriceAtPurchase) {
          spotPriceAtPurchase = parseFloat(raw.spotPriceAtPurchase);
        } else if (raw.spotPrice || raw.spot) {
          spotPriceAtPurchase = parseFloat(raw.spotPrice || raw.spot);
        } else {
          spotPriceAtPurchase = 0;
        }

        const premiumPerOz = 0;
        const totalPremium = 0;

        const numistaRaw = (raw.numistaId || raw.numista || raw['N#'] || '').toString();
        const numistaMatch = numistaRaw.match(/\d+/);
        const numistaId = numistaMatch ? numistaMatch[0] : '';
        const serial = raw.serial || getNextSerial();
        const uuid = raw.uuid || generateUUID();
        const obverseImageUrl = raw.obverseImageUrl || raw['Obverse Image URL'] || '';
        const reverseImageUrl = raw.reverseImageUrl || raw['Reverse Image URL'] || '';
        const numistaData = raw.numistaData || undefined;
        const fieldMeta = raw.fieldMeta || undefined;

        const processedItem = sanitizeImportedItem({
          metal,
          composition,
          name,
          qty,
          type,
          weight,
          weightUnit,
          price,
          marketValue,
          date,
          purchaseLocation,
          storageLocation,
          notes,
          spotPriceAtPurchase,
          premiumPerOz,
          totalPremium,
          numistaId,
          year,
          grade,
          gradingAuthority,
          certNumber,
          serialNumber,
          pcgsNumber,
          pcgsVerified,
          purity,
          serial,
          uuid,
          obverseImageUrl,
          reverseImageUrl,
          ...(numistaData ? { numistaData } : {}),
          ...(fieldMeta ? { fieldMeta } : {})
        });

        const validation = validateInventoryItem(processedItem);
        if (!validation.isValid) {
          const reason = validation.errors.join(', ');
          skippedDetails.push(`Item ${index + 1}: ${reason}`);
          updateImportProgress(processed, importedCount, totalItems);
          continue;
        }

        addCompositionOption(composition);
        imported.push(processedItem);

        // STAK-126: Import tags from JSON if present
        if (typeof addItemTag === 'function') {
          const jsonTags = raw.tags;
          let pendingTags = [];
          if (Array.isArray(jsonTags)) {
            pendingTags = jsonTags.map(tag => String(tag).trim()).filter(Boolean);
          } else if (typeof jsonTags === 'string' && jsonTags.trim()) {
            pendingTags = jsonTags.split(';').map(t => t.trim()).filter(Boolean);
          }
          if (pendingTags.length > 0) {
            const existing = pendingTagsByUuid.get(processedItem.uuid) || [];
            pendingTagsByUuid.set(processedItem.uuid, [...new Set([...existing, ...pendingTags])]);
          }
        }

        importedCount++;
        updateImportProgress(processed, importedCount, totalItems);
      }

      endImportProgress();

      // Report skipped non-precious-metal items
      if (skippedNonPM.length > 0) {
        if (typeof showAppAlert === 'function') {
          showAppAlert(
            `${skippedNonPM.length} item(s) skipped: no precious metal content\n\n${skippedNonPM.join('\n')}`,
            'JSON Import',
          );
        }
      }

      if (skippedDetails.length > 0) {
        if (typeof showAppAlert === 'function') {
          showAppAlert(`Skipped entries:\n${skippedDetails.join('\n')}`, 'JSON Import');
        }
      }

      if (imported.length === 0) {
        if (typeof showAppAlert === 'function') showAppAlert('No valid items found in JSON file.', 'JSON Import');
        return;
      }

      // Pre-validation — surface skipped items before DiffModal opens
      var _validationResult = null;
      if (typeof buildImportValidationResult === 'function') {
        _validationResult = buildImportValidationResult(imported, skippedNonPM);
        if (_validationResult.valid.length === 0) {
          var _firstReason = _validationResult.invalid.length > 0 ? _validationResult.invalid[0].reasons[0] : 'Unknown error';
          if (typeof showToast === 'function') showToast('No items could be imported: ' + _firstReason);
          return;
        }
        if (_validationResult.skippedCount > 0) {
          if (typeof showToast === 'function') showToast(_validationResult.skippedCount + ' item(s) could not be imported and were skipped.');
        }
        imported = _validationResult.valid;
      }

      // ── Override path: skip DiffEngine, import all directly ──
      if (override) {
        if (typeof addItemTag === 'function') {
          for (const item of imported) {
            const pendingTags = pendingTagsByUuid.get(item.uuid);
            if (pendingTags && pendingTags.length) {
              pendingTags.forEach(tag => addItemTag(item.uuid, tag, false));
            }
          }
          if (typeof saveItemTags === 'function') saveItemTags();
        }

        for (const item of imported) {
          if (typeof registerName === 'function') registerName(item.name);
        }

        inventory = imported;
        if (typeof catalogManager !== 'undefined' && catalogManager.syncInventory) {
          inventory = catalogManager.syncInventory(inventory);
        }
        saveInventory();
        renderTable();
        if (typeof renderActiveFilters === 'function') renderActiveFilters();
        if (typeof updateStorageStats === 'function') updateStorageStats();
        debugLog('importJson override complete', imported.length, 'items replaced');
        if (localStorage.getItem('staktrakr.debug') && typeof window.showDebugModal === 'function') {
          showDebugModal();
        }
        return;
      }

      // ── DiffEngine + DiffModal path (via shared helper) ──
      // Build settings diff if the parsed JSON contains a settings object
      let settingsDiff = null;
      if (parsedSettings && typeof parsedSettings === 'object' &&
          typeof DiffEngine !== 'undefined' && typeof DiffEngine.compareSettings === 'function') {
        const settingsKeys = (typeof SYNC_SCOPE_KEYS !== 'undefined' && Array.isArray(SYNC_SCOPE_KEYS))
          ? SYNC_SCOPE_KEYS.filter(k => k !== 'metalInventory' && k !== 'itemTags')
          : ['displayCurrency', 'appTheme', 'inlineChipConfig', 'filterChipCategoryConfig', 'viewModalSectionConfig', 'chipMinCount'];
        const localSettings = {};
        for (const key of settingsKeys) {
          const val = loadDataSync(key, null);
          if (val !== null) localSettings[key] = val;
        }
        const filteredRemote = {};
        for (const key of settingsKeys) {
          if (key in parsedSettings) filteredRemote[key] = parsedSettings[key];
        }
        if (Object.keys(filteredRemote).length > 0) {
          settingsDiff = DiffEngine.compareSettings(localSettings, filteredRemote);
          // Omit if no changes
          if (settingsDiff.changed.length === 0) settingsDiff = null;
        }
      }

      // Use shared helper for diff review — handles DiffEngine fallback internally
      showImportDiffReview(imported, { type: 'json', label: file.name }, {
        settingsDiff: settingsDiff,
        pendingTagsByUuid: pendingTagsByUuid,
        validationResult: _validationResult,
        exportMeta: parsedMeta,
      }, function(summary) {
        debugLog('importJson DiffEngine complete', summary.added, 'added', summary.modified, 'modified', summary.deleted, 'deleted');
      });
    } catch (error) {
      endImportProgress();
      if (typeof showAppAlert === 'function') {
        showAppAlert(`Error parsing JSON file: ${error.message}`, 'JSON Import');
      }
    }
  };

  reader.readAsText(file);
};

/**
 * Exports current inventory to JSON format
 */
const exportJson = () => {
  debugLog('exportJson start', inventory.length, 'items');
  const timestamp = new Date().toISOString().slice(0,10).replace(/-/g,'');

  const sortedInventory = sortInventoryByDateNewestFirst();

  const exportData = sortedInventory.map(item => ({
    date: item.date,
    metal: item.metal,
    type: item.type,
    name: item.name,
    year: item.year || '',
    qty: item.qty,
    weight: item.weight,
    weightUnit: item.weightUnit || 'oz',
    purity: parseFloat(item.purity) || 1.0,
    price: item.price,
    marketValue: item.marketValue || 0,
    purchaseLocation: item.purchaseLocation,
    storageLocation: item.storageLocation,
    notes: item.notes,
    numistaId: item.numistaId,
    grade: item.grade || '',
    gradingAuthority: item.gradingAuthority || '',
    certNumber: item.certNumber || '',
    serialNumber: item.serialNumber || '',
    pcgsNumber: item.pcgsNumber || '',
    pcgsVerified: item.pcgsVerified || false,
    serial: item.serial,
    uuid: item.uuid,
    obverseImageUrl: item.obverseImageUrl || '',
    reverseImageUrl: item.reverseImageUrl || '',
    // Legacy fields preserved for backward compatibility
    spotPriceAtPurchase: item.spotPriceAtPurchase,
    composition: item.composition,
    numistaData: item.numistaData || null,
    fieldMeta: item.fieldMeta || null
  }));

  // Wrap in metadata envelope so importJson can detect export origin (STAK-374)
  var _exportOrigin = (typeof window !== 'undefined' && window.location) ? window.location.origin : '';
  const exportPayload = {
    items: exportData,
    exportMeta: {
      exportOrigin: _exportOrigin,
      exportDate: new Date().toISOString(),
      version: (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '',
      itemCount: exportData.length
    }
  };

  const json = JSON.stringify(exportPayload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `metal_inventory_${timestamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  debugLog('exportJson complete');
};

/**
 * Exports current inventory to PDF format
 */
const exportPdf = () => {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    appAlert('PDF library (jsPDF) failed to load. Please check your internet connection and reload the page.');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');

  // Sort inventory by date (newest first) for export
  const sortedInventory = sortInventoryByDateNewestFirst();

  // Add title
  doc.setFontSize(16);
  doc.text("StakTrakr", 14, 15);

  // Add date
  doc.setFontSize(10);
  doc.text(`Exported: ${typeof formatTimestamp === 'function' ? formatTimestamp(new Date()) : new Date().toLocaleString()}`, 14, 22);

  // Prepare table data with computed portfolio columns
  const tableData = sortedInventory.map(item => {
    const currentSpot = spotPrices[item.metal.toLowerCase()] || 0;
    const valuation = (typeof computeItemValuation === 'function')
      ? computeItemValuation(item, currentSpot)
      : null;
    const purchasePrice = valuation ? valuation.purchasePrice : (typeof item.price === 'number' ? item.price : parseFloat(item.price) || 0);
    const meltValue = valuation ? valuation.meltValue : computeMeltValue(item, currentSpot);
    const retailTotal = valuation ? valuation.retailTotal : meltValue;
    const gainLoss = valuation ? valuation.gainLoss : null;

    return [
      item.date,
      item.metal,
      item.type,
      item.name,
      item.qty,
      formatWeight(item.weight, item.weightUnit),
      parseFloat(item.purity) || 1.0,
      formatCurrency(purchasePrice),
      currentSpot > 0 ? formatCurrency(meltValue) : '—',
      formatCurrency(retailTotal),
      gainLoss !== null ? formatCurrency(gainLoss) : '—',
      item.purchaseLocation,
      item.numistaId || '',
      item.pcgsNumber || '',
      item.grade || '',
      item.gradingAuthority || '',
      item.certNumber || '',
      item.serialNumber || '',
      item.notes || '',
      (item.uuid || '').slice(0, 8)
    ];
  });

  // Add table
  doc.autoTable({
    head: [['Date', 'Metal', 'Type', 'Name', 'Qty', 'Weight', 'Purity', 'Purchase',
            'Melt Value', 'Retail', 'Gain/Loss', 'Location', 'N#', 'PCGS#', 'Grade', 'Auth', 'Cert#', 'Serial #', 'Notes', 'UUID']],
    body: tableData,
    startY: 30,
    theme: 'striped',
    styles: { fontSize: 7 },
    headStyles: { fillColor: [25, 118, 210] }
  });

  // Add totals
  const finalY = doc.lastAutoTable.finalY || 30;

  // Helper to safely read element text
  const txt = (el) => (el && el.textContent) || '—';

  // Add totals section
  doc.setFontSize(12);
  doc.text("Portfolio Summary", 14, finalY + 10);

  // Silver Totals
  doc.setFontSize(10);
  doc.text("Silver:", 14, finalY + 16);
  doc.text(`Items: ${txt(elements.totals.silver.items)}`, 25, finalY + 22);
  doc.text(`Weight: ${txt(elements.totals.silver.weight)} oz`, 25, finalY + 28);
  doc.text(`Purchase: ${txt(elements.totals.silver.purchased)}`, 25, finalY + 34);
  doc.text(`Melt Value: ${txt(elements.totals.silver.value)}`, 25, finalY + 40);
  doc.text(`Retail: ${txt(elements.totals.silver.retailValue)}`, 25, finalY + 46);
  doc.text(`Gain/Loss: ${txt(elements.totals.silver.lossProfit)}`, 25, finalY + 52);

  // Gold Totals
  doc.text("Gold:", 100, finalY + 16);
  doc.text(`Items: ${txt(elements.totals.gold.items)}`, 111, finalY + 22);
  doc.text(`Weight: ${txt(elements.totals.gold.weight)} oz`, 111, finalY + 28);
  doc.text(`Purchase: ${txt(elements.totals.gold.purchased)}`, 111, finalY + 34);
  doc.text(`Melt Value: ${txt(elements.totals.gold.value)}`, 111, finalY + 40);
  doc.text(`Retail: ${txt(elements.totals.gold.retailValue)}`, 111, finalY + 46);
  doc.text(`Gain/Loss: ${txt(elements.totals.gold.lossProfit)}`, 111, finalY + 52);

  // Platinum Totals
  doc.text("Platinum:", 186, finalY + 16);
  doc.text(`Items: ${txt(elements.totals.platinum.items)}`, 197, finalY + 22);
  doc.text(`Weight: ${txt(elements.totals.platinum.weight)} oz`, 197, finalY + 28);
  doc.text(`Purchase: ${txt(elements.totals.platinum.purchased)}`, 197, finalY + 34);
  doc.text(`Melt Value: ${txt(elements.totals.platinum.value)}`, 197, finalY + 40);
  doc.text(`Retail: ${txt(elements.totals.platinum.retailValue)}`, 197, finalY + 46);
  doc.text(`Gain/Loss: ${txt(elements.totals.platinum.lossProfit)}`, 197, finalY + 52);

  // Palladium Totals
  doc.text("Palladium:", 14, finalY + 60);
  doc.text(`Items: ${txt(elements.totals.palladium.items)}`, 25, finalY + 66);
  doc.text(`Weight: ${txt(elements.totals.palladium.weight)} oz`, 25, finalY + 72);
  doc.text(`Purchase: ${txt(elements.totals.palladium.purchased)}`, 25, finalY + 78);
  doc.text(`Melt Value: ${txt(elements.totals.palladium.value)}`, 25, finalY + 84);
  doc.text(`Retail: ${txt(elements.totals.palladium.retailValue)}`, 25, finalY + 90);
  doc.text(`Gain/Loss: ${txt(elements.totals.palladium.lossProfit)}`, 25, finalY + 96);

  // Save PDF
  doc.save(`metal_inventory_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.pdf`);
};
/**
 * Show or hide the "Realized:" row on all summary cards (STAK-72).
 * Called from settings toggle and on page load.
 */
const applyRealizedVisibility = (show) => {
  const metals = ['Silver', 'Gold', 'Platinum', 'Palladium', 'All'];
  metals.forEach(m => {
    const el = document.getElementById(`realizedGainLoss${m}`);
    if (el && el.parentElement) el.parentElement.style.display = show ? '' : 'none';
  });
};

// =============================================================================
// Expose inventory actions globally for inline event handlers
window.importCsv = importCsv;
window.exportCsv = exportCsv;
window.importJson = importJson;
window.exportJson = exportJson;
window.exportPdf = exportPdf;
window.updateSummary = updateSummary;
window.applyRealizedVisibility = applyRealizedVisibility;
window.toggleGlobalPriceView = toggleGlobalPriceView;
window.editItem = editItem;
window.duplicateItem = duplicateItem;
window.cloneItem = cloneItem;
window.populateNumistaDataFields = populateNumistaDataFields;
window.deleteItem = deleteItem;
window.disposeItem = disposeItem;
window.openRemoveItemModal = openRemoveItemModal;
window.confirmRemoveItem = confirmRemoveItem;
window.undoDisposition = undoDisposition;
window.showNotes = showNotes;

/**
 * Opens a read-only notes viewer for the given inventory index.
 * @param {number} idx - Inventory array index
 */
const showNotesView = (idx) => {
  const item = inventory[idx];
  if (!item) return;
  const titleEl = document.getElementById('notesViewTitle');
  const contentEl = document.getElementById('notesViewContent');
  const editBtn = document.getElementById('notesViewEditBtn');
  if (!contentEl) return;

  if (titleEl) titleEl.textContent = item.name ? `Notes — ${item.name}` : 'Notes';
  contentEl.textContent = item.notes || '(no notes)';

  // Wire edit button to open the full item edit modal
  if (editBtn) {
    editBtn.onclick = () => {
      closeModalById('notesViewModal');
      editItem(idx);
    };
  }

  openModalById('notesViewModal');
};
window.showNotesView = showNotesView;

/**
 * Delegated click handler for inline tag interactions.
 * Uses data attributes and closest() to prevent XSS
 * when item names contain quotes or special characters.
 */
document.addEventListener('click', (e) => {
  // Notes indicator click → view notes (shift+click → edit item)
  const notesInd = e.target.closest('.notes-indicator');
  if (notesInd) {
    e.preventDefault();
    e.stopPropagation();
    const tr = notesInd.closest('tr[data-idx]');
    if (!tr) return;
    const idx = parseInt(tr.dataset.idx, 10);
    if (isNaN(idx)) return;
    if (e.shiftKey) {
      editItem(idx);
    } else {
      showNotesView(idx);
    }
    return;
  }

  // PCGS verify button click → call PCGS API for cert verification
  const verifyBtn = e.target.closest('.pcgs-verify-btn');
  if (verifyBtn) {
    e.preventDefault();
    e.stopPropagation();
    const certNum = verifyBtn.dataset.certNumber || '';
    if (!certNum || typeof verifyPcgsCert !== 'function') return;

    const tr = verifyBtn.closest('tr[data-idx]');
    const idx = tr ? parseInt(tr.dataset.idx, 10) : -1;

    verifyBtn.classList.add('pcgs-verifying');
    verifyBtn.title = 'Verifying...';

    verifyPcgsCert(certNum).then(result => {
      verifyBtn.classList.remove('pcgs-verifying');
      if (result.verified) {
        verifyBtn.classList.add('pcgs-verified');
        if (idx >= 0 && inventory[idx]) {
          inventory[idx].pcgsVerified = true;
          saveInventory();
        }
        const parts = [];
        if (result.grade) parts.push(`Grade: ${result.grade}`);
        if (result.population) parts.push(`Pop: ${result.population}`);
        if (result.popHigher) parts.push(`Pop Higher: ${result.popHigher}`);
        if (result.priceGuide) parts.push(`Price Guide: $${Number(result.priceGuide).toLocaleString()}`);
        verifyBtn.title = `Verified — ${parts.join(' | ')}`;
      } else {
        verifyBtn.title = result.error || 'Verification failed';
        verifyBtn.classList.add('pcgs-verify-failed');
        setTimeout(() => verifyBtn.classList.remove('pcgs-verify-failed'), 3000);
      }
    });
    return;
  }

  // Numista N# tag click → open Numista in popup window
  const numistaTag = e.target.closest('.numista-tag');
  if (numistaTag) {
    e.preventDefault();
    e.stopPropagation();
    const nId = numistaTag.dataset.numistaId;
    const coinName = numistaTag.dataset.coinName || '';
    if (nId && typeof openNumistaModal === 'function') {
      openNumistaModal(nId, coinName);
    }
    return;
  }

  // PCGS# tag click → open PCGS CoinFacts in popup window
  const pcgsTagEl = e.target.closest('.pcgs-tag');
  if (pcgsTagEl) {
    e.preventDefault();
    e.stopPropagation();
    const pcgsNo = pcgsTagEl.dataset.pcgsNumber || '';
    const gradeNum = (pcgsTagEl.dataset.grade || '').match(/\d+/)?.[0] || '';
    if (pcgsNo) {
      const url = `https://www.pcgs.com/coinfacts/coin/detail/${encodeURIComponent(pcgsNo)}/${encodeURIComponent(gradeNum)}`;
      const popup = window.open(url, `pcgs_${pcgsNo}`,
        'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no');
      if (!popup) {
        appAlert(`Popup blocked! Please allow popups or manually visit:\n${url}`);
      } else {
        popup.focus();
      }
    }
    return;
  }

  // Grade tag click → open cert verification URL
  const gradeTag = e.target.closest('.grade-tag[data-clickable="true"]');
  if (gradeTag) {
    e.preventDefault();
    e.stopPropagation();
    const authority = gradeTag.dataset.authority || '';
    const certNum = gradeTag.dataset.certNumber || '';
    if (authority && typeof CERT_LOOKUP_URLS !== 'undefined' && CERT_LOOKUP_URLS[authority]) {
      let url = CERT_LOOKUP_URLS[authority].replaceAll('{certNumber}', encodeURIComponent(certNum));
      const gradeNum = (gradeTag.dataset.grade || '').match(/\d+/)?.[0] || '';
      url = url.replace('{grade}', encodeURIComponent(gradeNum));
      const popup = window.open(url, `cert_${authority}_${certNum || Date.now()}`,
        'width=1250,height=800,scrollbars=yes,resizable=yes,toolbar=no,location=no,menubar=no,status=no');
      if (!popup) {
        appAlert(`Popup blocked! Please allow popups or manually visit:\n${url}`);
      } else {
        popup.focus();
      }
    }
    return;
  }

  const buyLink = e.target.closest('.ebay-buy-link');
  if (buyLink) {
    e.preventDefault();
    e.stopPropagation();
    openEbayBuySearch(buyLink.dataset.search);
    return;
  }
  const soldLink = e.target.closest('.ebay-sold-link');
  if (soldLink) {
    e.preventDefault();
    e.stopPropagation();
    openEbaySoldSearch(soldLink.dataset.search);
    return;
  }
});

/**
 * Shift+click inline editing — power user shortcut for editable cells.
 * Capture-phase listener intercepts shift+clicks before inline onclick
 * handlers (filterLink) and bubble-phase eBay handlers can fire.
 */
document.addEventListener('click', (e) => {
  if (!e.shiftKey) return;
  const td = e.target.closest('#inventoryTable td[data-column]');
  if (!td) return;
  const EDITABLE = {
    name: 'name',
    qty: 'qty',
    weight: 'weight',
    purchasePrice: 'price',
    retailPrice: 'marketValue',
    purchaseLocation: 'purchaseLocation'
  };
  const field = EDITABLE[td.dataset.column];
  if (!field) return;
  const tr = td.closest('tr[data-idx]');
  if (!tr) return;
  const idx = parseInt(tr.dataset.idx, 10);
  if (isNaN(idx)) return;
  e.preventDefault();
  e.stopPropagation();
  startCellEdit(idx, field, td);
}, true); // capture phase

// =============================================================================
// THUMBNAIL POPOVER  (image view + upload for main table)
// =============================================================================

/**
 * Opens a fixed-position popover anchored below (or above) the image cell.
 * Shows a large preview of the resolved image for each visible side, with
 * Upload, Camera (mobile/HTTPS only), and Remove buttons.
 * Saves directly to imageCache and refreshes the row's thumbnails.
 *
 * @param {HTMLTableDataCellElement} cell  - the td[data-column="image"] element
 * @param {Object} item                   - the full inventory item object
 */
function _openThumbPopover(cell, item) {
  // Toggle off if same cell clicked again
  const existing = document.getElementById('thumbPopover');
  if (existing) {
    existing.remove();
    if (existing.dataset.forUuid === (item.uuid || '')) return;
  }

  const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);
  const showCamera = isMobile && isSecure;

  const { showObv, showRev } = (() => {
    const s = localStorage.getItem('tableImageSides') || 'both';
    return { showObv: s === 'both' || s === 'obverse', showRev: s === 'both' || s === 'reverse' };
  })();

  // Build side HTML helper
  const sideHtml = (sideKey, label) => `
    <div class="bulk-img-popover-side">
      <span class="bulk-img-popover-label">${label}</span>
      <div class="bulk-img-popover-preview thumb-popover-preview" id="thumbPop_${sideKey}_preview"></div>
      <div class="bulk-img-popover-actions">
        <input type="file" id="thumbPop_${sideKey}_file" accept="image/jpeg,image/png,image/webp" style="display:none" />
        <button class="btn btn-sm" id="thumbPop_${sideKey}_upload" type="button">Upload</button>
        ${showCamera ? `<button class="btn btn-sm" id="thumbPop_${sideKey}_camera" type="button">📷</button>` : ''}
        <button class="btn btn-sm btn-danger" id="thumbPop_${sideKey}_remove" type="button" style="display:none">Remove</button>
      </div>
    </div>`;

  const pop = document.createElement('div');
  pop.id = 'thumbPopover';
  pop.className = 'bulk-img-popover thumb-popover';
  pop.dataset.forUuid = item.uuid || '';

  pop.innerHTML = `
    <div class="bulk-img-popover-header">
      <span class="bulk-img-popover-title">${item.name ? sanitizeHtml(item.name.slice(0, 28) + (item.name.length > 28 ? '…' : '')) : 'Photos'}</span>
      <button class="bulk-img-popover-close" type="button" aria-label="Close">×</button>
    </div>
    <div class="bulk-img-popover-sides">
      ${showObv ? sideHtml('obv', 'Obverse') : ''}
      ${showRev ? sideHtml('rev', 'Reverse') : ''}
    </div>`;

  document.body.appendChild(pop);

  // Position: below cell, flip above if near viewport bottom
  const rect = cell.getBoundingClientRect();
  const popW = 300;
  let left = rect.left;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  let top = rect.bottom + 4;
  if (top + 340 > window.innerHeight) top = rect.top - 344;
  pop.style.left = Math.max(4, left) + 'px';
  pop.style.top  = Math.max(4, top) + 'px';

  // Close handlers
  const closePopover = () => pop.remove();
  pop.querySelector('.bulk-img-popover-close').addEventListener('click', closePopover);
  const _onOutside = (e) => {
    if (!pop.contains(e.target) && e.target !== cell) {
      closePopover();
      document.removeEventListener('click', _onOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', _onOutside, true), 10);

  // Track blob URLs created here so they're revoked with the main pool
  const _popBlobUrls = [];
  const _track = (url) => { if (url) { _thumbBlobUrls.push(url); _popBlobUrls.push(url); } return url; };

  // Load existing images into previews
  const _loadPreview = async (sideKey, side) => {
    const previewEl = document.getElementById(`thumbPop_${sideKey}_preview`);
    const removeBtn = document.getElementById(`thumbPop_${sideKey}_remove`);
    if (!previewEl) return;

    let url = null;
    if (window.imageCache?.isAvailable()) {
      url = _track(await imageCache.resolveImageUrlForItem(item, side));
    }
    // Fallback to CDN URL strings
    if (!url) {
      url = side === 'obverse' ? (item.obverseImageUrl || null) : (item.reverseImageUrl || null);
      if (url && !/^https?:\/\//i.test(url)) url = null;
    }

    if (url) {
      previewEl.innerHTML = `<img src="${url}" alt="${side}" class="bulk-img-popover-img" />`;
      if (removeBtn) removeBtn.style.display = '';
    } else {
      previewEl.innerHTML = `<span class="thumb-popover-empty">No image</span>`;
    }
  };

  if (showObv) _loadPreview('obv', 'obverse');
  if (showRev) _loadPreview('rev', 'reverse');

  // Refresh the row thumbnails after a change
  const _refreshRowThumbs = () => {
    if (!featureFlags.isEnabled('COIN_IMAGES') || !window.imageCache?.isAvailable()) return;
    const row = document.querySelector(`#inventoryTable tr[data-idx]`);
    // Find by uuid via data attribute on the img
    const thumbImg = document.querySelector(`#inventoryTable .table-thumb[data-item-uuid="${CSS.escape(item.uuid || '')}"]`);
    if (thumbImg) {
      // Revoke old blob URL for this specific image
      if (thumbImg.src && thumbImg.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(thumbImg.src); } catch { /* ignore */ }
      }
      thumbImg.src = '';
      thumbImg.style.visibility = 'hidden';
      thumbImg.removeAttribute('src');
      _loadThumbImage(thumbImg);
    }
    // Refresh popover previews too
    if (showObv) _loadPreview('obv', 'obverse');
    if (showRev) _loadPreview('rev', 'reverse');
  };

  // Handle upload for one side
  const _handleUpload = async (file, side) => {
    if (!file || typeof imageProcessor === 'undefined') return;
    const result = await imageProcessor.processFile(file, {
      maxDim:   typeof IMAGE_MAX_DIM   !== 'undefined' ? IMAGE_MAX_DIM   : 600,
      maxBytes: typeof IMAGE_MAX_BYTES !== 'undefined' ? IMAGE_MAX_BYTES : 512000,
    });
    if (!result?.blob) return;

    let obvBlob = side === 'obverse' ? result.blob : null;
    let revBlob = side === 'reverse' ? result.blob : null;
    // Merge: keep the other side if it exists
    try {
      const existing = await imageCache.getUserImage(item.uuid);
      if (existing) {
        if (!obvBlob && existing.obverse) obvBlob = existing.obverse;
        if (!revBlob && existing.reverse) revBlob = existing.reverse;
      }
    } catch { /* ignore */ }
    if (!obvBlob && revBlob) { obvBlob = revBlob; revBlob = null; }

    await imageCache.cacheUserImage(item.uuid, obvBlob, revBlob);
    _refreshRowThumbs();
  };

  // Wire Upload + Camera buttons for each visible side
  const _wireSide = (sideKey, side) => {
    const fileInput = document.getElementById(`thumbPop_${sideKey}_file`);
    const uploadBtn = document.getElementById(`thumbPop_${sideKey}_upload`);
    const cameraBtn = document.getElementById(`thumbPop_${sideKey}_camera`);
    const removeBtn = document.getElementById(`thumbPop_${sideKey}_remove`);
    if (!fileInput) return;

    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => {
        fileInput.removeAttribute('capture');
        fileInput.click();
      });
    }
    if (cameraBtn) {
      cameraBtn.addEventListener('click', () => {
        fileInput.setAttribute('capture', 'environment');
        fileInput.click();
      });
    }
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) _handleUpload(fileInput.files[0], side);
    });

    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        if (!window.imageCache?.isAvailable()) return;
        const existing = await imageCache.getUserImage(item.uuid);
        if (!existing) return;
        const keepObv = side === 'reverse' ? existing.obverse : null;
        const keepRev = side === 'obverse' ? existing.reverse : null;
        if (!keepObv && !keepRev) {
          await imageCache.deleteUserImage(item.uuid);
        } else {
          const o = keepObv || keepRev;
          const r = keepObv ? keepRev : null;
          await imageCache.cacheUserImage(item.uuid, o, r);
        }
        _refreshRowThumbs();
      });
    }
  };

  if (showObv) _wireSide('obv', 'obverse');
  if (showRev) _wireSide('rev', 'reverse');
}

/**
 * Phase 1C: Storage optimization and housekeeping
 */
function optimizeStoragePhase1C(){
  try{
    if (typeof catalogManager !== 'undefined' && catalogManager && typeof catalogManager.removeOrphanedMappings === 'function'){
      catalogManager.removeOrphanedMappings();
    }
    if (typeof generateStorageReport === 'function'){
      const report = generateStorageReport();
      debugLog('Storage Optimization: Total localStorage ~', report.totalKB, 'KB');
      if (typeof initializeStorageChart === 'function'){
        try { initializeStorageChart(report); } catch (e) { debugWarn('Storage chart init failed', e); }
      }
    }
  } catch(e){
    debugWarn('optimizeStoragePhase1C error', e);
  }
}
if (typeof window !== 'undefined'){ window.optimizeStoragePhase1C = optimizeStoragePhase1C; }
