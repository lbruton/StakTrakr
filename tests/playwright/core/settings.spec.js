import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const NUMISTA_KEY = "my-numista-key-2026"; // gitleaks:allow
const PCGS_TOKEN = "my-pcgs-token-2026"; // gitleaks:allow
const MASK = "••••••••";

const ATTACH_ITEM = {
  metal: "Silver",
  composition: "Silver",
  name: "Core Settings Attachment Item",
  qty: 1,
  type: "Coin",
  weight: 1,
  price: 30,
  marketValue: 0,
  date: "2025-01-01",
  year: "2025",
  grade: "MS-70",
  gradingAuthority: "PCGS",
  spotPriceAtPurchase: 0,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: "298883",
  serial: 101,
  attachments: [{ attachmentUuid: "att-a1", fileName: "receipt.pdf" }],
};

async function seedSettingsInventory(page, items = [ATTACH_ITEM]) {
  await injectSeedInventory(page);
  await page.addInitScript((inventory) => {
    localStorage.setItem("metalInventory", JSON.stringify(inventory));
    localStorage.setItem("inventorySerial", JSON.stringify(101));
    localStorage.setItem("cardViewStyle", "D");
    localStorage.setItem(
      "catalog_api_config",
      JSON.stringify({
        numista: { apiKey: btoa("my-numista-key-2026"), quota: 2000 },
        pcgs: { bearerToken: btoa("my-pcgs-token-2026") },
        local: { enabled: true },
      })
    );
  }, items);
}

async function gotoApp(page) {
  // Deep-link into the Inventory tab (STRK-282): these tests assert against the
  // inventory table's chips, which live in that panel.
  await page.goto("/index.html#/inventory", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.showSettingsModal === "function" &&
      typeof window.renderTable === "function" &&
      typeof window.catalogConfig !== "undefined"
  );
  // STRK-294: wait for the listener-readiness flag instead of sleeping. Phase 14
  // of init.js attaches every listener inside a `setTimeout(…, 200)`, so the
  // waitForFunction above goes true well before the UI is actually interactive.
  // This replaced a bare `waitForTimeout(300)` — a 100ms margin over that timer,
  // which is thin enough to flake on a loaded CI runner and would fail in a way
  // that looks unrelated to whatever the spec is testing.
  await page.waitForFunction(() => window.appListenersReady === true);
}

async function openSettings(page, tab) {
  await page.evaluate((targetTab) => window.showSettingsModal(targetTab), tab);
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator(`#settingsPanel_${tab}`)).toBeVisible();
}

async function expandCatalogRow(page, provider) {
  await page.evaluate((p) => {
    const row = document.querySelector(`.catalog-row[data-provider="${p}"]`);
    row?.classList.add("open");
    const expand = row?.querySelector(".catalog-row-expand");
    if (expand) {
      expand.style.display = "";
      expand.style.maxHeight = "none";
      expand.style.overflow = "visible";
    }
  }, provider);
  await expect(
    page.locator(`.catalog-row[data-provider="${provider}"] .catalog-row-expand`)
  ).toBeVisible();
}

test.describe("core/settings", () => {
  test.beforeEach(async ({ page }) => {
    await seedSettingsInventory(page);
    await gotoApp(page);
  });

  test("Appearance settings keep sort direction and inline chip controls in the Layout fieldset", async ({
    page,
  }) => {
    await openSettings(page, "site");

    const sortButton = page.locator("#settingsDefaultSortDir");
    await expect(sortButton).toHaveClass(/card-sort-dir-btn/);
    await expect(sortButton).toHaveAttribute("data-dir", "asc");
    await sortButton.click();
    await expect(sortButton).toHaveAttribute("data-dir", "desc");
    expect(await page.evaluate(() => localStorage.getItem("defaultSortDir"))).toBe("desc");

    const layoutFieldset = page.locator("#settingsPanel_site .settings-fieldset").filter({
      has: page.locator(".settings-fieldset-title", { hasText: /Layout/i }),
    });
    await expect(layoutFieldset.locator("#metalOrderConfigContainer")).toBeVisible();
    await expect(layoutFieldset.locator("#inlineChipConfigContainer")).toBeVisible();
    await expect(
      layoutFieldset.locator('#inlineChipConfigContainer tr[data-section-id="attachment"]')
    ).toHaveCount(1);
  });

  test("Attachment inline-chip setting hides, restores, and persists the table chip", async ({
    page,
  }) => {
    const attachChip = page.locator('[data-idx="0"] .attach-count-chip');
    await expect(attachChip).toBeVisible();

    await openSettings(page, "site");
    const attachToggle = page
      .locator('#inlineChipConfigContainer tr[data-section-id="attachment"]')
      .locator(".inline-chip-toggle");
    await attachToggle.click();
    await page.locator("#settingsCloseBtn").click();
    await expect(attachChip).not.toBeVisible();

    await page.reload({ waitUntil: "domcontentloaded" });
    await gotoApp(page);
    await expect(page.locator('[data-idx="0"] .attach-count-chip')).not.toBeVisible();

    await openSettings(page, "site");
    await page
      .locator('#inlineChipConfigContainer tr[data-section-id="attachment"] .inline-chip-toggle')
      .click();
    await page.locator("#settingsCloseBtn").click();
    await expect(page.locator('[data-idx="0"] .attach-count-chip')).toBeVisible();
  });

  // Lost its Market-header-button leg in STRK-290 and is renamed accordingly.
  // That leg clicked #headerMarketBtn and asserted, via a window.syncRetailPrices
  // stub, that it hit the retail sync rather than opening Settings. The button is
  // retired and the market pull now lives on #marketRefreshBtn inside the Market
  // block, which calls the LEXICAL `syncRetailPrices` binding — so the window-level
  // stub above would no longer intercept it and the assertion could only pass
  // vacuously. That path is covered properly in core/retail-market.spec.js's
  // STRK-290 block, which observes the sync's own providers.json fetch. What
  // remains here is what this test uniquely owns: panel routing.
  test("Market and settings entry points route to the intended panels", async ({ page }) => {
    // #marketSettingsBtn is rendered by market-data.js INSIDE the vendor-prices
    // section, which the v2 shell puts in the Market tab (STRK-282). The shared
    // gotoApp boots into Inventory for the table-chip tests in this file, so
    // this one has to switch tabs before the button is clickable.
    await page.locator("#tabBtnMarket").click();
    await expect(page.locator("#tabViewMarket")).toBeVisible();

    await page.locator("#marketSettingsBtn").click();
    await expect(page.locator("#settingsPanel_market")).toBeVisible();
    await page.evaluate(() => window.hideSettingsModal());

    // The #headerVaultBtn shortcut to Settings › System was retired in
    // STRK-285; the panel itself is unchanged and still reached via Settings.
    await page.evaluate(() => window.showSettingsModal("system"));
    await expect(page.locator("#settingsPanel_system")).toBeVisible();
  });

  test("Catalog API keys migrate legacy PCGS config and respect visibility masks", async ({
    page,
  }) => {
    const migration = await page.evaluate(() => {
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({ pcgs: { apiKey: btoa("legacy-pcgs-token") } })
      );
      window.catalogConfig.load();
      return window.catalogConfig.config.pcgs;
    });
    expect(migration.bearerToken).toBe("legacy-pcgs-token");
    expect("apiKey" in migration).toBe(false);

    await page.evaluate(
      ({ numistaKey, pcgsToken }) => {
        localStorage.setItem(
          "catalog_api_config",
          JSON.stringify({
            numista: { apiKey: btoa(numistaKey), quota: 2000 },
            pcgs: { bearerToken: btoa(pcgsToken) },
            local: { enabled: true },
          })
        );
      },
      { numistaKey: NUMISTA_KEY, pcgsToken: PCGS_TOKEN }
    );
    await openSettings(page, "api");
    await page.evaluate(() => window.setupSettingsEventListeners?.());
    await expandCatalogRow(page, "numista");

    const input = page.locator('.catalog-row[data-provider="numista"] .js-api-key-input');
    const toggle = page.locator(
      '.catalog-row[data-provider="numista"] .catalog-row-expand .js-toggle-password'
    );
    await expect(input).toHaveValue(MASK);
    await toggle.click();
    await expect(input).toHaveValue(NUMISTA_KEY);
    await toggle.click();
    await expect(input).toHaveValue(MASK);
  });
});

// ── STRK-306: copper dashboard cards + Metal Order ──────────────────────────
// Copper ships disabled by default (epic decision); enabling it in Settings ›
// Metal Order shows BOTH the copper spot card and the copper totals card.
// applyMetalOrder() stamps data-cards counts that gate the five-spot-card and
// six-totals-card CSS tiers, so pre-copper layouts stay untouched.

const COPPER_ON_CONFIG = [
  { id: "all", label: "All Metals", enabled: true },
  { id: "silver", label: "Silver", enabled: true },
  { id: "gold", label: "Gold", enabled: true },
  { id: "platinum", label: "Platinum", enabled: true },
  { id: "palladium", label: "Palladium", enabled: true },
  { id: "copper", label: "Copper", enabled: true },
];

// A config saved before copper existed — simulates an existing user.
const LEGACY_FIVE_CONFIG = [
  { id: "silver", label: "Silver", enabled: true },
  { id: "gold", label: "Gold", enabled: true },
  { id: "platinum", label: "Platinum", enabled: true },
  { id: "palladium", label: "Palladium", enabled: true },
  { id: "all", label: "All Metals", enabled: true },
];

async function gotoDashboard(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.appListenersReady === true);
}

test.describe("core/settings STRK-306 copper dashboard cards", () => {
  test("copper is hidden by default and the four/five-card layouts are untouched", async ({
    page,
  }) => {
    await gotoDashboard(page);

    await expect(page.locator(".spot-input.copper")).toBeHidden();
    await expect(page.locator(".total-card.copper")).toBeHidden();
    await expect(page.locator(".spot-cards-grid")).toHaveAttribute("data-cards", "4");
    await expect(page.locator("#totalsCarousel")).toHaveAttribute("data-cards", "5");

    // The Metal Order settings table surfaces the copper row (unchecked).
    await openSettings(page, "site");
    const copperRow = page.locator('#metalOrderConfigContainer tr[data-section-id="copper"]');
    await expect(copperRow).toHaveCount(1);
  });

  test("enabling copper shows both cards, stamps the card counts, and renders $/lb", async ({
    page,
  }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem("metalOrderConfig", JSON.stringify(cfg));
    }, COPPER_ON_CONFIG);
    await gotoDashboard(page);

    await expect(page.locator(".spot-input.copper")).toBeVisible();
    await expect(page.locator(".total-card.copper")).toBeVisible();
    await expect(page.locator(".spot-cards-grid")).toHaveAttribute("data-cards", "5");
    await expect(page.locator("#totalsCarousel")).toHaveAttribute("data-cards", "6");

    // Copper displays $/lb primary (industry convention) with the stored
    // per-ozt figure on the secondary line — storage stays per troy ounce.
    await expect(page.locator("#spotPriceDisplayCopper")).toContainText("/lb");
    await expect(page.locator("#spotPriceSecondaryCopper")).toContainText("/ozt");
    const stored = await page.evaluate(() => parseFloat(localStorage.getItem("spotCopper")));
    const displayed = await page.locator("#spotPriceDisplayCopper").textContent();
    const lbValue = parseFloat(displayed.replace(/[^\d.]/g, ""));
    // Displayed $/lb must equal stored $/ozt × 7000/480 (to display rounding).
    expect(Math.abs(lbValue - stored * (7000 / 480))).toBeLessThan(0.01);

    // All Metals leads the totals row under the new default-order config.
    const firstVisibleTitle = page
      .locator("#totalsCarousel .total-card:not([style*='display: none']) .total-title")
      .first();
    await expect(firstVisibleTitle).toHaveText("All Metals");
  });

  test("a pre-copper stored config keeps its order and leaves copper hidden", async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem("metalOrderConfig", JSON.stringify(cfg));
    }, LEGACY_FIVE_CONFIG);
    await gotoDashboard(page);

    // getMetalOrderConfig appends copper as disabled — cards stay hidden and
    // the stamped counts keep the pre-copper CSS tiers inert.
    await expect(page.locator(".spot-input.copper")).toBeHidden();
    await expect(page.locator(".total-card.copper")).toBeHidden();
    await expect(page.locator(".spot-cards-grid")).toHaveAttribute("data-cards", "4");
    await expect(page.locator("#totalsCarousel")).toHaveAttribute("data-cards", "5");

    // The stored order is preserved — Silver stays the first totals card.
    const firstVisibleTitle = page
      .locator("#totalsCarousel .total-card:not([style*='display: none']) .total-title")
      .first();
    await expect(firstVisibleTitle).toHaveText("Silver");
  });
});
