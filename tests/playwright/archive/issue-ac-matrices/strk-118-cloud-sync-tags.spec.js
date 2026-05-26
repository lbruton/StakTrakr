import { test, expect } from "../../helpers/mocks/extended-test.js";

async function gotoApp(page) {
  await page.addInitScript(() => {
    localStorage.setItem("ackVersion", "9.9.9");
    localStorage.setItem("cloud_sync_enabled", "false");
  });
  await page.goto("/index.html");
}

async function seedTagState(page, { itemTags = {}, removedTags = {}, timestamps = {} } = {}) {
  await page.evaluate(
    (state) => {
      localStorage.setItem("itemTags", JSON.stringify(state.itemTags));
      localStorage.setItem("itemRemovedTags", JSON.stringify(state.removedTags));
      localStorage.setItem("itemTagsLastModified", JSON.stringify(state.timestamps));
      if (typeof window.loadItemTags === "function") window.loadItemTags();
    },
    { itemTags, removedTags, timestamps }
  );
}

function remoteTagData({ itemTags = {}, removedTags = {}, timestamps = {} } = {}) {
  return {
    itemTags: JSON.stringify(itemTags),
    itemRemovedTags: JSON.stringify(removedTags),
    itemTagsLastModified: JSON.stringify(timestamps),
  };
}

async function mergeTags(page, remote) {
  return page.evaluate((remoteData) => {
    if (!window.CloudSyncTest || typeof window.CloudSyncTest.mergeTagData !== "function") {
      throw new Error("CloudSyncTest.mergeTagData is not available");
    }
    return window.CloudSyncTest.mergeTagData(remoteData);
  }, remote);
}

test.describe("cloud sync tag merge", () => {
  test("AC-1 — selective merge applies remote item tags", async ({ page }) => {
    await gotoApp(page);
    await seedTagState(page, {
      itemTags: { "item-1": [] },
      timestamps: { "item-1": 100 },
    });

    await mergeTags(
      page,
      remoteTagData({
        itemTags: { "item-1": ["Other animal", "Toy or game"] },
        timestamps: { "item-1": 200 },
      })
    );

    const tags = await page.evaluate(() => JSON.parse(localStorage.getItem("itemTags")));
    expect(tags["item-1"]).toEqual(["Other animal", "Toy or game"]);
  });

  test("AC-2 — per-UUID last-writer-wins preserves newer local tags", async ({ page }) => {
    await gotoApp(page);
    await seedTagState(page, {
      itemTags: {
        "remote-wins": ["Local old"],
        "local-wins": ["Local new"],
      },
      timestamps: {
        "remote-wins": 100,
        "local-wins": 300,
      },
    });

    await mergeTags(
      page,
      remoteTagData({
        itemTags: {
          "remote-wins": ["Remote new"],
          "local-wins": ["Remote old"],
        },
        timestamps: {
          "remote-wins": 200,
          "local-wins": 250,
        },
      })
    );

    const tags = await page.evaluate(() => JSON.parse(localStorage.getItem("itemTags")));
    expect(tags["remote-wins"]).toEqual(["Remote new"]);
    expect(tags["local-wins"]).toEqual(["Local new"]);
  });

  test("AC-3 — merge refreshes in-memory itemTags", async ({ page }) => {
    await gotoApp(page);
    await seedTagState(page, {
      itemTags: { "item-1": ["Old"] },
      timestamps: { "item-1": 100 },
    });

    await mergeTags(
      page,
      remoteTagData({
        itemTags: { "item-1": ["Fresh"] },
        timestamps: { "item-1": 200 },
      })
    );

    const memoryTags = await page.evaluate(() => window.getItemTags("item-1"));
    expect(memoryTags).toEqual(["Fresh"]);
  });

  test("AC-4 — removed tags merge and re-add wins over removal", async ({ page }) => {
    await gotoApp(page);
    await seedTagState(page, {
      itemTags: { "item-1": ["Local"] },
      removedTags: { "item-1": ["Remote new"] },
      timestamps: { "item-1": 100 },
    });

    await mergeTags(
      page,
      remoteTagData({
        itemTags: { "item-1": ["Remote new"] },
        removedTags: { "item-1": ["Remote new", "Still removed"] },
        timestamps: { "item-1": 200 },
      })
    );

    const state = await page.evaluate(() => ({
      tags: JSON.parse(localStorage.getItem("itemTags")),
      removed: JSON.parse(localStorage.getItem("itemRemovedTags")),
    }));
    expect(state.tags["item-1"]).toEqual(["Remote new"]);
    expect(state.removed["item-1"]).toEqual(["Still removed"]);
  });

  test("AC-5 — tag-only remote changes are detected before silent pull", async ({ page }) => {
    await gotoApp(page);
    await seedTagState(page, {
      itemTags: { "item-1": ["Local"] },
      removedTags: {},
      timestamps: { "item-1": 100 },
    });

    const hasChanges = await page.evaluate(
      (remoteSettings) => {
        if (!window.CloudSyncTest || typeof window.CloudSyncTest.hasTagChanges !== "function") {
          throw new Error("CloudSyncTest.hasTagChanges is not available");
        }
        return window.CloudSyncTest.hasTagChanges(remoteSettings);
      },
      remoteTagData({ itemTags: { "item-1": ["Remote"] }, timestamps: { "item-1": 200 } })
    );

    expect(hasChanges).toBe(true);
  });

  test("STAK-470 — one-sided settings auto-merge routes tag keys through merge logic", async ({
    page,
  }) => {
    await gotoApp(page);
    await seedTagState(page, {
      itemTags: { "item-1": ["Local old"] },
      timestamps: { "item-1": 100 },
    });

    const result = await page.evaluate(
      (remoteSettings) => {
        if (
          !window.CloudSyncTest ||
          typeof window.CloudSyncTest.mergeOneSidedTagSettings !== "function"
        ) {
          throw new Error("CloudSyncTest.mergeOneSidedTagSettings is not available");
        }
        return window.CloudSyncTest.mergeOneSidedTagSettings(remoteSettings);
      },
      remoteTagData({ itemTags: { "item-1": ["Remote new"] }, timestamps: { "item-1": 200 } })
    );

    const tags = await page.evaluate(() => JSON.parse(localStorage.getItem("itemTags")));
    expect(result.tagKeysMerged).toBeGreaterThan(0);
    expect(tags["item-1"]).toEqual(["Remote new"]);
  });
});
