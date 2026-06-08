/* inventory-import.js — Import/export functions extracted from inventory.js (STAK-484) */

(function () {
  "use strict";

  // =============================================================================
  // IMPORT/EXPORT FUNCTIONS
  // =============================================================================

  // Import progress utilities
  const startImportProgress = (total) => {
    if (!elements.importProgress || !elements.importProgressText) return;
    elements.importProgress.max = total;
    elements.importProgress.value = 0;
    elements.importProgress.style.display = "block";
    elements.importProgressText.style.display = "block";
    elements.importProgressText.textContent = `0 / ${total} items imported`;
  };

  const updateImportProgress = (processed, imported, total) => {
    if (!elements.importProgress || !elements.importProgressText) return;
    elements.importProgress.value = processed;
    elements.importProgressText.textContent = `${imported} / ${total} items imported`;
  };

  const endImportProgress = () => {
    if (!elements.importProgress || !elements.importProgressText) return;
    elements.importProgress.style.display = "none";
    elements.importProgressText.style.display = "none";
  };

  /**
   * Post-import cleanup — registers names, syncs catalog, saves, and re-renders.
   * @param {Array} newItems - Items that were added during import
   * @param {Map|null} pendingTagsByUuid - Optional map of itemKey -> tag[] for deferred tag application
   */
  const _postImportCleanup = (newItems, pendingTagsByUuid) => {
    // Apply deferred tags if needed (keyed by DiffEngine.computeItemKey)
    if (pendingTagsByUuid && typeof addItemTag === "function") {
      const stampedUuids = new Set();
      for (const item of newItems) {
        const itemKey =
          typeof DiffEngine !== "undefined"
            ? DiffEngine.computeItemKey(item)
            : item.uuid || item.serial || "";
        const tags = pendingTagsByUuid.get(itemKey);
        if (tags && tags.length) {
          tags.forEach((tag) => {
            if (addItemTag(item.uuid, tag, false)) stampedUuids.add(item.uuid);
          });
        }
      }
      if (stampedUuids.size > 0 && typeof stampTagTimestamp === "function") {
        stampTagTimestamp(Array.from(stampedUuids));
      }
      if (typeof saveItemTags === "function") saveItemTags();
    }

    // Register names
    for (const item of newItems) {
      if (typeof registerName === "function") registerName(item.name);
    }

    // Catalog sync, save, render
    if (typeof catalogManager !== "undefined" && catalogManager.syncInventory) {
      inventory = catalogManager.syncInventory(inventory);
    }
    if (typeof clearInventoryRecovery === "function") clearInventoryRecovery();
    if (typeof debugLog === "function") debugLog("inventoryRecovery: cleared by import");
    saveInventory();
    renderTable();
    if (typeof renderActiveFilters === "function") renderActiveFilters();
    if (typeof updateStorageStats === "function") updateStorageStats();
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
    if (typeof migrateLegacySilverbackWeightUnit === "function") {
      migrateLegacySilverbackWeightUnit(parsedItems);
    }

    // Guard: if DiffEngine or DiffModal unavailable, fall back to concat-all
    if (typeof DiffEngine === "undefined" || typeof DiffModal === "undefined") {
      debugLog("showImportDiffReview fallback", "DiffEngine/DiffModal unavailable");
      inventory = inventory.concat(parsedItems);
      _postImportCleanup(parsedItems, options.pendingTagsByUuid);
      if (typeof showToast === "function")
        showToast("Import complete: " + parsedItems.length + " added");
      if (onComplete) onComplete({ added: parsedItems.length, modified: 0, deleted: 0 });
      return;
    }

    DiffEngine.enrichItemIdentities(inventory, parsedItems);

    const diffResult = DiffEngine.compareItems(inventory, parsedItems);

    // Build settings diff if provided via options (JSON imports only)
    const settingsDiff = options.settingsDiff || null;

    // No changes? Inform user
    const totalChanges =
      diffResult.added.length + diffResult.modified.length + diffResult.deleted.length;
    if (totalChanges === 0 && !settingsDiff) {
      if (typeof showToast === "function")
        showToast("No changes detected \u2014 inventory is up to date");
      return;
    }

    // Compute count header values for DiffModal (STAK-374)
    const _backupCount =
      parsedItems.length +
      (options.validationResult ? options.validationResult.skippedCount || 0 : 0);
    const _localCount =
      typeof inventory !== "undefined" && Array.isArray(inventory) ? inventory.length : 0;

    // Cross-domain origin warning (STAK-374): warn when importing from a different domain
    const _parsedOrigin =
      options.exportMeta && options.exportMeta.exportOrigin
        ? options.exportMeta.exportOrigin
        : null;
    const _currentOrigin =
      typeof window !== "undefined" && window.location ? window.location.origin : null;
    if (
      _parsedOrigin &&
      _currentOrigin &&
      _parsedOrigin !== _currentOrigin &&
      typeof showToast === "function"
    ) {
      const _safeFrom =
        typeof sanitizeHtml === "function" ? sanitizeHtml(_parsedOrigin) : _parsedOrigin;
      showToast(
        "\u26A0 This backup is from a different domain (" +
          _safeFrom +
          "). Check item counts carefully."
      );
    }

    // STRK-167 (AC-11, D-4): compute a SIDECAR set of added rows that are likely
    // duplicates of a graded item the user already owns — an ungraded incoming row
    // sharing numistaId+year with an existing graded/certified item. This is purely
    // advisory; the flag is NEVER written onto an item (applySelectedChanges would
    // persist it). The modal looks rows up by DiffEngine.computeItemKey.
    const possibleDuplicates = new Set();
    if (Array.isArray(inventory) && diffResult && Array.isArray(diffResult.added)) {
      const gradedByNumistaYear = new Set();
      for (const ex of inventory) {
        if (
          ex &&
          ex.numistaId &&
          (String(ex.grade || "").trim() || String(ex.certNumber || "").trim())
        ) {
          gradedByNumistaYear.add(ex.numistaId + "|" + (ex.year == null ? "" : String(ex.year)));
        }
      }
      for (const add of diffResult.added) {
        if (!add || !add.numistaId) continue;
        const isUngraded = !String(add.grade || "").trim() && !String(add.certNumber || "").trim();
        const ny = add.numistaId + "|" + (add.year == null ? "" : String(add.year));
        if (isUngraded && gradedByNumistaYear.has(ny)) {
          possibleDuplicates.add(DiffEngine.computeItemKey(add));
        }
      }
    }

    DiffModal.show({
      source: sourceInfo,
      diff: diffResult,
      settingsDiff: settingsDiff,
      backupCount: _backupCount,
      localCount: _localCount,
      possibleDuplicates: possibleDuplicates,
      onApply: function (selectedChanges) {
        if (!selectedChanges || selectedChanges.length === 0) return;

        inventory = DiffEngine.applySelectedChanges(inventory, selectedChanges);

        // Apply deferred tags for accepted changes (add + modify).
        // Look up by DiffEngine.computeItemKey to match the key used at build time.
        if (options.pendingTagsByUuid && typeof addItemTag === "function") {
          const tagEligible = selectedChanges.filter(function (c) {
            return c.type === "add" || c.type === "modify";
          });
          const stampedUuids = new Set();
          for (const change of tagEligible) {
            if (change.item && change.item.uuid) {
              const tagKey =
                typeof DiffEngine !== "undefined"
                  ? DiffEngine.computeItemKey(change.item)
                  : change.item.uuid || change.item.serial || "";
              const tags = options.pendingTagsByUuid.get(tagKey);
              if (tags && tags.length) {
                tags.forEach(function (tag) {
                  if (addItemTag(change.item.uuid, tag, false)) {
                    stampedUuids.add(change.item.uuid);
                  }
                });
              }
            }
          }
          if (stampedUuids.size > 0 && typeof stampTagTimestamp === "function") {
            stampTagTimestamp(Array.from(stampedUuids));
          }
          if (typeof saveItemTags === "function") saveItemTags();
        }

        // Apply settings changes if present
        if (settingsDiff && settingsDiff.changed && settingsDiff.changed.length > 0) {
          // Raw-string settings stored via localStorage.setItem, not JSON-encoded
          const _rawKeys = new Set([
            "appTheme",
            "tableImageSides",
            "tableImagesEnabled",
            "chipMinCount",
            "chipMaxCount",
            "settingsItemsPerPage",
            "defaultSortColumn",
            "defaultSortDir",
            "featureFlags",
            "inlineChipConfig",
          ]);
          for (const sc of settingsDiff.changed) {
            if (_rawKeys.has(sc.key)) {
              localStorage.setItem(sc.key, String(sc.remoteVal));
            } else {
              saveDataSync(sc.key, sc.remoteVal);
            }
          }
        }

        _postImportCleanup(
          selectedChanges
            .filter(function (c) {
              return c.type === "add";
            })
            .map(function (c) {
              return c.item;
            })
            .filter(Boolean),
          null // tags already handled above
        );

        // Toast summary
        const addCount = selectedChanges.filter(function (c) {
          return c.type === "add";
        }).length;
        const modCount = selectedChanges.filter(function (c) {
          return c.type === "modify";
        }).length;
        const delCount = selectedChanges.filter(function (c) {
          return c.type === "delete";
        }).length;
        const parts = [];
        if (addCount > 0) parts.push(addCount + " added");
        if (modCount > 0) parts.push(modCount + " updated");
        if (delCount > 0) parts.push(delCount + " removed");
        if (typeof showToast === "function") {
          showToast(
            "Import complete: " + (parts.length > 0 ? parts.join(", ") : "no changes applied")
          );
        }

        if (onComplete) onComplete({ added: addCount, modified: modCount, deleted: delCount });

        if (
          localStorage.getItem("staktrakr.debug") &&
          typeof window.showDebugModal === "function"
        ) {
          showDebugModal();
        }
      },
      onCancel: function () {
        debugLog("Import cancelled by user");
      },
    });
  };

  /**
   * Imports inventory data from CSV file with comprehensive validation and error handling
   *
   * @param {File} file - CSV file selected by user through file input
   * @param {boolean} [override=false] - Replace existing inventory instead of merging
   */
  const importCsv = (file, override = false) => {
    if (typeof Papa === "undefined") {
      appAlert(
        "CSV library (PapaParse) failed to load. Please check your internet connection and reload the page."
      );
      return;
    }
    try {
      debugLog("importCsv start", file.name);
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        comments: "#",
        complete: function (results) {
          let imported = [];
          const totalRows = results.data.length;
          startImportProgress(totalRows);
          let processed = 0;
          let importedCount = 0;

          const supportedMetals = ["Silver", "Gold", "Platinum", "Palladium"];
          const skippedNonPM = [];
          const pendingTagsByUuid = new Map();
          const pendingRemovedTagsByUuid = new Map();

          for (const row of results.data) {
            processed++;
            debugLog("importCsv row", processed, JSON.stringify(row));
            const compositionRaw = row["Composition"] || row["Metal"] || "Silver";
            const composition = getCompositionFirstWords(compositionRaw);
            const metal = parseNumistaMetal(composition);

            // Skip non-precious-metal items
            if (!supportedMetals.includes(metal)) {
              const rowName = row["Name"] || row["name"] || `Row ${processed}`;
              skippedNonPM.push(`${rowName} (${compositionRaw})`);
              updateImportProgress(processed, importedCount, totalRows);
              continue;
            }

            const name = row["Name"] || row["name"];
            const qty = row["Qty"] || row["qty"] || 1;
            const type = normalizeType(row["Type"] || row["type"]);
            const weight = row["Weight(oz)"] || row["weight"];
            const weightUnit = row["Weight Unit"] || row["weightUnit"] || "oz";
            const priceStr = row["Purchase Price"] || row["price"];
            let price =
              typeof priceStr === "string"
                ? parseFloat(priceStr.replace(/[^\d.-]+/g, ""))
                : parseFloat(priceStr);
            if (price < 0) price = 0;
            const paymentMethod = row["Payment Method"] || row["paymentMethod"] || "";
            const purchaseLocation = row["Purchase Location"] || "";
            const storageLocation = row["Storage Location"] || "";
            const notes = row["Notes"] || "";
            const year = row["Year"] || row["year"] || row["issuedYear"] || "";
            const grade = row["Grade"] || row["grade"] || "";
            const gradingAuthority =
              row["Grading Authority"] || row["gradingAuthority"] || row["Authority"] || "";
            const certNumber = (
              row["Cert #"] ||
              row["certNumber"] ||
              row["Cert Number"] ||
              ""
            ).toString();
            const date = parseDate(row["Date"]);

            // Parse retail price from CSV (backward-compatible with legacy columns)
            const retailStr =
              row["Retail Price"] || row["Market Value"] || row["marketValue"] || "0";
            const marketValue =
              typeof retailStr === "string"
                ? parseFloat(retailStr.replace(/[^\d.-]+/g, "")) || 0
                : parseFloat(retailStr) || 0;

            let spotPriceAtPurchase;
            if (row["Spot Price ($/oz)"]) {
              const spotStr = row["Spot Price ($/oz)"].toString();
              spotPriceAtPurchase = parseFloat(spotStr.replace(/[^0-9.-]+/g, ""));
            } else if (row["spotPriceAtPurchase"]) {
              spotPriceAtPurchase = parseFloat(row["spotPriceAtPurchase"]);
            } else {
              spotPriceAtPurchase = 0;
            }

            const premiumPerOz = 0;
            const totalPremium = 0;

            const numistaRaw = (row["N#"] || row["Numista #"] || row["numistaId"] || "").toString();
            const numistaMatch = numistaRaw.match(/\d+/);
            const numistaId = numistaMatch ? numistaMatch[0] : "";
            const pcgsNumber = (row["PCGS #"] || row["PCGS Number"] || row["pcgsNumber"] || "")
              .toString()
              .trim();
            const purityRaw = row["Purity"] || row["Fineness"] || row["purity"] || "";
            const purity = parseFloat(purityRaw) || 1.0;
            const serialNumber = row["Serial Number"] || row["serialNumber"] || "";
            const serial = row["Serial"] || row["serial"] || getNextSerial();
            const uuid = row["UUID"] || row["uuid"] || "";
            const csvTags = (row["Tags"] || row["tags"] || "").trim();
            const csvRemovedTags = (row["removedTags"] || row["Removed Tags"] || "").trim();
            const obverseImageUrl = row["Obverse Image URL"] || row["obverseImageUrl"] || "";
            const reverseImageUrl = row["Reverse Image URL"] || row["reverseImageUrl"] || "";

            const dispositionType = (row["Disposition Type"] || "").trim();
            const dispositionDate = (row["Disposition Date"] || "").trim();
            const dispositionAmount = row["Disposition Amount"] || "";
            const dispositionRealizedGainLoss = row["Realized Gain/Loss"] || "";
            const dispositionRecipient = (row["Disposition Recipient"] || "").trim();
            const dispositionNotes = (row["Disposition Notes"] || "").trim();
            const dispositionCurrency = (row["Disposition Currency"] || "").trim();
            const dispositionDisposedAt = (row["Disposition DisposedAt"] || "").trim();
            const dispositionSplitFromUuidRaw = (row["Disposition Split From UUID"] || "").trim();
            const dispositionSplitFromUuid = dispositionSplitFromUuidRaw || undefined;
            const tradedForUuids = (row["Traded For UUIDs"] || row["tradedForUuids"] || "")
              .toString()
              .split(",")
              .map((uuid) => uuid.trim())
              .filter(Boolean);
            const tradedFromUuid = (row["Traded From UUID"] || row["tradedFromUuid"] || "")
              .toString()
              .trim();

            const attachmentsRaw = (row["Attachments"] || "").trim();
            const csvAttachments = attachmentsRaw
              ? attachmentsRaw
                  .split("|")
                  .map((entry) => {
                    const hashIdx = entry.lastIndexOf("#");
                    if (hashIdx === -1) return null;
                    const fileName = entry.slice(0, hashIdx);
                    const attachmentUuid = entry.slice(hashIdx + 1);
                    return fileName && attachmentUuid
                      ? { attachmentUuid, fileName, type: "", size: 0, uploadedAt: 0 }
                      : null;
                  })
                  .filter(Boolean)
              : [];

            let disposition;
            if (dispositionType) {
              const _parsedAmount = parseFloat(String(dispositionAmount).replace(/[^0-9.\-]/g, ""));
              const _parsedGainLoss = parseFloat(
                String(dispositionRealizedGainLoss).replace(/[^0-9.\-]/g, "")
              );
              // Normalize display labels ("Sold") → internal keys ("sold") for round-trip
              const dispositionTypeKey =
                typeof DISPOSITION_TYPES !== "undefined"
                  ? (Object.keys(DISPOSITION_TYPES).find(
                      (k) => DISPOSITION_TYPES[k].label === dispositionType
                    ) ?? dispositionType.toLowerCase())
                  : dispositionType.toLowerCase();
              disposition = {
                type: dispositionTypeKey,
                date: dispositionDate || undefined,
                amount:
                  dispositionAmount !== "" && Number.isFinite(_parsedAmount)
                    ? _parsedAmount
                    : undefined,
                realizedGainLoss:
                  dispositionRealizedGainLoss !== "" && Number.isFinite(_parsedGainLoss)
                    ? _parsedGainLoss
                    : undefined,
                recipient: dispositionRecipient || undefined,
                notes: dispositionNotes || undefined,
                currency: dispositionCurrency || undefined,
                disposedAt: dispositionDisposedAt || undefined,
                splitFromUuid: dispositionSplitFromUuid,
              };
              if (tradedForUuids.length > 0) disposition.tradedForUuids = tradedForUuids;
            }

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
              paymentMethod,
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
              reverseImageUrl,
              disposition,
              tradedFromUuid: tradedFromUuid || undefined,
            });

            if (csvAttachments.length > 0) item.attachments = csvAttachments;
            imported.push(item);
            if (!item.paymentMethod) delete item.paymentMethod;

            // STAK-126 / STAK-424: Collect tags but defer persistence until import confirmed.
            // Key by DiffEngine.computeItemKey (uuid → serial → name|date) so legacy
            // CSV exports without UUIDs still match after serial→uuid enrichment.
            if (csvTags) {
              const tagList = csvTags
                .split(";")
                .map((t) => t.trim())
                .filter(Boolean);
              if (tagList.length) {
                const tagKey =
                  typeof DiffEngine !== "undefined"
                    ? DiffEngine.computeItemKey(item)
                    : item.uuid || item.serial || "";
                if (tagKey) pendingTagsByUuid.set(tagKey, tagList);
              }
            }

            if (csvRemovedTags) {
              const removedList = csvRemovedTags
                .split(";")
                .map((t) => t.trim())
                .filter(Boolean);
              if (removedList.length) {
                const removedKey =
                  typeof DiffEngine !== "undefined"
                    ? DiffEngine.computeItemKey(item)
                    : item.uuid || item.serial || "";
                if (removedKey) pendingRemovedTagsByUuid.set(removedKey, removedList);
              }
            }

            importedCount++;
            updateImportProgress(processed, importedCount, totalRows);
          }

          endImportProgress();

          // Report skipped non-precious-metal items
          if (skippedNonPM.length > 0) {
            if (typeof showAppAlert === "function") {
              showAppAlert(
                `${skippedNonPM.length} item(s) skipped: no precious metal content\n\n${skippedNonPM.join("\n")}`,
                "CSV Import"
              );
            }
          }

          if (imported.length === 0) {
            if (typeof showAppAlert === "function")
              showAppAlert("No items to import.", "CSV Import");
            return;
          }

          // Pre-validation — surface skipped items before DiffModal opens
          let _validationResult = null;
          if (typeof buildImportValidationResult === "function") {
            _validationResult = buildImportValidationResult(imported, skippedNonPM);
            if (_validationResult.valid.length === 0) {
              const _firstReason =
                _validationResult.invalid.length > 0
                  ? _validationResult.invalid[0].reasons[0]
                  : "Unknown error";
              if (typeof showToast === "function")
                showToast("No items could be imported: " + _firstReason);
              return;
            }
            if (_validationResult.skippedCount > 0) {
              if (typeof showToast === "function")
                showToast(
                  _validationResult.skippedCount +
                    " item(s) could not be imported and were skipped."
                );
            }
            imported = _validationResult.valid;
          }

          // --- Override path: skip DiffEngine, import all items directly ---
          if (override) {
            if (typeof migrateLegacySilverbackWeightUnit === "function") {
              migrateLegacySilverbackWeightUnit(imported);
            }
            inventory = imported;

            // Synchronize all items with catalog manager
            if (typeof catalogManager !== "undefined" && catalogManager.syncInventory) {
              inventory = catalogManager.syncInventory(inventory);
            }

            for (const item of imported) {
              if (typeof registerName === "function") {
                registerName(item.name);
              }
            }

            if (typeof clearInventoryRecovery === "function") clearInventoryRecovery();
            if (typeof debugLog === "function") debugLog("inventoryRecovery: cleared by csvImport");
            saveInventory();
            // STAK-424: Apply deferred tags after override confirmation
            if (pendingTagsByUuid.size > 0 && typeof addItemTag === "function") {
              const stampedUuids = new Set();
              for (const item of imported) {
                const itemKey =
                  typeof DiffEngine !== "undefined"
                    ? DiffEngine.computeItemKey(item)
                    : item.uuid || item.serial || "";
                const tags = pendingTagsByUuid.get(itemKey);
                if (tags && tags.length) {
                  tags.forEach((tag) => {
                    if (addItemTag(item.uuid, tag, false)) stampedUuids.add(item.uuid);
                  });
                }
              }
              if (stampedUuids.size > 0 && typeof stampTagTimestamp === "function") {
                stampTagTimestamp(Array.from(stampedUuids));
              }
              if (typeof saveItemTags === "function") saveItemTags();
            }
            // Restore removed tags from CSV import (STAK-556)
            if (pendingRemovedTagsByUuid.size > 0 && typeof saveDataSync === "function") {
              const removedMap =
                typeof loadDataSync === "function" ? loadDataSync("itemRemovedTags", {}) : {};
              for (const item of imported) {
                const key =
                  typeof DiffEngine !== "undefined"
                    ? DiffEngine.computeItemKey(item)
                    : item.uuid || item.serial || "";
                const removedTags = pendingRemovedTagsByUuid.get(key);
                if (removedTags && removedTags.length) {
                  removedMap[item.uuid] = removedTags;
                }
              }
              saveDataSync("itemRemovedTags", removedMap);
            }
            // STAK-421: Cancel the debounced sync push that saveInventory() just
            // scheduled — override imports replace all local data, so pushing
            // immediately would overwrite the remote vault before the user can review.
            if (
              typeof scheduleSyncPush === "function" &&
              typeof scheduleSyncPush.cancel === "function"
            ) {
              scheduleSyncPush.cancel();
            }
            renderTable();
            if (typeof renderActiveFilters === "function") {
              renderActiveFilters();
            }
            if (typeof updateStorageStats === "function") {
              updateStorageStats();
            }
            debugLog("importCsv override complete", imported.length, "items replaced");
            const _overrideAttachCount = imported.reduce(
              (n, it) => n + (Array.isArray(it.attachments) ? it.attachments.length : 0),
              0
            );
            if (_overrideAttachCount > 0 && typeof showToast === "function") {
              showToast(
                `${_overrideAttachCount} attachment(s) imported as metadata only — use a backup ZIP to restore files.`,
                "warning"
              );
            }
            if (
              localStorage.getItem("staktrakr.debug") &&
              typeof window.showDebugModal === "function"
            ) {
              showDebugModal();
            }
            return;
          }

          // --- Merge path: use shared DiffEngine + DiffModal helper ---
          showImportDiffReview(
            imported,
            { type: "csv", label: file.name },
            {
              validationResult: _validationResult,
              pendingTagsByUuid: pendingTagsByUuid,
            },
            function (summary) {
              const _csvAttachCount = imported.reduce(
                (n, it) => n + (Array.isArray(it.attachments) ? it.attachments.length : 0),
                0
              );
              if (_csvAttachCount > 0 && typeof showToast === "function") {
                showToast(
                  `${_csvAttachCount} attachment(s) imported as metadata only — use a backup ZIP to restore files.`,
                  "warning"
                );
              }
              // Restore removed tags from CSV import (STAK-556)
              if (pendingRemovedTagsByUuid.size > 0 && typeof saveDataSync === "function") {
                const removedMap =
                  typeof loadDataSync === "function" ? loadDataSync("itemRemovedTags", {}) : {};
                for (const item of imported) {
                  const key =
                    typeof DiffEngine !== "undefined"
                      ? DiffEngine.computeItemKey(item)
                      : item.uuid || item.serial || "";
                  const removedTags = pendingRemovedTagsByUuid.get(key);
                  if (removedTags && removedTags.length) {
                    removedMap[item.uuid] = removedTags;
                  }
                }
                saveDataSync("itemRemovedTags", removedMap);
              }
              debugLog(
                "importCsv DiffEngine complete",
                summary.added,
                "added",
                summary.modified,
                "modified",
                summary.deleted,
                "deleted"
              );
            }
          );
        },
        error: function (error) {
          endImportProgress();
          handleError(error, "CSV import");
        },
      });
    } catch (error) {
      endImportProgress();
      handleError(error, "CSV import initialization");
    }
  };

  /**
   * Imports inventory data from a Numista CSV export
   *
   * @param {File} file - CSV file from Numista
   * @param {boolean} [override=false] - Replace existing inventory instead of merging
   */
  const importNumistaCsv = (file, override = false) => {
    if (typeof Papa === "undefined") {
      appAlert(
        "CSV library (PapaParse) failed to load. Please check your internet connection and reload the page."
      );
      return;
    }
    try {
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const csvText = e.target.result;
          const results = Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            comments: "#",
            transformHeader: (h) => h.trim(), // Handle Numista headers with trailing spaces
          });
          const rawTable = results.data;
          const imported = [];
          const supportedMetals = ["Silver", "Gold", "Platinum", "Palladium"];
          const skippedNonPM = [];
          const totalRows = rawTable.length;
          startImportProgress(totalRows);
          let processed = 0;
          let importedCount = 0;

          const getValue = (row, keys) => {
            for (const key of keys) {
              const foundKey = Object.keys(row).find((k) => k.toLowerCase() === key.toLowerCase());
              if (foundKey) return row[foundKey];
            }
            return "";
          };

          for (const row of rawTable) {
            processed++;

            const numistaRaw = (
              getValue(row, [
                "N# number",
                "N# number (with link)",
                "Numista #",
                "Numista number",
                "Numista id",
              ]) || ""
            ).toString();
            const numistaMatch = numistaRaw.match(/\d+/);
            const numistaId = numistaMatch ? numistaMatch[0] : "";
            const title = (getValue(row, ["Title", "Name"]) || "").trim();
            const year = (getValue(row, ["Year", "Date"]) || "").trim();
            const name = year.length >= 4 ? `${title} ${year}`.trim() : title;
            const issuedYear = year.length >= 4 ? year : "";
            const compositionRaw = getValue(row, ["Composition", "Metal"]) || "";
            const composition = getCompositionFirstWords(compositionRaw);

            addCompositionOption(composition);

            let metal = parseNumistaMetal(composition);

            // Skip non-precious-metal items (Paper, Alloy, Copper, Nickel, etc.)
            if (!supportedMetals.includes(metal)) {
              skippedNonPM.push(`${name || `Row ${processed}`} (${compositionRaw || "unknown"})`);
              updateImportProgress(processed, importedCount, totalRows);
              continue;
            }

            const qty = parseInt(getValue(row, ["Quantity", "Qty", "Quantity owned"]) || 1, 10);

            let type = normalizeType(mapNumistaType(getValue(row, ["Type"]) || ""));

            const weightCols = Object.keys(row).filter((k) => {
              const key = k.toLowerCase();
              return key.includes("weight") || key.includes("mass");
            });
            let weightGrams = 0;
            for (const col of weightCols) {
              const val = parseFloat(String(row[col]).replace(/[^0-9.]/g, ""));
              if (!isNaN(val)) weightGrams = Math.max(weightGrams, val);
            }
            const weight = parseFloat(gramsToOzt(weightGrams).toFixed(6));

            const priceKey = Object.keys(row).find((k) =>
              /^(buying price|purchase price|price paid)/i.test(k)
            );
            const estimateKey = Object.keys(row).find((k) => /^estimate/i.test(k));
            const parsePriceField = (key) => {
              const rawVal = String(row[key] ?? "").trim();
              const valueCurrency = detectCurrency(rawVal);
              const headerCurrencyMatch = key.match(/\(([^)]+)\)/);
              const headerCurrency = headerCurrencyMatch ? headerCurrencyMatch[1] : displayCurrency;
              const currency = valueCurrency || headerCurrency;
              const amount = parseFloat(rawVal.replace(/[^0-9.\-]/g, ""));
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

            const purchaseLocRaw = getValue(row, [
              "Acquisition place",
              "Acquired from",
              "Purchase place",
            ]);
            const purchaseLocation =
              purchaseLocRaw && purchaseLocRaw.trim() ? purchaseLocRaw.trim() : "—";
            const paymentMethod = getValue(row, ["Payment Method", "Payment method"]) || "";
            const storageLocRaw = getValue(row, ["Storage location", "Stored at", "Storage place"]);
            const storageLocation =
              storageLocRaw && storageLocRaw.trim() ? storageLocRaw.trim() : "—";

            const dateStrRaw = getValue(row, ["Acquisition date", "Date acquired", "Date"]);
            const dateStr = dateStrRaw && dateStrRaw.trim() ? dateStrRaw.trim() : "—";
            const date = parseDate(dateStr);

            const baseNote = (getValue(row, ["Note", "Notes"]) || "").trim();
            const privateComment = (getValue(row, ["Private comment"]) || "").trim();
            const publicComment = (getValue(row, ["Public comment"]) || "").trim();
            const otherComment = (getValue(row, ["Comment"]) || "").trim();
            const noteParts = [];
            if (baseNote) noteParts.push(baseNote);
            if (privateComment) noteParts.push(`Private Comment: ${privateComment}`);
            if (publicComment) noteParts.push(`Public Comment: ${publicComment}`);
            if (otherComment) noteParts.push(`Comment: ${otherComment}`);
            const notes = noteParts.join("\n");

            const markdownLines = Object.entries(row)
              .filter(([, v]) => v && String(v).trim())
              .map(([k, v]) => `- **${k.trim()}**: ${String(v).trim()}`);
            const markdownNote = markdownLines.length
              ? `### Numista Import Data\n${markdownLines.join("\n")}`
              : "";
            const finalNotes = markdownNote
              ? notes
                ? `${notes}\n\n${markdownNote}`
                : markdownNote
              : notes;

            const spotPriceAtPurchase = 0;
            const premiumPerOz = 0;
            const totalPremium = 0;
            // STRK-167 (D-3): do NOT pre-stamp uuid/serial here. A pre-stamped uuid
            // makes computeItemKey return it first, masking the instance tier so the
            // diff never matches existing items (the STRK-165 duplication bug).
            // Identity is stamped later: enrich backfills matched rows, then any
            // still-unmatched row is stamped before the diff.

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
              paymentMethod,
              purchaseLocation,
              storageLocation,
              notes: finalNotes,
              spotPriceAtPurchase,
              premiumPerOz,
              totalPremium,
              numistaId,
              year: issuedYear,
              grade: "",
              gradingAuthority: "",
              certNumber: "",
              pcgsNumber: "",
            });

            imported.push(item);
            if (!item.paymentMethod) delete item.paymentMethod;
            importedCount++;
            updateImportProgress(processed, importedCount, totalRows);
          }

          endImportProgress();

          // Report skipped non-precious-metal items
          if (skippedNonPM.length > 0) {
            if (typeof showAppAlert === "function") {
              showAppAlert(
                `${skippedNonPM.length} item(s) skipped: no precious metal content\n\n${skippedNonPM.join("\n")}`,
                "Numista Import"
              );
            }
          }

          if (imported.length === 0) {
            if (typeof showAppAlert === "function")
              showAppAlert("No items to import.", "Numista Import");
            return;
          }

          // STRK-167 (AC-6, D-3): collapse the repeated N# rows Numista exports for
          // identical ungraded copies into one row with summed qty, keyed on the bare
          // instance key — BEFORE any identity stamping.
          const collapsed =
            typeof DiffEngine !== "undefined" &&
            typeof DiffEngine.collapseByInstanceKey === "function"
              ? DiffEngine.collapseByInstanceKey(imported)
              : imported;

          // Stamp uuid + serial on rows that still lack identity. Matched rows get a
          // backfilled uuid from enrichItemIdentities; genuinely-new rows are stamped
          // here so accepted adds are never saved keyless (D-3).
          const stampIdentity = (rows) => {
            for (const it of rows) {
              if (it.serial == null || it.serial === "") it.serial = getNextSerial();
              if (!it.uuid) it.uuid = generateUUID();
            }
          };

          // --- Override path (AC-13): replace the entire inventory, no modal. ---
          if (override) {
            stampIdentity(collapsed);
            const runReplace = async () => {
              inventory = collapsed;
              for (const item of collapsed) {
                if (typeof registerName === "function") registerName(item.name);
              }
              if (typeof catalogManager !== "undefined" && catalogManager.syncInventory) {
                inventory = catalogManager.syncInventory(inventory);
              }
              if (typeof clearInventoryRecovery === "function") clearInventoryRecovery();
              await saveInventory();
              // STAK-421: cancel debounced sync push after a replace import.
              if (
                typeof scheduleSyncPush === "function" &&
                typeof scheduleSyncPush.cancel === "function"
              ) {
                scheduleSyncPush.cancel();
              }
              renderTable();
              if (typeof renderActiveFilters === "function") renderActiveFilters();
              if (typeof updateStorageStats === "function") updateStorageStats();
              if (typeof debugLog === "function")
                debugLog("importNumistaCsv override replace complete", collapsed.length);
            };
            runReplace().catch((error) => handleError(error, "Numista CSV import"));
            return;
          }

          // --- Merge path (AC-7/9/12): route through the shared diff-review modal,
          // exactly as importCsv does. The STRK-165 interim onboarding/replace gate
          // is gone — instance-aware dedup makes merging safe again. ---
          if (
            typeof DiffEngine !== "undefined" &&
            typeof DiffEngine.enrichItemIdentities === "function"
          ) {
            DiffEngine.enrichItemIdentities(inventory, collapsed); // backfill matched uuids
          }
          stampIdentity(collapsed); // stamp still-unmatched before the diff

          showImportDiffReview(
            collapsed,
            { type: "csv", label: file.name },
            {},
            function (summary) {
              if (typeof debugLog === "function") {
                debugLog(
                  "importNumistaCsv merge complete",
                  summary.added,
                  "added",
                  summary.modified,
                  "modified",
                  summary.deleted,
                  "deleted"
                );
              }
            }
          );
        } catch (error) {
          endImportProgress();
          handleError(error, "Numista CSV import");
        }
      };
      reader.onerror = (error) => {
        endImportProgress();
        handleError(error, "Numista CSV import");
      };
      reader.readAsText(file);
    } catch (error) {
      endImportProgress();
      handleError(error, "Numista CSV import initialization");
    }
  };

  /**
   * Exports inventory using Numista-compatible column layout
   */
  const exportNumistaCsv = () => {
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
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
    const fxRate = typeof getExchangeRate === "function" ? getExchangeRate(displayCurrency) : 1;
    const fracDigits =
      typeof getCurrencyFractionDigits === "function"
        ? getCurrencyFractionDigits(displayCurrency)
        : 2;

    for (const item of sortedInventory) {
      const year = item.year || item.issuedYear || "";
      let title = item.name || "";
      if (year) {
        const yearRegex = new RegExp(
          `\\s*${String(year).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`
        );
        title = title.replace(yearRegex, "").trim();
      }

      const weightGrams = parseFloat(item.weight) ? parseFloat(item.weight) * 31.1034768 : 0;
      const purchasePrice = item.purchasePrice ?? item.price;

      let baseNote = "";
      let privateComment = "";
      let publicComment = "";
      let otherComment = "";
      if (item.notes) {
        const lines = String(item.notes).split(/\n/);
        for (const line of lines) {
          if (/^\s*Private Comment:/i.test(line)) {
            privateComment = line.replace(/^\s*Private Comment:\s*/i, "").trim();
          } else if (/^\s*Public Comment:/i.test(line)) {
            publicComment = line.replace(/^\s*Public Comment:\s*/i, "").trim();
          } else if (/^\s*Comment:/i.test(line)) {
            otherComment = line.replace(/^\s*Comment:\s*/i, "").trim();
          } else {
            baseNote = baseNote ? `${baseNote}\n${line}` : line;
          }
        }
      }

      rows.push([
        item.numistaId || "",
        title,
        year,
        item.metal || "",
        item.qty || "",
        item.type || "",
        weightGrams ? weightGrams.toFixed(2) : "",
        // STRK-88 (D-6): Convert internal USD price to display currency to match the
        // column header "Buying price (${displayCurrency})". The importer reads this column
        // and calls convertToUsd(amount, headerCurrency), so exporting raw USD under a
        // non-USD header causes round-trip inflation.
        (() => {
          if (purchasePrice === null || purchasePrice === undefined) return "";
          const usdVal = Number(purchasePrice);
          if (isNaN(usdVal)) return "";
          return (usdVal * fxRate).toFixed(fracDigits);
        })(),
        item.purchaseLocation || "",
        item.storageLocation || "",
        item.date || "",
        baseNote,
        privateComment,
        publicComment,
        otherComment,
      ]);
    }

    const csv = Papa.unparse([headers, ...rows]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
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
  const buildCsvContent = () => {
    if (typeof Papa === "undefined") return null;
    const headers = [
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
      "removedTags",
      "UUID",
      "Obverse Image URL",
      "Reverse Image URL",
      "Obverse Frame",
      "Reverse Frame",
      "Disposition Type",
      "Disposition Date",
      "Disposition Amount",
      "Realized Gain/Loss",
      "Disposition Recipient",
      "Disposition Notes",
      "Disposition Currency",
      "Disposition DisposedAt",
      "Disposition Split From UUID",
      "Traded For UUIDs",
      "Traded From UUID",
    ];

    const sortedInventory = sortInventoryByDateNewestFirst();
    const _removedTagsMap =
      typeof loadDataSync === "function" ? loadDataSync("itemRemovedTags", {}) : {};
    const rows = [];

    for (const i of sortedInventory) {
      const currentSpot = spotPrices[i.metal.toLowerCase()] || 0;
      const valuation =
        typeof computeItemValuation === "function" ? computeItemValuation(i, currentSpot) : null;
      const purchasePrice = valuation
        ? valuation.purchasePrice
        : typeof i.price === "number"
          ? i.price
          : parseFloat(i.price) || 0;
      const meltValue = valuation ? valuation.meltValue : computeMeltValue(i, currentSpot);
      const gainLoss = valuation ? valuation.gainLoss : null;

      rows.push([
        i.date,
        i.metal || "Silver",
        i.type,
        i.name,
        i.year || "",
        i.qty,
        parseFloat(i.weight).toFixed(4),
        i.weightUnit || "oz",
        parseFloat(i.purity) || 1.0,
        formatCurrency(purchasePrice),
        currentSpot > 0 ? formatCurrency(meltValue) : "—",
        formatCurrency(i.marketValue || 0),
        gainLoss !== null ? formatCurrency(gainLoss) : "—",
        i.paymentMethod || "",
        i.purchaseLocation,
        i.storageLocation || "",
        i.numistaId || "",
        i.pcgsNumber || "",
        i.grade || "",
        i.gradingAuthority || "",
        i.certNumber || "",
        i.serialNumber || "",
        i.notes || "",
        typeof getItemTags === "function" ? getItemTags(i.uuid).join("; ") : "",
        Array.isArray(_removedTagsMap[i.uuid]) ? _removedTagsMap[i.uuid].join("; ") : "",
        i.uuid || "",
        i.obverseImageUrl || "",
        i.reverseImageUrl || "",
        i.obverseImageFrame || "",
        i.reverseImageFrame || "",
        i.disposition ? DISPOSITION_TYPES[i.disposition.type]?.label || i.disposition.type : "",
        i.disposition?.date || "",
        i.disposition ? i.disposition.amount || 0 : "",
        i.disposition ? i.disposition.realizedGainLoss || 0 : "",
        i.disposition?.recipient || "",
        i.disposition?.notes || "",
        i.disposition?.currency || "",
        i.disposition?.disposedAt || "",
        i.disposition?.splitFromUuid || "",
        Array.isArray(i.disposition?.tradedForUuids) ? i.disposition.tradedForUuids.join(",") : "",
        i.tradedFromUuid || "",
      ]);
    }

    const _csvOrigin =
      typeof window !== "undefined" && window.location ? window.location.origin : "";
    const _originComment = "# exportOrigin: " + _csvOrigin + "\n";
    return _originComment + Papa.unparse([headers, ...rows]);
  };

  const exportCsv = () => {
    if (typeof Papa === "undefined") {
      appAlert(
        "CSV library (PapaParse) failed to load. Please check your internet connection and reload the page."
      );
      return;
    }
    debugLog("exportCsv start", inventory.length, "items");
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const csv = buildCsvContent();
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `metal_inventory_${timestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    debugLog("exportCsv complete");
  };

  /**
   * Imports inventory data from JSON file
   *
   * @param {File} file - JSON file to import
   * @param {boolean} [override=false] - Replace existing inventory instead of merging
   */
  const importJson = (file, override = false) => {
    const reader = new FileReader();
    debugLog("importJson start", file.name);

    reader.onload = function (e) {
      try {
        const rawParsed = JSON.parse(e.target.result);

        // Support both plain array and { items: [], settings: {}, exportMeta: {} } object formats
        let data;
        let parsedSettings = null;
        let parsedMeta = null;
        if (Array.isArray(rawParsed)) {
          data = rawParsed;
        } else if (rawParsed && typeof rawParsed === "object" && Array.isArray(rawParsed.items)) {
          data = rawParsed.items;
          parsedSettings = rawParsed.settings || null;
          parsedMeta = rawParsed.exportMeta || null;
        } else {
          if (typeof showAppAlert === "function") {
            showAppAlert(
              "Invalid JSON format. Expected an array of inventory items, { items: [], settings: {} }, or { items: [], exportMeta: {} } (exportMeta is optional).",
              "JSON Import"
            );
          }
          return;
        }

        const parsedRemovedTags =
          rawParsed && !Array.isArray(rawParsed) ? rawParsed.itemRemovedTags || null : null;

        // Process each item
        let imported = [];
        const skippedDetails = [];
        const skippedNonPM = [];
        const supportedMetals = ["Silver", "Gold", "Platinum", "Palladium"];
        const totalItems = data.length;
        startImportProgress(totalItems);
        let processed = 0;
        let importedCount = 0;

        const pendingTagsByUuid = new Map();

        for (const [index, raw] of data.entries()) {
          processed++;
          debugLog("importJson item", index + 1, JSON.stringify(raw));

          const compositionRaw = raw.composition || raw.metal || "Silver";
          const composition = getCompositionFirstWords(compositionRaw);
          const metal = parseNumistaMetal(composition);

          // Skip non-precious-metal items
          if (!supportedMetals.includes(metal)) {
            const itemName = raw.name || `Item ${index + 1}`;
            skippedNonPM.push(`${itemName} (${compositionRaw})`);
            updateImportProgress(processed, importedCount, totalItems);
            continue;
          }

          const name = raw.name || "";
          const qty = parseInt(raw.qty ?? raw.quantity ?? 1, 10);
          const type = normalizeType(raw.type || raw.itemType || "Other");
          const weight = parseFloat(raw.weight ?? raw.weightOz ?? 0);
          const weightUnit = raw.weightUnit || raw["Weight Unit"] || "oz";
          const purity = parseFloat(raw.purity ?? raw["Purity"] ?? raw["Fineness"] ?? 1.0) || 1.0;
          const priceStr = raw.price ?? raw.purchasePrice ?? 0;
          let price =
            typeof priceStr === "string"
              ? parseFloat(priceStr.replace(/[^\d.-]+/g, ""))
              : parseFloat(priceStr);
          if (price < 0) price = 0;
          const paymentMethod = raw.paymentMethod || raw["Payment Method"] || "";
          const purchaseLocation = raw.purchaseLocation || "";
          const storageLocation = raw.storageLocation || "";
          const notes = raw.notes || "";
          const capsule = (raw.capsule || "").toString().trim();
          const capsuleNotes = (raw.capsuleNotes || "").toString().trim();
          const year = (raw.year || raw.issuedYear || "").toString().trim();
          const grade = (raw.grade || "").toString().trim();
          const gradingAuthority = (raw.gradingAuthority || raw.authority || "").toString().trim();
          const certNumber = (raw.certNumber || "").toString().trim();
          const pcgsNumber = (raw.pcgsNumber || raw["PCGS #"] || raw["PCGS Number"] || "")
            .toString()
            .trim();
          const pcgsVerified = raw.pcgsVerified || false;
          const serialNumber = (raw.serialNumber || raw["Serial Number"] || "").toString().trim();
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

          const numistaRaw = (raw.numistaId || raw.numista || raw["N#"] || "").toString();
          const numistaMatch = numistaRaw.match(/\d+/);
          const numistaId = numistaMatch ? numistaMatch[0] : "";
          const serial = raw.serial || getNextSerial();
          const uuid = raw.uuid || generateUUID();
          const obverseImageUrl = raw.obverseImageUrl || raw["Obverse Image URL"] || "";
          const reverseImageUrl = raw.reverseImageUrl || raw["Reverse Image URL"] || "";
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
            paymentMethod,
            purchaseLocation,
            storageLocation,
            notes,
            capsule,
            capsuleNotes,
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
            ...(fieldMeta ? { fieldMeta } : {}),
          });

          const validation = validateInventoryItem(processedItem);
          if (!validation.isValid) {
            const reason = validation.errors.join(", ");
            skippedDetails.push(`Item ${index + 1}: ${reason}`);
            updateImportProgress(processed, importedCount, totalItems);
            continue;
          }

          addCompositionOption(composition);
          imported.push(processedItem);
          if (!processedItem.paymentMethod) delete processedItem.paymentMethod;

          // STAK-126: Import tags from JSON if present
          if (typeof addItemTag === "function") {
            const jsonTags = raw.tags;
            let pendingTags = [];
            if (Array.isArray(jsonTags)) {
              pendingTags = jsonTags.map((tag) => String(tag).trim()).filter(Boolean);
            } else if (typeof jsonTags === "string" && jsonTags.trim()) {
              pendingTags = jsonTags
                .split(";")
                .map((t) => t.trim())
                .filter(Boolean);
            }
            if (pendingTags.length > 0) {
              const existing = pendingTagsByUuid.get(processedItem.uuid) || [];
              pendingTagsByUuid.set(processedItem.uuid, [
                ...new Set([...existing, ...pendingTags]),
              ]);
            }
          }

          importedCount++;
          updateImportProgress(processed, importedCount, totalItems);
        }

        endImportProgress();
        if (typeof migrateLegacySilverbackWeightUnit === "function") {
          migrateLegacySilverbackWeightUnit(imported);
        }

        // Report skipped non-precious-metal items
        if (skippedNonPM.length > 0) {
          if (typeof showAppAlert === "function") {
            showAppAlert(
              `${skippedNonPM.length} item(s) skipped: no precious metal content\n\n${skippedNonPM.join("\n")}`,
              "JSON Import"
            );
          }
        }

        if (skippedDetails.length > 0) {
          if (typeof showAppAlert === "function") {
            showAppAlert(`Skipped entries:\n${skippedDetails.join("\n")}`, "JSON Import");
          }
        }

        if (imported.length === 0) {
          if (typeof showAppAlert === "function")
            showAppAlert("No valid items found in JSON file.", "JSON Import");
          return;
        }

        // Pre-validation — surface skipped items before DiffModal opens
        let _validationResult = null;
        if (typeof buildImportValidationResult === "function") {
          _validationResult = buildImportValidationResult(imported, skippedNonPM);
          if (_validationResult.valid.length === 0) {
            const _firstReason =
              _validationResult.invalid.length > 0
                ? _validationResult.invalid[0].reasons[0]
                : "Unknown error";
            if (typeof showToast === "function")
              showToast("No items could be imported: " + _firstReason);
            return;
          }
          if (_validationResult.skippedCount > 0) {
            if (typeof showToast === "function")
              showToast(
                _validationResult.skippedCount + " item(s) could not be imported and were skipped."
              );
          }
          imported = _validationResult.valid;
        }

        // ── Override path: skip DiffEngine, import all directly ──
        if (override) {
          if (typeof addItemTag === "function") {
            const stampedUuids = new Set();
            for (const item of imported) {
              const pendingTags = pendingTagsByUuid.get(item.uuid);
              if (pendingTags && pendingTags.length) {
                pendingTags.forEach((tag) => {
                  if (addItemTag(item.uuid, tag, false)) stampedUuids.add(item.uuid);
                });
              }
            }
            if (stampedUuids.size > 0 && typeof stampTagTimestamp === "function") {
              stampTagTimestamp(Array.from(stampedUuids));
            }
            if (typeof saveItemTags === "function") saveItemTags();
          }

          for (const item of imported) {
            if (typeof registerName === "function") registerName(item.name);
          }

          inventory = imported;
          if (typeof catalogManager !== "undefined" && catalogManager.syncInventory) {
            inventory = catalogManager.syncInventory(inventory);
          }
          if (typeof clearInventoryRecovery === "function") clearInventoryRecovery();
          if (typeof debugLog === "function") debugLog("inventoryRecovery: cleared by jsonImport");
          saveInventory();
          // Restore itemRemovedTags from import payload (STAK-556)
          if (parsedRemovedTags && typeof saveDataSync === "function") {
            saveDataSync("itemRemovedTags", parsedRemovedTags);
          }
          // STAK-421: Cancel debounced sync push — override import replaces all
          // local data; pushing now would overwrite remote before user can review.
          if (
            typeof scheduleSyncPush === "function" &&
            typeof scheduleSyncPush.cancel === "function"
          ) {
            scheduleSyncPush.cancel();
          }
          renderTable();
          if (typeof renderActiveFilters === "function") renderActiveFilters();
          if (typeof updateStorageStats === "function") updateStorageStats();
          debugLog("importJson override complete", imported.length, "items replaced");
          if (
            localStorage.getItem("staktrakr.debug") &&
            typeof window.showDebugModal === "function"
          ) {
            showDebugModal();
          }
          return;
        }

        // ── DiffEngine + DiffModal path (via shared helper) ──
        // Build settings diff if the parsed JSON contains a settings object
        let settingsDiff = null;
        if (
          parsedSettings &&
          typeof parsedSettings === "object" &&
          typeof DiffEngine !== "undefined" &&
          typeof DiffEngine.compareSettings === "function"
        ) {
          const settingsKeys =
            typeof SYNC_SCOPE_KEYS !== "undefined" && Array.isArray(SYNC_SCOPE_KEYS)
              ? SYNC_SCOPE_KEYS.filter((k) => k !== "metalInventory" && k !== "itemTags")
              : [
                  "displayCurrency",
                  "appTheme",
                  "inlineChipConfig",
                  "filterChipCategoryConfig",
                  "viewModalSectionConfig",
                  "chipMinCount",
                ];
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
        showImportDiffReview(
          imported,
          { type: "json", label: file.name },
          {
            settingsDiff: settingsDiff,
            pendingTagsByUuid: pendingTagsByUuid,
            validationResult: _validationResult,
            exportMeta: parsedMeta,
          },
          function (summary) {
            // Restore itemRemovedTags from import payload (STAK-556)
            if (parsedRemovedTags && typeof saveDataSync === "function") {
              saveDataSync("itemRemovedTags", parsedRemovedTags);
            }
            debugLog(
              "importJson DiffEngine complete",
              summary.added,
              "added",
              summary.modified,
              "modified",
              summary.deleted,
              "deleted"
            );
          }
        );
      } catch (error) {
        endImportProgress();
        if (typeof showAppAlert === "function") {
          showAppAlert(`Error parsing JSON file: ${error.message}`, "JSON Import");
        }
      }
    };

    reader.readAsText(file);
  };

  // Export public API via window.*
  window.importCsv = importCsv;
  window.importJson = importJson;
  window.importJsonFromText = (text, override = false) => {
    const blob = new Blob([text], { type: "application/json" });
    const file = new File([blob], "test-import.json", { type: "application/json" });
    importJson(file, override);
  };
  window.importCsvFromText = (text, override = false) => {
    if (override) {
      const blob = new Blob([text], { type: "text/csv" });
      const file = new File([blob], "test-import.csv", { type: "text/csv" });
      importCsv(file, override);
      return;
    }
    if (typeof Papa === "undefined") return null;
    const normalizedText = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const results = Papa.parse(normalizedText, {
      header: true,
      skipEmptyLines: true,
      comments: "#",
    });
    if (!results || !results.data) return null;
    const supportedMetals = ["Silver", "Gold", "Platinum", "Palladium"];
    const parsed = [];
    for (const row of results.data) {
      const compositionRaw = row["Composition"] || row["Metal"] || "Silver";
      const composition = getCompositionFirstWords(compositionRaw);
      const metal = parseNumistaMetal(composition);
      if (!supportedMetals.includes(metal)) continue;
      const name = row["Name"] || row["name"];
      const qty = row["Qty"] || row["qty"] || 1;
      const type = normalizeType(row["Type"] || row["type"]);
      const weight = row["Weight(oz)"] || row["weight"];
      const weightUnit = row["Weight Unit"] || row["weightUnit"] || "oz";
      const priceStr = row["Purchase Price"] || row["price"];
      let price =
        typeof priceStr === "string"
          ? parseFloat(priceStr.replace(/[^\d.-]+/g, ""))
          : parseFloat(priceStr);
      if (price < 0) price = 0;
      const paymentMethod = row["Payment Method"] || row["paymentMethod"] || "";
      const purchaseLocation = row["Purchase Location"] || "";
      const storageLocation = row["Storage Location"] || "";
      const notes = row["Notes"] || "";
      const year = row["Year"] || row["year"] || row["issuedYear"] || "";
      const grade = row["Grade"] || row["grade"] || "";
      const gradingAuthority =
        row["Grading Authority"] || row["gradingAuthority"] || row["Authority"] || "";
      const certNumber = (
        row["Cert #"] ||
        row["certNumber"] ||
        row["Cert Number"] ||
        ""
      ).toString();
      const date = parseDate(row["Date"]);
      const retailStr = row["Retail Price"] || row["Market Value"] || row["marketValue"] || "0";
      const marketValue =
        typeof retailStr === "string"
          ? parseFloat(retailStr.replace(/[^\d.-]+/g, "")) || 0
          : parseFloat(retailStr) || 0;
      let spotPriceAtPurchase;
      if (row["Spot Price ($/oz)"]) {
        spotPriceAtPurchase = parseFloat(
          row["Spot Price ($/oz)"].toString().replace(/[^0-9.-]+/g, "")
        );
      } else if (row["spotPriceAtPurchase"]) {
        spotPriceAtPurchase = parseFloat(row["spotPriceAtPurchase"]);
      } else {
        spotPriceAtPurchase = 0;
      }
      const numistaRaw = (row["N#"] || row["Numista #"] || row["numistaId"] || "").toString();
      const numistaMatch = numistaRaw.match(/\d+/);
      const numistaId = numistaMatch ? numistaMatch[0] : "";
      const pcgsNumber = (row["PCGS #"] || row["PCGS Number"] || row["pcgsNumber"] || "")
        .toString()
        .trim();
      const purityRaw = row["Purity"] || row["Fineness"] || row["purity"] || "";
      const purity = parseFloat(purityRaw) || 1.0;
      const serialNumber = row["Serial Number"] || row["serialNumber"] || "";
      const serial = row["Serial"] || row["serial"] || getNextSerial();
      const uuid = row["UUID"] || row["uuid"] || "";

      const dispositionType = (row["Disposition Type"] || "").trim();
      const dispositionDate = (row["Disposition Date"] || "").trim();
      const dispositionAmount = row["Disposition Amount"] || "";
      const dispositionRealizedGainLoss = row["Realized Gain/Loss"] || "";
      const dispositionRecipient = (row["Disposition Recipient"] || "").trim();
      const dispositionNotes = (row["Disposition Notes"] || "").trim();
      const dispositionCurrency = (row["Disposition Currency"] || "").trim();
      const dispositionDisposedAt = (row["Disposition DisposedAt"] || "").trim();
      const dispositionSplitFromUuidRaw = (row["Disposition Split From UUID"] || "").trim();
      const dispositionSplitFromUuid = dispositionSplitFromUuidRaw || undefined;
      const tradedForUuids = (row["Traded For UUIDs"] || row["tradedForUuids"] || "")
        .toString()
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const tradedFromUuid = (row["Traded From UUID"] || row["tradedFromUuid"] || "")
        .toString()
        .trim();

      let disposition;
      if (dispositionType) {
        const _parsedAmount = parseFloat(String(dispositionAmount).replace(/[^0-9.\-]/g, ""));
        const _parsedGainLoss = parseFloat(
          String(dispositionRealizedGainLoss).replace(/[^0-9.\-]/g, "")
        );
        const dispositionTypeKey =
          typeof DISPOSITION_TYPES !== "undefined"
            ? (Object.keys(DISPOSITION_TYPES).find(
                (k) => DISPOSITION_TYPES[k].label === dispositionType
              ) ?? dispositionType.toLowerCase())
            : dispositionType.toLowerCase();
        disposition = {
          type: dispositionTypeKey,
          date: dispositionDate || undefined,
          amount:
            dispositionAmount !== "" && Number.isFinite(_parsedAmount) ? _parsedAmount : undefined,
          realizedGainLoss:
            dispositionRealizedGainLoss !== "" && Number.isFinite(_parsedGainLoss)
              ? _parsedGainLoss
              : undefined,
          recipient: dispositionRecipient || undefined,
          notes: dispositionNotes || undefined,
          currency: dispositionCurrency || undefined,
          disposedAt: dispositionDisposedAt || undefined,
          splitFromUuid: dispositionSplitFromUuid,
        };
        if (tradedForUuids.length > 0) disposition.tradedForUuids = tradedForUuids;
      }

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
        paymentMethod,
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
        premiumPerOz: 0,
        totalPremium: 0,
        numistaId,
        serialNumber,
        serial,
        uuid,
        disposition,
        tradedFromUuid: tradedFromUuid || undefined,
      });
      parsed.push(item);
    }
    return parsed;
  };
  window.importNumistaCsv = importNumistaCsv;
  window.exportCsv = exportCsv;
  window.exportInventoryCSV = buildCsvContent;
  window.exportNumistaCsv = exportNumistaCsv;
  window.showImportDiffReview = showImportDiffReview;
  window.startImportProgress = startImportProgress;
  window.updateImportProgress = updateImportProgress;
  window.endImportProgress = endImportProgress;
})();
