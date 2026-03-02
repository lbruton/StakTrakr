# Section 06 — UI / UX

This section covers E2E tests for responsive layout, theme switching, totals accuracy, item count display, currency switching, and settings persistence. It validates that the application renders correctly at standard breakpoints, responds to user-initiated theme and currency changes, and that the Settings modal saves and persists state across a page reload.

**Viewport note (applies to 6.1 and 6.2):** Browserbase sessions use a fixed viewport configured at session creation time. Mid-session viewport resizing via Stagehand is not supported. Tests 6.1 (375px) and 6.2 (768px) are best executed in separate targeted Browserbase sessions configured at those widths. Within a standard desktop session, those tests capture a screenshot for reference and rely on session recording for visual verification. Test 6.3 (1280px desktop) runs normally in any standard Browserbase session.

Each test in this section is independently runnable given that the application has loaded at the PR preview URL (see `00-setup.md`). Tests that change application state (6.5–6.7 theme, 6.10 currency, 6.11 settings) include restore steps to return the app to its default state.

---

### Test 6.1 — All elements load in Mobile view (375px)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** VIEWPORT NOTE — Browserbase sessions use a fixed viewport set at session creation. For accurate mobile testing, this test should be run in a Browserbase session created with width=375px and height=812px. If the current session uses a desktop viewport, this test captures a screenshot for reference only and the result should be verified via the session recording at the correct viewport. Application is loaded at the PR preview URL.
**Steps:**
- screenshot: "06-ui-ux-mobile-check"
- extract: "is the main content area, inventory list, or spot price section visible without a JavaScript error" → expect: true
**Pass criteria:** At a 375px viewport width, the main application content renders and is accessible without horizontal overflow causing content to be cut off. No JavaScript errors should be present. Visual confirmation via session recording at 375px is recommended.
**Tags:** ui, responsive, mobile
**Section:** 06-ui-ux

---

### Test 6.2 — All elements load in Tablet view (768px)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** VIEWPORT NOTE — Same as 6.1. For accurate tablet testing, this test should be run in a Browserbase session created with width=768px. If the current session uses a different viewport, the screenshot documents the state for visual review. Application is loaded at the PR preview URL.
**Steps:**
- screenshot: "06-ui-ux-tablet-check"
- extract: "is the main content area visible and rendering correctly" → expect: true
**Pass criteria:** At a 768px viewport width, the application content renders and is accessible. No horizontal scroll bar should be required to view primary content. Visual confirmation via session recording at 768px is recommended.
**Tags:** ui, responsive, tablet
**Section:** 06-ui-ux

---

### Test 6.3 — All elements load in Desktop view (1280px)
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Standard Browserbase session (default viewport width of 1280px or greater). Application is loaded at the PR preview URL and the What's New modal has been dismissed.
**Steps:**
- extract: "are the spot price cards for Gold, Silver, Platinum, and Palladium all visible with dollar values" → expect: true
- extract: "are inventory cards or an inventory section visible on the page" → expect: true
- extract: "is the header navigation visible with menu icons or labels" → expect: true
- screenshot: "06-ui-ux-desktop"
**Pass criteria:** At desktop viewport (1280px+), the header navigation, all four spot price cards, and the inventory section are all simultaneously visible without requiring horizontal scroll.
**Tags:** ui, responsive, desktop
**Section:** 06-ui-ux

---

### Test 6.4 — No overlap or bleed issues in any size mode
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded at the PR preview URL in the current session's viewport.
**Steps:**
- screenshot: "06-ui-ux-layout-check"
**Pass criteria:** Visual inspection via session recording — no obvious overlap between UI elements (cards, header, modals, or filter chips), no text bleeding outside container boundaries, and no elements obscuring interactive controls. Recommend reviewing the recording at multiple scroll positions from top to bottom of the page.
**Tags:** ui, responsive, layout, visual
**Section:** 06-ui-ux

---

### Test 6.5 — Light theme triggers correctly
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded. Theme selector is accessible from the header or settings area.
**Steps:**
- act: "click the theme toggle, theme selector, or theme switcher in the header or navigation"
- act: "select the Light theme option"
- extract: "does the page appear in light mode with a light or white background" → expect: light theme active (light background visible)
- screenshot: "06-ui-ux-light-theme"
**Pass criteria:** Selecting the Light theme visibly changes the application background to a light color scheme and the change persists until another theme is selected.
**Tags:** ui, theme, light
**Section:** 06-ui-ux

---

### Test 6.6 — Dark theme triggers correctly
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded. Theme selector is accessible.
**Steps:**
- act: "click the theme toggle, theme selector, or theme switcher in the header or navigation"
- act: "select the Dark theme option"
- extract: "does the page appear in dark mode with a dark background" → expect: dark theme active (dark background visible)
- screenshot: "06-ui-ux-dark-theme"
**Pass criteria:** Selecting the Dark theme visibly changes the application to a dark color scheme. The page background is dark and text is light-colored.
**Tags:** ui, theme, dark
**Section:** 06-ui-ux

---

### Test 6.7 — Sepia/HelloKitty theme triggers correctly
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded. Theme selector is accessible.
**Steps:**
- act: "click the theme toggle, theme selector, or theme switcher in the header or navigation"
- act: "select the Sepia or HelloKitty theme option, whichever is available in the selector"
- extract: "does the page show a visually distinct theme that is neither the default light nor the standard dark theme" → expect: a non-default theme is applied and visible
- screenshot: "06-ui-ux-sepia-theme"
**Pass criteria:** Selecting the Sepia or HelloKitty theme applies a visually distinct color scheme to the application that differs from both the Light and Dark themes.
**Tags:** ui, theme, sepia, hellokitty
**Section:** 06-ui-ux

---

### Test 6.8 — Totals cards are accurate based on current spot prices
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded. Spot prices have loaded (spot cards show non-zero values). Inventory contains at least one item (seed data of 8 items is present).
**Steps:**
- extract: "what is the total melt value or All Metals summary card dollar amount shown on the page" → expect: a non-zero dollar amount greater than $0.00
- screenshot: "06-ui-ux-totals"
**Pass criteria:** The All Metals total or aggregate melt value card displays a non-zero dollar amount, confirming that spot prices are being multiplied by inventory weights to produce totals.
**Tags:** ui, totals, accuracy
**Section:** 06-ui-ux

---

### Test 6.9 — Item counts displayed are accurate
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded with seed inventory (8 items). No items have been added or deleted in this session before this test runs.
**Steps:**
- extract: "what number does the item count badge, item count label, or inventory count display show" → expect: 8
- screenshot: "06-ui-ux-count"
**Pass criteria:** The item count display shows 8, matching the seed inventory count. If items were added or deleted earlier in the session, the expected count should be adjusted accordingly and noted in the test run record.
**Tags:** ui, count, accuracy
**Section:** 06-ui-ux

---

### Test 6.10 — Currency switcher — USD to EUR updates all price displays
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded. Settings modal is accessible via the gear icon.
**Steps:**
- act: "click the Settings gear icon in the header or navigation"
- act: "locate the display currency setting and change it to EUR or Euro"
- act: "close the Settings modal by clicking the close button or clicking outside the modal"
- extract: "is the euro symbol (€) visible in at least one spot price card or inventory melt value display" → expect: € symbol present
- screenshot: "06-ui-ux-currency-eur"
- act: "click the Settings gear icon to reopen Settings"
- act: "change the display currency back to USD"
- act: "close the Settings modal"
**Pass criteria:** After switching to EUR, the euro symbol (€) appears in at least one price display on the page (spot cards or inventory card melt values). The restore steps return the currency to USD so subsequent tests see correct USD formatting.
**Tags:** ui, currency, settings
**Section:** 06-ui-ux

---

### Test 6.11 — Settings modal opens, saves, and persists across reload
_Added: v3.33.25 (STAK-396)_
**Preconditions:** Application is loaded. Settings modal is accessible via the gear icon.
**Steps:**
- act: "click the Settings gear icon in the header or navigation"
- screenshot: "06-ui-ux-settings-open"
- act: "change the items per page setting to 32"
- act: "close the Settings modal by clicking the close button or clicking outside the modal"
- act: "click the Settings gear icon to reopen the Settings modal"
- extract: "what is the current value shown in the items per page setting field" → expect: 32
- act: "change the items per page setting back to its default value (All)"
- act: "close the Settings modal"
**Pass criteria:** After setting items per page to 32 and closing the modal, reopening Settings shows the value persisted as 32. The restore steps return the setting to its default so subsequent tests are not affected by changed pagination.
**Tags:** ui, settings, persistence, reload
**Section:** 06-ui-ux
