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
    <li><strong>v3.35.81 &ndash; STRK-313: Cloud sync stops crying wolf about your catalog API key</strong>: If you sync between two devices or sites, the Review Sync Changes window kept insisting your Numista key had changed &mdash; &ldquo;configured &rarr; configured&rdquo; &mdash; when it never had. The culprit was an internal counter of catalog lookups stored next to the key, ticking up separately on each device. Sync now ignores those counters when deciding whether settings changed, so the popup only appears for a genuine key, token, or quota change, and switching between synced sessions is noticeably calmer (STRK-313).</li>
    <li><strong>v3.35.80 &ndash; The header is now a single clean row</strong>: Eight buttons have left the top of the screen. Every one of them duplicated something you could already reach elsewhere, and each has moved to where it belongs: <strong>Backup</strong> and <strong>Restore</strong> to <strong>Settings &rsaquo; System</strong>, which holds the full import and export surface, <strong>Cloud Sync</strong> to <strong>Settings &rsaquo; Cloud</strong>, <strong>Info</strong> to <strong>Settings &rsaquo; About</strong>, and <strong>Currency</strong> to <strong>Settings &rsaquo; Currency &rsaquo; Display currency</strong>. <strong>Trend</strong> and <strong>Spot Sync</strong> moved down onto the spot cards themselves &mdash; the period chip and the refresh icon on each card do the same job closer to the prices they affect. You will notice the currency one most, since it was the only button visible by default. Nothing you could do before has been taken away, and the header keeps <strong>Theme</strong> and <strong>Settings</strong> (STRK-283 to STRK-289, STRK-298).</li>
    <li><strong>v3.35.79 &ndash; The market Refresh button now actually refreshes</strong>: The <strong>&#8635; Refresh</strong> button above the market price table was quietly doing nothing most of the time &mdash; it only fetched new prices if your data was already over an hour old, and any sooner it greyed out, spun for five seconds, put the same prices back and gave no hint that it had skipped the fetch. It now pulls fresh vendor prices every time you click it, and stays in its working state until the fetch genuinely finishes. The <strong>Market</strong> button left the header along with it; its green, orange and red freshness dot moved down beside the market table&rsquo;s timestamp, and <strong>Settings &rsaquo; Market &rsaquo; Sync Now</strong> is untouched (STRK-290).</li>
    <li><strong>v3.35.71 &ndash; Metal ratios, with an app of their own</strong>: The gold-to-silver ratio and its three companions &mdash; gold to platinum, gold to palladium, and platinum to palladium &mdash; now have a proper home. The silver, platinum and palladium spot cards each carry a small ratio chip, and clicking one opens a full panel with the current reading set against its own history, so you can see whether today is high or low by that measure rather than guessing. The gold card carries a chip too, showing the daily Goldback G1 rate; that one stays a plain readout rather than a link, since it is a price and not a ratio. The same panel is also a standalone page at <strong>/ratios/</strong> that installs to your home screen as its own app with its own icon, separate from the main tracker &mdash; useful if ratios are what you check most often (STRK-268 to STRK-274).</li>
    <li><strong>v3.35.65 &ndash; Longer market history, and a batch of quiet fixes</strong>: The market detail view gained <strong>30, 60 and 90 day</strong> charts alongside the shorter ranges, so a vendor&rsquo;s pricing over a full quarter is visible in one place. Behind that, several fixes worth naming: dates entered on the add and edit forms could land a day early for anyone east of UTC, and no longer do; the app now falls back to its saved copy when the network answers badly rather than only when it is fully offline; vendor links refresh promptly instead of sitting stale for up to a day; and the price collector recovers on its own from a stuck run instead of going quiet until someone noticed (STRK-260, STRK-266, STRK-267, STRK-256, STRK-264, STRK-255).</li>
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
