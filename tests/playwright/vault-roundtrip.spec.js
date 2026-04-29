import { test, expect } from "@playwright/test";
import { injectSeedInventory } from "./helpers/seed.js";

const VAULT_PASSWORD = "test-pass-12345";

test.describe("Vault round-trip duplicate prevention (STRK-14)", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(
      () =>
        typeof window.vaultEncryptToBytes === "function" &&
        typeof window.vaultRestoreWithPreview === "function" &&
        typeof window.DiffEngine !== "undefined"
    );
  });

  test("R1-AC1,AC2,AC4: same-device round-trip shows no differences", async ({ page }) => {
    const result = await page.evaluate(async (password) => {
      const bytes = await window.vaultEncryptToBytes(password);

      let diffModalCalled = false;
      let capturedDiff = null;
      const origShow = window.DiffModal.show;
      window.DiffModal.show = (opts) => {
        diffModalCalled = true;
        capturedDiff = opts.diff;
      };

      let toastMsg = "";
      const origToast = window.showToast;
      window.showToast = (msg) => {
        toastMsg = msg;
      };

      await window.vaultRestoreWithPreview(bytes, password);

      window.DiffModal.show = origShow;
      window.showToast = origToast;

      return {
        diffModalCalled,
        added: capturedDiff ? capturedDiff.added.length : 0,
        modified: capturedDiff ? capturedDiff.modified.length : 0,
        deleted: capturedDiff ? capturedDiff.deleted.length : 0,
        toast: toastMsg,
      };
    }, VAULT_PASSWORD);

    expect(result.diffModalCalled).toBe(false);
    expect(result.toast).toContain("No differences found");
    expect(result.added).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.deleted).toBe(0);
  });

  test("R1-AC3: numistaId+date match when serial/uuid stripped", async ({ page }) => {
    const result = await page.evaluate(async (password) => {
      const raw = localStorage.getItem("metalInventory");
      const items = JSON.parse(raw);

      const strippedItems = items.map((item) => {
        const copy = Object.assign({}, item);
        delete copy.serial;
        delete copy.uuid;
        return copy;
      });
      localStorage.setItem("metalInventory", JSON.stringify(strippedItems));

      const bytes = await window.vaultEncryptToBytes(password);

      localStorage.setItem("metalInventory", raw);

      if (typeof window.loadInventory === "function") {
        window.loadInventory();
      }

      let diffModalCalled = false;
      let capturedDiff = null;
      const origShow = window.DiffModal.show;
      window.DiffModal.show = (opts) => {
        diffModalCalled = true;
        capturedDiff = opts.diff;
      };

      let toastMsg = "";
      const origToast = window.showToast;
      window.showToast = (msg) => {
        toastMsg = msg;
      };

      await window.vaultRestoreWithPreview(bytes, password);

      window.DiffModal.show = origShow;
      window.showToast = origToast;

      const itemsWithNumista = items.filter((i) => i.numistaId && i.numistaId !== "");

      return {
        diffModalCalled,
        added: capturedDiff ? capturedDiff.added.length : 0,
        deleted: capturedDiff ? capturedDiff.deleted.length : 0,
        unchanged: capturedDiff ? capturedDiff.unchanged.length : 0,
        toast: toastMsg,
        totalItems: items.length,
        itemsWithNumista: itemsWithNumista.length,
      };
    }, VAULT_PASSWORD);

    expect(result.added).toBe(0);
    expect(result.deleted).toBe(0);
  });

  test("R2-AC1,AC3: modified field + new item detected correctly", async ({ page }) => {
    const result = await page.evaluate(async (password) => {
      const raw = localStorage.getItem("metalInventory");
      const items = JSON.parse(raw);

      const modifiedItems = items.map((item) => Object.assign({}, item));
      modifiedItems[0].notes = "MODIFIED-BY-TEST";
      modifiedItems.push({
        metal: "Platinum",
        composition: "Platinum",
        name: "TEST-NEW-ITEM",
        qty: 1,
        type: "Coin",
        weight: 1,
        price: 999,
        marketValue: 0,
        date: "2026-01-01",
        purchaseLocation: "",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "2026",
        grade: "",
        gradingAuthority: "",
        certNumber: "",
        pcgsNumber: "",
        pcgsVerified: false,
        spotPriceAtPurchase: 0,
        premiumPerOz: 0,
        totalPremium: 0,
        purity: 0.9995,
        numistaId: "",
        serial: 99999,
      });

      localStorage.setItem("metalInventory", JSON.stringify(modifiedItems));

      const bytes = await window.vaultEncryptToBytes(password);

      localStorage.setItem("metalInventory", raw);

      if (typeof window.loadInventory === "function") {
        window.loadInventory();
      }

      let diffModalCalled = false;
      let capturedDiff = null;
      const origShow = window.DiffModal.show;
      window.DiffModal.show = (opts) => {
        diffModalCalled = true;
        capturedDiff = opts.diff;
      };

      const origToast = window.showToast;
      window.showToast = () => {};

      await window.vaultRestoreWithPreview(bytes, password);

      window.DiffModal.show = origShow;
      window.showToast = origToast;

      return {
        diffModalCalled,
        added: capturedDiff ? capturedDiff.added.length : 0,
        modified: capturedDiff ? capturedDiff.modified.length : 0,
        deleted: capturedDiff ? capturedDiff.deleted.length : 0,
      };
    }, VAULT_PASSWORD);

    expect(result.diffModalCalled).toBe(true);
    expect(result.added).toBe(1);
    expect(result.modified).toBe(1);
    expect(result.deleted).toBe(0);
  });

  test("R2-AC2: removed item detected as deleted", async ({ page }) => {
    const result = await page.evaluate(async (password) => {
      const raw = localStorage.getItem("metalInventory");
      const items = JSON.parse(raw);

      const fewerItems = items.slice(0, -1);
      localStorage.setItem("metalInventory", JSON.stringify(fewerItems));

      const bytes = await window.vaultEncryptToBytes(password);

      localStorage.setItem("metalInventory", raw);

      if (typeof window.loadInventory === "function") {
        window.loadInventory();
      }

      let diffModalCalled = false;
      let capturedDiff = null;
      const origShow = window.DiffModal.show;
      window.DiffModal.show = (opts) => {
        diffModalCalled = true;
        capturedDiff = opts.diff;
      };

      const origToast = window.showToast;
      window.showToast = () => {};

      await window.vaultRestoreWithPreview(bytes, password);

      window.DiffModal.show = origShow;
      window.showToast = origToast;

      return {
        diffModalCalled,
        added: capturedDiff ? capturedDiff.added.length : 0,
        deleted: capturedDiff ? capturedDiff.deleted.length : 0,
      };
    }, VAULT_PASSWORD);

    expect(result.diffModalCalled).toBe(true);
    expect(result.deleted).toBe(1);
    expect(result.added).toBe(0);
  });

  test("R3-AC2: unmatched item from another device shows as new", async ({ page }) => {
    const result = await page.evaluate(async (password) => {
      const raw = localStorage.getItem("metalInventory");
      const items = JSON.parse(raw);

      const crossDeviceItems = items.map((item) => Object.assign({}, item));
      crossDeviceItems.push({
        metal: "Silver",
        composition: "Silver",
        name: "CROSS-DEVICE-ONLY",
        qty: 1,
        type: "Bar",
        weight: 10,
        price: 350,
        marketValue: 0,
        date: "2026-03-15",
        purchaseLocation: "",
        storageLocation: "",
        serialNumber: "",
        notes: "",
        year: "",
        grade: "",
        gradingAuthority: "",
        certNumber: "",
        pcgsNumber: "",
        pcgsVerified: false,
        spotPriceAtPurchase: 0,
        premiumPerOz: 0,
        totalPremium: 0,
        purity: 0.999,
        numistaId: "",
      });

      localStorage.setItem("metalInventory", JSON.stringify(crossDeviceItems));

      const bytes = await window.vaultEncryptToBytes(password);

      localStorage.setItem("metalInventory", raw);

      if (typeof window.loadInventory === "function") {
        window.loadInventory();
      }

      let capturedDiff = null;
      const origShow = window.DiffModal.show;
      window.DiffModal.show = (opts) => {
        capturedDiff = opts.diff;
      };

      const origToast = window.showToast;
      window.showToast = () => {};

      await window.vaultRestoreWithPreview(bytes, password);

      window.DiffModal.show = origShow;
      window.showToast = origToast;

      return {
        added: capturedDiff ? capturedDiff.added.length : 0,
        unchanged: capturedDiff
          ? capturedDiff.unchanged.length
          : parseInt(localStorage.getItem("inventorySerial") || "0"),
      };
    }, VAULT_PASSWORD);

    expect(result.added).toBe(1);
    expect(result.unchanged).toBe(8);
  });
});
