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
    <li><strong>v3.36.1 &ndash; STRK-304: Copper&rsquo;s price history now reaches back to 1968</strong>: When copper collection began in the previous release, its chart would have started in mid-2013 &mdash; the earliest date the price service knows copper &mdash; while gold and silver reach back to 1968. This release closes that gap the same way the deep gold and silver history was built: from an institutional benchmark, in this case the London Metal Exchange copper price as published monthly by the World Bank. The early history is stored at its true monthly resolution rather than being stretched into fake daily readings, and the two data sources were measured against each other across twelve years of overlap and aligned onto one price basis, so the chart will not show an artificial jump where they meet in 2013. Nothing is visible in the app yet &mdash; this is the runway so that when copper charts arrive, they are sixty years deep on day one (STRK-304).</li>
    <li><strong>v3.36.0 &ndash; STRK-303: StakTrakr has started recording copper prices</strong>: Copper is on its way in as a tracked metal, and this release is the groundwork: the price service now collects the copper spot price every fifteen minutes alongside gold, silver, platinum and palladium, and publishes it. <strong>Nothing in the app changes yet</strong> &mdash; there is no copper spot card, no copper column in your totals, and copper cannot be chosen when you add an item. That comes in a later release. The reason for starting now is history: a price chart is only as deep as the data behind it, so the sooner collection begins, the more there is to show when copper does appear. Copper also turned out to be the first metal worth less than a dollar an ounce, which broke two long-standing assumptions in the price handling &mdash; one that decided how to read a price by how large the number was, and one that treated anything under five dollars as obviously wrong. Both were corrected, and prices under a dollar are now recorded to four decimal places rather than two, so a forty-cent metal is not rounded into inaccuracy. Existing metals are unaffected and their recorded prices are unchanged (STRK-303).</li>
    <li><strong>v3.35.101 &ndash; STRK-338: The Market tab keeps its coin names as the tracked list grows</strong>: The Market tab remembers which coins it tracks &mdash; their proper names, weights and metals &mdash; so it can label everything correctly the moment you open it, before any prices have been fetched. Two parts of the app kept that list, and they disagreed about how to store it: one compressed it, the other did not know how to read compressed data. Below a certain size nothing is compressed, so the two agreed and everything worked; above it, the reader could no longer make sense of what had been saved and quietly threw the whole list away, falling back to a short built-in set of coins until the next successful sync finished. The saved list was already well over half that size limit and grows every time a coin is added, so this was on course to start happening by itself. Both sides now store and read it the same way (STRK-338).</li>
    <li><strong>v3.35.100 &ndash; STRK-329: The constitutional silver card can no longer be accidentally collapsed</strong>: When the add/edit form&rsquo;s optional sections became collapsible (v3.35.90), the constitutional silver card &mdash; the denomination and face-value entry that replaces the standard weight row for junk-silver items &mdash; was swept in by mistake. Unlike the seven genuinely optional sections, this card holds the only fields that can value a constitutional item, so collapsing it hid them entirely, and the collapsed state was remembered across sessions, making the form look broken on every subsequent add. The card still has the same header, icon and entry-mode chip toggle, but it is no longer a disclosure element and cannot be collapsed. Any remembered &ldquo;constitutional collapsed&rdquo; preference from before this fix is silently ignored (STRK-329).</li>
    <li><strong>v3.35.99 &ndash; A gap in the newest price feed is filled from the backup instead of being skipped</strong>: StakTrakr publishes to two independent price servers and uses whichever one published most recently &mdash; but a feed is only as complete as the run that built it. If a metal had no fresh reading at that moment, it was simply left out, and the app would keep showing your previous price for it, or fail the sync outright if it was the only metal you track, even though the other server had published a price for it minutes earlier. Any metal missing from the newest feed is now filled in from the next most recent one, which the app has already downloaded, so there is no extra waiting. Each price keeps its own timestamp: one taken from the older feed is recorded at the time it was actually published rather than passed off as newer, so your price history stays honest about how current each figure is. Dealer prices work the same way now &mdash; if a coin&rsquo;s price file is missing from the server the app picked, it asks the other one before giving up (STRK-332, STRK-333).</li>
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
