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
    <li><strong>v3.35.87 &ndash; STRK-314: Groundwork fix in the retail price collector</strong>: This one is under the hood and changes nothing you can see &mdash; the prices, vendors and freshness times in the Market view are identical before and after. When StakTrakr checks a dealer&rsquo;s page, each dealer carries its own settings for how long to wait for the page and how to reach it. A one-off instruction to override those settings for a single check was being quietly thrown away, because of the way the two sets of settings were combined. Nothing in the live price collector sends such an instruction today, so no price was ever wrong because of it &mdash; but it meant a whole layer of the collector was doing work that never took effect, and the next dealer added could have inherited a subtle misconfiguration with no warning. The settings are now combined in exactly one place, in a defined order, with a test pinning the result so that every existing dealer resolves precisely as it did before (STRK-314).</li>
    <li><strong>v3.35.86 &ndash; STRK-317: The market ticker shows full item names and proper vendor labels</strong>: Long item names in the scrolling best-price ticker were being cut off at 27 characters &mdash; &ldquo;Australian Silver Kookaburr&hellip;&rdquo; &mdash; because of a leftover length cap in the code, not the layout. The cap is gone, so names like a fractional Maple Leaf or a Goldback now read in full; the ticker measures its own width to set the scroll timing, so the speed you see is unchanged. The new MintBuilder vendor also displayed as lowercase &ldquo;mintbuilder&rdquo; in the ticker, the vendor price table, and the price detail window &mdash; it was missing from the short-label list those views share. It now reads <strong>MintBuilder</strong>, and any vendor added in the future will fall back to its proper feed name instead of a raw internal id (STRK-317).</li>
    <li><strong>v3.35.85 &ndash; STRK-318/319: Every weight unit displays correctly, and editing no longer changes it</strong>: A ¼ Goldback was showing as <strong>0.3 gb</strong> because the app rounded the denomination as though it were a measurement &mdash; an ⅛ note was even displayed as &ldquo;0.1 gb&rdquo;, a different note entirely. Denominations now render exactly (<strong>¼ gb</strong>, <strong>½ gb</strong>), and hovering a Goldback or Silverback finally shows the metal it actually holds: a ¼ Goldback carries <strong>0.00025 ozt</strong> of gold, plus the total for the lot if you hold several. Two editing bugs are fixed alongside. Opening any item lighter than a troy ounce and saving it silently converted the item to grams, throwing away the unit you picked &mdash; and <strong>Silverbacks were handled worse still</strong>: one opened reading &ldquo;1.00 oz&rdquo;, so saving turned a 1 Silverback (0.001 ozt of silver) into a full one-ounce silver item, overstating its melt value about a thousandfold, with no edit made. Small weights also no longer collapse to nothing: a 25 milligram Aurum note showed as &ldquo;0.03 g&rdquo;, or in troy ounces &ldquo;0.00 oz&rdquo; as if weightless, and now reads accurately. There is a new <strong>mg</strong> unit for Aurum and similar foil products, and clicking the Weight cell on a gram or kilogram item gives you a chip that matches the row instead of a long decimal. Ordinary weights, melt values, totals, sorting and CSV exports are all unchanged (STRK-318, STRK-319).</li>
    <li><strong>v3.35.84 &ndash; STRK-299/300: Constitutional silver leads with face value, and the silver figure is called ASW</strong>: The Weight column for constitutional silver rows (junk silver) now reads <strong>$6.00 fv</strong> &mdash; the total face value of the lot &mdash; rather than the derived silver ounces. Face value is how these coins are quoted, bought and talked about, and the table was the one place that did not lead with it; the card views and the item detail window already did. The silver content moves to the cell tooltip along with the worn/fresh basis, and it now has a proper name: <strong>ASW</strong>, or Actual Silver Weight, the term dealers use when quoting bags. The app used ASW internally but never showed it, and the three places displaying that number each called it something different. The detail window also stops labelling a dollar amount as a &ldquo;Weight&rdquo; &mdash; it says <strong>Face value</strong>, with the ASW on its own row below. Sorting and filtering are unchanged: the Weight column still ranks by silver content so these rows interleave correctly with your bullion, which is why $1.00 of war nickels (20 coins) sits above $1.20 of 90% dimes (12 coins). Melt values, weight totals and CSV exports are identical, and face value is never currency-converted (STRK-299, STRK-300).</li>
    <li><strong>v3.35.83 &ndash; STRK-316: Goldbacks sort and filter by the gold they actually hold</strong>: Sorting your inventory by Weight put Goldbacks in the wrong place entirely &mdash; a 5 Goldback ranked as though it weighed 5 troy ounces, landing between a 10 oz bar and a 2 oz round instead of down near the bottom where it belongs. A 5 Goldback holds 0.005 ozt of gold. The same mix-up meant clicking Weight on a 2 Goldback note also pulled in your 2.00 oz rounds, because both were filed under &ldquo;2&rdquo;. Goldbacks and Silverbacks now sort and filter on the metal they actually contain, so they rank below your bullion and a Weight click selects only that denomination &mdash; while the chip above the table still reads &ldquo;5 gb&rdquo; rather than a string of decimal places. Your melt values, weight totals and CSV exports are untouched; only the row order and what a Weight click selects have changed (STRK-316).</li>
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
