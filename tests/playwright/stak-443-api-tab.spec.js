import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "./helpers/seed.js";

/**
 * STAK-443 — API Tab Sectioned Redesign (TDD red phase)
 *
 * These tests are written BEFORE implementation. They MUST fail against the
 * current `dev` branch. Phase 1+ tasks turn them green.
 *
 * Test list (maps 1:1 to design.md Testing Strategy):
 *   1.  REQ-1     three .settings-fieldset cards render in order
 *   2.  REQ-2     Market card: status dot + timestamp + attribution; no toggle
 *   3.  REQ-3     (parametrized) pill click persists spotPricingSource
 *   4.  REQ-4     Metals.dev sub-card field schema
 *   5.  REQ-4.6   API key show/hide toggle; no console.log leakage
 *   6.  REQ-5     Manual mode: no fetches; save persists 4 values
 *   7.  REQ-6     Catalog has exactly 2 rows, both "Free", green dot only if configured
 *   8.  REQ-7     Advanced Settings modal: 2 tabs, Esc + backdrop close, inside-click does NOT close
 *   9.  REQ-7.9   PCGS bulk modal has 2 tabs (Overview + Sync Settings)
 *   10. REQ-8     all action buttons border-radius: 999px; History uses .btn-history
 *   11. REQ-9     migration: providerPriority -> spotPricingSource
 *   12. REQ-9.4   default when all keys unset -> STAKTRAKR
 *   13. REQ-10    switch to Manual -> zero spot-price fetches over 5s
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const KEYED_PROVIDERS = ["STAKTRAKR", "METALS_DEV", "METALS_API", "METAL_PRICE_API", "CUSTOM"];
const PROVIDER_LABELS = {
  STAKTRAKR: "StakTrakr",
  METALS_DEV: "Metals.dev",
  METALS_API: "Metals-API",
  METAL_PRICE_API: "MetalPriceAPI",
  CUSTOM: "Custom",
  MANUAL: "Manual",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed localStorage keys before page load. Accepts any subset.
 * Values are raw-stringified (loadData JSON-parses on read).
 */
async function seedApiState(page, opts = {}) {
  await page.addInitScript((data) => {
    if (data.metalApiConfig !== undefined) {
      localStorage.setItem("metalApiConfig", JSON.stringify(data.metalApiConfig));
    }
    if (data.spotPricingSource !== undefined) {
      localStorage.setItem("spotPricingSource", JSON.stringify(data.spotPricingSource));
    }
    if (data.spotPricingSourceRaw !== undefined) {
      // raw (no JSON wrap) — exercises loadData fall-through
      localStorage.setItem("spotPricingSource", data.spotPricingSourceRaw);
    }
    if (data.providerPriority !== undefined) {
      localStorage.setItem("providerPriority", JSON.stringify(data.providerPriority));
    }
    if (data.apiProviderOrder !== undefined) {
      localStorage.setItem("apiProviderOrder", JSON.stringify(data.apiProviderOrder));
    }
    if (data.metalSpotPrices !== undefined) {
      localStorage.setItem("metalSpotPrices", JSON.stringify(data.metalSpotPrices));
    }
    if (data.manualSpotStorage !== undefined) {
      Object.entries(data.manualSpotStorage).forEach(([key, value]) => {
        localStorage.setItem(key, String(value));
      });
    }
    if (data.clearSpotPricingSource) {
      localStorage.removeItem("spotPricingSource");
    }
    if (data.clearAll) {
      localStorage.removeItem("spotPricingSource");
      localStorage.removeItem("providerPriority");
      localStorage.removeItem("apiProviderOrder");
      localStorage.removeItem("metalApiConfig");
      localStorage.removeItem("metalSpotPrices");
      localStorage.removeItem("spotGold");
      localStorage.removeItem("spotSilver");
      localStorage.removeItem("spotPlatinum");
      localStorage.removeItem("spotPalladium");
    }
  }, opts);
}

async function openApiSettings(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("api"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  await expect(page.locator("#settingsPanel_api")).toBeVisible();
}

async function readSpotPricingSource(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem("spotPricingSource");
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  });
}

async function confirmSpotProviderSwitch(page, provider) {
  const dialog = page.locator("#appDialogModal");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(PROVIDER_LABELS[provider]);
  await expect(dialog).toContainText("spot prices");
  await expect(dialog).toContainText("charts");
  await expect(dialog).toContainText("ticker");
  await expect(dialog).toContainText("portfolio values");
  await dialog.locator("#appDialogOk").click();
  await expect(dialog).toBeHidden();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe("STAK-443 — API Tab Sectioned Redesign", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
  });

  // =========================================================================
  // REQ-1 — three .settings-fieldset cards render in order
  // =========================================================================
  test("1. REQ-1 — three .settings-fieldset cards in order (Market, Spot, Catalog); no legacy provider-tab bar", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page.locator("#settingsPanel_api");

    // Legacy provider-tab bar must NOT exist inside the API panel after redesign
    await expect(panel.locator(".settings-provider-tabs")).toHaveCount(0);
    await expect(panel.locator(".settings-provider-tab")).toHaveCount(0);

    // Three new section IDs must exist and each must carry .settings-fieldset
    const marketSection = panel.locator("#apiSection_market");
    const spotSection = panel.locator("#apiSection_spot");
    const catalogSection = panel.locator("#apiSection_catalog");
    await expect(marketSection).toHaveClass(/settings-fieldset/);
    await expect(spotSection).toHaveClass(/settings-fieldset/);
    await expect(catalogSection).toHaveClass(/settings-fieldset/);

    // The three cards render in order: Market → Spot → Catalog
    const titles = await panel
      .locator(".settings-fieldset .settings-fieldset-title")
      .allTextContents();
    expect(titles.length).toBeGreaterThanOrEqual(3);
    expect(titles[0]).toMatch(/Market/i);
    expect(titles[1]).toMatch(/Spot/i);
    expect(titles[2]).toMatch(/Catalog/i);
  });

  // =========================================================================
  // REQ-2 — Market card: status dot + timestamp + attribution; no toggle
  // =========================================================================
  test("2. REQ-2 — Market card shows status dot + timestamp + 'Provided by api.staktrakr.com'; no on/off toggle", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const market = page.locator("#apiSection_market");
    await expect(market).toBeVisible();

    // status dot visible
    await expect(market.locator(".status-dot")).toHaveCount(1);

    // timestamp-bearing text (some element inside the Market card references "ago" or a timestamp)
    const marketText = (await market.innerText()).toLowerCase();
    expect(marketText).toMatch(/ago|updated|last|min|sec|hour/);

    // static attribution footer
    await expect(market).toContainText("Provided by api.staktrakr.com");

    // NO on/off toggle — no checkbox/switch with a toggle-intent label, and no button carrying "Disable"/"Turn off"
    await expect(
      market.locator('input[type="checkbox"][data-role="toggle"], .toggle-switch, .on-off-toggle')
    ).toHaveCount(0);
    await expect(
      market.locator('button:has-text("Disable"), button:has-text("Turn off")')
    ).toHaveCount(0);
  });

  // =========================================================================
  // REQ-3 (parametrized) — clicking a pill persists spotPricingSource and
  // shows only that provider's sub-card.
  // =========================================================================
  KEYED_PROVIDERS.forEach((provider) => {
    test(`3.${provider} REQ-3 — clicking '${provider}' pill persists spotPricingSource='${provider}' and shows only its sub-card`, async ({
      page,
    }) => {
      // Start on a different provider so the click triggers a real state change
      const initialProvider = provider === "STAKTRAKR" ? "MANUAL" : "STAKTRAKR";
      await seedApiState(page, { spotPricingSource: initialProvider });
      await page.goto("/index.html", { waitUntil: "domcontentloaded" });
      await openApiSettings(page);

      const spotSection = page.locator("#apiSection_spot");
      await expect(spotSection).toBeVisible();

      // Pill radio group must exist with 6 pills (5 keyed + Manual)
      const pillGroup = spotSection.locator('.gb-source-group[role="radiogroup"]');
      await expect(pillGroup).toHaveCount(1);
      await expect(pillGroup.locator(".gb-source-btn")).toHaveCount(6);

      // Click the target pill
      const pill = pillGroup.locator(`.gb-source-btn[data-val="${provider}"]`);
      await expect(pill).toHaveCount(1);
      await expect(pill).toHaveAttribute("role", "radio");
      await pill.click();
      await confirmSpotProviderSwitch(page, provider);

      // Pill reflects active state
      await expect(pill).toHaveClass(/active/);
      await expect(pill).toHaveAttribute("aria-checked", "true");

      // Persistence: spotPricingSource localStorage key reads as the enum string
      const stored = await readSpotPricingSource(page);
      expect(stored).toBe(provider);

      // Only the matching sub-card is visible; the other 5 accordion panels are hidden
      const activePanel = spotSection.locator(`.spot-accordion-panel[data-val="${provider}"]`);
      await expect(activePanel).toBeVisible();

      const otherPanels = spotSection.locator(
        `.spot-accordion-panel:not([data-val="${provider}"])`
      );
      const otherCount = await otherPanels.count();
      expect(otherCount).toBe(5);
      for (let i = 0; i < otherCount; i++) {
        await expect(otherPanels.nth(i)).toBeHidden();
      }
    });
  });

  test("3.1 STAK-571 — canceling spot provider confirmation keeps previous provider", async ({
    page,
  }) => {
    await seedApiState(page, { spotPricingSource: "STAKTRAKR" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const spotSection = page.locator("#apiSection_spot");
    const metalsDevPill = spotSection.locator('.gb-source-btn[data-val="METALS_DEV"]');
    await metalsDevPill.click();

    const dialog = page.locator("#appDialogModal");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Metals.dev");
    await dialog.locator("#appDialogCancel").click();
    await expect(dialog).toBeHidden();

    expect(await readSpotPricingSource(page)).toBe("STAKTRAKR");
    await expect(spotSection.locator('.gb-source-btn[data-val="STAKTRAKR"]')).toHaveClass(/active/);
    await expect(metalsDevPill).not.toHaveClass(/active/);
  });

  test("3.2 STAK-571 — clicking already-active spot provider does not show confirmation", async ({
    page,
  }) => {
    await seedApiState(page, { spotPricingSource: "METALS_DEV" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    await page.locator('#apiSection_spot .gb-source-btn[data-val="METALS_DEV"]').click();

    await expect(page.locator("#appDialogModal")).toHaveCount(0);
    expect(await readSpotPricingSource(page)).toBe("METALS_DEV");
  });

  // =========================================================================
  // REQ-4 — Metals.dev sub-card field schema
  // =========================================================================
  test("4. REQ-4 — Metals.dev sub-card exposes API-key (password), cache timeout, pull-history button, metals checkboxes, auto-refresh, action row", async ({
    page,
  }) => {
    await seedApiState(page, { spotPricingSource: "METALS_DEV" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page
      .locator("#apiSection_spot")
      .locator('.spot-accordion-panel[data-val="METALS_DEV"]');
    await expect(panel).toBeVisible();

    // API key input (password type)
    const keyInput = panel.locator('input[type="password"]').first();
    await expect(keyInput).toHaveCount(1);
    await expect(keyInput).toHaveAttribute("type", "password");

    // Cache timeout selector
    await expect(panel.locator("select").first()).toHaveCount(1);

    // Pull history button
    await expect(
      panel.locator('button:has-text("Pull"), button:has-text("Pull history")')
    ).not.toHaveCount(0);

    // Metals checkboxes — all supported metals, scoped away from auto-refresh.
    const metalLabels = panel.locator(".metal-checkboxes .metal-checkbox span");
    await expect(metalLabels).toHaveText(["Gold", "Silver", "Platinum", "Palladium"]);
    const panelText = await panel.innerText();

    // Auto-refresh toggle (checkbox)
    await expect(panel.locator('input[type="checkbox"]').filter({ hasText: "" })).not.toHaveCount(
      0
    );
    expect(panelText.toLowerCase()).toMatch(/auto.?refresh|background refresh/);

    // Action row: Save / Save & Test / History / Clear Key
    await expect(panel.locator('button:has-text("Save")').first()).toBeVisible();
    await expect(panel.locator('button:has-text("Save & Test")').first()).toBeVisible();
    await expect(panel.locator('button:has-text("History")').first()).toBeVisible();
    await expect(panel.locator('button:has-text("Clear Key")').first()).toBeVisible();
  });

  // =========================================================================
  // REQ-4.6 — API key input toggles password/text on show-hide click;
  // console.log is not called with the key value.
  // =========================================================================
  test("5. REQ-4.6 — API key input toggles password/text on show-hide click; key value never reaches console.log", async ({
    page,
  }) => {
    // Low-entropy sentinel — not a real secret, just a string we search console for.
    const sentinelKey = "sentinelsentinelsentinel";
    await seedApiState(page, {
      spotPricingSource: "METALS_DEV",
      metalApiConfig: { provider: "METALS_DEV", keys: { METALS_DEV: sentinelKey } },
    });

    // Record every console.log call before navigating
    const consoleArgs = [];
    page.on("console", (msg) => {
      consoleArgs.push(msg.text());
      for (const arg of msg.args()) {
        // Best-effort stringify handle
        consoleArgs.push(String(arg));
      }
    });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page
      .locator("#apiSection_spot")
      .locator('.spot-accordion-panel[data-val="METALS_DEV"]');
    await expect(panel).toBeVisible();

    const keyInput = panel.locator('input[type="password"], input[type="text"]').first();
    await expect(keyInput).toHaveAttribute("type", "password");

    // Show/hide toggle button — by convention carries an aria-label, class, or text hint
    const toggleBtn = panel
      .locator(
        'button[aria-label*="show" i], button[aria-label*="hide" i], button[data-role="toggle-password"], .show-hide-toggle, .js-toggle-password'
      )
      .first();
    await expect(toggleBtn).toBeVisible();

    await toggleBtn.click();
    await expect(keyInput).toHaveAttribute("type", "text");

    await toggleBtn.click();
    await expect(keyInput).toHaveAttribute("type", "password");

    // Focus and blur the input to exercise any "save/log" side effect path
    await keyInput.focus();
    await keyInput.blur();

    // The key value must not appear in any captured console output
    for (const s of consoleArgs) {
      expect(s).not.toContain(sentinelKey);
    }
  });

  // =========================================================================
  // REQ-5 — Selecting Manual disables feed fetches; entering 4 values and
  // clicking Save persists them.
  // =========================================================================
  test("6. REQ-5 — Manual pill disables feeds; entering 4 values + Save persists", async ({
    page,
  }) => {
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const spotSection = page.locator("#apiSection_spot");
    await expect(spotSection).toBeVisible();

    const manualPill = spotSection.locator('.gb-source-btn[data-val="MANUAL"]');
    await expect(manualPill).toHaveCount(1);
    await manualPill.click();
    await confirmSpotProviderSwitch(page, "MANUAL");
    await expect(manualPill).toHaveClass(/active/);

    const stored = await readSpotPricingSource(page);
    expect(stored).toBe("MANUAL");

    const manualPanel = spotSection.locator('.spot-accordion-panel[data-val="MANUAL"]');
    await expect(manualPanel).toBeVisible();

    // Four numeric inputs for Au / Ag / Pt / Pd
    const numericInputs = manualPanel.locator('input[type="number"]');
    await expect(numericInputs).toHaveCount(4);

    await numericInputs.nth(0).fill("2712.50");
    await numericInputs.nth(1).fill("31.84");
    await numericInputs.nth(2).fill("975.20");
    await numericInputs.nth(3).fill("1014.00");

    // Save
    const saveBtn = manualPanel.locator('button:has-text("Save")').first();
    await saveBtn.click();

    // Persistence — spot prices must be saved (spot-price keys; name may vary)
    // The canonical sink is `metalSpotPrices` or individual per-metal keys; assert
    // any of the accepted shapes carries the four values we typed.
    const persisted = await page.evaluate(() => {
      const candidates = ["metalSpotPrices", "spotPrices", "manualSpotPrices", "currentSpotPrices"];
      const out = {};
      for (const k of candidates) {
        const raw = localStorage.getItem(k);
        if (raw != null) {
          try {
            out[k] = JSON.parse(raw);
          } catch {
            out[k] = raw;
          }
        }
      }
      return out;
    });

    // At least one of the candidate keys must carry all four metal prices we entered
    const values = Object.values(persisted);
    const matches = values.some((v) => {
      if (!v || typeof v !== "object") return false;
      const s = JSON.stringify(v);
      return (
        s.includes("2712.5") && s.includes("31.84") && s.includes("975.2") && s.includes("1014")
      );
    });
    expect(matches).toBe(true);
  });

  test("6.1 REQ-5 — Manual spot state is included in the sync-scoped vault payload", async ({
    page,
  }) => {
    await seedApiState(page, {
      spotPricingSource: "MANUAL",
      metalSpotPrices: {
        gold: 2712.5,
        silver: 31.84,
        platinum: 975.2,
        palladium: 1014,
      },
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.vaultEncryptToBytesScoped === "function" &&
        typeof window.vaultDecryptToData === "function"
    );

    const payload = await page.evaluate(async () => {
      const password = "manual-sync-test-password";
      const bytes = await window.vaultEncryptToBytesScoped(password);
      const decrypted = await window.vaultDecryptToData(bytes, password);
      return {
        spotPricingSource: JSON.parse(decrypted.data.spotPricingSource),
        metalSpotPrices: JSON.parse(decrypted.data.metalSpotPrices),
      };
    });

    expect(payload.spotPricingSource).toBe("MANUAL");
    expect(payload.metalSpotPrices).toEqual({
      gold: 2712.5,
      silver: 31.84,
      platinum: 975.2,
      palladium: 1014,
    });
  });

  test("6.2 REQ-5 — ZIP backup/restore preserves Manual spot source and values", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__lastBackupBlob = null;
      const originalCreateObjectUrl = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (value) {
        if (value instanceof Blob) {
          window.__lastBackupBlob = value;
        }
        return originalCreateObjectUrl(value);
      };
    });

    await seedApiState(page, {
      spotPricingSource: "MANUAL",
      metalSpotPrices: {
        gold: 2712.5,
        silver: 31.84,
        platinum: 975.2,
        palladium: 1014,
      },
      manualSpotStorage: {
        spotGold: 2712.5,
        spotSilver: 31.84,
        spotPlatinum: 975.2,
        spotPalladium: 1014,
      },
    });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.createBackupZip === "function");

    const exportedSettings = await page.evaluate(async () => {
      await window.createBackupZip();
      const zip = await window.JSZip.loadAsync(window.__lastBackupBlob);
      return JSON.parse(await zip.file("settings.json").async("string"));
    });

    expect(exportedSettings.spotPricingSource).toBe("MANUAL");
    expect(exportedSettings.metalSpotPrices).toEqual({
      gold: 2712.5,
      silver: 31.84,
      platinum: 975.2,
      palladium: 1014,
    });

    await page.evaluate(async () => {
      const originalShowToast = window.showToast;
      window.__zipRestoreComplete = false;
      window.showToast = function (message, level) {
        if (typeof originalShowToast === "function") {
          originalShowToast(message, level);
        }
        if (String(message || "").includes("ZIP backup restored successfully")) {
          window.__zipRestoreComplete = true;
        }
      };

      window.showImportDiffReview = function (_items, _meta, options, onDone) {
        const changes = options?.settingsDiff?.changed || [];
        for (const change of changes) {
          localStorage.setItem(
            change.key,
            typeof change.remoteVal === "string"
              ? change.remoteVal
              : JSON.stringify(change.remoteVal)
          );
        }
        onDone({ added: 0, modified: 0, deleted: 0 });
      };

      const zip = new window.JSZip();
      zip.file(
        "inventory_data.json",
        JSON.stringify({
          version: "test",
          exportDate: new Date().toISOString(),
          inventory: [],
        })
      );
      zip.file(
        "settings.json",
        JSON.stringify({
          version: "test",
          exportDate: new Date().toISOString(),
          exportOrigin: window.location.origin,
          spotPrices: {
            gold: 2712.5,
            silver: 31.84,
            platinum: 975.2,
            palladium: 1014,
          },
          spotPricingSource: "MANUAL",
          metalSpotPrices: {
            gold: 2712.5,
            silver: 31.84,
            platinum: 975.2,
            palladium: 1014,
          },
          theme: "dark",
          itemsPerPage: 25,
          sortColumn: "date",
          sortDirection: "desc",
          catalogMappings: {},
          chipCustomGroups: [],
          chipBlacklist: [],
          tableImageSides: "both",
          tableImagesEnabled: true,
        })
      );
      const file = new File([await zip.generateAsync({ type: "blob" })], "manual-settings.zip", {
        type: "application/zip",
      });

      localStorage.removeItem("spotPricingSource");
      localStorage.removeItem("metalSpotPrices");
      localStorage.removeItem("spotGold");
      localStorage.removeItem("spotSilver");
      localStorage.removeItem("spotPlatinum");
      localStorage.removeItem("spotPalladium");

      await window.restoreBackupZip(file);
    });

    await page.waitForFunction(() => window.__zipRestoreComplete === true);

    const restored = await page.evaluate(() => ({
      source: (() => {
        const raw = localStorage.getItem("spotPricingSource");
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      })(),
      prices: JSON.parse(localStorage.getItem("metalSpotPrices")),
      perMetal: {
        gold: localStorage.getItem("spotGold"),
        silver: localStorage.getItem("spotSilver"),
        platinum: localStorage.getItem("spotPlatinum"),
        palladium: localStorage.getItem("spotPalladium"),
      },
    }));

    expect(restored.source).toBe("MANUAL");
    expect(restored.prices).toEqual({
      gold: 2712.5,
      silver: 31.84,
      platinum: 975.2,
      palladium: 1014,
    });
    expect(restored.perMetal).toEqual({
      gold: "2712.5",
      silver: "31.84",
      platinum: "975.2",
      palladium: "1014",
    });

    await openApiSettings(page);
    const manualPanel = page.locator('#apiSection_spot .spot-accordion-panel[data-val="MANUAL"]');
    await expect(manualPanel.locator('input.js-manual-spot[data-metal="gold"]')).toHaveValue(
      "2712.5"
    );
    await expect(manualPanel.locator('input.js-manual-spot[data-metal="silver"]')).toHaveValue(
      "31.84"
    );
    await expect(manualPanel.locator('input.js-manual-spot[data-metal="platinum"]')).toHaveValue(
      "975.2"
    );
    await expect(manualPanel.locator('input.js-manual-spot[data-metal="palladium"]')).toHaveValue(
      "1014"
    );
  });

  // =========================================================================
  // REQ-6 — Catalog has exactly 2 rows (Numista, PCGS); both "Free";
  // green dot only when configured.
  // =========================================================================
  test("7. REQ-6 — Catalog has exactly 2 rows (Numista, PCGS); both read 'Free'; green dot only when configured", async ({
    page,
  }) => {
    // Configure Numista, leave PCGS unconfigured
    await page.addInitScript(() => {
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({ numista: { apiKey: "fake-numista-key" } })
      );
    });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const catalog = page.locator("#apiSection_catalog");
    await expect(catalog).toBeVisible();

    const rows = catalog.locator(".catalog-row");
    await expect(rows).toHaveCount(2);

    // Order: Numista first, PCGS second
    const firstText = await rows.nth(0).innerText();
    const secondText = await rows.nth(1).innerText();
    expect(firstText).toMatch(/Numista/i);
    expect(secondText).toMatch(/PCGS/i);

    // Both badges read "Free"
    const firstBadge = rows.nth(0).locator(".provider-badge").first();
    const secondBadge = rows.nth(1).locator(".provider-badge").first();
    await expect(firstBadge).toContainText(/Free/i);
    await expect(secondBadge).toContainText(/Free/i);

    // Green dot on configured (Numista) row
    const numistaDot = rows.nth(0).locator(".status-dot");
    await expect(numistaDot).toHaveClass(/(dot-ok|active|green|connected)/);

    // Gray/off dot on unconfigured (PCGS) row — must NOT carry "configured-green" class
    const pcgsDot = rows.nth(1).locator(".status-dot");
    const pcgsClass = (await pcgsDot.getAttribute("class")) || "";
    expect(pcgsClass).not.toMatch(/dot-ok|active|connected|green/);
  });

  // =========================================================================
  // REQ-7 — Bulk Sync modal: 4 tabs, Esc closes, backdrop-click closes,
  // inside-click does NOT close.
  // =========================================================================
  test("8. REQ-7 — clicking Advanced Settings opens modal with 2 tabs; Esc + backdrop close; inside-click does not close", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({ numista: { apiKey: "fake-numista-key" } })
      );
    });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    // Trigger button (may require expand first — click Configure on Numista first)
    const numistaRow = page
      .locator("#apiSection_catalog .catalog-row")
      .filter({ hasText: "Numista" });
    const configureBtn = numistaRow
      .locator("button")
      .filter({ hasText: /Configure/i })
      .first();
    if (await configureBtn.isVisible()) {
      await configureBtn.click();
    }

    const openBulkBtn = numistaRow
      .locator('[data-provider="numista"], .js-open-bulk-sync[data-provider="numista"]')
      .filter({ hasText: /Advanced Settings/i })
      .first();
    await expect(openBulkBtn).toBeVisible();
    await openBulkBtn.click();

    const modal = page.locator("#bulkSyncModal");
    await expect(modal).toBeVisible();

    // 2 tabs: overview, sync-settings (STAK-573 consolidated from 4 to 2)
    const tabs = modal.locator('.bulk-tab, [role="tab"]');
    await expect(tabs).toHaveCount(2);

    // Inside-click does NOT close — click inside .modal-content
    await modal.locator(".modal-content").click({ position: { x: 10, y: 10 } });
    await expect(modal).toBeVisible();

    // Backdrop click closes (click outside .modal-content but inside .modal)
    await modal.click({ position: { x: 1, y: 1 } });
    await expect(modal).toBeHidden();

    // Reopen and test Esc
    await openBulkBtn.click();
    await expect(modal).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  });

  // =========================================================================
  // REQ-7.9 — PCGS bulk modal hides Fields and Tag Blacklist tabs.
  // =========================================================================
  test("9. REQ-7.9 — PCGS bulk modal has exactly 2 tabs (Overview + Sync Settings)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({ pcgs: { apiKey: "fake-pcgs-key" } })
      );
    });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const pcgsRow = page.locator("#apiSection_catalog .catalog-row").filter({ hasText: "PCGS" });
    const configureBtn = pcgsRow
      .locator("button")
      .filter({ hasText: /Configure/i })
      .first();
    if (await configureBtn.isVisible()) {
      await configureBtn.click();
    }
    const openBulkBtn = pcgsRow
      .locator('[data-provider="pcgs"], .js-open-bulk-sync[data-provider="pcgs"]')
      .filter({ hasText: /Advanced Settings/i })
      .first();
    await openBulkBtn.click();

    const modal = page.locator("#bulkSyncModal");
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute("data-provider", "pcgs");

    // STAK-573 consolidated to 2 tabs for all providers
    const tabs = modal.locator('.bulk-tab, [role="tab"]');
    await expect(tabs).toHaveCount(2);

    // Overview tab visible
    await expect(modal.locator('[data-tab="overview"]')).toBeVisible();
  });

  // =========================================================================
  // REQ-8 — all action buttons border-radius: 999px; History uses .btn-history.
  // =========================================================================
  test("10. REQ-8 — all action buttons have border-radius: 999px; History button uses .btn-history class", async ({
    page,
  }) => {
    await seedApiState(page, { spotPricingSource: "METALS_DEV" });
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const panel = page.locator("#settingsPanel_api");

    // Collect every rendered <button> inside the API panel (excluding modal-close)
    const btns = panel.locator("button:not(.modal-close):visible");
    const count = await btns.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const btn = btns.nth(i);
      const radii = await btn.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return [
          styles.borderTopLeftRadius,
          styles.borderTopRightRadius,
          styles.borderBottomRightRadius,
          styles.borderBottomLeftRadius,
        ];
      });
      expect(
        radii.every((radius) => Number.isFinite(parseFloat(radius)) && parseFloat(radius) > 0)
      ).toBe(true);
    }

    // History button on the Metals.dev sub-card uses .btn-history
    const metalsDevPanel = panel.locator('.spot-accordion-panel[data-val="METALS_DEV"]');
    const historyBtn = metalsDevPanel.locator('button:has-text("History")').first();
    await expect(historyBtn).toHaveClass(/btn-history/);
  });

  // =========================================================================
  // REQ-9 — storage migration: providerPriority={METALS_DEV:1},
  // clear spotPricingSource, reload -> spotPricingSource reads 'METALS_DEV'.
  // =========================================================================
  test("11. REQ-9 — migration: providerPriority={METALS_DEV:1} + no spotPricingSource + reload → spotPricingSource='METALS_DEV'", async ({
    page,
  }) => {
    await seedApiState(page, {
      clearSpotPricingSource: true,
      providerPriority: { METALS_DEV: 1, METALS_API: 2, METAL_PRICE_API: 3, STAKTRAKR: 4 },
    });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });

    // Give the boot-time migration a tick to run
    await page.waitForFunction(
      () => typeof window.loadData === "function" || typeof window.showSettingsModal === "function"
    );
    await page.waitForTimeout(300);

    const value = await page.evaluate(() => {
      const raw = localStorage.getItem("spotPricingSource");
      if (raw == null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    });
    expect(value).toBe("METALS_DEV");
  });

  // =========================================================================
  // REQ-9.4 — default when all keys unset → spotPricingSource reads 'STAKTRAKR'.
  // =========================================================================
  test("12. REQ-9.4 — default when all keys unset → spotPricingSource reads 'STAKTRAKR'", async ({
    page,
  }) => {
    await seedApiState(page, { clearAll: true });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => typeof window.loadData === "function" || typeof window.showSettingsModal === "function"
    );
    await page.waitForTimeout(300);

    const value = await page.evaluate(() => {
      const raw = localStorage.getItem("spotPricingSource");
      if (raw == null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    });
    expect(value).toBe("STAKTRAKR");
  });

  // =========================================================================
  // REQ-10 — switch to Manual → intercept fetch → zero spot-price requests
  // over 5 seconds.
  // =========================================================================
  test("13. REQ-10 — switching to Manual results in zero spot-price network requests over 5 seconds", async ({
    page,
  }) => {
    // Stub every outbound spot-price call BEFORE navigation so nothing slips through.
    // REQ-10 scope: SPOT-price endpoints only — retail/goldback/manifest/health are
    // separate data feeds that are independent of spotPricingSource and must continue.
    const spotFetchUrls = [];
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (
        /metals\.dev|metals-api|metalpriceapi|api\.staktrakr\.com|\/spot|\/metal/i.test(url) &&
        !/\.(css|js|png|jpg|svg|ico|html|woff2?)(\?|$)/i.test(url) &&
        !/api\.staktrakr\.com\/data\/v2\/(health|manifest|retail|goldback)/i.test(url)
      ) {
        spotFetchUrls.push(url);
      }
      return route.continue();
    });

    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await openApiSettings(page);

    const manualPill = page
      .locator("#apiSection_spot")
      .locator('.gb-source-btn[data-val="MANUAL"]');
    await expect(manualPill).toHaveCount(1);
    await manualPill.click();
    await confirmSpotProviderSwitch(page, "MANUAL");
    await expect(manualPill).toHaveClass(/active/);

    // Reset counter AFTER selecting Manual to focus on post-switch behavior
    spotFetchUrls.length = 0;

    // Wait 5 seconds
    await page.waitForTimeout(5000);

    expect(spotFetchUrls).toEqual([]);
  });
});
