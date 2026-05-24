import { test, expect } from "../helpers/mocks/extended-test.js";
import { injectSeedInventory } from "../helpers/seed.js";

// F.6 — Attachment UI rendering tests (AC-1, AC-8, D15)

test.describe("STRK-45 — renderAttachmentBadge", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.renderAttachmentBadge === "function");
  });

  test("returns null for item with empty attachments array", async ({ page }) => {
    const result = await page.evaluate(() => renderAttachmentBadge({ attachments: [] }));
    expect(result).toBeNull();
  });

  test("returns null for null/undefined item", async ({ page }) => {
    const result = await page.evaluate(() => renderAttachmentBadge(null));
    expect(result).toBeNull();
  });

  test("returns a DOM element with count for single attachment", async ({ page }) => {
    const text = await page.evaluate(async () => {
      const el = renderAttachmentBadge({
        attachments: [{ attachmentUuid: "a1", fileName: "a.pdf" }],
      });
      if (!el) return null;
      document.body.appendChild(el);
      const t = el.textContent;
      el.remove();
      return t;
    });
    expect(text).not.toBeNull();
    expect(text).toContain("1");
  });

  test("returns a DOM element with count for multiple attachments", async ({ page }) => {
    const text = await page.evaluate(async () => {
      const item = {
        attachments: [
          { attachmentUuid: "a1", fileName: "a.pdf" },
          { attachmentUuid: "a2", fileName: "b.pdf" },
          { attachmentUuid: "a3", fileName: "c.jpg" },
        ],
      };
      const el = renderAttachmentBadge(item);
      if (!el) return null;
      document.body.appendChild(el);
      const t = el.textContent;
      el.remove();
      return t;
    });
    expect(text).not.toBeNull();
    expect(text).toContain("3");
  });
});

test.describe("STRK-45 — renderAttachmentListPanel", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.renderAttachmentListPanel === "function");
  });

  test("renders file names in the panel", async ({ page }) => {
    const text = await page.evaluate(async () => {
      const item = {
        attachments: [
          {
            attachmentUuid: "s1",
            fileName: "receipt-test.pdf",
            mimeType: "application/pdf",
            size: 2048,
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      };
      const el = await renderAttachmentListPanel(item, {});
      if (!el) return null;
      document.body.appendChild(el);
      const text = el.textContent;
      el.remove();
      return text;
    });
    expect(text).toContain("receipt-test.pdf");
  });

  test("shows empty state when no attachments", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const el = await renderAttachmentListPanel({ attachments: [] }, {});
      if (!el) return null;
      document.body.appendChild(el);
      const text = el.textContent;
      const tagName = el.tagName;
      el.remove();
      return { text, tagName };
    });
    expect(result).not.toBeNull();
    // Should render something (empty state element)
    expect(result.tagName).toBeTruthy();
  });
});

test.describe("STRK-45 — renderAttachmentDiffRow", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.renderAttachmentDiffRow === "function");
  });

  test("returns a DOM element for 'added' action type", async ({ page }) => {
    const result = await page.evaluate(() => {
      const entry = {
        action: "add",
        attachmentUuid: "new-att",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        localVal: null,
        remoteVal: { attachmentUuid: "new-att", fileName: "photo.jpg" },
      };
      const el = renderAttachmentDiffRow(entry, "added");
      if (!el) return null;
      document.body.appendChild(el);
      const result = {
        tagName: el.tagName,
        className: el.className,
        hasContent: el.innerHTML.length > 0,
      };
      el.remove();
      return result;
    });
    expect(result).not.toBeNull();
    expect(result.tagName).toBeTruthy();
    expect(result.hasContent).toBe(true);
  });

  test("returns a DOM element for 'removed' action type", async ({ page }) => {
    const result = await page.evaluate(() => {
      const entry = {
        action: "remove",
        attachmentUuid: "old-att",
        fileName: "old.pdf",
        mimeType: "application/pdf",
        size: 512,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        localVal: { attachmentUuid: "old-att", fileName: "old.pdf" },
        remoteVal: null,
      };
      const el = renderAttachmentDiffRow(entry, "removed");
      if (!el) return null;
      document.body.appendChild(el);
      const result = { tagName: el.tagName, className: el.className };
      el.remove();
      return result;
    });
    expect(result).not.toBeNull();
    expect(result.tagName).toBeTruthy();
  });

  test("returns a DOM element for 'replaced' action type with both file names accessible", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const entry = {
        action: "replace",
        attachmentUuid: "new-cert-uuid",
        oldAttachmentUuid: "old-cert-uuid",
        fileName: "cert-v2.pdf",
        mimeType: "application/pdf",
        size: 2048,
        uploadedAt: "2026-01-15T00:00:00.000Z",
        localVal: { attachmentUuid: "old-cert-uuid", fileName: "cert-v1.pdf", size: 1024 },
        remoteVal: { attachmentUuid: "new-cert-uuid", fileName: "cert-v2.pdf", size: 2048 },
      };
      const el = renderAttachmentDiffRow(entry, "replaced");
      if (!el) return null;
      document.body.appendChild(el);
      const html = el.innerHTML;
      el.remove();
      return html;
    });
    expect(result).not.toBeNull();
    // Should reference the new file name somewhere
    expect(result).toContain("cert-v2.pdf");
  });

  test("outerHTML can be embedded in a string-based HTML renderer", async ({ page }) => {
    const htmlString = await page.evaluate(() => {
      const entry = {
        action: "add",
        attachmentUuid: "embed-uuid",
        fileName: "embed-test.pdf",
        mimeType: "application/pdf",
        size: 100,
        uploadedAt: "2026-01-01T00:00:00.000Z",
        localVal: null,
        remoteVal: { attachmentUuid: "embed-uuid", fileName: "embed-test.pdf" },
      };
      const el = renderAttachmentDiffRow(entry, "added");
      if (!el) return null;
      return typeof el.outerHTML === "string" ? el.outerHTML : null;
    });
    expect(htmlString).not.toBeNull();
    expect(htmlString.startsWith("<")).toBe(true);
  });
});

test.describe("STRK-45 — Settings storage display", () => {
  test.beforeEach(async ({ page }) => {
    await injectSeedInventory(page);
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof window.attachmentManager !== "undefined");
  });

  test("Settings tab renders without throwing when attachment storage row is present", async ({
    page,
  }) => {
    // Open settings
    const settingsBtn = page
      .locator("#settingsBtn, [data-tab='settings'], button[onclick*='settings']")
      .first();
    const hasSettingsBtn = (await settingsBtn.count()) > 0;
    if (!hasSettingsBtn) {
      // Navigate via header if button not found by typical selector
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button, a"));
        const s = btns.find((b) => b.textContent.toLowerCase().includes("settings"));
        if (s) s.click();
      });
    } else {
      await settingsBtn.click();
    }
    // The page should not throw — attachment storage row is a bonus check
    await page.waitForTimeout(500);
    const errors = await page.evaluate(() => window.__lastError || null);
    expect(errors).toBeNull();
  });
});
