// UTILS · STORAGE REPORT (STRK-177)
// =============================================================================
// The storage-usage report popup (HTML/CSS/JS renderer + analysis), extracted
// verbatim from js/utils.js to keep each file under the Codacy Lizard file-nloc
// gate (1500). Pure code motion — no behavior change. Holds: updateStorageStats,
// openStorageReportPopup, generateStorageReportHTML and its analysis/format
// helpers, getStorageReportCSS/JS, generateStorageReportTar, generateStorageReport.
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

/**
 * Displays the storage report HTML inside a modal iframe
 */
const openStorageReportPopup = async () => {
  // Fetch IndexedDB stats before generating report
  let idbStats = null;
  if (window.imageCache?.isAvailable()) {
    try {
      idbStats = await imageCache.getStorageUsage();
    } catch {
      /* ignore */
    }
  }
  const htmlContent = generateStorageReportHTML(idbStats);
  const modal = document.getElementById("storageReportModal");
  const iframe = document.getElementById("storageReportFrame");

  if (!modal || !iframe) {
    appAlert("Storage report modal not found.");
    return;
  }

  iframe.srcdoc = htmlContent;

  const closeBtn = document.getElementById("storageReportCloseBtn");

  const closeModal = () => {
    modal.style.display = "none";
    document.body.style.overflow = "";
  };

  if (!modal.dataset.initialized) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
    if (closeBtn) {
      closeBtn.addEventListener("click", closeModal);
    }
    modal.dataset.initialized = "true";
  }

  modal.style.display = "flex";
  document.body.style.overflow = "hidden";
};
/**
 * Generates comprehensive HTML storage report with theme support
 */
const generateStorageReportHTML = (idbStats) => {
  const reportData = analyzeStorageData();
  const timestamp = formatTimestamp(new Date());
  const rawTheme = document.documentElement.getAttribute("data-theme");
  const currentTheme = ["dark", "slate"].includes(rawTheme) ? "dark" : "light";

  return `<!DOCTYPE html>
<html lang="en" data-theme="${currentTheme}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>StakTrakr Storage Report</title>
    <style>
        ${getStorageReportCSS()}
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
</head>
<body>
    <div class="report-container">
        <header class="report-header">
            <div class="header-content">
                <h1>📊 StakTrakr Storage Report</h1>
                <div class="header-controls">
                    <button onclick="toggleTheme()" class="theme-toggle-btn">🌓</button>
                    <button onclick="window.close(); return false;" class="close-btn" aria-label="Close report">×</button>
                </div>
            </div>
            <div class="report-meta">
                <span>Generated: ${timestamp}</span>
                <span>Version: ${APP_VERSION}</span>
                <span>Theme: ${currentTheme}</span>
            </div>
        </header>
        
        <div class="print-controls">
            <button onclick="window.print()" class="print-btn">🖨️ Print Report</button>
        </div>
        
        <section class="storage-summary">
            <h2>Storage Overview</h2>
            <div class="summary-grid">
                <div class="summary-item">
                    <span class="summary-label">localStorage Used:</span>
                    <span class="summary-value">${reportData.totalSize.toFixed(2)} KB / 5,120 KB</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">localStorage Items:</span>
                    <span class="summary-value">${reportData.items.length}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Largest Item:</span>
                    <span class="summary-value">${reportData.largestItem ? getStorageItemDisplayName(reportData.largestItem.key) : "None"} ${reportData.largestItem ? "(" + reportData.largestItem.size.toFixed(2) + " KB)" : ""}</span>
                </div>
                ${
                  idbStats
                    ? `
                <div class="summary-item">
                    <span class="summary-label">IndexedDB (Images):</span>
                    <span class="summary-value">${(idbStats.totalBytes / 1024).toFixed(1)} KB / ${(idbStats.limitBytes / (1024 * 1024)).toFixed(0)} MB (${idbStats.count} cached)</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Combined Total:</span>
                    <span class="summary-value">${((reportData.totalSize * 1024 + idbStats.totalBytes) / 1024).toFixed(1)} KB</span>
                </div>`
                    : ""
                }
            </div>
        </section>
        
        <section class="storage-visualization">
            <h2>Storage Distribution</h2>
            <div class="chart-section">
                <div class="chart-container">
                    <canvas id="storageChart" width="400" height="400"></canvas>
                </div>
                <div class="chart-legend">
                    <h3>Click on chart or items below for details</h3>
                    <div class="legend-items">
                        ${reportData.items
                          .slice(0, 5)
                          .map(
                            (item, index) => `
                            <div class="legend-item" onclick="showItemDetail('${item.key}')" data-index="${index}">
                                <span class="legend-color" style="background-color: ${getChartColor(index)}"></span>
                                <span class="legend-label">${getStorageItemDisplayName(item.key)}</span>
                                <span class="legend-value">${item.size.toFixed(1)} KB (${item.percentage.toFixed(1)}%)</span>
                            </div>
                        `
                          )
                          .join("")}
                    </div>
                </div>
            </div>
        </section>
        
        <section class="storage-breakdown">
            <h2>Storage Items Details</h2>
            <div class="items-grid">
                ${reportData.items
                  .map(
                    (item) => `
                    <div class="storage-item" onclick="showItemDetail('${item.key}')">
                        <div class="item-header">
                            <h3>${getStorageItemDisplayName(item.key)}</h3>
                            <div class="item-meta">
                                <span class="item-size">${item.size.toFixed(2)} KB</span>
                                <span class="item-percentage">${item.percentage.toFixed(1)}%</span>
                            </div>
                        </div>
                        <div class="item-description">
                            ${getStorageItemDescription(item.key)}
                        </div>
                        <div class="item-details">
                            <span class="detail-item">Type: ${item.type}</span>
                            <span class="detail-item">Records: ${item.recordCount}</span>
                        </div>
                    </div>
                `
                  )
                  .join("")}
            </div>
        </section>
        
        <footer class="report-footer">
            <p>Generated by StakTrakr v${APP_VERSION} • ${new Date().getFullYear()}</p>
            <p>This report contains a snapshot of your local browser storage data.</p>
        </footer>
    </div>
    
    <!-- Modal for item details -->
    <div id="itemDetailModal" class="storage-modal" style="display: none;">
        <div class="modal-content-large">
            <div class="modal-header">
                <h3 id="modalTitle">Item Details</h3>
                <button class="modal-close" onclick="closeItemDetail()">&times;</button>
            </div>
            <div class="modal-body" id="modalContent">
                <!-- Content populated by JavaScript -->
            </div>
        </div>
    </div>
    
    <script>
        ${getStorageReportJS()}
        
        // Initialize chart when page loads
        window.addEventListener('DOMContentLoaded', function() {
            initializeStorageChart(${JSON.stringify(reportData)});
        });
    </script>
</body>
</html>`;
};

/**
 * Gets chart color for given index
 */
const getChartColor = (index) => {
  const colors = [
    "#007bff",
    "#28a745",
    "#ffc107",
    "#dc3545",
    "#6f42c1",
    "#fd7e14",
    "#20c997",
    "#e83e8c",
    "#6c757d",
    "#17a2b8",
  ];
  return colors[index % colors.length];
};

/**
 * Analyzes localStorage data and calculates memory usage
 */
const analyzeStorageData = () => {
  const items = [];
  let totalSize = 0;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    let value = localStorage.getItem(key);

    // Sanitize sensitive data
    if (key === API_KEY_STORAGE_KEY) {
      try {
        const config = JSON.parse(value || "{}");
        if (config?.keys) {
          value = JSON.stringify({ ...config, keys: {} });
        }
      } catch (err) {
        console.warn("Could not sanitize API config for report", err);
      }
    }

    // Calculate size (localStorage stores UTF-16, ~2 bytes per character)
    const size = ((key.length + (value ? value.length : 0)) * 2) / 1024; // KB
    totalSize += size;

    // Determine data type and record count
    const analysis = analyzeStorageItem(key, value);

    items.push({
      key,
      size,
      value,
      type: analysis.type,
      recordCount: analysis.recordCount,
      parsedData: analysis.parsedData,
    });
  }

  // Calculate percentages and sort by size
  items.forEach((item) => {
    item.percentage = (item.size / totalSize) * 100;
  });

  items.sort((a, b) => b.size - a.size);

  return {
    items,
    totalSize,
    largestItem: items[0] || { name: "None", size: 0 },
  };
};

/**
 * Analyzes a storage item to determine its type and content
 */
const analyzeStorageItem = (key, value) => {
  let type = "String";
  let recordCount = 1;
  let parsedData = null;

  try {
    parsedData = JSON.parse(value);

    if (Array.isArray(parsedData)) {
      type = "Array";
      recordCount = parsedData.length;
    } else if (typeof parsedData === "object" && parsedData !== null) {
      type = "Object";
      recordCount = Object.keys(parsedData).length;
    } else {
      type = "JSON Value";
    }
  } catch (e) {
    // Not JSON, treat as string
    type = "String";
    recordCount = 1;
  }

  return { type, recordCount, parsedData };
};

/**
 * Gets display name for storage keys
 */
const getStorageItemDisplayName = (key) => {
  const names = {
    "precious-metals-inventory": "Inventory Data",
    "spot-price-history": "Spot Price History",
    "api-config": "Metals API Configuration",
    "api-cache": "API Cache",
    spotPriceSilver: "Silver Spot Price",
    spotPriceGold: "Gold Spot Price",
    spotPricePlatinum: "Platinum Spot Price",
    spotPricePalladium: "Palladium Spot Price",
    theme: "Theme Setting",
  };

  return names[key] || key;
};

/**
 * Gets description for storage items
 */
const getStorageItemDescription = (key) => {
  const descriptions = {
    "precious-metals-inventory":
      "Your complete inventory of precious metals items with all details",
    "spot-price-history": "Historical spot price data from API providers and manual entries",
    "api-config": "Metals API provider configurations and usage statistics",
    "api-cache": "Cached spot price data to reduce API calls",
    spotPriceSilver: "Current spot price setting for silver",
    spotPriceGold: "Current spot price setting for gold",
    spotPricePlatinum: "Current spot price setting for platinum",
    spotPricePalladium: "Current spot price setting for palladium",
    theme: "User interface theme preference (dark/light/system)",
  };

  return descriptions[key] || "Application data stored in browser localStorage";
};

/**
 * Gets enhanced CSS styles for the storage report with theme support
 */
const getStorageReportCSS = () => {
  return `
    :root {
        --primary: #007bff;
        --success: #28a745;
        --warning: #ffc107;
        --danger: #dc3545;
        --info: #17a2b8;
        --light: #f8f9fa;
        --dark: #343a40;
        --bg-primary: #f9fafb;
        --bg-secondary: #f8f9fa;
        --text-primary: #333333;
        --text-secondary: #666666;
        --border: #dee2e6;
    }
    
    [data-theme="dark"],
    [data-theme="slate"] {
        --bg-primary: #1a1a1a;
        --bg-secondary: #2d2d2d;
        --text-primary: #f8fafc;
        --text-secondary: #cccccc;
        --border: #404040;
        --light: #2d2d2d;
        --dark: #f8f9fa;
    }
    
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }
    
    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        line-height: 1.6;
        color: var(--text-primary);
        background: var(--bg-secondary);
        transition: all 0.3s ease;
    }
    
    .storage-report-modal-content {
        width: 95vw;
        max-width: 1200px;
        height: 90vh;
        max-height: 900px;
    }
    
    .storage-report-controls {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    
    .theme-btn {
        background: none;
        border: 1px solid var(--border);
        padding: 0.5rem;
        border-radius: 0.25rem;
        cursor: pointer;
        font-size: 1rem;
        transition: all 0.2s ease;
    }
    
    .theme-btn:hover {
        background: var(--bg-secondary);
        transform: scale(1.05);
    }
    
    .storage-report-body {
        padding: 1rem;
        overflow-y: auto;
        height: calc(90vh - 80px);
    }
    
    .storage-report-header {
        margin-bottom: 1.5rem;
    }
    
    .storage-summary-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    
    .stat-card {
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        padding: 1rem;
        text-align: center;
        transition: all 0.2s ease;
    }
    
    .stat-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    
    .stat-label {
        display: block;
        font-size: 0.875rem;
        color: var(--text-secondary);
        margin-bottom: 0.25rem;
    }
    
    .stat-value {
        display: block;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--primary);
    }
    
    
    .storage-report-actions {
        display: flex;
        justify-content: center;
        gap: 1rem;
        margin-top: 2rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border);
    }
    
    .storage-detail-modal .modal-content {
        width: 90%;
        max-width: 800px;
        max-height: 80%;
    }
    
    .detail-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
        margin-bottom: 1.5rem;
    }
    
    .detail-stat {
        display: flex;
        justify-content: space-between;
        padding: 0.75rem;
        background: var(--bg-secondary);
        border-radius: 0.25rem;
    }
    
    .inventory-table-container {
        margin-top: 1rem;
    }
    
    .inventory-detail-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.875rem;
    }
    
    .inventory-detail-table th,
    .inventory-detail-table td {
        border: 1px solid var(--border);
        padding: 0.5rem;
        text-align: left;
    }
    
    .inventory-detail-table th {
        background: var(--bg-secondary);
        font-weight: 600;
        position: sticky;
        top: 0;
    }
    
    .data-preview {
        background: var(--bg-secondary);
        border: 1px solid var(--border);
        border-radius: 0.25rem;
        padding: 1rem;
        margin-top: 1rem;
    }
    
    .data-preview h4 {
        margin-bottom: 0.5rem;
        color: var(--text-primary);
    }
    
    .data-preview pre {
        font-size: 0.75rem;
        white-space: pre-wrap;
        word-wrap: break-word;
        max-height: 300px;
        overflow-y: auto;
        color: var(--text-primary);
    }
    
    /* Dark theme for storage modals */
    .storage-dark-theme {
        background: var(--bg-primary);
        color: var(--text-primary);
    }
    
    .storage-dark-theme .modal-content {
        background: var(--bg-primary);
        border: 1px solid var(--border);
    }
    
    .storage-dark-theme .modal-header {
        background: var(--dark);
        color: var(--text-primary);
        border-bottom: 1px solid var(--border);
    }
    
    .btn {
        padding: 0.5rem 1rem;
        border: 1px solid var(--border);
        border-radius: 0.25rem;
        background: var(--bg-primary);
        color: var(--text-primary);
        text-decoration: none;
        cursor: pointer;
        transition: all 0.2s ease;
        font-size: 0.875rem;
    }
    
    .btn:hover {
        background: var(--bg-secondary);
        transform: translateY(-1px);
    }
    
    .btn.premium {
        background: var(--primary);
        color: #f8fafc;
        border-color: var(--primary);
    }
    
    .btn.success {
        background: var(--success);
        color: #f8fafc;
        border-color: var(--success);
    }
    
    .btn.secondary {
        background: var(--text-secondary);
        color: #f8fafc;
        border-color: var(--text-secondary);
    }
    
    /* Enhanced responsive design */
    @media (max-width: 768px) {
        .storage-report-modal-content {
            width: 98vw;
            height: 95vh;
        }
        
        .storage-summary-stats {
            grid-template-columns: 1fr;
        }
        
        .storage-report-actions {
            flex-direction: column;
        }
        
        .detail-stats {
            grid-template-columns: 1fr;
        }
    }
    
    .report-container {
        max-width: 8.5in;
        margin: 0 auto;
        background: var(--bg-primary);
        padding: 1in;
        min-height: 11in;
    }
    
    .header-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
    }
    
    .header-controls {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .theme-toggle-btn,
    .close-btn {
        background: none;
        border: 1px solid var(--border);
        padding: 0.5rem;
        border-radius: 0.25rem;
        cursor: pointer;
        font-size: 1rem;
        transition: all 0.2s ease;
    }

    .theme-toggle-btn:hover,
    .close-btn:hover {
        background: var(--bg-secondary);
    }
    
    .storage-visualization {
        margin-bottom: 2rem;
    }
    
    .chart-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 2rem;
        align-items: stretch;
    }
    
    @media (max-width: 768px) {
        .chart-section {
            grid-template-columns: 1fr;
        }
    }
    
    .chart-container {
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        padding: 1rem;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
    }

    .chart-container canvas {
        max-width: 100%;
        height: 100% !important;
        max-height: 400px;
    }

    .chart-legend {
        background: var(--bg-primary);
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        padding: 1rem;
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .legend-items {
        overflow-y: auto;
        flex: 1;
        max-height: 400px;
    }
    
    .chart-legend h3 {
        margin-bottom: 1rem;
        color: var(--text-primary);
        font-size: 1rem;
    }
    
    .legend-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        margin-bottom: 0.5rem;
        border-radius: 0.25rem;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .legend-item:hover {
        background: var(--bg-secondary);
        transform: translateX(5px);
    }
    
    .legend-color {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        flex-shrink: 0;
    }
    
    .legend-label {
        flex: 1;
        font-weight: 500;
        color: var(--text-primary);
    }
    
    .legend-value {
        font-size: 0.875rem;
        color: var(--text-secondary);
        font-weight: 600;
    }
    
    .report-header {
        text-align: center;
        border-bottom: 3px solid var(--primary);
        padding-bottom: 1rem;
        margin-bottom: 2rem;
    }

    .report-header h1 {
        color: var(--primary);
        font-size: 2.5rem;
        margin-bottom: 0.5rem;
    }

    .report-meta {
        display: flex;
        justify-content: space-between;
        font-size: 0.9rem;
        color: var(--text-secondary);
    }
    
    .print-controls {
        text-align: center;
        margin-bottom: 2rem;
    }
    
    .print-btn {
        background: var(--primary);
        color: #f8fafc;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 0.5rem;
        font-size: 1rem;
        cursor: pointer;
        transition: background 0.2s;
    }

    .print-btn:hover {
        background: var(--primary-hover);
    }
    
    .storage-summary {
        margin-bottom: 2rem;
    }
    
    .storage-summary h2 {
        color: var(--text-primary);
        margin-bottom: 1rem;
        font-size: 1.5rem;
    }
    
    .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
    }
    
    .summary-item {
        background: var(--bg-primary);
        padding: 1rem;
        border-radius: 0.5rem;
        border: 1px solid var(--border);
        border-left: 4px solid var(--primary);
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .summary-label {
        font-weight: 600;
        color: var(--text-secondary);
    }

    .summary-value {
        font-weight: 700;
        color: var(--primary);
        font-size: 1.1rem;
    }
    
    .storage-breakdown h2 {
        color: var(--text-primary);
        margin-bottom: 1rem;
        font-size: 1.5rem;
    }
    
    .items-grid {
        display: grid;
        gap: 1rem;
    }
    
    .storage-item {
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        padding: 1rem;
        background: var(--bg-primary);
        transition: box-shadow 0.2s;
    }
    
    .storage-item:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
        cursor: pointer;
    }
    
    .item-header h3 {
        color: var(--primary);
        font-size: 1.2rem;
    }
    
    .item-meta {
        display: flex;
        gap: 1rem;
        align-items: center;
    }
    
    .item-size {
        font-weight: 600;
        color: var(--success);
    }
    
    .item-percentage {
        background: var(--primary);
        color: #f8fafc;
        padding: 0.25rem 0.5rem;
        border-radius: 1rem;
        font-size: 0.8rem;
    }
    
    .item-description {
        color: var(--text-secondary);
        margin-bottom: 0.5rem;
        font-size: 0.9rem;
    }
    
    .item-details {
        display: flex;
        gap: 1rem;
        margin-bottom: 0.5rem;
    }
    
    .detail-item {
        background: var(--bg-secondary);
        padding: 0.25rem 0.5rem;
        border-radius: 0.25rem;
        font-size: 0.8rem;
        color: var(--text-secondary);
    }
    
    .view-details-btn {
        background: var(--success);
        color: #f8fafc;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 0.25rem;
        cursor: pointer;
        font-size: 0.9rem;
        transition: filter 0.2s;
    }

    .view-details-btn:hover {
        filter: brightness(0.9);
    }
    
    .storage-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
    }
    
    .modal-content-large {
        background: #f9fafb;
        border-radius: 0.5rem;
        width: 90%;
        max-width: 800px;
        max-height: 80%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
    }
    
    .modal-header {
        background: var(--primary);
        color: #f8fafc;
        padding: 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    
    .modal-close {
        background: none;
        border: none;
        color: #f8fafc;
        font-size: 1.5rem;
        cursor: pointer;
        padding: 0;
        width: 2rem;
        height: 2rem;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .modal-body {
        padding: 1rem;
        overflow-y: auto;
        flex: 1;
    }
    
    .modal-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
    }
    
    .stat-item {
        background: var(--bg-secondary);
        padding: 0.75rem;
        border-radius: 0.25rem;
        display: flex;
        justify-content: space-between;
    }

    .stat-label {
        font-weight: 600;
        color: var(--text-secondary);
    }

    .stat-value {
        font-weight: 700;
        color: var(--primary);
    }
    
    .data-table-container {
        overflow-x: auto;
        margin-top: 1rem;
    }
    
    .data-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;
    }
    
    .data-table th,
    .data-table td {
        border: 1px solid var(--border);
        padding: 0.5rem;
        text-align: left;
    }

    .data-table th {
        background: var(--bg-secondary);
        font-weight: 600;
        position: sticky;
        top: 0;
    }
    
    .data-table td {
        max-width: 150px;
        word-wrap: break-word;
        overflow-wrap: break-word;
    }
    
    .data-preview {
        background: var(--bg-secondary);
        padding: 1rem;
        border-radius: 0.25rem;
        margin-top: 1rem;
    }
    
    .data-preview pre {
        font-size: 0.8rem;
        white-space: pre-wrap;
        word-wrap: break-word;
        max-height: 300px;
        overflow-y: auto;
    }
    
    .truncated {
        text-align: center;
        color: var(--text-secondary);
        font-style: italic;
        margin-top: 0.5rem;
    }

    .no-data {
        text-align: center;
        color: var(--text-secondary);
        font-style: italic;
        padding: 2rem;
    }

    .report-footer {
        margin-top: 3rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border);
        text-align: center;
        color: var(--text-secondary);
        font-size: 0.9rem;
    }
    
    @media print {
        body {
            background: #f9fafb;
        }
        
        .print-controls {
            display: none;
        }
        
        .storage-modal {
            display: none !important;
        }
        
        .view-details-btn {
            display: none;
        }
        
        .report-container {
            margin: 0;
            padding: 0.5in;
            max-width: none;
            min-height: auto;
        }
        
        .storage-item {
            break-inside: avoid;
            margin-bottom: 0.5rem;
        }
    }
    
    @media (max-width: 768px) {
        .report-container {
            padding: 1rem;
        }
        
        .summary-grid {
            grid-template-columns: 1fr;
        }
        
        .item-meta {
            flex-direction: column;
            align-items: flex-end;
            gap: 0.5rem;
        }
        
        .modal-content-large {
            width: 95%;
            max-height: 90%;
        }
    }
  `;
};

/**
 * Gets enhanced JavaScript for the storage report with theme and chart support
 */
const getStorageReportJS = () => {
  return `
    let currentChart = null;
    let currentReportData = null;

    function getChartColor(index) {
        const colors = [
            '#007bff', '#28a745', '#ffc107', '#dc3545', '#6f42c1',
            '#fd7e14', '#20c997', '#e83e8c', '#6c757d', '#17a2b8'
        ];
        return colors[index % colors.length];
    }

    function toggleTheme() {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', newTheme);
        
        // Recreate chart with new theme
        if (currentChart && currentReportData) {
            currentChart.destroy();
            initializeStorageChart(currentReportData);
        }
    }
    
    function initializeStorageChart(reportData) {
        currentReportData = reportData;
        const currentChartItems = reportData.items.slice(0, 5);
        const canvas = document.getElementById('storageChart');
        if (!canvas || typeof Chart === 'undefined') {
            console.warn('Chart.js not available or canvas not found');
            return;
        }

        const ctx = canvas.getContext('2d');
        const isDark = ['dark', 'slate'].includes(document.documentElement.getAttribute('data-theme'));

        const data = {
            labels: currentChartItems.map(item => getStorageItemDisplayName(item.key)),
            datasets: [{
                data: currentChartItems.map(item => item.size),
                backgroundColor: currentChartItems.map((_, index) => getChartColor(index)),
                borderColor: isDark ? '#404040' : '#f8fafc',
                borderWidth: 2,
                hoverBorderWidth: 3,
                hoverOffset: 10
            }]
        };
        
        const options = {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: isDark ? '#343a40' : '#f8fafc',
                    titleColor: isDark ? '#f8fafc' : '#000000',
                    bodyColor: isDark ? '#f8fafc' : '#000000',
                    borderColor: isDark ? '#6c757d' : '#dee2e6',
                    borderWidth: 1,
                    callbacks: {
                        label: (context) => {
                            const item = currentChartItems[context.dataIndex];
                            return [
                                \`\${context.label}: \${item.size.toFixed(2)} KB\`,
                                \`\${item.percentage.toFixed(1)}% of total\`,
                                \`\${item.recordCount} records\`
                            ];
                        }
                    }
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    showItemDetail(currentChartItems[index].key);
                }
            },
            animation: {
                animateRotate: true,
                animateScale: true
            }
        };
        
        if (currentChart) {
            currentChart.destroy();
        }
        
        currentChart = new Chart(ctx, {
            type: 'pie',
            data: data,
            options: options
        });
    }
    
    function showItemDetail(key) {
        const item = currentReportData.items.find(i => i.key === key);
        if (!item) return;
        
        const modal = document.getElementById('itemDetailModal');
        const title = document.getElementById('modalTitle');
        const content = document.getElementById('modalContent');
        
        if (!modal || !title || !content) return;
        
        title.textContent = \`\${getStorageItemDisplayName(item.key)} Details\`;
        content.innerHTML = generateDetailContent(item);
        
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }
    
    function closeItemDetail() {
        const modal = document.getElementById('itemDetailModal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    }
    
    function generateDetailContent(item) {
        let content = \`
            <div class="detail-stats">
                <div class="detail-stat">
                    <span class="stat-label">Size:</span>
                    <span class="stat-value">\${item.size.toFixed(2)} KB</span>
                </div>
                <div class="detail-stat">
                    <span class="stat-label">Type:</span>
                    <span class="stat-value">\${item.type}</span>
                </div>
                <div class="detail-stat">
                    <span class="stat-label">Records:</span>
                    <span class="stat-value">\${item.recordCount}</span>
                </div>
                <div class="detail-stat">
                    <span class="stat-label">Percentage:</span>
                    <span class="stat-value">\${item.percentage.toFixed(1)}%</span>
                </div>
            </div>
        \`;
        
        if (item.parsedData && Array.isArray(item.parsedData) && item.parsedData.length > 0) {
            if (item.key === 'precious-metals-inventory') {
                content += generateInventoryTable(item.parsedData);
            } else {
                content += \`<div class="data-preview"><h4>Sample Data:</h4><pre>\${JSON.stringify(item.parsedData.slice(0, 3), null, 2)}\${item.parsedData.length > 3 ? '\\n...and ' + (item.parsedData.length - 3) + ' more items' : ''}</pre></div>\`;
            }
        } else if (item.parsedData) {
            content += \`<div class="data-preview"><h4>Data:</h4><pre>\${JSON.stringify(item.parsedData, null, 2)}</pre></div>\`;
        } else {
            content += \`<div class="data-preview"><h4>Raw Data:</h4><pre>\${item.value}</pre></div>\`;
        }
        
        return content;
    }
    
    function generateInventoryTable(data) {
        if (!data || data.length === 0) return '<p>No inventory data found</p>';
        
        const headers = Object.keys(data[0]);
        const displayLimit = 20;
        
        return \`
            <div class="inventory-table-container">
                <h4>Inventory Data (showing first \${Math.min(displayLimit, data.length)} of \${data.length} items)</h4>
                <table class="inventory-detail-table">
                    <thead>
                        <tr>\${headers.map(h => \`<th>\${h}</th>\`).join('')}</tr>
                    </thead>
                    <tbody>
                        \${data.slice(0, displayLimit).map(record => 
                            \`<tr>\${headers.map(h => \`<td>\${String(record[h] || '')}</td>\`).join('')}</tr>\`
                        ).join('')}
                    </tbody>
                </table>
            </div>
        \`;
    }
    
    function getStorageItemDisplayName(key) {
        const names = {
            'precious-metals-inventory': 'Inventory Data',
            'spot-price-history': 'Spot Price History',
            'api-config': 'Metals API Configuration',
            'api-cache': 'API Cache',
            'spotPriceSilver': 'Silver Spot Price',
            'spotPriceGold': 'Gold Spot Price',
            'spotPricePlatinum': 'Platinum Spot Price',
            'spotPricePalladium': 'Palladium Spot Price',
            'theme': 'Theme Setting'
        };
        return names[key] || key;
    }
    
    // Close modal when clicking outside
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('storage-modal')) {
            e.target.style.display = 'none';
            document.body.style.overflow = '';
        }
    });
    
    // Close modal with ESC key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            const openModal = document.querySelector('.storage-modal[style*="flex"]');
            if (openModal) {
                openModal.style.display = 'none';
                document.body.style.overflow = '';
            }
        }
    });
    
    // Export functions to global scope
    window.toggleTheme = toggleTheme;
    window.showItemDetail = showItemDetail;
    window.closeItemDetail = closeItemDetail;
    window.initializeStorageChart = initializeStorageChart;
  `;
};

/**
 * Generates a comprehensive ZIP file with storage report and data
 */
const generateStorageReportTar = async () => {
  if (typeof JSZip === "undefined") {
    throw new Error("JSZip library not available for compressed reports");
  }

  const zip = new JSZip();
  const timestamp = new Date().toISOString().split("T")[0];

  // Add themed HTML report
  const htmlContent = generateStorageReportHTML();
  zip.file(`storage-report-${timestamp}.html`, htmlContent);

  // Add JSON data for each storage item
  const reportData = analyzeStorageData();
  const jsonReport = {
    metadata: {
      generated: new Date().toISOString(),
      version: APP_VERSION,
      totalSize: reportData.totalSize,
      itemCount: reportData.items.length,
      theme: document.documentElement.getAttribute("data-theme") || "light",
    },
    items: reportData.items.map((item) => ({
      key: item.key,
      displayName: getStorageItemDisplayName(item.key),
      description: getStorageItemDescription(item.key),
      size: item.size,
      percentage: item.percentage,
      type: item.type,
      recordCount: item.recordCount,
      data: item.parsedData || item.value,
    })),
  };

  zip.file(`storage-data-${timestamp}.json`, JSON.stringify(jsonReport, null, 2));

  // Add individual data files for large items
  for (const item of reportData.items) {
    if (item.size > 10 && item.parsedData) {
      // Items larger than 10KB
      const filename = `${item.key}-${timestamp}.json`;
      zip.file(filename, JSON.stringify(item.parsedData, null, 2));
    }
  }

  // Add README
  const readme = `StakTrakr Storage Report Archive
=================================

Generated: ${formatTimestamp(new Date())}
Version: ${APP_VERSION}
Total Storage: ${reportData.totalSize.toFixed(2)} KB
Items: ${reportData.items.length}

Files Included:
- storage-report-${timestamp}.html: Interactive HTML report
- storage-data-${timestamp}.json: Complete storage analysis
- Individual JSON files for large storage items

To view the report:
1. Open storage-report-${timestamp}.html in any web browser
2. Use the theme toggle to switch between light/dark modes
3. Click on chart segments or table items for detailed views

This archive contains a complete snapshot of your StakTrakr storage data.`;

  zip.file("README.txt", readme);

  // Generate the ZIP file
  const content = await zip.generateAsync({ type: "blob" });
  return content;
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
  window.openStorageReportPopup = openStorageReportPopup;
  window.generateStorageReport = generateStorageReport;
}
