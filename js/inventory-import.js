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

  const CSV_IMPORT_KEY_PROP = "__csvImportKey";

  /**
   * Computes the import-time lookup key used for deferred per-item tag data.
   * @param {object} item - Imported inventory item.
   * @returns {string} Import lookup key, or empty string when no key is available.
   */
  const _computeImportTagLookupKey = (item) => {
    if (!item) return "";
    return typeof DiffEngine !== "undefined"
      ? DiffEngine.computeItemKey(item)
      : item.uuid || item.serial || "";
  };

  /**
   * Stores the import-time key on a non-enumerable sidecar so later UUID stamping
   * does not break pending CSV tag lookups.
   * @param {object} item - Imported CSV item.
   * @returns {string} Stored import lookup key.
   */
  const _rememberCsvImportKey = (item) => {
    const key = _computeImportTagLookupKey(item);
    if (item && key) {
      Object.defineProperty(item, CSV_IMPORT_KEY_PROP, {
        value: key,
        enumerable: false,
        configurable: true,
      });
    }
    return key;
  };

  /**
   * Gets the deferred-tag lookup key, preferring the preserved CSV import key.
   * @param {object} item - Imported inventory item.
   * @returns {string} Deferred-tag lookup key.
   */
  const _getImportTagLookupKey = (item) => {
    return item && item[CSV_IMPORT_KEY_PROP]
      ? item[CSV_IMPORT_KEY_PROP]
      : _computeImportTagLookupKey(item);
  };

  /**
   * Removes the transient CSV import key from an item after tag data is applied.
   * @param {object} item - Imported inventory item.
   */
  const _clearCsvImportKey = (item) => {
    if (item && Object.prototype.hasOwnProperty.call(item, CSV_IMPORT_KEY_PROP)) {
      delete item[CSV_IMPORT_KEY_PROP];
    }
  };

  /**
   * Ensures a CSV-imported item has stable identity before it is persisted.
   * @param {object} item - Imported CSV item.
   */
  const _stampCsvItemIdentity = (item) => {
    if (!item) return;
    if (item.serial == null || item.serial === "") item.serial = getNextSerial();
    if (!item.uuid) item.uuid = generateUUID();
  };

  /**
   * Stamps missing identities on a collection of imported CSV items.
   * @param {Array<object>} items - Imported CSV items.
   */
  const _stampCsvItemIdentities = (items) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      _stampCsvItemIdentity(item);
    }
  };

  /**
   * Stamps identity on accepted CSV additions before DiffEngine appends them.
   * @param {Array<object>} selectedChanges - Accepted DiffModal changes.
   */
  const _stampCsvSelectedAdditions = (selectedChanges) => {
    if (!Array.isArray(selectedChanges)) return;
    for (const change of selectedChanges) {
      if (change && change.type === "add") {
        _stampCsvItemIdentity(change.item);
      }
    }
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
        const itemKey = _getImportTagLookupKey(item);
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
   * Warn (via toast) when an import payload originates from a different web origin.
   * Advisory only — never blocks the import. (STAK-374)
   * @param {object} options - Import options; reads options.exportMeta.exportOrigin
   */
  const _warnImportCrossDomainOrigin = (options) => {
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
        typeof sanitizeHtml === "function"
          ? sanitizeHtml(_parsedOrigin)
          : escapeHtml(_parsedOrigin);
      showToast(
        "⚠ This backup is from a different domain (" + _safeFrom + "). Check item counts carefully."
      );
    }
  };

  /**
   * Compute the advisory "possible duplicate" key set: incoming ungraded added rows
   * sharing numistaId+year with an existing graded/certified item. Advisory only — the
   * flag is NEVER persisted onto an item. Keys via DiffEngine.computeItemKey.
   * (STRK-167 AC-11, D-4)
   * @param {object} diffResult - DiffEngine.compareItems result; reads diffResult.added
   * @returns {Set<string>} computeItemKey values flagged as possible duplicates
   */
  const _computeImportPossibleDuplicates = (diffResult) => {
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
    return possibleDuplicates;
  };

  /**
   * Persist accepted settings changes from a JSON import diff. Raw-string keys go to
   * localStorage verbatim; the rest via saveDataSync. (STAK-374)
   * @param {object|null} settingsDiff - DiffEngine.compareSettings result or null
   */
  const _applyImportSettingsChanges = (settingsDiff) => {
    if (!settingsDiff || !settingsDiff.changed || settingsDiff.changed.length === 0) return;
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
  };

  /**
   * Toast the apply summary, fire onComplete, and open the debug modal if enabled.
   * @param {Array} selectedChanges - Accepted changes (add/modify/delete)
   * @param {function} [onComplete] - Optional callback({added,modified,deleted})
   */
  const _announceImportApplySummary = (selectedChanges, onComplete) => {
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
      showToast("Import complete: " + (parts.length > 0 ? parts.join(", ") : "no changes applied"));
    }
    if (onComplete) onComplete({ added: addCount, modified: modCount, deleted: delCount });
    if (localStorage.getItem("staktrakr.debug") && typeof window.showDebugModal === "function") {
      showDebugModal();
    }
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
      if (options.stampCsvIdentity) _stampCsvItemIdentities(parsedItems);
      inventory = inventory.concat(parsedItems);
      _applyCsvRemovedTags(parsedItems, options.pendingRemovedTagsByUuid || new Map());
      _postImportCleanup(parsedItems, options.pendingTagsByUuid);
      if (options.stampCsvIdentity) {
        parsedItems.forEach(_clearCsvImportKey);
      }
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
      // STRK-220: a CSV merge may carry only Tags/removedTags column edits, which are not
      // diffed inventory fields, so the row matches and yields zero changes. Honor the tag
      // columns anyway (CSV-gated, so JSON/ZIP/Numista are untouched), then re-render.
      const _csvPendingTagEdits =
        options.stampCsvIdentity &&
        ((options.pendingTagsByUuid && options.pendingTagsByUuid.size) ||
          (options.pendingRemovedTagsByUuid && options.pendingRemovedTagsByUuid.size));
      if (_csvPendingTagEdits) {
        _applyCsvAddedTags(parsedItems, options.pendingTagsByUuid || new Map());
        _applyCsvRemovedTags(parsedItems, options.pendingRemovedTagsByUuid || new Map());
        parsedItems.forEach(_clearCsvImportKey);
        if (typeof renderTable === "function") renderTable();
        if (typeof showToast === "function") showToast("Import complete: tags updated");
        if (onComplete) onComplete({ added: 0, modified: 0, deleted: 0 });
        return;
      }
      // A ZIP restore still carries ancillary data (custom lookup rules, cached
      // pattern/user images, attachments) that may be missing locally even when
      // inventory and mapped settings already match \u2014 run the ancillary restore
      // rather than bailing, or those images stay orphaned (STRK-202).
      if (options.alwaysApplyAncillary && onComplete) {
        onComplete({ added: 0, modified: 0, deleted: 0 });
        return;
      }
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

    _warnImportCrossDomainOrigin(options);

    const possibleDuplicates = _computeImportPossibleDuplicates(diffResult);

    DiffModal.show({
      source: sourceInfo,
      diff: diffResult,
      settingsDiff: settingsDiff,
      backupCount: _backupCount,
      localCount: _localCount,
      possibleDuplicates: possibleDuplicates,
      onApply: function (selectedChanges) {
        if (!selectedChanges || selectedChanges.length === 0) return;

        if (options.stampCsvIdentity) _stampCsvSelectedAdditions(selectedChanges);
        inventory = DiffEngine.applySelectedChanges(inventory, selectedChanges);

        // STRK-220: Tags/removedTags are side-channel CSV columns, not diffed fields, so
        // existing items surface as a `modify` change (which carries no .item) or as
        // `unchanged`. Apply tags over the parsed items that landed in inventory (matched
        // plus selected adds), keyed by the preserved __csvImportKey. Mirrors the override
        // and fallback paths and reconciles the old dead add/modify branch.
        const _inventoryKeys = new Set(inventory.map((it) => DiffEngine.computeItemKey(it)));
        const _importedItems = parsedItems.filter((p) =>
          _inventoryKeys.has(DiffEngine.computeItemKey(p))
        );
        _applyCsvAddedTags(_importedItems, options.pendingTagsByUuid || new Map());
        _applyCsvRemovedTags(_importedItems, options.pendingRemovedTagsByUuid || new Map());

        _applyImportSettingsChanges(settingsDiff);

        if (options.stampCsvIdentity) parsedItems.forEach(_clearCsvImportKey);
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

        _announceImportApplySummary(selectedChanges, onComplete);
      },
      onCancel: function () {
        debugLog("Import cancelled by user");
      },
    });
  };

  /**
   * Parse a disposition money field (amount or realized gain/loss) from a CSV cell.
   * Strips non-numeric chars; returns undefined for an empty cell or non-finite value.
   * @param {string} raw - Raw CSV cell value
   * @returns {number|undefined} Parsed amount, or undefined
   */
  const _parseDispositionAmount = (raw) => {
    const n = parseFloat(String(raw).replace(/[^0-9.\-]/g, ""));
    return raw !== "" && Number.isFinite(n) ? n : undefined;
  };

  /**
   * Build the disposition object from a CSV row's Disposition* columns.
   * Returns undefined when the row has no Disposition Type. Normalizes display
   * labels ("Sold") to internal keys ("sold") for round-trip fidelity.
   * @param {object} row - Parsed CSV row keyed by header
   * @returns {object|undefined} Disposition object, or undefined
   */
  const _parseCsvDisposition = (row) => {
    const dispositionType = (row["Disposition Type"] || "").trim();
    if (!dispositionType) return undefined;
    const dispositionSplitFromUuidRaw = (row["Disposition Split From UUID"] || "").trim();
    const tradedForUuids = (row["Traded For UUIDs"] || row["tradedForUuids"] || "")
      .toString()
      .split(",")
      .map((uuid) => uuid.trim())
      .filter(Boolean);
    const dispositionTypeKey =
      typeof DISPOSITION_TYPES !== "undefined"
        ? (Object.keys(DISPOSITION_TYPES).find(
            (k) => DISPOSITION_TYPES[k].label === dispositionType
          ) ?? dispositionType.toLowerCase())
        : dispositionType.toLowerCase();
    const disposition = {
      type: dispositionTypeKey,
      date: (row["Disposition Date"] || "").trim() || undefined,
      amount: _parseDispositionAmount(row["Disposition Amount"] || ""),
      realizedGainLoss: _parseDispositionAmount(row["Realized Gain/Loss"] || ""),
      recipient: (row["Disposition Recipient"] || "").trim() || undefined,
      notes: (row["Disposition Notes"] || "").trim() || undefined,
      currency: (row["Disposition Currency"] || "").trim() || undefined,
      disposedAt: (row["Disposition DisposedAt"] || "").trim() || undefined,
      splitFromUuid: dispositionSplitFromUuidRaw || undefined,
    };
    if (tradedForUuids.length > 0) disposition.tradedForUuids = tradedForUuids;
    return disposition;
  };

  /**
   * Parse the pipe-delimited Attachments column into attachment metadata stubs.
   * Each entry is "fileName#attachmentUuid"; malformed entries are dropped.
   * @param {object} row - Parsed CSV row keyed by header
   * @returns {Array<object>} Attachment metadata (no file bytes — metadata only)
   */
  const _parseCsvAttachments = (row) => {
    const attachmentsRaw = (row["Attachments"] || "").trim();
    if (!attachmentsRaw) return [];
    return attachmentsRaw
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
      .filter(Boolean);
  };

  /**
   * Read core item fields (identity-agnostic) from a CSV row.
   * @param {object} row - Parsed CSV row keyed by header
   * @returns {object} { name, qty, type, weight, weightUnit, price, paymentMethod,
   *   purchaseLocation, storageLocation, notes, date }
   */
  const _readCsvBaseFields = (row) => {
    const priceStr = row["Purchase Price"] || row["price"];
    let price =
      typeof priceStr === "string"
        ? parseFloat(priceStr.replace(/[^\d.-]+/g, ""))
        : parseFloat(priceStr);
    if (price < 0) price = 0;
    return {
      name: row["Name"] || row["name"],
      qty: row["Qty"] || row["qty"] || 1,
      type: normalizeType(row["Type"] || row["type"]),
      weight: row["Weight(oz)"] || row["weight"],
      weightUnit: row["Weight Unit"] || row["weightUnit"] || "oz",
      price,
      paymentMethod: row["Payment Method"] || row["paymentMethod"] || "",
      purchaseLocation: row["Purchase Location"] || "",
      storageLocation: row["Storage Location"] || "",
      notes: row["Notes"] || "",
      date: parseDate(row["Date"]),
    };
  };

  /**
   * Read grading/catalog fields (year, grade, authority, cert, numista, pcgs, purity).
   * @param {object} row - Parsed CSV row keyed by header
   * @returns {object} grading/catalog field bag
   */
  const _readCsvGradingFields = (row) => {
    const numistaRaw = (row["N#"] || row["Numista #"] || row["numistaId"] || "").toString();
    const numistaMatch = numistaRaw.match(/\d+/);
    const purityRaw = row["Purity"] || row["Fineness"] || row["purity"] || "";
    return {
      year: row["Year"] || row["year"] || row["issuedYear"] || "",
      grade: row["Grade"] || row["grade"] || "",
      gradingAuthority:
        row["Grading Authority"] || row["gradingAuthority"] || row["Authority"] || "",
      certNumber: (row["Cert #"] || row["certNumber"] || row["Cert Number"] || "").toString(),
      numistaId: numistaMatch ? numistaMatch[0] : "",
      pcgsNumber: (row["PCGS #"] || row["PCGS Number"] || row["pcgsNumber"] || "")
        .toString()
        .trim(),
      purity: parseFloat(purityRaw) || 1.0,
    };
  };

  /**
   * Read valuation fields (market value + spot price at purchase). Premium fields
   * default to 0 (legacy CSVs don't carry them).
   * @param {object} row - Parsed CSV row keyed by header
   * @returns {object} { marketValue, spotPriceAtPurchase, premiumPerOz, totalPremium }
   */
  const _readCsvMarketFields = (row) => {
    const retailStr = row["Retail Price"] || row["Market Value"] || row["marketValue"] || "0";
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
    return { marketValue, spotPriceAtPurchase, premiumPerOz: 0, totalPremium: 0 };
  };

  /**
   * Read identity/image fields. NOTE: reads `serial` via getNextSerial() when absent,
   * which advances the serial counter — call exactly once per imported row.
   * @param {object} row - Parsed CSV row keyed by header
   * @returns {object} { serialNumber, serial, uuid, obverseImageUrl, reverseImageUrl }
   */
  const _readCsvIdentityFields = (row) => {
    return {
      serialNumber: row["Serial Number"] || row["serialNumber"] || "",
      serial: row["Serial"] || row["serial"] || getNextSerial(),
      uuid: row["UUID"] || row["uuid"] || "",
      obverseImageUrl: row["Obverse Image URL"] || row["obverseImageUrl"] || "",
      reverseImageUrl: row["Reverse Image URL"] || row["reverseImageUrl"] || "",
    };
  };

  /**
   * Build one sanitized inventory item from a CSV row, registering its composition.
   * @param {object} row - Parsed CSV row keyed by header
   * @param {string} metal - Pre-resolved precious metal for the row
   * @param {string} composition - Pre-resolved composition for the row
   * @returns {{item: object, csvTags: string, csvRemovedTags: string}}
   */
  const _buildCsvItemFromRow = (row, metal, composition) => {
    const base = _readCsvBaseFields(row);
    const grading = _readCsvGradingFields(row);
    const market = _readCsvMarketFields(row);
    const identity = _readCsvIdentityFields(row);
    const disposition = _parseCsvDisposition(row);
    const csvAttachments = _parseCsvAttachments(row);
    const csvTags = (row["Tags"] || row["tags"] || "").trim();
    const csvRemovedTags = (row["removedTags"] || row["Removed Tags"] || "").trim();
    const tradedFromUuid = (row["Traded From UUID"] || row["tradedFromUuid"] || "")
      .toString()
      .trim();

    addCompositionOption(composition);

    const item = sanitizeImportedItem({
      metal,
      composition,
      ...base,
      ...grading,
      ...market,
      ...identity,
      disposition,
      tradedFromUuid: tradedFromUuid || undefined,
    });

    if (csvAttachments.length > 0) item.attachments = csvAttachments;
    return { item, csvTags, csvRemovedTags };
  };

  /**
   * Collect deferred add/remove tags for an imported item, keyed by computeItemKey
   * so legacy UUID-less CSV rows still match after serial→uuid enrichment.
   * (STAK-126/424/556)
   * @param {object} item - Sanitized imported item
   * @param {string} csvTags - Semicolon-delimited tags to add
   * @param {string} csvRemovedTags - Semicolon-delimited tags to mark removed
   * @param {Map<string,string[]>} pendingTagsByUuid - itemKey -> add list (mutated)
   * @param {Map<string,string[]>} pendingRemovedTagsByUuid - itemKey -> remove list (mutated)
   */
  const _collectCsvPendingTags = (
    item,
    csvTags,
    csvRemovedTags,
    pendingTagsByUuid,
    pendingRemovedTagsByUuid
  ) => {
    const importKey = _rememberCsvImportKey(item);
    if (csvTags) {
      const tagList = csvTags
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length) {
        if (importKey) pendingTagsByUuid.set(importKey, tagList);
      }
    }

    if (csvRemovedTags) {
      const removedList = csvRemovedTags
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean);
      if (removedList.length) {
        if (importKey) pendingRemovedTagsByUuid.set(importKey, removedList);
      }
    }
  };

  /**
   * Apply deferred add-tags from a CSV import into the itemTags store.
   * Shared by the override and merge paths. (STAK-424, STRK-220)
   * @param {Array} items - Imported items
   * @param {Map<string,string[]>} pendingTagsByUuid - itemKey -> add list
   */
  const _applyCsvAddedTags = (items, pendingTagsByUuid) => {
    if (pendingTagsByUuid.size === 0 || typeof addItemTag !== "function") return;
    const stampedUuids = new Set();
    for (const item of items) {
      if (!item.uuid) continue; // STRK-220: skip deselected/uuid-less imports
      const itemKey = _getImportTagLookupKey(item);
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
  };

  /**
   * Persist deferred removed-tags from a CSV import into the itemRemovedTags store.
   * Shared by the override and merge paths. (STAK-556)
   * @param {Array} items - Imported items
   * @param {Map<string,string[]>} pendingRemovedTagsByUuid - itemKey -> remove list
   */
  const _applyCsvRemovedTags = (items, pendingRemovedTagsByUuid) => {
    if (pendingRemovedTagsByUuid.size === 0 || typeof saveDataSync !== "function") return;
    const removedMap =
      typeof loadDataSync === "function" ? loadDataSync("itemRemovedTags", {}) : {};
    for (const item of items) {
      const key = _getImportTagLookupKey(item);
      const removedTags = pendingRemovedTagsByUuid.get(key);
      if (item.uuid && removedTags && removedTags.length) {
        removedMap[item.uuid] = removedTags;
      }
    }
    saveDataSync("itemRemovedTags", removedMap);
  };

  /**
   * Toast a metadata-only warning when imported items carry attachment references
   * (CSV/JSON import does not restore the underlying files). Shared override/merge.
   * @param {Array} items - Imported items
   */
  const _warnCsvAttachmentsMetadataOnly = (items) => {
    const attachCount = items.reduce(
      (n, it) => n + (Array.isArray(it.attachments) ? it.attachments.length : 0),
      0
    );
    if (attachCount > 0 && typeof showToast === "function") {
      showToast(
        `${attachCount} attachment(s) imported as metadata only — use a backup ZIP to restore files.`,
        "warning"
      );
    }
  };

  /**
   * Override-import path for CSV: replace the entire inventory with the parsed items,
   * apply deferred tags, cancel the debounced sync push, and re-render. (STAK-421/424)
   * @param {Array} imported - Validated imported items
   * @param {Map<string,string[]>} pendingTagsByUuid - itemKey -> add list
   * @param {Map<string,string[]>} pendingRemovedTagsByUuid - itemKey -> remove list
   */
  const _csvImportApplyOverride = (imported, pendingTagsByUuid, pendingRemovedTagsByUuid) => {
    if (typeof migrateLegacySilverbackWeightUnit === "function") {
      migrateLegacySilverbackWeightUnit(imported);
    }
    _stampCsvItemIdentities(imported);
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
    _applyCsvAddedTags(imported, pendingTagsByUuid);
    _applyCsvRemovedTags(imported, pendingRemovedTagsByUuid);
    imported.forEach(_clearCsvImportKey);
    // STAK-421: Cancel the debounced sync push that saveInventory() just scheduled —
    // override imports replace all local data, so pushing immediately would overwrite
    // the remote vault before the user can review.
    if (typeof scheduleSyncPush === "function" && typeof scheduleSyncPush.cancel === "function") {
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
    _warnCsvAttachmentsMetadataOnly(imported);
    if (localStorage.getItem("staktrakr.debug") && typeof window.showDebugModal === "function") {
      showDebugModal();
    }
  };

  /**
   * Merge-import path for CSV: route the parsed items through the shared diff-review
   * modal, then warn about attachments + restore removed tags on apply.
   * @param {Array} imported - Validated imported items
   * @param {File} file - Source CSV file (for the diff source label)
   * @param {object|null} validationResult - Pre-validation result (skip counts)
   * @param {Map<string,string[]>} pendingTagsByUuid - itemKey -> add list
   * @param {Map<string,string[]>} pendingRemovedTagsByUuid - itemKey -> remove list
   */
  const _csvImportRunMergeReview = (
    imported,
    file,
    validationResult,
    pendingTagsByUuid,
    pendingRemovedTagsByUuid
  ) => {
    showImportDiffReview(
      imported,
      { type: "csv", label: file.name },
      {
        validationResult: validationResult,
        pendingTagsByUuid: pendingTagsByUuid,
        pendingRemovedTagsByUuid: pendingRemovedTagsByUuid,
        stampCsvIdentity: true,
      },
      function (summary) {
        _warnCsvAttachmentsMetadataOnly(imported);
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

            const { item, csvTags, csvRemovedTags } = _buildCsvItemFromRow(row, metal, composition);
            imported.push(item);
            if (!item.paymentMethod) delete item.paymentMethod;

            _collectCsvPendingTags(
              item,
              csvTags,
              csvRemovedTags,
              pendingTagsByUuid,
              pendingRemovedTagsByUuid
            );

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
            _csvImportApplyOverride(imported, pendingTagsByUuid, pendingRemovedTagsByUuid);
            return;
          }

          // --- Merge path: use shared DiffEngine + DiffModal helper ---
          _csvImportRunMergeReview(
            imported,
            file,
            _validationResult,
            pendingTagsByUuid,
            pendingRemovedTagsByUuid
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
   * Assemble the combined notes field for a Numista row: human notes/comments plus
   * a full markdown dump of the original row under a "Numista Import Data" heading.
   * @param {object} row - Parsed Numista CSV row
   * @param {function} getValue - Case-insensitive multi-key row accessor
   * @returns {string} Final notes string
   */
  const _buildNumistaNotes = (row, getValue) => {
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
    return markdownNote ? (notes ? `${notes}\n\n${markdownNote}` : markdownNote) : notes;
  };

  /**
   * Build one sanitized inventory item from a Numista export row. Registers the
   * composition for EVERY row (including non-PM rows that are skipped afterward).
   * @param {object} row - Parsed Numista CSV row
   * @param {function} getValue - Case-insensitive multi-key row accessor
   * @returns {{skipped: true, name: string, compositionRaw: string} |
   *   {skipped: false, item: object}}
   */
  const _buildNumistaItemFromRow = (row, getValue) => {
    const supportedMetals = ["Silver", "Gold", "Platinum", "Palladium"];
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

    const metal = parseNumistaMetal(composition);

    // Skip non-precious-metal items (Paper, Alloy, Copper, Nickel, etc.)
    if (!supportedMetals.includes(metal)) {
      return { skipped: true, name, compositionRaw };
    }

    const qty = parseInt(getValue(row, ["Quantity", "Qty", "Quantity owned"]) || 1, 10);
    const type = normalizeType(mapNumistaType(getValue(row, ["Type"]) || ""));
    const weight = _parseNumistaWeight(row);
    const { purchasePrice, marketValue } = _parseNumistaPrices(row);

    const purchaseLocRaw = getValue(row, ["Acquisition place", "Acquired from", "Purchase place"]);
    const purchaseLocation = purchaseLocRaw && purchaseLocRaw.trim() ? purchaseLocRaw.trim() : "—";
    const paymentMethod = getValue(row, ["Payment Method", "Payment method"]) || "";
    const storageLocRaw = getValue(row, ["Storage location", "Stored at", "Storage place"]);
    const storageLocation = storageLocRaw && storageLocRaw.trim() ? storageLocRaw.trim() : "—";

    const dateStrRaw = getValue(row, ["Acquisition date", "Date acquired", "Date"]);
    const dateStr = dateStrRaw && dateStrRaw.trim() ? dateStrRaw.trim() : "—";
    const date = parseDate(dateStr);

    const finalNotes = _buildNumistaNotes(row, getValue);

    // STRK-167 (D-3): do NOT pre-stamp uuid/serial here. A pre-stamped uuid makes
    // computeItemKey return it first, masking the instance tier so the diff never
    // matches existing items (the STRK-165 duplication bug). Identity is stamped
    // later: enrich backfills matched rows, then unmatched rows are stamped pre-diff.
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
      spotPriceAtPurchase: 0,
      premiumPerOz: 0,
      totalPremium: 0,
      numistaId,
      year: issuedYear,
      grade: "",
      gradingAuthority: "",
      certNumber: "",
      pcgsNumber: "",
    });

    return { skipped: false, item };
  };

  /**
   * Stamp uuid + serial on rows that still lack identity (matched rows get a uuid
   * backfilled by enrichItemIdentities; genuinely-new rows are stamped here). (STRK-167 D-3)
   * @param {Array} rows - Items to stamp in place
   */
  const _stampNumistaIdentity = (rows) => {
    for (const it of rows) {
      if (it.serial == null || it.serial === "") it.serial = getNextSerial();
      if (!it.uuid) it.uuid = generateUUID();
    }
  };

  /**
   * Override-import path for Numista CSV (AC-13): replace the entire inventory with
   * the collapsed rows, no diff modal. (STAK-421)
   * @param {Array} collapsed - Instance-collapsed imported items
   */
  const _numistaImportOverride = (collapsed) => {
    _stampNumistaIdentity(collapsed);
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
      if (typeof scheduleSyncPush === "function") scheduleSyncPush.cancel?.();
      renderTable();
      if (typeof renderActiveFilters === "function") renderActiveFilters();
      if (typeof updateStorageStats === "function") updateStorageStats();
    };
    runReplace().catch((error) => handleError(error, "Numista CSV import"));
  };

  /**
   * Merge-import path for Numista CSV (AC-7/9/12): enrich identities, stamp the
   * still-unmatched rows, then route through the shared diff-review modal.
   * @param {Array} collapsed - Instance-collapsed imported items
   * @param {File} file - Source CSV file (for the diff source label)
   */
  const _numistaImportRunMergeReview = (collapsed, file) => {
    if (
      typeof DiffEngine !== "undefined" &&
      typeof DiffEngine.enrichItemIdentities === "function"
    ) {
      DiffEngine.enrichItemIdentities(inventory, collapsed); // backfill matched uuids
    }
    _stampNumistaIdentity(collapsed); // stamp still-unmatched before the diff

    showImportDiffReview(collapsed, { type: "csv", label: file.name }, {}, function (summary) {
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
    });
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

            const built = _buildNumistaItemFromRow(row, getValue);
            if (built.skipped) {
              skippedNonPM.push(
                `${built.name || `Row ${processed}`} (${built.compositionRaw || "unknown"})`
              );
              updateImportProgress(processed, importedCount, totalRows);
              continue;
            }
            imported.push(built.item);
            if (!built.item.paymentMethod) delete built.item.paymentMethod;
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

          if (override) {
            _numistaImportOverride(collapsed);
            return;
          }

          _numistaImportRunMergeReview(collapsed, file);
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
  window.showImportDiffReview = showImportDiffReview;
  window.startImportProgress = startImportProgress;
  window.updateImportProgress = updateImportProgress;
  window.endImportProgress = endImportProgress;

  // ---------------------------------------------------------------------------
  // Regex-heavy parsers are intentionally defined LAST in this file. Lizard's
  // tokenizer can desync on certain regex literals (e.g. a ")" inside a "[^)]"
  // character class) and roll the FOLLOWING function's complexity into the
  // previous one — a false-positive CCN spike. Keeping these helpers after every
  // real function (only the IIFE close follows) prevents that rollup. See
  // STRK-170 cohort 1.2 + the project's lizard regex-desync note.
  // ---------------------------------------------------------------------------

  /**
   * Parse the heaviest weight/mass column from a Numista row into troy ounces.
   * @param {object} row - Parsed Numista CSV row
   * @returns {number} Weight in troy ounces (6dp)
   */
  const _parseNumistaWeight = (row) => {
    const weightCols = Object.keys(row).filter((k) => {
      const key = k.toLowerCase();
      return key.includes("weight") || key.includes("mass");
    });
    let weightGrams = 0;
    for (const col of weightCols) {
      const val = parseFloat(String(row[col]).replace(/[^0-9.]/g, ""));
      if (!isNaN(val)) weightGrams = Math.max(weightGrams, val);
    }
    return parseFloat(gramsToOzt(weightGrams).toFixed(6));
  };

  /**
   * Parse purchase + market price from a Numista row, converting to USD and
   * cross-filling one from the other when only one is present.
   * @param {object} row - Parsed Numista CSV row
   * @returns {{purchasePrice: number, marketValue: number}}
   */
  const _parseNumistaPrices = (row) => {
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
    if (priceKey) purchasePrice = parsePriceField(priceKey);
    if (estimateKey) marketValue = parsePriceField(estimateKey);
    // Cross-fill: a row with only one price uses it for both.
    if (marketValue === 0 && purchasePrice > 0) marketValue = purchasePrice;
    if (purchasePrice === 0 && marketValue > 0) purchasePrice = marketValue;
    return { purchasePrice, marketValue };
  };
})();
