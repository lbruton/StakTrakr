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

  try {
    const res = await fetch("docs/announcements.md");
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const text = await res.text();

    const section = (name) => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match ## heading and capture everything until the next ## (same level) or EOF
      // Use (?=\n## [^#]) to stop at next h2 but NOT at ### subsections
      const regex = new RegExp(`##\\s+${escaped}\\n([\\s\\S]*?)(?=\\n## [^#]|$)`, "i");
      const match = text.match(regex);
      return match ? match[1] : "";
    };

    // STAK-490: announcements.md is developer-controlled content — do not sanitizeHtml
    // (double-encodes HTML entities like &mdash; &rarr; &amp;)
    const parseList = (content) =>
      content
        .split("\n")
        .filter((l) => l.trim().startsWith("-"))
        .map((l) => l.replace(/^[-*]\s*/, "")
          .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"));

    const whatsNewItems = parseList(section("What's New"));
    if (whatsNewTargets.length) {
      // Filter to current version branch (e.g., 3.31.x) before slicing
      const versionBranch = typeof APP_VERSION !== 'undefined'
        ? APP_VERSION.split('.').slice(0, 2).join('.')
        : null;
      const filteredWhatsNew = versionBranch
        ? whatsNewItems.filter(i => i.includes(`v${versionBranch}.`) || i.includes(`(v${versionBranch}`))
        : whatsNewItems;
      const displayItems = filteredWhatsNew.length > 0 ? filteredWhatsNew : whatsNewItems;

      const html =
        displayItems.length > 0
          ? displayItems
              .slice(0, 3)
              .map((i) => `<li>${i}</li>`)
              .join("")
          : "<li>No recent announcements</li>";
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      whatsNewTargets.forEach((el) => (el.innerHTML = html));
    }

    const roadmapItems = parseList(section("Development Roadmap"));
    if (roadmapTargets.length) {
      const html =
        roadmapItems.length > 0
          ? roadmapItems
              .slice(0, 3)
              .map((i) => `<li>${i}</li>`)
              .join("")
          : "<li>Roadmap information unavailable</li>";
      // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
      roadmapTargets.forEach((el) => (el.innerHTML = html));
    }
  } catch (e) {
    console.warn("Could not load announcements, using embedded data:", e);

    // Fallback to embedded announcements data
    const embeddedWhatsNew = getEmbeddedWhatsNew();
    const embeddedRoadmap = getEmbeddedRoadmap();

    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    whatsNewTargets.forEach((el) => (el.innerHTML = embeddedWhatsNew));
    // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml, javascript.browser.security.insecure-document-method.insecure-document-method
    roadmapTargets.forEach((el) => (el.innerHTML = embeddedRoadmap));
  }
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
    <li><strong>v3.33.86 &ndash; What&rsquo;s New Modal Fix</strong>: What&rsquo;s New popup no longer flashes old content before showing current announcements on page load (STAK-500)</li>
    <li><strong>v3.33.84 &ndash; Market Price Fixes</strong>: JM Bullion now uses column-aware eCheck/Wire parser first, preventing inflated Card/PayPal prices. Goldback-g1 baseline no longer appears as a ghost card in market view (STAK-498)</li>
    <li><strong>v3.33.83 &ndash; Intraday Chart Fix</strong>: Charts now show exactly 24 hourly data points instead of multi-day spans with excessive dotted lines. Dotted lines only for 2+ hour gaps. OOS vendors excluded from chart datasets (STAK-498)</li>
    <li><strong>v3.33.82 &ndash; Grid View Cleanup</strong>: Removed ~260 lines of dead grid/card view code from retail.js, eliminated the MARKET_LIST_VIEW feature flag, and cleaned up orphaned CSS. List view is now unconditional (STAK-473)</li>
    <li><strong>v3.33.81 &ndash; Price Bounds Guard</strong>: Retail poller now rejects implausible vendor prices at write time &mdash; prices &gt;+50% or &lt;-30% of spot-based melt value are flagged as failed. Per-vendor exemptions for legitimate outliers (STAK-496)</li>
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
