import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";
import { collectInlineStyleOffenders } from "../helpers/inline-styles.js";

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

  test("Settings markup built in JS carries inline styles only for runtime values", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    await page.evaluate(async () => {
      await window.imageCache.cachePatternImage(
        "orphan-styling",
        new Blob(["obv"], { type: "image/png" }),
        null
      );
      await window.imageCache.cachePatternImage(
        "rule-styling-seed",
        new Blob(["obv"], { type: "image/png" }),
        new Blob(["rev"], { type: "image/png" })
      );
      window.NumistaLookup.addRule("styling", "Styling Bullion", "4242", "rule-styling-seed");
    });
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");
    await expect(page.locator("#orphanedPatternImages")).toContainText("orphan-styling");

    const offenders = await page.evaluate(async () => {
      const RUNTIME = new Set(["width", "display"]);
      const ROOTS = [
        "#filterChipCategoryContainer",
        "#customRuleTableContainer",
        "#layoutSectionConfigContainer",
        "#orphanedPatternImages",
        "#customPatternImageRules",
        "#userImageGrid",
        "#numistaTagSettingsGroup",
      ];
      const found = [];
      const collect = (label) => {
        for (const sel of ROOTS) {
          const root = document.querySelector(sel);
          if (!root) continue;
          for (const el of root.querySelectorAll("[style]")) {
            for (let i = 0; i < el.style.length; i++) {
              const prop = el.style[i];
              if (!RUNTIME.has(prop)) found.push(`${label} ${sel} <${el.tagName}> ${prop}`);
            }
          }
        }
      };
      const renderAll = async () => {
        renderFilterChipCategoryTable();
        renderCustomRuleTable();
        renderLayoutSectionConfigTable();
        await renderOrphanedPatternImages();
        await renderCustomPatternRules();
        await renderUserImageGrid();
        window.renderNumistaTagSettings();
      };

      await renderAll();
      collect("empty-blacklist");
      window.addToTagBlacklist("Circulation");
      await renderAll();
      collect("populated");

      window.NumistaLookup.importRules([], false);
      await window.imageCache.clearAll();
      await renderAll();
      collect("empty");
      return found;
    });
    expect(offenders).toEqual([]);
  });

  test("Pattern Image Rules form carries inline styles only for show/hide toggles", async ({
    page,
  }) => {
    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");
    await page.locator("#newPatternRuleBtn").click();
    await expect(page.locator("#patternRuleFormContainer")).toBeVisible();

    const root = ".settings-fieldset:has(#patternRuleFormContainer)";
    await expect(page.locator(root)).toHaveCount(1);
    const offenders = await collectInlineStyleOffenders(page, {
      roots: [root],
      runtime: ["display"],
      label: "new-rule-form",
    });
    expect(offenders).toEqual([]);
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

  // A record replaced after the scan (another tab, a sync restore) must never be
  // deleted on the strength of the old listing — even when this tab's Collections
  // state would still classify the replacement as an orphan (the store does not see
  // other tabs' writes, and an upload writes the image before its artwork stamp).
  test("Delete all keeps a record that was replaced after the scan", async ({ page }) => {
    await bootCleanPatternImageStore(page);
    const art = await seedCollectionArtwork(page, {
      name: "STRK-438 Replaced Set",
      slotLabels: ["Theta"],
    });
    await page.evaluate((id) => window.collectionsStore.remove(id), art.collectionId);

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");
    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText(`${art.imageIds.length} orphaned images`);

    // Another tab replaces every listed record; this tab still calls them orphans.
    await page.evaluate(async (ids) => {
      for (const id of ids) {
        const rec = await window.imageCache.getPatternImage(id);
        await window.imageCache.importPatternImageRecord({
          ...rec,
          cachedAt: rec.cachedAt + 5000,
          digest: `replaced-${id}`,
        });
      }
    }, art.imageIds);

    await container.getByRole("button", { name: "Delete all", exact: true }).click();
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();

    await expect(container).toContainText(`${art.imageIds.length} orphaned images`);
    expect(await storedPatternImageIds(page)).toEqual([...art.imageIds].sort());
  });

  // Another tab can change who owns a listed record without touching the record
  // itself (a cloud pull merges Collection state, then restores identical images).
  // The Collections store has no cross-tab listener, so Delete reads the persisted
  // state afresh instead of trusting this tab's memoized copy.
  test("Delete all re-reads Collections state that another tab changed after the scan", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    const art = await seedCollectionArtwork(page, {
      name: "STRK-438 Restored Set",
      slotLabels: ["Iota"],
    });
    await page.evaluate((id) => window.collectionsStore.remove(id), art.collectionId);

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");
    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText(`${art.imageIds.length} orphaned images`);

    // The other tab restores the Collection: persisted state changes, this tab's
    // in-memory copy (and the image records) stay exactly as they were.
    await page.evaluate((id) => {
      const state = JSON.parse(JSON.stringify(window.collectionsStore.getState()));
      state.collections[id].deletedAt = null;
      saveDataSync(COLLECTION_STATE_KEY, state);
    }, art.collectionId);

    await container.getByRole("button", { name: "Delete all", exact: true }).click();
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();

    await expect(container).toContainText("No orphaned pattern images");
    expect(await storedPatternImageIds(page)).toEqual([...art.imageIds].sort());
  });

  // loadDataSync swallows parse errors, and normalizeState turns any wrong shape into
  // an empty state, so a damaged collectionState looks like "no Collections at all".
  // Every unusable persisted value must fail closed instead of presenting every
  // Collection image as orphaned — including a well-shaped map holding an entry that
  // normalization would silently drop (null, or an id that differs from its key).
  for (const [label, persisted] of [
    ["is unreadable JSON", "{not valid json"],
    ["is an empty object", "{}"],
    ["is a bare array", "[]"],
    ["has a non-map collections field", '{"collections":[]}'],
    ["holds a null Collection entry", '{"schema":1,"collections":{"custom-damaged":null}}'],
    [
      "holds a Collection whose id differs from its key",
      '{"schema":1,"collections":{"custom-damaged":{"id":"custom-other","kind":"custom"}}}',
    ],
  ]) {
    test(`Collection artwork is never listed when the persisted Collections state ${label}`, async ({
      page,
    }) => {
      await bootCleanPatternImageStore(page);
      await seedCollectionArtwork(page, { name: "STRK-438 Damaged Set", slotLabels: ["Kappa"] });
      await page.evaluate((value) => localStorage.setItem("collectionState", value), persisted);

      await openSettingsModal(page);
      await openSettingsSection(page, "images", "#settingsPanel_images");

      const container = page.locator("#orphanedPatternImages");
      await expect(container).toContainText("No orphaned pattern images");
      await expect(container).not.toContainText("collection--");
    });
  }

  // normalizeState() keeps a Collection whose artwork entry is damaged: it coerces a
  // non-boolean `present` to false and keeps any non-empty `modified` string as is,
  // which turns a recoverable live stamp into an "orphaned" blob. isCurrentArtwork()
  // also compares the stamp LEXICALLY against a canonical ISO string, so a parseable
  // but non-canonical stamp (no fractional seconds) reads as newer than its own image.
  // A damaged ownership-bearing entry must fail closed too.
  for (const [label, field, damaged] of [
    ["a non-boolean present", "present", "true"],
    ["a malformed modified timestamp", "modified", "corrupt"],
    ["a non-canonical modified timestamp", "modified", "@strip-milliseconds"],
  ]) {
    test(`Collection artwork is never listed when a persisted artwork stamp has ${label}`, async ({
      page,
    }) => {
      await bootCleanPatternImageStore(page);
      const art = await seedCollectionArtwork(page, {
        name: "STRK-438 Coerced Set",
        slotLabels: ["Mu"],
      });
      await page.evaluate(
        ({ id, key, value }) => {
          const state = JSON.parse(JSON.stringify(window.collectionsStore.getState()));
          for (const entry of Object.values(state.collections[id].artwork)) {
            // Same instant as the stored image, written without fractional seconds.
            entry[key] =
              value === "@strip-milliseconds" ? entry.modified.replace(/\.\d{3}Z$/, "Z") : value;
          }
          saveDataSync(COLLECTION_STATE_KEY, state);
        },
        { id: art.collectionId, key: field, value: damaged }
      );

      await openSettingsModal(page);
      await openSettingsSection(page, "images", "#settingsPanel_images");

      const container = page.locator("#orphanedPatternImages");
      await expect(container).toContainText("No orphaned pattern images");
      await expect(container).not.toContainText("collection--");
    });
  }

  // deletePatternImageIf() awaits the database before its transaction opens, so a
  // snapshot taken before that call can be stale by the time the predicate runs.
  // Ownership is read inside the predicate, at the moment the delete is decided.
  test("Delete all reads ownership at the moment of the delete, not before opening the transaction", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    const art = await seedCollectionArtwork(page, {
      name: "STRK-438 Late Restore Set",
      slotLabels: ["Nu"],
    });
    await page.evaluate((id) => window.collectionsStore.remove(id), art.collectionId);

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");
    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText(`${art.imageIds.length} orphaned images`);

    // Another tab restores the Collection while the delete is waiting on the database.
    await page.evaluate((id) => {
      const cache = window.imageCache;
      const original = cache._ensureDb.bind(cache);
      let restored = false;
      cache._ensureDb = async (...args) => {
        if (!restored) {
          restored = true;
          const state = JSON.parse(JSON.stringify(window.collectionsStore.getState()));
          state.collections[id].deletedAt = null;
          saveDataSync(COLLECTION_STATE_KEY, state);
        }
        return original(...args);
      };
    }, art.collectionId);

    await container.getByRole("button", { name: "Delete all", exact: true }).click();
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();

    await expect(container).toContainText("No orphaned pattern images");
    expect(await storedPatternImageIds(page)).toEqual([...art.imageIds].sort());
  });

  // NumistaLookup keeps its rules in a module-level cache that is hydrated once at
  // boot, so a rule another tab restored or imported is invisible to it. Numista
  // image ownership is read from the persisted rules at the moment of the delete.
  test("Delete all keeps an image that a rule persisted by another tab now references", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    await page.evaluate(() =>
      window.imageCache.cachePatternImage(
        "rule-owned-strk438",
        new Blob(["obv"], { type: "image/png" }),
        null
      )
    );

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");
    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText("rule-owned-strk438");

    // Another tab persists a rule bound to the listed image; this tab's cache is stale.
    await page.evaluate(() =>
      localStorage.setItem(
        "numistaLookupRules",
        JSON.stringify([
          {
            id: "rule-strk438",
            pattern: "strk438",
            replacement: "STRK 438",
            numistaId: null,
            seedImageId: "rule-owned-strk438",
            builtIn: false,
          },
        ])
      )
    );

    await container.getByRole("button", { name: "Delete all", exact: true }).click();
    await page.waitForSelector("#appDialogModal", { state: "visible" });
    await page.locator("#appDialogOk").click();

    expect(await storedPatternImageIds(page)).toEqual(["rule-owned-strk438"]);
  });

  test("No pattern image is offered for deletion when the persisted Numista rules are unreadable", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    await page.evaluate(async () => {
      await window.imageCache.cachePatternImage(
        "unverifiable-strk438",
        new Blob(["obv"], { type: "image/png" }),
        null
      );
      localStorage.setItem("numistaLookupRules", "{not valid json");
    });

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");

    const container = page.locator("#orphanedPatternImages");
    await expect(container).toContainText("No orphaned pattern images");
    await expect(container).not.toContainText("unverifiable-strk438");
  });

  // Judging ownership must not swap the shared store's state under open views:
  // load() replaces it without a change event, so Collections screens would keep
  // painting the old state while later interactions read the new one.
  test("Opening the orphan list does not replace the shared Collections store state", async ({
    page,
  }) => {
    await bootCleanPatternImageStore(page);
    const art = await seedCollectionArtwork(page, {
      name: "STRK-438 Snapshot Set",
      slotLabels: ["Lambda"],
    });
    await page.evaluate((id) => {
      window.__collectionsBefore = window.collectionsStore.getState();
      // Another tab renames the Collection in persisted state.
      const state = JSON.parse(JSON.stringify(window.collectionsStore.getState()));
      state.collections[id].name = "Renamed elsewhere";
      saveDataSync(COLLECTION_STATE_KEY, state);
    }, art.collectionId);

    await openSettingsModal(page);
    await openSettingsSection(page, "images", "#settingsPanel_images");
    await expect(page.locator("#orphanedPatternImages")).toContainText(
      "No orphaned pattern images"
    );

    const sameObject = await page.evaluate(
      () => window.collectionsStore.getState() === window.__collectionsBefore
    );
    expect(sameObject).toBe(true);
  });

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

// User image storage: the soft-cap pre-flight in cacheUserImageResult, its
// pressure-band toasts, and the cached userImages byte total that spares the
// pre-flight a store scan. Steps pin `_quotaBytes` for deterministic bands.
const QUOTA_TINY = 1000; // bytes, below any real image
const QUOTA_1MB = 1_000_000;
const QUOTA_HUGE = 100_000_000;

/**
 * Boots the app, settles the async quota estimate so it cannot overwrite a pinned
 * `_quotaBytes`, and wraps `_userImagesBytes` (the only store scan) in a counter.
 * @param {import('@playwright/test').Page} page - Page to boot.
 * @returns {Promise<void>}
 */
async function bootImageCache(page) {
  await page.goto("/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.imageCache && typeof window.imageCache.init === "function"
  );
  await page.evaluate(async () => {
    const ic = window.imageCache;
    await ic.init();
    if (typeof ic._initQuota === "function") await ic._initQuota();
    const scan = ic._userImagesBytes.bind(ic);
    ic._userImagesBytes = async function countingUserImagesBytes() {
      window.__userImagesScanCount = (window.__userImagesScanCount || 0) + 1;
      return scan();
    };
  });
}

/**
 * Runs each case as a step on one booted page. Before each step the store is
 * emptied (which also drops the cached total), the warned band is reset, and
 * toasts and the scan counter are cleared.
 * @param {import('@playwright/test').Page} page - Page booted by bootImageCache.
 * @param {Array<{name: string, run: Function}>} cases - Steps to run.
 * @returns {Promise<void>}
 */
const runImageCacheCases = async (page, cases) => {
  test.setTimeout(test.info().timeout * cases.length);
  for (const { name, run } of cases) {
    await test.step(name, async () => {
      await page.evaluate(async (quota) => {
        const ic = window.imageCache;
        await ic.clearAll();
        ic._quotaBytes = quota;
        ic._lastWarnedLevel = "ok";
        window.__userImagesScanCount = 0;
        document.querySelectorAll(".cloud-toast").forEach((toast) => toast.remove());
      }, QUOTA_HUGE);
      await run(page);
    });
  }
};

const scanCount = (page) => page.evaluate(() => window.__userImagesScanCount || 0);

const QUOTA_CASES = [
  {
    name: "cacheUserImageResult refuses the write and reports quotaExceeded when over the soft cap (REQ-4)",
    run: async (page) => {
      const out = await page.evaluate(async (quota) => {
        const uuid = "strk146-preflight";
        window.imageCache._quotaBytes = quota;
        const res = await window.imageCache.cacheUserImageResult(
          uuid,
          new Blob([new Uint8Array(50000)])
        );
        const stored = await window.imageCache.getUserImage(uuid);
        return { ok: res.ok, quotaExceeded: res.quotaExceeded, stored: !!stored };
      }, QUOTA_TINY);
      expect(out).toEqual({ ok: false, quotaExceeded: true, stored: false });
    },
  },
  {
    name: "cacheUserImageWithFeedback shows an explicit error toast on quota failure (REQ-3)",
    run: async (page) => {
      const ok = await page.evaluate(async (quota) => {
        window.imageCache._quotaBytes = quota;
        return window.imageCache.cacheUserImageWithFeedback(
          "strk146-err",
          new Blob([new Uint8Array(50000)])
        );
      }, QUOTA_TINY);
      expect(ok).toBe(false);
      await expect(page.locator(".cloud-toast")).toContainText("Storage full");
    },
  },
  {
    name: "warns when an accepted save crosses the 85% pressure band (REQ-1)",
    run: async (page) => {
      const out = await page.evaluate(async (quota) => {
        window.imageCache._quotaBytes = quota;
        // 90% of the quota: the save fits.
        const ok = await window.imageCache.cacheUserImageWithFeedback(
          "strk146-warn",
          new Blob([new Uint8Array(900000)])
        );
        const stored = await window.imageCache.getUserImage("strk146-warn");
        return { ok, stored: !!stored };
      }, QUOTA_1MB);
      expect(out).toEqual({ ok: true, stored: true });
      await expect(page.locator(".cloud-toast")).toContainText("full");
    },
  },
  {
    name: "ample quota: save succeeds with no toast and a usable image URL (NFR-2 regression)",
    run: async (page) => {
      const out = await page.evaluate(async () => {
        const ok = await window.imageCache.cacheUserImageWithFeedback(
          "strk146-ok",
          new Blob([new Uint8Array(50000)])
        );
        const url = await window.imageCache.getUserImageUrl("strk146-ok");
        const legacy = await window.imageCache.cacheUserImage(
          "strk146-ok-legacy",
          new Blob([new Uint8Array(40000)])
        );
        return { ok, urlIsBlob: typeof url === "string" && url.startsWith("blob:"), legacy };
      });
      expect(out).toEqual({ ok: true, urlIsBlob: true, legacy: true });
      await expect(page.locator(".cloud-toast")).toHaveCount(0);
    },
  },
  {
    name: "does not re-warn while staying in the same pressure band (REQ-2)",
    run: async (page) => {
      await page.evaluate(async (quota) => {
        window.imageCache._quotaBytes = quota;
        // 88%, then a small save that stays in the warn band.
        await window.imageCache.cacheUserImageWithFeedback(
          "strk146-spamA",
          new Blob([new Uint8Array(880000)])
        );
        await window.imageCache.cacheUserImageWithFeedback(
          "strk146-spamB",
          new Blob([new Uint8Array(10000)])
        );
      }, QUOTA_1MB);
      await expect(page.locator(".cloud-toast")).toHaveCount(1);
    },
  },
  {
    name: "escalates the warning when usage crosses from the warn band into the critical band (REQ-1)",
    run: async (page) => {
      await page.evaluate(async (quota) => {
        window.imageCache._quotaBytes = quota;
        // 88% (warn band), then 98% (critical band).
        await window.imageCache.cacheUserImageWithFeedback(
          "strk146-escA",
          new Blob([new Uint8Array(880000)])
        );
        await window.imageCache.cacheUserImageWithFeedback(
          "strk146-escB",
          new Blob([new Uint8Array(100000)])
        );
      }, QUOTA_1MB);
      await expect(page.locator(".cloud-toast")).toHaveCount(2);
      await expect(page.locator(".cloud-toast").last()).toContainText("saves may start failing");
    },
  },
];

const USAGE_CACHE_CASES = [
  {
    name: "AC-1: a warm cache serves the pre-flight without re-scanning userImages",
    run: async (page) => {
      await page.evaluate(async () => {
        await window.imageCache.cacheUserImageResult(
          "ac1-warmup",
          new Blob([new Uint8Array(1000)])
        );
        window.__userImagesScanCount = 0;
        await window.imageCache.cacheUserImageResult(
          "ac1-second",
          new Blob([new Uint8Array(2000)])
        );
      });
      expect(await scanCount(page)).toBe(0);
    },
  },
  {
    name: "AC-2: usage is computed once and retained across needs",
    run: async (page) => {
      await page.evaluate(async () => {
        await window.imageCache.cacheUserImageResult("ac2-a", new Blob([new Uint8Array(1000)]));
        await window.imageCache.cacheUserImageResult("ac2-b", new Blob([new Uint8Array(1000)]));
      });
      expect(await scanCount(page)).toBe(1);
    },
  },
  {
    name: "AC-3: the cached total tracks the signed delta, including a shrinking replace",
    run: async (page) => {
      const out = await page.evaluate(async () => {
        const ic = window.imageCache;
        await ic.cacheUserImageResult("ac3-a", new Blob([new Uint8Array(1000)]));
        const afterA = ic._userImagesBytesCache;
        await ic.cacheUserImageResult("ac3-b", new Blob([new Uint8Array(2000)]));
        const afterB = ic._userImagesBytesCache;
        // Replacing ac3-a with a smaller blob applies a delta of 500 - 1000.
        await ic.cacheUserImageResult("ac3-a", new Blob([new Uint8Array(500)]));
        const afterShrink = ic._userImagesBytesCache;
        return { afterA, afterB, afterShrink };
      });
      expect(out).toEqual({ afterA: 1000, afterB: 3000, afterShrink: 2500 });
    },
  },
  {
    // A cold-to-warm scan is allowed; no delta may be applied. The cache is warm here.
    name: "AC-4: a blocked write and a failed _put leave the cached total unmoved",
    run: async (page) => {
      const out = await page.evaluate(async (quota) => {
        const ic = window.imageCache;
        await ic.cacheUserImageResult("ac4-base", new Blob([new Uint8Array(1000)]));
        const base = ic._userImagesBytesCache;

        ic._quotaBytes = 1000;
        const blocked = await ic.cacheUserImageResult("ac4-big", new Blob([new Uint8Array(50000)]));
        const afterBlock = ic._userImagesBytesCache;

        ic._quotaBytes = quota;
        const origPut = ic._put.bind(ic);
        ic._put = async () => false;
        const failed = await ic.cacheUserImageResult(
          "ac4-putfail",
          new Blob([new Uint8Array(2000)])
        );
        const afterFail = ic._userImagesBytesCache;
        ic._put = origPut;

        return {
          base,
          blockedQuota: blocked.quotaExceeded,
          afterBlock,
          failOk: failed.ok,
          afterFail,
        };
      }, QUOTA_HUGE);
      expect(out).toEqual({
        base: 1000,
        blockedQuota: true,
        afterBlock: 1000,
        failOk: false,
        afterFail: 1000,
      });
    },
  },
  {
    name: "AC-5: delete / clearAll / import invalidate the cache so the next read recomputes",
    run: async (page) => {
      const out = await page.evaluate(async () => {
        const ic = window.imageCache;

        await ic.cacheUserImageResult("ac5-a", new Blob([new Uint8Array(1000)]));
        await ic.cacheUserImageResult("ac5-b", new Blob([new Uint8Array(2000)]));
        await ic.deleteUserImage("ac5-a");
        await ic.cacheUserImageResult("ac5-c", new Blob([new Uint8Array(500)]));
        const afterDeleteSave = ic._userImagesBytesCache;

        await ic.clearAll();
        await ic.cacheUserImageResult("ac5-d", new Blob([new Uint8Array(700)]));
        const afterClearSave = ic._userImagesBytesCache;

        await ic.clearAll();
        await ic.cacheUserImageResult("ac5-e", new Blob([new Uint8Array(400)]));
        await ic.importUserImageRecord({
          uuid: "ac5-imp",
          obverse: new Blob([new Uint8Array(600)]),
          reverse: null,
          size: 600,
          cachedAt: 1,
        });
        await ic.cacheUserImageResult("ac5-f", new Blob([new Uint8Array(100)]));
        const afterImportSave = ic._userImagesBytesCache;

        return { afterDeleteSave, afterClearSave, afterImportSave };
      });
      // 2000 + 500 after the delete; 700 after clearAll; 400 + 600 imported + 100.
      expect(out).toEqual({ afterDeleteSave: 2500, afterClearSave: 700, afterImportSave: 1100 });
    },
  },
  {
    name: "AC-6: STRK-146 quota contract intact (block report + warn toast)",
    run: async (page) => {
      const out = await page.evaluate(async () => {
        const ic = window.imageCache;
        ic._quotaBytes = 1000;
        const res = await ic.cacheUserImageResult("ac6-block", new Blob([new Uint8Array(50000)]));
        return {
          ok: res.ok,
          quotaExceeded: res.quotaExceeded,
          usageBytes: res.usageBytes,
          limitBytes: res.limitBytes,
        };
      });
      expect(out.ok).toBe(false);
      expect(out.quotaExceeded).toBe(true);
      expect(out.limitBytes).toBe(1000);
      expect(typeof out.usageBytes).toBe("number");

      await page.evaluate(async () => {
        const ic = window.imageCache;
        ic._quotaBytes = 1_000_000;
        await ic.cacheUserImageWithFeedback("ac6-warn", new Blob([new Uint8Array(900000)]));
      });
      await expect(page.locator(".cloud-toast")).toContainText("full");
    },
  },
];

test.describe("core/settings-search-images — user image storage", () => {
  test("the soft-cap pre-flight and its pressure-band toasts", async ({ page }) => {
    await bootImageCache(page);
    await runImageCacheCases(page, QUOTA_CASES);
  });

  test("the cached userImages byte total", async ({ page }) => {
    await bootImageCache(page);
    await runImageCacheCases(page, USAGE_CACHE_CASES);
  });
});
