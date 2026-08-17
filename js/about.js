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
    <li><strong>v3.36.11 &ndash; STRK-346: Housekeeping around the JM Bullion price feed</strong>: Purely under-the-hood maintenance with no visible change. When JM Bullion&rsquo;s pricing was rerouted through FindBullionPrices.com, the first attempt included an automatic tool for guessing each coin&rsquo;s source page &mdash; but real-world listings proved too ambiguous for it (a single coin sits beside its tube, monster box, and fractional versions), so those pages are now assigned by hand instead. This release removes the unused guessing tool and its leftover database field. Nothing about your holdings, prices, or the market comparison changes (STRK-346).</li>
    <li><strong>v3.36.10 &ndash; STRK-334: JM Bullion returns to the market comparison</strong>: JM Bullion&rsquo;s own site had started blocking automated price checks &mdash; an anti-bot challenge that kept slamming the door on the price poller&rsquo;s connection &mdash; so JM had quietly dropped out of the market price comparison. StakTrakr now sources JM Bullion&rsquo;s price from FindBullionPrices.com, a public dealer-price aggregator that publishes clean, machine-readable data and explicitly permits its use, and republishes it as an ordinary JM Bullion vendor price. In the same honest spirit, the market footer now carries a small FindBullionPrices.com attribution and thank-you link alongside the other sourcing disclosures. JM prices reappear as the new feed comes online (STRK-334).</li>
    <li><strong>v3.36.9 &ndash; STRK-345: The copper price archive gets its missing months</strong>: Copper&rsquo;s day-by-day price archive on the StakTrakr feed previously began the day copper went live &mdash; requests for any earlier day came back empty, even though the daily history existed in the app&rsquo;s bundled data. A new maintenance tool now fills the archive back to late March 2026, matching the other four metals, using the same daily history that powers the long-range charts. Each backfilled day is honest about its resolution: one daily price point, clearly marked as a single sample rather than invented hourly data. Future metals get this backfill as a standard rollout step so the gap never recurs (STRK-345).</li>
    <li><strong>v3.36.8 &ndash; STRK-344: Copper&rsquo;s 90-day chart backfills for existing users</strong>: The v3.36.7 fix gave copper its first week of hourly history, but on long-standing profiles the 90-day and 180-day views still ran out of road &mdash; the deep history was sitting in the app&rsquo;s bundled seed data the whole time, and the code that hands seed history to charts only ever ran for brand-new profiles. That hand-off is now made per metal: any metal missing older history &mdash; like copper on a profile from before it existed &mdash; receives its bundled history automatically on the next load, with your live recorded prices always taking precedence. Between the two fixes, enabling a new metal now fills in its complete chart history on every profile, new or old (STRK-344).</li>
    <li><strong>v3.36.7 &ndash; STRK-343: Copper charts now fill in for existing users</strong>: If you enabled copper on a profile you&rsquo;d been using for a while, its little price chart likely drew flat while gold and silver charted fine &mdash; the app decided it was &ldquo;already caught up&rdquo; by looking at your existing metals and never fetched copper&rsquo;s first week of hourly history. That check is now made per metal: any metal missing recent history triggers the full seven-day pull, so copper&rsquo;s chart fills itself in on the next price sync with no action needed. Fresh installs were never affected, and any future metal we add will inherit the fix automatically (STRK-343).</li>
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
