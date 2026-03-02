# Section 08 — Spot Prices

Tests for spot price display, freshness, Goldback pricing, backfill behavior, and stale indicators. The spot price pipeline fetches hourly data from the StakTrakrApi Fly.io container and exposes it via `api.staktrakr.com/data/hourly/`. On page load, the frontend backfills the last 30 days of spot history and renders four metal cards (Gold, Silver, Platinum, Palladium) plus a Goldback value. These tests verify that all cards render with live data, that freshness thresholds are met, that melt values on inventory cards reflect current spot prices, and that stale indicators fire correctly when data is overdue.

Test 8.6 is a controlled/manual test only — it cannot be automated without waiting 75+ minutes for real data aging. It is documented here for completeness and manual verification.

---

### Test 8.1 — All 4 metals showing (Gold, Silver, Platinum, Palladium)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Page is fully loaded. Modal dismissed (from 00-setup or Section 01). Network is active so the spot API can respond.
**Steps:**
- extract: "all four spot price cards for Gold, Silver, Platinum, and Palladium are visible on the page with dollar amounts" → expect: 4 cards visible, all displaying non-zero dollar values
**Pass criteria:** All four metal spot price cards are rendered and each shows a non-zero dollar amount. No card is missing, blank, showing "$0.00", or showing "N/A".
**Tags:** spot-prices, metals, display
**Section:** 08-spot-prices

---

### Test 8.2 — Values within 75-minute stale threshold
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Page fully loaded with spot data fetched. Spot poller on Fly.io is assumed healthy (data updated within the last 75 minutes).
**Steps:**
- extract: "a stale warning, stale badge, or overdue indicator is visible on any of the spot price cards" → expect: no stale indicator visible
**Pass criteria:** None of the four spot price cards display a stale warning or overdue indicator, confirming that the most recent spot data is within the 75-minute freshness threshold.
**Tags:** spot-prices, freshness, stale
**Section:** 08-spot-prices

---

### Test 8.3 — Goldback card visible with valid price
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Page fully loaded. Goldback poller on Fly.io is assumed healthy (scraped within the last 25 hours).
**Steps:**
- extract: "the Goldback price card or Goldback price value is visible on the page" → expect: a non-zero dollar value shown for Goldback
**Pass criteria:** A Goldback price display (card, label, or inline value) is visible and shows a dollar amount greater than zero. It is not blank, "N/A", or "$0.00".
**Tags:** spot-prices, goldback
**Section:** 08-spot-prices

---

### Test 8.4 — Spot price backfill populates last 30 days on fresh load
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Page has just loaded (or was reloaded in this session). The backfill routine runs automatically on startup to populate historical spot data.
**Steps:**
- extract: "spot price values are populated and non-zero across all visible metal cards, indicating the backfill routine completed successfully" → expect: spot values greater than 0 for all metals
**Pass criteria:** All spot price cards show non-zero dollar values after page load, confirming the 30-day backfill ran and populated historical data without error. No card shows a loading state or zero value.
**Tags:** spot-prices, backfill, history
**Section:** 08-spot-prices

---

### Test 8.5 — Melt values on inventory cards update when new spot price loads
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Page fully loaded with spot prices rendered. Inventory contains at least one item with a weight and metal type set (seed data satisfies this).
**Steps:**
- extract: "melt value dollar amounts are visible on at least one inventory card in the main view" → expect: at least one non-zero melt value displayed
**Pass criteria:** At least one inventory card shows a melt value (dollar amount) that is non-zero, confirming that the spot price data was applied to the inventory calculation. The melt value field is not blank or "$0.00" for items with a valid weight and metal type.
**Tags:** spot-prices, melt-value, inventory
**Section:** 08-spot-prices

---

### Test 8.6 — Stale indicator appears when spot data is overdue
_Added: v3.33.25 (STAK-396)_
**Preconditions:** MANUAL/CONTROLLED TEST — requires triggering data age greater than 75 minutes. This test cannot be automated without waiting for the spot poller to miss multiple scheduled runs. Cannot be verified in a standard automated Browserbase session. To execute manually: wait for spot data to exceed the 75-minute threshold (or temporarily disable the Fly.io poller), then load the page and inspect spot price cards for a stale indicator.
**Steps:**
- screenshot: "08-spot-prices-stale-note"
**Pass criteria:** Test documented for manual execution. To verify: when spot data age exceeds 75 minutes, a stale indicator (warning badge, color change, or explicit "stale" label) appears on one or more spot price cards. This confirms the frontend correctly detects and surfaces data freshness violations.
**Tags:** spot-prices, stale, manual
**Section:** 08-spot-prices
