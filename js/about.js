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
    <li><strong>v3.35.101 &ndash; STRK-338: The Market tab keeps its coin names as the tracked list grows</strong>: The Market tab remembers which coins it tracks &mdash; their proper names, weights and metals &mdash; so it can label everything correctly the moment you open it, before any prices have been fetched. Two parts of the app kept that list, and they disagreed about how to store it: one compressed it, the other did not know how to read compressed data. Below a certain size nothing is compressed, so the two agreed and everything worked; above it, the reader could no longer make sense of what had been saved and quietly threw the whole list away, falling back to a short built-in set of coins until the next successful sync finished. The saved list was already well over half that size limit and grows every time a coin is added, so this was on course to start happening by itself. Both sides now store and read it the same way (STRK-338).</li>
    <li><strong>v3.35.100 &ndash; STRK-329: The constitutional silver card can no longer be accidentally collapsed</strong>: When the add/edit form&rsquo;s optional sections became collapsible (v3.35.90), the constitutional silver card &mdash; the denomination and face-value entry that replaces the standard weight row for junk-silver items &mdash; was swept in by mistake. Unlike the seven genuinely optional sections, this card holds the only fields that can value a constitutional item, so collapsing it hid them entirely, and the collapsed state was remembered across sessions, making the form look broken on every subsequent add. The card still has the same header, icon and entry-mode chip toggle, but it is no longer a disclosure element and cannot be collapsed. Any remembered &ldquo;constitutional collapsed&rdquo; preference from before this fix is silently ignored (STRK-329).</li>
    <li><strong>v3.35.99 &ndash; A gap in the newest price feed is filled from the backup instead of being skipped</strong>: StakTrakr publishes to two independent price servers and uses whichever one published most recently &mdash; but a feed is only as complete as the run that built it. If a metal had no fresh reading at that moment, it was simply left out, and the app would keep showing your previous price for it, or fail the sync outright if it was the only metal you track, even though the other server had published a price for it minutes earlier. Any metal missing from the newest feed is now filled in from the next most recent one, which the app has already downloaded, so there is no extra waiting. Each price keeps its own timestamp: one taken from the older feed is recorded at the time it was actually published rather than passed off as newer, so your price history stays honest about how current each figure is. Dealer prices work the same way now &mdash; if a coin&rsquo;s price file is missing from the server the app picked, it asks the other one before giving up (STRK-332, STRK-333).</li>
    <li><strong>v3.35.98 &ndash; The app now always uses the freshest price server, and the footer badge says so</strong>: StakTrakr publishes its price feeds to two independent servers, and until now the app took the first one that answered acceptably &mdash; so when the primary lagged twenty minutes behind, you could be looking at its older prices while the backup sat there with data minutes old, and the footer badge either warned about staleness you did not really have or described a server you were not reading from. Both the spot sync and the market sync now check every server and use whichever one published most recently, and the footer badge reports that same freshest age with a status icon in front of it: &#9989; when both servers are current, &#9888;&#65039; when one is stale or unreachable. A hosting hiccup on one server now reads as a green, current timestamp with a warning icon &mdash; your data is fine, one feed is having a moment &mdash; and clicking the badge still opens the full health breakdown explaining exactly which server is behind. The existing safety checks are untouched: badly outdated cached copies are still rejected rather than displayed, and a server that stalls halfway through answering is cut off after five seconds instead of holding up the sync (STRK-331).</li>
    <li><strong>v3.35.95 &ndash; The app is now organised into tabs</strong>: Everything used to live on one long page that you scrolled through end to end &mdash; spot prices, then your totals, then the search bar, the inventory table, and the dealer price tables all stacked together. That page is now split across four tabs: <strong>Dashboard</strong> for spot prices, the Best Price ticker and your summary totals, <strong>Inventory</strong> for searching and your table, <strong>Market</strong> for dealer prices, and <strong>Collections</strong>, which is a placeholder for now. Nothing inside those areas changed &mdash; the same search, filters, chips, modals and columns behave exactly as before, they are simply grouped instead of stacked. Each tab has its own address, so <em>#/inventory</em> or <em>#/market</em> can be bookmarked or linked straight to the view you want, and on a phone the tabs move to a bar fixed at the bottom of the screen where your thumb already is. Settings &rsaquo; Appearance &rsaquo; Layout has gained a <strong>Tabs</strong> list for hiding whole tabs you never use: Market and Collections are yours to switch off, while Dashboard and Inventory stay locked on &mdash; Inventory holds the only button that adds or edits an item, and everything on the Dashboard is worked out from what you enter there, so hiding it left you looking at a page of zeroes with no way to add anything. The old <strong>Visible sections</strong> list is now <strong>Dashboard sections</strong> and orders just that tab. Two fixes came with it: the Best Price ticker no longer reveals itself frozen with a scrollbar when you reload on another tab and click back, and the warning shown when your inventory cannot be loaded now sits above the tabs so it stays visible whichever one you are on (STRK-282, STRK-326, STRK-327, STRK-328).</li>
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
