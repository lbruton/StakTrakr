// Backup/restore functions extracted from inventory.js (STAK-484)

(function () {
  "use strict";

  const createBackupZip = async () => {
    try {
      const backupBtn = safeGetElement("exportZipBtn");
      const originalText = backupBtn ? backupBtn.textContent : "";
      if (backupBtn) {
        backupBtn.textContent = "Creating Backup...";
        backupBtn.disabled = true;
      }

      const zip = new JSZip();
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const timeFormatted =
        typeof formatTimestamp === "function"
          ? formatTimestamp(new Date())
          : new Date().toLocaleString();

      // 1. Add main inventory data (JSON)
      const inventoryData = {
        version: APP_VERSION,
        exportDate: new Date().toISOString(),
        inventory: inventory.map((item) => ({
          metal: item.metal,
          composition: item.composition,
          name: item.name,
          qty: item.qty,
          type: item.type,
          weight: item.weight,
          weightUnit: item.weightUnit || "oz",
          purity: item.purity || 1.0,
          price: item.price,
          purchasePrice: item.purchasePrice || 0,
          // Canonical retail price field; CSV "Retail Price" remains marketValue.
          retailPrice: item.retailPrice || 0,
          date: item.date,
          ...(item.paymentMethod && { paymentMethod: item.paymentMethod }),
          purchaseLocation: item.purchaseLocation,
          storageLocation: item.storageLocation,
          notes: item.notes,
          spotPriceAtPurchase: item.spotPriceAtPurchase,
          premiumPerOz: item.premiumPerOz,
          totalPremium: item.totalPremium,
          marketValue: item.marketValue || 0,
          collectable: item.collectable || false,
          ignorePatternImages: item.ignorePatternImages || false,
          currency: item.currency || "",
          numistaId: item.numistaId,
          numistaData: item.numistaData || null,
          year: item.year || "",
          grade: item.grade || "",
          gradingAuthority: item.gradingAuthority || "",
          certNumber: item.certNumber || "",
          serialNumber: item.serialNumber || "",
          pcgsNumber: item.pcgsNumber || "",
          pcgsVerified: item.pcgsVerified || false,
          serial: item.serial,
          uuid: item.uuid,
          obverseImageUrl: item.obverseImageUrl || "",
          reverseImageUrl: item.reverseImageUrl || "",
          obverseImageFrame: item.obverseImageFrame || "",
          reverseImageFrame: item.reverseImageFrame || "",
          obverseSharedImageId: item.obverseSharedImageId || null,
          reverseSharedImageId: item.reverseSharedImageId || null,
          tradedFromUuid: item.tradedFromUuid || null,
          lastModified: item.lastModified || "",
          capsule: item.capsule || "",
          capsuleNotes: item.capsuleNotes || "",
          fieldMeta: item.fieldMeta || null,
          attachments: item.attachments || [],
          disposition: item.disposition || null,
        })),
      };
      zip.file("inventory_data.json", JSON.stringify(inventoryData, null, 2));

      // 2. Add current spot prices, settings, and catalog mappings
      const settings = {
        version: APP_VERSION,
        exportDate: new Date().toISOString(),
        exportOrigin:
          typeof window !== "undefined" && window.location ? window.location.origin : "",
        spotPrices: spotPrices,
        theme: localStorage.getItem(THEME_KEY) || "light",
        itemsPerPage: itemsPerPage,
        searchQuery: searchQuery,
        sortColumn: sortColumn,
        sortDirection: sortDirection,
        catalogMappings: catalogManager.exportMappings(),
        chipCustomGroups: loadDataSync("chipCustomGroups", []),
        chipBlacklist: loadDataSync("chipBlacklist", []),
        chipMinCount: localStorage.getItem("chipMinCount"),
        chipMaxCount: localStorage.getItem("chipMaxCount"),
        featureFlags: localStorage.getItem(FEATURE_FLAGS_KEY),
        inlineChipConfig: localStorage.getItem("inlineChipConfig"),
        spotPricingSource: loadDataSync(SPOT_PRICING_SOURCE_KEY, "STAKTRAKR"),
        metalSpotPrices: loadDataSync("metalSpotPrices", {}),
        goldbackPrices: goldbackPrices,
        goldbackPriceHistory: goldbackPriceHistory,
        goldbackEnabled: goldbackEnabled,
        goldbackEstimateEnabled: goldbackEstimateEnabled,
        goldbackEstimateModifier: goldbackEstimateModifier,
        tableImageSides: localStorage.getItem("tableImageSides") || "both",
        tableImagesEnabled: localStorage.getItem("tableImagesEnabled") !== "false",
      };
      zip.file("settings.json", JSON.stringify(settings, null, 2));

      // 3. Add spot price history — skipped when owned by IndexedDB (STRK-141, R7.2).
      // Spot history is reproducible from the API and is never written to a backup.
      if (!HISTORY_IDB_KEYS.includes(SPOT_HISTORY_KEY)) {
        const spotHistoryData = {
          version: APP_VERSION,
          exportDate: new Date().toISOString(),
          history: spotHistory,
        };
        zip.file("spot_price_history.json", JSON.stringify(spotHistoryData, null, 2));
      }

      // 3a-retail. Add retail market prices (STAK-217).
      // Retail history is skipped when owned by IndexedDB (STRK-141, R7.2); current
      // retail prices (a separate, non-history key) are still exported.
      const retailPricesData = loadDataSync(RETAIL_PRICES_KEY) || null;
      if (retailPricesData) {
        zip.file("retail_prices.json", JSON.stringify(retailPricesData, null, 2));
      }
      if (!HISTORY_IDB_KEYS.includes(RETAIL_PRICE_HISTORY_KEY)) {
        const retailHistoryData = loadDataSync(RETAIL_PRICE_HISTORY_KEY) || {};
        if (Object.keys(retailHistoryData).length > 0) {
          zip.file("retail_price_history.json", JSON.stringify(retailHistoryData, null, 2));
        }
      }

      // 3b. Add per-item price history (STACK-43)
      const itemPriceHistoryData = {
        version: APP_VERSION,
        exportDate: new Date().toISOString(),
        history: itemPriceHistory,
      };
      zip.file("item_price_history.json", JSON.stringify(itemPriceHistoryData, null, 2));

      // 3c. Add item tags (STAK-126)
      if (typeof itemTags !== "undefined" && Object.keys(itemTags).length > 0) {
        const itemTagsData = {
          version: APP_VERSION,
          exportDate: new Date().toISOString(),
          tags: itemTags,
        };
        zip.file("item_tags.json", JSON.stringify(itemTagsData, null, 2));
      }

      // 4. Generate and add CSV export (portfolio format -- synced with exportCsv())
      const csvHeaders = [
        "Date",
        "Metal",
        "Type",
        "Name",
        "Year",
        "Qty",
        "Weight(oz)",
        "Weight Unit",
        "Purity",
        "Purchase Price",
        "Melt Value",
        "Retail Price",
        "Gain/Loss",
        "Payment Method",
        "Purchase Location",
        "Storage Location",
        "N#",
        "PCGS #",
        "Grade",
        "Grading Authority",
        "Cert #",
        "Serial Number",
        "Notes",
        "Tags",
        "UUID",
        "Obverse Image URL",
        "Reverse Image URL",
        "Obverse Frame",
        "Reverse Frame",
        "Disposition Type",
        "Disposition Date",
        "Disposition Amount",
        "Realized Gain/Loss",
        "Attachments",
      ];
      const sortedInventory = sortInventoryByDateNewestFirst();
      const csvRows = [];
      for (const item of sortedInventory) {
        const currentSpot = spotPrices[item.metal.toLowerCase()] || 0;
        const valuation =
          typeof computeItemValuation === "function"
            ? computeItemValuation(item, currentSpot)
            : null;
        const purchasePrice = valuation
          ? valuation.purchasePrice
          : typeof item.price === "number"
            ? item.price
            : parseFloat(item.price) || 0;
        const meltValue = valuation ? valuation.meltValue : computeMeltValue(item, currentSpot);
        const gainLoss = valuation ? valuation.gainLoss : null;

        csvRows.push([
          item.date,
          item.metal || "Silver",
          item.type,
          item.name,
          item.year || "",
          item.qty,
          parseFloat(item.weight).toFixed(4),
          item.weightUnit || "oz",
          parseFloat(item.purity) || 1.0,
          formatCurrency(purchasePrice),
          currentSpot > 0 ? formatCurrency(meltValue) : "\u2014",
          formatCurrency(item.marketValue || 0),
          gainLoss !== null ? formatCurrency(gainLoss) : "\u2014",
          item.paymentMethod || "",
          item.purchaseLocation,
          item.storageLocation || "",
          item.numistaId || "",
          item.pcgsNumber || "",
          item.grade || "",
          item.gradingAuthority || "",
          item.certNumber || "",
          item.serialNumber || "",
          item.notes || "",
          typeof getItemTags === "function" ? getItemTags(item.uuid).join("; ") : "",
          item.uuid || "",
          item.obverseImageUrl || "",
          item.reverseImageUrl || "",
          item.obverseImageFrame || "",
          item.reverseImageFrame || "",
          item.disposition
            ? typeof DISPOSITION_TYPES !== "undefined" && DISPOSITION_TYPES[item.disposition.type]
              ? DISPOSITION_TYPES[item.disposition.type].label
              : item.disposition.type
            : "",
          item.disposition ? item.disposition.date || "" : "",
          item.disposition ? item.disposition.amount || 0 : "",
          item.disposition ? item.disposition.realizedGainLoss || 0 : "",
          Array.isArray(item.attachments) && item.attachments.length > 0
            ? item.attachments.map((a) => `${a.fileName}#${a.attachmentUuid}`).join("|")
            : "",
        ]);
      }
      const csvContent = Papa.unparse([csvHeaders, ...csvRows]);
      zip.file("inventory_export.csv", csvContent);

      // 5. Generate and add HTML export (simplified version)
      const htmlContent = generateBackupHtml(sortedInventory, timeFormatted);
      zip.file("inventory_report.html", htmlContent);

      // 7. Add README file
      const readmeContent = generateReadmeContent(timeFormatted);
      zip.file("README.txt", readmeContent);

      // 8. Add sample data for reference
      if (inventory.length > 0) {
        const sampleData = inventory.slice(0, Math.min(5, inventory.length)).map((item) => ({
          metal: item.metal,
          name: item.name,
          qty: item.qty,
          type: item.type,
          weight: item.weight,
          weightUnit: item.weightUnit || "oz",
          purity: item.purity || 1.0,
          price: item.price,
          date: item.date,
          paymentMethod: item.paymentMethod || "",
          purchaseLocation: item.purchaseLocation,
          storageLocation: item.storageLocation,
          notes: item.notes,
          numistaId: item.numistaId,
          serialNumber: item.serialNumber || "",
          marketValue: item.marketValue || 0,
          serial: item.serial,
        }));
        zip.file("sample_data.json", JSON.stringify(sampleData, null, 2));
      }

      // 9. Add cached coin metadata (STACK-88)
      if (window.imageCache?.isAvailable()) {
        const allMeta = await imageCache.exportAllMetadata();
        if (allMeta.length > 0) {
          zip.file(
            "image_metadata.json",
            JSON.stringify(
              {
                version: APP_VERSION,
                exportDate: new Date().toISOString(),
                count: allMeta.length,
                metadata: allMeta,
              },
              null,
              2
            )
          );
        }

        // User-uploaded photos (keyed by item UUID) -- STAK-225
        const allUserImages = await imageCache.exportAllUserImages();
        if (allUserImages.length > 0) {
          const userImgFolder = zip.folder("user_images");
          const userImageManifest = {
            version: APP_VERSION,
            exportDate: new Date().toISOString(),
            entries: [],
          };
          for (const rec of allUserImages) {
            if (rec.obverse) userImgFolder.file(`${rec.uuid}_obverse.jpg`, rec.obverse);
            if (rec.reverse) userImgFolder.file(`${rec.uuid}_reverse.jpg`, rec.reverse);
            const item =
              typeof inventory !== "undefined" ? inventory.find((i) => i.uuid === rec.uuid) : null;
            userImageManifest.entries.push({
              uuid: rec.uuid,
              itemName: item?.name || "",
              hasObverse: !!rec.obverse,
              hasReverse: !!rec.reverse,
              obverseFile: rec.obverse ? `user_images/${rec.uuid}_obverse.jpg` : null,
              reverseFile: rec.reverse ? `user_images/${rec.uuid}_reverse.jpg` : null,
              cachedAt: rec.cachedAt || null,
              size: rec.size || 0,
            });
          }
          zip.file("user_image_manifest.json", JSON.stringify(userImageManifest, null, 2));
        }

        // User-uploaded attachments (PDFs, images) -- STRK-45
        if (typeof attachmentManager !== "undefined" && attachmentManager.isAvailable()) {
          const allAttachments = await attachmentManager.exportAllAttachments();
          if (allAttachments.length > 0) {
            const attachFolder = zip.folder("user_attachments");
            const attachManifest = {
              version: APP_VERSION,
              exportDate: new Date().toISOString(),
              entries: [],
            };
            for (const rec of allAttachments) {
              const ext = rec.fileName.includes(".") ? rec.fileName.split(".").pop() : "bin";
              const zipPath = `user_attachments/${rec.attachmentUuid}.${ext}`;
              attachFolder.file(`${rec.attachmentUuid}.${ext}`, rec.blob);
              attachManifest.entries.push({
                attachmentUuid: rec.attachmentUuid,
                itemUuid: rec.itemUuid,
                file: zipPath,
                fileName: rec.fileName,
                type: rec.type,
                size: rec.size,
                uploadedAt: rec.uploadedAt,
              });
            }
            zip.file("user_attachment_manifest.json", JSON.stringify(attachManifest, null, 2));
          }
        }

        // Custom pattern rule images (keyed by rule ID) -- STAK-225
        const allPatternImages = await imageCache.exportAllPatternImages();
        if (allPatternImages.length > 0) {
          const patternImgFolder = zip.folder("pattern_images");
          for (const rec of allPatternImages) {
            if (rec.obverse) patternImgFolder.file(`${rec.ruleId}_obverse.jpg`, rec.obverse);
            if (rec.reverse) patternImgFolder.file(`${rec.ruleId}_reverse.jpg`, rec.reverse);
          }
        }
      }

      // Generate and download the ZIP file
      const zipBlob = await zip.generateAsync({ type: "blob", streamFiles: true });
      const url = URL.createObjectURL(zipBlob);

      const a = document.createElement("a");
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

      appAlert("Backup created successfully!");
      return zipBlob;
    } catch (error) {
      debugWarn("Backup creation failed:", error);
      appAlert("Backup creation failed: " + error.message);

      // Restore button state on error
      const backupBtn = safeGetElement("exportZipBtn");
      if (backupBtn) {
        backupBtn.textContent = "Export ZIP";
        backupBtn.disabled = false;
      }
      return null;
    }
  };

  const restoreBackupZip = async (file) => {
    // STAK-427: Block restore while cloud sync is applying remote changes
    if (window.CloudSync && window.CloudSync.isSyncActive()) {
      showToast("Cloud sync is in progress \u2014 please wait a moment and try again.", "warning");
      return;
    }
    try {
      const zip = await JSZip.loadAsync(file);

      // -- Phase 1: Parse all ZIP contents without writing to storage (STAK-457) --

      // 1a. Parse inventory items
      let parsedItems = [];
      const inventoryStr = await zip.file("inventory_data.json")?.async("string");
      if (inventoryStr) {
        const invObj = JSON.parse(inventoryStr);
        parsedItems = invObj.inventory || [];
      }

      // 1b. Parse settings and build a flat key->value map for DiffEngine
      let settingsObj = null;
      const remoteSettings = {};
      const settingsStr = await zip.file("settings.json")?.async("string");
      if (settingsStr) {
        settingsObj = JSON.parse(settingsStr);

        if (settingsObj.theme) remoteSettings["appTheme"] = settingsObj.theme;
        if (settingsObj.itemsPerPage != null)
          remoteSettings["settingsItemsPerPage"] = settingsObj.itemsPerPage;
        if (settingsObj.sortColumn != null)
          remoteSettings["defaultSortColumn"] = settingsObj.sortColumn;
        if (settingsObj.sortDirection != null)
          remoteSettings["defaultSortDir"] = settingsObj.sortDirection;
        if (settingsObj.tableImageSides != null)
          remoteSettings["tableImageSides"] = settingsObj.tableImageSides;
        if (settingsObj.tableImagesEnabled != null)
          remoteSettings["tableImagesEnabled"] = settingsObj.tableImagesEnabled;
        if (Array.isArray(settingsObj.chipCustomGroups))
          remoteSettings["chipCustomGroups"] = settingsObj.chipCustomGroups;
        if (Array.isArray(settingsObj.chipBlacklist))
          remoteSettings["chipBlacklist"] = settingsObj.chipBlacklist;
        if (settingsObj.chipMinCount != null)
          remoteSettings["chipMinCount"] = settingsObj.chipMinCount;
        if (settingsObj.chipMaxCount != null)
          remoteSettings["chipMaxCount"] = settingsObj.chipMaxCount;
        if (settingsObj.featureFlags != null)
          remoteSettings[FEATURE_FLAGS_KEY] = settingsObj.featureFlags;
        if (settingsObj.inlineChipConfig != null)
          remoteSettings["inlineChipConfig"] = settingsObj.inlineChipConfig;
        if (settingsObj.spotPricingSource != null)
          remoteSettings[SPOT_PRICING_SOURCE_KEY] = settingsObj.spotPricingSource;
        if (settingsObj.metalSpotPrices != null)
          remoteSettings["metalSpotPrices"] = settingsObj.metalSpotPrices;
        if (settingsObj.goldbackEnabled != null)
          remoteSettings[GOLDBACK_ENABLED_KEY] = settingsObj.goldbackEnabled === true;
        if (settingsObj.goldbackEstimateEnabled != null)
          remoteSettings[GOLDBACK_ESTIMATE_ENABLED_KEY] =
            settingsObj.goldbackEstimateEnabled === true;
        if (settingsObj.goldbackEstimateModifier != null) {
          const mod = parseFloat(settingsObj.goldbackEstimateModifier);
          if (!isNaN(mod) && mod > 0) remoteSettings[GB_ESTIMATE_MODIFIER_KEY] = mod;
        }
        if (settingsObj.goldbackPrices != null)
          remoteSettings[GOLDBACK_PRICES_KEY] = settingsObj.goldbackPrices;
        if (settingsObj.goldbackPriceHistory != null)
          remoteSettings[GOLDBACK_PRICE_HISTORY_KEY] = settingsObj.goldbackPriceHistory;
      }

      // 1c. Parse item tags for pendingTagsByUuid (must be a Map -- showImportDiffReview uses .get())
      const pendingTagsByUuid = new Map();
      const itemTagsStr = await zip.file("item_tags.json")?.async("string");
      if (itemTagsStr) {
        try {
          const itemTagsObj = JSON.parse(itemTagsStr);
          if (
            itemTagsObj.tags &&
            typeof itemTagsObj.tags === "object" &&
            !Array.isArray(itemTagsObj.tags)
          ) {
            for (const [uuid, tags] of Object.entries(itemTagsObj.tags)) {
              if (Array.isArray(tags) && tags.length > 0) pendingTagsByUuid.set(uuid, tags);
            }
          }
        } catch (e) {
          debugWarn("restoreBackupZip: item_tags.json parse error", e);
        }
      }

      // 1d. Pre-parse ancillary data (applied after user accepts DiffModal).
      // Spot + retail price history are intentionally not parsed/restored from older
      // backups — they are reproducible from the API and now owned by IndexedDB (STRK-141, R7.3).
      const ancillary = {};

      const itemHistoryStr = await zip.file("item_price_history.json")?.async("string");
      if (itemHistoryStr) ancillary.itemPriceHistory = JSON.parse(itemHistoryStr).history || {};

      const retailPricesStr = await zip.file("retail_prices.json")?.async("string");
      if (retailPricesStr) {
        try {
          ancillary.retailPrices = JSON.parse(retailPricesStr);
        } catch (e) {
          debugWarn("restoreBackupZip: retail_prices.json parse error", e);
        }
      }

      // -- Phase 2: Build settings diff via DiffEngine (STAK-457) --

      let settingsDiff = null;
      if (
        Object.keys(remoteSettings).length > 0 &&
        typeof DiffEngine !== "undefined" &&
        typeof DiffEngine.compareSettings === "function"
      ) {
        const settingsKeys = Object.keys(remoteSettings);
        const localSettings = {};
        for (const key of settingsKeys) {
          const val = loadDataSync(key, null);
          if (val !== null) localSettings[key] = val;
        }
        settingsDiff = DiffEngine.compareSettings(localSettings, remoteSettings);
        if (settingsDiff.changed.length === 0) settingsDiff = null;
      }

      // -- Phase 3: Ancillary data applicator (runs after user accepts DiffModal) --

      const applyAncillaryData = async () => {
        if (settingsObj && settingsObj.spotPrices) {
          Object.entries(settingsObj.spotPrices).forEach(([metal, price]) => {
            const metalConfig = METALS[metal.toUpperCase()];
            if (metalConfig) saveDataSync(metalConfig.localStorageKey, price);
          });
        }

        if (settingsObj && settingsObj.catalogMappings && typeof catalogManager !== "undefined") {
          catalogManager.importMappings(settingsObj.catalogMappings, false);
        }

        // Spot price history from older backups is intentionally NOT restored —
        // it is reproducible from the API and now owned by IndexedDB (STRK-141, R7.3).

        if (ancillary.itemPriceHistory && typeof mergeItemPriceHistory === "function") {
          mergeItemPriceHistory(ancillary.itemPriceHistory);
        } else if (typeof loadItemPriceHistory === "function") {
          loadItemPriceHistory();
        }

        if (ancillary.retailPrices) {
          saveDataSync(RETAIL_PRICES_KEY, ancillary.retailPrices);
          if (typeof loadRetailPrices === "function") loadRetailPrices();
        }
        // Retail price history from older backups is intentionally NOT restored —
        // reproducible from the API and now owned by IndexedDB (STRK-141, R7.3).

        // Restore cached coin images (STACK-88)
        if (window.imageCache?.isAvailable()) {
          const imgFolder = zip.folder("images");
          const imgEntries = [];
          if (imgFolder) {
            imgFolder.forEach((path, zipFile) => {
              imgEntries.push({ path, file: zipFile });
            });
          }
          if (imgEntries.length > 0) {
            debugLog("ZIP restore: skipping legacy coinImages folder (store deprecated)");
          }

          // Restore metadata
          const metaStr = await zip.file("image_metadata.json")?.async("string");
          if (metaStr) {
            const metaObj = JSON.parse(metaStr);
            if (Array.isArray(metaObj.metadata)) {
              for (const rec of metaObj.metadata) {
                await imageCache.importMetadataRecord(rec);
              }
            }
          }

          // Restore user-uploaded photos (STAK-225 / STAK-226)
          const userImgFolder = zip.folder("user_images");
          if (userImgFolder) {
            const manifestFile = zip.file("user_image_manifest.json");
            if (manifestFile) {
              const manifestData = JSON.parse(await manifestFile.async("string"));
              for (const entry of manifestData.entries || []) {
                const obverseFile = entry.obverseFile ? zip.file(entry.obverseFile) : null;
                const reverseFile = entry.reverseFile ? zip.file(entry.reverseFile) : null;
                const obverse = obverseFile ? await obverseFile.async("blob") : null;
                const reverse = reverseFile ? await reverseFile.async("blob") : null;
                await imageCache.importUserImageRecord({
                  uuid: entry.uuid,
                  obverse,
                  reverse,
                  cachedAt: entry.cachedAt || Date.now(),
                  size: entry.size || (obverse?.size || 0) + (reverse?.size || 0),
                });
              }
            } else {
              const userEntries = [];
              userImgFolder.forEach((path, zipFile) => userEntries.push({ path, file: zipFile }));
              const userImageMap = new Map();
              for (const { path, file: zipFile } of userEntries) {
                const m = path.match(/^(.+)_(obverse|reverse)\.jpg$/);
                if (!m) continue;
                if (!userImageMap.has(m[1])) userImageMap.set(m[1], {});
                userImageMap.get(m[1])[m[2]] = await zipFile.async("blob");
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
          const patternImgFolder = zip.folder("pattern_images");
          if (patternImgFolder) {
            const patternEntries = [];
            patternImgFolder.forEach((path, zipFile) =>
              patternEntries.push({ path, file: zipFile })
            );
            const patternImageMap = new Map();
            for (const { path, file: zipFile } of patternEntries) {
              const m = path.match(/^(.+)_(obverse|reverse)\.jpg$/);
              if (!m) continue;
              if (!patternImageMap.has(m[1])) patternImageMap.set(m[1], {});
              patternImageMap.get(m[1])[m[2]] = await zipFile.async("blob");
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

        // Restore user-uploaded attachments (STRK-45, STRK-65: fail-soft on malformed manifest)
        const attachManifestFile = zip.file("user_attachment_manifest.json");
        if (
          attachManifestFile &&
          typeof attachmentManager !== "undefined" &&
          attachmentManager.isAvailable()
        ) {
          try {
            const acceptedUuids = new Set(
              typeof inventory !== "undefined" ? inventory.map((i) => i.uuid) : []
            );
            const attachManifestData = JSON.parse(await attachManifestFile.async("string"));
            let missingBinaryCount = 0;
            for (const entry of attachManifestData.entries || []) {
              if (!acceptedUuids.has(entry.itemUuid)) continue;
              try {
                const zipFile = entry.file ? zip.file(entry.file) : null;
                const blob = zipFile ? await zipFile.async("blob") : null;
                if (blob) {
                  const ok = await attachmentManager.addAttachment({
                    attachmentUuid: entry.attachmentUuid,
                    itemUuid: entry.itemUuid,
                    fileName: entry.fileName,
                    type: entry.type,
                    size: entry.size,
                    uploadedAt: entry.uploadedAt,
                    blob,
                  });
                  if (!ok) missingBinaryCount++;
                } else {
                  missingBinaryCount++;
                }
              } catch (entryErr) {
                console.warn("Attachment restore entry failed:", entryErr);
                missingBinaryCount++;
              }
            }
            if (missingBinaryCount > 0) {
              if (typeof showToast === "function") {
                showToast(
                  `${missingBinaryCount} attachment file(s) could not be restored — metadata only.`,
                  "warning"
                );
              }
            }
          } catch (attachRestoreErr) {
            console.warn("Attachment manifest parse/restore failed:", attachRestoreErr);
            if (typeof showToast === "function") {
              showToast(
                "Attachment manifest was malformed — inventory restored without attachments.",
                "warning"
              );
            }
          }
        }

        if (typeof reconcileAttachmentOrphans === "function") reconcileAttachmentOrphans();

        if (typeof syncManualSpotStorage === "function") {
          syncManualSpotStorage({ clearMissing: true });
        }
        fetchSpotPrice();
      };

      // -- Phase 4: Route through DiffModal (STAK-457) --

      showImportDiffReview(
        parsedItems,
        { type: "zip", label: file.name },
        {
          settingsDiff: settingsDiff,
          pendingTagsByUuid: pendingTagsByUuid,
          exportMeta: settingsObj
            ? {
                exportOrigin: settingsObj.exportOrigin || null,
                appVersion: settingsObj.version || null,
                exportTimestamp: settingsObj.exportDate || null,
              }
            : null,
        },
        function (summary) {
          debugLog(
            "restoreBackupZip DiffModal complete",
            summary.added,
            "added",
            summary.modified,
            "modified",
            summary.deleted,
            "deleted"
          );
          applyAncillaryData()
            .then(function () {
              showToast("ZIP backup restored successfully");
            })
            .catch(function (ancillaryErr) {
              debugWarn("restoreBackupZip: ancillary data restore partial failure", ancillaryErr);
              showToast(
                "ZIP restored with warnings \u2014 some ancillary data may not have been applied",
                "warning"
              );
            });
        }
      );
    } catch (err) {
      debugWarn("Restore failed", err);
      appAlert("Restore failed: " + err.message);
    }
  };

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
        <th>Purchase Price</th><th>Payment Method</th><th>Purchase Location</th><th>Storage Location</th>
        <th>Notes</th><th>Date</th>
      </tr>
    </thead>
    <tbody>
      ${sortedInventory
        .map(
          (item) => `
        <tr>
          <td>${escapeHtml(getCompositionFirstWords(item.composition || item.metal))}</td>
          <td>${escapeHtml(item.name)}</td>
          <td>${item.qty}</td>
          <td>${escapeHtml(item.type)}</td>
          <td>${formatWeight(item.weight, item.weightUnit)}</td>
          <td>${formatCurrency(item.price)}</td>
          <td>${escapeHtml(item.paymentMethod || "")}</td>
          <td>${escapeHtml(item.purchaseLocation)}</td>
          <td>${escapeHtml(item.storageLocation || "")}</td>
          <td>${escapeHtml(item.notes || "")}</td>
          <td>${escapeHtml(item.date)}</td>
        </tr>
      `
        )
        .join("")}
    </tbody>
  </table>
</body>
</html>`;
  };

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

  window.createBackupZip = createBackupZip;
  window.restoreBackupZip = restoreBackupZip;
  window.generateBackupHtml = generateBackupHtml;
  window.generateReadmeContent = generateReadmeContent;
})();
