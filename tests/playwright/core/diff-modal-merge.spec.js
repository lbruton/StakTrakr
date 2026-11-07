import { test, expect } from "../helpers/mocks/extended-test.js";

// STRK-170 cohort 2.3 — characterization coverage for the diff-modal.js MERGE/APPLY
// path, written BEFORE the complexity refactor of:
//   _buildSelectedChanges (ccn30) — assembles the onApply payload from item +
//                                   settings selections,
//   _mergeSettingElements (ccn56) — per-element setting merge (chip-strip /
//                                   toggle-map / kv-pills / slug-chips),
//   _onModifiedClick      (ccn35) — field-value / card-action click handling,
//   _toggleSelectAll      (ccn28) — backup-import 3-state Select All toggle.
//
// These functions are IIFE-private; the only public surface is DiffModal.show().
// So we exercise them through their real contract: open the modal with a crafted
// diff/settingsDiff, drive the documented DOM controls, click Apply, and assert
// the `onApply(selectedChanges)` payload. The payload IS _buildSelectedChanges()'s
// return value (which calls _mergeSettingElements), and the clicks route through
// _onModifiedClick / _toggleSelectAll. Behavior must be byte-stable across the
// refactor — every assertion below pins current (pre-refactor) output.

const ITEM = (over) => ({
  uuid: over.uuid,
  serial: over.serial,
  name: over.name,
  metal: "Silver",
  composition: "Silver",
  type: "Coin",
  qty: over.qty ?? 1,
  weight: 1,
  weightUnit: "oz",
  purity: 0.999,
  price: 30,
  date: "2026-06-16",
});

// A diff with one added orphan, one modified item (name + qty changes), one
// deleted orphan. Used by the item-selection scenarios.
const ITEM_DIFF = {
  added: [ITEM({ uuid: "dmm-add-1", serial: 1, name: "Added One" })],
  modified: [
    {
      item: ITEM({ uuid: "dmm-mod-1", serial: 2, name: "RemoteName", qty: 5 }),
      changes: [
        { field: "name", localVal: "LocalName", remoteVal: "RemoteName" },
        { field: "qty", localVal: 3, remoteVal: 5 },
      ],
    },
  ],
  deleted: [ITEM({ uuid: "dmm-del-1", serial: 9, name: "Deleted One" })],
};

async function gotoApp(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.DiffModal !== "undefined" &&
      typeof window.DiffModal.show === "function" &&
      typeof window.DiffEngine !== "undefined"
  );
}

// Open the real diff modal, run the given click selectors in order against the
// live DOM, then click Apply and resolve with the onApply payload. Runs entirely
// in-page so re-renders between clicks never race a stale Playwright handle.
async function applyDiff(page, options, clicks) {
  return page.evaluate(
    ({ options, clicks }) =>
      new Promise((resolve) => {
        options.onApply = (selected) => resolve({ payload: selected });
        options.onCancel = () => resolve({ cancelled: true });
        window.DiffModal.show(options);
        for (let i = 0; i < clicks.length; i++) {
          const el = document.querySelector(clicks[i]);
          if (!el) {
            resolve({ error: "selector not found: " + clicks[i] });
            return;
          }
          el.click();
        }
        // Guard the Apply click: a missing or disabled button never fires onApply,
        // which would hang the page.evaluate Promise until the test times out.
        // Resolve deterministically instead so the failure is debuggable.
        // safeGetElement returns a truthy dummy (not null) for a missing id, so
        // discriminate on the concrete type rather than falsiness.
        const applyBtn = window.safeGetElement("diffReviewApplyBtn");
        if (!(applyBtn instanceof HTMLElement)) {
          resolve({ error: "selector not found: #diffReviewApplyBtn" });
          return;
        }
        if (applyBtn.disabled) {
          resolve({ applyDisabled: true });
          return;
        }
        applyBtn.click();
      }),
    { options, clicks }
  );
}

const byField = (payload, field) => payload.find((r) => r.type === "modify" && r.field === field);
const setting = (payload, key) => payload.find((r) => r.type === "setting" && r.key === key);

test.describe("DiffModal merge/apply characterization (cohort 2.3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("default item merge: adds imported, modified fields take remote, deleted kept", async ({
    page,
  }) => {
    const res = await applyDiff(
      page,
      { source: { type: "csv", label: "Test" }, diff: ITEM_DIFF },
      []
    );
    expect(res.error).toBeUndefined();
    const payload = res.payload;
    expect(payload.filter((r) => r.type === "add").length).toBe(1);
    expect(byField(payload, "name").value).toBe("RemoteName"); // remote default
    expect(byField(payload, "qty").value).toBe(5); // remote default
    expect(payload.filter((r) => r.type === "delete").length).toBe(0); // deleted defaults to keep
  });

  test("_onModifiedClick: picking the local field value emits the local value", async ({
    page,
  }) => {
    const res = await applyDiff(page, { source: { type: "csv", label: "Test" }, diff: ITEM_DIFF }, [
      '.dm-field-value.local[data-field="name"][data-card="0"]',
    ]);
    expect(res.error).toBeUndefined();
    expect(byField(res.payload, "name").value).toBe("LocalName");
    expect(byField(res.payload, "qty").value).toBe(5); // qty untouched -> remote default
  });

  test("_onModifiedClick: qty 'Add to existing' (sum) emits local+remote", async ({ page }) => {
    const res = await applyDiff(page, { source: { type: "csv", label: "Test" }, diff: ITEM_DIFF }, [
      '.dm-field-value.sum[data-field="qty"][data-card="0"]',
    ]);
    expect(res.error).toBeUndefined();
    expect(byField(res.payload, "qty").value).toBe(8); // 3 + 5
  });

  test("_onModifiedClick: 'Keep All Local' card action picks local for every field", async ({
    page,
  }) => {
    const res = await applyDiff(page, { source: { type: "csv", label: "Test" }, diff: ITEM_DIFF }, [
      '[data-card-action="keep-local"][data-card="0"]',
    ]);
    expect(res.error).toBeUndefined();
    expect(byField(res.payload, "name").value).toBe("LocalName");
    expect(byField(res.payload, "qty").value).toBe(3); // local
  });

  test("_toggleSelectAll: first press selects added+modified, leaves deleted out", async ({
    page,
  }) => {
    const res = await applyDiff(
      page,
      { source: { type: "csv", label: "Backup" }, diff: ITEM_DIFF, backupCount: 3, localCount: 1 },
      ["#diffReviewSelectAllToggle"]
    );
    expect(res.error).toBeUndefined();
    expect(res.payload.filter((r) => r.type === "add").length).toBe(1);
    expect(res.payload.filter((r) => r.type === "delete").length).toBe(0);
  });

  test("_toggleSelectAll: second press also marks deleted for removal", async ({ page }) => {
    const res = await applyDiff(
      page,
      { source: { type: "csv", label: "Backup" }, diff: ITEM_DIFF, backupCount: 3, localCount: 1 },
      ["#diffReviewSelectAllToggle", "#diffReviewSelectAllToggle"]
    );
    expect(res.error).toBeUndefined();
    expect(res.payload.filter((r) => r.type === "delete").length).toBe(1);
  });

  test("_toggleSelectAll: third press deselects all (added skipped, fields local)", async ({
    page,
  }) => {
    // A settingsDiff keeps Apply enabled in the fully-deselected state — without it,
    // _updateApplyButton disables Apply (checkedCount===0 && no settings), and a
    // disabled button cannot be clicked. The settingsDiff does not affect what
    // _toggleSelectAll does to item selections; it only keeps the payload observable.
    const res = await applyDiff(
      page,
      {
        source: { type: "csv", label: "Backup" },
        diff: ITEM_DIFF,
        backupCount: 3,
        localCount: 1,
        settingsDiff: {
          changed: [{ key: "displayCurrency", localVal: "USD", remoteVal: "EUR" }],
          matched: [],
        },
      },
      ["#diffReviewSelectAllToggle", "#diffReviewSelectAllToggle", "#diffReviewSelectAllToggle"]
    );
    expect(res.error).toBeUndefined();
    expect(res.payload.filter((r) => r.type === "add").length).toBe(0); // added -> skip
    expect(res.payload.filter((r) => r.type === "delete").length).toBe(0); // deleted -> keep
    expect(byField(res.payload, "name").value).toBe("LocalName"); // modified fields -> local
  });

  test("_mergeSettingElements: chip-strip whole-setting fallback takes remote by default", async ({
    page,
  }) => {
    const res = await applyDiff(
      page,
      {
        source: { type: "sync", label: "Sync" },
        diff: {
          added: [ITEM({ uuid: "dmm-s1", serial: 11, name: "Seed" })],
          modified: [],
          deleted: [],
        },
        settingsDiff: {
          changed: [
            {
              key: "layoutSectionConfig",
              localVal: [{ id: "a", label: "Alpha", enabled: true }],
              remoteVal: [{ id: "a", label: "Alpha", enabled: false }],
            },
          ],
          matched: [],
        },
      },
      []
    );
    expect(res.error).toBeUndefined();
    const rec = setting(res.payload, "layoutSectionConfig");
    expect(Array.isArray(rec.value)).toBe(true);
    expect(rec.value[0].enabled).toBe(false); // no element pick -> remote whole-setting
  });

  test("_mergeSettingElements: chip-strip per-element local pick merges the local chip", async ({
    page,
  }) => {
    const res = await applyDiff(
      page,
      {
        source: { type: "sync", label: "Sync" },
        diff: {
          added: [ITEM({ uuid: "dmm-s2", serial: 12, name: "Seed" })],
          modified: [],
          deleted: [],
        },
        settingsDiff: {
          changed: [
            {
              key: "layoutSectionConfig",
              localVal: [{ id: "a", label: "Alpha", enabled: true }],
              remoteVal: [{ id: "a", label: "Alpha", enabled: false }],
            },
          ],
          matched: [],
        },
      },
      ['[data-field="setting-layoutSectionConfig-a"][data-side="local"]']
    );
    expect(res.error).toBeUndefined();
    const rec = setting(res.payload, "layoutSectionConfig");
    expect(rec.value[0].enabled).toBe(true); // local element substituted by the merge
  });

  test("_mergeSettingElements: toggle-map per-key local pick keeps the local value", async ({
    page,
  }) => {
    const res = await applyDiff(
      page,
      {
        source: { type: "sync", label: "Sync" },
        diff: {
          added: [ITEM({ uuid: "dmm-s3", serial: 13, name: "Seed" })],
          modified: [],
          deleted: [],
        },
        settingsDiff: {
          changed: [
            { key: "numistaViewFields", localVal: { fieldA: true }, remoteVal: { fieldA: false } },
          ],
          matched: [],
        },
      },
      ['[data-field="setting-numistaViewFields-fieldA"][data-side="local"]']
    );
    expect(res.error).toBeUndefined();
    const rec = setting(res.payload, "numistaViewFields");
    expect(rec.value.fieldA).toBe(true); // local value won via per-key merge
  });

  test("_mergeSettingElements: slug-chips appends a local-only slug picked local", async ({
    page,
  }) => {
    const res = await applyDiff(
      page,
      {
        source: { type: "sync", label: "Sync" },
        diff: {
          added: [ITEM({ uuid: "dmm-s4", serial: 14, name: "Seed" })],
          modified: [],
          deleted: [],
        },
        settingsDiff: {
          changed: [
            {
              key: "headerBtnOrder",
              localVal: ["headerThemeBtn", "headerExtraBtn"],
              remoteVal: ["headerThemeBtn"],
            },
          ],
          matched: [],
        },
      },
      ['[data-field="setting-headerBtnOrder-headerExtraBtn"][data-side="local"]']
    );
    expect(res.error).toBeUndefined();
    const rec = setting(res.payload, "headerBtnOrder");
    expect(rec.value).toContain("headerThemeBtn"); // common slug retained
    expect(rec.value).toContain("headerExtraBtn"); // local-only slug appended via merge
  });
});

// The diff modal renderers style their markup through classes in index.html. An inline
// style may carry only a per-item runtime value: the metal tint, the progress width, or
// the show/hide toggle.
test.describe("DiffModal markup styling", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("rendered markup carries inline styles only for runtime values", async ({ page }) => {
    const offenders = await page.evaluate((itemDiff) => {
      const RUNTIME = new Set(["color", "background", "width", "display"]);
      const ROOTS = [
        "#diffReviewSource",
        "#diffSummaryDashboard",
        "#diffSectionOrphans",
        "#diffSectionModified",
        "#diffReviewSettings",
      ];
      const found = [];
      const collect = (label) => {
        for (const sel of ROOTS) {
          const root = document.querySelector(sel);
          if (!root) continue;
          for (const el of root.querySelectorAll("[style]")) {
            for (let i = 0; i < el.style.length; i++) {
              const prop = el.style[i];
              const base = prop.startsWith("background") ? "background" : prop;
              if (!RUNTIME.has(base)) found.push(`${label} ${sel} <${el.tagName}> ${prop}`);
            }
          }
        }
      };
      const show = (opts) =>
        window.DiffModal.show(Object.assign({ onApply: () => {}, onCancel: () => {} }, opts));
      show({
        source: { type: "sync", label: "Dropbox" },
        meta: { itemCount: 3, deviceId: "styling-device", appVersion: "3.36.70" },
        conflicts: { conflicts: [{}] },
        diff: itemDiff,
        settingsDiff: {
          changed: [
            { key: "appTheme", localVal: "dark", remoteVal: "light" },
            {
              key: "layoutSectionConfig",
              localVal: [{ id: "a", label: "Alpha", enabled: true }],
              remoteVal: [{ id: "a", label: "Alpha", enabled: false }],
            },
          ],
          matched: [{ key: "cardViewStyle", localVal: "a", remoteVal: "a" }],
        },
      });
      const settingsToggle = document.querySelector('[data-cat-toggle="settings"]');
      if (settingsToggle && settingsToggle.classList.contains("collapsed")) settingsToggle.click();
      const matchedToggle = document.querySelector("[data-toggle-matched]");
      if (matchedToggle) matchedToggle.click();
      collect("sync");
      show({
        source: { type: "csv", label: "Backup" },
        diff: { added: [], modified: [], deleted: [] },
      });
      collect("empty");
      return found;
    }, ITEM_DIFF);
    expect(offenders).toEqual([]);
  });
});

// STRK-258 — "Local Items" in the sync meta row must be qty-summed (physical pieces),
// matching "Remote Items" (meta.itemCount, populated from cloudSafeItemCount()) rather
// than a raw inventory.length row count. Regression coverage for a fix that was missed
// when 424a6b3f moved every other item-count display to qty-summed semantics.
test.describe("DiffModal sync meta row — Local Items count", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("Local Items sums qty across rows, not the row count", async ({ page }) => {
    const localItemsText = await page.evaluate(() => {
      window.inventory = [
        { uuid: "strk258-a", serial: 1, name: "Row A", metal: "Silver", qty: 1 },
        { uuid: "strk258-b", serial: 2, name: "Row B", metal: "Silver", qty: 5 },
      ];
      window.DiffModal.show({
        source: { type: "sync", label: "Dropbox" },
        meta: { itemCount: 6, deviceId: "test-device", appVersion: "3.35.64" },
        diff: { added: [], modified: [], deleted: [] },
        onApply: () => {},
        onCancel: () => {},
      });
      const cells = Array.from(document.querySelectorAll("#diffReviewSource strong"));
      const labels = Array.from(document.querySelectorAll("#diffReviewSource span"));
      const idx = labels.findIndex((el) => el.textContent.trim() === "Local Items");
      return idx === -1 ? null : cells[idx].textContent.trim();
    });
    // Two rows, qty 1 + qty 5 = 6 physical pieces. inventory.length (row count) is 2 —
    // the pre-fix bug would report "2" here instead of "6".
    expect(localItemsText).toBe("6");
  });
});

// Two rows for different Items must never read the same, every value column names its
// side, and the chosen side reads in text as well as colour.
test.describe("DiffModal row clarity", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  const EAGLE = { metal: "Silver", type: "Coin", weight: 1, weightUnit: "oz", qty: 1 };

  test("added Items with the same name show purchase details, then an entry number", async ({
    page,
  }) => {
    const rows = await page.evaluate((eagle) => {
      const added = [
        {
          ...eagle,
          uuid: "rc-a",
          name: "American Silver Eagle",
          date: "2024-03-12",
          price: 31.5,
          notes: "From the coin show tube",
        },
        {
          ...eagle,
          uuid: "rc-b",
          name: "American Silver Eagle",
          date: "2025-01-08",
          price: 36.2,
          serialNumber: "4471",
        },
        { ...eagle, uuid: "rc-c", name: "Maple Leaf", date: "2024-05-01", price: 33 },
        { ...eagle, uuid: "rc-d", name: "Maple Leaf", date: "2024-05-01", price: 33 },
      ];
      window.DiffModal.show({
        source: { type: "csv", label: "inventory.csv" },
        diff: { added, modified: [], deleted: [] },
        onApply: () => {},
        onCancel: () => {},
      });
      return {
        identities: Array.from(
          document.querySelectorAll("#diffSectionOrphans .dm-orphan-card .dm-item-identity")
        ).map((el) => el.textContent.replace(/\s+/g, " ").trim()),
        details: Array.from(
          document.querySelectorAll("#diffSectionOrphans .dm-orphan-card .dm-item-detail")
        ).map((el) => el.textContent.replace(/\s+/g, " ").trim()),
        paid: [31.5, 36.2].map((v) => formatCurrency(v)),
      };
    }, EAGLE);

    expect(new Set(rows.identities).size).toBe(4);
    expect(rows.details).toHaveLength(4);
    expect(rows.details[0]).toContain("Bought 2024-03-12");
    expect(rows.details[0]).toContain(`Paid ${rows.paid[0]}`);
    expect(rows.details[0]).toContain("From the coin show tube");
    expect(rows.details[1]).toContain("Bought 2025-01-08");
    expect(rows.details[1]).toContain(`Paid ${rows.paid[1]}`);
    expect(rows.details[1]).toContain("Serial 4471");
    expect(rows.details[2]).toContain("Entry 1 of 2");
    expect(rows.details[3]).toContain("Entry 2 of 2");
  });

  test("conflict fields carry column headers, plain labels, formatted prices and a chosen tag", async ({
    page,
  }) => {
    const expected = await page.evaluate((eagle) => {
      const timestamp = Date.UTC(2026, 10, 6, 15, 0, 0);
      const item = {
        ...eagle,
        uuid: "rc-mod",
        name: "Gold Buffalo",
        metal: "Gold",
        date: "2023-06-30",
        price: 2051,
      };
      window.DiffModal.show({
        source: { type: "sync", label: "dropbox" },
        meta: { deviceId: "another-device-id", timestamp, itemCount: 1, appVersion: "3.36.119" },
        diff: {
          added: [],
          deleted: [],
          modified: [
            {
              item,
              changes: [
                { field: "price", localVal: 2051, remoteVal: 2015 },
                { field: "storageLocation", localVal: "Safe, top shelf", remoteVal: "Bank box" },
              ],
            },
          ],
        },
        onApply: () => {},
        onCancel: () => {},
      });
      return {
        local: formatCurrency(2051),
        remote: formatCurrency(2015),
        synced: new Date(timestamp).toLocaleDateString("en-CA"),
      };
    }, EAGLE);

    const card = page.locator("#diffSectionModified .dm-conflict-card").first();
    const head = card.locator(".dm-field-head");
    await expect(head).toContainText("Field");
    await expect(head).toContainText("This device");
    await expect(head).toContainText("Dropbox");
    await expect(head).toContainText(`synced ${expected.synced}`);
    await expect(card.locator(".dm-chip-id")).toHaveCount(0);
    await expect(card.locator(".dm-item-detail")).toContainText(`Paid ${expected.local}`);

    const priceRow = card.locator(".dm-field-diff").filter({ hasText: "Purchase price" });
    await expect(priceRow.locator(".dm-field-value.local .dm-pick-val")).toHaveText(expected.local);
    await expect(priceRow.locator(".dm-field-value.remote .dm-pick-val")).toHaveText(
      expected.remote
    );
    await expect(card.locator(".dm-field-label")).toContainText([
      "Purchase price",
      "Storage location",
    ]);

    const remoteTag = priceRow.locator(".dm-field-value.remote .dm-pick-tag");
    const localTag = priceRow.locator(".dm-field-value.local .dm-pick-tag");
    await expect(remoteTag).toBeVisible();
    await expect(remoteTag).toHaveText(/Chosen/);
    await expect(localTag).toBeHidden();
    await priceRow.locator(".dm-field-value.local").click();
    await expect(localTag).toBeVisible();
    await expect(remoteTag).toBeHidden();
  });

  test("the sync meta row names the source device and the sync date", async ({ page }) => {
    const read = (deviceId) =>
      page.evaluate((id) => {
        const timestamp = Date.UTC(2026, 10, 6, 15, 0, 0);
        window.DiffModal.show({
          source: { type: "sync", label: "dropbox" },
          meta: {
            deviceId: id === "self" ? window.getSyncDeviceId() : id,
            timestamp,
            itemCount: 1,
            appVersion: "3.36.119",
          },
          diff: { added: [], modified: [], deleted: [] },
          onApply: () => {},
          onCancel: () => {},
        });
        const cells = {};
        for (const cell of document.querySelectorAll("#diffReviewSource .dm-meta-cell")) {
          cells[cell.querySelector(".dm-meta-label").textContent.trim()] = cell
            .querySelector(".dm-meta-value")
            .textContent.trim();
        }
        return { cells, date: new Date(timestamp).toLocaleDateString("en-CA") };
      }, deviceId);

    const other = await read("another-device-id");
    expect(other.cells.From).toBe("Another device");
    expect(other.cells.Synced).toContain(other.date);
    expect(other.cells.Device).toBeUndefined();
    const self = await read("self");
    expect(self.cells.From).toBe("This device");
  });
});
