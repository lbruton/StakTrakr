import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

const openSettingsModal = async (page) => {
  await page.waitForFunction(() => typeof window.showSettingsModal === "function");
  await page.evaluate(() => window.showSettingsModal());
  await expect(page.locator("#settingsModal")).toBeVisible();
};

const openSettingsSection = async (page, section, panelId) => {
  await page.evaluate((name) => window.switchSettingsSection(name), section);
  await expect(page.locator(panelId)).toBeVisible();
};

/**
 * Re-boots the page with a deterministic pattern-image store: the demo seed
 * (seed-images.js caches pattern rules + images on boot) is gated off so its
 * writes cannot race clearAll(), Numista rules are emptied, and the image
 * cache is cleared. Shared by every orphan-cleanup test.
 * @param {import('@playwright/test').Page} page - Booted page.
 * @returns {Promise<void>}
 */
const bootCleanPatternImageStore = async (page) => {
  await page.addInitScript(() => localStorage.setItem("seedImagesVer", "1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      typeof window.imageCache !== "undefined" &&
      Boolean(window.NumistaLookup) &&
      Boolean(window.collectionsStore) &&
      typeof window.showSettingsModal === "function"
  );
  await page.evaluate(async () => {
    await window.imageCache.init();
    await window.imageCache.clearAll();
    localStorage.setItem("numistaLookupRules", JSON.stringify([]));
    window.NumistaLookup.importRules([], false);
  });
};

/**
 * Creates a live Custom Collection with cover + Slot artwork stored the way the
 * builder stores it: a patternImages record under `collection--<id>[--<slot>]`
 * plus a matching artwork stamp in the Collections store.
 * @param {import('@playwright/test').Page} page - Booted page.
 * @param {{name: string, slotLabels: string[], recordAgeMs?: number}} spec -
 *   `recordAgeMs` back-dates the stored image record behind its stamp (a stale record).
 * @returns {Promise<{collectionId: string, imageIds: string[]}>} Ids of the stored images.
 */
const seedCollectionArtwork = (page, spec) =>
  page.evaluate(async ({ name, slotLabels, recordAgeMs = 0 }) => {
    const made = window.collectionsStore.createCustom({
      name,
      metal: "Silver",
      slots: slotLabels.map((label) => ({ label })),
    });
    const collectionId = made.collection.id;
    const slotIds = window.collectionsStore
      .getState()
      .collections[collectionId].definition.slots.map((slot) => slot.id);
    const targets = [{ slotId: null }, ...slotIds.map((slotId) => ({ slotId }))];
    const imageIds = [];
    for (const { slotId } of targets) {
      const ruleId = slotId
        ? `collection--${collectionId}--${slotId}`
        : `collection--${collectionId}`;
      const stampedAt = Date.now();
      const digest = `digest-${ruleId}`;
      await window.imageCache.importPatternImageRecord({
        ruleId,
        obverse: new Blob(["art"], { type: "image/png" }),
        reverse: null,
        cachedAt: stampedAt - recordAgeMs,
        size: 3,
        digest,
      });
      window.collectionsStore.setArtwork(collectionId, slotId, true, stampedAt, digest);
      imageIds.push(ruleId);
    }
    return { collectionId, imageIds };
  }, spec);

/**
 * Reads the ids currently held in the patternImages IndexedDB store.
 * @param {import('@playwright/test').Page} page - Booted page.
 * @returns {Promise<string[]>} Sorted record ids.
 */
const storedPatternImageIds = (page) =>
  page.evaluate(async () =>
    (await window.imageCache.exportAllPatternImages()).map((rec) => rec.ruleId).sort()
  );

test.describe("core/settings-search-images", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.showSettingsModal === "function" &&
        typeof window.switchSettingsSection === "function"
    );
  });

  test("Search settings live in Filter Chips and fuzzy autocomplete persists", async ({ page }) => {
    await openSettingsModal(page);
    await expect(page.locator('.settings-nav-item[data-section="search"]')).toHaveCount(0);
    await openSettingsSection(page, "grouping", "#settingsPanel_grouping");

    const panel = page.locator("#settingsPanel_grouping");
    await expect(panel.locator('.settings-fieldset-title:has-text("Search")')).toBeVisible();
    await expect(panel.locator("#settingsFuzzyAutocomplete")).toBeVisible();

    await page.evaluate(() => localStorage.setItem("ff_migration_fuzzy_autocomplete", "1"));
    await panel.locator('#settingsFuzzyAutocomplete .chip-sort-btn[data-val="no"]').click();
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("featureFlags") || "{}").FUZZY_AUTOCOMPLETE
      )
    ).toBe(false);

    await page.reload({ waitUntil: "domcontentloaded" });
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("featureFlags") || "{}").FUZZY_AUTOCOMPLETE
      )
    ).toBe(false);
  });

  test("Custom Numista search patterns can be added and persist", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "grouping", "#settingsPanel_grouping");

    const panel = page.locator("#settingsPanel_grouping");
    await panel.locator("#numistaRulePatternInput").fill("\\bcore-pattern\\b");
    await panel.locator("#numistaRuleReplacementInput").fill('"Core Pattern" Bullion');
    await panel.locator("#numistaRuleIdInput").fill("9797");
    await panel.locator("#addNumistaRuleBtn").click();

    await expect(panel.locator("#customRuleTableContainer")).toContainText("\\bcore-pattern\\b");

    await page.reload({ waitUntil: "domcontentloaded" });
    await openSettingsModal(page);
    await openSettingsSection(page, "grouping", "#settingsPanel_grouping");
    await expect(page.locator("#customRuleTableContainer")).toContainText("\\bcore-pattern\\b");
  });

  test("Images settings expose the rule form and upload controls", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    await expect(page.locator("#imageStorageStats")).not.toBeVisible();

    const newRuleBtn = page.locator("#newPatternRuleBtn");
    await expect(newRuleBtn).toBeVisible();
    await newRuleBtn.click();

    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
    await expect(page.locator("#patternRuleObverseUploadBtn")).toHaveCount(1);
    await expect(page.locator("#patternRuleReverseUploadBtn")).toHaveCount(1);
    await expect(page.locator("#patternRuleSwapBtn")).toHaveCount(1);
  });

  // Characterization lock for STRK-195: pins the #addPatternRuleBtn handler's
  // observable behavior (keyword→regex compile, image requirement, rule add,
  // form reset/collapse, persistence) before it is decomposed into helpers.
  test("Image pattern rule (keywords + image) adds rule, resets form, and persists", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const before = await page.evaluate(() => window.NumistaLookup.getCustomRules().length);

    const toggleBtn = page.locator("#newPatternRuleBtn");
    await toggleBtn.click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();

    await page.locator("#patternRulePattern").fill("morgan, peace");
    await page
      .locator("#patternRuleObverse")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await expect(page.locator("#patternRuleObverseName")).toHaveText("test-obverse.png");

    await page.locator("#addPatternRuleBtn").click();

    // Keywords mode compiles comma-separated terms into an alternation regex,
    // stores the raw input as the replacement, and tags an image-rule seed id.
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.NumistaLookup.getCustomRules().some((r) => r.pattern === "morgan|peace")
        )
      )
      .toBe(true);
    expect(await page.evaluate(() => window.NumistaLookup.getCustomRules().length)).toBe(
      before + 1
    );
    const added = await page.evaluate(() =>
      window.NumistaLookup.getCustomRules().find((r) => r.pattern === "morgan|peace")
    );
    expect(added.replacement).toBe("morgan, peace");
    expect(String(added.seedImageId)).toMatch(/^custom-img-/);

    // Form auto-collapses and clears its inputs after a successful add.
    await expect(page.locator("#patternRuleFormContainer")).not.toBeVisible();
    await expect(toggleBtn).toContainText("New Rule");
    await toggleBtn.click();
    await expect(page.locator("#patternRulePattern")).toHaveValue("");
    await expect(page.locator("#patternRuleObverseName")).toHaveText("");

    // Rule survives a reload (persisted to localStorage).
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.NumistaLookup?.getCustomRules === "function");
    expect(
      await page.evaluate(() =>
        window.NumistaLookup.getCustomRules().some((r) => r.pattern === "morgan|peace")
      )
    ).toBe(true);
  });

  test("Image pattern rule is rejected when no image is selected", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const before = await page.evaluate(() => window.NumistaLookup.getCustomRules().length);

    await page.locator("#newPatternRuleBtn").click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
    await page.locator("#patternRulePattern").fill("no-image-rule");
    await page.locator("#addPatternRuleBtn").click();

    // The image-requirement guard fires before addRule: no rule is created and
    // the form stays open (no auto-collapse).
    expect(await page.evaluate(() => window.NumistaLookup.getCustomRules().length)).toBe(before);
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
  });

  // STRK-221: when the image processor returns no blob for a file the user
  // actually selected, the add must surface an error and abort — not silently
  // persist a rule with no cached image. (The no-processor branch falls back to
  // the raw File; the processor-present-but-failed branch must not drop it.)
  test("Image pattern rule is rejected when image processing yields no blob", async ({ page }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const before = await page.evaluate(() => window.NumistaLookup.getCustomRules().length);

    // Force the processor to fail (return null) for any file — mirrors a
    // transient decode/canvas failure, which processFile swallows as null.
    await page.waitForFunction(() => Boolean(window.imageProcessor));
    await page.evaluate(() => {
      window.imageProcessor.processFile = async () => null;
    });

    await page.locator("#newPatternRuleBtn").click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
    await page.locator("#patternRulePattern").fill("processor-fail-rule");
    await page
      .locator("#patternRuleObverse")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await expect(page.locator("#patternRuleObverseName")).toHaveText("test-obverse.png");

    await page.locator("#addPatternRuleBtn").click();

    // A user-visible error is surfaced via the custom #appDialogModal (not a
    // native dialog), and no rule is created (abort before addRule).
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await expect(page.locator("#appDialogModal")).toContainText("Failed to process image");
    expect(await page.evaluate(() => window.NumistaLookup.getCustomRules().length)).toBe(before);

    // Form stays open (no success-path reset/collapse).
    await page.locator("#appDialogOk").click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();
  });

  // STRK-221 (twin): the rule-EDIT path (js/settings.js) carried the same
  // silent-drop bug. A new upload whose processing yields no blob must error +
  // abort exactly like the create path — not quietly cache a null image.
  test("Editing a pattern rule is rejected when image processing yields no blob", async ({
    page,
  }) => {
    // Deterministic store: suppress the demo seed, one known rule, no images.
    await page.addInitScript(() => localStorage.setItem("seedImagesVer", "1"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        typeof window.imageCache !== "undefined" &&
        Boolean(window.NumistaLookup) &&
        typeof window.showSettingsModal === "function"
    );
    await page.evaluate(async () => {
      await window.imageCache.init();
      await window.imageCache.clearAll();
      localStorage.setItem("numistaLookupRules", JSON.stringify([]));
      window.NumistaLookup.importRules([], false);
      window.NumistaLookup.addRule("edittwinrule", "edittwinrule", null, "custom-img-edittwin");
    });

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const rules = page.locator("#customPatternImageRules");
    await expect(rules).toContainText("edittwinrule");

    // Open the row's inline edit form.
    await rules.getByRole("button", { name: "Edit", exact: true }).click();
    const editForm = rules.locator(".pattern-rule-edit-form").first();
    await expect(editForm).toBeVisible();

    // Force the processor to fail, change the pattern too, upload a new obverse,
    // then save — both edits should be rejected together.
    await page.evaluate(() => {
      window.imageProcessor.processFile = async () => null;
    });
    await editForm.locator(".edit-pattern").fill("changedtwinrule");
    await editForm
      .locator(".edit-obverse")
      .setInputFiles("tests/playwright/helpers/test-obverse.png");
    await editForm.locator(".edit-save-btn").click();

    // Same contract as the create path: a user-visible error via #appDialogModal.
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await expect(page.locator("#appDialogModal")).toContainText("Failed to process image");
    await page.locator("#appDialogOk").click();

    // The edit aborts wholesale: image resolution runs before the rule is
    // mutated, so the pattern change is NOT applied and the original survives.
    const patterns = await page.evaluate(() =>
      window.NumistaLookup.getCustomRules().map((r) => r.pattern)
    );
    expect(patterns).toContain("edittwinrule");
    expect(patterns).not.toContain("changedtwinrule");
  });

  // STRK-202: Settings ▸ Images surfaces pattern images whose rule no longer
  // exists (orphans) and lets the user reclaim the space. "Delete all" routes
  // through the custom showAppConfirm modal, not a native dialog.
  test("Orphaned pattern images are listed and can be cleared", async ({ page }) => {
    // Clean slate: no rules, two orphaned pattern-image records in IndexedDB.
    await bootCleanPatternImageStore(page);
    await page.evaluate(async () => {
      await window.imageCache.cachePatternImage(
        "orphan-strk202-a",
        new Blob(["a-obv"], { type: "image/png" }),
        new Blob(["a-rev"], { type: "image/png" })
      );
      await window.imageCache.cachePatternImage(
        "orphan-strk202-b",
        new Blob(["b-obv"], { type: "image/png" }),
        null
      );
    });

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText("orphan-strk202-a");
    await expect(container).toContainText("orphan-strk202-b");

    const deleteAll = container.getByRole("button", { name: "Delete all", exact: true });
    await expect(deleteAll).toBeVisible();
    await deleteAll.click();

    // Drive the custom confirm modal (#appDialogModal), not a native dialog.
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();

    await expect(container).toContainText("No orphaned pattern images");
    const remaining = await page.evaluate(
      async () => (await window.imageCache.exportAllPatternImages()).length
    );
    expect(remaining).toBe(0);
  });

  // STRK-438: Collection cover + Slot artwork shares the patternImages store but
  // is referenced by the Collections store, not by a Numista rule. The orphan
  // scan used to know only about rules, so every Collection image was offered
  // for deletion under "safe to delete".
  test("Live Collection artwork is never listed as orphaned and survives Delete all", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    const art = await seedCollectionArtwork(page, {
      name: "STRK-438 Live Set",
      slotLabels: ["Alpha", "Beta"],
    });
    expect(art.imageIds).toHaveLength(3); // cover + two Slots
    await page.evaluate(() =>
      window.imageCache.cachePatternImage(
        "orphan-strk438-rule",
        new Blob(["rule-obv"], { type: "image/png" }),
        null
      )
    );

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText("1 orphaned image");
    await expect(container).toContainText("orphan-strk438-rule");
    await expect(container).not.toContainText("collection--");

    await container.getByRole("button", { name: "Delete all", exact: true }).click();
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await expect(page.locator("#appDialogModal")).toContainText("1 orphaned pattern image");
    await page.locator("#appDialogOk").click();

    await expect(container).toContainText("No orphaned pattern images");
    expect(await storedPatternImageIds(page)).toEqual([...art.imageIds].sort());
  });

  test("Artwork of a removed Collection is still listed as orphaned and can be deleted", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    const art = await seedCollectionArtwork(page, {
      name: "STRK-438 Removed Set",
      slotLabels: ["Gamma"],
    });
    await page.evaluate((id) => window.collectionsStore.remove(id), art.collectionId);

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText(`${art.imageIds.length} orphaned images`);
    for (const imageId of art.imageIds) await expect(container).toContainText(imageId);

    await container.getByRole("button", { name: "Delete all", exact: true }).click();
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();

    await expect(container).toContainText("No orphaned pattern images");
    expect(await storedPatternImageIds(page)).toEqual([]);
  });

  test("A stale Collection image is orphaned, and deleting it leaves the live artwork stamp alone", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    // Records are back-dated behind their stamps: the stamp is newer than the
    // stored image, so another device holds the current art (isCurrentArtwork() false).
    const art = await seedCollectionArtwork(page, {
      name: "STRK-438 Stale Set",
      slotLabels: ["Delta"],
      recordAgeMs: 60_000,
    });
    const stampsBefore = await page.evaluate(
      (id) => JSON.stringify(window.collectionsStore.getState().collections[id].artwork),
      art.collectionId
    );

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText(`${art.imageIds.length} orphaned images`);
    await container.getByRole("button", { name: "Delete all", exact: true }).click();
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();
    await expect(container).toContainText("No orphaned pattern images");

    // Reclaiming the stale local copy must not publish a removal: a tombstone
    // stamped now would out-rank the newer art on the other device in a merge.
    const stampsAfter = await page.evaluate(
      (id) => JSON.stringify(window.collectionsStore.getState().collections[id].artwork),
      art.collectionId
    );
    expect(stampsAfter).toBe(stampsBefore);
  });

  test("Collection artwork is never offered for deletion when Collections cannot be consulted", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    await seedCollectionArtwork(page, { name: "STRK-438 Unverifiable Set", slotLabels: ["Eps"] });
    // Fail-safe contract: with the Collections predicate unavailable, a
    // collection-- record cannot be proven orphaned, so it must stay hidden.
    await page.evaluate(() => {
      delete window.collectionsCore;
    });

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText("No orphaned pattern images");
    await expect(container).not.toContainText("collection--");
  });

  test("Collection artwork is never offered for deletion when the currency check throws", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    await seedCollectionArtwork(page, { name: "STRK-438 Throwing Set", slotLabels: ["Zed"] });
    // The check threw mid-scan: the record is unverifiable, so it stays hidden
    // instead of leaking the exception or falling through to "orphaned".
    await page.evaluate(() => {
      window.collectionsCore = Object.assign({}, window.collectionsCore, {
        isCurrentArtwork() {
          throw new Error("isCurrentArtwork unavailable");
        },
      });
    });

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText("No orphaned pattern images");
    await expect(container).not.toContainText("collection--");
  });

  // The orphan list is a snapshot. Artwork can become current between the scan and
  // the click (an upload, or a cloud pull restoring the Collection's newer image),
  // so each delete re-checks the record immediately before removing it.
  for (const route of ["Delete all", "row Delete"]) {
    test(`${route} skips a record that became current artwork after the scan`, async ({ page }) => {
      await bootCleanPatternImageStore(page);
      const art = await seedCollectionArtwork(page, {
        name: "STRK-438 Revalidate Set",
        slotLabels: ["Eta"],
        recordAgeMs: 60_000,
      });

      await openSettingsModal(page);
      await openSettingsSection(page, "images", "#settingsPanel_images");
      const container = page.locator("#orphanedPatternImages");
      await expect(container).toContainText(`${art.imageIds.length} orphaned images`);

      // Newer art lands after the list rendered: every record is now current.
      await page.evaluate(async (ids) => {
        for (const id of ids) {
          const rec = await window.imageCache.getPatternImage(id);
          await window.imageCache.importPatternImageRecord({ ...rec, cachedAt: Date.now() + 1000 });
        }
      }, art.imageIds);

      if (route === "Delete all") {
        await container.getByRole("button", { name: "Delete all", exact: true }).click();
        await page.waitForSelector("#appDialogModal", { state: "visible" });
        await page.locator("#appDialogOk").click();
      } else {
        await container.getByRole("button", { name: "Delete", exact: true }).first().click();
      }

      await expect(container).toContainText("No orphaned pattern images");
      expect(await storedPatternImageIds(page)).toEqual([...art.imageIds].sort());
    });
  }

  // The re-check and the delete must be ONE IndexedDB transaction: a separate
  // get-then-delete leaves a window in which a sync restore or another tab can
  // replace the record, and the delete then removes the newer one (STRK-438).
  test("deletePatternImageIf checks the stored record and deletes it in one step", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    const result = await page.evaluate(async () => {
      const cache = window.imageCache;
      const id = "atomic-strk438";
      await cache.cachePatternImage(id, new Blob(["a"], { type: "image/png" }), null);
      const seen = [];
      const kept = await cache.deletePatternImageIf(id, (rec) => {
        seen.push(rec.ruleId);
        return false;
      });
      const afterKeep = Boolean(await cache.getPatternImage(id));
      const removed = await cache.deletePatternImageIf(id, () => true);
      const afterRemove = Boolean(await cache.getPatternImage(id));
      const missing = await cache.deletePatternImageIf(id, () => true);
      return { seen, kept, afterKeep, removed, afterRemove, missing };
    });
    expect(result).toEqual({
      seen: ["atomic-strk438"],
      kept: false,
      afterKeep: true,
      removed: true,
      afterRemove: false,
      missing: false,
    });
  });
});
