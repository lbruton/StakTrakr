import { test, expect } from "../helpers/mocks/extended-test.js";

const ITEM_UUID = "core-numista-catalog-item";
const CATALOG_ID = "571841";
const QUOTED_TITLE = '1 Dollar "American Silver Eagle" New Reverse';

const BASE_ITEM = {
  uuid: ITEM_UUID,
  metal: "Silver",
  composition: "Silver",
  name: "Core Numista Fixture",
  qty: 1,
  type: "Coin",
  weight: 31.1,
  weightUnit: "g",
  price: 40,
  marketValue: 0,
  date: "2026-05-26",
  purchaseLocation: "StakTrakr",
  storageLocation: "Safe",
  serialNumber: "",
  notes: "",
  year: "2024",
  grade: "",
  gradingAuthority: "",
  certNumber: "",
  pcgsNumber: "",
  pcgsVerified: false,
  spotPriceAtPurchase: 32,
  premiumPerOz: 0,
  totalPremium: 0,
  purity: 0.999,
  numistaId: CATALOG_ID,
  serial: 1,
};

const NUMISTA_RESULT = {
  name: "1 Dollar American Silver Eagle",
  catalogId: CATALOG_ID,
  country: "United States",
  denomination: "1 Dollar",
  year: "2024",
  metal: "Silver",
  type: "Coin",
  weight: 31.1,
  diameter: 40.6,
  thickness: 2.98,
  shape: "Round",
  composition: "Silver",
  orientation: "Coin alignment",
  technique: "Milled",
  kmReferences: [{ catalogue: "KM", number: "274" }],
  mintageByYear: [{ year: "2024", mintage: 1000000, remark: "test cache" }],
  obverseDesc: "Cache obverse",
  reverseDesc: "Cache reverse",
  edgeDesc: "Cache edge",
  tags: ["Bullion", "Eagle", "Investment"],
};

async function seedData(page, opts = {}) {
  const {
    inventory = [BASE_ITEM],
    itemTags = {},
    itemRemovedTags = null,
    tagBlacklist = [],
    numistaTagsAuto = true,
    catalogConfigured = true,
  } = opts;

  await page.addInitScript(
    ({ inv, tags, removedTags, blacklist, tagsAuto, configured }) => {
      localStorage.setItem("metalInventory", JSON.stringify(inv));
      localStorage.setItem("itemTags", JSON.stringify(tags));
      localStorage.setItem("numistaViewFields", JSON.stringify({}));
      localStorage.setItem("numista_tags_auto", JSON.stringify(tagsAuto));
      if (removedTags !== null) {
        localStorage.setItem("itemRemovedTags", JSON.stringify(removedTags));
      }
      if (blacklist.length > 0) {
        localStorage.setItem("tagBlacklist", JSON.stringify(blacklist));
      }
      if (configured) {
        localStorage.setItem(
          "catalog_api_config",
          JSON.stringify({ numista: { apiKey: btoa("fake-test-key"), quota: 2000 } })
        );
      } else {
        localStorage.removeItem("catalog_api_config");
      }
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (typeof APP_VERSION !== "undefined") localStorage.setItem("ackVersion", APP_VERSION);
        },
        { once: true }
      );
    },
    {
      inv: inventory,
      tags: itemTags,
      removedTags: itemRemovedTags,
      blacklist: tagBlacklist,
      tagsAuto: numistaTagsAuto,
      configured: catalogConfigured,
    }
  );
}

async function stubCatalogLookup(page, result = NUMISTA_RESULT) {
  await page.addInitScript((lookupResult) => {
    const installStub = (api) => {
      if (!api || typeof api !== "object") return;
      api.lookupItem = async () => ({ ...lookupResult });
      api.searchItems = async () => [{ ...lookupResult }];
      if (!api.activeProvider) api.activeProvider = { name: "numista" };
    };

    let currentCatalogApi;
    Object.defineProperty(window, "catalogAPI", {
      configurable: true,
      get() {
        return currentCatalogApi;
      },
      set(value) {
        currentCatalogApi = value;
        installStub(value);
      },
    });

    document.addEventListener("DOMContentLoaded", () => installStub(window.catalogAPI), {
      once: true,
    });
  }, result);
}

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.editItem === "function" &&
      typeof window.showViewModal === "function" &&
      typeof window.showNumistaResults === "function" &&
      Array.isArray(window.inventory)
  );
  await page.evaluate(async () => {
    if (window.imageCache?.init) await window.imageCache.init();
  });
}

async function openEditForm(page, index = 0) {
  await page.evaluate((idx) => window.editItem(idx), index);
  await expect(page.locator("#itemModal")).toBeVisible();
}

async function openViewModal(page, index = 0) {
  await page.evaluate((idx) => window.showViewModal(idx), index);
  await expect(page.locator("#viewItemModal")).toBeVisible();
}

async function openNumistaPicker(page, result = NUMISTA_RESULT) {
  await page.evaluate((r) => window.showNumistaResults([r], true, ""), result);
  await expect(page.locator("#numistaResultsModal")).toBeVisible();
  await expect(page.locator("#numistaFieldPicker")).toBeVisible();
}

async function cacheMetadata(page, catalogId, result, cachedAt = Date.now()) {
  await page.evaluate(
    async ({ id, metadata, timestamp }) => {
      await window.imageCache.init();
      await window.imageCache.cacheMetadata(id, { ...metadata, catalogId: id });
      const record = await window.imageCache.getMetadata(id);
      await window.imageCache.importMetadataRecord({ ...record, cachedAt: timestamp });
    },
    { id: catalogId, metadata: result, timestamp: cachedAt }
  );
}

function catalogSection(page) {
  return page.locator(".view-numista-section");
}

function detailItem(page, label) {
  return catalogSection(page).locator(".view-detail-item").filter({ hasText: label }).first();
}

test.describe("core/numista-catalog", () => {
  test("unconfigured Numista search shows disconnected state and opens API settings", async ({
    page,
  }) => {
    await seedData(page, { catalogConfigured: false });
    await gotoApp(page);
    await openEditForm(page);

    const state = await page.evaluate(() => {
      window.updateNumistaModalDot?.();
      const btn = document.getElementById("searchNumistaBtn");
      const nameBtn = document.getElementById("searchNumistaNameBtn");
      return {
        dotClasses: btn?.querySelector(".numista-modal-status-dot")?.className || "",
        btnTitle: btn?.getAttribute("title") || "",
        nameBtnTitle: nameBtn?.getAttribute("title") || "",
      };
    });
    expect(state.dotClasses.split(/\s+/)).toContain("disconnected");
    expect(state.btnTitle).toContain("not configured");
    expect(state.nameBtnTitle).toContain("not configured");

    await page.fill("#itemName", "American Silver Eagle");
    await page.click("#searchNumistaNameBtn");
    await expect(page.locator("#appDialogModal")).toBeVisible();
    await expect(page.locator("#appDialogTitle")).toContainText(/not configured/i);
    await expect(page.locator("#appDialogMessage")).toContainText(/Numista/i);
    await expect(page.locator("#appDialogMessage")).not.toContainText(/Enter a Name/i);
    await page.click("#appDialogOk");
    await expect(page.locator("#settingsModal")).toBeVisible();
    await expect(page.locator("#settingsPanel_api")).toBeVisible();
  });

  test("configured search builds raw and rewritten queries without prepending metal", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [],
    });
    await page.addInitScript(() => {
      localStorage.setItem(
        "numistaLookupRules",
        JSON.stringify([
          {
            id: "test-rule-phil",
            pattern: "Austrian Philharmonic",
            replacement: "Philharmonic rewritten",
            numistaId: null,
            builtIn: false,
          },
        ])
      );
    });
    await gotoApp(page);

    const result = await page.evaluate(() => {
      const direct = window.buildNumistaSearchQuery("Canadian Maple Leaf", "Gold");
      const matched = window.buildNumistaSearchQuery("Austrian Philharmonic", "Gold");
      return {
        directQuery: direct.query,
        directMatched: direct.matched,
        matched: matched.matched,
        rewrittenQuery: matched.query,
      };
    });

    expect(result.directQuery).toBe("Canadian Maple Leaf");
    expect(result.directMatched).toBe(false);
    expect(result.matched).toBe(true);
    expect(result.rewrittenQuery).toBe("Philharmonic rewritten");
  });

  test("tag input delimiters split consistently in edit and view modals", async ({ page }) => {
    await seedData(page);
    await gotoApp(page);
    await openEditForm(page);

    // STRK-301: Tags is a collapsed <details> when the item has none — open
    // it the way a user would before typing into the tag input.
    await page.locator('details.form-section[data-section="tags"] > summary').click();

    await page.fill("#newTagInput", "Bullion, Eagle; Proof,,");
    await page.click("#addTagBtn");
    const editTags = await page.evaluate((uuid) => window.getItemTags(uuid), ITEM_UUID);
    expect(editTags).toEqual(expect.arrayContaining(["Bullion", "Eagle", "Proof"]));
    await expect(page.locator("#itemModalTagsChips .tag-chip")).toHaveCount(3);

    await page.evaluate(() => window.closeModal?.());
    await openViewModal(page);
    await page.locator("#viewTagsSection .tag-add-btn").click();
    const tagInput = page.locator("#viewTagsSection .tag-input");
    await tagInput.fill("Maple, Leaf; RCM");
    await tagInput.press("Enter");
    await expect(tagInput).toBeHidden();

    const viewTags = await page.evaluate((uuid) => window.getItemTags(uuid), ITEM_UUID);
    expect(viewTags).toEqual(
      expect.arrayContaining(["Bullion", "Eagle", "Proof", "Maple", "Leaf", "RCM"])
    );
  });

  test("picker tag checkboxes respect blacklist, existing tags, auto setting, and fill selection", async ({
    page,
  }) => {
    await seedData(page, {
      itemTags: { [ITEM_UUID]: ["Bullion"] },
      itemRemovedTags: { [ITEM_UUID]: ["Eagle"] },
      tagBlacklist: ["Investment"],
      numistaTagsAuto: false,
    });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openEditForm(page);
    await openNumistaPicker(page);

    const bullionCb = page.locator('input[name="numistaTag"][data-tag="Bullion"]');
    const eagleCb = page.locator('input[name="numistaTag"][data-tag="Eagle"]');
    const investmentCb = page.locator('input[name="numistaTag"][data-tag="Investment"]');
    await expect(bullionCb).toBeChecked();
    await expect(bullionCb).toHaveAttribute("data-on-item", "1");
    await expect(eagleCb).not.toBeChecked();
    await expect(investmentCb).not.toBeChecked();
    await expect(page.locator('label:has(input[data-tag="Investment"])')).toContainText(
      "blacklisted"
    );

    await eagleCb.check({ force: true });
    await page.locator("#numistaFillBtn").click();
    await expect(page.locator("#numistaFieldPicker")).not.toBeVisible();

    const state = await page.evaluate(
      (uuid) => ({
        tags: window.getItemTags(uuid),
        removed: JSON.parse(localStorage.getItem("itemRemovedTags") || "{}"),
      }),
      ITEM_UUID
    );
    expect(state.tags).toEqual(expect.arrayContaining(["Bullion", "Eagle"]));
    expect(state.tags).not.toContain("Investment");
    expect(state.removed[ITEM_UUID] || []).not.toContain("Eagle");
  });

  test("itemRemovedTags sync surface is exported and diffed as settings data", async ({ page }) => {
    await seedData(page, {
      itemRemovedTags: { [ITEM_UUID]: ["Investment"] },
    });
    await gotoApp(page);

    const result = await page.evaluate((uuid) => {
      const allowed = Array.isArray(window.ALLOWED_STORAGE_KEYS)
        ? window.ALLOWED_STORAGE_KEYS.includes("itemRemovedTags")
        : window.ALLOWED_STORAGE_KEYS instanceof Set &&
          window.ALLOWED_STORAGE_KEYS.has("itemRemovedTags");
      const exportPayload = {
        itemRemovedTags: JSON.parse(localStorage.getItem("itemRemovedTags") || "{}"),
      };
      const diff = window.DiffEngine.compareSettings(
        { itemRemovedTags: JSON.stringify({ [uuid]: ["Bullion"] }) },
        { itemRemovedTags: JSON.stringify({ [uuid]: ["Bullion", "Investment"] }) }
      );
      return {
        allowed,
        exportedRemoved: exportPayload.itemRemovedTags[uuid],
        changedKeys: diff.changed.map((change) => change.key),
      };
    }, ITEM_UUID);

    expect(result.allowed).toBe(true);
    expect(result.exportedRemoved).toContain("Investment");
    expect(result.changedKeys).toContain("itemRemovedTags");
  });

  test("view modal does not auto-resync and renders quoted titles literally", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, name: QUOTED_TITLE }],
    });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await openViewModal(page);

    await expect(page.locator("#resyncPickerModal")).toHaveCount(0);
    await expect(page.locator("#viewModalTitle")).toHaveText(QUOTED_TITLE);
    const innerHtml = await page.locator("#viewModalTitle").evaluate((node) => node.innerHTML);
    expect(innerHtml).not.toContain("&quot;");
    expect(innerHtml).not.toContain("&amp;quot;");
    expect(pageErrors).toEqual([]);

    const exportedSymbols = await page.evaluate(() => ({
      showResyncPicker: window.showResyncPicker,
      applyPickerSelections: window.applyPickerSelections,
      initFieldMeta: typeof window.initFieldMeta,
      markUserModified: typeof window.markUserModified,
    }));
    expect(exportedSymbols.showResyncPicker).toBeUndefined();
    expect(exportedSymbols.applyPickerSelections).toBeUndefined();
    expect(exportedSymbols.initFieldMeta).toBe("function");
    expect(exportedSymbols.markUserModified).toBe("function");
  });

  test("view modal merges per-item Numista fields over cache and keeps shared catalog values isolated", async ({
    page,
  }) => {
    const items = [
      {
        ...BASE_ITEM,
        uuid: "shared-a",
        name: "Shared A",
        numistaData: { composition: "Silver (.9999)" },
      },
      {
        ...BASE_ITEM,
        uuid: "shared-b",
        name: "Shared B",
        numistaData: { composition: "Silver proof finish" },
      },
    ];
    await seedData(page, { inventory: items });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, CATALOG_ID, NUMISTA_RESULT);

    await openViewModal(page, 0);
    await expect(detailItem(page, "Composition")).toContainText("Silver (.9999)");
    await page.evaluate(() => window.closeViewModal?.());
    await expect(page.locator("#viewItemModal")).toBeHidden();

    await openViewModal(page, 1);
    await expect(detailItem(page, "Composition")).toContainText("Silver proof finish");
    await expect(detailItem(page, "Obverse")).toContainText("Cache obverse");
    await expect(detailItem(page, "Reverse")).toContainText("Cache reverse");
    await expect(detailItem(page, "Edge")).toContainText("Cache edge");
  });

  test("edit-save updates visible Numista metadata without stale cache values overriding item fields", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, numistaData: { diameter: "39", kmRef: "KM#274" } }],
    });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, CATALOG_ID, NUMISTA_RESULT);

    await openEditForm(page);
    await page.locator("#numistaDiameter").fill("40");
    await page.locator("#itemModalSubmit").click();
    await expect(page.locator("#itemModal")).toBeHidden();

    await openViewModal(page);
    await expect(detailItem(page, "Diameter")).toContainText("40 mm");
    await expect(detailItem(page, "KM Reference")).toContainText("KM#274");
    await expect(detailItem(page, "Composition")).toContainText("Silver");
  });

  test("cache-only legacy items render references and catalog tags do not duplicate tag chips", async ({
    page,
  }) => {
    await seedData(page, {
      inventory: [{ ...BASE_ITEM, numistaData: null }],
      itemTags: { [ITEM_UUID]: ["Bullion", "Eagle"] },
    });
    await stubCatalogLookup(page);
    await gotoApp(page);
    await cacheMetadata(page, CATALOG_ID, NUMISTA_RESULT);

    await openViewModal(page);

    await expect(detailItem(page, "Composition")).toContainText("Silver");
    await expect(detailItem(page, "References")).toContainText("KM#274");
    await expect(detailItem(page, "Mintage")).toContainText("2024: 1,000,000");
    await expect(
      catalogSection(page).locator(".view-detail-label", { hasText: "Tags" })
    ).toHaveCount(0);
    await expect(page.locator("#viewTagsSection .tag-chip")).toHaveCount(2);
  });
});
