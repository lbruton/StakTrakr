// ABOUT TAB & ACKNOWLEDGMENT — Enhanced
// =============================================================================

const showAckModal = () => {
  const ackModal = document.getElementById("ackModal");
  if (ackModal && !localStorage.getItem(ACK_DISMISSED_KEY)) {
    populateAckModal();
    if (window.openModalById) openModalById('ackModal');
    else {
      ackModal.style.display = "flex";
      document.body.style.overflow = "hidden";
    }
  }
};

const hideAckModal = () => {
  const ackModal = document.getElementById("ackModal");
  if (ackModal) {
    if (window.closeModalById) closeModalById('ackModal');
    else {
      ackModal.style.display = "none";
      document.body.style.overflow = "";
    }
  }
};

const acceptAck = () => {
  localStorage.setItem(ACK_DISMISSED_KEY, "1");
  hideAckModal();
};

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

const populateAckModal = () => {
  const ackVersion = document.getElementById("ackVersion");
  const ackAppName = document.getElementById("ackAppName");
  if (ackVersion && typeof APP_VERSION !== "undefined") {
    ackVersion.textContent = `v${APP_VERSION}`;
  }
  if (ackAppName) {
    ackAppName.textContent = getBrandingName();
  }
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

const setupAckModalEvents = () => {
  const ackCloseBtn = document.getElementById("ackCloseBtn");
  const ackAcceptBtn = document.getElementById("ackAcceptBtn");
  const ackModal = document.getElementById("ackModal");

  if (ackCloseBtn) {
    ackCloseBtn.addEventListener("click", hideAckModal);
  }

  if (ackAcceptBtn) {
    ackAcceptBtn.addEventListener("click", acceptAck);
  }

  if (ackModal) {
    ackModal.addEventListener("click", (e) => {
      if (e.target === ackModal) {
        hideAckModal();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ackModal && ackModal.style.display === "flex") {
      hideAckModal();
    }
  });
};

const getEmbeddedWhatsNew = () => {
  return `
    <li><strong>v3.33.97 &ndash; STAK-532: Playwright-first testing</strong>: Playwright (@playwright/test) is now the primary local TDD layer. 33 tests across runbook sections 01-page-load and 02-crud. Run offline with <code>npm test</code>. Browserbase/Stagehand retained for live-site and cloud-only flows.</li>
    <li><strong>v3.33.96 &ndash; STAK-521: Quarantine unresolved slugs</strong>: Closed a latent three-plane asymmetry in the market filter &mdash; unresolved slugs are now quarantined symmetrically from matrix, cards, and ticker at the upstream chokepoint.</li>
    <li><strong>v3.33.95 &ndash; Cloud Sync Atomic Rollback</strong>: _applyAndFinalize() now rolls back atomically on settings write failure &mdash; inventory restored, lastPull not advanced, success toast suppressed (STAK-526)</li>
    <li><strong>v3.33.94 &ndash; Catalog API Key Sync Fix</strong>: Numista API key and PCGS bearer token now sync across devices. Catalog key conflicts appear in merge diff modal (STAK-533)</li>
    <li><strong>v3.33.93 &ndash; Shape-Aware Dimensions</strong>: Bars and ingots now show Length/Width instead of Diameter. Shape dropdown drives conditional fields. Numista API maps size by shape. Existing &ldquo;LxW&rdquo; diameter strings auto-migrate on edit (STAK-528)</li>
    <li><strong>v3.33.92 &ndash; V1 API Cleanup + Market Log Fix</strong>: Removed all dead v1 API code (~486 lines). Market log tab now shows dynamic vendor columns from the v2 manifest instead of blank hardcoded columns (STAK-509)</li>
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
  window.showAckModal = showAckModal;
  window.hideAckModal = hideAckModal;
  window.acceptAck = acceptAck;
  window.loadAnnouncements = loadAnnouncements;
  window.setupAckModalEvents = setupAckModalEvents;
  window.populateAboutTab = populateAboutTab;
  window.populateAckModal = populateAckModal;
  window.getEmbeddedWhatsNew = getEmbeddedWhatsNew;
  window.getEmbeddedRoadmap = getEmbeddedRoadmap;
  window.showFullChangelog = showFullChangelog;
  window.showWhatsNewPopup = showWhatsNewPopup;
  window.hideWhatsNewPopup = hideWhatsNewPopup;
  window.setupWhatsNewPopupEvents = setupWhatsNewPopupEvents;
}
