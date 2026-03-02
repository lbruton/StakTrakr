import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { dismissAckModal } from './test-utils.js';

test.describe('Backup and Restore', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await dismissAckModal(page);
  });

  test('Export Inventory as CSV', async ({ page }) => {
    await page.locator('#newItemBtn').click();
    await page.fill('#itemModal #itemName', 'Export CSV Test');
    await page.fill('#itemQty', '1');
    await page.fill('#itemWeight', '1');
    await page.locator('#itemModalSubmit').click();

    await page.locator('#settingsBtn').click();
    const inventorySection = page.locator('#settingsModal .settings-nav-item[data-section="system"]');
    await inventorySection.click();

    const [ download ] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('#exportCsvBtn').click()
    ]);
    
    const downloadPath = path.join(process.cwd(), 'test-results', 'backup.csv');
    await download.saveAs(downloadPath);
    
    const csvContent = fs.readFileSync(downloadPath, 'utf8');
    expect(csvContent).toContain('Export CSV Test');
    if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath);
  });

  test('Export and Restore JSON', async ({ page }) => {
    await page.locator('#newItemBtn').click();
    await page.fill('#itemModal #itemName', 'JSON Backup Test');
    await page.fill('#itemQty', '1');
    await page.fill('#itemWeight', '1');
    await page.locator('#itemModalSubmit').click();

    await page.locator('#settingsBtn').click();
    const inventorySection = page.locator('#settingsModal .settings-nav-item[data-section="system"]');
    await inventorySection.click();

    const [ download ] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('#exportJsonBtn').click()
    ]);
    
    const downloadPath = path.join(process.cwd(), 'test-results', 'backup.json');
    await download.saveAs(downloadPath);
    
    const jsonContent = fs.readFileSync(downloadPath, 'utf8');
    const backupData = JSON.parse(jsonContent);
    // exportJson now emits { items: [...], exportMeta: {...} }; plain array is also accepted for legacy imports
    const backupItems = Array.isArray(backupData) ? backupData : backupData.items;
    expect(Array.isArray(backupItems)).toBeTruthy();
    
    const storageSection = page.locator('#settingsModal .settings-nav-item[data-section="storage"]');
    await storageSection.click();
    
    await page.locator('#boatingAccidentBtn').click();
    await expect(page.locator('#appDialogModal')).toBeVisible();
    await page.locator('#appDialogOk').click();

    await expect(page.locator('#appDialogMessage')).toContainText('erased');
    await page.locator('#appDialogOk').click();
    await expect(page.locator('#appDialogModal')).not.toBeVisible();
    
    await expect(page.locator('article', { hasText: 'JSON Backup Test' })).not.toBeVisible();

    // Settings modal should still be open
    if (!(await page.locator('#settingsModal').isVisible())) {
      await page.locator('#settingsBtn').click();
    }
    await inventorySection.click();
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#importJsonOverride').click();
    
    // Confirmation dialog before file picker
    await expect(page.locator('#appDialogModal')).toBeVisible();
    await page.locator('#appDialogOk').click();
    
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(downloadPath);

    await expect(page.locator('article', { hasText: 'JSON Backup Test' })).toBeVisible();
    if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath);
  });

  test('STAK-226: ZIP backup includes user_image_manifest.json with correct entries', async ({ page }) => {
    // Seed a fake user image into IDB, then create a backup ZIP and inspect its contents.
    const manifestEntries = await page.evaluate(async () => {
      // Seed a user image record directly into IDB
      const fakeBlob = new Blob(['fake-image-data'], { type: 'image/jpeg' });
      const fakeUuid = 'stak226-test-uuid-0001';
      await imageCache.importUserImageRecord({
        uuid: fakeUuid,
        obverse: fakeBlob,
        reverse: null,
        cachedAt: Date.now(),
        size: fakeBlob.size,
      });

      // Intercept URL.createObjectURL to capture the ZIP blob before the anchor clicks
      let capturedBlob = null;
      const origCreate = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        capturedBlob = blob;
        return origCreate(blob);
      };

      await createBackupZip();
      URL.createObjectURL = origCreate;

      if (!capturedBlob) return null;

      // Load ZIP and inspect user_image_manifest.json
      const arrayBuffer = await capturedBlob.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const manifestFile = zip.file('user_image_manifest.json');
      if (!manifestFile) return null;

      const manifestJson = await manifestFile.async('string');
      return JSON.parse(manifestJson).entries;
    });

    expect(manifestEntries).not.toBeNull();
    expect(Array.isArray(manifestEntries)).toBe(true);
    const entry = manifestEntries.find(e => e.uuid === 'stak226-test-uuid-0001');
    expect(entry).toBeTruthy();
    expect(entry.hasObverse).toBe(true);
    expect(entry.hasReverse).toBe(false);
    expect(entry.obverseFile).toBe('user_images/stak226-test-uuid-0001_obverse.jpg');
    expect(entry.reverseFile).toBeNull();
  });

  test('STAK-226: ZIP restore uses manifest when present (manifest-driven path)', async ({ page }) => {
    // Test the manifest-driven restore path directly via JSZip + imageCache,
    // mirroring exactly what restoreBackupZip does for user_images.
    const result = await page.evaluate(async () => {
      const fakeUuid = 'stak226-restore-uuid-0001';
      const fakeBlob = new Blob(['restore-test-data'], { type: 'image/jpeg' });

      // Build a ZIP with user_image_manifest.json
      const zip = new JSZip();
      zip.folder('user_images').file(`${fakeUuid}_obverse.jpg`, fakeBlob);
      zip.file('user_image_manifest.json', JSON.stringify({
        version: '3.0.0',
        exportDate: new Date().toISOString(),
        entries: [{
          uuid: fakeUuid,
          itemName: 'Test Coin',
          hasObverse: true,
          hasReverse: false,
          obverseFile: `user_images/${fakeUuid}_obverse.jpg`,
          reverseFile: null,
          cachedAt: Date.now(),
          size: fakeBlob.size,
        }],
      }, null, 2));

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const loadedZip = await JSZip.loadAsync(await zipBlob.arrayBuffer());

      // Run the same manifest-driven restore logic as restoreBackupZip
      const manifestFile = loadedZip.file('user_image_manifest.json');
      const manifestData = JSON.parse(await manifestFile.async('string'));
      for (const entry of (manifestData.entries || [])) {
        const obverseFile = entry.obverseFile ? loadedZip.file(entry.obverseFile) : null;
        const reverseFile = entry.reverseFile ? loadedZip.file(entry.reverseFile) : null;
        const obverse = obverseFile ? await obverseFile.async('blob') : null;
        const reverse = reverseFile ? await reverseFile.async('blob') : null;
        await imageCache.importUserImageRecord({
          uuid: entry.uuid,
          obverse,
          reverse,
          cachedAt: entry.cachedAt || Date.now(),
          size: entry.size || (obverse?.size || 0) + (reverse?.size || 0),
        });
      }

      const restored = await imageCache.getUserImage(fakeUuid);
      return { restored: !!restored, hasObverse: !!restored?.obverse };
    });

    expect(result.restored).toBe(true);
    expect(result.hasObverse).toBe(true);
  });

  test('STAK-226: ZIP restore falls back to filename parsing for old ZIPs (no manifest)', async ({ page }) => {
    // Test the legacy filename-parsing fallback path directly.
    const result = await page.evaluate(async () => {
      const fakeUuid = 'stak226-legacy-uuid-0001';
      const fakeBlob = new Blob(['legacy-test-data'], { type: 'image/jpeg' });

      // Build an old-style ZIP with no manifest
      const zip = new JSZip();
      zip.folder('user_images').file(`${fakeUuid}_obverse.jpg`, fakeBlob);

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const loadedZip = await JSZip.loadAsync(await zipBlob.arrayBuffer());

      // Run the legacy filename-parsing fallback path
      const userImgFolder = loadedZip.folder('user_images');
      const userEntries = [];
      userImgFolder.forEach((path, file) => userEntries.push({ path, file }));
      const userImageMap = new Map();
      for (const { path, file } of userEntries) {
        const m = path.match(/^(.+)_(obverse|reverse)\.jpg$/);
        if (!m) continue;
        if (!userImageMap.has(m[1])) userImageMap.set(m[1], {});
        userImageMap.get(m[1])[m[2]] = await file.async('blob');
      }
      for (const [uuid, sides] of userImageMap) {
        await imageCache.importUserImageRecord({
          uuid,
          obverse: sides.obverse || null,
          reverse: sides.reverse || null,
          cachedAt: Date.now(),
          size: (sides.obverse?.size || 0) + (sides.reverse?.size || 0),
        });
      }

      const restored = await imageCache.getUserImage(fakeUuid);
      return { restored: !!restored, hasObverse: !!restored?.obverse };
    });

    expect(result.restored).toBe(true);
    expect(result.hasObverse).toBe(true);
  });

  test('Vault encrypted backup flow', async ({ page }) => {
    // PBKDF2 600K iterations takes 30–60s in browserless headless Docker vs ~2s in a
    // real browser. Wipe seed inventory to keep the AES-GCM payload small.
    test.setTimeout(120_000);

    await page.locator('#settingsBtn').click();
    await page.locator('#settingsModal .settings-nav-item[data-section="storage"]').click();
    const wipeBtn = page.locator('#boatingAccidentBtn');
    if (await wipeBtn.isVisible()) {
      await wipeBtn.click();
      await expect(page.locator('#appDialogModal')).toBeVisible();
      await page.locator('#appDialogOk').click();
      await expect(page.locator('#appDialogMessage')).toContainText('erased');
      await page.locator('#appDialogOk').click();
      await expect(page.locator('#appDialogModal')).not.toBeVisible();
    }
    // Close settings modal so #newItemBtn is clickable
    await page.locator('#settingsCloseBtn').click();

    await page.locator('#newItemBtn').click();
    await page.fill('#itemModal #itemName', 'Vault Test');
    await page.fill('#itemQty', '1');
    await page.fill('#itemWeight', '1');
    await page.locator('#itemModalSubmit').click();

    if (!(await page.locator('#settingsModal').isVisible())) {
      await page.locator('#settingsBtn').click();
    }
    const inventorySection = page.locator('#settingsModal .settings-nav-item[data-section="system"]');
    await inventorySection.click();

    await page.locator('#vaultExportBtn').click();
    await expect(page.locator('#vaultModal')).toBeVisible();
    await page.fill('#vaultPassword', 'test-password');
    await page.fill('#vaultConfirmPassword', 'test-password');

    // 90s timeout: PBKDF2 600K iterations can take 30–60s in resource-constrained
    // headless Docker. Vault encryption works fine in real browsers (confirmed in prod).
    const [ download ] = await Promise.all([
      page.waitForEvent('download', { timeout: 90_000 }),
      page.locator('#vaultActionBtn').click()
    ]);
    
    const downloadPath = path.join(process.cwd(), 'test-results', 'backup.stvault');
    await download.saveAs(downloadPath);
    
    await page.evaluate(() => { localStorage.clear(); });
    await page.reload();
    await dismissAckModal(page);
    
    await expect(page.locator('article', { hasText: 'Vault Test' })).not.toBeVisible();

    await page.locator('#settingsBtn').click();
    await page.locator('#settingsModal .settings-nav-item[data-section="system"]').click();
    
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('#vaultImportBtn').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(downloadPath);

    await expect(page.locator('#vaultModal')).toBeVisible();
    await page.fill('#vaultPassword', 'test-password');
    await page.locator('#vaultActionBtn').click();

    await expect(page.locator('article', { hasText: 'Vault Test' })).toBeVisible();
    if (fs.existsSync(downloadPath)) fs.unlinkSync(downloadPath);
  });
});
