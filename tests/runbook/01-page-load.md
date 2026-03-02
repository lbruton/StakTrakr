# Section 01 — Page Load

Tests for initial page load, version display, spot price rendering, and startup modals. These tests validate the fundamental "cold open" experience: that the application renders correctly at the PR preview URL, displays the expected version, shows the What's New modal on first visit (and suppresses it on subsequent visits within the same session), renders all four metal spot price cards with live values, and accurately reflects the seed inventory count.

Run these tests first in any full-suite session. Tests 1.2 through 1.5 are sequentially dependent within this section — 1.4 must complete before 1.5 can be meaningful.

---

### Test 1.1 — Page loads at preview URL
_Added: v3.33.25 (STAK-396)_
**Preconditions:** BASE_URL is the PR preview URL obtained from 00-setup. Session is active.
**Steps:**
- act: "navigate to BASE_URL/index.html"
- extract: "the page title in the browser tab" → expect: "StakTrakr"
- extract: "the tagline text 'Your Stack. Your Way.' is visible on the page" → expect: true
- screenshot: "01-page-load-baseline"
**Pass criteria:** The page loads without error, the browser tab title reads "StakTrakr", and the tagline "Your Stack. Your Way." is visible in the UI.
**Tags:** page-load, load
**Section:** 01-page-load

---

### Test 1.2 — What's New popup appears on first load
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Fresh session with no prior acknowledgment stored. This is the first navigation to BASE_URL in this Browserbase session (localStorage has not been seeded with an acknowledgment flag).
**Steps:**
- extract: "a modal or popup dialog is visible on the page" → expect: true
- screenshot: "01-page-load-whats-new"
**Pass criteria:** A What's New or acknowledgment modal is visible immediately after the first page load without any user interaction.
**Tags:** page-load, modal, whats-new
**Section:** 01-page-load

---

### Test 1.3 — What's New contains latest patch notes
_Added: v3.33.25 (STAK-396)_
**Preconditions:** The What's New modal is open (from 1.2).
**Steps:**
- extract: "the text content of the visible modal includes a version number or patch note description" → expect: non-empty version string
**Pass criteria:** The modal body contains visible version text or patch note content — it is not blank and not showing a loading spinner.
**Tags:** page-load, modal, whats-new
**Section:** 01-page-load

---

### Test 1.4 — Clicking Accept closes the modal
_Added: v3.33.25 (STAK-396)_
**Preconditions:** The What's New modal is open (from 1.2 and 1.3).
**Steps:**
- act: "click the I Understand or Accept button in the modal"
- extract: "the acknowledgment modal is visible" → expect: false
**Pass criteria:** After clicking the acceptance button, the modal is dismissed and the main inventory view is fully visible.
**Tags:** page-load, modal, whats-new
**Section:** 01-page-load

---

### Test 1.5 — What's New does NOT appear on refresh (session-scoped)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** The What's New modal was dismissed in 1.4. The acknowledgment flag is now stored in localStorage for this session.
**Steps:**
- act: "navigate to BASE_URL/index.html"
- extract: "the acknowledgment or What's New modal is visible" → expect: false
**Pass criteria:** After navigating back to the page URL, no What's New or acknowledgment modal appears. The page loads directly to the inventory view.
**Tags:** page-load, modal, session
**Section:** 01-page-load

---

### Test 1.6 — Header displays all menu items in correct order
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Modal dismissed (from 1.4). Page is fully loaded.
**Steps:**
- extract: "the header navigation contains visible icon buttons or menu items including Inventory, Market, Log, and Settings" → expect: at least 3 navigation elements visible in the header
**Pass criteria:** The header renders with at minimum three navigation elements (Inventory view toggle, Market icon, Log icon, and/or Settings icon) all visible without overlap.
**Tags:** page-load, header, navigation
**Section:** 01-page-load

---

### Test 1.7 — Version number in header matches deployed patch version
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Modal dismissed. Page is fully loaded.
**Steps:**
- extract: "the version text displayed in the header or page footer" → expect: a non-empty version string matching the format X.X.X (three dot-separated integers)
**Pass criteria:** A version string in the format X.X.X is visible somewhere in the header or footer and is not blank, "undefined", or "0.0.0".
**Tags:** page-load, version, header
**Section:** 01-page-load

---

### Test 1.8 — Spot price cards render (all 4 metals, non-zero values)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Modal dismissed. Page fully loaded. Network connection active so spot API can respond.
**Steps:**
- extract: "the Gold spot price card is visible with a dollar amount" → expect: a non-zero dollar value displayed
- extract: "the Silver spot price card is visible with a dollar amount" → expect: a non-zero dollar value displayed
- extract: "the Platinum spot price card is visible with a dollar amount" → expect: a non-zero dollar value displayed
- extract: "the Palladium spot price card is visible with a dollar amount" → expect: a non-zero dollar value displayed
- screenshot: "01-page-load-spot-cards"
**Pass criteria:** All four metal spot price cards (Gold, Silver, Platinum, Palladium) are visible and each shows a non-zero dollar amount. No card shows "$0.00", "N/A", or a loading placeholder.
**Tags:** page-load, spot-prices, metals
**Section:** 01-page-load

---

### Test 1.9 — Spot API backfills missing spot prices for last 30 days on load
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Modal dismissed. Page fully loaded. This test validates that the backfill routine ran on startup.
**Steps:**
- extract: "spot price values displayed on the page are non-zero and not showing 'N/A' or blank placeholders" → expect: non-zero spot values displayed for all visible metals
**Pass criteria:** Spot price values are populated and non-zero across all displayed metals, indicating the backfill routine successfully fetched or restored historical spot data for the past 30 days.
**Tags:** page-load, spot-prices, api, backfill
**Section:** 01-page-load

---

### Test 1.10 — Market API backfills daily market prices for last 30 days on load
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Modal dismissed. Page fully loaded. Network connection active.
**Steps:**
- extract: "any market data error message or alert is visible on the main page" → expect: no error message visible
**Pass criteria:** No market data error banner, toast, or alert is visible after the page finishes loading, indicating the market API backfill completed without error.
**Tags:** page-load, market, api, backfill
**Section:** 01-page-load

---

### Test 1.11 — Seed inventory count is accurate on first load
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Storage has not been cleared. The preview URL is pre-seeded with the standard 8-item seed inventory loaded into localStorage.
**Steps:**
- extract: "the item count label, badge, or counter displayed on the page" → expect: 8 items
**Pass criteria:** The inventory count shown in the UI (badge, header label, or filter chip) reads 8, matching the seed data that ships with the application.
**Tags:** page-load, inventory, count
**Section:** 01-page-load
