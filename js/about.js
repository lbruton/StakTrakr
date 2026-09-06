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
    <li><strong>v3.36.22 &ndash; The tables now follow the chart</strong>: Narrowing the detail modal&rsquo;s chart to 30D, 90D, or 1Y used to leave the By Metal, By Purchase Location, and Acquisitions tables showing your whole history, so the chart and the tables disagreed. They now scope to the same window as the chart &mdash; only acquisitions dated inside it &mdash; and ALL brings everything back, undated items included. Each table&rsquo;s title says which window it is showing, and the Acquisitions caption tells you how many undated items a narrower range is hiding (STRK-365).</li>
    <li><strong>v3.36.21 &ndash; Chart markers you can actually hit</strong>: The purchase and disposition dots on the detail modal chart were tiny and, in the slate theme, the same color as the line they sat on. They are now larger with a wider hit zone and a background-colored halo that separates them from the line in every theme. Hovering a dot no longer hides the numbers, either &mdash; the tooltip lists the items as before and closes with that day&rsquo;s melt, cost basis, spot, and gain in one small line, and each purchase names its dealer in the same color the By Purchase Location breakdown uses (STRK-361).</li>
    <li><strong>v3.36.20 &ndash; Chart now shows where items left the pile</strong>: The detail modal chart previously only marked purchase days &mdash; if you sold, traded, lost, or gifted something, that day left no trace. Disposition days now render as hollow-ring markers next to the filled purchase dots, with their own show/hide toggle and a tooltip listing exactly what left and its melt-out value; purchase counts, pace, and invested figures are unaffected (STRK-363).</li>
    <li><strong>v3.36.19 &ndash; Cost basis and invested, untangled</strong>: A sharp-eyed beta question exposed a confusing pair &mdash; the modal&rsquo;s &ldquo;Purchase&rdquo; tile counts only what you still hold, while the chart&rsquo;s &ldquo;invested&rdquo; counts every dollar you ever put in, including items you later sold. The math was right; the labels weren&rsquo;t. The tile is now called <em>Cost Basis</em>, and invested shows its disposed portion &mdash; like <em>invested $11,972 (&minus; $328 disposed)</em> &mdash; so the two figures visibly reconcile (STRK-362).</li>
    <li><strong>v3.36.18 &ndash; The detail modal fits your screen</strong>: On desktop the portfolio modal always spilled past the bottom of the window, so it permanently carried a scrollbar. The By Metal and By Purchase Location breakdowns now show their top five entries with a &ldquo;+N more&rdquo; summary, rows sit a touch tighter, and the acquisitions list trimmed its minimum height &mdash; on a typical desktop window the whole modal now fits without scrolling (STRK-358).</li>
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
