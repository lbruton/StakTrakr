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
  qty: over.qty != null ? over.qty : 1,
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
        document.getElementById("diffReviewApplyBtn").click();
      }),
    { options, clicks }
  );
}

const byField = (payload, field) => payload.find((r) => r.type === "modify" && r.field === field);
const setting = (payload, key) => payload.find((r) => r.type === "setting" && r.key === key);

test.describe("DiffModal merge/apply characterization (STRK-170 cohort 2.3)", () => {
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
