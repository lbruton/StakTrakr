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
  // of init.js attaches every listener inside a deferred `setTimeout`, so the
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
// A first-run boot saves a Metal Order with copper enabled. A returning user
// with no saved Metal Order, or a config that predates copper, keeps copper
// hidden until it is enabled in Settings › Metal Order. applyMetalOrder()
// stamps the spot card count that gates the five-spot-card CSS tier, and marks
// each totals row enabled or not.

/** Lists the totals ledger's metal rows in DOM order with their enabled flag. */
const ledgerRowOrder = (page) =>
  page
    .locator("#totalsLedger tbody .totals-row")
    .evaluateAll((rows) => rows.map((r) => `${r.dataset.metalKey}:${r.dataset.enabled}`));

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

/** Expects the copper spot card and totals row hidden, and the four-card spot tier. */
async function expectCopperHidden(page) {
  await expect(page.locator(".spot-input.copper")).toBeHidden();
  await expect(page.locator("#totalsLedger .totals-row.copper")).toBeHidden();
  await expect(page.locator(".spot-cards-grid")).toHaveAttribute("data-cards", "4");
}

const SETTINGS_PANELS = [
  "about",
  "site",
  "system",
  "grouping",
  "images",
  "collections",
  "currency",
  "market",
  "storage",
  "api",
  "cloud",
  "changelog",
  "faq",
];

/** Lists the visible form controls in a panel that have no accessible name. */
function listUnnamedControls(page, panel) {
  return page.evaluate((panelId) => {
    const textOf = (id) => (document.getElementById(id)?.textContent || "").trim();
    const nameOf = (el) => {
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map(textOf).join(" ").trim();
        if (text) return text;
      }
      if ((el.getAttribute("aria-label") || "").trim()) return el.getAttribute("aria-label").trim();
      if ([...(el.labels || [])].some((l) => l.textContent.trim())) return "label";
      return (el.getAttribute("title") || "").trim();
    };
    const panelEl = document.getElementById(panelId);
    return [...panelEl.querySelectorAll("select, textarea, input:not([type=hidden])")]
      .filter((el) => el.getClientRects().length > 0 && !nameOf(el))
      .map((el) => el.id || `${el.tagName.toLowerCase()}[${el.type}]`);
  }, `settingsPanel_${panel}`);
}

test.describe("core/settings control semantics", () => {
  test.beforeEach(async ({ page }) => {
    await seedSettingsInventory(page);
    await gotoApp(page);
  });

  test("every visible Settings form control has an accessible name", async ({ page }) => {
    test.setTimeout(test.info().timeout * SETTINGS_PANELS.length);
    for (const panel of SETTINGS_PANELS) {
      await test.step(`${panel} panel`, async () => {
        await openSettings(page, panel);
        if (panel === "market") {
          await expect(
            page.locator("#settingsPanel_market input[type=checkbox]").first()
          ).toBeVisible();
        }
        expect(await listUnnamedControls(page, panel)).toEqual([]);
      });
    }
  });

  test("Market filter checkboxes are named vendor, metal", async ({ page }) => {
    await openSettings(page, "market");
    const names = await page
      .locator("#settingsPanel_market table input[data-slug][data-vendor]")
      .evaluateAll((boxes) => boxes.map((b) => b.getAttribute("aria-label")));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^.+, .+$/);
  });

  test("On/Off and mode chip groups are named groups that expose and flip aria-pressed", async ({
    page,
  }) => {
    await openSettings(page, "grouping");
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("#settingsModal .chip-sort-toggle")]
        .filter((g) => !(g.getAttribute("role") === "group" && g.getAttribute("aria-label")))
        .map((g) => g.id || g.className)
    );
    expect(unnamed).toEqual([]);
    const missingState = await page.evaluate(() =>
      [...document.querySelectorAll("#settingsModal .chip-sort-toggle .chip-sort-btn")]
        .filter((b) => b.getAttribute("aria-pressed") !== String(b.classList.contains("active")))
        .map((b) => `${b.closest(".chip-sort-toggle").id}:${b.textContent.trim()}`)
    );
    expect(missingState).toEqual([]);

    const group = page.locator("#settingsFuzzyAutocomplete");
    await expect(group).toHaveAttribute("role", "group");
    await expect(group).toHaveAttribute("aria-label", "Fuzzy autocomplete");
    const on = group.getByRole("button", { name: "On" });
    const off = group.getByRole("button", { name: "Off" });
    await expect(on).toHaveAttribute("aria-pressed", "true");
    await off.click();
    await expect(off).toHaveAttribute("aria-pressed", "true");
    await expect(on).toHaveAttribute("aria-pressed", "false");
    await on.click();
    await expect(on).toHaveAttribute("aria-pressed", "true");
  });

  test("the Settings nav is labelled, marks the active section and moves with arrow keys", async ({
    page,
  }) => {
    await openSettings(page, "about");
    const nav = page.getByRole("navigation", { name: "Settings sections" });
    await expect(nav).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.locator('[data-section="about"]')).toHaveAttribute("aria-current", "page");

    await nav.locator('[data-section="site"]').click();
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(nav.locator('[data-section="site"]')).toHaveAttribute("aria-current", "page");

    await nav.locator('[data-section="site"]').focus();
    await page.keyboard.press("ArrowDown");
    await expect(nav.locator('[data-section="system"]')).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(nav.locator('[data-section="site"]')).toBeFocused();
  });

  test("every Settings panel is a region labelled by one real heading", async ({ page }) => {
    const panels = await page.evaluate(() =>
      [...document.querySelectorAll(".settings-section-panel")].map((p) => {
        const heading = document.getElementById(p.getAttribute("aria-labelledby") || "");
        return {
          id: p.id,
          role: p.getAttribute("role"),
          tag: heading ? heading.tagName : null,
          text: heading ? heading.textContent.trim() : "",
        };
      })
    );
    expect(panels).toHaveLength(SETTINGS_PANELS.length);
    expect(
      await page.evaluate(
        () =>
          [...document.querySelectorAll(".settings-fieldset-title")].filter(
            (t) => t.getAttribute("role") !== "heading"
          ).length
      )
    ).toBe(0);
    for (const p of panels) {
      expect(p.role, p.id).toBe("region");
      expect(p.tag, p.id).toBe("H3");
      expect(p.text, p.id).not.toBe("");
    }
  });
});

test.describe("core/settings copper dashboard cards", () => {
  test("a first-run boot shows copper as the fifth spot card", async ({ page }) => {
    await gotoDashboard(page);

    await expect(page.locator(".spot-input.copper")).toBeVisible();
    await expect(page.locator(".spot-cards-grid")).toHaveAttribute("data-cards", "5");
    expect(await ledgerRowOrder(page)).toEqual([
      "silver:true",
      "gold:true",
      "platinum:true",
      "palladium:true",
      "copper:true",
    ]);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("metalOrderConfig")));
    expect(saved.find((m) => m.id === "copper").enabled).toBe(true);

    // The Metal Order settings table shows the copper row checked.
    await openSettings(page, "site");
    const copperRow = page.locator('#metalOrderConfigContainer tr[data-section-id="copper"]');
    await expect(copperRow).toHaveCount(1);
    await expect(copperRow.locator('input[type="checkbox"]')).toBeChecked();
  });

  test("a returning user with no saved Metal Order keeps copper hidden", async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("metalInventory") === null) {
        localStorage.setItem("metalInventory", "[]");
        localStorage.setItem("inventorySeedApplied", "true");
      }
    });
    await gotoDashboard(page);

    await expectCopperHidden(page);
    expect(await page.evaluate(() => localStorage.getItem("metalOrderConfig"))).toBeNull();
  });

  test("a first-run boot seeds copper over an unreadable stored Metal Order", async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("seededBadOrder") === null) {
        sessionStorage.setItem("seededBadOrder", "1");
        localStorage.setItem("metalOrderConfig", "{not json");
      }
    });
    await gotoDashboard(page);

    await expect(page.locator(".spot-cards-grid")).toHaveAttribute("data-cards", "5");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("metalOrderConfig")));
    expect(saved.find((m) => m.id === "copper").enabled).toBe(true);
  });

  test("a first-run user who turns copper off keeps it off after a reload", async ({ page }) => {
    await gotoDashboard(page);
    await expect(page.locator(".spot-input.copper")).toBeVisible();

    await openSettings(page, "site");
    await page
      .locator('#metalOrderConfigContainer tr[data-section-id="copper"] input[type="checkbox"]')
      .uncheck();
    await expect(page.locator(".spot-input.copper")).toBeHidden();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("metalOrderConfig")));
    expect(saved.find((m) => m.id === "copper").enabled).toBe(false);

    await page.goto("about:blank");
    await gotoDashboard(page);
    await expect(page.locator(".spot-input.copper")).toBeHidden();
    await expect(page.locator(".spot-cards-grid")).toHaveAttribute("data-cards", "4");
  });

  test("enabling copper shows the spot card, enables the totals row, and renders $/lb", async ({
    page,
  }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem("metalOrderConfig", JSON.stringify(cfg));
    }, COPPER_ON_CONFIG);
    await gotoDashboard(page);

    await expect(page.locator(".spot-input.copper")).toBeVisible();
    await expect(page.locator("#totalsLedger .totals-row.copper")).toHaveAttribute(
      "data-enabled",
      "true"
    );
    await expect(page.locator(".spot-cards-grid")).toHaveAttribute("data-cards", "5");

    // Copper displays $/lb primary (industry convention) with the stored
    // per-ozt figure in the value's hover title (a visible second line broke
    // the card's row alignment — STRK-341 review). Storage stays per-ozt.
    await expect(page.locator("#spotPriceDisplayCopper")).toContainText("/lb");
    await expect(page.locator("#spotPriceDisplayCopper")).toHaveAttribute("title", /\/ozt/);
    const stored = await page.evaluate(() => parseFloat(localStorage.getItem("spotCopper")));
    const displayed = await page.locator("#spotPriceDisplayCopper").textContent();
    const lbValue = parseFloat(displayed.replace(/[^\d.]/g, ""));
    // Displayed $/lb must equal stored $/ozt × 7000/480 (to display rounding).
    expect(Math.abs(lbValue - stored * (7000 / 480))).toBeLessThan(0.01);

    // All Metals is the ledger's footer row wherever Metal Order places it.
    await expect(page.locator("#totalsLedger tfoot .total-title")).toHaveText("All Metals");
  });

  test("the Ag:Cu ratio chip follows copper's Metal Order setting", async ({ page }) => {
    await gotoDashboard(page);

    // Disable copper mid-session exactly as the settings table does. The chip
    // renders into the copper card, which is display:none, so no copper
    // figure surfaces on a copper-less dashboard.
    const setCopper = (enabled) =>
      page.evaluate((on) => {
        const cfg = JSON.parse(localStorage.getItem("metalOrderConfig") || "null") || [];
        const copperRow = cfg.find((m) => m.id === "copper");
        if (copperRow) copperRow.enabled = on;
        else cfg.push({ id: "copper", label: "Copper", enabled: on });
        localStorage.setItem("metalOrderConfig", JSON.stringify(cfg));
        window.applyMetalOrder();
        window.renderRatioChips();
      }, enabled);
    await setCopper(false);
    await expect(page.locator('.spot-ratio-chip[data-pair="ag-cu"]')).toBeHidden();
    await setCopper(true);

    const chip = page.locator('.spot-ratio-chip[data-pair="ag-cu"]');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Ag:Cu");
    // Value formats legibly at the pair's real ~3-digit magnitude, and equals
    // the live silver/copper spots to the chip's one-decimal precision.
    const chipValue = await chip.locator(".val").textContent();
    const expected = await page.evaluate(
      () =>
        parseFloat(localStorage.getItem("spotSilver")) /
        parseFloat(localStorage.getItem("spotCopper"))
    );
    expect(parseFloat(chipValue)).toBeCloseTo(expected, 1);
  });

  test("a pre-copper stored config keeps its order and leaves copper hidden", async ({ page }) => {
    await page.addInitScript((cfg) => {
      localStorage.setItem("metalOrderConfig", JSON.stringify(cfg));
    }, LEGACY_FIVE_CONFIG);
    await gotoDashboard(page);

    // getMetalOrderConfig appends copper as disabled: its card and row stay hidden and
    // the stamped spot count keeps the pre-copper CSS tier inert.
    await expectCopperHidden(page);

    // The stored order is preserved, and All Metals stays the footer.
    expect(await ledgerRowOrder(page)).toEqual([
      "silver:true",
      "gold:true",
      "platinum:true",
      "palladium:true",
      "copper:false",
    ]);
    await expect(page.locator("#totalsLedger tfoot .total-title")).toHaveText("All Metals");
  });

  test("the totals rows follow a reordered Metal Order", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "metalOrderConfig",
        JSON.stringify(
          ["gold", "all", "palladium", "silver", "copper", "platinum"].map((id) => ({
            id,
            label: id,
            enabled: id !== "platinum",
          }))
        )
      );
    });
    await gotoDashboard(page);
    expect(await ledgerRowOrder(page)).toEqual([
      "gold:true",
      "palladium:true",
      "silver:true",
      "copper:true",
      "platinum:false",
    ]);
  });
});
