// UTILS · STORAGE REPORT (STRK-177)
// =============================================================================
// Storage usage statistics, extracted verbatim from js/utils.js to keep each
// file under the Codacy Lizard file-nloc gate (1500). Holds: updateStorageStats,
// generateStorageReport.
//
// The legacy storage-report popup renderer (openStorageReportPopup,
// generateStorageReportHTML and its CSS/JS/analysis helpers,
// generateStorageReportTar) was removed in STRK-184: its #storageReportModal
// markup no longer exists in index.html and nothing called it, leaving an
// unreachable XSS-prone HTML generator. Restore from git history if the
// report feature is ever re-wired.
//
// Bare global declarations (no IIFE) — other modules keep calling these as globals
// with no call-site change. Calls utils-format.js + utils.js core + persistence at
// runtime, so load order alone suffices. Loads before js/utils.js in index.html.
// =============================================================================

// =============================================================================

/**
 * Updates footer with localStorage usage statistics
 * and visual usage indicator
 */
const updateStorageStats = async () => {
  try {
    // localStorage: 5MB limit in bytes
    const lsLimit = 5 * 1024 * 1024;
    let lsUsed = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      // localStorage stores strings in UTF-16 (~2 bytes per character)
      lsUsed += (key.length + (value ? value.length : 0)) * 2;
    }

    // IndexedDB: fetch from imageCache if available
    let idbUsed = 0;
    let idbLimit = 50 * 1024 * 1024; // 50MB default
    if (window.imageCache?.isAvailable()) {
      try {
        const idbStats = await imageCache.getStorageUsage();
        idbUsed = idbStats.totalBytes || 0;
        idbLimit = idbStats.limitBytes || idbLimit;
      } catch {
        /* ignore */
      }
    }

    // Combined total for display
    const combinedLimit = lsLimit + idbLimit;
    const combinedUsed = lsUsed + idbUsed;

    const el = document.getElementById("storageUsage");
    if (el) {
      const lsKB = (lsUsed / 1024).toFixed(1);
      const idbKB = idbUsed > 0 ? (idbUsed / 1024).toFixed(1) : "0";
      const totalMB = (combinedUsed / (1024 * 1024)).toFixed(2);
      const limitMB = (combinedLimit / (1024 * 1024)).toFixed(0);
      // Show legend dots + breakdown
      el.innerHTML =
        `<span class="storage-dot storage-dot--ls"></span>LS ${lsKB} KB` +
        ` <span class="storage-dot storage-dot--idb"></span>IDB ${idbKB} KB` +
        ` <span style="color:var(--text-muted); margin-left:4px;">(${totalMB} MB / ${limitMB} MB)</span>`;
    }

    // Multi-color bar: widths as % of combined limit
    const lsBar = document.getElementById("storageBarLs");
    const idbBar = document.getElementById("storageBarIdb");
    if (lsBar) lsBar.style.width = `${(lsUsed / combinedLimit) * 100}%`;
    if (idbBar) idbBar.style.width = `${(idbUsed / combinedLimit) * 100}%`;

    // Update tooltips with details
    if (lsBar)
      lsBar.title = `localStorage: ${(lsUsed / 1024).toFixed(1)} KB / ${(lsLimit / (1024 * 1024)).toFixed(0)} MB`;
    if (idbBar)
      idbBar.title = `IndexedDB Images: ${(idbUsed / 1024).toFixed(1)} KB / ${(idbLimit / (1024 * 1024)).toFixed(0)} MB`;
  } catch (err) {
    const el = document.getElementById("storageUsage");
    if (el) el.textContent = "Storage info unavailable";
    console.warn("Could not calculate storage", err);
  }
};

/** Generates a storage utilization report */
function generateStorageReport() {
  try {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || "";
      const sizeBytes = (k.length + v.length) * 2; // rough UTF-16 bytes
      items.push({ key: k, sizeBytes, sizeKB: +(sizeBytes / 1024).toFixed(2) });
    }
    items.sort((a, b) => b.sizeBytes - a.sizeBytes);
    const totalBytes = items.reduce((s, x) => s + x.sizeBytes, 0);
    return { totalKB: +(totalBytes / 1024).toFixed(2), items };
  } catch (e) {
    return { totalKB: 0, items: [] };
  }
}

// =============================================================================
// Public surface (moved verbatim from js/utils.js with the functions).
if (typeof window !== "undefined") {
  window.updateStorageStats = updateStorageStats;
  window.generateStorageReport = generateStorageReport;
}
