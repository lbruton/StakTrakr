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
    aboutAppName.textContent = getBrandingName();
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

const setupAboutCollapsibleCards = () => {
  const panel = safeGetElement('settingsPanel_about');
  if (!panel || panel._collapsibleBound) return;
  panel._collapsibleBound = true;
  panel.addEventListener('click', (e) => {
    const header = e.target.closest('.about-version-card-header');
    if (!header) return;
    const card = header.closest('.about-version-card');
    if (!card) return;
    const isExpanded = card.classList.toggle('expanded');
    header.setAttribute('aria-expanded', isExpanded);
  });
};

const showWhatsNewPopup = () => {
  const overlay = safeGetElement('whatsNewPopup');
  if (!overlay) return;
  // Populate version
  const versionEl = safeGetElement('whatsNewVersion');
  if (versionEl && typeof APP_VERSION !== 'undefined') {
    versionEl.textContent = `v${APP_VERSION} — Updated!`;
  }
  // Load announcements into the popup's versionChanges list
  if (typeof loadAnnouncements === 'function') loadAnnouncements();
  overlay.style.display = 'flex';
};

const hideWhatsNewPopup = () => {
  const overlay = safeGetElement('whatsNewPopup');
  if (overlay) overlay.style.display = 'none';
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
      // Open Settings to About tab
      if (typeof switchSettingsSection === 'function') switchSettingsSection('about');
      const settingsModal = safeGetElement('settingsModal');
      if (settingsModal) settingsModal.style.display = 'flex';
    });
  }

  // Click overlay background to dismiss
  const overlay = safeGetElement('whatsNewPopup');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hideWhatsNewPopup();
    });
  }
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
    <li><strong>v3.33.73 &ndash; Image URL Consistency</strong>: Stored URLs are now the single source of truth for images everywhere &mdash; view modal no longer fetches from Numista API independently. Fill Fields now overwrites existing image URLs when checkbox is checked (STAK-488, STAK-489)</li>
    <li><strong>v3.33.72 &ndash; Numista Metadata Fix</strong>: Numista metadata fields (KM Reference, country, etc.) can now be cleared and saved as empty &mdash; previously clearing a field would restore the old value on save (STAK-487)</li>
    <li><strong>v3.33.71 &ndash; Codebase Modularization</strong>: Shared chart utility library eliminates 11 duplicate Chart.js patterns. Inventory split: 4,504 &rarr; 1,744 lines across 4 focused modules (STAK-484)</li>
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
  window.setupAboutCollapsibleCards = setupAboutCollapsibleCards;
  window.showWhatsNewPopup = showWhatsNewPopup;
  window.hideWhatsNewPopup = hideWhatsNewPopup;
  window.setupWhatsNewPopupEvents = setupWhatsNewPopupEvents;
}
