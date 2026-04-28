import { test, expect } from "@playwright/test";

/**
 * fix/catalog-api-settings — Catalog API key toggle and legacy format migration.
 *
 * Covers:
 *   CA-1  CatalogConfig.load maps legacy pcgs.apiKey → pcgs.bearerToken
 *   CA-2  Numista key is decrypted and shown when toggling visibility on
 *   CA-3  PCGS token is decrypted and shown when toggling visibility on
 *   CA-4  Toggling visibility off re-masks the input
 *   CA-5  handleCatalogTest reloads config from localStorage before execution
 *   CA-6  Visibility toggle preserves value when field is dirty
 */

const NUMISTA_KEY = "my-numista-key-2026"; // gitleaks:allow
const PCGS_TOKEN = "my-pcgs-token-2026"; // gitleaks:allow
const MASK = "••••••••";

function seedCatalogConfig(page) {
  return page.addInitScript(
    ({ numistaKey, pcgsToken }) => {
      localStorage.setItem(
        "catalog_api_config",
        JSON.stringify({
          numista: { apiKey: btoa(numistaKey), quota: 2000 },
          numistaUsage: { used: 0, month: "2026-04" },
          pcgs: { bearerToken: btoa(pcgsToken) },
          pcgsUsage: { used: 0, date: "2026-04-28" },
          local: { enabled: true },
        })
      );
      localStorage.setItem("ackVersion", "9.9.9");
    },
    { numistaKey: NUMISTA_KEY, pcgsToken: PCGS_TOKEN }
  );
}

async function openApiCatalog(page) {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal("api"));
  await expect(page.locator("#settingsModal")).toBeVisible();
  // Wait for catalog rows (populated by populateApiSection inside showSettingsModal)
  await page.waitForSelector('.catalog-row[data-provider="numista"]', { timeout: 5000 });
  // wireCatalogActions() is called in a 200ms setTimeout (init.js Phase 14).
  // Explicitly re-run wiring after the modal is open so the delegated listeners
  // are guaranteed to be bound to the real #apiSection_catalog element, whether
  // or not the init setTimeout has already fired.
  await page.evaluate(() => {
    if (typeof window.setupSettingsEventListeners === "function") {
      window.setupSettingsEventListeners();
    }
  });
}

async function expandCatalogRow(page, provider) {
  // The expand panel is CSS-controlled via max-height (not display:none).
  // Add the `open` class and also override the inline styles so Playwright
  // sees a non-zero bounding box without waiting for the CSS transition.
  await page.evaluate((p) => {
    const row = document.querySelector(`.catalog-row[data-provider="${p}"]`);
    if (!row) return;
    row.classList.add("open");
    const expand = row.querySelector(".catalog-row-expand");
    if (expand) {
      // _buildCatalogRow initialises expand.style.display = "none" inline.
      // Clearing it lets the CSS `max-height` approach take over; also
      // override max-height/overflow directly so Playwright sees a non-zero
      // bounding box without waiting for the 0.2s CSS transition.
      expand.style.display = "";
      expand.style.maxHeight = "none";
      expand.style.overflow = "visible";
    }
  }, provider);
  await expect(
    page.locator(`.catalog-row[data-provider="${provider}"] .catalog-row-expand`)
  ).toBeVisible({ timeout: 3000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// CA-1: Legacy key migration
// ─────────────────────────────────────────────────────────────────────────────

test("CA-1 — CatalogConfig.load maps legacy pcgs.apiKey to pcgs.bearerToken and deletes the old key", async ({
  page,
}) => {
  // Use a complete valid config at page-load time so initialization succeeds,
  // then replace localStorage with the legacy format and call load() explicitly.
  await seedCatalogConfig(page);
  await page.goto("/index.html", { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.catalogConfig !== "undefined");

  const result = await page.evaluate(() => {
    // Overwrite with legacy format that uses apiKey instead of bearerToken
    localStorage.setItem(
      "catalog_api_config",
      JSON.stringify({ pcgs: { apiKey: btoa("legacy-pcgs-token") } })
    );
    window.catalogConfig.load();
    const pcgs = window.catalogConfig.config.pcgs;
    return {
      bearerToken: pcgs.bearerToken,
      hasApiKey: "apiKey" in pcgs,
    };
  });

  expect(result.bearerToken).toBe("legacy-pcgs-token");
  expect(result.hasApiKey).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// CA-2 / CA-3: Toggle-on reveals decrypted key
// ─────────────────────────────────────────────────────────────────────────────

test("CA-2 — Numista API key decrypts and displays when toggling visibility on", async ({
  page,
}) => {
  await seedCatalogConfig(page);
  await page.goto("/index.html", { waitUntil: "load" });
  await openApiCatalog(page);
  await expandCatalogRow(page, "numista");

  const input = page.locator('.catalog-row[data-provider="numista"] .js-api-key-input');
  const toggle = page.locator(
    '.catalog-row[data-provider="numista"] .catalog-row-expand .js-toggle-password'
  );

  await expect(input).toHaveValue(MASK);
  await expect(input).toHaveAttribute("type", "password");

  await toggle.click();

  await expect(input).toHaveAttribute("type", "text");
  await expect(input).toHaveValue(NUMISTA_KEY);
});

test("CA-3 — PCGS bearer token decrypts and displays when toggling visibility on", async ({
  page,
}) => {
  await seedCatalogConfig(page);
  await page.goto("/index.html", { waitUntil: "load" });
  await openApiCatalog(page);
  await expandCatalogRow(page, "pcgs");

  const input = page.locator('.catalog-row[data-provider="pcgs"] .js-api-key-input');
  const toggle = page.locator(
    '.catalog-row[data-provider="pcgs"] .catalog-row-expand .js-toggle-password'
  );

  await expect(input).toHaveValue(MASK);
  await expect(input).toHaveAttribute("type", "password");

  await toggle.click();

  await expect(input).toHaveAttribute("type", "text");
  await expect(input).toHaveValue(PCGS_TOKEN);
});

// ─────────────────────────────────────────────────────────────────────────────
// CA-4: Toggle-off re-masks
// ─────────────────────────────────────────────────────────────────────────────

test("CA-4 — toggling visibility off replaces the visible key with the mask string", async ({
  page,
}) => {
  await seedCatalogConfig(page);
  await page.goto("/index.html", { waitUntil: "load" });
  await openApiCatalog(page);
  await expandCatalogRow(page, "numista");

  const input = page.locator('.catalog-row[data-provider="numista"] .js-api-key-input');
  const toggle = page.locator(
    '.catalog-row[data-provider="numista"] .catalog-row-expand .js-toggle-password'
  );

  await toggle.click();
  await expect(input).toHaveValue(NUMISTA_KEY);

  await toggle.click();
  await expect(input).toHaveValue(MASK);
  await expect(input).toHaveAttribute("type", "password");
});

// ─────────────────────────────────────────────────────────────────────────────
// CA-5: handleCatalogTest reloads config before execution
// ─────────────────────────────────────────────────────────────────────────────

test("CA-5 — handleCatalogTest reloads config from localStorage before execution", async ({
  page,
}) => {
  await seedCatalogConfig(page);
  await page.goto("/index.html", { waitUntil: "load" });
  await openApiCatalog(page);
  await expandCatalogRow(page, "numista");

  const freshKey = "fresh-key-injected-after-load";
  await page.evaluate((key) => {
    // Overwrite localStorage with a key different from what was seeded at load time
    const parsed = JSON.parse(localStorage.getItem("catalog_api_config"));
    parsed.numista.apiKey = btoa(key);
    localStorage.setItem("catalog_api_config", JSON.stringify(parsed));

    // Stub testNumistaAPI to capture what catalogConfig holds at call time
    window.__testCapturedKey = undefined;
    window.testNumistaAPI = async () => {
      window.__testCapturedKey = window.catalogConfig.getNumistaConfig().apiKey;
      return true;
    };
  }, freshKey);

  await page.locator('.catalog-row[data-provider="numista"] .js-catalog-test').click();
  await page.waitForFunction(() => window.__testCapturedKey !== undefined, { timeout: 5000 });

  const capturedKey = await page.evaluate(() => window.__testCapturedKey);
  expect(capturedKey).toBe(freshKey);
});

// ─────────────────────────────────────────────────────────────────────────────
// CA-6: Dirty field value preserved through toggle
// ─────────────────────────────────────────────────────────────────────────────

test("CA-6 — visibility toggle preserves the input value when the field is marked as dirty", async ({
  page,
}) => {
  await seedCatalogConfig(page);
  await page.goto("/index.html", { waitUntil: "load" });
  await openApiCatalog(page);
  await expandCatalogRow(page, "numista");

  const input = page.locator('.catalog-row[data-provider="numista"] .js-api-key-input');
  const toggle = page.locator(
    '.catalog-row[data-provider="numista"] .catalog-row-expand .js-toggle-password'
  );

  // Typing into the masked field triggers the input handler which clears
  // `data-masked` and sets `data-dirty=true`, protecting the value from toggle logic.
  await input.click();
  await input.fill("new-user-typed-key");

  // Toggle on: value must survive (not replaced by mask or decrypted key)
  await toggle.click();
  await expect(input).toHaveAttribute("type", "text");
  await expect(input).toHaveValue("new-user-typed-key");

  // Toggle off: value must still survive
  await toggle.click();
  await expect(input).toHaveAttribute("type", "password");
  await expect(input).toHaveValue("new-user-typed-key");
});
