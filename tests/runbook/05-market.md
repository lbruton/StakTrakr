# Section 05 — Market

This section covers E2E tests for the Market feature area: opening the market panel, verifying API-loaded inventory and price data, searching and filtering by metal type, viewing price history, checking source badges, and the Goldback card. Tests 5.7 is marked as manual/visual because triggering a genuine 30-minute data stale state cannot be done programmatically within a Browserbase session.

Each test in this section is independently runnable given that the application has loaded at the PR preview URL (see `00-setup.md`). Tests 5.2 through 5.10 depend on the market panel being open; each test that requires it includes this in Preconditions so that the section can be resumed mid-run without ambiguity.

---

### Test 5.1 — Open market menu
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded at the PR preview URL. The What's New modal has been dismissed (see 00-setup.md).
**Steps:**
- act: "click the Market button or icon in the header navigation"
- extract: "is a market panel, market page, or market overlay visible on screen" → expect: true
- screenshot: "05-market-open"
**Pass criteria:** The market panel or page opens and is visible without a page reload error.
**Tags:** market, navigation
**Section:** 05-market

---

### Test 5.2 — Market loads all inventory from API
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Market panel open (5.1 complete).
**Steps:**
- extract: "how many market item listings or inventory rows are visible with price data in the market view" → expect: at least 1 item with a price value
**Pass criteria:** At least one market item listing is visible with an associated price, confirming that API data has loaded into the market panel.
**Tags:** market, api, load
**Section:** 05-market

---

### Test 5.3 — Search for item in market
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Market panel is open.
**Steps:**
- act: "type 'Silver' into the market search or filter input field"
- extract: "are only Silver-related market items visible after filtering" → expect: at least 1 Silver item visible
- screenshot: "05-market-search"
**Pass criteria:** Filtering by "Silver" returns at least one Silver-related market item and hides non-Silver items (or all visible items are Silver-related).
**Tags:** market, search
**Section:** 05-market

---

### Test 5.4 — Expand and view price history for an item
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Market panel is open. At least one market item is visible.
**Steps:**
- act: "click on a market item or expand button to view its price history or detail"
- extract: "is a price history section, price history chart, or historical price list visible" → expect: true
- screenshot: "05-market-price-history"
**Pass criteria:** Clicking a market item or its expand control reveals a price history section containing historical price data.
**Tags:** market, price-history
**Section:** 05-market

---

### Test 5.5 — Price history is accurate with current API trends
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Price history is expanded from 5.4 — a price history section is visible for a market item.
**Steps:**
- extract: "does the price history section show dates and non-zero dollar values (not all zeros and not empty)" → expect: non-empty price history with at least one non-zero price value
**Pass criteria:** The price history section displays at least one date-value pair where the dollar value is greater than zero, indicating live API data is being rendered.
**Tags:** market, price-history, accuracy
**Section:** 05-market

---

### Test 5.6 — Click item opens detail / price history view
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Market panel is open. At least one market item listing is visible.
**Steps:**
- act: "click on a specific market item in the market listing"
- extract: "is a detail view or expanded section with price information or price history now shown" → expect: true
**Pass criteria:** Clicking a market item opens or reveals a detail view or expanded panel that includes price information or price history for that item.
**Tags:** market, detail
**Section:** 05-market

---

### Test 5.7 — Stale indicator appears when data exceeds 30-min threshold
_Added: v3.33.25 (STAK-396)_
**Preconditions:** MANUAL/CONTROLLED TEST — This test cannot be automated within a standard Browserbase session. Triggering the 30-minute stale state requires either: (a) waiting 30+ minutes without a market data refresh, or (b) manipulating the `generated_at` timestamp in localStorage to simulate stale data. Neither is reliably achievable via Stagehand during a normal test run. To verify manually: load the app, open the market panel, allow market data to age past 30 minutes without refresh, then observe whether a stale badge or indicator appears on market items or in the market header.
**Steps:**
- screenshot: "05-market-stale-note"
**Pass criteria:** Test is documented. Manual verification procedure is recorded above. When executed under controlled stale conditions, a stale badge, warning icon, or "data may be outdated" indicator should be visible on market items or the market panel header.
**Tags:** market, stale, manual
**Section:** 05-market

---

### Test 5.8 — Goldback price card shows valid value
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Market panel is open.
**Steps:**
- extract: "is a Goldback price card or Goldback listing visible in the market view with a non-zero dollar price" → expect: Goldback price greater than 0
- screenshot: "05-market-goldback"
**Pass criteria:** The Goldback price is displayed in the market view with a dollar value greater than zero, confirming the Goldback feed is returning data.
**Tags:** market, goldback
**Section:** 05-market

---

### Test 5.9 — Toggle between metal tabs (Gold/Silver/Platinum/Palladium)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Market panel is open. Metal filter tabs are visible.
**Steps:**
- act: "click the Gold tab or Gold filter button in the market panel"
- extract: "are Gold market items or Gold-related listings visible" → expect: at least 1 Gold item
- act: "click the Silver tab or Silver filter button in the market panel"
- extract: "are Silver market items or Silver-related listings visible" → expect: at least 1 Silver item
- act: "click the Platinum tab or Platinum filter button in the market panel"
- extract: "are Platinum market items or Platinum-related listings visible" → expect: true
- act: "click the Palladium tab or Palladium filter button in the market panel"
- extract: "are Palladium market items or Palladium-related listings visible" → expect: true
- screenshot: "05-market-tabs"
**Pass criteria:** Each metal tab filter (Gold, Silver, Platinum, Palladium) responds to click and shows at least one relevant item listing, confirming per-metal filtering is functional for all four metals.
**Tags:** market, tabs, filter, metals
**Section:** 05-market

---

### Test 5.10 — Correct source badge visible on market items
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Market panel is open. At least one market item listing is visible.
**Steps:**
- extract: "does at least one market item display a source or provider badge such as 'eBay', 'APMEX', or another vendor name" → expect: true
- screenshot: "05-market-source-badge"
**Pass criteria:** At least one market item shows a source or provider badge identifying the data origin (e.g., "eBay", "APMEX", or the API source name), confirming source attribution is rendered correctly.
**Tags:** market, source-badge, provider
**Section:** 05-market
