// Settings › Cloud panel controls: disabled actions while disconnected, the
// auto-sync and attachment On/Off toggles, announced sync status, and the
// panel markup carrying no inline styles beyond runtime display toggles.
import { test, expect } from "../helpers/mocks/extended-test.js";
import { THEMES, applyTheme } from "../helpers/contrast.js";
import { collectInlineStyleOffenders } from "../helpers/inline-styles.js";

const ACTIONS = {
  "Sync Now": "#cloudSyncNowBtn",
  Backup: '#settingsPanel_cloud .cloud-backup-btn[data-provider="dropbox"]',
  Restore: '#settingsPanel_cloud .cloud-restore-btn[data-provider="dropbox"]',
};

/** Boot the app and wait until the cloud panel renderers exist. */
async function bootApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      window.appListenersReady === true &&
      typeof window.syncCloudUI === "function" &&
      typeof window.updateSyncStatusIndicator === "function"
  );
}

/**
 * Store a connected Dropbox token and vault password, then reopen Settings › Cloud.
 * The token expiry sits an hour out: cloudGetToken() clears a token inside its 60 s buffer.
 * @param {import('@playwright/test').Page} page - Booted app page.
 * @param {{syncEnabled?: boolean}} [opts] - Seed auto-sync as on.
 */
async function connectAndOpenCloud(page, { syncEnabled = false } = {}) {
  await page.evaluate((enabled) => {
    localStorage.setItem(
      "cloud_token_dropbox",
      JSON.stringify({ access_token: "panel-test-token", expires_at: Date.now() + 3_600_000 })
    );
    localStorage.setItem("cloud_vault_password", "panel-test-password"); // gitleaks:allow
    localStorage.setItem("cloud_dropbox_account_id", "dbid:panel-test");
    localStorage.setItem("cloud_sync_enabled", enabled ? "true" : "false");
    window.showSettingsModal("cloud");
  }, syncEnabled);
  await expect(page.locator("#settingsPanel_cloud")).toBeVisible();
}

/** Open Settings › Cloud with no Dropbox token stored. */
async function openCloudDisconnected(page) {
  await page.evaluate(() => window.showSettingsModal("cloud"));
  await expect(page.locator("#settingsPanel_cloud")).toBeVisible();
}

/**
 * Read the computed opacity and cursor of each action button.
 * @param {import('@playwright/test').Page} page - Page with the cloud panel open.
 * @returns {Promise<Object<string,{opacity:number,cursor:string}>>} Look per button name.
 */
const readActionLook = (page) =>
  page.evaluate((actions) => {
    const out = {};
    for (const [name, sel] of Object.entries(actions)) {
      const cs = getComputedStyle(document.querySelector(sel));
      out[name] = { opacity: Number(cs.opacity), cursor: cs.cursor };
    }
    return out;
  }, ACTIONS);

/**
 * Read which buttons of an On/Off toggle are active and pressed.
 * @param {import('@playwright/test').Page} page - Page with the toggle rendered.
 * @param {string} id - Toggle container id.
 * @returns {Promise<string[]>} One "<label>:<active>:<aria-pressed>" entry per button.
 */
const readToggle = (page, id) =>
  page
    .locator(`#${id} .chip-sort-btn`)
    .evaluateAll((btns) =>
      btns.map(
        (b) =>
          `${b.textContent.trim()}:${b.classList.contains("active")}:${b.getAttribute("aria-pressed")}`
      )
    );

test.describe("Settings › Cloud panel controls", () => {
  test("disconnected Sync Now, Backup and Restore are disabled and look disabled in every theme", async ({
    page,
  }) => {
    await bootApp(page);
    await openCloudDisconnected(page);

    for (const sel of Object.values(ACTIONS)) {
      await expect(page.locator(sel)).toBeDisabled();
    }
    await expect(page.locator("#cloudConnectHint")).toBeVisible();
    await expect(page.locator("#cloudConnectHint")).toHaveText("Connect Dropbox to back up.");

    // A disabled button takes no keyboard focus.
    const focused = await page.evaluate((sel) => {
      const btn = document.querySelector(sel);
      btn.focus();
      return document.activeElement === btn;
    }, ACTIONS.Backup);
    expect(focused).toBe(false);

    for (const theme of THEMES) {
      await applyTheme(page, theme);
      const look = await readActionLook(page);
      for (const [name, { opacity, cursor }] of Object.entries(look)) {
        expect(opacity, `${theme} ${name} opacity`).toBeLessThanOrEqual(0.5);
        expect(cursor, `${theme} ${name} cursor`).toBe("not-allowed");
      }
    }

    await connectAndOpenCloud(page);
    for (const sel of Object.values(ACTIONS)) {
      await expect(page.locator(sel)).toBeEnabled();
    }
    await expect(page.locator("#cloudConnectHint")).toBeHidden();
    const look = await readActionLook(page);
    for (const [name, { opacity, cursor }] of Object.entries(look)) {
      expect(opacity, `connected ${name} opacity`).toBe(1);
      expect(cursor, `connected ${name} cursor`).not.toBe("not-allowed");
    }
  });

  test("auto-sync and attachment toggles use the On/Off switch and follow their state", async ({
    page,
  }) => {
    await bootApp(page);
    await page.evaluate(() => {
      window.__syncCalls = [];
      window.enableCloudSync = async (provider) => window.__syncCalls.push(`enable:${provider}`);
      window.disableCloudSync = () => window.__syncCalls.push("disable");
    });
    await connectAndOpenCloud(page, { syncEnabled: true });

    await expect(page.locator("#cloudAutoSyncToggle")).toHaveClass(/chip-sort-toggle/);
    await expect(page.locator('#settingsPanel_cloud input[type="checkbox"]')).toHaveCount(0);
    expect(await readToggle(page, "cloudAutoSyncToggle")).toEqual([
      "On:true:true",
      "Off:false:false",
    ]);

    await page.locator('#cloudAutoSyncToggle .chip-sort-btn[data-val="no"]').click();
    await page.locator('#cloudAutoSyncToggle .chip-sort-btn[data-val="yes"]').click();
    expect(await page.evaluate(() => window.__syncCalls)).toEqual(["disable", "enable:dropbox"]);

    await page.evaluate(() => {
      localStorage.setItem("cloud_sync_enabled", "false");
      window.refreshSyncUI();
    });
    expect(await readToggle(page, "cloudAutoSyncToggle")).toEqual([
      "On:false:false",
      "Off:true:true",
    ]);

    expect(await readToggle(page, "syncAttachmentsToggle")).toEqual([
      "On:true:true",
      "Off:false:false",
    ]);
    await page.locator('#syncAttachmentsToggle .chip-sort-btn[data-val="no"]').click();
    expect(await readToggle(page, "syncAttachmentsToggle")).toEqual([
      "On:false:false",
      "Off:true:true",
    ]);
    expect(await page.evaluate(() => localStorage.getItem("syncAttachments"))).toBe("false");
  });

  test("a sync start, success and failure each reach a live region", async ({ page }) => {
    await bootApp(page);
    await connectAndOpenCloud(page, { syncEnabled: true });
    const panel = page.locator("#settingsPanel_cloud");

    await page.evaluate(() => window.updateSyncStatusIndicator("syncing"));
    await expect(panel.getByRole("status").filter({ hasText: "Syncing" })).toHaveCount(1);

    await page.evaluate(() => window.updateSyncStatusIndicator("idle", "just now"));
    await expect(panel.getByRole("status").filter({ hasText: "just now" })).toHaveCount(1);

    await page.evaluate(() => window.updateSyncStatusIndicator("error", "Sync incomplete"));
    await expect(panel.getByRole("alert").filter({ hasText: "Sync incomplete" })).toHaveCount(1);

    await page.evaluate(() => window.updateSyncStatusIndicator("idle", "just now"));
    await expect(panel.getByRole("alert")).toHaveCount(0);

    // The connection line is a status region too.
    await expect(panel.getByRole("status").filter({ hasText: "Connected" })).toHaveCount(1);
  });

  test("the cloud panel and Advanced modal carry no inline styles beyond display", async ({
    page,
  }) => {
    await bootApp(page);
    await expect(page.locator("#cloudSyncModal")).toHaveCount(0);

    const roots = ["#settingsPanel_cloud", "#cloudSyncAdvancedModal"];
    await openCloudDisconnected(page);
    const disconnected = await collectInlineStyleOffenders(page, {
      roots,
      runtime: ["display"],
      label: "disconnected",
    });

    await page.evaluate(() => {
      localStorage.setItem(
        "cloud_sync_override_backup",
        JSON.stringify({ timestamp: Date.now(), itemCount: 3, appVersion: "3.36.0" })
      );
    });
    await connectAndOpenCloud(page, { syncEnabled: true });
    await page.evaluate(() => window.openModalById("cloudSyncAdvancedModal"));
    await expect(page.locator("#cloudSyncHistorySection button")).toBeVisible();
    const connected = await collectInlineStyleOffenders(page, {
      roots,
      runtime: ["display"],
      label: "connected",
    });

    expect([...disconnected, ...connected]).toEqual([]);
  });
});
