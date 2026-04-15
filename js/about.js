// ABOUT TAB & ACKNOWLEDGMENT — Enhanced
// =============================================================================

const populateAboutTab = () => {
  const aboutVersion = safeGetElement("aboutVersion");
  const aboutCurrentVersion = safeGetElement("aboutCurrentVersion");
  const aboutAppName = safeGetElement("aboutAppName");

  if (aboutVersion && typeof APP_VERSION !== "undefined") {
    aboutVersion.textContent = `v${APP_VERSION}`;
  }

  if (aboutCurrentVersion && typeof APP_VERSION !== "undefined") {
    aboutCurrentVersion.textContent = `v${APP_VERSION}`;
  }

  if (aboutAppName) {
    const stakSpan = aboutAppName.querySelector('.stak');
    const trakrSpan = aboutAppName.querySelector('.trakr');
    if (stakSpan && trakrSpan) {
      const brand = getBrandingName();
      const split = BRANDING_DOMAIN_OPTIONS?.logoSplit?.[brand];
      stakSpan.textContent = Array.isArray(split) && split.length >= 2
        ? split[0].toUpperCase()
        : 'STAK';
      trakrSpan.textContent = Array.isArray(split) && split.length >= 2
        ? split[1].toUpperCase()
        : 'TRAKR';
    }
  }

  // Load announcements for latest changes and roadmap
  loadAnnouncements();
};

const loadAnnouncements = async () => {
  const whatsNewTargets = [
    document.getElementById("aboutChangelogLatest"),
    document.getElementById("versionChanges"),
  ].filter(Boolean);
  const roadmapTargets = [
    document.getElementById("aboutRoadmapList"),
    document.getElementById("versionRoadmapList"),
  ].filter(Boolean);

  if (!whatsNewTargets.length && !roadmapTargets.length) return;

  // STAK-513: Use embedded content directly. The external docs/announcements.md
  // was deleted but CDN ghost caches serve stale copies indefinitely.
  // Embedded content is the single source of truth, maintained by /release.
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  whatsNewTargets.forEach((el) => { el.innerHTML = getEmbeddedWhatsNew(); }); // developer-controlled HTML
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  roadmapTargets.forEach((el) => { el.innerHTML = getEmbeddedRoadmap(); }); // developer-controlled HTML
};

const showFullChangelog = () => {
  // Try to open changelog documentation
  window.open(
    "https://github.com/lbruton/StakTrakr/blob/main/CHANGELOG.md",
    "_blank",
    "noopener,noreferrer",
  );
};

const showWhatsNewPopup = async () => {
  const overlay = safeGetElement('whatsNewPopup');
  if (!overlay) return;
  // Populate version
  const versionEl = safeGetElement('whatsNewVersion');
  if (versionEl && typeof APP_VERSION !== 'undefined') {
    versionEl.textContent = `v${APP_VERSION} — Updated!`;
  }
  // STAK-500: Load announcements BEFORE showing popup to prevent content flash
  if (typeof loadAnnouncements === 'function') await loadAnnouncements();
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
};

const hideWhatsNewPopup = () => {
  const overlay = safeGetElement('whatsNewPopup');
  if (overlay) overlay.style.display = 'none';
  document.body.style.overflow = '';
  // Acknowledge version so popup doesn't show again
  if (typeof APP_VERSION !== 'undefined') {
    localStorage.setItem(VERSION_ACK_KEY, APP_VERSION);
  }
};

const setupWhatsNewPopupEvents = () => {
  const dismissBtn = safeGetElement('whatsNewDismissBtn');
  if (dismissBtn) dismissBtn.addEventListener('click', hideWhatsNewPopup);

  const changelogBtn = safeGetElement('whatsNewChangelogBtn');
  if (changelogBtn) {
    changelogBtn.addEventListener('click', () => {
      hideWhatsNewPopup();
      showFullChangelog();
    });
  }

  // Click overlay background to dismiss
  const overlay = safeGetElement('whatsNewPopup');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideWhatsNewPopup();
    });
  }

  // Escape key to dismiss
  document.addEventListener('keydown', (e) => {
    const popup = safeGetElement('whatsNewPopup');
    if (e.key === 'Escape' && popup && popup.style.display === 'flex') {
      hideWhatsNewPopup();
    }
  });
};

const getEmbeddedWhatsNew = () => {
  return `
    <li><strong>v3.34.02 &ndash; STAK-545: Market Button Triggers Refresh</strong>: The header Market button now triggers a market data refresh instead of opening Settings. A gear icon in the Market dashboard block provides direct access to Market settings.</li>
    <li><strong>v3.34.01 &ndash; STAK-445: Move FAQ below LOG</strong>: Reordered the Settings modal sidebar so Log appears immediately before FAQ. FAQ content, Activity Log content, and settings panel behavior remain unchanged.</li>
    <li><strong>v3.34.00 &ndash; STAK-444: Cloud Tab Settings Panel</strong>: Dropbox and Cloud Sync Beta cards moved from System tab to a dedicated Cloud tab. The Cloud nav button now opens cloud sync configuration instead of falling back to About.</li>
    <li><strong>v3.33.99 &ndash; STAK-538: Remove First-Run Modal</strong>: First-run acknowledgment modal removed &mdash; users now see the app immediately. The Info tab and What&rsquo;s New popup already cover disclaimers and version announcements.</li>
    <li><strong>v3.33.98 &ndash; STAK-529: Sort Direction Toggle</strong>: Asc/Desc toggle added to Settings &gt; Appearance next to Default Sort Column dropdown. Uses existing chip-sort-toggle pattern. Persists to localStorage via DEFAULT_SORT_DIR_KEY.</li>
    <li><strong>v3.33.97 &ndash; STAK-532: Playwright-first testing</strong>: Playwright (@playwright/test) is now the primary local TDD layer. 33 tests across runbook sections 01-page-load and 02-crud. Run offline with <code>npm test</code>. Browserbase/Stagehand retained for live-site and cloud-only flows.</li>
  `;
};

const getEmbeddedRoadmap = () => {
  return `
    <li><strong>Settings Redesign (STAK-436&ndash;447)</strong>: 12-issue suite covering Appearance, Filters, and API settings tabs</li>
    <li><strong>Market Page Phase 3</strong>: Inventory-to-market linking with auto-update retail prices</li>
    <li><strong>Cloud Backup Conflict Detection (STAK-150)</strong>: Smarter conflict resolution using item count direction, not just timestamps</li>
  `;
};

// Expose globally for access from other modules
if (typeof window !== "undefined") {
  window.loadAnnouncements = loadAnnouncements;
  window.populateAboutTab = populateAboutTab;
  window.getEmbeddedWhatsNew = getEmbeddedWhatsNew;
  window.getEmbeddedRoadmap = getEmbeddedRoadmap;
  window.showFullChangelog = showFullChangelog;
  window.showWhatsNewPopup = showWhatsNewPopup;
  window.hideWhatsNewPopup = hideWhatsNewPopup;
  window.setupWhatsNewPopupEvents = setupWhatsNewPopupEvents;
}
