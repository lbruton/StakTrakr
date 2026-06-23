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
    const stakSpan = aboutAppName.querySelector(".stak");
    const trakrSpan = aboutAppName.querySelector(".trakr");
    if (stakSpan && trakrSpan) {
      const brand = getBrandingName();
      const split = BRANDING_DOMAIN_OPTIONS?.logoSplit?.[brand];
      stakSpan.textContent =
        Array.isArray(split) && split.length >= 2 ? split[0].toUpperCase() : "STAK";
      trakrSpan.textContent =
        Array.isArray(split) && split.length >= 2 ? split[1].toUpperCase() : "TRAKR";
    }
  }

  // Load announcements for latest changes
  loadAnnouncements();
};

const loadAnnouncements = () => {
  const whatsNewTargets = [document.getElementById("aboutChangelogLatest")].filter(Boolean);

  if (!whatsNewTargets.length) return;

  // STAK-513: Use embedded content directly. The external docs/announcements.md
  // was deleted but CDN ghost caches serve stale copies indefinitely.
  // Embedded content is the single source of truth, maintained by /release.
  // nosemgrep: javascript.browser.security.insecure-innerhtml.insecure-innerhtml
  whatsNewTargets.forEach((el) => {
    el.innerHTML = getEmbeddedWhatsNew();
  }); // developer-controlled HTML
};

const showFullChangelog = () => {
  // Try to open changelog documentation
  window.open(
    "https://github.com/lbruton/StakTrakr/blob/main/CHANGELOG.md",
    "_blank",
    "noopener,noreferrer"
  );
};

// STAK-547: Acknowledge version so toast doesn't show again
const acknowledgeVersion = () => {
  if (typeof APP_VERSION !== "undefined") {
    localStorage.setItem(VERSION_ACK_KEY, APP_VERSION);
  }
};

// STAK-547: Show latest changelog entry as a bottom-right toast card (replaces modal)
const showWhatsNewPopup = () => {
  // Prevent duplicate cards if called more than once
  if (document.querySelector(".whats-new-toast-card")) return;

  // Parse first entry from embedded list (developer-controlled HTML)
  const doc = new DOMParser().parseFromString(`<ul>${getEmbeddedWhatsNew()}</ul>`, "text/html");
  const firstLi = doc.querySelector("li");
  if (!firstLi) {
    acknowledgeVersion();
    return;
  }

  // Build card with DOM methods — no innerHTML on appended elements
  const label = document.createElement("span");
  label.className = "wntc-label";
  label.textContent = "What\u2019s New";

  const versionSpan = document.createElement("span");
  versionSpan.className = "wntc-version";
  versionSpan.textContent = typeof APP_VERSION !== "undefined" ? `v${APP_VERSION}` : "";

  const closeBtn = document.createElement("button");
  closeBtn.className = "wntc-close";
  closeBtn.setAttribute("type", "button");
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.textContent = "\u00D7";

  const header = document.createElement("div");
  header.className = "wntc-header";
  header.appendChild(label);
  header.appendChild(versionSpan);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.className = "wntc-body";
  // Clone parsed li child nodes (developer-controlled, not user input)
  Array.from(firstLi.childNodes).forEach((node) => body.appendChild(node.cloneNode(true)));

  const card = document.createElement("div");
  card.className = "whats-new-toast-card";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  card.appendChild(header);
  card.appendChild(body);
  document.body.appendChild(card);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    card.classList.add("fade-out");
    card.addEventListener("animationend", () => card.remove(), { once: true });
    acknowledgeVersion();
  };

  card.addEventListener("click", dismiss);
  const timer = setTimeout(dismiss, 4000);
};

// Kept for backward compat — removes toast card if present and acknowledges version
const hideWhatsNewPopup = () => {
  const card = document.querySelector(".whats-new-toast-card");
  if (card) card.remove();
  acknowledgeVersion();
};

// setupWhatsNewPopupEvents kept as no-op — modal removed (STAK-547)
const setupWhatsNewPopupEvents = () => {};

const getEmbeddedWhatsNew = () => {
  return `
    <li><strong>v3.35.51 &ndash; STRK-238: Bulk-convert holdings to constitutional silver</strong>: The Bulk Edit tool can now turn a batch of items into 90% / 40% / 35% junk silver &mdash; enable Type, choose Constitutional, pick a denomination, and apply, and each item gets its correct derived silver content instead of showing zero. Each item keeps its existing quantity as the coin count. Previously bulk-converting to Constitutional left items with no denomination and a $0 melt value (STRK-238).</li>
    <li><strong>v3.35.50 &ndash; STRK-235: Track constitutional / junk silver by face value or denomination</strong>: StakTrakr now has a dedicated Constitutional item type for U.S. 90% / 40% / 35% junk silver &mdash; add a roll by picking a denomination (dime, quarter, half, silver dollar, 40% half, Ike dollar, war nickel) and a coin count, or enter a bag by its total face value, and the app derives the actual silver content and melt value for you. A new Settings &rarr; Currency control values your junk silver on the worn standard (default) or fresh mint weight across your whole collection. Silver dollars are valued at their correct higher silver content, and the melt math never double-counts coin purity (STRK-235).</li>
    <li><strong>v3.35.49 &ndash; STRK-234: Reliable cloud sync when two devices sync at once</strong>: Fixes a race that could pop up the Restore Preview with "Could not decrypt vault for preview" when two browsers or devices synced to the same cloud at the same time. Overlapping syncs are now serialized and the no-change "silent" pull is hardened, so concurrent syncs converge cleanly instead of erroring. Everyday single-device sync behaves exactly as before (STRK-234).</li>
    <li><strong>v3.35.48 &ndash; STRK-232: Keyboard-friendly catalog &amp; grade chips</strong>: The N#, PCGS#, and grade reference chips in the inventory table can now be activated with Enter or Space when focused, so you can open a coin's Numista or PCGS page (or its grade lookup) without reaching for the mouse. Pressing Space on a chip no longer scrolls the page. Mouse clicks behave exactly as before &mdash; this only adds keyboard access (STRK-232).</li>
    <li><strong>v3.35.47 &ndash; STRK-220: CSV imports keep tag edits on existing items</strong>: When you merge a CSV that adds or removes tags on items already in your collection, those tag changes now stick instead of being silently skipped. Previously only brand-new rows had their Tags and removedTags columns applied &mdash; existing items, and rows that only changed tags, were dropped during a merge import. Override and full-restore imports were unaffected and behave exactly as before (STRK-220).</li>
  `;
};

// Expose globally for access from other modules
if (typeof window !== "undefined") {
  window.loadAnnouncements = loadAnnouncements;
  window.populateAboutTab = populateAboutTab;
  window.getEmbeddedWhatsNew = getEmbeddedWhatsNew;
  window.showFullChangelog = showFullChangelog;
  window.showWhatsNewPopup = showWhatsNewPopup;
  window.hideWhatsNewPopup = hideWhatsNewPopup;
  window.acknowledgeVersion = acknowledgeVersion;
  window.setupWhatsNewPopupEvents = setupWhatsNewPopupEvents;
}
